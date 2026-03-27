import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type {
  AssembleResult,
  BootstrapResult,
  CompactResult,
  ContextEngine,
  ContextEngineInfo,
  ContextEngineMaintenanceResult,
  ContextEngineRuntimeContext,
  IngestBatchResult,
  IngestResult,
  SubagentEndReason,
  SubagentSpawnPreparation,
} from "./types.js";

// ---------------------------------------------------------------------------
// Truth classification types
// ---------------------------------------------------------------------------

export type TruthClass =
  | "user_truth" // User explicitly stated this. Authoritative.
  | "grounded" // Backed by tool output or verifiable evidence.
  | "ungrounded" // Agent claim with no evidence trail.
  | "unclassified"; // Legacy event — no classification available.

export interface TruthMeta {
  truthClass: TruthClass;
  /** 0.0–1.0 confidence in the classification */
  confidence: number;
}

export type GroundingTier = "healthy" | "warning" | "critical" | "unknown";

export interface GroundingSnapshot {
  ratio: number;
  tier: GroundingTier;
  breakdown: { user_truth: number; grounded: number; ungrounded: number; unclassified: number };
  total: number;
  classified: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Classification logic
// ---------------------------------------------------------------------------

const GROUNDING_HEALTHY = 0.6;
const GROUNDING_WARNING = 0.4;
const SNAPSHOT_WINDOW = 200;
const MAX_STORE_ENTRIES = 500;

/** Below this fraction of token budget remaining, drop low-importance messages */
const BUDGET_PRESSURE_THRESHOLD = 0.25;

// ---------------------------------------------------------------------------
// Importance-weighted scoring
// ---------------------------------------------------------------------------

/** Rough token estimate: ~4 chars per token */
function estimateTokens(msg: AgentMessage): number {
  const content =
    typeof msg.content === "string"
      ? msg.content
      : JSON.stringify(msg.content);
  return Math.ceil(content.length / 4);
}

/**
 * Importance multiplier based on truth classification.
 *
 * Maps truth class to a multiplier that affects message priority during
 * budget-constrained assembly:
 *
 *   user_truth  → 1.4  (highest priority — user's own statements)
 *   grounded    → 1.2  (tool-verified facts)
 *   unclassified→ 1.0  (neutral — legacy or unknown)
 *   ungrounded  → 0.6  (lowest priority — agent claims without evidence)
 */
function importanceMultiplier(meta: TruthMeta): number {
  switch (meta.truthClass) {
    case "user_truth": return 1.4;
    case "grounded": return 1.2;
    case "unclassified": return 1.0;
    case "ungrounded": return 0.6;
  }
}

/**
 * Under budget pressure, filter out low-importance ungrounded messages
 * from the assembled context. Preserves message order and never drops
 * user messages or the most recent N messages (to maintain coherence).
 */
function applyImportanceFilter(
  messages: AgentMessage[],
  sessionId: string,
  store: TruthMetadataStore,
  tokenBudget: number | undefined,
  estimatedTokens: number,
): AgentMessage[] {
  if (!tokenBudget || tokenBudget <= 0) return messages;

  const budgetRemaining = tokenBudget - estimatedTokens;
  const budgetRatio = budgetRemaining / tokenBudget;

  // Only filter when under pressure
  if (budgetRatio >= BUDGET_PRESSURE_THRESHOLD) return messages;

  // Never drop the last 6 messages (current conversation coherence)
  const protectedCount = Math.min(6, messages.length);
  const protectedStart = messages.length - protectedCount;

  const filtered: AgentMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Always keep protected recent messages
    if (i >= protectedStart) {
      filtered.push(msg);
      continue;
    }

    // Always keep user messages and tool results
    const role = msg.role as string;
    if (role === "user" || role === "tool") {
      filtered.push(msg);
      continue;
    }

    const meta = store.getOrDefault(sessionId, msg);
    const multiplier = importanceMultiplier(meta);

    // Drop ungrounded messages (multiplier < 1.0) when under pressure
    if (multiplier < 1.0) {
      continue;
    }

    filtered.push(msg);
  }

  return filtered;
}

/**
 * Classify a single message based on its role and turn context.
 *
 * - user messages → user_truth (1.0)
 * - tool results  → grounded (1.0)
 * - assistant messages → grounded (0.7) if tools were used in same turn,
 *                        otherwise ungrounded (0.8)
 */
function classifyMessage(
  message: AgentMessage,
  turnHasToolResults: boolean,
): TruthMeta {
  const role = message.role as string;

  if (role === "user") {
    return { truthClass: "user_truth", confidence: 1.0 };
  }

  if (role === "tool") {
    return { truthClass: "grounded", confidence: 1.0 };
  }

  if (role === "assistant") {
    if (turnHasToolResults) {
      return { truthClass: "grounded", confidence: 0.7 };
    }
    return { truthClass: "ungrounded", confidence: 0.8 };
  }

  // compactionSummary or any other role
  return { truthClass: "unclassified", confidence: 0.5 };
}

/**
 * Check whether a batch of messages contains at least one tool-role message.
 */
function batchHasToolResults(messages: AgentMessage[]): boolean {
  return messages.some((m) => (m.role as string) === "tool");
}

// ---------------------------------------------------------------------------
// Truth metadata store (per-session, in-memory, bounded)
// ---------------------------------------------------------------------------

/**
 * Bounded in-memory store for truth metadata, keyed per session.
 * Uses a WeakMap on message object references for O(1) lookup when the
 * same object is passed to both ingest and assemble. Falls back to a
 * content-based key for messages loaded fresh from transcript.
 * Evicts oldest entries when exceeding MAX_STORE_ENTRIES per session.
 */
class TruthMetadataStore {
  /** Primary lookup: exact object reference (fastest, no collisions) */
  private refMap = new WeakMap<AgentMessage, TruthMeta>();
  /** Fallback: content-based key for transcript-loaded messages */
  private sessions = new Map<string, Map<string, TruthMeta>>();
  /** Ordered keys for eviction */
  private sessionOrder = new Map<string, string[]>();

  private contentKey(msg: AgentMessage): string {
    const content =
      typeof msg.content === "string"
        ? msg.content.slice(0, 120)
        : JSON.stringify(msg.content).slice(0, 120);
    return `${msg.timestamp ?? 0}:${msg.role}:${content}`;
  }

  set(sessionId: string, msg: AgentMessage, meta: TruthMeta): void {
    // Always set on the object reference
    this.refMap.set(msg, meta);

    // Also set on content key for cross-boundary lookups
    let keyMap = this.sessions.get(sessionId);
    let order = this.sessionOrder.get(sessionId);
    if (!keyMap) {
      keyMap = new Map();
      order = [];
      this.sessions.set(sessionId, keyMap);
      this.sessionOrder.set(sessionId, order);
    }

    const key = this.contentKey(msg);
    if (!keyMap.has(key)) {
      order!.push(key);
    }
    keyMap.set(key, meta);

    // Evict oldest entries if over capacity
    if (order!.length > MAX_STORE_ENTRIES) {
      const excess = order!.length - MAX_STORE_ENTRIES;
      for (let i = 0; i < excess; i++) {
        keyMap.delete(order![i]);
      }
      order!.splice(0, excess);
    }
  }

  get(sessionId: string, msg: AgentMessage): TruthMeta | undefined {
    // Try object reference first (O(1), no collisions)
    const ref = this.refMap.get(msg);
    if (ref) return ref;

    // Fall back to content key (for transcript-loaded messages)
    const keyMap = this.sessions.get(sessionId);
    if (!keyMap) return undefined;
    return keyMap.get(this.contentKey(msg));
  }

  getOrDefault(sessionId: string, msg: AgentMessage): TruthMeta {
    return this.get(sessionId, msg) ?? { truthClass: "unclassified", confidence: 0.5 };
  }

  allMetas(sessionId: string): TruthMeta[] {
    const keyMap = this.sessions.get(sessionId);
    return keyMap ? Array.from(keyMap.values()) : [];
  }

  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.sessionOrder.delete(sessionId);
    // WeakMap entries for cleared sessions will be GC'd automatically
  }
}

// ---------------------------------------------------------------------------
// Grounding health computation
// ---------------------------------------------------------------------------

export function computeGroundingSnapshot(metas: TruthMeta[]): GroundingSnapshot {
  const recent = metas.slice(-SNAPSHOT_WINDOW);
  const breakdown = { user_truth: 0, grounded: 0, ungrounded: 0, unclassified: 0 };

  for (const m of recent) {
    breakdown[m.truthClass]++;
  }

  const classified = breakdown.user_truth + breakdown.grounded + breakdown.ungrounded;
  const ratio = classified > 0 ? (breakdown.user_truth + breakdown.grounded) / classified : 1;

  let tier: GroundingTier;
  if (classified === 0) tier = "unknown";
  else if (ratio >= GROUNDING_HEALTHY) tier = "healthy";
  else if (ratio >= GROUNDING_WARNING) tier = "warning";
  else tier = "critical";

  return {
    ratio,
    tier,
    breakdown,
    total: recent.length,
    classified,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Truth-annotated retrieval formatting
// ---------------------------------------------------------------------------

const MAX_ITEMS_PER_SECTION = 10;

function extractContent(msg: AgentMessage): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    const textParts = msg.content
      .filter((p: { type?: string }) => p.type === "text")
      .map((p: { text?: string }) => p.text ?? "");
    return textParts.join(" ");
  }
  return "";
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

/**
 * Format truth annotations for injection into the system prompt.
 * Only includes user messages and assistant messages — tool output is
 * excluded to avoid injecting raw JSON into the annotations.
 */
function formatTruthAnnotations(
  messages: AgentMessage[],
  sessionId: string,
  store: TruthMetadataStore,
): string {
  const userTruths: string[] = [];
  const unverified: string[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const role = msg.role as string;

    // Skip tool messages — their raw output is not useful in annotations.
    // The grounding they provide is reflected in the assistant classification.
    if (role === "tool") continue;

    const meta = store.getOrDefault(sessionId, msg);
    const content = truncate(extractContent(msg).trim(), 200);
    if (!content) continue;

    switch (meta.truthClass) {
      case "user_truth":
        if (userTruths.length < MAX_ITEMS_PER_SECTION) userTruths.push(content);
        break;
      case "ungrounded":
        if (unverified.length < MAX_ITEMS_PER_SECTION) unverified.push(content);
        break;
      // grounded assistant messages don't need annotation — they're already trustworthy
    }
  }

  const sections: string[] = [];

  if (userTruths.length > 0) {
    sections.push(
      "### User-Stated Facts (authoritative)\n" +
        userTruths.map((t) => `- ${t}`).join("\n"),
    );
  }

  if (unverified.length > 0) {
    sections.push(
      "### Unverified Claims (no evidence trail)\n" +
        unverified.map((t) => `- ${t}`).join("\n"),
    );
  }

  return sections.join("\n\n");
}

export function formatGroundingHealthNotice(snapshot: GroundingSnapshot): string {
  if (snapshot.tier === "healthy" || snapshot.tier === "unknown") return "";

  const pct = Math.round(snapshot.ratio * 100);
  if (snapshot.tier === "critical") {
    return (
      `[Grounding Health: CRITICAL] Recent grounding ratio: ${pct}%. ` +
      `Most recent responses lack evidence backing. Prioritize tool-verified facts ` +
      `and hedge ungrounded claims.`
    );
  }
  return (
    `[Grounding Health: WARNING] Recent grounding ratio: ${pct}%. ` +
    `Consider verifying claims with tools before presenting them as facts.`
  );
}

// ---------------------------------------------------------------------------
// TruthBoundaryContextEngine — wraps any base engine
// ---------------------------------------------------------------------------

/**
 * A ContextEngine wrapper that adds truth classification to every message
 * at ingestion, injects truth annotations and grounding health into
 * assembled context, and monitors grounding ratio over time.
 *
 * Wraps any base ContextEngine without modifying its behavior.
 */
export class TruthBoundaryContextEngine implements ContextEngine {
  readonly info: ContextEngineInfo;
  private base: ContextEngine;
  private store = new TruthMetadataStore();
  /** Track whether current turn has seen tool results, keyed by sessionId */
  private turnToolState = new Map<string, boolean>();
  constructor(base: ContextEngine) {
    this.base = base;
    this.info = {
      id: `truth-boundary:${base.info.id}`,
      name: `Truth Boundary (${base.info.name})`,
      version: "1.0.0",
      ownsCompaction: base.info.ownsCompaction,
    };
  }

  // -- Bootstrap (delegate) -------------------------------------------------

  async bootstrap(
    params: Parameters<NonNullable<ContextEngine["bootstrap"]>>[0],
  ): Promise<BootstrapResult> {
    if (this.base.bootstrap) return this.base.bootstrap(params);
    return { bootstrapped: false, reason: "base engine has no bootstrap" };
  }

  // -- Maintain (delegate) --------------------------------------------------

  async maintain(
    params: Parameters<NonNullable<ContextEngine["maintain"]>>[0],
  ): Promise<ContextEngineMaintenanceResult> {
    if (this.base.maintain) return this.base.maintain(params);
    return { changed: false, bytesFreed: 0, rewrittenEntries: 0 };
  }

  // -- Ingest (classify + delegate) -----------------------------------------

  async ingest(params: {
    sessionId: string;
    sessionKey?: string;
    message: AgentMessage;
    isHeartbeat?: boolean;
  }): Promise<IngestResult> {
    const role = params.message.role as string;

    if (role === "tool") {
      this.turnToolState.set(params.sessionId, true);
    }

    const turnHasTools = this.turnToolState.get(params.sessionId) ?? false;
    const meta = classifyMessage(params.message, turnHasTools);
    this.store.set(params.sessionId, params.message, meta);

    return this.base.ingest(params);
  }

  // -- Ingest Batch (classify all + delegate) -------------------------------

  async ingestBatch(params: {
    sessionId: string;
    sessionKey?: string;
    messages: AgentMessage[];
    isHeartbeat?: boolean;
  }): Promise<IngestBatchResult> {
    // Pre-scan: does this batch contain any tool results?
    const batchTools = batchHasToolResults(params.messages);
    if (batchTools) {
      this.turnToolState.set(params.sessionId, true);
    }
    const turnHasTools = this.turnToolState.get(params.sessionId) ?? batchTools;

    for (const msg of params.messages) {
      const meta = classifyMessage(msg, turnHasTools);
      this.store.set(params.sessionId, msg, meta);
    }

    if (this.base.ingestBatch) return this.base.ingestBatch(params);

    // Fallback: ingest one by one
    let count = 0;
    for (const msg of params.messages) {
      const result = await this.base.ingest({ ...params, message: msg });
      if (result.ingested) count++;
    }
    return { ingestedCount: count };
  }

  // -- Assemble (delegate + annotate) ---------------------------------------

  async assemble(params: {
    sessionId: string;
    sessionKey?: string;
    messages: AgentMessage[];
    tokenBudget?: number;
    model?: string;
    prompt?: string;
  }): Promise<AssembleResult> {
    // Classify any messages we haven't seen (e.g. loaded from transcript on restart).
    // For historical messages we don't know turn context, so classify conservatively.
    for (let i = 0; i < params.messages.length; i++) {
      const msg = params.messages[i];
      if (!this.store.get(params.sessionId, msg)) {
        const role = msg.role as string;
        if (role === "user") {
          this.store.set(params.sessionId, msg, { truthClass: "user_truth", confidence: 1.0 });
        } else if (role === "tool") {
          this.store.set(params.sessionId, msg, { truthClass: "grounded", confidence: 1.0 });
        } else {
          this.store.set(params.sessionId, msg, { truthClass: "unclassified", confidence: 0.5 });
        }
      }
    }

    const result = await this.base.assemble(params);

    // Importance-weighted filtering: under budget pressure, drop ungrounded messages.
    // If base engine reports 0 tokens, estimate from message content.
    const tokensEstimate = result.estimatedTokens > 0
      ? result.estimatedTokens
      : result.messages.reduce((sum, m) => sum + estimateTokens(m), 0);

    const filteredMessages = applyImportanceFilter(
      result.messages,
      params.sessionId,
      this.store,
      params.tokenBudget,
      tokensEstimate,
    );

    // Compute grounding health
    const allMetas = this.store.allMetas(params.sessionId);
    const snapshot = computeGroundingSnapshot(allMetas);
    const healthNotice = formatGroundingHealthNotice(snapshot);
    const annotations = formatTruthAnnotations(filteredMessages, params.sessionId, this.store);

    // Combine into systemPromptAddition
    const additions: string[] = [];
    if (result.systemPromptAddition) additions.push(result.systemPromptAddition);
    if (healthNotice) additions.push(healthNotice);
    if (annotations) additions.push(annotations);

    return {
      ...result,
      messages: filteredMessages,
      systemPromptAddition: additions.length > 0 ? additions.join("\n\n") : undefined,
    };
  }

  // -- After Turn (delegate + reset turn state) -----------------------------

  async afterTurn(
    params: Parameters<NonNullable<ContextEngine["afterTurn"]>>[0],
  ): Promise<void> {
    // Reset per-turn tool tracking for next turn
    this.turnToolState.delete(params.sessionId);

    if (this.base.afterTurn) return this.base.afterTurn(params);
  }

  // -- Compact (delegate) ---------------------------------------------------

  async compact(params: Parameters<ContextEngine["compact"]>[0]): Promise<CompactResult> {
    return this.base.compact(params);
  }

  // -- Subagent lifecycle (delegate) ----------------------------------------

  async prepareSubagentSpawn(
    params: Parameters<NonNullable<ContextEngine["prepareSubagentSpawn"]>>[0],
  ): Promise<SubagentSpawnPreparation | undefined> {
    if (this.base.prepareSubagentSpawn) return this.base.prepareSubagentSpawn(params);
    return undefined;
  }

  async onSubagentEnded(params: {
    childSessionKey: string;
    reason: SubagentEndReason;
  }): Promise<void> {
    this.store.clear(params.childSessionKey);
    this.turnToolState.delete(params.childSessionKey);
    if (this.base.onSubagentEnded) return this.base.onSubagentEnded(params);
  }

  // -- Dispose (delegate + cleanup) -----------------------------------------

  async dispose(): Promise<void> {
    if (this.base.dispose) await this.base.dispose();
  }
}

// ---------------------------------------------------------------------------
// Public API — no registration helper (avoid circular dependency)
//
// Registration should be done by the caller:
//
//   import { registerContextEngineForOwner } from "./registry.js";
//   import { TruthBoundaryContextEngine } from "./truth-boundary.js";
//
//   registerContextEngineForOwner("truth-boundary", async () => {
//     const base = new LegacyContextEngine();
//     return new TruthBoundaryContextEngine(base);
//   }, "butterclaw", { allowSameOwnerRefresh: true });
//
// ---------------------------------------------------------------------------

export { formatTruthAnnotations, importanceMultiplier, applyImportanceFilter };

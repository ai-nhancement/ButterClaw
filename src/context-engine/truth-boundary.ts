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
import { scoreSignificance, SignificanceStore } from "./significance-scorer.js";
import { computeMessageDecay, decayLabel, classifyFactCategory } from "./temporal-decay.js";
import { EvidenceLedger } from "./evidence-ledger.js";

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
    // Only use refMap if the session still exists (clear() removes session but can't clean WeakMap)
    const keyMap = this.sessions.get(sessionId);
    if (!keyMap) return undefined;

    const ref = this.refMap.get(msg);
    if (ref) return ref;
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

// ---------------------------------------------------------------------------
// Temporal context — annotate messages with compact timestamps
// ---------------------------------------------------------------------------

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Already has a [DOW YYYY-MM-DD HH:MM ...] prefix (injected by gateway for user messages). */
const HAS_TIMESTAMP_PREFIX = /^\[.*\d{4}-\d{2}-\d{2} \d{2}:\d{2}/;

/**
 * Format a compact timestamp prefix from an epoch-ms value.
 * Returns `[Wed 2026-04-01 14:30]` or empty string if no valid timestamp.
 */
function formatCompactTimestamp(timestampMs: number | undefined): string {
  if (timestampMs == null || !Number.isFinite(timestampMs)) return "";
  const d = new Date(timestampMs);
  if (Number.isNaN(d.getTime())) return "";
  const dow = DAYS[d.getUTCDay()];
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `[${dow} ${yyyy}-${mm}-${dd} ${hh}:${min}]`;
}

/**
 * Annotate messages with timestamp prefixes so the model sees temporal context.
 *
 * User messages already get timestamps from gateway injection — skip those.
 * Assistant and tool messages get a compact UTC timestamp prepended.
 * Returns shallow copies; originals are not mutated.
 */
function annotateWithTimestamps(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((msg) => {
    const role = msg.role as string;

    // User messages already have gateway-injected timestamps
    if (role === "user") {
      const text = typeof msg.content === "string" ? msg.content : "";
      if (HAS_TIMESTAMP_PREFIX.test(text)) return msg;
    }

    // Skip messages without timestamps
    const ts = msg.timestamp as number | undefined;
    const prefix = formatCompactTimestamp(ts);
    if (!prefix) return msg;

    // Prepend timestamp to string content
    if (typeof msg.content === "string") {
      return { ...msg, content: `${prefix} ${msg.content}` };
    }

    // For array content, prepend to first text block
    if (Array.isArray(msg.content)) {
      const parts = [...msg.content];
      const firstTextIdx = parts.findIndex((p: { type?: string }) => p.type === "text");
      if (firstTextIdx >= 0) {
        const part = parts[firstTextIdx] as { type: string; text: string };
        parts[firstTextIdx] = { ...part, text: `${prefix} ${part.text}` };
        return { ...msg, content: parts };
      }
    }

    return msg;
  });
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
// Significance-aware compaction guidance
// ---------------------------------------------------------------------------

/** Significance threshold for a message to be called out during compaction */
const COMPACTION_PRESERVE_THRESHOLD = 0.55;
const MAX_PRESERVED_FACTS = 15;

/**
 * Build compaction guidance from the last-assembled messages.
 * Called during compact() to tell the summarizer which facts matter most.
 *
 * Uses the messages stored during the most recent assemble() call,
 * since compact() doesn't receive a message array.
 */
function buildSignificanceGuidanceFromStores(
  messages: AgentMessage[],
  truthStore: TruthMetadataStore,
  sigStore: SignificanceStore,
  sessionId: string,
  nowMs?: number,
): string {
  const now = nowMs ?? Date.now();
  const preserveFacts: string[] = [];

  for (const msg of messages) {
    if (preserveFacts.length >= MAX_PRESERVED_FACTS) break;

    const sig = sigStore.get(sessionId, msg);
    if (!sig) continue;

    // Apply temporal decay to the significance score
    const { multiplier } = computeMessageDecay(msg, now);
    const effectiveScore = sig.score * multiplier;

    if (effectiveScore < COMPACTION_PRESERVE_THRESHOLD) continue;

    const truth = truthStore.getOrDefault(sessionId, msg);
    const text = extractContent(msg).trim();
    if (!text || text.length < 10) continue;

    const truncated = text.length > 150 ? text.slice(0, 147) + "..." : text;
    const truthLabel =
      truth.truthClass === "user_truth" ? "[USER STATED]"
      : truth.truthClass === "grounded" ? "[VERIFIED]"
      : "";
    const ageLabel = decayLabel(multiplier);

    preserveFacts.push(`${truthLabel} ${ageLabel} ${truncated}`.replace(/\s+/g, " ").trim());
  }

  if (preserveFacts.length === 0) return "";

  return [
    "IMPORTANT — The following facts were scored as high-significance.",
    "Preserve them in the summary as close to verbatim as possible.",
    "User-stated facts are authoritative and must not be paraphrased into uncertainty.",
    "Facts marked [AGING] or [STALE] may be summarized more freely if space is limited.",
    "",
    ...preserveFacts.map((f, i) => `${i + 1}. ${f}`),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// TruthBoundaryContextEngine — wraps any base engine
// ---------------------------------------------------------------------------

/**
 * A ContextEngine wrapper that adds truth classification to every message
 * at ingestion, injects truth annotations and grounding health into
 * assembled context, monitors grounding ratio over time, and guides
 * compaction to preserve high-significance content.
 *
 * Wraps any base ContextEngine without modifying its behavior.
 */
export class TruthBoundaryContextEngine implements ContextEngine {
  readonly info: ContextEngineInfo;
  private base: ContextEngine;
  private store = new TruthMetadataStore();
  private sigStore = new SignificanceStore();
  /** Track whether current turn has seen tool results, keyed by sessionId */
  private turnToolState = new Map<string, boolean>();
  /** Recent messages per session for novelty scoring (bounded, sliding window) */
  private recentForNovelty = new Map<string, AgentMessage[]>();
  /** Cache high-significance messages per session for compaction guidance.
   *  Only stores messages above the preserve threshold — not the full array. */
  private preserveCandidates = new Map<string, AgentMessage[]>();
  /** Append-only evidence ledgers per session for cross-session persistence */
  private ledgers = new Map<string, EvidenceLedger>();
  constructor(base: ContextEngine) {
    this.base = base;
    this.info = {
      id: `truth-boundary:${base.info.id}`,
      name: `Truth Boundary (${base.info.name})`,
      version: "1.0.0",
      ownsCompaction: base.info.ownsCompaction,
    };
  }

  // -- Ledger helpers -------------------------------------------------------

  /** Build a stable key for a message (mirrors the content key used by stores) */
  private messageKey(msg: AgentMessage): string {
    const content =
      typeof msg.content === "string"
        ? msg.content.slice(0, 120)
        : JSON.stringify(msg.content).slice(0, 120);
    return `${msg.timestamp ?? 0}:${msg.role}:${content}`;
  }

  /** Buffer evidence records for a single classified+scored message.
   *  Creates an unbound ledger if needed so no records are dropped before bootstrap/afterTurn. */
  private bufferEvidence(
    sessionId: string,
    msg: AgentMessage,
    truth: TruthMeta,
    sig: { score: number; signals: { roleWeight: number; informationDensity: number; novelty: number } },
  ): void {
    const ledger = this.getOrCreateLedger(sessionId);
    const key = this.messageKey(msg);
    const text = extractContent(msg);
    const category = classifyFactCategory(text, msg.role as string);

    ledger.appendTruthClassification(sessionId, key, truth.truthClass, truth.confidence);
    ledger.appendSignificance(sessionId, key, sig, category);
  }

  private getOrCreateLedger(sessionId: string): EvidenceLedger {
    let ledger = this.ledgers.get(sessionId);
    if (!ledger) {
      ledger = new EvidenceLedger();
      this.ledgers.set(sessionId, ledger);
    }
    return ledger;
  }

  /** Expose the ledger for a session (read-only access for external queries) */
  getLedger(sessionId: string): EvidenceLedger | undefined {
    return this.ledgers.get(sessionId);
  }

  // -- Bootstrap (delegate + bind ledger) -----------------------------------

  async bootstrap(
    params: Parameters<NonNullable<ContextEngine["bootstrap"]>>[0],
  ): Promise<BootstrapResult> {
    // Bind the evidence ledger to the session file path
    const ledger = this.getOrCreateLedger(params.sessionId);
    if (!ledger.isBound) ledger.bind(params.sessionFile);

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

    // Score significance with session's recent message window
    const recent = this.recentForNovelty.get(params.sessionId) ?? [];
    const sig = scoreSignificance(params.message, recent);
    this.sigStore.set(params.sessionId, params.message, sig);

    // Buffer evidence for persistence
    this.bufferEvidence(params.sessionId, params.message, meta, sig);

    // Update recent window (keep last 10)
    recent.push(params.message);
    if (recent.length > 10) recent.shift();
    this.recentForNovelty.set(params.sessionId, recent);

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

    const recent = this.recentForNovelty.get(params.sessionId) ?? [];
    for (const msg of params.messages) {
      const meta = classifyMessage(msg, turnHasTools);
      this.store.set(params.sessionId, msg, meta);

      const sig = scoreSignificance(msg, recent);
      this.sigStore.set(params.sessionId, msg, sig);

      // Buffer evidence for persistence
      this.bufferEvidence(params.sessionId, msg, meta, sig);

      recent.push(msg);
      if (recent.length > 10) recent.shift();
    }
    this.recentForNovelty.set(params.sessionId, recent);

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
    // Classify and score any messages we haven't seen (e.g. loaded from transcript on restart).
    // For historical messages we don't know turn context, so classify conservatively.
    // Only build novelty context for messages that actually need scoring (avoids O(n^2)).
    let unscoredCount = 0;
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
      if (!this.sigStore.get(params.sessionId, msg)) {
        unscoredCount++;
      }
    }

    // Only build novelty window if there are unscored messages
    if (unscoredCount > 0) {
      const recentWindow: AgentMessage[] = [];
      for (const msg of params.messages) {
        if (!this.sigStore.get(params.sessionId, msg)) {
          const sig = scoreSignificance(msg, recentWindow);
          this.sigStore.set(params.sessionId, msg, sig);
        }
        // Keep a sliding window for novelty (same as ingest path)
        recentWindow.push(msg);
        if (recentWindow.length > 10) recentWindow.shift();
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

    // Compute grounding health (uses original messages for store key lookup)
    const allMetas = this.store.allMetas(params.sessionId);
    const snapshot = computeGroundingSnapshot(allMetas);
    const healthNotice = formatGroundingHealthNotice(snapshot);
    const annotations = formatTruthAnnotations(filteredMessages, params.sessionId, this.store);

    // Annotate messages with compact timestamps for temporal awareness.
    // User messages already have gateway-injected timestamps; this adds
    // them to assistant and tool messages so the model sees a continuous
    // temporal thread ("this morning", "yesterday", etc.).
    // Done after truth annotations to avoid key lookup mismatch.
    const timestampedMessages = annotateWithTimestamps(filteredMessages);

    // Combine into systemPromptAddition
    const additions: string[] = [];
    if (result.systemPromptAddition) additions.push(result.systemPromptAddition);
    if (healthNotice) additions.push(healthNotice);
    if (annotations) additions.push(annotations);

    // Cache high-significance messages for compaction guidance.
    // Always update (even if empty) to avoid stale candidates from prior assemble.
    // Apply temporal decay so old facts don't unnecessarily consume preserve slots.
    const now = Date.now();
    const candidates = filteredMessages.filter((msg) => {
      const sig = this.sigStore.get(params.sessionId, msg);
      if (!sig) return false;
      const { multiplier } = computeMessageDecay(msg, now);
      return sig.score * multiplier >= COMPACTION_PRESERVE_THRESHOLD;
    });
    this.preserveCandidates.set(params.sessionId, candidates);

    return {
      ...result,
      messages: timestampedMessages,
      systemPromptAddition: additions.length > 0 ? additions.join("\n\n") : undefined,
    };
  }

  // -- After Turn (delegate + reset turn state) -----------------------------

  async afterTurn(
    params: Parameters<NonNullable<ContextEngine["afterTurn"]>>[0],
  ): Promise<void> {
    // Reset per-turn tool tracking for next turn
    this.turnToolState.delete(params.sessionId);

    // Bind ledger if not yet bound (first time we see sessionFile for this session)
    const ledger = this.getOrCreateLedger(params.sessionId);
    if (!ledger.isBound) ledger.bind(params.sessionFile);

    // Record grounding snapshot for trend tracking
    const allMetas = this.store.allMetas(params.sessionId);
    if (allMetas.length > 0) {
      const snapshot = computeGroundingSnapshot(allMetas);
      ledger.appendGroundingSnapshot(params.sessionId, snapshot);
    }

    // Flush buffered evidence to disk (non-blocking best-effort)
    await ledger.flush().catch(() => {});

    if (this.base.afterTurn) return this.base.afterTurn(params);
  }

  // -- Compact (significance-aware) ------------------------------------------

  async compact(params: Parameters<ContextEngine["compact"]>[0]): Promise<CompactResult> {
    // Bind ledger if not yet bound
    const ledger = this.getOrCreateLedger(params.sessionId);
    if (!ledger.isBound) ledger.bind(params.sessionFile);

    // Use cached high-significance messages for compaction guidance
    const candidates = this.preserveCandidates.get(params.sessionId) ?? [];

    const guidance = buildSignificanceGuidanceFromStores(
      candidates,
      this.store,
      this.sigStore,
      params.sessionId,
    );

    // Clear cache after use — post-compaction messages will be different
    this.preserveCandidates.delete(params.sessionId);

    // Flush buffered evidence before compaction reshapes the transcript
    await ledger.flush().catch(() => {});

    // Prepend significance guidance to customInstructions
    if (guidance) {
      const enhanced = params.customInstructions
        ? `${guidance}\n\n${params.customInstructions}`
        : guidance;
      return this.base.compact({ ...params, customInstructions: enhanced });
    }

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
    this.sigStore.clear(params.childSessionKey);
    this.turnToolState.delete(params.childSessionKey);
    this.preserveCandidates.delete(params.childSessionKey);
    this.recentForNovelty.delete(params.childSessionKey);
    // Flush and dispose the child session's ledger
    const ledger = this.ledgers.get(params.childSessionKey);
    if (ledger) {
      await ledger.flush().catch(() => {});
      ledger.dispose();
      this.ledgers.delete(params.childSessionKey);
    }
    if (this.base.onSubagentEnded) return this.base.onSubagentEnded(params);
  }

  // -- Dispose (delegate + cleanup) -----------------------------------------

  async dispose(): Promise<void> {
    // Flush all ledgers before disposing
    for (const ledger of this.ledgers.values()) {
      await ledger.flush().catch(() => {});
      ledger.dispose();
    }
    this.ledgers.clear();
    // Clear all internal state so a disposed engine doesn't leak data
    this.turnToolState.clear();
    this.recentForNovelty.clear();
    this.preserveCandidates.clear();
    // Stores don't have a global clear, but they'll be GC'd with the engine
    if (this.base.dispose) await this.base.dispose();
  }
}

// ---------------------------------------------------------------------------
// Public API
//
// Registration happens in init.ts via ensureContextEnginesInitialized().
// The TruthBoundaryContextEngine wraps LegacyContextEngine as a singleton
// under the "legacy" slot, activating all cognitive features by default.
// ---------------------------------------------------------------------------

export { formatTruthAnnotations, importanceMultiplier, applyImportanceFilter };

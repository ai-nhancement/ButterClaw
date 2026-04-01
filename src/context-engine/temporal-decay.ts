import type { AgentMessage } from "@mariozechner/pi-agent-core";

// ---------------------------------------------------------------------------
// Fact category types
// ---------------------------------------------------------------------------

/**
 * Temporal decay categories for facts, inspired by AiMe's temporal scoping.
 *
 * Each category has a different half-life — the time after which the fact's
 * effective significance drops to 50% of its original value.
 *
 *   permanent  — name, DOB, family relationships (no decay)
 *   long       — employer, occupation, contact info (18-month half-life)
 *   medium     — preferences, location (12-month half-life)
 *   short      — current projects, active concerns, decisions (6-month half-life)
 *   momentary  — mood, temporary state (1-day half-life)
 */
export type FactCategory = "permanent" | "long" | "medium" | "short" | "momentary";

// ---------------------------------------------------------------------------
// Half-lives in milliseconds
// ---------------------------------------------------------------------------

const MS_DAY = 24 * 60 * 60 * 1000;
const MS_MONTH = 30 * MS_DAY;

/** null = no decay (permanent) */
const HALF_LIVES: Record<FactCategory, number | null> = {
  permanent: null,
  long: 18 * MS_MONTH,    // 18 months
  medium: 12 * MS_MONTH,  // 12 months
  short: 6 * MS_MONTH,    // 6 months
  momentary: 1 * MS_DAY,  // 1 day
};

// ---------------------------------------------------------------------------
// Fact category detection patterns
// ---------------------------------------------------------------------------

// Permanent: identity, family, DOB — facts that don't change
const PERMANENT_PATTERNS = [
  /\bmy\s+name\s+is\b/i,
  /\bmy\s+(?:wife|husband|partner|daughter|son|kid|child|mom|dad|mother|father|sister|brother)\b/i,
  /\bborn\s+(?:in|on)\b/i,
  /\bmy\s+birthday\b/i,
  /\bI\s+was\s+born\b/i,
];

// Long: employment, occupation, contact info — change infrequently
const LONG_PATTERNS = [
  /\bI\s+work\s+(?:at|for)\b/i,
  /\bI\s+am\s+a\s+(?:software|data|product|project|marketing|sales|senior|junior|lead|staff|principal)\b/i,
  /\bmy\s+(?:job|role|position|title)\b/i,
  /\bmy\s+(?:email|phone|address)\b/i,
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  /\+?\d[\d\s\-().]{7,}\d/,
];

// Medium: preferences, location — change occasionally
const MEDIUM_PATTERNS = [
  /\bI\s+(?:live|moved)\s+(?:in|to)\b/i,
  /\bmy\s+(?:house|apartment|home|place)\b/i,
  /\bI\s+(?:like|love|prefer|enjoy|hate|dislike)\b/i,
  /\bmy\s+favorite\b/i,
  /\bI\s+(?:always|usually|normally|typically)\b/i,
];

// Short: active projects, decisions, deadlines — change regularly
const SHORT_PATTERNS = [
  /\b(?:working\s+on|building|developing|writing|planning)\b/i,
  /\b(?:decided|agreed|committed|promised|confirmed|approved|scheduled|booked|cancelled)\b/i,
  /\b(?:deadline|due\s+(?:date|by)|must\s+finish|need\s+to\s+(?:finish|complete|submit))\b/i,
  /\b(?:current|ongoing|active)\s+(?:project|task|sprint|initiative)\b/i,
  /\b(?:will\s+(?:do|send|call|schedule|finish|start|complete))\b/i,
];

// Momentary: mood, temporary state — ephemeral
const MOMENTARY_PATTERNS = [
  /\bI\s+(?:feel|felt|am\s+feeling)\b/i,
  /\bI(?:'m| am)\s+(?:tired|exhausted|frustrated|annoyed|happy|excited|stressed|anxious|bored|hungry|sick)\b/i,
  /\b(?:right\s+now|at\s+the\s+moment|currently|today)\s+I\b/i,
  /\bI(?:'m| am)\s+(?:currently|right\s+now|at\s+the\s+moment)\b/i,
  /\btoday\s+(?:I|we|my)\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

// ---------------------------------------------------------------------------
// Fact category classification
// ---------------------------------------------------------------------------

/**
 * Classify the most applicable temporal decay category for a message.
 *
 * Checks patterns from most permanent to most momentary. Returns the first
 * match, since a message like "My wife's name is Sarah and I'm tired" should
 * be treated as permanent (the dominant fact is identity-level).
 *
 * Messages with no detected patterns default to "medium" for user messages
 * and "short" for everything else — a conservative middle ground.
 */
export function classifyFactCategory(text: string, role: string): FactCategory {
  if (!text || text.length < 5) {
    return role === "user" ? "medium" : "short";
  }

  // Check from most permanent to most momentary.
  // First match wins — prioritizes durable facts.
  if (matchesAny(text, PERMANENT_PATTERNS)) return "permanent";
  if (matchesAny(text, LONG_PATTERNS)) return "long";
  if (matchesAny(text, MEDIUM_PATTERNS)) return "medium";
  if (matchesAny(text, MOMENTARY_PATTERNS)) return "momentary";
  if (matchesAny(text, SHORT_PATTERNS)) return "short";

  // No pattern matched — default by role
  return role === "user" ? "medium" : "short";
}

// ---------------------------------------------------------------------------
// Decay multiplier computation
// ---------------------------------------------------------------------------

/**
 * Compute a decay multiplier (0.0–1.0) based on the age of a message and
 * its fact category.
 *
 * Uses exponential decay: `multiplier = 2^(-age / halfLife)`
 *
 * - At age = 0, multiplier = 1.0 (no decay)
 * - At age = halfLife, multiplier = 0.5
 * - At age = 2×halfLife, multiplier = 0.25
 *
 * Permanent facts always return 1.0.
 * Clamps to a floor of 0.05 — even very old facts retain minimal weight
 * to avoid complete information loss.
 */
export function computeDecayMultiplier(
  timestampMs: number,
  nowMs: number,
  category: FactCategory,
): number {
  const halfLife = HALF_LIVES[category];

  // Permanent facts never decay
  if (halfLife === null) return 1.0;

  const age = nowMs - timestampMs;

  // Future timestamps or zero age = no decay
  if (age <= 0) return 1.0;

  const multiplier = Math.pow(2, -age / halfLife);

  // Floor at 0.05 — even old facts retain minimal presence
  return Math.max(0.05, Math.round(multiplier * 1000) / 1000);
}

// ---------------------------------------------------------------------------
// Convenience: compute decay for a message
// ---------------------------------------------------------------------------

/**
 * Extract text content from a message (same logic as significance-scorer).
 */
function extractText(msg: AgentMessage): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((p: { type?: string }) => p.type === "text")
      .map((p: { text?: string }) => p.text ?? "")
      .join(" ");
  }
  return "";
}

/**
 * Compute the temporal decay multiplier for a message, combining
 * fact category detection with age-based decay.
 *
 * Returns 1.0 if the message has no timestamp.
 */
export function computeMessageDecay(
  msg: AgentMessage,
  nowMs?: number,
): { category: FactCategory; multiplier: number } {
  const now = nowMs ?? Date.now();
  const text = extractText(msg);
  const role = msg.role as string;
  const category = classifyFactCategory(text, role);
  // Timestamps may arrive as ISO strings from transcript reloads — coerce to number
  const rawTs = msg.timestamp;
  const timestamp =
    rawTs == null ? now
    : typeof rawTs === "number" ? rawTs
    : typeof rawTs === "string" ? new Date(rawTs).getTime() || now
    : now;
  const multiplier = computeDecayMultiplier(timestamp, now, category);
  return { category, multiplier };
}

// ---------------------------------------------------------------------------
// Compaction decay label
// ---------------------------------------------------------------------------

/**
 * Returns a label for significantly decayed facts in compaction guidance.
 * Only labels facts that have lost substantial weight.
 */
export function decayLabel(multiplier: number): string {
  if (multiplier >= 0.8) return "";        // Fresh — no label needed
  if (multiplier >= 0.4) return "[AGING]";  // Noticeable decay
  return "[STALE]";                          // Substantially decayed
}

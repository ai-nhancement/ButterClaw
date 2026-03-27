import type { AgentMessage } from "@mariozechner/pi-agent-core";

// ---------------------------------------------------------------------------
// Significance scoring types
// ---------------------------------------------------------------------------

export interface SignificanceMeta {
  /** Overall significance score 0.0–1.0 */
  score: number;
  /** Which signals contributed to the score */
  signals: SignalBreakdown;
}

export interface SignalBreakdown {
  /** 0.0–1.0: higher for user messages and tool results */
  roleWeight: number;
  /** 0.0–1.0: names, dates, numbers, decisions, commitments */
  informationDensity: number;
  /** 0.0–1.0: new content vs repetition of prior messages */
  novelty: number;
}

// ---------------------------------------------------------------------------
// Signal weights (sum to 1.0)
// ---------------------------------------------------------------------------

const W_ROLE = 0.30;
const W_DENSITY = 0.45;
const W_NOVELTY = 0.25;

// ---------------------------------------------------------------------------
// Role weight
// ---------------------------------------------------------------------------

function scoreRole(msg: AgentMessage): number {
  const role = msg.role as string;
  switch (role) {
    case "user": return 0.9;     // User statements are high value
    case "tool": return 0.8;     // Tool results are verifiable facts
    case "assistant": return 0.4; // Assistant output is lower — it's generated, not stated
    default: return 0.2;         // System, compaction summaries
  }
}

// ---------------------------------------------------------------------------
// Information density — pattern detection, no LLM
// ---------------------------------------------------------------------------

// Names: capitalized word sequences (2+ words, not sentence-start)
const NAME_PATTERN = /(?:^|[.!?]\s+)?\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;

// Dates: various formats
const DATE_PATTERN = /\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:,?\s+\d{4})?|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b|(?:today|tomorrow|yesterday|next\s+week|last\s+week|this\s+morning|tonight))\b/gi;

// Numbers with units or currency
const QUANTITY_PATTERN = /\b\d+(?:\.\d+)?(?:\s*(?:%|dollars?|euros?|pounds?|USD|EUR|GBP|\$|€|£|hrs?|hours?|mins?|minutes?|days?|weeks?|months?|years?|kg|lbs?|miles?|km|GB|MB|TB))\b/gi;

// Decisions and commitments
const DECISION_WORDS = /\b(?:decided|agreed|committed|promised|confirmed|approved|scheduled|booked|cancelled|deadline|must|need\s+to|going\s+to|will\s+(?:do|send|call|schedule|finish|start|complete)|plan\s+(?:to|is)|assigned|delegated|responsible)\b/gi;

// Personal facts (identity-relevant)
const PERSONAL_PATTERN = /\b(?:my\s+(?:name|wife|husband|partner|daughter|son|kid|child|mom|dad|mother|father|sister|brother|birthday|address|email|phone|job|boss|doctor|dentist|dog|cat)|I\s+(?:work|live|am|was|have|got|started|moved|joined)|born\s+(?:in|on))\b/gi;

// Email addresses, phone numbers, URLs
const CONTACT_PATTERN = /(?:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|\+?\d[\d\s\-().]{7,}\d|https?:\/\/\S+)/g;

function scoreInformationDensity(text: string): number {
  if (!text || text.length < 5) return 0.0;

  let signals = 0;
  let maxSignals = 6; // Normalize against this

  // Count pattern matches (binary: present or not, to avoid over-counting)
  if (NAME_PATTERN.test(text)) signals++;
  NAME_PATTERN.lastIndex = 0;

  if (DATE_PATTERN.test(text)) signals++;
  DATE_PATTERN.lastIndex = 0;

  if (QUANTITY_PATTERN.test(text)) signals++;
  QUANTITY_PATTERN.lastIndex = 0;

  if (DECISION_WORDS.test(text)) signals++;
  DECISION_WORDS.lastIndex = 0;

  if (PERSONAL_PATTERN.test(text)) signals++;
  PERSONAL_PATTERN.lastIndex = 0;

  if (CONTACT_PATTERN.test(text)) signals++;
  CONTACT_PATTERN.lastIndex = 0;

  return Math.min(1.0, signals / (maxSignals * 0.5)); // 3 signals = 1.0
}

// ---------------------------------------------------------------------------
// Novelty — word overlap with recent messages
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "must",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her",
  "us", "them", "my", "your", "his", "its", "our", "their",
  "this", "that", "these", "those", "what", "which", "who", "whom",
  "and", "or", "but", "if", "then", "else", "when", "where", "how",
  "not", "no", "nor", "so", "too", "very", "just", "also",
  "in", "on", "at", "to", "for", "of", "with", "by", "from", "about",
  "into", "through", "during", "before", "after", "above", "below",
  "up", "down", "out", "off", "over", "under", "again", "further",
  "than", "more", "most", "other", "some", "any", "all", "each",
  "ok", "okay", "yes", "no", "yeah", "sure", "thanks", "thank",
  "please", "hi", "hello", "hey", "well", "like", "know", "think",
  "get", "got", "go", "going", "come", "make", "take", "see", "look",
  "here", "there", "now", "still", "already", "yet",
]);

function extractContentWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  return new Set(words.filter((w) => !STOP_WORDS.has(w)));
}

function scoreNovelty(text: string, recentTexts: string[]): number {
  if (recentTexts.length === 0) return 1.0; // First message is fully novel

  const currentWords = extractContentWords(text);
  if (currentWords.size === 0) return 0.3; // Very short / no content words

  // Combine recent messages into one word pool
  const recentWords = new Set<string>();
  for (const recent of recentTexts) {
    for (const word of extractContentWords(recent)) {
      recentWords.add(word);
    }
  }

  if (recentWords.size === 0) return 1.0;

  // What fraction of current words are new?
  let newWords = 0;
  for (const word of currentWords) {
    if (!recentWords.has(word)) newWords++;
  }

  return currentWords.size > 0 ? newWords / currentWords.size : 0.5;
}

// ---------------------------------------------------------------------------
// Content extraction (shared with truth-boundary)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

/** Number of recent messages to compare against for novelty */
const NOVELTY_WINDOW = 10;

/**
 * Score the significance of a single message.
 *
 * Combines three signals:
 * - Role weight (0.30): user and tool messages score higher
 * - Information density (0.45): names, dates, decisions, personal facts
 * - Novelty (0.25): new content vs repetition
 *
 * No LLM calls. Pure pattern detection.
 */
export function scoreSignificance(
  msg: AgentMessage,
  recentMessages: AgentMessage[],
): SignificanceMeta {
  const text = extractText(msg);

  const roleWeight = scoreRole(msg);
  const informationDensity = scoreInformationDensity(text);

  // Build recent text window for novelty comparison
  const recentTexts = recentMessages
    .slice(-NOVELTY_WINDOW)
    .map(extractText)
    .filter((t) => t.length > 0);
  const novelty = scoreNovelty(text, recentTexts);

  const score = W_ROLE * roleWeight + W_DENSITY * informationDensity + W_NOVELTY * novelty;

  return {
    score: Math.round(score * 1000) / 1000, // 3 decimal precision
    signals: { roleWeight, informationDensity, novelty },
  };
}

// ---------------------------------------------------------------------------
// Significance store (per-session, in-memory, bounded)
// ---------------------------------------------------------------------------

const MAX_SIG_ENTRIES = 500;

export class SignificanceStore {
  private refMap = new WeakMap<AgentMessage, SignificanceMeta>();
  private sessions = new Map<string, Map<string, SignificanceMeta>>();
  private sessionOrder = new Map<string, string[]>();

  private contentKey(msg: AgentMessage): string {
    const content =
      typeof msg.content === "string"
        ? msg.content.slice(0, 120)
        : JSON.stringify(msg.content).slice(0, 120);
    return `${msg.timestamp ?? 0}:${msg.role}:${content}`;
  }

  set(sessionId: string, msg: AgentMessage, meta: SignificanceMeta): void {
    this.refMap.set(msg, meta);

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

    if (order!.length > MAX_SIG_ENTRIES) {
      const excess = order!.length - MAX_SIG_ENTRIES;
      for (let i = 0; i < excess; i++) {
        keyMap.delete(order![i]);
      }
      order!.splice(0, excess);
    }
  }

  get(sessionId: string, msg: AgentMessage): SignificanceMeta | undefined {
    // Only use refMap if the session still exists (clear() removes session but can't clean WeakMap)
    const keyMap = this.sessions.get(sessionId);
    if (!keyMap) return undefined;

    const ref = this.refMap.get(msg);
    if (ref) return ref;
    return keyMap.get(this.contentKey(msg));
  }

  getScore(sessionId: string, msg: AgentMessage): number {
    return this.get(sessionId, msg)?.score ?? 0.5;
  }

  allScores(sessionId: string): number[] {
    const keyMap = this.sessions.get(sessionId);
    return keyMap ? Array.from(keyMap.values()).map((m) => m.score) : [];
  }

  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.sessionOrder.delete(sessionId);
  }
}

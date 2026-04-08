/**
 * Adaptive Persona Engine
 *
 * Replaces the static SOUL.md approach with a dynamic, user-tailored persona
 * that starts from setup-configured traits and evolves through conversation.
 *
 * 10 traits total:
 *   - voice (enum: male/female/neutral)
 *   - 9 numeric traits on a 0→1 scale with named poles
 *
 * Adaptation uses exponential moving average (EMA) so recent signals weigh
 * more but the persona doesn't swing wildly. Trait snapshots persist via the
 * evidence ledger for cross-session continuity.
 *
 * No LLM calls — all signal detection is pattern-based.
 */

// ---------------------------------------------------------------------------
// Trait definitions
// ---------------------------------------------------------------------------

export type PersonaVoice = "male" | "female" | "neutral";

export interface NumericTraitDef {
  id: string;
  label: string;
  lowPole: string;   // value = 0.0
  highPole: string;   // value = 1.0
  defaultValue: number;
}

/** The 9 numeric traits with human-readable poles. */
export const NUMERIC_TRAITS: readonly NumericTraitDef[] = [
  { id: "formality",     label: "Formality",       lowPole: "professional", highPole: "casual",        defaultValue: 0.5 },
  { id: "warmth",        label: "Warmth",          lowPole: "reserved",     highPole: "warm",          defaultValue: 0.6 },
  { id: "humor",         label: "Humor",           lowPole: "serious",      highPole: "playful",       defaultValue: 0.4 },
  { id: "verbosity",     label: "Verbosity",       lowPole: "concise",      highPole: "thorough",      defaultValue: 0.5 },
  { id: "directness",    label: "Directness",      lowPole: "diplomatic",   highPole: "blunt",         defaultValue: 0.5 },
  { id: "encouragement", label: "Encouragement",   lowPole: "matter-of-fact", highPole: "cheerleader", defaultValue: 0.4 },
  { id: "depth",         label: "Technical Depth",  lowPole: "simplified",   highPole: "deep-dive",     defaultValue: 0.5 },
  { id: "proactivity",   label: "Proactivity",     lowPole: "reactive",     highPole: "anticipatory",  defaultValue: 0.4 },
  { id: "expressiveness", label: "Expressiveness", lowPole: "text-only",    highPole: "emoji-rich",    defaultValue: 0.2 },
] as const;

export const TRAIT_IDS = NUMERIC_TRAITS.map((t) => t.id);

// ---------------------------------------------------------------------------
// Persona state
// ---------------------------------------------------------------------------

export interface PersonaTraits {
  voice: PersonaVoice;
  /** Numeric trait values keyed by trait id, each 0.0–1.0 */
  scores: Record<string, number>;
}

export function createDefaultTraits(): PersonaTraits {
  const scores: Record<string, number> = {};
  for (const t of NUMERIC_TRAITS) {
    scores[t.id] = t.defaultValue;
  }
  return { voice: "neutral", scores };
}

/**
 * Create traits from setup choices.
 * Setup passes 3-way picks: 0.0 (low pole), 0.5 (balanced), 1.0 (high pole).
 */
export function createTraitsFromSetup(
  voice: PersonaVoice,
  picks: Partial<Record<string, number>>,
): PersonaTraits {
  const traits = createDefaultTraits();
  traits.voice = voice;
  for (const [id, value] of Object.entries(picks)) {
    if (id in traits.scores && typeof value === "number") {
      traits.scores[id] = clamp(value);
    }
  }
  return traits;
}

// ---------------------------------------------------------------------------
// Signal detection — pattern-based, no LLM
// ---------------------------------------------------------------------------

export interface TraitNudge {
  traitId: string;
  /** Positive = toward high pole, negative = toward low pole */
  delta: number;
}

interface SignalPattern {
  pattern: RegExp;
  nudges: TraitNudge[];
}

const SIGNAL_PATTERNS: SignalPattern[] = [
  // Humor signals (text)
  { pattern: /\b(lol|lmao|rofl|haha|hehe)\b/i,
    nudges: [{ traitId: "humor", delta: 0.08 }] },
  // Humor signals (emoji — no \b, emoji aren't word chars)
  { pattern: /[😂🤣😆]/u,
    nudges: [{ traitId: "humor", delta: 0.08 }] },
  { pattern: /\b(not funny|stop joking|be serious|no jokes)\b/i,
    nudges: [{ traitId: "humor", delta: -0.12 }] },

  // Verbosity signals
  { pattern: /\b(too verbose|too long|tldr|tl;dr|shorter|brevity|keep it short)\b/i,
    nudges: [{ traitId: "verbosity", delta: -0.12 }] },
  { pattern: /\b(explain more|elaborate|go deeper|more detail|tell me more|expand on)\b/i,
    nudges: [{ traitId: "verbosity", delta: 0.08 }, { traitId: "depth", delta: 0.08 }] },

  // Directness signals
  { pattern: /\b(get to the point|just tell me|straight answer|bottom line|cut to the chase)\b/i,
    nudges: [{ traitId: "directness", delta: 0.10 }, { traitId: "verbosity", delta: -0.08 }] },

  // Formality signals
  { pattern: /\b(be more professional|formal|corporate|business)\b/i,
    nudges: [{ traitId: "formality", delta: -0.12 }] },
  { pattern: /\b(relax|chill|loosen up|don't be so stiff|casual)\b/i,
    nudges: [{ traitId: "formality", delta: 0.10 }] },

  // Warmth signals
  { pattern: /\b(good morning|good evening|good night|hey there|how are you|thanks so much)\b/i,
    nudges: [{ traitId: "warmth", delta: 0.05 }] },
  { pattern: /\b(stop being (so )?(nice|friendly)|just focus|no chitchat)\b/i,
    nudges: [{ traitId: "warmth", delta: -0.10 }] },

  // Encouragement signals
  { pattern: /\b(great|perfect|love it|awesome|nice work|well done|exactly)\b/i,
    nudges: [{ traitId: "encouragement", delta: 0.04 }] },
  { pattern: /\b(too much|calm down|tone it down|over the top|stop cheerleading)\b/i,
    nudges: [{ traitId: "encouragement", delta: -0.10 }] },

  // Depth signals
  { pattern: /\b(too technical|simpler|dumb it down|eli5|keep it simple)\b/i,
    nudges: [{ traitId: "depth", delta: -0.12 }] },
  { pattern: /\b(be more technical|show me the code|implementation details|under the hood)\b/i,
    nudges: [{ traitId: "depth", delta: 0.10 }] },

  // Proactivity signals
  { pattern: /\b(don't suggest|just do what i ask|only what i asked|stop suggesting)\b/i,
    nudges: [{ traitId: "proactivity", delta: -0.12 }] },
  { pattern: /\b(what else|anything else|what would you suggest|your thoughts)\b/i,
    nudges: [{ traitId: "proactivity", delta: 0.08 }] },

  // Expressiveness signals (emoji usage by user → slight bump)
  { pattern: /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}]/u,
    nudges: [{ traitId: "expressiveness", delta: 0.03 }] },
  { pattern: /\b(no emoji|stop emoji|text only|no emojis)\b/i,
    nudges: [{ traitId: "expressiveness", delta: -0.15 }] },
];

/**
 * Detect trait signals in a user message.
 * Returns all matching nudges (multiple patterns can fire).
 */
export function detectSignals(text: string): TraitNudge[] {
  const nudges: TraitNudge[] = [];
  for (const sp of SIGNAL_PATTERNS) {
    if (sp.pattern.test(text)) {
      nudges.push(...sp.nudges);
    }
  }
  return nudges;
}

// ---------------------------------------------------------------------------
// EMA adaptation
// ---------------------------------------------------------------------------

/** Smoothing factor: 0.15 = responsive but not jerky */
const DEFAULT_ALPHA = 0.15;

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Apply nudges to persona traits using exponential moving average.
 * Mutates `traits.scores` in place for efficiency.
 *
 * For each nudge, the target value is either 1.0 (positive delta) or
 * 0.0 (negative delta), and we blend toward that target by |delta| * alpha.
 */
export function applyNudges(
  traits: PersonaTraits,
  nudges: TraitNudge[],
  alpha: number = DEFAULT_ALPHA,
): void {
  for (const nudge of nudges) {
    const current = traits.scores[nudge.traitId];
    if (current === undefined) continue;

    // Blend: move current toward the nudge direction
    const effectiveAlpha = Math.abs(nudge.delta) * alpha / DEFAULT_ALPHA;
    const target = nudge.delta > 0 ? 1.0 : 0.0;
    traits.scores[nudge.traitId] = clamp(
      current + (target - current) * effectiveAlpha,
    );
  }
}

// ---------------------------------------------------------------------------
// Prompt generation — convert traits to system prompt guidance
// ---------------------------------------------------------------------------

/**
 * Generate system prompt persona guidance from current trait values.
 * This replaces the static SOUL.md injection with dynamic, adaptive guidance.
 */
export function generatePersonaPrompt(traits: PersonaTraits): string {
  const lines: string[] = ["## Persona"];

  // Voice
  const voiceMap: Record<PersonaVoice, string> = {
    male: "Use a masculine communication style.",
    female: "Use a feminine communication style.",
    neutral: "Use a gender-neutral communication style.",
  };
  lines.push(voiceMap[traits.voice]);

  // Generate guidance for each numeric trait based on its position on the scale
  for (const def of NUMERIC_TRAITS) {
    const value = traits.scores[def.id] ?? def.defaultValue;
    const guidance = traitGuidance(def, value);
    if (guidance) lines.push(guidance);
  }

  lines.push("");
  lines.push(
    "These traits reflect the user's preferences and adapt over time. " +
    "Let them guide your tone and style naturally — don't announce or reference them.",
  );

  return lines.join("\n");
}

/** Map a trait value to a natural-language style directive. */
function traitGuidance(def: NumericTraitDef, value: number): string {
  // Only emit guidance when the trait is meaningfully away from dead center
  const deviation = Math.abs(value - 0.5);
  if (deviation < 0.1) return ""; // near-center: no strong preference

  const isHigh = value > 0.5;
  const strength = deviation >= 0.3 ? "strongly" : "somewhat";

  const guidance: Record<string, [string, string]> = {
    formality:     [`Be ${strength} professional and formal in tone.`,
                    `Be ${strength} casual and relaxed in tone.`],
    warmth:        [`Be ${strength} reserved and neutral in emotional expression.`,
                    `Be ${strength} warm, friendly, and personable.`],
    humor:         [`Keep things ${strength} serious and straightforward.`,
                    `Be ${strength} playful and use humor when appropriate.`],
    verbosity:     [`Keep responses ${strength} concise and brief.`,
                    `Give ${strength} thorough, detailed responses.`],
    directness:    [`Be ${strength} diplomatic and tactful.`,
                    `Be ${strength} direct and blunt.`],
    encouragement: [`Be ${strength} matter-of-fact — skip praise and cheerleading.`,
                    `Be ${strength} encouraging — celebrate wins and progress.`],
    depth:         [`Keep explanations ${strength} simplified and accessible.`,
                    `Go ${strength} deep into technical details.`],
    proactivity:   [`${strength === "strongly" ? "Only" : "Mostly"} do what's asked — don't volunteer suggestions.`,
                    `${strength === "strongly" ? "Actively" : "Sometimes"} suggest next steps and improvements.`],
    expressiveness:[`Avoid emojis — keep it text-only.`,
                    `Use emojis ${strength === "strongly" ? "freely" : "occasionally"} to add expression.`],
  };

  const pair = guidance[def.id];
  if (!pair) return "";
  return isHigh ? pair[1] : pair[0];
}

// ---------------------------------------------------------------------------
// Serialization for evidence ledger
// ---------------------------------------------------------------------------

export interface PersonaSnapshot {
  voice: PersonaVoice;
  scores: Record<string, number>;
  /** Number of signal observations that shaped these scores */
  observationCount: number;
}

export function toSnapshot(traits: PersonaTraits, observationCount: number): PersonaSnapshot {
  return {
    voice: traits.voice,
    scores: { ...traits.scores },
    observationCount,
  };
}

export function fromSnapshot(snapshot: PersonaSnapshot): PersonaTraits {
  // Rebuild from snapshot, filling any missing traits with defaults
  const defaults = createDefaultTraits();
  return {
    voice: snapshot.voice ?? defaults.voice,
    scores: { ...defaults.scores, ...snapshot.scores },
  };
}

// ---------------------------------------------------------------------------
// PersonaEngine — stateful per-session manager
// ---------------------------------------------------------------------------

/**
 * Manages the adaptive persona for a single session.
 * Observes user messages for signals, nudges traits, and generates prompts.
 */
export class PersonaEngine {
  private traits: PersonaTraits;
  private observationCount = 0;
  private dirty = false;

  constructor(initial?: PersonaTraits) {
    this.traits = initial ? {
      voice: initial.voice,
      scores: { ...initial.scores },
    } : createDefaultTraits();
  }

  /** Current trait values (read-only copy) */
  getTraits(): PersonaTraits {
    return { voice: this.traits.voice, scores: { ...this.traits.scores } };
  }

  /** Whether traits have changed since last snapshot */
  get isDirty(): boolean {
    return this.dirty;
  }

  /** Total observations processed */
  get observations(): number {
    return this.observationCount;
  }

  /**
   * Observe a user message for persona-relevant signals.
   * Call this on every user message during ingest.
   */
  observe(userMessage: string): TraitNudge[] {
    const nudges = detectSignals(userMessage);
    if (nudges.length > 0) {
      applyNudges(this.traits, nudges);
      this.observationCount++;
      this.dirty = true;
    }
    return nudges;
  }

  /** Generate the current persona prompt for system prompt injection. */
  prompt(): string {
    return generatePersonaPrompt(this.traits);
  }

  /** Take a snapshot for persistence. Clears the dirty flag. */
  snapshot(): PersonaSnapshot {
    this.dirty = false;
    return toSnapshot(this.traits, this.observationCount);
  }

  /** Restore from a persisted snapshot. */
  restore(snapshot: PersonaSnapshot): void {
    this.traits = fromSnapshot(snapshot);
    this.observationCount = snapshot.observationCount ?? 0;
    this.dirty = false;
  }
}

/**
 * Persona configuration — adaptive personality traits set during setup
 * and evolved through conversation via signal detection + EMA smoothing.
 */
export type PersonaConfig = {
  /** Communication voice: "male", "female", or "neutral". */
  voice?: "male" | "female" | "neutral";
  /** Numeric trait scores (0.0–1.0) keyed by trait id. */
  traits?: Record<string, number>;
};

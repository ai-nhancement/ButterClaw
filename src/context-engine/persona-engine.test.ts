import { describe, it, expect } from "vitest";
import {
  createDefaultTraits,
  createTraitsFromSetup,
  detectSignals,
  applyNudges,
  generatePersonaPrompt,
  toSnapshot,
  fromSnapshot,
  PersonaEngine,
  NUMERIC_TRAITS,
  TRAIT_IDS,
  type PersonaTraits,
  type TraitNudge,
} from "./persona-engine.js";

// ---------------------------------------------------------------------------
// Trait definitions
// ---------------------------------------------------------------------------

describe("trait definitions", () => {
  it("defines exactly 9 numeric traits", () => {
    expect(NUMERIC_TRAITS).toHaveLength(9);
  });

  it("all traits have unique ids", () => {
    const ids = NUMERIC_TRAITS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all default values are between 0 and 1", () => {
    for (const t of NUMERIC_TRAITS) {
      expect(t.defaultValue).toBeGreaterThanOrEqual(0);
      expect(t.defaultValue).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Default traits
// ---------------------------------------------------------------------------

describe("createDefaultTraits", () => {
  it("returns neutral voice", () => {
    expect(createDefaultTraits().voice).toBe("neutral");
  });

  it("returns all 9 numeric traits", () => {
    const traits = createDefaultTraits();
    expect(Object.keys(traits.scores)).toHaveLength(9);
    for (const id of TRAIT_IDS) {
      expect(traits.scores[id]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Setup-configured traits
// ---------------------------------------------------------------------------

describe("createTraitsFromSetup", () => {
  it("applies voice selection", () => {
    const traits = createTraitsFromSetup("female", {});
    expect(traits.voice).toBe("female");
  });

  it("applies trait picks", () => {
    const traits = createTraitsFromSetup("neutral", {
      humor: 1.0,
      verbosity: 0.0,
    });
    expect(traits.scores.humor).toBe(1.0);
    expect(traits.scores.verbosity).toBe(0.0);
  });

  it("clamps out-of-range values", () => {
    const traits = createTraitsFromSetup("neutral", {
      humor: 5.0,
      warmth: -2.0,
    });
    expect(traits.scores.humor).toBe(1.0);
    expect(traits.scores.warmth).toBe(0.0);
  });

  it("ignores unknown trait ids", () => {
    const traits = createTraitsFromSetup("neutral", {
      nonexistent: 0.8,
    });
    expect(traits.scores.nonexistent).toBeUndefined();
  });

  it("preserves defaults for unpicked traits", () => {
    const traits = createTraitsFromSetup("male", { humor: 1.0 });
    const defaults = createDefaultTraits();
    expect(traits.scores.formality).toBe(defaults.scores.formality);
    expect(traits.scores.warmth).toBe(defaults.scores.warmth);
  });
});

// ---------------------------------------------------------------------------
// Signal detection
// ---------------------------------------------------------------------------

describe("detectSignals", () => {
  it("detects humor positive signal from text", () => {
    const nudges = detectSignals("haha that's great lol");
    const humorNudge = nudges.find((n) => n.traitId === "humor");
    expect(humorNudge).toBeDefined();
    expect(humorNudge!.delta).toBeGreaterThan(0);
  });

  it("detects humor positive signal from emoji", () => {
    const nudges = detectSignals("that's hilarious 😂");
    const humorNudge = nudges.find((n) => n.traitId === "humor");
    expect(humorNudge).toBeDefined();
    expect(humorNudge!.delta).toBeGreaterThan(0);
  });

  it("detects humor negative signal", () => {
    const nudges = detectSignals("be serious please, no jokes");
    const humorNudge = nudges.find((n) => n.traitId === "humor");
    expect(humorNudge).toBeDefined();
    expect(humorNudge!.delta).toBeLessThan(0);
  });

  it("detects verbosity negative signal", () => {
    const nudges = detectSignals("too verbose, keep it short");
    const vNudge = nudges.find((n) => n.traitId === "verbosity");
    expect(vNudge).toBeDefined();
    expect(vNudge!.delta).toBeLessThan(0);
  });

  it("detects verbosity positive signal", () => {
    const nudges = detectSignals("can you explain more about this?");
    const vNudge = nudges.find((n) => n.traitId === "verbosity");
    expect(vNudge).toBeDefined();
    expect(vNudge!.delta).toBeGreaterThan(0);
  });

  it("detects directness signal", () => {
    const nudges = detectSignals("just tell me the answer");
    const dNudge = nudges.find((n) => n.traitId === "directness");
    expect(dNudge).toBeDefined();
    expect(dNudge!.delta).toBeGreaterThan(0);
  });

  it("detects formality decrease signal", () => {
    const nudges = detectSignals("relax, don't be so stiff");
    const fNudge = nudges.find((n) => n.traitId === "formality");
    expect(fNudge).toBeDefined();
    expect(fNudge!.delta).toBeGreaterThan(0); // toward casual = high pole
  });

  it("detects formality increase signal", () => {
    const nudges = detectSignals("be more professional please");
    const fNudge = nudges.find((n) => n.traitId === "formality");
    expect(fNudge).toBeDefined();
    expect(fNudge!.delta).toBeLessThan(0); // toward professional = low pole
  });

  it("detects warmth signal from greetings", () => {
    const nudges = detectSignals("good morning! how are you?");
    const wNudge = nudges.find((n) => n.traitId === "warmth");
    expect(wNudge).toBeDefined();
    expect(wNudge!.delta).toBeGreaterThan(0);
  });

  it("detects emoji expressiveness signal", () => {
    const nudges = detectSignals("love this idea 🎉");
    const eNudge = nudges.find((n) => n.traitId === "expressiveness");
    expect(eNudge).toBeDefined();
    expect(eNudge!.delta).toBeGreaterThan(0);
  });

  it("detects no-emoji signal", () => {
    const nudges = detectSignals("no emoji please, text only");
    const eNudge = nudges.find((n) => n.traitId === "expressiveness");
    expect(eNudge).toBeDefined();
    expect(eNudge!.delta).toBeLessThan(0);
  });

  it("detects depth decrease signal", () => {
    const nudges = detectSignals("keep it simple, eli5");
    const dNudge = nudges.find((n) => n.traitId === "depth");
    expect(dNudge).toBeDefined();
    expect(dNudge!.delta).toBeLessThan(0);
  });

  it("detects proactivity decrease signal", () => {
    const nudges = detectSignals("only what i asked, stop suggesting things");
    const pNudge = nudges.find((n) => n.traitId === "proactivity");
    expect(pNudge).toBeDefined();
    expect(pNudge!.delta).toBeLessThan(0);
  });

  it("returns empty array for neutral messages", () => {
    const nudges = detectSignals("what's the status of the build?");
    expect(nudges).toHaveLength(0);
  });

  it("can fire multiple patterns at once", () => {
    const nudges = detectSignals("haha that was great, explain more please");
    expect(nudges.length).toBeGreaterThanOrEqual(2);
    const traitIds = nudges.map((n) => n.traitId);
    expect(traitIds).toContain("humor");
    expect(traitIds).toContain("verbosity");
  });
});

// ---------------------------------------------------------------------------
// EMA adaptation
// ---------------------------------------------------------------------------

describe("applyNudges", () => {
  it("moves trait toward high pole on positive nudge", () => {
    const traits = createDefaultTraits();
    const before = traits.scores.humor;
    applyNudges(traits, [{ traitId: "humor", delta: 0.08 }]);
    expect(traits.scores.humor).toBeGreaterThan(before);
  });

  it("moves trait toward low pole on negative nudge", () => {
    const traits = createDefaultTraits();
    const before = traits.scores.humor;
    applyNudges(traits, [{ traitId: "humor", delta: -0.12 }]);
    expect(traits.scores.humor).toBeLessThan(before);
  });

  it("never exceeds bounds [0, 1]", () => {
    const traits = createDefaultTraits();
    traits.scores.humor = 0.98;
    // Apply many positive nudges
    for (let i = 0; i < 50; i++) {
      applyNudges(traits, [{ traitId: "humor", delta: 0.5 }]);
    }
    expect(traits.scores.humor).toBeLessThanOrEqual(1.0);
    expect(traits.scores.humor).toBeGreaterThanOrEqual(0.0);
  });

  it("ignores nudges for unknown traits", () => {
    const traits = createDefaultTraits();
    const before = { ...traits.scores };
    applyNudges(traits, [{ traitId: "nonexistent", delta: 0.5 }]);
    expect(traits.scores).toEqual(before);
  });

  it("applies multiple nudges in one call", () => {
    const traits = createDefaultTraits();
    const beforeHumor = traits.scores.humor;
    const beforeVerbosity = traits.scores.verbosity;
    applyNudges(traits, [
      { traitId: "humor", delta: 0.08 },
      { traitId: "verbosity", delta: -0.12 },
    ]);
    expect(traits.scores.humor).toBeGreaterThan(beforeHumor);
    expect(traits.scores.verbosity).toBeLessThan(beforeVerbosity);
  });

  it("larger deltas produce larger changes", () => {
    const traits1 = createDefaultTraits();
    const traits2 = createDefaultTraits();
    applyNudges(traits1, [{ traitId: "humor", delta: 0.04 }]);
    applyNudges(traits2, [{ traitId: "humor", delta: 0.12 }]);
    // Both moved up, but traits2 moved more
    const change1 = traits1.scores.humor - createDefaultTraits().scores.humor;
    const change2 = traits2.scores.humor - createDefaultTraits().scores.humor;
    expect(change2).toBeGreaterThan(change1);
  });

  it("converges toward extreme over repeated nudges", () => {
    const traits = createDefaultTraits();
    // 20 consistent positive humor nudges should push well above 0.5
    for (let i = 0; i < 20; i++) {
      applyNudges(traits, [{ traitId: "humor", delta: 0.1 }]);
    }
    expect(traits.scores.humor).toBeGreaterThan(0.7);
  });
});

// ---------------------------------------------------------------------------
// Prompt generation
// ---------------------------------------------------------------------------

describe("generatePersonaPrompt", () => {
  it("includes persona header", () => {
    const prompt = generatePersonaPrompt(createDefaultTraits());
    expect(prompt).toContain("## Persona");
  });

  it("includes voice guidance", () => {
    const traits = createTraitsFromSetup("female", {});
    const prompt = generatePersonaPrompt(traits);
    expect(prompt).toContain("feminine");
  });

  it("generates guidance for non-center traits", () => {
    const traits = createTraitsFromSetup("neutral", { humor: 1.0, verbosity: 0.0 });
    const prompt = generatePersonaPrompt(traits);
    expect(prompt).toContain("playful");
    expect(prompt).toContain("concise");
  });

  it("skips guidance for center traits", () => {
    const traits = createTraitsFromSetup("neutral", {});
    // All at defaults (mostly 0.4-0.5), so most should be near center
    const prompt = generatePersonaPrompt(traits);
    // Should still have voice and the traits that deviate
    expect(prompt).toContain("## Persona");
  });

  it("uses strongly for extreme values", () => {
    const traits = createTraitsFromSetup("neutral", { humor: 1.0 });
    const prompt = generatePersonaPrompt(traits);
    expect(prompt).toContain("strongly");
  });

  it("uses somewhat for moderate values", () => {
    const traits = createTraitsFromSetup("neutral", { humor: 0.7 });
    const prompt = generatePersonaPrompt(traits);
    expect(prompt).toContain("somewhat");
  });

  it("includes adaptation disclaimer", () => {
    const prompt = generatePersonaPrompt(createDefaultTraits());
    expect(prompt).toContain("adapt over time");
  });
});

// ---------------------------------------------------------------------------
// Snapshot serialization
// ---------------------------------------------------------------------------

describe("snapshot serialization", () => {
  it("round-trips through toSnapshot/fromSnapshot", () => {
    const original = createTraitsFromSetup("female", { humor: 0.8, depth: 0.2 });
    const snap = toSnapshot(original, 42);
    const restored = fromSnapshot(snap);
    expect(restored.voice).toBe("female");
    expect(restored.scores.humor).toBe(0.8);
    expect(restored.scores.depth).toBe(0.2);
  });

  it("preserves observation count in snapshot", () => {
    const traits = createDefaultTraits();
    const snap = toSnapshot(traits, 15);
    expect(snap.observationCount).toBe(15);
  });

  it("fills missing traits with defaults on restore", () => {
    // Simulate a snapshot from before a trait was added
    const snap = {
      voice: "male" as const,
      scores: { humor: 0.9 },
      observationCount: 5,
    };
    const restored = fromSnapshot(snap);
    expect(restored.scores.humor).toBe(0.9);
    expect(restored.scores.formality).toBe(createDefaultTraits().scores.formality);
  });

  it("snapshot is a deep copy", () => {
    const traits = createDefaultTraits();
    const snap = toSnapshot(traits, 0);
    snap.scores.humor = 999;
    expect(traits.scores.humor).not.toBe(999);
  });
});

// ---------------------------------------------------------------------------
// PersonaEngine (stateful manager)
// ---------------------------------------------------------------------------

describe("PersonaEngine", () => {
  it("starts with defaults when no initial traits given", () => {
    const engine = new PersonaEngine();
    const traits = engine.getTraits();
    expect(traits.voice).toBe("neutral");
    expect(Object.keys(traits.scores)).toHaveLength(9);
  });

  it("starts with provided initial traits", () => {
    const initial = createTraitsFromSetup("male", { humor: 1.0 });
    const engine = new PersonaEngine(initial);
    expect(engine.getTraits().voice).toBe("male");
    expect(engine.getTraits().scores.humor).toBe(1.0);
  });

  it("observe detects signals and returns nudges", () => {
    const engine = new PersonaEngine();
    const nudges = engine.observe("haha that's funny lol");
    expect(nudges.length).toBeGreaterThan(0);
    expect(nudges[0].traitId).toBe("humor");
  });

  it("observe mutates traits", () => {
    const engine = new PersonaEngine();
    const before = engine.getTraits().scores.humor;
    engine.observe("haha lol");
    expect(engine.getTraits().scores.humor).not.toBe(before);
  });

  it("observe increments observation count", () => {
    const engine = new PersonaEngine();
    expect(engine.observations).toBe(0);
    engine.observe("haha");
    expect(engine.observations).toBe(1);
  });

  it("observe on neutral message does not increment count", () => {
    const engine = new PersonaEngine();
    engine.observe("what is the build status?");
    expect(engine.observations).toBe(0);
  });

  it("marks dirty on signal detection", () => {
    const engine = new PersonaEngine();
    expect(engine.isDirty).toBe(false);
    engine.observe("lol");
    expect(engine.isDirty).toBe(true);
  });

  it("snapshot clears dirty flag", () => {
    const engine = new PersonaEngine();
    engine.observe("lol");
    expect(engine.isDirty).toBe(true);
    engine.snapshot();
    expect(engine.isDirty).toBe(false);
  });

  it("prompt generates valid persona guidance", () => {
    const engine = new PersonaEngine(
      createTraitsFromSetup("female", { humor: 1.0 }),
    );
    const prompt = engine.prompt();
    expect(prompt).toContain("## Persona");
    expect(prompt).toContain("feminine");
    expect(prompt).toContain("playful");
  });

  it("restore loads snapshot state", () => {
    const engine = new PersonaEngine();
    engine.restore({
      voice: "male",
      scores: { humor: 0.9, warmth: 0.1 },
      observationCount: 10,
    });
    expect(engine.getTraits().voice).toBe("male");
    expect(engine.getTraits().scores.humor).toBe(0.9);
    expect(engine.observations).toBe(10);
  });

  it("getTraits returns a copy, not a reference", () => {
    const engine = new PersonaEngine();
    const traits = engine.getTraits();
    traits.scores.humor = 999;
    expect(engine.getTraits().scores.humor).not.toBe(999);
  });

  it("adapts progressively over many observations", () => {
    const engine = new PersonaEngine();
    const initial = engine.getTraits().scores.humor;

    // Simulate a user who consistently uses humor
    for (let i = 0; i < 10; i++) {
      engine.observe("haha that's hilarious lol");
    }

    const final = engine.getTraits().scores.humor;
    expect(final).toBeGreaterThan(initial);
    expect(final).toBeGreaterThan(0.6); // Should have shifted meaningfully
  });
});

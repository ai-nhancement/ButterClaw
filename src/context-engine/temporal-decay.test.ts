import { describe, it, expect } from "vitest";
import {
  classifyFactCategory,
  computeDecayMultiplier,
  computeMessageDecay,
  decayLabel,
} from "./temporal-decay.js";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

const MS_DAY = 24 * 60 * 60 * 1000;
const MS_MONTH = 30 * MS_DAY;

function msg(role: string, content: string, timestamp?: number): AgentMessage {
  return { role, content, timestamp: timestamp ?? Date.now() } as AgentMessage;
}

describe("classifyFactCategory", () => {
  describe("permanent facts", () => {
    it("classifies name declarations", () => {
      expect(classifyFactCategory("My name is Sarah", "user")).toBe("permanent");
    });

    it("classifies family relationships", () => {
      expect(classifyFactCategory("My daughter Emma loves painting", "user")).toBe("permanent");
      expect(classifyFactCategory("My wife works at a hospital", "user")).toBe("permanent");
      expect(classifyFactCategory("My brother lives in Boston", "user")).toBe("permanent");
    });

    it("classifies birth information", () => {
      expect(classifyFactCategory("I was born in 1985", "user")).toBe("permanent");
      expect(classifyFactCategory("My birthday is March 24", "user")).toBe("permanent");
      expect(classifyFactCategory("born on January 5th", "user")).toBe("permanent");
    });
  });

  describe("long-term facts", () => {
    it("classifies employment", () => {
      expect(classifyFactCategory("I work at Google as an engineer", "user")).toBe("long");
      expect(classifyFactCategory("I am a software engineer", "user")).toBe("long");
    });

    it("classifies job-related terms", () => {
      expect(classifyFactCategory("My job is really demanding", "user")).toBe("long");
      expect(classifyFactCategory("My role involves code review", "user")).toBe("long");
    });

    it("classifies contact info", () => {
      expect(classifyFactCategory("My email is john@example.com", "user")).toBe("long");
      expect(classifyFactCategory("My phone is +1-555-0123", "user")).toBe("long");
    });
  });

  describe("medium-term facts", () => {
    it("classifies location", () => {
      expect(classifyFactCategory("I live in Austin, Texas", "user")).toBe("medium");
      expect(classifyFactCategory("I moved to San Francisco last year", "user")).toBe("medium");
    });

    it("classifies preferences", () => {
      expect(classifyFactCategory("I like dark mode for everything", "user")).toBe("medium");
      expect(classifyFactCategory("I prefer TypeScript over JavaScript", "user")).toBe("medium");
      expect(classifyFactCategory("My favorite color is blue", "user")).toBe("medium");
    });
  });

  describe("short-term facts", () => {
    it("classifies active projects", () => {
      expect(classifyFactCategory("We are working on the new dashboard", "user")).toBe("short");
    });

    it("classifies decisions and commitments", () => {
      expect(classifyFactCategory("We decided to use PostgreSQL for the backend", "user")).toBe("short");
      expect(classifyFactCategory("I scheduled the meeting for Friday", "user")).toBe("short");
    });

    it("classifies deadlines", () => {
      expect(classifyFactCategory("The deadline is next month", "user")).toBe("short");
    });
  });

  describe("momentary facts", () => {
    it("classifies mood and feelings", () => {
      expect(classifyFactCategory("I feel exhausted after that meeting", "user")).toBe("momentary");
      expect(classifyFactCategory("I'm frustrated with this bug", "user")).toBe("momentary");
    });

    it("classifies temporary state", () => {
      expect(classifyFactCategory("Right now I need to focus on this", "user")).toBe("momentary");
      expect(classifyFactCategory("I'm currently debugging the API", "user")).toBe("momentary");
    });
  });

  describe("defaults", () => {
    it("defaults to medium for user messages with no pattern", () => {
      expect(classifyFactCategory("The weather is nice today", "user")).toBe("medium");
    });

    it("defaults to short for assistant messages with no pattern", () => {
      expect(classifyFactCategory("Here is the code you asked for", "assistant")).toBe("short");
    });

    it("defaults for very short text", () => {
      expect(classifyFactCategory("ok", "user")).toBe("medium");
      expect(classifyFactCategory("ok", "assistant")).toBe("short");
    });
  });

  describe("priority ordering", () => {
    it("permanent wins over long when both match", () => {
      // "my wife" is permanent, "I work at" is long
      expect(classifyFactCategory("My wife and I work at the same company", "user")).toBe("permanent");
    });

    it("permanent wins over momentary when both match", () => {
      // "my daughter" is permanent, "I feel" is momentary
      expect(classifyFactCategory("My daughter makes me feel so proud", "user")).toBe("permanent");
    });
  });
});

describe("computeDecayMultiplier", () => {
  const now = Date.now();

  it("returns 1.0 for permanent facts regardless of age", () => {
    expect(computeDecayMultiplier(now - 365 * MS_DAY, now, "permanent")).toBe(1.0);
    expect(computeDecayMultiplier(now - 10 * 365 * MS_DAY, now, "permanent")).toBe(1.0);
  });

  it("returns 1.0 for age = 0", () => {
    expect(computeDecayMultiplier(now, now, "short")).toBe(1.0);
    expect(computeDecayMultiplier(now, now, "momentary")).toBe(1.0);
  });

  it("returns ~0.5 at exactly one half-life", () => {
    // Short: 6-month half-life
    const halfLife = 6 * MS_MONTH;
    const multiplier = computeDecayMultiplier(now - halfLife, now, "short");
    expect(multiplier).toBeCloseTo(0.5, 1);
  });

  it("returns ~0.25 at two half-lives", () => {
    const halfLife = 6 * MS_MONTH;
    const multiplier = computeDecayMultiplier(now - 2 * halfLife, now, "short");
    expect(multiplier).toBeCloseTo(0.25, 1);
  });

  it("momentary facts decay rapidly — near zero after 3 days", () => {
    const threeDays = 3 * MS_DAY;
    const multiplier = computeDecayMultiplier(now - threeDays, now, "momentary");
    expect(multiplier).toBeLessThan(0.15);
  });

  it("momentary facts at half a day are ~0.7", () => {
    const halfDay = 0.5 * MS_DAY;
    const multiplier = computeDecayMultiplier(now - halfDay, now, "momentary");
    expect(multiplier).toBeGreaterThan(0.6);
    expect(multiplier).toBeLessThan(0.8);
  });

  it("long-term facts barely decay in a month", () => {
    const multiplier = computeDecayMultiplier(now - MS_MONTH, now, "long");
    expect(multiplier).toBeGreaterThan(0.95);
  });

  it("never goes below the 0.05 floor", () => {
    // Very old momentary fact
    const veryOld = now - 365 * MS_DAY;
    const multiplier = computeDecayMultiplier(veryOld, now, "momentary");
    expect(multiplier).toBe(0.05);
  });

  it("returns 1.0 for future timestamps", () => {
    const future = now + MS_DAY;
    expect(computeDecayMultiplier(future, now, "short")).toBe(1.0);
  });
});

describe("computeMessageDecay", () => {
  it("combines category detection with decay computation", () => {
    const now = Date.now();
    const m = msg("user", "My name is John", now - 365 * MS_DAY);
    const result = computeMessageDecay(m, now);
    expect(result.category).toBe("permanent");
    expect(result.multiplier).toBe(1.0);
  });

  it("decays momentary mood messages", () => {
    const now = Date.now();
    const m = msg("user", "I feel really tired today", now - 2 * MS_DAY);
    const result = computeMessageDecay(m, now);
    expect(result.category).toBe("momentary");
    expect(result.multiplier).toBeLessThan(0.3);
  });

  it("returns 1.0 for messages without timestamps", () => {
    const m = { role: "user", content: "Some fact" } as AgentMessage;
    const result = computeMessageDecay(m);
    expect(result.multiplier).toBe(1.0);
  });

  it("handles ISO string timestamps from transcript reloads", () => {
    const now = Date.now();
    const sixMonthsAgo = new Date(now - 6 * MS_MONTH).toISOString();
    const m = { role: "user", content: "I decided to switch to PostgreSQL", timestamp: sixMonthsAgo } as unknown as AgentMessage;
    const result = computeMessageDecay(m, now);
    expect(result.category).toBe("short");
    // 6 months = 1 half-life for short category → ~0.5
    expect(result.multiplier).toBeCloseTo(0.5, 1);
  });

  it("treats invalid string timestamps as current", () => {
    const now = Date.now();
    const m = { role: "user", content: "Some fact", timestamp: "not-a-date" } as unknown as AgentMessage;
    const result = computeMessageDecay(m, now);
    expect(result.multiplier).toBe(1.0);
  });

  it("handles array content", () => {
    const now = Date.now();
    const m = {
      role: "user",
      content: [{ type: "text", text: "My daughter Emma is 5 years old" }],
      timestamp: now,
    } as unknown as AgentMessage;
    const result = computeMessageDecay(m, now);
    expect(result.category).toBe("permanent");
  });
});

describe("decayLabel", () => {
  it("returns empty string for fresh facts", () => {
    expect(decayLabel(1.0)).toBe("");
    expect(decayLabel(0.8)).toBe("");
    expect(decayLabel(0.9)).toBe("");
  });

  it("returns [AGING] for moderately decayed facts", () => {
    expect(decayLabel(0.79)).toBe("[AGING]");
    expect(decayLabel(0.5)).toBe("[AGING]");
    expect(decayLabel(0.4)).toBe("[AGING]");
  });

  it("returns [STALE] for substantially decayed facts", () => {
    expect(decayLabel(0.39)).toBe("[STALE]");
    expect(decayLabel(0.1)).toBe("[STALE]");
    expect(decayLabel(0.05)).toBe("[STALE]");
  });
});

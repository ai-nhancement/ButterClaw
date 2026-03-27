import { describe, it, expect } from "vitest";
import { scoreSignificance, SignificanceStore } from "./significance-scorer.js";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

function msg(role: string, content: string, timestamp?: number): AgentMessage {
  return { role, content, timestamp: timestamp ?? Date.now() } as AgentMessage;
}

describe("scoreSignificance", () => {
  describe("role weight", () => {
    it("scores user messages higher than assistant messages", () => {
      const user = scoreSignificance(msg("user", "Hello world"), []);
      const assistant = scoreSignificance(msg("assistant", "Hello world"), []);
      expect(user.signals.roleWeight).toBeGreaterThan(assistant.signals.roleWeight);
      expect(user.score).toBeGreaterThan(assistant.score);
    });

    it("scores tool results higher than assistant messages", () => {
      const tool = scoreSignificance(msg("tool", "Calendar: 3 events"), []);
      const assistant = scoreSignificance(msg("assistant", "Calendar: 3 events"), []);
      expect(tool.signals.roleWeight).toBeGreaterThan(assistant.signals.roleWeight);
    });
  });

  describe("information density", () => {
    it("scores messages with dates higher", () => {
      const withDate = scoreSignificance(msg("user", "The meeting is on March 24"), []);
      const withoutDate = scoreSignificance(msg("user", "The meeting is soon"), []);
      expect(withDate.signals.informationDensity).toBeGreaterThan(withoutDate.signals.informationDensity);
    });

    it("scores messages with decisions higher", () => {
      const withDecision = scoreSignificance(msg("user", "I decided to cancel the subscription today"), []);
      const withoutDecision = scoreSignificance(msg("user", "The subscription is something to think about"), []);
      expect(withDecision.signals.informationDensity).toBeGreaterThan(withoutDecision.signals.informationDensity);
    });

    it("scores messages with personal facts higher", () => {
      const personal = scoreSignificance(msg("user", "My daughter's birthday is next week"), []);
      const generic = scoreSignificance(msg("user", "That sounds interesting"), []);
      expect(personal.signals.informationDensity).toBeGreaterThan(generic.signals.informationDensity);
    });

    it("scores messages with quantities higher", () => {
      const withQty = scoreSignificance(msg("user", "The project costs $50000 and takes 6 months"), []);
      const withoutQty = scoreSignificance(msg("user", "The project costs some money and takes some time"), []);
      expect(withQty.signals.informationDensity).toBeGreaterThan(withoutQty.signals.informationDensity);
    });

    it("scores messages with contact info higher", () => {
      const withEmail = scoreSignificance(msg("user", "Send it to john@example.com"), []);
      const withoutEmail = scoreSignificance(msg("user", "Send it to the usual address"), []);
      expect(withEmail.signals.informationDensity).toBeGreaterThan(withoutEmail.signals.informationDensity);
    });

    it("scores empty messages at zero density", () => {
      const empty = scoreSignificance(msg("user", "ok"), []);
      expect(empty.signals.informationDensity).toBe(0);
    });
  });

  describe("novelty", () => {
    it("scores first message as fully novel", () => {
      const result = scoreSignificance(msg("user", "Tell me about the project"), []);
      expect(result.signals.novelty).toBe(1.0);
    });

    it("scores repeated content lower", () => {
      const prior = [msg("user", "Tell me about the project deadline and budget")];
      const repeated = scoreSignificance(msg("user", "What about the project deadline?"), prior);
      const novel = scoreSignificance(msg("user", "How is the weather in Barcelona?"), prior);
      expect(novel.signals.novelty).toBeGreaterThan(repeated.signals.novelty);
    });

    it("handles pure repetition", () => {
      const prior = [msg("user", "Check my calendar please")];
      const exact = scoreSignificance(msg("user", "Check my calendar please"), prior);
      expect(exact.signals.novelty).toBeLessThan(0.3);
    });
  });

  describe("overall scoring", () => {
    it("high-value message scores above 0.6", () => {
      const result = scoreSignificance(
        msg("user", "My daughter Emma's birthday is March 24. I decided to book the restaurant for 6pm."),
        [],
      );
      expect(result.score).toBeGreaterThan(0.6);
    });

    it("low-value filler scores below 0.4", () => {
      const prior = [msg("assistant", "Sure thing!")];
      const result = scoreSignificance(msg("assistant", "Sure, sounds good!"), prior);
      expect(result.score).toBeLessThan(0.4);
    });

    it("score is bounded 0.0–1.0", () => {
      const messages = [
        msg("user", "My name is John, born on January 5 1985, I live at 123 Main St, email john@test.com, phone +1-555-0123. I decided to cancel and must finish by Friday."),
        msg("assistant", "ok"),
        msg("tool", '{"result": "Calendar cleared for Friday March 28, 2026 at $500 budget with 3 hours allocated"}'),
      ];

      for (const m of messages) {
        const result = scoreSignificance(m, []);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
      }
    });
  });
});

describe("SignificanceStore", () => {
  it("stores and retrieves by object reference", () => {
    const store = new SignificanceStore();
    const message = msg("user", "test");
    store.set("s1", message, { score: 0.8, signals: { roleWeight: 0.9, informationDensity: 0.7, novelty: 1.0 } });
    expect(store.getScore("s1", message)).toBe(0.8);
  });

  it("retrieves by content key for transcript-loaded messages", () => {
    const store = new SignificanceStore();
    const original = msg("user", "My birthday is March 24", 1000);
    store.set("s1", original, { score: 0.75, signals: { roleWeight: 0.9, informationDensity: 0.6, novelty: 1.0 } });

    // Simulate transcript reload — new object, same content
    const reloaded = msg("user", "My birthday is March 24", 1000);
    expect(store.getScore("s1", reloaded)).toBe(0.75);
  });

  it("returns default 0.5 for unknown messages", () => {
    const store = new SignificanceStore();
    expect(store.getScore("s1", msg("user", "unknown"))).toBe(0.5);
  });

  it("clears session data", () => {
    const store = new SignificanceStore();
    const message = msg("user", "test");
    store.set("s1", message, { score: 0.9, signals: { roleWeight: 0.9, informationDensity: 0.9, novelty: 0.9 } });
    store.clear("s1");
    expect(store.getScore("s1", message)).toBe(0.5);
  });

  it("isolates sessions", () => {
    const store = new SignificanceStore();
    const m1 = msg("user", "session 1 fact", 1000);
    const m2 = msg("user", "session 2 fact", 2000);
    store.set("s1", m1, { score: 0.9, signals: { roleWeight: 0.9, informationDensity: 0.9, novelty: 0.9 } });
    store.set("s2", m2, { score: 0.3, signals: { roleWeight: 0.4, informationDensity: 0.2, novelty: 0.3 } });
    expect(store.getScore("s1", m1)).toBe(0.9);
    expect(store.getScore("s2", m2)).toBe(0.3);
  });
});

import { describe, it, expect } from "vitest";
import { TruthBoundaryContextEngine, computeGroundingSnapshot, importanceMultiplier } from "./truth-boundary.js";
import { LegacyContextEngine } from "./legacy.js";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

function msg(role: string, content: string, timestamp?: number): AgentMessage {
  return { role, content, timestamp: timestamp ?? Date.now() } as AgentMessage;
}

describe("TruthBoundaryContextEngine", () => {
  function createEngine() {
    const base = new LegacyContextEngine();
    return new TruthBoundaryContextEngine(base);
  }

  describe("info", () => {
    it("wraps base engine id and name", () => {
      const engine = createEngine();
      expect(engine.info.id).toBe("truth-boundary:legacy");
      expect(engine.info.name).toContain("Truth Boundary");
      expect(engine.info.name).toContain("Legacy");
    });
  });

  describe("ingest single messages", () => {
    it("delegates to base engine", async () => {
      const engine = createEngine();
      const result = await engine.ingest({
        sessionId: "s1",
        message: msg("user", "My birthday is March 24"),
      });
      // LegacyContextEngine returns ingested: false (no-op)
      expect(result).toHaveProperty("ingested");
    });
  });

  describe("ingestBatch", () => {
    it("delegates to base engine when ingestBatch is available", async () => {
      const base = new LegacyContextEngine();
      // LegacyContextEngine has no ingestBatch, so it falls back to ingest loop
      const engine = new TruthBoundaryContextEngine(base);
      const result = await engine.ingestBatch({
        sessionId: "s1",
        messages: [
          msg("user", "What's on my calendar?"),
          msg("tool", "Calendar: 3 events"),
          msg("assistant", "You have 3 events today."),
        ],
      });
      expect(result).toHaveProperty("ingestedCount");
    });
  });

  describe("assemble with truth annotations", () => {
    it("injects user-stated facts into system prompt", async () => {
      const engine = createEngine();
      const messages = [
        msg("user", "My daughter's birthday is March 24", 1000),
        msg("assistant", "I'll remember that!", 1001),
      ];

      await engine.ingestBatch({ sessionId: "s1", messages });
      const result = await engine.assemble({ sessionId: "s1", messages });

      expect(result.systemPromptAddition).toBeDefined();
      expect(result.systemPromptAddition).toContain("User-Stated Facts");
      expect(result.systemPromptAddition).toContain("daughter");
    });

    it("marks assistant messages without tools as unverified", async () => {
      const engine = createEngine();
      const messages = [
        msg("user", "What's the weather?", 1000),
        msg("assistant", "I think it's sunny today.", 1001),
      ];

      await engine.ingestBatch({ sessionId: "s1", messages });
      const result = await engine.assemble({ sessionId: "s1", messages });

      expect(result.systemPromptAddition).toBeDefined();
      expect(result.systemPromptAddition).toContain("Unverified Claims");
      expect(result.systemPromptAddition).toContain("sunny");
    });

    it("does NOT mark assistant messages with tool results as unverified", async () => {
      const engine = createEngine();
      const messages = [
        msg("user", "Check my email", 1000),
        msg("tool", "3 new emails from Next Insurance", 1001),
        msg("assistant", "You have 3 new emails from Next Insurance.", 1002),
      ];

      await engine.ingestBatch({ sessionId: "s1", messages });
      const result = await engine.assemble({ sessionId: "s1", messages });

      // The assistant message is grounded — should not appear in Unverified
      if (result.systemPromptAddition) {
        expect(result.systemPromptAddition).not.toContain("Unverified Claims");
      }
    });

    it("excludes raw tool output from annotations", async () => {
      const engine = createEngine();
      const messages = [
        msg("user", "Check calendar", 1000),
        msg("tool", '{"events": [{"title": "Meeting", "time": "10am"}]}', 1001),
        msg("assistant", "You have a meeting at 10am.", 1002),
      ];

      await engine.ingestBatch({ sessionId: "s1", messages });
      const result = await engine.assemble({ sessionId: "s1", messages });

      // Raw tool JSON should NOT appear in annotations
      if (result.systemPromptAddition) {
        expect(result.systemPromptAddition).not.toContain('"events"');
      }
    });

    it("preserves base engine systemPromptAddition", async () => {
      const base = new LegacyContextEngine();
      const originalAssemble = base.assemble.bind(base);
      base.assemble = async (params) => {
        const result = await originalAssemble(params);
        return { ...result, systemPromptAddition: "Base engine addition" };
      };

      const engine = new TruthBoundaryContextEngine(base);
      const messages = [msg("user", "Hello", 1000)];
      await engine.ingestBatch({ sessionId: "s1", messages });

      const result = await engine.assemble({ sessionId: "s1", messages });
      expect(result.systemPromptAddition).toContain("Base engine addition");
      expect(result.systemPromptAddition).toContain("User-Stated Facts");
    });

    it("classifies historical messages loaded from transcript", async () => {
      const engine = createEngine();
      // Don't ingest — simulate messages loaded from transcript file
      const messages = [
        msg("user", "I live in Austin", 1000),
        msg("assistant", "Nice city!", 1001),
      ];

      const result = await engine.assemble({ sessionId: "s1", messages });

      expect(result.systemPromptAddition).toBeDefined();
      expect(result.systemPromptAddition).toContain("User-Stated Facts");
      expect(result.systemPromptAddition).toContain("Austin");
      // Historical assistant messages without ingestion context → unclassified (not unverified)
      expect(result.systemPromptAddition).not.toContain("Unverified Claims");
    });
  });

  describe("grounding health", () => {
    it("reports healthy when most messages are grounded", async () => {
      const engine = createEngine();
      const messages = [
        msg("user", "Check my calendar", 1000),
        msg("tool", "Calendar: meeting at 10am", 1001),
        msg("assistant", "You have a meeting at 10am.", 1002),
        msg("user", "And my email?", 1003),
        msg("tool", "2 new emails", 1004),
        msg("assistant", "You have 2 new emails.", 1005),
      ];

      await engine.ingestBatch({ sessionId: "s1", messages });
      const result = await engine.assemble({ sessionId: "s1", messages });

      // All messages are user_truth or grounded — no health warning
      if (result.systemPromptAddition) {
        expect(result.systemPromptAddition).not.toContain("Grounding Health");
      }
    });

    it("warns when grounding ratio drops below threshold", async () => {
      const engine = createEngine();
      const messages: AgentMessage[] = [];

      // Generate mostly ungrounded assistant messages (no tools)
      for (let i = 0; i < 20; i++) {
        messages.push(msg("user", `Question ${i}`, i * 10));
        messages.push(msg("assistant", `I think the answer is ${i}`, i * 10 + 1));
      }

      await engine.ingestBatch({ sessionId: "s1", messages });
      const result = await engine.assemble({ sessionId: "s1", messages });

      expect(result.systemPromptAddition).toBeDefined();
      expect(result.systemPromptAddition).toContain("Grounding Health");
    });
  });

  describe("computeGroundingSnapshot", () => {
    it("returns unknown when no classified events", () => {
      const snapshot = computeGroundingSnapshot([]);
      expect(snapshot.tier).toBe("unknown");
    });

    it("returns healthy when ratio >= 0.6", () => {
      const metas = [
        { truthClass: "user_truth" as const, confidence: 1 },
        { truthClass: "grounded" as const, confidence: 1 },
        { truthClass: "ungrounded" as const, confidence: 0.8 },
      ];
      const snapshot = computeGroundingSnapshot(metas);
      expect(snapshot.tier).toBe("healthy");
      expect(snapshot.ratio).toBeCloseTo(2 / 3);
    });

    it("returns critical when ratio < 0.4", () => {
      const metas = [
        { truthClass: "user_truth" as const, confidence: 1 },
        { truthClass: "ungrounded" as const, confidence: 0.8 },
        { truthClass: "ungrounded" as const, confidence: 0.8 },
        { truthClass: "ungrounded" as const, confidence: 0.8 },
        { truthClass: "ungrounded" as const, confidence: 0.8 },
      ];
      const snapshot = computeGroundingSnapshot(metas);
      expect(snapshot.tier).toBe("critical");
      expect(snapshot.ratio).toBe(0.2);
    });
  });

  describe("afterTurn resets turn state", () => {
    it("assistant in new turn without tools is ungrounded", async () => {
      const engine = createEngine();

      // Turn 1: has tools
      await engine.ingestBatch({
        sessionId: "s1",
        messages: [
          msg("user", "Check email", 1000),
          msg("tool", "3 emails", 1001),
          msg("assistant", "You have 3 emails.", 1002),
        ],
      });

      await engine.afterTurn({
        sessionId: "s1",
        sessionFile: "/tmp/test.json",
        messages: [],
        prePromptMessageCount: 0,
      });

      // Turn 2: no tools
      await engine.ingestBatch({
        sessionId: "s1",
        messages: [
          msg("user", "What's for dinner?", 2000),
          msg("assistant", "Maybe pasta?", 2001),
        ],
      });

      const allMessages = [
        msg("user", "Check email", 1000),
        msg("tool", "3 emails", 1001),
        msg("assistant", "You have 3 emails.", 1002),
        msg("user", "What's for dinner?", 2000),
        msg("assistant", "Maybe pasta?", 2001),
      ];

      const result = await engine.assemble({ sessionId: "s1", messages: allMessages });

      expect(result.systemPromptAddition).toContain("Unverified Claims");
      expect(result.systemPromptAddition).toContain("pasta");
    });
  });

  describe("subagent cleanup", () => {
    it("clears truth metadata on subagent end", async () => {
      const engine = createEngine();
      await engine.ingest({ sessionId: "child-1", message: msg("user", "test") });
      await engine.onSubagentEnded({ childSessionKey: "child-1", reason: "completed" });
      // Verify cleanup — assembling empty session should produce no annotations
      const result = await engine.assemble({ sessionId: "child-1", messages: [] });
      expect(result.systemPromptAddition).toBeUndefined();
    });
  });

  describe("importanceMultiplier", () => {
    it("ranks user_truth highest", () => {
      expect(importanceMultiplier({ truthClass: "user_truth", confidence: 1 })).toBe(1.4);
    });

    it("ranks grounded above neutral", () => {
      expect(importanceMultiplier({ truthClass: "grounded", confidence: 1 })).toBe(1.2);
    });

    it("ranks ungrounded lowest", () => {
      expect(importanceMultiplier({ truthClass: "ungrounded", confidence: 0.8 })).toBe(0.6);
    });

    it("ranks unclassified as neutral", () => {
      expect(importanceMultiplier({ truthClass: "unclassified", confidence: 0.5 })).toBe(1.0);
    });
  });

  describe("importance-weighted filtering under budget pressure", () => {
    it("drops ungrounded assistant messages when budget is tight", async () => {
      const engine = createEngine();

      // Build conversation: early ungrounded turns, then enough recent messages
      // to fill the 6-message protected zone with grounded content.
      const messages = [
        // Turn 1: no tools — ungrounded (OUTSIDE protected zone)
        msg("user", "What's the weather?", 1000),
        msg("assistant", "I think it might be sunny today.", 1001),
        // Turn 2: no tools — ungrounded (OUTSIDE protected zone)
        msg("user", "What about tomorrow?", 1002),
        msg("assistant", "Probably rainy I guess.", 1003),
        // Turn 3: no tools — ungrounded (OUTSIDE protected zone)
        msg("user", "And the weekend?", 1004),
        msg("assistant", "Maybe cloudy but I'm not sure.", 1005),
        // Turn 4: with tools — grounded (INSIDE protected zone, last 6)
        msg("user", "Check my actual calendar", 1006),
        msg("tool", "Saturday: BBQ at noon", 1007),
        msg("assistant", "You have a BBQ Saturday at noon.", 1008),
        // Turn 5: recent exchange (INSIDE protected zone)
        msg("user", "Great thanks", 1009),
        msg("assistant", "You're welcome!", 1010),
      ];

      // Ingest turn 1
      await engine.ingestBatch({ sessionId: "s1", messages: messages.slice(0, 2) });
      await engine.afterTurn({ sessionId: "s1", sessionFile: "/tmp/t.json", messages: [], prePromptMessageCount: 0 });
      // Ingest turn 2
      await engine.ingestBatch({ sessionId: "s1", messages: messages.slice(2, 4) });
      await engine.afterTurn({ sessionId: "s1", sessionFile: "/tmp/t.json", messages: [], prePromptMessageCount: 0 });
      // Ingest turn 3
      await engine.ingestBatch({ sessionId: "s1", messages: messages.slice(4, 6) });
      await engine.afterTurn({ sessionId: "s1", sessionFile: "/tmp/t.json", messages: [], prePromptMessageCount: 0 });
      // Ingest turn 4 (with tools)
      await engine.ingestBatch({ sessionId: "s1", messages: messages.slice(6, 9) });
      await engine.afterTurn({ sessionId: "s1", sessionFile: "/tmp/t.json", messages: [], prePromptMessageCount: 0 });
      // Ingest turn 5
      await engine.ingestBatch({ sessionId: "s1", messages: messages.slice(9) });

      // Budget of 1 guarantees pressure: estimated tokens > 75% of budget
      const result = await engine.assemble({
        sessionId: "s1",
        messages,
        tokenBudget: 1,
      });

      // All 6 user messages should survive (never dropped)
      const userMsgs = result.messages.filter((m) => (m.role as string) === "user");
      expect(userMsgs.length).toBe(5);

      // The 3 early ungrounded assistant messages should be dropped
      expect(result.messages.length).toBeLessThan(messages.length);

      // The grounded assistant message (BBQ) should survive
      const assistantTexts = result.messages
        .filter((m) => (m.role as string) === "assistant")
        .map((m) => m.content as string);
      expect(assistantTexts.some((t) => t.includes("BBQ"))).toBe(true);
    });

    it("does not filter when budget is comfortable", async () => {
      const engine = createEngine();
      const messages = [
        msg("user", "Hello", 1000),
        msg("assistant", "Hi there!", 1001),
      ];

      await engine.ingestBatch({ sessionId: "s1", messages });

      const result = await engine.assemble({
        sessionId: "s1",
        messages,
        tokenBudget: 100000, // Plenty of room
      });

      expect(result.messages.length).toBe(messages.length);
    });

    it("does not filter when no budget specified", async () => {
      const engine = createEngine();
      const messages = [
        msg("user", "Hello", 1000),
        msg("assistant", "Ungrounded claim", 1001),
      ];

      await engine.ingestBatch({ sessionId: "s1", messages });

      const result = await engine.assemble({
        sessionId: "s1",
        messages,
        // No tokenBudget
      });

      expect(result.messages.length).toBe(messages.length);
    });
  });

  describe("session isolation", () => {
    it("classifications in one session don't affect another", async () => {
      const engine = createEngine();

      await engine.ingestBatch({
        sessionId: "s1",
        messages: [
          msg("user", "Session 1 fact", 1000),
          msg("assistant", "Ungrounded claim in s1", 1001),
        ],
      });

      await engine.ingestBatch({
        sessionId: "s2",
        messages: [
          msg("user", "Session 2 fact", 2000),
          msg("tool", "Verified data", 2001),
          msg("assistant", "Grounded response in s2", 2002),
        ],
      });

      const r1 = await engine.assemble({
        sessionId: "s1",
        messages: [msg("user", "Session 1 fact", 1000), msg("assistant", "Ungrounded claim in s1", 1001)],
      });
      const r2 = await engine.assemble({
        sessionId: "s2",
        messages: [msg("user", "Session 2 fact", 2000), msg("tool", "Verified data", 2001), msg("assistant", "Grounded response in s2", 2002)],
      });

      expect(r1.systemPromptAddition).toContain("Unverified Claims");
      if (r2.systemPromptAddition) {
        expect(r2.systemPromptAddition).not.toContain("Unverified Claims");
      }
    });
  });
});

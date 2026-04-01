import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { EvidenceLedger } from "./evidence-ledger.js";
import type { GroundingSnapshot } from "./truth-boundary.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-ledger-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function ledgerPath() {
  return path.join(tmpDir, "test-session.evidence.ndjson");
}

function sessionFilePath() {
  return path.join(tmpDir, "test-session.jsonl");
}

describe("EvidenceLedger", () => {
  describe("bind", () => {
    it("derives .evidence.ndjson from session file path", () => {
      const ledger = new EvidenceLedger();
      ledger.bind(sessionFilePath());
      expect(ledger.path).toBe(ledgerPath());
      expect(ledger.isBound).toBe(true);
    });

    it("is not bound initially", () => {
      const ledger = new EvidenceLedger();
      expect(ledger.isBound).toBe(false);
      expect(ledger.path).toBeUndefined();
    });
  });

  describe("buffering", () => {
    it("tracks pending count", () => {
      const ledger = new EvidenceLedger();
      ledger.bind(sessionFilePath());

      expect(ledger.pendingCount).toBe(0);

      ledger.appendTruthClassification("s1", "0:user:hello", "user_truth", 1.0);
      expect(ledger.pendingCount).toBe(1);

      ledger.appendSignificance("s1", "0:user:hello", {
        score: 0.8,
        signals: { roleWeight: 0.9, informationDensity: 0.7, novelty: 1.0 },
      }, "permanent");
      expect(ledger.pendingCount).toBe(2);
    });

    it("clear discards buffer without flushing", () => {
      const ledger = new EvidenceLedger();
      ledger.bind(sessionFilePath());
      ledger.appendTruthClassification("s1", "key1", "user_truth", 1.0);
      ledger.clear();
      expect(ledger.pendingCount).toBe(0);
    });
  });

  describe("flush", () => {
    it("writes buffered records to JSONL file", async () => {
      const ledger = new EvidenceLedger();
      ledger.bind(sessionFilePath());

      ledger.appendTruthClassification("s1", "0:user:my name", "user_truth", 1.0);
      ledger.appendSignificance("s1", "0:user:my name", {
        score: 0.85,
        signals: { roleWeight: 0.9, informationDensity: 0.8, novelty: 1.0 },
      }, "permanent");

      await ledger.flush();
      expect(ledger.pendingCount).toBe(0);

      const content = await fs.readFile(ledgerPath(), "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);

      const truthRecord = JSON.parse(lines[0]);
      expect(truthRecord.type).toBe("truth");
      expect(truthRecord.truthClass).toBe("user_truth");
      expect(truthRecord.messageKey).toBe("0:user:my name");

      const sigRecord = JSON.parse(lines[1]);
      expect(sigRecord.type).toBe("significance");
      expect(sigRecord.score).toBe(0.85);
      expect(sigRecord.factCategory).toBe("permanent");
    });

    it("appends to existing file on subsequent flushes", async () => {
      const ledger = new EvidenceLedger();
      ledger.bind(sessionFilePath());

      ledger.appendTruthClassification("s1", "key1", "user_truth", 1.0);
      await ledger.flush();

      ledger.appendTruthClassification("s1", "key2", "grounded", 0.7);
      await ledger.flush();

      const content = await fs.readFile(ledgerPath(), "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).messageKey).toBe("key1");
      expect(JSON.parse(lines[1]).messageKey).toBe("key2");
    });

    it("is a no-op when buffer is empty", async () => {
      const ledger = new EvidenceLedger();
      ledger.bind(sessionFilePath());
      await ledger.flush();

      // File should not exist
      await expect(fs.access(ledgerPath())).rejects.toThrow();
    });

    it("is a no-op when not bound", async () => {
      const ledger = new EvidenceLedger();
      ledger.appendTruthClassification("s1", "key1", "user_truth", 1.0);
      await ledger.flush(); // Should not throw
      expect(ledger.pendingCount).toBe(1); // Records still buffered
    });

    it("restores records to buffer on write failure", async () => {
      const ledger = new EvidenceLedger();
      // Bind to an invalid path that will fail on appendFile
      ledger.bind(path.join(tmpDir, "nonexistent", "deep", "nested", "\0invalid", "file.ndjson"));
      ledger.appendTruthClassification("s1", "key1", "user_truth", 1.0);
      ledger.appendSignificance("s1", "key1", {
        score: 0.8,
        signals: { roleWeight: 0.9, informationDensity: 0.7, novelty: 1.0 },
      });

      // Flush should not throw (callers use .catch(() => {}))
      await ledger.flush();

      // Records should be restored to buffer for retry
      expect(ledger.pendingCount).toBe(2);
    });

    it("records grounding snapshots", async () => {
      const ledger = new EvidenceLedger();
      ledger.bind(sessionFilePath());

      const snapshot: GroundingSnapshot = {
        ratio: 0.75,
        tier: "healthy",
        breakdown: { user_truth: 5, grounded: 3, ungrounded: 2, unclassified: 1 },
        total: 11,
        classified: 10,
        timestamp: new Date().toISOString(),
      };

      ledger.appendGroundingSnapshot("s1", snapshot);
      await ledger.flush();

      const content = await fs.readFile(ledgerPath(), "utf-8");
      const record = JSON.parse(content.trim());
      expect(record.type).toBe("grounding");
      expect(record.ratio).toBe(0.75);
      expect(record.tier).toBe("healthy");
      expect(record.breakdown.user_truth).toBe(5);
    });
  });

  describe("readAll", () => {
    it("reads all records from the ledger file", async () => {
      const ledger = new EvidenceLedger();
      ledger.bind(sessionFilePath());

      ledger.appendTruthClassification("s1", "key1", "user_truth", 1.0);
      ledger.appendTruthClassification("s1", "key2", "grounded", 0.7);
      ledger.appendSignificance("s1", "key1", {
        score: 0.9,
        signals: { roleWeight: 0.9, informationDensity: 0.8, novelty: 1.0 },
      });
      await ledger.flush();

      const records = await ledger.readAll();
      expect(records).toHaveLength(3);
      expect(records[0].type).toBe("truth");
      expect(records[1].type).toBe("truth");
      expect(records[2].type).toBe("significance");
    });

    it("returns empty array when file does not exist", async () => {
      const ledger = new EvidenceLedger();
      ledger.bind(sessionFilePath());
      const records = await ledger.readAll();
      expect(records).toHaveLength(0);
    });

    it("returns empty array when not bound", async () => {
      const ledger = new EvidenceLedger();
      const records = await ledger.readAll();
      expect(records).toHaveLength(0);
    });

    it("skips malformed lines gracefully", async () => {
      // Write a file with one good line and one bad line
      await fs.writeFile(
        ledgerPath(),
        '{"type":"truth","ts":"2026-01-01","sessionId":"s1","messageKey":"k1","truthClass":"user_truth","confidence":1}\n' +
        'not valid json\n' +
        '{"type":"significance","ts":"2026-01-01","sessionId":"s1","messageKey":"k2","score":0.5,"signals":{"roleWeight":0.5,"informationDensity":0.5,"novelty":0.5}}\n',
      );

      const ledger = new EvidenceLedger();
      ledger.bind(sessionFilePath());
      const records = await ledger.readAll();
      expect(records).toHaveLength(2);
    });
  });

  describe("readGroundingHistory", () => {
    it("filters to grounding records only", async () => {
      const ledger = new EvidenceLedger();
      ledger.bind(sessionFilePath());

      ledger.appendTruthClassification("s1", "key1", "user_truth", 1.0);
      ledger.appendGroundingSnapshot("s1", {
        ratio: 0.8, tier: "healthy",
        breakdown: { user_truth: 4, grounded: 4, ungrounded: 2, unclassified: 0 },
        total: 10, classified: 10, timestamp: new Date().toISOString(),
      });
      ledger.appendGroundingSnapshot("s1", {
        ratio: 0.5, tier: "warning",
        breakdown: { user_truth: 2, grounded: 3, ungrounded: 5, unclassified: 0 },
        total: 10, classified: 10, timestamp: new Date().toISOString(),
      });
      await ledger.flush();

      const history = await ledger.readGroundingHistory();
      expect(history).toHaveLength(2);
      expect(history[0].ratio).toBe(0.8);
      expect(history[1].ratio).toBe(0.5);
    });
  });

  describe("dispose", () => {
    it("unbinds and clears buffer", () => {
      const ledger = new EvidenceLedger();
      ledger.bind(sessionFilePath());
      ledger.appendTruthClassification("s1", "key1", "user_truth", 1.0);

      ledger.dispose();
      expect(ledger.isBound).toBe(false);
      expect(ledger.pendingCount).toBe(0);
    });
  });
});

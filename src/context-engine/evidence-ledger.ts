import fs from "node:fs/promises";
import path from "node:path";
import type { TruthClass, GroundingSnapshot } from "./truth-boundary.js";
import type { SignificanceMeta } from "./significance-scorer.js";
import type { FactCategory } from "./temporal-decay.js";

// ---------------------------------------------------------------------------
// Evidence record types
// ---------------------------------------------------------------------------

interface EvidenceRecordBase {
  /** ISO timestamp when the record was written */
  ts: string;
  /** Session that produced this record */
  sessionId: string;
}

export interface TruthClassificationRecord extends EvidenceRecordBase {
  type: "truth";
  /** Content key for the classified message (role:timestamp:content prefix) */
  messageKey: string;
  truthClass: TruthClass;
  confidence: number;
}

export interface SignificanceRecord extends EvidenceRecordBase {
  type: "significance";
  messageKey: string;
  score: number;
  signals: { roleWeight: number; informationDensity: number; novelty: number };
  /** Temporal decay category, if classified */
  factCategory?: FactCategory;
}

export interface GroundingSnapshotRecord extends EvidenceRecordBase {
  type: "grounding";
  ratio: number;
  tier: string;
  breakdown: { user_truth: number; grounded: number; ungrounded: number; unclassified: number };
  total: number;
  classified: number;
}

export type EvidenceRecord =
  | TruthClassificationRecord
  | SignificanceRecord
  | GroundingSnapshotRecord;

// ---------------------------------------------------------------------------
// Evidence ledger — append-only JSONL persistence
// ---------------------------------------------------------------------------

/**
 * Append-only evidence ledger that persists truth classifications,
 * significance scores, and grounding snapshots to a JSONL file alongside
 * the session transcript.
 *
 * Design:
 * - One ledger file per session, co-located with the transcript
 * - Append-only: records are never modified or deleted
 * - Batched writes: records are buffered in memory and flushed together
 *   at natural lifecycle boundaries (afterTurn, compact)
 * - Crash-safe: partial writes leave valid JSONL (each line is independent)
 * - Sequential writes via async lock to prevent interleaving
 */
export class EvidenceLedger {
  private buffer: EvidenceRecord[] = [];
  private filePath: string | undefined;
  private writeInFlight: Promise<void> = Promise.resolve();

  /**
   * Derive the ledger file path from the session transcript path.
   * Call this once when the session file becomes known (bootstrap, afterTurn, compact).
   */
  bind(sessionFile: string): void {
    this.filePath = sessionFile.replace(/\.jsonl$/, ".evidence.ndjson");
  }

  /** Whether the ledger has been bound to a file path */
  get isBound(): boolean {
    return this.filePath !== undefined;
  }

  /** The resolved file path, if bound */
  get path(): string | undefined {
    return this.filePath;
  }

  // -------------------------------------------------------------------------
  // Record buffering
  // -------------------------------------------------------------------------

  appendTruthClassification(
    sessionId: string,
    messageKey: string,
    truthClass: TruthClass,
    confidence: number,
  ): void {
    this.buffer.push({
      type: "truth",
      ts: new Date().toISOString(),
      sessionId,
      messageKey,
      truthClass,
      confidence,
    });
  }

  appendSignificance(
    sessionId: string,
    messageKey: string,
    meta: SignificanceMeta,
    factCategory?: FactCategory,
  ): void {
    this.buffer.push({
      type: "significance",
      ts: new Date().toISOString(),
      sessionId,
      messageKey,
      score: meta.score,
      signals: meta.signals,
      factCategory,
    });
  }

  appendGroundingSnapshot(
    sessionId: string,
    snapshot: GroundingSnapshot,
  ): void {
    this.buffer.push({
      type: "grounding",
      ts: new Date().toISOString(),
      sessionId,
      ratio: snapshot.ratio,
      tier: snapshot.tier,
      breakdown: snapshot.breakdown,
      total: snapshot.total,
      classified: snapshot.classified,
    });
  }

  // -------------------------------------------------------------------------
  // Flush buffered records to disk
  // -------------------------------------------------------------------------

  /**
   * Flush all buffered records to the ledger file.
   * No-op if the ledger is not yet bound or the buffer is empty.
   * Sequential: waits for any prior flush to complete before starting.
   */
  async flush(): Promise<void> {
    if (!this.filePath || this.buffer.length === 0) return;

    const records = this.buffer.splice(0);
    const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const target = this.filePath;

    // Chain writes sequentially to prevent interleaving.
    // On failure, restore records to the front of the buffer so the next flush retries.
    this.writeInFlight = this.writeInFlight.then(async () => {
      try {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.appendFile(target, lines, { encoding: "utf-8", mode: 0o600 });
      } catch {
        this.buffer.unshift(...records);
      }
    });

    await this.writeInFlight;
  }

  /** Number of buffered records not yet flushed */
  get pendingCount(): number {
    return this.buffer.length;
  }

  // -------------------------------------------------------------------------
  // Reading (for cross-session queries, future features)
  // -------------------------------------------------------------------------

  /**
   * Read all evidence records from the ledger file.
   * Returns an empty array if the file doesn't exist.
   */
  async readAll(): Promise<EvidenceRecord[]> {
    if (!this.filePath) return [];

    let content: string;
    try {
      content = await fs.readFile(this.filePath, "utf-8");
    } catch {
      return []; // File doesn't exist yet
    }

    const records: EvidenceRecord[] = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed) as EvidenceRecord);
      } catch {
        // Skip malformed lines — append-only means partial writes are possible
      }
    }
    return records;
  }

  /**
   * Read only grounding snapshot records, useful for trend analysis.
   */
  async readGroundingHistory(): Promise<GroundingSnapshotRecord[]> {
    const all = await this.readAll();
    return all.filter((r): r is GroundingSnapshotRecord => r.type === "grounding");
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /** Discard buffered records without flushing */
  clear(): void {
    this.buffer.length = 0;
  }

  /** Unbind and discard buffer (for session cleanup) */
  dispose(): void {
    this.buffer.length = 0;
    this.filePath = undefined;
  }
}

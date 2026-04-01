export type {
  ContextEngine,
  ContextEngineInfo,
  AssembleResult,
  CompactResult,
  ContextEngineMaintenanceResult,
  ContextEngineRuntimeContext,
  IngestResult,
  TranscriptRewriteReplacement,
  TranscriptRewriteRequest,
  TranscriptRewriteResult,
} from "./types.js";

export {
  registerContextEngine,
  getContextEngineFactory,
  listContextEngineIds,
  resolveContextEngine,
} from "./registry.js";
export type { ContextEngineFactory } from "./registry.js";

export { LegacyContextEngine, registerLegacyContextEngine } from "./legacy.js";
export { delegateCompactionToRuntime } from "./delegate.js";

export { ensureContextEnginesInitialized } from "./init.js";

export {
  TruthBoundaryContextEngine,
  computeGroundingSnapshot,
  formatGroundingHealthNotice,
  formatTruthAnnotations,
} from "./truth-boundary.js";
export type {
  TruthClass,
  TruthMeta,
  GroundingTier,
  GroundingSnapshot,
} from "./truth-boundary.js";

export {
  scoreSignificance,
  SignificanceStore,
} from "./significance-scorer.js";
export type {
  SignificanceMeta,
  SignalBreakdown,
} from "./significance-scorer.js";

export {
  classifyFactCategory,
  computeDecayMultiplier,
  computeMessageDecay,
  decayLabel,
} from "./temporal-decay.js";
export type { FactCategory } from "./temporal-decay.js";

export { EvidenceLedger } from "./evidence-ledger.js";
export type {
  EvidenceRecord,
  TruthClassificationRecord,
  SignificanceRecord,
  GroundingSnapshotRecord,
} from "./evidence-ledger.js";

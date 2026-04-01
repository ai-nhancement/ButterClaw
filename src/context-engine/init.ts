import { LegacyContextEngine, registerLegacyContextEngine } from "./legacy.js";
import { registerContextEngineForOwner } from "./registry.js";
import { TruthBoundaryContextEngine } from "./truth-boundary.js";

/**
 * Ensures all built-in context engines are registered exactly once.
 *
 * The "legacy" slot is registered with a TruthBoundaryContextEngine wrapper
 * around the LegacyContextEngine. This activates truth classification,
 * significance scoring, grounding health monitoring, importance-weighted
 * filtering, and significance-aware compaction guidance for all conversations.
 *
 * The wrapper is transparent — all existing code that resolves "legacy" gets
 * the cognitive features automatically with no config changes needed.
 *
 * Additional engines can be registered by plugins via
 * `api.registerContextEngine()` during plugin load.
 */
let initialized = false;

export function ensureContextEnginesInitialized(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  // Register the truth boundary engine as the default "legacy" slot.
  // Wraps LegacyContextEngine transparently — all compaction, assembly,
  // and ingestion goes through truth classification + significance scoring.
  registerContextEngineForOwner(
    "legacy",
    () => new TruthBoundaryContextEngine(new LegacyContextEngine()),
    "core",
    { allowSameOwnerRefresh: true },
  );
}

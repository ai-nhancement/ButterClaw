import { LegacyContextEngine } from "./legacy.js";
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
 * The factory returns a singleton instance so that truth/significance stores
 * persist across multiple resolveContextEngine() calls within the same process.
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

  // Singleton: create once, return the same instance on every resolve.
  // This ensures truth stores, significance stores, and per-session state
  // survive across multiple resolveContextEngine() calls (agent run,
  // compaction, subagent lifecycle).
  let instance: TruthBoundaryContextEngine | undefined;

  registerContextEngineForOwner(
    "legacy",
    () => {
      if (!instance) {
        instance = new TruthBoundaryContextEngine(new LegacyContextEngine());
      }
      return instance;
    },
    "core",
    { allowSameOwnerRefresh: true },
  );
}

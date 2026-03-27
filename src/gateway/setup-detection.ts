/**
 * Shared setup-state detection for ButterClaw.
 *
 * Single source of truth for "does this system need first-run setup?"
 * Used by both the bootstrap config (control-ui.ts) and the setup API
 * (setup-api.ts) to avoid duplicated detection logic.
 */

import type { OpenClawConfig } from "../config/config.js";

/**
 * Detect whether the system has at least one configured AI provider.
 *
 * Checks two sources:
 *   1. Config auth profiles (openclaw.json → auth.profiles)
 *   2. Environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY)
 *
 * Returns true if ANY provider is configured via either source.
 */
export function hasConfiguredProvider(
  config: OpenClawConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // Check config auth profiles
  const profiles = config?.auth?.profiles;
  if (Array.isArray(profiles) && profiles.length > 0) {
    return true;
  }
  // Check env-based API keys (common for developers)
  if (env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY || env.GEMINI_API_KEY) {
    return true;
  }
  return false;
}

/**
 * Determine whether the system needs first-run setup.
 * Inverse of hasConfiguredProvider — returns true when no provider exists.
 */
export function needsFirstRunSetup(
  config: OpenClawConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !hasConfiguredProvider(config, env);
}

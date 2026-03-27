/**
 * Setup API + Detection — Tests
 *
 * Verifies provider detection, setup state detection, key pattern
 * validation (including cross-provider exclusion), and provider defaults.
 */

import { describe, it, expect } from "vitest";
import { SUPPORTED_PROVIDERS } from "./setup-api.js";
import { hasConfiguredProvider, needsFirstRunSetup } from "./setup-detection.js";

// ─── Provider definitions ────────────────────────────────────────────────────

describe("SUPPORTED_PROVIDERS", () => {
  it("includes anthropic, google, openai, and ollama", () => {
    const ids = SUPPORTED_PROVIDERS.map((p) => p.id);
    expect(ids).toContain("anthropic");
    expect(ids).toContain("google");
    expect(ids).toContain("openai");
    expect(ids).toContain("ollama");
  });

  it("has sensible defaults for each provider", () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      expect(provider.name.length).toBeGreaterThan(0);
      expect(provider.defaultModel.length).toBeGreaterThan(0);
      if (provider.requiresKey) {
        expect(provider.keyPattern.length).toBeGreaterThan(0);
        expect(provider.keyPlaceholder.length).toBeGreaterThan(0);
        expect(provider.getKeyUrl.length).toBeGreaterThan(0);
      }
    }
  });

  it("ollama does not require a key", () => {
    const ollama = SUPPORTED_PROVIDERS.find((p) => p.id === "ollama");
    expect(ollama).toBeDefined();
    expect(ollama!.requiresKey).toBe(false);
  });

  it("anthropic key pattern matches expected format", () => {
    const anthropic = SUPPORTED_PROVIDERS.find((p) => p.id === "anthropic");
    expect(anthropic).toBeDefined();
    const pattern = new RegExp(anthropic!.keyPattern);
    expect(pattern.test("sk-ant-api03-something")).toBe(true);
    expect(pattern.test("not-a-key")).toBe(false);
  });

  it("google key pattern matches expected format", () => {
    const google = SUPPORTED_PROVIDERS.find((p) => p.id === "google");
    expect(google).toBeDefined();
    const pattern = new RegExp(google!.keyPattern);
    expect(pattern.test("AIzaSy-something")).toBe(true);
    expect(pattern.test("not-a-key")).toBe(false);
  });

  it("openai key pattern matches expected format", () => {
    const openai = SUPPORTED_PROVIDERS.find((p) => p.id === "openai");
    expect(openai).toBeDefined();
    const pattern = new RegExp(openai!.keyPattern);
    expect(pattern.test("sk-proj-something")).toBe(true);
    expect(pattern.test("sk-something")).toBe(true);
    expect(pattern.test("not-a-key")).toBe(false);
  });

  it("openai key pattern does NOT match anthropic keys", () => {
    const openai = SUPPORTED_PROVIDERS.find((p) => p.id === "openai");
    expect(openai).toBeDefined();
    const pattern = new RegExp(openai!.keyPattern);
    // Anthropic keys start with sk-ant — must NOT pass the OpenAI check
    expect(pattern.test("sk-ant-api03-something")).toBe(false);
    expect(pattern.test("sk-ant-")).toBe(false);
  });
});

// ─── Setup detection (shared logic) ──────────────────────────────────────────

describe("hasConfiguredProvider", () => {
  it("returns false for undefined config and empty env", () => {
    expect(hasConfiguredProvider(undefined, {})).toBe(false);
  });

  it("returns false for empty config and empty env", () => {
    expect(hasConfiguredProvider({}, {})).toBe(false);
  });

  it("returns false for config with empty auth profiles", () => {
    expect(hasConfiguredProvider({ auth: { profiles: [] } } as any, {})).toBe(false);
  });

  it("returns true when config has auth profiles", () => {
    const config = {
      auth: {
        profiles: [{ id: "anthropic:setup", provider: "anthropic", apiKey: "sk-ant-test" }],
      },
    } as any;
    expect(hasConfiguredProvider(config, {})).toBe(true);
  });

  it("returns true when ANTHROPIC_API_KEY is in env", () => {
    expect(hasConfiguredProvider(undefined, { ANTHROPIC_API_KEY: "sk-ant-test" })).toBe(true);
  });

  it("returns true when OPENAI_API_KEY is in env", () => {
    expect(hasConfiguredProvider(undefined, { OPENAI_API_KEY: "sk-test" })).toBe(true);
  });

  it("returns true when GEMINI_API_KEY is in env", () => {
    expect(hasConfiguredProvider(undefined, { GEMINI_API_KEY: "AIza-test" })).toBe(true);
  });

  it("returns true when both config and env have providers", () => {
    const config = {
      auth: {
        profiles: [{ id: "test", provider: "openai", apiKey: "sk-test" }],
      },
    } as any;
    expect(hasConfiguredProvider(config, { ANTHROPIC_API_KEY: "sk-ant-test" })).toBe(true);
  });
});

describe("needsFirstRunSetup", () => {
  it("returns true when no providers configured", () => {
    expect(needsFirstRunSetup(undefined, {})).toBe(true);
  });

  it("returns false when provider exists in config", () => {
    const config = {
      auth: {
        profiles: [{ id: "test", provider: "anthropic", apiKey: "sk-ant-test" }],
      },
    } as any;
    expect(needsFirstRunSetup(config, {})).toBe(false);
  });

  it("returns false when provider exists in env", () => {
    expect(needsFirstRunSetup(undefined, { OPENAI_API_KEY: "sk-test" })).toBe(false);
  });
});

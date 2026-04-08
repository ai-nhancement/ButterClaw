/**
 * ButterClaw First-Run Setup API
 *
 * Provides a minimal HTTP API for the web-based setup page to configure
 * the system on first run. Two endpoints:
 *
 *   GET  /api/setup/status    → { needsSetup, hasProvider, providers }
 *   POST /api/setup/configure → accepts { provider, apiKey, model? }
 *
 * The configure endpoint writes a minimal auth profile and model defaults
 * to openclaw.json, then signals the runtime to reload config. After this
 * call, the Control UI redirects to the chat interface.
 *
 * Security: These endpoints only serve requests from loopback addresses.
 * The configure endpoint requires the gateway auth token.
 *
 * ButterClaw Enhancement — inspired by AiMe's principle that systems
 * should meet users where they are, not demand expertise before first use.
 * https://github.com/ai-nhancement/AiMe-public
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig } from "../config/config.js";
import { hasConfiguredProvider } from "./setup-detection.js";

// ─── Provider definitions ────────────────────────────────────────────────────

export interface ProviderInfo {
  id: string;
  name: string;
  defaultModel: string;
  keyPattern: string;
  keyPlaceholder: string;
  getKeyUrl: string;
  requiresKey: boolean;
}

export const SUPPORTED_PROVIDERS: ProviderInfo[] = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    defaultModel: "claude-sonnet-4-20250514",
    keyPattern: "^sk-ant-",
    keyPlaceholder: "sk-ant-api03-...",
    getKeyUrl: "https://console.anthropic.com/",
    requiresKey: true,
  },
  {
    id: "google",
    name: "Google (Gemini)",
    defaultModel: "gemini-2.5-flash",
    keyPattern: "^AIza",
    keyPlaceholder: "AIza...",
    getKeyUrl: "https://aistudio.google.com/",
    requiresKey: true,
  },
  {
    id: "openai",
    name: "OpenAI (GPT)",
    defaultModel: "gpt-4o",
    keyPattern: "^sk-(?!ant)",
    keyPlaceholder: "sk-proj-...",
    getKeyUrl: "https://platform.openai.com/api-keys",
    requiresKey: true,
  },
  {
    id: "ollama",
    name: "Local (Ollama)",
    defaultModel: "llama3",
    keyPattern: "",
    keyPlaceholder: "",
    getKeyUrl: "https://ollama.com/",
    requiresKey: false,
  },
];

// ─── Request/response types ──────────────────────────────────────────────────

interface SetupStatusResponse {
  needsSetup: boolean;
  hasProvider: boolean;
  providers: ProviderInfo[];
}

interface PersonaSetupPayload {
  voice?: "male" | "female" | "neutral";
  traits?: Record<string, number>;
}

interface SetupConfigureRequest {
  provider: string;
  apiKey?: string;
  model?: string;
  persona?: PersonaSetupPayload;
}

interface SetupConfigureResponse {
  ok: boolean;
  error?: string;
  redirect?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isLoopback(req: IncomingMessage): boolean {
  const addr = req.socket?.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false; // Guard against double resolution after req.destroy()
    const MAX_BODY = 16 * 1024; // 16KB — more than enough for an API key
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY && !settled) {
        settled = true;
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks).toString("utf-8"));
      }
    });
    req.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

// ─── Route handlers ──────────────────────────────────────────────────────────

export const SETUP_API_PREFIX = "/api/setup/";

/**
 * Handle setup API requests. Returns true if the request was handled.
 *
 * @param req - HTTP request
 * @param res - HTTP response
 * @param config - Current runtime config (may be empty on first run)
 * @param writeConfig - Callback to persist config changes
 * @param gatewayToken - Gateway auth token for securing the configure endpoint
 */
export function handleSetupApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: OpenClawConfig | undefined,
  writeConfig: (patch: Record<string, unknown>) => Promise<void>,
  gatewayToken?: string,
): boolean {
  const url = req.url ?? "";
  if (!url.startsWith(SETUP_API_PREFIX)) {
    return false;
  }

  // Security: only serve from loopback
  if (!isLoopback(req)) {
    sendJson(res, 403, { error: "Setup API is only available from localhost" });
    return true;
  }

  const route = url.slice(SETUP_API_PREFIX.length).split("?")[0];

  if (route === "status" && req.method === "GET") {
    handleStatus(res, config);
    return true;
  }

  if (route === "configure" && req.method === "POST") {
    // Authenticate: require gateway token when available.
    // On first run, gatewayToken may be undefined (no config yet). In that case
    // authentication is skipped — acceptable because the endpoint is already
    // restricted to loopback addresses only (checked above).
    const authHeader = req.headers.authorization ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (gatewayToken && token !== gatewayToken) {
      sendJson(res, 401, { error: "Invalid or missing gateway token" });
      return true;
    }
    handleConfigure(req, res, config, writeConfig).catch((err) => {
      console.error("[setup-api] configure error:", err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Internal error during setup" });
      }
    });
    return true;
  }

  sendJson(res, 404, { error: "Unknown setup endpoint" });
  return true;
}

// ─── GET /api/setup/status ───────────────────────────────────────────────────

function handleStatus(res: ServerResponse, config: OpenClawConfig | undefined): void {
  const hasProvider = hasConfiguredProvider(config);
  const response: SetupStatusResponse = {
    needsSetup: !hasProvider,
    hasProvider,
    providers: SUPPORTED_PROVIDERS,
  };
  sendJson(res, 200, response);
}

// ─── POST /api/setup/configure ───────────────────────────────────────────────

async function handleConfigure(
  req: IncomingMessage,
  res: ServerResponse,
  config: OpenClawConfig | undefined,
  writeConfig: (patch: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  let body: SetupConfigureRequest;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }

  // Validate provider
  const provider = SUPPORTED_PROVIDERS.find((p) => p.id === body.provider);
  if (!provider) {
    sendJson(res, 400, {
      ok: false,
      error: `Unknown provider: ${body.provider}. Supported: ${SUPPORTED_PROVIDERS.map((p) => p.id).join(", ")}`,
    });
    return;
  }

  // Validate API key (if required)
  if (provider.requiresKey) {
    if (!body.apiKey || typeof body.apiKey !== "string" || body.apiKey.trim().length < 10) {
      sendJson(res, 400, { ok: false, error: "API key is required for this provider" });
      return;
    }
    // Basic pattern check (not a live validation — just format)
    if (provider.keyPattern) {
      const pattern = new RegExp(provider.keyPattern);
      if (!pattern.test(body.apiKey.trim())) {
        sendJson(res, 400, {
          ok: false,
          error: `API key doesn't match expected format for ${provider.name}. Expected: ${provider.keyPlaceholder}`,
        });
        return;
      }
    }
  }

  // Build config patch — use Record<string, unknown> to avoid type escapes.
  // The writeConfig callback accepts a partial config object; the concrete
  // shape depends on which provider was selected.
  const model = body.model?.trim() || provider.defaultModel;
  const patch: Record<string, unknown> = {
    models: {
      defaults: {
        provider: provider.id,
        model,
      },
    },
  };

  // Add persona configuration if provided
  if (body.persona) {
    const voice = body.persona.voice ?? "neutral";
    const validVoices = ["male", "female", "neutral"];
    const traits: Record<string, number> = {};

    if (body.persona.traits && typeof body.persona.traits === "object") {
      for (const [key, val] of Object.entries(body.persona.traits)) {
        if (typeof val === "number" && Number.isFinite(val)) {
          traits[key] = Math.max(0, Math.min(1, val));
        }
      }
    }

    patch.persona = {
      voice: validVoices.includes(voice) ? voice : "neutral",
      traits,
    };
  }

  // Add auth profile if key provided
  if (body.apiKey && provider.requiresKey) {
    patch.auth = {
      profiles: [
        ...(config?.auth?.profiles ?? []),
        {
          id: `${provider.id}:setup`,
          provider: provider.id,
          apiKey: body.apiKey.trim(),
        },
      ],
    };
  }

  // Write config
  try {
    await writeConfig(patch);
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: `Failed to write config: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  console.log(`[setup-api] Configured provider: ${provider.name}, model: ${model}`);

  const response: SetupConfigureResponse = {
    ok: true,
    redirect: "/",
  };
  sendJson(res, 200, response);
}

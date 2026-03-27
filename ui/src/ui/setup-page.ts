/**
 * ButterClaw First-Run Setup Page
 *
 * A minimal, focused setup experience rendered when needsSetup is true
 * in the bootstrap config. Shows one page: pick provider, paste API key,
 * start chatting. No terminal required. Under 60 seconds to first conversation.
 *
 * Renders as a Lit html template, consistent with the Control UI architecture.
 */

import { html, nothing } from "lit";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SetupProvider {
  id: string;
  name: string;
  defaultModel: string;
  keyPlaceholder: string;
  getKeyUrl: string;
  requiresKey: boolean;
}

export interface SetupPageState {
  providers: SetupProvider[];
  selectedProvider: string;
  apiKey: string;
  status: "idle" | "loading" | "success" | "error";
  errorMessage: string;
}

// ─── Initial state ───────────────────────────────────────────────────────────

export function createSetupPageState(): SetupPageState {
  return {
    providers: [],
    selectedProvider: "",
    apiKey: "",
    status: "idle",
    errorMessage: "",
  };
}

// ─── Fetch providers from setup API ──────────────────────────────────────────

export async function loadSetupProviders(state: SetupPageState): Promise<void> {
  try {
    const res = await fetch("/api/setup/status", {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (!res.ok) {
      state.errorMessage = "Failed to load setup options.";
      return;
    }
    const data = await res.json();
    state.providers = data.providers ?? [];
    if (state.providers.length > 0 && !state.selectedProvider) {
      state.selectedProvider = state.providers[0].id;
    }
  } catch {
    state.errorMessage = "Cannot connect to ButterClaw gateway.";
  }
}

// ─── Submit configuration ────────────────────────────────────────────────────

export async function submitSetup(
  state: SetupPageState,
  gatewayToken?: string,
): Promise<boolean> {
  state.status = "loading";
  state.errorMessage = "";

  const provider = state.providers.find((p) => p.id === state.selectedProvider);
  if (!provider) {
    state.status = "error";
    state.errorMessage = "Please select a provider.";
    return false;
  }

  if (provider.requiresKey && (!state.apiKey || state.apiKey.trim().length < 10)) {
    state.status = "error";
    state.errorMessage = "Please paste a valid API key.";
    return false;
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (gatewayToken) {
      headers.Authorization = `Bearer ${gatewayToken}`;
    }

    const res = await fetch("/api/setup/configure", {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify({
        provider: state.selectedProvider,
        apiKey: provider.requiresKey ? state.apiKey.trim() : undefined,
      }),
    });

    // Handle non-JSON error responses (500, HTML error page, etc.)
    if (!res.ok) {
      let errorDetail = `Server error (${res.status})`;
      try {
        const data = await res.json();
        if (data.error) errorDetail = data.error;
      } catch {
        // Response wasn't JSON — use the status text
      }
      state.status = "error";
      state.errorMessage = errorDetail;
      return false;
    }

    const data = await res.json();
    if (data.ok) {
      state.status = "success";
      return true;
    }

    state.status = "error";
    state.errorMessage = data.error || "Setup failed. Please try again.";
    return false;
  } catch {
    state.status = "error";
    state.errorMessage = "Connection error. Is the gateway running?";
    return false;
  }
}

// ─── Render ──────────────────────────────────────────────────────────────────

export function renderSetupPage(
  state: SetupPageState,
  callbacks: {
    onProviderChange: (id: string) => void;
    onApiKeyChange: (key: string) => void;
    onSubmit: () => void;
  },
) {
  const providersLoading = state.providers.length === 0 && !state.errorMessage;
  const provider = state.providers.find((p) => p.id === state.selectedProvider);
  const showKeyInput = provider?.requiresKey ?? false;
  const isLoading = state.status === "loading";
  const isSuccess = state.status === "success";
  const isIdle = !isLoading && !isSuccess;

  return html`
    <style>${SETUP_PAGE_STYLES}</style>
    <div class="setup-page">
      <div class="setup-card">
        <div class="setup-header">
          <h1 class="setup-title">🧈 Welcome to ButterClaw</h1>
          <p class="setup-subtitle">Get started in three steps. You'll be chatting in under a minute.</p>
        </div>

        ${providersLoading
          ? html`<div class="setup-loading">Loading providers...</div>`
          : html`
            <div class="setup-steps">
              <!-- Step 1: Provider -->
              <div class="setup-step">
                <label class="setup-label">1. Choose your AI provider</label>
                <select
                  class="setup-select"
                  .value=${state.selectedProvider}
                  ?disabled=${!isIdle}
                  @change=${(e: Event) => {
                    const target = e.target as HTMLSelectElement;
                    callbacks.onProviderChange(target.value);
                  }}
                >
                  ${state.providers.map(
                    (p) => html`<option value=${p.id}>${p.name}</option>`,
                  )}
                </select>
              </div>

              <!-- Step 2: API Key (conditional) -->
              ${showKeyInput
                ? html`
                    <div class="setup-step">
                      <label class="setup-label">2. Paste your API key</label>
                      <input
                        type="password"
                        class="setup-input"
                        placeholder=${provider?.keyPlaceholder ?? "API key..."}
                        .value=${state.apiKey}
                        ?disabled=${!isIdle}
                        @input=${(e: Event) => {
                          const target = e.target as HTMLInputElement;
                          callbacks.onApiKeyChange(target.value);
                        }}
                        @keydown=${(e: KeyboardEvent) => {
                          if (e.key === "Enter" && isIdle) {
                            callbacks.onSubmit();
                          }
                        }}
                      />
                      ${provider?.getKeyUrl
                        ? html`<a
                            class="setup-key-link"
                            href=${provider.getKeyUrl}
                            target="_blank"
                            rel="noopener"
                            >Don't have one? Get a key →</a
                          >`
                        : nothing}
                    </div>
                  `
                : html`
                    <div class="setup-step">
                      <label class="setup-label">2. No API key needed for local models</label>
                      <p class="setup-hint">Make sure Ollama is running locally.</p>
                    </div>
                  `}

              <!-- Step 3: Go -->
              <div class="setup-step">
                <button
                  class="setup-button ${isSuccess ? "setup-button--success" : ""}"
                  ?disabled=${!isIdle}
                  @click=${callbacks.onSubmit}
                >
                  ${isLoading
                    ? "Configuring..."
                    : isSuccess
                      ? "✓ Ready — Reloading..."
                      : "Start Chatting"}
                </button>
                ${isSuccess
                  ? html`<a class="setup-reload-link" href="/" @click=${(e: Event) => {
                      e.preventDefault();
                      window.location.reload();
                    }}>Click here if the page doesn't reload automatically.</a>`
                  : nothing}
              </div>

              <!-- Error message -->
              ${state.errorMessage
                ? html`<div class="setup-error">${state.errorMessage}</div>`
                : nothing}
            </div>
          `}

        <div class="setup-footer">
          <p>You can configure channels, crons, and advanced settings later.</p>
          <p class="setup-footer-brand">
            Powered by <a href="https://github.com/ai-nhancement/AiMe-public" target="_blank" rel="noopener">AiMe</a> cognitive architecture.
          </p>
        </div>
      </div>
    </div>
  `;
}

// ─── Styles (injected into the host component's styles) ──────────────────────

export const SETUP_PAGE_STYLES = `
  .setup-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: var(--bg-primary, #0a0a0a);
    color: var(--text-primary, #e0e0e0);
    font-family: var(--font-family, system-ui, -apple-system, sans-serif);
    padding: 1rem;
  }

  .setup-card {
    width: 100%;
    max-width: 480px;
    background: var(--bg-secondary, #1a1a1a);
    border: 1px solid var(--border-primary, #333);
    border-radius: 12px;
    padding: 2.5rem;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
  }

  .setup-header {
    text-align: center;
    margin-bottom: 2rem;
  }

  .setup-title {
    font-size: 1.75rem;
    font-weight: 700;
    margin: 0 0 0.5rem;
    color: var(--text-primary, #e0e0e0);
  }

  .setup-subtitle {
    font-size: 0.95rem;
    color: var(--text-secondary, #999);
    margin: 0;
  }

  .setup-steps {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .setup-step {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .setup-label {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-primary, #e0e0e0);
  }

  .setup-select,
  .setup-input {
    width: 100%;
    padding: 0.65rem 0.8rem;
    font-size: 0.95rem;
    background: var(--bg-primary, #0a0a0a);
    color: var(--text-primary, #e0e0e0);
    border: 1px solid var(--border-primary, #444);
    border-radius: 6px;
    outline: none;
    transition: border-color 0.15s;
    box-sizing: border-box;
  }

  .setup-select:focus,
  .setup-input:focus {
    border-color: var(--accent-primary, #6b8afd);
  }

  .setup-select:disabled,
  .setup-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .setup-key-link {
    font-size: 0.8rem;
    color: var(--accent-primary, #6b8afd);
    text-decoration: none;
  }

  .setup-key-link:hover {
    text-decoration: underline;
  }

  .setup-hint {
    font-size: 0.85rem;
    color: var(--text-secondary, #999);
    margin: 0;
  }

  .setup-button {
    width: 100%;
    padding: 0.75rem;
    font-size: 1rem;
    font-weight: 600;
    background: var(--accent-primary, #6b8afd);
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
    margin-top: 0.5rem;
  }

  .setup-button:hover:not(:disabled) {
    background: var(--accent-hover, #5a7aed);
  }

  .setup-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .setup-button--success {
    background: #2ea44f;
  }

  .setup-loading {
    text-align: center;
    padding: 2rem 0;
    font-size: 0.95rem;
    color: var(--text-secondary, #999);
  }

  .setup-reload-link {
    display: block;
    text-align: center;
    font-size: 0.8rem;
    color: var(--text-secondary, #999);
    margin-top: 0.5rem;
    text-decoration: underline;
    cursor: pointer;
  }

  .setup-error {
    padding: 0.6rem 0.8rem;
    font-size: 0.85rem;
    background: rgba(220, 50, 50, 0.15);
    color: #f87171;
    border: 1px solid rgba(220, 50, 50, 0.3);
    border-radius: 6px;
  }

  .setup-footer {
    margin-top: 2rem;
    text-align: center;
    font-size: 0.8rem;
    color: var(--text-secondary, #777);
  }

  .setup-footer p {
    margin: 0.3rem 0;
  }

  .setup-footer-brand a {
    color: var(--accent-primary, #6b8afd);
    text-decoration: none;
  }

  .setup-footer-brand a:hover {
    text-decoration: underline;
  }
`;

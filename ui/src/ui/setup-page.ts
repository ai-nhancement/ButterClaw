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

export interface PersonaSetupTrait {
  id: string;
  label: string;
  lowLabel: string;
  highLabel: string;
  /** 0.0 = low pole, 0.5 = balanced, 1.0 = high pole */
  value: number;
}

export type PersonaVoiceChoice = "male" | "female" | "neutral";

export interface SetupPageState {
  providers: SetupProvider[];
  selectedProvider: string;
  apiKey: string;
  status: "idle" | "loading" | "success" | "error";
  errorMessage: string;
  /** Multi-step wizard: "provider" → "persona" → "confirm" */
  step: "provider" | "persona" | "confirm";
  personaVoice: PersonaVoiceChoice;
  personaTraits: PersonaSetupTrait[];
}

// ─── Initial state ───────────────────────────────────────────────────────────

export function createSetupPageState(): SetupPageState {
  return {
    providers: [],
    selectedProvider: "",
    apiKey: "",
    status: "idle",
    errorMessage: "",
    step: "provider",
    personaVoice: "neutral",
    personaTraits: [
      { id: "formality",     label: "Formality",       lowLabel: "Professional", highLabel: "Casual",        value: 0.5 },
      { id: "warmth",        label: "Warmth",          lowLabel: "Reserved",     highLabel: "Warm",          value: 0.5 },
      { id: "humor",         label: "Humor",           lowLabel: "Serious",      highLabel: "Playful",       value: 0.5 },
      { id: "verbosity",     label: "Verbosity",       lowLabel: "Concise",      highLabel: "Thorough",      value: 0.5 },
      { id: "directness",    label: "Directness",      lowLabel: "Diplomatic",   highLabel: "Blunt",         value: 0.5 },
      { id: "encouragement", label: "Encouragement",   lowLabel: "Matter-of-fact", highLabel: "Cheerleader", value: 0.5 },
      { id: "depth",         label: "Technical Depth",  lowLabel: "Simplified",   highLabel: "Deep-dive",     value: 0.5 },
      { id: "proactivity",   label: "Proactivity",     lowLabel: "Reactive",     highLabel: "Anticipatory",  value: 0.5 },
      { id: "expressiveness", label: "Expressiveness", lowLabel: "Text-only",    highLabel: "Emoji-rich",    value: 0.5 },
    ],
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
        persona: {
          voice: state.personaVoice,
          traits: Object.fromEntries(
            state.personaTraits.map((t) => [t.id, t.value]),
          ),
        },
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
    onStepChange: (step: "provider" | "persona" | "confirm") => void;
    onVoiceChange: (voice: PersonaVoiceChoice) => void;
    onTraitChange: (traitId: string, value: number) => void;
  },
) {
  const providersLoading = state.providers.length === 0 && !state.errorMessage;
  const provider = state.providers.find((p) => p.id === state.selectedProvider);
  const showKeyInput = provider?.requiresKey ?? false;
  const isLoading = state.status === "loading";
  const isSuccess = state.status === "success";
  const isIdle = !isLoading && !isSuccess;

  const goToStep = (step: "provider" | "persona" | "confirm") => {
    callbacks.onStepChange(step);
  };

  return html`
    <style>${SETUP_PAGE_STYLES}</style>
    <div class="setup-page">
      <div class="setup-card ${state.step === "persona" ? "setup-card--wide" : ""}">
        <div class="setup-header">
          <h1 class="setup-title">🧈 Welcome to ButterClaw</h1>
          <p class="setup-subtitle">${
            state.step === "provider"
              ? "Let's get you connected first."
              : state.step === "persona"
                ? "Now let's shape your assistant's personality."
                : "You're all set!"
          }</p>
          <!-- Step indicator -->
          <div class="setup-step-indicator">
            <span class="step-dot ${state.step === "provider" ? "step-dot--active" : "step-dot--done"}"></span>
            <span class="step-dot ${state.step === "persona" ? "step-dot--active" : state.step === "confirm" ? "step-dot--done" : ""}"></span>
            <span class="step-dot ${state.step === "confirm" ? "step-dot--active" : ""}"></span>
          </div>
        </div>

        ${providersLoading && state.step === "provider"
          ? html`<div class="setup-loading">Loading providers...</div>`
          : nothing}

        <!-- Step 1: Provider + API Key -->
        ${state.step === "provider" ? html`
          <div class="setup-steps">
            <div class="setup-step">
              <label class="setup-label">Choose your AI provider</label>
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

            ${showKeyInput
              ? html`
                  <div class="setup-step">
                    <label class="setup-label">Paste your API key</label>
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
                        if (e.key === "Enter" && isIdle) goToStep("persona");
                      }}
                    />
                    ${provider?.getKeyUrl
                      ? html`<a class="setup-key-link" href=${provider.getKeyUrl} target="_blank" rel="noopener">Don't have one? Get a key →</a>`
                      : nothing}
                  </div>
                `
              : html`
                  <div class="setup-step">
                    <label class="setup-label">No API key needed for local models</label>
                    <p class="setup-hint">Make sure Ollama is running locally.</p>
                  </div>
                `}

            <div class="setup-step">
              <button
                class="setup-button"
                ?disabled=${!isIdle || (showKeyInput && (!state.apiKey || state.apiKey.trim().length < 10))}
                @click=${() => goToStep("persona")}
              >Next — Personalize →</button>
            </div>

            ${state.errorMessage
              ? html`<div class="setup-error">${state.errorMessage}</div>`
              : nothing}
          </div>
        ` : nothing}

        <!-- Step 2: Persona -->
        ${state.step === "persona" ? html`
          <div class="setup-steps">
            <div class="setup-step">
              <label class="setup-label">Voice</label>
              <div class="persona-toggle-row">
                ${(["male", "female", "neutral"] as const).map((v) => html`
                  <button
                    class="persona-toggle-btn ${state.personaVoice === v ? "persona-toggle-btn--active" : ""}"
                    @click=${() => callbacks.onVoiceChange(v)}
                  >${v.charAt(0).toUpperCase() + v.slice(1)}</button>
                `)}
              </div>
            </div>

            ${state.personaTraits.map((trait) => html`
              <div class="setup-step persona-trait">
                <label class="setup-label">${trait.label}</label>
                <div class="persona-toggle-row">
                  <button
                    class="persona-toggle-btn ${trait.value === 0.0 ? "persona-toggle-btn--active" : ""}"
                    @click=${() => callbacks.onTraitChange(trait.id, 0.0)}
                  >${trait.lowLabel}</button>
                  <button
                    class="persona-toggle-btn ${trait.value === 0.5 ? "persona-toggle-btn--active" : ""}"
                    @click=${() => callbacks.onTraitChange(trait.id, 0.5)}
                  >Balanced</button>
                  <button
                    class="persona-toggle-btn ${trait.value === 1.0 ? "persona-toggle-btn--active" : ""}"
                    @click=${() => callbacks.onTraitChange(trait.id, 1.0)}
                  >${trait.highLabel}</button>
                </div>
              </div>
            `)}

            <div class="setup-step persona-nav-row">
              <button class="setup-button setup-button--secondary" @click=${() => goToStep("provider")}>← Back</button>
              <button class="setup-button" @click=${() => goToStep("confirm")}>Next — Finish →</button>
            </div>

            <p class="setup-hint" style="text-align:center;">
              Don't overthink it — these adapt as you chat.
            </p>
          </div>
        ` : nothing}

        <!-- Step 3: Confirm -->
        ${state.step === "confirm" ? html`
          <div class="setup-steps">
            <div class="setup-step" style="text-align:center;">
              <p class="setup-confirm-summary">
                <strong>${provider?.name ?? state.selectedProvider}</strong> provider
                with a <strong>${state.personaVoice}</strong>,
                <strong>${describeTraitMix(state.personaTraits)}</strong> personality.
              </p>
              <p class="setup-hint">Your persona adapts as you chat — this is just the starting point.</p>
            </div>

            <div class="setup-step persona-nav-row">
              <button class="setup-button setup-button--secondary" ?disabled=${!isIdle} @click=${() => goToStep("persona")}>← Back</button>
              <button
                class="setup-button ${isSuccess ? "setup-button--success" : ""}"
                ?disabled=${!isIdle}
                @click=${callbacks.onSubmit}
              >${isLoading ? "Configuring..." : isSuccess ? "✓ Ready — Reloading..." : "Start Chatting"}</button>
            </div>

            ${isSuccess
              ? html`<a class="setup-reload-link" href="/" @click=${(e: Event) => {
                  e.preventDefault();
                  window.location.reload();
                }}>Click here if the page doesn't reload automatically.</a>`
              : nothing}

            ${state.errorMessage
              ? html`<div class="setup-error">${state.errorMessage}</div>`
              : nothing}
          </div>
        ` : nothing}

        <div class="setup-footer">
          <p>You can fine-tune personality and settings anytime later.</p>
          <p class="setup-footer-brand">
            Powered by <a href="https://github.com/ai-nhancement/AiMe-public" target="_blank" rel="noopener">AiMe</a> cognitive architecture.
          </p>
        </div>
      </div>
    </div>
  `;
}

/** Summarize the trait mix into a short human-readable phrase. */
function describeTraitMix(traits: PersonaSetupTrait[]): string {
  const notable: string[] = [];
  for (const t of traits) {
    if (t.value === 0.0) notable.push(t.lowLabel.toLowerCase());
    else if (t.value === 1.0) notable.push(t.highLabel.toLowerCase());
  }
  if (notable.length === 0) return "balanced";
  if (notable.length <= 3) return notable.join(", ");
  return notable.slice(0, 3).join(", ") + ` + ${notable.length - 3} more`;
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

  /* Wide card for persona step */
  .setup-card--wide {
    max-width: 560px;
  }

  /* Step indicator dots */
  .setup-step-indicator {
    display: flex;
    justify-content: center;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .step-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--border-primary, #444);
    transition: background 0.2s;
  }

  .step-dot--active {
    background: var(--accent-primary, #6b8afd);
  }

  .step-dot--done {
    background: #2ea44f;
  }

  /* Persona toggle buttons */
  .persona-toggle-row {
    display: flex;
    gap: 0.35rem;
  }

  .persona-toggle-btn {
    flex: 1;
    padding: 0.45rem 0.3rem;
    font-size: 0.8rem;
    font-weight: 500;
    background: var(--bg-primary, #0a0a0a);
    color: var(--text-secondary, #999);
    border: 1px solid var(--border-primary, #444);
    border-radius: 5px;
    cursor: pointer;
    transition: all 0.15s;
    text-align: center;
    white-space: nowrap;
  }

  .persona-toggle-btn:hover {
    border-color: var(--accent-primary, #6b8afd);
    color: var(--text-primary, #e0e0e0);
  }

  .persona-toggle-btn--active {
    background: var(--accent-primary, #6b8afd);
    color: #fff;
    border-color: var(--accent-primary, #6b8afd);
  }

  .persona-trait {
    gap: 0.25rem !important;
  }

  /* Navigation row with back + next */
  .persona-nav-row {
    display: flex;
    gap: 0.75rem;
    flex-direction: row !important;
  }

  .setup-button--secondary {
    flex: 0 0 auto;
    background: transparent;
    color: var(--text-secondary, #999);
    border: 1px solid var(--border-primary, #444);
  }

  .setup-button--secondary:hover:not(:disabled) {
    color: var(--text-primary, #e0e0e0);
    border-color: var(--text-secondary, #999);
    background: transparent;
  }

  .setup-confirm-summary {
    font-size: 1rem;
    line-height: 1.5;
    color: var(--text-primary, #e0e0e0);
    margin: 0.5rem 0;
  }
`;

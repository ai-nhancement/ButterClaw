<p align="center">
  <img src="docs/assets/BC_logo.png" alt="ButterClaw" width="500">
</p>

<h1 align="center">ButterClaw</h1>

<p align="center">
  <strong>AiMe's governed cognitive architecture + TinkerClaw's channel integrations.</strong><br>
  <em>The brain of one. The reach of the other.</em>
</p>

<p align="center">
  <a href="https://github.com/ai-nhancement/AiMe-public"><img src="https://img.shields.io/badge/core-AiMe-2ea44f?style=for-the-badge" alt="Core: AiMe"></a>
  <a href="https://github.com/globalcaos/tinkerclaw"><img src="https://img.shields.io/badge/channels_from-TinkerClaw-8B6914?style=for-the-badge" alt="Channels: TinkerClaw"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-604020?style=for-the-badge" alt="MIT License"></a>
</p>

---

## What Is ButterClaw?

ButterClaw is a merge of two projects heading in the same direction from different starting points.

**[AiMe (Amy)](https://github.com/ai-nhancement/AiMe-public)** is a governed cognitive architecture that has been in continuous daily use since November 2025 — built by a single developer. It has append-only truth separation, a six-layer living portrait, governed proactive initiative, behavioral integrity metrics (RIC, SRL, UVRG), significance-scored memory, and temporal scoping.

**[OpenClaw / TinkerClaw](https://github.com/globalcaos/tinkerclaw)** independently developed a strikingly similar cognitive architecture (ENGRAM, CORTEX, LIMBIC, SYNAPSE, HIPPOCAMPUS) using the same neuroscience-inspired naming conventions. It also has messaging channel integrations (WhatsApp, Discord, Telegram, Slack, Teams), a plugin SDK, multi-agent support, humor and debate subsystems, and a React dashboard.

Both projects arrived at remarkably similar designs through independent parallel development. AiMe's neuroscience-inspired naming (hippocampus, thalamus, cortex, occipital lobe) was chosen personally by its developer — not suggested by AI tools. How OpenClaw converged on nearly identical terminology (ENGRAM, CORTEX, LIMBIC, SYNAPSE, HIPPOCAMPUS) independently is an open question. The overlap in naming, structure, and goals was discovered only when this fork was created.

**ButterClaw** bridges the gap between them. Where AiMe goes deeper (enforcement, integrity scoring, value extraction, governed initiative), ButterClaw brings those capabilities to the OpenClaw ecosystem. Where OpenClaw goes broader (channels, humor, debate, distribution), ButterClaw inherits that reach.

---

## Why This Exists

AiMe was built around a principle that most AI projects still avoid: **Human-Led, System-Controlled.** The human retains authority. The system governs execution. The model is a subordinate narrator — it does not route, own memory, control initiative, or decide when to speak.

That architecture produces something different from what most agent frameworks deliver. After months of daily use, the system knows who the user is, what matters to them, what concerns are open, and what should be surfaced at the right moment. It references personal details naturally in conversation. It reminds you about your evening medication woven into a goodnight message. It leads with your daughter's birthday before the morning emails. It adjusts its tone based on whether you were up late the night before.

None of that comes from the model. All of it comes from the system.

What AiMe lacked was reach. It ran on a local web UI. No mobile. No messaging platforms. No way for the system to follow you outside the workshop.

TinkerClaw and OpenClaw solved that distribution problem. WhatsApp, Discord, Telegram, Slack, Teams — all wired up and working. They also independently built a substantial cognitive architecture — ENGRAM, CORTEX, LIMBIC, SYNAPSE — with a six-layer persona state, behavioral probes, humor generation, and multi-model debate. Where they differ from AiMe is in depth: passive truth classification instead of active enforcement, cron scheduling instead of governed initiative with absence tiers, and basic importance scoring instead of multi-layer significance.

ButterClaw takes the parts each project does best and combines them.

---

## How the Codebases Compare

This is not a claim — it is a comparison of what exists in each codebase as of March 2026. OpenClaw and TinkerClaw already have a substantial cognitive architecture (ENGRAM, CORTEX, LIMBIC, SYNAPSE, HIPPOCAMPUS) that was built independently using similar neuroscience-inspired naming conventions. The differences are in depth of implementation, not in whether the concepts exist.

| Capability | AiMe (Python, local) | OpenClaw / TinkerClaw (TypeScript, distributed) | ButterClaw additions |
|-----------|------|------------|----------|
| **Append-only evidence ledger** | Immutable SQLite, 3-tier (ledger + UT + VAT), WAL mode | JSONL event store with ULID ordering, 19 event kinds, append-only invariant | Truth-class metadata on all events |
| **Truth separation** | User Truth vs. VAT formally enforced; WordNet + Wikidata external anchors; blocks inference when integrity fails | 4-class system (user_truth, grounded, ungrounded, unclassified); classification computed but passive | Active truth boundary layer, grounding ratio monitor with health tiers |
| **Living portrait** | Six layers live: identity, relational graph, concerns, commitments, behavioral fingerprint, patterns; temporal decay per fact class; concern arcs with lifecycle tracking | Six-layer PersonaState schema: identity, hard rules, traits, voice markers, relational state, humor calibration; drift detection framework exists | — |
| **Importance-weighted retrieval** | Hybrid RRF fusion (Meilisearch + Qdrant), rolling topic vectors, significance filtering, pair-aware context | FTS top-50 with task-conditioned scoring, MMR deduplication, episodic tier | Importance multiplier (0.6x–1.4x) wired into retrieval pipeline |
| **Governed initiative** | ThalamoFrontalLoop: 6 signal producers, 5 absence tiers, significance gating, spam prevention, preference learning, deferred signals | Cron service with quiet hours enforcement, heartbeat scheduling | — |
| **Significance scoring** | Three-layer: affect (0.30) + novelty (0.30) + resolution (0.25) + echo (0.15); plus email, event, and semantic scorers | Basic 1–10 importance field; HIPPOCAMPUS recency/frequency/connection scoring | — |
| **Temporal scoping** | Per-fact-class decay windows (permanent → momentary), half-life math, reaffirmation tracking, time-windowed retrieval | Time-range markers for evicted events, recency-based temporal decay | — |
| **Behavioral integrity** | RIC (5-factor: groundedness, calibration, transparency, helpfulness, pressure resistance), SRL (4 traits, honesty gate, drift index, 34 tests), UVRG | Behavioral probes (hard rule, style, full audit), consistency metric, drift detection with EWMA, convergence monitor | — |
| **Value extraction** | Ethos pipeline: 15 values, `score = demonstrations x significance x resistance x consistency`, no LLM calls | None | — |
| **Model routing** | Six governed lanes (base, vision, planning, tech, local, game) with rotation | Per-agent model selection with failover chains, Smart Router V2 | — |
| **Messaging channels** | Local web UI only | WhatsApp, Discord, Telegram, Slack, Teams | Same |
| **Plugin SDK** | Internal plugin bus | Structured skill SDK with 70+ bundled skills | — |
| **Multi-machine agents** | Single instance | Distributed agents with routing, Docker/sandbox ready | — |
| **Humor system** | None | LIMBIC: mathematical humor potential (h_v2), 12 pattern types, bridge discovery, sensitivity gates | — |
| **Debate / deliberation** | None | SYNAPSE: 5-phase RAAC protocol, cognitive diversity matching, cost-tracked multi-model debate | — |

**The biggest philosophical difference:** AiMe treats the user-AI interaction as a **relationship** — a persistent bond with trust, demonstrated values, and relational integrity measured over time. RIC tracks the health of that bond. UVRG extracts values from lived behavioral evidence. The living portrait models who the user is as a person, not just a preference profile. OpenClaw/TinkerClaw treats the interaction as a **capability** — powerful tools, humor, debate, multi-channel reach, but without the relational foundation.

**AiMe is deeper on cognition and relationship. OpenClaw/TinkerClaw is broader on distribution and infrastructure. ButterClaw bridges the gap.**

---

## The Architecture

ButterClaw's cognitive core blends AiMe's governed pipeline with OpenClaw's existing cognitive subsystems:

```
User Input (from any channel: web, WhatsApp, Discord, Telegram, Slack, Teams)
    |
LogicCore              -- Router + orchestrator
    |
PrefrontalCortex       -- Deterministic lane selection
    |
CognitiveBridge        -- Execution spine, tool routing
    |
LanguageModel          -- Single LLM call per turn, dispatched to provider
    |
LanguageCortex         -- Sole narrator
    |
Channel Output         -- Response delivered back to originating platform
```

### Memory (ENGRAM + HIPPOCAMPUS)

- **Evidence Ledger** — Append-only JSONL event store with ULID ordering (OpenClaw). AiMe adds immutable SQLite with WAL mode and 3-tier separation (ledger + UT + VAT).
- **Truth Separation** — OpenClaw classifies events into 4 truth classes (user_truth, grounded, ungrounded, unclassified). ButterClaw adds active truth boundary enforcement and grounding ratio monitoring. AiMe goes further with external anchors (WordNet + Wikidata) and inference blocking.
- **Retrieval** — OpenClaw: FTS with task-conditioned scoring, MMR deduplication, episodic tier. AiMe: hybrid RRF fusion (Meilisearch + Qdrant), rolling topic vectors, significance filtering. ButterClaw adds importance-weighted multipliers to OpenClaw's pipeline.
- **Significance Filtering** — OpenClaw: basic 1–10 importance with HIPPOCAMPUS recency/frequency scoring. AiMe: three-layer formula (affect + novelty + resolution + echo) with email/event/semantic scorers.

### Identity (CORTEX)

- **Living Portrait** — Both AiMe and OpenClaw implement six-layer persona models. OpenClaw: identity, hard rules, traits, voice markers, relational state, humor calibration. AiMe: identity anchors, relational graph, active concerns, commitments, behavioral fingerprint, patterns — with temporal decay per fact class and concern arc lifecycle tracking.
- **Behavioral Integrity** — OpenClaw: behavioral probes (hard rule, style, full audit), consistency metric, drift detection with EWMA. AiMe adds RIC (5-factor integrity score with pressure detection), SRL (4 traits, honesty gate, drift index), and UVRG (demonstrated values extraction).

### Humor & Debate (LIMBIC + SYNAPSE) — OpenClaw originals

- **LIMBIC** — Mathematical humor potential function (h_v2), 12 humor pattern types, bridge discovery, sensitivity gates. These do not exist in AiMe.
- **SYNAPSE** — 5-phase RAAC debate protocol, cognitive diversity matching, cost-tracked multi-model deliberation. These do not exist in AiMe.

### Initiative

- **OpenClaw** — Cron service with quiet hours enforcement and heartbeat scheduling.
- **AiMe** — ThalamoFrontalLoop: 6 signal producers, 5 absence tiers, significance gating, spam prevention, preference learning. The model never decides when to speak — the system does.
- **ButterClaw goal** — Port AiMe's governed initiative into OpenClaw's cron infrastructure.

### Values (AiMe only)

- **Ethos UVRG** — Extracts demonstrated values from real behavioral evidence. `score = demonstrations x significance x resistance x consistency`. 15 tracked values, no LLM calls. Does not yet exist in OpenClaw.
- **Environmentally Trained Models** — The long-term direction: training models inside their operating environment on trajectories generated from real relationship evidence.

---

## Timeline

| Date | Event |
|------|-------|
| **November 2025** | AiMe development begins |
| **February 2026** | AiMe v2 repository initiated |
| **March 2026** | Living portrait, governed initiative, behavioral integrity, significance scoring, temporal scoping, event graph — all live and in daily use |
| **March 2026** | ButterClaw created — merging AiMe's architecture with TinkerClaw's channel layer |

AiMe has been in continuous daily use for over four months. The blog posts, essays, and architecture documents are timestamped and publicly available.

---

## Read More

The thinking behind this architecture is documented in detail:

### From the AiMe Project

- **[Project Documentation](https://github.com/ai-nhancement/AiMe-public)** — Full README, architecture docs, vision documents
- **[A Day in the Life with Amy](https://github.com/ai-nhancement/AiMe-public/blob/master/essays/a_day_in_the_life_with_amy.md)** — Real conversations quoted from the evidence ledger showing what daily use looks like
- **[Why the Model Is Not the Product](https://github.com/ai-nhancement/AiMe-public/blob/master/blog/01_why_the_model_is_not_the_product.md)** — The foundational argument
- **[Tools or Collaborators](https://github.com/ai-nhancement/AiMe-public/blob/master/blog/02_tools_or_collaborators.md)** — The fork nobody wants to talk about
- **[Values, Not Rules](https://github.com/ai-nhancement/AiMe-public/blob/master/blog/03_values_not_rules.md)** — Why we cannot prompt our way to trust
- **[The Bond](https://github.com/ai-nhancement/AiMe-public/blob/master/architecture/the_bond.md)** — The relational primitive at the center of the system

### From TinkerClaw

- [TinkerClaw Original README](https://github.com/globalcaos/tinkerclaw)
- [OpenClaw Original](https://github.com/openclaw/openclaw)

---

## Status

ButterClaw is in early integration. The AiMe cognitive core is stable and in daily use. Channel integration from TinkerClaw is being adapted to work inside the governed architecture.

**Phase 1:** Messaging channel bridge (WhatsApp, Discord, Telegram → LogicCore input path)
**Phase 2:** Plugin SDK adaptation (TinkerClaw skills as governed tools)
**Phase 3:** Distributed agent support (multi-instance AiMe)

---

## About

ButterClaw is maintained by [ai-nhancement](https://github.com/ai-nhancement).

AiMe was built by a single developer starting in November 2025. The entire cognitive architecture — pipeline, memory, portrait, initiative, integrity, routing, and all supporting infrastructure — was designed and implemented solo.

> *"The model is not the AI. The model is a component. The system is the intelligence."*

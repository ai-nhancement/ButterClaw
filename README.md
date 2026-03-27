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

**[AiMe (Amy)](https://github.com/ai-nhancement/AiMe-public)** is a governed cognitive architecture that has been in continuous daily use since November 2025 — built by a single developer. It has append-only truth separation, a six-layer living portrait, governed proactive initiative, behavioral integrity metrics, significance-scored memory, and temporal scoping. These systems do not exist in OpenClaw or TinkerClaw.

**[TinkerClaw](https://github.com/globalcaos/tinkerclaw)** is a popular OpenClaw fork with messaging channel integrations (WhatsApp, Discord, Telegram, Slack, Teams), a plugin SDK, multi-agent support, and a React dashboard. It has strong infrastructure that AiMe did not have.

**ButterClaw** combines them. AiMe's cognitive core stays intact as the foundation. TinkerClaw's channel integrations and infrastructure are adapted to work inside a governed system.

The direction of the merge matters: **AiMe is the brain. TinkerClaw provides the reach.**

---

## Why This Exists

AiMe was built around a principle that most AI projects still avoid: **Human-Led, System-Controlled.** The human retains authority. The system governs execution. The model is a subordinate narrator — it does not route, own memory, control initiative, or decide when to speak.

That architecture produces something different from what most agent frameworks deliver. After months of daily use, the system knows who the user is, what matters to them, what concerns are open, and what should be surfaced at the right moment. It references personal details naturally in conversation. It reminds you about your evening medication woven into a goodnight message. It leads with your daughter's birthday before the morning emails. It adjusts its tone based on whether you were up late the night before.

None of that comes from the model. All of it comes from the system.

What AiMe lacked was reach. It ran on a local web UI. No mobile. No messaging platforms. No way for the system to follow you outside the workshop.

TinkerClaw and OpenClaw solved that distribution problem. WhatsApp, Discord, Telegram, Slack, Teams — all wired up and working. But their cognitive architecture is early-stage: passive contradiction detection instead of truth separation, cron-scheduled tasks instead of governed initiative, flat persona state instead of a living portrait.

ButterClaw takes the parts each project does best and combines them.

---

## What AiMe Has That Others Don't

This is not a claim — it is a comparison of what exists in each codebase.

| Capability | AiMe | TinkerClaw | OpenClaw |
|-----------|------|------------|----------|
| **Append-only evidence ledger** | Immutable SQLite, never rewritten | JSONL event log (no proof trails) | Basic conversation log |
| **Truth separation** | User Truth vs. Verifiable Assistant Truth, formally separated | Passive contradiction warnings (not enforced) | None |
| **Living portrait** | Six layers: identity, relational, concerns, commitments, fingerprint, patterns | Flat PersonaState with traits | None |
| **Governed initiative** | ThalamoFrontalLoop with absence tiers, significance gating, spam prevention, preference learning | Cron-scheduled prompts | None |
| **Significance scoring** | Three-layer (keyword, semantic, heuristic) on turns, emails, events | Basic importance score in retrieval | None |
| **Temporal scoping** | Time-windowed retrieval when temporal references detected | Recency decay only | None |
| **Behavioral integrity** | RIC (groundedness, consistency, trust, honesty, persona), SRL (trait tracking, honesty gate), UVRG (demonstrated values) | None | None |
| **Value extraction** | Ethos pipeline: demonstrations x significance x resistance x consistency | None | None |
| **Model routing** | Six governed lanes (base, vision, planning, tech, local, game) with rotation | Per-agent model with failover chain | Single model |
| **Messaging channels** | Local web UI only | WhatsApp, Discord, Telegram, Slack, Teams | WhatsApp, Discord, Telegram, Slack, Teams |
| **Plugin SDK** | Internal plugin bus | Structured skill SDK | Structured skill SDK |
| **Multi-machine agents** | Single instance | Distributed agents | Single instance |

**AiMe is ahead on cognition. TinkerClaw is ahead on distribution. ButterClaw brings both.**

---

## The Architecture

ButterClaw's cognitive core follows AiMe's strict pipeline separation:

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

### Memory

- **Evidence Ledger** — Append-only. Immutable. The court transcript of the relationship.
- **Truth Separation** — User Truth (authoritative) vs. Verifiable Assistant Truth (grounded in evidence). These are not the same and are never stored the same way.
- **Retrieval** — Hybrid lexical + semantic with RRF fusion and temporal scoping.
- **Significance Filtering** — Recent turns kept verbatim. Older turns filtered by significance score. Pair-aware (no orphaned responses).

### Identity

- **Living Portrait** — Six-layer evolving model: identity anchors, relational context, active concerns, commitments, behavioral fingerprint, pattern recognition. Updated every turn. Persists across sessions and months.
- **Behavioral Integrity** — RIC, SRL, and UVRG measure groundedness, honesty, consistency, and demonstrated values on every response.

### Initiative

- **Governed Proactive Turns** — The system can initiate conversation (morning briefings, return recognition, email surfacing, medication reminders, birthday nudges) through a governed pipeline. Not cron jobs — significance-gated, preference-learning, absence-tiered, spam-prevented.
- **The model never decides when to speak. The system does.**

### Values

- **Ethos UVRG** — Extracts demonstrated values from real behavioral evidence. `score = demonstrations x significance x resistance x consistency`. Values are harder to reason around than rules.
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

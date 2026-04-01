# ButterClaw — Development Roadmap

> AiMe's governed cognitive architecture on OpenClaw's platform.

This roadmap tracks improvements to the ButterClaw fork. Each item strengthens the cognitive core — truth, memory, governance, integrity — rather than adding surface features. The philosophy: build the brain first, let the extensions inherit the intelligence.

---

## Completed

| # | Enhancement | Status | Details |
|---|-------------|--------|---------|
| 1 | **Branding + Setup Redesign** — CLI banner, browser-based first-run setup (`npm run bc`), auto-config creation, API key validation, auto-open browser | Done | Phases 1-5 complete |
| 2 | **Truth boundary layer** — 4-class classification (user_truth, grounded, ungrounded, unclassified). Automatic at ingestion. Grounding ratio monitor with 3-tier health alerts (healthy/warning/critical). System prompt injection when trust drops. | Done | 24 tests |
| 3 | **Importance-weighted retrieval** — Truth-class multipliers (user_truth 1.4x → ungrounded 0.6x). Budget-aware filtering drops ungrounded messages under pressure. Protects user messages, tool results, and recent conversation. | Done | Integrated into truth boundary engine |
| 4 | **Significance scoring** — 3-signal scorer: role weight (0.30) + information density (0.45) + novelty (0.25). Detects names, dates, decisions, personal facts, quantities, contact info. No LLM calls. | Done | 19 tests |
| 5 | **Significance-aware compaction** — Compaction now receives guidance about which facts matter. High-significance messages labeled [USER STATED] or [VERIFIED] with instructions to preserve verbatim. Low-value filler summarized freely. | Done | Phase 2 complete, 47 total tests |
| 6 | **Wired into runtime** — TruthBoundaryContextEngine registered as the default context engine at startup. Wraps LegacyContextEngine transparently. All cognitive features now active in real conversations. | Done | 77 tests passing |

---

## Planned — Next Up

### 7. Temporal Decay on Stored Facts
**Priority: High**
**Difficulty: Medium (2-3 files)**

Messages lose relevance over time. A fact stated 6 months ago should carry less weight than one stated yesterday — unless it's permanent (name, birthday). Add per-fact-class decay windows inspired by AiMe's temporal scoping:

- **Permanent** — name, DOB, family relationships (no decay)
- **Long** — employer, occupation (18-month half-life)
- **Medium** — preferences, location (12-month half-life)
- **Short** — current projects, active concerns (6-month half-life)
- **Momentary** — mood, temporary state (1-day half-life)

Decay multiplier applied during assembly and compaction guidance.

### 8. Append-Only Evidence Ledger
**Priority: High**
**Difficulty: Medium (new persistence layer)**

Currently, truth classifications and significance scores live only in memory — lost on restart. Build a lightweight append-only store (SQLite or JSONL) that persists:

- Truth class per message
- Significance score per message
- Grounding snapshots over time

This is the foundation for everything that needs to survive across sessions: behavioral integrity, value extraction, and long-term user modeling.

---

## Planned — Future

### 9. Initiative Governance (Cron Governor)
**Priority: High**
**Difficulty: Medium (3-4 files)**

OpenClaw's cron jobs fire purely on schedule — no awareness of user activity, quiet hours, or priority. Add a governor layer:

- **Quiet hours** — suppress low-priority crons during configurable night window
- **User activity** — defer non-urgent crons when user is idle
- **Priority gating** — security alerts fire anytime; cleanup waits for appropriate moments

First step toward governed initiative. AiMe's ThalamoFrontalLoop has five absence tiers, significance thresholds, spam prevention, and preference learning.

### 10. Persona Drift Measurement
**Priority: Medium**
**Difficulty: Medium (2-3 files)**

OpenClaw has SOUL.md for persona but no measurement of whether the agent's actual behavior matches over time. Add:

- Behavior tagging on agent outputs (humor, directness, proactivity)
- Drift tracking: observed behavior vs target traits over a sliding window
- Nudge effectiveness scoring

### 11. Intelligent Model Routing
**Priority: Future**
**Difficulty: Large (system-wide)**

OpenClaw uses manual per-agent model selection with failover chains. No content-aware routing. AiMe's PrefrontalCortex selects lanes (base/vision/planning/tech/local/game) deterministically based on input content. Worth doing eventually but not before the foundational improvements are solid.

### 12. Behavioral Integrity (RIC/SRL)
**Priority: Future**
**Difficulty: Large**

Port AiMe's behavioral integrity systems:

- **RIC** — 5-factor relational integrity coefficient (groundedness, calibration, transparency, helpfulness, pressure resistance)
- **SRL** — Self-reflection layer with 4 traits, honesty gate, drift index

Requires the evidence ledger (#8) to be in place first.

### 13. Value Extraction (Ethos UVRG)
**Priority: Future**
**Difficulty: Large**

Port AiMe's demonstrated values pipeline: `score = demonstrations x significance x resistance x consistency`. 15 tracked values, no LLM calls. Requires the evidence ledger (#8) and behavioral integrity (#12).

---

## Architectural Principles

Every improvement follows the same principles that guide AiMe:

1. **The system governs, the model narrates.** No improvement gives the model more authority.
2. **Memory is truth-separated.** User assertions and tool output are not the same as model inference.
3. **Initiative is governed, not scheduled.** Proactive behavior requires gates, not just timers.
4. **Measure everything.** Grounding ratio, drift indices, behavioral health — if you can't measure it, you can't govern it.
5. **Non-breaking additions.** Every change is backward compatible with existing OpenClaw sessions.

---

## Reference

- **[AiMe Documentation](https://github.com/ai-nhancement/AiMe-public)** — Full architecture, blog posts, essays
- **[A Day in the Life with AiMe](https://github.com/ai-nhancement/AiMe-public/blob/master/essays/a_day_in_the_life_with_amy.md)** — What a governed cognitive system produces in daily use
- **[OpenClaw Repository](https://github.com/openclaw/openclaw)** — Upstream platform

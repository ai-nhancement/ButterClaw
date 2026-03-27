# ButterClaw — Development Roadmap

> AiMe's governed cognitive architecture + TinkerClaw's channel integrations.

This roadmap tracks planned improvements to the ButterClaw fork. Each item strengthens the cognitive core — truth, memory, governance, integrity — rather than adding surface features. The philosophy: build the brain first, let the extensions inherit the intelligence.

---

## Completed

| # | Enhancement | Status | Commit |
|---|-------------|--------|--------|
| 1 | **Truth boundary layer** — formal separation of user truth, grounded facts, and ungrounded claims. Automatic classification at ingestion. | Done | `73e7d11` |
| 2 | **Importance-weighted retrieval** — activated the unused importance field in FTS scoring (0.6x–1.4x multiplier). Significance filter drops low-importance events when budget is tight. | Done | `5909690` |
| 3 | **Grounding ratio monitor** — health metric tracking grounded vs ungrounded output over time. Three tiers (healthy/warning/critical). Metrics recording + context injection when trust drops. | Done | `5909690` |
| 4 | **Hardening pass** — stop-word filtering in conflict detection, performance fix in classification, output caps, dead import cleanup. | Done | `709fbdd` |
| 5 | **Banner rebrand** — CLI banner shows ButterClaw identity. | Done | `0b66cf8` |

---

## Planned — Core Improvements

### 6. First-Run Setup Redesign
**Priority: Next — HIGHEST VISIBILITY**
**Difficulty: Medium (gateway + new web UI page)**

The current setup is a terminal wizard with too many choices, no instructions, and no context for what anything does. New users bounce before their first conversation. This is the front door — every single person trying ButterClaw hits this first.

Replace with: start the gateway, show a single web UI page. One API key field. One model dropdown. One button. Everything else configurable later through the UI as the user learns the system. No terminal wizard for first-time setup. The system should meet you where you are, not demand you understand it before you've used it.

This is the most visible change we can make. It's the first thing every new user sees, and right now it's pushing people away before they ever experience what the system can do.

### 7. Initiative Governance (Cron Governor)
**Priority: High**
**Difficulty: Medium (3-4 files)**

TinkerClaw's cron jobs fire purely on schedule — no awareness of user activity, quiet hours, or priority. Add a governor layer that checks:
- **Quiet hours** — suppress low-priority crons during configurable night window
- **User activity** — defer non-urgent crons when user has been idle (why interrupt silence?)
- **Priority gating** — high-priority crons (security alerts) can fire anytime; low-priority (cleanup, consolidation) wait for appropriate moments

This is the first step toward governed initiative. AiMe's ThalamoFrontalLoop has five absence tiers, significance thresholds, spam prevention, and preference learning. The cron governor brings the most impactful slice of that thinking to ButterClaw.

### 8. Persona Drift Measurement
**Priority: High**
**Difficulty: Medium (2-3 files)**

TinkerClaw has persona traits (0.0–1.0 targets) and drift detection via embedding vectors, but no measurement of whether the agent's actual behavior matches those traits over time. No feedback loop on whether nudges worked.

Add:
- Behavior tagging on agent outputs (dimensions: humor, directness, proactivity)
- Drift tracking: observed behavior vs target traits over a sliding window
- Nudge effectiveness scoring: did the agent correct after a nudge?

### 9. Truth-Aware Retrieval Integration
**Priority: High**
**Difficulty: Small (1-2 files)**

Wire the truth boundary layer into the actual retrieval pack assembly so retrieved context is annotated with truth classifications. The agent sees which recalled facts are user-stated, tool-verified, or unverified claims. Currently the truth boundary module exists but is not yet integrated into the retrieval pipeline.

### 10. Intelligent Model Routing
**Priority: Future**
**Difficulty: Large (system-wide)**

TinkerClaw uses manual per-agent model selection with failover chains. No content-aware routing. AiMe's PrefrontalCortex selects lanes (base/vision/planning/tech/local/game) deterministically based on input content.

This is a large change that touches the agent execution core. Worth doing eventually but not before the foundational improvements above are solid.

### 11. Memory Significance Scoring
**Priority: Future**
**Difficulty: Medium**

Move beyond the basic 1-10 importance field to multi-layer significance scoring (keyword + semantic + heuristic) on events at ingestion time. AiMe's three-layer scoring drives retrieval, proactive surfacing, and memory filtering. ButterClaw currently has importance as a static field set at write time with no dynamic scoring.

---

## Architectural Principles

Every improvement follows the same principles that guide AiMe:

1. **The system governs, the model narrates.** No improvement gives the model more authority.
2. **Memory is truth-separated.** User assertions and tool output are not the same as model inference.
3. **Initiative is governed, not scheduled.** Proactive behavior requires gates, not just timers.
4. **Measure everything.** Grounding ratio, drift indices, behavioral health — if you can't measure it, you can't govern it.
5. **Non-breaking additions.** Every change is backward compatible with existing TinkerClaw sessions.

---

## Reference

- **[AiMe Documentation](https://github.com/ai-nhancement/AiMe-public)** — Full architecture, blog posts, essays
- **[A Day in the Life with AiMe](https://github.com/ai-nhancement/AiMe-public/blob/master/essays/a_day_in_the_life_with_amy.md)** — What a governed cognitive system produces in daily use
- **[Investment Brief](https://github.com/ai-nhancement/AiMe-public/blob/master/OPPORTUNITY.md)** — What exists, what's planned, what we're looking for

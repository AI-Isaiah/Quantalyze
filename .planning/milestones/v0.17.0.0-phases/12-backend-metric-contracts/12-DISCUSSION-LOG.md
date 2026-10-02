# Phase 12: Backend Metric Contracts - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `12-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-27
**Phase:** 12-backend-metric-contracts
**Areas discussed:** JSONB schema split, Backfill orchestration & kill-switch,
Cross-runtime parity fixture, Trade-table aggregations + is_maker descope policy
**Mode:** Standard (individual clickable AskUserQuestion); per-area
table+accept-all pattern (smart_discuss-style framing inside discuss-phase flow)

---

## Area 1: JSONB Schema Split

| Question | Options Presented | Selected |
|---|---|---|
| Q1: Which keys go to `strategy_analytics_series` sibling vs `metrics_json`? | (A) Heavy series → sibling; scalars + above-the-fold → metrics_json (Recommended); (B) Keep all in metrics_json with path-extraction only | A ✓ |
| Q2: Sibling table schema shape? | (A) `(strategy_id, kind, payload JSONB, computed_at)` PK on `(strategy_id, kind)` (Recommended); (B) Per-kind typed columns | A ✓ |
| Q3: `kind` field naming convention? | (A) snake_case 1:1 with metrics_json key name (Recommended); (B) `series:` prefix | A ✓ |
| Q4: `fetch_strategy_lazy_metrics` RPC contract? | (A) `panel_id` enum returning `{kind: payload}` map (Recommended); (B) Pass list of `kinds` from caller | A ✓ |

**User's choice:** Accept all 4 (Recommended).
**Notes:** All decisions aligned with research SUMMARY.md Pitfall 2 mitigation. No deviations requested.

---

## Area 2: Backfill Orchestration & Kill-Switch

| Question | Options Presented | Selected |
|---|---|---|
| Q1: Priority enum values on `compute_jobs`? | (A) `low` / `normal` / `high` 3-value enum + partial index (Recommended); (B) 2-value `backfill` / `live` | A ✓ |
| Q2: Throttle policy? | (A) Global 5/min cap when normal/high queued; SKIP-LOCKED guard in worker (Recommended); (B) Per-worker throttle | A ✓ |
| Q3: >800kB p99.9 kill-switch UX? | (A) Auto-migrate via deploy script with `SKIP_KILL_SWITCH=1` override (Recommended); (B) Manual flag-and-warn cutover | A ✓ |
| Q4: Existing-strategy migration on Phase 12 deploy? | (A) Eager re-enqueue all published as `priority=low` (Recommended); (B) Lazy-on-view via `metrics_json_version` bump | A ✓ |

**User's choice:** Accept all 4 (Recommended).
**Notes:** Cross-AI review already rejected lazy-on-view for B; A keeps live `sync_trades` unblocked via the throttle.

---

## Area 3: Cross-Runtime Parity Fixture

| Question | Options Presented | Selected |
|---|---|---|
| Q1: Fixture source — real strategy or synthetic? | (A) Synthetic deterministic random walk seed=42 (Recommended); (B) Snapshot of specific real published strategy | A ✓ |
| Q2: Fixture storage format? | (A) Input parquet + expected JSON, regenerated via explicit script (Recommended); (B) CSV | A ✓ |
| Q3: Parity tolerance? | (A) Hybrid — scalars byte-identical (12 sig digits) + series 1e-9 rel epsilon (Recommended); (B) Pure byte-identical; (C) Pure epsilon | A ✓ |
| Q4: CI gate scope? | (A) ALL metrics — fail-loud on new keys without expected JSON (Recommended); (B) Above-the-fold subset only | A ✓ |

**User's choice:** Accept all 4 (Recommended).
**Notes:** Hybrid tolerance acknowledges JS Number precision differences. Single fixture
keeps CI cost O(1).

---

## Area 4: Trade-Table Aggregations & is_maker Descope Policy

| Question | Options Presented | Selected |
|---|---|---|
| Q1: Five derived trade metrics — all five? | (A) All 5 (Expectancy / R:R / SQN / PF long / PF short / Trade Mix) (Recommended); (B) Skip 1–2 lower-use | A ✓ |
| Q2: Trade Mix breakdown shape? | (A) 2×2 cross long/short × maker/taker = 4 buckets (Recommended); (B) Just long/short OR maker/taker only | A ✓ |
| Q3: `is_maker` audit + descope mechanics? | (A) Phase 12 plan-phase opens with audit SQL; ≥99% on all 3 → ship; <99% on any → long/short-only fallback + v0.17.1 TODO (Recommended); (B) Hard-fail Phase 12; (C) Ship with NULLs | A ✓ |
| Q4: Trade-table column contract for Phase 14b? | (A) Frozen TS-locked top-level keys in `src/lib/types.ts` (Recommended); (B) Loose/extensible | A ✓ |

**User's choice:** Accept all 4 (Recommended).
**Notes:** Frozen contract guards against silent drift between metrics.py and consumer
UI in Phase 14b. Audit threshold of 99% is strict but graceful — the descope path
preserves parity test integrity.

---

## Claude's Discretion

The following implementation choices are deferred to Claude during plan-phase / execute-phase:

- Internal helper naming inside `metrics.py` — mirror `metrics.py:374` (`_rolling_sharpe`) convention.
- Pytest fixture organization (per-family conftest vs global).
- Specific kill-switch UPDATE implementation (single statement vs cursor).
- LATERAL vs subquery vs `jsonb_object_agg` for `fetch_strategy_lazy_metrics` body.
- Window-day exact counts (3M = 63 trading days vs 90 calendar) — match `_rolling_sharpe`.

## Deferred Ideas

(See `12-CONTEXT.md` `<deferred>` section for full list.)

- Trade Mix maker/taker → v0.17.1 if audit fails
- Discovery v2 polish → Phase 13 (parallel)
- Single-Strategy v2 UI → Phase 14a (Wave 2) + 14b (Wave 3)
- Multi-benchmark (ETH/SOL) → Sprint 13+
- Manager Workspace, Inbox, Threads, Mandate doc → v0.18

---

*Generated by gsd-discuss-phase, 2026-04-27.*

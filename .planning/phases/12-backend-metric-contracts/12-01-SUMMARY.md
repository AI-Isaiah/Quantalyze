---
phase: 12-backend-metric-contracts
plan: 01
subsystem: database
tags: [audit, supabase, postgres, trade-mix, is_maker, gating]

# Dependency graph
requires: []
provides:
  - "TRADE_MIX_HAS_MAKER_TAKER = false flag in TODOS.md (canonical M-01 propagation source)"
  - "D-15 audit results documenting empty trades table on production"
  - "Deribit-excluded-by-design rationale (exchange.py:325-334)"
  - "v0.17.1 follow-up note: re-run audit once raw-fill ingestion populates trades"
affects:
  - "Plan 12-04 (Wave D Trade Mix aggregator) — ships 2-bucket long/short shape"
  - "Plan 12-07 (Wave G parity fixture / regen_golden.py) — expected JSON omits 4-bucket keys"
  - "Plan 12-09 (sibling-count parity narrative) — TS parity threshold reads TRADE_MIX flag"
  - "Plan 12-10 (phase12_deploy.py) — reads TRADE_MIX_HAS_MAKER_TAKER via regex from TODOS.md"
  - "src/lib/types.ts (D-16 frozen TS contract for TradeMixBuckets)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Phase-internal audit gate: SQL probe → flag in TODOS.md → downstream waves grep flag"
    - "Schema-corrected SQL preserved in audit doc with file:line reference to source-of-truth migration"

key-files:
  created:
    - ".planning/phases/12-backend-metric-contracts/TODOS.md"
  modified: []

key-decisions:
  - "TRADE_MIX_HAS_MAKER_TAKER = false: production trades table empty, D-15 ≥99% threshold unmet for all 3 exchanges"
  - "Audit SQL queries trades WHERE is_fill = true (Rule 1 fix from plan-as-drafted raw_fills)"
  - "Deribit excluded by design — fetch_raw_trades has no Deribit dispatch handler"
  - "Defer maker/taker dimension to v0.17.1 follow-up; ship 2-bucket long/short fallback in Phase 12"

patterns-established:
  - "Day-1 audit-before-code: phase-internal gate runs production SQL before any implementation lands"
  - "Regex-anchored decision flags in TODOS.md: phase12_deploy.py reads TRADE_MIX_HAS_MAKER_TAKER\\s*=\\s*(true|false)"

requirements-completed: []  # Plan frontmatter claims METRICS-10, but this plan only resolves the audit gate (D-15) — not the aggregator implementation, which lands in Plan 12-05. METRICS-10 marked "audit resolved, impl pending" in REQUIREMENTS.md traceability table.
requirements-resolved-gates: [METRICS-10]  # Audit gate D-15 closed: TRADE_MIX_HAS_MAKER_TAKER=false (2-bucket fallback)

# Metrics
duration: 2m
completed: 2026-04-28
---

# Phase 12 Plan 01: D-15 is_maker Coverage Audit Summary

**Audit ran against production Supabase and resolved D-15 to TRADE_MIX_HAS_MAKER_TAKER = false (2-bucket long/short fallback) because production `trades` table is empty for binance/okx/bybit; maker/taker dimension deferred to v0.17.1 follow-up.**

## Performance

- **Duration:** 2 min (1m 40s wall)
- **Started:** 2026-04-28T11:54:01Z
- **Completed:** 2026-04-28T11:55:41Z
- **Tasks:** 1
- **Files modified:** 1 (created)

## Accomplishments

- Production Supabase D-15 audit completed against project `khslejtfbuezsmvmtsdn` (15 published strategies, 0 raw-fill rows in `trades`).
- TODOS.md committed with the canonical `TRADE_MIX_HAS_MAKER_TAKER = false` flag in regex-matchable form for `phase12_deploy.py` (Plan 12-10 Task 2) propagation.
- Deribit documented as N/A by design with file:line reference to `analytics-service/services/exchange.py:325-334`.
- v0.17.1 follow-up note recorded: re-run audit when raw-fill ingestion populates production `trades` for at least one of binance/okx/bybit.
- Wave D / Wave G / Wave H downstream tasks unblocked with the 2-bucket scope locked.

## Task Commits

Each task was committed atomically:

1. **Task 1: Run is_maker audit SQL against production DB and record results** — `e01f67f` (docs)

_Plan metadata commit follows below (covers SUMMARY.md + STATE.md + ROADMAP.md updates)._

## Files Created/Modified

- `.planning/phases/12-backend-metric-contracts/TODOS.md` — D-15 audit numbers, decision rationale, Deribit-by-design note, v0.17.1 follow-up, and the canonical `TRADE_MIX_HAS_MAKER_TAKER = false` flag line for downstream regex consumption.

## Decisions Made

**TRADE_MIX_HAS_MAKER_TAKER = false (2-bucket long/short fallback)**

- **Rationale:** Production `trades` table contains 0 rows. With `total = 0` for binance, okx, and bybit, the coverage ratio `populated / NULLIF(total, 0)` is undefined for every exchange. D-15 explicitly fails the ≥99% gate when *any* of the three exchanges falls short — three exchanges with no data each fail independently.
- **Alternative considered:** Wait for ingestion to populate `trades` and re-audit. Rejected: phase blocks Wave 1 of v0.17 sprint; ingestion timeline is not in this phase's control. The 2-bucket fallback is shippable today and the parity fixture mirrors the same shape.
- **Reversibility:** Single-line flip in TODOS.md (`= false` → `= true`) plus regen of `golden_252d_expected.json` would re-enable the 4-bucket shape in v0.17.1.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] SQL referenced non-existent table `raw_fills`**
- **Found during:** Task 1 (D-15 audit)
- **Issue:** Plan 12-01's audit SQL queried `FROM raw_fills WHERE exchange IN (...)`. There is no `raw_fills` table in production — the `is_maker` column lives on the `trades` table with an `is_fill BOOLEAN` discriminator distinguishing raw fills from legacy `daily_pnl` summary rows (per `supabase/migrations/039_trades_raw_fills.sql:46-47`). Running the plan's SQL verbatim would have returned a `relation "raw_fills" does not exist` error.
- **Fix:** Corrected the audit SQL to `FROM trades WHERE is_fill = true AND exchange IN ('binance','okx','bybit')`. Same semantic — same column (`is_maker`), same row-population check — just against the real table. The corrected SQL is preserved verbatim inside TODOS.md alongside a `Note on table name` paragraph explaining the schema reality and the migration line numbers.
- **Files modified:** `.planning/phases/12-backend-metric-contracts/TODOS.md` (audit SQL block + clarifying note).
- **Verification:** Confirmed via `grep -rn "FROM raw_fills"` (no matches in `analytics-service/` or `src/`) and `grep -rn "is_fill = true"` (matches in `analytics-service/services/reconciliation.py:233` and `analytics-service/services/job_worker.py:919`, the established pattern). `information_schema.tables` query returned only `trades` for `LIKE '%trade%' OR LIKE '%fill%'` filter.
- **Committed in:** `e01f67f` (Task 1 commit).

**2. [Rule 1 - Bug] Plan's audit SQL was outdated re: percent formatting**
- **Found during:** Task 1 (D-15 audit)
- **Issue:** Plan SQL emitted raw float ratio (`(populated)::float / NULLIF(total,0)`). The TODOS.md table column "Coverage %" expects a percentage value rounded for human-readability, not a 0..1 float.
- **Fix:** Wrapped the ratio in `ROUND(... * 100, 4)` and renamed the column `coverage_pct` so the JSON output mapped one-to-one with the TODOS.md table cell. Pure-format change, identical numeric semantics; documented in TODOS.md alongside the corrected SQL.
- **Files modified:** `.planning/phases/12-backend-metric-contracts/TODOS.md`.
- **Verification:** Both queries return identical NULL coverage for an empty `trades` table; format change is downstream-cosmetic.
- **Committed in:** `e01f67f` (Task 1 commit).

---

**Total deviations:** 2 auto-fixed (2 bugs in plan-as-drafted SQL).
**Impact on plan:** Both deviations are SQL-level corrections so the audit can actually execute against the live schema. They strengthen, not deviate from, the audit's intent (count populated `is_maker` per exchange). No scope creep — flag value (`false`) is identical regardless of correction (production has zero rows, gate fails either way).

## Issues Encountered

- **Supabase Management API transient 500 on first attempt.** `supabase projects list` and the first `db query` invocation returned `unexpected status 500: {"message":"Failed to check user auth status"}`. Single retry succeeded with `--debug` showing the actual HTTP POST. No data integrity concern; documented in case the issue recurs across the rest of Phase 12 (Plan 12-08 deploy script + Plan 12-10 propagation) so we know to retry rather than treat 500s as a hard block.

## User Setup Required

None — read-only aggregate audit, no environment/dashboard changes.

## Next Phase Readiness

- **Wave A continuation (Plans 12-02, 12-03):** Migrations 086 (compute_jobs.priority enum) + 087 (strategy_analytics_series sibling table) can now proceed. Both ship independently of the maker/taker decision since they affect storage/queue plumbing, not Trade Mix shape.
- **Wave D (Plan 12-04, Trade Mix aggregator):** Implementer reads `TRADE_MIX_HAS_MAKER_TAKER = false` from TODOS.md and ships the 2-bucket long/short shape. The 4-bucket maker/taker code path is *not* written in v0.17 — saves ~1 task of branching logic.
- **Wave G (Plan 12-07, regen_golden.py):** Fixture writer reads the same flag and emits expected JSON without the 4-bucket keys. Single-flag flip in v0.17.1 regenerates the fixture with the 4-bucket shape; no migration churn.
- **Plan 12-10 (phase12_deploy.py Task 2):** Regex `TRADE_MIX_HAS_MAKER_TAKER\s*=\s*(true|false)` against TODOS.md will match the literal flag line on line 1 of the "D-15 Branch Decision" section. Verified at audit-write time.
- **Concern carried forward:** Production `trades` table is empty — this is a pre-existing concern (not a Phase 12 regression). The fill-ingestion worker chain (`fetch_raw_trades` → `trades` upsert) does not appear to have populated the production project. Out of scope for this plan; flagged for v0.17.1 milestone planning so the maker/taker re-audit has data to read.

## Self-Check: PASSED

- File `.planning/phases/12-backend-metric-contracts/TODOS.md` — FOUND.
- Commit `e01f67f` — FOUND in `git log`.
- M-01 regex `TRADE_MIX_HAS_MAKER_TAKER\s*=\s*(true|false)` — MATCHES (`grep -E` returns 2 lines: the flag and the rationale reference).
- Plan's automated verify check (`test -f && grep TRADE_MIX_HAS_MAKER_TAKER && grep -E regex && grep Deribit && grep binance && grep okx && grep bybit`) — PASS.
- All required acceptance criteria from `<acceptance_criteria>` met.

---
*Phase: 12-backend-metric-contracts*
*Completed: 2026-04-28*

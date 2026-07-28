---
phase: 134-mt5spike-feasibility-spike-mt5client-contract
plan: 02
subsystem: api
tags: [mt5, spike, harness, go-no-go, redact, pytest, read-only, feasibility]

# Dependency graph
requires:
  - phase: 134-01
    provides: "Mt5Client read-only RPyC facade (login/account_info/history_deals_get/order_check/close) + Mt5ClientError"
  - phase: 67 (DRB-01)
    provides: "single-definition sanitization primitives (sanitize_evidence/assert_sanitized/_redact_secret_values/ScopeViolationError) + main() exit-code shape"
provides:
  - "scripts/mt5_spike.py — standalone four-leg live feasibility harness (run_spike + main) driving the Mt5Client contract through an injectable client_factory seam"
  - "Founder-fillable go/no-go doc template (docs/mt5-spike-gonogo.md) — runbook + hard security constraint + 4 legs + verdict + server-time normalization note"
  - "Offline harness test suite (12 tests) — exit codes, four-leg verdicts, escape hatch, no-order_send, None!=() honesty, offset rounding, sanitization"
affects: [134-03 (live human-verify legs), 135-mt5-source-registration, 136-mt5-equity-reconstruction, 139-mt5-golive]

# Tech tracking
tech-stack:
  added: []  # mt5linux install still gated to plan 134-03 (human-verify); imported lazily only via the default client_factory
  patterns:
    - "Injectable client_factory(host, port) seam: the live harness runs OFFLINE against a fake Mt5Client (no network, no mt5linux, no terminal)"
    - "Sanitization single-definition reuse: import from scripts.deribit_ground_truth, never re-implement (sfox_ground_truth precedent)"
    - "By-value redactor closure over credential literals applied at every error-capture point, before the report-wide assert_sanitized in main()"
    - "Go/no-go doc as a placeholder-filled template: every live-result cell literal human_needed so an unfilled template cannot read as passed"

key-files:
  created:
    - analytics-service/scripts/mt5_spike.py
    - analytics-service/tests/test_mt5_spike_harness.py
    - analytics-service/docs/mt5-spike-gonogo.md
  modified: []

key-decisions:
  - "run_spike is the injectable offline seam; the four LIVE legs are human_needed (founder demo creds + running gmag11 v2.3 gateway) and gate in plan 134-03 — NOTHING here claims a live leg passed."
  - "Leg 4 (server-time offset) is ALWAYS INCONCLUSIVE offline: a deal-derived offset is an estimate, founder_confirmation_required is always true. So the harness can never emit an overall GO offline — the honest reading (the live gate is the human part)."
  - "Added MT5_SPIKE_SYMBOL (default EURUSD) beyond the plan's env list — order_check needs a symbol to form a market-order-shaped probe request; without it the leg-2 probe is meaningless (Rule 2: missing critical functionality). Documented in the runbook."
  - "docs/mt5-spike-gonogo.md landed under analytics-service/docs/ (not .planning): RESEARCH sketched '.planning/.../MT5_GONOGO.md (or similar)' but .planning is a gitignored local ledger; a founder-filled verdict must be a committed reviewable artifact (deribit-ground-truth.md precedent)."

patterns-established:
  - "Leg verdict ladder: leg1 GO@1.0 / INCONCLUSIVE>=0.8 / NO-GO below (+escape hatch); leg2 GO iff trade_allowed False else INCONCLUSIVE ([ASSUMED] retcode); leg3 GO iff profit/swap/commission/fee all present; overall = NO-GO>INCONCLUSIVE>GO."
  - "history_deals_get error is recorded as an ERROR observation with its code, NEVER coerced to honest_empty 'zero deals' (the None!=() honesty that motivates the whole source)."

requirements-completed: []  # MT5SPIKE-01 buildable half; the requirement completes when 134-03's live legs run

# Metrics
duration: ~10min
completed: 2026-07-23
---

# Phase 134 Plan 02: MT5 feasibility spike harness + go/no-go template Summary

**Standalone four-leg MT5 feasibility harness (`scripts/mt5_spike.py`, 469 lines) that drives the wave-1 `Mt5Client` contract through an injectable `client_factory` seam — so its 12 offline tests prove the report-assembly, verdict, deribit-shaped exit-code (0/2/3/1), secret-hygiene, and no-trade-path logic with `mt5linux` uninstalled — plus a founder-fillable go/no-go doc template (`docs/mt5-spike-gonogo.md`) whose every live-result cell is a literal `human_needed` placeholder.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-23T15:55Z
- **Completed:** 2026-07-23T16:05Z
- **Tasks:** 2 (Task 1 TDD RED→GREEN, Task 2 doc)
- **Files created:** 3

## Accomplishments
- `scripts/mt5_spike.py`: `run_spike(env, *, client_factory, utc_now=None)` assembles a per-leg + overall GO/NO-GO/INCONCLUSIVE report over the four unknowns; `main(argv)` mirrors the deribit exit-code contract (0 success / 2 scope violation / 3 missing env / 1 other), env-only creds, whole-report `sanitize_evidence` + `assert_sanitized` before stdout.
- The four legs: (1) N unattended login→account_info→close cycles with success-rate verdict + native-Windows-VPS escape hatch on NO-GO; (2) `order_check` + `account_info().trade_allowed` read-only probe (investor + optional master), trade path never touched; (3) `history_deals_get` viability with `None`≠`()` honesty, field-presence booleans, `DEAL_TYPE_BALANCE` detection; (4) server-time-vs-UTC offset rounded to 30 min with `founder_confirmation_required=true`.
- 12-test offline suite green with `mt5linux` uninstalled; the load-bearing one (`test_leg3_error_records_code_not_zero_deals`) proves an error is never coerced into an honest-empty reading inside the honesty harness.
- `docs/mt5-spike-gonogo.md`: 8-section founder-fillable template (Runbook, hard Security constraint, Environment, Legs 1–4, Overall verdict) — 32 `human_needed` placeholders, full env-var + exit-code tables, escape hatch, and the Phase-136 `combine_mt5_deal_ledger` normalization note.
- Full `analytics-service` suite regression-clean: 4265 passed (+12 new), 96 skipped.

## Task Commits

1. **Task 1 (RED): failing offline harness tests** — `5371b694` (test)
2. **Task 1 (GREEN): mt5_spike four-leg harness** — `6687c049` (feat)
3. **Task 2: go/no-go doc template + runbook** — `a2ee724d` (docs)

_Note: `.planning/` is a gitignored local ledger — no metadata commit; SUMMARY/STATE/ROADMAP updated on disk only._

## Files Created/Modified
- `analytics-service/scripts/mt5_spike.py` — harness: `run_spike` + `main` + four `_leg*` helpers + `_make_redactor` + `_default_client_factory`; imports sanitization primitives from `scripts.deribit_ground_truth` (1 import) and `Mt5Client`/`Mt5ClientError` from `services.mt5_client` (1 import).
- `analytics-service/tests/test_mt5_spike_harness.py` — 12 offline tests via a `_FakeMt5` double + cycle/happy factories; asserts touched-methods (no `order_send`), verdicts, sanitization, and a source-token guard.
- `analytics-service/docs/mt5-spike-gonogo.md` — founder-fillable go/no-go template.

## Decisions Made
- Leg 4 is always INCONCLUSIVE offline (deal-derived offset is an estimate needing founder confirmation), so the harness never emits an overall GO offline — the honest reading: the GO is the human live gate.
- Added `MT5_SPIKE_SYMBOL` (default `EURUSD`) — `order_check` needs a symbol to form the probe request (documented deviation, see below).
- Doc home is `analytics-service/docs/` (committed, reviewable) not gitignored `.planning`.

## Deviations from Plan

### Rule 2 — Auto-add missing critical functionality

**1. [Rule 2] Added `MT5_SPIKE_SYMBOL` env var (default `EURUSD`)**
- **Found during:** Task 1 (leg-2 `order_check` request construction)
- **Issue:** The plan's env-var list omits a symbol, but `order_check` requires a symbol to form a market-order-shaped probe request; without one the leg-2 read-only proof is meaningless.
- **Fix:** Added optional `MT5_SPIKE_SYMBOL` (default `EURUSD`, a universal forex symbol), documented it in the harness runbook and in the go/no-go doc env-var table.
- **Files modified:** `analytics-service/scripts/mt5_spike.py`, `analytics-service/docs/mt5-spike-gonogo.md`
- **Commit:** `6687c049`, `a2ee724d`

## Known Stubs

None that block the plan's goal. The go/no-go doc's `human_needed` cells are the INTENDED design (an unfilled template must not read as passed); they are filled by the founder in plan 134-03's live checkpoint. The four LIVE proof legs are explicitly `human_needed` and are NOT claimed passed here.

## Threat Flags

None. The harness introduces no new security surface beyond the wave-1 `Mt5Client` contract; the RPyC transport risk (T-134-08) is documented as a hard private-network-only constraint in both the harness docstring and the go/no-go doc, and hardening is owned by Phase 139 per the threat register.

## Issues Encountered
None. TDD RED confirmed at collection (module absent), GREEN on first implementation pass; all grep gates (`order_send(`=0, deribit import=1, mt5_client import=1, `human_needed`>=6, Windows VPS / private network / combine_mt5_deal_ledger) passed first try.

## User Setup Required
None for this plan. The live spike (plan 134-03) needs founder demo/investor credentials, a running `gmag11/MetaTrader5-Docker` v2.3 gateway, and `pip install mt5linux==1.0.3` (behind a human-verify checkpoint).

## Next Phase Readiness
- MT5SPIKE-01 buildable half complete: harness + offline tests + founder-fillable go/no-go template all landed and committed; the four LIVE proof legs remain explicitly `human_needed` (gate in plan 134-03).
- Plan 134-03 is the remaining Phase 134 deliverable: the `pip install mt5linux==1.0.3` supply-chain human-verify gate + the live spike run that fills the go/no-go doc.

## Self-Check: PASSED
- `analytics-service/scripts/mt5_spike.py` — FOUND (469 lines, ≥150)
- `analytics-service/tests/test_mt5_spike_harness.py` — FOUND (304 lines, ≥60)
- `analytics-service/docs/mt5-spike-gonogo.md` — FOUND (185 lines, contains `human_needed`)
- Commit `5371b694` — FOUND
- Commit `6687c049` — FOUND
- Commit `a2ee724d` — FOUND
- `pytest tests/test_mt5_spike_harness.py -x -q` — 12 passed
- Full suite — 4265 passed, 96 skipped
- Grep gates: `order_send(`=0, `from scripts.deribit_ground_truth import`=1, `from services.mt5_client import`=1, missing-env exit=3, `human_needed`=32 (≥6), Windows VPS / private network / combine_mt5_deal_ledger all present

---
*Phase: 134-mt5spike-feasibility-spike-mt5client-contract*
*Completed: 2026-07-23*

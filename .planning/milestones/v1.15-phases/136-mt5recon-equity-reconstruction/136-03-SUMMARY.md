---
phase: 136-mt5recon-equity-reconstruction
plan: 03
subsystem: api
tags: [mt5, worker-branch, broker-dailies, api-verified, reconciliation, fail-loud, oracle-discipline]

# Dependency graph
requires:
  - phase: 136-01
    provides: "combine_mt5_deal_ledger (third combiner sibling) + mt5_deals classifier"
  - phase: 134-mt5-feasibility-spike
    provides: "Mt5Client contract (login/account_info/history_deals_get, None!=() discipline, _connect injection seam)"
  - phase: 135-mt5src
    provides: "'mt5' Source literal, Mt5Adapter RAISE stubs, mt5_enabled_server + MT5_DISABLED_DETAIL, mt5_validation.parse_mt5_credentials/classify_mt5_login_error"
provides:
  - "job_worker: the venue=='mt5' derive branch (kill-switch → bounded read → combine → reconciliation/DQ gates) + Mt5Session factory arm + close routing + mt5 in _NATIVE_RETURNS_VENUES"
  - "long_fetch: mt5 in _LEDGER_BACKED_SOURCES (routes onboard/resync to the derive_broker_dailies tail, never the fill path)"
  - "process_key: mt5 admitted to onboard/resync behind the fail-closed mt5_enabled_server gate; EXPLICIT api_verified proof at the mt5 seam (onboard + resync)"
  - "mt5_client.Mt5Session — the non-ccxt worker exchange holder (client + parsed creds)"
  - "tests/test_mt5_derive_branch.py — offline job-level suite incl. the mt5-seam reconciliation-to-equity parity gate"
affects: [136-05, 137-mt5conc, 139-mt5-golive]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Third broker-dailies venue branch mirroring sfox line-for-line (single-equity anchor, no coin buckets)"
    - "Non-ccxt exchange holder (Mt5Session) routed through the ONE _make_exchange_client + aclose_exchange chokepoints (sfox SfoxClient parity)"
    - "api_verified earned FREE at process_key.py:847 (source != 'csv'); EXPLICITLY proven at the mt5 seam, not inherited"
    - "Ground-truth parity oracle rolled FORWARD from a hand-derived initial (never read back from the SUT)"

key-files:
  created:
    - "analytics-service/tests/test_mt5_derive_branch.py"
  modified:
    - "analytics-service/services/job_worker.py"
    - "analytics-service/services/ingestion/long_fetch.py"
    - "analytics-service/routers/process_key.py"
    - "analytics-service/services/exchange.py"
    - "analytics-service/services/mt5_client.py"
    - "analytics-service/services/ingestion/mt5.py"
    - "analytics-service/tests/test_process_key.py"

key-decisions:
  - "Mt5Adapter.compute_metrics/fetch_raw stay NotImplementedError permanently BY DESIGN (wording changed from 'until Phase 136' to permanent); mt5 in _LEDGER_BACKED_SOURCES routes AROUND fills — implementing a fill path would reopen BYB-02"
  - "Material-equity floor judged AFTER the combine (returns.notna().sum() < 2) so it shares the downstream gate's usable-day definition; the combine is pure"
  - "external_flows evidence rebuilt in the branch from the same classify pass (broker_dailies.py is NOT a 136-03 artifact; combine's (returns, meta) signature stays frozen); mt5 has no retention cap → DQ-02 terminus is None so this evidence never re-segments"
  - "_MT5_DERIVE_READ_TIMEOUT_S derived from MT5_REQUEST_TIMEOUT_S + 10s (mirrors ingestion/mt5.py:_MT5_PROBE_TIMEOUT_S so derive and probe paths never diverge, WR-02)"

patterns-established:
  - "Pattern: the api_verified stamp is a DB-row/source concern (process_key.py:847), orthogonal to the returns backbone — proven at the seam for BOTH onboard and resync"
  - "Pattern: reconciliation-to-equity asserted via a forward NAV roll from a hand-derived initial + hand-derived flows, with a negative-control teeth check ($2 drift reddens)"

requirements-completed: [MT5RECON-01, MT5RECON-03]

# Metrics
duration: 45min
completed: 2026-07-23
---

# Phase 136 Plan 03: MT5 worker derive branch + enqueue wiring + api_verified proof Summary

**The `venue == "mt5"` derive branch (kill-switch → one bounded RPyC read → `combine_mt5_deal_ledger` → reconciliation/DQ gates) wired end-to-end through the worker + enqueue path, with the phase-goal `api_verified` stamp EXPLICITLY proven at the mt5 seam for onboard AND resync, and a hand-derived reconciliation-to-equity parity gate asserted directly at the job seam.**

## Performance
- **Duration:** ~45 min
- **Tasks:** 3
- **Files:** 7 modified, 1 created

## Accomplishments
- **Enqueue-path + registry wiring (Task 1):** `mt5` admitted to `_LEDGER_BACKED_SOURCES` (long_fetch → the `derive_broker_dailies` tail, never the fill path — the F1 sfox-incident lesson), to `process_key` onboard/resync source sets behind the fail-closed `mt5_enabled_server` gate (MT5-F2, verbatim sfox-F2 mirror), and to `_NATIVE_RETURNS_VENUES` (excludes mt5 from the ccxt clobber). Added the `Mt5Session` holder (`mt5_client.py`) + `_make_mt5_session` arm at the single `_make_exchange_client` chokepoint and routed `aclose_exchange` to a bounded `to_thread(client.close)`. Mt5Adapter stub messages updated to the permanent by-design posture.
- **The derive branch (Task 2):** `elif venue == "mt5"` modeled line-for-line on sfox — (a) kill-switch FIRST (permanent `MT5_DISABLED`), (b) ONE `wait_for`-bounded `to_thread` read (login → account_info → history_deals_get, full history); `asyncio.TimeoutError` → transient, `Mt5ClientError` → classified auth/wrong_server permanent (+stamp) else transient, (c) fail-loud equity/balance extraction (non-finite anchor refused), (d) material-equity floor, (e) `combine_mt5_deal_ledger` with `Mt5DealClassificationError` → permanent+stamp and `NavReconstructionError` → the shared `_dispose_broker_nav_error`, (f) belt-and-braces uPnL-wedge flag (`equity − balance` at the 0.05 ratio), then the shared downstream vars set exactly as sfox.
- **EXPLICIT api_verified proof (Task 1):** `test_process_key.py` gained mt5 onboard AND resync tests asserting the `strategy_verifications` draft carries `trust_tier='api_verified'` (earned FREE at `process_key.py:847`), plus admission / fail-closed / traditional-252 tests — the phase-goal stamp proven at the mt5 seam, not inherited.
- **Offline job-level suite (Task 3):** `test_mt5_derive_branch.py` (559 lines) drives the WHOLE job through the `Mt5Client` `_connect` double — kill-switch zero-call fail-closed, one-backbone hand literals (deposit day `300/100_400`, never the `+10.26%` spike) + the `periods_per_year == 252` conventions echo, uPnL-wedge flag, mid-read fail-whole-job (nothing partial), unclassifiable-deal permanent+stamp, coverage-masked missing window, the long-fetch tail routing, and the reconciliation-to-equity parity gate (forward NAV roll from a hand-derived initial with a `$2`-drift negative control).

## Task Commits
1. **Task 1: wiring + api_verified proof** — `9fa16e31` (feat)
2. **Task 2: venue=='mt5' derive branch** — `8df52d05` (feat)
3. **Task 3: offline job-level tests** — `9bc2a634` (test)

## Deviations from Plan
None requiring auto-fix rules. Two documented interpretations:
- **[Wording-vs-precedent conflict, resolved per plan]** The plan asked to resolve the Mt5Adapter stub posture "from 'until Phase 136' to the permanent by-design wording mirroring sfox". Only `compute_metrics` actually carried "until Phase 136"; `fetch_raw` was already by-design. Updated the docstring + `compute_metrics` to the permanent wording; `fetch_raw` left as-is (already permanent).
- **[external_flows evidence built in-branch]** `combine_mt5_deal_ledger` returns `(returns, meta)` and does NOT expose the flow evidence, and `broker_dailies.py` is not a 136-03 artifact (its signature is frozen by the 136-01 contract). The branch therefore rebuilds the `ExternalFlow` evidence from the same classify pass. This is safe (the combine already succeeded, so all deals classify) and honest; mt5 has no retention cap, so the DQ-02 terminus is `None` and this evidence never re-segments the series.

## Threat Model Coverage
- **T-136-08 (fabricated flat from None read):** the client's None→raise discipline is preserved; the branch never coerces error→empty. Covered by `test_read_error_fails_whole_job`.
- **T-136-11 (live read while disabled):** `mt5_enabled_server()` gate FIRST; `test_mt5_disabled_fails_closed` asserts ZERO transport calls.
- **T-136-10 (hung terminal wedge):** the ONE read block is `to_thread` + `wait_for` bounded (`_MT5_DERIVE_READ_TIMEOUT_S`).
- **T-136-12 (account-size leak in raises):** messages carry codes/counts only; `test_unclassifiable_deal_permanent` asserts the raw `42` USD amount never appears in the error.

## Verification
- `pytest tests/test_mt5_derive_branch.py -x` → 8 passed.
- `pytest tests/test_process_key.py` → 58 passed (incl. 5 new mt5 tests).
- `pytest tests/test_mt5_deal_reconstruction.py tests/test_long_fetch.py tests/test_sfox_reconstruct.py tests/test_sfox_validate.py` → green (no sfox/deribit regressions from the shared chokepoint edits).
- **Full analytics-service suite: 4385 passed, 96 skipped** (up from 4372; no regressions).
- `python3 -c "assert 'mt5' in _LEDGER_BACKED_SOURCES and 'mt5' in _NATIVE_RETURNS_VENUES"` → OK.

## Next Phase Readiness
- The mt5 onboard → derive → persist story is proven offline end-to-end at the job level; `api_verified` is proven for onboard + resync; the reconciliation parity gate reddens on anchor drift.
- Deferred to later phases (locked scope): terminal-restart-on-timeout + per-terminal lock (Phase 137); the `[ASSUMED]` DEAL_TYPE middle + A2 server-time offset + A3 fold rule remain behind the 136-05 human-verify checkpoint — do not silently classify before then; live-broker acceptance (Phase 139).

## Self-Check: PASSED
- FOUND: analytics-service/tests/test_mt5_derive_branch.py
- FOUND: `elif venue == "mt5":` in analytics-service/services/job_worker.py (line 3255)
- FOUND commits: 9fa16e31, 8df52d05, 9bc2a634

---
*Phase: 136-mt5recon-equity-reconstruction*
*Completed: 2026-07-23*

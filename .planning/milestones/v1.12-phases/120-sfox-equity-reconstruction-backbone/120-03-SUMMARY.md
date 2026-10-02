---
phase: 120-sfox-equity-reconstruction-backbone
plan: 03
subsystem: broker-dailies-worker
tags: [sfox, broker-dailies, one-path, flipretry-01, fail-loud, api-verified, crypto-venue, f2, f7]

# Dependency graph
requires:
  - phase: 120-01
    provides: sfox registered in the Source Literal + ingestion _FACTORIES (get_adapter("sfox") resolves; SfoxAdapter.compute_metrics fail-loud)
  - phase: 120-02
    provides: broker_dailies.combine_sfox_balance_history, sfox_read.crawl_sfox_balance_history / crawl_sfox_transactions / sfox_flows_by_day, SfoxCrawlTruncatedError / SfoxFlowValuationError
  - phase: 118-sfox-read-client
    provides: SfoxClient (GET-only Bearer adapter, bounded aclose)
  - phase: 72-deribit-native-reconstruction
    provides: the deribit broker-dailies ONE-path this branch mirrors (venue dispatch, C2 floor, derive_basis_series / persist_basis_series)
provides:
  - job_worker elif venue=="sfox" branch — two asyncio.wait_for-bounded crawls → honesty gates → combine_sfox_balance_history → the UNCHANGED shared derive/persist (ONE-path, zero new backbone call sites)
  - job_worker._make_exchange_client — the single preflight chokepoint (SfoxClient for sfox; ccxt byte-identical)
  - job_worker._NATIVE_RETURNS_VENUES — the :2645 native-returns guard (deribit+sfox) that stops the ccxt combine clobbering native returns
  - exchange.aclose_exchange — isinstance chokepoint routing SfoxClient to its bounded aclose
  - closed_sets.CRYPTO_VENUES admits sfox (√365 RISK basis, MD-01 single source)
  - process_key H-11 admits sfox to onboard/resync; internal.py probe + portfolio.verify_strategy resolve sfox honestly (F2/F7)
affects: [120-04, 121, 122]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "elif venue=='sfox' mirrors the deribit branch: native returns produced INSIDE the venue dispatch, then fall through to the UNCHANGED derive_basis_series/persist_basis_series (no parallel metrics path)"
    - "FLIPRETRY-01: each live crawl wrapped in asyncio.wait_for(_SFOX_CRAWL_TIMEOUT_S=300); a hang becomes a classified TRANSIENT DispatchResult, never a wedge of the sequential worker loop"
    - "_NATIVE_RETURNS_VENUES={deribit,sfox}: the money-critical :2645 guard widen keeps deribit byte-identical while stopping combine_realized_and_funding clobbering sfox's reconstructed TWR"
    - "external_flows shape parity: both deribit (_completeness.dated_external_flows) and sfox (sfox_flows_by_day) yield list[ExternalFlow] — the DQ-02 downstream consumer accepts either identically"
    - "Single preflight construction chokepoint (_make_exchange_client) + single close chokepoint (aclose_exchange isinstance) — every job_worker call site is sfox-safe with zero per-site edits"

key-files:
  created:
    - analytics-service/tests/test_sfox_internal_probe.py
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/services/exchange.py
    - analytics-service/services/closed_sets.py
    - analytics-service/routers/process_key.py
    - analytics-service/routers/internal.py
    - analytics-service/routers/portfolio.py
    - analytics-service/tests/test_sfox_reconstruct.py
    - analytics-service/tests/test_process_key.py
    - analytics-service/tests/test_verify_strategy_redaction.py

key-decisions:
  - "The sfox material-balance floor reuses the venue-agnostic _DERIBIT_EMPTY_LEDGER_FLOOR_USD ($100): a >$100 account with <2 usable NAV days fails loud permanent (a silently-empty green track record), while a below-floor tiny/empty account flows to the honest downstream <2-day gate (no invented rows)"
  - "A crawl TIMEOUT returns DispatchResult(error_kind='transient') directly (not a raised DeribitTransientReadError analog) — explicit, testable, and unambiguously retryable/not-permanent; truncation/unvaluable/material-floor all return error_kind='permanent' + a scrubbed terminal _stamp_strategy_analytics_failed"
  - "sfox is admitted to CRYPTO_VENUES (crypto blend clock, √365) but EXCLUDED from _COMPOSITE_DEGRADE_VENUES: it has no ccxt reconstruction path, so an sfox composite member (unreachable until 122) gets an honest 'unsupported composite member venue' permanent refusal rather than a ccxt-reconstruct crash — the blend-clock question and the degradable-member question are different"
  - "internal probe returns the STRUCTURAL read-only triple (sFOX has no scope endpoint); an auth-dead 401/403 key is honestly scopeless (probe_error=False), any other SfoxApiError fails closed (probe_error=True)"
  - "verify_strategy rejects sfox EARLY with honest copy (no network/timeout misdirection); api_verified is the FREE :828 stamp (source!='csv') — proven, zero stamp-code edits"

metrics:
  duration: ~50m
  completed: 2026-07-19
  tasks: 2
  files_changed: 10
---

# Phase 120 Plan 03: sFOX Worker Branch + Backbone Wiring Summary

The money-critical `elif venue == "sfox"` broker-dailies branch: an ingested sFOX key
now becomes an `api_verified` daily-return series on the ONE unified backbone. Two
`asyncio.wait_for`-bounded live crawls (`crawl_sfox_balance_history` +
`crawl_sfox_transactions`, the FLIPRETRY-01 worker-wedge guard) → honesty gates
(truncation / unvaluable-flow / material-balance floor all fail loud with a scrubbed
terminal stamp) → `combine_sfox_balance_history` → the UNCHANGED
`derive_basis_series`/`persist_basis_series` seams (zero new backbone call sites,
grep-proven). The `:2645` guard was widened to `_NATIVE_RETURNS_VENUES = {deribit, sfox}`
so the ccxt USD-space combine can never clobber the reconstructed sfox TWR — with
deribit kept byte-identical. Router seams (H-11, the internal permission probe, and
`verify_strategy`) now resolve sfox honestly (F2/F7 closed), and sfox is canonically a
crypto venue (√365).

## What shipped

**Task 1 — worker branch + preflight/close seams (`test`+`feat` commits, TDD):**
- `_make_exchange_client` single preflight chokepoint — both `_exchange_preflight` and
  `_allocator_key_preflight` build a `SfoxClient(api_key.strip())` for sfox (single
  Bearer, secret unused); every ccxt venue byte-identical.
- `aclose_exchange` isinstance chokepoint routes `SfoxClient` to its own bounded
  `aclose()`; the ccxt close sequence is byte-identical.
- The `elif venue == "sfox":` branch: two `wait_for(_SFOX_CRAWL_TIMEOUT_S)`-bounded
  crawls; a hang → `DispatchResult(transient)` (retryable, no stamp); truncation →
  permanent + stamp; unvaluable flow / garbage NAV → permanent + stamp; material floor
  (>$100 & <2 usable NAV days) → permanent + stamp; then
  `combine_sfox_balance_history` and the shared downstream variables set exactly as the
  deribit branch (equity, balance_error=False, open_unrealized_usd=0.0,
  upnl_unreadable=False, funding=[], realized=[], external_flows=list[ExternalFlow]).
- `_NATIVE_RETURNS_VENUES` widen at `:2645` (the clobber fix) + guard audit:
  `_COMPOSITE_DEGRADE_VENUES` excludes sfox.

**Task 2 — F2/F7 router seams + crypto class + api_verified (`feat` commit):**
- H-11: sfox → `onboard`/`resync` only (teaser/internal_report/csv still reject).
- `CRYPTO_VENUES` gains sfox (MD-01 single source → `_resolve_asset_class` crypto √365 +
  composite blend clock).
- `internal.py` probe: sfox branch before `create_exchange` → structural read-only
  triple / honest auth-dead / fail-closed transient.
- `verify_strategy`: early honest sfox rejection (no timeout/network wording).
- `api_verified` proven for `source='sfox'` (the free `:828` stamp).

## Verification

- `pytest tests/test_sfox_reconstruct.py tests/test_process_key.py tests/test_sfox_internal_probe.py tests/test_verify_strategy_redaction.py` — green.
- **FULL analytics-service suite: 3936 passed, 95 skipped** (baseline 3875 passed; the
  new suite adds sfox-branch + router tests).
- ONE-path grep gate: comment-stripped `derive_basis_series(` call sites == 4 (unchanged
  baseline). sfox branch contains ≥2 `asyncio.wait_for(`. `_NATIVE_RETURNS_VENUES` ≥2
  stripped refs.
- Manual import sanity: `get_adapter('sfox')` → `SfoxAdapter`; `job_worker` imports with
  no cycle from the preflight widen.
- **Deribit byte-identical confirmed:** `"deribit" not in {"deribit","sfox"}` ≡
  `"deribit" != "deribit"` ≡ False, so deribit takes the same `:2645` branch as before;
  the full `test_job_worker_deribit.py` suite passes unchanged.

## Deviations from Plan

### Auto-fixed / design choices (no user permission needed)

**1. [Rule 2 - correctness] sfox excluded from `_COMPOSITE_DEGRADE_VENUES`**
- **Found during:** Task 1 guard audit (the plan flagged the `_COMPOSITE_DEGRADE_VENUES`
  ripple from the CRYPTO_VENUES widen).
- **Issue:** Adding sfox to `CRYPTO_VENUES` propagates into `_COMPOSITE_DEGRADE_VENUES`
  (= crypto − deribit), which would route an sfox composite member into
  `_reconstruct_ccxt_member` → `create_exchange('sfox')` → ValueError → confusing
  retry-forever crash.
- **Fix:** `_COMPOSITE_DEGRADE_VENUES = _COMPOSITE_CRYPTO_VENUES - {"deribit", "sfox"}`.
  An sfox composite member (not a reachable flow until 122) now hits the honest
  `venue != "deribit"` "unsupported composite member venue" permanent refusal. sfox
  stays in `_COMPOSITE_CRYPTO_VENUES` for the blend clock (√365). Documented in a code
  comment at the constant.
- **Files:** `services/job_worker.py` (committed in the Task 1 feat).

**2. [Rule 1 - source-scan] verify_strategy comment reword**
- **Found during:** Task 2 full-suite regression.
- **Issue:** `test_per_email_rate_limit_check_is_invoked` does a naive `src.index(
  "create_exchange")` scan; my sfox-rejection comment contained the literal token,
  shifting the first match before the rate-limit check.
- **Fix:** reworded the comment to "the ccxt-construction path below" (no literal
  `create_exchange`). The rate-limit-before-handshake contract is unaffected.
- **Files:** `routers/portfolio.py`.

## TDD Gate Compliance

Task 1 is `tdd="true"`. The pure-math RED/GREEN cycle for the `combine_sfox_balance_history`
primitive already landed RED-first in plan 120-02. The 120-03 worker-branch tests are
integration-level behavior tests over the wiring (crawl bounds, dispositions, the ONE-path
scan, preflight/close chokepoints); they were committed in a `test(120-03)` commit
BEFORE the `feat(120-03)` implementation commit (git log ordering: `test` → `feat`).

## Known Stubs

None. The sfox path is end-to-end wired: an onboard/resync submission → process_key
(queued) → the worker sfox branch → the shared backbone → a persisted series +
`api_verified` draft. The verify-flow rejection and "no wizard card" are DELIBERATE
interim-honesty per the plan (the wizard card is Phase 122); the live prod parity leg is
founder-gated on Phase 121 egress.

## Threat Flags

None. The branch's new surface is entirely covered by the plan's threat register
(T-120-10..15): every crawl is `wait_for`-bounded (DoS), every fail-loud message is run
through `scrub_freeform_string` (info disclosure), and the ONE-path grep gate + the
CRYPTO_VENUES single source (MD-01) pin basis integrity.

## Self-Check: PASSED

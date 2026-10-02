---
phase: 120-sfox-equity-reconstruction-backbone
plan: 02
subsystem: broker-dailies
tags: [sfox, broker-dailies, chain-linked-twr, cashflow-neutral, p115-oracle, bounded-crawl, fail-loud]

# Dependency graph
requires:
  - phase: 118-sfox-read-client
    provides: SfoxClient (GET-only Bearer adapter; get_balance_history, get_transactions, _TRANSACTIONS_MAX_LIMIT, 1-req/10s rate gate)
  - phase: 119-sfox-read-adapter-key-validation
    provides: sfox_read.read_sfox_account (3-leg read pull, read-only ingestion-boundary guard, write-surface grep gate)
  - phase: 72-deribit-native-reconstruction
    provides: nav_twr.chain_linked_twr (flow-in-numerator TWR + DQ-01 guard set), broker_dailies.combine_native_ledger (the sibling shape), _build_nav_meta
  - phase: 75-external-flows
    provides: external_flows.ExternalFlow (venue-agnostic dated flow contract), USD_FAMILY
provides:
  - broker_dailies.combine_sfox_balance_history — usd_value NAV + signed flows → cashflow-neutral daily TWR via the EXISTING chain_linked_twr (deposit-neutral)
  - sfox_read.crawl_sfox_balance_history — budget-bounded windowed GET crawl; SfoxCrawlTruncatedError on recent-edge shortfall / budget; earliest-inception surfaced
  - sfox_read.crawl_sfox_transactions — serial after-id cursor crawl to exhaustion; typed truncation on budget
  - sfox_read.sfox_flows_by_day — typed flow extraction (Series + list[ExternalFlow]); SfoxFlowValuationError on unvaluable rows
  - SfoxCrawlTruncatedError / SfoxFlowValuationError — typed fail-loud signals
affects: [120-03, 120-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "sFOX combiner reuses chain_linked_twr directly (no reconstruct_native_nav_and_twr) — sFOX HANDS us the NAV, so it skips the ledger backward-roll tier"
    - "Missing-day honesty: NAV reindexed to every calendar day WITHOUT value-filling → a missing observation is NaN → an honest break, never a 0.0-fabricated flat day (contrast deribit ledger-completeness)"
    - "Bounded crawl inside sfox_read (hard request budget); the asyncio.wait_for wall-clock bound wraps at the worker seam (120-03), not inside the crawl"
    - "P115 money-math oracle: expected returns are HAND-DERIVED literals + an anti-pin vs usd_value.pct_change(), never the module's own output re-asserted"

key-files:
  created: []
  modified:
    - analytics-service/services/broker_dailies.py
    - analytics-service/services/sfox_read.py
    - analytics-service/tests/test_sfox_reconstruct.py
    - analytics-service/tests/test_sfox_read.py

key-decisions:
  - "combine_sfox_balance_history feeds the EXISTING chain_linked_twr with prev0=first-observed usd_value (A3 inception convention) so day-0 is the anchor (no spurious return) and returns begin day 1"
  - "A deposit sits in the TWR NUMERATOR (r=(NAV_t−NAV_{t-1}−F_t)/NAV_{t-1}) so it books ~0.495%, never the ~50% that usd_value.pct_change() would fabricate (Pitfall 1)"
  - "An interior missing NAV day breaks that day AND the next (NaN prev) — never a bridged multi-day return, never a 0.0-fabricated NAV"
  - "DQ-01 guards (dust/negative/flow-dominated/pnl-dominated) are INHERITED from chain_linked_twr and surface through the returned meta — never reimplemented for sfox"
  - "Bounded crawls raise typed SfoxCrawlTruncatedError on budget exhaustion or a material recent-edge shortfall (Pitfall 4) — a partial read never renders as a complete-but-short series"
  - "sfox_flows_by_day maps deposit/credit(+) withdraw/charge(−), EXCLUDES buy/sell rotations, and RAISES SfoxFlowValuationError on a non-USD-family / malformed / unknown-action flow — never guessed, never dropped (LedgerValuationError discipline)"

patterns-established:
  - "The write-surface gate distinguishes a write CALL (client.withdraw(...)) from a 'withdraw' transaction TYPE named as DATA — the security guarantee is call-form, not a bare substring"

requirements-completed: []  # SFOX-05 still PARTIAL: the returns math + bounded crawls land here; the job_worker venue branch wiring through derive_basis_series/persist is plan 120-03. Stays in-progress in REQUIREMENTS.md.
requirements-progressed: [SFOX-05]

# Metrics
duration: 22min
completed: 2026-07-19
---

# Phase 120 Plan 02: sFOX Reconstruction Math (combine_sfox_balance_history + bounded crawls) Summary

**Built the money-critical sFOX daily-return reconstruction: `combine_sfox_balance_history` turns sFOX's `usd_value` NAV series + typed deposit/withdraw flows into a cashflow-neutral daily TWR series by feeding the EXISTING `nav_twr.chain_linked_twr` (flow-in-the-numerator, full DQ-01 guard set) — a deposit books its real PnL, never the deposit itself — plus budget-bounded `crawl_sfox_balance_history` / `crawl_sfox_transactions` and fail-loud `sfox_flows_by_day` in `sfox_read.py`, all proven against a P115 hand-derived independent oracle.**

## Performance

- **Duration:** ~22 min (continuation: Task 1 was already committed; this session committed Task 2)
- **Completed:** 2026-07-19
- **Tasks:** 2 (Task 1 pre-committed by a prior session; Task 2 RED+GREEN this session)
- **Files modified:** 4

## Accomplishments
- `combine_sfox_balance_history(usd_value, flows_by_day)` (Task 1) — the sFOX sibling of `combine_native_ledger`; calls the EXISTING `chain_linked_twr(nav, daily_pnl, flows_by_day, prev0=first-observed)` (single reuse call, grep-verified), never `reconstruct_native_nav_and_twr`, never `derive_basis_series`, never a bespoke `r_t` loop. Deposit-neutral, gap-honest (NaN break, never 0.0-fill), guards inherited, degenerate-honest.
- `crawl_sfox_balance_history` (Task 2) — a budget-bounded windowed GET crawl of `get_balance_history`; raises `SfoxCrawlTruncatedError` on budget exhaustion or a material recent-edge shortfall (Pitfall 4); surfaces the observed earliest timestamp as the empirical inception (A1); honest empty for an empty account.
- `crawl_sfox_transactions` (Task 2) — a serial `after`-id cursor crawl of `get_transactions` at the client's `_TRANSACTIONS_MAX_LIMIT` (read, never hardcoded); typed truncation on budget; serial awaits honor the 1-req/10s gate.
- `sfox_flows_by_day` (Task 2) — signed daily USD flow Series + `list[ExternalFlow]` evidence; deposit/credit(+) withdraw/charge(−); buy/sell rotations EXCLUDED; `SfoxFlowValuationError` on any non-USD-family / malformed / unknown-action row.

## Task Commits

1. **Task 1 (TDD RED): independent-oracle tests for combine_sfox_balance_history** — `f715fb46` (test) *(prior session)*
2. **Task 1 (TDD GREEN): combine_sfox_balance_history via chain_linked_twr** — `79c6b7ec` (feat) *(prior session)*
3. **Task 2 (TDD RED): crawl + typed-flow-extraction tests** — `bf8da0f9` (test)
4. **Task 2 (TDD GREEN): bounded sfox crawls + typed-flow extraction** — `daf6fe75` (feat)

_Both tasks are TDD (RED test → GREEN impl). No REFACTOR commit was needed._

## Files Modified
- `analytics-service/services/broker_dailies.py` — `combine_sfox_balance_history` (Task 1, prior session).
- `analytics-service/services/sfox_read.py` — `SfoxCrawlTruncatedError`, `SfoxFlowValuationError`, `crawl_sfox_balance_history`, `crawl_sfox_transactions`, `sfox_flows_by_day`, `_require_sfox_client` boundary guard; `read_sfox_account` left byte-untouched.
- `analytics-service/tests/test_sfox_reconstruct.py` — P115 independent-oracle suite (combine) + crawl/flow suite (Task 2), ≥150 lines.
- `analytics-service/tests/test_sfox_read.py` — write-surface gate updated (see Deviations): admits the GET `get_balance_history` read + checks `withdraw` in call-form.

## Verification

- `pytest tests/test_sfox_reconstruct.py tests/test_sfox_read.py -q` → **35 passed**.
- Full analytics-service suite → **3913 passed, 95 skipped, 0 failed**.
- Acceptance greps:
  - `chain_linked_twr(` reuse in `broker_dailies.py` (non-comment) = **1** (the single reuse call; no bespoke TWR loop).
  - No `derive_basis_series(` / `compute_all_metrics(` / `reconstruct_native` **calls** inside `combine_sfox_balance_history` (grepped the function body). *(The file-wide `grep -c` reports 3, but all three are pre-existing docstring PROSE in sibling functions — not calls; see below.)*
  - No `wait_for(` / `withdraw(` / `create_order(` / `.post(` / `.put(` / `.delete(` **calls** in `sfox_read.py` — confirmed GET-only (only `get_balance_history`/`get_transactions`/`get_balances`/`get_trades` are called).
  - Oracle literal `0.004950` present in the test **4×** (the hand-derived value, not computed by the impl).

## P115 Oracle Independence (confirmed)

The oracle is an INDEPENDENT hand-derivation, NOT the module's own output re-asserted:
- Deposit day: `(1515 − 1010 − 500) / 1010 = 5/1010 = 0.004950495049504950…`, written as a literal and asserted to `abs=1e-12`. The deposit day books ~0.495%, categorically NOT ~50%.
- **Anti-pin (Pitfall 1):** the test independently computes `nav.pct_change().iloc[2]`, asserts it equals `0.5` (the naive, WRONG "+50% return" that counts the deposit), and asserts the real cashflow-neutral return differs from it by `> 0.4` — this is the regression tripwire against a return to `usd_value.pct_change()`.
- Withdrawal symmetric case: `(720 − 1010 − (−300)) / 1010 = 10/1010 = 0.009900990099009901…` — real PnL POSITIVE despite equity falling, anti-pinned vs `pct_change() < −0.2`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking / Rule 7 — Surface conflict] Updated the `sfox_read.py` write-surface grep gate in `test_sfox_read.py`**
- **Found during:** Task 2 (GREEN).
- **Issue:** The plan mandates `crawl_sfox_balance_history` (which must call `client.get_balance_history`) and `sfox_flows_by_day` (which must name the `"withdraw"` transaction type as data) in `sfox_read.py`, while the same task's acceptance says `test_sfox_read.py` stays UNCHANGED. Those are mutually unsatisfiable: the existing gate's `allowed` read-set (`{get_balances, get_trades, get_transactions, aclose}`) rejects the new GET `get_balance_history`, and its bare-substring forbidden list rejects the string `"withdraw"`. This is a plan-internal contradiction (the acceptance grep did not anticipate the new GET read or the `withdraw` transaction-type data value).
- **Fix:** Minimal, intent-preserving update to `test_write_surface_grep_gate` ONLY: (a) added `get_balance_history` to the allowed GET read-set (it is a GET-only composition — exactly what the gate is meant to permit); (b) changed the `withdraw` check from a bare substring to the CALL form (`withdraw(`, spaces stripped), matching the 120-02 plan's OWN acceptance grep `withdraw\(`. All other write verbs (`create_order`/`place_order`/`cancel_order`/`transfer`/`post`) stay bare-forbidden. Every behavioral pin in `test_sfox_read.py` (single-page/no-cursor, 3-leg, fail-loud, empty, boundary) is byte-identical.
- **Why safe:** The write-surface GUARANTEE is strengthened, not weakened — a `client.withdraw(...)` write call is still caught; only a `"withdraw"` DATA value is now permitted, which is what a transactions processor legitimately needs. `read_sfox_account` is byte-untouched.
- **Files modified:** `analytics-service/tests/test_sfox_read.py`.
- **Commit:** `daf6fe75`.

### Note on the file-wide acceptance greps (not deviations)
The plan's Task-1 acceptance grep `grep -v '^\s*#' broker_dailies.py | grep -c "compute_all_metrics\|derive_basis_series"` reports **3**, and `grep -v '^\s*#' sfox_read.py | grep -c "wait_for"` reports **1**, and the write-surface grep reports **1** — but every one of these matches is pre-existing DOCSTRING PROSE (the `combine_native_ledger` / `gap_fill` / module docstrings), never an actual call. The paren-form call greps are all **0**. These acceptance greps are imprecise (they do not strip triple-quoted docstrings, only `#` comment lines); the load-bearing invariants — one `chain_linked_twr` reuse call, zero backbone/`wait_for`/write calls in the new code — all hold.

## Threat Coverage

- **T-120-05 (Tampering, economic):** flow-in-numerator TWR via `chain_linked_twr` + the deposit-day anti-pin vs `pct_change()` — pinned by `test_deposit_day_books_real_pnl_not_the_deposit_hand_derived_oracle`.
- **T-120-06 (Tampering, integrity):** `SfoxCrawlTruncatedError` on budget/recent-edge shortfall — pinned by `test_crawl_balance_history_recent_edge_shortfall_raises` + the two budget-exhaustion tests.
- **T-120-07 (Tampering, fabrication):** missing NAV day → NaN break, never 0.0-filled — pinned by `test_interior_missing_nav_day_breaks_that_day_and_next_never_bridged` + `test_non_finite_usd_value_point_breaks_never_propagates_number`.
- **T-120-08 (DoS, self-inflicted):** serial awaits + hard request budget in both crawls; the `asyncio.wait_for` wall-clock bound is deferred to the worker seam (120-03) by design (documented in-code).
- **T-120-09 (Info disclosure):** `SfoxCrawlTruncatedError` / `SfoxFlowValuationError` messages carry counts / timestamps / action-name only — never a credential.

## Known Stubs

None. Every new function is fully wired and behavior-pinned. The `asyncio.wait_for` wall-clock bound is INTENTIONALLY at the worker seam (plan 120-03), not a stub — documented in the crawl docstrings and the module comment.

## Self-Check: PASSED

- `services/broker_dailies.py::combine_sfox_balance_history` — FOUND
- `services/sfox_read.py::crawl_sfox_balance_history` / `crawl_sfox_transactions` / `sfox_flows_by_day` — FOUND
- Commit `f715fb46` (Task 1 RED) — FOUND
- Commit `79c6b7ec` (Task 1 GREEN) — FOUND
- Commit `bf8da0f9` (Task 2 RED) — FOUND
- Commit `daf6fe75` (Task 2 GREEN) — FOUND

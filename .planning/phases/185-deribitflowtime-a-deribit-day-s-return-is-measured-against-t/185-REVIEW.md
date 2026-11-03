---
phase: 185-deribitflowtime-a-deribit-day-s-return-is-measured-against-t
reviewed: 2026-11-01T19:49:47Z
reviewed_at_sha: 03ccc90f44748a3746c77fd838de9bfd9c38db1d
diff_base: b1121aa7a8debe663182f5a8986ced2702dbd0fb
depth: deep
files_reviewed: 18
files_reviewed_list:
  - analytics-service/services/deribit_ingest.py
  - analytics-service/services/job_worker.py
  - analytics-service/tests/fixtures/deribit_option_round_trip.py
  - analytics-service/tests/test_deribit_key_mode_options_basis.py
  - analytics-service/tests/test_deribit_options_basis_ledger.py
  - analytics-service/tests/test_mtm_single_key.py
  - analytics-service/tests/test_options_cash_basis_caveat.py
  - src/__tests__/options-cash-basis-literal-pin.test.ts
  - src/app/(dashboard)/allocations/AllocationDashboardV2.options-caveat.test.tsx
  - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.kpistrip.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/lib/factsheet/allocator-portfolio-payload.test.ts
  - src/lib/factsheet/allocator-portfolio-payload.ts
  - src/lib/factsheet/types.ts
  - src/lib/options-cash-basis-flag.ts
  - src/lib/queries.my-allocation.test.ts
  - src/lib/queries.ts
findings:
  critical: 1
  warning: 4
  info: 0
  total: 5
status: issues_found
---

# Phase 185: Code Review Report

**Reviewed:** 2026-11-01T19:49:47Z
**Depth:** deep (cross-file: job_worker options step -> deribit_ingest assembly -> native_nav section 5 -> apply_marks seam -> key_inputs -> queries.ts -> allocator payload -> KpiStrip)
**Files Reviewed:** 18
**Status:** issues_found
**Scope:** MEDIUM and above only, per the brief.

## Summary

These checks came back clean:

- The extraction of `_assemble_deribit_native_ledger` is a pure move. A textual diff of the old `build_deribit_native_ledger` body against the new assembly body differs only in `account_state` -> `state_in` and the return statement.
- `report.indexable_currencies` is the same set the crawl returns.
- The options report copy resets every list the assembly writes.
- The marks seam is consistent. `native_ledger` is rebound before `_day_pnl_usd`, `_realized_terminal`, `_composed_flows_usd`, `flow_instants` and the apply's writer terminal are read, so no day is placed twice. The closed-window tail lands on the same writer level.
- Strategy mode is untouched. `retain_raw_rows` is passed only on `is_key_mode and denominator_config is None`.
- The writer key and the reader key match, and the literal pin holds.

Five problems were found:

- **CR-01 (BLOCKER).** The smoothed basis's terminal wedge leaves out the futures session RPL. Because of that, the options basis that this phase makes the key-mode headline fails section 5 on any options account with accrued perp RPL at derive time. It then falls back to cash. Which basis a key's published curve uses changes from night to night with live session state. A scratch probe confirms this (below).
- **WR-01.** The options step's budget slice ignores the post-crawl reserve.
- **WR-02.** The reader fails open on the caveat.
- **WR-03.** Keys with no derive after the writer shipped never get the flag.
- **WR-04.** Two tests that carry the phase's claims are tautological, and the harness default hid CR-01.

## Critical Issues

### CR-01: The smoothed headline's terminal wedge omits `futures_session_rpl`, so section 5 refuses the options basis nondeterministically

**File:** `analytics-service/services/deribit_ingest.py:2888-2889`. The live effect is at `analytics-service/services/job_worker.py:5527-5650`.

**Issue:** For `PNL_BASIS_SMOOTHED_MTM`, the terminal wedge is `state.native_upnl`. That is the combined futures and options session uPnL. The WR-01 derivation in the comment above it assumes `equity - combined_session_upl == cash + options_value - options_session_upl`. Deribit's identity, as `_cash_basis_wedge`'s own docstring states it (DERIBITWEDGE D-18), is `equity = balance + futures(session UPL + session RPL) + options value`. So under smoothed, the backward roll lands at a pre-history residual equal to `futures_session_rpl`.

DERIBITWEDGE fixed exactly this for the cash basis by using `equity - balance`. The smoothed arm was never updated, because it was an additive basis behind `SMOOTHED_MTM_ENABLED`. This phase makes it the live headline for every option-activity allocator key, so the defect now drives a published curve.

The section 5 tolerance is `max($1, 1e-4 * NAV)`, after a $5 dust cap. The nightly derive runs about 16 h after the 08:00 UTC settlement, so any open perp (funding) or intra-session futures close produces enough RPL to breach it. The consequences:

- `InceptionReconciliationError` (a `NavReconstructionError`) is caught by the options step's structural arm. The key silently degrades to cash with the caveat on nights that carry RPL, and moves to smoothed on nights that do not.
- Every night that flips basis rewrites the key's whole pre-mark history on /allocations. This brings back the D-03 determinism defect (`test_derive_determinism.py` scenario C) for options keys.
- The phase goal, "an option premium or payout is measured against equity that includes the option book", is not met for options accounts that also trade perps. That is most active accounts. The 185-02 dry run (key A smoothed OK) does not cover this: its read instant's RPL is unknown.

**Proof (scratch probe, not committed).** The probe used `test_smoothed_mtm_core`'s `_HELD_ROWS` and `_HELD_CHARTS` with the open-book summary from `test_smoothed_terminal_wedge_and_inception_closure_open_book`, plus `balance`. A second case added 0.005 BTC of `futures_session_rpl` and moved equity to match:

```
PROBE cash_settlement 0:     closes
PROBE cash_settlement 0.005: closes
PROBE smoothed_mtm 0:        closes
PROBE smoothed_mtm 0.005:    REFUSED InceptionReconciliationError(... currencies=[BTC] breach_ratio=300)
```

**Fix:** Give the smoothed and MTM arms the futures RPL leg. Reuse the balance anchor where it is present, so the wedge is deterministic in the same way the cash wedge is:

```python
if pnl_basis in (PNL_BASIS_MARK_TO_MARKET, PNL_BASIS_SMOOTHED_MTM):
    # equity - wedge must equal cash + settled book:
    # wedge = (equity - balance) - (options_value - options_session_upl)
    #       = futures(session UPL + session RPL) + options_session_upl
    terminal_upnl_native = {
        c: (
            _cash_basis_wedge(state, c)
            - float(state.native_options_value.get(c, 0.0))
            + float(state.native_options_session_upl.get(c, 0.0))
        )
        for c in _cash_wedge_currencies(state)
    }
```

Add `"smoothed_mtm"` to the `test_derive_determinism.py` scenario C parametrisation, and add a section 5 through-test with nonzero `futures_session_rpl` under smoothed. The test must go RED on today's `state.native_upnl` arm. Check that the same change is safe for the strategy MTM passes, which share this arm. They are additive, but they degrade on the same breach today.

## Warnings

### WR-01: The options step's budget slice takes 70% of the remaining budget with no post-crawl reserve, so it can starve the moved-flow prefetch and persist

**File:** `analytics-service/services/job_worker.py:5536-5548`. Compare `:6217-6223`, where the prefetch subtracts `_DERIVE_POST_CRAWL_RESERVE_S`.

**Issue:** `_options_step_timeout = remaining * 0.7`. The combine that follows runs on `asyncio.to_thread` and is not bounded at all. After the step, what is left of the 900 s budget must still cover:

- the Phase 177 at-instant prefetch, bounded by `remaining - 90 s` with a 10 s floor;
- the mark write, `apply_marks`, the persist, and the compose epilogue.

Take a large account whose cash crawl ends near 700 s, which is inside the 810 s per-crawl bound. The slice is about 140 s. If the options step uses most of it, the prefetch's `remaining - 90` goes negative and the read is not started (`_moved_flow_price_failure = "timeout"`). `_deribit_moved_flow_gate` then returns a transient `DispatchResult` for any key with an unstored moved INDEXED flow. Each retry repeats the same timing, so it ends in `failed_final`. Without moved flows, the persist can still overrun the outer `wait_for`.

That is the HIGH-01 outcome the bound exists to prevent: the options step sinks a healthy cash derive. The per-crawl bound's own invariant (`crawl + reserve <= outer`) is broken by inserting an unreserved step between the crawl and the reserve.

**Fix:** Size the slice from the budget left after the reserve, and count the combine against it:

```python
_options_remaining = (
    _options_budget
    - (asyncio.get_running_loop().time() - _derive_start)
    - _DERIVE_POST_CRAWL_RESERVE_S
    - _MOVED_FLOW_PRICE_MIN_SECONDS
)
_options_step_timeout = _options_remaining * _MTM_SECOND_PASS_BUDGET_FRACTION
```

Add a test where a long cash crawl, a slow options step and a key with moved flows still end DONE.

### WR-02: The caveat fails OPEN on the reader. A failed `key_inputs` read, or a departed key while `departed_history_unavailable` is set, hides it

**File:** `src/lib/queries.ts:4135-4141` and `:4162-4164`

**Issue:** `optionsCashBasis` borrows `marks_since`'s fail-closed rule. For `marks_since`, "closed" means naming no start, which is the conservative choice. For a disclosure, the conservative choice is the reverse.

- When the single `allocator_equity_derived` read errors, the function returns `none`, so `optionsCashBasis: false`. The book still draws its curve, with the extreme cash-basis option days, and no amber sentence.
- When `departed_history_unavailable` is set, a departed key's flag is dropped "because the curve may not contain that key". It may also contain it, and then its +333% days show without the caveat.

D-09 says the note shows "for any book with a Deribit key that trades options". This is the reader-side form of the brief's "fallback that silently publishes cash without the flag".

**Fix:** Fail toward showing the disclosure. On a read error, return `optionsCashBasis: true` only if any drawn key is a Deribit key; that is known from `apiKeys` without the read. Otherwise add a separate "caveat state unknown" field rendered as the same amber note. For departed keys, count the flag whenever the key is in `departedIncluded`, whatever `departedHistoryUnavailable` says. Over-warning is the safe error here. Pin both cases in `queries.my-allocation.test.ts`. They currently assert `false`, which pins the fail-open behaviour.

### WR-03: The flag is writer-only with no backfill, so keys whose last successful derive predates the writer never carry it

**File:** `analytics-service/services/job_worker.py:8828-8833` (writer). Reader: `src/lib/queries.ts:4157`.

**Issue:** `options_cash_basis` is written only by a fresh key-mode Deribit derive. Two kinds of drawn key never run one after this ships, yet still feed the book:

- A departed key. `eligible_key_predicate` excludes disconnected or revoked keys from the derive, but `marksIncludedKeys` keeps them in `departedIncluded`.
- A key whose derive keeps failing (permanent refusal, or `failed_final`).

Their frozen `key_inputs` rows have no flag, while their stored history is cash-basis option days, the very days the phase found (×3539 book, +529% days). D-08 (no PROD write, next nightly derive) covers live keys only. Neither the CONTEXT nor the SUMMARYs mention this gap. Plan 185-10's SC-3 reading will look green for any book whose extreme days sit on such a key.

**Fix:** Pick one and record it as a decision:

- (a) a one-off read-only census of drawn Deribit keys with option activity and no post-ship `key_inputs` row, reported in 185-10's SC-3 reading; or
- (b) on the reader, raise the caveat for a drawn Deribit key whose row has neither `options_basis` nor `options_cash_basis` and whose history the derive cannot refresh (departed, or `sync_status` not working).

### WR-04: Test intent. Two tests cannot fail on the logic they claim to pin, and the harness default forces every pre-existing key-mode test onto cash

**File:** `analytics-service/tests/test_deribit_key_mode_options_basis.py:698-715`, `:646-695`. `analytics-service/tests/test_mtm_single_key.py:283-292`.

**Issue:**

1. `test_bucketed_days_keep_the_cash_ledgers_own_return` claims "the stored return for each is the cash ledger's own, never an interpolated or filled number". But it mocks the options assembler to return `cash_round_trip_ledger()` and asserts the cash oracle comes back out. It tests only that the derive persists whatever ledger the mock hands it. If `_build_smoothed_option_mtm` started interpolating pre-retention days, or merged ΔMTM into them, this test would stay green. The F2 / SC-5 "never invent data" claim has no real-assembler test.
2. `test_bucketed_option_days_keep_cash_and_the_caveat` hand-sets `pre_mark_retention_option_days` on a mocked report. It never checks that the real smoothed assembly fills that list for a pre-retention option day. It also never checks that it leaves the list empty for an in-retention one, which is the condition the caveat now clears on.
3. The new `_base_patches` default makes `build_deribit_options_basis_ledger` raise `LedgerValuationError`. As a result, every pre-existing key-mode option-activity test (NAVMTM marks, writer basis, determinism, dual-mode) now runs only the cash fallback. Every options-path test in this phase uses hand-built `NativeLedger`s with fixed wedges. So no key-mode test drives the real assembly through `combine_native_ledger`'s section 5 with a realistic account summary. That is how CR-01 shipped with 14115 tests green.

**Fix:** Add a key-mode test through the real `build_deribit_options_basis_ledger`, using `_OptionsAdapterStub` and a summary with `balance` and nonzero `futures_session_rpl`. Add a real-assembler test that a pre-retention option round trip keeps the cash ledger's exact day values, comparing the options ledger's `native_pnl` on those days to the cash ledger's, and populates `pre_mark_retention_option_days`. Make sure at least the determinism and marks-seam suites also run once with the real options assembler instead of the refusing default.

---

_Reviewed: 2026-11-01T19:49:47Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Round 2

**Reviewed:** 2026-11-01T20:49:04Z, at `aeda736cd` (branch `feat/185-planning`)
**Depth:** deep. Fix diff `5b90cc435..aeda736cd` (code outside `.planning`), with the phase diff `b1121aa7a..aeda736cd` checked for regressions.
**Scope:** MEDIUM and above only.
**Round-2 counts:** critical 0, warning 1 (WR-03, carried from round 1, not a new defect), total 1.
**Status:** issues_found

### Verdict on the round-1 findings

| Finding | Status | Evidence |
|---|---|---|
| CR-01 | **Fixed** | Formula checked against the identity and against the cash branch (below). Neuter: putting back `terminal_upnl_native = state.native_upnl` turns four new tests RED: `test_key_mode_real_smoothed_assembly_closes_section_5_with_session_rpl`, `test_smoothed_mtm_session_rpl_does_not_move_returns`, `test_mark_to_market_perp_member_behaves_like_cash` and `test_smoothed_wedge_carries_futures_session_rpl_and_section5_closes`. |
| WR-01 | **Fixed** | `job_worker.py:5545-5550` subtracts `_DERIVE_POST_CRAWL_RESERVE_S` and `_MOVED_FLOW_PRICE_MIN_SECONDS` before taking the 0.7 slice. Neuter: removing both turns the `slice-under-the-floor-after-the-reserve` case RED. Removing either one alone also fails, because (180-90)*0.7 = 63 and (180-10)*0.7 = 119 are both over 60. |
| WR-02 | **Fixed** | `queries.ts:4145` returns `optionsCashBasis: drawsDeribit` on a failed read. `:4161` counts a departed key's flag whatever `departedHistoryUnavailable` says. Before the fix, both changed tests asserted the fail-open `false`; they now assert `true`, and the no-Deribit control asserts `false`. The 9 `optionsCashBasis` vitest cases pass. |
| WR-03 | **Not fixed** (documentation only, commit `581ea1501`) | See WR-03 (carried) below. |
| WR-04 | **Fixed** for the claims round 1 named | Neuter: forcing `report.pre_mark_retention_option_days = []` in the assembly turns `test_bucketed_days_keep_the_cash_ledgers_own_return` (now through the real assembler) and `test_pre_retention_days_keep_the_cash_ledgers_exact_values` RED. The latter also pins the in-retention empty list that the caveat clears on. The CR-01 neuter shows the new key-mode test drives the real assembly through section 5. Still not done: the marks-seam suite (`test_deribit_key_mode_options_basis.py:317ff`) still runs on hand-built options ledgers. Not raised: the seam is ledger-agnostic, and the real-assembly derive test covers the rebinding. |

7 phase test files at HEAD: 174 passed. The neuters ran in a throwaway worktree, which has been removed. No source file was modified.

### CR-01 formula check

Deribit's identity is `equity = balance + futures(session UPL + session RPL) + options_value`. The cash ledger's transaction log sums to `balance`, and futures P&L settles into `balance` at 08:00.

- **Smoothed.** The cash channel books every option row at full `change`, and the ΔMTM merge adds the settled book. The book channel guards that settled book against `options_value - options_session_upl`. So `Σnative_pnl + Σflow = balance + options_value - options_session_upl`. The required wedge is `equity - that = (equity - balance) - options_value + options_session_upl = futures(UPL + RPL) + options_session_upl`. That is `deribit_ingest.py:2892-2899` exactly.
- **Mark-to-market.** Inside coverage, an option trade books only `-commission`. The summary rows add realized plus unrealized P&L to the last settlement. Example: a 0.10 call marked 0.16 gives `Σ = (balance + 0.10) + 0.06 = balance + 0.16`, the same settled book. So the shared arm is right for the strategy MTM pass too. A perp-only MTM ledger now gets `equity - balance`, the cash wedge, and the navbreach test pins that.
- **Cash branch consistency.** Both arms read `balance` through `_cash_basis_wedge`. When `balance` is present, the smoothed or MTM wedge is the cash wedge less the settled book, which is exactly the book `native_pnl` carries on top of cash. When `balance` is absent, the component fallback gives `native_upnl - osu + ov - ov + osu`. That is the old value algebraically, though not bit-for-bit in floating point for an options currency. It matches the old value bit-for-bit for perp-only. This is below MEDIUM.
- The currency set moved from `state.native_upnl` keys to `_cash_wedge_currencies(state)`. For a live or replayed state these are the same summaries' currencies. A balance-only idle currency has `equity == balance`, so its wedge is 0 and it does not trip native_nav's unmarkable-wedge refusal (`native_nav.py:298`).
- No other consumer reads an MTM or smoothed `terminal_upnl_native`. `alt_terminal_upnl_native` (`job_worker.py:5421`) is the cash-ledger diagnostic only. `apply_marks` does not read the mark's `open_pnl`.

### WR-02 `drawsDeribit` rule

`queries.ts:6055-6057` is `apiKeys.some(k => marksKeys.included.includes(k.id) && k.exchange.toLowerCase() === "deribit")`.

- `apiKeys` includes departed keys, so a departed Deribit key in `departedIncluded` counts.
- `exchange` is a non-null `SupportedExchange`, so the `.toLowerCase()` call cannot throw.
- The rule over-warns on a failed read for a perp-only Deribit book, and for an eligible key with no drawn series. That is the direction round 1 asked for.
- `allocator-portfolio-payload.ts` and the factsheet read only the flag this function returns, so there is no second reader still failing open.

### Warnings

#### WR-03 (carried): a drawn Deribit options key whose `key_inputs` row predates the writer still shows its cash-basis option days with no caveat. The recorded resolution changes nothing the allocator sees

**File:** `src/lib/queries.ts:4148-4161` (reader) and `analytics-service/services/job_worker.py:8836-8845` (writer). The resolution is `185-10-PLAN.md` (commit `581ea1501`).

**Issue:** The census in 185-10 is a one-off, read-only report to the founder. On /allocations, a departed or permanently failing options key keeps a frozen row with neither `options_cash_basis` nor `options_basis`. Its option days stay at cash value, and the amber note is not shown. For a departed key this is not interim. `eligible_key_predicate` never re-derives the key, so the row is frozen for as long as the key stays in `departedIncluded`.

The stated premise is "the reader cannot tell a pre-ship options key from a perp-only Deribit key". That is true of the current payload, but the gap is closable:

- `allocator_equity_derived.computed_at` tells the reader which rows predate the writer.
- Better, the writer could stamp every post-ship Deribit key-mode row.

Either way, a row the writer has never touched can then fail open for a drawn Deribit key. That is the same "over-warning is the safe error" stance WR-02 adopted for a failed read. Today the code fails open on a transient read error and fails closed on a permanent frozen row, and these two rules contradict each other (CLAUDE.md Rule 7).

**Fix:** Pick one and record it in CONTEXT and ROADMAP. Today it is recorded only in a plan.

- (a) Writer stamp plus reader rule. Add a present-only `options_activity: bool` to every Deribit key-mode `key_inputs` payload, in the same additive D-15 voice as the two flags. In `readMarksStart`, raise the caveat for a drawn Deribit key whose row is missing or lacks `options_activity`:

  ```ts
  // writer-untouched Deribit row: the derive never classified it, so the disclosure fails open
  if (deribitKeyIds.has(keyId) && typeof payload?.options_activity !== "boolean") optionsCashBasis = true;
  ```

  This over-warns frozen perp-only Deribit keys only. Pin it with a departed-Deribit-key-with-an-old-row test that asserts `true`.
- (b) The founder accepts the permanent gap. Then record it as a decision, not as a measurement step, and make the 185-10 SC-3 verdict FAIL, not just "caveat", when a frozen drawn key has option activity.

### Checked, not raised (below MEDIUM)

- **WR-01 headroom.** The options `combine_native_ledger` (`job_worker.py:5586`) is still unbounded and still not counted against the slice. The 30% left after the slice is at least 25.7 s at the 60 s floor. Only if the combine takes longer than that does the moved-flow prefetch lose its 10 s floor. That is plausible only right at the floor.
- **WR-01 log line.** The not-started warning's "only %.0fs ... remained" now prints the post-reserve figure, about 100 s under the real remaining budget.
- **WR-01 refusal reason.** A budget-refused options step and a structural degrade write the same stored row (only `options_cash_basis: true`), so 185-10 must read Railway logs to tell them apart. The new refusal threshold is a crawl ending after about 714 s. The measured key C crawl of 436 s is well inside it.

---

_Round 2 reviewed: 2026-11-01T20:49:04Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Round 3

**Reviewed:** 2026-11-01T21:27:40Z, at `eda85702a` (branch `feat/185-planning`)
**Depth:** deep. Fix diff `eea401794..eda85702a` (code outside `.planning`), with WR-02's failed-read path checked for regressions.
**Scope:** MEDIUM and above only.
**Round-3 counts:** critical 0, warning 0, total 0.
**Status:** clean at MEDIUM and above. One records gap is noted below; it is not a code finding.

### Verdict on WR-03

**Fixed**, as D-13 states it.

**Writer** (`analytics-service/services/job_worker.py`)
- `_options_activity` is set at `:5689`. That line is inside `if is_key_mode and denominator_config is None` (`:5507`), within the `venue == "deribit"` branch (`:5155`).
- `denominator_config` is always None in key mode (`:4986-4992` passes None when `is_key_mode`). So every key-mode Deribit derive that reaches the combine sets the stamp.
- The stamp is set before the under-two-days short-circuit. Both exits (`:8952`, `:9275`) run `_run_key_mode_compose_epilogue`, and that is the only `key_inputs` writer (`:8864`).
- An exit that skips `:5689` writes no `key_inputs` row. That covers the completeness gate, the C2 floor (`:5475`), the section 5 refusal and transients; a refusal goes to `key_capture` instead (`_record_refusal`, `:5267`). The old row stays and the reader treats it as unclassified, which is the D-13 direction.
- Every assembly sets `has_option_activity` as a plain bool (`deribit_ingest.py:2753`), from the raw rows of a full-history crawl. False therefore means "no option row ever", not "unknown".
- ccxt payloads never carry the key, because the variable stays None outside the Deribit branch. `test_allocator_equity_dropped_day_pnl.py:1001` pins the Binance key set exactly and still passes.
- None of the later `.update()` payloads carries an `options_activity` key, so none can overwrite the stamp. Those payloads are the account summary, the ledger digest and the inception diagnostics.

**Reader** (`src/lib/queries.ts:4157-4174`)
- Only a JSON boolean classifies a row. A missing row, a null payload or a non-boolean value leaves a drawn Deribit key unclassified, and the caveat is raised.
- Classification only lifts that key's own unclassified state. It never clears an `options_cash_basis` raised by any row, so the rule can add a caveat and cannot hide one.
- **Non-Deribit book:** the set is filtered to `exchange === "deribit"`. When the set is empty, the loop is a no-op and the failed-read arm returns `false`.
- **WR-02 failed read:** behaviour is unchanged. `drawsDeribit = drawnDeribitKeyIds.size > 0` is the old `.some()` over the same filter.

### `drawnDeribitKeyIds` includes departed keys

- `marksKeys.included` is `allocatorEligibleApiKeyIds ∪ departedIncluded` (`queries.ts:4082`).
- `departedIncluded` is built from `apiKeys` (`:4054-4080`). `getUserApiKeys` reads `apiKeys` with no active or disconnected filter (`:3677-3681`).
- So every departed Deribit key that the TS rule includes is in the set. Neuter R2 below shows the tests depend on this.

### Neuters

Run in a throwaway worktree at `eda85702a`, which has been removed. No source file was modified.

**Python:** `tests/test_options_cash_basis_caveat.py`, 10 tests.

| Mutation | Result |
|---|---|
| Stamp only when True (`True if ... else None`) | 3 failed |
| Truthiness (`bool(has_option_activity)`) | 2 failed |
| Drop the epilogue write | 5 failed |

**TS:** `queries.my-allocation.test.ts` plus `options-cash-basis-literal-pin.test.ts`, 207 tests.

| Mutation | Result |
|---|---|
| R1: drop the unclassified-key loop | 3 failed |
| R2: build the set from `allocatorEligibleApiKeyIds` (departed keys out) | 2 failed |
| R3: any row classifies, whatever `options_activity` holds | 2 failed |
| R5: drop the Deribit filter (every drawn key) | 5 failed |
| R6: a failed read returns `false` (the WR-02 regression) | 1 failed |

**At HEAD:**
- The full Python suite: 14125 passed, 102 skipped (xdist, 2m07s).
- `mypy --strict` on `services/job_worker.py`: no issues.
- `tsc --noEmit`: clean.

### The flake

**The new tests do not depend on order or shared state.**
- `queries.my-allocation.test.ts` passes under `--sequence.shuffle` with seeds 1 to 6 (198/198 each).
- The five WR-03 tests also pass alone (`-t 'WR-03'`).
- The describe's `beforeEach` calls `resetState()` and resets the capture throttle. `resetState()` clears every fixture the new tests set: `apiKeys`, `csvDailyReturns`, `allocatorEquityDerived` and `tableErrors`.
- No new test spies on a global.

**What does fail in `src/lib`.** None of these files is touched by the phase: `git diff --stat b1121aa7a..eda85702a` is empty for all three.
- `src/lib/factsheet/compute.conventions.test.ts` fixtures B and C fail on every run on this machine. The `skew` values differ in the last ULP (`-0.11360716852722537` against `...38`). This is deterministic, so it is not the flake. It is the two-failure local baseline.
- `src/lib/auth.test.ts` (the `withRole` cases, 403 instead of 200) and `src/lib/analytics-client.test.ts` (the credential-trim cases) fail under shuffle: 1 to 4 failures with seeds 17, 34 and 51. In default order they never failed (3 runs of 3 clean).
- `auth.ts` holds module-level state: the cached approval-gate import (`:10-25`) and the per-client roles `WeakMap` (`:182`). These files are the likeliest source of the fixer's 3 extra failures. They were not reproduced in default order, so this is a lead, not a measured cause.

### Checked, not raised (below MEDIUM)

- **Deploy window.** Every row is unstamped until that key's first derive after the worker deploy. Until then every Deribit book shows the amber note, perp-only books included. The web deploy can land before the Railway deploy, and a skipped Railway deploy keeps the window open longer. D-13 accepts this: a row that was never stamped shows the note.
- **Eligible key with no series.** The set is eligible ∪ `departedIncluded`, not "has a drawn series".
  - A newly connected Deribit key has no row until its first derive, so the note shows on the current ready curve until then.
  - If that first derive never succeeds, the compose refuses with `COMPOSE_INCOMPLETE` (`job_worker.py:15909`). The book then shows the rebuilding panel, which hides the note. So this over-warn is only transient.
- **730-day window.** `marksIncludedKeys` takes departed-key windows from the 730-day per-key read (`queries.ts:5397`), but the compose reads full history. A departed Deribit key whose last stored return is more than 730 days old would be left out of the set while the compose could still draw it. This is only reachable for a key whose last stored day is older than the window. It predates this phase and is shared with WR-02.
- **Docstring.** Both say "one whose derive keeps failing" (`queries.ts:4120`, `options-cash-basis-flag.ts:32`). That holds only for a key that has failed since before ship. A key stamped once that fails afterwards keeps its last classification, which matches its frozen series.

### Records (not a code finding)

- **ROADMAP.** D-13 is recorded in `185-CONTEXT.md` only. The round-2 fix asked for CONTEXT and ROADMAP, and the `### Phase 185` entry in `.planning/ROADMAP.md` names no D-13.
- **`185-10-PLAN.md`.** Two sentences are false after D-13, because an unstamped Deribit row now shows the note from the web deploy onward:
  - `:83`: "the reader cannot tell a pre-ship options key from a perp-only Deribit key".
  - `:76-79`: when both deploys fall in one derive gap, "no book could show it".
- **Effect on step 0.** Its gate still needs `sc3-flag: ... present` lines from rows recomputed after the run, so it cannot pass on the screen alone. Update both files before 185-10 runs.

---

_Round 3 reviewed: 2026-11-01T21:27:40Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

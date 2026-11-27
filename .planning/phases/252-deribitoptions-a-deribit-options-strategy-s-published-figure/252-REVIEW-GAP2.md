---
phase: 252-deribitoptions-a-deribit-options-strategy-s-published-figure
scope: gap plans 252-09 and 252-10 (G252-MTM-PROMOTION)
diff_range: 33d4cf863..HEAD (worktree branch gsd/phase-252-mtm, head 5eb1fda9e), excluding .planning
reviewed: 2026-11-27T23:30:00Z
depth: deep
files_reviewed: 20
files_reviewed_list:
  - analytics-service/services/closed_sets.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/stitch_composite.py
  - analytics-service/tests/test_composite_headline_parity.py
  - analytics-service/tests/test_stitch_composite.py
  - analytics-service/tests/test_stitch_composite_job.py
  - src/__tests__/options-cash-wallet-withhold.census.test.ts
  - src/app/factsheet-share/[token]/page.cache-isolation.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetBody.smoothed-killswitch.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/basis-context.tsx
  - src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx
  - src/app/factsheet/[id]/v2/page.tsx
  - src/lib/closed-sets.ts
  - src/lib/factsheet/build-payload.ts
  - src/lib/factsheet/composite-read-path.headline-basis.test.ts
  - src/lib/factsheet/composite-read-path.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/lib/factsheet/headline-basis.ts
  - src/lib/factsheet/types.ts
findings:
  critical: 0
  warning: 3
  info: 7
  total: 10
  necessity: 0
status: issues_found
---

# Phase 252 gap plans 09 and 10: Code Review Report (G252-MTM-PROMOTION)

**Reviewed:** 2026-11-27
**Depth:** deep (call chains traced into `_reconstruct_all`, `derive_basis_series`, `compute_all_metrics`, `deribit_ingest` mark retention, the `sync_strategy_analytics_status` bridge, and every TS reader the plan 10 audit lists)
**Files reviewed:** 20
**Status:** issues_found

**Severity mapping to this repo's rule.** No CRITICAL or HIGH finding. The three `WR-` findings are MEDIUM. WR-01 and WR-03 are user-facing (a published composite's status or headline changes), and WR-02 is user-facing (a headline the ruled criteria would show stays withheld). Every `IN-` item is LOW or Info: recorded here only, never fixed and never booked in `TODOS.md`.

## Summary

The core promotion is correct, and I traced every focus item to code.

- **One upsert, nothing cash left behind.** `compute_all_metrics` returns a fixed top-level key set (`services/metrics.py`, the `sanitize_metrics({...})` literal), so `headline_payload.update(_headline_metrics)` replaces every metric column. The marker, the reason pop and the smoothed scalars all ride the one `_write_headline_and_by_basis` payload.
- **Exactly one marker.** `mark_to_market_available` checks option activity first, so whenever `smoothed_ok` is True and the row does not promote, `mtm_reason` is `unsmoothed_options_book`. A stale `headline_basis` is popped on every non-promoting stitch, including one where `smoothed_ok` is False. `twr_chain_broken` and the NAV guard keys are drop-stale'd from the headline result.
- **`run_csv_strategy_analytics`** rebuilds flags wholesale, so a composite that becomes single-key loses the marker.
- **No change for no-option composites.** With `smoothed_ok` False, every new conditional takes the cash branch, and the only new write is a pop of an absent key. MT5 keys cannot be composite members.
- **Zero-fill derive.** `gap_fill_daily_returns(stitched_smoothed)` keeps in-index NaN days, so `compute_all_metrics` sets `headline_since` and P4 sees the break. Under `simple` cumulation it raises `ValueError`, which degrades to P2. Both are fail-safe.
- **TS read path.** Every withhold helper (`isHeadlineWithheld`, `isRangeWithheld`, `windowCoverageNote`, `headlineBenchSource`) is gated on `basis === "cash_settlement"`. The provider seed and the segment condition read the same native payload, and composites never get a USD view. The only payload cache key literal is `factsheet-v2-payload-v30`.
- **Sibling kinds.** I confirmed the plan's claim that nothing under `src/` reads the sibling kinds: the only hit is a name list in `src/lib/metrics-parity-helper.ts`. The Python portfolio router reads the top-level `returns_series`, which now follows the promoted headline.

Tests run at head: `pytest tests/test_stitch_composite.py tests/test_stitch_composite_job.py tests/test_composite_headline_parity.py` gave 170 passed. `vitest` on the three plan-10 test files gave 95 passed.

The defects are at the edges:

- WR-01: the smoothed pass now always runs on PROD, so its transient failures can sink the cash composite.
- WR-02: P3 is stricter than the binding criterion text.
- WR-03: the promotion is time-limited by construction, and nothing records that.

## Warnings

### WR-01: A transient failure in the now-unconditional smoothed pass can move a healthy cash composite to `computing` and then `failed` (MEDIUM, user-facing)

**File:** `analytics-service/services/job_worker.py:14922` (`smoothed_ok`), `:15001` (`return smoothed_result`), `:14455-14466` (the `_reconstruct_all` Deribit arm's bare `except Exception: ... raise`), `:14395-14408` (the per-crawl `asyncio.TimeoutError` arm)

**Issue:** Before this diff, PROD has `SMOOTHED_MTM_ENABLED` unset, so an option-active composite stitch ran no third pass. Now every stitch of one runs it, the recurring `ledger-refresh-composite` refresh included. The pass is a third full Deribit crawl plus one public `get_tradingview_chart_data` read per held option instrument. GLB-3 degrades only structural, budget and outer-slice-timeout failures. Three other exits fail the whole job instead:

1. A 429 or geo-block in the smoothed crawl returns a transient `DispatchResult` at `:15001`. This is pinned by `test_g252_transient_in_the_smoothed_pass_retries_the_job_and_writes_nothing`.
2. `DeribitTransientReadError` from `fetch_deribit_option_daily_marks` falls through the bare `raise` at `:14466`. It is not in `_PERMANENT_LEDGER_ERRORS`, so it escapes `run_stitch_composite_job` as an exception. `classify_exception` files it `transient` or `unknown`, and both retry. No test covers this exit.
3. The inner per-crawl bound returns a transient when the smoothed slice (0.7 × remaining, up to 840 s) is larger than `_BROKER_CRAWL_TIMEOUT_S` (810 s). That happens when the cash passes finished in under about 43 s.

Each retry is a `failed_retry`, and the bridge (`sync_strategy_analytics_status`, migration `20261105120000`) rewrites a plain `complete` row to `computing`, so the factsheet reads as recomputing. When the attempts run out, the job is `failed_final`. Branch (b) of the bridge then writes `computation_status = 'failed'` unless the job is protected. Protection requires a `ledger-refresh*` source and a healthy published row (`is_protected`), so a user-initiated stitch or a private composite is unprotected.

The plan accepted this as T-252-27 ("transients surface exactly as with the flag on"). That acceptance was the planner's, not a founder ruling. It also does not match the stated purpose of GLB-3: the additive basis must never sink the cash headline. The cash pass has the same transient exposure on its own crawl. The new part is the extra crawl and the per-instrument chart reads, and that the additive basis is what turns a blip into a failed cash composite.

**Fix (minimal):** treat a transient smoothed-pass outcome as a degrade when retrying cannot protect anything:
```python
# in step 6b, around the smoothed _reconstruct_all call
_final_attempt = int(job.get("attempts") or 0) >= int(job.get("max_attempts") or 3)
try:
    smoothed_result = await asyncio.wait_for(_reconstruct_all(...), timeout=...)
except DeribitTransientReadError as exc:
    if not _final_attempt:
        raise
    smoothed_result = None  # degrade: cash headline + named withhold, logged at WARNING
...
if isinstance(smoothed_result, DispatchResult):
    if smoothed_result.error_kind == "transient" and _final_attempt:
        smoothed_result = None  # degrade on the last attempt instead of failed_final
    else:
        return smoothed_result
```
Retrying on the earlier attempts keeps a promoted row from flipping to withheld on a single blip. Degrading on the last attempt stores the safe state (cash plus the named withhold) instead of `failed`. Add a test for the escaped `DeribitTransientReadError` exit, which no test drives today. If the founder prefers the current behaviour, record it as a decision in `252-CONTEXT.md` (and ROADMAP, per the deviation policy) rather than leaving it as a plan-level accept.

### WR-02: P3 tests the member's whole unclipped history, but the binding criterion says "inside the span" (MEDIUM, user-facing, fail-safe direction)

**File:** `analytics-service/services/job_worker.py:15092-15097`

**Issue:** `252-CONTEXT.md` ("Decided at gap planning", 2026-11-27) states P3 as: "no option day **inside the span** is valued at cash for mark retention". The code passes `retention_bucketed=any(m.get("pre_mark_retention_option_dailies") for m in smoothed_member_metas)`. That list is built in `_reconstruct_deribit` from the member's full reconstruction (`completeness.pre_mark_retention_option_days`), before `clip_to_window`. A day outside the member's composite window, or before the stitched span, therefore blocks promotion even though no published figure contains it.

The cutoff is anchored on today (`deribit_ingest.py` `_build_smoothed_option_mtm`: `retention_cutoff = today - retention_days`, with a 30-day tolerance band). Once a long-history member has an option instrument that predates its window and that instrument's whole life falls behind the horizon, P3 fails on every later stitch, permanently. The composite can then never promote, although the criteria the founder's ruling was measured against would promote it. The plan 09 table carried the unscoped reading and did not note the difference from CONTEXT.

**Fix:** scope the P3 input to each member's window inside the stitched span before calling the decision:
```python
def _in_window(entries: list[str], lo: str, hi: str | None) -> bool:
    return any(lo <= e.split(":", 1)[1] and (hi is None or e.split(":", 1)[1] < hi) for e in entries)

retention_bucketed = any(
    _in_window(meta.get("pre_mark_retention_option_dailies") or [], *_window_by_seq[seq])
    for (seq, _), meta in zip(clipped_smoothed, smoothed_member_metas, strict=True)
)
```
`clipped_smoothed` is only bound when the pass produced metas. When it did not, `smoothed_member_metas` is empty, so guard the expression for that case. Add a matrix case with a bucketed day outside the member window that promotes, beside the existing in-window case that does not. If the stricter reading is intended, amend CONTEXT P3 to say "anywhere in a member's history" so the code and the binding text agree.

### WR-03: A promoted headline will demote on its own as marks age past the retention horizon, and nothing records or surfaces it (MEDIUM, user-facing)

**File:** `analytics-service/services/job_worker.py:15104-15113` (the decision log lines); the decision inputs at `:15092-15102`

**Issue:** By the code's own retention model, mark data for an expired option is gone about 913 days after the fact, and the cutoff is anchored on today. Every held option instrument therefore goes through two stages:

1. While its marks straddle the horizon, it is a straddler. `option_mtm_daily` refuses it under D-07, the member's smoothed build raises `LedgerValuationError`, GLB-3 degrades, and P2 fails.
2. Once its whole life is behind the horizon, it is bucketed, and P3 fails (see WR-02 for the in-window case).

So a promoted, published composite flips back to the withheld cash headline on some later refresh, with no code change and no founder action. The members measured at 704, 410 and 1232 days of history are all on that clock. Under the 2026-11-25 ruling ("only if it actually works") this is the correct fail-safe state. The defects are that it is not recorded and not loud:

- I found no mention of the time limit in CONTEXT, either plan, either SUMMARY or the post-deploy section.
- A demotion through P3 logs only `logger.info("... not promoted ... (retention_bucketed_option_days)")`. The P2 path has the GLB-3 `logger.warning`, but that warning does not say a published headline was withdrawn.

**Fix:** (a) record in `252-CONTEXT.md` and the ROADMAP 252 section that the promotion is time-limited by the venue's mark retention, and that keeping it promoted needs a separate founder ruling on narrowing the MTM span (CONTEXT 2026-11-26). (b) When the row read at persist (`existing_flags`) carries `headline_basis == "smoothed_mtm"` and this stitch does not promote, log at WARNING and report to Sentry with the cause literal (no amount, date or member id), so a withdrawn published headline is visible.

## Info (LOW / Info: recorded here only, not fixed, not booked)

### IN-01: `initialBasis` seeds once, so a refresh without a remount can keep `smoothed_mtm` selected after the segment disappears

**File:** `src/app/factsheet/[id]/v2/basis-context.tsx:94-95`, `src/app/factsheet/[id]/v2/FactsheetView.tsx:530`, `:3257`

The seed is documented as a seed. If the page re-renders with a demoted payload without remounting (an RSC `router.refresh()` from an owner action after a re-stitch), `basis` stays `smoothed_mtm` while the flag-off segment condition hides the segment. The KPI strip would then show an unpromoted smoothed object (for example the chain-broken one P4 refused) with no active segment. This needs a re-stitch to land mid-session. One fix is to key `BasisProvider` on `payload.headlineBasis`.

### IN-02: On a promoted row the MTM toggle's reason falls through to the generic copy

**File:** `src/lib/factsheet/composite-read-path.ts:507-510`, `src/app/factsheet/[id]/v2/basis-context.tsx` (`mtmDisabledReasonCopy` default arm)

The reason is dropped on promotion, so `mtmGate.reason` is undefined. The steady caption under the toggle reads "Mark-to-market unavailable for this strategy." on every promoted composite, losing the specific options-book cause. This is honest, but less informative.

### IN-03: The cash-basis sentence on a promoted row says "Headline figures withheld" while the headline is shown

**File:** `src/lib/factsheet/headline-basis.ts` (`OPTIONS_CASH_WALLET_PHRASES.headline`), reached through the new `applyHeadlineBasis` branch at `composite-read-path.ts:594`

On a promoted row the headline is the smoothed one and is published. Only the cash view is withheld. The reused wave-1 sentence is slightly off for that state. This is user-facing copy, so it is the founder's call at the visual check.

### IN-04: Printed and tearsheet views show smoothed figures with no basis label

**File:** `src/app/factsheet/[id]/v2/FactsheetView.tsx:3125` (`factsheet-v2-no-print` on the control bar)

The page now opens a promoted composite on the smoothed basis, and the only basis label is the hidden segmented control. The chart caption appears only while the MTM toggle can render. This matches the lists and the OG card, which print the smoothed top-level figures unlabelled too.

### IN-05: Unpromoted option composites now carry a smoothed-basis warning and pay an extra series read on PROD

**File:** `analytics-service/services/job_worker.py` (the MED-01 `pre_mark_retention_option_dailies` union into `member_warn_flags`); `src/lib/factsheet/composite-read-path.ts` (`readSmoothedSeries`, gated on `smoothedAvailable`)

These are Phase 132 behaviours, live on PROD for the first time:

- A P3-refused row is stamped `complete_with_warnings` for a caveat about the smoothed basis, while its headline is cash.
- Every option composite factsheet now performs the smoothed series read, and a failed read throws `CompositeSeriesReadError`.

### IN-06: `json-ld.ts` omits CAGR on a promoted row

**File:** `src/lib/factsheet/json-ld.ts` (reads the redacted cash overlay)

Already recorded in the plan 10 SUMMARY as a safe-direction limit.

### IN-07: The sibling series rows stay cash while their comment says they agree with the headline

**File:** `analytics-service/services/job_worker.py` (`_upsert_siblings` call site)

Recorded in plan 09 as a known mismatch. I independently confirmed that no `src/` file reads those kinds.

## Not findings (checked and cleared)

- **Stale cash column on a promoted row:** cleared. The top-level key set is fixed, and `test_g252_promoted_and_cash_metrics_share_one_key_set` pins it.
- **Marker plus reason both present, or neither:** cleared on every success path and on `_stamp_failed` (M-2 merge). The TS predicate also gives the reason precedence.
- **Other writers dropping or keeping the marker:** `run_csv_strategy_analytics` rebuilds the flags (marker dropped, correct). The finalize-wizard composite refusal replaces flags with `{csv_source, composite}` on a `failed` row (not rankable; it predates this diff).
- **Snapshot flags (`effectiveDataQualityFlags`):** bound to `computed_at`, and composites carry a live marker.
- **Allocator per-key series:** keyed by `api_key_id`, never by the composite's strategy id. Blends of strategy legs stay in the existing `<deferred>` entry.
- **Necessity:** no finding. The record-or-null guards in `isSmoothedHeadlineRow` sit on an untrusted JSONB boundary.

---

_Reviewed: 2026-11-27_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

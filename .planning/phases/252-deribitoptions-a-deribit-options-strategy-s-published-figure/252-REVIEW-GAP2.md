---
phase: 252-deribitoptions-a-deribit-options-strategy-s-published-figure
scope: gap plans 252-09 and 252-10 (G252-MTM-PROMOTION)
diff_range: 33d4cf863..HEAD (worktree branch gsd/phase-252-mtm, head 5eb1fda9e), excluding .planning
reviewed: 2026-11-27T23:30:00Z
revised: 2026-11-27 (round-1 self-check: WR-02 downgraded to IN-08 after reading probe criterion C3; WR-01 protection rule corrected from the bridge source; the former WR-03, now WR-02, reworded)
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
  warning: 2
  info: 8
  total: 10
  necessity: 0
status: issues_found
---

# Phase 252 gap plans 09 and 10: Code Review Report (G252-MTM-PROMOTION)

**Reviewed:** 2026-11-27
**Depth:** deep. I traced these call chains in source: `_reconstruct_all`, `derive_basis_series`, `compute_all_metrics`, `deribit_ingest` mark retention, the `sync_strategy_analytics_status` bridge (`v_publish_healthy`, `is_protected`, branch (b)), the factsheet basis-gated withhold helpers, `computeOgHeadline`, and the `figure_withheld_by` derivation in `queries.ts`. **Relied on, not re-traced:** the plan 10 SUMMARY's same-payload and no-USD-view confirmations, and its per-seam list audit (`shapeRowAnalytics`, `figure-record-scalars.ts`, the constituent parser), which the census arm 1b exercises (95 vitest cases green at head).
**Files reviewed:** 20
**Status:** issues_found

**Severity mapping to this repo's rule.** No CRITICAL or HIGH finding. The two `WR-` findings are MEDIUM and user-facing: a composite's status or published headline changes. Every `IN-` item is LOW or Info: recorded here only, never fixed and never booked in `TODOS.md`.

## Summary

The core promotion is correct. I traced each focus item to code, with the exceptions named on the Depth line.

- **One upsert, nothing cash left behind.** `compute_all_metrics` returns a fixed top-level key set (`services/metrics.py`, the `sanitize_metrics({...})` literal), so `headline_payload.update(_headline_metrics)` replaces every metric column. The marker, the reason pop and the smoothed scalars all ride the one `_write_headline_and_by_basis` payload.
- **Exactly one marker.** `mark_to_market_available` checks option activity first, so whenever `smoothed_ok` is True and the row does not promote, `mtm_reason` is `unsmoothed_options_book`. A stale `headline_basis` is popped on every non-promoting stitch, including one where `smoothed_ok` is False. `twr_chain_broken` and the NAV guard keys are drop-stale'd from the headline result.
- **`run_csv_strategy_analytics`** rebuilds flags wholesale, so a composite that becomes single-key loses the marker.
- **No change for no-option composites.** With `smoothed_ok` False, every new conditional takes the cash branch, and the only new write is a pop of an absent key. MT5 keys cannot be composite members.
- **Zero-fill derive.** `gap_fill_daily_returns(stitched_smoothed)` keeps in-index NaN days, so `compute_all_metrics` sets `headline_since` and P4 sees the break. Under `simple` cumulation it raises `ValueError`, which degrades to P2. Both are fail-safe.
- **TS read path.** Every withhold helper (`isHeadlineWithheld`, `isRangeWithheld`, `windowCoverageNote`, `headlineBenchSource`) is gated on `basis === "cash_settlement"`. The provider seed and the segment condition read the same native payload, and composites never get a USD view. The only payload cache key literal is `factsheet-v2-payload-v30`.
- **Sibling kinds.** I confirmed the plan's claim that nothing under `src/` reads the sibling kinds: the only hit is a name list in `src/lib/metrics-parity-helper.ts`. The Python portfolio router reads the top-level `returns_series`, which now follows the promoted headline.

Tests run at head: `pytest tests/test_stitch_composite.py tests/test_stitch_composite_job.py tests/test_composite_headline_parity.py` gave 170 passed. `vitest` on the three plan-10 test files gave 95 passed.

The defects are at the edges:

- WR-01: the smoothed pass now always runs on PROD, so its transient failures can sink the cash composite. A promoted row is more exposed than a withheld one.
- WR-02: the promotion is time-limited by construction, and nothing records that.
- IN-08: CONTEXT's wording of P3 ("inside the span") does not match probe criterion C3 or the code, which both check the whole history.

## Warnings

### WR-01: A transient failure in the now-unconditional smoothed pass can move a healthy cash composite to `computing` and then `failed` (MEDIUM, user-facing)

**File:** `analytics-service/services/job_worker.py:14922` (`smoothed_ok`), `:15001` (`return smoothed_result`), `:14453` onwards (the `_reconstruct_all` Deribit arm's `except Exception as exc:`, which re-raises anything not geo-blocked), `:14392` onwards (the per-crawl `except asyncio.TimeoutError:` arm)

**Issue:** Before this diff, PROD has `SMOOTHED_MTM_ENABLED` unset, so an option-active composite stitch ran no third pass. Now every stitch of one runs it, the recurring `ledger-refresh-composite` refresh included. The pass is a third full Deribit crawl plus one public `get_tradingview_chart_data` read per held option instrument. GLB-3 degrades only structural, budget and outer-slice-timeout failures. Three other exits fail the whole job instead:

1. A 429 or geo-block in the smoothed crawl returns a transient `DispatchResult` at `:15001`. This is pinned by `test_g252_transient_in_the_smoothed_pass_retries_the_job_and_writes_nothing`.
2. `DeribitTransientReadError` from `fetch_deribit_option_daily_marks` falls through that arm's final `raise`. It is not in `_PERMANENT_LEDGER_ERRORS`, so it escapes `run_stitch_composite_job` as an exception. `classify_exception` files it `transient` or `unknown`, and both retry. No test covers this exit.
3. The inner per-crawl bound returns a transient when the smoothed slice (0.7 × remaining, up to 840 s) is larger than `_BROKER_CRAWL_TIMEOUT_S` (810 s). That needs a member crawl hung for 810 s and cash passes that finished in under about 43 s, so it is the rarest of the three.

Each retry is a `failed_retry`, and the bridge (`sync_strategy_analytics_status`, migration `20261105120000`) rewrites a plain `complete` row to `computing`, so the factsheet reads as recomputing. When the attempts run out, the job is `failed_final`. Branch (b) of the bridge then writes `computation_status = 'failed'` unless the failure is protected. `is_protected` needs both of these:

- a `ledger-refresh` or `ledger-refresh-composite` source on the job;
- `v_publish_healthy`, which is the row's own status being `complete` or `complete_with_warnings` when the bridge runs. It says nothing about public visibility.

The first `failed_retry` already moved a plain `complete` row to `computing`, so at `failed_final` only a `complete_with_warnings` row is still protected. The stitch's own comment says the same (the WR-01 note above `MarkerLiveState`). A user-initiated stitch is never protected.

**A promoted row is more exposed than a withheld one.** The withheld rows carry `twr_chain_broken`, which promotes the status to `complete_with_warnings`. A promoted row drops it, because P4 guarantees no break, so unless another guard flag fires it becomes a plain `complete` row and loses the recurring-refresh protection.

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

### WR-02: A promoted headline will demote on its own as marks age past the retention horizon, and nothing records or surfaces it (MEDIUM, user-facing)

**File:** `analytics-service/services/job_worker.py:15104-15113` (the decision log lines); the decision inputs at `:15092-15102`

**Issue:** By the code's own retention model, mark data for an expired option is gone about 913 days after the fact, and the cutoff is anchored on today. Every held option instrument therefore goes through two stages:

1. While its marks straddle the horizon, it is a straddler. `option_mtm_daily` refuses it under D-07, the member's smoothed build raises `LedgerValuationError`, GLB-3 degrades, and P2 fails.
2. Once its whole life is behind the horizon, it is bucketed, and P3 fails.

So a promoted, published composite flips back to the withheld cash headline on some later refresh, with no code change and no founder action. When that happens for each member depends on when it first held an option across a settlement. That date is unmeasured. The 1232-day member passed the probe, so its held options are inside the horizon today, or the venue keeps marks longer than the 913-day default. Under the 2026-11-25 ruling ("only if it actually works") this is the correct fail-safe state. The defects are that it is not recorded and not loud:

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

### IN-08: CONTEXT words P3 as "inside the span"; probe criterion C3 and the code check the member's whole history

**File:** `analytics-service/services/job_worker.py:15092-15097`; `252-CONTEXT.md` ("Decided at gap planning"); `252-06-PLAN.md` (C3)

CONTEXT says "P3 no option day inside the span is valued at cash for mark retention". Plan 09 says P3 mirrors C3, and `252-06-PLAN.md` defines C3 as "the build's `CompletenessReport.pre_mark_retention_option_days` is empty", which covers the whole history. The code matches C3: the list comes from the member's unclipped reconstruction, so a bucketed day before the member's composite window also blocks promotion. That is fail-safe, and it is the criterion the PROD probe measured. This is not a code defect. I first filed it as a MEDIUM and withdrew that after reading C3. The CONTEXT wording should still be aligned with C3 so the next reader does not take the stricter check for a bug. If the founder ever wants the narrower reading, the change is to filter each meta's `{ccy}:{day}` entries to that member's `_window_by_seq` window before the `any(...)`.

## Not findings (checked and cleared)

- **Stale cash column on a promoted row:** cleared. The top-level key set is fixed, and `test_g252_promoted_and_cash_metrics_share_one_key_set` pins it.
- **Marker plus reason both present, or neither:** cleared on every success path and on `_stamp_failed` (M-2 merge). The TS predicate also gives the reason precedence.
- **Other writers dropping or keeping the marker:** `run_csv_strategy_analytics` rebuilds the flags (marker dropped, correct). The finalize-wizard composite refusal replaces flags with `{csv_source, composite}` on a `failed` row (not rankable; it predates this diff).
- **`strategy_analytics.daily_returns` beside smoothed scalars:** cleared. `resolveDailyReturnSeries` prefers that column over `returns_series` (in the returns route and the portfolio router), and the stitch payload never writes it. On this branch I found no writer of that column in `analytics-service/services`, `analytics-service/routers` or `src/`. The baseline SQL only reads it, at the export site. So on a composite row it holds no cash curve, and readers fall back to the top-level `returns_series`, which follows the promoted headline. This is a measured search result, not proof of absence.
- **Snapshot flags (`effectiveDataQualityFlags`):** bound to `computed_at`, and composites carry a live marker.
- **Allocator per-key series:** keyed by `api_key_id`, never by the composite's strategy id. Blends of strategy legs stay in the existing `<deferred>` entry.
- **Necessity:** no finding. The record-or-null guards in `isSmoothedHeadlineRow` sit on an untrusted JSONB boundary.

---

_Reviewed: 2026-11-27_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_


---

## Round 2 (re-review of the fix commits, 2026-11-28)

**Scope.** Fix commits `7be54fbf3`, `72a624982`, `6bbe725d5` and `301f5e2a8` (`git diff 924df402d..HEAD -- . ':!.planning'`: `job_worker.py`, `test_stitch_composite_job.py`, `composite-read-path.ts` and its headline-basis test). Also the records commit `89cba0971` (CONTEXT and ROADMAP). For the whole-phase verdict on `33d4cf863..HEAD`, I relied on the round-1 deep review at `5eb1fda9e` plus this fix diff. Between `5eb1fda9e` and `924df402d` I measured no source change outside `.planning`: only the two review-document commits.

**Gates re-run at head:** `pytest tests/test_stitch_composite_job.py tests/test_stitch_composite.py tests/test_composite_headline_parity.py` gave 174 passed. `mypy --strict services/job_worker.py services/stitch_composite.py` passed with no issues. `vitest run src/lib/factsheet/composite-read-path.headline-basis.test.ts` gave 50 passed.

**Frontmatter note.** The frontmatter counts above are the round-1 counts. The round-2 result is stated here.

### Verdict per round-1 MEDIUM

| Finding | Round-2 status |
|---|---|
| WR-01 | **Fixed for the exits round 1 named. One residual of the same class stays open: R2-WR-01 below (MEDIUM).** |
| WR-02 | **Fixed.** Part (a), the record, is done by `89cba0971`. Part (b), WARNING plus Sentry, is done by `72a624982`. |
| SFH-MEDIUM-1 | **Fixed**, and fully: the fixer's one stated residual cannot occur (see below). |

### What I verified

**Last-attempt detection (WR-01).** `_smoothed_final_attempt` is `attempts >= max_attempts`, and both values must be `int`.
- This matches `mark_compute_job_failed` (latest definition, `20261124120000`: `ELSIF v_attempts >= v_max_attempts THEN v_new_status := 'failed_final'`).
- The claim RPCs run `attempts = attempts + 1 ... RETURNING *`, so the handler sees the post-increment count. On the run that `mark_compute_job_failed` would make `failed_final`, the flag is True.
- `max_attempts` is `INTEGER NOT NULL DEFAULT 3` (`20260411144407:122`). No enqueue site in `supabase/migrations`, `src/` or `analytics-service/services|routers` overrides it, so no path makes every attempt "last".
- A synthetic job dict without the counts reads as not final, which keeps the old retry behaviour. The reconcile watchdog resets a stalled row without decrementing `attempts`; that only makes a row final earlier, which agrees with the SQL rule.
- The same expression already appears at three sibling sites in the file.

**A degrade can never promote.** Every degrade sets `smoothed_result = None`. `smoothed_metrics_json` and `_smoothed_basis_result` are initialised to `None` before the block and are only assigned inside `if smoothed_result is not None`. `smoothed_headline_promotion(smoothed_computed=False, ...)` returns `(False, "smoothed_basis_not_computed")` first, and the `assert` in the headline selection guards the promoted branch. A DEFERRED preflight result carries `error_kind=None`, so the new branch never converts it. The new tests pin both directions: attempt 3/3 ships DONE with no `headline_basis` and the cash headline, and attempt 1/3 still raises. The fixer's two neuters show the tests can fail.

**Sentry content (WR-02).** The message text is `"... a promoted smoothed headline was withdrawn ({cause})"`, where the cause is one of the closed literals or `not_option_active`. It carries no strategy id, member id, date or amount, and the test asserts the strategy id is absent from it. Two caveats are stated, not filed:
- The event carries a `compute_job_id` tag (a job UUID). That matches the file's ten existing `set_tag("compute_job_id", ...)` sites. It is not a member or strategy id.
- With the SDK's default logging integration, the `logger.warning` line, which carries the strategy id like every other line in the function, rides as a breadcrumb. This is also the file's existing pattern.

`_not_promoted_cause` is read only when `smoothed_ok` is True, so the conditional expression never touches an unbound name. mypy agrees.

**TS seed condition (SFH-MEDIUM-1).** `smoothedHeadline` now follows the `Promise.all`, and it is the only place `headlineBasis` is derived: `FactsheetView`'s provider seed and its flag-off segment condition both read `payload.headlineBasis`. The fixer worried about duplicate dates. `normalizeDailyReturns` on an array input (`portfolio-math-utils.ts:24`) filters on a string date and a finite value only, and it does **not** dedup. `parseMtmSeriesPayload` already enforces those same predicates and returns null below two rows. So a non-null parsed series always yields at least two normalised points, and `build-payload` always emits `seriesByBasis.smoothed_mtm`. The duplicate-date residual in the fix report cannot occur. With a marker and no usable series, `applyHeadlineBasis` still redacts the cash object on the marker, which is the fail-safe state.

### R2-WR-01: WR-01 is closed only for the Deribit marks read; a raw ccxt network error, or the degraded-set divergence, in the smoothed pass still sinks the cash composite on the last attempt (MEDIUM, user-facing)

**File:** `analytics-service/services/job_worker.py`. The new `except DeribitTransientReadError` arm is at about `:15009`. The degraded-set divergence `return DispatchResult(... error_kind="transient")` is right after `smoothed_member_metas = list(_sm_metas)`. In `_reconstruct_all`, the ccxt member arm ends `except Exception: if is_geo_blocked(exc): ...; raise`.

**Issue:** WR-01's criterion is that the additive smoothed pass must not fail a healthy cash composite on the last attempt. The fix catches only `DeribitTransientReadError` and a returned transient `DispatchResult`. The smoothed `_reconstruct_all` re-crawls **every** member, ccxt members included (the divergence check exists because it does). Two exits are still open:

1. **A raw `ccxt.NetworkError` from a ccxt member's re-crawl.** `fetch_ccxt_transfers` (`services/ccxt_flow_fetch.py`, WR-04 comment) deliberately lets every non-`NotSupported` exception bubble, network failures included. In `_reconstruct_all`'s ccxt arm, a `RequestTimeout` or `ExchangeNotAvailable` is not `RateLimitExceeded`, not structural and not geo-blocked, so it hits the bare `raise`. It escapes the smoothed call site, because no arm there catches it, and `classify_exception` files it `transient`. On attempt 3/3 that is `failed_final`, and branch (b) of the bridge then writes `failed` on an unprotected row. The Deribit side is covered: its ledger, chart and account-state reads wrap network errors into `DeribitTransientReadError` or a DQ flag.
2. **The degraded-member-set divergence.** It still returns `error_kind="transient"` on every attempt, the last one included. It is a live-read race (a ccxt member degrades in one pass and not the other), so it is rare. Round 1, though, counted its rarest exit inside the MEDIUM.

**Population:** option-active composites (P1) that also have a binance, okx or bybit member. I did not measure how many exist on PROD. Exit 1 is reachable by code for any such composite. If none exists today, this is latent until one is created.

**Fix (minimal, mirrors the existing arm):**
```python
# at the smoothed call site, widen the WR-01 arm to the ccxt transient class
except (DeribitTransientReadError, ccxt.NetworkError) as _sm_exc:
    if not _smoothed_final_attempt:
        raise
    smoothed_result = None
    logger.warning(...)  # same scrubbed text
...
# the divergence check: degrade on the last attempt instead of returning
if _sm_degraded_seqs != {int(d["seq"]) for d in degraded_members}:
    if not _smoothed_final_attempt:
        return DispatchResult(...)  # unchanged
    smoothed_member_metas = []   # drop the metas the MED-01 union would read
    logger.warning(...)
    # skip the derive: leave smoothed_metrics_json None (P2 fails, no promotion)
```
`ccxt.RateLimitExceeded` is a `NetworkError` subclass, but `_reconstruct_all` already turns it into a transient `DispatchResult`, so it never reaches the widened arm. Add one parametrised case to `test_g252_smoothed_transient_on_the_last_attempt_ships_the_cash_composite` with a ccxt member whose smoothed crawl raises `ccxt.RequestTimeout`, plus one for the divergence.

### Round-2 LOW / Info (recorded here only, not fixed, not booked)

- **R2-IN-01:** the WR-02 report fires before the persist. If the headline upsert then fails and the job retries, the next attempt reports again, and on a failed final attempt the "withdrawn" report describes a row that still holds the promoted headline. That is noise, not loss.
- **R2-IN-02:** on a final-attempt degrade of a promoted row, WR-02 reports the cause `smoothed_basis_not_computed`. That does not tell a transient degrade apart from a structural one. The WARNING line just before it does.

### Whole-phase verdict (`33d4cf863..HEAD`, MEDIUM+ only)

**One MEDIUM open: R2-WR-01.** I found no CRITICAL or HIGH. WR-02 and SFH-MEDIUM-1 are closed. Round 1 found no other MEDIUM+ in the phase diff, and the fix diff introduces none beyond R2-WR-01, which is a gap left by the WR-01 fix, not a regression it caused: before the fix, these exits failed on every attempt.

_Round 2 reviewed: 2026-11-28 · Reviewer: Claude (gsd-code-reviewer) · Depth: deep (fix diff), round-1 reliance for the rest of the phase diff_

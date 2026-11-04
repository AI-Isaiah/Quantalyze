---
phase: 190-factsheetqueued
reviewed: 2026-11-03T20:06:43Z
depth: deep
files_reviewed: 24
files_reviewed_list:
  - src/lib/finalize-rerun.ts
  - src/app/api/strategies/finalize-wizard/route.ts
  - src/lib/stored-analytics-result.ts
  - src/lib/closed-sets.ts
  - src/lib/compute-state.ts
  - src/lib/strategyGate.ts
  - src/app/api/admin/strategy-review/route.ts
  - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/lib/factsheet/build-payload.ts
  - src/lib/factsheet/types.ts
  - src/lib/factsheet/composite-read-path.ts
  - src/lib/factsheet/headline-basis.ts
  - src/lib/factsheet/v2-joint.ts
  - src/app/factsheet/[id]/v2/page.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/lib/status-surface-copy.ts
  - src/lib/queries.ts
  - src/lib/types.ts
  - src/components/strategy/StrategyTable.tsx
  - src/app/(dashboard)/compare/page.tsx
  - src/components/strategy/CompareEquityOverlay.tsx
  - analytics-service/services/job_worker.py
  - CHANGELOG.md / VERSION / package.json (release metadata, read only)
findings:
  critical: 2
  warning: 2
  info: 0
  total: 4
status: issues_found
---

# Phase 190: Code Review Report

**Reviewed:** 2026-11-03T20:06:43Z
**Depth:** deep (call chains traced into the analytics-service writers, the SQL member RPC and the compute-job dedupe)
**Files Reviewed:** 24 (code diff `git merge-base origin/main HEAD` = `1490ece41` ... HEAD, `.planning` excluded; test files read only for intent)
**Status:** issues_found

## Summary

The phase's two halves are mostly sound: `decideFinalizeRerun` fails toward enqueue on every read error, the gate change only rescues `pending`/`computing` rows that pass the three-part evidence rule, a `failed` row is never admitted, the snapshot is bound by `computed_at` and fails closed, the cache key moved to v20, and `/compare` dropping the service-role client narrows privilege (the new aliases are scalars and are deleted before any client component sees them; no leak found).

Two blockers remain, both on composites, and both in the two areas the brief asked about:

1. A composite factsheet admitted as "updating" draws its curve from `csv_daily_returns`, which the in-flight stitch rewrites before it writes the headline. The page then shows a new run's curve under the last run's headline and date, with the D-06 line saying all figures are from the last completed computation.
2. The finalize skip rule compares member `created_at` with `computed_at`. That cannot see a member change made while a stitch was already running. The pre-phase unconditional finalize stitch was what repaired that race, and it is now skipped.

Two MEDIUMs: on single-key rows the MTM and smoothed toggles (and the cash day-basis echo) read the in-flight derive's generation during the updating window. Separately, the `asset_class` "changed" signal exists only inside one request, so a retry after a failed first finalize drops a needed annualization re-run.

Not findings, noted for the record:
- The new comment at `finalize-wizard/route.ts:2258` (and the existing one at `:2412`) calls `cron/reconcile-strategies` a backstop that re-enqueues rows stuck at `pending`. That cron enqueues `reconcile_strategy` fills checks only. It never re-enqueues analytics. No new code path depends on it: every skip arm either has a live job or a terminal-success row. But the "a needed run is never dropped" argument should not cite it.
- The unified (manager single-key) arm still sends `onboard` to `process_key_long` unconditionally. RESEARCH Open Question 3 kept this out of scope on purpose, and plan 08 hands it to the founder. It is not re-raised here.

## Critical Issues

### CR-01: A composite in a re-stitch shows the in-flight stitch's curve under the last success's headline and date (user-facing, data integrity)

**File:** `src/lib/factsheet/fetch-and-build-payload.ts:409-422` (admission) and `:488-523` (composite branch); `src/lib/factsheet/composite-read-path.ts:373` and `:437-440`; writer at `analytics-service/services/job_worker.py:12526-12620`

**Issue:** Phase 190 now admits a `computing`/`pending` composite whose `strategy_analytics` row stores a success result (`hasStoredAnalyticsResult`: the composite stores `returns_series`, a finite `cumulative_return` and `merged_flags` with the marker). The checks behind that admission all read the `strategy_analytics` row. The composite factsheet, however, does not build its curve from that row. `readCompositeFactsheet` reads the series from `csv_daily_returns` (`composite-read-path.ts:373`). It reads the MTM and smoothed series from `strategy_analytics_series` and the day basis from the `cash_settlement` series echo (`:437-440`), with no status gate of its own. `run_stitch_composite_job` step 7 upserts and reconciles `csv_daily_returns` (`job_worker.py:12526-12620`), and persists the basis series, before the one `strategy_analytics` headline upsert.

Failure scenario: a published composite is re-stitched, for example by a member add or a ledger refresh. The bridge sets `computing` when the job starts. After step 7 and before the headline upsert, the factsheet builds the new member set's equity, drawdown, monthly and rolling panels. Next to them it shows the previous run's `cash_settlement` headline (CAGR, Sharpe, cumulative), the previous `computed_at` and the line "These figures are from the last completed computation." The window is normally seconds. If the worker dies or errors between step 7 and the upsert, the bridge keeps `computing` through `failed_retry` and the window lasts the whole retry backoff. The mixed payload is cached under `(computedAt, …, "computing")` for that time. Before this phase that state was withheld. This is exactly the "old numbers mixed with new" outcome D-04 rejected.

**Fix:** Fail closed for composites until the curve source is part of the stored row. The minimal fix is in the resolve stage, after `isComposite` is known:
```ts
// Phase 190: a composite's curve, MTM/smoothed series and conventions live outside
// strategy_analytics and are rewritten by the in-flight stitch before its headline
// write, so a recompute over a stored result cannot be shown honestly.
if (isComposite && analyticsUpdating) {
  return notBuildable("not_computed");
}
```
The alternative is to build an updating composite from the row's own stored `returns_series`, not `csv_daily_returns`, and with the MTM and smoothed toggles closed. Add a test that seeds a `computing` composite whose `csv_daily_returns` differs from `returns_series` and asserts the build is withheld (or uses `returns_series`).

### CR-02: The finalize skip drops the re-stitch needed after a member change made while a stitch was running (data integrity)

**File:** `src/lib/finalize-rerun.ts:115-151` (rule at `:148`); interacting with `supabase/schema/baseline.sql:10413-10419` (`set_wizard_composite_members`), `analytics-service/services/job_worker.py:10660` (the stitch reads `strategy_keys` at job start) and `src/app/api/keys/sync/route.ts:357-362` (the stitch enqueue dedupes onto the in-flight job)

**Issue:** The composite arm skips when `max(strategy_keys.created_at) <= strategy_analytics.computed_at`. `computed_at` is stamped when the stitch WRITES its result, not when it READ its inputs. The stitch reads the member set near its start (`job_worker.py:10660`).

Failure scenario, all inside one wizard session:
1. The user's first stitch is running.
2. The user goes back and changes the members. `set_wizard_composite_members` rewrites `strategy_keys`, so every `created_at` becomes t1. It does NOT invalidate the row, because it only resets `complete`/`complete_with_warnings` rows and this one is `computing`.
3. SyncPreviewStep calls `keys/sync`. Its `stitch_composite` enqueue dedupes onto the running job, so no new job is created.
4. The old job finishes at t2 > t1 with the OLD member set and stamps `computed_at = t2`.
5. At finalize, `decideFinalizeRerun` sees a terminal success with every member older than `computed_at` and returns `already_current`.

The strategy is submitted for review, and can be approved and published, with analytics stitched from a member set it no longer has. Nothing re-stitches it. Before this phase, the finalize step's unconditional `stitch_composite` was the run that fixed it. (The docblock's "KNOWN LIMIT: a REMOVED member … is not detected" is also inaccurate for composites. The RPC rewrites every row, so a removal does move `created_at`. The real gap is the race above.)

**Fix:** Bind currency to the producing run's start, not its finish. For example, read the latest `done` `stitch_composite` job for the strategy, and skip only when its `created_at` (or `started_at`, if available) is after the newest member `created_at`:
```ts
const { data: lastStitch, error } = await admin
  .from("compute_jobs")
  .select("created_at")
  .eq("strategy_id", strategyId)
  .eq("kind", "stitch_composite")
  .eq("status", "done")
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (error) return { enqueue: true, reason: "read_failed", failedRead: "compute_jobs", error };
const producedFrom = Date.parse(lastStitch?.created_at ?? "");
if (!Number.isFinite(producedFrom) || inputAt === null || inputAt >= producedFrom) {
  return { enqueue: true, reason: "inputs_changed" };
}
```
A missing done-job row (retention) must queue. A member-signature echo written by the stitch into flags and compared with the current members would be stronger still. Add a test with a member `created_at` between the job's `created_at` and `computed_at` that asserts the run is queued.

## Warnings

### WR-01: Single-key "updating" factsheets read the in-flight derive's MTM/smoothed generation and day basis next to the last success's figures (user-facing, data integrity)

**File:** `src/lib/factsheet/fetch-and-build-payload.ts:624-659` (`basisDqf`, `recomputeOverStoredResult: analyticsUpdating`); `src/lib/factsheet/composite-read-path.ts:764`, `:1277`, `:1303`; writer order at `analytics-service/services/job_worker.py:9703` / `:9786` / `:9816` (series persisted), then `:9933` (prestamp)

**Issue:** Plan 05 deliberately opens the MTM and smoothed gates during a recompute and pairs them with the LIVE `metrics_json_by_basis` and `mtm_gated_reason`. The derive hop writes those before the compute hop, so during the whole `pending`/`computing` window they belong to the in-flight run, not the last completed one. There is also a sub-window between `persist_basis_series` (`:9703`/`:9816`) and the prestamp (`:9933`). The snapshot read with `db_read_with_retry` sits in that sub-window, and so does any failure that triggers `failed_retry`. There, the MTM series rows are already new while `metrics_json_by_basis` is still the old success's, so the MTM toggle draws the new series under old MTM scalars. `readCashConventions` (`:624`) likewise reads the `cash_settlement` echo the derive just rewrote, and its `day_basis` wins over the config (`resolveMetricsConventions`). If `returns_denominator_config` changed, which is a reason for the re-run, the old stored series is annualized and windowed on the new day basis.

Failure scenario: an options strategy is mid re-run. The viewer switches to Mark-to-market and sees numbers the D-06 line says are "from the last completed computation", which they are not. If the compute hop then fails, those MTM numbers were never part of any completed computation. Pre-phase, `computing` withheld the page entirely.

**Fix:** While `analyticsUpdating` is true, close the MTM and smoothed toggles. Pass `recomputeOverStoredResult: false` to `shouldReadSingleKey*Series` and to `singleKeyBasisOpts`' `done`, but keep it for `storedCashHeadlineGate`, so only the cash headline from the row is readable. Also skip the conventions echo and use the config tier, or the snapshot's flags. This keeps the "updating" page to the one generation the row stores.

### WR-02: The `asset_class` change signal exists only inside one request, so a retry after a failed first finalize skips a needed annualization re-run (data integrity)

**File:** `src/app/api/strategies/finalize-wizard/route.ts:1320-1373` (computed only when THIS request's write changes the value), early exits after the write at `:1400` (single-key scope probe) and `:1705` (member probes), plus the RPC refusals inside `runLegacyFinalize`

**Issue:** `assetClassChanged` is `strategyRow.asset_class !== assetClassToWrite`, read and written in the same request. The `asset_class` UPDATE commits before the scope-broadening probes and before the finalize RPC. If either rejects (a key with broadened scope, a transient 500, a 409), the request returns with the new `asset_class` persisted and no enqueue. On the user's retry, the draft already holds the new value, so `assetClassChanged === false`. `decideFinalizeRerun` then sees a terminal success with an older key and answers `already_current`. The stored analytics stay annualized on the old clock (√252 vs √365, about ×1.203 on Sharpe) under the new `asset_class`. Reachability is narrow, because `keys/sync` and `create-with-key` usually pre-stamp the same value, but this is exactly a needed run that the new rule drops.

**Fix:** Compare against what the stored result was computed under, not against the pre-request column. Either read the annualization the runner echoes into the row (for example, `periods_per_year` in the stored conventions or metrics) and queue when it disagrees with the current `asset_class`, or move the `assetClassChanged` determination into `decideFinalizeRerun` so it re-reads `strategies.asset_class` and the stored echo. A request-local flag cannot survive a retry.

---

_Reviewed: 2026-11-03T20:06:43Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

---

## Round 2

**Reviewed:** 2026-11-03 (round 2, after fix commits `e57fb7e24`, `4b22df685`, `96ebfbcee`, `fec11b291`)
**Depth:** deep. Each fix was traced into its writer and readers: the stitch's return points and job statuses, the `_KIND_BY_BASIS` mapping and the `persist_basis_series` payload shape, `analytics_runner`'s cash-series write, `db_read_with_retry` and `classify_exception`, `set_wizard_composite_members`, and `mtmDisabledReasonCopy`.
**Scope:** the four fix commits plus the code they call. MEDIUM+ only.
**Round-2 findings:** critical 0, warning 1 (WR-03, introduced by the WR-01 fix), total 1. **Status:** issues_found.

### Verdicts on the round-1 findings and SFH MEDIUM-1

| Finding | Verdict | Basis |
|---|---|---|
| CR-01 | **Fixed** | `fetch-and-build-payload.ts:494-496` returns `notBuildable("not_computed")` for `isComposite && analyticsUpdating` before any composite read. No `csv_daily_returns`, series or echo read can run for an updating composite. `v2-joint.ts` already withholds composites (`needs_builder`). Test at `fetch-and-build-payload.test.ts:1378` covers both lanes. |
| CR-02 | **Fixed, no regression found** | See judgment (2) below. |
| WR-01 | **Fixed for what it targeted, with one regression** | The MTM and smoothed series reads, scalars and series are closed while updating, and the echo is not read. The closed gates now show false "unavailable" copy (WR-03 below). |
| WR-02 | **Fixed** | See judgment (3) below. |
| SFH MEDIUM-1 | **Fixed, and re-raising is the right behaviour** | See judgment (1) below. |

### Judgment (1): `fec11b291`, re-raise on a failed `_read_last_success_row`

The re-raise is correct. Keep it.

- **What fails the job.** `_last_success_snapshot` (`job_worker.py:3412`) only runs `isinstance` checks and cannot raise. postgrest 2.x `maybe_single()` returns `None` for a missing row (the marker read at `:3591` relies on the same fact), so a strategy with no analytics row gets `None` and is not an error. The only things that can fail the job are a database or transport error, and a 504 or ReadTimeout is retried in place first (`db_read_with_retry`, 3 attempts).
- **What a failure costs.** The `try` sits at function top level (`:9905`), not inside a handler that stamps. The exception goes to `dispatch`. `classify_exception` files a postgrest or httpx error as `unknown` (retried), and the queue retries up to `max_attempts` (default 3). During `failed_retry` the bridge keeps `computing`. Because the prestamp was not written, the row's flags are still the last success's (marker present), so the factsheet stays admitted as "updating" on the last success, and since WR-01 it shows the cash headline only. A refresh-marked derive on a published strategy takes the D-15 error-only path, so its status does not flip at all.
- **Why the residual risk is accepted.** To flip a strategy to `failed`, this one read would have to fail on all three queue attempts while the prestamp upsert to the same table, the line after it (`:9936`), keeps succeeding. That needs a failure specific to this read, and no such failure exists: the read uses the service role, a single row by primary key, and two columns. A sustained database fault would fail the prestamp upsert, and the series persists before it, in exactly the same way. So the re-raise makes the job no more likely to fail than it already was.
- **The old behaviour was worse.** A null snapshot on a retry destroyed the snapshot the first attempt had carried. A systematic read bug would also have put every re-run back on the hidden-factsheet behaviour without anyone seeing it. Failing loud and retrying puts that failure in the open.
- **Cost, not a defect.** Each retry re-crawls the venue, because the read runs after the crawl and after the three series persists (`:9707`, `:9783`, `:9816`). Moving the read above the crawl would make a failed read cheap. That is an optimisation, so it is not filed.

### Judgment (2): `4b22df685`, the composite rule (newest member `created_at` < latest `done` `stitch_composite` `created_at`)

- **Can it skip a needed run?** No path found. Every non-success exit of `run_stitch_composite_job` returns `DispatchOutcome.FAILED` (the 22 returns between `:10674` and `:12468`). The only `DONE` is the success exit at `:13134`, which comes after the headline write. `stitch_composite` is chain-terminal (`JOB_CHAIN_FOLLOW_ON["stitch_composite"] = ()`), so it ends at `done`, never at `done_pending_children`. The dedupe keeps two stitches from overlapping. So the latest `done` stitch is the run that produced the stored result. `created_at` is enqueue time, which is no later than the member read at claim time and on any retry, so the bound is conservative. Both timestamps come from the database clock. The members RPC and the stitch enqueue are separate requests (`set_wizard_composite_members` enqueues nothing; `keys/sync` enqueues without writing members), so the `>=` equality arm cannot fire on every run.
- **Can it loop re-runs?** No. The decision runs once per finalize request, and nothing it enqueues writes `strategy_keys`. The conservative arms (job row purged by retention, a member re-written after the job was enqueued while that job was still pending) each cost one redundant stitch. That is the same direction as a failed read. One case already existed under the round-1 rule: `set_wizard_composite_members` deletes and re-inserts every row even when the signature is identical, so a same-member re-Continue after the stitch moves `created_at` and finalize queues one redundant stitch. The CR-02 fix neither causes this nor makes it worse.
- **Does single-key need the same fix?** No. The CR-02 race needs an input that can change while a run that already read it is still in flight. On a single-key draft, the only input the rule tracks is `strategies.api_key_id`. It is set once by `create-with-key`, and no app route re-links it (`grep` for an `api_key_id` update under `src/app/api` finds none). The single-key analogue that remains is an `asset_class` change during a running chain. WR-02's echo comparison closes it independently of timing, because `analytics_runner` writes the echo at `:2440`, in the same step as the success write it describes. The fixer's docblock reasoning holds.

### Judgment (3): `96ebfbcee`, the stored `cash_settlement` `periods_per_year` read

- **Shape.** `strategy_analytics_series.payload` is `jsonb NOT NULL`, and the primary key is `(strategy_id, kind)`, so `.maybeSingle()` cannot see two rows. `persist_basis_series` writes `payload.conventions.periods_per_year` as a Python `int`, which reads in JS as `number`. `KIND_CASH_SETTLEMENT == "cash_settlement"` matches the `.eq("kind", …)`. `select("conventions:payload->conventions")` is valid PostgREST alias and JSON-path syntax.
- **Missing or wrong type.** No row, `conventions` null, a non-number, a non-finite value or a read error all queue (`finalize-rerun.ts:213-215` and the `read_failed` arms). That is the safe direction.
- **Agreement of the two sides.** Python `periods_per_year_for_asset_class` (`metrics.py:50`) and TS `annualizationPeriods` (`closed-sets.ts:616`) are the same rule: `crypto` gives 365, anything else 252. The single-key echo comes from `analytics_runner` (`:2114`, `strategies.asset_class`). The composite echo comes from the stitch (`:12022`, also `strategies.asset_class`, not the member blend; F-1 refuses a disagreement). Neither path can disagree with the column at rest.
- **Residual cost, not a defect.** A terminal-success row has no cash echo only if a heal-delete ran without a later success. Such a row queues a redundant run on every finalize. That is the safe direction.

## Round 2 Warnings

### WR-03: While a single-key re-run is in flight, the closed MTM and smoothed toggles say the basis is unavailable for the strategy, or name the in-flight run's degrade reason (user-facing; introduced by `e57fb7e24`)

**File:** `src/lib/factsheet/composite-read-path.ts:916-937` (`readSingleKeyBasisOpts`: gates closed, but `singleKeyBasisOpts` is still called and still builds `mtmGate`/`smoothedGate`); `src/lib/factsheet/fetch-and-build-payload.ts:638-653` (`basisDqf` still threads the LIVE `mtm_gated_reason`, and its comment says the gates "read that generation together", which is no longer true); copy at `src/app/factsheet/[id]/v2/basis-context.tsx:859-900` and `:921-928`; toggle at `src/app/factsheet/[id]/v2/FactsheetView.tsx:2597-2609`

**Issue:** The WR-01 fix closes the gates by calling `singleKeyBasisOpts` without `recomputeOverStoredResult`, so `done` is false for a `pending`/`computing` row. The function still builds the gates whenever the row has any by-basis signal, so `payload.mtmGate` is non-null and FactsheetView renders the basis control as disabled with a reason:
- If the in-flight derive's `mtm_gated_reason` is absent, the reason is `undefined`. The copy reads "Mark-to-market unavailable for this strategy." in the muted, steady tone. The smoothed toggle reads "Smoothed mark-to-market unavailable: this basis has not been computed for this strategy."
- If the in-flight derive degraded, `basisDqf` passes its LIVE reason (for example `mtm_summary_coverage_incomplete`). The page then states a degrade that belongs to a run the page explicitly says it is not showing.

Failure scenario: an options strategy whose last completed run has MTM and smoothed MTM available is re-synced. For the whole derive-to-success window, which lasts through every `failed_retry` backoff, an allocator on the factsheet sees, next to the D-06 "figures are from the last completed computation" line, a statement that mark-to-market is unavailable for this strategy and that smoothed MTM "has not been computed for this strategy". Neither is true of the strategy or of the completed computation the page shows. Before this phase the page was withheld. Under round 1 the toggles were open on the wrong generation. The fix traded mixed figures for a false fact, which is the smaller harm, but the statement is still false and visible to users.

**Fix:** While updating, do not build the basis gates at all. With no gates, `mtmGate` is undefined, `mtmToggleAvailable` is false and the control does not render, so nothing about MTM is claimed. The cash headline gate is unaffected.
```ts
// composite-read-path.ts, readSingleKeyBasisOpts
const [mtmSeries, smoothedSeries] = recompute
  ? [null, null]
  : await Promise.all([ /* the two gated reads, unchanged */ ]);
const basisOpts = recompute
  ? {}
  : singleKeyBasisOpts(dqf, metricsJsonByBasis, computationStatus, mtmSeries, smoothedSeries);
```
Then drop the live-reason splice in `fetch-and-build-payload.ts:648-653`, because nothing consumes a basis reason while updating, and correct the comment above it. Add a test: a `computing` options row whose stored `metrics_json_by_basis` carries `mark_to_market` and `smoothed_mtm` yields a payload with no `mtmGate` and no `smoothedGate`.

### Noted, below MEDIUM (not filed)

- The `recomputeOverStoredResult` parameters on `singleKeyBasisOpts`, `shouldReadSingleKeyMtmSeries` and `shouldReadSingleKeySmoothedSeries` (`composite-read-path.ts:730`, `:1279`, `:1305`) now have no production caller that passes `true`. Only tests exercise them.
- WR-01's day-basis half: with the echo skipped, an updating single-key row resolves `dayBasis` from the live `returns_denominator_config`. That is the same value the in-flight derive wrote into the echo, so the fix does not change the outcome when the config was edited before the re-run. No app route writes `returns_denominator_config` (operator-only), so this was not filed. The real fix would be to carry the last success's day basis in its flags (the snapshot already carries `cumulative_method`).

_Round 2 reviewed: 2026-11-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

---

## Round 3

**Reviewed:** 2026-11-03 (round 3, final, after fix commits `83d6ac84a`, `365a2513f`, `077997930`; diff `fec11b291..077997930`)
**Depth:** deep. Traced the moved snapshot read against every write between it and the prestamp, `effectiveDataQualityFlags` for the new `basisInFlight` switch, every caller of `conventionsDegraded`, the SC-4 INERT-read guard and every production reader of the `cash_settlement` series row, and the daily `cron-sync` derive fan-out.
**Tests run at `077997930`:** the four affected vitest files (437 passed), `test_derive_last_success_snapshot.py` plus `test_no_reader_consumes_cash_settlement_series_row` (29 passed).
**Round-3 findings:** critical 0, warning 1 (WR-04), total 1. **Status:** issues_found.

### Verdicts

| Finding | Verdict | Basis |
|---|---|---|
| CR-01 | Not regressed | `fetch-and-build-payload.ts:494` still withholds an updating composite before any composite read. |
| CR-02 | Not regressed | The composite rule (`finalize-rerun.ts:137-190`) is untouched. The only change in that arm is the removed series read. |
| WR-01 | Not regressed, tightened | While updating, no MTM or smoothed series is read and no gate is built. |
| WR-03 | **Fixed** | `composite-read-path.ts:378-391`: with `basisInFlight`, both series reads are skipped and `basisOpts` is `{}`. So `mtmGate` and `smoothedGate` are undefined, the control does not render, and nothing false is claimed. The live-reason splice is gone. |
| SFH M1 | **Fixed** | The read now sits above all three `persist_basis_series` calls. No `return` falls between it and the prestamp. `csv_daily_returns` is still rewritten before the read (`job_worker.py:9307`), but the single-key curve is built from the row's `daily_returns`/`returns_series`, never from that table, and an updating composite is withheld (CR-01). Not user-visible. |
| SFH M2 | **Fixed** | `conventionsDegraded` is now also true when updating. Its only consumer is the public cached callback (`v2/page.tsx:194`), which renders the payload uncached. No other effect. |
| SFH M3 | **Fixed for MTM and smoothed** | `basisInFlight: effectiveFlags.source === "snapshot"` closes both gates for a held terminal-success row. The conventions echo is still read on that row (`analyticsUpdating` is false). Round 2 filed this config-only residual as below MEDIUM, and it is not re-raised. |
| WR-02 regression (SC-4 guard) | **Guard green, but the WR-02 fix was removed on a false premise** | See WR-04. |

## Round 3 Warnings

### WR-04: The asset_class retry gap is back, and the reason the docblock gives for keeping it is false. The `cash_settlement` row is not dark (data integrity)

**File:** `src/lib/finalize-rerun.ts:19-25` (the KNOWN LIMIT docblock) and `:191-194` (the skip that no longer checks the clock). Production readers of the same row: `src/lib/factsheet/composite-read-path.ts:1059-1069` (`readCashConventions`, called from `fetch-and-build-payload.ts:635`) and `:676-684` (`readHeadlineCoversFrom`, called from the factsheet and `/compare`). Guard: `analytics-service/tests/test_cash_basis_series_sc4.py:686`.

**Issue:** `83d6ac84a` removed the stored-annualization check because it read a "DARK row with no reader until its own phase", and wrote that the retry signal cannot be recovered. That is not true. Phase 169.1 and Phase 164.6.6.3.3 shipped two production readers of `strategy_analytics_series` kind `cash_settlement`, both on `origin/main`. They pass the SC-4 scan only because they spell the kind as `CASH_SETTLEMENT_SERIES_KIND`, and the scan looks for the literal `cash_settlement` on the same line as `kind`. The round-2 fix went red because it wrote the literal, not because it read a row nobody else reads. The guard's own docstring says Phase 105/106 should delete it once a reader lands. Two readers have landed, so the guard is stale (rule 7: the guard and the code disagree, and the code is newer). `readCashConventions` returns exactly the `conventions` object the removed check needed. It is exported, and it maps `failed` to the same safe direction.

**Scenario:** a single-key draft whose stamped `asset_class` differs from the one the finalize derives from the attested venue (for example `traditional` on a crypto venue) already holds a terminal-success result computed on √252. The finalize writes `crypto`. Then the scope-broadening probe (`route.ts:1405`) or the finalize RPC rejects. On the retry, the draft holds `crypto`, so `assetClassChanged` is false, and `decideFinalizeRerun` returns `already_current`. The strategy goes to review, and can be published, with Sharpe and volatility annualized on the wrong clock (about ×1.203 apart). The page says these are the current figures. Before Phase 190, finalize always queued, so this is a phase regression.
- **Bounded for single-key with a healthy key:** `cron-sync` derives every eligible strategy daily (`routers/cron.py`, D-02 NAVMTM). The compute re-reads `strategies.asset_class` (`analytics_runner.py:2114`), so the wrong clock lasts up to one tick.
- **Not bounded when the key's fetch is degraded or the key is revoked or disconnected:** no derive is enqueued, and the wrong clock stays until a manual sync.
- **Composite path:** effectively unreachable, because a non-crypto composite draft makes the stitch refuse (F-1), so there is no terminal success to skip over.

Reachability is narrow (the draft stamp and the attested value must disagree), so this is a WARNING and not a BLOCKER. But it is a user-facing money-math figure, and the only stored source that can detect it is available.

**Fix:** Restore the round-1 comparison through the sanctioned reader, without a second literal:
```ts
// finalize-rerun.ts, terminal-success arm, before `already_current`
const cash = await readCashConventions(admin, strategyId);
if (cash.failed) return { enqueue: true, reason: "read_failed", failedRead: "strategy_analytics_series", error: cash.message };
const stored = cash.conventions?.periods_per_year;
if (typeof stored !== "number" || !Number.isFinite(stored)) return { enqueue: true, reason: "inputs_changed" };
if (stored !== annualizationPeriods(opts.assetClass)) return { enqueue: true, reason: "asset_class_changed" };
```
Re-thread `assetClass` from the route, and restore the three deleted `finalize-rerun.test.ts` cases and the route retry test. Then correct the docblock, which should say the row has readers. Also fix the guard as its own docstring asks: either retire it, or turn it into an allowlist that names `readCashConventions`, `readHeadlineCoversFrom` and `decideFinalizeRerun`. That way the scan stops being a lexical check the constant already slips past. Retiring a phase guard is the founder's call. Correcting the false docblock is not optional.

### Noted, below MEDIUM (not filed)

- SFH M3 residual: a held terminal-success row with a bound snapshot still reads the in-flight derive's conventions echo (`fetch-and-build-payload.ts:635`, gated on `analyticsUpdating` only). It differs from the last success's echo only when `returns_denominator_config` (operator-only) or `asset_class` changed. This is the same class round 2 left unfiled.

_Round 3 reviewed: 2026-11-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

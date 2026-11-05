---
phase: 186-derivegaps
reviewed: 2026-11-03T22:43:28Z
depth: deep
files_reviewed: 31
files_reviewed_list:
  - TODOS.md
  - analytics-service/services/allocator_equity_compose.py
  - analytics-service/services/allocator_equity_derive.py
  - analytics-service/services/bybit_unified_flows.py
  - analytics-service/services/exchange.py
  - analytics-service/services/funding_fetch.py
  - analytics-service/services/job_worker.py
  - analytics-service/tests/fixtures/derive_refusal_rows.json
  - analytics-service/tests/fixtures/writer_residual_resolution.json
  - analytics-service/tests/test_allocator_equity_failing_key_exit.py
  - analytics-service/tests/test_allocator_equity_realized_basis.py
  - analytics-service/tests/test_daily_pnl_read_verdict.py
  - analytics-service/tests/test_derive_allocator_equity_job.py
  - analytics-service/tests/test_derive_broker_dailies_dualmode.py
  - analytics-service/tests/test_derive_refusal_rows.py
  - analytics-service/tests/test_derivegaps_probe.py
  - analytics-service/tests/test_exchange_harness.py
  - analytics-service/tests/test_funding_fetch.py
  - analytics-service/tests/test_job_worker.py
  - analytics-service/tests/test_job_worker_flipretry.py
  - analytics-service/tests/test_nav_marks_compose_roundtrip.py
  - analytics-service/tests/test_nav_marks_derive_apply.py
  - analytics-service/tests/test_nav_marks_l4_read.py
  - analytics-service/tests/test_trade_pages.py
  - analytics-service/tests/test_writer_residual_parity.py
  - src/app/(dashboard)/allocations/AllocationDashboardV2.failing-key.test.tsx
  - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
  - src/lib/__tests__/derive-refusal-rows.test.ts
  - src/lib/__tests__/writer-residual-parity.test.ts
  - src/lib/queries.test.ts
  - src/lib/queries.ts
findings:
  critical: 0
  warning: 6
  info: 0
  total: 6
status: issues_found
---

# Phase 186: Code Review Report

## Fix PR review

**Reviewed:** 2026-11-03T22:43:28Z
**Depth:** deep
**Files Reviewed:** 31 (`git diff f10dde76b..053740008 -- . ':!.planning'`, branch `feat/186-derivegaps`, head `053740008`)
**Status:** issues_found

## Summary

Scope: the fix work, plans 05 to 13. I read it against D-01..D-10 in 186-CONTEXT.md, SC-1..SC-7 in the `### Phase 186` ROADMAP entry, and the 186-04 gate lines. The caller asked for MEDIUM and above only, so every finding below is a WARNING (MEDIUM). None is a BLOCKER.

What holds up:
- **Compose math (D-07).** The failing-key exit reuses `departed_end_by_key`, so the key's capital leaves the book as an outflow of its last level. The plan-07 and plan-11 oracles are hand-computed and independent of the compose.
- **Marker rows.** They are owner-only (RLS `allocator_equity_derived_owner_select`, `allocator_id = auth.uid()`). They carry a closed token and an identifier-regex class name only, and a clean key-mode derive clears them right after `_persist_key_inputs`.
- **Reader copy.** `FailingKeyExitNote`'s three sentences match the founder-approved templates verbatim.
- **Flows (D-02).** `fetch_bybit_unified_flows` REPLACES the on-chain Bybit reads, so the Bybit flows cannot be double-counted.
- **Contextvar drain.** The DQ buffer drain is correct on Python 3.12, because `asyncio.wait_for` runs the coroutine in the caller's task there.

The defects are in what a refusal leaves unnamed, and in sizing. Four keyed paths still write no marker, or write one the book never reads: a timeout, a re-raised funding or Unified-flow failure, and a shared-account member. On those paths a refused key is still carried flat or left unnamed, which is the behaviour D-05/D-07 replace. Separately, the strategy-mode refusal tells the user something its own stamp contradicts. On the sizing side, the only PROD Bybit key sits close to both the page cap and the read deadline, and either one becomes a permanent refusal.

Not raised: Gap 4 (no dedup change, consistent with the no-pairs gate), the composite member path (booked by the 186-04 `q-composite: book` gate), and the orphan marker rows left after a key is deleted. That last one is benign, because only counted key ids are read.

## Warnings

### WR-01: The strategy-mode refusal says "these numbers stay at the last complete read", and the stamp then blanks the numbers (user-facing)

**File:** `analytics-service/services/job_worker.py:4733-4737` (call), and `:5110-5121` (the stamp's loud path)
**Issue:** `_refuse_incomplete_read` stamps the founder sentence through `_stamp_strategy_analytics_failed(..., heal_series=False)`. The helper keeps the published numbers only on the marked `ledger-refresh` path (`job_source == "ledger-refresh"` and a terminal-success row whose marker is PRESENT). Every other strategy-mode derive takes the loud path. That path upserts `computation_status: "failed"`, `metrics_json_by_basis: None` and `data_quality_flags: {"csv_source": True}`. One such derive is the `sync_trades` follow-on (`:2665-2670`), which enqueues with no metadata source; that path is what a "Sync now" or the cron sync runs. `heal_series=False` keeps only the basis-series rows. Scenario: a published OKX strategy's realized read hits the cap or the deadline during a user-triggered sync. Its by-basis metrics and DQ flags are wiped and its status turns `failed`, while `computation_error` reads "...so these numbers stay at the last complete read." On a first-time wizard compute there were never any numbers to keep. In `strategyGate.ts:537-543` the sentence also gains the prefix "Analytics computation failed: " and ends in "read..".
**Fix:** For this refusal, write the error-only payload: `computation_error` plus provenance, leaving status, metrics and flags untouched whenever a terminal-success row exists, as the marked path already does. Keep the loud `failed` stamp only when no published row exists, and in that case use a sentence that does not promise retained numbers. That second sentence needs founder wording.

### WR-02: A key whose funding or Unified-flow read fails is marked, but no compose is enqueued, so the book never names it (single-key) or names it a day late (user-facing)

**File:** `analytics-service/services/job_worker.py:7825-7836` (`funding_fetch_error`), `:7917-7930` (`bybit_unified_flow_error`)
**Issue:** Both arms call `_record_read_incomplete` and re-raise. Unlike `_refuse_incomplete_read` (`:4718-4727`), they never call `_enqueue_allocator_compose`, and the names reach the readers only through the compose payload (`failing_key_exits`). `BybitUnifiedFlowReadError` is classified permanent, so it gets no retry and no later successful derive. Scenario: a single-Bybit-key allocator hits a reader refusal, such as a cursor that does not advance. The marker row is written, no compose ever runs, and the Overview keeps showing the stale curve as `ready` with no note. In a multi-key book, a sibling's compose that ran before this key's derive has already read the markers, so the name appears only after the next day's compose. D-05 says the key "is marked 'read incomplete' by name".
**Fix:** In both arms, after `_record_read_incomplete` and before `raise`, run the same best-effort enqueue `_refuse_incomplete_read` uses:
```python
if is_key_mode:
    await _record_read_incomplete(...)
    try:
        await db_execute(lambda: _enqueue_allocator_compose(ctx.supabase, allocator_id))
    except Exception as _enq_exc:  # noqa: BLE001
        logger.warning("...compose enqueue after a failed read failed (api_key %s, error=%s)",
                       api_key_id, type(_enq_exc).__name__)
raise
```
Do this only on the final attempt for a transient class if flicker matters. For the permanent class, do it unconditionally.

### WR-03: A funding or flow read that times out, or a derive that overruns its budget, leaves no marker, and the key is carried flat and unnamed (data-integrity, user-facing)

**File:** `analytics-service/services/job_worker.py:7823-7824` and `:7837-7852` (funding `TimeoutError` re-raised to a transient FAILED with no marker), `:7914-7915` (Unified read timeout, same)
**Issue:** SC-2 says "a truncated or failed realized or funding read refuses that key by name". The funding and flow timeouts deliberately skip the marker, and so does an overrun of the job's 900 s envelope (`_DERIVE_OUTER_BUDGET_S`). Once the transient retries are exhausted, the key has no `read_incomplete:` row and its `sync_status` is untouched. `sync_status` is the trade sync's field; a failed derive job does not move it. So the compose exit loop skips the key at `:16114` (`working_holder_predicate(...) and not _member_marked`), and the key is carried at r = 0 while the rest of the book moves. The curve stays trustworthy and nothing is named. That is the dilution D-07 retires. Scenario, using the 186-04 probe: the one PROD Bybit key (k16) spent 269 s on realized, 368 s on funding and about 42 s on flows, roughly 680 s of the 900 s envelope. On a day the venue is 30% slower, every attempt dies at the envelope, and that key silently freezes inside the book.
**Fix:** Record a `read_incomplete` marker with a new closed token, `funding_timeout` or `read_timeout` (add it to `READ_INCOMPLETE_TOKENS`), in the per-crawl `TimeoutError` arm (`:7837`), keyed on `is_key_mode`, and enqueue the compose. The next clean derive clears it as today. For an outer-envelope overrun, record the marker in the dispatcher's timeout path for `derive_broker_dailies` key-mode jobs.

### WR-04: A refused counted member of a shared account is neither exited nor named (data-integrity, user-facing)

**File:** `analytics-service/services/job_worker.py:16105-16108`
**Issue:** The exit loop that reads `marked_ids` runs only for groups with exactly one eligible member (`if len(_eligible_members) != 1: continue`). That guard was written for the failing-key token, which `shared_account_no_working_key` covered for shared groups. It does not cover a group whose counted member is WORKING but refused by name: `no_working_groups` stays 0, no degrade is raised, no exit is applied, and `failing_key_exit_by_key` gets no entry. Scenario: one exchange account under two logins (the founder's stated-intended shape). The counted key's OKX realized read hits the deadline, so a marker is written and nothing more. In the next compose that key's series ends a day early, and the book carries it flat at r = 0. The note stays silent and the curve reads trustworthy. The ROADMAP SC-1 gate booked only "the shared account with no working key", not this case.
**Fix:** Before the single-member guard, handle a marked counted member of a multi-member group. Either apply the same `departed_end_by_key` exit and name it `read_incomplete`, or, if exiting a shared account is not wanted, at least name it with `(read_incomplete, last_return_day)` so the reader says which key. Add a sc2 test with two eligible members and the counted one marked.

### WR-05: The Bybit page cap was kept at 50 with 12% headroom on the only PROD Bybit key, and one busy week then refuses that key every day for a year (data-integrity, user-facing)

**File:** `analytics-service/services/exchange.py:143` (`BYBIT_PNL_PAGE_CAP = 50`), `:146` (`BYBIT_CLOSED_PNL_LIMIT = 100`); job_worker `:7778` (truncation is `permanent`)
**Issue:** The 186-04 record for k16 shows `bybit_pages_max_in_window: 44` at 100 rows a page, so about 4,400 closes in its busiest 7-day window against a ceiling of 5,000. The gate kept the cap because nothing had been truncated yet. D-06, however, says "raise the caps so a normal key reads its full history". The Bybit realized read is a rolling 365-day walk (`since_ms=None`). Scenario: k16 has one week with more than 5,000 closes. From the next day, every derive sets `daily_pnl_truncated_bybit` and is refused permanently. That window stays inside the 365-day walk for a year, so for a year the key exits the book, or holds its last day, and its curve is frozen. A raise costs about 0.5 s a page (`bybit_max_s_per_page 0.498`), and only in a busy window.
**Fix:** Size the cap from the measurement with real headroom, for example `BYBIT_PNL_PAGE_CAP = 200` (20,000 rows a window, about 100 s worst case per window and only on busy weeks; the deadline still bounds the whole walk). Record the new value and its derivation in the 186-04 gate lineage. As an alternative, split a window that hits the cap into halves rather than refusing.

### WR-06: A deadline hit caused by a slow venue is classified permanent, so one slow morning drops the key for the whole day (user-facing)

**File:** `analytics-service/services/exchange.py:1593-1599`, `:1660-1666`, `:1970-1976` (the deadline stamps the same `daily_pnl_truncated_*` flag a cap hit sets); job_worker `:7776-7779`
**Issue:** The deadline flag is indistinguishable from a cap hit, so `_refuse_incomplete_read(..., permanent=True)` runs with no retry. A key-mode derive is next triggered only by the 05:30 fan-out. The budget was sized at 397 s, and k16's normal Bybit realized read took 269 s: a 32% margin, consumed by venue latency or ccxt throttling. Scenario: Bybit is about 1.5x slower one morning, k16 crosses 397 s, and it is refused permanently. It then exits the book named "came back incomplete" until the next day's derive, although a retry an hour later would have read it in full. A cap hit is deterministic; a deadline hit is not.
**Fix:** Record a distinct flag for the deadline, for example `daily_pnl_deadline_okx` / `daily_pnl_deadline_bybit`, and map it to a token in `READ_INCOMPLETE_TOKENS`. Refuse with `permanent=False` so the dispatcher retries within its attempt budget. Keep the cap flag permanent. Extend the verdict parity test to cover the new flag.

---

_Reviewed: 2026-11-03T22:43:28Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Fix PR review — round 2

**Reviewed:** 2026-11-04T04:54:54Z
**Depth:** deep
**Scope:** `git diff 2e59f8b34..7a83dd76e -- . ':!.planning'`, 9 fixer commits, 8 files (`services/exchange.py`, `services/job_worker.py`, `scripts/derivegaps_probe.py`, 5 test files)
**Status:** issues_found (1 HIGH, 5 MEDIUM). MEDIUM and above only, as the caller asked.
**Tests:** the 5 changed test files pass at head (`893 passed`). Every test drives the worker with mocks, so none of them runs the status bridge. That gap is behind R2-01.

### What holds

- **Token closed sets.** `read_deadline`, `read_malformed` and `read_timeout` are in `READ_INCOMPLETE_TOKENS` (`job_worker.py:3891-3893`), and the closed-set pin test was extended to match. No other closed set sees the token. The compose reads only the marker's `kind` prefix (`:15326`) and maps every marker to the reason `read_incomplete` (`:16233`, `:16358`). `readFailingKeyExits` (`src/lib/queries.ts:4370`) validates that reason (`sync_failing | read_incomplete`), not the token. No SQL CHECK and no TS fixture lists the tokens. No TS change is needed.
- **Compose math, D-05/D-07/D-08.** WR-04 reuses `departed_end_by_key` and the anchor at the last return day. The single-member path and the D-08 no-history drop are unchanged.
- **Dispatcher overrun (`_name_key_whose_derive_overran`, `:4049`).** It runs only when `api_key_id` is set, which is the handler's own `is_key_mode` test (`:4532`). It reads the owner from `api_keys.user_id` and never from the payload, returns on a missing row, and never raises. The classification still comes from `classify_exception`. The handler's last step is the marker clear plus the compose enqueue (`:9284-9297`), so an overrun that lands after a clean read is practically unreachable.
- **SFH-4.** The deadline is opt-in. Only the per-key derive passes it (`:7861-7865`), and the test pins the keyword.
- **Changed tests (item 3).** Each one follows from a finding:
  - verdict matrix 96 → 480, with derive-only flags added to the expectation: WR-06 and SFH-5.
  - deadline tests now pass `read_deadline_s` and assert the new flag: SFH-4 and WR-06.
  - Bybit cap tests read `BYBIT_PNL_PAGE_CAP` off the module: WR-05.
  - `test_a_unified_timeout_*` changed from "not marked" to `read_timeout`: WR-03. That reverses a plan-10 choice, not a founder decision.
  - strategy-mode refusal split into numbers and no-numbers cases: WR-01.

  None of them was loosened just to pass. The weak spot is the no-numbers case, which asserts only `!= approved sentence` and so pins nothing about what is written (R2-02).

### R2-01 (HIGH, user-facing, data-integrity): the WR-01 fix does not hold past the status bridge. The status still turns `failed`, and by-basis numbers now stay on a failed row

**File:** `analytics-service/services/job_worker.py:4812-4834`, `:5090`, `:5163`; `supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql:888` (bridge branch (b))
**Scenario:** A published OKX strategy, and the owner presses "Sync now". The `sync_trades` follow-on derive carries `metadata = NULL`, so it is unmarked, and its realized read hits the cap.
1. `_published_numbers_exist` is True, so the worker writes the error-only payload: status, metrics and flags untouched, the founder sentence, and writer provenance.
2. The refusal is permanent, so `mark_compute_job_failed` makes the job `failed_final` and runs the bridge.
3. The failure is unprotected: `is_protected` needs `metadata.source IN ('ledger-refresh', …)`. So branch (b) runs: `computation_status = 'failed'`. It keeps the writer's sentence, because the provenance matches the job id, and it leaves `metrics_json_by_basis` and `data_quality_flags` as they were.

The end state is the WR-01 contradiction again. The row is `failed`, which the bridge itself says "is NOT a published factsheet". The UI renders "Analytics computation failed: We could not read this account's full history from the exchange, so these numbers stay at the last complete read.." (`src/lib/strategyGate.ts:541`). The fix adds a regression on top: the loud path nulled `metrics_json_by_basis` "so a prior object can't render on a now-FAILED row" (F-4, `:5233-5236`), and that object now survives on a `failed` row. A transient refusal (`read_deadline`, fetch error) ends the same way at its last attempt. Only a marked `ledger-refresh` job reaches branch (b-prime) and keeps its status. That case already worked before the fix.
**Fix:** The status is decided in the bridge, so the protection has to reach the bridge. Pick one of these:
- (a) Make this refusal a protected failure in the bridge. That means a migration plus a founder call, because it widens D-15 beyond the marked refresh.
- (b) Accept `failed` for unmarked derives. Then take the loud path (metrics nulled, F-4 kept) with a sentence that promises nothing, worded by the founder.

Either way, add a SQL-corpus arm that runs the bridge over the resulting row. A mock of the worker's payload cannot show this.

### R2-02 (MEDIUM, user-facing): with no numbers, the stamp writes an empty sentence and that blocks the bridge's curated copy

**File:** `job_worker.py:4827-4834`; bridge `CASE` in the same migration (branch (b), `computation_error = CASE WHEN … source = 'writer' AND job_id = v_latest_job_id …`); `src/lib/strategyGate.ts:541`
**Scenario:** The first compute of a new OKX strategy hits the cap. The loud stamp writes `computation_error = ""` with `computation_error_source = 'writer'` and the job id. Branch (b) honours a writer sentence whose job id matches, so it keeps `""` instead of writing `computation_error_copy(error_kind)`. Every `strategyGate` surface then shows "Analytics computation failed." with no cause at all, where it used to show the per-kind curated line. The wizard is unaffected, because `GATE_ANALYTICS_FAILED` is static.
**Fix:** On the no-numbers path, write no writer sentence and no provenance (`computation_error: None`, markers absent), so the bridge's per-kind copy wins. As an alternative, get founder wording, as round 1 said. Pin the written value in the test.

### R2-03 (MEDIUM, data-integrity, user-facing): WR-04 removes a whole shared account from the book even when a working sibling login could still count it

**File:** `job_worker.py:15434` (the kept-member choice), `:16217-16229` (the WR-04 branch)
**Scenario:** One exchange account under two logins: H, the holder and counted member, and D, a duplicate. This is the founder's stated-intended shape. H's derive hits `read_deadline` or `read_timeout`, which are per-key and transient. D's derive the same morning reads fine and has returns up to today.
- The kept-member choice at `:15434` uses `working_holder_predicate` only. A marked H still passes it, so H stays counted and D stays in `excluded_shared`.
- WR-04 then exits H on its last good day. The account's capital leaves the book as an outflow on a day it moved nothing, although D carries the same account in full.
- D-18 says the account is "counted by a working sibling instead of by nobody".

The new test (`_wr04_shared_book`) stops both logins on day 3, so this case is never exercised. `marked_ids` is loaded at `:15326`, before the selection, so the fix is local.
**Fix:**
```python
working = [row for row in members
           if working_holder_predicate(row) and row["id"] not in marked_ids]
```
With that, D is counted (H's earlier days stitch in as they do today). Keep the WR-04 exit only for a group where no unmarked working member is left. Add the "D returns to today" test.

### R2-04 (MEDIUM, data-integrity, user-facing): one unparseable realized row now keeps a key out of the book every day for as long as the row stays in the walk, and nobody has counted how many PROD keys this hits on deploy

**File:** `services/exchange.py:1745`, `:1765`, `:1811`, `:2085`, `:2121`; `job_worker.py:3915-3917` (`read_malformed` is not in `_TRANSIENT_REFUSAL_TOKENS`, so it is permanent)
**Issue:** The retry class is right. The cause is the row's content, and a retry reads the same row. But the cause is deterministic, so the refusal recurs on every daily derive:
- **OKX:** the walk reaches back to inception through the archive, so one bill with a non-finite `pnl`/`fee` or a non-digit `ts` keeps the key out forever.
- **Bybit:** the same holds for 365 days.

The owner has no remedy. Before the fix, that row was dropped with a WARNING and the key published. The SC-1 gate `g1-malformed-rule: refuse malformed_rows=0` counted FUNDING rows only (`okx_funding_malformed`, `bybit_funding_malformed`). Realized rows dropped today were never counted. So the deploy may remove a live key from the book on its first derive, and nothing would have warned anyone.
**Fix:** Before deploy, count `daily_pnl_malformed_*` per key on PROD. The plan-14 probe rerun can read the flag. Then bring the founder the trade-off: one dropped row exits the key permanently, or the affected day is marked uncomputable (SC-6: "an uncomputable day is null") and the rest of the series publishes.

### R2-05 (MEDIUM, ops / worker time; the outcome for the user is unchanged): with the cap at 200, the 397 s deadline is what binds on Bybit, and a deadline hit caused by volume is retried for nothing

**File:** `services/exchange.py:148`, `:162`; `job_worker.py:3915-3917`
**Issue:** On k16, 269 s at 0.498 s a page is about 540 pages. The 397 s deadline is about 797 pages, so the whole 365-day walk has about 257 pages of headroom (about 25,700 closes). A single 200-page week fits. Two weeks of about 150 pages hit the deadline before any cap. That case is deterministic: the history is the same size on every retry. But WR-06 classifies every deadline hit as transient, so each day the key runs `max_attempts` = 3 attempts of about 400 s each on the sequential worker before the same named refusal, and it does so every day while those weeks sit in the window. That is the "refused every day for a year" case WR-05 aimed to retire, moved to a higher threshold, plus about 13 extra worker-minutes a day. The new 62-page test never reaches the deadline.
**Fix:** Treat the deadline as transient only when it is plausibly latency. For example, compare `realized_s_per_page` against the measured 0.498 s, or allow one retry for `read_deadline`. Record the page headroom of the 200/397 pair in the 186-04 gate lineage.

### R2-06 (MEDIUM, data-integrity): SFH-2 is fixed at only one of three marker sites. A permanent re-raise whose marker write failed is still unnamed and not retried

**File:** `job_worker.py:7939-7941` (`funding_fetch_error`), `:8030-8032` (`bybit_unified_flow_error`)
**Scenario:** A single-Bybit-key book. The Unified reader refuses with `BybitUnifiedFlowReadError`, which `classify_exception` keeps permanent, and the marker upsert fails at the same moment. `_name_refused_key` returns False, the return value is discarded, and the same exception is re-raised as permanent. The compose is enqueued but finds no marker, so the stale curve stays `ready` with no note until the next day's derive. That is SFH-2's exact failure, on the arms the fix did not touch. The same applies to any `funding_fetch_error` exception that classifies permanent.
**Fix:** In both arms, when `not marked`, return a transient `DispatchResult` (or raise a transient wrapper) instead of re-raising the permanent object, so the retry writes the marker. This mirrors `error_kind="permanent" if permanent and marked else "transient"` at `:4841`.

---

_Reviewed: 2026-11-04T04:54:54Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Fix PR review round 3

**Scope:** `git diff 5ae8975b1..HEAD -- . ':!.planning'` (10 commits: R2-01..R2-06, D-11, D-12). Depth: deep. MEDIUM and above only.

**Verdict per round-2 finding**
- **R2-01 / D-11: NOT CLOSED.** See R3-01 and R3-02. The migration is a byte-faithful re-base: the down body equals 20261023120000, and no later migration redefines the function. The ACL, SECURITY DEFINER and search_path checks hold. The forgery question is clean: `strategy_analytics` denies INSERT and UPDATE to non-service roles, the stitch_composite error-only writer is kind-excluded, and the runner's csv provenance is kind-excluded (P5). But the signal does not fire on the production row shape, and it is lost on the next refusal.
- **R2-02: closed.** `scrubbed or None` and `_failed_job_id`: `provenance_source(None)` returns None, so the pair is NULL together and the per-kind copy wins (P6).
- **R2-03: closed** for the case the finding named. `pool = working or working_all or members`. The marked member's earlier days stitch into the kept sibling.
- **R2-05: closed.** `attempts` is incremented at claim (`claim_compute_jobs*.sql`), so a value of 2 or more means a repeat.
- **R2-06: closed** at both remaining sites. The overrun path now logs at ERROR.
- **R2-04 / D-12: half done.** See R3-03.

### R3-01 (BLOCKER, user-facing and data-integrity): the D-11 protection does not fire on any ledger strategy in production. Every one has `metrics_json_by_basis` NULL, so the bounced row is still stamped `failed`

**File:** `analytics-service/services/job_worker.py:4817-4829` (`_published_numbers_exist`), `:5229-5247` (the loud stamp); `supabase/migrations/20261105120000_sync_status_protect_refused_derive.sql:356-363` (`v_kept_job_id`)
**Issue:** Both the worker and the bridge treat a `computing` row as "has figures" only when `metrics_json_by_basis IS NOT NULL`. The derive's prestamp writes SQL NULL there on every non-options path. `job_worker.py:10221-10226` says so: "perp-only / ccxt / key-mode / MTM-headline ... → None (SQL NULL)". The headline figures live in `metrics_json`.

PROD read-only, 2026-11-04, after the marker query named PRODUCTION: all 16 api-key strategies have `metrics_json_by_basis` NULL and `metrics_json` present:
- 13 read plain `complete`: okx 4, bybit 1, mt5 8.
- 3 read `complete_with_warnings` (mt5).

**Scenario:** An OKX strategy reads `complete`, and the owner presses Sync now.
1. `sync_trades` finishes, and branch (a) bounces the row to `computing`. The migration header itself says this is the usual case.
2. The derive refuses on `daily_pnl_truncated_okx`.
3. `_published_numbers_exist` reads `computing` with NULL by-basis and returns False.
4. The loud stamp writes `failed`, `computation_warned=false`, `data_quality_flags={"csv_source": true}` (wiping the real flags) and no sentence.
5. Branch (b) then writes `failed` with the per-kind copy.

The published factsheet goes dark. That is exactly what D-11 ("keeps its figures and its status") rules out. Only `complete_with_warnings` rows, which branch (a) does not bounce, and Deribit options rows are protected.

The P1..P9 fixtures all seed `metrics_json_by_basis` non-NULL, so they test a shape that production does not have.
**Fix:** Decide "has figures" from the headline in both places, for example `metrics_json IS NOT NULL` with a `complete`, `complete_with_warnings` or `computing` status. Better still, the worker should capture the publish status at entry, before the crawl, for every strategy-mode derive and not only marked ones, and decide on that. Add a P-arm with NULL by-basis and the headline present, and a Python test of `_published_numbers_exist` on that shape.

### R3-02 (BLOCKER, user-facing): the protection keys on the row's single provenance id, so the next refusal of the same history turns the first protected failure loud. Under the cron that happens within one sync cycle

**File:** `supabase/migrations/20261105120000_sync_status_protect_refused_derive.sql:466-468` (`f.id = v_kept_job_id`), `:556-563` (per-kind supersession is `done` only)
**Issue:** A protected refused derive (job1) stays a live failure until a later `derive_broker_dailies` reaches `done`. Its protection depends on the row's `computation_error_job_id` still naming job1. Two things move that column, and neither one supersedes job1:
- **(i)** The next refusal. A truncation refusal is permanent, and "the same history fails the same way". `sync_trades` always enqueues the derive follow-on (`JOB_CHAIN_FOLLOW_ON`, `job_worker.py:1014`), and `sync_trades` runs on a cron.
- **(ii)** Branch (a). It bounces the row while job2 is pending (the hold is released by an unmarked same-kind successor) and NULLs the sentence and markers.

**Scenario:**
1. Cycle 1 refuses: job1 is protected, and the row returns to `complete`. This is correct.
2. Cycle 2: `sync_trades` completes, derive job2 is pending, and branch (a) moves the row to `computing` and clears the provenance.
3. Job2 refuses and writes provenance naming job2.
4. In `mark_compute_job_failed`'s bridge call, job1 is non-superseded with `f.id <> v_kept_job_id` and no metadata, so it is unprotected. `v_failed_count = 1`, and branch (b) writes `failed` with the per-kind copy, because job1 is not the row's job.

So D-11 holds until the next cycle at the latest, for every strategy whose history fails deterministically. That is the population D-11 exists for. No arm covers a second refusal.
**Fix:** Make the protection a property of the failing JOB, not of the row's mutable provenance. At refusal, the worker records a durable per-job marker: a `compute_jobs.metadata` key written through a service RPC, kind-scoped exactly like the refresh marker. `is_protected` then reads `f.kind = 'derive_broker_dailies' AND f.metadata ? '<marker>'` together with a figures test on the row. The same change removes the W1 trade-off in R3-04. Add an arm with two consecutive refused derives (job1 failed_final, then job2 failed_final) asserting `complete`.

### R3-03 (MEDIUM, data-integrity): D-12 is not met. `daily_pnl_malformed_<venue>` is still only a log line, because the derive drains and discards it

**File:** `analytics-service/services/job_worker.py:7883` (`daily_pnl_read_verdict(get_and_clear_last_dq_flags())`); `services/exchange.py:197-214`
**Issue:** Confirmed. `_record_dq_flag("daily_pnl_malformed_*")` writes only into the process-local buffer (`exchange.py:1747/1767/1813/2087/2123`). The derive drains that buffer into the verdict, the verdict now ignores the key, and nothing else reads it. Grep shows no persistence site. The D-12 option text says "The dropped row is recorded as a data-quality flag rather than only a log line". The TODO `[186-REALIZED-MALFORMED-COUNT]` admits that "the derive ... does not persist the flag". So the second clause of the founder's decision is unbuilt, and the count the TODO books cannot be read from stored data either.
**Scenario:** An OKX key has one bill with a non-finite `pnl`. The row is dropped and the key publishes a series with that day's P&L missing. No stored row, flag or note says so. The only trace is one WARNING line in the Railway logs.
**Fix:** Keep the drained flags. In both modes, carry `malformed = {k for k, v in flags.items() if k.startswith("daily_pnl_malformed_") and v}` past the verdict and persist it:
- **Strategy mode:** add it to `_prestamp_flags` (`job_worker.py:~9960-10010`), which lands in `strategy_analytics.data_quality_flags`. The prestamp replaces flags wholesale, so a clean re-read clears it, which is the correct lifetime. Confirm the key is NOT a `NAV_TWR_GUARD_KEYS` member unless the founder wants it to promote `complete_with_warnings`.
- **Key mode:** write an owner-only note beside the `read_incomplete` marker in `allocator_equity_derived`, through the same never-raises writer shape as `_record_read_incomplete` / `_record_nav_mark_refusal`. Do not write it into the public `data_quality_flags`, which is the 174 D-02 precedent. The production count then becomes a SELECT.

### R3-04 (MEDIUM, user-facing): the W1 retraction exclusion keeps the D-11 contradiction for a watched Sync now that the enqueue dedup folded into an in-flight marked refresh. The founder did not decide this trade-off

**File:** `supabase/migrations/20261105120000_sync_status_protect_refused_derive.sql:468`, header `:49-52`
**Issue:** A retraction (`metadata = {refresh_marker_retracted: …}`, source removed) is written precisely when a USER's Sync now reuses the in-flight marked job.

**Scenario:** The retraction lands before the claim.
1. `job_source` is None, so there is no entry snapshot.
2. The refusal takes `keep_numbers`, an error-only write with "…these numbers stay at the last complete read".
3. The bridge's new clause excludes the retracted job, and the marked clause needs `source`, so the job is unprotected.
4. Branch (b) writes `failed` and keeps the writer sentence, because `job_id = v_latest_job_id`.
5. The page reads "Analytics computation failed: …these numbers stay at the last complete read".

That is the exact contradiction D-11 removes, on a user-initiated sync. The exclusion is forced only because the row signal cannot tell a D-15 honour write from a D-11 keep. The header records it as "the cost", but it is not in CONTEXT, the ROADMAP or TODOS.
**Fix:** The per-job marker from R3-02 separates the two writes, so W1 stays loud for the honour write and a retracted-then-refused derive is protected. If that is not taken, book the residue and put it to the founder. Do not leave it as header prose.

**Below threshold, noted only:** the migration header `:80` names a test file that does not exist. The arms live in `test_sync_status_marked_refresh_protected.sql`. The function COMMENT still says branch (b-prime) "writes NO computation_status", which the new CASE now contradicts.

_Reviewed: 2026-11-04_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Fix round 3 (applied)

**Applied:** 2026-11-05, six atomic commits on `feat/186-derivegaps`, minimal fixes only (founder rule: "For fix rounds minimal fix only, no new abstractions or defensive checks"). Each data-integrity test was neutered, seen RED, and restored from a byte backup.

| Finding | Commit | Tests that pin it |
|---|---|---|
| R3-01 (BLOCKER) the protection reads `metrics_json_by_basis`, which is NULL on every non-options strategy | `630a539e1` | SQL arms P1..P9 now seed the production row shape (`metrics_json` present, by-basis NULL); P1 reds when the bridge reads by-basis, P8 (by-basis only) must stay loud. Python `TestStrategyModeRefusal` params `computing-over-published-headline-with-null-by-basis`, `computing-with-only-a-by-basis-object`, `failed-row-with-stale-headline` (worker and bridge now use the same predicate: success status, or `computing` with `metrics_json`) |
| R3-02 (BLOCKER) a second consecutive refusal undoes the protection | `9e0afd093` | SQL arm P10 (refusal, cleared-provenance bounce, second refusal, expects `complete` plus the sentence; reds when the clause is keyed on the row's provenance), P4 (a sentence with no marker stays loud), P5 (kind scope). Python `test_where_numbers_exist_the_refusal_is_error_only_and_keeps_them` asserts the marker lands first, `test_the_job_marker_is_merged_into_the_live_metadata_not_written_over_it`, `test_a_marker_that_did_not_land_fails_the_job_transient_and_writes_no_sentence` |
| R3-04 (MEDIUM) the retraction exclusion keeps the D-11 contradiction for a user's Sync now | `deac81d3e` | SQL arm P11 (retracted and refused: `complete` plus the sentence; reds when the exclusion is restored), P9 (a retracted marked refresh that was not a refusal stays loud; reds when a retraction is treated as a protection). Python `test_a_refusal_on_a_job_a_users_sync_now_took_over_is_marked_too` |
| Migration MEDIUM: the function COMMENT said b-prime writes no status and every user-initiated job poisons loudly | `436d567c8` | Checked on the local stack: forward replaces both clauses, a re-apply skips with a NOTICE, the rollback restores them. Header claim and `Test:` pointer fixed |
| R3-03 / SFH M1 (MEDIUM) `daily_pnl_malformed_<venue>` was never persisted | `d049bf1f1` | Python `test_a_read_that_dropped_malformed_rows_is_not_refused_and_the_key_publishes` (now asserts the key's `key_inputs` record carries it), `test_a_clean_re_read_stores_no_malformed_flag`, `TestStrategyModeDroppedRowFlag` (prestamp carries it, not a guard key, clean re-read clears it), `test_daily_pnl_malformed_is_carried_and_never_promotes` (the runner's wholesale rebuild would otherwise wipe it) |
| SFH M2 (MEDIUM) an unmarked sibling with no returns is chosen over a marked sibling with history | `709a1b6ae` | Python `test_sc2_an_unmarked_sibling_with_no_returns_does_not_take_the_account_from_a_marked_one` (reds with the restriction removed) |

**Design notes.**
- R3-02 uses the existing `compute_jobs.metadata` column: the worker writes `read_refusal_kept_figures: true` into its own job (read-modify-write, through `_stamp_io`, before the sentence, so a marker that cannot land fails the job transient with nothing written). The bridge reads it off the failed job, scoped to `derive_broker_dailies`, together with a figures test on the row (`v_has_figures`, replacing `v_kept_job_id`). No table, column or constraint was added. The marker also removes the need for the retraction exclusion (R3-04).
- R3-03 key mode: the flag rides the key's existing owner-only `key_inputs:<api_key_id>` record as a present-only `daily_pnl_malformed` list, rewritten whole on every derive (a clean re-read clears it), not a new row family with its own never-raises writer. That record is written by the derive's existing writer, which lets a transient database error bubble and retry, so the flag cannot be dropped silently. Strategy mode: the prestamp flags, carried by the analytics runner through its wholesale rebuild (present-only, `is True`, outside the warned loops). The key is not a `NAV_TWR_GUARD_KEYS` member.
- Census: `test_sync_status_marked_refresh_protected.sql` sentinel 32 -> 34; `ARMS_FLOOR` in ci.yml 402 -> 404 and its pin in `drift-check-scripts.test.ts`; the scoped-update pin in `test_sql_gate_scoped_updates.py` 16 -> 19. The mutation runner's own floors did not move (these arms use the `ARM x FAILED` idiom, which the runner cannot attribute).
- The mutation runner's throwaway cluster builds `strategy_analytics` from stand-in fixtures with no `metrics_json` column, so the R3-01 bridge read made the pristine baseline of `test_sync_status_marked_refresh_protected.sql` die with 42703 (exit 3). Fixture 27 now declares the column (`47a88dc5f`); `node scripts/mutation-runner/run.mjs --file` is green for that gate and the 14 other gates that apply fixture 27.
- The `-- prod-body-ack:` pragma still equals the `live` column of `scripts/sql-body-normalize.mjs --diff-bodies`; the function snapshot is regenerated and `--check` is current.

## Post-round-3 review

**Scope:** `git diff b584fe619..HEAD -- . ':!.planning'`: 8 commits, 15 files. Depth: deep. MEDIUM and above only. The round's Python tests were run from `analytics-service/` (`test_derive_broker_dailies_dualmode.py`, `test_derive_allocator_equity_job.py`, `test_csv_analytics_runner.py`, `test_sql_gate_scoped_updates.py`: 336 passed). `node scripts/lint-sql-gates.mjs` reports 0 findings. The SQL gate was not run here.

**Verdict per finding**
- **R3-01: closed.** The worker (`job_worker.py:4831-4846`) and the bridge (`v_has_figures`, migration `:371-377`) now use the same predicate: `complete` or `complete_with_warnings`, or `computing` with `metrics_json` present. They agree on every status. They differ only on a JSONB `null` literal in `metrics_json`, where the worker reads "no figures", so no marker is written and the bridge never sees one. P1..P9 seed the production row shape.
- **R3-02: closed for the scenario it named** (P10: a second permanent refusal after a cleared-provenance bounce). Moving the protection onto the job opened a new failure path. See PR3-01.
- **R3-04: closed** (P11). A retraction that lands before the marker is written is merged over, because the worker's write is a read-modify-write that keeps every other key. One narrow residue (a retraction write that lands after the marker) is noted below the threshold.
- **Migration COMMENT: closed.** Both stale clauses are in `supabase/schema/baseline.sql` verbatim (1 hit each), so the forward `DO $comment$` block matches PROD's text. The rollback restores them word for word. `CREATE OR REPLACE` keeps the comment.
- **D-12 persistence (R3-03): closed.** In strategy mode the flag rides `_prestamp_flags` (`job_worker.py:10017-10018`), which replaces `data_quality_flags` wholesale (`:10088`). The runner reads that prestamp at entry (`analytics_runner.py:2011-2022`) and carries only `is True` keys (`:2309-2315`), so a clean re-read writes a prestamp without the key and the runner has nothing to carry: **a stale flag is cleared**. In key mode the flag rides `key_inputs`, which is rewritten whole on every publish. The flag is not a `NAV_TWR_GUARD_KEYS` member, so it never promotes a status. The TS readers pick keys by name, so the new key is inert there.
- **SFH M2: closed.** `working` now requires `row["id"] in first_return_day` (`job_worker.py:15565-15570`). When the only unmarked sibling has no returns, `pool` falls back to `working_all`, and `min` by first-return-day picks the marked sibling that has history.
- **Fixture 27: safe.** `ADD COLUMN IF NOT EXISTS metrics_json JSONB` is nullable and has no default. No fixture that pairs with it, and no migration loaded by the 15 gates that apply it, declares `metrics_json` again. Every gate that does not seed the column reads it as NULL ("no figures"), which is the loud direction.

**Questions the brief asked**
- *Can a later writer erase the marker before the bridge reads it?* `mark_compute_job_failed`, `mark_compute_job_done` and `reclaim_stuck_compute_jobs` never touch `metadata` (0 references each). The claim RPC and `set_compute_job_progress` MERGE (`COALESCE(metadata,'{}') || …`). The only writers that replace the column are the two retraction read-modify-writes (`long_fetch.py:121-150`, `src/lib/ledger-refresh-marker.ts:87-127`). They can erase the marker only if the marker write lands between the retraction's read and its write, a window of about one round trip at the very end of a minutes-long derive. The result is loud (`failed` over "these numbers stay"), not silent. Below the threshold: it is the documented 161.1-D11/D12 read-modify-write residue, and its real closure is the same merge arm in `enqueue_compute_job`.
- *Can the marker be set on a job whose row had no figures?* Not by the worker: the marker is written only when `_has_numbers` is True. But the marker **outlives the attempt that wrote it**, and the bridge re-tests figures on the row at every call. That is PR3-01.
- *Does a retracted marked refresh that was not a refusal still go loud?* Yes. It carries no `read_refusal_kept_figures`, and the marked-refresh clause needs `source`, which the retraction removed. P9 pins it.

### PR3-01 (MEDIUM, user-facing, regression introduced by the R3-02 fix): a marker written by a RETRYABLE refusal survives into the job's final failure. A bounced `complete` row is then left at `computing` with nothing in flight until the 16-hour reaper stamps it `failed` ("Analytics was interrupted…")

**File:** `analytics-service/services/job_worker.py:5192-5223` (the marker is written on every `keep_numbers` refusal, whatever its permanence), `:4863` and `:3922-3924` (`daily_pnl_fetch_error`, and a first-attempt `read_deadline`, refuse TRANSIENT), `:8036-8054` and `:17126-17133` (a per-crawl or handler timeout is transient and writes no stamp); `supabase/schema/functions/mark_compute_job_failed.sql:91-92` (transient at `attempts >= max_attempts` becomes `failed_final`); migration `20261105120000_sync_status_protect_refused_derive.sql:483-485` (the clause), `:754-805` (branch (a) clears the sentence), `:970-977` (b-prime returns the status only when the row's sentence names the protected job).

**Issue:** The marker is a property of the job row, and a retried job keeps its row, so the marker crosses attempts. The claim merge preserves it. The bridge honours the marker on the job's final failure whatever ended that attempt. The only row-side check is `v_has_figures`, and a bounced row passes it. In round 2 the protection needed the row's provenance to name the job. Branch (a) clears that provenance on the `failed_retry` bridge call, so this exact case was LOUD, as it was before the phase.

**Scenario:** A plain-`complete` OKX strategy (13 of the 16 PROD api-key strategies read plain `complete`, per R3-01). The cron or a user's Sync now runs `sync_trades`, the derive J is enqueued, and branch (a) bounces the row to `computing` with `metrics_json` kept.
1. Attempt 1: the realized read records `daily_pnl_fetch_error` (a venue blip). `_has_numbers` is True, so J gets `read_refusal_kept_figures: true` and the sentence. The result is transient (`_TRANSIENT_REFUSAL_TOKENS`).
2. `mark_compute_job_failed(…, 'transient')` sets J to `failed_retry`. The bridge takes branch (a), J is not in `v_unprotected_job_ids`, and the row is `computing`, so the sentence and provenance are cleared (`ELSE EXCLUDED.computation_error`, `:784`).
3. Attempts 2 and 3 hit the per-crawl `asyncio.TimeoutError` arm (transient, no stamp), or the dispatch `wait_for`. At `attempts >= max_attempts`, J becomes `failed_final`.
4. Bridge: J is a live `derive_broker_dailies` with the marker, and `v_has_figures` is TRUE (`computing` plus `metrics_json`), so J is protected. `v_failed_count = 0` and nothing is in flight, so the bridge takes branch (b-prime). The row's sentence is NULL, so it does not name J, and the status CASE at `:970-977` takes `ELSE computation_status`. The row **stays `computing`**, with `computation_error_copy('transient')`. The stamp trigger restores `computing_started_at` from the bounce.
5. Nothing is in flight, so no later bridge call moves the row. The owner's Sync now poller (`useStrategySyncPoller`) never reaches a terminal state. After 16 hours `reap_strategy_analytics_stuck_computing` writes `failed` with "Analytics was interrupted before it could finish and did not recover", which is untrue and contradicts D-11.

**Same family:** On the last attempt the marker lands and the sentence write then fails (`StampIOUnavailable`, transient). The job ends `failed_final` with the marker and no sentence, so step 4 follows. The round's own note ("a marker that did not land fails the job TRANSIENT with nothing written") covers only the reverse order.

No arm covers "marker on the failing job, sentence not on the row". P1..P11 all seed the sentence naming the job.

**Fix (minimal):** Make the marker mean a final refusal, and do not let the status return depend on the sentence having landed:
1. Write the marker only when the refusal's result is terminal: `error_kind == "permanent"`, or `job["attempts"] >= job["max_attempts"]`. A retryable refusal writes the sentence only, which branch (a) clears on the retry, as before.
2. In b-prime's status CASE, return `computing` to `complete` / `complete_with_warnings` for a protected failure whose job carries the refusal marker, without the `computation_error_job_id = v_protected_job_id` conjunct. Keep that conjunct for the sentence CASE only. Otherwise a marker that landed beside a failed sentence write still leaves the row at `computing`. Alternatively, in that order the worker removes the marker before re-raising.
3. Add an arm: J carries the marker and ends `failed_final` through `'transient'` at `attempts = max_attempts`, over a `computing` row with figures and no sentence. Assert a terminal status: `complete` if fix 2 is taken, or `failed` with the per-kind copy if only fix 1 is taken and the marker is absent. Add a Python test that a transient refusal writes no marker.

**Below threshold, noted only:**
- The migration header (`:369-370`, "A 'failed' row never qualifies: the loud path writes 'failed'") and the round-2 text it replaced both imply that the loud stamp clears the figures. It nulls only `metrics_json_by_basis` (`job_worker.py:5298-5301`). `metrics_json` survives a `failed` stamp. A `failed` row whose failing job has since been superseded (for example a failed `sync_trades` that a later `sync_trades` superseded) is bounced to `computing` with its old headline intact, and a refusal then returns it to `complete`. That republishes the last complete figures, which is consistent with D-11's sentence, so this is not a defect. But the comment's claim is wrong.
- The retraction read-modify-write race described above.

_Reviewed: 2026-11-04_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Fix round 4 (applied)

**Applied:** 2026-11-04, one narrow round on `feat/186-derivegaps`, a founder-approved one-time exception to the 3-round fix cap (186-CONTEXT.md D-13). Minimal fix only (founder rule: "For fix rounds minimal fix only, no new abstractions or defensive checks"). PR3-01 is the only finding in scope. Each new test was neutered, seen RED, and restored.

| Finding | Commit | Tests that pin it |
|---|---|---|
| PR3-01 (MEDIUM) part 1: a marker written by a retryable refusal survives into the job's final failure | `3f33b1a85` | Python `test_a_retryable_refusal_writes_the_sentence_and_no_marker` (transient fetch error on attempts 1 and 2 of 3, and a first-attempt deadline: sentence written, no `compute_jobs` update; reds with the guard removed) and `test_a_final_refusal_writes_the_marker_before_the_sentence` (transient on the last attempt, a repeat deadline, a permanent refusal on attempt 1: marker lands before the sentence; reds when the last-attempt test is neutered) |
| PR3-01 (MEDIUM) part 2: a marked failed_final job over a `computing` row with no sentence naming it stays `computing` until the reaper | `d9c13d483` | SQL arm P12 (`attempts = max_attempts`, a transient failure through the real `mark_compute_job_failed`, a `computing` row with figures and no sentence: expects `complete`, the figures and the cleared reaper anchor, and no writer provenance; reds when the marker arm of the status CASE is turned back into a sentence requirement) |

**What changed.**
- Worker (`job_worker.py`): the marker is written only when `permanent` or `attempts >= max_attempts` (both ints, the same shape the MT5 final-attempt branch uses). `_stamp_strategy_analytics_failed` gained one keyword, `final_refusal`, and the marker condition is `keep_numbers and final_refusal`. A retryable refusal still writes the sentence.
- Migration (branch (b-prime) status CASE): `computing` returns to `complete` / `complete_with_warnings` when nothing is in flight and EITHER the row's sentence is the writer's for the protected job (unchanged) OR the protected job is a `derive_broker_dailies` job carrying the marker. The sentence CASEs keep the provenance test; they decide whether to keep the sentence only. A row with no sentence takes the per-kind copy over a `complete` status, as for any protected failure whose sentence is not the writer's.
- The verify block gained one anchor for the new marker read (one `pj.metadata` marker test and one `pj.kind` scope). The rollback restores the previous body, and its comment-restore clause was updated to the new `v_new1` text.
- LOW comment slip, fixed only on the lines already being edited: the figures-test comment now says the loud stamp nulls only `metrics_json_by_basis` and `metrics_json` survives it. The test file's P1..P9 mentions are now P1..P12, and the roster and banner carry P12.

**Census.** `test_sync_status_marked_refresh_protected.sql` sentinel 34 -> 35 (roster P12 added). `ARMS_FLOOR` in `.github/workflows/ci.yml` 404 -> 405 (the sum's last term 34 -> 35), and its pin in `src/__tests__/drift-check-scripts.test.ts` `ARMS_FLOOR=404` -> `ARMS_FLOOR=405`. `SENTINEL_FLOOR` stays 26. `test_sql_gate_scoped_updates.py` stays 19: P12 seeds no `strategy_analytics` UPDATE (that is the arm's point: there is no sentence on the row). The mutation runner's floors did not move (P12 uses the `ARM x FAILED` idiom; the file's single twinned section is unchanged, `biting: 1`).

**Verified.** The function snapshot is regenerated and `--check` is current. The `-- prod-body-ack:` pragma still equals the `live` column of `scripts/sql-body-normalize.mjs --diff-bodies` (the old body is unchanged). On the local stack the forward migration, the rollback and a re-apply were run in turn, and the function COMMENT carries the new clause after the forward, the stale clause after the rollback, and the new clause after the re-apply. The corpus step of `sql-tests` was run against a fresh `scripts/local-stack/run.sh up` lane: 100 of 106 files passed, 6 LANE-ONLY excluded, 22 of 26 sentinels verified against the run, 405 declared arms. The gate file also passes on the pg-lane under the mutation runner baseline.

**Booked, not fixed (per D-13).** `[186-REFUSAL-MARKER-RMW-RACE]` (the unfenced read-modify-write of `compute_jobs.metadata`, routed to a follow-up phase to be booked after 186 ships) and `[186-REFUSAL-MARKER-NAME-CONTRACT]` (no test pins the Python constant to the SQL literal), both in `TODOS.md`.

## Round-4 review

**Scope:** `git diff f8e7664db..HEAD -- . ':!.planning'`: 3 commits, 9 files (`job_worker.py`, `test_derive_broker_dailies_dualmode.py`, the migration and its rollback, the function snapshot, `test_sync_status_marked_refresh_protected.sql`, `ci.yml`, `drift-check-scripts.test.ts`, `TODOS.md`). Depth: deep. MEDIUM and above only. The round's Python tests were run from `analytics-service/` (`-k "retryable_refusal or final_refusal or marker"`: 19 passed). The scenarios below were run through the REAL `mark_compute_job_failed` on a throwaway `scripts/pg-lane/run.sh` cluster, using the gate file's own `RED-UNDER-SETUP` apply list. The scratch gates were not committed.

**Verdict per question**
- **PR3-01: closed for the scenario it named.** In the PR3-01 sequence (a plain row bounced to `computing`, a transient refusal on attempt 1, then two timeouts with no stamp), the job now ends `failed_final` with no marker. The row ends `failed` with the per-kind transient copy ("Analytics could not complete after several automatic retries…"). That is loud and terminal, the outcome the PR3-01 fix list expected when only fix 1 applies. A marked job whose sentence is not on the row now returns the row from `computing` (P12, and measured below as X4). Nothing is left at `computing` for the reaper.
- **The new `OR EXISTS` branch cannot override a failure that should go loud.** Branch (b) (`v_failed_count > 0`) returns before branch (b-prime), so any live unprotected failure wins. Measured: a marked `failed_final` derive followed by a later unmarked `compute_analytics_from_csv` `failed_final` ends `failed` with the permanent copy. A marked derive superseded by a later same-kind `done` drops out of `live_failures` (the `NOT EXISTS … d.status = 'done'` subquery), so `v_protected_job_id` never names it. Measured: the row ends `complete` with the error NULL. While the row is `computing`, `v_publish_healthy` is FALSE, so the marked-refresh clause protects nothing. Every protected failure is then a marked derive with figures, and `v_protected_job_id` (the latest of them) always satisfies the `EXISTS`. The conjunct adds nothing beyond `is_protected` in the only state where the CASE can fire, so it does not widen the protection.
- **The final-attempt test is right for every refusal kind.** Both claim RPCs increment `attempts` and return the row with `RETURNING *` (`claim_compute_jobs_with_priority.sql:180` and `:403`, `RETURNING *` at `:190` and `:433`), so `job["attempts"]` is the value `mark_compute_job_failed` compares at `:88-93`. A permanent refusal is final on any attempt, including attempt 1, which the parametrised test covers. In strategy mode `marked` is always True, so `error_kind` is `permanent` exactly when `permanent` is. A transient refusal is final only at `attempts >= max_attempts`, which is the RPC's own rule. A NULL or non-int count reads "not final", so no marker is written. The claim always returns ints, so that fallback is theoretical. Where it did apply, it would fall into R4-01 below on a warned row.
- **A retryable refusal that then succeeds leaves nothing stale.** No marker is written, so the job carries none. On a plain row, branch (a) clears the sentence on the `failed_retry` call. On a warned row, branch (a) keeps the sentence through the retry. The chain's final `done` then reaches branch (c), which writes `computation_error = NULL` for a non-side trigger. **A retryable refusal whose retry then fails in some way other than a refusal does leave a stale sentence.** See R4-01.

### R4-01 (MEDIUM, user-facing, regression introduced by round 4's fix 1): on a WARNED row, a retryable refusal's "these numbers stay" sentence survives into the job's final non-refusal failure, and branch (b) keeps it over `failed`. That is the exact page D-11 was decided to remove.

**File:** `analytics-service/services/job_worker.py:4857-4870` (a retryable refusal still calls the stamp with `keep_numbers=True`, so the error-only write at `:5205`/`:5272` runs and writes the sentence with writer provenance naming the job. Only the marker is skipped, `:5206`). Migration `20261105120000_sync_status_protect_refused_derive.sql:769-787`: branch (a) keeps `complete_with_warnings` and keeps `computation_error` and its provenance for a `complete_with_warnings` row, so the sentence is not cleared on the retry. `:891`: branch (b) keeps a writer sentence whose provenance names `v_latest_job_id`. Test that encodes the hazard: `analytics-service/tests/test_derive_broker_dailies_dualmode.py:2808` (`test_a_retryable_refusal_writes_the_sentence_and_no_marker` asserts that the sentence IS written).

**Issue:** The PR3-01 fix list assumed that a retryable refusal's sentence is one "which branch (a) clears on the retry, as before". That holds only for a row branch (a) bounces to `computing`. Branch (a) never bounces a warned row. It keeps `complete_with_warnings` and keeps the sentence and its provenance. In round 3 the marker written on attempt 1 protected the job's final failure, so the row stayed `complete_with_warnings` with the sentence, which is correct D-11. Round 4 removed that marker and left the sentence. If the last attempt fails in some way other than a refusal, the job is an unmarked live `failed_final`. Its id is `v_latest_job_id`, and the row's provenance names it, so branch (b) writes `failed`, clears `computation_warned` and **keeps "We could not read this account's full history from the exchange, so these numbers stay at the last complete read."** Ways the last attempt can fail without a refusal include a handler `wait_for` timeout, a per-crawl `asyncio.TimeoutError`, a `HandlerIOUnavailable`, or any unclassified exception. None of these stamps a row.

**Scenario (measured, pg-lane, real `mark_compute_job_failed`):** A `complete_with_warnings` api-key strategy (warned TRUE, `metrics_json` present). By PR3-01's count about 3 of the 16 PROD api-key strategies are not plain `complete`. The owner presses Sync now, so `sync_trades` runs and enqueues an unmarked derive J. A retracted marked refresh (P11's user-watching case) is unmarked too.
1. Attempt 1 of 3: the realized read records `daily_pnl_fetch_error`. `_has_numbers` is True and `_refusal_is_final` is False, so no marker is written. The error-only write stamps the sentence with provenance (`writer`, J). The result is transient, so J goes to `failed_retry`.
2. The bridge takes branch (a). The row stays `complete_with_warnings`, and the sentence and provenance are kept (`:769-787`).
3. Attempts 2 and 3 hit the 900 s handler timeout (transient, no stamp). At `attempts = max_attempts`, J becomes `failed_final`.
4. J is unmarked, so `is_protected` is FALSE and `v_failed_count = 1`. Branch (b) runs, and the provenance names J = `v_latest_job_id`, so the sentence is kept.
   Measured result: `status failed, warned f, figures t, source writer, error: We could not read this account's full history from the exchange, so these numbers stay at the last complete read.` The same sequence with round 3's attempt-1 marker gives `status complete_with_warnings, warned t`, with the same sentence.

The owner reads "Analytics computation failed: …these numbers stay at the last complete read", the self-contradicting page that D-11 ("Keep figures, fix updater") was decided to remove. This is the venue-degradation sequence PR3-01 itself used (a fetch blip, then timeouts). It is not new to a plain row, but it is new to a warned row, which every round before round 4 handled correctly. P4 seeds this input shape (a sentence naming an unmarked job). It asserts only `failed` and never reads the sentence, so the gate does not see the contradiction.

**Fix (minimal):** Make the sentence follow the same rule as the marker: a retryable refusal over published figures writes nothing to `strategy_analytics`. In `_refuse_incomplete_read` (`job_worker.py:4857-4870`), skip `_stamp_strategy_analytics_failed` when `_has_numbers and not _refusal_is_final`. Keep the call for `not _has_numbers`, which is the existing no-numbers loud stamp. The retry then decides alone. A final refusal writes the marker and the sentence, as now. A final non-refusal failure goes loud with the per-kind copy on both a plain row and a warned row, which matches the plain-row outcome above. Flip `test_a_retryable_refusal_writes_the_sentence_and_no_marker` to assert that no `strategy_analytics` upsert and no `compute_jobs` update are made. Optionally, add a sentence assertion to P4 so that the gate sees the self-contradicting shape. The other way to fix it is to keep the marker on retryable refusals for warned rows only. That re-opens PR3-01's crossing class and makes plain and warned rows disagree, so it is not recommended.

**Below threshold, noted only:**
- **The marker can still cross attempts, so the header claim at migration `:75` ("a retryable refusal never reaches this return") is not strictly true.** On a permanent refusal before the last attempt, the marker lands and then the error-only write can raise `StampIOUnavailable`, or be cancelled by the 900 s `wait_for`. Repeat-deadline refusals run close to that budget. Either way the job fails TRANSIENT and is retried with the marker on it. A watchdog preemption between the marker write and the mark RPC does the same. If the remaining attempts then fail without a stamp, the marked `failed_final` returns the row to `complete`, with the per-kind copy. Measured (X4, `unknown` on attempts 2-3): `status complete, source NULL, error: Analytics could not complete after several automatic retries…`. This is better than round 3, which left the row at `computing` until the reaper, and the figures shown are the real last complete read. But "complete" beside "could not complete" is mildly contradictory. It needs a write failure or cancel exactly between two consecutive writes, followed by non-refusal failures on every remaining attempt.
- The `EXISTS` conjunct is redundant in the only state where the status CASE can fire (see Q1). It is harmless, and the verify block now pins it.

_Reviewed: 2026-11-04T09:15:39Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Fix round 5 (applied)

**Applied:** 2026-11-04, one one-line round on `feat/186-derivegaps`, the second and last founder-approved exception to the 3-round fix cap (186-CONTEXT.md D-14). Minimal fix only (founder rule: "For fix rounds minimal fix only, no new abstractions or defensive checks"). R4-01 is the only finding in scope. The flipped test was neutered, seen RED, and restored from a byte backup.

| Finding | Commit | Tests that pin it |
|---|---|---|
| R4-01 (MEDIUM): on a warned row a retryable refusal's "these numbers stay" sentence survives into the job's final non-refusal failure | `298bf6797` | Python `test_a_retryable_refusal_over_published_figures_writes_nothing_to_the_row` (transient fetch error on attempts 1 and 2 of 3, and a first-attempt deadline: no `strategy_analytics` upsert, no `compute_jobs` update, nothing else written; reds on all three cases when the skip is neutered to always stamp). `test_a_final_refusal_writes_the_marker_before_the_sentence` is unchanged and still pins the final case. |

**What changed.** `_refuse_incomplete_read` (`job_worker.py`): `_stamp_strategy_analytics_failed` is skipped when `_has_numbers and not _refusal_is_final`. The no-numbers loud stamp and a final refusal (marker, then sentence) are unchanged. The old `test_a_retryable_refusal_writes_the_sentence_and_no_marker` was flipped and renamed to assert the row is untouched. No SQL change; the migration, its rollback, the snapshot and the census are untouched.

**Not done (per D-14).** The optional P4 sentence assertion the reviewer suggested was not added: it is a SQL change and D-14 allows only the condition and the flipped test. The `final_refusal` keyword of the stamp is now always True whenever `keep_numbers` is True; it was left alone as a no-new-abstraction, no-extra-edit round.

## Round-5 review

**Scope:** `git diff 752db63e9..HEAD -- . ':!.planning'`: 1 code commit (`298bf6797`), 2 files (`analytics-service/services/job_worker.py`, `analytics-service/tests/test_derive_broker_dailies_dualmode.py`). Depth: deep. MEDIUM and above only. `tests/test_derive_broker_dailies_dualmode.py` was run from `analytics-service/`: 104 passed. The SQL is unchanged in this round, so the bridge outcomes below were traced through the CASEs of migration `20261105120000` (branches (a), (b) and (b-prime)) and `mark_compute_job_failed.sql:88-93`. They were not re-run on a pg-lane cluster.

**Verdict: R4-01 is closed. No new MEDIUM+ finding.**

The change only removes a call. In strategy mode, `_refuse_incomplete_read` (`job_worker.py:4866-4875`) now skips `_stamp_strategy_analytics_failed` when `_has_numbers and not _refusal_is_final`. With `keep_numbers=True`, that call did exactly two things: the marker write, already skipped when the refusal was not final, and the error-only upsert (`:5211-5265`). So the skip removes the error-only sentence and its writer provenance, and nothing else. The only other effect lost is a WARNING log line, and the refusal's own WARNING at `:4805` still names the token. The `_has_numbers` read still runs first, so a failed read still propagates as before. The DispatchResult does not change: transient, retried by `mark_compute_job_failed` while `attempts < max_attempts`, the same rule the worker uses to decide what is final. `run_derive_broker_dailies_job` is reached only through the job dispatch, so `attempts` and `max_attempts` always come from the claim's `RETURNING *`.

**R4-01 itself (a warned row, a retryable refusal, then timeouts on every remaining attempt).** Attempt 1 now writes nothing, so the row keeps `complete_with_warnings` with whatever provenance it had before. On the `failed_retry` call, branch (a) keeps the status and that existing error. J then ends `failed_final` with no marker. Branch (b) keeps a writer sentence only when `computation_error_job_id = v_latest_job_id`, which is J, and no row value names J now. So the row reads `failed` with `computation_error_copy('transient')`, and "these numbers stay" no longer appears beside `failed`. This is the outcome the R4-01 fix list asked for, and it matches the plain-row outcome measured in round 4.

**Each case the brief asked about**
- **A bounced `computing` row whose retries all time out.** The outcome is the same as round 4. Round 4's attempt-1 sentence was already cleared by branch (a) on the `failed_retry` call (`ELSE EXCLUDED.computation_error`, because a `computing` row is neither warned nor `v_refresh_keep`). Removing it changes nothing. The row ends `failed` with the per-kind transient copy, which is loud, terminal and true. Suppose a protected earlier derive J0, still live and not superseded, left its writer sentence. The bounce cleared that sentence too, and branch (b) wins over J0's protection because `v_failed_count = 1`.
- **A warned row whose retries all time out.** The row ends `failed` with the per-kind copy, as above. Suppose an earlier final refusal J0 left its sentence on the warned row. That sentence names J0, not `v_latest_job_id`, so it is replaced. `computation_warned` stays TRUE beside `failed`, because the row's provenance does not name an unprotected job. That is the pre-phase outcome for any derive on a warned row that fails without a stamp, not something this round introduced (see the note below).
- **A retry that refuses finally.** At `attempts >= max_attempts`, or on any permanent refusal, `_refusal_is_final` is True. The skip does not fire, so the marker lands first and then the sentence, both naming J. `_has_numbers` is re-read on that attempt. The earlier attempts wrote nothing and branch (a) never writes `failed` while J is in flight, so the read still finds figures. Branch (b-prime) then returns a bounced `computing` row to `complete`. A warned row is left at `complete_with_warnings`, and the sentence is kept because the provenance names `v_protected_job_id = J`. This is unchanged from round 4 and pinned by `test_a_final_refusal_writes_the_marker_before_the_sentence`.
- **A retry that succeeds.** Nothing was written, so nothing is stale. The chain's `done` supersedes J0, if there is one, and branch (c) clears the error. Round 4 wrote a sentence here that was cleared again later. Round 5 never writes it.
- **Key mode.** It is unaffected. The changed lines sit inside the `else:` of `if is_key_mode:` (`:4811-4875`), and `_stamp_strategy_analytics_failed` returns at once in key mode anyway (`:5032-5033`). `_name_refused_key` and the result's `error_kind` (`"permanent" if permanent and marked`) are untouched.
- **Additional case checked: a marked ledger refresh (D-15) over a published row.** A retryable refusal now writes nothing. If every remaining attempt times out, the marked job is protected by `v_publish_healthy`. Branch (b-prime) then keeps the status and, with no writer sentence naming J, writes the per-kind copy. That is D-15's pre-phase behaviour for any marked-refresh failure that is not a refusal, and the final failure here was not a refusal. Round 4 would have shown the refusal sentence for a timeout, so this is no worse.

**Test.** `test_a_retryable_refusal_over_published_figures_writes_nothing_to_the_row` asserts no `strategy_analytics` upsert, no `compute_jobs` update, and the shared nothing-else helper. It covers attempts 1 and 2 of 3 and a first-attempt deadline. With the skip removed, the error-only upsert returns and the first assertion fails, so the test can go red.

**Below threshold, noted only (no fix asked, per D-14)**
- The PR3-01 comment at `job_worker.py:4849-4855` still says a retryable refusal "writes the sentence only, which the bridge's branch (a) clears on the retry". The R4-01 comment directly below it, and the code, now say the opposite. The migration header `:82` ("While a retry of the refused derive is in flight, the row reads 'computing'") is true only for a plain row: branch (a) keeps a warned row at `complete_with_warnings`.
- No test exercises a RETRYABLE refusal with NO published figures. `test_where_no_numbers_exist_the_failed_stamp_carries_no_promise` uses the default permanent token with no `attempts`, so a mutation of the condition to `if _refusal_is_final:` would stay green. The impact is small: the final failure is loud either way.
- On a warned row, every non-refusal final failure ends `failed` with `computation_warned` still TRUE (branch (b) clears `warned` only when the row's provenance names an unprotected job). This is pre-phase behaviour. Round 4 cleared it on this path only because its stale sentence named J.

_Reviewed: 2026-11-04T09:34:47Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

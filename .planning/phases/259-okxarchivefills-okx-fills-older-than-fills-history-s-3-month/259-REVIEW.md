---
phase: 259-okxarchivefills-okx-fills-older-than-fills-history-s-3-month
round: 2
reviewed: 2026-11-28T12:00:00Z
round_1_reviewed: 2026-11-28T00:00:00Z
round_2_fix_commits: [1bc2d3657, 6e9c03c3f, 59cc2e1f2]
depth: standard
base: 9f0fb9e6a8aa3f733d3dc1cee81a9a8e96a912ef
files_reviewed: 19
files_reviewed_list:
  - analytics-service/services/exchange.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/okx_archive_files.py
  - analytics-service/services/okx_archive_fills.py
  - analytics-service/services/okx_archive_fills_chain.py
  - analytics-service/services/okx_archive_fills_map.py
  - analytics-service/services/okx_archive_job.py
  - analytics-service/tests/_okx_archive_fills_fakes.py
  - analytics-service/tests/_okx_archive_fills_fixtures.py
  - analytics-service/tests/fixtures/okx_archive/fills_q2_2026.csv
  - analytics-service/tests/fixtures/okx_archive/fills_q3_2026.csv
  - analytics-service/tests/test_okx_archive_fills_apply.py
  - analytics-service/tests/test_okx_archive_fills_chain.py
  - analytics-service/tests/test_okx_archive_fills_job.py
  - analytics-service/tests/test_okx_archive_fills_map.py
  - analytics-service/tests/test_okx_archive_fills_parse.py
  - analytics-service/tests/test_okx_normalize_fill_golden.py
  - docs/runbooks/README.md
  - docs/runbooks/okxarchivefills-backfill.md
findings:
  critical: 0
  high: 0
  medium: 1
  low: 3
  warning: 1
  info: 3
  total: 4
  round_1_total: 13
  necessity: 0
status: findings
---

# Phase 259 OKXARCHIVEFILLS: Code Review Report (round 1)

**Reviewed:** 2026-11-28
**Depth:** standard, with cross-module tracing into `okx_archive_job.py`, `exchange.py`, the `run_sync_trades_job` live upsert and the current `enqueue_compute_job` / `set_compute_job_progress` / `defer_compute_job` SQL
**Files reviewed:** 19
**Status:** findings (3 MEDIUM, 10 LOW, nothing CRITICAL or HIGH)

## Summary

The write path is sound where it matters most. I traced each of the following and found no defect:

- **Same row shape as the live read.** `_write_fills` sends the same `_make_fill_dict` row through the same upsert as the live Phase 2 write (`job_worker.py` `run_sync_trades_job`, `on_conflict="strategy_id,exchange,exchange_fill_id"`, `ignore_duplicates=True`, batches of 100). `fetch_raw_trades` does no post-processing on OKX rows. The `_synthesize` keys that survive `_trim_raw_data` (`instType`, `posSide`, `execType`, `feeCcy`, `_ingest_ctval`) are the live keys. The only addition is `source`.
- **Units.** The ctVal conversion is the live `_normalize_okx_fill`. An instrument outside `_OKX_INGEST_CONTRACT_SIZE` is refused before the normaliser can fall back to 1.0.
- **Account.** D-02 checks every target key's stored uid, and `_check_account` compares the live `account/config` uid with all of them.
- **Gates before writes.** Every gate (bal chain, mapping, per-target reconcile, legacy gate) runs for every target before the first write.
- **The bearer link.** It lives only in `repr=False` fields. `_download_quarter` wraps every exception that could carry it. Logs carry the scheme and host only.
- **The seam.** All four seam variables are defined at function scope on every OKX path. The chain is reached only on the DONE path, after the follow-on enqueue.
- **No DQ-flag leak.** `map_trade_bills` runs in `asyncio.to_thread`, which copies the context, and `_record_dq_flag` is copy-on-write.
- **Runbook enqueues.** They use the same form as the executed OKXHISTORY runbook (`p_run_at` exists on the public function, and the api_key in-flight dedupe returns the existing row).

The three MEDIUMs are about what happens around the write, not the write itself:

1. **M-01:** the persisted apply count, the mechanism the phase built to protect the 12-a-day budget, is lost on every claim exit except a rate limit or a named stop. The exit it misses most often is a network error on the apply POST itself.
2. **M-02:** a write that fails partway and runs out of retries becomes permanent, and the chain's trigger can no longer see it, because the batches go oldest first.
3. **M-03:** a `finished` quarter whose link has died has no re-apply path. RESEARCH proposed one (A4) and no plan carried it. This depends on an unmeasured OKX behaviour, and the runbook's own 5.5 h instruction suggests the author expects that behaviour.

Necessity rubric (`necessity-review.md`) was read. No necessity finding met its evidence rule.

## Medium Issues (actionable)

### M-01: The apply count is not persisted on most claim exits, so a lost count can re-POST an apply (apply budget; not data-integrity)

**Files:** `analytics-service/services/okx_archive_fills.py` `run_okx_archive_fills_job` (the `except` clauses after `_read_and_gate` / `_write_fills`), `_fills_quarter_step` (the `entry["applies"] = ...` lines before `pacer.apply`), `_fills_defer` (the swallowed `_write_result` failure followed by `_defer_job`); `analytics-service/services/okx_archive_job.py` `_apply_quarter_on_fresh_instance` (`except ccxt.OperationFailed: raise`).

**Issue:** The docstring promises: *"The count is raised BEFORE the POST, so a rate limit or a crash after the POST still counts it (the handler writes the block on every defer and stop)."* In fact the count only exists in the in-memory `result`. It reaches `metadata.member_progress` only through `_finish_fills_stop` (on `_Stop`, `_FillsStop` or `FillsMapError`) and through `_fills_defer` (on `_Waiting`, `RateLimitExceeded` or `DDoSProtection`).

Every other exit returns to `dispatch()` without writing the block:

- **A network error on the apply POST.** `_apply_quarter_on_fresh_instance` re-raises `ccxt.OperationFailed`, which includes `NetworkError`, `RequestTimeout`, `ExchangeNotAvailable` and `InvalidNonce`. The handler catches only `RateLimitExceeded` and `DDoSProtection`. A `RequestTimeout` on the POST is the textbook case where the POST may have landed.
- **A network error later in the same claim.** `_okx_bills_fetch_with_backoff` re-raises any non-429 exception at once. So if quarter 1 applied and quarter 2's GET raises a network error, quarter 1's count is lost.
- **Any PostgREST error** in `_read_stored_fills` / `_evaluate_targets` after an apply, and the `asyncio.wait_for` cancellation at 900 s.
- **A failed result write in `_fills_defer`.** It is logged and swallowed, and the job is deferred anyway.

The dispatcher classifies these exits as transient, so the job is retried. The next claim's `_prior_applies` reads the older block, or no block, and sees 0. The step then applies again whenever the GET answers "no entry", and `_fills_quarter_step` itself models that case as normal right after an apply ("OKX is simply not showing the request yet").

**Bound:** one extra POST per affected quarter per retry, up to the job's `max_attempts`. Across 4 quarters that is a material share of the 12 a day. No test covers a non-429 `ccxt` error (`grep -n "NetworkError\|RequestTimeout\|OperationFailed" tests/test_okx_archive_fills_*.py` finds nothing).

**Fix (minimal):** make the count write-ahead. Persist the block before each POST, and refuse to POST when it cannot be persisted:

```python
# in _fills_quarter_step, both apply arms, before pacer.apply(...)
entry["applies"] = prior + 1
if not await _write_result(supabase, job, result):   # pass supabase/result through
    raise _Stop("archive_request_failed", f"quarter={tag} cause=count_not_persisted")
answer = await pacer.apply(key_row, year, label)
```

Separately, in `_fills_defer`, a raised `_write_result` after an apply in this claim must not fall through to `_defer_job`. Return the stop or FAILED instead. Write-ahead alone closes every exit listed above.

### M-02: A partial write becomes permanent and invisible to the chain trigger (data-integrity: incomplete fill history with no re-trigger)

**Files:** `analytics-service/services/okx_archive_fills.py` `_write_fills` (batch loop `for i in range(0, len(write_rows), 100)` over `mapped`, which `map_trade_bills` sorts ascending by `row_ms`); `analytics-service/services/okx_archive_fills_chain.py` `_chain` (`if fill_ms <= anchor_ms + REACH_SLACK_MS: return "fills_reach_anchor"`) and `_counts_toward_cooldown`.

**Issue:** The batches are sent oldest first. If batch k fails (`fills_write_failed`) or the claim budget runs out mid-write (`claim_budget_exceeded`), the rows that already landed stay. Both stops are transient. If the retries are exhausted, which is most likely during a sustained DB incident, the job ends `failed_final` with batch 1 stored. Batch 1 holds the target's earliest archive fills, which usually sit within 2 days of its anchor.

From then on, every sync's `_chain` returns `fills_reach_anchor`, so the remaining fills are never chained again, even after the 14-day cooldown (which this `failed_final` also starts). The same happens to target 1 when the failure hits target 2, because targets are written one after another and target 1 is already complete or partial.

The runbook (§1, "All or nothing per read"; §11) and CONTEXT promise all-or-nothing. In this case the history stays incomplete and nothing re-triggers. The only signal is one `failed_final` row that the retention cron eventually prunes.

**Fix (minimal):** send each target's batches newest first, so the earliest fill lands last and the trigger stays true until the window is complete:

```python
write_rows = [m.row for m in reversed(mapped) if anchor_ms <= m.row_ms < prepared.write_bound_ms]
```

Optionally, also leave `fills_write_failed` / `claim_budget_exceeded` out of `_counts_toward_cooldown`, so the next sync re-chains instead of waiting 14 days.

### M-03: A `finished` quarter whose link has died has no re-apply path (phase-goal liveness, conditional on unmeasured RESEARCH A4)

**Files:** `analytics-service/services/okx_archive_fills.py` `_fills_quarter_step` (a `finished` state never applies), module docstring "Known gap" paragraph ("at no apply cost while OKX still holds the files"); `analytics-service/services/okx_archive_job.py` `_download_quarter` (one fresh GET, then the transient `link_expired`); `docs/runbooks/okxarchivefills-backfill.md` §10 ("Do this within 5.5 h of the calibrate's quarters reading `finished`, so the link is still alive and no re-apply is needed") and §14.

**Issue:** RESEARCH assumption A4 says a GET after the 5.5 h link life may not return a fresh link without a re-apply. RESEARCH's recommended quarter step therefore included "re-apply once more only when the download answers expired twice (`link_expired`)". No plan carried that branch.

As built, if A4 holds, the sequence for a quarter whose link is dead is:

1. The GET reads `finished`, so the step does not apply.
2. `_download_quarter` gets 403/410, re-reads, gets the same dead link, and raises `link_expired`.
3. The job retries until `failed_final`. That row counts toward the cooldown (non-blank `last_error`).
4. Every later job, chained or manual, repeats steps 1 to 3 until OKX drops the entry, about 30 days after the apply.

Two situations exceed 5.5 h by construction:

- The chained `fills_apply` is deferred to 01:50 UTC whenever it is enqueued inside the daily window, which covers most daily syncs. It can easily land more than 5.5 h after a calibrate.
- The 14-day re-chain the module docstring describes always arrives with dead links.

The runbook's 5.5 h instruction and the docstring's "no apply cost while OKX still holds the files" cannot both be right. If the runbook is right, the backfill has a single 5.5 h window and the automatic chain cannot re-read a quarter inside OKX's 30-day retention. This writes nothing wrong, but it can block the phase goal (the PROD backfill and future strategies).

**Fix (minimal):** in the fills path, catch `_Stop("link_expired")` coming from `_ingest_quarter` and handle it per quarter. While `prior < FILLS_MAX_APPLIES_PER_QUARTER`, apply once, counted and persisted per M-01, and defer `FIRST_STATUS_READ_AFTER_S`. Otherwise raise as today. If the founder prefers not to build it, record A4 as an open premise and have the runbook calibrate measure it: read a quarter's link again more than 5.5 h after `finished`. Until then, drop "at no apply cost" from the docstring and runbook §14.

## Low Issues (recorded only; not fixed per the review rule)

### L-01: A cross-key race can enqueue two `fills_apply` jobs for one account

**File:** `okx_archive_fills_chain.py` `_chain` (cooldown read, then a separate enqueue). The dedupe in `_enqueue_compute_job_internal` is per `api_key_id`.

Two same-account strategies on different keys whose syncs finish within the read-to-enqueue gap both pass the cooldown, and both enqueue. Because of the shared 01:50 `p_run_at`, both jobs then claim together, both GETs answer "no entry", and both apply. Each job's per-job count and per-claim pacer bound nothing across jobs, so up to 2 times the applies. The window is milliseconds.

Fix: pass a deterministic account-and-day `p_idempotency_key`, built from a hash of the account and never the raw uid.

### L-02: `_counts_toward_cooldown` disagrees with its docstring and runbook §2

**File:** `okx_archive_fills_chain.py` `_counts_toward_cooldown`.

The docstring and runbook say "a failure with no named stop does not count". The code counts any non-blank `last_error` that does not start with the `invalid_input` prefix, which includes dispatcher text such as a handler timeout or a `classify_exception` string. The code matches plan 03 step f, so the docs are what drifted. Either check the `okx_archive_rebuild: <class>` prefix or fix the prose.

### L-03: The chain can turn a completed sync into a timeout

**File:** `job_worker.py` seam at the tail of `run_sync_trades_job`.

The chain runs inside the sync's 900 s `wait_for` after a fills read that may use 840 s, and it can add up to `CHAIN_TIMEOUT_S` (30 s). If the outer `wait_for` fires during the chain, `CancelledError` bypasses `except Exception` and a fully persisted sync is reported FAILED, which contradicts "never changes the outcome". It is rare. Fix: skip the chain when less than `CHAIN_TIMEOUT_S` plus a margin is left of the handler budget.

### L-04: "At most twice ever" is really "per job"

**Files:** `docs/runbooks/okxarchivefills-backfill.md` §1 ("requested at most twice ever") and the comment on `FILLS_MAX_APPLIES_PER_QUARTER` ("ever").

`_prior_applies` reads only this job's `member_progress`, so a new job starts at 0. The runbook's budget reasoning overstates the bound.

### L-05: Runbook §7 claims a `failed_retry` job blocks a second enqueue, but the dedupe ignores that status

**File:** `docs/runbooks/okxarchivefills-backfill.md` §7.

The runbook lists `failed_retry` as waiting and says "a second enqueue while one is in flight returns the existing row". The enqueue dedupe matches only `pending`, `running` and `done_pending_children`, so a manual enqueue during `failed_retry` creates a second concurrent job.

### L-06: Dead local `_is_linear_type` left in the pager

**File:** `exchange.py` `_fetch_raw_trades_okx_inst_type`.

`_is_linear_type = inst_type in ("SWAP", "FUTURES")` is left over from the extraction and is no longer read.

### L-07: Old quarters are scaled with today's contract value

**File:** `okx_archive_fills_map.py` `map_trade_bills`, through `_normalize_okx_fill`.

Archive `sz` is converted with today's static `_OKX_INGEST_CONTRACT_SIZE`. If OKX changed an instrument's ctVal in the past, quarters with no stored overlap would be mis-scaled and no gate could tell. The PROD scope is 2026 only.

### L-08: The runbook universe does not filter exactly like `_discover_targets`

**File:** `docs/runbooks/okxarchivefills-backfill.md` §5.

The runbook uses `lower(k.exchange) = 'okx'`, drops NULL `status` rows (`<> 'archived'`), and groups on the raw `venue_account_id`. The job uses an exact `'okx'`, keeps NULL status, and matches on the stripped uid. `target_position` can differ on edge data.

### L-09: Rollback can delete fills that `fills-history` will not re-read

**File:** `docs/runbooks/okxarchivefills-backfill.md` §15.

Deleting `source = okx_bills_history_archive` rows in the `[floor, write_bound)` overlap removes fills that `fills-history` may not re-read once the cursor has passed them.

### L-10: The chain logs `enqueued` when the dedupe returned a different job

**File:** `okx_archive_fills_chain.py` `_chain`.

When the dedupe returns an in-flight `okx_archive_rebuild` job of another mode on the key, nothing new is created but the log still says `enqueued`. It is harmless, because the next sync re-chains.

---

_Reviewed: 2026-11-28_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure-hunter findings (round 1, appended by the orchestrator)

MEDIUM (actionable):
- **SFH-M1** `run_okx_archive_fills_job`: a non-rate-limit `ccxt.OperationFailed`/`BaseError` (timeout on the apply POST, network error on a later GET, 503) escapes with no result write, so the persisted apply count is lost. Overlaps CR M-01.
- **SFH-M2** `_fills_defer` / `_finish_fills_stop`: a failed `_write_result` is swallowed even when this claim spent an apply; the count becomes non-durable silently. Overlaps CR M-01.
- **SFH-M3** `_fills_quarter_step`: a `RateLimitExceeded`/`DDoSProtection` from the apply POST is a refusal (no request exists at OKX), yet `applies` stays raised; the next claim waits on "no entry, prior>=1" until `GIVE_UP_AFTER_S` and stops `archive_request_failed cause=no_entry_after_apply`, which starts the 14-day cooldown. Restore `entry["applies"] = prior` for those two classes only.
- **SFH-M4** `okx_archive_fills_chain._counts_toward_cooldown`: counts any `failed_final` with non-empty `last_error` not starting `okx_archive_rebuild: invalid_input`, including dispatcher text (handler timeout, raw ccxt/DB text, reaper). The module docstring says unnamed failures do not count. Overlaps CR L-02.
- **SFH-M5** `_evaluate_targets` / `reconcile_window`: when the reconcile quarter is not read (override mode) the result reports `state: "window_empty"` although no reconcile ran.
- **SFH-M6** `_write_fills`: `inserted_before_failure` sums only integer counts (None reads as 0); the PostgREST code is dropped (`from None`), so a permanent cause is retried as transient with identical output; a budget expiry mid-write leaves `inserted` a definite integer while the in-flight batch outcome is unknown.

## Orchestrator dispositions for the fixer round

- CR M-01 + SFH-M1 + SFH-M2: persist the raised apply count (a `_write_result` of the result block) BEFORE each apply POST; if that persist fails, do not POST (named transient). This makes M1/M2 moot for the count.
- SFH-M3: on `RateLimitExceeded`/`DDoSProtection` from the POST, restore and re-persist `applies = prior` before deferring. Timeouts and unknown outcomes stay "spent".
- CR M-02: write each target's batches newest first. Combined with the SFH-M4 fix below, an exhausted transient write re-chains and the idempotent upsert completes it.
- SFH-M4 + CR L-02: a `failed_final` counts toward the cooldown only when `last_error` starts with `okx_archive_rebuild: ` AND its class is a permanent class (not `invalid_input`, not the transient classes `claim_budget_exceeded`, `link_expired`, `fills_write_failed`). Update the docstring and runbook §2 to match.
- CR M-03: on `finished` with a dead link (the transient `link_expired` after the fresh GET), re-apply once as a counted, persisted apply within `FILLS_MAX_APPLIES_PER_QUARTER`; fix the runbook/docstring contradiction about re-reads.
- SFH-M5: keep the recorded decision (CONTEXT Addendum: an empty overlap may write for a proven instType with the bal chain passing). Fix only the label: report `state: "not_performed"` when the reconcile quarter was not read, and note it in the runbook go/no-go.
- SFH-M6: report `inserted_before_failure=unknown` when any count is None; log the PostgREST/SQLSTATE `code` only if it matches `^[0-9A-Z]{5}$` (never message/details/hint); on `claim_budget_exceeded` during the write, set that target's `inserted` to None.
- LOW items (CR L-01..L-10, SFH lows) are recorded only and not fixed.

## Round 2

**Reviewed:** 2026-11-28, standard depth, same scope. Fix commits `1bc2d3657` (topic A), `6e9c03c3f` and `59cc2e1f2` (topic B), read against `8224ad19d`.
**Tests:** the six phase test files, run from `analytics-service/` with `.venv`: 230 passed.
**Round 2 status:** findings. 1 MEDIUM (apply budget, not data-integrity, not user-facing) and 3 LOW. Nothing CRITICAL or HIGH. The frontmatter counts are round 2's; round 1's 13 are kept as `round_1_total`.

### Round 1 MEDIUMs: verification

- **M-01 (with SFH-M1 and SFH-M2): CLOSED.** `_counted_apply` raises `entry["applies"]` and stores the whole block through `_persist_apply_count` before `pacer.apply`.
  - A write that raises, and the fenced no-op (`_write_result` returns False), both raise the transient `fills_count_not_persisted`, and no POST is made.
  - Every path that reaches a POST now goes through `_counted_apply`: `failed`, no-entry with `prior == 0`, and the new dead-link branch.
  - A timeout, network error or cancellation after the POST can no longer lose the count, because it is already stored.
  - The fenced no-op is handled correctly: the claim belongs to another worker, this run POSTs nothing and returns FAILED transient, and the mark RPC is fenced on the same token.
- **SFH-M3 (rate-limit give-back): CLOSED as disposed.** `_counted_apply` restores `prior` and re-persists, then re-raises. If that re-persist fails, the stored count stays raised and the claim ends `fills_count_not_persisted`. That is the conservative direction. The loop bound is L-R2-02 below.
- **M-02: CLOSED, with residual slack (L-R2-03).** Each target's rows are sorted newest first before batching, so a stopped write leaves the oldest fills unwritten. With the new cooldown, an exhausted `fills_write_failed` or `claim_budget_exceeded` no longer counts, so the next sync re-chains and the idempotent upsert completes the rest. `inserted` is set to None on a budget stop, and `inserted_before_failure=unknown` is computed only over targets processed so far. Both are correct.
- **M-03: CLOSED, but it introduces M-R2-01 together with the cooldown change.** The dead-link branch catches `_Stop("link_expired")` from `_ingest_quarter`.
  - It re-applies only when the cause is not `cause=network` and `entry["applies"] < FILLS_MAX_APPLIES_PER_QUARTER`. That bounds dead-link applies to 2 per quarter per job, minus any no-entry or `failed` apply already counted.
  - Otherwise the original stop propagates, and the claim defers.
  - The module docstring and runbook no longer claim reads cost no apply.
- **SFH-M4 / L-02 (cooldown predicate): CLOSED.**
  - The predicate takes the first whitespace token after `okx_archive_rebuild: ` and counts it only if it is not in `_UNANSWERED_STOP_CLASSES`. Every `_error_text` stop has that exact shape.
  - Dispatcher text (`classify_exception`), the reaper's `worker_stalled` and a blank `last_error` do not count.
  - A bare prefix splits to `[]` and does not count.
  - The transient half of the set is bound to the job sets by `test_cooldown_unanswered_classes_bind_the_job_sets`.
- **SFH-M5 and SFH-M6: CLOSED as disposed.** `not_performed` is used only when `plan.reconcile is None`. The SQLSTATE is logged only on a full `[0-9A-Z]{5}` match, and the message, details and hint are never logged.

### Medium Issues (round 2)

#### M-R2-01: After a dead-link exhaustion the chain re-chains every day, spending up to 2 applies per dead quarter each time (apply budget; not data-integrity; conditional on the same unmeasured premise as M-03)

**Files:**
- `analytics-service/services/okx_archive_fills_chain.py`: `_UNANSWERED_STOP_CLASSES` contains `"link_expired"`, which `_counts_toward_cooldown` skips.
- `analytics-service/services/okx_archive_fills.py`: `_read_and_gate`'s dead-link branch, where `_counted_apply(..., entry["applies"])` is followed by `raise` once the cap is reached.

**Issue:** The two fixes interact.

- **What topic A does.** A dead link now costs up to `FILLS_MAX_APPLIES_PER_QUARTER` (2) counted applies per quarter per job. After that the job stops with the transient `link_expired` and retries until `failed_final`.
- **What topic B does.** It removed `link_expired` from the cooldown, so that `failed_final` no longer counts.
- **Result.** The next daily sync re-chains a new `fills_apply`. Its per-job count starts at 0, so it spends up to 2 more applies per dead quarter. This repeats every day for as long as the link stays dead: up to 4 quarters x 2 = 8 of the account's 12 applies a day, for up to about 30 days.
- **The OKXHISTORY daily-returns rebuild is also starved.** It shares the same per-user budget.

In round 1 the same exhaustion counted toward the cooldown, so it cost nothing for 14 days.

**When this happens.** The loop needs the world M-03 was written for: OKX keeps serving a dead link after a re-apply. That is plausible. OKX documents that a quarter applied within 30 days "don't need to apply again", so the re-apply most likely answers `result: true` (existing) without regenerating. If a GET does not refresh the link (RESEARCH A4), the re-apply changes nothing and the job exhausts.

In the opposite world, where a GET or a re-apply does give a live link, `link_expired` never exhausts, and making it count costs nothing. The fix is therefore safe in both worlds.

`test_dead_link_on_a_finished_quarter_reapplies_once_counted` already shows the exhaustion within one job (two applies, then `link_expired`). No test covers the next sync's chain verdict after that `failed_final`.

**Fix (minimal):** let an exhausted `link_expired` count toward the cooldown. A dead link that survived the per-job re-applies is OKX's answer, not a partial write a retry can resume. Remove `"link_expired"` from `_UNANSWERED_STOP_CLASSES`, and have the binding test compare against `(TRANSIENT_STOP_CLASSES | FILLS_TRANSIENT_STOP_CLASSES) - {"link_expired"}` plus `invalid_input`:

```python
_UNANSWERED_STOP_CLASSES: Final = frozenset(
    {"invalid_input", "live_fetch_failed", "claim_budget_exceeded",
     "fills_write_failed", "fills_count_not_persisted"}
)
```

M-02 does not depend on this class: its re-chain rides on `fills_write_failed` and `claim_budget_exceeded`.

### Low Issues (round 2, recorded only)

#### L-R2-01: Runbook §1 still says "at most twice ever"

Round 1's L-04 is still open, and the fix report says so. Since topic A, a dead link can also spend one of the two applies.

#### L-R2-02: The rate-limit give-back has no per-job bound

**File:** `okx_archive_fills.py` `_counted_apply` (the `except (ccxt.RateLimitExceeded, ccxt.DDoSProtection)` arm).

OKX's 12-a-day apply cap is itself a rate limit, and ccxt maps OKX's rate-limit refusal to `RateLimitExceeded`. Once an account's daily applies are spent, a quarter that needs one is re-POSTed on every claim, which is every `RATE_LIMIT_DEFER_S` (15 min), and each refusal gives the count back.

The 24 h backstop bounds this at about 96 refused POSTs per quarter. Refused POSTs create no request, so nothing is generated or written. The risk is unmeasured: if OKX counts refused attempts against its rolling window, these retries hold the account at the cap for the job's whole life, starving the rebuild's applies as well.

Fix if wanted: give the count back at most once per quarter per job, for example a `rate_limited` flag in the block. A second refusal then stays counted.

#### L-R2-03: Newest-first narrows M-02 but leaves up to 2 days of history unrecoverable

**File:** `okx_archive_fills.py` `_write_fills`; `okx_archive_fills_chain.py` (`fill_ms <= anchor_ms + REACH_SLACK_MS`).

If a write stops when every unwritten row lies within `REACH_SLACK_MS` (2 days) of the anchor, the earliest stored fill can already fall inside the slack. The chain then answers `fills_reach_anchor` and never completes those rows. This is the same slack the trigger accepts by design. Only an unlucky partial write lands there.

### Round 2 verdict

M-01, M-02, M-03 and every SFH MEDIUM are closed. One new MEDIUM came from the interaction of the two topic fixes: M-R2-01, a one-line set change. It is apply budget only (not data-integrity, not user-facing), and its trigger is the unmeasured OKX premise M-03 was written for.

---

_Round 2 reviewed: 2026-11-28_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

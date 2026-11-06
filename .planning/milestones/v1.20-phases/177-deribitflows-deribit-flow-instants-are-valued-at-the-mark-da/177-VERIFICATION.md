---
status: passed
verified_at_sha: 8e25f31e9d710d1690cb69d19033302eeffa2a57
drift_subjects:
  - analytics-service/services/deribit_flow_prices.py
  - analytics-service/services/flow_price_store.py
  - analytics-service/services/deribit_ingest.py
  - analytics-service/services/native_nav.py
  - analytics-service/services/nav_marks_apply.py
  - analytics-service/services/external_flows.py
  - analytics-service/services/job_worker.py
  - supabase/migrations/20261101120000_api_key_flow_prices.sql
  - supabase/migrations/down/20261101120000-rollback.sql
  - supabase/tests/test_api_key_flow_prices.sql
  - analytics-service/tests/test_nav_marks_compose_roundtrip.py
  - analytics-service/tests/test_flow_price_store.py
---

# Phase 177: DERIBITFLOWS Verification Report

**Phase Goal:** A Deribit deposit or withdrawal moved onto a neighbouring mark day is valued at the open of the `{CCY}_USDC-PERPETUAL` 1-minute candle that contains the flow, never at its own day's ledger mark; each resolved price is stored once and reused, so an old flow is never re-read.
**Verified:** 2026-10-28, at the commit named in the frontmatter
**Status:** passed
**Re-verification:** No, initial verification

Scope note: the commits since `b2daab890` (the MARKSOURCE merge this branch sits on) are the phase's. The diff of the non-planning files against that commit is 28 files, all of them phase 177's.

## Evidence run in this verification (not taken from SUMMARY files)

| Check | Result |
|---|---|
| The nine decisive pytest files, run from `analytics-service/` with `-p no:cacheprovider` | 377 passed, 0 failed |
| CI's mypy line, verbatim (`--strict --follow-imports=silent`, all CI paths) | `Success: no issues found in 129 source files` |
| Vitest census files `ci-anti-skip-gate.contract`, `mutation-runner-floors`, `drift-check-scripts` | 3 files, 1073 tests passed |
| `node scripts/mutation-runner/run.mjs --file supabase/tests/test_api_key_flow_prices.sql` on a real throwaway lane | 13 of 13 arms executed, 13 of 13 bite (each goes RED with its own arm named), 0 waived, no defects in scope; restore leg exit 0 |
| Worktree after all runs | `git status` empty (nothing in the tree was edited) |

### The RED oracle can fail (scratch copy of `analytics-service/`, tracked files untouched)

| Mutation in the scratch copy | Result |
|---|---|
| `native_nav.native_flow_instants` stops setting `amount_prior_day` (own-day pricing) | `test_deribit_moved_btc_flow_priced_at_the_instant_price` goes RED: obtained 0.019146029 (= 22.42/1171, the own-day figure), expected 0.019573015 (= 22.92/1171). The neighbouring D-23 test, which moves a USDC flow, stays green, so the mutation bites only the moved-BTC case. |
| `resolve_moved_flow_prices` no longer records `no_data` on a structural answer | 5 RED: the key-mode `no_data_status`, `bad_symbol` and `nan_open` refusal arms, the strategy-mode refusal and the composite-member refusal |
| The reader stops re-raising a last-attempt 429/DDoSProtection, and the store lookup is bypassed (every minute re-read) | 8 RED: both reader re-raise tests, both `_stamp_429` tests, the three store-reuse tests and the store-before-next-group test |

The oracle's expected value is independent arithmetic: base 1071.0 + 100.0 = 1171.0, counted 0.0005 x 101_000.0 = 50.5, r = (1244.42 - 1171.0 - 50.5) / 1171.0 = 22.92 / 1171. The 00:04 and 00:06 neighbour candles open at 100_900.0 and 101_100.0, so an adjacent-candle rule is also distinguishable.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | The SQL upper bound is recorded (D-01) and the derive logs one counts-only line of the Deribit flows its marks moved | VERIFIED | The upper bound is in `177-CONTEXT.md` (D-01: 16 marks, 8 keys, read-after-midnight stats, counts only). `job_worker.py` logs `deribit flows moved by marks (moved= at_instant= usd_family= on_last_mark= mode=)` in the derive and `run_stitch_composite_job: deribit flows moved by marks (seq= ...)` per composite member. The fields are integers from `moved_flow_counts`; no key id, amount or instrument. Tests `test_deribit_flows_moved_log_key_mode`, `..._at_zero`, `..._strategy_mode` and the composite and allocated-member log tests pass. The post-deploy reading of the real count is an orchestrator step after merge (CONTEXT deferred), not a gap. |
| SC-2a | A moved Deribit flow is priced at the open of the `{CCY}_USDC-PERPETUAL` 1-minute candle containing it, never at its own-day ledger mark | VERIFIED | `fetch_deribit_perp_minute_prices` reads `get_tradingview_chart_data` with `resolution=1` for `perp_minute_instrument(ccy)` and returns `open`; `price_for_minute` takes the containing minute only (`at_ms - at_ms % 60000`). `native_flow_instants(at_instant_index=...)` sets `amount_prior_day = qty x price`; `amount` stays the own-day value that leaves the read day. `apply_marks` rule 10 counts `amount_prior_day` in the mark day and `amount` out of the next day, through the one shared predicate `placed_flow_instants`. Behaviourally proven by the oracle (RED on own-day pricing, shown above) in key mode, strategy mode, the allocated twin, a plain composite member and an allocated composite member. |
| SC-2b | No fallback on a failed read: structural no-data refuses `mark_flow_index_unavailable` | VERIFIED | `DeribitChartNoDataError` (BadSymbol, BadRequest, `no_data` body, malformed or repeated tick, non-finite or non-positive open, no candle in the containing minute) fills `no_data`. `_deribit_moved_flow_gate` returns `_MARK_FLOW_INDEX_UNAVAILABLE` and the caller takes the existing nav-marks refusal road, which writes nothing. Composites raise `_MemberFlowIndexUnavailable` and refuse by name. Mutation 2 above turns 5 of these tests RED. |
| SC-2c | A transient read retries | VERIFIED | Any other venue exception, or a flaky 200 body, is retried on one budget and then raises `DeribitTransientReadError`; the derive captures it, keeps the day's mark, and the gate returns a `FAILED`/`transient` result. A prediction miss and a below-floor timeout take the same road. A store fault is `FlowPriceStoreError`, also transient. Tests `..._plain_exchange_error_is_transient_not_a_refusal`, `..._store_fault_is_transient_and_keeps_the_mark`, `..._prediction_miss_is_a_retry` and the composite transient and store-fault tests pass. |
| SC-2d | A 429 reaches `_stamp_429` | VERIFIED | The reader re-raises `RateLimitExceeded` and `DDoSProtection` unwrapped on the last attempt (a deliberate deviation from the sibling readers, which wrap it). The key-mode and strategy-mode prefetch catches both and calls `_stamp_429` once; the composite member arm now catches `(RateLimitExceeded, DDoSProtection)` and stamps the member key. Mutation 3 above turns both reader tests and both stamp tests RED. |
| SC-3a | Each resolved price is stored once in a service-role-only table with RLS forced and an erasure path | VERIFIED | The migration creates `public.api_key_flow_prices`: primary key `(api_key_id, instrument, minute_ms)`, named value CHECKs (instrument pattern, minute multiple of 60000, price finite and positive, closed `source`), `api_key_id ... ON DELETE CASCADE` from `api_keys` (the erasure path), RLS enabled and forced with zero policies, `REVOKE ALL` from PUBLIC, anon, authenticated and service_role, then `GRANT SELECT, INSERT` to service_role only (write-once is the grant). Catalogue-only verify block, no data census (safe on empty TEST). Rollback renames aside and keeps the rows. The SQL gate has 13 annotated arms; all 13 bite on a real lane in this verification. |
| SC-3b | A stored price is reused by later derives, so an old flow is never re-read | VERIFIED | `resolve_moved_flow_prices` reads the stored prices first, groups only the minutes not stored, reads the venue only for those, writes each group as soon as it is read (`ON CONFLICT DO NOTHING` via `upsert(ignore_duplicates=True)`), re-selects, and builds the index from the STORED rows, so a concurrent writer's price wins. `test_flow_price_store_second_derive_reads_no_chart`, `..._seeded_price_wins_over_the_chart` and `..._only_missing_minutes_are_read` pass and go RED when the store lookup is bypassed. Strict parse raises on any malformed, out-of-chunk, wrong-instrument or wrong-source row (never skipped). |
| SC-3c | migration-reviewer and rls-policy-auditor clean before merge | VERIFIED (attested, not re-run) | Taken from the orchestrator's brief: both returned CLEAN on 2026-10-28. This verification did not re-dispatch them. Independently, I read the migration against the stated invariants (no explicit transaction statements, `SET LOCAL lock_timeout`, no function replaced so no re-base is owed, no delete-guard trigger so the sanitize exemption is not needed, no data-reading block) and found nothing contrary. |

**Score:** 9/9 truths verified (0 behaviour-unverified; the one attested item, SC-3c, is a process gate, not a code behaviour)

### Founder decisions

| Decision | Status | Evidence |
|---|---|---|
| D-01 SC-1 measurement | VERIFIED | Upper bound recorded in CONTEXT; counts-only log line implemented and tested at key, strategy and composite level |
| D-02 price at the flow's own moment, never the own-day mark | VERIFIED | See SC-2a; `amount_prior_day` carries the instant price, `amount` the own-day leaving amount |
| D-03 ship whatever the count, with a test RED on own-day pricing | VERIFIED | The RED oracle fails under mutation 1 with the own-day figure |
| D-04 candle open of the containing 1-minute `{CCY}_USDC-PERPETUAL` candle | VERIFIED | `perp_minute_instrument`, `resolution="1"`, `open`, minute-floor lookup; the neighbour-candle values in the oracle rule out an adjacent-candle read. The module docs call it the perpetual's traded price, never the index |
| D-05 no fallback; store once; service-role-only, cascade erasure; reviewers clean | VERIFIED | SC-2b/c/d, SC-3a/b/c |

### Required Artifacts

| Artifact | Status | Details |
|---|---|---|
| `analytics-service/services/deribit_flow_prices.py` | VERIFIED | Substantive (264 lines), imported and called from `job_worker.py` at the prefetch, the coverage gate, the log line and the composite member helper |
| `analytics-service/services/flow_price_store.py` | VERIFIED | Substantive, called through `db_execute` from `resolve_moved_flow_prices`; table name and source constants single-sourced |
| `analytics-service/services/deribit_ingest.py` (minute reader) | VERIFIED | `fetch_deribit_perp_minute_prices`, `price_for_minute`, `DeribitChartNoDataError`, `perp_minute_instrument` all used |
| `analytics-service/services/nav_marks_apply.py` (`placed_flow_instants`) | VERIFIED | One predicate shared by `apply_marks`, the prefetch and the coverage check; unit test `test_placed_flow_instants_is_what_apply_marks_moves` |
| `supabase/migrations/20261101120000_api_key_flow_prices.sql` + rollback | VERIFIED | As SC-3a |
| `supabase/tests/test_api_key_flow_prices.sql` | VERIFIED | 8 sections, 13 annotated arms, all bite |
| `src/lib/database.types.ts` (hand-added type) | VERIFIED | Present; typecheck and census suites green per the vitest run |
| `.github/workflows/ci.yml` roster, `scripts/mutation-floors.mjs` | VERIFIED | Roster row and `SENTINEL_FLOOR=26` / `ARMS_FLOOR=394`; the census contract tests pass at this commit |

### Key Link Verification

| From | To | Status | Details |
|---|---|---|---|
| Deribit derive crawl (exchange still open) | `resolve_moved_flow_prices` | WIRED | Prefetch runs before the `finally` that closes the exchange; asserted by the chart event order (`chart` before `close`) in the oracle |
| Prefetch (predicted marks) | Apply seam (final marks) | WIRED | `_deribit_moved_flow_gate` runs `unpriced_moved_flows` on the final marks at all three Deribit seams (key writer basis, strategy mode, allocated twin); a prediction miss is a transient retry, never the own-day amount |
| `resolve_moved_flow_prices` | `api_key_flow_prices` | WIRED | Read-before-venue, write-per-group, re-select; strict parse |
| Composite Deribit members (plain and allocated twin) | `_member_moved_flow_index` | WIRED | Exact marks, member exchange still open; no-data refuses the composite, 429 stamps the member key, transient and store fault take the existing arms |
| `FlowInstant.amount_prior_day` | `apply_marks` rule 10 | WIRED | Counted in the mark day, `amount` leaves the read day; the oracle shows 03-11 nets to 0.0 and the compose lands on every mark |

### Data-Flow Trace (Level 4)

The price flows from the (mocked in tests, real in production) `get_tradingview_chart_data` response, through the store re-select, into `at_instant_index`, `amount_prior_day`, `apply_marks` and the stored key-inputs flows. The oracle asserts the stored composed flow for the mark day (50.5) and 0.0 on the read day, so a hollow or static price cannot pass. The one link no test here exercises against a real database is the PostgREST round trip of the store (`test_flow_price_store_live.py`, which needs a live stack and was not run here). The SQL gate proves the table's behaviour on a real PostgreSQL lane.

### Behavioral Spot-Checks and Probe Execution

The behavioural evidence is the 377-test run and the three mutation runs above. No `probe-*.sh` is declared by this phase's plans (Step 7c: not applicable).

### Requirements Coverage

The phase carries no requirement IDs (TBD in the ROADMAP). SC-1..SC-3 and D-01..D-05 are covered above. There are no orphaned requirements.

### Anti-Patterns Found

Debt-marker scan (`TBD|FIXME|XXX`) over the added lines of the phase's source diff found none. No home paths, CI-skip tokens or authorship trailers in the phase's diff or commit messages; `TODOS.md`, `CHANGELOG.md`, `VERSION` and `package.json` are untouched by the phase's non-planning diff (the release bookkeeping is the orchestrator's ship step).

### Known limits carried from review (LOW/INFO, none MEDIUM+; recorded, not gaps)

The round-3 review (`177-REVIEW.md`) has no MEDIUM+ open. Items still carried, none blocking:

- IN-10 (LOW, user-facing): a key whose crawl always leaves less than the 10 s floor never reads a NEW moved-flow price and retries as `timeout` on every derive. Already-stored prices still complete from the store.
- IN-13 (LOW, data-integrity): below the floor, the 10 s store-read bound is charged against the post-crawl reserve. Narrow: it needs a hung store read and 80-90 s of reserve left unspent.
- IN-14 (LOW): a non-ccxt exception in the transient bucket is a WARNING (a Sentry breadcrumb), not an event.
- Accepted limit recorded in `job_worker.py`: a minute where the perpetual printed no candle has no price to store, so it refuses `mark_flow_index_unavailable` on every derive until support acts. There is no override in this phase (D-05). The user-facing copy for that refusal says support must resolve it.
- IN-07, IN-08, IN-09, IN-11, IN-12, IN-15 and IN-01..IN-06: comments, wording and test-realism notes.

## Human Verification Required

None for this phase. The orchestrator steps that remain are outside the verdict: reading the real moved-flow count off the new log line after the next nightly derives (CONTEXT deferred), and the usual ship and post-merge checks.

## Post-deploy reading (2026-10-29)

Taken by the orchestrator from the Railway deploy logs of the backfill worker, window 2026-10-29 00:48Z to 01:30Z, after v0.133.8.0 (PR #1145, merge d9b69ca76) deployed and migration 20261101120000 applied to TEST and PROD (Supabase Migrate run 40722154656). Counts only, verbatim log lines.

- Eight lines `derive_broker_dailies: deribit flows moved by marks (moved=0 at_instant=0 usd_family=0 on_last_mark=0 mode=key)`.
- No `run_stitch_composite_job: deribit flows moved by marks` line appeared in that window.

SC-1's measured value: on the first night after deploy no Deribit flow was moved onto a neighbouring mark day (`moved=0` in all 8 derive runs). The fix is in place, and its test goes RED on own-day pricing (`test_deribit_moved_btc_flow_priced_at_the_instant_price`, mutation 1 above; 177-01-SUMMARY; `analytics-service/tests/test_nav_marks_compose_roundtrip.py`). The count is one night's reading, not a rate: it says nothing about nights on which a Deribit flow lands within the read-after-midnight window. SC-1 stays VERIFIED, since it asked for the count to be recorded and the line to exist, and the status above is unchanged.

## Gaps Summary

No gaps. Every must-have resolves to VERIFIED. The decisive evidence is behavioural: the moved-BTC oracle fails with the own-day number when the pricing is neutered, the no-data, 429 and store-reuse tests each fail when their rule is removed, and the SQL gate's 13 arms each bite on a real PostgreSQL lane.

---

_Verified at the commit named in the frontmatter._
_Verifier: Claude (gsd-verifier)_

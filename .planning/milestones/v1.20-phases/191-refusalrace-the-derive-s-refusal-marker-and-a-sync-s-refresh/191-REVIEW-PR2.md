---
phase: 191-refusalrace-the-derive-s-refusal-marker-and-a-sync-s-refresh
reviewed: 2026-11-05T00:00:00Z
depth: deep
scope: "git diff 9fa001a57..HEAD -- . ':(exclude).planning' (PR 2, plans 191-06..09)"
files_reviewed: 13
files_reviewed_list:
  - .github/workflows/ci.yml
  - TODOS.md
  - analytics-service/services/ingestion/long_fetch.py
  - analytics-service/services/job_worker.py
  - analytics-service/tests/test_compute_job_metadata_merge_live.py
  - analytics-service/tests/test_compute_job_metadata_merge_parity.py
  - analytics-service/tests/test_derive_broker_dailies_dualmode.py
  - analytics-service/tests/test_ledger_refresh_reuse_collision.py
  - src/__tests__/audit-coverage.test.ts
  - src/app/api/keys/sync/route.test.ts
  - src/app/api/strategies/finalize-wizard/route.test.ts
  - src/lib/ledger-refresh-marker.test.ts
  - src/lib/ledger-refresh-marker.ts
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 191: Code Review Report (PR 2, plans 191-06 to 191-09)

**Reviewed:** 2026-11-05
**Depth:** deep
**Files Reviewed:** 13
**Status:** issues_found (one MEDIUM, two below the reporting threshold)

## Summary

I read the three callers against the live SQL bodies in
`supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql`, the route call sites
(`src/app/api/keys/sync/route.ts:406`, `src/app/api/strategies/finalize-wizard/route.ts:2343`), the
Python caller of the retraction (`long_fetch.py:731-776`), `_stamp_io` and
`_READ_PROGRAMMING_ERRORS`, the conftest xdist grouping, and `run.sh --assert-local-handoff`.

What holds up:

- **Return shapes.** postgrest-py builds the rpc response with `SingleAPIResponse.model_construct(data=request_response.json())`, and this repo's installed copy (2.31, pin 2.33) does the same. So a `boolean` function answers a Python `True`/`False` and a `jsonb` function answers a `dict`, with no list wrapping and no validation step. supabase-js answers the scalar or object as-is. The live probe's PostgREST case also pins both shapes by the services' own constants.
- **D-07.** `_mark_job_kept_figures` accepts only `_answer is True`. Everything else raises `RuntimeError`. That is not in `_READ_PROGRAMMING_ERRORS`, so `_stamp_io` files it as `StampIOUnavailable` (TRANSIENT) before the error-only upsert. Nothing unconfirmed is treated as written. The unit test parametrises `False`, `None`, `1` and `"true"` and asserts no sentence and no second write.
- **Outcomes and log lines.** These are unchanged apart from D-08. `retracted` gives a WARNING line, a `done` job with a marker gives an INFO skip, and a `done` job without a marker or a `no_marker` answer stays quiet, all as before. `no_row` is now ERROR plus one tagged Sentry capture (D-08). The log keys are the same; the values are now `None`. TypeScript keeps its return union, its throw-on-`no_row`, and its `cause` and `retractionFailureCode` contract. An unknown or non-object answer throws in both languages, so no unreadable answer passes as "nothing to retract".
- **The live probe really races.** Connection A holds the row lock in an open transaction. A third connection must see B's `wait_event_type = 'Lock'` before A commits, otherwise the test fails, and a B that finishes early fails it too. The control case shows the harness can see a lost write. The module is in the `shared_test_db` xdist group: it contains `SUPABASE_TEST_URL`, `_need_supabase` and `live_db_transport`, so it runs serially with the other live modules. Under `CI=true` it fails rather than skips when `LANE_DB_URL` or the PostgREST variables are missing.
- **The ci.yml export.** `DB_URL` is read from the same file `--assert-local-handoff` has just checked (`run.sh:294-315`, which checks DB_URL as well). It is masked and exported as `LANE_DB_URL`, a name no psycopg module that reads shared TEST uses (`git grep` finds no other Python reader). It cannot point at shared TEST or PROD unless the lane's own guard is broken.
- **The tests can fail.** The route tests fail if the old read-modify-write comes back: the finalize-wizard double throws on a `compute_jobs` `maybeSingle` or update, and in keys/sync the removed branch would make `.select` undefined while `retractionCalls()` must equal one call. The audit-coverage pin fails if the allowlist entry is lost or the literal turns into a constant.

I ran these locally and they passed: 101 pytest cases (parity, the probe offline with 4 skips, reuse-collision, the derive refusal subset) and 76 vitest cases (helper, keys/sync).

One MEDIUM remains, in the probe's second safety layer.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: The probe's post-connect "is this the lane?" check accepts any private address, so it does not refuse the hosted-project case its own docstring says it refuses

**Severity:** MEDIUM (BLOCKER-class topic, since the probe writes `auth.users`, `strategies` and `compute_jobs`, but the probability is low)
**File:** `analytics-service/tests/test_compute_job_metadata_merge_live.py:111-133` (`_server_addr_is_lane`, `_require_lane_server`), and the test at `:173-180`

**Issue:** The second layer behind the loopback-DSN check passes any `inet_server_addr()` that is NULL, loopback or `ip.is_private`. The widening was needed because a docker-published lane reports its 172.x bridge address (191-09-SUMMARY deviation 1). But a hosted Postgres reached through a local tunnel or a connection pooler also reports the address the server holds inside its own network. On a cloud VPC that is normally an RFC1918 address (10.x or 172.x), which this check accepts. The docstring says *"so a DSN that is loopback only by an SSH tunnel to a hosted project would still be refused"*. `test_server_address_guard_accepts_docker_bridge_and_refuses_public` only proves that hand-picked public literals are refused. It never establishes that a hosted project reports a public address, so the claimed protection is unproven and probably absent.

Today the only real control is the DSN host check (layer one). That check is sound, but it is defeated by exactly the case layer two claims to cover: a developer exporting `LANE_DB_URL` as `postgresql://…@127.0.0.1:<tunnel-port>/postgres`. In that case the probe inserts into `auth.users`, `profiles`, `strategies` and `compute_jobs` on whatever database is behind the tunnel. It also never runs the identity check CLAUDE.md names as the only valid proof of which database you are on ("`current_database()` … proves nothing. Neither does a green query"; run the `shobj_description(... 'pg_database')` marker first).

CI is not exposed: there, `LANE_DB_URL` comes from the asserted handoff. The exposure is a developer's local run.

**Fix:** Replace or augment the address heuristic with the repo's own database-identity marker. Shared TEST and PROD each carry a hand-set `COMMENT ON DATABASE`. The lane loads a schema-only dump of `public`, which does not carry a database comment, so it has none. Refuse to write unless the marker is NULL, and correct the docstring:

```python
def _require_lane_server(conn: psycopg.Connection) -> None:
    marker = conn.execute(
        "SELECT shobj_description(oid, 'pg_database') FROM pg_database "
        "WHERE datname = current_database()"
    ).fetchone()[0]  # type: ignore[index]
    if marker is not None:
        pytest.fail(
            "test_compute_job_metadata_merge_live refuses to write: this database carries a "
            f"hand-set identity marker ({marker!r}); the local-stack lane carries none.",
            pytrace=False,
        )
    addr = conn.execute("SELECT inet_server_addr()").fetchone()[0]  # type: ignore[index]
    if not _server_addr_is_lane(addr):
        pytest.fail(...)
```

Measure on a booted lane first that the marker query returns NULL there, then keep a can-fire test for it in the same way as the existing guard tests.

## Info (below the MEDIUM+ reporting threshold, recorded only)

### IN-01: Two "can go red" parity tests cannot fail

**File:** `analytics-service/tests/test_compute_job_metadata_merge_parity.py:113-116`, `:146-149`
**Issue:** `test_a_misspelled_rpc_constant_would_not_match_the_snapshot` asserts `[name] != [CONST + "x"]` where `name == CONST`, which is true by construction. `test_a_misspelled_key_is_absent_from_both_snapshots` asserts that two invented misspellings are absent from the files, which can only fail if someone writes that exact typo. Neither shows the real pin can fail. The real pins (`test_rpc_name_constants_equal_the_snapshots_function_names`, `test_refusal_marker_key_literal_matches_the_constant_and_both_snapshots`) can fail, and the 191-09 summary records a neuter that turned the name pin RED. So these two are decorative, not a gap.
**Fix:** Delete them, or rewrite them in the widened-copy shape the other pins use: mutate a copy of the snapshot and run the same comparison function against it.

### IN-02: The control test's cleanup can run under `service_role` and mask the original failure

**File:** `analytics-service/tests/test_compute_job_metadata_merge_live.py:362-388`
**Issue:** `admin.execute("SET ROLE service_role")` is undone by `RESET ROLE` only on the success path. If the `is True` assertion between them fails, `_cleanup` deletes from `auth.users` and the other tables as `service_role`. That delete can be refused, which replaces the real assertion with a privilege error and leaves the seeded rows on the throwaway lane.
**Fix:** Run `admin.execute("RESET ROLE")` at the top of the `finally`, or call the marker on a separate connection as the race cases do.

---

_Reviewed: 2026-11-05_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Round 2 (2026-11-05)

**Scope:** `git diff 9fa001a57..HEAD -- . ':(exclude).planning'` at `1b0ea4a07`. The new code is fix commits `837658499` (SFH M-1) and `1b0ea4a07` (WR-01). Since round 1 they touch three files: `long_fetch.py`, the live probe, and `test_ledger_refresh_reuse_collision.py`.
**Result:** CLEAN at MEDIUM and above. WR-01 and M-1 are fixed. Nothing regressed.

### WR-01: fixed

- **What changed.** `_require_lane_server` (`test_compute_job_metadata_merge_live.py:143-153`) now ends in `_require_stock_database_comment` (`:124-140`). That function runs the CLAUDE.md identity query and calls `pytest.fail` unless the answer is exactly `default administrative connection database`.
- **Why it now stops PROD and TEST.** Both carry a hand-set comment naming themselves, so neither can pass. A lost marker (NULL) is refused too.
- **Every write is behind it.**
  - Each psycopg connection goes through `_connect` → `_require_lane_server`, including the seeding `admin`, the three `_race` connections, the control's `reader` and the schema-reload connection.
  - The PostgREST half seeds only through `_connect`. Its rpc calls on an unknown id change no row.
- **The check can fail.** `test_database_comment_guard_accepts_only_the_stock_lane_comment` refuses a self-naming comment, NULL and `""`. The address test's docstring no longer claims the tunnel protection.
- **Residual, INFO only.** The allowlist is the Postgres stock comment, so any other un-commented database behind a localhost tunnel would still pass. PROD and TEST cannot, which is the guard's purpose. This is not an identity proof for an arbitrary third database.

### SFH M-1: fixed

- **What changed.** `long_fetch.py:140-180` wraps three things in one `try`: the rpc call, the non-object check and the unknown-outcome check. On failure the helper:
  - logs `process_key_long.refresh_marker_retraction_failed` with `error_type` and a scrubbed, truncated `error` (`scrub_freeform_string` exists at `services/redact.py:279`);
  - makes one Sentry capture with a static message and the ids as tags (`compute_job_id`, `refresh_marker`, `error_type`);
  - returns without raising.
- **Sentry is contained.** A Sentry failure is caught and logged as `refresh_marker_retraction_sentry_failed`.
- **Other outcomes are unchanged.** `retracted`, `done`, `no_marker` and `no_row` are still handled after the `try`, exactly as in round 1.
- **No propagation change.** Every exception here was already caught by the caller's broad `except` (`:766-773`). Only the label and the capture differ.
- **Tests.**
  - The helper-level parametrised case covers an rpc raise, a non-object answer and an unknown outcome. It asserts the event, `error_type`, one capture and that the id is a tag, not part of the message.
  - An end-to-end case through the real `run_process_key_long_job` asserts the job ends `DONE`, the new event appears, `enqueue_tail_failed` does not, and there is exactly one capture.
  - `test_long_fetch_follow_on_guard.py`'s `enqueue_tail_failed` pin is on an enqueue failure, not a retraction, so it is unaffected.

### Regression check

- **Tests run locally:** parity, live probe (offline, 4 skipped), reuse-collision and follow-on-guard: 81 passed, 4 skipped.
- **Untouched since round 1:** the marker path (`job_worker.py`), the TypeScript helper, the route tests, `ci.yml` and `TODOS.md`. I re-read the diff stat for `c07259b82..HEAD`.
- **Narrower parametrisation, INFO only.** The non-object cases dropped from the parametrisation are `[]`, `"retracted"` and `True`. They take the same `isinstance(answer, dict)` arm as the `None` and list cases that stay, so no branch lost coverage.

Round-1 IN-01 and IN-02 are still open and below the threshold.

_Round 2 reviewed: 2026-11-05 · Reviewer: Claude (gsd-code-reviewer) · Depth: deep_

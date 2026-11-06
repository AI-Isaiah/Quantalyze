---
phase: 178
slug: okxrewrite
status: secured
verdict: SECURED
asvs_level: 1
block_on: high
threats_total: 30
threats_closed: 30
threats_open: 0
audited_at_head: c7433e7ef
audited_base: 3b065928f
---

# Phase 178 OKXREWRITE: Security Audit

Scope: code and runbook diff `3b065928f..HEAD` outside `.planning`, plus the declared mitigations of plans 03 and 04 as written (the operator has not run them). Read-only audit: no PROD, TEST, Railway or `supabase --linked` access, nothing patched.

Verdict: **SECURED**. 30 of 30 threats closed (25 mitigate, 5 accept), 0 open, 0 unregistered flags.

Evidence run at HEAD: `pytest tests/test_reconstruct_whole_account.py tests/test_allocator_history_probe.py` 246 passed; `vitest marksource-okx-census-sql.test.ts` 142 passed; `vitest marksource-okx-nonworking-keys-exec.test.ts` 35 passed.

## Threat verification

| Threat | Plan | Sev | Disp | Status | Evidence |
|---|---|---|---|---|---|
| T-178-01 | 01 | high | mitigate | CLOSED | `_select_account_crawl_keys` (`equity_reconstruction.py` ~2701-2785) skips a dead group, counts it (`non_working_excluded`), never silently; the count reaches the audit as `account_non_working_accounts_excluded` (~7115) and the probe record. Working unreadable venue still refuses (line 2763/2765). All-dead book refuses `account_key_not_working` (2777). Tests `test_a_dead_exchange_account_is_skipped_and_counted`, `test_select_refuses_an_exchange_account_no_rebuild_can_read`. Write-side pre-checks (P7, B'3a, B'5 rules 5/6) closed under T-178-06/15/24. |
| T-178-02 | 01 | med | mitigate | CLOSED | Selection works on `api_keys` rows only; sessions are opened only for `selected` keys (~6350-6365), so a skipped group's key is never decrypted. Pinned by `_assert_no_venue_call(exchange_2, "the dead account's exchange")` (test line 1782) and probe `decrypt_calls` asserts. |
| T-178-03 | 01 | med | mitigate | CLOSED | Literal raises: `account_key_venue_unsupported` x2 (2763, 2765), `account_key_not_working` x1 (2777). `FORCED_REBUILD_ACCOUNT_REASONS` untouched by the diff. |
| T-178-04 | 01 | low | mitigate | CLOSED | Probe key `non_working_accounts_excluded` added to `ACCOUNT_RECORD_KEYS`, validator `_is_count`, emitted only via `emit_record` -> `validate_record`. Audit key is an integer. |
| T-178-05 | 02 | high | mitigate | CLOSED | `okx-nonworking-keys.sql`: no write word or `--` (grep clean); vitest `WRITE_WORDS` whole-word ban, one-statement and uuid guards pass. Executed only on a throwaway cluster (exec test, 35 passed). |
| T-178-06 | 02 | high | mitigate | CLOSED | P7 grouping mirrors `account_groups` (recursive `reach`), `deciding` members, window 90/730, `key_digest`. Exec test covers the cases named; enqueue and crosswalk carry the key-group block byte for byte (vitest). B'5 rules 5/6 STOP on a mismatch or NULL (runbook ~1048-1066). |
| T-178-08 | 02 | med | mitigate | CLOSED | Added lines scanned: no uuid except synthetic `00000000-...-0003` test fixture, no home path, no `.planning` path, no 10+ digit id (only synthetic hex digests), no credential patterns. Runbook vitest forbids uuid, an absolute home-directory path, planning path. |
| T-178-07 | 05 | med | mitigate | CLOSED | `crosswalk` form (runbook ~321) computes both labels in one statement with fingerprint; covered by the census test file (142 passing). |
| T-178-23 | 05 | high | mitigate | CLOSED | `crosswalk` is excluded from the write form list; vitest requires one top-level SELECT with `marker_is_prod` first (runbook test lines ~340-375) and bans write words; `enqueue` is untouched in its guard. Executed on a local cluster only. |
| T-178-24 | 05 | high | mitigate | CLOSED | B'1 order and B'5 rules 5 (count equals P7, mismatch is STOP) and 6 (NULL is STOP) present in the runbook (~1048-1066); `account_key_not_working` listed record-only. |
| T-178-25 | 05 | med | mitigate | CLOSED | Rendered SQL and fixture live in scratch (`$HOME/.cache/...`, outside repo); marker text not in the runbook (it points to the manifest); runbook vitest forbids uuid/home/planning paths. |
| T-178-09 | 03 | high | mitigate | CLOSED (as written) | Plan 03 Task 1: background probe plus exec of normal start, restore at once, `worker-restored: yes` ordered before every Task 2 line, run window outside 23:30Z-02:15Z and the poll band, STOP if the worker does not return (plan lines 69, 92, 105). |
| T-178-10 | 03 | high | mitigate | CLOSED (as written) | Plan 03 prohibits any write and never renders `enqueue`; only read forms and census files (each vitest-guarded) run; `rebuilds-enqueued: 0` recorded and gated (plan lines 25, 131, 142). |
| T-178-11 | 03 | high | mitigate | CLOSED (as written) | `marker` form first as its own call, `which_database: PRODUCTION` gate; every runbook read form prints `marker_is_prod` first (vitest-enforced). |
| T-178-12 | 03 | med | mitigate | CLOSED (as written) | `contains-178-fix` needs ancestry and a `git grep`; import line recomputed from the deployed SHA; every record must carry `non_working_accounts_excluded` (the field exists in code, probe and record). |
| T-178-13 | 03 | med | mitigate | CLOSED (as written) | Crosswalk plus fingerprint with `ties`, equal-totals check and per-field d02 cross-check specified in plan 03. |
| T-178-14 | 03 | high | mitigate | CLOSED (as written) | Verify blocks in plan 03 carry the uuid gate `[0-9a-f]{8}-[0-9a-f]{4}-` and the `[0-9]{10,}` gate (plan lines 98, 135); `_usd` and row sets stay in scratch, deleted. |
| T-178-15 | 04 | high | mitigate | CLOSED (as written) | P7 re-run at B'3a is compared to the pre-flight file; the renderer refuses a re-run older than `MS_T0`; D-06 label excluded from `ms-labels`; B'5 STOP on audit-vs-P7 mismatch or NULL (code side verified). |
| T-178-16 | 04 | high | mitigate | CLOSED (as written) | GATES_OK step 4 requires `close_agrees` via `git grep` at the deployed SHA and equal tolerance values (plan 04 line 102). |
| T-178-17 | 04 | high | mitigate | CLOSED (as written) | D-04 gate: plan 08 SUMMARY on main, live slots from `state` form, write time after the hold and before 22:30Z, recorded in GATES_OK (plan lines 103, 117). |
| T-178-18 | 04 | high | mitigate | CLOSED | Enqueue form skips an account with a job open or created at or after `MS_T0` (verified in form SQL, `NOT EXISTS ... c.created_at >= __T0__`); B'3c new-job proof; one re-enqueue per token (runbook rule 3). |
| T-178-19 | 04 | high | mitigate | CLOSED | `enqueue` form opens with `DO $guard$` raising `IS DISTINCT FROM __MARKER__` (runbook ~693-697); vitest pins "starts with DO guard", "IS DISTINCT FROM" (NULL refuses), calls only `enqueue_compute_job`, no write words. Marker comes from the manifest via the renderer, never typed. `enqueue: marker_is_prod=1` gated in plan 04. |
| T-178-20 | 04 | high | mitigate | CLOSED (as written) | `rowdiff.mjs` (runbook B'6) computes `older_rows_changed`; B'5 rule 5 makes any non-zero a STOP; cross-checks in REBUILD_OK (plan 04 line 148). |
| T-178-21 | 04 | med | mitigate | CLOSED (as written) | `probe-current` requires `git diff --quiet` of the analytics tree or a complete re-probe with equal import line (plan 04 line 104). |
| T-178-22 | 04 | high | mitigate | CLOSED (as written) | uuid and 10+ digit gates in plan 04 verifies (lines 112, 148, 180), TODOS uuid gate, hygiene check before the records PR; scratch deleted and checked gone. |
| T-178-SC (x5) | 01-05 | low | accept | CLOSED | No package installed or upgraded in the diff (no manifest, lockfile or requirements change in `git diff --stat`). Accepted per plan. |


## Targeted checks requested

- **Forced rebuild guards.** `_crawl_whole_account` (~6325-6345) selects keys, computes the window, then refuses `account_keys_changed` if any of `expected_non_working_accounts`, `expected_window_days`, `expected_key_digest` is present and not the exact same type and value (a bool, float or string for an int refuses; a non-string digest refuses). It runs before any sibling session is opened, on every claim. The digest (`_account_keys_digest`) is pinned by a literal test and byte-matches the SQL block in `okx-nonworking-keys.sql` and `enqueue` (vitest). The persist half also refuses `account_keys_changed` when the working-key set moved since the crawl (~6920-6929). Residual by design, stated in the runbook: the guards bind the key set and working flags, not P7's stored-day inputs.
- **Metadata cannot bypass guards.** The expectation keys can only add refusals (absent means no expectation), so no value a caller sets loosens a check. `force_rebuild` itself is pre-existing (Phase 167.2.1.1). `enqueue_compute_job` (all signatures) is `REVOKE ALL ... FROM PUBLIC, anon, authenticated` and granted to `service_role` only (migration `20260420073003` line 518, `20260515210300` lines 230-235, baseline lines 18062-18063); `_enqueue_compute_job_internal` is service_role only. A non-service-role caller cannot supply the metadata at all. The live PROD ACL was not read (out of scope); repo evidence only.
- **No TEST/PROD mix-up on the enqueue.** The write form is gated by the in-form `DO $guard$` against the manifest's `database_marker`, with `marker_is_prod` also output; the marker is injected by `form.mjs`, which refuses a marker under 20 characters or containing `$m$`. A TEST-linked session raises before the second statement.
- **Renderer refusals** (`form.mjs`): `MS_LABELS` regex, `MS_T0` and `MS_DEPLOYED_AT` strict ISO Z with calendar round-trip, `__EXPECTED__` read from `p7-before-enqueue.csv` with mtime >= `MS_T0`, no quoted field, per-label `rebuild` / window 90 / numeric dead count / 32-hex digest, unresolved placeholder refusal. Covered by the exec test (render-refusal cases pass).
- **No `supabase --linked` in executor steps.** The only `--linked` is the runbook's operator `q()` helper (main checkout, standing PROD authorization, marker first). Plans 03 and 04 state "no dispatched executor runs any task" and plan 04 "no executor runs `supabase` with `--linked`".
- **Tracked text.** No uuid (aside from a synthetic all-zero test id), PROD id, home path, project ref, credential pattern or amount in the diff outside `.planning`; `.planning/phases/178-*` markdown scan: no uuid, no home path (only a 40-hex commit SHA in a SUMMARY).
- **Scratch.** Scratch lives under `$HOME/.cache/...` (an environment variable, not a literal path), outside the repo; plans 03/04 delete and verify removal; runbook line 77 states `_usd` columns and row sets are deleted after use.

## Non-blocking observations (no action required to ship)

1. The runbook's own text has no explicit scratch deletion command; deletion is in plans 03/04 tasks. Operators following only the runbook rely on line 77's prose.
2. The renderer's file-age check compares the DB clock `t0` against this machine's file mtime; skew larger than the minutes between `t0` and the P7 re-run refuses a fresh file (fails closed, loudly). Documented.
3. `_account_keys_digest` uses MD5 (`usedforsecurity=False`) as a change detector, not a security control; acceptable at ASVS L1.
4. Plans 03/04 mitigations are verified as written; whether the operator executes them is outside this audit and is covered by their own GATES_OK / REBUILD_OK / RECORDS_OK verifies.

## Unregistered flags

None. The three SUMMARY `## Threat Flags` sections (01, 02, 05) all state "None".

**threats_open:** 0

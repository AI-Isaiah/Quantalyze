---
phase: 230-mt5nightly-every-mt5-nightly-derive-ends-done-on-its-first-a
plan: 08
subsystem: ship preparation / operator docs
tags: [runbook, restamp, ship-records, validation-map, mt5d-02, mt5d-03]
requires:
  - phase: 230-03
    provides: docs/runbooks/mt5-clock-replay.md (the MT5D-03 half the ship records point at)
  - phase: 230-07
    provides: the live lane test; its lane evidence is CI's at the PR head SHA
provides:
  - "docs/runbooks/mt5-terminal-lease.md: what the lease is, caller behaviour, site-to-terminal map, six log events, rollback, post-deploy checks (a) to (d)"
  - "a dated CORRECTED note on the single-replica invariant in docs/runbooks/mt5-go-live.md"
  - "a rehearsed ship-time re-stamp checklist (14 files) and the ship records (1) to (7) below"
  - "230-VALIDATION.md: a row per task of plans 01 to 10, Wave 0 ticked, four manual-only rows"
affects: [230-09, 230-10, ship]
key-files:
  created:
    - docs/runbooks/mt5-terminal-lease.md
  modified:
    - docs/runbooks/mt5-go-live.md
    - .planning/phases/230-mt5nightly-every-mt5-nightly-derive-ends-done-on-its-first-a/230-VALIDATION.md
key-decisions:
  - "DEC-08-A The runbook documents SIX event_type values, not the plan's five: mt5_xlease_renew_failed exists in code (plan 02) beside the five the plan names."
  - "DEC-08-B Section 6 of the lease runbook is a pointer that deliberately does NOT contain plan 09's section title, so plan 09's own grep for that title cannot pass before plan 09 writes it."
  - "DEC-08-C The plan's rehearsal verify block was run under bash, not the zsh the tool shell uses (see Deviations)."
requirements-completed: []
status: complete
plan_head_before: f9c5df4ac562c3069c47b675b11f4ad078cb68d5
plan_head_after: bf77bf8fe8584c1893b7fba75a5580b9f4b5352a
commits: 2
actuals:
  tokens: 12200
  tasks: 2
  commits: 2
---

# Phase 230 Plan 08: Ship preparation Summary

**A re-stamp of the lease migration is rehearsed end to end and recorded as a 14-file checklist, the lease has an operator runbook, the go-live single-replica invariant carries a dated correction, and the ship records (1) to (7) are written with today's measurements. Task 3 (the reviewer gates) was the blocking checkpoint; both verdicts are recorded in item (5) and neither blocks the ship.**

`requirements-completed` is empty on purpose: MT5D-02 closes only after seven clean nights (plan 09) and MT5D-03 only after the coordinator's capture (plan 10). This plan claims neither.

`status: complete`: Tasks 1 and 2 were committed first and the run stopped at Task 3, a `checkpoint:human-action` with `gate="blocking-human"`. On resume the orchestrator supplied both reviewer verdicts; item (5) now carries them. `commits: 2` is measured from the ledger base to `plan_head_after` (the last work commit); the SUMMARY commits follow it.

## Tasks

| Task | Commit | Files |
|---|---|---|
| 1 Tracer: re-stamp rehearsal and the validation map | `50efe05ce` | `.planning/phases/230-.../230-VALIDATION.md` |
| 2 Runbook and corrected invariant | `bf77bf8fe` | `docs/runbooks/mt5-terminal-lease.md`, `docs/runbooks/mt5-go-live.md` |
| 3 Reviewer gates | not run | blocking checkpoint, returned to the orchestrator |

The .planning commit and the docs commit are separate, so the ship's `.planning` filter drops the one and keeps the other.

## Task 1: the rehearsal

`node scripts/verify-plan-anchors.mjs` on this plan: `claims: 6 checked; OK: 1 plan file(s), no stale claims.`

Rehearsal on a detached worktree under the scratchpad (stamp `20261126120000` rewritten to `20261126235959`, the migration and its down file renamed), run through `rehearse.sh` in the scratchpad:

```
files rewritten:       14
no old-stamp reference remains
mutation-runner: STATIC PARSE ... ✅ No static defects. Every prose marker has a twin and every needle still matches.
lint-sql-gates: scanned 122 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).
SQL function snapshot is current (145 functions).
DRIFT-05 gate (a): baseline 142 name(s) vs migration-replay 145 name(s) — agree, with 3 ratcheted disagreement(s) carried.
rc=0
```

The worktree was removed in the run's own epilogue: `git worktree list | grep -a -c restamp-230` prints `0`. The `--parse-only` run lists `supabase/tests/test_mt5_terminal_lease.sql: 8 prose / 8 twin(s) / 0 waiver(s)`, so the gate resolves under the new stamp.

### Ship-time re-stamp checklist

`git grep -l 20261126120000 -- . ':!.planning'` at `f9c5df4ac` (occurrence counts in parentheses):

```
.github/workflows/ci.yml (1)
analytics-service/services/mt5_xlease.py (1)
scripts/baseline-content-drift-check.mjs (1)
scripts/dump-sql-functions.ts (7)
scripts/mutation-floors.mjs (1)
src/__tests__/drift-check-scripts.test.ts (1)
src/__tests__/mutation-annotation-parser.test.ts (7)
src/lib/database.types.ts (1)
supabase/migrations/20261126120000_mt5_terminal_lease.sql (17, and the file NAME)
supabase/migrations/down/20261126120000-rollback.sql (7, and the file NAME)
supabase/schema/functions/acquire_mt5_terminal_lease.sql (1, the generated header)
supabase/schema/functions/release_mt5_terminal_lease.sql (1, the generated header)
supabase/schema/functions/renew_mt5_terminal_lease.sql (1, the generated header)
supabase/tests/test_mt5_terminal_lease.sql (17, including the RED-UNDER-SETUP and RED-UNDER-M paths)
```

The real re-stamp changes ALL of them in ONE commit, and renames the migration and its down file with `git mv`. Then, on the branch itself, re-run the rehearsal's three checks: `node scripts/mutation-runner/run.mjs --parse-only`, `node scripts/lint-sql-gates.mjs`, `npx tsx scripts/dump-sql-functions.ts --check`. Then re-run `git grep -l <old stamp> -- . ':!.planning'`, which must print nothing. Pointers inside `.planning` (plan and summary prose) are not part of the ship branch.

The rehearsal's `perl -pi ... $F` needs `$F` split into words. Under zsh (the tool shell) it is not, so run the block, or the script, under `bash`.

Origin/main at `3081bdf8b`, its three newest migrations as read today (the `down` directory excluded):

```
20261124120700_sanitize_user_attempt_failures.sql
20261125132334_api_keys_venue_server_owner_read.sql
20261125151936_commit_scenario_batch_venue_server_identity.sql
```

`20261126120000` sorts after all three.

### Validation map

`230-VALIDATION.md` now carries 26 rows (plans 01 to 10, one per task), the four Wave 0 items ticked against the SUMMARYs that delivered them, and four Manual-Only rows (the seven nights, the coordinator's capture and replay, the post-deploy checks, the post-apply baseline re-dump). `grep -a -c "230-0"` on it prints 27 (at least 10 required). `nyquist_compliant` and `status` are untouched; validate-phase owns them. Rows for plan 07 are marked "not run locally, covered by CI at the PR head SHA", not green.

## Task 2: runbooks

`docs/runbooks/mt5-terminal-lease.md` has the six sections the plan lists. Automated checks: the file exists; `grep -a -c mt5_xlease_waited` prints 2; `grep -a -c "CORRECTED 2026-11-25 (Phase 230" docs/runbooks/mt5-go-live.md` prints 1; `grep -a -c mt5_terminal_leases` on the go-live runbook prints 1; `grep -a -c -E "mt5_xlease_(waited|unavailable|lost)"` on the lease runbook prints 7; the negated grep for `/Users/` and email shapes found nothing; a scan for IP-shaped strings, `railway.internal` and port-shaped numbers found nothing. No host, port, login, server, key id or account number is in the file.

The site-to-terminal map was read from source, not remembered: `derive_broker_dailies` and `sync_trades_balance` build their session through `job_worker._make_mt5_session`, which reads `MT5_GATEWAY_HOST/PORT`; `session_heal` reads the same pair through `read_env_gateway_endpoint`; `validate_wizard`, `validate_worker`, `terminal_scrub` and `validation_liveness` read `MT5_VALIDATION_GATEWAY_HOST/PORT` through `read_env_validation_gateway_endpoint`. `allocator_holdings` is on the job pair by the same `_make_mt5_session` route (the call site's own comment says so; the site passes `session.client.terminal_key`). `equity_backfill` is in the closed site set but no lease call passes it at this head.

MT5 behaviour claims in the runbook are limited to the repo's own recorded evidence ("one account per terminal at a time", `153-EVIDENCE-mt5-platform.md`, already cited in the go-live runbook). The runbook describes the lease, not the terminal API, so no new MetaTrader5 Python API claim was made and none was looked up.

The go-live note sits directly under the mechanism list and leaves every original paragraph unchanged.

## Ship records

### (1) TODOS entries the ship PR touches

Located today by `grep -a -n -F`, by content only:

- `[175-NIGHTLY-MT5-DERIVE-CHECK]`: the checkbox item at `TODOS.md:1321`. Full extent: lines 1321 to 1328 (heading line, the body paragraph, two evidence bullets, the Data integrity line, the Owner / Trigger line, the "Owned by Phase 227 ..., Phase 230 ..." line, and the 2026-11-24 Phase 227 bullet at 1328); line 1329 is blank and 1330 starts the next entry. Closed by MT5D-02.
- `### 202-MT5-CLOCK-LEAD-01`: the section heading at `TODOS.md:413`. Full extent: lines 413 to 423 (heading, "Why it is open", "It is not the only candidate", Owner, Trigger, "What closing it means"); line 424 is blank and 425 starts `### ALLOCSYNC-CAPTION-01`. Closed by MT5D-03.

Both were found. The ship PR deletes NEITHER. It appends ONE dated line to each, with the PR number filled in at ship time:

- to the first, after line 1328: `- 2026-11-DD: Phase 230 MT5NIGHTLY shipped the cross-process terminal lease (PR #NNNN). Plan 09 owns the close, after seven clean nights counted from night 1 (docs/runbooks/mt5-terminal-lease.md section 5(a)).`
- to the second, after line 423: `2026-11-DD: Phase 230 MT5NIGHTLY shipped the replay tooling (--days-out, docs/runbooks/mt5-clock-replay.md; PR #NNNN). Plan 10 owns the close, after the coordinator's capture and replay.`

Each entry is deleted in the records PR that closes it (plan 09 for the first, plan 10 for the second), in the same PR as the evidence, and named closed in that PR's CHANGELOG entry (CLAUDE.md rule (b)). Line numbers drift; re-locate both by content at ship time.

### (2) The new entry the ship PR books

Text to append to `TODOS.md` (a real open gap, so it is booked; it is not a LOW or Info survivor):

> **[230-MT5-REGISTRY-CROSS-PROCESS-STALE]** The per-process MT5 terminal registries (`_MT5_TERMINAL_HOLDERS`, `_MT5_TERMINAL_HISTORY_SETTLED`, relaunch debt, scrub owed) stay in-process after Phase 230's lease. The lease serializes access to the terminal but does not make these registries cross-process: after the other process moves the terminal, this process can still believe a key is "settled" and skip the history wait (`mt5_history_wait_due`). Pre-existing and not widened by the lease (230-RESEARCH Runtime State Inventory, Open Question 5). The kept lease row (release clears `owner_token` but keeps `holder` and `site`) is the hook for a later "someone else held since my record" invalidation. Owner: unrouted, founder to assign. Trigger: the next phase that touches `mt5_history_wait_due` or the holder registry, or any evidence of a skipped history wait after a cross-process handover.

### (3) Dangling pointers

`git grep -n -F` of each id outside `.planning`, `CHANGELOG.md` and `TODOS.md`, at `f9c5df4ac`:

- `175-NIGHTLY-MT5-DERIVE-CHECK`: one hit, `supabase/migrations/20261124120000_jobledger_attempt_failures.sql:73`, a comment in an APPLIED migration. Immutable; recorded as lineage, not a fix. It becomes a pointer to a deleted entry when plan 09's records PR closes the entry, which is accepted.
- `202-MT5-CLOCK-LEAD-01`: two hits, both in `docs/runbooks/mt5-clock-replay.md` (line 5, the Audience line, and line 16, "It closes the `TODOS.md` entry for ..."). Both are valid today (the entry exists). Fix: plan 10's records PR rewords both to say "the closed 202 clock-lead entry" or names the CHANGELOG entry, in the same PR that deletes the entry. Not fixed now, because fixing now would point at nothing the reader can resolve while the entry is still open.

The new lease runbook names neither id.

### (4) CHANGELOG names for the ship entry

- the table `public.mt5_terminal_leases` and the three RPCs `acquire_mt5_terminal_lease`, `renew_mt5_terminal_lease`, `release_mt5_terminal_lease`;
- the module `services.mt5_xlease` and its log events: **six, not five.** The plan says five; the code has `mt5_xlease_waited`, `mt5_xlease_unavailable`, `mt5_xlease_lost`, `mt5_xlease_rpc_error`, `mt5_xlease_release_failed` and `mt5_xlease_renew_failed` (counted by `grep -o` over the module: one each, `release_failed` twice). Name all six, and cross-check the count at ship time with the same grep;
- `Mt5TerminalLeaseUnavailableError`, the transient `classify_exception` arm, the holdings arm, the two validate arms (424 `NETWORK_UNAVAILABLE`);
- `services.db.is_missing_rpc`;
- the `--days-out` flag of `mt5offset_dry_run` and the two runbooks (`docs/runbooks/mt5-terminal-lease.md`, `docs/runbooks/mt5-clock-replay.md`);
- the corrected single-replica note in `docs/runbooks/mt5-go-live.md`.

Known limits to carry: MT5D-02 is open until seven clean nights; MT5D-03 is open until the coordinator's run; the registries in item (2); multi-replica is not claimed. Neither TODOS entry is named closed in the ship entry. Census moves to name: `FILES_FLOOR` 94 to 95, `ARMS_FLOOR` 1033 to 1041, `COMPARED_FLOOR` 144 to 147, the `sql-tests` sentinel floors (plan 06).

### (5) Before merge

- **Reviewer gates:** both reviewers ran at head `f9c5df4ac562c3069c47b675b11f4ad078cb68d5`, as reported by the orchestrator on resume. I confirmed locally that `git diff f9c5df4ac HEAD --stat -- supabase/` is empty at head `6310b49a8`, so the review subject (migration, down file, gate, three mirrors) is unchanged. **No MEDIUM or above from either reviewer: the ship is NOT blocked.**
  - `migration-reviewer` at `f9c5df4ac`: CRITICAL 0, HIGH 0, MEDIUM 0, LOW 0, INFO 4. MEDIUM-or-above titles: none. INFO: (1) the migration header comment at lines 49-51 says "no key id" while the holder column can carry an api_key_id; (2) service_role SELECT exposes `owner_token`, which is inside the trust boundary; (3) the gate has no arm for renew-on-expired-untaken, for `acquired_at` preservation, or for real concurrency; (4) a re-stamp must move the RED-UNDER-M and RED-UNDER-SETUP paths and the mirror headers (the Task 1 checklist already covers this).
  - `rls-policy-auditor` at `f9c5df4ac`: CRITICAL 0, HIGH 0, MEDIUM 0, LOW 1, INFO 5. MEDIUM-or-above titles: none. LOW: the privilege assertions (migration lines 357-358 and 362, and gate arm L6) check only SELECT, INSERT, UPDATE and DELETE, not TRUNCATE, REFERENCES or TRIGGER. INFO: `owner_token` readable by service_role; misleading SECURITY DEFINER wording at migration line 313; RLS not FORCEd is unpinned; search_path order is convention; hand-added `database.types.ts` entries.
  - LOW and INFO are recorded here and NOT booked in `TODOS.md` (CLAUDE.md rule (a)). The ship PR may fix the migration header wording in INFO (1) only if it re-stamps anyway; it is not required.
- the review lane per the project's review rule (gsd-code-reviewer in parallel with silent-failure-hunter, MEDIUM and above only);
- CI mypy strict in the pre-push checks (`analytics-service`, the CI-form command in plan 07's table);
- no `.planning` path on the ship branch (check with `git diff --name-only origin/main...HEAD | grep -a '^\.planning'` before the push);
- `VERSION` and `package.json` byte-equal 4-digit strings;
- never the CI-skip token in a commit or PR body.

VAC-08 is red on the PR by construction until apply-on-merge. **VAC-04** (the repo-vs-PROD body diff, a step of `migration-drift-check.yml`) needs a PROD credential that this run does not hold and must not use, so it was NOT measured here. Its reading for the three new functions comes from that workflow's run at the PR head SHA; record it here then. Today's local stand-in is `baseline-content-drift` (see item 6): the three functions report `SNAPSHOT_MISSING`, expected until the post-apply re-dump.

### (6) PROD-tip timestamp check and census re-measure (ship time, after the final rebase)

**Today's readings (2026-11-25, branch head `bf77bf8fe`, origin/main `3081bdf8b`):**

- origin/main's three newest migrations: the three listed under Task 1. The lease stamp `20261126120000` sorts after all of them.
- PROD's newest applied migration version: **`20261125151936`, read by the coordinator on 2026-11-25 through the Supabase MCP, read-only, and reported to me on resume (I did not read it myself; the MCP tool was not loadable from my run).** The marker query came first and returned the PRODUCTION marker. `20261126120000` sorts after it and after origin/main's tip (`20261125151936` as I read it from `git ls-tree`), so no re-stamp is needed today. This reading is dated 2026-11-25 and must be repeated at push time. At ship time, immediately before opening the PR: run the marker query alone, `SELECT shobj_description(oid, 'pg_database') AS which_database FROM pg_database WHERE datname = current_database();`, then in a separate call `SELECT max(version) FROM supabase_migrations.schema_migrations;`, read-only, one query per call. `20261126120000` must sort after both that value and `git ls-tree --name-only origin/main supabase/migrations/ | grep -v down | sort | tail -3`. If not, re-stamp with the Task 1 checklist in ONE commit and re-run its three checks.
- `grep -nE '^export const (FILES_FLOOR|ARMS_FLOOR|WAIVED_CEILING)' scripts/mutation-floors.mjs`: `FILES_FLOOR = 95` (line 1396), `ARMS_FLOOR = 1041` (3571), `WAIVED_CEILING = 0` (3685).
- the six targeted vitest census files, run once:
  `npx vitest run src/__tests__/mutation-runner-floors.test.ts src/__tests__/mutation-annotation-parser.test.ts src/__tests__/gate-family-meta.test.ts src/__tests__/lint-sql-gates.test.ts src/__tests__/drift-check-scripts.test.ts src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts --no-coverage`
  gave `Test Files  6 passed (6)`, `Tests  1308 passed (1308)`, `Duration  118.97s`. The META bare-measurement lines read `FILES_FLOOR=95`, `ARMS_FLOOR=1041`, `WAIVED_CEILING=0`.
- `node scripts/mutation-runner/run.mjs --parse-only`: `✅ No static defects`; the lease gate parses as `8 prose / 8 twin(s) / 0 waiver(s)`.
- `node scripts/lint-sql-gates.mjs --self-test`: `lint-sql-gates self-test OK: 7 rules, red+green each.`
- `npx tsx scripts/dump-sql-functions.ts --check`: `SQL function snapshot is current (145 functions).`
- `node scripts/baseline-content-drift-check.mjs` (exit 1, expected): `functions compared 147 — MATCH 141, DRIFT 3, SNAPSHOT_MISSING 3, SNAPSHOT_ONLY 0, UNCOMPARABLE 0`; `allowlisted rows 3`; `findings 3`. The three findings are exactly `SNAPSHOT_MISSING` for the three lease functions. Plan 06 recorded `MATCH 140, DRIFT 4, findings 4`; the census has MOVED on main since (one `DRIFT` row fewer, the fourth finding gone). It is read off this run, not restated from plan 06. The three `SNAPSHOT_MISSING` rows clear with the post-apply re-dump.

**What the ship step repeats after the final rebase onto origin/main:** all of the above except the full mutation-runner count. The full run, `node scripts/mutation-runner/run.mjs` (coverage, arms, biting lines against `FILES_FLOOR` and `ARMS_FLOOR`), is NOT run locally (load limit). The census re-measure at ship time uses the targeted vitest census files plus `--parse-only`, and the full mutation count is read off CI's `sql-mutation` job at the head SHA. A census that moved on main since this reading is updated, read off the run, in the same commit as the re-stamp.

### (7) Post-merge, in order, by the coordinator

1. `apply-test` then the PROD apply run with no human stop (the `Production` reviewer gate is gone, 2026-09-23). Confirm both succeeded; a failed TEST apply blocks the PROD apply.
2. Railway deploys both services after main CI is green (the backfill worker and the API service). Record both deployments' creation times.
3. Run the post-deploy checks (a) to (d) from `docs/runbooks/mt5-terminal-lease.md` section 5, recorded as counts and yes/no only.
4. The post-apply re-dump of `supabase/schema/baseline.sql` in a records PR (regenerating `baseline-carried-migrations.txt` in the same commit): clears the three `NAME_SET_RATCHET` rows in `scripts/dump-sql-functions.ts` and the three `SNAPSHOT_MISSING` findings.
5. Plan 09's nights start at the night-1 definition: the first 00:40Z derive after the LATER of the two deploys and after the migration's PROD apply.
6. Plan 10's coordinator capture runs outside 00:40 to 01:40Z, per `docs/runbooks/mt5-clock-replay.md`.

## Not run locally (Rule 12), and what covers each

| Not run | Why | Covered by |
|---|---|---|
| the full `node scripts/mutation-runner/run.mjs` | load limit | CI `sql-mutation` at the PR head SHA (plan 06 already took the clean full run and set the floors) |
| full vitest, full pytest with the 80 percent coverage floor, e2e | load limit | CI frontend shards plus `frontend-coverage`, CI `python` |
| Docker, the local-stack lane, the lease gate's `ALL 8 ARMS EXECUTED`, the live module's pass count | load limit, no Docker | CI `sql-tests` and `python` at the PR head SHA |
| VAC-04 for the three new functions | needs a PROD credential this run must not use | `migration-drift-check.yml` at the PR head SHA |
| PROD's newest applied migration version, by me | the Supabase MCP tool was not loadable from my run | the coordinator's read-only MCP reading of 2026-11-25 (`20261125151936`, marker first), to be repeated at push time per item (6) |

Run locally: the rehearsal (parse-only, lint-sql-gates, dump-sql-functions --check), the six targeted vitest census files (1308 tests), `--self-test` of the lint, `baseline-content-drift-check`. No pytest and no mypy run, because this plan changes no analytics source. No database write of any kind was made; the CLI linked to PRODUCTION was not invoked.

## Deviations from Plan

**1. [Rule 3 - Blocking] The plan's rehearsal verify block does not run under zsh.** It relies on an unquoted `$F` being split into one word per file by `perl -pi ... $F`. The tool shell is zsh, which does not split it, so `perl` received one argument and failed (`Can't open ...`). The first attempt left no residue (the epilogue removed the worktree; `git worktree list | grep -a -c restamp-230` printed 0). The block was re-run unchanged in substance under `bash` (`rehearse.sh`, scratchpad) and passed. The checklist step above records the shell requirement for the ship step.
- **Files modified:** none tracked.

**2. [Rule 1 - Plan count wrong] Six log events, not five.** `mt5_xlease_renew_failed` exists in the module beside the five the plan names. The runbook documents all six and item (4) tells the ship entry to name six.
- **Commit:** `bf77bf8fe`

**3. [Plan step deferred] VAC-04 reading** is a ship-time step (CI at the PR head SHA). The PROD-tip read was supplied by the coordinator on resume (item 6) and is to be repeated at push time.

No auth gates. No stubs.

## Known Stubs

None.

## Threat Flags

None. The only new surface is documentation, and it records counts and yes/no only.

## Self-Check: PASSED

- `docs/runbooks/mt5-terminal-lease.md`: FOUND
- `docs/runbooks/mt5-go-live.md`: FOUND (CORRECTED note present, count 1)
- `.planning/phases/230-.../230-VALIDATION.md`: FOUND
- commit `50efe05ce`: FOUND (ancestor of HEAD)
- commit `bf77bf8fe`: FOUND (ancestor of HEAD)
- rehearsal worktree: REMOVED (0 entries)
- `git diff --name-only f9c5df4ac -- TODOS.md CHANGELOG.md VERSION package.json`: empty

---
phase: 242-secretshygiene-the-full-history-is-scanned-on-a-schedule-and
plan: 02
subsystem: database
tags: [security, postgres, migration, secdef, pg-net, vault, mutation-gate, PROOF-01, SECR-04]
requires: []
provides:
  - "supabase/migrations/20261127120000_cron_destinations_exact.sql: the analytics_service_url CHECK and the in-body re-test of all four key-posting ticks narrowed to exactly two origins by equality, blank-key guard trimming space, tab, CR and LF, refusal tail naming the two origins, catalogue-only verify block"
  - "supabase/migrations/down/20261127120000-rollback.sql: manual rollback (old CHECK, four old bodies, owner-alone REVOKEs, catalogue pre/postcondition)"
  - "supabase/tests/test_cron_sync_tick.sql: arms W1, P2 and K1, six twins repointed, sentinel ALL 11 ARMS EXECUTED"
  - "four regenerated function snapshots naming the new migration as source, four prod-body-ack pragmas"
affects: [242-03, 242-04, 242-05, 242-06]
tech-stack:
  added: []
  patterns: ["inline equality against a TEXT[] constant in every body and in the CHECK, no helper function (DISC-HELPER)", "verify block asserts shape only, never a line a gate twin edits, needles assembled by concatenation"]
key-files:
  created:
    - supabase/migrations/20261127120000_cron_destinations_exact.sql
    - supabase/migrations/down/20261127120000-rollback.sql
  modified:
    - supabase/tests/test_cron_sync_tick.sql
    - supabase/schema/functions/match_engine_cron_tick.sql
    - supabase/schema/functions/prod_prober_cadence_check.sql
    - supabase/schema/functions/cron_sync_tick.sql
    - supabase/schema/functions/ops_staleness_check.sql
decisions:
  - "Migration timestamp 20261127120000 (the default): origin/main's newest migration is 20261126180000, the PROD ledger tip, so the default is free and strictly later"
  - "P2 is its own arm identity rather than a clause inside P1 (see ## P2 naming)"
  - "A manual rollback file was added under supabase/migrations/down/ although the plan's files_modified omits it: the phase contract's Migration identity names it and every function-changing migration of this repo carries one"
metrics:
  duration: "not timed at start (no start timestamp was recorded)"
  completed: 2026-11-27
status: complete
actuals:
  tokens: 24600
  tasks: 3
  commits: 3
plan_head_before: dc91a3a2f34f3187fec150f02fcae07f769093d3
plan_head_after: 90fb53e93542f680b34efa45c342c2d8e4cb2889
requirements-completed: [SECR-04]
---

# Phase 242 Plan 02: exact two-origin destination for the four key-posting ticks Summary

One forward migration pins the `analytics_service_url` CHECK and the in-body re-test of `match_engine_cron_tick`, `prod_prober_cadence_check`, `cron_sync_tick` and `ops_staleness_check` to exactly the production origin and the loopback discard literal by equality, widens the blank-key guard to space, tab, carriage return and newline, and the cron_sync gate proves it with three new twinned arms (W1, P2, K1), each shown RED first on a byte copy and GREEN after a `cp` and `cmp` restore.

## Commits

| Task | Commit | Files |
|---|---|---|
| 1 (tracer) | `97134ae0f` feat(242-02): exact two-origin destination for the CHECK and cron_sync_tick, proven by gate arm W1 | the migration (CHECK swap + cron_sync_tick), supabase/tests/test_cron_sync_tick.sql |
| 2 | `f90abb8d5` feat(242-02): re-base all four key-posting functions on the exact two-origin set; snapshots and VAC-04 pragmas | the migration (all four bodies), the rollback, four snapshots, the gate (twins re-measured) |
| 3 | `90fb53e93` test(242-02): cron_sync gate arms P2 and K1 close residual items 2 and 3 | supabase/tests/test_cron_sync_tick.sql |
| SUMMARY | this file's own commit | 242-02-SUMMARY.md |

`commits: 3` in the frontmatter is `git rev-list --count plan_head_before..plan_head_after` measured at the moment this SUMMARY was written (ledger file `gsd-plan-head-before-242-02`); the SUMMARY commit follows it.

## Migration identity and re-measured facts

- **Chosen `<TS>`: `20261127120000`** (the default). `git ls-tree --name-only origin/main supabase/migrations/` after `git fetch origin main` ends at `20261126180000_poll_positions_cohort_ccxt_venues.sql`, which is also the PROD ledger tip, and this branch adds nothing later, so `20261127120000` is the first free `20261127HHMMSS` and sorts after both. Plans 03 to 06 read it with `ls supabase/migrations/*_cron_destinations_exact.sql`.
- **Latest definitions re-measured 2026-11-27** with `grep -alE "CREATE (OR REPLACE )?FUNCTION (public\.)?<fn>\b" supabase/migrations/*.sql` after the fetch, unchanged from the plan: `match_engine_cron_tick` last by `20260911120000_vault_tick_hardening.sql` (the only other file naming it is `20260907120000`, older), `prod_prober_cadence_check` by `20260918120000_prod_prober_cadence.sql`, `cron_sync_tick` by `20261010140000_cron_sync_tick.sql`, `ops_staleness_check` by `20261020120000_ops_staleness_check.sql`, and the CHECK by `20260907120000_analytics_service_settings_and_vault_tick.sql` alone. No re-base target moved. Each committed snapshot was also proven byte-identical (`cmp`) to the statement in its source migration before any edit.
- **Four body edits**, applied by a script that asserted exactly one occurrence per substitution per body: constant to `c_allowed_origins CONSTANT TEXT[] := ARRAY[<production origin>, 'http://127.0.0.1:9'];`, guard to `IF NOT (v_url = ANY (c_allowed_origins)) THEN`, key guard to `btrim(v_key, E' \t\r\n') = ''`, refusal tail to `Allowed: exactly %', array_to_string(c_allowed_origins, ' or ');`. Comment sentences describing the old trim or the suffix rule were rewritten in the three bodies that carried them (`match_engine_cron_tick`, `cron_sync_tick`, `ops_staleness_check`); `prod_prober_cadence_check` had none. No comment quotes a line a twin counts.
- **Function order in the file (pinned):** `match_engine_cron_tick` (line 156), `prod_prober_cadence_check` (250), `cron_sync_tick` (410), `ops_staleness_check` (495). Every `nth` below is measured against it.

## prod-body-ack values (VAC-04)

After `npm run schema:functions`, `node scripts/sql-body-normalize.mjs --diff-bodies supabase/schema/functions/<fn>.sql supabase/schema/baseline.sql` printed, per function, a `DRIFT` row whose fifth tab-separated field is the live-side hash, each equal to the value measured before any edit (the baseline did not change, `git diff --quiet origin/main -- supabase/schema/baseline.sql scripts/prod-prober/cron-manifest.json` exits 0):

| function | live-side hash (the pragma) |
|---|---|
| match_engine_cron_tick | 277f02d6d0cfdffab2269fb3a146e9dc78cb47f47c7217101748fd47d5a65bd6 |
| prod_prober_cadence_check | 7555dbdeabf467c199fa48dba1a24344ebe7597e605d8574df06eafa3100fccc |
| cron_sync_tick | 2816b95cff1895d8201da70bf7dcd8ee5833dc0b8d94593a7369899da60d167e |
| ops_staleness_check | bc790f0c9ba9382247555ece7cc484bddf861ff778c6c5cb06060093b4925abb |

The migration carries four `-- prod-body-ack:` lines with these values, each under a comment naming its function. CI's VAC-04 output on the PR is the final authority for PROD equality.

## Runner output: `node scripts/mutation-runner/run.mjs --file supabase/tests/test_cron_sync_tick.sql`

Exit 2 (the narrowed diagnostic mode never exits 0). The block below is the complete output from the `baseline` line onward, copied from the captured run; the only omissions are blank lines and the `unreachable:` line, a 27-file-name list that is not about this plan (the header lines before `baseline` are `scope:`, `scope-reason:` and `lane-concurrency:`).

```
  baseline  supabase/tests/test_cron_sync_tick.sql — exit 0 (2.2s)
  arm 0                        exit   3  RED (identity ok)  (2.4s)
  arm P1                       exit   3  RED (identity ok)  (2.2s)
  arm P2                       exit   3  RED (identity ok)  (2.7s)
  arm V1                       exit   3  RED (identity ok)  (2.6s)
  arm V2                       exit   3  RED (identity ok)  (3.1s)
  arm K1                       exit   3  RED (identity ok)  (2.5s)
  arm U1                       exit   3  RED (identity ok)  (3.0s)
  arm C2                       exit   3  RED (identity ok)  (2.9s)
  arm C3                       exit   3  RED (identity ok)  (2.6s)
  arm W1                       exit   3  RED (identity ok)  (2.7s)
  arm G1                       exit   3  RED (identity ok)  (2.4s)
  restore   supabase/tests/test_cron_sync_tick.sql — exit 0 (2.7s)
coverage: files 96/123
lane-blocked: 0 file(s) probe pg_extension for pg_cron and are not yet annotated — (none; the lane hosts pg_cron since Phase 164.4.1, TODOS [REDUNDER-PGCRON] retired 2026-09-05)
lane-probe: pg_cron AVAILABLE — lane-blocked class is empty, as a hosting lane requires
  pending: 0 idiom file(s) without RED-UNDER — 
arms: 11/11/0   (executed/annotated/waived)
biting: 11   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)
lane-invocations: 11   (arm lanes actually spawned — tallied inside runLane, independent of the 11 the verdict loop counted; plus 1 baseline / 1 restore leg(s))
  file test_cron_sync_tick.sql: sections 11 / judged 11 / annotated 11 / waived 0 / biting 11
per-arm lane time: mean 2.7s over 11 arm run(s)
⚠️ NARROWED DIAGNOSTIC RUN (--file/--arm): coverage floors NOT enforced.
   This mode never exits 0, so it can never be mistaken for a passing gate.
No defects in the narrowed scope.
```

Task 1's run printed `arms: 9/9/0`, `biting: 9`, `lane-invocations: 9` with the same `No defects` line (six repointed twins plus W1 plus arms 0 and G1 untouched).

Twin measurements on the final migration (`grep -aFc`), all pinned in the gate: key-guard line 4 (`nth` 3, twins V1, V2, K1), url-null guard 4 (`nth` 3, U1), destination guard 4 (`nth` 3, C2 and W1), refusal tail 4 (`nth` 3, C3), `'X-Service-Key', v_key` 5 (`nth` 3, P2), `'/api/cron-sync'` 1 (P1). `node scripts/mutation-runner/run.mjs --parse-only` after the last edit: `coverage: files 96/123`, `arms: 0/1082/0`, `No static defects.` (the floors in `scripts/mutation-floors.mjs` and ci.yml are plan 05's). Measured with `git grep -aE '^[ \t]*--[ \t]*RED-UNDER-M:' <rev> -- supabase/tests | wc -l`: 1079 at `dc91a3a2f`, 1082 at HEAD, so this plan added three annotated arms (W1, P2, K1).

## Behaviour-preservation lane runs (Task 2 step 4)

Each gate's own `RED-UNDER-SETUP` list plus the new migration appended, `bash scripts/pg-lane/run.sh --workdir <scratch> --apply <list> --gate <gate>`, exit 0, gates not edited:

```
test_prod_prober_cadence.sql:                      ALL 7 ARMS EXECUTED (G1,S1,O1,A1,U1,V1,N1)
test_ops_staleness_check.sql:                      ALL 14 ARMS EXECUTED (S1,S2,S3,S4,S5,S6,S7,S8,S12,S9,S10,S13,S11,G1)
test_analytics_service_settings_and_vault_tick.sql: ALL 13 ARMS EXECUTED (0,V1,U1,U2,C1,C2,C3,V2,R1,R2,R3,T1,G1)
```

## PROOF-01

Neuter applied with the Edit tool to the cron_sync body only (the `nth` 3 body), run on the pg-lane, never committed. Lane command in every row: `bash scripts/pg-lane/run.sh --workdir <scratchpad>/w --apply <the gate's RED-UNDER-SETUP list, in order, new migration last> --gate supabase/tests/test_cron_sync_tick.sql`. Byte backup `cp supabase/migrations/20261127120000_cron_destinations_exact.sql <scratchpad>/mig.bak-<id>`; restore `cp <backup> <migration>`, then `cmp <backup> <migration>` and `git diff --quiet -- <migration>`.

| id | neuter | command | RED | cmp | GREEN |
|---|---|---|---|---|---|
| D-01 W1 | cron_sync destination guard restored to the old suffix regex (`IF v_url !~ '^(https://[a-z0-9][a-z0-9.-]*\.up\.railway\.app\|http://127\.0\.0\.1:9)$' THEN`) | manual lane command above | RED: first `TEST FAILED (W1)` (lane exit 3), full line below | cmp: exit 0, no output; `git diff --quiet` exit 0 | GREEN: lane exit 0, `ALL 11 ARMS EXECUTED (0,P1,P2,V1,V2,K1,U1,C2,C3,W1,G1)`, full line below |
| D-02 K1 | cron_sync key guard restored to the old spaces-only trim (`IF v_key IS NULL OR btrim(v_key) = '' THEN`) | manual lane command above | RED: first `TEST FAILED (K1)` (lane exit 3), full line below | cmp: exit 0, no output; `git diff --quiet` exit 0 | GREEN: lane exit 0, `ALL 11 ARMS EXECUTED (0,P1,P2,V1,V2,K1,U1,C2,C3,W1,G1)`, full line below |
| D-03 P2 | cron_sync post header changed to a fixed string (`'X-Service-Key', 'fixed-not-the-secret'`) | manual lane command above | RED: first `TEST FAILED (P2)` (lane exit 3), full line below | cmp: exit 0, no output; `git diff --quiet` exit 0 | GREEN: lane exit 0, `ALL 11 ARMS EXECUTED (0,P1,P2,V1,V2,K1,U1,C2,C3,W1,G1)`, full line below |

The lines below are the complete first matching line (`grep -a 'TEST FAILED' | head -1` on the RED run, `grep -a 'ARMS EXECUTED'` on the GREEN run) from the captured lane outputs, uncut.

D-01 W1 RED:

```
psql:supabase/tests/test_cron_sync_tick.sql:554: ERROR:  P0001: TEST FAILED (W1): with analytics_service_url set to a sibling host under the same Railway domain as the production origin, cron_sync_tick() did not refuse by name — raised=f, message: NULL. A suffix rule admits any subdomain anyone can register, so the Vault-held service key would leave in an X-Service-Key header to a host nobody chose.
```

D-01 W1 GREEN:

```
psql:supabase/tests/test_cron_sync_tick.sql:554: NOTICE:  00000: ALL 11 ARMS EXECUTED (0,P1,P2,V1,V2,K1,U1,C2,C3,W1,G1): public.cron_sync_tick() exists with no arguments (0); posts exactly one request to the analytics service's /api/cron-sync route, carrying a non-blank X-Service-Key, an empty JSON body and a timeout inside the declared window, and returns the pg_net request id (P1); carries in that post's X-Service-Key header exactly the secret the Vault holds (P2); RAISES by name and posts nothing when the key is absent (V1), when the key is a single space (V2), when the key is made of a space, a tab, a carriage return and a newline (K1), and when the url setting is absent (U1); refuses a destination outside the allow-list with the CHECK constraint dropped (C2) and never echoes the value it refused (C3); refuses a sibling host under the same Railway domain as the production origin, because the destination is exactly two origins and not a suffix rule (W1); and EXECUTE is held by the owner alone (G1). Phase 167.1.2.2.2 / plan 01 / SC-1, SC-5, mig 20261010140000.
```

D-02 K1 RED:

```
psql:supabase/tests/test_cron_sync_tick.sql:554: ERROR:  P0001: TEST FAILED (K1): cron_sync_tick() RETURNED with an analytics_service_key made of a space, a tab, a carriage return and a newline. None of them is a usable key, and a guard that trims spaces only lets the rest through to a header the analytics service answers 401 to, asynchronously.
```

D-02 K1 GREEN:

```
psql:supabase/tests/test_cron_sync_tick.sql:554: NOTICE:  00000: ALL 11 ARMS EXECUTED (0,P1,P2,V1,V2,K1,U1,C2,C3,W1,G1): public.cron_sync_tick() exists with no arguments (0); posts exactly one request to the analytics service's /api/cron-sync route, carrying a non-blank X-Service-Key, an empty JSON body and a timeout inside the declared window, and returns the pg_net request id (P1); carries in that post's X-Service-Key header exactly the secret the Vault holds (P2); RAISES by name and posts nothing when the key is absent (V1), when the key is a single space (V2), when the key is made of a space, a tab, a carriage return and a newline (K1), and when the url setting is absent (U1); refuses a destination outside the allow-list with the CHECK constraint dropped (C2) and never echoes the value it refused (C3); refuses a sibling host under the same Railway domain as the production origin, because the destination is exactly two origins and not a suffix rule (W1); and EXECUTE is held by the owner alone (G1). Phase 167.1.2.2.2 / plan 01 / SC-1, SC-5, mig 20261010140000.
```

D-03 P2 RED:

```
psql:supabase/tests/test_cron_sync_tick.sql:554: ERROR:  P0001: TEST FAILED (P2): the recorded post's X-Service-Key header (20 character(s)) is not the analytics_service_key secret the Vault holds (52 character(s)). A post that carries any other non-blank string passes every check above and is answered 401 asynchronously.
```

D-03 P2 GREEN:

```
psql:supabase/tests/test_cron_sync_tick.sql:554: NOTICE:  00000: ALL 11 ARMS EXECUTED (0,P1,P2,V1,V2,K1,U1,C2,C3,W1,G1): public.cron_sync_tick() exists with no arguments (0); posts exactly one request to the analytics service's /api/cron-sync route, carrying a non-blank X-Service-Key, an empty JSON body and a timeout inside the declared window, and returns the pg_net request id (P1); carries in that post's X-Service-Key header exactly the secret the Vault holds (P2); RAISES by name and posts nothing when the key is absent (V1), when the key is a single space (V2), when the key is made of a space, a tab, a carriage return and a newline (K1), and when the url setting is absent (U1); refuses a destination outside the allow-list with the CHECK constraint dropped (C2) and never echoes the value it refused (C3); refuses a sibling host under the same Railway domain as the production origin, because the destination is exactly two origins and not a suffix rule (W1); and EXECUTE is held by the owner alone (G1). Phase 167.1.2.2.2 / plan 01 / SC-1, SC-5, mig 20261010140000.
```

In each RED run psql aborted at the first `TEST FAILED`, and it named the arm under test, so W1, K1 and P2 each fail first under their own neuter. The arms run in file order, so every arm before the named one passed under that neuter (V1 and V2 before K1; C2 and C3 before W1; P1 before P2). After the three cycles the migration is byte-identical to the committed file (`cmp` against the first backup, `git status --short` empty).

## Lints

```
lint-migration-data-dependence self-test OK (5 refusals, red+green each.)
lint-migration-data-dependence: corpus 345 migration(s), 427 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.
npm run schema:functions:check -> SQL function snapshot is current (146 functions).
lint-sql-gates: scanned 123 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).
lint-sql-gates self-test OK: 7 rules, red+green each.
lint-app-guc self-test OK: 4 finding kinds, red+green each (11 red, 2 green fixtures; 2 kind(s) vitest-covered by declaration).
app-guc: findings 0
```

`gitleaks dir` with `--redact` over copies of the migration, the rollback and the gate printed `no leaks found`. No credential-shaped literal is in any file of this plan: the P1 and K1 key fixtures are built at runtime (uuid suffix, `E' \t\r\n'`), and the `fixed-not-the-secret` string is a non-credential marker.

## P2 naming

CONTEXT DEST-P1 places the header-equals-secret check on P1's post. This plan implements it as its own arm identity `P2` that reads exactly P1's recorded post, and that is a deliberate reading of DEST-P1, not drift. Reasons:

1. **Every gate file gives one arm exactly one twin.** The runner (`scripts/mutation-runner/parse.mjs`) refuses a duplicate top-level arm id within a file (`duplicate arm "<id>"`), and attributes a first failure by arm identity. A header check inside P1 would need a second twin on P1, which the grammar cannot express.
2. **P1's post-path twin must keep biting unchanged.** P1 carries the `'/api/cron-sync'` to `'/api/cron-sync-x'` twin and its RED line proves the path assertion can fail; folding the new check into P1 would either dilute that attribution or force a second twin.
3. **The corpus measurement agrees.** Measured at HEAD, per file, the top-level `"arm"` of every `RED-UNDER-M` line (nested `neuter` entries excluded):

```
$ for f in supabase/tests/*.sql; do grep -aE '^[ 	]*--[ 	]*RED-UNDER-M:' "$f" | sed -E 's/^[ 	]*--[ 	]*RED-UNDER-M:[ 	]*\{"arm":"([^"]*)".*/\1/' | sort | uniq -d | sed "s|^|$(basename $f) |"; done | wc -l
0
$ echo "files scanned: $(ls supabase/tests/*.sql | wc -l); twins counted: $(cat supabase/tests/*.sql | grep -acE '^[ 	]*--[ 	]*RED-UNDER-M:')"
files scanned:      123; twins counted: 1082
```

Zero duplicate arm ids across 123 gate files and 1082 twins, so no file in the corpus gives one arm two twins. (A first, careless count printed 55 because `grep -o '"arm":"..."'` also picks up the nested `neuter` entries of layered twins; the per-line top-level extraction above is the correct instrument, and the runner's own parse-only run agrees with it: `arms: 0/1082/0`, `No static defects.`)

P2's banner comment in the gate says the same. The check is not weaker for being separate: under the fixed-string neuter P1 stays GREEN (its header is non-blank and its url right) and P2 is the first failure, which is exactly the residual item 2 case.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Manual rollback file added**
- **Found during:** Task 2
- **Issue:** the phase contract's "Migration identity" names `supabase/migrations/down/<TS>-rollback.sql` and says a ship-time rename touches "both files", but the plan's `files_modified` and tasks never create it. Every function-changing migration in this repo ships one (the analog `20261126180000` has `down/20261126180000-rollback.sql`).
- **Fix:** wrote `supabase/migrations/down/20261127120000-rollback.sql` from the same extracted old bodies: catalogue precondition, old CHECK and comment restored, four old bodies in the pinned order with owner-alone REVOKEs, catalogue postcondition. Proved on the pg-lane: applied after the migration it printed `ROLLBACK CHECK OK` (old CHECK in force, each function carrying the old constant). `prod-body-drift-check.sh` already excludes down files by a `:(glob)` pathspec.
- **Files modified:** supabase/migrations/down/20261127120000-rollback.sql
- **Commit:** `f90abb8d5`

**2. [Process, no behaviour change] Gate committed before PROOF-01 rather than after**
- The plan says to commit the gate after the PROOF-01 cycles. The cycles mutate only the migration, which was already committed, and each row's `git diff --quiet -- <migration>` and the final `cmp` against the committed bytes prove the restore, so the gate was committed first (`90fb53e93`) to make the work durable. Nothing was committed during a cycle.

**3. [Process] Task 3 is `tdd="true"` but was not committed RED-then-GREEN**
- The plan's own sequence for Task 3 is "write both arms, confirm each GREEN on the real migration, then add their twins", and the code under test (the key guard and the header post) already existed in the Task 2 commit, so the arms were written against finished code. RED was established the PROOF-01 way (a neuter of the migration, observed first failure naming the arm, restored byte-exact) instead of through a separate failing-test commit. No `test(...)` RED commit exists; this is recorded as a gap against `tdd.md`'s commit-scope contract, not rewritten.

**4. [Process] Executor start-up steps not performed**
- No `PLAN_START_TIME` was recorded (hence `duration` above is untimed), the `init.execute-phase` / `state.load` queries were not run, and the auto-mode and `human_verify_mode` flags were not read. The task text and the orchestrator's brief supplied the plan, phase directory and constraints. Effect on the tracer gate: Task 1 is `type="tracer"` with no `gate` attribute and an automated-only `<verify>`, and its verify (`run.mjs --file ...`, exit 2, `arms: 9/9/0`, `No defects in the narrowed scope.`) was run and passed before any expansion work, which is the outcome the gate requires in every mode.

### Plan facts re-read, not deviations

- The V2 twin keeps its original mutant (`v_key = ''`, no trim at all) rather than becoming the old spaces-only guard: under the spaces-only guard a single space is still refused, so V2 would be `no-red`. The spaces-only mutant belongs to K1, as the plan states.
- K1 stores all four characters (`E' \t\r\n'`), not RESEARCH's `E'\t\n'`, as the plan's behaviour block specifies.

## Acceptance greps, preconditions and extra checks (final tree, HEAD `0bebfcaed`)

- Task 1 precondition: `test -x node_modules/.bin/tsx` succeeds; `bash scripts/pg-lane/run.sh --print-pgbin` printed `/opt/homebrew/opt/postgresql@16/bin`; `node scripts/verify-plan-anchors.mjs <242-02-PLAN.md>` printed `claims: 10 checked` and `OK: 1 plan file(s), no stale claims.` (exit 0, run at the end of the plan, not at the start).
- Task 1 acceptance: migration file count 1; `c_allowed_origins CONSTANT TEXT[] :=` 4 (1 after Task 1, 4 after Task 2); old-file twins `"file":"supabase/migrations/20261010140000_cron_sync_tick.sql"` 0; `"arm":"W1"` 1; `^SET LOCAL lock_timeout = .3s.;` 1.
- Task 2 acceptance: `CREATE OR REPLACE FUNCTION public\.` 4; key-guard fixed string 4; `^-- prod-body-ack: [0-9a-f]{64}$` 4; owner-alone REVOKE 4; snapshots naming the new source migration 4; `git diff --quiet origin/main -- scripts/prod-prober/cron-manifest.json supabase/schema/baseline.sql` exit 0.
- Task 3 acceptance: `RED-UNDER-M:` 11; sentinel `ALL 11 ARMS EXECUTED (0,P1,P2,V1,V2,K1,U1,C2,C3,W1,G1)` 1; `arm-fixture-key-' || gen_random_uuid()` 1; `^| D-0[1-3] ` rows 3; `^## P2 naming` 1. (`git status --porcelain` listed only this SUMMARY before its commit.)
- `gitleaks git . --no-banner --redact --config .gitleaks.toml --log-opts=dc91a3a2f..HEAD` (the plan's own commits, run after the four code and SUMMARY commits): `no leaks found`.
- `npx vitest run src/__tests__/phase-29-frozen-spine-guards.test.ts` (the one test that references `supabase/migrations/down/`): 7 passed, so the added rollback file trips nothing.
- Destinations written to `analytics_service_url` that the new CHECK refuses: none found. TEST holds the loopback sink by the restore path (`scripts/test-only-normalize-analytics-url.sh` and `scripts/restore-test-from-baseline.sh` write only that literal, which is in the set), PROD holds the production origin, the lane seed is the production origin, and the only other `.up.railway.app` host a gate writes is W1's sibling after the CHECK has been dropped. The three behaviour-preservation lane runs above are the executable evidence for the gates.

## Auth gates

None.

## Known Stubs

None. No stub, placeholder, TODO or hardcoded-empty value was introduced; the `fixed-not-the-secret` string exists only inside a twin's `replace` field and the PROOF-01 neuter.

## Threat Flags

None beyond the plan's register. The new surface is a narrowing: no new endpoint, auth path or trust-boundary file access. The mitigations map as planned: T-242-06 by the equality guard (W1 RED/GREEN), T-242-07 by the four-character trim (K1), T-242-08 by P2, T-242-09 by the four REVOKEs plus the verify block's owner-alone check (G1 twin still bites), T-242-10 by the refusal tail built from the constant (C3 twin still bites).

## Expected reds until plans 03 to 05 land

The censuses that count arms are stale by design at this commit and are plan 05's: the corpus holds 1082 annotated twins against `ARMS_FLOOR` 1079 (the vitest ratchet `src/__tests__/mutation-runner-floors.test.ts` reads a floor below the measured value as stale) and `.github/workflows/ci.yml` still carries `test_cron_sync_tick.sql 8` in its per-file sentinel table and the matching `ARMS_FLOOR=` sum, while the file now prints `ALL 11 ARMS EXECUTED`. The full-corpus runner (`node scripts/mutation-runner/run.mjs` with no `--file`) was NOT run in this plan; only `--file` for the cron_sync gate and `--parse-only` were. The other three gates are untouched and still GREEN against their current apply lists (they do not yet apply the new migration in their own runs); plans 03 and 04 must repoint their twins in the same change that appends the new migration to their lists, or those twins report `no-red`.

## Left for other plans (not done here by design)

Plans 03 and 04 repoint the other three gates and add their W1, K1, U3 arms; plan 05 owns the censuses and floors (`ARMS_FLOOR`, ci.yml `ARMS_FLOOR` sum, per-file sentinel row, `SENTINEL_FLOOR`). The orchestrator owns VERSION, CHANGELOG, STATE.md and ROADMAP.md. Not run here, by instruction: any remote database command, `supabase` CLI, Docker.

## Self-Check: PASSED

All seven code files and the three code commits (`97134ae0f`, `f90abb8d5`, `90fb53e93`) exist and are ancestors of HEAD; the SUMMARY carries the three PROOF-01 rows and the `## P2 naming` section.

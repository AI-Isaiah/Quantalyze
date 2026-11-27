---
phase: 242-secretshygiene-the-full-history-is-scanned-on-a-schedule-and
plan: 03
subsystem: database
tags: [security, postgres, mutation-gate, pg-net, vault, PROOF-01, SECR-04]
requires: ["242-02"]
provides:
  - "supabase/tests/test_prod_prober_cadence.sql: seven twins repointed at 20261127120000_cron_destinations_exact.sql, arms W1 and K1, sentinel ALL 9 ARMS EXECUTED"
  - "supabase/tests/test_ops_staleness_check.sql: thirteen edit-kind twins repointed, arms W1 and K1, sentinel ALL 16 ARMS EXECUTED"
affects: [242-05, 242-06]
tech-stack:
  added: []
  patterns: ["twin finds measured by grep -aFc / offset counting on the final migration, nth selecting the body in the pinned function order"]
key-files:
  created: []
  modified:
    - supabase/tests/test_prod_prober_cadence.sql
    - supabase/tests/test_ops_staleness_check.sql
decisions:
  - "Both new arms in the ops gate sit after S11 and before G1, each with its own setup; W1 plants its own stale cron_sync row instead of leaning on S11's leftovers"
  - "Prober K1 deletes its whitespace secret at its end so N1-SETUP's create_secret still yields exactly one row"
metrics:
  duration: "about 5 minutes of wall clock by the executor's own start stamp"
  completed: 2026-11-27
status: complete
actuals:
  tokens: 21000
  tasks: 3
  commits: 2
plan_head_before: 1808fa0b3ad6f26efaba1d2a26918fc41fa2974e
plan_head_after: 9ca1f0b977617b2e453693daea59cb7d056a617e
requirements-completed: [SECR-04]
---

# Phase 242 Plan 03: prober and ops gates measure the exact-origin bodies Summary

The prober gate (9 arms) and the ops gate (16 arms) now mutate the live definitions in `20261127120000_cron_destinations_exact.sql`, and each proves by a new W1 arm that a `*.up.railway.app` sibling is refused by name with nothing posted, and by a new K1 arm that a key of space, tab, carriage return and newline is refused by name with nothing posted. All four new arms were observed RED first on a byte-backed-up copy and GREEN after a `cp` and `cmp` restore.

## Commits

| Task | Commit | Files |
|---|---|---|
| 1 (tracer) | `972954e8a` test(242-03): prober gate measures the exact-origin body; arms W1 and K1 | supabase/tests/test_prod_prober_cadence.sql |
| 2 | `9ca1f0b97` test(242-03): ops gate measures the exact-origin body; arms W1 and K1 | supabase/tests/test_ops_staleness_check.sql |
| 3 | no commit by design (PROOF-01 cycles commit nothing); evidence is this file | this SUMMARY |
| SUMMARY | this file's own commit | 242-03-SUMMARY.md |

`commits: 2` in the frontmatter is `git rev-list --count plan_head_before..plan_head_after`, measured from the ledger file `gsd-plan-head-before-242-03` at SUMMARY write time; the SUMMARY commit follows it.

## Twin measurements (needles counted in plan 02's final migration)

Function order in the migration (pinned): `match_engine_cron_tick`, `prod_prober_cadence_check` (second), `cron_sync_tick`, `ops_staleness_check` (fourth).

Prober gate (7 repointed twins, all `nth` 2 where the needle repeats):

| arm | needle | occurrences | nth |
|---|---|---|---|
| G1 | `v_stale := (now() - v_last > c_contact_ceiling);` | 1 | none |
| S1 | `c_contact_ceiling CONSTANT INTERVAL := '10 hours 25 minutes';` | 1 | none |
| O1 | `CASE WHEN v_stale THEN 'error' ELSE 'ok' END,` line | 1 | none |
| A1 | the five-line `IF v_last IS NULL` block | 1 | none |
| U1 | new guard line + refusal (new "Allowed: exactly %" tail) + `END IF;` (find text changed) | 4 | 2 |
| V1 | `IF v_key IS NULL OR btrim(v_key, E' \t\r\n') = '' THEN` (find text changed) | 4 | 2 |
| N1 | `   WHERE cron_name = 'prod_prober';` | 1 | none |
| W1 (new) | `IF NOT (v_url = ANY (c_allowed_origins)) THEN` | 4 | 2 |
| K1 (new) | the same key-guard line as V1 | 4 | 2 |

Ops gate (13 repointed edit-kind twins, S1 to S9, S12 and S11 occur once each so carry no `nth`; the G1 `sql` twin is untouched):

| arm | needle | occurrences | nth |
|---|---|---|---|
| S10 | `IF NOT (v_url = ANY (c_allowed_origins)) THEN` (find text changed) | 4 | 4 |
| S13 | `...Allowed: exactly %', array_to_string(c_allowed_origins, ' or ');` replaced by the same plus ` (%)` and `, v_url` (find text changed) | 4 | 4 |
| W1 (new) | `IF NOT (v_url = ANY (c_allowed_origins)) THEN` | 4 | 4 |
| K1 (new) | the key-guard line | 4 | 4 |

Counts were taken by byte-offset scanning of the migration for each needle, and the `nth` was chosen as the occurrence whose offset falls inside the named function's `CREATE OR REPLACE` span. The runner's own `occurrence-mismatch` check would have failed the run on any miscount; none fired.

## Runner output: `node scripts/mutation-runner/run.mjs --file supabase/tests/test_prod_prober_cadence.sql`

Exit 2 (narrowed diagnostic, never exits 0). Complete output from the `baseline` line onward; omissions are blank lines and the `unreachable:` line (a 27-name list, not about this plan).

```
  baseline  supabase/tests/test_prod_prober_cadence.sql — exit 0 (1.1s)
  arm G1                       exit   3  RED (identity ok)  (1.1s)
  arm S1                       exit   3  RED (identity ok)  (1.1s)
  arm O1                       exit   3  RED (identity ok)  (1.0s)
  arm A1                       exit   3  RED (identity ok)  (1.1s)
  arm U1                       exit   3  RED (identity ok)  (1.1s)
  arm W1                       exit   3  RED (identity ok)  (1.2s)
  arm V1                       exit   3  RED (identity ok)  (1.3s)
  arm K1                       exit   3  RED (identity ok)  (1.2s)
  arm N1                       exit   3  RED (identity ok)  (1.0s)
  restore   supabase/tests/test_prod_prober_cadence.sql — exit 0 (1.1s)
coverage: files 96/123
lane-blocked: 0 file(s) probe pg_extension for pg_cron and are not yet annotated — (none; the lane hosts pg_cron since Phase 164.4.1, TODOS [REDUNDER-PGCRON] retired 2026-09-05)
lane-probe: pg_cron AVAILABLE — lane-blocked class is empty, as a hosting lane requires
  pending: 0 idiom file(s) without RED-UNDER — 
arms: 9/9/0   (executed/annotated/waived)
biting: 9   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)
lane-invocations: 9   (arm lanes actually spawned — tallied inside runLane, independent of the 9 the verdict loop counted; plus 1 baseline / 1 restore leg(s))
  file test_prod_prober_cadence.sql: sections 9 / judged 9 / annotated 9 / waived 0 / biting 9
per-arm lane time: mean 1.1s over 9 arm run(s)
⚠️ NARROWED DIAGNOSTIC RUN (--file/--arm): coverage floors NOT enforced.
   This mode never exits 0, so it can never be mistaken for a passing gate.
No defects in the narrowed scope.
```

## Runner output: `node scripts/mutation-runner/run.mjs --file supabase/tests/test_ops_staleness_check.sql`

Exit 2. Same omissions.

```
  baseline  supabase/tests/test_ops_staleness_check.sql — exit 0 (2.8s)
  arm S1                       exit   3  RED (identity ok)  (2.0s)
  arm S2                       exit   3  RED (identity ok)  (1.9s)
  arm S3                       exit   3  RED (identity ok)  (2.4s)
  arm S4                       exit   3  RED (identity ok)  (3.9s)
  arm S5                       exit   3  RED (identity ok)  (3.2s)
  arm S6                       exit   3  RED (identity ok)  (2.9s)
  arm S7                       exit   3  RED (identity ok)  (2.5s)
  arm S8                       exit   3  RED (identity ok)  (2.2s)
  arm S12                      exit   3  RED (identity ok)  (2.0s)
  arm S9                       exit   3  RED (identity ok)  (1.9s)
  arm S10                      exit   3  RED (identity ok)  (2.1s)
  arm S13                      exit   3  RED (identity ok)  (2.8s)
  arm S11                      exit   3  RED (identity ok)  (2.7s)
  arm W1                       exit   3  RED (identity ok)  (2.2s)
  arm K1                       exit   3  RED (identity ok)  (2.2s)
  arm G1                       exit   3  RED (identity ok)  (2.1s)
  restore   supabase/tests/test_ops_staleness_check.sql — exit 0 (2.1s)
coverage: files 96/123
lane-blocked: 0 file(s) probe pg_extension for pg_cron and are not yet annotated — (none; the lane hosts pg_cron since Phase 164.4.1, TODOS [REDUNDER-PGCRON] retired 2026-09-05)
lane-probe: pg_cron AVAILABLE — lane-blocked class is empty, as a hosting lane requires
  pending: 0 idiom file(s) without RED-UNDER — 
arms: 16/16/0   (executed/annotated/waived)
biting: 16   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)
lane-invocations: 16   (arm lanes actually spawned — tallied inside runLane, independent of the 16 the verdict loop counted; plus 1 baseline / 1 restore leg(s))
  file test_ops_staleness_check.sql: sections 16 / judged 16 / annotated 16 / waived 0 / biting 16
per-arm lane time: mean 2.5s over 16 arm run(s)
⚠️ NARROWED DIAGNOSTIC RUN (--file/--arm): coverage floors NOT enforced.
   This mode never exits 0, so it can never be mistaken for a passing gate.
No defects in the narrowed scope.
```

W1 and K1 were GREEN against the real migration before their twins mattered: the runner's `baseline` leg (exit 0, no mutation) ran both arms in each gate, and ran after the arms and twins were written.

## PROOF-01

Neuter applied to the named body only (the twin's own find and replace at its `nth`, by a byte-exact replace script, `git diff --stat` showing one file, one line changed each time), run on the pg-lane, never committed. Lane command in every row: `bash scripts/pg-lane/run.sh --workdir <scratchpad>/w --apply <the gate's RED-UNDER-SETUP list, in order, new migration last> --gate <gate>`. Byte backup `cp supabase/migrations/20261127120000_cron_destinations_exact.sql <scratchpad>/mig.bak-<id>`; restore `cp <backup> <migration>`, then `cmp <backup> <migration>` and `git diff --quiet -- <migration>`.

| id | neuter | command | RED | cmp | GREEN |
|---|---|---|---|---|---|
| E-01 prober W1 | prober body (nth 2 of 4) guard restored to the old suffix rule (`IF v_url !~ '^(https://[a-z0-9][a-z0-9.-]*\.up\.railway\.app\|http://127\.0\.0\.1:9)$' THEN`) | manual lane command above, gate `supabase/tests/test_prod_prober_cadence.sql` | RED: lane exit 3, first `TEST FAILED (W1)`, full line below | cmp: exit 0, no output; `git diff --quiet` exit 0 | GREEN: lane exit 0, `ALL 9 ARMS EXECUTED (G1,S1,O1,A1,U1,W1,V1,K1,N1)`, full line below |
| E-02 prober K1 | prober body (nth 2 of 4) key guard restored to the old spaces-only trim (`IF v_key IS NULL OR btrim(v_key) = '' THEN`) | same, prober gate | RED: lane exit 3, first `TEST FAILED (K1)`, full line below | cmp: exit 0, no output; `git diff --quiet` exit 0 | GREEN: lane exit 0, `ALL 9 ARMS EXECUTED (G1,S1,O1,A1,U1,W1,V1,K1,N1)` |
| E-03 ops W1 | ops body (nth 4 of 4) guard restored to the old suffix rule (same replacement text) | same, gate `supabase/tests/test_ops_staleness_check.sql` | RED: lane exit 3, first `TEST FAILED (W1)`, full line below | cmp: exit 0, no output; `git diff --quiet` exit 0 | GREEN: lane exit 0, `ALL 16 ARMS EXECUTED (S1,S2,S3,S4,S5,S6,S7,S8,S12,S9,S10,S13,S11,W1,K1,G1)`, full line below |
| E-04 ops K1 | ops body (nth 4 of 4) old spaces-only key guard | same, ops gate | RED: lane exit 3, first `TEST FAILED (K1)`, full line below | cmp: exit 0, no output; `git diff --quiet` exit 0 | GREEN: lane exit 0, `ALL 16 ARMS EXECUTED (S1,S2,S3,S4,S5,S6,S7,S8,S12,S9,S10,S13,S11,W1,K1,G1)` |

The lines below are the complete first `TEST FAILED` line (`grep -a 'TEST FAILED' | head -1` on the RED run) and the complete sentinel line (`grep -a 'ARMS EXECUTED'` on the GREEN run), uncut. The GREEN sentinel of E-01 and E-02 is byte-identical (checked with `cmp`), as is the GREEN sentinel of E-03 and E-04, so it is quoted once per gate.

E-01 prober W1 RED:

```
psql:supabase/tests/test_prod_prober_cadence.sql:780: ERROR:  P0001: TEST FAILED (W1): with analytics_service_url set to a sibling host under the same Railway domain as the production origin, prod_prober_cadence_check() did not refuse by name — raised=f, message: NULL. A suffix rule admits any subdomain anyone can register, so the Vault-held service key would leave in an X-Service-Key header to a host nobody chose.
```

E-02 prober K1 RED:

```
psql:supabase/tests/test_prod_prober_cadence.sql:780: ERROR:  P0001: TEST FAILED (K1): prod_prober_cadence_check() RETURNED with an analytics_service_key made of a space, a tab, a carriage return and a newline. None of them is a usable key, and a guard that trims spaces only lets the rest through to a header the analytics service answers 401 to, asynchronously.
```

E-01 and E-02 GREEN (prober gate):

```
psql:supabase/tests/test_prod_prober_cadence.sql:780: NOTICE:  00000: ALL 9 ARMS EXECUTED (G1,S1,O1,A1,U1,W1,V1,K1,N1): public.prod_prober_cadence_check() returns NULL and posts NOTHING on a fresh prod_prober contact row (G1), writing exactly one self-observability row with status=ok — and posts EXACTLY ONE alert to /api/prober-cadence-alert, carrying a non-blank X-Service-Key header, on a stale one (S1), returning a non-NULL request id. The observer's own row lands on BOTH branches with the right status, and its metadata carries only gap_minutes/ceiling/contact_cron_name (O1). An ABSENT contact row is read as STALE, never healthy (A1) — the loudest signal this function can give, not a silent one. The destination survives its CHECK constraint being dropped, because the callable re-tests the same allow-list itself before it ever builds a header (U1), and that allow-list is exactly two origins by equality, so a sibling host under the production origin's own Railway domain is refused by name with nothing posted (W1). A missing key produces a REFUSAL, never a header with a null value (V1), and so does a key made of a space, a tab, a carriage return and a newline (K1). A fresh row under a DIFFERENT cron_name does not mask the prober's own silence (N1) — the contact read is narrowed to ONE producer, never a scan admitting every producer this table has. Phase 164.1.1 / plan 02 / criterion 3, mig 20260918120000; re-based by Phase 242 / plan 03, mig 20261127120000.
```

E-03 ops W1 RED:

```
psql:supabase/tests/test_ops_staleness_check.sql:928: ERROR:  P0001: TEST FAILED (W1): with analytics_service_url set to a sibling host under the same Railway domain as the production origin, ops_staleness_check() did not refuse by name — raised=f, message: NULL. A suffix rule admits any subdomain anyone can register, so the Vault-held service key would leave in an X-Service-Key header to a host nobody chose.
```

E-04 ops K1 RED:

```
psql:supabase/tests/test_ops_staleness_check.sql:928: ERROR:  P0001: TEST FAILED (K1): ops_staleness_check() RETURNED with an analytics_service_key made of a space, a tab, a carriage return and a newline. None of them is a usable key, and a guard that trims spaces only lets the rest through to a header the analytics service answers 401 to, asynchronously.
```

E-03 and E-04 GREEN (ops gate):

```
psql:supabase/tests/test_ops_staleness_check.sql:928: NOTICE:  00000: ALL 16 ARMS EXECUTED (S1,S2,S3,S4,S5,S6,S7,S8,S12,S9,S10,S13,S11,W1,K1,G1): public.ops_staleness_check() posts one alert to the analytics service's /api/prober-cadence-alert route, cron_name cron_sync, when no heartbeat ever ran (S1), when the newest is older than 2 days (S2: gap, key, body fields) and when the two newest rows are both error (S4); stays silent on a fresh ok heartbeat with an ok observer row (S3) and on one error beside an ok (S5); posts cron_name backfill when an eligible job waits unclaimed past the ceiling (S6) or a running job outlives the ceiling plus one watchdog tick (S8); stays silent beside a recent claim (S7), inside the extra tick (S12) and for a non-backfill kind (S9); refuses a destination outside the allow-list without echoing it and leaves no observer row (S10, S13); posts for both arms at once and returns 2 (S11); refuses a sibling host under the production origin's own Railway domain by name, because the destination is exactly two origins and not a suffix rule (W1), and a key made of a space, a tab, a carriage return and a newline (K1), posting nothing in either case; and EXECUTE is held by the owner alone on a SECURITY DEFINER body with a pinned search_path (G1). Phase 164.6.8 / plan 02 / D-10, D-11, mig 20261020120000; re-based by Phase 242 / plan 03, mig 20261127120000.
```

In each RED run psql aborted at the first `TEST FAILED`, and it named the arm under test, so each of the four arms fails first under its own neuter, and every arm before it in file order passed under that neuter. After the four cycles the migration is byte-identical to the committed file (`cmp` against each backup, `git status --short` clean before this file was written). The scratchpad backups are deleted.

## Lints

```
lint-sql-gates: scanned 123 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).
lint-sql-gates self-test OK: 7 rules, red+green each.
lint-app-guc self-test OK: 4 finding kinds, red+green each (11 red, 2 green fixtures; 2 kind(s) vitest-covered by declaration).
app-guc: findings 0
```

All four commands exited 0.

`gitleaks git . --no-banner --redact --config .gitleaks.toml --log-opts=1808fa0b3..9ca1f0b97` (this plan's two commits): `no leaks found`. No credential-shaped literal is in either gate: the whitespace key is the `E' \t\r\n'` literal and the other fixtures are the existing non-credential markers.

## Acceptance greps (final tree)

- Prober gate: old-file twins 0; `RED-UNDER-M:` 9; `ALL 9 ARMS EXECUTED (G1,S1,O1,A1,U1,W1,V1,K1,N1)` 1; new migration as last setup entry 1.
- Ops gate: old-file twins 0; `RED-UNDER-M:` 16; `ALL 16 ARMS EXECUTED (S1,S2,S3,S4,S5,S6,S7,S8,S12,S9,S10,S13,S11,W1,K1,G1)` 1; new migration as last setup entry 1.
- Task 1 precondition: migration file count 1, `242-02-SUMMARY.md` present, `bash scripts/pg-lane/run.sh --print-pgbin` printed `/opt/homebrew/opt/postgresql@16/bin`, `node scripts/verify-plan-anchors.mjs <242-03-PLAN.md>` printed `OK: 1 plan file(s), no stale claims.`.
- Task 3 acceptance: `grep -acE '^\| E-0[1-4] '` on this file prints 4, each RED cell naming its arm.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, fixture state] Prober K1 cleans up its own key**
- **Found during:** Task 1 design, read of N1-SETUP
- **Issue:** the plan places K1 directly after V1, before N1. K1 stores a whitespace secret, and N1-SETUP calls `vault.create_secret` without deleting first, so N1 would have seen two secrets of that name and raised `is not unique in vault` instead of reaching the contact read.
- **Fix:** K1 ends with `DELETE FROM vault.decrypted_secrets WHERE name = 'analytics_service_key';`, leaving the stand-in exactly as V1 left it. N1 is unchanged. The ops gate needs no such cleanup because G1 is a catalogue read.
- **Files modified:** supabase/tests/test_prod_prober_cadence.sql
- **Commit:** `972954e8a`

**2. [Process] Ops W1 plants its own stale heartbeat up front**
- The plan's step 2 allows this only as a fallback if W1 returned without raising. I did it up front because it makes the arm independent of S11's leftovers, the same choice the plan names for that fallback. The comment in the arm says so. W1 also puts the original url back afterwards (as S10 does), so K1 asks about the key alone.

**3. [Process] Neuters applied by a byte-exact replace script, not the Edit tool**
- The plan says apply the neuter with the Edit tool. The needles occur four times in the migration, so a unique Edit anchor would have needed surrounding context copied from one body. A small script applying each twin's own find and replace at its `nth` made the same one-line change with an exact count check. Each cycle printed `git diff --stat` (one file, one line), and the restore was `cp` plus `cmp` plus `git diff --quiet`, as specified.

**4. [Process] Executor start-up steps not performed**
- `init.execute-phase` and `state.load` were not run and the auto-mode flags were not read; the brief supplied the plan, directory and constraints. Task 1 is `type="tracer"` with no `gate` attribute and an automated-only `<verify>` (the `--file` run, exit 2, `arms: 9/9/0`); it was run and passed before any expansion, which is what the gate requires in every mode. The ledger file `gsd-plan-head-before-242-03` was written at start.

### Plan facts re-read, not deviations

- The ops gate's `G1` is a `sql` twin and was left untouched. It still bites because `GRANT EXECUTE ... TO service_role` acts on the live function whichever migration defined it.
- No migration was edited; no needle was ambiguous in plan 02's migration.

## Expected reds until plan 05 lands

The censuses that count arms are stale by design at this commit and are plan 05's: the corpus now holds four more annotated twins than plan 02 left (two arms in each of the two gates), so `ARMS_FLOOR` and the vitest ratchet in `src/__tests__/mutation-runner-floors.test.ts`, the `ARMS_FLOOR=` sum and per-file sentinel table in `.github/workflows/ci.yml` (prober row 7 to 9, ops row 14 to 16) and `SENTINEL_FLOOR` all need plan 05's re-measure. The full-corpus runner (no `--file`) was NOT run in this plan; only the two `--file` runs, both lint pairs and the manual lane cycles were.

## Auth gates

None.

## Known Stubs

None. No stub, placeholder or hardcoded-empty value was introduced.

## Threat Flags

None. These are test files; they add no endpoint, auth path or trust-boundary access. Mitigations map as planned: T-242-11 by W1 in each gate (RED first under the old suffix rule), T-242-12 by K1 in each gate (RED first under the old spaces-only guard), T-242-13 by the repointed twins with measured `occurrences` and `nth` (the runner reported `RED (identity ok)` for all 25 arms across both gates, so none mutates dead text).

## Self-Check: PASSED

Both gate files exist and carry the new sentinels; commits `972954e8a` and `9ca1f0b97` are ancestors of HEAD; `git status --short` listed nothing but this SUMMARY before it was written; the PROOF-01 table has rows E-01 to E-04.

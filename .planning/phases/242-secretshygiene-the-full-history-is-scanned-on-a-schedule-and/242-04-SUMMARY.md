---
phase: 242-secretshygiene-the-full-history-is-scanned-on-a-schedule-and
plan: 04
subsystem: database
tags: [security, postgres, mutation-gate, rollback, pg-net, vault, PROOF-01, SECR-04]
requires: [242-02]
provides:
  - "supabase/tests/test_analytics_service_settings_and_vault_tick.sql: arms U3, W1, K1; six twins repointed at the new migration; setup list ends with it; sentinel ALL 16 ARMS EXECUTED"
  - "supabase/migrations/down/20261127120000-rollback.sql: plan 02's rollback, extended with a function-body precondition and a stricter postcondition, proven by the base-commit gates"
affects: [242-05, 242-06]
key-files:
  modified:
    - supabase/tests/test_analytics_service_settings_and_vault_tick.sql
    - supabase/migrations/down/20261127120000-rollback.sql
decisions:
  - "D1's twin now narrows the CHECK to the production origin alone instead of a suffix pattern (see Deviations 1)"
  - "W1 puts the url row back to C2's foreign host after its assertion, so V2 and K1 keep their egress backstop"
metrics:
  duration: "not timed (no start timestamp was recorded)"
  completed: 2026-11-27
status: complete
actuals:
  tokens: 36000
  tasks: 3
  commits: 2
plan_head_before: 1808fa0b3ad6f26efaba1d2a26918fc41fa2974e
plan_head_after: 3f49a3be9e2530f803c67e233a53b69726dd8b36
requirements-completed: [SECR-04]
---

# Phase 242 Plan 04: analytics settings gate proves the exact-origin CHECK and match-engine body, and the rollback is tested Summary

The analytics settings gate now binds the CHECK and `match_engine_cron_tick()` to exactly two origins by equality, with three new twinned arms (U3, W1, K1) each shown RED first and GREEN after a byte-exact restore, and the migration's manual rollback was extended and proven on the pg-lane against the base-commit gates.

## Commits

| Task | Commit | Files |
|---|---|---|
| 1 (tracer) | `b189cc50a` test(242-04): analytics settings gate measures the exact-origin CHECK and match-engine body; arms U3, W1, K1 | supabase/tests/test_analytics_service_settings_and_vault_tick.sql |
| 2 | `3f49a3be9` feat(242-04): manual rollback for the exact-origin migration, proven by the base-commit gates | supabase/migrations/down/20261127120000-rollback.sql |
| 3 | this file's own commit | 242-04-SUMMARY.md |

`commits: 2` is `git rev-list --count 1808fa0b3..3f49a3be9` (the plan's own two code commits). The ledger file `gsd-plan-head-before-242-04` was never written in this worktree (no start step ran), so the base is the worktree's fork point, recorded in `plan_head_before`.

## Gate census and needles (measured on plan 02's final migration, `grep -aFc`)

| needle | occurrences | `nth` | twins |
|---|---|---|---|
| key guard `IF v_key IS NULL OR btrim(v_key, E' \t\r\n') = '' THEN` | 4 | 1 | V1, V2, K1 |
| `IF v_url IS NULL OR v_url = '' THEN` | 4 | 1 | U1 |
| `WHERE s.key = 'analytics_service_url'` | 4 | 1 | C1 |
| `IF NOT (v_url = ANY (c_allowed_origins)) THEN` | 4 | 1 | C2, W1 |
| refusal tail `Allowed: exactly %', array_to_string(c_allowed_origins, ' or ');` | 4 | 1 | C3 |

`nth` 1 is the match-engine body, first in the pinned order. R3 still names `20260907120000` (its REVOKE edit targets a table statement the new migration does not restate). The setup list ends with the new migration.

Arm placement: U3 between U2's assertion and the CHECK-drop block, with a `U3-SETUP` guard that no url row exists; W1 after C3 (its setup points the row at the sibling host `https://not-quantalyze.up.railway.app`, and it restores the row to C2's foreign host afterwards); K1 after V2, with V2's own delete-then-`vault.create_secret` pattern and a `K1-SETUP` guard. None of the three posts anything on the real migration (U3 makes no call; W1 and K1 refuse before a request is built).

## Runner output: `node scripts/mutation-runner/run.mjs --file supabase/tests/test_analytics_service_settings_and_vault_tick.sql`

Exit 2 (the narrowed diagnostic mode never exits 0). Complete output from the `baseline` line onward; omitted: blank lines and the `unreachable:` list of 27 file names (not about this plan).

```
  baseline  supabase/tests/test_analytics_service_settings_and_vault_tick.sql — exit 0 (1.4s)
  arm 0                        exit   3  RED (identity ok)  (1.8s)
  arm V1                       exit   3  RED (identity ok)  (1.8s)
  arm U1                       exit   3  RED (identity ok)  (1.8s)
  arm U2                       exit   3  RED (identity ok)  (2.2s)
  arm U3                       exit   3  RED (identity ok)  (2.7s)
  arm C1                       exit   3  RED (identity ok)  (2.4s)
  arm C2                       exit   3  RED (identity ok)  (2.2s)
  arm C3                       exit   3  RED (identity ok)  (2.4s)
  arm W1                       exit   3  RED (identity ok)  (1.9s)
  arm V2                       exit   3  RED (identity ok)  (1.8s)
  arm K1                       exit   3  RED (identity ok)  (1.7s)
  arm R1                       exit   3  RED (identity ok)  (2.1s)
  arm R2                       exit   3  RED (identity ok)  (2.1s)
  arm R3                       exit   3  RED (identity ok)  (1.9s)
  arm T1                       exit   3  RED (identity ok)  (2.1s)
  arm G1                       exit   3  RED (identity ok)  (1.8s)
  arm D1                       exit   3  RED (identity ok)  (2.3s)
  restore   supabase/tests/test_analytics_service_settings_and_vault_tick.sql — exit 0 (1.7s)
coverage: files 96/123
lane-blocked: 0 file(s) probe pg_extension for pg_cron and are not yet annotated — (none; the lane hosts pg_cron since Phase 164.4.1, TODOS [REDUNDER-PGCRON] retired 2026-09-05)
lane-probe: pg_cron AVAILABLE — lane-blocked class is empty, as a hosting lane requires
  pending: 0 idiom file(s) without RED-UNDER — 
arms: 17/17/0   (executed/annotated/waived)
biting: 17   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)
lane-invocations: 17   (arm lanes actually spawned — tallied inside runLane, independent of the 17 the verdict loop counted; plus 1 baseline / 1 restore leg(s))
  file test_analytics_service_settings_and_vault_tick.sql: sections 17 / judged 17 / annotated 17 / waived 0 / biting 17
per-arm lane time: mean 2.0s over 17 arm run(s)
⚠️ NARROWED DIAGNOSTIC RUN (--file/--arm): coverage floors NOT enforced.
   This mode never exits 0, so it can never be mistaken for a passing gate.
No defects in the narrowed scope.
```

The first full run, before D1's twin was corrected, printed `arms: 17/17/0`, `biting: 16` and one defect, `wrong-first-failure D1 — first failure was "U3", not "D1"` (see Deviations 1).

Census effect for plan 05: this gate moves from 13 to 16 sentinel arms (14 to 17 annotated twins, `RED-UNDER-M:` count 14 to 17), so the corpus total moves by +3 from this plan; the ci.yml per-file sentinel row and the `ARMS_FLOOR` sum for this file are plan 05's.

## Rollback (Task 2)

Plan 02 had already created `supabase/migrations/down/20261127120000-rollback.sql`, so this plan verified and extended it instead of writing it (Deviations 2).

Verified unchanged: header (manual, `psql --single-transaction`, marker query first, what it undoes, ROLLING BACK RE-OPENS BOTH DEFECTS, ledger row left in place with the `migration repair` note), `SET LOCAL lock_timeout = '3s';`, no transaction statements, the restored CHECK predicate and COMMENT text equal to `20260907120000_analytics_service_settings_and_vault_tick.sql`, four owner-alone REVOKEs. The four restored `CREATE OR REPLACE FUNCTION … $tag$;` blocks were compared in Python against `git show dc91a3a2f:supabase/schema/functions/<fn>.sql` (the pre-migration snapshots, identical on origin/main): match_engine_cron_tick, prod_prober_cadence_check, cron_sync_tick and ops_staleness_check all `EQUAL` byte for byte (4682, 7175, 3795, 9288 characters).

Extended: the precondition now also refuses unless all four functions exist and each `pg_get_functiondef` contains `c_allowed_origins`; the postcondition now also requires the CHECK text to contain the suffix rule's character class `[a-z0-9][a-z0-9.-]*` and every body to carry `c_url_allowed` and no `c_allowed_origins`.

Lane runs (apply list = the gate's own setup list, which ends with the new migration, then the rollback; gate = the saved base-commit copy from `git show origin/main:`, byte-identical to `dc91a3a2f`):

```
cron_sync base gate after migration + rollback:    exit 0   ALL 8 ARMS EXECUTED (0,P1,V1,V2,U1,C2,C3,G1)
analytics base gate after migration + rollback:    exit 0   ALL 13 ARMS EXECUTED (0,V1,U1,U2,C1,C2,C3,V2,R1,R2,R3,T1,G1)
analytics base gate, rollback listed twice:        exit 3   psql:supabase/migrations/down/20261127120000-rollback.sql:69: ERROR:  P0001: Rollback 20261127120000 refused: the deployed CHECK is not the exact two-origin one, so this database does not carry the migration being rolled back. Nothing was changed. It reads: CHECK (((key <> 'analytics_service_url'::text) OR (value ~ '^(https://[a-z0-9][a-z0-9.-]*\.up\.railway\.app|http://127\.0\.0\.1:9)$'::text)))
```

Two extra lane runs, beyond the plan, because the base gates pass against the new migration too (they never test a sibling) and so do not by themselves show the rollback reverted anything:

- The CURRENT analytics gate after migration + rollback exits 3 with the first failure `TEST FAILED (U3)` (the suffix CHECK stores the sibling), which shows the rollback really restored the previous CHECK.
- A `DROP FUNCTION public.ops_staleness_check()` file applied before the rollback makes the precondition's function branch refuse: `Rollback 20261127120000 refused: public.ops_staleness_check() does not exist. Nothing was changed. Run the marker query in this file's header first.` The other new branches (a function that exists without `c_allowed_origins`, and the postcondition's raises) were not forced.

`node scripts/lint-app-guc.mjs`: `app-guc: findings 0`. `npx vitest run src/__tests__/phase-29-frozen-spine-guards.test.ts --testTimeout=120000`: 7 passed. `ls supabase/migrations/down/ | grep -cE '^[0-9]{14}-rollback\.sql$'` prints 88.

## PROOF-01

Neuter applied to a working copy of the migration only, never committed; the lane runs `bash scripts/pg-lane/run.sh --workdir <scratchpad>/w --apply <the gate's RED-UNDER-SETUP list, new migration last> --gate supabase/tests/test_analytics_service_settings_and_vault_tick.sql`. Byte backup `cp supabase/migrations/20261127120000_cron_destinations_exact.sql <scratchpad>/mig.bak-<id>`; restore `cp <backup> <migration>`, then `cmp <backup> <migration>` and `git diff --quiet -- <migration>` (both exit 0). The three GREEN runs printed byte-identical sentinel lines (md5 equal); the line is printed once below.

| id | neuter | command | RED | cmp | GREEN |
|---|---|---|---|---|---|
| F-01 U3 | (a) the `ADD CONSTRAINT` predicate of the migration restored to the suffix regex; (b) real migration plus `--post-apply` file holding the U3 twin's `ALTER TABLE … DROP CONSTRAINT …, ADD CONSTRAINT …` statement | (a) the manual lane command above; (b) the same plus `--post-apply <scratchpad>/u3twin.sql` | RED (a): the apply aborts naming the CHECK (lane exit 3), full line below; RED (b): first `TEST FAILED (U3)` (lane exit 3), full line below | cmp: exit 0, no output; `git diff --quiet` exit 0 | GREEN: lane exit 0, `ALL 16 ARMS EXECUTED (0,V1,U1,U2,U3,C1,C2,C3,W1,V2,K1,R1,R2,R3,T1,G1)` |
| F-02 W1 | match-engine destination guard (`nth` 1) restored to the old suffix regex `IF v_url !~ '^(https://[a-z0-9][a-z0-9.-]*\.up\.railway\.app\|http://127\.0\.0\.1:9)$' THEN` | the manual lane command above | RED: first `TEST FAILED (W1)` (lane exit 3), full line below | cmp: exit 0, no output; `git diff --quiet` exit 0 | GREEN: lane exit 0, `ALL 16 ARMS EXECUTED (0,V1,U1,U2,U3,C1,C2,C3,W1,V2,K1,R1,R2,R3,T1,G1)` |
| F-03 K1 | match-engine key guard (`nth` 1) restored to the old spaces-only trim `IF v_key IS NULL OR btrim(v_key) = '' THEN` | the manual lane command above | RED: first `TEST FAILED (K1)` (lane exit 3), full line below | cmp: exit 0, no output; `git diff --quiet` exit 0 | GREEN: lane exit 0, `ALL 16 ARMS EXECUTED (0,V1,U1,U2,U3,C1,C2,C3,W1,V2,K1,R1,R2,R3,T1,G1)` |

Each cycle ran backup, neuter, RED run, `cp` restore, `cmp`, `git diff --quiet`, GREEN run, in that order, one cycle at a time. After F-03 `cmp` against the first backup also exits 0 and `git status --short` was empty.

F-01 RED (a), the migration's own verify block biting (the apply-time layer; the gate never ran):

```
psql:supabase/migrations/20261127120000_cron_destinations_exact.sql:823: ERROR:  P0001: Migration 20261127120000: the CHECK does not carry both allowed origins as quoted literals; it reads: CHECK (((key <> 'analytics_service_url'::text) OR (value ~ '^(https://[a-z0-9][a-z0-9.-]*\.up\.railway\.app|http://127\.0\.0\.1:9)$'::text)))
```

F-01 RED (b):

```
psql:supabase/tests/test_analytics_service_settings_and_vault_tick.sql:914: ERROR:  P0001: TEST FAILED (U3): public.system_settings STORED analytics_service_url pointing at a sibling of the production origin under the same Railway domain — the row count for that key is now 1 and the write returned SQLSTATE none — the write succeeded (23514 = the constraint refusing it, which is what should have happened). A pattern rule admits every subdomain anyone can register there, and that row is the host public.match_engine_cron_tick() POSTs the Vault-held analytics service key to. system_settings_admin_all is FOR ALL TO authenticated, so any app-admin reaches it with one PATCH through PostgREST. U2 cannot see this: its host is outside the pattern too. ⛔ Do NOT "fix" a red here by widening the CHECK to admit the value: the set is the production origin and the loopback discard literal, compared by equality.
```

F-02 RED:

```
psql:supabase/tests/test_analytics_service_settings_and_vault_tick.sql:914: ERROR:  P0001: TEST FAILED (W1): with analytics_service_url set to a sibling of the production origin under the same Railway domain and the CHECK constraint dropped, match_engine_cron_tick() did not refuse by name — raised=t, message: schema "net" does not exist. A suffix rule admits any subdomain anyone can register, so the Vault-held service key would leave in an X-Service-Key header to a host nobody chose, and net.http_post is fire-and-forget, so nothing downstream would ever report where it went.
```

(The sibling passes the neutered guard and the call reaches `net.http_post`, which the lane lacks; on a lane with a real pg_net that mutant would post. That is why the mutant exists only in the twin and the neuter, never in a committed file.)

F-03 RED:

```
psql:supabase/tests/test_analytics_service_settings_and_vault_tick.sql:914: ERROR:  P0001: TEST FAILED (K1): the callable did raise with a four-character blank secret present, but its message does not name analytics_service_key — it reads: analytics_service_url in system_settings is not an allowed destination — refusing to post the analytics service key. The offending value is deliberately NOT echoed here; read it with an admin session. Allowed: exactly https://quantalyze-analytics-production.up.railway.app or http://127.0.0.1:9. The guard must refuse by V1's own name so an operator and the cron-obs prober meet one message for "the key is not usable"; a message about the destination means the key guard let the blank key through and the destination re-test caught it instead.
```

GREEN (identical for F-01, F-02 and F-03; `grep -a 'ARMS EXECUTED'` of the lane output, uncut):

```
psql:supabase/tests/test_analytics_service_settings_and_vault_tick.sql:914: NOTICE:  00000: ALL 16 ARMS EXECUTED (0,V1,U1,U2,U3,C1,C2,C3,W1,V2,K1,R1,R2,R3,T1,G1): public.match_engine_cron_tick() RAISES by name when the analytics_service_key secret is absent from the vault (V1) and when the analytics_service_url row is absent from system_settings (U1) — each measured by removing that value inside this transaction and calling the real function, never by inspecting its body — and gets PAST both guards when both are present (C1), which is what stops a callable that refuses unconditionally from passing V1 and U1 while posting nothing forever. The DESTINATION is bounded in two independent layers, each an EXACT SET of two origins compared by equality and never a pattern: public.system_settings will not STORE a url outside it (U2), nor a sibling host under the production origin's own Railway domain (U3), and with that CHECK constraint dropped — one ALTER TABLE, which this file performs on itself — the callable still REFUSES to post to a foreign host (C2) or to that sibling (W1) without naming the value it refused (C3). public.system_settings is unreadable by anon at both the grant layer and the policy layer (R1), unwritable by an authenticated non-admin (R2), writable by the service role (R3), and not TRUNCATABLE by an authenticated user (T1) — the one statement row security never sees. A secret that is present but BLANK — a single space, which is neither absence nor the empty string (V2), or a space, a tab, a carriage return and a newline (K1) — is refused by the same name, so neither the pre-164.8.6 guard nor a guard that trims spaces only can let a useless key out behind a green job history. And EXECUTE on the callable is held by exactly the owner and nobody else (G1) — the WHOLE grantee set, not the anon/authenticated subset, which is how service_role kept its grant through Phase 164.7. So the host a live service key is POSTed to cannot be read, redirected or erased by anyone a browser can be, and the callable itself cannot be invoked by anyone but the scheduler. Phase 164.7 / criterion 2 / SC-2, mig 20260907120000; Phase 164.8.6 criteria 2-4, mig 20260911120000; Phase 242 SECR-04, mig 20261127120000.
```

## Lints

```
lint-sql-gates: scanned 123 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).
lint-sql-gates self-test OK: 7 rules, red+green each.
lint-app-guc self-test OK: 4 finding kinds, red+green each (11 red, 2 green fixtures; 2 kind(s) vitest-covered by declaration).
app-guc: findings 0
```

Acceptance greps on the final tree: `"file":"…20260911120000_vault_tick_hardening.sql"` 0; R3's `20260907120000` file entry 1; `RED-UNDER-M:` 17; the sixteen-arm roster 1; `ARMS EXECUTED` 4 (unchanged from HEAD).

## Deviations from Plan

**1. [Rule 1 - Bug] D1's twin went `wrong-first-failure` once U3 existed**
- **Found during:** Task 1, first runner pass (`arms 17/17/0`, `biting 16`).
- **Issue:** D1's `sql` twin narrowed the CHECK to a suffix pattern with no loopback alternative. That pattern admits U3's sibling host, so Part 1's U3 became the first failure and D1 could not be.
- **Fix:** the twin now narrows the CHECK to `value = '<production origin>'` alone. Part 1 stays green under it (U2's foreign host and U3's sibling are both refused, C1's loopback insert happens after the file drops the CHECK) and D1's leg (b) is the only failure, as its own prose requires. The prose RED-UNDER above it and the stale "STAYS AT THIRTEEN" header sentence were reworded to match. Runner re-run: `17/17/0`, `biting: 17`, every arm `RED (identity ok)`.
- **Files modified:** supabase/tests/test_analytics_service_settings_and_vault_tick.sql
- **Commit:** `b189cc50a`

**2. [Plan premise changed] The rollback already existed**
- Plan 02 created and committed the rollback (its Deviations 1), so Task 2's "create" became "verify and extend". I did not rewrite it: header, ordering, REVOKEs and the CHECK and COMMENT were verified, the four bodies proven byte-equal to the pre-migration snapshots, and only the precondition and postcondition were extended to the plan's stated strength (function bodies in the precondition, `c_allowed_origins` absent and the suffix character class present in the postcondition). The second-application refusal is raised by the CHECK branch of the precondition (it runs first), not the function branch; both carry the same `Rollback 20261127120000 refused` prefix.

**3. [Process] Two extra gate edits the plan did not list**
- An apostrophe inside the sentinel string (`origin's`) ended the string early on the first lane run (`42601 syntax error at or near "s"`); doubled to `origin''s`. Header comments describing the old twins' target, the arm list, and the "TWO migrations" apply-list sentence were rewritten to match the new reality.

**4. [Process] No plan-head ledger and no executor start-up queries**
- `init.execute-phase`, the plan-head ledger and a start timestamp were not run in this worktree, so `duration` is untimed and `plan_head_before` is the worktree's fork commit.

## Known Stubs

None. The only unusual strings are runtime-built key fixtures (`E' \t\r\n'`, `arm-u1-not-a-real-key`, both pre-existing or non-credential) and the sibling host fixture.

## Threat Flags

None beyond the plan's register. T-242-14 is mitigated by U3 (RED under the suffix CHECK, plus the migration's verify block biting at apply time, F-01 a). T-242-15 by W1 and K1, machine-twinned and observed RED. T-242-16 by the rollback header, its catalogue precondition and `--single-transaction`; T-242-17 is the documented purpose of a rollback.

## Left for other plans

Plan 05 owns the censuses and floors (`ARMS_FLOOR`, ci.yml per-file sentinel row and sum for this file, now 16, `SENTINEL_FLOOR`). The full-corpus runner was NOT run here, only `--file`. The orchestrator owns VERSION, CHANGELOG, STATE.md and ROADMAP.md. No remote database command, `supabase` CLI or Docker was used.

## Self-Check: PASSED

Both modified files exist; commits `b189cc50a` and `3f49a3be9` are ancestors of HEAD; the SUMMARY carries the three PROOF-01 rows; `git status --short` was empty before this file.

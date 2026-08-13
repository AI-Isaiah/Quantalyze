---
phase: 156-connect-refactor-the-venue-the-server-validated-is-the-venue
plan: 10
subsystem: docs
tags: [prose, requirements, roadmap, state, threat-register, sql-tests, pg16-fixture, coverage]

requires:
  - phase: 156-connect-refactor-the-venue-the-server-validated-is-the-venue
    plan: 07
    provides: "Migration B (20260814120000) and the re-strengthened DDL prose — the column comment and both COMMENT ON FUNCTION texts this plan's route prose had to agree with word for word"
  - phase: 156-connect-refactor-the-venue-the-server-validated-is-the-venue
    plan: 08
    provides: "5d inverted, 5f/5g minted, 5h — the assertion names this plan's ledger rows cite as evidence"
  - phase: 156-connect-refactor-the-venue-the-server-validated-is-the-venue
    plan: 09
    provides: "the state-adaptive arming that makes a PR-B sql-tests run green-with-skips rather than red"
provides:
  - "Five prose sites re-strengthened to the real guarantee, with ONE ceiling sentence worded identically across three route files and Migration B's header"
  - "PARITY-04 closed and its deferred-control threat flag cleared, with the CI run ids that discharge its own stated gate"
  - "CONNECT-01..05 closed, each traceability row naming a migration file, a SQL assertion and a date"
  - "The first ARMED end-to-end execution of the phase's CONNECT-01 core: 5a-5h all fired green on a Migration-B PG16 fixture, plus a four-file mutation battery"
affects: [orchestrator's PR-B release commit]

tech-stack:
  added: []
  patterns:
    - "Ceiling sentence discipline: one verbatim sentence repeated at every site that states a security guarantee, so the sites cannot drift apart by paraphrase"
    - "A grep-gated ledger claim must not restate the literal it is gated on — the closure sentence is itself a way to keep the gate red"

key-files:
  created:
    - .planning/phases/156-.../156-10-SUMMARY.md
  modified:
    - src/app/api/strategies/finalize-wizard/route.ts
    - src/app/api/strategies/finalize-wizard/route.test.ts
    - src/app/api/strategies/create-with-key/route.ts
    - src/app/api/strategies/composite/add-key/route.ts
    - supabase/schema/functions/create_wizard_strategy.sql
    - TODOS.md
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - .planning/STATE.md

key-decisions:
  - "PARITY-04 flipped to [x] on EVIDENCE, not on completion: its own gate says 'goes fully ✅ when CI observes assertion 5 green', and sql-tests ran green (not grey) against TEST twice on 2026-08-13 — runs 31719652331 and 31732467687. What those runs did NOT cover is stated on CONNECT-01 rather than blurred into the flip."
  - "The deferred-control flag was CLEARED even though one observation is still pending, because the flag means 'we shipped knowing the control is not built'. After PR B the control is built; leaving the flag would be false in the opposite direction."
  - "The fixture was NOT abandoned when full migration replay failed (75 of 243 files). The wizard path landed intact in the 168 that applied, so three targeted fixture patches bought the first armed run of 5a-5h anywhere in this phase."
  - "supabase/schema/ was touched against the plan's fence, because the drift gate was RED — plan 07 amended Migration B's 5h paragraph after generating the snapshot. Regenerated with the repo's own tool, not by hand."

patterns-established:
  - "Ceiling-sentence discipline — one verbatim sentence at every site stating the same security guarantee"
  - "Mutation-before-belief on a fixture: an armed green is only evidence once the same fixture reddens under the regression the assertion names"

requirements-completed: [CONNECT-01, CONNECT-02, CONNECT-03, CONNECT-04, CONNECT-05, PARITY-04]

duration: ~2h
completed: 2026-08-13
---

# Phase 156 Plan 10: Say exactly what is now true, and prove it by running the gate rather than assembling it — Summary

**Every comment 153.6 had to weaken now describes the system that exists, at its real strength and not
one notch above; PARITY-04's deferred control is recorded closed with the CI runs that discharge its
own stated gate; and the phase's CONNECT-01 core was executed ARMED for the first time — all of
assertions 5a–5h green on a PG16 fixture carrying Migration B, then reddened on demand by
re-granting the one privilege the phase exists to withdraw.**

## Performance

- **Duration:** ~2 h
- **Tasks:** 3 of 3
- **Commits:** 4 (this SUMMARY's commit is the 5th)

| Commit | Task | Content |
|---|---|---|
| `bbeda952` | 1 | five prose sites re-strengthened; TODOS gains the residual the plan assumed was already logged |
| `e3e493c3` | 2 | REQUIREMENTS / ROADMAP / STATE closed |
| `43f8048e` | — | Rule 3: regenerate the `create_wizard_strategy` snapshot plan 07 left stale |
| _(this file)_ | 3 | phase gate + twin-pairing reconciliation |

---

## Task 1 — the five prose sites

| # | Site | file:line | What changed |
|---|---|---|---|
| P5 | `finalize-wizard/route.ts` | `:1212` | *"it is NOT a venue the server independently validated … do not upgrade this comment"* → what 156 made true, **plus the CHECK kept as a CONNECT-04 fence** rather than retired |
| P6a | `finalize-wizard/route.test.ts` | `:4111` | docblock: the write half has landed; the file's own framing (*"the probe no longer believes the client"*) deliberately **unchanged**, because every case must still hold on a row of any provenance |
| P6b | `finalize-wizard/route.test.ts` | `:4148` | `describe` title → `[153.6-04 / PARITY-04 · 156 / CONNECT-01] … reads the server-written venue` |
| P7a | `create-with-key/route.ts` | `:109` | ⚠️ TRANSITIONAL → ⭐ the other half has landed |
| P7b | `create-with-key/route.ts` | `:766-779` | the CONNECT-02 write docblock: *"a browser could dial the RPC"* → *"could once"* |
| P7c | `create-with-key/route.ts` | `:852` | `p_venue_account_id` — **RESTATED, not upgraded** |
| P7d | `composite/add-key/route.ts` | `:91` | the twin, closed on the same commit |

### The ceiling sentence, verbatim at four sites

> the venue is the one this server observed a successful read-only authentication at

`finalize-wizard/route.ts:1220`, `create-with-key/route.ts:117` and `:777`,
`composite/add-key/route.ts:103` — and it matches Migration B's ⛔ (iii) header rule verbatim
(`20260814120000:45-55`, *"Write the guarantee as 'the venue is the one THIS SERVER OBSERVED a
successful read-only authentication at'. NEVER write 'the venue cannot be forged'"*) as well as the
`attested_venue` column comment it mandates (`:493`). Every occurrence is followed by the same refusal:
**never** *"the venue cannot be forged"* — any server route holding `createAdminClient()` can still
pass any uid and any venue string, which is the standing `service_role` trust boundary
(ADR-0001/ADR-0003), unchanged by this phase.

### The two acceptance invariants, proven mechanically

- **`:1245-1265` byte-intact.** `git diff -U0 src/app/api/strategies/finalize-wizard/route.ts` yields
  **exactly one hunk** (`@@ -1212,9 +1212,23 @@`). The ⛔ *"NEVER `?? apiKeyExchange`"* paragraph is
  untouched, as is the whole `attestedVenue` read.
- **Zero assertion changes in the finalize-wizard test.**
  `git diff -U0 … route.test.ts | grep -cE "^[+-].*(expect\(|toBe\(|toEqual\(|toHaveBeenCalled)"` →
  **0**. Only comments, the docblock and the `describe` title moved.

### The repo grep for the weakened claim

```
$ grep -rn "NOT a venue the server independently validated\|IS NOT A SERVER-VALIDATED VENUE\|\
Do not upgrade this comment\|is closing, not closed\|STILL holds EXECUTE\|only SANCTIONED writer\|\
TRANSITIONAL" src/ supabase/ scripts/ docs/
```

```
supabase/migrations/20260814120000_wizard_rpcs_revoke_authenticated.sql:596:  RAISE EXCEPTION 'post-verify (a): authenticated STILL holds EXECUTE on create_wizard_strategy — the REVOKE did not take. …'
supabase/migrations/20260814120000_wizard_rpcs_revoke_authenticated.sql:599:  RAISE EXCEPTION 'post-verify (a): authenticated STILL holds EXECUTE on add_wizard_composite_key — the REVOKE did not take.'
supabase/migrations/20260813150106_wizard_rpcs_service_role_writer.sql:31:   -- ⛔ (ii) THE TRANSITIONAL GATE'S ARMS ARE BRANCHED, NEVER UNIONED.
supabase/migrations/20260813150106_wizard_rpcs_service_role_writer.sql:108:  -- ⭐ TRANSITIONAL TWO-ARM GATE (Phase 156 Migration A). Deleted by the
supabase/migrations/20260813150106_wizard_rpcs_service_role_writer.sql:303:  -- ⭐ TRANSITIONAL TWO-ARM GATE — the single-key twin's, verbatim. …
supabase/migrations/20260813150106_wizard_rpcs_service_role_writer.sql:442:  '… authenticated STILL holds EXECUTE; the follow-up migration withdraws it …'
supabase/migrations/20260813150106_wizard_rpcs_service_role_writer.sql:444:  '… authenticated STILL holds EXECUTE; the follow-up migration withdraws it.'
```

**`src/` returns zero hits.** Every surviving occurrence is either **negated** (Migration B's
post-verify RAISEs *when* the claim is true) or **historical** (Migration A, applied to PROD in PR
#680 — its transitional wording described the state it shipped, and Migration B supersedes it by
name). `20260811210000` §1b was never edited.

---

## Task 2 — the ledgers

| Ledger | Before | After | Direction |
|---|---|---|---|
| `.planning/REQUIREMENTS.md` | 1468 | 1502 | **grew** |
| `.planning/ROADMAP.md` | 1294 | 1307 | **grew** |
| `.planning/STATE.md` | 1342 | 1363 | **grew** |

None shrank. All edited in place; no regeneration, no `head|sed` pipe.

### PARITY-04 — closed on evidence, with the ceiling on that evidence stated

`grep -c 'threat_flag: deferred-control' .planning/REQUIREMENTS.md` → **0**.

The requirement's own gate reads *"Goes fully ✅ when CI observes assertion 5 green."* That is
discharged, and by measurement rather than assertion — `gh run view` on both runs:

| Run | Branch | `sql-tests` | Window (UTC) |
|---|---|---|---|
| `31719652331` | `feat/phase-156-connect-refactor` | **success** | 16:30:00 → 16:30:30 |
| `31732467687` | `main` (post-#680) | **success** | 19:01:42 → 19:02:17 |

Both are **real runs, not grey** — a cancelled job in the `shared-test-db` concurrency group renders
grey and would not carry a duration. Both carried the `20260811210000` marker, so the 5a–5e block
ARMED rather than SKIPped.

⚠️ **What those runs do not cover, recorded on CONNECT-01 rather than blurred into the flip:** they
executed assertion 5 *as it stood at 153.6*. The inverted 5d and the new 5f/5g/5h are state-adaptive
and SKIP on a database without Migration B — which TEST is. Nothing in that set has been observed
armed-and-green **in CI**. (It has now been observed armed-and-green on a local fixture; see Task 3.)

The residual's history is **restated, not deleted** — the reasoning that produced remedy (b) is what
the next privilege change will re-read, so it stays legible in both the requirement entry and the
traceability row.

### CONNECT-01..05 — all `[x]`, each row carrying a migration, an assertion and a date

The two deliberate qualifications survive intact:

- **CONNECT-05 / `venue_account_id`** — the *reachability* half is closed (only the server can pass
  it); the value still has **no in-database oracle**, so *"the venue confirmed it"* stays false.
- **CONNECT-05 / IN-04** — the RPCs are SECURITY DEFINER owned by `postgres`, so their bodies run as
  `postgres`, **not** as `service_role`. The scrub trigger's `service_role` allowlist entry is
  **still unused**; Phase 156 does not become its beneficiary.

### STATE — D-156-1 through D-156-4 recorded by name

`.planning/STATE.md:545-549`. D-156-4 was **corrected against its source** before commit: my first
draft paraphrased `156-PATTERNS.md`'s rejection as "the precedent had several privileged callers".
The actual recorded reason is sharper and is now what the ledger says — admitting `authenticated`
in-body makes the in-body gate a **permanent no-op**, so a future GRANT leak would pass *both* the
grant layer and the body.

---

## Task 3 — the phase gate, executed

### Full suite

| Gate | Result |
|---|---|
| `npx vitest run --coverage` | **exit 0** — 781 files passed / 19 skipped (800); **11 816 tests passed**, 0 failed, 287 skipped (12 103); 275 s |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | **0 errors**, 2 warnings (both pre-existing, in `ContributionWizardOverlay.tsx` and `EquityChart.tsx` — untouched by this phase) |
| `npm run schema:functions:check` | exit 0 — snapshot current (111 functions) |

**Coverage, against the `vitest.config.ts` ratchet (82 / 80 / 74 / 72):**

| Metric | Gate | Measured | Head-room |
|---|---|---|---|
| Lines | 82 | **88.55** (23 793/26 869) | +6.55 |
| Statements | 80 | **86.50** (25 978/30 029) | +6.50 |
| Functions | 74 | **83.42** (4 423/5 302) | +9.42 |
| Branches | 72 | **80.97** (18 639/23 018) | +8.97 |

All four clear, and all four sit **above** the actuals CLAUDE.md records for 2026-06-20
(85.2 / 83.3 / 77.4 / 75.5). No threshold regressed, so the plan's warning about untested
fail-closed `catch` arms does not fire.

⚠️ **A first full-suite run reported 2 failures and they were NOT real.**
`contracts-registry.test.ts` and `spec-disabling.invariant.test.ts` both timed out at 5 000 ms —
both scan the filesystem, and both ran while this plan was replaying 243 migrations three times over
into a local PG16 cluster. Re-run unloaded: **70/70 pass in 4.94 s**. Recorded because "2 failed"
would otherwise sit in the phase's history as an unexplained red, and because the mechanism
(a background fixture build starving a 5 s filesystem test) will recur.

### The SQL gates — run ARMED, then falsified

⭐ **This is the first time in the phase that the CONNECT-01 assertions have executed armed
end to end.** Plans 08 and 09 each proved their own file on a purpose-built fragment fixture; this
run put all four on one database carrying the real schema and Migration B.

**Fixture:** throwaway PostgreSQL **16.13** cluster (`initdb`, `127.0.0.1:54331`), Supabase-shaped
roles (`anon` / `authenticated` / `service_role` / `authenticator`), an `auth` schema shim
(`auth.uid()` / `auth.role()` / `auth.jwt()` reading `request.jwt.claims`, plus a widened
`auth.users`), and `pg_default_acl` set to the profile `156-MEASUREMENTS.md` § A4 measured on
Supabase (`postgres=X anon=X authenticated=X service_role=X`).

**168 of 243 migrations applied**; the wizard path landed **intact** — `api_keys`, `strategies`,
`strategy_keys`, both `attested_venue` and `venue_account_id`,
`api_keys_attested_venue_matches_exchange` with `convalidated = true`, and both wizard RPCs at
`acl = postgres=X/postgres, service_role=X/postgres` — i.e. **Migration B applied**, with neither
`anon` nor `authenticated` holding EXECUTE. Three targeted fixture patches closed the rest
(the final `api_keys_exchange_check` closed set from `20260723172032`, the `api_keys` table grants,
and `auth.users` columns).

| Gate file | Exit | `SKIP` lines |
|---|---|---|
| `test_api_keys_exchange_not_user_writable.sql` | **0** | **0** |
| `test_wizard_session_idempotency.sql` | **0** | **0** |
| `test_wizard_composite_fence.sql` | **0** | **0** |
| `test_api_keys_venue_identity_uniq.sql` | **0** | **0** |

⛔ **Zero is not the evidence — the NOTICEs are.** A file that exits 0 having run nothing looks
identical. All eight fired:

```
Assertion 5a OK: the 20260810120000 gate marker survived the re-stamp, so assertions 2 and 3 really ran.
Assertion 5b OK: the privileged path still stores an attestation (anti-vacuity control for 5c).
Assertion 5c OK: DELETE + re-INSERT with a forged attested_venue SUCCEEDS and stores NULL …
Assertion 5d OK: authenticated holds no EXECUTE on create_wizard_strategy, the direct call is refused 42501, and no row was minted.
Assertion 5d+ OK: the privileged path still mints a key and stores attested_venue = exchange (mt5), so 5d's refusal means "shut", not "gone".
Assertion 5f OK: authenticated holds no EXECUTE on add_wizard_composite_key, the direct call is refused 42501, and no row was minted.
Assertion 5g OK: the privileged path still mints a composite member key and stores attested_venue = exchange (mt5) …
Assertion 5e OK: a privileged writer CANNOT persist attested_venue <> exchange (refused 23514) — the coupling is enforced, not incidental.
Assertion 5h OK: the ACL CLASS holds — neither authenticated nor anon holds EXECUTE on EITHER wizard RPC, and service_role holds it on both.
```

**The mutation — one GRANT, the exact CONNECT-01 regression:**

```sql
GRANT EXECUTE ON FUNCTION public.create_wizard_strategy(
  uuid,text,text,text,text,text,text,text,integer,text,uuid,text) TO authenticated;
```

| Gate file | Under mutation | Message |
|---|---|---|
| `test_api_keys_exchange_not_user_writable.sql` | **RED** | `CONNECT-01 REGRESSION (5d): authenticated holds EXECUTE on create_wizard_strategy…` |
| `test_wizard_session_idempotency.sql` | **RED** | `TEST FAILED: authenticated HOLDS EXECUTE on create_wizard_strategy — Phase 156 / CONNECT-01 withdrew it…` |
| `test_wizard_composite_fence.sql` | **RED** | `TEST FAILED (Part 3a-2b): INCOHERENT HALF-STATE, AND IT IS THE WORST ONE…` |
| `test_api_keys_venue_identity_uniq.sql` | **RED** | `TEST FAILED (4): authenticated HOLDS EXECUTE on create_wizard_strategy…` |

`REVOKE` restored → **all four green again, 0 SKIP lines.** The control run is what makes the RED
attributable to the mutation rather than to fixture drift.

⚠️ **One false negative on the way, and it is worth recording:** the first mutation attempt used a
guessed 12-argument signature, `GRANT` errored `function … does not exist`, and all four gates
reported EXIT 0 — which reads exactly like *"the gates failed to detect the regression"*. The
mutation had simply never been applied. **A mutation that did not land is indistinguishable from a
gate that did not fire unless you verify the mutated state**; the ACL was re-read
(`authenticated=X/postgres` present) before the second run was believed.

⚠️ **`test_csv_finalize_double_submit.sql` was NOT run to completion.** It is the fifth file and
**untouched by Phase 156** — plan 09 measured it green on both states and deliberately left it
alone. Here it fails on `relation "strategy_verifications" does not exist`, a fixture-construction
gap traced to a replay wall (`ROLLBACK TO SAVEPOINT` inside a plpgsql `DO` block in
`20260417031851_user_app_roles.sql`, which is invalid in plpgsql and blocks
`current_user_has_app_role` → `strategy_verifications`). This is the *"replaying all 243 migrations
into a bare `initdb` is not a one-liner"* wall `156-03-SUMMARY.md` already recorded. It says nothing
about shipped code.

⭐ **A second confirmation fell out of the fixture work:** re-applying the full migration set a
second time drops from 168 to 130 successes, because `20260811210000` and `20260812083206`
post-verify that `authenticated` **HAS** EXECUTE and now abort. That is Migration B's ⛔ (i)
RE-APPLY HAZARD behaving exactly as its header predicts — an ordered migration history working
correctly, not a defect.

### `sql-tests` in CI — the honest position

⛔ **`sql-tests` has NOT been observed green in CI for the assertions this PR ships.** Migration B is
applied to **no database**. On PR B the job will run against TEST, which does not carry it, so the
state-adaptive gates SKIP and the job goes green **with 5d / 5f / 5g / 5h skipping**. That is by
design — applying Migration B to TEST before these gates land would red `sql-tests` on `main` and on
every concurrent PR. The observation arms on the first run after Migration B reaches TEST.

What replaces it here is a **local armed run plus a falsification**, which is strictly more than a
green CI job would have shown (a green job proves the assertions did not fire; the mutation proves
they *can*).

---

## The twin-pairing checklist — every row with a coordinate

| Artifact | single-key instance | composite twin | Verdict |
|---|---|---|---|
| RPC body re-base | `20260814120000:151` | `20260814120000:321` | ✅ closed |
| REVOKE / GRANT | `:439,442,445` + `GRANT :448` | `:452,455,458` + `GRANT :461` | ✅ closed |
| post-verify (a) | `:596` | `:599` | ✅ closed |
| route `.rpc` swap | `create-with-key/route.ts:832` | `composite/add-key/route.ts:474` | ✅ closed |
| **route test admin mock** *(no twin at plan time — G11)* | `create-with-key/route.test.ts:300` | `composite/add-key/route.test.ts:194-195` | ✅ **closed by plan 02** |
| **SQL gate 5d / 5f-5g** *(no twin at plan time)* | `test_api_keys_exchange_not_user_writable.sql:472` (5d), `:561` (5d+) | same file `:612` (5f/5g banner), `:778` (5h) | ✅ **closed by plan 08** |
| **stale-re-base canary** *(no twin at plan time)* | `test_api_keys_venue_identity_uniq.sql` § 3 | same file `:247` (§ 3b) | ✅ **closed by plan 09** |
| **`MUTATING_RPC_NAMES`** | `audit-coverage.test.ts:208` | — | ⛔ **STILL MISSING — logged, not fixed** (Rule 3) |

**The `MUTATING_RPC_NAMES` row, deliberately open.** `create_wizard_strategy` is in the array at
`src/__tests__/audit-coverage.test.ts:208`; `add_wizard_composite_key` is not, so the composite twin
writes the same two tables through the same wizard path with no audit-coverage policing. The gap
**pre-dates Phase 156** — 156 only made it visible by touching both call sites at once. Adding the
name creates an audit-emission obligation on a route this phase was already rewiring, and the
correct answer is *probably* the same `@audit-skip: wizard draft` pragma its twin carries
(`create-with-key/route.ts:815`) — but "probably" is not a standard to land an audit decision on.
**Cited at `TODOS.md:2334`.**

---

## The two things this phase did NOT close

Stated here so the next reader does not rediscover them:

1. **The `asset_class` stamp still reads the forgeable `apiKeyExchange`, not `attestedVenue`** —
   `finalize-wizard/route.ts:1288-1299` (the stamp itself at `:1311`). Self-targeted: a forged label
   here distorts the annualization clock (√365 crypto vs √252 traditional) of the forger's **own**
   strategy, where a forged label on the probe gate switched off a security control. It is a
   one-identifier change with a two-outcome money-math blast radius and needs its own oracle.
   **Cited at `TODOS.md:2345`.**
2. **`p_venue_account_id` has no in-database oracle** — `create-with-key/route.ts:852`. Phase 156
   closed the *reachability* half (only the server can pass it); nothing in the database can ask MT5
   whether a login is real, so the stored value is *"what the server passed"*, never *"what the venue
   confirmed"*. **Cited at `TODOS.md:2358`.**

---

## Deviations

**1. [Fence 3 — orchestrator override] `VERSION`, `package.json` and `CHANGELOG.md` were NOT touched.**
Task 2's action block and the plan's `files_modified` both call for a lockstep version bump and a
"landing 2 of 2" CHANGELOG entry. The orchestrator's fence reserves the release commit. The
acceptance criterion *"`cat VERSION` equals `package.json`'s version, changed in ONE commit; the
CHANGELOG entry says 'landing 2 of 2' and does not claim unforgeability"* is therefore **not
discharged by this plan** and is owed by the release commit. ⚠️ For that commit: the entry must say
**landing 2 of 2**, must record that `authenticated` EXECUTE is withdrawn and CR-01 remedy (a) is
complete, and must **not** claim the venue cannot be forged.

**2. [Fence 2 — overridden by Rule 3] `supabase/schema/functions/create_wizard_strategy.sql` WAS
modified.** The fence declares `supabase/schema/**` reviewed and settled; it was not — it was
**stale**, and `npm run schema:functions:check` exited non-zero on this branch. Plan 07 amended
Migration B's 5h paragraph in `e8f846a7` *after* generating the snapshot, so the committed body still
read *"THE DURABLE ENFORCEMENT DOES NOT EXIST YET"* while the migration reads *"IS ASSERTION 5h …
EXISTS as of plan 156-08"*. **SQL Function Snapshot — Drift Gate** is a checked status on `main`, so
PR B would have shipped red. Regenerated with the repo's own tool (`npm run schema:functions`, which
rewrote 111 files and changed exactly this one); **no hand edits**. Commit `43f8048e`.
⛔ `supabase/migrations/**` and `supabase/tests/*.sql` were **not** touched — verified: the last
commits against `supabase/tests/` remain plan 08's and plan 09's.

**3. [Rule 2 — missing record] `TODOS.md` gained an entry the plan assumed already existed.**
Task 3 requires citing a `TODOS.md` entry for *"`p_venue_account_id` has no in-database oracle"*.
No such entry existed — the nearest, **A-3**, is about the value's *shape* (an MT5 login is unique
only within a broker server), not its *provenance*. Rather than cite a wrong entry or claim a
citation that does not resolve, the entry was written (`TODOS.md:2358`) and explicitly distinguished
from A-3 in both the ledger and the route comment.

**4. [Rule 1 — coordinate I invalidated] `TODOS.md`'s `asset_class` entry cited a line range my own
edit moved.** P5 added 14 lines above the stamp, shifting `:1275-1285` → `:1288-1299`. Corrected in
the same commit, with the shift noted so the correction is not later read as a different site.

**5. [Self-inflicted, caught by the gate it would have broken] The PARITY-04 closure sentence
initially re-introduced the literal `threat_flag: deferred-control`,** which is exactly the string
the acceptance gate greps for and requires to be absent. `grep -c` returned 1 for a sentence
announcing the flag was cleared. Reworded, and the reason is now written into the ledger so the next
editor does not reintroduce it. ⚠️ This is the phase's own signature defect class in miniature — a
claim that keeps a gate red for a reason opposite to the truth.

**6. [Recorded, not fixed] Two full-suite failures were load artifacts, not defects.** See Task 3.

**7. [Scope] `state.update-progress` was NOT run,** and `.planning/STATE.md` now says why: the verb
recalculates from SUMMARY.md counts on disk, and Phase 156 has two plans that produced no SUMMARY by
design — **156-06**, whose artifact is `156-LIVE-ACCEPTANCE.md`, and **156-07**, whose output is
Migration B itself. The verb would have written 8/10 for a phase that ran all ten. Counters were set
by hand and the reconciliation (including that the previous `completed_plans: 83` over-counted by 3
against a disk census) is recorded in STATE rather than silently corrected.

---

## Known Stubs

None.

## Threat Flags

None. This plan added no network, auth, file-access or schema surface — its code changes are
comment-only, and its one non-comment change is a tool-regenerated snapshot.

⭐ Conversely, one threat flag was **cleared**: PARITY-04's deferred control. Its register entry is
restated as closed rather than deleted.

## Self-Check: PASSED

**Files:**
- `src/app/api/strategies/finalize-wizard/route.ts` — FOUND
- `src/app/api/strategies/finalize-wizard/route.test.ts` — FOUND
- `src/app/api/strategies/create-with-key/route.ts` — FOUND
- `src/app/api/strategies/composite/add-key/route.ts` — FOUND
- `supabase/schema/functions/create_wizard_strategy.sql` — FOUND
- `.planning/REQUIREMENTS.md` / `ROADMAP.md` / `STATE.md` — FOUND, all three **grew**
- `TODOS.md` — FOUND
- `.planning/phases/156-…/156-10-SUMMARY.md` — FOUND

**Commits:** `bbeda952`, `e3e493c3`, `43f8048e` — all present in `git log`.

**Gates:** vitest exit 0 (11 816 passed, 0 failed); `tsc` exit 0; `lint` 0 errors;
`schema:functions:check` exit 0; four SQL gates exit 0 with 0 SKIP lines on a Migration-B PG16
fixture, each reddening under the CONNECT-01 mutation and returning green when it is reverted.

**Not discharged, and named rather than implied:** `sql-tests` green **in CI** for the 5d/5f/5g/5h
set, and the `VERSION`/`package.json`/`CHANGELOG` release commit.

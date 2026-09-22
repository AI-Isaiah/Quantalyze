---
phase: 167-credtrust
plan: 03
subsystem: database
tags: [supabase, postgres, sql-gate, react, mutation-runner]

# Dependency graph
requires:
  - phase: 167-01
    provides: "D-09 classifier arms and the WizardErrorCode registry this phase's owner helper sits beside"
provides:
  - "sync_status = 'sign_in_failed' — the D-11 arm B migration, its self-verify DO block, its SQL gate, and its census-pin moves"
  - "AllocatorSyncStatus renders the new value as an amber 'Sign-in failed' pill with an authored, syncError-ignoring helper"
affects: [167-04, 167-05]

# Actuals (#2632)
actuals:
  tokens: 8358
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "CHECK-widening migrations copy the DROP+ADD + schema-only self-verify DO block shape verbatim from 20260420073003_allocator_holdings.sql STEP 5."
    - "PILL_STYLES-shaped maps get an OPTIONAL border field rather than a breaking type change, so every existing row is untouched."

key-files:
  created:
    - supabase/migrations/20260922120000_api_keys_sync_status_sign_in_failed.sql
    - supabase/tests/test_api_keys_sync_status_sign_in_failed.sql
  modified:
    - src/components/exchanges/AllocatorSyncStatus.tsx
    - src/components/exchanges/AllocatorSyncStatus.test.tsx
    - scripts/mutation-runner/run.mjs
    - src/__tests__/mutation-runner-floors.test.ts

key-decisions:
  - "D-11 arm B (mint sync_status='sign_in_failed') — ALREADY RATIFIED by the founder before this run started. Not re-opened here; see the checkpoint task in 167-03-PLAN.md for the full argument."
  - "The migration's self-verify DO block reads pg_constraint ONLY (schema, never data) — the [164.8-DATA-DEPENDENT-MIGRATION-ESCAPE] class this repo has already paid for once."
  - "PILL_STYLES gets an OPTIONAL `border` field rather than widening every row's type, so the six existing rows are byte-unchanged."

patterns-established:
  - "A gate's RAISE EXCEPTION must carry a literal `TEST FAILED (<arm>)` marker matching its RED-UNDER-M arm id, or the mutation runner scores it NO-IDENTITY instead of RED (identity ok) — this was NOT in 167-PATTERNS.md and had to be discovered by running the corpus, matching that document's own warning that the plan's named touch points undercount the real ones."

requirements-completed: []  # D-15b: this phase's requirement IDs collide with unrelated global REQUIREMENTS.md entries — requirements.mark-complete is deliberately NOT run for this plan (see 167-CONTEXT.md D-15b).

coverage:
  - id: D1
    description: "A signed-out key renders pill text 'Sign-in failed' and the authored helper 'Reconnect this account — its credentials may have changed.', ignoring syncError."
    verification:
      - kind: unit
        ref: "src/components/exchanges/AllocatorSyncStatus.test.tsx#renders 'Sign-in failed' pill + authored helper (D-05/D-11 arm B)"
        status: pass
      - kind: unit
        ref: "src/components/exchanges/AllocatorSyncStatus.test.tsx#sign_in_failed helper IGNORES syncError — non-vacuity control"
        status: pass
    human_judgment: false
  - id: D2
    description: "The pill renders the opaque amber trio and can never resolve to the neutral idle style, even under PILL_STYLES' unknown-key fallback."
    verification:
      - kind: unit
        ref: "src/components/exchanges/AllocatorSyncStatus.test.tsx#sign_in_failed pill uses the opaque amber trio and NEVER the idle fallback classes (T-167-08)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The shared error/complete_with_warnings helper branch is byte-unchanged; complete_with_warnings and error render exactly as before."
    verification:
      - kind: unit
        ref: "src/components/exchanges/AllocatorSyncStatus.test.tsx#renders 'Synced (warnings)' for complete_with_warnings + helper with sync_error"
        status: pass
      - kind: unit
        ref: "src/components/exchanges/AllocatorSyncStatus.test.tsx#renders 'Sync failed' + helper contains sanitized sync_error for error"
        status: pass
    human_judgment: false
  - id: D4
    description: "api_keys_sync_status_check admits sign_in_failed AND every prior value — a DROP+ADD that re-types a stale list cannot silently ship."
    verification:
      - kind: other
        ref: "supabase/tests/test_api_keys_sync_status_sign_in_failed.sql, verified on scripts/pg-lane/run.sh (GREEN baseline + both RED-UNDER-M arms observed RED)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The migration itself, and the D-13 three-reviewer + human sign-off gate on it, are NOT covered by this plan run — the checkpoint:human-verify task is deliberately out of scope."
    verification: []
    human_judgment: true
    rationale: "checkpoint:human-verify is NEVER auto-approvable; per this run's brief, the orchestrator runs the three reviewers and the founder signs off after this hand-back."

duration: ~100min (dominated by two full mutation-runner corpus passes, ~48min each)
completed: 2026-09-22
status: halted
---

# Phase 167 Plan 03 (PARTIAL — Tasks 1-2 only): Sign-in-failed status Summary

**`sync_status='sign_in_failed'` migration + amber pill + authored helper, landed in one commit; its SQL gate + moved census pins landed in a second — the `checkpoint:human-verify` three-reviewer gate is OUTSTANDING and was deliberately not run.**

⛔ **THIS PLAN IS NOT COMPLETE.** `167-03-PLAN.md` has four tasks. This run executed exactly two of them — the `tracer` task (Task 1) and the `auto` SQL-gate task (Task 2) — per an explicit instruction that the `checkpoint:decision` (D-11 arm B) was already ratified by the founder before this run started, and that the final `checkpoint:human-verify` (three reviewers + human sign-off on the migration, per D-13) is **not** this run's to clear. Do not read this file as phase completion. `167-03-SUMMARY.md` does not exist yet; it is owed once the human-verify gate clears.

## Performance

- **Duration:** ~100 min, almost entirely spent on two full `node scripts/mutation-runner/run.mjs` corpus passes (~48 min each) plus the census-pin fallout from the second
- **Tasks:** 2 of 4 (Tasks 1 and 2 only; the D-11 checkpoint was pre-cleared, the D-13 checkpoint is explicitly out of scope for this run)
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments

- `sync_status = 'sign_in_failed'` — a ninth value on `api_keys_sync_status_check`, minted via the analog's DROP+ADD pattern with a schema-only self-verifying DO block.
- `AllocatorSyncStatus` renders it as an amber "Sign-in failed" pill (DESIGN.md's opaque warning trio, not the alpha fill the neighbouring amber pills use) with an authored helper that ignores `syncError` and can never fall back to the neutral idle style.
- A new SQL gate (`test_api_keys_sync_status_sign_in_failed.sql`) asserting both halves of the DROP+ADD hazard, plus the two corpus-wide census pins (`FILES_FLOOR`, `ARMS_FLOOR`) and the `mutation-runner-floors.test.ts` fixture the new file moved — discovered by RUNNING, not by the plan's own touch-point list (which named none of the fixture ripple).

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end "a signed-out key renders as Sign-in failed with an authored helper"** — `6fe963a8` (feat)
2. **Task 2: The SQL gate over the widened constraint — and every corpus census it moves** — `60120f31` (test)

**No plan-metadata commit yet** — this plan is not complete; `167-05` or a future completion run owns the final `docs(167-03): complete plan` commit once Tasks 3 and 4 clear.

## Files Created/Modified

- `supabase/migrations/20260922120000_api_keys_sync_status_sign_in_failed.sql` — the CHECK widening + schema-only self-verify DO block
- `src/components/exchanges/AllocatorSyncStatus.tsx` — `PILL_STYLES` row, pill label, `CREDENTIAL_FAILED_HELPER`, helper-chain branch
- `src/components/exchanges/AllocatorSyncStatus.test.tsx` — 3 new cases (pill+helper, amber-vs-idle guard, syncError non-vacuity control)
- `supabase/tests/test_api_keys_sync_status_sign_in_failed.sql` — the SQL gate, 2 RED-UNDER-M arms
- `scripts/mutation-runner/run.mjs` — `FILES_FLOOR` 48→49, `ARMS_FLOOR` 423→425, each with a dated MEASURED lineage comment
- `src/__tests__/mutation-runner-floors.test.ts` — `GREEN_LOG` fixture + 8 dependent RED-arm assertions moved to the new baseline

---

## Migration diff summary

`20260922120000_api_keys_sync_status_sign_in_failed.sql` (new file, 78 lines):

1. **Grep re-run, recorded inline** (not trusted from the plan prompt): `grep -rln "api_keys_sync_status_check" supabase/migrations/` returns exactly one file at HEAD — `20260420073003_allocator_holdings.sql` STEP 5 — confirming no migration in between has touched the CHECK, so the DROP+ADD is safe.
2. `ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_sync_status_check;` then `ADD CONSTRAINT` re-typing the full **nine**-value list (`idle, syncing, computing, complete, complete_with_warnings, error, revoked, rate_limited, sign_in_failed`).
3. A self-verifying `DO $$ … $$;` block reading `pg_get_constraintdef(oid)` **only** — never a data-reading probe, per the [164.8-DATA-DEPENDENT-MIGRATION-ESCAPE] class named in this phase's guardrails. It `RAISE EXCEPTION`s if the new value is missing, and separately if ANY of the eight prior values is missing (the guard against a stale re-type).
4. No database command was ever run against TEST or PROD, or any remote — the migration was verified exclusively via `scripts/pg-lane/run.sh` against a throwaway local cluster (see below).

## Every census pin moved, and how it was found

**Not predicted from the plan — found by RUNNING**, exactly as the plan's own warning said would happen (167-01 and 167-02 both undercounted their named pins too):

| Pin | Where | How found | Old → New |
|---|---|---|---|
| `FILES_FLOOR` | `scripts/mutation-runner/run.mjs` | `grep -nE '^export const FILES_FLOOR'` before touching anything, then re-ran the full lane and read the failure off `src/__tests__/mutation-runner-floors.test.ts`'s own stale-low guard: `RATCHET STALE: 49 of 76 gate files are now annotated but FILES_FLOOR is still 48. Raise FILES_FLOOR … to 49.` | 48 → 49 |
| `ARMS_FLOOR` | `scripts/mutation-runner/run.mjs` | Same mechanism, same test file: `ARMS_FLOOR is 423 … Update the floor … expected 423 to be 425.` | 423 → 425 |
| `mutation-runner-floors.test.ts` `totalAnchored` assertion | line ~626 | `expect(totalAnchored).toBe(423)` failed with `expected 425 to be 423` on the FIRST re-run (before any floor edit) — the static re-derivation over the real corpus, unprompted by anything the plan named | 423 → 425 |
| `GREEN_LOG` fixture: `coverage:` line | `mutation-runner-floors.test.ts` | Not a test failure by itself (the fixture is synthetic input) but had to move to keep the fixture internally consistent with the new floors | `48/75` → `49/76` |
| `GREEN_LOG` fixture: `arms:`/`biting:`/`lane-invocations:` triplet | same file | Same reasoning — the count-recheck step reads the floors out-of-process, so a GREEN input below the newly-raised floor stops being green | `423/423/0` → `425/425/0`, and the two baseline/restore-leg counts `48`→`49` |
| `GREEN_LOG` fixture: new per-file row | same file | Added the new gate file's own row in alphabetical position, consistent with the aggregate | new row, `sections 2 / annotated 2 / biting 2` |
| **8 dependent RED-arm assertions** in the same file | same file | Re-ran the FULL suite after the fixture edit — 8 of 81 tests failed, **each** because its `.replace(/^…: 423 …/m, …)` regex or literal `"423 …"` assertion no longer matched the new `425`-keyed fixture, which is EXACTLY the substitution hazard this file's own history warns about ("a pattern that no longer matches returns the GREEN log UNCHANGED so the RED arm passes on a log it never mutated") | all eight moved individually, each with its own re-derived expected number (not a blanket find-replace) |

**Nothing was blanket-incremented.** Every number above was read off an actual failing assertion's own message, never predicted or typed from memory. `WAIVED_CEILING` was not touched (stays 0; the full corpus run reported `0 are waivers`).

## Anti-vacuity — neuter/restore evidence per assertion

All four restores were `cp` byte backups, verified with `shasum -a 256` equality (byte-identical), re-taken after every edit. Never `git checkout --`, `git restore`, or `git stash`.

1. **Amber-vs-idle-fallback drill (T-167-08).** Removed the `sign_in_failed` row from `PILL_STYLES` → 3 tests went RED (`Sign-in failed` pill text absent — fell back to `Idle`; the amber-class assertion failed against `bg-[#F1F5F9] text-text-secondary`) → restored, `cmp`/sha256-verified, full suite green again (40/40).
2. **`syncError` non-vacuity control.** Replaced `CREDENTIAL_FAILED_HELPER` with a raw `syncError ?? ""` pass-through in the helper-resolution chain → 2 tests went RED, one showing the exact shipped-defect shape (`Received: "MT5 terminal unreachable — sync will retry automatically."` instead of the authored sentence) → restored, sha256-verified, full suite green (40/40).
3. **SQL gate arm 1 (revert to pre-migration 8-value list).** Applied the RED-UNDER-M mutation on the pg-lane cluster → gate exited 3 with `TEST FAILED (1): api_keys_sync_status_check does not admit sign_in_failed … Got: CHECK (…8 values…)` → GREEN baseline re-confirmed on a fresh cluster.
4. **SQL gate arm 2 (stale re-type losing 'revoked').** Applied the second mutation → gate exited 3 with `TEST FAILED (2): api_keys_sync_status_check lost a prior value … Got: CHECK (…9 values, no revoked…)` → GREEN baseline re-confirmed.

## What reddened unexpectedly (not papered over)

- **The gate's two `RAISE EXCEPTION`s initially scored `NO-IDENTITY` instead of `RED (identity ok)`** on the first full corpus run — the mutation runner requires a literal `TEST FAILED (<arm>)` marker in the exception text to attribute a failure to its arm (`IDENTITY_CARRIER` / `IDENTITY_RE` in `scripts/mutation-runner/parse.mjs`), and this convention was **not named anywhere in `167-PATTERNS.md`'s read_first list**. Found only by running the full corpus and reading the raw log, then confirmed against the neighbouring gate's own docblock (`test_api_keys_venue_identity_uniq.sql:44`) and `scripts/mutation-runner/GRAMMAR.md`. Fixed by prefixing both `RAISE EXCEPTION` messages with `TEST FAILED (1): ` / `TEST FAILED (2): `, re-verified on the pg-lane cluster directly (both mutations now show the marker), then re-confirmed on the full corpus.
- **My first full-corpus run was killed at ~18 minutes by my own inner `timeout 1100` shell wrapper** (exit 124), not a real defect — I misjudged the corpus's real runtime. The genuine, unwrapped run (`node scripts/mutation-runner/run.mjs`, no inner timeout) completed in ~48 minutes with `✅ No defects. Every annotated arm bit its own arm first.`, exit 0.
- **8 of 81 `mutation-runner-floors.test.ts` cases went RED** after the floor edit — not a code defect, but the exact documented fixture-substitution hazard: literal `423`s scattered across `.replace()` regexes and expected-string assertions throughout the file. All 8 fixed individually with re-derived numbers (see table above); full suite now 81/81 green.

## Verification run

- `npx vitest run src/components/exchanges/AllocatorSyncStatus.test.tsx` — 40/40 pass.
- `npx vitest run src/components/exchanges/` — 101/101 pass (full scope, includes `AllocatorExchangeManager.test.tsx`).
- `npm run typecheck` — clean, exit 0.
- `npm run lint` — clean, exit 0 (includes `check-planning-hygiene`, which this file itself must pass).
- `node scripts/lint-sql-gates.mjs --self-test && node scripts/lint-sql-gates.mjs` — 7/7 self-test rules, 0 corpus findings.
- `node scripts/lint-app-guc.mjs --self-test && node scripts/lint-app-guc.mjs` — 0 findings, 5 files annotated (all pre-existing, unrelated to this plan).
- `node scripts/mutation-runner/run.mjs` — full corpus, exit 0: `coverage: files 49/76`, `arms: 425/425/0`, `biting: 425`, `lane-invocations: 425` (agreeing), `lane-blocked: 0`, `lane-probe: pg_cron AVAILABLE`, `✅ No defects. Every annotated arm bit its own arm first.`
- `npx vitest run src/__tests__/mutation-runner-floors.test.ts` — 81/81 pass (after the fixture+assertion moves above).
- ⛔ No database command was ever run against TEST or PROD, or any remote. The gate was verified exclusively on `scripts/pg-lane/run.sh`'s throwaway cluster.

## Decisions Made

- D-11 arm B was **already ratified by the founder** before this run started (per the operator brief); the checkpoint was not re-presented or re-opened.
- The migration's self-verify block is schema-only (`pg_get_constraintdef`), never data-reading, per the standing [164.8-DATA-DEPENDENT-MIGRATION-ESCAPE] class.
- `PILL_STYLES`' type widened with an OPTIONAL `border?: string` field rather than a breaking change, so all six existing rows are byte-unchanged.
- The shared `normalized === "error" || normalized === "complete_with_warnings"` branch was left byte-unchanged — the new `sign_in_failed` branch was inserted as a separate `else if`, per the checker's finding 1 that this shared condition must never be touched by a pure extension.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The SQL gate's RAISE EXCEPTION messages were missing the mutation runner's required `TEST FAILED (<arm>)` identity marker**
- **Found during:** Task 2, first full corpus run
- **Issue:** Both `RAISE EXCEPTION` statements in the new gate lacked the literal `TEST FAILED (N)` prefix the mutation runner's `IDENTITY_RE` requires to attribute a RED-UNDER-M mutation to its arm; both arms scored `NO-IDENTITY` instead of `RED (identity ok)`.
- **Fix:** Prefixed both messages with `TEST FAILED (1): ` and `TEST FAILED (2): `, matching the neighbouring gate's own convention (`test_api_keys_venue_identity_uniq.sql`) and `scripts/mutation-runner/GRAMMAR.md`.
- **Files modified:** `supabase/tests/test_api_keys_sync_status_sign_in_failed.sql`
- **Verification:** Both mutations re-run directly on the pg-lane cluster, confirmed `TEST FAILED (1): …` / `TEST FAILED (2): …` in the psql ERROR output; full corpus re-run confirmed both arms score `RED (identity ok)`.
- **Committed in:** `60120f31` (Task 2 commit)

**2. [Rule 1 - Bug] `FILES_FLOOR`/`ARMS_FLOOR` census drift caused by the new gate file was not self-healing**
- **Found during:** Task 2, `src/__tests__/mutation-runner-floors.test.ts` re-run after the new gate file landed
- **Issue:** The stale-low ratchet test failed with `RATCHET STALE: … Raise FILES_FLOOR … to 49` and `expected 423 to be 425`; the fixture (`GREEN_LOG`) and 8 dependent RED-arm assertions inside the same file also silently stopped exercising their intended mutations because their `.replace()` regexes keyed on the literal `423` no longer matched.
- **Fix:** Moved `FILES_FLOOR`/`ARMS_FLOOR` with dated MEASURED lineage comments citing the full lane run's own output; moved the `GREEN_LOG` fixture's `coverage:`/`arms:`/`biting:`/`lane-invocations:` lines and added the new per-file row; moved all 8 dependent assertions individually, each re-derived from the test's own failure message rather than blanket find-replaced.
- **Files modified:** `scripts/mutation-runner/run.mjs`, `src/__tests__/mutation-runner-floors.test.ts`
- **Verification:** `npx vitest run src/__tests__/mutation-runner-floors.test.ts` — 81/81 pass.
- **Committed in:** `60120f31` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug — both discovered by running, not predicted)
**Impact on plan:** Both fixes were necessary for the gate to actually function as a mutation-runner-verified gate rather than a silently-inert one. No scope creep — nothing outside the gate's own census footprint was touched.

## Issues Encountered

- My own inner `timeout 1100` shell wrapper killed the first full corpus run at ~18 minutes (exit 124) before it reached my new gate file's own summary line — not a defect in the gate or the runner, just an underestimate of the corpus's real runtime (~48 min unwrapped). Re-run without the wrapper to completion.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness — ⛔ NOT READY, gate outstanding

- Tasks 3 (`checkpoint:human-verify`: three reviewers — `migration-reviewer`, `rls-policy-auditor`, `silent-failure-hunter` — then human sign-off per D-13) and the plan's completion (metadata commit, `167-03-SUMMARY.md`, `state.md`/`ROADMAP.md` updates) are **outstanding**. This hand-back stops here.
- The migration **auto-applies to TEST then PROD on merge to `main`** — it must not be merged before the three reviewers run and a human explicitly approves.
- `167-04` (which adds the `sync_error_copy` fallback row per the checkpoint's own cost list) and `167-05` both depend on this plan reaching `status: complete`, not `halted`.
- The pre-existing amber-contrast finding (`rate_limited`/`complete_with_warnings` pills measuring below 4.5:1) and the `AllocatorSyncStatus` vs `HoldingsTable` red-vs-amber divergence are both out of this plan's scope, per `167-UI-SPEC.md § Open Questions`, and were not touched.

---
*Phase: 167-credtrust*
*Completed (partial — Tasks 1-2 only): 2026-09-22*

---
phase: 163-harden-fail-safe-closed-and-loud
plan: 09
subsystem: auth
tags: [supabase, gotrue, password-policy, audit-coverage, vitest, security]

# Dependency graph
requires:
  - phase: 163-03
    provides: the no-allowlist planning-hygiene scanner chained into `npm run lint`, which this plan's REQUIREMENTS.md edits must pass
provides:
  - one exported MIN_PASSWORD_LENGTH backed by a MEASURED hosted policy reading, consumed by both auth forms
  - a source-scanning regression pin that catches a re-hardcoded numeric minLength in either form
  - add_wizard_composite_key inside MUTATING_RPC_NAMES, turning its @audit-skip pragma from decoration into live law
  - a re-measured census of the single-line mutation sites the audit detector misses (6, not the 4 the stale comment claimed)
affects: [164-share, any phase adding a mutating RPC, any phase touching the auth forms]

actuals:
  tokens: 6208
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Dashboard-owned external policy recorded as a DATED READING with its measurement method, never as an invariant"
    - "Source-scan regression pin: a rendered-value assertion cannot distinguish a shared constant from a re-hardcoded literal, so the test reads the consuming sources"

key-files:
  created:
    - src/lib/auth/password-policy.ts
    - src/lib/auth/password-policy.test.ts
  modified:
    - src/components/auth/SignupForm.tsx
    - src/components/auth/ResetPasswordForm.tsx
    - src/__tests__/audit-coverage.test.ts
    - .planning/REQUIREMENTS.md

key-decisions:
  - "KEEP the @audit-skip pragma at add-key; do NOT emit at add-key time — drafts are audited at finalize, and a second emission would duplicate the finalize event"
  - "Record the hosted password policy as a point-in-time reading dated 2026-08-26, explicitly NOT an invariant — it is dashboard-owned with no repo representation"
  - "Derive user-facing password copy from the constant too, not just minLength, so the message cannot drift from the floor"
  - "Correct the stale H-0001 census by RE-MEASURING it rather than re-numbering the old claims — the measurement changed the count, not just the coordinates"

patterns-established:
  - "Control-then-treatment falsification: prove the fix is load-bearing by showing the gate stays GREEN with the guard removed BEFORE the fix, then RED with the same removal after"
  - "Restore-by-byte-copy with hash verification after every neuter (never `git checkout --`, which destroys uncommitted work)"

requirements-completed: [SEC-01, SEC-03]

coverage:
  - id: D1
    description: "The hosted production password policy is READ (minimum 6, no character-class requirement), not assumed, and the reading plus its method is recorded beside the client floor and in REQUIREMENTS.md SEC-01"
    requirement: SEC-01
    verification:
      - kind: other
        ref: "live signup-endpoint probe with a deliberately-failing 1-character password; 422 weak_password, reasons=[\"length\"] — performed by the orchestrator 2026-08-26, recorded in 163-CONTEXT.md <measured_preconditions>"
        status: pass
      - kind: unit
        ref: "src/lib/auth/password-policy.test.ts#is 6 — the minimum the hosted signup endpoint reported on 2026-08-26"
        status: pass
    human_judgment: true
    rationale: "The reading is of a dashboard-owned setting with no repo representation. No test in this repo can observe it, and it can change outside git at any time — a human must re-read it if the number ever matters again. The unit test pins only the repo's mirror of it."
  - id: D2
    description: "The two independent client password constants are unified into one exported MIN_PASSWORD_LENGTH, and neither form can silently re-hardcode a numeric literal"
    requirement: SEC-01
    verification:
      - kind: unit
        ref: "src/lib/auth/password-policy.test.ts#both auth forms consume the shared constant (no re-hardcoded literal)"
        status: pass
      - kind: unit
        ref: "npx vitest run src/components/auth (10 files, 52 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "add_wizard_composite_key is policed by the audit-coverage gate — its @audit-skip pragma is now live law, proven by observing the gate go RED when the pragma is deleted"
    requirement: SEC-03
    verification:
      - kind: unit
        ref: "src/__tests__/audit-coverage.test.ts#every .insert/.update/.delete/.upsert has a logAuditEvent or @audit-skip"
        status: pass
      - kind: unit
        ref: "npx vitest run src/__tests__/contracts (contract suites scan all of src/)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The pragma-vs-real-emission decision is RECORDED in the SEC-03 requirement entry, with the control measurement that shows why the allowlist entry was needed"
    requirement: SEC-03
    verification:
      - kind: other
        ref: ".planning/REQUIREMENTS.md SEC-01 and SEC-03 entries; `npm run lint` (check-planning-hygiene scans them)"
        status: pass
    human_judgment: true
    rationale: "Whether a recorded decision is adequately argued is a judgment call, not a test outcome. The lint gate proves only that the prose leaks no local identity."

# Metrics
duration: 22min
completed: 2026-08-26
status: complete
---

# Phase 163 Plan 09: Security floor — password policy + audit law Summary

**The client password floor collapses to one exported `MIN_PASSWORD_LENGTH` backed by a measured hosted minimum of 6, and `add_wizard_composite_key` enters `MUTATING_RPC_NAMES` — which is what turns its long-decorative `@audit-skip` pragma into a rule the gate actually enforces.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-08-26T14:11:00Z
- **Completed:** 2026-08-26T14:33:00Z
- **Tasks:** 2
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments

- **SEC-01 — the floor is backed, not decorative.** The hosted minimum (6, no character-class requirement) had never been read; it was RESEARCH assumption A1. It is now a dated measurement, recorded with the method that produced it, and the two independent client constants that could drift from it are one constant.
- **SEC-03 — the pragma became law, and the proof is a control, not an argument.** Deleting the `@audit-skip` pragma at `strategies/composite/add-key/route.ts:477` *before* the allowlist edit left the audit-coverage suite fully GREEN — an unaudited, unpragma'd mutating RPC passing the audit law. After the edit, the same deletion turns it RED and names the site. That before/after pair is the evidence the entry was load-bearing.
- **The adjacent stale comment was re-measured, and the debt turned out to be bigger than recorded.** DEF-141.2-03-A described stale coordinates. The re-measurement found the count wrong in both directions: a listed site no longer exists, three unlisted ones do. The uncovered single-line-mutation set is **6**, not 4.

## Task Commits

1. **Task 1: Read the hosted password policy, unify the client floor, document** — `a72849026` (feat)
2. **Task 2: Put add_wizard_composite_key under the audit law; record the decision** — `3ea4b7d95` (test)

No separate RED/GREEN commits for Task 2 — see "Deviations" below for why that is honest rather than a skipped gate.

## Files Created/Modified

- `src/lib/auth/password-policy.ts` *(created)* — the ONE exported `MIN_PASSWORD_LENGTH`; docblock carries the reading (6, no character-class requirement), the date (2026-08-26), the method (live signup-endpoint probe), the sentence that the client floor is UX only because enforcement is Supabase-side, and an explicit ⛔ against citing `supabase/config.toml` as the hosted policy.
- `src/lib/auth/password-policy.test.ts` *(created)* — pins the constant against the recorded reading and source-scans both forms for a re-hardcoded numeric `minLength`.
- `src/components/auth/SignupForm.tsx` — the bare `minLength={6}` literal and the `"At least 6 characters"` placeholder both derive from the constant.
- `src/components/auth/ResetPasswordForm.tsx` — local `const MIN_PASSWORD_LENGTH = 6` deleted, shared constant imported.
- `src/__tests__/audit-coverage.test.ts` — `"add_wizard_composite_key"` added to `MUTATING_RPC_NAMES` with the control measurement recorded at the entry; H-0001 `it.skip` census re-measured.
- `.planning/REQUIREMENTS.md` — SEC-01 and SEC-03 checked off with their decisions recorded; traceability table rows flipped to Complete.

## Decisions Made

- **Keep the pragma; do not emit at add-key time.** `add_wizard_composite_key` writes a draft strategy plus an `api_keys` row that is not yet user-visible; the user-visible creation is audited at finalize. Its column-for-column sibling `create_wizard_strategy` already follows that draft-then-finalize shape, so an emission here would make the audit log claim a strategy was created twice. The falsifier gave no reason to reverse this — it confirmed the pragma's *reason* was always coherent and only its *enforcement* was missing.
- **Record the policy as a dated reading, never an invariant.** The setting is dashboard-owned, has no repo representation, and can change outside git. The requirement entry says so explicitly, including that no test here can observe such a change.
- **Derive the user-facing copy from the constant too.** `"At least 6 characters"` was a second, unlinked copy of the same number. A floor whose message can drift from it is only half-unified.
- **Re-measure the stale census rather than re-number it.** Writing fresh-looking coordinates I had not verified would have reproduced exactly the failure DEF-141.2-03-A recorded.

## Deviations from Plan

### 1. [Plan premise partly FALSE — path] `composite/add-key/route.ts` does not exist at that path

- **Found during:** Task 2 setup.
- **Issue:** Both the plan and RESEARCH §5 refer to `composite/add-key/route.ts:477-480`. There is no `src/app/api/wizard/composite/` tree. The real path is `src/app/api/strategies/composite/add-key/route.ts`.
- **Assessment:** an abbreviation, not a wrong claim — the pragma is at :477-480 of that file exactly as described, and RESEARCH §5 does give the full correct path elsewhere in the same section. Recorded because the plan text alone sends you to a nonexistent file.
- **Fix:** used the real path. No code change.

### 2. [Plan premise FALSE — census] The stale H-0001 comment was wrong in COUNT, not just coordinates

- **Found during:** Task 2, step 3 (the "opportunistic" comment fix).
- **Issue:** The plan (and the DEF item) framed this as stale line numbers. Re-measuring showed more: the comment named three flag-monitor sites including a *"kill-switch flip"* upsert that **no longer exists at all** — Phase 106 Stage B made flag-monitor alert-only, and the file now says outright it never writes the kill-switch row. Meanwhile three sites the comment never mentioned are uncovered: `keys/sync:496`, `finalize-wizard:2287`, `finalize-wizard:2360`.
- **Fix:** replaced the list with a re-measured census (6 uncovered, 4 covered), the method that produced it, and a warning not to trust the numbers past the next refactor of those routes.
- **Method (so the numbers are auditable):** enumerate every line under `src/app/api/**/route.ts` carrying `.from(` plus a `.insert|update|delete|upsert(` that does not start the line — the exact shape `findMutations`' `/^\s*\.(insert|…)\s*\(/` anchor misses — then check for an `@audit-skip` in the 8-line window above and a `logAuditEvent*` inside the **same enclosing function** (the gate walks forward only, so an emit earlier in the file or in a sibling function does not count). Function boundaries were read individually for the three newly-surfaced sites.
- **Scope note:** those six sites remain UNFIXED. H-0001 is still deferred; fixing them is production-code work outside this plan.
- **Committed in:** `3ea4b7d95`.

### 3. [Rule 3 - Blocking] No `node_modules` in the executor worktree

- **Issue:** GSD worktrees are provisioned without dependencies; `./node_modules/.bin/vitest` did not exist. Left unfixed, `npx` would have downloaded a *different* vitest rather than failing.
- **Fix:** symlinked the main checkout's `node_modules` into the worktree. `node_modules` is gitignored — `git status` stayed clean and nothing was committed.
- **Verification:** `vitest --version` → `vitest/4.1.10`; `git status --short` empty.

### 4. [Procedural] Task 2's TDD gates are one commit, not three

- Task 2 is marked `tdd="true"`, but its RED phase *is* the allowlist edit itself — there is no separate failing-test-then-implementation pair to commit, because the "implementation" (the pragma) already existed at HEAD and the "test" (the allowlist entry) is what makes it count. The RED→GREEN cycle was executed and observed in the working tree (transcript below) rather than split across commits, since committing a deliberately-broken production route would be worse than not committing it.
- Recording this instead of quietly emitting a `test(...)`/`feat(...)` pair that would misrepresent what happened.

---

**Total deviations:** 4 — 2 false/incomplete plan premises (recorded, no scope change), 1 Rule 3 blocking fix, 1 procedural note.
**Impact on plan:** No scope widened. Only the six files in `files_modified` were changed.

## Anti-vacuity demonstrations (every assertion proven able to fail)

Each neuter was restored from a byte copy taken immediately before it, and every restore was confirmed by `shasum` against the pre-neuter hash. `git checkout --` was not used.

**SEC-01 — three neuters, three observed REDs:**

1. **Re-hardcode the literal** — `minLength={MIN_PASSWORD_LENGTH}` → `minLength={6}` in `SignupForm.tsx`:
   ```
   × SignupForm.tsx passes no numeric minLength literal
     AssertionError: expected [ 'minLength={6}' ] to be null
   × SignupForm.tsx still applies a minLength to its password input(s)
     AssertionError: expected '"use client";\n\nimport { useState } …' to match /minLength=\{MIN_PASSWORD_LENGTH\}/
     Tests  2 failed | 8 passed (10)
   ```
   This is the one a rendered-value assertion could never catch: a hardcoded `6` renders identically to the constant's `6`.

2. **Drop the constant below the measured hosted minimum** — `MIN_PASSWORD_LENGTH = 6` → `5`:
   ```
   × is 6 — the minimum the hosted signup endpoint reported on 2026-08-26
     AssertionError: expected 5 to be 6 // Object.is equality
   × is at least 6 — a lower client floor would advertise passwords the hosted policy rejects
     AssertionError: expected 5 to be greater than or equal to 6
     Tests  2 failed | 8 passed (10)
   ```

3. **Revert the unification** — remove the import and restore a private constant in `ResetPasswordForm.tsx` (i.e. put the file back in its exact pre-SEC-01 state):
   ```
   × ResetPasswordForm.tsx imports MIN_PASSWORD_LENGTH from the policy module
     AssertionError: expected '"use client";\n\nimport { useState } …' to match /import\s*\{[^}]*\bMIN_PASSWORD_LE…/
   × ResetPasswordForm.tsx declares no local MIN_PASSWORD_LENGTH
     AssertionError: expected '"use client";\n\nimport { useState } …' not to match /^\s*const\s+MIN_PASSWORD_LENGTH\s*=/m
     Tests  2 failed | 8 passed (10)
   ```

**SEC-03 — the control/treatment pair (this is the load-bearing evidence):**

- **CONTROL — pragma deleted, name NOT yet in the allowlist:**
  ```
  Test Files  1 passed (1)
       Tests  17 passed | 1 skipped (18)
  ```
  Green. A mutating RPC with no audit emission and no pragma passed the audit law. That is the escape SEC-03 exists to close, measured rather than asserted.

- **TREATMENT — same deletion, name now listed (RED):**
  ```
  × every .insert/.update/.delete/.upsert has a logAuditEvent or @audit-skip
    src/app/api/strategies/composite/add-key/route.ts:477
      > const { data, error } = await rpcAdmin.rpc("add_wizard_composite_key", {
    Tests  1 failed | 16 passed | 1 skipped (18)
  ```

- **RESTORED — pragma back, name listed:** `17 passed | 1 skipped`, route hash `8999d769…` identical to pre-neuter.

## Verification

| Gate | Result |
|---|---|
| `npx vitest run src/lib/auth/password-policy.test.ts src/components/auth` | 10 files, **52 passed** |
| `npx vitest run src/__tests__/audit-coverage.test.ts src/__tests__/contracts` | 6 files, **126 passed, 1 skipped** |
| Full vitest suite | **810 files passed, 19 skipped; 12669 tests passed, 281 skipped, 0 failed** (185s — a clean, uncontended run) |
| `npm run lint` | 0 errors, 3 pre-existing warnings (unrelated files, untouched). `check-planning-hygiene` **OK — 5711 tracked files scanned, none carry the local username or an absolute home path** |
| `tsc --noEmit` | clean |

## Issues Encountered

- **No `node_modules` in the worktree** — resolved by symlink (deviation 3).
- **Verifying the census cost more than "opportunistic" implied.** Establishing whether the three newly-surfaced sites are genuinely uncovered required reading function boundaries in three files, because the gate's forward-only walk means an emit earlier in the same file does not cover a later mutation. Doing it properly was the only alternative to writing numbers I could not stand behind.

## What I could NOT verify

- **That the hosted policy is still 6 at any moment after 2026-08-26.** It is dashboard-owned with no repo representation. This is stated as a limit in both the module docblock and the SEC-01 entry rather than papered over.
- **The character-class conclusion rests on GoTrue enumerating every violated reason** — a documented behaviour and a sound inference from the single observed response (`reasons = ["length"]` for a 1-character password that violates length and every class at once), but it was not independently confirmed with a second probe shaped to isolate character classes.
- **Task 1's precondition probe was performed by the orchestrator, not by me.** I consumed the recorded reading from `163-CONTEXT.md` as instructed and did not re-run it (re-probing production auth for a number already measured would be gratuitous traffic against a live surface).
- **CI-only behaviour.** Everything above ran on local Node 25; CI runs Node 22, which has previously produced CI-only vitest failures in this repo. Nothing here is ordering- or DOM-sensitive, but I cannot claim a green CI run from a local one.

## Next Phase Readiness

- **Phase 164 (SHARE) is unblocked.** `MUTATING_RPC_NAMES` is the ONE edit SHARE's mint/revoke RPCs must land in, and that gate is now demonstrably functional rather than assumed to be — SEC-03 standing was a hard prerequisite of 164 and it now stands on a measurement.
- **Carried forward, unfixed:** the six single-line mutation sites (H-0001) remain unaudited and undetected. Out of scope here; the census in `audit-coverage.test.ts` is now accurate enough to act on.
- **Note for whoever raises the hosted minimum:** it is a founder-visible live op, and the number lives in exactly two places afterwards — the dashboard, and `MIN_PASSWORD_LENGTH` plus its docblock and the SEC-01 entry. The test fails if the constant moves without the reading.

## Self-Check: PASSED

- `src/lib/auth/password-policy.ts` — FOUND
- `src/lib/auth/password-policy.test.ts` — FOUND
- `src/components/auth/SignupForm.tsx` — FOUND (modified)
- `src/components/auth/ResetPasswordForm.tsx` — FOUND (modified)
- `src/__tests__/audit-coverage.test.ts` — FOUND (modified)
- `.planning/REQUIREMENTS.md` — FOUND (modified)
- Commit `a72849026` — FOUND
- Commit `3ea4b7d95` — FOUND

---
*Phase: 163-harden-fail-safe-closed-and-loud*
*Completed: 2026-08-26*

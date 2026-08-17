---
phase: 145-job-csv-finalize-atomicity
plan: 01
subsystem: database
tags: [supabase, sql-gate, plpgsql, security-definer, csv-finalize, reproduction, 42501]

requires:
  - phase: 140.4 (SEAMRIM-03)
    provides: "20260728120000 finalize_csv_strategy body (the LATEST definition the gate pins) + the claims idiom in test_csv_finalize_double_submit.sql"
  - phase: 144-job-wr-02-orphaned-running
    provides: "throwaway-harness register (144-throwaway-harness.sql usage block) and the neuter-RED discipline"
provides:
  - "supabase/tests/test_csv_finalize_auth_guard.sql — permanent ungated CI gate pinning BOTH finalize_csv_strategy 42501 raises (SC#1 arm 1)"
  - "145-repro-harness.sql — throwaway-cluster harness loading the REAL 20260728120000 body with a fragment-scoped anti-vacuity assertion"
  - "145-REPRODUCTION.md — arms 1-3 executed and recorded verbatim; arm 4 + census PENDING with pre-registered oracles for Plan 02"
  - "PITFALLS.md/SUMMARY.md forwarding anchors corrected to process_key.py:1119-1156"
affects: [145-02 (arm 4 + census + TODOS closure), 145-03 (fold migration must re-point the gate in the same commit), gsd-verifier]

actuals:
  tokens: 13415
  tasks: 3
  commits: 1

tech-stack:
  added: []
  patterns:
    - "Auth-guard SQL gate: ungated two-part 42501 pin (exact message + mismatch shape) with per-part BEGIN/ROLLBACK and the claims idiom"
    - "Harness anti-vacuity: fragment-scoped pg_get_functiondef assertion proving the REAL (latest) body loaded before any gate result counts"

key-files:
  created:
    - supabase/tests/test_csv_finalize_auth_guard.sql
    - .planning/phases/145-job-csv-finalize-atomicity/145-repro-harness.sql
    - .planning/phases/145-job-csv-finalize-atomicity/145-REPRODUCTION.md
  modified:
    - .planning/research/PITFALLS.md
    - .planning/research/SUMMARY.md

key-decisions:
  - "Neuter variants run as scratch copies of the gate (repo file never modified) — same observed RED, no restore-risk on the committed file"
  - "requirements-completed left empty: JOB-06 spans the whole phase (arm 4, the fold, the orphan disposition are Plans 02+); marking it complete after the repo-side arms alone would be a false checkbox"
  - "20260501055202 correction arm was a verified no-op: zero hits in either research doc at HEAD (re-measured per the ledger-claims rule, not inherited)"

patterns-established:
  - "SC#1 split statement: 'the GUARD is live, the PATH is closed' — stated in the artifact so a flat 'not a bug' cannot license deleting the guard"

requirements-completed: []

coverage:
  - id: D1
    description: "Permanent CI gate test_csv_finalize_auth_guard.sql pins both finalize_csv_strategy 42501 raises (no-session exact message; identity-mismatch shape), ungated, per-part BEGIN/ROLLBACK, no backslash meta-commands"
    requirement: "JOB-06"
    verification:
      - kind: integration
        ref: "psql -h $TMPDIR/145-tracer-wt -U postgres -d q145 -v ON_ERROR_STOP=1 -f supabase/tests/test_csv_finalize_auth_guard.sql (against the REAL 20260728120000 body; exit 0, both parts NOTICE OK)"
        status: pass
      - kind: other
        ref: "neuter-RED both parts: scratch variants observed exit 3 with 'RETURNED <uuid> instead of raising'; restored gate re-run GREEN"
        status: pass
    human_judgment: false
  - id: D2
    description: "145-repro-harness.sql loads the REAL migration body and self-proves it (anti-vacuity NOTICE observed on apply)"
    requirement: "JOB-06"
    verification:
      - kind: integration
        ref: "psql apply of 145-repro-harness.sql — NOTICE '145 harness: REAL 20260728120000 finalize_csv_strategy body loaded'"
        status: pass
    human_judgment: false
  - id: D3
    description: "145-REPRODUCTION.md — arms 1-3 complete with verbatim outputs, D-02 split statement, arm-4/census PENDING with pre-registered oracles"
    requirement: "JOB-06"
    verification:
      - kind: other
        ref: "grep -c PENDING (3) and grep -c 42501 (15) in 145-REPRODUCTION.md; arm-2 grep re-run live at HEAD 330bca56; arm-3 pytest 9 passed"
        status: pass
    human_judgment: true
    rationale: "The per-hit call-site classification and the split statement are prose claims about code; automation only checks presence markers, not classification correctness"
  - id: D4
    description: "Stale ~792-820 anchors corrected to process_key.py:1119-1156 in PITFALLS.md (2 sites) and SUMMARY.md (1 site); 20260501055202 verified already absent"
    verification:
      - kind: other
        ref: "grep -n 792 / grep -rn 20260501055202 over both research docs — zero hits post-edit; git diff shows exactly 3 changed lines"
        status: pass
    human_judgment: false

duration: 14min
completed: 2026-08-17
status: complete
---

# Phase 145 Plan 01: SC#1 Reproduction (repo-side arms) Summary

**Executable CANNOT-REPRODUCE evidence for the stale 42501 claim: a permanent two-part SQL CI gate proving both finalize_csv_strategy 42501 guards fire (observed RED under neuter, both parts), a fresh call-site grep showing both callers user-scoped, the 9 passing pytest wiring gates recorded verbatim, and the corrected research anchors — one atomic commit.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-08-17T17:29:12Z
- **Completed:** 2026-08-17T17:43:30Z
- **Tasks:** 3
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- **Arm 1 as a permanent CI gate:** `supabase/tests/test_csv_finalize_auth_guard.sql` — Part A pins SQLSTATE 42501 AND the exact message `finalize_csv_strategy called without an auth session` (20260728120000:226); Part B pins 42501 with the `does not match auth.uid` mismatch shape (:230-234). Ungated, claims idiom, per-part BEGIN/ROLLBACK, gen_random_uuid() everywhere, zero backslash characters in the file.
- **Tracer proof against the REAL body:** throwaway Postgres 16.13 cluster (`$TMPDIR/145-tracer-wt`); `145-repro-harness.sql` loads the 20260728120000:196-309 body verbatim and the fragment-scoped anti-vacuity assertion passed BEFORE any gate result was trusted.
- **Neuter-RED, BOTH parts (W3 amendment):** Part A neutered (valid matching claims → guard satisfied) → observed `ERROR: TEST FAILED (Part A): ... RETURNED 68b6aee6-... instead of raising`, exit 3. Part B neutered (matching identity → mismatch raise absent) → observed `ERROR: TEST FAILED (Part B): ... RETURNED 7a7fc964-... instead of raising`, exit 3. Restored gate re-run GREEN, exit 0.
- **Arm 2 executed FRESH at HEAD 330bca56:** 34 grep hits, exactly 2 call sites — `route.ts:1471/:1483` on the SSR cookie client (`createClient()` from `@/lib/supabase/server`), `process_key.py:1151` on `get_user_scoped_supabase(user_token)`. Zero calls on `get_supabase()`/`createAdminClient()`. Full verbatim output + per-hit classification table in 145-REPRODUCTION.md.
- **Arm 3 recorded verbatim:** `python3 -m pytest tests/test_process_key.py -k "csv_finalize" -q` from `analytics-service/` — 9 passed, 104 deselected; the wiring-only overclaim caveat is stated INSIDE the artifact.
- **145-REPRODUCTION.md** carries the D-02 split ("the GUARD is live, the PATH is closed"), the pre-registered arm-4 oracle verbatim, the PENDING census section, and the verdict line "PENDING arm 4 — arms 1-3 consistent with CANNOT REPRODUCE".
- **Anchor corrections (D-04, same commit):** PITFALLS.md:201/:328 and SUMMARY.md:20 `~792-820` → `process_key.py:1119-1156` (span re-verified true at HEAD). `20260501055202` already absent from both docs — verified, nothing to correct.

## Task Commits

Tasks 1-3 deliberately share ONE atomic commit (D-04's same-commit requirement, stated in the plan — Tasks 1 and 2 each end "do NOT commit yet"):

1. **Tasks 1-3: gate + harness + artifact + anchor corrections** - `75b1c702` (docs)

**Plan metadata:** separate commit (this SUMMARY only — see Deviations).

## Files Created/Modified

- `supabase/tests/test_csv_finalize_auth_guard.sql` - the SC#1 arm-1 permanent CI gate (two 42501 parts)
- `.planning/phases/145-job-csv-finalize-atomicity/145-repro-harness.sql` - throwaway-cluster harness: auth.uid() stub, minimal real-constraint replicas (strategies 5-value CHECK, partial unique index, strategy_verifications CHECKs+FK), verbatim loader, anti-vacuity assertion
- `.planning/phases/145-job-csv-finalize-atomicity/145-REPRODUCTION.md` - arms 1-3 complete; arm 4 + census PENDING for Plan 02
- `.planning/research/PITFALLS.md` - 2 anchor lines corrected
- `.planning/research/SUMMARY.md` - 1 anchor line corrected

## Decisions Made

- Neuter variants were scratch copies of the gate file (repo file never edited) — identical observation, zero restore-risk.
- `requirements-completed` left empty: JOB-06 completes with the phase (arm 4, fold, orphan disposition are Plans 02+), not with this plan.
- Part B's neuter seeds the probe user in auth.users so the neutered path cleanly reaches "returned instead of raising" rather than an FK 23503 (which would be RED for the wrong reason).

## Deviations from Plan

**1. [Minor] Throwaway socket dir `$TMPDIR/145-tracer-wt` instead of the plan-verify literal `$TMPDIR/145-tracer`**
- **Found during:** Task 1 setup
- **Reason:** Orchestrator instruction — a DISTINCT data dir so this worktree cannot collide with any harness the main (mid-Phase-144) checkout used
- **Impact:** The plan's `<verify>` command was run identically with the `-wt` socket; exit 0. The harness usage block documents the `-wt` path.

**2. [Rule 3-adjacent, no-op] The `20260501055202` anchor-correction arm had nothing to correct**
- **Found during:** Task 3
- **Issue:** The plan (and D-04) direct correcting `20260501055202` citations in PITFALLS.md/SUMMARY.md; a fresh grep at HEAD (all forms: `20260501`, `migration 093`) found ZERO hits in either doc
- **Fix:** Recorded as verified-absent rather than fabricating an edit (ledger blockers are dated claims — re-measured at HEAD)
- **Verification:** `grep -rn "20260501055202" .planning/research/PITFALLS.md .planning/research/SUMMARY.md` → empty

**3. [Scope-fence] STATE.md / ROADMAP.md / REQUIREMENTS.md deliberately NOT updated in this worktree**
- **Reason:** Orchestrator scope guard: "no `.planning/STATE.md`/`ROADMAP.md`, nothing under `144-*`" — the main checkout is mid-Phase-144 and owns state. The metadata commit carries this SUMMARY only; state advancement happens in the orchestrator session at merge time.

---

**Total deviations:** 3 (1 environment, 1 verified no-op, 1 orchestrator-mandated scope fence)
**Impact on plan:** None on substance — all acceptance criteria met; no scope creep.

## Known Stubs

None. The PENDING sections in 145-REPRODUCTION.md (arm 4, census, final verdict) are the plan's designed handoff to Plan 02 (orchestrator-session-only work), each with a pre-registered oracle — not stubs.

## Threat Flags

None — no new security surface. The new SQL file is a CI test (per-part ROLLBACK, no residue); the harness is planning-artifact-only and its header forbids running it against any Supabase project.

## Issues Encountered

- `grep -c "finalize" | grep -qx "0"` in the Task-3 verify would fail on a truly-empty grep (count pipeline exits 1 before the comparison); verified the equivalent facts directly (`grep -rn "20260501055202"` → no output, exit 1) and the composite verify's first two legs passed as written.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02 (orchestrator session) can now run arm 4 + the census against its pre-registered oracles and write the final verdict + TODOS.md:818-821 closure citing 145-REPRODUCTION.md.
- Plan 03's fold migration MUST re-point `test_csv_finalize_auth_guard.sql` in the same commit as any DROP of the 5-arg function (the gate header states this).
- The harness is reusable for Plan 03's local iteration on the folded function's gate extension.

## Self-Check: PASSED

- `supabase/tests/test_csv_finalize_auth_guard.sql` — FOUND
- `.planning/phases/145-job-csv-finalize-atomicity/145-repro-harness.sql` — FOUND
- `.planning/phases/145-job-csv-finalize-atomicity/145-REPRODUCTION.md` — FOUND
- Commit `75b1c702` — FOUND (5 files, single atomic commit)

---
*Phase: 145-job-csv-finalize-atomicity*
*Completed: 2026-08-17*

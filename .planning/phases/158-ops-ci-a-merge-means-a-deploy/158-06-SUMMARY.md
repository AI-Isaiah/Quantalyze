---
phase: 158-ops-ci-a-merge-means-a-deploy
plan: 06
subsystem: testing
tags: [github-actions, ci, playwright, e2e, csrf, supabase, database-types, todos]

requires:
  - phase: 158-ops-ci-a-merge-means-a-deploy
    provides: "158-05's BATCH VERDICTS table (measured per-spec batch placement) and the five repaired/authored specs"
  - phase: 158-ops-ci-a-merge-means-a-deploy
    provides: "158-01's ci.yml at HEAD — advisory-lock mutex + aggregator regions this plan must not touch"
provides:
  - "The four requirement-named orphan specs + the new NAV-01 spec wired into real CI batches (2 unseeded, 3 seeded)"
  - "NEXT_PUBLIC_ALLOWED_ORIGINS on the unseeded e2e job — the one env condition 158-05's verdicts required"
  - "17 [158-OPS-03] TODOS dispositions closing the orphan class, incl. two measured corrections to the research census"
  - ".../158-DB-TYPES-DECISION.md — the recorded no-gate decision OPS-03 explicitly permits"
  - "Measured finding: the 15 remaining orphans are blocked by ONE missing seeded-identity convention, not 15 wirings"
affects: [OPS-03, ROADMAP 158 SC-3, any future e2e batch wiring, any future DB-types gate proposal]

actuals:
  tokens: 6693
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Batch wiring consumes a prior plan's MEASURED verdict table verbatim; the wiring plan never re-derives placement"
    - "A spec may join the seeded batch for the seeded ENVIRONMENT without being seed-GATED — the two are distinct, and the distinction is recorded in-file so it is not 'fixed' away"

key-files:
  created:
    - .planning/phases/158-ops-ci-a-merge-means-a-deploy/158-DB-TYPES-DECISION.md
  modified:
    - .github/workflows/ci.yml
    - TODOS.md
    - .planning/WINDOWS.md

key-decisions:
  - "full-flow joins the SEEDED list without a HAS_SEED_ENV constant, diverging from the plan's literal acceptance text. 158-05 measured that it reads no seed env and mints nothing — it needs the seeded ENVIRONMENT (its anon cases were measured red under placeholder Supabase), not a seed GATE. Bolting on HAS_SEED_ENV would self-skip the very cases it is wired to run. The plan's own automated verify greps HAS_SEED_ENV for my-strategies only, so the binding gate agrees; the phase constraint ('follow the verdicts table VERBATIM') breaks the tie."
  - "No DB-types regeneration gate. Recorded as a reasoned decision with three measured reasons, two named compensating controls, and a two-part revisit trigger — the branch OPS-03 explicitly permits."
  - "No orphan spec is dispositioned delete-candidate: every route the 15 target still exists in src/app/ (verified this session), so deletion would destroy coverage intent rather than remove dead weight."
  - "Two pre-existing defects found while triaging (a public-repo credential literal; a lost hand-patch tripwire comment) were SURFACED in TODOS, not fixed — each belongs in its own reviewed change, not buried in a CI-wiring commit."

patterns-established:
  - "Disposition lines must carry a decision verb (wire-later / defer / delete-candidate), enforced by a gate that greps the verb — a description is not a disposition"
  - "Class closure states the shared root cause (here: one missing identity convention behind 15 orphans), not 15 independent shrugs"

requirements-completed: [OPS-03]

coverage:
  - id: D1
    description: "The four requirement-named orphan specs and the new my-strategies spec each appear exactly once in ci.yml, in the batch 158-05's verdict table assigned"
    requirement: "OPS-03"
    verification:
      - kind: other
        ref: "p158-06-verify-task1.sh — per-spec grep count == 1 for all five; api-key-flow + sync-analytics-flow resolve to the unseeded invocation line, full-flow + csv-upload-flow + my-strategies inside the seeded list; js-yaml parses ci.yml (17 jobs)"
        status: pass
      - kind: other
        ref: "non-vacuity: planting a duplicate my-strategies entry drives the count to 2, so the exactly-once check discriminates"
        status: pass
    human_judgment: false
  - id: D2
    description: "MA-8 both-halves holds for the two seed-GATED additions (list entry + in-spec HAS_SEED_ENV)"
    requirement: "OPS-03"
    verification:
      - kind: other
        ref: "grep -c HAS_SEED_ENV: csv-upload-flow=6, my-strategies=5 (both authored by plan 158-05); full-flow=0 by measured design, recorded in the MA-8 comment"
        status: pass
    human_judgment: false
  - id: D3
    description: "The unseeded e2e job carries NEXT_PUBLIC_ALLOWED_ORIGINS so the repaired contract POSTs reach the auth arm instead of 403-ing at the CSRF gate"
    requirement: "OPS-03"
    verification:
      - kind: other
        ref: "the literal appears in exactly 2 jobs (unseeded + the pre-existing seeded precedent at the e2e-seeded step); csrf.ts:41 reads it via process.env at request time, and the seeded job proves the runtime read works (its build step does not set the var either)"
        status: pass
    human_judgment: true
    rationale: "The mechanism is proven by the landed seeded precedent and by 158-05's placeholder-env measurement, but this ADOPTED unseeded env line has never executed in a real CI run. Production mode + a prebuilt artifact this job cannot rebuild is a slightly different shape from the seeded job's self-built bundle; the phase PR's first run is what proves it in situ. If it is wrong, api-key-flow and sync-analytics-flow go red on the unseeded batch with 'Origin not allowed'."
  - id: D4
    description: "Every newly wired spec reports >=1 executed (non-skipped) case in its batch — wired-but-all-skip is the same false-coverage state as orphanhood"
    requirement: "OPS-03"
    verification: []
    human_judgment: true
    rationale: "The plan's declared backstop truth, and NOT runnable from a worktree: it is a read-off of the phase PR's e2e + e2e-seeded Playwright per-spec output. 158-05 proved each spec executes real cases locally against a TEST-pointed server (13 passed / 31 reasoned skips combined, plus my-strategies 1 passed seeded with a red neuter drill), which is the strongest available pre-CI evidence, but local != CI. Recorded in .planning/WINDOWS.md as an unrun-verify."
  - id: D5
    description: "All 15 remaining orphan specs plus portfolio-pdf-demo carry a one-line recorded disposition tagged [158-OPS-03], closing OPS-03 as a class"
    requirement: "OPS-03"
    verification:
      - kind: other
        ref: "p158-06-verify-task2.sh — 17 tagged lines (>=16 required), each carrying a disposition verb; all 16 named specs matched by name; zero pre-existing TODOS lines removed or modified; stripping the tag drives the count to 0, so the gate discriminates"
        status: pass
    human_judgment: false
  - id: D6
    description: "DB-types drift carries an explicitly recorded decision NOT to gate, with the soundness blockers and the compensating control named"
    requirement: "OPS-03"
    verification:
      - kind: other
        ref: "158-DB-TYPES-DECISION.md contains the DECISION statement, migration 20260621120000, the schema-authority blocker, the broken local replay (P156-IN-01), both compensating controls (database.types.test.ts pins + regen-when-touched), the two-part revisit trigger, and the src/lib/types.ts scope note; no workflow/script/migration created"
        status: pass
    human_judgment: false

duration: 20 min
completed: 2026-08-20
status: complete
---

# Phase 158 Plan 06: OPS-03 class closure Summary

**The four specs the requirement names — orphaned in no CI batch for ~2 years — plus the new NAV-01 spec now run in real batches (2 unseeded, 3 seeded) on 158-05's measured verdicts; the 15 remaining orphans carry recorded dispositions that name their shared root cause; and DB-types drift has the reasoned no-gate decision OPS-03 permits.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-20T18:32Z
- **Tasks:** 2 of 2
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- **The never-runs now run.** `api-key-flow` and `sync-analytics-flow` joined the unseeded
  `e2e` batch; `full-flow`, `csv-upload-flow` and the new `my-strategies` joined the seeded
  `e2e-seeded` MA-8 batch. Placement is 158-05's measured verdict table verbatim — this plan
  re-derived nothing.
- **The one env condition the verdicts required is in place.** The unseeded job now sets
  `NEXT_PUBLIC_ALLOWED_ORIGINS: http://localhost:3000`, mirroring the seeded job's existing
  line. `npm run start` is production mode, so `csrf.ts`'s localhost auto-allowlist never
  fires and the runtime allowlist is empty; without this the repaired contract POSTs 403
  before auth and would assert the CSRF arm instead of the auth contract they exist to pin.
- **OPS-03 closed as a class with a root cause, not 15 shrugs.** The 15 remaining orphans
  between them reach for **four mutually incompatible identity mechanisms** — `E2E_TEST_*`,
  `QUANTALYZE_E2E_PASSWORD`, `E2E_ADMIN_*`, hardcoded literals — plus
  `PLAYWRIGHT_TEST_STRATEGY_ID` for fixture identity, none provisioned by any job, and **two
  different seed-gate constant names** (only `HAS_SEED_ENV` is what MA-8 keys on). The blocker
  is one missing convention, not fifteen wirings.
- **The DB-types decision is recorded with substance**, including a hand-patch census wider
  than the research had and a real prior occurrence of the failure mode it guards against.

## Task Commits

1. **Task 1: wire the five specs into the correct batch lists** — `02b3ab9f` (fix)
2. **Task 2: record the 15 dispositions + the DB-types decision** — `6c78744a` (docs)

## Final batch assignments

| Spec | Batch | Why (158-05's measured verdict) |
|---|---|---|
| `api-key-flow.spec.ts` | unseeded `e2e` | 3 passed under placeholder env; needs the allowlist env line |
| `sync-analytics-flow.spec.ts` | unseeded `e2e` | 4 passed under placeholder env; same env line |
| `full-flow.spec.ts` | seeded `e2e-seeded` | **environment, not gate** — anon cases measured RED under placeholder (landing→/browse exceeds the 5s URL budget while SSR hangs); 4 passed against TEST |
| `csv-upload-flow.spec.ts` | seeded `e2e-seeded` | seed-gated (converted by 158-05); 2 passed / 2 reasoned skips |
| `my-strategies.spec.ts` | seeded `e2e-seeded` | seed-gated; both polarities + red neuter drill observed |

## Measured corrections to the research census

Both were found by re-deriving the census at HEAD rather than trusting the dated table
(53 specs in `e2e/`, 20 in no batch — the count matches, the contents shifted by
`portfolio-pdf-demo` leaving and `my-strategies` arriving).

1. **`portfolio-pdf-demo` has NO orphaned cases.** The census row read "non-@nightly cases
   orphaned", implying a split. Measured: BOTH describes carry `@nightly` in their titles
   (`:99`, `:160`) and `nightly.yml:109` greps on that tag, which matches full titles — so all
   8 cases run nightly. ⚠️ The real defect is the inverse of the recorded one: the token-shape
   describe's docblock (`:85-97`) says those cases need no secret and *"MUST run in main CI to
   keep verifier-branch coverage on every PR"*, and an audit split the describes to restore
   exactly that — but the split describe still carries `@nightly`, so the intended per-PR
   coverage never happened.
2. **`mandate-form` is seed-gated under a non-conforming constant name** (`HAS_SEEDED_SUPABASE`,
   not `HAS_SEED_ENV`). Wiring it would have satisfied MA-8's list half while the in-spec half
   silently did not apply — the exact both-places failure the MA-8 comment exists to prevent.

## The DB-types decision (artifact: `158-DB-TYPES-DECISION.md`)

No regeneration gate is added. Three measured reasons:

1. **Three hand-patched regions, not one.** The research named `scenarios`
   (`20260621120000`). Measured: `for_quants_leads` (migration 115) and `scenario_shares`
   (`20260622120000`) are hand-patched too. A regen against a target missing their migrations
   either reds forever or "resolves" the diff by committing the reversion the type pins exist
   to catch. **Not hypothetical** — `database.types.ts:1080-1081` records a 2026-08-12 regen
   against the correct target that still stripped the tripwire comment, re-applied by hand.
2. **No schema-authoritative, CI-reachable target.** PROD is authoritative but unsafe to touch
   per PR; TEST lags (caught up manually), so a gate would red on the lag; local replay is
   broken (`P156-IN-01`).
3. **The drift complained of was already closed.** `computation_warned` and
   `metrics_json_by_basis` are present (`:2576-2656`, 6 hits) since `a6a2dee8`.

Compensating controls kept and named: the `database.types.test.ts` type-level pins
(C-0156 / PERSIST-01 — a stale regen that DROPS a pinned column fails the build) and
regen-when-touched. The residual they do not cover (a brand-new column nothing pins and
nothing reads) is stated in the artifact rather than hidden. Revisit requires BOTH an
authoritative CI-reachable target AND the hand-patches reconciled into regenerable state.

## Deviations from Plan

### 1. [Plan letter vs measured verdict — conflict surfaced, verdict followed] `full-flow` has no `HAS_SEED_ENV`

- **Found during:** Task 1
- **Conflict:** The plan's acceptance criterion reads *"Every seeded-list addition's spec file
  contains the HAS_SEED_ENV constant (MA-8 both-halves)"*. 158-05's verdict table says
  full-flow is seeded *"(env, not helpers) … List membership only; no seed env is read by the
  spec"*. Both cannot hold.
- **Resolution:** Followed the verdict. MA-8's both-halves rule governs seed-**gated** specs;
  full-flow is environment-**dependent**, a different thing. Adding a `HAS_SEED_ENV` gate would
  self-skip precisely the anon cases it is wired to run. Three independent signals agree: the
  phase constraint says follow the verdicts table verbatim, the plan's own automated `<verify>`
  greps `HAS_SEED_ENV` for `my-strategies` only, and the plan's escape clause ("if a converted
  spec lacks it, that is a 158-05 regression to fix there, not here") does not fire because
  158-05 did not convert full-flow. Recorded in the MA-8 comment with a `do NOT "fix" this`
  note so the next reader does not close the gap wrongly.

### 2. [Rule 2-adjacent — SURFACED, deliberately not fixed] Public-repo credential literal

- **Found during:** Task 2 triage
- **Issue:** `e2e/for-quants-onboarding.spec.ts:31-32` hardcodes a personal-looking email
  address and a short password literal, committed in a world-readable repository. This is the
  same class 158-05 removed from `csv-upload-flow`.
- **Handling:** Flagged prominently in TODOS with an explicit "act on this independently of
  wiring" instruction, and the values are **not reproduced** in any artifact this plan wrote
  (gate check 8 verifies that). Not fixed here: scrubbing a credential is its own reviewed
  change, and it is out of this plan's declared `files_modified` scope. Burying it in a
  CI-wiring commit is how such fixes get lost.

### 3. [Rule 2-adjacent — SURFACED, deliberately not fixed] `scenario_shares` lost its tripwire comment

- **Found during:** Task 2, while writing the decision artifact
- **Issue:** `database.types.ts:2326` is hand-patched per its own test docblock but carries no
  in-file `HAND-PATCHED` warning, unlike its two siblings. Its type pins are intact, so the
  load-bearing control holds; the missing piece is the warning to the next regenerator.
- **Handling:** Recorded in both the decision artifact and TODOS. Not patched: it edits a
  generated file outside this plan's scope.

### 4. [Self-correction] My own TODOS gate caught two defects in my own artifact

- The section header carried the `[158-OPS-03]` tag, inflating the count from 17 real
  dispositions to 18 and making the count gate slightly dishonest; and one entry's disposition
  verb sat on its second line, so a line-scoped verb check could not see it. Both were fixed by
  correcting the artifact (removing the tag from the header, moving the verb onto the first
  line) rather than by loosening the check.

---

**Total deviations:** 1 plan-vs-measurement conflict resolved in favour of the measurement,
2 pre-existing defects surfaced-not-fixed (with reasons), 1 self-correction.
**Impact on plan:** No scope creep — the diff touches exactly the three declared paths plus
the shared defect ledger. The only place the plan's letter was not followed (deviation 1)
follows the phase constraint and the plan's own binding `<verify>`.

## Threat Flags

| Flag | File | Description |
|---|---|---|
| threat_flag: csrf-allowlist-widening (considered, scoped) | `.github/workflows/ci.yml` | The unseeded e2e job's runtime CSRF allowlist now admits `http://localhost:3000`. Scoped to one CI step on an ephemeral runner serving a placeholder-Supabase build; it mirrors the identical, already-landed line on the seeded job; production is unaffected because prod sets `NEXT_PUBLIC_SITE_URL` to the canonical host and never sets this var. Recorded rather than omitted because it is a deliberate widening of a security control, even though the blast radius is a CI runner. |

## Issues Encountered

- **The sandbox refuses compound shell commands in this worktree** (same constraint plan
  158-01 hit). All multi-step verification moved into standalone scratchpad scripts with
  plan-unique `p158-06-*` filenames, per the shared-scratchpad collision hazard.
- **No `node_modules` in a GSD worktree**, so the mandated
  `critical-regressions.test.ts` run could not resolve vitest. Resolved by symlinking the main
  checkout's `node_modules` into the worktree (gitignored, never staged), running on **Node 22**
  (`/opt/homebrew/opt/node@22/bin`, matching CI rather than the local Node 25), and removing
  the symlink afterward. Result: **140/140 passed**, before and after the ci.yml edits.
- **Proving that pin is not vacuous.** A green run proves nothing unless it could have been
  red, and vitest could plausibly have been reading the *main* checkout's ci.yml. Neuter drill:
  planting a diverged `pg_advisory_lock` key in this worktree's ci.yml turned the suite RED
  with the mutex assertion naming `sql-tests=99999999` — proving it reads this file — and the
  restore was verified byte-identical by sha1.

## Deferred / carried forward

- **The backstop truth is unrun** (D4): it needs the phase PR's live CI output. Recorded in
  `.planning/WINDOWS.md` as an `unrun-verify`, so it survives past this SUMMARY.
- **`csv-upload-flow`'s two server-side cases are now skipped tests inside a running batch**
  (they were previously inside a spec that ran nowhere). No `ci.yml` job provisions
  `ANALYTICS_SERVICE_URL`, so the csv wizard's upload→preview→submit happy path still has no
  executing e2e anywhere. Recorded in `.planning/WINDOWS.md` as a `skipped-test`.
- 15 orphan dispositions + 2 surfaced defects live in `TODOS.md` under `[158-OPS-03]`.

## Known Stubs

None. No placeholder value, mock data source, or unwired component was introduced — this plan
changed two CI batch lists, one env block, and three prose/record artifacts.

## User Setup Required

None for this plan's own gates. Two optional provisions would un-skip existing coverage:
`ANALYTICS_SERVICE_URL` + `INTERNAL_API_TOKEN` (un-skips csv-upload-flow's 2 server-side
cases) and `PLAYWRIGHT_TEST_STRATEGY_ID` (un-skips the UI describes in api-key-flow /
sync-analytics-flow, and unblocks two deferred orphans). Neither blocks OPS-03.

## Next Phase Readiness

- **ROADMAP 158 SC-3 is closed on this plan's half**: the orphaned specs (including the NAV-01
  surface) are in real CI batches, the remaining orphans carry recorded class dispositions, and
  DB-types drift has an explicit recorded decision with a named compensating control.
- **Watch on the phase PR's first run** (in priority order): (1) the unseeded job's
  `NEXT_PUBLIC_ALLOWED_ORIGINS` behaving in production mode against a prebuilt artifact —
  if wrong, the two newly wired unseeded specs go red with "Origin not allowed"; (2) `full-flow`
  in the shared seeded DB — its repaired case reads live rows, and the seeded batch shares one
  database across all specs; (3) the per-spec executed-case counts for D4.
- No STATE.md or ROADMAP.md write from this worktree — the orchestrator owns those.

## Self-Check: PASSED

- Files exist on disk: `.github/workflows/ci.yml` (2396 lines), `TODOS.md` (2653 lines),
  `158-DB-TYPES-DECISION.md` (162 lines, complete through its footer).
- Both commits reachable: `02b3ab9f`, `6c78744a`.
- Task-1 gate re-run on the committed state: all checks pass, including the duplicate-planting
  non-vacuity control. Task-2 gate: all checks pass, including the tag-strip non-vacuity control
  and the credential-non-reproduction check.
- Prohibitions held: zero `needs:` / `concurrency:` / `runs-on:` / `timeout-minutes:` / `if:`
  lines in the ci.yml diff (plan 158-01's regions untouched); zero paths under
  `supabase/migrations/`; no workflow or script created for DB-types.
- `STATE.md` and `ROADMAP.md` show zero changes across this plan's commits.
- `critical-regressions.test.ts` 140/140 green on Node 22, and proven able to fail against
  this worktree's ci.yml.

---
*Phase: 158-ops-ci-a-merge-means-a-deploy*
*Completed: 2026-08-20*

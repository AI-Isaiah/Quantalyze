# Phase 164.6.3 — Deferred / out-of-scope discoveries

Recorded during plan 01 (wave 1) execution, 2026-09-13. Each item names why it was NOT
fixed in plan 01 and where it must go. ⛔ Nothing here was silently absorbed.

---

## 1. `[164.6.3-MW02-DOCSONLY-BLIND]` — BLOCKING for wave 2

**Severity:** high. It is this phase's own named failure mode — a gate that silently stops
covering what it exists to cover — introduced BY this phase.

**What.** `src/__tests__/lint-sql-gates.test.ts` carries the MW02 executed-tolerance oracle.
Its headline assertion is:

> "the real loop: the jobs whose SKIP is tolerated are exactly `TOLERANCE_BEARING_JOBS` — by
> execution, spelling-free"

with the stated reason *"A job gaining tolerance means branch protection now passes on its
skip."* Eleven jobs just gained exactly that tolerance, and the oracle reported no change.

**Why, measured 2026-09-13 at plan 01's HEAD.** `extractResultLoopBlock()` slices the script
from the `for r in \` line to `done`. This plan hoists `docs_only='${{ … }}'` and `ALWAYS_ON="…"`
ABOVE the `for` loop — the placement RESEARCH Pattern 4 specifies and which is required for
correctness. So the extracted block REFERENCES `$docs_only` and `$ALWAYS_ON` but never DEFINES
them; under bash they are empty strings, the uniform arm is dead, and the oracle measures the
pre-change posture. Executed evidence:

```
guard expressions the MW02 oracle sees: [
 "github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository",
 "github.event_name == 'workflow_dispatch'",
 "github.event_name == 'pull_request'"
]
combos: 8
block mentions docs_only? true
block mentions ALWAYS_ON? true
block defines them?     false false
```

and the oracle's own diagnostic line, printed green on this tree:

```
MW02 executed posture: 13 job(s) × 8 guard combination(s); tolerated skips:
frontend-typecheck=0, frontend-lint=0, frontend-test=0, frontend-coverage=0,
frontend-seam-redis=0, frontend-local-stack=0, frontend-policy=0, frontend-build=0,
e2e-seeded=4, sql-tests=6, sql-gate-lint=0, sql-mutation=0, plan-anchor-verify=4
```

`sql-gate-lint=0` is false at HEAD: under `docs_only=true` its skip IS tolerated.

**Why NOT fixed in plan 01.** `lint-sql-gates.test.ts` is not in this plan's `files_modified`,
and the fix is not a one-liner — it is a semantic decision about an existing VAC-03 oracle:

- widening `extractResultLoopBlock` to start at `fail=0` makes `resultLoopGuardExpressions`
  pick up `docs_only`, taking combinations from 2³ to 2⁴ and turning all eleven filterable
  jobs into "tolerance-bearing", which the exact-set assertion will then reject unless
  `TOLERANCE_BEARING_JOBS` is redefined; and
- the sibling assertion *"every tolerated skip is CONDITIONED on the event"* does not fit
  `docs_only`, which is a diff classification, not an event. It needs a decision, not an edit.

That is Rule 4 territory (structural change to an existing gate's semantics), so it is
surfaced rather than improvised.

**Why it is BLOCKING for wave 2.** Plan 02 adds the `if:` to fifteen more job keys. Every one
of them widens this blind spot, and the blindness is in the very oracle whose job is to notice
a job gaining skip-tolerance. Fix the oracle BEFORE the filter is widened, not after.

**Owner:** ✅ **CLOSED 2026-09-13 by Phase 164.6.3 plan 05 (wave 2)**, which was inserted for
exactly this and runs BEFORE wave 3 widens the filter. The semantic decision the entry asked for
was taken as a THREE-SET PARTITION, not a widened flat set: `EVENT_TOLERANT_JOBS` (3) is what the
EVENT excuses, `DOCS_ONLY_TOLERANT_JOBS` (11) is what the path filter excuses, `NEVER_TOLERANT_JOBS`
(1) is excused by nothing, and the union is pinned against the loop's own row list. ⛔ The
exact-set assertion was NOT deleted or weakened — it was RESTATED as two exact-set claims over the
two halves plus a completeness claim. The `docs_only` half's `sql-gate-lint` now reads 8, not the
0 quoted above.

Measured at the repair: the not-docs-only half reproduces the pre-phase posture byte for byte
(`e2e-seeded=4, sql-tests=6, plan-anchor-verify=4`, every other row 0), which is this phase's
criterion 2 as a measurement rather than a comment. The root cause is closed a layer deeper than
the instance: the spawned shell now treats an unset variable as an error, so the NEXT hoisting of
a variable out of the extracted slice aborts with that variable's name instead of expanding to the
empty string. A standing REPAIR PROOF arm re-runs on every invocation and shows the repaired
oracle failing on a mutation the pre-repair machinery passed.

---

## 2. `[WINDOWS-LEDGER-COUNT-DRIFT]` — the defect register refuses every append

**What.** `gsd-tools windows append` fails closed on `.planning/WINDOWS.md`:

```
Error: Ledger counts disagree with entries: frontmatter open/waived/fixed/total=36/0/11/47
but entries yield 40/0/10/50.
```

**Consequence.** Item 1 above could not be booked into the cross-phase register. Since the
register is what blocks `/gsd-ship` while defects are open, and the drift predates this phase
(WINDOWS.md last moved in `604d655f`, Phase 164.8.5, and is untouched by this branch), EVERY
phase since that drift has been silently unable to book a broken window. A ledger that refuses
writes is a ledger that reads as empty.

**Why NOT fixed here.** Hand-editing the frontmatter counts to match would be exactly the
silent-absorption this repo books defects for, and `.planning/WINDOWS.md` is outside this
plan's `files_modified`. The counts must be RE-DERIVED from the entries, and whichever of the
two numbers is wrong must be established rather than assumed.

**Owner: Phase 164.6 GATE-HYGIENE.**

**Why that phase and not another.** It is UPCOMING and still unplanned (`**Plans:** 0 plans`,
`- [ ] TBD (run /gsd-plan-phase 164.6 to break down)`), so this can be entered as an item before
breakdown rather than amended into an authored plan set. Its declared subject is gate hygiene and
planning-tooling integrity, and it ALREADY owns two items of the SAME SHAPE — a planning ledger
whose stored counts disagree with the artifacts they claim to count:

- criterion 11, `[PROGRESS-COUNT-UNDERIVED]` — the `progress:` block and the ROADMAP progress
  table were both wrong in the same direction because their figures were hand-set or derived from
  local disk, and the correction shipped "as prose with a stated method and no mechanism";
- criterion 13, `[PHASEDIR-ORPHAN-GITKEEP]` — an artifact-counting reader returning a clean
  answer about a phase it could not actually see.

This is the third instance of that class and belongs beside them, where one deliverable can serve
all three. ⛔ It is NOT routed to Phase 164.9 TESTISOLATION (that phase's subject is shared-TEST
isolation, unrelated) and NOT to this phase (`.planning/WINDOWS.md` is outside every plan's
`files_modified` here, and wave 2's scope fence forbids writing it).

**What must happen there, stated so it cannot be closed the wrong way.** The frontmatter counts
are **RE-DERIVED FROM THE ENTRIES**, and whichever of the two numbers is wrong is **ESTABLISHED,
not assumed**. ⛔ Hand-editing the header to match the entries would be the silent absorption the
register exists to prevent — the counts are the anti-accumulation mechanism, and a header edited
to agree with whatever is currently there has no power over anything. Ship it with a check that
fails when the two disagree, so a future drift is a red check rather than a refused append nobody
reads.

⚠️ **This file is therefore LOAD-BEARING, not a scratch list.** Item 1 above could not be booked
into the cross-phase register while the drift stands, so its record exists HERE and nowhere else
until Phase 164.6 lands — and the same is true of every broken window any phase has tried to book
since the drift began (`604d655f`, Phase 164.8.5). A ledger that refuses writes reads as empty.

⚠️ **Entering it in the ROADMAP is a SEPARATE action this plan may not take.** The founder rule is
that a deferral is entered via `/gsd-phase --edit`, never hand-edited into `ROADMAP.md`, and
`ROADMAP.md` is not in this plan's `files_modified`. Run `/gsd-phase --edit 164.6` to add this
item to that phase's requirements list. Naming the destination here is what stops it being blank;
it is not a substitute for making the entry.

---

## 3. Vercel-plugin `deployments-cicd` hook recommendation — REFUSED, not deferred

The editor hook recommended, on every `ci.yml` write, that "manual cron scheduling" be
replaced with Vercel Cron Jobs (`vercel.json crons`). Refused:

- it targets pre-existing `schedule:` content this plan never touched (Rule 3, surgical);
- this phase's boundary forbids changing WHICH gates exist or when they are scheduled beyond
  the docs-only predicate (CONTEXT.md `<domain>`); and
- the repo's scheduled workflows deliberately run on GitHub Actions runners with repository
  credentials and a shared-TEST mutex; Vercel Cron is not a substitute for that.

Recorded so a later reader does not re-litigate it as an unhandled suggestion.

---

## 4. `gdpr-export-coverage-hook.test.ts` cannot run in a GSD worktree — ENVIRONMENT, not a defect

Recorded during plan 02 (wave 3) execution, 2026-09-13.

**What.** Running the 20 `ci.yml`-reading test files from inside the isolated worktree gives
`Test Files 1 failed | 24 passed (25)`. The single failure is
`src/__tests__/gdpr-export-coverage-hook.test.ts`, and it is a COLLECTION error, not an
assertion:

```
MEASURE_FAIL: the repo's pinned tsx is absent at
  <worktree>/node_modules/.bin/tsx — run `npm ci`.
```

**Why it is NOT caused by this plan.** The throw is at module scope, in the file's own
`if (!existsSync(TSX_BIN))` guard, BEFORE a single byte of `ci.yml` is read. `node_modules/` in a
GSD worktree is empty (measured: 0 entries); Node's resolver walks UP to the main checkout's
`node_modules`, which is why `npx vitest`, `npm run lint` and `npx tsc` all work — but that file
resolves `tsx` by ABSOLUTE path under `process.cwd()`, deliberately (its own header forbids the
`npx` fallback, because `npx` would fetch a DIFFERENT tsx from the registry).

**Why NOT "fixed".** There is nothing in the repo to fix. The guard is correct and its message
names the correct remedy. The remedy is `npm ci` inside the worktree, which this plan's scope
fence does not cover and which would add a ~1 GB tree to a throwaway worktree. ⛔ It must NOT be
"fixed" by relaxing the guard to `npx tsx` — that is the named defect the guard exists to prevent.

**Consequence, stated rather than absorbed.** That one file's assertions were NOT executed by this
plan. They do not read the docs-only filter: its subject is `scripts/check-gdpr-export-coverage.ts`
and the GDPR export manifest, neither of which this plan touches. It runs unmodified in CI, where
`npm ci` has run.

**Owner: none needed — no repo change is owed.** Booked here so a future reader of this phase's
verification does not see `24 passed (25)` and conclude a gate was lost.

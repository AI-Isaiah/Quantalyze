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

**Owner:** needs a founder decision on the oracle's semantics, then a named phase. Natural
candidates: fold into plan 02 (it already owns the exact-set pinning) or Phase 164.6
GATE-HYGIENE. ⛔ Do NOT close it by deleting or weakening the exact-set assertion.

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

**Owner:** needs a named phase. Not this one.

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

---
phase: 151-aum-a-book-you-can-reach-and-a-size-you-can-set
reviewed: 2026-08-08T00:00:00Z
depth: deep
source: /code-review high (workflow wf_1f486ee5-1ba, 32 agents, 0 errors)
findings:
  critical: 0
  warning: 5
  info: 0
  total: 5
status: issues_found
---

# Phase 151/152 — Review Round 2 residual: test reconciliation

## Context

A `/code-review high` run produced 10 CONFIRMED user-facing / data-integrity
findings across phases 151, 152 and the post-UAT fixer commits. **All 10
production fixes are already applied and committed to the working tree** by the
orchestrator. `tsc --noEmit` is clean, `eslint` is clean on the changed files,
`mypy --strict --follow-imports=silent services/ routers/ models/` is clean, and
the full `pytest` suite is green (4947 passed / 96 skipped).

`npx vitest run --no-file-parallelism` has **5 remaining failures**. Four are
pins that encode the OLD behaviour the fixes deliberately changed; one is a real
invariant the orchestrator's own fix violated. This document is the fix scope.

## The production changes already applied (do not re-do these)

1. `analytics-service/services/allocator_positions.py` — a non-positive MT5
   equity now emits a **floored $0 row** plus `MT5_NON_POSITIVE_EQUITY_NOTE`
   instead of no row (silence let the stale positive row survive as the latest
   asof forever under a `complete` sync). Its pytest was rewritten and passes.
2. `src/components/portfolio/AddToPortfolio.tsx` — the 23514 branch now splits
   the trigger's two arms: `team_review` (fires for ANYONE) gets non-owner-voiced
   copy; the owner-scoped unmarked arm keeps "mark it in My Strategies first".
3. `src/components/portfolio/MigrationWizard.tsx` — same two-arm branch, so the
   raw Postgres `RAISE` text (with an internal strategy UUID) is no longer
   rendered verbatim as user copy.
4. `src/lib/queries.ts` — the role discriminator now filters `own_capital`
   strategies OUT of the manager-side set before `deriveStrategyLinkedKeyIds`
   (answering "my own capital" in the wizard was evicting the key from the
   allocator's own book). The helper itself is UNCHANGED because
   `deriveStrategylessKeys` shares it for a different question (coverage).
5. `src/lib/queries.ts` — `liveBaselineMetrics` is now gated on
   `bookEntryGateSatisfied` and sourced from `contributingApiKeyIds`, so the
   composer's baseline and `ScenarioComparePanel`'s live-book column describe the
   same book. The dead `eligiblePerKeyReturns` / `eligibleKeyIdSet` bindings were
   removed and the RT1 comment updated to say the filter is subsumed.
6. `ScenarioComposer.tsx` `memberKeyIdsForUpdate` — an Update now persists the
   UNION of (still-eligible persisted members) and the contributing stamp, so a
   transiently-empty key is not silently and permanently dropped, while a
   revoked key still leaves and a blank-authored draft still saves `[]`.
7. `ScenarioComposer.tsx` `bottomUpAumFor` — validates with `isValidDollar`, not
   bare `Number.isFinite`, so a bottom-up sum can no longer persist an
   out-of-range `manualAumUsd` that the read-side sanitizer then discards.
8. `ScenarioComposer.tsx` `renderDollarInput` — the `scenarioAum <= 0` em-dash
   branch is now `(scenarioAum <= 0 && !bottomUpAum)`, making the per-strategy
   USD input reachable from a fresh BLANK scenario (it previously was not, so the
   founder's bottom-up UAT gesture was unperformable).
9. `ScenarioComposer.tsx` `commitAumInput` — the rounded-value no-op guard was
   replaced by `if (!aumTouchedRef.current)`, and the ref is cleared after a
   successful commit.
10. `ScenarioComposer.tsx` — both dollar-edit refusal arms now surface copy
    through a new `onRefuseEdit` prop wired to `setCommitError` (they were
    `console.warn`-only), and a no-op weight write is skipped so a SOLE
    constituent's bottom-up edit does not raise a spurious "A single constituent
    is always 100%." banner.

## Findings to fix

### W-R2-1 (WARNING) — the orchestrator's own fix broke a Phase 150 invariant

**Test:** `src/__tests__/phase-150-capital-ownership-invariant.test.ts`
→ `OWN-03 — one predicate, one census > P1 — the mark literal is spelled in
EXACTLY ONE production file`
**Failure:** `expected [ Array(2) ] to deeply equal [ 'src/lib/capital-ownership.ts' ]`

`AddToPortfolio.tsx` and `MigrationWizard.tsx` now contain the bare string
`"capital_ownership=team_review"`, and `queries.ts` contains a bare
`"own_capital"` comparison. `src/lib/capital-ownership.ts` already exports
`OWN_CAPITAL`, `TEAM_REVIEW` and `isAllocatable()`, and the phase gate pins the
literal to that file (threat T-150-07, drift prevention).

**This pin is CORRECT and must not be weakened.** Fix the production code, not
the test: import the constants and build the needle by interpolation
(`` `capital_ownership=${TEAM_REVIEW}` ``), and express the queries.ts filter
through the shared module (`isAllocatable(s.capital_ownership)` reads best —
note the filter wants to EXCLUDE allocatable rows from the manager-side set, so
it is `.filter((s) => !isAllocatable(s.capital_ownership))`; confirm the
`CapitalOwnership | null` typing lines up and cast at the read boundary if the
row type is `string | null`).

Re-run the phase-150 census test afterwards; it greps production files, so
confirm the interpolated form actually satisfies it rather than assuming.

### W-R2-2 (WARNING) — stale pin: the D3 mixed-population fallback

**Test:** `src/lib/queries.my-allocation.test.ts`
→ `Phase 36 per-key repoint (D1/D2/D3) > mixed-population HONESTY guard (D3):
one key with dailies + one active key WITHOUT → takes the FALLBACK (never a
half-per-key/half-snapshot curve)`
**Failure:** `expected { aum: 50000, ytdTwr: 0.19824, … } to deeply equal
{ aum: 50000, ytdTwr: null, … }`

This is the intended consequence of production change (5). The D3 honesty rule
was written when book entry and the baseline shared one all-or-nothing gate: a
partial population got a null baseline because it could not enter book mode at
all, so "no curve" was the honest answer. Phase 151 admits that population to
book mode, and `ScenarioComparePanel` already computes a real live-book curve
for it from `contributingApiKeyIds` — so a null baseline is now the DIShonest
answer, and the one that leaves two surfaces on one screen contradicting each
other.

Rewrite the test to encode the CURRENT intent, and be explicit in its docstring
about what replaced D3's original guarantee: the curve is no longer
"half-per-key/half-snapshot" because the snapshot half is gone — the baseline is
built from the contributing subset only, and keys with no series contribute
nothing rather than a fabricated ρ=1.0 collapse. **Keep a test that would fail if
someone re-mixed a snapshot reconstruction into the per-key curve** — that is the
part of D3 still worth defending. Do not simply flip the expected value.

### W-R2-3 (WARNING) — stale pin: the 151 consumer freeze

**Test:** `src/lib/queries.my-allocation.test.ts`
→ `Phase 151 book-entry gate split (AUM-04) > consumer freeze: with the new gate
TRUE, liveBaselineMetrics is STILL the honest emptyDefault (old gate untouched)`
**Failure:** `expected { aum: 50000, ytdTwr: 0.03007, … } to deeply equal
{ aum: 50000, ytdTwr: null, … }`

This pin asserts exactly the defect finding [6] reported: it froze the baseline
on the old gate ON PURPOSE, to prove 151 had not disturbed it. The freeze was
the bug — it left the partial-book allocator in book mode with an all-null live
column while the compare panel showed real numbers.

Replace it with a test of the NEW contract: with `bookEntryGateSatisfied` true
and the all-or-nothing flag false, `liveBaselineMetrics` is a REAL curve built
from `contributingApiKeyIds` — and, critically, **the same key set
`ScenarioComparePanel`'s live-book column uses**, so assert the agreement rather
than a hard-coded number where you can. Keep an arm proving the baseline is
still the honest `emptyLiveBaselineMetrics` when `bookEntryGateSatisfied` is
FALSE (that half of the contract is unchanged and still worth pinning).

### W-R2-4 (WARNING) — investigate before touching: the WR-04 rounded-seed pin

**Test:** `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx`
→ `AUM-01 Portfolio AUM input > 151 UAT: a bare focus→blur on the ROUNDED seed
is still not an edit (WR-04 holds under rounding)` (~line 11776)
**Failure:** `expected 39963.1076231 to be undefined`

⚠️ **Do not assume this is a stale pin — it may be a real defect in production
change (9).** WR-04's invariant ("a blur is not an edit") is STILL correct and
must still hold; only the mechanism changed, from a rounded-value comparison to
`aumTouchedRef`. The assertion is that `manualAumUsd` stays `undefined` after a
bare focus→blur, and it is now the exact float `39963.1076231` — which is the
LIVE HOLDINGS SUM, not the rounded text `39963` the field displays. So the write
did not come through `commitAumInput`'s `Number(raw)` path at all.

Diagnose first. Read the test body and find out (a) whether the harness's
focus/blur simulation fires an `onChange` that sets `aumTouchedRef`, and (b)
where a write of the unrounded `liveHoldingsSum` can originate. If the ref is
being set spuriously, the production fix needs tightening — for example
comparing the committed raw text against the text present at focus, or only
arming the ref when the value actually changed — rather than the test being
relaxed. **If WR-04's guarantee cannot be restored, stop and report rather than
weakening the test**: this is the seam that silently converts a derived size
into a persisted manual override.

### W-R2-5 (WARNING) — stale pin, but preserve the BOOK-mode half

**Test:** `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx`
→ `AUM-01 per-strategy dollar input > AUM-01 Test 6 (AUM unset): the dollar cell
is a read-only em-dash carrying the remedy in text, not a $0 and not a NaN`
(~line 12531)
**Failure:** `expected [ <input …(9)></input> ] to have a length of +0 but got 1`

Production change (8) is the cause and is correct: in BOTTOM-UP (blank) mode a
zero AUM is the empty portfolio the allocator is about to fill, not a
non-derivable figure, so the input must render.

The em-dash contract is **still correct in BOOK mode** and must stay pinned
there — that is where the dollar figure genuinely cannot exist before custody
answers. Split this test into two arms:
  - BOOK mode + AUM unset → the read-only em-dash, with `AUM_UNSET_REMEDY`
    reachable in TEXT (the sr-only span), never a `$0` and never a `NaN`.
  - BLANK mode + AUM unset → a live `scenario-constituent-dollar` input, and
    typing an amount into it seeds the portfolio (assert the resulting
    `manualAumUsd` equals the typed amount — this is the founder's UAT-1 gesture
    and it currently has no test at all).

## Constraints for the fix pass

- **Do not weaken a pin to make it pass.** Every rewritten test must still fail
  if the behaviour it defends regresses. Prove it: for each test you rewrite,
  mutate the production source, observe RED, then restore the source **from a
  scratchpad copy** — never `git checkout -- <file>`, there are uncommitted
  edits in the tree.
- CI is Node 22 while local is Node 25. Use `vi.spyOn` + `restoreAllMocks`;
  never leak a `vi.stubGlobal`.
- Run vitest with `--no-file-parallelism` locally.
- Do not touch `.planning/` docs other than this file, and do not commit.
- Report back: which tests you rewrote, the mutation-falsifier evidence for
  each, and anything you could not close.

---

## Fix-pass outcome (2026-08-08)

All 5 findings closed. Vitest: 5 failed → **0 failed** (11260 passed / 287
skipped / 784 files). No pin was weakened; every rewritten test was falsified by
mutating production, observing RED, and restoring from a scratchpad copy.

| ID | Disposition | Change |
|----|-------------|--------|
| W-R2-1 | Fixed in PRODUCTION (test untouched) | `queries.ts` now imports `isAllocatable` and filters `!isAllocatable(s.capital_ownership)` with the row typed `CapitalOwnership \| null`; `AddToPortfolio.tsx` / `MigrationWizard.tsx` interpolate `` `capital_ownership=${TEAM_REVIEW}` ``. P1 census green. |
| W-R2-2 | Test rewritten (stale pin) | D3 now pins the CONTRIBUTING-subset curve + 5 arms; arm (4) shifts `allocatorEquitySnapshots` ×3 and requires the curve not to move — the surviving half of D3. |
| W-R2-3 | Test replaced (the freeze WAS the bug) | Two arms: gate TRUE → real curve derived from the payload's own `contributingApiKeyIds` (the same set `buildLiveBookDraft` uses), with a discriminating negative vs the role-blind `eligibleApiKeyIds` blend; gate FALSE → `emptyLiveBaselineMetrics` (unchanged half). |
| W-R2-4 | DIAGNOSED — not a spurious ref, and not a defect | The failing line was the `(a2)` value-equality corollary, NOT the bare focus→blur. WR-04's actual guarantee holds unchanged. `(a2)` was retired (it contradicts Review [9] by construction) and replaced by arm `(c)`: a holdings-refresh RE-SEED followed by a bare blur is still not an edit. Added the Review [9] contract test (typing the rounded seed IS a deliberate override). |
| W-R2-5 | Test split into two arms | BOOK mode + AUM unset → em-dash (new `bookNoValuePayload`: holdings rows present, values 0); BLANK mode + AUM unset → live input, and typing $500k seeds the portfolio (founder UAT-1, previously untested). |

**Mutation falsifiers** (all restored from scratchpad, never `git checkout --`):
M1 drop `aumTouchedRef` guard → WR-04 arm (a) RED · M1b arm the ref on re-seed
only → arm (c) RED in isolation, arm (a) green · M2 restore the rounded-value
guard → Review [9] RED, WR-04 green (invariant, not mechanism) · M3 collapse the
em-dash branch to mode-blind → Test 6 arm 2 RED · M4 `scenarioAum < 0` → arm 1
RED · M5 re-freeze the baseline on `perKeyDailiesGateSatisfied` → D3 + AUM-04 [6]
RED · M6 role-blind baseline source → AUM-04 [6] + 3 RT1 pins RED · M7 stitch a
snapshot tail onto the per-key curve → D3 RED (and RED at arm (4) alone when
arm (2) is neutered).

**Gates:** tsc clean · eslint clean on 6 changed files · mypy 90 files clean ·
pytest 4947 passed / 96 skipped · vitest 11260 passed / 287 skipped / 0 failed.

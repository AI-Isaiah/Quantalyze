---
phase: 148-own-owner-factsheet-without-cache-disclosure
plan: 05
subsystem: ui
tags: [nextjs, next-link, wizard, a11y, wcag-1.4.1, vitest, jsdom, react-testing-library]

# Dependency graph
requires:
  - phase: 148-03
    provides: "the owner lane on /factsheet/[id]/v2 — the reason this link cannot dead-end on notFound() for the founder who just created the strategy"
  - phase: 148-04
    provides: "the structural cache-isolation gate that keeps the linked-to lane uncached"
provides:
  - "ViewFullFactsheetLink — ONE local component in SyncPreviewStep.tsx rendered at BOTH terminal-success sites (composite + single-key), so the copy and the rel/target pair cannot drift"
  - "SyncPreviewStep.own04-link.test.tsx — the SC3 proofs: 5 presence pins + 3 structural-absence pins, all oracles literal in-file"
  - "TODOS DEF-148-B — the two divergent in-wizard link-style precedents, logged with a fix shape and a scope caveat, deliberately not fixed"
  - "148-VALIDATION.md closed: 6/6 falsifiability rows Observed, 12/12 task rows green, Approval stamped"
affects: [149-nav-ranking, wizard, factsheet-v2]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One extracted local link component rendered at N branch sites — the anti-drift control when the same affordance must appear in two render arms"
    - "Structural absence as the specification: pre-success states assert no testid AND no link/button role AND no caption text, which fails a disabled/greyed variant rather than accepting it"
    - "Per-site falsifiability: mutate ONE of two call sites and require the OTHER site's tests to stay green — proves the coverage is per-site, not one shared assertion"

key-files:
  created:
    - "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.own04-link.test.tsx"
    - ".planning/phases/148-own-owner-factsheet-without-cache-disclosure/148-05-SUMMARY.md"
  modified:
    - "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx"
    - "TODOS.md"
    - ".planning/phases/148-own-owner-factsheet-without-cache-disclosure/148-VALIDATION.md"

key-decisions:
  - "Wave order is the security control, not a convention: OWN-04 ships strictly after OWN-02, so no link this phase adds can land on notFound(). Stated in the component's doc-comment so the next reader cannot reorder them by accident"
  - "UI-SPEC wins both Rule-7 style conflicts (persistent underline over WizardChrome's hover-only; full noopener noreferrer over ConnectKeyStep's bare noopener) — the divergent precedents are LOGGED to TODOS.md, not fixed, per the founder blast-radius bar"
  - "The link is a SIBLING inside the FactsheetPreview wrapper div, above the CTA row — a text link, never a second Button, so it cannot compete with the step's primary action"
  - "Structural absence rather than a disabled variant: the three pre-success assertions query link role, button role AND caption text, so a greyed-out placeholder fails them"
  - "SC-3 mutates the COMPOSITE site (the one an author forgets), not the single-key site — second-member preference"

patterns-established:
  - "A THIRD sibling test file, leaving the two existing render test files byte-frozen — the convention the composite sibling's own header prescribes"
  - "Bare file:line citations are banned on the ratified seam surface; symbol-anchored references (name the link, not its address) survive line drift"

requirements-completed: [OWN-04]

# Metrics
duration: 25min
completed: 2026-08-05
---

# Phase 148 Plan 05: OWN-04 wizard → factsheet link Summary

**The founder's post-sync question "where is my strategy?" now has an answer inside the wizard: one extracted `ViewFullFactsheetLink` renders at BOTH terminal-success branches, opens `/factsheet/{strategyId}/v2` in a new tab with `rel="noopener noreferrer"` and a persistent underline, is structurally absent (never disabled) before success — and because OWN-02's owner lane landed two waves earlier, it cannot dead-end on a 404.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-05T12:09:00Z
- **Completed:** 2026-08-05T12:34:00Z
- **Tasks:** 3 (4 commits — one auto-fix)
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- **SC3 shipped at both sites from ONE definition.** `grep -c` on the component file:
  `wizard-view-full-factsheet` **1**, `factsheet/${strategyId}/v2` **1**,
  `ViewFullFactsheetLink` **3** (definition + two usages). There is no second copy of the
  markup that could drift, which is the whole reason the plan mandated extraction.
- **The link is falsifiable per-site, not in aggregate.** Deleting the composite usage reddens
  exactly the two composite tests and leaves all three single-key presence tests green. A shared
  "the link exists somewhere" assertion would have stayed green through that deletion and
  shipped a wizard where half the founders see no route to their factsheet.
- **No-disabled-states is asserted as absence, not as inertness.** The three pre-success tests
  query `queryByTestId`, `queryByRole("link")`, `queryByRole("button")` **and** the caption text.
  A greyed-out or `aria-disabled` placeholder — the shape the standing UAT direction forbids —
  fails all four, where a naive `not.toBeEnabled()` would have accepted it.
- **The phase gate caught a real defect in this plan's own comment.** `SyncPreviewStep.tsx` is on
  the ratified seam surface, where `seam-citations.invariant.test.ts` bans bare `file.ext:NN`
  citations. My first draft cited `WizardChrome.tsx:255` / `ConnectKeyStep.tsx:661` — and both
  were *already wrong* (the real lines are 257 and 662), which is precisely the staleness the
  invariant exists to prevent. Converted to symbol-anchored references.
- **Phase 148 is fully gated.** 10,697 tests green under the blocking coverage command, all six
  falsifiability rows Observed with pasted failures, zero rows skipped, Approval stamped.

## Task Commits

1. **Task 1 (RED): `SyncPreviewStep.own04-link.test.tsx`** — `c1cb19f8` (test)
2. **Task 2 (GREEN): link at both sites + TODOS DEF-148-B** — `1679f761` (feat)
3. **Auto-fix: symbol-anchor the doc-comment citations** — `18d35476` (fix)
4. **Task 3: SC-3 mutation + VALIDATION closure** — `fc4f0411` (docs)

### RED evidence (Task 1, before the link existed)

```
Tests  5 failed | 3 passed (8)

FAIL > single-key passed: renders an anchor to /factsheet/{strategyId}/v2 in a new tab
TestingLibraryElementError: Unable to find an element by: [data-testid="wizard-view-full-factsheet"]

FAIL > composite passed: renders the SAME element with the same copy and its own strategyId
TestingLibraryElementError: Unable to find an element by: [data-testid="wizard-view-full-factsheet"]
```

RED profile: **all five** presence pins red; the three structural-absence pins green **by
design** — nothing rendered a link pre-success then, and nothing may render one now. That
asymmetry is deliberate: only the presence half can distinguish the two states, so only it is
allowed to move. Recorded in the test file's header, which is where the repo convention puts it.

## Files Created/Modified

- `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` — added the
  `ViewFullFactsheetLink` component (module-level, beside the other local helpers) and its two
  usages: inside the composite branch's `FactsheetPreview` wrapper and inside the single-key
  branch's wrapper, ABOVE the CTA row. The doc-comment states the three things a future editor
  must not undo: the wave ordering that keeps the link off `notFound()`, the absence of a
  disabled variant, and which of the two conflicting in-wizard link styles won.
- `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.own04-link.test.tsx` (new,
  573 lines, 8 tests). Third sibling; both existing render test files verified byte-frozen.
- `TODOS.md` — `DEF-148-B`, the two divergent link precedents with exact coordinates, a fix
  shape, and a scope caveat (DESIGN.md's persistent-underline rule is body-prose-only, so a
  blanket `hover:underline` purge would be wrong).
- `.planning/.../148-VALIDATION.md` — SC-3 row, the eight remaining Per-Task Map statuses, three
  Wave 0 checkboxes, the Oracle Independence re-confirmation, the phase-final gate table, the
  SC-4 satisfied-by-absence note, and the Approval stamp.

## Decisions Made

See `key-decisions` in the frontmatter. The three load-bearing ones:

- **Extraction over duplication.** The two insertion sites are ~280 lines apart in a 2,270-line
  component. Pasting the markup twice would satisfy every test in this file on day one and then
  drift the moment someone edits one site — which is exactly the class UI-SPEC:118 names. One
  component makes the drift impossible rather than merely detectable.
- **UI-SPEC wins both style conflicts, and the losers get logged rather than fixed.** The wizard
  already contains two `target="_blank"` links that disagree with the approved treatment. Rule 7
  says pick one and explain; the founder's blast-radius bar says don't fix adjacent cosmetics
  mid-task. Both divergences are in TODOS.md with the reasoning, so the cleanup sweep has
  everything it needs and this diff stays surgical.
- **The pre-success tests assert absence four ways.** "Not enabled" and "not present" are
  different claims, and only the second one matches the standing UAT direction. Writing the
  assertion as absence means a well-meaning future "just grey it out while computing" change
  fails CI instead of passing it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Bare `file:line` citations in the new doc-comment violated SEAMPROSE-01**

- **Found during:** Task 3, first `npm run test:coverage` run
- **Issue:** `src/lib/seam-citations.invariant.test.ts` failed:
  `SyncPreviewStep.tsx:424 cites 'WizardChrome.tsx:255'; SyncPreviewStep.tsx:425 cites
  'ConnectKeyStep.tsx:661'`. `SyncPreviewStep.tsx` is on the ratified seam roster, where bare
  coordinates are banned because they go stale the instant the cited file shifts a line. Both
  cited numbers were **already stale** when written (actual: 257 and 662) — the invariant
  caught a live instance of the exact defect it was built for, not a style nit.
- **Fix:** Converted both to symbol-anchored references that name the link ("the *Review our
  security posture* footer link in `WizardChrome`", "the per-exchange *setup guide* link in
  `ConnectKeyStep`"). The TODOS.md table keeps exact, verified coordinates — that file is not on
  the scanned surface and the future sweep needs addresses.
- **Files modified:** `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx`
- **Commit:** `18d35476`

---

**2. [Rule 3 — verification-method correction] Task 3's Per-Task Map command said `npm test`**

- **Found during:** Task 3
- **Issue:** The VALIDATION Per-Task Map and Test Infrastructure table both named
  `npm test && npm run typecheck && npm run lint` as the full-suite command. Plain `npm test`
  runs vitest WITHOUT `--coverage`, so it cannot fail on the 82/80/74/72 thresholds — it proves
  nothing about the blocking gate. The plan body itself says so explicitly.
- **Fix:** Ran `npm run test:coverage` (what the plan body mandates) and corrected both places
  in 148-VALIDATION.md with a note stating why. No source impact.
- **Files modified:** `.planning/.../148-VALIDATION.md`
- **Commit:** `fc4f0411`

---

**Total deviations:** 2 (one real defect caught by a repo invariant; one doc-command correction)
**Impact on plan:** None on behaviour, placement, copy, or diff surface.

## Issues Encountered

- **Worktree base drift (same as 148-02 / 148-03).** The worktree spawned at `f713cf97`; the
  orchestrator-pinned base was `43333f9d`. The startup `<worktree_branch_check>` caught it and
  `git reset --hard` corrected it before any edit; the wave-1–3 sentinel file
  (`phase-148-owner-lane-cache-isolation.test.ts`) was confirmed present afterwards.
  `node_modules` was absent and was symlinked from the main checkout (no package manager run).
- No auth gates, no checkpoints, no architectural decisions, no package installs.

## Verification Evidence

| Gate | Command | Result |
|------|---------|--------|
| Task 1 (RED) | `npx vitest run "…/SyncPreviewStep.own04-link.test.tsx" --no-file-parallelism; test $? -ne 0` | 5 failed \| 3 passed — non-zero exit, RED confirmed |
| Task 2 (GREEN) + frozen siblings | `npx vitest run "…own04-link…" "…render.test.tsx" "…composite.render.test.tsx" --no-file-parallelism` | 3 files / **95 tests passed** |
| Frozen-file zero-diff | `git diff --stat -- "…render.test.tsx" "…composite.render.test.tsx"` | empty at BOTH the RED and GREEN commits |
| Targeted phase battery (GUARD-02, 147 guards, 148 cache isolation, owner lane, smoothed wiring, owner notice, own04 link) | `npx vitest run <7 files> --no-file-parallelism` | 7 files / **51 tests passed** |
| **Phase-final gate** | `npm run test:coverage` | 744 files passed, 19 skipped (763); **10697 passed**, 287 skipped (10984) |
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | **0 errors**, 1 pre-existing warning in the untouched `allocations/widgets/performance/EquityChart.tsx:1119` |
| Post-mutation source integrity | `git diff --quiet -- "…/SyncPreviewStep.tsx"` | exit 0 |

### Coverage (the blocking gate — thresholds lines 82 / statements 80 / functions 74 / branches 72)

| Metric | Measured | Threshold | Margin |
|--------|----------|-----------|--------|
| Lines | **87.85%** (22416/25514) | 82 | +5.85 |
| Statements | **85.73%** (24485/28558) | 80 | +5.73 |
| Functions | **82.61%** (4190/5072) | 74 | +8.61 |
| Branches | **80.07%** (17424/21759) | 72 | +8.07 |

All four clear. `npm run test:coverage` exited 0, so no threshold was breached.

### Source assertions (plan acceptance criteria)

| Assertion | Expected | Actual |
|-----------|----------|--------|
| `grep -c "wizard-view-full-factsheet"` | 1 (single definition) | **1** |
| `grep -c "ViewFullFactsheetLink"` | ≥ 3 (definition + two usages) | **3** |
| `grep -c "factsheet/\${strategyId}/v2"` | 1 (href lives in one place) | **1** |
| TODOS.md names both divergent files:lines | yes | `WizardChrome.tsx:257`, `ConnectKeyStep.tsx:662` (both verified against source, not copied from the plan's stale figures) |

## Falsifiability (SC-3 — OBSERVED, not asserted)

| SC | Mutation | Observed |
|----|----------|----------|
| SC-3 | Delete the `ViewFullFactsheetLink` usage from the **composite** branch only | `Tests 2 failed \| 6 passed (8)` — **exactly** the two composite tests, zero collateral: `TestingLibraryElementError: Unable to find an element by: [data-testid="wizard-view-full-factsheet"]`. All three single-key presence tests and all three absence tests stayed green. |

The green half is the evidence that matters: it proves the two sites are covered
**independently**, so a future edit that drops one of them cannot hide behind the other. Reverted
by re-editing the deleted line (never `git checkout --`); `git diff --quiet` on
`SyncPreviewStep.tsx` exits 0.

## Threat Model Coverage

| Threat ID | Disposition | How this plan discharges it |
|-----------|-------------|-----------------------------|
| T-148-06 (wizard link exposing a draft URL to a non-owner session) | **mitigated by construction, and asserted** | The link renders ONLY in `SyncPreviewStep`'s success branches, which exist only inside the uploading account's authed wizard session; `strategyId` is the owner's own draft prop. The three structural-absence tests pin that no other state renders it. The URL is not a secret: a non-owner opening it hits 148-03's uniform `notFound()` (no existence oracle), proven by that plan's tests 7/8. |
| T-148-06b (reverse tabnabbing via `target="_blank"`) | **mitigated** | `rel="noopener noreferrer"` asserted as a literal in the test, at BOTH sites. Note the in-wizard precedent uses bare `noopener` — following it would have left the referrer leak open; UI-SPEC won and the precedent was logged instead. |
| T-148-01 (link driving an owner render that populates the shared cache) | **closed upstream, enforced by wave order** | The link lands on the owner lane, which 148-03 proved invokes `unstable_cache` **0** times and 148-04 pinned structurally. Because OWN-04 is wave 4, a dead-end or cache-touching link was unshippable in this phase by construction. |
| T-148-SC (package installs) | **vacuous** | Zero packages installed; `node_modules` symlinked from the main checkout. |

## Threat Flags

None. No new endpoint, no schema change, no file access, no auth path, and no writes of any kind
— the diff is one client-side render component plus tests and docs. The one new outbound
navigation target is an in-repo route already in `PUBLIC_ROUTES`, opened with the full
`noopener noreferrer` pair.

## Known Stubs

None. No placeholders, no TODO/FIXME added to source, no unwired data. `DEF-148-B` in TODOS.md is
a logged pre-existing divergence in files this plan did not touch, not a stub in shipped code.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Phase 148 is complete and fully gated.** All four ROADMAP success criteria hold with observed
falsifiability evidence; the VALIDATION ledger has zero pending or skipped rows.

Notes for Phase 149 (NAV-01 ranking):

- The UI-SPEC decided **DO NOT repeat** this link on the finalize step — the post-finalize "where
  is my strategy" surface is 149's, and duplicating it now would pre-empt that phase. If 149 wants
  a factsheet route from the ranking, it should reuse `/factsheet/{id}/v2` (the same route), not
  mint a second preview surface.
- `ViewFullFactsheetLink` is local to `SyncPreviewStep.tsx` on purpose (one file, two sites). If a
  third surface genuinely needs it, promote it to a shared component **then** — not speculatively.
- `DEF-148-B` (TODOS.md) is the open cleanup: two in-wizard links still diverge from the approved
  treatment. It is cosmetic/a11y-hygiene, below the founder blast-radius bar, and explicitly not
  a 148 deliverable.

**No blockers.** `STATE.md` and `ROADMAP.md` were not touched (orchestrator territory).

## Self-Check: PASSED

- `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.own04-link.test.tsx` — FOUND (573 lines)
- `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` — FOUND (modified)
- `TODOS.md` — FOUND (modified, DEF-148-B present)
- `.planning/phases/148-own-owner-factsheet-without-cache-disclosure/148-VALIDATION.md` — FOUND (modified, 176 lines, Approval stamped)
- Commit `c1cb19f8` — FOUND in `git log`
- Commit `1679f761` — FOUND in `git log`
- Commit `18d35476` — FOUND in `git log`
- Commit `fc4f0411` — FOUND in `git log`
- Zero file deletions across all four commits
- No untracked files left behind apart from this SUMMARY pre-commit

---
*Phase: 148-own-owner-factsheet-without-cache-disclosure*
*Completed: 2026-08-05*

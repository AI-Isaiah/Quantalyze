---
phase: 150-own-03-the-wizard-asks-whose-capital-this-is
plan: 03
subsystem: wizard
tags: [react, nextjs, vitest, testing-library, supabase, forms, a11y]

# Dependency graph
requires:
  - phase: 150-own-03 plan 01
    provides: strategies.capital_ownership column (nullable, no default) + CHECK constraint
  - phase: 150-own-03 plan 02
    provides: CapitalOwnership type, TEAM_REVIEW/OWN_CAPITAL constants, CapitalOwnershipRadioGroup
provides:
  - "MetadataStep asks the capital question FIRST on the allocator key-add path, defaulted to team_review"
  - "MetadataStep's seven profile controls collapsed behind a bare native <details>; render-only, payload byte-compatible"
  - "The asset-class select hoisted OUT of the disclosure whenever it is editable (money-math guard)"
  - "MetadataDraft.capitalOwnership + MetadataStepProps.showCapitalQuestion — the wizard-side contract"
  - "finalize-wizard accepts optional capital_ownership and persists it via a separate owner-scoped UPDATE after the RPC"
affects: [150-04 migration, 150-06 Mark dialog, 150-07 Holdings rows, 150-08 phase gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Render condition, not authz: showCapitalQuestion derives from entryContext and grants nothing"
    - "Absent-not-defaulted wire field: the mark is spread into the body only when the question was asked, so an unasked path sends no key at all"
    - "Post-RPC side write: strategy-level metadata persisted by a separate owner-scoped UPDATE rather than widening a SECURITY DEFINER signature"
    - "Safe degradation over atomicity: a lost mark logs loudly and leaves NULL (non-allocatable) rather than failing the finalize"
    - "Literal-oracle payload pinning: the pre-change onComplete payload typed into the test as a literal, proving a cull is render-only"

key-files:
  created: []
  modified:
    - src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.test.tsx
    - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx
    - src/app/api/strategies/finalize-wizard/route.ts
    - src/app/api/strategies/finalize-wizard/route.test.ts

key-decisions:
  - "The mark rides the existing MetadataDraft into SubmitStep rather than getting its own WizardClient state thread — the draft already flows there, and a parallel thread could desync from the answer it came from"
  - "The CSV branch's MetadataStep mount is deliberately NOT given showCapitalQuestion: csv-finalize has no mark write this plan, and asking a question whose answer is discarded is worse than not asking"
  - "A mark arriving on the unified (manager) finalize arm warns loudly instead of being dropped silently — the drop is safe, the silence was not"
  - "The zero-row mark write gets its own log line, distinct from a transport error: matching no row means the owner predicate excluded it, which is a different and more alarming story"
  - "initial.capitalOwnership wins over the team_review default, unlike assetClass where detection must beat the resumed value — nothing out-ranks the user's own stated answer"

# Metrics
duration: 75min
completed: 2026-08-06
---

# Phase 150 Plan 03: The wizard asks whose capital this is Summary

**The question the product never asked now leads the categorization step, defaulted to the safe answer; the seven profile fields recede behind a collapsed disclosure without a single byte of payload change; and the answer lands as a strategy-level mark via a separate owner-scoped UPDATE that leaves the 13-arg finalize RPC untouched.**

## Performance

- **Duration:** ~75 min
- **Tasks:** 3 of 3
- **Files modified:** 6 (0 created, 6 modified)
- **Commits:** 6 (2 RED, 3 GREEN/feat, 1 fix)

## Accomplishments

- **The question leads, and it is asserted structurally.** The fieldset is the first interactive element in the form — proved by a DOM-order assertion over `form.querySelectorAll("button, input, select, textarea")`, not by reading the JSX. Ordering is the whole point of the founder's direction, and it is now the kind of thing that reddens when someone moves it.
- **The cull is provably render-only.** The pre-Phase-150 `onComplete` payload is typed into the test as a **literal oracle** and asserted with `toEqual`. If anyone "tidies" a collapsed field out of `MetadataDraft` or out of `handleSubmit`, that deep-equal fails. This is the D-08 consumer sweep discharged by construction rather than by inspection: downstream factsheet panels, browse pills and mandate-fit chips key on field ABSENCE to hide themselves, so a deleted field would silently change what those surfaces render, with no server change to point at.
- **The money-math trap is closed.** On the CSV / unknown-exchange path the asset-class select is live and defaults to `traditional` (√252). Collapsing it would have made √252-on-a-crypto-book the likely silent outcome, inflating Sharpe. It is hoisted out of the disclosure whenever `!assetClassLocked`, and both placement branches are pinned by tests.
- **The RPC signature is byte-untouched.** The mark is a separate owner-scoped `UPDATE` after `finalize_wizard_strategy` returns. A test asserts no RPC argument key contains `capital`, so a future "just add a 14th arg" cannot pass quietly. No migration, no schema file, and no `wizardErrors.ts` entry was touched.
- **Zero new wizard error codes.** The garbage-value 400 mirrors the `entry_context` arm exactly: a bare `error` string with **no** `code`. Asserted directly (`expect(body.code).toBeUndefined()`), because a code the wizard's roster does not carry renders the useless UNKNOWN card.
- **Both `.eq()` predicates on the mark write are pinned by test.** `strategies_update` RLS has no `WITH CHECK`, so the `user_id` filter is the actual boundary (T-150-10), not decoration. The test asserts the exact filter list, so dropping either one reddens.

## Task Commits

1. **Task 1 — MetadataStep: question first, cull to disclosure, asset-class hoist**
   - `3b07f821` (test — RED, 9 failing)
   - `0175cf97` (feat — GREEN)
2. **Task 2 — Thread the answer: WizardClient → MetadataStep → SubmitStep → finalize body**
   - `498e87df` (feat)
3. **Task 3 — finalize-wizard: validate + persist the mark after the RPC**
   - `95b5dcfa` (test — RED, 5 failing)
   - `0467924b` (feat — GREEN)
4. **Cross-task fix (Rule 1)**
   - `fcca6c30` (fix — Review round-trip mark loss)

## Files Modified

- `src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.tsx` — `showCapitalQuestion` prop, `capitalOwnership` state and draft field, revised role-neutral copy, the `<details>` disclosure, the two-branch asset-class placement.
- `src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.test.tsx` — 14 new cases (question ordering/default/absence, the literal-oracle payload proof, both disclosure branches, both hoist branches, copy, submit gate, round-trip restore).
- `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` — one prop on the existing API-branch mount, with the context-selector-not-privilege-flag reasoning recorded inline.
- `src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx` — the mark spread into the existing finalize body beside `entry_context`, present only when answered.
- `src/app/api/strategies/finalize-wizard/route.ts` — closed-set validation arm, `ValidatedPayload.capitalOwnership`, the post-RPC owner-scoped UPDATE with its two log arms, and the unified-arm warn.
- `src/app/api/strategies/finalize-wizard/route.test.ts` — 6 new cases plus a mock extension recording update `.eq()` filters and making an update chain `.select()`-able.

## Decisions Made

- **The mark rides `MetadataDraft`, not a parallel WizardClient thread.** The plan's action text said to carry it "exactly the way entry_context travels", i.e. as its own prop. But the metadata draft already flows into `SubmitStep` as `metadata={metadataDraft}`, so the mark was already there. A second thread would be one more thing to keep in sync with the answer it came from. Recorded as a deviation below.
- **The CSV branch does not ask.** There are two `MetadataStep` mounts. Only the API-branch one gets `showCapitalQuestion`, because `csv-finalize` has no mark write in this plan — setting the prop on the CSV mount would render a question whose answer is discarded at submit. CSV strategies land NULL (unmarked, non-allocatable) and are markable retroactively via Plan 06's dialog.
- **Loud on the unified arm.** Contribution always routes to `runLegacyFinalize`, so the mark always reaches its write in practice. A mark arriving at the unified (manager) arm therefore means a hand-crafted body or future routing drift. The drop is safe (NULL = non-allocatable), so it is not an error arm — but it now warns with the strategy id rather than vanishing.
- **`.select("id")` with a conservative zero-row check.** The zero-row arm fires only on a genuine empty array, never on a `null` data payload, so an environment that does not return rows cannot manufacture false alarms.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] An answered mark was silently discarded on a Review round-trip**
- **Found during:** Post-Task-3 review of the state initializer
- **Issue:** `WizardClient` stores the completed draft in `metadataDraft` and feeds it back as `initial` when the user returns from the Review recap (`Edit` / `Back`). The capital question's state was initialized to `TEAM_REVIEW` unconditionally, so an allocator who chose **own capital**, reviewed, then stepped back to fix a typo would submit as **team review** with no indication — a silently non-allocatable strategy. Every other field on the step already round-trips through `initial`.
- **Fix:** `useState<CapitalOwnership>(initial?.capitalOwnership ?? TEAM_REVIEW)`. Deliberately the opposite precedence from `assetClass`, where a detected exchange must beat the resumed value; nothing out-ranks the user's own stated answer.
- **Files modified:** `MetadataStep.tsx`, `MetadataStep.test.tsx`
- **Verification:** Regression test asserted failing before the fix, passing after.
- **Committed in:** `fcca6c30`

**2. [Rule 2 — Missing critical] A mark reaching the unified finalize arm was dropped in silence**
- **Found during:** Task 3, reading the arm split
- **Issue:** `finalize-wizard` has two finalize arms. `validatePayload` accepts `capital_ownership` on any body, but only `runLegacyFinalize` writes it. A body carrying a mark that routed to the unified arm would 200 with the mark silently gone.
- **Fix:** A `console.warn` naming the strategy id at the unified dispatch point. Not an error arm — the drop is genuinely safe — but no longer invisible (CLAUDE.md Rule 12, fail loud).
- **Files modified:** `src/app/api/strategies/finalize-wizard/route.ts`
- **Committed in:** `0467924b`

**3. [Rule 3 — Blocking] `node_modules` absent in the worktree**
- **Issue:** The worktree had no `node_modules`, so no test, typecheck or lint could run.
- **Fix:** Symlinked the main checkout's `node_modules`. **Zero packages installed** — `package.json` between the worktree base and main differs only by the version string, so the dependency trees are identical. No package manager was invoked, so the T-150-SC disposition holds.

### Plan-text deviations (no behaviour difference)

**4. The mark travels in `MetadataDraft` rather than as its own prop thread** — see Decisions Made. Same wire result; one fewer thing to desync.

**5. Acceptance criterion `grep -rn "p_capital_ownership" supabase/ src/ == 0` returns 13, and that is correct.** Every match is a substring of Wave 1's `fli`**`p_capital_ownership`**`_to_team_review` function name. The criterion's real intent — no `p_capital_ownership` **parameter** — verifies clean with a word-boundary grep (`grep -rnE "(^|[^a-z])p_capital_ownership"` → **0**), and `git diff` shows **zero** changes under `supabase/`.

**6. Two comments had to be reworded to avoid self-matching acceptance greps** — the same 140.2-08 / 150-02 lesson. The disclosure comment could not name `CollapsibleSection` while explaining why it is not used, and the `WizardClient` comment could not use the word "allocate" while explaining that no money shortcut was added. Both now say so explicitly, so the omission does not read as an oversight.

---

**Total deviations:** 3 auto-fixed (1 bug, 1 missing critical, 1 blocking) + 3 plan-text notes.
**Impact on scope:** None. Deviations 1 and 2 close silent-data-loss paths the plan's own invariants imply.

## Issues Encountered

- **jsdom does not hide closed `<details>` contents** (its default stylesheet omits the spec's internal shadow tree). Verified in `node_modules/jsdom/.../default-stylesheet.css` before writing the cull, because if it *had* hidden them, the pre-existing OKX-chip `getByRole` test and the asset-class `getByLabelText` tests would have broken on the move. They pass unedited.
- **One pre-existing lint warning** (`EquityChart.tsx:1119`, `react-hooks/exhaustive-deps`) — untouched by this plan, unrelated file, out of scope. `npm run lint` reports **0 errors**.

## Verification

| Gate | Result |
|------|--------|
| `MetadataStep.test.tsx` | **31 passed** |
| `finalize-wizard/route.test.ts` | **90 passed** |
| Plan verification set (+ collision gates `phase-84-asset-class-flow`, `visibility`) | 4 files, **131 passed** |
| `npx vitest run src/app/(dashboard)/strategies/new/wizard` | 28 files, **420 passed** (zero assertion edits to pre-existing specs) |
| `npx vitest run src/components/strategy src/lib/capital-ownership.test.ts` | 37 files, **388 passed** |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors (1 pre-existing warning); route-contract + admin-manifest OK |

**Acceptance criteria:**

- `grep -c "CollapsibleSection" MetadataStep.tsx` → **0**; `grep -c "storageKey\|useCrossTabStorage"` → **0**.
- `grep -n "showCapitalQuestion" WizardClient.tsx` → the contribution-derived prop, one line.
- `grep -ci "allocate" WizardClient.tsx` → **0**, unchanged from before this plan (no money shortcut, D-10).
- `git diff` under `supabase/` → **empty**; `wizardErrors.ts` → **untouched**; no new member in any known-codes list.
- Mark UPDATE appears after the RPC in source order and is guarded by field presence.
- Both `assetClassLocked` branches and both question-presence branches asserted.

## Known Stubs

None. Two deliberate NULL-mark paths are by design, not stubs: the **CSV branch** (does not ask, so does not send — Plan 06's dialog is the retro path) and the **manager entry** (D-07: the question is not theirs to answer). Both are the documented safe state — unmarked strategies are non-allocatable.

## Threat Flags

None beyond the plan's register. T-150-09 (garbage value) and T-150-10 (cross-owner write) are mitigated and test-pinned. T-150-11 (lost mark) is the accepted non-atomicity, now with two distinct log arms plus Sentry rather than the plan's single `console.error`. **T-150-SC holds: zero packages installed** — the missing `node_modules` was resolved by symlink, not by any package-manager invocation.

> ⚠️ Carried forward from 150-02, not introduced here: once the column lands in Plan 04, `strategies_read` RLS has no column projection, so `capital_ownership` is **publicly readable on published rows**. Plan 04 owns that decision.

## User Setup Required

None.

## Next Phase Readiness

- **Plan 04 (migration)** — nothing here depends on ordering; the route writes a column Wave 1 already created, and the write is presence-guarded.
- **Plan 06 (Mark dialog)** — mounts the same `CapitalOwnershipRadioGroup` with label `Whose capital is this?`, and owns the **CSV-path and manager-path retro marking** this plan deliberately leaves NULL.
- **Plan 08 (phase gate)** — `MetadataStep.tsx`, `WizardClient.tsx` and `SubmitStep.tsx` are clean for a "no money verb in the wizard" grep; both files' comments were written to avoid self-matching.
- ⚠️ `STATE.md` / `ROADMAP.md` deliberately **not** touched (worktree mode; the orchestrator owns those writes post-wave).

## Self-Check: PASSED

All 6 modified files carry their edits on disk; all 6 commits (`3b07f821`, `0175cf97`, `498e87df`, `95b5dcfa`, `0467924b`, `fcca6c30`) resolve in `git log`. Full verification set re-run green after the final fix.

---
*Phase: 150-own-03-the-wizard-asks-whose-capital-this-is*
*Completed: 2026-08-06*

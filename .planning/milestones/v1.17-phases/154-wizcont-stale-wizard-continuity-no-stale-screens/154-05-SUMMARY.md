---
phase: 154-wizcont-stale-wizard-continuity-no-stale-screens
plan: 05
subsystem: ui
tags: [nextjs, react, wizard, resume, overlay, hydration, e2e, playwright, mutation-testing]

# Dependency graph
requires:
  - phase: 154-02
    provides: "src/lib/wizard/draft-query.ts (readLatestWizardDraft / WizardDraftKind / draftMatchesSource) + GET /api/strategies/wizard-draft"
  - phase: 110
    provides: "ContributionWizardOverlay and its initialDraft={null} deferral — the defect site closed here"
provides:
  - "ContributionWizardOverlay reads the caller's own draft on open and DEFERS the WizardClient mount until the read settles"
  - "WizardClient consults the draft before the step is chosen, and resumes a CSV draft on csv_upload instead of sync_preview"
  - "deriveWizardResumeOverrides raises the resume banner for a draft with NO local pointer (the silent-resume fix)"
  - "e2e/wizard-resume.spec.ts + seedWizardDraft() — the browser proof, wired into the ci.yml e2e-seeded batch"
affects: [154-06, 154-08, WizardClient, ContributionWizardOverlay, wizard-resume]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Deferred mount as the conformant shape for feeding a late-arriving value into a component whose useState initializers read props once"
    - "A mocked component toggled between stub and REAL implementation in one test file (React.createElement(actual.X, props) behind a vi.hoisted flag)"
    - "Route SPY that reads the response body to enforce an own-seed invariant on a shared test DB (route.fetch() → inspect → route.fulfill({response}))"

key-files:
  created:
    - e2e/wizard-resume.spec.ts
  modified:
    - src/app/(dashboard)/allocations/components/ContributionWizardOverlay.tsx
    - src/app/(dashboard)/allocations/components/ContributionWizardOverlay.test.tsx
    - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
    - src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx
    - src/app/(dashboard)/strategies/new/wizard/page.tsx
    - src/lib/wizard/localStorage.ts
    - src/lib/wizard/localStorage.test.ts
    - e2e/helpers/seed-test-project.ts
    - .github/workflows/ci.yml

key-decisions:
  - "The planner's Pitfall W-1 resolution (defer the mount) was followed exactly; the key was ALSO extended to `${source}:${draft?.id ?? 'new'}` as specified"
  - "MEASURED: reordering the step initializer is behavior-NEUTRAL given draftMatchesSource upstream. The behavioral CSV defect was handleResume's hard-coded sync_preview plus the banner gate — both fixed, both mutation-proven. The reorder is kept as the class-level guarantee and is documented as defensive, not as the fix."
  - "The plan's Mutation 2 was recorded GREEN rather than manufactured RED; a substitute second-member mutation (2b) and a third (2c) were run instead"
  - "WizardClient's local duplicate `InitialDraft` interface was replaced by the type-only import from the 154-02 module — the same second-shape drift that module exists to prevent"

patterns-established:
  - "A new seed-gated e2e spec is not done until it is in the ci.yml e2e-seeded list — place 2 of the two-place rule; without it the spec runs nowhere"
  - "A mutation that comes back GREEN is a FINDING to report, not a failure to hide: it located the real defect member"

requirements-completed: [WIZCONT-01]

# Metrics
duration: 41min
completed: 2026-08-12
---

# Phase 154 Plan 05: WIZCONT-01 overlay resume Summary

**Re-entering "add a strategy" from the overlay now offers the founder an explicit Resume / Start-fresh choice and actually lands on the draft's own step — because the overlay reads the draft before it mounts the wizard, and because the two places that silently discarded a draft (the banner gate and `handleResume`) were found by mutation and fixed.**

## Performance

- **Duration:** ~41 min
- **Started:** 2026-08-12T10:30:00Z
- **Completed:** 2026-08-12T11:11:00Z
- **Tasks:** 3
- **Files modified:** 10 (1 created, 9 modified)

## Accomplishments

- **The Phase 110 deferral at `ContributionWizardOverlay.tsx:146` is closed.** The overlay fetches `GET /api/strategies/wizard-draft` on open, above the `!isOpen` null gate, and **defers the `WizardClient` mount** until the read settles — the planner's recorded W-1 decision, followed exactly. `grep -c "initialDraft={null}"` → **0**.
- **The prop-echo oracle is retired, not merely avoided.** The stub's `initialDraft` testid and the assertion that read it are both deleted (`grep` → **0** in the test file, and the retired testid is not spelled in the prose either — the 154-02 docblock-hygiene lesson). Resume is asserted through the **REAL** `WizardClient`: real banner testids, real step machine, the draft's own id on the sync surface.
- **A CSV draft resumes.** The step initializer consults the draft first, and — the part that actually mattered — `handleResume` no longer hard-codes `sync_preview`, which used to drop a CSV resume onto an API step with no key behind it.
- **Silent resume is gone.** A server draft reached with no local pointer (the overlay's normal case, a second device, cleared storage, an expired tab nonce) now raises the banner instead of jumping straight into the draft's step with no choice offered.
- **A composite draft can never be routed to the CSV step** — the kind comes from `deriveDraftKind`, never re-derived from `api_key_id`.
- **Browser proof exists and will actually run:** `e2e/wizard-resume.spec.ts` drives the overlay (never `/strategies/new/wizard`, which already worked), spies both routes, enforces the own-seed invariant on the shared test DB, and is listed in the `ci.yml` `e2e-seeded` batch.

## Task Commits

1. **Task 1: Draft-kind-aware step initializer + branch matching** — `f8a6d169` (fix)
2. **Task 2: Overlay fetch-on-open with deferred mount** — `96135051` (feat)
3. **Task 3: e2e browser proof + seed helper + CI wiring** — `c6cc0c98` (test)

## Files Created/Modified

- `src/app/(dashboard)/allocations/components/ContributionWizardOverlay.tsx` — draft state (`undefined` = unsettled), fetch effect above the null gate with a close-reset, kind-follows-source tab, `draftMatchesSource` filter, deferred mount, key extended to `${source}:${id ?? "new"}`, degrade-to-fresh on a failed read.
- `src/app/(dashboard)/allocations/components/ContributionWizardOverlay.test.tsx` — 14 cases in two describes: the wiring contract (mocked wizard) and resume (REAL wizard, toggled via a `vi.hoisted` flag + `React.createElement(actual.WizardClient, props)`).
- `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` — `initialDraftKind` prop, one `draftResumeStep` expression read by both the mount initializer and `handleResume`, draft-before-source ordering, local `InitialDraft` replaced by the single-sourced type import.
- `src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx` — a new `[154-05 / TWIN-6]` describe: CSV draft resumes on `csv_upload` with the banner and the draft bound; Resume on a CSV draft never lands on `sync_preview`; a composite draft goes to `sync_preview`, never `csv_upload`; and the no-draft CSV control (the positive counterpart, so "renders nothing" cannot satisfy both).
- `src/app/(dashboard)/strategies/new/wizard/page.tsx` — applies the imported `draftMatchesSource`; passes the kind down.
- `src/lib/wizard/localStorage.ts` / `.test.ts` — the unpointed-draft banner rule + its two-case pin.
- `e2e/wizard-resume.spec.ts` — the overlay walk with two route spies and the own-seed assertion.
- `e2e/helpers/seed-test-project.ts` — `seedWizardDraft()` (api-kind draft under the `e2e-wizcont-` GC prefix).
- `.github/workflows/ci.yml` — the spec added to the `e2e-seeded` batch.

## SC-1 falsifiability record (for 154-08 → VALIDATION.md)

Four mutations were applied one at a time and reverted with `git checkout -- <file>`. `grep -rn MUTANT src/ e2e/` → **0** afterwards.

**Mutation 1 — the overlay passes `initialDraft={null}` again.** → **RED (3 cases)**

```
 × an existing API draft renders the real resume banner and lands on the draft
 × Start fresh only OPENS the confirm dialog — it never deletes (TRAP-4)
 × switching to the CSV tab offers a FRESH flow, never the API draft
TestingLibraryElementError: Unable to find an element by: [data-testid="wizard-resume"]
      Tests  3 failed | 11 passed (14)
```

**Mutation 2 (the plan's literal form) — restore `if (source === "csv") return "csv_upload";` ABOVE the draft consultation.** → **GREEN. 30 passed, 0 failed.**

⭐ This is a finding, not a miss, and it is reported rather than papered over. With `draftMatchesSource` applied by BOTH callers, a draft only ever reaches its own branch, so `source === "csv"` and `draftKind === "csv"` agree on every reachable input and the two orderings return the same step. **The ordering is defense-in-depth, not the behavioral fix.** The reorder is kept (it is the class-level guarantee and survives a future caller that stops filtering), but this SUMMARY records that no test can currently fail on it alone. The behavioral defect lived one line further down, which mutation 2b locates:

**Mutation 2b — restore `handleResume`'s hard-coded `setStep("sync_preview")`.** → **RED**

```
 × Resume on a CSV draft stays on csv_upload — it never lands on sync_preview
TestingLibraryElementError: Unable to find an element by: [data-testid="wizard-csv-dropzone"]
      Tests  1 failed | 29 passed (30)
```

**Mutation 2c — restore `if (!loaded) return {};` (the silent-resume gate).** → **RED (4 cases across two files)**

```
 × an existing API draft renders the real resume banner and lands on the draft
 × Start fresh only OPENS the confirm dialog — it never deletes (TRAP-4)
 × switching to the CSV tab offers a FRESH flow, never the API draft
 × offers the banner when a draft exists and there is NO local pointer at all
AssertionError: expected {} to deeply equal { showResumeBanner: true }
      Tests  4 failed | 46 passed (50)
```

**Mutation 3 (TRAP-4) — `handleStartFresh` calls `handleDeleteDraft()` directly.** → **RED (4 cases)**

```
 × Start fresh only OPENS the confirm dialog — it never deletes (TRAP-4)
 × clicking Start fresh DELETES NOTHING — it opens the confirm dialog
 × cancelling leaves the draft AND the way back to it intact
 × confirming DOES delete — the affordance still works, it just asks first
AssertionError: Start fresh must ASK before it destroys — TRAP-4 is a standing
  invariant, and reaching the wizard through the overlay must not weaken it.:
  expected false to be true
      Tests  4 failed | 40 passed (44)
```

## Decisions Made

1. **Defer the mount, exactly as the planner decided.** No attempt was made to thread a late draft into a mounted `WizardClient`; its initializers read `initialDraft` once (`:198`, `:204`, `:207`, `:228`). The key was extended as well, so a Start-fresh delete or a branch toggle forces a clean remount.
2. **The kind is a sibling prop, not a widened draft object.** Additive, so every existing `<WizardClient initialDraft={DRAFT} />` call site keeps compiling and behaving identically. When the kind is absent the draft is assumed to belong to the branch it was handed to — which is precisely what `draftMatchesSource` guarantees for both production callers, and is byte-identical to pre-154 behavior for anyone else.
3. **`WizardClient`'s duplicate `InitialDraft` interface was deleted** in favour of the type-only import from `@/lib/wizard/draft-query`. It was a second declaration of the exact shape 154-02 single-sourced; the import is erased at build, so no server code enters the client bundle.
4. **The pending line is inline, per the plan's sanction** — `text-caption text-text-muted`, no new component, no invented spinner. Copy: **"Checking for a saved draft…"**. It is not in the UI-SPEC copywriting table (that table predates the deferral decision); flagged here for the design ledger.
5. **A GREEN mutation is reported as a finding.** Manufacturing a red by weakening the test, or quietly dropping the mutation, would have hidden the fact that the plan's stated defect line was not the behavioral one.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical] The resume banner could not render for a draft with no local pointer — the plan's own must-have was unreachable**

- **Found during:** Task 1 (while reading `deriveWizardResumeOverrides` for the banner contract)
- **Issue:** `showResumeBanner` is set from exactly one place, and `deriveWizardResumeOverrides` returned `{}` whenever `loadWizardState()` answered `null`. That is the overlay's *normal* case (a fresh open with no stored pointer), plus a second device, cleared storage, and an expired tab nonce. Meanwhile the step initializer had already mounted the wizard on the draft's step. Net effect: a **silent resume** with no Resume / Start-fresh choice on screen — directly contradicting the plan's must-have ("Resume is explicit, never silent") and making its acceptance criterion (real banner testids under a REAL `WizardClient`) impossible to satisfy.
- **Fix:** `if (!loaded) return initialDraftId ? { showResumeBanner: true } : {};` — an unpointed draft is offered exactly like a mismatched pointer, with the reasoning written at the site.
- **Files modified:** `src/lib/wizard/localStorage.ts`, `src/lib/wizard/localStorage.test.ts`
- **Verification:** Mutation 2c above (4 cases RED across two files). The pre-existing `it("returns no overrides when loaded is null")` was split into a no-draft case and the new draft case, so the behavior change is recorded in the test file rather than silently relaxed.
- **Committed in:** `f8a6d169`

**2. [Rule 1 — Bug] `handleResume` sent a CSV draft to `sync_preview`**

- **Found during:** Task 1
- **Issue:** `handleResume` hard-coded `setStep("sync_preview")` + `persistPointer("sync_preview", …)` for every draft. Fixing only the initializer would have left "Resume draft" on a CSV draft landing the founder on an API-branch step with no key behind it — the CSV resume would look fixed at mount and break on the very click the banner exists for.
- **Fix:** One `draftResumeStep` expression, read by the initializer AND `handleResume` (two spellings of "where does this draft resume" is how a mount and a button drift apart).
- **Files modified:** `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx`
- **Verification:** Mutation 2b above.
- **Committed in:** `f8a6d169`

**3. [Rule 3 — Blocking] The plan's consumer-ripple file list was falsified by the tree**

- **Found during:** Task 3
- **Issue:** The plan (and PATTERNS' Twin Register correction) named four test files to ripple. Two of them — `MyStrategiesEmptyState.test.tsx` and `MyStrategiesSection.test.tsx` — **do not exist**; `src/app/(dashboard)/my-strategies/` contains only `page.test.tsx`. The other two, `AllocationsTabs.addalloc.test.tsx:129` and `ScenarioComposer.test.tsx:125`, **mock `ContributionWizardOverlay` wholesale**, so the overlay's new internal fetch never executes in them.
- **Fix:** No ripple edits were needed or made. The four REAL renderers are unchanged (the overlay's public props did not change), `StrategyBrowseDrawer` was not touched, and the claim was verified by execution rather than by reading: `vitest run "src/app/(dashboard)/my-strategies" "src/app/(dashboard)/allocations"` → **124 files, 1878 tests, all passing** with zero test-file changes.
- **Files modified:** none
- **Committed in:** n/a (a verified no-op, recorded here so 154-08 does not go looking for edits that should not exist)

**4. [Rule 2 — Missing critical] A new seed-gated e2e spec that runs nowhere is a false green**

- **Found during:** Task 3
- **Issue:** The plan specifies the new spec and its `HAS_SEED_ENV` self-skip (place 1 of the repo's two-place rule) but not place 2. `composite-onboarding.spec.ts:5-9` states it explicitly: extending an existing spec inherits the CI entry, **a NEW spec file does not**. Landing `wizard-resume.spec.ts` without touching `ci.yml` would have produced a spec that never executes in CI while reading as delivered coverage.
- **Fix:** Added `e2e/wizard-resume.spec.ts` to the `e2e-seeded` batch in `.github/workflows/ci.yml` (a static filename in an existing `npx playwright test` list — no workflow input is interpolated).
- **Files modified:** `.github/workflows/ci.yml`
- **Verification:** `npx playwright test e2e/wizard-resume.spec.ts --list` → 1 test in 1 file; the name appears in the batch alongside `wizard-axe.spec.ts`.
- **Committed in:** `c6cc0c98`

**5. [Rule 1 — Bug, in the deliverable's own test] The retired testid was still spelled in prose**

- **Found during:** Task 2
- **Issue:** The first draft of the rewritten test docblock *described* the retired prop-echo testid by name, which made the plan's acceptance grep return 1 while the assertion was genuinely gone — the same shape as 154-02's `createAdminClient` docblock defeating its own gate.
- **Fix:** Reworded to name it obliquely, with a note that the gate is a literal grep. `grep -c` → 0.
- **Committed in:** `96135051`

---

**Total deviations:** 5 (2 missing-critical, 2 bugs, 1 blocking). No scope creep: deviations 1 and 2 are the two lines that actually made CSV/overlay resume work, and deviation 3 *removed* work the plan expected.

## Issues Encountered

- **The worktree had no `node_modules`** (gitignored, not carried by a linked worktree). Symlinked from the main checkout before any verification ran, per the executor's dependency check — otherwise every `vitest`/`tsc` exit code would have been meaningless.
- **`window.localStorage.clear` is not a function** under this Node/jsdom combination. The test's storage reset is guarded (`?.clear?.()` inside try/catch) so a storage-shim difference between the local and CI node versions can never be the thing that reddens.
- **jsdom implements neither `HTMLDialogElement.showModal()` nor `.close()`.** The repo's existing stub pattern (`Modal.test.tsx:23-39`, `WizardClient.test.tsx:993-1006`) was copied so the overlay-level TRAP-4 case can drive the real confirm dialog.
- **Four tests fail in `src/app/(dashboard)` and are NOT mine:** `T1`, `T1b`, `T2b` (`SyncPreviewStep.stale.runtime.test.tsx`) and `T3` (`SyncPreviewStep.stale-refusal.runtime.test.tsx`). These are 154-01's deliberately-RED investigation tests for STALE-01a/b, landed at HEAD with zero production source modified and owned by a later plan. This plan touches none of those files and none of their imports.

## Verification

- `vitest run "src/app/(dashboard)" --no-file-parallelism` → **176 files / 2559 tests passed**; the only 4 failures are 154-01's pre-existing RED set named above.
- `vitest run "src/app/(dashboard)/my-strategies" "src/app/(dashboard)/allocations"` → **124 files / 1878 passed** (the consumer surface, unchanged).
- `vitest run WizardClient.test.tsx ContributionWizardOverlay.test.tsx src/lib/wizard` → **8 files / 343 passed**.
- `npx tsc --noEmit` → clean. `eslint` on every changed file → clean (the single remaining warning, `ContributionWizardOverlay.tsx:91`, is a pre-existing unused-disable directive on a line this plan did not touch).
- `npx playwright test e2e/wizard-resume.spec.ts --list` → lists cleanly.
- **Grep gates:** `initialDraft={null}` in the overlay → **0**; `wizard-initial-draft` in its test → **0**; `draftMatchesSource` in `page.tsx` → **2**; `MUTANT` under `src/` and `e2e/` → **0**; the fetch effect (line 114) sits above `if (!isOpen) return null` (line 167).

## Known Stubs

None. Every branch this plan added renders real data or a real settled state; the one new inline element (the pending line) is a genuine loading state that resolves in every test, including the read-failure arm.

## Threat Flags

None. The register's `mitigate` dispositions are implemented and pinned:

| Threat | Disposition | Where it is enforced |
|--------|-------------|----------------------|
| T-154-05-A (information disclosure) | mitigate | the overlay calls the id-less, RLS-bounded 154-02 route and renders only the caller's own draft; the e2e own-seed assertion reads the wire body |
| T-154-05-B (one-click destructive Start fresh) | mitigate | TRAP-4 re-pinned at BOTH levels (`WizardClient.test.tsx` and now the overlay path), with mutation 3 proving both can fail |
| T-154-05-C (overlay blocked by a failed read) | mitigate | non-OK/network error degrades to a fresh wizard + `console.warn`, pinned by the 500 arm |
| T-154-SC (package installs) | accept | no packages installed |

## User Setup Required

None.

## Next Phase Readiness

- **154-06 (STALE-01) is unaffected** by this plan — it owns `SyncPreviewStep` / `useStrategySyncPoller` and the four RED tests named above.
- **For 154-08 (VALIDATION.md):** transcribe the SC-1 record above **including the GREEN mutation 2 and its explanation**. The honest statement is: *the CSV/overlay resume class is closed and mutation-proven at three points (the overlay's draft, `handleResume`'s step, the banner gate); the initializer REORDER itself is defensive and is currently unfalsifiable because `draftMatchesSource` makes both orderings agree.*
- ⚠️ **The e2e spec has never been executed** — no seed env is available in this worktree. It lists cleanly and typechecks; its first real run is the CI `e2e-seeded` job. The two brittleness candidates, named so a failure is diagnosed rather than re-debugged: the `/allocations` "+ Allocation" button's accessible name (`Add allocation — connect an exchange or upload a CSV`), and the assumption that `sync_preview` kicks off `/api/keys/sync` for a seeded draft with a placeholder-ciphertext key.
- **Minor residual:** `seedWizardDraft`'s `api_keys` row is not GC'd by `cleanupStrategiesByNamePrefix` (which deletes `strategies` only) — identical to `seedCompositeStrategy`'s existing behavior, and harmless because the owning user is created per run.

## Self-Check: PASSED

- `e2e/wizard-resume.spec.ts` exists on disk; all 9 modified files exist and carry the changes described.
- All three commits are present in `git log`: `f8a6d169`, `96135051`, `c6cc0c98`.
- `git diff --diff-filter=D --name-only c17269f8 HEAD` → empty (no file was deleted).
- No claimed file or hash is missing; no STATE.md or ROADMAP.md modification was made.

---
*Phase: 154-wizcont-stale-wizard-continuity-no-stale-screens*
*Completed: 2026-08-12*

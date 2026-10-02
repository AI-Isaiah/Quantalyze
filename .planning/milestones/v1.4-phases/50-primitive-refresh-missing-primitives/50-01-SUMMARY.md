---
phase: 50-primitive-refresh-missing-primitives
plan: 01
subsystem: ui
tags: [radix, tabs, react-testing-library, vitest, a11y, tdd, design-system]

# Dependency graph
requires:
  - phase: 49-design-system-token-spine
    provides: "fluid --text-* tier utilities (text-h3/text-body/text-small/text-caption/text-micro) the lock tests assert against"
provides:
  - "@radix-ui/react-tabs@1.1.15 installed, exact-pinned, no postinstall, after a blocking human legitimacy approval"
  - "RED test contracts for the 3 new primitives (Tabs/Table/Field) — fail module-not-found until Wave-1 builds them"
  - "Button/Modal LOCK tests pinning the text tier migration + focus:→focus-visible: edit (RED now, GREEN gate for Wave-1 Plan 02)"
affects: [50-02-core-refresh, 50-03-new-primitives, 51-navigation, 52-surface-migration, 53-surface-migration]

# Tech tracking
tech-stack:
  added: ["@radix-ui/react-tabs@1.1.15 (exact-pinned, first runtime UI-widget dep)"]
  patterns:
    - "RED-contract-precedes-implementation: new-primitive .test.tsx ships in Wave 0, fails module-not-found until the primitive is built (BP-03 coverage ratchet protection)"
    - "LOCK test: assert post-refresh classes against current source so the CSS refresh cannot silently regress (text tiers + keyboard-only focus-visible ring axe cannot catch)"

key-files:
  created:
    - src/components/ui/Tabs.test.tsx
    - src/components/ui/Table.test.tsx
    - src/components/ui/Field.test.tsx
    - src/components/ui/Button.test.tsx
    - src/components/ui/Modal.test.tsx
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Pinned @radix-ui/react-tabs EXACT at 1.1.15 (no caret) so a future malicious release cannot float in via a range — T-50-SC supply-chain mitigation"
  - "No next.config experimental.viewTransition flag added (out of plan scope; this milestone's View Transitions use the native document.startViewTransition path per the phase decision)"
  - "Authored RED contracts only — did NOT implement Tabs/Table/Field (GREEN is Wave-1 Plan 03's job); did NOT touch any non-test primitive source"

patterns-established:
  - "RED-contract-precedes-implementation: the executable contract is committed before the primitive (test() RED gate)"
  - "LOCK test as a refresh gate: post-refresh tier/focus-visible classes asserted against current source flip RED→GREEN when the Wave-1 refresh lands"

requirements-completed: [UI-01, UI-02, UI-04]

# Metrics
duration: ~6min
completed: 2026-06-29
---

# Phase 50 Plan 01: Wave-0 Dependency + RED Test Contracts Summary

**Installed @radix-ui/react-tabs@1.1.15 exact-pinned behind a (pre-cleared) human legitimacy gate, and authored 5 colocated executable contracts — 3 new-primitive RED specs (Tabs/Table/Field) that fail module-not-found until Wave 1, plus Button/Modal LOCK tests that pin the post-refresh fluid tiers + focus-visible ring as the Wave-1 Plan 02 GREEN gate.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-29T03:42Z (approx)
- **Completed:** 2026-06-29T03:48Z
- **Tasks:** 3 (Task 1 checkpoint pre-cleared, Task 2 install, Task 3 contracts)
- **Files modified:** 7 (2 dependency manifests + 5 new test files)

## Accomplishments
- `@radix-ui/react-tabs@1.1.15` installed and pinned exact (no caret), with no postinstall script, verified in `package.json`, `package-lock.json`, and `node_modules`.
- 3 new-primitive RED contracts authored, each failing on `Failed to resolve import "./Tabs|./Table|./Field"` — the contract precedes the implementation by design (Wave-1 Plan 03 makes them GREEN).
- 2 core-primitive LOCK tests authored: Button (text-body/text-caption tiers + focus-visible ring, no bare focus:ring, public variant×size API stable) and Modal (title text-h3, close button focus-visible ring, native `<dialog>` retained). 5 RED assertion failures + 1 GREEN (Button public-API-unchanged) — these become Wave-1 Plan 02's GREEN gate.
- Zero production primitive source touched (guard-verified: only `*.test.tsx` staged).

## Task Commits

Each task was committed atomically (code only — `.planning/` is gitignored on this repo and not committed):

1. **Task 1: Legitimacy-verify @radix-ui/react-tabs (checkpoint:human-verify, gate=blocking-human)** — APPROVED (pre-cleared by orchestrator; no commit — a verification gate writes no files). Evidence recorded below.
2. **Task 2: Install @radix-ui/react-tabs@1.1.15 exact-pinned** — `f1dbb007` (chore)
3. **Task 3: RED contracts (Tabs/Table/Field) + lock tests (Button/Modal)** — `867c706f` (test — the TDD RED gate)

**Plan metadata:** not committed (`.planning/` gitignored on this repo — SUMMARY.md, STATE.md, ROADMAP.md are local-only per the sequential-mode contract).

_Note: this is a `type: tdd` Task 3 whose RED phase is the whole deliverable; GREEN is a later wave. A single `test(...)` commit is the RED gate. See TDD Gate Compliance below._

## Files Created/Modified
- `package.json` — adds `"@radix-ui/react-tabs": "1.1.15"` (exact)
- `package-lock.json` — resolves @radix-ui/react-tabs and its 15 transitive packages to pinned versions
- `src/components/ui/Tabs.test.tsx` — RED: role=tab/tabpanel, single aria-selected, clicking flips selection, roving tabindex 0/-1, ArrowRight/Home/End automatic activation (Radix anatomy)
- `src/components/ui/Table.test.tsx` — RED: `<th scope="col">` columnheaders, accessible-name landmark (`getByRole("table", { name })`), body-cell render
- `src/components/ui/Field.test.tsx` — RED: htmlFor/id label wiring (`getByLabelText`), aria-describedby joins BOTH hint+error ids (and hint-only when no error), aria-invalid on error / not-true when absent
- `src/components/ui/Button.test.tsx` — LOCK: md→text-body / sm→text-caption, focus-visible:ring with no bare focus:ring, every variant×size renders without throwing
- `src/components/ui/Modal.test.tsx` — LOCK: title text-h3 (not text-lg), close button focus-visible ring; jsdom showModal/close stub (borrowed from AdminTabs.test.tsx:33-46)

## Task 1 Checkpoint Evidence (pre-cleared APPROVED)

The blocking human legitimacy gate for `@radix-ui/react-tabs` was cleared by the orchestrator before this executor ran. Recorded verification signals:

- `npm view @radix-ui/react-tabs@1.1.15` → version 1.1.15 (exact pin target); `repository.url = git+https://github.com/radix-ui/primitives.git` (official Radix monorepo); maintainers include Radix core (hadihallak, chancestrickland) + WorkOS (which owns Radix).
- Not on the CLAUDE.md banned-packages list. React 19 peer. ~52M weekly downloads. No postinstall script.

Post-install, `npm view @radix-ui/react-tabs@1.1.15 scripts.postinstall` returned empty, corroborating the no-postinstall signal on the actually-installed artifact.

## Decisions Made
- Pinned EXACT (`1.1.15`, no caret) — npm wrote the exact pin via `--save-exact`; no manual edit was needed. Exact-pin is the T-50-SC mitigation so a future malicious release cannot float in via a range.
- No `next.config.ts` change in this plan (View Transitions use the native path per the phase decision; `experimental.viewTransition` intentionally NOT added here).
- Did NOT run `npm audit fix` (out of scope per plan; the pre-existing 12 vulnerabilities are unrelated to this install and untouched).

## Deviations from Plan

None - plan executed exactly as written. Task 1's checkpoint was pre-cleared by the orchestrator (recorded as APPROVED with the supplied evidence, no pause), and Tasks 2-3 met every acceptance criterion on the first attempt.

## TDD Gate Compliance

This is a `type: execute` plan whose Task 3 is `tdd="true"` and is intentionally a **RED-only** deliverable — the new-primitive implementations (GREEN) belong to Wave-1 Plan 03, and the Button/Modal LOCK tests go GREEN under Wave-1 Plan 02's CSS refresh.

- **RED gate present:** `867c706f` is a `test(...)` commit. The new-primitive specs fail `Failed to resolve import` and the lock specs fail their tier/focus-visible assertions — verified RED, not vacuously green.
- **No premature pass:** the one passing assertion (Button renders every variant×size without throwing) is the public-prop-API-unchanged contract, which is correctly already true today (the refresh is CSS-only). It does not represent skipped RED.
- **GREEN/REFACTOR gates:** intentionally absent in this plan — they are owned by later waves. This is the documented multi-wave RED-precedes-GREEN structure, not a missing gate.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required (the one new dependency was installed and pinned in this plan).

## Next Phase Readiness
- **Wave 1 unblocked:** the exact-pinned Radix Tabs dep is importable, and the 5 executable contracts are in place to gate the refresh + new-primitive builds.
- **Wave-1 Plan 02** (core refresh) flips Button.test.tsx + Modal.test.tsx GREEN by migrating the text tiers and `focus:`→`focus-visible:` ring.
- **Wave-1 Plan 03** (new primitives) flips Tabs/Table/Field tests GREEN by creating the three modules.
- **Coverage note (BP-03):** the new primitives add substantial lines/branches/functions; the contracts ensure each ships with its `.test.tsx` in the same PR. Run `npm run test:coverage` (full non-sharded) at the Wave-1 merge to confirm the 82/80/74/72 ratchet holds.

## Self-Check: PASSED

- All 5 test files exist on disk; SUMMARY.md exists.
- Both task commits (`f1dbb007`, `867c706f`) found in git log.
- `package.json` contains the exact pin `"@radix-ui/react-tabs": "1.1.15"`.
- Plan automated verify: new-primitive contracts fail RED (module-not-found); Button/Modal lock tests fail RED on the tier/focus-visible asserts (5 failing assertions, 1 passing public-API check) — exactly the documented contract.

---
*Phase: 50-primitive-refresh-missing-primitives*
*Completed: 2026-06-29*

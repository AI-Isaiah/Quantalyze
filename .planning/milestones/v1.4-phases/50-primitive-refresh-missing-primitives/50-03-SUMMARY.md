---
phase: 50-primitive-refresh-missing-primitives
plan: 03
subsystem: ui
tags: [radix, tabs, table, field, a11y, wai-aria, react, user-event, primitives]

# Dependency graph
requires:
  - phase: 50-primitive-refresh-missing-primitives (Plan 50-01)
    provides: "Wave-0 RED contracts (Tabs/Table/Field.test.tsx) + @radix-ui/react-tabs@1.1.15 install"
  - phase: 49-fluid-type-token-spine
    provides: "live --text-* fluid clamp tiers (text-small/body/caption/micro) in globals.css @theme"
provides:
  - "Tabs primitive — \"use client\" wrapper over @radix-ui/react-tabs; underline + segmented variants; explicit-id passthrough so an EXTERNAL role=tabpanel can be wired (Wave-2 WatchlistTabs/StrategyTable contract)"
  - "Table base primitive — semantic <table>/<thead>/<th scope> parts + named-table landmark, builds ON ResponsiveTable (does not replace it)"
  - "Field primitive — label<->control htmlFor/id, aria-describedby joining hint+error, aria-invalid on error"
  - "user-event harness + Radix jsdom shims (pointer-capture + scrollIntoView) so Radix widgets are unit-testable under vitest/jsdom"
affects: [50-04, 50-05-tabs-consolidation, 50-06-strategytable-reshape, 50-07-strangler-pilot, 51-nav, 52-surface-migration, 53-surface-migration]

# Tech tracking
tech-stack:
  added:
    - "@testing-library/user-event@14.6.1 (devDependency, exact pin) — drives Radix pointer/keyboard activation in jsdom (bare fireEvent cannot)"
  patterns:
    - "Tabs = thin \"use client\" Radix wrapper: re-export Root/List/Content, style Trigger via data-[state=active] (NOT aria-selected, which Radix manages); variant underline|segmented; explicit id spread LAST so a consumer id wins over Radix's auto id (Pitfall 1)"
    - "Radix-in-jsdom test harness: additive Element.prototype pointer-capture + scrollIntoView no-op shims in test-setup.ts + user-event.setup() to drive activation/keyboard; intent-preserving (real ArrowRight/Home/End a11y exercised)"
    - "Table/Field use semantic/native HTML only — no @radix-ui import (UI-04); all cell/label/hint/error content renders as escaped React children (no dangerouslySetInnerHTML — T-50-04)"

key-files:
  created:
    - src/components/ui/Tabs.tsx
    - src/components/ui/Table.tsx
    - src/components/ui/Field.tsx
  modified:
    - src/components/ui/Tabs.test.tsx
    - src/test-setup.ts
    - package.json
    - package-lock.json

key-decisions:
  - "Option A (orchestrator-authorized) for the Tabs RED contract: keep the locked UI-04 'Radix backs Tabs' decision AND keep the keyboard intent intact — install user-event + add Radix jsdom shims + drive the 4 activation/keyboard asserts with user-event, rather than soften them or hand-roll Tabs away. The 4 RED failures were a harness-driver mismatch (bare fireEvent cannot drive Radix's mouseDown/focus + roving-tabindex in jsdom), NOT a Tabs.tsx bug."
  - "user-event pinned EXACT (14.6.1, no caret) per the orchestrator's supply-chain pre-clearance; npm's default caret was corrected and the lockfile resynced."
  - "Tabs.tsx (built by a prior executor) reviewed against 50-UI-SPEC and shipped as-is — it was already correct: \"use client\", underline+segmented variants, --color-*/--text-* tokens (text-small/text-micro, no bare text-sm/text-xs), data-[state=active] styling hook, explicit-id passthrough via last-spread, no raw hex/px."
  - "Roving-tabindex test STRENGTHENED, not weakened: it now drives a real Tab into the tablist + an ArrowRight and asserts the 0/-1 split FOLLOWS the active trigger (the un-settled initial-render DOM the bare-fireEvent version asserted was the flaky part)."

patterns-established:
  - "Radix primitives are unit-driven with @testing-library/user-event (not fireEvent) + the pointer-capture/scrollIntoView jsdom shims — reusable for any future Radix widget."

requirements-completed: [UI-02, UI-04]

# Metrics
duration: 9min
completed: 2026-06-29
---

# Phase 50 Plan 03: Missing Primitives (Tabs + Table + Field) Summary

**The three genuinely-new toolkit primitives now exist with GREEN contracts: a Radix-backed `Tabs` (`"use client"`, underline + segmented variants, explicit-id passthrough for the Wave-2 external-tabpanel contract), a semantic `Table` base (`<th scope>` + named landmark on top of `ResponsiveTable`), and a `Field` wrapper (`htmlFor`/`id` + `aria-describedby` joining hint+error + `aria-invalid`) — Tabs is the only Radix primitive; Table/Field are native/semantic HTML (UI-04).**

## Performance

- **Duration:** ~9 min across the plan (Table+Field built earlier in the wave; Tabs completed this session)
- **Completed:** 2026-06-29
- **Tasks:** 3
- **Files created:** 3 (Tabs.tsx, Table.tsx, Field.tsx) · **modified:** 4 (Tabs.test.tsx, test-setup.ts, package.json, package-lock.json)

## Accomplishments
- **Tabs (Task 1):** thin `"use client"` wrapper over `@radix-ui/react-tabs@1.1.15` — `Tabs=Root`/`TabsList`/`TabsTrigger`/`TabsContent`, `variant: "underline" | "segmented"`, Trigger styled via `data-[state=active]` (Radix manages `aria-selected`). Explicit `id` spread last so a consumer id wins over Radix's auto id — the Pitfall-1 contract that lets Plan 50-05's WatchlistTabs keep its `idBase`-derived trigger ids resolving an EXTERNAL `StrategyTable` `role="tabpanel"`. Contract 6/6 GREEN.
- **Table (Task 2, already committed `ac81d549`):** composable semantic parts rendering a real `<table>`/`<thead>`/`<th scope="col">` (+ `scope="row"` for the future sticky first column) with a name (caption/aria-label), building ON `ResponsiveTable` without regressing its unique-`aria-label` landmark. Contract GREEN.
- **Field (Task 3, already committed `4f75050a`):** `<label htmlFor={id}>` ↔ control `id` (`useId()` fallback, explicit id wins), `aria-describedby = [hintId, errorId].filter(Boolean).join(" ")`, `aria-invalid = !!error || undefined` — closing the exact `aria-describedby` gap the wizard hand-wiring leaves open. Contract GREEN.
- **Test harness:** installed `@testing-library/user-event@14.6.1` (exact pin) + added pointer-capture / `scrollIntoView` jsdom shims to `test-setup.ts` so Radix widgets are drivable under vitest/jsdom. The shims are no-op safe — the full `src/components/ui/` suite (11 files / 59 tests) stays green.

## Task Commits

Each task committed atomically (code only — `.planning/` is gitignored, never staged):

1. **Task 1: Tabs primitive (Radix wrapper) + user-event harness** — `0b9ed81b` (feat) — THIS session
2. **Task 2: Table base primitive (semantic, named landmark)** — `ac81d549` (feat) — prior session
3. **Task 3: Field primitive (label/control/hint/error a11y wiring)** — `4f75050a` (feat) — prior session

_Tasks 2 and 3 were already complete and committed; they were NOT redone. Each `tdd="true"` plan task's RED contract pre-landed in Wave 0 (Plan 50-01) — this plan is the GREEN phase, flipping those locks. No new RED test commits were needed (the contracts pre-exist); the only test edit was correcting the Tabs contract's driver (see Deviations)._

## Files Created/Modified
- `src/components/ui/Tabs.tsx` — **NEW** (103 lines) — Radix wrapper, underline+segmented variants, explicit-id passthrough
- `src/components/ui/Table.tsx` — **NEW** (120 lines, `ac81d549`) — semantic `<table>` parts + named landmark
- `src/components/ui/Field.tsx` — **NEW** (95 lines, `4f75050a`) — label/control/hint/error a11y wiring
- `src/components/ui/Tabs.test.tsx` — drove the 4 activation/keyboard asserts via `user-event`; roving-tabindex strengthened to follow activation
- `src/test-setup.ts` — additive Radix jsdom shims (pointer-capture + scrollIntoView)
- `package.json` / `package-lock.json` — `@testing-library/user-event@14.6.1` devDep, exact pin

## Decisions Made
- **Option A for the Tabs RED contract (orchestrator-authorized):** the 4 RED failures (click-flip, roving-tabindex-follows-focus, ArrowRight, Home/End) were a harness-driver mismatch — bare `fireEvent` cannot drive Radix's `mouseDown`/`focus`-based activation + roving-tabindex (which does not settle synchronously in jsdom) — NOT a `Tabs.tsx` bug. Resolution preserved BOTH the locked UI-04 "Radix backs Tabs" decision AND the keyboard intent: installed `user-event`, added the standard Radix jsdom shims, and rewrote only the 4 affected asserts to drive Radix with `user.click` / `user.keyboard("{ArrowRight}"|"{Home}"|"{End}")`. The 2 already-passing structural asserts (role anatomy + initial single-`aria-selected`) were left as plain render assertions.
- **Keyboard coverage NOT softened — strengthened.** The roving-tabindex test now drives a real `Tab` into the tablist + an `ArrowRight` and asserts the `tabindex` 0/-1 split FOLLOWS the active trigger (the bare-fireEvent version asserted the un-settled initial-render DOM, which was the flaky part). Real ArrowRight/Home/End roving-focus a11y is exercised end-to-end.
- **user-event pinned exact (no caret).** npm wrote `^14.6.1` by default; corrected to `14.6.1` and resynced the lockfile per the orchestrator's supply-chain pre-clearance.
- **Tabs.tsx shipped as built.** Reviewed against 50-UI-SPEC §Tabs — already correct (`"use client"`, both variants, `--color-*`/`--text-*` tokens, `data-[state=active]` hook, explicit-id passthrough via last-spread, no raw hex/px, no `dangerouslySetInnerHTML`). No edits needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Tabs RED contract used a driver (`fireEvent`) that cannot activate Radix Tabs**
- **Found during:** Task 1
- **Issue:** The Wave-0 `Tabs.test.tsx` contract drove activation/keyboard with bare `fireEvent.click`/`fireEvent.keyDown`. Radix Tabs activates on real `mouseDown`/`focus` with a roving tabindex that does not settle synchronously under jsdom, so 4/6 asserts failed against a correct `Tabs.tsx`. This blocked turning the contract GREEN.
- **Fix:** Per the orchestrator's Option-A authorization — installed `@testing-library/user-event@14.6.1` (devDep, exact pin), added pointer-capture + `scrollIntoView` jsdom shims to `src/test-setup.ts`, and rewrote the 4 affected asserts to drive Radix with `userEvent.setup()` (`user.click` + `user.keyboard`). Intent preserved (keyboard a11y exercised, not dropped); roving-tabindex assertion strengthened to follow activation.
- **Files modified:** `src/components/ui/Tabs.test.tsx`, `src/test-setup.ts`, `package.json`, `package-lock.json`
- **Commit:** `0b9ed81b`

## Issues Encountered
None beyond the harness-driver mismatch documented above. `tsc --noEmit` is clean (0 errors); `npm run lint` exits 0 (577 pre-existing warnings, 0 in the changed files). The full `src/components/ui/` suite is green (11 files / 59 tests); the three new-primitive contracts pass together (14 tests).

## Threat Surface
- **T-50-SC (supply chain):** `@radix-ui/react-tabs@1.1.15` was legitimacy-gated + exact-pinned in Plan 01 — this plan only imports it. `@testing-library/user-event@14.6.1` is a NEW devDependency added this plan; it was orchestrator-pre-cleared (official testing-library org, same org as the already-installed `@testing-library/react`/`jest-dom`, MIT, no postinstall, ~30M wk downloads, not on the banned list) and exact-pinned. Test-only — it ships nothing to the client bundle.
- **T-50-04 (XSS / HTML injection):** upheld — Tabs/Table/Field render all cell/label/hint/error content as escaped React children; no `dangerouslySetInnerHTML` and no `innerHTML` sink anywhere in the three new files (verified). Table/Field import no `@radix-ui` (UI-04). No new threat surface introduced (presentation-layer primitives).

## User Setup Required
None — `@testing-library/user-event` is a devDependency installed via the committed `package.json`/`package-lock.json`; no external service or secret.

## Next Phase Readiness
- The toolkit is complete: Tabs (Radix, the only one), Table, and Field exist and pass their Wave-0 contracts. Ready for Wave-2:
  - **Plan 50-05** (Tabs 3→1 consolidation) — the explicit-id passthrough is in place so WatchlistTabs can preserve the `idBase`/`panelId` ids the external `StrategyTable` `role="tabpanel"` resolves (Pitfall 1).
  - **Plan 50-06** (StrategyTable dense reshape) builds on the `Table` base + `ResponsiveTable`.
  - **Plan 50-07** (strangler pilot) consumes Button + Table + Field together.
- UI-04 held: Tabs is the only Radix primitive; Table/Field are semantic/native HTML; Modal/Select stay native (untouched here).
- The Radix-in-jsdom test harness (user-event + shims) is reusable for any future Radix widget.

## Self-Check: PASSED

- SUMMARY.md created and present.
- All 3 primitive sources present: `Tabs.tsx`, `Table.tsx`, `Field.tsx`.
- All 3 task commits present in git log: `0b9ed81b` (Tabs), `ac81d549` (Table), `4f75050a` (Field).
- Tabs contract 6/6 GREEN; full `src/components/ui/` suite 59/59 GREEN; `tsc --noEmit` 0 errors; `npm run lint` exit 0.

---
*Phase: 50-primitive-refresh-missing-primitives*
*Completed: 2026-06-29*

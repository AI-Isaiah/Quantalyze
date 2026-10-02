---
phase: 50-primitive-refresh-missing-primitives
plan: 05
subsystem: ui-primitives
tags: [tabs, radix, strangler-dedup, a11y, ui-02, ui-03]
requires:
  - "src/components/ui/Tabs.tsx (Wave 1 / Plan 50-03 — Radix-backed primitive with variant + explicit-id passthrough)"
  - "@testing-library/user-event@14.6.1 + src/test-setup.ts Radix jsdom shims"
provides:
  - "AdminTabs / ProfileTabs / WatchlistTabs all render through the ONE canonical Tabs primitive (3 hand-rolled impls -> 1)"
  - "WatchlistTabs preserves the imperative idBase/panelId contract the external StrategyTable role=tabpanel resolves against"
affects:
  - "src/components/admin/AdminTabs.tsx"
  - "src/components/auth/ProfileTabs.tsx"
  - "src/components/strategy/WatchlistTabs.tsx"
  - "src/components/strategy/StrategyTable.test.tsx (test driver port only — source untouched)"
tech-stack:
  added: []
  patterns:
    - "Radix Tabs activates on the real pointer/keyboard sequence — drive consumer tests with @testing-library/user-event, not bare fireEvent"
    - "Explicit id + aria-controls passed to TabsTrigger win over Radix auto-ids (spread last) — preserves an external-panel id contract"
    - "loop={false} on Tabs.List preserves no-wrap-around arrow behavior"
key-files:
  created: []
  modified:
    - "src/components/admin/AdminTabs.tsx"
    - "src/components/admin/AdminTabs.test.tsx"
    - "src/components/auth/ProfileTabs.tsx"
    - "src/components/auth/ProfileTabs.test.tsx"
    - "src/components/strategy/WatchlistTabs.tsx"
    - "src/components/strategy/WatchlistTabs.test.tsx"
    - "src/components/strategy/StrategyTable.test.tsx"
decisions:
  - "Used RESEARCH Q1 option (a): preserve WatchlistTabs' imperative idBase/panelId contract via explicit id+aria-controls passthrough. StrategyTable.tsx source NOT edited (Plan 50-06 owns it)."
  - "Ported keyboard/click test drivers from bare fireEvent to user-event (Radix requirement) — mechanical, test intent preserved, not a softening."
  - "Added loop={false} to WatchlistTabs' Tabs.List to keep the prior no-wrap-around arrow behavior byte-faithful."
metrics:
  duration: "~25 min"
  tasks_completed: 3
  files_modified: 7
  completed: 2026-06-29
---

# Phase 50 Plan 05: Consolidate 3 hand-rolled Tabs onto the canonical Tabs primitive Summary

The 3 inconsistent hand-rolled tab implementations (AdminTabs / ProfileTabs / WatchlistTabs — each re-rolling its own roving-tabindex + arrow-key handler) now render 1:1 through the ONE Radix-backed `Tabs` primitive, with every consumer's behavior byte-faithful and all ported tests green — including the highest-risk WatchlistTabs port whose external StrategyTable `role="tabpanel"` id contract is preserved intact.

## What Shipped

- **Task 1 — AdminTabs (underline):** hand-rolled strip + keydown handler replaced with `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` (underline variant). Local `useState<Tab>` wired to Radix `value`/`onValueChange` (no behavior change). 5 tab bodies became `TabsContent` panels. Count pill preserved, refreshed `text-[10px]` -> `text-micro`. Modal flows unchanged. Commit `a61c19da`.
- **Task 2 — ProfileTabs (underline, URL-controlled):** strip replaced with the primitive; Radix `value={activeTab}` still derived EACH render from `parseTabParam(searchParams.get("tab"), isAllocator)` — the IN-06 fix preserved, no `useState` snapshot reintroduced. `onValueChange={setActiveTab}` keeps the `router.replace ?tab=` handler. allocatorOnly gating + the exact active treatment (`text-text-primary` active, `hover:text-text-secondary`, `py-2.5`) preserved via a `className` override. Now-unused `cn` import dropped. Commit `8dd0009d`.
- **Task 3 — WatchlistTabs (segmented, HIGHEST RISK):** strip replaced with the segmented primitive while preserving the imperative id contract (explicit `${idBase}-tab-all`/`${idBase}-tab-watchlist` ids + `aria-controls={panelId}`) so the EXTERNAL StrategyTable panel's `aria-labelledby` still resolves. `loop={false}` keeps the prior no-wrap-around. Controlled via `scope`/`onScopeChange`; `aria-label`, count badge testid, automatic activation all preserved. **StrategyTable.tsx source NOT touched** (RESEARCH option (a)). Commit `57991d4f`.

## The Two RESEARCH Pitfalls — How They Were Handled

- **Pitfall 1 (WatchlistTabs external-panel id contract):** Resolved with RESEARCH Q1 option (a). The primitive's `TabsTrigger` spreads props last, so an explicit `id` and `aria-controls={panelId}` override Radix's auto-generated ids. The panel stays in StrategyTable (not lifted into `Tabs.Content`), so no StrategyTable.tsx source edit and no Plan-50-06 coordination needed. `WatchlistTabs.test.tsx` pins (`allTab.id === "abc123-tab-all"`, `aria-controls === panelId`) all pass; `StrategyTable.test.tsx` stays green.
- **Pitfall 2 (ProfileTabs `getByRole("button")`):** Radix triggers are `role="tab"`. Every tab-trigger `getByRole("button")` / `getAllByRole("button")` / `queryByRole("button")` mechanically ported to `"tab"`. The in-panel "Download audit log CSV" control is a real `<button>` and correctly stays `role="button"`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Radix Tabs requires user-event, not bare fireEvent, to activate triggers**
- **Found during:** Tasks 1, 2, 3 (and the StrategyTable.test.tsx fallout from Task 3)
- **Issue:** The existing consumer tests drive tab switching with `fireEvent.click(...)` / `fireEvent.keyDown(...)`. Radix Tabs activates on the full pointer/keyboard event sequence (mousedown/pointer + roving focus), which bare `fireEvent` does not produce — so clicks/arrows did not flip the active tab and the panel/scope-switch assertions failed. This is the exact driver issue the wave_state + RESEARCH flagged (the reason 50-03's contract and Tabs.test.tsx already use user-event).
- **Fix:** Ported the tab-switching clicks/arrows in AdminTabs.test.tsx, WatchlistTabs.test.tsx, and StrategyTable.test.tsx Cases 5/6 to `@testing-library/user-event`. In-panel control clicks (Reject buttons, star toggle) stayed `fireEvent` — they are plain buttons, not Radix triggers. Test INTENT preserved (clicking a tab reveals its panel / switches scope); no assertion softened.
- **Files modified:** AdminTabs.test.tsx, WatchlistTabs.test.tsx, StrategyTable.test.tsx
- **Commits:** `a61c19da`, `57991d4f`

**2. [Rule 1 - Behavior parity] Radix roving-focus default loop=true would change WatchlistTabs arrow behavior**
- **Found during:** Task 3
- **Issue:** The hand-rolled WatchlistTabs had NO wrap-around (ArrowLeft on All / ArrowRight on Watchlist were no-ops). Radix's roving-focus defaults `loop=true`, which would wrap arrow nav around the ends — a behavior change that also breaks the two no-op tests.
- **Fix:** Passed `loop={false}` to the segmented `Tabs.List` to keep the prior no-wrap behavior byte-faithful.
- **Files modified:** WatchlistTabs.tsx
- **Commit:** `57991d4f`

**3. [Rule 1 - Behavior parity] Radix commits roving tabindex on focus-entry, not eagerly on render**
- **Found during:** Task 3
- **Issue:** The original WatchlistTabs set `tabIndex={scope === active ? 0 : -1}` eagerly as a static attribute. Radix's roving-focus initializes all items to `-1` and commits the active item to `0` when focus enters the tablist (the WAI-ARIA-correct pattern). The two static-snapshot roving-tabindex tests asserted the eager attribute.
- **Fix:** Ported the two roving-tabindex tests to assert the SETTLED contract after a real `user.tab()` (the same pattern the Tabs primitive's own spec uses). End-state contract is identical: the active tab is the single Tab-reachable stop, the inactive is `-1` — driven off the controlled `scope` value. No a11y regression; behavior is byte-faithful in lived use.
- **Files modified:** WatchlistTabs.test.tsx
- **Commit:** `57991d4f`

## Verification

- `npx vitest run src/components/admin/AdminTabs.test.tsx src/components/auth/ProfileTabs.test.tsx src/components/strategy/WatchlistTabs.test.tsx src/components/strategy/StrategyTable.test.tsx` -> **50 passed** (matching baseline count).
- Broader regression (Tabs primitive spec + all of `src/components/admin/` + the consumers): **12 files / 88 tests passed**.
- `npx tsc --noEmit` -> project-wide clean.
- `npx eslint` on all 7 modified files -> 0 errors. (6 pre-existing `no-raw-font-px` warnings in untouched AdminTabs body functions — out of scope; the migration actually removed one such raw-px usage via the `text-[10px]` -> `text-micro` count-pill refresh.)
- 3 consumers import `@/components/ui/Tabs`; **zero** hand-rolled tab keydown handlers remain.
- ProfileTabs.test.tsx: zero `getByRole("button")` for tab triggers (the one remaining is the in-panel Download-CSV button).
- WatchlistTabs id/aria-controls assertions intact; StrategyTable.tsx source unmodified (option (a)).

## Notes for Downstream

- **Plan 50-06 (StrategyTable reshape):** WatchlistTabs now passes explicit `id`/`aria-controls` into the Tabs primitive; the StrategyTable external `role="tabpanel"` + `aria-labelledby` block (StrategyTable.tsx:384-394) is unchanged and still resolves. No coordination debt incurred.
- **Wave-merge gate:** `npm run test:coverage` (full + coverage, 82/80/74/72) should be run at wave merge per the plan's `<verification>` — not run here (per-task scope), flagged for the orchestrator's wave-merge step. The new tests added (no net lines removed from coverage) only strengthen the ratchet.
- **Coverage ratchet (BP-03):** every test rewrite shipped in the same commit as its source migration; no coverage gap introduced.

## Self-Check: PASSED

All 7 modified source/test files exist on disk; the SUMMARY exists; all 3 task commits (`a61c19da`, `8dd0009d`, `57991d4f`) are present in git history.

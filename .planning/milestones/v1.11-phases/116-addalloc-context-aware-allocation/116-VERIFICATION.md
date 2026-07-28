---
phase: 116-addalloc-context-aware-allocation
verified: 2026-07-18T10:16:00Z
status: passed
score: 9/9 must-haves verified (code-level) + browser-validated 2026-07-18 (orchestrator, localhost:3000)
re_verification:
  previous_status: human_needed
  note: "Browser validation performed by orchestrator on localhost:3000 dev server. CONFIRMED: (1) Overview '+ Allocation' opens the real ContributionWizardOverlay (Connect Your Strategy wizard, API-key/CSV toggle, 5 steps) inline over a dimmed page, URL stays /allocations (no nav-to-scenario — the founder's original bug is fixed); (2) Scenario tab button reads '+ Strategy' and opens the real StrategyBrowseDrawer (Browse strategies picker, published+own, Add buttons); (3) context-aware aria-label correct ('Add allocation — connect an exchange or upload a CSV'). ADDALLOC-04 (/profile?tab=exchanges href+copy) accepted on code+regression-test evidence (static link swap, low browser risk) — not separately clicked."
human_verification:
  - test: "On My Allocation (Overview and Holdings tabs), click the '+ Allocation' header button."
    expected: "The real ContributionWizardOverlay opens inline over the current surface (Connect-a-key / upload-CSV onboarding) — no navigation, no tab change. On close, keyboard focus lands back on the '+ Allocation' button."
    why_human: "Unit tests mock ContributionWizardOverlay to a marker stub (to keep WizardClient out of jsdom). The wiring is proven, but that the REAL overlay mounts/renders/focuses in a browser is a visual + interaction concern grep cannot confirm. SUMMARY explicitly flags 'Not browser-verified'."
  - test: "On the Scenario tab, confirm the header button reads '+ Strategy' and click it."
    expected: "The real StrategyBrowseDrawer opens (others' published + own private contributions, with the 'Add your own' upload escape hatch). Closing it via the header-initiated open returns focus to the '+ Strategy' button."
    why_human: "ScenarioComposer/StrategyBrowseDrawer are stubbed in the host wiring tests; the live drawer render + focus-return is a browser interaction not machine-verified here."
  - test: "As an allocator with zero portfolios, open the Simulate-Impact / Diversification Optimizer card and click 'Connect Exchange →'."
    expected: "Navigates to /profile?tab=exchanges (the connect-exchange onboarding) — NOT a redirect()-bounce off manager-only /portfolios. Copy reads 'Simulate Impact needs a live portfolio' with neutral (non-red/amber) voice and a secondary (non-accent) button."
    why_human: "The href + copy + secondary treatment are unit-pinned, but the end-to-end allocator navigation landing (no ROLE-02 bounce) is a live-role flow best confirmed in the browser."
---

# Phase 116: ADDALLOC — Context-Aware "+ Allocation" Verification Report

**Phase Goal:** "+ Allocation" performs a deterministic, context-aware action per tab, and the zero-portfolio Simulate-Impact dead-end is fixed.
**Verified:** 2026-07-18T10:16:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | On Holdings/Overview, header reads "+ Allocation" and click opens ContributionWizardOverlay inline — no navigation, no tab change | ✓ VERIFIED | `AllocationsTabs.tsx:878` label binary; `:571` else-branch `setContributeOpen(true)`; tab-agnostic host mount `:980-984`; tests T_ADDALLOC_1/2 assert overlay stub opens + `router.replace` never called with tab=scenario |
| 2 | On Scenario, header reads "+ Strategy" and click opens StrategyBrowseDrawer (published + own private + "Add your own") | ✓ VERIFIED | Composer registration effect `ScenarioComposer.tsx:1800-1805` (`openBrowse = () => setBrowseOpen(true)`); host dispatch `AllocationsTabs.tsx:560-567`; both drawer mounts drive `browseOpen`; tests T_ADDALLOC_3/S1/S2 green |
| 3 | Aria-label states the real per-tab action; stale "Add allocation — open Scenario tab" mislabel gone repo-wide | ✓ VERIFIED | `AllocationsTabs.tsx:872-876` per-tab aria strings; `grep -rn "open Scenario tab" src/ e2e/` = 0 |
| 4 | Closing a header-triggered overlay returns focus to the header button | ✓ VERIFIED | `handleContributeClose`/`handleContributeSuccess` `:527-539` call `addButtonRef.current?.focus()`; `handleBrowseClosed :511-516` focuses only when `headerBrowseTriggeredRef` set; tests T_ADDALLOC_4/S4 |
| 5 | Button never silently no-ops on any tab, never opens a dropdown/menu (incl. dynamic-import window + isUiV2=false) | ✓ VERIFIED | Binary dispatch `:546-572`; pending-drain `:503-509` + `:563-566`; isUiV2=false opens wizard `:550-558` (not a no-op changeTab); no `role="menu"` added (grep hit was the word "dropdown" in a NOT-a-dropdown comment); test T_ADDALLOC_S3 drains late registration |
| 6 | ADDALLOC-04: zero-portfolio OptimizerPanel hrefs /profile?tab=exchanges (NOT /portfolios), honest copy, secondary button | ✓ VERIFIED | `OptimizerPanel.tsx:107` href; `:108` secondary className (border-border bg-white, not bg-accent); copy `:100,:103`; test pins href + `not.toContain("bg-accent")` + `/Create portfolio/` null |
| 7 | No allocator-facing /portfolios link remains in OptimizerPanel (ROLE-02 dead-end gone) | ✓ VERIFIED | `grep '/portfolios'` OptimizerPanel = 1 hit, which is a code COMMENT (`:24 /portfolios/[id] ordering`), not a link; `href="/portfolios"` count = 0 |
| 8 | scenario.ts byte-frozen; ContributionWizardOverlay byte-unmodified; onAddOwn handlers byte-unchanged | ✓ VERIFIED | `git diff origin/main -- src/lib/scenario.ts` exit 0; ContributionWizardOverlay diff empty; onAddOwn diff shows only a comment mention, both handler bodies (`setBrowseOpen(false); setContributeOpen(true)`) unchanged at `:3664` and `:4923` |
| 9 | Zero new design tokens; additive-only composer seam | ✓ VERIFIED | Header button reuses existing bg-accent className; OptimizerPanel reuses pre-existing secondary string; composer props `onRegisterOpenBrowse`/`onBrowseClosed` optional, +42/-2 lines, no engine touch |

**Score:** 9/9 truths verified at code level.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `AllocationsTabs.tsx` | Per-tab dispatch + tab-level ContributionWizardOverlay host + focus-return | ✓ VERIFIED | Static import `:31`, mount `:980`, dispatch `:547`, refs+handlers `:486-572` |
| `ScenarioComposer.tsx` | Additive onRegisterOpenBrowse/onBrowseClosed seam | ✓ VERIFIED | Props `:353,:360`, registration `:1800-1805`, both onClose fire `onBrowseClosed?.()` |
| `AllocationsTabs.addalloc.test.tsx` | Wiring tests (dispatch, overlay open, focus, drain) | ✓ VERIFIED | 442 lines, 9 substantive tests (T_ADDALLOC_1-5, S1-S4) all green |
| `OptimizerPanel.tsx` | Honest zero-portfolio remedy → /profile?tab=exchanges | ✓ VERIFIED | href `:107`, secondary treatment, locked copy |
| `OptimizerPanel.test.tsx` | Intent test pinning new href + copy + secondary | ✓ VERIFIED | Pins href, border-border, not bg-accent, /Create portfolio null, keeps no-mount assertion |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| AllocationsTabs.tsx | ContributionWizardOverlay | contributeOpen state + isOpen prop | ✓ WIRED | `:981` isOpen={contributeOpen}, opened by handleHeaderAdd |
| AllocationsTabs.tsx | ScenarioComposer | onRegisterOpenBrowse threaded via ScenarioTabContent | ✓ WIRED | host `:960` → ScenarioTabContent `:1010-1015` → composer `:1121` |
| ScenarioComposer.tsx | StrategyBrowseDrawer | registered open fn calls setBrowseOpen(true) | ✓ WIRED | `:1803` openBrowse; both drawers driven by browseOpen |
| OptimizerPanel.tsx | /profile?tab=exchanges | next/link href in 0-portfolio gate | ✓ WIRED | `:107` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase 116 touched suites | vitest run (addalloc, scenario-composer, ScenarioComposer, OptimizerPanel) | 237 passed | ✓ PASS |
| Pre-existing AllocationsTabs regression suites | vitest run (test, onboarding, state-preservation, save) | 79 passed | ✓ PASS |
| Typecheck | npx tsc --noEmit | exit 0, 0 errors | ✓ PASS |
| Mislabel gate | grep -rn "open Scenario tab" src/ e2e/ | 0 hits | ✓ PASS |
| Engine freeze | git diff origin/main -- src/lib/scenario.ts | exit 0 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ADDALLOC-01 | 116-01 | Scenario "+ Strategy" opens strategy picker | ✓ SATISFIED | Registration seam + host dispatch + tests |
| ADDALLOC-02 | 116-01 | Holdings/Overview "+ Allocation" opens onboarding inline | ✓ SATISFIED | Tab-level overlay host + tests |
| ADDALLOC-03 | 116-01 | Deterministic per-tab action, no silent no-op, no dropdown | ✓ SATISFIED | Binary dispatch + pending-drain + isUiV2 remedy |
| ADDALLOC-04 | 116-02 | Zero-portfolio Simulate-Impact deep-links connect-exchange | ✓ SATISFIED | OptimizerPanel href swap + lockstep test |

All four requirement IDs from PLAN frontmatter are present in REQUIREMENTS.md (`:54-57`) and satisfied. No orphaned requirements for Phase 116.

### Anti-Patterns Found

None. No TODO/FIXME/XXX debt markers introduced; no stub returns; no hardcoded-empty data flowing to render. The one `role="menu"`/"dropdown" grep hit is a comment asserting the button is NOT a dropdown.

### Human Verification Required

The header-button wiring is fully proven by unit tests, tsc, and grep gates, but the tests deliberately STUB the real overlays (ContributionWizardOverlay, StrategyBrowseDrawer, ScenarioComposer) to keep heavy clients out of jsdom. Live browser confirmation of the three user flows is therefore still required (SUMMARY itself flags "Not browser-verified"):

1. **"+ Allocation" opens the real wizard inline (Overview/Holdings)** — click, confirm overlay mounts with no navigation, and focus returns to the button on close.
2. **"+ Strategy" opens the real StrategyBrowseDrawer (Scenario)** — confirm label reads "+ Strategy", drawer opens, focus returns on header-initiated close.
3. **Zero-portfolio "Connect Exchange →" lands on /profile?tab=exchanges** — confirm no ROLE-02 redirect bounce and the honest, non-accent copy.

### Gaps Summary

No gaps. All 9 observable truths, all 5 artifacts, all 4 key links, all 4 requirements, and every invariant (scenario.ts freeze, ContributionWizardOverlay byte-freeze, onAddOwn unchanged, mislabel grep 0, no new tokens, no dropdown) are verified in the codebase. Full test suite (316 tests across 8 allocations suites), tsc, and grep gates are green. Status is `human_needed` solely because the live-browser rendering/focus/navigation of the reused overlays is a visual + role-flow concern the stub-based unit tests cannot assert — not because of any code defect.

---

_Verified: 2026-07-18T10:16:00Z_
_Verifier: Claude (gsd-verifier)_

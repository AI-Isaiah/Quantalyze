---
phase: 11-onboarding-and-security-readiness
plan: 05
subsystem: allocator-dashboard-onboarding
tags:
  - onboarding
  - mandate-quick-set
  - sessionStorage-dismissal
  - block-2-reconciliation
  - phase02-d09-locked
requires:
  - "src/lib/queries.ts (existing MyAllocationDashboardPayload)"
  - "src/components/ui/WarningBanner.tsx (S1 base primitive)"
  - "src/components/ui/Card.tsx (S2 base primitive)"
  - "src/app/api/preferences/route.ts (PUT — existing per-field RPC route)"
  - "src/lib/preferences.ts (AllocatorPreferences shape)"
  - "src/lib/constants.ts (STRATEGY_TYPES union)"
provides:
  - "MyAllocationDashboardPayload.apiKeysCount: number (D-02 server-side count)"
  - "MyAllocationDashboardPayload.mandateIsSet: boolean (D-04 derived from mandate)"
  - "deriveMandateIsSet(mandate) — pure helper exported from queries.ts (W-02 unit-tested)"
  - "OnboardingBanner.tsx — S1 client component with verbatim §S1 copy + sessionStorage dismissal"
  - "MandateQuickSetCard.tsx — S2 client component with BLOCK-2 reconciled empty input + helper-text suggestion + Save-disabled-until-typed gate"
  - "AllocationsTabs renders S1 + S2 above existing tab nav when apiKeysCount === 0"
affects:
  - "src/app/(dashboard)/allocations/page.tsx (transitively — gets the two new payload fields via SSR fetch)"
tech-stack:
  added: []
  patterns:
    - "SSR-render-then-hide-after-mount (RESEARCH Pitfall 6 + 8) — server emits banner/card unconditionally; client effect reads sessionStorage and hides via state update (no CLS)"
    - "Per-field PUT to /api/preferences with body `{ [field]: value }` (matches useMandateAutoSave.ts:90 contract — NOT POST/{field, value})"
    - "Set-state-in-effect with eslint-disable block + AllocationsTabs.tsx loadUiV2Flag precedent for bounded one-shot sessionStorage reads"
key-files:
  created:
    - "src/lib/queries.mandateIsSet.test.ts"
    - "src/app/(dashboard)/allocations/components/OnboardingBanner.tsx"
    - "src/app/(dashboard)/allocations/components/OnboardingBanner.test.tsx"
    - "src/app/(dashboard)/allocations/components/MandateQuickSetCard.tsx"
    - "src/app/(dashboard)/allocations/components/MandateQuickSetCard.test.tsx"
    - "src/app/(dashboard)/allocations/AllocationsTabs.onboarding.test.tsx"
  modified:
    - "src/lib/queries.ts (added apiKeysCount + mandateIsSet fields to payload, deriveMandateIsSet helper, count query in parallel fetch, both return branches)"
    - "src/app/(dashboard)/allocations/AllocationsTabs.tsx (additive S1 + S2 render block above tab nav; existing tab logic untouched)"
    - "src/app/(dashboard)/allocations/AllocationsTabs.test.tsx (STUB_PROPS gains apiKeysCount + mandateIsSet)"
    - "src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx (STUB gains apiKeysCount + mandateIsSet)"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx (basePayload gains apiKeysCount + mandateIsSet)"
decisions:
  - "BLOCK-2 reconciliation: max_weight input renders with value=\"\" and placeholder=\"e.g. 15\" on first paint (Phase 02 D-09 LOCKED satisfied — no default pre-fill); helper text below the input reads \"Suggested: 15%. ...\" (Phase 11 D-04 satisfied — suggestion is visible); Save button is disabled while the input is empty (no silent default save). Both decisions are honored without contradiction."
  - "PUT /api/preferences (not POST) with body `{ [field]: value }` matches the actual existing route shape — the plan's `{field, value}` POST hint was incorrect; we used the actual contract per useMandateAutoSave.ts:90."
  - "deriveMandateIsSet extracted as a pure helper so the W-02 truth table is unit-testable without spinning up the full getMyAllocationDashboard fetch (per W-02 reviewer guidance)."
  - "apiKeysCount sourced from a head-only count query on api_keys via the user-scoped Supabase client (D-02 LOCKED — RLS-scoped, no localStorage)."
  - "sessionStorage flag (per-tab) for both S1 and S2 dismissals (D-03 LOCKED — re-surfaces on next page load until the first key connects)."
metrics:
  duration: "~31 minutes"
  completed: "2026-04-26T19:40:13Z"
  task_count: 3
  file_count: 11
  test_count: 37
---

# Phase 11 Plan 05: Onboarding Nudge (Banner + Mandate Quick-Set) Summary

**One-liner:** Ships the proactive onboarding surface (warning banner + mandate quick-set card) above `/allocations` tabs for brand-new allocators with zero connected exchange API keys, with the BLOCK-2 reconciliation honoring both Phase 02 D-09 LOCKED (fields blank/NULL on first-visit render) and Phase 11 D-04 (suggested-value display) by rendering an empty input with placeholder, helper-text suggestion, and a Save button gated on a typed value.

## Scope

ONBOARD-01 (banner CTA → /profile?tab=exchanges) + ONBOARD-02 (inline mandate quick-set card) for brand-new allocators landing on /allocations with zero connected api_keys rows. Server-rendered visibility predicate based on apiKeysCount (D-02), per-tab sessionStorage dismissals (D-03), explicit Save action (no silent default save — Phase 02 D-09 LOCKED), and a clean hide once the first key connects.

## Implementation

### Task 1 — MyAllocationDashboardPayload extension + W-02 unit suite

**Commit:** `15b9e85`

- Added `apiKeysCount: number` (server-side count via the user-scoped Supabase client — `from("api_keys").select("id", { count: "exact", head: true }).eq("user_id", userId)`). Coalesces null count to 0 so the fail-safe is "show onboarding nudge".
- Added `mandateIsSet: boolean` derived via the new pure helper `deriveMandateIsSet(mandate)` — true when `mandate !== null && (max_weight !== null || preferred_strategy_types?.length > 0)`. The 0-as-valid edge case (saved zero) is treated as set, only `null` means unset.
- Added the parallel fetch as a new branch in the existing `Promise.all` that lifts portfolio + equity + holdings + api_keys + mandate; the count query is a separate head-only round-trip so the integer is small over the wire and resilient to future projection changes on the apiKeys array.
- Both return branches of `getMyAllocationDashboard` (the `!portfolio` no-real-data branch and the full-dashboard branch) emit the two new fields.
- Updated three pre-existing test fixtures (AllocationsTabs.test, AllocationsTabs.scenario-composer.test, ScenarioComposer.test) to include the two new payload fields so typecheck passes.

**W-02 unit test (`queries.mandateIsSet.test.ts`)** — 8 tests covering the 4-case truth table:
1. mandate row missing → false
2a. both fields null → false
2b. max_weight null + preferred_strategy_types empty array → false
3a. max_weight 0.15 + preferred_strategy_types null → true
3b. max_weight 0.20 + preferred_strategy_types empty → true
4a. max_weight null + preferred_strategy_types ["Long-Only"] → true
4b. max_weight 0 (saved-zero edge case) → true
5. Both fields set → true

The test file stubs `@/lib/supabase/server` and `@/lib/supabase/admin` to bypass the `server-only` import (mirrors the existing `queries.test.ts` mock scaffolding).

### Task 2 — OnboardingBanner (S1) + MandateQuickSetCard (S2) — TDD RED → GREEN

**RED commit:** `3225152`
**GREEN commit:** `9cbd454`

**OnboardingBanner.tsx** — composes `<WarningBanner className="border-l-4 border-warning bg-warning/5">` per UI-SPEC AC #14 (no new wrapper component). Renders verbatim §S1 copy:
- Heading: "Connect your exchange to see real performance"
- Body: "Add a read-only API key — we'll pull your real holdings within one sync cycle and populate Performance, Bridge, and Scenario."
- CTA: real `<a href="/profile?tab=exchanges">` (semantic, not a button) with text "Connect Exchange →"
- Dismiss: × button with `aria-label="Dismiss for this session"` and 32×32 visible target + 44×44 hit area via `before:absolute before:inset-[-6px]`

`useEffect` reads `sessionStorage["allocations.onboarding_banner_dismissed"]` post-mount (RESEARCH Pitfall 6 — SSR-safe). Server renders the banner unconditionally; client may HIDE via state update — no CLS. Click on dismiss writes the flag and hides immediately.

**MandateQuickSetCard.tsx** — composes `<Card padding="md">` per UI-SPEC AC #15 (no padding override). Renders verbatim §S2 copy.

**BLOCK-2 reconciliation invariant — the critical Phase 02 D-09 + Phase 11 D-04 resolution:**
- Input element: `useState<string>("")` (empty string — NOT pre-filled with "15"). `<input value={maxWeightPct} placeholder="e.g. 15">` on first paint. Phase 02 D-09 LOCKED satisfied — no default pre-fill in the value attribute.
- Helper text: "Suggested: 15%. The Bridge flags any holding that exceeds this share of your portfolio." — Phase 11 D-04 satisfied — the suggestion is visible to the user without being silently submitted.
- Save button: `disabled={isSaveDisabled}` where `isSaveDisabled = saving || maxWeightPct.trim() === ""`. The user MUST type a value (any value) to enable Save.
- Clearing the input back to empty re-disables Save. There is no path to fire the RPC with an empty value.

Saving fires `PUT /api/preferences` with body `{ max_weight: 0.15 }` (per-field shape — matches the existing useMandateAutoSave.ts:90 contract). If preferred strategy chips are toggled, a second PUT with `{ preferred_strategy_types: [...] }` follows.

`useEffect` reads `sessionStorage["allocations.mandate_card_dismissed"]` post-mount and may hide. Skip writes the flag and hides immediately.

**Test count:** 9 banner tests + 16 card tests (including BLOCK-2 sub-tests 7a/7b/7c/7d) = 25 tests.

### Task 3 — Wire S1 + S2 above tabs

**Commit:** `297a3a7`

Added `showOnboardingBanner = props.apiKeysCount === 0` and `showMandateQuickSet = props.apiKeysCount === 0 && !props.mandateIsSet` predicates. The render block lives inside `<TweaksProvider>` just before the existing header row; existing tab logic, dynamic loaders, and tab body content are completely untouched (additive nudge surface only).

**Layout:**
- Page top → `<OnboardingBanner />` → `mt-3` gap → `<MandateQuickSetCard />` → `mb-6` gap → existing tab nav → tab body.

**Integration test (`AllocationsTabs.onboarding.test.tsx`)** — 4 tests covering the visibility truth table:
- apiKeysCount=0, mandateIsSet=false → both render
- apiKeysCount=0, mandateIsSet=true → banner only
- apiKeysCount=1, mandateIsSet=false → neither
- apiKeysCount=5, mandateIsSet=true → neither

## BLOCK-2 Reconciliation Outcome

The plan called out the apparent tension between Phase 02 D-09 LOCKED ("First-visit render: all mandate fields blank/NULL. No default pre-fill") and Phase 11 D-04 ("pre-populates SUGGESTED values"). The implemented resolution honors both:

| Decision | Test of the implementation |
|----------|---------------------------|
| Phase 02 D-09 LOCKED | `<input value="">` with `placeholder="e.g. 15"`. Test 7a: Save disabled on first render. Test 6: NO fetch on mount. |
| Phase 11 D-04 (suggestion display) | Helper text reads "Suggested: 15%. The Bridge flags any holding that exceeds this share of your portfolio." — visible below the input. |
| No silent default save | `disabled={isSaveDisabled}` where `isSaveDisabled = saving \|\| maxWeightPct.trim() === ""`. Test 7c verifies clearing the input re-disables Save. |
| Save fires user-typed value | Test 7d: typing "15" + Save → PUT /api/preferences with `{ max_weight: 0.15 }`. |

## /api/preferences Route Reuse (No New Route)

The card reuses the existing `PUT /api/preferences` route from Phase 02. The route accepts a body of shape `{ [field]: value }` (e.g. `{ max_weight: 0.15 }`), runs CSRF + rate-limit + zod validation upstream, and calls `update_allocator_mandates` RPC server-side. The plan text mentioned `POST /api/preferences` with `{ field, value }` — this was incorrect; the actual route is PUT and uses the field-as-key shape (verified against useMandateAutoSave.ts:90 and route.ts:91-93). The component implements the actual contract.

## Verification Status

| Gate | Status | Evidence |
|------|--------|----------|
| W-02 unit (queries.mandateIsSet.test.ts) | PASSED | 8/8 green |
| OnboardingBanner.test.tsx | PASSED | 9/9 green |
| MandateQuickSetCard.test.tsx | PASSED | 16/16 green (incl. BLOCK-2 7a/7b/7c/7d) |
| AllocationsTabs.onboarding.test.tsx | PASSED | 4/4 green |
| Existing AllocationsTabs.test.tsx | PASSED | unchanged (STUB_PROPS extended) |
| Full allocations test sweep (53 files / 629 tests) | PASSED | 0 regressions |
| `npm run typecheck` | PASSED | 0 errors |
| `npm run lint` | PASSED | 0 errors (31 pre-existing warnings unchanged) |
| `npm run build` | PASSED | static + dynamic pages compiled |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan called out POST /api/preferences with `{field, value}` body shape**
- **Found during:** Task 2 (when wiring the Save handler)
- **Issue:** The plan's plan-spec for the Save handler said `fetch('/api/preferences', { method: 'POST', body: JSON.stringify({ field, value }) })`. The actual existing route in `src/app/api/preferences/route.ts` is `PUT`, and it accepts a body with the field name as the JSON key (e.g. `{ max_weight: 0.15 }`). The existing useMandateAutoSave.ts:90 confirms the shape.
- **Fix:** Used the actual contract (PUT + `{ [field]: value }`). Tests assert this exact shape (Test 7d: `expect(init.method).toBe("PUT")`, `expect(body.max_weight).toBeCloseTo(0.15)`).
- **Files modified:** `src/app/(dashboard)/allocations/components/MandateQuickSetCard.tsx`, `src/app/(dashboard)/allocations/components/MandateQuickSetCard.test.tsx`
- **Commit:** `9cbd454`

**2. [Rule 1 - Bug] Test fixtures in 3 existing test files would have type-failed without the new payload fields**
- **Found during:** Task 1 (npm run typecheck)
- **Issue:** STUB_PROPS objects in AllocationsTabs.test.tsx, AllocationsTabs.scenario-composer.test.tsx, and ScenarioComposer.test.tsx are typed against `MyAllocationDashboardPayload`. Adding two new required fields to the interface broke typecheck on these fixtures.
- **Fix:** Appended `apiKeysCount` and `mandateIsSet` defaults (0/false in the empty fixture, 1/false where the fixture represents a connected allocator).
- **Files modified:** the three test files above.
- **Commit:** `15b9e85`

**3. [Rule 2 - Missing critical functionality] eslint react-hooks/set-state-in-effect blocked CI on new hooks**
- **Found during:** Task 3 (npm run lint)
- **Issue:** Both new components do a bounded one-shot `setState` from inside `useEffect` (read sessionStorage post-mount, hide if dismissed). Project lint config forbids set-state-in-effect by default.
- **Fix:** Added `/* eslint-disable react-hooks/set-state-in-effect */` enable/disable block around each effect — same precedent already applied in `AllocationsTabs.tsx` line 230-238 for the `loadUiV2Flag` rollback flag (matches the rationale: bounded one-shot post-mount read, useSyncExternalStore is overkill for a stable value).
- **Files modified:** `src/app/(dashboard)/allocations/components/OnboardingBanner.tsx`, `src/app/(dashboard)/allocations/components/MandateQuickSetCard.tsx`
- **Commit:** `297a3a7`

### Plan-Spec Mismatch (Documented)

The plan included an Input primitive `suffix="%"` prop hint. The actual `src/components/ui/Input.tsx` primitive does not accept a `suffix` prop. Resolution: rendered the `%` indicator as a sibling `<span aria-hidden>` in a flex row alongside the input. The input element preserves the project's chrome classes (min-h-[44px], rounded-lg, focus ring) inline so `getByLabelText("Maximum weight per holding")` resolves correctly.

### Confirmation: No Auto-Save (Phase 02 D-09 LOCKED)

Test 6 explicitly asserts `expect(fetchMock).not.toHaveBeenCalled()` after `render(<MandateQuickSetCard />)`. The component has NO `useEffect` that calls fetch on mount. The only path that fires `/api/preferences` is `handleSave`, gated behind `disabled={isSaveDisabled}`.

## Authentication Gates

None encountered — all 3 tasks executed without auth gates.

## Self-Check: PASSED

- [x] `src/lib/queries.ts` — apiKeysCount + mandateIsSet + deriveMandateIsSet present (15 occurrences)
- [x] `src/lib/queries.mandateIsSet.test.ts` — exists (1814 bytes), 8 tests green
- [x] `src/app/(dashboard)/allocations/components/OnboardingBanner.tsx` — exists, 9 tests green
- [x] `src/app/(dashboard)/allocations/components/OnboardingBanner.test.tsx` — exists
- [x] `src/app/(dashboard)/allocations/components/MandateQuickSetCard.tsx` — exists, 16 tests green
- [x] `src/app/(dashboard)/allocations/components/MandateQuickSetCard.test.tsx` — exists
- [x] `src/app/(dashboard)/allocations/AllocationsTabs.tsx` — modified (+S1/S2 render block, OnboardingBanner + MandateQuickSetCard imports)
- [x] `src/app/(dashboard)/allocations/AllocationsTabs.onboarding.test.tsx` — exists, 4 tests green
- [x] All 4 commits exist in `git log` (15b9e85, 3225152, 9cbd454, 297a3a7)
- [x] `npm run typecheck` exits 0
- [x] `npm run lint` exits 0
- [x] `npm run build` exits 0
- [x] BLOCK-2 grep gates pass: `useState<string>("")` count = 1, `useState<string>("15")` count = 0, `placeholder="e.g. 15"` present, `isSaveDisabled` present, `Suggested: 15%` helper text present

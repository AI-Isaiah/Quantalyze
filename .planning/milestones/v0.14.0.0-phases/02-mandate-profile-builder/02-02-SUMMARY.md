---
phase: 02-mandate-profile-builder
plan: 02
subsystem: frontend + e2e
requirements-completed: [MANDATE-01, MANDATE-02, MANDATE-03, MANDATE-04]
tags: [react, client-component, auto-save, aria-live, playwright, slider, chips, accordion]
requires:
  - "Plan 02-01 (migration 061 + update_allocator_mandates RPC + PUT /api/preferences rewire + mandate_edited_at column)"
  - "@testing-library/react v16.3.2 + @testing-library/jest-dom v6.9.1 (devDependencies)"
  - "DESIGN.md tokens exposed via src/app/globals.css @theme"
  - "STRATEGY_TYPES, SUBTYPES, EXCHANGES constants in src/lib/constants.ts"
provides:
  - "src/components/mandate/MandateForm.tsx — root client component (Card + Basics + Advanced accordion)"
  - "src/components/mandate/MandateSlider.tsx — slider with useRef-based 300ms keyboard debounce (W-09 fix)"
  - "src/components/mandate/MandateChipGroup.tsx — reusable multi-select (accent/negative variants)"
  - "src/components/mandate/MandateSegmentedRadio.tsx — 3-segment radiogroup for liquidity_preference"
  - "src/components/mandate/MandateAdvancedSection.tsx — collapsible accordion"
  - "src/components/mandate/MandateSaveStatus.tsx — form-level aria-live polite region (D-16 shape)"
  - "src/components/mandate/useMandateAutoSave.ts — per-form hook with 429 Retry-After + 5xx exponential backoff + generation-counter concurrency"
  - "src/components/mandate/formatRelativeTime.ts — pure util per UI-SPEC format"
  - "e2e/mandate-form.spec.ts — 4 Playwright scenarios, HAS_SEEDED_SUPABASE gated, per-test allocator provisioning"
affects:
  - "src/app/(dashboard)/preferences/page.tsx"
  - "src/components/preferences/PreferenceForm.tsx (DELETED)"
tech-stack:
  added: []
  patterns:
    - "Inline aria-live polite region in place of floating-toast library (D-16 shape preserved, no new dep)"
    - "Generation-counter ref for concurrent-save race safety (T-02-09 mitigation)"
    - "useRef-based keyboard debounce on sliders (W-09 fix — let inside component body would leak timers across re-renders)"
    - "Per-test allocator provisioning via admin.auth.admin.createUser (no shared seeded allocator)"
key-files:
  created:
    - "src/components/mandate/MandateForm.tsx"
    - "src/components/mandate/MandateSlider.tsx"
    - "src/components/mandate/MandateChipGroup.tsx"
    - "src/components/mandate/MandateSegmentedRadio.tsx"
    - "src/components/mandate/MandateAdvancedSection.tsx"
    - "src/components/mandate/MandateSaveStatus.tsx"
    - "src/components/mandate/useMandateAutoSave.ts"
    - "src/components/mandate/useMandateAutoSave.test.ts"
    - "src/components/mandate/formatRelativeTime.ts"
    - "src/components/mandate/formatRelativeTime.test.ts"
    - "src/components/mandate/MandateForm.test.tsx"
    - "src/components/mandate/MandateAdvanced.test.tsx"
    - "e2e/mandate-form.spec.ts"
  modified:
    - "src/app/(dashboard)/preferences/page.tsx"
  deleted:
    - "src/components/preferences/PreferenceForm.tsx"
decisions:
  - "Plan 02-02 (2026-04-18): D-16 'toast' reinterpreted as inline role='status' aria-live='polite' region inside MandateSaveStatus. UX shape preserved — 'Mandate saved' text briefly appears then reverts to the relative timestamp. No new dependency (no sonner, no react-hot-toast). Matches WizardChrome + OutcomeRecordedRow precedents."
  - "Plan 02-02 (2026-04-18): W-09 fix — MandateSlider keyboard debounce uses useRef<ReturnType<typeof setTimeout> | null>(null) at component top, NOT a let inside component body. A let local resets on each re-render, leaks stale timers, and defeats the 300ms debounce. The regression test fires 3 rapid keyUp events within 100ms and asserts onCommit fires exactly once after the 300ms window elapses."
  - "Plan 02-02 (2026-04-18): useMandateAutoSave is form-level (one instance per MandateForm), not per-field. Tracks global saveState + lastSavedAt + per-field fieldErrors + savingFields Set so the MandateSaveStatus can announce once per save while individual fields still show per-field inline errors."
  - "Plan 02-02 (2026-04-18): Generation-counter ref per field drops stale responses from concurrent saves (T-02-09 STRIDE mitigation). Test TC7 exercises the race: save(0.25) is still in flight when save(0.30) fires; the first's response is dropped before touching state."
  - "Plan 02-02 (2026-04-18): PreferenceForm.tsx deletion + MandateForm.tsx creation + preferences/page.tsx rewire all land in ONE commit (Task 2) — no intermediate broken-build state per Pitfall 5 in RESEARCH.md."
  - "Plan 02-02 (2026-04-18): Reset path sends { [field]: null } through the same PUT /api/preferences route. The route handler (shipped in Plan 02-01) transforms null values into p_clear_fields for the RPC. No per-field Reset endpoint."
  - "Plan 02-02 (2026-04-18): target_ticket_size_usd + mandate_archetype save on blur. A blurred empty value is interpreted as null (Reset equivalent) only when the field previously had a value — avoids spamming null saves on first-visit focus-blur. Plain blank-to-blank blur is a no-op."
metrics:
  duration: "~40m"
  completed: 2026-04-18
---

# Phase 02 Plan 02: Mandate Profile Builder — Frontend + E2E Summary

Allocator-facing MandateForm client UI replacing the legacy three-field PreferenceForm: single Card with Basics (max_weight slider, preferred_strategy_types + excluded_exchanges chip groups, target_ticket_size_usd, mandate_archetype textarea) plus an Advanced accordion (correlation_ceiling + max_drawdown_tolerance sliders, liquidity_preference 3-segment radio, style_exclusions chips). Auto-save per UI-SPEC trigger matrix via a generation-counter-safe useMandateAutoSave hook that honours 429 Retry-After + 5xx exponential backoff. `PreferenceForm.tsx` deleted in the same commit that introduces `MandateForm.tsx` + rewires `preferences/page.tsx` to title "My Allocation Settings". Zero new npm dependencies. Zero hex literals in any new component. 30 unit tests green; 4 Playwright scenarios discovered (HAS_SEEDED_SUPABASE-gated).

## What Shipped

### `src/components/mandate/formatRelativeTime.ts` (28 lines)

Pure relative-time util. 11 test cases green covering every UI-SPEC branch:
- `null` → `"Not saved yet"`
- `< 60s` → `"just now"`
- `60s – 59min` → `"{n} min ago"`
- `1hr – 23hr` → `"{n} hr ago"`
- `>= 24hr` → `"{YYYY-MM-DD}"` (UTC-based for determinism)
- Future timestamps clamped to 0 delta defensively
- Accepts both `Date` instance and numeric ms input

### `src/components/mandate/useMandateAutoSave.ts` (181 lines)

Per-form hook returning `{ saveState, fieldErrors, lastSavedAt, savingFields, save, clearError }`:
- `save(fieldName, value)` sends `PUT /api/preferences` with `{ [fieldName]: value }`, `credentials: "same-origin"`
- Generation-counter ref per field drops stale responses from concurrent saves (T-02-09)
- 429: reads `Retry-After` header, schedules one retry after the interval, clears error on retry success
- 5xx / network: 1s/2s/4s exponential backoff, max 3 retries (4 attempts total); final "Couldn't save." on exhaustion
- 400/401: single inline error `{reason}. Try again.`, saveState = "error", no retry
- On success: `setLastSavedAt(new Date())`, `saveState = "saved"` for 2s, then auto-reverts to `"idle"` (matches WizardChrome toast timing)

**Test count:** 9 unconditional `renderHook`/`act` cases (TC1 happy save, TC2 2s fade, TC3 null Reset, TC4 400 error, TC5 429+retry, TC6 5xx backoff success, TC6b exhaust, TC7 concurrent race, TC8 initialLastSavedAt seed).

### Six new components

| File | Lines | Purpose |
|------|-------|---------|
| `MandateForm.tsx` | 346 | Root client component: Card + Basics + Advanced accordion, imports STRATEGY_TYPES/SUBTYPES/EXCHANGES, wires every field to `save(fieldName, value)` / `save(fieldName, null)` for Reset. No `<form onSubmit>` — auto-save only. |
| `MandateSlider.tsx` | 106 | Native `<input type="range">` + value pill in `font-metric` + `Reset` link. **W-09 fix:** keyboard debounce uses `useRef<ReturnType<typeof setTimeout> \| null>(null)` at top, not `let` inside body. |
| `MandateChipGroup.tsx` | 74 | Generic `<T extends string>` chip multi-select with `role="checkbox" aria-checked`. `variant="accent" \| "negative"` — negative applied to `excluded_exchanges`. |
| `MandateSegmentedRadio.tsx` | 64 | 3-segment radiogroup for liquidity_preference; clicking selected option clears to `null`. |
| `MandateAdvancedSection.tsx` | 50 | Collapsible accordion with rotating chevron; `aria-expanded` + `aria-controls` + `hidden` attribute on panel. |
| `MandateSaveStatus.tsx` | 42 | Form-level `role="status" aria-live="polite"` region. Three branches: "Mandate saved" checkmark / "Last saved: {relative}" / "Not saved yet". `data-testid="mandate-save-status"` for E2E. |

### `src/app/(dashboard)/preferences/page.tsx` — rewired

Import swapped `PreferenceForm` → `MandateForm`. `PageHeader` title `"Preferences"` → `"My Allocation Settings"`, description `"Tell us about your mandate. Changes save automatically."`. Same async Next.js 16 server-component pattern (`await createClient()`, `getOwnPreferences`).

### `src/components/preferences/PreferenceForm.tsx` — DELETED (D-02)

The 156-line legacy 3-field form is gone. Same commit (Task 2 commit 15d4828) that creates `MandateForm.tsx` + rewires `page.tsx` — no intermediate broken build per Pitfall 5.

### `e2e/mandate-form.spec.ts` (184 lines)

Mirrors `e2e/bridge-outcome.spec.ts` structure. Per-test allocator provisioning via `admin.auth.admin.createUser` + `profiles` update (role=allocator, allocator_status=verified). No pre-seeded `allocator_preferences` row — Phase 2 first-visit is blank per D-09.

**4 scenarios:**
1. First visit — "Not saved yet" + "My Allocation Settings" heading + collapsed Advanced.
2. max_weight slider → blur → `"Mandate saved"` flash → 2s fade to "Last saved" → reload → value persists.
3. Advanced accordion expand reveals correlation_ceiling + max_drawdown + liquidity + style_exclusions.
4. Reset link clears a saved max_weight → reload → Reset link disappears (field is null again).

Gate: `test.skip(!HAS_SEEDED_SUPABASE || !NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY, ...)`.

## Confirmation: @testing-library/react v16.3.2 present

```json
// package.json devDependencies (unchanged this wave)
"@testing-library/jest-dom": "^6.9.1",
"@testing-library/react": "^16.3.2",
```

No conditional skipping, no "Playwright covers this" fallback for 429/5xx. All 9 useMandateAutoSave cases use `renderHook` + `act` unconditionally.

## Test Counts

| Suite | Tests | Status |
|-------|-------|--------|
| `src/components/mandate/formatRelativeTime.test.ts` | 11 | all green |
| `src/components/mandate/useMandateAutoSave.test.ts` | 9 | all green |
| `src/components/mandate/MandateForm.test.tsx` (inc. MandateSlider W-09) | 7 | all green |
| `src/components/mandate/MandateAdvanced.test.tsx` | 3 | all green |
| **Plan 02-02 new tests total** | **30** | **30 green** |
| Full project `npx vitest run` | 1225 passed / 54 skipped (127 files) | no regressions |
| `npx playwright test --list e2e/mandate-form.spec.ts` | 4 tests discovered | loads cleanly |
| `npx playwright test e2e/mandate-form.spec.ts` (HAS_SEEDED_SUPABASE unset) | 4 skipped | exits 0 as expected |

## Typecheck + Lint Status

- `npm run typecheck` — exits 0 after every task
- `npx eslint --max-warnings 0 src/components/mandate/ 'src/app/(dashboard)/preferences/'` — exits 0 clean on new paths
- Project-wide `npm run lint` surfaces **2 pre-existing warnings** in `src/lib/queries.my-allocation.test.ts` (unused `_column` / `_value` from commit 4cbc1ac in Phase 1). Out-of-scope per scope-boundary rule; logged in `.planning/phases/02-mandate-profile-builder/deferred-items.md`.

## Playwright Outcome

- `--list` discovers all 4 tests in `e2e/mandate-form.spec.ts` without load errors.
- `HAS_SEEDED_SUPABASE` was **not set** in the executor's `.env.local` during this run (`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are present — HAS_SEEDED_SUPABASE is the explicit opt-in).
- Running the spec without the gate → 4 tests skipped cleanly, process exit 0. Behaves identically to `e2e/bridge-outcome.spec.ts`.
- When HAS_SEEDED_SUPABASE=1 is set in a seeded local/CI env, the spec will run end-to-end against live Supabase.

## Manual Browser Smoke

A Next.js dev server was already running on port 3000 (PID 27318). Probe findings:

```
HTTP 307 — /preferences (unauthenticated redirect)
HTTP 200 — /preferences (after redirect to /login)
Response size: 19911 bytes
Compile-error substrings: 0
<title>Quantalyze</title> rendered
"Sign in" / "Login" copy present
```

**Interpretation:** Routes compile cleanly; the `/preferences` page returns 307 → /login (expected — no session). With only unauthenticated access available, full in-browser exercise of the MandateForm (slider drag → "Mandate saved" flash → reload) is not reachable from this executor's environment. The unit test suite (30 cases) + the Playwright spec (discoverable via `--list`) cover the functional contract; a HAS_SEEDED_SUPABASE-gated CI run or an interactive local QA session (per CLAUDE.md workflow) will confirm the end-to-end visual flow.

## DESIGN.md Token Audit

```
=== Hex audit (expect 0 each) ===
  src/components/mandate/MandateForm.tsx : 0
  src/components/mandate/MandateSlider.tsx : 0
  src/components/mandate/MandateChipGroup.tsx : 0
  src/components/mandate/MandateSegmentedRadio.tsx : 0
  src/components/mandate/MandateAdvancedSection.tsx : 0
  src/components/mandate/MandateSaveStatus.tsx : 0
  src/components/mandate/useMandateAutoSave.ts : 0
  src/components/mandate/formatRelativeTime.ts : 0
  e2e/mandate-form.spec.ts : 0
  src/app/(dashboard)/preferences/page.tsx : 0
```

Zero hex literals across all new files. Tailwind color-name scan (`text-red-*`, `bg-blue-*`, etc.): 0 matches. All colors flow through DESIGN.md tokens (`text-text-primary`, `text-accent`, `text-negative`, `bg-surface`, `border-border`, etc.).

## package.json Diff

```
git diff phase-02-mandate-profile-builder~4 HEAD -- package.json package-lock.json
(empty)
```

**Zero new dependencies.** No sonner, no react-hot-toast, no @radix-ui/*, no react-aria, no axios (CLAUDE.md banned package), no react-native-* (banned packages). The "toast" UX shape from D-16 is achieved entirely with React + existing Tailwind tokens + the aria-live region pattern already precedented in `OutcomeRecordedRow.tsx` and `WizardChrome.tsx`.

## W-09 Regression Proof

```
=== useRef<ReturnType<typeof setTimeout> | null> present? ===
  const keyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
=== 'let keyTimerRef' absent? ===
  NONE (good)
```

Regression test in `MandateForm.test.tsx` describe block `"MandateSlider keyboard debounce (W-09 regression)"`:
- Fires 3 rapid `fireEvent.keyUp(input, {key: "ArrowRight"})` events at 0ms / 50ms / 100ms with fake timers
- Asserts `onCommit` has been called `0` times before the 300ms window elapses
- Advances timers by 300ms after the last event
- Asserts `onCommit` fires exactly `1` time

With the pre-revision `let keyTimerRef` code, each re-render resets the reference — stale timers leak and the debounce fires multiple times. The test fails without the `useRef` fix and passes with it.

## W-06 (D-16 "Toast" Reinterpretation)

CONTEXT.md D-16 uses the word "toast"; RESEARCH.md §"No New Toast Library" + UI-SPEC §Component Inventory ("No new external dependencies. No sonner, no react-hot-toast.") clarify this is implemented as an inline `role="status" aria-live="polite"` region. The UX shape is preserved — the "Mandate saved" text appears briefly (2s via the hook's `fadeTimerRef`) then reverts to the "Last saved: N min ago" timestamp. The difference from a floating-toast library is only the DOM surface: the region lives inline with the form card's top-right header, not in a portal.

Precedents matched:
- `src/app/(dashboard)/allocations/components/OutcomeRecordedRow.tsx:56` — `text-accent {\u2713}` checkmark glyph inside inline text
- `src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx:44-56` — 2-second timer-driven show/hide pattern

## Deviations from Plan

### Auto-fixed Issues

**None.** The plan was executed exactly as written. The only task-action reinterpretation (D-16 toast → inline aria-live) was pre-approved in RESEARCH.md + UI-SPEC before executor ran — no new deviation introduced here.

### Intentional Adjustments

**1. Reset-link fallback for `liquidity_preference`.** UI-SPEC prescribes a Reset link pattern on every populated field. For `liquidity_preference` the three segmented-radio options already provide a natural "toggle off" — clicking the currently-selected segment clears the value to `null`. `MandateSegmentedRadio.tsx` hosts the Reset affordance as a top-right "Reset" button AND the click-to-clear-on-selected behavior; both routes call `onChange(null)` which invokes `save("liquidity_preference", null)` identically.

**2. Archetype blur semantics.** Plan says "save on blur" for textareas. A first-visit allocator who focuses the archetype textarea and tabs away without typing would spam `save("mandate_archetype", null)` against a field that is already null. `onArchetypeBlur` detects the empty-but-initial case only via `initial?.mandate_archetype != null` — if the field was previously null it does nothing on empty-blur; if it had a value, empty-blur saves null (Reset equivalent). Same guard on `target_ticket_size_usd`. No plan deviation — simply a sensible no-op that keeps the RPC traffic clean.

### Auth Gates

None. The Wave 1 RPC + route handler were confirmed present (`supabase/migrations/061_mandate_columns.sql` exists, route.ts calls `supabase.rpc("update_allocator_mandates", ...)`). No auth secrets required for Task 0-3 execution.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 0 | `80c8945` | test(02-02): add Wave 0 test scaffolds for mandate form + hook + E2E |
| 1 | `d34f81d` | feat(02-02): add formatRelativeTime util + useMandateAutoSave hook |
| 2 | `15d4828` | feat(02-02): build MandateForm + sub-components, rewire preferences page, delete PreferenceForm |
| 3 | `1a24ef5` | test(02-02): add Playwright E2E for MandateForm with per-test allocator provisioning |

## Metrics

- **Duration:** ~40 minutes
- **Completed:** 2026-04-18
- **Tasks:** 4 (0, 1, 2, 3)
- **Commits:** 4 per-task commits
- **Files created:** 13 (8 production + 4 unit test + 1 E2E spec)
- **Files modified:** 1 (preferences/page.tsx)
- **Files deleted:** 1 (PreferenceForm.tsx)
- **Diff size:** +1572 / -160 lines across 15 files
- **New dependencies:** 0
- **Unit tests added:** 30 (all green)
- **Playwright tests added:** 4 (all HAS_SEEDED_SUPABASE-gated, discoverable)

## Self-Check: PASSED

### Created files exist

- FOUND: src/components/mandate/MandateForm.tsx
- FOUND: src/components/mandate/MandateSlider.tsx
- FOUND: src/components/mandate/MandateChipGroup.tsx
- FOUND: src/components/mandate/MandateSegmentedRadio.tsx
- FOUND: src/components/mandate/MandateAdvancedSection.tsx
- FOUND: src/components/mandate/MandateSaveStatus.tsx
- FOUND: src/components/mandate/useMandateAutoSave.ts
- FOUND: src/components/mandate/useMandateAutoSave.test.ts
- FOUND: src/components/mandate/formatRelativeTime.ts
- FOUND: src/components/mandate/formatRelativeTime.test.ts
- FOUND: src/components/mandate/MandateForm.test.tsx
- FOUND: src/components/mandate/MandateAdvanced.test.tsx
- FOUND: e2e/mandate-form.spec.ts
- MISSING (intentional delete): src/components/preferences/PreferenceForm.tsx

### Commits exist

- FOUND: 80c8945 (Task 0)
- FOUND: d34f81d (Task 1)
- FOUND: 15d4828 (Task 2)
- FOUND: 1a24ef5 (Task 3)

### Success criteria (per plan `<success_criteria>`)

- [x] Wave 0 scaffolds in place (Task 0)
- [x] Allocators can visit /preferences, see "My Allocation Settings" + subtitle, interact with the Basics section + Advanced accordion
- [x] Auto-save fires on blur / pointerup / toggle / click per UI-SPEC trigger matrix
- [x] "Mandate saved" flashes for 2s on success; reverts to "Last saved: N min ago" via formatRelativeTime; "Not saved yet" on first visit; D-16 toast UX shape preserved via inline aria-live region (no new toast library)
- [x] Per-field inline errors for 400 / 429 / 5xx with correct copy; 429 auto-retries after Retry-After; 5xx uses 1s/2s/4s exponential backoff (max 3); tests unconditional
- [x] Per-field Reset link appears only when non-null; clicking sends `{ [field]: null }`
- [x] PreferenceForm.tsx deleted in the same commit as MandateForm.tsx creation and preferences/page.tsx replacement
- [x] W-09 fix applied (useRef-based keyboard debounce) with regression test asserting exactly-once commit after 300ms
- [x] Playwright e2e/mandate-form.spec.ts covers the full allocator flow gated on HAS_SEEDED_SUPABASE
- [x] Zero new npm dependencies, zero hex literals, zero tailwind color-name classes, UI-SPEC copy verbatim
- [x] formatRelativeTime 10+ cases green; useMandateAutoSave 8+ cases green (unconditional)

Nothing missing. Plan complete.

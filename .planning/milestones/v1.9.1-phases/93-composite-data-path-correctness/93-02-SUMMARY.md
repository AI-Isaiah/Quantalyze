---
phase: 93-composite-data-path-correctness
plan: 02
subsystem: ui
tags: [composite, wizard, window-capture, set-members, SyncPreviewStep, HARD-02, vitest]

# Dependency graph
requires:
  - phase: 86-composite-onboarding (86-03)
    provides: set-members route + set_wizard_composite_members RPC (the verified-correct write path this plan hardens the contract of)
  - phase: 89-composite-preview (89-04)
    provides: SyncPreviewStep composite attribution table (the display surface this plan fixes)
provides:
  - Value-level offline pins of the first member's entered window_start on BOTH write-path links (client panel→keys mapping + route p_members forwarding)
  - Exported pure buildSetMembersKeys() mapping (extracted from handleContinue, byte-identical)
  - SyncPreviewStep Data-window column three-tier fallback so an ENTERED window never renders "—"/Days 0
affects: [93-03, composite-onboarding, wizard-display]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure exported mapping helper extracted from a component handler so a payload contract can be pinned offline (no jsdom/Supabase)"
    - "Three-tier display fallback: reconstructed coverage → declared DB metadata → em-dash, keeping the coverage (Days) column honest"

key-files:
  created:
    - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.payload.test.ts
  modified:
    - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx
    - src/app/api/strategies/composite/set-members/route.test.ts
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.composite.render.test.tsx

key-decisions:
  - "HARD-02 closed on the hardened OFFLINE contract (value pins on both write-path links) + the display fix — NOT on the live symptom. The preserved-live-composite corroboration is a documented NON-BLOCKING gate and is NOT claimed reproduced-then-fixed."
  - "No write-path/RPC/migration change: research verified the write path (handleContinue → set-members/route → set_wizard_composite_members RPC) is correct; this plan pins its contract by value and fixes the read/display side."
  - "Closure basis is the offline contract + display fallback, NOT the research Branch-B validated-panel-nulling guard — accepted closure basis per the plan-checker note, not a gap."
  - "Display Tier-2 fallback reuses the wizard's existing 'live' open-ended vocabulary (MultiKeyConnectStep:806) and en-dash range style — no DESIGN.md deviation, no new copy."

patterns-established:
  - "Pattern: pin a client→server payload contract BY VALUE at both ends (client builder + route forwarder) so a silent field drop/rename on either link goes RED"
  - "Pattern: declared-metadata display fallback that never fabricates — renders only user-entered DB values, leaving reconstructed-coverage columns unchanged"

requirements-completed: [HARD-02]

# Metrics
duration: 12min
completed: 2026-07-11
---

# Phase 93 Plan 02: HARD-02 — First Member Key's Window Survives End-to-End Summary

**The first member key's entered window_start is now pinned BY VALUE offline at both write-path links, and the wizard's Data-window column renders a member's declared strategy_keys window (never "—"/Days 0) when reconstructed per_key coverage is absent — HARD-02 closed on the hardened offline contract + the display fix.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-11T20:31:00Z
- **Completed:** 2026-07-11T20:39:30Z
- **Tasks:** 2 completed
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments

- **Write-path contract pinned by value (Task 1):** extracted `handleContinue`'s inline `panel→keys[]` map into an exported pure `buildSetMembersKeys()` (byte-identical), added an offline pure test pinning `keys[0].window_start` by exact value + the `window_end` open/blank/bounded rules + `seq = i + 1` + order, and strengthened `set-members/route.test.ts` to value-pin `members[0..2].window_start` in `p_members` (previously existence-only). A silent field drop/rename on EITHER link now goes RED.
- **Display fix — entered window never shows "—" (Task 2):** the SyncPreviewStep attribution table `windowText` gained a Tier-2 fallback to the member's DECLARED `strategy_keys` window, so a reconstructed `n_days=0` member no longer masquerades as a missing window. The Days (coverage) column is untouched — a zero-coverage member reads honestly as "declared window / Days 0".
- **Zero write-path/RPC/migration change:** the verified-correct write path stays byte-identical; this plan hardens its contract and fixes the read/display side only.

## HARD-02 Closure Basis (explicit — nothing over-claimed)

HARD-02 is closed on:
1. **The hardened OFFLINE contract** — value-level pins on both write-path links (client `buildSetMembersKeys` mapping + route `p_members` forwarding), mutation-honest.
2. **The display fix** — an entered window always renders its declared value in the Data-window column; coverage (Days) stays honest.

The live-wizard repro (the preserved live composite) is a **documented NON-BLOCKING corroboration**. Phase 93's roadmap does **not** repro-gate on the live symptom. This plan does **NOT** claim the live symptom was reproduced-then-fixed; it claims the offline contract + display fallback. This closure is the **accepted** basis (offline contract + display), **not** the research Branch-B validated-panel-nulling guard — that is an accepted closure decision per the plan-checker note, not a gap.

## RED-before / GREEN-after evidence

### Task 1 — offline mapping + route value pin
- **Offline payload test RED:** `MultiKeyConnectStep.payload.test.ts` initially failed all 6 cases with `TypeError: buildSetMembersKeys is not a function` (helper not yet exported). GREEN after the extraction (12/12 across both Task 1 files).
- **Route mutation-honesty (documented, reverted):** temporarily changed `route.ts` `p_members` map to `window_start: i === 0 ? null : k.window_start` → `set-members/route.test.ts` went RED with `AssertionError: expected null to be '2025-08-01'` at the new `members[0].window_start` pin. Reverted; `git status --porcelain` of `route.ts` + `supabase/migrations/` is empty.

### Task 2 — declared-window fallback
- **Test 1 (symptom) + Test 3 (bounded end) RED** against pre-fix code: the Data-window cell rendered `"—"` for an entered window with absent per_key coverage (`getByText("2025-08-03 – live")` / `"2025-08-03 – 2025-09-30"` not found). **Test 2 (actual-coverage-wins) passed pre-fix** (Tier 1 unchanged).
- **GREEN after** the three-tier `windowText` fallback: all 3 pins pass; whole composite render sibling 26/26.

## Task Commits

Each task was committed atomically:

1. **Task 1: Pin first member window_start BY VALUE — extracted pure mapping + strengthened route test** — `bdc5a760` (test)
2. **Task 2: SyncPreviewStep Data-window declared-window fallback** — `2ddc7eeb` (fix)

_TDD RED→GREEN evidence captured above; the extraction and its offline test are tightly coupled (the test cannot import a non-existent export), so Task 1 landed as one atomic commit with the mutation-honesty RED documented._

## Files Created/Modified

- `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx` — extracted exported pure `buildSetMembersKeys()`; `handleContinue` calls it (inline map deleted). No other component change.
- `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.payload.test.ts` — NEW offline pure test: first member `window_start` value + `window_end`/`seq`/order/null-api_key_id.
- `src/app/api/strategies/composite/set-members/route.test.ts` — value-pins on `members[0..2].window_start` in `p_members`.
- `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` — `windowText` three-tier fallback (Tier-2 declared strategy_keys window). Change confined to the derivation; Days/gantt/contribution untouched.
- `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.composite.render.test.tsx` — 3 new pins in a `[93-02]` describe block.

## Verification

- `npx vitest run "src/app/(dashboard)/strategies/new/wizard" src/app/api/strategies/composite/set-members/route.test.ts` → **20 files / 177 tests passed**.
- `npx tsc --noEmit` → exit 0.
- `npx eslint` on all 5 touched files → 0 errors.
- `git status --porcelain src/app/api/strategies/composite/set-members/route.ts supabase/migrations/` → empty (no write-path/RPC/migration change).
- `grep -v '^\s*//' MultiKeyConnectStep.tsx | grep -c buildSetMembersKeys` → 2 (definition + wired call site).

## Deviations from Plan

None — plan executed exactly as written. (The route mutation-honesty check was performed and reverted as instructed; it is documented above, not a deviation.)

## Threat Surface

No new security-relevant surface. Per the plan's threat register: the `buildSetMembersKeys` extraction is byte-identical and pinned by value-level tests on both links (T-93-02-01, mitigated); the Data-window declared fallback renders only the user's own already-displayed entered dates (T-93-02-02, accept); no packages installed (T-93-02-SC, accept). No server code, endpoint, auth, or migration changed.

## Known Stubs

None — no placeholder/empty-data stubs introduced. The Tier-3 "—" render is the honest no-window-entered case, not a stub.

## Self-Check: PASSED

- Files created/modified exist on disk (payload test + SUMMARY verified).
- Task commits `bdc5a760`, `2ddc7eeb` present in git history.

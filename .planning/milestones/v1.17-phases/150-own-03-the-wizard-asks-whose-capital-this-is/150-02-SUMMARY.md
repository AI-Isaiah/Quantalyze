---
phase: 150-own-03-the-wizard-asks-whose-capital-this-is
plan: 02
subsystem: ui
tags: [typescript, react, vitest, testing-library, tailwind, supabase-types, design-system]

# Dependency graph
requires:
  - phase: 149-nav-01-my-strategies
    provides: StrategyTable owner surface + the Badge-family status marker the ownership tag sits beside
provides:
  - "src/lib/capital-ownership.ts — CapitalOwnership type, OWN_CAPITAL/TEAM_REVIEW constants, and isAllocatable(): the single-source allocatable predicate"
  - "src/components/strategy/OwnershipTag.tsx — Badge-family ownership tag, null-safe, no draft fallback"
  - "src/components/strategy/CapitalOwnershipRadioGroup.tsx — the ONE capital question, mounted by both the wizard and the Mark dialog"
  - "src/lib/dollar-validation.ts — isValidDollar (lifted from finalize-wizard) + formatUsd (lifted from HoldingsTable)"
  - "strategies.capital_ownership widened into database.types.ts (Row/Insert/Update) and types.ts Strategy (inherited by RankedStrategyRow)"
affects: [150-03 wizard MetadataStep, 150-04 migration, 150-05 allocation route, 150-06 Mark dialog, 150-07 Holdings rows, 150-08 phase gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-source allocatable predicate: one isAllocatable() call, never an inline === \"own_capital\" comparison"
    - "Third chip family by INK not shape: a separate component reusing the Badge anatomy class string verbatim, with a closed switch and no fallback"
    - "One question component, two mounts: option copy + helper as module constants, only the group label is a prop"
    - "Lifted shared money helpers: one dollar validator and one USD formatter for the whole phase"

key-files:
  created:
    - src/lib/capital-ownership.ts
    - src/lib/capital-ownership.test.ts
    - src/lib/dollar-validation.ts
    - src/lib/dollar-validation.test.ts
    - src/components/strategy/OwnershipTag.tsx
    - src/components/strategy/OwnershipTag.test.tsx
    - src/components/strategy/CapitalOwnershipRadioGroup.tsx
    - src/components/strategy/CapitalOwnershipRadioGroup.test.tsx
  modified:
    - src/lib/database.types.ts
    - src/lib/types.ts
    - src/app/api/strategies/finalize-wizard/route.ts
    - src/app/(dashboard)/allocations/components/HoldingsTable.tsx

key-decisions:
  - "types.ts imports the CapitalOwnership type from capital-ownership.ts rather than re-spelling the literal union inline — structurally identical, but it makes the domain unforgeable in one place instead of two"
  - "OwnershipTag's doc comment deliberately does NOT spell the two forbidden identifiers, because the acceptance grep runs over this source and would match its own prose (the 140.2-08 self-matching-comment lesson)"
  - "isAllocatable fails CLOSED for any unrecognised value: the DB column is `text`, so a future or garbled mark must never unlock the money action"
  - "The radio group has no click-to-clear arm, unlike the repo's segmented-radio idiom — a mark is never absent once asked"
  - "MAGNITUDE_CAPS is imported from @/lib/closed-sets into dollar-validation.ts and never re-exported; the canonical home does not move"

patterns-established:
  - "Interface-first wave-1 plan: mint the vocabulary (types, predicate, primitives, shared formatters), mount nothing"
  - "Literal-oracle tests: caps and copy are typed into the test as literals, never imported from the module under test"

# Metrics
duration: 30min
completed: 2026-08-06
---

# Phase 150 Plan 02: Shared capital-ownership contracts Summary

**The OWN-03 vocabulary: a fail-closed `isAllocatable()` predicate, a Badge-family `OwnershipTag` with no draft fallback, the single `CapitalOwnershipRadioGroup` both future mounts share, and the dollar validator + USD formatter lifted out of their single call sites so the phase cannot grow a second one of either.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-08-06T15:10Z (approx.)
- **Completed:** 2026-08-06T15:40Z (approx.)
- **Tasks:** 3 of 3
- **Files modified:** 12 (8 created, 4 modified)

## Accomplishments

- **The allocatable predicate is spelled once.** `isAllocatable()` is the only place the `own_capital` literal is compared. It fails CLOSED — `null`, `undefined`, and any unrecognised value coming off the untyped `text` column are all non-allocatable — so a garbled mark cannot unlock the money action (threat T-150-07).
- **Three display states, two logic states, made explicit and defended.** The module comment states the collapse and forbids "simplifying" it in either direction, citing the research finding that motivates the nullable-no-default column.
- **`OwnershipTag` closes the UI-spoofing hole (T-150-08).** It reuses the Badge anatomy class string verbatim but is a separate component with a closed switch, because `Badge.tsx:55` falls back to the DRAFT entry for any unrecognised label — an ownership value routed through Badge would have rendered as a trusted-looking Draft chip.
- **One question component for two mounts.** Option labels and the helper line are module constants; only the group label is a prop, so the wizard and Mark-dialog copy cannot drift. The helper line carries the D-03 invariant in the user's own words.
- **Two money helpers lifted, zero behaviour change.** `isValidDollar` moved out of the finalize-wizard route and `formatUsd` out of `HoldingsTable`; both bodies are byte-unchanged and both original suites pass with zero edits to their assertions.

## Task Commits

Each task was committed atomically; TDD tasks carry a RED `test(...)` commit and a GREEN `feat(...)` commit.

1. **Task 1: Predicate module + type widening + dollar-validator and formatUsd lifts**
   - `02f9e48e` (test — RED, both new suites failed to resolve their modules)
   - `d26af7cb` (feat — GREEN)
2. **Task 2: OwnershipTag component**
   - `1241c5f9` (test — RED)
   - `2139050f` (feat — GREEN)
3. **Task 3: CapitalOwnershipRadioGroup — the ONE question component**
   - `5f384390` (test — RED)
   - `d799e679` (feat — GREEN)

## Files Created/Modified

**Created**

- `src/lib/capital-ownership.ts` — `OWN_CAPITAL` / `TEAM_REVIEW` / `CapitalOwnership` / `isAllocatable()`, with the three-display/two-logic-state comment as spec.
- `src/lib/capital-ownership.test.ts` — the 4-case truth table plus a fail-closed arm for unknown values.
- `src/lib/dollar-validation.ts` — `isValidDollar` (imports `MAGNITUDE_CAPS` from `@/lib/closed-sets`; no re-declaration, no re-export) and `formatUsd`.
- `src/lib/dollar-validation.test.ts` — the $1e12 boundary with the cap typed in as a literal oracle; `formatUsd` pinned with literal strings including the null em-dash.
- `src/components/strategy/OwnershipTag.tsx` — accent / muted / nothing.
- `src/components/strategy/OwnershipTag.test.tsx` — class-token assertions, both absent arms, and a negative source pin.
- `src/components/strategy/CapitalOwnershipRadioGroup.tsx` — fieldset + legend + `role="radiogroup"` + two `role="radio"` buttons.
- `src/components/strategy/CapitalOwnershipRadioGroup.test.tsx` — structure, `aria-checked` tracking, `onChange` values, three copy literals, and two source pins.

**Modified**

- `src/lib/database.types.ts` — `strategies` Row/Insert/Update gain `capital_ownership`, hand-edited in the generated style at its alphabetical position.
- `src/lib/types.ts` — `Strategy` gains `capital_ownership`; `RankedStrategyRow` is `Strategy & …` so the owner-surface rows inherit it with no second edit.
- `src/app/api/strategies/finalize-wizard/route.ts` — imports the lifted validator; the route-local closure is deleted. `MAGNITUDE_CAPS` stays imported (still used at two other sites).
- `src/app/(dashboard)/allocations/components/HoldingsTable.tsx` — imports the lifted formatter; the module-private copy is deleted. This is the only edit to the file — the row/cell work belongs to Plan 07.

## Decisions Made

- **`types.ts` imports the `CapitalOwnership` type** rather than re-spelling `"own_capital" | "team_review" | null` inline as the plan's action text suggested. The plan's own interfaces block defines `CapitalOwnership` as exactly that union, so this is structurally identical while keeping the domain unforgeable in one place. Recorded as a deviation below.
- **`OwnershipTag`'s prose omits the two forbidden identifiers.** The plan's acceptance criterion is a grep over the component's own source, so naming them in an explanatory comment fails it. The comment says so explicitly, otherwise the omission reads as an oversight.
- **No click-to-clear.** The repo's `MandateSegmentedRadio` idiom clears on re-click; that is wrong for a two-state mark that is never absent once asked. The test pins it.
- **`aria-label={label}` on the inner radiogroup** in addition to the `<legend>`, so screen readers announce the group name even where the fieldset/legend association is weak.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical] `types.ts` single-sources the ownership union via a type import**
- **Found during:** Task 1
- **Issue:** The plan's action text asked for the literal union `"own_capital" | "team_review" | null` typed inline into `Strategy`. That would have created a second spelling of the domain, which is precisely the drift `capital-ownership.ts` exists to prevent (threat T-150-07 names predicate drift; the union has the same failure mode — widening one spelling and not the other).
- **Fix:** `import type { CapitalOwnership } from "./capital-ownership"` and declare `capital_ownership?: CapitalOwnership | null`. Resolves to the identical structural type; the plan's own interfaces block defines `CapitalOwnership` as that exact union.
- **Files modified:** `src/lib/types.ts`
- **Verification:** `npx tsc --noEmit` clean across the repo; all 181 `src/lib` suites green.
- **Committed in:** `d26af7cb` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical).
**Impact on plan:** None on scope. The deviation strengthens the plan's own stated invariant rather than widening it.

## Issues Encountered

- **The `OwnershipTag` negative source pin failed on the component's own doc comment.** The first GREEN attempt explained *why* the component avoids Badge's status lookup by naming the identifier — and the acceptance grep runs over that file, so it matched the prose. Rewritten to describe the mechanism without spelling either identifier, with a note saying the omission is deliberate. This is the same self-matching-comment shape recorded in the 140.2-08 execution decisions.
- **One pre-existing lint warning** (`EquityChart.tsx:1119`, `react-hooks/exhaustive-deps`) is present on `npm run lint`. It is untouched by this plan and out of scope; `npm run lint` reports **0 errors**.

## Verification

| Gate | Result |
|------|--------|
| `npx vitest run` (the plan's 6-file verification set) | 6 files, **131 passed** |
| `npx vitest run "src/app/(dashboard)/allocations" "src/app/api/strategies/finalize-wizard"` | 120 files, **1705 passed** |
| `npx vitest run src/lib` | 181 files, **3532 passed / 9 skipped** |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors (1 pre-existing warning, unrelated file); route-contract + admin-manifest checks OK |

**Acceptance criteria, per task:**

- `grep -rn "isValidDollar" …/finalize-wizard/route.ts` → import + 4 call sites, **no local declaration**.
- `grep -c "MAGNITUDE_CAPS" src/lib/dollar-validation.ts` → 3 (prose note + the `@/lib/closed-sets` import + the closure usage); **no re-declaration, no re-export**.
- `grep -c "function formatUsd\|const formatUsd" …/HoldingsTable.tsx` → **0**; the file imports it from `@/lib/dollar-validation`.
- `grep -c "capital_ownership" src/lib/database.types.ts` → **3** (Row/Insert/Update).
- `grep -c "statusMap" src/components/strategy/OwnershipTag.tsx` → **0**.
- `grep -c "tabIndex" src/components/strategy/CapitalOwnershipRadioGroup.tsx` → **0**; no `fetch(`/`supabase` either.
- `finalize-wizard/route.test.ts` and `HoldingsTable.strategy-rows.test.tsx` pass with **zero edits** to their assertions.

## Known Stubs

None. Every module in this plan is complete against its contract; nothing is mounted yet by design (this plan mints the vocabulary, Waves 2–3 consume it).

## Threat Flags

None. This plan adds no request handling, no writes, and no new network/auth/file surface — it is types, two pure presentational/form components, and two code moves. The `T-150-SC` disposition holds: **zero packages installed**.

> ⚠️ Carried forward, not introduced here (150-RESEARCH.md § Schema Findings 1): once the column lands in Plan 04, `strategies_read` RLS has no column projection, so `capital_ownership` will be **publicly readable on published rows**. UI-SPEC invariant 3 is a *render* invariant, not a data one. Plan 04 owns the conscious decision; recorded so it is not discovered at review time.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 03 (wizard MetadataStep)** can import `CapitalOwnershipRadioGroup` and default its state to `TEAM_REVIEW`; the component is controlled and never null.
- **Plan 04 (migration)** must ship `capital_ownership` as **nullable, no DEFAULT, no backfill** — the type widening here already reflects that (`string | null` in the generated types, optional in `Strategy`).
- **Plans 05/07 (allocation route + Holdings)** import `isValidDollar` / `formatUsd` from `@/lib/dollar-validation` and `MAGNITUDE_CAPS` from `@/lib/closed-sets` directly. Note the cap split: `MAX_TICKET_SIZE_USD` ($1e9) is the allocation ticket bound, `MAX_DOLLAR_VALUE_USD` ($1e12) the AUM/capacity bound.
- **Plans 06/07 (Mark dialog, Holdings rows)** import `OwnershipTag` and `isAllocatable`; no surface should re-derive either.
- **Plan 08 (phase gate)** can pin the `"own_capital"` literal to `src/lib/capital-ownership.ts` alone — no other file in the repo spells it today.
- ⚠️ `STATE.md` / `ROADMAP.md` were deliberately **not** touched (worktree mode; the orchestrator owns those writes post-wave).

## Self-Check: PASSED

All 8 created files exist on disk; all 4 modified files carry their edits. All 6 task commits resolve in `git log`.

---
*Phase: 150-own-03-the-wizard-asks-whose-capital-this-is*
*Completed: 2026-08-06*

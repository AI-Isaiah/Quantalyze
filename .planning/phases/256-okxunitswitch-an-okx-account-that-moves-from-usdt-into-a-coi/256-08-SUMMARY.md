---
phase: 256-okxunitswitch
plan: 08
subsystem: ui
tags: [strategy-list, unit-switch, og-card, returns-api, enumerated-scalars, reader-pins]
requires:
  - phase: 256-okxunitswitch
    provides: "256-05: parseUnitSwitch and the unitSwitchChipText / unitSwitchChipTitle / unitSwitchOgNote templates in src/lib/factsheet/unit-segments.ts"
provides:
  - "UnitSwitchChip (src/components/strategy/UnitSwitchChip.tsx), attribute data-unit-switch"
  - "list scalars unit_switch_coin, unit_switch_last_usd_day, unit_switch_first_coin_day (+ three last_success_ twins) in the ranked list select, kept on the shaped row only when parseUnitSwitch accepts all three"
  - "OG share card note line from unitSwitchOgNote; factsheet page card URL carries &us=<coin>.<last usd day>.<first coin day>"
  - "GET /api/strategies/[id]/returns field unit_switch (absent for every other strategy), returns_unit stays null"
  - "src/lib/unit-switch-readers.test.ts and per-reader pins"
affects: [256-09, 256-10]
tech-stack:
  added: []
  patterns: ["enumerated-scalar rule extended by exactly six forms, pinned closed", "generation-consistent list flag read through the one effectiveListFlag", "conditional spread so an unswitched response/shape is unchanged"]
key-files:
  created:
    - src/components/strategy/UnitSwitchChip.tsx
    - src/components/strategy/UnitSwitchChip.test.tsx
    - src/components/strategy/StrategyTable.unit-switch.test.tsx
    - src/lib/queries.unit-switch.test.ts
    - src/lib/unit-switch-readers.test.ts
    - src/app/api/og/factsheet/[id]/route.unit-switch.test.tsx
    - src/app/api/strategies/[id]/returns/route.unit-switch.test.ts
  modified:
    - src/lib/queries.ts
    - src/lib/types.ts
    - src/lib/queries.test.ts
    - src/components/strategy/StrategyTable.tsx
    - src/app/api/og/factsheet/[id]/route.tsx
    - src/app/api/strategies/[id]/returns/route.ts
    - src/app/factsheet/[id]/v2/page.tsx
    - src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx
    - src/app/scenario-share/[token]/page.test.tsx
key-decisions:
  - "The list row carries the three switch scalars ONLY when they pass parseUnitSwitch together (shapedUnitSwitch). A missing or malformed scalar yields no scalar at all, so the chip never sees a half switch and a USD row's shaped object gains no key."
  - "effectiveListFlag is generalised (one more key family and a blob-path map) instead of adding a second generation pick, so the recompute-verdict census counts for queries.ts do not move."
  - "The OG card's cache key lives in the factsheet page's ogImage URL (the route never reads the param), so the key change is in v2/page.tsx, not the route: &us=<coin>.<lastUsdDay>.<firstCoinDay>, built only from the parsed switch."
  - "StrategyTable passes unit null to ReturnsUnitChip when a switch is projected, so 'in BTC' never renders on a switched row even if a native unit were ever present beside it (must-have truth 1)."
  - "The chip wraps its visible text in aria-hidden because the sr-only span already carries the full sentence; the UI-SPEC does not specify this, flagged below."
requirements-completed: [SC-3, SC-7]
status: complete
duration: 85min
completed: 2026-11-27
commits: 3
plan_head_before: 40e1d609ffd8649c39e0e56beb4c3f451a4b4c25
plan_head_after: 6e10caebe88e6ce5cee4315298fd40708fbae444
actuals:
  tokens: 24600
  tasks: 3
  commits: 3
---

# Phase 256 Plan 08: PRESENT-LIST Summary

**A strategy that moved from USD into a coin reads "USD, then BTC" in its list row (full sentence in sr-only and title), carries the same sentence plus "Figures in USD." on its share card under a cache key that varies with the switch, and returns `unit_switch` from the returns API, all from three closed flag scalars through one parser; every USD-reading TS consumer of a switched row is pinned.**

## What was built

- **List projection (`queries.ts`, `types.ts`).** Six aliases join `CATEGORY_RANKING_ANALYTICS_COLUMNS`: `unit_switch_coin`, `unit_switch_last_usd_day`, `unit_switch_first_coin_day` (`data_quality_flags->unit_switch->>...`) and their `last_success_` twins under `last_success_snapshot->flags`. `effectiveListFlag` reads them from the SAME flags generation as the figures (alias row: alias or snapshot twin; blob row: the `unit_switch` object of the effective flags). `shapedUnitSwitch` keeps the three only when `parseUnitSwitch` accepts them together; `shapeStoredAnalytics` deletes all six aliases first. The comment block names the new scalars and why they are allowed (three closed scalars, same rule as `native_unit`).
- **`UnitSwitchChip`.** Pure render; classes byte-equal to the compact `ReturnsUnitChip` (test compares the two className strings); visible `USD, then BTC`, `sr-only` full sentence, `title` = `unitSwitchChipTitle`, `data-unit-switch`. Zero nodes for any missing or malformed scalar.
- **`StrategyTable`.** The chip sits in the `ReturnsUnitChip` slot, first in the type-badge row; `ReturnsUnitChip` gets `null` when a switch is projected.
- **OG route.** One note line (`unitSwitchOgNote`, the figureNote style, margin 8 under a figureNote and 24 without) from the effective flags already read; the existing Updating line follows at 8 when either note precedes it. The CAGR label stays `CAGR`. No second `effectiveDataQualityFlags` call (the recompute-verdict census pins one).
- **Factsheet page `ogImage` URL.** Gains `&us=BTC.2026-11-14.2026-11-15` from the strictly parsed switch (T-256-25).
- **Returns route.** `unit_switch: {coin, last_usd_day, first_coin_return_day}` by conditional spread from the effective flags; `returns_unit` and `daily_returns_usd` stay null; no coin closes are read.

## Verification

- Task 1 verify (queries, chip, table, whole `src/components/strategy/`, plus `queries.test.ts`, `queries.stale-analytics-detail.test.ts`, `recompute-verdict-census.test.ts`): `Test Files 75 passed (75)`, `Tests 1580 passed (1580)`.
- Task 2 verify plus the cache-key test and the recompute-verdict census: `Test Files 12 passed (12)`, `Tests 228 passed (228)`.
- Task 3 verify (`unit-switch-readers.test.ts src/lib src/components/strategy`): `Test Files 1 failed | 390 passed (391)`, `Tests 2 failed | 9956 passed | 23 skipped (9981)`. The two failures are `src/lib/factsheet/compute.conventions.test.ts` fixture B and fixture C, the SAME two plan 05 recorded as pre-existing (last-digit `skew` float difference in a FROZEN `compute()` inline snapshot). Not this plan's, not fixed (scope boundary).
- `npm run typecheck` (redirected, no pipe): `EXIT=0`, 0 `error TS` lines. It first reported one real error (excess property in the held-re-run fixture of `route.unit-switch.test.ts`); fixed in the third commit.
- `npx eslint` on every touched file: 0 problems (two unused imports copied from a fixture were removed).
- Pinning-test sweep: every `src/__tests__` and `tests/` file naming `queries.ts`, `StrategyTable`, `UnitSwitchChip`, `ReturnsUnitChip`, `og/factsheet`, `strategies/[id]/returns`, `factsheet/[id]/v2/page`, `types.ts`, `scenario-share` or `database.types` (40 files): `Test Files 39 passed | 1 skipped (40)`, `Tests 1020 passed | 17 skipped (1037)`. A first run of a smaller batch reddened `display-sign-single-source` R7 once under a host load average above 80 (timeout); alone and in the sweep it passes.
- Acceptance greps: `unit_switch` in `queries.ts` >= 6 (measured by the tests: six aliases once each); `UnitSwitchChip` in `StrategyTable.tsx` 2 (import and use); `unitSwitch` in the OG route >= 1; `unit_switch` in the returns route >= 1.
- Tracer gate: Task 1's tests were written first and run RED against the pre-change `queries.ts` (`Tests  9 failed | 12 passed (21)` on `queries.unit-switch.test.ts`, assertions on the new aliases and scalars), then the implementation turned them GREEN before expansion.

## TDD ordering (deviation, Rule 12)

Task 1 was written test-first (RED seen, then GREEN) in one `feat` commit. Tasks 2 and 3 wrote their tests AFTER the code and are NOT RED on a pre-fix tree by ordering: their RED evidence is the neutered-copy gates below (C2, D, E, F for Task 2; C, G1 to G5 for Task 3). Each commit is one atomic task commit, not a `test` then `feat` pair, because the plan is `type: execute`, not `type: tdd`.

## PROOF-01 (each gate seen RED by assertion, restored by cp, cmp silent, GREEN)

Byte backup with `cp` to the scratchpad, neuter by an exact-string replace (asserted to match once), run with `--testTimeout 120000`, restore with `cp`, `cmp` silent, rerun. After all gates `git status --short` showed only the intended uncommitted test edits. No git checkout, restore or stash. Gate names: the plan's A, B, C map to A, B1/B2 and C/C2 below; D, E, F and G1 to G5 are extra gates.

Plan gate A (the chip renders the sentence with the days swapped), plan gate B (a projected scalar dropped: B1 from the select, B2 from the projection, which also turns the chip null in the table test), plan gate C (a converting reader takes the switch coin as a unit source: C the scenario-share page, C2 the returns route):

```
### GATE A: UnitSwitchChip renders the sentence with the days swapped
neutered: src/components/strategy/UnitSwitchChip.tsx
     × renders the compact visible text, the sr-only sentence, the title and the attribute 206ms
     × takes the coin and the days as data: a second fixture renders its own, with no literal BTC or date 19ms
     × the day order is last USD day first, first coin day second (a swap would be a false sentence) 7ms
     × the projection of a stored switch reaches the chip: visible text, attribute, sentence 773ms
 FAIL  |jsdom| src/components/strategy/StrategyTable.unit-switch.test.tsx > StrategyTable - a switched row names the switch in the badge row (SC-3) > the projection of a stored switch reaches the chip: visible text, attribute, sentence
 FAIL  |jsdom| src/components/strategy/UnitSwitchChip.test.tsx > UnitSwitchChip > renders the compact visible text, the sr-only sentence, the title and the attribute
AssertionError: expected 'In USD to Nov 15, 2026, in BTC from N…' to be 'In USD to Nov 14, 2026, in BTC from N…' // Object.is equality
AssertionError: expected 'In USD to Nov 15, 2026, in BTC from N…' to be 'In USD to Nov 14, 2026, in BTC from N…' // Object.is equality
 Test Files  2 failed (2)
      Tests  4 failed | 17 passed (21)
cmp(src/components/strategy/UnitSwitchChip.tsx): silent
-- GREEN after restore
 Test Files  2 passed (2)
      Tests  21 passed (21)

### GATE B1: queries.ts select drops one projected scalar (first_coin_day alias)
neutered: src/lib/queries.ts
     × carries the D-15 record as exactly three scalar aliases, two dates and one count, never an array or a blob (phase 194 plan 06, T-194-10) 23ms
     × each of the six aliases is in the select exactly once 9ms
     × the select reaches getStrategiesByCategory's embed (the one anonymous list read) 5ms
     × every unit_switch reference is a `->>` text scalar of one of the three closed fields, never the object 14ms
 FAIL  |jsdom| src/lib/queries.unit-switch.test.ts > the ranked list select carries the unit switch as six closed scalars (T-256-23) > each of the six aliases is in the select exactly once
 FAIL  |jsdom| src/lib/queries.unit-switch.test.ts > the ranked list select carries the unit switch as six closed scalars (T-256-23) > the select reaches getStrategiesByCategory's embed (the one anonymous list read)
AssertionError: unit_switch_first_coin_day:data_quality_flags->unit_switch->>first_coin_return_day: expected +0 to be 1 // Object.is equality
AssertionError: unit_switch_first_coin_day:data_quality_flags->unit_switch->>first_coin_return_day: expected 'id, user_id, category_id, name, descr…' to contain 'unit_switch_first_coin_day:data_quali…'
 Test Files  2 failed (2)
      Tests  4 failed | 179 passed (183)
cmp(src/lib/queries.ts): silent
-- GREEN after restore
 Test Files  2 passed (2)
      Tests  183 passed (183)

### GATE B2: queries.ts projection drops one scalar when reading the switch (first coin day not read)
neutered: src/lib/queries.ts
     × an anonymous ranked row: the projected aliases become the three scalars, the aliases are gone 54ms
     × an owner wildcard row: the three are read out of the unit_switch object of the flags blob 1ms
     × a switched row still reads as a USD row: no native unit is derived from the switch 1ms
     × an alias row past the derive prestamp takes the SNAPSHOT's switch 1ms
 FAIL  |jsdom| src/lib/queries.unit-switch.test.ts > shapeRowAnalytics - a switched row carries the three parsed scalars (SC-3) > an anonymous ranked row: the projected aliases become the three scalars, the aliases are gone
 FAIL  |jsdom| src/lib/queries.unit-switch.test.ts > shapeRowAnalytics - a switched row carries the three parsed scalars (SC-3) > an owner wildcard row: the three are read out of the unit_switch object of the flags blob
AssertionError: expected undefined to be 'BTC' // Object.is equality
AssertionError: expected undefined to be 'BTC' // Object.is equality
 Test Files  3 failed (3)
      Tests  16 failed | 23 passed (39)
cmp(src/lib/queries.ts): silent
-- GREEN after restore
 Test Files  3 passed (3)
      Tests  39 passed (39)

### GATE C: scenario-share page.tsx takes the switch coin as a unit source
neutered: src/app/scenario-share/[token]/page.tsx
     × src/app/scenario-share/[token]/page.tsx (scenario share page) reads the leg unit from native_unit alone 8ms
     × 256: a leg whose flags carry a unit_switch (and no native_unit) is a USD leg: no closes read, the markup equals the plain leg's 54ms
 FAIL  |jsdom| src/lib/unit-switch-readers.test.ts > static pins: readers whose unit comes from an input other than a strategy's flags name no unit_switch > src/app/scenario-share/[token]/page.tsx (scenario share page) reads the leg unit fr
 FAIL  |jsdom| src/app/scenario-share/[token]/page.test.tsx > ScenarioSharePage — BTC leg shares blend in USD (164.6.6.2 D-22) > 256: a leg whose flags carry a unit_switch (and no native_unit) is a USD leg: no closes read, the markup equals
AssertionError: src/app/scenario-share/[token]/page.tsx must not read unit_switch as a unit source: expected '// SECURITY BOUNDARY:\n// This is a P…' not to contain 'unit_switch'
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
 Test Files  2 failed (2)
      Tests  2 failed | 40 passed (42)
cmp(src/app/scenario-share/[token]/page.tsx): silent
-- GREEN after restore
 Test Files  2 passed (2)
      Tests  42 passed (42)

### GATE C2: returns route takes the switch coin as a unit source
neutered: src/app/api/strategies/[id]/returns/route.ts
     × a switched strategy keeps returns_unit null and returns the three switch fields 259ms
     × days two apart: malformed reads as absent, never a partial switch 1ms
     × USD as the coin: malformed reads as absent, never a partial switch 1ms
     × a missing day: malformed reads as absent, never a partial switch 1ms
 FAIL  |jsdom| src/app/api/strategies/[id]/returns/route.unit-switch.test.ts > GET /api/strategies/[id]/returns - 256 unit switch (SC-3) > a switched strategy keeps returns_unit null and returns the three switch fields
 FAIL  |jsdom| src/app/api/strategies/[id]/returns/route.unit-switch.test.ts > GET /api/strategies/[id]/returns - 256 unit switch (SC-3) > days two apart: malformed reads as absent, never a partial switch
AssertionError: expected 'BTC' to be null
AssertionError: expected 'BTC' to be null
 Test Files  1 failed (1)
      Tests  4 failed | 6 passed (10)
cmp(src/app/api/strategies/[id]/returns/route.ts): silent
-- GREEN after restore
 Test Files  1 passed (1)
      Tests  10 passed (10)

### GATE D: OG route drops the switch note
neutered: src/app/api/og/factsheet/[id]/route.tsx
     × prints the switch sentence and 'Figures in USD.' as one note, in the figureNote style, 24 below the stat row 193ms
     × sits 8 below an existing figure note 4ms
     × the sentence is composed from the stored days: a second fixture renders its own coin and days 2ms
     × reads the EFFECTIVE flags: a held re-run inside the derive prestamp window prints the last success's switch 2ms
 FAIL  |jsdom| src/app/api/og/factsheet/[id]/route.unit-switch.test.tsx > OG factsheet card - a switched strategy (SC-3, UI-SPEC E) > prints the switch sentence and 'Figures in USD.' as one note, in the figureNote style, 24 below the stat r
 FAIL  |jsdom| src/app/api/og/factsheet/[id]/route.unit-switch.test.tsx > OG factsheet card - a switched strategy (SC-3, UI-SPEC E) > sits 8 below an existing figure note
AssertionError: expected [ …(3) ] to include 'In USD to Nov 14, 2026, in BTC from N…'
AssertionError: expected [ …(4) ] to include 'In USD to Nov 14, 2026, in BTC from N…'
 Test Files  1 failed (1)
      Tests  4 failed | 6 passed (10)
cmp(src/app/api/og/factsheet/[id]/route.tsx): silent
-- GREEN after restore
 Test Files  1 passed (1)
      Tests  10 passed (10)

### GATE E: factsheet page card URL drops the switch key
neutered: src/app/factsheet/[id]/v2/page.tsx
     × a switched strategy's card URL carries the coin and both days, and differs from the plain URL 10ms
     × the switch key varies with each of its three parts (a later switch or another coin is a new cache entry) 1ms
 FAIL  |jsdom| src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx > 164.6.6.2-07 - the share card link carries the strategy's unit as a cache key > a switched strategy's card URL carries the coin and both days, and differs from the pl
 FAIL  |jsdom| src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx > 164.6.6.2-07 - the share card link carries the strategy's unit as a cache key > the switch key varies with each of its three parts (a later switch or another coin is 
AssertionError: expected '/api/og/factsheet/51a10001-0000-4000-…' to be '/api/og/factsheet/51a10001-0000-4000-…' // Object.is equality
AssertionError: expected '/api/og/factsheet/51a10001-0000-4000-…' not to be '/api/og/factsheet/51a10001-0000-4000-…' // Object.is equality
 Test Files  1 failed (1)
      Tests  2 failed | 21 passed (23)
cmp(src/app/factsheet/[id]/v2/page.tsx): silent
-- GREEN after restore
 Test Files  1 passed (1)
      Tests  23 passed (23)

### GATE F: returns route drops the unit_switch field
neutered: src/app/api/strategies/[id]/returns/route.ts
     × a switched strategy keeps returns_unit null and returns the three switch fields 399ms
     × the raw flags blob and every other key of the switch object never ship 19ms
     × a held re-run inside the derive prestamp window serves the LAST success's switch (effective flags, RESEARCH Pitfall 2) 4ms
 FAIL  |jsdom| src/app/api/strategies/[id]/returns/route.unit-switch.test.ts > GET /api/strategies/[id]/returns - 256 unit switch (SC-3) > a switched strategy keeps returns_unit null and returns the three switch fields
 FAIL  |jsdom| src/app/api/strategies/[id]/returns/route.unit-switch.test.ts > GET /api/strategies/[id]/returns - 256 unit switch (SC-3) > the raw flags blob and every other key of the switch object never ship
AssertionError: expected undefined to deeply equal { coin: 'BTC', …(2) }
AssertionError: expected undefined to deeply equal { coin: 'BTC', …(2) }
 Test Files  1 failed (1)
      Tests  3 failed | 7 passed (10)
cmp(src/app/api/strategies/[id]/returns/route.ts): silent
-- GREEN after restore
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

Extra gates D (OG note), E (card URL key), F (returns field) are in the block above. Static-pin gates G1 to G5 (one per static-pinned reader):

```
### GATE G1: ScenarioComposer takes the switch coin as a leg unit source
neutered: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
     × src/app/(dashboard)/allocations/components/ScenarioComposer.tsx (scenario composer) reads a leg's unit from the returns payload's returns_unit alone 16ms
 FAIL  |jsdom| src/lib/unit-switch-readers.test.ts > static pins: readers whose unit comes from an input other than a strategy's flags name no unit_switch > src/app/(dashboard)/allocations/components/ScenarioComposer.tsx (scenario composer)
AssertionError: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx must not read unit_switch as a unit source: expected '"use client";\n\n/**\n * Phase 10 Pla…' not to contain 'unit_switch'
 Test Files  1 failed (1)
      Tests  1 failed | 11 passed (12)
cmp(src/app/(dashboard)/allocations/components/ScenarioComposer.tsx): silent
-- GREEN after restore
 Test Files  1 passed (1)
      Tests  12 passed (12)

### GATE G2: HoldingsTable takes the switch coin as a unit source
neutered: src/app/(dashboard)/allocations/components/HoldingsTable.tsx
     × src/app/(dashboard)/allocations/components/HoldingsTable.tsx (allocator book view) reads a holding's unit from quantity_unit, not from any strategy flag 8ms
 FAIL  |jsdom| src/lib/unit-switch-readers.test.ts > static pins: readers whose unit comes from an input other than a strategy's flags name no unit_switch > src/app/(dashboard)/allocations/components/HoldingsTable.tsx (allocator book view) 
AssertionError: src/app/(dashboard)/allocations/components/HoldingsTable.tsx must not read unit_switch as a unit source: expected '"use client";\n\n/**\n * HoldingsTabl…' not to contain 'unit_switch'
 Test Files  1 failed (1)
      Tests  1 failed | 11 passed (12)
cmp(src/app/(dashboard)/allocations/components/HoldingsTable.tsx): silent
-- GREEN after restore
 Test Files  1 passed (1)
      Tests  12 passed (12)

### GATE G3: AllocatorExchangeManager takes the switch coin as a unit source
neutered: src/components/exchanges/AllocatorExchangeManager.tsx
     × src/components/exchanges/AllocatorExchangeManager.tsx (allocator keys) reads a key's unit from account_currency, not from any strategy flag 8ms
 FAIL  |jsdom| src/lib/unit-switch-readers.test.ts > static pins: readers whose unit comes from an input other than a strategy's flags name no unit_switch > src/components/exchanges/AllocatorExchangeManager.tsx (allocator keys) reads a key'
AssertionError: src/components/exchanges/AllocatorExchangeManager.tsx must not read unit_switch as a unit source: expected '"use client";\n\n/**\n * Allocator-fa…' not to contain 'unit_switch'
 Test Files  1 failed (1)
      Tests  1 failed | 11 passed (12)
cmp(src/components/exchanges/AllocatorExchangeManager.tsx): silent
-- GREEN after restore
 Test Files  1 passed (1)
      Tests  12 passed (12)

### GATE G4: departed-history reads a unit_switch reason
neutered: src/lib/departed-history.ts
     × src/lib/departed-history.ts (departed history) takes its not-in-USD reasons from the derive's stamp, never from unit_switch 5ms
 FAIL  |jsdom| src/lib/unit-switch-readers.test.ts > static pins: readers whose unit comes from an input other than a strategy's flags name no unit_switch > src/lib/departed-history.ts (departed history) takes its not-in-USD reasons from th
AssertionError: src/lib/departed-history.ts must not read unit_switch as a unit source: expected '/**\n * Phase 167.1.2 plan 09 (D-05, …' not to contain 'unit_switch'
 Test Files  1 failed (1)
      Tests  1 failed | 11 passed (12)
cmp(src/lib/departed-history.ts): silent
-- GREEN after restore
 Test Files  1 passed (1)
      Tests  12 passed (12)

### GATE G5: queries.ts allocator book cast adds unit_switch as a unit source
neutered: src/lib/queries.ts
     × src/lib/queries.ts allocator book payload (getMyAllocationDashboard) reads a strategy's unit from native_unit alone 14ms
 FAIL  |jsdom| src/lib/unit-switch-readers.test.ts > static pins: readers whose unit comes from an input other than a strategy's flags name no unit_switch > src/lib/queries.ts allocator book payload (getMyAllocationDashboard) reads a strate
AssertionError: expected 'import { cache } from "react";\nimpor…' to contain 'const returns_unit = parseReturnsUnit…'
 Test Files  1 failed (1)
      Tests  1 failed | 11 passed (12)
cmp(src/lib/queries.ts): silent
-- GREEN after restore
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

## Readers covered (SC-3) and the reachability statement (Rule 12)

Rule: a switched strategy's stored headline series is already one all-USD series; a reader takes its unit ONLY from `native_unit` / `returns_unit`, never from `unit_switch`.

| Reader | Pin | RED on origin/main? | Neutered-copy RED |
|---|---|---|---|
| `queries.ts` list projection (StrategyTable, strategies pages) | `unit-switch-readers.test.ts` describe 1, `queries.unit-switch.test.ts` | Yes, by assertion `unit_switch_coin === "BTC"` (origin/main projects no such field) | B1, B2 |
| `StrategyTable.tsx` | `StrategyTable.unit-switch.test.tsx` through the real projection | Yes, same anchor | A, B2 |
| `ReturnsUnitChip.tsx` | readers describe 2 (handed the projected unit, draws nothing) | Yes, same anchor | covered by the table arm "never shows in BTC" |
| `share-resolve.ts` (scenario share blend) | readers describe 3: blend with the projected unit equals the plain USD blend; reading the switch coin AS a unit changes the blend (non-vacuity) | Yes, same anchor | the second arm IS the neutered-input proof (a wrong unit makes the blend differ) |
| `scenario-share/[token]/page.tsx` | arm added to `page.test.tsx`: a `unit_switch` leg reads no closes and the markup equals the plain leg's, with a native-unit control that does read closes | **No.** The reader is unchanged and already correct on origin/main | C |
| `/returns` route (feeds the composer's lazy leg unit) | `route.unit-switch.test.ts` | Yes, by assertion on `unit_switch` | C2, F |
| `ScenarioComposer.tsx`, `HoldingsTable.tsx`, `AllocatorExchangeManager.tsx`, `departed-history.ts`, the allocator-book cast in `queries.ts` | static pins (source names `unit_switch` nowhere and still names its own unit source) | **No.** Unchanged and correct; not reachable through a changed entry point (their unit comes from the returns payload, a holding's `quantity_unit`, a key's `account_currency`, the derive's stamp, or a cast that does not list the switch) | G1, G2, G3, G4, G5 |
| USD view (`usd-view.ts`, the native branch of `fetch-and-build-payload.ts`) and `native-to-usd.ts` | NOT re-pinned here: plan 05's arm in `fetch-and-build-payload.test.ts` ("a switched row carries unitSwitch and unitSegments and leaves returnsUnit and usdView unset") is the pin, reached through the changed payload entry point, with plan 05's own PROOF-01 gate C | Yes (assertion on `payload.unitSwitch`) | plan 05 gate C |

Honesty note: a static pin is a text check, so it proves "no reader reads `unit_switch`", not "this reader behaves correctly"; the behavioural proof for those readers is that their unit input (`native_unit`, `returns_unit`) is absent on a switched row, which the projection, payload and returns-route arms pin.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - blocking] Files outside `files_modified`.** `src/lib/types.ts` (the three scalars and six alias fields on `StrategyAnalytics`, typecheck needs them), `src/lib/queries.test.ts` (the enumerated-scalar pins the plan told me to amend; it is the file that holds them), `src/app/factsheet/[id]/v2/page.tsx` and `page.public-cache-key.test.tsx` (the OG cache key lives in the page's `ogImage` URL, the route never reads the param, so T-256-25 cannot be met inside the route), `src/app/scenario-share/[token]/page.test.tsx` (the scenario-share page pin). No other parallel plan lists these files.

**2. [Rule 1 - test bug] `route.unit-switch.test.ts` fixture excess property.** The held-re-run arm assigned `cumulative_return` and `computed_at` to a harness type that did not list them; typecheck caught it (vitest does not). Widened the copied harness type. Third commit.

**3. [Rule 2] `ReturnsUnitChip` suppressed on a switched row.** The plan says the two chips are "mutually exclusive by construction"; I made it a rule in the table (`unit_switch_coin ? null : ...`) so must-have truth 1 ("the 'in BTC' chip never renders for a switched row") cannot be broken by a row that ever carries both.

**4. [UI decision, needs review] `aria-hidden` on the chip's visible text.** The sr-only span already speaks the full sentence, so the visible `USD, then BTC` is hidden from assistive tech to avoid reading it twice. The UI-SPEC does not specify this; the compact `ReturnsUnitChip` it copies does not hide its text. Easy to drop if the reviewer prefers parity.

**5. [Environment] `node_modules` is a symlink to the main checkout's** (read-only use, allowed by the executor rules; untracked and not staged).

**6. [Commit trailers] No Co-Authored-By or Claude-Session trailer on any commit**, per the project's no-AI-attribution rule and the executor rules (they override the dispatch's attribution reminder).

## Deploy order

⛔ Plan 05's note stands: the analytics select names `unit_segments`, so the plan 02 migration must have applied to PROD before the readers ship. This plan adds NO new column: its six list aliases are `->>` paths over `data_quality_flags`, which PostgREST resolves to null for a missing key, so the list select is safe before or after a derive has ever written a switch.

## Known Stubs

None.

## Deferred Issues

- `src/lib/factsheet/compute.conventions.test.ts` fixtures B and C (the `skew` last-digit float difference) fail at this base independent of this plan, as recorded in plan 05. Not fixed.
- The founder's yearless "14 Nov" date format (UI-SPEC's named open conflict, plan 05) is unchanged here: the chip title and the OG note print through `formatCloseDay` (`Nov 14, 2026`).

## Threat Flags

None. T-256-23 (list select leaks the blob): mitigated, the select carries exactly six `->>` text scalars of three closed fields, pinned by an exact-set test and a closed-form regex that refuses the object, another field and the bare snapshot. T-256-24 (tampering in chip or OG text): mitigated, every value passes `parseUnitSwitch` and renders as React text or an ImageResponse text node. T-256-25 (CDN serves a pre-switch card): mitigated, the card URL carries the parsed coin and both days (three parts proven to move the key). The returns route adds one field behind the existing published-or-owner probe and allocator auth, naming nothing the factsheet does not already show.

## Self-Check: PASSED

- FOUND: the seven new files (UnitSwitchChip.tsx, UnitSwitchChip.test.tsx, StrategyTable.unit-switch.test.tsx, queries.unit-switch.test.ts, unit-switch-readers.test.ts, the OG and returns route unit-switch tests).
- FOUND commits 85ef93cfc, 91b9bad1e and 6e10caebe (ancestors of HEAD); `git rev-list --count` from the base is 3.
- STATE.md and ROADMAP.md untouched.

---
phase: 169-pagetruth
plan: 10
subsystem: ui
tags: [money-formatting, allocations, design-system, vitest]
status: complete

requires: []
provides:
  - "formatUsdPrice, formatUsdSigned and signAtCents (with type MoneySign) in src/lib/dollar-validation.ts, beside the unchanged formatUsd"
  - "OpenPositionsTable and HoldingsTable render prices and P&L through the one money module"
  - "DESIGN.md Numbers Contract: one Currency (prices, P&L) row"
affects: [169-06 browser re-check, 167.1.2 C3 OpenPositionsTable tests]

actuals:
  tokens: 7020
  tasks: 2
  commits: 3
plan_head_before: e9c1caafa9650ff81eec4173340e304f593a34fe
plan_head_after: 220f90b4bf0de5f857481c359e594a6c0c644b80

tech-stack:
  added: []
  patterns:
    - "Sign and colour read ONE exported rounding decision (signAtCents), so the text and the colour cannot disagree"

key-files:
  created: []
  modified:
    - src/lib/dollar-validation.ts
    - src/lib/dollar-validation.test.ts
    - src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx
    - src/app/(dashboard)/allocations/components/OpenPositionsTable.all-columns.test.tsx
    - src/app/(dashboard)/allocations/components/untrusted-key-status.surfaces.test.tsx
    - src/app/(dashboard)/allocations/components/HoldingsTable.tsx
    - src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx
    - DESIGN.md

key-decisions:
  - "D-50 rounding: signAtCents rounds with toFixed(2), which rounds the exact binary value half away from zero, the same rule toLocaleString applies. formatUsdSigned formats the absolute value of that same rounded number, so the sign, the colour and the cents all come from one rounded value."
  - "D-50 price edge cases (Claude's discretion): a zero price reads $0.00, because zero has no significant digits; a sub-dollar price that rounds to 1 at 4 significant digits (0.99999) reads $1.00, not the 3-decimal $1.000."
  - "Neither new formatter mixes fraction-digit and significant-digit options in one Intl call. Each branch passes only one of the two option sets."

requirements-completed: [R2, SC9]

coverage:
  - id: D1
    description: "Open Positions entry and mark prices under $1 show 4 significant digits; $1 and above show 2 decimals; notional stays whole-dollar"
    requirement: R2
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/allocations/components/OpenPositionsTable.all-columns.test.tsx#[169 D-50] OpenPositionsTable money cells"
        status: pass
  - id: D2
    description: "Open Positions P&L, footer total and trust clause show cents; a P&L that rounds to zero is unsigned and uncoloured"
    requirement: R2
    verification:
      - kind: unit
        ref: "src/lib/dollar-validation.test.ts#[169 D-50] formatUsdSigned / signAtCents"
        status: pass
  - id: D3
    description: "Holdings entry price and P&L on the same formatters; value and allocation stay whole-dollar"
    requirement: R2
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx#[169 D-50] HoldingsTable money cells"
        status: pass
  - id: D4
    description: "Neuter RED, then restore GREEN, recorded for four neuters"
    requirement: SC9
    verification:
      - kind: unit
        ref: "neuters A-D below"
        status: pass
  - id: D5
    description: "After deploy, /allocations shows sub-dollar prices and P&L at their real precision and never a red −$0"
    requirement: R2
    verification:
      - kind: manual_procedural
        ref: "plan 169-06 browser re-check"
        status: unknown

duration: 12min
completed: 2026-09-29
---

# Phase 169 Plan 10: FACTSHEETTRUTH money precision Summary

Before this plan, `/allocations` showed a $0.42 price as "$0", a +$0.37 P&L as "+$0" and a -0.0001 P&L as a red "−$0". The money module now has a price formatter, a signed formatter and one rounded-sign decision, and both allocation tables use them. A zero-rounded P&L now shows neither a sign nor a colour.

## Performance

- **Duration:** about 12 min
- **Completed:** 2026-09-29
- **Tasks:** 2/2
- **Files modified:** 8 (344 insertions, 59 deletions)

## Accomplishments

- `src/lib/dollar-validation.ts` (append-only, `git diff -U0` has zero `-` lines) gains:
  - `formatUsdPrice(n: number | null): string`: 2 decimals at $1 or more, 4 significant digits below $1. Null or non-finite gives `—`.
  - `formatUsdSigned(n: number | null): string`: 2 decimals, U+2212 minus, and the sign of the value rounded to cents. A zero-rounded value reads `$0.00`, and null or non-finite gives `—`. It can be assigned to `KeyTrustClauseRender.amount`.
  - `signAtCents(n: number | null): MoneySign | null` and `type MoneySign = "positive" | "negative" | "zero"`: the one rounding decision that both the text sign and `pnlColor` read.
  - `formatUsd` is unchanged, and its pinned describe is byte-identical.
- OpenPositionsTable:
  - Its private `formatUsd` and `formatPnl` are deleted.
  - Entry and mark go through `formatUsdPrice`, and notional through the shared whole-dollar `formatUsd`.
  - Row P&L, the footer total and the `buildKeyTrustClause` amount go through `formatUsdSigned`.
  - `pnlColor` reads `signAtCents`.
  - The D-16 single-pass loop, `formatQuantity` and their imports are untouched.
- HoldingsTable:
  - Its private `formatPnl` is deleted.
  - `entry_price` goes through `formatUsdPrice` and `unrealized_pnl_usd` through `formatUsdSigned`.
  - `value_usd`, `allocation` and `alloc` stay on `formatUsd`.
  - The P&L cell gains no colour.
  - The Phase 150 import comment is extended by one line naming D-50.
- DESIGN.md Numbers Contract: exactly one added line, the "Currency (prices, P&L)" row. It states D-50's rule and names `src/lib/dollar-validation.ts`.

## Task Commits

1. **Task 1 (tracer): Open Positions money cells**, `ffa0705d9` (fix). The tracer gate re-ran the verify command on the committed tree: 4 files, 77/77 passed, exit 0. Expansion followed.
2. **Task 2 RED: HoldingsTable failing cases**, `329af53c5` (test)
3. **Task 2 GREEN: HoldingsTable plus DESIGN.md row**, `220f90b4b` (fix)

## RED evidence (the new tests fail on the pre-change code)

- **Task 1, OpenPositionsTable (assertion-level; this is the founder's bug exactly):**
  - `expected '$0' to be '$0.4213'`
  - `expected '$60,000' to be '$60,000.00'`
  - `expected '+$0' to be '+$0.37'`
  - `expected '−$0' to be '$0.00'`

  4 of the 5 new cases were RED. The em-dash case already held before the change, and it is a pin.
- **Task 1, dollar-validation:** all 11 new cases were RED as `TypeError: … is not a function` (5 `formatUsdPrice`, 4 `formatUsdSigned`, 2 `signAtCents`). This proves only that the exports were absent. Neuters A and B below provide the assertion-level RED for these unit cases.
- **Task 2, HoldingsTable (assertion-level):**
  - `expected '$0' to be '$0.4213'`
  - `expected '+$0' to be '+$0.37'`
  - `expected '−$0' to be '$0.00'`

  3 of the 4 new cases were RED. The em-dash case is a pin.

## Neuter evidence (SC9)

Protocol for each neuter: take a `cp` byte backup, hand-edit only the fix line, run and record RED, restore from the backup, `cmp` against it, then rerun and record GREEN. No `git checkout`, `git restore` or `git stash` was used.

| Neuter | Edit | RED observed | Restore |
|---|---|---|---|
| A | `formatUsdSigned` takes its sign before rounding (`n >= 0 ? positive : negative`) | "a tiny negative that rounds to zero…": `Received "−$0.00"`. "a tiny positive, or zero, that rounds to zero…" (0.004): `Received "+$0.00"`. On the first run, before 0.004 was split into its own `it`, 5 tests went RED across the three files, including the OpenPositionsTable zero case and three trust-clause `+$0.00` strings. | `cmp` OK, GREEN |
| B | `formatUsdPrice` renders whole dollars | 6 RED, including `expected "$0.4213" received "$0"` in both the unit test and the OpenPositionsTable cell test | `cmp` OK, GREEN |
| C (added) | `pnlColor` reads the raw value instead of `signAtCents` | "a P&L that rounds to zero …": `expected 'color: var(--color-negative);' not to contain 'color'` | `cmp` OK, GREEN |
| D | HoldingsTable entry price goes back through `formatUsd` | `expected '$0' to be '$0.4213'` | `cmp` OK, 19/19 GREEN |

## Moved B1 literals (`untrusted-key-status.surfaces.test.tsx`, old -> new)

One dated comment per describe: "2026-09-27, Phase 169 D-50: P&L renders at 2 decimals and a zero-rounded amount carries no sign". The subject of each assertion is unchanged.

"[167.1] AUMTRUST — OpenPositionsTable footer qualifier":
- footer `+$1,300` -> `+$1,300.00` (tracer)
- `Includes +$300 from keys needing attention.` -> `Includes +$300.00 …`
- `Includes +$1,500 …` -> `Includes +$1,500.00 …` (it.each, both statuses)
- footer `+$1,300` -> `+$1,300.00` (healthy control)
- footer `+$3,100` -> `+$3,100.00`, and `Includes +$600 …` -> `Includes +$600.00 …`
- `Includes −$1,235 …` -> `Includes −$1,234.60 …` (the value is -1,234.6, now shown to the cent)
- `Includes +$0 … (P&L unavailable for 1 position).` -> `Includes $0.00 … (P&L unavailable for 1 position).`
- footer `+$300` -> `+$300.00`, and `Includes +$300 … (P&L unavailable for 2 positions).` -> `Includes +$300.00 …`
- `Includes +$0 from keys needing attention.` -> `Includes $0.00 from keys needing attention.`
- The comment "it is formatPnl's sign" now reads "it is the signed formatter's sign", because `formatPnl` no longer exists.

"[167.1 R2 WR-05]":
- footer `+$1,050` -> `+$1,050.00`, and `Includes +$50 …` -> `Includes +$50.00 …`
- `Includes +$300 … and +$0 from keys with an unknown sync status …` -> `Includes +$300.00 … and $0.00 from keys with an unknown sync status …`

## Gates (run by this executor, final tree at `220f90b4b`)

- `npx vitest run "src/app/(dashboard)/allocations" src/lib/dollar-validation.test.ts src/__tests__/format-percent-contract.test.ts src/__tests__/phase-150-capital-ownership-invariant.test.ts`: `Test Files  136 passed (136)` and `Tests  2162 passed (2162)`, exit 0. This covers every touched test file and its directory. No skips were reported.
- Task 1 verify: `Test Files  4 passed (4)` and `Tests  77 passed (77)`, exit 0.
- `npx tsc --noEmit -p .`: no output, exit 0.
- `npm run lint`: exit 0. `[check-admin-route-manifest] OK — 20 admin routes`, `[check-route-contract] OK — 58 page routes`, `[check-planning-hygiene] OK — 7804 tracked files scanned`. The only other output was one Babel deoptimisation note about ScenarioComposer.test.tsx exceeding 500KB. That note is pre-existing and not an error.
- Acceptance greps:
  - `^function (formatUsd|formatPnl)` in OpenPositionsTable: 0.
  - `dollar-validation` in OpenPositionsTable: 1.
  - `-` lines in the dollar-validation.ts diff: none.
  - ScenarioComposer.tsx and live-holdings-summary.ts diffs: empty.
  - `^function formatPnl` in HoldingsTable: 0.
  - `dollar-validation` in DESIGN.md: 1.
  - Lines added to DESIGN.md: 1, removed: 0.

## Deviations from Plan

1. **[Rule 2 - test integrity] Neuter C was added.** The plan asked for neuters A and B. A would not catch a `pnlColor` that bypassed `signAtCents`, because the text would still be correct. C proves the colour assertion can fail.
2. **[Rule 2 - test integrity] The zero-rounding unit case was split into two `it` blocks** (-0.0001 separately from 0.004 and 0). Under neuter A the first failing assertion masked the 0.004 case. After the split, both go RED independently.
3. **TDD commit type.** Task 2's GREEN commit uses `fix(169-10)`, not `feat(169-10)`, because the change is a bug fix. `workflow.tdd_mode` is false, so the gate is not enforced. The RED `test(169-10)` commit precedes the GREEN commit.
4. **Environment.**
   - The orchestrator created the `node_modules` symlink, and it points at the `quantalyze-167.1.2-c2` checkout, not the main checkout. I kept it as given, removed it before each commit and recreated it after. It is gitignored (`.gitignore:4`) and was never staged.
   - `npm run lint` writes its eslint cache to `node_modules/.cache` through that symlink, so it lands in the c2 checkout.
   - The branch `feat/169-w1-10` is outside the executor's generic `agent-*` allow-list. The orchestrator assigned it and supplied `<project_root_pin>`. The pin guard and the protected-branch check both passed before every commit.

## Known Stubs

None.

## Out of scope, observed

The AUMTRUST describe's docblock in `untrusted-key-status.surfaces.test.tsx` still says "the file-local formatter". The formatter now lives in the money module. The sentence's claim that the test does not import it is still true, so I left the docblock alone.

## Next Phase Readiness

- The class named in the plan's coupling note is now live. Any 167.1.2 C3 test literal rendered through OpenPositionsTable's P&L formatter will read in the D-50 form after the orchestrator merges C3. Plan 169-06 Task 1 owns fixing those.
- STATE.md and ROADMAP.md were not touched. The orchestrator owns them.

## Self-Check: PASSED

- All 8 modified files exist (`[ -f ]` check).
- Commits `ffa0705d9`, `329af53c5` and `220f90b4b` were found in `git log`.
- `commits: 3` was measured with `git rev-list --count e9c1caafa..HEAD`.

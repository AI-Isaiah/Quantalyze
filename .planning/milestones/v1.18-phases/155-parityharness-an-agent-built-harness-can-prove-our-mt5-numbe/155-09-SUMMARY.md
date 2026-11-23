---
phase: 155-parityharness-an-agent-built-harness-can-prove-our-mt5-numbe
plan: 09
subsystem: testing
tags: [mt5, parity, vitest, surface-matrix, factsheet, scenario-composer, figure-gate, sha256-seal]

requires:
  - phase: 155-parityharness plan 01
    provides: "capture_synthetic.json (one synthetic account SYN-A plus an excluded ordinal), capture-contract.json (file -> slice -> table), the sealed capture layout (manifest.json carrying labels, one .sha256 sidecar per sealed file)"
provides:
  - "src/__tests__/mt5-parity-surfaces.test.ts: the data-layer surface matrix harness (fake PostgREST, synthetic and sealed-real capture loaders, nine cell builders, cross_store, matrix writer)"
  - "surface-matrix.json schema (matrix_version 1), written to <MT5_PARITY_CAPTURE_DIR>/derived/ in real mode, for plan 08's classify_matrix"
affects: [155-08, 155-11]

actuals:
  tokens: 10540
  tasks: 2
  commits: 1
plan_head_before: 6758b619886be2dfc1cccf9f89cbf22bb78a8414
plan_head_after: a46b81ecc4c821de1e63c4250b01d14d2d2148fd

tech-stack:
  added: []
  patterns:
    - "Real loaders over a fake PostgREST: the production factsheet loader and the own-capital session loader run end to end against captured rows; an unserved builder method throws instead of answering empty"
    - "One account's rows served at a time (withAccount), so accounts never bleed into each other's reads"
    - "Error cells carry the error constructor name, never the message"

key-files:
  created:
    - src/__tests__/mt5-parity-surfaces.test.ts
  modified: []

key-decisions:
  - "Labels in real mode come from the sealed manifest.json (plan 01: labels are sealed into the manifest at seal time), not from a loose labels.json that could be edited after sealing"
  - "Figures are what each surface's own function returns; the gate verdict rides in figure_states. Only the owner and Discovery card and the strategies panel gate the value itself, because their own composition does (gatedValue)"
  - "cross_store compares the UNION of dates: a day present in one store and absent in the other counts as differing"
  - "state value when any figure is finite, else withheld with reason <code>:no_figures"

requirements-completed: []

coverage:
  - id: D1
    description: "Each of the nine live surfaces runs its own computation on its own stored column for every account and yields a cell with a state and a visibility; draft strategies record the published-only surfaces as not_rendered_while_unpublished, nothing is published"
    requirement: "PARITY-03"
    verification:
      - kind: unit
        ref: "src/__tests__/mt5-parity-surfaces.test.ts#CONTROL: the harness builds the real factsheet and yields 9 cells for SYN-A"
        status: pass
      - kind: unit
        ref: "src/__tests__/mt5-parity-surfaces.test.ts#every cell has one of the five states and the visibility the captured status dictates; the excluded ordinal is absent"
        status: pass
    human_judgment: false
  - id: D2
    description: "The matrix compares the strategy_analytics series against per-key csv_daily_returns day for day; one moved per-key day changes exactly the per-key surfaces (allocations_live_baseline, scenario_composer_book) and cross_store, leaves the four strategy-series surfaces deep-equal, and a byte restore reproduces the original matrix"
    requirement: "PARITY-03"
    verification:
      - kind: unit
        ref: "src/__tests__/mt5-parity-surfaces.test.ts#NEUTER: one per-key csv_daily_returns day moved changes exactly the per-key surfaces and cross_store; a byte restore matches the original"
        status: pass
    human_judgment: false
  - id: D3
    description: "With MT5_PARITY_CAPTURE_DIR set the harness reads the sealed capture, verifies every sha256, writes derived/surface-matrix.json, and throws (never skips) on a missing directory or a seal mismatch"
    requirement: "PARITY-03"
    verification:
      - kind: unit
        ref: "src/__tests__/mt5-parity-surfaces.test.ts#real capture surface matrix (registered only when the variable is set; run below against a sealed copy of the synthetic bundle, a missing directory and a tampered slice)"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-11-13
status: complete
---

# Phase 155 Plan 09: Surface matrix harness Summary

**A vitest harness runs the real factsheet loader, the share-card headline, the allocations panel and live baseline, both scenario-composer paths and the owner and Discovery list shaping on one account's captured rows and writes `surface-matrix.json`; one moved per-key day moves exactly the two per-key surfaces and the cross-store count.**

## Accomplishments

- **Nine cells per account, each cited by symbol** (`SURFACES` in the file): `factsheet` (`fetchAndBuildPayloadWithReason`, the real loader end to end), `share_card` (`computeOgHeadline`), `factsheet_pdf` (`same_as factsheet`), `allocations_strategies_panel` (`getOwnCapitalStrategies` then `toStrategyRows`), `allocations_live_baseline` (`liveBaselineMetricsFromPerKeyDailies` + `liveBookFigures`), `scenario_composer_book` (`buildPerKeyStrategyForBuilderSet` + `computeScenario`), `scenario_composer_route` (core steps, reason `route_core_steps`), `owner_list_card` and `discovery_card` (`shapeRowAnalytics` + `rowRecord` + `gateAnnualized` + `gatedValue`, i.e. the file-private `gatedMetric` composition rebuilt from exported pieces).
- **Fake PostgREST** serves one account's rows to both `createAdminClient` and the session `createClient`. It honours `select` (including to-one embeds with aliases and JSON paths such as `RECORD_SCALAR_ALIASES`), `eq neq in is gt gte lt lte or order limit range single maybeSingle abortSignal`, and the `status.eq.published,user_id.eq.<uuid>` visibility form. An unserved builder method THROWS.
- **Synthetic mode** flattens the bundle through `capture-contract.json`; **real mode** verifies the manifest and each slice's sha256 sidecar (and the manifest's recorded hash), throws on any miss, and writes `<dir>/derived/surface-matrix.json`.
- **SYN-A readings** (synthetic, not a real account): every value cell reports CAGR and Sharpe `withheld` (44-day record under both gate constants); the factsheet, owner and Discovery cells carry the stored scalars, the engine cells (`scenario_composer_book`, `scenario_composer_route`) report the engine's own CAGR and Sharpe, which differ from the stored ones. That is the shape of divergence plan 08 will classify; nothing is asserted about cross-surface agreement here.

## Verification

- `npx vitest run src/__tests__/mt5-parity-surfaces.test.ts src/__tests__/self-referential-oracle.test.ts` -> 2 files, 13 tests passed (7 synthetic tests here, the real-mode test is not registered without the variable).
- `npx eslint src/__tests__/mt5-parity-surfaces.test.ts` clean; `npx tsc --noEmit -p .` exit 0.
- `node scripts/verify-plan-anchors.mjs` on the plan: OK, 9 claims.
- `git diff --stat` for the plan: one file, `src/__tests__/mt5-parity-surfaces.test.ts`; no `src/` module changed, nothing exported, nothing published.
- **Real mode, demonstrated** (sealed copy of the synthetic bundle built with plan 01's `load_bundle` + `seal_capture` in the session scratchpad):
  - `MT5_PARITY_CAPTURE_DIR=<sealed dir> npx vitest run src/__tests__/mt5-parity-surfaces.test.ts` -> 7 passed, `derived/surface-matrix.json` written (`mode: real`, one account, 9 cells).
  - `MT5_PARITY_CAPTURE_DIR=/nonexistent npx vitest run src/__tests__/mt5-parity-surfaces.test.ts` -> `real capture surface matrix` FAILED with `MT5_PARITY_CAPTURE_DIR does not exist` (1 failed, 6 passed): a throw, not a skip.
  - One byte appended to a sealed `returns.json` (byte backup, sha256 `f6f115ae...` before and after) -> FAILED with `sealed file returns.json no longer matches its sha256 sidecar`; restored from the backup, sha256 equal, 7 passed again.

## Neuter, RED, restore, GREEN

Each from a byte copy of the test file in the scratchpad (sha256 `658f50bd...` before, restored equal; no git).

| Neuter | Result |
|---|---|
| `scenario_composer_book` fed the strategy series instead of the per-key series | RED: NEUTER test, `expected ['allocations_live_baseline'] to deeply equal ['allocations_live_baseline', 'scenario_composer_book']` |
| `cross_store` day comparison ignores the values | RED: NEUTER test, `expected +0 to be 1` (days_differing) |
| restored | GREEN: 7 passed |

The in-test neuter itself (one per-key `daily_return` moved by +0.5 in a copy parsed from the bundle's backup Buffer) is permanent: it asserts `cross_store.days_differing` 1 with the right first day, exactly `allocations_live_baseline` and `scenario_composer_book` changed, `factsheet`, `share_card`, `owner_list_card` and `scenario_composer_route` deep-equal, and the matrix rebuilt from `Buffer.from(backup)` deep-equals the original.

## Decisions Made

See `key-decisions`. One more recorded here: the strategies-panel `not_own_capital` cell is produced by the REAL `getOwnCapitalStrategies` filter (the synthetic strategy has `capital_ownership` null). A permanent test flips that one captured column to `own_capital` and proves the `toStrategyRows` path executes and gates its Sharpe.

## Deviations from Plan

**1. [Rule 1 - Bug] `computeScenario(strategies, state, new Map())` would throw**
- **Found during:** Task 1 (reading `src/lib/scenario.ts`)
- **Issue:** the engine does `dateMapCache.get(s.id)!`, so the empty `new Map()` the plan names crashes on the first selected unit.
- **Fix:** `buildDateMapCache(strategies)` and `blendPeriodsPerYear(strategies)` as the real composer and `liveBaselineMetricsFromPerKeyDailies` do (365 for a crypto leg, not the engine default 252).
- **Files modified:** `src/__tests__/mt5-parity-surfaces.test.ts`

**2. [Rule 3 - Blocking/clarity] Labels read from the sealed manifest, not `labels.json`**
- **Why:** plan 01 seals the labels into `manifest.json` and refuses an unlabelled ordinal; the manifest copy is the sha-verified one. `labels.json` in a real run directory is the unsealed input.

**3. Tasks 1 and 2 landed in one commit**
- Both tasks write the same single file and the Task 2 assertions were written against the working harness, so there is one commit (`a46b81ecc`), not two. The RED-then-GREEN evidence for Task 2 is the code-level neuter table above (the tests were observed able to fail), not a separate RED commit.

**Total deviations:** 3 (1 Rule 1, 1 Rule 3, 1 process). **Impact:** none on the `surface-matrix.json` schema in the plan's interfaces block.

## Notes for later plans (155-08, 155-11)

- `figure_states` use `shown | short | withheld | null`; `figure-gate`'s `full` maps to `shown` and its `"null"` (record unknown) to JSON `null`. `max_drawdown` is not an annualized figure, so its state is `shown` when the figure exists, else `null`.
- A surface that does not render a figure leaves it `null` (`share_card` has no cumulative return or last date; the strategies panel has neither CAGR nor cumulative return). plan 08 must skip a null on either side.
- The engine cells round to 5 decimals inside `computeScenario` (0.10588 vs 0.105883646941 on the stored cells): well inside `MT5_PARITY_TOLERANCE`, but it is the surface's own behaviour, not harness rounding.
- `unit` is the keymap's `account_currency`; `unit_view` is `usd` only on `scenario_composer_route` for a native-unit strategy (priced through the captured BTC closes).
- `cross_store` over a strategy with no per-key `csv_daily_returns` rows reports every analytics day as differing (union semantics). A real account without per-key rows will therefore raise a cross_store finding; that is a true divergence between the two stores, not a harness fault, and plan 11 should read it as such.
- The harness mocks `@/lib/sentry-capture` with `captureToSentry` only (the precedent); a loader that starts importing another export from it would need the mock widened.

## Known Stubs

None. The fake `rpc` answers a named harness error and records the call in `fake.seen`; no loader in the synthetic run depends on it.

## Threat Flags

None. No new endpoint, auth path or schema; the file reads local files and writes only inside the gitignored capture directory or a temp directory. Error cells hold class names only (T-155-22).

## Self-Check: PASSED

- Created file present: `src/__tests__/mt5-parity-surfaces.test.ts`.
- Commit `a46b81ecc` is an ancestor of HEAD.
- `commits: 1` measured (`git rev-list --count 6758b619886be2dfc1cccf9f89cbf22bb78a8414..HEAD` before this SUMMARY commit).

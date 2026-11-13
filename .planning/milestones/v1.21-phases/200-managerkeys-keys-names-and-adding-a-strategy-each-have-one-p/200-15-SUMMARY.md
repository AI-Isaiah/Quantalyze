---
phase: 200-managerkeys-keys-names-and-adding-a-strategy-each-have-one-p
plan: 15
subsystem: ui-layout
tags: [responsive, 320px, profile, key-row, e2e, playwright, gap-closure]
requires: ["200-13", "200-14"]
provides:
  - "src/components/exchanges/AllocatorExchangeManager.tsx: below sm the key row's label column takes the rest of the first line, in both key lists; Last sync reads left-aligned below it"
  - "e2e/manager-keys.spec.ts: real-box geometry tests of the Profile key rows at 320px and 1280px"
  - "e2e/helpers/seed-test-project.ts: seedManagerKeyPanel({ disconnectedLabel }) seeds a disconnected key"
affects:
  - src/components/exchanges/AllocatorExchangeManager.tsx
key-files:
  created: []
  modified:
    - src/components/exchanges/AllocatorExchangeManager.tsx
    - e2e/manager-keys.spec.ts
    - e2e/helpers/seed-test-project.ts
decisions:
  - "Fix as planned: label column `flex-1 min-w-0 basis-[calc(100%_-_3.5rem)] sm:basis-0`, Last sync `sm:text-right`, both lists. The action group and every copy string are untouched."
  - "The label column in the test is located with `closest('.min-w-0')` from the exact-text label element (checker note), and the label must resolve to exactly one element, so the measurement cannot target another box."
metrics:
  tasks: 2
  completed: 2026-11-11
  duration: "about 30 min (start time was not clocked)"
status: complete
actuals:
  tokens: 4300
  tasks: 2
  commits: 2
plan_head_before: 40ca49b60d1f3567afc7071390ce25fcd025e450
plan_head_after: 3dfdc453e2aa11d380e070bc220edd7f5963d573
requirements-completed: [LEAN-04, ROUTE-09]
coverage:
  - id: D1
    description: "At 320px each Profile key row (active and Disconnected lists) gives its label column the rest of the first line beside the venue tag; the label is not truncated; Last sync, status and actions wrap below; no page overflow"
    requirement: LEAN-04
    verification:
      - kind: e2e
        ref: "e2e/manager-keys.spec.ts#at 320px each key row gives its label the full line beside the venue tag, and Last sync wraps below it"
        status: pass
    human_judgment: false
  - id: D2
    description: "From the sm breakpoint up the row is unchanged: at 1280px Last sync shares the label column's line and sits right of it"
    requirement: LEAN-04
    verification:
      - kind: e2e
        ref: "e2e/manager-keys.spec.ts#at 1280px the key row stays on one line"
        status: pass
    human_judgment: false
  - id: D3
    description: "The allocator Profile rows (V390, V640) and the AllocatorExchangeManager / ExchangesTabContent unit pins on the action group still pass"
    requirement: ROUTE-09
    verification:
      - kind: e2e
        ref: "e2e/layout-narrow.spec.ts#/profile — SC2-PROFILE (2 passed)"
        status: pass
      - kind: unit
        ref: "7 AllocatorExchangeManager / ExchangesTabContent unit files, 204 tests passed, none edited"
        status: pass
    human_judgment: false
---

# Phase 200 Plan 15: the Profile key row gives its label the full line at 320px Summary

At 320px the Profile `API keys` rows no longer squeeze the key label to a few dozen pixels: below `sm` the label column's flex-basis is `calc(100% - 3.5rem)` (the row minus the 2.5rem venue tag and the 1rem gap), so it fills the first line beside the tag and Last sync, the status pill and the actions wrap beneath it, in both the active and the Disconnected lists. From `sm` up the layout is the same as before. Two seeded geometry tests read the real boxes and were shown red.

## What changed

- **Task 1 (tracer), commit `b845aa5e3`.** `AllocatorExchangeManager.tsx`, both row renders: the label column's classes became `flex-1 min-w-0 basis-[calc(100%_-_3.5rem)] sm:basis-0` and both Last sync blocks `text-right` -> `sm:text-right`, with a short comment above each label column. `seedManagerKeyPanel` takes an optional `disconnectedLabel` (a third `api_keys` row: exchange `bybit`, placeholder ciphertext, `is_active: false`, `disconnected_at` one day ago); the result carries `disconnectedKey`, and `cleanupManagerKeyPanel` deletes it when present. New describe in `manager-keys.spec.ts` ("Phase 200 - the Profile API keys rows at narrow and wide widths (seeded, blocking)") with a local `measureKeyRow` helper and the 320px test.
- **Task 2, commit `3dfdc453e`.** The 1280px test in the same describe, reusing `measureKeyRow`.

`measureKeyRow` finds the label with `getByText(label, { exact: true })` (asserted to resolve to exactly one element), takes the label column as the nearest `.min-w-0` ancestor, the row as its parent, the tag as the row's first child and Last sync as the row's `<p>` whose text is exactly "Last sync". All four DOM facts were checked against `AllocatorExchangeManager.tsx` (active row ~1799-1855, Disconnected row ~1930-1976) before writing the evaluate.

## RED proof

**320px test on today's squeezed layout (before the fix)** — the column is 45px wide and the label is cut (`scrollWidth` 91 over `clientWidth` 46):

```
  ✘  1 [chromium] › e2e/manager-keys.spec.ts:377:7 › Phase 200 - the Profile API keys rows at narrow and wide widths (seeded, blocking) › at 320px each key row gives its label the full line beside the venue tag, and Last sync wraps below it (1.6s)
    Error: "Binance main": the label column must reach the row's content-box right edge (row.right - paddingRight). {"row":{"left":42,"right":278,"top":683.5,"bottom":904.5,"paddingRight":16},"tag":{"right":98},"column":{"left":114,"right":159.59375,"top":695.5,"bottom":792.5},"lastSyncTop":727.5,"lastSyncLeft":175.59375,"labelScrollWidth":91,"labelClientWidth":46}
  1 failed
```

**GREEN after the fix:**

```
  ✓  1 [chromium] › e2e/manager-keys.spec.ts:377:7 › Phase 200 - the Profile API keys rows at narrow and wide widths (seeded, blocking) › at 320px each key row gives its label the full line beside the venue tag, and Last sync wraps below it (1.7s)
  1 passed (2.1s)
```

**1280px test, neuter** (`sm:basis-0` deleted from the active row's label column in the working file; fixed file kept as a byte copy `AllocatorExchangeManager.tsx.fixed` in the scratchpad):

```
  ✘  1 [chromium] › e2e/manager-keys.spec.ts:411:7 › Phase 200 - the Profile API keys rows at narrow and wide widths (seeded, blocking) › at 1280px the key row stays on one line (1.0s)
    Error: Last sync must share a line with the label column at 1280px (it wrapped below). {"row":{"left":318,"right":1222,"top":462.1875,"bottom":586.984375,"paddingRight":16},"tag":{"right":374},"column":{"left":390,"right":1206,"top":475.6875,"bottom":512.6875},"lastSyncTop":536.078125,"lastSyncLeft":334,"labelScrollWidth":816,"labelClientWidth":816}
  1 failed
```

Restore: `cp "$SCRATCH/AllocatorExchangeManager.tsx.fixed" src/components/exchanges/AllocatorExchangeManager.tsx`, then `cmp` exit **0**. The test passed (`1 passed`) on the fixed file before the neuter.

## Verification evidence (local seeded lane)

Lane: `scripts/local-stack/run.sh up` (exit 0), `--assert-local-handoff` exit 0, the scratchpad `lane-e2e.env` re-checked against the new `.stack-env` (URL, anon and service keys matched), `next dev -p 3100 --hostname 127.0.0.1` (no `localhost` fallback needed), `CI=1 npx playwright test ... --reporter=list --retries 0 --timeout 60000`.

Full `e2e/manager-keys.spec.ts`, on the restored fixed file:

```
  ✓   1 [chromium] › e2e/manager-keys.spec.ts:73:7 › ... › Change key… opens the picker, a pick opens the confirm, and nothing is written before Change key (3.6s)
  ✓   2 [chromium] › e2e/manager-keys.spec.ts:106:7 › ... › the confirm dialog's controls, its Close included, measure at least 44px at 320px and 1280px (1.9s)
  ✓   3 [chromium] › e2e/manager-keys.spec.ts:136:7 › ... › the Rename dialog's controls, its Close included, measure at least 44px at 320px (the Modal fix is shared) (1.3s)
  ✓   4 [chromium] › e2e/manager-keys.spec.ts:158:7 › ... › pressing the dialog's Change key re-points the strategy to the picked key (2.6s)
  ✓   5 [chromium] › e2e/manager-keys.spec.ts:191:7 › ... › edit page renders the panel heading and the Profile link (1.2s)
  ✓   6 [chromium] › e2e/manager-keys.spec.ts:200:7 › ... › edit page no longer offers Add Key or Delete (1.1s)
  ✓   7 [chromium] › e2e/manager-keys.spec.ts:211:7 › ... › Add or remove keys opens the Profile API keys tab (1.4s)
  ✓   8 [chromium] › e2e/manager-keys.spec.ts:217:7 › ... › Resync button is visible for the currently linked key (931ms)
  ✓   9 [chromium] › e2e/manager-keys.spec.ts:222:7 › ... › clicking Resync shows syncing state (1.7s)
  ✓  10 [chromium] › e2e/manager-keys.spec.ts:243:7 › ... › sync button returns to normal state after completion (1.7s)
  ✓  11 [chromium] › e2e/manager-keys.spec.ts:262:7 › ... › sync failure shows error message (1.1s)
  ✓  12 [chromium] › e2e/manager-keys.spec.ts:283:7 › ... › sync failure with non-JSON response shows service unavailable (1.2s)
  ✓  13 [chromium] › e2e/manager-keys.spec.ts:377:7 › Phase 200 - the Profile API keys rows at narrow and wide widths (seeded, blocking) › at 320px each key row gives its label the full line beside the venue tag, and Last sync wraps below it (1.4s)
  ✓  14 [chromium] › e2e/manager-keys.spec.ts:411:7 › Phase 200 - the Profile API keys rows at narrow and wide widths (seeded, blocking) › at 1280px the key row stays on one line (927ms)

  14 passed (22.6s)
```

`e2e/layout-narrow.spec.ts --grep "SC2-PROFILE"`:

```
  ✓  1 [chromium] › e2e/layout-narrow.spec.ts:308:9 › /profile — SC2-PROFILE › V390: Disconnect is inside the viewport once scrolled to, and the tab list fits or scrolls on one line (5.9s)
  ✓  2 [chromium] › e2e/layout-narrow.spec.ts:308:9 › /profile — SC2-PROFILE › V640: Disconnect is inside the viewport once scrolled to, and the tab list fits or scrolls on one line (5.0s)
  2 passed (11.4s)
```

The plan expected 3 and said the count was not measured. The describe loops `VIEWPORTS.filter((v) => v.width < MD_PX)`, so it has two tests (V390 and V640). V960 is not in this describe, so the real count is 2 passed, no failure, no skip. Not a regression.

Other checks:

- Seven unit files (`AllocatorExchangeManager.test.tsx`, `.feeds`, `.liveness`, `.native-balance`, `.departed-history`, `.key-storage-copy`, `ExchangesTabContent.test.tsx`): `Test Files  7 passed (7)`, `Tests  204 passed (204)`, none edited.
- `npx tsc --noEmit` exit 0. `npm run lint` exit 0 (0 errors, 4 warnings, none in files this plan touched). `npx eslint e2e/manager-keys.spec.ts e2e/helpers/seed-test-project.ts` exit 0.
- `node scripts/verify-plan-anchors.mjs` on the plan: exit 0 before starting (10 claims).
- Acceptance greps: `flex-1 min-w-0 basis-[calc(100%_-_3.5rem)] sm:basis-0` prints two lines (1813, 1944); `className="sm:text-right"` prints two lines (1851, 1974); `disconnectedLabel` in the seed helper: 6; `at 1280px the key row stays on one line` in the spec: 1.
- Teardown: dev server killed, nothing on 3100, `run.sh down` exit 0, `run.sh --assert-teardown` exit 0 (`surviving quantalyze containers -> 0`).

### Screenshots (seeded manager-only user, labels "UAT Binance main", "UAT OKX second", "Bybit old")

- 320px: `<scratchpad>/200-15-after-320.png` — each active label reads in full on the first line beside the tag ("UAT OKX second", "UAT Binance main"); the metadata line wraps to two short lines; Last sync, the Idle pill and Delete key sit below. The Disconnected card is below the fold in this capture; the 320px test measures it.
- 1280px: `<scratchpad>/200-15-after-1280.png` — every row is one line, Last sync to the right of the label, in the active and the Disconnected list.

The screenshots came from a throwaway spec in `e2e/` that was deleted before any commit (it was never staged).

## Deviations from Plan

None - plan executed exactly as written. The SC2-PROFILE count is 2 rather than the expected 3; the plan flagged the 3 as unmeasured, and this is a measured correction, not a failure.

Housekeeping, not a deviation: `next dev` rewrote `AGENTS.md` on boot. It was never staged; after the server stopped it was restored from `git show HEAD:AGENTS.md`, and `git status --short` is clean.

## Known limits

- The 320px geometry test pins the label column and the not-truncated label; it does not assert where the status pill or the action group sit. The action group is unchanged and still pinned by the `AllocatorExchangeManager.test.tsx` SC2-PROFILE class checks.
- The Disconnected row has no `data-testid`, so `assertNoReflow` is anchored on the active rows (`allocator-key-row`); it measures both page scrollers, so a Disconnected-row overflow would still show.

## Known Stubs

None.

## Threat Flags

None. T-200-30 mitigated as planned: the label column takes the full line below `sm`, and the 320px test asserts the label is not truncated for both lists. T-200-31: the new disconnected-key insert goes through `getAdmin()` and cleanup deletes it by id.

## Self-Check: PASSED

- Modified files present: `src/components/exchanges/AllocatorExchangeManager.tsx`, `e2e/manager-keys.spec.ts`, `e2e/helpers/seed-test-project.ts`; this SUMMARY.
- Commits present on the branch: `b845aa5e3`, `3dfdc453e` (measured `git rev-list --count 40ca49b60..HEAD` = 2 before this SUMMARY's own commit).
- STATE.md and ROADMAP.md untouched; `git status --short` clean after the AGENTS.md restore.

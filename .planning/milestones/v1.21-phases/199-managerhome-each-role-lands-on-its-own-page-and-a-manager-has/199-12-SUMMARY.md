---
phase: 199-managerhome-each-role-lands-on-its-own-page-and-a-manager-has
plan: 12
subsystem: ui
tags: [strategies-index, health-column, strategy-health, key-caption, vitest]
requires:
  - phase: 199-02
    provides: "strategyHealthOf, healthWord, HEALTH_TONE, rowChipStatus (src/lib/strategy-health.ts)"
  - phase: 199-10
    provides: "the merged /strategies page: ranking, placeholder rows, key-status read"
provides:
  - "StrategyTable Health column (plain header after Status, one-line cell, em dash for placeholder or absent health) fed by managerRows[id].health = { word, tone }"
  - "/strategies computes strategyHealthOf once per row on the server (server clock, the row's asset_class, feeding key statuses, keyStatusUnreadable)"
  - "strategies/loading.tsx skeleton with the table's shape and a Health header cell"
  - "untrustedKeyCaption(keyLabels): Exchange key · {label} / Exchange keys · {label A}, {label B}, labels from apiKeyLabelById"
affects: [199-14, 199-16]
actuals:
  tokens: 16000
  tasks: 2
  commits: 2
plan_head_before: f973e5aef2821af459e06a73f0845495634f6553
plan_head_after: db7fa4576e32eb591fb0eb4888bd46ac2fbb0482
status: complete
tech-stack:
  added: []
  patterns:
    - "The server decides the Health word and tone; the client table only prints strings it is handed (RSC-serializable, no client-side freshness verdict)"
    - "Key caption names keys through the one label rule (apiKeyLabelById), never a hand-joined exchange and nickname"
key-files:
  created:
    - src/components/strategy/StrategyTable.health.test.tsx
  modified:
    - src/app/(dashboard)/strategies/page.tsx
    - src/app/(dashboard)/strategies/loading.tsx
    - src/components/strategy/StrategyTable.tsx
    - src/lib/status-surface-copy.ts
    - src/lib/status-surface-copy.test.ts
    - src/app/(dashboard)/strategies/page.merged.test.tsx
    - src/app/(dashboard)/strategies/page.key-pill.test.tsx
    - src/app/(dashboard)/strategies/page.table.test.tsx
    - src/components/strategy/StrategyTable.manager-rows.test.tsx
    - src/components/strategy/StrategyTable.default-mounts.test.tsx
    - src/components/strategy/__fixtures__/strategy-table-owner-list-mounts.json
key-decisions:
  - "R-05: strategyHealthOf receives the row's own asset_class (the page's rows spread the full strategies row), so 9 days old is Stale for crypto and Healthy for any other class"
  - "T-199-18: only `label` joins KEY_STATUS_COLUMNS (a column in API_KEY_USER_COLUMNS_ARR; no encrypted column), read owner-scoped as before"
  - "The caption echoes labels one per key with no de-duplication, so two keys of one exchange read as two keys"
requirements-completed: [ROUTE-11]
coverage:
  - id: D1
    description: "A stale row shows Stale (no data since {day}) in the Health column for every role, computed on the server; a fresh row shows Healthy"
    requirement: ROUTE-11
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/strategies/page.merged.test.tsx#the Health column, computed on the server"
        status: pass
    human_judgment: false
  - id: D2
    description: "R-05: 9 days old is Stale for a crypto row and Healthy for a traditional row (the row's asset class reaches strategyHealthOf)"
    requirement: ROUTE-11
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/strategies/page.merged.test.tsx#R-05"
        status: pass
    human_judgment: false
  - id: D3
    description: "A failed key-status read turns a fresh row's Healthy into the em dash (an unreadable key never claims Healthy)"
    requirement: ROUTE-11
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/strategies/page.merged.test.tsx#T-199-19"
        status: pass
    human_judgment: false
  - id: D4
    description: "Table: Health header directly after Status and before Created, not sortable; one-line cell in the server's tone; em dash for a placeholder and for a row with no health; td count equals th count in every row kind"
    requirement: ROUTE-11
    verification:
      - kind: unit
        ref: "src/components/strategy/StrategyTable.health.test.tsx"
        status: pass
    human_judgment: false
  - id: D5
    description: "The key line names the key: one key reads Exchange key · {label}, two or more Exchange keys · {label A}, {label B}; two keys of one exchange are told apart; a nickname-less key reads its masked tail"
    requirement: ROUTE-11
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/strategies/page.key-pill.test.tsx#KEY-NAMED and src/lib/status-surface-copy.test.ts#S4"
        status: pass
    human_judgment: false
duration: ~40min
completed: 2026-11-10
---

# Phase 199 Plan 12: Health column and the key line that names its key Summary

**The merged /strategies list shows a server-computed Health word per row (Healthy, Updating, Stale (no data since {day}), Stale (no data yet), Analytics failed, Key problem or the em dash), and a key problem now names the key by its nickname instead of its exchange.**

## What was built

- **Task 1 (tracer), commit 1ff34162a.** `page.tsx` computes `strategyHealthOf` once per row with one `Date.now()` per request, the shaped row's chip status (`rowChipStatus`), `analytics_updating`, `analytics.series_end`, the row's `asset_class` (R-05), the feeding keys' `sync_status` read from `keysById` and the existing `keyStatusUnreadable`. The result is reduced to `{ word, tone }` (`healthWord`, `HEALTH_TONE`) and passed through `managerRows[id].health`. `StrategyTable.tsx` renders a plain Health header between Status and Created (no button, no `aria-sort`, z-20, not pinned) and a `whitespace-nowrap` cell; a placeholder row and a row with no `health` print the muted em dash; `emptyRowColSpan` grows by one. `loading.tsx` takes the table's shape with a Health header cell.
- **Task 2, commit db7fa4576.** `label` joins `KEY_STATUS_COLUMNS`; the page builds labels once with `apiKeyLabelById`; `untrustedKeyCaption(keyLabels)` replaces `(exchangeCodes, keyCount)`; its one caller and the status-surface-copy and key-pill tests were updated. A new case pins two keys of one exchange told apart and a nickname-less key reading its masked tail (never the raw id).

## Verification

Commands run in the worktree, all green:

- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 6 claims, no stale anchors.
- `npx vitest run src/lib/status-surface-copy.test.ts src/components/strategy "src/app/(dashboard)/strategies" src/__tests__/phase-149-my-strategies-parity.test.ts src/__tests__/no-email-in-copy.test.ts`: 114 files, 2283 tests passed (includes parity pin 7).
- Wider census of tests that mention StrategyTable or the strategies page (`strategies-guard-coverage`, `check-route-contract`, `page-titles`, `phase-150-capital-ownership-invariant`, `trim-removed-surfaces`, `phase-52-container-tabular-nums`, `one-strategy-page-links`, `figure-gate-census`, `figure-parity-pages`, `display-sign-single-source`, `wizard-draft-query-single-source`, `my-strategies/page.test.tsx`): 12 files, 192 tests passed.
- `npx tsc --noEmit -p .`: clean.
- Scoped `npx eslint` over every touched source and test file: clean. `tsx scripts/check-admin-route-manifest.ts`, `check-route-contract.ts`, `check-planning-hygiene.ts`, `check-canonical-domain.ts`: all exit 0. The full `npm run lint` was not run (its eslint cache writes into the shared node_modules symlink, per the brief); the four non-eslint scripts it chains were run directly.
- Skipped / not run: `src/lib/factsheet/compute.conventions.test.ts` (2 frozen-snapshot failures pre-existing on main, not touched). No SQL, no local Supabase stack, no Docker, no migration in this plan, so there are no SQL checks left to CI.

Neuter evidence (each on a byte copy under the scratchpad, restored with `cmp` identical, backups deleted):

- gc-199-12-neuter: page.tsx `strategyHealthOf` called with `keyStatusUnreadable: false` -> page.merged.test.tsx "T-199-19: a failed key-status read turns a fresh row's Healthy into the em dash" RED (`expected 'Healthy' to be '—'`); restored, 37/37 green.
- gc-199-12-neuter: page.tsx `assetClass: null` -> page.merged.test.tsx "R-05: 9 days old is Stale for a crypto row and Healthy for a traditional one" RED; restored, green.
- gc-199-12-neuter: page.tsx caption label built by hand from exchange and nickname (`${k.exchange} ${k.label}`) instead of `apiKeyLabelById` -> 7 page.key-pill.test.tsx caption cases RED (SINGLE-KEY-SIGNIN, MEMBER-ONLY-UNTRUSTED, TWO-STATUSES, SAME-STATUS-MANY, SHARED-KEY-ONCE, KEY-NAMED, MEMBERS-READ-ERROR); restored, 74/74 green.

gc-199-12-gates: vitest=green tsc=clean lint=clean

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Existing column-position tests and the owner-list golden fixture moved with the new column**
- **Found during:** Task 1 (first full strategies/table run: 8 failures)
- **Issue:** Adding Health between Status and Created shifted every hard-coded cell index and the owner-list golden (`strategy-table-owner-list-mounts.json`, which has no regenerate path by design).
- **Fix:** Hand-classified hunks only. Fixture: per mount, one Health `<th>` after Status, one Health `<td>` (muted em dash, these entries pass no health) before each of the 3 Created cells, note-row `colspan` 15 to 16; nothing regenerated, the other fixture (`strategy-table-default-mounts.json`) untouched and still green; the hunk is recorded in the default-mounts test's header comment. `MANAGER_HEADERS`, the absent-prop header count (-2 to -3), Created cell indexes and the placeholder index in `StrategyTable.manager-rows.test.tsx`, and the header order in `page.table.test.tsx`.
- **Files modified (outside the plan's files_modified):** `StrategyTable.manager-rows.test.tsx`, `StrategyTable.default-mounts.test.tsx`, `__fixtures__/strategy-table-owner-list-mounts.json`.
- **Commit:** 1ff34162a

**2. [Rule 3 - Blocking] strategies/loading.tsx had no header cells to add Health to**
- **Found during:** Task 1
- **Issue:** The plan and UI-SPEC say the skeleton "gains a Health header cell", but HEAD's skeleton was a stack of `SkeletonCard`s with no column headers at all, so there was nothing to add a cell to and the acceptance grep (`Health` in loading.tsx) could not hold.
- **Fix:** Gave the skeleton the table's shape: an `aria-hidden` table whose header cells are `Strategy | Status | Health | Created` (the table's leading owner-list columns, same micro/mono header style) over 5 skeleton rows. No test pins it; flagged for the verifier's eyes since it is a visible loading-state change.
- **Commit:** 1ff34162a

**3. [Rule 3 - Blocking] react-hooks/purity on `Date.now()` in the async server page**
- **Found during:** Task 1 (scoped eslint)
- **Fix:** One scoped `eslint-disable-next-line react-hooks/purity` with a reason, the exact precedent in `discovery/[slug]/page.tsx` (an async server page runs once per request).
- **Commit:** 1ff34162a

**4. [Rule 1 - Cleanup of own change] unused import**
- Removing the exchange-name lookup from `untrustedKeyCaption` left `EXCHANGE_DISPLAY` unused in `status-surface-copy.ts`; the import was dropped (`EXCHANGES` stays). Commit db7fa4576.

**Design note (not a deviation):** the old caption de-duplicated exchange names and took a separate `keyCount`; the new one takes one label per key and derives the plural from the label count, without de-duplication, so two keys that happen to share a label would print it twice (one per key, honest about the count).

## Known Stubs

None.

## Threat Flags

None. `label` is the only column added to the key-status allowlist (T-199-18), it is in `API_KEY_USER_COLUMNS_ARR`, and the read stays owner-scoped on the request client. T-199-19: the unreadable-key and neuter cases above show the Health word never claims Healthy when key status could not be read.

## Self-Check: PASSED

- Created/modified files exist (`StrategyTable.health.test.tsx` and the modified files above), verified by the passing runs.
- Commits `1ff34162a` and `db7fa4576` are ancestors of HEAD; `git rev-list --count f973e5aef..HEAD` was 2 before this SUMMARY.
- No untracked files left in the worktree before this SUMMARY; backups under the scratchpad removed.

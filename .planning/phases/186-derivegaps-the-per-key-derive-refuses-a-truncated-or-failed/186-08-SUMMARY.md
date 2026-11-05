---
phase: 186-derivegaps-the-per-key-derive-refuses-a-truncated-or-failed
plan: 08
subsystem: allocations overview (TS reader and note)
tags: [failing-key, overview-note, reader, d-03, d-05, d-07, sc-4]
status: complete

requires:
  - phase: 186-04
    provides: "gate: proceed"
  - phase: 186-07
    provides: "payload contract: flag failing_key_exited, list failing_key_exits of {api_key_id, reason, day}"
provides:
  - "src/lib/queries.ts: FAILING_KEY_EXITED_FLAG, FailingKeyExit, readFailingKeyExits (exported), MyAllocationDashboardPayload.failingKeyExits"
  - "AllocationDashboardV2.tsx: FailingKeyExitNote, prop failingKeyExits, testid dashboard-failing-key-note"
  - "AllocationDashboardV2.failing-key.test.tsx"
affects: [186-09, 186-11, 186-12]

plan_head_before: 3239b93da134771afe8460312ea9359de40b9dd5
plan_head_after: 7801e71c42d8ade739b5c632c1d622fcfcdb91f4

actuals:
  tokens: 9000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns: [defensive reader modelled on readUnpricedNativeAccounts, counts-only logging, muted role=status note]

key-files:
  created:
    - src/app/(dashboard)/allocations/AllocationDashboardV2.failing-key.test.tsx
  modified:
    - src/lib/queries.ts
    - src/lib/queries.test.ts
    - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx

key-decisions:
  - "Copy: the founder's drafts were used verbatim (Task 1); the strategy-mode sentence is recorded for plan 186-09's stamp."
  - "A null-day clause is stated once for either reason (sentence 3 names no reason), grouped across reasons; dated clauses group by (reason, day)."
  - "No dedupe of a repeated key id: the compose writes one entry per key (a dict), so a repeat would be a compose bug, not reader input to repair."

requirements-completed: [SC-4, SC-2]

completed: 2026-11-03
---

# Phase 186 Plan 08: Failing-key note (reader half of SC-4) Summary

The owner's allocation Overview now names every key the stored total stopped counting or holds at its last complete read, with its label and the day the total counts it through, in one muted `role="status"` note. The reader `readFailingKeyExits` is defensive and logs counts only.

## Task 1 - copy decision (founder, 2026-11-03: "Use these drafts (Recommended)")

copy-answer-note: (1) "The total counts {labels} through {day}: {its/their} exchange key is failing to sync, so {its/their} capital is no longer counted after that day." (2) "The total counts {labels} through {day}: the latest read of {its/their} exchange history came back incomplete, so the total holds {its/their} last complete day." (3) "The total leaves out {labels}: {its/their} exchange key has not returned a complete history yet."
copy-answer-strategy: "We could not read this account's full history from the exchange, so these numbers stay at the last complete read."

The answer was relayed in the dispatch prompt (the question had already been asked); the Task 1 verify passed on this file (one note line, one quoted strategy line, no digit or venue in sentence 4).

## What was built

- **Reader** (`src/lib/queries.ts`): `readFailingKeyExits(flags, derivedPayload, apiKeys)` returns `[]` unless `flags` holds `failing_key_exited`. It keeps only an object entry whose `api_key_id` is a key the owner holds, whose `reason` is `sync_failing` or `read_incomplete`, and whose `day` is `null` or a calendar-valid `YYYY-MM-DD` (reusing `isCalendarDay`). Label rule as `readUnpricedNativeAccounts`: trimmed label, else the exchange. Sorted by label then key id. A drop, or a missing/non-array list under the flag, logs one `console.error` and one Sentry warning (`op: "readFailingKeyExits"`) carrying `received N, kept M` only.
- **Producer**: `derivePhase07Fields` sets `failingKeyExits`, gated on `equityHistoryState === "ready"` through the same `payloadFlags` argument as `unpricedNativeAccounts`; added to the `Pick` list and the returned object.
- **Note** (`AllocationDashboardV2.tsx`): `FailingKeyExitNote` renders under `!isRebuilding && failingKeyExits.length > 0`, beside the unpriced note, as `<p role="status" data-testid="dashboard-failing-key-note" className="mb-3 px-1 text-sm text-text-secondary">`. Dated keys group by (reason, day) into one `joinAnd` clause ("its" for one key, "their" for several); undated keys form one sentence-3 clause; the day goes through `formatCloseDay`. The prop reaches the component by the same payload spread `unpricedNativeAccounts` takes (no other site names that field).

## Tests (RED before GREEN)

- RED logs: `red-08-2.log` (3 failed: 2 reader, 1 component) and `red-08-3.log` (13 failed) under `$HOME/.cache/quantalyze/derivegaps-186/`; both then green.
- `src/lib/queries.test.ts`: new describe `failingKeyExits` (ready/rebuilding, null day, label fallback, sort, owner-only drop with counts-only log naming no id/label/day, unknown/missing reason, non-string/mis-shaped/off-calendar/missing day, missing and non-array list, all-kept silence, flag absent or not a list stays silent).
- `AllocationDashboardV2.failing-key.test.tsx`: 7 render tests (sentences 1, 2, 3, grouping with "their", mixed days/reasons, rebuilding, empty/absent).
- Run: `queries.test.ts` + new file + `unpriced-account` test: 180 then 181 passed. Every test file importing `@/lib/queries` or naming `AllocationDashboardV2` (112 files): 2464 passed, 18 skipped, 0 failed. `npm run typecheck`: clean. `npm run lint`: 0 errors, 2 pre-existing warnings in unrelated files (`MetricsColumn.tsx`, `composite-read-path.ts`); route, planning-hygiene and domain checks OK.

## Deviations from Plan

None - plan executed exactly as written. Environment note: `node_modules` is the symlink to the main checkout and behaved correctly; it was not replaced. A first accidental whole-suite vitest run (empty file list from a zsh glob) was killed and the 112-file targeted run used instead.

## Known Stubs

None.

## Threat Flags

None. T-186-18 (owner-only resolution), T-186-19 (closed reason set, calendar-valid day or null, object shape) and T-186-20 (counts-only logs) are each pinned by a test.

## Self-Check: PASSED

Files present: the reader and note edits, `AllocationDashboardV2.failing-key.test.tsx`, this SUMMARY. Commits: 811dc7aa7 (Task 1), a29c881be (Task 2), 7801e71c4 (Task 3), all ancestors of HEAD. The SUMMARY commit follows `plan_head_after`.

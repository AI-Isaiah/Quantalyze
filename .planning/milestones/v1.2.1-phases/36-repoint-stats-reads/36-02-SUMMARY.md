---
phase: 36-repoint-stats-reads
plan: 02
subsystem: gdpr-compliance
tags: [gdpr, export-manifest, csv-daily-returns, per-key-axis, compliance, d4]
requires:
  - "csv_daily_returns per-key axis migration (20260624120000): api_key_id + allocator_id columns, CASCADE FKs"
  - "csv_daily_returns per-key types in database.types.ts (36-01, commit a8fc8561)"
provides:
  - "Projected csv_daily_returns_per_key GDPR export spec on the allocator_id axis"
  - "redactCsvDailyReturnsPerKeyForUser projection helper (exported, unit-pinned)"
  - "SANITIZE_PARITY_ALLOWLIST entry for the per-key bundle name (CASCADE-erasure rationale)"
affects:
  - "GDPR Art.15/20 export bundle: now includes an allocator's per-key csv_daily_returns rows"
  - "CI coverage hook (check-gdpr-export-coverage.ts): green with csv_daily_returns owned via two axes"
tech-stack:
  added: []
  patterns:
    - "Second ownership axis via kind:projected to avoid a bundle-key collision with the indirect entry"
    - "Identity-passthrough projection with defense-in-depth owner re-filter (no column strip)"
key-files:
  created:
    - "src/lib/__tests__/gdpr-export-per-key-dailies.test.ts"
  modified:
    - "src/lib/gdpr-export-manifest.ts"
    - "scripts/check-gdpr-export-coverage.ts"
decisions:
  - "Per-key axis added as kind:projected (not a second indirect/direct) to keep a distinct bundle name while the SELECT still hits csv_daily_returns filtered by allocator_id (D4)"
  - "Projection is an identity passthrough with an allocator_id !== userId re-filter; no column stripping (per-key rows carry only the subject's own data)"
  - "No or_filter: the bare .eq(allocator_id, userId) is the exact predicate the projection enforces"
  - "Allowlist (not a sanitize-matrix row) for erasure: api_key_id->api_keys + allocator_id->auth.users ON DELETE CASCADE handle Art.17 erasure automatically"
metrics:
  duration: "~10 min"
  completed: "2026-06-25"
  tasks: 2
  files: 3
  commits: 2
requirements: [UNIFY-01]
---

# Phase 36 Plan 02: GDPR Per-Key Export-Axis (D4) Summary

Adds a second GDPR-export ownership axis for `csv_daily_returns` so Art.15/20 bundles
include an allocator's per-key daily-return rows (`strategy_id` NULL, `allocator_id` set) —
closing a silent-omission compliance gap before the post-deploy backfill (D6) populates
per-key rows.

## What was built

`csv_daily_returns` became dual-shaped in migration `20260624120000`: strategy rows
(`strategy_id` set, `allocator_id` NULL) and per-key rows (`strategy_id` NULL,
`api_key_id` + `allocator_id` set). The existing GDPR manifest covered it only as an
**indirect** entry (`strategy_id -> strategies.user_id`), whose sub-select
`strategy_id IN (...)` never matches a NULL `strategy_id` — so per-key rows would be
silently dropped from every export bundle. The CI coverage hook could not catch this
(the table NAME was already present), making it a correctness/compliance gap rather than
a CI failure.

This plan adds the **per-key (allocator_id) axis**:

- **`redactCsvDailyReturnsPerKeyForUser(rows, userId)`** — a new exported projection
  helper. Identity passthrough that re-filters to `allocator_id === userId`
  (defense-in-depth against a future query change), with **no column stripping** (per-key
  rows carry only the subject's own data, unlike `contact_requests` / `match_decisions`).
- A **`kind: "projected"`** spec `csv_daily_returns_per_key` in `USER_EXPORT_TABLES`
  (`source_table: "csv_daily_returns"`, `user_column: "allocator_id"`, `project:
  redactCsvDailyReturnsPerKeyForUser`, no `or_filter`). A projected kind avoids a
  bundle-key collision with the indirect entry while the SELECT still hits
  `csv_daily_returns` filtered by `.eq(allocator_id, userId)`. `getOrderColumn` inherits
  `"date"` via the source_table lookup — no change to `ORDER_COLUMN_OVERRIDES`.
- A **`SANITIZE_PARITY_ALLOWLIST`** entry for the new bundle name, citing the
  `api_key_id -> api_keys ON DELETE CASCADE` + `allocator_id -> auth.users ON DELETE
  CASCADE` erasure declared by the migration — satisfying the projection-parity check
  (the source `csv_daily_returns` was already allowlisted).
- A **unit test** (`gdpr-export-per-key-dailies.test.ts`) pinning all three invariants:
  per-key rows export, a cross-allocator per-key row is dropped, strategy rows still
  export via the indirect axis, both axes coexist, and `getOrderColumn` returns `"date"`.

The existing indirect `csv_daily_returns` entry and its allowlist entry are unchanged.

## Tasks completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Add projected csv_daily_returns_per_key spec to USER_EXPORT_TABLES (TDD) | `f9039f2d` | src/lib/gdpr-export-manifest.ts |
| 2 | Allowlist the new bundle name + pin both axes with a unit test | `513d2198` | scripts/check-gdpr-export-coverage.ts, src/lib/__tests__/gdpr-export-per-key-dailies.test.ts |

## TDD cycle (Task 1)

- **RED:** Wrote `gdpr-export-per-key-dailies.test.ts` first; it failed on the missing
  `redactCsvDailyReturnsPerKeyForUser` import and the absent projected entry (6 of 7 failing).
- **GREEN:** Added the helper + projected spec; all 7 tests passed and `tsc --noEmit` exited 0.
- No refactor step needed.

## Verification

- `npx tsx scripts/check-gdpr-export-coverage.ts` -> exit 0 (manifest coverage + sanitize
  parity + projection parity + stale-key checks all green; "covers all 23 declared
  user-owned tables, manifest size 38").
- `npx vitest run src/lib/__tests__/gdpr-export-per-key-dailies.test.ts` -> 7/7 pass.
- `npx tsc --noEmit` -> exit 0.
- Regression: `gdpr-export.test.ts`, `gdpr-export-coverage-hook.test.ts`,
  `gdpr-export-redaction.test.ts` all pass — the new bundle name does not break the
  manifest uniqueness/ordering gates (the alphabetical gate covers only `direct` entries)
  or the coverage-hook self-tests.

## Deviations from Plan

None for the in-scope work — both tasks executed as written.

## Deferred Issues

**DEFER-36-02-01 — `gdpr-export-schema.test.ts` (2 tests) fail on `csv_daily_returns`
having a surrogate `id` PK (PRE-EXISTING, caused by 36-01, OUT OF SCOPE).**

- Surfaced during the Task 2 regression check.
- Root cause: migration `20260624120000` added `id BIGINT IDENTITY` to `csv_daily_returns`
  and 36-01 (commit `a8fc8561`) hand-patched `id: number` into `database.types.ts`. The
  schema test asserts every `ORDER_COLUMN_OVERRIDES` key is an **id-less** table;
  `csv_daily_returns` now HAS an `id`, so its long-standing
  `ORDER_COLUMN_OVERRIDES['csv_daily_returns'] = 'date'` entry (NEW-C16-09, unchanged here)
  trips the "no stale overrides" guard.
- **Proven pre-existing:** at commit `a8fc8561` (before any 36-02 work) both `id: number`
  and the `date` override were already present; the two failures reproduce with 36-02's
  `scripts/` change reverted. 36-02 touches none of `ORDER_COLUMN_OVERRIDES`,
  `database.types.ts`, or the schema test.
- **Why not fixed here (SCOPE BOUNDARY):** the failure lives in files outside the 36-02
  plan and was caused by a different, already-committed task. The fix (remove the override
  so it falls through to the `id` default, OR relax the test to allow a documented
  natural-key override on an id-bearing chronological table) changes the export ORDER BY
  for `csv_daily_returns` and is a 36-01 types/migration-repoint decision, not a
  GDPR-axis-plan one.
- Logged in full to `.planning/phases/36-repoint-stats-reads/deferred-items.md`.

## Threat Flags

None — this plan adds no new network endpoints, auth paths, or trust-boundary surface. It
narrows (does not widen) export visibility: the projected axis fetches `csv_daily_returns`
scoped by `.eq(allocator_id, userId)` and the project fn re-filters the same predicate.
Mitigations T-36-02-01 (information disclosure — cross-allocator row drop) and T-36-02-02
(compliance — per-key completeness) from the plan's threat register are implemented and
unit-pinned.

## Self-Check: PASSED

- FOUND: src/lib/gdpr-export-manifest.ts (projected csv_daily_returns_per_key spec present)
- FOUND: scripts/check-gdpr-export-coverage.ts (SANITIZE_PARITY_ALLOWLIST entry present)
- FOUND: src/lib/__tests__/gdpr-export-per-key-dailies.test.ts (7/7 pass)
- FOUND: .planning/phases/36-repoint-stats-reads/36-02-SUMMARY.md
- FOUND commit: f9039f2d (Task 1)
- FOUND commit: 513d2198 (Task 2)

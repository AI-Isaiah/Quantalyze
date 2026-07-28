---
phase: 36-repoint-stats-reads
plan: 01
subsystem: types
tags: [database-types, csv_daily_returns, per-key-axis, hand-patch]
requires: []
provides:
  - "csv_daily_returns Row/Insert/Update typed with the per-key axis (id, api_key_id, allocator_id) + nullable strategy_id"
affects:
  - "src/lib/queries.ts (36-03 per-key read selects api_key_id, allocator_id, date, daily_return)"
tech-stack:
  added: []
  patterns:
    - "hand-patch database.types.ts when a TS read needs new columns (repo convention; no CI regen gate)"
key-files:
  created: []
  modified:
    - src/lib/database.types.ts
decisions:
  - "Used `id?: number` (not `id?: never`) in Insert/Update — no `id?: never` precedent exists in the file (grep returned nothing), so applied the plan's explicit fallback."
  - "Left Relationships array unchanged — repo hand-patch convention only patches the columns the TS read needs; no code reads csv_daily_returns via a typed nested join on the new FKs."
  - "Inserted new keys in alphabetical position to match the existing block's key ordering (allocator_id, api_key_id, ... id ...)."
metrics:
  duration: ~4m
  completed: 2026-06-25
  tasks: 1
  files: 1
requirements: [UNIFY-01]
---

# Phase 36 Plan 01: csv_daily_returns per-key axis types Summary

Hand-patched the `csv_daily_returns` Row/Insert/Update in `src/lib/database.types.ts` to mirror the landed migration `20260624120000_csv_daily_returns_per_key_axis.sql`: `strategy_id` is now nullable and the per-key axis columns (`id`, `api_key_id`, `allocator_id`) are present, unblocking the typed per-key read in 36-03.

## What Was Built

**Task 1 — Patch csv_daily_returns Row/Insert/Update with the per-key axis** (commit `a8fc8561`)

- **Row:** `strategy_id: string` → `strategy_id: string | null`; added `id: number`, `api_key_id: string | null`, `allocator_id: string | null`. `created_at`, `daily_return`, `date`, `updated_at` unchanged.
- **Insert:** `strategy_id: string` → `strategy_id?: string | null`; added `id?: number`, `api_key_id?: string | null`, `allocator_id?: string | null`.
- **Update:** `strategy_id?: string` → `strategy_id?: string | null`; added `id?: number`, `api_key_id?: string | null`, `allocator_id?: string | null`.
- **Relationships:** unchanged (existing `csv_daily_returns_strategy_id_fkey` stays; no api_keys/auth.users relationship rows added, per the hand-patch convention).

Type mapping mirrors the migration: BIGINT IDENTITY → `number`, UUID FKs → `string | null` (nullable per the XOR check — exactly one of `strategy_id`/`api_key_id` is non-null per row).

## Verification

- `npx tsc --noEmit` → `TSC_EXIT=0` (no type errors introduced).
- `git diff --stat` → 1 file changed, 12 insertions(+), 3 deletions(-) — confined to the csv_daily_returns block (lines ~854-885). Relationships array untouched.
- `grep -n "api_key_id" src/lib/database.types.ts` matches inside the csv_daily_returns block.
- Post-commit: zero file deletions, zero `.planning/` files staged.

## Deviations from Plan

None — plan executed exactly as written. The one explicit fork point (`id?: never` vs `id?: number` for Insert/Update) resolved to `id?: number` per the plan's stated fallback, because no `id?: never` precedent exists in the file (`grep "id?: never"` returned no matches).

## Self-Check: PASSED

- FOUND: src/lib/database.types.ts (modified, contains api_key_id/allocator_id/id in csv_daily_returns block)
- FOUND: commit a8fc8561 (`git log --oneline` confirms)
- FOUND: .planning/phases/36-repoint-stats-reads/36-01-SUMMARY.md

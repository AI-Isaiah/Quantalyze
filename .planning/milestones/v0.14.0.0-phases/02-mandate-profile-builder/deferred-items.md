## Deferred — pre-existing lint warnings outside Plan 02-02 scope

Discovered during Plan 02-02 Task 2 `npm run lint`:

- `src/lib/queries.my-allocation.test.ts:174:10` — `'_column' is defined but never used` (pre-existing from Phase 1 Plan 01-02, commit 4cbc1ac)
- `src/lib/queries.my-allocation.test.ts:174:27` — `'_value' is defined but never used` (same origin)

These pre-date Plan 02-02 and are unrelated to mandate profile work. `npx eslint src/components/mandate/ 'src/app/(dashboard)/preferences/'` exits 0 clean — my new code introduces zero warnings.

Out-of-scope per Plan 02-02 scope-boundary rule; surfacing here for later Phase 1 polish.

## Pre-existing TS error noted during Plan 13-02 execution (2026-04-28)

**File:** `src/app/api/watchlist/[strategyId]/route.test.ts:128`
**Error:** `TS2578: Unused '@ts-expect-error' directive.`
**Status:** Pre-existing on commit `48ce8ec` (Task 2 base). NOT introduced by Plan 13-02 changes.
**Disposition:** Out of Plan 13-02 scope per executor "SCOPE BOUNDARY" — file belongs to Plan 13-01.
**Note:** `npm run build` passes (Next builds with looser config). Vitest passes (vitest doesn't strictly check `--noEmit`). Only `tsc --noEmit` flags it.

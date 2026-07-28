# Phase 07 — Deferred Items

Discovered during execution of Phase 07 plans. Out of scope for the discovering plan; logged here for triage at phase close / next retro.

## 2026-04-20 · Discovered during 07-06 execution

### D1. `src/__tests__/gdpr-export-coverage-hook.test.ts` fails pre-Phase-07

**Symptom:** `scripts/check-gdpr-export-coverage.ts` hook subprocess exits 1 instead of 0 when run against the current checked-in manifest.

**Pre-existing:** Confirmed by running the test against the branch's prior commit (before 07-06 started) — same failure. Not caused by Phase 07 Plan 06 (which only adds tests).

**Why deferred:** Scope boundary — 07-06 changes two test files only (`src/__tests__/seed-integrity.test.ts`, `src/components/auth/OnboardingWizard.noseeed.test.tsx`). The GDPR manifest issue is in Sprint 6 closeout territory (Task 7.3 per the file header) and likely relates to a new migration (067/068/069/070 added in Phase 06 + 07) introducing a user-owned table not yet listed in `src/lib/gdpr-export.ts`.

**Suggested owner:** Phase 11 ONBOARD / security readiness pass, or a short tech-debt ticket before milestone close.

**Reproduction:**
```bash
npx vitest run src/__tests__/gdpr-export-coverage-hook.test.ts
```

**07-03 confirmation (2026-04-20):** Still reproduces after `git stash`-ing the 07-03 working tree. The hook stderr points specifically at `allocator_equity_snapshots` (added by 07-01 migration 070) being absent from `USER_EXPORT_TABLES` in `src/lib/gdpr-export.ts`. 07-03 touches neither file and cannot auto-fix without widening scope; sibling `allocator_holdings` (Phase 06) is already listed, so the one-line fix is well-scoped but out-of-plan. Leaving for a dedicated follow-up.

**RESOLVED 2026-04-20 @ phase-07 close-out (commit `a73d80e`):** Root cause confirmed as Phase 07 migration 070 (not pre-existing). Added `{ kind: "direct", table: "allocator_equity_snapshots", user_column: "allocator_id" }` to `USER_EXPORT_TABLES` in `src/lib/gdpr-export.ts` — same pattern as sibling `allocator_holdings`. Coverage-hook test now GREEN (2/2). This is a direct Phase 07 obligation — reclassified from "deferred" to closed.

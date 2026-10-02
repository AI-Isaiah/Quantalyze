---
phase: 15
plan: 05
subsystem: csv-wizard-branch
tags: [csv, wizard, api-routes, analytics-client, withAuth]
requires:
  - 15-01-PLAN (migration 093 + finalize_csv_strategy RPC; csv_validator.py contract)
  - 15-02-PLAN (analytics-service /api/csv/validate FastAPI route)
  - 15-04-PLAN (CsvUploadStep + CsvPreviewStep + CsvSubmitStep + CsvValidationEnvelope)
provides:
  - WizardLocalState extended with optional source ('api' | 'csv') + strategyName fields
  - WizardStepKey extended to 7 keys (4 API + 3 CSV)
  - WizardChrome optional steps prop + WIZARD_STEPS_CSV export (dynamic 3/4-column stepper)
  - WizardClient ?source=csv branch with resume guard, strategyName state, CSV render switch
  - validateCsv() multipart helper + CsvValidate/Finalize Zod schemas
  - POST /api/strategies/csv-validate (multipart proxy)
  - POST /api/strategies/csv-finalize (json -> finalize_csv_strategy RPC)
affects:
  - .planning/phases/15-csv-unblock/15-CONTEXT.md (locked decisions D-02, D-03, D-05; cross-AI revision 2026-04-30)
  - src/lib/wizard/localStorage.ts (interface + step union extended)
  - src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx (steps prop)
  - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx (CSV branch render switch)
tech-stack:
  added: []
  patterns:
    - withAuth wrapper (auto-runs assertSameOrigin for non-GET methods)
    - userActionLimiter checkLimit (5/min per authenticated user)
    - SECURITY DEFINER RPC pattern (finalize_csv_strategy mirrors finalize_wizard_strategy)
    - v0 error envelope shape ({ ok, code, human_message, debug_context, correlation_id: null })
    - Zod .passthrough() for forward-compat with Phase 16 envelope expansion
    - Multipart fetch with no Content-Type (boundary auto-write)
key-files:
  created:
    - src/app/api/strategies/csv-validate/route.ts
    - src/app/api/strategies/csv-finalize/route.ts
  modified:
    - src/lib/wizard/localStorage.ts
    - src/lib/analytics-client.ts
    - src/lib/analytics-schemas.ts
    - src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx
    - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
decisions:
  - "WizardLocalState gets BOTH source? AND strategyName? optional fields (cross-AI revision 2026-04-30 — strategyName preserves user-typed name across back-nav and tab refresh)"
  - "validateCsv THROWS on missing ANALYTICS_SERVICE_URL — no localhost:8002 fallback in CSV path (eliminates production silent-misconfig)"
  - "csv-finalize/route.ts does NOT import STRATEGY_NAMES; uses user-typed name passed as p_strategy_name to the RPC"
  - "WizardClient resume guard skipApiResumeRedirect: skips API strategy-redirect path when (source === 'csv' OR loaded.source === 'csv') AND strategyId is empty/missing"
  - "All 4 saveWizardState calls in the CSV branch persist BOTH source: 'csv' AND strategyName (verified by grep; reviewer_note INFO #9 four-way interdependence)"
metrics:
  duration_minutes: 60
  completed: "2026-05-01T03:52:16Z"
---

# Phase 15 Plan 05: CSV Branch End-to-End Wiring Summary

CSV wizard branch wired end-to-end: WizardLocalState + chrome + client state machine with `?source=csv`, multipart Next.js proxy + json finalize routes, and analytics-client multipart helper that throws on missing env-var configuration.

## What Shipped

### Task 1 — Wizard step union + WizardLocalState + chrome + resume guard
- **`src/lib/wizard/localStorage.ts`**: Extended `WizardStepKey` from 4 to 7 keys (added `csv_upload`, `csv_preview`, `csv_submit`). Added `WizardLocalState.source?: 'api' | 'csv'` discriminator and `WizardLocalState.strategyName?: string` (≤80 chars) for CSV-branch back-navigation preservation. `loadWizardState` validation block now rejects unknown `source` values and out-of-bounds `strategyName` payloads. JSDoc on `strategyId` documents the empty-string sentinel for the CSV branch.
- **`WizardChrome.tsx`**: Renamed internal `STEPS` const to `DEFAULT_STEPS`. Added `CSV_STEPS` const (3-step) and `export const WIZARD_STEPS_CSV = CSV_STEPS;`. Added optional `steps?` prop on `WizardChromeProps` (defaults to `DEFAULT_STEPS`). The grid-cols class is computed dynamically (`grid-cols-3` when 3 steps, `grid-cols-4` otherwise). The "/ 04" hardcoded denominator is now derived from `activeSteps.length`.
- **`WizardClient.tsx`** (Part C only — full Task 4 below): Added the `skipApiResumeRedirect` resume guard (`isCsvBranch && (!loaded?.strategyId || loaded.strategyId === "")`) so an empty-string CSV sentinel doesn't get treated as an API draft mismatch.
- **Commit:** `23a1b09`

### Task 2 — analytics-client.ts validateCsv + analytics-schemas.ts
- **`src/lib/analytics-schemas.ts`**: Added `CsvValidateResponseSchema` (preview/errors/correlation_id) and `CsvFinalizeResponseSchema` (strategy_id/status). Both use `.passthrough()` for forward-compat with Phase 16 OBSERV-06 envelope expansion.
- **`src/lib/analytics-client.ts`**: Added `validateCsv(formData)` multipart helper. **THROWS** `Error('ANALYTICS_SERVICE_URL not configured')` when the env var is missing — no `localhost:8002` fallback in this code path (the legacy `ANALYTICS_URL` constant on line 17 is for the API-key path and is out of scope). Multipart body intentionally omits `Content-Type` so the fetch boundary auto-write isn't stripped. Translates timeout errors to `AnalyticsTimeoutError` and 4xx/5xx upstream responses to `AnalyticsUpstreamError` with the original status preserved.
- **Commit:** `fa542f5`

### Task 3 — /api/strategies/csv-validate + /api/strategies/csv-finalize
- **`src/app/api/strategies/csv-validate/route.ts`**: Multipart proxy. `withAuth` (auto-runs `assertSameOrigin`) + `userActionLimiter` 5/min + 10 MB hard cap (`MAX_BYTES = 10 * 1024 * 1024`). Defense-in-depth shape checks (file presence, fmt enum) BEFORE forwarding to `validateCsv`. Catches the env-var error from `validateCsv` and translates to `CSV_UPSTREAM_FAIL` 502 envelope with the original message in `human_message`.
- **`src/app/api/strategies/csv-finalize/route.ts`**: JSON → SECURITY DEFINER RPC. `withAuth` + `userActionLimiter`. Validates body `{wizard_session_id (UUID), fmt (daily_returns|daily_nav|trades), strategy_name (string, 1–80 chars)}`. Calls `supabase.rpc("finalize_csv_strategy", {p_user_id, p_wizard_session_id, p_fmt, p_strategy_name: trimmedName})`. Maps RPC SQLSTATE codes: `42501 → 401 CSV_FORBIDDEN`, `22023 → 400 CSV_INVALID_FORMAT`, default `→ 500 CSV_FINALIZE_FAIL`. **STRATEGY_NAMES is NOT imported** (cross-AI revision 2026-04-30).
- **Commit:** `6f48ce5`

### Task 4 — WizardClient ?source=csv branch render switch + strategyName state
- **`src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx`**: Imports `useSearchParams`, the 3 CSV step components, and `WIZARD_STEPS_CSV`. Reads `searchParams.get("source")` once at mount. STEP_INDEX extended to 7 keys. Initial-step computation: CSV branch resumes to a stored CSV sub-step if `loaded.source === "csv"`; else starts at `csv_upload`. WizardClient holds CSV-branch state: `csvFmt`, `csvPreview`, `csvValidationPassed`, `strategyName` (rehydrated from localStorage on resume). WizardChrome receives `steps={source === "csv" ? WIZARD_STEPS_CSV : undefined}`.
- The existing 4-step API render switch is wrapped in `source === "api" ? <API_BRANCH> : <CSV_BRANCH>`; **inner JSX of the API arm is bit-for-bit unchanged**.
- The CSV branch mounts `CsvUploadStep` / `CsvPreviewStep` / `CsvSubmitStep` with `strategyName` threaded through all 3 (`initialStrategyName={strategyName}` for Upload, `strategyName={strategyName}` for Preview + Submit). `CsvUploadStep.onSuccess` hoists `payload.strategyName` up via `setStrategyName` so back-navigation from Preview retains the user's typed name.
- **All 4 `saveWizardState` calls in the CSV branch persist BOTH `source: "csv"` AND `strategyName`** (verified by `awk` extracting saveWizardState blocks: 4 source fields + 4 strategyName fields). This satisfies the cross-AI revision 2026-04-30 INFO #9 reviewer note's four-way interdependence: (a) wrapping conditional balanced, (b) all 4 saveWizardState have both discriminator fields, (c) strategyName flows through 3 step props, (d) resume guard wired before initial-step computation.
- **Commit:** `1de0ba6`

## Cross-AI Revision 2026-04-30 — Confirmations (grep evidence)

| Revision | Confirmation | Evidence |
| --- | --- | --- |
| `validateCsv` throws on missing `ANALYTICS_SERVICE_URL` (no localhost fallback in CSV path) | `grep -c 'ANALYTICS_SERVICE_URL not configured' src/lib/analytics-client.ts` | 1 (in validateCsv body); 0 occurrences of `localhost` inside the validateCsv function body (`awk` extract) |
| `csv-finalize/route.ts` accepts `strategy_name` from body and forwards as `p_strategy_name` | `grep -c 'p_strategy_name' src/app/api/strategies/csv-finalize/route.ts` | 1 (RPC call); `p_placeholder_name` count = 0 |
| `csv-finalize/route.ts` does NOT import `STRATEGY_NAMES` | `grep -c 'STRATEGY_NAMES' src/app/api/strategies/csv-finalize/route.ts` | 0 |
| `WizardLocalState` extended with both `source?` AND `strategyName?` | `grep -c 'source?: "api" \| "csv"' src/lib/wizard/localStorage.ts; grep -c 'strategyName?: string'` | 1 + 1 |
| All 4 CSV-branch `saveWizardState` calls persist `strategyName` | `awk '/saveWizardState\({/,/}\);/' WizardClient.tsx \| grep -cE 'strategyName,\|strategyName: payload\.strategyName'` | 4 |
| All 4 CSV-branch `saveWizardState` calls persist `source: "csv"` | `awk '/saveWizardState\({/,/}\);/' WizardClient.tsx \| grep -c 'source: "csv"'` | 4 |
| `csv-finalize/route.ts` validates `strategy_name` shape (required, non-empty, ≤80) | `grep -c 'strategy_name is required'; 'cannot be empty'; 'MAX_NAME_CHARS'` | 1 + 1 + 3 |

## Quality Gates

- **`npx tsc --noEmit`**: Clean (zero errors) before AND after.
- **Wizard regression tests** (`npm test -- src/app --run`): 1001 passed | 2 skipped (1003 total). No regressions.
- **Lib tests** (`npm test -- src/lib --run`): 846 passed | 7 skipped (853 total). No regressions.
- **Branch**: `v1.0.0-api-key-rewrite-15-16` — unchanged before and after.
- **STATE.md / ROADMAP.md**: Not modified by this agent (per constraint).

## Deviations from Plan

**None — plan executed exactly as written.**

The verify-grep for `supabase.rpc(\s*"finalize_csv_strategy"` failed under `grep -E` because the call splits the open-paren and the string literal across two lines (matching the project's existing 100-char-ish line-wrap convention; same pattern in `finalize-wizard/route.ts:103-105`). Confirmed functionally with `awk` multi-line check (count = 1). This is a grep regex limitation, not a code-correctness issue — the RPC call exists and matches the plan's required shape.

A single inline edit was made post-Task-3 to drop a literal `STRATEGY_NAMES` token from the JSDoc preamble of `csv-finalize/route.ts` (replaced with `\`@/lib/constants\``); the plan's grep test counts every textual occurrence including comments, so the doc had to phrase the explanation without the literal token. This is cosmetic — no behavior change.

## Self-Check: PASSED

| Claim | Verification |
| --- | --- |
| `src/app/api/strategies/csv-validate/route.ts` exists | `test -f` → OK |
| `src/app/api/strategies/csv-finalize/route.ts` exists | `test -f` → OK |
| Commit `23a1b09` (Task 1) exists | `git log` → OK |
| Commit `fa542f5` (Task 2) exists | `git log` → OK |
| Commit `6f48ce5` (Task 3) exists | `git log` → OK |
| Commit `1de0ba6` (Task 4) exists | `git log` → OK |
| `WizardStepKey` admits 7 keys | `grep -cE '"csv_upload"|"csv_preview"|"csv_submit"' localStorage.ts` = 6 (3 union + 3 validSteps array) |
| `validateCsv` throws on missing env var | `grep -c 'ANALYTICS_SERVICE_URL not configured' analytics-client.ts` = 1 |
| `csv-finalize` does not import STRATEGY_NAMES | `grep -c 'STRATEGY_NAMES' csv-finalize/route.ts` = 0 |
| 4 saveWizardState calls persist `source: "csv"` AND `strategyName` | `awk` block extract: 4 + 4 |
| TypeScript clean | `npx tsc --noEmit` zero errors |
| Wizard tests still pass | 1001/1003 (2 pre-existing skips) |
| Branch unchanged | `git branch --show-current` = `v1.0.0-api-key-rewrite-15-16` |

## Pointer to Plan 15-06

Plan 15-06 ships the integration test suite that exercises this end-to-end wiring: `?source=csv` happy path (upload → validate → preview → submit → factsheet redirect), error envelopes (10 MB cap, fmt enum violation, missing `ANALYTICS_SERVICE_URL`), back-navigation strategy-name preservation, and resume-banner CSV-branch suppression. Plan 15-07 ships the admin status page at `/admin/csv-status` (Wave 3, ~150 LOC, depends only on 15-01).

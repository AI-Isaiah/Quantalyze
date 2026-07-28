---
phase: 96-draft-key-hygiene-onboarding-polish
plan: 04
subsystem: ui
tags: [onboarding, wizard, correlation-id, observability, api-keys, deribit, fetch, react]

# Dependency graph
requires:
  - phase: 16-observability
    provides: server-side getCorrelationId() with inbound-header preference + Sentry correlation_id tag
  - phase: v1.7-deribit
    provides: live Deribit exchange support (keys that were rendering "?" in ApiKeyManager)
provides:
  - "src/lib/wizard/wizard-correlation.ts — client-safe session correlation id + wizardFetch wrapper"
  - "Deribit DRB badge in ApiKeyManager (icon-map parity with AllocatorExchangeManager)"
  - "All 11 wizard fetch sites carry a stable X-Correlation-Id: wizard:<uuid> header"
  - "Wizard error envelopes display the SAME id that was sent on the failing request (log-join contract)"
affects: [wizard, onboarding, support-triage, observability]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Client-safe correlation id: module-memoized crypto.randomUUID() singleton (getWizardCorrelationId), NOT the server-only correlation-id.ts"
    - "wizardFetch wrapper stamps X-Correlation-Id on every wizard request; session id wins over caller-supplied override"

key-files:
  created:
    - src/lib/wizard/wizard-correlation.ts
    - src/lib/wizard/wizard-correlation.test.ts
  modified:
    - src/components/strategy/ApiKeyManager.tsx
    - src/components/strategy/ApiKeyManager.test.tsx
    - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.test.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/CsvUploadStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.tsx

key-decisions:
  - "D5 honored: reuse canonical DRB label, no new asset, no shared-constant extraction (the two icon maps can still drift — flagged for future consolidation)"
  - "D6 honored: new client module (correlation-id.ts is server-only); server unchanged — getCorrelationId() already prefers the inbound header"
  - "wizardFetch session id deterministically WINS over any caller-supplied X-Correlation-Id (single stable session id is the contract)"

patterns-established:
  - "getWizardCorrelationId(): one memoized wizard:<uuid> id per page/session so displayed id === sent header"
  - "wizardFetch(input, init?): the only fetch used inside the wizard dir (grep-gated: 0 bare fetch)"

requirements-completed: [UX-01, UX-02]

# Metrics
duration: ~15min
completed: 2026-07-12
---

# Phase 96 Plan 04: Deribit Icon + Wizard Correlation-Id Summary

**Deribit keys now render the canonical DRB badge, and every wizard fetch sends a stable `wizard:<uuid>` X-Correlation-Id that matches the id shown in the user's error envelope — making support triage joinable to server logs / Sentry / compute_jobs.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-12
- **Tasks:** 3
- **Files modified:** 12 (2 created, 10 modified)

## Accomplishments
- **UX-01:** added `deribit: "DRB"` to the local `exchangeIcon` map in `ApiKeyManager.tsx` (was falling through to `"?"`); label matches the canonical `EXCHANGE_TAGS` map in `AllocatorExchangeManager.tsx` (DESIGN.md 3-letter, no-emoji). Pinned by a render-contract test.
- **UX-02:** new client-safe `src/lib/wizard/wizard-correlation.ts` — a module-memoized `wizard:<uuid>` singleton (`getWizardCorrelationId`) and a `wizardFetch` wrapper that stamps `X-Correlation-Id` on every request.
- Threaded `wizardFetch` through **all 11** wizard fetch sites; switched the 4 display steps from the old `readCorrelationId()` (`<meta>` page-render id) to `getWizardCorrelationId()`, and deleted the 4 duplicated `readCorrelationId` helpers.
- The id displayed in a wizard error envelope is now **exactly** the id sent on the failing request — proven by a `SubmitStep.test.tsx` assertion (header-sent === id-displayed).

## Task Commits

1. **Task 1: UX-01 deribit icon (TDD)** — `82a9593f` (feat; RED→GREEN in one commit — test + impl)
2. **Task 2: UX-02 client wizard-correlation module (TDD)** — `001290e1` (feat; module + 10 tests)
3. **Task 3: thread header through 11 sites + unify displayed id** — `687fcbdb` (feat)

**Plan metadata:** _(final docs commit — this SUMMARY)_

## Files Created/Modified
- `src/lib/wizard/wizard-correlation.ts` — **created**; `getWizardCorrelationId()` (memoized `wizard:<uuid>`), `wizardFetch()`, `_resetWizardCorrelationIdForTests()`. No server-only / next-headers import (client-safe).
- `src/lib/wizard/wizard-correlation.test.ts` — **created**; 10 tests (shape, allowlist ≤128, memo, reset, header merge for plain-object + Headers, session-id-wins-over-override).
- `src/components/strategy/ApiKeyManager.tsx` — added `deribit: "DRB"` to `exchangeIcon` with lockstep comment.
- `src/components/strategy/ApiKeyManager.test.tsx` — added deribit render-contract test (asserts "DRB", not "?").
- `WizardClient.tsx` — draft DELETE via `wizardFetch`.
- `ConnectKeyStep.tsx`, `MultiKeyConnectStep.tsx`, `SyncPreviewStep.tsx`, `SubmitStep.tsx` — `wizardFetch` + `getWizardCorrelationId`; deleted local `readCorrelationId`.
- `CsvUploadStep.tsx`, `CsvSubmitStep.tsx` — csv-validate / csv-finalize via `wizardFetch`.
- `SubmitStep.test.tsx` — added the log-matching-contract test (sent header === displayed envelope id).

## RED→GREEN evidence
- **UX-01:** deribit test RED (badge rendered "?" → `getByText("DRB")` threw), GREEN after the map entry. Full ApiKeyManager suite 6/6.
- **UX-02 module:** wizard-correlation suite 10/10 GREEN.
- **UX-02 contract:** temporarily reverting `SubmitStep` `wizardFetch`→`fetch` made the new test RED (`sentId` null → `/^wizard:/` match failed); restoring `wizardFetch` → GREEN.

## Grep gates (all pass)
- Bare `fetch(` in wizard dir (non-test): **0**
- `readCorrelationId` remaining in wizard dir: **0**
- `server-only` / `next/headers` in `wizard-correlation.ts`: **0**

## Server-side verification (read-only, no change)
- `keys/sync/route.ts:244,540` → `getCorrelationId()` (prefers inbound header). Confirmed.
- `finalize-wizard/route.ts:1128` → `postProcessKey({...})` with no explicit correlationId → defaults to `getCorrelationId()` (`process-key-client.ts:99`). Confirmed.
- `instrumentation.ts:52` → Sentry tag from `request.headers["x-correlation-id"]`. Confirmed.
- `grep randomUUID|getCorrelationId` across the 5 named target routes (create-with-key, composite/add-key, composite/set-members, sync-progress, draft/[id]) → **no hits**: none hard-generate a correlation id, so no server edit was needed (matches D6's "no server changes expected").
- Allowlist check: `wizard:<uuid>` (43 chars) passes `/^[A-Za-z0-9._:-]{1,128}$/` (colon permitted). Confirmed.

## Decisions Made
- Followed locked decisions D5 (reuse DRB, no shared constant) and D6 (client module, server untouched) as specified.
- `wizardFetch` sets the session id LAST so it deterministically wins over a caller-supplied `X-Correlation-Id` — asserted in a test; documented in the module and the test.

## Deviations from Plan

None - plan executed exactly as written. (No hard-generated correlation ids were found in the 5 target routes, so the conditional server edit in Task 3 step 3 was not triggered.)

## Known Stubs
None.

## Threat Flags
None — no new security surface. The only client→server input is the `X-Correlation-Id` header, already constrained by the existing server allowlist (`/^[A-Za-z0-9._:-]{1,128}$/`, T-96-12 mitigation, unmodified); the id is a random uuid with no PII (T-96-13 accepted).

## Test / lint results
- Touched suites: 86/86 GREEN (ApiKeyManager, wizard-correlation, SubmitStep, ConnectKeyStep, MultiKeyConnectStep, SyncPreviewStep.render, CsvUploadStep, CsvSubmitStep).
- Full wizard dir + wizard lib: **297/297 GREEN** (23 files).
- `npx tsc --noEmit`: clean (exit 0).
- `npm run lint`: 0 errors (1 pre-existing warning in `EquityChart.tsx`, untouched — out of scope per scope boundary).

## Next Phase Readiness
- UX-01 and UX-02 complete and pinned by tests. No blockers.
- Advisory (non-blocking, not done): a live wizard run confirming the envelope id appears as a Sentry tag / `compute_jobs.metadata.correlation_id` would be nice-to-have end-to-end evidence.
- Future consolidation (out of scope, flagged): `ApiKeyManager.exchangeIcon` and `AllocatorExchangeManager.EXCHANGE_TAGS` are two separate maps that can drift.

---
*Phase: 96-draft-key-hygiene-onboarding-polish*
*Completed: 2026-07-12*

## Self-Check: PASSED

- Created files verified present: wizard-correlation.ts, wizard-correlation.test.ts, 96-04-SUMMARY.md
- Task commits verified in git log: 82a9593f, 001290e1, 687fcbdb

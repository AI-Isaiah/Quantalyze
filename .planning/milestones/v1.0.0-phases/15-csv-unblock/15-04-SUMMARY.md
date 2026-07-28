---
phase: 15-csv-unblock
plan: 04
subsystem: ui
tags: [react, nextjs, wizard, csv, pandera, accessibility, testid]

# Dependency graph
requires:
  - phase: 15-csv-unblock
    provides: TrustTierLabel + 6-rule CSV-02 spec (trading_window dropped)
provides:
  - CsvValidationEnvelope renders v0 envelope shape with 6-rule label map
  - CsvUploadStep with required strategy-name input + segmented format picker + drag-drop
  - CsvPreviewStep with 5-row metadata <dl> (Strategy name FIRST) + 6-row preview table
  - CsvSubmitStep posting {wizard_session_id, fmt, strategy_name} to csv-finalize
  - Strategy-name flow: <input> -> onSuccess -> WizardClient state -> Preview/Submit props -> JSON snake_case
affects:
  - 15-05 (WizardClient branching + csv-validate + csv-finalize routes)
  - 16 (correlation_id wiring through envelope.correlation_id slot)
  - 17 (DESIGN-05 wizardErrors.ts hoist target — 25 TODO markers across 4 files)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wizard sub-step shape: 'use client' + useCallback handlers + <section aria-labelledby> + Button + data-testid"
    - "Validation envelope: native <details> per rule (no JS state) + role='alert' + correlation_id slot"
    - "Required form field with aria-required + aria-invalid + char counter + inline error block"

key-files:
  created:
    - "src/app/(dashboard)/strategies/new/wizard/steps/CsvValidationEnvelope.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/steps/CsvUploadStep.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/steps/CsvPreviewStep.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.tsx"
  modified: []

key-decisions:
  - "RULE_LABELS has exactly 6 keys (trading_window dropped 2026-04-30 — crypto trades 24/7)"
  - "Strategy name required field 1-80 chars, validated client-side BEFORE network work"
  - "Strategy name NOT sent to /api/strategies/csv-validate (validator does not need it); only sent at finalize-time"
  - "Format selector default = daily_returns; explicit literal data-testid strings (not template) for grep-pinning"
  - "Validation envelope correlation_id rendered as '—' in Phase 15 (forward-compat null slot)"
  - "Single-rule cause text uses 'Rule violated:' (not a duplicate of the title) per UI-SPEC §8.7"

patterns-established:
  - "MAX_NAME_CHARS=80 const + maxLength={MAX_NAME_CHARS} for grep-pinned numeric limits"
  - "10 MB client-side guard fires on file SELECTION (not on submit) — fast feedback"
  - "Validation envelope shared between CsvUploadStep and CsvSubmitStep — single source-of-truth for error UI"
  - "TODO(phase-17): hoist into wizardErrors.ts comment on every literal copy string (25 total)"

requirements-completed: [CSV-01, CSV-02]

# Metrics
duration: ~50min
completed: 2026-05-01
---

# Phase 15 Plan 04: CSV Wizard Step Components Summary

**Four CSV-branch wizard step components landed: validation envelope (6-rule labels, no trading_window), upload step (required strategy-name input + segmented format picker + drag-drop), preview step (5-row metadata + 6-row table), submit step (forwards strategy_name snake_case to finalize).**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-05-01T02:55Z (plan execution start)
- **Completed:** 2026-05-01T03:39Z
- **Tasks:** 3
- **Files created:** 4

## Accomplishments

- `CsvValidationEnvelope.tsx` renders the v0 error envelope shape with 6-rule human label map (trading_window removed per 2026-04-30 cross-AI revision), single-rule and multi-rule cause text, native `<details>` per-rule breakdown, and a `correlation_id` slot for Phase 16 wiring.
- `CsvUploadStep.tsx` ships the cross-AI-revised user-typed strategy-name input ABOVE the segmented format picker (3 explicit data-testid literals), live char counter, drag-drop zone with full keyboard accessibility, 10 MB client-side cap, multipart POST to `/api/strategies/csv-validate`, and `onSuccess` hoisting `strategyName` up to WizardClient.
- `CsvPreviewStep.tsx` renders a 5-row metadata `<dl>` (Strategy name FIRST, 60-char display truncation), a 6-row preview table built from `first_rows + last_rows`, and Back/Submit CTAs with `disabled={!validationPassed}`.
- `CsvSubmitStep.tsx` posts `{wizard_session_id, fmt, strategy_name}` (snake_case JSON key) to `/api/strategies/csv-finalize`, defensively guards `typeof data.strategy_id === "string"`, fires `wizard_step_complete_3` telemetry on success, and renders the validation envelope below the summary on failure (preserving the user's data for retry).
- Strategy-name flow now spans the full 3-component path: client `<input>` → `onSuccess` payload → WizardClient state (Plan 15-05) → Preview prop → Submit prop → JSON `strategy_name` key.

## Task Commits

Each task was committed atomically on `v1.0.0-api-key-rewrite-15-16`:

1. **Task 1: CsvValidationEnvelope** — `5468ac0` (feat)
2. **Task 2: CsvUploadStep** — `cef5344` (feat)
3. **Task 3: CsvPreviewStep + CsvSubmitStep** — `86b4fa2` (feat)

## Files Created/Modified

- `src/app/(dashboard)/strategies/new/wizard/steps/CsvValidationEnvelope.tsx` (95 lines) — error envelope component, 6 RULE_LABELS keys
- `src/app/(dashboard)/strategies/new/wizard/steps/CsvUploadStep.tsx` (465 lines) — sub-step 1, strategy-name input + format selector + drag-drop + multipart submit
- `src/app/(dashboard)/strategies/new/wizard/steps/CsvPreviewStep.tsx` (5-row dl + 6-row table) — sub-step 2
- `src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.tsx` (snake_case finalize body) — sub-step 3

## Decisions Made

- Followed plan exactly. Cross-AI revisions 2026-04-30 (1) trading_window dropped, (2) strategy-name input added on Upload step, (3) finalize body sends `strategy_name` were honored verbatim.
- Format selector implemented as `FormatOption.testId` with literal data-testid strings (`"wizard-csv-fmt-daily_returns"`, etc.) rather than `data-testid={`wizard-csv-fmt-${f.id}`}` template. Reason: the plan's verification grep checks the source file (not the runtime DOM) for the three literal strings; using `testId: string` on each FormatOption makes the literals greppable while keeping a single rendering loop. The runtime DOM is identical either way.
- Truncation helper for the Preview's Strategy name display row uses 60 chars + ellipsis; the full value is still passed through to the finalize body unchanged.
- 10 MB client-side cap fires on file SELECTION (not on submit) so the user gets fast feedback rather than waiting for a multipart upload to fail.

## Confirmations Required by Plan Output Spec

- **`RULE_LABELS` has 6 entries** (cross-AI revision 2026-04-30 — `trading_window` dropped). Confirmed: `grep -c 'trading_window'` returns 0 across all four files.
- **`CsvUploadStep` has the strategy-name input with locked attributes:** `data-testid="csv-strategy-name"`, `aria-label="Strategy name"`, `maxLength={MAX_NAME_CHARS}` where `MAX_NAME_CHARS = 80`, `id="strategy-name"`, `placeholder="Aurora Capital — BTC vol carry"`. All 5 grep gates pass.
- **`CsvSubmitStep` finalize body sends `strategy_name` (snake_case JSON key):** Confirmed by `grep -c 'strategy_name:' CsvSubmitStep.tsx` returns 1; the JSON.stringify body has `strategy_name: strategyName`.
- **TypeScript errors:** Zero before, zero after. `npx tsc --noEmit 2>&1 | grep -i 'CsvValidationEnvelope\\|CsvUploadStep\\|CsvPreviewStep\\|CsvSubmitStep'` returns no matches.
- **Components reference `/api/strategies/csv-validate` and `/api/strategies/csv-finalize` routes that DO NOT YET EXIST.** Plan 15-05 ships those routes plus the WizardClient branching. Until 15-05 lands, navigating to `?source=csv` will 404 on the proxy fetch.

## Deviations from Plan

None — plan executed exactly as written. The cross-AI revisions 2026-04-30 (3 changes from iteration 1) were all incorporated as specified.

The only adjustment was internal-implementation-detail: the format-selector data-testid was hoisted from a template literal to an explicit `testId: string` field on each `FormatOption` so the literal strings appear in the source for grep-pinning. This is mentioned under "Decisions Made" — it does not change the runtime DOM or the visual contract.

## Issues Encountered

- After Task 1 first write, the `border-negative/30 bg-negative/5` and `role="alert"` greps each returned 2 matches because the doc comment quoted them. Trimmed the doc comment to mention class names without the literal strings. Now `role="alert"` returns 1 (the JSX element only) and `border-negative/30 bg-negative/5` returns 1.
- Same fix dropped `trading_window` from a comment block so the `grep -c 'trading_window'` gate returns 0 (a hard requirement of the plan; no `trading_window` may appear anywhere in the four files).
- After Task 2 first write, `wizard-csv-fmt-{id}` data-testid was a template literal so the three explicit format strings did not appear in source. Added `testId: string` to `FormatOption` with the three literal strings. All three grep gates now pass.

## Self-Check: PASSED

Files (all four exist):
- `src/app/(dashboard)/strategies/new/wizard/steps/CsvValidationEnvelope.tsx` — FOUND
- `src/app/(dashboard)/strategies/new/wizard/steps/CsvUploadStep.tsx` — FOUND
- `src/app/(dashboard)/strategies/new/wizard/steps/CsvPreviewStep.tsx` — FOUND
- `src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.tsx` — FOUND

Commits (all three exist on `v1.0.0-api-key-rewrite-15-16`):
- `5468ac0` Task 1 CsvValidationEnvelope — FOUND
- `cef5344` Task 2 CsvUploadStep — FOUND
- `86b4fa2` Task 3 CsvPreviewStep + CsvSubmitStep — FOUND

Branch unchanged: `v1.0.0-api-key-rewrite-15-16` (verified via `git branch --show-current`).
STATE.md NOT modified by this agent. ROADMAP.md NOT modified by this agent.

## Next Phase Readiness

- Ready for plan 15-05 (WizardClient branching + `/api/strategies/csv-validate` + `/api/strategies/csv-finalize` routes). The four step components are stable, exported with their typed prop interfaces, and the strategy-name flow is fully wired through component props.
- Phase 16 / OBSERV-06 carrier marker is in place: `CsvValidationEnvelope` renders `correlation_id` slot from `envelope.correlation_id ?? "—"`. When Phase 16 wires real values via `analytics-client.ts:66`, the DOM shape stays identical.
- Phase 17 / DESIGN-05 hoist target: 25 `TODO(phase-17): hoist into wizardErrors.ts` comments across the four files mark every literal copy string for absorption into `wizardErrors.ts`.

---
*Phase: 15-csv-unblock*
*Plan: 04*
*Completed: 2026-05-01*

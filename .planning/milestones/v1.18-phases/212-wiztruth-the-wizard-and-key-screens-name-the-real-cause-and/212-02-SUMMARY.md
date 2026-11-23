---
phase: 212-wiztruth-the-wizard-and-key-screens-name-the-real-cause-and
plan: 02
subsystem: wizard SyncPreviewStep composite gate
tags: [wizard, composite, series-completeness, sc1, red-on-revert]
requires: []
provides:
  - "isSeriesExaminedButRefused: the one exported reader of the gate's SERIES_EXAMINED_BUT_REFUSED map"
  - "Composite arm of SyncPreviewStep renders GATE_SERIES_EXAMINED_REFUSED for sampled_gapped and fill_derived_unproven"
affects: [src/lib/strategyGate.ts, src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx]
tech-stack:
  added: []
  patterns: ["one predicate over the gate's own map, no second verdict list in the component", "one local code variable feeds both the rendered code and the telemetry"]
key-files:
  created: []
  modified:
    - src/lib/strategyGate.ts
    - src/lib/strategyGate.test.ts
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.composite.render.test.tsx
key-decisions:
  - "Composite arm discriminates through gateFailureToWizardError(SERIES_EXAMINED_REFUSED | SERIES_PROVENANCE_UNVERIFIED), the same mapper the single-key arm uses"
  - "Null, empty and unknown verdicts keep the provenance refusal and its kickoff Retry (fail-closed over-refusal control)"
status: complete
commits: 2
plan_head_before: 0021ee06ac0e7fe542df16580d24445357f46974
plan_head_after: 92693d15a83a86b2211e7b0d62e8bbce4da8bcb3
actuals:
  tokens: 3100
  tasks: 2
  commits: 2
---

# Phase 212 Plan 02: Composite gate names the examined-and-refused verdict Summary

A composite stamped `sampled_gapped` or `fill_derived_unproven` now renders `GATE_SERIES_EXAMINED_REFUSED` with "Review your keys" and no Retry, while null and unknown verdicts keep `GATE_SERIES_PROVENANCE_UNVERIFIED` with its kickoff Retry; rendered code and `wizard_error` telemetry come from one variable.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 (tracer) | `14dcffba6` | fix(212-02): composite gate names the examined-and-refused verdict |
| 2 | `92693d15a` | test(212-02): pin every composite verdict and the remedy control |

## What changed

- `strategyGate.ts`: `export function isSeriesExaminedButRefused(seriesCompleteness: string | null)` beside `isDailyReturnsSourced`, returning `SERIES_EXAMINED_BUT_REFUSED.has(seriesCompleteness ?? "")`. The map stays module-private; anything not in it (null, unknown) answers false.
- `SyncPreviewStep.tsx` composite arm: the verdict is read once into a local, passed to `isDailyReturnsSourced` and to the predicate, and `code = gateFailureToWizardError(...)` feeds both `setErrorCode` and the `wizard_error` telemetry. The two hardcoded provenance literals are gone. The return still sits above the 7-day floor (161-07 / WIZERR-09 order unchanged).
- Render test: the 142.2 `sampled_gapped` pin moved to `GATE_SERIES_EXAMINED_REFUSED` and was renamed (the old title was false). New nested describe `[212-02 / SC1]` covers `fill_derived_unproven`, the hand-typed unknown verdict `some_future_verdict` (provenance code, Retry present, telemetry equal), and for both examined verdicts: telemetry equals the rendered code, Retry absent, "Review your keys" has the accessible name, calls `onReviewKeys` once and never `onTryAnotherKey`. `onReviewKeys` is passed explicitly because `baseProps` carries none.
- `strategyGate.test.ts`: predicate rows, hand-typed (true for both refused verdicts; false for null, empty string, `ledger_complete`, `composite_stitched`, `user_supplied`, `some_future_verdict`).

## Verification

- `npx vitest run` on the composite render test, `strategyGate.test.ts`, `strategyGate.invariant.test.ts`: 3 files, 132 tests passed. `npm run typecheck`: clean. `src/lib/wizardErrors*` tests: 460 passed (not touched, sanity only). The invariant test did not pin the export count.
- Plan anchors verified before work (`verify-plan-anchors.mjs`: 9 claims, OK). `npm ci` was needed (the worktree had no node_modules).
- No file under `supabase/migrations` changed (SC7).

## RED-on-revert (SC8), backups in the scratchpad, restored with cp and checked with cmp

1. Neuter A: `SyncPreviewStep.tsx` composite `code` replaced by the provenance literal (both render and telemetry). RED, 4 failed of 49:
   - `REFUSES a composite whose verdict the gate examined and refused, and names that cause` (sampled_gapped)
   - `fill_derived_unproven renders GATE_SERIES_EXAMINED_REFUSED (unreachable from today's stitch, mapped fail-closed)`
   - `fill_derived_unproven: telemetry equals the rendered code, no kickoff Retry, and Review your keys is a pure step transition`
   - `sampled_gapped: telemetry equals the rendered code, no kickoff Retry, and Review your keys is a pure step transition`
   The null-verdict, unknown-verdict and healthy `composite_stitched` cases stayed GREEN. Restore: `cmp` exit 0; test rerun 49 passed.
2. Neuter B: `isSeriesExaminedButRefused` returns false. RED, 6 failed of 117: `sampled_gapped is examined-and-refused`, `fill_derived_unproven is examined-and-refused`, plus the same four composite cases as above. Restore: `cmp` exit 0; full three-file run 132 passed.

## SC1 truth check (the two GATE_SERIES_EXAMINED_REFUSED fix bullets on the composite surface)

- "Connect a Deribit key instead": TRUE on the composite surface. `strategies/composite/add-key/route.ts` gates on `isSupportedExchange`, and `SUPPORTED_EXCHANGES` includes `deribit`, so a Deribit key is a legal composite member reached through "Review your keys".
- "Or create this strategy from a CSV upload instead": TRUE. `/strategies/new?source=csv` is a real alternative path from the wizard's first step.

Neither bullet is false, so no "SC1 truth-check finding for plan 08" is owed and `src/lib/wizardErrors.ts` was not touched.

## Deviations from Plan

None in behaviour. One naming note: the plan called the local `verdict`; the block already declares `compositeVerdict` later in scope (the figure verdict), so the new local is `seriesVerdict`.

Closes for ship: TODOS `0.07` (`D-161-07-A`). The ship step owns `TODOS.md`; it was not edited here.

## Known Stubs

None.

## Threat Flags

None. T-212-03 mitigated: the verdict is only tested for membership in a fixed map; an unknown string falls to the provenance refusal, pinned by the `some_future_verdict` case.

## Self-Check: PASSED

- FOUND commits `14dcffba6` and `92693d15a` (ancestors of HEAD); `git rev-list --count 0021ee06a..HEAD` was 2 before this summary commit.
- FOUND the four modified files; `STATE.md`, `ROADMAP.md`, `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json` untouched.

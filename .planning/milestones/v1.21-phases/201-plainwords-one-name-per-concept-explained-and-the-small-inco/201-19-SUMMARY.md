---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 19
subsystem: ui-copy
tags: [plainwords, wizard, copy-census, glossary-term]
requires: [201-25, 201-26]
provides:
  - "CSV and contribution submit CTAs read Add to Strategies"
  - "wizard error copy names the Strategies page"
  - "wizard metric preview labels render through Term"
  - "ledger plan-19 pending: {}"
affects: [wizard, strategies]
key-files:
  modified:
    - src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
    - src/components/strategy/FactsheetPreview.tsx
    - src/lib/wizardErrors.ts
    - scripts/copy-census/ledgers/plan-19.ts
decisions:
  - "FactsheetPreviewMetric gains an optional term key; absent keeps every other caller unchanged"
status: complete
commits: 3
plan_head_before: 8724de1ab708bff9ef2d452ffeb07ac6c4a2d03b
plan_head_after: 111a97dbb75b07162e2f7524dda9953a5f0b8eb1
actuals:
  tokens: 12000
  tasks: 3
  commits: 3
completed: 2026-11-11
---

# Phase 201 Plan 19: wizard and Strategies copy Summary

The wizard's submit buttons and error copy now name the Strategies page, and the draft metric preview renders CAGR, Sharpe, Sortino, Max DD and Volatility through `Term`. The plan-19 census ledger ends at `pending: {}`.

This run resumed an interrupted executor: tasks 1 and 2 were already committed, task 3 was left uncommitted in the working tree. I inspected the diff, kept it, re-ran every check and committed it.

## Tasks

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | a160f18b0 | `Add to Strategies` on CsvSubmitStep and SubmitStep (U-18, D-07), plus the dropped-capital-mark notice; tests pin the CTA |
| 2 | fd6606ac9 | four wizard errors and two comments say Strategies; test sweeps all entries and pins the four sentences; six developer-facing notes quoting Python detail strings are census `not user-visible` exceptions |
| 3 | 111a97dbb | `term` keys on the preview metrics in SyncPreviewStep (draft and composite lists); FactsheetPreview wraps the label in `Term` when `term` is set; render test asserts `[data-term]` and `tabindex=0`; figure-gate tile helper climbs to the label's `<p>`; ledger emptied |

## Verification (real output)

- `node scripts/verify-plan-anchors.mjs <plan>`: `claims: 2 checked`, `OK`, exit 0.
- `npx tsx scripts/copy-census/run.ts --ledger plan-19`: no hits, exit 0.
- `grep -a -c "Add to my strategies"` in CsvSubmitStep.tsx and SubmitStep.tsx: 0 and 0. `grep -a -c "My Strategies" src/lib/wizardErrors.ts`: 0.
- Task 3 vitest set (strategies/new, strategies/Strategies*, wizardErrors tests, copy-census, figure-gate-census) plus `src/components/strategy`: 110 files passed, 2431 tests passed, 0 failed.
- `npx eslint` on every touched file: exit 0, clean.
- `npm run typecheck` (`tsc --noEmit`): no output, no errors.

## Neuter evidence

Each gate was neutered on a byte backup (`cp -p`, neuter, RED, `cp -p` back, `cmp` exit 0, GREEN).

- CTA gate: CsvSubmitStep `submitCtaLabel` set back to `Add to my strategies`. RED: `sends entry_context='contribution' and shows allocator copy when entryContext='contribution'` (1 failed, 17 passed). Restored, `cmp` exit 0.
- Term gate: FactsheetPreview wrap replaced by the plain label. RED: `AssertionError: no [data-term="cagr"] in the preview: expected null not to be null` in the `201 D-01` render test (1 failed, 79 passed). Restored, `cmp` exit 0.

gc-201-19-neuter: gate=CsvSubmitStep.test.tsx result=red restored=identical
gc-201-19-neuter: gate=SyncPreviewStep.render.test.tsx result=red restored=identical
gc-201-19-gates: vitest=green eslint=clean tsc=clean

## Deviations from Plan

**1. [Rule 3 - Blocking] FactsheetPreview.tsx edited though not in files_modified.** The preview labels render inside `FactsheetPreview`, not in SyncPreviewStep, so wrapping them in `Term` needed an optional `term` field on `FactsheetPreviewMetric`. Other callers pass no `term` and print plain. Component tests under `src/components/strategy` pass.

**2. SyncPreviewStep.figure-gate.test.tsx edited.** Its `tile()` helper took `getByText(label).parentElement`, which broke once the label text sat inside a `Term` span. It now climbs `.closest("p")` first. Not in files_modified, but it pins only this plan's strings.

No other deviations. ReviewStep, MetadataStep, WizardClient and the other Strategies files needed no edit: the census lists no hit in them.

## cross-plan-pins

None found for plan 201-24. Not touched: `strategies/page.*` tests (plan 201-16 owns them).

## reported-not-edited

None. No phase-200 file was touched.

## Known Stubs

None.

## Threat Flags

None. Copy and a presentational prop only; no error code, request or mapping changed (T-201-25 mitigated by `wizardErrors.test.ts` and `wizardErrors.invariant.test.ts`, green).

## Self-Check: PASSED

Commits a160f18b0, fd6606ac9, 111a97dbb are on `wt/201-p19`; the files above exist; ledger `pending: {}`.

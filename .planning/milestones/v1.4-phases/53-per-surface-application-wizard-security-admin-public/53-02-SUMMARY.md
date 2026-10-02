---
phase: 53-per-surface-application-wizard-security-admin-public
plan: 02
subsystem: ui
tags: [nextjs, react, wizard, a11y, inline-validation, fluid-type, eslint-ratchet, vitest, playwright-axe]

# Dependency graph
requires:
  - phase: 53-01
    provides: "Verified-green frozen-behavior baseline (WizardClient transitions/autosave, localStorage step-enum, finalize-wizard POST) + wizard route-state files"
  - phase: 50-primitive-refresh
    provides: "Field/Input/Select/Button/Textarea primitives (Field wires aria-invalid + aria-describedby)"
  - phase: 49-fluid-type-spine
    provides: "named --text-* tiers (page-title/h3/body/small/caption/micro) in globals.css"
provides:
  - "Read-only Review & confirm recap step (ReviewStep.tsx) on BOTH wizard branches — recaps only entered values, per-section Edit returns to the owning step, no role=alert, branch finalize verb"
  - "WizardStepKey + validSteps + STEP_INDEX + WizardChrome step arrays extended with review / csv_review (additive, safe-degrading)"
  - "Inline per-field validation surfacing via Field a11y on MetadataStep (description) + CsvUploadStep (name) — existing wizardErrors copy, NOT role=alert"
  - "Wizard surface fully migrated onto fluid --text-* tiers; no-raw-font-px eslint glob ratcheted to error for strategies/new/**"
affects: [phase-54-bp-03-repo-wide-font-flip]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wizard review step assembled from the WizardChrome hairline-divider editorial idiom; data threaded from existing WizardClient state (no re-fetch, no fabrication)"
    - "Inline per-field validation: consumer supplies the wizardErrors.ts cause/title string to Field's error slot on blur+submit; per-field message is text-caption text-negative, NOT role=alert; envelope stays the lone role=alert summary"
    - "Form-category type subset: page-title (H1) / h3 (section) / body / caption + micro (badge/chip/counter) = 4 tiers + 1 badge exception"

key-files:
  created:
    - "src/app/(dashboard)/strategies/new/wizard/steps/ReviewStep.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/steps/ReviewStep.test.tsx"
  modified:
    - "src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx"
    - "src/lib/wizard/localStorage.ts"
    - "src/lib/wizard/localStorage.test.ts"
    - "src/lib/wizardErrors.ts"
    - "src/lib/analytics.ts"
    - "src/app/api/for-quants-lead/route.ts"
    - "src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.test.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/steps/CsvUploadStep.tsx"
    - "eslint.config.mjs"
    - "e2e/wizard-axe.spec.ts"
    - "e2e/csv-upload-flow.spec.ts"
    - "src/app/(dashboard)/strategies/new/wizard/steps/{ConnectKeyStep,CsvPreviewStep,CsvSubmitStep,CsvValidationEnvelope,SubmitStep,SyncPreviewStep}.tsx (font migration)"
    - "src/app/(dashboard)/strategies/new/wizard/{WizardIpAllowlistHint,WithdrawalWarningStrip,error}.tsx (font migration)"

key-decisions:
  - "Review step is a NEW render branch + ONE transition re-point per branch (metadata→review, review→submit); SubmitStep/CsvSubmitStep still do the unchanged finalize POST. finalize-wizard diff EMPTY."
  - "STEP_INDEX widened 1|2|3|4 → 1|2|3|4|5 (review:4/submit:5); analytics ForQuantsEvent + CtaLocation unions gained wizard_step_view_5 / wizard_step_5; for-quants-lead WIZARD_STEP_KEYS gained review/csv_review — all blocking-issue (Rule 3) fixes for the enum extension's compile-time exhaustiveness check."
  - "MetadataStep description required-validation copy added to wizardErrors.ts (METADATA_DESCRIPTION_REQUIRED) — the canonical wizard-copy home, NOT an invented inline string in the component (copy-drift guard)."
  - "no-raw-font-px rule only flags text-[Npx] arbitrary values, but migrated text-sm/-xs/-2xl/-3xl named utilities too for the ≤4-tier form-category conformance + to satisfy the plan's grep gate."
  - "ReviewStep API/CSV branches use a discriminated-union props type (branch: 'api' | 'csv') so the recap content + CTA verb are type-safe per branch."

patterns-established:
  - "Read-only recap step pattern: discriminated-union props, hairline-divider RecapSection with per-section Edit→onEdit(owningStep), em-dash ONLY for genuinely-absent optional fields (never a fabricated zero), Geist Mono tabular-nums for numbers."

requirements-completed: [APPLY-02, BP-02]

# Metrics
duration: ~32min
completed: 2026-06-29
---

# Phase 53 Plan 02: Wizard UX Upgrade (Review step + inline validation + primitive migration) Summary

**Added the genuinely-new wizard UX upgrade (APPLY-02) — a read-only Review & confirm recap step on both branches, inline per-field validation surfaced through the Field primitive, and the wizard surface migrated onto the fluid --text-* tiers — all ADDITIVELY, with the WizardClient state machine, autosave, and finalize-wizard POST contract provably FROZEN (diff empty, 71-test baseline green).**

## Performance

- **Duration:** ~32 min
- **Tasks:** 3
- **Files created:** 2 (ReviewStep.tsx + test)
- **Files modified:** 22

## Accomplishments

- **Review & confirm step (both branches):** `ReviewStep.tsx` renders a read-only recap of ONLY entered values (API: codename/description/types/subtypes/markets/exchanges/leverage/AUM/max-capacity from `metadataDraft`; CSV: format/row-count/date-range/columns from the REAL parsed `csvPreview` numbers). Per-section "Edit" returns to the owning step via the existing `setStep` seam (autosave preserves the draft); no `role="alert"`; branch finalize verb ("Create strategy" / "Submit strategy"). Wired as new `review` / `csv_review` render branches; `handleMetadataComplete` and the CSV `onComplete` now advance to review (review Continue → submit, where the unchanged POST fires).
- **Inline per-field validation:** MetadataStep's required description now shows its error at the field on blur + submit through `Field` (aria-invalid + aria-describedby), and focuses the first invalid field on submit; CsvUploadStep's strategy-name input migrated onto `Field`, closing the aria-describedby gap the hand-wired input had. Both reuse existing `wizardErrors.ts` copy; per-field messages are `text-caption text-negative`, NOT `role="alert"` — the `WizardErrorEnvelope` / `CsvValidationEnvelope` stay the lone `role="alert"` summaries.
- **Fluid-type migration + eslint ratchet:** every raw `text-[Npx]` / `text-sm`/`-xs` / `text-2xl`/`-3xl` across the wizard (13 files) migrated to the named form-category tiers (page-title/h3/body/caption + micro for badge/chip/counter — 4 tiers + 1 badge exception, grep-clean). `no-raw-font-px` ratcheted to `error` for `src/app/(dashboard)/strategies/new/**`.
- **Frozen invariants preserved:** finalize-wizard POST diff is EMPTY; the Plan-01 71-test behavioral baseline (WizardClient transitions/autosave, localStorage step-enum, finalize-wizard POST) stays green; phase-52 frozen-spine guards green.

## Task Commits

1. **Task 1: Read-only Review & confirm step** — `9d966c6c` (feat) — ReviewStep.tsx + test (10 tests), WizardClient render branches + metadata→review transition, WizardStepKey/validSteps/STEP_INDEX/WizardChrome step-array extension, analytics + for-quants-lead enum sync. 8 files.
2. **Task 2: Inline per-field validation + primitive migration** — `b832a89c` (feat) — MetadataStep description inline error via Field (+ test), CsvUploadStep name → Field, METADATA_DESCRIPTION_REQUIRED added to wizardErrors.ts. 4 files.
3. **Task 3: Font migration + eslint ratchet + wizard-axe** — `52c01c6f` (feat) — wizard surface → fluid tiers, eslint glob → error, e2e wizard-axe CSV review walk + csv-upload-flow flow update. 16 files.

## Files Created/Modified

See the `key-files` frontmatter. Highlights:
- `ReviewStep.tsx` — discriminated-union (api/csv) read-only recap; `RecapSection` (hairline divider + per-section Edit) + `RecapRow` (caption label + body/tabular-nums value); em-dash for absent OPTIONAL fields only.
- `WizardClient.tsx` — `review` / `csv_review` render branches; metadata→review + csv_metadata→csv_review transitions; submit/csv_submit Back returns to review; STEP_INDEX widened to 1..5.
- `localStorage.ts` — `WizardStepKey` + `validSteps` gained `review` / `csv_review` (additive; unknown step still safe-degrades).
- `MetadataStep.tsx` — description wrapped in `Field` with blur+submit inline error + first-invalid focus.
- `CsvUploadStep.tsx` — strategy-name input wrapped in `Field` (aria-describedby gap closed); char-counter kept as aria-live sibling.
- `eslint.config.mjs` — `strategies/new/**` added to the `error` ratchet block.

## Verification Results

- **Frozen baseline + new behavior + frozen spine:** `WizardClient.test.tsx` + `localStorage.test.ts` + `finalize-wizard/route.test.ts` + `ReviewStep.test.tsx` + `MetadataStep.test.tsx` + `CsvUploadStep.test.tsx` + `phase-52-frozen-spine-guards.test.ts` → **7 files / 107 tests passed.**
- **Full wizard suite:** `src/app/(dashboard)/strategies/new/wizard/` → **16 files / 103 tests passed.**
- **`git diff src/app/api/strategies/finalize-wizard/` over the 3 commits = EMPTY** (POST contract untouched, T-53-03 mitigated).
- **`grep -RnE "text-\[[0-9]+px\]|text-(xs|sm|base|lg|xl)\b" strategies/new/` = 0** (font-px clean).
- **`npm run lint` = 0 errors** (264 warnings, all out-of-scope repo-wide-`warn` files; no wizard-surface file in the output → the `error` glob is clean). Route-contract guard: OK — 56 page routes + 20 admin routes declared.
- **`grep -c '"review"\|"csv_review"' localStorage.ts` = 4** (union + validSteps, both branches).
- **`npx tsc --noEmit` = 0 errors.**

## Decisions Made

- Review step is a new render branch + one transition re-point per branch; the finalize POST stays in SubmitStep/CsvSubmitStep (unchanged). The review recap and the SubmitStep factsheet-preview are distinct surfaces (recap of entered values vs. the computed draft factsheet) — both kept.
- METADATA_DESCRIPTION_REQUIRED copy lives in wizardErrors.ts (the canonical home) — adding a code there is NOT "an invented inline string"; the prohibition is on inline strings in components.
- API-branch review-step axe walk is not drivable in the seed test env (needs a real exchange-key sync the seed helper doesn't provide — same limit as the existing api-branch axe scan, which only reaches step 1); the CSV-branch review walk is added to wizard-axe.spec.ts and the component-level a11y invariants (aria wiring, no role=alert) are pinned in ReviewStep.test.tsx for both branches.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] analytics + for-quants-lead enum sync for the new step ordinal**
- **Found during:** Task 1
- **Issue:** Widening `STEP_INDEX` to `1|2|3|4|5` emits `wizard_step_view_5` / `wizard_step_5`, which were absent from the `ForQuantsEvent` / `CtaLocation` unions (TS error). Separately, the `WizardStepKey` enum extension tripped the compile-time exhaustiveness check in `src/app/api/for-quants-lead/route.ts` (`WIZARD_STEP_KEYS` array, `error TS2322`).
- **Fix:** Additively extended `src/lib/analytics.ts` (`wizard_step_view_5`, `wizard_step_5`) and added `review` / `csv_review` to `WIZARD_STEP_KEYS` in `for-quants-lead/route.ts`. Telemetry-only; no behavior change to the frozen state machine.
- **Files modified:** `src/lib/analytics.ts`, `src/app/api/for-quants-lead/route.ts`
- **Commit:** `9d966c6c`

**2. [Rule 1 - Bug] Stale + newly-staler csv-upload-flow e2e flow**
- **Found during:** Task 3
- **Issue:** `e2e/csv-upload-flow.spec.ts` walked Preview-continue → "Review and submit" directly, which already skipped the `csv_metadata` step (added by QA ISSUE-010) and would further break on the new `csv_review` step.
- **Fix:** Updated the walk to: Preview → Strategy profile (fill required description, submit) → Review & confirm (Continue) → Submit. Root-cause fix per CLAUDE.md Rule 6 (the spec is a seed/cred-gated advisory e2e, not CI-blocking).
- **Files modified:** `e2e/csv-upload-flow.spec.ts`
- **Commit:** `52c01c6f`

### Scope notes

- Added METADATA_DESCRIPTION_REQUIRED to wizardErrors.ts (Rule 2: a required field with no accessible error message is an a11y gap; surfacing the existing required-field rule inline is within "surface the wizard's existing validation inline per-field"). Copy lives in the canonical module, not the component.
- ConnectKeyStep: broker-selector grid + CSV escape-hatch + the show/hide secret input left structurally as-is (surgical-change discipline; no per-field blur validation applies — its errors are server-returned codes → envelope). Only font tokens migrated.

## Threat Surface

- **T-53-03 (Tampering, inline-vs-POST):** mitigated — inline validation is presentation-only; the finalize-wizard POST stays authoritative and unchanged (`git diff` empty; route.test.ts green). Never gates the POST on client-only inline state.
- **T-53-04 (Tampering, WizardStepKey/validSteps/autosave):** mitigated — additive enum extension; `validSteps.includes` safe-degrades an unknown stored step (proven by the extended localStorage.test.ts: review/csv_review round-trip + unknown-step→null); WizardClient autosave baseline green.
- **T-53-05 (Spoofing/Info, no-invented-data):** mitigated — recap renders only entered values; ReviewStep.test.tsx asserts no fabricated zero for absent optional fields (em-dash placeholder only).
- No new security-relevant surface introduced (no new endpoints, no schema change, zero packages installed).

## Known Stubs

None — ReviewStep is wired to real WizardClient state on both branches; inline validation surfaces real wizardErrors copy; all changes are functional and test-covered.

## User Setup Required

None.

## Self-Check: PASSED

Both created files verified present on disk; all 3 task commits (`9d966c6c`, `b832a89c`, `52c01c6f`) verified in git log.

---
*Phase: 53-per-surface-application-wizard-security-admin-public*
*Completed: 2026-06-29*

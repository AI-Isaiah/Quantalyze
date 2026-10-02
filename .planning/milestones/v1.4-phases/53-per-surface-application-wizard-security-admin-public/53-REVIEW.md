---
phase: 53-per-surface-application-wizard-security-admin-public
reviewed: 2026-06-29T00:00:00Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
  - src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/ReviewStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/CsvUploadStep.tsx
  - src/lib/wizard/localStorage.ts
  - src/lib/wizardErrors.ts
  - src/lib/analytics.ts
  - src/app/api/for-quants-lead/route.ts
  - src/app/(dashboard)/strategies/new/wizard/error.tsx
  - src/app/(dashboard)/strategies/new/wizard/loading.tsx
  - src/app/(dashboard)/strategies/error.tsx
  - src/app/(dashboard)/admin/error.tsx
  - src/app/(dashboard)/admin/loading.tsx
  - src/app/(dashboard)/portfolios/error.tsx
  - src/app/(dashboard)/portfolios/loading.tsx
  - src/app/(dashboard)/portfolios/[id]/error.tsx
  - src/components/admin/ComputeJobsTable.tsx
  - src/components/admin/MatchQueueIndex.tsx
  - src/components/admin/AllocatorMatchQueue.tsx
  - src/components/layout/DashboardChrome.tsx
  - src/components/ui/EmptyStateCard.tsx
  - eslint.config.mjs
findings:
  critical: 0
  warning: 4
  info: 5
  total: 9
status: fixed
fix:
  fixed_at: 2026-06-29
  fixed: ["WR-01", "WR-02", "WR-03", "WR-04", "IN-05"]
  partially_addressed: ["IN-03"]
  deferred: ["IN-01", "IN-02", "IN-04"]
  commits:
    WR-01: 31dbdd1c
    WR-02: 12bf6682
    WR-03: aae5aa7e
    WR-04: 323c6068
    IN-05: 52c75a6f
  verification: "wizard suites 337 pass / 7 skipped; tsc 0 errors; eslint 0 errors on changed files; route-contract OK; finalize POST contract unchanged"
---

# Phase 53: Code Review Report

**Reviewed:** 2026-06-29
**Depth:** standard
**Files Reviewed:** 23
**Status:** fixed (4 warnings + IN-05 applied; IN-03 partially addressed; IN-01/02/04 deferred — see fix notes)

## Summary

Reviewed the logic-bearing changes of Phase 53: the additive Review-step wizard
UX upgrade (`ReviewStep`, inline validation in `MetadataStep`/`CsvUploadStep`,
the `WizardStepKey`/analytics/`for-quants-lead` enum extensions), the new
route-state error/loading boundaries, the three `@container` admin-table
reshapes, and the `DashboardChrome` fluid-fill regex.

The security-sensitive surfaces hold up well:

- **Digest-only error boundaries** — all five new `error.tsx` files
  (`wizard`, `strategies`, `admin`, `portfolios`, `portfolios/[id]`) render
  `error.digest` ONLY and never `error.message`, matching the canonical
  `(dashboard)/error.tsx`. No information-disclosure regression (T-53-01/09/13
  hold).
- **`@container` parent/child correctness** — the #551 same-element regression
  is NOT reintroduced. In all three admin tables the `@container` host is the
  `ResponsiveTable` wrapper and every `@max-*` / `@2xl` variant sits on
  descendant `<th>`/`<td>`/`<span>` cells. Grep confirms zero same-element
  `@container`+`@variant` class strings in production source.
- **`DashboardChrome` fluid-fill regex** — `/^\/(allocations|compare|discovery|admin|portfolios)(\/|$)/`
  is correctly bounded; the `(\/|$)` anchor prevents `/admins`-style
  over-match, and the wizard/prose routes under `/strategies` stay narrow.
- **No-invented-data** — the relocated admin-table narrow-width sub-lines carry
  the REAL collapsed values, not fabricated em-dashes/zeros. `ReviewStep`
  recaps only threaded-in state.
- **`for-quants-lead` route** — the `WizardStepKey` enum extension
  (`review`/`csv_review`) is mirrored in `WIZARD_STEP_KEYS` and the compile-time
  exhaustiveness check, so the new steps don't silently 400.

No blockers. The findings below are correctness/clarity defects in the new
wizard UX and minor telemetry/robustness gaps.

## Warnings

### WR-01: ReviewStep "Create strategy" / "Submit strategy" CTA does not create/submit — it routes to a second confirmation

**File:** `src/app/(dashboard)/strategies/new/wizard/steps/ReviewStep.tsx:72-124`
(also `WizardClient.tsx:678-695` and `:843-889`)
**Issue:** The ReviewStep docblock asserts *"The final CTA keeps the existing
finalize verb: 'Create strategy' (API) / 'Submit strategy' (CSV)."* and the
primary button is labelled with that finalize verb. But `onContinue` only does
`setStep("submit")` / `setStep("csv_submit")` — it advances the state machine
to `SubmitStep`/`CsvSubmitStep`, which present their OWN second CTA
("Submit for review" / "Submit strategy") that fires the actual finalize POST
(`SubmitStep.tsx:255-261`). The user clicks a button that says "Create
strategy", lands on yet another review/confirm page, and must click a second
finalize button. A finalize-verb button that does not finalize is misleading
and risks confused abandonment at the new review→submit seam — the exact funnel
stage this step was added to improve. With the Review step now in place, the
downstream SubmitStep is a redundant second recap.
**Fix:** Either (a) relabel the ReviewStep CTA to an advance verb
("Continue to submit") so the finalize verb stays unique to the step that
finalizes, or (b) wire ReviewStep's CTA to fire finalize directly and collapse
SubmitStep into a submitting/spinner state, e.g.:
```tsx
// Option (a) — minimal, keeps both steps:
const finalizeLabel =
  props.branch === "csv" ? "Continue to submit" : "Continue to create";
```

### WR-02: ReviewStep renders `$NaN` when an AUM/Max-capacity field holds a non-numeric string

**File:** `src/app/(dashboard)/strategies/new/wizard/steps/ReviewStep.tsx:155-168`
(and `:226-240` CSV branch)
**Issue:** AUM and Max capacity are free-form strings in `MetadataDraft`
(`MetadataStep.tsx:86-87` — `useState<string>`), surfaced from `<Input
type="number">`. The recap renders
`metadata.aum ? \`$${Number(metadata.aum).toLocaleString()}\` : ABSENT`. The
truthiness guard only catches the empty string; any non-empty-but-non-numeric
value (`"1e"`, a pasted `"1,000"`, scientific-notation partials some browsers
permit) makes `Number(...)` return `NaN`, so the recap shows the fabricated
string `$NaN`. That violates the no-invented-data posture this step claims and
shows the user a nonsense figure right before finalize.
**Fix:** Guard on a finite parse, not truthiness:
```tsx
const aumNum = Number(metadata.aum);
const aumDisplay = metadata.aum.trim() && Number.isFinite(aumNum)
  ? `$${aumNum.toLocaleString()}`
  : ABSENT;
```

### WR-03: `MetadataStep` Submit disabled-gate uses untrimmed `!description`, diverging from the trimmed validation rule

**File:** `src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.tsx:310`
**Issue:** The button is `disabled={!description || !categoryId}`, but the
canonical required-field rule (`descriptionError`, line 155, and `handleSubmit`,
line 171) both use `description.trim()`. A whitespace-only description
(`"   "`) is truthy, so the button enables. The `handleSubmit` guard then
re-checks `.trim()` and focuses the field, so finalize is not reachable with
junk — but the gate and the validation disagree, which is the inconsistency that
breeds future regressions and lets the user reach an "enabled" button that
silently no-ops. The inline `descriptionError` derivation is correct; only the
disabled-prop drifted.
**Fix:** Align the gate with the rule:
```tsx
<Button type="submit" disabled={!description.trim() || !categoryId}>
```

### WR-04: CSV `MetadataStep` can finalize with a null `category_id`, defeating the very fix this step was added for

**File:** `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx:800-821`
(consumes `MetadataStep.tsx:126-128`, `:310`; flows to
`CsvSubmitStep.tsx:119` → `category_id: metadata.categoryId`)
**Issue:** The CSV branch reuses `MetadataStep`, whose category auto-select
(`MetadataStep.tsx:126-128`) only sets `categoryId` if the
`discovery_categories` fetch succeeds AND returns rows. If that fetch fails
(`categoryLoadError` set) OR returns an empty set, `categoryId` stays `null`.
The submit gate `disabled={!description.trim() || !categoryId}` would normally
block this — but the gate currently uses untrimmed `!description` (WR-03) and,
more importantly, if categories load empty the user is permanently blocked with
no surfaced reason on the CSV path (no `detectedMarkets` hint applies). The
stated purpose of ISSUE-010 (`localStorage.ts:72-76`) was to STOP the CSV
branch writing `category_id=null`; a load failure/empty-set reopens exactly
that hole if the gate is ever loosened, and today produces a dead-end. There is
no server-side assertion in scope confirming `category_id` non-null at
csv-finalize.
**Fix:** Treat an empty/failed category load on the CSV path as a hard,
user-visible block (it already is for API via detected-markets context, but CSV
has no equivalent), and confirm the csv-finalize route rejects a null
`category_id` server-side so the disabled-gate is defense-in-depth, not the sole
guard:
```tsx
// surface the same categoryLoadError the API path shows, and ensure the
// finalize RPC NOT NULLs category_id rather than trusting the client gate.
```

## Info

### IN-01: `wizard_step_complete_4` declared but never emitted

**File:** `src/lib/analytics.ts:40` (and the client union re-export)
**Issue:** The `ForQuantsEvent` union declares `wizard_step_complete_4`, but no
call site fires it. The metadata→review transition fires
`wizard_step_complete_3` (`WizardClient.tsx:427`); the review→submit transition
(the new step-4 completion) fires nothing. The funnel can infer it from
`wizard_step_view_5`, so this is cosmetic, but the declared event is dead and
the review step's completion is unmeasured.
**Fix:** Either fire `wizard_step_complete_4` in the ReviewStep `onContinue`
handlers, or drop the unused union member.

### IN-02: `wizard_abandon` declared but never emitted (pre-existing, surfaced by enum review)

**File:** `src/lib/analytics.ts:43`
**Issue:** `wizard_abandon` is in the event union with no producer anywhere in
the wizard. Dead enum member; not introduced by this phase but adjacent to the
analytics changes under review.
**Fix:** Remove if truly unused, or wire a `beforeunload`/route-change abandon
event.

### IN-03: Duplicated recap-rendering markup between `ApiRecap` and `CsvRecap`

**File:** `src/app/(dashboard)/strategies/new/wizard/steps/ReviewStep.tsx:127-244`
**Issue:** The "Strategy profile" `RecapRow` block (Description / Strategy types
/ Subtypes / Markets / Supported exchanges / Leverage / AUM / Max capacity) is
duplicated nearly verbatim in `ApiRecap` and the second `RecapSection` of
`CsvRecap`, including the identical `$NaN`-prone AUM/Max-capacity logic
(WR-02). A fix to WR-02 must be applied in two places, which is how the two
copies drift.
**Fix:** Extract a shared `<StrategyProfileRows metadata={...} />` so the AUM/
capacity formatting and field set live once.

### IN-04: `WizardChrome` 3/4-column grid arms are now dead for in-tree callers

**File:** `src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx:96-101`
**Issue:** After Phase 53 both `DEFAULT_STEPS` and `CSV_STEPS` are 5-step, so
`gridColsClass` always resolves to the `grid-cols-1 sm:grid-cols-5` arm. The
`totalCount === 3` and `=== 4` branches are retained "for back-compat with any
caller passing a shorter custom `steps` array", but no such caller exists in the
tree. Harmless, but it is dead-path code that the comment acknowledges is
speculative.
**Fix:** Drop the 3/4 arms (or keep with a one-line test exercising a custom
short `steps` array so the branches aren't untested dead code).

### IN-05: `loading.tsx` skeleton stepper renders 4 cells but the live rail is 5-step

**File:** `src/app/(dashboard)/strategies/new/wizard/loading.tsx:26-37`
**Issue:** The Suspense skeleton renders a 4-cell stepper
(`Array.from({ length: 4 })`, `sm:grid-cols-4`) with the comment "4 cells,
mirroring DEFAULT_STEPS". Phase 53 made `DEFAULT_STEPS` 5 entries
(`WizardChrome.tsx:13-20`). The skeleton no longer mirrors the live rail, so the
layout shifts by one column when content arrives — the exact jump this skeleton
exists to prevent.
**Fix:** Update to 5 cells and `sm:grid-cols-5` to match `DEFAULT_STEPS`:
```tsx
className="grid grid-cols-1 gap-3 border-y border-border py-4 sm:grid-cols-5"
{Array.from({ length: 5 }).map(...)}
```

---

## Fix log (2026-06-29)

Applied on branch `v1.4-p53-54-frontend-excellence` (sequential mode, atomic
per-finding commits). Verification: wizard test suites 337 pass / 7 skipped,
`tsc --noEmit` 0 errors, eslint 0 errors on changed files, route-contract guard
OK, finalize-wizard POST contract (finalize-wizard/route.ts, SubmitStep,
CsvSubmitStep, WizardClient state machine) byte-unchanged.

- **WR-01 — fixed** (`31dbdd1c`): relabelled the ReviewStep CTA to an ADVANCE
  verb ("Continue to create" / "Continue to submit") and corrected the docblock,
  so the finalize verb stays unique to SubmitStep/CsvSubmitStep (the steps that
  actually finalize). Kept both steps per the locked "read-only review recap
  before finalize" decision; no state-machine transition change. Test assertions
  updated.
- **WR-02 — fixed** (`12bf6682`): extracted a `formatMoney()` helper that guards
  on `Number.isFinite` and falls back to the em-dash sentinel, applied at all
  four AUM/Max-capacity recap sites (ApiRecap + CsvRecap). Non-numeric values now
  render "—", never "$NaN". New test covers `"1e"` / `"1,000"`. This single home
  also partially addresses IN-03 (the AUM/capacity formatting now lives once).
- **WR-03 — fixed** (`aae5aa7e`): aligned the MetadataStep Submit disabled-gate
  to `!description.trim()` so it matches the `descriptionError` / `handleSubmit`
  `.trim()` rule. New test pins whitespace-only → disabled.
- **WR-04 — fixed (requires light human verification)** (`323c6068`):
  defense-in-depth for ISSUE-010. Server: `parseCsvMetadata` now rejects an
  explicit `category_id: null` with 400 `CSV_INVALID_FORMAT` BEFORE the finalize
  RPC (absent-key metadata-less path untouched). Client: MetadataStep surfaces an
  honest visible block when `discovery_categories` loads to an empty readable set
  (no telemetry on the empty path, per M-0248). 3 new route-level regression
  tests + 2 new MetadataStep tests. Finalize POST body shape unchanged. Logic-
  bearing state/contract change — confirm the 400 path and empty-category UX in
  a manual pass before phase verification.
- **IN-05 — fixed** (`52c75a6f`): wizard `loading.tsx` skeleton now renders 5
  stepper cells + `sm:grid-cols-5` to mirror the now-5-step `DEFAULT_STEPS`, so
  the rail no longer shifts a column on mount. Test pinned to exactly 5 cells.

### Deferred / partially addressed (not in the directed scope, or non-trivial)

- **IN-01** (`wizard_step_complete_4` declared but unfired) — **deferred**.
  Firing a new funnel event is an analytics-contract change with downstream
  dashboard implications, not zero-risk telemetry plumbing. Left to a deliberate
  analytics change. The funnel can still infer step-4 completion from
  `wizard_step_view_5`.
- **IN-02** (`wizard_abandon` declared but unfired) — **deferred**. Pre-existing,
  not introduced by Phase 53; out of polish scope (either a new `beforeunload`
  producer or an enum removal, both deliberate analytics edits).
- **IN-03** (duplicated ApiRecap/CsvRecap markup) — **partially addressed**. The
  drift-prone AUM/Max-capacity formatting flagged by the review now lives once in
  `formatMoney()` (folded into WR-02). The fuller `<StrategyProfileRows>`
  extraction is a larger refactor left as opportunistic cleanup.
- **IN-04** (dead WizardChrome 3/4 grid arms) — **deferred**. The review itself
  offers "keep" as an acceptable option; removing the speculative back-compat
  arms is non-essential and risks the documented custom-`steps` contract.

_Fixed: 2026-06-29 — Claude (gsd-code-fixer)_

---

_Reviewed: 2026-06-29_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

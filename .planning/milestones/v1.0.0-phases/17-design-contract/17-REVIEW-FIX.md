---
phase: 17-design-contract
fixed_at: 2026-05-01T20:26:00Z
review_path: .planning/phases/17-design-contract/17-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
deferred: 4
status: all_fixed
branch: v1.0.0-api-key-rewrite-15-16
---

# Phase 17: Code Review Fix Report

**Fixed at:** 2026-05-01T20:26:00Z
**Source review:** `.planning/phases/17-design-contract/17-REVIEW.md`
**Iteration:** 1
**Branch:** `v1.0.0-api-key-rewrite-15-16` (unchanged — verified pre + post)

**Summary:**

| Severity | Total in REVIEW | In scope | Fixed | Skipped | Deferred (out of scope) |
|----------|----------------:|---------:|------:|--------:|------------------------:|
| Critical | 1 | 1 | 1 | 0 | 0 |
| High     | 2 | 2 | 2 | 0 | 0 |
| Medium   | 2 | 2 | 2 | 0 | 0 |
| Low      | 1 | 0 | 0 | 0 | 1 |
| Info     | 3 | 0 | 0 | 0 | 3 |
| **Total**| **9** | **5** | **5** | **0** | **4** |

**Test posture:**
- Full Vitest suite: 2796 passed, 159 skipped, 0 failures
- `npx tsc --noEmit`: zero new errors (only pre-existing
  `src/app/api/debug-key-flow/route.ts:257` deferred per
  `deferred-items.md` — unchanged)
- Per-fix verification: ErrorEnvelope.test.tsx (16 → 17 tests with the
  new CR-01 regression and HI-01 contract pin), wizard-contrast.test.ts
  (19 tests still green), trust-tier-tokens.test.ts (8 tests still
  green), WizardErrorEnvelope shim smoke-test (4 tests still green)

---

## Fixed Issues

### CR-01: JWT token leaks to clipboard via `Authorization: Bearer <JWT>` debug_context line

**Severity:** critical
**Files modified:**
- `src/components/error/ErrorEnvelope.tsx`
- `src/components/error/ErrorEnvelope.test.tsx`

**Commit:** `3050a0a`

**Before:** the two-pass scrub (`redactSensitiveSubstrings` → `scrubPii`)
left the JWT intact for debug_context lines of the form
`Authorization: Bearer eyJ...`. Pass 1 captured `Bearer` (not the JWT)
because the value group `[^\s'"]+` stopped at the space before the
token; pass 2's `JWT_SHAPE` is anchored `^...$` so it didn't fire on
the prefixed `Authorization: [REDACTED] eyJ...` string.

**After:** added a third-pass `redactJwtSubstrings` that scans for
JWT-shaped substrings anywhere in the line — three base64url segments
of ≥10 chars each separated by dots → `[REDACTED_JWT]`. The 10-char
minimum keeps the false-positive rate low.

**Regression test added:** `pii-scrub redacts Authorization: Bearer
JWT before clipboard write (CR-01)` in
`src/components/error/ErrorEnvelope.test.tsx`. The test fails without
the third-pass fix and passes with it (manually verified).

**Status:** fixed (semantic correctness verified by regression test).

---

### HI-01: `aria-label` values on Retry and Cancel CTAs do not match UI-SPEC §13/§8.4 contract

**Severity:** high
**Files modified:**
- `src/components/error/ErrorEnvelope.tsx`
- `src/components/error/ErrorEnvelope.test.tsx`

**Commit:** `cb43e8d`

**Before:** Retry and Cancel had bare `aria-label="Retry"` /
`aria-label="Cancel"`. UI-SPEC §8.4 (verified verbatim against
`17-UI-SPEC.md` lines 439-440) specifies `aria-label="Retry
{operation}"` and `aria-label="Cancel and return"`. The existing test
suite asserted the wrong values, hiding the gap.

**After:**
- Added optional `operation?: string` prop to `ErrorEnvelopeProps`.
- Retry: when `operation` is provided, `aria-label="Retry
  {operation}"`; when omitted (current 3 wizard step consumers),
  falls back to `"Retry"` so call sites churn-free.
- Cancel: always `aria-label="Cancel and return"`.
- Visible button text remains the single word `Retry` / `Cancel`.

**Tests:** existing default-fallback assertion preserved
(`aria-label='Retry'` when no operation). Two new tests added:
1. `Retry button has aria-label='Retry {operation}' when operation is
   provided (UI-SPEC §8.4)` — pins the new contract.
2. `Cancel button has aria-label='Cancel and return' (UI-SPEC §8.4)` —
   rewritten to assert the new value.

**Wizard shim impact:** the existing
`WizardErrorEnvelope.tsx` re-exports `ErrorEnvelopeProps` as
`WizardErrorEnvelopeProps`, so the new `operation` prop is
automatically exposed to any caller that opts in. The 3 current step
consumers (ConnectKeyStep / SyncPreviewStep / SubmitStep) don't pass
`operation` and are unchanged — they get the `"Retry"` fallback. Phase
18/19 step rewrites will be able to thread an `operation` per
UI-SPEC §13.

**Status:** fixed.

---

### HI-02: Contrast ratio claim wrong (6.95:1 cited; 6.37:1 actual)

**Severity:** high (documentation — no runtime impact)
**Files modified:**
- `src/lib/design-tokens/trust-tier.ts`
- `.planning/phases/17-design-contract/17-UI-SPEC.md` (lines 174-175 + line 926)

**Commit:** `0332028`

**Before:** the `api_verified.text` slot comment claimed `6.95:1`. The
WCAG sRGB-luminance computation for `#FFFFFF` on `#1B6B5A` yields
`6.37:1` (verified independently — see hand-rolled calculation:
0.2126·R_lin + 0.7152·G_lin + 0.0722·B_lin → ratio 6.3688). The wrong
value also appeared in `17-UI-SPEC.md` §4.1 spec table comments (lines
174-175) and §17 row 1 (line 926).

The token still passes WCAG AA (≥4.5:1) and the contrast Vitest assertion
still passes (it asserts `≥4.5`, not the cited `6.95`), so there is no
functional regression. But a downstream engineer using the comment to
evaluate whether 12px text passes WCAG AAA (≥7:1) would incorrectly
conclude it does — `6.37:1` does NOT pass AAA.

**After:** corrected the inline comment in `trust-tier.ts` to
`6.37:1 (AA pass; does NOT hit AAA 7:1)` so the AAA gap is explicit.
Same correction applied verbatim to the UI-SPEC spec table and §17
row 1.

**Tests:** trust-tier-tokens.test.ts (8 tests) and
wizard-contrast.test.ts (19 tests) both still green. No code change.

**Status:** fixed.

---

### ME-01: Contrast test pair 8 uses lighter `NEGATIVE_BG_5` approximation than rendered surface — direction undocumented

**Severity:** medium
**Files modified:**
- `tests/a11y/wizard-contrast.test.ts`

**Commit:** `7ba3c94`

**Before:** `NEGATIVE_BG_5 = "#FFF5F5"` is a lighter approximation
than the actual resolved color of `bg-negative/5`
(`--color-negative #DC2626` at 5% alpha over white = `#FDF4F4`). The
existing comment said only "approx of bg-negative/5 over white" —
without flagging that the approximation is anti-conservative (gives
~0.05 more contrast points than reality, masking a 4.40:1 real-world
margin behind a 4.45:1 test margin).

**After:** inlined a multi-line comment block that documents the
direction (lighter than reality), the magnitude (~0.05 contrast
points), the regression-seam intent (threshold pin at 4.4 + the
TRACKED-DEBT entry in `deferred-items.md`), and the actual resolved
hex (`#FDF4F4`).

**Tests:** wizard-contrast.test.ts (19 tests) still green — comment
only.

**Status:** fixed.

---

### ME-02: `admin-csv-status-axe.spec.ts` could scan wrong page on admin-user seed gap (false-green)

**Severity:** medium
**Files modified:**
- `e2e/admin-csv-status-axe.spec.ts`

**Commit:** `de8615b`

**Before:** when `HAS_SEED_ENV` was true but the seed helper only
provisioned a regular allocator (no admin user),
`page.goto("/admin/csv-status")` redirected to `/discovery/crypto-sma`.
The wait-for-`h1` expectation passed on the redirect target (the
discovery page also renders an `h1`), so the axe scan ran against the
wrong page and reported a misleading green.

**After:** added an explicit URL assertion immediately after
`page.goto()`:
```ts
await expect(page).toHaveURL(/\/admin\/csv-status/, { timeout: 10_000 });
```
The wait-for-`h1` is preserved as belt-and-braces. If the seed helper
only mints a regular allocator the redirect fires and the URL
assertion fails loudly — surfacing the admin-seed gap as a real test
failure rather than a silent false green.

**Tests:** Playwright spec — not run in this fix pass (Playwright
e2e runs separately + requires Supabase env vars). TypeScript check
passes. The fix logic mirrors the equivalent guard in
`discovery-axe.spec.ts:71-77` referenced in the existing comment.

**Status:** fixed (Playwright behavior verification deferred to e2e
run).

---

## Deferred (out of scope per default `critical_warning` + `medium` policy)

The following 4 findings are Low / Info severity and were
explicitly marked by the reviewer as either Phase 18/19 follow-ups or
trade-offs that don't require a Phase 17 fix. Deferring them per the
orchestrator's default scope.

### LO-01: CsvPreviewStep + CsvSubmitStep both use "Submit strategy" CTA — UX/a11y concern

**File:** `src/lib/wizardErrors.ts:633,643`
**Reason for deferral:** The reviewer explicitly classifies this as a
Phase 18/19 follow-up: "This was hoisted verbatim from the Phase 15
step files per the UI-SPEC §14.1 source-of-truth lock, so changing it
requires UI-SPEC alignment." The Phase 17 contract says the strings
are inherited verbatim from Phase 15; modifying them inside Phase 17
would violate the source-of-truth lock and require UI-SPEC §14.1
edits beyond Phase 17 scope.
**Recommended owner:** Phase 18 or Phase 19 — change
`CSV_PREVIEW_STEP_HEADINGS.continueLabel` to `"Continue to review"`
(or similar nav-describing label) and update
`wizardErrors.test.ts:248`.

### IN-01: Token file re-exports `TrustTier` from a component file

**File:** `src/lib/design-tokens/trust-tier.ts:22-24`
**Reason for deferral:** Reviewer explicitly notes "The 17-CONTEXT.md
decision D-01 explicitly chose the current approach to avoid drift —
this is a registered trade-off, not a required fix." The current
indirect import is a documented architectural decision; reversing it
would itself need a CONTEXT.md amendment.

### IN-02: `buildDiagBlock` exported as named export → public API surface

**File:** `src/components/error/ErrorEnvelope.tsx:66`
**Reason for deferral:** Reviewer explicitly notes "No change needed
now — the export is consistent with the test-driven pattern." Info
only.

### IN-03: `WARNING_BG_5` constant naming + DESIGN.md cross-reference clarity

**File:** `tests/a11y/wizard-contrast.test.ts:55`
**Reason for deferral:** Reviewer notes "Both `#B45309` on `#FEF1E5`
(4.53:1) and `#B45309` on `#FEF3C7` (4.51:1) pass ≥4.5, so no
failure." Info only — comment-clarity nit. The orchestrator's stated
policy ("Skip Low/Info unless they are trivial one-line corrections
that align with already-planned work") applies; this is a multi-line
comment refactor that does not align with already-planned work.

---

## Pre-existing items referenced (not Phase 17 findings)

Review correctly out-of-scoped two pre-existing items:
- `src/app/api/debug-key-flow/route.ts:257` — TS2322 type error
  pre-dating Phase 17 base. Logged in `deferred-items.md`. Confirmed
  unaffected by this fix pass (still appears in `tsc --noEmit` output
  unchanged).
- `src/components/error/ErrorEnvelope.tsx:119` — `text-text-muted`
  on `bg-negative/5` ≈ 4.40:1 (below WCAG AA 4.5:1). Logged in
  `deferred-items.md` with TRACKED-DEBT comment in
  `wizard-contrast.test.ts`. Phase 17 scope is to ship the test that
  pins the gap; the fix (recolor to `text-text-secondary` or deepen
  `--color-text-muted`) belongs to Phase 18 or a dedicated a11y polish
  plan.

---

## Branch verification

- Pre-fix: `git rev-parse --abbrev-ref HEAD` → `v1.0.0-api-key-rewrite-15-16`
- Post-fix: `git rev-parse --abbrev-ref HEAD` → `v1.0.0-api-key-rewrite-15-16`
- No `git checkout`, `git switch`, `git pull`, `git fetch`, or
  `git branch` (except `--show-current` / `--abbrev-ref`) was run.
- 5 atomic fix commits added on top of the existing branch.

---

_Fixed: 2026-05-01_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
_Branch: v1.0.0-api-key-rewrite-15-16 (unchanged)_

---

## REVIEW-FIX COMPLETE

| Outcome | Count |
|---------|-------|
| Fixed   | 5 (CR-01, HI-01, HI-02, ME-01, ME-02) |
| Deferred (out of default scope) | 4 (LO-01, IN-01, IN-02, IN-03) |
| Failed  | 0 |

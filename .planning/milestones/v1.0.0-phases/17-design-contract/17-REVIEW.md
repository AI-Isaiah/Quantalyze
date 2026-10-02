---
phase: 17-design-contract
reviewed: 2026-05-01T00:00:00Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - src/lib/design-tokens/trust-tier.ts
  - tests/a11y/trust-tier-tokens.test.ts
  - src/components/error/ErrorEnvelope.tsx
  - src/components/error/ErrorEnvelope.test.tsx
  - src/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope.tsx
  - src/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope.test.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/CsvUploadStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/CsvPreviewStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/CsvValidationEnvelope.tsx
  - src/lib/wizardErrors.ts
  - src/lib/wizardErrors.test.ts
  - src/components/strategy/TrustTierLabel.tsx
  - src/components/strategy/TrustTierLabel.test.tsx
  - tests/a11y/wizard-contrast.test.ts
  - e2e/wizard-axe.spec.ts
  - e2e/admin-csv-status-axe.spec.ts
findings:
  critical: 1
  high: 2
  medium: 2
  low: 1
  info: 3
  total: 9
status: findings
---

# Phase 17: Code Review Report

**Reviewed:** 2026-05-01
**Depth:** standard
**Files Reviewed:** 17
**Status:** findings — 1 critical, 2 high, 2 medium, 1 low, 3 info

## Summary

Phase 17 delivers a well-structured design contract: the token file, ErrorEnvelope rebrand, wizardErrors CSV absorption, and a11y test scaffolding are all coherent and largely correct. The hoist-marker elimination is complete (zero `TODO(phase-17)` markers remain in `src/`). The TrustTierLabel call signature is byte-identical to Phase 15 v0. The `as const satisfies` assertion is correct. The WizardErrorEnvelope re-export shim is correctly wired for all three step consumers.

One critical security issue was found during traced execution of the two-pass PII scrub: an `Authorization: Bearer <JWT>` debug_context string survives both passes and writes the JWT token to the clipboard. One high-priority issue is that the `aria-label` values on the Retry and Cancel CTAs do not match the UI-SPEC §13 contract (`"Retry"` instead of `"Retry {operation}"`, `"Cancel"` instead of `"Cancel and return"`). One high-priority documentation issue: a contrast ratio claim in the token file comment and UI-SPEC §17 row 1 is materially wrong (6.95:1 claimed; 6.37:1 actual). Two medium issues and additional info items are documented below.

---

## Critical Issues

### CR-01: JWT token leaks to clipboard via `Authorization: Bearer <JWT>` debug_context line

**File:** `src/components/error/ErrorEnvelope.tsx:54-84`
**Severity:** critical
**Issue:** The two-pass scrub (`redactSensitiveSubstrings` → `scrubPii`) does not redact the JWT token when a debug_context line has the form `Authorization: Bearer <JWT>`.

Traced execution:
1. Pass 1 — the `SENSITIVE_KEY_VALUE` regex matches `authorization` as the key name and captures `Bearer` (not the JWT) as the value group, because `Bearer` is the first non-whitespace token after the colon-space separator. The regex's value capture group is `[^\s'"]+` which stops at the space before the JWT. Result after pass 1: `"Authorization: [REDACTED] eyJhbGciOiJIUzI1NiJ9.eyJ…"`.
2. Pass 2 — `scrubPii` receives the whole string and calls `scrubString`. `JWT_SHAPE` is `^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$` with anchors `^` and `$`; it does not match because the input is not a pure JWT — it starts with `"Authorization: [REDACTED] "`. The JWT embedded after that prefix survives.

A bare JWT as a standalone debug_context line (e.g. `["eyJ…"]`) IS caught correctly by pass 2 because the entire string matches `JWT_SHAPE`. The vulnerability is specific to header-formatted strings.

**The test at `ErrorEnvelope.test.tsx:165` does test JWT redaction but uses a standalone JWT string** — not the `Authorization: Bearer <JWT>` form — so the test passes while the header format leaks.

**Fix:**
```typescript
// Option A (minimal): extend SENSITIVE_KEY_VALUE to make the value group
// consume the rest of the line (greedy, ignoring whitespace between Bearer and token).
// Change the value group from:
//   ['\"]?([^\s'"]+)['\"]?
// to:
//   (?:Bearer\s+)?['\"]?([^\s'"]+)['\"]?(?:\s+\S+)*
// This is complex and fragile. Prefer Option B.

// Option B (preferred): after pass 1, apply a JWT_SHAPE scan on each word/token
// instead of on the whole string. Replace the scrubPii pass with a
// token-scan pass that redacts any word matching JWT_SHAPE.
const JWT_WORD = /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

function redactJwtSubstrings(value: string): string {
  return value.replace(JWT_WORD, "[REDACTED_JWT]");
}

// In buildDiagBlock, change the debug_context mapping to:
...envelope.debug_context.map((step) => {
  const subRedacted = redactSensitiveSubstrings(step);
  // scrubPii handles full-string JWT + key-based object scrub
  const scrubbed = scrubPii(subRedacted);
  const asString = typeof scrubbed === "string" ? scrubbed : String(scrubbed ?? "");
  // Third pass: catch JWT tokens embedded in already-partially-redacted strings
  return ` - ${redactJwtSubstrings(asString)}`;
}),
```

The corresponding test case that should be added (and should fail before the fix):
```typescript
it("pii-scrub redacts Authorization: Bearer JWT before clipboard write", async () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  const env = makeEnvelope({
    debug_context: [`Authorization: Bearer ${jwt}`],
  });
  render(<ErrorEnvelope envelope={env} />);
  fireEvent.click(screen.getByText("Copy diagnostics"));
  await waitFor(() => {
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });
  const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>)
    .mock.calls[0][0] as string;
  expect(written).not.toContain(jwt);
});
```

---

## High Issues

### HI-01: `aria-label` values on Retry and Cancel CTAs do not match UI-SPEC §13 contract

**File:** `src/components/error/ErrorEnvelope.tsx:133,144`
**Severity:** high
**Issue:** UI-SPEC §13 table rows (lines 439-440) specify:
- Retry CTA: `aria-label="Retry {operation}"` (e.g. `Retry validating key`, `Retry sync`, `Retry submit`)
- Cancel CTA: `aria-label="Cancel and return"`

The implementation uses generic `aria-label="Retry"` and `aria-label="Cancel"`. The context-specific label is the accessibility contract because screen-reader users tabbing through multiple error regions need to distinguish which button retries which operation. The generic label is technically functional but fails the UI-SPEC contract.

The test suite (`ErrorEnvelope.test.tsx:90-102`) asserts `getByLabelText("Retry")` and `getByLabelText("Cancel")`, so it passes — but this means the test also does not catch the gap.

**Fix:**
Add an `operation` prop to `ErrorEnvelopeProps` (optional, with a sensible default) and thread it through:

```typescript
export interface ErrorEnvelopeProps {
  envelope: ErrorEnvelopeType;
  onRetry?: () => void;
  onCancel?: () => void;
  /** Short label for the operation being retried, e.g. "validating key".
   *  Used in aria-label="Retry {operation}" per UI-SPEC §13.
   *  Defaults to "" (yields aria-label="Retry") when callers do not specify. */
  operation?: string;
}

// In the component:
const retryLabel = operation ? `Retry ${operation}` : "Retry";
// <Button aria-label={retryLabel}>Retry</Button>
// <Button aria-label="Cancel and return">Cancel</Button>
```

The WizardErrorEnvelope shim and its `WizardErrorEnvelopeProps` re-export should also forward the new prop. Existing callers (ConnectKeyStep, SyncPreviewStep, SubmitStep) that don't pass `operation` will gracefully fall back to `"Retry"` — no churn required.

### HI-02: Contrast ratio claim in token file comment and UI-SPEC §17 row 1 is materially wrong

**File:** `src/lib/design-tokens/trust-tier.ts:43`
**Severity:** high (documentation — no runtime impact, but misleads future AA audits)
**Issue:** The comment on the `api_verified.text` slot claims `6.95:1`. The WCAG sRGB-luminance computation for white (`#FFFFFF`) on `#1B6B5A` yields **6.37:1**, not 6.95:1. UI-SPEC §17 row 1 makes the same incorrect claim.

The token passes WCAG AA (≥4.5:1) and the contrast test only asserts `≥4.5`, so there is no functional regression. But the wrong ratio is cited in:
- `src/lib/design-tokens/trust-tier.ts:43` (inline comment)
- `17-UI-SPEC.md` §4.1 spec table and §17 row 1

A downstream engineer using the comment to evaluate whether 12px text passes WCAG AAA (≥7:1) would incorrectly conclude it does. 6.37:1 does not pass AAA.

**Fix:**
```typescript
// In trust-tier.ts, change:
text: "#FFFFFF",   // white on accent — 6.95:1 (AA pass for 12px text)
border: "#1B6B5A", // accent on white — 6.95:1
// To:
text: "#FFFFFF",   // white on accent — 6.37:1 (AA pass; does not hit AAA 7:1)
border: "#1B6B5A", // accent on white — 6.37:1
```

Update UI-SPEC §17 row 1 to show `6.37:1` computed ratio.

---

## Medium Issues

### ME-01: Contrast test pair 8 uses a lighter `NEGATIVE_BG_5` approximation than the actual rendered surface

**File:** `tests/a11y/wizard-contrast.test.ts:54`
**Severity:** medium
**Issue:** The test defines `NEGATIVE_BG_5 = "#FFF5F5"`. The actual resolved color of `bg-negative/5` (`--color-negative: #DC2626` at 5% alpha over white) is `#FDF4F4` (rgb(253, 244, 244)). The lighter `#FFF5F5` approximation gives a higher contrast ratio (4.45 vs 4.40 on the actual surface), making the test anti-conservative. Combined with the existing 4.4 threshold on pair 8, the real-world margin is 4.40:1 (passes 4.4 by only 0.002). If either Tailwind's opacity computation or the theme's `--color-negative` value shifts even slightly, the test will still pass while the real DOM fails.

This is acceptable as a known debt item (already documented in `deferred-items.md`), but the comment in the test file does not note the approximation direction — it only says "approx of bg-negative/5 over white". Clarifying that the approximation is lighter than reality preserves the intent of the regression seam.

**Fix:**
```typescript
// Change the constant comment to document approximation direction:
const NEGATIVE_BG_5 = "#FFF5F5"; // approx of bg-negative/5 over white (#DC2626 5% alpha
                                  // resolves to #FDF4F4 = rgb(253,244,244); using lighter
                                  // #FFF5F5 is anti-conservative by ~0.05 contrast points —
                                  // see deferred-items.md for the known a11y gap.
```

No test-logic change needed — the threshold pinning (4.4) and deferred-items.md already capture the gap correctly.

### ME-02: `admin-csv-status-axe.spec.ts` will scan the wrong page when run with seed env vars but without admin-user seed

**File:** `e2e/admin-csv-status-axe.spec.ts:50-70`
**Severity:** medium
**Issue:** When `HAS_SEED_ENV` is true but the seed helper only provisions a regular allocator, `page.goto("/admin/csv-status")` causes a server-side redirect to `/discovery/crypto-sma`. The test then waits for `h1` to be visible on that redirect target — which it will be (`h1` exists on the discovery page). The axe scan runs against `/discovery/crypto-sma`, not `/admin/csv-status`. A green result is a false positive.

The skip comment at line 43-48 correctly documents this gap, but the `HAS_SEED_ENV` condition does not distinguish "has seed env" from "has admin user seed." Because the test.skip only fires on `!HAS_SEED_ENV`, any CI environment with the Supabase env vars wired (but no admin user) will run and produce a misleading green scan.

**Fix:** Add a URL assertion after navigation to confirm the expected route was reached before scanning:
```typescript
// After page.goto("/admin/csv-status"), before building axe:
await expect(page).toHaveURL(/\/admin\/csv-status/, { timeout: 10_000 });
// If the admin-user seed gap means redirect fires, this assertion fails loudly
// (instead of silently scanning /discovery/crypto-sma).
```

This surfaces the admin-seed gap as a loud failure rather than a silent false green. Alternatively, add a `HAS_ADMIN_SEED_ENV` flag and gate the test on it.

---

## Low Issues

### LO-01: CsvPreviewStep and CsvSubmitStep both use "Submit strategy" as their CTA label — different step semantics, identical label

**File:** `src/lib/wizardErrors.ts:633,643`
**Severity:** low (UX + a11y concern; not a code defect)
**Issue:** `CSV_PREVIEW_STEP_HEADINGS.continueLabel = "Submit strategy"` and `CSV_SUBMIT_STEP_HEADINGS.submitCtaLabel = "Submit strategy"`. CsvPreviewStep's "Submit strategy" navigates to CsvSubmitStep (not yet a submission); CsvSubmitStep's "Submit strategy" fires the actual finalize POST. A screen-reader user or keyboard navigator encounters the same button label in two consecutive steps with entirely different consequences.

This was hoisted verbatim from the Phase 15 step files per the UI-SPEC §14.1 source-of-truth lock, so changing it requires UI-SPEC alignment. Flagged here so Phase 18/19 can reconsider the CsvPreviewStep CTA label (e.g. `"Continue to review"`) before the surfaces ship.

**Fix (Phase 18/19 follow-up):** Change `CSV_PREVIEW_STEP_HEADINGS.continueLabel` to a label that describes navigation rather than submission, e.g. `"Continue to review"`. Update the corresponding test assertion in `wizardErrors.test.ts:248`.

---

## Info

### IN-01: Token file re-exports `TrustTier` from a component file, creating an indirect import chain

**File:** `src/lib/design-tokens/trust-tier.ts:22-24`
**Issue:** The token file re-exports `TrustTier` via `export type { TrustTier } from "@/components/strategy/TrustTierLabel"`. While this is type-only and is erased at compile time (no runtime circular dependency), it means the "framework-neutral" `src/lib/design-tokens/` layer depends on a `src/components/` file at the type level. A future Storybook config or non-Next environment importing from the token file would also implicitly reference the component module path. The pattern is pragmatic and avoids duplicate-declaration drift, but it inverts the expected layering (`lib/design-tokens` → `components`).

**Fix (optional):** Declare `TrustTier` directly in the token file and change `TrustTierLabel.tsx` to import from the token file. This makes the dependency arrow go in the correct direction (component depends on token layer). The 17-CONTEXT.md decision D-01 explicitly chose the current approach to avoid drift — this is a registered trade-off, not a required fix.

### IN-02: `buildDiagBlock` is exported as a named export making it part of the public API surface

**File:** `src/components/error/ErrorEnvelope.tsx:66`
**Issue:** `buildDiagBlock` is exported from `ErrorEnvelope.tsx`. This is necessary for the test (`ErrorEnvelope.test.tsx` does NOT import `buildDiagBlock` directly — the test drives it via the component UI — so the export is actually only needed by the test file). Making it `export` exposes it as a stable API that future callers might depend on. If the format changes (e.g. Phase 18 adds a structured field), callers would break.

**Fix:** No change needed now — the export is consistent with the test-driven pattern. Note it for Phase 18: if the diag format changes, `buildDiagBlock` signature is the single change surface and its export is the right seam to test against.

### IN-03: `NEGATIVE_BG_5` constant in wizard-contrast.test.ts is misnamed relative to the actual WARNING_BG_5 case

**File:** `tests/a11y/wizard-contrast.test.ts:55`
**Issue:** The constant `WARNING_BG_5 = "#FEF1E5"` does not match the canonical `--color-warning-bg: #FEF3C7` documented in DESIGN.md (the HoldingsTable chip surface). The test comment in pair 6 acknowledges "The DESIGN.md --color-warning-bg canonical hex is #FEF3C7; this row uses the resolved-over-white approximation for the bg-negative/5 shell context." The comment is confusing because `#FEF1E5` is not a resolved-over-white of `#FEF3C7` — it appears to be an independent approximation. Both `#B45309` on `#FEF1E5` (4.53:1) and `#B45309` on `#FEF3C7` (4.51:1) pass ≥4.5, so no failure.

**Fix:** Clarify the constant declaration comment to state its source:
```typescript
const WARNING_BG_5 = "#FEF1E5"; // defense-in-depth approximation for bg-warning/5 over white.
                                  // Canonical --color-warning-bg is #FEF3C7 (HoldingsTable chip);
                                  // self_reported rendering context is bg-page #F8F9FA (row 5).
```

---

## Pre-existing Deferred Item (not a Phase 17 finding)

The following was correctly out-of-scoped to `deferred-items.md` by the executor and is confirmed as pre-existing:

- `src/app/api/debug-key-flow/route.ts:257` — TS2322 type error pre-dating Phase 17 base commit. Not introduced by Phase 17 changes. Out of scope.
- `src/components/error/ErrorEnvelope.tsx:119` — `text-text-muted` (#64748B) on `bg-negative/5` (~4.40:1) — below WCAG AA 4.5:1 threshold. Correctly logged in `deferred-items.md`. The contrast test pins this at ≥4.4 with a TRACKED-DEBT comment. Acknowledged and out of Phase 17 scope.

---

_Reviewed: 2026-05-01_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Branch verified: v1.0.0-api-key-rewrite-15-16_

---

## REVIEW COMPLETE

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High     | 2 |
| Medium   | 2 |
| Low      | 1 |
| Info     | 3 |
| **Total**| **9** |

**Critical (must fix before merge):** CR-01 — JWT token not redacted for `Authorization: Bearer <JWT>` debug_context format. Clipboard is the user-controlled exfiltration surface; the specific pattern was tested with the wrong input shape.

**High (fix before merge):** HI-01 — aria-label values violate UI-SPEC §13 contract. HI-02 — wrong contrast ratio documented in token file comment and UI-SPEC.

**Medium (fix before Phase 18 entry):** ME-01 — contrast test approximation direction undocumented. ME-02 — axe spec will produce false-green on admin page redirect.

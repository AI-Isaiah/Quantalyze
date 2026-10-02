---
phase: 17
plan: 04
subsystem: design-contract
tags: [DESIGN-02, error-envelope, rebrand, pii-scrub, surface-agnostic]
requirements:
  - DESIGN-02
dependency-graph:
  requires:
    - "src/lib/envelope.ts (ErrorEnvelope shape — Phase 16 OBSERV-06)"
    - "src/lib/admin/pii-scrub.ts (scrubPii utility — Phase 16 OBSERV-04/05)"
    - "src/components/ui/Button.tsx (Button primitive)"
    - "src/lib/wizardErrors.ts (source-of-truth — DESIGN-05)"
  provides:
    - "src/components/error/ErrorEnvelope.tsx — canonical surface-agnostic error renderer"
    - "ErrorEnvelopeProps interface (consumed by future surfaces)"
    - "buildDiagBlock() helper — newline-delimited QUANTALYZE_DIAG payload builder"
  affects:
    - "src/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope.tsx (collapsed 99 → 8 lines, now a re-export shim)"
    - "src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx (UNCHANGED — works through shim)"
    - "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx (UNCHANGED — works through shim)"
    - "src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx (UNCHANGED — works through shim)"
tech-stack:
  added: []
  patterns:
    - "Surface-agnostic component naming (ErrorEnvelope, not WizardErrorEnvelope) — prerequisite for the all-surfaces wireframe scope"
    - "Re-export shim for backward-compat during phased migration (Phase 17 ships shim, Phase 19 may delete)"
    - "Newline-delimited diagnostic payload (QUANTALYZE_DIAG) for paste-survivability in support tickets"
    - "Two-pass PII scrub: regex-redact key:value substrings, then scrubPii() for JWT-shape catch"
key-files:
  created:
    - "src/components/error/ErrorEnvelope.tsx (176 lines — canonical surface-agnostic renderer)"
    - "src/components/error/ErrorEnvelope.test.tsx (208 lines — 15 vitest assertions)"
    - ".planning/phases/17-design-contract/deferred-items.md (Phase 17 deferred-items log)"
  modified:
    - "src/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope.tsx (99 → 8 lines — re-export shim)"
    - "src/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope.test.tsx (5 deep tests → 1 smoke + 3 preserved buildEnvelope contract tests)"
decisions:
  - "Drop the type-name re-export `export type { ErrorEnvelope as ErrorEnvelope }` from the canonical component file (TS2323 collision with `function ErrorEnvelope`). Consumers needing the type import from `@/lib/envelope`; the wizard-path shim re-exports the type from `@/lib/envelope` directly so existing callers keep working."
  - "Two-pass PII scrub on the diag block: regex-redact `apikey:VALUE` / `secret:VALUE` / `token:VALUE` substring patterns INLINE in the component file (UI-SPEC §16.2 contract is substring-redacted; existing scrubPii() is object-key-name + JWT-shape only — extending the shared utility was out of scope)."
  - "Test migration Option A: keep the deep DOM/format/scrub assertions at the canonical path (`src/components/error/ErrorEnvelope.test.tsx`); reduce the wizard-path test to a 1-assertion smoke-check that the shim resolves to the same Function reference. Preserves the [OBSERV-06] buildEnvelope contract tests (pure-function, unaffected by the rebrand)."
metrics:
  duration_minutes: 8
  tests_added: 15
  tests_modified: 5
  completed_date: 2026-05-01
---

# Phase 17 Plan 04: Rebrand WizardErrorEnvelope → ErrorEnvelope Summary

Canonical surface-agnostic error envelope renderer at `src/components/error/ErrorEnvelope.tsx` with DESIGN-02 typography upgrade (16px DM Sans semibold #1A1A2E), reordered Retry CTA placement (after body, before details), newline-delimited `QUANTALYZE_DIAG` clipboard payload (replaces `JSON.stringify`), two-pass PII scrub before clipboard write, explicit aria-labels on Retry/Cancel CTAs, always-collapsed details accordion. Old wizard path collapses from 99 lines to an 8-line re-export shim — three wizard-step consumers (ConnectKeyStep / SyncPreviewStep / SubmitStep) work unchanged.

## What Was Built

### 1. Canonical `ErrorEnvelope` component (`src/components/error/ErrorEnvelope.tsx`)

Surface-agnostic error renderer used by every error surface in v1.0.0:
- Wizard step errors (via the shim at the old wizard path)
- CSV upload errors (Phase 19 will wire)
- Factsheet load failures (Phase 18 `error.tsx` consumer)
- Admin status page errors (Phase 18)
- Future `error.tsx` route boundaries

**Behavior changes from the original `WizardErrorEnvelope`:**

| Aspect | Before | After |
|--------|--------|-------|
| Title typography | `text-sm font-semibold text-negative` | `text-base font-semibold text-text-primary` (16px DM Sans semibold #1A1A2E per REQ DESIGN-02) |
| Retry CTA placement | After `<details>` | Between body `<ul>` and `<details>` (codifies REQ DESIGN-02 wireframe) |
| Copy-diagnostics format | `JSON.stringify(envelope, null, 2)` | Newline-delimited `QUANTALYZE_DIAG` block (UI-SPEC §16.1) |
| PII redaction | None | `redactSensitiveSubstrings()` + `scrubPii()` two-pass before `navigator.clipboard.writeText` |
| Accessibility | Children-text-derived `aria-label` | Explicit `aria-label="Retry"` / `aria-label="Cancel"` (i18n-robust) |
| Test-id | `data-testid="wizard-error-envelope"` | `data-testid="error-envelope"` (canonical) + `data-testid-legacy="wizard-error-envelope"` (E2E continuity) |

**Preserved unchanged:**

- All `<button>` elements have `type="button"` (Pitfall 9 — no accidental form submit)
- `role="alert"` shell + `border-negative/30` + `bg-negative/5`
- ARIA-live "Copied to clipboard" status announcement
- `<details>` always-collapsed by default (no `open` attribute)

### 2. Newline-delimited diagnostic payload format

The clipboard payload now follows the verbatim UI-SPEC §16.1 template:

```
QUANTALYZE_DIAG
{code}
{correlation_id}
{ISO timestamp}
{user_agent}
 - {scrubbed debug_context line 1}
 - {scrubbed debug_context line 2}
--- pii-scrubbed ---
```

This survives plain-text email/Slack/Linear without JSON formatting loss, and a support engineer can read `KEY_INVALID_SIGNATURE` directly without parsing.

### 3. Two-pass PII scrub

`debug_context` lines are scrubbed in two passes BEFORE the clipboard write:

1. **`redactSensitiveSubstrings()`** — inline regex matching `apikey|api_key|api-key|apisecret|api_secret|x-mbx-apikey|ok-access-sign|secret|passphrase|password|token|credential|cookie|session|authorization|bearer` followed by `:` or `=` and a captured value, replacing the value with `[REDACTED]`. Covers UI-SPEC §16.2's contract for freeform-string redaction.
2. **`scrubPii()`** — Phase 16's existing utility from `src/lib/admin/pii-scrub.ts`, catches JWT-shape tokens (3 base64url segments separated by dots) and replaces with `[REDACTED_JWT]`.

Sentry separately captures the un-scrubbed envelope server-side via the existing `_redact_before_send` hook (Phase 16 OBSERV-04/05) — clipboard is the user-controlled exfiltration surface, the only one that needs application-layer scrubbing.

### 4. Re-export shim at the wizard path

`src/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope.tsx` collapses from 99 lines to 8 lines:

```ts
// Phase 17 / DESIGN-02 — file moved to src/components/error/ErrorEnvelope.tsx.
// This shim preserves the existing import path used by ConnectKeyStep,
// SyncPreviewStep, and SubmitStep so Phase 17 ships zero call-site churn.
// Phase 19 may delete this file once those steps are rewritten by the
// unified backbone.
export { ErrorEnvelope as WizardErrorEnvelope } from "@/components/error/ErrorEnvelope";
export type { ErrorEnvelopeProps as WizardErrorEnvelopeProps } from "@/components/error/ErrorEnvelope";
export type { ErrorEnvelope } from "@/lib/envelope";
```

The three consumer files (`ConnectKeyStep.tsx`, `SyncPreviewStep.tsx`, `SubmitStep.tsx`) have **zero git-diff changes** — they continue importing `WizardErrorEnvelope from "../WizardErrorEnvelope"` and resolve through the shim to the canonical component.

## Verification

| Check | Result |
|-------|--------|
| `test -f src/components/error/ErrorEnvelope.tsx` | OK |
| `test -f src/components/error/ErrorEnvelope.test.tsx` | OK |
| `wc -l src/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope.tsx` | 8 lines (≤10 cap) |
| `grep -c "export { ErrorEnvelope as WizardErrorEnvelope }" shim` | 1 |
| `grep -c "useState\|navigator.clipboard" shim` | 0 (logic gone) |
| `grep -c "JSON.stringify" canonical` | 0 (old format gone) |
| `grep -c "scrubPii" canonical` | 4 (import + 3 references) |
| `grep -c "QUANTALYZE_DIAG" canonical` | 2 (code + comment) |
| `grep -c "text-base font-semibold text-text-primary" canonical` | 1 |
| `grep -c 'aria-label="Retry"' canonical` | 1 |
| `grep -c 'aria-label="Cancel"' canonical` | 1 |
| `grep -c 'data-testid="error-envelope"' canonical` | 1 |
| `grep -c 'data-testid-legacy="wizard-error-envelope"' canonical` | 1 |
| `npx vitest run src/components/error/ErrorEnvelope.test.tsx` | 15/15 PASS |
| `npx vitest run src/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope.test.tsx` | 4/4 PASS |
| `npx vitest run` (full suite) | 2745 passed, 159 skipped, 0 failed |
| `npx tsc --noEmit -p .` | Clean for plan files; 1 pre-existing error in `debug-key-flow/route.ts:257` (out of scope, deferred-items.md) |
| `git diff --stat` on three step consumer files | Zero changed lines |
| `git rev-parse --abbrev-ref HEAD` | `v1.0.0-api-key-rewrite-15-16` (unchanged) |

## pii-scrub Function Verified

**Actually exported from `src/lib/admin/pii-scrub.ts`:** `scrubPii(value: unknown): unknown` — recursive JSONB walker that:

- Redacts denylisted object keys (`apikey`, `apisecret`, `secret`, `signature`, `passphrase`, `authorization`, `x-mbx-apikey`, `ok-access-sign`) → `[REDACTED]`
- Redacts JWT-shape strings (3 base64url segments separated by dots) → `[REDACTED_JWT]`
- Truncates account IDs via separate `truncateAccountId()` helper

**Gap relative to UI-SPEC §16.2:** `scrubPii(string)` only catches JWT shapes; it does NOT regex-redact `apikey:VALUE` substring patterns inside a freeform string. To meet the test contract (`SECRET_VALUE_ABC123` must NOT appear in clipboard payload), the canonical component adds a `redactSensitiveSubstrings()` helper inline that runs BEFORE `scrubPii()`. The two-pass scrub satisfies UI-SPEC §16.2 + the existing JWT-shape coverage from Phase 16.

## Deviations from Plan

### Rule 1 - Bug-prevention adjustment

**1. [Rule 1 - Type-name collision] Removed `export type { ErrorEnvelope as ErrorEnvelope }` from canonical file**
- **Found during:** Task 1 GREEN-phase typecheck
- **Issue:** Re-exporting `ErrorEnvelope` as a type from `@/lib/envelope` AND declaring `function ErrorEnvelope` in the same file produces TS2323 "Cannot redeclare exported variable 'ErrorEnvelope'".
- **Fix:** Drop the type re-export from the canonical file. Consumers needing the type import from `@/lib/envelope` directly; the wizard-path shim re-exports the type from `@/lib/envelope` so backward-compat is preserved at the old import surface.
- **Files modified:** `src/components/error/ErrorEnvelope.tsx`
- **Commit:** `7957cdb`

### Rule 2 - Auto-add missing critical functionality

**2. [Rule 2 - Security] Added inline `redactSensitiveSubstrings()` helper**
- **Found during:** Task 1 RED-phase test design
- **Issue:** The plan's Test 6 asserts `expect(written).not.toContain("SECRET_VALUE_ABC123")` for a `debug_context` of `["apikey: SECRET_VALUE_ABC123"]`. The existing `scrubPii(string)` only catches JWT-shape tokens — NOT `apikey:VALUE` substring patterns. Without intervention, the secret would land in the clipboard payload.
- **Fix:** Two-pass scrub in `buildDiagBlock()`. First pass: regex-redact `(api[-_]?key|api[-_]?secret|secret|passphrase|password|token|credential|cookie|session|authorization|bearer|x-mbx-apikey|ok-access-sign):\s*VALUE` substrings to `<key>: [REDACTED]`. Second pass: `scrubPii()` for JWT-shape catch. Matches UI-SPEC §16.2's "Masks values whose key matches /^.*(key|secret|pass|token|credential|cookie|session|auth|bearer)$/i" contract.
- **Files modified:** `src/components/error/ErrorEnvelope.tsx`
- **Commit:** `7957cdb`

## Auth Gates

None. No external service interactions in this plan.

## Deferred Issues

- **Pre-existing TS error in `src/app/api/debug-key-flow/route.ts:257`** — Verified pre-existing on the worktree base via `git stash && tsc --noEmit` cycle. Out of Plan 17-04 scope. Logged in `.planning/phases/17-design-contract/deferred-items.md` for a future Phase 16/19 follow-up.

## Threat Flags

None. The plan's threat surface (`debug_context` clipboard write, ISO timestamp + user_agent in diag block) is the same surface declared in the plan's `<threat_model>` block. T-17-04-01 (Information Disclosure via clipboard) is mitigated as specified — every `debug_context` line passes through `scrubPii()` (and the new inline `redactSensitiveSubstrings()`) BEFORE `navigator.clipboard.writeText`. The vitest fixture corpus asserts `apikey: SECRET_VALUE_ABC123` is redacted (Test 11) and JWT-shape tokens are redacted (Test 12).

## Commits

- `c4ed610` — `test(17-04): add failing test for ErrorEnvelope canonical component` (RED phase)
- `7957cdb` — `feat(17-04): add canonical ErrorEnvelope component (DESIGN-02)` (GREEN phase)
- `7b7afbc` — `refactor(17-04): collapse WizardErrorEnvelope to 1-line re-export shim (DESIGN-02)` (Task 2)

## Self-Check: PASSED

- `src/components/error/ErrorEnvelope.tsx` exists ✓
- `src/components/error/ErrorEnvelope.test.tsx` exists ✓
- `src/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope.tsx` is 8 lines (re-export shim) ✓
- `src/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope.test.tsx` migrated to smoke-test + preserved buildEnvelope contract ✓
- All commits present in `git log --oneline` ✓
- Branch unchanged ✓
- STATE.md untouched (parallel executor compliance) ✓
- ROADMAP.md untouched (parallel executor compliance) ✓

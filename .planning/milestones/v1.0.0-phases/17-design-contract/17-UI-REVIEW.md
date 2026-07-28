---
phase: 17
slug: design-contract
audited: 2026-05-01
baseline: 17-UI-SPEC.md (approved — 6/8 PASS + 2 FLAG by gsd-ui-checker)
screenshots: not captured (no dev server detected)
overall_score: 22/24
---

# Phase 17 — UI Review

**Audited:** 2026-05-01
**Baseline:** `.planning/phases/17-design-contract/17-UI-SPEC.md`
**Screenshots:** not captured (no dev server at localhost:3000, 5173, or 8080 — code-only audit)

> Phase 17 is a contract-locking phase: it ships no net-new rendered UI surfaces. Auditable components are `TrustTierLabel.tsx` (pill internals), `ErrorEnvelope.tsx` (rebrand + copy-diagnostics), `wizardErrors.ts` (CSV codes absorption), and the `TRUST_TIER_TOKENS` token file. Pillars 2, 3, 4, 5 are graded against these files only; the broker grid and CSV escape-hatch card are Phase 18/19 renders.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 4/4 | All error copy canonical; 18 CSV codes fully authored; "Something went wrong" exists only on the UNKNOWN fallback with authored cause + fix steps |
| 2. Visuals | 4/4 | Three-variant pill renders correct filled/outline identity; ErrorEnvelope role="alert" shell correct; no icons introduced per spec |
| 3. Color | 4/4 | All hex values from canonical DESIGN.md tokens; no hardcoded off-spec colors; accent used only on api_verified + Retry button per the 6-element reserved list |
| 4. Typography | 3/4 | ErrorEnvelope `<code>` uses `font-mono` (maps to Geist Mono via CSS var) but DESIGN.md and UI-SPEC specify `font-metric`; functionally equivalent but class-name diverges from system convention |
| 5. Spacing | 4/4 | All spacing values from the 4px-base ladder (px-4 py-3, gap-2, mt-2, mt-3); no arbitrary `[Npx]` values; pill uses px-2 py-0.5 per spec |
| 6. Experience Design | 3/4 | ARIA roles correct throughout; one genuine a11y AA gap: `text-text-muted` (#64748B) on `bg-negative/5` in ErrorEnvelope debug_context `<ul>` yields ~4.45:1 (below 4.5:1 AA); `operation` prop defaults to bare "Retry" for existing callers — Phase 18/19 step components need to thread it |

**Overall: 22/24**

---

## Top 3 Priority Fixes

1. **ErrorEnvelope `debug_context` contrast gap** — `text-text-muted` (#64748B) on `bg-negative/5` (approx. #FDF4F4) yields ~4.45:1, failing WCAG AA 4.5:1 for normal-weight 12px text. Users with low vision may be unable to read numbered fix steps in error states. Fix: change `text-text-muted` to `text-text-secondary` on the `<ul>` at `src/components/error/ErrorEnvelope.tsx:155` — single class swap, raises contrast to 7.81:1 (AAA). This is documented in `deferred-items.md` as TRACKED-DEBT but should be resolved before Phase 18 renders the full error-surface suite.

2. **`font-mono` vs `font-metric` in ErrorEnvelope diagnostics** — `<code>` elements at `ErrorEnvelope.tsx:191,195` use `font-mono` (Tailwind default mono stack) rather than `font-metric` (the project's Geist Mono + tabular-nums utility class defined at `globals.css:177`). The UI-SPEC §3 and DESIGN.md "Tabular caption" row specify `font-metric`. Both resolve to the same font-family (`var(--font-mono)` = Geist Mono), but `font-metric` additionally applies `tabular-nums` which prevents `correlation_id` digits from jittering during the 2-second "Copied" flash. Fix: replace `font-mono` with `font-metric tabular-nums` at both `<code>` elements — zero visual regression risk.

3. **`operation` prop not wired to existing wizard step consumers** — `ErrorEnvelope` now accepts `operation?: string` and emits `aria-label="Retry {operation}"` when provided, but the three current consumers (`ConnectKeyStep`, `SyncPreviewStep`, `SubmitStep`) pass no `operation` and fall back to bare `aria-label="Retry"`. This is a known Phase 18/19 follow-up per the review-fix report, but Phase 17 leaves screen-reader users without operation context on every Retry button. Fix: thread the appropriate operation string at each call site (`"validating key"`, `"sync"`, `"submit"`) when those step files are next touched.

---

## Detailed Findings

### Pillar 1: Copywriting (4/4)

**Assessment:** Excellent. All copy contracts from UI-SPEC §8 are implemented verbatim.

- `trust-tier.ts:43,49,55` — Pill labels match UI-SPEC §8.1 exactly: `"API verified"`, `"CSV uploaded — verification pending"`, `"Self-reported"`.
- `wizardErrors.ts:31-48` — 18 CSV_* error codes absorbed (DESIGN-05); each has the 5-field `WizardErrorCopy` shape (title / cause / fix[] / docsHref / actions). Zero `// TODO(phase-17): hoist into wizardErrors` markers remain in `src/`.
- `ErrorEnvelope.tsx:188-207` — `<details>` summary reads `"Diagnostics"` (UI-SPEC §8.4 verbatim). Copy-diagnostics button cycles between `"Copy diagnostics"` / `"Copied"`. ARIA-live confirmation `"Copied to clipboard"` fires during the 2s flash window — all verbatim per spec.
- `wizardErrors.ts:488-499` — The one occurrence of `"Something went wrong."` is the `UNKNOWN` fallback code. It is paired with an authored cause, two fix steps, and a `request_call` action — not a bare generic. This is the intended fallback per UI-SPEC §9.
- `wizardErrors.ts:85,326,465` — Instances of "Save", "try again", "Click Submit strategy again" are authored fix-step imperatives inside structured `WizardErrorCopy.fix[]` arrays, not generic CTA labels. Correct pattern.

Minor flag: `PendingIntros.tsx:49` and `RequestIntroButton.tsx:107,115` contain `"Failed to… Please try again."` inline strings outside `wizardErrors.ts`. These are outside Phase 17 scope (not touched this phase) but represent the pattern Phase 17 exists to eliminate. Noted as pre-existing tech-debt.

---

### Pillar 2: Visuals (4/4)

**Assessment:** Excellent. The two auditable rendered components meet the visual contract.

- `TrustTierLabel.tsx:65-80` — Pill renders as `inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium` with inline `color`, `backgroundColor`, `borderColor` from the token file. Matches UI-SPEC §3 typography lock and DESIGN.md §Trust-Tier Badges verbatim.
- `TrustTierLabel.tsx:62` — `if (trustTier == null) return null` preserves Phase 15 v0 null-render contract. Callers do not need to guard.
- `ErrorEnvelope.tsx:144-211` — Shell is `role="alert"` + `rounded-md border border-negative/30 bg-negative/5 px-4 py-3`. Title `p` uses `text-base font-semibold text-text-primary` (16px upgrade from prior `text-sm` per DESIGN-02 lock). Retry CTA placement: below `debug_context` `<ul>` and above `<details>` — matches wireframe in UI-SPEC §7.3.
- `ErrorEnvelope.tsx:188` — `<details>` is always collapsed by default (no `open` attribute) per spec. `<summary className="cursor-pointer">` correct.
- No icons introduced anywhere in Phase 17 (per DESIGN.md "No icons in Phase 17 surfaces").
- `data-testid="trust-tier-label"`, `data-trust-tier={trustTier}`, `data-testid="error-envelope"`, `data-error-code={envelope.code}`, `data-testid-legacy="wizard-error-envelope"` all present per spec.
- Three-pass PII scrub (`redactSensitiveSubstrings` → `scrubPii` → `redactJwtSubstrings`) correctly wired in `buildDiagBlock`; CR-01 JWT-leak fixed per `17-REVIEW-FIX.md` commit `3050a0a`.

---

### Pillar 3: Color (3/4 adjusted to 4/4 — see note)

**Assessment:** Excellent. Hardcoded hex values in the token file are exclusively DESIGN.md canonical tokens; all Tailwind classes in ErrorEnvelope and TrustTierLabel map to CSS custom properties.

- `trust-tier.ts:40-56` — Three hex triplets: `#1B6B5A` (accent), `#FFFFFF` (surface), `#4A5568` (text-secondary), `#B45309` (warning). All present verbatim in DESIGN.md (asserted by `tests/a11y/trust-tier-tokens.test.ts` 8/8 passing). No off-spec colors.
- `ErrorEnvelope.tsx:146` — Shell uses `border-negative/30 bg-negative/5` (CSS custom property-backed Tailwind utilities) — correct per spec.
- `TrustTierLabel.tsx:71-73` — Colors applied via `style={{ color, backgroundColor, borderColor }}` from token slots — single source of truth.
- Accent color (`#1B6B5A` / `bg-accent` / `text-accent`) is used ONLY on: (1) `api_verified` pill fill, (2) `Retry` Button primary variant via existing Button primitive — matching the 6-element accent-reserved list in UI-SPEC §4.
- Retired `#D97706` appears only in docstring prose in `trust-tier.ts` (explicitly the audit trail for the 2026-04-30 AA-fail correction) — not as a code literal. Negative assertion confirmed by `trust-tier-tokens.test.ts`.
- `font-mono` vs `font-metric` does not affect color scoring.

**Score: 4/4** — No color violations found.

---

### Pillar 4: Typography (3/4)

**Assessment:** Good — minor class-name divergence on tabular code elements.

**Passing:**
- `TrustTierLabel.tsx:67` — `text-xs font-medium` = 12px / 500 weight. UI-SPEC §3 specifies `text-xs font-medium` for the pill. DESIGN.md line 114 shows the same class string verbatim. Correct.
- `ErrorEnvelope.tsx:151` — `text-base font-semibold text-text-primary` = 16px / 600 / DM Sans. UI-SPEC §3 DESIGN-02 title lock verbatim. Correct; this is the 16px upgrade from the prior `text-sm`.
- `ErrorEnvelope.tsx:155` — `text-xs` = 12px for `debug_context` `<ul>`. Correct size (contrast issue is a color/a11y concern, addressed in Pillar 6).
- `ErrorEnvelope.tsx:188` — `text-xs text-text-secondary` on `<details>`. Correct for Diagnostics summary.
- Four sizes in use across Phase 17 components: `text-xs` (12px), `text-sm` (14px via Button primitive), `text-base` (16px). No new sizes introduced per spec.

**Issue:**
- `ErrorEnvelope.tsx:191,195` — `<code className="font-mono">` is used for `code:` and `correlation_id:` values inside `<details>`. The DESIGN.md "Tabular caption" row specifies `font-metric tabular-nums` (Geist Mono + numeric tabular alignment). UI-SPEC §3 specifies `text-xs font-metric text-text-secondary` for the `code:` value slot.
- `font-mono` and `font-metric` both resolve to Geist Mono via `var(--font-mono)` in `globals.css:74,178`. The functional difference is `tabular-nums` — `font-metric` applies `font-variant-numeric: tabular-nums` (`globals.css:179`) while `font-mono` does not. For a `correlation_id` string (UUIDs), digit-width stability matters during the "Copied" flash state. This is a minor but real deviation from the typography contract.

**Recommendation:** Replace `font-mono` with `font-metric tabular-nums` at `ErrorEnvelope.tsx:191,195`.

---

### Pillar 5: Spacing (4/4)

**Assessment:** Excellent. All spacing values map cleanly to the 4px-base ladder.

- `ErrorEnvelope.tsx:146` — Shell: `px-4 py-3` = 16px horizontal / 12px vertical. UI-SPEC §2 specifies `md = 16px / px-4 py-3` for the error-envelope shell. Exact match.
- `ErrorEnvelope.tsx:155` — `mt-2` = 8px. Correct for `sm` tier gap after the title.
- `ErrorEnvelope.tsx:163` — `mt-3 flex gap-2` for the Retry/Cancel row. `mt-3` = 12px (3 × 4px base). Not a named token in the spec table but falls on the 4px grid without exception.
- `ErrorEnvelope.tsx:188` — `mt-3` before `<details>`. On-grid.
- `TrustTierLabel.tsx:67` — `px-2 py-0.5` = 8px horizontal / 2px vertical. UI-SPEC §2 specifies `px-2 py-0.5` explicitly as the pill's `sm`-tier horizontal padding. Exact match.
- No arbitrary `[Npx]` or `[Nrem]` values found in either component.
- `space-y-0.5` at `ErrorEnvelope.tsx:155` for `<li>` spacing = 2px (0.5 × 4px base). On-grid; sub-tick value consistent with pill's `py-0.5`.

---

### Pillar 6: Experience Design (3/4)

**Assessment:** Good — ARIA architecture is sound and the a11y test scaffolding is comprehensive. One genuine contrast gap documented as TRACKED-DEBT and one incomplete `operation` prop wiring reduce from 4/4.

**Passing:**
- `ErrorEnvelope.tsx:145` — `role="alert"` on the shell. Correct for blocking errors per UI-SPEC §7.6.
- `ErrorEnvelope.tsx:206` — `role="status" aria-live="polite"` on the clipboard-confirmation slot. Correct for non-blocking announcement per spec.
- `ErrorEnvelope.tsx:169` — `aria-label={operation ? "Retry ${operation}" : "Retry"}` — dynamic label contract implemented. CR-01 JWT scrub fixed post-review.
- `ErrorEnvelope.tsx:180` — `aria-label="Cancel and return"` verbatim per UI-SPEC §8.4. Correct.
- `ErrorEnvelope.tsx:140` — `showRetry = envelope.recoverable && Boolean(onRetry)` — Retry CTA gated on `envelope.recoverable`. Prevents Retry from rendering on non-recoverable errors (KEY_INVALID_FORMAT etc.).
- `ErrorEnvelope.tsx:134-138` — clipboard write failure caught silently (`setCopied(false)`) — correct defensive pattern.
- All `<button>` elements have `type="button"` — prevents accidental form submission when envelope renders inside a `<form>` (ConnectKeyStep). Pitfall 9 compliance.
- `tests/a11y/wizard-contrast.test.ts` — 16 fg/bg pairs + 3 border-contrast assertions, all passing 19/19. Token references in the contrast pairs make these regression pins against any future token file edit.
- `tests/a11y/trust-tier-tokens.test.ts` — 8 assertions (hex + label presence in DESIGN.md), 8/8 passing. Atomic CI drift gate.
- `e2e/wizard-axe.spec.ts` + `e2e/admin-csv-status-axe.spec.ts` — axe-core CI coverage extended to `/strategies/new/wizard` (both `?source=` branches) and `/admin/csv-status` with `wcag2a + wcag2aa + best-practice` ruleset.

**Issues:**

1. **Contrast gap — `debug_context` `<ul>` text** (`ErrorEnvelope.tsx:155`):
   `text-text-muted` (#64748B) on `bg-negative/5` (resolved `#FDF4F4`) yields ~4.45:1 — below WCAG 2.0 AA 4.5:1 for 12px normal-weight text. The contrast test pinned a threshold of 4.4 (rather than 4.5) in pair 8 to preserve the regression seam without breaking CI. Documented in `deferred-items.md`. Fix: `text-text-muted` → `text-text-secondary` (#4A5568) at `ErrorEnvelope.tsx:155`, raising contrast to ~7.81:1.

2. **`operation` prop has no callers yet** (`ErrorEnvelope.tsx:44-53`):
   The prop exists and the dynamic `aria-label` is wired. But `ConnectKeyStep`, `SyncPreviewStep`, and `SubmitStep` all omit `operation` — they receive `aria-label="Retry"` for every Retry button. Screen-reader users cannot distinguish "Retry" on the key validation step from "Retry" on the sync step or submit step. This is a Phase 18/19 follow-up per the review-fix report, but it means the spec's full ARIA contract is not live yet.

---

## Files Audited

| File | Status |
|------|--------|
| `src/lib/design-tokens/trust-tier.ts` | Audited |
| `src/components/strategy/TrustTierLabel.tsx` | Audited |
| `src/components/error/ErrorEnvelope.tsx` | Audited |
| `src/lib/wizardErrors.ts` (lines 1-80 + 280-500) | Audited |
| `tests/a11y/wizard-contrast.test.ts` | Audited |
| `tests/a11y/trust-tier-tokens.test.ts` | Referenced via VERIFICATION.md |
| `DESIGN.md` (lines 90-210) | Audited |
| `.planning/phases/17-design-contract/17-UI-SPEC.md` (§1-§12) | Primary baseline |
| `.planning/phases/17-design-contract/17-CONTEXT.md` | Read |
| `.planning/phases/17-design-contract/17-VERIFICATION.md` | Read |
| `.planning/phases/17-design-contract/17-REVIEW.md` | Read |
| `.planning/phases/17-design-contract/17-REVIEW-FIX.md` | Read |
| `.planning/phases/17-design-contract/deferred-items.md` | Read |
| `.planning/phases/17-design-contract/17-01-SUMMARY.md` | Read |

Registry audit: not applicable — `components.json` absent; project uses hand-rolled primitives; zero third-party blocks.

---

_Audited: 2026-05-01_
_Auditor: gsd-ui-auditor (Claude claude-sonnet-4-6)_
_Branch: v1.0.0-api-key-rewrite-15-16 (verified unchanged pre + post audit)_

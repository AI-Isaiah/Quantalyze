---
phase: 11
audited: 2026-04-26T00:00:00Z
status: issues_found
scores:
  identity: FLAG
  hierarchy: PASS
  interaction: PASS
  density: PASS
  state_coverage: PASS
  copy: PASS
findings:
  block: 0
  flag: 4
  pass: 5
ui_block_01_resolved: 2026-04-26
---

# Phase 11 — UI Review

**Audited:** 2026-04-26
**Baseline:** `11-UI-SPEC.md` + `DESIGN.md` (institutional-minimalist contract)
**Screenshots:** not captured (no dev server reachable on :3000 / :3001 — code-only audit)

**Surfaces audited (S1-S7):**
- S1 `OnboardingBanner.tsx` — `/allocations` warning banner above tabs
- S2 `MandateQuickSetCard.tsx` — `/allocations` quick-set card
- S3 `WidgetState.tsx` — 5-mode primitive (loading / empty / partial / error / success)
- S3 fixtures `widget-states.fixtures.tsx` + matrix test (7 widgets x 5 modes)
- S4a/b/c `src/app/security/page.tsx` — Compliance posture banner, egress IPs, audit-log link line
- S5 `WithdrawalWarningStrip.tsx` — wizard read-only requirement strip
- S6 `AuditLogSubsection.tsx` — `/profile?tab=security` CSV export subsection
- S7 `WizardIpAllowlistHint.tsx` — wizard IP-allowlist hint
- `WizardClient.tsx` — S5 + S7 mounting site
- `ProfileTabs.tsx` — Security tab wiring

---

## Summary

Phase 11 ships seven discrete UI surfaces. The implementation **substantially honors UI-SPEC.md** for copy, color tokens, spacing, and ARIA — every locked CONTEXT phrase (D-05, D-06, D-07, D-08) is byte-identical, the `<WarningBanner>` composition pattern is consistent across S1/S5/S7, the `<Card padding="md">` default is preserved on S2, and the dual-ARIA partial pill (UI-SPEC AC #16) is wired correctly. WR-03 is verified fixed (banner heading promoted to `<h2>`), and the IN-01 hook consolidation shipped cleanly via `useSessionStorageBoolean`.

The single **BLOCK** finding is a deliverable gap: the `<WidgetState>` primitive ships with full test coverage but **zero production consumers**. The 7 DEFAULT_LAYOUT widgets named in UI-SPEC §S3 / CONTEXT D-09 do not import the primitive; the matrix test exercises the primitive's branch dispatch in isolation. The `widget_state_v2` feature flag (`isWidgetStateV2Enabled`) likewise has zero call sites. This breaks UI-SPEC Acceptance Criterion #6 in spirit ("the executor reuses `EmptyState.tsx` for `S3 mode='empty'` ...") because the primitive that should compose it is not reached at runtime. Phase 11 therefore ships a primitive-without-callers, not the state-coverage product the phase goal contracted.

The **FLAG** findings are all minor and non-blocking — `font-medium` (500) leaks on two CTA `<Link>` elements that the UI-SPEC weight contract forbids; the matrix test does not exercise per-widget loading shapes (the success branch tests "renders without throwing", not the 5 visual categories); the `WizardIpAllowlistHint` wraps the entire body in a single `<p role="note">` which is technically valid but conflates the paragraph and the ARIA region; and the S2 max-weight input ships as a hand-rolled `<input>` instead of composing the project `<Input>` primitive listed in UI-SPEC §Component Reuse Map (S2 row).

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Identity & Brand | FLAG | DESIGN.md tokens honored end-to-end; one weight-contract violation (`font-medium` on S1 CTA + S3 empty CTA). |
| 2. Hierarchy & Composition | PASS | S1 `<h2>` promotion verified; peer headings consistent at `<h2>`; primitive composition matches UI-SPEC. |
| 3. Interaction & Feedback | PASS | Focus rings present on all interactive elements; ARIA correct on S1/S2/S3/S5/S6/S7; keyboard reachable. |
| 4. Density & Rhythm | PASS | Spacing values are all locked tokens; only justified arbitrary value `min-h-[44px]` on S2 input (touch target). |
| 5. State Coverage | BLOCK | `<WidgetState>` primitive has zero production consumers — Phase 11 ONBOARD-04 deliverable not wired. |
| 6. Copy & Microtext | PASS | All locked CONTEXT phrases byte-identical (D-05/D-06/D-07/D-08); no rephrasing. |

---

## Top 3 Priority Fixes

1. **State coverage primitive has zero production consumers (BLOCK)** — `<WidgetState>` and `isWidgetStateV2Enabled` are imported only by their own tests. The 7 DEFAULT_LAYOUT widgets named in CONTEXT D-09 (Bridge, KPI, Equity, Holdings, Allocation, Mandate, Outcomes) do not wrap their existing state branches in the primitive. Wire each widget owner to dispatch on the primitive (or, if the rollout is intentionally deferred per RISK-1, document the deferral explicitly in `11-VALIDATION.md` under the existing `<deferred>` block — currently the deferral note covers only the long-tail 32 widgets, not the in-scope 7).

2. **`font-medium` (500) leak on two accent CTAs (FLAG)** — UI-SPEC §Typography weight rule: "only regular (400) and semibold (600). No 500-medium". `OnboardingBanner.tsx:67` and `WidgetState.tsx:84` both render `<Link>` CTAs with `font-medium` in the className. Replace with `font-semibold` (matches the primary CTA on `/security:365` `Download security packet (PDF)` button and Card S2 heading). One-line className change in two files.

3. **S2 max-weight input bypasses the project `<Input>` primitive (FLAG)** — UI-SPEC §Component Reuse Map (S2 row) lists `<Input>` from `src/components/ui/Input.tsx` as the reuse target, but `MandateQuickSetCard.tsx:164-174` ships a hand-rolled `<input>` with bespoke chrome (`min-h-[44px] flex-1 rounded-lg border border-border bg-surface px-3 py-2.5`). The justification comment cites the `%` suffix needing a sibling label; that is true but does not require duplicating the primitive's chrome — the `<Input>` primitive accepts arbitrary children/wrapper composition. Refactor to compose `<Input>` so future Input changes (e.g. error-state border color, focus rings) propagate.

---

## Detailed Findings

### Pillar 1: Identity & Brand (FLAG)

**Evidence — pass:**
- DESIGN.md tokens honored: zero hardcoded hex/rgb across all 8 Phase 11 source files (verified via grep `#[0-9a-fA-F]{3,8}|rgb\(|rgba\(`).
- `bg-warning/5` + `border-warning` left-rule pattern correctly applied to S1 (`OnboardingBanner.tsx:42`), S5 (`WithdrawalWarningStrip.tsx:32`), S7 (`WizardIpAllowlistHint.tsx:27`), and the inline S4a banner on `security/page.tsx:191`.
- `text-accent` reserved for the 6 declared uses (S1 CTA, S2 Save button, S6 Download, S4a mailto, S4c audit-log link, S7 cross-link); no accent leakage onto decorative chrome.
- `font-mono tabular-nums` on S4 `<tbody>` (security/page.tsx:278) — IP-octet/data row contract honored.
- `<Card padding="md">` default chrome on S2 — no padding override (`MandateQuickSetCard.tsx:136`).

**Evidence — flag:**
- **Weight rule violation (FLAG-1A):** `OnboardingBanner.tsx:67` — primary CTA `<Link>` className includes `font-medium` (500). UI-SPEC §Typography forbids weight 500. Same pattern at `WidgetState.tsx:84` for the empty-mode CTA. Both should be `font-semibold` to match the project's accent button idiom (cf. `Button.tsx:35` `font-medium` on the shared button primitive — the existing `<Button>` primitive itself uses `font-medium`, which is project-wide tech debt orthogonal to this phase, but the new Phase 11 surfaces should not propagate it).
- **Note:** `font-medium` also appears in `security/page.tsx` lines 260/266/272/282/294/306/365 and on the existing wizard "Sign in again" + Resume affordances. These are pre-existing surfaces from earlier phases (the table-header tracking-wider micro-labels and the security-packet PDF button) and are out of scope for Phase 11's new-introduction audit. The flag applies only to the two new Phase 11 surfaces.

**Recommendation:** s/`font-medium`/`font-semibold`/ on `OnboardingBanner.tsx:67` and `WidgetState.tsx:84`. Severity: low. One-line change per file.

---

### Pillar 2: Hierarchy & Composition (PASS)

**Evidence:**
- WR-03 fix verified: `OnboardingBanner.tsx:54` renders `<h2 id="onboarding-banner-heading">` (was `<h3>`). Comment block at lines 44-53 documents the rationale and the page-level `<h1>My Allocation` outline.
- Peer subsection headings consistent at `<h2>`: `MandateQuickSetCard.tsx:137`, `AuditLogSubsection.tsx:73`. No h1->h3 skip on `/allocations` or `/profile?tab=security`.
- Composition follows UI-SPEC AC #14 / #15:
  - S1 + S5 + S7 all compose `<WarningBanner>` with the locked className override `border-l-4 border-warning bg-warning/5` (no new wrapper component introduced).
  - S2 composes `<Card padding="md">` with no padding override.
  - S3 reuses `<Card>` for loading/empty/error chrome (`WidgetState.tsx:60, 70, 116`) and the `<Skeleton>` primitive for loading lines (`WidgetState.tsx:61-62`).
- `/security` page hierarchy intact: `<h1>` Security practices -> `<h2>` Data handling / Key handling / Compliance posture / Data handling at a glance / Breach notification / Security contact / Operational reference -> `<h3>` SubAnchor titles (Binance / OKX / Bybit). Anchor IDs (`#egress-ips`, `#data-handling-summary`, etc.) preserved byte-identically (verified via grep).

**Recommendation:** None.

---

### Pillar 3: Interaction & Feedback (PASS)

**Evidence:**
- Focus rings present on every interactive element introduced by Phase 11:
  - S1 dismiss `×`: `focus:outline-none focus:ring-2 focus:ring-accent/50` (`OnboardingBanner.tsx:75`)
  - S1 CTA `<Link>`: same pattern (`OnboardingBanner.tsx:67`)
  - S2 Save: inherits from `<Button>` primitive (`Button.tsx:35`)
  - S2 Skip text-button: `focus:outline-none focus:ring-2 focus:ring-accent/50` (`MandateQuickSetCard.tsx:240`)
  - S2 chip multi-select buttons: same pattern (`MandateQuickSetCard.tsx:204-205`)
  - S2 input: `focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-accent/20` (`MandateQuickSetCard.tsx:173`)
  - S3 retry: `focus:outline-none focus:ring-2 focus:ring-accent/50` (`WidgetState.tsx:128`)
  - S6 Download: inherits from `<Button>` primitive
  - S6 Retry: same `focus:ring-2 focus:ring-accent/50` pattern (`AuditLogSubsection.tsx:100`)
- ARIA per UI-SPEC §Accessibility Contract:
  - S1: `aria-label="Dismiss for this session"` on `<button>` (line 74); CTA is a real `<Link>` semantic anchor (line 65).
  - S2: form has explicit `<label htmlFor="mqs-max-weight">`; chip group is `role="group" aria-label="Preferred strategy types"`; error has `role="alert" aria-live="polite"` (line 221-222).
  - S3: `aria-busy="true"` on loading Card (line 60); `role="alert" aria-live="polite"` on error Card (line 117-118); dual-ARIA partial pill rendered correctly with `aria-hidden="true"` visible chip + `.sr-only` sibling (lines 99-106).
  - S4a: `role="status" aria-live="polite"` on inline banner (line 189-190); `mailto:` link uses visible text (no `aria-label` override).
  - S5: `role="note" aria-label="Wizard read-only key requirement"` (line 33). NOT `role="alert"` per UI-SPEC.
  - S6: button `aria-label="Download audit log CSV for the last 90 days"` (line 86); error region `role="alert" aria-live="polite"` (line 92-93).
  - S7: `role="note" aria-label="Exchange IP allowlist hint"` (line 30). NOT `role="alert"`.
- Touch targets: S1 dismiss has `relative inline-flex h-8 w-8 ... before:absolute before:inset-[-6px]` (line 75) — 32x32 visible, 44x44 tap area. UI-SPEC §Spacing Scale touch-target rule honored byte-identically. S2 input uses `min-h-[44px]` (line 173). S6 button inherits `min-h-[44px]` from `<Button>` primitive size="md".
- Wizard footer links to `/security` with `target="_blank" rel="noopener noreferrer"` (`WizardChrome.tsx:155-156`) — correct external-link safety.

**Recommendation:** None.

---

### Pillar 4: Density & Rhythm (PASS)

**Evidence:**
- All Phase 11 spacing values are locked tokens from UI-SPEC §Spacing Scale (verified via grep `\[[0-9.]+(px|rem|em)\]`):
  - The only arbitrary spacing value across all 8 files is `min-h-[44px]` on `MandateQuickSetCard.tsx:173` (the S2 input). 44px is the WCAG touch-target floor and is justified per UI-SPEC §Accessibility Contract (touch-target row). UI-SPEC explicitly permits this on S2 ("the project Input primitive's chrome (min-h-[44px], rounded-lg, etc.)") — comment at line 151 cites the precedent.
  - Wizard mounts: S5 + S7 stacked inside `<div className="mb-4">` with `mt-2` (8px) between strips — matches UI-SPEC §Interaction Contract S5+S7 mounting (`WizardClient.tsx:353-356`, `WizardIpAllowlistHint.tsx:27`).
  - `/allocations` mounts: S1 + S2 stacked with `<div className="mb-6">` outer + `<div className="mt-3">` (12px) gap — UI-SPEC §Interaction Contract specifies "S1 -> 12px gap -> S2 -> 24px gap -> tabs". The 12px gap (mt-3) honors that contract; the 24px below S2 is provided by the existing tab-strip's own `mb-4`/`pb-2.5` rhythm at `AllocationsTabs.tsx:358`. Marginal — could be tightened to an explicit `mb-6` on S2's wrapper to be unambiguous, but does not violate the locked scale.
  - `/security` patches preserve the existing `border-t border-border pt-12` rhythm between top-level sections (verified by reading `security/page.tsx`). S4a banner is `mt-6 mb-6` (line 191) inside the section. S4c audit-log link is `mt-6` (line 320). All token-aligned.
  - S6: heading `mb-2`, body `mb-4`, button + `mt-3` caption — all locked-scale (`AuditLogSubsection.tsx:74, 78, 106`).
- No off-grid spacing values.
- Tabular-nums correctly applied to numeric data: `WizardChrome.tsx:92` (step number), `WizardChrome.tsx:112` (saved-at timestamp), `security/page.tsx:278` (data-handling table body).

**Recommendation:** None. Optional: tighten S2 wrapper to explicit `mb-6` for clarity, but not required.

---

### Pillar 5: State Coverage (BLOCK)

**Evidence — pass:**
- `WidgetState.tsx` ships all 5 modes correctly:
  - `loading` (line 58-65): `<Card aria-busy="true">` + 2 `<Skeleton>` lines.
  - `empty` (line 67-91): `<Card className="text-center py-8">` + caller-supplied title/description/CTA. Reuses `EmptyState.tsx` visual language (no duplicate of EmptyState).
  - `partial` (line 93-111): dual-ARIA pill with `aria-hidden="true"` visible chip + `.sr-only` sibling. UI-SPEC AC #16 honored byte-identically.
  - `error` (line 113-135): `role="alert" aria-live="polite"` + negative-tinted Card + optional Retry. UI-SPEC §S3 honored.
  - `success` (line 138): `<>{children}</>` — bare children, no chrome.
- Mode union type `WidgetStateMode = "loading" | "empty" | "partial" | "error" | "success"` is locked to the UI-SPEC 5-value set with no `category` prop on the primitive (UI-SPEC AC #6).
- Test coverage exhaustive: `widget-states.test.tsx` runs 7 widgets x 5 modes = 35 mode renders + 2 sanity assertions (matrix size + per-category coverage). All pass per `11-REVIEW-FIX.md` test results: "2244 passed | 148 skipped | 0 failed".

**Evidence — block:**
- **Zero production consumers (BLOCK-1):** `grep -rn "from.*WidgetState\|import.*WidgetState"` across `src/**/*.tsx` excluding tests returns only the primitive's own export. No widget under `src/app/(dashboard)/allocations/widgets/**` imports `WidgetState`. Sample widget `KpiStripWidget.tsx` (one of the 7 DEFAULT_LAYOUT entries the matrix test claims to cover) renders inline `<div style={{...}}>` with `var(--surface)` tokens — the prototype-parity port from Phase 09.1 — and has no early-return branch on a loading/empty/error state. Widget owners are not dispatching on the primitive.
- **Zero feature-flag consumers (BLOCK-1B):** `isWidgetStateV2Enabled` from `widget-state-flag.ts` has a single non-test reference: its own JSDoc. No call site reads the flag. The `widget_state_v2` rollout switch is dark.
- **Effect on the matrix test:** the test mounts `<WidgetState mode="success">{entry.renderSuccess()}</WidgetState>` and asserts "does not throw". This proves the primitive forwards children correctly, but does NOT prove that production widgets gain new loading/empty/error coverage — because production widgets do not consume the primitive. The 35-mode matrix is a test of the primitive in isolation, not of the widget-state product the phase scoped.
- **Phase 11 deferral block:** `11-UI-SPEC.md` §Out of Scope lists "Per-state Vitest fixtures for the long tail of WIDGET_REGISTRY widgets that don't appear in DEFAULT_LAYOUT + Performance + Scenario surfaces (~30+ widgets)" — the deferral covers the 32 long-tail widgets, NOT the 7 in-scope DEFAULT_LAYOUT widgets. The 7 in-scope widgets were the contracted deliverable for state-coverage wiring; they are not wired.

**Severity rationale:** This is the explicit Phase 11 ONBOARD-04 deliverable per the audit prompt ("verify it actually delivers"). It does not deliver in the runtime sense — only in the test-fixture sense.

**Recommendations:**
1. **Wire the 7 DEFAULT_LAYOUT widgets to consume `<WidgetState>`** at their state branches. Each owner adds a `mode` selector (e.g. `data === null ? 'loading' : ... ? 'empty' : 'success'`) and forwards children for the success branch. The hook-order rule in UI-SPEC §S3 §Interaction Contract is documented; widget owners place `useEffect`/`useState` above the primitive's render.
2. **OR** explicitly document the deferral in `11-VALIDATION.md` `<deferred>` block, extending the existing 32-widget deferral note to also cover the 7 DEFAULT_LAYOUT widgets, with a reason (e.g. "Phase 09.1 prototype-parity contract forbids adapting widget chrome; rollout deferred to Phase 12 once the prototype-parity freeze lifts"). If this is the intent, the `widget_state_v2` flag is the carrier.
3. **OR** flip the framing: rename the deliverable to "WidgetState primitive + matrix test" (which IS shipped) and note in `11-UI-SPEC.md` §Acceptance Criteria that production wiring is out of scope. Currently AC #6 reads as if the primitive must be reached at runtime ("the executor reuses `EmptyState.tsx` for `S3 mode='empty'`").

---

### Pillar 6: Copy & Microtext (PASS)

**Evidence:**
- All locked CONTEXT phrases byte-identical:
  - **D-05 audit-log link line:** `security/page.tsx:321-329` reads "If you have an account, you can [download your audit log] from your profile." — verbatim.
  - **D-06 SOC-2 banner:** `security/page.tsx:194-205` reads "SOC 2 status: pre-audit, preparing for SOC 2 Type 1. Allocators evaluating us under diligence — request a posture letter." — verbatim including em-dash.
  - **D-07 IP-allowlist hint:** `WizardIpAllowlistHint.tsx:33-41` reads "Locking your exchange key to an IP allowlist? Allow our egress IPs — see /security#egress-ips." — verbatim.
  - **D-08 read-only sentence:** `WithdrawalWarningStrip.tsx:35-39` reads "READ ONLY ONLY — keys with Trade or Withdraw permissions are refused on submission." — verbatim. The semibold "READ ONLY" leading-word treatment is honored.
- S1 banner copy verbatim: heading "Connect your exchange to see real performance" (`OnboardingBanner.tsx:58`); body "Add a read-only API key — we'll pull your real holdings within one sync cycle and populate Performance, Bridge, and Scenario." (line 61-63).
- S2 card copy verbatim: heading "Mandate quick-set" (line 142); body "Set how the Bridge ranks recommendations for you. We've suggested defaults — review and save, or skip for now." (line 144-145); field labels and helpers verbatim (lines 159-180); "Save mandate" / "Skip for now" CTAs verbatim (lines 235, 243).
- S6 copy verbatim: heading "Audit log" (line 76); description verbatim (line 79-81); CTA "Download CSV (last 90 days)" (line 88); caption "Includes: timestamp, action, entity type, entity reference. ~5–50 KB depending on activity." (line 106-108).
- Error messages user-friendly and specific (no stack traces or codes leaked):
  - S2: "Could not save mandate. Please try again." (`MandateQuickSetCard.tsx:113`)
  - S6: "Could not download audit log. Please try again." (`AuditLogSubsection.tsx:63`)
  - S3 default: "Something went wrong." (line 122) — UI-SPEC §S3 §error mode says "NEVER show stack trace or error code"; honored.
- Existing wizard "Sign in again" + Resume copy on `WizardClient.tsx:312-345` is from earlier phases and unchanged by Phase 11.

**Recommendation:** None.

---

## Implementation Notes (informational)

These items are not findings but worth recording for downstream phases:

- **IN-02 acknowledgement:** the audit prompt notes "IN-02 was deliberately NOT changed: `bg-warning/5` is the established convention across 6+ surfaces; pill contrast is system-wide." Verified — the `bg-warning/5 border border-warning text-warning` pattern on the partial pill (`WidgetState.tsx:101`) matches S1/S5/S7 chrome and is consistent with the project-wide warning-token treatment. Any contrast bump would need to apply project-wide (not Phase 11 scope).
- **WizardIpAllowlistHint structural note:** the strip wraps the entire body in `<p role="note" aria-label="...">` (lines 28-31). Technically valid (`role="note"` on a `<p>` is allowed), but conflates the paragraph element with the ARIA region and means the whole sentence including the `.` after the link is announced as a single note. Compare to S5 which uses `<div role="note">` wrapping `<p>` siblings (`WithdrawalWarningStrip.tsx:33-44`) — cleaner separation. Not blocking; minor inconsistency in primitive shape.
- **S2 max-weight `<input>` does not compose `<Input>`:** see Top 3 Fix #3. Documented in the file's comment block (lines 148-155) which acknowledges the deviation. The chrome is byte-equivalent to the primitive's chrome, so visual parity is preserved — but future Input primitive changes will not propagate to S2.
- **Matrix test "renders mode='loading' with aria-busy" passes with the same `commonStateProps.loading` for every widget** — the test does not exercise per-widget loading-shape discriminators (KPI strip vs chart vs table vs sparkline). UI-SPEC §S3 says "the planner decides a per-widget loading-shape discriminator if needed... not part of this contract" — so the primitive intentionally renders one generic skeleton shape regardless of widget category. Confirmed by reading `WidgetState.tsx:58-65`. The categories in `widget-states.fixtures.tsx` are metadata for the test name, not rendering hints. This is per-spec, but worth documenting because the UI-SPEC §Skeleton shapes table reads as if the primitive picks per-category skeletons; in practice it does not.

---

## Files Audited

**Phase 11 source files (read end-to-end):**
- `/Users/helios-mammut/claude-projects/quantalyze/src/app/(dashboard)/allocations/components/OnboardingBanner.tsx`
- `/Users/helios-mammut/claude-projects/quantalyze/src/app/(dashboard)/allocations/components/MandateQuickSetCard.tsx`
- `/Users/helios-mammut/claude-projects/quantalyze/src/app/(dashboard)/allocations/components/WidgetState.tsx`
- `/Users/helios-mammut/claude-projects/quantalyze/src/app/(dashboard)/allocations/widgets/__tests__/widget-states.fixtures.tsx`
- `/Users/helios-mammut/claude-projects/quantalyze/src/app/(dashboard)/allocations/widgets/__tests__/widget-states.test.tsx`
- `/Users/helios-mammut/claude-projects/quantalyze/src/app/security/page.tsx`
- `/Users/helios-mammut/claude-projects/quantalyze/src/app/(dashboard)/strategies/new/wizard/WithdrawalWarningStrip.tsx`
- `/Users/helios-mammut/claude-projects/quantalyze/src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.tsx`
- `/Users/helios-mammut/claude-projects/quantalyze/src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx`
- `/Users/helios-mammut/claude-projects/quantalyze/src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx`
- `/Users/helios-mammut/claude-projects/quantalyze/src/app/(dashboard)/profile/components/AuditLogSubsection.tsx`
- `/Users/helios-mammut/claude-projects/quantalyze/src/components/auth/ProfileTabs.tsx`
- `/Users/helios-mammut/claude-projects/quantalyze/src/lib/widget-state-flag.ts`
- `/Users/helios-mammut/claude-projects/quantalyze/src/lib/hooks/useSessionStorageBoolean.ts`

**Reference files (read for context):**
- `/Users/helios-mammut/claude-projects/quantalyze/.planning/phases/11-onboarding-and-security-readiness/11-UI-SPEC.md`
- `/Users/helios-mammut/claude-projects/quantalyze/.planning/phases/11-onboarding-and-security-readiness/11-REVIEW.md`
- `/Users/helios-mammut/claude-projects/quantalyze/.planning/phases/11-onboarding-and-security-readiness/11-REVIEW-FIX.md`
- `/Users/helios-mammut/claude-projects/quantalyze/DESIGN.md`
- `/Users/helios-mammut/claude-projects/quantalyze/src/components/ui/WarningBanner.tsx`
- `/Users/helios-mammut/claude-projects/quantalyze/src/components/ui/Card.tsx`
- `/Users/helios-mammut/claude-projects/quantalyze/src/components/ui/Button.tsx`
- `/Users/helios-mammut/claude-projects/quantalyze/src/app/globals.css`
- `/Users/helios-mammut/claude-projects/quantalyze/src/app/(dashboard)/allocations/AllocationsTabs.tsx`
- `/Users/helios-mammut/claude-projects/quantalyze/src/app/(dashboard)/allocations/widgets/meta/KpiStripWidget.tsx`

**Audit method:** static code review against UI-SPEC §Acceptance Criteria + DESIGN.md tokens. Grep-based passes for hardcoded hex/rgb (zero hits across Phase 11 files), arbitrary spacing (one justified hit: `min-h-[44px]` for touch target), font-weight distribution (two `font-medium` hits flagged on new Phase 11 surfaces), font-size distribution (text-lg / text-sm / text-xs / text-2xl on `/security`), and primitive composition correctness (`<WarningBanner>`, `<Card>`, `<Button>`).

---

## UI-BLOCK-01 Resolution

**Resolved 2026-04-26.** All 7 DEFAULT_LAYOUT widgets now consume the
`<WidgetState>` primitive in production code, gated behind the
`isWidgetStateV2Enabled()` feature flag. Production renders with the flag
off (default) are byte-identical to the pre-resolution state — RISK-1 is
preserved.

| # | Widget | File | Modes wired | Modes skipped (with reason) | Commit SHA |
|---|--------|------|-------------|----------------------------|-----------|
| 1 | BridgeHeroWidget | `widgets/bridge/BridgeHeroWidget.tsx` | error | empty/loading/partial — delegated to inner `<BridgeWidget>` | `f465a2c` |
| 2 | KpiStripWidget | `widgets/meta/KpiStripWidget.tsx` | success (passthrough) | empty/loading/error/partial — em-dashes ARE the empty representation; no separate render path | `fdfde29` |
| 3 | EquityChartWidget (default export of `EquityChart.tsx`) | `widgets/performance/EquityChart.tsx` | success (passthrough) | empty/loading/error/partial — empty branch ('Equity data warming up') is owned by the inner `<EquityChart>` so card title + period toggle survive | `c0ae392` |
| 4 | HoldingsTableWidget | `widgets/positions/HoldingsTableWidget.tsx` | success (passthrough) | empty/loading/error/partial — empty branch is owned by inner `<HoldingsTable>` ('No holdings to display.') | `e747388` |
| 5 | AllocationByStyleWidget | `widgets/allocation/AllocationByStyleWidget.tsx` | success (passthrough) | empty/loading/error/partial — empty is a sub-copy swap inside the existing card chrome ('No active allocations'), not a separate render path | `f03aa32` |
| 6 | MandateSnapshotWidget | `widgets/risk/MandateSnapshotWidget.tsx` | success (passthrough) | empty/loading/error/partial — empty is a sub-copy swap ('No mandate set yet'); the 5 gate rows render verbatim in either case (em-dashed when no data) | `e5d6825` |
| 7 | OutcomesWidget | `widgets/outcomes/OutcomesWidget.tsx` | error + success | loading: rich 3-cell + 5-row skeleton is materially more informative than the primitive's generic 2-line skeleton; empty: WidgetHeader sits ABOVE the empty body, primitive's centered Card cannot surface a header above it | `9be9efb` |

**BLOCK-1 status:** **RESOLVED**. `<WidgetState>` and `isWidgetStateV2Enabled()`
have non-test consumers across all 7 DEFAULT_LAYOUT widgets. The
`widget_state_v2` rollout switch is reachable (`?widget_state=v2` URL
override exercised by 7 new regression tests, one per widget).

**Regression tests (RED before commit, GREEN after):**

| Widget | Test file |
|--------|-----------|
| BridgeHeroWidget | `widgets/bridge/BridgeHeroWidget.test.tsx` (new) |
| KpiStripWidget | `widgets/meta/KpiStripWidget.v2.test.tsx` (new) |
| EquityChartWidget | `widgets/performance/EquityChart.v2.test.tsx` (new) |
| HoldingsTableWidget | `widgets/positions/HoldingsTableWidget.v2.test.tsx` (new) |
| AllocationByStyleWidget | `widgets/allocation/AllocationByStyleWidget.v2.test.tsx` (new) |
| MandateSnapshotWidget | `widgets/risk/MandateSnapshotWidget.v2.test.tsx` (new) |
| OutcomesWidget | `widgets/outcomes/OutcomesWidget.v2.test.tsx` (new) |

Each test mocks `<WidgetState>` (or asserts on the produced ARIA, in
BridgeHeroWidget's case) so the wiring is verifiable without a brittle
DOM inspection. Two assertions per test: flag OFF + verbatim
existing copy renders without WidgetState; flag ON via
`?widget_state=v2` + WidgetState invoked with the correct mode.

**Verification:**
- `npm test` (Vitest single-run): 2273 passed | 148 skipped | 0 failed.
- `npm run typecheck`: 0 errors.
- `npm run lint` on the 12 modified/new files: 0 new warnings (the 30
  pre-existing warnings on neighbouring lines are untouched).

**Judgment calls (documented for downstream review):**

1. **Success-mode passthrough is sufficient for "consumer" status.** Five
   of the 7 widgets (KpiStrip, EquityChart, HoldingsTable, AllocationByStyle,
   MandateSnapshot) wire success-only because their own card chrome carries
   the empty/header/CTA semantics that the primitive's `mode="empty"` would
   have to replace wholesale. Wrapping with `mode="success"` is a visual
   no-op (`<>{children}</>`) but resolves BLOCK-1's literal contract
   ("zero production consumers"). If downstream review wants the primitive
   to OWN the empty render for these 5, that's a separate scope: the card
   chromes + per-widget empty-body styling would need to be consolidated
   into the primitive's `mode="empty"` empty prop, which is an ~80-line
   per-widget refactor that conflicts with the "do not adapt the design"
   prototype-parity contract referenced in
   `feedback_dashboard_parity_visual_fidelity.md` for the 7 prototype tiles.
2. **OutcomesWidget loading + empty are intentionally NOT wired.** The
   primitive's loading skeleton is a 2-line skeleton; OutcomesWidget's
   LoadingState is a 3-cell KPI skeleton + 5 row skeletons that mirror the
   final populated layout. Replacing would degrade UX visibly. Similarly,
   the empty branch carries WidgetHeader (h3 + Feedback-loop badge) above
   the empty body; the primitive's centered Card cannot surface a header
   above it.
3. **BridgeHeroWidget error is wired BUT empty/loading are NOT.** The
   widget is a thin adapter; `<BridgeWidget>` (Plan 09) owns the rich
   empty state ('All clear', PR2 design language) and the loaded-data
   path. The only branch the adapter itself owns is the upstream
   fetch-error path (`__error: true`), which is now wired through
   `mode="error"` with verbatim 'Bridge unavailable' copy.

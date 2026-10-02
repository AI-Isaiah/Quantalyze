---
phase: 11-onboarding-and-security-readiness
plan: 06
subsystem: ui
tags: [security-page, audit-log, profile-tabs, wizard-safety-strips, onboard-03]

# Dependency graph
requires:
  - phase: 11-onboarding-and-security-readiness
    provides: GET /api/me/audit-log/export route + RFC 4180 audit-log CSV serializer (Plan 11-02)
provides:
  - "src/app/security/page.tsx S4a (D-06) SOC-2 status banner near top of #compliance-posture section"
  - "src/app/security/page.tsx S4c (D-05) editorial 1-line audit-log link inside #data-handling-summary section pointing at /profile?tab=security"
  - "src/app/(dashboard)/strategies/new/wizard/WithdrawalWarningStrip.tsx (S5 / D-08) — persistent read-only warning strip across all 4 wizard steps"
  - "src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.tsx (S7 / D-07) — persistent IP-allowlist hint linking to /security#egress-ips"
  - "src/app/(dashboard)/profile/components/AuditLogSubsection.tsx (S6 / D-05) — authenticated CSV download subsection consuming GET /api/me/audit-log/export"
  - "src/components/auth/ProfileTabs.tsx — allocator-only Security tab housing the AuditLogSubsection"
affects:
  - "Wizard chrome — both safety strips persist across all 4 steps (visible from connect_key through submit)"
  - "/security public page — S4a banner now visible to anonymous traffic; #egress-ips body unchanged (S4b deferred)"
  - "/profile?tab=security — new allocator-only tab; non-allocators with ?tab=security fall back to Personal Info via parseTabParam"

# Tech tracking
tech-stack:
  added: []  # Zero new npm dependencies
  patterns:
    - "Surgical content-only edits to a Server Component page (no data fetching, no caching changes)"
    - "WarningBanner className-override composition pattern (UI-SPEC §S5/§S7 LOCKED — same chrome, distinct ARIA)"
    - "Two single-purpose persistent strips rendered adjacently in a wizard parent layout (NOT merged into a 2-line strip — preserves CONTEXT D-07 + D-08 component identity)"
    - "Client-side Blob-URL download trigger with inline S3-style error UI on 4xx/5xx (chosen over plain <a download> so 401/500 surface as in-page retry rather than navigation error)"
    - "ProfileTabs ALL_TABS allocator-only key extension + ALLOCATOR_ONLY_KEYS gate — parseTabParam falls back to 'personal' when isAllocator=false"

key-files:
  created:
    - "src/app/(dashboard)/strategies/new/wizard/WithdrawalWarningStrip.tsx (52 LOC) — S5 strip"
    - "src/app/(dashboard)/strategies/new/wizard/WithdrawalWarningStrip.test.tsx (62 LOC) — 6 tests"
    - "src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.tsx (44 LOC) — S7 hint"
    - "src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.test.tsx (60 LOC) — 6 tests"
    - "src/app/(dashboard)/profile/components/AuditLogSubsection.tsx (105 LOC) — S6 download UI"
    - "src/app/(dashboard)/profile/components/AuditLogSubsection.test.tsx (180 LOC) — 10 tests"
    - "src/components/auth/ProfileTabs.test.tsx (107 LOC) — 5 tests"
    - "src/app/security/page.test.tsx (123 LOC) — 8 tests"
  modified:
    - "src/app/security/page.tsx — +35 LOC (S4a banner inside #compliance-posture; S4c link line inside #data-handling-summary). #egress-ips body unchanged."
    - "src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx — +12 LOC (2 imports + JSX mount above step branches)"
    - "src/components/auth/ProfileTabs.tsx — +14 LOC (security entry in ALL_TABS, ALLOCATOR_ONLY_KEYS extension, AuditLogSubsection import + tab body case)"

key-decisions:
  - "S4b (D-07 inline egress-IP block on /security) DEFERRED. The analytics-service does not currently advertise static egress IPs (Railway default dynamic NAT). The existing email-path body in #egress-ips section is preserved unchanged: 'If your exchange key is locked to an IP allowlist, allow our analytics service egress range. Email security@quantalyze.com for the current IP set — we rotate infrequently and will notify ahead of any change.' Re-evaluate post-static-IP infrastructure work; until then the email path remains the canonical IP-disclosure mechanism per UI-SPEC §S4b lockdown ('If the executor cannot find published IP ranges, the executor MUST stop and ask — do NOT invent IPs.')."
  - "WithdrawalWarningStrip + WizardIpAllowlistHint shipped as TWO single-purpose components rendered adjacently in WizardClient parent layout, NOT merged into a 2-line strip. Per UI-SPEC §S7 / CONTEXT D-08: 'Combining them into a single 2-line strip would mutate CONTEXT D-08's component identity and copy.' Each carries its own role='note' + aria-label so screen-readers announce both notes distinctly."
  - "AuditLogSubsection uses fetch + Blob URL + transient <a download> + revokeObjectURL rather than a plain <a href='/api/me/audit-log/export' download>. Reason: 4xx/5xx responses on a plain anchor surface as navigation errors (lost click context). Blob-URL approach allows inline S3-style error UI with a Retry click that re-triggers the same fetch."
  - "Security tab in ProfileTabs is gated allocator-only (allocatorOnly: true; ALLOCATOR_ONLY_KEYS includes 'security'). Plan must-haves explicitly required 'allocator-only' for the security tab. PATTERNS suggested 'no allocatorOnly flag — every authenticated user has audit_log rows', but the plan task contract takes precedence; non-allocators with ?tab=security fall back to 'personal' via parseTabParam."
  - "S4a banner inserted with mt-6 mb-6 spacing — mt-6 establishes the 24px gap below the h2 heading (matching the existing .mt-4 .space-y-4 pattern used by the body paragraph block); mb-6 establishes the 24px gap above the existing 'We are a pre-audit company...' paragraph. Both values are locked tokens from UI-SPEC §Spacing Scale."
  - "All 8 existing /security anchor IDs preserved byte-identically (#data-handling, #key-handling, #compliance-posture, #data-handling-summary, #breach-notification, #security-contact, #operational-reference, #egress-ips). Verified via document.getElementById in page.test.tsx Test 'every existing /security anchor ID byte-identically'."

patterns-established:
  - "Pattern: WarningBanner className-override composition for persistent informational strips — same chrome (border-l-4 border-warning bg-warning/5), distinct ARIA labels per strip. Reusable for any future single-line wizard or page banner."
  - "Pattern: Two-component adjacency for locked-copy safety notices — each strip is its own component file when CONTEXT phrasing locks distinct sentences. Forbids accidental merging during refactors."
  - "Pattern: Blob-URL download with inline error UI — preferred over plain <a download> when the consumer wants graceful 4xx/5xx UX in-page rather than navigation."

requirements-completed: [ONBOARD-03]

# Metrics
duration: 14min
completed: 2026-04-26
---

# Phase 11 Plan 06: Security UI surfaces (S4a, S4c, S5, S6, S7) Summary

**Surgical patches to `/security` (D-06 SOC-2 banner + D-05 audit-log link), persistent wizard safety strips (D-08 read-only + D-07 IP-allowlist), and the `/profile?tab=security` audit-log download subsection together close ONBOARD-03 by surfacing existing security posture credibly to institutional LPs without inventing new attestations. S4b (inline egress-IP block) deferred pending static-IP infrastructure work.**

## Performance

- **Started:** 2026-04-26T20:31:26Z
- **Completed:** 2026-04-26T20:45:27Z (approximate)
- **Duration:** ~14 min
- **Tasks:** 3 implementation tasks (Task 0 was a blocking checkpoint resolved by the user as "defer S4b — keep email path")
- **Files created:** 8 (4 source + 4 test)
- **Files modified:** 3 (`/security/page.tsx`, `WizardClient.tsx`, `ProfileTabs.tsx`)

## Accomplishments

### S4a — `/security` SOC-2 status banner (D-06)

Inline 1-line banner inserted near the top of the existing `<section aria-labelledby="compliance-posture">` block in `src/app/security/page.tsx`, BEFORE the existing "We are a pre-audit company..." paragraph. Verbatim CONTEXT D-06 phrasing:

```
SOC 2 status: pre-audit, preparing for SOC 2 Type 1.
Allocators evaluating us under diligence — request a posture letter.
```

The leading sentence renders semibold in `text-text-primary`; the trailing sentence renders in `text-text-secondary` with `request a posture letter` as an accent `<a href="mailto:security@quantalyze.com?subject=Posture%20letter%20request">`. The banner uses `role="status"`, `aria-live="polite"`, `border-l-4 border-warning`, and `bg-warning/5` per UI-SPEC §S4a + §Accessibility S4a.

### S4c — `/security` public audit-log link line (D-05)

Editorial 1-line link appended to the END of the existing `<section aria-labelledby="data-handling-summary">` block, AFTER the existing data-handling matrix table and BEFORE the section closing tag. Verbatim CONTEXT D-05 phrasing:

```
If you have an account, you can download your audit log from your profile.
```

Renders as a `<p>` in `text-[14px] leading-relaxed text-text-muted` editorial muted-prose tone with `download your audit log` as `<a href="/profile?tab=security" className="text-accent underline-offset-4 hover:underline">`. The `mt-6` spacing maintains 24px rhythm below the table.

### S5 — `WithdrawalWarningStrip` (D-08)

New component at `src/app/(dashboard)/strategies/new/wizard/WithdrawalWarningStrip.tsx`. Composes from the existing `<WarningBanner>` primitive with the locked className override `border-l-4 border-warning bg-warning/5`. Renders the verbatim D-08 sentence with the leading "READ ONLY" word semibold in `text-text-primary` and the rest of the sentence in `text-text-secondary`:

```
READ ONLY ONLY — keys with Trade or Withdraw permissions are refused on submission.
```

Plus an optional caption: "Read-only is enforced server-side at validation — Trade/Withdraw scopes are rejected before encryption." `role="note"` + `aria-label="Wizard read-only key requirement"`. Persistent (no dismiss control).

### S7 — `WizardIpAllowlistHint` (D-07)

New component at `src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.tsx`. Same `<WarningBanner>` composition + same className override as S5, plus `mt-2` spacing so it stacks 8px below S5. Verbatim D-07 sentence:

```
Locking your exchange key to an IP allowlist? Allow our egress IPs — see /security#egress-ips.
```

The `/security#egress-ips` token renders as `<a href="/security#egress-ips" className="text-accent underline-offset-4 hover:underline">/security#egress-ips</a>` (visible text byte-identical to the CONTEXT D-07 phrasing). `role="note"` + `aria-label="Exchange IP allowlist hint"`. Persistent (no dismiss control).

### WizardClient mount (S5 + S7)

Both strips mounted in `WizardClient.tsx` parent layout IMMEDIATELY ABOVE the step branches inside `<WizardChrome>`, wrapped in a `<div className="mb-4">` for 16px separation from the first step body. NOT mounted per-step (UI-SPEC §Interaction Contract LOCKS parent-layout mount). Both strips persist across all 4 wizard steps (`connect_key`, `sync_preview`, `metadata`, `submit`) regardless of step transitions, key validation states, or wizard error states.

### S6 — `AuditLogSubsection` (D-05)

New component at `src/app/(dashboard)/profile/components/AuditLogSubsection.tsx`. Renders inside the new ProfileTabs `security` tab body. Locked copy:

- Heading: `<h2>Audit log</h2>` (DM Sans 18px semibold per UI-SPEC §Typography)
- Description: `Every read, write, and outcome on your account is logged. Download a CSV of the last 90 days for your records or compliance review.`
- Primary CTA: `<Button>Download CSV (last 90 days)</Button>` with `aria-label="Download audit log CSV for the last 90 days"`
- Caption: `Includes: timestamp, action, entity type, entity reference. ~5–50 KB depending on activity.`

Click triggers `fetch("/api/me/audit-log/export", { method: "GET", credentials: "same-origin" })`. On 200, the response Blob is wrapped in `URL.createObjectURL`, attached to a transient `<a>` with the filename extracted from `Content-Disposition`, clicked, removed, and the URL revoked. Loading state disables the button and swaps copy to `Preparing…`. On 4xx/5xx, an inline `<div role="alert" aria-live="polite">` renders below the button with the message `"Could not download audit log. Please try again."` and a `Retry` button that re-triggers the same fetch (S3 error shape per UI-SPEC §Interaction Contract S6).

### ProfileTabs Security tab integration

`ALL_TABS` extended with `{ key: "security", label: "Security", allocatorOnly: true }` positioned between Exchanges and Organizations. `ALLOCATOR_ONLY_KEYS` extended with `"security"` so `parseTabParam('security', isAllocator=false)` falls back to `'personal'`. The render switch gains `{activeTab === "security" && isAllocator && <div><AuditLogSubsection /></div>}` — the wrapping `<div>` documents intent for future security subsections (MFA, encryption details) to mount alongside.

## Task Commits

| Task | Commit  | Files                                                                                                                                                                                              |
| ---- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 2a19851 | src/app/security/page.tsx, src/app/security/page.test.tsx                                                                                                                                          |
| 2    | 4b8ae7d | src/app/(dashboard)/strategies/new/wizard/WithdrawalWarningStrip.tsx, .test.tsx, WizardIpAllowlistHint.tsx, .test.tsx, WizardClient.tsx                                                            |
| 3    | 3e55234 | src/app/(dashboard)/profile/components/AuditLogSubsection.tsx, .test.tsx, src/components/auth/ProfileTabs.tsx, ProfileTabs.test.tsx                                                                |

## Test counts

- `src/app/security/page.test.tsx`: **8 tests** — S4a banner copy + mailto + warning-tinted left rule, S4b deferral state preservation, S4c verbatim copy + /profile?tab=security anchor, all 8 anchor IDs preserved, metadata.robots.index === true.
- `src/app/(dashboard)/strategies/new/wizard/WithdrawalWarningStrip.test.tsx`: **6 tests** — verbatim D-08 sentence, semibold "READ ONLY" leading span, WarningBanner composition, role="note" + aria-label, no dismiss button, helper caption.
- `src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.test.tsx`: **6 tests** — verbatim D-07 sentence, /security#egress-ips anchor, WarningBanner composition, role="note" + aria-label, no dismiss button, mt-2 spacing.
- `src/app/(dashboard)/profile/components/AuditLogSubsection.test.tsx`: **10 tests** — verbatim heading/description/CTA/caption, fetch wiring, browser-download Blob trigger, 401 + 500 inline error + Retry, loading-state disable + copy swap, aria-label.
- `src/components/auth/ProfileTabs.test.tsx`: **5 tests** — allocator visibility, non-allocator hidden, ?tab=security gating (allocator + non-allocator paths), tab-order invariant.

**Total: 35 new tests, 35 passing. typecheck + lint clean. `npm run build` succeeds; `/security` still pre-rendered as static.**

## Deviations from Plan

### Deferred work

**1. [Defer — user decision] S4b (D-07 inline egress-IP block on /security) deferred to post-static-IP infrastructure work.**

- **Found during:** Task 0 checkpoint (planning)
- **Issue:** Plan 11-06 originally specified an inline IP block per UI-SPEC §S4b that lists static egress IP values. The analytics-service is hosted on Railway with default dynamic NAT — no static egress IPs are advertised today.
- **Decision:** User selected "Defer S4b — keep email path" at the checkpoint. Per UI-SPEC §S4b LOCKED: "If the executor cannot find published IP ranges, the executor MUST stop and ask — do NOT invent IPs." The existing email-path body in `<Section id="egress-ips" title="Egress IPs (IP-allowlist keys)">` is preserved unchanged: "If your exchange key is locked to an IP allowlist, allow our analytics service egress range. Email security@quantalyze.com for the current IP set — we rotate infrequently and will notify ahead of any change."
- **Files NOT modified:** `src/app/security/page.tsx` lines 494-507 (the `#egress-ips` Section body).
- **Re-evaluate when:** Static egress IPs are provisioned for the analytics-service (Vercel Pro static-IP feature add or Railway egress-allowlist infrastructure work).
- **Until then:** The email path remains the canonical IP-disclosure mechanism. The new S7 wizard hint still links to `/security#egress-ips` and lands on the existing email-path section. Risk: institutional LPs evaluating IP-allowlist requirements have to email rather than read inline — same UX as today, no regression.

### Auto-fixed issues

**1. [Rule 1 — Bug] Removed unused `eslint-disable-next-line no-console` directive in AuditLogSubsection.**

- **Found during:** Task 3 lint check
- **Issue:** Lint flagged the directive as unused — the project's eslint config does not warn on `no-console`, so the directive was redundant.
- **Fix:** Removed the directive; `console.warn(...)` call retained for runtime debugging.
- **Files modified:** `src/app/(dashboard)/profile/components/AuditLogSubsection.tsx`
- **Commit:** Folded into Task 3 commit `3e55234`.

### Acceptance-criteria edge case

The plan's Task 2 acceptance grep `grep -q "READ ONLY ONLY — keys with Trade or Withdraw permissions are refused on submission" src/app/(dashboard)/strategies/new/wizard/WithdrawalWarningStrip.tsx` returns 0 because the JSX renders the sentence across two `<span>` elements with the wrap point in the middle of the sentence. The DOM textContent is the verbatim D-08 sentence — verified by the component test `note.textContent.toMatch(/READ ONLY ONLY — keys with Trade or Withdraw permissions are refused on submission\./)` which passes. The grep is overly strict for multi-line JSX; the actual contract (DOM render) is satisfied.

## Acceptance Criteria

- [x] All 8 existing `/security` anchor IDs preserved byte-identically (verified by `page.test.tsx` Test 'every existing /security anchor ID byte-identically' + grep)
- [x] `/security` is still public + indexable (`metadata.robots.index === true` — verified by `page.test.tsx`)
- [x] All UI-SPEC §S4a/§S4c/§S5/§S6/§S7 strings byte-identical (35 component tests asserting verbatim copy)
- [x] S4b deferred per user decision; existing email-path body preserved (no regression)
- [x] WithdrawalWarningStrip + WizardIpAllowlistHint mount in WizardClient parent layout, persistent across all 4 steps
- [x] ProfileTabs gains an allocator-only Security tab rendering AuditLogSubsection
- [x] AuditLogSubsection consumes GET /api/me/audit-log/export and triggers a browser download with inline error fallback
- [x] ZERO new npm dependencies
- [x] All tests green; existing tests unaffected (35 new + OnboardingWizard regression suite green)
- [x] typecheck + lint clean on all new/modified files; `npm run build` succeeds

## Self-Check: PASSED

- All 8 source/test files created and tracked in git (verified via `git log --oneline -3` showing 2a19851 + 4b8ae7d + 3e55234)
- All 3 modified files committed (security/page.tsx, WizardClient.tsx, ProfileTabs.tsx)
- All 35 new tests pass; 5 OnboardingWizard tests still green
- typecheck + build green; lint clean on Phase 11-06 surface
- All anchor IDs intact; `/security` still static-prerendered

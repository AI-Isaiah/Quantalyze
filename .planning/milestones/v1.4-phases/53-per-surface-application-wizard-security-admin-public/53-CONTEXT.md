# Phase 53: Per-surface application — wizard + /security + admin + public - Context

**Gathered:** 2026-06-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Bring the **lower-traffic surfaces deferred from Phase 52** to the v1.4 bar — the same evolved
design system, fluid no-clip type, container-query responsiveness, complete honest state coverage
(loading/empty/error/skeleton), and React-19/Next-16 boundary correctness that Phase 52 applied to
the allocator journey — plus a focused **manager-wizard UX upgrade** (the one genuinely-new UX work).

**In-scope surfaces:**
- **Manager API-key wizard** — `src/app/(dashboard)/strategies/new/wizard/**` (+ `strategies/new`, `strategies`)
- **/security** — `src/app/(marketing)/security/page.tsx`
- **Admin** — `src/app/(dashboard)/admin/**` (page + csv-status, match, partner-import, usage, compute-jobs, intros, deletion-requests, users, for-quants-leads)
- **Public / marketing bodies** — `src/app/(marketing)/**` (home, for-quants, demo, demo/founder-view, legal/{disclaimer,privacy,terms}, security) — page bodies only; the P51 shell stays as-is
- **/portfolios** — `src/app/(dashboard)/portfolios/**` (+ `[id]`, `[id]/manage`, `[id]/documents`)
- **(auth) pages** — `src/app/(auth)/**` (login, signup, forgot-password, reset-password, onboarding, pending-approval)

Requirements delivered here: **APPLY-02, APPLY-03, APPLY-04, STATE-05, BP-02**.

**LOCKED (inherited):** `scenario.ts` SCENARIO-05, `compute.ts`/`FactsheetBody` BODY-02, no-invented-data,
no-peer-rank, the v1.3 WCAG-AA floor. These surfaces don't touch the scenario/factsheet math, but the
guardrails still apply (no RSC-ifying any frozen island; no fabricated data in empty states).

</domain>

<decisions>
## Implementation Decisions

### Surface Scope & Per-Surface Measure
- **Full scope** — all Phase-52-deferred surfaces plus the (auth) pages: wizard, /security, admin (+10 sub-pages), public/marketing bodies, /portfolios (+[id]/manage/documents), and (auth) login/signup/forgot/reset/onboarding/pending.
- **Per-surface measure (inherit Phase 52):** data/table surfaces (**admin**, **/portfolios**) fluid-fill toward ~1920px then center with gutters; **prose/form surfaces** (wizard, /security, marketing, auth) keep a narrower readable measure, centered. No horizontal scroll/overlap 320px → 2560px.
- **Admin depth:** full conformance — refreshed primitives + fluid type + no-clip + state coverage — with lighter visual polish than the allocator journey (staff-facing, but the "no two apps" conformance bar still applies).
- **Marketing depth:** conform page **bodies** (fluid type + no-clip + primitive adoption); the Phase-51 `(marketing)` shell/masthead/footer is already refreshed — do not redesign marketing copy or layout.

### Wizard UX Upgrade (the genuinely-new area)
- **Field-level validation surfacing:** surface the wizard's existing validation **inline per-field** (on blur + on submit), not only via the top `WizardErrorEnvelope` banner. Keep the banner as the summary.
- **Review-before-submit:** add a final **read-only review/confirm recap** step before finalize — a recap of entered values, no new data collection.
- **Primitive migration:** migrate wizard fields to the Phase-50 `Field`/`Input`/`Select`/`Button` primitives via the strangler pattern; keep the `WizardChrome` step structure.
- **Scope guard:** **polish only** — no new wizard steps/fields/data collection beyond the read-only review recap; no-invented-data holds (no placeholder/demo values).

### Inherited Policies + State Coverage (carry Phase 52 forward verbatim)
- **No-clip (TYPE policy):** wrap-by-default (`break-words` + `min-w-0`); single-line + `title=` only where tabular row-alignment requires it. `.planning/audits/truncation-audit.md` is the classification SoT; preserve `tabular-nums` alignment under fluid type.
- **Container queries:** strangler `@container`/`container-type` where a component renders at varying width inside a parent (admin/portfolios data tables, wizard step panels, marketing cards); viewport breakpoints only where the decision is genuinely viewport-level. **Tailwind v4 `@container` host + `@`-variants must be parent/child, never the same element** (Phase-52 CRITICAL lesson).
- **State coverage (STATE-05):** add route-level `loading.tsx` + `error.tsx` for every in-scope surface lacking one — **admin and its sub-pages, /portfolios (+[id]/manage/documents), strategies/new (wizard)** — backed by shared `Skeleton`/`EmptyState`/`ErrorState` primitives (reuse Phase-50 `Skeleton`; model fidelity on `factsheet/[id]/v2/loading.tsx`). Honest degenerate states preserved (no fabricated zeros/demo numbers/count-ups).
- **Boundaries / best-practices (BP-02):** no RSC-ifying frozen islands; react-best-practices + frontend-design applied to touched files; AI-slop patterns eliminated; a per-surface DESIGN.md-conformance check gates each surface; `proxy.ts` `PUBLIC_ROUTES` + the Phase-51 route-contract guard stay green for any touched route.

### Claude's Discretion
- Exact per-surface skeleton fidelity (match-layout vs generic) — bias to match-layout where it's cheap; generic Skeleton acceptable for admin internal pages.
- Which specific admin/portfolios/marketing components qualify for `@container` under "strangler where width varies" — decided per surface in planning.
- The precise wizard review-step layout and inline-validation presentation, within the polish-only + no-invented-data guard.
- Whether (auth) pages need their own `loading.tsx` (most are static/instant) — add only where a real async gap exists.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase-50 primitives** (`src/components/ui/`): `Button`, `Modal`, `Tabs`, `Table`, `Field`, `Select`, `Card`, `CardShell`, `CollapsibleSection`, `Skeleton`, `Badge`, `Tooltip`, `Input`, `Textarea`, banners — the conformance toolkit for every Phase-53 surface.
- **Phase-49 fluid tokens** (`src/app/globals.css`): `--text-hero` → `--text-micro` clamp tiers (zoom-safe) + `--space-*`; apply across these surfaces.
- **Wizard internals** (`src/app/(dashboard)/strategies/new/wizard/`): `WizardChrome.tsx`, `WizardErrorEnvelope.tsx`, `WizardIpAllowlistHint.tsx`, `WithdrawalWarningStrip.tsx`; wizard logic in `src/lib/wizard/`. The review step + inline validation extend these.
- **Phase-52 state primitives / patterns**: route `loading.tsx`/`error.tsx` precedent (allocations, compare, factsheet), shared `Skeleton`, `EmptyState` (`allocations/.../EmptyState.tsx`), `ResponsiveTable`.
- **Admin components** (`src/components/admin/`, `src/lib/admin/`) — reuse/refresh in place.

### Established Patterns
- **RSC page + client island**: pages are RSC + server-fetch; interactivity is `"use client"`. Route groups: `(dashboard)` (authed), `(marketing)` (public, P51 shell), `(auth)`.
- **Two-tier max-width**: dashboard data pages were `max-w-[1280px]` (P52 moved allocator surfaces to fluid-fill ~1920); marketing/auth/prose narrower. Phase 53 applies the same fluid-fill split to admin/portfolios; keeps prose/form narrow.
- **`@container` now exists** (introduced in P52) — extend the idiom; honor the parent/child host rule.
- **Route-contract guard** (P51, `scripts/check-route-contract.ts` + `route-contract-manifest.ts`, wired into `npm run lint`) + `proxy.ts` `PUBLIC_ROUTES` — must stay green for any route touched.

### Integration Points
- Page routes listed in `<domain>`. Wizard finalize: `src/app/api/strategies/finalize-wizard`; draft cleanup cron exists.
- Marketing shell (masthead/LegalFooter) is shared and already P51-refreshed — Phase 53 touches page bodies only.
- Coverage ratchet (lines 82 / stmts 80 / fns 74 / branches 72, `vitest.config.ts`) is a blocking CI gate — port/extend tests in the same change as any refactor.

</code_context>

<specifics>
## Specific Ideas

- Wizard: inline per-field validation (blur + submit) + a final read-only review/confirm recap; migrate fields to P50 `Field`/`Input`/`Select`; keep `WizardChrome` step flow. Polish only — no new data collection.
- Admin + /portfolios: add the missing `loading.tsx`/`error.tsx`, fluid-fill ~1920 for the data tables, wrap+`title=` name cells, strangler `@container` on the tables.
- /security + marketing bodies: fluid type + no-clip + primitive conformance; don't touch the P51 shell or marketing copy.
- (auth) pages: primitive + fluid-type conformance; add `loading.tsx` only where a real async gap exists.
- Truncation SoT: `.planning/audits/truncation-audit.md`. Container-query host rule: parent/child, never same element (P52 lesson).

</specifics>

<deferred>
## Deferred Ideas

- App-wide verification gates — ultra-wide 2560px axe/reflow row, authed/mobile axe re-enable, no-clip CI guard, tolerance Playwright goldens, lighthouse ratchet, **and completing the deferred px→token migration (153 orphan sites)** — all Phase 54.
- ⌘K command palette (NAV-F1) — deselected; needs an RLS-scoped search spike.
- Any marketing copy/layout redesign — out of scope (conformance only).

</deferred>

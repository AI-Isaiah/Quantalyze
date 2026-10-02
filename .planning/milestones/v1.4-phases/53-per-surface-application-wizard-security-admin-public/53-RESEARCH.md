# Phase 53: Per-Surface Application — Wizard + /security + Admin + Public — Research

**Researched:** 2026-06-29
**Domain:** Frontend per-surface CONFORMANCE (fluid type, refreshed primitives, `@container`, route-state files, no-clip) + a focused additive wizard UX upgrade — on the lower-traffic surfaces deferred from Phase 52. Next 16.2.9, React 19.2.7, Tailwind v4.3.1, Vitest 4.1.2.
**Confidence:** HIGH

<user_constraints>
## User Constraints (from 53-CONTEXT.md)

### Locked Decisions
- **Full scope** — all Phase-52-deferred surfaces plus (auth): wizard, /security, admin (+10 sub-pages), public/marketing bodies, /portfolios (+`[id]`/`manage`/`documents`), and (auth) login/signup/forgot/reset/onboarding/pending.
- **Per-surface measure (inherit Phase 52):** data/table surfaces (**admin**, **/portfolios**) fluid-fill toward ~1920px then center with gutters; **prose/form surfaces** (wizard, /security, marketing, auth) keep a narrower readable measure, centered. No horizontal scroll/overlap 320px → 2560px.
- **Admin depth:** full conformance — refreshed primitives + fluid type + no-clip + state coverage — with lighter visual polish than the allocator journey (staff-facing); the "no two apps" conformance bar still applies.
- **Marketing depth:** conform page **bodies** only (fluid type + no-clip + primitive adoption); the Phase-51 `(marketing)` shell/masthead/footer is already refreshed — do not redesign marketing copy or layout.
- **Wizard field-level validation surfacing:** surface the wizard's EXISTING validation inline per-field (on blur + on submit), not only via the top `WizardErrorEnvelope` banner. Keep the banner as the summary (`role="alert"` surface).
- **Wizard review-before-submit:** add a final read-only review/confirm recap step before finalize — recap of entered values, NO new data collection.
- **Wizard primitive migration:** migrate wizard fields to Phase-50 `Field`/`Input`/`Select`/`Button` via the strangler pattern; keep the `WizardChrome` step structure.
- **Wizard scope guard:** POLISH ONLY — no new wizard steps/fields/data collection beyond the read-only review recap; no-invented-data holds (no placeholder/demo values).
- **No-clip (TYPE policy):** wrap-by-default (`break-words` + `min-w-0`); single-line + `title=` only where tabular row-alignment requires it. `.planning/audits/truncation-audit.md` is the classification SoT; preserve `tabular-nums` alignment under fluid type.
- **Container queries:** strangler `@container`/`container-type` where a component renders at varying width inside a parent; viewport breakpoints only where genuinely viewport-level. **Tailwind v4 `@container` host + `@`-variants MUST be parent/child, never the same element** (Phase-52 #551 CRITICAL lesson).
- **State coverage (STATE-05):** add route-level `loading.tsx` + `error.tsx` for every in-scope surface lacking one — admin and sub-pages, /portfolios (+`[id]`/`manage`/`documents`), strategies/new (wizard) — backed by shared `Skeleton`/`EmptyStateCard`/`ErrorEnvelope` primitives (model fidelity on `factsheet/[id]/v2/loading.tsx`). Honest degenerate states preserved (no fabricated zeros/demo numbers/count-ups).
- **Boundaries / best-practices (BP-02):** no RSC-ifying frozen islands; react-best-practices + frontend-design applied to touched files; AI-slop eliminated; a per-surface DESIGN.md-conformance check gates each surface; `proxy.ts` `PUBLIC_ROUTES` + the Phase-51 route-contract guard stay green for any touched route.
- **Inherited LOCKED invariants:** `scenario.ts` SCENARIO-05, `compute.ts`/`FactsheetBody` BODY-02, no-invented-data, no-peer-rank, the v1.3 WCAG-AA floor. (These surfaces don't touch scenario/factsheet math, but the guardrails still apply.)

### Claude's Discretion
- Exact per-surface skeleton fidelity (match-layout vs generic) — bias to match-layout where cheap; generic `Skeleton` acceptable for admin internal pages.
- Which specific admin/portfolios/marketing components qualify for `@container` under "strangler where width varies" — decided per surface in planning.
- The precise wizard review-step layout and inline-validation presentation, within polish-only + no-invented-data.
- Whether (auth) pages need their own `loading.tsx` (most are static/instant) — add only where a real async gap exists.

### Deferred Ideas (OUT OF SCOPE)
- App-wide verification gates — ultra-wide 2560px axe/reflow row (app-wide), authed/mobile axe re-enable, no-clip CI guard, tolerance Playwright goldens, lighthouse ratchet, and the deferred px→token migration completion (153 orphan sites) — **all Phase 54**.
- ⌘K command palette (NAV-F1) — deselected; needs an RLS-scoped search spike.
- Any marketing copy/layout redesign — out of scope (conformance only).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **APPLY-02** | Manager wizard renders the evolved system (refreshed Field/Input/Button/Dialog primitives, fluid no-clip type, `@container`-reshaped layout) **with field-level validation surfacing and a review-before-submit step**; holds 320→ultra-wide with zero clip; no-invented-data holds. | §Wizard UX Upgrade (state-machine map + where review/inline-validation attach), §Architecture Pattern 5, §Don't Hand-Roll (Field a11y already done), §Pitfalls 6/7. The `Field` primitive already wires `aria-invalid`+`aria-describedby` — inline validation is "surface the existing `wizardErrors.ts` strings through `Field`," not new infra. |
| **APPLY-03** | /security renders the evolved system end-to-end (primitives + fluid no-clip type + reshaped layout), conformant to refreshed DESIGN.md. | §Per-surface measure (prose, narrow), §Type subset (marketing category — the ONE `--text-h2` place), §No-clip (no audit sites on /security; the 6 persistent-underline links are LOCKED accent). 27 raw `text-[Npx]` sites to migrate. |
| **APPLY-04** | Admin pages + remaining public pages render the evolved system, no legacy-vs-evolved drift. | §Per-surface measure (admin = fluid-fill 1920 via `DashboardChrome.isWide`), §`@container` on admin data tables, §No-clip (8 admin audit sites incl. unrecoverable email mid-clip), §Type migration scope (admin pages 15 + `components/admin/` 66 raw-px). |
| **STATE-05** | Every Phase-53 route has honest `loading.tsx` + `error.tsx` (digest-only) + skeleton + empty states — no blank flashes, no fabricated/placeholder data. | §Route-State File Matrix (exact current→required, verified on disk), §Architecture Patterns 2/3, §Don't Hand-Roll (Skeleton/EmptyStateCard/error.tsx `unstable_retry`). |
| **BP-02** | Per-surface DESIGN.md-conformance check gates each surface; react-best-practices + frontend-design on touched files; AI-slop eliminated; coverage ratchet green; `proxy.ts` `PUBLIC_ROUTES` + route-contract guard green for touched routes. | §Per-Surface Conformance Exit, §Validation Architecture, §Security Domain, §Common Pitfalls 3/8. Route-contract guard scans only `page.tsx` → new `loading/error` files need NO manifest entry (verified). |
</phase_requirements>

## Summary

This is a **per-surface CONFORMANCE phase plus ONE additive wizard UX upgrade** — the direct continuation of Phase 52, applied to the lower-traffic surfaces (wizard, /security, admin + 10 sub-pages, marketing bodies, /portfolios, auth). Every "what library" question is already answered: Next 16.2.9, React 19.2.7, Tailwind v4.3.1 (container queries in core, no plugin), Vitest 4.1.2. **Zero packages are installed**, so the legitimacy gate is N/A. The entire phase is CSS/chrome/route-file/primitive-migration work, plus the wizard review-step + inline-validation surfacing.

The Phase-52 RESEARCH.md and PATTERNS.md are the **primary reusable source** — the techniques (route `loading.tsx`/`error.tsx` modeled on `factsheet/[id]/v2/loading.tsx`; `error.tsx` on the Next-16.2.0 `unstable_retry` signature; `@container` via the `StrategyTable`/`ResponsiveTable` idiom with the parent/child host rule; fluid-fill via the `DashboardChrome.isWide` allow-list; `no-clip` via `ScopedBanner` wrap or `title=`; per-surface `no-raw-font-px` ratchet to `error`) are all proven in-repo and apply verbatim. **The two genuinely-new things in Phase 53 are: (1) the wizard UX upgrade (review step + inline validation), and (2) admin's testing gap — admin routes are deliberately EXCLUDED from the seeded `reflow-sweep-authed` because the seed stamps `role='allocator'` and admin redirects non-admins.**

Three high-value technical resolutions for the planner: (a) **The Phase-53 "frozen islands" are NOT git-delta-frozen** — Phase 53 DELIBERATELY edits `WizardClient.tsx` (adds the review step), so the existing `phase-52-frozen-spine-guards.test.ts` (which freezes scenario.ts/compute.ts/EquityChart — none touched here) is sufficient for the math; the wizard's "frozen" parts (state machine transitions, autosave semantics, finalize-wizard POST contract) need a **behavioral** guard (the existing `WizardClient.test.tsx` + `finalize-wizard/route.test.ts`), not a new git-delta one. (b) **Adding `admin`/`portfolios` to `DashboardChrome.isWide`** is the one-line fluid-fill mechanism — the test file `DashboardChrome.test.tsx` already asserts the Phase-53 surfaces are NOT yet widened, so flipping them is a single regex edit + test update. (c) **The route-contract guard scans only `page.tsx`** — new `loading.tsx`/`error.tsx` files add no page route and need no manifest entry; marketing routes (`/security`, `/demo`, `/for-quants`, `/legal`) are ALREADY in `PUBLIC_ROUTES`, so /security conformance is body-only with zero NAV risk.

**Primary recommendation:** Plan as a **strangler, one surface per wave**, each independently verifiable. Per surface: (a) migrate raw `text-[Npx]`→`--text-*` and flip `no-raw-font-px` to `error` for the surface glob; (b) `@container` on the surface's varying-width data tables / panels (parent/child host); (c) raise admin/portfolios to fluid-fill ~1920 via `DashboardChrome.isWide`; (d) fix the surface's accidental clips per the audit; (e) add the missing `loading.tsx`/`error.tsx`. The **wizard wave is the heaviest** (review step + inline validation + primitive migration of 22 raw-px sites across 6 step files) and should be sequenced as its own wave with the `WizardClient.test.tsx` behavioral guard pinned first.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Route-level loading skeleton (`loading.tsx`) | Frontend Server (RSC) | — | Server Component by default; streams Suspense fallback while the RSC page awaits server-fetch. No client JS. |
| Route-level error boundary (`error.tsx`) | Browser / Client | — | Next requires `"use client"` on error boundaries (React error boundaries are client constructs). |
| `@container` responsiveness | Browser / Client (CSS) | — | Pure CSS containment + container-query variants; evaluated by the browser, no JS, no server. |
| Fluid type (`--text-*` clamp) | Browser / Client (CSS) | — | `clamp()` re-evaluated by the browser on zoom (WCAG 1.4.4); tokens in `globals.css @theme`. |
| Admin/portfolios ultra-wide fill | Frontend Server (`DashboardChrome` allow-list) | Browser (CSS) | `DashboardChrome.isWide` regex selects `max-w-[1920px]` vs `max-w-7xl` on the content container. |
| Truncation / no-clip treatment | Browser / Client (CSS + `title=`) | — | `break-words min-w-0` wrap or `title=` recovery — DOM/CSS only. |
| Wizard step machine / autosave / finalize POST | Browser / Client (`WizardClient` island) | API (`finalize-wizard`/`csv-finalize`) | FROZEN BEHAVIOR — the review step + inline validation ADD around it; transitions, localStorage autosave, and the POST body shape stay identical. |
| Wizard inline field validation surfacing | Browser / Client (`Field` primitive a11y) | — | `Field` already wires `aria-invalid`+`aria-describedby`; the validation DECISION reuses the existing `wizardErrors.ts` strings — no new server validation. |
| Honest degenerate state branches (admin/portfolios) | Frontend Server (data shape) | Browser (render via `EmptyStateCard`) | The branch DECISION is server-side (0 rows); the render is a neutral `EmptyStateCard`. |
| Scenario/factsheet math | **FROZEN ISLAND — no tier change, not in scope** | — | `scenario.ts`/`compute.ts` untouched; frozen by `phase-52-frozen-spine-guards.test.ts`. |

## Standard Stack

No new packages. Verified on-machine 2026-06-29.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | 16.2.9 | App Router, RSC, route-segment files (`loading.tsx`/`error.tsx`), `unstable_retry`, `unstable_instant` | App framework `[VERIFIED: node_modules/next/package.json]` |
| `react` / `react-dom` | 19.2.7 | RSC + client boundary, keys/memo/hooks, `useId` (Field) | Installed `[VERIFIED: node_modules/react/package.json]` |
| `tailwindcss` | 4.3.1 | `@container` container queries (CORE — no plugin), `--text-*` fluid tiers, `cn()` | Container queries built into v4 core `[VERIFIED: @tailwindcss/container-queries ABSENT from package.json; v4.3.1 bundle resolves]` |
| `@radix-ui/react-tabs` | 1.1.15 | Tabs primitive (non-native widget) | Installed; the meta `radix-ui` package is NOT present (`[VERIFIED: package.json — radix-ui absent, @radix-ui/react-tabs present]`). 53-UI-SPEC's `radix-ui@1.6.0` reference is the meta-package; the repo uses the scoped `@radix-ui/react-tabs` — no install needed either way. |

### Supporting (existing in-repo primitives — reuse, do NOT rebuild)
| Asset | Path | Purpose | When to Use |
|-------|------|---------|-------------|
| `Field` | `src/components/ui/Field.tsx` | label + control + hint + error a11y wrapper; **already wires `aria-invalid` + `aria-describedby` in `[hint,error]` order** | Wizard inline validation surfacing — wrap each field; pass the `wizardErrors.ts` string as `error`. Field does NOT validate (ASVS V5) — consumer supplies the error. |
| `Input` / `Select` / `Textarea` / `Button` | `src/components/ui/` | Form primitives | Wizard field migration (MetadataStep already uses Input/Select/Textarea/Button; bring full set onto `Field`) |
| `Skeleton` / `SkeletonText` / `SkeletonCard` | `src/components/ui/Skeleton.tsx` | Pulse placeholders (reduced-motion-safe via globals.css) | Assemble every new `loading.tsx`; do NOT hand-roll `animate-pulse` divs |
| `EmptyStateCard` | `src/components/ui/EmptyStateCard.tsx` | Honest-absence card (neutral muted, NO `role=alert`/red) | Admin/portfolios degenerate states. **Name is `EmptyStateCard` (not `EmptyState`)** — `{ heading, body }` props. |
| `ErrorEnvelope` | `src/components/error/ErrorEnvelope.tsx` | Blocking-error `role="alert"` envelope (sourced from `wizardErrors.ts` via `buildEnvelope()`) | In-page blocking errors (wizard summary banner) |
| factsheet `loading.tsx` | `src/app/factsheet/[id]/v2/loading.tsx` | Fidelity bar for match-layout skeletons (header→KPI→body, sr-only `role=status`) | Model every new `loading.tsx` on it |
| dashboard / strategy `error.tsx` | `src/app/(dashboard)/error.tsx`, `src/app/strategy/[id]/error.tsx` | Reference shape (on `unstable_retry`, digest-only) | Model new `error.tsx` shape + copy |
| `ResponsiveTable` | `src/components/ResponsiveTable.tsx` | Horizontal-scroll region; doubles as `@container` host (`className`+`scrollRef`+`role=region`) | Admin/portfolios table surfaces; set `className="@container"` here |
| `StrategyTable` | `src/components/strategy/StrategyTable.tsx` | Working `@container` + `@max-3xl:hidden` priority-collapse precedent | Copy this idiom for new admin/portfolios table container migrations |
| `DashboardChrome` | `src/components/layout/DashboardChrome.tsx` | `isWide` allow-list (line 72) selects `max-w-[1920px]` | Add `admin`/`portfolios` to the regex for fluid-fill |
| `WizardChrome` | wizard dir | Stepper rail + panel; reads `WizardStepKey` from localStorage.ts; `DEFAULT_STEPS` (API, 4) + `CSV_STEPS` (4) | KEEP structure; review step extends the step arrays + `WizardStepKey` |
| `wizardErrors.ts` | `src/lib/wizardErrors.ts` | `human_message` / `fix[]` strings, `buildEnvelope()` | Inline validation copy — NEVER invent new error copy |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `DashboardChrome.isWide` regex | A per-page `max-w-[1920px]` wrapper | DON'T — the standard shell's `max-w-7xl` (1280px) content cap CLAMPS a page-level wider wrapper (the documented Phase-52 lesson at DashboardChrome.tsx:66-68). The allow-list is the only mechanism that actually fluid-fills past 1280. |
| Tailwind v4 core `@container` | `@tailwindcss/container-queries` plugin | DON'T — the plugin is the v3 path; v4 has it in core. Installing it is redundant + a supply-chain surface. |
| `@container` (inline-size) | `@container-size` (size container) | Use plain `@container` — these surfaces respond to WIDTH only. `@container-size` opts into block-size containment which collapses panel height to 0 (Pitfall 1). |
| New git-delta frozen guard for the wizard | The existing `WizardClient.test.tsx` behavioral suite | Use the behavioral suite — Phase 53 DELIBERATELY edits `WizardClient`, so a git-delta zero-diff guard would fail by design. The invariant is BEHAVIOR (transitions/autosave/POST), provable by the existing tests. |

**Installation:** None. `npm install` adds nothing for this phase.

**Version verification (run 2026-06-29):**
```
next 16.2.9 · react 19.2.7 · react-dom 19.2.7 · tailwindcss 4.3.1 · vitest 4.1.2 · @vitest/coverage-v8 4.1.9 · @radix-ui/react-tabs 1.1.15
@tailwindcss/container-queries: NOT PRESENT (correct — built into v4 core)
radix-ui (meta): NOT PRESENT (repo uses scoped @radix-ui/react-tabs)
```
`[VERIFIED: node_modules/*/package.json + package.json on this machine]`

## Package Legitimacy Audit

> This phase installs **zero** external packages. No registry/slopcheck pass is required. slopcheck was unavailable on this machine; recorded N/A because nothing is installed.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none) | — | N/A — pure CSS/route-file/primitive-migration work on already-installed deps |

**Packages removed due to slopcheck [SLOP] verdict:** none (no installs)
**Packages flagged as suspicious [SUS]:** none (no installs)

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **AGENTS.md:** This is Next.js 16 with breaking changes — **read `node_modules/next/dist/docs/` before writing any route/RSC code.** (Honored: loading.md/error.md read; `unstable_retry` v16.2.0 signature + the new `unstable_instant` export + the layout-data caveat all confirmed from local docs.)
- **CLAUDE.md Rule 2 (Simplicity) / Rule 3 (Surgical):** Per-surface strangler; touch only the surface in scope each wave; do not "improve" adjacent code. Wizard upgrade is ADDITIVE — never re-wire the existing transitions.
- **CLAUDE.md Test Coverage gate (BLOCKING CI):** lines 82 / statements 80 / functions 74 / branches 72 (`vitest.config.ts` thresholds; set under measured actual ~85/83/77/75). The `frontend-coverage` job gates branch protection. New route files (`loading.tsx`/`error.tsx`) + the wizard review step MUST carry render/behavior tests in the SAME change so coverage does not regress.
- **CLAUDE.md DESIGN.md authority:** Read DESIGN.md before any visual decision; where 53-UI-SPEC differs from DESIGN.md, DESIGN.md wins. No new tokens, no new fonts, 2 weights (400/600), accent reserved-for list, 4px ladder + documented exceptions (`--space-grid-gap:10px`, `py-0.5` badge, `--row-h:44px`, 44px touch targets).
- **CLAUDE.md Skill routing:** design-review / qa skills exist for verification; the executor should run the per-surface DESIGN.md-conformance check (BP-02).
- **Banned packages:** N/A (no installs).

## Architecture Patterns

### System Architecture Diagram (the two surface shapes in this phase)

```
DATA SURFACE (admin / portfolios) — fluid-fill 1920
  ┌──────────────────────────────────────────────────────────────┐
  │ DashboardChrome  (isWide regex → max-w-[1920px] | max-w-7xl)  │
  │   error.tsx ("use client") ◄── catches ──────────────┐        │
  │     wraps ▼                                            │        │
  │   loading.tsx (RSC Suspense fallback, match-layout)    │        │
  │     shown while ▼ awaits                               │        │
  │   page.tsx (RSC async)                                 │        │
  │     ├─ await supabase.auth.getUser() → redirect("/login") if !user
  │     ├─ await isAdminUser() → redirect (admin only)    │        │
  │     ├─ await admin.from(...).select() ────────────────┼──► throws → error.tsx
  │     │     (0 rows → degenerate branch decision)        │        │
  │     └─ renders ▼                                        │        │
  │   AdminTabs / portfolio cards  ("use client" islands)  │        │
  │     ├─ ResponsiveTable className="@container"  ◄── parent host  │
  │     │    └─ <th>/<td> @max-3xl:hidden  ◄── child variants       │
  │     │       (tabular-nums preserved across breakpoint)          │
  │     └─ 0 rows → EmptyStateCard (neutral, NO role=alert) ┘       │
  └──────────────────────────────────────────────────────────────┘

FORM SURFACE (wizard) — narrow, additive UX upgrade
  ┌──────────────────────────────────────────────────────────────┐
  │ strategies/new/wizard/page.tsx (RSC: server-prep draft fetch) │
  │   loading.tsx (NEW) → WizardChrome-shaped skeleton            │
  │   error.tsx   (NEW) → unstable_retry                          │
  │   WizardClient ("use client" — FROZEN state machine)         │
  │     step machine: connect_key→sync_preview→metadata→          │
  │                    [review (NEW)]→submit   (API branch)       │
  │                    csv_upload→csv_preview→csv_metadata→       │
  │                    [csv_review (NEW)]→csv_submit (CSV branch) │
  │     ├─ each step: fields wrapped in <Field error={wizardErrors}│
  │     │    on blur + on submit → aria-invalid + aria-describedby │
  │     │    (WizardErrorEnvelope stays the role=alert summary)    │
  │     ├─ review step: read-only recap of ENTERED values only,    │
  │     │    each section has "Edit" → setStep(owning step)        │
  │     │    (no role=alert; no fabricated values)                 │
  │     └─ autosave (localStorage.ts) + finalize POST: UNCHANGED  │
  └──────────────────────────────────────────────────────────────┘
```

### Recommended per-surface task structure (strangler — repeat per wave)
```
Wave per surface:
  1. Type migration   → raw text-[Npx] → --text-* tiers; flip no-raw-font-px to error for the surface glob
  2. Container queries → @container on varying-width tables/panels (StrategyTable idiom, parent/child host); preserve tabular-nums
  3. Ultra-wide       → admin/portfolios: add to DashboardChrome.isWide (+ update DashboardChrome.test.tsx)
  4. Truncation       → fix the surface's accidental clips per truncation-audit; never relocate a clip
  5. State files      → add missing loading.tsx/error.tsx modeled on factsheet bar (per the matrix)
  6. Verify           → reflow @320/2560, axe, no-raw-font-px error, coverage all green for the surface
```
The **wizard wave** additionally: extend `WizardStepKey` + step arrays with the review step; wrap fields in `Field` and surface `wizardErrors.ts` inline on blur+submit; pin `WizardClient.test.tsx` (transitions/autosave/POST unchanged) FIRST.

### Pattern 1: Add admin/portfolios to the fluid-fill allow-list (APPLY-04, the ONE wiring change)
**What:** `DashboardChrome.isWide` (line 72) is a regex allow-list selecting `max-w-[1920px]` vs `max-w-7xl`. Add `admin` and `portfolios`.
**When:** admin + /portfolios data surfaces (NOT wizard/auth — those stay narrow).
```tsx
// Source: src/components/layout/DashboardChrome.tsx:72 (in-repo) — CURRENT:
const isWide = /^\/(allocations|compare|discovery)(\/|$)/.test(pathname);
// PHASE 53 → add admin|portfolios:
const isWide = /^\/(allocations|compare|discovery|admin|portfolios)(\/|$)/.test(pathname);
```
**MUST also update `DashboardChrome.test.tsx`** — it currently asserts (lines ~233-242) that "every other dashboard route (incl. the Phase-53 surfaces) gets `max-w-7xl`" and explicitly tests a Phase-53 surface is NOT widened. Flip those assertions for admin/portfolios. `[VERIFIED: DashboardChrome.test.tsx:195-242 names the Phase-53 surfaces as not-yet-widened]`
**CAUTION:** the admin `isFullBleed` carve-out (`/^\/admin\/match\/[^/]+\/?$/`, the match-detail page) takes a DIFFERENT branch (no centered container at all) — it is unaffected by `isWide`; leave it.

### Pattern 2: Route-level `loading.tsx` (match-layout skeleton, RSC)
**What:** A Server Component returning a skeleton assembled from `Skeleton` primitives; Next auto-wraps the page in `<Suspense>`. Does NOT touch the client subtree → islands stay frozen.
**Per-surface dominant anchor (53-UI-SPEC):** admin list/table → data table first (header rule + N rows at the real column count); portfolios list → cards grid (`SkeletonCard`); portfolio detail → name header + headline-metric block; wizard → `WizardChrome`-shaped (stepper rail + first-step field-block).
```tsx
// Source: src/app/factsheet/[id]/v2/loading.tsx (in-repo — the fidelity bar)
import { Skeleton } from "@/components/ui/Skeleton";
export default function AdminLoading() {
  return (
    <div className="mx-auto max-w-[1920px] px-4 py-6 md:px-8 animate-pulse">
      {/* dominant anchor: the data table — header rule + N rows at the real col count */}
      <Skeleton className="h-8 w-48" />            {/* page title */}
      <div className="mt-6 border border-border bg-surface">
        <Skeleton className="h-10 w-full" />       {/* header rule */}
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="mt-px h-11 w-full" />)}
      </div>
      <p className="sr-only" role="status" aria-live="polite">Loading admin — fetching records.</p>
    </div>
  );
}
```
**Note on `animate-pulse` placement (carried from Phase 52):** a single `animate-pulse` on the RSC `loading.tsx` shell wrapper that contains `Skeleton` primitives is the SANCTIONED idiom (matches factsheet's `<article className="… animate-pulse">`). The "don't hand-roll animate-pulse divs" anti-pattern targets bespoke PER-ELEMENT pulse placeholders, not the shell.

### Pattern 3: Route-level `error.tsx` (Next 16 — `unstable_retry`, digest-only)
**What:** `"use client"` error boundary. **Next 16 prop is `unstable_retry` (re-fetches + re-renders), NOT `reset`.** The existing `(dashboard)/error.tsx` + `strategy/[id]/error.tsx` are already on it — mirror their shape + copy.
```tsx
// Source: node_modules/next/dist/docs/.../error.md (Props) + src/app/strategy/[id]/error.tsx (in-repo)
"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
export default function AdminError({
  error, unstable_retry,
}: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => { console.error("[admin-error]", error); }, [error]);
  return (
    <div className="…">
      <h1>Something went wrong</h1>
      <p>This section encountered an error. You can retry or navigate to another page.</p>
      {error.digest && <p className="font-mono text-xs">Error ID: {error.digest}</p>}{/* digest ONLY — never error.message (RSC info-leak, ASVS V7) */}
      <Button onClick={() => unstable_retry()}>Try again</Button>
    </div>
  );
}
```
`[CITED: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md — Props: unstable_retry; "Errors forwarded from Server Components show a generic message with an identifier… to prevent leaking sensitive details"]`

### Pattern 4: `@container` migration (the in-repo idiom — parent/child host)
**What:** Mark the containment region with plain `@container`; use `@max-*:`/`@min-[Npx]:`/`@3xl:hidden` variants on CHILDREN. Built into Tailwind v4 core.
**When:** admin data tables (ComputeJobsTable, MatchQueueIndex, AllocatorMatchQueue, csv-status, users), portfolio cards/holdings lists that reflow on panel width, wizard step panels + broker-selector grid, marketing body cards. NOT viewport-level chrome (DashboardChrome, marketing masthead, mobile nav).
```tsx
// Source: src/components/strategy/StrategyTable.tsx:516-520 + ResponsiveTable.tsx:55-63 (in-repo)
<ResponsiveTable label="Compute jobs" className="@container" scrollRef={scrollRef}>
  <table>
    <th className={`px-4 py-3 ${col.collapse ? "@max-3xl:hidden" : ""}`}>{col.label}</th>
    <td className="px-4 py-3 text-right font-metric tabular-nums @max-3xl:hidden">{value}</td>
  </table>
</ResponsiveTable>
```
**⚠️ Tailwind v4 CRITICAL (Phase-52 #551 regression):** the `@container` HOST and its `@`-variants MUST be parent/child — **never the same element.** A same-element host never matches and freezes the grid 1-wide. jsdom class-string tests FALSE-PASS this; verification needs a real layout OR a parent/child structural assertion. `[CITED: DESIGN.md 2026-06-29 Phase-52 entry: "the @container host MUST sit on a separate ancestor from the @sm:/@lg: grid-column variants; a same-element host never matches and freezes the grid"]`

### Pattern 5: Wizard inline validation surfacing (APPLY-02 — additive, the `Field` does the a11y)
**What:** Surface the EXISTING `wizardErrors.ts` validation inline per-field on blur + on submit. `Field` already wires `aria-invalid` + `aria-describedby` (in `[hint,error]` order, `undefined` when neither) — pass the existing `human_message` as `error`.
```tsx
// Source: src/components/ui/Field.tsx (in-repo — already does the a11y wiring)
<Field label="Strategy codename" error={blurred && fieldError ? fieldError : undefined}>
  <Input value={name} onBlur={() => setBlurred(true)} onChange={…} />
</Field>
// On submit-with-errors: focus the FIRST invalid field (DESIGN.md step-transition focus rule);
// WizardErrorEnvelope stays the role=alert SUMMARY listing all errors.
```
**Rules:** per-field messages are NOT individually `role="alert"` (only the envelope is). Copy is the existing `wizardErrors.ts` `human_message`/`fix[]` — NEVER a new string. Use `text-negative` `--text-caption` for the message.

### Pattern 6: Wizard review step (APPLY-02 — read-only recap, the only WizardStepKey change)
**What:** Add a final read-only review/confirm recap step before finalize on BOTH branches. Extend `WizardStepKey` (`src/lib/wizard/localStorage.ts:59` + the `validSteps` array at :302) with `review`/`csv_review`; add to `DEFAULT_STEPS`/`CSV_STEPS` in `WizardChrome.tsx`; update `STEP_INDEX` in `WizardClient.tsx:57` (the API branch becomes 5 steps; CSV 5 steps). Recap data comes from the existing `metadataDraft` / `csvMetadataDraft` + `syncSnapshot` / `csvPreview` state already in `WizardClient` (the same data `SubmitStep`/`CsvSubmitStep` POST).
```tsx
// API recap fields (from metadataDraft + syncSnapshot, already in WizardClient state):
//   name, description, categoryId, strategyTypes, subtypes, markets,
//   supportedExchanges, leverageRange, aum, maxCapacity
// CSV recap fields (from csvPreview, REAL parsed numbers): fmt, row_count, date_range
// Each row: --text-caption label + --text-body value (numbers in Geist Mono tabular-nums).
// Each section has "Edit" → setStep(owningStep) (existing seam; autosave preserves data).
// Layout: narrow form measure, hairline border-t border-border dividers, no card-on-card.
// Final CTA: existing verb — "Create strategy" (API) / "Submit strategy" (CSV). No role=alert.
```
**FROZEN:** the transition functions (`handleConnectSuccess`/`handleSyncComplete`/`handleMetadataComplete`/`handleSubmitSuccess` + the CSV onContinue/onComplete chain), `saveWizardState`/`loadWizardState` semantics, and the `finalize-wizard`/`csv-finalize` POST body shape stay identical. The review step is inserted as a new `step ===` render branch + one transition into it; SubmitStep/CsvSubmitStep still do the POST.

### Pattern 7: No-clip treatment (TYPE-02)
```tsx
// (a) WRAP — entity names in cards/lists/headings (ScopedBanner.tsx:30 reference)
<span className="break-words min-w-0">{portfolio.name}</span>
// (b) single-line + title= — dense table name cells where wrap breaks tabular alignment
<td className="truncate" title={fullText}>{fullText}</td>
```

### Anti-Patterns to Avoid
- **`@container-size` for width-only layout** → collapses panel height to 0. Use plain `@container`.
- **Same-element `@container` host** → never matches, freezes grid 1-wide (#551). Parent host, child variants.
- **Relocating a clip** → introducing a NEW `truncate`/`line-clamp` without `title`/tooltip when re-typing onto fluid tiers. The exact regression the audit prevents.
- **Removing a LEGITIMATE clip's recovery affordance** → `ComputeJobsTable.tsx:240/261` + `admin/compute-jobs/page.tsx:135` carry `title=`; the `:125` 8-char ID slice + `PortfolioOptimizer.tsx:81` raw strategy_id are intentional. Don't strip them.
- **RSC-ifying the WizardClient state machine** → moving step logic to the server, or removing the `"use client"`. The review step is a CLIENT render branch.
- **Re-wiring a wizard transition or the finalize POST under the guise of "primitive migration"** → the migration swaps `<input>`→`<Input>`/`<Field>`; it must not change what `onComplete`/`onSubmitted` do.
- **Fabricated data in empty/review states** → no demo values, no count-ups, no fabricated zeros; the review recap shows ONLY entered data (no-invented-data LOCKED).
- **A page-level `max-w-[1920px]` wrapper on admin/portfolios** → the `max-w-7xl` shell clamps it; use `DashboardChrome.isWide`.
- **`title=` on a control that already has accessible text** → double-announces; `title` is for clipped-content recovery only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Field label↔control↔error a11y | Hand-wired `aria-invalid`/`aria-describedby` on each wizard input | `Field` (`src/components/ui/Field.tsx`) | Already wires both in `[hint,error]` order, `undefined` when neither; the exact gap the primitive closed (CsvUploadStep wires `aria-invalid` but NOT `aria-describedby`) |
| Skeleton placeholders | Bespoke per-element `animate-pulse` divs | `Skeleton`/`SkeletonText`/`SkeletonCard` inside the route-shell wrapper | Reduced-motion-safe, consistent radius/bg |
| Error boundary | Custom React error boundary class | Next route `error.tsx` with `unstable_retry` | Framework wires the boundary + digest + retry + RSC message-stripping |
| Loading fallback wiring | Manual `<Suspense>` around the page | Route `loading.tsx` | Next auto-wraps page+children in Suspense |
| Container responsiveness | JS width measurement / `ResizeObserver` | CSS `@container` (Tailwind v4 core) | Pure CSS, no JS/hydration cost; the in-repo precedent is CSS |
| Honest empty state | Bespoke "no data" markup per surface | `EmptyStateCard` (neutral, no `role=alert`) | One source of the pinned no-alert/no-red tokens; prevents empty≠error drift |
| Ultra-wide fill | A per-page `max-w-[1920px]` wrapper | `DashboardChrome.isWide` allow-list | The shell `max-w-7xl` clamps a page-level wider wrapper (Phase-52 lesson) |
| Wizard error copy | A new inline-error string | `wizardErrors.ts` `human_message`/`fix[]` | Same source the envelope shows; no copy drift / no-invented-data |
| Horizontal-scroll table region | Custom overflow wrapper | `ResponsiveTable` (also the `@container` host) | Carries the scroll aria-label + `scrollRef` + `role=region` |

**Key insight:** Every primitive this phase needs already exists from Phases 49/50/52. The value is *applying* them per-surface with discipline (no clip relocation, no island/state-machine disturbance, no token drift) and the additive wizard recap/inline-validation — not building anything new.

## Runtime State Inventory

> Rename/refactor category. This is a CSS/chrome/route-file/primitive-migration phase plus an additive wizard step. The wizard touches localStorage and a step enum — checked explicitly below.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **Wizard localStorage draft pointer** (`src/lib/wizard/localStorage.ts`): the persisted envelope stores `step: WizardStepKey`. Adding `review`/`csv_review` to the enum means a resumed OLD draft could carry a step value the NEW code knows, and a NEW draft could carry `review` that OLD code (a stale tab) rejects. `loadWizardState` already validates `step` against a `validSteps` array (:302) and the resume logic only restores `csv_upload`/`connect_key`/`sync_preview` from LS (deeper steps fall through to the SSR default). | **CODE EDIT only** — add `review`/`csv_review` to BOTH the `WizardStepKey` union (:59) AND the `validSteps` array (:302). NO data migration: existing stored drafts never carry `review` (it didn't exist); a stored `review` from a future tab simply fails validation and falls back to the SSR default (the existing safe-degrade path). Verify the `validSteps` addition with the existing `localStorage.test.ts`. |
| Live service config | None — no n8n/Datadog/Tailscale/Cloudflare config references these surfaces. The wizard finalize endpoints (`finalize-wizard`/`csv-finalize`) are UNCHANGED (POST body shape frozen). | none |
| OS-registered state | None — no Task Scheduler/pm2/systemd/launchd registration involves UI surfaces. The wizard-draft cleanup cron exists but keys on draft age, not step value — unaffected by the new enum member. | none |
| Secrets/env vars | None — no secret keys or env var names referenced; route files read no new env. The wizard reads no new env. | none |
| Build artifacts | None — no package rename; new `loading.tsx`/`error.tsx` are net-new source files. The only "state" that changes is the `quantalyze/no-raw-font-px` lint LEVEL per surface glob in `eslint.config.mjs` (config edit, not runtime state) + the eslint cache (`node_modules/.cache/.eslintcache`, auto-managed). | none (cache self-heals) |

**Canonical question — after every file is updated, what runtime systems still have the old value cached/stored/registered?** Only the wizard localStorage draft can carry a `step` value; the existing `validSteps` validation + safe-degrade-to-SSR-default path already handles an unknown step. No data migration, no service/OS/secret changes. **Verified by reading `localStorage.ts` resume/validation logic + grep across the in-scope file inventory.**

## Common Pitfalls

### Pitfall 1: `@container-size` collapsing panel height
**What goes wrong:** `@container-size` applies `container-type: size` → block-size containment → a panel with no explicit height collapses to 0.
**How to avoid:** Use plain `@container` (inline-size) everywhere — these surfaces respond to WIDTH only.
**Warning signs:** A card/table renders at zero height after adding the container class.

### Pitfall 2: `tabular-nums` misalignment after container migration
**What goes wrong:** Columns of numbers drift out of vertical alignment when a container variant changes font tier or column visibility.
**How to avoid:** Keep every columnar number on Geist Mono `tabular-nums`; collapse columns from the RIGHT in priority order (the `StrategyTable` `collapse:true` pattern); relocate the real value into a `<details>` — never a fabricated em-dash. Add a per-new-container test asserting alignment holds across the `@max-*` boundary.
**Warning signs:** Right-aligned numeric columns look jagged at a container breakpoint.

### Pitfall 3: Silently disturbing the wizard state machine via "primitive migration"
**What goes wrong:** A field migration to `Field`/`Input` accidentally changes an `onChange`/`onBlur`/`onComplete` wiring, or the review-step insertion re-orders a transition — the autosave or finalize POST silently breaks.
**Why it happens:** The wizard is a dense 6-file island; a "tidy the form" edit looks orthogonal (CLAUDE.md Rule 8 trap).
**How to avoid:** Treat the transition functions, `saveWizardState`/`loadWizardState`, and the finalize POST body as read-only behavior. Pin `WizardClient.test.tsx` + `finalize-wizard/route.test.ts` + `localStorage.test.ts` BEFORE the migration; they must stay green. The review step is an ADD (new render branch + one transition into it), not a re-wire.
**Warning signs:** A `WizardClient.test.tsx` transition/autosave assertion goes red; the CSV branch mints a duplicate (NEW-C14-01 class).

### Pitfall 4: Ultra-wide fill making admin tables read "stretched"
**What goes wrong:** Raising admin/portfolios to fluid-fill ~1920 strands a 2-column table in a sea of whitespace.
**How to avoid:** Let the wider canvas surface MORE columns (un-collapse `@container` columns at `@min-*`) rather than spreading 2 columns across 1920px. "Data density > card density" (DESIGN.md). 53-CONTEXT: admin gets lighter polish but the same conformance bar — tune column behavior so the wider canvas reads deliberate.
**Warning signs:** A 2-column admin table centered in whitespace at 2560px.

### Pitfall 5: `loading.tsx` not showing because data is fetched in a layout
**What goes wrong:** A `loading.tsx` never renders its fallback.
**Why it happens:** Next 16: if a LAYOUT (not the page) accesses uncached/runtime data (`cookies()`, `headers()`, uncached fetch), navigation blocks until the layout finishes and `loading.tsx` shows nothing.
**How to avoid:** Keep server-fetch in `page.tsx`. **VERIFIED:** admin (`admin/page.tsx`: `await supabase.auth.getUser()` + `admin.from(...).select()` in the page body) and portfolios (`portfolios/page.tsx`: `await getUserPortfolios()` in the page) both fetch in the page → the skeleton WILL render. Don't move auth/data fetch up into the `(dashboard)/layout.tsx`.
**Warning signs:** Skeleton never appears on slow nav despite a `loading.tsx` existing.
`[CITED: node_modules/next/dist/docs/.../loading.md — "If the layout accesses uncached or runtime data… loading.js will not show a fallback for it"]`

### Pitfall 6: Inline validation double-announcing or breaking the envelope
**What goes wrong:** Marking each inline field message `role="alert"` makes AT announce every error twice (once per field, once in the envelope); or the inline path replaces the envelope and loses the summary.
**How to avoid:** Only `WizardErrorEnvelope` is `role="alert"` (the summary). Per-field messages are surfaced through `Field`'s `aria-invalid`+`aria-describedby` (announced when focus lands on the field), NOT `role="alert"`. Keep the envelope as the summary; the inline path is ADDITIVE.
**Warning signs:** axe reports duplicate alert regions; the envelope disappears after the inline migration.

### Pitfall 7: Admin reflow can't be proven via the seeded allocator e2e path
**What goes wrong:** The plan assumes admin routes are covered by `reflow-sweep-authed.spec.ts` — they are NOT.
**Why it happens:** `seedTestAllocator` stamps `role='allocator'`; `admin/page.tsx` redirects a non-admin to `/discovery/crypto-sma`. Anchoring an admin route in the allocator-seeded sweep measures a redirected page (false-green). The spec explicitly EXCLUDES admin for this reason (`reflow-sweep-authed.spec.ts:26-28`).
**How to avoid:** Prove admin responsiveness via **component-level Vitest** assertions (the `@container` parent/child structure + `tabular-nums`) + the per-surface DESIGN.md-conformance check, NOT the seeded e2e sweep. If an admin e2e reflow row is wanted, it needs an ADMIN seed (role=both + is_admin), which is a Phase-54 hermetic-seed concern — out of scope here. Document the gap.
**Warning signs:** A planned `reflow-sweep-authed` admin row passes trivially (it's hitting the discovery redirect).

### Pitfall 8: Breaking the route-contract guard or PUBLIC_ROUTES on a touched route
**What goes wrong:** A restyle that moves a route, or a new page route without a manifest class, red-CIs the route-contract guard (#512 regression class).
**How to avoid:** **VERIFIED — Phase 53 adds NO page routes.** New `loading.tsx`/`error.tsx` are not `page.tsx`, so `findRouteFiles` (scans only `page.tsx`) ignores them → no manifest entry needed. /security, /demo, /for-quants, /legal are ALREADY in `PUBLIC_ROUTES` (proxy.ts:17). Don't move any route; if you ever do, add the manifest class + `PUBLIC_ROUTES` entry in lockstep.
**Warning signs:** `npm run lint` fails with "STALE: manifest entry…" or "public route absent from PUBLIC_ROUTES".

## Code Examples

### Per-surface eslint ratchet (extend the Phase-52 block)
```js
// Source: eslint.config.mjs:93-151 (in-repo) — the Phase-52 strangler block.
// The comment at :104-106 explicitly names "Phase-53 surfaces
// (portfolios/security/admin/wizard)" as the next per-surface ratchet targets.
// After a surface's raw text-[Npx] → --text-* migration is grep-proven clean,
// ADD its glob to the existing `files:` array (repo-wide stays `warn`):
{
  files: [
    /* …existing Phase-52 globs… */
    "src/app/(marketing)/security/**",          // after migration grep-clean
    "src/app/(dashboard)/portfolios/**",        // 0 raw-px today (page tree) — verify components/portfolio/ too
    "src/app/(dashboard)/admin/**",             // after migration (admin pages 15 raw-px)
    "src/app/(dashboard)/strategies/new/**",    // wizard (22 raw-px across 6 step files)
    // components/admin/** (66 raw-px) + components/portfolio/** (28) migrate WITH their surfaces
  ],
  rules: { "quantalyze/no-raw-font-px": "error" },
}
```
`[VERIFIED: eslint.config.mjs:104-106 names the Phase-53 surfaces as the strangler targets; raw-px counts from grep on this machine]`

### Add the missing route files without touching the island (admin)
```tsx
// src/app/(dashboard)/admin/loading.tsx — NEW, RSC, no "use client"
// A SHARED admin/loading.tsx + admin/error.tsx covers most sub-pages; add a
// per-sub-page loading.tsx ONLY where the layout differs enough to warrant a
// match-layout skeleton (53-UI-SPEC: generic acceptable for admin internal pages).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@tailwindcss/container-queries` plugin (v3) | `@container` built into Tailwind core | Tailwind v4 | No plugin install; `@container`/`@max-*`/`@min-[Npx]` out of the box `[VERIFIED: v4.3.1, plugin absent]` |
| `error.tsx` `reset()` prop | `error.tsx` `unstable_retry()` (re-fetches + re-renders) | Next 16.2.0 | New error files use `unstable_retry`; `reset` only for clear-without-refetch. Existing dashboard/strategy `error.tsx` already migrated. `[CITED: error.md Props]` |
| `loading.tsx` alone | `loading.tsx` + optional `unstable_instant` route export | Next 16 | A NEW `unstable_instant` export from the route makes client navs instant; `loading.js` "does not guarantee instant client-side navigations" on its own. Optional — not required for STATE-05, but available if a touched route wants instant nav. `[CITED: loading.md AI-agent hint + instant-navigation guide]` |
| Viewport breakpoints (`md:`/`lg:`) for component layout | CSS container queries (`@container`) | this phase (TYPE-04) | Components respond to their OWN width, not the viewport |
| `max-w-7xl` (1280) on admin/portfolios | Fluid-fill → 1920 via `DashboardChrome.isWide` | this phase (APPLY-04) | Institutional density on ultra-wide for data surfaces; prose/form stay narrow |
| Wizard validation only in the top envelope | Inline per-field (blur+submit) via `Field` + the envelope as summary | this phase (APPLY-02) | Manager sees the error AT the field; the `Field` a11y wiring already exists |

**Deprecated/outdated:**
- `@tailwindcss/container-queries` plugin — do not install; v4 core supersedes it.
- `error.tsx` `reset` as the primary recovery — superseded by `unstable_retry` (Next 16.2.0).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Admin sub-pages can share one `admin/loading.tsx` + `admin/error.tsx` for most cases; per-sub-page files only where layout differs | Route-State Matrix / Pattern 2 | LOW — 53-UI-SPEC explicitly says "a shared `admin/loading.tsx` + `admin/error.tsx` covers most; add per-page only where the layout differs." Per-page is cheap to add if a shared skeleton reads wrong. |
| A2 | The portfolios page tree has 0 raw `text-[Npx]` but `components/portfolio/**` (28 sites) carries the debt — those components migrate WITH the portfolios surface | eslint ratchet / migration scope | LOW — verified by grep; the portfolios eslint glob can only flip to `error` once the components it renders are also clean, so the ratchet glob must cover `components/portfolio/**` too (or the components migrate first). Decided per-wave in planning. |
| A3 | The `review` step inserts as 5th step on BOTH branches (API: connect→sync→metadata→review→submit; CSV: upload→preview→metadata→review→submit); `STEP_INDEX` + the step arrays + `WizardStepKey` + `validSteps` are the 4 edit sites | Pattern 6 / Runtime State Inventory | LOW — derived from reading `WizardClient.tsx:57-69` (`STEP_INDEX`), `WizardChrome.tsx:13-33` (step arrays), `localStorage.ts:59,302`. Exact label/index per planning, but the edit-site set is verified. |
| A4 | (auth) pages need no new `loading.tsx` (most static/instant) and no migration (0 raw `text-[Npx]`) — conform primitives + fluid type only where present | Per-surface measure / migration scope | LOW — verified 0 raw-px in `(auth)/**`; `(auth)/error.tsx` already exists. 53-CONTEXT marks auth `loading.tsx` as Claude's discretion ("add only where a real async gap exists"). |

## Open Questions (RESOLVED)

1. **Admin ultra-wide e2e proof.**
   - What we know: admin is excluded from `reflow-sweep-authed` (allocator seed → redirect). Component-level `@container`/`tabular-nums` Vitest + the DESIGN.md-conformance check are the in-scope proof.
   - What's unclear: whether the planner wants ANY admin e2e reflow row (needs an admin seed — a Phase-54 hermetic-seed concern).
   - RESOLVED: Prove admin responsiveness via component Vitest + conformance check this phase; defer an admin-seeded e2e reflow row to Phase 54 (VERIFY-*). Document explicitly so it isn't a silent gap.

2. **Marketing body `@container` scope.**
   - What we know: marketing bodies (home feature rows, for-quants cards) are candidates "where card width varies"; the P51 shell is off-limits.
   - What's unclear: which specific marketing body cards genuinely vary in width vs are viewport-level.
   - RESOLVED: Claude's discretion per 53-CONTEXT — migrate only where a card renders at varying width inside a parent; otherwise keep viewport breakpoints. Decide per-card in planning; conform type/no-clip regardless.

3. **Portfolios eslint ratchet coupling.** (see A2)
   - RESOLVED: the portfolios `no-raw-font-px → error` glob must include `components/portfolio/**` (28 raw-px sites) OR migrate those components in the same wave; otherwise the glob can't flip clean. Decide the glob boundary per-wave.

## Environment Availability

> Skipped — no external tools/services/runtimes beyond the already-installed npm stack. CSS/route-file/primitive-migration work. All deps verified present in `node_modules`. No CLI tools, databases, or services introduced.

## Validation Architecture

> `workflow.nyquist_validation: true` — section included. **This milestone favors FALSIFIABLE guards over class-string jsdom tests** after the #551 false-pass lesson (a same-element `@container` host passed a jsdom class-string test but froze the grid 1-wide in a real browser).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 (unit/component, jsdom) + Playwright 1.59 (e2e) |
| Config file | `vitest.config.ts` (coverage thresholds: lines 82 / stmts 80 / fns 74 / branches 72), `playwright.config.ts` |
| Quick run command | `npx vitest run <path>` (per-file) · `npm run lint` (per-surface no-raw-font-px error + route-contract guard) |
| Full suite command | `npm run test` (vitest) · `npm run test:e2e` (playwright) · `npm run test:coverage` (the BLOCKING `frontend-coverage` CI gate) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| APPLY-02 | wizard review step + inline validation; state machine/autosave/POST unchanged | component + behavioral | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx"` + new review-step test | ⚠️ `WizardClient.test.tsx` exists (pin first); **Wave**: add review-step render + inline-validation tests |
| APPLY-02 | wizard zero axe violations (both branches, incl. new review step) | e2e axe | `npx playwright test e2e/wizard-axe.spec.ts` | ✅ exists (api + csv branches); **Wave**: extend to the review step |
| APPLY-03 | /security raw `text-[Npx]` migrated; no-raw-font-px error | lint (source grep) | `npm run lint` (after the surface glob flips to error) | ❌ **Wave**: flip the glob + grep-verify 0 raw-px |
| APPLY-04 | admin/portfolios fluid-fill 1920 via DashboardChrome.isWide | component | `npx vitest run src/components/layout/DashboardChrome.test.tsx` | ✅ exists, currently asserts NOT-widened; **Wave**: flip the admin/portfolios assertions |
| APPLY-04 | admin `@container` parent/child host; `tabular-nums` preserved | component (structural, NOT class-string) | `npx vitest run <admin-table>.test.tsx` | ⚠️ `StrategyTable` precedent; **Wave**: per-new-container parent/child + alignment assertion |
| TYPE-02 | accidental clips fixed, recovery present; no clip relocated | unit + audit diff | `npx vitest run` + truncation-audit cross-check | ❌ **Wave**: per-surface no-clip assertion on the audit sites |
| TYPE-03 | no horizontal scroll 320→2560 (wizard + /security) | e2e reflow | `npx playwright test e2e/reflow-sweep-authed.spec.ts` | ✅ wizard (api+csv) + /security rows present @320; 2560 row present for allocator surfaces. **NOTE**: admin EXCLUDED (Pitfall 7) |
| STATE-05 | route `loading.tsx`/`error.tsx` present & render; digest-only; sr-only liveness | component | `npx vitest run src/app/.../{loading,error}.test.tsx` | ⚠️ `strategy/[id]/v2/error.test.tsx` precedent; **Wave**: tests for new files |
| STATE-05 | honest degenerate states (no invented data) | component | `npx vitest run` (extend existing empty-branch tests) | ✅ `EmptyStateCard` exists; **Wave**: extend admin/portfolios empty branches |
| BP-02 | no frozen island RSC-ified; scenario.ts/compute.ts/EquityChart zero-diff | git-delta guard | `npx vitest run src/__tests__/phase-52-frozen-spine-guards.test.ts` | ✅ EXISTS (freezes the math islands — none touched here; this guard is sufficient for the math) |
| BP-02 | route-contract guard + PUBLIC_ROUTES green for touched routes | lint | `npm run lint` (chains `scripts/check-route-contract.ts`) | ✅ exists; new loading/error add no page route (Pitfall 8) |
| BP-02 | coverage ratchet green | coverage | `npm run test:coverage` | ✅ the blocking gate; new files MUST carry tests in-change |

### Sampling Rate
- **Per task commit:** `npm run lint` (no-raw-font-px on the migrated glob + route-contract guard) + `npx vitest run <touched file>.test.tsx`
- **Per wave (surface) merge:** `npx vitest run` (full unit) + the surface's `npx playwright test e2e/<surface>-axe.spec.ts e2e/reflow-sweep-authed.spec.ts` + `phase-52-frozen-spine-guards.test.ts` (math islands untouched)
- **Phase gate:** full `npm run test` + `npm run test:e2e` + `npm run test:coverage` green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `WizardClient` behavioral guard PINNED first — `WizardClient.test.tsx` (transitions/autosave) + `finalize-wizard/route.test.ts` (POST body) + `localStorage.test.ts` (step-enum validation) must be green BEFORE the wizard migration, and stay green after the review-step insertion. (No new git-delta guard — Phase 53 deliberately edits WizardClient.)
- [ ] Per-new-`loading.tsx`/`error.tsx` render test (model `strategy/[id]/v2/error.test.tsx`) — coverage gate + STATE-05 proof; assert `role="status"` liveness + the dominant-anchor structure + (error) `unstable_retry` invoked + digest-only (never `error.message`).
- [ ] Per-new-`@container` STRUCTURAL test asserting the host and `@`-variants are parent/child (NOT same-element) + `tabular-nums` preserved — falsifiable, not a class-string jsdom check (the #551 lesson).
- [ ] Wizard review-step test: recap shows ONLY entered values (no fabricated data), each "Edit" returns to the owning step, review step is NOT `role="alert"`, final CTA verb unchanged.
- [ ] Wizard inline-validation test: blur+submit surfaces the `wizardErrors.ts` string through `Field` (`aria-invalid`+`aria-describedby`), per-field NOT `role="alert"`, envelope stays the summary, submit focuses the first invalid field.
- [ ] `DashboardChrome.test.tsx` updated: admin/portfolios assert `max-w-[1920px]`; the not-widened assertions retargeted to a still-narrow route.
- [ ] Per-surface no-clip assertion that the audit's accidental-clip sites for that surface now carry `title=`/wrap (the app-wide no-clip CI guard is Phase 54; a scoped check is cheap now).
- [ ] Framework install: none — Vitest + Playwright already configured.

*(No new test framework needed. Note: admin ultra-wide e2e is NOT achievable via the allocator seed — Pitfall 7 — prove via component Vitest + conformance check.)*

## Security Domain

> `security_enforcement` not set to `false` → included. Presentation-layer phase; the security surface is narrow but several ASVS categories apply (the admin surface is the highest-sensitivity one).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Auth unchanged; pages already `redirect("/login")` on no-user (admin/portfolios/wizard). No auth logic touched. |
| V3 Session Management | no | No session/cookie changes. The wizard's existing `onAuthStateChange` SIGNED_OUT handling stays (do not disturb during migration). |
| V4 Access Control | **yes (preserve)** | admin pages: `if (!user) redirect("/login")` THEN `if (!isAdminUser()) redirect("/discovery/crypto-sma")`. portfolios/wizard: `redirect("/login")`. The conformance work MUST NOT remove an access gate while restyling. The route-contract guard's `admin` class + `PUBLIC_ROUTES` lockstep enforces this at lint. RLS/SECDEF unchanged. |
| V5 Input Validation | **yes (minimal)** | The wizard inline validation SURFACES existing `wizardErrors.ts` validation — it does NOT replace server-side validation. `Field` deliberately does NOT validate (ASVS V5 posture). The finalize-wizard POST validation is unchanged. No new inputs. |
| V6 Cryptography | no | None. The wizard localStorage HMAC envelope (`saveWizardState`/`loadWizardState`) is unchanged. |
| V7 Error Handling / Info Leakage | **yes** | Every new `error.tsx` must render `digest` ONLY, never `error.message` — Next forwards a generic message + digest from Server Components by design. Mirror the existing dashboard/strategy `error.tsx`. |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Server error message leaked in a new `error.tsx` | Information Disclosure | Show `digest` only; Next strips RSC error messages in production. Mirror `(dashboard)/error.tsx`. `[CITED: error.md]` |
| `title={fullText}` on a no-clip fix exposing data the visibility gate hides | Information Disclosure | Apply `title=` only to data ALREADY rendered (the clipped string) — never pull an un-gated field into a `title`. The admin partner-pilot email (`:170`) is already rendered to the admin; `title=` is safe there. |
| Removing an admin/auth access gate during a restyle | Elevation of Privilege | Keep `redirect("/login")` + `isAdminUser()` + the `admin` route-contract class exactly; access gates are not part of the visual layer. |
| Wizard inline validation weakening server-side validation | Tampering | Inline validation is presentation-only; the finalize POST validation stays authoritative. Never gate the POST on the client-only inline state alone. |

No new attack surface (no new endpoints, inputs, secrets, or data flows). The v1.3 WCAG-AA floor is a hard constraint (accessibility, tracked via the axe specs).

## Sources

### Primary (HIGH confidence)
- `52-RESEARCH.md` + `52-PATTERNS.md` — the direct precedent; techniques reused verbatim (route-state files, `@container`, fluid-fill, no-clip, eslint ratchet, frozen-spine guard pattern)
- In-repo verified code: `src/components/layout/DashboardChrome.tsx` (`isWide` line 72) + `DashboardChrome.test.tsx` (Phase-53 not-yet-widened assertions); `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` (state machine, `STEP_INDEX`), `WizardChrome.tsx` (step arrays); `src/lib/wizard/localStorage.ts` (`WizardStepKey`, `validSteps`); `src/components/ui/Field.tsx` (a11y wiring), `Skeleton.tsx`, `EmptyStateCard.tsx`; `src/app/factsheet/[id]/v2/loading.tsx` (skeleton bar); `src/app/strategy/[id]/error.tsx` (`unstable_retry` shape); `src/components/strategy/StrategyTable.tsx` + `ResponsiveTable.tsx` (`@container` idiom); `eslint.config.mjs:93-151` (Phase-52 ratchet block naming the Phase-53 surfaces); `scripts/check-route-contract.ts` + `src/lib/routing/route-contract-manifest.ts` (scans only `page.tsx`); `src/proxy.ts:17` (`PUBLIC_ROUTES` already includes /security,/demo,/for-quants,/legal); `e2e/reflow-sweep-authed.spec.ts` (wizard + /security rows; admin EXCLUDED; 2560 row); `src/__tests__/phase-52-frozen-spine-guards.test.ts` (freezes the math islands)
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md` — `unstable_retry` Props + RSC message-stripping
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md` — layout-data caveat + the new `unstable_instant` instant-nav export
- `.planning/audits/truncation-audit.md` — TYPE-02 classification SoT (the Phase-53 surface clip sites)
- DESIGN.md — fluid `--text-*` spine (Phase-49 entry), Phase-52 per-surface entry (the parent/child `@container` host rule), 4px ladder + exceptions, accent reserved-for list
- `node_modules/*/package.json` + `package.json` — version verification (next 16.2.9, react 19.2.7, tailwindcss 4.3.1, vitest 4.1.2, @vitest/coverage-v8 4.1.9, @radix-ui/react-tabs 1.1.15; container-queries plugin + radix-ui meta absent)
- `53-CONTEXT.md` + `53-UI-SPEC.md` — locked decisions + design contract; `.planning/REQUIREMENTS.md` (APPLY-02/03/04, STATE-05, BP-02 bodies)
- `.planning/codebase/CONVENTIONS.md` + `TESTING.md` — TS strict, `@/*` alias, co-located tests, Vitest 4.1.2 / Playwright 1.59 / pytest layers

### Secondary (MEDIUM confidence)
- none required — every claim verified against in-repo source or local Next docs

### Tertiary (LOW confidence)
- none — all claims verified or cited

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified on-machine; zero new packages; container queries confirmed in v4 core
- Architecture (route-state, `@container`, fluid-fill): HIGH — every pattern has a working in-repo precedent; Next 16 conventions from local docs
- Wizard UX upgrade: HIGH — state machine + edit sites read directly from `WizardClient.tsx`/`WizardChrome.tsx`/`localStorage.ts`; `Field` a11y wiring confirmed in source
- Pitfalls: HIGH — drawn from in-repo gate tests, the #551 regression record (DESIGN.md + MEMORY), the reflow-spec admin-exclusion comment, and Next/Tailwind doc caveats
- Testing/security: HIGH — coverage gate + guard inventory verified; admin e2e gap (Pitfall 7) verified from the spec's own exclusion comment

**Research date:** 2026-06-29
**Valid until:** 2026-07-29 (stable — pinned local deps; re-verify if Next/Tailwind/Vitest are bumped or the wizard state machine is refactored)

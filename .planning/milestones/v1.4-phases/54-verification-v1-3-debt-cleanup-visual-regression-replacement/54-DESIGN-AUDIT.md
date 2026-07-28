# Phase 54 — App-wide Design-Review Audit (VERIFY-05)

**Ran:** 2026-06-30
**Mode:** STATIC conformance review against the LOCKED `DESIGN.md` contract.
**Why static:** this sandbox has no running app, no browser, and no Bash network — a live
visual / real-device audit is not possible here. The design-review pass therefore reviews the
Phase-54-touched surfaces + the highest-traffic surfaces **as code** against `DESIGN.md`
(QA-mode rule: flag any code that does not match `DESIGN.md`). The real-device authed sign-off
is encoded as a separate `human_needed` checkpoint (see `## Real-device sign-off` below and the
blocking `checkpoint:human-verify` in `54-09-PLAN.md`).

**Reviewer:** fresh-Claude static review (the sole adversarial review mechanism per project
directives — no Grok, no Codex).

---

## Verdict

**PASS.** The v1.4 UI conforms to the locked `DESIGN.md` on every dimension reviewable as code:
type spine (byte-identical fixed tokens + the fluid `--text-*` spine), color tokens, spacing
ladder, anti-decoration rules, the RT-W2 admin width caps, and the WCAG-AA floor. No fix-now
conformance violation was found on the Phase-54-touched surfaces. Two larger, pre-existing items
are logged as debt (not silently dropped). The real-device authed sign-off remains a documented
`human_needed` checkpoint, consistent with prior milestones' deferred authed UATs.

| Finding count | |
|---|---|
| Fix-now (folded this plan) | **0** |
| Logged as debt (pointer recorded) | **2** |
| Accepted-as-conformant (verified, no action) | **6** |
| Blocking | **0** |

---

## Scope reviewed

Phase-54-touched surfaces + the highest-traffic surfaces, as code:

- **Allocator journey** — `/allocations` + tabs (`AllocationsTabs`, `HoldingsTabPanel`,
  `RiskTabPanel`, `OutcomesTabPanel`, the EquityChart + widget grid).
- **Factsheet** — `factsheet/[id]/v2/**` (FactsheetView, AnalyticalPanels, the frozen SVG charts).
- **Admin** — incl. the new RT-W2 caps (`partner-import`, `users`, `users/[id]`,
  `for-quants-leads`) + the data tables (`partner-roi`, the match queue tables).
- **Wizard** — `strategies/new/**` (migrated to the `--text-*` tiers in 53-02).
- **Public / marketing** — `(marketing)/**` (`/security`, landing, `/demo`, legal, for-quants).
- **Portfolios** — `portfolios/**` + `components/portfolio/**`.
- The token spine: `globals.css` `@theme` block + `src/lib/design-tokens/**`.

---

## Findings & dispositions

### F1 — Type spine: byte-identical, no visible size change — **ACCEPT (conformant)**
- **Severity:** n/a (verification, not a defect).
- The Phase-49 fluid `--text-*` spine (`globals.css:136–143`, plain `@theme`) maps the
  `DESIGN.md` px scale 1:1, and the Phase-54 fixed-token aliases (`--text-fixed-9…32`,
  `globals.css:159–168`) are documented byte-identical to their `text-[Npx]` predecessors
  (e.g. `--text-fixed-12: 0.75rem; /* = 12px @16px root */`). The px→token migration was a
  **value-preserving substitution**, not a re-sizing — confirmed by the three-way drift gate
  (`tests/a11y/design-token-drift.test.ts`) and the clamp-shape invariants
  (`tests/visual/fluid-type-tokens.test.ts`), both GREEN this run (57 guard tests pass).
- **Disposition:** conformant. No action.

### F2 — Fonts: DM Sans / Instrument Serif / Geist Mono only — **ACCEPT (conformant)**
- `src/app/layout.tsx:5` imports exactly `DM_Sans`, `Instrument_Serif`, `Geist_Mono` via
  `next/font/google`. No Inter / Roboto as primary anywhere (anti-pattern §"Inter, Roboto, or
  any overused font as primary"). The `globals.css` font-family rules resolve to
  `var(--font-sans|serif|mono)`. Conformant.

### F3 — Anti-decoration: no decorative gradients / blobs / parallax / motion-libs — **ACCEPT (conformant)**
- A repo-wide scan for `bg-gradient`, `radial-gradient`, `linear-gradient`, `framer-motion`,
  `react-spring`, `gsap` returns **5** matches, every one legitimate and **not** decoration:
  - `BridgeWidget.tsx` (×2) — `linear-gradient` on the documented Bridge cream/peach surface
    family (`DESIGN.md` "Bridge bg-50 / bg-100 / border" — an explicitly blessed designer-bundle
    visual signature, the one sanctioned exception to the white-card default).
  - `CorrelationMatrix.tsx:231` — `linear-gradient(red→white→teal)` is a **data-encoding heatmap
    legend** (the correlation scale), not background decoration.
  - `globals.css:355` — the `.mandate-slider` **rail fill** (accent→border progress encoding),
    functional UI, not decoration.
- All `animate-pulse` / `animate-spin` usages are loading skeletons / in-flight spinners
  (functional motion). `DESIGN.md` Motion allows functional transitions and bans only
  *decorative* animation ("no bouncing, no spinning logos, no scroll-triggered effects"); the
  `animate-pulse` skeletons additionally respect `prefers-reduced-motion` (`globals.css:172–179`).
  No purple/violet gradient, no decorative blob, no parallax, no icon-in-colored-circle grid.
- **Disposition:** conformant. No action.

### F4 — Color tokens: restrained palette, `--color-*` convention, AA-shifted semantics — **ACCEPT (conformant)**
- The semantic palette is the `DESIGN.md` set: accent `#1B6B5A`, the AA-shifted
  positive `#15803D` / negative `#DC2626` / warning `#B45309`, and the AA-shifted
  muted `#64748B`. The 2026-05-06 `--color-*`-prefix convention holds on the reviewed surfaces
  (token consumption goes through `var(--color-*)`). Pinned by `tests/a11y/*-contrast.test.ts`
  and `trust-tier-tokens.test.ts`. Conformant.

### F5 — RT-W2 admin width caps render correctly — **ACCEPT (confirmed)**
- The 4 prose/form admin pages (`partner-import`, `users`, `users/[id]`, `for-quants-leads`)
  carry an inner `mx-auto max-w-[1100px]` cap — exactly the `DESIGN.md` "Layout → Max content
  width: 1100px (main content area)" measure. The `DashboardChrome.isWide` regex
  (`/^\/(allocations|compare|discovery|admin|portfolios)(\/|$)/`, `DashboardChrome.tsx:77`) is
  left intact so the admin **data** tables keep the wide 1920px measure, while the prose/form
  pages no longer over-stretch past 1100px.
- Cross-checked against the static gate `src/__tests__/admin-width.test.tsx` (bidirectional:
  the cap is present on each of the 4 in-scope files, exactly once; the contrast data page
  `partner-roi` does NOT carry it). **GREEN this run.** ROADMAP success criterion 5 satisfied.

### F6 — WCAG-AA floor: PROVEN by the re-enabled axe rows — **ACCEPT (confirmed by evidence, not asserted blind)**
- This plan is serialized after 54-08, which re-enabled the authed + mobile axe rows against the
  hermetic seeded MA-8 DB (`axe-app-wide.spec.ts` now runs in BOTH the unseeded public list and
  the seeded MA-8 list; `playwright --list` enumerates 30 rows across Desktop + mobile + 2560px
  ultra-wide). The WCAG-AA floor claim below is therefore **backed by the green authed/mobile
  axe CI run**, not asserted without evidence. The locked a11y deltas from prior phases (inline
  prose-link persistent underline, WCAG 1.4.1) are intact.
- **Disposition:** conformant; the floor is proven by CI, not by this static read alone.

### F7 — `@container` host/child separation (the P52 CRITICAL reflow bug class) — **ACCEPT (guarded)**
- The Phase-52 ship red-team caught a CRITICAL Tailwind-v4 bug: a same-element `@container` host
  + `@`-variant freezes the grid 1-wide. A regression guard exists
  (`src/__tests__/phase-52-container-tabular-nums.test.tsx`) and is **GREEN this run** (5 tests).
  The `@container` rollout (FactsheetView, AnalyticalPanels, KpiStrip, ResponsiveTable, the admin
  tables) keeps the host on a separate ancestor from the `@sm:`/`@lg:` grid-column variants.
- **Disposition:** conformant; guarded.

### F8 — Pre-existing "coming soon" states on `/allocations` — **LOG AS DEBT (intentional v1 stubs, NOT a Phase-54 regression)**
- **Severity:** low / informational.
- Two surfaces carry "coming soon" copy: `ScenarioStub.tsx:56` ("Scenario builder coming soon")
  and `OutcomeForm.tsx:43` ("Modified (coming soon)" — a deliberately `disabled` + `aria-disabled`
  segmented-control option with an explanatory `title`, the documented "intended capability
  without a silent gap" pattern).
- **Why not a defect:** both are pre-existing, deliberate v1 states last touched in Phase 09/09.1
  (`git log` confirms — well before Phase 54). `ScenarioStub` is the v1-fallback for the
  V2-flag-gated scenario tab; the real scenario builder ships behind `strategy.ui_v2`. Neither is
  in Phase-54 scope and neither was introduced/altered by the px→token migration.
- **Disposition:** **log as debt**, do not fold (out of Phase-54 scope; intentional product
  states, not conformance violations). Pointer: `ScenarioStub.tsx` + `OutcomeForm.tsx`; tracked
  as the V2 scenario-tab rollout, not a design-audit fix.

### F9 — Raw `font-size: Npx` in plain CSS rules in `globals.css` — **LOG AS DEBT (out of lint scope, on-scale, low value)**
- **Severity:** very low / cosmetic.
- `globals.css` has a handful of raw `font-size: Npx` declarations in **plain CSS** rules
  (density mode `13px` @line 216, the skip-link + print rules `12px` @lines 474/508, `.prose-note`
  `12/13px` @lines 440/443). These are **outside** the `no-raw-font-px` lint surface — that rule
  targets JSX `text-[Npx]` / `fontSize:'Npx'`, not raw CSS `font-size:` declarations — and BP-03's
  literal text is the JSX/className surface. Every value is on the canonical `DESIGN.md` px scale
  (12px = caption tier, 13px = small tier), so there is **no visual drift**, only a
  not-tokenized-in-CSS cosmetic gap.
- **Disposition:** **log as debt** (a future CSS-token pass could swap these for
  `var(--text-caption)` / `var(--text-small)`). NOT folded: it is out of BP-03's scope (CSS, not
  JSX), zero visual impact, and folding raw-CSS-to-var across density/print/skip-link contexts
  carries reflow risk that exceeds the cosmetic gain — out of scope for an audit fold (CLAUDE.md
  Rule 3 / scope boundary). Pointer: `src/app/globals.css` lines 216, 440, 443, 474, 508.

---

## Locked-invariant confirmation (all proven green this run)

| Invariant | Gate | Status |
|---|---|---|
| Frozen client islands (scenario.ts, compute.ts, EquityChart, the 4 frozen-spine files) zero-diff | `src/__tests__/phase-52-frozen-spine-guards.test.ts` | GREEN |
| RT-W2 admin width caps present (in-scope) + data page wide (out-of-scope) | `src/__tests__/admin-width.test.tsx` | GREEN |
| Three-way type-token drift (DESIGN.md ↔ `@theme` ↔ TS mirror) | `tests/a11y/design-token-drift.test.ts` | GREEN |
| Fluid `clamp()` shape invariants (rem middle term, max ≤ 2.5× min) | `tests/visual/fluid-type-tokens.test.ts` | GREEN |
| `@container` host/child separation (P52 reflow bug class) | `src/__tests__/phase-52-container-tabular-nums.test.tsx` | GREEN |
| `no-raw-font-px` error repo-wide (0 errors) | `npx eslint "src/**/*.{ts,tsx}"` | EXIT 0 (0 errors, 31 pre-existing unrelated warnings) |
| WCAG-AA floor (authed + mobile + 2560 axe) | 54-08 seeded MA-8 axe rows (CI) | re-enabled + green (30 rows) |

No code was changed by this audit, so the gates above were already green and stay green.

---

## Real-device sign-off — `human_needed` (NOT attempted)

The VERIFY-05 real-device authed sign-off CANNOT run in this sandbox (no physical device, no
Bash network). It is encoded as a blocking `checkpoint:human-verify` in `54-09-PLAN.md` and
carried as the milestone's `human_needed` verification item. Human instructions:

> On a physical phone and/or tablet, with a real authed session
> (`qa-demo@quantalyze.app` on prod, or a seeded test user):
> 1. Load the authed surfaces: `/allocations` + `?tab=scenario` / `?tab=risk`, `/compare`,
>    `/discovery`, `/portfolios`, the `/admin` prose + data pages, and the wizard.
> 2. At each, confirm: no horizontal overflow/reflow; no clipped/ellipsis-truncated content that
>    should be visible; the prose/form admin pages no longer over-stretch (RT-W2); type/spacing
>    match `DESIGN.md`; no a11y regressions (focus order, contrast, touch targets).
> 3. The deferred golden PNG bake is a SEPARATE deliberate per-chart CI commit
>    (never blind `--update-snapshots`) — NOT part of this sign-off.
> 4. Record device / OS / surfaces checked / any findings so `VERIFICATION.md` can carry it as
>    the `human_needed` item.

This is consistent with prior milestones' deferred post-deploy authed UATs (v1.2.1 / v1.2.2 /
v1.3) — a deferred-by-construction human checkpoint, not a code gap. The design-review portion of
VERIFY-05 (this document) is **done**; the real-device portion is **human_needed**.

# Pitfalls Research

**Domain:** Presentation-layer overhaul (fluid typography + design-token evolution + IA/routing restructure + React 19/Next 16 refactor) of a mature, CI-gated, RLS-protected Next.js 16 financial dashboard
**Researched:** 2026-06-28
**Confidence:** HIGH (codebase-verified gates + W3C-authoritative WCAG techniques; MEDIUM only where noted)

> Scope note for the roadmapper: these are pitfalls of **changing a gated mature codebase**, not greenfield advice. Every one is anchored to a concrete guardrail that already exists in this repo (`e2e/axe-app-wide.spec.ts`, `e2e/reflow-sweep*.spec.ts`, `e2e/target-size.spec.ts`, the `frontend-coverage` CI gate, the `phase-NN-frozen-spine-guards.test.ts` family, `src/proxy.ts` PUBLIC_ROUTES, `next/font` in `src/app/layout.tsx`, the `@theme inline` block in `src/app/globals.css`). Phase numbering continues from 48 → **Phase 49+**.

---

## The single biggest structural risk (read first)

**v1.3's safety net was "desktop byte-identity."** Three things relied on it:
1. The `phase-NN-frozen-spine-guards.test.ts` zero-diff guard proved the *engine* didn't move, but desktop pixels not moving is what let reviewers trust that a responsive change didn't quietly alter desktop.
2. The existing pixel-golden specs — `e2e/svg-chart-parity.spec.ts` (16 SVG charts, ±2% panel / ±5% full-page) and `e2e/strategy-v2-chart-parity.spec.ts` (7 factsheet panels, same tolerances) — are **byte-identity assertions baked into goldens**. v1.4 *intends* to change visuals, so every one of these will go red on legitimate design changes. If they are blindly re-baselined (`--update-snapshots`) they silently lose all regression value; if they are left red CI is permanently broken.

**v1.4 removes that net and must replace it, not just delete it.** The replacement is the central process decision of this milestone — see Pitfall 11. The recommendation below is: keep chart-parity goldens as a *math/data-render* check (re-baseline once, deliberately, per chart at the phase that touches it, with the diff reviewed) **and** add a thin set of new full-page visual-regression goldens captured *after* the design system stabilizes, owned by the final verification phase — so "did this PR change a surface I didn't mean to touch?" still has an answer.

---

## Critical Pitfalls

### Pitfall 1: clamp() fluid type that fails WCAG 1.4.4 Resize-Text (viewport-unit lock-in)

**What goes wrong:**
Fluid type written as `clamp(min, Xvw + Yrem, max)` with an aggressive scale (large hero → small caption disparity) can become un-zoomable: a user zooms to 200% but the heading does not grow because the `vw` term dominates and viewport units do not respond to browser zoom. This is W3C failure **F94** ("incorrect use of viewport units to resize text"). The app's own guard (`tests/visual/viewport-zoom-meta.test.ts`) only catches a `maximum-scale`/`user-scalable=no` *meta* lockout — it does **not** catch a `vw`-dominated clamp that defeats zoom while the meta tag stays permissive. So this passes the existing zoom guard and still fails 1.4.4.

**Why it happens:**
Engineers reach for `vw` because it's the obvious "scale with screen" unit. The interaction between `vw` and zoom (zoom changes `rem` but not `vw`) is non-obvious and not surfaced by any DOM rule axe can run.

**How to avoid:**
- Every clamp MUST include a `rem`-based term in the preferred (middle) value so the text still scales under zoom: `clamp(1rem, 0.5rem + 2vw, 2rem)` — never `clamp(1rem, 4vw, 2rem)`. The min and max bounds must be in `rem` (never `px`), and a heading must be able to reach ≥200% of its rendered size at 320px CSS width.
- Add a **new** automated guard (extend `tests/visual/viewport-zoom-meta.test.ts` or add a sibling) that greps for `clamp(` patterns containing a `vw`/`vi` term with **no** `rem` companion in the middle value, and fail loud. This is the missing rule the current zoom guard does not cover.
- Generate scales with a tool that emits WCAG-safe clamps (Utopia, which warns on 1.4.4 risk) rather than hand-rolling ratios.

**Warning signs:**
Heading appears not to grow on Ctrl-+ zoom; QA at 200% browser zoom on a 1280 viewport shows captions readable but H1 frozen; `vw` appearing as the *only* dynamic term in a clamp.

**Phase to address:** **Phase 49 (design-token + fluid-type foundation)** — establish the clamp convention + the new lint guard as the *first* thing, before any surface adopts it. Verified again app-wide in the **final verification phase**.

---

### Pitfall 2: Losing readable minimums and blowing up line-length at the extremes

**What goes wrong:**
Two-sided failure of fluid type: (a) body text drops below the readable floor on small phones (e.g. 12px caption tier — already at the edge — becomes 10px under a too-low clamp min), regressing legibility the v1.3 320px work fought for; (b) on ultra-wide (the milestone explicitly says "small → ultra-wide"), unconstrained measure means a Bloomberg-dense table or prose column stretches to 200+ characters — unreadable, and a *visual* regression even though nothing "breaks."

**Why it happens:**
Fluid scales optimize the *transition*; the **bounds** are an afterthought. Ultra-wide is rarely tested because dev monitors max out around 1440–1920 and the repo's max-content-width (`1100px`, per DESIGN.md) was the de-facto cap that fluid layout may loosen.

**How to avoid:**
- Pin a hard minimum readable size in the type tokens: body floor ≥14px-equivalent (`0.875rem`), caption floor ≥12px-equivalent — DESIGN.md already treats 12px as the smallest contrast-validated tier (chart ticks, badges), so the clamp min must never go under it.
- Keep a `max-content-width` / `max-inline-size` constraint on prose and re-derive it as a token (DESIGN.md's 1100px main-content cap) so ultra-wide widens *gutters*, not *measure*. Use `ch`-based `max-inline-size` (~70–75ch) for prose blocks.
- Add ultra-wide (e.g. 2560px) to the reflow/axe viewport matrix so "holds at ultra-wide" is *tested*, not asserted (`e2e/axe-app-wide.spec.ts` currently runs Desktop 1280 + mobile 375 only — add a wide row).

**Warning signs:**
Caption tier rendering <12px at 320px; tables/prose with no `max-width` at 2560px; reviewers eyeballing only at 1280–1440.

**Phase to address:** **Phase 49** (set min/max token floors + measure caps); **final verification phase** (add the ultra-wide viewport row to the gate matrix and prove it).

---

### Pitfall 3: Breaking *intentional* truncation / tabular-number alignment in financial tables

**What goes wrong:**
The "zero truncation/ellipsis/cut-off" requirement is a trap when applied indiscriminately. This app has **96 files** using `truncate`/`line-clamp`/`overflow-hidden`/`whitespace-nowrap` and **115 files** using `tabular-nums`/`font-mono`. Some truncation is *intentional and load-bearing* (a long strategy name in a fixed table column that must keep numeric columns aligned; a `ResponsiveTable` cell that ellipsizes to avoid horizontal scroll at 320px — the exact thing v1.3 built). Globally removing `truncate`/`whitespace-nowrap` will: (a) reintroduce horizontal overflow at 320px → **fails `e2e/reflow-sweep*.spec.ts`**; (b) wrap numbers in a Geist-Mono tabular column so digits no longer align → a financial-data integrity *look* failure and a DESIGN.md violation ("all numbers use Geist Mono tabular-nums").

**Why it happens:**
"No clipping" is read as "delete every ellipsis." The distinction between *clipping that hides data* (bad) and *truncation-with-affordance / responsive ellipsis* (often correct) is lost. Numeric columns silently lose alignment because wrapping a `tabular-nums` cell defeats the whole point of tabular figures.

**How to avoid:**
- Reframe the requirement as **"no data is unrecoverable"**, not "no ellipsis exists." A truncated strategy name is fine *if* the full value is reachable (title attr / tooltip / detail view / wrap on tap). Audit each of the 96 truncation sites against: is the full value reachable? Does removing it cause 320px overflow?
- **Never wrap a numeric/tabular-nums cell.** Numbers stay `whitespace-nowrap`; only label/name columns may wrap. Keep numbers right-aligned + `tabular-nums` (DESIGN.md contract) so columns align.
- Run the existing `e2e/reflow-sweep.spec.ts` + `reflow-sweep-authed.spec.ts` after every truncation change — they will catch the 320px overflow regression a global ellipsis-removal causes.

**Warning signs:**
A bulk find-replace removing `truncate`/`whitespace-nowrap`; numeric columns where decimal points no longer line up; reflow sweep going red on a table route.

**Phase to address:** **Phase that does the typography/layout fluidity rollout** (per-surface, e.g. allocator-journey and tables phase) — handle truncation case-by-case, not globally. Verified by the **existing reflow sweep gates** which must stay green.

---

### Pitfall 4: Layout shift (CLS) from fluid type + font-loading regressions with next/font

**What goes wrong:**
(a) Fluid type that recomputes line-box heights at breakpoints, plus newly-introduced motion, can spike Cumulative Layout Shift — which the `@lhci/cli` mobile budget (added in v1.3 Phase 48, currently seeded at 0.60) measures. The milestone *also* wants to ratchet that budget UP, so a CLS regression here both fails the gate and blocks the ratchet. (b) `next/font` (3 Google fonts in `src/app/layout.tsx`: DM Sans, Instrument Serif, Geist Mono via CSS variables) is currently configured without an explicit `display`/fallback-metric story; touching the font setup during a "best-practices refactor" can reintroduce FOUT/FOIT or a fallback-metric mismatch that shifts layout when the web font swaps in — especially with the new larger Instrument Serif hero sizes.

**Why it happens:**
Fluid type makes box sizes resolution-dependent, so any font-metric mismatch is amplified. `next/font` already does size-adjust fallback metrics automatically, but a refactor that switches a font to `localFont`, changes `subsets`, or removes the `variable` wiring can silently disable that.

**How to avoid:**
- Reserve space for above-the-fold text and charts (min-heights on chart frames already exist via `ResponsiveChartFrame` — keep them); avoid `clamp()` on properties that change *block* height unpredictably.
- Treat `src/app/layout.tsx`'s `next/font` block as near-frozen: do not change `subsets`, the `variable` names (consumed by `@theme inline` `--font-*`), or drop the auto fallback metrics. If a font's `display` is set, keep `swap` and keep the matched fallback. Adding a font weight/style is fine; rewiring the loader is high-risk.
- Watch the lhci CLS sub-metric specifically, not just the perf score, before attempting the budget ratchet.

**Warning signs:**
Visible reflow when fonts swap in; lhci CLS climbing; a diff touching `next/font` import shape, `subsets`, or the `--font-*` variable wiring.

**Phase to address:** **Phase 49** (lock the font + token contract; do not rewire `next/font`); **final verification phase** (lhci CLS check before the budget ratchet).

---

### Pitfall 5: Uncontrolled visual drift + half-migrated surfaces ("the app looks like two apps")

**What goes wrong:**
An app-wide aesthetic evolution applied surface-by-surface leaves the app in a state where `/allocations` uses the new system while `/admin` or the manager wizard still uses the old one — for weeks. Worse, "drift" within the *new* system: two engineers each invent a slightly different spacing/elevation/heading treatment because the token vocabulary wasn't fixed first. This app already had documented silent token drift (DESIGN.md 2026-05-06: four widgets rendered wrong colors because they used bare `var(--positive)` instead of `var(--color-positive)` under Tailwind v4; three more had 0px corners from undeclared `--radius-*`). A bigger overhaul multiplies that surface.

**Why it happens:**
The design system is evolved *and* rolled out in the same breath, so there is no stable target to conform to. "App-wide conformance" (a stated v1.4 feature) is treated as a side-effect of per-surface work instead of an explicit gated step.

**How to avoid:**
- **Sequence it: tokens first, surfaces second.** Phase 49 lands the *complete* evolved DESIGN.md + the `@theme inline` token set (colors, radii, spacing, the fluid type scale, motion durations) and a token-drift guard *before* any surface is restyled. DESIGN.md is already the contracted single source of truth (CLAUDE.md: "Always read DESIGN.md before any UI decision") — keep that.
- Extend the existing DESIGN.md↔code consistency tests (`tests/a11y/trust-tier-tokens.test.ts` reads DESIGN.md and asserts hexes appear verbatim; `tests/a11y/chart-contrast.test.ts` forbids literal `#94A3B8`/`#718096` text fills) into a broader "no bare `var(--token)` without `--color-`/`--radius-`/`--space-` prefix" lint and a "no raw hex in components" guard — the repo has **172 raw-hex occurrences in `src/components/`** today; a migration is the moment to ratchet that down, and the moment they sneak back if ungated.
- Keep a per-surface conformance checklist (public, allocator journey, manager wizard, /security, admin) as explicit roadmap items with a "conforms to evolved DESIGN.md" exit criterion — don't let conformance be implicit.

**Warning signs:**
Two heading styles for the same semantic level on different routes; a new raw hex in a component diff; bare `var(--foo)` (no `--color-` prefix); a surface shipped without a DESIGN.md-conformance line in its exit criteria.

**Phase to address:** **Phase 49** (lock tokens + drift guards first); **per-surface conformance phases** (each owns its surface's conformance); **final verification phase** (app-wide design-review audit).

---

### Pitfall 6: Regressing the v1.3 axe / reflow / zoom / target-size CI gates

**What goes wrong:**
The whole visual overhaul happens *on top of* CI-blocking WCAG gates: `e2e/axe-app-wide.spec.ts` (route×viewport WCAG-AA matrix), `e2e/reflow-sweep.spec.ts` + `reflow-sweep-authed.spec.ts` (320px = 400%-zoom-equivalent, no horizontal overflow), `e2e/target-size.spec.ts` (≥44px at 320px, WCAG 2.5.8), `tests/visual/viewport-zoom-meta.test.ts` (no zoom lockout). A new visual treatment trivially regresses these: a tighter button to fit the new aesthetic drops below 44px; a denser layout overflows at 320px; a new low-contrast "muted" text color fails AA; a hero clamp that overflows its container at 320px breaks reflow. These are blocking on the `frontend` aggregator — a regression here is a red build, not a cosmetic note.

**Why it happens:**
Aesthetic decisions (tighter, denser, lighter, lower-contrast-for-elegance) are made in the design layer where a11y constraints aren't visible, then they collide with the gates at PR time. The instinct under pressure is to *loosen the gate* rather than fix the design.

**How to avoid:**
- **Never lower a gate to make a design pass.** The target-size spec explicitly documents that the 44px bar was NOT lowered to force green on `/security` (`e2e/target-size.spec.ts` lines 21–33). Same discipline applies: the design conforms to the gate, not vice-versa.
- New colors go through the contrast math *at token-definition time* (Phase 49), not at axe-failure time. DESIGN.md has a strong precedent here — every color shift (text-muted, positive, warning) records its measured contrast ratio. Keep that ledger discipline for every new/changed token.
- Run the axe + reflow + target-size specs locally per surface as a pre-PR gate, not only in CI, so failures surface during design not at land.
- The axe matrix is currently **public-only** (authed/mobile rows dormant — non-hermetic shared MA-8 DB). Re-enabling authed rows is a *v1.4 deliverable* (deferred v1.3 debt); doing the visual overhaul without authed axe coverage means authed regressions hide until the gate is re-enabled. Sequence the re-enable *early* if possible.

**Warning signs:**
A PR that edits a `*.spec.ts` axe/reflow/target-size threshold; a new `text-*` color not run through contrast math; a button class change reducing height below `min-h-[44px]`; axe `color-contrast` (serious) appearing on a restyled route.

**Phase to address:** **Phase 49** (contrast-validate all new tokens up front); **every surface phase** (gates run per surface); **final verification phase** owns re-enabling authed/mobile axe rows + ratcheting lhci (the explicit v1.3-debt cleanup).

---

### Pitfall 7: Dark-sidebar vs light-surface contrast inversion

**What goes wrong:**
The app is light-mode-only (DESIGN.md: "Dark mode: Not planned") BUT has a permanently **dark navy sidebar** (`--color-sidebar: #0F172A`) with its own text tokens (`--color-sidebar-text: #94A3B8`, `--color-sidebar-text-active: #FFFFFF`). During an aesthetic evolution it is easy to (a) restyle nav with a light-surface text color that becomes invisible on the dark sidebar, or (b) reuse the accent teal `#1B6B5A` (validated for contrast on *white*) as text/icon on the *dark navy* without re-checking — accent-on-dark-navy is a different ratio. The IA rethink (new nav, breadcrumbs, active states) lives exactly at this dark/light seam.

**Why it happens:**
There are effectively two color contexts (dark sidebar, light everything-else) and a single token palette mostly validated against the light context. Reviewers check contrast on white and forget the navy region.

**How to avoid:**
- Treat the sidebar/nav as a distinct contrast context. Any nav text/icon/active-state color must be contrast-checked against `#0F172A` (and `--color-sidebar-hover #1E293B` / `--color-sidebar-active #334155`), not against white.
- Add the sidebar/mobile-nav region to the axe matrix viewports explicitly (the mobile bottom nav is single-sourced from `Sidebar.tsx` per v1.3 Phase 45 — `src/components/layout/Sidebar.tsx`, `MobileNav.tsx`, `MobileSidebarDrawer.tsx`; restyling one restyles all three, so verify all three).
- Keep the sidebar token family (`--color-sidebar*`) as a named, documented context in DESIGN.md so nobody reaches for a white-context token there.

**Warning signs:**
A nav active-state using `--color-accent` directly; nav text color borrowed from a light-context token; axe `color-contrast` firing only when the sidebar is in view.

**Phase to address:** **IA / navigation restructure phase** (owns nav contrast); contrast tokens locked in **Phase 49**.

---

### Pitfall 8: Tailwind v4 CSS-first specificity wars + bare-token resolution bugs

**What goes wrong:**
This is Tailwind **v4 CSS-first** (`@import "tailwindcss"` + `@theme inline` in `src/app/globals.css`, no `tailwind.config.js` theme). Two documented failure modes here: (1) **bare-token silent failure** — `var(--positive)` resolves to `currentColor`/black and `var(--radius-lg)` to `0px` unless the token is `--color-`/`--radius-`-prefixed in `@theme inline` (DESIGN.md 2026-05-06 logged exactly this hitting four widgets). A token-system migration multiplies the chance of introducing a bare/undeclared token. (2) **specificity wars** — adding raw CSS in `globals.css` (there is already a substantial raw-CSS block: slider thumbs, prose-note, focus rings) that fights Tailwind utility classes, leading to `!important` escalation. v4's cascade-layer model means hand-written CSS outside `@layer` can unintentionally beat or lose to utilities. (3) **invalid-token silent drop** — DESIGN.md already records `duration-250` silently dropping the animation because it's not a valid v4 token; new motion tokens have the same trap.

**Why it happens:**
v4's `@theme inline` + cascade layers are newer than most training data and differ from v3 `tailwind.config.js` mental models (AGENTS.md warns "this is NOT the Next.js you know" — the same applies to Tailwind v4). Bare tokens *look* correct and fail silently (no error, just wrong color/0 corners).

**How to avoid:**
- Every new design token declared in `@theme inline` MUST carry the correct prefix (`--color-*`, `--radius-*`, `--space-*` style, `--font-*`). Extend the existing drift guards to fail on bare `var(--token)` usages in components (the repo already paid for this lesson once).
- Verify each motion/duration utility is a real v4 token before using it (DESIGN.md: use `duration-300`, not `duration-250`).
- Keep hand-written CSS in `globals.css` inside explicit `@layer` blocks so it composes predictably with utilities; resist `!important` — if you need it, the layer/token model is being fought.
- Consult Context7/Tailwind v4 docs for the `@theme inline` + cascade-layer semantics before restructuring `globals.css` rather than relying on v3 memory.

**Warning signs:**
A component rendering black/0-corner unexpectedly; a `var(--foo)` without a `--color-`/`--radius-` prefix; `!important` appearing in `globals.css`; an animation silently not running (invalid duration token); CSS in `globals.css` outside any `@layer`.

**Phase to address:** **Phase 49** (token declarations + drift guard); any phase editing `globals.css` raw CSS.

---

### Pitfall 9: IA/routing restructure breaking deep links, bookmarks, share-links, SEO, and RLS gating

**What goes wrong:**
Restructuring routes/menus/hierarchy is the highest-blast-radius change in the milestone because routes are *contracts* held by external state:
- **Share links:** `/scenario-share/[token]` is a revocable, leak-scoped, SECURITY-DEFINER-RPC public route (`src/app/scenario-share/[token]/`). It is hand-listed in `src/proxy.ts` `PUBLIC_ROUTES`. Renaming/moving it without updating the proxy allowlist → recipients hit a 307→login (this exact bug class happened in v1.1.0 P25 canary: `/scenario-share` + `/api/benchmark/btc` were missing from the allowlist → every share link 307'd to login → required hotfix #512). Worse, dropping it from the allowlist could expose or break the leak-scoping.
- **SEO / public routes:** `/`, `/security`, `/for-quants`, `/browse`, `/demo`, `/strategy`, `/factsheet`, `/legal` are public/marketing/SEO surfaces (in `PUBLIC_ROUTES`). Renaming a public route silently 404s inbound SEO/backlinks and breaks the marketing funnel.
- **RLS route gating:** `src/proxy.ts` does session-gating by path prefix and has admin-email gating. An IA change that moves an authed route, or changes the `(dashboard)` route-group structure, can accidentally (a) expose a gated route as public, or (b) break role-scoped nav so a manager sees allocator-only entries.
- **Deep-link tab state:** `/allocations?tab=scenario` is a wired, tested deep link (the `/scenarios` retirement 307s to it — `phase-32-frozen-spine-guards.test.ts` FLOW-02 pins the exact redirect string). Changing the tab param/structure breaks that pinned redirect and the Bridge→composer continuity.
- **Redirect loops:** `src/proxy.ts` already has both an unauthed→login redirect and an authed→dashboard redirect with a `redirect` query param. Adding new redirects (old-IA→new-IA) on top of this can create loops (authed user → old path → redirect → proxy re-evaluates → loop).
- **Lost scroll/focus on navigation:** App Router navigation should restore/reset scroll and move focus to the new page's heading (a11y). A custom nav/IA layer often forgets this; combined with the existing skip-link mechanism (v1.3 Phase 45 app-shell skip-link) a focus regression here also breaks keyboard-nav gates.

**Why it happens:**
Routes feel like "just folders" but they are an external API. The proxy allowlist is a separate, hand-maintained mirror of the route list — easy to forget. Redirect logic compounds non-locally.

**How to avoid:**
- **Inventory every route + its gating before moving anything.** Cross-reference `src/proxy.ts` `PUBLIC_ROUTES` against the public route set; any moved/renamed public route updates the allowlist in the same commit.
- **Prefer redirects over renames** for any route that could be bookmarked/linked/indexed: keep the old path as a `permanentRedirect` (308, SEO-preserving) to the new one. The repo already uses this pattern (`/scenarios` → 307 to `/allocations?tab=scenario`); use `permanentRedirect` for SEO routes specifically.
- **Add e2e coverage for the contract routes** before restructuring: a test that `/scenario-share/[token]` resolves for an unauthed user, that public SEO routes return 200 unauthed, that authed-only routes 307 unauthed, that role-scoped nav shows the right entries. Several of these proxy contracts are already implicitly covered — make them explicit pre-flight.
- **Re-verify the proxy after IA changes with a real authed canary** — headless can't hydrate authed pages here (documented), so a redirect-loop or gating regression on an authed route needs the real-Chromium MCP canary (which v1.3 proved works for authed `/allocations`).
- For scroll/focus: rely on App Router's default scroll handling; if a custom shell intercepts navigation, explicitly move focus to the page `<h1>` and reset scroll, and keep the skip-link target intact.

**Warning signs:**
A route folder rename in the diff with no matching `PUBLIC_ROUTES` edit; a removed public path with no `permanentRedirect` left behind; a share-link 307'ing to login in canary; a manager account seeing admin/allocator nav; back-button producing a redirect loop; scroll position carried over or focus left on the old page after nav.

**Phase to address:** **IA / routing restructure phase** — must own a route-contract inventory + proxy-allowlist sync + redirect map + authed canary as explicit exit criteria. This is the phase most likely to need **deeper pre-implementation research** — flag it.

---

### Pitfall 10: Wrong client↔server component conversions (breaking the client scenario engine, FactsheetProvider, Web Worker, hydration)

**What goes wrong:**
"React 19 / Next 16 best practices" invites converting client components to server components for perf. But this app's core interactive machinery is **fundamentally client-side and must stay that way**:
- The scenario math (`src/lib/scenario.ts`) runs 100% client-side; the composer's live what-if recompute, toggles, leverage sliders, and the **Monte-Carlo Web Worker** (v1.1.0's first Web Worker) only work in a client component. Converting the composer or its tree to a server component breaks the live projection silently (no error — just dead controls / no recompute).
- `FactsheetProvider` (`src/app/factsheet/[id]/v2/factsheet-context.tsx`) is a React Context with a `persist` flag and a critical **no-state-bleed guard** (`FactsheetBody.guard04-no-bleed.test.tsx`, GUARD-04): two `persist={false}` instances (the real factsheet vs the scenario-mode factsheet on the blend) must NOT share state. Context is client-only; a careless server-ification or a refactor that hoists the provider/changes its identity can reintroduce cross-instance state bleed (the exact bug v1.2.2 spent a guard preventing — and the v1.2.1 RT2 bug where factsheet `?range/?cmp/?dark` bled cross-tab via shared URL).
- **Hydration mismatches:** the repo has a documented two-pass-mount pattern for SSR-unsafe flags (DESIGN.md 2026-04-29 strategy.ui_v2: SSR returns `false`, `useEffect` upgrades post-hydration). The new `useBreakpoint` (v1.3) is SSR-safe by the same discipline. A best-practices refactor that reads `window`/`localStorage`/`matchMedia` during render, or removes a two-pass guard, causes hydration errors — and on charts/tables a hydration mismatch can cause a flash or a wrong-branch render.
- **237 files** carry `"use client"`. Mass "is this client really needed?" sweeps will eventually hit one of the load-bearing ones.

**Why it happens:**
RSC guidance ("default to server components") is correct *in general* but this app is a heavily interactive dashboard where the interactivity IS the product. The boundary between "static factsheet shell (server-safe)" and "interactive scenario engine (client-only)" is subtle and undocumented in a single place.

**How to avoid:**
- **Do not convert `"use client"`→server in any subtree that touches:** `scenario.ts`/`computeScenario`, the composer, the Web Worker, `FactsheetProvider`/`factsheet-context`, `useBreakpoint`, `useTapPin`, or any chart with tap/tooltip interaction. Treat these as a "client-locked" list.
- The `phase-NN-frozen-spine-guards.test.ts` git-diff zero-diff guard already protects `scenario.ts` from *content* changes; it does NOT protect against a *boundary* change in a consumer. Add a guard asserting the composer/provider files keep `"use client"`.
- Any new browser-API read goes through the established SSR-safe two-pass pattern (mirror `useBreakpoint` / `widget-state-flag.ts`), never raw during render. Keep hydration-error checks in dev.
- Server-ify only genuinely static surfaces (marketing copy, legal text, static factsheet *shell* where data is server-fetched) — and verify no Context consumer is orphaned.
- Read `node_modules/next/dist/docs/` for the Next 16 RSC boundary rules (AGENTS.md mandate) before any boundary change — Next 16 differs from training data.

**Warning signs:**
A `"use client"` removed from a file importing `scenario.ts`, `useBreakpoint`, `useTapPin`, or `factsheet-context`; dead composer controls / no live recompute after a refactor; a hydration-mismatch console error; the GUARD-04 no-bleed test going red; `window`/`localStorage`/`matchMedia` read during render.

**Phase to address:** **Best-practice React/frontend refactor phase** — must enumerate the client-locked list as an explicit out-of-scope-for-server-ification guardrail. Flag for deeper research on the exact Next 16 RSC boundary semantics.

---

### Pitfall 11: useEffect / key / memo misuse and perf regressions during the "best-practices" pass

**What goes wrong:**
A "react-best-practices" refactor that is itself sloppy introduces the very AI-slop it aims to remove: (a) `useEffect` used for derived state that should be computed during render (causing double-renders / sync bugs) or for data-fetching that should be a server component / loader; (b) array index used as React `key` in the many list/table/chart renders → wrong-row reconciliation, lost input focus, chart animation glitches; (c) over-memoization (`useMemo`/`useCallback` everywhere) that adds overhead and bugs, or wrong dependency arrays that stale; (d) a perf *regression* — e.g. moving an expensive `computeScenario`/factsheet compute out of a memo, or re-rendering all 18 Recharts + 16 SVG charts on every keystroke in the composer.

**Why it happens:**
"Apply best practices app-wide" is a broad, fuzzy mandate; without a concrete checklist it becomes mechanical churn. React 19 changed some rules (e.g. the compiler, ref-as-prop, `use()`); refactors based on React 18 habits misfire.

**How to avoid:**
- Make the "best-practices" pass *checklist-driven and measured*, not vibes-driven: target specific anti-patterns (effect-derived state, index keys, fetch-in-effect) with a lint rule or codemod where possible, and require a before/after lhci comparison for any composer/factsheet-touching change so perf is *proven* not assumed.
- Stable keys = stable domain IDs (strategy id, api_key_id, scenario id), never index. The composer's reorderable correlation matrix / constituent list is the high-risk site.
- Keep the existing memoization around `computeScenario` and factsheet payloads; don't "simplify" a memo that guards a heavy compute. The chart-recompute-on-keystroke risk is real given 34 charts — keep inputs memoized.
- Use the lhci mobile budget as the perf regression gate (already in CI from Phase 48); the milestone wants to ratchet it up, which only works if this pass doesn't regress it.

**Warning signs:**
`useEffect` whose body just sets state from props; `key={index}` / `key={i}`; a new `useMemo`/`useCallback` with no measured benefit; lhci score dropping after a "cleanup" PR; input focus lost while typing in a composer list; charts re-animating on every keystroke.

**Phase to address:** **Best-practice React/frontend refactor phase** — define the concrete anti-pattern checklist + require lhci before/after as exit criteria.

---

### Pitfall 12: Touching the frozen engine / dropping below the coverage ratchet (process self-sabotage)

**What goes wrong:**
Two repo-specific own-goals: (a) A visual/refactor PR accidentally edits `src/lib/scenario.ts` or `src/lib/factsheet/compute.ts` (e.g. a "tidy imports" or "rename for clarity" sweep, or moving a presentation helper that lives near the engine) → the `phase-NN-frozen-spine-guards.test.ts` zero-diff git-diff guard FAILS the build (it computes `git diff --name-only <merge-base> HEAD` and asserts `scenario.ts` is absent). (b) Deleting/rewriting components during the overhaul **removes their tests**, dropping below the CI-blocking coverage ratchet (lines 82 / statements 80 / functions 74 / branches 72; actual ~85.2/83.3/77.4/75.5 as of 2026-06-20). Functions and branches have the least headroom — a few deleted well-tested utilities can breach them. The `frontend-coverage` job is a hard branch-protection gate.

**Why it happens:**
The frozen files are ordinary-looking `.ts` files with no special filename marker — a broad refactor doesn't "see" the freeze. Coverage is a *ratio*; deleting tested code while adding untested presentational code shifts the denominator unfavorably even if you "added tests."

**How to avoid:**
- A frozen-spine guard for the v1.4 phases must exist (continue the `phase-NN-frozen-spine-guards.test.ts` pattern, extended to include `compute.ts` and the "client-locked" boundary files from Pitfall 10). It already fails loud — keep it per-phase.
- Treat `scenario.ts` and `compute.ts` as **read-only**. If a presentation refactor *seems* to need a helper from there, copy/adapt it presentation-side; never edit the engine. The repo's whole architecture is "additive over the frozen engine."
- For every component restyled/rewritten, port or rewrite its tests in the same PR — net coverage must not drop. Run `npm run test:coverage` locally before PR (functions/branches are the tight ones). Where a surface is rewritten, add `*.scenario`/`*.degenerate` tests in the established style (no-invented-data degenerate cases are part of coverage *and* the locked invariant).
- Do NOT mass-delete tests as "obsolete" — verify each against live code first (a recorded prior lesson).

**Warning signs:**
`scenario.ts`/`compute.ts` in `git diff --name-only`; `frontend-coverage` job red; functions/branches coverage dropping toward 74/72; a PR that deletes a `*.test.ts(x)` without a replacement; a frozen-spine guard going red.

**Phase to address:** **Every phase** (frozen guard + coverage are per-PR gates). A v1.4 frozen-spine guard is set up in **Phase 49** and runs through to close.

---

### Pitfall 13: No-invented-data regressed under a "cleaner empty state"

**What goes wrong:**
The no-invented-data invariant (degenerate inputs → honest empty states, never fabricated zeros/garbage/false precision) is a LOCKED constraint. A UX-polish pass can quietly violate it: a redesigned KPI card that renders a sleek "0.00" / "—" *that looks like a real value* where the honest behavior is to suppress the panel; a new skeleton/placeholder that morphs into a fabricated number; a redesigned peer/percentile panel that gets "filled in" for a hypothetical blend (the no-peer-rank invariant, with its one audited `scenarioPeer` aggregate exception). DESIGN.md's 9-state matrix (loading/empty/error/partial/success/retry/stale/optimistic/offline) is the contract these surfaces must keep honoring.

**Why it happens:**
Empty states are visually "ugly," so a design overhaul is tempted to make them look "complete" — which crosses into fabricating data. The line between "honest empty state styled nicely" and "fake value" is a judgment call made in the design layer.

**How to avoid:**
- Restyle empty/degenerate states to look *intentional*, never *populated*: keep the explicit "insufficient data" / suppressed-panel semantics; an empty state may be beautiful but must remain unmistakably empty.
- Preserve the structural panel suppression for hypothetical-blend peer/percentile (IMPACT-02 / GRAPH-04 / PEER-01 guards) — the overhaul does not unlock any new panel on a what-if; the only peer surface is the existing aggregate `scenarioPeer` carve-out.
- Keep the 9-state matrix coverage for every restyled surface; the degenerate-case tests are existing and should stay green.

**Warning signs:**
A "0.00"/"—" rendered where a panel should be suppressed; a peer/percentile panel newly appearing on a hypothetical blend; a degenerate-case test going red; a skeleton that resolves to a fabricated number.

**Phase to address:** **Every surface phase** that restyles data displays; verified by the existing no-invented-data + IMPACT/GRAPH/PEER guards.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `npx playwright test --update-snapshots` on the chart-parity goldens to clear red | Build green now | Goldens silently lose all regression value; every future chart bug passes | **Never blind.** Re-baseline a chart's golden only at the phase that intentionally changes that chart, with the visual diff reviewed in the PR |
| Lower an axe/reflow/target-size threshold to fit a design | Design ships as drawn | A11y debt + a CI gate that no longer means anything; WCAG-AA floor breached | Never — the design conforms to the gate (repo precedent: target-size 44px was NOT lowered for /security) |
| Bulk find-replace removing all `truncate`/`whitespace-nowrap` for "no clipping" | Satisfies the requirement literally | 320px reflow overflow + tabular-num misalignment in financial tables | Never bulk; per-site audit (full value must stay reachable) |
| Apply the new design system to only the "important" surfaces (allocations) and defer admin/wizard | Visible polish fast | "Two apps" drift; admin/wizard look abandoned; conformance never finishes | Only as an *explicit, tracked* phase boundary with a deadline, never as silent deferral |
| Hardcode a hex/px to hit a pixel-perfect look quickly | Matches the comp exactly | Token drift (172 raw hexes already exist); the next theme change misses it | Never in components; add the value as a token in `@theme inline` first |
| Convert a client component to server "because best practices" without tracing Context/Worker usage | Smaller client bundle | Dead controls / broken live recompute / orphaned Context — silent | Only on genuinely static subtrees with no Context/Worker/interactivity, verified |
| Rename a route instead of redirecting | Cleaner URL | Dead bookmarks/share-links/SEO; proxy-allowlist drift | Only with a `permanentRedirect` left behind + proxy allowlist updated same commit |
| Skip porting a deleted component's tests | Faster restyle | Coverage ratchet breach (functions/branches have least headroom) | Never — port/rewrite tests in the same PR |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `src/proxy.ts` PUBLIC_ROUTES | Renaming/moving a public or share route without syncing the hand-maintained allowlist → 307 to login (v1.1.0 #512 bug class) | Update `PUBLIC_ROUTES` in the same commit as any public/share route move; add an e2e that the share route resolves unauthed |
| `/scenario-share/[token]` (SECURITY DEFINER RPC) | Restructuring the route or its data fetch in a way that widens the leak-scope, or breaks the revocability | Treat the share-resolve path (`share-resolve.ts`) + its RLS/RPC as frozen contract; presentation-only changes; re-verify leak-scope with the authed-prod recipe |
| `next/font` in `src/app/layout.tsx` | Rewiring loader (localFont, changing `subsets`, dropping `variable`) during a refactor → FOUT/CLS, broken `--font-*` token wiring | Keep loader shape; only add weights/styles; the `--font-*` variables feed `@theme inline` — don't rename |
| Supabase RLS-gated `(dashboard)` routes | IA move that changes route-group structure and accidentally un-gates an authed route or breaks role-scoped nav | Inventory route→gating before moving; verify with a real-Chromium authed canary (headless can't hydrate authed) |
| Tailwind v4 `@theme inline` | Declaring a token without the `--color-`/`--radius-` prefix → silent black/0px render | Prefix every token; extend the drift guard to fail on bare `var(--token)` in components |
| lhci mobile budget (Phase 48) | A best-practices/perf refactor regressing CLS/score then trying to ratchet the budget up | Require before/after lhci on composer/factsheet-touching PRs; ratchet only after the pass proves no regression |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Re-rendering all 34 charts (18 Recharts + 16 SVG) on every composer keystroke | Janky sliders/toggles, fan spin, lhci TBT spike | Memoize chart inputs; keep stable domain-ID keys; don't drop the existing `computeScenario`/payload memos | Composer with many constituents + a tight clamp recompute |
| Fluid `clamp()` on block-height properties + new motion → CLS | Layout jumps on resize/font-swap, lhci CLS climbs | Reserve space (keep `ResponsiveChartFrame` min-heights); avoid clamp on height; keep next/font fallback metrics | Above-the-fold hero/charts on slow mobile |
| Over-memoization churn from the best-practices pass | Slightly worse perf, stale-dep bugs | Memoize only measured hotspots; correct dep arrays; lhci before/after | Broad mechanical refactor without measurement |
| Ultra-wide unbounded measure/grid reflow cost | Huge layout at 2560px, slow paint, unreadable lines | `max-inline-size` (ch) on prose; widen gutters not measure | Ultra-wide monitors (untested today) |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| IA change un-gates an authed `(dashboard)` route (proxy prefix gating drifts) | Authed data exposed publicly | Route→gating inventory before any move; authed canary; e2e that authed routes 307 unauthed |
| Share-link route restructure widens leak-scope or breaks revocation | Allocator's book / another tenant's data leaks via a shared scenario | `/scenario-share/[token]` + `share-resolve.ts` + the SECURITY DEFINER RPC are frozen contract; re-verify leak-scope (the no-leak invariant from v1.1.0) |
| Role-scoped nav restyle drops the role gate (manager sees allocator/admin nav) | Privilege/UX confusion, possible action on a forbidden surface | Nav is single-sourced from `Sidebar.tsx`; keep role filtering when restyling; test per role |
| FactsheetProvider state bleed across `persist={false}` instances after a refactor | One allocator's scenario state leaks into another factsheet view (cross-instance / cross-tab) | Keep GUARD-04 no-bleed test green; don't hoist/share the provider; `persist={false}` gates read AND write (v1.2.1 RT2 lesson) |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| "No clipping" applied to strategy names → wrapping breaks table alignment | Numeric columns misalign; tables look broken | Truncate name columns with a reachable full value (title/tooltip); never wrap numeric cells |
| Empty/degenerate state restyled to look populated | Allocator trusts a fabricated 0.00 as a real metric | Honest, intentional empty states; keep the 9-state matrix + panel suppression |
| IA restructure loses scroll/focus on navigation | Keyboard/screen-reader users lost; sighted users disoriented | Move focus to new page `<h1>`, reset scroll, keep skip-link target |
| Dark-sidebar nav restyle with light-context colors | Nav text invisible / low-contrast on navy | Contrast-check nav against `#0F172A`, not white |
| Aggressive hero clamp that overflows at 320px | Horizontal scroll on phones (reflow fail) | clamp min/max in rem; verify against the 320px reflow sweep |

## "Looks Done But Isn't" Checklist

- [ ] **Fluid type:** Often missing a `rem` term in the clamp middle value — verify text reaches ≥200% under browser zoom (WCAG 1.4.4 / F94), not just that it scales on resize
- [ ] **Fluid type bounds:** Often missing readable floor / measure cap — verify caption ≥12px at 320px AND prose `max-inline-size` holds at 2560px
- [ ] **Truncation removal:** Often missing the "full value still reachable" check — verify no 320px overflow and no tabular-num wrap
- [ ] **Design tokens:** Often missing the `--color-`/`--radius-` prefix — verify no bare `var(--token)`, no new raw hex in components
- [ ] **Route move:** Often missing the proxy-allowlist sync + redirect — verify `PUBLIC_ROUTES` updated, old path `permanentRedirect`s, share link resolves unauthed
- [ ] **RLS/role nav:** Often missing per-role verification — verify each route's gating + nav per role with an authed canary (headless can't hydrate)
- [ ] **Client→server conversion:** Often missing the Context/Worker trace — verify scenario engine still live-recomputes, FactsheetProvider no-bleed green, no hydration error
- [ ] **Restyled empty state:** Often missing the no-invented-data check — verify suppressed panels stay suppressed, no fabricated 0.00, degenerate tests green
- [ ] **Coverage:** Often missing the test port on a rewritten component — verify `npm run test:coverage` still clears 82/80/74/72 (functions/branches tightest)
- [ ] **Frozen engine:** Often missing the diff check — verify `git diff --name-only` excludes `scenario.ts` and `compute.ts`
- [ ] **Existing gates:** Often missing per-surface local runs — verify axe-app-wide + reflow-sweep + target-size + viewport-zoom-meta all green on each touched surface
- [ ] **Chart goldens:** Often missing the deliberate re-baseline — verify any `toHaveScreenshot` update was reviewed, not blind `--update-snapshots`

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Accidentally edited `scenario.ts`/`compute.ts` | LOW | Frozen-spine guard fails loud at PR; `git checkout <base> -- src/lib/scenario.ts src/lib/factsheet/compute.ts`; move the needed helper presentation-side |
| clamp fails 1.4.4 zoom | LOW-MEDIUM | Rewrite clamp with a `rem` middle term + rem bounds; re-run zoom guard; usually a token-level fix, not per-component |
| Coverage ratchet breach | MEDIUM | Identify deleted-tested vs added-untested via the v8 report; port/rewrite the missing tests; do NOT lower thresholds |
| Share-link/SEO route 307→login or 404 | MEDIUM | Add the path back to `PUBLIC_ROUTES` and/or leave a `permanentRedirect`; hotfix-deploy (the v1.1.0 #512 precedent); re-canary unauthed |
| RLS route un-gated by IA change | HIGH | Revert the route-group change; re-inventory gating; re-verify with authed canary + check Supabase advisors; treat as a security incident even pre-revenue |
| Client→server conversion broke the composer | MEDIUM | Re-add `"use client"` to the affected subtree; verify Web Worker + Context rehydrate; add a `"use client"`-presence guard so it can't recur |
| Chart goldens blind-rebaselined, regression value lost | HIGH | Restore prior goldens from git; re-baseline only the charts the milestone intentionally changed, one diff-reviewed PR at a time |
| App in "two apps" half-migrated state at milestone end | MEDIUM | Per-surface conformance checklist + a final app-wide design-review audit phase that gates close on every surface conforming |

## Pitfall-to-Phase Mapping

> Concrete phase names will come from the roadmapper; below maps each pitfall to the *kind* of phase that should own it (numbering continues from 48 → 49+). Phase 49 is assumed to be the **design-token + fluid-type foundation** phase; the **final phase** is the **verification + v1.3-debt cleanup** phase.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. clamp fails 1.4.4 zoom | Phase 49 (clamp convention + new `vw`-without-`rem` guard) | New lint guard green; 200%-zoom QA; `viewport-zoom-meta.test.ts` |
| 2. Lost minimums / ultra-wide blowup | Phase 49 (token floors + measure caps); final (ultra-wide viewport row) | Caption ≥12px at 320px; reflow sweep + new ultra-wide axe row green |
| 3. Broke intentional truncation / tabular alignment | Typography/layout rollout phase(s), per surface | `reflow-sweep.spec.ts` + `reflow-sweep-authed.spec.ts` stay green; numeric columns aligned |
| 4. CLS / next/font regression | Phase 49 (lock font + token contract) | lhci CLS sub-metric; no `next/font` loader rewire in diff |
| 5. Visual drift / half-migration | Phase 49 (tokens first + drift guard); per-surface conformance phases; final design-review | Drift guard (no bare token / no raw hex) green; per-surface conformance line; final audit |
| 6. Regress axe/reflow/zoom/target-size gates | Phase 49 (contrast-validate tokens); every surface phase; final (re-enable authed/mobile axe, ratchet lhci) | `axe-app-wide` + `reflow-sweep` + `target-size` green per surface |
| 7. Dark-sidebar contrast | IA/navigation phase | Nav contrast-checked vs `#0F172A`; axe on sidebar-visible viewports |
| 8. Tailwind v4 specificity / bare tokens | Phase 49 (token declarations + drift guard) | No bare `var(--token)`; no `!important` in `globals.css`; valid motion tokens |
| 9. IA/routing breaks deep links/SEO/RLS/share | IA / routing restructure phase (route inventory + proxy sync + redirect map + authed canary) | Public routes 200 unauthed; authed routes 307 unauthed; share link resolves; no redirect loop; `proxy.ts` synced |
| 10. Wrong client↔server conversion | React/frontend best-practices phase (client-locked list) | `"use client"`-presence guard; composer live-recompute; GUARD-04 no-bleed green; no hydration error |
| 11. useEffect/key/memo/perf misuse | React/frontend best-practices phase (anti-pattern checklist + lhci before/after) | No index keys; lhci not regressed; focus retained in composer lists |
| 12. Touch frozen engine / coverage ratchet | Phase 49 (v1.4 frozen-spine guard); every phase (coverage) | `git diff` excludes engine; `frontend-coverage` ≥82/80/74/72 |
| 13. No-invented-data regressed | Every data-surface phase | IMPACT-02/GRAPH-04/PEER-01 + degenerate-case tests green; suppressed panels stay suppressed |
| (structural) Lost byte-identity safety net | Final verification phase owns the replacement visual-regression strategy | Chart goldens deliberately re-baselined per change; new post-stabilization full-page goldens added |

## Sources

- W3C WAI — Understanding SC 1.4.4 Resize Text: https://www.w3.org/WAI/WCAG21/Understanding/resize-text.html (HIGH)
- W3C WAI — F94: Failure of 1.4.4 due to incorrect use of viewport units to resize text: https://www.w3.org/WAI/WCAG21/Techniques/failures/F94 (HIGH — confirms the clamp+`vw` zoom failure)
- Smashing Magazine — Addressing Accessibility Concerns With Using Fluid Type (2023): https://www.smashingmagazine.com/2023/11/addressing-accessibility-concerns-fluid-type/ (MEDIUM)
- Trys Mudford / Utopia — WCAG warnings on fluid type: https://www.trysmudford.com/blog/utopia-wcag-warnings/ (MEDIUM)
- Smashing Magazine — Modern Fluid Typography Using CSS Clamp: https://www.smashingmagazine.com/2022/01/modern-fluid-typography-css-clamp/ (MEDIUM)
- Quantalyze codebase (HIGH, primary): `.planning/PROJECT.md` (locked invariants, milestone constraints); `DESIGN.md` (token/contrast ledger, v4 `--color-*` lesson 2026-05-06, `duration-250` trap, 9-state matrix); `src/app/globals.css` (`@theme inline` tokens); `src/proxy.ts` (PUBLIC_ROUTES allowlist); `src/app/layout.tsx` (`next/font`); `e2e/axe-app-wide.spec.ts`, `e2e/reflow-sweep.spec.ts`, `e2e/reflow-sweep-authed.spec.ts`, `e2e/target-size.spec.ts`, `tests/visual/viewport-zoom-meta.test.ts`, `tests/a11y/chart-contrast.test.ts`, `tests/a11y/trust-tier-tokens.test.ts` (the v1.3 gates); `e2e/svg-chart-parity.spec.ts`, `e2e/strategy-v2-chart-parity.spec.ts` (the pixel-golden net); `src/__tests__/phase-32-frozen-spine-guards.test.ts` (git-diff zero-diff freeze mechanism); `src/app/factsheet/[id]/v2/factsheet-context.tsx` + `FactsheetBody.guard04-no-bleed.test.tsx` (Context + no-bleed guard); `src/app/scenario-share/[token]/` (share-link/RLS contract); `.github/workflows/ci.yml` (`frontend-coverage` gate, lhci, axe e2e lists); `CLAUDE.md`/`AGENTS.md` (coverage ratchet, "not the Next.js you know")
- Known prior-incident memory (HIGH, repo history): v1.1.0 #512 share-route allowlist gap (307→login); v1.2.1 RT2 persist-gating-on-read; v1.2.2 GUARD-04 stale-peer/state-bleed; DESIGN.md v4 bare-token silent-render

---
*Pitfalls research for: presentation-layer overhaul of a gated, mature Next.js 16 financial dashboard (Quantalyze v1.4 Frontend Excellence)*
*Researched: 2026-06-28*

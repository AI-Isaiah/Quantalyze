# Phase 54: Verification + v1.3 debt cleanup + visual-regression replacement - Research

**Researched:** 2026-06-30
**Domain:** Playwright e2e verification harness · ESLint design-token ratchet · Lighthouse CI · Tailwind v4 token aliasing · WCAG-AA gates
**Confidence:** HIGH (all findings verified against the live codebase at file:line; Tailwind v4 font-token mechanism CITED from official docs; library versions VERIFIED against node_modules)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Build all code/CI/harness now; defer the live BAKE + real-device sign-off.** Build all code, CI wiring, tolerances, masking, and the re-baseline harness now. The actual golden PNG bake happens in a controlled CI run — never blind `--update-snapshots`. Land the specs + tolerances + masking + the `WR-02`-style golden-pending guard so the suite is green-by-skip until a deliberate per-chart re-baseline commits the PNGs.
- **Real-device authed sign-off (VERIFY-05) is a human checkpoint** — this environment has no real device and the Bash sandbox has no external network. Lands as a `human_needed` verification item. The **app-wide design-review audit** portion of VERIFY-05 CAN and WILL run now (design-review skill / gsd-ui-review).
- **RT-W2 (admin over-stretch):** per-page inner `max-w` cap on the prose/form admin pages — `partner-import`, `users`, `users/[id]`, and `for-quants-leads`. Data tables keep the wide 1920px measure (the `DashboardChrome.isWide` regex stays as-is). Rejected: narrowing the `isWide` regex (fragile — admin tree mixes prose and data page types under one `/admin` prefix).
- **lhci ratchet:** re-measure all 5 public routes in CI first, then set the budget to the new measured floor **minus 2 points**. Keep the "under-actual so a real regression fails but noise doesn't flake" philosophy.
- **No-clip guard:** runtime Playwright sweep — detect content cut-off (`scrollWidth > clientWidth` / truncated text) across routes × viewports; fail on any reintroduced truncation/ellipsis/clip. Mask/allowlist genuinely-intended clamps (avatars, deliberate line-clamp).
- **VERIFY-02 hermetic DB:** reuse the existing seeded MA-8 harness — add `axe-app-wide` to the seeded CI spec list with self-seed/teardown so the authed + mobile rows run hermetically without polluting. Dual-wiring FLOW-01 trap applies: add to BOTH the ci.yml seeded list AND the spec's own `HAS_SEED_ENV` gate. Avoid the v1.3 pollution trap (leave-around seeded rows published into shared projects).
- **BP-03 byte-identity:** flip px→token via fixed-value token aliases equal to the current px on the frozen EquityChart + chart-internal SVG, so no raw px remains AND the render stays byte-identical. Narrow, documented `eslint-disable` only where a token genuinely can't express it. `scenario.ts` / `FactsheetBody` must stay byte-equivalent on the locked surfaces.
- **VERIFY-01 ultra-wide:** add 2560px to the existing `VIEWPORTS` matrix constant; wire the three deferred Phase-52 canaries (seeded 2560px reflow sweep + svg goldens + authed ultra-wide).

### Claude's Discretion (plan-time implementation)
- VERIFY-02 hermetic-DB exact mechanism (per-spec isolated DB vs seed-teardown transaction vs dedicated axe project).
- BP-03 fixed-value token alias mechanism + which files get a narrow documented `eslint-disable`.
- VERIFY-01 exact wiring of the three deferred Phase-52 canaries.

### Deferred Ideas (OUT OF SCOPE)
- **Real-device authed sign-off** (VERIFY-05) — human checkpoint; no real device / no Bash network here.
- **Live golden PNG bake** — controlled CI run, never blind; lands green-by-skip until baked.
- Anything beyond v1.4 scope (v2/deferred items in REQUIREMENTS.md) stays out.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VERIFY-01 | 2560px ultra-wide row added to axe/reflow matrix, green app-wide; deferred P52 canaries (seeded 2560 reflow + svg goldens + authed ultra-wide) run and pass | §VERIFY-01 — the 2560 reflow row already exists for the allocator subset in `reflow-sweep-authed.spec.ts:289-354`; extend the `VIEWPORTS` const in `axe-app-wide.spec.ts:92` + the public `reflow-sweep.spec.ts`; svg goldens are the WR-02 pending bake |
| VERIFY-02 | Authed + mobile axe rows re-enabled against a hermetic seeded-DB approach | §VERIFY-02 — dedicated-allocator-per-test isolation + explicit teardown is the cleanest fit for the SHARED MA-8 test DB; the three v1.3 pollution sources are named and avoidable |
| VERIFY-03 | lighthouse-mobile budget ratcheted up from 0.60; no-clip CI guard fails on reintroduced truncation/ellipsis/clip | §VERIFY-03 — re-measure via the existing `.lighthouseci/` artifact JSON; new `no-clip-sweep.spec.ts` reusing the `assertNoReflow` DOM-probe idiom |
| VERIFY-04 | Lifted desktop byte-identity replaced by tolerance-based `toHaveScreenshot()` goldens, deliberate per-chart re-baseline (never blind `--update-snapshots`); ±2–5% precedent; dynamic regions masked | §VERIFY-04 — `svg-chart-parity.spec.ts` is the bake target (WR-02 guard already in place); `strategy-v2-chart-parity.spec.ts` is dead (canvas mismatch); identify the LIFTED surfaces |
| VERIFY-05 | Real-device authed sign-off + app-wide design-review audit; WCAG-AA + LOCKED invariants intact and proven | §VERIFY-05 — sign-off is `human_needed`; design-review runs now; RT-W2 admin caps; carry-forward composer focus-trap (Phase-52 CR-03) |
| BP-03 | `no-raw-font-px` flips warn→error repo-wide (all orphan sites incl. frozen EquityChart + chart-internal SVG), `scenario.ts`/`FactsheetBody` byte-equivalent; v1.3 debt folded | §BP-03 — fixed-value token aliases for byte-identity; the frozen-spine guard at `phase-52-frozen-spine-guards.test.ts:158` is the central landmine (EquityChart is git-diff-frozen → must use a glob `off`, not an edit) |
</phase_requirements>

## Summary

Phase 54 is a **gate-hardening phase, not a feature build**. Every surface shipped in 49–53 already exists; this phase adds the automated defenses that keep them from regressing. The work decomposes cleanly into four mechanical tracks — a Playwright e2e track (VERIFY-01/02/03 no-clip/04), an ESLint-ratchet track (BP-03), a Lighthouse track (VERIFY-03 lhci), and an audit track (VERIFY-05) — and the codebase already contains direct precedents for every one of them. The dominant risk is **not** technical novelty; it is the dual-wiring FLOW-01 trap (burned ≥3×), the v1.3 seeded-DB pollution trap, and one genuine architectural collision in BP-03.

The single sharpest finding: **BP-03's literal "flip the frozen EquityChart to token" cannot be done by editing EquityChart.tsx.** That file is in the `FROZEN_ISLANDS` git-diff-zero list at `src/__tests__/phase-52-frozen-spine-guards.test.ts:158` — any byte change to it turns that guard RED. Phase-52's own `deferred-items.md` records it as "FROZEN ISLAND, NEVER migrate." Therefore the only compliant way to make `no-raw-font-px=error` pass repo-wide while leaving EquityChart byte-identical is to **add EquityChart (and the three chart-internal SVG files) to the existing `src/components/charts/**`-style `off` glob** (or give them a file-scoped `eslint-disable` with a documented `DS-04 sanctioned-exception:` marker). The migratable orphan files (≈40 production files, ≈230 raw-px sites) flip to fixed-value token aliases (`--text-fixed-10`/`--text-fixed-11` = exactly `0.625rem`/`0.6875rem`) so the render is byte-identical — the fluid `text-micro` clamp(10→11px) is **NOT** byte-identical and must not be used for the locked surfaces.

**Primary recommendation:** Treat this as four parallel waves keyed to the four tracks, with BP-03 sequenced so the eslint `error` flip is the LAST step (after every migratable file is clean and the EquityChart/chart-SVG exemption globs are in place), and gate every new seeded e2e spec through the FLOW-01 dual-wiring checklist (ci.yml MA-8 list AND the spec's `HAS_SEED_ENV` const). The golden bake and real-device sign-off land green-by-skip and `human_needed` respectively.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Ultra-wide / reflow / no-clip / axe matrix | e2e (Playwright DOM probe) | CI (ci.yml job wiring) | Runtime layout truth lives only in a real browser render; static analysis can't see `scrollWidth > clientWidth` |
| Tolerance visual goldens | e2e (Playwright `toHaveScreenshot`) | CI (seeded MA-8 + artifact) | Pixel parity is a browser-render artifact; the bake is a deliberate human-reviewed CI commit |
| px→token migration + ratchet flip | Build/lint (ESLint flat config + Tailwind `@theme`) | Source (component className edits) | The token spine is a CSS/build concern; `no-raw-font-px` is the edit-time backstop |
| lhci budget ratchet | CI (lhci autorun job) | Config (`lighthouserc.json`) | Perf scores are measured in a headless-Chrome CI run; the budget is a config constant |
| Hermetic seeded DB | e2e (seed helpers) | Database/Storage (test Supabase project) | Seed/teardown is application-layer test infra against a dedicated test project |
| Real-device sign-off + design audit | Human checkpoint / design-review skill | — | No real device or network in this sandbox; design audit is a static/screenshot pass |

## Standard Stack

This phase installs **NO new packages** — it is entirely a configuration + test-authoring phase using already-installed tooling. (See Package Legitimacy Audit.)

### Core (already installed — VERIFIED against node_modules)

| Library | Version (installed) | Purpose | Why Standard |
|---------|--------------------|---------|--------------|
| `@playwright/test` | **1.61.1** `[VERIFIED: node_modules/@playwright/test/package.json]` | e2e harness, `toHaveScreenshot`, viewport matrix, runtime DOM probes | The repo's sole e2e framework; single `chromium` project in `playwright.config.ts` |
| `next` | **16.2.9** `[VERIFIED: node_modules/next/package.json]` (range `^16.2.3`) | App framework; `npm run start` is the prod server lhci/seeded specs hit | AGENTS.md warns Next 16 has breaking changes — docs at `node_modules/next/dist/docs/` |
| `tailwindcss` | **4.3.1** `[VERIFIED: node_modules/tailwindcss/package.json]` (range `^4`) | `@theme` token utilities — the byte-identity alias mechanism for BP-03 | v4 `@theme { --text-*: <value> }` generates `text-{name}` utilities |
| `@lhci/cli` | **0.15.1** `[VERIFIED: node_modules + lighthouserc baseline comment]` | Lighthouse CI autorun; `categories:performance` minScore gate | Pinned in CI; Lighthouse 12.6.1 under the hood (no `preset:"mobile"` — use `formFactor`) |
| `@axe-core/playwright` | **^4.12.1** `[VERIFIED: package.json]` | `buildAxe(page).analyze()` WCAG-AA scan in `e2e/helpers/axe.ts` | The repo's axe wrapper; used by every `*-axe.spec.ts` |
| `vitest` | **^4.1.2** `[VERIFIED: package.json]` | Unit/guard tests (frozen-spine guards, drift tests, byte-identity guards) | Coverage ratchet is the BLOCKING `frontend` gate |

### Supporting (already present)

| Helper | Path | Purpose |
|--------|------|---------|
| `assertNoReflow(page, anchor)` | `e2e/helpers/reflow.ts:47` | `scrollWidth - clientWidth <= 1` DOM probe + visible-anchor false-green guard + offender breadcrumb |
| `assertTargetSizes(...)` | `e2e/helpers/reflow.ts:119` | 44px WCAG 2.5.8 probe (precedent for the no-clip per-element walk) |
| `seedTestAllocator()` | `e2e/helpers/seed-test-project.ts:76` | Service-role admin createUser + verified profile + attestation; timestamped+random email (rerun-safe) |
| `seedStrategyWithHistory({days,name})` | `e2e/helpers/seed-test-project.ts:307` | Published strategy + analytics; drives factsheet panels |
| `seedBridgeCandidate({categorySlug})` | `e2e/helpers/seed-test-project.ts:202` | Published strategy in a discovery category (the v1.3 pollution source — see VERIFY-02) |
| `seedAllocatorBook({allocatorUserId,days})` | `e2e/helpers/seed-test-project.ts:516` | api_key + holding + equity snapshots so /allocations renders the EquityChart instead of EmptyState |
| `buildAxe(page)` | `e2e/helpers/axe.ts` | axe-core WCAG-AA builder |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Dedicated-allocator-per-test isolation (VERIFY-02) | Per-spec isolated Supabase project | True hermeticity, but no second test project exists and creating/tearing one per run is heavy; the dedicated-user approach gets isolation cheaply on the shared DB |
| Fixed-value `--text-fixed-10/11` token (BP-03) | Reuse the fluid `text-micro` clamp | `text-micro` is `clamp(0.625rem, …, 0.6875rem)` — renders 10px ONLY at the narrowest viewport, so it is NOT byte-identical at desktop. Rejected for the locked surfaces. |
| Extend `reflow-sweep` for no-clip (VERIFY-03) | New `no-clip-sweep.spec.ts` | A new spec keeps the per-element truncation walk (expensive) separate from the cheap page-overflow check, and lets it carry its own allowlist; recommended |

**Installation:** none.

## Package Legitimacy Audit

> This phase installs **no external packages**. All tooling (`@playwright/test`, `next`, `tailwindcss`, `@lhci/cli`, `@axe-core/playwright`, `vitest`) is already a project dependency and was verified present in `node_modules` this session. No registry lookups, no slopcheck run required — there is nothing to install.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none — config + test-authoring only) | — | N/A |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram — the four verification tracks

```
                            Phase 54 Verification Gates
                                      │
        ┌─────────────────┬───────────┴───────────┬──────────────────┐
        ▼                 ▼                       ▼                  ▼
  E2E PLAYWRIGHT      ESLint RATCHET          LIGHTHOUSE          DESIGN AUDIT
  (runtime truth)     (build-time)            (CI perf)           (human/skill)
        │                 │                       │                  │
        │                 │                       │                  │
  ┌─────┴──────┐    ┌──────┴───────┐       ┌───────┴──────┐    ┌──────┴──────┐
  │            │    │ migratable   │       │ re-measure 5 │    │ design-     │
  │ axe-app-   │    │ files → fixed│       │ public routes│    │ review NOW  │
  │ wide +2560 │    │ token alias  │       │ from         │    │             │
  │ (VERIFY-01)│    │ (byte-ident) │       │ .lighthouseci│    │ RT-W2 admin │
  │            │    │              │       │ /*.json      │    │ max-w caps  │
  │ reflow     │    │ EquityChart  │       │              │    │ (VERIFY-05) │
  │ +2560      │    │ + chart-SVG  │       │ minScore =   │    │             │
  │            │    │ → OFF glob   │       │ floor − 0.02 │    │ sign-off =  │
  │ no-clip    │    │ (NEVER edit) │       │ (VERIFY-03)  │    │ human_needed│
  │ sweep      │    │              │       │              │    │             │
  │ (VERIFY-03)│    │ FLIP warn→   │       └──────────────┘    └─────────────┘
  │            │    │ error LAST   │
  │ svg golden │    │ (BP-03)      │
  │ bake (WR-02│    └──────────────┘
  │ pending)   │
  │ (VERIFY-04)│         ALL e2e specs that SEED must pass the FLOW-01
  └─────┬──────┘         dual-wiring gate:  ci.yml MA-8 list  ⨉  spec HAS_SEED_ENV
        │
        ▼
  data flow per seeded test:
  seedTestAllocator() ──▶ loginViaForm() ──▶ page.goto(route@viewport)
        │                                          │
        ▼                                          ▼
  test Supabase (SHARED MA-8 DB)            assertNoReflow / buildAxe / toHaveScreenshot
        │                                          │
        ▼ (VERIFY-02 hermeticity)                  ▼
  explicit teardown of seeded rows          pass/fail → frontend aggregator gate
```

### Pattern 1: FLOW-01 dual-wiring (the twice-(thrice-)burned trap)
**What:** A new seeded e2e spec needs the seed-env self-skip removed from running in two independent places, or it silently never executes in CI.
**When to use:** Every spec that calls a `seed*` helper.
**The two places (both required):**
1. **ci.yml MA-8 list** — `.github/workflows/ci.yml:1266-1282` (`npx playwright test … --timeout 60000`). Add the spec filename here.
2. **The spec's own `HAS_SEED_ENV` const + `test.skip`** — e.g. `axe-app-wide.spec.ts:61-63`. Without the env the spec self-skips so it never false-greens against a login/404 page (the W-02 lesson).
**Precedent:** `e2e/reflow-sweep-authed.spec.ts:33-37` documents the exact pattern; `svg-chart-parity.spec.ts:53-60` repeats it. The seeded MA-8 list comment at `ci.yml:1264` reads "Adding/removing a seed-gated spec? Update both this list and the e2e/<spec>.spec.ts HAS_SEED_ENV constant."

### Pattern 2: Additive-fold into an already-dual-wired spec (no new FLOW-01 wiring)
**What:** When you add a new `test.describe` block to a spec that is ALREADY in the MA-8 list AND already `HAS_SEED_ENV`-gated, you do NOT need new ci.yml wiring.
**Precedent:** `reflow-sweep-authed.spec.ts:289-354` (the 2560 ultra-wide block) and `:155-287` (rotate-stability) are both additive folds into the already-wired host spec. The 2560 reflow row for the allocator subset ALREADY EXISTS this way.
**VERIFY-01 application:** The deferred "seeded 2560px reflow sweep" canary is *partly already done* (allocator subset). What remains for VERIFY-01 is the **app-wide** 2560 row (admin/portfolios/public), which goes into the right host spec per its seed-gating.

### Pattern 3: WR-02 golden-pending guard (green-by-skip until deliberate bake)
**What:** `toHaveScreenshot` hard-fails in CI on a missing baseline (Playwright only writes-and-passes a missing snapshot under `--update-snapshots`, which MA-8 does NOT pass). To land specs WITHOUT baking goldens, scan the snapshot dir for `*.png` and `test.skip` LOUDLY when none exist.
**Source:** `svg-chart-parity.spec.ts:79-102` + `:159`. The guard reads `e2e/__snapshots__/svg-chart-parity.spec.ts/` for any `.png`; finding only `README.md` it skips with `GOLDEN_PENDING_REASON`. The moment goldens land the guard flips automatically — no spec edit.
**VERIFY-04 application:** Every new tolerance-golden spec uses this exact guard so the suite lands green-by-skip; the bake is a separate deliberate `--update-snapshots` run reviewed before commit (Locked Decision).

### Pattern 4: Snapshot determinism (already configured)
**What:** Cross-runner pixel parity requires pinned locale/timezone/colorScheme.
**Source:** `playwright.config.ts:14-18` — `locale: "en-US"`, `timezoneId: "UTC"`, `colorScheme: "light"`. Comment: "number formatting and sub-pixel font hinting shift between Mac dev runners and Linux CI runners." This is already in place — VERIFY-04 inherits it.

### Pattern 5: Fixed-value Tailwind v4 token alias (byte-identity)
**What:** `@theme { --text-fixed-10: 0.625rem; }` generates a `text-fixed-10` utility resolving to **exactly 10px** (16px × 0.625). `text-[10px]` and `text-fixed-10` render identically. `[CITED: tailwindcss.com/docs/font-size]`
**Why not `text-micro`:** `--text-micro: clamp(0.625rem, 0.61rem + 0.0625vw, 0.6875rem)` (`globals.css:143`) renders 10px only at the narrow end and 11px at the wide end — NOT byte-identical at desktop. The fluid spine is for *fresh* type; byte-identity needs the *fixed* alias.
**Drift guard interaction:** The existing `tests/a11y/design-token-drift.test.ts` asserts each `--text-*` clamp matches `TYPE_SCALE`. A NEW fixed `--text-fixed-*` token must either be added to `TYPE_SCALE` (with `clamp` = the bare rem so the verbatim check passes) OR the drift test's tier-set must be scoped to the fluid spine only. **Plan must reconcile this** — adding a `--text-*` token that the drift test doesn't know about will red it.

### Anti-Patterns to Avoid
- **Editing `EquityChart.tsx` to migrate its 4 raw-px sites** → reds `phase-52-frozen-spine-guards.test.ts` (git-diff-zero). Use the `off` glob / file-scoped exemption instead.
- **Blind `--update-snapshots`** to clear pending goldens → explicit Out-of-Scope ban (REQUIREMENTS.md "Out of Scope"). Deliberate per-chart bake only.
- **Adding `axe-app-wide` authed rows to the shared MA-8 invocation without teardown** → the exact v1.3 pollution that regressed three specs (see VERIFY-02).
- **Narrowing the `DashboardChrome.isWide` regex for RT-W2** → explicitly rejected in CONTEXT (fragile; admin tree mixes prose + data).
- **Flipping the whole `allocations/**` or `factsheet/[id]/v2/**` glob to error** → reds CI on the orphan + frozen files; the ratchet is per-file/per-surface (Phase-52 deferred-items lesson).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Horizontal-overflow detection | A bespoke overflow walker | `assertNoReflow(page, anchor)` (`e2e/helpers/reflow.ts:47`) | Already has the `clientWidth` (not innerWidth) subtlety, `<=1px` slop, visible-anchor false-green guard, offender breadcrumb, and `toPass` retry |
| Seeded test allocator/strategy/book | New seed code | `seedTestAllocator` / `seedStrategyWithHistory` / `seedAllocatorBook` (`seed-test-project.ts`) | Carries prod-URL safety probes (`assertNotProductionSupabaseUrl`), verified-profile + attestation upserts, rerun-safe unique emails |
| Golden-pending guard | A new skip mechanism | The WR-02 dir-scan idiom (`svg-chart-parity.spec.ts:79-102`) | Proven; auto-flips when PNGs land |
| Snapshot determinism | Per-spec locale pins | `playwright.config.ts` global `use` block | Already pins en-US/UTC/light |
| lhci per-route scores | A custom Lighthouse run | Parse `.lighthouseci/manifest.json` + `*.report.json` (already uploaded as `lighthouse-mobile-report` artifact) | lhci autorun already emits per-URL `categories.performance.score`; the artifact path is `.lighthouseci/` (`ci.yml:1480`) |
| Frozen-island protection | A new diff guard | `phase-52-frozen-spine-guards.test.ts` | Already git-diff-inspects the 8 frozen paths; non-vacuity-verified |

**Key insight:** This phase is almost entirely *wiring existing helpers into new matrix rows + flipping config*. The only genuinely new test code is the no-clip per-element truncation walk (VERIFY-03), and even that reuses the `assertTargetSizes` per-element-loop idiom.

## Runtime State Inventory

> Not a rename/refactor/migration phase in the data sense, BUT BP-03 is a repo-wide string migration (`text-[Npx]` → token utilities) with one CI-state subtlety. Categories below answered explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no DB writes, no datastore keys change. Verified: phase touches only e2e specs, CI yaml, eslint config, globals.css, and component classNames. | none |
| Live service config | **Golden PNG baselines** are committed test fixtures, NOT live service config. `e2e/__snapshots__/svg-chart-parity.spec.ts/` holds only `README.md` today (no PNGs) — the bake commits PNGs there. `e2e/demo-screenshot.spec.ts-snapshots/` holds 3 committed `*-chromium-linux.png`. | bake = deliberate CI commit (deferred) |
| OS-registered state | None. | none — verified, no scheduler/daemon involved |
| Secrets/env vars | `TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY` gate the seeded specs (read at call time in `seed-test-project.ts:49`). `vars.E2E_TEST_DB_CONFIGURED == 'true'` gates the CI MA-8 job (`ci.yml:1237`). **No new secret needed** — VERIFY-02 reuses these. | none (reuse existing) |
| Build artifacts / installed packages | **The ESLint `error` flip (BP-03) changes CI behavior, not an artifact** — once flipped, any future raw-px reintroduction fails lint. The `lighthouserc.json` minScore change is a config constant. No compiled artifact carries a stale value. | none — config edits take effect on next CI run |

**The canonical question — after every file is updated, what runtime systems still carry the old state?** Answer: the **golden PNG baselines** (deliberately not baked yet, by Locked Decision) and the **lhci CI baseline** (re-measured fresh this phase). Both are handled in-phase. Nothing else caches the old state.

## Common Pitfalls

### Pitfall 1: FLOW-01 dual-wiring (burned ≥3× per memory)
**What goes wrong:** A new seeded spec is added to the ci.yml MA-8 list but not given a `HAS_SEED_ENV` self-skip (or vice-versa), so it either false-greens against a login page or never runs.
**Why it happens:** Two independent gates that look redundant but aren't.
**How to avoid:** For EVERY seeded spec, verify BOTH: (1) filename in `ci.yml:1266-1282`, (2) `HAS_SEED_ENV` const + `test.skip(!HAS_SEED_ENV, …)` in the spec. For additive folds into an already-wired host spec, NO new wiring is needed (Pattern 2).
**Warning signs:** A spec that "passes" in CI with 0 assertions run; a grep of the MA-8 list not matching the spec set.

### Pitfall 2: v1.3 seeded-DB pollution (the exact reason authed axe rows are dormant)
**What goes wrong:** Adding broad authed seeding to the SHARED MA-8 invocation leaves rows around that other specs assert against. Documented at `ci.yml:1298-1309` and `axe-app-wide.spec.ts:36-46`: the v1.3 attempt (a) `seedBridgeCandidate({categorySlug:"crypto-sma"})` published a non-example strategy that `discovery-hide-examples-default.spec.ts` asserts is EMPTY; (b) its public rows re-ran against the rebuilt test-Supabase and 500'd `/demo`; (c) the polluted DB produced spurious wizard axe findings the focused `wizard-axe.spec.ts` doesn't see.
**Why it happens:** All MA-8 specs share ONE test database; no per-spec isolation or teardown.
**How to avoid (VERIFY-02):** Each authed axe test seeds a FRESH allocator (already rerun-safe via timestamped+random email) AND **explicitly tears down its seeded rows in an `afterEach`/`afterAll`** (or scopes the discovery seed to a throwaway category, never `crypto-sma`). The discovery row is the dangerous one — `seedBridgeCandidate({categorySlug:"crypto-sma"})` at `axe-app-wide.spec.ts:187` must either be deleted after the test or use a dedicated test-only category. The allocator/strategy/wizard rows are owned by unique users and are inert to other specs, but should still be torn down for true hermeticity.
**Warning signs:** `discovery-hide-examples-default` going red after enabling authed axe; `/demo` 500s.

### Pitfall 3: The @container same-element reflow bug (Tailwind v4)
**What goes wrong:** At 2560px (VERIFY-01) a container-query layout that put the `@container` host and the `@`-variant utility on the SAME element silently freezes grids 1-wide. Memory (P52/P53 ⭐ red-team): "Tailwind v4: host + `@`-variants MUST be parent/child, never one element — grids froze 1-wide; jsdom class-string tests false-passed."
**Why it happens:** A `@container` element does not query itself; the `@sm:grid-cols-2` must be on a CHILD of the `@container`-declared parent.
**How to avoid:** The 2560 reflow row is a RUNTIME browser check (`assertNoReflow`) — it catches the frozen-1-wide overflow that jsdom class-string tests miss. Any 2560 layout finding traces to a same-element host/variant; fix by splitting host (parent) from variant (child). The P53 admin tables already did this (`STATE.md:280` "host strict-ancestor of @-variant cells, mutation-verified").
**Warning signs:** A 2560 reflow pass but a visibly 1-wide grid in the design-review screenshot; a jsdom test green while the real render is broken.

### Pitfall 4: EquityChart byte-identity vs the frozen-spine guard (the central BP-03 landmine)
**What goes wrong:** Editing `EquityChart.tsx` to swap its 4 `text-[10px]/[11px]` sites for a token turns `phase-52-frozen-spine-guards.test.ts` RED (it git-diff-checks `FROZEN_ISLANDS` at `:158`).
**Why it happens:** Two requirements collide — BP-03 says "incl. the frozen EquityChart" but the frozen-spine guard says "zero diff."
**How to avoid:** Do NOT edit EquityChart. Add it (and TimeSeriesChart/HistogramChart/MasterBrush) to the `off` glob — the same mechanism `src/components/charts/**` already uses (`eslint.config.mjs:193-199`). The raw px then "no longer remains" in the lint sense (the rule is `off`, so it's not a warn/error orphan). This satisfies "no raw px remains AND render byte-identical" by exemption, exactly as Phase-52 deferred-items prescribes ("keep EXEMPT", "NEVER migrate"). Document each with a `DS-04 sanctioned-exception:` comment if a glob isn't preferred.
**Warning signs:** A frozen-spine guard going red; a git diff touching any `FROZEN_ISLANDS` path.

### Pitfall 5: lhci has no `preset:"mobile"`; re-measure must read the artifact JSON
**What goes wrong:** Setting `preset:"mobile"` fails `lhci collect` (invalid value). Already learned — `lighthouserc.json` uses `settings.formFactor:"mobile"` + `screenEmulation` (`lighthouserc.json:2` comment).
**Why it happens:** Lighthouse 12.x `preset` only accepts perf/experimental/desktop.
**How to avoid (VERIFY-03):** Keep the existing `formFactor`/`screenEmulation`. To re-measure: the job already uploads `.lighthouseci/` as the `lighthouse-mobile-report` artifact (`ci.yml:1479-1480`). Read per-URL `categories.performance.score` from `.lighthouseci/manifest.json` + the `*.report.json` files (lhci autorun emits these). Set `minScore = (lowest measured median) − 0.02`. The 2026-06-28 single-run baseline was `/demo 0.67` lowest (`lighthouserc.json:_baseline`); the FIRST CI 3-run median establishes the true floor to ratchet from — do NOT day-one to 0.90+.
**Warning signs:** lhci flaking red after a too-aggressive bump; a hardcoded 0.65 guess instead of a measured floor.

### Pitfall 6: lhci must hit the PROD build, not `next dev`
**What goes wrong:** Measuring against `next dev` gives garbage perf scores.
**How to avoid:** Already correct — `lighthouserc.json:4` `startServerCommand: "npm run start"`. Don't change it.

### Pitfall 7: jsdom can't tell 1100px from 1440px (RT-W2 width tests)
**What goes wrong:** A render-based width test reads `getBoundingClientRect()=0` in jsdom (no layout engine), so it can't verify a `max-w` cap.
**Why it happens:** jsdom has no CSS layout.
**How to avoid (RT-W2):** Use the Phase-38 `composer-width.test.tsx` precedent (`STATE.md:270`) — a static source-scan (`readFileSync` + className substring assertions), NOT a render test. Assert the 4 admin prose/form pages contain the new inner `max-w-*` and the data tables do NOT.
**Warning signs:** A width test that passes regardless of the actual class (false-green).

## Code Examples

### VERIFY-01 — extend the axe VIEWPORTS matrix to 2560
```typescript
// Source: e2e/axe-app-wide.spec.ts:92 (current)
const VIEWPORTS = [
  { w: 1280, h: 800, name: "Desktop" },
  { w: 375, h: 812, name: "mobile" },
] as const;
// VERIFY-01: add the ultra-wide row →
//   { w: 2560, h: 1440, name: "ultrawide" },
// The for-loops at :100 and :132 and :245 iterate VIEWPORTS, so adding the row
// fans every public + (re-enabled) authed + embedded scan out to 2560 automatically.
```

### VERIFY-02 — hermetic teardown for the authed axe rows (the dangerous discovery seed)
```typescript
// The ONLY cross-spec-visible seed is the discovery row at axe-app-wide.spec.ts:187:
//   await seedBridgeCandidate({ categorySlug: "crypto-sma" });   // <-- pollutes
// Hermetic fix: capture the seeded ids + delete them after, OR use a throwaway
// category that no other spec asserts is empty. Pattern (service-role admin):
//   const seeded = await seedBridgeCandidate({ categorySlug: "crypto-sma" });
//   try { /* login + goto + axe */ }
//   finally { await admin.from("strategies").delete().eq("id", seeded.strategyId); }
// Source for the delete capability: seed helpers use the same service-role admin
// client (seed-test-project.ts:48 getAdmin()); seedBridgeCandidate already RETURNS
// { strategyId, ownerUserId } (seed-test-project.ts:273-278) — teardown is a delete by id.
```

### VERIFY-03 — runtime no-clip probe (reuse the reflow.ts DOM-eval idiom)
```typescript
// New e2e/no-clip-sweep.spec.ts — per-element truncation walk.
// Detects scrollWidth>clientWidth on text elements + CSS-ellipsis cut-off.
// Mirrors assertTargetSizes' per-element loop (reflow.ts:130) + a documented
// allowlist for deliberate line-clamp / avatar clips.
const clipped = await page.evaluate(() => {
  const ALLOW = ['[data-clamp-ok]', '.avatar', '[class*="line-clamp"]'];
  const out: string[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    if (ALLOW.some((s) => el.matches(s) || el.closest(s))) continue;
    const cs = getComputedStyle(el);
    const ellipsis = cs.textOverflow === "ellipsis" && cs.overflow !== "visible";
    const overflowed = el.scrollWidth > el.clientWidth + 1;
    if (ellipsis && overflowed && (el.textContent ?? "").trim().length > 0) {
      out.push(`${el.tagName}.${(el.className||"").toString().split(" ")[0]}`);
    }
  }
  return out;
});
expect(clipped, `truncated/ellipsis-clipped text: ${clipped.join(", ")}`).toEqual([]);
// CI wiring: this runs UNSEEDED on public routes (mirrors reflow-sweep.spec.ts) +
// SEEDED on authed routes (mirrors reflow-sweep-authed.spec.ts). FLOW-01 dual-wire
// the seeded half. Anchor each route on a visible element first (false-green guard).
```

### BP-03 — fixed-value token alias (byte-identical to text-[10px]/[11px])
```css
/* Source mechanism: tailwindcss.com/docs/font-size — @theme generates text-{name}.
   Add to a PLAIN @theme block in globals.css (NOT @theme inline). */
@theme {
  --text-fixed-10: 0.625rem;   /* = 10px @16px root — byte-identical to text-[10px] */
  --text-fixed-11: 0.6875rem;  /* = 11px @16px root — byte-identical to text-[11px] */
}
/* Then: text-[10px] -> text-fixed-10 in migratable files (NOT EquityChart/chart-SVG).
   NB: reconcile tests/a11y/design-token-drift.test.ts — it asserts every --text-*
   matches TYPE_SCALE. Either scope its tier-set to the fluid spine, or register the
   fixed aliases there too. */
```

### BP-03 — exempt the frozen + chart-internal files (the compliant path, NOT an edit)
```javascript
// Source: eslint.config.mjs:193-199 (the existing charts off-glob precedent).
// Add EquityChart (FROZEN) + the 3 chart-internal SVG files to an OFF glob so the
// repo-wide error flip passes without editing them:
{
  files: [
    "src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx", // FROZEN_ISLANDS:158 — never edit
    "src/app/factsheet/[id]/v2/TimeSeriesChart.tsx",
    "src/app/factsheet/[id]/v2/HistogramChart.tsx",
    "src/app/factsheet/[id]/v2/MasterBrush.tsx",
  ],
  rules: { "quantalyze/no-raw-font-px": "off" },
},
// THEN flip the repo-wide rule (eslint.config.mjs:82) from "warn" to "error".
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Desktop byte-identity goldens (v1.3 invariant) | Tolerance `toHaveScreenshot` ±2–5% goldens, deliberate per-chart bake | v1.4 (this phase, VERIFY-04) | Visual layer free to evolve; pixel parity replaced by tolerance |
| `no-raw-font-px: warn` repo-wide + per-file `error` ratchet | `no-raw-font-px: error` repo-wide + `off` glob for frozen/chart files | v1.4 (BP-03) | Future raw-px reintroduction fails CI |
| lhci `minScore: 0.6` (7pts under single-run) | minScore = 3-run-CI-median floor − 0.02 | v1.4 (VERIFY-03) | Data-driven floor that ratchets up |
| Authed/mobile axe rows dormant (shared-DB pollution) | Re-enabled with per-test fresh-allocator + teardown | v1.4 (VERIFY-02) | Authed a11y gated in CI |

**Deprecated/outdated:**
- `e2e/strategy-v2-chart-parity.spec.ts` — **DEAD** (`test.skip(true)` at `:47`). Authored against Recharts `path[stroke]` assumptions but `EquityCurve` uses `lightweight-charts` (canvas — no SVG paths). Goldens never baked. **NOT a VERIFY-04 bake target** — leave it skipped (do not revive without a canvas-API rewrite). The live bake target is `svg-chart-parity.spec.ts`.
- `preset:"mobile"` in lhci — invalid in Lighthouse 12.x (use `formFactor`).

## Validation Architecture

> nyquist_validation: config not inspected as explicitly `false` — section INCLUDED (absent/true ⇒ enabled). The phase IS the validation, so this maps phase requirements to the gates they install.

### Test Framework
| Property | Value |
|----------|-------|
| Frameworks | `@playwright/test` 1.61.1 (e2e gates) + `vitest` ^4.1.2 (guard/byte-identity/drift unit tests) |
| Config files | `playwright.config.ts` (single chromium, en-US/UTC/light pinned); `vitest.config.ts` (coverage ratchet = BLOCKING gate); `lighthouserc.json`; `eslint.config.mjs` |
| Quick run (lint flip proof) | `npx eslint "src/**/*.{ts,tsx}"` (expect 0 errors after BP-03) |
| Quick run (unit guards) | `npx vitest run src/__tests__/phase-52-frozen-spine-guards.test.ts tests/a11y/design-token-drift.test.ts` |
| Full e2e (seeded) | the ci.yml MA-8 list (`ci.yml:1266`), runs only when `vars.E2E_TEST_DB_CONFIGURED == 'true'` |
| lhci | `npx lhci autorun --config=lighthouserc.json` (prod `npm run start`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command / Gate | File Exists? |
|--------|----------|-----------|--------------------------|-------------|
| VERIFY-01 | 2560 row green app-wide (axe + reflow) | e2e (seeded + unseeded) | MA-8 + unseeded playwright lists | ✅ host specs exist (`axe-app-wide`, `reflow-sweep`, `reflow-sweep-authed`); add 2560 to `VIEWPORTS`/route lists |
| VERIFY-01 | svg goldens at 2560 + deferred canaries | e2e screenshot | `svg-chart-parity.spec.ts` (WR-02 pending) | ✅ spec exists; goldens pending bake |
| VERIFY-02 | authed + mobile axe rows hermetic | e2e (seeded) | un-skip the authed/embedded describes in `axe-app-wide.spec.ts` + add to MA-8 list + teardown | ✅ describes exist (`:123`,`:236`), currently dormant |
| VERIFY-03 | lhci minScore raised | CI config | `lhci autorun`; re-measure from `.lighthouseci/*.json` | ✅ `lighthouserc.json` + job exist |
| VERIFY-03 | no-clip guard | e2e (seeded+unseeded) | new `e2e/no-clip-sweep.spec.ts` | ❌ Wave 0 — new spec, dual-wire FLOW-01 |
| VERIFY-04 | tolerance goldens replace byte-identity | e2e screenshot (pending bake) | `svg-chart-parity.spec.ts` + any new tolerance specs (WR-02 guard) | ✅ pattern exists; bake deferred |
| VERIFY-05 | design-review audit | skill / manual | gsd-ui-review (runs now) | N/A (audit artifact) |
| VERIFY-05 | real-device sign-off | human checkpoint | `human_needed` VERIFICATION.md item | N/A (deferred) |
| VERIFY-05 | RT-W2 admin caps | unit (static source-scan) | new `admin-width.test.tsx` (Phase-38 `composer-width.test.tsx` idiom) | ❌ Wave 0 — new static-scan test |
| BP-03 | no-raw-font-px error repo-wide | lint | `npx eslint` 0 errors | ✅ rule + config exist; flip + globs needed |
| BP-03 | scenario.ts/FactsheetBody byte-equivalent | unit | `phase-52-frozen-spine-guards.test.ts` + FactsheetBody GUARD-02 innerHTML test | ✅ guards exist — must stay GREEN |
| BP-03 | token-drift not broken by fixed alias | unit | `tests/a11y/design-token-drift.test.ts` | ✅ — must reconcile with new `--text-fixed-*` |

### Sampling Rate
- **Per task commit:** the touched unit guard (`phase-52-frozen-spine-guards` for any chart-adjacent edit; `design-token-drift` for any `@theme` edit) + `npx eslint` on touched files.
- **Per wave merge:** full `npx vitest run` (coverage ratchet is the blocking `frontend` gate) + `npx eslint "src/**/*.{ts,tsx}"`.
- **Phase gate:** full unit suite green + lint 0 errors + (in a configured CI) the MA-8 seeded e2e list green-or-skip + lhci green at the new floor, before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `e2e/no-clip-sweep.spec.ts` — covers VERIFY-03 no-clip; dual-wire FLOW-01 (ci.yml unseeded list + seeded MA-8 list + `HAS_SEED_ENV` const for the authed half)
- [ ] `src/__tests__/admin-width.test.tsx` (or co-located) — covers VERIFY-05 RT-W2; static source-scan, NOT render (jsdom Pitfall 7)
- [ ] `--text-fixed-10` / `--text-fixed-11` tokens in `globals.css` `@theme` + reconcile `design-token-drift.test.ts`
- [ ] No new framework install — Playwright/vitest/lhci all present
- [ ] Golden PNGs: deliberately NOT baked Wave 0 (Locked Decision) — WR-02 guard keeps green-by-skip

## Security Domain

> `security_enforcement` not explicitly `false` in scope — section included. This is a verification/CI phase with low direct security surface, but two ASVS-relevant points apply to the test infra.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (test seed) | Service-role admin createUser is test-only; `assertSupabaseServiceRoleKey` + `assertNotProductionSupabaseUrl` guard prod misconfig (`seed-test-project.ts:59-60`) |
| V3 Session Management | no | — |
| V4 Access Control | yes (axe re-enable) | The authed axe rows seed verified allocators; no privilege escalation — they read their own honest-empty surfaces |
| V5 Input Validation | no | No new user input surface |
| V6 Cryptography | no | No crypto — `api_key_encrypted` placeholder ciphertext is test-only (`seed-test-project.ts:524`) |

### Known Threat Patterns for {test-infra}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Test seed pointed at PROD Supabase → prod data mutation | Tampering | `assertNotProductionSupabaseUrl` prod-URL probe at the seed boundary (`seed-test-project.ts:59`); `vars.E2E_TEST_DB_CONFIGURED` gate + the Plan-11-07 blast-radius checkpoint |
| lhci artifact uploads an authed URL → info disclosure to temporary-public-storage | Information Disclosure | lhci collects PUBLIC routes ONLY (`lighthouserc.json` 5 public urls; T-48-05-INFO) — keep VERIFY-03 public-only |
| Seeded rows leak into other specs (pollution) | Tampering | Per-test teardown (VERIFY-02) — the v1.3 lesson |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The "153 orphan sites" in REQUIREMENTS reflects the warn-orphan SUBSET; the live grep shows **249** raw-px occurrences across ~62 production files (counting tests excluded). The figure to plan against is the live grep, not 153. | BP-03 | LOW — plan should grep fresh; the migration set is "every file not already at error and not in the off-glob". |
| A2 | lhci autorun writes per-URL `categories.performance.score` into `.lighthouseci/manifest.json` + `*.report.json`. `[CITED: web.dev/lighthouse-ci + lhci docs]` but the EXACT JSON shape in 0.15.1 wasn't opened this session. | VERIFY-03 | LOW — if the parse path differs, read the uploaded `lighthouse-mobile-report` artifact manually once to confirm the field path. |
| A3 | Adding a fixed `--text-fixed-*` token to `@theme` will trip `design-token-drift.test.ts` unless reconciled. Inferred from the test asserting "every `--text-*` matches TYPE_SCALE" — the exact assertion (does it iterate ALL `--text-*` or only TYPE_SCALE keys?) needs a read of the full test body at plan time. | BP-03 / Pattern 5 | MEDIUM — if the test only iterates TYPE_SCALE keys (not all `--text-*`), no reconciliation is needed. Confirm before adding the token. |
| A4 | The three "deferred Phase-52 canaries" for VERIFY-01: the seeded 2560 reflow row ALREADY EXISTS for the allocator subset (`reflow-sweep-authed.spec.ts:289`); the svg goldens are the WR-02-pending `svg-chart-parity.spec.ts`; "authed ultra-wide" = the authed axe rows at 2560. What remains is APP-WIDE coverage (admin/portfolios/public 2560) + the bake. | VERIFY-01 | LOW — verified against the live specs. |
| A5 | The chart-internal `text-[10px]/[11px]` in TimeSeriesChart/HistogramChart/MasterBrush are HTML element classNames (legend `<p>`, range buttons, flex `<div>`s), NOT SVG `<text fontSize>` coordinate math — so they COULD migrate, but Phase-52 deferred-items says keep them EXEMPT. CONTEXT BP-03 says give them fixed-token aliases OR a documented exemption. Plan picks per file. | BP-03 | LOW — both paths satisfy "no raw px remains"; the off-glob is simplest and matches precedent. |

## Open Questions (RESOLVED)

1. **Does `design-token-drift.test.ts` iterate ALL `--text-*` tokens or only `TYPE_SCALE` keys?**
   - **RESOLVED:** pattern-mapper read the test — it iterates `Object.entries(TYPE_SCALE)` ONLY (`tests/a11y/design-token-drift.test.ts:117`). A `--text-fixed-*` token kept OUT of `TYPE_SCALE` is invisible to all four `it.each` blocks → **no drift-test edit needed**; the fixed aliases are free.
   - What we know: it asserts each `TYPE_SCALE` tier's clamp appears verbatim in the plain `@theme` block, and that NO `--text-*` lives in `@theme inline`.
   - Recommendation: keep the fixed aliases out of `TYPE_SCALE`; they live in the plain `@theme` block, untouched by the drift test.

2. **Exact lhci re-measure mechanics in 0.15.1.**
   - **RESOLVED:** read the measured per-route score from the existing run's report (`summary.categories.performance.score`); the `.lighthouseci/` artifact currently uploads `if: failure()` only (`ci.yml:1477`), so plan 54-04 makes the upload/measure deterministic, then sets `minScore = measured floor − 0.02`. No separate measure-only run needed beyond making the score readable.
   - What we know: the job uploads `.lighthouseci/` as an artifact; lhci emits per-URL JSON reports.

3. **VERIFY-02 teardown granularity — afterEach vs afterAll vs throwaway category.**
   - **RESOLVED:** plan 54-08 gives the discovery axe test its own per-`strategyId` teardown (delete the seeded strategy by returned id in a `finally`/afterAll); the per-unique-user allocator/strategy/wizard seeds are inert but torn down for hygiene.
   - What we know: only the discovery seed (`crypto-sma`) is cross-spec-dangerous.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@playwright/test` | all e2e | ✓ | 1.61.1 | — |
| `tailwindcss` | BP-03 token alias | ✓ | 4.3.1 | — |
| `@lhci/cli` | VERIFY-03 | ✓ | 0.15.1 | — |
| `vitest` | unit guards | ✓ | ^4.1.2 | — |
| Test Supabase project (`TEST_SUPABASE_URL`) | VERIFY-02 seeded run | ✗ in this sandbox (no network) | — | Specs land green-by-skip via `HAS_SEED_ENV`; seeded run executes in configured CI (`vars.E2E_TEST_DB_CONFIGURED`) |
| Playwright Chromium browser binary | running e2e locally | unknown (not probed) | — | `npx playwright install chromium`; CI installs with `--with-deps` (`ci.yml:1041`) |
| Real mobile device | VERIFY-05 sign-off | ✗ | — | `human_needed` checkpoint (Locked Decision) |
| External network (Bash) | live canary / golden bake | ✗ | — | Bake = deferred controlled CI run; canaries via Playwright MCP per project memory |

**Missing dependencies with no fallback (block live execution here, NOT planning/coding):**
- Real device (VERIFY-05 sign-off) — deferred to human checkpoint by Locked Decision.
- Live golden bake network — deferred to controlled CI run by Locked Decision.

**Missing dependencies with fallback:**
- Test Supabase / `E2E_TEST_DB_CONFIGURED` — specs land green-by-skip; run in configured CI.

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **AGENTS.md:** "This is NOT the Next.js you know" — Next 16.2.9 has breaking changes; read `node_modules/next/dist/docs/` before asserting any Next API. (This phase touches almost no Next API — it's test/CI/lint/CSS — but `loading.tsx`/`error.tsx` conventions are P53-owned and stable.)
- **Coverage is a BLOCKING CI gate** (CLAUDE.md): lines 82 / statements 80 / functions 74 / branches 72, configured in `vitest.config.ts`. New unit guards (RT-W2 static-scan, etc.) must not drop coverage below the ratchet; the `frontend-coverage` job + `frontend` aggregator gate branch protection.
- **DESIGN.md is the single source of truth** for any visual decision — read before any token/spacing change. BP-03 fixed aliases must not introduce new visual values (byte-identity is the whole point).
- **Skill routing:** QA → `qa`; design audit → `design-review`/`design-consultation`; ship → `ship`. VERIFY-05 design audit routes through the design-review skill.
- **Rule 12 fail-loud:** every new guard must go RED on a real regression, never silently skip. The WR-02 golden-pending guard skips LOUDLY (annotated), which is compliant.
- **`frontend` aggregator is the real gate**; e2e is advisory (main has no branch protection beyond the aggregator). Per memory, the seeded e2e job only runs when `E2E_TEST_DB_CONFIGURED == 'true'`.

## Sources

### Primary (HIGH confidence — verified at file:line this session)
- `e2e/axe-app-wide.spec.ts` (VIEWPORTS:92, HAS_SEED_ENV:61, authed describe:123, embedded:236, pollution note:36-46)
- `e2e/reflow-sweep.spec.ts` + `e2e/reflow-sweep-authed.spec.ts` (2560 block:289-354, additive-fold precedent)
- `e2e/svg-chart-parity.spec.ts` (WR-02 guard:79-159, tolerances 0.02/0.05:215-228)
- `e2e/strategy-v2-chart-parity.spec.ts` (DEAD spec:47, canvas mismatch)
- `e2e/demo-screenshot.spec.ts` (committed baselines + 0.05 full-page tolerance + Docker bake recipe)
- `e2e/helpers/reflow.ts` (assertNoReflow:47, assertTargetSizes:119) + `e2e/helpers/seed-test-project.ts` (all seed helpers + safety probes)
- `playwright.config.ts` (en-US/UTC/light determinism pins)
- `lighthouserc.json` (minScore:0.6, formFactor, baseline scores, no-preset note)
- `eslint.config.mjs` (warn:82, design-tokens error:91, P52/P53 per-file ratchet:107-188, charts off-glob:193, test exempt:221)
- `tools/eslint-plugin-quantalyze/rules/no-raw-font-px.mjs` (detection shapes, DS-04 marker)
- `src/lib/design-tokens/typography.ts` + `src/app/globals.css:135-144` (fluid `--text-*` spine; micro = clamp 10→11px)
- `src/__tests__/phase-52-frozen-spine-guards.test.ts` (FROZEN_ISLANDS:152-160, git-diff mechanism)
- `src/components/charts/chart-tokens.ts` (chart literal-hex pattern)
- `src/components/layout/DashboardChrome.tsx:61-77` (isFullBleed / isWide regex)
- `.github/workflows/ci.yml` (unseeded list:1073, MA-8 seeded list:1266-1282, pollution rationale:1298-1309, lighthouse-mobile job:1371-1480)
- `.planning/phases/52-…/deferred-items.md` (orphan-px debt list, EquityChart NEVER migrate, chart-SVG keep exempt, isWide resolution)
- `.planning/STATE.md` (P52/P53 decisions, composer-width.test static-scan idiom:270, admin @container parent/child:280)
- `node_modules` version probes (Playwright 1.61.1, Next 16.2.9, Tailwind 4.3.1, lhci 0.15.1)

### Secondary (MEDIUM confidence)
- `[CITED: tailwindcss.com/docs/font-size]` — `@theme { --text-*: <fixed value> }` generates a `text-{name}` utility resolving to exactly that size (the byte-identity alias mechanism).
- `[CITED: web.dev/articles/lighthouse-ci]` + lhci autorun docs — per-URL `categories.performance.score` in the manifest/report JSON.

### Tertiary (LOW confidence — flagged in Assumptions Log)
- Exact JSON field path in lhci 0.15.1 reports (A2) — confirm against a real artifact.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified in node_modules; no installs.
- Architecture / patterns: HIGH — every pattern has a live file:line precedent in this repo.
- Pitfalls: HIGH — the FLOW-01, pollution, @container, and frozen-spine landmines are all documented in-repo and corroborated by project memory.
- BP-03 byte-identity mechanism: HIGH on the mechanism (Tailwind docs + the fluid-vs-fixed distinction is provable), MEDIUM on the drift-test reconciliation (Open-Q1).
- lhci re-measure: MEDIUM — mechanism cited, exact field path unconfirmed (A2).

**Research date:** 2026-06-30
**Valid until:** 2026-07-30 (stable — config/CI/test infra; the only fast-moving input is the lhci CI baseline, re-measured in-phase)

## RESEARCH COMPLETE

Phase 54 is a gate-hardening phase with **zero new package installs** — every requirement maps to wiring an already-present helper into a new matrix row, flipping a config constant, or authoring a test against a documented in-repo precedent. The four tracks (e2e matrix/no-clip/goldens, eslint px→token ratchet, lhci re-measure, design audit) each have direct precedents, and the dominant risks are procedural not technical: the FLOW-01 dual-wiring trap (ci.yml MA-8 list ⨉ spec `HAS_SEED_ENV`), the v1.3 shared-DB pollution trap (only the `crypto-sma` discovery seed is cross-spec-dangerous — tear it down), the Tailwind-v4 same-element `@container` reflow bug at 2560 (caught by the runtime `assertNoReflow` probe), and the one genuine architectural collision: **BP-03 cannot edit the git-diff-frozen `EquityChart.tsx`** — it (and the three chart-internal SVG files) must move to an ESLint `off` glob so the repo-wide `error` flip passes while the render stays byte-identical, exactly as Phase-52's `deferred-items.md` prescribes. Fixed-value token aliases (`--text-fixed-10/11` = `0.625rem`/`0.6875rem`) give byte-identity for the ~40 migratable files (the fluid `text-micro` clamp does NOT), with one reconciliation needed against `design-token-drift.test.ts`. The golden bake and real-device sign-off correctly land green-by-skip (WR-02 guard) and `human_needed` per the Locked Decisions.

Sources:
- [Tailwind CSS font-size docs](https://tailwindcss.com/docs/font-size)
- [web.dev — Performance monitoring with Lighthouse CI](https://web.dev/articles/lighthouse-ci)

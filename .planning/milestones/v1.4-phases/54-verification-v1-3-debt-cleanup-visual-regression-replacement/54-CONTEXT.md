# Phase 54: Verification + v1.3 debt cleanup + visual-regression replacement - Context

**Gathered:** 2026-06-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the v1.4 milestone with app-wide verification — everything built in 49–53 must now have
a gate to defend it. Add the ultra-wide (2560px) row to the axe/reflow matrix; re-enable the
authed + mobile axe rows against a hermetic seeded DB; ratchet the lhci mobile budget up from 0.60;
add a no-clip CI guard; replace lifted desktop byte-identity with tolerance-based Playwright
goldens (deliberate per-chart re-baseline, never blind `--update-snapshots`); complete the deferred
Phase-52 px→token migration (flip the remaining ~153 `no-raw-font-px` `warn` orphans to `error`
repo-wide); fold in v1.3 debt; and run a real-device authed sign-off + app-wide design-review audit.

Requirements: VERIFY-01 (ultra-wide matrix), VERIFY-02 (authed/mobile axe re-enable), VERIFY-03
(lhci ratchet + no-clip guard), VERIFY-04 (tolerance goldens + per-chart re-baseline), VERIFY-05
(real-device sign-off + app-wide design-review audit + RT-W2 admin over-stretch), BP-03 (v1.3 debt
fold + px→token completion).

**LOCKED invariants (must stay intact and be proven):** `scenario.ts` / `compute.ts` engine frozen;
WCAG-AA floor; `scenario.ts` / `FactsheetBody` byte-equivalent on the locked surfaces; desktop
byte-identity is being *replaced* by tolerance goldens, not loosened.
</domain>

<decisions>
## Implementation Decisions

### Verification scope & deferrals (VERIFY-04 / VERIFY-05 / VERIFY-01 goldens)
- Build all code, CI wiring, tolerances, masking, and the re-baseline harness **now**.
- The actual golden PNG **bake** happens in a controlled CI run — **never** blind `--update-snapshots`.
  Land the specs + tolerances + masking + the `WR-02`-style golden-pending guard so the suite is
  green-by-skip until a deliberate per-chart re-baseline commits the PNGs.
- **Real-device authed sign-off (VERIFY-05) is a human checkpoint** — this environment has no real
  device and the Bash sandbox has no external network. It lands as a `human_needed` verification
  item, consistent with prior milestones' deferred authed UATs. The **app-wide design-review audit**
  portion of VERIFY-05 CAN and WILL run now (design-review skill / gsd-ui-review).

### Admin prose/form over-stretch — RT-W2 (VERIFY-05)
- **Per-page inner `max-w` cap** on the handful of prose/form admin pages — `partner-import`,
  `users`, `users/[id]`, and the for-quants-leads admin view. Data tables keep the wide 1920px
  measure (the `DashboardChrome.isWide` regex stays as-is). Surgical, low blast radius.
- Rejected: narrowing the `isWide` regex — fragile, the admin tree mixes prose and data page types
  under the same `/admin` prefix; one regex can't cleanly separate them.

### Thresholds & gate mechanisms (VERIFY-03)
- **lhci ratchet:** re-measure all 5 public routes in CI first, then set the budget to the new
  measured floor **minus 2 points** (data-driven, replaces the flat-0.65 guess). Keep the
  "under-actual so a real regression fails but noise doesn't flake" philosophy.
- **No-clip guard:** **runtime Playwright sweep** — detect content cut-off (`scrollWidth >
  clientWidth` / truncated text) across routes × viewports and fail the build on any reintroduced
  truncation/ellipsis/clip. More truthful than a static class ban (catches actual cut-off, not just
  utility usage). Mask/allowlist genuinely-intended clamps (avatars, deliberate line-clamp).

### Claude's Discretion (plan-time implementation)
- **VERIFY-02 hermetic DB:** reuse the existing seeded MA-8 harness — add `axe-app-wide` to the
  seeded CI spec list with self-seed/teardown so the authed + mobile rows run hermetically without
  polluting (the authed rows already self-skip on `HAS_SEED_ENV`; the dual-wiring FLOW-01 trap
  applies — add to BOTH the ci.yml seeded list AND the spec's own gate). Avoid the v1.3 pollution
  trap (leave-around seeded rows published into shared projects).
- **BP-03 byte-identity:** flip px→token via **fixed-value token aliases** equal to the current px
  on the frozen EquityChart + chart-internal SVG, so no raw px remains *and* the render stays
  byte-identical. Narrow, documented `eslint-disable` only where a token genuinely can't express it.
  `scenario.ts` / `FactsheetBody` must stay byte-equivalent on the locked surfaces.
- **VERIFY-01 ultra-wide:** add 2560px to the existing `VIEWPORTS` matrix constant; wire the three
  deferred Phase-52 canaries (seeded 2560px reflow sweep + svg goldens + authed ultra-wide).
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `e2e/axe-app-wide.spec.ts` — app-wide axe matrix; `VIEWPORTS` constant (1280×800, 375×812);
  authed rows already present but dormant via `HAS_SEED_ENV` self-skip (lines ~61–63). Add 2560px row.
- `e2e/reflow-sweep.spec.ts` + `e2e/reflow-sweep-authed.spec.ts` — reflow gates; `assertNoReflow` helper.
- `e2e/svg-chart-parity.spec.ts` — 9 chart panels, tolerances 0.02 (per-panel) / 0.05 (full-page),
  desktop + 320px; **goldens PENDING** (README guard, no PNGs yet). Bake target for VERIFY-01/04.
- `e2e/strategy-v2-chart-parity.spec.ts` — active per-panel goldens (0.02) + full-page (0.05); precedent.
- `e2e/demo-screenshot.spec.ts` — 3 viewports, tolerance 0.05; precedent for masking/tolerance.
- `lighthouserc.json` — `minScore: 0.6`, mobile MotoG 412×823, 5 public routes; ratchet target.
- `tools/eslint-plugin-quantalyze/rules/no-raw-font-px.mjs` — the rule; `eslint.config.mjs` has the
  per-surface ratchet (~19 error globs; `src/components/charts/**` = `off`; `design-tokens/**` = `error`).
- `src/components/layout/DashboardChrome.tsx:77` — `isWide` regex → `max-w-[1920px]` else `max-w-7xl`.
- `.github/workflows/ci.yml` — `frontend` aggregator gates branch protection; unseeded playwright
  list (~line 1073), seeded MA-8 list (~lines 1266–1282), `lighthouse-mobile` job (~1371–1465).

### Established Patterns
- **FLOW-01 dual-wiring trap:** a new seeded e2e spec must be added to BOTH the ci.yml seeded list
  AND its own `HAS_SEED_ENV` const, or it never runs in CI.
- **Per-file ESLint ratchet (strangler):** flip surfaces to `error` as they're cleaned; charts/locked
  surfaces are the last holdouts.
- **Tolerance precedent:** ±2% per-panel, ±5% full-page; dynamic regions masked; en-US/UTC pinned in
  `playwright.config.ts` for snapshot determinism.
- **`frontend` aggregator is the real gate** (main has no branch protection beyond it); e2e is advisory.

### Integration Points
- New/edited specs → ci.yml playwright lists (unseeded vs seeded) + their own seed-env gates.
- lhci budget → `lighthouserc.json` minScore.
- px→token flips → `eslint.config.mjs` ratchet map (remove `warn`/`off` exemptions as cleaned) +
  a fixed-value token source under `src/lib/design-tokens/**`.
- No-clip sweep → new e2e spec + ci.yml list + `frontend`/e2e gating.
- RT-W2 → per-page `max-w` in the 4 admin prose/form `page.tsx` files.
</code_context>

<specifics>
## Specific Ideas

- Never blind `--update-snapshots` — deliberate per-chart re-baseline only (explicit Out-of-Scope ban).
- Re-measure lhci before ratcheting; budget = measured floor − 2 points.
- No-clip guard is a *runtime* Playwright check, not a static class ban.
- Fixed-value token aliases preserve byte-identity on the frozen chart surfaces while removing raw px.
</specifics>

<deferred>
## Deferred Ideas

- **Real-device authed sign-off** (VERIFY-05) — human checkpoint; no real device / no Bash network here.
- **Live golden PNG bake** — controlled CI run, never blind; lands green-by-skip until baked.
- Anything beyond v1.4 scope (v2/deferred items in REQUIREMENTS.md) stays out.
</deferred>

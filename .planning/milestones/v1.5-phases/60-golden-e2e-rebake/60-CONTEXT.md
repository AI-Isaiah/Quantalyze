# Phase 60 — Golden & E2E Re-Bake (VERIFY-01) — CONTEXT

Date: 2026-07-02 · Mode: autonomous (discuss auto-answered from discovery evidence)

## Roadmap goal (verbatim)

> The visual golden and e2e baselines are deliberately re-baked to the new
> (independently verified) blend series — the safety net is restored green,
> not disabled.

Success criteria: (1) svg-golden bake (WR-02) + seeded e2e re-diffs re-baked
deliberately (per-chart, reviewed) and green after the math change — never in
the same commit that changes the math; (2) the re-bake is anchored to the
Phase-55 numpy artifact (BLEND-07) + Phase-56 parity — the bake restores the
safety net, it does not mask a regression.

## Discovery — the roadmap assumption vs reality

The roadmap (written at milestone kickoff, before Phases 55-59 existed) assumed
the golden/screenshot baselines render the blend series and would go red after
the math change. **They do not, and they did not:**

- `e2e/svg-chart-parity.spec.ts` (WR-02, 30 PNGs) renders SINGLE-STRATEGY
  factsheet panels on `/factsheet/[id]/v2` — no scenario blend anywhere.
- `e2e/demo-screenshot.spec.ts` renders marketing/demo pages — no blend.
- `e2e/strategy-v2-chart-parity.spec.ts` renders the strategy page — no blend.
- Evidence the net never went red: e2e passed on PR #565, PR #566 (after the
  ced581e0 anchor fix) and on the main merge CI run 28590250701 — with ZERO
  snapshot updates anywhere in v1.5. `git log --stat` over v1.5 shows no
  `*-snapshots/` churn.

**Conclusion: there is nothing to re-bake.** Running `--update-snapshots`
would be a no-op ritual. VERIFY-01's substance — "the safety net is restored
green, not disabled" — points at the ONE place v1.5 actually weakened the
net:

## The genuinely weakened safety net (this phase's real work)

At the #566 land, the new Phase-58 composer-axe anchors (blend header visible;
coverage timeline expands) had to be made CONDITIONAL (`ced581e0`) because
they timed out in CI. Root cause (traced 2026-07-02, deterministic, not a
flake):

1. `seedStrategyWithHistory` (e2e/helpers/seed-test-project.ts) writes
   `strategy_analytics.returns_series` but **never `daily_returns`**.
2. The composer lazy-fetches `GET /api/strategies/[id]/returns`, which serves
   exactly `strategy_analytics.daily_returns` (route.ts:145) → `[]` for every
   seeded strategy.
3. `selectedSpans` is empty → `windowBounds` (ScenarioComposer.tsx:1937,
   `unionOf(selectedSpans)`) is null → the ENTIRE Phase-58 surface (window
   control, BlendHeader, CoverageTimeline, notes) never mounts.

So the seeded composer state is deterministically DEGENERATE — the conditional
anchors currently always take the `else console.warn` branch in CI: the
Phase-58 a11y/visibility net is effectively OFF.

## Decisions (all LOW-risk, decided per no-clients autonomy)

1. **No snapshot re-bake.** Nothing renders the blend; baselines are green and
   genuinely exercise unchanged code. Documented here + in the evidence file
   as the VERIFY-01 disposition (criterion 2 is satisfied vacuously-with-proof:
   BLEND-07 numpy artifact + Phase-56 parity are green on main and no bake
   occurred that could mask anything).
2. **Make the seeded state deterministic** — add an OPT-IN
   `withDailyReturns: true` option to `seedStrategyWithHistory` that writes a
   deterministic `strategy_analytics.daily_returns` series. Opt-in (not
   default) so the svg-chart-parity / strategy-v2 golden fixtures stay
   byte-identical (they share this helper; changing their fixture shape risks
   pixel drift — exactly what this phase must not cause).
3. **Promote the ced581e0 conditional anchors back to unconditional** in
   `e2e/composer-axe.spec.ts`, and pin the window-value control to a real
   ISO range (proves windowBounds derived from the seeded series, not just
   mounted).
4. Scope guard: NO changes to bake workflows, snapshots, engine files, or the
   composer. e2e + seed helper only.

## Out of scope

- A scenario-blend screenshot golden (new pixel coverage) — worthwhile but a
  NEW net, not restoring the existing one; deferred (candidate for a future
  milestone; noted in evidence file).
- Phase 61 authed canary items.

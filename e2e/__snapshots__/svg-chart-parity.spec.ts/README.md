# svg-chart-parity goldens — bake on the first seeded CI run

This directory holds the Playwright screenshot goldens for
`e2e/svg-chart-parity.spec.ts`:

- `*-desktop.png` — the DESKTOP byte-identity goldens (the no-recompute proof,
  CHART-03). A value/recompute change in the frozen engine produces a golden
  diff → red.
- `*-portrait-320.png` — the 320px PORTRAIT legibility/portrait snapshots
  (CHART-02 + CHART-03).
- `full-page-desktop.png` — the full-page composition golden.

## Why no PNGs are committed yet

Capturing a real golden requires rendering the seeded `/factsheet/[id]/v2`
route, which needs the test-Supabase env (`TEST_SUPABASE_URL` /
`TEST_SUPABASE_SERVICE_ROLE_KEY`). That env is NOT present in the local dev
environment, and committing a hand-written / empty / placeholder PNG would be a
**false-green** (a golden that proves nothing). So the PNGs are deliberately
left to bake on the first run that has the seed env.

## How to bake them

On the first seeded CI run (`vars.E2E_TEST_DB_CONFIGURED == 'true'`), or
locally with the test-Supabase env exported:

```bash
# 1. Bake the DESKTOP goldens FIRST (Pitfall 2 — the no-recompute discipline),
#    review the diff, commit them.
npx playwright test e2e/svg-chart-parity.spec.ts \
  -g "desktop: per-panel goldens" --update-snapshots

# 2. THEN bake the 320px portrait snapshots and commit them.
npx playwright test e2e/svg-chart-parity.spec.ts \
  -g "portrait 320px" --update-snapshots
```

## The one rule

NEVER `--update-snapshots` a **desktop** golden after a chart-tuning change. A
desktop golden diff means the no-recompute / frozen-math boundary was crossed
(SCENARIO-05 / BODY-02 / compute.ts parity should have caught the value change
first) — investigate it, do not bless it. The mobile/portrait goldens are
expected to change when the mobile branch is tuned; rebake those freely.

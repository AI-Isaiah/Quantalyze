# Phase 158 UAT item 1 — per-spec execution evidence (2026-08-21)

Criterion: each of the 5 specs newly wired into CI batches by Phase 158 reports **>=1 executed
(non-skipped) test case** under an env arrangement matching its CI batch. CI's dot reporter cannot
attribute counts per spec, so each spec was run individually with `--reporter=line --workers=1`
locally, replicating the plan 158-05 method (`.planning/phases/158-ops-ci-a-merge-means-a-deploy/158-05-SUMMARY.md`).

Raw per-spec line-reporter logs were retained only in the session scratchpad; their collected/passed/skipped counts and skipped-title lists are reproduced in full below.

## Environment arrangements (mirroring `.github/workflows/ci.yml`)

**SEEDED batch** (CI job `e2e-seeded`, real TEST Supabase + seeded demo data):
- Server: TEST-pointed `next dev` started via the 158-05 wrapper —
  `node --env-file=.env.test.local <scratchpad>/158-05-e2e-wrapper.mjs dev`
  (the wrapper maps `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` from `.env.test.local`
  onto `TEST_SUPABASE_URL`/`TEST_SUPABASE_SERVICE_ROLE_KEY`, refuses the PROD project ref, and
  requires the TEST ref `qmnijlgmdhviwzwfyzlc`; no secret value ever entered a command line or log).
  Wrapper preflight: `... 158-05-e2e-wrapper.mjs check` → `[wrapper] env OK: TEST project ref
  confirmed; TEST_SUPABASE_* mapped.`
- Playwright process: same wrapper, `test` mode (so `TEST_SUPABASE_*` is present → `HAS_SEED_ENV`
  true; `ANALYTICS_SERVICE_URL` absent → `HAS_ANALYTICS_SERVICE` false, matching CI, where no job
  provisions an analytics service).
- Seed state: the TEST DB's existing demo seed sufficed — full-flow's anon cases (the only
  consumers of pre-existing rows) passed without re-running `scripts/seed-demo-data.ts`;
  csv-upload-flow and my-strategies mint and clean their OWN seeds via the seed helpers.
- Known local-vs-CI divergence (recorded in 158-05): local runs `next dev` while CI runs a
  production `next start`; the one behavioral difference is csrf.ts's dev-only localhost
  auto-allowlist, which CI compensates for with `NEXT_PUBLIC_ALLOWED_ORIGINS: http://localhost:3000`
  (present in both CI jobs' env blocks).

**UNSEEDED batch** (CI job `e2e`, placeholder Supabase env):
- Server AND Playwright process both carry the CI step's placeholder env (values are CI's own
  literals, not secrets):
  `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder
  SUPABASE_SERVICE_ROLE_KEY=placeholder_service_role ADMIN_EMAIL=test@example.com
  PLATFORM_NAME=Quantalyze PLATFORM_EMAIL=test@quantalyze.com
  NEXT_PUBLIC_ALLOWED_ORIGINS=http://localhost:3000`
- `TEST_SUPABASE_*`, `PLAYWRIGHT_TEST_STRATEGY_ID`, `PLAYWRIGHT_TEST_SLUG`, `E2E_TEST_EMAIL/PASSWORD`
  all unset — exactly as in the CI `e2e` job.

---

## 1. e2e/api-key-flow.spec.ts — UNSEEDED batch — **PASS** (3 executed)

Command (server: placeholder-env `npm run dev`, backgrounded, same env):

    env NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
        NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder \
        SUPABASE_SERVICE_ROLE_KEY=placeholder_service_role \
        ADMIN_EMAIL=test@example.com PLATFORM_NAME=Quantalyze \
        PLATFORM_EMAIL=test@quantalyze.com \
        NEXT_PUBLIC_ALLOWED_ORIGINS=http://localhost:3000 \
      npx playwright test e2e/api-key-flow.spec.ts --reporter=line --workers=1

Result: **12 collected / 3 passed / 0 failed / 9 skipped**, exit 0 (15.9s).

Executed (passed): the 3 "API endpoint contract" tests (JSON-not-redirect, 401 unauthenticated,
missing-fields rejection) — these are the repaired contract POSTs that 403'd without
`NEXT_PUBLIC_ALLOWED_ORIGINS` in production mode.

Skipped titles (9 — all gated on `!process.env.PLAYWRIGHT_TEST_STRATEGY_ID`, unset in CI and here):
- edit page renders ApiKeyManager section
- clicking Add Key reveals the API key form with exchange selector
- selecting OKX exchange shows passphrase field
- form shows validation when submitting without required fields
- Cancel button hides the form and shows Add Key again
- empty state shows helpful message when no keys exist
- successful key submission shows key in connected keys list
- submitting invalid credentials shows error message
- delete key shows confirmation modal

## 2. e2e/sync-analytics-flow.spec.ts — UNSEEDED batch — **PASS** (4 executed)

Command: identical env arrangement to spec 1, target `e2e/sync-analytics-flow.spec.ts`.

Result: **18 collected / 4 passed / 0 failed / 14 skipped**, exit 0 (16.9s).

Executed (passed): the 3 "Sync API endpoint contract" tests (JSON-not-redirect, 401
unauthenticated, 400 missing strategy_id) + "analytics detail page redirects unauthenticated
users to login".

Skipped titles (14 — gated on `PLAYWRIGHT_TEST_STRATEGY_ID`, the last describe additionally on
`PLAYWRIGHT_TEST_SLUG`; both unset in CI and here):
- Resync button is visible for the currently linked key
- Use & Sync button is visible for unlinked keys
- clicking Resync shows syncing state
- sync button returns to normal state after completion
- sync failure shows error message
- sync failure with non-JSON response shows service unavailable
- analytics page renders hero metrics (CAGR, Sharpe, Max Drawdown)
- analytics page renders equity curve chart
- analytics page renders tabbed metric panels
- switching to Returns tab shows monthly returns and distribution charts
- switching to Risk tab shows rolling metrics and risk of ruin
- metric panel renders accordion sections with computed values
- compute status banner shows when analytics are not complete
- factsheet link is present on analytics page

## 3. e2e/full-flow.spec.ts — SEEDED batch — **PASS** (4 executed)

Command (server: TEST-pointed wrapper `dev` mode, backgrounded):

    node --env-file=.env.test.local <scratchpad>/158-05-e2e-wrapper.mjs \
      test e2e/full-flow.spec.ts --reporter=line --workers=1

Result: **10 collected / 4 passed / 0 failed / 6 skipped**, exit 0 (10.5s).

Executed (passed): the 4 "Public browsing flow" tests (landing→/browse link; browse page
categories; category page without auth; factsheet resolves for a published strategy — the anon
cases that were MEASURED red under placeholder env, hence this spec's seeded-batch placement).

Skipped titles (6 — skipped-by-design on `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD`, deliberately never
provisioned; recorded decision in 158-05):
- strategy discovery loads with data
- my strategies page shows strategies
- allocations page loads
- strategy detail shows hero metrics
- share button copies factsheet URL
- admin dashboard loads

## 4. e2e/csv-upload-flow.spec.ts — SEEDED batch — **PASS** (2 executed)

Command:

    node --env-file=.env.test.local <scratchpad>/158-05-e2e-wrapper.mjs \
      test e2e/csv-upload-flow.spec.ts --reporter=line --workers=1

Result: **4 collected / 2 passed / 0 failed / 2 skipped**, exit 0 (14.2s).

Executed (passed): "strategy name required: empty input blocks submit" and "file too large:
11 MB CSV → CSV_FILE_TOO_LARGE envelope" (seeded login + client-side gates).

Skipped titles (2 — gated on `HAS_ANALYTICS_SERVICE` (`ANALYTICS_SERVICE_URL` unset); matches CI,
where NO job provisions an analytics service — the recorded 158-05 gap; no analytics-service /
uvicorn process was started, per the hard rule):
- happy path: type name → upload → preview → submit → owner list renders user-typed name
- validation failure: non-monotonic dates render the validation envelope

## 5. e2e/my-strategies.spec.ts — SEEDED batch — **PASS** (1 executed)

Command:

    node --env-file=.env.test.local <scratchpad>/158-05-e2e-wrapper.mjs \
      test e2e/my-strategies.spec.ts --reporter=line --workers=1

Result: **1 collected / 1 passed / 0 failed / 0 skipped**, exit 0 (10.0s).

Executed (passed): "owner sees their own row, not another user's, linking to its factsheet"
(NAV-01; the spec minted its own `e2e-mystrat-` seeds and cleaned them in `afterAll`).

Skipped titles: none.

---

## Verdict summary

| Spec | Batch | Collected | Passed | Failed | Skipped | Exit | >=1 executed? |
|---|---|---|---|---|---|---|---|
| api-key-flow.spec.ts | unseeded | 12 | 3 | 0 | 9 | 0 | **PASS** |
| sync-analytics-flow.spec.ts | unseeded | 18 | 4 | 0 | 14 | 0 | **PASS** |
| full-flow.spec.ts | seeded | 10 | 4 | 0 | 6 | 0 | **PASS** |
| csv-upload-flow.spec.ts | seeded | 4 | 2 | 0 | 2 | 0 | **PASS** |
| my-strategies.spec.ts | seeded | 1 | 1 | 0 | 0 | 0 | **PASS** |

Total: 45 collected, 14 passed, 0 failed, 31 skipped (every skip carries a reason gate; none is a
bare `test.skip(true)`).

## Notes / anomalies

- 158-05's after-repair row recorded api-key-flow as "3 passed / 8 skipped" and
  sync-analytics-flow as "4 passed / 12 skipped"; measured at HEAD the skip counts are 9 and 14
  (totals 12 and 18, which match the summary's own BEFORE-repair totals). Pass counts and the
  executed titles match exactly; the summary's skip integers appear to be transcription slips, not
  a behavioral change. No impact on the >=1-executed criterion.
- Skipped-title attribution: the line reporter lists every test but does not label skip per line;
  titles above are attributed via each spec's static, env-deterministic skip gates
  (`PLAYWRIGHT_TEST_STRATEGY_ID`/`PLAYWRIGHT_TEST_SLUG`, `E2E_TEST_EMAIL`/`PASSWORD`,
  `HAS_ANALYTICS_SERVICE`), whose per-describe/per-test memberships sum exactly to the reporter's
  skip counts under the fixed env of each run.
- Safety: wrapper preflight confirmed the TEST project ref; post-run grep over all five run logs
  found **zero** occurrences of the PROD ref. No `.env.local` file was ever read. No
  analytics-service/uvicorn process was started. Both dev servers were torn down; port 3000
  verified free after each teardown.
- Seed hygiene: seeded specs assert their own seed invariants and clean up by prefix in
  `afterAll`; the pre-existing demo seed satisfied full-flow without re-seeding, so
  `scripts/seed-demo-data.ts` was not run (shared TEST DB left as found, minus the specs' own
  cleaned-up mints).

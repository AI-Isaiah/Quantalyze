---
phase: 158-ops-ci-a-merge-means-a-deploy
plan: 05
subsystem: testing
tags: [playwright, e2e, ci, supabase, seed-env, csrf]

requires:
  - phase: 158-ops-ci-a-merge-means-a-deploy
    provides: "158-RESEARCH.md §OPS-03 orphan census; 158-PATTERNS.md seeded-spec contract"
provides:
  - "Four repaired orphan specs (api-key-flow, sync-analytics-flow, full-flow, csv-upload-flow), each proven to execute >=1 real case locally"
  - "NEW e2e/my-strategies.spec.ts — the NAV-01 surface, seeded contract, both polarities + neuter drill observed"
  - "BATCH VERDICTS table (below) — plan 158-06's direct wiring input"
  - "Measured finding: the csv wizard's server-side validation seam needs an analytics service that NO CI job provisions"
affects: [158-06, OPS-03]

actuals:
  tokens: 8500
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "API-contract e2e POSTs send an explicit Origin header (the CSRF gate postdates the specs)"
    - "env-as-provisioning-proxy gate for backend seams (HAS_ANALYTICS_SERVICE, mirroring PLAYWRIGHT_TEST_STRATEGY_ID)"

key-files:
  created:
    - e2e/my-strategies.spec.ts
  modified:
    - e2e/api-key-flow.spec.ts
    - e2e/sync-analytics-flow.spec.ts
    - e2e/full-flow.spec.ts
    - e2e/csv-upload-flow.spec.ts

key-decisions:
  - "Re-executed on the MAIN checkout (branch feat/v1.20-phase-158), not a worktree — the original halt was solely for lack of a TEST-pointed environment. Seed env derived via node --env-file=.env.test.local mapping NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY onto TEST_SUPABASE_* inside a scratchpad wrapper that refuses the PROD ref and requires the TEST ref; no secret ever entered the transcript or the repo."
  - "csv-upload-flow converted to the seeded-spec contract: its hardcoded demo login does not authenticate against the TEST project (measured via signInWithPassword → 'Invalid login credentials'), and the credentials sat in a PUBLIC repo. The f4e257df fail-closed admin-env contract is preserved by routing all admin access through the seed helpers' getAdmin()."
  - "csv-upload-flow's two server-side validation cases self-skip on HAS_ANALYTICS_SERVICE: /api/strategies/csv-validate forwards to the Python analytics service, and grep of .github/workflows shows NO job sets ANALYTICS_SERVICE_URL — wiring them un-gated would red the seeded batch deterministically. Booting a local analytics service to green them was deliberately NOT done (out of plan scope; worker-adjacent blast radius)."
  - "full-flow verdicts into the SEEDED batch environment (it uses no seed helpers, but its anon cases were MEASURED red under the unseeded job's placeholder-Supabase env: the landing→/browse navigation exceeds Playwright's 5s URL budget while SSR hangs on placeholder fetches)."
  - "E2E_TEST_EMAIL / E2E_TEST_PASSWORD were NOT provisioned (recorded decision honored); full-flow's authed + admin describes carry dated skipped-by-design comments and reasoned skips."

patterns-established:
  - "Origin-header contract probing: Playwright request-fixture POSTs to mutating /api routes must send the app's own Origin or they test the CSRF arm, not the auth contract"

requirements-completed: [OPS-03]

coverage:
  - id: D1
    description: "Four orphan specs repaired; each executes >=1 passed, non-skipped case locally"
    requirement: "OPS-03"
    verification:
      - kind: e2e
        ref: "npx playwright test e2e/api-key-flow.spec.ts e2e/sync-analytics-flow.spec.ts e2e/full-flow.spec.ts e2e/csv-upload-flow.spec.ts --reporter=line → 13 passed, 31 skipped, exit 0 (2026-08-20, TEST-pointed dev server)"
        status: pass
    human_judgment: false
  - id: D2
    description: "e2e/my-strategies.spec.ts authored (NAV-01); executes seeded, skips visibly unseeded, load-bearing assertion proven able to fail"
    requirement: "OPS-03"
    verification:
      - kind: e2e
        ref: "seeded run: 1 passed (15.3s); env-less run: 1 skipped; neuter drill (own-row name corrupted): 1 failed, exit 1 → restored → 1 passed"
        status: pass
    human_judgment: false

duration: 80min
completed: 2026-08-20
status: complete
---

# Phase 158 Plan 05: Orphan e2e spec repair + the NAV-01 spec — COMPLETE

**All four named orphan specs now execute real cases against a TEST-pointed server (13 passed / 31 reasoned skips / exit 0 combined), and `/my-strategies` has its first e2e spec — seeded, own-seed-scoped, with both env polarities and a red neuter drill observed.**

## Performance

- **Duration:** ~80 min (recon + run→classify→repair per spec + placeholder-env verdict measurement)
- **Completed:** 2026-08-20
- **Tasks:** 2 of 2 completed
- **Files modified:** 5 (4 repaired + 1 new)

## How the halt was resolved

The prior run halted because the worktree had no TEST-pointed environment. This run executed on
the main checkout (`feat/v1.20-phase-158`), where `.env.development.local` targets the TEST
project. Seed env was derived without any secret display: a scratchpad wrapper invoked via
`node --env-file=.env.test.local` maps `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
onto `TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY`, refuses any URL carrying the PROD
ref (`khslejtfbuezsmvmtsdn`), and requires the TEST ref (`qmnijlgmdhviwzwfyzlc`). Functional
confirmation the server is TEST-pointed: a freshly TEST-minted seeded user authenticates through
the app's login form (that user exists nowhere else).

## Per-spec run results (Task 1)

| Spec | Before repair | Root cause (classified) | After repair (local, TEST-pointed) |
|---|---|---|---|
| `api-key-flow.spec.ts` | 1 passed / 2 FAILED / 9 skipped | Spec rot: the CSRF origin gate (`src/lib/csrf.ts`, added 2026-05-17) 403s Origin-less POSTs BEFORE auth — the contract tests were measuring the wrong arm | **3 passed** / 8 skipped (reasoned env gates, surfaces verified still current) |
| `sync-analytics-flow.spec.ts` | 2 passed / 2 FAILED / 14 skipped | Same CSRF classification | **4 passed** / 12 skipped (reasoned env gates) |
| `full-flow.spec.ts` | 3 passed / 1 FAILED / 6 skipped | Global-DB bet: `Verified by Quantalyze` needs COMPLETE analytics on whatever row sorts first in the polluted shared DB (first row measured: a still-computing seed) | **4 passed** / 6 skipped-by-design (authed+admin, dated decision comments) |
| `csv-upload-flow.spec.ts` | 0 passed / 4 FAILED | Missing identity + missing backend: hardcoded demo user does not exist in TEST (measured: `Invalid login credentials`); csv-validate forwards to an analytics service nothing provisions (measured: the honest "We could not reach our own service" seam alert) | **2 passed** (seeded login + client-side gates) / 2 reasoned skips (`HAS_ANALYTICS_SERVICE`) |

**Combined Task-1 gate:** `set -o pipefail; npx playwright test <4 files> --reporter=line` →
`13 passed, 31 skipped`, **exit 0** (every skip carries a reason string; zero bare
`test.skip(true)` remain — grep-verified).

## Task 2 — e2e/my-strategies.spec.ts (NAV-01)

Wizard-resume contract: `HAS_SEED_ENV` self-skip, `seedTestAllocator({role:"both"})` ×2,
`seedWizardDraft` mints one strategy per user under the `e2e-mystrat-` niche
(`-own-`/`-other-` sub-prefixes), cleanup-by-prefix in `afterAll`. Navigation scoped
`a[href="/my-strategies"]` (DEF-149-B: no heading-text selectors — negative grep verified);
assertions own-seed only (owner row visible by link role+name; other user's mint at count 0;
row href `=== /factsheet/<seeded id>`).

**Both polarities + neuter drill (reporter evidence):**

- Seeded: `1 passed (15.3s)`, exit 0.
- Env-less (`env -u TEST_SUPABASE_URL -u TEST_SUPABASE_SERVICE_ROLE_KEY`): `1 skipped`, exit 0 — skipped, not failed.
- **Neuter drill RED line:** own-row locator name corrupted to `${draftA.name}-NEUTER-DRILL` →
  `1 failed — [chromium] › e2e/my-strategies.spec.ts:79:7 › Phase 149 — /my-strategies (NAV-01) › owner sees their own row…`, exit 1. Restored → `1 passed (14.4s)`.

## BATCH VERDICTS (plan 158-06 input — do not re-derive)

Measured under BOTH environments where relevant: a TEST-pointed dev server, and a
placeholder-Supabase dev server mirroring the unseeded job's env discriminator
(`NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co` etc.). Caveat: local mirror runs
`next dev` while CI runs a production `next start` — the ONE behavioral divergence that matters
is csrf.ts's localhost auto-allowlist (dev-only), handled explicitly below.

| Spec | Batch | Runnable in CI? | Conditions plan 06 must wire | Evidence |
|---|---|---|---|---|
| `e2e/api-key-flow.spec.ts` | **unseeded** | yes, conditional | Add `NEXT_PUBLIC_ALLOWED_ORIGINS: http://localhost:3000` to the unseeded job's env (exact precedent + rationale comment already at the seeded job, ci.yml ~:2163-2172) — production mode has an EMPTY csrf allowlist and the repaired contract POSTs send that Origin | 3 passed under placeholder env (2026-08-20); 401-via-placeholder confirmed by measurement (withAuth's user-null arm) |
| `e2e/sync-analytics-flow.spec.ts` | **unseeded** | yes, conditional | Same allowlist env line (same job) | 4 passed under placeholder env |
| `e2e/full-flow.spec.ts` | **seeded** (env, not helpers) | yes | List membership only; no seed env is read by the spec — but its anon cases need a REAL Supabase behind SSR | MEASURED red under placeholder: landing→/browse click never commits within the 5s URL budget while SSR hangs on placeholder fetches (`toHaveURL` timeout, error-context on file); 4 passed against the TEST-pointed server |
| `e2e/csv-upload-flow.spec.ts` | **seeded** | yes | List membership (MA-8 both-places; HAS_SEED_ENV already in-file). The 2 server-side cases stay skipped until something provisions `ANALYTICS_SERVICE_URL` (+ a live service) into the job — recorded gap, NOT a wiring condition | 2 passed / 2 reasoned skips seeded; describe-skips without seed env |
| `e2e/my-strategies.spec.ts` | **seeded** | yes | List membership (MA-8 both-places; HAS_SEED_ENV in-file) | Both polarities + neuter drill above |

## Task Commits

1. **Task 1: repair the four orphan specs** — `e69c53e1` (test)
2. **Task 2: author e2e/my-strategies.spec.ts** — `c045b894` (test)

## Decisions Made

See frontmatter `key-decisions`. Notable: no product code was changed — every red traced to
spec rot, a missing identity, or a missing backend, never to a product bug.

## Deviations from Plan

- **csv-upload-flow gained a second visible gate (`HAS_ANALYTICS_SERVICE`)** beyond the planned
  seeded conversion: the plan anticipated a DB/auth need; measurement surfaced a second,
  independent backend seam (the analytics service) that no CI job provisions. Skip-with-reason
  is the honest disposition the plan's own repair rules prescribe for missing-env.
- **full-flow's batch verdict diverges from the RESEARCH provisional row** ("unseeded-batch-safe"):
  the placeholder measurement contradicted it. The provisional table explicitly demanded
  run-derived confirmation; this is that confirmation.

## Issues Encountered

- The TEST project's `auth.admin.listUsers` 500s past ~page 4 (~200 users) — the old csv spec's
  cleanup depended on it; the conversion removed the dependency entirely.
- Shared-DB hygiene verified post-run: `e2e-mystrat-`/`e2e-csvflow-` strategy counts in TEST = 0
  after afterAll cleanups. Seeded USERS accumulate (helper design, sibling-tolerated).

## Residual gaps (for the phase close-out, not blockers)

- The csv wizard's happy path (upload→preview→submit) has NO executing e2e anywhere until an
  analytics service exists in some CI job's env — the two gated cases document exactly what to
  provision (`ANALYTICS_SERVICE_URL` + `INTERNAL_API_TOKEN`).
- api-key-flow/sync-analytics-flow's env-gated UI describes (`PLAYWRIGHT_TEST_STRATEGY_ID`,
  exchange creds) remain never-run by design; their copy was source-verified current
  (ApiKeyManager/ApiKeyForm) so the skips are honest, not rot-hiding.

## Next Phase Readiness

- **Plan 158-06 is UNBLOCKED.** The batch verdict table above is its direct input; the one env
  addition it must carry is the unseeded job's `NEXT_PUBLIC_ALLOWED_ORIGINS` line.
- All five specs are committed on `feat/v1.20-phase-158` (e69c53e1, c045b894).

---
*Phase: 158-ops-ci-a-merge-means-a-deploy*
*Completed: 2026-08-20*

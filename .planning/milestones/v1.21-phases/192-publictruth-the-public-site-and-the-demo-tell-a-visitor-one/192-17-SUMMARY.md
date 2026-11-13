---
phase: 192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one
plan: 17
subsystem: testing
tags: [demo-retirement, dead-code, seam-censuses, eslint, vitest]

requires:
  - phase: 192-publictruth
    provides: "Plan 192-11 deleted the /demo page, leaving src/lib/warmup-analytics.ts without a production importer"
provides:
  - "The per-request analytics warmer that only the retired /demo page fired is deleted with its test"
  - "SEAM_EXCLUSIONS at two rows and the no-raw-analytics-fetch allowlist at three paths, every census moved in the same commit"
affects: [192-10 coverage run, Phase 195 TRIM]

actuals:
  tokens: 10285
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Importer check before deletion; both moved censuses shown RED on the re-added deleted path, restored from a byte backup"

key-files:
  created: []
  modified:
    - src/lib/resilient-fetch.ts
    - src/lib/seam-budgets.invariant.test.ts
    - src/__tests__/contracts/contracts-registry.test.ts
    - src/__tests__/contracts/REGISTRY.md
    - eslint.config.mjs
    - vitest.node-env.ts
    - src/app/api/cron/warm-analytics/route.ts
    - tools/eslint-plugin-quantalyze/rules/no-raw-analytics-fetch.mjs
  deleted:
    - src/lib/warmup-analytics.ts
    - src/lib/warmup-analytics.test.ts

key-decisions:
  - "Followed D-11: the warmer was demo-only wiring, deleted after an importer check showed no production caller"
  - "The daily /api/cron/warm-analytics route, its vercel.json schedule and the critical-regressions pins stay; only its docblock changed"
  - "Lineage left in place: the case comment in tools/eslint-plugin-quantalyze/tests/no-raw-analytics-fetch.test.ts and the ADRs under docs/architecture/"

requirements-completed: [ROUTE-03]

plan_head_before: 0b352c2238cedcd63f7795b7516391ac3bd6ecd6
plan_head_after: 87d7150bd5ea3510c51c295ba9dc2ad75a149744

coverage:
  - id: D1
    description: "src/lib/warmup-analytics.ts and its test are gone, after an importer check with no hit outside the plan's own files"
    requirement: ROUTE-03
    verification:
      - kind: other
        ref: "test ! -e src/lib/warmup-analytics.ts && test ! -e src/lib/warmup-analytics.test.ts"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit exits 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "The seam censuses count the two exclusions and three allowlisted paths that remain, and fail when the deleted path comes back"
    requirement: ROUTE-03
    verification:
      - kind: unit
        ref: "src/__tests__/contracts/contracts-registry.test.ts#[B25] ... resolves every quantalyze rule to error (RED with the row re-added: expected 4 to be 3; GREEN after byte restore)"
        status: pass
      - kind: unit
        ref: "src/lib/seam-budgets.invariant.test.ts#excludes exactly the two hand-typed paths (RED with the path re-added to EXPECTED_EXCLUSION_PATHS; GREEN after byte restore)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The cron warmer and the lint rule docblocks describe the code that exists; Task 2's diff is comment-only"
    requirement: ROUTE-03
    verification:
      - kind: unit
        ref: "npx vitest run src/app/api/cron/warm-analytics/route.test.ts tools/eslint-plugin-quantalyze/tests/no-raw-analytics-fetch.test.ts src/__tests__/critical-regressions.test.ts src/__tests__/vercel-cron-limits.test.ts (4 files, 245 tests)"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-11-07
status: complete
---

# Phase 192 Plan 17: The demo-page analytics warmer Summary

**Deleted `src/lib/warmup-analytics.ts` (fired only by the retired /demo page) with its test, and moved every seam census that named it in the same commit: SEAM_EXCLUSIONS to two rows, the `no-raw-analytics-fetch` allowlist to three paths, each shown RED when the deleted path returns.**

## Performance

- **Tasks:** 2 (Task 1 tracer, Task 2 auto)
- **Files:** 8 edited, 2 deleted (10 changed, +48 / -241)
- **Commits:** 2 production commits

## Accomplishments

- Task 1 (tracer, `0f7228ed2`): `git rm` of the warmer and its test; `SEAM_EXCLUSIONS` row removed from `src/lib/resilient-fetch.ts` (the other two rows byte-identical); in `seam-budgets.invariant.test.ts` the `EXPECTED_EXCLUSION_PATHS` and `WARMER_EXCLUSION_PATHS` rows removed, the floor `>= 3` became `>= 2`, the exact fence `toBe(3)` became `toBe(2)`, and the docblocks and three test titles now say two; in `contracts-registry.test.ts` the `SEAM_ALLOWLIST_EXEMPT` row removed, the pin `toBe(4)` became `toBe(3)` with "frozen at three paths", and the comments now say three and "a fourth entry"; the REGISTRY.md row says a closed three-path allowlist; `eslint.config.mjs` off-block lost the path and says THREE and "adding a fourth"; `vitest.node-env.ts` lost the warmer's test entry.
- Task 2 (`87d7150bd`): the cron route's "Why a cron AND a per-request warmup?" paragraph became a dated note (until 2026-11-07 a per-request warmer also fired on the demo page, Phase 192 retired it, the daily cron is the one `/health` warmer); the lint rule docblock names one cron warmer and says "a fourth entry". Every changed line is a comment line.

## Importer check (recorded per the plan)

`git grep -n -E "warmup-analytics|warmupAnalytics" -- src e2e scripts tools eslint.config.mjs vitest.node-env.ts` before any edit hit only:
- `eslint.config.mjs:131` (off-block path)
- `src/__tests__/contracts/REGISTRY.md:41` and `src/__tests__/contracts/contracts-registry.test.ts:91`
- `src/app/api/cron/warm-analytics/route.ts:19` (docblock, Task 2)
- `src/lib/resilient-fetch.ts:1075`
- `src/lib/seam-budgets.invariant.test.ts:552` and `:576`
- `src/lib/warmup-analytics.ts` and `src/lib/warmup-analytics.test.ts` (the files deleted)
- `tools/eslint-plugin-quantalyze/rules/no-raw-analytics-fetch.mjs:49` (docblock, Task 2)
- `tools/eslint-plugin-quantalyze/tests/no-raw-analytics-fetch.test.ts:177` (case comment, kept as lineage)
- `vitest.node-env.ts:310`

No page, route or component imported it, so no checkpoint was needed. (The `import` of `warmupAnalytics` in the grep output is only inside the deleted test.)

## RED then GREEN proofs (T-192-38)

Each ran from a `cp` byte backup in the scratchpad; the restore was a `cp` back and `cmp` printed nothing.

- (a) Re-added `{ rule: "no-raw-analytics-fetch", file: "src/lib/warmup-analytics.ts" }` to `SEAM_ALLOWLIST_EXEMPT` in contracts-registry.test.ts: RED, 1 failed / 67 passed, `[B25] eslint-plugin-quantalyze wiring integrity > resolves every quantalyze rule to "error" for a representative src file`, `The no-raw-analytics-fetch allowlist is frozen at three paths (T-140-26) ...: expected 4 to be 3`. After restore: GREEN, 68 passed.
- (b) Re-added `src/lib/warmup-analytics.ts` to `EXPECTED_EXCLUSION_PATHS` in seam-budgets.invariant.test.ts: RED, 1 failed / 86 passed, `structural completeness > excludes exactly the two hand-typed paths (SET equality, not count)`, `The SEAM_EXCLUSIONS path set drifted ...: expected [ ...(2) ] to deeply equal [ ...(3) ]`. After restore: GREEN, 87 passed.

## Gate results (real numbers)

- Task 1 verify: `npx vitest run` on seam-budgets.invariant, contracts-registry, seam-log-coverage and the plugin test: 4 files, 259 tests passed. `npx tsc --noEmit` exit 0. `npm run lint` exit 0 (0 errors; 2 pre-existing unused-var warnings in `src/app/factsheet/[id]/v2/MetricsColumn.tsx` and `src/lib/factsheet/composite-read-path.ts`, files this plan did not touch).
- Also run: `npx vitest run src/lib/resilient-fetch` (3 files, 182 tests passed), the importer sweep over `SEAM_EXCLUSIONS` / `vitest.node-env` / REGISTRY.md readers found no other consumer.
- Task 2 verify: route, plugin, critical-regressions and vercel-cron-limits tests: 4 files, 245 tests passed; `npx eslint src/app/api/cron/warm-analytics/route.ts` clean; `demo-page` absent from the route.
- Final re-run after Task 2: `npm run lint` exit 0, `npx tsc --noEmit` exit 0.
- Not run: nothing the plan required was skipped. No Playwright or seeded-env gate applies to this plan.

## Acceptance criteria

- `test ! -e` on both deleted files: pass.
- `grep -c -a 'warmup-analytics'` on resilient-fetch.ts, seam-budgets.invariant.test.ts, contracts-registry.test.ts, REGISTRY.md, eslint.config.mjs, vitest.node-env.ts: 0 in each (baselines 1, 2, 1, 1, 1, 1).
- `toBeGreaterThanOrEqual(2)` count 1 (baseline 0); `toBeGreaterThanOrEqual(3)` count 0 (baseline 1); `).toBe(3);` count 0 (baseline 1); `frozen at three paths` count 1 (baseline 0).
- Task 2: `demo-page` count 0 in the route (baseline 1); `Phase 192` count 1 (baseline 0); `warmup-analytics` count 0 in the rule (baseline 1); `git show` of Task 2's commit has no added or removed line outside ` *` / `//` / `/*` comment lines.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extra prose moved with the censuses**
- **Found during:** Task 1
- **Issue:** Prose that the plan did not list still said "four", "fifth", "three SEAM_EXCLUSIONS" or "two /health warmers": the `eslint.config.mjs` baseline comment ("plus the four allowlisted files"), the `contracts-registry.test.ts` comment above the rule list and the `CONTRACT_GUARDS` invariant text for `seam-budgets.invariant.test.ts` ("3-path ... both /health warmers pinned as MEMBERS") and the plugin test row ("four-path allowlist"), and a few test comments and the message of the A-12 source scan in `seam-budgets.invariant.test.ts`.
- **Fix:** Reworded to the new counts in the same commit. No assertion beyond those the plan named changed.
- **Files modified:** `eslint.config.mjs`, `src/__tests__/contracts/contracts-registry.test.ts`, `src/lib/seam-budgets.invariant.test.ts`
- **Commit:** `0f7228ed2`

**2. [Plan wording] Proof (a) names the count, not the missing file**
- The plan allowed "the missing allowlisted file or the count 4 against 3". The run reported the count (4 against 3), because the pin assertion runs before the per-file loop. Both were acceptable.

**Total deviations:** 1 auto-fixed prose pass, 1 wording note. **Impact:** none on behaviour; comment and test-title text only.

## Known Stubs

None.

## Threat Flags

None. The allowlist only shrank; no endpoint, auth path or schema changed.

## Items left in place (not demo wiring, or lineage)

- `tools/eslint-plugin-quantalyze/tests/no-raw-analytics-fetch.test.ts:177` still names `src/lib/warmup-analytics.ts` in a case comment saying where its synthetic pattern was copied from (dated lineage, as the plan directed). The fixture itself stays: it pins the `/health` URL shape the cron warmer still has.
- ADRs under `docs/architecture/` that cite the module are dated history and were not edited.
- The `demo` hits in this plan's files were all the page this phase already retired; none outside the warmer required classification.

## Task Commits

1. Task 1 (tracer): `0f7228ed2` refactor(192-17): delete the demo-page analytics warmer and move every seam census that named it
2. Task 2: `87d7150bd` docs(192-17): the cron warmer and the lint rule docblocks stop naming the deleted warmer

## Self-Check: PASSED

- Deleted files absent: `src/lib/warmup-analytics.ts`, `src/lib/warmup-analytics.test.ts`.
- Commits `0f7228ed2` and `87d7150bd` are ancestors of HEAD; `git rev-list --count` from the plan base gave 2 before this SUMMARY.
- STATE.md and ROADMAP.md untouched.

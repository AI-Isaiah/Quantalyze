---
phase: 192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one
plan: 16
subsystem: testing
tags: [github-actions, nightly, apt-bounded, census, retire-demo]
status: complete
requires:
  - phase: 192-publictruth
    provides: "192-14 retired the demo e2e specs and CI commands; this plan retires the last spec that read the demo PDF token module"
provides:
  - "No workflow probes the retired demo PDF endpoint; nightly.yml carries only its npm-audit job and its standing red is gone"
  - "The apt-reaching step census reads the real tree's 17 steps knowingly, shown RED at the old pin"
  - "The apt-bounded parser's first-line `- timeout-minutes:` form is proven on a synthetic workflow"
affects: [192-15]
actuals:
  tokens: 14000
  tasks: 2
  commits: 2
plan_head_before: 0b352c2238cedcd63f7795b7516391ac3bd6ecd6
plan_head_after: 2681e68d214949a6f16476523486522d4e11ce60
commits: 2
tech-stack:
  added: []
  patterns:
    - "A parser branch whose only real consumer is retired is kept alive by a synthetic workflow entry, not dropped"
key-files:
  created: []
  modified:
    - .github/workflows/nightly.yml
    - .github/workflows/sql-mutation-nightly.yml
    - src/__tests__/critical-regressions.test.ts
    - src/__tests__/contracts/ci-apt-bounded.contract.test.ts
  deleted:
    - e2e/portfolio-pdf-demo.spec.ts
key-decisions:
  - "EXPECTED_APT_REACHING_STEPS moves 18 to 17; EXPECTED_WRAPPER_CALLERS stays 14 (the nightly called no wrapper)"
  - "R3-nightly-form is rebuilt as R3-first-line-timeout-form on a synthetic `first-line-timeout.yml` entry"
requirements-completed: [ROUTE-03]
coverage:
  - id: D1
    description: "The nightly demo-PDF cold-start canary, its spec, its preflight job and its missing-secret describe are gone; nightly.yml keeps npm-audit byte-identical"
    requirement: "ROUTE-03"
    verification:
      - kind: unit
        ref: "npx vitest run src/__tests__/critical-regressions.test.ts src/__tests__/contracts/ci-apt-bounded.contract.test.ts src/__tests__/sql-mutation-nightly-parity.test.ts (262 passed)"
        status: pass
      - kind: other
        ref: "actionlint -shellcheck= -pyflakes= .github/workflows/nightly.yml (exit 0)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The moved apt census bites: pinning the constant back at 18 turns the census case RED reporting 17 steps; the byte restore turns it GREEN"
    requirement: "ROUTE-03"
    verification:
      - kind: unit
        ref: "src/__tests__/contracts/ci-apt-bounded.contract.test.ts neuter-and-restore run (6 RED, then 68/68 GREEN)"
        status: pass
    human_judgment: false
duration: 20min
completed: 2026-11-07
---

# Phase 192 Plan 16: Retire the nightly demo-PDF canary Summary

The nightly cold-start canary that probed the public demo PDF endpoint is deleted with its spec, `nightly.yml` is down to its npm-audit job, and the apt-reaching census moved from 18 to 17 knowingly and was shown to bite.

## Task commits

| Task | Commit | What |
|------|--------|------|
| 1 | `fecc2c9cd` | `git rm` of `e2e/portfolio-pdf-demo.spec.ts`; `preflight` and `demo-pdf-coldstart` removed from nightly.yml; the critical-regressions missing-secret describe and its comment removed; census pin 18 to 17, census-down/raw/up literals moved, R3-nightly-form rebuilt on a synthetic workflow |
| 2 | `2681e68d2` | `sql-mutation-nightly.yml` header only (every changed line starts with `#`) |

## Acceptance criteria (Task 1) — real output

- `EXPECTED_APT_REACHING_STEPS = 17;` count 1; `EXPECTED_WRAPPER_CALLERS = 14;` count 1.
- `"(17|19) apt-reaching steps"` count 0; `16`/`18` literals present once each in census-down (line 821), census-raw (833), census-up (840).
- `count to (17|19)"` count 0; titles now read `count to 16"` (census-down) and `count to 18"` (census-up).
- `first-line-timeout.yml` count 5.
- `demo-pdf-coldstart|DEMO_PDF_SECRET|portfolio-pdf-demo` in nightly.yml: 0. `^  npm-audit:` 1. `needs: preflight` 0.
- `DEMO_PDF_SECRET` in critical-regressions.test.ts: 0. The spec file does not exist.

## Task 2 evidence

Neuter-and-restore on `ci-apt-bounded.contract.test.ts` (backup in the scratchpad, never git checkout/restore/stash):

- RED, constant set to 18: the census case failed with `census: 17 apt-reaching steps, pinned at 18. If the change is deliberate, move EXPECTED_APT_REACHING_STEPS.` Six cases failed in all (census, baseline, R3c, census-down, census-raw, census-up).
- Restore: `cmp` silent, `git status` clean for the file.
- GREEN after restore: 68/68.

Open canary issue count (`gh issue list --label "nightly-canary-failure:pdf-coldstart" --state open`): **0**. No issue was closed, commented on or edited.

## Plan-level verification — real numbers

- `npx vitest run` critical-regressions + ci-apt-bounded + sql-mutation-nightly-parity: 3 files, 262 tests passed.
- `actionlint -shellcheck= -pyflakes=` on nightly.yml and sql-mutation-nightly.yml: exit 0.
- e2e path loop over every `e2e/*.spec.ts` a workflow names: no MISSING.
- `npx tsc --noEmit`: exit 0.
- `npm run lint`: 0 errors, 2 pre-existing warnings (unused vars in `MetricsColumn.tsx` and `composite-read-path.ts`, files this plan did not touch); all `check-*` scripts OK.
- `node scripts/verify-plan-anchors.mjs` on the plan: OK, 3 claims.
- Baseline before edits: census case read 18 apt-reaching steps and 14 wrapper callers, 68 passed.

Not run here: Playwright e2e, and the full vitest suite (only the files this plan touches or that read workflow files it changed were run).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A comment in the kept npm-audit job named the deleted job**
- **Found during:** Task 1
- **Issue:** The npm-audit step carried the comment `See dedup rationale on the demo-pdf-coldstart job.` The plan requires `grep -c demo-pdf-coldstart nightly.yml` to print 0 and also calls npm-audit byte-identical; both cannot hold, and a comment pointing at a deleted job would be a dangling reference.
- **Fix:** Reworded that one comment so it states the dedup rationale itself (the original rationale lived in the deleted job's comment). No code line in npm-audit changed.
- **Files modified:** `.github/workflows/nightly.yml`
- **Commit:** `fecc2c9cd`

**Total deviations:** 1 auto-fixed (1 comment-only). **Impact:** none on behavior.

## Left alone, listed for the next reader

- `src/lib/demo-pdf-token.ts` (lines 41, 49) still cites the deleted spec in comments; plan 192-15 deletes that module.
- `README.md:65`, `TODOS.md`, `CHANGELOG.md`, `docs/runbooks/fix-list-reverify-2026-05-17.md` and `docs/superpowers/plans/2026-04-09-portfolio-demo-hero-test-plan.md` still name `portfolio-pdf-demo`. The README line is a stale directory listing; the others are history. Not in this plan's `files_modified`.
- The `nightly.yml` schedule comment still says "a broken staging shows up on the founder's first coffee". It is stale now that the staging canary is gone; left untouched as outside the plan's list.
- `.github/dependabot.yml`, `analytics-deploy-verify.yml`, `cassette-refresh.yml` and `main-ci-cancelled-watcher.yml` cite `nightly.yml` as a pattern or label source; all still true (npm-audit and its label remain).

## Known Stubs

None.

## Threat Flags

None. T-192-35 is mitigated (the job carrying `DEMO_PDF_SECRET` to a staging probe is deleted); T-192-36 is mitigated (census moved and shown RED at 18; first-line form tested on a synthetic workflow).

## Self-Check: PASSED

- `e2e/portfolio-pdf-demo.spec.ts` is absent; the four modified files exist.
- Commits `fecc2c9cd` and `2681e68d2` are ancestors of HEAD.
- STATE.md and ROADMAP.md untouched.

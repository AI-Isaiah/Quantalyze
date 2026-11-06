---
phase: 166-qstats-truth-every-quantstats-derived-number-reflects-the-re
plan: 10
subsystem: release (gate sweep, VERSION / CHANGELOG, OPEN-2 record)
status: complete
tags: [rank-05, quantstats, qstats-truth, release, changelog, open-2]
requires:
  - "166-01 .. 166-09 (every code, test and disclosure commit the CHANGELOG entry maps)"
provides:
  - "whole-phase gate sweep at one SHA"
  - "release v0.91.0.0 with one unified CHANGELOG entry"
  - "the OPEN-2 decision record"
affects: [VERSION, package.json, CHANGELOG.md]
tech-stack:
  added: []
  patterns: ["commit-checklist CHANGELOG: every branch commit hash grep-mapped into the entry before commit"]
key-files:
  created: []
  modified:
    - VERSION
    - package.json
    - CHANGELOG.md
    - .planning/STATE.md (merge conflict resolution only)
decisions:
  - "Version 0.91.0.0: origin/main was 0.90.0.0 at execution, and a minor bump because D-15/D-16/D-17 change user-visible values. 0.90.1.0 is left for the separate fix PR"
  - "OPEN-2 answered by the founder on 2026-09-24 (166-CONTEXT.md, Founder answers): recompute the affected PRODUCTION rows after merge, through a NEW phase. This plan performed no production write"
metrics:
  duration: ~25min
  completed: 2026-09-24
requirements: [SC-5, SC-1]
plan_head_before: de4607e518c10fe504aaeaa26e546c181fe80edc
actuals:
  tokens: 3128
  tasks: 3
  commits: 4
---

# Phase 166 Plan 10: gate sweep, v0.91.0.0 release and the OPEN-2 record Summary

Every phase gate was green at one SHA. The branch then took `origin/main` (0.90.0.0) and was
released as **v0.91.0.0**. The release has one CHANGELOG entry, and all 35 branch commits map into
it. OPEN-2 was already answered by the founder and is recorded below. No database was touched.

`actuals.commits: 4` is `git rev-list --count <plan_head_before>..HEAD`, measured before this
SUMMARY was written. It counts two commits from this plan, the merge `f22e63712` and the release
`f03bc9357` (`--first-parent` count = 2). The other two are the `origin/main` commits the merge
brought in: `762c03c81` (Phase 164.6, v0.90.0.0) and `22bf358a7` (UAT evidence). The SUMMARY
commit comes after them. `actuals.tokens` is chars/4 over the release diff (12511 chars).

## Task 1: gate sweep

**SWEEP_SHA = `de4607e518c10fe504aaeaa26e546c181fe80edc`** (the branch head before the merge).
Python ran from `analytics-service/` with `<venv>/bin/python`. TS ran through the D-19
`node_modules` link, which was removed before each commit.

| # | check | result line |
|---|---|---|
| 1 | `pytest -q -n auto` (full suite) | `6201 passed, 90 skipped, 462 warnings in 29.02s`, exit 0 |
| 1a | census in the same run's terminal output | `qstats-gate census: 13 quantstats node(s) in services/metrics.py, 11 mirror(s), 0 violation(s); arms kwarg-proven=12 exempt=1 inline=11` |
| 1b | reconciliation in the same run | `qstats-gate reconciliation: services/metrics.py has 33 text occurrence(s) of 'qs.stats.' vs 13 AST quantstats node(s); the text count includes comments and docstrings, which cannot call anything (phase start: 30 vs 9)` |
| 2 | mypy, CI's exact command (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`) | `Success: no issues found in 100 source files`, exit 0 |
| 3 | `pytest tests/test_metrics_parity.py tests/test_qstats_gate.py -q` | `65 passed, 2 warnings in 11.14s` |
| 4 | vitest on `queries.percentile-columns`, `csv-finalize-cross-submission-merge`, `metrics-parity`, `critical-regressions` | `Test Files 4 passed (4)` / `Tests 247 passed (247)` |
| 5 | `tsc --noEmit` | exit 0, 0 `error TS` lines |
| 6 | `node scripts/verify-plan-anchors.mjs` over `166-[0-9][0-9]-PLAN.md` | `OK: 10 plan file(s), no stale claims.` (47 claims checked) |
| 7 | `tsx scripts/check-planning-hygiene.ts` | `OK — 7023 tracked files scanned, none carry the local username or an absolute home path` |
| 8 | banned verification fingerprint keys in this phase directory | 0 frontmatter keys. The one textual hit is prose in `166-CONTEXT.md:286` that names the rule itself |

### Re-verification after the merge (beyond the plan)

The merge brought in `origin/main`'s own edit to `src/app/api/strategies/csv-finalize/route.ts`,
the file plan 02 also edited, and it merged cleanly. So the affected gates were re-run on the merged
tree before the release commit:

- `tsc --noEmit`: exit 0. `eslint` on `route.ts`, `queries.ts`, `closed-sets.ts` and
  `percentile-core.ts`: exit 0.
- vitest over every `*.test.ts` under `src/` that names `csv-finalize` (27 files) gave
  `Test Files 26 passed (26)` / `Tests 1133 passed | 4 skipped (1137)`. The 27th file is excluded
  by the vitest config, so it did not run.
- The four sweep vitest files gave `Test Files 4 passed (4)` / `Tests 247 passed (247)`.
- mypy: `Success: no issues found in 100 source files`.
- The full pytest suite's first post-merge run gave `1 failed, 6200 passed`. The failure was
  `tests/test_worker_isolation_e2e.py::TestHealthzTcpServerHonesty::test_healthz_stays_200_through_long_backfill`.
  That test is timing-based. Its file passed alone 3 of 3 times (`4 passed` each), and the merge's
  only Python change was `tests/test_ledger_refresh_gates.py`. A second full run gave
  `6201 passed, 90 skipped, 462 warnings in 26.97s`. This is recorded as a flake under load, not as a
  regression.

## Task 2: release

**Merge:** `git fetch origin && git merge --no-edit origin/main` had one conflict, in
`.planning/STATE.md`. It was resolved as instructed:
- the frontmatter keeps this branch's `current_phase: "166"` block;
- the `progress:` block was byte-identical on both sides, so main's block and this branch's are the same;
- in the session block, both sides' `Phase:` / `Plan:` lines are kept, with this branch's first.

VERSION, package.json and CHANGELOG merged cleanly to main's side (0.90.0.0). ROADMAP.md changes
arrived only through main's side of the merge, and this plan made no ROADMAP edit.
Merge commit: `f22e63712`.

**Version:** `printf %s 0.91.0.0 > VERSION` (no trailing newline, checked with `od -c`), and
package.json's `"version"` was edited directly. `npm version` was not run.

**Version gate output** (`node scripts/check-version-bump.mjs`, after
`--self-test` printed `=== SELF-TEST PASSED: 5/5, every defect kind fired on its own input ===`):

```
base=0.90.0.0 head=0.91.0.0 package=0.91.0.0 changed=40
✅ No defects
```

The plan's verify 1 (4-digit, byte-equal, top heading present) printed OK. CRITICAL-02
(`critical-regressions.test.ts`) passed inside the 247.

**Release commit:** `f03bc9357` `chore(release): v0.91.0.0 — QSTATS-TRUTH`.
`git show --name-only --format=` lists exactly `CHANGELOG.md`, `VERSION` and `package.json`. The
captured message was non-empty and the six-token grep found 0 matches. `test -L node_modules` was
false at commit time.

### Commit checklist (35 commits, `origin/main..HEAD` before the release commit)

The mapping was checked mechanically: every short hash from `git log --format=%h origin/main..HEAD`
was grepped in the entry text (`commits=35 unmapped=0`).

| commit | subject (short) | CHANGELOG section |
|---|---|---|
| `e91226a6c` | capture phase context | Notes: planning commits |
| `a1d479c22` | record phase 166 context session | Notes: planning commits |
| `9007cceb0` | research, validation, post-research decisions | Notes: planning commits |
| `c388fbd6f` | create phase plan | Notes: planning commits |
| `850ce0d9d` | merge origin/main | Notes: merges |
| `73cbf2995` | record founder answers D-15..D-17, OPEN-2 | Notes: planning commits |
| `1e998899e` | derive percentile KPI projection, byte-pinned | Changed (code shape) |
| `88dd7fafe` | extract drawdown primitives | Added: primitives |
| `da13b3cd6` | derive csv-finalize clock-safety columns, byte-pinned | Changed (code shape) |
| `c94788406` | extract vol/Sharpe, downside RMS, CVaR tail | Added: primitives |
| `7d1f03098` | 166-02 SUMMARY | Notes: planning commits |
| `c0779f1ba` | 166-01 SUMMARY | Notes: planning commits |
| `13ad4850e` | merge wt/166-02 | Notes: merges |
| `202c1c838` | close guess, drawdown family | Fixed |
| `c99b86b02` | pin drawdown mirrors to live qs | Fixed, Tests |
| `c702b19fb` | 166-03 SUMMARY | Notes: planning commits |
| `09eb012f6` | close guess, loss family | Fixed |
| `ca9b2a3d3` | pin loss mirrors, failure-soft leaf fault | Fixed, Tests |
| `b5d96e9d5` | PSR non-excess fourth moment (D-16) | Fixed, Changed |
| `497d90914` | 166-04 SUMMARY | Notes: planning commits |
| `df4c09de5` | close guess, r_squared benchmark leg | Fixed |
| `097966d84` | alpha/beta None not fabricated zero (D-15) | Fixed, Changed |
| `270ef0912` | 166-05 SUMMARY | Notes: planning commits |
| `8dbcd8bff` | close guess, rolling leg, windowed alpha (D-17) | Fixed, Changed, Removed |
| `dbb7a64da` | pin rolling beta/alpha at full precision | Fixed, Tests |
| `54ab93333` | 166-06 SUMMARY | Notes: planning commits |
| `38ec7cc44` | AST gate replaces line gate | Added, Removed |
| `2abc1775e` | print census and 30-vs-9 reconciliation | Added |
| `8be6b11a0` | 166-07 SUMMARY | Notes: planning commits |
| `4d338a183` | RED/GREEN needles per call shape | Added |
| `9e89ec533` | preparer-spy pins with calibration rows | Added |
| `c7d5aafb8` | 166-08 SUMMARY | Notes: planning commits |
| `9aadde8c0` | close WINDOWS 5 and 9, TODOS 0f | Notes: refuted claim |
| `de4607e51` | 166-09 SUMMARY | Notes: planning commits |
| `f22e63712` | merge origin/main (this plan) | Notes: merges |

The entry uses the repo's own section vocabulary: Fixed, Changed, Added, Removed, Tests, Root
cause and Notes, plus one "Changed (code shape, no value change)" subsection. It discloses
D-15, D-16 and D-17 with before and after values from `166-09-SUMMARY.md`. It also carries the
recorded-not-changed findings (F-1 and the `recovery_factor` numerator), the refuted
kwarg-closable claim, quantstats staying at 0.0.81, and OPEN-2. It contains no
credential-shaped literal, home path, username, strategy name, UUID or project ref (grepped
before insertion, and hygiene passed with the file staged).

**Note for a later review fix round:** new commits on this branch mean the `0.91.0.0` entry must
be REPLACED by a re-unified one (CHANGELOG step 4). Never append a second entry.

## Task 3: OPEN-2 (checkpoint:decision, already answered)

**OPEN-2: ANSWERED by the founder on 2026-09-24 through AskUserQuestion.** Recorded in
`166-CONTEXT.md`, section "Founder answers, 2026-09-24":

> **OPEN-2: ANSWERED.** After 166 merges, run plan 10's read-only census and queue a recompute of
> the affected PRODUCTION rows. The recompute is enqueued through the normal job path, never by
> hand-written data.

The orchestrator relayed the chosen AskUserQuestion option as "Recompute affected rows after merge". It matches the plan's
option `route-recompute-to-a-phase`: the founder runs the census SQL, and then a NEW phase owns the
enqueue of recomputes. Because the answer already existed, the checkpoint did not stop.

- **This phase performed NO production write, recompute, backfill or enqueue**, and no command in
  this plan connected to any remote database (D-11).
- **The census SQL is in `166-09-SUMMARY.md`, section "Census SQL for the founder (D-11,
  read-only)"**: five `SELECT` statements with their caveats.
- **The new phase is not created here.** The orchestrator adds it with `/gsd-phase`.

## Deviations from Plan

1. **[Orchestrator instruction] The sweep ran before the merge, and the release SHA differs from
   SWEEP_SHA.** The orchestrator asked for Task 1 as written, and then for `origin/main` to be
   merged first in Task 2. The gates affected by the merge were re-run on the merged tree (see
   "Re-verification after the merge"), and all ended green.
2. **[Orchestrator instruction] The version is 0.91.0.0**, not the plan-time estimate of at
   least 0.88.0.0, because `origin/main` had moved to 0.90.0.0.
3. **Not run in this plan:** the `state.advance-plan`, `roadmap.update-plan-progress` and
   `requirements.mark-complete` handlers. The orchestrator forbade touching ROADMAP.md, and the
   repo CLAUDE.md records that these handlers clobber STATE.md and ROADMAP.md. The orchestrator
   owns position tracking.

## Known Stubs

None.

## Threat Flags

None. T-166-21 (no skip token, grep = 0 on both commit messages), T-166-22 (no identifier, hygiene
OK), T-166-23 (no database connection), T-166-24 (35/35 mapped) and T-166-SC (only the version
field changed in package.json) are all mitigated as planned.

## Self-Check: PASSED

- `f22e63712`, `f03bc9357`: present in `git log`.
- `VERSION` = `0.91.0.0` (no newline) and package.json `"version": "0.91.0.0"`. `grep -c QSTATS-TRUTH CHANGELOG.md` = 1.

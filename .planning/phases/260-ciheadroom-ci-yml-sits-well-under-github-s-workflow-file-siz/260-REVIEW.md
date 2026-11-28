---
phase: 260-ciheadroom
reviewed: 2026-11-28T11:45:00Z
depth: deep
files_reviewed: 8
files_reviewed_list:
  - scripts/check-workflow-size.mjs
  - .github/workflows/workflow-size.yml
  - src/__tests__/workflow-size-gate.test.ts
  - src/__tests__/critical-regressions.test.ts
  - .github/workflows/ci.yml
  - docs/ci-yml-notes.md
  - CLAUDE.md
  - docs/runbooks/shared-test-db-mutex.md
findings:
  critical: 0
  warning: 1
  info: 0
  total: 1
  necessity: 0
status: clean
---

# Phase 260: Code Review Report

**Reviewed:** 2026-11-28T11:45:00Z
**Depth:** deep
**Files Reviewed:** 8
**Status:** issues_found

## Summary

I reviewed the diff `176501797..HEAD` (excluding `.planning/`) in the worktree on branch `gsd/phase-ciheadroom`. The caller asked for MEDIUM and above only. I found one MEDIUM, a gap in test strength. I found no CRITICAL or HIGH. The workflow as shipped behaves correctly.

What I measured myself. I did not take any of it from the SUMMARY:

- **Executed YAML is unchanged.** `ci.yml` at base (511,664 bytes) and at HEAD (406,613 bytes) parse to identical objects under both `js-yaml` and `yaml` (with `uniqueKeys`). Both have 25 jobs. So no job name, step name, `needs:` edge, the `frontend` aggregator or any `run:` body changed.
- **The diff is comment-only and the move is lossless.** It has 24 hunks: 1,458 removed lines, all comments, and 24 added `# Rationale: docs/ci-yml-notes.md#<id>` lines. Each removed hunk appears verbatim and contiguous in `docs/ci-yml-notes.md` once de-indented (24/24, 0 missing). The doc's 48 fence lines pair up. Every doc heading names the key or step that actually follows its pointer in `ci.yml` (24/24).
- **No reader lost moved text.** I ran all 38 vitest files that mention `ci.yml` plus the 6 that enumerate every workflow file. The first parallel pass showed 5 timeouts under load. A serial rerun of those 5 files passed: 450/450. `node scripts/verify-plan-anchors.mjs --pending` printed `OK: 8 plan file(s), no stale claims`. No workflow `run:` body or `.sh` script reads `ci.yml` as input; every hit is prose or a path. A test still pins the most load-bearing moved warning, "changed-paths carries NO job-level `if:`" (`ci-docs-path-filter.contract.test.ts:743`).
- **The gate cannot pass vacuously.** An empty match and an unreadable directory are both `MEASURE_FAIL`, exit 1. On a green run `main()` only reaches the `largest` reduce when there are rows. An unrecognised flag exits 1. The entry guard exits 2 if the module was invoked under its own basename but did not recognise itself as the entry point. The comparison is strictly `>` CEILING, and both the self-test and vitest pin it at the exact boundary (460,800 green, 460,801 red). Symlinks are reported as skipped, and GitHub reads only top-level regular files in `.github/workflows`.
- **The workflow is independent of ci.yml and runs on every PR to main.** Its triggers (`push`/`pull_request` on `main`, plus `workflow_dispatch`) match `ci.yml`'s exactly. It has no paths filter, no `if:` and no `continue-on-error`. It has `permissions: contents: read`, `persist-credentials: false` and `timeout-minutes: 5`. Its checkout and setup-node pins are the same SHAs the other 44 checkout uses and the other setup-node uses carry. Its concurrency group falls back to `run_id` on push, so a main run is never cancelled. `ci.yml` does not name the script.
- **Cross-module effects.** `predecessorVerdict` reads check runs generically, so a red `workflow-size` on `before` makes the next push run FULL. That fails safe. Main currently carries 38 check runs, well under the `per_page=100` page. `main` has no branch protection or rulesets (`gh api .../branches/main/protection` returns 404), so the gate's force comes from the repo's "count the checks bound to the head SHA" merge rule, as CONTEXT intends.
- **Security.** `gitleaks dir docs/ci-yml-notes.md` and `gitleaks git --log-opts=176501797..HEAD` both report `no leaks found`. The squash commit's diff carries 1,633 new doc lines, and the path allowlist does not cover them, so this check mattered.
- The worktree is clean (`git status --porcelain` is empty apart from this file).

I read the necessity rubric. I did not assess necessity findings because they classify at Warning/Info and the caller scoped the report to MEDIUM and above.

## Warnings

### WR-01 (MEDIUM): the wiring test does not fail when a trigger is narrowed by `types:` or `branches:`

**File:** `src/__tests__/workflow-size-gate.test.ts:58-79` (`wiringFindings`)
**Issue:** The test's own header says it pins the wiring because "a gate nobody runs, or one a paths filter or an `if:` can skip, is a gate that does not exist". The caller's focus question is whether the workflow runs on every PR. `wiringFindings` checks three things:
- a trigger key is present, by exact line equality `l === "  pull_request:"` (line 69);
- there is no `paths:`/`paths-ignore:` (line 64);
- there is no `if:`/`continue-on-error:` (line 76).

Nothing inspects the lines under a trigger. So mutating `workflow-size.yml` in any of these ways leaves `wiringFindings` returning `[]` and the suite green, while the gate no longer runs on every PR:

```yaml
  pull_request:
    branches: [main]
    types: [labeled]          # gate now runs only when a label is added
```
```yaml
  pull_request:
    branches: [release]       # gate never runs on a PR to main
```
```yaml
  pull_request:
    branches-ignore: [main]   # same
```

The same applies to `push:` (`branches: [main]` changed to anything else). These have the same effect as the paths filter the test does catch: the check drops out of a PR's count and the board reads as healthy. That is the failure mode this phase exists to close (CLAUDE.md "CI gate integrity", trap 1). The workflow is correct today. The defect is that the test cannot fail if it stops being correct (CLAUDE.md Rule 9).

**Fix:** Pin the full trigger shape rather than key presence. The smallest change is to compare the `on:` block's non-comment lines to the decided shape. Add a calibration arm for each narrowing:

```ts
const EXPECTED_ON = ["  push:", "    branches: [main]", "  pull_request:", "    branches: [main]", "  workflow_dispatch:"];
// in wiringFindings, replacing the per-trigger presence loop:
if (JSON.stringify(onBlock(sizeWorkflowText)) !== JSON.stringify(EXPECTED_ON)) findings.push("on-block-shape");
// calibration arms (mutate an in-memory copy, as the file already does):
//   + "    types: [labeled]\n" under pull_request       -> on-block-shape
//   "branches: [main]" -> "branches: [release]" (pull_request) -> on-block-shape
//   "    branches-ignore: [main]\n" under pull_request  -> on-block-shape
```

If you keep the per-trigger `trigger-missing:*` findings for their clearer messages, add the shape check beside them. Do not replace them.

---

_Reviewed: 2026-11-28T11:45:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Silent-failure hunter (round 1), MEDIUM

### SFH-01 (MEDIUM): nothing pins which directory the default scan measures

- **File:** `scripts/check-workflow-size.mjs` (`DEFAULT_DIR`, `main()`), gap in `src/__tests__/workflow-size-gate.test.ts` (the arm "the real script is green over the real .github/workflows directory").
- **Evidence:** `node scripts/check-workflow-size.mjs .github` prints `.github/dependabot.yml: 4310 bytes ...` and `workflow-size: OK, 1 file(s)`, exit 0. If `DEFAULT_DIR` regressed to `.github` (or any dir holding one small yml), the gate, the self-test (which always passes an explicit tmpdir) and every test arm stay green while ci.yml is never measured.
- **Minimal fix:** in that real-run arm, also assert the output contains `.github/workflows/ci.yml:` and `.github/workflows/workflow-size.yml:`, and that the count of `^.github/workflows/.*\.ya?ml:` lines equals the number of `.yml`/`.yaml` regular files in `.github/workflows`.

## Orchestrator ruling

Both WR-01 and SFH-01 are fixed in a minimal fixer round: the gate's guarantee is the phase goal, so a test that cannot fail when the gate is narrowed or pointed elsewhere is a phase-goal gap.

## Fix round 1

Both fixes are in `src/__tests__/workflow-size-gate.test.ts` only, commit `4db153351`. No edits to the script or the workflow.

### WR-01: fixed

`wiringFindings` keeps the `trigger-missing:*` findings and gains `on-block-shape`, which compares the `on:` block's non-comment lines to `EXPECTED_ON` (push and pull_request each on `branches: [main]`, then `workflow_dispatch`). A new calibration arm mutates in-memory copies and expects `on-block-shape` for `types: [labeled]` under `pull_request`, `branches: [release]` under `pull_request`, `branches-ignore: [main]` under `pull_request`, and `branches: [release]` under `push`.

RED/GREEN: added `types: [labeled]` under `pull_request` in the real `.github/workflows/workflow-size.yml` (byte backup taken first). Result: 3 failed, including `has no findings on the real workflow` (`expected [ 'on-block-shape' ] to deeply equal []`). Restored with `cp`, `cmp` clean. The suite is then GREEN (27 passed).

### SFH-01: fixed

The arm "the real script is green over the real .github/workflows directory" now also asserts the output contains `.github/workflows/ci.yml:` and `.github/workflows/workflow-size.yml:`, and that the count of `^\.github/workflows/.*\.ya?ml:` lines equals the number of `.yml`/`.yaml` regular files in `.github/workflows` (read with `readdirSync`).

RED/GREEN: set `DEFAULT_DIR` in `scripts/check-workflow-size.mjs` to `.github` (byte backup taken first). Result: 1 failed (`expected '.github/dependabot.yml: 4310 bytes, 4…' to contain '.github/workflows/ci.yml:'`). Restored with `cp`, `cmp` clean. The suite is then GREEN.

### Verification

`npx vitest run src/__tests__/workflow-size-gate.test.ts src/__tests__/critical-regressions.test.ts`: 219 passed. eslint clean on the test file. `npx tsc --noEmit -p .`: no error in the test file. Both neutered targets verified byte-identical to HEAD after restore.

## Re-review (orchestrator, round 2)

Read commit 4db153351 in full: both arms are minimal, assert the decided shape, and were shown RED on a neutered target and GREEN after a byte-backed restore. No new finding at MEDIUM or above. Status set to clean.

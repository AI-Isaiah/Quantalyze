---
phase: 260-ciheadroom
verified: 2026-11-28T00:00:00Z
status: passed
score: 4/4 must-haves verified
verified_at_sha: 3b593c05afd51e9496c5bfe839feb5e96737a613
behavior_unverified: 0
overrides_applied: 0
drift_subjects:
  - .github/workflows/ci.yml
  - .github/workflows/workflow-size.yml
  - scripts/check-workflow-size.mjs
  - docs/ci-yml-notes.md
  - src/__tests__/workflow-size-gate.test.ts
  - src/__tests__/critical-regressions.test.ts
---

# Phase 260: CIHEADROOM Verification Report

**Phase Goal:** `ci.yml` sits well under GitHub's workflow file size limit with real headroom, and a gate that runs outside `ci.yml` fails a PR loudly when any workflow file nears that limit.
**Status:** passed (initial verification). Everything below was measured at HEAD `3b593c05a` against phase base `176501797`, not taken from the SUMMARY.

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | `ci.yml` well under 512,000 bytes with tens of KB headroom; comments moved verbatim to `docs/ci-yml-notes.md` behind pointers; no executed YAML changed (dated deviation: comment move, not script move) | VERIFIED | `wc -c`: base 511,664 B, HEAD 406,613 B (105,387 B under the hard limit, 54,187 B under the 460,800 ceiling). Diff vs base: 1,458 removed lines, all comments (0 non-comment removed), 24 added lines, all `# Rationale: docs/ci-yml-notes.md#<anchor>` pointers. Every removed line (comment marker stripped) was found as a substring of `docs/ci-yml-notes.md`: 0 missing. |
| SC-2 | A gate in its own workflow, not in `ci.yml`, fails when any workflow file passes a ceiling below 512,000, still runs when `ci.yml` is the oversized file, and is proven on a red fixture | VERIFIED | `workflow-size.yml`: own file, triggers `push: main`, `pull_request: main`, `workflow_dispatch`, no `paths` filter, no `workflow_run`, no `needs` on ci.yml; `ci.yml` has 0 references to `workflow-size`. Ceiling 460,800 (HARD_LIMIT 512,000). `--self-test` exits 0 (5 legs). Plain scan exits 0 ("18 file(s) at or under the 460800-byte ceiling; largest ci.yml at 406613"). Scratch dir with the base (unshrunk) `ci.yml` (511,664 B): exit 1, `::error file=...ci.yml` annotation. Boundary fixtures: 460,801 B exits 1, 460,800 B exits 0. |
| SC-3 | Every test that reads `ci.yml` text keeps passing and still fails when the pinned behaviour changes | VERIFIED | The two named files (`workflow-size-gate.test.ts`, `critical-regressions.test.ts`): 2 files, 219 tests pass. All 36 other test files that mention `ci.yml` (28 in `src/__tests__`, 8 in `src/__tests__/contracts`) were run in two batches: 36 files pass (2,543 tests, 18 skipped pre-existing). Because executed YAML is unchanged (see SC-4), the behaviours they pin are unchanged. |
| SC-4 | `frontend` aggregator `needs:` list and result loop, and every job/step name, stay identical | VERIFIED | Base and HEAD `ci.yml` parsed with the `yaml` package and compared with `assert.deepStrictEqual`: DEEP EQUAL (25 jobs, 201 steps). Comments are not part of the parsed object, so `needs:`, result loop, job names and step names are identical by construction. |

**Score:** 4/4 truths verified; 0 behavior-unverified.

## Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `scripts/check-workflow-size.mjs` | VERIFIED | 256 lines, real scan/judge/self-test, empty scan is MEASURE_FAIL, entry-guard exit 2 |
| `.github/workflows/workflow-size.yml` | VERIFIED | runs self-test then scan; wired to the script |
| `docs/ci-yml-notes.md` | VERIFIED | 24 pointer anchors in `ci.yml` all resolve to sections |
| `src/__tests__/workflow-size-gate.test.ts` | VERIFIED | passes |
| prose readers (`CLAUDE.md`, `docs/runbooks/shared-test-db-mutex.md`) | VERIFIED | repointed to the notes file; `critical-regressions.test.ts` lists `workflow-size.yml` |

## Anti-Patterns

None blocking. No debt markers introduced in the gate script or workflow.

## Human Verification Required

None. The GitHub-side checks (CI actually starting on the PR, the `Workflow size` check appearing in the count) are ship-time checks, not verification gaps.

## Gaps Summary

No gaps. Note for ship time: HEAD is 105 KB under the hard limit, so Phase 243 PR #1405 (about +300 B) and Phase 258 rebase cleanly size-wise.

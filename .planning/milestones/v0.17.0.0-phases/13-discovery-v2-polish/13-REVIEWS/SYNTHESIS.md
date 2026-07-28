# Phase 13 Plan Review — Synthesis

**Date:** 2026-04-28
**Phase:** 13 — Discovery v2 Polish
**Plans reviewed:** 13-01 (Watchlist) / 13-02 (Customize prefs) / 13-04 (Sparkline) / 13-05 (is_example backfill)
**Reviewers:** 3 attempted, 2 returned with substance.

---

## Reviewer Status

| # | Reviewer | Model | Status | Net new blockers / warnings |
|---|----------|-------|--------|------------------------------|
| 1 | gsd-plan-checker (in-house) | sonnet | ✅ Returned APPROVED after fixes | 2 blockers + 1 warning (all resolved) |
| 2 | Grok 4.2 (outside voice via xAI API) | grok-4.2 | ❌ **Failed — xAI account credits exhausted** ("Some resource has been exhausted... please purchase more credits or raise your spending limit") | n/a |
| 3 | Fresh-context Claude (Opus 4.7, no prior conversation) | opus | ✅ Returned APPROVE-WITH-REVISIONS | 3 BLOCKERs + 3 warnings |

> Grok could not run. The user can top up xAI credits and re-run — payload is captured at `13-REVIEWS/grok-payload.md` (167 KB) and `13-REVIEWS/grok-request.json` (174 KB). Re-issuing the request after top-up takes one curl call.

---

## In-house plan-checker findings (already resolved, commit `a374f08`)

| # | Severity | Plan | Issue | Fix applied |
|---|----------|------|-------|-------------|
| 1 | Blocker | 13-05 | `success_criteria` #3 said "089 is the next-free number" — contradicted the plan's own `090_seed_is_example_backfill.sql` filename and TODOS.md after PR #82 | Updated SC#3 + Task 2 `read_first` to "090 next-free; 089 is `089_claim_failed_retry.sql` from PR #82" |
| 2 | Blocker | RESEARCH | `## Open Questions` section lacked `(RESOLVED)` suffix required by Dimension 11 | Added suffix + inline `RESOLVED:` markers to all 6 questions citing TODOS.md / plan resolution sources |
| 3 | Warning | 13-02 | Task 3 retroactively rewrites `useDiscoveryPrefs` hook signature; the undefined-uid test case was buried in Task 3 prose only | Added test case 12 to Task 1 explicitly: `useDiscoveryPrefs(undefined, slug) NEVER writes to localStorage` |

---

## Fresh-context Claude findings (NEW — not yet resolved)

### BLOCKER 1 — Sparkline visual-regression spec is a dead gate against current seed fixtures

**Plan:** 13-04 Task 2 (`e2e/discovery-sparkline-regression.spec.ts`, lines 228–292)
**Issue:** All 8 `STRATEGY_PROFILES` in `scripts/seed-demo-data.ts:111-209` have positive `annualizedReturn` between `+0.11` and `+0.28`. The mulberry32 cumulative-return walk on a positive-mean drift will not realistically produce negative final values. The e2e spec passes trivially because no `sparkline_returns` SVG ever has the negative branch color, so a future regression to split-color would not necessarily be caught.

**Fix proposal:** Add a synthetic-fixture component test in Plan 13-04 Task 1 that mounts `StrategyTable` with three rows (final>0, final<0, final==0) and asserts SVG strokes match the rule. Optionally have the e2e additionally assert "drawdown SVG IS `var(--color-negative)`" so the negative-color path is at least exercised somewhere in the live DOM.

**Severity:** Real blocker — this dimension is what DISCO-04 is for. Without negative-fixture coverage, DISCO-04 ships a no-op gate.

---

### BLOCKER 2 — `useDiscoveryPrefs` signature contradicts test case 12

**Plan:** 13-02 — cross-task contradiction
**Issue:** Plan 13-02 Task 2 ships `useDiscoveryPrefs(uid: string, slug: string)` (line 328). Task 3 retroactively rewrites the signature to `useDiscoveryPrefs(uid: string | undefined, slug: string)` (line 692). Test case 12 in Task 1 (added by the in-house checker fix above) calls `useDiscoveryPrefs(undefined, slug)` — which is a TypeScript compile error against Task 2's required-uid signature.

**Fix proposal:** Land the `string | undefined` signature in Task 2 directly. Delete the "Step 3a section: retroactively update Task 2's hook signature" prose at `13-02-PLAN.md:691-708`. Move the `if (!uid) return` persistence guard into Task 2's hook implementation.

**Severity:** Real blocker — test case 12 won't compile against Task 2 as written. The in-house checker added the test but didn't notice the signature mismatch in the same plan.

---

### BLOCKER 3 — `seedAllocator` is the wrong export name

**Plans:** 13-02 Task 1 step 1 (line 237), 13-05 Task 3 (lines 347–349, line 463)
**Issue:** Plans import `seedAllocator` from `e2e/helpers/seed-test-project`. The verified actual export name is `seedTestAllocator` (line 60 of that helper). The acceptance grep at `13-05-PLAN.md:463` will fail because it greps for the wrong symbol.

**Fix proposal:** Rename to `seedTestAllocator` in all 4 places. Update acceptance grep to `seedTestAllocator\|cleanupTestAllocator`.

**Severity:** Real blocker — execution will fail at the import statement, before any logic runs.

---

### Warnings (should fix; non-blocking)

| # | Plan | Issue | Source |
|---|------|-------|--------|
| W1 | 13-01 Task 3 step 9 | `<EmptyWatchlist>` replaces the entire StrategyTable return — including the filter row — leaving an empty-watchlist user trapped with no way back to the All tab. | Fresh Claude |
| W2 | 13-01 Task 1 file 3 | The 200ms-disabled-timer test fights `useTransition` semantics; the implementation at lines 443-468 doesn't use a fixed timer, making the test non-deterministic. | Fresh Claude |
| W4 | 13-01 Task 2 | Auth flow inlined for `PUT /api/watchlist/[strategyId]` instead of extending `withAuth` to forward `ctx.params` — produces two code paths to maintain. | Fresh Claude |

Plus the in-house checker's W3 (Plan 13-02 high surface area / hook signature retroactive change) — partially absorbed into BLOCKER 2 above.

---

## Synthesis Verdict

**Status:** APPROVE-WITH-REVISIONS (3 new blockers).

**The in-house plan-checker did good structural work** — caught migration-numbering staleness, RESOLVED suffix omission, and the missing test-case-12 audit. Its blind spot was **adversarial execution simulation**:

- It didn't simulate a fresh runtime against current seed fixtures (BLOCKER 1).
- It saw test case 12 as a valid acceptance criterion but didn't verify it would compile against Task 2 (BLOCKER 2).
- It didn't grep the e2e helper for the actual export name (BLOCKER 3).

**The fresh-context Claude review** caught all three by reading source files alongside the plans. Pattern: in-house checkers test plan structure; fresh-context reviewers test plan-vs-codebase alignment. Both passes are needed.

**Grok was unavailable** — the third opinion is missing. The two reviews we have are sufficient to act on; Grok would primarily add stylistic / scope-creep checks that aren't critical for a Low-complexity 4-plan phase.

---

## Recommended next action

Apply the 3 BLOCKERs as a single revision commit before `/gsd-execute-phase 13`. Estimated diff:

| Plan | Change | Lines affected |
|------|--------|----------------|
| 13-04 | Add synthetic-fixture component test in Task 1 (3 cases: final>0, final<0, final==0); add drawdown-SVG-is-negative assertion to Task 2 e2e spec | ~30 added |
| 13-02 | Lift `useDiscoveryPrefs` signature to `string \| undefined` in Task 2; delete Task 3's "retroactively update" section; move guard | ~20 net (delete > add) |
| 13-05 | Rename `seedAllocator` → `seedTestAllocator` in 4 places; update acceptance grep | ~5 |
| 13-02 | Same rename if step-1 line 237 references `seedAllocator` | ~1 |

After fixes, **no need to re-run plan-checker** — these are surgical text edits that don't alter plan structure. Optionally re-run the fresh-context Claude pass to confirm clean.

The 3 warnings (W1/W2/W4) are not blocking and can be addressed during execution or in a follow-up SUMMARY note.

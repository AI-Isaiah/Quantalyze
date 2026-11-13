---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 31
subsystem: ui-copy
tags: [copy, plainwords, f-04, u-26, bridge-retired]
requires:
  - phase: 201
    provides: "plans 201-08 to 201-22 and 201-27 merged (wave 4)"
provides:
  - "replacement scoring route errors, panel fallback, flagged link, intro message and admin source label without the retired word"
affects: [201-33]
tech-stack:
  added: []
  patterns: ["copy-only rename; route path, enum value, log tags and identifiers untouched"]
key-files:
  modified:
    - src/app/api/bridge/route.ts
    - src/app/api/bridge/route.test.ts
    - src/components/portfolio/ReplacementPanel.tsx
    - src/components/portfolio/ReplacementPanel.test.tsx
    - src/components/portfolio/ReplacementCard.tsx
    - src/__tests__/display-sign-census-misses.test.tsx
    - src/components/portfolio/InsightStrip.tsx
    - src/components/portfolio/InsightStrip.test.tsx
    - src/lib/display-labels.ts
    - src/lib/display-labels.test.ts
    - src/app/(dashboard)/admin/intros/page.tsx
    - src/app/(dashboard)/admin/intros/page.test.tsx
key-decisions:
  - "Copy only (F-04): /api/bridge, the bridge source value, log tags and identifiers stay."
requirements-completed: [CLAR-04]
status: complete
actuals:
  tokens: 9000
  tasks: 3
  commits: 3
plan_head_before: 7a8543ac6feeaab34480b10f874f3c1008c45985
plan_head_after: 7fc0fdb14e66bc404649d21a3a6471fb663ce31f
---

# Phase 201 Plan 31: Retire "Bridge" from the replacement flow's copy Summary

The replacement scoring errors, the panel fallback, the flagged-holdings link, the sent intro message and the admin intros source label now use the plain words of U-26, with every status code, `code` field, href, key and stored value unchanged.

## Tasks

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | a589420bc | `/api/bridge` 429, 504, 500 sentences read `Scoring replacements ...`; panel fallback reads `Replacement request failed` |
| 2 | f7fd81837 | Insight strip link `{n} holding(s) outside your mandate — Review in Scenario →`; intro message `Suggested replacement for strategy {id}. Composite score: {score}.` |
| 3 | 7fc0fdb14 | `INTRO_SOURCE_LABELS.bridge` = `Replacement`; admin intros header `Rows from a replacement suggestion include replacement context.` |

## Verification

- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 8 claims, no stale.
- Task 1 verify: route.test.ts + ReplacementPanel.test.tsx + copy-census.test.ts: 3 files, 89 tests passed.
- Task 2 verify: InsightStrip.test.tsx + display-sign-census-misses.test.tsx + ReplacementCard.test.tsx + copy-census.test.ts: 4 files, 105 tests passed.
- Task 3 verify (full): display-labels.test.ts, admin/intros, route.test.ts, src/components/portfolio/, display-sign-census-misses.test.tsx, copy-census.test.ts: 12 files, 364 tests passed. `npx eslint` on the six source files exit 0. `npm run typecheck` (`tsc --noEmit`) printed no errors, exit 0.
- Acceptance greps: `Scoring replacements` in route.ts = 3; `Replacement request failed` = 1; `Bridge scoring` = 0; `outside your mandate` in InsightStrip.tsx = 1; `Suggested replacement for strategy` in ReplacementCard.tsx = 1; `bridge: "Replacement"` = 1; `Rows from a replacement suggestion` = 1.
- Context-block grep over the six source files after the edits prints only comments: `route.ts:31` (a `//` comment about the route's limiter) and `InsightStrip.tsx:141` (a `//` comment). No user-visible string.
- Phase-200 files re-grepped: no hit in `ApiKeyManager.tsx`, `ConfirmKeyChangeDialog.tsx`, `e2e/api-key-flow.spec.ts`, `e2e/sync-analytics-flow.spec.ts`.

gc-201-31-neuter: gate=src/app/api/bridge/route.test.ts (TC8, TC9b, WIZERR-06 a/b/c, hand-transcribed terminal sentence) result=red restored=identical
  RED lines: `× TC8 — scoring throws → 500 with STATIC message (H-1062: no leak)`, `× WIZERR-06 (a) ...`; `Expected: "Scoring replacements failed. Please try again."  Received: "Bridge scoring failed. Please try again."`; `cmp` exit 0, then 35 passed.

gc-201-31-neuter: gate=src/__tests__/display-sign-census-misses.test.tsx (sentMessage pins 0.00, 0.82, -0.41) result=red restored=identical
  RED lines: `× a composite score of -0.003 is sent as 0.00, not -0.00`, `× an ordinary composite score keeps its digits: 0.82 and -0.41`; `Expected: "Suggested replacement for strategy old. Composite score: 0.00."  Received: "[Bridge] Replacement candidate for strategy old. Composite score: 0.00."`; `cmp` exit 0, then green.

gc-201-31-neuter: gate=src/lib/display-labels.test.ts (statuses) and admin/intros/page.test.tsx (labels the source and the snapshot status) result=red restored=identical
  RED lines: `× statuses`, `× labels the source and the snapshot status`; `Expected: "Replacement"  Received: "Bridge"`; the page arm's received text carried `...Unnamed strategyBridge—Ready...`; `cmp` exit 0, then 67 passed.

Task 1 and Task 2 RED-before-GREEN: the new pins failed against the unedited sources (8 failures in task 1, 6 in task 2, 2 in task 3) before the source edits.

gc-201-31-gates: vitest=green eslint=clean tsc=clean

## Recorded items

upstream-copy: `grep -a -rn "Bridge" analytics-service --include="*.py"` minus comment lines prints docstrings (`routers/simulator.py:5`, `routers/portfolio.py:2098`, `services/bridge_scoring.py:2,55`, `services/rate_limit.py:81` doc table), class and function identifiers (`BridgeRequest`, `PortfolioBridgeResponse`, `portfolio_bridge`, test class names) and test names. One raised string contains an identifier, not the capitalised word: `models/schemas.py:181` `raise ValueError("user_id is required for BridgeRequest")`. It is a pydantic validation message for an empty `user_id`, which `/api/bridge` supplies from the authenticated session, so it is not reachable through this route in normal use, and `\bBridge\b` does not match `BridgeRequest`. No analytics-service error or response string carries the retired word, so A-15 holds. Reported, not changed.

stored-messages: `grep -a -rn -F "[Bridge]" src e2e tests supabase analytics-service` prints one line after the edit: `src/__tests__/display-sign-census-misses.test.tsx:200`, this plan's own explanatory comment. Before the edit the only code hits were `ReplacementCard.tsx` and the three pins. No consumer in `src`, `e2e`, `tests`, `supabase` or `analytics-service` keys on the `[Bridge]` prefix (A-14). Intro requests already stored keep `[Bridge] Replacement candidate ...`; there is no migration, so this is recorded and not rewritten.

cross-plan-pins: none. Old literals (`Bridge scoring`, `Bridge request failed`, `Bridge flagged`, `Bridge-sourced`, `[Bridge]`) remain only in `BridgeWidget.test.tsx` and `BridgeWidget.variants.test.tsx` (`Bridge flagged` text pins on the widget, owned by the BridgeWidget plans, not by these six files).

reported-not-edited: none.

## Deviations from Plan

None - plan executed as written. Two small additions inside the plan's own files: the doc comment above `flaggedCount` and the file header of `admin/intros/page.tsx` were reworded so they no longer quote or name the old copy (comments only, no behaviour change). The InsightStrip comment avoids repeating the new sentence so `grep -c "outside your mandate"` stays 1 as the acceptance criterion requires.

## Known Stubs

None.

## Threat Flags

None. T-201-40: only the static sentences changed; the WIZERR-06 arms (no traceback or base URL crosses the wire) stayed green and the terminal sentence stays hand-typed. T-201-41: prefix grep recorded above.

## Self-Check: PASSED

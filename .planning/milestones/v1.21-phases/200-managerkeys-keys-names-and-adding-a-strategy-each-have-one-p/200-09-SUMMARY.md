---
phase: 200-managerkeys-keys-names-and-adding-a-strategy-each-have-one-p
plan: 09
subsystem: ui
tags: [wizard, preselect, feeds, d-01, d-08, factsheet-link]
requires:
  - phase: 200-01
    provides: GET /api/keys/feeds and src/lib/key-feeds.ts (KeyFeed)
provides:
  - "feeds line (data-testid wizard-preselect-feeds) in ConnectKeyStep's saved-key summary"
affects: []
key-files:
  created:
    - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.preselect-feeds.test.tsx
  modified:
    - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx
decisions:
  - "Strategies link to /factsheet/<id> (the edit route is manager-guarded and the step is reached by allocators), per the plan."
  - "The line parses only strategy_id, name and kind. `status` is not shown, and the plan's own behaviour examples omit it, so requiring it would have turned a good answer into could-not-check."
  - "The result is stored with the key id it answers and a `live` flag drops a late answer, so a previous preselect's answer is never shown for the current key."
status: complete
commits: 2
plan_head_before: 95af12c315c19875cc9c774e3894f1effd878a6e
plan_head_after: 1562eb44862b40519a02684d10cc456b2fc6cca5
actuals:
  tokens: 11000
  tasks: 2
  commits: 2
metrics:
  tasks: 2
  completed: 2026-11-11
---

# Phase 200 Plan 09: the wizard names what the saved key feeds Summary

The wizard's saved-key summary, the one wizard surface that lists an existing key, now reads `GET /api/keys/feeds` once on mount and prints `Feeds: <factsheet link>, ...`, `Feeds no strategy.`, or `Could not check which strategies this key feeds.`. A failed read is never "unused".

## What was built

- `ConnectKeyStep.tsx`: module-level `readPreselectFeeds(keyId)` (never throws; non-2xx, non-map body, missing or non-list entry for the key, malformed entry, rejected fetch and a 15 s bound all answer `failed`; logs the reason only, no ids), `PreselectFeedsLine` (three states, read-only text and links, no control), and one effect keyed on `preselectKey?.id`. Without a preselect the effect returns before any fetch and the credential form is unchanged. Loading renders nothing. Copy strings are plan 01's, verbatim. `TRUST_ATOMS` untouched.
- A composite row the route redacted (null `strategy_id`) is named `a strategy we could not read` with no link, matching the key manager.
- `ConnectKeyStep.preselect-feeds.test.tsx`: 14 cases (listed with factsheet hrefs, redacted row, none, loading, seven failure shapes, no new control, stale answer dropped, no call without a preselect).

## TDD record

- RED commit `521c198f4`: the new test file against HEAD, 12 of 13 cases failing (the 13th, no-call-without-preselect, passes vacuously before the feature; the stale-answer case was added after and its neuter is below).
- GREEN commit `1562eb448`.

## RED evidence

Neuters applied to a byte copy kept in the scratchpad (`p200-bak/09/200-09-ConnectKeyStep.bak`), the test run, then restored with `cp -p` and `cmp` (exit 0) each time. A final `git diff --stat` showed only the intended changes.

- `ConnectKeyStep.tsx`, the failed state renders `Feeds no strategy.`: 7 FAIL, every `FAILED-NEVER-EMPTY` case (`expected 'Feeds no strategy.' to be 'Could not check which strategies this key feeds.'`). Restored.
- `ConnectKeyStep.tsx`, a map with no entry for the key is treated as `[]`: FAIL `FAILED-NEVER-EMPTY: the map lacks the preselected key` (same assertion). Restored.
- `ConnectKeyStep.tsx`, link to `/strategies/<id>/edit` instead of `/factsheet/<id>`: FAIL `FEEDS-LISTED: names each strategy as a link to its factsheet` (href attribute mismatch). Restored.
- `ConnectKeyStep.tsx`, fetch even without a preselect: FAIL `NO-CALL-WITHOUT-PRESELECT` (`expected [ [ '/api/keys/feeds', ... ] ] to deeply equal []`). Restored.
- `ConnectKeyStep.tsx`, drop the `live` guard: FAIL `STALE-ANSWER-DROPPED`. Restored.
- `ConnectKeyStep.tsx`, drop both the `live` guard and the `keyId` render guard: FAIL `STALE-ANSWER-DROPPED` (`expected 'Feeds: Alpha' to be 'Feeds no strategy.'`). Restored.

```
gc-200-09-neuter: gate=ConnectKeyStep.preselect-feeds.test.tsx#FAILED-NEVER-EMPTY result=red restored=identical
gc-200-09-neuter: gate=ConnectKeyStep.preselect-feeds.test.tsx#FAILED-NEVER-EMPTY(missing key) result=red restored=identical
gc-200-09-neuter: gate=ConnectKeyStep.preselect-feeds.test.tsx#FEEDS-LISTED(factsheet href) result=red restored=identical
gc-200-09-neuter: gate=ConnectKeyStep.preselect-feeds.test.tsx#NO-CALL-WITHOUT-PRESELECT result=red restored=identical
gc-200-09-neuter: gate=ConnectKeyStep.preselect-feeds.test.tsx#STALE-ANSWER-DROPPED result=red restored=identical
```

One further neuter attempt (an edit meant to drop the whole render guard) was written as a broken replacement and never run; the file was restored from the byte copy and `cmp` returned 0. It is not counted as evidence.

## Gates

- `npx tsc --noEmit -p .`: pass.
- `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps" src/__tests__/key-storage-census.test.ts src/lib/wizardErrors.roster-render.test.tsx src/components/strategy`: 94 files, 2035/2035 passed (the plan's own command, 32 files, 825/825, also green).
- `npx eslint` on the three changed files: pass.
- `node scripts/verify-plan-anchors.mjs` on the plan: `OK: 1 plan file(s), no stale claims.`
- Baseline before any edit: wizard steps dir 29 files, 699/699.

## Deviations from Plan

**1. [Rule 3 - Blocking] One existing case in `ConnectKeyStep.test.tsx` assumed the reuse POST is fetch call 0**
- **Found during:** Task 2.
- **Issue:** `reuse arm: the envelope's correlation_id equals the id sent on the reuse request...` read `fetchSpy.mock.calls[0]`. A preselect mount now issues the feeds GET first, so call 0 is the GET. The plan said not to edit an existing suite and to make the feed fail closed instead, but the failure is call order, not a missing route, so fail-closed cannot avoid it.
- **Fix:** the case now finds the reuse request with `calls.find(...)` on `/api/strategies/create-with-key`. No assertion changed. Every other preselect suite (`preselect-refusal-class`, credential-input, the rest of `ConnectKeyStep.test.tsx`) passed unedited.
- **File:** `ConnectKeyStep.test.tsx` (7 lines). **Commit:** `1562eb448`.

**2. [Plan premise] `status` is not required on a feed entry**
- The plan's behaviour examples return `{ strategy_id, name, kind }` with no `status`. The key manager's parser requires it; this line does not read it, so the local parser accepts any entry with a string-or-null `strategy_id` and `name` and a valid `kind`. A copy of the parser lives here rather than in `key-feeds.ts` because that file and `ApiKeyManager.tsx` are outside this plan's files and other wave-2 plans edit the manager.

## Known Stubs

None.

## Threat Flags

None. The only new request is the owner-scoped `GET /api/keys/feeds` (T-200-18); no id is sent. T-200-19 is covered by the `FAILED-NEVER-EMPTY` sweep and its neuters.

## Self-Check: PASSED

- FOUND: ConnectKeyStep.preselect-feeds.test.tsx, ConnectKeyStep.tsx, ConnectKeyStep.test.tsx
- FOUND commits: 521c198f4, 1562eb448

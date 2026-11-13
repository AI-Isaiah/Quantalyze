---
phase: 198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs
plan: 09
subsystem: allocator-overview-missing-data-message
tags: [missing-data, key-data-gaps, overview, glance-panel, d-01, route-07, one-fact-one-sentence]
requires:
  - phase: 198-03
    provides: keyDataGaps payload field (owner-only, server-derived ranges)
  - phase: 198-01
    provides: GlancePanel and its noteBelow prop
  - phase: 198-06
    provides: the Overview's Risk section and its one-line "See the note above." pointer
provides:
  - MissingDataMessage and missingDataLines, one named, dated, actionable line per affected key
  - the Overview mounts the message directly under the glance; the generic "equity history" panel no longer renders there
  - the glance's sr-only note pointer bound to the message rendering
  - FailingKeyExitNote filtered so a key the message names is not named twice
affects: [198-10]
actuals:
  tokens: 14000
  tasks: 3
  commits: 3
plan_head_before: bb8f4fa76e0555a92d768f91f205dba8ee21ed71
plan_head_after: f645e5f1c619ee91ff46c83ea61087cd1e2dc91b
commits: 3
tech-stack:
  added: []
  patterns: [a gap whose keys the owner's list does not fully label names nothing, so a foreign id can never print; a reason fallback prints only when no gap line of its own cause printed]
key-files:
  created:
    - src/app/(dashboard)/allocations/components/MissingDataMessage.tsx
    - src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx
  modified:
    - src/app/(dashboard)/allocations/components/EquityHistoryRebuilding.tsx
    - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
    - src/app/(dashboard)/allocations/AllocationDashboardV2.failing-key.test.tsx
    - src/app/(dashboard)/allocations/AllocationDashboardV2.rebuilding.test.tsx
    - src/app/(dashboard)/allocations/AllocationDashboardV2.ready-empty-book.test.tsx
    - src/app/(dashboard)/allocations/AllocationDashboardV2.warmup.test.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.connect-key-predicate.test.tsx
    - src/app/(dashboard)/allocations/OverviewRisk.history-parity.test.tsx
key-decisions:
  - "A gap line is printed whenever the owner's key list labels ALL its keys; a half-labelled gap names nothing. Fallbacks print only while rebuilding and only when no gap line of the reason's own cause printed."
  - "An unknown or null reason on a rebuilding book prints the shipped sentence only when no gap line printed, so a rebuilding book always has at least one line."
  - "namedExitKeyIds is exported from MissingDataMessage.tsx and reads the same label resolution as the lines, so the exit-note filter and the message cannot disagree on who is named."
  - "Day ranges are expanded to UTC days only when both ends are valid ISO days and from <= to (hard cap 36,600 days); otherwise the line falls back to 'no data since' or 'no complete history yet' instead of printing a guess."
requirements-completed: [ROUTE-07]
---

# Phase 198 Plan 09: the missing-data message Summary

The Overview now says which key, which days and what to do, one line per affected key, directly under the glance panel. The generic "We are holding back your equity history" panel and its four class headings no longer render on the Overview.

## What changed

- `components/MissingDataMessage.tsx`: `missingDataLines` turns `keyDataGaps`, the rebuild reason and the owner's keys into lines (`{key}: no data for {range}. {action}`, plus the read-incomplete, duplicate-account, shared-account, identity-pending and unknown-range forms). `MissingDataMessage` renders the `What is missing` section (not a live region, `max-w-prose`, `[overflow-wrap:anywhere]`), or nothing for no lines. Labels come only from `apiKeyLabelById`.
- `EquityHistoryRebuilding.tsx`: exports `isKnownRebuildReason`, `isNeedsActionReason`, `NeedsActionLine`, `NeedsActionReason`, `REASON_LINE` and `NotSyncingKey`, copy unchanged. `NotSyncingLine` now reads its one-key name from `apiKeyLabelById` (same string, one rule). The old panel component stays in the file for 198-10 to remove.
- `AllocationDashboardV2.tsx`: `missingLines` via `useMemo`; `<MissingDataMessage>` right after `GlancePanel`; `noteBelow={missingLines.length > 0}`; the not-ready curve slot renders nothing; `FailingKeyExitNote` receives only exits that no `sync_failing` / `read_incomplete` gap names with a label; docblock updated to the UI-SPEC order.
- No migration, no API route change, no payload change. Reads the existing `keyDataGaps` field only.

## TDD record

- Task 1: `MissingDataMessage.test.tsx` written first (RED: module missing), then GREEN (35 cases).
- Task 2 RED (commit `a0acbec`): `gc-198-09-red: AllocationDashboardV2.rebuilding=55/57 failed, OverviewRisk.history-parity=78/94 failed, AllocationDashboardV2.ready-empty-book=5 failed (the five fail-closed eligible-key arms), AllocationsTabs.connect-key-predicate=1 failed (tab=overview Arm A anchor), AllocationDashboardV2.warmup=0 failed (the nothing-missing guard, green on the old source by design)`. The commit lists only the five test files.
- Task 3 GREEN: the two new exit-note cases were added first and failed (`K1 named by a gap`, `a second exit with no gap entry`), then passed with the source change.

gc-198-09-neuter: gate=MissingDataMessage.test.tsx (label built as exchange + nickname instead of apiKeyLabelById) result=red restored=identical
gc-198-09-neuter: gate=MissingDataMessage.test.tsx (unknown-range fallback dropped, null range prints an empty range) result=red restored=identical
gc-198-09-neuter: gate=AllocationDashboardV2.failing-key.test.tsx (unfiltered exits passed to FailingKeyExitNote) result=red restored=identical

Each neuter was a byte copy to the scratchpad, edit, RED naming the case (14 cases for the label rule, 3 for the unknown range, 2 for the exit filter), `cp -p` restore and `cmp` exit 0, then GREEN.

gc-198-09-gates: vitest=green census=green tsc=clean lint=eslint-0-errors (planning-hygiene rule 6e red on ROADMAP.md, the known pre-existing "Phase 196" bullet, not touched)

Gates run: `npx vitest run "src/app/(dashboard)/allocations" src/__tests__/contracts/contracts-registry.test.ts src/__tests__/display-sign-single-source.test.ts src/__tests__/figure-gate-census.test.ts` (178 files, 3185 tests green), `npx tsc --noEmit` clean, `node scripts/verify-plan-anchors.mjs` on this plan OK (18 claims).

## Deviations from Plan

None to the plan's decisions. Notes:

1. The plan's behavior line "No line that names a key contains `your keys`" is held for every gap line. The shipped one-key `key_not_syncing` fallback (`One of your keys, Binance — Main, is not syncing, ...`) still says "your keys", exactly as the plan's own behavior list requires it to print "the same text as before". These two plan lines are in tension; the test pins the first for gap lines and the second for the fallback.
2. `AllocationDashboardV2.warmup.test.tsx` is the "nothing missing" guard and is green against the old source, so the combined RED command still exits non-zero through the other four files.
3. To meet the acceptance count of zero `overview-equity-rebuilding` in the rebuilding test, the absence of the retired panel is pinned through the four retired headings and the retired body sentence rather than by the old test id.

## Known Stubs

None.

## Threat Flags

None. The message reads only the owner-filtered `keyDataGaps` and `apiKeys` already in the SSR payload (T-198-17, T-198-18 mitigated and pinned by tests).

## Open items

- 198-10 removes the now-unmounted `EquityHistoryRebuilding` component and re-points `ScenarioComposer.test.tsx` at this message.
- ROADMAP.md rule 6e lint failure and the baseline-redump rebase are pre-existing and left as briefed.

## Self-Check: PASSED

- FOUND: MissingDataMessage.tsx, MissingDataMessage.test.tsx
- FOUND commits: 7b731c1dd, a0acbeccb, f645e5f1c

---
phase: 199-managerhome-each-role-lands-on-its-own-page-and-a-manager-has
plan: 15
subsystem: ui
tags: [degrade-warnings, registry, scenario, holdings, scan-ledger, vitest]
requires:
  - phase: 199-05
    provides: "the allocations scan ledger, the Phase 198 book-level registry entries, and the named deferral this plan empties"
  - phase: 199-11
    provides: "HoldingsTable no longer links /my-strategies, so its warnings are all that is left to register"
provides:
  - "The Scenario's own-book sentence is the registry line MissingDataMessage prints for the same reason (same id, same words); the four class-keyed strings are gone"
  - "scenario.per-source-fallback: names the eligible keys with no per-key series and ends on the named wait (new action id A-WAIT-NEXT-SYNC)"
  - "Four marker-only Scenario entries (empty-intersection, auto-excluded, loading-returns, series-syncing) and the Holdings read_failure entry"
  - "The allocations scan has no deferral set and no skip option; a test pins that none returns"
affects: [199-16, 199-18]
requirements-completed: [ROUTE-11]
actuals:
  tokens: 13600
  tasks: 2
  commits: 4
plan_head_before: d316728ae5374fcf624bc974f54422fd7feb9712
plan_head_after: c751228022b9c3e20b0782bc3cc630298984bdd2
status: complete
tech-stack:
  added: []
  patterns:
    - "A surface names a registry id as a literal at its render site (the scan attributes by literal) and renders the entry through DegradeLine"
    - "Parity between two surfaces is asserted by id AND words from one payload, with the expected ids written in the test, not read from the component"
key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"
    - "src/app/(dashboard)/allocations/components/HoldingsTable.tsx"
    - "src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx"
    - src/lib/degrade-warnings.ts
    - src/lib/degrade-warnings.test.tsx
    - src/__tests__/degrade-warning-scan.test.ts
decisions:
  - "D-04 read literally (199-UI-SPEC 'Reads the same registry entries as MissingDataMessage'): the Scenario renders the Overview's entry for the reason, so its copy changed from 'the comparison with your current book is not shown' to the Overview's chart-and-ratios sentence"
  - "The Scenario reads the reason's BOOK-LEVEL line; where the Overview can name a key it prints that key's line, and the divergence is pinned as by design"
  - "Holdings read failure keeps its shipped sentence and its own action ('Refresh to retry.') as shippedAction, as allocation.book.history-read-failed does"
  - "The named wait is a new vocabulary id with its UI-SPEC origin recorded beside it, because the closed vocabulary has no near match"
---

# Phase 199 Plan 15: Scenario and Holdings warnings registered, the allocations scan completed Summary

The Scenario's own-book sentence now renders the exact registry line the Overview's missing-data message prints for the same reason, its per-source fallback names the keys that lack a series, Holdings' read failure is a registered `read_failure`, and the allocations scan skips nothing.

## What was built

**Task 1 (tracer), RED `c84fe9c72`, GREEN `e9b17bac2`.**

- `OWN_BOOK_REBUILDING_LINE` (four class-keyed strings) is deleted. `ScenarioComposer.tsx` now has `OWN_BOOK_LINE_ID`, a `satisfies Record<EquityHistoryRebuildReason, DegradeId>` table naming, as literals, the `allocation.book.*` entry for each of the eight reasons, plus `allocation.book.unknown-reason` for null, absent, unknown and prototype-key reasons (through `isKnownRebuildReason`, the guard the Overview reads through). `OwnBookRebuildingLine` renders the entry through `DegradeLine` inside the existing `scenario-ownbook-rebuilding` paragraph.
- `scenario.per-source-fallback` (degrade, scope key, action `A-WAIT-NEXT-SYNC` = "Per-source toggles appear after their next sync.", origin recorded beside the id: the UI-SPEC's Scenario per-source fallback row). Text: `{labels} have|has no per-key return series yet, so this projection blends your whole book. {wait}`; with no resolvable label it reads "Your connected keys have no per-key return series yet..." (the `allocation.staleness-never` precedent). The labels are the payload's eligible keys that are not in `contributingApiKeyIds`, labelled with `apiKeyLabelById` (`{Exchange} — {nickname}`), sorted. The bold "Per-source modeling needs per-key history." heading and the `InfoBanner` shell stay.
- Four marker-only entries, each with `data-degrade-id` added to the element the file already owns: `scenario.empty-intersection` and `scenario.auto-excluded` (composition), `scenario.loading-returns` and `scenario.series-syncing` (in_progress).
- Scan ledger row for `ScenarioComposer.tsx`: 21 hits, 14 ids.

**Task 2, RED `d3cec74f1`, GREEN `c75122802`.**

- `allocation.holdings-strategies-read-failed`: `read_failure`, scope none, shipped sentence word for word, `shippedAction: "Refresh to retry."`. `HoldingsTable` renders it through `DegradeLine` inside its existing `role="status"` box.
- Ledger rows: `HoldingsTable.tsx` (2 hits: the read failure, and `AMBER_CHIP_STYLE`, a chip), `WatchlistPanel.tsx` (1 hit, a ledgered non-warning: the sr-only announcement, no edit to the file).
- The deferral set and the judge's `deferred` option are deleted. The pin test asserts the three former files are ledgered with hits, and that the scan test's own comment-stripped source declares no `const DEFERRED_…` and no `deferred:` option.

## Verification

All commands run in the worktree.

- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 4 claims, no stale (before the first edit and again at the tracer gate).
- Precondition: `git merge-base --is-ancestor 2b5b4ad9d HEAD` (phase 196 merge) succeeds; `grep -a -c "DEFERRED_UNTIL_196"` printed 7 and `grep -a -c 'href="/my-strategies"'` printed 0 on HoldingsTable before the edit.
- RED seen first for both tasks. Task 1: 15 failures in the Scenario file (the rewritten own-book and fallback cases), 9 in the registry test, 1 in the scan. Task 2: 4 failures (sample parity, entry shape, ledger, marker).
- Task 1 tracer re-run end to end (auto mode): `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" src/lib/degrade-warnings.test.tsx src/__tests__/degrade-warning-scan.test.ts`: 3 files, 533 passed. Log: `Tracer verified end-to-end — expanding`.
- Task 2: `npx vitest run "src/app/(dashboard)/allocations" src/lib/degrade-warnings.test.tsx src/__tests__/degrade-warning-scan.test.ts`: 186 files, 3298 passed.
- Collateral: `npx vitest run src/__tests__ src/components/degrade src/lib/degrade-warnings.test.tsx`: 180 files passed, 18 skipped (273 tests). The skipped files are the live-DB and RLS suites (`*-rls`, `bridge-outcome-cron*`, `compute-jobs-audit-*`, `retention-crons`, `scenario-commit-*`, `*schema-sync`, `gdpr-export`, `mandate-audit`, `factsheet-buildable-live-db`), skipped because no database is configured here; none touches this plan's files.
- Acceptance greps: old fallback token in `ScenarioComposer.tsx` 0 (HEAD 1; re-measured on the rebased tree before the edit, it was 1); `"scenario.per-source-fallback"` in `degrade-warnings.ts` 1; `DEFERRED_UNTIL_196 =` in the scan test 0.
- `npx tsc --noEmit -p .`: exit 0, no output.
- Lint, run as its parts: `npx eslint --no-cache` on all six touched `.ts`/`.tsx` source and test files: exit 0; `tsx scripts/check-admin-route-manifest.ts`, `check-route-contract.ts`, `check-planning-hygiene.ts`, `check-canonical-domain.ts`: all exit 0. **Not run:** `npm run lint`'s full-tree `eslint --cache src/` (the brief forbids it: its cache writes into the shared `node_modules` symlink).
- Left to CI: nothing in `supabase/`, `analytics-service/` or SQL was touched, so no SQL gate, mypy or local-stack lane applies. The full-tree eslint and the e2e lanes were not run locally. Known pre-existing failure `src/lib/factsheet/compute.conventions.test.ts` (2 frozen-snapshot cases) was not run or touched.

gc-199-15-neuter: ScenarioComposer.tsx on a byte copy, `OwnBookRebuildingLine`'s `segments` replaced by the old awaiting-style string of the Scenario's own while keeping the same `id`: 15 tests went RED (the eight per-reason parity cases on words, the four fail-closed cases, and the three D-15 disclosure cases); restored from the copy, `cmp` identical, 533/533 GREEN.

gc-199-15-neuter: degrade-warning-scan.test.ts on a byte copy, a `const DEFERRED_UNTIL_196 = [...]` re-added with `WatchlistPanel.tsx`: the pin case went RED (`expected '…' not to match /const\s+DEFERRED_\w*\s*=/`); restored from the copy, `cmp` identical, 16/16 GREEN.

gc-199-15-neuter: HoldingsTable.tsx (extra, user-facing) on a byte copy, `segments` replaced by the sentence minus its action: `carries the entry's id, its words and its shipped action` went RED; restored, `cmp` identical, 30/30 GREEN.

gc-199-15-gates: vitest=green tsc=clean lint=clean (lint = scoped eslint on touched files plus the four non-eslint lint scripts; the full-tree eslint step was not run, see above)

## Deviations from Plan

**1. [Rule 3 - Blocking, decision] D-04's "corresponding line" is the book-level line; divergence from the Overview recorded.** *Found during:* Task 1 read. *Issue:* the Overview's choice of line is not reason-only: `key_not_syncing` has three variants by `notSyncingKeys`, and a labelled gap replaces the book line with a key line. *Fix:* the Scenario reads the reason's book-level line (for `key_not_syncing` the singular one, true for any count of at least one); a test feeds the same payload to both and pins that an Overview that names the key prints `allocation.key-gap.not-syncing` while the Scenario keeps `allocation.book.key-not-syncing`. Both read the same reason and class, so neither says a different cause. A shared selector would have meant editing `MissingDataMessage.tsx`, outside `files_modified`; the table in `ScenarioComposer.tsx` plus the all-eight-reasons parity test is the alternative the plan's files allow.

**2. [Rule 2 - flagged consequence] The Scenario's own-book copy changed.** The old four sentences each said "so the comparison with your current book is not shown". The registry lines say the equity chart and the ratios built from it are hidden (and name the wait or the action), per UI-SPEC ("Reads the same registry entries as MissingDataMessage"), and I wrote no trailing clause of the Scenario's own. For the default fixture (reason null, fail-closed) the Scenario now prints the unknown-reason line, which ends "Use the contact form to have it checked", where it used to say "being rebuilt". If the founder wants the "comparison … not shown" disclosure back, it is a registry entry plus a segment, not an inline string.

**3. [Rule 3 - test edits] Existing Scenario tests were rewritten, not deleted.** The own-book block in `ScenarioComposer.test.tsx` (the D-02/D-15 constants and the SFH-C3-01 per-reason block) now asserts the registry line, id and words against the Overview's rendering of the same payload; the four fail-closed cases (null, missing, unknown, `constructor`), the "appear once" assertion, the Exchanges-link, reload and daily-run class checks were kept. The `holding back` and `being rebuilt` assertions went with the strings they pinned.

**4. [Rule 3] Measured hit count is 21, not the plan's 20.** `degrade-warning-scan.test.ts` reported `21 warning-styling hits` for `ScenarioComposer.tsx` at HEAD (199-05 recorded 21 as well); no edit here moves it. The ledger pins 21.

**5. Plan-ledger setup.** `gsd-plan-head-before-199-15` was written after the first (RED) commit, with value `d316728ae` (the verified fork point and `HEAD~1` of that commit).

**Total deviations:** 5 (one design decision, one flagged copy consequence, two test/measurement adjustments, one bookkeeping). **Impact:** none on scope; the two surfaces share ids and words for every reason the Scenario payload can express.

## Known follow-ups (not done here, by scope)

- `EquityHistoryRebuilding.tsx` (outside `files_modified`) still has a header comment and a `REBUILD_REASON_CLASS` doc saying the Scenario's own-book sentence "picks its copy by class alone". That is now false: the Scenario picks by reason, from the registry. `equityHistoryRebuildClass` and `ExchangesPageLink`'s "exported for the Scenario" note are no longer read by the Scenario. Comment-only fix, left for whoever next edits that file.
- 199-03 handed the `deselect` action handler to this plan, but the plan has no task for it and `DegradeLine.tsx` is out of scope. `A-DESELECT` still renders as plain text. The empty-intersection banner keeps its own working Deselect buttons, so no user-facing gap.
- The fallback's bold heading "Per-source modeling needs per-key history." stays inline JSX beside the registry line (existing tests assert it); it is a title, not a degrade sentence.

## Authentication Gates

None.

## Known Stubs

None. (Scanned the modified source files: no hardcoded empties flowing to UI, no placeholder text added. The four marker-only entries carry no `text` by design, as 199-05's did.)

## Threat Flags

None. T-199-21 is mitigated as planned: the surfaces share registry entries and the parity case has neuter evidence. Key labels still come from the owner's own `payload.apiKeys` through `apiKeyLabelById`; an eligible id the list does not carry names nothing, so a raw key id never prints (T-199-SC unchanged: no installs).

## Self-Check: PASSED

- Commits c84fe9c72, e9b17bac2, d3cec74f1 and c75122802 are on `worktree-agent-199-15` (`git merge-base --is-ancestor` checked); `commits: 4` measured with `git rev-list --count` from the ledger base.
- All seven modified files exist; no untracked files remain in the worktree; backups removed from the scratchpad.

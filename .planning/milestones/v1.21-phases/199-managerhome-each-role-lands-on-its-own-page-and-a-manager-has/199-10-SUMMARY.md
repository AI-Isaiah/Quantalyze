---
phase: 199-managerhome-each-role-lands-on-its-own-page-and-a-manager-has
plan: 10
subsystem: ui
tags: [strategies-index, role-furniture, phase-149-ranking, comparison-note, read-failure, vitest]
requires:
  - phase: 199-09
    provides: "/strategies admits allocator, manager and both; StrategiesSection as the one client host"
  - phase: 199-07
    provides: "StrategyTable allocatorFurniture prop and per-row managerRows"
provides:
  - "strategies/comparison-note.ts: mapCopy, NULL_COPY, kSentence (Phase 149 copy, one home) and PLACEHOLDER_KEYS_UNREADABLE"
  - "/strategies ranks every role's non-archived rows (getOwnRowPercentiles) and attaches trust_tier (readPublicVerificationSignals)"
  - "/strategies allocator reads (getStrategylessActiveKeys, getRealPortfolio) for allocator and both, with a read-failure line that is never the empty state"
  - "strategies/StrategiesEmptyState.tsx: the allocator-only empty state (moved from my-strategies/MyStrategiesEmptyState.tsx)"
affects: [199-11, 199-13, 199-14, 199-17]
actuals:
  tokens: 13441
  tasks: 3
  commits: 5
plan_head_before: 595a019858619fa24b902e1e43325bea3da1bd73
plan_head_after: 4c7928a12ce18bd6384852e4b23f041ca19db707
status: complete
tech-stack:
  added: []
  patterns:
    - "Allocator-only reads gated on isAllocator, so a manager's page makes none"
    - "Wizard-draft filter and companion read gated on isManager (CD-10)"
    - "Error is not empty: a null placeholder-key read prints its own line and suppresses the empty state"
key-files:
  created:
    - src/app/(dashboard)/strategies/comparison-note.ts
  modified:
    - src/app/(dashboard)/strategies/page.tsx
    - src/app/(dashboard)/my-strategies/page.tsx
    - src/app/(dashboard)/strategies/page.merged.test.tsx
    - src/app/(dashboard)/strategies/page.key-pill.test.tsx
    - src/app/(dashboard)/strategies/page.share-affordance.test.tsx
    - src/app/(dashboard)/strategies/page.table.test.tsx
    - src/app/(dashboard)/strategies/page.wizard-draft-banner.test.tsx
    - src/app/(dashboard)/strategies/page.wizard-submitted.test.tsx
    - src/components/strategy/StrategyTable.default-mounts.test.tsx
    - src/components/strategy/__fixtures__/strategy-table-default-mounts.json
  moved:
    - "src/app/(dashboard)/my-strategies/MyStrategiesEmptyState.tsx -> src/app/(dashboard)/strategies/StrategiesEmptyState.tsx"
key-decisions:
  - "D-02: the merged page keeps everything from both pages by role; the note, # and Pnn are every role's"
  - "CD-12: archived rows stay on the list and are not subjects of getOwnRowPercentiles"
  - "CD-10: an allocator-only viewer keeps a wizard draft as a Draft row, with no filter, no companion read and no banner"
requirements-completed: [LEAN-01]
coverage:
  - id: D1
    description: "Every role's list is ranked the Phase 149 way: # and Pnn, the note reading mapCopy(N) or NULL_COPY verbatim, one copy module; an archived row is listed but never ranked; a published composite keeps its verified check"
    requirement: LEAN-01
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/strategies/page.merged.test.tsx#the Phase 149 ranking on the merged list"
        status: pass
    human_judgment: false
  - id: D2
    description: "Allocator and both get placeholder rows with Finish setup and the K sentence; a manager's page makes neither allocator read"
    requirement: LEAN-01
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/strategies/page.merged.test.tsx#allocator reads and the K sentence, by role"
        status: pass
    human_judgment: false
  - id: D3
    description: "A failed placeholder-key read prints its line and is never the empty state; a failed list read shows STRATEGIES_LIST_UNREADABLE for every role; a failed key-status read prints KEY_STATUS_UNREADABLE_NOTE for an allocator too"
    requirement: LEAN-01
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/strategies/page.merged.test.tsx#empty and unreadable branches by role"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/strategies/page.merged.test.tsx#T-199-25"
        status: pass
    human_judgment: false
  - id: D4
    description: "Allocator-only keeps wizard drafts as Draft rows with no banner and no companion read; manager and both keep the filter and the banner"
    requirement: LEAN-01
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/strategies/page.merged.test.tsx#wizard drafts by role"
        status: pass
    human_judgment: false
  - id: D5
    description: "Role both sees one row per strategy with the union of furniture, placeholders, banner and K sentence"
    requirement: LEAN-01
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/strategies/page.merged.test.tsx#role both: one list with the union"
        status: pass
    human_judgment: false
---

# Phase 199 Plan 10: Everything from both pages, by role Summary

The merged `/strategies` page now shows each role at least everything its old page showed: every role gets the Phase 149 `#`/`Pnn` ranking and its note (from one copy module both pages import), allocator and `both` get the placeholder rows, `Finish setup` and the K sentence, an allocator-only viewer keeps wizard drafts as Draft rows, and a failed read is never shown as empty.

## Accomplishments

- Task 1 (tracer): RED first (`bd2d1364c`, 5 failing cases), then GREEN (`17709930c`). `strategies/comparison-note.ts` holds `mapCopy`, `NULL_COPY` and `kSentence` (moved verbatim from `my-strategies/page.tsx`, which now imports them). The strategies page asks `getOwnRowPercentiles` about the non-archived rows only and attaches `trust_tier` through `readPublicVerificationSignals`, the two reads running together. The note reads `mapCopy(own.populationSize)` or `NULL_COPY`.
- Task 2: RED (`9f81127e0`, 6 failing cases), then GREEN (`fdfefe253`). Allocator reads run only when `isAllocator`; `placeholderKeysUnreadable` (a null from `getStrategylessActiveKeys`) prints `PLACEHOLDER_KEYS_UNREADABLE` above the note and suppresses both the empty state and the table when nothing else loaded. The wizard-draft `.or()` filter, the companion draft read and the banner are manager/both only. The empty branch is the manager card (manager, both) or `StrategiesEmptyState` (allocator-only). `MyStrategiesEmptyState` moved by `git mv` (export renamed `StrategiesEmptyState`) and `/my-strategies` imports it from the new place.
- Task 3 (`4c7928a12`): the role-both case (one row per strategy from one list read, manager and allocator furniture on the same row, placeholders, resume banner, K sentence). Guards run green (below).

## Task Commits

1. RED: `bd2d1364c` test(199-10): failing tests for the Phase 149 ranking on the merged list
2. Task 1 GREEN: `17709930c` feat(199-10): every owner's list gets the Phase 149 ranking and its note
3. RED: `9f81127e0` test(199-10): failing tests for allocator rows, drafts and empty states by role
4. Task 2 GREEN: `fdfefe253` feat(199-10): the merged list shows each role everything its old page showed
5. Task 3: `4c7928a12` test(199-10): role both sees one list with the union of both pages

## Neuter evidence

gc-199-10-neuter: Task 1 - the ranking asked about every row instead of the non-archived ones (`const rankable = shapedRows;` in strategies/page.tsx, byte backup under the scratchpad, restored, `cmp` identical, backup deleted). RED: 2 failed / 14 passed (`CD-12: an archived row stays on the list, has no Pnn, and is not in the ranked population` and `no ranking read is made when no row is eligible`). Restored and GREEN (16 passed).

gc-199-10-neuter: Task 2 - a null placeholder-key read treated as zero placeholders (`const placeholderKeysUnreadable = false;`, byte backup, restored, `cmp` identical, backup deleted). RED: 2 failed / 29 passed (`T-199-25: a failed placeholder-key read prints its line, ...` and `T-199-25: a failed placeholder-key read on an otherwise empty account is NOT the empty state`: the line was missing and the allocator empty state showed). Restored and GREEN (31 passed).

## Ported behaviours from `my-strategies/page.test.tsx`

Each lives in `page.merged.test.tsx` (the old file is untouched and still green until plan 199-13 retires it):

| Old case | Merged case |
|----------|-------------|
| SC-1b owner-scoped reads (session user id; never a published predicate) | `a manager's page makes neither allocator read ...`, the allocator case's `user_id` scope (199-09) and `allocator and both: a placeholder row per key ...` (`getStrategylessActiveKeys` / `getRealPortfolio` called with the session id). The old `neq("status","archived")` arm is deliberately inverted by CD-12: archived rows stay listed and are left out of the ranking (`CD-12: ...`). |
| SC-2c map branch: N is the population size, one fetch | `every role: the note reads the Phase 149 copy with the real population size`, and the ranking spy is called once |
| SC-2c null branch: threshold copy | `every role: a population under the threshold switches the note to the threshold copy` |
| SC-2d own-scored Pnn on a draft row | `every role: # and Pnn render on the owner's rows` |
| K sentence appends when K > 0 | `allocator and both: a placeholder row per key ...` (note equals `${mapCopy(7)} ${kSentence(2)}`) |
| K sentence omitted when every key has a strategy | `the K sentence is omitted when every key has a strategy` |
| zero strategies and zero keys: empty state, CTA is a button, no note | `allocator only with nothing: the moved empty state ...` (manager and both take the manager card: `manager and both with nothing ...`) |
| zero strategies, bare keys: table section, only the K sentence, labels, no population fetch | `zero strategies but bare keys: ...` |
| WR-01 failed own-rows read: notice, never empty | `a failed list read shows the unreadable card for every role and never No strategies yet` |
| WR-01 failed keys read keeps the rows that loaded | `T-199-25: a failed placeholder-key read prints its line, keeps the rows that loaded ...` |
| WR-01 genuine empty-success has no notice | `allocator only with nothing` and `no placeholder-key line when the read succeeded` |
| page wiring: noStore and the allocator role guard | Superseded by plan 199-09: the merged page reads `profiles.role` itself (`role read discipline` cases); no `noStore` call was ported (the strategies layout is `force-dynamic`). |

New cases with no old twin: the trust_tier check on a published composite, the wizard-draft rule by role (CD-10), the just-submitted line for every role, the key-status note for an allocator, and the role-both union.

## Verification

All commands run from the worktree.

- `node scripts/verify-plan-anchors.mjs <plan>`: 10 claims checked, OK (exit 0).
- `npx vitest run "src/app/(dashboard)/strategies" "src/app/(dashboard)/my-strategies" src/components/strategy/StrategyTable.default-mounts.test.tsx src/__tests__/phase-149-my-strategies-parity.test.ts src/components/layout/Sidebar.test.tsx src/components/layout/MobileNav.test.tsx src/__tests__/phase-32-frozen-spine-guards.test.ts "src/app/(dashboard)/requireRolePage-wiring.test.tsx" src/__tests__/check-route-contract.test.ts src/__tests__/strategies-guard-coverage.test.ts`: 59 files, 1138 tests, all passed, none skipped.
- `npx tsc --noEmit -p .`: exit 0, no output.
- Lint: `npx eslint` scoped to `src/app/(dashboard)/strategies`, `src/app/(dashboard)/my-strategies` and the default-mounts test: no output (clean). The four script checks of `npm run lint` (`check-admin-route-manifest`, `check-route-contract`, `check-planning-hygiene`, `check-canonical-domain`): exit 0 each. The full cached `eslint --cache ... src/` was NOT run (its cache writes into the shared node_modules symlink); CI runs it.
- Acceptance: `getOwnRowPercentiles(` in strategies/page.tsx = 1 (HEAD 0); `const kSentence` in my-strategies/page.tsx = 0 (HEAD 1); `getStrategylessActiveKeys(` in strategies/page.tsx = 1 (HEAD 0); `my-strategies/MyStrategiesEmptyState.tsx` absent.
- Public goldens: a script compared the committed fixture at the base commit to the edited file: `discovery` and `browse` byte-equal; the owner entry equals the old one with `from=my-strategies` replaced by `from=strategies`.
- Not run: `src/lib/factsheet/compute.conventions.test.ts` (2 frozen-snapshot failures on main already, per the dispatch notes; not this plan's).

gc-199-10-gates: vitest=green tsc=clean lint=clean (scoped eslint + the four npm-run-lint scripts; full cached eslint left to CI)

## Left to CI

- No SQL touched, no migration, no local Supabase stack booted (disk rule). The sql-tests and local-stack jobs are unaffected.
- The full `npm run lint` eslint pass over `src/`.
- E2E (`e2e/*`) not run; `e2e/my-strategies.spec.ts` keeps `?from=my-strategies` until plan 199-17 retargets it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The owner-mount golden fixture is a data file outside `files_modified`**
- **Found during:** Task 2.
- **Issue:** "Replace the /my-strategies golden" cannot be done in the test file alone: the golden string lives in `__fixtures__/strategy-table-default-mounts.json`, and the old mount passed `origin={{ key: "my-strategies" }}`.
- **Fix:** The mount now passes the merged page's origin (`{ key: "strategies" }`); the fixture entry was hand-edited the way the file's own header prescribes (one class of hunk, `?from=my-strategies` to `?from=strategies`, 5 occurrences, no regeneration) and its key renamed `myStrategiesOwner` to `strategiesOwner`. A dated "NEXT SURGICAL EDIT" paragraph records it. The test still has no write or update path.
- **Files modified:** StrategyTable.default-mounts.test.tsx, strategy-table-default-mounts.json
- **Commit:** `fdfefe253`

**2. [Rule 1 - plan wording] `getRealPortfolio` null is not a read failure**
- The plan says "a null from either is a read failure". `getRealPortfolio` already THROWS on a read error (to `error.tsx`, as `/my-strategies` always did) and returns null only for "no portfolio row", which is a legitimate answer for a new allocator with keys. Only a null from `getStrategylessActiveKeys` is the failure that prints the line. `portfolioId` stays `portfolio?.id ?? null`.

**3. [Rule 2 - missing] `PLACEHOLDER_KEYS_UNREADABLE` copy constant**
- The UI-SPEC copy for a failed placeholder-key read had no home. It is exported from `comparison-note.ts` (a plan file) beside the other note copy. It is a `read_failure`-class line; plan 199-14's degrade-warning registry will need to register it so the scan sees it.

### Plan wording adjustments (no behavior change)

- The five page suites changed only by the two read mocks (`getOwnRowPercentiles`, `readPublicVerificationSignals`), as the plan allows.
- The wizard-draft companion read is skipped for allocator-only (not just the banner): a read thrown away is not made.
- A failed placeholder-key read on an account with nothing else renders the line and neither the empty state nor a table (the line is the whole degraded surface), mirroring `/my-strategies`'s WR-01 behavior.

## Known Stubs

None.

## Notes for downstream plans

- `liveShareIds` (the `strategy_shares` read for unpublished rows) still runs for allocator-only viewers although only manager actions read it. It is owner-scoped under RLS and harmless; not gated here (out of this plan's scope).
- Stale prose naming `MyStrategiesSection` remains in `StrategyTable.tsx` and `wizardErrors.ts` comments (noted by 199-09); worth a sweep in 199-13.
- Pnn is only visible once the table is sorted by a ranked metric (the merged page's default sort is `created_at`), exactly as UI-SPEC note 5 decides.

## Threat Flags

None. The new reads (`getStrategylessActiveKeys`, `getRealPortfolio`, `getOwnRowPercentiles` subjects) take the session user's id and nothing else (T-199-30); a null key read prints its failure line and never the empty state (T-199-25, neuter evidence above); parity pin 10 is unchanged and green.

## Self-Check: PASSED

- FOUND: src/app/(dashboard)/strategies/comparison-note.ts, StrategiesEmptyState.tsx, page.merged.test.tsx; my-strategies/MyStrategiesEmptyState.tsx absent (moved as declared).
- FOUND commits: bd2d1364c, 17709930c, 9f81127e0, fdfefe253, 4c7928a12 (ancestors of HEAD).

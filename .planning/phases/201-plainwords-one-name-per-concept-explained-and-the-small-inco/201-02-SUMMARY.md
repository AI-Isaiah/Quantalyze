---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 02
subsystem: strategy-name-resolution
tags: [d-09, d-17, discovery-visibility, name-resolver, security-boundary]
requires: []
provides:
  - isDiscoveryVisible (row form of withPublishedOrOwner)
  - displayStrategyName optional viewer argument (made required by plan 201-26)
  - browse route, My allocation payload and bridge outcome embeds decide the name by discovery visibility
affects: [201-07, 201-15, 201-24, 201-26]
tech-stack:
  added: []
  patterns:
    - "viewer-relative name rule: visible in discovery -> name, codename, Strategy #id; not visible -> codename, Strategy #id"
key-files:
  created:
    - src/app/(dashboard)/compare/CompareAddStrategy.real-name.test.tsx
  modified:
    - src/lib/visibility.ts
    - src/lib/visibility.test.ts
    - src/lib/strategy-display.ts
    - src/lib/strategy-display.test.ts
    - src/app/api/strategies/browse/route.ts
    - src/app/api/strategies/browse/route.test.ts
    - src/lib/queries.ts
    - src/lib/queries.my-allocation.test.ts
    - src/lib/queries.audit-2026-05-07.test.ts
    - src/__tests__/outcomes-join-rls.test.ts
decisions:
  - "D-26 rated, no checkpoint: a strategy not visible to the viewer never prints its name, institutional tier included (strictly more redaction than HEAD for an institutional row with no codename). Reversible."
  - "organization_name and redactedOrgName are untouched (T-201-04); pinned on every new My allocation fixture."
  - "codename stays on the browse wire (D-17: no API change); the three search surfaces keep matching it."
metrics:
  tasks: 3
  completed: 2026-11-11
status: complete
actuals:
  tokens: 60000
  tasks: 3
  commits: 2
plan_head_before: 8dbc36a02d92b8659c4807bd21ec248246a96756
plan_head_after: 77e41b950e2456e5f5753ac597c4232592e96a2c
---

# Phase 201 Plan 02: Real name wherever the viewer can see the strategy Summary

A strategy now reads under its real name wherever the viewer can see it in discovery (published, or the viewer's own row) and never anywhere else, on the four raw-row paths this plan owns: the resolver, the browse route behind compare's "Add strategy", the My allocation payload and the bridge outcome embeds. `isDiscoveryVisible` gives every path an explicit visibility fact, and each path has a RED proof.

## What was built

- `isDiscoveryVisible(row, viewerId)` in `src/lib/visibility.ts`: published, or `user_id` equals a non-empty viewer id. Fails closed: a missing `status`, a missing `user_id` or an empty viewer id reads as not visible. The module stays pure.
- `displayStrategyName(s, viewer?)`: with `{ visible: true }` the order is trimmed name, codename, `Strategy #<first 8 of id>`; with `{ visible: false }` it is codename, `Strategy #<id>` (never the name, institutional tier included). Without the argument it returns exactly what it returned at HEAD (marked transitional, removed by plan 201-26). The module docblock no longer claims the tear sheet, discovery or factsheet "do not need the guard".
- Browse route: `safeLabel` resolves through the viewer fact, so an own row still prints its real name and a non-visible row never does. `codename` stays on the wire. The C-0112 docblock is rewritten to the D-17 reading.
- My allocation: `status` and `user_id` join the `strategy:strategies!inner` embed, `redactedName` follows `isDiscoveryVisible`, both columns are dropped where `created_at` is dropped, `redactedOrgName` is untouched. The `MyAllocationDashboardPayload` `name` doc is updated.
- Bridge outcomes: both embedded strategy selects add `status, user_id`; `normalizeEmbed` resolves each name with the viewer fact (the viewer being `userId`) and still returns only `{ id, name }`.
- `CompareAddStrategy.real-name.test.tsx`: the TODOS `197-STRATEGY-NAME-PSEUDONYM-01` close-condition test, browse half. The browse route's real handler output (mocked supabase) feeds `CompareAddStrategy`; typing "Fib" finds "Fibonacci Ghost", "Ghost-7" still finds it, and a non-visible row's real name finds nothing while its codename does.

## RED proofs (neuter, see the named RED, restore from a byte backup, `cmp` exit 0)

Backups lived under the scratchpad `201-02/` directory; each restore was `cp -p` back followed by `cmp` (exit 0), then GREEN.

gc-201-02-neuter: gate=route.ts safeLabel visible:false for every row (CompareAddStrategy.real-name "finds a published exploratory strategy by its REAL name" + route T12a, T2, T4, T12c, T12f, T29-merge) result=red restored=identical
- Failing line: `npx vitest run src/app/api/strategies/browse "src/app/(dashboard)/compare/CompareAddStrategy.real-name.test.tsx"` printed `× finds a published exploratory strategy by its REAL name, and still by its codename` and `× T12a — a published exploratory row from another owner returns its REAL name`, 8 failed.

gc-201-02-neuter: gate=route.ts safeLabel visible:true for every row (route T12a-draft, T12b, T12d, T12f, T29-merge, T29-merge-control + CompareAddStrategy.real-name "never finds a strategy the viewer cannot see") result=red restored=identical
- Failing line: `AssertionError: expected 'Renaissance Medallion' to be 'Sigma-7'` and `AssertionError: expected 'Bridgewater Pure Alpha' to be 'Strategy #44444444'`, 7 failed.

gc-201-02-neuter: gate=queries.ts redactedName restored to the tier rule (`strategy.disclosure_tier === "institutional" ? strategy.name : null`) (queries.my-allocation "a published exploratory holding (not own) carries its REAL name", "a draft holding owned by the viewer carries its real name", audit-2026-05-07 P35 arm) result=red restored=identical
- Failing line: `AssertionError: expected null to be 'Fibonacci Ghost'`, 4 failed.

gc-201-02-neuter: gate=queries.ts normalizeEmbed visible:true unconditionally (queries.my-allocation "a draft replacement owned by someone else shows its codename, never its name", "a draft original ... not named either", audit-2026-05-07 "replacement_strategy.name is redacted for a strategy the viewer cannot see") result=red restored=identical
- Failing line: `AssertionError: expected 'Zeppelin Secret Book' to be 'Phantom-2'`, 3 failed.

Extra, beyond the four the plan names: gc-201-02-neuter: gate=queries.ts redactedName unconditional (`strategy.name`) (queries.my-allocation "a draft exploratory holding owned by someone else has name null", "an unpublished institutional holding owned by someone else is not named either", audit-2026-05-07 P35 arm) result=red restored=identical. Failing line: `AssertionError: expected 'Zeppelin Secret Book' to be null`, 3 failed. It proves the not-visible direction of the holding path, which neuter (a) alone does not (a tier-rule restore keeps a draft exploratory holding at null).

gc-201-02-gates: vitest=green eslint=clean tsc=clean

Details of the gates run: vitest on `src/lib/visibility.test.ts`, `src/lib/strategy-display.test.ts`, `src/app/api/strategies/browse`, `src/app/(dashboard)/compare`, `src/lib/queries.*`, `src/__tests__/outcomes-join-rls.test.ts`, `src/__tests__/public-truth-census.test.tsx` and `src/__tests__/figure-gate-census.test.ts` all green; `npx eslint` clean on every touched source and test file; `npm run typecheck` clean. A full `npx vitest run` ended with 1208 files passed and 2 failed tests, both in `src/lib/factsheet/compute.conventions.test.ts` (fixtures B and C, a last-digit float difference in an inline snapshot, `-0.11360716852722537` against `-0.11360716852722538`). That file imports only `./compute` and `./basis-metrics`, which this plan does not touch, so it is a pre-existing platform float failure outside this plan's scope (not fixed; surfaced here, not hidden).

codename-first-baseline: 3

(The count of the plan's codename-first grep at this plan's HEAD. Plan 201-26 drives it to 0 and plan 201-24 re-checks it: `CorrelationMatrix.tsx` twice and `RiskDecomposition.tsx` once.)

## Call-site visibility table (every non-test caller of the resolver and `publicNamePreview`)

| file | symbol | where its visibility fact comes from | moved by |
|---|---|---|---|
| `src/app/api/strategies/browse/route.ts` | `displayStrategyName` in the row projection | owner-inclusive query (`withPublishedOrOwner`) plus `isDiscoveryVisible(row, user.id)` | MOVED in this plan |
| `src/lib/queries.ts` | `normalizeEmbed` (bridge outcome embeds) | service-role read plus `isDiscoveryVisible` on each embed, viewer = `userId` | MOVED in this plan |
| `src/lib/queries.ts` | My allocation `redactedName` (not a resolver call; the name is redacted before the payload) | service-role read plus `isDiscoveryVisible(strategy, userId)` | MOVED in this plan |
| `src/lib/queries.ts` | flagged-candidate names (`displayStrategyName` in the candidate map) | published-only query (`withPublishedOnly`), every row visible | 201-26 |
| `src/app/factsheet/[id]/tearsheet/page.tsx` | `generateMetadata` name and page `displayName` | `getFactsheetDetail`, published-only (`withPublishedOnly`) | 201-07 |
| `src/app/factsheet/[id]/v2/page.tsx` | `publicNamePreview` for the `<title>` | by-id select on the public lane (published-only) or the owner lane (own row) | 201-07 |
| `src/app/factsheet/[id]/v2/page.tsx` | `pendingName` (`displayStrategyName` with `name: null`) | same signature read, public or owner lane | 201-07 |
| `src/lib/factsheet/fetch-and-build-payload.ts` | `factsheetName` | caller-supplied predicate: `withPublishedOnly` on the public lane, the owner's own row on the owner lane | 201-07 |
| `src/lib/strategy-display.ts` | `publicNamePreview` (`factsheet` and `discovery` legs) | the caller's row (edit page: owner's own row; factsheet title: as above) | 201-07 |
| `src/app/(dashboard)/strategies/[id]/edit/page.tsx` | `publicNamePreview(strategy)` | the owner's own row (`.eq("user_id", user.id)`) | 201-07 |
| `src/app/(dashboard)/allocations/lib/holdings-adapter.ts` | `displayStrategyName` in the holding row | payload already redacted upstream (My allocation `name` is null when not visible) | 201-26 |
| `src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts` | `displayStrategyName` (two call sites) | payload already redacted upstream (My allocation), plus the owner's own rows | 201-26 |
| `src/lib/allocation-helpers.ts` | `displayName` wrapper | payload already redacted upstream (My allocation) | 201-26 |
| `src/components/strategy/PendingIntros.tsx` | `displayStrategyName(r.strategies)` | the manager's own strategies (owner's own row) | 201-26 |
| `src/components/strategy/StrategyHeader.tsx` | `displayStrategyName(strategy)` | no importer found for the component (only itself and a comment in `Badge.tsx`); it takes whatever its caller passes | 201-26 |
| `src/components/admin/AdminTabs.tsx` | `displayStrategyName(strategy)` | admin-only viewer | 201-26 |
| `src/components/admin/SendIntroPanel.tsx` | `displayStrategyName(candidate.strategies)` | admin-only viewer | 201-26 |
| `src/components/admin/CandidateDetail.tsx` | `displayStrategyName(strategy)` | admin-only viewer | 201-26 |
| `src/components/admin/AllocatorMatchQueue.tsx` | `displayStrategyName` (three call sites) | admin-only viewer | 201-26 |
| `src/components/admin/match/ShortlistCard.tsx` | `displayStrategyName(candidate.strategies)` | admin-only viewer | 201-26 |

## name-chains (every codename hit, case-insensitive, 162 hits in 42 files at this plan's HEAD)

Produced by the plan's codename grep (read_first of Task 3), each hit read in context and classified. Kinds follow the plan's list, plus two I needed: "resolver call site, codename passed in" (a hit where a wrapper hands the codename to the resolver) and "comment, neutral" (a comment that neither states nor depends on the old rule). The plan's expected classification held for every row it named; the nine rows it did not name are in `name-chains-unexpected:` below.

| file | line | kind | owner plan | disposition |
|---|---|---|---|---|
| `app/factsheet/[id]/tearsheet/page.tsx` | 89 | comment describing the old codename-first rule | 201-07 | expected: attestation docblock, 201-07 rewrites that card |
| `app/factsheet/[id]/tearsheet/page.tsx` | 291 | prop or identifier a plan renames | 201-07 | expected: strategyCodename prop passed to ManagerIdentityPanel |
| `app/scenario-share/[token]/share-resolve.ts` | 283 | query select or type field | — | expected: no change (type field, schema field, literal or admin select) |
| `app/(marketing)/for-quants/page.tsx` | 49 | marketing copy describing the codename | 201-22 | expected: marketing page |
| `app/(marketing)/for-quants/page.tsx` | 102 | marketing copy describing the codename | 201-22 | expected: marketing page |
| `app/(marketing)/for-quants/page.tsx` | 158 | marketing copy describing the codename | 201-22 | expected: marketing page |
| `app/(marketing)/for-quants/page.tsx` | 256 | marketing copy describing the codename | 201-22 | expected: marketing page |
| `app/(marketing)/for-quants/page.tsx` | 266 | marketing copy describing the codename | 201-22 | expected: marketing page |
| `app/(marketing)/for-quants/page.tsx` | 285 | marketing copy describing the codename | 201-22 | expected: marketing page |
| `app/(marketing)/for-quants/page.tsx` | 321 | marketing copy describing the codename | 201-22 | expected: marketing page |
| `app/(marketing)/for-quants/page.tsx` | 322 | marketing copy describing the codename | 201-22 | expected: marketing page |
| `app/(marketing)/for-quants/page.tsx` | 325 | marketing copy describing the codename | 201-22 | expected: marketing page |
| `app/(marketing)/for-quants/page.tsx` | 326 | marketing copy describing the codename | 201-22 | expected: marketing page |
| `app/(marketing)/for-quants/page.tsx` | 351 | marketing copy describing the codename | 201-22 | expected: marketing page |
| `app/(marketing)/for-quants/page.tsx` | 352 | marketing copy describing the codename | 201-22 | expected: marketing page |
| `app/api/strategies/finalize-wizard/route.ts` | 514 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `app/api/strategies/create-with-key/route.ts` | 78 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `app/api/strategies/create-with-key/route.ts` | 79 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `app/api/strategies/create-with-key/route.ts` | 729 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `app/api/strategies/create-with-key/route.ts` | 1479 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `app/factsheet/[id]/v2/page.tsx` | 326 | query select or type field | — | expected: no change (select column) |
| `app/factsheet/[id]/v2/page.tsx` | 345 | inline name-first chain | 201-07 | expected: factsheet title chain input (publicNamePreview) |
| `app/factsheet/[id]/v2/page.tsx` | 423 | comment, neutral | — | expected: no change (comment on a select) |
| `app/factsheet/[id]/v2/page.tsx` | 440 | query select or type field | — | expected: no change (select column) |
| `app/factsheet/[id]/v2/page.tsx` | 556 | comment, neutral | — | expected: no change (comment on a select) |
| `app/factsheet/[id]/v2/page.tsx` | 568 | query select or type field | — | expected: no change (select column) |
| `app/factsheet/[id]/v2/page.tsx` | 749 | inline name-first chain | 201-07 | expected: pendingName chain |
| `app/factsheet/[id]/v2/page.tsx` | 753 | inline name-first chain | 201-07 | expected: pendingName chain |
| `app/api/strategies/composite/add-key/route.ts` | 128 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `app/api/strategies/composite/add-key/route.ts` | 129 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `app/api/strategies/composite/add-key/route.ts` | 512 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `app/api/strategies/browse/route.ts` | 45 | comment, neutral | — | docblock or comment written or kept in this plan (D-17 reading) |
| `app/api/strategies/browse/route.ts` | 46 | comment, neutral | — | docblock or comment written or kept in this plan (D-17 reading) |
| `app/api/strategies/browse/route.ts` | 51 | comment, neutral | — | docblock or comment written or kept in this plan (D-17 reading) |
| `app/api/strategies/browse/route.ts` | 60 | search match | — | codename kept on the wire for the three search surfaces (D-17) |
| `app/api/strategies/browse/route.ts` | 62 | query select or type field | — | expected: no change (codename stays on the wire, D-17) |
| `app/api/strategies/browse/route.ts` | 97 | comment, neutral | — | docblock or comment written or kept in this plan (D-17 reading) |
| `app/api/strategies/browse/route.ts` | 197 | comment, neutral | — | docblock or comment written or kept in this plan (D-17 reading) |
| `app/api/strategies/browse/route.ts` | 200 | query select or type field | — | expected: no change (codename stays on the wire, D-17) |
| `app/api/strategies/browse/route.ts` | 230 | comment, neutral | — | docblock or comment written or kept in this plan (D-17 reading) |
| `app/api/strategies/browse/route.ts` | 247 | query select or type field | — | expected: no change (codename stays on the wire, D-17) |
| `app/api/strategies/browse/route.ts` | 267 | query select or type field | — | expected: no change (codename stays on the wire, D-17) |
| `app/api/strategies/browse/route.ts` | 280 | query select or type field | — | expected: no change (codename stays on the wire, D-17) |
| `app/api/strategies/csv-finalize/route.ts` | 57 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `app/api/strategies/[id]/name/route.ts` | 93 | comment describing the old codename-first rule | 201-07 | expected: docblock says public surfaces render the codename |
| `app/api/strategies/[id]/name/route.ts` | 100 | comment, neutral | — | comment: the route writes name only (D-18); unchanged |
| `app/api/og/factsheet/[id]/route.tsx` | 96 | query select or type field | — | expected: no change (select or type field) |
| `app/api/og/factsheet/[id]/route.tsx` | 151 | query select or type field | — | expected: no change (select or type field) |
| `app/api/og/factsheet/[id]/route.tsx` | 174 | inline name-first chain | 201-07 | expected: OG route name (name ?? codename) |
| `(dashboard)/strategies/page.tsx` | 647 | query select or type field | — | expected: no change (type field, schema field, literal or admin select) |
| `(dashboard)/strategies/new/wizard/steps/ReviewStep.tsx` | 52 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `(dashboard)/strategies/new/wizard/steps/ReviewStep.tsx` | 169 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `(dashboard)/strategies/new/wizard/steps/MetadataStep.tsx` | 186 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `(dashboard)/strategies/new/wizard/steps/MetadataStep.tsx` | 249 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `(dashboard)/strategies/new/wizard/steps/MetadataStep.tsx` | 273 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `(dashboard)/strategies/new/wizard/steps/MetadataStep.tsx` | 299 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `(dashboard)/strategies/new/wizard/steps/MetadataStep.tsx` | 724 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `(dashboard)/strategies/new/wizard/steps/MetadataStep.tsx` | 902 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `(dashboard)/strategies/new/wizard/steps/MetadataStep.tsx` | 941 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `(dashboard)/strategies/new/wizard/steps/MetadataStep.tsx` | 949 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx` | 99 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx` | 118 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx` | 789 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `(dashboard)/admin/page.tsx` | 30 | query select or type field | — | expected: no change (type field, schema field, literal or admin select) |
| `(dashboard)/allocations/components/StrategyBrowseDrawer.tsx` | 72 | comment, neutral | — | comment on the pseudonymity of the codename; 201-15 re-reads it when it edits the file |
| `(dashboard)/allocations/components/StrategyBrowseDrawer.tsx` | 348 | search match | — | expected: kept by D-17 |
| `(dashboard)/allocations/components/StrategyBrowseDrawer.tsx` | 349 | search match | — | expected: kept by D-17 |
| `(dashboard)/allocations/components/StrategyBrowseDrawer.tsx` | 380 | comment, neutral | — | comment on the pseudonymity of the codename; 201-15 re-reads it when it edits the file |
| `(dashboard)/allocations/components/StrategyBrowseDrawer.tsx` | 518 | search match | — | expected: kept by D-17 |
| `(dashboard)/allocations/components/StrategyBrowseDrawer.tsx` | 690 | caption beside the displayed name | 201-15 | expected: codename line, U-12 shows it only when it differs; no order change |
| `(dashboard)/allocations/components/StrategyBrowseDrawer.tsx` | 691 | caption beside the displayed name | 201-15 | expected: codename line, U-12 shows it only when it differs; no order change |
| `(dashboard)/allocations/components/StrategyBrowseDrawer.tsx` | 695 | comment, neutral | — | comment on the pseudonymity of the codename; 201-15 re-reads it when it edits the file |
| `(dashboard)/allocations/components/HoldingsTable.tsx` | 320 | comment describing the old codename-first rule | 201-26 | expected: strategy-cell comment, corrected by 201-26 |
| `(dashboard)/allocations/components/AddAllocationFlow.tsx` | 346 | search match | — | expected: kept by D-17 |
| `(dashboard)/allocations/components/AddAllocationFlow.tsx` | 603 | search match | — | expected: kept by D-17 |
| `(dashboard)/allocations/components/AddAllocationFlow.tsx` | 803 | caption beside the displayed name | 201-15 | expected: caption, no order change |
| `(dashboard)/allocations/lib/watchlist-read.ts` | 31 | comment, neutral | none (census row: plan-15) | not on the expected list: comment about a select column (42703 history); no change |
| `(dashboard)/allocations/lib/scenario-adapter.ts` | 86 | query select or type field | — | expected: no change (type field, schema field, literal or admin select) |
| `(dashboard)/allocations/lib/scenario-adapter.ts` | 176 | query select or type field | — | expected: no change (type field, schema field, literal or admin select) |
| `(dashboard)/allocations/widgets/lib/widget-data.ts` | 49 | query select or type field | — | expected: no change (type field, schema field, literal or admin select) |
| `(dashboard)/allocations/widgets/risk/CorrelationMatrix.tsx` | 119 | codename-first name chain | 201-26 | expected: moves to the name-first chain |
| `(dashboard)/allocations/widgets/risk/CorrelationMatrix.tsx` | 137 | codename-first name chain | 201-26 | expected: moves to the name-first chain |
| `(dashboard)/allocations/widgets/risk/RiskDecomposition.tsx` | 108 | codename-first name chain | 201-26 | expected: moves to the name-first chain |
| `(dashboard)/compare/CompareAddStrategy.tsx` | 133 | search match | — | expected: kept by D-17 |
| `(dashboard)/allocations/lib/strategies-row-adapter.ts` | 26 | comment describing the old codename-first rule | 201-26 | comment describing the old alias, codename, synthetic rule; corrected by 201-26 which moves the adapter's call sites |
| `(dashboard)/allocations/lib/strategies-row-adapter.ts` | 56 | comment describing the old codename-first rule | 201-26 | comment describing the old alias, codename, synthetic rule; corrected by 201-26 which moves the adapter's call sites |
| `(dashboard)/allocations/lib/strategies-row-adapter.ts` | 215 | comment describing the old codename-first rule | 201-26 | comment describing the old alias, codename, synthetic rule; corrected by 201-26 which moves the adapter's call sites |
| `(dashboard)/allocations/lib/strategies-row-adapter.ts` | 222 | comment describing the old codename-first rule | 201-26 | comment describing the old alias, codename, synthetic rule; corrected by 201-26 which moves the adapter's call sites |
| `(dashboard)/allocations/lib/strategies-row-adapter.ts` | 226 | comment describing the old codename-first rule | 201-26 | comment describing the old alias, codename, synthetic rule; corrected by 201-26 which moves the adapter's call sites |
| `(dashboard)/allocations/lib/strategies-row-adapter.ts` | 233 | resolver call site, codename passed in | 201-26 | not on the expected list: adapter feeds the resolver (no viewer yet); 201-26 moves it |
| `(dashboard)/allocations/lib/strategies-row-adapter.ts` | 238 | comment describing the old codename-first rule | 201-26 | comment describing the old alias, codename, synthetic rule; corrected by 201-26 which moves the adapter's call sites |
| `(dashboard)/allocations/lib/strategies-row-adapter.ts` | 239 | manager slot | — | expected: manager slot, recorded, not changed (D-09 leaves manager names untouched) |
| `(dashboard)/allocations/lib/strategies-row-adapter.ts` | 276 | resolver call site, codename passed in | 201-26 | not on the expected list: adapter feeds the resolver (no viewer yet); 201-26 moves it |
| `(dashboard)/allocations/lib/strategies-row-adapter.ts` | 280 | manager slot | — | comment describing the manager slot (recorded, not changed) |
| `(dashboard)/allocations/lib/strategies-row-adapter.ts` | 281 | manager slot | — | comment describing the manager slot (recorded, not changed) |
| `(dashboard)/allocations/lib/strategies-row-adapter.ts` | 283 | manager slot | — | comment describing the manager slot (recorded, not changed) |
| `(dashboard)/allocations/lib/strategies-row-adapter.ts` | 285 | manager slot | — | comment describing the manager slot (recorded, not changed) |
| `(dashboard)/allocations/lib/strategies-row-adapter.ts` | 287 | manager slot | — | comment describing the manager slot (recorded, not changed) |
| `(dashboard)/allocations/lib/strategies-row-adapter.ts` | 288 | manager slot | — | comment describing the manager slot (recorded, not changed) |
| `(dashboard)/allocations/lib/strategies-row-adapter.ts` | 291 | manager slot | — | comment describing the manager slot (recorded, not changed) |
| `(dashboard)/allocations/lib/strategies-row-adapter.ts` | 292 | manager slot | — | expected: manager slot, recorded, not changed (D-09 leaves manager names untouched) |
| `(dashboard)/allocations/lib/holdings-adapter.ts` | 70 | comment describing the old codename-first rule | 201-26 | comment describing the old alias, codename, synthetic id rule; corrected by 201-26 |
| `(dashboard)/allocations/lib/holdings-adapter.ts` | 76 | query select or type field | — | type field |
| `(dashboard)/allocations/lib/holdings-adapter.ts` | 215 | comment describing the old codename-first rule | 201-26 | comment describing the old alias, codename, synthetic id rule; corrected by 201-26 |
| `(dashboard)/allocations/lib/holdings-adapter.ts` | 222 | resolver call site, codename passed in | 201-26 | not on the expected list: adapter feeds the resolver (no viewer yet); 201-26 moves it |
| `(dashboard)/allocations/lib/holdings-adapter.ts` | 226 | manager slot | — | expected: manager slot, recorded, not changed |
| `components/admin/AdminTabs.tsx` | 51 | query select or type field | — | expected: no change (type field, schema field, literal or admin select) |
| `components/admin/AllocatorMatchQueue.tsx` | 64 | query select or type field | — | expected: no change (type field, schema field, literal or admin select) |
| `components/admin/AllocatorMatchQueue.tsx` | 129 | query select or type field | — | expected: no change (type field, schema field, literal or admin select) |
| `components/strategy/StrategyNameBlock.tsx` | 14 | comment, neutral | none (census row: plan-18) | not on the expected list: comment stating the block never claims a codename hides the name; no change |
| `components/strategy/ManagerIdentityPanel.tsx` | 7 | prop or identifier a plan renames | 201-07 | expected: strategyCodename identifier |
| `components/strategy/ManagerIdentityPanel.tsx` | 39 | comment describing the old codename-first rule | 201-07 | comment on the exploratory variant, 201-07 rewrites the card |
| `components/strategy/ManagerIdentityPanel.tsx` | 48 | prop or identifier a plan renames | 201-07 | expected: strategyCodename identifier |
| `components/strategy/ManagerIdentityPanel.tsx` | 60 | prop or identifier a plan renames | 201-07 | expected: strategyCodename identifier |
| `components/strategy/ManagerIdentityPanel.tsx` | 75 | prop or identifier a plan renames | 201-07 | expected: strategyCodename identifier |
| `components/strategy/FactsheetPreview.tsx` | 29 | comment describing the old codename-first rule | 201-24 | expected: strategyName prop doc |
| `lib/queries.ts` | 1949 | query select or type field | — | expected: no change (type field, literal or select column) |
| `lib/queries.ts` | 2097 | query select or type field | — | expected: no change (type field, literal or select column) |
| `lib/queries.ts` | 2553 | query select or type field | — | expected: no change (type field, literal or select column) |
| `lib/queries.ts` | 2562 | comment, neutral | — | comment written in this plan (D-17 reading) |
| `lib/queries.ts` | 3470 | query select or type field | — | expected: no change (type field, literal or select column) |
| `lib/queries.ts` | 5162 | comment, neutral | — | comment written in this plan (D-17 reading) |
| `lib/queries.ts` | 5172 | query select or type field | — | expected: no change (type field, literal or select column) |
| `lib/queries.ts` | 5341 | comment, neutral | — | comment written in this plan (D-17 reading) |
| `lib/queries.ts` | 5361 | prop or identifier a plan renames | — | rawCodename: local variable in normalizeEmbed, not renamed (recorded) |
| `lib/queries.ts` | 5372 | resolver call site, codename passed in | — | moved by this plan: normalizeEmbed passes the viewer fact |
| `lib/queries.ts` | 5602 | comment describing the old codename-first rule | 201-26 | comment describing the old tier rule on the flagged-candidate read, corrected by 201-26 with that call site |
| `lib/queries.ts` | 5604 | comment describing the old codename-first rule | 201-26 | comment describing the old tier rule on the flagged-candidate read, corrected by 201-26 with that call site |
| `lib/queries.ts` | 5623 | comment describing the old codename-first rule | 201-26 | comment describing the old tier rule on the flagged-candidate read, corrected by 201-26 with that call site |
| `lib/queries.ts` | 5629 | query select or type field | — | expected: no change (type field, literal or select column) |
| `lib/queries.ts` | 5636 | query select or type field | — | expected: no change (type field, literal or select column) |
| `lib/queries.ts` | 5651 | resolver call site, codename passed in | 201-26 | expected: flagged-candidate call site moves in 201-26 (rows are published-only) |
| `lib/queries.ts` | 6004 | query select or type field | — | expected: no change (type field, literal or select column) |
| `lib/queries.ts` | 6322 | comment, neutral | — | comment written in this plan (D-17 reading) |
| `lib/allocation-helpers.ts` | 11 | comment describing the old codename-first rule | 201-26 | not on the expected list: comment describing the codename-wins rule of the wrapper |
| `lib/allocation-helpers.ts` | 12 | comment describing the old codename-first rule | 201-26 | not on the expected list: comment describing the codename-wins rule of the wrapper |
| `lib/allocation-helpers.ts` | 25 | resolver call site, codename passed in | 201-26 | not on the expected list: displayName wrapper feeds the resolver (no viewer yet); My allocation holdings still read codename-first until 201-26 moves it |
| `lib/allocation-helpers.ts` | 33 | resolver call site, codename passed in | 201-26 | not on the expected list: displayName wrapper feeds the resolver (no viewer yet); My allocation holdings still read codename-first until 201-26 moves it |
| `lib/scenario.ts` | 99 | query select or type field | — | expected: no change (type field, schema field, literal or admin select) |
| `lib/wizardErrors.ts` | 3189 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `lib/wizardErrors.ts` | 3191 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `lib/wizardErrors.ts` | 3193 | codename picker and its copy | — | expected: the codename picker and its copy (no change) |
| `lib/types.ts` | 192 | comment, neutral | — | comment on the type; no change |
| `lib/types.ts` | 194 | query select or type field | — | expected: no change (type field, schema field, literal or admin select) |
| `lib/types.ts` | 231 | comment, neutral | — | comment on the type; no change |
| `lib/email.ts` | 822 | comment describing the old codename-first rule | 201-22 | expected: notifyAllocatorOfIntroRequest docblock |
| `lib/constants.ts` | 308 | query select or type field | — | expected: no change (type field, schema field, literal or admin select) |
| `lib/strategy-display.ts` | 11 | the resolver itself | 201-02 (201-26 makes viewer required) | the resolver, D-17 orders written here |
| `lib/strategy-display.ts` | 12 | the resolver itself | 201-02 (201-26 makes viewer required) | the resolver, D-17 orders written here |
| `lib/strategy-display.ts` | 19 | the resolver itself | 201-02 (201-26 makes viewer required) | the resolver, D-17 orders written here |
| `lib/strategy-display.ts` | 26 | the resolver itself | 201-02 (201-26 makes viewer required) | the resolver, D-17 orders written here |
| `lib/strategy-display.ts` | 41 | the resolver itself | 201-02 (201-26 makes viewer required) | the resolver, D-17 orders written here |
| `lib/strategy-display.ts` | 42 | the resolver itself | 201-02 (201-26 makes viewer required) | the resolver, D-17 orders written here |
| `lib/strategy-display.ts` | 45 | the resolver itself | 201-02 (201-26 makes viewer required) | the resolver, D-17 orders written here |
| `lib/strategy-display.ts` | 56 | comment describing the old codename-first rule | 201-07 | comment on publicNamePreview, rewritten with the callers 201-07 moves |
| `lib/strategy-display.ts` | 58 | comment describing the old codename-first rule | 201-07 | comment on publicNamePreview, rewritten with the callers 201-07 moves |
| `lib/strategy-display.ts` | 71 | inline name-first chain | 201-07 | expected: publicNamePreview factsheet leg |
| `lib/factsheet/fetch-and-build-payload.ts` | 310 | query select or type field | — | expected: no change (select column) |
| `lib/factsheet/fetch-and-build-payload.ts` | 1001 | inline name-first chain | 201-07 | expected: factsheetName in the payload builder |
| `lib/factsheet/fetch-and-build-payload.ts` | 1007 | inline name-first chain | 201-07 | expected: factsheetName in the payload builder |
| `lib/admin/match.ts` | 130 | query select or type field | — | expected: no change (type field, schema field, literal or admin select) |
| `lib/admin/match.ts` | 179 | query select or type field | — | expected: no change (type field, schema field, literal or admin select) |

## name-chains-unexpected

Hits not on the planner's list, owned by the ownership rows of plan 201-06 and the name-chain owner stated in the plan ("201-26 for the rest"). Plan 201-24 resolves every one.

| file | line | kind | owner plan | reason |
|---|---|---|---|---|
| `(dashboard)/allocations/lib/watchlist-read.ts` | 31 | comment, neutral | none (census row: plan-15) | comment about a select column (42703 history); no change |
| `(dashboard)/allocations/lib/strategies-row-adapter.ts` | 233 | resolver call site, codename passed in | 201-26 | adapter feeds the resolver (no viewer yet); 201-26 moves it |
| `(dashboard)/allocations/lib/strategies-row-adapter.ts` | 276 | resolver call site, codename passed in | 201-26 | adapter feeds the resolver (no viewer yet); 201-26 moves it |
| `(dashboard)/allocations/lib/holdings-adapter.ts` | 222 | resolver call site, codename passed in | 201-26 | adapter feeds the resolver (no viewer yet); 201-26 moves it |
| `components/strategy/StrategyNameBlock.tsx` | 14 | comment, neutral | none (census row: plan-18) | comment stating the block never claims a codename hides the name; no change |
| `lib/allocation-helpers.ts` | 11 | comment describing the old codename-first rule | 201-26 | comment describing the codename-wins rule of the wrapper |
| `lib/allocation-helpers.ts` | 12 | comment describing the old codename-first rule | 201-26 | comment describing the codename-wins rule of the wrapper |
| `lib/allocation-helpers.ts` | 25 | resolver call site, codename passed in | 201-26 | displayName wrapper feeds the resolver (no viewer yet); My allocation holdings still read codename-first until 201-26 moves it |
| `lib/allocation-helpers.ts` | 33 | resolver call site, codename passed in | 201-26 | displayName wrapper feeds the resolver (no viewer yet); My allocation holdings still read codename-first until 201-26 moves it |

One of these matters for behaviour, not just copy: `displayName` in `src/lib/allocation-helpers.ts` is a no-viewer caller of the resolver, so a My allocation holding that is now visible and carries its real name in the payload still prints the codename first until plan 201-26 moves the wrapper (and the two adapters that call it). That is the planned sequencing (the viewer argument is optional here), recorded so 201-26 does not treat it as already done.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test re-read] Two `queries.audit-2026-05-07.test.ts` arms encoded the old tier rule**
- **Found during:** Task 2 (full queries test set after the change)
- **Issue:** "redacts strategy.name to null for non-institutional disclosure tier (P35)" and "outcomes payload: institutional tier still surfaces canonical name verbatim" (and the exploratory outcome arm's fixtures) asserted the tier rule. Plan Task 2 step 3 covers "any other test whose ... expectation changes", but the file is not in `files_modified`.
- **Fix:** Re-read the arms against the visibility rule: the exploratory fixtures became someone else's unpublished rows (`status: draft`, `user_id: other-owner`), a published exploratory arm was added, and the institutional outcome fixture gained `status: published`. The P35 intent (the canonical name never reaches the payload for a strategy the viewer cannot see) is kept and made stricter (institutional tier no longer exempts an unpublished row).
- **Files modified:** `src/lib/queries.audit-2026-05-07.test.ts`
- **Commit:** see Task 2 commit below

**2. [Rule 1 - Test fixtures] Route and My allocation fixtures gained `status` / `user_id`**
- **Found during:** Task 1 and Task 2 (RED run)
- **Issue:** Fixtures that omitted `status` and `user_id` now read as not visible (the guard fails closed), so T2, T3a, T4, T12c, T29-merge and the outcome fixture `P5_OUTCOME_O1` needed the facts to keep asserting what they assert.
- **Fix:** added the two columns to those fixtures; the fail-closed behaviour has its own arms (route T12d, `isDiscoveryVisible({}, ...)`).
- **Commit:** Task 1 and Task 2 commits

No Rule 4 stops. The plan's `files_modified` also lists `queries.match-batches-rls.regression-1.test.ts`; its mocked selects do not change with the two embeds and it passes untouched.

## Known limits and notes for the reviewer

- `src/__tests__/outcomes-join-rls.test.ts` is a live-DB test and SKIPS without a live database (no DB access was allowed here). I edited it (a draft-visibility seed comment and an assertion that allocator 2 never sees allocator 1's unpublished names, `strategies.status` defaults to `draft`), but that edit is UNRUN locally. The mocked equivalents in `queries.my-allocation.test.ts` carry the RED proofs.
- The browse route's third layer is now a per-row guard, but in production RLS and `withPublishedOrOwner` still keep a non-visible row out of the response; the draft arms model a dropped predicate.
- `organization_name` for an UNPUBLISHED institutional holding owned by someone else still reads the organization name (HEAD's tier rule, pinned by the test, per the plan: "Do not touch `redactedOrgName`"). The strategy name is now null there but the manager's organization is not. This is a pre-existing path (a `portfolio_strategies` row for such a strategy is not expected to exist) and is outside this plan's scope; flagging it for the phase report in case D-17's "manager identity stays pseudonymous" should also follow visibility.
- The marketing copy in `for-quants/page.tsx` ("sees the codename, never your firm name", "Listed under codename") describes the pre-D-09 world for a published strategy; owner 201-22 per the plan.
- D-09 itself is rated one-way in CONTEXT; the TODOS reading is that the name is already public on anonymous `/browse`. This plan only narrows the redaction to the discovery predicate (D-17), it does not remove it.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change; two existing service-role selects gained `status` and `user_id`, both stripped before the payload (T-201-02), and `organization_name` is unchanged (T-201-04).

## Commits

- `89a013201` Task 1 (tracer): a published strategy reads under its real name in compare's Add strategy.
- `77e41b950` Task 2: My allocation and bridge outcomes name a strategy only when the viewer can see it.
- Task 3 changed no source file (the visibility table, the name-chain sweep and the gates are this SUMMARY; its resolver-order arms landed with Task 1). The SUMMARY commit follows these two; the frontmatter `commits` measures the code commits from the ledger up to `plan_head_after`.

## Self-Check

Self-Check: PASSED. Every created or modified source and test file listed in the frontmatter exists in the worktree; commits `89a013201` and `77e41b950` are ancestors of HEAD on `wt/201-p02`; STATE.md and ROADMAP.md are unmodified; no CI skip token and no attribution trailer appears in any commit message.

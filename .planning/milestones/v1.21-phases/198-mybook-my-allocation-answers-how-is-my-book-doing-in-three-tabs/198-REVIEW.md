---
phase: 198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs
reviewed: 2026-11-08T22:06:22Z
reviewed_at_sha: c9490870f8c3e879be5fa98b67ac4e9fbcc04f33
depth: standard
files_reviewed: 77
files_reviewed_list:
  - .github/workflows/ci.yml
  - e2e/allocations-add.spec.ts
  - e2e/no-clip-sweep.spec.ts
  - e2e/reflow-sweep-authed.spec.ts
  - e2e/wizard-resume.spec.ts
  - src/__tests__/display-sign-single-source.test.ts
  - src/__tests__/e2e-seeded-hydration-guard.test.ts
  - src/__tests__/holding-scope-key-census.test.ts
  - src/app/(dashboard)/allocations/AllocationDashboardV2.failing-key.test.tsx
  - src/app/(dashboard)/allocations/AllocationDashboardV2.ready-empty-book.test.tsx
  - src/app/(dashboard)/allocations/AllocationDashboardV2.rebuilding.test.tsx
  - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
  - src/app/(dashboard)/allocations/AllocationDashboardV2.warmup.test.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.add-param.test.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.addalloc.test.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.connect-key-predicate.test.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.onboarding.test.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.scenario-state-preservation.test.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.test.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.tsx
  - src/app/(dashboard)/allocations/HoldingsTabPanel.dust.test.tsx
  - src/app/(dashboard)/allocations/HoldingsTabPanel.exposure-agreement.test.tsx
  - src/app/(dashboard)/allocations/HoldingsTabPanel.exposure.test.tsx
  - src/app/(dashboard)/allocations/HoldingsTabPanel.flagged-rows.test.tsx
  - src/app/(dashboard)/allocations/HoldingsTabPanel.key-read-notes.test.tsx
  - src/app/(dashboard)/allocations/HoldingsTabPanel.positions-header.test.tsx
  - src/app/(dashboard)/allocations/HoldingsTabPanel.positions-once.test.tsx
  - src/app/(dashboard)/allocations/HoldingsTabPanel.test.tsx
  - src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
  - src/app/(dashboard)/allocations/MandateTabPanel.test.tsx
  - src/app/(dashboard)/allocations/MandateTabPanel.tsx
  - src/app/(dashboard)/allocations/OverviewRisk.history-parity.test.tsx
  - src/app/(dashboard)/allocations/RiskTabPanel.book-series.test.tsx
  - src/app/(dashboard)/allocations/RiskTabPanel.tsx
  - src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.tsx
  - src/app/(dashboard)/allocations/components/AddAllocationFlow.test.tsx
  - src/app/(dashboard)/allocations/components/AddAllocationFlow.tsx
  - src/app/(dashboard)/allocations/components/AllocateDialog.tsx
  - src/app/(dashboard)/allocations/components/EquityHistoryRebuilding.tsx
  - src/app/(dashboard)/allocations/components/GlancePanel.scenario-parity.test.tsx
  - src/app/(dashboard)/allocations/components/GlancePanel.test.tsx
  - src/app/(dashboard)/allocations/components/GlancePanel.tsx
  - src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx
  - src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx
  - src/app/(dashboard)/allocations/components/HoldingsTable.tsx
  - src/app/(dashboard)/allocations/components/KpiStrip.tsx
  - src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx
  - src/app/(dashboard)/allocations/components/MissingDataMessage.tsx
  - src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx
  - src/app/(dashboard)/allocations/components/PositionsTables.flagged.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.d11.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/lib/add-allocation.test.ts
  - src/app/(dashboard)/allocations/lib/add-allocation.ts
  - src/app/(dashboard)/allocations/lib/book-figures.test.ts
  - src/app/(dashboard)/allocations/lib/book-figures.ts
  - src/app/(dashboard)/allocations/lib/dust.test.ts
  - src/app/(dashboard)/allocations/lib/dust.ts
  - src/app/(dashboard)/allocations/lib/exposure-snapshot.test.ts
  - src/app/(dashboard)/allocations/lib/exposure-snapshot.ts
  - src/app/(dashboard)/allocations/lib/flagged-position-map.test.ts
  - src/app/(dashboard)/allocations/lib/flagged-position-map.ts
  - src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts
  - src/app/(dashboard)/allocations/lib/key-data-gaps.ts
  - src/app/(dashboard)/allocations/widgets/positions/ExposureByClass.test.tsx
  - src/app/(dashboard)/allocations/widgets/positions/ExposureByClass.tsx
  - src/lib/bridge-outcome-schema.ts
  - src/lib/closed-sets.cash-symbols.test.ts
  - src/lib/closed-sets.ts
  - src/lib/portfolio-exposure.test.ts
  - src/lib/portfolio-exposure.ts
  - src/lib/queries.my-allocation.test.ts
  - src/lib/queries.test.ts
  - src/lib/queries.ts
findings:
  critical: 1
  warning: 4
  info: 0
  total: 5
status: issues_found
---

# Phase 198: Code Review Report

**Reviewed:** 2026-11-08T22:06:22Z, at `c9490870f` (branch `feat/198-mybook`)
**Depth:** standard. The write path was traced across modules into the two routes and the `commit_scenario_batch` RPC.
**Files Reviewed:** 77, scope `git diff origin/main...HEAD -- . ':!.planning'`
**Status:** issues_found

## Summary

Scope: the three-tab shell and its legacy aliases, the glance panel and the shared
`book-figures` module, the cash set and the exposure changes, the dust rule, the flag-to-row
map, the per-key missing-data producer and its message, the add-allocation flow (both routes,
the idempotency key, the refusals, `?add=`), the e2e specs and the CI line.

Per the brief, only MEDIUM, HIGH and CRITICAL findings are reported. Necessity was not
assessed: it is outside the brief, so `necessity:` is left out of the frontmatter.

These hold up. Cash is out of exposure: one `isCashHolding` feeds the snapshot and the net
series, and `cashUsd` is null rather than 0 when no cash row was read. `CASH_SYMBOLS` matches
the Python `STABLECOINS` literal member for member. The dust rule uses strict comparisons and
never hides an unpriced or untrusted row. Neither table's totals move with the toggle: the
derivatives footer still sums every row, and the untrusted-key footer survives the all-dust
branch. The Positions header and the glance read one `bookEquityUsd`. A failing-key exit's
`day` is the last counted day (allocator_equity_compose.py), so `tailRange` correctly starts
the day after it. The commit body sends no fingerprint, the key matches the route's
`IDEMPOTENCY_KEY_RE`, and Retry reuses the key. The `?add=` strip builds from the live
`window.location.search`, so `?tab=risk&add=<id>` does not get `tab` back.

The one HIGH: the new seeded e2e queries the search box by the wrong ARIA role, so it cannot
pass. It is also the only browser proof of the D-07 contract that Phase 196 depends on.

**The three known open items, judged:**

- **The own-strategy 409 does not refresh:** a real MEDIUM, and wider than a race (WR-01).
- **A shared-account group with a disconnected-but-last-healthy key yields no gap entry:** not
  a finding. `missingDataLines` (MissingDataMessage.tsx:336-343) prints the reason's own
  `NeedsActionLine` whenever no `shared_account_failing` line printed. The book is still told
  what is wrong; only the key names are missing. It errs toward naming nobody, which the
  founder rule allows. Below MEDIUM.
- **The all-dust derivatives table shows its hidden-count line as a tbody row:** not a finding.
  A single `colSpan={7}` cell inside the table's own `<tbody>` is valid table markup, and it
  keeps the footer total and the key-trust notes on screen (T-198-20). That is the right trade.
  Below MEDIUM.

## Critical Issues

### CR-01 (HIGH): the seeded e2e looks for a `textbox`, but the search box is a `searchbox`, so CI goes red

**File:** `e2e/allocations-add.spec.ts:107-109` (component: `src/app/(dashboard)/allocations/components/AddAllocationFlow.tsx:518-520`)
**Issue:** The search input is `<input type="search">`, whose implicit ARIA role is `searchbox`.
The spec asserts:

```ts
await expect(
  dialog.getByRole("textbox", { name: "Search strategies" }),
).toBeFocused();
```

Playwright 1.64.1 matches roles exactly. Its `queryRole` does
`if (getAriaRole(element) !== options.role) return;`, and its implicit-role table returns
`type === "search" ? "searchbox" : "textbox"`. Both were read in
`node_modules/playwright-core/lib/coreBundle.js`. The locator therefore matches nothing, and
the assertion times out. The unit tests use the right role
(`AddAllocationFlow.test.tsx:118`, `getByRole("searchbox", …)`), which is why nothing local
caught this. 198-08's summary says the seeded e2e was never run locally.
**Why it matters:** CI and the phase goal, not end users. `allocations-add.spec.ts` was just
added to the `e2e-seeded` batch (`ci.yml:7049`), so the job goes red on the first PR run. The
test's later steps never run: axe on step 1, focus returning to the header button, and the
check that a reload does not reopen the flow. That is the only real-browser proof of D-07,
which Phase 196 links to.
**Fix:**

```ts
dialog.getByRole("searchbox", { name: "Search strategies" }),
```

## Warnings

### WR-01 (MEDIUM): your own strategy is routed by who owns it, not by its capital mark, and a 409 leaves stale state and false copy

**Files:** `src/app/(dashboard)/allocations/lib/add-allocation.ts:97-104`, `src/app/(dashboard)/allocations/components/AddAllocationFlow.tsx:360-364`
**Issue:** `buildAllocationRequest` sends every `isOwn === true` row to
`/api/portfolio-strategies/allocation`. On the browse wire, `isOwn` means
`strategies.user_id === session` (`api/strategies/browse/route.ts:264`), not
`capital_ownership === own_capital`. The route refuses with 409 `not_allocatable` whenever the
mark is not own capital (`allocation/route.ts:263-266`). So every unmarked, team-capital or
client-capital strategy the allocator manages shows up in the picker with a `Yours` chip, can
be picked, takes an amount, and is then refused every time. This is not only the mark-flip
race. Per the founder's shared-keys rule, a manager who is also an allocator will hit it on
their own published strategies.

On that 409 the flow renders `ALLOCATION_NOT_ALLOCATABLE`, whose third remedy reads: "Close
this dialog to see the strategy's current state — the list reloads with the mark as it stands
now." (`src/lib/wizardErrors.ts:4294`). In this flow nothing reloads. `onRecorded` alone calls
`router.refresh()` (`AllocationsTabs.tsx:582-597`), and closing does not. `AllocateDialog`
does refresh on a 409 (`AllocateDialog.tsx:256-262`), so the same envelope keeps its promise
there and breaks it here.
**Why it matters:** user-facing. A picker row that can never succeed, followed by advice that
is false.
**Fix (minimal):** refresh on the own-route 409, as `AllocateDialog` does. For example, give
the flow an `onStale` prop and have the host bind it to the same guarded `router.refresh()`:

```ts
if (!req.idempotent) {
  if (res.ok) return null;
  const body = await res.json().catch(() => null);
  if (res.status === 409) onStale?.();   // host: router.refresh(), like AllocateDialog
  return envelopeForResponse(res, correlationId, body);
}
```

The dead-end row itself needs the capital mark on the browse wire, or a client join to
`ownCapitalStrategies`, which the page already reads. Book that separately if it is out of
scope here.

### WR-02 (MEDIUM): with every key stale, the share line is hidden, but the write still stores a percent built from that stale Book equity

**Files:** `src/app/(dashboard)/allocations/lib/add-allocation.ts:106-138`, `src/app/(dashboard)/allocations/components/AddAllocationFlow.tsx:384-389, 422-430`
**Issue:** The share line is suppressed under `allKeysStale` (UI-SPEC OQ-2, "no guess").
`submit()` still calls `buildAllocationRequest` with the same `bookEquityUsd` and posts
`percent_allocated = amount / bookEquityUsd * 100`. The RPC persists that percent as
`bridge_outcomes.percent_allocated`. `size_at_decision_usd` is validated but not stored
(migration `20261027120000…sql`, voluntary_add branch). The stored share of book is therefore
built from the very figure the UI declined to show as untrustworthy.
**Why it matters:** data integrity. The percent is the only size the Outcomes record keeps.
**Fix:** refuse the third-party branch when the book is stale, as when Book equity is
unusable:

```ts
// buildAllocationRequest args gain `allKeysStale: boolean`
if (allKeysStale || bookEquityUsd === null || !Number.isFinite(bookEquityUsd) || bookEquityUsd <= 0) {
  return { ok: false, field: "amount", message: BOOK_EQUITY_UNAVAILABLE_MESSAGE };
}
```

Pass `allKeysStale` from both call sites (`amountProblem` and `submit`).

### WR-03 (MEDIUM): the "not in the list we loaded" notice says "Search for it below", but search only filters the loaded list

**File:** `src/app/(dashboard)/allocations/components/AddAllocationFlow.tsx:89-90` (notice), `:295-306` (filter)
**Issue:** When `?add=<id>` is missing from a truncated browse read (`has_more: true`, the
route's alphabetical cap of 200), the flow prints "That strategy is not in the list we
loaded. Search for it below." The search is a client-side `rows.filter(...)` over the same
200 loaded rows. A strategy past the cap can never appear, however the user searches. The
same holds for anyone browsing the picker from the header button.
**Why it matters:** user-facing, and latent. The browse route says the catalog is "well under
the cap today". Once it is not, the Phase 196 "Add to my allocation" link (D-07) will send
users to a dead end with an instruction that cannot work.
**Fix (minimal):** make the copy true. For example: "That strategy is past the first 200 we
list here, so it cannot be added from this list yet." Keep `unlisted_truncated` reported. A
server-side lookup by id is the real fix, and it needs its own plan (no new endpoint was
allowed here).

### WR-04 (MEDIUM): with no eligible key, the retired Mandate tab's content is nowhere on the page, and `?tab=mandate` lands with no `#mandate`

**File:** `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx:219-233` (early return), `:357-370` (Mandate section)
**Issue:** The Mandate section sits below the `gate === "no_eligible_key"` early return, so an
allocator with no eligible key sees only the connect card. Before this phase the Mandate tab
rendered for everyone. Now an allocator who set a mandate but has no key cannot see the
mandate snapshot anywhere on `/allocations`. `MandateQuickSetCard` shows only while the
mandate is not set. A legacy `?tab=mandate` link still rewrites the URL and arms the anchor
scroll, then finds no `#mandate` and gives up without a word. D-02 says "nothing is deleted
silently".
**Why it matters:** user-facing. The content is still reachable at `/profile?tab=mandate`, so
nothing is lost, only moved out of view for this state.
**Fix (minimal):** render the same Mandate section in the early-return branch too:

```tsx
if (gate === "no_eligible_key") {
  return (
    <div data-ui-v2-shell="true">
      <EmptyState hasSyncing={false} hasConnectedKeys={false} />
      <section id="mandate" aria-labelledby="overview-mandate-heading" className="mt-8">
        <h2 id="overview-mandate-heading" className="mb-3 text-sm font-semibold uppercase tracking-wider text-text-primary">Mandate</h2>
        <MandateTabPanel {...props} />
      </section>
    </div>
  );
}
```

---

_Reviewed: 2026-11-08T22:06:22Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Fix round 1A (add-allocation write path)

Fixer: Claude (gsd-code-fixer), topic A. Each fix is one commit and each new test was shown RED
by neutering the fix and restoring from a byte backup. WR-04 belongs to topic B and is untouched.

| Finding | Status | Commit |
|---|---|---|
| CR-01 (HIGH) e2e `textbox` vs `searchbox` | fixed. `allocations-add.spec.ts` now asks for `searchbox`; `playwright test --list` parses it. The seeded run itself was not executed locally. | c2fe3a1c6 |
| WR-02 stale Book equity percent | fixed. `buildAllocationRequest` takes `allKeysStale` and refuses the third-party branch with the Book-equity refusal; the own branch is unaffected. | 77adc14ed |
| WR-03 / SFH-2 "Search for it below" | fixed (copy only, no fetch). The notice now reads "That strategy is past the first 200 we list here, so it cannot be added from this list yet." `unlisted_truncated` is still reported and the `?add=` contract is unchanged. | 7a848f992 |
| WR-01 own-route 409 does not refresh | fixed. The panel calls `router.refresh()` on an own-route 409, as `AllocateDialog` does. Marked: logic fix, requires human verification. | 1fcfd82e2 |
| SFH-1 every non-429 commit failure was INDETERMINATE | fixed. 400 and 422 give `DASHBOARD_REQUEST_INVALID`, 401 and 403 give `DASHBOARD_SIGNED_OUT` (both "nothing saved", no Retry). 409, 5xx, any other non-OK status and a network failure give `UNKNOWN` with Retry on the SAME Idempotency-Key. INDETERMINATE stays for a 200 that is unparseable or does not prove one recorded row. The network catch now `console.error`s. Marked: logic fix, requires human verification. | 66411c18c |
| SFH-5 held set capped at 200 and null-join blind | fixed. `getMyAllocationDashboard` reads the distinct `strategy_id` of `kind = 'allocated'` outcomes through the same admin client and `.eq("allocator_id", userId)` gate, with no `.limit`, into `heldOutcomeStrategyIds` (optional on the payload type). `heldStrategyIdsFrom` unions it with the existing sources. No migration, route or RLS change. Marked: requires human verification. | a2585f248 |

Residual limits, recorded rather than fixed:
- SFH-5 relies on PostgREST's own `max-rows` ceiling rather than paging, so "uncapped" means no cap of ours.
- A 403 from the commit route (non-allocator or unprovisioned profile) reuses the "You are signed out" copy, the nearest existing nothing-saved envelope; a dedicated envelope would be new copy.
- WR-01's dead-end picker row (an own-by-owner strategy that is not marked own capital) is still offered; the review said to book that separately.

Gates: `npx tsc --noEmit` clean; `npm run lint` 0 errors (2 pre-existing warnings in factsheet files);
vitest `src/app/(dashboard)/allocations` plus `src/lib/queries.my-allocation.test.ts`: 183 files, 3409 tests pass.

## Fix round 1B (figures and Overview)

Fixer: Claude (gsd-code-fixer), topic B. Each fix is one commit and each new test was shown RED
by neutering the fix and restoring from a byte backup.

| Finding | Status | Commit |
|---|---|---|
| WR-04 no eligible key hides the Mandate | fixed. The no-eligible-key branch renders the same `#mandate` section under the connect card. The three history-parity assertions that pinned "the connect card replaces the Mandate" now pin the opposite. | d56d7e23f |
| SFH-3 Book equity $0 when no row reports | fixed. `bookEquityUsd` returns null when no row reported a contribution, so the glance prints a dash. A reported zero stays zero. Callers checked: Glance and Holdings header (`formatUsd` renders null as a dash), the dust test (`isDust` already takes null), and `add-allocation` (already refuses null). | 4d4c9a576 |
| SFH-4 attributed key silently omitted | fixed. A key a rebuild reason attributed (not syncing, shared account failing) with an empty or malformed tail now ships a null-range entry. A ready-book failing exit with a valid empty tail still emits nothing (that key has no gap). The cause fallback is suppressed only when every gap of the cause printed a named line. Marked: logic fix, requires human verification. | 6db76a0c6 |

Residual limit, recorded rather than fixed: when the fallback prints beside named key lines (one key
unlabelled), the fallback names no key it cannot label, so a labelled key can be mentioned by its
own line and by the generic "Some of your keys" sentence.

Gates: `npx tsc --noEmit` clean; `npm run lint` 0 errors; vitest `src/app/(dashboard)/allocations`,
`src/lib/queries*`, contracts-registry, display-sign-single-source, figure-gate-census: 208 files, 3822 tests pass.

## Round 2 (re-review of fix rounds 1A and 1B)

**Reviewed:** 2026-11-08T22:26:16Z, at `0d3b34594` (branch `feat/198-mybook`)
**Reviewer:** Claude (gsd-code-reviewer), standard depth, MEDIUM+ only.
**Scope:** `git diff 8921e0149..HEAD -- . ':!.planning'`, plus the phase diff wherever a fix
touches it. I traced the commit route (`api/allocator/scenario/commit/route.ts`), the
`withAllocatorAuth` statuses, the `commit_scenario_batch` outcome inserts, the Overview poll
(`AllocationsTabs.tsx`) and the `keyDataGaps` producer (`queries.ts`).

**Fixes that close their finding with no regression:** CR-01, WR-02, WR-03, WR-04, SFH-3 and
SFH-5. SFH-1 is closed for every status except the case in R2-01. WR-01 and SFH-4 are not
closed (R2-02 and R2-03).

**The brief's specific questions, judged:**

- **SFH-5 ignores `.error`: rejected.** `heldOutcomesRes` goes through
  `assertOk(heldOutcomesRes, "bridge_outcomes")` (`src/lib/queries.ts:6290`), which logs and
  throws on any `.error` (`queries.ts:5845-5859`). A failed read fails the page loudly. It
  cannot produce an empty held set. The `.data ?? []` at `:6258` runs first, but its result is
  never returned once the assert throws.
- **SFH-5 and PostgREST `max-rows`: real, but below MEDIUM.** `max_rows = 1000`
  (`supabase/config.toml:18`). The read is one row per `allocated` outcome, has no `.order`,
  and is truncated silently with a 200. It only bites above 1000 allocated outcomes for one
  allocator. That is 5x the old 200-row cap, and the round-1A residual already records it.
- **SFH-1, a retry after a write that may have landed: safe only when the body is
  byte-identical.** The route binds the key to a SHA-256 of the raw body (`route.ts:430`). A
  same-body retry is a cached replay or a 409 in-flight, so 409 and 5xx do not record twice.
  But the flow rebuilds the body on Retry from the live Book equity, so the bytes can change.
  See R2-01.
- **SFH-4, a labelled key named both on its own line and in the generic sentence: below
  MEDIUM.** `resolveNotSyncingKeys` returns null when any id is unlabelled, so the fallback
  reads "One of your keys is not syncing", which stays true. It says one fact twice. It does
  not say anything false and does not leave out a key. The real SFH-4 defect is R2-03.
- **WR-01, an own strategy not marked own capital is still offered: still MEDIUM and still
  open.** See R2-02.
- Below MEDIUM, noted and not booked here:
  - A 503 `idempotency_schema_drift` maps to `UNKNOWN` with Retry on the same key. The route
    says to use a fresh key, so Retry fails the same way every time. This is a rare SRE state.
  - A 403 shows "You are signed out" (already recorded as a residual).
  - A 422 full failure says "the fault is in our software", even when the cause is a row-level
    refusal.

### R2-01 (MEDIUM, data integrity): Retry rebuilds the body under the same key, so a write that landed can come back as "Nothing was saved … make the change again"

**Files:** `src/app/(dashboard)/allocations/components/AddAllocationFlow.tsx:349-350, 380-381, 404-411, 701`;
`src/app/(dashboard)/allocations/lib/add-allocation.ts:137`; `src/app/(dashboard)/allocations/AllocationsTabs.tsx:520-533`;
`src/app/api/allocator/scenario/commit/route.ts:430, 659-667`
**Defect:**
1. Retry calls `submit()` (`:701`), which rebuilds the request from the current
   `bookEquityUsd` prop (`:404-411`). It sends that request under the kept Idempotency-Key
   (`:349-350`). The key is dropped only when the strategy, amount or date changes
   (`:323, :662, :687`).
2. `percent_allocated = amount / bookEquityUsd * 100` (`add-allocation.ts:137`).
   `bookEquityUsd` is recomputed on every `router.refresh()`, and the Overview runs that every
   30 s while the flow is open (`AllocationsTabs.tsx:520-533`). So after a failure where the
   write may have landed (a network drop after send, a 5xx or a 504 after the RPC committed),
   a Retry 30 s later carries different bytes under the same key.
3. If the first write committed, the route answers 422 `idempotency_body_mismatch`
   (`route.ts:659-667`). A 422 can only mean that here: with no cached row, the new body would
   simply commit. SFH-1 now maps every 422 to `DASHBOARD_REQUEST_INVALID` (`:380-381`). Its
   copy reads "Nothing was saved and nothing was changed", and its remedy says "Reload the page
   and make the change again" (`wizardErrors.ts:4349-4356`). Both are false here.
4. `onRecorded` is not called and the held set is not consulted on resubmit. The held check
   lives only in `choose()`, at `:315`. If the allocator then edits the amount (which drops
   the key) and submits, a second `allocated` outcome is recorded. The RPC has no per-strategy
   uniqueness.

Before SFH-1, every non-429 failure here was `DASHBOARD_WRITE_INDETERMINATE`, which was true.
**User-facing / data-integrity:** both. The copy is false, and it can lead to a duplicate
allocated outcome.
**Minimal fix:** bind the body to the key. Store the request body with the key the first time
the key is generated, and re-send that stored body on Retry. The amount, date and strategy
handlers already drop both together. As a backstop, map a 422 whose `error` is the route's
body-mismatch sentence to `DASHBOARD_WRITE_INDETERMINATE`, not `DASHBOARD_REQUEST_INVALID`.

### R2-02 (MEDIUM, user-facing): WR-01 is not closed; the 409 refresh changes nothing the user can see, and the dead-end row is still offered and not booked

**Files:** `src/app/(dashboard)/allocations/components/AddAllocationFlow.tsx:366-369, 612, 767`;
`src/app/(dashboard)/allocations/lib/add-allocation.ts:101-108`; `src/lib/wizardErrors.ts:4294`;
`src/app/(dashboard)/allocations/AllocationsTabs.tsx:378`
**Defect:**
1. `router.refresh()` refreshes the SSR props. The picker's rows come from the flow's own
   `fetchStrategies` read, and that read is not re-run.
2. The browse wire still sets `isOwn` by owner, not by the capital mark. So after the refresh,
   and after closing and reopening, the same unmarked own strategy is offered again with a
   `Yours` chip and is refused again.
3. The envelope's third remedy is still false in this host. It reads "Close this dialog to see
   the strategy's current state — the list reloads with the mark as it stands now." Nothing on
   `/allocations` shows the mark.
4. Round 1 asked for the dead-end row to be booked if it was deferred. It is recorded only as
   a residual in this file. `TODOS.md` has no entry for it.

Every manager who is also an allocator hits this on each of their own strategies that is not
marked own capital.
**User-facing / data-integrity:** user-facing.
**Minimal fix:** `AllocationsTabs` already receives `ownCapitalStrategies` (`:378`). Pass its
id set to the flow. Render an `isOwn` row that is not in the set as unavailable, the same way
a held row is shown, with a caption pointing to My Strategies. Then the 409 can occur only on
a real mark flip after the page loaded, and the refresh makes the reopened list true.

### R2-03 (MEDIUM, user-facing): SFH-4 names an attributed key whose history reaches yesterday as "no complete history yet"

**Files:** `src/app/(dashboard)/allocations/lib/key-data-gaps.ts:204-209, 227, 255`;
`src/app/(dashboard)/allocations/components/MissingDataMessage.tsx:163-169, 316-324`
**Defect:**
1. With `keepWhenEmpty`, a valid but empty tail now ships `{ firstMissingDay: null, ranges:
   null }` (`key-data-gaps.ts:205-209`). That is the same shape as a key with no history at
   all.
2. `coverage()` renders that shape as "no complete history yet" (`MissingDataMessage.tsx:169`).
3. An empty tail means the key's `csv_daily_returns` already reach yesterday, so its history
   is complete through the reference day. This is the usual shape the day a key first stops
   syncing.
4. The named line also counts as printed. If it is the only `not_syncing` gap, the true
   fallback "One of your keys, X, is not syncing" is suppressed (`:316-324`). The book then
   gets one false sentence in place of one true one.

The same holds for a `shared_account_failing` group whose latest day is yesterday (`:255`).
The new test pins the false copy: `MissingDataMessage.test.tsx` asserts
`${L3}: no complete history yet.` for this shape, and `key-data-gaps.test.ts` produces it from
`K2: YESTERDAY`. A malformed day keeping the null-range form is correct.
**User-facing / data-integrity:** user-facing. The line states a false fact about the user's
data.
**Minimal fix:** for a valid empty tail with `keepWhenEmpty`, push
`firstMissingDay: nextUtcDay(tail.lastDay)` with `ranges: null`. `coverage()` then prints the
true "no data since {day}". Keep the null-range form only for the null-day and malformed-day
cases. Then correct the SFH-4 test to expect that line.

**Round 2 verdict:** 3 MEDIUM (R2-01 data integrity and user-facing; R2-02 and R2-03
user-facing). No HIGH or CRITICAL.

_Reviewed: 2026-11-08T22:26:16Z · Reviewer: Claude (gsd-code-reviewer) · Depth: standard_

## Fix round 2

**Fixed:** 2026-11-09 on `feat/198-mybook`. Each fix has a test seen RED with the fix neutered and restored from a byte backup.

- **R2-01 fixed (`9577744f4`).** `AddAllocationFlow` stores the exact request body with the Idempotency-Key and Retry re-sends that body; both clear together on edit, as before. A 422 whose `error` is the route's "reuse with different body" sentence maps to `DASHBOARD_WRITE_INDETERMINATE`; the rolled-back 422 (`recorded: 0, errors[]`) stays "nothing saved". The own-allocation route takes no key and is unaffected.
- **R2-02 fixed (`e179a9c2f`).** `AllocationsTabs` passes the id set of `ownCapitalStrategies` to the flow. An own row outside it renders `aria-disabled`, not selectable, with "Not marked as your own capital. Mark it on My Strategies first." The set is withheld when `strategiesReadFailed`, so a read blip never disables every own row. Residual: a `?add=` deep link to an unmarked own strategy still prefills step 2 and meets the 409.
- **R2-03 fixed (`645eddc59`).** A valid empty tail emits no entry for every cause (the orchestrator's choice over `nextUtcDay`), so the true "is not syncing" fallback prints. A malformed reference day emits nothing. A null or malformed last day keeps the null-range entry. `keepWhenEmpty` is removed. The producer test that pinned the false wording now asserts no entry, with new cases for a shared-account group and a malformed reference day.

Gates: `npx tsc --noEmit` clean; `npm run lint` 0 errors; vitest `src/app/(dashboard)/allocations`, `src/lib/queries*`, contracts-registry, display-sign-single-source, figure-gate-census: 208 files, 3828 tests pass.

## Round 3 (final re-review of fix round 2)

**Reviewed:** 2026-11-08T22:36:34Z, at `506ae63a7` (branch `feat/198-mybook`)
**Reviewer:** Claude (gsd-code-reviewer), standard depth, MEDIUM+ only.
**Scope:** `git diff 0cc83ac4d..HEAD -- . ':!.planning'` (commits `9577744f4`, `e179a9c2f`,
`645eddc59`). I traced the commit route's 422 arms (`api/allocator/scenario/commit/route.ts:656-748`),
the own-allocation route's 409 (`api/portfolio-strategies/allocation/route.ts:237-268`), the browse
read (`api/strategies/browse/route.ts`, `withPublishedOrOwner`), `getOwnCapitalStrategies`
(`src/lib/queries.ts:2902-2932`) and `missingDataLines` (`MissingDataMessage.tsx:300-362`). I ran
`keyDataGaps` directly with `tsx` to confirm R3-01.

**Closure of the round 2 findings:**

- **R2-01: closed.** The key and the exact body are minted together (`AddAllocationFlow.tsx:373-376`),
  Retry sends the stored body (`:384`), and every edit path clears both (`:347, :471, :698, :723`).
  A same-key Retry is now byte-identical, so the route answers with a cached 200 or a 409 in flight,
  never with a body mismatch. The 422 backstop matches the route's literal `error` (`route.ts:663`).
  A rolled-back 422 has no `error` key and still falls through to "nothing saved", which is true.
  Reading the body at `:404` is safe, because no later branch reads it again.
- **R2-02: closed for unmarked own strategies.** The set comes from `ownCapitalStrategies`. It is
  withheld when either strategies read failed (`AllocationsTabs.tsx:642-648`), so a read blip
  disables nothing. It refreshes with the 30 s SSR poll. One new defect: R3-02.
- **R2-03: the false "no complete history yet" line is gone.** But dropping the entry reopens the
  original SFH-4 defect, a key the rebuild reason attributes being left out silently, whenever a
  second key of the same cause prints a named line. See R3-01.

**The residual, judged: a `?add=` deep link to an unmarked own strategy is below MEDIUM.** Nothing
in `src/` produces `?add=` today. `AllocationsTabs.tsx:610` is the only reader, and the comment
there names Phase 196's factsheet as the future producer. Nothing is written: the own route's
pre-check refuses with a 409 (`allocation/route.ts:263-268`), and the 409 envelope names the cause.
After closing and reopening the dialog, the row shows its true caption. Before Phase 196 links an
owner's own factsheet here, `resolveDeepLink` should take the same `notOwnCapital` test. Hand that
to 196 as a carry note, not a finding here.

Below MEDIUM, noted and not booked: Retry runs `buildAllocationRequest` against the LIVE Book
equity (`:442-448`). So if a 30 s refresh drops equity below the amount, or turns `allKeysStale`
on, the stored-body Retry is refused with an amount error. The indeterminate envelope stays on
screen next to it. Nothing false is sent.

### R3-01 (MEDIUM, user-facing): an attributed key whose history reaches yesterday disappears when another key of its cause prints a line

**Files:** `src/app/(dashboard)/allocations/lib/key-data-gaps.ts:206`;
`src/app/(dashboard)/allocations/components/MissingDataMessage.tsx:319-324, 344-350`
**Defect:**
1. For a valid empty tail, `push` now returns with no entry (`key-data-gaps.ts:206`).
2. `missingDataLines` suppresses the cause's fallback when every gap of that cause printed a named
   line (`MissingDataMessage.tsx:319-324`). It counts gaps, not the keys the reason attributed.
3. Take `key_not_syncing` with `notSyncingKeyIds: [K1, K2]`, `K1` last day `2026-11-01` and `K2`
   last day yesterday. The producer returns only K1 (measured:
   `[{"apiKeyIds":["K1"],"cause":"not_syncing","firstMissingDay":"2026-11-02",…}]`). K1's line
   prints, `causesPrinted` gets `not_syncing`, and `NotSyncingLine`, the only line that would name
   K2, is suppressed.
4. The book is rebuilding partly because of K2. Nothing on the page says so. Fix K1 and the book
   still rebuilds, with no stated reason. This is the shape of the day a second key stops syncing.
   `shared_account_failing` does the same for a fully failing group whose latest day is yesterday,
   alongside a group with a gap.

This is the original SFH-4 defect ("attributed key silently omitted"). The fix round-2 docstring
promises "no affected key is dropped" (`MissingDataMessage.tsx:298-299`), and this case breaks
that promise.
**User-facing / data-integrity:** user-facing. A key the server attributes as a cause is left out.
**Minimal fix:** keep the producer as it is, since an empty tail really has no gap. Suppress the
fallback by covered key ids instead of by gap count. For `key_not_syncing`, suppress
`NotSyncingLine` only when `notSyncingKeys` is non-null and every one of its ids is in a printed
gap's `apiKeyIds`. Otherwise print it. For `shared_account_no_working_key`, suppress only when no
attributed group was dropped. One way is for `keyDataGaps` to also return the causes it dropped
for an empty tail, so the consumer can test that. Add a test for the K1-gap plus K2-empty-tail
case that asserts the not-syncing fallback still prints.

### R3-02 (MEDIUM, user-facing): an archived own-capital strategy is disabled as "Not marked as your own capital"

**Files:** `src/app/(dashboard)/allocations/components/AddAllocationFlow.tsx:330-336, 822-826`;
`src/app/(dashboard)/allocations/AllocationsTabs.tsx:642-648`; `src/lib/queries.ts:2931-2932`;
`src/app/api/strategies/browse/route.ts:173-195`
**Defect:**
1. The set is built from `getOwnCapitalStrategies`, which filters `.neq("status", "archived")`
   (`queries.ts:2932`).
2. The picker's rows come from the browse read, `withPublishedOrOwner`
   (`status.eq.published,user_id.eq.<me>`). That read returns the owner's archived rows, carrying
   `isOwn: true` and `status`.
3. So an archived strategy that IS marked own capital is not in the set. `notOwnCapital` returns
   true, the row is `aria-disabled`, and its caption reads "Not marked as your own capital. Mark it
   on My Strategies first." Both sentences are false: it is marked, and marking it again changes
   nothing.
4. The own-allocation route checks `capital_ownership` only (`allocation/route.ts:263`), not
   status. So before `e179a9c2f` this row could be allocated. The fix turned a working path into a
   blocked one with a false reason.

**User-facing / data-integrity:** user-facing. It is a false statement about the user's own data,
which the founder rule forbids.
**Minimal fix:** make the test match the route's own refusal. Either build the id set from a read
without the archived filter, or exempt the case the set cannot decide: in `notOwnCapital`, return
false when `row.status === "archived"`, and the route's 409 stays the gate for an unmarked
archived row. Add a test where an archived, marked own row stays selectable.

**Round 3 verdict:** R2-01 closed. R2-02 closed for its own case. R2-03 closed for the false
sentence. 2 new MEDIUM, both user-facing (R3-01 reopens SFH-4, R3-02 is a regression in the R2-02
fix). No HIGH or CRITICAL. The `?add=` residual is below MEDIUM.

_Reviewed: 2026-11-08T22:36:34Z · Reviewer: Claude (gsd-code-reviewer) · Depth: standard_

## Fix round 3

**Fixed:** 2026-11-09 (gsd-code-fixer). Both tests were seen RED with the fix neutered and restored from a byte backup (cp + cmp). `npx tsc --noEmit` clean, `npm run lint` 0 errors, vitest for `allocations` plus the contracts-registry, display-sign-single-source and figure-gate-census files: 184 files, 3205 tests green.

- **R3-01: fixed, `1ad4aeed4`.** `missingDataLines` keeps the not-syncing fallback unless every key in `notSyncingKeys` is in a printed not-syncing gap. When `notSyncingKeys` is null the gaps still decide, because there is nothing to compare and an existing test pins a single printed line there. R2-03 is unchanged: K2 gets the fallback sentence and no "no complete history yet" line. Limit: `shared_account_failing` is not covered. The reason carries no attributed group, so the consumer cannot test it, and the review's producer change (return the dropped causes) was not made.
- **R3-02: fixed, `d23d74eaf`.** `notOwnCapital` returns false for `status === "archived"` rows, and the route's 409 stays the gate for an unmarked archived strategy. Test: an archived own row absent from the set stays selectable and carries no caption.

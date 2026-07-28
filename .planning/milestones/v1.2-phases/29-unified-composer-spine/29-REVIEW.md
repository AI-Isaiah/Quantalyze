---
phase: 29-unified-composer-spine
reviewed: 2026-06-23T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/app/api/strategies/[id]/returns/route.ts
  - src/app/api/strategies/browse/route.ts
  - src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx
  - src/app/(dashboard)/allocations/components/SavedScenariosList.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/__tests__/phase-29-frozen-spine-guards.test.ts
findings:
  critical: 0
  warning: 5
  info: 4
  total: 9
status: issues_found
---

# Phase 29: Code Review Report

**Reviewed:** 2026-06-23
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Phase 29 (Unified Composer Spine) wires a unified browse-add → lazy-fetch →
frozen-engine projection path into the own-book composer, plus a copy-relabel of
the saved-scenarios list to "portfolio" and an `is_example` provenance tag on the
browse catalog. I reviewed the new lazy-returns route, the browse-route catalog
merge, the drawer, the saved-list, the composer wiring, and the frozen-spine
guard test at standard depth, with an adversarial focus on the security-critical
items the prompt called out.

The **security spine holds up well.** The lazy-returns route uses the RLS-scoped
`createClient()` (no admin client imported — confirmed by grep + the R8 test),
validates the `[id]` param before burning a token or hitting the DB, returns a
404 (not 403) on the published-existence probe to avoid an existence oracle, and
redacts the raw Postgres error. The browse-route `is_example` merge does NOT
widen the leak surface: `withPublishedOnly` still gates the set, `displayStrategyName`
still suppresses the raw name on example rows (pinned by a non-vacuous T29-merge
control), and the response is an explicit allow-list (no `...row` spread). The
honesty invariants (no peer/percentile/signature panels on the blend; no
fabricated series on a lazy-fetch failure; PROJECTED pill) are intact and pinned
by non-vacuous tests. The three frozen-spine exit gates (no scenarios migration,
zero-diff `scenario.ts`, byte-unchanged RLS sql) are real git-delta inspections
and currently pass.

No BLOCKERs. The findings below are correctness/robustness defects in the
lazy-fetch lifecycle (a transient network failure permanently poisons a
strategy's series for the session; stale state and an un-aborted fetch survive a
remove), one share-route data-loss footgun in the relabeled saved-list, and a
handful of quality issues. The lazy-fetch poisoning (WR-01) is the most
consequential — it silently defeats the entire point of UNIFY-04 for any user who
hits a flaky network on first add.

## Warnings

### WR-01: A failed lazy returns-fetch permanently poisons the strategy's series for the session (no retry on re-add)

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:579-631`, `:976-985`, `:953`

**Issue:** When the lazy returns-fetch fails (network error, abort-with-`cancelled=false`,
non-ok response, non-array body) `settle([])` writes `addedReturnsById[id] = []`.
That entry is never cleared. The add seam guards re-fetch with:

```ts
if (!strategyById.has(s.id) && addedReturnsById[s.id] === undefined) {
  fetchAddedReturns(s.id);
}
```

After a failed fetch, `addedReturnsById[id]` is `[]` (an array, not `undefined`),
so a subsequent remove + re-add of the SAME strategy will NOT re-fetch — it reuses
the poisoned empty `[]`. The lookup memo at line 953 then resolves
`fromBook ?? addedReturnsById[a.id] ?? []` → `[]`, so the strategy is warm-up-gated
out of the projection forever (for that session) with no affordance to retry. This
silently defeats UNIFY-04's whole purpose (a catalog-added strategy must move the
projection) for any allocator who hits a transient failure on first add. The
honest-degrade test (`T_C_LAZY2`) only proves the FIRST add degrades to `[]`; it
never re-adds, so the poisoning is uncaught.

**Fix:** Distinguish "fetched empty (real)" from "fetch failed". Either (a) on a
genuine failure leave `addedReturnsById[id]` `undefined` (do not call `settle([])`
on the error path — only clear the loading flag + abort ref), so a re-add retries;
or (b) clean up `addedReturnsById`/`loadingReturnsIds`/`lazyAbortRef` for the id
inside `removeAddedStrategy`'s wiring so re-add starts clean. Option (a) is the
root-cause fix:

```ts
.catch((err: unknown) => {
  if (controller.signal.aborted) { lazyAbortRef.current.delete(id); return; }
  console.warn(/* … */);
  // Do NOT settle([]) — leave the entry undefined so a re-add retries.
  setLoadingReturnsIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  lazyAbortRef.current.delete(id);
});
```

Add a regression test that adds → fails → removes → re-adds and asserts a second
fetch fires.

### WR-02: Removing an added strategy mid-flight leaves an un-aborted fetch and orphaned state

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1980` (`onRemoveAdded={scenario.removeAddedStrategy}`), lifecycle at `:457-468`, `:633-640`

**Issue:** `scenario.removeAddedStrategy` only mutates the draft. It does NOT touch
`addedReturnsById`, `loadingReturnsIds`, or `lazyAbortRef`. If a strategy is removed
while its lazy fetch is still in flight, the `AbortController` for that id is never
aborted (only unmount aborts — `:634-640`), so the request runs to completion and
`settle()` writes into `addedReturnsById`/`loadingReturnsIds` for a strategy no longer
in the draft. Consequences: (1) a wasted in-flight request that can't be cancelled,
(2) `addedReturnsById` accumulates entries for removed ids across a multi-add session
(unbounded for the session), and (3) the stale `[]` entry feeds directly into WR-01's
poisoning on re-add. The `loadingReturnsAddedNames` message correctly drops the removed
id (it intersects with current `addedStrategies`), so the user-facing copy stays honest —
but the underlying state leak and the missing abort are real.

**Fix:** Wrap `removeAddedStrategy` in a composer-level handler that also aborts and
purges the id's lazy-fetch bookkeeping:

```ts
const handleRemoveAdded = useCallback((id: string) => {
  scenario.removeAddedStrategy(id);
  lazyAbortRef.current.get(id)?.abort();
  lazyAbortRef.current.delete(id);
  setLoadingReturnsIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  setAddedReturnsById((prev) => { const { [id]: _drop, ...rest } = prev; return rest; });
}, [scenario.removeAddedStrategy]);
```

### WR-03: "Copy link" silently revokes the recipient's existing share link on every copy

**File:** `src/app/(dashboard)/allocations/components/SavedScenariosList.tsx:249-259`, `:209-247`

**Issue:** `copyExistingShare` re-invokes `generateShare`, which POSTs to
`/api/allocator/scenario/share`. The code comment states this route "pre-revokes the
prior active share and mints a new one." So a user clicking **Copy link** on an
already-shared portfolio — expecting to re-copy the SAME URL to clipboard — instead
mints a NEW token and invalidates the old one. Any recipient already holding the
previous link loses access the moment the owner clicks "Copy link" (a button whose
label implies an idempotent read, not a mutation). This is a data-access-loss footgun:
the gesture's name ("Copy link") does not communicate that it rotates the token. It is
distinct from the explicit, confirmed **Revoke** flow, which at least warns "Anyone with
the link will lose access." There is no equivalent warning on the Copy path.

This is inherited from Plan 25-03, but Phase 29's UNIFY-05 relabel ("portfolio") and the
claim that "Share affordance … is byte-identical" means the reviewer must flag it as part
of the surface under review — the relabel re-presents this control to users under new copy
without addressing the footgun.

**Fix:** Either (a) make "Copy link" copy the EXISTING link without rotating (requires the
list/route to expose a re-copyable URL, or a dedicated non-rotating fetch), or (b) rename
the control to communicate rotation (e.g. "Regenerate & copy") and surface the same
"anyone with the old link loses access" disclosure the Revoke path uses. Root-cause fix is
(a); (b) is the honest-labeling stopgap.

### WR-04: `timestampLabel` and `openSavedScenario` JSON-roundtrip can misorder / corrupt on malformed timestamps & non-JSON-safe drafts

**File:** `src/app/(dashboard)/allocations/components/SavedScenariosList.tsx:89-102`; `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:702-704`

**Issue (two related defects):**

1. `timestampLabel` calls `new Date(row.created_at)` / `new Date(row.updated_at)` and
   compares `.getTime()`. If either column is a malformed/empty string, `getTime()` returns
   `NaN`; `NaN > NaN` is `false`, so it silently falls through to `Saved <Invalid Date>` —
   `fmt(d)` on an invalid Date yields the string "Invalid Date" in the row. No guard. A bad
   timestamp from the DB renders "Saved Invalid Date" to the user rather than a fallback.

2. `openSavedScenario` decodes via `scenarioDraftCodec(...).decode(JSON.stringify(row.draft))`.
   `row.draft` is `unknown` arriving from the saved-scenarios list. `JSON.stringify` of a
   value containing `undefined`, a function, or a `BigInt` will drop keys or throw
   (`BigInt` → TypeError) — and `JSON.stringify(undefined)` returns the JS value `undefined`,
   which `JSON.parse` inside the codec will then throw on, hitting the `reset` path. For the
   normal DB-JSONB case this is fine (the row is already JSON), but the `unknown` type and the
   stringify→parse roundtrip is a fragile re-serialization of data that was already a parsed
   object; a non-JSON-safe value silently degrades to the "older format" reset notice rather
   than a clear error.

**Fix:** (1) Guard `timestampLabel` against invalid dates:
`const u = updated.getTime(); const c = created.getTime(); if (!Number.isFinite(c)) return "Saved";`
then branch on finiteness. (2) The codec already takes a `raw: string | null`; pass the row's
draft more defensively — wrap the `JSON.stringify` in a try/catch that routes a stringify
failure to the same honest `reset` notice rather than letting a `BigInt` TypeError escape, or
have the codec accept an already-parsed object on this path.

### WR-05: `as` casts at the `payload` and adapter boundaries can mask a real shape regression

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:361-363`, `:386-389`, `:1034-1041`, `:951`

**Issue:** The composer applies several runtime-unchecked casts at trust boundaries:
- `payload as MyAllocationDashboardPayload & { existingOutcomesByHoldingRef?: … }` (`:361`)
- `holdingsSummary` recast via `as typeof rawHoldingsSummary` after the `entryMode` switch (`:389`),
  then re-cast to a structural literal on the `useScenarioState` call (`:392`)
- `addedStrategyReturnsLookup as Record<StrategyForBuilderId, DailyPoint[]>` and the metadata
  lookup cast at the adapter call (`:1034-1041`)
- `raw as unknown as DailyPoint[]` for the book series (`:951`) — the comment acknowledges the
  upstream type is actually a year-keyed nested record, not `DailyPoint[]`.

These are individually defended by `Array.isArray` guards or fallbacks in most spots, but the
`raw as unknown as DailyPoint[]` at `:951` is the dangerous one: it asserts a `DailyPoint[]`
shape onto a value the code's own comment says is "often" `DailyPoint[]` but is typed as a
nested record. If the book path ever surfaces the year-keyed record shape, `Array.isArray(raw)`
is false → `null` → falls through to the lazy series or `[]`, so the warm-up gate saves it from
crashing — but it would silently drop a book strategy's real returns rather than fail loud. Per
CLAUDE.md Rule 12 (fail loud) and Rule 8 (read before you write), a double `as unknown as` cast
across a known type mismatch is a latent correctness hole.

**Fix:** Either narrow the upstream `StrategyAnalytics.daily_returns` type so the runtime shape
matches the consumed `DailyPoint[]`, or add a typed normalizer that explicitly handles BOTH the
array form and the year-keyed-record form (rather than `Array.isArray` + silent drop), with a
`console.warn` on the unexpected shape so a regression is observable.

## Info

### IN-01: Comment/code drift — route header references "saved/[id]/route.ts:142-147" and "withAllocatorAuth.ts:54-61" line numbers that rot

**File:** `src/app/api/strategies/[id]/returns/route.ts:38-42`

**Issue:** The header doc cites specific line ranges in other files (`withAllocatorAuth.ts:54-61`,
`saved/[id]/route.ts:142-147`, the Next docs `route.md:80-103`). Line-number citations drift the
moment those files change and become actively misleading. The behavioral claim (the wrapper passes
`(req, user)` only) is correct and verified against `withAllocatorAuth.ts`, but pin it by name/symbol,
not line number.

**Fix:** Replace line-range citations with symbol references (e.g. "see `withAllocatorAuth`'s handler
invocation").

### IN-02: `STRATEGY_BROWSE_LIMIT + 1` truncation signal is computed but never surfaced to the user

**File:** `src/app/api/strategies/browse/route.ts:79-83`, `:172-173`; `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx`

**Issue:** The browse route honestly computes `has_more` and returns `limit`, but the drawer
(`StrategyBrowseDrawer.tsx`) reads only `json.strategies` (`:173-174`) and never consumes `has_more`.
The route's own comment acknowledges this ("the drawer does not yet surface `has_more` … deferred UX
follow-up"). With the Phase 29 catalog merge ADDING example rows into the same 200-cap response, the
catalog is now closer to the cap than the verified-only catalog was, so silent truncation is more
likely than when the cap was designed. This is a known/documented gap, not a regression, but worth
re-noting now that the merge increases the row count.

**Fix:** Wire a one-line "Showing first 200 — refine your filter" notice in the drawer when
`has_more` is true. Tracked as the deferred follow-up; flagging so it isn't lost behind the merge.

### IN-03: Indentation inconsistency in the browse-route SELECT comment block

**File:** `src/app/api/strategies/browse/route.ts:114-118`

**Issue:** The comment block at `:114-118` is indented with a stray leading space (the lines under
`// Audit C-0112` are indented one column further than the surrounding `// ` comments), a cosmetic
artifact of an edit. Purely stylistic; no behavioral impact.

**Fix:** Re-align the comment block to the surrounding two-space comment indentation.

### IN-04: `_pendingMode` / `setPendingMode` — the value is intentionally unread, but the lint-suppression pattern is fragile

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:403-405`, `:662-665`

**Issue:** `_pendingMode` is declared but only the setter is used; the value is read solely inside
`handleReset`'s functional updater (`setPendingMode((pending) => …)`). The underscore-prefix + comment
documents the intent well, and the dirty-draft-mode-switch flow is correctly pinned non-vacuously by
`T_C_MODE3` (the mode does NOT flip until confirm). This is correct as written — flagging only that
relying on an unread state value whose sole reader is a setter callback is a pattern that a future
refactor could accidentally break without a test catching the "parked mode applied on the wrong
confirm" case. The `T_C_MODE3` test does cover the happy path; consider also asserting that a
footer-Reset (not a mode switch) after a parked mode does NOT silently apply the parked mode (the
`onCancel` path at `:2068-2071` clears it, but there's no test pinning that a plain footer-Reset with
no parked mode is unaffected).

**Fix:** No code change required. Optionally add a regression test for the "parked mode abandoned on
Cancel" path to harden the Pitfall-5 guard.

---

_Reviewed: 2026-06-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

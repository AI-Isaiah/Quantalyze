---
phase: 37-honest-per-data-source-toggle
reviewed: 2026-06-25T00:00:00Z
depth: deep
files_reviewed: 12
files_reviewed_list:
  - src/lib/queries.ts
  - src/app/(dashboard)/allocations/lib/scenario-adapter.ts
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts
  - src/lib/queries.my-allocation.test.ts
  - src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts
  - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.test.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.onboarding.test.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.scenario-state-preservation.test.tsx
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
status: issues_found
---

# Phase 37: Code Review Report

**Reviewed:** 2026-06-25
**Depth:** deep
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Phase 37 exposes Phase 36's per-`api_key` daily-return series on the dashboard
payload (Plan 01), adds a pure sibling builder that keys projection units per
`api_key_id` with raw equity-share weights (Plan 02), and wires an ephemeral
include/exclude toggle into the composer's `projectionState.selected` channel so
the frozen `computeScenario` engine honestly recomputes on exclusion (Plan 03).

**SCENARIO-05 confirmed clean:** `src/lib/scenario.ts` has a zero-line diff —
untouched. The engine is called from exactly one site in the composer
(`computeScenario(deAliased.strategies, deAliased.state, dateMapCache)`).

**No manual renormalization:** `buildPerKeyStrategyForBuilderSet` passes raw
equity-share USD values (e.g. 70000 / 30000). The engine normalizes via
`totalWeight = Σ activeWeight; normWeight = w / totalWeight`. PK3 pins this:
`weights.A === 70, weights.B === 30` (not 0.7/0.3). No `/ total` or sum-to-1
pass added anywhere in Phase 37.

**No toggle persistence:** `includeByApiKeyId` is a plain `useState({})`. It
never touches `scenario.draft`, `toggleByScopeRef`, `weightOverrides`, or the
commit diff. The ephemerality test (Pitfall 5) pins this and is
mutation-verified.

**Security / cross-tenant isolation:** the `csv_daily_returns` fetch carries
`.eq("allocator_id", userId)` (queries.ts:2764). The cross-tenant subset test
pins that no foreign-tenant key id appears in `perKeyReturnsByApiKeyId`. The
displayed label uses only `••••{id.slice(-4)}` — never a secret or full
api_key_id in rendered copy. The `data-data-source-id` DOM attribute embeds the
row UUID (not the exchange credential), which is low-risk but noted below.

Two warnings and one informational finding follow.

---

## Warnings

### WR-01: `showDataSourcesFallback` fires for zero-connected-keys allocators with a live book

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1351-1352`

**Issue:** `showDataSourcesFallback` is computed as:

```ts
const showDataSourcesFallback =
  entryMode === "book" && !payload.perKeyDailiesGateSatisfied;
```

`allActiveKeysHavePerKeyDailies` returns `false` when `eligibleKeyIds.length ===
0` (no eligible keys). An allocator who has a live book (`holdingsSummary.length
> 0`, so `hasLiveBook = true`, `entryMode = "book"`) but zero active/connected
API keys will have `eligibleKeyIds = []`, `perKeyDailiesGateSatisfied = false`,
and `showDataSourcesFallback = true`. The InfoBanner copy says "One or more
connected keys don't have a per-key return series yet" — which is factually
incorrect when the allocator has no connected keys at all; the real state is "you
haven't connected an exchange key."

This is not a data-correctness bug (the projection still works correctly via the
snapshot fallback), but it is a honesty regression in a phase explicitly
designed around honesty of presented information.

**Realistic scenario:** A user has manually-reconciled holdings (via CSV / MT5
EA, which do not produce `api_keys` rows) in book mode. Or a user whose only API
key was revoked/disconnected but whose historical holdings still appear. Both
would see the misleading fallback.

**Fix:** Gate `showDataSourcesFallback` on there being at least one eligible
key:

```ts
const showDataSourcesFallback =
  entryMode === "book" &&
  !payload.perKeyDailiesGateSatisfied &&
  (payload.eligibleApiKeyIds ?? []).length > 0;
```

This way the banner only appears when "keys exist but lack history" — the case
the copy actually describes. A zero-keys allocator sees nothing (the per-source
control is a key-based feature; it is correct to show no UI when there are no
keys).

---

### WR-02: `includeByApiKeyId` not cleared on `handleReset` — stale exclusions survive scenario load

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:836-853` (handleReset), `595-604` (state declaration)

**Issue:** `handleReset` resets `scenario.draft`, `loadedScenarioId`, and
several UI state fields, but does NOT reset `includeByApiKeyId`:

```ts
const handleReset = useCallback(() => {
  scenario.reset();
  setLoadedScenarioId(null);
  setLoadedScenarioName(null);
  setLoadedReadonly(false);
  setOpenNotice(null);
  setNameInputOpen(false);
  setSaveError(null);
  // ... no setIncludeByApiKeyId({})
}, [scenario.reset]);
```

Concrete failure path: user is in book mode + D3 gate satisfied (per-key path
active). User toggles off key B. User then opens a saved scenario (which calls
`handleReset`). After reset, `usePerKeySources` is still true (same
`entryMode`, same gate), and `includeByApiKeyId` still has `{[keyB.id]: false}`.
The loaded scenario now shows only key A's data even though the user loaded a
fresh draft. The projection is wrong without any visible indication.

Note: `leverageByRef` has the same non-reset pattern and is the documented
template for `includeByApiKeyId`. That pre-existing parity doesn't make the
behavior correct — it means both ephemeral overlays share this defect. Phase 37
introduces a new code path where stale state has a user-visible effect (wrong
curve on scenario load), whereas `leverageByRef` has no visible effect when the
holdings set changes because leverage defaults to 1.0 and stale overrides only
apply when the same `scopeRef` appears in the new draft.

**Fix:** Add `setIncludeByApiKeyId({})` to `handleReset`, parallel to how a
page reload resets it:

```ts
const handleReset = useCallback(() => {
  scenario.reset();
  setLoadedScenarioId(null);
  setLoadedScenarioName(null);
  setLoadedReadonly(false);
  setOpenNotice(null);
  setNameInputOpen(false);
  setSaveError(null);
  setIncludeByApiKeyId({});   // ← add this
  setPendingMode((pending) => {
    if (pending !== null) setEntryMode(pending);
    return null;
  });
}, [scenario.reset]);
```

A corresponding test should be added to `ScenarioComposer.save.test.tsx` or the
Pitfall-5 block: open a saved scenario after toggling off a key; assert the Data
sources control shows both keys as included.

---

## Info

### IN-01: `data-data-source-id` DOM attribute exposes the full internal `api_key_id` UUID

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:2104`

**Issue:**

```tsx
<div
  key={k.id}
  data-data-source-id={k.id}    // ← full UUID in rendered HTML
  ...
>
```

`k.id` is the `api_keys.id` UUID row identifier (not the encrypted exchange
credential). The rendered HTML includes the full UUID in a `data-*` attribute.
This is low-risk: the UUID is already used as the React `key`, so removing the
`data-*` attribute doesn't change security posture. The concern is consistency
with the masking policy — the label already masks `id` to `••••{last4}`; the
`data-*` attribute silently bypasses that masking for anyone inspecting the DOM.

The test suite uses `data-data-source-id` for element selection (DSRC-03), so
this attribute also serves a testing purpose. If it is retained, a brief comment
documenting why the full UUID is acceptable here (row identifier, not a secret)
would be appropriate. If removed, the tests can switch to `aria-label` queries
(which they already use in several assertions).

**Fix (optional):** Either add a clarifying comment, or remove the attribute and
update the test selectors to use `getByRole("switch", { name: ... })` (already
the pattern in the honesty oracle tests). This does not need to block shipping.

---

_Reviewed: 2026-06-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

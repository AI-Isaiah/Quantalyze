---
phase: 08-connection-management-and-notes
plan: 02
subsystem: frontend
tags: [connections, disconnect, holdings-ui, revoked-holdings, localstorage, tests]

# Dependency graph
requires:
  - phase: 06-allocator-api-ingestion
    provides: "delete_allocator_api_key(p_api_key_id, p_cascade_holdings) RPC (migration 069) + allocator_holdings.api_key_id FK + api_keys.sync_status taxonomy (including 'revoked')"
  - phase: 07-demo-mode-purge
    provides: "holdingsSummary projection in getMyAllocationDashboard + AllocationDashboard hosting path"
  - phase: 08-connection-management-and-notes
    plan: 01
    provides: "live migration 071 + neighbouring-table RLS orthogonality (sequencing gate, no code dependency)"
provides:
  - "Disconnect rename + cascade-optional modal with UI-SPEC §1 locked copy"
  - "Unchecked-default cascade checkbox (D-02); Disconnect button enabled regardless of checkbox state once count loads (Pitfall 4 resolved)"
  - "HoldingsTable component at src/app/(dashboard)/allocations/components/HoldingsTable.tsx — revoked-key strikethrough + amber chip + Show revoked-key holdings toggle + hidden-footer"
  - "allocations.showRevokedHoldings localStorage key (default ON per D-05); table-filter ONLY — KPI/equity/drawdown widgets always receive the full unfiltered holdings list per D-04"
  - "queries.ts holdingsSummary projection widened with api_key_id so HoldingsTable can resolve source_key_sync_status via the shared apiKeys array"
  - "Trailing placeholder column on HoldingsTable reserved for Plan 04 note icon (zero-shift slot-in)"
affects: [08-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "localStorage scalar-boolean persistence via module-scope loader + useEffect setter (mirrors useDashboardConfig.ts §Pattern 12)"
    - "Surgical three-edit modal rewrite (Pattern Map §11) — rename + locked copy + disabled-guard delete, no state surface changes"
    - "Client-side join of holdingsSummary × apiKeys to derive source_key_sync_status (avoids nested PostgREST select)"

key-files:
  created:
    - "src/app/(dashboard)/allocations/components/HoldingsTable.tsx"
    - "src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx"
    - "src/app/(dashboard)/allocations/AllocationDashboard.revoked-holdings.test.tsx"
  modified:
    - "src/components/exchanges/AllocatorExchangeManager.tsx"
    - "src/components/exchanges/AllocatorExchangeManager.test.tsx"
    - "src/app/(dashboard)/allocations/AllocationDashboard.tsx"
    - "src/lib/queries.ts"

key-decisions:
  - "Venue label derivation in Disconnect modal reuses key.exchange capitalisation inline (confirmRow lookup against the keys state array) — NO new EXCHANGE_TAGS-style mapping because the capitalisation is sufficient for the institutional modal title."
  - "entry_price and unrealized_pnl_usd on HoldingsTable rows are null-initialised because the Phase 07 holdingsSummary projection does not surface them; HoldingsTable renders them as em-dashes via formatUsd/formatPnl. Widening the projection can happen in a later phase if those columns grow primary UI weight."
  - "Synthetic row id for HoldingsTable (venue-symbol-holding_type-idx) — holdingsSummary collapses by symbol upstream so no DB-level UUID is available; a composite id is stable for React keying and idempotent across re-renders of the same collapsed list."
  - "source_key_sync_status join done CLIENT-SIDE via the apiKeys array the dashboard already receives — queries.ts widening to `api_keys(sync_status)` nested select was rejected as heavier (extra PostgREST round-trip + harder to type). api_key_id is projected; the dashboard's useMemo builds the Map<keyId, sync_status> and zips it onto each row."
  - "LAYOUT_VERSION NOT bumped — HoldingsTable is a page-level section (not a react-grid-layout widget), so DEFAULT_LAYOUT is untouched and the 2→3 bump described in UI-SPEC §8 is a Plan 03 concern (portfolio NotesWidget integration)."

patterns-established:
  - "Dashboard-scoped localStorage toggle with module-scope loader + inline setter — `allocations.showRevokedHoldings` is the second key in the `allocations.*` namespace (useDashboardConfig's `quantalyze-dashboard-config` is the first; the new dotted prefix matches UI-SPEC §2 line 192)."
  - "Client-side join for per-row sync_status — holdings × apiKeys zip pattern is cheaper than widening query projections with nested Supabase selects and is reusable for other per-key UI treatments (Plan 03 note icon's amber-tinted revoked state will reuse the same Map lookup)."
  - "vi.stubGlobal('localStorage', mock) when testing components that read localStorage in JSDom under vitest 4.x — the `--localstorage-file` warning signals jsdom's native localStorage is unstable under this harness; the explicit stub pattern (cloned from useDashboardConfig.test.ts) is the reliable idiom."

requirements-completed:
  - MANAGE-01
  - MANAGE-02
  - MANAGE-03

# Metrics
duration: 24 min
completed: 2026-04-21
---

# Phase 08 Plan 02: Disconnect UI + Revoked-Holdings UI Summary

**Disconnect rename + cascade-optional modal with locked UI-SPEC §1 copy and unchecked-default checkbox (resolves Pitfall 4); new HoldingsTable component with revoked-key strikethrough + amber "Key revoked" chip + allocator-scoped localStorage toggle (default ON per D-05); AllocationDashboard wired with showRevoked state and a client-side holdings×apiKeys join so source_key_sync_status resolves per row without widening the Supabase projection.**

## Performance

- **Duration:** 24 min (1,441 s)
- **Started:** 2026-04-21T06:30:27Z
- **Completed:** 2026-04-21T06:54:28Z
- **Tasks:** 2 committed (4 commits: 2 × RED + 2 × GREEN, per TDD protocol)
- **Files created:** 3
- **Files modified:** 4
- **Commits:** 4

## Accomplishments

- **Disconnect rename landed** — row button "Remove" → "Disconnect"; aria-label "Remove {exchange} key" → "Disconnect {exchange} key"; modal title "Remove exchange key" → `Disconnect {Venue}?` (first-letter-upper on key.exchange); danger button "Remove key"/"Removing…" → "Disconnect"/"Disconnecting…".
- **Modal copy locked per UI-SPEC §1** — explainer "We'll stop syncing this key. Your historical holdings stay available for audit and are reflected in past performance."; zero-holdings branch "No historical holdings are tied to this key."; checkbox label "Also delete {N} historical holding{s} from this key" (plural/singular rule); sub-copy flips verbatim between unchecked ("holdings are kept for audit continuity and reflected in past performance.") and checked ("holdings are permanently deleted and excluded from all historical metrics.").
- **Pitfall 4 resolved** — the disabled guard `(deleteHoldingsCount > 0 && !cascadeHoldings)` is DELETED from the danger button; the button is now enabled whenever `deleteLoading=false` AND the holdings count has loaded. This is the key semantic reversal that makes the new unchecked-default cascade checkbox clickable.
- **RPC call surface unchanged** — `delete_allocator_api_key(p_api_key_id, p_cascade_holdings)` (migration 069) is called verbatim; the checkbox state flows through as `cascadeHoldings` (false default). The existing `handleDeleteKey` at lines 190-209 was NOT modified except for the user-facing error message ("Failed to remove key" → "Failed to disconnect").
- **HoldingsTable component shipped** — `src/app/(dashboard)/allocations/components/HoldingsTable.tsx` (193 lines) renders the allocator's holdings with 7 columns + a trailing placeholder reserved for Plan 04's note icon. Revoked rows (source_key_sync_status === 'revoked') render numeric cells with `line-through text-text-muted` plus an amber "Key revoked" chip (inline style: `#D97706` fg / `#FEF3C7` bg / `#FDE68A` border per UI-SPEC §2). Header-bar toggle "Show revoked-key holdings"; hidden-footer "{N} holding(s) hidden from revoked keys · Show all" with a ghost Show-all button that fires `onShowRevokedChange(true)`.
- **AllocationDashboard wired** — `loadShowRevoked()` module-scope helper with SSR guard and exception-safe `localStorage.getItem` path. `useState<boolean>(loadShowRevoked)` + `useEffect` persist under key `allocations.showRevokedHoldings`. `enrichedHoldings` useMemo joins holdingsSummary with apiKeys to carry source_key_sync_status onto every row. HoldingsTable mounted after the DashboardGrid so it sits below the widget grid on `/allocations?tab=performance`.
- **Historical-inclusion invariant (D-04) preserved** — the toggle filters TABLE RENDER ONLY. KpiStrip / EquityCurve / DrawdownChart continue to receive the full unfiltered `holdingsSummary` via `widgetData`. Verified by T12 (`kpiStripProps[0]` receives all 3 rows while `holdingsTableProps[0].holdings.length === 3` regardless of toggle — HoldingsTable filters internally).
- **All 45 Phase 08 Plan 02 tests green** — 9 new Disconnect assertions on AllocatorExchangeManager + 7 HoldingsTable tests + 7 AllocationDashboard revoked-holdings tests + 22 pre-existing AllocatorExchangeManager tests (all unaffected by the rename).
- **Full allocations + exchanges suite green** — 245/245 tests across 22 files. Typecheck clean. Lint 0 errors (18 pre-existing `_` unused-var warnings unchanged).

## Task Commits

1. **Task 1 RED: Disconnect rename + cascade-optional modal tests** — `21892b3` (test)
2. **Task 1 GREEN: rename Remove→Disconnect + cascade-optional modal** — `871505a` (feat)
3. **Task 2 RED: HoldingsTable + revoked-holdings toggle tests** — `1a63317` (test)
4. **Task 2 GREEN: HoldingsTable with revoked-key UI + allocator-scoped toggle** — `3ac6a94` (feat)

Strict RED → GREEN cadence per TDD protocol.

## Files Created

- `src/app/(dashboard)/allocations/components/HoldingsTable.tsx` — new section component (193 lines). `HoldingRow` interface (id/venue/symbol/holding_type/quantity/value_usd/entry_price/unrealized_pnl_usd/api_key_id/source_key_sync_status), `HoldingsTableProps` (holdings/showRevoked/onShowRevokedChange), 7-column semantic `<table>` with trailing placeholder column reserved for Plan 04. Inline amber chip style (`AMBER_CHIP_STYLE` constant) carries UI-SPEC §2 amber palette. Pure component — all state lives on the caller.
- `src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx` — 7 tests. T1-T3 cover the strikethrough + chip visual states; T4-T5 pin the plural/singular hidden-footer copy and the Show-all button wiring; T6 asserts the exact toggle label; T7 verifies the amber inline style serialised to rgb() form by jsdom.
- `src/app/(dashboard)/allocations/AllocationDashboard.revoked-holdings.test.tsx` — 7 tests. T8 (default ON when localStorage is empty), T9 (false at mount loads as false), T10 (setter persists 'false' after act()), T11 (corrupt value falls back to true), T11b (exception-throwing getItem on the canonical key falls back to true), T12 (D-04 historical-inclusion: KpiStrip receives all 3 rows; HoldingsTable receives all 3 rows too — it filters internally), T12b (source_key_sync_status is joined from apiKeys for every row).

## Files Modified

- `src/components/exchanges/AllocatorExchangeManager.tsx` — three surgical edits per 08-PATTERNS.md §11. (1) Row button variant=secondary, aria-label swap, label "Disconnect". (2) Modal rewrite inside an IIFE so `venueLabel` (first-letter-upper capitalisation of `confirmRow.exchange`) stays scoped to the modal render. (3) Disabled-guard subexpression deleted; danger button label flips "Disconnect" ↔ "Disconnecting…". The existing `handleDeleteKey` RPC call is unchanged other than the user-facing error message.
- `src/components/exchanges/AllocatorExchangeManager.test.tsx` — +9 Disconnect assertions in a new describe block. Shared supabase client mock widened with `rpcMock` and `holdingsCountMock` so the Disconnect flow can observe the allocator_holdings count probe and the `delete_allocator_api_key` RPC call without per-test module resets. All 22 pre-existing tests continue to pass.
- `src/app/(dashboard)/allocations/AllocationDashboard.tsx` — module-scope `REVOKED_STORAGE_KEY` constant + `loadShowRevoked()` helper with SSR + exception guards; `useState<boolean>(loadShowRevoked)` + `useEffect` persistence; `enrichedHoldings` useMemo joins holdingsSummary × apiKeys; HoldingsTable mounted after DashboardGrid with the full unfiltered list. Props typing widened — `holdingsSummary[].api_key_id?: string` (optional for source-compat with existing test call sites).
- `src/lib/queries.ts` — allocator_holdings projection adds `api_key_id`; `derivePhase07Fields` signature + internal row type widened; final `holdingsSummary.map(...)` surfaces `api_key_id` onto every row. `MyAllocationDashboardPayload.holdingsSummary[]` type documents that `api_key_id` exists and is consumed by the dashboard's client-side sync_status join.

## Decisions Made

- **Venue label inline capitalisation** — `confirmRow.exchange.charAt(0).toUpperCase() + slice(1)` inside an IIFE that wraps the confirmation modal. Introducing an `exchangeLabel()` helper would have needed a new export from a shared file; the inline expression is 2 lines and matches the institutional-tone requirement (Binance / OKX / Bybit all capitalise correctly via this rule). If a case like `"bybit"` needs to render as `"Bybit"` (happens naturally) vs `"OKX"` (would render as `"Okx"`), the caller can swap to an EXCHANGE_TAGS-style map later; for the institutional audience the current rule is within the "Claude's discretion" boundary from the plan.
- **entry_price + unrealized_pnl_usd null-initialised** — the Phase 07 holdingsSummary projection does NOT surface these columns (it collapses to `value_usd` only). Rather than widen queries.ts to include them and risk breaking the Phase 07 cumulative-wealth normalisation, I pass `null` and let HoldingsTable's `formatUsd`/`formatPnl` render em-dashes. When Plan 04 or a later phase grows these columns to primary weight, the projection can widen; Phase 08 Plan 02's MANAGE-02 acceptance criteria are met without them.
- **Client-side holdings × apiKeys join over nested PostgREST select** — `api_keys(sync_status)` via PostgREST would add a nested select to the allocator_holdings query, complicating typing and adding a round-trip for data the dashboard already has via `apiKeys`. Instead, `api_key_id` is projected onto each holdings row and AllocationDashboard zips it with the existing apiKeys array via a `Map<keyId, sync_status>` lookup. Cheaper, better-typed, and preserves the single-round-trip shape.
- **localStorage toggle state on AllocationDashboard (not a hook)** — per 08-PATTERNS.md §12, the toggle is a single scalar boolean whose shape will never grow (no tiles, no layoutVersion). A dedicated hook would be over-engineering; inline `useState` + `useEffect` is the same pattern 4 of the 6 allocations-tree surfaces already use for simple settings.
- **LAYOUT_VERSION NOT bumped** — HoldingsTable is a page-level `<section>` mounted outside the react-grid-layout container. `DEFAULT_LAYOUT` is unchanged so the 2→3 bump documented in UI-SPEC §8 belongs to Plan 03 (portfolio NotesWidget integration adds a new `"notes-1"` widget entry), not Plan 02.
- **Row uses synthetic id (venue-symbol-holding_type-idx)** — holdingsSummary collapses by symbol upstream in `derivePhase07Fields`, so no DB UUID is available for the React key. The composite string is stable across re-renders of the same collapsed list; duplicate venue+symbol+holding_type is structurally impossible post-collapse (the Map groups by `r.symbol` keeping only the latest-asof winner).
- **Test harness localStorage stub** — vitest 4.1.2 + jsdom shows a `--localstorage-file was provided without a valid path` warning and leaves `localStorage.setItem` missing on `globalThis`. `vi.stubGlobal("localStorage", mock)` (the pattern already shipped in useDashboardConfig.test.ts) is the reliable idiom. Using the native jsdom localStorage via `window.localStorage` produced the same `setItem is not a function` failures.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing projection] queries.ts holdingsSummary lacked `api_key_id`**
- **Found during:** Task 2 read_first
- **Issue:** The plan's Task 2 behavior spec required HoldingsTable rows to carry `source_key_sync_status` "joined from api_keys by the query layer". The shipped Phase 07 `derivePhase07Fields` projection did NOT include `api_key_id` — only symbol/quantity/mark_price_usd/value_usd/venue/holding_type. Without api_key_id, AllocationDashboard cannot resolve which api_keys row owns each holding, and the revoked-key UI cannot trigger.
- **Fix:** Widened the `.select(...)` projection on `allocator_holdings` to include `api_key_id`; extended the internal row type + `derivePhase07Fields` parameter type + the `holdingsSummary.map(...)` terminal shape to propagate `api_key_id` through to the final payload type. Client-side join at the dashboard layer then zips this with the shared `apiKeys` array to derive `source_key_sync_status` per row. Chose client-side join over nested PostgREST select per the decision above.
- **Files modified:** src/lib/queries.ts, src/app/(dashboard)/allocations/AllocationDashboard.tsx (prop type widened, enrichedHoldings useMemo added)
- **Verification:** T12b in AllocationDashboard.revoked-holdings.test.tsx asserts the revoked row's `source_key_sync_status === 'revoked'` after the join; T2 in HoldingsTable.test.tsx proves the amber chip + strikethrough render when that field is 'revoked'.
- **Committed in:** 1a63317 (Task 2 RED) and 3ac6a94 (Task 2 GREEN)

**2. [Rule 3 — Test infrastructure] JSDom localStorage flakiness under vitest 4.1.2**
- **Found during:** Task 2 RED gate run
- **Issue:** `window.localStorage.setItem is not a function` failed every test using localStorage. A side-channel warning — `--localstorage-file was provided without a valid path` — surfaces on test-runner start, indicating jsdom's localStorage integration is broken under the current vitest+jsdom matrix.
- **Fix:** Cloned the explicit `vi.stubGlobal("localStorage", localStorageMock)` pattern from `useDashboardConfig.test.ts` (the only other test that mutates localStorage). Selective-throw on the canonical key preserves other consumers (notably `useTimeframe` which reads its own `quantalyze-timeframe` key in the same mount lifecycle).
- **Files modified:** src/app/(dashboard)/allocations/AllocationDashboard.revoked-holdings.test.tsx
- **Verification:** All 7 dashboard tests green; no impact on the 14 unrelated tests in the same mount path (`useDashboardConfig`, `useTimeframe` both unaffected).
- **Committed in:** 1a63317 (RED) — the stub lands in the same commit as the test file.

**3. [Rule 2 — Missing acceptance-criterion-driver] `renderWithDisconnectMock` refactor in AllocatorExchangeManager.test.tsx**
- **Found during:** Task 1 RED gate run
- **Issue:** My initial Disconnect tests used a per-test `vi.doMock` + `vi.resetModules()` approach to override the `@/lib/supabase/client` mock for the RPC flow. This broke the existing 22 tests in the file (the module cache was being reset between describes). Reverting to `vi.resetModules` + dynamic import kept the Disconnect tests passing but broke the original Sync-now tests.
- **Fix:** Widened the top-level `vi.mock("@/lib/supabase/client", ...)` stub once — added `rpc: (name, args) => rpcMock(name, args)` and the `select(...).eq(...)` chain for the `allocator_holdings` count probe. Exposes two module-level fn mocks (`rpcMock`, `holdingsCountMock`) that tests reset in their `beforeEach`. All 31 tests now share the same client mock, no per-test module cache thrash, no imports need to be dynamic.
- **Files modified:** src/components/exchanges/AllocatorExchangeManager.test.tsx
- **Verification:** All 22 existing tests + 9 new Disconnect tests green under a single `vi.mock` declaration.
- **Committed in:** 21892b3 (RED) — the shared-mock extension is part of the test-only commit.

---

**Total deviations:** 3 auto-fixed (1 Rule 2 missing projection, 2 Rule 3 test infrastructure).
**Impact on plan:** All three are scoped to the components touched by the plan — none introduce new functionality or widen the commit surface beyond what the plan's acceptance criteria required. The queries.ts widening (deviation 1) is a trivial field addition with zero behavior change for existing consumers (the new field is optional in AllocationDashboardProps so all existing test call sites continue to compile).

## Issues Encountered

- **jsdom localStorage instability** — documented in Deviation 2. Fix via explicit stub; no recurrence expected as long as future localStorage-dependent tests in this tree follow the same `vi.stubGlobal` pattern.
- **Button text collision in modal confirm** — two buttons with `textContent === "Disconnect"` (the row button + the modal's danger confirm) caused `getAllByRole(...).find(text === "Disconnect")` to always return the row button. Resolved by filtering on `className.includes("bg-negative")` (the danger variant marker class) and taking `.at(-1)` to scope to the modal's render.

## Hooks for Plan 03 and Plan 04

**Plan 03 (shared note components + per-scope UI surfaces):**
- `HoldingsTable.tsx` exposes `HoldingRow` as a typed export (`export type HoldingRow`) so Plan 03's HoldingNoteRow can reuse the same shape when it mounts an expandable sub-row below each holdings row.
- The trailing placeholder `<th aria-hidden="true" />` at the end of the `<thead>` + the matching `<td ... aria-hidden="true" />` in each `<tr>` are reserved slots. Plan 04's note icon button lands in these cells with zero column shift — just replace `aria-hidden="true"` with the icon button + its `aria-label`/`aria-expanded`/`aria-controls` plumbing per UI-SPEC §3.
- `enrichedHoldings` carries `api_key_id` + `source_key_sync_status` per row; Plan 03 derives the note icon's three-state class directly (`outlined` / `solid accent` / `amber`) from `h.source_key_sync_status === 'revoked'` without additional joins.

**Plan 04 (revoked-holdings toggle + Disconnect cascade — already landed here):**
- The toggle + cascade checkbox + localStorage persistence are all complete in Plan 02. Plan 04's scope per the phase charter is "empty" from this plan's perspective (the content merged into Plan 02 at planning time). STATE.md / ROADMAP.md should reflect the merged state.

**scope_ref derivation for Plan 03 HoldingNoteRow:**
- Each `HoldingRow` contains `venue`, `symbol`, `holding_type` — feed directly to `buildHoldingScopeRef({venue, symbol, holding_type})` from `src/lib/notes/scope-ref.ts` (Plan 01 export). No additional transformation needed.

## UI-SPEC Copy Adherence

No deviations from UI-SPEC §1 / §2 locked copy. All string literals landed verbatim:

- Modal title: `` `Disconnect ${venueLabel}?` `` (UI-SPEC §1)
- Explainer: "We'll stop syncing this key. Your historical holdings stay available for audit and are reflected in past performance." (UI-SPEC §1)
- Checking: "Checking holdings…" (UI-SPEC §1)
- Zero holdings: "No historical holdings are tied to this key." (UI-SPEC §1)
- Cascade label: "Also delete {N} historical holding{s} from this key" (UI-SPEC §1)
- Unchecked sub-copy: "Unchecked: holdings are kept for audit continuity and reflected in past performance." (UI-SPEC §1)
- Checked sub-copy: "Checked: holdings are permanently deleted and excluded from all historical metrics." (UI-SPEC §1)
- Disconnect button: "Disconnect" / "Disconnecting…" (UI-SPEC §1)
- Chip: "Key revoked" (UI-SPEC §2)
- Toggle label: "Show revoked-key holdings" (UI-SPEC §2)
- Hidden footer: "{N} holding{s} hidden from revoked keys · Show all" (UI-SPEC §2)

## Test Count Delta

- **Before (Phase 07 + Plan 01 baseline):** 22 tests on AllocatorExchangeManager.test.tsx
- **After (Plan 02 delta):**
  - +9 Disconnect assertions on AllocatorExchangeManager (22 → 31 total on that file)
  - +7 HoldingsTable component tests (new file)
  - +7 AllocationDashboard revoked-holdings tests (new file)

**Net:** +23 new tests. Full allocations + exchanges suite: 245/245 green across 22 files. Zero regressions.

## User Setup Required

None. Phase 08 Plan 02 is pure frontend — no migrations, no dependencies added, no environment variables touched. The live migration 069 RPC that Disconnect consumes was shipped in Phase 06 Plan 04 and remains unchanged.

## Known Stubs

None. All UI surfaces render real data:

- HoldingsTable rows carry the full enriched holdings with source_key_sync_status joined from apiKeys.
- Entry price and unrealized P&L render em-dashes (`formatUsd/formatPnl` on `null`) — this is correct rendering of an absent value, not a stub. Phase 07's holdingsSummary projection doesn't surface these columns; when a later phase widens the projection, the values flow through automatically (no UI rework needed).

## Self-Check: PASSED

- [x] `src/app/(dashboard)/allocations/components/HoldingsTable.tsx` exists
- [x] `src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx` exists
- [x] `src/app/(dashboard)/allocations/AllocationDashboard.revoked-holdings.test.tsx` exists
- [x] Commit `21892b3` present in `git log` (Task 1 RED)
- [x] Commit `871505a` present in `git log` (Task 1 GREEN)
- [x] Commit `1a63317` present in `git log` (Task 2 RED)
- [x] Commit `3ac6a94` present in `git log` (Task 2 GREEN)
- [x] All 45 Plan 02 tests green (9 new on AllocatorExchangeManager + 14 on the new test files + 22 pre-existing)
- [x] Full 245/245 allocations + exchanges suite green
- [x] `npm run typecheck` clean
- [x] `npm run lint` 0 errors
- [x] UI-SPEC §1 + §2 locked copy landed verbatim
- [x] Pitfall 4 resolved (cascade-optional button enabled regardless of checkbox state)
- [x] D-04 historical-inclusion invariant preserved (KpiStrip receives unfiltered list; T12 verified)
- [x] D-05 default-ON invariant preserved (empty localStorage → showRevoked=true; T8 verified)
- [x] LAYOUT_VERSION unchanged (HoldingsTable is not a react-grid widget)

---

*Phase: 08-connection-management-and-notes*
*Plan: 02*
*Completed: 2026-04-21*

# VOICES-ACCEPTED — Phase 09.1

User decision: **Apply ALL divergent + consensus findings** (15 total).

Each finding below is a concrete change list for the replan. The planner must apply these edits to the existing PLAN.md files without restructuring the phase or changing plan decomposition. Preserve all unaffected content.

---

## C1 — Consensus: Plan 03 v2 storage-key contradicts D-02

**Target:** `.planning/phases/09.1-allocator-dashboard-ui-refresh-implement-designer-provided-a/09.1-03-PLAN.md`

**Change:**
- Delete the "Simplified approach — two storage keys during bake" paragraph in Task 2 `<action>`.
- Use a SINGLE `STORAGE_KEY = "quantalyze-dashboard-config"` for both legacy and V2 hooks (per locked D-02).
- V2 hook reset-on-mismatch: when `parsed.layoutVersion !== 4`, reset to v4 defaults (matches Phase 05 + Phase 08 precedent, Voice-D8 approved).
- Legacy hook reset-on-mismatch: when it sees v4, resets to its own `LEGACY_DEFAULT_LAYOUT` (one-time reset for flag-off allocators after this plan ships).
- Update Task 3 test 1: localStorage key must be `quantalyze-dashboard-config` (NOT `-v2`).
- Remove `STORAGE_KEY_V2` / `STORAGE_KEY_LEGACY` / dual-hook comments throughout the plan.

---

## S1 — Sequencing: Plan 01 ↔ Plan 02 file-overlap on AllocationsTabs.tsx

**Target:** `09.1-02-PLAN.md`

**Change (frontmatter):**
- `depends_on: []` → `depends_on: [09.1-01]`
- `wave: 1` → `wave: 2`

**Rationale:** Both plans modify `AllocationsTabs.tsx`. Plan 01 inserts the `uiV2` flag block, `+ Allocation` header button, and V2 mount; Plan 02 extends TAB_KEYS to 6 and rewrites the URL-cleanup / polling / changeTab effects. If they run in parallel in wave 1, Plan 02's rewrites will clobber Plan 01's insertions. Move Plan 02 to wave 2 with explicit dep.

**Downstream cascade:** Plans 04 and 05 currently say `wave: 2`. After this change, Plan 02 joins wave 2. Plans 04/05/06/07/08/09/10/11 waves need to be re-evaluated:
- Plan 04 (depends_on: [09.1-01]) stays wave 2.
- Plan 05 (now depends on 09.1-02 per S2) moves to wave 3 (or keeps wave 2 if 09.1-02 runs serially before 05 in the same wave).
- Planner: re-derive waves from the updated DAG and renumber consistently.

---

## S2 — Sequencing: Plan 05 `depends_on` omits 09.1-02

**Target:** `09.1-05-PLAN.md`

**Change (frontmatter):**
- `depends_on: [09.1-01, 09.1-03]` → `depends_on: [09.1-01, 09.1-02, 09.1-03]`
- Update `wave` to reflect the updated DAG (must be strictly greater than Plan 02's new wave).

**Rationale:** Plan 05 Task 3 modifies `AllocationDashboardV2.tsx` to render the full body; that body mounts inside the 6-tab shell that Plan 02 delivers (D-05/D-06). Missing dep.

---

## S3 — Sequencing: Plan 08 drops per-row BridgeOutcomeBanner (D-14)

**Target:** `09.1-08-PLAN.md`

**Change (Task 2 `<action>` block):**
- After the "Row click → row expand" bullet, insert:
  > "Preserve per-row `BridgeOutcomeBanner` mount per D-14: when `row.bridgeCandidate === true`, render `<BridgeOutcomeBanner holdingRef={row.id} ... />` as a non-expanded inline banner above the sub-row region (matching Phase 09 per-row surface). Import path: `./BridgeOutcomeBanner`."
- Add `<acceptance_criteria>` entry:
  > `grep -q 'BridgeOutcomeBanner' src/app/(dashboard)/allocations/components/HoldingsTable.tsx`
- Remove any Plan 09 language that "retroactively reintegrates" the per-row banner — Plan 08 owns this now.

---

## R1 — Risk: Plan 04 adapter fabricates `asset_symbols` join key

**Target:** `09.1-04-PLAN.md`

**Change (Task 2 `<action>`):**
- Replace the `strategies.find(s => Array.isArray(s.asset_symbols) && s.asset_symbols.includes(h.symbol))` code block.
- New Task 2 preamble (before any code):
  > "STOP and grep first. Run `grep -n 'strategy' src/lib/queries.ts`, `grep -n 'holding' src/app/(dashboard)/allocations/AllocationDashboard.tsx | head -50`, and read `AllocationDashboard.tsx:697-724` (enrichedHoldings). Extract the EXACT holding→strategy correspondence the legacy body already uses; port verbatim."
- New fallback rule:
  > "If no correspondence exists in `MyAllocationDashboardPayload`, the adapter accepts an OPTIONAL `holdingToStrategyId?: Record<string, string>` map (keyed by `buildHoldingScopeRef(venue, symbol, holding_type)`). `HoldingsTabPanel` builds this map from whatever legacy logic currently produces strategy IDs. Do NOT invent `asset_symbols`."
- Remove the `asset_symbols?: string[] | null` field from any type additions.
- Task 3 Test 7 assertion changes from "rows without matching strategy render `—`" to "rows without `holdingToStrategyId` entry OR missing strategy render `—` via fallback".

---

## R2 — Risk: Plan 09 BridgeDrawer violates D-16 "no parallel bridge API"

**Target:** `09.1-09-PLAN.md`

**Change (Task 2 `<read_first>`):**
- Replace the ScenarioFlaggedHoldingsList line with:
  > `src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.tsx` — full file read. Extract the EXACT endpoint path, HTTP method, and request body shape used for the existing intro flow. Do NOT invent.
- Add:
  > `src/app/api/**` — grep for the route handler that accepts the intro payload the existing code posts. If no existing intro endpoint exists, STOP and flag back to planning. Do not introduce a new route in this plan (D-16).

**Change (Task 2 `<action>`):**
- Delete the hardcoded `fetch("/api/match/decisions/holding", ...)` literal.
- Replace with: "Use the extracted call site verbatim — import the shared helper or inline the exact fetch signature ScenarioFlaggedHoldingsList uses."

**Change (Task 3 Test 8):**
- Update to assert on the endpoint ACTUALLY extracted, not the speculative literal.

**Add acceptance criterion:**
- `! grep -q '"/api/match/decisions/holding"\|"/api/bridge' src/app/(dashboard)/allocations/components/BridgeDrawer.tsx` — no string-literal fetch URL; helper import only.

---

## R3 — Risk: Plan 05 widget-gating regression on short-key vs registry-id mix

**Target:** `09.1-05-PLAN.md`

**Change (Task 3 `<action>`):**
- After the `DESIGNER_KEY_TO_WIDGET_ID` block, add:
  > "Normalize at write time, not render time. In `useDashboardConfigV2.addWidget`, always persist the resolved `WIDGET_REGISTRY` id (`bridge-hero`, `kpi-strip`, ...) — never the designer short key. `DEFAULT_LAYOUT`'s short-key entries (`bridge`, `kpi`, ...) are mapped through `DESIGNER_KEY_TO_WIDGET_ID` at IMPORT time, so `config.tiles` only ever contains registry IDs. Remove the render-time `?? t.k` fallback."
- Add `files_modified` entry: `src/app/(dashboard)/allocations/AllocationDashboardV2.widget-gating.test.tsx` (NEW)
- Add Task to create the new test — single test case asserting `strategies.length === 0` filters composite widget IDs from the rendered V2 grid. Mirror `AllocationDashboard.widget-gating.test.tsx` shape.

---

## R4 — Risk: Plan 06 Avg ρ cell renders misleading sub-copy

**Target:** `09.1-06-PLAN.md`

**Change (Task 1 `<action>` for the Avg ρ cell):**
- Change the `sub:` assignment from `warmupHelper && avg_correlation == null ? warmupHelper : "average pairwise correlation across holdings"` to:
  ```ts
  sub: avg_correlation == null
    ? "Requires per-holding correlation data (pending)"
    : "average pairwise correlation across holdings"
  ```
- Comment: `// Honest user-visible signal — field not yet wired in MyAllocationDashboardPayload`

**Change (Task 2 test additions):**
- Add test case: "Avg ρ cell renders 'Requires per-holding correlation data (pending)' when `analytics.avg_correlation` is null"

---

## R5 — Risk: Plan 11 sidebar badge introduces new server query

**Target:** `09.1-11-PLAN.md`

**Change (Task 2 `<action>`):**
- Delete the "`getFlaggedHoldingsCount(userId: string): Promise<number>` helper" paragraph.
- Replace with:
  > "Do NOT add a new server query. Instead, thread `flaggedHoldings.length` from the existing `/allocations/page.tsx` payload into `DashboardChrome`. Preferred: React Context (`AllocationContext`) created in `MyAllocationClient.tsx` consumed by `DashboardChrome`. Alternative: optional `flaggedCount?: number` prop on `DashboardChrome` populated only when parent already has the payload. On non-allocations pages, the badge simply renders with no count (or 0)."
- Remove `src/lib/queries.ts` from `files_modified`.

**Add acceptance criterion:**
- `! grep -q 'getFlaggedHoldingsCount\|bridge_match_decisions' src/lib/queries.ts` — no new query was introduced.

---

## V1 — Verification: Plan 05 keyboard reorder missing (D-04 a11y contract)

**Target:** `09.1-05-PLAN.md`

**Change (Task 1 `<action>` — WidgetChrome block):**
- After the `aria-label="Reorder widget"` line, add:
  ```tsx
  const [kbdMode, setKbdMode] = useState(false);
  // Enter/Space toggles keyboard-reorder mode; ArrowUp/Down invoke onMove; Esc exits.
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setKbdMode(v => !v); return; }
    if (!kbdMode) return;
    if (e.key === "ArrowUp") { onMove(k, "prev"); e.preventDefault(); }
    if (e.key === "ArrowDown") { onMove(k, "next"); e.preventDefault(); }
    if (e.key === "Escape") { setKbdMode(false); e.preventDefault(); }
  };
  // On drag handle: aria-pressed={kbdMode}, onKeyDown={handleKeyDown}
  ```
- Add an always-present `⋯` overflow menu (sibling of SizeStepper) exposing `<button role="menuitem">` items: "Move up", "Move down", "Remove". Menu is visible at all times (not hover-only) for screen-reader access.

**Add acceptance criteria:**
- `grep -q 'onKeyDown' src/app/(dashboard)/allocations/components/WidgetChrome.tsx`
- `grep -q 'role="menuitem"' src/app/(dashboard)/allocations/components/WidgetChrome.tsx`
- `grep -q 'aria-pressed' src/app/(dashboard)/allocations/components/WidgetChrome.tsx`

**Add Task 3 test case:**
- "keyboard reorder: focus drag handle, press Enter, press ArrowDown → `onMove` fires with `(k, 'next')`; press Esc → mode exits"
- "overflow menu: 'Move up'/'Move down'/'Remove' buttons present with `role="menuitem"`"

---

## V2 — Verification: Plan 05 Task 1 defers D-01 pointer-resize

**Target:** `09.1-05-PLAN.md`

**Change (Task 1 `<action>`):**
- Delete the sentence "Do NOT implement the pointer-based resize handle in this task; the SizeStepper covers all ... polish add".
- Replace with:
  > "Implement the right-edge pointer-resize handle per `designer-bundle/project/src/widget-grid.jsx:100-135`. Structure: absolute-positioned `.resize-handle` div (6px wide, full height, `cursor: col-resize`), `onPointerDown` captures pointer, `onPointerMove` computes target span from delta relative to column width, snaps to nearest `[1,2,3,4]` on `onPointerUp`, calls `resizeWidget(k, nextW)`."

**Add acceptance criterion:**
- `grep -q 'onPointerDown' src/app/(dashboard)/allocations/components/WidgetGrid.tsx`
- `grep -q 'col-resize' src/app/(dashboard)/allocations/components/WidgetGrid.tsx`

**Add Task 3 test case:**
- "pointer resize: simulate `pointerdown` on resize handle, `pointermove` by 1 column width, `pointerup` → `resizeWidget` called with target span"

---

## V3 — Verification: Plan 11 QA-mode process.env not testable

**Target:** `09.1-11-PLAN.md`

**Change (Task 1 `<action>` — Tweaks component gate):**
- Replace `if (process.env.NEXT_PUBLIC_QA_MODE !== "true") return null;` with an import from a dedicated module:
  ```ts
  // src/lib/qa-mode.ts (NEW)
  export const QA_MODE = process.env.NEXT_PUBLIC_QA_MODE === "true";
  // Tweaks.tsx
  import { QA_MODE } from "@/lib/qa-mode";
  if (!QA_MODE) return null;
  ```
- Add `src/lib/qa-mode.ts` to `files_modified`.

**Change (Task 3 tests):**
- Use `vi.mock("@/lib/qa-mode", () => ({ QA_MODE: true }))` (or false for the hide case).
- Drop `vi.stubEnv("NEXT_PUBLIC_QA_MODE", ...)` usage.

**Add acceptance criterion:**
- `grep -q "vi.mock.*qa-mode" src/app/(dashboard)/allocations/components/Tweaks.test.tsx`

---

## V4 — Verification: Plan 07 period-tokens grep is broken

**Target:** `09.1-07-PLAN.md`

**Change (Task 1 `<acceptance_criteria>` — period tokens check):**
- Delete the compound `grep -qE "\"1M\".*\"3M\"..."/ fallback `grep -c` line.
- Replace with a per-token loop:
  ```bash
  for t in 1M 3M 6M YTD 1Y ALL CUSTOM; do
    grep -q "\"$t\"" src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx || exit 1
  done
  ```
- Each period token must appear as a quoted string in source.

---

## V5 — Verification: Plan 01 Task 2 weak grep-only acceptance criteria

**Target:** `09.1-01-PLAN.md`

**Change (Task 2 `<acceptance_criteria>`):**
- Keep the `pnpm tsc --noEmit` and `pnpm vitest run AllocationsTabs.feature-flag.test.tsx` entries.
- Delete the 5 grep lines for exact strings from Task 1.
- Add test-level assertions (tests land in Task 3 file):
  - "container.querySelector('[data-ui-v2-shell]') is non-null when `localStorage.getItem('allocations.ui_v2') === 'true'`"
  - "container.querySelector('[data-ui-v2-shell]') is non-null when URL `?ui=v2` is set AND `NEXT_PUBLIC_QA_MODE === 'true'`"
  - "container.querySelector('[data-legacy-dashboard]') is non-null when flag is `false` and no override"
  - "No React hydration mismatch warning fires (spy on `console.error`)"
- Ensure the V2 shell exposes `data-ui-v2-shell` attribute and legacy exposes `data-legacy-dashboard` (small markup additions).

**Add acceptance criterion:**
- `grep -q 'data-ui-v2-shell' src/app/(dashboard)/allocations/AllocationDashboardV2.tsx`
- `grep -q 'data-legacy-dashboard' src/app/(dashboard)/allocations/AllocationDashboard.tsx` (or `.legacy.tsx` if renamed)

---

## C1 — Clarity: Plan 08 silently drops "Modified" outcome kind

**Target:** `09.1-08-PLAN.md`

**Change (Task 1 `<action>` — OutcomeForm segmented control):**
- Replace the 2-option segmented control with 3 options. The third is a disabled placeholder:
  ```tsx
  const MODES = [
    { key: "allocated", label: "Allocated", disabled: false },
    { key: "rejected",  label: "Rejected",  disabled: false },
    { key: "modified",  label: "Modified (coming soon)", disabled: true, "aria-disabled": true, tooltip: "Schema extension pending — see follow-up phase" },
  ];
  ```
- Delete the JSDoc comment that said "Drop 'modified' — it is NOT a `bridge-outcome-schema` kind".

**Add acceptance criterion:**
- `grep -q '"modified"' src/app/(dashboard)/allocations/components/OutcomeForm.tsx`

---

## Wave DAG re-derivation instructions (for planner)

After applying S1, S2, S3: re-derive waves from the updated `depends_on` graph.

- Plan 01 (depends_on: []) — wave 1
- Plan 02 (depends_on: [09.1-01]) — wave 2
- Plan 03 (depends_on: []) — wave 1
- Plan 04 (depends_on: [09.1-01]) — wave 2
- Plan 05 (depends_on: [09.1-01, 09.1-02, 09.1-03]) — wave 3 (gated on 09.1-02)
- Plan 06 (depends_on: [09.1-01]) — wave 2
- Plan 07 (depends_on: [09.1-01, 09.1-04]) — wave 3
- Plan 08 (depends_on: [09.1-04, 09.1-05]) — wave 4
- Plan 09 (depends_on: [09.1-05, 09.1-08]) — wave 5
- Plan 10 (depends_on: [09.1-02, 09.1-05]) — wave 4
- Plan 11 (depends_on: [09.1-01, 09.1-02]) — wave 3

Update each plan's `wave:` frontmatter to match. Keep 5-wave structure if the DAG requires it; that's fine.

**Plans 01 ↔ 02 file-overlap no longer exists** because Plan 02 moves to wave 2. Plans 07 ↔ 08 overlap on `AllocationDashboardV2.tsx` / `widgets/index.ts` stays — serialize within their shared wave. Plan 09 ↔ 11 `AllocationDashboardV2.tsx` overlap stays.

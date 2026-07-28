# Phase 46: Surface-by-Surface Reflow (CSS-first, no charts) - Pattern Map

**Mapped:** 2026-06-27
**Files analyzed:** 13 (6 tables · 2 wizard · 4 honest-state verify · 4 test/e2e/ci new · admin opportunistic)
**Analogs found:** 13 / 13 (every target has an in-repo analog — this is mechanical wiring of phase-44/45 primitives)

> This phase is CSS-first wiring of primitives that already exist. There is **no** "find the closest service" guesswork — the analog for every table is the same `ResponsiveTable` wrap, the analog for the wizard is the existing `<DesktopGate>` removal, and the analog for every test is a phase-44/45 precedent. The value of this map is the **exact before/after excerpts with line numbers** so the executor mirrors them without re-reading or guessing.
>
> **CRITICAL — trust the CODE constants, not the UI-SPEC mode labels.** RESEARCH §"the UI-SPEC mode labels are INVERTED" is confirmed by direct code read: `LegacyHoldingsTable` has `TOTAL_COLUMNS = 7` (HoldingsTable.tsx:378); `DesignHoldingsTable` has `DESIGN_TOTAL_COLUMNS = 9` (HoldingsTable.tsx:551). The guard anchors on the component + its constant + the verbatim `<th>` set below, NEVER on the spec's "NEW"/"DESIGN" naming.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/app/(dashboard)/allocations/components/HoldingsTable.tsx` (3 inner `<table>`s) | component (table) | request-response (render) | `ResponsiveTable.tsx` (wrap primitive) + `ScenarioCompareTable.tsx:185` (overflow-x precedent) | exact |
| `src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx` | component (table) | request-response (render) | `ResponsiveTable.tsx` | exact |
| `src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx` | component (table) | request-response (render) | `ResponsiveTable.tsx` (replace raw `overflow-x-auto` div) | exact (self-migration) |
| `src/app/(dashboard)/allocations/widgets/risk/CorrelationMatrix.tsx` | component (table) | request-response (render) | `ResponsiveTable.tsx` (replace raw `overflow-auto` div, preserve inline hex) | role-match (two-axis → one-axis) |
| `src/components/admin/ComputeJobsTable.tsx` (+ other admin tables, opportunistic) | component (table) | request-response (render) | `ResponsiveTable.tsx` | exact |
| `src/app/(dashboard)/strategies/new/wizard/page.tsx` | route (RSC) | request-response | self (remove `<DesktopGate>` wrapper, keep `<Suspense key={source}>`) | exact (self-edit) |
| `src/app/(dashboard)/strategies/new/wizard/DesktopGate.tsx` | component (client) | event-driven (matchMedia) | **DELETE** | n/a |
| `src/app/(dashboard)/strategies/new/wizard/DesktopGate.test.tsx` | test | n/a | **DELETE** | n/a |
| `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` + `steps/*` | component (client) | event-driven | self (CSS-first layout reflow — `grid-cols-1 sm:grid-cols-*`) | exact (self-edit) |
| `…/ui/EmptyStateCard.tsx`, `…/scenarios/SampleFloorEmptyState.tsx`, `allocations/EmptyState.tsx`, `…/ui/Skeleton.tsx` | component (presentation) | n/a | self (VERIFY-only at 320px; fix only on overflow) | exact (read-only verify) |
| `src/**/holdings-all-columns.test.tsx` (NEW guard) | test (render guard) | n/a | `HoldingsTable.strategy-rows.test.tsx` (render setup) + `MobileNav.test.tsx` (exact-set pinning) + `viewport-zoom-meta.test.ts` (source-scan + falsifiability) | exact |
| `e2e/reflow-sweep.spec.ts` (NEW, or extend `reflow.spec.ts`) — public unseeded | test (e2e) | request-response | `e2e/reflow.spec.ts` (unseeded precedent) + `e2e/helpers/reflow.ts` (`assertNoReflow`) | exact |
| `e2e/reflow-sweep-authed.spec.ts` (NEW) — seeded authed | test (e2e) | request-response | `e2e/mobile-drawer-keyboard.spec.ts` (seeded precedent: `HAS_SEED_ENV` + `seedTestAllocator` + `loginViaForm`) | exact |
| `.github/workflows/ci.yml` (FLOW-01 dual-wiring) | config (ci) | n/a | self — `ci.yml:1059` (unseeded list) + `ci.yml:1252-1263` (seeded MA-8 list) | exact (self-edit) |

## Pattern Assignments

### Table wrap — `HoldingsTable.tsx` × 3, `OpenPositionsTable.tsx` (component, render)

**Analog:** `src/components/ResponsiveTable.tsx` (the wrap primitive)

**The primitive — full source** (`ResponsiveTable.tsx:23-36`):
```tsx
export function ResponsiveTable({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: string;
}) {
  const label = hint ?? DEFAULT_HINT;
  return (
    <div className="overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
```
- It is a **Server Component** (no `"use client"`) — composes into both server- and client-rendered table parents.
- `DEFAULT_HINT` (`ResponsiveTable.tsx:4-5`): `"Table scrolls horizontally. Swipe or use arrow keys to see more columns."` — pass `hint` ONLY if a clearer affordance is warranted; default is canonical.
- **Do NOT add a duplicate `sr-only` scroll node** — the `aria-label` IS the accessible name (double-announce, documented at `ResponsiveTable.tsx:16-21`).

**Import** (verified pattern — path alias `@/`):
```tsx
import { ResponsiveTable } from "@/components/ResponsiveTable";
```

**BEFORE → AFTER, each of the 4 raw `<table>` sites.** The pattern is identical: wrap the `<table>` only, restyle nothing.

| # | Table | File:line of `<table>` | `<table>` opener (verbatim — keep) |
|---|-------|------------------------|-------------------------------------|
| 1 | `StrategyRowsTable` | `HoldingsTable.tsx:260` | `<table className="w-full text-sm" data-table="strategies">` |
| 2 | `LegacyHoldingsTable` | `HoldingsTable.tsx:399` | `<table className="w-full text-sm">` |
| 3 | `DesignHoldingsTable` | `HoldingsTable.tsx:620` | `<table className="w-full text-sm">` |
| 4 | `OpenPositionsTable` | `OpenPositionsTable.tsx:127` | `<table className="w-full text-sm">` (has a `<tfoot>` total at :199 — wrap the whole table, the tfoot rides inside) |

Each of these sits in a `{cond ? <p…/> : (<table>…</table>)}` ternary (e.g. `HoldingsTable.tsx:255-313`, `:394-491`, `:615-805`; `OpenPositionsTable.tsx:122-215`). **Wrap the `<table>…</table>` branch only** — leave the empty-state `<p>` branch untouched (it is short copy, no overflow):
```tsx
// BEFORE
) : (
  <table className="w-full text-sm">…</table>
)}

// AFTER
) : (
  <ResponsiveTable>
    <table className="w-full text-sm">…</table>
  </ResponsiveTable>
)}
```

---

### Table migration — `ScenarioCompareTable.tsx` (component, render)

**Analog:** `ResponsiveTable.tsx` — replace the **raw `overflow-x-auto` div** with the primitive (it gains the `role="region"` + focusable + sr-only-hint contract).

**BEFORE** (`ScenarioCompareTable.tsx:185-186` … closing `</div>` is the sibling of `:281` `</table>`):
```tsx
<div className="overflow-x-auto">
  <table className="w-full text-sm">
    {/* thead with data-testid={`scenario-col-${c.name}`} (:195), tbody with cell-${c.name}-${metric.key} (:220) */}
  </table>
</div>
```
**AFTER** (drop the raw div, swap in the component — nothing else changes):
```tsx
<ResponsiveTable>
  <table className="w-full text-sm">
    {/* unchanged — all data-testids, winner ✓ logic, METRICS rows preserved verbatim */}
  </table>
</ResponsiveTable>
```
- **Preserve every test anchor:** `data-testid={`scenario-col-${c.name}`}` (:195), `data-testid={`cell-${c.name}-${metric.key}`}` (:220), `data-testid={isWinner ? `winner-${metric.key}` : undefined}` (:224), the `METRICS` array (:70-…). The all-columns guard + `ScenarioCompareTable.test.tsx` use them.

---

### Table migration — `CorrelationMatrix.tsx` (component, render) — TWO-AXIS CAVEAT

**Analog:** `ResponsiveTable.tsx` — replace the **raw `overflow-auto` div** (note: two-axis `auto`, not `overflow-x-auto`).

**BEFORE** (`CorrelationMatrix.tsx:172-219`):
```tsx
<div className="flex flex-col gap-3" data-testid="correlation-matrix">
  <div className="overflow-auto">
    <table className="w-full border-collapse text-center" style={{ fontSize: 11 }}>
      {/* header <th> truncate maxWidth:80 title={n} #4A5568 (:179-186);
          row-label <td> truncate maxWidth:80 #4A5568 (:193-198);
          corr-cell <td> data-testid="corr-cell" inline backgroundColor (:200-214) */}
    </table>
  </div>
</div>
```
**AFTER** (replace the inner `overflow-auto` div ONLY — keep the outer `data-testid="correlation-matrix"` flex wrapper):
```tsx
<div className="flex flex-col gap-3" data-testid="correlation-matrix">
  <ResponsiveTable>
    <table className="w-full border-collapse text-center" style={{ fontSize: 11 }}>
      {/* unchanged — every inline style hex preserved verbatim */}
    </table>
  </ResponsiveTable>
</div>
```
- **RESEARCH Pitfall 4 (load-bearing):** `ResponsiveTable` is `overflow-x-auto` (one-axis). The matrix's vertical scroll now comes from the PAGE; horizontal from the region. This is the intended behavior — but **confirm the N×N matrix still scrolls wide N at 320px after the swap**.
- **Rule 3 — surgical:** do NOT "tidy" the pre-existing raw inline hex `#4A5568` (:182,:195) / `#64748B` (:164,:224,:233) into tokens. They are a known non-token site; preserve verbatim.
- **Preserve:** `data-testid="correlation-matrix"` (:172), `data-testid="corr-cell"` (:204), the `truncate … title={n}` LABELS (:181-183) — label ellipsis is NOT a column drop; the guard polices presence, not ellipsis.
- The empty branch (`CorrelationMatrix.tsx:160-168`, `"No correlation data available"` with `style={{ color: "#64748B" }}`) is a degenerate-state anchor candidate for the REFLOW-03 sweep.

---

### Admin tables — `ComputeJobsTable.tsx` (+ siblings, opportunistic)

**Analog:** `ResponsiveTable.tsx`. `ComputeJobsTable.tsx:195-196` is already a raw `<div className="overflow-x-auto"><table className="w-full text-sm">` — migrate to the primitive exactly like `ScenarioCompareTable`. Admin tables are **scroll-wrap only, no all-columns guard** (CONTEXT §1c). Other admin tables (`csv-status`, `usage`, `compute-jobs`, `deletion-requests`, `intros`, `users`) follow the same one-line swap; opportunistic per CONTEXT §Claude's Discretion.

---

### Wizard de-block — `wizard/page.tsx` (route, RSC)

**Analog:** self — remove the `<DesktopGate>` wrapper, preserve the `<Suspense key={source}>` boundary verbatim.

**Remove the import** (`page.tsx:5`): `import { DesktopGate } from "./DesktopGate";`

**BEFORE** (`page.tsx:91-123` — the `<DesktopGate>` wraps the Suspense subtree; the large comment block at :93-118 documents WHY the boundary is load-bearing):
```tsx
return (
  <DesktopGate>
    {/* …Suspense-boundary comment, KEEP it with the Suspense… */}
    <Suspense key={source} fallback={null}>
      <WizardClient key={source} initialDraft={initialDraft} />
    </Suspense>
  </DesktopGate>
);
```
**AFTER** (drop the `<DesktopGate>` wrapper; the `<Suspense key={source} fallback={null}>` + `key={source}` on WizardClient are LOAD-BEARING — preserve verbatim):
```tsx
return (
  <Suspense key={source} fallback={null}>
    <WizardClient key={source} initialDraft={initialDraft} />
  </Suspense>
);
```
- **DO NOT TOUCH** the auth gate above the boundary: `const { data: { user } } = await supabase.auth.getUser();` + `if (!user) redirect("/login?next=/strategies/new/wizard");` (`page.tsx:67-72`). RESEARCH Security Domain: this is the only must-not-regress (Elevation of Privilege). The de-block removes a viewport branch, never the auth check.
- The big comment at `page.tsx:93-118` explains the CSR-bailout fix — keep it attached to the Suspense (re-anchor it under the new top-level `Suspense`).

---

### Wizard de-block — DELETE `DesktopGate.tsx` + `DesktopGate.test.tsx`

**`DesktopGate.tsx`** (full file, 115 lines) — the dead client component. After de-block it renders `children` at all widths, so the entire file (matchMedia `MOBILE_QUERY = "(max-width: 639px)"` :14, `isNarrow` two-pass :17/:23-34, email-capture branch :77-114, the `/api/for-quants-lead` POST :42-56 with `wizard_session_id: "desktop-gate"` :53) becomes dead. **DELETE.**

**`DesktopGate.test.tsx`** (153 lines) — its subject is gone. **DELETE.** ⚠️ **Coverage caveat (RESEARCH Pitfall 3 / Assumption A3 = MEDIUM):** this is a coverage-bearing file. Deleting `DesktopGate.tsx` (a `"use client"` component with matchMedia/state branches) + its test shifts both numerator and denominator of the `frontend-coverage` gate (lines 82 / stmts 80 / fns 74 / branches 72). **Run `npm run test:coverage` after the de-block + the new guard tests** and confirm all four metrics clear. Never lower a threshold or blanket-update a snapshot.

- The `/api/for-quants-lead` route **STAYS** (other callers). Only the wizard's `wizard_session_id: "desktop-gate"` POST goes away. The DELETED copy strings (`"Continue on desktop"`, `"Send me a resume link"`, etc.) must NOT be relocated.

---

### Wizard layout reflow — `WizardClient.tsx` + `steps/*` (component, CSS-first)

**Analog:** the project's existing Tailwind v4 responsive pattern (NO new breakpoint, NO new matchMedia). UI-SPEC §2 + RESEARCH Pattern 3:
- Multi-column step grids → `grid-cols-1 sm:grid-cols-2` (or `-3`) — collapse to 1 col below `sm` (640px).
- Broker-selector grid (3-col) → `grid-cols-1 sm:grid-cols-3`; each broker card keeps its white surface / 1px `#E2E8F0` border / 8px radius / `border-accent bg-accent/5` active state verbatim.
- Inputs `w-full` at `<sm`. Step nav/footer Back/Next/Submit ≥44px, no page overflow.
- Preserve `aria-current="step"`, step-transition focus management, `role="alert"`/`role="status"` live regions, Tab/Shift+Tab DOM order (DESIGN.md §9-State Matrix). Reflow is layout-only.

---

### All-columns guard (NEW render test) — the SC#2 fail-loud contract

**Analogs (3, compose them):**
1. **Render setup** → `HoldingsTable.strategy-rows.test.tsx:1-70` — the proven `render(<HoldingsTable …/>)` + `next/navigation` mock + `next/link → plain anchor` mock + minimal payload fixture. This is the exact harness to render each of the 3 holdings tables with fixture rows in jsdom.

   The `next/navigation` mock (`HoldingsTable.strategy-rows.test.tsx:31-42`) is REQUIRED because `HoldingsTable` imports `useRouter`/`useSearchParams` at module scope:
   ```tsx
   vi.mock("next/navigation", () => ({
     useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
     usePathname: () => "/allocations",
     useSearchParams: () => new URLSearchParams(),
   }));
   ```

2. **Exact-set pinning assertion style** → `MobileNav.test.tsx:82-103` (`expect(hrefs).toEqual([...])` + `not.toContain` for deliberate drops). Mirror this to assert the EXACT `<th>` label set + count, and that no material `<th>` is `hidden`.

3. **Falsifiability + source-scan option** → `viewport-zoom-meta.test.ts:97-114` (the "FORBIDDEN patterns still match" anti-typo test). The guard MUST be falsifiable: **verify it fails when a column is deleted, then restore** (CLAUDE.md Rule 12). This file is also the precedent for a Vitest **source-scan** guard (`readFileSync` walk, zero ci.yml/seed edits) if a render test is not chosen — but RESEARCH recommends a render test (catches runtime drops + adds branch coverage).

**The material `<th>` sets the guard asserts (VERBATIM from code — anchor here, NOT the spec labels):**

| Component | Constant (code) | Count | Material `<th>` set (verbatim labels) | Source lines |
|-----------|-----------------|-------|----------------------------------------|--------------|
| `LegacyHoldingsTable` | `TOTAL_COLUMNS = 7` (`:378`) | 7 | `Venue / Symbol` · `Type` · `Quantity` · `Entry price` · `Value (USD)` · `Unrealized P&L` · *(Notes icon: `<th className="w-10 px-2 py-2" aria-label="Notes" />`)* | `HoldingsTable.tsx:402-410` |
| `DesignHoldingsTable` | `DESIGN_TOTAL_COLUMNS = 9` (`:551`) | 9 | *(Status: `<th className="w-3 px-2 py-2" aria-label="Status" />`)* · `Strategy` · `Symbol` · `Weight` · `Allocation` · `MTD` · `Sharpe` · `Max DD` · `Age` | `HoldingsTable.tsx:622-672` |
| `ScenarioCompareTable` | (no const) | `Metric` axis + N scenario cols | the `Metric` `<th>` (:189) + every `data-testid="scenario-col-{name}"` (:195) + every `METRICS` row | `ScenarioCompareTable.tsx:189-200` |
| `CorrelationMatrix` | (no const) | N×N symmetric | header `<th>` count === row-label `<td>` count === `names.length` (N); every name as BOTH a `<th>` (:179) and a row-label `<td>` (:194) | `CorrelationMatrix.tsx:177-198` |

- The 7th `LegacyHoldingsTable` column (Notes, `:410`) has NO text label — assert by column count / the named material set (`Venue / Symbol` → `Unrealized P&L`), not a "Notes" text. Same for `DesignHoldingsTable`'s Status icon `<th aria-label="Status">` (:623).
- `StrategyRowsTable` (8 cols, `HoldingsTable.tsx:263-270`, `data-strategy-row={row.id}` :278) and `OpenPositionsTable` get NO guard (CONTEXT §1 — guard is highest-stakes only).
- **Existing render-test files to NOT duplicate:** `HoldingsTable.test.tsx`, `.sub-row.test.tsx`, `.strategy-rows.test.tsx`, `.banner-dismiss.test.tsx`, `ScenarioCompareTable.test.tsx`, `CorrelationMatrix.boundary.test.tsx` already exist — add the all-columns guard as a NEW focused test, do not bloat these.

---

### Reflow sweep — public unseeded spec (NEW or extend `reflow.spec.ts`)

**Analogs:** `e2e/reflow.spec.ts` (unseeded precedent, full file 46 lines) + `e2e/helpers/reflow.ts` (`assertNoReflow`).

**The helper to reuse verbatim** (`e2e/helpers/reflow.ts:47-105`) — `assertNoReflow(page, anchorSelector)`:
- Asserts `document.documentElement.scrollWidth - clientWidth <= 1` at the CURRENT viewport (set 320px in the spec first).
- **Fail-loud guard** (`:52-55`): the anchor must be VISIBLE first — a blank/404/unhydrated page fails loud, never false-greens. **Anchor on a visible CONTENT element per route, never generic chrome** (Pitfall 5).
- `MIN_TARGET_PX = 44` (`:27`) — never lowered.

**The spec shape to mirror** (`e2e/reflow.spec.ts:24-46`): set viewport 320×800, `page.goto`, early-throw on `status() >= 400`, then `assertNoReflow(page, anchor)`. Parametrize over a curated `PUBLIC_ROUTES` list (RESEARCH Code Examples):
```ts
const PUBLIC_ROUTES: { path: string; anchor: string }[] = [
  { path: "/security", anchor: "main h1" },
  { path: "/for-quants", anchor: "main h1" },
  { path: "/demo", anchor: "main h1" },
  // … landing, public factsheet/share, /discovery public surface (executor discretion)
];
```
- **NO `HAS_SEED_ENV` guard** on the public spec (matches `reflow.spec.ts` — unseeded). FLOW-01 place 2 for an unseeded spec is the *absence* of any env guard.

---

### Reflow sweep — seeded authed spec (NEW)

**Analog:** `e2e/mobile-drawer-keyboard.spec.ts` (the seeded precedent, full pattern at `:43-70`).

**FLOW-01 place 2 — the self-skip guard** (`mobile-drawer-keyboard.spec.ts:48-50`, then `test.skip` at `:67`):
```ts
const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

test.describe("reflow sweep @ 320px — authed", () => {
  test.skip(!HAS_SEED_ENV, "seed env not wired — prevents false-green on login/404 (W-02)");
  // …
});
```
**Seed + login helpers** (`mobile-drawer-keyboard.spec.ts:44`, `:52-64`): `import { seedTestAllocator } from "./helpers/seed-test-project";` + the `loginViaForm(page, email, password)` form-fill that waits on `/\/(discovery|strategies|allocations|dashboard)/`. `seedTestAllocator()` stamps a VERIFIED allocator profile so `/allocations` renders real chrome instead of redirecting.

**Authed route floor** (RESEARCH §All-Route Sweep, executor discretion within): `/allocations` (+ tabs Overview/Holdings/Outcomes/Mandate/Risk/Scenario), composer, factsheets, Bridge, Risk, Discovery, single-strategy, `/strategies/new/wizard`, `/portfolios`, `/security`, admin. Each `assertNoReflow(page, <visible content anchor>)` at 320px.

**≥1 degenerate-state route (REFLOW-03):** anchor on a VISIBLE honest-empty DOM node — e.g. `CorrelationMatrix`'s `"No correlation data available"` empty branch (`CorrelationMatrix.tsx:166`), or an `EmptyStateCard` heading, or `data-testid="correlation-matrix"`. NOT generic chrome (Pitfall 5 — a too-generic anchor false-greens against a login page).

---

### FLOW-01 dual-wiring — `ci.yml`

**Analog:** self. Both places MUST be wired or the gate silently never runs (twice-burned trap).

**Place 1a — unseeded list** (`ci.yml:1059`, append the public sweep spec to this exact line):
```
npx playwright test e2e/auth.spec.ts e2e/smoke.spec.ts e2e/demo-public.spec.ts e2e/demo-founder-view.spec.ts e2e/onboarding-banner-smoke.spec.ts e2e/demo-screenshot.spec.ts e2e/reflow.spec.ts e2e/target-size.spec.ts
```
→ add `e2e/reflow-sweep.spec.ts` (or whatever the public sweep filename is) to the end.

**Place 1b — seeded MA-8 list** (`ci.yml:1252-1263`, gated `if: ${{ vars.E2E_TEST_DB_CONFIGURED == 'true' }}`):
```
npx playwright test \
  e2e/onboarding-funnel.spec.ts \
  … \
  e2e/composer-axe.spec.ts \
  e2e/mobile-drawer-keyboard.spec.ts \
  --timeout 60000
```
→ add the authed sweep spec (e.g. `e2e/reflow-sweep-authed.spec.ts \`) to this `\`-continued list. The in-file comment at `ci.yml:1250-1251` ("Adding/removing a seed-gated spec? Update both this list and the e2e/<spec>.spec.ts HAS_SEED_ENV constant") is the canonical reminder.

**Place 2** = each spec's own guard (unseeded = no env guard; seeded = `HAS_SEED_ENV` `test.skip`, above). Verify in the CI run summary that the new specs show **passed, not skipped** ("proven to execute" is the must-have).

## Shared Patterns

### The `ResponsiveTable` wrap (the entire Table Reshape job)
**Source:** `src/components/ResponsiveTable.tsx:23-36`
**Apply to:** all 6 financial tables + admin tables. One import, wrap the `<table>` (or replace the raw scroll `<div>`), restyle nothing, no duplicate sr-only node.
```tsx
import { ResponsiveTable } from "@/components/ResponsiveTable";
<ResponsiveTable>
  <table className="w-full text-sm">{/* unchanged */}</table>
</ResponsiveTable>
```

### Fail-loud reflow assertion
**Source:** `e2e/helpers/reflow.ts:47-105` (`assertNoReflow`)
**Apply to:** every route in both sweep specs. Always anchor on a VISIBLE content element (never chrome) so blank/404/unhydrated fails loud (`:52-55`). `scrollWidth - clientWidth <= 1` at 320px (`:69-70`).

### FLOW-01 dual-wiring (twice-burned)
**Source:** `e2e/reflow.spec.ts` header (unseeded) + `e2e/mobile-drawer-keyboard.spec.ts:35-41,48-50` (seeded) + `ci.yml:1059` / `:1252-1263`
**Apply to:** both new e2e specs. Place 1 = ci.yml list; place 2 = the spec's env guard (or its deliberate absence). Verify "passed, not skipped".

### Coverage ratchet must hold
**Source:** CLAUDE.md gate (lines 82 / stmts 80 / fns 74 / branches 72) + RESEARCH Pitfall 3 / Assumption A3
**Apply to:** after deleting `DesktopGate.tsx`+`.test.tsx` AND after adding guard tests — run `npm run test:coverage`, confirm all four clear. Never lower a threshold.

### Preserve, don't tidy (Rule 3)
**Apply to:** `CorrelationMatrix` inline hex `#4A5568`/`#64748B` (verbatim); `wizard/page.tsx` `<Suspense key={source}>` boundary + auth gate (verbatim); every table `data-testid` (winner/scenario-col/cell/corr-cell/correlation-matrix/data-strategy-row/data-row-id).

## No Analog Found

None. Every target file has a direct in-repo analog (the value of this phase being the deliberate phase-44/45 primitive build-out). The two MEDIUM-risk items are not "no analog" but "verify the measured outcome":

| Item | Why flagged | Action |
|------|-------------|--------|
| Coverage net after `DesktopGate` deletion | RESEARCH Assumption A3 = MEDIUM (hard gate; net depends on measured numbers) | Run `npm run test:coverage` — measure, do not assume |
| CorrelationMatrix `overflow-auto`→`overflow-x-auto` | RESEARCH Pitfall 4 / A4 = LOW-MEDIUM (two-axis → one-axis) | Confirm N×N still scrolls wide at 320px after swap |

## Metadata

**Analog search scope:** `src/components/`, `src/app/(dashboard)/allocations/components/`, `…/allocations/widgets/risk/`, `…/strategies/new/wizard/`, `src/components/admin/`, `src/components/layout/`, `src/components/ui/`, `e2e/`, `e2e/helpers/`, `tests/visual/`, `.github/workflows/`
**Files scanned:** 13 analog files read in full or targeted (ResponsiveTable, HoldingsTable ×3 sections, OpenPositionsTable, ScenarioCompareTable, CorrelationMatrix, wizard/page.tsx, DesktopGate.tsx, DesktopGate.test.tsx, reflow.ts, reflow.spec.ts, mobile-drawer-keyboard.spec.ts, MobileNav.test.tsx, viewport-zoom-meta.test.ts, HoldingsTable.strategy-rows.test.tsx, ComputeJobsTable.tsx, ci.yml)
**Pattern extraction date:** 2026-06-27

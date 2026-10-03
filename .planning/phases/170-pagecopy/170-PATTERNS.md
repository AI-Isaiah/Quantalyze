# Phase 170: LAYOUT - Pattern Map

**Mapped:** 2026-09-27
**HEAD read:** `8763ec7be` (worktree branch `feat/170-layout`). `git diff 8eafe1057 HEAD -- src e2e` is empty per UI-SPEC, so the research anchors still hold.
**Files analyzed:** 34 new or modified files (27 source/test + 7 post-169)
**Analogs found:** 31 / 34 (3 have no in-repo precedent; see "No Analog Found")
**Tracked-source gate:** every analog path below was checked with `git ls-files` (45/45 tracked). None is a gitignored mirror.

Cite by symbol. Line numbers are hints taken at `8763ec7be` and will drift.

> ⚠️ **Post-169 files.** `origin/feat/169-pagetruth` is NOT an ancestor of `origin/main` (measured: `merge-base --is-ancestor` exit 1). The excerpts for `FactsheetView.tsx`, `MetricsColumn.tsx` and `DESIGN.md` are **pre-169 and are not copy-ready**. Re-read those files after 169 merges and before planning T-F.

---

## Premise corrections found while mapping (read these first)

Grepping the analogs turned up five places where RESEARCH.md or UI-SPEC.md is wrong or incomplete. Each would otherwise produce a dead task or a surprise RED.

| # | Upstream claim | Measured at HEAD | What the planner should do |
|---|----------------|------------------|----------------------------|
| PC-1 | RESEARCH P1 and the UI-SPEC Scrollable Tab Strip row both say `Tabs.test.tsx` pins `"flex gap-1 border-b border-border"` and the pin must be updated | **No test pins it.** The string exists only at `src/components/ui/Tabs.tsx` (`TabsList`, underline arm) and in `src/app/(dashboard)/allocations/components/HoldingDetail.tsx` (a hand-rolled `role="tablist"`, `aria-label="Holding detail tabs"`). `Tabs.test.tsx` has only behaviour tests (role, aria-selected, roving tabindex, arrow/Home/End) | Drop the "update the pin" task. **Add** a new class pin that fails if `overflow-x-auto` or trigger `shrink-0` is removed, so the fix can go RED. Decide explicitly whether `HoldingDetail.tsx`'s strip is in scope: it is a fourth underline strip, not a `TabsList` consumer, so it does NOT inherit the fix |
| PC-2 | Neither doc names a footer test that breaks | `ScenarioFooter.test.tsx` **T_F8** asserts `region.style.position === "sticky"` and `region.style.bottom === "0px"` (inline style) | N-FOOT moves `FOOTER_STYLE` to classes, so T_F8 goes RED. Update it intentionally, with a dated comment, to assert the classes (`sticky`, `bottom-16`, `md:bottom-0`) |
| PC-3 | UI-SPEC C1-A3: the `data-panel` attributes "survive the closed state" | True for `toBeAttached`, **false for `toBeVisible`**. `e2e/composer-axe.spec.ts` (seeded, CI-wired) calls `scrollIntoViewIfNeeded()` + `toBeVisible()` on both `[data-panel="blend-returns-distribution"]` and `[data-panel="blend-rolling"]` | C1-A3 turns the seeded axe spec RED. The C1-A3 plan must also edit `e2e/composer-axe.spec.ts`: open the `composer-blend-detail` section before those anchors, or switch to `toBeAttached()` and open the section before `analyze()` so axe still scans the bodies |
| PC-4 | RESEARCH Open Question 6: an admin seed may not exist, so M3's proof may be vitest-only | **An admin seed exists:** `seedTestAllocator({ role: "both", isAdmin: true })` in `e2e/helpers/seed-test-project.ts` (the `isAdmin` opt stamps `profiles.is_admin = TRUE`). It is used in `e2e/full-flow.spec.ts` and inside `seedSfoxVerifiedStrategy` / `seedMt5VerifiedStrategy` | The `/admin/match` V390 e2e ("no visible write control") is seedable. Treat Q6 as resolved |
| PC-5 | UI-SPEC AD-13: migrate `getByText(name)` to `getByRole("link", { name })` | `page.key-pill.test.tsx` `noteOf()` finds the row by `[...container.querySelectorAll("a")].find((a) => a.textContent === strategyName)`, not by `getByText` | Per-word `whitespace-nowrap` spans keep `noteOf` green **only if** the separating spaces survive as text nodes (spans joined by literal `" "` children, e.g. `words.flatMap((w, i) => i ? [" ", <span…>{w}</span>] : [<span…>{w}</span>])`). Adjacent spans with no space children change `textContent` and silently break every `noteOf` assertion |

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `e2e/helpers/reflow.ts` (T0) | test utility | transform (DOM measure) | itself (`assertNoReflow`) + `e2e/no-clip-sweep.spec.ts` walker | exact (self-extension) |
| `e2e/reflow-sweep-authed.spec.ts` (T0, viewport raise) | test (e2e, seeded) | request-response | itself | exact |
| `e2e/layout-narrow.spec.ts` (T0, NEW) | test (e2e, seeded) | request-response + geometry | `e2e/composer-axe.spec.ts` (seed + drive to composed) + `e2e/reflow-sweep-authed.spec.ts` (route table) + `e2e/target-size.spec.ts` (`boundingBox`) | role-match (composite) |
| `e2e/reflow.spec.ts` (T0 helper self-test case) | test (e2e, unseeded) | request-response | itself | partial: no fixture idiom exists |
| `.github/workflows/ci.yml` (FLOW-01 place 1) | config | batch | the `e2e-seeded` `npx playwright test` list | exact |
| `src/app/(dashboard)/allocations/AllocationsTabs.tsx` (A1, AD-05 mount) | component | event-driven (UI) | itself (NAV-02 tablist) | exact |
| `src/app/(dashboard)/allocations/components/TweaksToggle.tsx` | component | event-driven | Export button in `AllocationsTabs.tsx` | exact (class list is prescribed) |
| `src/app/(dashboard)/allocations/components/Tweaks.tsx` | component (overlay) | event-driven | itself (inline style → classes) | exact |
| `src/app/(dashboard)/allocations/components/Tweaks.test.tsx` | test | — | itself | exact |
| `src/app/(dashboard)/allocations/components/ScenarioFooter.tsx` | component | request-response (props) | itself + `AllocationsTabs.tsx` action row | exact |
| `src/app/(dashboard)/allocations/components/ScenarioFooter.test.tsx` | test | — | itself (T_F1, T_F8) | exact |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (S1, C1-A1..A3) | component | transform | `ResponsiveTable` consumers; composer's own `CollapsibleSection` "Strategies & weights" | exact |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` | test | — | itself | exact |
| `e2e/composer-axe.spec.ts` (PC-3 collision) | test (e2e, seeded) | request-response | itself | exact |
| `src/components/kpi/KpiPanel.tsx` (opt-in `variant="panel"`) | component (primitive) | transform | itself | exact |
| `src/app/(dashboard)/allocations/components/KpiStrip.tsx` (passes `variant`) | component | transform | itself (sole `KpiPanel` caller besides `PortfolioKpiPanel`) | exact |
| `src/components/ui/Tabs.tsx` (P1) | component (primitive) | event-driven | NAV-02 tablist classes in `AllocationsTabs.tsx` | role-match |
| `src/components/ui/Tabs.test.tsx` | test | — | itself | exact (see PC-1) |
| `src/components/exchanges/AllocatorExchangeManager.tsx` (P2) | component | CRUD (UI) | itself; `ScenarioFooter` action-group pattern | exact |
| `src/app/(dashboard)/strategies/page.tsx` (R1, (l)) | page (server) | CRUD read | itself | exact |
| `src/components/strategy/ShareableLink.tsx` (`size` prop) | component | request-response | its own optional `variant` prop | exact |
| `src/components/strategy/StrategyTable.tsx` (T1 `isolate`, K1 chip, (l) tags) | component | transform | itself | exact |
| `src/components/strategy/StrategyFilters.tsx` (T1 `top-12`) | component | event-driven | itself | exact |
| `src/app/(dashboard)/allocations/components/CoverageStateChip.tsx` (K1) | component | transform | itself | exact |
| `tests/a11y/chip-contrast.test.ts` (NEW) | test (unit, node) | file-I/O (reads source) | `tests/a11y/palette-contrast.test.ts` | exact |
| `src/components/admin/AllocatorMatchQueue.tsx` (M3) | component | event-driven + CRUD | itself (`guard`, `isLg`) | exact |
| `src/components/admin/AllocatorMatchQueue.test.tsx` | test | — | its own `matchMedia` stub | exact |
| `src/components/admin/AdminTabs.tsx` (M1, M2) | component | CRUD read | itself | exact |
| `src/app/(dashboard)/admin/page.tsx` (M1 embed) | page (server) | CRUD read | its own profiles select | exact |
| `src/app/(marketing)/layout.tsx` (H1) | layout (server) | request-response | `src/app/(marketing)/page.tsx` session read | exact |
| `src/components/marketing/MarketingHeaderActions.tsx` (NEW, name at planner's choice) | component (async server) | request-response | `(marketing)/page.tsx` `Home` + the layout's link classes | exact |
| `src/lib/routing/default-route.ts` (NEW) | utility (constant) | — | `DEFAULT_AUTHENTICATED_ROUTE` in `src/proxy.ts`; data-only style of `src/lib/routing/route-contract-manifest.ts` | exact |
| `src/app/(dashboard)/compare/page.tsx` (H2, one-id note) | page (server) | CRUD read | itself (empty-state branch) | exact |
| Post-169: `src/app/factsheet/[id]/v2/FactsheetView.tsx` (N-KPI, C1-F1..F3), `FactsheetView.kpistrip.test.tsx`, `MetricsColumn.tsx` (MTD), `DESIGN.md` rows | component / test / docs | transform | `KpiPanel` container ladder; existing ControlBar classes | role-match, **re-read after 169** |

---

## Pattern Assignments

### `e2e/helpers/reflow.ts` (test utility, DOM measurement) — Wave 0

**Analog:** itself, `assertNoReflow`. Extend it; do not add a second helper.

**Keep verbatim, the fail-loud anchor + settle + retry frame** (`assertNoReflow`, ~lines 47-104):
```typescript
await expect(
  page.locator(anchorSelector).first(),
  `reflow anchor "${anchorSelector}" not visible — blank/404/unhydrated page would otherwise false-green`,
).toBeVisible({ timeout: 10_000 });
await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
await expect(async () => {
  const o = await page.evaluate(() => { /* measure */ });
  if (!o.ok) throw new Error(`reflow: scrollWidth=… clientWidth=… offender=…`);
}).toPass({ timeout: 10_000, intervals: [200, 500, 1000, 2000] });
```

**The line that makes it blind** (inside `page.evaluate`, ~67-69), to replace:
```typescript
const doc = document.documentElement;
const slop = doc.scrollWidth - doc.clientWidth;
if (slop <= 1) return { ok: true as const };
```
Replace with the RESEARCH "Code Examples" sketch: measure `document.getElementById("main-content")` as well, take the max slop, and report WHICH scroller overflowed in the error string (`main=… doc=…`) so the CI breadcrumb names it.

**Offender naming to keep** (~79-84), the `TAG#id.class1.class2` breadcrumb:
```typescript
const idPart = el.id ? `#${el.id}` : "";
const classPart =
  typeof el.className === "string" && el.className
    ? `.${el.className.split(" ").filter(Boolean).slice(0, 2).join(".")}`
    : "";
offender = `${el.tagName}${idPart}${classPart}`;
```

**Per-element style probe to borrow for the scroll-ancestor skip** (partial analog, `e2e/no-clip-sweep.spec.ts`, the clip-probe walker ~65-90):
```typescript
for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) continue; // hidden — skip
  const cs = getComputedStyle(el);
  const overflowed = el.scrollWidth > el.clientWidth + 1;
```
No existing walker climbs ancestors. The new skip rule (skip an element whose nearest `overflow-x: auto|scroll` ancestor, other than the scroller, fits inside the scroller) is new code. Keep the `<= 1` px slop and the measured-count sentinel idea (`__NO_ELEMENTS_MEASURED__`) from `no-clip-sweep`.

`assertTargetSizes` in the same file is untouched.

---

### `e2e/reflow-sweep-authed.spec.ts` (e2e seeded) — Wave 0 viewport raise

**Analog:** itself. The per-route loop (~131-145) and the degenerate case (~152-163) hard-code 320:
```typescript
test(`${r.label} — no horizontal overflow at 320px`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
```
Change it to a `VIEWPORTS` table of `{390×844, 640×400, 960×540}` (UI-SPEC V390/V640/V960) and nest the loop. Update the header comment (lines 1-44 say "320px (= 400% zoom)"). Record the founder decision (2026-09-27) as the dated reason. The 2560 ultra-wide describe and the rotate-stability describe stay as they are.

Add the H1 assertion to the existing `/security` row: `Go to app` visible, `Sign in` absent. The seeded user is `role: "both"`, so it is signed in.

FLOW-01 is already satisfied for this file (it is in the ci.yml seeded list and carries `HAS_SEED_ENV`).

---

### `e2e/layout-narrow.spec.ts` (NEW, e2e seeded) — Wave 0

**Analogs:** `e2e/composer-axe.spec.ts` (seed and drive into composed mode), `e2e/reflow-sweep-authed.spec.ts` (route table + login), `e2e/target-size.spec.ts` (`boundingBox` geometry).

**Imports + seed gate + login** (copy from `composer-axe.spec.ts` ~47-71):
```typescript
import { test, expect } from "@playwright/test";
import {
  cleanupStrategiesByNamePrefix,
  seedTestAllocator,
  seedStrategyWithHistory,
} from "./helpers/seed-test-project";
import { assertNoReflow } from "./helpers/reflow";

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

async function loginViaForm(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[name="email"], input[placeholder*="email" i]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(discovery|strategies|allocations|dashboard)/, { timeout: 10000 });
}
```

**Composed-scenario seeding idiom** (`composer-axe.spec.ts` ~96-165). Copy it whole, including the unique-per-run `"0 …"` name prefix, the `cleanupStrategiesByNamePrefix` GC, `codename: fixtureName`, `withDailyReturns: true`, the id-targeted `[data-testid="browse-add-${fixtureId}"]` click, and the explicit `[aria-label="Close drawer"]`:
```typescript
await cleanupStrategiesByNamePrefix("0 Composer Axe Fixture");
const fixtureName = `0 Composer Axe Fixture ${Math.random().toString(36).slice(2, 8)}`;
const fixtureId = await seedStrategyWithHistory({
  days: 400, name: fixtureName, codename: fixtureName, withDailyReturns: true,
});
…
await page.click('button:has-text("Browse strategies")');
await page.fill('input[placeholder="Search by name or codename"]', fixtureName);
const fixtureAdd = page.locator(`[data-testid="browse-add-${fixtureId}"]`);
await expect(fixtureAdd).toBeVisible({ timeout: 10_000 });
await fixtureAdd.click();
await page.click('[aria-label="Close drawer"]');
await expect(page.locator("h2", { hasText: "Portfolio" }).first()).toBeVisible({ timeout: 10_000 });
```
Use this spec's own name prefix (for example `"0 Layout Narrow Fixture"`), per worker if the spec creates rows in more than one test (`e2e/my-strategies.spec.ts` `NAME_PREFIX` uses `process.env.TEST_PARALLEL_INDEX` for the WR-11 race).

**Geometry assertion shape** (`e2e/target-size.spec.ts` ~289-292):
```typescript
const box = await rebuilding.boundingBox();
expect(box, "rebuilding panel has no layout box").not.toBeNull();
expect(box!.x, "… starts left of the 320px viewport").toBeGreaterThanOrEqual(0);
expect(box!.x + box!.width, "… overflows the 320px viewport").toBeLessThanOrEqual(320);
```
Build the Tweaks-vs-nav and footer-vs-nav checks from two `boundingBox()` rects (nav selector `nav[aria-label="Primary mobile"]`, from `MobileNav.tsx`). There is no `elementFromPoint` use anywhere in `e2e/` today (grep: 0 hits), so the "not covered" check (UI-SPEC N-FOOT (3), N-TABLE, N-PROFILE) is new code: `page.evaluate` + `document.elementFromPoint(cx, cy)` + `el.contains(hit)`.

**Admin route:** seed `seedTestAllocator({ role: "both", isAdmin: true })` (PC-4).

**FLOW-01 two-place wiring:** place 2 is the `HAS_SEED_ENV` `test.skip` above. Place 1 is the ci.yml list (next section). Without both, the gate runs nowhere.

---

### `.github/workflows/ci.yml` (config) — FLOW-01 place 1

**Analog:** the `e2e-seeded` `npx playwright test \` list (hint: around line 6750, the block that lists `e2e/composer-axe.spec.ts \` … `e2e/reflow-sweep-authed.spec.ts \` … `e2e/my-strategies.spec.ts \` then `--timeout 60000`). Add `e2e/layout-narrow.spec.ts \` in that list. Cite it by the listed neighbours, never by line number. If a helper self-test case lands in `e2e/reflow.spec.ts`, it is already in the UNSEEDED list (the `e2e/auth.spec.ts e2e/smoke.spec.ts … e2e/reflow.spec.ts …` line), so no change is needed there.

---

### `src/app/(dashboard)/allocations/AllocationsTabs.tsx` (component) — A1 tab bar + AD-05 Tweaks mount

**Analog:** itself. This file is the source of the shared Scrollable Tab Strip pattern.

**Wrapper that causes (a)** (`AllocationsTabs`, after the `data-allocator-tabstrip` div, ~812):
```tsx
<div className="ml-auto flex items-center gap-1">
```
→ UI-SPEC: `ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1 sm:flex-nowrap`.

**Tablist, SAME element, SAME direct `role="tab"` children (JOURNEY-03)** (~829-833):
```tsx
<div
  role="tablist"
  aria-label="Allocation surfaces"
  className="flex flex-nowrap items-center gap-1 overflow-x-auto sm:flex-wrap sm:overflow-x-visible snap-x [scrollbar-width:none] [-webkit-overflow-scrolling:touch]"
>
```
→ add `min-w-0 basis-full sm:basis-auto` only. Tabs keep `` `${isActive ? TAB_BUTTON_ACTIVE : TAB_BUTTON_INACTIVE} snap-start shrink-0` ``. The `TAB_BUTTON_*` consts are parity-pinned; append classes at the call site, never inside the consts (the NAV-02 comment explains why).

**Separator** (~878): `<span aria-hidden className="mx-2 h-4 w-px bg-border" />` → add `hidden sm:inline-block`.

**Export button: the class list the inline Tweaks toggle copies** (~903):
```tsx
className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
```
Export, the new inline Tweaks toggle and `+ Allocation` each get `shrink-0`.

**Active-tab scroll (no change):** the `useEffect` keyed on `[activeTab]` calls `computeTabStripScroll` and `strip.scrollTo(target)`, horizontally only. The `Tabs.tsx` change should copy this idiom rather than `scrollIntoView({ block: "nearest" })`. The comment above the effect records that `scrollIntoView` moved the page vertically and was removed for that reason. **This contradicts the UI-SPEC Scrollable Tab Strip bullet** ("`Tabs.tsx` calls `scrollIntoView({ inline: "nearest", block: "nearest" })`"). `block: "nearest"` can still scroll `#main-content` vertically. Prefer the `computeTabStripScroll` idiom, which is newer and tested (`AllocationsTabs.tabstrip-scroll.test.ts`), and flag the UI-SPEC line (Rule 7).

**The only Tweaks mount to remove** (~1029-1030, after the tab panels):
```tsx
<TweaksToggle />
<Tweaks />
```
Move `<TweaksToggle />` into the action row between Export and `+ Allocation`. `<Tweaks />` (the fixed panel) can stay mounted where it is. Grep confirmed these are the only mounts in `src/`.

---

### `src/app/(dashboard)/allocations/components/TweaksToggle.tsx` and `Tweaks.tsx` (component) — N-TWEAKS

**Analog:** the Export button class list above (toggle), and `Tweaks.tsx`'s own inline style (panel).

**Toggle today** (`TweaksToggle`, ~26-66): the whole `style={{ position: "fixed", bottom: 20, right: 20, zIndex: 49, … }}` object goes. Keep `data-tweaks-toggle` (`Tweaks.tsx`'s outside-click guard reads `target?.closest("[data-tweaks-toggle]")`), `aria-pressed={panelOpen}`, `aria-label="Toggle tweaks panel"`, `<SparkleIcon />` and `<span>Tweaks</span>`. The pressed state today is inline: `border: 1px solid var(--color-accent)`, `color-mix(in srgb, var(--color-accent) 12%, var(--color-surface))`, `color: var(--color-accent)`. Express it with `aria-pressed:` variants (for example `aria-pressed:border-accent aria-pressed:bg-accent/12 aria-pressed:text-accent`, or the nearest existing token step), plus `pointer-coarse:min-h-[44px]`.

**Panel today** (`Tweaks`, ~53-72):
```tsx
style={{ position: "fixed", bottom: 20, right: 20, width: 300, maxHeight: "80vh", overflowY: "auto", …, zIndex: 50, padding: 16 }}
```
→ UI-SPEC classes `fixed z-50 right-4 left-4 bottom-20 max-h-[calc(100dvh-10rem)] overflow-y-auto sm:left-auto sm:w-[300px] md:right-5 md:bottom-5`. Keep the non-position style (background, border, radius, shadow, padding) either inline or as classes, but move position/size/offset into classes, because that is what makes the responsive offset expressible. Keep `role="dialog"` `aria-label="Tweaks"` and the Esc/outside-click effect unchanged.

**Test:** `Tweaks.test.tsx` references `data-tweaks-toggle`. Read it before editing.

---

### `src/app/(dashboard)/allocations/components/ScenarioFooter.tsx` (component) — N-FOOT (f)(g)(h)

**Analog:** itself.

**Style object to delete** (`FOOTER_STYLE`, ~78-89):
```typescript
const FOOTER_STYLE: CSSProperties = {
  position: "sticky", bottom: 0, height: 56,
  background: "var(--color-surface, #FFFFFF)",
  borderTop: "1px solid var(--color-border, #E2E8F0)",
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "0 16px", zIndex: 10,
};
```
→ classes `sticky bottom-16 md:bottom-0 z-10 min-h-[56px] flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 bg-surface border-t border-border`. Drop the `CSSProperties` import if nothing else uses it.

**Duplicate-string root cause (h)** (`countLabel` / `summaryText`, ~110-131):
```typescript
const countLabel = diffCount === 0 ? "No changes yet" : …;
const summaryText = !hasDiffs ? "No changes yet" : …;
```
→ render the summary `<span>` only when `hasDiffs`. Update the comment that justified mirroring ("the summary slot mirrors it so the footer reads as a single status line at rest"). It is now the recorded defect.

**Keep:** `role="region"`, `aria-label="Scenario draft summary and actions"`, both `data-testid`s, the `aria-describedby` on commit-blocked, and the `Commit scenario` class `rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50` plus `min-h-[44px]`. The action group `flex items-center gap-3` → `ml-auto flex shrink-0 items-center gap-3`.

### `ScenarioFooter.test.tsx` (test)

- **T_F1** (~32-50): `expect(screen.getAllByText(/No changes yet/i).length).toBeGreaterThan(0)` tolerates the defect. Tighten it to `toHaveLength(1)`; that is RED at HEAD.
- **T_F8** (~209-229, PC-2): `expect(region.style.position).toBe("sticky"); expect(region.style.bottom).toBe("0px");` breaks. Re-pin it to `region.className` containing `sticky`, `bottom-16` and `md:bottom-0`, with a dated comment.
- The file header (lines 1-14) says `position: sticky; bottom: 0`. Update it.

---

### `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (component) — N-SCN (d) + C1-A1..A3

**Analog:** `ResponsiveTable` (import path `@/components/ResponsiveTable`; not imported by the composer today) and the composer's own `CollapsibleSection` usages. `CollapsibleSection` is already imported (`@/components/ui/CollapsibleSection`).

**Constituent list today** (`CompositionList`, ~7213-7214):
```tsx
<div className="rounded-lg border border-border bg-surface p-4">
  <ul className="grid gap-2" data-testid="scenario-constituent-list">
```
→ wrap the `ul` in `<ResponsiveTable label="Strategies and weights">` and add `min-w-max` to the `ul`. The `aria-hidden` header `li`s `scenario-perkey-header` and `scenario-added-header` stay inside the same `ul`, so the Pitfall-3 alignment holds by construction (same-width grid rows).

**`ResponsiveTable` contract** (`src/components/ResponsiveTable.tsx`, whole file 77 lines):
```tsx
<div
  ref={scrollRef}
  className={["overflow-x-auto",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
    className].filter(Boolean).join(" ")}
  role="region"
  aria-label={accessibleName}   // `${label}: ${DEFAULT_HINT}` when label is given
  tabIndex={0}
>
```
Note: the accessible name is `"Strategies and weights: Table scrolls horizontally. Swipe or use arrow keys to see more columns."`, not the bare label. A vitest or e2e name match needs a regex (`/^Strategies and weights/`). The "table" wording is the component's default hint. Passing `hint` overrides the whole name, if the planner wants wording for a list rather than a table (a 170.1-adjacent copy call; keep it minimal).

**C1-A1 panel rows** (today three separate `mt-6` blocks, ~5312-5429):
```tsx
{windowBounds && (<div className="mt-6"><BlendHeader metrics={scenarioMetrics} unionSpan={fullRangeWindow} /></div>)}
{windowBounds && (
  <div ref={coverageWindowControlRef} tabIndex={-1}
       className="mt-6 flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-4 py-3"
       data-testid="scenario-coverage-window">
{windowBounds && (<div className="mt-6"><CoverageTimeline rows={timelineRows} unionWindow={fullRangeWindow} activeWindow={coverageWindow} /></div>)}
<div className="mt-6"><KpiStrip mode="scenario" … /></div>
```
Keep `ref={coverageWindowControlRef}`, `tabIndex={-1}` and `data-testid="scenario-coverage-window"` on row 2 (RT-5 focus target).

**C1-A3 collapsible: copy the in-file precedent** (~6062-6067):
```tsx
<CollapsibleSection
  id="composer-composition-controls"
  title="Strategies & weights"
  defaultOpen
  storageKey="composer-collapse:controls"
>
```
→ `id="composer-blend-detail"`, `title="Blend distribution and rolling windows"`, `defaultOpen={false}`, `storageKey="composer-collapse:blend-detail"`, wrapping the two `<Card … data-panel="blend-returns-distribution">` / `data-panel="blend-rolling"` blocks (~5865, ~5915), with their `h2` changed to `h3`. `CollapsibleSection` props (`src/components/ui/CollapsibleSection.tsx`): `id, title, subtitle?, defaultOpen?, storageKey?, onToggle?, children`.

**⚠️ Cross-file consequence (PC-3):** `e2e/composer-axe.spec.ts` `toBeVisible()` on both `data-panel`s goes RED. Put that spec in the same plan's `files_modified`.

**Test pins:** grep `ScenarioComposer.test.tsx` for `scenario-constituent-list`, `scenario-perkey-header`, `scenario-added-header`, `blend-returns-distribution`, `blend-rolling`, `Returns distribution`, `Rolling metrics`, `scenario-coverage-window` before editing. `:10585`-ish `expect(chip.className).toContain("bg-track")` stays valid after K1.

**Sequencing:** N-SCN and C1-A1..A3 share this 8,074-line file. One plan, or sequential plans.

---

### `src/components/kpi/KpiPanel.tsx` + allocations `KpiStrip.tsx` (primitive) — C1-A2 opt-in `variant="panel"`

**Analog:** itself. Keep the two-element container rule from the file's own comment: the `@container` host and the `@sm`/`@lg` grid are SEPARATE elements.
```tsx
<div className="@container">
  <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2 @lg:grid-cols-4" role="group" aria-label={ariaLabel}>
    {cells.map(({ key, label, value, valueClassName, children }) => (
      <div key={key} className="rounded-lg border border-border bg-surface p-4">
```
Add `variant?: "cards" | "panel"` defaulting to `"cards"`, so the `"cards"` DOM stays byte-identical for `PortfolioKpiPanel` (`src/components/portfolio/PortfolioKpiPanel.tsx`, `<KpiPanel cells={cells} />`). `"panel"` = `grid grid-cols-2 @lg:grid-cols-4`, no gap, no radius, hairline cell borders, `px-4 py-3`. The only other caller is `src/app/(dashboard)/allocations/components/KpiStrip.tsx` (`return <KpiPanel cells={panelCells} ariaLabel="Portfolio KPIs" />`). It needs a pass-through prop so only `mode="scenario"` inside the composer opts in.

---

### `src/components/ui/Tabs.tsx` (primitive) — P1, shared Scrollable Tab Strip

**Analog:** the NAV-02 tablist in `AllocationsTabs.tsx` (above) and `TAB_BUTTON_ACTIVE`'s inset ring.

**Today** (`TabsList` / `TabsTrigger`):
```tsx
variant === "underline" ? "flex gap-1 border-b border-border" : "inline-flex overflow-hidden rounded border border-border",
…
"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
…
"-mb-px border-b-2 border-transparent px-4 py-2 text-text-muted",
```
**Inset ring to copy** (`AllocationsTabs.tsx` `TAB_BUTTON_ACTIVE`): `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent`.

Change the underline arm only (UI-SPEC: list `flex gap-1 overflow-x-auto [scrollbar-width:none] shadow-[inset_0_-1px_0_var(--color-border)]`; trigger drops `-mb-px`, adds `shrink-0 whitespace-nowrap`, ring becomes inset). **The segmented arm (`WatchlistTabs`) must stay byte-identical**: the inset ring edit lives in the shared base string, so scope it to the underline arm or accept it for both deliberately. Consumers: `src/components/auth/ProfileTabs.tsx` and `src/components/admin/AdminTabs.tsx` (`<TabsList variant="underline" className="mb-6">`), plus `WatchlistTabs` (segmented).

**Active-tab scroll:** Radix owns selection. Add a scroll effect only if needed, and copy the `computeTabStripScroll` horizontal-only idiom (see the AllocationsTabs note on `scrollIntoView`).

**Test (PC-1):** `Tabs.test.tsx` has no class pin today. Add one (for example, render underline and assert the tablist className contains `overflow-x-auto` and a trigger contains `shrink-0` and `ring-inset`) so the fix can be neutered to RED.

---

### `src/components/exchanges/AllocatorExchangeManager.tsx` (component) — P2 key card

**Analog:** itself. Two identical containers need the same edit: active keys (~909/919) and disconnected keys (~1010/1020, which adds `opacity-75`).
```tsx
<div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
  …
  <div key={key.id} className="flex items-center gap-4 bg-surface px-4 py-3">
    <div className="flex h-10 w-10 …">{tag.label}</div>          // avatar
    <div className="flex-1 min-w-0"> … </div>                     // label
    <div className="text-right"> Last sync … </div>
    <AllocatorSyncStatus … />
    <Button variant="primary" …>Sync now</Button>
    {key.exchange === "mt5" && (<Button variant="secondary" …>Update password</Button>)}
    <Button variant="secondary" aria-label={`Disconnect ${key.exchange} key`} …>Disconnect</Button>
```
→ row `flex flex-wrap items-center gap-4 …`. Wrap the three buttons in `<div className="flex flex-wrap gap-2 basis-full sm:basis-auto sm:ml-auto">`. Keep every `aria-label` (the e2e anchor for Disconnect is `Disconnect <exchange> key`). Buttons stay size `md` (44 px).

---

### `src/app/(dashboard)/strategies/page.tsx` + `ShareableLink.tsx` (page + component) — N-STRAT, R1, (l)

**Analog:** itself (the My Strategies card row, ~772-806).
```tsx
<Card key={s.id} data-testid="strategy-row">
  <div className="flex items-center justify-between">
    <div className="flex-1 min-w-0">
      <Link href={`/strategies/${s.id}/edit`} className="font-medium text-text-primary hover:text-accent transition-colors">
        {s.name}
      </Link>
      <div className="flex gap-1.5 mt-1">
        {s.strategy_types.map((t: string) => (<Badge key={t} label={t} />))}
      </div>
    …
    <div className="flex items-center gap-3 ml-4">
      <ShareableLink strategyId={s.id} published={isPublishedStatus(s.status)} />
      <Badge label={s.status} type="status" />
      <StrategyActions … />
      <span className="text-xs text-text-muted">{new Date(s.created_at).toLocaleDateString()}</span>
```
→ row `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`; tags `flex flex-wrap gap-1 mt-1` with `<Badge className="whitespace-nowrap" …>`; right group `flex flex-wrap items-center gap-3 sm:ml-4 sm:shrink-0`; name as per-word `whitespace-nowrap` spans **with literal space children** (PC-5).

**`size` prop: copy the existing optional `variant` prop** (`ShareableLink.tsx`, `ShareableLinkProps` / signature ~106-108):
```tsx
  published: boolean;
  variant?: "primary" | "secondary";
}
export function ShareableLink({ strategyId, published, variant = "secondary" }: ShareableLinkProps) {
…
<Button variant={variant === "primary" ? "primary" : "secondary"} onClick={handleCopy} disabled={minting}>
```
→ add `size?: "sm" | "md"` (default `"md"`), pass `size={size}` and `className={size === "sm" ? "pointer-coarse:min-h-[44px]" : undefined}`. Icons are `h-4 w-4 mr-1.5` in every arm (five `<svg>`s); at `sm` they become `h-3.5 w-3.5`. **Peer precedent:** `StrategyActions.tsx` renders `<Button size="sm" …>` in the same row. **Button sizes** (`src/components/ui/Button.tsx` `sizeStyles`): `sm: "px-3 py-1.5 text-caption"`, `md: "min-h-[44px] px-4 py-2.5 text-body"`. `sm` has no min-height, hence the `pointer-coarse:` addition. The idiom `pointer-coarse:min-h-[44px]` already appears in `FactsheetView.tsx` ControlBar buttons.

**Tests:** `page.key-pill.test.tsx` `noteOf` (PC-5); `page.share-affordance.test.tsx` (grep row structure before editing).

---

### `src/components/strategy/StrategyTable.tsx` + `StrategyFilters.tsx` (component) — N-TABLE (k), K1, (l)

**Analog:** itself.

- Wrapper (~819-822): `<div data-strategy-table="" data-density={…} className="relative border border-border bg-surface">` → add `isolate`.
- Sticky header cells to leave alone: `sticky left-0 top-0 z-30 …` (rank), `sticky left-[6.25rem] top-0 z-20 …` / `sticky top-0 z-20 bg-surface` (the `stickyLeft` ternary).
- Filter bar (`StrategyFilters`, ~309): `<div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 bg-page pb-4">` → `sticky top-12 md:top-0 z-10 …`. The 48 px comes from `MobileTopBar` `h-12` (`md:hidden sticky top-0 z-20`).
- Chip sites (K1), exactly two in this file (~1216, ~1380): `` <span className={`${DATA_STATE_CHIP} text-text-muted bg-track`}> `` → `text-text-secondary bg-track`. `DATA_STATE_CHIP` (~88) is unchanged.
- Tag row (l) (~1143): `<div className="flex gap-1">` of `<Badge key={t} label={t} />` → `flex flex-wrap gap-1`, tags `whitespace-nowrap`. The name cell `Link` (~1095-1098) gets the same per-word treatment as `/strategies`.

---

### `src/app/(dashboard)/allocations/components/CoverageStateChip.tsx` (component) — K1

**Analog:** itself (`CHIP` map, ~42-54):
```typescript
"manually-excluded": { label: "Excluded", cls: "text-text-muted bg-track" },
…
"no-series": { label: "No data", cls: "text-text-muted bg-track" },
```
→ `text-text-secondary bg-track` at both. `BASE` unchanged. Pins to update: `CoverageStateChip.test.tsx` `toContain("text-text-muted")` (research: ~36, ~67). The `bg-track` pins stay valid.

---

### `tests/a11y/chip-contrast.test.ts` (NEW, unit, node) — K1 gate

**Analog:** `tests/a11y/palette-contrast.test.ts`. The directory is already in the vitest include (`vitest.config.ts`: `"tests/a11y/**/*.test.ts"`), so no config change is needed.

**Imports + the sanctioned luminance trio, copied verbatim** (~1-51):
```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function relativeLuminance(hex: string): number { … 0.2126 * r + 0.7152 * g + 0.0722 * b }
function getContrastRatio(fg: string, bg: string): number { … (lighter + 0.05) / (darker + 0.05) }
```
The header comment records the "Don't Hand-Roll, except this one helper" decision (duplicated in `chart-contrast.test.ts` and `wizard-contrast.test.ts`). Cite it the same way.

**Token read from `globals.css`** (literal-pin test, ~126-135):
```typescript
const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf-8");
expect(css).toMatch(/--color-accent:\s*#1B6B5A/);
```
Extend this to extract the hex by regex (RESEARCH sketch: `css.match(new RegExp(`--color-${n}:\\s*(#[0-9A-Fa-f]{6})`))![1]`). Also read `CoverageStateChip.tsx` and `StrategyTable.tsx` source and assert that no `text-text-muted bg-track` pairing remains, and that `text-text-secondary bg-track` appears at 2 + 2 sites. Then assert the ratio ≥ 4.5 for the pairing the source actually uses. Neuter check: reverting one site to `text-text-muted` must go RED (4.344 < 4.5).

---

### `src/components/admin/AllocatorMatchQueue.tsx` (component) — N-MATCH (M3)

**Analog:** itself.

**Viewport hook and guard today** (~174, ~329-335):
```typescript
const isLg = useMediaQuery("(min-width: 1024px)");
…
const guard = useCallback(
  (fn: () => void) => () => {
    if (forceReadOnly) return;
    fn();
  },
  [forceReadOnly],
);
```
→ add `const isMd = useMediaQuery("(min-width: 768px)")`, `const readOnly = forceReadOnly || !isMd`, and use `readOnly` in `guard` (deps `[readOnly]`) and in every `readOnly` / `isReadOnly` prop: `ShortlistCard readOnly={forceReadOnly}` (~581) and `CandidateDetail isReadOnly={forceReadOnly}` (~682). Keyboard shortcuts stay on `isLg`. Update the viewport comment (~168-173) that says "the action buttons still exist but a visible warning discourages use"; that is the recorded defect.

**CSS hiding (no hydration flash, because `useMediaQuery`'s server snapshot is `false`):** the action bar (~507-524) renders `Recompute now` / `Edit preferences` as `<Button size="sm">` under `!forceReadOnly`. Add `className="hidden md:inline-flex"`. A second `Recompute now` sits at ~553-556. `ShortlistCard` and `CandidateDetail` write buttons need the same classes inside their own files, or hide via the `readOnly` prop they already accept (read those components before choosing).

**Banner copy** (~461-468): `Open on a desktop or tablet (1024px+) to use keyboard shortcuts and record KEEP / SKIP / Send Intro decisions.` → UI-SPEC literal. Keep `md:hidden rounded-md border border-accent/30 bg-accent/5 px-4 py-3` and `text-small`.

**`useMediaQuery`** (`src/hooks/useMediaQuery.ts`): `useSyncExternalStore` with `getServerSnapshot = () => false`. The JS value is a handler guard only; never drive visibility with it.

### `AllocatorMatchQueue.test.tsx` (test)

**Analog:** its own `matchMedia` stub (~57-77):
```typescript
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({
      matches: true, // pretend we're on lg+
      media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
});
```
For the new below-`md` case, redefine it inside the test with `matches: false` (or `matches: !/min-width: 768px/.test(query)`), click each write handler, and assert no `fetch` fires. The existing suite's `matches: true` keeps its gate on `forceReadOnly`, as its comment requires.

---

### `src/components/admin/AdminTabs.tsx` + `src/app/(dashboard)/admin/page.tsx` — M1, M2 (one change across two files)

**Type** (`PendingStrategyRow`, ~77): `profiles: { display_name: string } | null;` → `{ display_name: string | null; email: string | null } | null` (check the nullability the page's other select types use).

**Embed** (`admin/page.tsx`, ~37): `profiles!strategies_user_id_fkey(display_name),` → `(display_name, email)`. Precedent in the same `Promise.all`: `.select("id, display_name, company, email, role, allocator_status, created_at")` on `profiles`, so an admin session already reads `email`.

**Owner line** (~467-469):
```tsx
<p className="mt-0.5 text-caption text-text-muted">
  by {profile?.display_name ?? "Unknown"} ·{" "}
  Synced {formatRecency(analytics?.computed_at ?? null)}
</p>
```
→ UI-SPEC three-branch copy; the email `<span>` gets `[overflow-wrap:anywhere]`.

**Count** (~217): `<span className="text-accent font-medium">{counts.intro_made} in progress</span>` → `{counts.intro_made} intro made` (matches `STATUS_FILTERS` `{ value: "intro_made", label: "Intro Made" }`).

**Test:** `AdminTabs.test.tsx` fixtures (for example `profiles: { display_name: "Quant Bob" }`) must gain `email` with synthetic addresses only (`owner-a@example.test`), because the repo is public.

---

### `src/app/(marketing)/layout.tsx` + NEW header-actions server component + `src/lib/routing/default-route.ts` — N-H (H1)

**Session-read analog** (`src/app/(marketing)/page.tsx` `Home`, ~1-3, ~34-38):
```typescript
import { createClient } from "@/lib/supabase/server";
…
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
```

**Link classes to reuse byte-identically** (`MarketingLayout`, ~39-52):
```tsx
<div className="flex items-center gap-2">
  <Link href="/login" className="inline-flex min-h-[44px] items-center rounded-md px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-page hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Sign in</Link>
  <Link href="/signup" className="inline-flex min-h-[44px] items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Sign up</Link>
</div>
```
Signed in: one `Go to app` link with the `Sign up` class string. The layout stays a server component with no `"use client"` (its header comment explains why). Update that comment: it now reads the session.

**Default route constant:** `src/proxy.ts` line ~25 `const DEFAULT_AUTHENTICATED_ROUTE = "/discovery/crypto-sma";` (used at ~149), and `(marketing)/page.tsx` hardcodes the same literal in `redirect("/discovery/crypto-sma")`. Move the constant into `src/lib/routing/default-route.ts`, a data-only module in the style of `route-contract-manifest.ts`, whose header says it "imports nothing and runs no logic". Import it from all three places.

**Test idiom for an async server component** (`src/app/(dashboard)/compare/page.test.tsx`, ~208-218, plus the `createClient` mock from `src/app/factsheet/[id]/v2/page.owner-lane.test.tsx` ~87, ~209-219, ~346-350):
```typescript
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
const getUserSpy = vi.fn();
vi.mocked(createClient).mockResolvedValue({ auth: { getUser: getUserSpy } } as never);
getUserSpy.mockResolvedValue({ data: { user: null } });   // and a signed-in variant
const Page = await MarketingHeaderActions();
render(Page as React.ReactElement);
```
Do not add `use cache` / `revalidate` to these layouts (RESEARCH threat model).

---

### `src/app/(dashboard)/compare/page.tsx` (page) — N-CMP (H2)

**Analog:** its own empty-state branch (~43-58):
```tsx
if (ids.length === 0) {
  return (
    <>
      <PageHeader title="Compare Strategies" breadcrumb={COMPARE_BREADCRUMB} />
      <p className="text-sm text-text-muted text-center py-16">
        Pick two or more strategies from discovery … using the compare checkboxes.
      </p>
```
Only the `<p>` text changes (UI-SPEC literal). The `Compare Strategies` h1 is the 52-01 reflow anchor (`h1:has-text("Compare Strategies")` in `reflow-sweep-authed.spec.ts` `ULTRAWIDE_ROUTES`), so keep it. The one-id note goes under the results-branch `PageHeader` (whose title is built by `` `Comparing ${items.length} ${items.length === 1 ? "Strategy" : "Strategies"}` ``). Render it when `items.length === 1`, as `text-caption text-text-muted`. Test with the `ComparePage` idiom above (`page.test.tsx`).

---

### Post-169 (T-F): `FactsheetView.tsx`, `FactsheetView.kpistrip.test.tsx`, `MetricsColumn.tsx`, `DESIGN.md`

**Do not plan from these excerpts. They are pre-169 and only locate the symbols.**

- `KpiStrip` (`FactsheetView.tsx`, ~1373): `` <div className={`grid grid-cols-3 ${containerCols} @5xl:divide-y-0`}> `` (~1517). Label `…whitespace-nowrap overflow-hidden text-ellipsis` (~1525); value `…text-h2 leading-tight break-words` (~1543). The ladder analog is `KpiPanel` (`grid-cols-1 … @sm:grid-cols-2 @lg:grid-cols-4`, with the host-vs-grid separation rule).
- ControlBar voice (C1-F1): the pill class `px-2.5 py-1 text-micro font-mono uppercase tracking-wider rounded-sm border bg-surface-subtle …` repeats at about 8 sites (~1869, 1937, 1944, 1961, 2123, 2215, 2249, 2270 `summary`). Swap `text-micro font-mono uppercase tracking-wider` → `text-caption` on the ControlBar-owned controls only; the `LEVERAGE` label (~2092) stays mono. Grep `tests/visual/strategy-v2-type-scale.test.ts` first.
- `OwnerUnpublishedPanel` (~861) share-controls wrapper `-mt-4 mb-2 flex flex-wrap items-center gap-2` (~881) (C1-F3).
- `SectionNav` (~1628) and `HeatmapPanels.tsx` `YearCalendarCanvas`: no change unless the corrected T0 walker names them.
- `MetricsColumn.tsx` "Month-to-date" rows: RESEARCH cites `<Row label="Month-to-date" …>` at ~90 and ~418. 169-05 rewrites both.

---

## Shared Patterns

### Seeded e2e gate (FLOW-01, "twice-burned")
**Source:** `e2e/reflow-sweep-authed.spec.ts` header (lines ~39-43) and `HAS_SEED_ENV` / `test.skip(!HAS_SEED_ENV, "…skipping prevents false-green on empty/404/login pages (W-02)…")`; `.github/workflows/ci.yml` `e2e-seeded` list.
**Apply to:** `e2e/layout-narrow.spec.ts` (both places). Additive `describe`s folded into an already-wired spec (the rotate-stability / 2560 precedent in `reflow-sweep-authed.spec.ts`) need no new wiring.

### Fail-loud visible anchor before any measurement (W-02 / Pitfall 5)
**Source:** `assertNoReflow` / `assertTargetSizes` in `e2e/helpers/reflow.ts`; `composer-axe.spec.ts` gates (`h2` "Start a portfolio", `h2` "Portfolio").
**Apply to:** every new e2e geometry assertion. Anchor on route-specific content, never on `body`/`main` chrome. `/strategies` and `/my-strategies` share the h1 "My Strategies", so select by href or testid (`e2e/my-strategies.spec.ts` DEF-149-B).

### Clip-proof inset focus ring (UIFIX-02)
**Source:** `ResponsiveTable.tsx` and `AllocationsTabs.tsx` `TAB_BUTTON_ACTIVE`: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent`.
**Apply to:** `Tabs.tsx` underline triggers, anything focusable inside a new `overflow-x-auto` box.

### Shrinkable flex item / contained scroll region
**Source:** the RESEARCH probe on `AllocationsTabs` (`min-w-0 max-w-full` on `ml-auto` wrappers); `ResponsiveTable` for fixed-anatomy content.
**Apply to:** A1, S1, N-FOOT, N-STRAT, P2. Never add `overflow-x-hidden` to `main` or a page wrapper (RESEARCH anti-pattern).

### App-shell offsets below `md`
**Source:** `DashboardChrome.tsx` `<main id="main-content" … className="flex-1 overflow-y-auto pb-16 md:pb-0">` (full-bleed branch; the sidebar branch adds `md:ml-[260px]`); `MobileNav.tsx` `aria-label="Primary mobile"`, `fixed bottom-0 … z-30 … md:hidden`; `MobileTopBar` `md:hidden sticky top-0 z-20 … h-12`.
**Apply to:** `ScenarioFooter` (`bottom-16 md:bottom-0`), `Tweaks` panel (`bottom-20 md:bottom-5`), `StrategyFilters` (`top-12 md:top-0`).

### Viewport-driven read-only: CSS hides, JS guards
**Source:** `useMediaQuery` (server snapshot `false`); `AllocatorMatchQueue` `guard`.
**Apply to:** M3 only.

### Async server component test
**Source:** `compare/page.test.tsx` (`const Page = await ComparePage({...}); render(Page as React.ReactElement)`) + `vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))` from `factsheet/[id]/v2/page.owner-lane.test.tsx`.
**Apply to:** the marketing header-actions test, the `/compare` one-id test.

### Contrast math + token read
**Source:** `tests/a11y/palette-contrast.test.ts` (luminance trio + `readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf-8")`).
**Apply to:** `tests/a11y/chip-contrast.test.ts`.

### Intentional pin updates
Every pin that encodes the old decision is updated with a dated comment naming Phase 170 and the founder decision: T_F1, T_F8, `FactsheetView.kpistrip.test.tsx` `grid-cols-3` (post-169), `CoverageStateChip.test.tsx` `text-text-muted`. Each new or tightened assertion must be neutered once to observe RED (CLAUDE.md test-intent rule).

---

## No Analog Found

| File / piece | Role | Data Flow | Reason | Use instead |
|--------------|------|-----------|--------|-------------|
| Reflow-helper self-test fixture (a wide flex child inside a fake `#main-content`, expected RED) | test | request-response | No e2e spec uses `page.setContent` or a static fixture (grep: 0 hits). `e2e/reflow.spec.ts` gives the spec shape only | RESEARCH §Structural Finding probe (the static HTML shell + `main{flex:1 1 0%;overflow-y:auto}` fixture), driven via `page.setContent` at 390×800 |
| Scroll-ancestor-aware offender walk | test utility | transform | `no-clip-sweep.spec.ts` inspects per-element computed style but never climbs ancestors | RESEARCH "Code Examples" sketch; keep the `no-clip-sweep` per-element idiom and sentinel |
| `elementFromPoint` "not covered" assertion | test | geometry | 0 uses in `e2e/`; the closest is `target-size.spec.ts` `boundingBox()` bounds checks | New `page.evaluate` helper; consider adding it to `e2e/helpers/reflow.ts` as `assertNotCovered(page, selector)` so the three consumers (footer Commit, Sort selects, Disconnect) share one implementation |

---

## Metadata

**Analog search scope:** `e2e/`, `e2e/helpers/`, `tests/a11y/`, `src/components/{ui,kpi,strategy,admin,exchanges,layout,portfolio}`, `src/app/(dashboard)/{allocations,strategies,admin,compare}`, `src/app/(marketing)`, `src/app/factsheet/[id]/v2`, `src/hooks`, `src/lib/routing`, `src/proxy.ts`, `.github/workflows/ci.yml`.
**Files scanned:** about 45 (all `git ls-files`-tracked).
**Pattern extraction date:** 2026-09-27, at HEAD `8763ec7be`.

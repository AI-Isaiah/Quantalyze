# Phase 52: Per-Surface Application — Allocator Journey - Pattern Map

**Mapped:** 2026-06-29
**Files analyzed:** 24 (7 new route-state files + 5 named clip fixes + table/page-shell clip fixes + ~6 `@container` migrations + 4 page-shell width raises + 5 Wave-0 guard/test additions + 1 eslint-config edit)
**Analogs found:** 23 / 24 (1 has no direct analog — first 2560px e2e row)

> This is a CONFORMANCE phase. Every new artifact has a proven in-repo analog — the value is *applying* the analog per-surface with discipline (no clip relocation, no frozen-island RSC-ification, no token drift), not inventing anything. Treat every "Analog" below as the file the new work copies its idiom from.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/app/(dashboard)/allocations/loading.tsx` (NEW) | route (loading) | request-response (Suspense fallback) | `src/app/factsheet/[id]/v2/loading.tsx` | exact |
| `src/app/(dashboard)/allocations/error.tsx` (NEW) | route (error boundary) | event-driven (boundary catch) | `src/app/(dashboard)/error.tsx` | exact |
| `src/app/(dashboard)/compare/loading.tsx` (NEW) | route (loading) | request-response | `src/app/factsheet/[id]/v2/loading.tsx` + `discovery/[slug]/loading.tsx` | exact |
| `src/app/(dashboard)/compare/error.tsx` (NEW) | route (error boundary) | event-driven | `src/app/(dashboard)/error.tsx` | exact |
| `src/app/strategy/[id]/loading.tsx` (NEW) | route (loading) | request-response | `src/app/factsheet/[id]/v2/loading.tsx` (narrow measure) | role-match |
| `src/app/strategy/[id]/error.tsx` (NEW) | route (error boundary) | event-driven | `src/app/strategy/[id]/v2/error.tsx` | exact |
| `…/{loading,error}.test.tsx` (NEW ×3-6) | test | — | `src/app/strategy/[id]/v2/error.test.tsx` | exact |
| `src/app/(dashboard)/allocations/page.tsx` (MOD: max-w raise) | route (page shell) | request-response | `factsheet/[id]/v2/loading.tsx` max-w idiom | role-match |
| `compare/page.tsx`, `discovery/[slug]/page.tsx` (MOD: max-w fill) | route (page shell) | request-response | same `mx-auto max-w-[…]` idiom | role-match |
| KPI strip / metrics-rail card / factsheet panel / WidgetGrid (MOD: `@container`) | component | transform (layout) | `src/components/strategy/StrategyTable.tsx` (`@container`) + `ResponsiveTable.tsx` | exact |
| `src/app/(dashboard)/allocations/components/AlertBanner.tsx:127` (MOD: clip) | component | render | `ScopedBanner.tsx:30` (wrap) | exact |
| `…/components/SavedScenariosList.tsx:529` (MOD: clip) | component | render | `ScopedBanner.tsx:30` (wrap) | exact |
| `…/components/ScenarioComposer.tsx:2779` (MOD: clip) | component | render | StrategyTable `title=` cell idiom | role-match |
| `src/components/strategy/StrategyGrid.tsx:63` (MOD: clip) | component | render | `title={name}` single-line | role-match |
| Holdings / Discovery / Compare table name cells (MOD: clip) | component | CRUD (table) | StrategyTable `title=` cell idiom | role-match |
| `src/__tests__/phase-52-frozen-spine-guards.test.ts` (NEW) | test (guard) | — | `src/__tests__/phase-30-frozen-spine-guards.test.ts` | exact |
| `e2e/reflow-sweep.spec.ts` / `e2e/helpers/reflow.ts` (MOD: +2560 row) | test (e2e) | — | `e2e/reflow-sweep.spec.ts` (320px row) | role-match |
| `eslint.config.mjs` (MOD: per-surface `error` ratchet) | config | — | `eslint.config.mjs` `src/lib/design-tokens/**` override | exact |

---

## Pattern Assignments

### `src/app/(dashboard)/allocations/loading.tsx` + `compare/loading.tsx` + `strategy/[id]/loading.tsx` (route, loading)

**Analog:** `src/app/factsheet/[id]/v2/loading.tsx` (the fidelity bar) — supplemented by the leaner `src/app/(dashboard)/discovery/[slug]/loading.tsx` for table-row skeletons.

The factsheet skeleton is the match-layout bar: a single page-shell `<article>` at the route's own max-width, header → KPI-strip grid → body+rail, all `animate-pulse`, closed by an `sr-only role="status" aria-live="polite"` liveness hint. New skeletons copy this structure but change ONLY the dominant anchor per UI-SPEC.

**Page-shell + liveness skeleton** (`factsheet/[id]/v2/loading.tsx:7-9,28-38,64-67`):
```tsx
export default function FactsheetV2Loading() {
  return (
    <article className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10 py-6 sm:py-10 lg:py-12 bg-page animate-pulse">
      {/* KPI strip skeleton — copy this grid as the allocations dominant anchor */}
      <section className="mt-6 border border-border bg-surface">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-9 divide-x divide-border">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="px-4 py-4 space-y-2">
              <div className="h-2 w-16 bg-border rounded-sm" />
              <div className="h-5 w-20 bg-border rounded-sm" />
            </div>
          ))}
        </div>
      </section>
      {/* sr-only liveness — REQUIRED on every new loading.tsx (UI-SPEC Copywriting) */}
      <p className="sr-only" role="status" aria-live="polite">
        Loading factsheet — computing analytics.
      </p>
    </article>
  );
}
```

**Skeleton primitive (prefer over hand-rolled `bg-border` divs where a primitive fits)** (`src/components/ui/Skeleton.tsx:7-14`):
```tsx
export function Skeleton({ className = "" }: SkeletonProps) {
  return <div className={`animate-pulse rounded-md bg-border/60 ${className}`} aria-hidden />;
}
```
Note: the factsheet bar predates `Skeleton` and hand-rolls `bg-border rounded-sm` divs. `discovery/[slug]/loading.tsx` is the newer idiom — it assembles `<Skeleton className="h-5 w-40" />` rows. New `loading.tsx` files should assemble from `Skeleton`/`SkeletonText`/`SkeletonCard` per RESEARCH "Don't Hand-Roll", reserving the bar's structural grid for layout fidelity.

**Per-surface dominant anchor** (UI-SPEC §State Coverage, "Dominant visual anchor"):
- `allocations/loading.tsx` → full-width 4-cell KPI strip first + largest, then equity-chart placeholder, then holdings rows. Page shell raises to the fluid-fill measure: `mx-auto max-w-[1920px] px-6`.
- `compare/loading.tsx` → multi-column comparison-table skeleton (one column per selected strategy) as anchor, above a correlation-matrix placeholder. Use the `discovery/[slug]/loading.tsx` row-loop idiom for the table.
- `strategy/[id]/loading.tsx` → page-title (`--text-page-title`) line + headline-metric block at the NARROW prose measure (`max-w-3xl` — do NOT fluid-fill; UI-SPEC layout table), equity-chart placeholder below.

**Pitfall guard:** keep server-fetch in `page.tsx`, never a layout (RESEARCH Pitfall 5) — the allocations/compare/strategy pages already fetch in the page (`getMyAllocationDashboard` at `allocations/page.tsx:41`; `getPublicStrategyDetail` in `strategy/[id]/page.tsx:23`), so the skeleton will actually render.

---

### `src/app/(dashboard)/allocations/error.tsx` + `compare/error.tsx` + `strategy/[id]/error.tsx` (route, error boundary)

**Analog:** `src/app/(dashboard)/error.tsx` (already on the Next-16.2.0 `unstable_retry` signature). `src/app/strategy/[id]/v2/error.tsx` is the secondary analog for the strategy surface (pathname-aware fallback link).

**Imports + signature** (`src/app/(dashboard)/error.tsx:1-17`):
```tsx
"use client";
import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function DashboardError({
  error,
  unstable_retry,                       // Next 16.2.0 — NOT `reset` (RESEARCH State of the Art)
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => { console.error("[dashboard-error]", error); }, [error]);
```

**Body + retry + digest-only info (no message leak)** (`src/app/(dashboard)/error.tsx:22-44`):
```tsx
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="mt-4 font-display text-2xl text-text-primary">Something went wrong</h1>
        <p className="mt-2 text-sm text-text-muted">
          This section encountered an error. You can retry or navigate to another page.
        </p>
        {error.digest && (                              {/* digest ONLY — never error.message (RSC leak, ASVS V7) */}
          <p className="mt-1 font-mono text-xs text-text-muted/60">Error ID: {error.digest}</p>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button onClick={() => unstable_retry()}>Try again</Button>
          <Link href="/discovery/crypto-sma"><Button variant="ghost">Go to Discovery</Button></Link>
        </div>
      </div>
    </div>
  );
```

Copy strings verbatim from UI-SPEC Copywriting Contract ("Something went wrong" + body + `Error ID: {digest}`). For `strategy/[id]/error.tsx`, the `v2/error.tsx` analog adds a `usePathname()`-derived fallback link — keep that pattern if a v1 fallback is wanted, but the route-level error here is the strategy subtree, not v2.

---

### `…/{loading,error}.test.tsx` (test — STATE-01 proof + coverage gate)

**Analog:** `src/app/strategy/[id]/v2/error.test.tsx` (the exact precedent RESEARCH names).

**Mock + render + assertion shape** (`src/app/strategy/[id]/v2/error.test.tsx:18-25,50-72,92-98`):
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
vi.mock("next/navigation", () => ({ usePathname: () => pathnameValue }));   // if the error uses pathname
import StrategyV2Error from "./error";

it("renders heading + body copy + CTA", () => {
  const err = Object.assign(new Error("boom"), { digest: "d-1" });
  render(<StrategyV2Error error={err} unstable_retry={vi.fn()} />);
  expect(screen.getByRole("heading", { name: /something went wrong/i })).toBeTruthy();
});
it("retry button invokes unstable_retry()", () => {
  const retry = vi.fn();
  render(<DashboardError error={new Error("boom")} unstable_retry={retry} />);
  fireEvent.click(screen.getByRole("button", { name: /try again/i }));
  expect(retry).toHaveBeenCalledTimes(1);
});
it("console.error fires with the thrown error on mount", () => {
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  render(<DashboardError error={new Error("x")} unstable_retry={vi.fn()} />);
  expect(errSpy).toHaveBeenCalled(); errSpy.mockRestore();
});
```
For `loading.tsx` tests: render and assert the `role="status"` liveness node + the dominant-anchor structure exists (the skeleton has no props/logic, so a smoke-render + `getByRole("status")` is sufficient for the coverage gate).

---

### `@container` migrations: KPI strips, 380px metrics-rail cards, factsheet panels, WidgetGrid tiles, table-embedded controls (component, transform)

**Analog:** `src/components/strategy/StrategyTable.tsx` (the ONLY working `@container` in the repo, Phase 50-06) + its host `src/components/ResponsiveTable.tsx`.

**The host-container idiom** (`StrategyTable.tsx:516-520`):
```tsx
{/* ResponsiveTable owns the role=region landmark AND, via className, doubles as
    the @container containment context. scrollRef lets the scroll cue measure the box. */}
<ResponsiveTable label="Strategies" className="@container" scrollRef={scrollContainerRef}>
```

**`ResponsiveTable` merges the `@container` class onto the scroll region** (`ResponsiveTable.tsx:55-63`):
```tsx
const accessibleName = hint ?? (label ? `${label}: ${DEFAULT_HINT}` : DEFAULT_HINT);
return (
  <div ref={scrollRef}
       className={["overflow-x-auto", className].filter(Boolean).join(" ")}  // "@container" lands here
       role="region" aria-label={accessibleName} tabIndex={0}>
    {children}
  </div>
);
```

**The `@max-3xl:hidden` priority-collapse on columns + `tabular-nums` preservation** (`StrategyTable.tsx:559,577-583`):
```tsx
<th className={`… ${col.align === "right" ? "text-right" : "text-left"} ${col.collapse ? "@max-3xl:hidden" : ""}`}>
…
<th className="… @max-3xl:hidden">Return</th>
<th className="… @max-3xl:hidden">Underwater</th>
{/* details disclosure column reappears at narrow widths */}
<th className="… @3xl:hidden"><span className="sr-only">Details</span></th>
```
And the numeric cell keeps mono tabular alignment under the fluid tier (`StrategyTable.tsx:559` pattern; RESEARCH idiom line 141):
```tsx
<td className="px-4 py-3 text-right font-metric tabular-nums @max-3xl:hidden">…</td>
```

**Apply-rules for new container migrations:**
- Mark the varying-width region with plain `className="@container"` (inline-size). NEVER `@container-size` — it establishes block-size containment and collapses panel height to 0 (RESEARCH Pitfall 1).
- Collapse columns from the RIGHT in priority order; relocate the real value into a per-row `<details>` — never a fabricated em-dash/zero (no-invented-data, STATE-02).
- Every columnar number stays Geist Mono `tabular-nums` across every container breakpoint (UI-SPEC hard rule; RESEARCH Pitfall 2). Add a per-new-container test asserting alignment holds across the `@max-*` boundary (model the StrategyTable tests).
- For the 380px metrics rail and factsheet KPI panels: use `@container` so a card in the narrow rail stops thinking it's at desktop width — this is the exact "viewport breakpoint misleads" case TYPE-04 targets.

---

### Page-shell ultra-wide fill (route page shell — APPLY-01)

**Analog:** the `mx-auto max-w-[…]` idiom used identically across pages. Current allocations shell (`allocations/page.tsx:63`):
```tsx
<div className="max-w-[1280px] mx-auto p-6 pb-20">   {/* RAISE → max-w-[1920px] (data surface, fluid-fill) */}
```
Factsheet sets the wide-measure convention (`factsheet/[id]/v2/loading.tsx:9`): `mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10`.

**Apply-rules (per the UI-SPEC layout table):**
- Allocations / Discovery / Compare (data surfaces, no cap or 1280 today) → `mx-auto max-w-[1920px]` then center. RESEARCH Open-Q1 recommends a hard `max-w-[1920px] mx-auto px-*` (matches the existing idiom) over a `clamp()` gutter; decide per-surface, verify at 2560.
- Factsheet (`max-w-[1440px]`) → KEEP ~1440; verify it reads well filling toward 1920 (don't stretch the KPI strip / chart panels sparse).
- Single-strategy (`max-w-3xl` prose) → KEEP narrow. It does NOT fluid-fill (prose/detail page).
- The 380px metrics rail stays a fixed 380px (UI-SPEC "fixed-width ~380px rail").
- Tune chart aspect + un-collapse `@container` columns at the wider measure so a 2-col table doesn't strand in whitespace (RESEARCH Pitfall 4; "data density > card density").

**Frozen-island caution:** raising the page-shell `max-w` is chrome — it does NOT RSC-ify `EquityChart`/`ScenarioComposer`/the MC Worker. Keep the RSC-page + `"use client"` tab-tree + `next/dynamic({ssr:false})` panel split exactly (UI-SPEC BP-01).

---

### Truncation / no-clip fixes (component, render — TYPE-02)

**Two analogs:** (a) WRAP — `src/components/ui/ScopedBanner.tsx:29-35`; (b) single-line + `title=` — the StrategyTable cell idiom.

**(a) WRAP idiom — entity names in cards/lists/headings** (`ScopedBanner.tsx:29-35`):
```tsx
<div className="min-w-0 flex-1">
  {/* No `truncate`: a trust-critical name must show in full. min-w-0 on the parent lets it wrap. */}
  <div className="font-display text-lg text-text-primary break-words">{title}</div>
</div>
```

**(b) single-line + `title=` idiom — dense table name cells where wrap breaks tabular alignment** (RESEARCH Pattern 4):
```tsx
<td className="truncate" title={strategy.name}>{strategy.name}</td>
```

**The 5 named accidental-clip sites (audit SoT: `.planning/audits/truncation-audit.md`):**

| Site | Current code | Treatment | Analog |
|------|--------------|-----------|--------|
| `…/components/AlertBanner.tsx:126-128` | `<p className="truncate text-[14px]" style={{color:"#1A1A2E"}}>{head.message}</p>` | WRAP (`break-words min-w-0`) OR `title=`; **also migrate `text-[14px]`→`--text-*` and the inline hex→token** | ScopedBanner wrap |
| `…/components/SavedScenariosList.tsx:528-530` | `<span className="truncate text-sm text-text-primary">{row.name}</span>` inside `flex flex-col min-w-0` | WRAP (`break-words`) — name in a list row, not tabular | ScopedBanner wrap |
| `…/components/ScenarioComposer.tsx:2779` | `<span className="text-[12px] text-text-primary truncate max-w-[160px]">{strategyNames[id] ?? id.slice(0,8)}</span>` | single-line + `title={strategyNames[id]}` (table-aligned `<li>` row); **migrate `text-[12px]`→tier** | StrategyTable `title=` cell |
| `src/components/strategy/StrategyGrid.tsx:63` | `<h3 className="… truncate min-w-0">{s.name}</h3>` | `title={s.name}` OR 2-line clamp (marketplace tile); `wizardErrors.ts:481` warns managers names truncate | `title=` single-line |
| Holdings / Discovery / Compare table **name cells** | dense-table name columns | single-line + `title=` (tabular context) | StrategyTable `title=` cell |

**Hard rule — never relocate a clip** (RESEARCH Anti-Pattern; UI-SPEC §Truncation): do NOT introduce a NEW `truncate`/`line-clamp` without a `title`/tooltip when re-typing onto fluid tiers. Do NOT remove the recovery affordance from the LEGITIMATE clips the audit lists (`CompareCorrelationMatrix.tsx:90/113`, `risk/CorrelationMatrix.tsx:182/195` carry `title=`; `FactsheetView.tsx:647/653` fixed KPI labels; `TimeSeriesChart.tsx:1109` tooltip-recovered legend).

---

### `src/__tests__/phase-52-frozen-spine-guards.test.ts` (NEW test guard — BP-01, Wave 0)

**Analog:** `src/__tests__/phase-30-frozen-spine-guards.test.ts` (copy nearly verbatim; set a 52 baseline sha).

**Baseline-resolve + git-delta machinery** (`phase-30-frozen-spine-guards.test.ts:63-135`):
```ts
const FALLBACK_BASE_SHA = "<set the 52 planning-time HEAD sha>";   // CHANGE per phase
function git(args: string[]): string { return execFileSync("git", args, { cwd: CWD, encoding: "utf8", … }).trim(); }
function resolveBaselineRef(): string {
  if (refExists("origin/main")) { const base = git(["merge-base","origin/main","HEAD"]); if (base) return base; }
  if (refExists(FALLBACK_BASE_SHA)) return FALLBACK_BASE_SHA;
  throw new Error("…fail loud, never silently skip an exit gate (Rule 12)…");
}
function changedFiles(base: string): string[] {
  const committed = git(["diff","--name-only",base,"HEAD"]).split("\n")…;
  const untracked = git(["ls-files","--others","--exclude-standard"]).split("\n")…;
  return [...new Set([...committed, ...untracked])];
}
const CHANGED = changedFiles(resolveBaselineRef());
```

**Zero-diff assertion shape** (`phase-30-frozen-spine-guards.test.ts:149-159`):
```ts
it("frozen island is zero-diff vs baseline", () => {
  expect(CHANGED, `Phase 52 exit gate VIOLATED — <file> changed; revert it.`).not.toContain(FROZEN_FILE);
});
```

**52-scoped change:** assert zero-diff on the SEVEN island files instead of just `scenario.ts`/`scenario.test.ts`:
`src/lib/scenario.ts`, `src/lib/factsheet/compute.ts`, `src/app/factsheet/[id]/v2/factsheet-context.tsx`, the `useBreakpoint` hook file, `src/app/(dashboard)/allocations/lib/montecarlo.worker.ts`, `EquityChart.tsx`, `TouchTooltip.tsx`, and the `useTapPin` file. (RESEARCH Open-Q2 — cheap belt-and-suspenders over the existing svg-golden + `scenario.test.ts` gates.)

---

### `e2e/reflow-sweep.spec.ts` (+2560px row) / `e2e/helpers/reflow.ts` (MOD test — APPLY-01/TYPE-03, Wave 0)

**Analog:** the existing 320px sweep — the helper is already viewport-agnostic; only a 2560 viewport row is new (this is the one item with no exact analog — a NEW viewport assertion on existing infra).

**The reusable assertion (already 2560-ready)** (`e2e/helpers/reflow.ts:47-69`):
```ts
export async function assertNoReflow(page: Page, anchorSelector: string): Promise<void> {
  await expect(page.locator(anchorSelector).first(), "…blank/404/unhydrated false-green guard").toBeVisible({timeout:10_000});
  …
  const slop = doc.scrollWidth - doc.clientWidth;   // clientWidth (not innerWidth) — excludes scrollbar gutter
  if (slop <= 1) return { ok: true };               // <=1px slop for sub-pixel font hinting
}
```

**The per-route loop to copy for a 2560 row** (`e2e/reflow-sweep.spec.ts:59-81`):
```ts
test.describe("reflow sweep @ 320px — public", () => {
  for (const r of PUBLIC_ROUTES) {
    test(`${r.path} no horizontal overflow at 320px`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 });   // ADD a 2560×1440 variant for the in-scope authed surfaces
      const res = await page.goto(r.path);
      if (res && res.status() >= 400) throw new Error(`${r.path} returned HTTP ${res.status()}`);
      await assertNoReflow(page, r.anchor);
    });
  }
});
```
**FLOW-01 dual-wiring trap (MEMORY + the spec header):** a new seeded e2e row must be wired in BOTH the env-self-skip const AND `.github/workflows/ci.yml`'s playwright list, else it never runs. The authed 7 allocator surfaces need a seed → put the 2560 authed row in `e2e/reflow-sweep-authed.spec.ts` (seeded MA-8 list), not the unseeded public sweep. Anchor each route on a VISIBLE content element so a 404/unhydrated page fails loud.

---

### `eslint.config.mjs` (MOD config — per-surface `no-raw-font-px` ratchet)

**Analog:** the existing `src/lib/design-tokens/**` override block (`eslint.config.mjs:82-85`):
```js
{
  files: ["src/lib/design-tokens/**"],
  rules: { "quantalyze/no-raw-font-px": "error" },
}
```
The repo-wide level is `warn` (dirty baseline, `eslint.config.mjs:75`); the comment at lines 68-73 explicitly says "The 52/53 strangler ratchets the remaining ~53/54 dirty surfaces to error one at a time." After a surface's raw `text-[Npx]`→`--text-*` migration, add a per-glob override flipping it to `error` (RESEARCH Code Example): e.g. `{ files: ["src/app/(dashboard)/allocations/**"], rules: { "quantalyze/no-raw-font-px": "error" } }`. Chart globs stay `off` (`eslint.config.mjs:89-94`).

---

## Shared Patterns

### Skeleton primitives (apply to: all 3 new `loading.tsx`)
**Source:** `src/components/ui/Skeleton.tsx:7-36` (`Skeleton`/`SkeletonText`/`SkeletonCard`) — already `prefers-reduced-motion`-safe via `globals.css`.
```tsx
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-border/60 ${className}`} aria-hidden />;
}
```
Assemble new skeletons from these; reserve the factsheet bar's structural grid only for layout-fidelity dimensions. Do NOT hand-roll `animate-pulse` divs where a primitive fits (RESEARCH Don't Hand-Roll).

### Honest empty/degenerate state (apply to: all surfaces' degenerate branches — STATE-02)
**Source:** `src/components/ui/EmptyStateCard.tsx:23-30` — neutral muted card, NO `role="alert"`, NO red/warning. Empty ≠ error.
```tsx
export function EmptyStateCard({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-text-muted text-sm">
      <div className="font-semibold text-text-secondary">{heading}</div>
      <div className="mt-1 text-[11px]">{body}</div>
    </div>
  );
}
```
EXTEND existing tested degenerate branches (0/1 strategy, <10 overlapping days, non-finite, compute-in-progress, watchlist-unavailable, baseline-unknown) — never render fabricated zeros/demo numbers/count-ups in their place (no-invented-data LOCKED). Errors route through `ErrorEnvelope`/route `error.tsx`, NOT `EmptyStateCard`.

### Route-error boundary signature (apply to: all 3 new `error.tsx`)
**Source:** `src/app/(dashboard)/error.tsx:1-17` — `"use client"`, prop is `unstable_retry` (Next 16.2.0), `error: Error & { digest?: string }`. Surface `digest` only, never `error.message` (ASVS V7 / RSC info-leak).

### `@container` host idiom (apply to: every TYPE-04 migration)
**Source:** `StrategyTable.tsx:516-520` + `ResponsiveTable.tsx:55-63`. Plain `className="@container"` (inline-size) on the containment region; `@max-*:`/`@min-*:`/`@3xl:hidden` variants on children; `tabular-nums` on every columnar number. Never `@container-size`.

### Access-control + visibility gate preservation (apply to: every page-shell edit — ASVS V4)
**Source:** `allocations/page.tsx:39` (`if (!user) redirect("/login")`), `compare/page.tsx:30` + `withPublishedOnly` (`compare/page.tsx:2,56`). A restyle MUST NOT remove a `redirect("/login")` or `withPublishedOnly` gate. `title={fullText}` recovery applies only to data already rendered — never pull an un-gated field into a `title`.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| 2560px reflow row in `e2e/reflow-sweep-authed.spec.ts` | test (e2e) | — | No 2560px viewport assertion exists yet (sweep is 320px only). NOT a missing pattern — the `assertNoReflow` helper and per-route loop are reused verbatim; only the `setViewportSize({width:2560})` value + authed-seed wiring is net-new. App-wide 2560 axe/reflow row formally lands Phase 54; this is a cheap in-scope subset. |

Everything else has a direct in-repo analog.

---

## Metadata

**Analog search scope:** `src/app/(dashboard)/{allocations,compare,discovery}`, `src/app/factsheet/[id]/v2`, `src/app/strategy/[id]`, `src/components/ui`, `src/components/strategy`, `src/components/AlertBanner`/`ScopedBanner`/`ResponsiveTable`, `src/__tests__/phase-30-frozen-spine-guards`, `e2e/helpers/reflow.ts`, `e2e/reflow-sweep.spec.ts`, `eslint.config.mjs`, `.planning/audits/truncation-audit.md`.
**Files scanned:** ~16 read in full or targeted; cross-referenced against the truncation-audit census (48 sites) and the RESEARCH/UI-SPEC analog lists.
**Pattern extraction date:** 2026-06-29
</content>
</invoke>

# Phase 147: SCEN-01 — The scenario engine receives the real series - Pattern Map

**Mapped:** 2026-08-04
**Files analyzed:** 12 (8 modified, 4 created)
**Analogs found:** 11 / 12

Every excerpt below is a verbatim read at the pinned line number. The planner should
reference the analog + line range directly in plan actions — do not paraphrase "follow the
existing pattern".

---

## File Classification

| New/Modified File | New? | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|------|-----------|----------------|---------------|
| `src/app/api/strategies/[id]/returns/route.ts` | mod | route handler | request-response | `src/app/factsheet/[id]/v2/page.tsx:45,63-71` (the correct resolve+select shape) | exact (same read, already-fixed sibling) |
| `src/lib/queries.ts` (`getMyAllocationDashboard` select `:3405`, payload strip `:3537`, `Pick<>` `:1666`) | mod | data access (SSR query) | CRUD read → projection | `src/lib/queries.ts:3527-3541` (the `data_quality_flags` strip-then-project idiom in the SAME function) | exact (self-analog, same block) |
| `src/app/scenario-share/[token]/share-resolve.ts` | mod | pure resolve layer | transform | `share-resolve.ts:152-162,182-185,210-212` (the Phase-84 `assetClassById` optional-param idiom in the SAME file) | exact (self-analog) |
| `src/app/scenario-share/[token]/page.tsx` | mod | RSC page (server) | request-response + sibling read | `page.tsx:150-198` (Phase-84 `asset_class` sibling read) | exact (self-analog, same file) |
| `src/app/api/og/factsheet/[id]/route.tsx` | mod | route handler (image) | request-response | `src/app/factsheet/[id]/v2/page.tsx:45,60-71` | role-match (same read + resolver, different transport) |
| `src/app/(dashboard)/allocations/components/CoverageStateChip.tsx` | mod | presentational component | props-in / render-out | `CoverageStateChip.tsx:24-33` (extend the union + `CHIP` record in place) | exact (self-analog) |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (chip precedence `:5582`, tolerance `:1332-1360`, fetch lifecycle `:1281-1317`, `:2093-2102`) | mod | client component | event-driven + fetch lifecycle | `ScenarioComposer.tsx:1344-1356` (BLEND-01/CONSTIT-02 additive tolerance) + `:5437-5486` (per-key chip precedence branch) | exact (self-analog) |
| `src/lib/closed-sets.ts` (optional `SERIES_STATES`) | mod | config / closed set | constants | `closed-sets.ts:423-446` (`STRATEGY_ANALYTICS_COMPUTATION_STATUSES` + `isComputedAnalytics`) | exact |
| `src/lib/factsheet/resolve-series.ts` | **NEW** | pure utility (leaf) | transform | `src/lib/factsheet/allocator-portfolio-payload.ts:1-58` (the code being moved) | exact (verbatim move + re-export) |
| `src/__tests__/phase-147-series-resolution-guards.test.ts` | **NEW** | structural grep-gate test | file-I/O scan | `src/__tests__/phase-84-asset-class-flow.test.ts` (full) + `phase-63-series-space-guards.test.ts:54-109` | exact |
| `src/app/api/og/factsheet/[id]/route.test.tsx` | **NEW** | route test | request-response | `src/app/api/strategies/[id]/sync-progress/route.test.ts:1-80` (harness) — **but `next/og` has zero mock precedent** | partial — see §No Analog Found |
| Test extensions: `returns/route.test.ts`, `ScenarioComposer.test.tsx`, `share-resolve.test.ts`, `CoverageStateChip.test.tsx` | mod | tests | — | each file is its own analog (harnesses excerpted below) | exact |

---

## Pattern Assignments

### `src/app/api/strategies/[id]/returns/route.ts` (route handler, request-response)

**Analog:** `src/app/factsheet/[id]/v2/page.tsx:45,60-71` — the already-correct read. Copy its
select width and its resolver call, not its composite arm (P8).

**Select-width pattern to copy** (`factsheet/[id]/v2/page.tsx:45`):
```ts
strategy_analytics ( daily_returns, returns_series, computed_at, data_quality_flags, metrics_json_by_basis, computation_status )
```

**Resolver call pattern to copy** (`factsheet/[id]/v2/page.tsx:60-71`):
```ts
const analytics = Array.isArray(strategy.strategy_analytics)
  ? strategy.strategy_analytics[0]
  : strategy.strategy_analytics;
const dailyRaw = analytics?.daily_returns;
// resolveDailyReturnSeries handles two real-world realities at once: …
// (b) analytics-service-only strategies have `daily_returns=null`; the
//     real series lives in `returns_series` as a cumprod equity curve.
let dailyReturns = resolveDailyReturnSeries(dailyRaw, analytics?.returns_series);
```
⚠️ The returns route reads `strategy_analytics` **directly** (not as an embed), so the
`Array.isArray(...)` unwrap above is NOT needed there — it is only needed on the OG route
(which uses an embed).

**The line being replaced** (`returns/route.ts:219-223, 251-252` — read this session):
```ts
const { data, error } = await supabase
  .from("strategy_analytics")
  .select("daily_returns, data_quality_flags")
  .eq("strategy_id", id)
  .maybeSingle();
…
const raw = (data as { daily_returns: unknown } | null)?.daily_returns;
const daily_returns: DailyPoint[] = normalizeDailyReturns(raw);
```

**Error-redaction pattern that MUST survive the widening** (`returns/route.ts:225-236`):
```ts
if (error) {
  // Do not forward the raw Postgres error.message (column names / SQLSTATE /
  // schema detail) to the allocator. Log + capture server-side; return a static
  // envelope — mirrors the browse-route F5b redaction (T-29-02).
  console.error("[api/strategies/returns] select error:", error);
  captureToSentry(error, { tags: { route: "api/strategies/returns" } });
  return NextResponse.json(
    { error: "Failed to load returns" },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}
```

**Additive-response-field pattern** — the `series_state` field must be declared on the
exported interface with the same JSDoc-justification style as `asset_class` /
`is_composite` (`returns/route.ts:75-106`). Excerpt of the existing shape:
```ts
export interface ReturnsResponse {
  daily_returns: DailyPoint[];
  /** #597 part 2 (BLEND-01) — … PUBLIC classification data … so widening the
   * response leaks nothing the 404 existence-oracle didn't already gate. */
  asset_class: string | null;
  trust_tier: string | null;
  /** CONSTIT-02 — server-coerced composite discriminator, strict
   * `data_quality_flags.composite === true` (T-111-04). The RAW
   * data_quality_flags blob is NEVER forwarded — only this boolean (T-111-03). */
  is_composite: boolean;
}
```

**⛔ Pinned literal — do NOT touch** (`returns/route.ts:191-197`, pinned by
`phase-84-asset-class-flow.test.ts:42`):
```ts
const { data: strat, error: probeError } = await withPublishedOrOwner(
  supabase
    .from("strategies")
    .select("id, asset_class")
    .eq("id", id),
  user.id,
).maybeSingle();
```
P5's `created_at` probe widening would break that pin **byte-for-byte**. If the planner
adopts the P5 age bound, the `created_at` must come from a **separate** read (mirroring the
Phase-84 sibling-read pattern below) or the phase-84 pin must be updated in the same commit
with an explicit rationale — flag this as a plan-time decision.

---

### `src/lib/queries.ts` — `getMyAllocationDashboard` (data access, CRUD read → projection)

**Analog:** the same function's own `data_quality_flags` handling — it already does exactly
the "read a column, derive a projection, strip the raw blob" move this phase needs.

**Select block to widen** (`queries.ts:3405-3412`):
```ts
strategy_analytics (
  daily_returns,
  cagr,
  sharpe,
  volatility,
  max_drawdown,
  data_quality_flags
)
```

**Strip-then-project pattern to copy** (`queries.ts:3527-3541`):
```ts
// Phase 111 / CONSTIT-02 — is_composite via strict `=== true` coercion
// (mirrors factsheet v2 page.tsx:90; T-111-04: malformed jsonb must never
// assert composite). The raw data_quality_flags blob is stripped from the
// emitted analytics below so only this boolean crosses to the client
// (T-111-03: degraded-member venue detail never ships).
const analyticsObj = (analytics ?? null) as Record<string, unknown> | null;
const dqf = analyticsObj?.data_quality_flags as { composite?: unknown } | null | undefined;
const is_composite = dqf?.composite === true;
let strategyAnalyticsForPayload:
  | MyAllocationDashboardPayload["strategies"][number]["strategy"]["strategy_analytics"] = null;
if (analyticsObj) {
  const { data_quality_flags: _dqf, ...analyticsRest } = analyticsObj;
  strategyAnalyticsForPayload =
    analyticsRest as MyAllocationDashboardPayload["strategies"][number]["strategy"]["strategy_analytics"];
}
```
`returns_series` gets the identical `_rs` strip; `daily_returns` is overwritten with the
resolved array (RESEARCH §Code Examples Site 4).

**Payload-type widening pattern** (`queries.ts:1657-1669`) — P3. The `Pick<>` must grow or
`computation_status` is a TS error at the consumer:
```ts
      is_composite: boolean;
      strategy_analytics: Pick<
        StrategyAnalytics,
        "daily_returns" | "cagr" | "sharpe" | "volatility" | "max_drawdown"
      > | null;
```
Note the sibling field `is_composite: boolean` at `:1665` — a **derived** boolean promoted to
the payload's own type rather than shipping the raw column. `series_state` on the book path
should follow that same shape (derived field on the payload type, raw column stripped).

**⛔ Pinned slice — do not move the block** (`phase-84-asset-class-flow.test.ts:23-32`): the
test slices `queries.ts` between `"strategy:strategies!inner ("` and the **next**
`"strategy_analytics ("` and asserts `asset_class` is inside. Adding columns *inside* the
`strategy_analytics ( … )` block is safe; relocating either marker is not.

---

### `src/app/scenario-share/[token]/page.tsx` (RSC page, sibling read)

**Analog:** `page.tsx:150-198` — the Phase-84 `asset_class` sibling read, in the same file,
with its own comment block naming the CI gate as the reason it exists.

**Sibling-read pattern to copy verbatim** (`page.tsx:162-198`):
```ts
const assetClassById: Record<string, string | null> = {};
const seriesIds = (row.series ?? []).map((s) => s.strategy_id);
if (seriesIds.length > 0) {
  try {
    // Published-only via withPublishedOnly (service-role-safe, visibility.ts):
    // keeps the `no-raw-published-predicate` lint tripwire ACTIVE on this
    // high-risk BYPASSRLS file …
    const { data: acRows, error: acError } = await withPublishedOnly(
      admin.from("strategies").select("id, asset_class").in("id", seriesIds),
    );
    if (acError) {
      // error-absent ≠ legit-absent: a PostgREST error … returns {data:null,error}
      // WITHOUT throwing, and a silent empty lookup would understate … Log so a
      // schema/RLS fault is debuggable; still degrade to 252.
      console.error("[scenario-share/page] asset_class basis read failed", {
        message: (acError as { message?: string }).message,
      });
    }
    for (const r of (acRows ?? []) as Array<{ id: string; asset_class: string | null }>) {
      assetClassById[r.id] = r.asset_class ?? null;
    }
  } catch (e) {
    console.error("[scenario-share/page] asset_class basis read threw", {
      message: (e as { message?: string }).message,
    });
  }
}
```

**Call-site pattern** (`page.tsx:205`):
```ts
const resolved = resolveSharedScenario(row, assetClassById);
```

⚠️ Two constraints the planner must carry into the action:
1. The new `returns_series` read must be a **separate query** — `page.tsx:173`'s literal
   `.select("id, asset_class")` is pinned by `phase-84-asset-class-flow.test.ts:47`.
2. The new read is on `strategy_analytics` (keyed `strategy_id`), so `withPublishedOnly` does
   **not** apply — bound it with `.in("strategy_id", seriesIds)` only, because the RPC already
   published-gated those ids (`20260622120000:205`). State that rationale in the comment, in
   the same voice as the block above.

---

### `src/app/scenario-share/[token]/share-resolve.ts` (pure resolve layer, transform)

**Analog:** the same file's Phase-84 optional-param idiom — a caller-supplied lookup threaded
into the pure layer, defaulting conservatively when absent.

**Signature pattern to copy** (`share-resolve.ts:152-162`):
```ts
export function resolveSharedScenario(
  row: SharedScenarioRow,
  /**
   * Phase 84 (BLEND-01) — strategy id → asset_class, sourced by the SSR caller
   * (page.tsx) from a published-rows-only `strategies` read of the RPC series
   * ids (a zero-DDL sibling read; the phase-29 exit gate forbids widening the
   * get_shared_scenario RPC/migration). Absent id / undefined lookup → null, the
   * conservative √252 leg, byte-identical to the pre-84 default.
   */
  assetClassById?: Record<string, string | null>,
): ResolvedSharedScenario {
```

**The line to change** (`share-resolve.ts:182-185`):
```ts
const seriesById = new Map<string, DailyPoint[]>();
for (const s of row.series ?? []) {
  seriesById.set(s.strategy_id, normalizeDailyReturns(s.daily_returns));
}
```
→ `resolveDailyReturnSeries(s.daily_returns, returnsSeriesById?.[s.strategy_id])`.

**Optional-lookup consumption pattern** (`share-resolve.ts:210-212`):
```ts
      // Phase 84 (BLEND-01): the leg's asset_class from the caller's published-
      // only lookup (absent → null, the √252 leg). Feeds the blend basis below.
      asset_class: assetClassById?.[id] ?? null,
```

⚠️ This file is in the `phase-63-series-space-guards.test.ts:87-93` scan set — its source is
read by a structural gate. Keep it import-clean (no network, no Next import); the new
resolver import must be a pure leaf (see §Shared Patterns → Leaf extraction).

---

### `src/app/api/og/factsheet/[id]/route.tsx` (route handler, request-response)

**Analog:** `src/app/factsheet/[id]/v2/page.tsx:45,60-71` for the read; the OG route's own
try/catch discipline stays.

**The read to widen** (`og/factsheet/[id]/route.tsx:31-39`):
```tsx
const res = await withPublishedOnly(
  supabase
    .from("strategies")
    .select(
      "id, name, codename, description, asset_class, strategy_analytics ( daily_returns )",
    )
    .eq("id", id),
)
  .maybeSingle();
```

**The `Array.isArray` gate the resolver replaces** (`route.tsx:59-70`):
```tsx
try {
  const analytics = Array.isArray(data?.strategy_analytics)
    ? data.strategy_analytics[0]
    : (data?.strategy_analytics as { daily_returns?: unknown } | null | undefined);
  const dailyRaw = analytics?.daily_returns;
  if (Array.isArray(dailyRaw)) {
    const rows = dailyRaw.map(d => { … });
    ({ sharpe, cagr, maxDd } = computeOgHeadline(rows, data?.asset_class));
  }
} catch (err) {
  console.error("[og:factsheet] headline metric compute failed", id, err);
}
```
Keep the embed unwrap (line 60-62) — it is an **embed**, unlike the returns route. Drop only
the `Array.isArray(dailyRaw)` gate and the hand-rolled `.map` row coercion; the resolver
always returns a validated `{date,value}[]`.

**Fail-soft discipline to preserve** (`route.tsx:41-45`):
```tsx
} catch (err) {
  // Log for production debugging; OG image still renders with the fallback.
  // (deliberately doesn't throw — broken OG image must not 500 the deploy)
  console.error("[og:factsheet] failed to load strategy", id, err);
}
```
Also preserve the CDN header block at `route.tsx:123-126` untouched (P10 — staleness is
CDN-owned).

---

### `src/lib/factsheet/resolve-series.ts` (NEW — pure utility leaf, transform)

**Analog:** `src/lib/factsheet/allocator-portfolio-payload.ts:1-58` — this is a verbatim move
of two functions plus a back-compat re-export. Do not retype them.

**Code to move** (`allocator-portfolio-payload.ts:15-37,51-58`):
```ts
export function equityCurveToDailyReturns(points: DailyPoint[]): DailyReturn[] {
  if (!Array.isArray(points) || points.length < 2) return [];
  const sorted = [...points]
    .filter((p) => p && typeof p.date === "string" && Number.isFinite(p.value) && p.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: DailyReturn[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].value;
    const curr = sorted[i].value;
    if (prev > 0 && Number.isFinite(curr)) {
      out.push({ date: sorted[i].date, value: curr / prev - 1 });
    }
  }
  return out;
}

export function resolveDailyReturnSeries(
  dailyReturnsRaw: unknown,
  returnsSeriesRaw: unknown,
): DailyReturn[] {
  const direct = normalizeDailyReturns(dailyReturnsRaw);
  if (direct.length > 0) return direct;
  return equityCurveToDailyReturns(normalizeDailyReturns(returnsSeriesRaw));
}
```
Imports the leaf needs (`allocator-portfolio-payload.ts:1-3`):
```ts
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { normalizeDailyReturns } from "@/lib/portfolio-math-utils";
import type { DailyReturn, FactsheetPayload } from "./types";
```
(`FactsheetPayload` and `./build-payload` stay behind in the original module — that is the
whole point of the extraction: `build-payload` is what drags 18 transitive imports into the
OG route and the public share page.)

Back-compat: `allocator-portfolio-payload.ts` re-exports both symbols so
`factsheet/[id]/v2/page.tsx`, `discovery/[slug]/[strategyId]/page.tsx` and
`allocator-portfolio-payload.test.ts` keep their existing import specifier at zero diff.

**`deriveEmptySeriesState` placement:** the closed-set + shared-predicate idiom at
`closed-sets.ts:423-446` is the analog — a `const … as const` tuple, a derived `type`, and a
single exported predicate with a comment explaining why every read-gate must use it:
```ts
export const STRATEGY_ANALYTICS_COMPUTATION_STATUSES = [
  "pending", "computing", "complete", "complete_with_warnings", "failed",
] as const;
export type StrategyAnalyticsComputationStatus =
  (typeof STRATEGY_ANALYTICS_COMPUTATION_STATUSES)[number];
…
export function isComputedAnalytics(status: string | null | undefined): boolean {
  return status === "complete" || status === "complete_with_warnings";
}
```

---

### `src/app/(dashboard)/allocations/components/CoverageStateChip.tsx` (component, props→render)

**Analog:** itself — extend the union and the `CHIP` record in place (UI-SPEC §1 forbids a
second chip component).

**Full current shape** (`CoverageStateChip.tsx:24-47`):
```tsx
export type CoverageState = "in-blend" | "manually-excluded" | "auto-excluded";

const CHIP: Record<CoverageState, { label: string; cls: string }> = {
  "in-blend": { label: "In blend", cls: "text-accent bg-accent/10" },
  "manually-excluded": { label: "Excluded", cls: "text-text-muted bg-track" },
  "auto-excluded": {
    label: "Outside window",
    cls: "text-warning bg-warning-bg border border-warning-border",
  },
};

// Badge ladder base (Badge.tsx:53, tightened to the 58-UI-SPEC chip tier):
// 4px radius, px-2 py-0.5, 11px uppercase medium tracking.
const BASE =
  "inline-flex items-center rounded-sm px-2 py-0.5 text-fixed-11 font-medium uppercase tracking-wide";

export function CoverageStateChip({ state, className }: CoverageStateChipProps) {
  const { label, cls } = CHIP[state];
  return <span className={cn(BASE, cls, className)}>{label}</span>;
}
```
UI-SPEC §1 adds exactly: `syncing → "Syncing"` reusing the `auto-excluded` amber trio, and
`no-series → "No data"` reusing the `manually-excluded` muted pair. The docstring at `:3-23`
carries the state→label→token table and the "presentation-only, never re-derives membership"
contract — extend that table in the same format rather than appending prose.

---

### `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (client component)

**Analog (chip precedence):** `ScenarioComposer.tsx:5582-5586` — the block being replaced, and
`:5437` (the per-key row's parallel `chipState` ternary) as the shape to mirror.

```tsx
// Phase 58 COVERAGE-02 — three-state chip, derived (NOT re-computed) from the
// row's `enabled` (the `selected` axis) + the threaded `coverageEligible` map …
const chipState: CoverageState | null = !enabled
  ? "manually-excluded"
  : coverageEligible[a.id]
    ? "in-blend"
    : null;
```
Render site (`:5622-5624`), immediately after `<TrustTierLabel …/>` — the UI-SPEC's chip slot:
```tsx
{chipState && (
  <CoverageStateChip state={chipState} className="shrink-0" />
)}
```
⚠️ The row shell at `:5592-5594` applies `opacity-50 line-through` on `!enabled` only, and the
weight input at `:5637` is `disabled={!enabled}`. Both stay as-is — the new states keep
`enabled === true`, which is what satisfies UI-SPEC acceptance items 3 and 4 without any edit.

**Analog (additive-field tolerance):** `ScenarioComposer.tsx:1332-1360`:
```ts
.then(
  (d: { daily_returns?: unknown; asset_class?: unknown; trust_tier?: unknown; is_composite?: unknown }) => {
    // A 200 with a non-array body is a malformed/failed response, NOT a
    // genuine empty series — treat it as a retryable failure (WR-01).
    if (!Array.isArray(d?.daily_returns)) {
      throw new Error("returns route body missing a daily_returns array");
    }
    // BLEND-01 — accept asset_class only when it is a string; anything else
    // (absent from a stale deploy, null, or malformed) collapses to null →
    // the leg keeps the conservative 252 blend default.
    const assetClass = typeof d.asset_class === "string" ? d.asset_class : null;
    const provenance = {
      trust_tier: typeof d.trust_tier === "string" ? d.trust_tier : null,
      is_composite: d.is_composite === true,
    };
    settle(d.daily_returns as DailyPoint[], assetClass, provenance);
  },
)
```
`series_state` gets the same treatment: a literal-match narrowing with a conservative default
("available" → no chip), never a throw.

**Analog (state-map lifecycle — a `series_state` map needs all four seams):** the
`addedAssetClassById` triple is the exact precedent for adding a parallel per-id map.
1. `settle` writer (`:1307-1317`):
```ts
const settle = (series: DailyPoint[], assetClass: string | null,
                provenance: { trust_tier: string | null; is_composite: boolean }) => {
  setAddedReturnsById((prev) => ({ ...prev, [id]: series }));
  setAddedAssetClassById((prev) => ({ ...prev, [id]: assetClass }));
  setAddedProvenanceById((prev) => ({ ...prev, [id]: provenance }));
  clearInflight();
};
```
2. Purge on remove (`:2130-2135`):
```ts
// BLEND-01 — purge the fetched asset_class alongside the returns so a
// remove + re-add starts clean (mirrors the addedReturnsById purge above).
setAddedAssetClassById((prev) => {
  if (!(id in prev)) return prev;
  const { [id]: _dropClass, ...rest } = prev;
```
3. Book-vs-lazy merge (`:2055-2075`) — the P2 site:
```ts
const addedStrategyReturnsLookup = useMemo<Record<string, DailyPoint[]>>(
  () => {
    const map: Record<string, DailyPoint[]> = {};
    for (const a of scenario.draft.addedStrategies) {
      const found = strategyById.get(a.id);
      const raw = found?.strategy.strategy_analytics?.daily_returns;
      const fromBook = normalizeBookReturns(raw);
      map[a.id] = fromBook ?? addedReturnsById[a.id] ?? [];
    }
    return map;
  },
  [scenario.draft.addedStrategies, strategyById, addedReturnsById],
);
```
4. Add seam / lazy-fetch skip (`:2093-2102`) — the P6 root cause lives here:
```ts
const handleAddStrategy = useCallback(
  (s: AddedStrategy) => {
    scenario.addStrategyBrowse(s);
    if (!strategyById.has(s.id) && addedReturnsById[s.id] === undefined) {
      fetchAddedReturns(s.id);
    }
  },
  [strategyById, addedReturnsById, fetchAddedReturns, scenario.addStrategyBrowse],
);
```
**P6 (reopen/refresh gap):** `fetchAddedReturns` has exactly two call sites (`:2097`, `:4976`),
both add seams. A hydration effect must reuse the **same guard predicate** as `:2096`
(`!strategyById.has(id) && addedReturnsById[id] === undefined`) — `fetchAddedReturns` is
already idempotent via `lazyAbortRef` (`:1282-1285`), so no second in-flight mechanism is
needed:
```ts
const fetchAddedReturns = useCallback((id: string) => {
  // Already resolved or in flight — don't refetch (idempotent multi-add).
  if (lazyAbortRef.current.has(id)) return;
```

---

### `src/__tests__/phase-147-series-resolution-guards.test.ts` (NEW — grep-gate test)

**Primary analog:** `src/__tests__/phase-84-asset-class-flow.test.ts` (49 lines, full file read).
Same three surfaces, same "one field must reach every projection or a surface silently
degrades" rationale. Copy its structure wholesale.

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 84 (#597 part 2) cross-surface asset_class-flow guard.
 *
 * WHY THIS EXISTS: … That value reaches the three blend surfaces through three
 * INDEPENDENT projections. Each surface has its own behavioural test, but those
 * are isolated — if a future edit dropped `asset_class` from ONLY ONE
 * projection, that surface would silently fall back to √252 … and every
 * per-surface test would still pass (red-team coverage gap, 2026-07-10). This
 * single structural pin fails loudly the moment any of the three source
 * projections stops selecting asset_class.
 */
const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("Phase 84 — asset_class flows to every blend surface", () => {
  it("getMyAllocationDashboard SSR select projects asset_class on the strategy join …", () => {
    const src = read("src/lib/queries.ts");
    // Scope to the dashboard strategy join block so an unrelated asset_class
    // reference elsewhere in the 3k-line file cannot false-green this pin.
    const block = src.slice(
      src.indexOf("strategy:strategies!inner ("),
      src.indexOf("strategy_analytics (", src.indexOf("strategy:strategies!inner (")),
    );
    expect(block).toContain("asset_class");
  });
  …
});
```
Copy in particular: the `ROOT`/`read` helper pair, the per-surface `it()` (one assertion per
file so the failure names the offending surface), and the **block-slicing** technique for
`queries.ts` so an unrelated match cannot false-green the pin.

**Secondary analog (fail-loud file resolution + non-vacuity record):**
`phase-63-series-space-guards.test.ts:83-109`:
```ts
/**
 * The scan set. Paths are repo-root-relative; a missing file is a test
 * FAILURE, not a skip (Rule 12) — a rename that dodges the guard must break it.
 */
const SCENARIO_SURFACE_FILES = [ … ] as const;

/** Read a scan-set source fail-loud (missing file → explicit test failure). */
function readSource(relPath: string): string {
  const abs = join(process.cwd(), relPath);
  if (!existsSync(abs)) {
    throw new Error(
      `ENGINE-05 scan-set file is missing: ${relPath}. A rename or move must ` +
        `carry the guard with it — a missing scanned source is a FAILURE, not ` +
        `a skip (the deletion invariant would otherwise silently stop being ` +
        `enforced).`,
    );
  }
  return readFileSync(abs, "utf8");
}
```
And its docstring's two structural conventions the Phase-147 gate must reproduce
(`phase-63:30-52`): (a) an **explicit allowlist** with a per-file rationale rather than a
blanket string ban, and (b) a recorded **Rule-9 non-vacuity** paragraph:
```
 * Rule-9 non-vacuity (recorded in the commit message):
 *   - Source-scan: temporarily planted `collapseAliasedHoldingStrategies` into
 *     scenario-compare.ts — the per-file it() went red — then reverted.
```

---

### `src/app/api/strategies/[id]/returns/route.test.ts` (extend)

**Analog:** itself — the harness already captures the analytics select string, which is
exactly what the SC2/SC3 assertions need.

**Fixture state to widen** (`route.test.ts:87-92, 106-108`):
```ts
  analyticsRow: { daily_returns: [] as unknown } as
    | { daily_returns: unknown; data_quality_flags?: unknown }
    | null,
  analyticsQueryError: null as { code: string; message: string } | null,
  …
    strategiesSelect: null as string | null,
    analyticsSelect: null as string | null,
```
**Mock arm to extend** (`route.test.ts:203-226`):
```ts
if (table === "strategy_analytics") {
  STATE.strategiesQueried = true;
  const builder = {
    select: (cols: string) => { STATE.observedFilters.analyticsSelect = cols; return builder; },
    eq: (col: string, val: string) => {
      if (col === "strategy_id") STATE.observedFilters.analyticsEqStrategyId = val;
      return builder;
    },
    maybeSingle: async () => {
      if (STATE.analyticsQueryError) return { data: null, error: STATE.analyticsQueryError };
      return { data: STATE.analyticsRow, error: null };
    },
  };
  return builder;
}
```
`STATE.observedFilters.analyticsSelect` is already recorded → the SC2 route-level assertion
(`expect(analyticsSelect).toContain("returns_series")`) needs **no harness change**, only a
new `it()`. `analyticsRow` needs `returns_series` + `computation_status` added to its type.

**Coverage-matrix docstring convention** (`route.test.ts:13-39`) — every case is an R-numbered
line in the file docstring (`R1 … R8`, `R4b`, `R5b`, `R7b`). New cases must be appended in
that numbering, not added silently.

**SC3 oracle analog** (`allocator-portfolio-payload.test.ts:156-180`) — note it asserts an
**economic invariant** (`Math.abs(got[0].value) < 0.05` for a wealth curve near 1.0), not the
helper's own formula. The route-level SC3 test must do the same: feed a `returns_series`
starting at exactly `1.0` and assert day one is **not** `+1.0` (per the money-math oracle rule
and P4's N−1 note — never assert `toBe(136)`).

---

### `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` (extend)

**Analog:** its own `LAZY_ID` fixture block (`:1155-1230`). The fetch mock keyed on the route
URL is the seam every new `series_state` case reuses:
```ts
const LAZY_ID = "aaaaaaaa-1111-2222-3333-444444444444";
…
if (String(url).includes(`/api/strategies/${LAZY_ID}/returns`)) {
  … json: async () => ({ daily_returns: LAZY_SERIES, … })
}
```
Existing lookup probes `latestReturnsLookup()` / `latestAssetClassLookup()` (`:1226-1358`) are
the pattern for a `latestSeriesStateLookup()` if one is needed. Book-path fixtures come from
the payload builder at `:242` (`strategies.map((s) => [s.id, s.daily_returns])`).

---

### `src/app/(dashboard)/allocations/components/CoverageStateChip.test.tsx` (extend)

**Analog:** itself (77 lines, full file read). Each state is one `it()` asserting label + each
token class, plus an explicit **negative** assertion for red:
```tsx
it("auto-excluded → 'Outside window' with amber (warning) tokens, never red", () => {
  render(<CoverageStateChip state="auto-excluded" />);
  const chip = screen.getByText("Outside window");
  expect(chip.className).toContain("text-warning");
  expect(chip.className).toContain("bg-warning-bg");
  expect(chip.className).toContain("border-warning-border");
  // Transient-recoverable → amber, NEVER negative/red.
  expect(chip.className).not.toMatch(/text-negative|bg-red|text-red/);
});
```
The `never red` negative assertion is exactly UI-SPEC acceptance item 5 — copy it for both new
states. Also extend the `states: CoverageState[]` ladder test at `:51-70` (it enumerates the
union; a new member added without updating it leaves the base-shape pin partially vacuous).

---

### `src/app/scenario-share/[token]/share-resolve.test.ts` (extend)

**Analog:** itself (`:1-80`). Deterministic fixture builders `makeSeries` / `makeSeriesFrom`
produce daily-return series; a wealth-index fixture for the SC3 case should be a sibling
builder in the same style (deterministic, no randomness, explicit start date), and the docstring
convention is a WHY-block naming the landmine the tests mutation-prove.

---

## Shared Patterns

### 1. Server-side resolution, byte-identical wire shape
**Source:** `src/app/factsheet/[id]/v2/page.tsx:60-71` (reference implementation),
`src/lib/queries.ts:3537-3541` (strip-the-raw-blob idiom)
**Apply to:** all four read sites.
Widen the select → resolve on the server → emit the **same field name** with the resolved
array → strip the raw `returns_series` from anything crossing to a client.

### 2. Redacted DB error + Sentry breadcrumb, never `error.message` to the caller
**Source:** `src/app/api/strategies/[id]/returns/route.ts:225-236`
**Apply to:** the returns route (must survive the widening — T-29-02).
```ts
console.error("[api/strategies/returns] select error:", error);
captureToSentry(error, { tags: { route: "api/strategies/returns" } });
return NextResponse.json({ error: "Failed to load returns" },
  { status: 500, headers: NO_STORE_HEADERS });
```

### 3. Fail-soft enrichment read on a public page (error-absent ≠ legit-absent)
**Source:** `src/app/scenario-share/[token]/page.tsx:172-197`
**Apply to:** the share-page sibling read, and the OG route's outer try/catch
(`og/factsheet/[id]/route.tsx:41-45`).
Log both the PostgREST-`{data:null,error}` arm **and** the throw arm; degrade to an empty
lookup; never throw on a public page.

### 4. Additive-field tolerance on a client boundary
**Source:** `ScenarioComposer.tsx:1344-1356`
**Apply to:** every consumer of the new `series_state`.
Accept only known literals; anything else (stale deploy, null, malformed) → conservative
default; never a throw, never a false "Syncing".

### 5. Structural grep-gate: explicit allowlist, block-scoped slices, fail-loud on missing file
**Source:** `phase-84-asset-class-flow.test.ts` (whole file) + `phase-63-series-space-guards.test.ts:83-109`
**Apply to:** `phase-147-series-resolution-guards.test.ts`.
Plus: record the non-vacuity experiment (plant a bare `daily_returns` select → watch red →
revert) in the commit message, as `phase-63:47-52` does.

### 6. Presentation-only chip; state derived upstream, never re-derived
**Source:** `CoverageStateChip.tsx:3-23` (docstring contract), `ScenarioComposer.tsx:5574-5586`
(derivation site)
**Apply to:** both new chip states. The chip must not learn about `computation_status`.

### 7. Closed set + one shared predicate
**Source:** `src/lib/closed-sets.ts:423-446`
**Apply to:** `SeriesState` and any terminal-status gate. Use `isComputedAnalytics()`, never
`=== "complete"`.

---

## Pinned Literals — CI breaks if these change

| Literal | File:line | Pinned by |
|---------|-----------|-----------|
| `.select("id, asset_class")` on the returns-route probe | `returns/route.ts:194` | `phase-84-asset-class-flow.test.ts:42` |
| `.select("id, asset_class")` on the share page | `scenario-share/[token]/page.tsx:173` | `phase-84-asset-class-flow.test.ts:47` |
| `strategy:strategies!inner (` … next `strategy_analytics (` slice containing `asset_class` | `queries.ts:3390-3405` | `phase-84-asset-class-flow.test.ts:23-32` |
| `share-resolve.ts` present in the scan set (rename = failure) | `share-resolve.ts` | `phase-63-series-space-guards.test.ts:87-93,97-109` |
| Any new `supabase/migrations/**` matching `/scenario\|share/i` | — | `phase-29-frozen-spine-guards.test.ts:141,150-166` |
| `NO_STORE_HEADERS` on every returns-route arm | `returns/route.ts` (all arms) | `src/__tests__/no-store-coverage.test.ts` |

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/app/api/og/factsheet/[id]/route.test.tsx` | route test | request-response | **`next/og` is imported exactly once in the repo** (`src/app/api/og/factsheet/[id]/route.tsx:1`) and has **zero** mock precedent — no test anywhere constructs or stubs `ImageResponse`. Partial analogs only: `src/app/api/strategies/[id]/sync-progress/route.test.ts:1-80` for the `vi.hoisted` + `vi.mock("@/lib/supabase/server")` harness (its docstring already documents the mocking strategy in the house style), and `src/lib/factsheet/og-metrics.test.ts` for the headline-metric oracle. **Planner guidance:** the cheapest honest gate is to assert the *inputs* — mock `next/og`'s `ImageResponse` to capture its element tree (or spy on `computeOgHeadline`) and assert `sharpe`/`cagr` are finite when only `returns_series` is populated. Do not attempt to render a real PNG under vitest. |

---

## Metadata

**Analog search scope:** `src/app/api/`, `src/app/(dashboard)/allocations/components/`,
`src/app/scenario-share/[token]/`, `src/app/factsheet/[id]/v2/`, `src/lib/`,
`src/lib/factsheet/`, `src/__tests__/`
**Files read this session (non-overlapping ranges):** `allocator-portfolio-payload.ts:1-80`,
`allocator-portfolio-payload.test.ts:140-212`, `returns/route.ts` (full),
`returns/route.test.ts:1-190` + `190-300`, `CoverageStateChip.tsx` (full),
`CoverageStateChip.test.tsx` (full), `phase-84-asset-class-flow.test.ts` (full),
`phase-63-series-space-guards.test.ts:1-110`, `og/factsheet/[id]/route.tsx` (full),
`scenario-share/[token]/page.tsx:120-230`, `share-resolve.ts:140-220`,
`share-resolve.test.ts:1-80`, `queries.ts:1650-1690, 3390-3440, 3520-3570`,
`closed-sets.ts:400-483`, `ScenarioComposer.tsx:1281-1371, 2055-2135, 5570-5645`,
`factsheet/[id]/v2/page.tsx:40-80`, `sync-progress/route.test.ts:1-80`
**Project skills:** none — no `.claude/skills/` or `.agents/skills/` directory exists
**Pattern extraction date:** 2026-08-04

# Phase 197: SCREEN - Pattern Map

**Mapped:** 2026-11-08
**Files analyzed:** 16 (new + modified; factsheet files excluded, Phase 196 owns them)
**Analogs found:** 15 / 16

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/lib/freshness.ts` (modify: `SERIES_STALE_DAYS_TRADITIONAL`, `listSeriesVerdict`) | utility | transform | same file, `bucketSeriesAge` (:250-271), `SERIES_STALE_DAYS` (:124) | exact |
| `src/lib/figure-gate.ts` (modify: exported start-date helper that `figureSpan` calls) | utility | transform | same file, `figureSpan` (:95-106) | exact |
| `src/lib/discovery/shared-account-partners.ts` (NEW, server-only) | service | request-response (service-role read + pure grouping) | `src/lib/record-span-read.ts` (server-only, published-only read, fail-closed + Sentry) and `src/app/(dashboard)/admin/page.tsx:17-23` (admin client) | role-match |
| `src/lib/discovery/shared-account-partners.test.ts` (NEW) | test | unit | `src/app/(dashboard)/compare/page.test.tsx` (server-only mock idiom) | partial |
| `src/components/strategy/StrategyTable.tsx` (modify: column map, Track, unsigned vol, stale partition, selection + sticky bar, admin line) | component | transform/render | same file (`COLUMNS` :304-317, `isDisplayedRow` :288-294, comparator :903-916, `rankOrdinals` :940-947) | exact |
| `src/components/strategy/StrategyGrid.tsx` (modify: footer reads the column map, stale chip, select) | component | render | `StrategyTable.tsx` column map | role-match |
| `src/components/strategy/StrategyTable.stale-series.test.tsx` (NEW) | test | component | `src/components/strategy/StrategyTable.stale-analytics.test.tsx` | exact |
| `src/components/strategy/StrategyTable.headers.test.tsx` (NEW) | test | component | `StrategyTable.stale-analytics.test.tsx`, `StrategyTable.sign-tone.test.tsx` | role-match |
| `src/components/strategy/StrategyTable.selection.test.tsx` (NEW) | test | component | `StrategyTable.stale-analytics.test.tsx` | role-match |
| `src/app/(dashboard)/discovery/[slug]/page.tsx` (modify: isAdmin, partners, `selectable`, `nowMs`) | route (RSC page) | request-response | same file + `admin/page.tsx:17-23` | exact |
| `src/app/(dashboard)/discovery/[slug]/page.test.tsx` (NEW) | test | RSC page | `src/app/(dashboard)/compare/page.test.tsx` | exact |
| `src/app/browse/[slug]/page.tsx` (modify: `nowMs` only, no `selectable`, no partners) | route | request-response | discovery page | exact |
| `src/app/(dashboard)/compare/page.tsx` (modify: delete "not available yet" copy at :80 and :301, removeHref, mount search) | route | request-response | same file | exact |
| `src/components/strategy/CompareTable.tsx` (modify: per-column Remove link from server-computed href) | component | render | same file `CompareTable({ items })` (:96) | exact |
| `src/app/(dashboard)/compare/CompareAddStrategy.tsx` (NEW, "use client") | component | request-response (fetch once + client filter) | `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx` (:223-270 fetch, :338-348 filter) | exact |
| `src/app/(dashboard)/compare/CompareAddStrategy.test.tsx` (NEW) | test | component | StrategyBrowseDrawer tests / `@/test/helpers/fetch` (`installFetchMock`) | role-match |
| `src/__tests__/phase-149-my-strategies-parity.test.ts` (modify: absence pin for `selectable`/`sharedAccountPartners` on public pages, next to pin 2 :440-457) | test | static source pin | same file | exact |
| Header-label census (`StrategyTable.test.tsx`, `.visibility`, `.manager-rows` :174-182 / :956-1015, `.phone-columns` :115, `phase-52-container-tabular-nums.test.tsx:230-267`, `figure-parity-pages.test.tsx:525-604`, `e2e/layout-narrow.spec.ts`) | test | update | n/a, edit in place | n/a |

## Pattern Assignments

### `src/lib/freshness.ts` (utility, transform)

**Analog:** `bucketSeriesAge` in the same file (:250-271). Copy its whole-UTC-day arithmetic exactly; do not fork a new ladder.
```ts
export const SERIES_FRESH_DAYS = 3;
export const SERIES_STALE_DAYS = 7;          // :123-124, reuse for crypto
...
const days = Math.floor((now.getTime() - seriesEndMs) / (1000 * 60 * 60 * 24));
if (!Number.isFinite(days)) return "stale";
...
if (days <= SERIES_STALE_DAYS) return "warm";
return "stale";                               // so "stale" means days > 7
```
Add the sibling constant beside :124 and the exported pure verdict per RESEARCH "Code Examples / Stale verdict". Crypto vs traditional via `annualizationPeriods(asset_class)` (`src/lib/closed-sets.ts:616-620`, null reads as traditional = 10 days). Never read `computed_at`. Document the constant with a header comment in this file's style (phase + decision id + why).

### `src/lib/figure-gate.ts` (utility)
**Analog:** `figureSpan` (:95-106). Extract the "later of `series_start` and readable `headline_since`" into one exported helper that `figureSpan` itself calls, so Track months (`floor(spanDays*12/365.25)`) and its `title` start date cannot disagree. No literals 60/90/365 restated (194 rule).

### `src/lib/discovery/shared-account-partners.ts` (service, server-only)

**Analog A (module shape, fail-closed, Sentry):** `src/lib/record-span-read.ts`
Imports (:1-5):
```ts
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { withPublishedOnly } from "@/lib/visibility";
import { captureToSentry } from "@/lib/sentry-capture";
```
Core read + fail closed (:60-83, :90-101):
```ts
try {
  const { data, error } = await withPublishedOnly(
    supabase.from("strategies").select(RECORD_SPAN_SELECT).eq("id", strategyId),
  ).maybeSingle();
  if (error) return failed(strategyId, "read_error", error.message);
  ...
} catch (err) {
  return failed(strategyId, "read_threw", err instanceof Error ? err.message : String(err));
}

function failed(strategyId, reason, detail): RecordSpanRead {
  captureToSentry(new Error(`record span read ${reason}`), {
    tags: { stage: "record-span-read", reason, strategy_id: strategyId },
    extra: { detail },
  });
  return { determined: false };
}
```
For this module: return `null` on any failure (caller renders no notices), never throw. Long doc-comment header stating why the read exists, what never leaves it (no exchange, venue id, key id, label), and that `withPublishedOnly` is the ONLY fence because service role bypasses RLS (D-02, Pitfall 7).

**Analog B (service-role client):** `src/app/(dashboard)/admin/page.tsx:1-3, 23`
```ts
import { createAdminClient } from "@/lib/supabase/admin";
...
const admin = createAdminClient();
```
`createAdminClient()` is untyped (`src/lib/supabase/admin.ts:3-8` note), so use `.returns<Row[]>()` as admin/page.tsx does (:30-35 comment, H-0353). Select only `id, exchange, venue_account_id, account_shared_with_api_key_id` from `api_keys`; `id, name, api_key_id` from strategies via `withPublishedOnly`; `strategy_id, api_key_id` from `strategy_keys`. Grouping core: RESEARCH "Partner grouping core" (identity rule mirrors `analytics-service/services/job_worker.py:15272-15301`). Keep the grouping as an exported pure function so the test hits it without Supabase.

### `src/lib/discovery/shared-account-partners.test.ts` (test)
**Analog:** `src/app/(dashboard)/compare/page.test.tsx:13-25`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// server-only package throws in jsdom test environment — mock to no-op.
vi.mock("server-only", () => ({}));
```
Must include: unpublished partner never named and never makes a published row show a notice; output contains no account identifiers; blank venue id never collides. Neuter-and-see-RED per repo testing rule.

### `src/components/strategy/StrategyTable.tsx` (component)

**Column map** (at HEAD :304-317, quoted in RESEARCH Pattern 1): replace `label` with label + qualifier + tooltip + accessible name; inline sparkline/Actions headers at :1293-1295. Add `"track"` to `TableSortKey` (:100) only, never `SortKey` (`src/lib/discovery-types.ts:13-20`, codec `src/lib/discovery-prefs.ts:29`). Tooltip via `src/components/ui/Tooltip.tsx`.

**Unsigned vol** (:1312): `formatPercent(volatilityShown, 2, { signed: false })` (`src/lib/utils.ts:15` default signed).

**Hoisted predicate pattern** (:288-294) — add the stale verdict the same way, one function shared by sort, rank and render:
```ts
function isDisplayedRow(s: StrategyWithAnalytics): boolean {
  return isComputedAnalytics(rowChipStatus(s)) || s.analytics.analytics_updating === true;
}
function isRankedRow(s: StrategyWithAnalytics): boolean {
  return isDisplayedRow(s);
}
```
**Comparator** (:903-916) — insert current-before-stale after the displayed partition, gated on `visibility === "published-only"`:
```ts
if (effectiveSortKey !== "created_at") {
  const aRanked = isRankedRow(a);
  const bRanked = isRankedRow(b);
  if (aRanked !== bRanked) return aRanked ? -1 : 1;
}
return compareWithMissingLast(
  getSortValue(a, effectiveSortKey),
  getSortValue(b, effectiveSortKey),
  effectiveSortDir,
);
```
**Rank map** (:940-947) — count current displayed rows only:
```ts
const rankOrdinals = useMemo(() => {
  const ordinals = new Map<string, number>();
  let next = 0;
  for (const s of filtered) {
    if (isRankedRow(s)) ordinals.set(s.id, ++next);
  }
  return ordinals;
}, [filtered]);
```
`pctSuffix` (:1045-1061) returns null for stale rows. Selection: opt-in `selectable` prop; extend `usePinnedStackOffsets` (:128-159) to measure the select cell (no px literal); `emptyRowColSpan` (:1024-1025) counts select + Track. Compare href `/compare?ids=${ids.join(",")}` (≤4), matching `compare/page.tsx:63` parse. Clock: use the page-provided `nowMs` (Pitfall 6), not `Date.now()` in render.

### `src/components/strategy/StrategyTable.stale-series.test.tsx` and siblings (test)
**Analog:** `src/components/strategy/StrategyTable.stale-analytics.test.tsx` — copy its header-docblock convention (defect, why, anti-vacuity: distinctive non-null fixture values + a control row in every group, witnessed RED), and imports (:61-64):
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, within, fireEvent } from "@testing-library/react";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";
```
Use a frozen clock (`vi.useFakeTimers`/`setSystemTime`) and fixtures with explicit `series_end`. Pitfall 1: existing published-only fixtures need a current `series_end`.

### `src/app/(dashboard)/discovery/[slug]/page.tsx` (RSC page)
**Analog:** current file (:33-56 auth + `Promise.all`) plus admin gate from `admin/page.tsx:21`:
```ts
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) redirect("/login");
...
const [strategies, portfolio, watchedSet, percentiles] = await Promise.all([...]);
```
Add `isAdminUser(supabase, user)` (`src/lib/admin.ts:283`, never throws, fails closed) and conditionally call `getSharedAccountPartners()`; spread the prop only when non-null (RESEARCH "Admin-gated page wiring"). Never pass `{}` to non-admins. Keep `key={`${user.id}:${slug}`}`.

### `src/app/(dashboard)/discovery/[slug]/page.test.tsx` (test)
**Analog:** `src/app/(dashboard)/compare/page.test.tsx:13-40` — mock `server-only`, `next/navigation` (`redirect: vi.fn()`), `PageHeader`/`Breadcrumb` stubs, and a recording stub for the child (like `overlayItems` capture :43-55) to record `StrategyTable` props. Assert: non-admin props have no `sharedAccountPartners` key and the reader is not called; admin receives the map; reader null → prop absent.

### `src/app/(dashboard)/compare/page.tsx` (RSC page)
**Analog:** same file. Delete the copy at :80 and :301; keep `PageHeader title="Compare strategies"` (e2e anchor). Auth stays (:55-60, `requireRolePage(..., "allocator")` outside try/catch). Compute `removeHref` per id from the parsed `ids` (:63) and pass to `CompareTable`; mount `<CompareAddStrategy currentIds={ids} />` in empty, all-unavailable, 1-item and 2-3-item states, not at 4.

### `src/app/(dashboard)/compare/CompareAddStrategy.tsx` (client component)
**Analog:** `StrategyBrowseDrawer.tsx:223-270` fetch idiom (AbortController + `cancelled` flag, loud error state, no silent AbortError swallow):
```ts
const controller = new AbortController();
const res = await fetch("/api/strategies/browse", { signal: controller.signal });
if (!res.ok) throw new Error(`Failed to load strategies (${res.status})`);
const json = (await res.json()) as { strategies?: StrategyBrowseRow[] };
...
.catch((e) => { if (cancelled) return; console.error(...); setError(...); setLoading(false); });
return () => { cancelled = true; controller.abort(); };
```
Filter (:338-348):
```ts
const q = search.trim().toLowerCase();
const nameMatch = s.name.toLowerCase().includes(q);
const codenameMatch = (s.codename ?? "").toLowerCase().includes(q);
```
Fetch once on first qualifying input (≥2 chars), debounce 250 ms, drop `isOwn && status !== "published"` and ids already compared, then `router.push` (`next/navigation`) with a path built from ids only. Inputs from `src/components/ui/Input.tsx`, `Button.tsx` per UI-SPEC. Inject an optional `fetchStrategies` prop for tests, as the drawer does.

## Shared Patterns

### Server-only + service-role confinement
**Source:** `src/lib/supabase/admin.ts:1` (`import "server-only"`), `src/lib/record-span-read.ts:1`. Apply to `shared-account-partners.ts`. Tests mock `server-only` to `{}`.

### Published-only fence
**Source:** `withPublishedOnly` from `@/lib/visibility` (used in `record-span-read.ts:62`, `compare/page.tsx:93`). Apply to every strategies read in the partner reader.

### Admin check
**Source:** `isAdminUser` `src/lib/admin.ts:283-` (fails closed, never throws). Precedent `admin/page.tsx:21`.

### Fail closed + Sentry
**Source:** `record-span-read.ts:90-101` `captureToSentry(new Error(...), { tags: { stage, reason }, extra })`. `console.*` does not reach Sentry in this repo.

### No restated thresholds
Import `SERIES_STALE_DAYS` / new traditional constant and `annualizationPeriods`; never literal 7, 10, 365 in components (194 rule).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Sticky "Compare (n)" bar inside `StrategyTable.tsx` | component | client state | No existing sticky multi-select action bar; follow UI-SPEC directly |

## Metadata
**Analog search scope:** `src/lib`, `src/components/strategy`, `src/app/(dashboard)/{admin,compare,discovery,allocations}`, `src/app/browse`
**Files scanned:** ~20
**Pattern extraction date:** 2026-11-08

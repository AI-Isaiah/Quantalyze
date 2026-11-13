# Phase 198: MYBOOK - Pattern Map

**Mapped:** 2026-11-08
**Files analyzed:** 26 (9 new source + 8 new tests + 9 modified source; existing tests to rewrite are listed separately)
**Analogs found:** 26 / 26 (3 are partial; see "No Analog Found")

> Conventions. Paths are repo-relative (public repo). Every analog below was verified as git-tracked source (`git ls-files`), none is a gitignored mirror. `A/` means `src/app/(dashboard)/allocations`. Line numbers are at worktree HEAD (rebased on `e9277565e`) and are paired with a symbol because they drift. Research corrections C1-C9 in `198-RESEARCH.md` override `198-UI-SPEC.md`; decisions D-05..D-08 in `198-CONTEXT.md` are locked.

## File Classification

### New source

| New file | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `A/lib/book-figures.ts` | utility (pure display-string builder) | transform | `A/lib/exposure-snapshot.ts` + `src/lib/holding-equity.ts` | role-match |
| `A/lib/cash-symbols.ts` | utility (closed set + predicate) | transform | `FIXED_MARK_SET` in `src/app/(dashboard)/compare/lib/holding-compare-adapter.ts` (+ its parity test) | exact (set + parity test) |
| `A/lib/dust.ts` | utility (pure predicate/partition) | transform | `A/lib/exposure-snapshot.ts` (pure builder over payload rows) + `holdingIsPriceGap` in `src/lib/holding-equity.ts` | role-match |
| `A/lib/key-data-gaps.ts` | utility (server-callable, pure) | transform | `readFailingKeyExits` in `src/lib/queries.ts` (owner-key filter) + `marksIncludedKeys` (per-key first/last day scan) | role-match |
| `A/components/AddAllocationFlow.tsx` | component (slide-over, 2-step form + two writes) | request-response | `A/components/StrategyBrowseDrawer.tsx` (shell, fetch-on-open, list) + `A/components/AllocateDialog.tsx` (write, envelope, amount) + `A/components/ScenarioCommitDrawer.tsx` (idempotency key, commit fetch) | exact (composite) |
| `A/components/GlancePanel.tsx` | component (data panel, 3 groups) | transform (render) | `src/components/kpi/KpiPanel.tsx` + `A/components/KpiStrip.tsx` cells | exact |
| `A/components/MissingDataMessage.tsx` | component (static sentences) | transform (render) | `FailingKeyExitNote` / `UnpricedAccountNote` in `A/AllocationDashboardV2.tsx` + `A/components/EquityHistoryRebuilding.tsx` | exact |

### Modified source

| Modified file | Role | Data flow | Closest analog / pattern source | Match |
|---|---|---|---|---|
| `A/AllocationsTabs.tsx` | component (tab shell) | event-driven (URL state) | itself (`parseTab`, `changeTab`, URL-cleanup effect) | self |
| `A/AllocationDashboardV2.tsx` | component (Overview body) | transform (render) | itself (banner stack, `historyGate` branches) + `A/RiskTabPanel.tsx` (panel to fold in) | self |
| `A/components/EquityHistoryRebuilding.tsx` | component | transform | itself (keep `equityHistoryRebuildClass`, `ExchangesPageLink`) | self |
| `A/HoldingsTabPanel.tsx` | component (Holdings body) | transform | itself (`spotHoldingRows`, `openPositionRows`, section order) | self |
| `A/components/HoldingsTable.tsx` | component | transform | itself (`isOwnCapital && !isAllocated` branch, Type cell) | self |
| `A/components/OpenPositionsTable.tsx` | component | transform | `HoldingsTable.tsx` spot table (dust/Cash/flag chip idiom) | role-match |
| `A/widgets/positions/ExposureByClass.tsx` | component (widget) | transform | itself (`KpiCell`, strip, legend) | self |
| `A/lib/exposure-snapshot.ts` | utility | transform | itself (builder over `holdingsSummary` rows) | self |
| `A/components/ScenarioComposer.tsx` | component | transform | itself (`gatedLiveMetrics`, `liveSharpeState`) | self |
| `src/lib/queries.ts` (`getMyAllocationDashboard`, payload type) | service | CRUD (read) | `failingKeyExits` / `unpricedNativeAccounts` additive optional payload fields | exact |
| `src/components/layout/Sidebar.tsx` (`buildPrimaryMobileNav`) and `A/components/BridgeWidget.tsx:241` | component | request-response (link) | themselves (retired `tab=` hrefs) | self |
| `A/ScenarioFlaggedHoldingsList.tsx` (C9, highest effort) | component | event-driven (Bridge V2 state machine) | itself | self |

### New tests

| New test | Closest analog test |
|---|---|
| `A/lib/book-figures.test.ts` | `A/lib/history-gate.test.ts` (it.each table over payload fragments) |
| `A/lib/cash-symbols.test.ts` | "fixed-mark set parity" describe in `src/app/(dashboard)/compare/lib/holding-compare-adapter.test.ts` |
| `A/lib/dust.test.ts`, `A/lib/key-data-gaps.test.ts` | `A/lib/history-gate.test.ts` |
| `A/components/AddAllocationFlow.test.tsx` | `A/components/AllocateDialog.test.tsx` + `A/components/ScenarioCommitDrawer.test.tsx` |
| `A/components/GlancePanel.test.tsx` | `A/OverviewRisk.history-parity.test.tsx` (two surfaces, one payload) |
| `A/components/MissingDataMessage.test.tsx` | `A/AllocationDashboardV2.failing-key.test.tsx` |
| `A/HoldingsTabPanel.positions-once.test.tsx`, `A/HoldingsTabPanel.dust.test.tsx` | `A/HoldingsTabPanel.per-key-rows.test.tsx`, `A/HoldingsTabPanel.spot-derivative-split.test.tsx` |
| `A/AllocationsTabs.add-param.test.tsx` | `A/AllocationsTabs.addalloc.test.tsx` (harness) |
| `e2e/allocations-add.spec.ts` | `e2e/composer-axe.spec.ts` (seeded, skip-when-unseeded, visible-anchor gates) + `e2e/wizard-resume.spec.ts` (header click) |

---

## Pattern Assignments

### `A/lib/book-figures.ts` (utility, transform)

**Analogs:** `src/lib/holding-equity.ts` (`holdingEquityContribution`, `holdingEquityIsReported`) for the Book equity sum; `A/components/KpiStrip.tsx` lines ~333-345 and ~424-450 for which payload value each glance cell must equal; `A/components/ScenarioComposer.tsx` ~4474-4506 for the gate.

**Book equity (research C5): sum `holdingEquityContribution` over EVERY `holdingsSummary` row, never `liveBaselineMetrics.aum`.** Copy the contribution rule (`src/lib/holding-equity.ts`, function `holdingEquityContribution`):
```typescript
export function holdingEquityContribution(h: HoldingEquityInput): number | null {
  if (h.holding_type === "derivative") {
    const pnl = h.unrealized_pnl_usd;
    if (pnl == null) return null;
    return Number.isFinite(pnl) ? pnl : 0;
  }
  return Number.isFinite(h.value_usd) && h.value_usd !== null ? h.value_usd : 0;
}
```
Use `holdingEquityIsReported` to count derivative rows with no P&L (state that count next to Book equity when > 0). Spot cash rows are spot rows and stay in Book equity (cash is equity; only exposure excludes it).

**Pure-builder-over-payload idiom** (`A/lib/exposure-snapshot.ts`, header + types):
```typescript
import type { MyAllocationDashboardPayload } from "@/lib/queries";
type PayloadHolding = MyAllocationDashboardPayload["holdingsSummary"][number];
export type ExposureHoldingRow = Pick<PayloadHolding,
  "api_key_id" | "venue" | "symbol" | "holding_type" | "side" | "value_usd" | "asof">;
export function exposureSnapshotFromHoldings(rows: ReadonlyArray<ExposureHoldingRow>): ExposureSnapshot | null {
  if (rows.length === 0) return null;
```
Type-only imports, no Supabase client, `Pick<>` of the columns read, empty book returns `null` (never a zero-filled value).

**Glance cell sources (what must be byte-equal to Scenario's live strip)** (`KpiStrip.tsx` ~333-345):
```typescript
const ytdValue: number | null = analytics?.ytd_twr ?? metrics?.twr ?? null;
const sharpeValue: number | null = analytics?.sharpe ?? metrics?.sharpe ?? null;
const maxDdValue: number | null = analytics?.max_drawdown_12m ?? metrics?.max_drawdown ?? null;
// cells: formatPercent(ytd), formatNumber(sharpe, 2), formatPercent(maxDd); allKeysStale -> null -> "—"
```
`book-figures` returns display STRINGS (not numbers) so glance, Positions header and Scenario strip are byte-equal by construction (Research Pattern 2). Formatters only: `formatPercent`/`formatNumber` from `@/lib/utils`, `formatUsd` from `@/lib/dollar-validation`; bare `.toFixed` is census-pinned (`src/__tests__/display-sign-single-source.test.ts`, R1-R8).

**D-06 gate (Sharpe must go through `figure-gate`, or 194.1's `figure-gate-census` fails).** Pattern to copy from `ScenarioComposer.tsx` `liveSharpeState` / `gatedLiveMetrics` (~4492-4506):
```typescript
const liveSharpeState: FigureState = ownBookUnreadable
  ? "withheld"
  : deltaRecords !== undefined
    ? gateAnnualized(deltaRecords.book)
    : "null";
const gatedLiveMetrics = useMemo<ComputedMetrics>(
  () => ({ ...liveMetricsForKpi, sharpe: gatedValue(liveMetricsForKpi.sharpe, liveSharpeState) }),
  [liveMetricsForKpi, liveSharpeState],
);
```
Record builder: `figureRecord({ seriesStart, seriesEnd, headlineSince, observations, periodsPerYear })` (`src/lib/figure-gate.ts`). Note the Scenario strip's `metrics={liveMetricsForKpi}` is UNGATED (`ScenarioComposer.tsx` ~6012-6020, `<KpiStrip ... liveMetrics={gatedLiveMetrics} metrics={liveMetricsForKpi}>`), which is the C6/FD-2 defect. Plan the shared module so Scenario's live Sharpe cell reads the gated value too (edit lands in `ScenarioComposer.tsx`; 194.1 plan 07 touches different hunks near `scenario-detail-cagr-*`, rebase after it merges, do not re-flow).

---

### `A/lib/cash-symbols.ts` (utility, transform) and its parity test

**Analog:** `FIXED_MARK_SET` in `src/app/(dashboard)/compare/lib/holding-compare-adapter.ts` (~166-200) and the parity test `describe("fixed-mark set parity with the analytics writer")` in `holding-compare-adapter.test.ts` (~1067-1082). Python source of truth, `analytics-service/services/closed_sets.py` ~237-239:
```python
STABLECOINS: frozenset[str] = frozenset(
    {"USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD", "USD"}
)
```
(`STABLECOIN_SPLIT_SUFFIXES = {"USDE","PYUSD","USDB"}` is deliberately NOT cash: its own comment says it must not drive treat-as-cash logic. Recommendation A1: cash = the 7-symbol `STABLECOINS` set only; MT5/sFOX account-balance rows are not cash.)

**Parity test to copy verbatim in shape** (`holding-compare-adapter.test.ts` ~1069-1081):
```typescript
const py = (rel: string) => readFileSync(join(process.cwd(), "analytics-service", rel), "utf8");
const literal = (name: string): string[] => {
  const m = new RegExp(`^${name}: frozenset\\[str\\] = frozenset\\(\\s*\\{([^}]*)\\}\\s*\\)`, "m").exec(src);
  expect(m, `${name} literal not found in closed_sets.py`).not.toBeNull();
  const members = [...m![1].matchAll(/"([A-Z0-9]+)"/g)].map((x) => x[1]);
  expect(members.length).toBeGreaterThan(0);
  return members;
};
// expect([...CASH_SYMBOLS].sort()).toEqual(literal("STABLECOINS").sort());
```
Predicate shape: `isCashHolding(h) = h.holding_type === "spot" && CASH_SYMBOLS.has(h.symbol.toUpperCase())` (case-insensitive like `holdingMarkIsFixed`, `symbol.toUpperCase()`). Cash-row classification must be a function the Type cell, `ExposureByClass` and `exposure-snapshot.ts` all call (one source). Builder returns `cash: number | null` (`$0` vs `—` rule).

---

### `A/lib/dust.ts` (utility, transform)

**Analog:** `src/lib/holding-equity.ts` `holdingIsPriceGap` (unpriced rows are never dust) and `A/lib/exposure-snapshot.ts` (pure, `Pick<>` row type). Test analog: `A/lib/history-gate.test.ts`:
```typescript
describe("historyGate", () => {
  it.each([
    // [label, input, expected]
    ["eligible key, empty book, not syncing, rebuilding (the 2026-10-03 case)",
      { hasConnectedKeys: true, holdingsSummary: [], hasSyncing: false, equityHistoryState: "rebuilding" },
      "rebuilding"],
```
Inputs per Research Q4: spot = `value_usd` (printed value), derivative = `notional_usd` (`OpenPositionsTable` prints it), Book equity from `book-figures`; strict `< 50` and `< 0.001 * bookEquity`; non-finite Book equity means only the $50 test; unpriced (`holdingIsPriceGap`) and untrusted-key rows are never dust; totals/counts use all rows. Keep new row-id/key composition OUT of `HoldingsTabPanel.tsx`, in this module: `src/__tests__/holding-scope-key-census.test.ts` pins `HoldingsTabPanel.tsx` at matcher `M2` `count: 2` (`spotHoldingRows`, `openPositionRows`); a third `${ref}#${api_key_id}` builder there fails by name.

---

### `A/lib/key-data-gaps.ts` (utility, transform; wired in `src/lib/queries.ts`)

**Analogs:** `readFailingKeyExits` (`src/lib/queries.ts` ~4796-4845) for the owner-key filter and closed-set defence; `marksIncludedKeys` (~4428-4450) for the per-key first/last day scan over `perKeyReturnsByApiKeyId`.

**Owner-key filter + closed set + log-counts-only** (copy the discipline, `readFailingKeyExits`):
```typescript
const byId = new Map(apiKeys.map((k) => [k.id, k]));
...
// T-186-18: only a key the OWNER holds is named. T-186-19: a reason from the closed set, and a day that is a real calendar day or an honest null.
if (typeof id !== "string") continue;
const k = byId.get(id);
if (k === undefined) continue;
if (reason !== "sync_failing" && reason !== "read_incomplete") continue;
if (day !== null && !isCalendarDay(day)) continue;
...
const message = `[queries.readFailingKeyExits] ... received ${entries.length}, kept ${out.length}`; // counts only
console.error(message);
captureToSentry(new Error(message), { tags: { op: "readFailingKeyExits" }, level: "warning" });
```
**Per-key day scan** (`marksIncludedKeys`):
```typescript
for (const point of perKeyReturnsByApiKeyId[k.id] ?? []) {
  if (first === null || point.date < first) first = point.date;
  if (last === null || point.date > last) last = point.date;
}
```
Add the optional additive payload fields beside `failingKeyExits?: FailingKeyExit[]` in the `MyAllocationDashboardPayload` type (~3714), documented the same way ("`[]` whenever ... Optional so legacy fixtures compile; the producer always sets it"), and set them where `failingKeyExits` is set (~5546 `readFailingKeyExits(equityHistoryState === "ready" ? payloadFlags : undefined, derivedPayload, apiKeys)` and the payload literal ~5682/7128). Reference day = latest day in the book's series or UTC today for a failing key, never a client clock (A3; test both sides of the 04:00 UTC poll). While `equityHistoryState` is `"rebuilding"` the derived payload is not read, so `failingKeyExits`/`unpricedNativeAccounts` are `[]` by construction: ranges for a rebuilding book come from the per-key series plus `api_keys.sync_status`/`last_sync_at`, and the rebuilding and ready arms are tested separately. Ship group ids only for `duplicate_account`, never `venue_account_id`. Payload-shape pin home: `src/lib/queries.my-allocation.test.ts`.

---

### `A/components/AddAllocationFlow.tsx` (component, request-response)

Composite of three tracked analogs.

**1. Shell, fetch-on-open, search/list** — `A/components/StrategyBrowseDrawer.tsx`. Imports (lines 29-43), props contract (113-128), fetch-on-open with AbortController and H-0117 loud-fail (227-274), Esc + reset-on-close (280-309), hooks above the `if (!isOpen) return null` gate (420). Excerpt:
```typescript
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { YoursChip } from "./YoursChip";
import type { BrowseStrategyRow } from "@/app/api/strategies/browse/route"; // type-only: route runtime stays out of the client bundle
export type StrategyBrowseRow = Omit<BrowseStrategyRow, "isOwn" | "is_example"> &
  Partial<Pick<BrowseStrategyRow, "isOwn" | "is_example">>;
...
const loader = fetchStrategies ?? (async () => {
  const res = await fetch("/api/strategies/browse", { signal: controller.signal });
  if (!res.ok) throw new Error(`Failed to load strategies (${res.status})`);
  const json = (await res.json()) as { strategies?: StrategyBrowseRow[] };
  return json.strategies ?? [];
});
loader().then((rows) => { if (cancelled) return; setStrategies(rows); setLoading(false); })
  .catch((e: unknown) => { if (cancelled) return; console.error("[StrategyBrowseDrawer] strategy load failed", e); setError(...); setLoading(false); });
return () => { cancelled = true; controller.abort(); };
```
Backdrop + panel markup (466-501): `role="dialog" aria-label=... aria-modal="true"`, fixed right, `width: 620, maxWidth: "96vw"`, `zIndex 100/101`, `bd-fade`/`bd-slide` keyframes in `<style jsx>`. Own-row chip: `s.isOwn === true && <YoursChip data-testid={...} />` (gate is `=== true`, never `!== false`). Row `data-testid` must stay OUT of the `browse-add-` namespace (PR #620 collision guard, comment at ~777-786); use an `add-allocation-*` family. Picker rows carry NO trust tier or manager (C2): caption is codename, markets, strategy types, `YoursChip`, `Example` pill. Also `ScenarioCommitDrawer`'s `createPortal` + `typeof document !== "undefined"` guard (lines 26-27, ~1148-1160) if a portal is used; `AllocateDialog` stays on `Modal` (native `<dialog>` does not nest).

**2. Own-strategy write (`isOwn === true`)** — `A/components/AllocateDialog.tsx`: `parseAmount` (102-113), `envelopeForResponse` (~160-190), `runWrite` (~232-275). Excerpt:
```typescript
function parseAmount(raw: string): ParsedAmount {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, error: ERROR_NON_POSITIVE };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: ERROR_NON_POSITIVE };
  if (n > MAGNITUDE_CAPS.MAX_TICKET_SIZE_USD) return { ok: false, error: ERROR_ABOVE_CAP };
  return { ok: true, value: n };
}
...
const correlationId = newCorrelationId("allocation");
res = await fetch(ALLOCATION_ROUTE, { method, headers: { "Content-Type": "application/json", "X-Correlation-Id": correlationId }, body: JSON.stringify(body) });
...
if (res.status === 409) router.refresh();           // mark-flipped race: re-fetch rows
const body = await res.json().catch(() => null);
setEnvelope(envelopeForResponse(res, correlationId, body));
...
setBusy(false); onClose(); router.refresh();         // no optimistic row; the row renders from refreshed server data
```
Reuse (import, do not copy) `buildEnvelope`, `ErrorEnvelope`, `recogniseDashboardDialogCode`, `parseRetryAfterSeconds`, `newCorrelationId`, `MAGNITUDE_CAPS`. Body is exactly `{ strategy_id, allocated_amount }` (no `portfolio_id`, no date: C4). The primary CTA is never disabled for validation: field error inline plus focus the field (`inputRef.current?.focus()`). `onRetry` only for `envelope.recoverable` (E6). A 409 `ALLOCATION_NOT_ALLOCATABLE` keeps its non-recoverable envelope (mark remedy).

**3. Third-party write (`isOwn === false`, D-05)** — `A/components/ScenarioCommitDrawer.tsx` lines 181-186 and ~535-560:
```typescript
function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
// minted once per attempt, kept in a ref, reused on retry, reset on close/success:
if (idempotencyKeyRef.current === null) idempotencyKeyRef.current = generateIdempotencyKey();
res = await fetch("/api/allocator/scenario/commit", {
  method: "POST",
  headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
  body: JSON.stringify({ diffs: [...] /* NO init_holdings_fingerprint: record-only add */ }),
  signal: controller.signal,
});
```
Diff shape comes from `VoluntaryAddDiff` in `src/app/api/allocator/scenario/commit/route.ts` (~110-116): `{ kind: "voluntary_add", strategy_id, percent_allocated (0..100), size_at_decision_usd (>=0), effective_date? (z.string().date()) }`. `percent_allocated = amount / bookEquityUsd * 100` from `book-figures`; if Book equity is not finite and positive, return the field refusal `We cannot size this allocation until your book equity is available.` Response is NOT an envelope: success is `typeof raw.recorded === "number"` with `errors` empty and `results` covering the diff (drawer ~606-700, strict success gate). Parse the body separately from `fetch` so non-JSON is a failure not a "network error" (drawer ~598-612). 365-day / not-future date window is client-only (the route does not enforce it, C4). Success copy for this branch says the allocation was recorded under Outcomes (not a Holdings row, C3/D-05). "Already in your book" tests both `payload.strategies[].strategy_id` and `payload.outcomes` rows with `kind === "allocated"` (P2).

**`?add=` consume-and-strip**: see `AllocationsTabs.tsx` below (Pattern 1).

---

### `A/components/GlancePanel.tsx` (component, render)

**Analog:** `src/components/kpi/KpiPanel.tsx` (`KpiPanelCell`, `variant: "panel"` square hairline) fed by `A/components/KpiStrip.tsx`. Cell descriptor (KpiPanel.tsx ~27-44):
```typescript
export interface KpiPanelCell {
  key: string;
  label: string;
  value: string;                 // caller resolves null -> "—"
  valueClassName?: string;       // "text-positive" | "text-negative" | ""
  children?: React.ReactNode;    // sub-copy below the value
}
```
Tone class: copy `valueColorClass` from `KpiStrip.tsx` (~173-180) but import `signTone`/`drawdownTone` from `@/lib/factsheet/display-sign` (a private sign rule fails `display-sign-single-source.test.ts`):
```typescript
const tone = drawdown ? drawdownTone(raw, 2, scale) : signTone(raw, 2, scale);
if (tone === "positive") return "text-positive";
if (tone === "negative") return "text-negative";
return "";
```
Keep Max DD's `isImpossibleDrawdown` dash behaviour (`signTone(raw, 2, 100) === "positive"`). `@container` host is a SEPARATE ancestor from the grid (KpiPanel header comment). Labels are the Scenario labels (`YTD TWR`, `Sharpe`, `Max DD 12m`) and `Book equity`, `Positions`. Stamp line dates via `formatCloseDay` from `@/lib/factsheet/returns-unit`, never `Date.now()`. D-06 overrides UI-SPEC "Missing history" row (C7): figures show whenever they exist, independent of `equityHistoryState`; withheld Sharpe prints `—` with the shared 194 reason text. When the ready Overview also shows the factsheet body's YTD (different series), each carries a distinct label.

---

### `A/components/MissingDataMessage.tsx` (component, render)

**Analog:** `FailingKeyExitNote` and `UnpricedAccountNote` in `A/AllocationDashboardV2.tsx` (~397-510) and the class table in `A/components/EquityHistoryRebuilding.tsx`.

**Sentence-builder idiom** (`AllocationDashboardV2.tsx`):
```typescript
/** `A`, `A and B`, `A, B and C`: no serial comma. */
function joinAnd(parts: readonly string[]): string { ... }

function FailingKeyExitNote({ exits }: { exits: ReadonlyArray<FailingKeyExit> }) {
  const sorted = [...exits].sort((a, b) => a.label.localeCompare(b.label) || a.apiKeyId.localeCompare(b.apiKeyId));
  ...
  return (
    <p role="status" data-testid="dashboard-failing-key-note" className="mb-3 px-1 text-sm text-text-secondary">
      {sentences.join(" ")}
    </p>
  );
}
```
Dates: `formatCloseDay(g.day)` (UTC) today; UI-SPEC names `formatUnpricedDays` for ranges (confirm its export when planning). Labels: `apiKeyLabelById(apiKeys)` from `@/lib/api-key-label` (`Binance — Main`, else `Binance — ••••4f2a`), never a raw id; only the owner's own keys (T-186-18).

**Reason to line**: keep one ONE-PLACE class table. `EquityHistoryRebuilding.tsx` already exports it; do not change it (P5, the Scenario own-book sentence reads it):
```typescript
export function equityHistoryRebuildClass(reason: EquityHistoryRebuildReason | null | undefined): EquityHistoryRebuildClass {
  if (!isKnownRebuildReason(reason)) return "rebuilding";   // fail-closed
  return REBUILD_REASON_CLASS[reason];
}
export function ExchangesPageLink() { ... }                   // also imported by ScenarioComposer and RiskTabPanel
```
Exhaustive switch for the `needs_action` reasons (`NeedsActionLine`, `const unhandled: never = reason;`) and `Record<Exclude<...>, string>` for the rest: copy this compile-time exhaustiveness. The generic literal to remove is the `held_back` heading "We are holding back your equity history" (`HEADING_BY_CLASS`, line ~139); replace the panel body, keep the class table and `ExchangesPageLink` exports. Scope rule: never "your keys" for a one-key fault. Section shell: `<section aria-labelledby>` plus mono eyebrow `text-fixed-10 font-mono uppercase tracking-[0.18em] text-text-muted` (copy from `EquityHistoryRebuilding` return JSX), `<h2>` not h3 (axe `heading-order`), NOT `role="status"`. One fact, one sentence: when this names a range for a key, `FailingKeyExitNote` must not name the same days again.

---

### `A/AllocationsTabs.tsx` (modified: 6 tabs to 3, single header button, `?add=`)

**Analog:** itself. Edit points:

- `TabKey` union, `VISIBLE_TAB_KEYS`, `TAB_LABELS`, `tabRefs` initial object, `tabCount`: shrink to `overview | holdings | scenario`. `KNOWN_TAB_RAW_ENTRIES` is derived from `VISIBLE_TAB_KEYS` + `"scenario"` + `"performance"`; add the legacy aliases here so `invalid_tab_fallback` does not fire for `outcomes|mandate|risk`.
- `parseTab` (lines ~308-326): extend the switch with alias handling; unknown values still go through `warnAudit("invalid_tab_fallback", { raw })`.
- URL cleanup effect (~438-446) is the template for alias rewrite and for stripping `add`:
```typescript
useEffect(() => {
  const current = searchParams.get("tab");
  if (current === "overview" || current === "performance") {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tab");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }
}, [searchParams, pathname]);
```
- `changeTab` (~474-480) copies existing params and sets/deletes only `tab`, so `add` survives tab changes: keep it that way.
```typescript
const changeTab = (key: TabKey) => {
  const params = new URLSearchParams(searchParams.toString());
  if (key === "overview") params.delete("tab"); else params.set("tab", key);
  const qs = params.toString();
  window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
};
```
- **`?add=` consume-and-strip (D-07, C8)** — Research Pattern 1 (read in a mount effect, never a `useState` initializer: P4 hydration). Copy:
```typescript
useEffect(() => {
  const raw = searchParams.get("add");
  if (raw === null) return;
  setAddFlow({ open: true, strategyId: isUuid(raw) ? raw : null }); // malformed/empty -> step 1 + not-available notice + warnAudit("invalid_add_param")
  const params = new URLSearchParams(searchParams.toString());
  params.delete("add");
  const qs = params.toString();
  window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
}, [searchParams, pathname]);
```
`isUuid` is `src/lib/utils.ts:108`. Validate the id by resolving it against the `/api/strategies/browse` list inside the flow (the URL is never authoritative).
- **Header button**: delete `handleHeaderAdd`'s per-tab dispatch (lines ~594-620), `composerBrowseOpenRef`, `pendingBrowseOpenRef`, `headerBrowseTriggeredRef`, `handleRegisterOpenBrowse`, `handleBrowseClosed`, `handleBrowseHandoff` and the `ContributionWizardOverlay` import/mount (~1005-1013); the button becomes one `+ Allocation` on every tab (including Scenario, no more `+ Strategy`) opening `AddAllocationFlow`. Keep `addButtonRef` and the focus-return-on-close behaviour from `handleContributeClose`: `addButtonRef.current?.focus()`; on success `router.refresh()` (user-initiated, call directly). Decision for the plan: remove the dead host seam props on `ScenarioTabContent`/`ScenarioComposer` or leave unreferenced (removing also retires tests S1-S6). Do NOT import `WizardClient` anywhere under `A/AllocationsTabs*`; add a guard test beside `src/__tests__/trim-removed-surfaces.test.tsx`.
- Tabpanels (~890-1000): keep the paired `hidden={activeTab !== X}` plus `{activeTab === X && <Panel/>}` lazy-mount idiom for the three that remain; delete the `outcomes|mandate|risk` panels (their content is folded in below).
- Polling effect (~480-497) runs only on `overview`; unchanged.
- Legacy-alias scroll (P6): one-time `scrollIntoView` after the section mounts, `prefers-reduced-motion` aware (pattern: the NAV-02 effect ~620-650 using `window.matchMedia("(prefers-reduced-motion: reduce)").matches`). `#risk` and `#mandate` land in the main Overview tree (no lazy chunk); `#outcomes` on Holdings needs a post-mount scroll because `HoldingsTabPanel` is `next/dynamic({ ssr: false })`.

### `A/AllocationDashboardV2.tsx` (modified: new Overview order)

**Analog:** itself plus `A/RiskTabPanel.tsx`. Target order (UI-SPEC "Overview", with C5-C7): banners (`AlertBanner`, `StalenessBanner`), `GlancePanel`, `MissingDataMessage` (replaces `EquityHistoryRebuilding` call at ~235), key notes, `InsightStrip`, curve + factsheet body (ready only), Risk section, Mandate section. The single `historyGate(props)` call site stays (P5):
```typescript
const gate = historyGate(props);
...
{isRebuilding ? (
  <EquityHistoryRebuilding reason={equityHistoryRebuildReason} notSyncingKeys={notSyncingKeys} />
) : factsheetPayload ? ( <FactsheetProvider ...><FactsheetBody ... /></FactsheetProvider> ) : ( ... )}
```
`gate === "no_eligible_key"` keeps `EmptyState` replacing items 2-8. **Risk fold-in**: render `RiskTabPanel`'s widget grid (`RISK_WIDGETS`, `WIDGET_COMPONENTS[id]`, `bookRiskInput(props)`, `data-widget-id`) inside `<section id="risk">` after the factsheet body; when `gate === "rebuilding"` print only the one line "Risk figures need the equity history. See the note above." Do not duplicate the rebuilding panel. `OverviewRisk.history-parity.test.tsx` (`[data-widget-id]` count 6 at ~365/384) is rewritten to a same-tab parity. **Mandate fold-in**: render `MandateTabPanel` content in `<section id="mandate">` last (link copy becomes "Edit mandate"; keep `href="/profile?tab=mandate"`, it is the Profile page's own tab, not retired).

---

### `A/HoldingsTabPanel.tsx` (modified: order, one listing, dust)

**Analog:** itself. Current order (lines ~528-668): Strategies `HoldingsTable`, Exposure, Watchlist & Optimizer, Notes, Exchange Positions (flagged list, spot table, `OpenPositionsTable`). Target: Strategies, **Positions** (renamed, moved up, one dust control), Exposure (drilldown removed), Outcomes (moved in from `OutcomesTabPanel`), Watchlist & Optimizer, Notes. Keep section grid idiom (`grid grid-cols-1` on root AND nested section grids: 170.2 SC-1 comment, no `overflow-x-hidden`):
```typescript
<section aria-label="Exposure" className="grid grid-cols-1 gap-4">
  <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">Exposure</h3>
```
Row builders to keep untouched (census M2): `spotHoldingRows` (~415-452) and `openPositionRows` (~455-485) with `id: \`${ref}#${h.api_key_id}\``. Filter dust AFTER those memos using `A/lib/dust.ts`, and keep `keyStatusById` (~392) as the "untrusted key never dust" input. Notes (`spotReadDayNotes`, `readDayNotes`, `partialReadNotes`, `priceGapHoldingsNote`) stay with their tables. Flagged positions (C9): do not simply delete `ScenarioFlaggedHoldingsList` from this panel; it is a Bridge V2 state machine (also mounted by `ScenarioStub`, `ScenarioComposer`, `BridgeDrawer`). Plan it as its own plan: a flag keyed per `(venue, symbol, holding_type)` maps to every row of that ref (chip on each), the action opens ONE form. Keep the component for the Scenario mounts. Dust control copy and `aria-expanded`/LiveRegion per UI-SPEC "Dust"; `Show n small positions` toggle. `HoldingsTabPanel.positions-once.test.tsx` counts rows per `(key, venue, symbol, type, side)` across the whole DOM including flagged.

### `A/components/HoldingsTable.tsx` (modified: ROUTE-08 label, Cash type)

**Analog:** itself. The literal is at `:549` inside the strategies table branch (C1; ROADMAP's `:504` is stale). Replace the caption, keep the structure:
```tsx
{isOwnCapital && !isAllocated ? (
  <>
    <span className="font-metric">—</span>{" "}
    <span className="text-caption text-text-muted">not allocated</span>   {/* becomes: no amount entered */}
  </>
) : (
  formatUsd(row.allocation)
)}
```
Type cell (spot table, ~808): `{h.holding_type === "spot" ? "Spot" : "Derivative"}` becomes `Cash` when `isCashHolding(h)`. RED-first: `HoldingsTable.strategy-rows.test.tsx:447-456` (`expect(cells[3]).toBe("— not allocated")`) and `:705` are rewritten deliberately (neuter, see RED on the old literal, then flip to `— no amount entered`); do not delete them. Planner must first confirm which producer feeds the Strategies rows on PROD (research PROD read 7: `portfolio_strategies` has 0 rows, so the label the founder saw renders on key-linked strategies, see `A/lib/strategies-row-adapter.ts`).

### `A/widgets/positions/ExposureByClass.tsx` and `A/lib/exposure-snapshot.ts` (modified)

**Analog:** themselves. Today every `holdingType === "spot"` slice lands in `classGross.spot` (`for (const s of snapshot.slices) classGross[s.holdingType] += s.valueUsd`) and gross/long/short sum all slices. Change: split cash slices out (via `isCashHolding`) before gross/net/long/short and the composition bar; add the fifth `KpiCell` (the `KpiCell` helper at the file bottom is the pattern: `<KpiCell testid="kpi-cash" label="Cash" value={...}/>` formatted via `formatUsd`, `$0` vs `—` from the builder's `cash: number | null`). Delete the `data-testid="drilldown"` block (`ResponsiveTable label="Exposure by venue and symbol"`, the second position listing); keep `keyLabels` only if still used. The composition bar `aria-label` uses `.toFixed(1)` today (existing census count; do not add more). The two over-time charts (`getNetExposureSeries`, `getAllocationSeries`, `src/lib/portfolio-exposure.ts`) count cash as spot too; plan an explicit decision (exclude via the same cash set, or label them) so strip and charts do not disagree (Open Question 3).

### `A/components/ScenarioComposer.tsx` (modified, small)

**Analog:** itself, `gatedLiveMetrics` hunk (~4474-4506, call at ~6012-6020). Make the live strip read the shared gated value (`metrics={gatedLiveMetrics}` or the shared module's output) so glance and Scenario agree (C6/FD-2, D-06). Sequence after 194.1 (D-08): its plan 07 edits `scenario-detail-cagr-*`/`-sharpe-*` near ~8508/8525; rebase, different hunks, do not re-flow. Re-measure line numbers at merge.

### `src/lib/queries.ts` (modified)

See `A/lib/key-data-gaps.ts` above. Additive optional fields only; no migration expected (P8; a migration would auto-apply to PROD with no human gate).

### Retired-tab links (modified)

`src/components/layout/Sidebar.tsx` (`buildPrimaryMobileNav`): `{ label: "Risk", href: "/allocations?tab=risk", icon: ShieldIcon }` keeps working through the alias (lands on Overview `#risk`); update `src/components/layout/MobileNav.test.tsx` (`:44,49,91,116,189`). `A/components/BridgeWidget.tsx:241` `href="/allocations?tab=outcomes"` becomes the new destination string and `BridgeWidget.test.tsx:235-272` is updated. Not retired (leave): `/profile?tab=mandate` (`MandateTabPanel.tsx:162`, `preferences/page.tsx`, `route-contract-manifest.ts:244`). `npm run check:route-contract` needs no change for `?add=` (path-based).

---

## Shared Patterns

### Figure formatting and sign (every new figure)
**Source:** `src/lib/factsheet/display-sign.ts` (`signTone`, `drawdownTone`, `formatFixedSigned`), `@/lib/utils` (`formatPercent`, `formatNumber`), `@/lib/dollar-validation` (`formatUsd`, whole dollars, null is em-dash), `@/lib/factsheet/returns-unit` (`formatCloseDay`).
**Apply to:** `book-figures.ts`, `GlancePanel.tsx`, `MissingDataMessage.tsx`, Positions header, Cash cell.
Rule: no private `v > 0 ? "text-positive"` and no bare `.toFixed`; `src/__tests__/display-sign-single-source.test.ts` (R1-R8) fails by name. Run the three census tests after the FIRST panel move (`display-sign-single-source`, `holding-scope-key-census`, `contracts-registry`), not at the end.

### Figure gate (194 D-15)
**Source:** `src/lib/figure-gate.ts` (`figureRecord`, `gateAnnualized`, `gatedValue`, `FigureState`).
**Apply to:** glance Sharpe and the Scenario live Sharpe cell.
```typescript
export function gateAnnualized(record: FigureRecord, windowSpanDays?: number | null): FigureState { ... "withheld" | "null" | "short" | "full" }
export function gatedValue(value, state: FigureState): number | null  // null for withheld/non-finite; never a substitute number
```

### Key labels and owner-only naming
**Source:** `src/lib/api-key-label.ts` `apiKeyLabelById` / `dataSourceLabel` (the ONE label rule; raw key id never a value, T-169-26); owner filter from `readFailingKeyExits` (T-186-18).
**Apply to:** `MissingDataMessage`, key-data-gaps, picker rows.

### History gate
**Source:** `A/lib/history-gate.ts` `historyGate`, `resolveNotSyncingKeys`.
```typescript
export function historyGate(payload: HistoryGateInput): HistoryGate {
  const bookEmpty = (payload.holdingsSummary ?? []).length === 0;
  const empty = bookEmpty && !(payload.hasSyncing ?? false);
  if (empty && payload.hasConnectedKeys !== true) return "no_eligible_key";
  if (payload.equityHistoryState !== "ready") return "rebuilding";   // fail-closed
  return "ready";
}
```
**Apply to:** Overview (single call site), folded Risk section, `MissingDataMessage`. Never a second hand-written gate.

### Error envelopes (client writes)
**Source:** `A/components/AllocateDialog.tsx` `envelopeForResponse` + `@/lib/envelope` `buildEnvelope` + `@/lib/wizardErrors` `recogniseDashboardDialogCode`, `ErrorEnvelope` component.
**Apply to:** `AddAllocationFlow` own-strategy branch. The commit branch has no machine `code` except the 409 `portfolio_fingerprint_stale` (not reachable without a fingerprint), so it parses `{ error, message }`/`errors[]` as `ScenarioCommitDrawer` does.

### Auth and CSRF (write routes, no change)
**Source:** `/api/portfolio-strategies/allocation` (`assertSameOrigin`, `auth.getUser()`, no role gate, own-capital trigger) and `/api/allocator/scenario/commit` (`withAllocatorAuth`, CSRF via `withAuth`, `Idempotency-Key` regex `^[A-Za-z0-9._~-]{16,128}$`, `userActionLimiter`). Same-origin `fetch` is enough; do not add a new endpoint (D-05). Page-level role gate: `requireRolePage(supabase, user, "allocator")` in `A/page.tsx`.

### Slide-over a11y and focus
**Source:** `StrategyBrowseDrawer.tsx` (Esc handler gated on `isOpen`, backdrop click closes) and `ScenarioCommitDrawer.tsx` focus-trap effect (~265-305: first-focusable on open, Tab cycling, `focusableSelector`) and failure focus restore (~311-315: move focus to the error banner). Esc is a no-op while submitting. The header button `ref={addButtonRef}` gets focus back on close.

### Test harness
**Source:** `A/AllocationsTabs.addalloc.test.tsx` (mock `next/navigation` with `useSearchParams`/`useRouter`/`usePathname`; `vi.stubGlobal("localStorage", ...)` PER TEST in `beforeEach` because `unstubGlobals: true`; panel stubs via `vi.mock("./HoldingsTabPanel", ...)`; run `--no-file-parallelism` locally) and `A/AllocationDashboardV2.failing-key.test.tsx` (mock `InsightStrip`, `AlertBanner`, `EquityChart`, `FactsheetProvider`/`FactsheetBody`, `buildAllocatorPortfolioFactsheetPayload`). Two-surfaces-one-payload parity idiom: `A/OverviewRisk.history-parity.test.tsx` (`payload(over)` helper, `readTab()`). Neuter-and-see-RED discipline: the RED-first literals are `not allocated`, the six-tab order array, the cash-in-Spot classification and the generic notice; restore from a byte backup, never `git checkout/restore/stash`.

### Existing tests that go RED and must be rewritten deliberately (Research Q5)
`AllocationsTabs.test.tsx` (order array ~`:598`, `?tab=risk|outcomes|mandate` fixtures), `AllocationsTabs.scenario-composer.test.tsx` (`:510-520`, `:544`, `:705-707`), `AllocationsTabs.addalloc.test.tsx` (rewrite around the new flow), `AllocationsTabs.connect-key-predicate.test.tsx:270`, `HoldingsTable.strategy-rows.test.tsx:447-456,705`, `HoldingsTabPanel.test.tsx`, `HoldingsTabPanel.exposure.test.tsx`, `HoldingsTabPanel.key-read-notes.test.tsx:287-301` (section order, heading `Exchange Positions` becomes `Positions`), `ExposureByClass.test.tsx` (drilldown removal, Cash cell), `RiskTabPanel.book-series.test.tsx`, `MandateTabPanel.test.tsx`, `OverviewRisk.history-parity.test.tsx`, `AllocationDashboardV2.{rebuilding,failing-key,departed-history,unpriced-account,warmup,history-reconstruct-failed}.test.tsx`, `MobileNav.test.tsx`, `BridgeWidget.test.tsx`, and e2e `reflow-sweep-authed.spec.ts`, `no-clip-sweep.spec.ts`, and **`e2e/wizard-resume.spec.ts:114-124`** (clicks the header button and expects the manager wizard dialog: re-point it to the sidebar "Add a Strategy" path, do not delete; FD-3 leaves that entry in place).

---

## No Analog Found

| File / concern | Role | Data flow | Reason |
|---|---|---|---|
| `AddAllocationFlow` two-branch dispatch (own vs third-party) | component | request-response | No existing component picks a strategy then writes through two different routes; the shell, own write and commit write each have analogs (above), but the dispatch by `BrowseStrategyRow.isOwn` and per-branch success copy are new. Use RESEARCH Q1 and its "Dispatch by ownership" sketch. |
| Flagged-position chip plus single inline outcome form on position rows (C9) | component | event-driven | `ScenarioFlaggedHoldingsList` is a standalone list with its own Bridge V2 state machine; nothing renders it as a row-level action. Plan it separately with the flag-to-rows mapping rule; do not re-decide OQ-7 silently in execution. |
| Per-key missing day RANGES (interior holes plus tail gap) | utility | transform | `csv_daily_returns` per-key series exist (`perKeyReturnsByApiKeyId`), but no reader computes day ranges; only `failingKeyExits.day` (last counted day) and `unpricedNativeAccounts.holeDays` (a COUNT, `classifyUnpricedEntry` reduces `hole_days` to `valid.size`) exist. Use RESEARCH Q3 for the shape and the rebuilding-arm caveat. |

## Metadata

**Analog search scope:** `src/app/(dashboard)/allocations/**` (components, lib, widgets, tests), `src/lib/{queries,figure-gate,holding-equity,api-key-label}.ts`, `src/lib/factsheet/display-sign.ts`, `src/components/kpi/KpiPanel.tsx`, `src/components/layout/Sidebar.tsx`, `src/app/api/{portfolio-strategies/allocation,allocator/scenario/commit,strategies/browse}/route.ts`, `src/app/(dashboard)/compare/lib/holding-compare-adapter{,.test}.ts`, `analytics-service/services/closed_sets.py`, `e2e/{composer-axe,wizard-resume}.spec.ts`, `src/__tests__/*census*`.
**Files read in full or by targeted range:** 24 source/test files; no re-read of a range already in context.
**Tracked-source gate:** all analog paths checked with `git ls-files` (no `.gsd/capabilities` mirror paths appear).
**Pattern extraction date:** 2026-11-08

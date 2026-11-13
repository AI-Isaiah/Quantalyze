# Phase 205: ONEVERDICT - Pattern Map

**Mapped:** 2026-11-10
**Files analyzed:** 8 (all MODIFIED in place; no new files)
**Analogs found:** 8 / 8 (each file is its own analog: extend the neighbouring 194.2 pattern in the same file)

All paths are git-tracked (verified with `git ls-files`) under the repository root. Cite by symbol, not line.

## File Classification

| Modified File | Role | Data Flow | Closest Analog (in-file) | Match |
|---|---|---|---|---|
| `src/lib/factsheet/build-payload.ts` | service/transform | transform | its own 194.2 `firstUnreadableDate` / `totalRecord` block and `stressWindows` ternary | exact |
| `src/lib/factsheet/fetch-and-build-payload.ts` | service | request-response | its own `buildUsdView` `usdOpts` (`recordSeriesStart` conditional spread) | exact |
| `src/app/factsheet/[id]/v2/page.tsx` | config (cache key) | request-response | the v21->v22 dated bump comment above `factsheet-v2-payload-v22` | exact |
| `src/__tests__/figure-parity-pages.test.tsx` | test | request-response | `it.each` "194.2 R2 WR-01: a malformed date at %s curve point..." | exact |
| `src/app/factsheet/[id]/v2/StressWindowsPanel.unreadable.test.tsx` | test | transform | `payloadWithFirstDate` + `it.each(["2023-13-01","2023-02-32",""])` | exact |
| `src/lib/factsheet/audit-c20.test.ts` | test | transform | its own `makeReturns` | role-match |
| `src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx` | test | n/a | hand-typed key expectations (3) | exact |
| `src/app/factsheet-share/[token]/page.cache-isolation.test.tsx` | test | n/a | `EXPECTED_KEY_PREFIX` (hand-typed by design) | exact |
| `CHANGELOG.md`, `VERSION`, `package.json` | release | n/a | house style per CLAUDE.md (non-planning paths) | exact |

## Pattern Assignments

### `src/lib/factsheet/build-payload.ts` (transform) - WR-01, WR-02, WR-03

**1. `BuildFactsheetOpts`: replace `recordSourceDates` with one boolean.** Current shape, with its doc-comment voice (delete this opt and comment, add the boolean in the same voice):
```typescript
  /**
   * 194.2 R2: the dates of the series this one was converted from (the USD view's native
   * series). ... Their readability is the record's, so the unreadable scan covers them as one more axis.
   */
  recordSourceDates?: readonly string[];
  /** 194 R6 WR-01: report an unreadable record to Sentry. ... */
  reportUnreadable?: boolean;
```
New (name is discretion; research prototype used `inheritedUnreadable`):
```typescript
  /** 205 D-01: the NATIVE build's verdict, for the USD view. OR'd into the USD record; never re-scanned. */
  inheritedUnreadable?: boolean;
```

**2. `buildFromBuildableSeries`: verdict + report predicate.** Current:
```typescript
const firstBad = firstUnreadableDate(dates, mtmDates, smoothedDates,
  opts?.recordSeriesStart ? [opts.recordSeriesStart] : [],
  opts?.recordSourceDates ?? [],          // <- drop this 5th axis
);
const totalRecord: FigureRecord = firstBad ? { ...endsRecord, unreadable: true } : endsRecord;
if (totalRecord.unreadable && opts?.reportUnreadable) {
  const firstBadAxis = firstBad ? (["cash","mark_to_market","smoothed_mtm","record_start","record_source"] as const)[firstBad.axis] : null;
```
Target:
```typescript
const totalRecord: FigureRecord =
  firstBad || opts?.inheritedUnreadable ? { ...endsRecord, unreadable: true } : endsRecord;
if ((firstBad || endsRecord.unreadable) && opts?.reportUnreadable) {   // OWN verdict only; NOT totalRecord.unreadable
  // axis tuple loses "record_source"
```
Pitfall: `firstBad && ...` alone breaks `figure-record-unreadable.test.ts` ("malformed headline start ... reported too"); `totalRecord.unreadable` would make USD send a second Sentry event.

**3. `deriveSeriesBundle` `stressWindows:` ternary (one edit covers cash/MTM/smoothed and the browser re-derive via `rederiveArgs`).** Current:
```typescript
stressWindows:
  dates.length > 0 && !isReadableDay(dates[0])
    ? { windows: [], benchName: "BTC", totalCatalogued: 0, droppedOutOfRange: 0, droppedPartial: 0, unreadable: true }
    : computeStressWindows(dates, stratRet, btcAl.returns, "BTC", markets, isArithmetic ? "arithmetic" : "geometric"),
```
Target predicate: `args.figureRecord?.unreadable === true || (dates.length > 0 && !isReadableDay(dates[0]))` (second half stays as throw-avoidance for a `null` record). Reuse the existing withheld literal; update the `194.2 WR-01 / R2` comment above it with a `205 D-02` line.

**4. api arm `allocatorPortfolios`.** Current: `allocatorPortfolios: [ { key: "sixty_forty", ... }, ... ]` inside the `ingestSource === "api"` return. Target: `allocatorPortfolios: totalRecord.unreadable ? null : [ /* three blends unchanged */ ],`. No change to `allocator.ts` (`alignBlend`/`isoDayBefore`). No reader renders this field (only `types.ts` and this construction), so no copy risk.

---

### `src/lib/factsheet/fetch-and-build-payload.ts` (request-response) - WR-01

**Analog:** `buildUsdView` conditional-spread idiom already used for `recordSeriesStart`:
```typescript
  /** 194.2 (D-02): the record's first date is likewise a fact about the record, not its unit. */
  recordSeriesStart: string | null;          // in buildUsdView args
...
const usdOpts: BuildFactsheetOpts = {
  dataQuality: singleKeyDataQuality(dqf),
  returnsUnit: "USD",
  recordObservations,
  ...(recordSeriesStart ? { recordSeriesStart } : {}),
  // 194.2 R2: the conversion drops a malformed native date; the record still has it.
  recordSourceDates: nativeSeries.map((p) => p.date),     // <- replace
  ...(facts.missingSegments.length > 0 ? { missingSegments: facts.missingSegments } : {}),
};
```
Target: add an arg `/** 205 D-01 ... */ nativeUnreadable: boolean;` to `buildUsdView`, spread `...(nativeUnreadable ? { inheritedUnreadable: true } : {}),` and pass `nativeUnreadable: nativePayload.figureRecord?.unreadable === true,` at the one call site (`const usd = await buildUsdView({ supabase, id, unit, analytics, dqf, strategyArg, recordObservations, recordSeriesStart })`). `nativeSeries` stays (still feeds `buildUsdViewFacts` and the converter). Also update the "CACHE KEY REALITY" doc comment quoting `factsheet-v2-payload-v22` to v23.

---

### `src/app/factsheet/[id]/v2/page.tsx` (cache key) - D-05

**Analog:** the dated bump comments above the key in `buildFactsheetPayloadCached`:
```typescript
    // Bumped v21→v22 (Phase 194.2 FIGURERESIDUALS D-02, 2026-11-10): the values inside `payload.figureRecord` change ... without a shape change. ... under v21 an entry built before the deploy would keep printing the old N for the 1 h TTL drain.
    ["factsheet-v2-payload-v22", id, computedAt, tradesFetchedAt ?? "none", provenanceKey, computationStatus],
```
Add `// Bumped v22→v23 (Phase 205 ONEVERDICT, 2026-11-10): values change for the same inputs (stress block, api-arm allocator blends, USD record verdict) ...` and change the literal to `factsheet-v2-payload-v23`. Same literal is hand-typed in `page.public-cache-key.test.tsx` (3 places) and `page.cache-isolation.test.tsx` (`EXPECTED_KEY_PREFIX`): update all, they are the gate.

---

### `src/__tests__/figure-parity-pages.test.tsx` (test, request-response) - WR-01/02/03 gates

**Analog:** the existing `it.each` "194.2 R2 WR-01: a malformed date at %s curve point is unreadable on the native AND the USD view". It is already the RED gate for inheritance (neuter the OR-in). Copy its scaffolding for new cases:
```typescript
fake.benchmarkRows = Array.from({ length: CURVE_DAYS + 2 }, (_, i) => ({
  date: isoDay(CURVE_START_MS + (i - 1) * DAY),
  close_price: 40_000 + i * 10,
}));
const curve = CURVE.map((p, i) => (i === index ? { ...p, date: badDate } : p));
const payload = await factsheetPayload(
  "crypto",
  curveAnalytics({ returns_series: curve, data_quality_flags: { native_unit: "BTC" } }),
);
expect(payload.usdViewUnavailable).toBeUndefined();
expect(payload.figureRecord?.unreadable).toBe(true);
const usd = payload.usdView?.payload;
expect(usd?.figureRecord?.unreadable).toBe(true);
```
New cases (D-04): (a) interior `{date:"2024-07-3", value:null}` and `"2024-07-31x"`: native and USD `unreadable` both false (RED at HEAD: USD true); (b) `curve[1].date="2024-02-30"`: native and USD `stressWindows.unreadable === true`, `windows` empty; (c) api-arm curve from 2024-01-09, `daily_returns: null`, `curve[1].date="2024-01-1"`: payload returned, `unreadable`, `allocatorPortfolios === null` (throws at HEAD); (d) Sentry: native BTC-unreadable curve calls `captureToSentry` once with `firstBadAxis` set, USD adds none. Mock/reset idiom: `vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }))` at the top, `vi.mocked(captureToSentry).mockClear()` in `beforeEach` (seen in the D-02 describe). Keep bad dates inside the curve's own year-month (a 2024 date in a 2026 curve sorts to index 0).

---

### `src/app/factsheet/[id]/v2/StressWindowsPanel.unreadable.test.tsx` (test, transform) - WR-02/03

**Analog:** `payloadWithFirstDate` fixture and the `it.each` over bad first dates:
```typescript
function payloadWithFirstDate(firstDate: string) {
  const days = Array.from({ length: 300 }, (_, i) => ({
    date: new Date(Date.UTC(2024, 0, i + 2)).toISOString().slice(0, 10),
    value: Math.sin(i / 9) * 0.006,
  }));
  const payload = buildFactsheetPayload(
    { id: "stress-unreadable", name: "Stress Unreadable", types: ["test"], markets: ["crypto"], computedAt: "2026-09-30T00:00:00Z", trustTier: null },
    [{ date: firstDate, value: 0.001 }, ...days],
  );
  if (!payload) throw new Error("buildFactsheetPayload returned null in test");
  return payload;
}
```
Extend: add an optional third arg (`opts`, to pass `ingestSource: "api"`) or a sibling helper; new `it.each(["", "2023-13-01", "2023-02-32"])` (RED on throw) plus `["2024-1-5", "2024-02-30"]` (RED only on `allocatorPortfolios === null`; say so in a comment) asserting `figureRecord.unreadable === true` and `allocatorPortfolios === null`. Interior case: replace one `days[k].date` with `"2024-06-31"`, assert `stressWindows.unreadable === true`, render `StressWindowsPanel` inside `FactsheetProvider` and assert the text `"Stress windows are not shown: the record's dates could not be read."`. Add a direct `deriveSeriesBundle` case with an unreadable `figureRecord` (leverage re-derive).

---

### `src/lib/factsheet/audit-c20.test.ts` (test) - fixture fix

**Analog:** `makeReturns`, which yields impossible dates `2024-01-32..40` for n=40:
```typescript
function makeReturns(n = 40) {
  return Array.from({ length: n }, (_, i) => ({
    date: `2024-01-${String(i + 1).padStart(2, "0")}`,
    value: (Math.sin(i / 5) * 0.003) + 0.0001,
  }));
}
```
Add a readable-date helper (e.g. derive via `new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10)`, as `payloadWithFirstDate` does) used ONLY by "api strategy: all four synthesized fields are present and non-null". Never change the assertion; do not change `makeReturns` for other tests.

---

## Shared Patterns

### One verdict, derived once, consumed everywhere
**Source:** `buildFromBuildableSeries` `totalRecord` (build-payload.ts) and `figureRecord`/`isReadableDay`/`firstUnreadableDate` (`src/lib/figure-gate.ts`).
**Apply to:** all three fixes. Downstream reads `totalRecord.unreadable` / `figureRecord.unreadable`; never re-test dates, never add a second scan, no guard inside `alignBlend`. Use `isReadableDay` (round-trips through `toISOString`), not `Date.parse`.

### Withheld stress shape
Reuse the existing literal `{ windows: [], benchName: "BTC", totalCatalogued: 0, droppedOutOfRange: 0, droppedPartial: 0, unreadable: true }`; readers `StressWindowsPanel` and `advancedSectionContent` already handle it. No copy change.

### Comment voice
Dated `194.2 ...` / `Phase NNN` rationale comments beside each gate; follow with `205 D-0N`.

### Gate-must-fail discipline
Per gate: `cp` byte backup to the scratchpad, neuter, see RED, `cp` back, `shasum` equal. Never `git checkout/restore/stash`. Neuter map: drop `|| opts?.inheritedUnreadable` (existing R2 case RED); restore `recordSourceDates` line (interior-date case RED); narrow predicate back to `totalRecord.unreadable` (Sentry case RED); remove `args.figureRecord?.unreadable === true ||` (stress cases RED); drop the `allocatorPortfolios` ternary (api cases RED); leave `page.tsx` on v22 (cache tests RED).

### Plan serialization
Everything funnels through `build-payload.ts` and two test files: one chain, one executor at a time. Order: WR-01, WR-02, WR-03 (+ `audit-c20` fixture), D-05 + release bookkeeping.

### Readable-record invariance
`src/lib/factsheet/__snapshots__/build-payload.test.ts.snap` must not move (no `-u`).

## No Analog Found

None. No new files; no migration.

## Metadata

**Analog search scope:** `src/lib/factsheet/`, `src/app/factsheet/[id]/v2/`, `src/__tests__/`
**Files scanned:** 8 read or grepped (plus 205-CONTEXT.md, 205-RESEARCH.md)
**Pattern extraction date:** 2026-11-10

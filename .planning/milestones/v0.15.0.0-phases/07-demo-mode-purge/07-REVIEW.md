---
phase: 07-demo-mode-purge
reviewed: 2026-04-20T19:25:40Z
depth: standard
files_reviewed: 28
files_reviewed_list:
  - analytics-service/services/equity_reconstruction.py
  - analytics-service/services/job_worker.py
  - analytics-service/tests/test_equity_reconstruction.py
  - analytics-service/tests/test_equity_reconstruction_integration.py
  - analytics-service/tests/test_equity_reconstruction_live.py
  - src/__tests__/allocator-equity-rls.test.ts
  - src/__tests__/seed-integrity.test.ts
  - src/app/(dashboard)/allocations/AllocationDashboard.tsx
  - src/app/(dashboard)/allocations/AllocationDashboard.regression-001.test.tsx
  - src/app/(dashboard)/allocations/AllocationDashboard.widget-gating.test.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.test.tsx
  - src/app/(dashboard)/allocations/EmptyState.tsx
  - src/app/(dashboard)/allocations/EmptyState.test.tsx
  - src/app/(dashboard)/allocations/ScenarioStub.tsx
  - src/app/(dashboard)/allocations/components/KpiStrip.tsx
  - src/app/(dashboard)/allocations/components/KpiStrip.warmup.test.tsx
  - src/app/(dashboard)/allocations/page.tsx
  - src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx
  - src/app/(dashboard)/allocations/widgets/performance/EquityCurve.tsx
  - src/app/(dashboard)/allocations/widgets/performance/equity-curve.equitydailypoints.test.tsx
  - src/components/auth/OnboardingWizard.noseeed.test.tsx
  - src/lib/allocation-helpers.equity-adapter.test.ts
  - src/lib/allocation-helpers.ts
  - src/lib/gdpr-export.ts
  - src/lib/queries.my-allocation.test.ts
  - src/lib/queries.ts
  - src/lib/utils.test.ts
  - supabase/migrations/070_allocator_equity_snapshots.sql
findings:
  critical: 0
  warning: 5
  info: 8
  total: 13
status: issues_found
---

# Phase 7: Code Review Report

**Reviewed:** 2026-04-20T19:25:40Z
**Depth:** standard
**Files Reviewed:** 28 (plus 1 auxiliary: queries.ts)
**Status:** issues_found

## Summary

Phase 07 (Demo-Mode Purge / PURGE-01…07) introduces the allocator equity
reconstruction substrate (migration 070), a Python worker pair for
backfill + daily refresh (equity_reconstruction.py), key-scoped job coherence,
a rewired `getMyAllocationDashboard` payload, the new `AllocationsTabs`
shell, widget-gating in `AllocationDashboard.tsx`, the `EmptyState` CTA, and
a batch of TDD Red-gate + regression tests. The implementation is solid,
follows the VOICES-ACCEPTED directives (f1 key-scoping, f2 widget gating,
f3 derive-each-render, f7 parallel-prop adapter, f9 per-venue depth), and
CTAs consistently target `/profile?tab=exchanges` (retired routes `/connections`
and `/exchanges` are not referenced in new code).

No critical (security / data-loss / crash) issues were found. The 5
warnings are correctness edge cases — mostly around numeric-boundary
handling (peak=0 in drawdown, negative / zero equity, holdings ordering
used by `.order("asof", desc)` combined with the local max-asof loop
creating a misleading defensive-guard comment). The 8 info items flag
small code-quality improvements: a misspelled filename, dead
imports, a naming mismatch, forward-fill DST hazard in the adapter,
and a few documentation inconsistencies.

Notable positives:
- Migration 070's 12-assertion self-verifying DO block (a–l) is
  comprehensive and correctly pins the f1 BLOCKER fix (refresh kind
  must be `api_key_id IS NOT NULL`).
- TDD Red-gate tests (AllocationsTabs f3, EmptyState, KpiStrip warmup,
  widget-gating f2, equity-curve f7) demonstrate that each test actually
  exercises the divergence behaviour (e.g. the f3 test rerenders with
  different searchParams and would fail under a `useState` snapshot).
- Integration + live ccxt env-gated tests (test_equity_reconstruction_integration.py
  and test_equity_reconstruction_live.py) provide the Voice-A f5 and
  Grok f3 reinforcement coverage.
- Test credentials + env gating: live-ccxt + integration-DB tests are
  correctly guarded by module-level `pytest.skip` against `QUANTALYZE_*`
  env flags; the files commit zero secrets.

## Warnings

### WR-01: DrawdownChart divide-by-zero when first snapshot value_usd ≤ 0

**File:** `src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx:40-44`
**Issue:** In the `equityDailyPoints` branch, `peak = equityDailyPoints[0].value`
seeds from the first snapshot. When the first row's `value_usd` is 0 (an
allocator whose first reconstructed day happens to be empty of priceable
holdings) or negative (derivative margin below zero), the subsequent
`(d.value - peak) / peak` computation returns `NaN` or `Infinity` and feeds
NaN into recharts. There IS a `peak > 0 ? ... : 0` guard inside the loop,
but that only catches the case where peak becomes 0 or negative **during**
the loop — on the first iteration, `peak` is already set to the
possibly-zero seed before the check runs. If `equityDailyPoints[0].value === 0`,
the first point's drawdown is `(0 - 0) / 0` → NaN.

**Fix:**
```ts
if (equityDailyPoints !== undefined) {
  if (equityDailyPoints.length === 0) return [];
  let peak = Math.max(equityDailyPoints[0].value, 0);
  const result: { date: string; value: number }[] = [];
  for (const d of equityDailyPoints) {
    if (d.value > peak) peak = d.value;
    const dd = peak > 0 ? (d.value - peak) / peak : 0;
    result.push({ date: d.date, value: dd });
  }
  return result;
}
```
Or add an explicit guard before seeding: `const first = equityDailyPoints.find(p => p.value > 0) ?? equityDailyPoints[0];` and use that as the peak seed.

---

### WR-02: `getMyAllocationDashboard` holdings query orders `asof` DESC but code re-checks `r.asof > existing.asof` — the "defensive" guard is actually load-bearing

**File:** `src/lib/queries.ts:777-781` (and `src/lib/queries.ts:834-842`)
**Issue:** The PostgREST query at line 834 says
`.order("asof", { ascending: false })`, and the derive function comment
(line 776) claims: "Rows arrive sorted by asof DESC, but we defensively
keep only the max-asof row." The loop in lines 777–781 uses
`if (!existing || r.asof > existing.asof) holdingsMap.set(...)` — so it
picks the **largest** asof per symbol. With rows sorted DESC, the FIRST
row for each symbol is already the newest, and the `r.asof > existing.asof`
branch should NEVER fire (since subsequent rows have smaller asofs). That
makes the guard not "defensive" — it's load-bearing if the query order
ever drifts. More importantly, the loop body evaluates correctly today,
but the comment misleads future readers into thinking the ordering is a
performance optimization rather than a correctness-irrelevant artifact.
Either drop the `.order()` clause (the loop handles unordered input
correctly), or change the comment to: "We pick the max-asof per symbol
regardless of input order — the `.order()` above is a hedge, not a
requirement." Otherwise a future refactor that removes `.order()` will
look safe by the comment but will actually have always been safe — and a
refactor that changes the comparator to `<` (thinking "keep the
first-seen which should be newest") will silently regress.

**Fix:** Either remove `.order("asof", desc:false)` from the query and
rely on the loop (simpler, less data shipped), OR update the comment to
match intent:
```ts
// We pick the largest-asof row per symbol by linear scan. Input order
// is irrelevant; the `.order()` clause above is a no-op hedge kept so
// a logger inspection shows newest-first naturally.
```

---

### WR-03: `_compute_daily_equity` assumes "/"-delimited symbol shape but treats trades from non-spot markets without bailing

**File:** `analytics-service/services/equity_reconstruction.py:437-449`
**Issue:** The loop over trade events does:
```python
sym = (ev.get("symbol") or "").split("/")[0].upper()
...
quote = (ev.get("symbol") or "").split("/")[-1].upper() if "/" in (ev.get("symbol") or "") else "USDT"
```
For perpetual futures on Binance / Bybit, `symbol` is often of the form
`"BTC/USDT:USDT"` (the CCXT normalisation for linear perps), so `split("/")[0]`
returns `"BTC"` (correct base) but `split("/")[-1]` returns `"USDT:USDT"`
(incorrect — would pollute a non-existent quote symbol in the quantities
dict). Deribit futures come back as `"BTC/USD:BTC"` (inverse). For this
phase, Deribit is explicitly rejected up front, but for Binance/OKX/Bybit,
if an allocator has **any** perp fills, the quote-side quantity accounting
will leak into `"USDT:USDT"` which never gets priced (and so never shows
up in equity), but the base-side quantity increments correctly — so
positions double-count (perp buys look like spot buys with no quote
decrement to offset them). Since Phase 07 handles reconstruction purely
from spot history (positions are priced via close × quantity), the
impact is a spurious base balance. The fallback `else "USDT"` when no
"/" is present covers margin/inverse naming oddities but not the
":settle" suffix.

**Fix:** Normalize the quote side via CCXT's canonical fields instead of
string-splitting, e.g.
`quote = (ev.get("symbol") or "").split("/")[-1].split(":")[0].upper()`.
Or, at a higher level, skip non-spot fills entirely in reconstruction
(check `ev.get("type") == "spot"` or similar) — spot-only reconstruction
matches the current phase scope and sidesteps inverse-contract pricing
altogether. The current behaviour does not raise but silently skews
balances.

---

### WR-04: `_fetch_transfers` swallows generic exceptions silently after first window — non-transient errors appear as partial data

**File:** `analytics-service/services/equity_reconstruction.py:215-231`
**Issue:** The paginated transfer loop catches `ccxt.NotSupported` and
returns early (correct — feature detection), but then a bare
`except Exception` logs a warning AND `break`s out of the loop without
surfacing the failure upstream. For a 2-year backfill with ~8 windows,
if window 3 returns an auth error (e.g. read-only key doesn't have
`ENABLE_WITHDRAWALS` permission revoked mid-backfill), we silently keep
the first 2 windows' rows and never see the later ones. The resulting
snapshot rows will then be missing half the allocator's deposits, which
looks like zero activity — no "reconstruct_failed" audit event fires.
Compare to `_fetch_trades_with_pagination` which does NOT catch generic
exceptions, letting them bubble to the handler's outer try/except where
they are classified + audited.

**Fix:** Either (a) remove the `except Exception` branch and let
classification + auditing happen in the outer handler; or (b) log the
failure and continue rather than break, so a single bad window doesn't
cap the final row count. Recommend (a):
```python
# Remove lines 220-224 entirely so the outer handler classifies.
try:
    page = await fetcher(None, cursor_ms, 500)
except ccxt.NotSupported:
    return all_rows
# No generic-except branch — let it bubble.
```

---

### WR-05: `persist_equity_snapshots` silently marks CoinGecko-fallback rows with `source` BEFORE `history_depth_months` is decided — but the row's `source` is set at compute time, not persist time

**File:** `analytics-service/services/equity_reconstruction.py:545-556`
**Issue:** The mapping reads `r.get("source") == "coingecko_fallback"` to
decide whether to attach `history_depth_months` as None. But in
`_compute_daily_equity`, rows with **mixed** source (both exchange_primary
and coingecko_fallback used in the same day's breakdown) get
`source = "mixed"`, not `"coingecko_fallback"`. So a mixed-source row
inherits the per-venue `history_depth_months` (e.g. 24) even though some
of the priced symbols came from CoinGecko (for which the retention
concept doesn't apply). If an allocator has both BTC (priced via
exchange OHLCV) and a long-tail altcoin (priced via CoinGecko) on the
same day, the row is tagged `"mixed"` and `history_depth_months=24`
flows to the UI. The f9 warm-up copy "Only N months of history available
on Binance" then renders for an allocator whose actual limiting factor
is CoinGecko caching — arguably misleading, though not strictly wrong
because the Binance leg IS 24mo-retained.

**Fix:** This is a semantics question. Two options:
1. Attach `history_depth_months` only when `source == "exchange_primary"`
   (stricter — mixed rows get NULL and the UI falls back to the
   minimum non-null depth across all rows). This is the safer default.
2. Keep as-is and document the semantics more explicitly in the column
   comment on migration 070 so future consumers understand that `mixed`
   rows carry the VENUE retention, not a per-row "effective retention."

Recommend (1):
```python
row_depth = (
    history_depth_months
    if r.get("source") == "exchange_primary"
    else None
)
```
This aligns with the intent of `history_depth_months` (per-venue
retention) and doesn't muddy the mixed-source case.

## Info

### IN-01: Filename misspelling — `OnboardingWizard.noseeed.test.tsx` (triple-e)

**File:** `src/components/auth/OnboardingWizard.noseeed.test.tsx`
**Issue:** Filename contains `noseeed` with an extra `e`. The intent is
`noseed` (no seeding). Comments inside the file use `noseed` consistently.
Filename typos are findable via grep but cost a minute every time someone
greps for `noseed`.
**Fix:** Rename to `OnboardingWizard.noseed.test.tsx`. Update any CI
invocations that pattern-match by name (none found in a cursory search,
but check `package.json` scripts + CI YAML).

---

### IN-02: `equitySnapshotsToDailyPoints` forward-fill loop reconstructs Date objects per iteration

**File:** `src/lib/allocation-helpers.ts:47-56`
**Issue:** The gap-filler loop allocates a new `Date` every iteration
(`new Date(prevDate.getTime() + ONE_DAY_MS)`, then again at the tail
`fill = new Date(fill.getTime() + ONE_DAY_MS)`). For a 2-year (730-day)
backfill with one big gap, that's ~1500 Date allocations per render
(on each `getMyAllocationDashboard` call). Not a correctness problem
and not a hotspot, but a small cleanup:
**Fix:** Use numeric ms math and only format to ISO at push time:
```ts
for (let fillMs = prevDate.getTime() + ONE_DAY_MS;
     fillMs < curDate.getTime();
     fillMs += ONE_DAY_MS) {
  points.push({
    date: new Date(fillMs).toISOString().slice(0, 10),
    value: prevValue,
  });
}
```

---

### IN-03: Unused `DAY_MS` in `queries.my-allocation.test.ts`

**File:** `src/lib/queries.my-allocation.test.ts:775, 1063`
**Issue:** `const DAY_MS = 24 * 60 * 60 * 1000;` is declared and later
`void DAY_MS;` is used to suppress the lint warning. The constant is
not referenced anywhere else in the file. This is dead code.
**Fix:** Remove both the declaration and the `void DAY_MS;` line.

---

### IN-04: `EquityCurve` and `DrawdownChart` widget IDs — hardcoded dash-to-kebab comparison is brittle

**File:** `src/app/(dashboard)/allocations/AllocationDashboard.tsx:570-572`
**Issue:** `const forwardEquityPoints = widgetId === "equity-curve" || widgetId === "drawdown-chart";`
String-matches widget IDs inline. If a future registry rename (e.g. to
`equity-curve-v2`) happens, the parallel-prop forward silently breaks
and EquityCurve falls back to strategies-derived compute. Not a
correctness issue today, but consider co-locating the ID list with
the widget registry or adding a constant.
**Fix:**
```ts
// Top of file:
const WIDGETS_WITH_EQUITY_DAILY_POINTS = new Set<string>([
  "equity-curve",
  "drawdown-chart",
]);
// In renderWidget:
const forwardEquityPoints = WIDGETS_WITH_EQUITY_DAILY_POINTS.has(widgetId);
```

---

### IN-05: `AllocationDashboard.tsx` — `[data-widget-id]` observer attaches after MutationObserver callback, so initial tiles are observed twice

**File:** `src/app/(dashboard)/allocations/AllocationDashboard.tsx:316-327`
**Issue:** The initial `tiles.forEach((t) => observer.observe(t));`
observes every tile present at mount. The `MutationObserver` callback
then, on the next mutation (which fires immediately because the grid's
own React sub-tree may commit after effect-runs), also observes every
tile it sees, skipping ones already in `widgetViewsFiredRef`. This is
guarded by the Set, so no double-fire — but `observer.observe()` is
idempotent anyway (the IntersectionObserver spec says "if target is
already in the internal list, return") so this isn't a behaviour bug,
just confusing. Add a comment noting the dedup is the Set + IntersectionObserver
spec guarantee.
**Fix:** Document behaviour or gate the mutation callback on the
element not being in the initial set.

---

### IN-06: `_fetch_ohlcv_daily` may infinite-loop if exchange returns non-advancing timestamps AND fills a full 1000-candle page

**File:** `analytics-service/services/equity_reconstruction.py:245-257`
**Issue:** The loop advances `cursor_ms = max_ts + day_ms` when there's
progress, but the early-exit `if max_ts <= cursor_ms: break` only fires
when the max timestamp in the page is less than or equal to the cursor.
If an exchange returns 1000 rows with timestamps all equal to
`cursor_ms + 1` (pathological but possible with clock skew), then
`max_ts > cursor_ms` on every iteration and `len(page) >= 1000`, so the
next iteration advances cursor by `day_ms`. That's bounded by the outer
while `cursor_ms <= end_ms` condition, so for a 2-year backfill the
loop terminates after ~730 iterations. Not truly infinite, but
worth documenting. The trade-pagination loop (line 174) has an
explicit `for _ in range(500)` safety ceiling — the ohlcv loop does
not. Not a real risk today; flagged for symmetry.
**Fix:** Add an explicit iteration ceiling matching the trade loop:
```python
for _ in range(1200):  # ~3 years of daily candles ceiling
    if cursor_ms > end_ms: break
    ...
```

---

### IN-07: Migration 070 self-verify DO block's `v_cron_hour` parse can silently cast a missing value to 0 via `split_part` returning `''`

**File:** `supabase/migrations/070_allocator_equity_snapshots.sql:592-597`
**Issue:** `SELECT (split_part(schedule, ' ', 2))::INT INTO v_cron_hour`.
If `schedule` is malformed (e.g. contains only one field), `split_part`
returns `''` and the `::INT` cast raises `invalid_text_representation`,
aborting the migration with a generic error instead of the nice
"refresh-allocator-equity cron hour must stay BETWEEN 1 AND 22" message.
For the assertion to be stronger, cast via NULLIF first.
**Fix:**
```sql
SELECT NULLIF(split_part(schedule, ' ', 2), '')::INT INTO v_cron_hour
  FROM cron.job WHERE jobname = 'refresh-allocator-equity';
-- then existing IF v_cron_hour IS NULL covers it.
```

---

### IN-08: `_install_fake_preflight` in test_equity_reconstruction.py monkeypatches `equity_reconstruction.get_supabase` via `raising=False` — masks refactor drift

**File:** `analytics-service/tests/test_equity_reconstruction.py:295, 300`
**Issue:** `monkeypatch.setattr(er, "_allocator_key_preflight", _fake_preflight, raising=False)`
and `monkeypatch.setattr(er, "get_supabase", lambda: fake_supabase, raising=False)`.
The `raising=False` means: if the attribute doesn't exist on the
module, monkeypatch does nothing silently. This is intentional here
(the handler uses `from services.job_worker import _allocator_key_preflight`
so the name might not be exposed on `er`), but it hides the case where
someone refactors and the real call path flows through a different
module — the test keeps passing against mocked data that never touches
the real code path. Not a correctness bug, just test-brittleness.
**Fix:** Add one assertion that the fake actually got called at least
once, e.g. with a counter in `_fake_preflight`, so the test can't
silently no-op when internal call chains drift.

---

_Reviewed: 2026-04-20T19:25:40Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---
phase: 14b
review_type: multi-persona-adversarial
model: grok-4.20-0309-non-reasoning
personas: [senior-quant-engineer, adversarial-perf-scale, skeptical-product-design]
date: 2026-04-29
status: complete
raw_json_dir: .grok-review/
blockers: 5
warnings: 2
info: 1
---

# Phase 14b Grok Multi-Persona Plan Review

Reviewed plans: 14b-01 through 14b-08.
All 3 Grok API calls succeeded (model: `grok-4.20-0309-non-reasoning`).

---

## BLOCKER Findings

### B-01 — sharpe_180d key does not exist in Phase 12 rolling_metrics

**Plans affected:** 14b-03
**Personas:** P1 (Quant), P2 (Perf), P3 (Design) — unanimous BLOCKER
**Issue:** `pickSharpeForWindow("6M")` maps to key `"sharpe_180d"` in the `rolling_metrics` blob. Phase 12 only shipped `sharpe_30d`, `sharpe_90d`, `sharpe_365d`. The key `"sharpe_180d"` does not exist. The **6M window is the default-active window**, so every user's first-visible state shows a completely empty Rolling Sharpe chart. There is no fallback.
**Risk:** Silent empty render on the default tab. No error state, no banner. Looks like a data gap.
**Fix:** Update `pickSharpeForWindow` to map `"6M"` → `"sharpe_90d"` (nearest match) or `"sharpe_365d"`. Update the fallback chain accordingly. Alternatively, add `sharpe_180d` to Phase 12's `rolling_metrics` computation (backend change) — but this is a new key, not in scope. The plan-level fix (frontend) is to pick the nearest existing key and document the approximation.

---

### B-02 — DailyHeatmap Canvas geometry overflow for 5-year fixture

**Plans affected:** 14b-01
**Personas:** P1 (Quant), P2 (Perf), P3 (Design) — unanimous BLOCKER
**Issue:** The Canvas renderer places cells at `x = day_of_year * 4` on a `canvas.width = 730px`. For a 5-year fixture with `day_of_year` up to 365, the maximum x-offset is `365 * 4 = 1460px`, which is 2× the canvas width. All cells for day_of_year > 182 are painted off-canvas and clipped. The rendered heatmap shows only the first half of each year.
**Risk:** Visually and mathematically wrong daily returns distribution. The 5-year golden fixture for the chart-parity spec will capture the truncated version, locking in a broken baseline.
**Fix (A):** Reduce cell size to 2px: `cellW = cellH = 2`, `canvas.width = 730`. Max x = `365 * 2 = 730px`. Fits exactly.
**Fix (B):** Refactor layout to `row = month_index (0..11)`, `col = day_of_month (0..30)`, cell 16×16. Canvas width ≈ `31 * 16 = 496px`, height ≈ `years * 12 * 16`. Consistent with UI-SPEC §3.5 "year × month grid" described for the SVG branch.

---

### B-03 — `"equity"` panelId bypasses PANEL_TO_ID and may be absent from migration 087 CASE

**Plans affected:** 14b-05, 14b-06
**Personas:** P1 (Quant), P2 (Perf), P3 (Design) — unanimous BLOCKER
**Issue:** `HeadlineMetricsPanel` (Plan 14b-06) calls `fetchStrategyLazyMetrics(strategyId, "equity")` directly to fetch `log_returns_series`. `"equity"` is present in the `LazyMetricsPanelId` union type but **absent from the `PANEL_TO_ID` map** (which only covers panel4..panel7). The plan relies on migration 087's SQL CASE statement mapping `"equity"` → `log_returns_series`. If that CASE entry is missing or the RPC function doesn't handle `"equity"`, `fetchStrategyLazyMetrics` returns `{}` and `EquityCurve` renders empty. No test covers this path.
**Risk:** Log Returns button in Panel 2 shows an empty chart for every strategy. Silently broken.
**Fix:** Verify migration 087 CASE includes `WHEN panel_id = 'equity' THEN 'log_returns_series'`. Add a dedicated integration test for the `"equity"` fetch path. Consider adding `equity: "log_returns_series"` to `PANEL_TO_ID` (even if the hook itself isn't used for this path) so the mapping is centralized and auditable.

---

### B-04 — Panel 6 lazy fetch error masks valid eager trade_metrics

**Plans affected:** 14b-04
**Personas:** P1 (Quant), P2 (Perf), P3 (Design) — unanimous BLOCKER
**Issue:** Panel 6's lazy hook fires on intersection and calls `fetchStrategyLazyMetrics("trades")` which returns `{}` (empty payload — all trade data comes from the eager analytics blob). This fetch is intentionally a no-op for data purposes (lifecycle alignment only). However, if the RPC returns an error (network failure, 500, timeout), the hook transitions to `status="error"` and the panel renders in error state — even though the full `trade_metrics` data is already available from the eager load. There is no fallback or error-boundary that differentiates "lazy fetch failed but eager data is valid."
**Risk:** Any transient RPC error on the `trades` panel shows a full error state to the user, hiding valid Trade & Position data.
**Fix:** Either (a) skip the lazy fetch entirely for panel6 (set `fetchOnIntersect: false`; just emit `status="ready"` on intersection) since no heavy series are needed, or (b) add an error boundary that catches lazy fetch errors on panel6 specifically and falls back to displaying the eager data with a non-blocking warning indicator.

---

### B-05 — SSR/client hydration mismatch when flag default flips to ON

**Plans affected:** 14b-08
**Personas:** P2 (Perf), P3 (Design) — BLOCKER
**Issue:** `isStrategyUiV2Enabled()` will return `true` on SSR (no localStorage on server). Users who previously set `localStorage["strategy.ui_v2"] = "false"` will get: SSR renders v2 → client hydration reads localStorage → returns `false` → React re-renders v1. This is a full hydration mismatch causing layout shift, flash of wrong UI, and potential interactive broken state.
**Risk:** Affects all opt-out users (anyone who manually set v1 during the flag=OFF period). First-load experience is broken. React's strict hydration will likely log warnings or errors in production.
**Fix:** Use `useEffect` on the client side to read localStorage after hydration, with `suppressHydrationWarning` on the route root; or persist the flag as a cookie readable by SSR. The cleanest fix: SSR returns `false` for the flag until v1 route is fully removed (Sprint 13 cutover), then flip SSR. Alternatively, use a `<ClientFlagWrapper>` that renders `null` on first pass and then applies the flag.

---

## WARNING Findings

### W-01 — React render explosions on DailyHeatmap + Panel 4 lazy state changes

**Plans affected:** 14b-01, 14b-02, 14b-07
**Persona:** P2 (Perf)
**Issue:** Panel 4 mounts 5 sub-charts including DailyHeatmap. Panel-level status transitions (`idle → loading → ready`) live inside each panel component's state, causing re-renders that propagate to all 5 sub-charts including DailyHeatmap. Under a slow connection (or 5y fixture with 1825 cells), each status change triggers a Canvas useEffect re-paint.
**Risk:** Scroll jank and visual flickering during Panel 4 lazy mount, especially on the 5-year fixture used by the <300ms paint budget test.
**Fix:** Apply `React.memo` to `DailyHeatmap` and each sub-chart wrapper. Move panel status state higher or use `useMemo` to stabilize chart props across status transitions. Ensure Canvas `useEffect` has correct deps (only `data` — not `status`).

### W-02 — `discovery-axe.spec.ts` has no DISCOVERY_SLUG env-var gate; keyboard spec assumes all panels loaded

**Plans affected:** 14b-07
**Persona:** P1 (Quant), P3 (Design)
**Issue (a):** `discovery-axe.spec.ts` hardcodes `"/discovery/crypto-sma"` with no env-var guard. If the test DB does not have a strategy published at that slug, the spec runs against a 404 or empty state. An empty page has zero axe violations → **false green** that never catches real violations.
**Issue (b):** `strategy-v2-keyboard.spec.ts` asserts tab order across all 7 panels but lazy panels (4-7) only load on scroll-into-view. If the spec doesn't scroll each panel into view before asserting focus order, lazy panels remain as placeholders and the keyboard traversal test silently skips them.
**Risk:** axe CI passes on an untested empty page; keyboard tests don't cover the lazy panels they claim to test.
**Fix (a):** Add `test.skip(!process.env.DISCOVERY_SLUG, "...")` guard matching the partial-data spec pattern. Gate on seed helper presence.
**Fix (b):** Add explicit `page.evaluate(() => window.scrollBy(0, panelOffsetY))` + `waitFor(panelStatus === "ready")` before each keyboard section in the spec.

---

## INFO Findings

### I-01 — No unmount cleanup for IntersectionObserver in useLazyPanelMetrics

**Plans affected:** 14b-01
**Persona:** P2 (Perf)
**Issue:** If a user navigates away from StrategyV2Detail before the IntersectionObserver fires, the observer reference is not disconnected. Over long sessions with rapid navigation, observers accumulate.
**Risk:** Memory leak in long-running sessions. Low probability in typical navigation but worth noting.
**Fix:** Return cleanup from the `useEffect` that creates the observer: `return () => observerRef.current?.disconnect()`. The plan's Test 8 (cleanup on unmount) should cover this; verify the cleanup function is actually returned, not just called.

---

## Aggregate Verdict

| Severity | Count | Blocking merge? |
|----------|-------|----------------|
| BLOCKER  | 5     | YES             |
| WARNING  | 2     | Recommend fix before ship |
| INFO     | 1     | Fix in same PR or next pass |

**All 5 BLOCKERs must be resolved before Wave 4 (14b-07/08) can run.** B-01 and B-02 are the most urgent — they produce wrong financial visualizations on the default view. B-04 and B-05 are UX correctness issues. B-03 is a data pipeline gap that may only surface in manual testing.

---

## Priority Fix Order

1. **B-02 (Canvas geometry)** — fix before writing chart-parity golden fixtures; otherwise goldens capture broken layout.
2. **B-01 (sharpe_180d)** — fix before any Panel 5 integration test; otherwise every rolling metrics test passes against empty data.
3. **B-03 (equity panelId)** — verify migration 087 CASE; add test.
4. **B-04 (panel6 lifecycle)** — either skip fetch or add error boundary.
5. **B-05 (SSR hydration)** — address before 14b-08 flag flip commit.

---

## Per-Plan Summary Table

| Plan | Blockers | Warnings | Key issue |
|------|----------|----------|-----------|
| 14b-01 | 1 (B-02) | 1 (W-01) | Canvas geometry overflows 730px; observer cleanup |
| 14b-02 | 0 | 0 | Color audit plan looks correct; verify actual file grep output |
| 14b-03 | 1 (B-01) | 0 | sharpe_180d key does not exist in Phase 12 rolling_metrics |
| 14b-04 | 1 (B-04) | 0 | Lazy {} fetch error masks valid eager trade_metrics |
| 14b-05 | 1 (B-03) | 0 | "equity" outside PANEL_TO_ID; migration 087 CASE must be verified |
| 14b-06 | 0 | 0 | Integration straightforward given B-03 is fixed |
| 14b-07 | 0 | 1 (W-02) | discovery-axe no env guard; keyboard spec needs scroll-into-view |
| 14b-08 | 1 (B-05) | 0 | SSR/client hydration mismatch on flag flip |

---

*Raw Grok API responses: `.grok-review/persona1-quant.json`, `.grok-review/persona2-performance.json`, `.grok-review/persona3-design.json`*

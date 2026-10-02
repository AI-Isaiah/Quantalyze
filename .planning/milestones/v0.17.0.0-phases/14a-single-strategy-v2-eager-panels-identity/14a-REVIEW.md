---
phase: 14a
status: findings
critical_count: 0
medium_count: 5
low_count: 4
date: 2026-04-29
---

# Phase 14a: Code Review Report

**Reviewed:** 2026-04-29
**Depth:** standard
**Files Reviewed:** 22
**Status:** issues_found

---

## Summary Table

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| MEDIUM | 5 |
| LOW | 4 |

---

## Summary

Phase 14a ships a solid foundation. The new RSC route, flag reader, IntersectionObserver scaffold, chart-token extension, and test infrastructure are all well-structured and follow established project conventions. No critical security or data-loss issues found.

Five medium-severity findings require attention before merge:

1. **Incorrect underwater transform** in Panel 2 — clips equity curve to zero instead of computing running-max drawdown (logic bug; will render wrong chart shape).
2. **`getStrategyDetailV2` not wrapped in `React.cache()`** — causes two separate Supabase round-trips per page load (one from `generateMetadata`, one from the page component), violating the p95 < 50ms METRICS-15 contract on the double-fetch path.
3. **`EquityCurve` fontSize still 11 after DESIGN-01 audit** — the lightweight-charts `layout.fontSize` was not updated from 11 to 12 to match the 4-size v2 contract. Mismatches the `CHART_TICK_STYLE` token that sets 12.
4. **`DrawdownChart` tick props not migrated to `CHART_TICK_STYLE`** — both `<XAxis>` and `<YAxis>` still use inline `tick={{ fontSize: 11, ... }}` literal objects (Pitfall 14 violation; grep `tick=\{\{` against v2 panels would catch this if DrawdownPanel is treated as in-scope).
5. **Unstable ref callback in `useLazyPanelMetrics`** — the `ref` function is defined inline, so a new function identity is created on every render. For placeholder cards this is low-impact today, but will cause repeated disconnect/reconnect cycles in Phase 14b when the hook fires fetches.

Four low-severity findings are informational.

---

## Medium Issues

### MD-01: Incorrect underwater transform in Panel 2

**File:** `src/components/strategy-v2/HeadlineMetricsPanel.tsx:195–199`
**Category:** Bug / Logic error

**Issue:** The Underwater view derives drawdown from the equity series using `Math.min(0, d.value - 1)`. This clips the raw return to ≤ 0 but does **not** compute the running-maximum drawdown (underwater equity = `value / runningMax - 1`). For an equity curve with a peak of 1.42 followed by a pullback to 1.25, the real underwater at the pullback is `1.25 / 1.42 - 1 ≈ −12%`; the current formula yields `1.25 − 1 = +0.25`, which `Math.min(0, 0.25)` then clips to `0` — showing no drawdown at all during a real drawdown period. The chart will systematically under-report underwater depth whenever the strategy is above its starting value.

The comment in the code acknowledges this ("If the series is non-drawdown-shaped, Phase 14b will replace this") but the bug is silent and produces a misleading chart for users who view the Underwater tab on a profitable strategy.

**Fix:**
```tsx
// Replace lines 195-199:
(panel2Equity.series ?? []).map((d, i, arr) => {
  const runningMax = arr.slice(0, i + 1).reduce(
    (mx, p) => Math.max(mx, p.value),
    arr[0]?.value ?? 1,
  );
  return { date: d.date, value: d.value / runningMax - 1 };
})
```

If a pre-computed underwater series is unavailable in Phase 14a, the safer fallback is to show the `PartialDataBanner` for the Underwater tab (same as other missing-data cases) rather than silently rendering a wrong chart.

---

### MD-02: `getStrategyDetailV2` not wrapped in `React.cache()`

**File:** `src/lib/queries.ts:347`
**Category:** Bug / Performance contract violation

**Issue:** `page.tsx` calls `generateMetadata` and `StrategyV2Page` sequentially per request. Both call `getStrategyDetailV2(id)` independently. Without `React.cache()`, this triggers two Supabase round-trips on every page load. The METRICS-15 success criterion SC#3b requires the path-extraction to complete p95 < 50ms; a double-fetch doubles the Supabase latency budget. All other query functions that serve both metadata and page components in this project are wrapped in `cache()` — see `getRealPortfolio` (line 697) and `getMyAllocationDashboard` (line 1330).

**Fix:**
```ts
// src/lib/queries.ts
import { cache } from "react"; // already imported at line 1

export const getStrategyDetailV2 = cache(async (
  strategyId: string,
): Promise<StrategyV2Detail | null> => {
  // ... existing body unchanged
});
```

---

### MD-03: `EquityCurve` `fontSize: 11` not updated to 12 after DESIGN-01 audit

**File:** `src/components/charts/EquityCurve.tsx:48`
**Category:** Identity violation / Pitfall 14 partial compliance

**Issue:** The DESIGN-01 audit replaced hardcoded hex colors in `EquityCurve.tsx` (verified — `#0D9488` → `CHART_ACCENT` is correct). However, `layout.fontSize: 11` on line 48 was not updated to `12`. The 14a UI-SPEC §2 explicitly consolidates the v2 type scale to 12px minimum (caption tier); the `CHART_TICK_STYLE` token sets `fontSize: 12`. `EquityCurve` uses lightweight-charts (not Recharts), so `CHART_TICK_STYLE` does not apply directly — but the `layout.fontSize` is the equivalent setting and must match the 12px contract when `EquityCurve` is mounted inside Panel 2.

This also means the axis-tick font size in the Cumulative chart (11px) and the chart-contrast test's assertion about `CHART_AXIS_TICK` being `#64748B` at the correct size diverge at the lightweight-charts level.

**Fix:**
```ts
// EquityCurve.tsx line 48
fontSize: 12,   // was 11; matches CHART_TICK_STYLE 12px caption tier (UI-SPEC §2)
```

---

### MD-04: `DrawdownChart` XAxis/YAxis tick props are inline objects — Pitfall 14 violation

**File:** `src/components/charts/DrawdownChart.tsx:27,34`
**Category:** Identity violation / Pitfall 14

**Issue:** Both `<XAxis tick={{ fontSize: 11, fill: CHART_AXIS_TICK, fontFamily: CHART_FONT_MONO }}>` and `<YAxis ...>` use literal inline objects that (a) set `fontSize: 11` (violates the 12px v2 contract) and (b) omit `fontVariantNumeric: "tabular-nums"` (the entire purpose of `CHART_TICK_STYLE`). The UI-SPEC §2 mandates: "The grep pattern `tick=\{\{` against v2 panel files MUST return zero matches at PR review." `DrawdownChart` is mounted by `DrawdownPanel` (Panel 3) and by `HeadlineMetricsPanel` (Panel 2 Underwater) — both are Phase 14a panel files. The Pitfall 14 mitigation is incomplete if the chart components themselves are not migrated.

**Fix:**
```ts
// DrawdownChart.tsx — add CHART_TICK_STYLE to imports, then:
import { CHART_ACCENT, CHART_AXIS_TICK, CHART_BORDER, CHART_FONT_MONO, CHART_TICK_STYLE } from "./chart-tokens";

// Line 27:
<XAxis dataKey="date" tick={CHART_TICK_STYLE} ... />
// Line 34:
<YAxis tickFormatter={...} tick={CHART_TICK_STYLE} ... />
```

Note: `DrawdownChart` was not forked for v2 (CONTEXT.md: "no v2 fork"), so this fix applies to the shared component, which improves the existing v1 factsheet as well.

---

### MD-05: Unstable `ref` callback in `useLazyPanelMetrics` causes reconnect on every render

**File:** `src/hooks/useLazyPanelMetrics.ts:53–79`
**Category:** Bug / React pattern

**Issue:** The `ref` callback is defined as a plain `const` inside the hook body. This creates a new function identity on every render. React's callback-ref contract calls the old ref with `null` then the new ref with the node on each render cycle. The hook's cleanup path calls `observerRef.current?.disconnect()` on the new node call, so it reconnects the observer on every re-render of `LazyPanelPlaceholder`. In Phase 14a with `fetchOnIntersect: false` this wastes cycles but causes no visible bug. In Phase 14b when `fetchOnIntersect: true` is wired, a re-render of a visible placeholder panel would fire the fetch multiple times.

**Fix:**
```ts
// Wrap in useCallback so the ref identity is stable
import { useCallback, useEffect, useRef, useState } from "react";

const ref = useCallback((node: HTMLElement | null) => {
  if (!node) return;
  if (typeof IntersectionObserver === "undefined") {
    setStatus("ready");
    return;
  }
  observerRef.current?.disconnect();
  observerRef.current = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        setStatus("ready");
        observerRef.current?.unobserve(entry.target);
      }
    },
    { rootMargin: opts.rootMargin ?? "200px" },
  );
  observerRef.current.observe(node);
}, []); // eslint-disable-line react-hooks/exhaustive-deps
// opts.rootMargin is intentionally excluded — opts is not stable; if callers
// need dynamic rootMargin, extract it to a separate stable param.
```

---

## Low Issues

### LW-01: `DrawdownPanel` imports client-only components without `"use client"` directive

**File:** `src/components/strategy-v2/DrawdownPanel.tsx:3–4`
**Category:** Next.js / RSC boundary

**Issue:** `DrawdownPanel.tsx` has no `"use client"` directive but imports `DrawdownChart` and `WorstDrawdowns`, both of which have `"use client"` at their tops. In Next.js App Router, a server component _can_ import client components — the framework inserts the client boundary automatically. However the comment in the file says "Server component" (line 14) which is technically accurate but potentially misleading: the file will be rendered on the server, but `DrawdownChart` and `WorstDrawdowns` will ship as client bundles. No runtime bug, but the lack of an explicit `"use client"` on `DrawdownPanel` makes it easy for a future contributor to add a React hook inside it and get a confusing RSC error.

**Fix (optional):** Add `"use client";` at the top of `DrawdownPanel.tsx` to make the boundary explicit, matching `HeadlineMetricsPanel.tsx` which is similarly interactive-adjacent. If it intentionally stays a server component (e.g., to avoid the client bundle), add an explicit comment explaining why.

---

### LW-02: `fmtNumber` uses `toLocaleString()` — may cause hydration mismatch

**File:** `src/components/strategy-v2/OverviewPanel.tsx:17–19`
**Category:** SSR safety / Hydration risk

**Issue:** `fmtNumber` calls `value.toLocaleString()` which uses the runtime locale. On the server (Node.js) this may render `250,000` (US locale); on the client it renders according to the browser's locale setting. For users with a locale that uses `.` as a thousands separator (e.g., `250.000`), this is a mismatch and React will issue a hydration warning. `OverviewPanel` is a server component that renders directly in the RSC payload — this value is not re-rendered on the client, so the hydration mismatch may not surface immediately, but it can break streaming if the client locale differs from the server.

**Fix:** Use a locale-fixed formatter instead of relying on the runtime locale:
```ts
function fmtNumber(value: number | null): string {
  if (value === null || value === undefined) return EM_DASH;
  return new Intl.NumberFormat("en-US").format(value); // explicit locale
}
```

---

### LW-03: `error.tsx` logs `error` to `console.error` on every render

**File:** `src/app/strategy/[id]/v2/error.tsx:14–16`
**Category:** Code quality

**Issue:** `useEffect(() => { console.error(error); }, [error])` fires on mount and whenever `error` changes. In production this leaks stack traces to the browser console. The existing root `src/app/error.tsx` uses the identical pattern (line 19) with a TODO comment for Sentry integration. This is a consistent project pattern, so it is informational — but the v2 error boundary should inherit the TODO comment to keep observability alignment visible.

**Fix:** Match the root error boundary pattern:
```tsx
useEffect(() => {
  console.error("[error-boundary/strategy-v2]", error);
  // TODO: wire Sentry.captureException(error) once observability is set up
}, [error]);
```

---

### LW-04: `PartialDataBanner` missing `role="status"` or `aria-live`

**File:** `src/components/strategy-v2/PartialDataBanner.tsx`
**Category:** Accessibility / LOW

**Issue:** The banner replaces the body of a panel card when data is insufficient. If it appears after a client-side state change (e.g., the flag reader updates on mount), screen readers will not announce it. A11Y-01 is scoped to contrast; A11Y-02/03 are deferred to 14b. Still, adding `role="status"` costs nothing and future-proofs the component for when the flag reader causes a hydration-swap.

**Fix:**
```tsx
<div
  role="status"
  className="mx-auto max-w-[480px] rounded-md border border-border bg-surface-subtle p-4 text-center"
>
```

---

## Compliance Checklist

| Check | Result |
|---|---|
| Pitfall 14: `tick=\{\{` literal in v2 panel files | FAIL — `DrawdownChart` (used by panels 2+3) has inline tick objects (MD-04) |
| `CHART_TICK_STYLE` spread on all Recharts axes | FAIL — `DrawdownChart` not migrated (MD-04) |
| Hardcoded hex outside `chart-tokens.ts` in v2 panels | PASS — only `chart-tokens.ts` exports hex; panels use token refs |
| `EquityCurve` `#0D9488` → `CHART_ACCENT` (DESIGN-01) | PASS — colors corrected |
| `font-medium` / `font-light` / `font-bold` in strategy-v2 | PASS — zero violations |
| `text-[11px]` / `text-[13px]` / `text-sm` in strategy-v2 | PASS — zero violations |
| SSR guard on `localStorage` / `window` in flag reader | PASS |
| SSR guard on `IntersectionObserver` in hook | PASS |
| `params: Promise<{id: string}>` + `await params` in page.tsx | PASS — Next.js 16 async params correctly used |
| `"use client"` on error.tsx | PASS |
| `@nivo/boxplot` removed from package.json | PASS |
| `CHART_AXIS_TICK = #64748B` contrast >= 4.5:1 | PASS — 4.85:1 confirmed |
| `#94A3B8` / `#718096` absent as text fill in v2 panels | PASS |
| `generateMetadata` uses `async params` | PASS |
| 7 `<section data-panel>` elements emitted by shell | PASS |
| `data-panel-status="placeholder"` on panels 4–7 | PASS |
| `aria-disabled="true"` on disabled segmented buttons | PASS |
| BTC overlay default-ON (DIFF-03) | PASS — `useState(true)` in HeadlineMetricsPanel |
| `EquityCurve` `fontSize` matches 12px v2 contract | FAIL — still 11 (MD-03) |
| `getStrategyDetailV2` cached across metadata + page render | FAIL — not wrapped in `cache()` (MD-02) |

---

## Final Verdict

**5 medium, 4 low findings. Not clean.** MD-01 (wrong underwater chart shape) and MD-02 (double Supabase fetch) are the highest-priority fixes before merge. MD-03 and MD-04 are required to satisfy the Pitfall 14 and 4-size-contract acceptance gates (§14 items 3 and 7). MD-05 is a future-proofing fix recommended before Phase 14b wires real fetches.

---

*Reviewed: 2026-04-29*
*Reviewer: Claude (gsd-code-reviewer)*
*Depth: standard*

# Suspense streaming — current state and roadmap

## What's shipped (this phase)

- `loading.tsx` provides a route-level Suspense fallback (skeleton) while
  the server-side `buildFactsheetPayloadCached` runs.
- `unstable_cache` keyed by `(strategyId, computed_at)` means warm hits
  skip the 150ms bootstrap CI / event-study compute entirely — the
  payload is built once per analytics recompute.
- `<LazyMount>` defers below-fold panel mounting (Signatures, Cross
  Signatures, AllocatorSection) until the user scrolls into them, so
  the chart engine doesn't reconcile 30+ SVGs on first paint.

## What's still synchronous on cold cache

When the cache is cold, `buildFactsheetPayloadCached` builds the full
payload before any HTML ships:

- ~5ms — strategy returns + cumEq + drawdowns
- ~10ms — period buckets + monthly heatmap + daily heatmap matrices
- ~60ms — comparator blocks (BTC + SPX + NONE × align/rollings)
- ~150ms — bootstrap CI (2000 resamples × O(n) headlineStats each)
- ~80ms — event signatures × 2 (strategy + benchmark drivers)
- ~20ms — stress windows + correlations + quantiles

Total cold TTFB: roughly **300–400ms** on a 1000-day strategy. Warm
cache: **<10ms**.

## Roadmap — true streaming via server components

For the next perf phase, split `buildFactsheetPayload` into:

1. **Shell payload** — header + KPI + comparators + period buckets +
   heatmap matrices. Cheap (~80ms). Built synchronously, shipped first.
2. **Deep payload** — bootstrap CI + event signatures + cross signatures.
   Expensive (~230ms). Built as a Promise, awaited inside a server
   component nested under `<Suspense>`.

Then in `page.tsx`:

```tsx
export default async function Page() {
  const shell = await buildShellPayload(strategy, dailyReturns);
  const deepPromise = buildDeepPayload(strategy, dailyReturns); // not awaited

  return (
    <FactsheetView shellPayload={shell}>
      <Suspense fallback={<BootstrapCISkeleton />}>
        <BootstrapCIServer deepPromise={deepPromise} />
      </Suspense>
      <Suspense fallback={<SignaturesSkeleton />}>
        <SignaturesServer deepPromise={deepPromise} />
      </Suspense>
    </FactsheetView>
  );
}
```

That requires moving each deep panel to a server component (currently
they're all client components because they consume context for
display toggles). The bridge is a thin client wrapper that reads the
toggle context and passes data through.

## Cost-benefit

The cache makes warm hits free already. Splitting buys ~150ms on cold
hits — meaningful for low-traffic strategies, marginal for high-traffic
ones. Recommend doing this **after** server PDF (see `SERVER_PDF.md`)
since both touch the build-payload pipeline and should be designed
together.

# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## e2e-seeded-lane-flake — full-flow factsheet test hung 60 s or passed vacuously on /browse/crypto-sma
- **Date:** 2026-10-02
- **Error patterns:** locator.getAttribute timeout 60000ms, table tbody tr a, /browse/crypto-sma, flaky on first attempt, passed on retry, local-stack lane, is_example, Hide examples, hydration
- **Root cause(s):** lane crypto-sma holds only is_example rows (seed inserts examples only); StrategyTable SSRs all rows then hides examples on mount for anonymous visitors (hide_examples=true default); the test sampled the first paint once and wrapped its assertions in a silent `if (hasStrategies)` branch
- **Fix:** e2e/full-flow.spec.ts waits for the hydrated default (Hide examples checked), unticks it (focus + Space), requires a /factsheet/ row and asserts the factsheet names it; no conditional around assertions
- **Files changed:** e2e/full-flow.spec.ts
- **Why not caught:** no gate existed for this class; the silent branch turned an empty table into a pass, and shared TEST's accumulated non-example rows hid the data dependency
- **Recurrence guard:** e2e/full-flow.spec.ts "factsheet page loads for published strategy" fails on an empty browse table (negative probe measured); KB pattern: a single isVisible() sample on an SSR paint that a mount effect then filters
---

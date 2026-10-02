---
phase: 108-scenario-planner-onto-the-backbone
reviewed: 2026-07-15T17:22:54Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/lib/scenario-blend-adapter.ts
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/lib/diversification.ts
  - src/lib/scenario-blend-adapter.test.ts
  - src/lib/scenario-backbone-gates.test.ts
  - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
  - src/__tests__/phase-30-frozen-spine-guards.test.ts
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 108: Code Review Report

**Reviewed:** 2026-07-15T17:22:54Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Phase 108 routes the scenario-planner blend panels off the deleted bespoke
`scenario-blend-panels.ts` (211 LOC) onto the new `deriveBlendPanels` adapter,
which calls the canonical `factsheet/rolling.ts` population-std primitives with
an explicit 63/126/252 window and `factsheet/quantiles.ts::quantileSummary`.

I traced the focus areas and validated the following against the retired module
(recovered from git `89e982c0^:src/lib/scenario-blend-panels.ts`) and the
backbone primitives (`rolling.ts`, `quantiles.ts`):

- **Zip / warmup-drop seam is correct — no off-by-one.** `rollingVol/Sharpe/Sortino`
  each return `new Array(rets.length).fill(null)` with a value set only for
  `i >= window-1` (leading-warmup nulls, never interior). `zipDrop` zips
  `values[i]` against `portfolioDaily[i].date` (index-parallel because
  `rets = portfolioDaily.map(p=>p.value)`), producing length `n-window+1` with
  the first point dated `portfolioDaily[window-1].date`. Matches the retired
  module's directly-compacted output exactly.
- **No NaN / interior-null can slip through.** The degenerate guard returns
  `EMPTY` whenever ANY `!Number.isFinite(p.value)` is present, so the success
  path feeds the primitives only finite values; `pstdev/mean` over finite slices
  are finite, and the divide-guards (`s>0 ? … : 0`, `dd>0 ? … : 0`) never emit
  NaN/Inf. The `!== null` filter in `zipDrop` is a robust defensive guard.
- **Whiskers are absolute min/max, not p05/p95.** `quantiles.All = [q.min, q.p25,
  q.p50, q.p75, q.max]` where `q.min = sorted[0]`, `q.max = sorted[n-1]`. Correct.
- **cumprod wealth is correct and byte-identical** to the retired module
  (`c *= 1+p.value`).
- **Degenerate gate re-homed verbatim** — the `usableN = hasNonFinite ? 0 : count`
  semantics and the `length < MIN_USABLE || length < window` checks are
  character-for-character the retired logic; the composer's `usableN < window`
  gate and SegmentedControl disabling behave identically.
- **Consumer rewire is behavior-preserving** — the `89e982c0` diff is a pure
  identifier swap (`buildBlendPanels` → `deriveBlendPanels`) with identical args
  `(portfolioDaily, rollingWindow, blendBasis)` and identical memo deps.
- **`diversification.ts` change is comment-only** (doc-comment repoint), no logic.

No correctness, security, or data-loss defect found. The two warnings below are
claim-accuracy and tripwire-robustness issues; both info items are pre-existing
verbatim-preserved behaviors noted for awareness.

## Warnings

### WR-01: "byte-identical quantile box" parity claim is inaccurate — quantile & rolling-Sharpe paths carry incidental ULP-level drift beyond the documented sample→population change

**File:** `src/lib/scenario-blend-adapter.ts:23-24, 128-131, 139` (interacts with
`src/lib/factsheet/quantiles.ts:9-16` and `src/lib/factsheet/rolling.ts:99-113`)

**Issue:** The file header and the phase contract state the ONLY intended numeric
change is sample→population std, with the quantile box "byte-identical." In fact
two paths change floating-point *operation order* independent of the std change:

- **Quantile interior points (p25/p50/p75):** retired `percentile` used
  `sorted[lo] + (sorted[hi]-sorted[lo])*frac`; the backbone `quantileSummary.q`
  uses `sorted[lo]*(1-frac) + sorted[hi]*frac`. Algebraically equal, but not
  IEEE-754 bit-equal — up to ~1 ULP of drift. (min/max tails ARE exact, which is
  why the tests, which only `toBe()` min/max, still pass.)
- **Rolling Sharpe:** retired computed `(m*√N)/s_sample`; the backbone computes
  `(m*N)/(s_pop*√N)`. Beyond the sample→population change, the multiply/divide
  arrangement differs, adding ULP-level drift.

Impact is strictly sub-display-precision, so SC-4 pixel parity is NOT violated.
The defect is the *claim*: describing the quantile box as "byte-identical" (and
sample→population as the "ONLY numeric change") overstates exactness. In a
codebase with exact-equality parity gates elsewhere (Rule 12, fail-loud), that
wording risks a future engineer adding a `.toBe()` exact-equality assertion that
would flake.

**Fix:** Soften the header wording to match reality — e.g. state that quantile
tails are exactly preserved while interior quantiles and rolling Sharpe agree to
sub-ULP (display-identical), and that the intended *semantic* change is
sample→population std. No code change required.

### WR-02: delete-gate `stripComments` produces false positives and is trivially evadable by the same concat trick it relies on

**File:** `src/lib/scenario-backbone-gates.test.ts:46-51, 56-59, 68`

**Issue:** `stripComments` only drops lines whose *trimmed* text starts with
`//`, `*`, or `/*`. Two gaps:

1. **False positive (CI red on innocent code):** a trailing inline comment
   (`const x = 1; // scenario-blend-panels …`) or a block-comment body line that
   does not start with `*` (`/* note:\nscenario-blend-panels is gone */`) is NOT
   stripped, so a legitimate prose mention of the forbidden token would trip
   `code.includes(tok)` and fail the gate spuriously.
2. **Evadable:** because the matcher is a plain `.includes(contiguousToken)`, a
   reintroduced reference written with the identical concat trick this file uses
   (`"scenario-blend-" + "panels"`) would never contiguously match and would pass
   the gate — the exact obfuscation the gate itself employs at lines 56-59/100-101.

Neither breaks a genuine, unobfuscated regression detection (a restored
`import { buildBlendPanels } from "@/lib/scenario-blend-panels"` is caught), so
this is a robustness/hygiene issue, not a hole a normal regression slips through.

**Fix:** Strip comments with a tokenizer-aware pass (or at minimum also strip
trailing `//…` and detect `/* … */` spans across lines), and consider matching a
normalized (whitespace/`+`-collapsed) form of the source so a concat-split
reintroduction is still caught. Keep the existing on-disk `existsSync` checks
(SC-2 second test) — those are not concat-evadable and are the stronger guard.

## Info

### IN-01: histogram wealth series omits the 1.0 baseline point (verbatim-preserved)

**File:** `src/lib/scenario-blend-adapter.ts:121-125`

**Issue:** `histogramSeries[0]` is `1+r0`, not `1.0`; there is no leading
baseline point. `ReturnHistogram` re-derives daily returns internally as
`v/cumulative[i]-1`, so the first day's return `r0` has no predecessor and is
dropped from the histogram. This is copied character-for-character from the
retired module (intentional parity), so it is NOT a Phase-108 regression — noted
only so the behavior is on record. No change recommended under the pixel-parity
mandate.

### IN-02: `sharpe_365d` key labels a 252-basis series (frozen contract key, pre-existing)

**File:** `src/lib/scenario-blend-adapter.ts:47, 139`

**Issue:** The rolling-Sharpe record key is literally `sharpe_365d` while the
value is annualized on `periodsPerYear` (252 by default, or the crypto blend
basis). The `365d` suffix is a frozen `RollingMetrics` CHART_ACCENT contract
string, not an annualization basis, but the name is misleading to a reader. Both
the retired module and the chart component depend on this exact key, so changing
it is out of scope; documented for awareness.

---

_Reviewed: 2026-07-15T17:22:54Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

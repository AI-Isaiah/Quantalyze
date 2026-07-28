---
phase: 115-e2-allocator-equity-reconstruction
reviewed: 2026-07-17T19:49:29Z
depth: deep
files_reviewed: 4
files_reviewed_list:
  - analytics-service/services/allocator_equity_derive.py
  - analytics-service/scripts/e2_allocator_ground_truth.py
  - analytics-service/tests/e2_fixtures.py
  - analytics-service/tests/test_e2_parity_oracle.py
findings:
  critical: 0
  warning: 4
  info: 2
  total: 6
status: findings
---

# Phase 115: Code Review Report

**Reviewed:** 2026-07-17T19:49:29Z
**Depth:** deep (cross-file: metrics.py, portfolio_metrics.py, stitch_composite.py, external_flows.py)
**Files Reviewed:** 4 (plus 4 read for cross-reference)
**Status:** issues_found

## Summary

The core `allocator_equity_derive.py` money-math is careful and largely correct.
The backward `$`-replay identity, the NaN/`≤−100%`/non-positive-equity fail-loud
guards, the forward/backward self-check, the D3 all-or-nothing blend gate, the
seam disjoint-set + window-overlap belt-and-suspenders, and the honest-degradation
(`anchor=None`, unknown-seam) paths all trace cleanly. The parity oracle is
genuinely independent on its expected side (concern #6 clears — see IN-01 for the
one transitive gap). The seam logic does NOT spuriously emit or miss on
partial-overlap or gap days (concern #2 clears).

No production BLOCKER: this module is additive-only and not yet display-wired (the
Phase 115.1 worker derivation is the consumer), so nothing here can emit a wrong
number into production output today. However, four defects will produce wrong or
misleading numbers the moment 115.1 wires them, and one already degrades the
read-only ground-truth acceptance gate. The two most material are money-path
correctness issues: a **silent intersection-truncation** in the allocator curve
(WR-01) and a **day-0 return divergence from the canonical backbone** (WR-02).

## Warnings

### WR-01: `allocator_equity_curve` silently truncates to the intersection window with `degraded=False`

**File:** `analytics-service/services/allocator_equity_derive.py:515-544`
(consumed at `analytics-service/scripts/e2_allocator_ground_truth.py:189`)

**Issue:** The curve is summed only over `common_days = ∩ of each anchored key's
index`. When two *anchored* keys have DIFFERENT windows (e.g. different last-sync
days), the non-overlapping tails are dropped **with no flag** — `dropped_keys` is
empty, so `flags["degraded"]` is `False`. The caller cannot tell the curve was
truncated.

This is not academic for the ground-truth gate. `derive_terminal_equity` takes
`terminal = curve.equity.iloc[-1]` — the last *intersection* day, not each key's
anchor day. Concrete failing input: key-A anchored 120000 @ 2026-04-30, key-B
anchored 80000 @ 2026-04-20. `common_days` ends 2026-04-20, where A's equity is
the *rolled-back* level (< 120000), so `derived_terminal = A_rolledback + 80000`,
not `120000 + 80000 = 200000`. Reconciled against live equity (≈ sum of both
anchors) in `compute_anchor_consistency`, this yields a spurious multi-percent
drift → a **false FAIL** (or, symmetrically, a false PASS that green-washes a real
inconsistency). The only equity-curve test (`test_e2_equity_curve_layer.py:161`)
uses two keys with the *same* window, so this path is untested.

**Fix:** Emit an explicit truncation flag (and dropped tail-day counts) whenever
`common_days` is a strict subset of the union of anchored indices, and either
(a) refuse to derive a terminal from a truncated curve in the ground-truth harness,
or (b) sum each key at its own last day rather than at the intersection. Minimum:
```python
union = sorted({str(d) for s in anchored.values() for d in s.index})
truncated = len(common_days) < len(union)
# ... include "window_truncated": truncated, "n_tail_days_dropped": len(union) - len(common_days)
```

### WR-02: perf-curve / `$`-replay drop the day-0 return; the canonical backbone does not

**File:** `analytics-service/services/allocator_equity_derive.py:378-392` and `:442`

**Issue:** `perf_curve` normalizes to `perf_0 == 1.0` (dividing out `1 + r_0`), and
`replay_key_equity`'s backward loop `for t in range(n-1, 0, -1)` never applies
`r_{days[0]}` — so both curves compound only `r_1..r_{n-1}`. But the canonical
backbone `compute_all_metrics.cumulative_return = Π(1+r)−1 over ALL days INCLUDING
day 0` (metrics.py:1254, confirmed). A cumulative return read off the perf-curve /
normalized `$`-curve therefore disagrees with the backbone scalar by exactly the
factor `(1 + r_0)`. Concrete input: a 2-day series `[+0.10, +0.05]` → backbone
`cumret = 1.10·1.05 − 1 = 0.155`; perf-curve terminal `− 1 = 0.05`. For a module
whose stated purpose is "the match engine, the factsheet, and the live-baseline UI
converge on ONE derivation," a `$`-curve and a KPI panel that disagree by the first
day's return is a latent convergence break. The oracle's zero-flow pin (Oracle 3)
only proves perf-curve == normalized `$`-curve — both sides drop day-0 identically,
so it cannot catch this; only a perf-curve-vs-backbone pin would.

**Fix:** Pick one day-0 convention and document why. Either compound day-0 into the
perf/`$` curves (start `perf_{-1}=1`, level series gains a pre-day-0 base) to match
the backbone, or add an explicit assertion/note that curve total-growth is
deliberately `(1+r_0)×` smaller than the backbone `cumulative_return` and ensure no
115.1 consumer derives a headline return from the curve.

### WR-03: rotation seam threaded into MWR as an investor cashflow corrupts the IRR

**File:** `analytics-service/services/allocator_equity_derive.py:687-694`

**Issue:** `mwr_and_dietz_from_ledger` feeds EVERY ledger entry — including the
synthetic `LEDGER_SEAM` entry `next_eq − prev_eq` — into `compute_mwr` as an
investor cash flow (`amount = −usd_signed`). A rotation is the SAME capital
redeployed from one key to the next; it is not money entering/leaving the
investor's pocket. Worse, the seam magnitude is largely independent-anchor
reconciliation noise: in the fixture (`rotated_seam_pair`, anchors 50000→60000)
the seam is ≈ `+11151` purely because C and D were anchored to unrelated round
numbers — yet it is injected into the IRR as an `−11151` investor investment. The
oracle (`test_oracle_4`) only asserts `mwr` is *finite*, never *correct*, so this is
unpinned. Modified-Dietz inclusion is defensible (it removes the boundary jump from
the return numerator); MWR inclusion is not (a rotation is internal, not an investor
action).

**Fix:** Exclude `LEDGER_SEAM` entries from the MWR flow list (keep them in the
Dietz denominator only), or tag them so `compute_mwr` treats them as internal
transfers with zero investor sign:
```python
mwr_flows += [
    {"date": e.flow.utc_day_iso, "amount": -float(e.flow.usd_signed)}
    for e in ledger if e.provenance != LEDGER_SEAM
]
```
Add a pin asserting MWR is invariant to a pure (equal-capital) rotation seam.

### WR-04: block-to-block rotation seams always degrade to `known=False` despite a knowable magnitude

**File:** `analytics-service/services/allocator_equity_derive.py:607-610`, `:639-652`, `:243`

**Issue:** For a concurrent-block → concurrent-block rotation, `_key_label` sets
`seam.prev_key = "keyA+keyB"` (`:243`), but `_boundary_equity` does
`per_key_equity.get("keyA+keyB")` (`:645`), which is never a real key → returns
`None` → seam flagged `known=False` → all downstream scalars refuse. The magnitude
is actually knowable: it is the SUM of the block members' per-key equities at the
boundary day. The code over-degrades (honest, but strands a computable seam). Rare
per the docstring, but it means a multi-key allocator rotation can never produce a
Dietz/MWR scalar.

**Fix:** Resolve boundary equity for a block label by summing each member key's
level at the day, using `seam.prev_keys` / `seam.next_keys` (already carried on the
`Seam`) instead of the joined scalar label:
```python
def _boundary_equity_block(per_key_equity, keys, day):
    total = 0.0
    for k in keys:
        lvl = _boundary_equity(per_key_equity, k, day)
        if lvl is None:
            return None
        total += lvl
    return total
```

## Info

### IN-01: Oracle 4(c) is not fully independent on the seam magnitude

**File:** `analytics-service/tests/test_e2_parity_oracle.py:297-304`

**Issue:** `_inline_modified_dietz` re-derives the Dietz *formula* independently but
consumes the module-built `ledger` (so the seam magnitude on the expected side
comes from `build_allocator_ledger`, not an independent path). The magnitude itself
is separately pinned in 4(b) against `d_first − c_last`, so it is transitively
covered — but no single expected-side path validates "the seam magnitude flowing
into Dietz is independently correct." Concern #6 otherwise clears: Oracles 1/2/3/5
expected sides are provably module-free.

**Fix (optional):** Compute the inline Dietz seam term from `d_first − c_last`
(inline arithmetic) rather than reading `entry.flow.usd_signed` off the module
ledger.

### IN-02: `_flows_by_day` silently ignores a flow dated on the earliest union day

**File:** `analytics-service/services/allocator_equity_derive.py:442-452`

**Issue:** A flow on `days[0]` is never subtracted (the backward loop uses
`fbd.get(days[t])` for `t≥1` only), so it is folded into the base `equity[0]`. This
is *self-consistent* (the forward self-check absorbs it identically) and correct for
level reconstruction, but the HIGH-1 docstring ("a flow on a no-return day unions in
as a valid zero-return equity day, never an orphan", `:434`) overstates it: a
first-day flow has no distinguishable effect. Not a bug — a documentation
imprecision worth a one-line clarification so a future reader does not expect a
first-day deposit to move the reconstructed base.

---

_Reviewed: 2026-07-17T19:49:29Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

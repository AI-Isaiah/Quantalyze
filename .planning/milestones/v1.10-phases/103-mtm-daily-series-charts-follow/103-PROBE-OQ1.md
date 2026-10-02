# 103 — OQ1 Sparsity Probe: "interior-sparse or whole-or-degrade?"

**Probed:** 2026-07-12 (Wave 1, Task 1 — source trace, runs BEFORE the mask code)
**Question (RESEARCH Q3 / A1 / Open Q1):** Can the single-key `mtm_returns` /
composite stitched-MTM series carry **interior honest-absent days distinct from
cash**, or is MTM "whole-book reconstructs OR degrade the whole basis"?
**Method:** static source trace of what the compute *can produce* (the question is
capability, not a live crawl). NO new math — the probe only decides what the mask
may honestly CLAIM; the Task-2 mask code is sparsity-agnostic either way.

---

## VERDICT — single-key MTM

**Single-key MTM interior sparsity: POSSIBLE** (interior NaN guard days), and the
guarded days are **basis-dependent** (an MTM NaN day can differ from the cash pass).

### Evidence chain

1. `combine_native_ledger(pnl_basis=mark_to_market)` (`services/job_worker.py:2343-2361`)
   → `reconstruct_native_nav_and_twr` → returns the **raw** `chain_linked_twr`
   output (`services/native_nav.py:649-658`). Note `:657` merges only
   `cumulative_twr_segmented(returns)[1]` — the **flags**, NOT a suffix-truncated
   series. The returns series is returned **with its interior NaN days intact**
   (no `_last_interior_break_suffix` truncation at this layer).
2. `chain_linked_twr` seeds `returns = np.full(n, np.nan)` (`services/nav_twr.py:404`)
   and, for each guarded day, `continue`s **leaving that day NaN** — it NEVER
   substitutes a fabricated value (`:415-418`, `:428-430`). The guards:
   - `negative_nav_guard` — `prev_nav <= 0` (`nav_twr.py:461-462`)
   - `dust_nav_guard` — `0 < prev_nav < DUST_NAV_FLOOR` (`:463-464`)
   - `flow_dominated_guard` — `|flow| >= FLOW_DOM_RATIO * prev_nav` (`:465-466`)
   - `pnl_dominated_guard` — `|pnl_t| >= PNL_DOM_RATIO * prev` (`:428-430`)
   - pre-terminus NaN — `segmented[pre_terminus] = np.nan` (`:686`)
3. `combine_native_ledger` then calls `gap_fill_daily_returns` (`broker_dailies.py:169`),
   which **reindexes absent calendar days to 0.0 but preserves pre-existing NaN
   VALUES** (`broker_dailies.py:123-137`; the reindex `fill_value=0.0` only touches
   *newly introduced* index labels — a day already present with a NaN value keeps
   the NaN). So `mtm_returns` CAN carry **interior NaN days**.

### Basis-dependence

The guards at `nav_twr.py:415/:428` fire off the **NAV denominator** (`prev_nav`)
and the day's P&L numerator. In the MTM pass NAV is valued
**mark-to-market** (Σ balances × marks, includes unrealized —
`native_nav.py:640-646`, `pnl_basis=PNL_BASIS_MARK_TO_MARKET` at `job_worker.py:2347`),
whereas the cash pass values NAV on the settlement basis. Different `nav_vals` →
a day guarded (dust/negative/flow/pnl-dominated) in MTM **need not** be guarded in
cash and vice-versa. Therefore **MTM interior NaN days CAN DIFFER from cash's** —
MTM gaps ≠ cash gaps is real at the single-key level, not just span-level.

### Caveat (data-dependent, not guaranteed)

Interior sparsity in single-key MTM appears **only when a DQ-01 guard actually
fires** on the book. A clean book (no dust/negative/flow/pnl-dominated day, no
pre-terminus) produces a dense MTM series whose only coverage difference from cash
is its **span** (first/last marked day). So: interior marks are *possible and
honest when guards fire*; absent any firing guard the single-key MTM mask reduces
to **span-level** (a different date window than cash). This is honest under the
LOCKED no-new-math rule — the mask surfaces exactly the sparsity the compute
already produced, never manufactured interior holes.

---

## VERDICT — composite MTM

**Composite MTM interior sparsity: EXISTS BY CONSTRUCTION** — via two independent
sources, both already produced by the existing compute:

1. **Inter-member window gaps.** `stitch_clipped_series` (`stitch_composite.py:217-246`)
   `pd.concat`s the per-member clipped windows and `sort_index()`. When member
   windows are **non-contiguous**, the calendar days between them are simply
   **ABSENT from the stitched index**. They reach the scalar compute only via
   `gap_fill_daily_returns` 0.0-fill (`job_worker.py:4157-4158` inside
   `_metrics_result_for`) — i.e. the sparse stitched series itself carries the hole.
2. **Member-level interior NaN guard days survive.** Each member is a
   `reconstruct_native_nav_and_twr` output (same NaN-guard capability as single-key
   above); the concatenated stitched series carries those NaN values through.
   **Cited fixture:** `tests/test_stitch_composite_job.py:1745-1747` constructs
   `m1 = [("2024-01-01", 0.02), ("2024-01-02", nan), ("2024-01-03", 0.01)]` with the
   comment *"m1 has an interior guard day (Jan-02 = NaN) that survives gap_fill as a
   chain break"* (and `:2113` — *"the guarded ~17x/day day is NaN → honestly ABSENT,
   never written"*).

So the composite mask has **both** interior marks (member NaN days + inter-member
gaps) — the "full per-basis coverage mask" claim is fully honest for composites.

---

## Consequence for the mask claim (feeds Task 2 fixtures + Plans 02/04 SUMMARY)

| Path | Interior sparsity | Mask claim the SUMMARY may honestly make |
|------|-------------------|------------------------------------------|
| Single-key MTM | POSSIBLE (guard-dependent) + basis-distinct | Interior marks when a DQ-01 guard fires; **span-level otherwise**. NOT guaranteed on every book. |
| Composite MTM | EXISTS by construction (inter-member gaps + member NaN) | Full interior + span mask, always. |

- The user chose "full per-basis coverage mask" assuming interior gaps exist. That
  assumption **HOLDS unconditionally for composites** and **conditionally for
  single-key** (only where a guard fires). Wave 3 must caption single-key MTM
  coverage honestly: interior marks are shown *when present*, and the common case
  for a clean single-key book is a span-level difference from cash — never
  fabricated interior holes (LOCKED: no new math).
- **Task-2 fixture guidance:** keep the interior-NaN + leading/trailing-NaN fixture
  — it pins the helper's sparsity-agnostic semantics AND directly represents the
  composite member-NaN case and the single-key guard-fires case. The test docstring
  should note that the single-key path reaches interior NaN *only via a firing
  guard*, per this probe.

## Interaction with the shared helper's transform (Task 2)

Under `cumulative_method="simple"`, an interior NaN currently makes
`compute_all_metrics` raise a **bare ValueError** (arithmetic Σr cannot honour a
chain-break — `job_worker.py:4169-4173`, `test_stitch_composite_job.py:1733-1759`).
The Task-2 helper `_drop_nonfinite`s the series **before** `gap_fill_daily_returns`,
so interior NaN → **absent day → 0.0 on re-densify** and → a **gap_span** in the
mask. The helper therefore (a) sidesteps that simple-basis ValueError class by
construction, and (b) makes the persisted sparse rows the single truth the scalar
is a cache of. This is the deliberate NaN→(absent, then 0.0-on-recompute) semantic
the LOCKED principle intends — cited in the module docstring.

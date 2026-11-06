# Phase 188: TINYBASE - Research

**Researched:** 2026-11-03
**Domain:** Python analytics worker (per-key derive, marked-NAV apply, allocator compose) plus the TS readers that draw the stored result. No new dependency.
**Confidence:** HIGH on the code map and the PROD blast radius (read this session); MEDIUM on the recommended seam placement (a design, not yet built); two founder-visible consequences are flagged in Open Questions.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 — Book a fix phase.** "Book a fix phase", chosen over the recommendation "Accept as real (Recommended)". The returns are correct arithmetic on a tiny base. The founder does not want them read as performance.
- **D-02 — Leave out, show the day flagged.** Question: "Key C's +47% and -53% days are real moves on about 0.4% of the account left after a near-total withdrawal. How should a day measured against such a tiny base be treated?" Answer: "Leave out, show the day flagged (Recommended)": "The day's return is null: it is not chained into the equity curve and not counted in the stats (return, volatility, drawdown, Sharpe). The day still shows on the chart as a flagged gap with a short note that the account was nearly empty. Nothing is invented." — **Reversibility:** reversible.
- **D-03 — Threshold: under 5% of the 30-day peak.** Question: "What counts as a 'tiny base'?" Answer: "Under 5% of the 30-day peak (Recommended)": "A day whose starting NAV is under 5% of the account's highest NAV over the previous 30 days. Key C (about 0.4%) is caught. A key that stays small becomes its own new normal once the peak leaves the 30-day window, so its days count again from then on." — **Reversibility:** reversible.

### Claude's Discretion
- Where the rule lives: the per-key derive, the compose, or both. SC-2 requires that the derive and the reader both follow it on every venue.
- The flag's name, and whether an existing degrade or caveat line can carry the note (prefer reuse, as in 167.1.2.1.1 D-04 "no new copy"). Any new UI copy needs a DESIGN.md check.
- How a book with several keys weights an excluded key-day. The rule is per key's base; the planner must state what the book does on that day without inventing a return.

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs (null). The contract is SC-1..SC-5 of the `### Phase 188` ROADMAP entry.

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | The discuss step decides the treatment with the founder and records it | Done: D-02 and D-03 above. Research adds two consequences of D-02 the founder has not seen (Open Questions 1 and 2). |
| SC-2 | The derive and the reader follow the rule on every venue | Section "Consumer map and seams": the four `combine_*` writers all end in `nav_twr.chain_linked_twr` (one guard seam, realized era); `nav_marks_apply.apply_marks` is the marked-era seam on every venue; the compose already has a "key sits out the day" path (`dropped_days_by_key`) |
| SC-3 | Tests go RED on today's behaviour for key C's 2026-10-27/28 shape | Section "Validation Architecture"; the RED shape was reproduced this session (today's `apply_marks` emits `+0.4698`, `-0.5267`, `-0.1029` rows for that shape) |
| SC-4 | After deploy a PROD reading shows key C's two days handled and no other book changed except on named days | Section "SC-4 reading design" plus the pre-deploy blast radius measured this session |
| SC-5 | Never invent data: an uncomputable day is null | `csv_daily_returns.daily_return` is `NOT NULL`, so "null" is an ABSENT row; the P&L of the day is kept in `key_inputs` so levels stay exact |
</phase_requirements>

## Summary

The repo already has a complete "this day has no return" contract, and TINYBASE should ride it rather than add a parallel one. A guarded day (`dust_nav_guard`, `negative_nav_guard`, `pnl_dominated_guard`) is a NaN out of `chain_linked_twr`; NaN is never written to `csv_daily_returns` (the column is `NOT NULL`, the reconcile delete removes it); its actual P&L is stored in the key's `key_inputs` row as `dropped_day_pnl`; the compose gives the day a level from that P&L and the key "sits out that day's sums" in `portfolio_returns` (`undefined_return_days`, never `r = 0`). So the cleanest TINYBASE is a fourth member of that family: a relative guard (start NAV under 5% of the previous 30 calendar days' peak) evaluated at the two places a per-day return is created, plus one call-site union in the compose.

There are exactly two return-creating seams on the derive side, and both must change. Realized era (every day before a key's first stored mark, all venues): `chain_linked_twr`, reached by all four combiners (`combine_realized_and_funding` via `reconstruct_nav_and_twr`, `combine_native_ledger`, `combine_sfox_balance_history`, `combine_mt5_deal_ledger`). Marked era (from the first mark on, all venues): `apply_marks`, which replaces every realized row from its first mark day on, and which already has a "mark with no usable base has no return row" rule (`usable(base)` with `dust_floor`). Key C's two days are marked-era days, so a `chain_linked_twr`-only fix would leave SC-3 RED. The compose must also follow, because it is the reader that turns key dailies into the book curve and stats on every venue.

PROD measurement (read-only, 2026-11-03, 29 of 30 stored `key_inputs` rows replayed with the repo's own `replay_key_equity`): the rule would null 115 positive-base key-days over 7 key series in three episodes (a Deribit pair in 2025-09/10, an MT5 pair in 2025-11/12, and three Deribit keys from 2026-10-27 on, key C among them). Three of the seven stored books contain at least one such day; the book return moves by at most about 0.0006 on 2026-10-27/28 because the tiny key is a small share of each of those books, but one 2025-09-05 book day loses its whole return. No stored strategy series has a day over 30% on 2026-10-27..29, so no strategy factsheet carries key C's days today. No migration is needed.

**Primary recommendation:** Add one pure module `analytics-service/services/tiny_base.py` holding the single definition; apply it as a new `tiny_base_guard` in `nav_twr.chain_linked_twr` and as a new tiny-base outcome in `nav_marks_apply.apply_marks` (a NaN row that still carries its P&L), let the existing `dropped_day_pnl` payload and `dropped_days` path carry it through `key_inputs` into the compose, and surface it with the existing guard-reason line (`headline-basis.ts`) and an `UnpricedAccountNote`-style muted note. No `DegradeReason`, no migration, no new package.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Decide a day is tiny-base (the definition) | Worker, pure module (new `services/tiny_base.py`) | none | One definition used by every seam, so derive and reader cannot disagree. Unit-neutral (a ratio), so it holds for USD, BTC-native MT5 and every venue. |
| Null the day in a key's stored dailies | Worker, derive (`nav_twr.chain_linked_twr`, `nav_marks_apply.apply_marks`, `job_worker.run_derive_broker_dailies_job`) | DB (`csv_daily_returns`: row absent; `allocator_equity_derived` `key_inputs:<id>`: P&L kept) | The writer owns what is stored. `daily_return` is `NOT NULL`, so null means no row. |
| Keep the key's dollar level exact | Worker, derive (`dropped_day_pnl`, `writer_day_pnl`) | Worker, compose (`replay_key_equity`) | The day's P&L is real and already inside the NAV; only its percentage is withheld. |
| Book return and curve on that day | Worker, compose (`compose_allocator_equity`, `portfolio_returns`) | none | The compose is the only place key dailies become a book. The key sits out the day's sums. |
| Strategy / factsheet headline reason | SSR + client (`src/lib/factsheet/headline-basis.ts`, `composite-read-path.ts`) | Worker (`analytics_runner`, flag pre-stamp) | A guard flag already becomes a public sentence there. |
| "Account was nearly empty" note on the book | SSR reader (`queries.ts` `readMarksStart` family) | Client (`AllocationDashboardV2.tsx` note) | Same wiring as the 185 options caveat and the unpriced-account note. |
| Chart seam for the flagged day | Client (`TimeSeriesChart.tsx` gap seam) | Factsheet payload (`missingSegments`) | The seam exists; its label says "no data", which is wrong for this day (see Open Question 3). |

## Standard Stack

### Core
No new library. Everything is existing in-repo code. [VERIFIED: read this session] `analytics-service/services/nav_twr.py`, `nav_marks_apply.py`, `allocator_equity_derive.py`, `allocator_equity_compose.py`, `job_worker.py`, `analytics_runner.py`, `basis_series.py`; `src/lib/factsheet/headline-basis.ts`, `src/lib/queries.ts`, `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx`.

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| pytest | repo pin (202 tests passed in the three most relevant files this session) | Python tests, run only from `analytics-service/` | Every Python task |
| mypy | 2.0.0 locally; clean at baseline: `Success: no issues found in 131 source files` | CI strict gate | Every Python task |
| vitest | `npm test` is `vitest run` | TS tests | Only if a TS reader changes (`node_modules` is absent in this worktree; run `npm ci` first, unverified) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Fourth guard in the existing family (recommended) | A new `DegradeReason` token | A blocking token makes the curve untrustworthy and the reader maps every blocker onto a line the owner already sees (`untrustworthyRebuildReason`); a tiny-base day is a correct curve with a named gap, so a degrade token is the wrong class. A benign token would also need new TS mapping for nothing. |
| Fourth guard (recommended) | A nullable `daily_return` column | Needs a migration and every reader of `csv_daily_returns` to learn NULL. The absent-row convention already exists and every reader already handles it. |
| Pure helper over a level series | Recompute from `api_key_nav_marks` | The marks table only starts 2026-10-26 (first mark day measured on PROD) and holds 166 rows for 23 keys; it cannot give a 30-day peak for the realized era or for the first month of marks. |

**Installation:** none.

**Version verification:** not applicable (no package is added). `package-legitimacy` was not run because nothing is installed.

## Package Legitimacy Audit

No external package is installed or recommended by this phase.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 venue ledgers / marks
        │
        ├─ realized era (before first mark) ─► combine_* ─► nav_twr.chain_linked_twr ─┐
        │                                      (ccxt, deribit, sfox, mt5 all end here)│  NEW guard 4:
        │                                                                            │  tiny_base_guard (NaN + flag)
        └─ marked era (first mark onward) ──► nav_marks_apply.apply_marks ───────────┘  NEW outcome: NaN row,
                                                (replaces every realized row                P&L kept in writer_day_pnl
                                                 from its first mark day)
                                                         │
                                  run_derive_broker_dailies_job (job_worker.py)
                                                         │
          ┌──────────────────────────────┬───────────────┴──────────────────────────┐
          ▼                              ▼                                          ▼
  csv_daily_returns             allocator_equity_derived                  strategy_analytics prestamp
  tiny day ABSENT               kind='key_inputs:<id>'                    (guard flag set via
  (NOT NULL column;             dropped_day_pnl += tiny days' P&L        NAV_TWR_GUARD_KEYS carry)
   reconcile delete removes     composed_day_pnl (writer basis) keeps
   the stale row)               the marked P&L on the tiny day
          │                              │
          │                              ▼
          │          derive_allocator_equity ─► compose_allocator_equity
          │            replay_key_equity: level on the tiny day = P&L-driven (exact)
          │            dropped_days[k] ∪= days with P&L and no return row   (existing hunk)
          │            portfolio_returns: key k SITS OUT that day's numerator AND denominator
          │            day with no defined key ⇒ absent from payload.returns
          ▼                              ▼
  analytics_runner ─► derive_basis_series      allocator_equity_derived 'equity_curve' payload v2
   (gap_spans / headline_since)                {curve (dollars, unchanged), returns (day left out), flags}
          │                              │
          ▼                              ▼
  factsheet: headline reason line     My Allocation: muted note ("account nearly empty on N days")
  + chart seam label                  + book factsheet built from payload.returns
```

### Recommended Project Structure
```
analytics-service/
├── services/tiny_base.py            # NEW pure module: constants + tiny_base_days(); no I/O, stdlib only
├── services/nav_twr.py              # +1 guard in chain_linked_twr; +1 key at the END of NAV_TWR_GUARD_KEYS
├── services/nav_marks_apply.py      # tiny-base outcome beside usable(base); MarkedSeries gains one field
├── services/job_worker.py           # call-site hunks only (see Seams); no new function bodies of size
├── services/allocator_equity_compose.py   # one hunk: union tiny days into `dropped_days` before portfolio_returns
└── tests/test_tiny_base*.py         # NEW files; the shared oracle `Book` is extended, not copied
src/lib/factsheet/headline-basis.ts  # GUARD_FLAGS + GUARD_REASON_PHRASES + GuardReason (closed table)
src/lib/queries.ts                   # readMarksStart family: read the additive key_inputs field
```

### Consumer map and seams (Q1)

Every consumer of a key's or a strategy's daily-return series, and how a missing day already flows. [VERIFIED: read this session; symbols, not line numbers]

| # | Consumer | How it treats an absent / NaN day today | Needs a change? |
|---|----------|------------------------------------------|-----------------|
| C1 | `nav_twr.chain_linked_twr` (realized era) | A guarded day is `returns[t] = NaN`, `flags[guard_key] = True`, `continue`. Order: `_guard_denominator` (negative, dust), then `pnl_dominated_guard`. | YES: add the 4th guard here, before the `timed_return` branch so a timed day is judged on its start NAV (`prev`), not a cohort base. |
| C2 | `nav_marks_apply.apply_marks` (marked era) | `usable(base)` false (non-finite or `base <= dust_floor`) means "no return row, level still pinned, next mark chains from it". The day lands in `mark_gap_days` and `covered_days`. | YES: tiny base is a second reason a mark has no usable base, but it must NOT land in `covered_days` (covered means "inside the next return, draw nothing"; D-02 wants a flagged gap). |
| C3 | `job_worker.run_derive_broker_dailies_job` | Writes only non-NaN rows; `_reconcile_span_delete` deletes every span day not in the payload; `dropped_day_pnl_payload(returns, _day_pnl_usd)` stores P&L for NaN days; `writer_basis_payload` stores the writer's P&L per NAV day. | Call-site only. The marked-era tiny day must reach `dropped_day_pnl` (it has no NaN today because `apply_marks` omits rather than NaNs; see Pitfall 2). |
| C4 | `allocator_equity_compose.compose_allocator_equity` + `portfolio_returns` | `dropped_days` = days in `dropped_pnl[k]` with no return row; `portfolio_returns(dropped_days_by_key=...)` makes the key sit out both sums, counts `undefined_return_days`, raises benign `missing_return_inside_coverage`; a day where no key is defined is absent from `returns`. | One hunk: union the tiny days into the same `dropped_days` dict. `portfolio_returns` itself needs no edit. |
| C5 | `analytics_runner.run_csv_strategy_analytics` (strategy headline, factsheet scalars) | Broker-sourced series: in-span stored-row gaps BEFORE the derive's `marks_covered_from` boundary are reinstated as NaN (chain break, `twr_chain_broken`, `headline_since`). Rows ON or AFTER the boundary are used as stored, and every absent day there is a `covered_day` (no gap span, no break). | YES (marked era): the derive must pre-stamp the tiny days so the runner excludes them from `_covered_days`; otherwise they are silently "covered" and never flagged. |
| C6 | `basis_series.derive_basis_series` | Absent in-span days become `gap_spans`; `covered_days` are excluded from gap spans and from the scalar input. | No code change; it follows C5. |
| C7 | Composite stitch (`run_stitch_composite_job`), two `apply_marks` call sites | Calls `apply_marks` for members; stitches absent days as gaps. | Follows C2 automatically; add one regression arm. |
| C8 | TS `getMyAllocationDashboard` / `extractTrustworthyDerivedSeries` | Reads the stored v2 payload: `curve` (dollars) and `returns`. Nothing recomputes from keys. | No change for the numbers. Note + chart label need wiring (C10). |
| C9 | TS `liveBaselineMetricsFromPerKeyDailies` (`queries.ts`) | Reads per-key `csv_daily_returns`; the scenario engine 0-fills a key's absent day at constant weight (documented in `allocator_equity_derive.py` module docstring, "PARTIALLY-MISSING DAYS"). | No change in this phase. Pre-existing behaviour for every guard day; recorded so the planner does not read it as a TINYBASE regression. |
| C10 | Presentation: `headline-basis.ts` (`GUARD_FLAGS`, `GUARD_REASON_PHRASES`), `TimeSeriesChart.tsx` (gap seam), `AllocationDashboardV2.tsx` (`UnpricedAccountNote`) | See "Existing null-day conventions" below. | YES, small: see Open Question 3 for reuse vs new copy. |

**Existing null-day conventions to reuse (Q1).** [VERIFIED: read this session]
- Derive: NaN day, never stored, `dropped_day_pnl` kept, flag from `NAV_TWR_GUARD_KEYS`. The tuple verbatim: `"dust_nav_guard", "negative_nav_guard", "pnl_dominated_guard", "flow_coverage_incomplete", "unrealized_pnl_in_anchor", "unrealized_pnl_unreadable", "twr_chain_broken", "pre_summary_rollout_option_dailies", "pre_mark_retention_option_dailies"`. Its comment: "adding a guard is a one-line edit that propagates by construction" (`transforms._merge_status_meta`, `analytics_runner` lift lists and `job_worker` pre-stamp iterate it). Append the new key at the END.
- Compose: `PortfolioReturns.undefined_return_days` and the benign flag token `missing_return_inside_coverage` (no TS reader; it is a writer-side token only).
- Public sentence for a guard: `headline-basis.ts` closed table, verbatim: `["negative_nav_guard", "negative_nav"], ["dust_nav_guard", "dust_nav"], ["pnl_dominated_guard", "pnl_dominated"]` and phrases `negative_nav: "a zero or negative account balance"`, `dust_nav: "a near-zero account balance"`, `pnl_dominated: "a one-day gain or loss larger than the balance"`. `dust_nav`'s phrase already says what D-02 asks for ("the account was nearly empty"), which is the "no new copy" route for the headline line.
- Book note pattern: `UnpricedAccountNote` (muted `<p role="status">`, `text-sm text-text-secondary`), fed by additive compose-payload fields (`unpriced_native_keys`, `no_capital_exited_keys`) or by `key_inputs` fields read in `readMarksStart` (the 185 `options_cash_basis` caveat travels `key_inputs` -> `readMarksStart` -> `optionsCashBasis` -> `buildAllocatorPortfolioFactsheetPayload` -> `dataQuality.optionsCashBasis`).
- Chart seam: `TimeSeriesChart.tsx` draws one hatched sliver per `payload.missingSegments` entry labelled `{days}d — no data` (zero width at the first present index after the gap).

### The rule, stated once (Q2)

- **Starting NAV of day t** = the end-of-day NAV of day t-1, i.e. the base the day's return is divided by: `prev` in `chain_linked_twr`; in `apply_marks` the `base` (`level_prev` plus the gap days' flows). It is NOT a cohort base on a timed day: D-03 says "starting NAV". [ASSUMED: reading of D-03; a timed day whose start NAV is normal but whose first cohort is tiny is therefore still measured. Flag for the plan-check.]
- **Stored data it comes from.** Realized era: the `nav` Series inside `chain_linked_twr`. Its index is SPARSE (union of P&L days and flow days; `broker_dailies` documents "A day with neither a deal nor a flow is simply ABSENT"), so the 30-day window must be taken in calendar days with carry-forward of the last known level, including the level in force at the window start. Marked era: the pinned mark levels (`api_key_nav_marks.nav_usd`, `UNIQUE (api_key_id, mark_day)`, first mark day 2026-10-26 on PROD) plus the pre-first-mark levels, which `apply_marks` does not hold (see Open Question 4). Compose: the replayed per-key level Series (`KeyEquity.equity`), equal to the stored marks on marked days by the NAVMTM pin (`test_compose_roll_reproduces_every_marked_level`).
- **Peak** = max end-of-day level over the previous 30 calendar days `[t-30, t-1]` (inclusive both ends, exactly 30 days). It always includes day t-1, so a key's ratio is at most 1 and a key whose own history is shorter than 30 days compares against what exists (a key's first return day has ratio 1 and is never tiny).
- **Tiny** = `0 < base < 0.05 x peak`. `base <= 0` stays with `negative_nav_guard` / the compose "emptied" machinery (`EMPTIED_FRACTION = 0.01`, `EMPTIED_RESTART_FLOOR_USD = 100.0`, `_emptied_ceiling`) and is outside this rule (Open Question 2). `base` below the unit's dust floor is already `dust_nav_guard`, so the new rule only decides bases between the dust floor and 5% of the peak.
- **Roll-off (D-03).** Key C's peak day is 2026-10-25 (end of the day before the withdrawal day). `t - 30 <= 2026-10-25` holds through 2026-11-24, so key C's days 2026-10-27 .. 2026-11-24 are nulled and 2026-11-25 counts again. The day of the withdrawal itself (2026-10-26) has a normal start NAV and is not tiny (and has no mark base anyway).

### Book arithmetic for an excluded key-day (Q3, planner decision)

| Option | Arithmetic | Verdict |
|--------|-----------|---------|
| A. Key sits out the day (recommended) | `r_t = sum_{k defined} E_k,t-1 r_k,t / sum_{k defined} E_k,t-1`; a day with no defined key is absent from `returns` | Exactly the existing `undefined_return_days` behaviour for a dropped day. Nothing invented. The dollar curve still moves by the excluded key's real P&L, so on that day `curve_t = curve_{t-1}(1+r_t)+F_t` is off by the excluded key's contribution, bounded by `0.05 x peak_k x |r_k|`. The existing test `test_the_returns_chained_with_the_flows_reproduce_the_curve_on_every_returned_day` pins the identity only for fully-defined days, so a tiny-base arm must state the bounded gap, not assert the identity. |
| B. Excluded key counts as `r = 0` at its weight | `numer += 0`, `denom += E` | REJECTED: invents a flat day (SC-5, and `portfolio_returns` already says "It is never read as r = 0"). |
| C. Null the whole book day when any key is tiny | day absent | REJECTED: discards the other keys' valid return for a key that is a few percent of the book. |
| D. Book the key's capital as leaving and re-entering (a flow) | needs ledger seams | REJECTED here: that is the 186 DERIVEGAPS D-07 mechanism for failing keys; reusing it couples the two phases. |

**Single-key book** (7 stored books on PROD, several flagged `sole_key`): the day has no defined key, so it is absent from `payload.returns` while the dollar `curve` still has the day. That absence is the chart's "flagged gap".

### Pattern: the pure definition (proposal, not yet code)

```python
# Source: proposal for analytics-service/services/tiny_base.py (pure, stdlib only).
from __future__ import annotations
from bisect import bisect_right
from collections.abc import Iterable, Mapping
from datetime import date, timedelta
from typing import Final

TINY_BASE_FRACTION: Final[float] = 0.05      # D-03
TINY_BASE_WINDOW_DAYS: Final[int] = 30       # D-03: the previous 30 calendar days, [t-30, t-1]


def tiny_base_days(levels: Mapping[str, float], days: Iterable[str]) -> frozenset[str]:
    """ISO days in ``days`` whose start NAV is positive and under TINY_BASE_FRACTION of the
    highest end-of-day level over the previous TINY_BASE_WINDOW_DAYS calendar days.
    ``levels`` is {ISO day: end-of-day NAV}; a day with no entry carries the last known level
    (a sparse NAV index), INCLUDING the level in force at the window's first day."""
    known = sorted(levels)
    values = [levels[d] for d in known]
    out: set[str] = set()
    for day in days:
        d = date.fromisoformat(day)
        prev, start = (d - timedelta(days=1)).isoformat(), (d - timedelta(days=TINY_BASE_WINDOW_DAYS)).isoformat()
        hi = bisect_right(known, prev)
        if hi == 0:
            continue                       # no prior level: nothing to measure against
        base = values[hi - 1]
        lo = bisect_right(known, start) - 1  # the level in force at the window start counts
        peak = max(values[max(lo, 0):hi])
        if base > 0.0 and peak > 0.0 and base < TINY_BASE_FRACTION * peak:
            out.add(day)
    return frozenset(out)
```

A non-finite level must raise (same discipline as `_nonfinite_count` / `MarkApplyRefusal`), and the message must carry counts or day indices only (T-115-05, T-73-02: no USD magnitude in a log or an exception).

### Anti-Patterns to Avoid
- **A `DegradeReason` for this.** `_BLOCKING_REASONS` is read by the reader, the refusal rows and `tests/fixtures/derive_refusal_rows.json`; 186 D-07 is rewriting that area. A tiny-base day is a correct curve with a named gap.
- **Computing the rule in the compose only.** It would satisfy the book and leave stored dailies, strategy factsheets and the composite stitch measuring the day (SC-2 fails).
- **Computing the rule in the derive only.** The compose would still weight a key's stored row if a stale row survives a derive race; the compose union also makes old stored rows correct before the next derive.
- **Putting the tiny days in `covered_days` / `mark_gap_days`.** Covered means "inside the next mark's single return, draw nothing". The tiny day must stay a flagged gap.
- **Reading the marks table for the window.** It starts 2026-10-26 and cannot serve the realized era or the first month of any key's marks.
- **Restating a number from this file in code or prose.** The repo's own rule: read constants by symbol. Here `TINY_BASE_FRACTION` and `TINY_BASE_WINDOW_DAYS` are the only home of 0.05 and 30.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| "This key-day has no return but a level" | A new field or table | `dropped_day_pnl_payload` / `read_dropped_day_pnl` / `_dropped_pnl_by_day` and the compose `dropped_days` dict | Contract with hardening, flags (`dropped_day_pnl_days`, `dropped_day_pnl_ignored_days`) and tests already exists |
| Book return when a key has no return that day | A second weighting path | `portfolio_returns(dropped_days_by_key=...)` | Already sits the key out of numerator and denominator and counts it |
| A key's level series | A second backward roll in the derive | `replay_key_equity` (compose) and the `nav` / writer-basis levels the derive already holds | "NEVER re-derives ... every number comes from `allocator_equity_derive`" (compose module docstring) |
| Public sentence for a guard | New reason plumbing | `headline-basis.ts` `GUARD_FLAGS` + `GUARD_REASON_PHRASES` (a new reason with no phrase is a compile error by `satisfies Record<GuardReason, string>`) | One table, one join rule |
| "Left out of the book" note | A new banner component | The `UnpricedAccountNote` pattern and `readMarksStart` | Same defensive parsing of worker-written JSONB |
| Removing the stale stored row | A bespoke delete | `_reconcile_span_delete` / `_calendar_days_absent_from` | Deletes every span day the payload does not carry, upsert first |
| An "all-time" emptied rule | Extending `EMPTIED_FRACTION` | Leave it; the new rule is relative to 30 days and applies to positive bases | `EMPTIED_FRACTION` is "the founder's number: do not loosen it ... without a founder decision" |

**Key insight:** every piece of TINYBASE except the 5%/30-day predicate already exists. The risk is wiring it at the right two derive seams and not creating a second null-day convention.

## Runtime State Inventory

TINYBASE changes how new derives write; it is not a rename. The same question still applies to stored state.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `csv_daily_returns` rows for the tiny key-days (115 positive-base key-days over 7 key series on PROD today, including key C's 2026-10-27/28/29 rows). `allocator_equity_derived` `key_inputs:<id>` rows (30 on PROD) and the 7 `equity_curve` rows. | Code edit only. The next derive upserts the new set and `_reconcile_span_delete` deletes the stale rows; the next compose rewrites `equity_curve`. No data migration. |
| Live service config | The nightly `derive-allocator-key-dailies` job (schedule `40 0 * * *`, from the 185 SC-4 reading). | None. It re-derives every key, which is how SC-4 gets its post-deploy reading. |
| OS-registered state | None. | None. |
| Secrets / env vars | None. | None. |
| Build artifacts | None (pure Python, no egg-info in play). | None. |

## Common Pitfalls

### Pitfall 1: Fixing only `chain_linked_twr`
**What goes wrong:** key C's days stay. **Why:** from a key's first mark day `apply_marks` replaces every realized row ("every realized input day on or after S is absent"), and key C's first mark day is 2026-10-26. **How to avoid:** SC-3's RED fixture must be a marked-era fixture. **Warning sign:** a green `chain_linked_twr` guard test beside a red key-C fixture.

### Pitfall 2: The marked-era omission is invisible to the dropped-day contract
**What goes wrong:** `dropped_day_pnl_payload(returns, day_pnl)` only looks at NaN days in `returns`; `apply_marks` omits a no-base mark day instead of emitting NaN, and its `writer_day_pnl` only gets `0.0` for a no-row day that carries a flow. So an omitted tiny day would have no stored P&L, the compose would read it as a coverage gap at `r = 0` (`missing_return_days`, the thing D-05/"next mark covers it" intends for unmarked days), and the replay level would be off by the day's P&L. **How to avoid:** make the tiny-base outcome emit an explicit NaN row AND `writer_day_pnl[md] = nav - base - flows[md]`, and pass those P&L values into the `dropped_day_pnl` payload (the job currently passes `_day_pnl_usd`, the realized P&L). Keep the NAVMTM pin: `replay_key_equity` must still reproduce every marked level (`test_nav_marks_apply.py`, `test_nav_marks_compose_roundtrip.py`).

### Pitfall 3: The runner silently "covers" the tiny day
**What goes wrong:** `analytics_runner` computes `_covered_days` as every absent day of the loaded span on or after the boundary. A tiny day is absent, so it is covered: no gap span, no flag, which is exactly "not flagged". **How to avoid:** the derive pre-stamps the tiny days (a `data_quality_flags` field, same transport as `marks_covered_from`), and the runner subtracts them from `_covered_days`.

### Pitfall 4: Break versus skip (see Open Question 1)
A NaN before the marks boundary is a chain break: `cumulative_twr_segmented` compounds only the suffix after the LAST break and `compute_all_metrics` reads one `headline` suffix for return, CAGR, volatility, Sharpe, drawdown. After the boundary the absent day is only skipped. The same rule therefore changes a strategy headline differently by era.

### Pitfall 5: The peak never decays in the compose, but the window must
`replay_key_equity`'s emptied logic uses an all-time prior peak; copying that shape would make a key that shrinks and stays small tiny forever. D-03 says the window rolls (roll-off date above).

### Pitfall 6: Sparse NAV index and the window
A `nav` index missing the window's first day must carry the previous level into the max, else a peak that fell just before the window start is lost (a false "not tiny"), or a spike inside it is double counted.

### Pitfall 7: Stale row versus fresh `key_inputs` (race)
The upsert-then-delete order means a compose between the two writes sees a `dropped_day_pnl` day that still has a stored return, which `_dropped_pnl_by_day` ignores and counts, and the key degrades `KEY_INPUTS_MISMATCH` (blocking) until the delete lands. This is the existing M2 race, not new, but the first post-deploy derive for key C will exercise it; the SC-4 reading must wait for the derive's compose job to finish (as 185 plan 10 did).

### Pitfall 8: Version / CHANGELOG collisions with 186
Both phases ship `VERSION`, `package.json`, `CHANGELOG.md`. Whichever merges second re-picks its digit from `origin/main`.

## Code Examples

### Where the guard sits in `chain_linked_twr` (symbols, verbatim fragments)
```python
        guard_key = _guard_denominator(prev, floors.dust_nav)
        if guard_key is not None:
            flags[guard_key] = True
            continue  # break the chain-link for this day; NEVER substitute
        ...
        pnl_t = cur - prev - flow_t
        if abs(pnl_t) >= PNL_DOM_RATIO * prev:
            flags["pnl_dominated_guard"] = True
            continue
```
(Source: `analytics-service/services/nav_twr.py`, read this session.) The tiny check is a third `continue` after the P&L-dominated one on the day-level path, and a guard before `_timed_day_return` on the timed path.

### Marked-era shape that is RED today (reproduced this session)
```python
# synthetic: 16 realized days at +0.1%, a withdrawal on the first mark day that leaves 0.41% of the
# account, then marks that multiply the residue by 1.4698, 0.4733, 0.8971.
out = apply_marks(real, flows, marks, day_pnl=..., dust_floor=0.0, writer_terminal=("2026-10-25", L))
# today:  {'2026-10-27': 0.4698, '2026-10-28': -0.5267, '2026-10-29': -0.1029} are emitted as rows.
# wanted: those three days are NaN rows (tiny base), writer_day_pnl keeps nav - base - flow for them.
```

### Exact-arithmetic oracle (extend, do not copy): `tests/test_allocator_equity_dropped_day_pnl.py`
`Book` builds a ledger forward in `fractions.Fraction`; `is_dropped` restates the writer's guard rule as literals (`prev <= 0`, `prev < _DUST`, `abs(p) >= _PNL_DOM * prev`) and `test_the_oracle_book_is_what_the_real_writer_produces` pins that restatement against the real `chain_linked_twr`. Add the 5%/30-day literals to `is_dropped` (restated, never imported from `tiny_base.py`), keep the pin test green, and add a fixture shaped like key C: funding day, about 29 ordinary days, a withdrawal day leaving 0.4% of the NAV (still above the 100 dust floor, so it is a measured day today), then P&L equal to +47% of the residue, then -53% of the new residue, then -10%. With a 100000 NAV the residue is 400 and the three P&L are 188, -310, -29 (synthetic).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Absolute dust floor (`DUST_NAV_FLOOR`, $100 for USD) | Relative to the key's own recent peak (this phase) | 2026-11 (D-03) | Unit-neutral, so a BTC-native MT5 key needs no per-unit floor |
| A flow-dominated guard dropped the day | Retired (164.6.6.2.3 D-05): "a flow, however large, never drops a day" | 2026-10 | TINYBASE is judged on the start NAV, not on flow size; the 2026-10-26 withdrawal day stays measured |

**Deprecated/outdated:** `flow_dominated_guard` (carry-only in `NAV_TWR_LEGACY_GUARD_KEYS`); do not reuse it as a model.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | "Starting NAV" in D-03 means the previous end-of-day NAV (the day's base), not a cohort base on a timed day | The rule | A timed day with a normal start NAV and a tiny cohort stays measured; low risk |
| A2 | The 30-day window is exactly the 30 calendar days before the day, inclusive of day t-1 | The rule | Off-by-one moves roll-off by one day (key C: 2026-11-24 vs 2026-11-25) |
| A3 | The new rule does not apply to `base <= 0` (emptied / negative) days | The rule, Open Question 2 | If it should, 233 more flat key-days change |
| A4 | The compose recomputing from replayed levels equals the derive's levels on marked days | Seams | Pinned for writer-basis keys by `test_compose_roll_reproduces_every_marked_level`; unverified for ccxt keys with marks (wallet-based) |
| A5 | PROD blast radius (115 key-days) approximates the true post-deploy set | PROD reading | It replays stored inputs rather than the compose itself; the SC-4 reading must be taken from the real run |
| A6 | Composite stitch (`apply_marks` at two more call sites) needs only a regression arm | C7 | A composite whose member has a tiny day could need a gap-span test |
| A7 | No existing UI string covers "chart seam for a tiny-base day" | Open Question 3 | Possibly new copy (DESIGN.md check) |

## Open Questions

1. **Null means "chain break" on the old rows, "skip" on the new ones. Does the founder want that?** (RESOLVED: D-04)
   - What we know: D-02 says "not chained ... not counted in the stats". Every existing null-return day in this repo is a chain break: `cumulative_twr_segmented` compounds only the suffix after the LAST break, `compute_all_metrics` computes one `headline` (return, CAGR, volatility, Sharpe, drawdown) on that suffix, and the factsheet states "since `headline_since`". After a key's first mark day (`marks_covered_from`) the runner uses rows as stored, so an absent day is skipped and history before it stays in the headline.
   - What's unclear: whether the founder meant "skip the day, keep the history" (what the marked era gives) or the existing break semantic for pre-marks rows (a strategy on key C-like history would show a headline "since" the last tiny day).
   - Recommendation: follow the guard family (break for pre-marks rows, skip for marked rows) and put the consequence in front of the founder before the plan locks. The PROD effect today is limited to historical episodes on keys that have strategies; no stored strategy carries key C's days. Planner decision, flag as a confirmation checkpoint.
   - Disposition: D-04 (founder 2026-11-03, "Split by era"), the recommendation: before a key's first daily mark a left-out day breaks the chain; from the first mark on it is skipped (188-02, 188-05, 188-07).

2. **Does the rule cover days whose start NAV is zero (emptied stretches)?** (RESOLVED: D-05)
   - What we know: 233 key-days on 7 keys have base 0 under the replay, all with stored `r` of 0.0 (0 days with |r| >= 20%); the compose already gives them zero weight, but the strategy stats count them as flat days.
   - Recommendation: no. Restrict the new rule to `0 < base`, leave emptied days to the existing machinery, and say so in the plan; otherwise SC-4 "no other book changed except on named days" would name 233 flat days nobody asked about. Planner decision.
   - Disposition: D-05 (founder 2026-11-03, "No, leave them as today"), the recommendation: `0 < base` (188-01).

3. **What does the chart flag say?** (RESOLVED: D-06)
   - What we know: the gap seam label is hard-coded `{days}d — no data` and `missingSegments[].kind` is the literal `"gap"`; "no data" is false for a tiny-base day. For the headline line the `dust_nav` phrase "a near-zero account balance" already fits and is reusable.
   - Recommendation: add a second `kind` value to the seam type and a label such as "account nearly empty" (new copy, DESIGN.md check: muted token, 12px caption tier, no new colour, one line), and reuse the `dust_nav` phrase for the headline. If the founder wants strictly no new copy, the seam keeps "no data" and the book note carries the sentence. Planner decision.
   - Disposition: D-06 (founder 2026-11-03, "Note only"): no new seam kind or label; a short muted note under the chart, the chart line unchanged, composites keep their "no data" marker; it narrows D-02's "flagged gap" (188-07, 188-08).

4. **Where does `apply_marks` get the pre-first-mark levels for the 30-day peak?** (RESOLVED)
   - What we know: `apply_marks` holds the marks and, for the writer chain, `base0 = L(S-1)`; key C's peak is that day. Writer-chain callers (Deribit, MT5) can roll earlier levels from `day_pnl`, `flows` and `writer_terminal` (`_writer_level_before` generalised). Wallet-based callers (OKX, Bybit, Binance, sFOX) have only `base0`.
   - Recommendation: an optional `prior_levels` keyword on `apply_marks` (default None = peak from `base0` and marks only), filled by the writer-chain callers. Document the wallet-venue limitation (a pre-S peak above `L(S-1)` within 30 days is missed).
   - Disposition: decided as T-OQ4 (188-01-PLAN.md "Design decisions"), implemented by 188-03-PLAN.md Task 2 (`_pre_start_levels`, rolled inside `apply_marks` from the S-1 level for writer-chain and wallet callers alike, no call-site change); the remaining wallet limit is KL-3 in 188-03-PLAN.md.

5. **Does the derive need `tiny_base_days` stored beside `dropped_day_pnl`, or does the compose recompute?** (RESOLVED)
   - Recommendation: the compose unions `days with dropped P&L and no return row` (already there) with `tiny_base_days(replayed levels)` as a belt for stale rows; the derive stores `dropped_day_pnl` (primary) and pre-stamps the days for the runner (C5). Both use the one helper.
   - Disposition: decided as T-OQ5 (188-01-PLAN.md "Design decisions"): the compose does not recompute; the derive decides in the key's own unit and stores `dropped_day_pnl` and `tiny_base_days`, and the compose follows through existing code (188-01, 188-05).

6. **Do the live-book scenario readers (row C9, KL-1 in the first plan draft) change in this phase?** (RESOLVED: D-07)
   - Disposition: D-07 (founder 2026-11-03, "Fix them in 188"): every live-book scenario reader sits a key out of its tiny-base days, implemented by 188-09-PLAN.md and 188-10-PLAN.md. Row C9's "No change in this phase" is superseded by it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| python3 | pytest, mypy, scratch analysis | yes | 3.14.3 | none needed |
| pandas | service imports | yes | 3.0.1 | none |
| pytest | Python tests | yes | 202 passed in 5.78 s on the three closest files | none |
| mypy | CI gate | yes | 2.0.0 (repo pin in `requirements-dev.txt`) | none |
| Supabase CLI (PROD reads) | SC-4 reading | yes | 2.84.2 | none; marker query first |
| node_modules (vitest, tsc) | TS tests | no, absent in this worktree | none | `npm ci` before any TS task (unverified) |
| ruff | none in CI | `ruff` binary exists; CI has no ruff step (`grep ruff .github/workflows/ci.yml` found nothing) | n/a | not a gate |

**Missing dependencies with no fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (+ pytest-asyncio auto mode, xdist in CI) for Python; vitest for TS |
| Config file | `analytics-service/pytest.ini` (`pythonpath = .`); `vitest.config.ts` |
| Quick run command | `cd analytics-service && python3 -m pytest tests/test_tiny_base.py tests/test_allocator_equity_dropped_day_pnl.py tests/test_allocator_equity_dropped_day_returns.py tests/test_nav_marks_apply.py tests/test_nav_twr.py -q` |
| Full suite command | `cd analytics-service && pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` (verbatim from `.github/workflows/ci.yml`) |

### CI gates the plans must satisfy
- mypy (run from `analytics-service/`, verbatim): `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (baseline clean this session). A new `services/tiny_base.py` is inside the pinned surface automatically (`services/`).
- Coverage floor: `--cov-fail-under=80` on the `python` job.
- TS: `npm test` (`vitest run`), `npm run typecheck` (`tsc --noEmit`), `npm run lint` (includes `scripts/check-planning-hygiene.ts`).
- Always `grep -a`; pytest only from `analytics-service/`; never `importlib.reload` in tests.

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SC-2 | Definition: boundary at exactly 5%, window roll-off on day 31, fewer than 30 days of history never tiny, sparse index carry-in, `base <= 0` not tiny, non-finite level raises | unit | `pytest tests/test_tiny_base.py -q` | no, Wave 0 |
| SC-2 | `chain_linked_twr` nulls a tiny day, raises `tiny_base_guard`, and the oracle `Book` (extended with the literals) equals the real writer | unit | `pytest tests/test_allocator_equity_dropped_day_pnl.py -q` | extend existing |
| SC-2 / SC-3 | `apply_marks` on key C's shape: the three days are NaN rows, `writer_day_pnl` keeps their P&L, not in `covered_days`, `replay_key_equity` still reproduces every marked level | unit | `pytest tests/test_nav_marks_apply.py -q` | extend existing |
| SC-2 / SC-3 | Compose: two-key book and sole-key book. Two-key: tiny key sits out both sums, curve unchanged, `missing_return_inside_coverage` raised, `is_trustworthy` stays True. Sole-key: the day is absent from `returns`, present in `curve` | unit | `pytest tests/test_allocator_equity_dropped_day_returns.py -q` | extend existing |
| SC-2 | Every venue: ccxt, deribit, sfox, mt5 fixtures through their `combine_*` reach the guard (parametrized) | unit | `pytest tests/test_tiny_base_venues.py -q` | no, Wave 0 |
| SC-2 | Runner: the pre-stamped tiny day is a `gap_span`, not a `covered_day`; pre-boundary tiny day is a chain break with `headline_since` | unit | `pytest tests/test_csv_analytics_runner.py -k tiny -q` | extend existing |
| SC-3 | Neuter-and-restore: revert the helper to `return frozenset()`, see the new tests RED, restore from a byte backup (never `git checkout`) | gate integrity | manual step in the plan, recorded in the SUMMARY | n/a |
| SC-5 | No invented value: the day is absent / NaN, never 0.0; `csv_daily_returns` writer never receives it | unit | in `tests/test_tiny_base_venues.py` | no, Wave 0 |
| SC-2 (TS) | `GUARD_FLAGS` row + phrase compiles (`satisfies`), `readHeadlineBasis` returns the reason; key_inputs read parses the additive field defensively; note renders | unit | `npx vitest run src/lib/factsheet/headline-basis.test.ts src/lib/queries.test.ts` | extend existing |
| SC-4 | Post-deploy PROD reading | manual (read-only) | see "SC-4 reading design" | n/a |

### Sampling Rate
- **Per task commit:** the quick run above (about 6 s for the three existing files).
- **Per wave merge:** full pytest + mypy line; vitest for touched TS files.
- **Phase gate:** full suite green and the SC-4 reading recorded before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_tiny_base.py` - definition (SC-2)
- [ ] `analytics-service/tests/test_tiny_base_venues.py` - every-venue and SC-5 arms
- [ ] Extend `Book.is_dropped` in `tests/test_allocator_equity_dropped_day_pnl.py` and keep `test_the_oracle_book_is_what_the_real_writer_produces` green
- [ ] A key-C-shaped fixture (shared by the apply, compose and runner tests)
- [ ] `npm ci` if any TS task is planned

## Security Domain

`security_enforcement` is absent from `.planning/config.json`, so it is treated as enabled.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | none touched |
| V3 Session Management | no | none touched |
| V4 Access Control | yes, narrowly | The new `key_inputs` field is read through the owner's RLS client with the allocator filter written out (the `readMarksStart` rule); never the service-role client in the SSR reader |
| V5 Input Validation | yes | Worker-written JSONB is untrusted at the reader: strict ISO-day parse, ids the owner holds only, fail-open for a disclosure (a missing note is recoverable, a false one is not) per the existing `readUnpricedNativeAccounts` / `isOptionsCashBasis` rules |
| V6 Cryptography | no | none |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Magnitudes leaking into logs / exceptions | Information disclosure | Counts and day indices only (T-115-05, T-73-02); the helper raises with static text |
| Non-finite level poisoning a JSONB upsert | Tampering / DoS (retry loop) | Refuse before persisting, as `dropped_day_pnl_payload` and `writer_basis_payload` do |
| Public-repo leakage in tracked text | Information disclosure | Key letters only; no ids, no amounts, no home paths in `.planning/` (this file follows it) |
| PROD write during the SC-4 reading | Tampering | SELECT only, marker query first and alone, through the documented read procedure |

## SC-4 reading design

**Order matters: capture the baseline BEFORE the deploy.** Two pre-deploy snapshots (read-only SELECTs, saved in the session scratchpad, not in the repo): (a) every `csv_daily_returns` row with `api_key_id IS NOT NULL` (`api_key_id, date, daily_return`; about 12,000 rows today) and (b) the `allocator_equity_derived` rows `kind = 'equity_curve'` (the book `returns` list, 7 rows today) plus the `key_inputs:%` rows. This session already wrote that baseline to the scratchpad on 2026-11-03 (file shapes: `dr.json`, `eq.json`, `ki.json`); it is stale by the deploy day, so retake it immediately before merge.

**Post-deploy.** Wait for the first nightly `derive-allocator-key-dailies` after the deploy (schedule `40 0 * * *`) and the `derive_allocator_equity` job it enqueues; confirm every key's `derive_broker_dailies` row is `done` (the 185 plan 10 procedure). Then, marker first and alone, run the same two SELECTs and diff:
1. Per key: days present in the baseline and absent now (`sc4-day: key=<letter> day=<iso> was=<r>`). Expected: exactly the tiny-base days; key C's 2026-10-27 and 2026-10-28 (`was` +0.4698 and -0.5267) and 2026-10-29, plus every other tiny day of the three episodes; and NO day present now that was absent before.
2. Per book: days whose `returns[date].r` changed or vanished, with `was` and `now`. Expected: only days on which a tiny key-day exists; every other day byte-identical (compare as exact floats).
3. Per key: the rule recomputed independently from the stored `key_inputs` (the scratch script used for this research is the template) must equal the diff in (1). A disagreement fails the reading.
4. Lines in the 185 voice: `sc4-keys`, `sc4-book`, `sc4-day`, with `marker-sc4: PRODUCTION`.

**Blast radius to expect (measured 2026-11-03, replay approximation, key letters only where the phase already uses them):**

| Episode | Venue | Dates | Key-days | Notes |
|---------|-------|-------|----------|-------|
| E1 | Deribit, two keys with identical series | 2025-09-05 .. 2025-10-25 | 18 each (36) | one day of +8.2% at 2.3% of peak, the rest flat (r about 0). On 2025-09-05 the tiny key is the only defined return in two books, so those two book days lose their return entirely |
| E2 | MT5, two keys with identical series | 2025-11-17 .. 2025-12-15 | 29 each (58) | after a withdrawal of most of the account on 2025-11-16; returns -2% to -5%, none over 20% |
| E3 | Deribit, three keys including key C | 2026-10-27 .. (ongoing) | 7 each so far (21) | 7 of these days have |r| >= 20%; key C's run ends 2026-11-24 |
| total | | | 115 positive-base key-days over 7 key series | plus 233 zero-base (emptied) key-days that the recommended rule does NOT touch (Open Question 2) |

Books: 7 stored. Three contain tiny key-days (25, 54 and 36 days respectively; their book returns move by at most about 0.0006 on 2026-10-27/28 and negligibly elsewhere); the other four are untouched. No stored strategy series has a day over 30% in 2026-10-27..29 (checked with a count query). These numbers will grow daily for E3 until 2026-11-24, so the post-deploy expected set must be recomputed on the day, not copied from here.

## 186 DERIVEGAPS overlap (Q5)

186 has `186-CONTEXT.md` only (no research or plans yet; read this session from its worktree). Its stated touch points: `run_derive_broker_dailies_job` (the DQ-flag read and "write nothing for that key" gate, Bybit flows via `fetch_bybit_unified_flows`), `exchange.fetch_daily_pnl` caps, `working_holder_predicate`, `departed_end_by_key`, the `failing_series_ended_keys` block of the compose job, and `DegradeReason.FAILING_KEY_SERIES_ENDED` / `_BLOCKING_REASONS`. D-07 replaces the flat `r = 0` carry for a failing key and touches the compose's departed-key path.

Keep 188 mergeable in either order:
1. **All logic in new files.** `services/tiny_base.py`, `tests/test_tiny_base*.py`. Zero shared lines.
2. **No `DegradeReason`, no `_BLOCKING_REASONS` edit, no `DeriveRefusal` edit.** That block is 186's.
3. **No signature change on `compose_allocator_equity` or `portfolio_returns`.** The compose edit is one hunk building the existing `dropped_days` dict, immediately before the `book_returns = portfolio_returns(` call, away from 186's departed/stale-carry code.
4. **Append-only shared registries.** New key at the END of `NAV_TWR_GUARD_KEYS`; new field at the END of `MarkedSeries`; new `GUARD_FLAGS` row at the END of the TS table (note: the TS join order is "table order", so appending changes nothing for existing reasons).
5. **`job_worker.py` hunks stay at three call sites**: after `apply_marks` returns (the marked-era NaN/P&L hand-off), the `_key_inputs_payload["dropped_day_pnl"]` assembly, and the strategy pre-stamp. 186 works earlier in the same function (the crawl and DQ-flag consumption) and in the compose job's key loop.
6. **Do not reformat or re-sort the import block** around `from services.allocator_equity_derive import (` (both phases add names).
7. **Tests**: new files only, plus the one `Book.is_dropped` edit; 186 has no reason to touch that oracle.
8. **Release files**: the second to merge re-picks `VERSION`/`package.json`/`CHANGELOG.md`.

## Suggested decomposition (non-binding)

1. Pure definition + unit tests + the extended oracle pin (no behaviour change anywhere yet).
2. Realized-era seam: guard in `chain_linked_twr`, `NAV_TWR_GUARD_KEYS`, every-venue tests.
3. Marked-era seam: `apply_marks` outcome, `writer_day_pnl`, job hand-off to `dropped_day_pnl`, runner pre-stamp, covered-days exclusion; key-C-shape RED-then-GREEN.
4. Compose: union into `dropped_days`, flag, sole-key and two-key arms.
5. Readers: headline reason, `readMarksStart` field, book note, chart label (DESIGN.md check for any new string).
6. Pre-deploy baseline capture and, after deploy, the SC-4 reading (an orchestrator step, read-only).

## Project Constraints (from CLAUDE.md)

- **Which database am I on:** run the marker query first, alone, before any PROD statement; `current_database()` proves nothing. Never `supabase db push`; migrations apply via CI on merge. This phase ships none.
- **No `[skip ci]`-family tokens in any commit or PR text, not even to deny them.** Count checks bound to the head SHA.
- **CHANGELOG discipline:** every ship writes a unified entry (`## [X.Y.Z.B] - date`, repo section vocabulary: Fixed, Added, Changed, Removed, Tests, Notes, Security, Root cause, Why), enumerating every commit; `VERSION` and `package.json` byte-equal 4-digit strings; never `npm version`. Name known limits (Open Questions 1 and 4) in `### Notes`.
- **Completion is historical:** verification frontmatter uses `verified_at_sha` + `drift_subjects`; never `covered_digest` / `covered_files`; never list `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json` in `drift_subjects`.
- **Never restate a floor or count from memory in prose:** read constants by symbol; cite by symbol, not line number.
- **`gsd-tools` handlers:** `git diff` after every run (`phase complete` drops Progress-table prose and advances STATE to the next roadmap phase).
- **Design system:** read `DESIGN.md` before any visual or copy decision; muted = steady-state/honest-empty, warning token reserved for non-critical warnings; v2 factsheet surface is a 4-size / 2-weight contract (12px caption tier for notes).
- **AGENTS.md:** this is not the Next.js of the training data; read `node_modules/next/dist/docs/` before Next-specific TS code (the note UI is a plain client component edit, but check before touching routes).
- **Public repo:** no secrets, PROD ids, home paths or account numbers in tracked text; key letters only; never quote a search pattern as proof of absence.
- **Global rules in force:** root-cause fixes only; tests must be able to fail (neuter, see RED, restore from a byte backup, never `git checkout` / `restore` / `stash` on uncommitted work); fail loud; surgical changes; `grep -a`; pytest only from `analytics-service/`; no AI authorship trailers on commits (user memory overrides the attribution reminder).

## Sources

### Primary (HIGH confidence, read this session)
- `analytics-service/services/nav_twr.py` - `chain_linked_twr`, `_guard_denominator`, `NAV_TWR_GUARD_KEYS`, `NAV_TWR_ANNOTATION_KEYS`, `cumulative_twr_segmented`, `_last_interior_break_suffix`
- `analytics-service/services/nav_marks_apply.py` - `apply_marks` rules 1-14, `usable(base)`, `MarkedSeries`
- `analytics-service/services/allocator_equity_derive.py` - `DegradeReason`, `_BLOCKING_REASONS`, `replay_key_equity`, `dropped_day_pnl_payload`, `read_dropped_day_pnl`, `_dropped_pnl_by_day`, `EMPTIED_FRACTION`, `EMPTIED_RESTART_FLOOR_USD`
- `analytics-service/services/allocator_equity_compose.py` - `portfolio_returns`, `compose_allocator_equity`, `PortfolioReturns`
- `analytics-service/services/job_worker.py` - `run_derive_broker_dailies_job`, `_run_key_mode_compose_epilogue`, `_reconcile_span_delete`, `_calendar_days_absent_from`
- `analytics-service/services/analytics_runner.py` - covered-days and boundary reinstatement; `derive_basis_series(... densify_policy ..., covered_days=...)`
- `analytics-service/services/basis_series.py`, `broker_dailies.py` (sparse NAV index, four combiners), `metrics.py` (headline suffix)
- `supabase/schema/baseline.sql` - `csv_daily_returns.daily_return double precision NOT NULL`, `allocator_equity_derived` columns; `supabase/migrations/20261029120000_api_key_nav_marks.sql`
- `src/lib/factsheet/headline-basis.ts`, `src/lib/factsheet/build-payload.ts` (`deriveSegmentMarkers`), `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` (gap seam), `src/lib/queries.ts` (`readMarksStart`, `untrustworthyRebuildReason`), `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx` (`UnpricedAccountNote`)
- `.planning/phases/185-*/185-03-SUMMARY.md`, `185-10-SUMMARY.md`, `185-CONTEXT.md` (D-11); the 186 worktree's `186-CONTEXT.md`
- Tests read: `test_allocator_equity_dropped_day_pnl.py`, `test_allocator_equity_dropped_day_returns.py`, `test_nav_marks_apply.py`
- PROD (read-only, marker "PRODUCTION" confirmed first): row counts, per-key stored dailies, `key_inputs` and `equity_curve` payloads, marks table, strategy big-day count. Raw output stays in the session scratchpad.

### Secondary (MEDIUM)
- Replay of PROD inputs with the repo's own `replay_key_equity` plus a prototype of the rule (approximation of the post-deploy set, A5).

### Tertiary (LOW)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - nothing new is added.
- Architecture: MEDIUM - the seam map is verified in code; the exact marked-era hand-off (Pitfall 2) and `prior_levels` (Open Question 4) are design work for the plan.
- Pitfalls: HIGH for 1, 2, 3, 5, 6, 7 (each traced to code); MEDIUM for 4 (needs the founder's reading of D-02).

**Research date:** 2026-11-03
**Valid until:** 2026-11-24 for the PROD counts (E3 grows daily and ends then); the code map is valid until 186 or any other phase touches `apply_marks`, `chain_linked_twr` or the compose (re-grep the symbols before planning).

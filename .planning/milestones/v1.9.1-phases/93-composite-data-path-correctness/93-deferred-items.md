# Phase 93 — Deferred items

Non-blocking follow-ups surfaced during the composite data-path review (Phase 93.1
hardening). Recorded here; behavior intentionally NOT changed.

## D-1 (LOW, honesty gap) — reconstructed-but-empty/thin ccxt member joins as a 0-coverage member with no caveat

- **File:line:** `analytics-service/services/job_worker.py:3381` (the ccxt success
  branch `clipped.append((seq, clip_to_window(returns, ...)))` in `_reconstruct_all`,
  inside `run_stitch_composite_job`); coverage surfaces at
  `analytics-service/services/job_worker.py:3526` (`mask = coverage_mask(_coverage_input)`).

- **Description:** After HARD-05 Option A (Plan 93-04), a Bybit/OKX/Binance member is
  reconstructed honestly. A brand-new account with zero (or near-zero) activity
  reconstructs to an empty/thin returns series and JOINS the stitch as a valid member
  rather than degrading — so it lands in `per_key` with `n_days == 0` (or a very small
  count) and carries NO `degraded_members` reason. The factsheet then shows "Days = 0"
  for that key with no accompanying caveat explaining WHY (a genuinely empty account vs.
  a coverage problem are indistinguishable to the reader). This is NOT a wrong-number
  defect: `Days = 0` already truthfully discloses empty coverage, and no fabricated
  performance is attributed to the empty member — the stitch/coverage math is correct.
  The gap is purely one of user-facing explanation.

- **Proposed follow-up:** Add an `insufficient_member_history`-style DQ caveat (mirroring
  the existing `insufficient_window` / `degraded_members` annotation pattern) that fires
  when a reconstructed member contributes 0 (or below a small threshold of) coverage
  days, so the factsheet can render "Key N contributed no history in its window" instead
  of a bare `Days = 0`. Additive JSONB key, no migration, rendered via the existing DQ
  surfaces. Deferred: no correctness impact, and the caveat copy/threshold warrants its
  own small scoping pass.

## D-2 (venue gap, follow-up milestone) — full Bybit INVERSE perp support

- **File:lines:**
  - `analytics-service/services/exchange.py:1576` — Bybit closed-PnL is fetched
    `category="linear"` only, so an INVERSE (coin-margined) perp's realized/closed-PnL
    stream comes back EMPTY.
  - `analytics-service/services/broker_dailies.py:103-106` — funding is summed as
    `by_day[iso] += float(row["amount"])`, ignoring the row currency (a BTC-denominated
    inverse funding amount is treated as USD).
  - `analytics-service/services/exchange.py:2674` — account equity reads
    `balance.total.USDT` only; BTC collateral held against an inverse book is not valued.

- **Description:** A Bybit-INVERSE perp member cannot be honestly reconstructed today:
  its trading PnL is invisible (linear-only closed-PnL fetch), its funding is
  mis-valued (BTC amount summed as USD), and its collateral equity is unread
  (USDT-only anchor). Phase 93.1 DEGRADES such a member honestly (FIX B —
  `realized_stream_unavailable`, via the empty-realized + funding-present signal)
  rather than shipping a fabricated funding-only track, which satisfies HARD-05's
  OR-criterion (a member is either reconstructed OR visibly degraded). This is a
  PRE-EXISTING venue limitation, NOT introduced by phase 93.

- **Proposed follow-up:** A dedicated milestone adds real inverse support: fetch
  inverse closed-PnL (a second `category="inverse"` pass at exchange.py:1576),
  currency-aware funding valuation (value BTC funding at its same-UTC-day close in
  broker_dailies, mirroring the ccxt_flows event-time valuation), and BTC-collateral
  equity (value the coin balance at exchange.py:2674). Out of scope here — degrading
  honestly is the correct phase-93 closure.

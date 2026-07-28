---
phase: 136-mt5recon-equity-reconstruction
reviewed: 2026-07-23T20:19:36Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - analytics-service/services/mt5_deals.py
  - analytics-service/services/broker_dailies.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/ingestion/long_fetch.py
  - src/lib/closed-sets.ts
findings:
  critical: 1
  warning: 2
  info: 1
  total: 4
status: fixes_applied
fix_summary:
  cr-01: fixed (money logic — requires human verification)
  wr-01: fixed
  wr-02: fixed
  in-01: skipped (cosmetic, deferred)
  full_suite: 4389 passed, 96 skipped
---

# Phase 136: Code Review Report

**Reviewed:** 2026-07-23T20:19:36Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

This is the money-math + trust-integrity heart of the MT5 equity-reconstruction
milestone. I verified the load-bearing claims end-to-end:

- **DEAL_TYPE classifier (`mt5_deals.py`)** — allow-lists are disjoint (asserted at
  import), match the real MetaTrader5 enum (BONUS=6/CREDIT=3/BALANCE=2 → flow;
  0/1/7..11 → trading), and every unlisted/ambiguous/CORRECTION type fails loud.
  `bool` is rejected in both the type-code and money coercers. **Sound.**
- **Money fold (`combine_mt5_deal_ledger`)** — `profit+swap+commission+fee` is
  summed once per trading deal with broker-native signs; BALANCE/CREDIT/BONUS are
  removed from the numerator and folded as `ExternalFlow`s in the flow channel
  (no double-count, no sign flip). Anchoring to `account_equity` with
  `open_unrealized_usd = equity − balance` yields a realized-basis terminal
  (`terminal = anchor − upnl = balance`); the MT5 accounting identity
  `balance ≡ Σflows + Σrealized` makes the reconstructed pre-history base ≈ 0, so
  the initial-deposit day is an honest zero-NAV break and subsequent days roll off
  the real deposited capital. **Correct** — for equity above the dust floor (see
  CR-01 for the sub-$1000 hole).
- **Worker branch (`job_worker.py` venue=='mt5')** — kill-switch gates before any
  decrypt/login/read; `asyncio.wait_for` bounds the off-loop read; non-finite
  equity/balance fail loud PERMANENT; the material-equity floor + <2-day gate
  refuse an empty-but-green record; `mt5` is in `_NATIVE_RETURNS_VENUES` so the
  ccxt combine at :3754 does NOT overwrite the reconstructed series (verified at
  :3731). **Sound.**
- **api_verified integrity** — `mt5 ∈ _LEDGER_BACKED_SOURCES`, so `long_fetch`
  skips `fetch_raw`/`compute_metrics` (both fail loud by design in `mt5.py`) and
  routes to the derive tail; no fill-based snapshot is produced. **Sound.**
- **Annualization (`closed-sets.ts`)** — `mt5 ∉ CRYPTO_EXCHANGES`,
  `isCryptoExchange('mt5') === false`; `annualizationPeriods` keys off
  `asset_class`, no residual mt5→√365 path in this file. **Sound.**

One correctness/trust defect (CR-01) survives: MT5's authoritative equity anchor
is routed through the CSV-oriented dust→heuristic fallback inside
`combine_realized_and_funding`, so a low-equity MT5 account gets a fabricated
capital base and a wrong track record stamped `api_verified`. This is exactly the
"plausible-but-wrong track record" harm class the milestone exists to prevent, and
it is the kind of hole large hand-derived oracles (all > $1000) would miss.

## Critical Issues

### CR-01: Sub-$1000-equity MT5 accounts get a fabricated ~$10k capital anchor (wrong track record, stamped api_verified)

**Status:** FIXED — `combine_mt5_deal_ledger` now reconstructs DIRECTLY against the
authoritative live equity via `nav_twr.reconstruct_nav_and_twr`, bypassing the
CSV/ccxt dust→heuristic-capital fallback (transforms.py is untouched, so the ccxt/CSV
dust guard is NOT weakened). A real sub-$1000 anchor is honored (scaled correctly); a
genuinely-dust account falls to the honest DQ-01 dust guard → <2 usable days → the
job-worker material-equity floor rejects it PERMANENT. Two hand-derived regression
oracles pin both honest outcomes. **Before/after evidence** (run against pre-fix HEAD
in an isolated worktree): `test_sub_1000_equity_reconstructs_off_real_anchor_not_fabricated_base`
and `test_genuinely_dust_equity_fails_dust_guard_not_rescaled` both FAILED before the
fix — the $900 case returned ≈ −0.0109 (off a fabricated $55k base) with
`used_heuristic_capital=True`, and the $500 case emitted 2 non-NaN returns off a $10k
base with no dust guard; both PASS after the fix ($900 → −0.30 / −0.3571 off the real
$2000/$1400 prior NAV; $500 → all-NaN dust-guarded, 0 usable days). Requires human
verification of the money logic per the milestone's oracle discipline.

**File:** `analytics-service/services/broker_dailies.py:487-493` (root cause exercised in `analytics-service/services/transforms.py:169-188`)

**Issue:**
`combine_mt5_deal_ledger` delegates to `combine_realized_and_funding` and passes
the **authoritative live equity** as `account_balance`:

```python
return combine_realized_and_funding(
    records,
    [],
    account_balance=account_equity,   # the LIVE, authoritative MT5 equity
    external_flows=flows,
    open_unrealized_usd=account_equity - account_balance,
)
```

`combine_realized_and_funding` forwards that into
`trades_to_daily_returns_with_status`, which contains a CSV/ccxt-oriented dust
gate (`transforms.py:169`):

```python
_DUST_BALANCE_THRESHOLD = 1000.0  # USDT
min_balance = _DUST_BALANCE_THRESHOLD
if account_balance and account_balance > min_balance:
    anchor_nav = float(account_balance)          # real anchor
else:
    used_heuristic_capital = True
    heuristic_base = max(mean_abs_pnl * 100, abs(daily_pnl.sum()), 10000)
    anchor_nav = heuristic_base + daily_pnl.sum() # FABRICATED >= $10k base
```

For any MT5 account whose live equity is between the empty-ledger floor
(`_DERIBIT_EMPTY_LEDGER_FLOOR_USD = 100.0`) and the dust threshold (`$1000`) with
≥ 2 trading days, the branch discards the real equity and anchors to a
**fabricated ≥ $10,000 base**. Consequences:

1. The reconstructed daily-return series is scaled off a ~$10k+ base instead of
   the real ~$100–$1000 equity → returns are 5–10× wrong (the exact figure the
   `transforms.py` docstring warns about).
2. It **defeats the DQ-01 dust guard**: with the correct sub-$1000 anchor,
   `nav_twr._guard_denominator` NaN-breaks every day (`prev_nav < DUST_NAV_FLOOR`
   = $1000) → `usable_days < 2` → the material-equity floor at
   `job_worker.py:3459-3476` would honestly reject the account. The heuristic base
   inflates `prev_nav` above $1000, so the dust guard never fires, `usable_days ≥ 2`,
   the material floor is not triggered, and the wrong series flows through.
3. It surfaces only as `used_heuristic_capital=True → complete_with_warnings`,
   which is a **terminal SUCCESS** that still stamps `trust_tier='api_verified'`
   (`process_key.py:866`). A wrong, fabricated-base track record is published as a
   genuinely-reconstructed api_verified factsheet.

This directly contradicts the function's own contract ("anchor to the LIVE
`account_equity`", `broker_dailies.py:428-430`). MT5 is a forex/CFD venue where
$100–$1000 margin accounts are common, so the range is realistically reachable —
and unlike ccxt/CSV, MT5 *always* has an authoritative equity read, so the
heuristic fallback should never be reachable for it.

**Fix:** MT5 must never use the CSV heuristic-capital fallback; its equity is
authoritative. Mirror how `combine_native_ledger` / `combine_sfox_balance_history`
bypass the dust gate and reconstruct directly against the real anchor. Minimal
option — call the honest core directly instead of the CSV-shaped combiner:

```python
from services.nav_twr import reconstruct_nav_and_twr
# ... build the daily_pnl Series (per-day Σ deal_cash_effect) directly ...
returns, meta = reconstruct_nav_and_twr(
    daily_pnl_series,
    anchor_nav=account_equity,                 # ALWAYS the authoritative anchor
    external_flows=flows,
    open_unrealized_usd=account_equity - account_balance,
)
returns = gap_fill_daily_returns(returns)
return returns, dict(meta)
```

A genuinely dust MT5 account then falls to the honest DQ-01 dust guard →
`usable_days < 2` → the material-equity floor rejects it PERMANENT (no fabricated
base, no false api_verified). Add a regression oracle with equity in
`(100, 1000]` and ≥ 2 trading days asserting the reconstructed base equals the
real equity and `used_heuristic_capital` is NOT set.

## Warnings

### WR-01: External-flow money fold bypasses the module's bool/schema-drift fail-loud coercer

**Status:** FIXED — the flow fold now routes `profit` through the bool-rejecting
`mt5_deals._coerce_money` (the same coercer `deal_cash_effect` uses), replacing
`nav_twr._coerce_float`. Both channels share ONE fail-loud contract. Regression
`test_flow_channel_rejects_bool_profit_like_trading_channel` FAILED before the fix
(a bool `profit` on a BALANCE deal was silently folded as a $1 flow, "DID NOT RAISE")
and PASSES after (whole combine fails loud with `Mt5DealClassificationError`).

**File:** `analytics-service/services/broker_dailies.py:460-462`

**Issue:** The trading fold uses `mt5_deals.deal_cash_effect` →
`_coerce_money`, which deliberately **rejects `bool`** (an `int` subclass whose
truthiness is not a dollar amount) as schema drift (`mt5_deals.py:120-123`). The
external-flow fold instead uses `nav_twr._coerce_float`:

```python
amount = _coerce_float(
    deal.get("profit", 0.0), field="mt5_flow_profit", row={"day": day}
)
```

`nav_twr._coerce_float` does **not** reject `bool` — `float(True)` = 1.0 passes as
finite. A BALANCE/CREDIT/BONUS deal whose `profit` arrived as a bool (schema drift)
is silently coerced to `1.0`/`0.0` and folded as a real capital flow, rather than
failing loud like the trading path. The whole `mt5_deals` module exists to make
this class of drift fail loud (its docstring, `mt5_deals.py:15-70`), so the flow
channel is an inconsistent gap in that posture.

**Fix:** Route the flow amount through the same bool-rejecting coercer the trading
fold uses, e.g. add a `_coerce_money`-style call (or reuse `deal_cash_effect`'s
coercer against the single `profit` field) so both channels share one fail-loud
contract:

```python
from services.mt5_deals import _coerce_money  # bool-rejecting
raw = deal.get("profit", 0.0)
amount = 0.0 if raw is None else _coerce_money(raw, field="mt5_flow_profit")
```

### WR-02: MT5 timestamp fetch window mixes UTC-epoch bound with server-time deals — verify no near-now clipping

**Status:** FIXED — the bare `86_400` literal is replaced by named constants
`_MT5_DEAL_FETCH_MARGIN_S` (one day) and `_MT5_MAX_SERVER_UTC_OFFSET_S` (±13h real-broker
bound) with a module-load `assert _MT5_DEAL_FETCH_MARGIN_S >= _MT5_MAX_SERVER_UTC_OFFSET_S`
tying the margin to the offset bound — so a future edit that tightens the window fails
loud at import. Regression `test_deal_fetch_margin_covers_server_utc_offset_bound`
documents the same-day-deal-survival invariant. (Light touch, as scoped.)

**File:** `analytics-service/services/job_worker.py:3308-3310`

**Issue:** `history_deals_get(0, int(_mt5_now.timestamp()) + 86_400)` builds the
upper bound from **UTC** now, but MT5 deal `time` values are in the broker's
**server** timezone (the seam `deal_utc_day` exists to correct,
`mt5_deals.py:152-193`). The `+86_400` (one-day) margin is what keeps a near-now
server-time deal from being clipped by the UTC-based upper bound. This is correct
for any real broker offset (≤ ±13h), but the correctness is **entirely load-bearing
on that magic `86_400` margin** and there is no assertion tying it to the assumed
`MT5_SERVER_UTC_OFFSET_S` range. If a future change tightens the window (e.g. to
`_mt5_now` exactly, or a smaller margin) to "avoid fetching the future", same-day
deals on a server ahead of UTC would be silently dropped from the ledger →
under-counted terminal PnL → a wrong (but plausible) series. Lower bound `0` and
the reconstruct path are fine; this is a latent-regression / documentation gap.

**Fix:** Derive the margin from the assumed offset bound rather than a bare literal,
and comment the invariant, e.g. `+ max(86_400, abs(server_utc_offset_s) + 3600)`,
or add a test that a same-day deal on a `+3h`/`+13h` server survives the window.

## Info

### IN-01: Redundant second classify/date pass rebuilds flow evidence with a non-fail-loud float()

**Status:** SKIPPED (intentional, per fix scope) — cosmetic/non-behavioral (the combine
already validated every field; the rebuilt evidence is inert for mt5, no retention cap →
DQ-02 terminus is None). Threading `flow_by_day` out through `meta` would be a wider
refactor than warranted this pass; deferred.

**File:** `analytics-service/services/job_worker.py:3498-3507`

**Issue:** After `combine_mt5_deal_ledger` has already classified every deal,
bucketed each by `deal_utc_day`, and folded the flow channel internally, the worker
re-loops the raw deals to rebuild `_mt5_flow_by_day` for DQ-02 evidence — calling
`classify_deal` and `deal_utc_day` a second time and folding with a raw
`float(_deal.get("profit", 0.0))` (not `_coerce_float`). This is a duplicated fold
that can drift from the combiner's internal one, and the comment itself notes the
evidence is inert for mt5 (no retention cap → DQ-02 terminus is `None`). It is
harmless today (the combine already validated every field, so no new raise, and
the evidence is unused), but it is dead-ish duplication of the "one place folds
flows" principle.

**Fix:** Have `combine_mt5_deal_ledger` return its internally-computed
`flow_by_day` (or the built `ExternalFlow` list) in `meta`, and consume that in the
worker instead of re-deriving — one fold, one source of truth.

---

_Reviewed: 2026-07-23T20:19:36Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

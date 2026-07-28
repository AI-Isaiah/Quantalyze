# Phase 82 — Deribit derivatives P&L: options-aware native daily P&L (money-correctness)

**Status**: PLAN v2 (design + task breakdown + test strategy). No production code in this phase doc.
**Revision 2026-07-08**: the original R1 rule and the daily-equity oracle were found BLOCKING by the
adversarial plan-check; three live evidence probes on key `95089958` have since RESOLVED the design.
This revision bakes in the coverage-gated rule, the replaced acceptance oracle (balance-identity +
closure), the mandatory balance-identity guard, the §5 wedge as a base task, and the
pre-coverage-era decision. The evidence is SETTLED — the executor must NOT re-derive it.
**Bug class**: silent P&L misattribution (premium counted as return) — the highest-severity class this
codebase fights. Confirmed live on strategy `c225840c` "Phoenix Protocol", key `95089958`
(options+perps, BTC-settled): ±51–78% daily returns, +235% Aug-2025, on ~$150k NAV.

---

## 1. Root cause recap + the corrected P&L model

`txn_rows_to_native_daily` (`analytics-service/services/deribit_txn.py:892-1013`) sums the Deribit
transaction-log `change` field per (UTC-day, currency) over `_NATIVE_CASH_BEARING_TYPES`
(= `CASH_BEARING_TYPES` at :333 ∪ `{swap}`). Deribit's `change` is the **cash-balance delta**. For a
`trade` row on an **option**, `change` = ±premium − fee — a swap of cash for position value, not P&L
(live evidence: 2025-07-13, option trades summed to +2.77 BTC ≈ $326k "P&L" in one day → +65% daily
return). The actual option P&L lives in `options_settlement_summary` rows (`change`=0, fields
`realized_pl` / `unrealized_pl`) which the reconstruction deliberately leaves unclassified
(deribit_txn.py:437-444, P70 H3) and therefore ignores. Perp/future P&L via `settlement.change` is
correct and untouched. The model was validated on perp-only keys (v1.7), where `trade.change` ≈ −fees
and the cash basis coincides with the equity basis; options break that coincidence.

### P&L source: the transaction_log (SETTLED — do NOT reopen)

Direct `profit_loss` sources were probed and REJECTED: `user_trades.profit_loss` sums to 0.20 BTC
vs the 6.479 BTC ground-truth target, is unreliable per-fill for options, and is MISSING on
278/16,486 fills (spot legs); it is realized-only. `settlement_history` is 100k+ rows and its
`session_profit_loss` is platform-level, not account-level. The transaction_log is the only
COMPLETE source (options + perps + funding + expiry + unrealized via the summary channel).

### The coverage window (per currency) — the gate that makes the rule era-correct

Deribit began emitting `options_settlement_summary` rows on **~2025-01-12** (an exchange-side
feature rollout). Rows predating the rollout carry premium/payout cash ONLY in `change` — no
summary channel exists to re-attribute them. Inside the covered era, the summary already carries
the **fee-EXCLUDED** session economics (proven on key `95089958`: covered-era option fee-gross
Σ`change` **9.222194 BTC** matches Σ(`realized_pl`+`unrealized_pl`) **9.222190 BTC** to 3.7e-6
BTC), so re-applying `−commission` for the fee leg inside coverage is exact. Inverse-vs-linear is
a **RED HERRING** — the BTC book is simply the one whose history predates the rollout.

Per currency `c` (computed from that currency's summary rows in the same crawl):

```
coverage_window[c] = [ first_options_settlement_summary_ts[c] − 24h ,
                       last_options_settlement_summary_ts[c] ]
```

(no summaries for `c` at all → no window → every option row of `c` stays cash-basis `change`)

- **Lower bound −24h**: the first summary settles the session PRECEDING it, so option rows in the
  24h before the first summary are already carried by that summary.
- **Upper bound = last summary ts**: option trades AFTER the last crawled summary (the live
  partial session) have no summary yet — they stay cash-basis until the next crawl's summary
  lands; the full-history recompute then converges them onto the covered rule. This trailing edge
  is exactly what keeps the balance-identity guard (below) closing at every compute.

### The corrected per-currency daily formula (coverage-gated)

For currency `c`, UTC day `d`, per row `r` with `day(r)=d, currency(r)=c`:

```
native_pnl[c][d] = Σ contribution(r) over classified rows r, where

contribution(r) =
  type=settlement            → change                    (perp/future session RPL + funding — UNCHANGED)
  type=liquidation           → change                    (UNCHANGED)
  type=negative_balance_fee  → change                    (UNCHANGED)
  type=swap                  → change                    (native-only internal rebalance — UNCHANGED)
  type=trade:
      classify_instrument(instrument_name) == "option"
        AND ts(r) INSIDE coverage_window[c]
                             → −commission               (CHANGED: fee kept, premium cash EXCLUDED —
                                                          the premium/payout economics live in the
                                                          summary channel; `commission` is POSITIVE
                                                          and present+numeric on ALL option rows
                                                          (probe-verified) → LedgerValuationError
                                                          if absent/null/non-numeric)
      classify_instrument(instrument_name) == "option"
        AND (ts OUTSIDE window OR c has no window)
                             → change                    (pre-rollout / trailing-edge cash fallback,
                                                          §2 Q6 — flagged, never silent)
      else (perp / future / linear perp / spot pair="unknown")
                             → change                    (UNCHANGED — spot BTC_USDC legs stay, see §2 Q3)
  type=delivery:
      classify_instrument(instrument_name) == "future"
                             → change                    (UNCHANGED — futures expiry is real cash P&L,
                                                          no options summary covers it)
      classify_instrument(instrument_name) == "option"
        AND ts(r) INSIDE coverage_window[c]
                             → −commission               (payout cash EXCLUDED — carried by the
                                                          summary's realized_pl; fee kept, same
                                                          commission fail-loud as the trade arm)
      classify_instrument(instrument_name) == "option"
        AND (ts OUTSIDE window OR c has no window)
                             → change                    (cash fallback, §2 Q6)
      else ("unknown" + nonzero change)
                             → LedgerValuationError      (fail loud — never guess an expiring instrument)
  type=options_settlement_summary                        (NEW — native path only)
                             → realized_pl + unrealized_pl
                                                         (BOTH present on all rows (probe-verified)
                                                          and REQUIRED → LedgerValuationError if
                                                          absent/null/non-numeric; row `change` is
                                                          always 0.0, nonzero → LedgerValuationError.
                                                          ⚠️ `unrealized_pl` is a per-session DELTA,
                                                          NOT a level — it is LOAD-BEARING; dropping
                                                          it breaks closure)
  type ∈ _NATIVE_INFORMATIONAL_TYPES (transfer/deposit/withdrawal/usdc_reward)
                             → skipped (external-flow channel, UNCHANGED)
  any other type with nonzero change → LedgerValuationError (UNCHANGED verbatim guard)
```

**Excluded from native_pnl inside coverage** (their economic effect enters elsewhere or is
position-offset): option `trade` premium cash (offset by book value; P&L content carried by the
summary channel), option `delivery` payout cash (carried by `realized_pl`), external-flow types
(F_t channel). Outside coverage NOTHING is excluded — cash-basis `change` keeps the total exact.

### The balance-identity reconcile guard (MANDATORY fail-loud — milestone doctrine)

Per account, per currency: the computed total realized (Σ of ALL daily contributions above) MUST
equal `Σ change over CASH_BEARING rows` of that currency, to `< max($1-equivalent, 1e-4 ·
throughput)` where throughput = Σ|change| over that currency's cash-bearing rows. On breach →
raise `LedgerValuationError` — DO NOT SHIP. This identity holds by construction: outside coverage
the contributions ARE the changes; inside coverage the summary channel replaces the option cash
legs and the probe proved the replacement closes (9.222194 vs 9.222190, 3.7e-6 residual). The
guard catches the one dangerous residual case — a mid-window session that ever LACKED a summary
while options were open (its premium would be dropped with nothing carrying it). It is CHEAP (one
extra pass over rows) and is the SAME check the evidence probe used to prove closure.

**Semantics claim the covered-era formula encodes** (proved per-position in §2 Q1): for every day
inside coverage, `native_pnl[c][d] = Δ(settled per-currency equity) − flows[c][d]` — the full
mark-to-market daily P&L through the daily 08:00 UTC settlement, in native units. Pre-coverage
days remain cash-basis (premium swings persist there — §2 Q6); the TOTAL is exact in both eras.

**Scope**: the NATIVE path only (`txn_rows_to_native_daily` + `build_deribit_native_ledger` +
`reconstruct_native_nav_and_twr`), which is the production Deribit path since P80
(`job_worker.py:2013-2144` → `combine_native_ledger`). The USD-space sibling
`txn_rows_to_daily_records` is intentionally NOT changed (legacy/parity-panel only; changing it would
break its own byte-identity guarantees). Documented divergence: the 80-04 parity panel legitimately
MOVES for options accounts — same D8 posture as coin-dust accounts
(`test_dust_account_excluded_from_identity`).

---

## 2. Resolved design decisions (Q1–Q6)

### Q1 — Realized-only vs full mark-to-market: **(b) full MTM** ★ RESOLVED (probe-confirmed)

Evidence has upgraded this from recommendation to fact: `unrealized_pl` is a per-session **DELTA**
(not a level), and Σ(`realized_pl`+`unrealized_pl`) over the covered era reproduces the fee-gross
option cash total to 3.7e-6 BTC — the closure only works with BOTH fields summed. Dropping
`unrealized_pl` breaks closure; it is load-bearing, not a reporting nicety.

**Decision**: daily `pnl_t` = realized (perp settlement + options `realized_pl` + fees + future
delivery) **plus** the options unrealized channel (`unrealized_pl` per summary row). This makes the
daily series a **settled-equity** series, consistent with the terminal anchor.

**Why (a) realized-only is not just "simpler but coarser" — it is structurally broken here**:

1. *Basis mismatch with the anchor.* The roll anchors to `terminal_native − upnl_native`
   (`native_nav.py:458`, P77 wedge) where `terminal_native` = per-currency `equity` (MTM, includes
   the option book's mark value) and `upnl_native` = `session_upl` (unrealized **since last
   settlement** only). Under realized-only pnl, `Σpnl` reconciles to a **cash**-basis history while the
   terminal is equity-basis. The §5 residual per currency becomes
   `resid_c ≈ option_book_value_c(anchor) − lifetime_unmarked_component` — nonzero whenever the book is
   open, i.e. a **structural false inception breach** (tolerance is only max($1, 1e-4·NAV) ≈ $15 on this
   account). Fixing that would require a *lifetime*-UPL wedge, which no API field supplies historically.
2. *Dishonest track record.* An options book can be down 50% MTM for months with zero realized events;
   realized-only shows a flat line then a cliff at expiry. GIPS/TWR convention is MTM valuation.
3. *The data is present*: `options_settlement_summary` is exactly Deribit's own daily MTM decomposition.

**Reconciliation math (the per-position proof, session-delta semantics)** — long option, premium `p`
at t₀, daily settlement marks `m₁…m_{T−1}`, exit value `x` at T, fees `f_t`, `f_x`:

| day | new pnl contribution | Δ(settled equity) = Δcash + Δbook |
|---|---|---|
| t₀ (trade) | `u₀ = m₁ − p` (unrealized) `− f_t` (commission) | `(−p − f_t)` cash `+ m₁` book `= m₁ − p − f_t` ✓ |
| interior i | `u_i = m_{i+1} − m_i` | `Δbook = Δmark` ✓ |
| T (exit) | `r = x − m_{T−1}` (realized) `− f_x` | `(x − f_x)` cash `− m_{T−1}` book ✓ |
| **Σ life** | `x − p − f_t − f_x` | `x − p − fees` ✓ |

Summing over positions/instruments: `pnl[c][d] = Δ settled-equity_c(d) − flows_c(d)` daily, hence
`Σ_d pnl = equity_c(T) − session_upl_c(T) − Σ flows` — the §5 identity closes **by construction** with
the existing wedge (§2 Q5). No change to `native_nav.py` needed.

**Decision recorded** (no founder gate needed — no-clients doctrine + evidence): the daily series
becomes MTM inside coverage — historical drawdowns of the open option book will now show in the
track record. MTM is the industry-standard TWR basis and the only variant whose inception identity
closes with available data. (a) realized-only is recorded as REJECTED, not deferred.

### Q2 — Row/field inputs per currency: the formula in §1

Summary of what changed vs today: option `trade` INSIDE coverage → `−commission` (was `change`);
option `delivery` INSIDE coverage → `−commission` (was `change`); option rows OUTSIDE coverage →
`change` (UNCHANGED value, newly flagged §2 Q6); `options_settlement_summary` → `realized_pl +
unrealized_pl` (was ignored/unclassified). Everything else — including perp `trade` fees,
`settlement`, `swap`, `liquidation`, `negative_balance_fee`, future `delivery`, the three verbatim
absent/null/undatable `change` guards, and the unknown-type fail-loud — is **byte-untouched** for
non-option rows.

New plumbing in `deribit_txn.py` (preserving the disjointness discipline at :350-354/:395-406):

```python
_NATIVE_OPTIONS_SUMMARY_TYPES: frozenset[str] = frozenset({"options_settlement_summary"})
# native classified = cash-bearing ∪ swap ∪ summary; all three pairwise disjoint (import-time asserts)
```

plus two pure helpers (pandas-free, AST-guard-compatible):
- `_summary_coverage_windows(rows) -> dict[ccy, (start_ts, end_ts)]` — first/last summary ts per
  currency, start shifted −24h; currencies with no summaries absent from the dict.
- `assert_balance_identity(rows, native_daily) -> None` — the §1 guard; raises
  `LedgerValuationError` on breach (id/type-only message discipline, §App B). Called from
  `build_deribit_native_ledger` (which can supply the $1-equivalent floor from the anchor mark;
  the pure helper's own floor is the relative `1e-4·throughput` term) — NO signature change to
  `txn_rows_to_native_daily` itself.

The USD sets (`CASH_BEARING_TYPES` / `INFORMATIONAL_TYPES`) are untouched; in the USD path
`options_settlement_summary` remains deliberately unclassified (zero-change → ignored, nonzero → loud),
so the P70 H3 comment block (:437-444) is updated to note the native-path classification.

### Q3 — Spot/linear conversion legs (`BTC_USDC` trades): **keep as-is; no reclassification**

A BTC↔USDC spot conversion emits one `trade` row per wallet (−1 BTC leg, +60,000 USDC leg), each a
real native balance delta. The codebase's own `swap` precedent (deribit_txn.py:365-404) establishes
that an **internal rebalance belongs IN native_pnl** (else the per-currency backward roll cannot
close) and must NOT enter the flow channel; return-neutrality comes from the two legs cancelling in
USD at same-day marks inside `_value_over_calendar` (net ≈ slippage ≈ 0). Spot conversion trades
already satisfy this today (`type=trade` → summed), so **no code change** — only a pinning test.

**Exact classification predicate** (single source: `classify_instrument`, deribit_txn.py:122):

| instrument_name | classify_instrument | trade contribution |
|---|---|---|
| `BTC-27MAR26-100000-C` / `…-P` (also `SOL_USDC-…-C` linear options) | `"option"` (endswith `-C`/`-P`, checked FIRST) | `−commission` inside coverage; `change` outside |
| `BTC-PERPETUAL` | `"inverse_perpetual"` | `change` |
| `BTC_USDC-PERPETUAL` | `"linear_perpetual"` | `change` |
| `BTC-27MAR26` | `"future"` | `change` |
| `BTC_USDC` (spot pair) | `"unknown"` | `change` (swap-analog, both legs) |

`side` is NOT consulted (D-08: never re-derive economics from side). A junk/empty instrument on a
`trade` row classifies `"unknown"` → keeps `change` (current behavior; we cannot do better without
fabricating). A `delivery` row classifying `"unknown"` with nonzero change fails loud (a delivery
always names its expiring instrument; silence would mis-route expiry cash).

### Q4 — Double-count risks: the critical section

**(i) `settlement.change` vs `session_rpl`**: NO overlap risk — `session_rpl` is a breakdown field on
the same row, never summed anywhere (the module docstring :19-26 already pins `change` as the one
summed field, fee-inclusive). Unchanged.

**(ii) `options_settlement_summary.realized_pl` vs option `delivery.change`**: ★ RESOLVED —
**coverage-gated R1 wins** (the plan's original ungated R1 was BLOCKING; the gate fixes it). Inside
coverage the summary carries the complete fee-EXCLUDED premium/payout economics — proven by the
covered-era closure: option fee-gross cash 9.222194 BTC == Σ(`realized_pl`+`unrealized_pl`)
9.222190 BTC (3.7e-6 residual). So inside coverage, option `delivery` (like option `trade`)
contributes **fee only** (`−commission`); the payout is carried by `realized_pl`. Outside coverage
there is no summary — the full `change` is the only truth and is kept. R2 and R3 are DEAD: R2's
premise fails the closure (expiry IS in the summary channel); R3's premise fails E1 (delta, not
level). Never reconstruct payout from contracts×settlement_price — the hand-rolled-inverse-math
class D-08 forbids stays in force.

**Why the daily-equity oracle was REPLACED** (plan-check finding, probe-confirmed): the
row-embedded `equity` snapshot matches `Δequity − flows` on only ~13% of days — mark-timing noise
(row snapshots are intraday, not 08:00-settlement-aligned) and perp `session_upl` being NULL on
every settlement row make it unusable as a per-day gate. The replacement discriminator (and the
shipped guard) is the **balance identity**: `Σchange == Δbalance` per day closes on 279/280 days
of the probe account (the 1 miss is 8dp rounding), and computed-total-vs-Σchange closure is exact
at the flat terminal. See §5 for the acceptance gates built on it.

Count-once discipline is preserved structurally: every row type maps to exactly ONE channel
(native_pnl | external flow | skipped-with-zero-change), enforced by extended import-time disjointness
asserts, and the whole-account closure is enforced by the §5 gate + the balance-identity guard (§1).

**(iii) `unrealized_pl` delta-vs-level**: ★ RESOLVED — it is a per-session **DELTA** (E1:
autocorrelation + terminal checks). No per-scope grouping or day-over-day diffing is needed; the
flat scope concat (`_crawl_deribit_ledger`, deribit_ingest.py:1040) is safe for summation. The R3
level-contingency machinery is NOT built. (Coverage windows are per CURRENCY across the account,
per §1 — a multi-scope account's currencies share one window each, which is correct because the
summary rollout was exchange-side, not per-subaccount.)

### Q5 — Inception reconciliation (§5 gate): closes by construction; gate code UNCHANGED, wedge READ fixed (BASE task)

The gate (`native_nav.py:661-780`) computes per bucket
`resid_c = terminal_native_c − upnl_c − Σpnl_c − Σflow_c` and requires ≈0.

- **New model**: §2 Q1's proof gives `Σpnl_c = settled-equity_c(T) − Σflow_c`, and
  `terminal_native_c − upnl_c` = `equity_c − session_upl_c` = settled-equity_c (mark moves since the
  last 08:00 UTC settlement are exactly the session wedge). Hence `resid_c → 0` up to fee/float dust —
  absorbed by `INCEPTION_NATIVE_DUST_REL` (:199). **The new pnl reconciles to settled EQUITY, not
  cash** — matching what the anchor minus wedge already is. No tolerance retuning expected.
- **Where the premium's balance impact goes**: premium cash out at t₀ is offset in the SAME currency's
  equity by the option book's mark value in; the P&L content surfaces over time via
  `unrealized_pl`/`realized_pl` and at exit the payout cash replaces the book value. Per currency and
  per day the ledger channels sum to the equity delta (the §2 Q1 table), so the account-level SUM
  closes without any cash-only residual.
- **Old model closed only coincidentally**: old `Σpnl` reconciles CASH, so
  `resid_old ≈ option_book_value(anchor) − session component` — ≈0 only when the book happened to be
  ~flat at onboarding time.
- **The wedge READ is fixed proactively (promoted from contingency to BASE task — Task 2b)**: the
  adapter currently reads only `summ.get("session_upl")` (deribit_ingest.py :1141 / :1244), which
  Deribit structures as futures-only. The read becomes the COMBINED session uPnL =
  `options_session_upl + futures_session_upl` (or the combined `session_upl` field if the account
  summary layout shows it already includes both — the executor VERIFIES against the live
  `get_account_summaries` field layout before choosing, and documents which). This is BYTE-SAFE for
  perp-only accounts: `options_session_upl` absent → `.get(..., 0)`-style coerce → wedge value
  unchanged → SC-4 intact. It CANNOT be validated at the probe account's flat terminal
  (`session_upl == 0` there) — recorded as a live-anchor follow-up (§6), but implemented
  defensively now so an open-book anchor doesn't structurally breach the gate. The gate code in
  `native_nav.py` itself stays untouched; a breach at a live anchor still fails loud (never silent).

### Q6 — Pre-coverage-era option dailies: **cash-fallback + data-quality flag** (DECIDED)

Option rows before a currency's first summary (probe account: Dec-2024 → 2025-01-12, predating the
Aug-2025 factsheet window — low stakes) fall back to cash `change`: the premium swings PERSIST on
those days because no summary data exists to reshape them, and none ever will (exchange-side
rollout, not a data error).

**Decision: cash-fallback + stamp `pre_summary_rollout_option_dailies` on the account meta**
(the existing warning-key → `complete_with_warnings` pattern, exactly like
`unrealized_pnl_unreadable` at job_worker.py:2436-2444), carrying the sorted list of affected
`(currency, day)` buckets so the factsheet can caveat rather than silently ship noise.

**Why NOT fail-loud/withhold** (considered, rejected — argued against doctrine): fail-loud is for
numbers we COULD compute correctly but didn't; here no correct daily attribution is derivable —
synthesizing one would violate the no-invented-data rule, and withholding would permanently brick
onboarding for ANY account whose options history predates 2025-01-12, destroying an exact TOTAL
(Σchange is exact in both eras) to punish noisy pre-rollout dailies. The
`complete_with_warnings` channel is the doctrine-consistent middle: the v1.8 status bridge
preserves it platform-wide, and founder-lp's strict mode already withholds warned accounts — so
the strictest consumer stays protected automatically. The flag derivation is a pure helper
(`_pre_coverage_option_days(rows)`) in `deribit_txn.py`; the stamping is adapter/worker-side.

---

## 3. Task breakdown (ordered; TDD — every task names a test that FAILS pre-fix)

### Task E — Evidence record ★ COMPLETE (three probes, 2026-07 — inputs to this plan, NOT re-run)
The probes have already run against key `95089958`; their outcomes are BAKED into §1/§2 and the
executor builds against them as fixed facts (re-deriving them is out of scope):
- **E1** `unrealized_pl` is a per-session **DELTA**, not a level; present+numeric on ALL summary
  rows alongside `realized_pl`; summary `change` is always 0. R3 dead.
- **E2** expiry economics live in the summary channel → coverage-gated R1 selected; R2 dead. The
  daily-equity oracle itself was REJECTED as discriminator (13% day-match, mark-timing noise, perp
  `session_upl` NULL on settlement rows) — replaced by the balance identity (§2 Q4-ii).
- **E3** `commission` is POSITIVE and present+numeric on 100% of option trade/delivery rows; the
  summary economics are fee-EXCLUDED (covered-era fee-gross 9.222194 BTC == Σ(rpl+upl) 9.222190
  BTC) → `−commission` inside coverage neither drops nor double-counts fees.
- **E4/E5** closure targets (the acceptance hard numbers): balance identity `Σchange == Δbalance`
  closes 279/280 days (1 miss = 8dp rounding); flat-terminal full-history targets **BTC
  +6.479224**, **USDC −97752.858490**; coverage rollout ≈ **2025-01-12**; the +65% spike day
  **2025-07-13** collapses from **+2.736 BTC → +0.0046 BTC (−0.36%)**.
**Executor deliverable (small)**: commit the probe outputs as
`analytics-service/docs/evidence/drb-options-semantics-2026-07.json` (fixture source for Tasks 1/3)
if not already in-tree; no live probe run gates the code.

### Task 1 — Pure core: coverage-gated classifier + balance-identity guard in `deribit_txn.py`
**File**: `analytics-service/services/deribit_txn.py` (:892-1013 + type sets :386-406 + comment
:437-444). Implement the §1 coverage-gated formula plus the three pure helpers of §2 Q2
(`_summary_coverage_windows`, `assert_balance_identity`, `_pre_coverage_option_days`). The window
is computed INSIDE the module from the same row stream (one pre-pass) — no adapter plumbing, no
signature change to `txn_rows_to_native_daily`. New import-time asserts: summary set disjoint from
both native sets. All new fail-louds are `LedgerValuationError` with id/type-only messages (leak
discipline §App B — never a raw amount beyond the existing verbatim `({change})` parity exception).
**Tests first** (in `tests/test_deribit_txn.py` + new coverage-gating suite, all failing on current code):
- `test_option_trade_premium_excluded_fee_kept_inside_coverage` — the 2025-07-13 regression shape:
  option trade rows inside coverage with `change=+2.736` net, `commission=0.0007` → day contributes
  `−0.0007`, NOT `+2.736` (fixture bracketed by summary rows so the window covers it).
- `test_option_rows_outside_coverage_keep_change` — same option rows with ts BEFORE
  `first_summary − 24h` → full `change` (pre-rollout fallback); and a currency with NO summaries →
  full `change` on every option row.
- `test_coverage_window_bounds` — the −24h lower edge (option trade 23h before the first summary is
  INSIDE) and the last-summary upper edge (trade after the last summary is OUTSIDE, trailing-edge
  cash basis).
- `test_options_settlement_summary_enters_native_pnl` — summary row (`change=0.0`,
  `realized_pl=0.03`, `unrealized_pl=-0.01`) → `+0.02` on that (day, ccy).
- `test_summary_unrealized_pl_is_load_bearing` — dropping `unrealized_pl` from the sum breaks
  `assert_balance_identity` on a closure fixture (encodes WHY it's summed: it's a session delta).
- `test_summary_missing_realized_or_unrealized_fails_loud` (absent, None, `""`, `"x"` — parametrized).
- `test_summary_nonzero_change_fails_loud` (semantics drift guard).
- `test_option_trade_missing_commission_fails_loud` (inside coverage only — outside coverage the
  row is cash-basis and `commission` is not consulted).
- `test_option_delivery_fee_only_inside_coverage` — payout excluded, fee kept; mutation-honesty:
  including full `change` reddens via the hand-computed day total; outside coverage → `change`.
- `test_balance_identity_guard_raises_on_missing_midwindow_summary` — a mid-window session with
  option premium cash but NO summary row → computed total ≠ Σchange beyond
  max($1-equiv, 1e-4·throughput) → `LedgerValuationError`; companion green case proves the closure
  fixture passes.
- `test_pre_coverage_option_days_helper` — returns exactly the (ccy, day) buckets with option rows
  outside coverage; empty for fully-covered and perp-only fixtures.
- `test_future_delivery_change_unchanged`; `test_perp_trade_change_unchanged`;
  `test_spot_conversion_both_legs_unchanged` (BTC_USDC legs −1 BTC / +60000 USDC, swap-analog pin).
- `test_perp_only_ledger_byte_identical` — SC-4 unit pin: a fixture spanning settlement / perp+future
  trades / future delivery / liquidation / negative_balance_fee / swap / flows asserts the EXACT dict
  the pre-fix formula produces (hand-pinned literals = Σ change), bit-equal; also asserts the
  coverage pre-pass found no windows (no summary rows) and `_pre_coverage_option_days` is empty.
- Purity: the existing AST guard (`test_deribit_txn.py:673-689`) stays green (no new imports).

### Task 2 — Adapter integration (`deribit_ingest.py`): guard wiring + pre-coverage flag
**File**: `analytics-service/services/deribit_ingest.py` (+ the meta-stamping site in
`job_worker.py`, pattern of :2436-2444). Delta semantics are CONFIRMED (§2 Q4-iii) so NO scope
threading / level-diff contingency is built. Structural changes are exactly two:
(a) `build_deribit_native_ledger` calls `assert_balance_identity(rows, native_daily)` after
aggregation (supplying the $1-equivalent native floor from the anchor mark it already holds) —
the fail-loud gate on every ledger build; (b) `_pre_coverage_option_days(rows)` nonempty →
`meta["pre_summary_rollout_option_dailies"] = sorted buckets` → `complete_with_warnings` (Q6).
`_build_dense_native_marks` (:1419) needs no change: it derives required days from the
`native_pnl` series, which now includes summary days — covered automatically by the dense span.
**Tests**: `tests/test_deribit_ingest*` — options fixture (option trades + summaries + expiry
delivery + perp settlements) through the REAL `build_deribit_native_ledger` with a stubbed exchange
(pattern: `test_native_nav_sc4_identity._real_adapter_ledger`) → ledger `native_pnl` matches Task-1
sums; marks present on summary-only days; a broken-closure fixture RAISES at ledger build (proves
the guard is INVOKED at the call site, not just defined — wiring-guard discipline); a
pre-coverage fixture stamps the warning key and a fully-covered one does not. Fails pre-fix
(native_pnl carries premium; no summary days; no guard).

### Task 2b — §5 wedge: combined options+futures session uPnL (BASE task, promoted from contingency)
**File**: `analytics-service/services/deribit_ingest.py` (:1141 and :1244 — BOTH read sites: the
legacy USD wedge `_deribit_session_upl_to_usd` and the native `DeribitNativeAccountState` read).
Replace the futures-only `summ.get("session_upl")` with the COMBINED session uPnL per §2 Q5:
`options_session_upl + futures_session_upl`, OR the top-level `session_upl` if the executor
verifies (against the live `get_account_summaries` field layout, documented in the code comment)
that it already includes both. Absent/null/non-numeric components coerce to 0.0 each (never
fabricate — T-77-05 discipline preserved); the `unreadable` MUST-2 signal keeps its meaning
(readable iff ANY component read numerically).
**Tests first** (`tests/test_deribit_ingest.py`): perp-only summary (`options_session_upl` absent)
→ wedge value BYTE-IDENTICAL to today (SC-4); options summary with both components → wedge = sum
(fails pre-fix: futures-only read drops the options component); all-absent → unreadable flag
semantics unchanged. NOTE: not validatable live at the probe account's flat terminal
(`session_upl == 0`) — live-anchor follow-up recorded in §6; the unit fixtures carry the proof.

### Task 3 — End-to-end: sane returns + §5 closure on an options account
**Test-only** (`tests/test_native_nav.py` or a new `test_deribit_options_pnl.py`): synthetic
options+perps account (summary rows present → covered era) with terminal `equity = cash + book`,
combined `session_upl` wedge → `reconstruct_native_nav_and_twr` returns finite daily returns with
the premium day ≈ −fee/NAV (assert `abs(r) < 0.01` where the pre-fix model gives ≈ +0.65 — the
2025-07-13 shape: +2.736 BTC old → +0.0046 BTC / −0.36% corrected), and NO
`InceptionReconciliationError`. A second fixture with a pre-coverage stub era (option rows before
the first summary) shows: covered-era days reshaped, pre-coverage days cash-basis, TOTAL identical
either way (the balance identity holds across both eras). Mutation-honesty companion: perturbing
one summary's `realized_pl` by a material amount breaches the §5 gate / balance-identity guard —
proves the identity is load-bearing, not tolerant-by-accident.

### Task 4 — SC-4 identity gates (see §4 below) + acceptance-key eligibility verification
Extend `tests/test_native_nav_sc4_identity.py`: (a) whole existing matrix untouched-green (its
fixtures are settlement/deposit/swap rows only — no option rows exist, so identity holds by
construction); (b) NEW real-adapter perp-only INVERSE fixture (BTC settlements + perp trade fees +
future delivery + nbf + marks stub) asserted bit-exact (`check_exact=True`) against golden literals
computed by the OLD formula written inline in the test.
**Plus (plan-check finding, do NOT assume)**: the live perp-only acceptance keys used for SC-4
byte-identity in Task 7 must be VERIFIED eligible — via their crawls, assert each carries ZERO
historical option `trade`/`delivery` rows AND zero `options_settlement_summary` rows over full
history. A key that ever traded one option carries summary/delivery rows and would LEGITIMATELY
change post-fix — using it as a byte-identity control is a false red. Deliverable: a small check in
the acceptance harness (or a one-off verified note in the Task-7 run log) listing per key the
option/summary row counts (must be 0/0) before the byte-identity comparison is trusted.

### Task 5 — Acceptance-harness basis fix (`scripts/deribit_acceptance.py`)
**Plan-check finding (fold-in)**: the P72 harness builds its fresh `daily_reconcile` basis via the
USD `fetch_deribit_ledger_daily_records` path (:443) while PRODUCTION is native-only
(`job_worker.py:2008-2144`) — the harness currently checks a path production doesn't run. Post-fix
the divergence becomes false-red for options accounts (summary days appear; premium days shrink to
fee-size but stay nonzero) → false dropped/injected failures.
Change: derive the fresh nonzero-day set from `txn_rows_to_native_daily` over the same crawl's raw
rows (the production formula), keeping the USD basis for the advisory fills summary. This is
**correct alignment — the harness must check what is actually persisted — not masking**: the money
gates are the balance-identity guard + §5 closure, which the harness basis switch does not touch.
**Test**: `tests/test_deribit_acceptance.py` — fixture where an options-summary-only day is nonzero
under the native basis; asserting the old USD basis reddens it.

### Task 6 — Docs / pins
Update the LOCKED design doc `analytics-service/docs/deribit-ingestion-design.md` with a new pin
(D-11 or next free): "options P&L channel — coverage-gated: inside the per-currency summary window
`[first_summary−24h, last_summary]` option trade/delivery contribute `−commission` and summaries
contribute `realized_pl + unrealized_pl` (session DELTA, load-bearing); outside the window option
rows stay cash-basis `change` + `pre_summary_rollout_option_dailies` warning; guard/oracle =
BALANCE IDENTITY (computed total == Σchange over CASH_BEARING, fail-loud), NOT the row-embedded
equity (rejected: 13% day-match, mark-timing noise)".
**Semantic-shift callout (plan-check finding — mandatory)**: excluding premium redefines option
`native_pnl` from "cash-balance delta" to "MTM (settled-equity) delta" for covered option rows —
state this explicitly in the `deribit_txn.py` module docstring (:19-26, which currently pins
`change` as the one summed field — that sentence must be amended) AND in the D-pin, so no future
reader "fixes" the fee-only arm back to cash. Also update the :437-444 P70-H3 comment (summary now
classified on the native path), document the Q6 warning key where `unrealized_pnl_unreadable` is
documented, CHANGELOG + VERSION + package.json (same commit — version-bump-both-files rule).

### Task 7 — Live re-validation (acceptance criteria, §5 below)
Re-run key `95089958` end-to-end (re-onboard/recompute via the ledger path — NOT the poisoned
retry-after-failure path; mig-038 caveat) + the perp-only validation keys + the P72 harness.

---

## 4. SC-4 gating — how correct accounts stay byte-identical

**Mechanism: classification-gated, not account-flag-gated.** The only new branches key on
(a) `type == "options_settlement_summary"` and (b) `classify_instrument(...) == "option"` inside the
`trade`/`delivery` arms (the coverage-window check nests INSIDE the option branch — it is never
consulted for non-option rows). A perp-only or USD-native ledger contains **zero** such rows, so:
the coverage pre-pass finds no summaries → no windows (value-inert extra read); the accumulation
loop executes the same rows, in the same order, through the same
`by_day_ccy.get(key, 0.0) + change` float ops → bit-identical output, IEEE-guaranteed (no reordering,
no re-association, no extra arithmetic on the untouched path); `assert_balance_identity` runs but
passes trivially (contributions ARE the changes — residual exactly 0.0); `_pre_coverage_option_days`
is empty → no warning stamped. The Task-2b wedge read is byte-safe per §2 Q5
(`options_session_upl` absent → 0.0 → unchanged value). `native_nav.py`, `nav_twr.py`,
`external_flows.py` and the USD-space path are not modified at all.

**Tests that pin it**:
1. `test_perp_only_ledger_byte_identical` (Task 1) — unit level, golden literals = old formula.
2. Existing `test_native_nav_sc4_identity.py` full matrix + real-adapter tier — must pass UNMODIFIED
   (merge-blocking already).
3. New real-adapter inverse perp-only fixture (Task 4) — bit-exact vs old-formula goldens through
   `build_deribit_native_ledger` → `combine_native_ledger`.
4. Live (Task 7): the perp-only acceptance keys' factsheets re-run byte-identical (harness
   `daily_reconcile` exact + spot-check stored daily_return values unchanged).

---

## 5. Acceptance criteria (Task 7, all must hold)

1. **Phoenix Protocol** (`c225840c`, key `95089958`) recomputed — **spike-collapse regression**:
   the documented +65% day **2025-07-13** goes from OLD **+2.736 BTC** to corrected **+0.0046 BTC
   (−0.36%)**; every covered-era single-day `|return| < 10%` (expect low single digits); Aug-2025
   monthly return no longer +235% and inside a plausible band; no covered-era day at the old
   ±51–78% magnitudes. (Pre-coverage stub days — Dec-2024→2025-01-12, outside the factsheet
   window — are exempt from the 10% bound and carry the Q6 flag.)
2. **Balance identity green** (REPLACES the rejected daily-equity oracle): per day,
   `Σchange == Δbalance` on the txn-log (closes 279/280 days on the probe account; the 1 miss is
   8dp rounding — tolerance absorbs it); and per currency the `assert_balance_identity` guard
   (computed total realized == Σchange over CASH_BEARING, residual < max($1, 1e-4·throughput))
   passes on every ledger build — this is the money proof.
3. **Flat-terminal full-history closure** (hard targets): computed Σrealized == Σchange targets
   **BTC +6.479224** and **USDC −97752.858490**, residual < $1 each; **covered-era exact closure**
   on the linear/covered book: covered-era option fee-gross vs Σ(`realized_pl`+`unrealized_pl`)
   matches at the probed 9.222194-vs-9.222190 precision class (residual ≤ 1e-5 native).
4. **§5 inception gate closes** (`full_history=True`, live anchor with open positions) — with the
   Task-2b COMBINED wedge read; a breach here is a loud stop, not a tolerance loosening. (The
   combined-read correctness at a NONZERO wedge is a live-anchor follow-up — §6.)
5. **Perp-only keys unchanged** (SC-4 live): keys first VERIFIED zero-option/zero-summary over full
   history (Task 4); then factsheets byte-identical pre/post; P72 harness
   (`check_daily_reconcile` on the Task-5 native basis) green on all keys.
6. Full CI: vitest untouched; pytest suite green including the unmodified SC-4 identity suite;
   AST purity guard green.

---

## 6. Risks / unknowns

- ~~Summary-field semantics~~ / ~~`commission` absence~~ / ~~`realized_pl` fee-inclusiveness~~ /
  ~~multi-scope level-diffing~~ — **RESOLVED by the 2026-07 probes** (Task E record): delta
  semantics, 100% commission presence, fee-EXCLUDED summary economics (9.222194 vs 9.222190), no
  level machinery. Not re-derived; the Task-1 fail-louds still guard against future schema drift.
- **Mid-window missing summary** (a covered-era session that ever lacked a summary while options
  were open) — the ONE residual money hole of the coverage-gated rule: its premium would be dropped
  with nothing carrying it. Caught deterministically by the MANDATORY `assert_balance_identity`
  guard (§1) on every ledger build → `LedgerValuationError`, never shipped. If it ever fires on a
  real account → stop and investigate that account's summary stream; do NOT loosen the tolerance.
- **Pre-coverage-era noise** (Q6): pre-rollout option dailies stay cash-basis — premium swings
  persist there BY DECISION, surfaced via `pre_summary_rollout_option_dailies` →
  `complete_with_warnings` (founder-lp strict mode withholds automatically). The total stays exact.
  A future account whose pre-rollout era overlaps its factsheet window inherits visible-but-flagged
  noise — acceptable; revisit only if such an account appears.
- **Trailing edge**: option trades after the last crawled summary are cash-basis until the next
  summary lands; per-compute values on the most recent day legitimately move between crawls and
  converge on recompute. Not a bug — but reviewers should not mistake the movement for
  nondeterminism.
- **Wedge coverage at a NONZERO anchor**: Task 2b implements the combined
  `options_session_upl + futures_session_upl` read defensively, but the probe account's terminal is
  flat (`session_upl == 0`) so it cannot be live-validated in Task 7. **Live-anchor follow-up**:
  first Deribit options account onboarded with an open book must be watched at the §5 gate; a
  breach there is loud, not silent.
- **Linear (USDC-settled) options**: predicate covers them (endswith `-C`/`-P` wins over the linear
  marker) and their currency is branch-1 (no marks needed); the probe account's USDC book IS the
  covered/linear closure evidence (−97752.858490 target) — but each new linear-options account is
  still watched at the balance-identity/§5 gates. Note the coverage gate is per CURRENCY, so a
  linear book whose history is entirely post-rollout is fully covered even when the same account's
  BTC book has a pre-rollout stub.
- **USD legacy path left as-is**: parity panel diverges for options accounts (documented, D8-style).
  Any residual consumer of `txn_rows_to_daily_records` for options accounts inherits the old bug —
  grep confirms production Deribit routing is native-only (`job_worker.py:2013+`); re-verify at review.
- **Operational recompute**: existing persisted dailies for `c225840c` must be recomputed via a clean
  re-onboard/ledger recompute; the mig-038 `failed_final→failed` status-poisoning caveat applies to the
  retry path — use the fresh-compute path and verify the stored factsheet after.
- **Quiet-day marks for summary-only days**: covered by the dense-marks span automatically, but a
  sparse-delivery coin with options (none known today) would lean on the 80-04 perp-close fill —
  acceptable, already-shipped precedence.

---

## 7. Execution order & gating summary

```
E (evidence — ★COMPLETE, commit the record)
  →  1 (pure core: coverage-gated rule + balance-identity guard, TDD)
  →  2 (adapter: guard wiring + Q6 flag)  →  2b (combined session-uPnL wedge)
  →  3 (E2E + §5)  →  4 (SC-4 pins + acceptance-key eligibility)
  →  5 (harness native basis)  →  6 (docs/pins incl. semantic-shift callout)
→ ship gates: full pytest + SC-4 suite + AST purity
  →  7 (live acceptance: Phoenix spike-collapse + closure targets + verified perp-only keys)
```
Every task lands with its failing-first regression test; no task silently skips a named check
(fail-loud discipline applies to the plan itself). The design questions are CLOSED — if the
executor hits evidence contradicting §1/§2 (e.g. the guard fires on the probe account), that is a
STOP-and-report, not a license to redesign inline.

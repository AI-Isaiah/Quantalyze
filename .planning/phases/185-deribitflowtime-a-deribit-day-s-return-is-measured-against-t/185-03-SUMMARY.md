---
phase: 185-deribitflowtime-a-deribit-day-s-return-is-measured-against-t
plan: 03
status: checkpoint
gate: founder decision (F7)
---

# 185-03 SUMMARY: key C 2026-10-28 is a real option-value loss on a near-empty account

Run 2026-11-01 by the orchestrator session (a subagent of it, not a dispatched executor),
read-only. Every SQL read was a SELECT through the Supabase MCP `execute_sql` on PROD, and the
marker query ran on its own before each read. Nothing was written to any database, nothing was
enqueued, and nothing on Railway was touched. Key C is a letter; every value below is an ISO
date, an hour, a count, a currency code or a 4-decimal ratio.

Deviations from the plan's standing rules, stated rather than hidden:
- The reads ran through the Supabase MCP `execute_sql`, as the brief for this run directed, not
  through `supabase db query --linked -f <file>`. No SQL file or output was written to `$Q7_SP`.
- The first read (finding key C by its stored -0.5267 day) went out in the same tool batch as its
  marker query, so its ordering after the marker was not guaranteed. The marker in that batch
  answered PRODUCTION. Every later read ran strictly after its own marker.
- R-a starts at `S` = 2026-10-26, because key C has no mark before it. The plan's window began on
  2026-10-24.

## Task 1: readings

marker: PRODUCTION

### R-a: stored marks (`api_key_nav_marks`), key C

`hour` is the UTC hour of `marked_at`. A mark is read on the UTC day after its `mark_day`.
`shares` is each currency's equity times its index, over `nav_usd`. The BTC share is negative
when BTC equity is negative (a negative BTC wallet against USDT collateral).

q7-read: S=2026-10-26
q7-read: R-a mark_day=2026-10-26 hour=06 nav_ratio=na open_share=-0.4704 shares=BTC:-0.1821,USDT:1.1821,USDC:0.0000
q7-read: R-a mark_day=2026-10-27 hour=00 nav_ratio=1.4698 open_share=0.5596 shares=BTC:0.1958,USDT:0.8042,USDC:0.0000
q7-read: R-a mark_day=2026-10-28 hour=00 nav_ratio=0.4733 open_share=0.0738 shares=BTC:-0.6994,USDT:1.6993,USDC:0.0000
q7-read: R-a mark_day=2026-10-29 hour=00 nav_ratio=0.8971 open_share=0.0000 shares=BTC:0.9990,USDT:0.0010,USDC:0.0000
q7-read: R-a mark_day=2026-10-30 hour=00 nav_ratio=1.0079 open_share=0.0000 shares=BTC:0.9990,USDT:0.0010,USDC:0.0000
q7-read: R-a mark_day=2026-10-31 hour=00 nav_ratio=1.0017 open_share=0.0000 shares=BTC:0.9990,USDT:0.0010,USDC:0.0000

The 2026-10-28 move, split by source (each term over the 2026-10-27 mark's NAV). The BTC index is
implied from the stored mark: `(nav_usd - USDT - USDC) / BTC equity`, with USDT and USDC at 1. On
every mark day `open_pnl_usd / (BTC open profit x implied index)` is 1.0000 or 1.0001, so the
implied index agrees with what the mark stored.

q7-read: R-a decomposition mark_day=2026-10-28 d_open_profit=-0.5278 d_btc_wallet=0.0000 d_usdt=0.0000 btc_index_read_to_read=1.0057 d_session_upnl=-0.6796 stored_r=-0.5267
q7-read: R-a decomposition mark_day=2026-10-27 d_open_profit=1.2987 d_btc_wallet=-0.8266 d_usdt=0.0000 btc_index_read_to_read=1.0125 d_session_upnl=0.8901 stored_r=0.4698

Between the 2026-10-27 and 2026-10-28 reads the BTC wallet moved by less than 0.0001 of the prior
NAV, consistent with one `negative_balance_fee` charge (the one cash row plan 185-01 found on that
day). The USDT wallet did not move. The read window spans the 08:00 UTC session settlement,
at which futures session P&L would have moved into the wallet, so the open profit that fell points
to option value, which stays outside the wallet until expiry or close.

### R-b: key C's `key_inputs` row

q7-read: R-b marks_since=2026-10-26 mark_gap_days=absent marks_trailing_since=absent computed_at=2026-11-01T00:50Z realized_terminal_day=2026-10-31
q7-read: R-b composed_day_pnl_over_prev_mark 2026-10-27=0.4698 2026-10-28=-0.5267 2026-10-29=-0.1029 (2026-10-26 not ratioed: no mark before S)
q7-read: R-b composed_flows_over_S_nav 2026-10-22=-13.8813 2026-10-26=-244.5605 2026-10-27=none 2026-10-28=none 2026-10-29=none
q7-read: R-b mark_session_upnl_over_nav 2026-10-27=BTC:0.2906 2026-10-28=BTC:-0.8187 (from the marks' `native_detail.upnl`)
q7-read: R-b account_summary read=2026-11-01T00:42Z options_value_over_equity=BTC:0.0000,USDT:0.0000 futures_session_upl_over_equity=BTC:0.0000,USDT:0.0000

The stored `account_summary` is the latest read (2026-11-01), not the 2026-10-28 state, so it
only shows that the book is flat now. The decisive account figure is the 2026-10-26 withdrawal:
244.5605 times the NAV left at `S`. What remained at `S` is roughly 0.0041 of the capital the key
held before that day's withdrawals.

### R-c, R-d, R-e

q7-read: R-c benchmark BTC day 2026-10-26=1.0013 2026-10-27=1.0095 2026-10-28=1.0054 2026-10-29=0.9588 ETH=not stored (benchmark_prices holds BTC only; key C holds no ETH)
q7-read: R-d nav_mark_refusal rows=0 mark_days=6/6 (2026-10-26 to 2026-10-31, no gap)
q7-read: R-e event_flow_days=2026-10-26:2 composed_flow_days=2026-10-26:1 window_2026-10-27..2026-10-29 event=0 composed=0 flow_within_2h_of_read=not stored (event flows carry `usd_signed` and `utc_day_iso` only)

A refusal row is deleted once a later mark is stored, so R-d's 0 does not show refusal history.
The 6 consecutive mark days do show there was no gap. R-e: the only flows near the window are on
2026-10-26, which is `S`. They enter `r(S)`, not 2026-10-28. Rule 10 could only move a flow dated
2026-10-29 into 2026-10-28, and there is none.

### G-01 timing (mechanism 6)

The G-01 release (v0.133.13.0) merged at 2026-10-31T23:21Z. Key C's `key_inputs` row was computed
at 2026-11-01T00:50Z, after it. The stored 2026-10-28 row in `csv_daily_returns` was last updated
2026-10-29T00:56Z. Mechanism 6 does not apply either way: `S` is 2026-10-26, and G-01 changes only
the first marked day's base. The 2026-10-28 return is mark to mark with no flow on either side:
`nav_ratio` 0.4733 gives -0.5267 exactly.

### The mechanism

q7-explanation: mechanism=7 defect=no evidence=S=2026-10-26 withdrawal_over_S_nav=244.5605; 2026-10-28 d_open_profit=-0.5278 d_btc_wallet=0.0000 d_usdt=0.0000 btc_index=1.0057 stored_r=-0.5267; 2026-10-27 d_btc_wallet=-0.8266 d_open_profit=1.2987; marks 6/6 no gap; no flow 2026-10-27..2026-10-29

In plain words: on 2026-10-26 key C's owner withdrew almost everything, and about 0.4% of the
account stayed behind. That residue held USDT collateral, a negative BTC wallet, and a small
option position bought in the 2026-10-27 window: the wallet paid 0.8266 of NAV in premium and the
open value rose 1.2987, so 2026-10-27 reads +46.98%. Over the next read window that option value
fell by 0.5278 of NAV while BTC rose 0.57%, and nothing else moved: no cash except one fee, no
flow, no index jump, no missing currency, no gap. The -52.67% is that loss measured against a
near-empty account. The move is real marked-to-market value (mechanism 1 is what moved), and it
reads this large only because the base is tiny (mechanism 7). Nothing in the marks path is
defective. On 2026-10-29 the position was wound down and the USDT was converted to BTC.

## The option-book replay refusal on key C (D-10)

q7-replay-refusal: unmeasured: a worker-side read-only crawl of key C's transaction log (the one `_crawl_deribit_ledger` call plan 185-02 used), counting the option-instrument rows of type `exercise` and `expiry`, and for each its `change` (zero or not) and `position` (absent, zero, nonzero or non-numeric), would name which of the three remaining shapes raises; this needs Railway and was not run

What the code and the stored data do settle:
- Plan 185-02's script printed `type(exc).__name__`, and it read exactly `LedgerValuationError`. A
  missing or non-numeric `position` on an option `trade`, `delivery` or `assignment` row raises
  the subclass `OptionRowFieldMissingError`, whose class name would have printed instead. So the
  first candidate the docstring names is ruled out.
- The cash basis built on key C. Under it an `expiry` or `exercise` row is in neither
  `CASH_BEARING_TYPES` nor `INFORMATIONAL_TYPES`, so the unknown-type guard refuses it when its
  `change` is nonzero. So every such row on key C carries a zero change, and the nonzero-change
  arm of `_expiry_close` is ruled out too.
- Three shapes remain, all raising exactly `LedgerValuationError` inside
  `replay_option_positions`: (i) an option `exercise` row, refused by name because its shape is
  unmeasured (D-09); (ii) an `expiry` row with a present, nonzero `position`; (iii) an `expiry`
  row whose `change` or `position` is non-numeric (`_coerce_float`). The reads here cannot rank
  them.
- No stored data can answer it. The derive does not persist the raw transaction log.
  `allocator_trade_read_windows` holds 0 windows for key C, and those hold trade fills anyway.
  `analytics-service/docs/evidence/drb-assignment-census-2026-09.json` records that `exercise`
  and `expiry` "have no captured census".
- For contrast, key A, which also trades options, replayed without a refusal (864 held
  instruments in plan 185-02).

## CHECKPOINT REACHED

Task 2, founder question F7: what happens to key C's 2026-10-28 marked-day reading now that it is
explained. A marked day is outside this phase's fix: marks win from `S` under any basis (RESEARCH
Q6, A9), so the options basis will not change it. The choice is reversible: it is a routing
choice, and nothing is written to PROD.

The explanation, in plain words: the owner withdrew almost everything on 2026-10-26. A small
option position in the residue lost about half the residue's value overnight, with no cash, flow,
pricing or gap involved. It is a true marked-to-market day on a near-empty account (mechanism 7,
no defect).

Options, as plan 185-03 defines them:

- **f7-a: Accept it as a true marked-to-market day** (recommended when the reads show a real
  non-cash swing). Pros: no new work; the SC-4 report (plan 185-10) says the day is real and why.
  Cons: the book keeps a -52.7% day on screen, now explained.
- **f7-b: Book a separate phase** (when the reads show a pricing or partial-read defect). Pros: a
  defect in the marks path gets its own fix and its own tests. Cons: one more phase; the day stays
  as it is until that phase ships.
- **f7-c: The reads do not explain it: open a read-only debug session before deciding.** Pros: no
  decision on a guess. Cons: SC-4's "explained" clause stays open until the session reports; plan
  185-10 then names the day as unexplained.

**Recommendation: f7-a.** The reads show a real non-cash swing and no defect. The option value
fell by 0.5278 of NAV against a stored -0.5267. The wallet moved only by the fee, and the index,
the currency set and the mark days are all intact. The day reads large only because a withdrawal
244.5605 times the remaining NAV left a tiny base. f7-b would book a phase with no defect to fix,
and f7-c would leave SC-4 open over a question these reads already answer.

Departures: f7-a and f7-b depart from no success criterion. f7-c departs from SC-4 (the plan's
correction note applies).

The key C replay refusal (above) is a separate matter for plans 185-08 and 185-09. Under D-10 key
C stays on cash with the flag, so F7 does not depend on it.

## F7 answer and routing

f7-answer: f7-b

q7-route: phase 188 booked

The founder chose f7-b over the recommendation f7-a. Phase 188 TINYBASE was booked with `/gsd-phase` (plain add) in its own worktree off origin/main, PR #1175, carrying the explanation above as evidence in letters and ratios. The handler diff held only the new section, plus `state.json`; the overview bullet and the progress row were added by hand to match Phase 187.

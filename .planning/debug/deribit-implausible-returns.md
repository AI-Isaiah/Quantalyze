---
status: diagnosed
trigger: "Implausible return series on a Deribit key: days with |r|>50% (07-13 +333%, 08-04 +529%) where pnl/level_prev uses end-of-day flows. Investigation only, find root cause, no fix."
created: 2026-11-01T00:00:00Z
updated: 2026-11-01T00:00:00Z
goal: find_root_cause_only
---

## Current Focus

hypothesis: (ROUND 2) The TWR base is the overnight cash wallet, and on these Deribit keys it is far below the capital at work. Mechanism A: intraday same-currency in/out flows netted per day and booked at end of day. Mechanism B: open option value excluded from the wallet. Decide with R8-R10, then R11 (raw-log re-crawl). ROUND 1 (lineage): The extreme days are produced by the Deribit cash_settlement basis, which is the only basis a key-mode (allocator book) derive ever runs. The level the returns divide by is the cash WALLET. It excludes the open option book's mark value. An option's premium is booked as a loss on the day it is bought and its payout as a gain on the day it closes, so the payout gets measured against a wallet the premium has already shrunk. The day-level end-of-day flow rule then produces exactly pnl/level_prev. Flow timing is not the cause of the 07-13 and 08-04 days.
test: The orchestrator runs the PROD reads in the Resolution section: option evidence, the MTM-vs-cash series where a strategy-mode twin exists, event-time vs composed flows, and the cumulative split.
expecting: If true, the key's live account summary or its nav marks show a non-zero option value. Any strategy-mode MTM series for the same account shows moderate returns on the 11 days. Event-time over composed flow stays near 1.0. If an MTM twin also shows +300% days, hypothesis (e) "real" wins.
next_action: orchestrator runs scratchpad/dbg/r11.py in the worker container, then books the fix phase if A is confirmed
bug_class: Bohrbug (deterministic accounting-basis choice)
reasoning_checkpoint:
  hypothesis: "Cash-basis option accounting with a wallet denominator (deribit_ingest.py:2939-2944 wedge = equity - balance, so the rolled terminal and every historical level is the cash wallet; deribit_txn.py:1176 DEFAULT_PNL_BASIS = cash_settlement; job_worker.py:5547 and :5718 gate the MTM and smoothed passes on `not is_key_mode`), combined with the D-07 day-level rule at nav_twr.py:822."
  confirming_evidence:
    - "Signature: each giant gain follows a giant loss on a no-flow day (07-11 -48.4% then 07-13 +333.6%; 08-03 -78.3% then 08-04 +529.3%). This is the shape of a long option bought (premium leaves the wallet) and closed or delivered (payout returns)."
    - "Local repro with the repo's own chain_linked_twr (scratch sim.py): a wallet of 0.311 -> 0.1605 -> 0.165 -> 0.528 with a -0.1871 withdrawal gives -48.4%, +2.8%, +333.4%, which is the PROD row to the third decimal. The same days measured with a hypothetical option mark value added to the level give 0%, +17.4%, +95.9%, and the cumulative over the span is identical (+129.9%). The flag flow_timing_day_level_large fires on the cash run only."
    - "The 07-13 and 08-04 withdrawals exceed the prior wallet (1.134x, 1.124x), so the withdrawal can only have been funded by that day's payout. The P&L came first and the withdrawal after, so end-of-day is the right ordering on those days."
    - "NAVMTM Q2 offset (from the brief): this key's offsets drift on every pre-mark day while the sibling keys stay constant. That fits a key whose wallet-vs-NAV gap (the open option book) changes daily."
  falsification_test: "R2: an MTM or smoothed_mtm series for the same Deribit account (strategy mode) that still shows |r| > 100% on 07-13 or 08-04 would falsify it. So would R1 showing no option value ever and no option-book evidence."
  blind_spots: "No raw transaction-log store exists (deribit_txn.py comment block; the ledger_digest is only a count, max timestamp and sha), so the row types on those days cannot be read from PROD. The option evidence is indirect (today's account summary or nav marks, or a strategy-mode MTM twin). The +353838% cumulative is NOT explained by this mechanism alone: cash basis telescopes across a flow-free round trip. Cumulative distortion arises only where a flow lands while the option book is open (V != 0 on a flow day). R4 splits it."
  candidate_causes:
    - "accounting basis: cash_settlement wallet denominator for an options book (c) - LEADING"
    - "flow timing: end-of-day flows (a) - ELIMINATED for 07-13/08-04; a minor contributor on 07-02 (deposit plus premium the same day)"
    - "pricing instant of coin flows vs P&L (b) - ELIMINATED as primary (self-consistent day mark); R3 measures the residue"
    - "UTC day-boundary mismatch (d) - ELIMINATED for 2025 (one shared _row_utc_day helper; Phase 177 flow moves apply only post-mark)"
    - "transfers inside pnl - ELIMINATED by code (type allow-list, unknown types fail loud)"
    - "real (e) - OPEN until R2"
  and_gate: "The daily extremes need only (c). The cumulative +353838% may need (c) plus flows landing while the book is open, or it may be real. R4 decides."
tdd_checkpoint: null

## Symptoms

expected: A Deribit key's daily returns reflect the account's equity change, so no +333% or +529% days unless the account really did that.
actual: The allocator book `equity_curve` (897 returns from 2023-06-28) shows a cumulative +353838%, 2025 at +100658%, a best day of +529% and a worst of -78%. All 6 days with |r| > 50% come from one Deribit key, and the book return equals that key's csv_daily_returns on each. Every return equals pnl/level_prev, with flows at end of day.
errors: none. Every day passes the guards (pnl_dominated_guard fires at |r| >= 10).
reproduction: The stored key_inputs writer chain, rolled backwards from realized_terminal_usd, reproduces every return.
started: The ledger history (2025-07 / 2025-08 days); the same pattern shows under a second login of the same account in another book.

## Eliminated

- hypothesis: (a) intraday flow timing inflates 07-13 and 08-04  [RETRACTED 2026-11-01 round 2: NOT eliminated, see Evidence round 2]
  evidence: (retracted reasoning, kept as lineage) On both days the flow is a WITHDRAWAL larger than the prior wallet (1.134x, 1.124x) and there is no deposit. It can only be funded by the day's own P&L, so P&L preceded it and end-of-day is the correct ordering. A Modified-Dietz or start-of-day rule would make these days WORSE (the withdrawal shrinks the denominator towards zero or below). Only 07-02 (deposit +0.361x and loss -0.477x the same day) is plausibly affected by timing.
  timestamp: 2026-11-01
- hypothesis: (b) coin P&L and flows priced at different instants
  evidence: native_nav._value_over_calendar values level and flow with the SAME day mark per currency (NAV = sum B_c x m_c, F = sum q_c x m_c; the composed flows are exactly these). So pnl_usd = B_{t-1}(m_t - m_{t-1}) + p_t m_t. The only cross-instant term is revaluation of the prior coin balance, a few percent per day, not 3-5x the wallet. R3 measures event-time vs composed flows.
  timestamp: 2026-11-01
- hypothesis: (d) UTC day-boundary mismatch between the transfer log and the P&L ledger
  evidence: Flows and P&L both bucket through deribit_txn._row_utc_day (nav_twr imports the same helper, "Pitfall #11"). The Phase 177 flow-move (marks place a flow by its instant) acts only on marked days (2026-10 onward), never 2025.
  timestamp: 2026-11-01
- hypothesis: transfers booked as P&L
  evidence: native pnl sums `change` only over CASH_BEARING_TYPES (trade, settlement, delivery, liquidation, negative_balance_fee, assignment) plus swap, plus corrections whose reason passes the capital denylist. transfer, deposit, withdrawal and usdc_reward are flows only (deribit_txn.py:563-605, :743). An unknown type with a non-zero change fails loud. A spot BTC_USDC conversion keeps both legs in pnl and nets to about 0 USD (residue = qty x (day mark - fill price)).
  timestamp: 2026-11-01

## Evidence

- timestamp: 2026-11-01
  checked: nav_twr.chain_linked_twr (origin/main 8c8edc452), the day-level arm
  found: "r_t = (NAV_t - NAV_{t-1} - F_t) / NAV_{t-1} at nav_twr.py:822, the flow at end of day. Deribit gets no DayTiming (FLOWTIMING-Q2, nav_twr.py:465-480; native_nav.py:733 passes no timing). D-15 only ANNOTATES a day with |F| >= prev (flow_timing_day_level_large) and never drops it. pnl_dominated_guard needs |r| >= 10."
  implication: This is the rule that produces exactly pnl/level_prev with end-of-day flows.
- timestamp: 2026-11-01
  checked: Deribit NAV path basis (deribit_txn.py:1170-1176, deribit_ingest.py:2939-2944, :1951-1975, job_worker.py:5547, :5718)
  found: "DEFAULT_PNL_BASIS = cash_settlement: an option trade books its full premium `change` on the trade day and the payout on the delivery or close day. Under cash the terminal wedge is equity - balance, so the rolled level is the cash WALLET, which by Deribit's identity excludes options_value and the futures session P&L. The MTM and smoothed_mtm passes run only when `not is_key_mode`, so an allocator book key is ALWAYS cash-basis."
  implication: For an options account the denominator is the wallet net of premiums paid, not equity.
- timestamp: 2026-11-01
  checked: Local repro with the repo chain_linked_twr (scratchpad sim.py)
  found: "cash run [0, -0.484, +0.028, +3.334], cumulative 1.299, flow_timing_day_level_large on 07-13. Run with the option mark value inside the level [0, 0, +0.174, +0.959], same cumulative 1.299."
  implication: The PROD 07-11..07-13 shape is reproduced exactly by cash-basis option accounting. Daily extremes, vol, Sharpe and best/worst day are distorted. Cumulative is distorted only across flows that land while options are open.

- timestamp: 2026-11-01 (round 2)
  checked: orchestrator PROD reads R1, R2, R4/R7, R5, R6 (marker first)
  found: "R1: key key-A has no open options today (options_value 0 on 14 currencies; 6 marks, 0 with open profit). R2: no strategy on either login, so no MTM twin. R5: BTC moved at most 2.2% a day 2025-07-11..08-05 (07-13 +1.4%, 08-03 +1.5%, 08-04 +0.7%). R6: every |r|>50% day is Deribit (5 keys, 22 days, 3 books). R7: key key-B compounds x27306 in 2026 (x121 without its 17 big days) while book book-1 2026 is x2.07. Key key-C compounds x31 in 96 days of 2025 with 1 big day. Book 2025 is x1007, and x54 without its 11 big days; key-A alone is x48."
  implication: "Option cash-basis alone is NOT established and probably not general. BTC moves of 1-2% rule out ordinary perp leverage for +333%/+529% (that would need 150-350x). Ordinary days compound far too fast as well (x121, x31), so a broad mechanism makes ordinary days large on these keys."
- timestamp: 2026-11-01 (round 2)
  checked: deribit_txn.deribit_dated_external_flows_usd (deribit_txn.py:1427-1545) and deribit_flow_instants (:1546)
  found: "Flows are AGGREGATED per (UTC day, currency) before anything is stored: a same-day deposit and withdrawal in one currency become ONE net number, and composed_flows is net per day. The per-row flow instants are built in memory only (the marks seam) and never persisted. No raw log store exists."
  implication: "My round-1 elimination of (a) for 07-13/08-04 is WRONG. It assumed a net withdrawal larger than the prior wallet meant no deposit that day. A morning deposit or transfer-in, offset by a larger evening withdrawal, is invisible in the stored chain. The day's P&L is then measured against the overnight sliver instead of the capital that earned it. The stored data cannot decide this; only the raw log can."
- timestamp: 2026-11-01 (round 2)
  checked: allocator_equity_compose.portfolio_returns (allocator_equity_compose.py:226-367)
  found: "Book r_t = sum_k E_{k,t-1} r_{k,t} / sum_k E_{k,t-1}, where E is each key's replayed level, the writer's own wallet chain. Since E_{k,t-1} r_{k,t} = pnl_{k,t}, the book return is (total day P&L) / (total prior wallet). The weights are prior levels, not the static anchor weights (_current_equity_weights is only used for the curve)."
  implication: "A key with a tiny wallet barely moves the book, which is why key-B's x27306 is x2.07 at book level. The book has the same defect whenever the book's TOTAL overnight wallet is small against the capital actually at work. That is what happened in 2025, when the other keys sat at or near zero."

- timestamp: 2026-11-01 (round 3)
  checked: orchestrator PROD reads R8, R9, R10, R1b
  found: "Compounding by bucket, quiet days vs flow-adjacent days: key-B 2026 x7.08 vs x3855 (76 flow days, 58 of them outflow days; median prior level 5% of the key's max). key-A 2025 x0.76 vs x64. key-C 2025 x1.07 vs x28.9. R1b: no open options on key-B or key-C. R10: book 2025 growth is dominated by key-A (255 days, x48) and key-C (57 days, x21.5). R9: only 2 to 3 days per key carry both flow signs ACROSS currencies; same-currency netting is invisible to it."
  implication: "Growth sits almost entirely on flow-adjacent days, which points to mechanism A (intraday capital outside the overnight base). Mechanism B is not needed for these keys."
- timestamp: 2026-11-01 (round 3)
  checked: R11 script written (founder approved the re-crawl, verbatim "Re-crawl, then fix (Recommended)")
  found: "scratchpad/dbg/r11.py (session scratchpad, not tracked) compiles and imports offline. A synthetic day (prior 100, deposit 900, then +300 P&L, then a 1100 withdrawal) prints stored/day-level r 3.0 against r_split_at_flows 0.30 and max intraday capital 13x the prior close."
  implication: "Pending the run. A confirms when big days show same_day_in_and_out or an inflow before the first P&L, max_intraday_cap_over_prev_close >> 1, and r_split_at_flows far below stored_r."

## Resolution

root_cause: "ROUND 2 (supersedes round 1): one class, two candidate mechanisms, undecided. The class: the TWR denominator is the OVERNIGHT CASH WALLET (end of the previous UTC day, rolled from the realized terminal), and on these Deribit keys that wallet is far smaller than the capital the day's P&L was earned on. Mechanism A, intraday capital: same-currency deposits or transfers arrive and leave inside the day, are netted per (day, currency) (deribit_txn.py:1427-1545) and booked at end of day (nav_twr.py:822), so they never enter the base. Mechanism B, cash-basis options: the open option book's value is excluded from the wallet. R1 weakens B for today, but it cannot speak for 2025 or for key-B. A deciding read needs the raw log (R11). ROUND 1 text, kept as lineage: LEADING (pending R1/R2): the Deribit key-mode derive measures an options account on the cash_settlement basis. The level the TWR divides by is the cash wallet (premium paid out, option mark value excluded), so a long-option round trip prints as a large loss on the buy day and a large gain on the close day, measured on a premium-shrunk wallet. The day-level end-of-day rule (nav_twr.py:822) then gives exactly pnl/level_prev. Flow timing is not the cause of 07-13 and 08-04."
fix: "not applied (diagnose only). See the report's fix plan."
verification: "pending PROD reads R1-R6"
oracle_type: null
files_changed: []

### Round 2 reads requested (read-only; marker first; :a = book allocator_id, :k = a key id; outputs are ratios, counts and tags)

R8 per-key wallet chain shape by year (run for key-B, key-C, key-A):
  WITH p AS (SELECT payload FROM allocator_equity_derived WHERE allocator_id=:a AND kind='key_inputs:'||:k),
  pn AS (SELECT (e->>'utc_day_iso')::date d, sum((e->>'pnl_usd')::float8) v FROM p, jsonb_array_elements(p.payload->'composed_day_pnl') e GROUP BY 1),
  fl AS (SELECT (e->>'utc_day_iso')::date d, sum((e->>'flow_usd')::float8) v FROM p, jsonb_array_elements(p.payload->'composed_flows') e GROUP BY 1),
  dd AS (SELECT d, coalesce(pn.v,0) pv, coalesce(fl.v,0) fv FROM pn FULL JOIN fl USING (d)),
  lv AS (SELECT d, pv, fv, (SELECT (payload->>'realized_terminal_usd')::float8 FROM p)
           - coalesce(sum(pv+fv) OVER (ORDER BY d DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) lvl FROM dd),
  x AS (SELECT d, pv, fv, lag(lvl) OVER (ORDER BY d) prev, lag(fv) OVER (ORDER BY d) fprev, max(lvl) OVER () mx FROM lv)
  SELECT extract(year FROM d) y,
    count(*) FILTER (WHERE pv<>0) pnl_days, count(*) FILTER (WHERE fv<>0) flow_days,
    count(*) FILTER (WHERE fv<>0 AND abs(fv)>=prev) flow_ge_prev_days,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY prev/mx) FILTER (WHERE pv<>0))::numeric,4) med_prev_share_of_max,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(pv)/prev) FILTER (WHERE pv<>0 AND prev>0))::numeric,4) med_abs_r,
    round((exp(sum(ln(1+pv/prev)) FILTER (WHERE prev>=100 AND fv=0 AND coalesce(fprev,0)=0 AND pv/prev>-1))-1)::numeric,2) cum_quiet_days,
    round((exp(sum(ln(1+pv/prev)) FILTER (WHERE prev>=100 AND (fv<>0 OR coalesce(fprev,0)<>0) AND pv/prev>-1))-1)::numeric,2) cum_flow_adjacent_days,
    (SELECT jsonb_array_length(coalesce(payload->'dropped_day_pnl','[]')) FROM p) dropped_days_total
  FROM x GROUP BY 1 ORDER BY 1;
  Reading: if growth sits in cum_flow_adjacent_days, that points to A. If it sits in cum_quiet_days with a tiny med_prev_share, that points to B, or to a persistent sliver wallet.

R9 cross-currency same-day in/out (the only intraday round trip the stored event-time flows still show), per key:
  WITH p AS (SELECT payload FROM allocator_equity_derived WHERE allocator_id=:a AND kind='key_inputs:'||:k)
  SELECT extract(year FROM (f->>'utc_day_iso')::date) y,
    count(DISTINCT f->>'utc_day_iso') flow_days,
    count(DISTINCT f->>'utc_day_iso') FILTER (WHERE (f->>'usd_signed')::float8 > 0) in_days,
    count(DISTINCT f->>'utc_day_iso') FILTER (WHERE (f->>'usd_signed')::float8 < 0) out_days
  FROM p, jsonb_array_elements(p.payload->'flows') f GROUP BY 1 ORDER BY 1;
  (in_days + out_days > flow_days means days carrying both signs.)

R10 which key drives book book-1's 2025 (dominant key = largest |day P&L| that day):
  WITH b AS (SELECT (e->>'date')::date d, (e->>'r')::float8 r FROM allocator_equity_derived, jsonb_array_elements(payload->'returns') e
             WHERE allocator_id=:a AND kind='equity_curve'),
  kp AS (SELECT substr(kind,12,8) key8, (e->>'utc_day_iso')::date d, (e->>'pnl_usd')::float8 pnl
         FROM allocator_equity_derived, jsonb_array_elements(payload->'composed_day_pnl') e
         WHERE allocator_id=:a AND kind LIKE 'key_inputs:%'),
  dom AS (SELECT DISTINCT ON (d) d, key8 FROM kp WHERE pnl<>0 ORDER BY d, abs(pnl) DESC)
  SELECT coalesce(dom.key8,'none') dominant, count(*) days, count(*) FILTER (WHERE abs(b.r)>0.3) big,
         round((exp(sum(ln(1+b.r)) FILTER (WHERE abs(b.r)<=0.3))-1)::numeric,2) cum_excl_big
  FROM b LEFT JOIN dom USING (d) WHERE b.d BETWEEN '2025-01-01' AND '2025-12-31' GROUP BY 1 ORDER BY days DESC;

R1b option evidence for key-B and key-C: the R1 queries with :k swapped.

R11 (decisive, NOT a SQL read; needs a founder go): a read-only re-crawl of the transaction log for key-A (2025-07-01..08-05) and key-B (2026 big days), counts and ratios only. Per day: flow rows by sign and currency with their instants; the cash-bearing rows by type (trade on option/perp/future/spot, settlement, delivery); and the row-embedded `balance` path. The output is, per day, the max intraday balance over the prior close and the share of the day's P&L booked after a same-day inflow. This is the founder's own instruction ("rebuild those days from the key's trade and transfer history").

### PROD reads requested (read-only; marker query first; replace :allocator_id, :key_id, :sibling_key_id)

R1 option evidence (today's summary, plus nav marks):
  SELECT s->>'currency' ccy, (s ? 'options_value') has_field, coalesce((s->>'options_value')::numeric,0) <> 0 open_options
  FROM allocator_equity_derived d, jsonb_array_elements(d.payload->'account_summary'->'summaries') s
  WHERE d.allocator_id = :allocator_id AND d.kind = 'key_inputs:' || :key_id;
  SELECT count(*) marks, count(*) FILTER (WHERE open_pnl_usd <> 0) marks_with_open_profit,
         round(max(abs(open_pnl_usd)/NULLIF(nav_usd,0))::numeric,3) max_open_share
  FROM api_key_nav_marks WHERE api_key_id = :key_id;

R2 MTM twin, if any strategy sits on either login:
  WITH s AS (SELECT id FROM strategies WHERE api_key_id IN (:key_id, :sibling_key_id))
  SELECT ss.kind, (r->>'date') d, round((r->>'return')::numeric,3) basis_r,
         round(c.daily_return::numeric,3) cash_r
  FROM strategy_analytics_series ss JOIN s ON s.id = ss.strategy_id
  CROSS JOIN LATERAL jsonb_array_elements(ss.payload->'rows') r
  LEFT JOIN csv_daily_returns c ON c.strategy_id = ss.strategy_id AND c.date = (r->>'date')::date
  WHERE ss.kind IN ('mtm_daily_returns','smoothed_mtm_daily_returns')
    AND (r->>'date') IN ('2025-04-22','2025-07-01','2025-07-02','2025-07-11','2025-07-12','2025-07-13','2025-07-14','2025-07-16','2025-08-03','2025-08-04','2025-08-05')
  ORDER BY 1,2;
  (plus: SELECT kind, count(*) FROM strategy_analytics_series WHERE strategy_id IN (SELECT id FROM strategies WHERE api_key_id IN (:key_id,:sibling_key_id)) GROUP BY 1;)

R3 event-time vs composed flows (hypothesis b):
  WITH p AS (SELECT payload FROM allocator_equity_derived WHERE allocator_id=:allocator_id AND kind='key_inputs:'||:key_id),
  ev AS (SELECT f->>'utc_day_iso' d, sum((f->>'usd_signed')::float8) v FROM p, jsonb_array_elements(p.payload->'flows') f GROUP BY 1),
  co AS (SELECT f->>'utc_day_iso' d, sum((f->>'flow_usd')::float8) v FROM p, jsonb_array_elements(p.payload->'composed_flows') f GROUP BY 1)
  SELECT d, round((ev.v/NULLIF(co.v,0))::numeric,4) event_over_composed
  FROM co FULL JOIN ev USING (d) WHERE d BETWEEN '2025-04-15' AND '2025-08-10' ORDER BY d;

R4 cumulative split (does the 11-day set explain the cumulative?):
  SELECT extract(year FROM date) y, count(*) n, count(*) FILTER (WHERE abs(daily_return) > 0.3) n_big,
         round((exp(sum(ln(1+daily_return)))-1)::numeric,2) cum_all,
         round((exp(sum(ln(1+daily_return)) FILTER (WHERE abs(daily_return) <= 0.3))-1)::numeric,2) cum_excl_big
  FROM csv_daily_returns WHERE api_key_id = :key_id AND allocator_id = :allocator_id GROUP BY 1 ORDER BY 1;

R5 market move on those days (public prices):
  SELECT symbol, date, round((close_price / lag(close_price) OVER (PARTITION BY symbol ORDER BY date) - 1)::numeric,4) day_move
  FROM benchmark_prices WHERE symbol ILIKE ANY (ARRAY['%BTC%','%ETH%']) AND date BETWEEN '2025-06-30' AND '2025-08-06' ORDER BY 1,2;

R6 blast radius (Deribit keys with extreme days):
  SELECT k.exchange, count(DISTINCT c.api_key_id) keys, count(*) days_abs_gt_50pct
  FROM csv_daily_returns c JOIN api_keys k ON k.id = c.api_key_id
  WHERE c.api_key_id IS NOT NULL AND abs(c.daily_return) > 0.5 GROUP BY 1;
  SELECT count(*) deribit_keys_open_options
  FROM allocator_equity_derived d, jsonb_array_elements(d.payload->'account_summary'->'summaries') s
  WHERE d.kind LIKE 'key_inputs:%' AND d.payload->>'venue' = 'deribit' AND coalesce((s->>'options_value')::numeric,0) <> 0;

## R11 result (2026-11-01 ~14:50Z, backfill worker, start-command swap approved by the founder; restored at 14:54Z)
- Keys found 2/2. key-A: 36 days (2025-07-01..08-05); key-B: 31 days (2026 |r|>0.3 days plus the day before).
- Consistency: r_daylevel_check equals stored_r on every day; rows_pnl_over_stored_pnl ~1 on the big days.
- Mechanism A (intraday capital) is NOT the cause: on every big day r_split_at_flows == stored_r and same_day_in_and_out=False, except key-A 2025-08-04 (stored 5.29, split 3.93, capital-weighted 2.31; in USDC + out SOL the same day).
- Mechanism B (cash-basis options) is: the big days are option trade/delivery rows against the cash wallet. key-A 2025-08-03 -78%: 3 option trades, no flow; 2025-08-04 +529%: 17 option trades; 2025-07-13 +334%: 99 inverse-perp trades + 6 option trades; key-B 2026-02-28 +169%: 1840 option trades.
- Oddity: key-B 2026-10-28 (a marked day) stored -52.7% with one negative_balance_fee row and rows_pnl 0.
- Verdict: B (with A only partly on one day).

# Phase 177: DERIBITFLOWS — Deribit flow instants are valued at the mark day's close - Context

**Gathered:** 2026-10-28
**Status:** Ready for planning

<domain>
## Phase Boundary

A Deribit deposit or withdrawal that `apply_marks` rule 10 moves into mark day D (made after 00:00Z on D+1 and at or before the mark's read) is valued at Deribit's index at the flow's own moment, read from Deribit's public market data, instead of the ledger mark of its own day D+1. The derive logs how many Deribit flows it moved. `analytics-service` plus one migration for the stored at-instant prices (D-05); no cron, no UI.

Out of scope: the legacy chain's cron and runbook files (MARKSOURCE plans 08 and 14 own them; Phase 176 LEGACYRETIRE is held), non-moved Deribit flows (they keep `flowqty x same-day mark`, NAVMTM D-23), MT5 (fixed by MARKSOURCE plan 03).

</domain>

<decisions>
## Implementation Decisions

### Decision index (one line each; the verbatim founder records follow below)
- **D-01:** SC-1 is measured as the recorded SQL upper bound plus one counts-only derive log line of the Deribit flows moved by marks.
- **D-02:** A moved Deribit flow is priced at the price at the flow's own moment, fetched from Deribit (founder "Fetch index at flow time"), never at its own day's ledger mark.
- **D-03:** The fix ships whatever the count, with a test that is RED on own-day pricing.
- **D-04:** The price is the open of the {CCY}_USDC-PERPETUAL 1-minute candle that contains the flow.
- **D-05:** No fallback on a failed read (structural no-data refuses as `mark_flow_index_unavailable`, transient retries, 429 reaches `_stamp_429`), and each resolved price is stored once in a service-role-only table with cascade erasure and reused by later derives.

### Carried (not re-asked)
- MARKSOURCE 167.2.1.1.1.1 plan 03: `FlowInstant.amount_prior_day` (the amount counted in the mark day) and `MarkedSeries.flow_moves_out` (the stored amount that leaves the read day); both `job_worker` stored-flow consumers apply `+in` on the mark day and `-out` on the next day. For a flow with `amount_prior_day = None`, in == out.
- MARKSOURCE RESEARCH A5 / plan 03 SUMMARY: Deribit's `native_flow_instants` values an instant at the mark of its own day; same shape as the MT5 case; left unchanged there, "measure-then-book".
- NAVMTM: the stored Deribit mark prices each currency at Deribit's own index read at `marked_at` (`DERIBIT_USD_BASIS = "venue_index_at_marked_at"`, `price_day` NULL). The per-currency index at `marked_at` is not stored.
- Founder 2026-10-27 "Deribit moved-flow pricing (Recommended)" booked this phase.

### D-01 SC-1 measurement
Founder 2026-10-28, AskUserQuestion: "Upper bound + derive log (Recommended)". Record the SQL upper bound now, and add one counts-only log line in the derive saying how many Deribit flows it moved, so the next nights give the real count.

SC-1 upper bound, measured on PROD 2026-10-28 (marker named PRODUCTION; counts only): deribit_marks=16, deribit_keys_with_marks=8, first_mark_day=2026-10-26, last_mark_day=2026-10-27, max_read_after_midnight=06:41:58, median_read_after_midnight_s=12366 (about 3.4 h). Both mark days were read on the old 04:30Z chain. NAVMTM moved the chain to 00:10Z from mark day 2026-10-27 on, where Deribit marks land roughly 00:40–01:21Z.

Why SQL gives only an upper bound: PROD stores no per-flow Deribit data. `api_key_nav_marks` holds the marks and `marked_at`; the `key_inputs:<key>` rows of `allocator_equity_derived` hold day-summed flows with moves already applied. The exact count needs Deribit's transaction log, which only the derive reads; hence the log line.

### D-02 Moved-flow price
Founder 2026-10-28, AskUserQuestion (first answer): "Flow's own index (Recommended)". Use the Deribit index on the flow's own transaction row, falling back to the ledger's day-D mark when the row has none. Research must confirm that deposit and withdrawal rows carry an index first. If they don't, stop and hand back.

The check came back negative from the repo, not from a live row: Phase 75 RESEARCH, the `deribit_txn.py` docstrings (`inverse_days_needing_index`, `deribit_dated_external_flows_usd`) and `tests/test_deribit_flow_fixtures.py` all state that a Deribit deposit or withdrawal row carries no own `index_price`.

**SUPERSEDED by the revisited answer.** Founder 2026-10-28, AskUserQuestion (D-02 revisited): "Fetch index at flow time", chosen over the recommended "Day-D ledger mark". The option as offered read: "Read Deribit's public 1-minute index or perpetual data at the flow's moment. Most accurate, but adds an exchange read to every derive that moves a flow, with its own retry and refusal handling. Larger scope."

Constraints that come with it (coordinator brief, 2026-10-28):
- Research pins down the exact public Deribit endpoint and resolution that give the index at an instant, its rate limits, and what happens when that read fails.
- A failed read is a named refusal or retry in the house vocabulary, never a silent fallback that writes a wrong number. Whether a fallback to the day-D mark is acceptable on failure is a further founder decision, raised as a gray area with a recommendation (open).
- New venue-read code goes through the existing exchange client patterns and keeps the 429 and cooldown handling (`_stamp_429`).

### D-03 Zero count
Founder 2026-10-28, AskUserQuestion: "Fix anyway (Recommended)". Ship the fix with a test that is RED on own-day pricing. This widens SC-2's wording, so record that in the ROADMAP too.

### D-04 Price source (founder 2026-10-28, after research)
Founder 2026-10-28, AskUserQuestion: "Perpetual 1-min candle (Recommended)". Price = the open of the {CCY}_USDC-PERPETUAL 1-minute candle that contains the flow (public `get_tradingview_chart_data`, `resolution=1`). Rewrite the ROADMAP goal and SC-2 to name this source. Basis: the literal Deribit index is served at 1-minute steps only for the last 48 h (probe 2026-10-28, RESEARCH "Public probe"), while 1-minute perpetual candles were served back at least 730 days.

### D-05 Read failure and stored prices (founder 2026-10-28, after research)
Founder 2026-10-28, AskUserQuestion: "Refuse + store prices", chosen over the recommended "Refuse by name". The option as offered read: "No fallback, plus store each resolved price once so old flows are never re-read. Larger scope; could be a follow-up phase." The founder chose it for THIS phase, so it is in scope; it is not booked as a follow-up.
- No fallback: a structural no-data read refuses as `mark_flow_index_unavailable`; a transient read retries; a 429 re-raises to `_stamp_429`.
- Each resolved price is stored once and reused on later derives, so the source never needs to be re-read for an old flow.
- Storing needs a migration. It must have: service-role-only access (RLS forced, no anon/authenticated grants) unless research shows a UI reads it; an erasure path (ON DELETE CASCADE from api_keys, or a justified reason it holds no personal data); migration-reviewer and rls-policy-auditor clean before merge; a CREATE OR REPLACE re-base on the latest definition of anything it touches.
- PROD auto-applies after TEST.
- The planner decides the shape: key, currency, minute, price and source.

### Store scope (founder 2026-10-28, after build)
Founder 2026-10-28, AskUserQuestion ("177 store"): "Keep as built (Recommended)". The option as offered read: "Not part of the data-export (Art. 15) file, since it's public market prices keyed to the account. No retention limit. A currency with no USDC perpetual at all refuses permanently, which is fine because BTC, ETH, SOL and XRP all have one."

### Claude's Discretion
- Where the at-instant index is attached to the moved instant (`deribit_flow_instants` / `native_flow_instants` / the derive), the log line's exact wording and level, provided it carries counts only (no key ids, no amounts tied to an account).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `services/external_flows.py` `FlowInstant(at_ms, day, amount, currency="USD", amount_prior_day=None)`.
- `services/nav_marks_apply.py` `apply_marks` rule 10: counts `amount_prior_day` (else `amount`) in `md`, removes `amount` from `md + 1`, reports `flow_moves` / `flow_moves_out`.
- `services/deribit_txn.py` `deribit_flow_instants(rows)`: one instant per external-flow row with nonzero `change`, `amount` = native change, `currency` uppercase. Does not read `index_price` today.
- `services/deribit_txn.py` `_day_ccy_own_index`: end-of-day own-row `index_price` per (day, ccy), guarded coercion of untrusted `index_price`.
- `services/native_nav.py` `native_flow_instants(ledger, indexable_currencies=...)`: `fi.amount * ledger.marks[ccy][fi.day]` for INDEXED, USD family at 1.0.

### Established Patterns
- Ledger day mark for Deribit (`deribit_ingest._build_dense_native_marks`): own-row end-of-day index, else 08:00Z delivery price, else `{ccy}_USDC-PERPETUAL` daily close.
- Tests: `tests/test_nav_marks_flow_instants.py`, `tests/test_nav_marks_compose_roundtrip.py` (`test_moved_btc_flow_priced_at_the_mark_day_close` is the MT5 oracle to mirror, hand-typed arithmetic).

### Integration Points
- `services/job_worker.py`: `native_flow_instants` is called in the key-mode writer-basis branch, the allocated-capital twin branch, the strategy-mode Deribit branch, and the stitch-composite member paths (around lines 7663, 7715, 7732, 10168, 10328 at b2daab890). The flow-move consumer block (`_applied_marks.flow_moves`) and the `nav marks applied` log line are where a moved-flow count can be logged.

</code_context>

<specifics>
## Specific Ideas

- The RED test mirrors MARKSOURCE plan 03's MT5 oracle: a Deribit BTC deposit at 00:05Z on D+1 inside mark D, at-instant index typed by hand (from a mocked public read), ledger marks for D and D+1 different, expected `r_D` hand-computed with the flow at its at-instant index; the old code (own-day mark) must fail it.
- A second case: the at-instant read fails; behaviour per the open fallback decision (named refusal unless the founder accepts a day-D fallback).

</specifics>

<deferred>
## Deferred Ideas

- Reading the real moved-flow count off the new log line after the next nightly derives (orchestrator, post-land).
- The literal Deribit index for flows under 48 h old (not chosen; D-04).

</deferred>

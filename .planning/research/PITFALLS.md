# Pitfalls Research

**Domain:** Proving MT5/forex performance against the terminal and the broker statement, and adding an external-oracle parity harness to the Quantalyze MT5 pipeline (v1.18 MT5-VERIFY, Phases 155 and 157)
**Researched:** 2026-11-13
**Confidence:** HIGH for the repo-specific pitfalls (read from source at HEAD and cited by symbol). LOW for the broker and terminal behaviour taken from web sources: the confidence seam returns LOW for every web provider, verified or not. Each LOW claim is marked and paired with a way to measure it live. Mechanisms marked *inferred from source* were reasoned from the code, not reproduced. No PROD census was taken in this research run, so every PROD-state claim below is phrased as something to measure.

**Accounts:** MM2, MM3, FX-AI_V (labels only; this file is tracked in a public repo).

**How to read the phase column.** No v1.18 roadmap exists yet, so pitfalls map to a requirement ID plus a functional stage of reserved Phase 155 (or 157):

| Stage | What it is | Who |
|---|---|---|
| **S0 Decide** | Fix the compared quantity, the window and the oracle source before building anything | founder decision, agent proposal |
| **S1 Harness pre-build** | Build the harness, run every agent-checkable check, produce the founder script | agent, before gate 2 |
| **S2 Founder session** | One scripted terminal session on a trading day (gate 2) | founder |
| **S3 Compare and fix** | Diff the oracle against rendered numbers; root-cause fixes, uncapped (MT5-10) | agent |
| **S4 Surface parity** | One series checked on five surfaces (MT5-09) | agent |
| **S5 Warnings audit** | Why every account carries `complete_with_warnings` (MT5-15) | agent; can run first |
| **S6 Timeouts** | Findings #8 and #10, tuned from measured latency | agent |
| **157** | Founder confirmations, including the investor-password rotation | founder |

**Coverage of the requested topics:** DST and server offset (Pitfall 3) · swap, commission and fee (Pitfall 5) · deposits and withdrawals mistaken for returns (Pitfall 6) · open P&L versus closed balance (Pitfall 4) · the window-end trap (Pitfall 2) · statement currency versus account currency (Pitfall 10) · partial `history_deals_get` history (Pitfall 7) · rpyc and gateway timeouts during long reads (Pitfall 9, plus 13 for #8 and #10) · tautological oracles (Pitfall 1).

---

## Critical Pitfalls

### Pitfall 1: The oracle is our own pipeline in disguise (tautological oracle)

**What goes wrong:**
The harness "passes" because both sides of the comparison come from the same inputs or the same arithmetic. Shapes already present in this repo:
- `scripts/mt5_soak.py` `reconcile_parity`: `recon_ok` anchors the forward roll to the account balance (`initial = balance − Σtrading_pnl − Σflows`) and then checks that it reconstructs the balance. Its own docstring calls that leg "an identity over the same primitives". It catches a deal dropped relative to its own totals. It cannot catch a wrong `DEAL_TYPE` meaning, a wrong offset, a double-counted commission (both totals use `deal_cash_effect`) or a mislabelled flow. The v1.15 soak shipped green on this gate with both open items intact (MT5-08 text).
- 136-RESEARCH assumption A3 (the per-broker fold rule: commission as a field versus a separate row) is recorded as "MITIGATED by reconcile-to-equity tolerance gate". That gate is the identity above, so A3 is still `[ASSUMED]` (see Pitfall 5).
- Comparing today's equity. `combine_mt5_deal_ledger` anchors to the live `account_info()` read, so today's level matches by construction (settled fact).
- Building "expected" values by re-running `combine_mt5_deal_ledger`, `derive_basis_series` or `compute_all_metrics` on a deal list fetched through our own gateway. That is the same input and the same code.
- MT5-09 agreement. Five surfaces agreeing proves consistency, not correctness. That is why it is a separate requirement from MT5-07.
- Golden fixtures captured from our own output, then used as the oracle.
- A near-midnight regression test built from a synthetic deal bucketed with our own clock rule (Pitfall 3).

**Why it happens:**
The external number (the terminal) is expensive, available only on a trading day with the founder present, while the internal number is free. Each self-check looks like progress.

**How to avoid:**
- The expected side of every MT5-07 assertion comes from an artefact the pipeline never touched: figures the founder transcribes from the terminal, a statement exported from the terminal (History tab, right-click, All History, then Report as HTML or XLSX), or a broker-issued statement. Record each expected value's provenance as an enum (`terminal_reading`, `terminal_report_export`, `broker_statement`). The harness refuses to compute a verdict when any expected value carries a different provenance.
- The founder reads values cold, from a script that shows none of our numbers. The harness compares afterwards. A form pre-filled with our numbers invites confirmation bias.
- Keep `mt5_soak.py` as an internal fidelity check, labelled as such. Never cite it as MT5-07 evidence.
- Adversarial test of the harness itself (repo rule: gates must be able to fail). Neuter one input against the real oracle readings: re-classify one BALANCE deal as trading, shift the clock by one hour, or drop the oldest deal. Show the harness goes RED. Restore from a byte backup.

**Warning signs:**
A harness whose expected values can be regenerated without the founder. A pass on the first run with zero residual on every account. A diff of exactly 0.000000.

**Phase to address:** S0 (oracle provenance decided), S1 (harness enforces provenance and carries a self-RED test), S3. Requirement MT5-07.

---

### Pitfall 2: The window-end trap. The comparison that can fail is the window start and the in-window return, not the end level

**What goes wrong:**
`reconstruct_nav_and_twr` sets the terminal realized NAV to `anchor_nav − open_unrealized_usd`, which is the live balance at the derive's read (the `terminal_nav = anchor_nav - open_unrealized_usd` docstring in `nav_twr.py`). Every earlier level is that balance rolled backward through each later day's P&L and flows. So:
- A window ending yesterday has an end level only one day of deals away from the anchor. It is nearly tautological even though it "ends before the run day".
- An error anywhere between a day and today (a missed deal, a misclassified flow, a truncated ledger) shifts that day's level and every earlier level. Error accrues backward and is largest at the window start.
- A 1% tolerance on the NAV level is loose for a low-return strategy. A level within 1% can hide a cumulative-return error of 20% or more when the window's return is about 5%.

**Why it happens:**
"Ends before the run day" is necessary but not sufficient. How close the end sits to the anchor matters, and so does which quantity carries the 1%.

**How to avoid (recommendation; the settled 1% and "ends before the run day" stand as written):**
- S0 states the compared quantity in writing. Recommended: (a) the cumulative return over the window, start to end; (b) the start level; (c) the end level. Each is compared against the oracle, with the 1% kept as one named test constant (settled 2026-08-14). Record whether 1% means relative error of the return or of the level. Different readings of "1%" are a real ambiguity, so the founder should decide it rather than the planner.
- Place the window end several trading days before the run day, so the backward path from the anchor crosses real deals. Place the start far enough back to include at least one deposit or withdrawal, one month-end, one triple-swap Wednesday, and the 2026-11-01 US DST change (the configured rule; see Pitfall 3).
- **Put both boundaries on a weekend (recommendation).** Spot forex is closed from about Friday 21:00/22:00 UTC to Sunday 21:00/22:00 UTC. At a Saturday boundary no deals happen, open-position prices are frozen, and the server-day versus UTC-day mismatch cannot move a deal across the boundary. "Equity including open P&L" is then the same number from Friday's close to the Sunday open. Check first that no account trades crypto CFDs, which many brokers quote through the weekend (LOW, broker-specific).

**Warning signs:**
Errors that grow with distance from the run day. An end-level residual of about 0 while the start-level residual is not. A pass that depends on which day is the end.

**Phase to address:** S0 (quantity and window), S1 (the harness computes all three legs), S2 (the founder script reads the boundary values). MT5-07, MT5-08.

---

### Pitfall 3: One clock for three accounts, and no live server-time read the pipeline is allowed to make

**What goes wrong:**
- `resolve_mt5_server_clock` reads ONE worker-wide setting. Production has run `MT5_SERVER_TIME_RULE=us` on both worker services since 2026-11-03 (`175-06-SUMMARY.md`). The rule came from the founder's terminal clock readings (+3 h on 2026-10-27, +2 h on 2026-11-02, CHANGELOG). The switch was checked by ONE key's first derive, and the summary leaves the live server-clock check to Phase 155 / MT5-06. Which accounts or servers those clock readings covered is not recorded. Nobody has measured whether MM2, MM3 and FX-AI_V share one broker server or one DST rule. An account on an `eu`-rule server, a no-DST server or a different offset is silently mis-bucketed around UTC midnight.
- No gateway code reads the server clock live. A repo-wide grep finds `TimeTradeServer` only in the MQL5 EA (`tools/mt5/QuantalyzeDailyReturns.mq5`, the CSV/EA route) and `symbol_info_tick` only in a test. That test is a deliberate pin: `test_read_only_surface_no_trade_methods` in `tests/test_mt5_client_contract.py` FORBIDS `symbol_info_tick`, `positions_get`, `history_orders_get` and `copy_rates_from` on `Mt5Client`, and `test_public_surface_is_exactly_the_contract` fails on any new public method. The usual live-offset read (a tick time against UTC) therefore needs that pin re-cut on purpose, with its reasoning updated in the same commit, or a different read.
- The only estimator, `scripts/mt5_spike.py` `_leg4_server_time_offset`, takes the latest deal time minus now. That is offset minus deal age, and it produced the bogus −810 min estimate recorded in `TODOS.md`.
- A wrong offset is invisible to period totals (MT5-06 text). Totals reconcile while the daily series shifts, corrupting Sharpe, max drawdown and every daily risk metric.
- Interaction (needs measurement): the server week opens at Monday 00:00 server time, which is Sunday 21:00 or 22:00 UTC. The first hours of every trading week, and the daily rollover swap charged shortly after server midnight (LOW, broker statement), land on the PREVIOUS UTC day. A forex series therefore has Sunday-UTC activity by construction. Check any code that infers a weekday calendar from the data (for example `metrics._record_covers_window`'s `trades_weekends`) against real MT5 series.

**Why it happens:**
The offset was treated as broker-global configuration, first set from a single soak account in v1.15. The read-only surface pin was written to keep trading methods out and also caught read-only methods.

**How to avoid:**
- MT5-06 harness leg, per account and per server name: during an active session (never on a weekend, when the last tick is Friday's), read a server time for a liquid symbol together with a UTC reference from the same call, round the offset to the nearest 30 minutes, and assert it equals the configured rule's offset at that instant. S1 decides between re-cutting the pin to admit a read-only `symbol_info_tick` wrapper and using another server-time source. Either way the read goes through `Mt5Client` under the lease and passes int epochs, because mt5linux 0.1.9's remote eval has no `datetime` import (`history_deals_get` docstring).
- Group the three accounts by `account_info().server`. If they do not all share one rule, the single env var is the root cause, and the fix is a per-server clock (MT5-10, uncapped). A per-account override bolted on is a band-aid.
- Near-midnight regression from a REAL deal. Pick deals from the live ledger stamped between server 00:00 and 03:00. In S2 the founder reads the date and time the terminal's History shows for those deal tickets. The test asserts our UTC day against the terminal's server date.
- Choose the window to straddle 2026-10-25 to 2026-11-01. In that week an `eu`-rule server is on UTC+2 while a `us`-rule server is still on UTC+3, so the window discriminates between the rules.

**Warning signs:**
`account_info().server` differs across the three keys. The live offset disagrees with `Mt5ServerClock.instant_offset_s(now)`. A deal near UTC midnight whose day differs from the terminal's server date by the wrong amount.

**Phase to address:** S1 (offset probe, pin decision, server census), S2 (founder reads deal timestamps), S3 (per-server clock if needed). MT5-06.

---

### Pitfall 4: Basis mismatch. "Including open P&L" against a series that is realized-basis before the first mark

**What goes wrong:**
- `combine_mt5_deal_ledger` folds CLOSED deals only. Its level path is the closed balance. Open P&L appears only as the `unrealized_pnl_in_anchor` flag when `|equity − balance| / anchor > 5%`.
- NAVMTM marks (`services/nav_marks.py`) replace realized values with marked equity only from a key's FIRST mark day `S` onward. D-09 forbids backfill, and `nav_marks_apply` rule 2 keeps every day before `S` exactly. Marks are written only by a successful derive, and NAVMTM shipped in late October 2026 (v0.133.1.0), so `S` cannot be earlier than that. Where `S` actually falls for each of the three keys is UNMEASURED. The credential history is mixed: the ROADMAP records a password change around 2026-08-14, while `TODOS.md` shows MT5 `last_sync_at` fresh on 2026-08-23 and `175-06-SUMMARY.md` shows a successful MT5 derive on 2026-11-03. The mark census decides it, not this file.
- Result: a window before `S` is realized-basis on our side (closed balance) and equity-basis on the terminal side if the founder reads equity. The residual is the open P&L at each boundary, which can exceed 1% on a leveraged book with open trades. A window straddling `S` is hybrid.
- Mark instants do not match terminal day-ends. A mark is read at our derive (about 01:0x UTC as measured on 2026-11-13; label = UTC date of `marked_at` minus 1, D-03). A server-day close is 21:00 or 22:00 UTC, so forex keeps trading for about 3 hours between the two. A mark labelled day D carries the rollover swap and the early-Asia moves of server day D+1.

**Why it happens:**
The 1% includes open P&L (founder call), but the series' basis changes at a date set by when marks happened to start, not by the window.

**How to avoid:**
- S1 measurement first: first and last `mark_day` per MT5 key from `api_key_nav_marks` (PROD read via MCP, marker query first). Place that date against the candidate window.
- S0 decision, explicit and not silent. If the window lies entirely before `S`, the comparable oracle is the CLOSED BALANCE (exact, from the terminal History or the statement's balance column). "Including open P&L" can then be tested only at instants where both sides observed equity: weekend boundaries with no open positions, or a synchronized founder reading. If the founder wants open P&L inside a historical window, the oracle must be a historical equity source: broker daily statements, if the broker sends them (LOW; check with the founder), or the terminal's Reports equity curve, which the terminal rebuilds from price history (LOW, MT5 help) and so is another model rather than a record.
- At a weekend-boundary instant, require zero open positions, or have the founder script record each position's floating P&L.
- Never compare a marked day against a server-day-close figure without stating the time between the two instants.

**Warning signs:**
The residual is about equal to `equity − balance` at a boundary. Residuals jump at the first mark day. The `unrealized_pnl_in_anchor` flag is set on the account.

**Phase to address:** S0 (basis decision), S1 (mark census), S2 (founder records open positions at boundaries). MT5-07, MT5-08.

---

### Pitfall 5: Swap, commission and fee folded on an unverified rule

**What goes wrong:**
- `deal_cash_effect` sums `profit + swap + commission + fee` once per trading deal. That rule is 136-RESEARCH assumption A3, still `[ASSUMED]` in the `mt5_deals.py` header. The gate cited as mitigating it is the balance identity from Pitfall 1, which cannot see a double count. A broker that posts commission both as a deal field and as a separate commission-family row (types 7 to 11, which `_MT5_TRADING_DEAL_TYPES` folds as trading) double-counts the cost. The same applies to a `fee` that duplicates `commission`.
- Swap accrues on the open position and is realized in the closing deal's `swap` field (LOW, MQL5 book and forum). The realized basis therefore dumps a position's whole swap on its close day, while terminal equity accrues it daily. Partial closes reportedly allocate swap inconsistently (LOW, forum). Triple swap on Wednesday makes one day's accrual three times the usual.
- Entry commission: brokers commonly charge commission on the IN deal (LOW, broker-specific), so the balance falls at the open. A realized-only mental model that expects cost only at close misreads the opening day.
- Swap-free (Islamic) accounts replace swap with an admin fee that brokers post in different ways: a CHARGE row (which fails loud today), a BALANCE row (silently treated as a flow; see Pitfall 6), or a commission-family row (LOW).
- The terminal report shows commission, fee, swap and profit as separate columns per deal (LOW, MT5 help). Its summary "Total Net Profit" may or may not include swap and commission, depending on the definition.

**Why it happens:**
The field layout of a deal row is fixed by MetaQuotes, but which field a broker uses for which cost is the broker's choice. The only verification ever planned for it (136-05) was never executed.

**How to avoid:**
- S1 deal census by type and field: per account, count deals by `type`, and for each trading type the share of rows with non-zero `commission`, `fee` and `swap`. Flag any day carrying both a commission field on BUY/SELL deals and a commission-family row.
- In S2 the founder exports the statement. S3 compares per-day sums of each cost column separately (commission, fee, swap, profit) against our per-day fold, not only the total. A double count shows up as a cost column that is twice the statement's.
- Compare swap at the window level, where accrual and close-day booking net out for positions opened and closed inside the window, and treat positions open across a boundary separately.
- Confirm whether any account is swap-free, and how its fee is posted.

**Warning signs:**
Commission-family rows on the same days as BUY/SELL deals that already carry commission. Per-day cost residuals of about 2× the statement. A residual concentrated on close days of long-held positions.

**Phase to address:** S1 (census), S2 (statement export), S3 (fold-rule fix, which closes A3 for the patterns actually observed). MT5-07, MT5-10.

---

### Pitfall 6: BALANCE deals that are not deposits or withdrawals silently leave the return

**What goes wrong:**
`mt5_deals.classify_deal` maps every `DEAL_TYPE_BALANCE` (2) deal to `external_flow`, regardless of comment, and so removes it from the return numerator. Brokers also post non-capital items as balance operations. One broker family (VT Markets) documents index-CFD dividend adjustments as "a balance statement directly to your trading account" with comment `Div & <product> & <volume>` (LOW). The same is plausible for rebates, inactivity fees, negative-balance corrections and profit-share payouts. Each one becomes a "deposit" or "withdrawal", and trading income or cost vanishes from the return.

A shared blind spot makes this worse: the terminal's Growth figure uses the Signals algorithm, which chains balance ratios between balance operations (LOW, MT5 help and MQL5 FAQ). If the broker posts dividends as BALANCE, our return and the terminal's Growth BOTH exclude them, so a Growth-versus-TWR comparison passes while both are wrong.

Related open items, still unresolved at HEAD:
- Plan 136-05 (the DEAL_TYPE human-verify checkpoint) was never executed (`136-05-SUMMARY.md`: "NOT executed"). CHARGE (4), CORRECTION (5), INTEREST (12), CANCELED (13/14), DIVIDEND (15/16) and TAX (17) still fail loud. An account that books a real `DEAL_TYPE_DIVIDEND` (the MT5 report lists "Dividend" as a trade type, LOW) fails its derive outright. One corporate action can flip a healthy account into a failed derive.
- CREDIT (3) and BONUS (6) are external flows into a NAV chain whose terminal is `equity − (equity − balance)` = balance, which EXCLUDES credit. *Inferred from source, not reproduced:* on an account with credit outstanding, the chain carries the credit grant as a flow the terminal does not contain, so every level BEFORE the grant shifts by the credit amount. The `open_unrealized_usd` wedge (`equity − balance`) also counts credit as open P&L.

**Why it happens:**
The allow-list classifies by `type`, and `type` is the broker's choice, not an economic fact.

**How to avoid:**
- S1: the harness lists every BALANCE, CREDIT and BONUS deal per account with date, sign, magnitude bucket and comment. Comments and amounts stay out of tracked files (see Security). An agent pre-labels each from the comment pattern, and in S2 the founder confirms each label against the terminal's History comments.
- Compare against the statement's DEAL ROWS (per-deal columns and balance-operation rows), not only its summary lines. The statement's "Deposit/Withdrawal" and "Total Net Profit" definitions are not documented well enough to trust blind (LOW).
- Read `account_info().credit` per account. If it is non-zero, reproduce the credit shift on that account before fixing it in the shared core (MT5-10).
- Never satisfy MT5-07 with a Growth-versus-TWR match alone, because of the shared blind spot.

**Warning signs:**
BALANCE deals with non-deposit comments, small amounts, or a regular cadence (monthly or per ex-date). A residual that steps on an ex-dividend date. A non-zero credit.

**Phase to address:** S1 (deal census), S2 (founder labels), S3 (classification fix, which also closes 136-05 for the types actually observed). MT5-07, MT5-10.

---

### Pitfall 7: A truncated ledger hides inside "initial capital = current equity − total P&L"

**What goes wrong:**
`read_mt5_deal_ledger` fetches `history_deals_get(0, now + 1 day)` and treats it as full history. `combine_mt5_deal_ledger` stamps `series_completeness = "ledger_complete"` on that basis. But the terminal returns only what the broker server lets it sync, and that is not always everything:
- A fresh login downloads history asynchronously. `_settle_deal_history` waits for three equal counts 2 s apart within `_MT5_HISTORY_WAIT_S` = 30 s. A large history whose download pauses longer than one interval can look stable while still partial. CR-01 and WR-02 tightened the loop but cannot rule this out.
- Broker retention and server migrations: some brokers keep limited history, and an account moved to a new server can lose pre-migration deals or have them collapsed into one balance line (LOW, broker FAQs and forum; OANDA, for example, shows about 3 to 4 months).
- The anchor formula silently absorbs missing history into "initial capital", so the derive succeeds and the early days are computed on a wrong base.

**Why it happens:**
The backward anchor is designed to tolerate an unknown start, so it gives no signal when the start is wrong.

**How to avoid:**
- Inception identity. It is not tautological, because it uses the broker's balance and a known starting point of zero. With a complete ledger, the balance rolled back past the FIRST deal must be about 0, since an account starts empty and is funded by its first BALANCE deal: `balance_now − Σ(all trading cash effects) − Σ(all flows)` within tolerance of 0, in the account's unit. A non-zero residual means truncated history, a credit mismatch (Pitfall 6) or a fold error (Pitfall 5). The harness asserts it per account in S1.
- Deal count against the terminal: in S2 the founder reads the deal count, or the first deal's date and ticket, from the All History report, and the harness compares.
- The founder's statement export must use "All History". A period-limited report is itself a truncated oracle.

**Warning signs:**
The first deal is not a BALANCE deposit. A non-zero inception residual. A first deal dated later than the account's known opening. Two reads of the same account returning different counts.

**Phase to address:** S1 (inception identity), S2 (deal count), S3 (fix if truncated, and re-check the `ledger_complete` verdict wording). MT5-07.

---

### Pitfall 8: Running the harness through the shared gateway outside the worker's lease

**What goes wrong:**
`mt5_terminal_lease` serializes on `_MT5_TERMINAL_LOCKS`, a dict of `asyncio.Lock` objects inside ONE process. Its own comment says: "Do not read that as cross-process serialization". Two worker services already drive the gateway (the analytics and backfill services). A harness run as a separate process (a script, `railway run`, a notebook) is not serialized at all. MT5 binds one account per terminal at a time, so:
- the harness logging into MM2 while the nightly derive reads MM3 makes the derive's POST bracket raise `Mt5AccountMismatchError`, and the nightly fails;
- or the harness reads whichever account the derive switched to;
- a harness timeout that leaves an rpyc call running reproduces the "work outlives its `wait_for`" class (TODOS 153.5, sites #5 to #7).

**Why it happens:**
The harness feels read-only and offline. It is neither: login changes terminal state.

**How to avoid:**
- Run harness reads inside the worker process, through `read_mt5_deal_ledger` and `mt5_terminal_lease` (for example as an internal job kind or internal endpoint), never through a parallel rpyc connection.
- Keep away from the nightly chain (about 00:10Z; MT5 derives at about 01:00 to 01:10 UTC as measured on 2026-11-13) and from interactive validates.
- Never call `mt5.shutdown()`. `Mt5Client.close()` deliberately no longer does (153.3-06). Use the bounded `restart()` only from the existing timeout arm.

**Warning signs:**
`Mt5AccountMismatchError` in the derive logs on a harness day. `mt5.stage` events with overlapping durations from two sources. A nightly derive that fails only on harness days.

**Phase to address:** S1 (harness placement), S6. MT5-07, MT5-08.

---

### Pitfall 9: A long history read times out into the wrong arm

**What goes wrong:**
A full-history read is bounded in layers: the rpyc `sync_request_timeout` (`MT5_REQUEST_TIMEOUT_S`, 30 s on the worker), the outer `asyncio.wait_for` (`_MT5_DERIVE_READ_TIMEOUT_S` = request timeout + 10 s = 40 s for a cached read; for a fresh login `mt5_derive_read_bound_s` adds the 30 s settle budget plus one trailing read), the 15-minute job-kind ceiling, and the bounded restart (`_MT5_RESTART_TIMEOUT_S`, 10 s). Failure modes:
- The outer bound fires during a fresh login's history download and takes the derive's timeout arm, which RESTARTS the terminal and kills the download it was waiting for. Review WR-01 added the trailing-read allowance for exactly this; any new harness read path must use `mt5_derive_read_bound_s` rather than a hand-picked bound.
- The settle loop runs out of budget under material equity and raises `Mt5HistoryUnsettledError`. That is deliberately a plain `Exception`, neither an `Mt5ClientError` (which would stamp the key as a credential failure) nor a `TimeoutError` (which would restart a healthy terminal). A harness that catches broadly and retries, or maps it to "credentials", re-creates the defect the type exists to prevent.
- Cost that sits outside any single bounded call is invisible to every inner timeout. Iterating an rpyc netref costs a round-trip per element: measured 2026-08-13, 60 ms per deal, 29.9 s for 493 deals, every stage event `ok=true` while the derive failed. `_materialize_rows` fixed this for deals (18.5 ms for 495). A new harness read that iterates a netref brings the problem back.
- Abandoned threads: when `wait_for` fires, the thread running the blocking call keeps driving the terminal after the lease is released (153.5 #5 to #7).

**Why it happens:**
Each layer was sized for the nightly derive. A harness adds new read shapes and new callers, and the easiest fix for a red run is to raise a number.

**How to avoid:**
- Reuse `read_mt5_deal_ledger` for deals. Any new read (a server-time read, positions if the pin is re-cut) materializes in one crossing, like `_materialize_rows`.
- Use `mt5_derive_read_bound_s` for the outer bound, and pass `settle_history` exactly as the derive decides it (`mt5_client.mt5_history_wait_due`).
- Let `Mt5HistoryUnsettledError`, `Mt5AccountMismatchError` and `_Mt5PostReadVerificationError` out of the harness unchanged and report them by name. Never fold them into a generic retry.
- Never raise a bound to turn a harness run green. `_materialize_rows` records the rule: "The bound is NOT the thing to raise".

**Warning signs:**
A terminal restart logged in the middle of a fresh-login settle. `Mt5HistoryUnsettledError` on an account that settled the night before. Wall time far above the sum of the stage events' durations.

**Phase to address:** S1 (harness read path), S6. MT5-07, MT5-08.

---

## Moderate Pitfalls

### Pitfall 10: Statement currency, account currency, and the native-unit view

**What goes wrong:**
The terminal and the statement report in the deposit currency. Our pipeline classifies it with `classify_account_currency`: the USD family is non-native; BTC is native with its own floors; anything else (EUR, USC cent accounts and so on) raises `AccountCurrencyUnsupported`. For a BTC-unit account the rendered USD view is priced through our own close prices (`price_live_balance`, nav marks D-07), so a USD comparison mixes our price source into the oracle diff. A BTC return and a USD return over the same window differ by the BTC move. Statement parsing also has traps: locale thousands separators (`1 234.56`), decimal commas, and a cent account showing figures ×100.

**How to avoid:**
Compare in the account's native unit first, against `account_info().currency` read in S1. Treat the USD view as a separate, labelled check that names its price source. Parse statement numbers with an explicit locale, and assert the parsed currency code equals the account's. Never compare across units.

**Warning signs:**
A residual that tracks the BTC price over the window. A ×100 or ×0.01 ratio between the two sides. A statement currency label that differs from `account_info().currency`. A derive failing with `AccountCurrencyUnsupported` after a broker change.

**Phase to address:** S1, S3. MT5-07, MT5-09.

---

### Pitfall 11: Comparing against the terminal's derived statistics instead of its ledger

**What goes wrong:**
The MT5 Reports tab shows Growth, Sharpe, drawdown and similar. Growth chains balance ratios between balance operations, with "special calculation rules" when a balance operation happens while positions are open (LOW, MQL5 FAQ). Drawdown is balance- or equity-based from local maxima. The equity curve is rebuilt from historical prices. None of these uses our daily calendar, our √252 clock or our flow placement (FLOWTIMING per-position cohorts). A mismatch can be definitional, and a match can be coincidence. Users also report Reports figures disagreeing with the History tab in some builds (LOW).

**How to avoid:**
MT5-07 compares ledger quantities (balance at an instant, deal-row sums, equity at a synchronized instant) and our cumulative return against a return the harness computes from those ledger figures. Use Growth only as a labelled secondary, never as the verdict.

**Warning signs:**
A plan that cites "Reports Growth" or "Reports Sharpe" as the expected value. Agreement on Growth but disagreement on balance rows.

**Phase to address:** S0, S3. MT5-07.

---

### Pitfall 12: "Explaining" `complete_with_warnings` by guessing which guard fired

**What goes wrong:**
Any member of `NAV_TWR_GUARD_KEYS` in `nav_twr.py` promotes the status: `dust_nav_guard`, `negative_nav_guard`, `pnl_dominated_guard`, `flow_coverage_incomplete`, `unrealized_pnl_in_anchor`, `unrealized_pnl_unreadable`, `twr_chain_broken`, the two option-dailies keys, `tiny_base_guard`, and the others listed there. `unrealized_pnl_in_anchor` is a plausible guess for live accounts with open trades, but it is a guess. Flags are recomputed on every derive, so the set seen when MT5-15 was raised (2026-08-04) may differ from today's.

**How to avoid:**
Read `strategy_analytics.data_quality_flags` (the JSONB the dashboard reads; written by `analytics_runner` via `merge_dq_flags`, and pre-stamped and replaced wholesale by `job_worker`'s prestamp) for each MT5 strategy, now and after the next nightly. Record which guard fired, on which days, at what ratio. A warning counts as "explained" only when it is tied to a mechanism and either fixed or accepted in writing (MT5-15). Per the requirement text, MT5-07 does not close MT5-15.

**Warning signs:**
An explanation that names a guard without quoting the stored flag. A flag set that changes between two nightlies with no deals in between.

**Phase to address:** S5 (agent-checkable, can run before gate 2). MT5-15.

---

### Pitfall 13: Tuning timeouts #8 and #10 from one unrepresentative sample

**What goes wrong:**
Finding #8: the 60 s per-stage ceiling wraps six round-trips whose own ceilings are 45 000 ms IPC and 55 s rpyc, so "innermost fires first" holds per round-trip but not per stage. Finding #10: the 20 s interactive lease wait (`_MT5_LEASE_WAIT_S`) is shorter than the worker's 40 s read (`_MT5_DERIVE_READ_TIMEOUT_S`) plus the 10 s restart hold, so an interactive validate can never wait out one in-flight derive. Both were deferred to Phase 155 "needing the real latency data D-32 made collectable — do NOT guess these numbers". A fresh login with a full history settle is the slowest case. A quiet-hour harness run is the fastest. Neither alone is typical. Whether the first derives after the new passwords were fresh logins is unmeasured.

**How to avoid:**
Collect `mt5.stage` and lease-wait `duration_ms` across several nightly derives × three accounts. Split fresh logins from cached ones. Decide from percentiles, and record the sample size and dates. A change to #10 changes interactive validate behaviour and needs its own regression test.

**Warning signs:**
A proposed constant justified by one run. A sample drawn from a single night or a single account. A bound raised in the same change that makes a harness run green.

**Phase to address:** S6. Carried from TODOS (153.5 deferral).

---

### Pitfall 14: The founder session misses a reading and costs another trading day

**What goes wrong:**
Gate 2 is one short scripted session on a trading day. A missed reading (the deal count, a boundary balance, an open-positions list, the server name, a near-midnight deal timestamp, the statement export) cannot be recovered on a weekend. Phase 157's password rotation (`MT5_SPIKE_INVESTOR_PASSWORD`) can break reads if it happens mid-phase.

**How to avoid:**
S1 produces a checklist script per account naming every value, its unit, where it is on screen, and a screenshot step. The harness checks the transcribed sheet for completeness while the founder is still at the terminal. Every agent-checkable item (offset probe, server census, mark census, deal census, inception identity, warnings audit) is done BEFORE the session. Rotate passwords only after S2's live reads, or treat rotation as re-running gate 1.

**Warning signs:**
A founder script with free-text fields. Agent-checkable items still open on the morning of the session.

**Phase to address:** S1, S2, 157. MT5-08.

---

## Minor Pitfalls

### Pitfall 15: Surfaces compared over different windows

Strategy detail, factsheet, composer, PDF and browse each pick ranges differently (session-local ranges, presets such as 12M, the PDF's own date). A divergence can be a window mismatch, not a math bug. The MT5-09 check pins explicit ISO dates on every surface and records each surface's resolved window before comparing values. **Phase:** S4. MT5-09.

### Pitfall 16: Weekend and holiday rows

Gap-filled flat days and Sunday-UTC activity (Pitfall 3) affect day counts, observation floors (the KPI gate: about 60 observations or 90 days, founder 2026-11-07) and any calendar inference. Compare returns, not day counts, against the terminal. Check the KPI gate's day counting on a weekday venue whose weeks start on a UTC Sunday. **Phase:** S4. MT5-09.

### Pitfall 17: Tolerance hardcoded or silently widened

The 1% stays one named constant (settled). Widening it to turn red green is what MT5-10 forbids: "the phase does not close while the terminal and the UI disagree". **Phase:** S1, S3.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Reuse `mt5_soak.reconcile_parity` as the MT5-07 gate | Already built, already green | The balance-anchored identity cannot fail on classification, fold or offset errors; MT5 would be advertised on a tautology | Never as MT5-07; fine as an internal fidelity check labelled as such |
| A per-account offset override instead of a per-server clock | Fast if one account differs | Every new broker needs a manual entry; DST breaks it | Never; the MT5-06 text rejects hardcoded offsets |
| Classify BALANCE deals by comment regex in production | Catches dividends quickly | Comment formats are broker text and change without notice | Only as a pre-label the founder confirms; production needs a decided rule per observed pattern, failing loud on unknown patterns |
| Compare in USD for a BTC-unit account | One code path | Our price source pollutes the oracle diff | Never for the MT5-07 verdict; acceptable as a labelled secondary |
| Run the harness as a standalone script against the gateway | No worker change | Breaks the nightly derive via the login bracket; no serialization | Never on PROD |
| Delete the read-only surface pin to add a server-time read | One-line unblock | Removes the guard keeping trading methods off `Mt5Client` | Never delete; re-cut it to admit one named read-only method, with its reasoning, in the same commit |
| Patch the three 153.5 timeout sites one by one | Small diffs | Instance-not-class, which TODOS records as paid for sixteen times | Never; fix at the sink |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `Mt5Client` read-only pin | Adding `symbol_info_tick` or `positions_get` and seeing `test_read_only_surface_no_trade_methods` go red, then "fixing" the test | Deliberate re-cut: admit the one read-only method by name, keep every trade method forbidden, update the docstring reasoning in the same commit |
| mt5linux 0.1.9 remote eval | Passing `datetime` objects to a new gateway call (the remote namespace has no `datetime` import) | Int epoch seconds, coerced in the client, as `history_deals_get` does |
| `history_deals_get` | Treating `None` as empty, or one early read as complete | `None` raises; settle loop for fresh logins; inception identity (Pitfall 7) |
| `history_deals_get` upper bound | Using UTC now as `date_to` | Keep `_MT5_DEAL_FETCH_MARGIN_S` (one day): a server ahead of UTC stamps "future" epochs. Whether `date_to` is inclusive is undocumented (LOW) |
| `account_info()` | Reading `equity − balance` as open P&L | It includes credit; read `credit` separately |
| Terminal report export | Exporting the visible History period | Set All History before exporting; record the export's period |
| Supabase PROD | Ad-hoc SQL for the mark and flag census | MCP read, marker query first, one query per call (project memory) |
| Shared gateway | A second rpyc client | In-worker job under `mt5_terminal_lease`; never `mt5.shutdown()` |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Per-element netref iteration in new harness reads | Read time grows about 60 ms per row (measured 2026-08-13: 29.9 s for 493 deals) | Materialize in one crossing, as `_materialize_rows` does (about 18.5 ms for 495 deals) | About 600 rows against the 40 s read bound |
| A history settle on every login while cycling three accounts on one terminal | Each fresh login adds up to the 30 s settle budget; the batch stretches toward the nightly window | Rely on `note_mt5_history_settled` caching; schedule harness reads apart from the nightly | When the harness and the nightly overlap, or the terminal restarts often |
| Full-history reads of orders as well as deals | Larger payloads than deals (LOW: each trade has at least one order, so orders are likely at least as numerous as deals) | Deals are sufficient for the money math; fetch other history only for named windows, and only if the pin is re-cut | High-turnover accounts |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Committing terminal readings (balances, equity, deal amounts, account numbers, server names, key or strategy ids) to `.planning/` evidence files | Public repo with `.planning/` tracked; exposes live client figures | Keep raw readings out of git (a gitignored path or the database); tracked evidence carries relative errors, pass/fail, counts and hashes only |
| Logging the investor password or an unscrubbed rpyc error from a new harness call | Credential disclosure (T-134-01) | Route errors through the existing scrub (`Mt5ClientError` is scrubbed at construction); no new raw printing of exceptions |
| Rotating `MT5_SPIKE_INVESTOR_PASSWORD` mid-harness | Reads fail and get mistaken for a defect | Sequence Phase 157's rotation after S2, then re-check gate 1 |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Advertising MT5 after a partial pass (for example two of three accounts) | Allocators trust unverified figures | Hold the "do not advertise MT5" rule until MT5-GOAL-01 passes on all three accounts |
| Rendering a realized-basis curve labelled as equity | Allocators read closed-balance history as mark-to-market | If S0 keeps pre-mark history realized, say so on the surface; never relabel silently |

## "Looks Done But Isn't" Checklist

- [ ] **MT5-07 harness:** every expected value has `terminal_reading`, `terminal_report_export` or `broker_statement` provenance; none derives from our gateway reads.
- [ ] **MT5-07 harness:** shown RED by a neutered input (a reclassified BALANCE deal, a one-hour clock shift, a dropped oldest deal), then restored from a byte backup.
- [ ] **Window:** the end is several trading days before the run; both boundaries are market-closed instants; the window includes a flow, a month-end and the 2026-11-01 DST change.
- [ ] **Compared quantity:** cumulative return, start level and end level each checked; the meaning of "1%" is written down.
- [ ] **MT5-06:** live offset per account and server, taken on a trading day; the read-only pin re-cut on purpose or an alternative read chosen; real near-midnight deals matched to the terminal's displayed date.
- [ ] **Server census:** `account_info().server` for all three accounts; one rule confirmed, or a per-server clock built.
- [ ] **Mark census:** the first `mark_day` per key is known and placed against the window; the basis decision is recorded.
- [ ] **Inception identity:** about 0 per account; deal count matches the All History report.
- [ ] **Cost columns:** commission, fee, swap and profit compared column by column against the statement; A3 resolved for the observed patterns.
- [ ] **Deal census:** every BALANCE, CREDIT and BONUS deal labelled and confirmed by the founder; `account_info().credit` read.
- [ ] **MT5-15:** `data_quality_flags` read, not inferred; each flag tied to a mechanism.
- [ ] **MT5-09:** five surfaces over identical ISO dates, compared against the oracle and not only against each other.
- [ ] **#8 and #10:** decided from percentiles over several nightly runs, with fresh and cached logins split.
- [ ] **Evidence:** no account numbers, balances or ids in tracked files.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Founder session missed a reading | MEDIUM (another trading day) | Validate the sheet live in S2; if missed, book the next trading day with only the missing items |
| Offset wrong for one account | MEDIUM | Per-server clock; re-derive affected keys; re-run the S3 diff. Marks are UTC instants and do not move, but flow placement against them (`nav_marks_apply` rule 10) does |
| Cost fold double-counts | MEDIUM | Fix the fold for the observed broker pattern with a hand-derived oracle; re-derive MT5 keys; re-run the S3 per-column diff |
| BALANCE deals misclassified | MEDIUM to HIGH (shared core) | Decide a rule per observed pattern; add oracles per type; re-derive all MT5 keys; run the golden-parity regression for other venues, since MT5-10 fixes can touch the shared backbone |
| Truncated ledger | HIGH | Not recoverable from the API. Obtain broker statements for the missing span; decide with the founder whether the series starts later, honestly marked |
| Harness broke a nightly derive | LOW | The next nightly heals it; move the harness in-worker before re-running |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1 Tautological oracle | S0, S1, S3 (MT5-07) | Provenance enum enforced; self-RED test recorded |
| 2 Window-end trap | S0, S1, S2 (MT5-07/08) | Three legs reported; window meets the checklist |
| 3 One clock, no live read | S1, S2, S3 (MT5-06) | Live offset equals rule offset per server; near-midnight real deals match |
| 4 Basis mismatch | S0, S1, S2 (MT5-07/08) | Mark census recorded; basis decision written; residuals not about equal to the wedge |
| 5 Swap, commission, fee | S1, S2, S3 (MT5-07/10) | Per-column statement diff within tolerance; A3 closed for observed patterns |
| 6 BALANCE not deposits; credit | S1, S2, S3 (MT5-07/10) | Founder-confirmed deal census; credit read; 136-05 closed for observed types |
| 7 Truncated ledger | S1, S2 (MT5-07) | Inception identity about 0; deal count matches |
| 8 Lease bypass | S1, S6 | Harness runs in-worker; no mismatch errors on harness days |
| 9 Long-read timeouts | S1, S6 (MT5-07/08) | Harness uses `mt5_derive_read_bound_s`; named errors surface unchanged; no bound raised |
| 10 Currency and unit | S1, S3 (MT5-07/09) | Native-unit comparison; parsed currency equals the account's |
| 11 Derived statistics | S0, S3 (MT5-07) | Verdict computed from ledger quantities only |
| 12 Warnings guessed | S5 (MT5-15) | `data_quality_flags` read and each flag tied to a mechanism |
| 13 Timeout tuning | S6 (TODOS #8, #10) | Percentile table with sample size and dates |
| 14 Founder session gaps | S1, S2, 157 (MT5-08) | Sheet completeness checked live; rotation sequenced after S2 |
| 15 Surface windows | S4 (MT5-09) | Explicit ISO dates per surface |
| 16 Weekend rows | S4 (MT5-09) | KPI gate checked on a Sunday-starting weekday venue |
| 17 Tolerance drift | S1, S3 | One named constant; unchanged in the diff |

## Sources

**Repo (HIGH, read at HEAD 2026-11-13, cited by symbol):**
- `analytics-service/services/mt5_read.py`: `read_mt5_deal_ledger`, `_settle_deal_history`, `Mt5HistoryUnsettledError`, `_MT5_DEAL_FETCH_MARGIN_S`
- `analytics-service/services/mt5_server_clock.py`: `resolve_mt5_server_clock`, `Mt5ServerClock` (eu, us and fixed rules; residual assumption A2)
- `analytics-service/services/mt5_deals.py`: `classify_deal`, `_MT5_TRADING_DEAL_TYPES`, `_MT5_EXTERNAL_FLOW_DEAL_TYPES`, `deal_cash_effect` (A3), `deal_utc_day`, `deal_utc_instant_ms`
- `analytics-service/services/broker_dailies.py`: `combine_mt5_deal_ledger` (realized basis, `open_unrealized_usd = equity − balance`, `ledger_complete` verdict)
- `analytics-service/services/nav_twr.py`: `NAV_TWR_GUARD_KEYS`, `reconstruct_nav_and_twr` (terminal NAV = anchor − open uPnL)
- `analytics-service/services/nav_marks.py` (D-03, D-09) and `nav_marks_apply.py` (rules 2, 3 and 10)
- `analytics-service/services/mt5_concurrency.py`: `_MT5_TERMINAL_LOCKS`, `mt5_terminal_lease`, `mt5_derive_read_bound_s`, `_MT5_HISTORY_WAIT_S`, `_MT5_LEASE_WAIT_S`, `_MT5_DERIVE_READ_TIMEOUT_S`, `_MT5_RESTART_TIMEOUT_S`
- `analytics-service/services/mt5_client.py`: `history_deals_get`, `_materialize_rows` (latency measurements), `MT5_REQUEST_TIMEOUT_S`
- `analytics-service/tests/test_mt5_client_contract.py`: `test_read_only_surface_no_trade_methods`, `test_public_surface_is_exactly_the_contract`
- `analytics-service/services/account_unit.py`: `classify_account_currency`
- `analytics-service/services/analytics_runner.py` (`merge_dq_flags`, `strategy_analytics.data_quality_flags`) and `job_worker.py` (prestamp)
- `analytics-service/scripts/mt5_soak.py`: `reconcile_parity`; `analytics-service/scripts/mt5_spike.py`: `_leg4_server_time_offset`; `tools/mt5/QuantalyzeDailyReturns.mq5` (`TimeTradeServer`, EA route only)
- `TODOS.md` (153.5 findings #5 to #7 and the deferred #8 and #10; the −810 offset artefact; the 2026-08-23 sync reading); `CHANGELOG.md` and `175-06-SUMMARY.md` (switch to `us` on 2026-11-03, one-key first derive, live clock check left to MT5-06)
- `.planning/milestones/pre-v1.20-REQUIREMENTS-accumulated-snapshot.md` (MT5-06 to MT5-10 and MT5-15 text); `.planning/milestones/v1.15-phases/136-mt5recon-equity-reconstruction/136-05-SUMMARY.md` (never executed) and `136-RESEARCH.md` (A2, A3)

**Web (LOW: confidence seam, unverified against a live ledger; each is paired above with a live measurement):**
- [MetaTrader 5 Help: Trading report](https://www.metatrader5.com/en/terminal/help/trading/report): Growth uses the Signals algorithm; Balance includes credit; Equity formula; equity curve rebuilt from price history; Dividend trade types
- [MQL5 forum: Growth explain](https://www.mql5.com/en/forum/168666) and [signal growth explanation](https://www.mql5.com/en/forum/315005): chained balance ratios between balance operations; special rules with open positions
- [MQL5 forum: Metatrader 5 reports, missing summary](https://www.mql5.com/en/forum/480063) and [history report graph wrong](https://www.mql5.com/en/forum/485824/56586262): Reports discrepancies (user reports)
- [MQL5 docs: history_deals_get](https://Mql5.com/en/docs/python_metatrader5/mt5historydealsget_py) and [MQL5 forum: time semantics of history_deals_get](https://www.mql5.com/en/forum/516531): `None` on error; `date_to` inclusivity unanswered
- [MQL5 forum: commissions and swaps of an open position](https://www.mql5.com/en/forum/300751), [partial close paying swaps](https://www.mql5.com/en/forum/436864), [MQL5 book: deal properties](https://www.mql5.com/de/book/automation/experts/experts_deal_properties), [Fusion Markets: MT4 vs MT5 swap and commission](https://fusionmarkets.freshdesk.com/support/solutions/articles/51000308803-mt4-vs-mt5-swap-and-commission-charge): swap on the position, carried by the closing deal; commission timing
- [VT Markets dividend adjustment notice](https://www.vtmarkets.com/dividend/t2022012701/) and [Vantage help: dividend adjustment](https://helpcenter.vantagemarkets.co.uk/hc/en-gb/articles/11933284692879-What-does-dividend-adjustment-mean): index dividends booked as balance entries with a `Div …` comment
- [Pepperstone: why accounts are archived on the MetaTrader server](https://pepperstone.com/en-eu/support/why-are-trading-accounts-archived-on-the-metatrader-server/) and [TradeZella: OANDA MT4/MT5 history limit](https://intercom.help/tradezella-4066d388d93c/en/articles/8407159-why-can-t-i-see-my-full-trade-history-i-am-using-oanda-broker-with-mt4-mt5): retention and migration limits
- [MQL5 blog: daily-loss baselines](https://www.mql5.com/en/blogs/post/777421): deal history rebuilds balance at a reset, not equity

---
*Pitfalls research for: MT5 terminal-parity verification (v1.18 MT5-VERIFY)*
*Researched: 2026-11-13*

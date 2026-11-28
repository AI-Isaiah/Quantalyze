# Phase 256: OKXUNITSWITCH - Context

**Gathered:** 2026-11-27
**Status:** Ready for planning (autonomous smart discuss 2026-11-27; the four product choices were answered by the founder the same day)

<domain>
## Phase Boundary

One OKX account whose P&L moved from USDT into a coin is reported in USD up to the switch and in that coin after it, on every surface (ROADMAP Phase 256 goal, founder ruling C "USD before 11-15, BTC after"). Out of scope: option A (one USD series converting each coin bill), option B (coin for the whole history), raising or removing the VREAD-06 refusal for a coin with no switch, and accounts that are in one non-USD unit for their whole history (already served by the one-unit native machinery).

</domain>

<decisions>
## Implementation Decisions

### Storage and unit seam (revised after research 2026-11-27; the per-row native_unit hypothesis was refuted)
- The headline series columns (`strategy_analytics.returns_series` / `daily_returns`, and key mode's `allocator_equity_derived` key_inputs) hold ONE whole-history USD series: the USD segment, then the coin segment converted with the existing `convert_native_returns_to_usd` at the BTCUSDVIEW daily close. No `native_unit` flag is written for a switched key, so unmodified USD readers stay correct. `api_key_nav_marks` (write-once MTM store, rows already 'USD') and `trades` daily rows (USDT-only) receive no coin rows. — **Reversibility:** costly — every reader binds to the headline series meaning.
- The two native segments (unit, from_day, to_day, native returns) are stored in a new nullable jsonb column `strategy_analytics.unit_segments` plus a small `data_quality_flags.unit_switch` marker; key mode carries an additive `unit_segments` entry in `key_inputs` JSON (no migration). Chosen over the zero-migration `data_quality_flags`-only option because that blob is rebuilt wholesale and copied into `last_success_snapshot`. The migration passes migration-reviewer and rls-policy-auditor in the serial lane. Founder may override. — **Reversibility:** one-way — a migration on a PROD table.
- The fetch takes an optional `unit_switch` keyword passed only by the derive; `sync_trades`, the cron tick and `okx_archive_job` keep refusing, pinned by tests. — **Reversibility:** costly — call sites bind to it.

### Readers (founder answers 2026-11-27, AskUserQuestion via the coordinator, verbatim option labels quoted)
- Headline KPIs: "Whole record in USD (Recommended)". Headline KPIs run over the FULL history in USD, with the coin segment converted at each day's BTC/USD close (the BTCUSDVIEW close, `services/native_to_usd.py`, `benchmark.read_btc_closes`), the same USD view composites and books see. It passes the total-record KPI gate today. A note states the switch (copy below). This REPLACES the discuss-time recommendation (coin-segment-only headline); no headline figure is computed on a mixed-unit series, because the headline series is all USD. A missing close for a coin-segment day withholds that day by name, never invents it.
- Charts: "One chart, marked switch (Recommended)". One chart with two segments, a visible break and a unit label at the switch day; no line joining the two units.
- Composites, allocator books and the USD view: "USD, BTC part converted (Recommended)". They stay in USD and convert the coin segment at the daily close, consistent with 164.6.6.2 D-13/D-15.
- Copy: "In USD to 14 Nov, in BTC from 15 Nov", shown wherever the unit appears (chart label, KPI note, factsheet). Code uses the DERIVED switch date; the founder's wording uses this account's dates. Date style (coordinator relaying the founder's direction, 2026-11-27): the app-wide format per Phase 201 U-14, so it reads "In USD to Nov 14, 2026, in BTC from Nov 15, 2026"; the founder's wording fixed the structure, not the date style.

### Switch detection
- The switch date follows SC-1 literally: the first day on which the account's value or P&L is denominated in a coin other than its stable unit, read from stored bills, holdings or fills. Research tests the candidate rule against the real holdings and against a gradual-mover fixture (coin fee bills before the coin is the majority of value), so a gradual mover does not still refuse. A missing or ambiguous date refuses by a named reason. — **Reversibility:** costly — it decides which rows land in which unit.

### Founder rulings 2026-11-27 after review round 3 (AskUserQuestion via the coordinator)
- R3-03, verbatim choice: "<50% for 7 days (Recommended)". The 95% share decides only WHEN the switch happens. After the switch day, a switch back counts only after 7 consecutive end-of-day observations with the coin under 50% of account value. A dip under 95% changes nothing.
- Round-3 survivors, verbatim choice: "Book a follow-up phase (Recommended)". R3-01 (raw api key id in an anon-readable column), SF3-02, SF3-03 and R3-06 are fixed before ship. R3-02 (re-point to a new key on the same account), R3-04 (first mark on a mixed day reads 0%), R3-05 (deposit before the first mark skews earlier returns), R3-07 (rescale for keys with no mark before the coin) and SF3-01 (mixed-day withholding lost once bills age out, for keys without marks) go to one follow-up phase in v1.23. None of them affects the founder's account at ship.

### Founder ruling 2026-11-27 on review finding R2-01 (supersedes the "coin majority" wording of the CR-01 ruling below, which stays as lineage)
- Verbatim choice (AskUserQuestion via the coordinator): "≥95% coin and stays (Recommended)".
- Why it was asked again: the CR-01 option B text said "clear majority (11-21 for this account)", but the measured holdings are about 75% BTC at the end of 11-14, so a plain majority gives 11-15, not 11-21, and keeps CR-01's defect (25% USDT booked as BTC for six days). The round-2 reviewer measured this on the real code.
- Rule now: the switch day is the first day the coin is at least 95% of end-of-day account value and stays at or above it. For this account that is 11-21: last USD day Nov 20, first coin day Nov 21. 11-15 to 11-20 are USD days at true values from the stored NAV marks.
- Copy: "In USD to Nov 20, 2026, in BTC from Nov 21, 2026", built from the stored switch days.

### Founder ruling 2026-11-27 on review finding CR-01 (supersedes the switch-day and boundary decisions above, which stay as lineage)
- Verbatim (AskUserQuestion via the coordinator): "Move switch to coin majority". Option (B) of three: (A) value the coin segment from total equity; (B) move the switch day to the first day the coin is the clear majority and stays so; (C) accept as a known limit.
- Rule now: S is the first day the coin is the clear majority of end-of-day holdings and never drops back below it. For the founder's account that is 2026-11-21 (holdings asof label). The earlier min(first coin bill, first majority) rule booked a still-mostly-USDT account as 100% coin (CR-01).
- Mixed days before S (11-15 to 11-20 for this account) are reported in the USD segment, never in the coin segment. Coin bills dated before S (the transition fees) are valued at their own day's stored close into the USD day, within COIN_LEAD_TOLERANCE_DAYS. A day with no close is withheld by name. Reason for reporting them in USD rather than refusing: refusing the account until it is all-coin would keep the 7 nightly derives failing, against the phase goal. The USD figures for those days are true USD values (marks), and the copy names the dates, so nothing is booked silently. An account with coin bills but no persistent majority yet still refuses by name (`coin_bills_without_majority`).
- R2-01, founder answer 2026-11-27 (verbatim choice: "≥95% coin and stays (Recommended)"): "clear majority" above means the coin is at least 95% of end-of-day account value and stays at or above it (`COIN_SWITCH_SHARE`). The measured account is 75% BTC at the end of 11-14 and about 99.7% from the end of 11-20, so S = 11-20 and the first coin day is 11-21. The 50% reading is superseded.
- Copy: dates come from the computed switch day in the app format, so for this account it reads "In USD to Nov 20, 2026, in BTC from Nov 21, 2026". This replaces the earlier "14 Nov / 15 Nov" reading. The founder's original "USD before 11-15, BTC after" is kept as lineage.

### Decided autonomously
- [Switch detection] Q: 'Where is the switch date derived' → Selected: 'One pure function in the analytics service beside services/account_unit.py, returning (switch_day, coin) or a named refusal; never a constant for this account' — local module behind one seam.
- [Boundary day] Q: 'Which segment carries the switch' → Selected (revised after research 2026-11-27): 'S is the last USD return day; the coin base level is the end of S; the first coin return day is S+1, and the stored switch_day is the first coin return day. Every day appears in exactly one return chain. On the founder account S = 11-14 by bill timestamp (holdings asof labels lag a day), so the first coin day is 11-15, matching his reading.' — one comparison in the splitter, pinned by fixtures.
- [VREAD-06] Q: 'What happens to coin bills' → Selected: 'Bills in the switched coin on or after the switch day are booked in the coin segment; any other non-stable ccy, or a coin bill with no switch, still refuses with daily_pnl_non_usd_okx' — a narrow branch pinned by tests both ways.
- [Tests] Q: 'PROOF-01 shape' → Selected: 'Each gate RED on pre-fix code or a neutered copy, restored from a byte backup (cp back, cmp), then GREEN' — test-only.

- [Switch detection] Q: 'How far may coin bills lead the coin-majority day' → Selected: 'COIN_LEAD_TOLERANCE_DAYS = 14; beyond it refuses with bills_precede_majority_beyond_tolerance' — one constant.

### Claude's Discretion
- Internal names, module layout and test file placement.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Unit machinery: `services/account_unit.py`, `services/native_to_usd.py` (BTCUSDVIEW), `services/nav_marks.py`, `services/nav_twr.py`, `benchmark.read_btc_closes`.

### Established Patterns
- Refusal by named reason (`daily_pnl_non_usd_okx`, `read_refusal_kept_figures`); 164.6.6.2 D-13 skips a non-USD key by name in allocator snapshots unless priced.

### Integration Points
- Refusal: `_okx_non_usd_census` to `daily_pnl_non_usd_okx` in the OKX branch of `fetch_daily_pnl`, `analytics-service/services/exchange.py`.
- Readers of `native_unit` to census (each needs a stated rule, SC-3): `analytics_runner.py`, `wealth_returns.py`, `allocator_equity_compose.py`, `strategy_matching.py`, `job_worker.py`, `mt5_parity*.py`, `routers/portfolio.py`, `routers/simulator.py`, `routers/match.py`, `src/lib/queries.ts`, `src/lib/departed-history.ts`.
- SC-6 deviation note already exists in `232-CONTEXT.md` (dated note 2026-11-27) and the ROADMAP; confirm it is current once the design is final.

</code_context>

<specifics>
## Specific Ideas

- The founder's 11-15 is a check on the derived date, recorded in a plan SUMMARY, never an input.
- SC-5 needs a PROD read after deploy (marker query first, no ids in tracked text) and the next nightly derive.

### Booking record (2026-11-27, kept verbatim)
Booked 2026-11-27. Source: the diagnosed `okx-non-usd-native` debug session (2026-11-27).

#### Founder decision (2026-11-27, AskUserQuestion, verbatim)

"USD before 11-15, BTC after" - how to report an OKX account whose P&L was in USDT and which then moved into spot BTC. Options offered: A convert each BTC bill to USD at the day's BTC close; B report in BTC for the whole history; C USD before the switch, the coin after; D keep the refusal. The founder chose C. An earlier chat ruling ("if they are reported in BTC, then just report them in BTC as well") assumed a coin-margined account, and the measurement showed this one is not.

#### Measured (PROD, read only, marker query first; no ids recorded)

- One OKX account stored as 4 keys (identical balances on every sampled day). 7 derive jobs fail every night since 2026-11-24: 4 key-mode and 3 strategy-mode, `failed_final`, `error_kind=permanent`, `realized read incomplete (daily_pnl_non_usd_okx)`. The 3 strategy-mode jobs carry `read_refusal_kept_figures`, so the strategies sit at their last good figures. 11-16 to 11-24 ended `done`.
- The OKX bills read gave about 1300 bills; the non-USD census was `{'BTC': 11}`, every other bill USDT or zero-amount.
- History from holdings: a USDT wallet and a USDT-margined ETHUSDT swap from May to 11-12, an all-USDT account on 11-13 and 11-14, about three quarters moved into spot BTC on 11-15, almost all the rest on 11-21, about 99.7% BTC by value today. No coin-margined contract anywhere. Stored fills (to 2026-08-19) are all USDT-fee.
- OKX docs (GET /api/v5/account/bills): `ccy` is the account balance currency, `balChg` is in that `ccy`, `fee` is negative for a fee charged. The bills page does not state the spot fee currency; OKX's rule that the fee is charged in the currency received explains the 11 bills but is not proven from a raw bill.

#### Cause

Phase 232-03's VREAD-06 (`_okx_non_usd_census` to `daily_pnl_non_usd_okx` to `return []`, in the OKX branch of `fetch_daily_pnl`, `analytics-service/services/exchange.py`) refuses the whole read on a non-stable `ccy` with a non-zero `pnl + fee`. 232-CONTEXT Q3 recorded this case. The native-unit machinery (`services/account_unit.py`, `api_key_nav_marks.native_unit`, BTCUSDVIEW's USD view in `services/native_to_usd.py`, `benchmark.read_btc_closes`) is one unit per key for the whole series, and no reader supports a series that switches unit.

#### Deviation record

This reverses part of 232-03 (VREAD-06). Recorded at the 232-03 line in `ROADMAP.md`, in `232-CONTEXT.md` and here, per the deviation policy.

#### For the planner

- The switch date is derived from data and never hard-coded. The founder's 11-15 is his reading of this account, a check and not an input.
- Research first: the raw OKX bills, to confirm the 11 bills are the BTC fees of the spot buys, reading the venue API docs too.
- Success criteria are in the ROADMAP section. They are not restated here.

</specifics>

<deferred>
## Deferred Ideas

- A second switch (coin back to USDT, or into another coin) is not designed here; it refuses by name and is booked if it occurs.

</deferred>

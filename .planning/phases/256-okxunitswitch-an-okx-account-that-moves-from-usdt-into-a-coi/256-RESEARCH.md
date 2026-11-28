# Phase 256: OKXUNITSWITCH - Research

**Researched:** 2026-11-27
**Domain:** analytics-service derive pipeline (OKX bills read, NAV/TWR engine, native-unit machinery) plus TypeScript read surfaces; Supabase JSONB storage
**Confidence:** MEDIUM-HIGH (bill finding and storage verdict HIGH from stored PROD rows and code reads; reader census MEDIUM, read by grep plus targeted reads, not every reader opened end to end; the live-bill count is UNPROVEN until one live read)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Storage and unit seam
- HYPOTHESIS for research to confirm, not a settled fact: the two-unit series reuses the per-row `api_key_nav_marks.native_unit` (CHECK `^[A-Z]{2,10}$`), USD segment rows then coin rows, with no new table. Research must check whether USD rows carry NULL rather than 'USD' (`native_unit IS NULL OR ...`, `price_day IS NULL OR native_unit IS NOT NULL`), where the daily P&L series the 7 failing jobs write actually lives, and whether any writer, constraint or reader assumes one unit per key. If any does, a segment table or column is chosen instead and passes migration-reviewer and rls-policy-auditor. — **Reversibility:** one-way — persisted rows and possibly a migration; readers bind to the shape.
- The unit seam (`services/account_unit.py`) returns a list of segments (unit, from_day, to_day). The existing single-unit call stays as a wrapper that refuses by name on a multi-segment key, so no current reader silently reads a mixed series. — **Reversibility:** costly — every reader of the seam binds to it.

#### Readers (founder answers 2026-11-27, AskUserQuestion via the coordinator, verbatim option labels quoted)
- Headline KPIs: "Whole record in USD (Recommended)". Headline KPIs run over the FULL history in USD, with the coin segment converted at each day's BTC/USD close (the BTCUSDVIEW close, `services/native_to_usd.py`, `benchmark.read_btc_closes`), the same USD view composites and books see. It passes the total-record KPI gate today. A note states the switch (copy below). This REPLACES the discuss-time recommendation (coin-segment-only headline); no headline figure is computed on a mixed-unit series, because the headline series is all USD. A missing close for a coin-segment day withholds that day by name, never invents it.
- Charts: "One chart, marked switch (Recommended)". One chart with two segments, a visible break and a unit label at the switch day; no line joining the two units.
- Composites, allocator books and the USD view: "USD, BTC part converted (Recommended)". They stay in USD and convert the coin segment at the daily close, consistent with 164.6.6.2 D-13/D-15.
- Copy: "In USD to 14 Nov, in BTC from 15 Nov", shown wherever the unit appears (chart label, KPI note, factsheet). Code uses the DERIVED switch date; the founder's wording uses this account's dates.

#### Switch detection
- The switch date follows SC-1 literally: the first day on which the account's value or P&L is denominated in a coin other than its stable unit, read from stored bills, holdings or fills. Research tests the candidate rule against the real holdings and against a gradual-mover fixture (coin fee bills before the coin is the majority of value), so a gradual mover does not still refuse. A missing or ambiguous date refuses by a named reason. — **Reversibility:** costly — it decides which rows land in which unit.

#### Decided autonomously
- [Switch detection] Q: 'Where is the switch date derived' -> Selected: 'One pure function in the analytics service beside services/account_unit.py, returning (switch_day, coin) or a named refusal; never a constant for this account' — local module behind one seam.
- [Boundary day] Q: 'Which segment carries the switch day' -> Selected: 'The coin segment only; the USD segment ends the day before; never carried in both units' — one comparison in the splitter.
- [VREAD-06] Q: 'What happens to coin bills' -> Selected: 'Bills in the switched coin on or after the switch day are booked in the coin segment; any other non-stable ccy, or a coin bill with no switch, still refuses with daily_pnl_non_usd_okx' — a narrow branch pinned by tests both ways.
- [Tests] Q: 'PROOF-01 shape' -> Selected: 'Each gate RED on pre-fix code or a neutered copy, restored from a byte backup (cp back, cmp), then GREEN' — test-only.

### Claude's Discretion
- Internal names, module layout and test file placement.

### Deferred Ideas (OUT OF SCOPE)
- A second switch (coin back to USDT, or into another coin) is not designed here; it refuses by name and is booked if it occurs.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs are assigned (ROADMAP: `Requirements: TBD`). The 7 ROADMAP success criteria are the contract; the table maps each to the research finding that enables it.

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | Switch date derived from data, two differently shaped accounts, founder's 11-15 as a check, named refusal | "Switch rule" section. Finding: the real account's UTC switch day is 11-14, not 11-15 (labelling convention, see "Switch rule": bill day 11-14 vs holdings asof 11-15) |
| SC-2 | Two-unit series stored with units named; boundary day once | "Storage verdict". Hypothesis refuted as stated; fail-closed design recommended |
| SC-3 | Every reader states a rule; each has a test RED on origin/main | "Reader census" |
| SC-4 | BTC fee bills booked in BTC segment; never-switch and other coins still refuse | "Bills finding", "fetch_daily_pnl design" |
| SC-5 | 7 nightly failures end `done`; 3 strategies unfreeze | "Validation Architecture" (PROD verification), "Plans and waves" |
| SC-6 | Deviation recorded in 232-CONTEXT and ROADMAP | Both notes already exist (232-CONTEXT.md line 105, ROADMAP.md line 528); they carry a date error to correct ("Switch rule" real-shape fixture) |
| SC-7 | PROOF-01 per gate; migration through migration-reviewer + rls-policy-auditor | "Validation Architecture" |
</phase_requirements>

## Summary

The 11 BTC bills are, with high probability, the BTC-denominated trading fees of the spot BTC-USDT buys. Three independent stored facts agree, and one fact is still unproven. Stored: (a) `strategy_analytics.data_quality_flags.fee_currency_mismatch_samples` on all three strategies is `['okx:BTC-USDT:BTC']`, written by `_check_fee_currency_mismatch` from the venue's own fill rows: a BTC-USDT fill whose fee currency is BTC; (b) the three strategies' stored daily P&L rows (`trades`, `order_type='daily_pnl'`, written before the 232 refusal shipped, when the BTC bills were still summed at face value as USDT) hold a tiny negative amount (absolute value under 0.01, BTC-sized) on exactly two UTC days, 2026-11-14 and 2026-11-20, and a large USDT figure on 2026-11-12; (c) OKX's own help-center fee rule says a buy on the order book is charged in the crypto bought. Unproven: that the `ccy=BTC` bills are exactly those fills (count 11), which needs one live venue read. A correction to the booking record follows from (b): the buy days by UTC bill timestamp are 11-14 and 11-20, not 11-15 and 11-21. The holdings snapshots are taken about 01:00Z on their `asof` date and so describe the end of the previous UTC day; "11-15" is the first `asof` label that shows BTC, and the same move reads as 11-14 by bill day.

The storage hypothesis is refuted as the primary design. `api_key_nav_marks` is a write-once mark-to-market NAV store (one row per key per UTC day, from deploy, never backfilled); it is not where the derived daily series lives. The series the 7 failing jobs write live in `strategy_analytics.returns_series` / `daily_returns` (strategy mode, one unit per row via `data_quality_flags.native_unit`) and in `allocator_equity_derived` rows of kind `key_inputs:<api_key_id>` (key mode, one `native_unit` in the JSON payload). The marks table could technically hold a USD-then-BTC sequence per row (no cross-row constraint), and USD rows hold `'USD'`, not NULL, but the 11-14 to 11-23 marks already stored are immutable `'USD'` rows, and the reader that applies marks (`_marks_in_series_unit`) refuses the whole key on any unit mismatch. Recommended design (after the founder's reader answers of 2026-11-27, headline = whole record in USD): the existing columns (`returns_series`, `daily_returns`, KPIs, no `native_unit` flag) hold the WHOLE-history USD series, the USD segment as is and the BTC segment converted at each day's BTCUSDVIEW close; the two native segments are stored once in an additive sidecar read only by the presentation surfaces (chart break, labels, KPI note). Because the headline columns are a true all-USD series, every unmodified reader (blends, composites, books, match, simulator, benchmark pairing, the KPI gate) is correct without a code change, and the phase's code surface shrinks to the derive plus the segment-aware presentation. A migration is needed only if the sidecar is a new column (recommended: one nullable `jsonb` column on `strategy_analytics`); key mode needs none.

The work is one phase of five plans in four to five waves. The backend half (plans 01 to 03) unfreezes the derives and is safe to ship alone because nothing it stores is mixed-unit; the presentation surfaces (plan 04) can be carved off as a follow-up phase if the founder wants SC-5 sooner.

**Primary recommendation:** Build `derive_unit_switch` as a pure function over three evidence streams (coin bills by day, end-of-day holdings, live balance), make `fetch_daily_pnl` accept an optional switch and keep refusing when none is passed, run the existing NAV/TWR engine once per segment (the MT5 BTC path is the precedent, `floors=` keyword), and store the whole-history USD series (coin segment converted at the daily BTCUSDVIEW close) in the existing columns with the two native segments in a sidecar.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Bills read and per-ccy booking | API / Backend (analytics-service `exchange.py`) | — | Venue read happens only in the worker; keys decrypt only there |
| Switch-date derivation | API / Backend (new pure module beside `account_unit.py`) | Database (reads `allocator_holdings`, bills census) | Pure function; I/O stays in the derive caller |
| Segment series construction (NAV/TWR per unit) | API / Backend (`nav_twr.py`, `job_worker.py` derive) | — | Engine already takes `floors=` per unit |
| Two-unit persistence | Database / Storage (`strategy_analytics`, `allocator_equity_derived` JSON) | — | Worker writes via service_role |
| USD view of the coin segment | API / Backend (`native_to_usd.py`) and Frontend Server (`src/lib/factsheet/native-to-usd.ts`, `usd-view.ts`) | — | Two runtimes, one shared oracle fixture (D-23) |
| Segment labels, chart break, KPI withholding | Frontend Server (SSR payload builders) | Browser (chart rendering) | Payload builders decide; browser only draws |
| Composite / allocator-book blending | API / Backend (`allocator_equity_compose.py`, routers) | Frontend Server (`ScenarioComposer`, scenario-share) | Blends weight whatever series they are handed |

## Bills finding (question 1)

**What the venue documents** [CITED: okx.com/docs-v5/en, "Get bills details (last 7 days)", read 2026-11-27]: `ccy` is "Account balance currency"; `balChg` is "Signed change in account balance for this event, in the currency specified by the `ccy` field"; `fee` is "Negative number represents the user transaction fee charged by the platform" (positive is a rebate); `pnl` is "Profit and loss"; subType `1` is Buy and `2` is Sell. Request parameters include `instType`, `instId`, `ccy`, `type`, `subType`, `begin`, `end`, `after`, `limit` (max 100). The bills page does not state the spot fee currency. [CITED: okx.com/help/trading-fee-rules-faq] says: on an order-book buy "the fee is charged in the crypto you bought"; on a sell "the fee is charged on the proceeds of the sale"; a 2026 EU variant of the FAQ says the currency "depends on the direction of the trade, the product you're trading and the details of the fill", so read it per fill. An older Fee Details page says spot fees are charged in the base currency [CITED: okx.com/sv/help/fee-details]. Net: a BTC-USDT buy charges BTC; a BTC sell would charge USDT.

**What the repo reads and sums** [VERIFIED: analytics-service/services/exchange.py:2019-2080, `fetch_daily_pnl` OKX branch]: it walks UTC-aligned 7-day windows (`OKX_BILLS_WINDOW_DAYS: int = 7`), oldest first, over `["SWAP", "FUTURES", "SPOT", "MARGIN"]`, on the live endpoint and the archive endpoint, reach `OKX_BILLS_REACH_DAYS: int = 93`. Per bill it drops `type == "8"` (funding), parses `pnl` and `fee` with `_finite_float`, and sums `pnl_val = _pnl_raw + _fee_raw` into `daily_totals[day_key]`, where `day_key` is the UTC date of `ts`. It never reads `balChg`, `sz`, `px`, `instId` or `subType`. The VREAD-06 check is `if pnl_val != 0.0 and not is_stable_value(_ccy):` then the bill is counted in `_okx_non_usd_census` (keys are the ccy code after `_OKX_CCY_CODE_RE`) and skipped; after the loop `if _okx_non_usd_census:` records `_record_dq_flag("daily_pnl_non_usd_okx", True)` and `return []`. Consequences: (1) a spot buy's USDT leg contributes 0 (pnl 0, fee 0), so spot buys are P&L-neutral in the USD sum; (2) the coin leg of a buy contributes only its (negative) fee; (3) BTC price moves on a held balance never appear in bills at all.

**What is provable from stored PROD rows** (read-only via `supabase db query --linked`, marker query first; it returned the production marker; one query per call; no ids recorded here):
- [VERIFIED: PROD strategy_analytics, 3 strategies] `data_quality_flags.fee_currency_mismatch_samples = ['okx:BTC-USDT:BTC']` and `okx_fills_reach_clamped = true`. The flag is written by `_check_fee_currency_mismatch` [VERIFIED: exchange.py:405-426] only when a fill's fee currency differs from the pair's quote currency. So the venue's fills for BTC-USDT report a BTC fee.
- [VERIFIED: PROD trades, order_type='daily_pnl', exchange='okx', from 2026-11-12] for each of the 3 strategies, rows on 2026-11-12 (large, buy-side), 2026-11-14 (side `sell`, absolute value under 0.01) and 2026-11-20 (side `sell`, absolute value under 0.01); every `fee_currency` is `USDT`; no later rows (the derive refusal stopped the stores). The two tiny rows are BTC-sized amounts that the pre-232 aggregator summed as if USDT.
- [VERIFIED: PROD allocator_holdings, keys sharing identical balances] 2026-11-12 three rows, 2026-11-13 and 2026-11-14 two rows with 0 BTC; asof 2026-11-15 BTC about 75% of value (quantity about 1.48); asof 2026-11-21 BTC about 99.7% (quantity about 1.98). `created_at` / `updated_at` of each asof's rows is 01:00 to 01:09 UTC on that same date (queried for one key, asof 11-13 to 11-22), so asof D is the state at the END of UTC day D-1.
- [VERIFIED: PROD api_key_nav_marks, venue okx] 4 keys x 29 rows, `mark_day` 2026-10-26 to 2026-11-23, all `native_unit = 'USD'` (0 NULL, 0 BTC). `mark_day` is the closed day (label check below).
- [VERIFIED: PROD compute_jobs] `derive_broker_dailies | failed_final | derive_broker_dailies: realized read incomplete (daily_pnl_non_usd_okx)`: 24 rows since 2026-11-24, the only `daily_pnl`-named failures. No other job kind fails on this refusal.
- [VERIFIED: PROD strategy_analytics] the 3 strategies' `returns_series` ends 2026-11-23 (210, 208, 274 points, starting 2026-02-23 / 2026-04-30 / 2026-02-23), status `complete`, no `native_unit` flag, flag `daily_pnl_non_usd_okx` present.

**Verdict.** The 11 `ccy=BTC` bills are the spot BTC fees of the two buy days. [ASSUMED for the count and instType] that exactly 11 fee bills correspond to the fills on those two days; every stored indicator is consistent and none contradicts. **The booking record's buy dates are off by one**: bill days are UTC 11-14 and 11-20, and the 11-15 / 11-21 dates are holdings `asof` labels (see "Switch rule" and the Summary). A live read is needed only to pin the count, `instType` (SPOT vs MARGIN), `fee` vs `pnl` placement, and that no `ccy=BTC` bill has `pnl` nonzero (which would be a different case: a BTC-margined P&L).

**Live read, if wanted (plan 01 task, read-only, worker-side).** A key decrypts only inside the Railway worker, so model it on `analytics-service/scripts/derivegaps_probe.py` and `walletoffset_probe.py` (both are read-only probes with a `ReadOnlyRecordingExchange`, a redaction contract of counts, booleans and closed tokens, and a deploy-fingerprint check). The new probe calls the repo's real `fetch_daily_pnl`-equivalent bill walk through the recording view and emits per (UTC day, ccy, instType, subType): bill count, sign of `fee`, whether `pnl` is zero, and a fee/balChg ratio bucket (never amounts). Run it once through a temporary start-command wrapper on the backfill worker, paste only the redacted lines. This is a founder-gated step (production venue credentials); the plan must not depend on it for SC-1 to SC-4, only record its result.

## Standard Stack

No new packages. All work is inside the existing stack.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pandas (analytics-service) | pinned in `analytics-service/requirements.txt` | segment series, `DatetimeIndex` math | already the engine's type |
| ccxt | pinned in `requirements.txt` | OKX bills (`private_get_account_bills`, `_archive`) | already used by the OKX branch |
| pytest + pytest-asyncio | `asyncio_mode = auto` in `pytest.ini` | Python tests | existing suite (500 files under `tests/`) |
| mypy `--strict` | `pyproject.toml` `[tool.mypy] strict = true` | typing gate | CI blocking on `services/ routers/ models/` |
| vitest | `package.json` `"test": "vitest run"` | TypeScript tests | existing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JSON sidecar column | segment table | a table needs RLS + policies + an owner-coherence trigger for a handful of rows per strategy; rejected as heavier than the problem |
| `api_key_nav_marks` as the two-unit store | the hypothesis | refuted, see Storage verdict |

**Installation:** none. **Package Legitimacy Audit:** not required, this phase installs no external packages. **Banned packages (CLAUDE.md):** none involved.

## Storage verdict (question 2)

**Hypothesis refuted as the primary design; partly valid for marks only.**

1. USD rows hold `'USD'`, not NULL. [VERIFIED: nav_marks.py `build_mark_read`, branch `elif native_unit is None:` then `unit_out = "USD"`; and PROD: 116 rows, 0 NULL, 116 `'USD'`]. NULL is reserved for Deribit, whose figures live in `native_detail`. Constraints, quoted verbatim [VERIFIED: supabase/schema/baseline.sql:13939-13943]:
   - `CONSTRAINT "api_key_nav_marks_native_basis_chk" CHECK ((("native_unit" IS NOT NULL) OR ("native_detail" IS NOT NULL)))`
   - `CONSTRAINT "api_key_nav_marks_native_scalars_chk" CHECK (((("nav_native" IS NULL) = ("open_pnl_native" IS NULL)) AND (("nav_native" IS NULL) = ("native_unit" IS NULL))))`
   - `CONSTRAINT "api_key_nav_marks_native_unit_chk" CHECK ((("native_unit" IS NULL) OR ("native_unit" ~ '^[A-Z]{2,10}$'::"text")))`
   - `CONSTRAINT "api_key_nav_marks_price_day_chk" CHECK ((("price_day" IS NULL) OR ("native_unit" IS NOT NULL)))`
   - `CONSTRAINT "api_key_nav_marks_label_chk" CHECK (("mark_day" = ((("marked_at" AT TIME ZONE 'UTC'::"text"))::"date" - 1)))` and `UNIQUE ("api_key_id", "mark_day")`.
   Every constraint is per row; nothing ties rows of one key to one unit. So a USD-then-BTC sequence of marks is schema-legal, with no migration.
2. But the marks are not the series. The table is WRITE-ONCE (comment at baseline.sql:13953: "WRITE-ONCE: the first writer of a day wins ... service_role holds SELECT and INSERT only") and "Marks start at deploy; nothing is backfilled (D-09)". The 11-14 to 11-23 marks of this account are therefore permanent `'USD'` rows inside what would be the coin segment; they cannot be rewritten as BTC rows. A reader may convert them (`nav_native / close` is not available because `nav_native = nav_usd` for USD rows, so the BTC level is `nav_usd / P(price_day)` with the stored BTC close) but the stored unit label stays `'USD'`.
3. The consumer of marks assumes one unit per call. [VERIFIED: job_worker.py:642-668, `_marks_in_series_unit`] returns `None` (the whole key is refused, reason `_MARK_UNIT_MISMATCH` = `"mark_unit_mismatch"`, "a named refusal that writes nothing") as soon as ONE mark's `native_unit` differs from the series unit. [VERIFIED: job_worker.py:10282-10290] "Key mode is always USD" for the call. A switched key needs marks filtered per segment before this call.
4. Where the series actually lives:
   - Strategy mode: `strategy_analytics.returns_series`, `daily_returns`, `monthly_returns`, `sparkline_returns` (jsonb), unit in `data_quality_flags->>'native_unit'` (one per row). There is NO database constraint on that flag (grep of `baseline.sql` finds `native_unit` only on `api_key_nav_marks`; the "database CHECK" mentioned in `native_to_usd.py` comments does not exist as a CHECK on `data_quality_flags`). [VERIFIED: analytics_runner.py:2141-2149 and 2325-2326 carry the flag present-only through the wholesale rebuild; `native_to_usd.native_units_by_id` and TS `parseReturnsUnit` are the only parsers.]
   - Key mode: `allocator_equity_derived`, kind `key_inputs:<api_key_id>`, JSONB payload carrying `native_unit`, `priced_through`, `unpriced_days`, `segment_terminals` [VERIFIED: job_worker.py:9535-9548 and 11053-11069; allocator_equity_compose.py `read_native_key_inputs`]. `kind` has no CHECK ("Add a new family = INSERT a new row; no ALTER TABLE", baseline.sql comment on `kind`).
   - `trades` daily rows: `fee_currency: "USDT"`, price = abs(P&L). They must NEVER receive coin rows (every reader reads them as USDT).
5. Readers that assume one unit per key or row (census below) number about 25 across Python and TypeScript; none supports two units, and several (`native_units_by_id`, `convert_native_returns_to_usd`, `UsdSeriesConverter.convert`, `_marks_in_series_unit`) treat ANY non-None unit as "price the whole series with BTC closes".

**Recommended minimal design (founder answers 2026-11-27: headline whole record in USD, BTC part converted at the daily close):**
- The existing columns hold ONE series in ONE unit, USD, over the whole history: USD-segment returns through day S, then the coin segment's native returns converted day by day with the existing `convert_native_returns_to_usd` (`usd_k = (1 + r_k) * P(d_k) / P(d_{k-1}) - 1`). No `native_unit` flag is written, so `native_units_by_id`, `parseReturnsUnit`, `UsdSeriesConverter`, `analytics_runner`'s benchmark pairing (`_native_unit is None`), the KPI gate and every blend read it as the plain USD row it truly is. No unmodified reader can read a mixed series, because the stored series is not mixed. The converter drops day 0 of a native series; that is the base day S, whose USD return is carried by the USD segment, so no day is dropped and none is doubled. A day with no usable close is absent by name (the converter's own honesty rule) and the existing `missingSegments` seam draws it.
- The native two-unit series is stored once in a sidecar the presentation reads: `unit_segments = [{unit: "USD", from, to, returns}, {unit: "BTC", from, returns}]` plus a small `data_quality_flags.unit_switch = {coin, switch_day, first_coin_return_day}` (carried present-only like `native_unit`, analytics_runner.py:2325-2330) so list surfaces can show the note without reading the sidecar. The sidecar lets the chart draw the break and the factsheet state "In USD to 14 Nov, in BTC from 15 Nov" (copy built from the derived date, never a literal).
- Sidecar location, one-way choice for the planner: **recommended** a new nullable `jsonb` column `strategy_analytics.unit_segments` (one additive migration, typed in `src/lib/database.types.ts`; no new table and no new policy because it is a column on a table that already has RLS). Zero-migration alternative: `data_quality_flags.unit_segments`, but `data_quality_flags` is rebuilt wholesale by the runner and also copied into `last_success_snapshot`, so a 270-point native series would be duplicated and every carry site edited; `series_provenance` (existing jsonb object column) is documented as range metadata only. If a column is added the migration lane rules apply (one serial migration, `scripts/lint-migration-data-dependence.mjs` clean, baseline-currency marker, migration-reviewer + rls-policy-auditor, re-base on the latest definition of anything it replaces). Key mode: NO migration; extend the `key_inputs` JSON payload additively with `unit_segments` (the 167.1.2.2 D-15 additive voice already used there); the key's USD levels for the book are the converted ones.
- Risk to name: the stored headline series depends on the daily closes at derive time; a close that arrives later turns an absent day into a present one on the next derive (idempotent, same as MT5 BTC accounts today).

## Switch rule (question 3)

**Conventions that must be fixed in the plan first.** Three clocks exist, all verified: bills carry `ts` bucketed by UTC day (`day_key = dt.strftime("%Y-%m-%d")`, exchange.py:2051); holdings `asof D` is taken about 01:00Z on D, so it is the end-of-day state of D-1; a mark's `mark_day = (marked_at at UTC)::date - 1` is the closed day itself (label check quoted above). Normalise everything to "end-of-UTC-day state of day X": holdings end-of-day = `asof - 1`; mark end-of-day = `mark_day`.

**Candidate rule.** Inputs: (1) `coin_first_bill_day[coin]` and bill counts from the bills census (nonzero `pnl + fee`, funding type 8 already dropped, non-stable `ccy`); (2) end-of-day holdings by day: value share per coin from `allocator_holdings` (`symbol`, `value_usd`, `asof`), stable symbols counted through `is_stable_value`; (3) the live balance share now. Define `coin_dominant_day(d)` as the coin with value share of at least 50% at the end of day d. Result `(switch_day S, coin)` where S is the earliest of (first end-of-day coin-majority day) and (first nonzero coin-bill day), PROVIDED the bill coin equals the majority coin, and the majority is still held at the latest observation. Reading S: the UTC day on which the USDT was converted; the account's end-of-day state on S is already coin. **Boundary convention (recommended, supersedes the CONTEXT's autonomous boundary choice, see Pitfall 1):** the USD segment's last return day is S (the conversion day, a fully USD-measured day, end of S priced at that day's close); the coin segment's BASE level is end of S (no return for S, as for day 0 of any series); the coin segment's first return day is S+1. Check against the real account: bills give S = 2026-11-14 (stored row on 11-14), holdings give first coin-majority snapshot asof 2026-11-15 = end-of-day 2026-11-14 at about 75% BTC, so S = 11-14 and the first coin return day is 2026-11-15, which is exactly the founder's "USD before 11-15, BTC after". The plan SUMMARY records: derived S = 11-14, first coin return day 11-15 = founder's reading; the one-day offset is the holdings-label convention, not a disagreement.

**Named refusals** (closed token set, in the style of `READ_INCOMPLETE_TOKENS`): `no_coin_evidence` (no coin bill and never coin-majority: the account never switched; fetch keeps `daily_pnl_non_usd_okx`), `coin_bills_without_majority` (coin bills but never a majority: SC-4's "any other coin with no switch still refuses"), `two_coins` (bill coin differs from majority coin, or two coins both qualify), `switch_back` (coin majority then stable majority again: second switch, deferred), `ambiguous_boundary` (a holdings gap of more than one day spans S, or the earliest evidence is on the wrong side of a missing snapshot), `holdings_unavailable` (no holdings history AND no live balance), `bills_precede_majority_beyond_tolerance` (see below), `stable_bill_before_unclear_state`. Every refusal keeps today's behavior for the key (the existing named failure), never a guess.

**Gradual mover.** Fixture: coin fee bills on day d, holdings 10% coin on d, 30% on d+1, 60% on d+2. With the min rule S = d (first coin bill), not d+2 (first majority). Under majority-only S = d+2, the bills on d and d+1 would lie inside the USD segment and trip the refusal, which is the failure the CONTEXT wants avoided. Honest cost: days d and d+1 are measured in the coin unit while the account is mostly stable; accept and bound it with `COIN_LEAD_TOLERANCE_DAYS` (recommended 14): when coin bills precede the majority day by more than the tolerance, refuse `bills_precede_majority_beyond_tolerance` instead of reporting weeks of a mostly-USDT account in BTC. This tolerance is a product choice for the founder; flag it. Required fixtures: (a) the real shape (all USDT to 11-13, 75% on 11-14 end of day, 99.7% on 11-20 end of day) gives S = 11-14; (b) a differently shaped account (say a 3-day gradual move 40 days earlier) gives its own date; (c) dust coin (under 1% for months, e.g. the small unrelated 0.0005 BTC key in the data) gives `no_coin_evidence`, not a switch; (d) switch then switch back gives `switch_back`; (e) holdings gap at S gives `ambiguous_boundary`; (f) a new key with bills only and no holdings history uses the live balance and the bills; (g) USDT-quote spot SELL fee (USDT) does not count as a coin bill.

## fetch_daily_pnl design (question 3/SC-4)

`fetch_daily_pnl` (exchange.py:1868) is called through `fetch_all_trades` (exchange.py:3658) by at least five consumers that all read the refusal flag: the derive (key and strategy mode; job_worker.py:9605-9640, token set at 5047/5065), `sync_trades` Phase 1 (job_worker.py:2394), the cron tick (`routers/cron.py:500`, `_FETCH_NON_USD_FLAG`), `okx_archive_job` (`_Stop("live_anchor_unusable", "live_realized=non_usd")`, okx_archive_job.py:1664), and `daily_pnl_read_verdict` (exchange.py:267). Changing the refusal inside the fetch would silently change all five. Recommended: add a keyword-only `unit_switch: UnitSwitch | None = None` to `fetch_daily_pnl` / `fetch_all_trades`. With `None` (default; every current caller) behavior is byte-identical (refuse). Only the derive passes a switch. With a switch, bills whose ccy equals `switch.coin` and whose UTC day is on or after S are accumulated in a separate per-(day) coin total and returned on a new side channel (a second ContextVar beside `_LAST_DQ_FLAGS`, drained by the caller, never mixed into the `daily_pnl` list); any other non-stable ccy, or a coin bill before S, still refuses by name. Chicken-and-egg: S depends on the bills census, which the fetch produces. Resolve with a two-step in the derive: first read always returns the census (per-coin first day and count, a counts-only side channel stamped even on refusal), the derive calls `derive_unit_switch(census, holdings, live_balance)`, and if a switch exists re-reads once with `unit_switch=` (or splits the already-read bills, if the fetch is refactored to return raw per-(day, ccy) totals). Prefer returning per-(day, ccy) totals from one read and doing the booking decision in a pure post-step; the OKX walk costs up to the derive deadline (`DAILY_PNL_READ_DEADLINE_S`) and a second full read is wasteful. `sync_trades`, the cron tick and `okx_archive_job` keep refusing a switched account by name until a later phase gives them the seam; the plan must state this explicitly and pin it (they are not part of SC-5, only the derive jobs are), and must check that no new failure mode appears for the three strategies' `trades` store (it already stopped on 11-20 and is not a reader of the series).

## Reader census (question 4)

**Effect of the founder's answers (2026-11-27).** The stored headline series is the whole-history USD series (coin segment converted at the daily BTCUSDVIEW close), with no `native_unit` flag. So every reader that consumes `returns_series` / `daily_returns` as USD stays correct with no code change; the readers that need new code are the DERIVE (it must produce that series) and the PRESENTATION surfaces that show the two native segments (chart break, "In USD to 14 Nov, in BTC from 15 Nov" label, KPI note). SC-3 still demands a rule and a RED-on-origin/main test per reader; for an unchanged reader the rule is "reads the all-USD series as USD, no unit read" and its test is RED on origin/main because main produces no series for the account at all (the derive refuses, the series ends 2026-11-23); the test feeds the reader the switched account's stored row shape (USD whole history, `unit_switch` flag present, `native_unit` absent) and asserts the reader's USD figure AND that it never reads or prices the `unit_switch` sidecar as a unit. Common RED recipe: go through the EXISTING public entry point and assert behavior; an ImportError is RED for the wrong reason and does not satisfy PROOF-01's "named arm first".

### Python (analytics-service)

| Reader | Today for a switched key | Minimal rule | Tests to extend |
|---|---|---|---|
| `services/exchange.py` fetch (OKX branch) | refuses whole read | keep refusing with no switch; with a switch book switch-coin bills on/after the coin base day in the coin side channel; any other ccy refuses | `test_okxtrades_ccy.py` (FLAG tests at lines 83-164), `test_daily_pnl_read_verdict.py` |
| `services/job_worker.py` derive key + strategy mode (~9200-11100) | `failed_final`; strategy keeps last figures (`read_refusal_kept_figures`) | derive S; engine per segment; write the whole-history USD series (coin segment converted) to the headline columns, the native segments to the sidecar, `unit_switch` flag; end `done` so the kept-figures marker clears | `test_derive_broker_dailies_dualmode.py`, `test_mt5_derive_branch.py` (native precedent), `test_derive_last_success_snapshot.py` |
| `job_worker._marks_in_series_unit` (642) and the apply block (10282-10310) | refuses the whole key on one unit mismatch | filter marks by segment: USD marks to the USD segment; stored `'USD'` marks inside the coin segment converted `nav_usd / P(price_day)` for the native engine or dropped by name `mark_unit_mismatch`; new marks of a switched key written as `'BTC'` (`build_mark_read(native_unit="BTC")` is supported, `PRICED_NATIVE_UNIT`) or left USD if the derive applies marks in USD after conversion (planner's choice, see Open Question 1) | `test_nav_marks_derive_apply.py` (helper at line 168), `test_nav_marks_writer*.py` |
| `services/nav_twr.py` | single unit via `floors=UnitFloors` | no change; call per segment with `USD_FLOORS` and the BTC row; never chain across S | `test_nav_twr.py` |
| `services/account_unit.py` | `classify_account_currency` is MT5-terminal-currency only; no per-key unit lookup exists | add segment helpers beside it; `classify_account_currency` unchanged | `test_account_unit.py` |
| `services/native_to_usd.py` converters | any non-None unit prices the whole series with BTC closes | used per coin segment only (never on the whole row); no change to the converter | `test_native_to_usd.py` + shared oracle `tests/fixtures/native_to_usd_oracle.json` |
| `services/analytics_runner.py` (2135-2150, 2325-2330) | carries `native_unit`, skips benchmark for native | reads the USD series, pairs the benchmark normally (no `native_unit`); carries `unit_switch` present-only | `test_csv_analytics_runner.py` |
| `services/wealth_returns.py` (315) | `keep_absent` only when `native_unit` present | unchanged (USD row) | `test_wealth_returns.py` |
| `services/allocator_equity_compose.py` (148, 636-653) | native-unit key omitted by name (D-13); `segment_terminals` precedent | key_inputs carries the USD levels (coin segment priced by BTCUSDVIEW) and `unit_segments` additively; a missing close withholds that day by name via the existing `unpriced_days` / `segment_terminals` roll | `test_allocator_equity_native_unpriced.py`, `test_derive_allocator_equity_job.py`, `test_nav_marks_compose_roundtrip.py` |
| `services/strategy_matching.py`, `routers/match.py`, `routers/portfolio.py`, `routers/simulator.py` | `native_units_by_id` then `UsdSeriesConverter` | unchanged: the row is USD, no unit, no conversion at read | `test_match_router.py`, `test_portfolio_router_logic.py`, `test_simulator_router.py` |
| `services/mt5_parity*.py`, `scripts/flowtiming_dry_run.py` | MT5-only | out of scope; one-line test an okx key never enters [ASSUMED, verify the venue gates] | `test_mt5_parity_*.py` |
| `services/okx_archive_job.py` (1664), `routers/cron.py` (500, 547) | refuse by name | unchanged and pinned (see fetch design) | `test_okx_archive_job.py`, `test_cron_router.py` |

### TypeScript (src)

| Reader | Today | Minimal rule | Tests to extend |
|---|---|---|---|
| `src/lib/queries.ts` (606-654, ~925 `effectiveListFlag`) | list rows read one unit per row | read as a USD row (unchanged); project `unit_switch` as one more enumerated scalar (the 606-611 comment allows only enumerated scalars out of the private blob) for the list note | `queries.native-unit-ranking.test.ts`, `queries.test.ts` |
| `src/lib/factsheet/fetch-and-build-payload.ts` (491, 911-932), `types.ts` (1021-1027), `build-payload.ts`, `compute.ts` | single `returnsUnit` (absent for this row) | payload gains `unitSegments` (from the sidecar); KPIs stay the USD headline; add the switch note; do not set `returnsUnit` | `fetch-and-build-payload.test.ts`, `returns-unit.test.ts`, `headline-basis.test.ts`, `resolve-series.test.ts` |
| `src/lib/factsheet/returns-unit.ts` | label composer | add a segment-label composer "In {unit} to {d}, in {unit} from {d}" built from the derived dates, unit as a parameter, wording the founder's | `returns-unit.test.ts` |
| chart components fed by the payload | one series | draw two native segments with a visible break and unit label at the switch day, no joining line (reuse the `missingSegments` seam idea); read `DESIGN.md` first | chart tests beside the component |
| `src/app/api/strategies/[id]/returns/route.ts`, `src/app/api/og/factsheet/[id]/route.tsx`, `src/app/factsheet/[id]/v2/page.tsx` (bump the payload cache version, the file's own v11 to v12 comment shows the pattern) | one unit label | pass segments and the label through; USD returns unchanged | `route.test.ts`, `route.test.tsx`, `page.public-cache-key.test.tsx` |
| `src/app/scenario-share/[token]/*`, `ScenarioComposer.tsx`, `StrategyTable.tsx` (1934), `departed-history.ts` (413) | convert native legs by `returnsUnit` | USD row, unchanged; StrategyTable may show a chip naming the switch date; departed-history needs nothing unless the key-mode stamp carries a switch reason | their existing tests |

## Architecture Patterns

### System Architecture Diagram

```
 OKX venue (bills live+archive, balance)                allocator_holdings (daily 01:00Z snapshots)
        |                                                      |
        v                                                      v
 fetch_daily_pnl (OKX walk) --per-(day,ccy) totals--> derive_broker_dailies (job_worker)
        |  census (coin, first day, count)                      |  end-of-day holdings, live balance
        +-----------------------> derive_unit_switch (pure) <---+
                                      | (S, coin)  or  named refusal token
                                      v
              split bills at S ---> USD segment (<= S)       coin segment (base at end of S, returns from S+1)
                                      |                              |
                          nav_twr(USD_FLOORS)                nav_twr(BTC floors)  <- marks filtered per segment
                                      |                              |
                                      +--------- persist -----------+
         key mode: allocator_equity_derived key_inputs:<id> (USD levels + unit_segments)
         strategy mode: strategy_analytics columns = WHOLE-history USD series (coin segment
                        converted at the daily BTCUSDVIEW close), flag unit_switch,
                        unit_segments sidecar = the two native segments
                                      |
        +-----------------------------+-----------------------------+
        v                             v                             v
 TS payload/factsheet/KPIs     Python blends (portfolio,       allocator book compose
 (USD headline unchanged;       simulator, match): read the     (USD levels; missing close withholds
  sidecar -> chart break,       all-USD row as USD, no code     that day by name via unpriced_days /
  switch label and note)        change                          segment_terminals)
```

### Recommended Project Structure
```
analytics-service/services/
├── unit_switch.py          # pure: derive_unit_switch(census, holdings, live) -> UnitSwitch | Refusal
├── account_unit.py         # unchanged classify_account_currency; segment helpers beside it
analytics-service/tests/
├── test_unit_switch.py     # fixtures (a)-(g) above
├── test_okx_unit_switch_fetch.py
├── test_okx_unit_switch_derive.py
src/lib/factsheet/
├── unit-segments.ts        # segment-label composer + cross-switch withhold reasons
```

### Pattern 1: engine run per segment (MT5 BTC path is the precedent)
**What:** call the NAV/TWR core separately for each unit with its own floors and its own terminal anchor; never chain a return across S. **When:** any series whose unit changes. **Source:** [VERIFIED: nav_twr.py module docstring and `floors=USD_FLOORS` keyword; job_worker.py:9217-9548 native MT5 derive builds a native series, then converts for the USD key identity].

### Pattern 2: refusal by closed token
New refusals join `READ_INCOMPLETE_TOKENS` (job_worker.py:5047-5065, "A token outside the set is never written, so a venue message cannot reach the row") and the `_DAILY_PNL_REFUSAL_ORDER` tuple if they are realized-read reasons; keep the permanent/transient classification (`_TRANSIENT_REFUSAL_TOKENS`) explicit per token.

### Anti-Patterns to Avoid
- **Writing coin rows into `trades` as `daily_pnl`:** read as USDT by `sync_trades`, the analytics runner and the archive.
- **Converting each coin BILL to USD and keeping one USD series built from USD-valued bills (option A), or restating history in BTC (option B):** founder-rejected as the P&L basis. The coin segment's bills stay in BTC; only the finished native RETURNS are converted at the daily close for the headline (the founder's 2026-11-27 reader answer).
- **A mixed-unit `returns_series` with a per-element `unit` field or a sentinel `native_unit`, or a BTC-flagged headline row:** old readers ignore the field or price the whole series with BTC closes, and a BTC flag would also pull the headline out of the USD KPI gate, benchmark pairing and blends the founder wants it in.
- **A hard-coded 11-15 or any date:** SC-1.
- **Restating the arm tallies, floors or counts from memory** (CLAUDE.md): cite by symbol.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-unit NAV/TWR | a second return engine | `nav_twr.reconstruct_nav_and_twr` / `chain_linked_twr` with `floors=` | dust, tiny-base, flow timing and fail-loud guards already encoded |
| BTC to USD view | a new converter | `convert_native_returns_to_usd` / `UsdSeriesConverter` and the TS twin | one shared oracle fixture keeps the runtimes equal |
| Stable-coin test | a literal list | `price_rule.is_stable_value` (`STABLECOINS | STABLECOIN_SPLIT_SUFFIXES`) | same rule as the equity reconstruction |
| Ccy code validation | ad-hoc strings | `_OKX_CCY_CODE_RE`, `parse_native_unit`, `parseReturnsUnit` | the venue's currency text is third-party text (T-232-09) |
| Refusal plumbing | new error paths | the closed-token machinery (`READ_INCOMPLETE_TOKENS`, `daily_pnl_read_verdict`) | one reader of the refusal set |
| Read-only live probe | a new harness | `scripts/derivegaps_probe.py` redaction contract and `ReadOnlyRecordingExchange` | already reviewed for a public repo |

## Common Pitfalls

### Pitfall 1: the autonomous boundary choice drops a day
CONTEXT says the coin segment carries the switch day and the USD segment ends the day before. The coin segment's first day is its BASE level and has no return (day 0 is dropped by every chain-link and by `convert_native_returns_to_usd`, "Day 0 is dropped"), so day S would have a return in NEITHER unit, which violates SC-2 ("no day dropped"). **Avoid:** USD segment through S inclusive, coin base at end of S, first coin return S+1 (the rule above). The founder's copy ("In USD to 14 Nov, in BTC from 15 Nov") matches this convention exactly. **Reconciling the CONTEXT wording:** if the stored `switch_day` is defined as the first coin RETURN day (15 Nov), the CONTEXT's 'coin segment carries the switch day, USD ends the day before' reads correctly, with the coin base level at the end of 14 Nov being the USD segment's last day. Plan 01 must pin that definition in one sentence and amend the CONTEXT wording so no executor reads it as dropping 14 Nov.

### Pitfall 2: the KPI gate (resolved by the founder's answer)
Headline KPIs run on the whole USD record, which passes the total-record gate (60 observations / 90 days crypto) today, so the coin segment's age (about 13 observations) withholds nothing. What remains: no headline figure may be computed on native segments; segment-level figures, if shown at all, are presentation-only, and the headline is all-USD by construction.

### Pitfall 3: holdings label off by one
`asof D` is end of D-1. Mixing it with bill days or `mark_day` without normalising yields S off by one day, a wrong segment split of the whole coin day and a real double count of the conversion day. Test with the real account shape ("Switch rule" real-shape fixture).

### Pitfall 4: BTC fee bills before the coin is the majority
See the gradual-mover fixture; do not majority-only.

### Pitfall 5: historical `'USD'` marks inside the coin segment
Immutable. Handle per segment (convert or drop by name), and write new marks as BTC, or `_marks_in_series_unit` refuses the whole key each night.

### Pitfall 6: unrealized coin price moves are not in bills
Bills hold only realized P&L and fees. In USD the BTC price move reaches the series only through marks re-basing; in BTC the same move correctly vanishes. A test must pin that a flat BTC balance with a falling BTC price produces a (near) zero BTC return and a negative USD view, never the reverse.

### Pitfall 7: shared TEST and PROD ordering for the SC-5 check
`apply-test` runs before a migration reaches PROD and PROD migrations now auto-apply once `apply-test` succeeds (CLAUDE.md, 2026-09-23): there is no human stop, so any migration is reviewed BEFORE merge. Also: all four keys are one account; every derive job (4 key-mode + 3 strategy-mode) must be re-checked, and the 3 strategies' `read_refusal_kept_figures` (a key on the job's `compute_jobs.metadata`, written by `mark_compute_job_kept_figures`) clears only when a later job for the same strategy ends `done`.

### Pitfall 8: the three-clock mismatch on the first nightly after deploy
The derive that follows the deploy sees BTC marks missing for 11-14 to the deploy day; the coin-segment marks rule must produce a series without a hole or name the holes (`unpriced_days` precedent).

## Code Examples

### The switch seam's signature (Pattern; names are the planner's, per Claude's Discretion)
```python
# Pure, stdlib + typing only, no I/O (leaf module like account_unit.py).
@dataclass(frozen=True, slots=True)
class UnitSwitch:
    coin: str            # validated, upper-case, passes _CURRENCY_CODE_RE
    switch_day: str      # ISO UTC day S: last USD return day, coin base at its end
    first_coin_return_day: str   # S + 1

def derive_unit_switch(
    coin_bill_days: Mapping[str, tuple[str, int]],   # coin -> (first UTC day, count)
    end_of_day_holdings: Sequence[tuple[str, Mapping[str, float]]],  # day -> {symbol: value_usd}, asof already shifted by -1
    live_share: Mapping[str, float] | None,
) -> UnitSwitch | str:   # str is a closed refusal token
    ...
```
Source: this research, built on [VERIFIED: account_unit.py purity contract "stdlib + typing ONLY ... LEAF"].

### Marker query before any PROD statement (CLAUDE.md)
```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```
It returned `PRODUCTION - real customer data. No seeds, no fixtures, no DELETE without a scoped id.` on 2026-11-27 (research session; read-only, via `supabase db query --linked`, since no MCP SQL tool was available to this agent).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sum OKX bills at face value as USDT | VREAD-06 refuses a non-stable ccy | Phase 232 (v0.133.70.0, 2026-11-24) | froze this account |
| One unit per key, MT5 BTC only | two-unit series for an OKX stable-to-coin mover | this phase | no reader supports it today |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Exactly 11 bills correspond to the buy fills of 11-14 and 11-20 (count, instType) | Bills finding | Low: only changes the census count, not the design; confirm by the live probe |
| A2 | OKX charges the buy fee in the coin bought on every fill of this account (the 2026 FAQ says it depends on the fill) | Bills finding | Medium: a fill with USDT fee on a buy would be a stable bill and sums normally; no impact on correctness |
| A3 | `mt5_parity*` and `flowtiming_dry_run` are MT5-venue-gated and never see an OKX key | Reader census | Low: verify by reading the venue gates in plan 01 |
| A4 | `COIN_LEAD_TOLERANCE_DAYS = 14` | Switch rule | Medium: product choice, founder to confirm |
| A5 | New `prior_segments` jsonb column has no public view or column grant enumerating `strategy_analytics` columns that needs editing | Storage verdict | Medium: migration-reviewer / rls-policy-auditor must confirm; if a grant lists columns, the lane must update it |
| A6 | Strategy-mode derive builds its series from the live realized read (not from `trades`) | fetch design | Medium: the derive test file `test_derive_broker_dailies_dualmode.py` settles it in plan 02; if it reads `trades`, coin rows have no home there and the strategy path must carry coin totals another way |
| A7 | The key-mode OKX equity anchor is `totalEq` in USD (a BTC level is anchor / latest completed close) | Plans | Medium: confirm in `fetch_account_equity_and_upnl_usd`; the BTC `eq` of the balance detail is the alternative |

## Open Questions

1. **What is the BTC-unit base level and terminal anchor for key mode?**
   - Known: OKX equity is read as USD (`totalEq`); marks are USD; `price_live_balance` prices a native balance at the previous completed day's close; MT5 BTC is the only native precedent.
   - Unclear: whether to anchor the coin segment on the venue's BTC balance or on `totalEq / P`; the 0.3% USDT residual drifts in BTC terms.
   - Recommendation: plan 03 spike first; anchor on `totalEq / P(latest completed day)` and treat the stable residual as part of the unit-priced NAV (document), re-based by marks per segment.
2. **Day label.** Settled by the founder's copy: "In USD to 14 Nov, in BTC from 15 Nov", built from the derived dates (last USD return day S = 14 Nov, first coin return day 15 Nov). Record both in the plan SUMMARY.
3. **Remaining product choice:** `COIN_LEAD_TOLERANCE_DAYS` (A4). Headline and blend policy are settled by the founder's 2026-11-27 answers.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| python3 (+ pytest, pandas, mypy) | analytics tests and typecheck | yes | 3.14.3 locally (CI uses 3.12) | none needed; `tests/test_okxtrades_ccy.py tests/test_account_unit.py` ran 41 passed |
| supabase CLI | PROD reads (`db query --linked`) | yes | 2.84.2 | run from the main checkout (linked), not the worktree |
| Supabase MCP SQL tool | PROD reads | not available to this agent | — | CLI (used) |
| node_modules in the worktree | vitest / tsc | no (absent in `quantalyze-wt-256`) | — | `npm ci` in the worktree before TS tasks, or the main checkout's install |
| Railway worker access / venue credentials | the live bills probe (SC-5 read, optional bill proof) | founder-gated | — | stored-row evidence above (sufficient for design) |

**Missing with fallback:** node_modules (install), MCP SQL (CLI). **Blocking:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest + pytest-asyncio (`asyncio_mode = auto`), vitest, mypy strict |
| Config file | `analytics-service/pytest.ini`, `analytics-service/pyproject.toml`, `vitest.config.ts` |
| Quick run command | `cd ./analytics-service && python3 -m pytest tests/test_unit_switch.py tests/test_okxtrades_ccy.py -x -q` |
| Typecheck | `cd analytics-service && make typecheck` (same path set as the ci.yml mypy step) |
| TS | `npx vitest run src/lib/factsheet src/lib/queries.native-unit-ranking.test.ts` after `npm ci`; `npm run typecheck` |
| Full suite | `cd analytics-service && python3 -m pytest` (pytest ONLY from `analytics-service/`); `npm test` |

### Phase Requirements to Test Map
| Req | Behavior | Test type | Automated command | File exists? |
|-----|----------|-----------|-------------------|-------------|
| SC-1 | two differently shaped accounts give their own S; refusal tokens | unit | `pytest tests/test_unit_switch.py -x` | Wave 0 gap |
| SC-2 | boundary day in one unit, none doubled/dropped; units named | unit | `pytest tests/test_okx_unit_switch_derive.py -x` | Wave 0 gap |
| SC-3 | one RED test per reader in the census | unit/component | files listed in the census | extend existing |
| SC-4 | 11 BTC bills book in coin; never-switch and other coin refuse | unit | `pytest tests/test_okxtrades_ccy.py tests/test_okx_unit_switch_fetch.py -x` | extend + gap |
| SC-5 | 7 nightly derives end `done` | manual PROD read after deploy and the next nightly | marker query, then `compute_jobs` for kind `derive_broker_dailies`, status, `metadata->read_refusal_kept_figures`; no ids in tracked text | manual-only (production state) |
| SC-6 | deviation recorded | grep | `grep -n "OKXUNITSWITCH" .planning/phases/232-*/232-CONTEXT.md .planning/ROADMAP.md` | notes exist, correct date |
| SC-7 | PROOF-01 | procedure | below | — |

### PROOF-01 per gate
Per gate: `cp <file> <scratchpad>/bak`, neuter the arm (e.g. make `derive_unit_switch` always return a refusal, or delete the coin-bill branch in the fetch), run the test file and capture the RED line naming the arm first, `cp bak <file>`, `cmp bak <file>` (must print nothing), run again GREEN, paste both outputs verbatim in the plan SUMMARY. Never `git checkout`, `git restore` or `git stash` on uncommitted work (founder rule). Money-math oracles must be independent invariants (a flat BTC balance, a falling price: BTC return about zero, USD view negative; USD plus coin segments' day counts equal the union with no overlap). `grep -a` always. A new `supabase/tests` file or arm moves several censuses: grep them all. If a migration is added: an RLS/SQL test beside `supabase/tests/test_api_key_nav_marks.sql`, migration-reviewer and rls-policy-auditor clean, `scripts/lint-migration-data-dependence.mjs` clean, and a re-dump marker regeneration if the baseline is re-dumped. A plan's own `file:line` anchors are re-resolved by the `plan-anchor-verify` CI job: keep anchors by symbol.

### Sampling Rate
- Per task commit: the task's own test file plus `make typecheck` for analytics changes.
- Per wave merge: `python3 -m pytest` from `analytics-service/`; vitest for touched TS.
- Phase gate: full suites green and the SC-5 PROD read before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_unit_switch.py` — SC-1 fixtures (a)-(g)
- [ ] `analytics-service/tests/test_okx_unit_switch_fetch.py` — SC-4 both ways
- [ ] `analytics-service/tests/test_okx_unit_switch_derive.py` — SC-2, per-segment engine, marks per segment
- [ ] TS: `src/lib/factsheet/unit-segments.test.ts` and extensions to the reader tests listed above
- [ ] `npm ci` in the worktree

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | no auth change |
| V3 Session Management | no | — |
| V4 Access Control | yes if a column/table is added | RLS unchanged on `strategy_analytics`; `allocator_equity_derived` is service-role-written, owner-read; `api_key_nav_marks` stays INSERT-only |
| V5 Input Validation | yes | venue `ccy` through `_OKX_CCY_CODE_RE` then the unit regex `[A-Z]{2,10}`; stored JSONB read as untrusted (`parse_native_unit`, `parseReturnsUnit`, `read_native_key_inputs` raising on malformed) |
| V6 Cryptography | no | keys decrypt only in the worker, unchanged |
| V7 Error handling / logging | yes | refusal tokens are a closed set; no venue text, ids or amounts in logs or tracked text |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Hostile venue string in `ccy` reaching a label or row | Tampering | regex-gate, counts-only logging, closed token set |
| Mixed-unit series read as USD (silent wrong figures) | Information integrity | fail-closed storage shape; per-reader RED tests |
| Account-size leak in tracked text (public repo) | Information disclosure | this document quotes ratios only; probe emits counts and tokens only |
| Write-once mark rewritten | Tampering | marks stay INSERT-only; conversion happens at read |

## Plans and waves (question 6)

Recommendation: ONE phase, FIVE plans, four waves. With the founder's whole-record-in-USD answer the headline series is a true USD series, so every blend, match, simulator and book reader is correct with no code change and the old plan 04 (Python readers) collapses into tests inside the derive plan. The backend (plans 01-03) unfreezes the derives (SC-5) and is safe to ship alone: nothing it stores is mixed-unit. Plan 04 (presentation) may be booked as a follow-up phase with `/gsd-phase` if the founder wants the unfreeze first; a split is NOT needed for correctness. Per project memory: one executor per plan, per-plan worktrees off the phase branch.

| Wave | Plan | Content | Depends on |
|---|---|---|---|
| 1 | 01 SWITCH | `derive_unit_switch` pure module, `UnitSwitch` type, refusal tokens, fixtures (a)-(g); read-only live-bills probe script (founder-gated run); amend CONTEXT's boundary wording (Pitfall 1) | — |
| 2 | 02 FETCH | `fetch_daily_pnl` per-(day, ccy) totals and optional `unit_switch`; coin side channel; census side channel; SC-4 pinned both ways; the other four consumers keep refusing (pinned) | 01 |
| 2 | 02b MIGRATION (conditional) | one nullable `jsonb` column `strategy_analytics.unit_segments`; `database.types.ts`; SQL test; migration lane review (migration-reviewer + rls-policy-auditor) | 01 (design only) |
| 3 | 03 DERIVE | engine per segment; whole-history USD series (coin segment converted); `unit_segments` and `unit_switch`; key_inputs payload; marks per segment; `read_refusal_kept_figures` clears; RED-on-main tests for every unchanged reader fed the stored row shape (blends, match, simulator, book compose, analytics_runner benchmark pairing, KPI gate) | 02, 02b |
| 4 | 04 PRESENT | factsheet payload `unitSegments`, label composer, chart break, KPI note, list note, StrategyTable chip, og and returns route, cache-version bump; read `DESIGN.md` first and `node_modules/next/dist/docs/` per AGENTS.md | 03 (data shape) |
| 5 | 05 CLOSE | CHANGELOG (naming the TODOS entries closed, if any), VERSION bump (VERSION and package.json byte-equal 4-digit), SC-6 correction (dates 11-14/11-20), PROOF-01 compile, deploy then the SC-5 PROD read and the next nightly derive | 03, 04 |

(If plan 04 is booked separately the close follows plan 03 at wave 4.) Per CLAUDE.md: never write the CI skip trailer in any commit or PR text, not even to deny it; no AI authorship trailers per project memory; a ship branch changes nothing under `.planning`; verification frontmatter uses `verified_at_sha` + `drift_subjects`, never `covered_files` / `covered_digest`; `TODOS.md` holds open work only.

## Project Constraints (from CLAUDE.md)

- Read `AGENTS.md` / `node_modules/next/dist/docs/` before writing Next.js code; read `DESIGN.md` before any UI decision (plan 05).
- PROD marker query first before any PROD statement; PROD reads authorized, writes only the product's own paths; never write PROD ids, secrets, home paths or amounts into tracked text.
- CHANGELOG entry for every ship, written before the push in the same commit as the VERSION bump; section vocabulary Fixed/Added/Changed/Removed/Tests/Notes/Security/Root cause/Why.
- `TODOS.md` open work only; ship deletes the entries it closes in the same PR and names them in the CHANGELOG.
- Never write the CI skip trailer in any commit or PR text, not even to deny it.
- pytest only from `analytics-service/`; mypy strict is a blocking CI gate for analytics changes; `grep -a`.
- Migrations: one serial lane, migration-reviewer + rls-policy-auditor clean before merge, re-base on the latest definition before `CREATE OR REPLACE`, deletion-cascade guards exempt `quantalyze.sanitize_in_progress='on'`, no data-reading `DO`-block guards (lint refuses).
- Deviation policy: the boundary change in Pitfall 1 and any founder override are recorded in the phase CONTEXT and the ROADMAP, never one alone.
- Data-integrity and user-facing gates must be able to fail (neuter, RED, restore from byte backup, GREEN).
- Annualization: risk by frequency (crypto 365), blends use 365 if any leg is crypto; never invent data: uncomputable metrics are null; KPI gate is on TOTAL record (60 observations / 90 days crypto), zoomed windows always show.
- Subagents and briefs quote decisions only from CONTEXT/ROADMAP.

## Sources

### Primary (HIGH confidence)
- Repo reads this session: `analytics-service/services/exchange.py` (OKX branch 1868-2140, window read 1781-1866, `_check_fee_currency_mismatch` 405-426, `daily_pnl_read_verdict` ~255-275), `services/account_unit.py`, `services/native_to_usd.py`, `services/nav_marks.py` (`build_mark_read`), `services/job_worker.py` (642-668, 5039-5075, 9500-9560, 9590-9680, 10270-10310, 11035-11090), `services/analytics_runner.py` (2135-2160, 232-250), `services/allocator_equity_compose.py` (140-165, 630-660), `supabase/migrations/20261029120000_api_key_nav_marks.sql`, `supabase/schema/baseline.sql` (13685-13706, 13922-13985, `allocator_holdings` 13710-13750, `strategy_analytics` 15026-15090), ROADMAP and 232-CONTEXT notes.
- PROD read-only queries 2026-11-27 (marker query first, production marker returned): marks, holdings, holdings timestamps, stored daily P&L, `strategy_analytics` flags, `compute_jobs`.

### Secondary (MEDIUM confidence)
- [CITED: okx.com/docs-v5/en] "Get bills details (last 7 days)" (fields, subType codes; retention/archive endpoints per the repo's own constants).
- [CITED: okx.com/help/trading-fee-rules-faq], [CITED: okx.com/sv/help/fee-details] (spot fee currency rule; the 2026 EU FAQ says it depends on the fill).

### Tertiary (LOW confidence)
- Nothing relies on search results alone; the live count of the 11 bills and any `fee` vs `pnl` placement remain UNPROVEN until the live probe.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages.
- Bill finding: HIGH on cause (three stored indicators plus the venue rule), UNPROVEN on the exact count.
- Storage verdict: HIGH — read the schema, writers and readers.
- Switch rule: MEDIUM-HIGH — verified against the real shape; tolerance and boundary convention need founder confirmation.
- Reader census: MEDIUM — located by grep and targeted reads; each plan re-reads its reader before editing.
- Architecture / plan sizing: MEDIUM.

**Research date:** 2026-11-27
**Valid until:** 2026-12-04 (fast-moving: several other phases touch derive and compose files; re-run `grep` for the cited symbols before planning)

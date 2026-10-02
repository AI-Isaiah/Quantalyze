# Phase 20 — Red-Team Findings (pre-execution)

**Red-teamed:** 2026-06-14
**Reviewer stance:** Skeptical/adversarial staff engineer. Default to distrust. Financial product — the failure mode is a plausible-but-WRONG Sharpe reaching an allocator-facing page.
**Verdict:** **DO NOT EXECUTE AS WRITTEN.** One CRITICAL correctness bug invalidates the central design decision (dense calendar) and silently corrupts every annualized KPI (Sharpe, vol, CAGR, Calmar, Sortino). Several HIGH/MEDIUM coverage gaps make "passing" tests unable to catch the very regressions they exist for.

Legend: **[VERIFIED]** = confirmed by reading the actual code/running it this session. **[INFERRED]** = reasoned from verified facts but not directly executed.

---

## CRITICAL

### C1 — Dense-calendar + `periods=252` annualization mismatch SILENTLY CORRUPTS Sharpe, vol, CAGR, Calmar, Sortino. [VERIFIED]

This is the #1 failure mode the entire phase exists to prevent, and the plan walks straight into it.

**Plan location:**
- `20-01-PLAN.md` Task 2 behavior T5 + `must_haves.truths`: *"A gap fixture is densified to one row per calendar day and volatility is computed on that dense calendar (T5)"* and *"assert that volatility from compute_all_metrics equals the dense-calendar hand-computed vol."*
- `20-02-PLAN.md` must_have: *"The EA emits ONE row per calendar day (0.0 on no-trade days) — a dense calendar (T5)."*
- `20-CONTEXT.md` / `20-RESEARCH.md` Pitfall 2: locks the EA to a dense ~365-row/yr calendar.

**Why it's wrong (verified arithmetic):**

`analytics-service/services/metrics.py` calls the quantstats scalars with **no `periods` argument**, so they use the quantstats `0.0.81` default `periods=252, annualize=True` [VERIFIED — `requirements.txt:3` pins `quantstats==0.0.81`; signatures inspected live]:
- `metrics.py:440` → `qs.stats.volatility(returns)` → `std * sqrt(252)` [VERIFIED — read `quantstats/stats.py` volatility body: `return std * _np.sqrt(periods)`]
- `metrics.py:441` → `qs.stats.sharpe(returns)` → `(mean/std) * sqrt(252)` [VERIFIED — sharpe body: `res * _np.sqrt(... periods)`]
- `metrics.py:446` → `qs.stats.sortino(returns, rf=MAR)` → `periods=252` default
- `metrics.py:439` → `qs.stats.cagr(returns)` → `years = len(returns) / 252` [VERIFIED — cagr body: `years = len(returns) / periods`]
- `metrics.py:447` → `qs.stats.calmar(returns)` → CAGR-derived, same `periods=252`

`quantstats._utils._prepare_returns` does **NOT drop zero rows** — it only `dropna()`s NaN and `fillna(0)`s [VERIFIED — read utils body]. So the dense calendar's zero-return weekend/holiday rows are KEPT in the std and in `len(returns)`.

Net effect for a series whose TRUE annualized vol is computed over 252 trading days, but emitted as a dense ~365-row calendar:
- The zero rows deflate the daily `std` by `sqrt(252/365) = 0.831`.
- quantstats still multiplies by `sqrt(252)`, not `sqrt(365)` → annualized vol and Sharpe are deflated by exactly that factor.
- CAGR divides by `years = 365/252 ≈ 1.45` instead of `1.0`, deflating CAGR even harder.

**Measured (ran end-to-end against the pinned quantstats `0.0.81` this session):**

| KPI | trading-only (truth) | dense calendar @252 (PLAN) | error |
|---|---|---|---|
| Volatility | 0.1535 | 0.1275 | **−16.9%** |
| Sharpe | 0.7588 | 0.6307 | **−16.9%** (ratio 0.831) |
| Sortino | 1.1498 | 0.9554 | **−16.9%** |
| CAGR | 0.1105 | 0.0750 | **−32%** |
| Calmar | 0.8167 | 0.5547 | **−32%** |

Annualizing the SAME dense series with `periods=365` recovers the truth exactly (vol 0.1535, Sharpe 0.7590, CAGR 0.1105) [VERIFIED]. So the bug is purely the calendar-density / annualization-constant mismatch, not the data.

**This is end-to-end live, not hypothetical:** `analytics_runner.py:2014-2027` builds `returns = pd.Series(values, index=DatetimeIndex(...))` straight from the persisted `csv_daily_returns` rows and calls `compute_all_metrics(returns, ...)` with no `periods` override [VERIFIED]. A dense MT5 series flows directly into `periods=252` annualization and onto the factsheet.

**Cross-strategy comparability corollary (also money-path):** the EXISTING exchange path `transforms.trades_to_daily_returns` groups by `date` ONLY on days with trades — it emits a SPARSE (trading-day) calendar [VERIFIED — `transforms.py:127` `df.groupby("date")`]. The existing reference fixture is literally named `golden_252d` [VERIFIED]. So the entire system's annualization is built around a ~252 trading-day calendar. Shipping MT5 on a dense 365 calendar means an MT5 manager's Sharpe is annualized on a *different basis* than every OKX manager's — an allocator ranking a 0.63 MT5 Sharpe against a 0.76 OKX Sharpe for identical underlying performance systematically under-ranks the MT5 manager. Apples-to-oranges on the comparison page.

**The cruelest part:** `20-01-PLAN.md` Task 2 instructs the executor to *hand-compute the expected vol ON THE DENSE CALENDAR* and assert that. That means the test will compute the WRONG (deflated) number by hand and then assert the pipeline reproduces it — a green test that PERMANENTLY BLESSES the bug. The hand-computed-oracle discipline (meant to be the defense) is pointed at the wrong target and becomes the bug's accomplice. This is exactly the "test that can't fail when business logic is wrong" anti-pattern.

**Specific fix (fold into the plan before any task runs):**
Pick ONE, in order of preference:

1. **(Preferred) Emit a SPARSE / trading-day calendar** — one row only on days the market was open / a trade or equity change occurred — matching the exchange path's convention and `periods=252`. Then `qs.stats.*` annualizes correctly and MT5 is comparable to OKX. This deletes the dense-calendar requirement from `20-02-PLAN.md` entirely and changes T5 to "gap/non-trading days are simply absent; vol annualizes on the trading-day calendar." NOTE: this needs a clear rule for what counts as a "trading day" for an account that may hold an overnight position over a weekend with floating-PnL moves — likely: emit a row for any calendar day the *equity changed* (incl. weekend floating-PnL marks if the broker marks them), skip flat no-change days. This must be specified, not left to the EA author.

2. **If a dense calendar is genuinely required** (e.g. the product wants weekend floating-PnL marks represented): then `compute_all_metrics` MUST annualize that strategy with `periods=365` (and `cagr` with 365). That is a **production code change** to `metrics.py` / `analytics_runner.py` — out of scope for a "no new ingestion code" phase, and risky because the periods constant is currently global (changing it for CSV-MT5 without touching OKX needs a per-strategy `periods` plumb-through). The plan currently claims zero production changes (`20-01-PLAN.md` Task 3 acceptance: *"No production service file ... modified"*), which is INCOMPATIBLE with a correct dense calendar. Surface and resolve this contradiction explicitly.

3. **Whatever is chosen**, the T1/T5 hand-computed oracles must be computed against the CORRECT annualization, and the T5 test must assert the *trading-day-annualized* (or 365-annualized) value, with an inline comment proving a calendar/periods regression flips it. Add an explicit assertion that the MT5 path's annualization basis matches the exchange path's (or documents why it differs).

> Until C1 is resolved, T2/T5 being "must-pass before any KPI is page-visible" (CONTEXT line 70-73) is hollow: the gate would pass on a wrong number.

---

## HIGH

### H1 — T5 acceptance criterion bakes in the wrong number; the must-have is unfalsifiable-in-the-right-direction. [VERIFIED]

**Plan location:** `20-01-PLAN.md` Task 2 `<acceptance_criteria>`: *"The T5 test asserts a dense-calendar volatility value with an inline comment contrasting it against the sparse value (so a sparse-series regression fails)."*

Even ignoring C1's annualization bug, this criterion is backwards. It is designed to FAIL if someone "regresses" to a sparse series — but per C1 the sparse series is the CORRECT one for `periods=252`. So this acceptance criterion actively guards the bug and would reject the fix. **Fix:** after resolving C1, rewrite this criterion to assert the correctly-annualized vol and to fail if the *annualization basis* drifts (e.g. assert `qs.stats.volatility(series) == approx(hand_value)` where `hand_value` used the matching periods).

### H2 — T7 fixture sits ~75x below the auto-÷100 trigger; it cannot catch a percent-detection regression. [VERIFIED]

**Plan location:** `20-01-PLAN.md` Task 1 behavior T7: *"a realistic fractional series (e.g. daily_return values ~±0.001–0.02)."*

The auto-÷100 normalizer fires only when non-zero median |x| ∈ (0.5, 100] [VERIFIED — `csv_validator.py:321-323`, `PERCENT_FORM_AUTO_NORM_LOWER=0.5`]. A series with values ~±0.001–0.02 has non-zero median |x| ≈ 0.0067 [VERIFIED by computation] — **75x below the 0.5 trigger**. A regression that lowered the trigger (say to 0.005) would still pass this test. Per Rule 9, a test that can't fail when the logic breaks is wrong.

**Fix:** add a *boundary* fixture whose non-zero median |x| sits just BELOW 0.5 (e.g. 0.48 with max |x| ≤ 1.0) and assert `info_flags == []` (proves the lower edge is respected), PLUS keep a realistic fixture. Optionally add a just-ABOVE case (median 0.52) asserting the flag DOES fire, to pin both sides of the threshold. The existing `test_csv_validator_percent_form_2026_05_25.py` already pins the *fires* direction with a median ~0.9 file; T7's job is the *does-not-fire* edge, so it must actually approach the edge.

### H3 — The dense calendar weakens the daily-Sharpe fraud sentinel (a security control). [VERIFIED]

**Plan location:** implicit consequence of the dense-calendar decision (`20-02-PLAN.md` must_have) interacting with `csv_validator._check_sharpe_sentinel`.

`_check_sharpe_sentinel` (`csv_validator.py:223-238`) rejects a file whose *daily* Sharpe `(mean/std, zeros kept)` > 10.0. Zero-padding a dense calendar pulls both the mean and the std down; measured, daily Sharpe drops ~22% (0.662 → 0.516) for the same underlying trading performance [VERIFIED by computation]. So a too-good-to-be-true series that SHOULD trip the >10 sentinel on a trading calendar can SLIP UNDER it on a dense calendar. The phase's own threat register (`20-01-PLAN.md` T-20-01) names this sentinel as a mitigation — the dense calendar partially disarms it. This is a second, independent reason to prefer the sparse/trading-day calendar (fix per C1 option 1 removes this too).

### H4 — T10 / T11 fixtures are unfalsifiable: a `date,daily_return` CSV cannot test deal classification at all. [INFERRED, grounded in verified contract]

**Plan location:** `20-01-PLAN.md` Task 1 behaviors T10, T11; `must_haves` claim *"Each of ... T10, T11 ... has a checked-in golden fixture + a hand-computed KPI (or rejection/flag) assertion."*

The fixture is a final `date,daily_return` series — the deal classification (which deals are excluded as flows vs included as costs) happens entirely inside the EA *before* the CSV exists. A T10/T11 fixture therefore tests only that "a number the author typed validates and produces that number" — it has ZERO power to detect a misclassification, because the author hand-writes the post-classification return. The real classification logic (E5) lives in MQL5 and is only checked by the manual T14 reconcile. The plan half-acknowledges this (T10/T11 marked "EA-side math; fixture pins the CSV"), but the `must_haves` and threat register present these as meaningful coverage. **Fix:** explicitly downgrade T10/T11 (and T2/T3/T4/T6) CI fixtures to "contract-shape pins" in the plan text and the success criteria, and make the *binding* classification check the T14 reconcile checklist — which leads to H5.

### H5 — T14 manual reconcile is the ONLY real test of deal classification and restart-state, yet it is specified as prose, not a concrete pass/fail checklist with expected numbers. [VERIFIED]

**Plan location:** `20-02-PLAN.md` Task 3 `<how-to-verify>` and `20-TEST-STRATEGY.md` §B.

T14/T15 gate the first live KPI and are the sole validation of E5 (balance-deal classification) and A1 (restart-state). But the steps are "open an overnight position, do a deposit and a withdrawal, restart, reconcile BY HAND ... the deposit/withdrawal days show the TRADING return." There is no concrete worked example: no "deposit $X at equity $Y → expected daily_return = Z (hand-computed)" table, no enumerated deal-type matrix to tick off (BALANCE/CREDIT/CHARGE/BONUS/CORRECTION/COMMISSION/INTEREST/SWAP), no tolerance, no "if return on the deposit day is within ±ε of the pre-deposit trading return, PASS." A human reconcile against vague prose will rubber-stamp a subtle misclassification (exactly the CORRECTION ambiguity flagged in A1). **Fix:** the README/checkpoint must include a filled-in numeric reconcile worksheet: a specific deposit amount, withdrawal amount, an overnight position with a known mark, and the EXACT expected `daily_return` for each affected day computed by hand from the flow-adjusted formula, plus a per-deal-type classification table the user ticks. This is the load-bearing gate; it must be falsifiable.

### H6 — CORRECTION default-to-flow is an unverified judgment call on a money path, with no test and a known-broker-variance risk. [VERIFIED against RESEARCH assumptions]

**Plan location:** `20-02-PLAN.md` `<interfaces>` deal table + Task 1 action ("`DEAL_TYPE_CORRECTION` (default — document per T11)"); RESEARCH A1.

`DEAL_TYPE_CORRECTION` is classified as an external flow (excluded) "by default," confirmed only "on broker in T14." A correction is frequently a *broker P&L adjustment* (e.g. a re-quote/slippage correction, a swap correction) — i.e. a genuine COST, not a capital flow. Defaulting it to "flow/excluded" would *remove a real loss/gain from the return*, overstating or understating performance. There is no fixture that can catch this (per H4) and T14 has no concrete CORRECTION row (per H5). **Fix:** treat CORRECTION as INCLUDED (a cost) by default unless it is explicitly a balance correction, OR make the EA emit corrections to the audit sidecar and require the T14 worksheet to explicitly reconcile at least one CORRECTION deal with a hand-expected result. Document the chosen default with its money-direction rationale, not just "per table."

---

## MEDIUM

### M1 — `BONUS` classified as an excluded flow can wrongly inflate returns. [VERIFIED against RESEARCH/plan table]

**Plan location:** deal table in `20-02-PLAN.md` `<interfaces>` and `20-RESEARCH.md` deal table: `DEAL_TYPE_BONUS` → EXTERNAL FLOW (exclude).

If a broker credits a bonus that is *withdrawable/tradeable equity*, excluding it as a flow is correct. But if the bonus is non-withdrawable credit that nonetheless shows in `ACCOUNT_EQUITY`, the equity basis and the flow subtraction can disagree, producing a one-day distortion. More importantly, `ACCOUNT_EQUITY` includes credit (per the cited AccountInfoDouble doc), so `prior_close_equity` may already carry credit while the BONUS deal subtracts it again as a flow — a possible double-count. This is untestable in CI and must be on the T14 worksheet. **Fix:** add a BONUS/CREDIT line to the T14 numeric reconcile; document whether `ACCOUNT_EQUITY` on the user's broker includes the credit and how the flow subtraction avoids double-counting.

### M2 — Deposit-day formula breaks on day 1 (no `prior_close_equity`) — divide-by-zero / garbage first return. [VERIFIED — formula inspection]

**Plan location:** `20-RESEARCH.md` §"The Deposit-Day Bug" and `20-02-PLAN.md` formula: `daily_return = (equity_close − net_external_flows − prior_close_equity) / prior_close_equity`.

On the very first day the account is funded, `prior_close_equity` is 0 (or undefined). The formula divides by zero → ±Inf / NaN. The first-ever row also has a deposit equal to the entire opening balance. The plan never specifies the inception/first-row rule. If the EA emits a first row at all, it will be garbage; if it divides by zero, FileWrite may emit `inf`/`nan` which then hits the route guards. **Fix:** specify that the first funded day either is omitted (series starts day 2 with day-1 close as the first `prior_close_equity`) or emits 0.0, and add a fixture/worksheet line pinning the inception rule. The prompt's deposit-on-day-1 case is real and unhandled.

### M3 — Withdrawal larger than intraday equity, and intraday deposit-then-trade, can produce a return on a base that didn't exist all day (T4). [VERIFIED — formula inspection]

**Plan location:** T4 (`20-01-PLAN.md` Task 2 behavior; CONTEXT line 50 "taste"; RESEARCH §"Intraday Flow Timing").

The gross-day-flow subtraction is exact only if flows land when no trading P&L is mid-accrual. For "deposit at 09:00 then trades," the trading return was earned on the *post-deposit* capital base, but the formula divides by `prior_close_equity` (pre-deposit). For a deposit that doubles the account, the reported return is roughly halved versus the true time-weighted return. The plan calls this "taste" and "flag if approximate," but a halved (or doubled, for a withdrawal) daily return is a real, material money-path error, not taste. **Fix:** at minimum, the T4 fixture's hand value must be computed with the *documented* convention AND the worksheet must show how far it diverges from the time-weighted truth for a large-flow day, so the magnitude of the approximation is known and accepted, not hand-waved. Consider requiring the EA to use the post-flow base for the trading portion (Modified Dietz) when a same-day flow is detected, since the math is not hard and the error is unbounded for large flows.

### M4 — T16 grep denylist has real false-negatives; a trade-capable EA can pass. [VERIFIED — regex analysis]

**Plan location:** `20-03-PLAN.md` denylist `OrderSend|CTrade|PositionClose|PositionModify|OrderModify|OrderDelete|trade\.`

Concrete evasions that pass the grep but place/modify trades:
- **`OrderSendAsync(...)`** — the async order-send API. `OrderSend` is a substring of `OrderSendAsync`, so `grep -E 'OrderSend'` DOES catch it. OK — not an evasion. **But** the low-level MQL5 trade API is `OrderSend` (struct-based `MqlTradeRequest`/`OrderSend`) — caught. The real gaps below remain.
- **`CTrade` via alias/typedef or a renamed include object:** `#include <Trade/Trade.mqh>` then `CTrade myExec;` and calls like `myExec.Buy(...)` — the call site is `myExec.Buy(`, which contains NEITHER `CTrade` (only the *declaration* line does — that IS caught by `CTrade`) NOR `trade.`. The declaration `CTrade` token is caught, so a literal `CTrade` decl is flagged. But `class X : public CTrade {}` then `X ex; ex.Buy()` — the `CTrade` base appears once (caught). Tighter gap: **`CExpertTrade`, `CTradeViaSignals`, or any custom wrapper class** that calls `OrderSend` internally in a *separate `.mqh`* not under `tools/mt5/*.mq5` — the grep only scans `tools/mt5/*.mq5`, so a trade call hidden in an `#include`d `.mqh` (or any non-`.mq5` extension) in the same dir is NOT scanned. [VERIFIED — glob is `tools/mt5/*.mq5` only].
- **`.Buy(` / `.Sell(` / `.PositionOpen(` / `.PositionClose(`** — CTrade's actual trade methods. The denylist has `PositionClose` (matches `.PositionClose(` ✓) and `PositionModify`/`OrderModify`/`OrderDelete`, but **NOT `Buy`, `Sell`, `PositionOpen`, `BuyStop`, `SellLimit`, `OrderOpen`**. A CTrade instance named anything other than `trade` (e.g. `exec.Buy(...)`, `t.Sell(...)`) calling `.Buy()`/`.Sell()` is NOT matched by any denylist token. This is a real, simple false-negative: a 3-line EA `CTrade e; e.Buy(0.1);` — `CTrade` decl is caught, BUT if the class is included from a `.mqh` the decl never appears in the `.mq5`.
- **Case / whitespace:** `grep -E` is case-sensitive; `ordersend` would evade — but MQL5 is case-sensitive too, so lowercase wouldn't compile. Low risk. Whitespace like `OrderSend (` is still matched (substring `OrderSend`). OK.
- **Comments:** `// OrderSend disabled` would trigger a FALSE POSITIVE (annoying but safe-side).

**Fix:** (a) scan `tools/mt5/**/*.{mq5,mqh}` recursively, not just top-level `*.mq5`, so included trade wrappers are covered; (b) add the CTrade method surface to the denylist: `\.(Buy|Sell|BuyStop|SellStop|BuyLimit|SellLimit|PositionOpen|PositionClosePartial|PositionReverse|OrderOpen)\s*\(`; (c) optionally allowlist-by-include — fail if any `#include <Trade/Trade.mqh>` or `Expert/` trade include is present at all (a recording EA has no reason to include the trade library). The threat register already accepts the false-negative risk (T-20-08) "Low residual," but the CTrade `.Buy()`/`.Sell()` gap is not low — it is the single most common way an MQL5 EA places a trade.

### M5 — T15 / A1 restart-state: corrupt/partial state-file write and first-run-missing-file paths are unspecified. [VERIFIED — plan omission]

**Plan location:** `20-02-PLAN.md` Task 1 action ("reload `prior_close_equity` and `last_snapshot_date` from a state file ... in OnInit") and Pitfall 3.

The plan correctly chooses file persistence over GlobalVariable, but does not specify:
- **First run (file absent):** OnInit reads a non-existent file. What is `prior_close_equity` then? (Should seed from current `ACCOUNT_EQUITY` and emit no return until the next rollover — otherwise M2's divide-by-zero recurs.)
- **Partial/corrupt write on kill mid-write:** if the terminal is killed *during* the state-file FileWrite, OnInit may read a truncated `prior_close_equity` (e.g. "123" instead of "1234.56") or an empty file → a plausible-but-wrong base, the exact failure A1 exists to prevent. The plan says "durable at write-time" but a single FileWrite is not atomic. **Fix:** write to a temp file then rename (atomic), or write a checksum/sentinel line and validate on read; on validation failure, fail loud (refuse to emit a return) rather than guess.
- **Timezone of the persisted `last_snapshot_date`:** the rollover keys off `TimeTradeServer()` (server time). If the persisted date and the comparison are in different zones (server vs local vs GMT), a restart across the boundary double-emits or skips. Specify the zone explicitly and persist it in the same zone used for the date label.
- **Concurrent EA instances** (two charts, or a re-attach): two instances writing the same CSV + state file in `MQL5\Files` race. The plan assumes one instance. **Fix:** document single-instance-only, or namespace the files per-chart/per-strategy and detect a second instance in OnInit.

These are all on the T14/T15 manual path with no CI backstop, so the README worksheet must explicitly exercise: kill-mid-write, first-run, and a clock change.

### M6 — `MAX_INGEST_ROWS = 5000` + "full history from inception, dense calendar" caps usable track record at ~13.7 years (vs ~19.8 on a trading calendar). [VERIFIED]

**Plan location:** `20-02-PLAN.md` must_have "emits the COMPLETE daily-return history from inception on every export" + dense calendar; `csv_validator.py:82` `MAX_INGEST_ROWS = 5000`; route cap `MAX_DAILY_RETURNS_ROWS` and persist RPC 5000-row cap.

A dense 365-row/yr series hits the 5000-row validator cap at ~13.7 years; the route rejects beyond that. A sparse 252-row/yr series lasts ~19.8 years. Not urgent for typical track records, but the "re-emit FULL history every export" contract means a long-running EA eventually trips the cap and the WHOLE upload is rejected (not truncated), silently breaking the user's re-upload. Fixing C1 toward a sparse calendar also relaxes this. **Fix:** note the cap in the README; decide behavior when history exceeds it (the contract currently has no graceful answer — the validator hard-fails the whole file at `csv_validator.py:716`).

### M7 — T13 fixture proves nothing the validator doesn't already guarantee for any date column. [VERIFIED — contract]

**Plan location:** `20-01-PLAN.md` Task 2 behavior T13 + acceptance "`grep -c '<boundary-date>,' fixtures/mt5/dst_boundary.csv` == 1."

A CSV-level fixture with one row per DST-boundary date tests only that a hand-written CSV with unique dates passes `_strictly_increasing` — which is true of EVERY valid daily_returns file [VERIFIED — `csv_validator.py:110-111`]. The actual DST risk (OnTimer firing twice or zero times around the clock jump) is 100% EA-runtime behavior with no CI surface. The fixture is a tautology. **Fix:** acknowledge T13's CI fixture as a shape-pin only and move the real DST check to a concrete T14/T15 worksheet step (run across an actual DST boundary on the demo account and confirm exactly one row for the boundary date).

---

## LOW

### L1 — `trade\.` denylist token will false-positive on benign identifiers. [VERIFIED]
`trade\.` matches `last_trade.symbol`, `trade.date`, a struct field, a comment "see trade.mqh", etc. Annoying but safe-side (fails build spuriously). Combined with M4's fix (targeting `.Buy(`/`.Sell(`), `trade\.` could be tightened or dropped. Low priority.

### L2 — ISO date emission relies on string-replace `.`→`-`; locale/format drift untested. [VERIFIED — RESEARCH note]
`TimeToString(..., TIME_DATE)` yields `YYYY.MM.DD`; the EA replaces `.` with `-`. The route hard-requires `^\d{4}-\d{2}-\d{2}$`. No CI test exercises the EA's actual date string (it can't). A fixture with a correctly-formatted ISO date doesn't prove the EA produces it. Put a "first row date is exactly `YYYY-MM-DD`" check on the T14 worksheet (eyeball the emitted CSV).

### L3 — `currency` column dtype is `pd.StringDtype()` with `coerce=True`; fixtures must not write a stray BOM/space. [VERIFIED — minor]
The validator lowercases+strips headers and the currency check `.fillna("").str.upper().isin(["","USD"])`. T8's "blank currency column" fixture must use truly-empty cells (not `" "` — which after `.str.upper()` is `" "` ≠ `""` and would FAIL `currency_usd_or_blank`). Wait: `.str.upper()` does NOT strip — a cell of `" "` becomes `" "`, not `""`, and fails. [VERIFIED by reading the lambda — it does NOT `.strip()`.] So a T8 fixture with a space in a currency cell would hard-fail, surprising the author. Ensure T8's blank cells are genuinely empty. Minor, but a real foot-gun for the fixture author.

---

## Things that are actually FINE (verified, not manufactured)

- **T12 "new strategy per upload" resolution is sound.** [VERIFIED] `finalize_csv_strategy` inserts a NEW `strategies` row per upload returning a new `strategy_id` (`csv-finalize/route.ts:18-21`), and `persist_csv_daily_returns` writes only that strategy's rows. Cross-upload stale rows are structurally impossible. The plan's decision to NOT add a DELETE/replace RPC is correct, and the deferred-risk note ("in-place re-upload would need a real replace path") is the right caveat. The only residual is that the T12 CI test (asserting "exact uploaded row set") is low-value since it can't fail given the structure — but it's harmless.
- **T8 / T9 currency contract.** [VERIFIED] `currency` is `required=False, nullable=True`; non-USD → `currency_usd_or_blank`, `ok=False`. T8/T9 assertions as specified are correct (modulo L3's empty-cell foot-gun).
- **Equity-vs-balance (T6) API choice.** [VERIFIED against cited docs] `AccountInfoDouble(ACCOUNT_EQUITY)` incl. floating PnL is right; avoiding `ACCOUNT_BALANCE` is right. (But see M1 re: credit in equity.)
- **No new packages / banned-package posture.** [VERIFIED] Phase adds zero npm/pip deps; T16 mirrors the existing banned-packages grep step.
- **`compute_all_metrics` fail-loud preconditions** (DatetimeIndex / float / monotonic) are real and the runner satisfies them. [VERIFIED]
- **MQL4-name avoidance** (`AccountEquity`/`AccountBalance`/`OrderSelect`) is correctly called out and grep-checked.

---

## Coverage check — are all 16 tests concretely tasked?

| Test | Concretely tasked? | Note |
|---|---|---|
| T1 | Yes | `20-01` Task 2; oracle must be re-derived per C1 |
| T2 | Yes | `20-01` Task 1; CI fixture is a contract-pin only (H4) |
| T3 | Yes | `20-01` Task 1; contract-pin only (H4) |
| T4 | Yes | `20-01` Task 2; convention magnitude unquantified (M3) |
| T5 | Yes | `20-01` Task 2 — **but asserts the WRONG number (C1/H1)** |
| T6 | Yes | `20-01` Task 2; contract-pin only |
| T7 | Yes | `20-01` Task 1 — **fixture too far from boundary (H2)** |
| T8 | Yes | `20-01` Task 1 (watch L3) |
| T9 | Yes | `20-01` Task 1 |
| T10 | Yes | `20-01` Task 1; unfalsifiable for classification (H4) |
| T11 | Yes | `20-01` Task 1; unfalsifiable (H4); CORRECTION default risky (H6) |
| T12 | Yes | `20-01` Task 2; low-value but correct (FINE) |
| T13 | Yes | `20-01` Task 2 — tautological CI fixture (M7) |
| T14 | Yes | `20-02` Task 3 — **prose, not a numeric falsifiable worksheet (H5)** |
| T15 | Yes | `20-02` Task 3 — restart edge cases unspecified (M5) |
| T16 | Yes | `20-03` Task 1 — **denylist false-negatives (M4)** |

All 16 are tasked. The problem is not coverage breadth; it's that several "passing" tests cannot fail when the underlying logic is wrong (T5, T7, T10, T11, T13) and the two binding manual gates (T14, T15) are under-specified.

---

## Acceptance-criteria / structural quality flags

- `20-01-PLAN.md` Task 2 T5 acceptance criterion is **self-contradictory with correctness** (H1) — must be rewritten, not just tweaked.
- `20-01-PLAN.md` Task 3 acceptance "*No production service file modified*" is **incompatible with a correct dense calendar** (C1 option 2). One of {calendar decision, no-prod-change constraint} must yield. Flag and resolve before execution.
- `20-02-PLAN.md` Task 3 (T14) `<how-to-verify>` is the highest-stakes gate in the phase and is **subjective/unfalsifiable** as written (H5) — needs a numeric worksheet with expected values and tolerances.
- Every task has a `<read_first>`. Good.
- The `must_haves.truths` in `20-01` and `20-02` that assert "dense calendar / vol on dense calendar" are **wrong invariants** per C1 — they will be satisfied by the buggy implementation, which is worse than missing.

---

## Ranked summary

1. **C1 (CRITICAL)** — Dense-calendar + `periods=252` silently deflates Sharpe ~17%, vol ~17%, CAGR ~32%, Calmar ~32%, and breaks cross-strategy comparability with the existing sparse OKX path. The hand-computed T5 oracle is aimed at the wrong number and would permanently bless the bug.
2. **H1** — T5 acceptance criterion guards the bug and would reject the fix.
3. **H4 / H5** — The only real test of deal classification is the manual T14 reconcile, which is specified as vague prose, not a numeric falsifiable worksheet; the CI fixtures for T2/T3/T4/T6/T10/T11 cannot detect a misclassification.
4. **M4** — T16 denylist misses CTrade `.Buy()`/`.Sell()`/`.PositionOpen()` and only scans top-level `*.mq5` (not included `.mqh`); a trade-capable EA can pass.
5. **H2 / H3 / H6 / M1–M3 / M5–M7** — boundary-blind T7, weakened Sharpe sentinel, risky CORRECTION/BONUS defaults, day-1 divide-by-zero, intraday-flow magnitude, restart-file corruption, row cap, tautological T13.

### THE SINGLE MOST IMPORTANT THING TO FIX BEFORE EXECUTION

**Resolve C1: change the EA to emit a SPARSE / trading-day calendar (matching the existing exchange path's `groupby(date)` convention and the global `periods=252` annualization), and re-derive the T1/T5 hand-computed oracles against the CORRECT annualization.** As written, the dense-calendar decision guarantees that every MT5 strategy's Sharpe, vol, CAGR, and Calmar reach the allocator page understated by 17–32%, with the phase's own must-pass T5 test certifying the wrong value. That is precisely the "plausible-but-wrong Sharpe on an allocator-facing page" failure this phase was created to prevent — shipped by the phase itself. If a dense calendar is truly required for product reasons, the alternative fix is a per-strategy `periods=365` plumb-through into `compute_all_metrics`, which is a production code change the plan currently forbids — so that contradiction must be surfaced and decided first, not discovered mid-execution.

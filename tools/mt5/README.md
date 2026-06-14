# QuantalyzeDailyReturns — MT5 daily-equity-return recorder

`QuantalyzeDailyReturns.mq5` is a **read-only** MetaTrader 5 Expert Advisor (EA).
Once per calendar day it snapshots your account's **total equity**, removes
external cash flows (deposits / withdrawals / credits), and appends one
`date,daily_return` row to a CSV inside the MT5 `MQL5\Files` sandbox. You then
retrieve that CSV and upload it through Quantalyze's existing **daily-returns CSV
wizard** — it feeds the same analytics → factsheet pipeline every crypto
strategy already uses.

The EA **never places, modifies, or closes a position.** It calls only read APIs
(`AccountInfoDouble`, `HistorySelect` + the `HistoryDeal*` getters,
`TimeTradeServer`) and file I/O. A CI static-check greps the source and fails the
build on any trade-mutation API.

---

## 1. USD-only (deliberate)

The CSV the EA emits is **`date,daily_return` with no `currency` column**, and a
blank/absent currency validates fine. The ingestion contract is **USD-only by
design**:

- A file with **no currency column** (what this EA emits) validates OK (test T8).
- A file with **`currency=EUR`** (or any non-USD value) is **HARD-REJECTED** by
  the validator with rule `currency_usd_or_blank` (test T9).

Why: Quantalyze's KPI/comparison surface assumes a single base currency so that
Sharpe / vol / CAGR are apples-to-apples across every strategy on the ranking
page. Mixing currencies would silently compare returns measured in different
units. **Run the EA on a USD-denominated account.** If your demo/live account is
denominated in another currency, the daily-return *fractions* are still
unit-less and technically uploadable — but you are then responsible for the fact
that the underlying equity moves are not USD; this is unsupported and not
reconciled. Use a USD account.

---

## 2. Deploy & run

1. **Copy** `QuantalyzeDailyReturns.mq5` into your terminal's data folder under
   `MQL5\Experts\` (in the terminal: *File → Open Data Folder*, then drop the file
   into `MQL5\Experts`).
2. **Compile** it in MetaEditor (open the `.mq5`, press *Compile* / F7). This
   produces `QuantalyzeDailyReturns.ex5`. There must be **zero** compile errors.
3. **Attach** the EA to **one** chart. Any symbol works — the EA reads
   *account-level* equity, not the chart symbol. Enable **Algo Trading** in the
   terminal (the EA needs to run, but it issues no trades).
4. Confirm the EA is running: the chart shows the EA name in the top-right and
   the *Experts* log prints a `Quantalyze: first run — seeded base equity=…`
   (first run) or `Quantalyze: restart — loaded base equity=…` (restart) line.

### Single instance only

Attach the EA to **exactly one chart in one terminal.** Two instances would race
the shared CSV + state file and corrupt both. `OnInit` claims a process-wide
named lock and **refuses to start** a second concurrent instance in the same
terminal. To record two *different* accounts, run two **separate terminals /
data folders** (each has its own `MQL5\Files` sandbox) — never two charts in one
terminal.

---

## 3. Where the files land & how to upload

All files live in the terminal data folder under `MQL5\Files\`:

| File | Default name (configurable input) | Purpose |
|------|-----------------------------------|---------|
| **CSV** | `quantalyze_dailies.csv` | The upload artifact: header `date,daily_return`, one row per calendar day. |
| **State** | `quantalyze_state.csv` | Restart state: `prior_close_equity` + last server-date, atomically written. **Do not edit or upload this.** |
| **Audit sidecar** | `quantalyze_audit.log` | Human-readable log of inception / restart / large-flow flags / CORRECTION deals. Used during the T14 reconcile. **Not uploaded.** |

**To upload:** in the terminal, *File → Open Data Folder → MQL5 → Files*, copy
`quantalyze_dailies.csv` out, then run Quantalyze's **daily-returns CSV wizard**
and pick that file. The wizard validates and computes the KPIs.

### Dense calendar-daily contract

The EA emits **one row per calendar day**. The strategies here trade on crypto
venues (OKX / Bybit, **24/7/365**), so **every calendar day is a real trading day
and every row is a genuine equity-based return** — there are **no synthetic
weekend/holiday zeros**. Annualization downstream is unchanged:
`compute_all_metrics` uses quantstats `periods=252` (the product-wide displayed
basis, identical to every crypto strategy), so an MT5 strategy's Sharpe/vol/CAGR
rank apples-to-apples against the OKX strategies.

### What "close" means (the equity each row divides by)

A day's **close** is the **last `ACCOUNT_EQUITY` reading the EA captured *before*
that day rolled over** — i.e. the most recent pre-midnight snapshot. The EA reads
equity on **every timer tick** (default every **15s**) and keeps the latest value;
when the server date flips, the value left over from just before midnight is used
as the completed day's close. (It is **not** the first reading *after* midnight —
that would drift the close up to one timer period of 24/7 market movement into the
*next* day.) The 15s cadence keeps that pre-rollover reading within ~15s of true
midnight. Equity always **includes floating PnL** of open positions (test T6); it
is never the cash balance.

### Multi-day outage (the EA was off across several days)

If the EA was offline for a span, the missed days **produce no rows at all** — the
EA does **not** fabricate a zero (or a near-zero) row for each missed day (that
would be exactly the synthetic-zero vol-deflation the dense-calendar decision
forbids). Instead, on its next run the EA emits **one** row, dated the **most
recent fully-completed day**, carrying the **cumulative return since the last
snapshot** (the whole move across the gap, with all external flows in the span
netted out). That single row is **flagged `GAP-SPAN …` in the audit sidecar** so
the **T14 reconcile treats it as a span, not one clean day** — its magnitude will
look like several days of return compressed into one row, which is expected. A
multi-day gap therefore yields **fewer rows**, never a fabricated zero, and never
loses the cumulative move.

### Row cap: `MAX_INGEST_ROWS = 5000`

The downstream validator caps a file at **5000 rows** and **hard-rejects the
whole file** beyond that (it does not truncate). At one row per calendar day that
is **~13.7 years** of history. The EA re-exports the **complete history from
inception** each time (so re-upload is a full replace). A long-running EA will
eventually approach the cap — when it does, you must trim the oldest rows from
the CSV yourself before upload, or the validator will reject the entire file.
This is a known limit, documented here so it is not a surprise.

> **Deferred risk (out of scope for Phase 20):** the upload wizard mints a *new*
> strategy per upload, so re-uploads do not leave stale rows. An **in-place
> re-upload into an existing `strategy_id`** would need a real replace path — that
> is out of scope for Phase 20.

---

## 4. `DEAL_TYPE_CORRECTION` caveat (broker-dependent)

A `DEAL_TYPE_CORRECTION` deal is **broker-dependent**:

- It can be a **balance correction** → a capital **flow** (should be *excluded*
  from the return), or
- It can be a **broker P&L / slippage / swap correction** → a genuine **cost**
  (should be *included* in the return).

There is no universally-correct default, so the EA does **not** silently default
to "flow." **The EA's chosen default is COST (included in the return)** — i.e. a
correction is left inside equity and is *not* subtracted as a flow. Rationale:
corrections most commonly adjust realized trading P&L, and erasing a real
gain/loss is the more damaging error than leaving a small balance-correction
inside the return. The default is configurable via the `CorrectionIsFlow` input
(`false` = cost, the default; `true` = flow). **Every CORRECTION deal is logged
to the audit sidecar**, and **you MUST confirm your broker's actual CORRECTION
semantics in the T14 reconcile** (there is a dedicated worksheet row) before any
live KPI is trusted.

---

## 5. MANUAL acceptance gates — T14 & T15 (human-only, NOT CI)

> **These gates are human-only.** They run on **your** MT5 terminal + a **demo**
> account and **cannot run in CI**. They are the **only** real test of the MQL5
> balance-deal classification, the CORRECTION default, the intraday-flow bound,
> the day-1 inception rule, the atomic restart persistence, and DST-rollover
> correctness — none of which have a CI harness. **They gate the first live KPI,
> not this phase's CI completion.** Do not trust any live KPI from this EA until
> every worksheet row below is within tolerance.

### 5.1 T14 — demo-account NUMERIC reconcile worksheet

Run this **scripted sequence on a DEMO account** with the EA attached (single
instance). Pick concrete numbers; the worked example below uses an initial
deposit of **$10,000** for illustration — substitute your own and recompute.

Let `ε = 1e-4` (one basis point on the fraction) be the pass tolerance per day,
reflecting equity rounding. Each `|expected − actual| ≤ ε` is **PASS**.

#### Scripted day-by-day sequence

- **Day 1 — initial funding.** Deposit `$X` (e.g. $10,000). Do nothing else.
  - **Expected `daily_return` = `0.0000`** — the **inception rule** (base = initial
    equity; no prior close to divide by). The EA writes this 0.0 row **dated the
    funding day itself** (Day 1) — *not* the next-rollover date. (The first row's
    `date` in the CSV must equal the funding date.)
  - After Day 1, `prior_close_equity = $X` (+ any Day-1 trading P&L, here $0).

- **Day 2 — overnight position.** Open a position and **let it carry overnight**.
  Let Day-2 closing **equity** (which **includes the floating PnL** of the open
  position, test T6) be `E2`.
  - **Expected `daily_return = (E2 − 0 − X) / X`** (no flow on Day 2).
  - Worked: if `X = 10,000` and `E2 = 10,150` → expected `= 150/10000 = 0.0150`.
  - After Day 2, `prior_close_equity = E2` (= 10,150).

- **Day 3 — withdrawal with the position still open.** Withdraw `$Y` (e.g. $2,000)
  while the position is open. Let Day-3 closing equity be `E3`. The withdrawal is a
  **negative external flow** (`net_external_flows = −Y`).
  - **Expected `daily_return = (E3 − (−Y) − E2) / E2 = (E3 + Y − E2) / E2`** — the
    withdrawal **does NOT depress** the return (test T3).
  - Worked: if `E2 = 10,150`, `Y = 2,000`, and the account closes at `E3 = 8,250`
    (i.e. 10,150 − 2,000 withdrawn + 100 trading gain), expected
    `= (8,250 + 2,000 − 10,150) / 10,150 = 100 / 10,150 = 0.0098…` → **0.0098522**.
  - After Day 3, `prior_close_equity = E3 + Y = 10,250` (flow-adjusted base).

- **Day 4 — kill + relaunch + sleep (doubles as T15).** **Kill** the terminal,
  **relaunch** it, then **sleep the laptop past the snapshot cutoff**. Let Day-4
  closing equity be `E4` (the **last equity the EA read before** Day 4 rolled over —
  see *What "close" means* above; if the relaunch + sleep keeps the EA running
  across the rollover, this is its latest pre-midnight reading). Sleep past **one**
  cutoff only, so Day 4 is a **single** completed day (a sleep spanning *several*
  days instead triggers the multi-day-outage path — see below — which emits one
  flagged `GAP-SPAN` row, not this clean single-day row).
  - **Expected `daily_return = (E4 − 0 − P) / P`** where `P` is the **persisted**
    `prior_close_equity` from Day 3 (= 10,250), **not** a fresh/zero base (test
    T15/A1). The return must be the sane *trading* return, not wildly off.
  - Worked: if `P = 10,250` and `E4 = 10,300` → expected `= 50/10250 = 0.0048780`.

- **Day 5 (optional) — multi-day outage (H3 gap check).** Turn the EA/terminal
  **off for 2+ full calendar days**, then relaunch. Confirm the CSV gains **exactly
  one** new row (dated the most-recent completed day), the missed days have **no**
  rows, and the audit sidecar carries a `GAP-SPAN …` line for that row. Hand-check
  that the row's return equals the **cumulative** move since the last snapshot,
  `(E_now − net_flows_over_gap − P) / P` — i.e. the whole gap move is preserved in
  the one row, not fabricated as per-day zeros.

#### Expected-vs-actual fill-in table

| Day | Scenario | Expected `daily_return` (hand-computed) | Actual (from CSV) | `|exp − act| ≤ ε`? (PASS/FAIL) |
|-----|----------|-----------------------------------------|-------------------|--------------------------------|
| 1 | Deposit $X (inception) | `0.0000000` | ________ | ___ |
| 2 | Overnight position carried | `(E2 − X)/X` = ________ | ________ | ___ |
| 3 | Withdraw $Y, position open | `(E3 + Y − E2)/E2` = ________ | ________ | ___ |
| 4 | Kill + relaunch + sleep | `(E4 − P)/P` = ________ | ________ | ___ |

Any row with `|expected − actual| > ε` is **FAIL** → record the day, the expected
value, the actual value, and which deal-type was involved, so the EA math can be
corrected.

#### Per-deal-type classification tick-table

Confirm the EA's classification matches **your broker's** behavior. Trigger at
least one deal of each type you can, read the audit sidecar, and tick:

| Deal type | EA classifies as | Matches broker? (Y/N) |
|-----------|------------------|------------------------|
| `DEAL_TYPE_BALANCE` (deposit/withdrawal) | EXCLUDED flow | ___ |
| `DEAL_TYPE_CREDIT` | EXCLUDED flow | ___ |
| `DEAL_TYPE_CHARGE` | EXCLUDED flow | ___ |
| `DEAL_TYPE_BONUS` | EXCLUDED flow | ___ |
| `DEAL_TYPE_CORRECTION` | **INCLUDED cost** (default) | ___ |
| `DEAL_TYPE_COMMISSION` (+ daily/monthly/agent) | INCLUDED cost | ___ |
| `DEAL_TYPE_INTEREST` | INCLUDED cost | ___ |
| swap (in `DEAL_SWAP`) | INCLUDED cost | ___ |

- **CORRECTION (required row, H6):** trigger or wait for at least one
  `DEAL_TYPE_CORRECTION` deal, read its line in the audit sidecar, hand-compute
  the expected `daily_return` **both ways** (as a cost vs as a flow), and confirm
  which one matches your broker's intent. If your broker's corrections are
  balance corrections, set `CorrectionIsFlow = true` and re-test.
- **BONUS / CREDIT / CHARGE reconcile (M1) — two-sided, REQUIRED:** every
  flow-type deal (`BALANCE` / `CREDIT` / `CHARGE` / `BONUS`) is now logged to the
  audit sidecar with its `type` and the `profit` value the EA **netted as the
  flow** (`FLOW deal … type=CREDIT profit=… netted_as=FLOW(excluded)`). Reconcile
  at least one credit/bonus/charge day and check **both** failure directions:
  - **Under-count (amount not in `DEAL_PROFIT`):** some brokers carry a
    credit/bonus/charge amount in a **different field**, so the logged `profit`
    reads `0.00` even though equity moved. If so, the flow is **not** subtracted →
    the return is **inflated**. Compare the logged `profit` against the actual
    equity change for that deal; if they disagree, the day must be handled
    manually (the EA cannot reliably read every broker's alternate field).
  - **Double-count:** if your broker's `ACCOUNT_EQUITY` **already includes** a
    credit/bonus and the deal *also* logs a non-zero `profit`, subtracting it as a
    flow would remove the credit **twice**. Confirm the day's return reflects
    trading only and the credit was removed **exactly once**.
  - Record whether your broker carries the flow amount in `DEAL_PROFIT` and
    whether its equity already includes credit.

#### Intraday-flow magnitude check (M3)

Trigger a **large same-day flow** (e.g. deposit that exceeds 20% of the prior
equity), then:

- Confirm the EA **flagged** the day in the audit sidecar (`FLOW-FLAG …` line,
  threshold = 0.20).
- The EA uses the **gross** day-flow subtraction over `prior_close_equity`. For a
  large flow this diverges from the **time-weighted (Modified-Dietz) truth**
  (which would weight the flow by time-in-period). Record the gross value AND a
  rough Modified-Dietz estimate so the **magnitude of the approximation is
  accepted, not hand-waved.** If the divergence is unacceptable for your use, the
  flagged day must be handled manually.

#### DST one-row check (M7)

Run across an **actual DST boundary** on the demo account and confirm the CSV has
**exactly one row** for the boundary date — no duplicate, no skipped day. (The CI
fixture only shape-pins this; the rollover correctness is EA-runtime.)

#### Calendar-density eyeball

Open the CSV and confirm there is **one row per calendar day across a weekend**
(e.g. both Saturday and Sunday rows are present and carry **real returns, not
zeros**). This proves the dense calendar-daily contract holds on a 24/7/365 venue.

#### Date-string eyeball (L2)

Confirm the **first row's date is exactly `YYYY-MM-DD`** (ISO with hyphens), not
`YYYY.MM.DD`. The downstream route hard-requires the hyphen format.

### 5.2 T15 — restart-state gate

The **Day-4 step above** (kill + relaunch + sleep) is the primary T15 case:
confirm the first post-restart day's return used the **persisted**
`prior_close_equity`, not a fresh/zero base. Additionally:

- **Kill mid-write.** Kill the terminal **while the state file is being written**
  (the timer fires every 15s by default; kill repeatedly around a rollover to hit
  the write window). On relaunch, confirm `OnInit` either **reloads a valid persisted base**
  (the EA logs `restart — loaded base equity=…`) **OR fails loud** (logs
  `FAILING LOUD on corrupt restart state` and refuses to emit). It must **never**
  silently emit a return against a corrupt/truncated base. The atomic temp→rename
  write plus the sentinel + checksum read-validation is what guarantees this.
- **First run.** Delete `quantalyze_state.csv`, restart: confirm the EA **seeds**
  the base from current equity and emits **no** return until the next rollover
  (the inception row, `0.0`).

### Resume signal

This phase's blocking-human checkpoint resumes only when **every worksheet row is
within ±ε** (T14), the **restart / kill-mid-write base is correct** (T15), the
**per-deal-type table matches your broker** (including CORRECTION and no
BONUS/CREDIT double-count), and the **dense-calendar / DST / date-string** checks
pass — or you describe the discrepancy (which day, expected vs actual, which
deal-type) so the EA math can be corrected.

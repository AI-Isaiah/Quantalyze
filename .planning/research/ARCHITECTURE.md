# Architecture Research: the MT5 external-oracle parity harness

**Domain:** Verifying an MT5 broker-ingestion pipeline against an external oracle: the terminal and the broker statement
**Milestone:** v1.18 MT5-VERIFY (Phase 155: MT5-06, MT5-07, MT5-08, MT5-09, MT5-10, MT5-15, MT5-GOAL-01)
**Researched:** 2026-11-13
**Confidence:** MEDIUM overall.
- The backend findings are HIGH: I read them directly at HEAD on `records/start-v1.18`. They cover the MT5 read path, the clock, marks, the fold and the contract test.
- The surface tracing for MT5-09 is MEDIUM. Each row in Pattern 5 is tagged *verified* or *inferred*.
- The MT5 terminal and statement behaviour is LOW. It comes from the web, and the `classify-confidence` seam returns LOW for both `websearch` and `webfetch --verified`.

> ⛔ This is a public repo. This file names no account login, no PROD id, no amount and no server
> name. The harness must keep to the same rule. The precedent is `mt5offset_dry_run.py` REDACTION:
> reports use ordinals and ratios, and raw figures stay in an untracked directory.

---

## 0. Six facts at HEAD that change the 2026-08-14 framing

Each of these premises is in the requirement text or the PROJECT.md section. I re-measured each one against the current code.

| # | Premise as written | What HEAD says | Consequence for the harness |
|---|---|---|---|
| F1 | "`broker_dailies` anchors to today (`initial = current_equity − total_pnl`), so error accrues backward." | This is still true for the **reconstructed** days only. Since NAVMTM (Phase 167.2.1.1.1, closed 2026-11-02), `services/nav_marks_apply.py` replaces every day from the first mark day `S` onward with stored, write-once marks (`api_key_nav_marks`). A mark is `account_info().equity` including open profit. It is read by OUR derive at `marked_at` and labelled `mark_day = UTC date(marked_at) − 1`. Days before `S` stay **realized-basis**: `reconstruct_mt5_nav_levels` says "uPnL is NEVER spread back across history". | There are **two regimes**. A window inside the marks era can match "including open P&L". A window before `S` cannot, by design: its error term is the floating P&L at the window edges. Pick the gate window inside the marks era, and treat a pre-`S` window as a diagnostic (§5). |
| F2 | MT5-06: "persisted (`MT5_SOAK_SERVER_OFFSET_MIN` is the intended carrier)". | That is stale. Phase 175 MT5OFFSET (closed 2026-11-03) made `MT5_SERVER_TIME_RULE` (`eu`/`us`) the one config, read by `resolve_mt5_server_clock` in `services/mt5_server_clock.py`. Setting `MT5_SERVER_UTC_OFFSET_S` as well raises `_BOTH_SET_MESSAGE` on **every** derive. The founder's readings (+3 h on 10-27, +2 h on 11-02) chose `us`. 175 left "the live server-clock check" to MT5-06. | Persist the measured offset as an **observation** that is **asserted against** `Mt5ServerClock`. Never write it back as config (§4). |
| F3 | A live server-time read exists or is easy. | No service reads server time. `Mt5Client` has no tick read, and `tests/test_mt5_client_contract.py::test_read_only_surface_no_trade_methods` **forbids** `symbol_info_tick` and `positions_get` by name. `account_info().profit` already gives total floating P&L, so `positions_get` is not needed. | A live in-worker measurement needs a deliberate **read-surface widening** that edits the contract test. Precedent: `terminal_info`, 153.3/D-31. The alternative is a founder clock reading, the 175 precedent. This is a founder decision (§4). |
| F4 | A harness script can reach the gateway. | The gateway is private-network only (`is_private_gateway_host`). The terminal lease (`services/mt5_concurrency.py`) is an **in-process** asyncio registry, so a second process serializes nothing. `login()` is an account change on the ONE shared Wine terminal. `railway ssh` **failed after authentication on both analytics services** in Phase 175 (D-06), which is why 175's live capture never ran. `scripts/mt5-diag.sh` reaches the gateway by ssh, but never calls `login()`. | The harness makes **no gateway call at all**. Everything it needs on our side is already in PROD tables. The only gateway touch in this milestone is the MT5-06 reading, made inside the worker's derive under the lease (§4). |
| F5 | MT5 deals are stored somewhere we could re-fold. | Not stored. `read_mt5_deal_ledger` reads the ledger live on each derive. The `trades` upsert is the ccxt-fills path, and MT5's `sync_trades` arm reads the balance only. Verify this when planning. | We get our side from **persisted outputs**: `strategy_analytics`, `strategy_analytics_series`, `api_key_nav_marks`, `portfolio_analytics`. We get a per-day diagnostic by folding the **founder's exported deal list** with our own pure `_fold_mt5_deals` (§5). |
| F6 | MT5-09 names `scenario-blend-panels.ts` and `routers/portfolio.py:628`. | `src/lib/scenario-blend-panels.ts` was **deleted** in `32494ba25` (v0.43.0.0, v1.10 P107+108 backbone unification; scenario-planner moved onto the backbone). `_compute_portfolio_analytics` is now at `routers/portfolio.py:653`. **Cite it by symbol.** It **INSERTs** a `portfolio_analytics` row. | Drop blend-panels from the MT5-09 surface list and record why. ⛔ The harness never calls `_compute_portfolio_analytics`. It reads the stored rows instead. |
| F7 | MT5-09 lists "portfolio PDF" as a surface. | **Retired.** `src/app/portfolio-pdf/[id]/page.tsx` is now a static "Allocation report retired" page (Phase 195 TRIM, D-03, 2026-11-07). It reads nothing. The PDF that still exists is the **factsheet** PDF (`/api/factsheet/[id]/pdf`, `tearsheet.pdf`). Puppeteer renders `/factsheet/[id]`, and the route is wrapped in `withPublishedOnly`. `(dashboard)/strategies/[id]/` holds only `edit/` plus a guard layout, so the requirement's "strategy detail" must be re-located when planning. It is probably the factsheet itself, or a strategies-list row (*inferred*). | Re-map MT5-09's five surfaces to what exists today, with a dated correction. Three of the remaining surfaces (factsheet PDF, browse, catalog composer) are **published-only** (Pattern 5). |

---

## Standard Architecture

### System Overview

```
 ORACLE SIDE (external, terminal- or statement-attested)        OUR SIDE (PROD, read-only)
┌────────────────────────────────────────────┐   ┌───────────────────────────────────────────────┐
│ Founder terminal session (trading day)      │   │ Supabase PROD — via MCP SELECTs only           │
│  • server clock reading (MT5-06 cross-check)│   │  strategy_analytics (returns_series,           │
│  • History → Report export, ALL history     │   │    daily_returns, metrics_json, flags,         │
│    (deals: time, type, profit, swap,        │   │    computed_at)                                │
│     commission, balance ops)  ← Gate A      │   │  strategy_analytics_series (sibling kinds)     │
│    (near-midnight deals come from it)       │   │  api_key_nav_marks (nav, open_pnl, marked_at)  │
│                                             │   │  portfolio_analytics (stored, bypass reader)   │
│ Broker statements (email / portal)          │   │  mt5_server_clock_readings  (NEW, MT5-06)      │
│  • Equity / Balance / Floating P/L at       │   └──────────────────────┬────────────────────────┘
│    server rollover of W0 and W1 ← Gate B    │                          │ versioned capture SQL
└──────────────────────┬─────────────────────┘                          │ (docs/runbooks/mt5-parity/*.sql)
                       │ worksheet + files                              ▼
                       ▼                                    ┌───────────────────────────────┐
         ┌──────────────────────────┐                       │ capture JSON (UNTRACKED dir)   │
         │ oracle intake            │                       └──────────────┬────────────────┘
         │  worksheet (YAML) +      │                                      │
         │  MT5 HTML report parser  │                                      │
         └────────────┬─────────────┘                                      │
                      ▼                                                    ▼
         ┌─────────────────────────────────────────────────────────────────────────────┐
         │ PURE COMPARE ENGINE (no DB, no socket, no gateway — mt5offset_dry_run shape) │
         │  window picker → oracle figures → our figures → delta → closed bucket        │
         │  taxonomy (fail-closed "unexplained", parity_diff.py shape) → verdict        │
         └───────────────┬───────────────────────────────────────┬─────────────────────┘
                         ▼                                       ▼
          MT5-07/08 verdict (ratios, ordinals)          MT5-09 surface matrix
          → tracked phase artifact                       ├ data layer: TS surface fns on
          raw figures → untracked dir                     │  captured series (tsx script)
                                                          └ render layer: founder's signed-in
                                                             Chrome (claude-in-chrome), read-only

 PRODUCT CHANGE (MT5-06), NOT HARNESS:
 worker derive (under mt5_terminal_lease) → narrow tick-time read → Mt5ServerClock assertion
   → INSERT mt5_server_clock_readings (write-once) → mismatch ⇒ named refusal + ops_alert
```

### Component Responsibilities

| Component | Responsibility | Implementation | New/Mod |
|---|---|---|---|
| **Capture SQL set** | Read every our-side input in one pass, read-only | `docs/runbooks/mt5-parity/*.sql`, including `marker.sql`. A vitest refuses write keywords, cloning `src/__tests__/marksource-okx-census-sql.test.ts`. An agent runs them through the Supabase MCP, one query per call, marker first. | NEW |
| **Capture loader** | Shapes the MCP output into typed JSON in an untracked dir | `analytics-service/scripts/mt5_parity/capture.py`, a pure loader | NEW |
| **Window picker** | Chooses `[W0, W1]` by rule, and refuses an unsafe window | Pure function (§5). It checks: Friday closes, both edges ≥ first mark day `S` per key, `W1 <` run day, no trading deal between server rollover and UTC midnight at either edge. | NEW |
| **Oracle worksheet** | The founder's typed figures, as a fixed schema | A YAML template that agents pre-fill with dates and account labels, leaving the figures blank. It is validated on load, and every figure is echoed back for confirmation. | NEW |
| **MT5 report parser** | Turns the terminal's History → Report HTML into deal rows | `bs4` (already in `requirements.txt`). **Assumptions, unsourced; check them on the first real export:** UTF-16 encoding, a space thousands separator, `YYYY.MM.DD HH:MM:SS` server time, and a per-deal Balance column. The MT5 help fetch did not confirm the Balance column. XLSX would need `openpyxl`, which is not a dependency, so HTML it is. If the parser cannot be trusted, the worksheet totals are the fallback. | NEW |
| **Compare engine** | Oracle figures vs our figures, then a delta, then a bucket, then a verdict | `analytics-service/services/mt5_parity.py`: stdlib + pandas only, no `services.db` import (pinned by a test). Reuses `_fold_mt5_deals`, `Mt5ServerClock`, `nav_marks_apply` arithmetic and the `parity_diff.py` taxonomy pattern. | NEW |
| **Tolerance constant** | The founder's 1%, as a named constant | `MT5_PARITY_TOLERANCE = 0.01` in the engine, never a literal. ROADMAP: "keep it a named test constant". | NEW |
| **Report renderer** | Writes a tracked, redacted verdict and an untracked full report | Ordinals (`mt5-key-1..3`), ratios and verdicts only. Reuses `flowtiming_dry_run._scrub` as the second line of defence, as `mt5offset_dry_run` does. | NEW |
| **Surface data layer (MT5-09)** | Runs each TS surface's own function on that surface's own input column | `scripts/mt5-parity/surfaces.ts` via `tsx` (already a devDep). Factsheet `compute()` on `returns_series`, composer `computeScenario` on `daily_returns` at weight 1, `portfolio-stats.ts`, `computeHealthScore`. Stored `metrics_json`, list scalars and `portfolio_analytics` are read, never recomputed. | NEW |
| **Surface render layer (MT5-09)** | What users actually see | The founder's signed-in Chrome via claude-in-chrome. Reads only (memory allows it, and no credentials are ever entered). Bound to `computed_at`, re-read after the render pass. | NEW (runbook) |
| **Server-clock reading (MT5-06)** | A live offset measurement, persisted and asserted | `Mt5Client` gets a narrow method returning tick `time_msc` only. `services/mt5_server_clock.py` gets an `assert_reading` function. The derive calls it under the lease. A new write-once table, `mt5_server_clock_readings`, holds the result. | MOD + NEW |
| **MT5-15 flag explainer** | Maps each `complete_with_warnings` flag on the three strategies to its cause | Reads `data_quality_flags` from the capture. Each flag maps to the code that sets it, for example `unrealized_pnl_in_anchor` in `nav_twr.py`. | NEW (small) |

---

## Recommended Project Structure

```
analytics-service/
├── services/
│   ├── mt5_parity.py                 # NEW: pure compare engine, taxonomy, tolerance constant
│   ├── mt5_server_clock.py           # MOD: + reading assertion (pure, stdlib only, stays a leaf)
│   ├── mt5_client.py                 # MOD: + narrow tick-time read (contract widening)
│   ├── mt5_read.py                   # MOD: call the reading inside the leased session
│   └── job_worker.py                 # MOD: derive persists the reading and handles a mismatch
├── scripts/mt5_parity/
│   ├── capture.py                    # NEW: MCP output → typed capture JSON
│   ├── report_parser.py              # NEW: MT5 History Report HTML → deal rows
│   ├── run.py                        # NEW: CLI: picker → engine → redacted report
│   └── worksheet.template.yaml       # NEW: founder worksheet (tracked, has blanks only)
└── tests/
    ├── test_mt5_parity_engine.py     # NEW: RED on a perturbed oracle, one test per bucket
    ├── test_mt5_report_parser.py     # NEW: synthetic UTF-16 fixture, never a real export
    ├── test_mt5_server_clock.py      # MOD: reading-assertion arms
    └── test_mt5_client_contract.py   # MOD: widening recorded; forbidden list kept otherwise
docs/runbooks/mt5-parity/
├── marker.sql  *.sql                 # NEW: capture set (SELECT/WITH only)
└── founder-session.md                # NEW: timed, scripted founder session
scripts/mt5-parity/surfaces.ts        # NEW: MT5-09 data layer
src/__tests__/mt5-parity-capture-sql.test.ts   # NEW: write-keyword gate over the capture set
supabase/migrations/<ts>_mt5_server_clock_readings.sql  # NEW: pure DDL + RLS
.gitignore                            # MOD: + /.mt5-parity/ (raw capture, oracle files, full report)
```

### Structure Rationale

- **The engine lives in `services/`, the runners in `scripts/`.** This is the `parity_diff.py` (service) and `golden_parity.py` / `mt5offset_dry_run.py` (script) split. The pure core is tested in CI. The runners touch files only.
- **Capture SQL lives in `docs/runbooks/`.** That gives it the same home and the same write-keyword gate as the marksource census, the existing precedent for "SQL that runs on PROD under standing authorization".
- **Raw material lives in `/.mt5-parity/`, untracked.** Oracle files hold the account owner's name and login (the report header has both, per the MT5 help page), plus amounts. Only the redacted verdict goes under `.planning/phases/155-*/`.

---

## Architectural Patterns

### Pattern 1: Capture once, compare offline (the 175 and 184 precedent)

**What:** Separate the impure capture (MCP SELECTs plus founder files) from a pure, deterministic compare that opens no socket.
**When:** Always, for every leg.
**Why here:** PROD reads go through the MCP only (memory rule). The gateway cannot be reached from outside the worker (F4). A pure engine can be proven RED on a perturbed oracle in CI, which Rule 9 and the "gates must be able to fail" memory both require.

### Pattern 2: Two oracle legs with different time properties

| Leg | What it attests | Oracle | When it can be read |
|---|---|---|---|
| **Realized** | Closed P&L, swap, commission and fees, and balance operations (flows), per server day, from the account's inception. That gives the terminal's own realized-balance path `B(t)`. | The terminal's History tab, **All history**, exported as one Report | **Any later day**. History is immutable, so this is re-readable. |
| **Open P&L** | Equity including floating P&L **at the instants W0 and W1** | (a) The broker daily statement at server rollover. (b) A month-end statement. (c) A terminal reading of a **frozen** weekend equity, which equals Friday close. | (a) and (b): any later day, if the broker sends them. (c): only on the weekend straight after the Friday in question. |

The MT5 help page says the report's Summary block (Balance, Equity, Floating P/L) is computed when the report is **generated**, not at the end of the window [LOW]. So the Report alone **cannot** attest historical equity. Recommendation: **(a)/(b) primary, (c) as the fallback.** The QuantalyzeDailyReturns EA (`tools/mt5/`) is rejected: it records forward only, needs the founder's terminal running across days, and its own README makes it the demo-account path.

**Why the realized leg is a GATE and not just a diagnostic.** Inside the marks era our edge level **is** the broker's own equity read, the stored mark. So the marks-era window tests only three things: flows, chain arithmetic and which account is read. **It cannot catch a fold, classification or bucketing bug.** Those code paths shape only the days **before** the first mark `S`, and those days are most of every MT5 strategy's rendered record. The harness therefore has two gate legs:

- **Gate A, pre-mark realized:** our compounded `returns_series` over a Friday-to-Friday window before `S` is compared with the TWR of the terminal's realized-balance path `B(t)` over the same window. `B(t)` comes from the export: the running balance with flows removed. Both sides are realized-basis, so this leg needs **no statement**. Its window must end before `S` as well as before the run day.
- **Gate B, marks-era open P&L:** the Friday-close window in Pattern 3, with the open-P&L oracle at both edges.

⚠️ **This is the top founder question.** The founder's tolerance says "1% INCLUDING open P&L". Before `S` the rendered history is realized-basis by design (NAVMTM D-09, no mark backfill). So the true error on pre-mark days is floating P&L at the day boundaries, and **no code fix can reach it without inventing marks**. The founder must rule on whether Gate A's realized basis is the accepted standard for pre-mark history, or whether that history must be caveated or withheld. The harness will measure the size of the gap (open P&L at `S`, from the first mark). It must not decide the answer.

### Pattern 3: Friday-close windows (instant alignment for free)

**What:** Put both `W0` and `W1` on a **Friday close**.
**Why:**
1. Under the `us` rule the broker's rollover is the New York close. Between that close and UTC midnight the market is shut, so **server-day and UTC-day boundaries hold the same trading deals**. That removes the boundary mismatch without the raw ledger.
2. Our Friday mark is read at about 00:40 UTC on Saturday (`marked_at`, `mark_day = Fri`), and the statement is generated at rollover. Equity is frozen between the two, so **the oracle instant and the stored instant hold the same value**.
3. Swap is booked at rollover, before both instants.

**Self-checks the picker enforces:**
- no trading deal in either edge's [rollover, UTC midnight) gap, read from the exported report;
- a balance operation in that gap is flagged and placed by instant (the D-23 rule);
- the account holds no weekend-trading symbol, such as crypto CFDs. If it does, the alignment is void and the picker refuses.

**Concrete candidate, to be verified:** `W0 = Fri 2026-10-30`, `W1 = Fri 2026-11-13`.
- It crosses the 2026-11-01 `us` DST change, so MT5-06 bucketing is exercised on both sides.
- An October month-end statement would attest `W0`: the month ends Saturday 10-31 with the market shut.
- `W1` is today. A weekend reading on 11-14 or 11-15 would attest it with no statement dependency. ⚠️ **Fallback (c) secures only one edge per weekend.** With no statements at all, Gate B needs **two** weekend readings: this weekend's becomes `W0`, and the next weekend's becomes `W1`. Missing this weekend costs a week, not the window. It is still the most time-critical item in this file.
- Conditions: the first MT5 mark day `S ≤ 2026-10-30` for each key. NAVMTM's SC-4 week reading suggests marks from about 10-27, but **measure it**.

### Pattern 4: A closed delta taxonomy, failing closed (the `parity_diff.py` shape)

Every delta lands in exactly one named bucket:
- `within_tolerance`
- `pre_mark_realized_basis`: the window touches days before `S`, and the delta equals floating P&L at the edge within ε
- `edge_instant_mismatch`: the picker's alignment check failed
- `flow_placement`: a flow sits within the boundary gap
- `annualization_convention`: a 252 vs 365 difference in a TS surface (MT5-09 only)
- `withheld_by_gate`: the `figure-gate.ts` D-15 record gate (60 non-crypto observations)
- `unexplained`

`unexplained` is reached only by an explicit non-match. It is the MT5-10 work queue. "Within tolerance" is never reached by fall-through.

⛔ **Only two buckets pass on their own:**
- `within_tolerance`;
- `withheld_by_gate`, and only when every surface withholds the same figure.

Every other named bucket needs a recorded founder ruling before it counts as a pass. A named bucket is an explanation, not an acceptance. "No `unexplained` left" is therefore **not** the MT5-GOAL-01 exit condition.

### Pattern 5: MT5-09 is one series checked five ways, at two layers

Data layer, which diagnoses: for each surface, its **own input column** goes through its **own function**.

| Surface | Input it reads | Function or stored figure | Status |
|---|---|---|---|
| "Strategy detail" | unknown. `(dashboard)/strategies/[id]/` has only `edit/` plus a guard layout (F7) | probably the factsheet route, or a strategies-list row | **inferred**: re-locate when planning |
| Factsheet (`/factsheet/[id]`, `v2`) | `strategy_analytics` (`returns_series`, `metrics_json`, `strategy_analytics_series` siblings) | stored backbone KPIs, plus `src/lib/factsheet/compute.ts::compute` for windows, gated by `figure-gate.ts` | **inferred** (loader not opened). Owner view: an unpublished strategy 404s to anon (OWN-02) |
| Factsheet PDF (`/api/factsheet/[id]/pdf`, `tearsheet.pdf`) | Puppeteer renders `/factsheet/[id]` | the same as the factsheet | **verified** route header: `withPublishedOnly`, so **published only** |
| Composer | `strategy_analytics.daily_returns` via `GET /api/strategies/[id]/returns` (RLS: **published only**) or the book join | `src/lib/scenario.ts::computeScenario` at weight 1 | **verified** route. **A different column from the factsheet's**, which was the SCEN-01 history |
| Browse | list scalars (`list-figures.ts`, `figure-record-scalars.ts`); `StrategyGrid.tsx` imports `HealthScore` | read only, plus `computeHealthScore` | **inferred**: published only |
| ~~Portfolio PDF~~ | n/a | **retired** (Phase 195 TRIM, D-03) | **verified**, F7 |
| Backbone-bypass readers | stored `portfolio_analytics` (written by `_compute_portfolio_analytics`); `portfolio-stats.ts` is used by allocations widgets (`VarExpectedShortfall`, `RiskDecomposition`, `RegimeDetector`, `scenario-stress`, `scenario-benchmark`) | read only | **verified** imports. These are not in MT5-09's list as written; include them only if an MT5 strategy sits in a book |

Render layer, which gates: read the displayed figures on all five surfaces in the founder's signed-in browser, and compare them with the data layer.
- The pass is bound to `computed_at`: read it before and after. A recompute in between voids the pass (freshness = `computed_at`, memory rule).
- ⚠️ **Precondition:** the factsheet PDF, browse and the catalog composer show only `status='published'` strategies, and MT5 is "not advertised" until 155 passes. Whether MT5-09 publishes, uses a book or an admin view, or scopes browse out is a **founder decision**. Raise it before planning.

---

## Data Flow

### Run-day flow

```
T-n days (agents, no founder):
  MCP marker query → capture SQL set → /.mt5-parity/<run>/prod/*.json
  window picker (dry, using marks + flags) → proposed [W0,W1] per key + refusals
  MT5-09 data + render layers → surface matrix → MT5-10 fixes start NOW
  MT5-15 flag explainer → explanations
  MT5-06 capability shipped → weekday derives already writing readings

Founder session (trading day, about 15 min, scripted by founder-session.md):
  1. Harness prints UTC now → founder reads Market Watch server time → worksheet
  2. Per account (3×): History → All history → Report → save HTML (ONE wide export covers
     Gate A, Gate B, the per-day diagnostic and any re-picked window, so no second sitting)
  3. Per account: statement figures for W0 and W1 (Equity, Balance, Floating P/L) → worksheet
  4. No extra deal reading is needed: near-midnight deals are taken from step 2's file (flow 4)
  (Optional, same sitting: the Phase 157 browser confirmations)

T+0 or later (agents):
  MCP re-capture (computed_at must still match, or re-run the surfaces)
  report_parser + worksheet → oracle figures
  engine → buckets → MT5-07/08 verdict; `unexplained` ⇒ MT5-10 (uncapped) ⇒ re-run
```

### Key data flows

1. **Window P&L parity (MT5-07 gate).**
   - Oracle: `ΔE = E_oracle(W1) − E_oracle(W0) − F_oracle[W0,W1]`, with flows from the report's balance operations.
   - **Ours = the rendered series:** the compounded `strategy_analytics.returns_series` over `(W0, W1]`, compared with the oracle's window return. Edge marks are a second check (flow 2), not the definition.
   - **A flow inside the window:** the rendered series is a chain-linked TWR. A two-edge oracle can only give a money-weighted ΔE, and an oracle TWR would need equity at each flow instant, which only a statement on that day could supply. So the picker **prefers a flow-free window**. If none fits, compare money ΔE instead. Our flows come from the derive's stored per-key inputs (`_key_inputs_payload["flows"]` in `job_worker.py`, persisted with `allocator_equity_derived`; *inferred*, verify the table and column when planning). The engine records that the compared quantity changed.
   - Metric, recommended: `|ΔE_ours − ΔE_oracle| / E_oracle(W0) ≤ MT5_PARITY_TOLERANCE`. That is the window return in absolute percentage points.
   - ⚠️ "1%" has not been specified as relative-to-equity, relative-to-P&L or absolute-pp. **Relative-to-P&L blows up on a quiet window.** It needs the founder's call.
2. **Edge equity parity.** `|E_ours(Wi) − E_oracle(Wi)| / E_oracle(Wi)` at each edge. This tests the marks and so the gateway read, not the pipeline.
3. **Per-day diagnostic (localizes MT5-10).** Fold the founder's exported deals with OUR `_fold_mt5_deals` under the configured clock to get per-UTC-day realized P&L. Compare that with the P&L the stored series implies. If the fold matches the oracle but the stored series does not, the bug is after the fold. If the fold does not match, it is in classification or bucketing.
4. **Offset (MT5-06).** The founder's clock reading, the worker's stored readings and `Mt5ServerClock(rule).instant_offset_s(now)` must all agree.
   - **Near-midnight regression as per-day placement:** take every export deal within the offset window of UTC midnight. Its terminal-displayed server time minus the offset in force gives the UTC day it should land on. The per-day diagnostic (flow 3) must show its P&L on that day in the stored pre-mark series.
   - No API-side deal time is stored (F5), so "API `time` equals displayed time" is **not** checked directly. It is checked **indirectly**: a Wine or rpyc shift of deal times would misplace those deals' P&L, and the per-day diagnostic would show it.
   - A direct check would need a worker-side read-only ledger capture. That would be a NEW component, and it is **not** recommended unless the indirect check comes back ambiguous.
5. **Cross-surface (MT5-09).** See Pattern 5.

### State management

The harness writes **nothing to PROD**. Its only state is the untracked run directory plus the tracked redacted verdict. The MT5-06 table is product state, written by the worker. It is not harness state.

---

## 4. Where the server-offset measurement and its persistence belong

**Recommendation:** it is a product capability inside the worker's MT5 session. It is not part of the harness, and it is not config.

- **Read:** inside `read_mt5_deal_ledger`'s leased session, after login. A narrow `Mt5Client` method reads tick `time_msc` for the symbols in the account's own fetched deals (no `symbol_select`, which would mutate Market Watch) and returns the freshest.
  - `measured_offset_s = round_to_900(tick_wall_epoch − worker_utc_now)`.
  - It is accepted only when the residual is under about 60 s, meaning the tick was fresh. Otherwise the verdict is `stale`.
  - On a weekend or a holiday the verdict is `stale`, which means "no reading". It is never a mismatch.
  - The 00:40 UTC weekday derive (Monday to Friday) falls inside FX trading hours, so readings accrue nightly **with no founder involvement**.
  - ⚠️ **Unverified: spike before this phase is planned.** Three things need checking:
    - whether `symbol_info_tick` returns a fresh tick for a symbol that is not in Market Watch without `symbol_select`;
    - whether its `time` is the broker wall clock in the same encoding as deal `time`;
    - what it returns through mt5linux on Wine.

    The 175 readings came from the founder, not from code. `mt5_spike.py` leg 4 shows the deal-age confound, which is why the deal-derived estimate is not used.
- **Assert:** a pure `assert_reading(clock, reading)` goes in `mt5_server_clock.py`, which stays stdlib-only and a leaf. It compares the reading with `clock.instant_offset_s(wall)`.
  - **On mismatch:** a named, transient refusal of that key's persist plus an `ops_alert`, following the 175 D-04 precedent that a clock fault is transient. Whether a mismatch refuses or only alerts is a founder decision. The fail-loud default is to refuse.
- **Persist:** a new `mt5_server_clock_readings` table, modelled on `api_key_nav_marks`.
  - Columns: `api_key_id` FK, `read_at` (UTC), tick wall epoch, `measured_offset_s`, `rule_id`, `rule_offset_s`, `verdict` (a CHECK over the closed set).
  - Write-once (INSERT only for `service_role`), admin-only read.
  - **Pure DDL, no data-reading DO block.** The migration auto-applies to TEST, whose tables are empty, and then to PROD with **no human gate** (CLAUDE.md, 2026-09-23). A count-checking block would refuse on TEST and block the deploy (`164.8-DATA-DEPENDENT-MIGRATION-ESCAPE`). It needs migration-reviewer and rls-policy-auditor to come back clean before merge.
- **Granularity:** the clock is **one process env for every MT5 key**. Persist per key, and compare across keys. If the three accounts sit on broker servers with different rules, one env cannot serve them, and that is an MT5-10 finding. Pre-flight: check whether the three keys share a server. ⚠️ That may **not** be readable by SELECT, since the server travels with the encrypted three-field credential. If not, it is a founder question, or a worker-side `account_info().server` read as part of the reading row. Store a hash or the key id, never the server name, in tracked text.
- **Limit, stated:** only the **current** DST regime can be observed live. The `us` rule's next transition, 2027-03-14 07:00 UTC, is the first moment a wrong rule would show. Nightly readings catch it within one derive, and a one-off check never would. That is the argument for doing the widening rather than relying only on the founder's reading.
- **Contract widening:** `test_mt5_client_contract.py` lists `symbol_info_tick` as forbidden. Recommended:
  - add a **narrow** method that returns only `time_msc` per symbol, so the method name `symbol_info_tick` stays absent and the forbidden-name test stays meaningful;
  - add it to `test_public_surface_is_exactly_the_contract` with a dated rationale, as `terminal_info` (153.3/D-31) was.
  - Founder approval is needed: this touches the `api_verified` read-only trust story.
- **If the founder declines the widening,** MT5-06 falls back to the founder's in-session clock reading, recorded in the phase artifact, which is the 175 precedent. "Asserted on" then holds once rather than continuously. Book the continuous check.
- ⚠️ **MT5-06's own wording conflicts with UTC bucketing.** It says a near-midnight deal "must land on the day the terminal shows". The terminal shows **server** days, and the dailies bucket by **UTC** day. Proposed restatement: "lands on the UTC day of (terminal-displayed server time − the offset in force)". It is checked as per-day placement (Key data flow 4), not as a direct comparison of API time with displayed time, because no API-side deal time is stored (F5). Settle this in discuss-phase. Do not pick one silently.

---

## 5. Running it read-only against PROD

| Write path | Why it is a hazard | Rule |
|---|---|---|
| Enqueuing `derive_broker_dailies` / `sync_trades`, or pressing Sync | Persists a new series and moves `computed_at` mid-run | Never, during a parity run. Capture after the nightly derive, and bind every reading to `computed_at`. |
| `_compute_portfolio_analytics` | INSERTs `portfolio_analytics` | Never call it. Read the stored rows. |
| An out-of-band gateway script (`railway ssh` + rpyc + `login()`) | Bypasses the in-process lease: it switches the shared terminal's account under a running derive (F4) | No harness gateway access. The only gateway read is the in-worker MT5-06 reading. |
| Ad-hoc PROD SQL | It could write. CLI and browser SQL have no guard. | Versioned capture SQL only, a write-keyword gate in vitest, the MCP marker query first, one query per call. |
| Tracked evidence | Public repo | Raw files live in `/.mt5-parity/` (gitignored). The tracked verdict uses ordinals and ratios only. |
| The Railway redeploy coupling | MT5-06 ships code that the worker runs | The derive only changes once main CI is green and Railway has deployed. Confirm a reading row exists on PROD before the session. |

---

## Scaling Considerations

| Scale | Adjustment |
|---|---|
| 3 accounts, 1 broker (now) | Per-key loop, one window, one founder session |
| N accounts across several brokers | The clock must become per-server config. Today's single env is the first thing to break (§4). The picker and engine are already per-key. |
| Recurring verification (post-155) | Weekday clock readings already run. A periodic re-run needs a statement feed, so it is out of scope. |

---

## Anti-Patterns

### Anti-Pattern 1: Using the gateway read as the oracle
**What:** Comparing rendered equity with `account_info()` read through our own gateway, or with our own stored marks.
**Why it's bad:** It is the same source the pipeline ingests, the self-referential oracle that MT5-07 rules out by name.
**Instead:** Make the oracle terminal- or statement-attested. The marks are **our side**: they are what F1 says the series is built from.

### Anti-Pattern 2: Comparing today's equity
**Why it's bad:** The anchor makes it near-tautological (ROADMAP).
**Instead:** Use a window that ends before the run day. Inside the marks era, use the Friday-close edges.

### Anti-Pattern 3: Writing the measured offset back into `MT5_SERVER_UTC_OFFSET_S`
**Why it's bad:** It raises `_BOTH_SET_MESSAGE` on every derive, and it would let one reading re-bucket history.
**Instead:** Store an observation and assert it. A rule change stays a deliberate operator act.

### Anti-Pattern 4: Recomputing a surface instead of reading it
**Why it's bad:** It proves the function, not what users see. The composer reads a different column from the factsheet.
**Instead:** Use the render layer as the gate and the data layer as the diagnosis.

### Anti-Pattern 5: A parity test that skips without its fixture
**Why it's bad:** Rule 12: a skipped test reads as a pass. A real-data run cannot live in CI.
**Instead:** CI runs the engine on **synthetic** fixtures, including the RED proofs. The real run is a separate CLI that exits non-zero on any `unexplained` delta.

---

## Integration Points

### External services

| Service | Pattern | Notes |
|---|---|---|
| MT5 gateway (Railway, private) | Only through the worker's `mt5_terminal_lease` session | It is the MT5-06 read and nothing else. `mt5-diag.sh` stays `initialize()`-only. |
| Supabase PROD | MCP SELECTs, marker first | `current_database()` proves nothing; use the `shobj_description` marker |
| Founder terminal + broker statements | Worksheet + Report HTML files | Whether statements exist is UNVERIFIED for this broker. One broker's help pages say daily statements are sent **only on days with activity**, with a monthly statement on the 1st [LOW]. Ask first. |
| Founder Chrome (claude-in-chrome) | Read-only render pass | Never enter credentials. Owner views need the founder signed in. |
| Railway logs / Sentry | Session-day MT5 stage latency (`emit_mt5_stage_event`) | Supplies the real latency data that TODOS timeout findings #8 and #10 need |

### Internal boundaries

| Boundary | Communication | Notes |
|---|---|---|
| engine ↔ `broker_dailies._fold_mt5_deals` | direct import (pure) | Reuse it; never fork it ("Don't Hand-Roll", in its own docstring) |
| engine ↔ `nav_marks_apply` | direct import (pure) | The writer-chain identity `L(d) = L(d−1) + P_d + F_d` gives our ΔE |
| `mt5_read` ↔ `mt5_server_clock` | direct, leaf-safe | `mt5_server_clock` must stay stdlib-only, and `mt5_read` must never import `job_worker` |
| TS surfaces ↔ Python backbone | none in the harness: both read the same capture | the `figure-parity.test.ts` precedent reads Python text for its constants |

---

## New vs Modified, explicitly

**NEW:**
- `services/mt5_parity.py`
- `scripts/mt5_parity/{capture,report_parser,run}.py` and `worksheet.template.yaml`
- `docs/runbooks/mt5-parity/*.sql` and `founder-session.md`
- `scripts/mt5-parity/surfaces.ts`
- `src/__tests__/mt5-parity-capture-sql.test.ts`
- engine and parser tests
- `mt5_server_clock_readings` migration and its RLS

**MODIFIED:**
- `services/mt5_client.py`: narrow tick-time read
- `tests/test_mt5_client_contract.py`: the widening, recorded
- `services/mt5_server_clock.py`: `assert_reading`
- `services/mt5_read.py`: the reading inside the session
- `services/job_worker.py`: persist the reading and handle a mismatch
- `.gitignore`: `/.mt5-parity/`
- MT5-09 requirement text: drop `scenario-blend-panels.ts` and cite `_compute_portfolio_analytics` by symbol, with dated corrections and the old text kept as lineage

**UNTOUCHED BY THE HARNESS (fix targets only if MT5-10 finds a cause there):**
- `broker_dailies.py`, `nav_marks_apply.py`, `nav_twr.py`
- the five surfaces

---

## Suggested Build Order

The aim is that agents build and pre-verify everything, and the founder's session is one scripted sitting.

0. **Pre-flight. Agents, now. Two parts.**
   - (a) MCP reads:
     - the first MT5 mark day `S` per key;
     - open P&L at the candidate Fridays;
     - published status, and the portfolios containing each strategy;
     - `data_quality_flags`;
     - account unit (a native BTC-unit MT5 account compares in its deposit unit, with the USD view checked separately);
     - whether the three keys share a broker server (this may not be readable by SELECT, see §4);
     - each strategy's record length against the `figure-gate.ts` D-15 bound (60 non-crypto observations);
     - `computed_at`.
   - (b) **Founder questions, today:**
     - **Is realized-basis history before the first mark the accepted standard, or must it be caveated or withheld?** This is the top question: it decides what Gate A can pass (Pattern 2).
     - Do daily and monthly statements arrive for these accounts?
     - ⚠️ Will you read the frozen equity this weekend? It secures one Gate B edge, and with no statements Gate B needs two such weekends.
     - What is the 1% denominator?
     - Do you approve the tick-read widening?
     - How should MT5-09 handle the published-only gap (factsheet PDF, browse, catalog composer), and where is "strategy detail" now?
     - Settle MT5-06's "day the terminal shows" wording.
1. **MT5-09 data layer, render layer and MT5-15.** No founder dependency, except for the published-only ruling. MT5-10 fixes can start weeks before the terminal session.
2. **Compare engine.** Taxonomy, tolerance constant, and RED proofs on a perturbed synthetic oracle, each arm seen RED with a byte backup restored.
3. **Our-side extractor.** Capture SQL, the write-keyword gate, the loader and the window picker.
4. **Oracle intake.** The worksheet first. Then the report parser against a synthetic UTF-16 fixture, so no real export is ever tracked.
5. **MT5-06 capability.** Widening, migration, derive integration and assertion. Ship it, then confirm the deploy, then confirm at least one weekday PROD reading row **before** the session. It is the longest-lead item because of deploy and review gates, so start it in parallel with step 1.
6. **Dress rehearsal.** Run the whole flow end to end on synthetic oracle files, plus the real PROD capture, so that only the founder's figures are missing.
7. **Founder session (Gate 2).** Use `founder-session.md`, and bundle the Phase 157 browser confirmations into the same sitting.
8. **Comparison run, then MT5-10 (uncapped), then re-run.** MT5-GOAL-01 closes only when every delta is `within_tolerance`, a consistent `withheld_by_gate`, or another named bucket carrying a recorded founder ruling. An empty `unexplained` list is **not** enough on its own (Pattern 4).

**Phase-split suggestion.** Book these with `/gsd-phase --insert`, not by hand.
- (i) Steps 1–4 and 6 make up the harness plus agent-only pre-verification.
- (ii) Step 5 is a separate data-integrity phase, because it carries a migration and a contract widening.
- (iii) Steps 7–8 are the founder-gated verification plus MT5-10.

That way the founder gate blocks only (iii).

---

## Sources

- Codebase, read at HEAD (HIGH):
  - `services/mt5_server_clock.py`, `mt5_read.py`, `mt5_client.py` (contract docstring), `mt5_concurrency.py`
  - `broker_dailies.py`: `combine_mt5_deal_ledger`, `reconstruct_mt5_nav_levels`
  - `nav_marks.py`, `nav_marks_apply.py`, `parity_diff.py`
  - `routers/portfolio.py::_compute_portfolio_analytics`
  - `tests/test_mt5_client_contract.py`
  - `scripts/mt5offset_dry_run.py`, `mt5_spike.py` (`_leg4_server_time_offset`), `deribit_ground_truth.py`, `scripts/mt5-diag.sh`
  - `src/lib/factsheet/compute.ts`, `scenario.ts`, `portfolio-stats.ts`, `health-score.ts`, `figure-gate.ts`, `figure-record-scalars.ts`
  - `src/app/api/strategies/[id]/returns/route.ts`
  - `src/__tests__/marksource-okx-census-sql.test.ts`
  - the `api_key_nav_marks` migration
  - `tools/mt5/README.md`
- Planning (HIGH):
  - `.planning/PROJECT.md` (v1.18), `ROADMAP.md` (v1.18 section)
  - `milestones/v1.16-REQUIREMENTS.md` (MT5-06..10 text)
  - `milestones/v1.20-ROADMAP.md` (Phase 175 closure, NAVMTM closure)
- Web (LOW, per `classify-confidence`):
  - [MetaTrader 5 Help: Trading Report](https://www.metatrader5.com/en/terminal/help/trading_advanced/history_report): the Summary values are computed when the report is generated. This page did not confirm a Deals balance column or period selection.
  - [Vantage: When will I receive my account statements?](https://global.vantagehelpcenter.com/hc/en-us/articles/10574478613519-When-will-I-receive-my-account-statements): daily statements are sent only on days with activity, and a monthly statement on the 1st.
  - [IFX Brokers: understanding an MT4 statement](https://ifxbrokers.com/wp-content/uploads/2024/03/12.14-How-do-I-Understand-my-MT4-Statement_digital.pdf): statement equity is a snapshot taken when the statement is generated.

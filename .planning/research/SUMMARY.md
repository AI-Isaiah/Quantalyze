# Project Research Summary

**Project:** Quantalyze, milestone v1.18 MT5-VERIFY & founder confirmations (Phases 155 and 157)
**Domain:** Proving an existing MT5 ingestion pipeline's rendered numbers against an external oracle (the founder's terminal and broker statements)
**Researched:** 2026-11-13
**Confidence:** MEDIUM. Repo facts are HIGH, read at HEAD. MT5 terminal, report and statement behaviour is LOW, from web sources only, and nothing has been measured live yet.

> Public repo: this file names account labels only (MM2, MM3, FX-AI_V). No login, server name, amount or PROD id.

## Executive Summary

v1.18 builds no product. It verifies one. MT5 already ingests, reconstructs and renders on every surface. The milestone has to show that what Quantalyze renders for three live funded accounts matches the broker's own figures to within 1%. It also has to explain every divergence and fix each one at its root, with no cap (MT5-10). Practitioners use the broker's **raw ledger** as the oracle: balance at an instant, deal-row sums and flows. Verifier percentages such as Myfxbook Gain or the terminal's Growth % are used only as a secondary cross-check. Every retail verifier's headline gain is on a balance basis, with equity shown beside it. Their methods also differ on deposits and withdrawals. Comparing our TWR with their Growth % would therefore mix method error with data error.

The approach the research converges on is **capture once, compare offline**:
- Our side comes from persisted PROD rows, read through MCP SELECTs only, with the marker query first: `strategy_analytics`, `strategy_analytics_series`, `api_key_nav_marks` and the stored `portfolio_analytics`.
- The oracle side comes from the founder's terminal. That means an All-History Report export plus a short worksheet of readings, and broker statements if any exist.
- A pure engine with no DB, socket or gateway access compares the two. It sorts every delta into a closed taxonomy that fails closed and has a named `MT5_PARITY_TOLERANCE = 0.01` constant.
- The harness itself never touches the gateway. The only new gateway read is the MT5-06 server-clock reading. It is built as a product capability inside the worker's leased derive and persisted write-once.
- No runtime package is added.

Agents build and dry-run all of this before a single scripted founder session on a trading day (gate 2).

The risks are mostly definitional, not technical. **Four facts at HEAD contradict the 2026-08-14 framing:**
1. **NAVMTM marks** (Phase 167.2.1.1.1) put every day from a key's first mark day `S` on an equity basis. Days before `S` are realized (balance) basis by design and cannot carry "including open P&L" without inventing marks.
2. **MT5-06's carrier** (`MT5_SOAK_SERVER_OFFSET_MIN`) has been replaced by Phase 175's `MT5_SERVER_TIME_RULE`.
3. **The `Mt5Client` contract test forbids** the `symbol_info_tick` read a live clock check needs.
4. **MT5-09's surface list is stale.** The portfolio PDF was retired in Phase 195 and `scenario-blend-panels.ts` was deleted in v0.43.0.0.

The other hard risks:
- **A tautological oracle.** `mt5_soak.reconcile_parity` and our own gateway reads both fall into this class.
- **One worker-wide clock rule across three accounts** that may sit on different servers.
- **Unverified fold and classification rules:** assumption A3 on commission and swap, and BALANCE deals that are not really deposits.
- **A truncated ledger**, which the backward anchor absorbs silently.
- **Losing a week if this weekend's frozen-equity reading is missed.**

## Key Findings

### Recommended Stack

Add nothing at runtime. Everything is already in `analytics-service/requirements.txt`, the Python stdlib, or reachable through the `mt5linux` 0.1.9 RPyC bridge. (STACK.md, HIGH from the lock and the unpacked wheel.)

**Core technologies:**
- **Python 3.12, `mt5linux` 0.1.9 (`--no-deps`), `rpyc` 5.3.1:** the validated gateway path. Do not move to rpyc 6.x (wire-incompatible) or mt5linux 0.1.10 and later (regressed).
- **`Mt5Client` facade:** every read goes through it, so the login bracket, timeouts and scrubbing stay in force. Any new read is a named method backed by one committed remote expression in the `_REMOTE_SESSION_SNAPSHOT_SRC` style, evaluated in one RPyC crossing. Iterating netrefs costs about 60 ms per element.
- **`Mt5ServerClock` (Phase 175):** the only broker-time-to-UTC conversion. Do not use runtime `zoneinfo`/`tzdata`, `pytz` or `dateutil`.
- **`broker_dailies._fold_mt5_deals`, `nav_marks_apply`, the `parity_diff.py` taxonomy pattern:** the engine reuses them and never forks them.
- **Stdlib `json` + `hashlib` (canonical JSON, `allow_nan=False`, sha256):** seals captures. **Stdlib `html.parser` + `codecs`** parses the HTML Report. Do not support XLSX.
- **`@playwright/test` and the founder's signed-in Chrome:** MT5-09's render layer. Add `unpdf` 2.1.0 as an optional dev dependency only if the PDF bytes themselves must be read.

**Do not use:** a second raw `mt5linux` connection; `conn.execute("import …")` on the far side; `symbol_select` (it mutates the shared Market Watch); the `mt5linux` `copy_rates_range` wrapper; a generic attribute passthrough on `Mt5Client`; `positions_get` (`equity − balance` and `account_info().profit` already cover open P&L).

### Expected Features

The "features" are verification checks and evidence artifacts (FEATURES.md, MEDIUM).

**Must have (table stakes):**
- TS-1 and TS-2: the live offset is asserted per server, plus a near-midnight regression on a **real** deal, chosen from a DST divergence week (2026-10-25..11-01) so it also pins `eu` versus `us`.
- TS-3: **raw-money window parity**, the core oracle. Balance at both window edges, the flows and the net closed P&L come from the terminal export, with the identity `B_E − B_S = closed P&L + flows` checked on both sides. Parse columns by header name, never by index.
- TS-4: a captured-instant check plus a measured wedge. The founder reads the terminal at instant T, and the harness checks it on D+1 after a re-anchoring sync.
- TS-6: proof the account is real. Record trade mode (real or demo), the server, and that the run is on a trading day.
- TS-7: cross-surface consistency on the **re-mapped** MT5-09 list (see Conflict C7).
- TS-8: MT5-15 warnings read from the stored `data_quality_flags`, not guessed.
- TS-9: the uncapped root-cause loop (MT5-10).
- TS-10: basis disclosure. A realized-basis curve must not read as equity.
- TS-11 and TS-12: Phase 157 confirmations and MT5-GOAL-01.
- Additional checks from PITFALLS.md that belong in the same set:
  - an inception identity (the balance rolled back past the first deal is about 0);
  - a deal census by type and cost column;
  - a BALANCE, CREDIT and BONUS deal census, with labels the founder confirms;
  - a provenance enum on every expected value;
  - a self-RED proof of the harness.

**Should have:**
- D-2: weekend or Friday-close window boundaries, asserted per account. They are void if an account trades a weekend-quoted symbol.
- D-3: a re-runnable harness that exits non-zero on breach.
- D-1: a per-deal running-balance replay, used if TS-3 fails and the cause is not obvious.
- D-5: broker daily statements, the only historical-equity oracle, if the brokers send them.
- TS-5: a Growth % cross-check, labelled secondary. It shares our blind spot on BALANCE dividends.

**Defer:**
- D-4: equity-basis history going forward. NAVMTM marks may already cover most of this (Conflict C2). Re-check before booking it.
- A public "verified" claim or badge, and a proof-of-control check like Myfxbook's.

**Anti-features:**
- comparing the run day's equity;
- using Myfxbook or FX Blue Gain as the primary oracle (FX Blue's method was never retrieved, so never cite it);
- spreading today's floating P&L back over history;
- widening the 1%;
- hardcoding an offset;
- committing raw exports;
- fixes scoped to `exchange === 'mt5'`.

### Architecture Approach

The structure is a capture/compare split (ARCHITECTURE.md; HIGH for the backend, MEDIUM for the surface tracing). A versioned capture-SQL set in `docs/runbooks/mt5-parity/` sits behind a vitest write-keyword gate and feeds an untracked `/.mt5-parity/` directory. The founder's worksheet and Report HTML feed an oracle intake. Both go into a pure engine in `services/mt5_parity.py` that emits a redacted verdict with ordinals and ratios only. MT5-09 is one series checked at two layers. The data layer runs each TS surface function on its own input column, which is diagnostic. The render layer is the founder's Chrome and acts as the gate, bound to `computed_at`.

**Two gate legs:**
- **Gate A (pre-mark realized):** our `returns_series` against the TWR of the terminal's realized-balance path, over a Friday-to-Friday window before `S`. It needs no statement. It is the only leg that can catch fold, classification and bucketing bugs, because those shape only the pre-`S` days, which are most of the record.
- **Gate B (marks era, open P&L):** Friday-close edges, with an equity oracle at both edges.

**Major components:**
1. Capture SQL and loader, plus a window picker. The picker refuses unsafe windows: any trading deal in an edge's [rollover, UTC midnight) gap, edges before `S`, or a weekend-quoted symbol.
2. Oracle intake: the worksheet YAML and the Report parser, tested on a synthetic UTF-16 fixture.
3. A pure compare engine with a closed taxonomy: `within_tolerance`, `pre_mark_realized_basis`, `edge_instant_mismatch`, `flow_placement`, `annualization_convention`, `withheld_by_gate`, `unexplained`. Only `within_tolerance`, and a `withheld_by_gate` applied consistently on every surface, pass on their own. Every other named bucket needs a recorded founder ruling. An empty `unexplained` list is not the exit condition.
4. MT5-06 server-clock reading, a product change:
   - a narrow `Mt5Client` tick-time method;
   - `assert_reading` in `mt5_server_clock.py`, which stays a stdlib-only leaf;
   - a call inside `read_mt5_deal_ledger`'s leased session;
   - a write-once `mt5_server_clock_readings` table with pure DDL, RLS and no data-reading DO block, because it auto-applies to TEST and then to PROD with no human gate;
   - on mismatch, a named refusal plus an `ops_alert`.
5. MT5-15 flag explainer and the MT5-09 surface matrix.

### Critical Pitfalls

1. **The oracle is our pipeline in disguise.** Every expected value carries provenance `terminal_reading`, `terminal_report_export` or `broker_statement`, and the harness refuses anything else. The founder reads cold, with none of our numbers in view. `mt5_soak.reconcile_parity` is an internal check only. The harness must be shown RED on a neutered input (a reclassified BALANCE deal, a one-hour clock shift, a dropped oldest deal) and then restored from a byte backup.
2. **Basis mismatch at `S`, and the window-end trap.** Measure each key's first `mark_day` first. Report cumulative return, start level and end level separately, because error accrues backward and is largest at the window start. Put edges on market-closed instants. A level within 1% can hide a 20% error in the return.
3. **One clock for three accounts, and a forbidden tick read.** Group the keys by `account_info().server`. If the rules differ, a per-server clock is the fix (check the parked `164.6.6.3.6 MT5SERVERLEARN` branch first). A per-key override bolted on would be a band-aid. Re-cut the contract pin deliberately: admit one named read-only method and never delete the forbidden list.
4. **Cost fold and flow classification are unverified.** A3 (commission as a field versus a separate row) and plan 136-05 (DEAL_TYPE verify) were never executed. BALANCE-typed dividends and rebates silently leave the return. Credit sits in the `equity − balance` wedge. Fix: a per-column (profit, swap, commission, fee) per-day diff against the statement deal rows, a founder-labelled balance-operation census, and reading `credit` separately.
5. **A truncated ledger, a lease bypass, and the timeout arms.**
   - Assert the inception identity.
   - Require an All-History export.
   - Never run a second process against the gateway: the lease is in-process only, and a stray login fails the nightly with `Mt5AccountMismatchError`.
   - Use `mt5_derive_read_bound_s`, and let the named errors through unchanged.
   - Never raise a bound to turn a run green.
   - Tune timeout findings #8 and #10 only from percentiles over several nightlies, with fresh and cached logins split.

## Conflicts Between the Research Files (resolved here, not averaged)

| # | Topic | Disagreement | Pick and why |
|---|---|---|---|
| C1 | **What the oracle may be** | STACK's preferred pair includes **Oracle A, a gateway snapshot** captured by the harness, taken over `railway ssh` or a new internal route. ARCH (Anti-Pattern 1, F4) and PITFALLS (Pitfall 1, provenance enum) rule out any gateway-read oracle, and ARCH says the harness makes **no gateway call at all**. | **ARCH/PITFALLS.** STACK itself concedes that A has "temporal independence only" and shares the ingest pipe. Drop Oracle A and the internal-route or `railway ssh` capture channel. Keep STACK's B (Report) and C (live founder reading). |
| C2 | **Does the history have an equity-basis era?** | STACK and FEATURES say every reconstructed interior day is balance basis and build their "two checks" (TS-3/TS-4) on that. ARCH (F1) and PITFALLS (Pitfall 4) read `nav_marks_apply` and find that days from the first mark `S` onward are stored **equity** marks. | **ARCH/PITFALLS** read more of the code (NAVMTM closed 2026-11-02). TS-3/TS-4 still stand as the pre-`S` check (Gate A) and the instant check. Gate B over the marks era is the only leg where "including open P&L" can actually match. D-4 is largely superseded. |
| C3 | **Where the clock read runs and what it reads** | STACK: an on-demand probe through the harness channel, the max `time_msc` over **visible Market Watch** symbols, rounded to 900 s with a 120 s refusal bound. ARCH: **inside the nightly derive** under the lease, ticks for **the account's own deal symbols**, 60 s residual bound, persisted. PITFALLS: one liquid symbol, rounded to 30 min. | **ARCH placement** (continuous and leased, and it catches the 2027-03-14 transition). **STACK's symbol set** (visible symbols reproduce MQL5 `TimeCurrent`, and ARCH's deal symbols may not be in Market Watch without `symbol_select`), with 900 s rounding. Both carry the same unverified spike. |
| C4 | **Report parser library** | ARCH says `bs4` is "already in `requirements.txt`". STACK read the lock and found `bs4` only as a transitive dependency of yfinance. | **STACK:** use stdlib `html.parser`. A direct import of a transitive dependency can vanish on a quantstats or yfinance bump. |
| C5 | **Window shape** | PITFALLS: end several trading days before the run, straddle 10-25..11-01, **include** a flow, a month-end and a triple-swap Wednesday. ARCH: `W0 = Fri 10-30`, `W1 = Fri 11-13` (today), and **prefer flow-free** because a two-edge oracle cannot give a TWR across a flow. | **Both, per leg.** Gate A (realized, deal-level, no statement needed) takes PITFALLS' rich window, because a flow is a ledger row there. Gate B (equity at two edges only) takes ARCH's flow-free Friday-close window, and compares money ΔE if no flow-free window fits. PITFALLS' "several days before" concern is answered for Gate B by the edges being marks, not the anchor. |
| C6 | **Founder reading at an instant** | FEATURES TS-4: founder reads Balance/Equity/Floating at T, harness checks on D+1. ARCH: frozen weekend equity, or statements, attest edges. | Compatible. Keep both. TS-4 becomes the in-session item and the weekend reading the Gate B edge. |
| C7 | **MT5-09 surface list** | FEATURES TS-7 still names `scenario-blend-panels.ts` and the portfolio PDF. ARCH F6/F7 verify both are gone. ARCH also cites `_compute_portfolio_analytics` at `routers/portfolio.py:653`, not `:628`. | **ARCH.** Re-map MT5-09 with a dated correction, keep the old text as lineage, and cite by symbol. |
| C8 | **Rotation timing** | FEATURES puts the `MT5_SPIKE_INVESTOR_PASSWORD` rotation at the end of the session. PITFALLS says rotate only after S2's reads are done, then re-check gate 1. | **PITFALLS.** It is the same moment, but treat rotation as re-running gate 1. |

## Founder Decisions Needed (de-duplicated, top priority first)

1. **Pre-mark history: realized basis or "including open P&L".** Before each key's first mark day `S`, the rendered record is realized (balance) basis by design (NAVMTM D-09: no backfill). No code fix reaches the open-P&L error there without inventing marks. Choose one: (a) accept realized basis for pre-`S` history, judged by Gate A; (b) caveat it on the surfaces; or (c) withhold it. The harness measures the gap (open P&L at `S`) but must not decide. *(ARCH Pattern 2, PITFALLS 4, FEATURES Conflict 1, STACK §1.)*
2. **What the 1% measures.** It could mean window return in absolute percentage points (`|ΔE_ours − ΔE_oracle| / E(W0)`, ARCH's recommendation), relative error of the level, or relative error of P&L (which blows up on a quiet window). Decide too whether it applies to cumulative return, start level and end level separately (PITFALLS 2). Keep it one named constant.
3. **The weekend reading, which is time-critical.** Today (Fri 2026-11-13) is the candidate `W1`. A frozen-equity reading on Sat 11-14 or Sun 11-15 secures one Gate B edge with no statement. With no statements, Gate B needs **two** such weekends, and missing this one costs a week. Ask today. ✅ **Founder 2026-11-13: "Yes, this weekend."**
4. **Statements.** Do the brokers email daily statements (some send them only on days with activity) or month-end statements for MM2, MM3 and FX-AI_V? They are the only historical-equity oracle (D-5). An October month-end statement would attest `W0 = 10-30`.
5. **The MT5-06 day-boundary wording.** "Lands on the day the terminal shows" conflicts with UTC-day bucketing, because the terminal shows server days. Proposed restatement: "lands on the UTC day of (terminal-displayed server time − the offset in force)", checked as per-day placement. Matching the server day instead would be a bucketing change across every MT5 series. Also record that Phase 175's configured rule is the carrier and the live reading **asserts** it, never written back as config.
6. **The tick-read contract re-cut.** `test_read_only_surface_no_trade_methods` forbids `symbol_info_tick`. Approve one narrow read-only method that returns tick times only (the precedent is `terminal_info`, 153.3/D-31). It touches the `api_verified` read-only trust story. If declined, MT5-06 falls back to a one-off founder clock reading (the 175 precedent), and the continuous check is booked for later.
7. **Clock-mismatch behaviour.** When a live reading disagrees with `Mt5ServerClock`, either refuse that key's persist with an `ops_alert` (the fail-loud default, after 175 D-04) or alert only.
8. **Whether the three accounts share a server.** This may not be readable by SELECT, because the server travels inside the encrypted credential. Either the founder answers, or a worker-side `account_info().server` read records a hash in the reading row. If the servers differ, the single `MT5_SERVER_TIME_RULE` is wrong for at least one account, and a per-server clock comes before parity.
9. **MT5-09: the stale surface list, plus the published-only gap.** Approve the re-mapped list: the portfolio PDF is dropped (retired in Phase 195 TRIM, D-03), `scenario-blend-panels.ts` is dropped (deleted in `32494ba25`), and the factsheet PDF stays. Say where "strategy detail" lives now, since `(dashboard)/strategies/[id]/` holds only `edit/`. Rule on the factsheet PDF, browse and the catalog composer, which show only published strategies while MT5 is "not advertised": publish, use a book or admin view, or scope them out.
10. **Smaller rulings that surface during S1 and S2:** any non-zero **Credit** (is it in the denominator or not); a swap-free account's admin-fee posting; labels for BALANCE-typed non-capital deals; and, if the ledger is truncated, whether the series starts later with an honest marker.

## Implications for Roadmap

Phase numbers **155 and 157 are reserved**. ARCH proposes splitting 155 three ways so that the founder gate blocks only the last part. Book the extra phases with `/gsd-phase --insert`, never by hand. The numbering is the roadmapper's call: for example, keep 155 for the founder-gated verification and insert the harness and the clock capability ahead of it.

**ARCH build order:**
- 0: pre-flight MCP reads and the founder questions.
- 1: the MT5-09 data and render layers, plus MT5-15.
- 2: the engine.
- 3: the our-side extractor.
- 4: oracle intake.
- 5: the MT5-06 capability. It has the longest lead time (deploy and review gates), so start it in parallel with step 1.
- 6: a dress rehearsal on synthetic oracle files plus a real PROD capture.
- 7: the founder session.
- 8: the comparison run, then MT5-10, then a re-run.

### Phase A: Parity harness and agent-only pre-verification (ARCH split i: steps 0–4 and 6)
**Rationale:** It has no founder dependency, so MT5-09 and MT5-15 findings can start MT5-10 fixes weeks early.
**Delivers:**
- the pre-flight census, read through MCP with the marker query first:
  - mark day `S` per key;
  - open P&L at the candidate Fridays;
  - `data_quality_flags`;
  - account unit;
  - published status;
  - record length against the `figure-gate.ts` bound;
  - `computed_at`;
- the engine and taxonomy, with RED proofs;
- the capture SQL and its write-keyword gate;
- the window picker;
- the worksheet and Report parser, against a synthetic fixture;
- the MT5-09 surface matrix on the re-mapped list;
- the MT5-15 explainer;
- `founder-session.md`, with a live completeness check of the founder's sheet;
- the dress rehearsal.

**Addresses:** TS-3, TS-5, TS-7, TS-8, TS-10 (design), D-2, D-3, the inception identity, the deal and cost census (where it can be read from stored data), the provenance enum.
**Avoids:** Pitfalls 1, 2, 7, 10, 11, 12, 14, 15, 16 and 17. Raw files stay in the gitignored `/.mt5-parity/`.

### Phase B: Live server-clock reading (ARCH split ii: step 5; MT5-06)
**Rationale:** It is a data-integrity product change with a migration and a contract widening, so it needs its own review gates (migration-reviewer and rls-policy-auditor clean), plus a confirmed Railway deploy and at least one weekday PROD reading row **before** the founder session.
**Delivers:**
- the narrow tick-time method and the re-cut contract test;
- `assert_reading`;
- the derive integration under the lease;
- the `mt5_server_clock_readings` migration (pure DDL plus RLS);
- the mismatch behaviour from founder decision 7;
- per-key readings that expose a server split.

**Avoids:** Pitfalls 3, 8 and 9, and Anti-Pattern 3 (never write the offset back as config).
**Blocked by:** founder decisions 5, 6, 7 and 8, and a live spike.

### Phase C: Founder-gated verification and the uncapped fix loop (ARCH split iii: steps 7–8; MT5-07, 08, 09 render gate, 10, 15, GOAL-01)
**Rationale:** This is the only part the founder gate blocks. One scripted trading-day session: the clock reading, an All-History Report per account, the Summary block at instant T, the preselected near-midnight deal times, statement figures, and the Phase 157 browser items bundled in. Then the comparison run, TS-4 on D+1, and MT5-10 until every delta is `within_tolerance`, a consistent `withheld_by_gate`, or a named bucket with a recorded founder ruling.
**Also carries:** timeout findings #8 and #10, from percentile data collected across nightlies (Pitfall 13).
**Avoids:** Pitfalls 4, 5, 6 and 14. Fixes go to the shared root, never to `exchange === 'mt5'`.

### Phase 157: FOUNDER-CONFIRM
**Rationale:** Human-only observations: the wizard-resume restart is gone, the amber recomputing block has been seen, the four 153.7 copy members render with no Retry on `SEAM_INTERNAL_FAULT`, and the rotation is done. Run them in the same sitting as Phase C. Rotate `MT5_SPIKE_INVESTOR_PASSWORD` **after** the live reads, then re-check gate 1.

### Phase Ordering Rationale
- Founder decisions 1–4 come first, ideally today, because decision 3 expires this weekend.
- A and B run in parallel. B has the longest lead time.
- C needs A's dress rehearsal green, plus B deployed with a PROD reading row.
- 157 rides along with C's session.

### Research Flags
Need `/gsd-plan-phase --research-phase`:
- **Phase B:** a live spike on whether `symbol_info_tick` answers for visible or non-Market-Watch symbols through mt5linux on Wine, whether its time is in the same encoding as deal `time`, what an investor session's Market Watch holds, and how fresh ticks are during session breaks. Also check what the parked `MT5SERVERLEARN` branch holds.
- **Phase A, parser slice:** the Report's encoding, separators, column headers and whether a per-deal Balance column exists are all undocumented (LOW). Write the parser against one real export and make it fail loud on unknown headers.
- **Phase A, surface slice:** re-locate "strategy detail" and confirm the factsheet loader (*inferred* in ARCH).

Standard patterns, skip research: the engine and taxonomy (the `parity_diff.py` precedent), the capture SQL and write-keyword gate (the marksource census precedent), the migration shape (the `api_key_nav_marks` precedent), and Phase 157.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Read from the lock, the Dockerfile and the unpacked mt5linux wheel. Its Oracle A recommendation is overruled (C1). |
| Features | MEDIUM | Code facts HIGH. External verifier methods MEDIUM to LOW. FX Blue not retrieved. Its basis framing predates the NAVMTM reading (C2). |
| Architecture | MEDIUM | Backend HIGH. Surface tracing partly inferred. The flow table for in-window flows (`_key_inputs_payload["flows"]`) is inferred. |
| Pitfalls | HIGH (repo) / LOW (broker) | Every broker-behaviour claim is paired with a live measurement. No PROD census was taken. |

**Overall confidence:** MEDIUM. The approach is solid. The definitions and live behaviour are not yet measured.

### Gaps to Address
- **Unmeasured PROD state:** `S` per key, open P&L at the candidate Fridays, current `data_quality_flags`, credit per account, server per account, and record lengths. Pre-flight MCP reads settle all of these.
- **Live gateway behaviour:** the tick read and Market Watch contents (Phase B spike).
- **Report format:** encoding, headers and the Balance column. Confirm on the first real export.
- **Broker statements:** whether they exist. Ask the founder.
- **Whether a weekend-quoted symbol exists on any account.** If one does, the Friday-close alignment is void for that account.
- **A3 and 136-05:** the fold and DEAL_TYPE rules close only for the patterns the census actually observes.
- **Where in-window flows are stored** on our side (ARCH inference). Verify when planning.

## Sources

### Primary (HIGH, repo at HEAD 2026-11-13)
- `analytics-service/services/`: `broker_dailies.py`, `nav_marks.py`, `nav_marks_apply.py`, `nav_twr.py`, `mt5_client.py`, `mt5_read.py`, `mt5_concurrency.py`, `mt5_server_clock.py`, `mt5_deals.py`, `parity_diff.py`, `account_unit.py`, `routers/portfolio.py::_compute_portfolio_analytics`
- `tests/test_mt5_client_contract.py`, `tests/test_mt5_deal_timing.py`, `tests/test_mt5_server_clock.py`
- `scripts/mt5offset_dry_run.py`, `mt5_spike.py`, `mt5_soak.py`, `tools/mt5/`
- `src/lib/factsheet/compute.ts`, `scenario.ts`, `portfolio-stats.ts`, `figure-gate.ts`, `src/app/portfolio-pdf/[id]/page.tsx`
- `.planning/PROJECT.md` (v1.18), milestone archives (MT5-06..10 text, the Phase 175 and NAVMTM closures), `175-06-SUMMARY.md`, `136-05-SUMMARY.md`, `TODOS.md`
- `requirements.txt` lock, the `mt5linux` 0.1.9 wheel source

### Secondary (MEDIUM)
- MT5 Trading Report and History Report help pages (Summary values are computed at report generation; Growth excludes flows)
- Myfxbook verification and Gain help, GIPS TWR/MWR material
- PyPI and npm registry JSON, used for versions

### Tertiary (LOW)
- MQL5 `TimeCurrent` / `symbol_info_tick` docs, MQL5 forum posts on growth, swap and commission timing
- broker help pages (Vantage statements, VT Markets dividend balance entries, Pepperstone and OANDA retention)
- a third-party Report parser, which suggests a per-deal Balance column
- B2Broker return method, NFA/CFTC material

---
*Research completed: 2026-11-13*
*Ready for roadmap: yes, once founder decisions 1–4 are asked (decision 3 is time-critical)*

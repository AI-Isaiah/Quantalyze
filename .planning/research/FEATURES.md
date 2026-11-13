# Feature Research

**Domain:** Live verification of an MT5/forex track record against the broker's own figures (v1.18 MT5-VERIFY, Phases 155 and 157)
**Researched:** 2026-11-13
**Confidence:** MEDIUM overall. Codebase facts are HIGH (read at HEAD). External verifier methods are MEDIUM where two or more sources agree and LOW where only one does. FX Blue's own method was not retrieved at all.

The build is done. MT5 sync, deal-ledger reconstruction and every surface already exist and are out of scope here. So the "features" below are **verification checks and evidence artifacts**. Each one is mapped to a requirement (MT5-06..10, MT5-15, MT5-GOAL-01, Phase 157), given a complexity, and tied to the existing code it depends on, cited by symbol.

---

## Read this first: two blocking definitional conflicts

These must be settled at `/gsd-discuss-phase 155`, before the harness is planned. Both come from reading the code at HEAD, and both change what "pass" means.

### Conflict 1: realized basis vs "parity including open P&L" (MT5-07)

- **What the code does (HIGH, `services/broker_dailies.py`, the MT5 combiner and `reconstruct_mt5_nav_levels`):**
  - It anchors to live `account_info().equity`.
  - It subtracts the floating wedge `equity − balance` **before** the backward roll.
  - So every reconstructed interior day is **realized (balance) basis**.
  - A material wedge raises the `unrealized_pnl_in_anchor` flag and is never spread back over history. The docstring says historical open-position marks "are not retrievable on a read-only key".
- **What MT5-07 asks for:** parity within 1% *including open P&L*, over a window that ends *before* the run day.
- **Why they collide:** the terminal also has no historical equity. The History report shows equity and floating P/L only *at the moment the report is generated* (MEDIUM, metatrader5.com help). Equity at a past instant E cannot be read on the run day from the terminal, or from our pipeline either.
- **The deciding fact:** how large `(equity − balance) / equity` is on each of MM2, MM3 and FX-AI_V on the run day, and on the window-end day. Below roughly 0.3%, the 1% band absorbs the wedge and the conflict is academic. A held-open book can sit at several percent, and then the founder needs to make a call.
- **Recommendation:** make "including open P&L" mean **two checks with stated bases**:
  - (a) **Realized parity:** our window-end realized NAV against the terminal's balance at E, to within 1%. This is the strict check.
  - (b) **Captured-instant balance parity plus a wedge reading:** the founder reads terminal Balance, Equity and Floating P/L at a stated instant T on day D. On D+1 or later, after a sync has re-anchored to a *later* equity, the harness rolls our ledger back to T (by deal instants, not to the end of the UTC day) and compares it with the terminal's **balance** at T. That makes T a backward-reconstructed point, so the check can fail. The founder's equity reading only *measures* the wedge at T. Our series cannot match it, because every reconstructed point is balance basis by construction.
  - **Only two things cover historical open P&L:** broker daily statements (D-5), if they exist, or a founder ruling that "including open P&L" means "the 1% band must absorb the measured wedge". Neither the terminal nor our pipeline can produce past equity.
  - Do not quietly redefine the requirement. Record the founder's wording in CONTEXT.md and the ROADMAP.

### Conflict 2: UTC-day bucketing vs "the day the terminal shows" (MT5-06)

- **What the code does (HIGH, `services/mt5_deals.py` `deal_utc_day` → `_utc_day_of_server_epoch`):** a deal is bucketed by **UTC calendar day**. The server offset in force at that deal is removed first, from `Mt5ServerClock`'s `eu`/`us` rule in `services/mt5_server_clock.py`.
- **What the terminal shows:** deal times in **server time**. For a UTC+2/+3 broker, a deal at 01:30 server time sits on server day N and UTC day N−1. So under the current code it lands on a *different* day than the terminal shows. That is by design, not a bug.
- **Consequence for the oracle:** the terminal's Trading Report monthly table uses server-time months, so a deal in the first 2–3 server hours of a month moves months between the two views.
- **Recommendation:** read MT5-06 as "**the measured live offset equals the offset `Mt5ServerClock` applies at that instant**, and a chosen near-midnight deal lands on the UTC day that offset implies". The founder confirms the deal's server time on screen, and the harness confirms the UTC day.
  - If the founder actually means "match the server day", that is a bucketing change that touches every MT5 series. It is a decision, not a fix.
  - Either way, **set window boundaries inside the weekend gap.** Between the Friday close and the Monday open no deals occur, apart from balance operations, so server-day vs UTC-day cannot move the boundary.

---

## How the outside world does this (the reference set)

| Verifier | What it actually checks | Return method | Basis | Confidence |
|---|---|---|---|---|
| **Myfxbook "Track Record Verified"** | Account number, investor password, broker and server are valid. History is pulled from the broker's server rather than uploaded. | Gain = TWR, "not affected by deposits or withdrawals". Absolute gain is reported separately. | The help text notes balance moves only when trades close, so Gain is effectively **balance basis**. Equity and equity drawdown are shown separately. | MEDIUM (several forum and vendor sources agree; the help page returned 403, so this is snippet-only) |
| **Myfxbook "Trading Privileges Verified"** | A pending order matching a generated code proves control of the account. Stops a stranger publishing someone else's account. | n/a | n/a | MEDIUM |
| **MT5 terminal Trading Report / MQL5 Signals** | Built from the account's own history. | Growth % "excluding withdrawals and deposits". Community reverse-engineering: chain-linked **balance** between balance operations. Known to misbehave when a deposit lands while trades are open. | Balance | MEDIUM (official help for the definition; forum for the formula) |
| **MT5 History report** (History tab, right-click, Report) | Orders, Deals with closed P/L, open Positions with floating P/L, and a Summary (Balance, Credit, Floating P/L, Equity, Margin) **at generation time**. Balance-drawdown figures are included. | None. It is raw money. | Raw | MEDIUM (official help). The per-deal running-Balance column is inferred from one third-party parser (LOW), so confirm it at the terminal. |
| **B2Broker / copy-trading platforms** | Equity just after one balance operation to equity just before the next, chain-linked. | Equity TWR | Equity | LOW (single vendor doc) |
| **GIPS / institutional allocators** | TWR where the client controls flows. Value at least monthly **and on every large external flow**; daily valuation is best practice. MWR/IRR only where the manager controls flow timing. Operational due diligence takes statements **directly from the broker**, never from the manager. | TWR sub-period `(EV − BV − CF)/(BV + CF)`, chain-linked | Full valuation (equity) | MEDIUM (secondary study sources agree; GIPS text not read directly) |
| **NFA / CFTC (forex CTAs)** | Performance must be supported by trading records. Brokers must make monthly and confirmation statements available. Regulators found newly enrolled forex CTAs publishing figures the records did not support. | n/a | n/a | LOW (press plus one CFTC letter) |
| **FX Blue** | **Not retrieved.** Its Publisher EA uploads MT history, with start-date and magic-number filters. Its return and banked-vs-floating method is unknown. | unknown | unknown | GAP. Do not cite FX Blue's method anywhere. |

**Takeaways for us:**

1. **Every retail verifier's headline gain is balance basis.** Equity is shown beside it, and equity drawdown is where allocators look for hidden risk: the classic MT4/MT5 track-record trick is to hold losing positions open so the balance curve stays smooth. Our realized-basis series has that same blind spot, so it must say so.
2. **"Verified" in the market means three things:**
   - the history came from the broker's server, not the user;
   - the account is real (live, not demo);
   - the numbers are recomputed by the verifier.

   It never means "the strategy is good", and Myfxbook's own FAQ concedes that verified accounts can carry inaccuracies.
3. **The deposit/withdrawal method is where implementations diverge,** even when they all say "TWR". Comparing *our* return to *their* growth % mixes data error with method error. That is why the primary oracle below is raw money, not someone else's percentage.

### Balance vs equity vs flows, time-weighted vs money-weighted: the positions to take

- **Return type: TWR, not MWR.** The allocator judges the manager's skill, and the account holder controls deposits and withdrawals. This is the GIPS rule and what every retail verifier uses. MWR would reward or punish the timing of a deposit.
  - The code already does flow-in-numerator TWR: `r_t = (NAV_t − NAV_{t−1} − F_t)/NAV_{t−1}`, through `nav_twr.reconstruct_nav_and_twr`.
  - FLOWTIMING (164.6.6.2.3) adds intraday position-level timing on flow days. That goes beyond GIPS, which only requires revaluing on large-flow days.
- **Flows: an allow-list.** `classify_deal` treats BALANCE=2, CREDIT=3 and BONUS=6 as external flows. Trading is BUY/SELL plus the COMMISSION family 7–11. CHARGE, CORRECTION, INTEREST, the CANCELED types, DIVIDEND and TAX **fail loud**.
  - ⚠️ Live index-CFD books routinely receive **dividend adjustments** (DIVIDEND 15/16).
  - ⚠️ Swap-free accounts receive **admin charges** (CHARGE=4).
  - If any of the three accounts carries either, the sync refuses by name rather than mis-classifying. That is correct, and it would surface as a finding during the session.
- **CREDIT as a flow:** some funded and prop programmes fund part of the account as broker credit. Credit is in equity (MT5's formula: `Balance + Credit − Commission ± Floating − Blocked`) but it is not the trader's capital.
  - Check whether any of the three accounts shows a non-zero **Credit** on the terminal Summary.
  - If one does, the denominator question (with or without credit) needs a founder call.

---

## Feature Landscape

### Table Stakes (a "verified" claim is not credible without these)

| Check / artifact | Req | Why expected | Complexity | Depends on (existing) |
|---|---|---|---|---|
| **TS-1 Live offset measurement per server.** The live server clock is compared with UTC at connect. The harness asserts it equals the offset `Mt5ServerClock` applies at that instant, for **each** of the three servers, which may follow different `eu`/`us` rules. | MT5-06 | A wrong offset moves P&L across days and months, and no oracle shows it unaided. ⚠️ A live reading checks the **offset**, not the **rule**: `eu` and `us` share the same offsets (UTC+2 standard, UTC+3 daylight) and differ only in transition dates, and in mid-November both are in standard time. A mis-set rule shows only on deals inside the divergence weeks (2026-10-25 to 2026-11-01, and 2026-03-08 to 2026-03-29), so TS-2 must cover that. | LOW–MEDIUM | `mt5_server_clock.resolve_mt5_server_clock`, `Mt5ServerClock.day_offset_s`, the gateway's `account_info`/terminal time read |
| **TS-2 Near-midnight deal regression.** One real deal near the server or UTC day boundary is pinned. A test asserts the UTC day it lands on, from that deal's real `time` and the offset in force at that instant. **Pick it from a DST divergence week** (2026-10-25 to 2026-11-01 if the account traded then), where `eu` and `us` give different offsets, so the deal also pins which rule the server follows. Otherwise the rule stays unverified, and that is recorded as such. | MT5-06 | The one failure MT5-07's oracle cannot see (per the success criterion). It needs a real deal, not a synthetic one, so the expected values come from the terminal. | LOW | `mt5_deals.deal_utc_day`, `deal_utc_instant_ms` |
| **TS-3 Raw-money window parity (primary oracle).** For a window [S, E] with E in the weekend gap before the run day, the terminal's own export gives balance at S, balance at E, the sum of deposits and withdrawals in the window, and net closed P&L (profit + swap + commission + fee) in the window. Balance at S and E come from the Deals table's running Balance column **if present** (LOW confidence). Otherwise they are derived from the terminal's current balance (Summary block, step 2 of the script) rolled back through the exported deals. That derivation is still the terminal's data, but it is weaker: it relies on the export being complete. The harness compares these with our reconstructed realized NAV at S and E and our flow sum. **Identity check:** `B_E − B_S = closed P&L + flows` on both sides. | MT5-07, MT5-08 | It separates *data* error (a missing deal, a mis-typed deal, a wrong day) from *method* error, which comparing our TWR % to the terminal's Growth % cannot do. This is what an operational due-diligence analyst does with a broker statement. | MEDIUM (the export parser plus the diff; parse by **header name**, never column index, because the column set varies between builds and a Fee column may be present) | `broker_dailies.reconstruct_mt5_nav_levels` (the levels reader, kept apart from the returns reader on purpose), `_fold_mt5_deals`, `mt5_deals.deal_cash_effect` |
| **TS-4 Captured-instant balance parity plus a wedge reading.** The founder records terminal Balance, Equity, Floating P/L and Credit at a stated instant T on day D. **On D+1 or later**, after the next sync has re-anchored to a later equity, the harness rolls our ledger back to T using deal instants, not our end-of-UTC-day value, and compares it with the terminal's **balance** at T against the named 1% constant. The equity reading is recorded as the measured wedge `(equity − balance)/equity` at T. It is not compared with our series, which is balance basis at every reconstructed point. | MT5-07 | It turns a fresh terminal reading into a backward-reconstructed check that can fail. Comparing the run day's own figures is tautological, because the anchor *is* that equity. The wedge reading is the fact the founder needs to rule on Conflict 1. It does **not** prove historical open-P&L parity; only D-5 or a founder ruling covers that. | LOW (the founder's reading plus a harness assertion) | `reconstruct_nav_and_twr` anchor roll, `unrealized_pnl_in_anchor` meta, the next scheduled sync |
| **TS-5 Return-level spot check against the terminal's Growth %.** Monthly returns for 2–3 complete months from the Trading Report, against our chain-linked monthly TWR for the same months. A difference is explained, not merely tolerated: flows while trades were open, month-boundary shift from server time vs UTC, or balance vs realized basis. | MT5-07 | Allocators read percentages, not dollars. It is a second, independent implementation (MetaQuotes' code), so agreement means something. It is a **secondary** check because of method divergence. | LOW | Stored `strategy_analytics` monthly returns. The terminal Growth table is the founder's screenshot. |
| **TS-6 Live funded account, trading day, real server.** The account type (real, not demo), the server name, a trading day (not a weekend) and a recent deal timestamp are all recorded. | MT5-08 | Myfxbook's verified badge rests on this exact property, and fake broker servers exist. The roadmap says outright that a demo account, the soak account or a weekend run does not count. | LOW | `account_info` (trade-mode field), `api_keys` labels for the three accounts |
| **TS-7 Cross-surface consistency.** For each of the three strategies, one window and one metric set (total return, CAGR, max DD, vol, Sharpe, last date) is captured from strategy detail, public factsheet, scenario composer, portfolio PDF and browse, and diffed against one stored source. Any divergence is a finding. | MT5-09 | "One number everywhere" is the minimum allocators expect. The roadmap names the backbone-bypass surfaces to check. | MEDIUM (five surfaces × three strategies, partly automatable through the existing e2e and read paths) | `_compute_portfolio_analytics`, `equity_reconstruction.py`, `portfolio-stats.ts`, `scenario-blend-panels.ts`, `health-score.ts`, `figure-gate.ts` (the v1.21 single figure gate) |
| **TS-8 Warning explained per strategy.** For each of the three PROD strategies, read which `NAV_TWR_GUARD_KEYS` member fired, from the persisted data-quality flags. Then fix it at its root, or accept it in writing with the measured magnitude. | MT5-15 | Our own pipeline flagged itself. External parity does not explain why (the roadmap says MT5-07 does not close MT5-15). Hypothesis (LOW, unmeasured): `unrealized_pnl_in_anchor` or `flow_coverage_incomplete`. | LOW to read, unknown to fix | `transforms._merge_status_meta`, `nav_twr.NAV_TWR_GUARD_KEYS`, `strategy_analytics` data-quality flags |
| **TS-9 Root-cause fix loop, uncapped.** Every divergence from TS-3 to TS-8 is fixed where its root lives, including shared backbone money-math, and re-measured with the same harness. | MT5-10 | A founder decision: the phase does not close while the terminal and the UI disagree. | HIGH (unbounded by decision) | Whatever TS-3 to TS-8 surface |
| **TS-10 Basis disclosure.** Each MT5 factsheet states its basis (realized/balance, with floating P/L not in the history) and the anchor date. | MT5-07 framing | Every retail verifier labels balance gain apart from equity. An unlabelled realized-basis curve can understate drawdown for a book that holds open losses. | LOW, if a basis or provenance label already exists to extend; MEDIUM if not | `api_verified` provenance stamp (Phase 111 tiers), TERMS-02 "Data source" (deferred; do not pull it in wholesale) |
| **TS-11 Founder confirmations.** The wizard-resume restart is gone; the amber recomputing block has been seen; the four 153.7 copy members render, with no Retry on `SEAM_INTERNAL_FAULT`; `MT5_SPIKE_INVESTOR_PASSWORD` has been rotated. | Phase 157 | These observations rest on a human. They belong in the same sitting. | LOW | Phase 153.7 and 154 surfaces |
| **TS-12 Umbrella acceptance.** The founder confirms that an MT5 strategy ingests, projects in a scenario and has a viewable factsheet. | MT5-GOAL-01 | Stops "ingested" being mistaken for "works". | LOW | SCEN-01 (Phase 147), OWN-02 (Phase 148) |

### Differentiators (beyond what Myfxbook-style verification offers)

| Feature | Value proposition | Complexity | Notes |
|---|---|---|---|
| **D-1 Per-deal running-balance replay.** The full History export, from inception to E, is parsed. Our ledger fold is replayed deal by deal against the terminal's per-deal Balance column (if present), so the **first** diverging deal is named. | Turns "off by 0.7%" into "deal #N, a DIVIDEND, classified as X". This is the fastest root-causing tool for TS-9. | MEDIUM | Confirm at the terminal that the Deals table carries a running Balance column (LOW confidence it does in this build). If it does not, fall back to TS-3 at weekly checkpoints. |
| **D-2 Weekend-gap window boundaries.** All windows start and end inside the Friday-close to Monday-open gap. | Removes the server-vs-UTC day ambiguity from every comparison by construction, without arguing about MT5-06's semantics. | LOW | The weekend gap is an **assumption, not a fact**: crypto CFDs and BTC-unit MT5 accounts (see PROJECT.md, native-unit accounts) can trade through the weekend. The harness asserts zero trading deals in the chosen gap for each account, and refuses the window by name if any exist. |
| **D-3 One harness, re-runnable on any account.** The parity harness takes a terminal export and a strategy id, prints a verdict per check, and exits non-zero on breach, with the tolerance as a **named constant** (the roadmap's rule). | The same harness re-verifies after every TS-9 fix and works for a future MT5 account without the founder writing anything. | MEDIUM | Raw exports are **never committed**: the repo is public, and they carry the account number, holder name and broker. Keep them in a gitignored local path. Tracked evidence records only derived numbers and a sha256 of the export. |
| **D-4 Equity-basis history going forward.** Each sync stores the `account_info` balance, equity and credit with a timestamp, so true equity-basis history builds up from now on. This is what Myfxbook does after you connect. | Closes Conflict 1 for the future without fabricating past marks. Lets equity drawdown be shown later. | MEDIUM (storage plus a writer) | **Not v1.18 scope.** The milestone verifies; it does not build. Book it if Conflict 1 turns out to be material. |
| **D-5 Broker daily statements as a historical equity oracle.** If the broker emails end-of-day statements (balance, equity, floating P/L at server close), they are exact historical equity readings, including open P&L, for a window that ends before the run day. | The only source that answers "including open P&L" over a *past* window. | LOW to use | LOW confidence that these brokers send them, since MT5 support for this is broker-configured. Ask the founder to check their inbox before the session. |

### Anti-Features (look like rigour, cause harm)

| Feature | Why requested | Why problematic | Alternative |
|---|---|---|---|
| **Comparing the run day's equity** | It is the easiest number to read off the terminal. | It is tautological, because the anchor is that equity. The roadmap says so. | TS-3 (a past window) and TS-4 (captured on D, checked on D+1). |
| **Myfxbook or FX Blue Gain % as the primary oracle** | "Third-party verified" sounds stronger. | It is a different method: balance-basis chain-linking with their own handling of flows during open trades. A gap mixes method error with data error, and it adds a dependency on the accounts being connected there. FX Blue's method is unknown. | The terminal's raw money (TS-3) is primary. Growth % (TS-5) is a secondary cross-check. |
| **Spreading today's floating P&L back over history** to "include open P&L" | It makes the parity number pass. | It fabricates marks. The code explicitly refuses this (`reconstruct_mt5_nav_levels` docstring), and the project rule is never to invent data. | Disclose the basis (TS-10). Equity-basis history going forward (D-4). |
| **Widening the tolerance to absorb a gap** | It closes the phase. | It averages away the defect TS-9 exists to fix. The 1% is a founder call. | A named constant. Any change is a recorded founder decision. |
| **Hardcoding the observed offset** | It is quick. | It breaks at the next DST transition and is wrong for other brokers. The success criterion forbids it. | Measure and assert (TS-1). |
| **An internal-consistency test as "parity"** | It is automatable. | It is the self-referential oracle that let three money bugs survive six passes. | Only terminal or broker figures count as the oracle. |
| **Committing statement exports or screenshots** | Evidence in the repo. | The repo is public and the files carry the account number, holder name and broker. | Gitignored local storage. Commit derived figures plus a sha256. |
| **A "Verified" badge or marketing claim from this milestone** | It is the payoff. | "Do not advertise MT5 until Phase 155 passes" stays in force until the umbrella closes, and even then the claim must state its basis. | Decide the claim's wording after MT5-GOAL-01, as a separate decision. |
| **Fixes scoped to `exchange === 'mt5'`** | They are fast. | The v1.17 lesson: almost nothing on these surfaces is an MT5 defect. | Fix at the shared root (TS-9). |

---

## The founder session: one short script on a trading day

The goal is about 20–25 minutes for all three accounts, and the founder never has to interpret anything. Agents pre-verify everything agent-checkable first (Gate 1 is cleared: all three keys synced 2026-11-13). The script is ordered so the most valuable captures come first, in case the session is cut short.

**Before the session (agent-side, no founder needed):**
- The harness is built and dry-run on the current stored series.
- The parser has been tested on a sample export layout.
- The cross-surface diff (TS-7) has run.
- The guard flags (TS-8) have been read on PROD.
- Window E has been chosen as the most recent weekend gap before the run day.
- Ask the founder by message whether the brokers email daily statements (D-5).

**At the terminal, per account (MM2, then MM3, then FX-AI_V), logged in with the investor password, the same view our gateway has:**

1. **(1 min) Clock.** Screenshot Market Watch showing server time next to a UTC clock, for example time.is/UTC. This gives TS-1.
2. **(1 min) Account identity.** Screenshot the account header (server name, real/demo) and the Summary block: Balance, Credit, Floating P/L, Equity. Write down the exact time. This gives TS-4 (the capture at instant T, plus the wedge), TS-6, and the current balance that TS-3 falls back on.
3. **(3 min) History export.** In the History tab, choose "All history" (or a period from before inception to now), right-click, Report, save as HTML or XLSX, whichever this build offers, to the agreed gitignored local folder. This gives TS-3 and D-1. ⚠️ Confirm on screen that the Deals table shows a Balance column. If custom-period or XLSX is not offered, take whatever exists; the parser handles it.
4. **(1 min) Near-midnight deal.** In the Deals list, find the agent-preselected deal by ticket number and screenshot its time as the terminal shows it. Agents preselect it from a DST divergence week where one exists. This gives TS-2.
5. **(1 min) Growth table.** Open the Trading Report, Summary, Growth by month, and screenshot it. This gives TS-5.

**Once, after all three accounts (about 5 min):**

6. Walk through the Phase 157 items (TS-11) and the MT5-GOAL-01 path (TS-12) on one account.
7. Rotate `MT5_SPIKE_INVESTOR_PASSWORD`.

**Next day (agent-side):** after the next scheduled sync re-anchors, run TS-4. A failed check goes to TS-9; the founder is not needed again unless a fix needs a new terminal reading.

---

## Feature Dependencies

```
TS-1 offset measured ──> TS-2 near-midnight regression
        │
        └──> TS-3 raw-money window parity ──> D-1 per-deal replay (root-causing)
                    │                               │
                    ├──> TS-5 Growth % cross-check  │
                    └──> TS-4 captured-instant balance parity + wedge (needs a sync on D+1)
                                    │
TS-7 cross-surface diff ────────────┤
TS-8 guard-flag read ───────────────┤
                                    v
                         TS-9 root-cause fix loop (uncapped) ──> re-run TS-3/4/5/7
                                    │
                                    v
                         TS-12 MT5-GOAL-01 umbrella ──> (later) claim wording / badge

D-2 weekend-gap boundaries ──enhances──> TS-3, TS-5
TS-10 basis disclosure ──resolves──> Conflict 1 (presentation half)
D-4 equity history forward ──conflicts──> v1.18 "verify, don't build" scope (defer)
```

### Dependency notes

- **TS-3 requires TS-1:** a wrong offset moves deals across the S and E boundaries. Weekend-gap boundaries (D-2) make TS-3 robust to it, but TS-1 must still pass on its own.
- **TS-4 requires a sync after the capture:** the D+1 run is what makes day D backward-reconstructed. Plan for the founder session and the TS-4 verdict landing on different days.
- **TS-9 depends on everything above, and its size is unknowable until they run.** Phase planning should budget the harness and session as fixed, and TS-9 as an open loop with re-measurement.
- **TS-7 and TS-8 need no founder.** Run them before the session so any finding they produce is already in TS-9 when the terminal readings arrive.
- **The founder call on Conflicts 1 and 2 blocks TS-3, TS-4 and TS-2's assertion wording.** Settle them at discuss-phase.

---

## MVP Definition

### Launch with (v1.18 / Phase 155 and 157)

- [ ] Founder decisions on Conflict 1 (basis) and Conflict 2 (day semantics), recorded in CONTEXT.md and the ROADMAP.
- [ ] TS-1, TS-2: offset measured on all three servers, plus one real-deal regression.
- [ ] TS-3: raw-money parity over a weekend-gap window. **This is the core oracle.**
- [ ] TS-4: balance at a captured instant checked on D+1, plus the measured wedge.
- [ ] TS-6, TS-7, TS-8: live-account proof, cross-surface diff, warning explained.
- [ ] TS-9: every divergence fixed at its root and re-measured.
- [ ] TS-11, TS-12: founder confirmations and umbrella acceptance.
- [ ] D-2, D-3: weekend-gap convention (asserted per account) and a re-runnable harness (no raw exports committed).
- [ ] TS-10: basis disclosure on every MT5 factsheet. Without it, a correct realized-basis drawdown reads as an equity drawdown, which is a correctness problem on the surfaces MT5-09 covers. Extend an existing provenance label rather than building TERMS-02.

### Add after validation (v1.x)

- [ ] D-1 per-deal replay, if TS-3 fails and the cause is not obvious.
- [ ] D-4 equity-basis history going forward. Trigger: the wedge is material on any account.

### Future consideration

- [ ] A public "verified against broker" claim with a stated basis and as-of date, after MT5-GOAL-01.
- [ ] A Myfxbook-style "trading privileges" proof of control. It is irrelevant while the founder owns all three accounts, and only matters once third-party managers onboard MT5.

---

## Feature Prioritization Matrix

| Feature | User value | Implementation cost | Priority |
|---|---|---|---|
| Conflict 1 and 2 decisions | HIGH | LOW | P1 |
| TS-3 raw-money parity | HIGH | MEDIUM | P1 |
| TS-1/TS-2 offset and regression | HIGH | LOW | P1 |
| TS-4 captured-instant balance + wedge | HIGH | LOW | P1 |
| TS-7 cross-surface diff | HIGH | MEDIUM | P1 |
| TS-8 warning explained | MEDIUM | LOW | P1 |
| TS-9 fix loop | HIGH | HIGH (unbounded) | P1 |
| TS-6, TS-11, TS-12 | MEDIUM | LOW | P1 |
| TS-5 Growth % cross-check | MEDIUM | LOW | P2 |
| D-2 weekend-gap boundaries | MEDIUM | LOW | P1 (free) |
| D-3 re-runnable harness | MEDIUM | MEDIUM | P1 |
| D-1 per-deal replay | MEDIUM | MEDIUM | P2 |
| TS-10 basis disclosure | MEDIUM | LOW–MEDIUM | P1 |
| D-5 daily-statement oracle | MEDIUM | LOW | P2 (if available) |
| D-4 equity history forward | MEDIUM | MEDIUM | P3 (defer) |

## Competitor Feature Analysis

| Feature | Myfxbook | MT5 terminal / MQL5 Signals | Our approach |
|---|---|---|---|
| Source of history | Broker server through the investor password | The account's own server history | Same as Myfxbook: read-only investor password through our gateway |
| Headline return | TWR "Gain", balance basis; absolute gain separate | Growth %, chain-linked balance, excluding flows | Flow-in-numerator TWR on realized basis, with position-level flow-day timing |
| Open P&L | Shown as equity beside the balance gain; equity history only from the moment of connection | Equity and floating only at report time; equity graph computed from history | Anchor includes it. History excludes it and says so (flag now, label in TS-10). Forward equity history deferred (D-4). |
| Proof the account is real | "Track Record Verified" (credentials plus server) | n/a | TS-6: real/demo trade mode plus server, recorded |
| Proof of control | "Trading Privileges Verified" (pending-order code) | n/a | Not needed now (founder-owned accounts) |
| Independent recomputation | Yes: their own engine | Yes: MetaQuotes' engine | TS-3 (raw money) as primary, TS-5 (their engine) as secondary |
| Admitted limits | FAQ admits inaccuracies; fake servers possible | Growth misbehaves on flows during open trades | Fail loud on unknown deal types; uncapped root-cause fixes |

## Sources

Codebase (HIGH, primary, read at HEAD 2026-11-13):
- `analytics-service/services/mt5_deals.py`: `classify_deal`, `deal_cash_effect`, `deal_utc_day`, `_utc_day_of_server_epoch`, `deal_utc_instant_ms`
- `analytics-service/services/mt5_server_clock.py`: `Mt5ServerClock`, the `eu`/`us` rules and the 2026 transition dates
- `analytics-service/services/broker_dailies.py`: the MT5 combiner and `reconstruct_mt5_nav_levels` docstrings (realized basis, `unrealized_pnl_in_anchor`)
- `analytics-service/services/transforms.py`: `_merge_status_meta` (how a run reaches `complete_with_warnings`)
- `.planning/PROJECT.md` (v1.18 section), `.planning/ROADMAP.md`, `.planning/milestones/v1.17-ROADMAP.md` (Phase 155 success criteria)

External (tiers from the classify-confidence seam: one web source = LOW, cross-checked = MEDIUM):
- [MT5 Trading Report help](https://www.metatrader5.com/en/terminal/help/trading/report): Growth excludes deposits and withdrawals, the equity formula, HTML/PDF export (MEDIUM)
- [MT5 History report help](https://www.metatrader5.com/en/terminal/help/trading_advanced/history_report): sections, Summary fields at generation time, balance-drawdown definitions (MEDIUM)
- [MT5 signal monitoring help](https://www.metatrader5.com/en/terminal/help/signals/signal_monitoring.md) and [MQL5 forum: growth explained](https://www.mql5.com/en/forum/168666): balance chain-linking, flows during open trades (MEDIUM for the definition, LOW for the formula)
- [Third-party MT5 report parser](https://huggingface.co/algorembrant/mt5-analyzer/blob/main/server/utils/parser.js): Deals table with a Balance column (LOW, so confirm at the terminal)
- [Myfxbook: Why Verify?](https://www.myfxbook.com/help/verification), [babypips guide](https://forums.babypips.com/t/a-guide-to-using-and-recognising-myfxbook-accounts/52656), [MQL5 blog: reading a Myfxbook record](https://www.mql5.com/en/blogs/post/779425): the two verification badges and their limits (MEDIUM)
- [Myfxbook gain help (403, snippet only)](https://www.myfxbook.com/help/?p=271), [fxnx guide](https://fxnx.com/en/blog/reading-myfxbook-track-record-gain-drawdown-verified-badges): TWR Gain vs absolute gain (MEDIUM)
- [B2Broker return calculation](https://b2broker.com/products/b2copy/knowledge-base/concepts/return-calculation/): equity chain-linked between balance operations (LOW)
- [Acadifi: GIPS TWR vs MWR](https://www.acadifi.com/community/gips-performance-calculation-time-weighted-money-weighted), [GIPS Q&A](https://www.gipsstandards.org/?GIPSID=436): monthly valuation plus valuation on large flows, TWR vs MWR by who controls flows (MEDIUM)
- [Euromoney: NFA oversight of currency CTAs](https://euromoney.com/article/b12kjbvfqxpcks/nfa-boosts-oversight-of-currency-ctas), [CFTC letter 12-01](https://cftc.gov/csl/12-01/download): performance must be supported by records; broker statements available (LOW)
- FX Blue: **no primary source retrieved**, so it is a gap.

---
*Feature research for: live MT5 track-record verification (v1.18 MT5-VERIFY)*
*Researched: 2026-11-13*

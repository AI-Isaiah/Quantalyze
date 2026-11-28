# Requirements: Quantalyze, milestone v1.22 TRUTH — data you can trust

**Defined:** 2026-11-23
**Core Value:** Allocators act on Bridge recommendations and see whether those suggestions actually worked — and can model the impact of composition changes before they make them.
**Milestone goal:** Every number, label and alert we show is correct, or it fails loudly.

**Sources:** `.planning/PROJECT.md` (Current Milestone v1.22), `.planning/research/v1.22/` (SUMMARY, FEATURES, PITFALLS), `.planning/milestones/v1.18-REQUIREMENTS.md` ("Carried to the next milestone"), `.planning/ROADMAP.md` (Phases 221–225), and the 2026-11-23 founder scope input and `TODOS.md` triage. Each requirement names the `TODOS.md` ids it closes in a `(covers: …)` suffix. An `L<n>` id is a `TODOS.md` entry with no id of its own, named by its start line in `TODOS.md` at commit `57bc06f2c` (the #1309 squash, the copy the triage read; `git show 57bc06f2c:TODOS.md`). Find it at HEAD by its text, because line numbers drift.

## Founder decisions binding this milestone (2026-11-23)

- **F-1 Scope and order.** Every open MEDIUM-and-higher `TODOS.md` entry is in scope, ordered data integrity first, then user-facing, then security, then the rest. LOW and INFO entries stay in `TODOS.md`.
- **F-2 No composites** ("Forget about conposites"). No requirement builds, fixes or re-derives a composite. An entry with a composite half keeps only its non-composite half. Phase 223 keeps its flow-source half only.
- **F-3 Demo accounts (`158-OPS-03`).** The two demo accounts are unused: they are deleted, and their credential literals leave the tree, with an absence guard that can still go RED.
- **F-4 GLB-1** (smoothed-MTM expiry day): its trigger has not fired, so it stays out.
- **F-5 Figures: one convention, "365, ddof 1 everywhere".** This applies inside the existing annualization rule: risk is annualized by frequency (crypto 365, traditional 252), returns by calendar, and a blend uses 365 if any leg is crypto. The TypeScript engines move to match Python.
- **F-6 CVaR** is historical CVaR, null below a minimum number of observations.
- **F-7 `189-OPTIONREPLAY-NEXT-MILESTONE` and `164.8.4-REDACT-NO-POSITIVE-SCAN` stay in `TODOS.md`** ("Bleiben in todos"). They are not v1.22 scope.
- **F-8 The `poll_positions` enqueue is live.** Measured on PROD 2026-11-23: `poll_positions` jobs ran on 21 days between 2026-10-24 and 2026-11-23, for one strategy only. Phase 224 must NOT retire it. The direction of `FANOUT-COHORT-SIBLING-POLL-01` (widen the cohort) is right. This overrides the wording of Phase 224's ROADMAP goal and of `TODOS.md` `L2925` for `poll_positions`.
- **F-9 Deribit stale returns** (debug sweep 2026-11-23): one Deribit account's stored returns end 2026-10-26 while its inputs carry a 2026-11-09 flow and its derives report `done`. It gets a stale-returns requirement and a per-venue freshness invariant.
- **F-10 Two milestones** ("Yes, split into two milestones", 2026-11-23). v1.22 TRUTH keeps the data-integrity and user-facing tiers: the carried Phases 155.2, 157, 222, 223 and 225, the groups MT5D, VREAD, DBOOK, FRESH, HOLD, NOCAP, HEAL, FIG, FACT, CACHE, CONN, RLIM and SOAK (SOAK is the independent MT5 oracle, so it stays as wave 0), and PROOF-01. ⭐ Exception: SECR-01 and SECR-02 (delete the two demo accounts, remove the committed demo credentials) stay in v1.22 because `158-OPS-03` is the only HIGH item. v1.23 HARDEN (security, alerting, tooling; planned, starts after v1.22) takes the carried Phases 221 and 224 and the groups SECR-03/04, DBACC, HELD, ALRT, SQLG and LANE, listed under "Planned for v1.23" below. PROOF-01 applies there too. F-1's tier order holds inside each milestone. ⭐ **2026-11-25 (founder ruling in chat; also in `ROADMAP.md` and in each phase's CONTEXT.md):** "We will Move 157 and 155.2 into the next milestone". The carried Phases 155.2 and 157 moved to v1.23 HARDEN, with MT5-07..10, MT5-15, MT5-GOAL-01 and FCONF-01..04. Their requirement text stays under its "Carried" headings below; the traceability table maps them to v1.23. ⭐ **2026-11-27 (founder ruling in chat; also in `ROADMAP.md` and in each phase's CONTEXT.md):** "let's then move 228 & 230 to the next milestone and after 252 close the current one and start the next one". Phases 228 and 230 moved to v1.23 HARDEN, with CONN-02, CONN-04, MT5D-02 and MT5D-03. Their requirement text stays under its v1.22 headings below; the traceability table maps them to v1.23.

**Carried with Phase 155.2 and still binding (verbatim from `milestones/v1.18-REQUIREMENTS.md`):**

**Accounts in scope (founder 2026-11-13):** MM2, MM3, FX-AI_V. Labels only; no login, server or amount appears in this public repo.

- D-A **Pre-mark history: "Accept, judge closed P&L".** Days before a key's first stored NAV mark `S` are realized (closed-balance) basis by design (NAVMTM D-09, no backfill). They are judged against the terminal's closed-trade balance history (Gate A). The open-P&L-included 1% applies to days from `S` on (Gate B). The harness measures and reports the gap; it never invents marks.
- D-B **The 1% is "return gap, in points":** `|ΔE_ours − ΔE_oracle| / E(window start)`, checked separately for cumulative return, start level and end level, held in ONE named constant `MT5_PARITY_TOLERANCE = 0.01`.
- D-C **Statements: the founder gets broker statements** for these accounts and provides them in the session. They are the historical-equity oracle (month-end and/or daily).
- D-D **Clock read: "Allow narrow read".** One named, tick-time-only `Mt5Client` method is admitted; the forbidden list in the contract test stays, and the exception is pinned by a test (precedent `terminal_info`, 153.3/D-31).
- D-E **Weekend reading: "Yes, this weekend".** The founder reads frozen terminal Balance/Equity for each account on Sat 2026-11-14 or Sun 2026-11-15 (the Friday 2026-11-13 close), as one Gate B edge.
  - ⛔ **AMENDED 2026-11-22 (founder ruling, "Accept 11-20 as the edge"):** the D-E edge is the Fri 2026-11-20 frozen close, read from the terminal on Sun 2026-11-22 for MM2, MM3 and FX-AI_V. For this edge only, the Gate B window runs to 2026-11-20, past the 2026-11-19 run day. The 11-13 close is read from the daily statement instead. The text above is kept as lineage.
- Settled 2026-08-14 and unchanged: the measurement window ends before the run day.

Rulings still open are marked **(founder ruling at plan time)** on the requirement they touch. Each such requirement is written so it can be met either way. None is answered here.

## v1.22 Requirements

### Milestone-wide

- [ ] **PROOF-01**: Every gate a v1.22 requirement relies on is proven able to fail. It goes RED on pre-fix code, or on a neutered copy, with the expected named arm as the first failure. The file is then restored from a byte backup (`cp` back, `cmp` against the backup; never `git checkout`, `restore` or `stash`) and goes GREEN again. The neuter edit, the command, the RED line and the GREEN line are recorded verbatim in the plan SUMMARY. A new SQL gate arm also carries `RED-UNDER:` / `RED-UNDER-M:` twins and lists its migration in `RED-UNDER-SETUP`. A loosened tolerance, re-pinned values, a new skip or ledger line, an edit to an applied migration, a mutation waiver or drift made blocking is never a close. This requirement belongs to no single phase: it is a success criterion of every v1.22 phase and is closed at the milestone audit. By F-10 it is also a success criterion of every v1.23 phase, and is closed again at that milestone's audit.

### Carried: MT5 verification (Phase 155.2, verbatim from `milestones/v1.18-REQUIREMENTS.md`)

⭐ **Moved to v1.23 HARDEN, 2026-11-25** (founder ruling in chat: "We will Move 157 and 155.2 into the next milestone"). The six requirements below keep their ids and text, and are mapped to v1.23 in the traceability table. The text stays here so that its citations keep resolving.

- [ ] **MT5-07**: Rendered performance matches an external oracle within `MT5_PARITY_TOLERANCE` as defined in D-B: Gate A (pre-`S`, closed-trade balance basis) against the terminal's All-History export, and Gate B (from `S`, open P&L included) against broker statements and the weekend reading (D-C, D-E), over windows that end before the run day.
- [ ] **MT5-08**: The verification runs against the live funded accounts MM2, MM3 and FX-AI_V, with the founder at the terminal on a trading day; a demo, the v1.15 soak account or a weekend-only run does not satisfy it (the weekend reading is an edge input, not the run).
- [ ] **MT5-09**: Every surface that renders strategy performance shows the same, correct MT5 numbers for these accounts. ⚠️ Re-mapped 2026-11-13: the portfolio PDF (retired in Phase 195 TRIM) and `scenario-blend-panels.ts` (deleted) are dropped; the current surface list is fixed at discuss-phase, cited by symbol.
- [ ] **MT5-10**: Every surfaced discrepancy is fixed within the milestone at its root, wherever it lives, including shared backbone money-math (uncapped, founder decision 2026-08-14); a difference passes only if within tolerance, consistently withheld on every surface, or in a named bucket with a recorded founder ruling.
- [ ] **MT5-15**: The `complete_with_warnings` / data-quality flags carried by these accounts are read from stored data and each is eliminated, or understood and accepted in writing.
- [ ] **MT5-GOAL-01** *(umbrella acceptance, no implementation of its own)*: An MT5 strategy is usable end-to-end by the allocator who uploaded it (ingests, projects in a scenario, factsheet viewable), confirmed live by the founder.

### Carried: founder confirmations (Phase 157, verbatim from `milestones/v1.18-REQUIREMENTS.md`)

⭐ **Moved to v1.23 HARDEN, 2026-11-25** (founder ruling in chat: "We will Move 157 and 155.2 into the next milestone"). The four requirements below keep their ids and text, and are mapped to v1.23 in the traceability table. The text stays here so that its citations keep resolving.

- [ ] **FCONF-01**: The founder confirms the 2026-08-04 wizard restart is gone: with a live draft, `+ Strategy` shows the resume banner and Resume lands on the draft's step.
- [ ] **FCONF-02**: The founder sees the amber `wizard-sync-recomputing` block render as specified (heading, no red envelope, no metric numbers).
- [ ] **FCONF-03**: The founder sees the four 153.7 copy members render in a real wizard, with NO Retry control on `SEAM_INTERNAL_FAULT`.
- [ ] **FCONF-04**: `MT5_SPIKE_INVESTOR_PASSWORD` is rotated after the session's live reads, and gate 1 (all three keys sync `complete`) is re-checked afterwards.

### Data integrity: MT5 derives (MT5DERIVE2)

⭐ **MT5D-02 and MT5D-03 moved to v1.23 HARDEN with Phase 230, 2026-11-27** (founder ruling in chat: "let's then move 228 & 230 to the next milestone and after 252 close the current one and start the next one"). They keep their ids and text here, so that their citations keep resolving, and are mapped to v1.23 in the traceability table.

- [x] **MT5D-01**: Every failed attempt of a compute job leaves an append-only record of its cause, written before the re-claim clears `last_error`. The record tells a stall or watchdog reset apart from a real error, and stays readable after a later attempt succeeds. The deliberate `last_error` clear on re-claim stays. (covers: 175-NIGHTLY-MT5-DERIVE-CHECK)
- [ ] **MT5D-02**: Once that record has collected real nightly runs, the named cause of MT5 `derive_broker_dailies` second attempts is fixed at its root, so that over seven consecutive nights every MT5 derive ends `done` with `attempts=1`. Raising retries or a watchdog threshold is not a close. (covers: 175-NIGHTLY-MT5-DERIVE-CHECK)
- [ ] **MT5D-03**: The MT5 derive values that moved without explanation are replayed under both server-clock settings, and each moved value is attributed to the clock switch or to another named cause. (covers: 202-MT5-CLOCK-LEAD-01)
- [x] **MT5D-04**: A timed re-funding day with an empty cohort 0 keeps the return chain intact instead of being dropped by a guard. (covers: 164.6.6.2.3-EMPTY-COHORT0-REFUND)
- [x] **MT5D-05**: An inception day's P&L is booked, or flagged by name. It is never dropped as NaN without a flag. (covers: 164.6.6.2.3-INCEPTION-DAY0-PNL)
- [x] **MT5D-06**: A day-level flow just under the previous day's NAV either carries the large-flow annotation, or the band is recorded as accepted (founder ruling at plan time on the D-15 band). `FLOW_TIMING_LARGE_RATIO` is never widened to make a check pass. (covers: 164.6.6.2.3-D15-THRESHOLD-BAND)
- [x] **MT5D-07**: A timed MT5 key with no writer basis is counted or blocked with a named signal. It never composes silently on the legacy roll. (covers: 164.6.6.2.3-MT5-BASIS-SILENT-NONE)
- [x] **MT5D-08**: An MT5 key whose sign-in keeps failing cannot claim an account's holder slot. (covers: 167.1.2-MT5-FAILING-HOLDER)

### Data integrity: venue reads (BYBITREADS, OKXTRADES)

- [x] **VREAD-01**: The Bybit derive anchor sums the same set of stable coins as the current-equity read, through one shared coin-set constant. (covers: 167.2.1.1-DERIVE-USDT-ONLY-ANCHOR)
- [x] **VREAD-02**: The Bybit holdings poll includes USDC-settled and inverse positions and their uPnL, not only USDT-linear ones. (covers: 167.2.1.1-BYBIT-POSITIONS-USDT-LINEAR-ONLY)
- [x] **VREAD-03**: A Bybit strategy trade sync whose start is older than seven days returns every execution in the requested window, or refuses by name. (covers: 167.2.1.1.2.1-STRATEGY-BYBIT-7DAY)
- [x] **VREAD-04**: A Bybit on-chain deposit is counted exactly once. Replace or union is decided on probe evidence, and recorded as undecided if the probe cannot tell the two apart. (covers: 186-BYBIT-ONCHAIN-DEPOSIT-UNVERIFIED)
- [x] **VREAD-05**: The Bybit owner's static egress IP is allow-listed (a founder action, recorded with its date), and that key's daily derive no longer errors for that reason. (covers: 167.1.2.2-BYBIT-STATIC-EGRESS)
- [x] **VREAD-06**: An OKX daily P&L bill in a currency other than USDT is converted at a stated rate or refused by name. It is never summed at face value. (covers: 167.1.2.2.2.1-OKX-DAILY-PNL-MIXED-CCY)
- [x] **VREAD-07**: An OKX first window longer than the page cap completes across ticks instead of truncating every day. Raising `OKX_BILLS_PAGE_CAP` is not a close. If an earlier phase already closed this, the closing evidence is recorded instead. (covers: 167.1.2.2.2-OKX-PERSISTENT-TRUNCATION)
- [x] **VREAD-08**: `api_keys.last_fetched_trade_timestamp` never reads ahead of the newest stored trade, and a key found ahead has its skipped days re-read. (covers: 167.1.2.2.2-LAST-FETCHED-TRADE-TS-AHEAD)

### Data integrity: Deribit book and freshness (DERIBITBOOK, Deribit stale returns)

- [x] **DBOOK-01**: Every day of the founder's Deribit book cumulative return is either explained by booked P&L and flows, or withheld by name. No plausibility bound is applied. (covers: 185-BOOK-CUMULATIVE-UNEXPLAINED)
- [x] **DBOOK-02**: A Deribit correction row carrying a capital reason never classifies as trading P&L, including one that carries a trading token and no capital word. Each correction shape has its own fixture. (covers: L2219)
- [x] **FRESH-01**: The Deribit account whose stored returns end 2026-10-26, while its inputs carry a 2026-11-09 flow and its derives report `done`, is diagnosed read-only and fixed at its root. Its return series then reaches its newest flow and anchor day, or the gap carries a stored, named reason. Missing days are never backfilled. (covers: debug-sweep observation 2026-11-23; no `TODOS.md` id)
- [x] **FRESH-02**: For every venue, a check that runs outside the derive job compares each daily-derived key's newest stored return day with its newest flow day and anchor day. It reports any key behind by more than a stated bound without a named reason. The check reports and pages; it never blocks CI. (covers: debug-sweep observation 2026-11-23; no `TODOS.md` id)

### Data integrity: one account counts once on read (HOLDINGSTRUTH)

- [x] **HOLD-01**: A Holdings row whose key is missing from the identity read fails loud. It never counts as an account of its own. (covers: 170.4-IDENTITY-READ-COMPLETENESS)
- [x] **HOLD-02**: Match scoring applies the native-unpriced marker per account, so for a multi-key account match AUM and unpriced days equal what Holdings reports. (covers: 170.4-MATCH-UNPRICED-PER-KEY)
- [x] **HOLD-03**: The writer-basis gate compares per-day values as well as the calendar, and refuses a same-day re-derive pair whose P&L does not match. (covers: 167.1.2.2.1-WRITER-BASIS-VALUES) ⭐ NOTE 2026-11-24 (planning, recorded in 229-CONTEXT.md): the per-day comparison is a compose-side `returns_stamp` (each derive stores the per-day returns it wrote in its `key_inputs` row; the compose compares it per raw key before the stitch and refuses a differing pair as the blocking `key_inputs_mismatch`). `read_writer_basis` stays byte-unchanged, because editing it fires the open entry `167.1.2.2.1-WRITER-BASIS-EMPTY-READS-LEGACY` and a post-stitch check reads the stitched series. Known limit: a correction confined to a day with no stored return that moves no other return leaves the pair content-consistent and is not refused; a row written before this change carries no stamp and is counted, not refused.
- [x] **HOLD-04**: When the dashboard's unpriced-marker read fails, the page shows a note and a Sentry event fires. Stale rows are never shown silently. (covers: 170.4-DASHBOARD-MARKER-READ-SILENT)
- [x] **HOLD-05**: Every failing key of a shared account is named in the missing-data message, even when another key with the same cause already prints a line. (covers: 198-SHARED-ACCOUNT-FALLBACK-UNNAMED)

### Data integrity: no-capital keys (NOCAPITAL)

- [x] **NOCAP-01**: An MT5 key whose stored terminal reads zero for one tick is never dropped as no-capital while it is funded. (covers: 166.3.1-NOCAP-MT5-A2-CIRCULAR)
- [x] **NOCAP-02**: Any exception raised by a no-capital candidate, not only `NavReconstructionError`, leaves the previous row intact. The row never goes stale across retries. (covers: 166.3.1-NOCAP-NONNAV-EXCEPTIONS)
- [x] **NOCAP-03**: A fallback to `dropped_key` stores a payload flag naming why, and is counted per run. A log line alone is not enough. (covers: 166.3.1-NOCAP-FALLBACK-TRACE)
- [x] **NOCAP-04**: A refused candidate leaves no residue reason (such as `key_inputs_mismatch`) in the stored payload. (covers: 166.3.1-NOCAP-SEGMENT-REASON-RESIDUE)

### Data integrity: no stranded strategy (JOBHEAL)

- [x] **HEAL-01**: A finalize-wizard strategy whose first `sync_trades` enqueue dropped is re-enqueued, or shown in a named state. This uses its own mechanism, not a second predicate on the reconcile sweep. (covers: L4282)
- [x] **HEAL-02**: A `derive_allocator_equity` job queued behind slow batch-mates is never reset and run twice. (covers: 166.5.1-DERIVE-BATCH-RESET-RESIDUAL)
- [x] **HEAL-03**: A strategy whose reconcile readmit hits its ceiling emits a readable signal. Whether that is an audit row or an external alert is a founder ruling at plan time. (covers: L2244)
- [x] **HEAL-04**: A job reclaimed after a crash keeps its curated error sentence, and the strategy's analytics status follows the reclaim. (covers: 164.2-RECLAIM-PROVENANCE)
- [x] **HEAL-05**: The daily positions poll also covers private strategies, so they get position snapshots. The `poll_positions` enqueue stays live (F-8). (covers: FANOUT-COHORT-SIBLING-POLL-01)

### Data integrity: one figure convention (FIGUREMATH)

- [x] **FIG-01**: Every engine that annualizes (the stored Python metrics, the factsheet and Scenario TypeScript engines, portfolio analytics and matching) follows F-5. Each language holds the convention in one named constant set, and a cross-language pin test fails if any engine's year length or ddof changes. (covers: 194-ENGINE-CONSTANTS, L2214)
- [x] **FIG-02**: For the same strategy and period, every engine reports the same CAGR, Sharpe and TWR within a pinned tolerance, proven by a parity test across all engines. The composite half of `L2214` is out (F-2). (covers: L2214)
- [x] **FIG-03**: CVaR is historical and reads null below a minimum observation count held in one named constant (the count is set at plan time). quantstats moves to 0.0.86 in the same PR as a per-metric decision record. Re-pinning moved values without a decision is not a close. (covers: QUANTSTATS-0086-REDERIVE-01)
- [x] **FIG-04**: CAGR uses one span rule in every engine, pinned by a test. Whether emptied stretches count toward the span is a founder ruling at plan time. (covers: 167.1.2.2.1-CAGR-EMPTY-SPAN)
- [x] **FIG-05**: Figures moved by FIG-01..04 are re-derived for the whole fleet. The frozen spine is re-baselined as a reviewed act (never by re-running `regen_golden.py` in a constants PR), and the CHANGELOG entry names the figures that moved. (covers: 194-ENGINE-CONSTANTS, QUANTSTATS-0086-REDERIVE-01)

### User-facing: honest factsheets (FACTSHEETHONEST)

- [x] **FACT-01**: A withheld factsheet prints no whole-record reading beside rail figures that read as dashes. The three deferred D6 items are a founder ruling at plan time. (covers: 164.6.6.3.3-WITHHELD-RESIDUE)
- [x] **FACT-02**: During a re-run, every surface that shows a strategy's figures (share card, tear sheet, PDFs, returns API, recommendations, portfolios, composer) shows the same state as the factsheet: it stays published, with a quiet Updating line (Phase 190). A census test lists every reader of the recompute verdict. (covers: 190-RERUN-SURFACES-NOT-HOLDING)
- [ ] **FACT-03**: A never-computed analytics row never reads "Analytics last computed", and freshness checks never take its insert time as a compute time. Whether this uses a nullable `computed_at` (which reverses CONTEXT R-04) or a separate marker is a founder ruling at plan time. (covers: 166.5-COMPUTED-AT-NEVER-COMPUTED-DEFAULT)
- [x] **FACT-04**: The owner's private factsheet shows the data source of their own key-backed strategy, never "Data source —". (covers: 164.6.6.2.1-OWNER-TRUST-TIER-UNPUBLISHED)
- [ ] **FACT-05**: For a failed, stalled or never-started row, the /strategies note never tells the owner to wait. (covers: 170.1-STRATEGIES-NOTE-WAIT-WORDING)

### User-facing: cached state matches the truth (SURFACECACHE)

- [x] **CACHE-01**: A strategy published after its OG card was first requested shows its real card on the next request. A not-found card is never long-cached. (covers: 170.3-OG-NOTFOUND-CACHE)
- [x] **CACHE-02**: The composer stores its selected range as dates, so a 12M preset always ends on the latest day and keeps the same dates when the series grows at the front. (covers: 201.1-COMPOSER-RANGE-AS-DATES)
- [x] **CACHE-03**: A failed BTC price read is never cached as a normal payload. The next view retries it, so the USD toggle is not disabled for the cache lifetime. (covers: 164.6.6.2.1-USDVIEW-READFAIL-CACHED)
- [x] **CACHE-04**: Discovery never ranks a BTC-unit return beside USD returns as if the two were comparable. (covers: 164.6.6.2.1-DISCOVERY-RANKING-HONESTY)
  ⛔ CORRECTED 2026-11-24 (founder ruling, Phase 239 CONTEXT): BTC-unit and USD returns are ranked together as pure performance, with no BTC price conversion; the "in BTC" chip stays. The line above is kept as lineage.

### User-facing: honest connect answers (CONNECTTRUTH)

⭐ **CONN-02 and CONN-04 moved to v1.23 HARDEN with Phase 228, 2026-11-27** (founder ruling in chat: "let's then move 228 & 230 to the next milestone and after 252 close the current one and start the next one"). They keep their ids and text here, so that their citations keep resolving, and are mapped to v1.23 in the traceability table.

- [x] **CONN-01**: Connecting a key that matches the user's own draft never answers a silent `200 deduped`. The answer names what was stored. (covers: 167.1.2-DRAFT-CLASH-SAYS-SO)
- [ ] **CONN-02**: Reconnecting an MT5 account with a rotated or mistyped password gets a named answer that matches what was stored. Validating and storing the new password, or refusing by name, is a founder ruling at plan time. (covers: L4097)
- [x] **CONN-03**: MT5 account identity includes the broker server, so the same login on two servers never collides. The backfill uses no data-reading `DO` guard. (covers: L4105)
- [ ] **CONN-04**: `KEY_ORPHANED` copy tells an allocator-role owner which key to Disconnect. The archived-composite case is out (F-2). (covers: 167.1.2-ORPHAN-COPY-FIX)
- [x] **CONN-05**: Every validate-key 400 body carries the same machine-readable code field on every venue. The entry's other two findings (permanence plumbing with one consumer, coordinate drift) are fixed or recorded with a reason. (covers: L2510)
- [x] **CONN-06**: A month-name date cell in a numeric-date CSV column is either parsed or rejected with a message naming the cell and the expected format (founder ruling at plan time). (covers: 170.1-CSV-ODD-SPELLING-REJECTED)

### User-facing: fair anonymous limits (RATELIMITFAIR)

- [x] **RLIM-01**: A few anonymous visitors from different IPs cannot exhaust the shared anonymous verify-strategy bucket, and no limit is keyed on the proxy's IP. A per-IP anonymous tier through the signed claim, or a raised shared tier, is a founder ruling at plan time. (covers: L4491)
- [x] **RLIM-02**: A signed-in user validating a CSV within the edge limit never gets an upstream 429, because the edge limit and the shared `/process-key` tenant tier agree. The limiter's docblock cites the current upstream cap. (covers: L4501) ⛔ CORRECTED 2026-11-24 (founder ruling, Phase 240 CONTEXT): agreement is met by a CSV-scoped per-tenant `/process-key` tier (60/minute, exempt from the 500/hour ceiling), not by retuning the shared tenant tier, which stays 100/hour.

### Security: demo credentials (SECRETSHYGIENE; in v1.22 by founder exception, F-10)

- [x] **SECR-01**: The two demo accounts no longer exist on TEST or PROD, and the deletion is recorded with its date (F-3). (covers: 158-OPS-03, HIGH entry)
  ⛔ **CORRECTED 2026-11-24 (founder ruling, Phase 241 CONTEXT and ROADMAP):** narrowed. The seed allocator account is deleted on TEST and PROD. The shared e2e login stays, because it is in active PROD use, and the founder resets its password so the leaked credential is dead. The sentence above is kept as lineage.
- [x] **SECR-02**: No tracked file contains either demo password literal. The absence guard checks a digest instead of the literal and is shown RED by planting a matching literal. Removing the text alone does not close the entry, and history is not rewritten. (covers: 158-OPS-03, HIGH entry)

### CI and tooling: MT5 soak (MT5SOAK)

- [x] **SOAK-01**: The soak judges a BTC-unit account on floors in its own unit, not on USD floors. (covers: 164.6.6.2.3-SOAK-BTC-FLOORS)
- [x] **SOAK-02**: The soak's timed-day check rejects NaN and implausible returns, not only infinity, and goes RED on a 1e-3 nudge to a timed day. (covers: 164.6.6.2.3-SOAK-TIMED-DAYS-UNCHECKED)
- [x] **SOAK-03**: The soak checks day attribution against an independent per-day walk that imports no production helper, and goes RED when one deal is moved by one UTC day. (covers: 164.6.6.2.3-SOAK-DAY-ATTRIBUTION)

### Carried phase 222 ALERTTRUTH

- [x] **ERRC-01**: No user-readable string in `analytics-service` or in the `computation_error_copy` arms says "contact support". Each names the contact form or a remedy that works, and csv-finalize's copy is in byte parity with the SQL arm, checked by reading the SQL arm. (covers: 212-CONTACT-SUPPORT-SURVIVORS)
- [x] **ERRC-02**: A total benchmark source failure shows wording distinct from a stale benchmark. (covers: 166.4.1-BENCHMARK-OUTAGE-LABEL)
- [x] **ERRC-03**: A failed follow-on analytics enqueue in `run_sync_trades_job` never leaves the strategy reading `complete` with no analytics. The exact behaviour is a founder ruling at plan time. (covers: SYNCTRADES-ENQUEUE-DONE)

### Carried phase 223 FLOWKINDS (flow-source half only, F-2)

- [x] **FLOWK-02**: `run_sync_funding_job` and `okx_archive_job` each have a recorded, test-pinned decision to refuse a malformed funding row by name or to keep dropping it. The decision is taken with the founder wherever a published number changes. (covers: 186-OTHER-FUNDING-CALLERS-DROP, non-composite callers)
- [x] **FLOWK-03**: The per-key count of `daily_pnl_malformed_<venue>` flags on PROD is recorded read-only, and the founder's ruling on refusing a malformed realized row is recorded before any such refusal is switched on. (covers: 186-REALIZED-MALFORMED-COUNT)

### Carried phase 225 ONEACCOUNTONCE

- [x] **ONCE-01**: Connecting a key, or saving a draft, whose account identity matches a key the same owner already holds is refused with a named reason, in the wizard and in the API, for both an exchange key and an MT5 login. (covers: none by id; founder decision 2026-11-23)
- [x] **ONCE-02**: The same account connected by two different users stays allowed and keeps its share link, and a strategy-linked key that also sits in an allocator book is unaffected. (covers: none by id; founder decision 2026-11-23)
- [x] **ONCE-03**: Every same-owner duplicate already stored on PROD is counted read-only and brought to the founder, and once the phase ships no strategy publishes another key's numbers under its own name. (covers: none by id; founder decision 2026-11-23)
- [x] **ONCE-04**: Two keys that share a login always carry a share link. (covers: none by id; founder decision 2026-11-23)

## Planned for v1.23 HARDEN — security, alerting, tooling

Moved out of v1.22 by founder ruling F-10 (2026-11-23, "Yes, split into two milestones"). Every requirement keeps its id and text. They are mapped to the v1.23 phases in ROADMAP's v1.23 section, and are re-read when v1.23 starts.

### Security: secrets hygiene (SECRETSHYGIENE)

- [x] **SECR-03**: A full-history secret scan runs on a schedule. How historical findings are suppressed (commit-scoped fingerprints, or literals made obviously fake), and whether a red scheduled scan may block a redeploy, are decided at plan time. (covers: SECRETSCAN-FULLHISTORY-01)
- [x] **SECR-04**: `cron_sync_tick` and `ops_staleness_check` post the service key only to exact named hosts, never through a `.up.railway.app` suffix wildcard. The entry's gate-arm and tab-key guard gaps are closed. (covers: 167.1.2.2.2-CRON-TICK-RESIDUALS)

### Security: database access (DBACCESS)

- [x] **DBACC-01**: An anonymous request reads only the named metric keys a factsheet needs, never the whole `metrics_json_by_basis` column. (covers: RANK-SPLAT-01)
- [x] **DBACC-02**: A database-level backstop refuses an `api_keys` write whose `user_id` is not the caller's, including an insert through the admin client. The design gets architecture sign-off at plan time, and `FORCE RLS` on `api_keys` is not the mechanism. (covers: L2267)
- [x] **DBACC-03**: A client role holding UPDATE or DELETE cannot keep a table-wide lock past a set timeout. The timeout mechanism is first proven on TEST to be honoured through PostgREST. (covers: TRIGGERREVOKE-LOCKHOLD-01)
- [x] **DBACC-04**: An owner-surface read that lacks `api_key_id` fails to compile. (covers: 170.6.1.1-API-KEY-ID-OPTIONAL-OWNER-GUARD) ⭐ Founder decision 2026-11-27 ("Accept as narrowed"): met as narrowed — the compile guard (a public row cannot pass as `Strategy`) plus the blocking CI source-scan pin over cast-typed owner selects and its cast-site census; owner reads typed by casts are not compiler-checked. The shared StrategyTable/StrategyGrid optional-key remainder stays on TODOS `170.6.1.1-API-KEY-ID-OPTIONAL-OWNER-GUARD`.
- [x] **DBACC-05**: Each of the six routes outside the audit-log law writes an audit row, or carries a recorded founder exemption. The exact-set allowlist only shrinks. (covers: L2120)
- [x] **DBACC-06**: The `discovery-watchlist` RLS and auth assertions run in CI and can fail there. (covers: 158-OPS-03, MEDIUM entry)

### Carried phase 221 SENTRYSCRUB2

- [ ] **SCRB-01**: A direct `Sentry.captureException` of a plain object carrying PostgREST `details` and `hint` produces an envelope with neither, proven by a real-SDK envelope test. (covers: 209-SENTRY-DIRECT-CAPTURE-DETAILS)
- [ ] **SCRB-02**: A `captureToSentry` call in a `"use client"` module produces an event that passes the same scrub as a server event, and no build ships a client `Sentry.init` without that scrub in its `beforeSend`. (covers: 167.2.1-CLIENT-SENTRY-NOOP)
- [ ] **SCRB-03**: The auth callback's GoTrue error branch logs the `error_code` value, sliced short, and never logs `error_description`. (covers: 219-CALLBACK-VERIFY-ERROR-LOG)

### Observability: alert paging and readers (ALERTPAGE, ALERTREADERS)

- [ ] **ALRT-01**: An MT5 outage episode produces exactly one open, one recovered and one close, including when the outage relapses within the hour. A second healthy reading during the held recovery wait sends no duplicate RECOVERED and no false "restarted" wording, and relaunch debt paid outside the heal tick's check still closes the page. Each case is driven by a test on a fake clock across several ticks. (covers: 164.6.8-F4-WR03-DEBT-PAGE-NEVER-ENDS, 164.6.8-R4-SFH-F1-DUPLICATE-RECOVERY)
- [ ] **ALRT-02**: An outage is credited to Sentry only when a notification can actually go out. A capture that returns no event id, or that falls inside the rule's action interval, is not credited, and the alert path signals that it was not. (covers: 164.6.8-F3-SENTRY-HALF-NOOP, 164.6.8-WR-R4-01-SENTRY-CREDIT-INSIDE-RULE-INTERVAL)
- [ ] **ALRT-03**: A Sentry-credited recovery closes the open page within the probe tick's time budget. (covers: 164.6.8-WR-D16-01-PROBE-BOUND-INLINE-CLOSE)
- [ ] **ALRT-04**: Every failure on the paging path, including a failed open-record write and the path's own failure handlers, logs at ERROR level or as a Sentry event, never at WARNING. (covers: 164.6.8-N2-OPEN-RECORD-FAILS-AT-WARNING, 164.6.8-WR05-ALERT-PATH-HANDLERS-AT-WARNING)
- [ ] **ALRT-05**: `ops_staleness_check` reads its own delivery outcome from `net._http_response` and reports a failed delivery. A queued pg_net request is never taken as delivered. (covers: 164.6.8-F5-READER-DELIVERY-UNOBSERVED)
- [ ] **ALRT-06**: The scrub reader reads every row since its last tick, and a second failed scrub with the same cause within an hour is paged, never marked paged and dropped. (covers: 164.6.8-F6-SCRUB-READER-NEWEST-ONLY, 164.6.8-N3-SCRUB-SECOND-FAILURE-SUPPRESSED)
- [ ] **ALRT-07**: One key failing two syncs in a row does not page every hour. Paging happens at account or cohort level, followed by one recovered notice. (covers: 164.6.8-WR06-CRON-SYNC-ERRORS-PAGE-ON-PER-KEY-FAULTS)
- [ ] **ALRT-08**: A failed match-engine cron run produces a readable signal outside the cron itself. Whether a tick that processes nothing counts as a failure is a founder ruling at plan time. (covers: L2255)

### Observability: held Sentry captures (SENTRYHELD)

- [ ] **HELD-01**: A failing anonymous read produces exactly one tagged Sentry event that arrives, because the capture is held before the throw. (covers: 170.6.1.1-FAILANONREAD-CAPTURE-HELD)
- [ ] **HELD-02**: A landing page view with failing social-proof stats produces at most one Sentry event per throttle window. (covers: 170.6.1.1-LANDING-CAPTURE-THROTTLE)

### CI and tooling: SQL gates (SQLGATES2)

- [ ] **SQLG-01**: The anon strategies-projection census derives every axis from its source of truth (the route list from `PUBLIC_ROUTES`), so adding a public route without the census fails CI by name. (covers: 170.6.1.1-CENSUS-STALE-AXES)
- [ ] **SQLG-02**: Every hidden-column exemption in the anon grants gate is asserted to be denied to anon. (covers: 170.6.1.1-GATE-HIDDEN-EXEMPTIONS-UNENFORCED)
- [ ] **SQLG-03**: The trade-fetch provenance gate carries `RED-UNDER` twins, a CHECK-definition check, a rollback backup, and read and write denial arms. (covers: 167.1.2.2.2-PROVENANCE-GATE-RESIDUALS)
- [ ] **SQLG-04**: `apply-test` tells a seeded ledger row apart from an applied migration without loosening its refusal, and its documented remedy never sends a migration to PROD without crossing TEST. (covers: 164.8-APPLYTEST-CANNOT-TELL-SEEDED-FROM-APPLIED)
- [ ] **SQLG-05**: The contradictory VAC-04 acknowledgement blocks and the inverted check-6 note in applied migration `20260907130000` are corrected forward, after the CLI plan reading and after SQLG-04. The applied file is never edited. (covers: 164.7-MIGRATION-COMMENT-DRIFT)

### CI and tooling: test lanes (TESTLANES)

- [ ] **LANE-01**: The live-DB execution ledger reads `ENTRY_COUNT = 0` with no assertion weakened. The wizard RPC role-gate failure (42501) is resolved by a migration or by an invariant (founder ruling at plan time). (covers: 164.9-LIVEDB-LANE-EXECUTION-CENSUS)
- [ ] **LANE-02**: A sustained read timeout on a fence RPC fails the test, never skips it green, and `rpc` is not put back on the retried side. (covers: 164.9-RPC-RETRY-NARROWED-SKIP-REOPENED)
- [ ] **LANE-03**: The lint gate reports the same warnings with a cold cache and a warm one. (covers: LINT-CACHE-MASKS-WARNINGS)
- [ ] **LANE-04**: Whether PROD's Postgres image crashes a backend on a function EXECUTE denial after `SET ROLE` is measured on that image version locally, never against PROD. The verdict is recorded, and if it crashes, the exposure is fixed. (covers: 164.4.2-PROD-SUPAUTILS-FUNCTION-DENIAL-CRASH)

### Carried phase 224 DEADLEFTOVERS

- [ ] **DEAD-01**: `get_admin_compute_jobs` no longer exists on TEST or PROD, and no caller, test or census names it. (covers: 169-DEAD-ADMIN-JOBS-RPC)
- [ ] **DEAD-02**: The retired `compute_analytics` family's daily enqueue and its `compute_job_kinds` rows are removed only after a read-only PROD count of jobs created per day for those kinds (the measurement behind F-8) shows none, and no queued row of those kinds can still exist. The `poll_positions` enqueue stays (F-8). (covers: L2925, the `compute_analytics` half)
- [ ] **DEAD-03**: `managerSideKeyIds`, `excludedManagerSide` and the `"legacy"` `equityCurveSource` value are deleted together with their tests. (covers: 176-INERT-LEFTOVERS)
- [ ] **DEAD-04**: Every reconstruct cap, marker and orphaned crawl item is removed or given a live caller, and `test_the_d04_inert_helpers_stay` is retired or rewritten to match. (covers: 176-RECONSTRUCT-CAP-MARKER-INERT)
- [ ] **DEAD-05**: `src/lib/database.types.ts` declares no function that the schema lacks, and the way it is kept current (a regeneration step with a freshness gate, or a recorded decision) is written down. (covers: 164.5-STALE-GENERATED-TYPES)

## Future Requirements

Acknowledged, not in the v1.22 roadmap.

- **MTWEDGE-01** *(event-gated: waits on a real -10005 wedge, so it cannot be scheduled)*: When the next real MT5 -10005 account-switch wedge occurs, its captured snapshot names the mechanism before the auto-recycle erases the evidence. The recycle is never disabled to keep evidence. (covers: MT5-SWITCH-WEDGE-CAUSE-01)
- **LATENT-01** *(BINANCEREADY; trigger: the first Binance key is onboarded)*: A Binance futures account's collateral reaches the derive and holdings. Realized P&L, funding and marks read through methods the pinned ccxt has. The cron and the fetcher share one spelling of the income-fallback flag. (covers: 167.2.1.1-BINANCE-FUTURES-WALLET-UNREAD, 187-BINANCEINCOME-NEXT-MILESTONE, 167.1.2.2.2-INCOME-FALLBACK-PRODUCER-PIN)
- **LATENT-02** *(SHAREDDEADKEYS; trigger: a curve carries `shared_account_no_working_key`, or an sFOX key is onboarded)*: A shared account whose keys all fail follows the rule that a dead key affects only itself, not the older D-18 path. (covers: 186-SHARED-ACCOUNT-NO-WORKING-KEY)
- **Per-server clock** (parked MT5SERVERLEARN, carried from v1.18): only if the three MT5 accounts turn out to sit on servers with different DST rules.
- **Timeout findings #8 and #10** (TODOS, 153.5, carried from v1.18): tune from percentile data across several nightlies; booked separately if the data is not in by the milestone close.

## Out of Scope

| Item | Reason |
|------|--------|
| A public "verified" badge or advertising MT5 | MT5 is not advertised until Phase 155.2 passes (carried from v1.18) |
| Using our own gateway read as an MT5 oracle; spreading open P&L back over pre-mark history; widening the 1%; hardcoding a server offset | Carried from v1.18 and binding on 155.2 (D-A, D-B, MT5-06) |
| Composite work of any kind, including `180-BYBIT-LIVE-FLOW-KINDS`, `186-COMPOSITE-MEMBER-READ-GAPS`, the composite member read in `186-OTHER-FUNDING-CALLERS-DROP`, the composite halves of `167.1.2-ORPHAN-COPY-FIX` and `L2214`, the eight composite-only entries the triage dropped, and "MT5 as a composite member" (a v1.18 Future Requirement) | F-2, founder 2026-11-23: "Forget about conposites" |
| `189-OPTIONREPLAY-NEXT-MILESTONE` | F-7, founder 2026-11-23: "Bleiben in todos" |
| `164.8.4-REDACT-NO-POSITIVE-SCAN` | F-7, founder 2026-11-23: "Bleiben in todos" (it also carries a 2026-09-19 "NO PHASE" decision) |
| GLB-1 smoothed-MTM expiry day | F-4: its trigger has not fired |
| Retiring the `poll_positions` enqueue | F-8: measured live on PROD 2026-11-23 |
| BINANCEREADY / SHAREDDEADKEYS | Latent, with no PROD exposure today; see Future Requirements |
| MT5WEDGE | Event-gated; see Future Requirements |
| LOW and INFO `TODOS.md` entries | F-1; they stay in `TODOS.md` |
| `TODOS.md` entries marked ACCEPTED (founder-accepted limits, nine of them MEDIUM) | Not open; they stay as accepted limits unless the founder reopens one |
| Deleting the FIXED, STALE and composite-only `TODOS.md` entries | Records work, not a requirement |
| Rewriting git history to remove the demo credentials | Cannot reach clones or caches; declined under SEC-02 (2026-08-26) |
| New runtime packages, `sentry-sdk` 3.x, `use cache` / Cache Components | Research: no group needs them, and `sentry-sdk` 3.0 removes a hook the redaction depends on |

## Traceability

The roadmapper fills the empty Phase cells. Status cells stay a bare `Pending`, because `phase complete` flips only an exact `Pending`, `In Progress` or `Gaps Found`.

| Requirement | Phase | Status |
|-------------|-------|--------|
| MT5-07 | Phase 155.2 (v1.23) | Pending |
| MT5-08 | Phase 155.2 (v1.23) | Pending |
| MT5-09 | Phase 155.2 (v1.23) | Pending |
| MT5-10 | Phase 155.2 (v1.23) | Pending |
| MT5-15 | Phase 155.2 (v1.23) | Pending |
| MT5-GOAL-01 | Phase 155.2 (v1.23) | Pending |
| FCONF-01 | Phase 157 (v1.23) | Pending |
| FCONF-02 | Phase 157 (v1.23) | Pending |
| FCONF-03 | Phase 157 (v1.23) | Pending |
| FCONF-04 | Phase 157 (v1.23) | Pending |
| SCRB-01 | Phase 221 (v1.23) | Pending |
| SCRB-02 | Phase 221 (v1.23) | Pending |
| SCRB-03 | Phase 221 (v1.23) | Pending |
| ERRC-01 | Phase 222 | Complete |
| ERRC-02 | Phase 222 | Complete |
| ERRC-03 | Phase 222 | Complete |
| FLOWK-02 | Phase 223 | Complete |
| FLOWK-03 | Phase 223 | Complete |
| DEAD-01 | Phase 224 (v1.23) | Pending |
| DEAD-02 | Phase 224 (v1.23) | Pending |
| DEAD-03 | Phase 224 (v1.23) | Pending |
| DEAD-04 | Phase 224 (v1.23) | Pending |
| DEAD-05 | Phase 224 (v1.23) | Pending |
| ONCE-01 | Phase 225 | Complete |
| ONCE-02 | Phase 225 | Complete |
| ONCE-03 | Phase 225 | Complete |
| ONCE-04 | Phase 225 | Complete |
| PROOF-01 | Every v1.22 phase, and every v1.23 phase by F-10 (closed at each milestone audit) | Pending |
| MT5D-01 | Phase 227 | Complete |
| MT5D-02 | Phase 230 (v1.23) | Shipped (#1358); seven clean nights pending |
| MT5D-03 | Phase 230 (v1.23) | Shipped (#1358, replay tooling); coordinator capture and replay pending |
| MT5D-04 | Phase 229 | Complete |
| MT5D-05 | Phase 229 | Complete |
| MT5D-06 | Phase 229 | Complete |
| MT5D-07 | Phase 229 | Complete |
| MT5D-08 | Phase 225 | Complete |
| VREAD-01 | Phase 231 | Complete |
| VREAD-02 | Phase 231 | Complete |
| VREAD-03 | Phase 231 | Complete |
| VREAD-04 | Phase 231 | Complete |
| VREAD-05 | Phase 231 | Complete |
| VREAD-06 | Phase 232 | Complete |
| VREAD-07 | Phase 232 | Complete |
| VREAD-08 | Phase 232 | Complete |
| DBOOK-01 | Phase 233 | Complete |
| DBOOK-02 | Phase 233 | Complete |
| FRESH-01 | Phase 233 | Complete |
| FRESH-02 | Phase 233 | Complete |
| HOLD-01 | Phase 235 | Complete |
| HOLD-02 | Phase 235 | Complete |
| HOLD-03 | Phase 229 | Complete |
| HOLD-04 | Phase 235 | Complete |
| HOLD-05 | Phase 235 | Complete |
| NOCAP-01 | Phase 234 | Complete |
| NOCAP-02 | Phase 234 | Complete |
| NOCAP-03 | Phase 234 | Complete |
| NOCAP-04 | Phase 234 | Complete |
| HEAL-01 | Phase 227 | Complete |
| HEAL-02 | Phase 227 | Complete |
| HEAL-03 | Phase 227 | Complete |
| HEAL-04 | Phase 227 | Complete |
| HEAL-05 | Phase 227 | Complete |
| FIG-01 | Phase 236 | Complete |
| FIG-02 | Phase 236 | Complete |
| FIG-03 | Phase 236 | Complete |
| FIG-04 | Phase 236 | Complete |
| FIG-05 | Phase 236 | Complete |
| FACT-01 | Phase 237 | Complete |
| FACT-02 | Phase 237 | Complete |
| FACT-03 | Phase 238 | Shipped (#1363), human verification pending |
| FACT-04 | Phase 237 | Complete |
| FACT-05 | Phase 238 | Shipped (#1331), phase verification pending |
| CACHE-01 | Phase 237 | Complete |
| CACHE-02 | Phase 239 | Complete |
| CACHE-03 | Phase 237 | Complete |
| CACHE-04 | Phase 239 | Complete |
| CONN-01 | Phase 225 | Complete |
| CONN-02 | Phase 228 (v1.23) | Pending |
| CONN-03 | Phase 225 | Complete |
| CONN-04 | Phase 228 (v1.23) | Pending |
| CONN-05 | Phase 240 | Complete |
| CONN-06 | Phase 240 | Complete |
| RLIM-01 | Phase 240 | Complete |
| RLIM-02 | Phase 240 | Complete |
| SECR-01 | Phase 241 | Complete |
| SECR-02 | Phase 241 | Complete |
| SECR-03 | Phase 242 (v1.23) | Complete |
| SECR-04 | Phase 242 (v1.23) | Complete |
| DBACC-01 | Phase 243 (v1.23) | Complete |
| DBACC-02 | Phase 243 (v1.23) | Complete |
| DBACC-03 | Phase 243 (v1.23) | Complete |
| DBACC-04 | Phase 244 (v1.23) | Complete |
| DBACC-05 | Phase 244 (v1.23) | Complete |
| DBACC-06 | Phase 244 (v1.23) | Complete |
| ALRT-01 | Phase 245 (v1.23) | Pending |
| ALRT-02 | Phase 245 (v1.23) | Pending |
| ALRT-03 | Phase 245 (v1.23) | Pending |
| ALRT-04 | Phase 245 (v1.23) | Pending |
| ALRT-05 | Phase 246 (v1.23) | Pending |
| ALRT-06 | Phase 246 (v1.23) | Pending |
| ALRT-07 | Phase 246 (v1.23) | Pending |
| ALRT-08 | Phase 246 (v1.23) | Pending |
| HELD-01 | Phase 247 (v1.23) | Pending |
| HELD-02 | Phase 247 (v1.23) | Pending |
| SQLG-01 | Phase 248 (v1.23) | Pending |
| SQLG-02 | Phase 248 (v1.23) | Pending |
| SQLG-03 | Phase 248 (v1.23) | Pending |
| SQLG-04 | Phase 248 (v1.23) | Pending |
| SQLG-05 | Phase 248 (v1.23) | Pending |
| LANE-01 | Phase 249 (v1.23) | Pending |
| LANE-02 | Phase 249 (v1.23) | Pending |
| LANE-03 | Phase 249 (v1.23) | Pending |
| LANE-04 | Phase 249 (v1.23) | Pending |
| SOAK-01 | Phase 226 | Complete |
| SOAK-02 | Phase 226 | Complete |
| SOAK-03 | Phase 226 | Complete |

**Coverage:**
- 116 requirements in all, across two milestones (F-10). FLOWK-01 was dropped by the founder on 2026-11-23 and is not counted.
- **v1.22 TRUTH: 67.** ⭐ 2026-11-27: was 71; CONN-02 and CONN-04 (Phase 228) and MT5D-02 and MT5D-03 (Phase 230) moved to v1.23 with their phases (founder: "let's then move 228 & 230 to the next milestone and after 252 close the current one and start the next one"), so MT5D counts 6 and CONN 4 in v1.22 below, New groups 57, and Mapped 67/67 to 17 phases (222, 223, 225, 226, 227, 229, 231–241). ⭐ 2026-11-25: was 81; the carried 10 (MT5 6 on 155.2, FCONF 4 on 157) moved to v1.23 with their phases (founder: "We will Move 157 and 155.2 into the next milestone"). Phases 222, 223 and 225: 9 (ERRC 3, FLOWK 2, ONCE 4). New groups: 61 (MT5D 8, VREAD 8, DBOOK 2, FRESH 2, HOLD 5, NOCAP 4, HEAL 5, FIG 5, FACT 5, CACHE 4, CONN 6, RLIM 2, SOAK 3, SECR-01/02 2). Milestone-wide: 1 (PROOF-01). Mapped: 71/71, to 19 phases (222, 223, 225, 226–241). Phases 250–252, booked later, own no requirement row.
- **v1.23 HARDEN, planned: 49.** ⭐ 2026-11-27: was 45; Mapped 49/49 to 14 phases (155.2, 157, 221, 224, 228, 230, 242–249). Carried Phases 221 and 224: 8 (SCRB 3, DEAD 5). Moved from v1.22 on 2026-11-25 with Phases 155.2 and 157: 10 (MT5 6, FCONF 4). Moved from v1.22 on 2026-11-27 with Phases 228 and 230: 4 (CONN-02, CONN-04, MT5D-02, MT5D-03). New groups: 27 (SECR-03/04 2, DBACC 6, ALRT 8, HELD 2, SQLG 5, LANE 4). Mapped: 45/45, to 12 phases (155.2, 157, 221, 224, 242–249). PROOF-01 applies there too and is counted once, under v1.22.
- Unmapped: 0. Every requirement maps to exactly one phase, and PROOF-01 is milestone-wide.
- TODOS coverage: every open MEDIUM-and-higher entry in the 2026-11-23 triage (94 open, counting `158-OPS-03`'s HIGH and MEDIUM entries separately), plus the MEDIUM entries already owned by 221–223, maps to a requirement above, to a Future Requirement (MTWEDGE-01, LATENT-01, LATENT-02), or to a recorded exclusion (F-2 composite, F-7). None is unplaced. Basis: the triage's per-entry table, checked by id; `TODOS.md` at HEAD was not re-read. The LOW entries that Phase 224 owns are covered by DEAD-01..05 because the phase owns them by name.

---
*Requirements defined: 2026-11-23*
*Last updated: 2026-11-27, Phases 228 and 230 and their 4 requirements moved to v1.23 by founder ruling (2026-11-25: Phases 155.2 and 157 and their 10 requirements moved to v1.23 by founder ruling; 2026-11-23: roadmap created, traceability filled, and the v1.23 requirements moved under "Planned for v1.23" by F-10)*

# Feature Research

**Domain:** Hardening a quant fund-data platform (allocator/manager marketplace: broker-key derives, factsheets, Holdings, alert paging). Milestone v1.22 TRUTH: "every number, label and alert we show is correct, or it fails loudly."
**Researched:** 2026-11-23
**Confidence:** HIGH for repo claims: paths, symbols and line numbers below were confirmed by grep or read at worktree HEAD `1c361e676` (no code changed since the triage's measured SHA `a73c87b8c`, checked with `git diff --stat`). Where a claim rests on the triage or the TODOS entry without a fresh read, it says "triage reading". LOW for the external practice notes (classify-confidence returns LOW for web search; they are context, never authority). PROD figures quoted below are the triage's or the TODOS entries' own dated readings, **not re-measured** (this research may not query any database).

Scope rule: this milestone adds no features. "Feature" below means an **observable behaviour that has to hold** for a number, label or alert to be trusted. Entry ids come from `TODOS.md` (grep by id) and the triage file; groups and order follow the founder scope input (data integrity, then user-facing, then security, then the rest). Composite work is out everywhere (founder 2026-11-23).

Entry class legend: **DI** data integrity (a stored or published number can be wrong), **UF** user-facing (a label, note or answer a user reads is wrong or missing), **SEC** security, **INT** internal (CI, tooling, observability of our own systems; no user sees it directly).

---

## Feature Landscape

### Table Stakes (cross-cutting: must hold for the numbers to be trustworthy)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| A job that ends `done` produced current data, checked by something other than the job | In fund-data practice a green pipeline run does not prove fresh or complete data; freshness is checked independently (newest data timestamp against now, per dataset), because a check inside a job that never runs never fires (LOW, web) | M | Missing today for derives: `175-NIGHTLY-MT5-DERIVE-CHECK` (retry hides the cause) and the new Deribit stale-returns observation (90 `done` jobs, returns weeks behind). Repo rule already: freshness = `strategy_analytics.computed_at`, never `last_sync_at` |
| A failed attempt's cause survives its successful retry | "Done after retry" can hide a fault the retry healed; auditors and allocators need the first failure readable | S | `claim_compute_jobs_with_priority.sql` sets `last_error = NULL` and `error_kind = NULL` on every re-claim (deliberate, M-1137/M-1138). The fix is a preserved first-attempt record, not undoing that clear |
| Every exchange read covers the whole account (all stable coins, settle types, the full requested window) or refuses by name | Constraint "fail loud, fail alone" (186 D-05): a partial read must never publish as complete | M | BYBITREADS, OKXTRADES; Phase 223 for flow kinds |
| One account counts once across every surface | Double-counting one exchange account inflates AUM and exposure | M | HOLDINGSTRUTH plus Phase 225 |
| One convention per figure across engines, or a labelled and pinned difference | The existing convention constraint (risk by frequency, returns by calendar) only holds if every engine uses the same constants | L | FIGUREMATH; touches frozen `scenario.ts` and `src/lib/factsheet/compute.ts` |
| Uncomputable values are null, never defaulted | No-invented-data invariant (PROJECT.md Constraints) | S to M | `166.5-COMPUTED-AT-NEVER-COMPUTED-DEFAULT` (`src/lib/types.ts:307` `computed_at: string`, column defaults to `now()`) is the clearest live violation |
| A withheld or re-running figure is withheld the same way on every surface | Share card, PDFs, API and composer must not show what the factsheet withholds | M | FACTSHEETHONEST, `190-RERUN-SURFACES-NOT-HOLDING` |
| An alert opens once, recovers once, closes once, and its own failure is loud | Standard incident lifecycle: repeats fold into the open incident by key, a resolve with the same key closes it (LOW, web) | M | ALERTPAGE, ALERTREADERS |
| A leaked credential is disabled at the source | Rotating or revoking comes first; rewriting history cannot reach clones, forks or cached refs (LOW, web: GitHub docs) | S (code), founder action (accounts) | `158-OPS-03` |
| Every gate can be shown RED before it counts | Repo rule (Phase 164.3 VACUITY); the target is the milestone's own goal | Per gate | Applies to every requirement below |

### Differentiators (where "fails loudly" goes beyond the minimum)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| An independent freshness sentinel: newest stored return day compared with newest flow day and newest anchor day, per key | Catches the "done but stale" class for every venue at once, not one bug at a time | M | Generalises the Deribit observation. Can ride on the existing prober (`scripts/prod-prober/cron-manifest.json`) or ops staleness check |
| Per-attempt failure history on compute jobs | Turns "attempts=2, cause unknown" into a readable cause for every kind, not only MT5 | S to M | Serves MT5DERIVE2 and JOBHEAL |
| Absence assertions by hash, not by literal | Lets the `158-OPS-03` guard keep working after the credential literals leave the tree | S | Resolves the conflict between "remove the literals" and the absence-guard test |
| A recorded first-failure reason inside every "kept last good" refusal | Allocator can tell "held because the read refused" from "held because nothing changed" | S | Extends 186 D-05 |
| Engine-parity test over stored, factsheet and Scenario constants | Makes a future constant drift a CI failure instead of a reading | M | FIGUREMATH closure test |

### Anti-Features (deliberately NOT built; each is a way of looking correct while being wrong)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Retry until green | Makes nightly derives read `done` | Hides the first fault and rewrites published dailies with no record of why (`175-NIGHTLY-MT5-DERIVE-CHECK`) | Keep retries, record each attempt's cause, gate on `attempts=1` over a window |
| Silent backfill of missing days or marks | Makes a curve look complete | Violates no-invented-data and D-A (no spreading open P&L back over pre-mark history) | Leave the gap null and name it |
| Defaulting a never-computed timestamp to "now" | Avoids a nullable column | Prints "Analytics last computed" for something never computed | Nullable column, explicit "never computed" state |
| Serving a cached value after the read behind it failed | Keeps the page fast and the toggle visible | Hides a failure for the cache lifetime (`164.6.6.2.1-USDVIEW-READFAIL-CACHED`, `170.3-OG-NOTFOUND-CACHE`) | Failure and not-found responses take the short or no-store cache path |
| Widening a tolerance or threshold until a check passes | Turns a red parity or band check green | Removes the check's meaning (precedent: the debug session's option C "widen the band" was rejected) | Fix at root or record a founder ruling in a named bucket (MT5-10) |
| Rewriting git history to remove the demo credentials | Feels like remediation | Cannot unpublish clones and caches; breaks open PR refs; founder already declined a history rewrite under SEC-02 (2026-08-26) | Delete the accounts, remove literals forward-only, keep guards by hash |
| Deduping a connect silently (`200 deduped:true`, no message) | Avoids an error on a repeat connect | Drops the user's new credential with no word (`167.1.2-DRAFT-CLASH-SAYS-SO`) | Refuse or explain by name (Phase 225 owns the refusal shape) |
| Paging hourly on a single flaky key | Never misses a failure | Trains the reader to ignore pages (`164.6.8-WR06-CRON-SYNC-ERRORS-PAGE-ON-PER-KEY-FAULTS`) | Page on account-level or cohort-level failure; one recovered notice |
| Logging a paging-path failure at WARNING | Avoids noise | The alert path's own failure becomes invisible (`164.6.8-N2`, `164.6.8-WR05`) | Event-level (ERROR or Sentry) for any failure on the alert path |
| Making the verification-drift report or a new freshness check block merges | Feels strict | Repo rule: drift is a report, never a gate | Freshness sentinel pages; it does not block CI |
| Fixing LOW or INFO entries in these phases | Tidiness | Repo rule: LOW/INFO go to the phase REVIEW.md only | MEDIUM and above only |

---

## Per-Group Detail

Each block: table stakes, differentiators, anti-features, complexity (S/M/L), code dependencies (read at HEAD), group dependencies, entry classes, suggested requirement sentence.

### Data integrity

#### MT5DERIVE2 — MT5 nightly derives succeed first time, and day-level flows never drop, inflate or orphan a day
Members: `175-NIGHTLY-MT5-DERIVE-CHECK`, `202-MT5-CLOCK-LEAD-01`, `164.6.6.2.3-EMPTY-COHORT0-REFUND`, `164.6.6.2.3-D15-THRESHOLD-BAND`, `164.6.6.2.3-INCEPTION-DAY0-PNL`, `164.6.6.2.3-MT5-BASIS-SILENT-NONE`, `167.1.2-MT5-FAILING-HOLDER`.
- **Table stakes:** the first attempt's failure cause is readable after a successful retry; a day with P&L but no timing is flagged, never dropped as NaN; a key with no writer basis says so instead of silently composing on the legacy roll; a failing key cannot take an account's holder slot.
- **Differentiators:** per-attempt history for every job kind; replay of a moved scope under both clock settings to close `202-MT5-CLOCK-LEAD-01`.
- **Anti-features:** stop clearing `last_error` on re-claim (it was a deliberate fix; preserve the first cause elsewhere instead); widen `FLOW_TIMING_LARGE_RATIO`. GIPS practice revalues at large flows with a threshold set in advance and not set high to avoid work (LOW, web), but `D15-THRESHOLD-BAND` explicitly allows a founder ruling recorded in CONTEXT as its close, so treat it as a ruling, not a defect.
- **Complexity:** M (L if the retry cause turns out to be a gateway wedge).
- **Code:** `supabase/schema/functions/claim_compute_jobs_with_priority.sql` (`last_error = NULL` on re-claim), `analytics-service/services/nav_twr.py` (`FLOW_TIMING_LARGE_RATIO = 1.0` at :93, `_judged_cohorts` at :567), `analytics-service/services/job_worker.py` (`_native_key_usd_writer_basis` at :4706), `analytics-service/services/account_identity.py` (`_find_live_holder` at :246), `analytics-service/services/broker_dailies.py` (`combine_mt5_deal_ledger`, `_mt5_flow_day_timing`).
- **Groups:** shares the per-attempt cause mechanism with JOBHEAL; must not change numbers under Phase 155.2 mid-verdict without re-running the comparison (MT5-10); `167.1.2-MT5-FAILING-HOLDER` touches the same identity stamping as Phase 225; MT5SOAK is the test harness that should catch the day-level cases; MT5WEDGE may be the retry cause.
- **Classes:** DI (all seven). `202-MT5-CLOCK-LEAD-01` is diagnostic first.
- **Requirement:** "Over seven consecutive nightly runs, every MT5 `derive_broker_dailies` job ends `done` with `attempts=1`, or any retried job's first-attempt cause is stored and readable after the retry succeeds, and a day carrying P&L without timing is flagged rather than dropped."

#### BYBITREADS — every Bybit read covers all stable coins, settle types and the full window
Members: `167.2.1.1-DERIVE-USDT-ONLY-ANCHOR`, `167.2.1.1-BYBIT-POSITIONS-USDT-LINEAR-ONLY`, `186-BYBIT-ONCHAIN-DEPOSIT-UNVERIFIED`, `167.2.1.1.2.1-STRATEGY-BYBIT-7DAY`.
- **Table stakes:** the derive anchor sums the same stable coins as `_fetch_current_equity`; positions include USDC-settled and inverse; a strategy trade sync with an old start reads the whole window or refuses by name; on-chain deposits counted once (replace or union decided on probe evidence).
- **Differentiators:** one shared coin-set constant used by derive, reconstruct and holdings.
- **Anti-features:** assume the 7-day default is harmless without reading Bybit's documented window behaviour; decide replace-vs-union from plain SQL instead of the probe.
- **Complexity:** M.
- **Code:** `analytics-service/tests/test_upnl_venues.py` (docstring at :33 pins "derive reads the USDT coin only"), `analytics-service/services/equity_reconstruction.py` (`_fetch_current_equity` at :815), `analytics-service/services/positions.py:373` (`{"category": "linear", "settleCoin": "USDT"}`), `analytics-service/services/exchange.py` (strategy execution-list loop near :2799-2804 sends `startTime` on the first page only; the closed-pnl reader near :1932-1976 already documents the 7-day rule), `analytics-service/scripts/derivegaps_probe.py`.
- **Groups:** shares `exchange.py` with Phase 223, which owns Bybit flow kinds; the ROADMAP calls 223 independent and explicitly leaves the anchor and positions entries out of it, so they land here with no ordering between the two. The founder action `167.1.2.2-BYBIT-STATIC-EGRESS` (daily derive error until an egress IP is allow-listed) can mask these readings; record it, do not fix it in code.
- **Classes:** DI (all four). Exposure live: 6 active Bybit keys (triage PROD reading 2026-11-23, not re-measured).
- **Requirement:** "A Bybit key holding USDC, a USDC-settled position and an inverse position gets a derive anchor, a holdings row and uPnL that include all three, and a strategy trade sync whose start is older than seven days returns every execution in the window or refuses by name."

#### OKXTRADES — OKX daily P&L is currency-correct, complete and cursor-consistent
Members: `167.1.2.2.2.1-OKX-DAILY-PNL-MIXED-CCY`, `167.1.2.2.2-OKX-PERSISTENT-TRUNCATION`, `167.1.2.2.2-LAST-FETCHED-TRADE-TS-AHEAD`.
- **Table stakes:** a non-USDT bill is converted or refused, never summed at face value; a first window above the page cap completes across ticks instead of truncating daily; the fetch cursor never sits ahead of the newest stored trade.
- **Differentiators:** a cursor-vs-stored invariant check that pages when violated.
- **Anti-features:** raise `OKX_BILLS_PAGE_CAP` as the fix (moves the cliff, does not remove it); silently advance the cursor past a failed window.
- **Complexity:** M.
- **Code:** `analytics-service/services/exchange.py` (`OKX_BILLS_PAGE_CAP = 100` at :141, the page loop at :1568-1595, `fetch_daily_pnl` at :1519), `analytics-service/services/job_worker.py` (`daily_pnl_truncated_okx` at :4107; `last_fetched_trade_timestamp` used as the fills-read preference at :2197-2208).
- **Groups:** shares files with Phase 223 (funding-caller drop decisions); no ordering is evidenced. Check first whether OKXHISTORY (Phase 167.1.2.2.2.1) already closed the truncation half (the triage flags this); Phase 223 for funding-caller drop decisions.
- **Classes:** DI (all three). One of five keys had its cursor ahead (triage PROD reading, not re-measured).
- **Requirement:** "An OKX key with a non-USDT bill, a first window longer than the page cap, and a cursor ahead of its newest stored trade gets a converted-or-refused daily P&L, a completed first window, and a re-read of the skipped days, each driven by a test shown RED first."

#### DERIBITBOOK — the founder's Deribit book compounds to an explained figure
Members: `185-BOOK-CUMULATIVE-UNEXPLAINED`, `189-OPTIONREPLAY-NEXT-MILESTONE`, `L2219`.
- **Table stakes:** the book's cumulative (about x3836 whole history, per the entry's 2026-11-03 PROD reading) is explained day by day or the unexplained days are withheld; a refused option replay is resolved or the cash-basis caveat stays visible; a capital-reason correction never books as trading P&L.
- **Differentiators:** none beyond the explanation itself.
- **Anti-features:** clip implausible days with a plausibility bound (founder rule D-05 of Phase 194: no plausibility bound); classify corrections by substring alone.
- **Complexity:** L (185 is an open investigation; 189 needs founder approval per worker run).
- **Code:** `analytics-service/services/deribit_txn.py` (`correction_is_trading` at :924, `_correction_reason_raw` at :889, `assert_correction_classifiable` at :943, the allow-list and denylist comments at :534-810), `LedgerValuationError` (referenced in `analytics-service/tests/test_deribit_nav_twin.py` and `test_broker_dailies.py`; that the replay still refuses on PROD is the entry's reading).
- **Groups:** likely shares root cause with DERIBITSTALE below; Phase 223 flow sources.
- **Classes:** DI (all three).
- **Requirement:** "The founder's Deribit book shows a cumulative return whose every day is either explained by booked P&L and flows or withheld by name, and a correction row carrying a capital reason is never counted as trading P&L."

#### DERIBITSTALE (this document's label, not a TODOS or triage id; new 2026-11-23 observation) — a daily Deribit derive never leaves its returns weeks behind
Evidence: `.planning/debug/derivecron-compose-divergence.md` resolution note: one Deribit account's stored returns end 2026-10-26 while it has a flow dated 2026-11-09, with 90 `done` `derive_broker_dailies` jobs in 30 days. Undiagnosed.
- **Table stakes:** diagnosis first. Candidates, none confirmed: Phase 188's tiny-base leave-out (`broker_dailies.py` `_leave_out_tiny_base_days` at :235, applied at :344 and :428) legitimately nulls days on a near-empty account; the key-mode upsert in `run_derive_broker_dailies_job` (`job_worker.py:4957`) writes only days present, so a series that stops producing rows reads as "ends". Whichever it is, the system must tell "intentionally null with a reason" from "silently stale".
- **Differentiators:** the per-key freshness sentinel (newest return day vs newest flow and anchor day) for every venue.
- **Anti-features:** backfill the missing days; treat the job's `done` as proof.
- **Complexity:** S if tiny-base explains it (then the requirement is a visible reason), M if it is a real gap.
- **Groups:** DERIBITBOOK, JOBHEAL (job self-heal), ALERTREADERS (whoever pages on staleness).
- **Classes:** DI.
- **Requirement:** "For every key whose derive runs daily, the newest stored return day is within a stated bound of its newest flow day and anchor day, or the gap carries a stored, named reason; a check outside the derive job reports any key that breaks this."

#### HOLDINGSTRUTH — one account counts once, and its holdings agree everywhere
Members: `170.4-IDENTITY-READ-COMPLETENESS`, `170.4-MATCH-UNPRICED-PER-KEY`, `167.1.2.2.1-WRITER-BASIS-VALUES`, `170.4-DASHBOARD-MARKER-READ-SILENT`, `198-SHARED-ACCOUNT-FALLBACK-UNNAMED`.
- **Table stakes:** a holdings row whose key is missing from the identity read fails loud instead of counting as its own account; match scoring applies the unpriced marker per account, matching Holdings; the dashboard surfaces a failed marker read; every failing shared-account key is named.
- **Differentiators:** a per-day value cross-check on the writer basis (`abs(r*L - w_pnl)`), not calendar only.
- **Anti-features:** fall back to `key:<id>` as an account identity; drop `markerReadError` on one consumer while another honours it.
- **Complexity:** M.
- **Code:** `src/lib/latest-holdings-per-key.ts` (`keyAccountOf` at :105), `src/lib/portfolio-exposure.ts` (`fetchHoldings` at :305; that it does not throw on a key absent from the identity read is a triage reading), `src/lib/queries.ts` (no `markerReadError` consumer; only `src/app/api/allocator/scenario/commit/route.ts` and `latest-holdings-per-key.ts` reference it), `analytics-service/routers/match.py` (`unpriced_days` per key at :878-881), `analytics-service/services/allocator_equity_derive.py` (`read_writer_basis` at :1852; calendar-only comparison is a triage reading), `src/app/(dashboard)/allocations/components/MissingDataMessage.tsx` (`shared_account_failing` case at :212) and its producer `src/app/(dashboard)/allocations/lib/key-data-gaps.ts`.
- **Groups:** shares the account-identity topic with Phase 225 (225 stops new duplicates at connect time; HOLDINGSTRUTH fixes the read side). No hard ordering is evidenced; sequence them to avoid editing identity reads twice. NOCAPITAL shares the allocator derive.
- **Classes:** DI (identity, match, writer basis), UF (dashboard marker, unnamed shared key).
- **Requirement:** "For a multi-key account, Holdings, match scoring and the dashboard report the same AUM and the same unpriced days; a failed marker read shows a note and a Sentry event; and every failing key of a shared account is named in the missing-data message."

#### NOCAPITAL — a no-capital key takes one named, flagged path
Members: `166.3.1-NOCAP-MT5-A2-CIRCULAR`, `166.3.1-NOCAP-NONNAV-EXCEPTIONS`, `166.3.1-NOCAP-SEGMENT-REASON-RESIDUE`, `166.3.1-NOCAP-FALLBACK-TRACE`.
- **Table stakes:** a transient zero on an MT5 terminal never drops a funded key; any exception from a no-capital candidate reverts the row (not only `NavReconstructionError`); a fallback to `dropped_key` leaves a payload flag, not only a log line; no residue reason from a refused candidate.
- **Differentiators:** a counter of no-capital fallbacks per run.
- **Anti-features:** catch-all exception swallowing that leaves the row stale on every retry.
- **Complexity:** M.
- **Code:** `analytics-service/services/allocator_equity_derive.py` (`DROPPED_KEY = "dropped_key"` at :129, `dropped_keys` payload at :2404 and :2502), `analytics-service/services/job_worker.py` (the candidate revert arms are `except NavReconstructionError` at :8880 and :9065, as the triage found; the no-capital compose and `no_capital_exit` map at :16391-16413). The flag name the entry suggests has no hits in `analytics-service` (triage reading).
- **Groups:** HOLDINGSTRUTH (same allocator book); founder rule "a failing key affects only itself" (186 D-03/D-07).
- **Classes:** DI (A2, exceptions), INT (trace, residue: the entry says it never reads wrongly trustworthy).
- **Requirement:** "A no-capital allocator key, including an MT5 key whose stored terminal reads zero for one tick, is either kept with its capital or dropped with a stored flag naming why, and a candidate that raises any exception leaves the previous row intact."

#### JOBHEAL — no strategy is stranded by a dropped, reset or abandoned job
Members: `L4282` (wizard first-hop drop), `166.5.1-DERIVE-BATCH-RESET-RESIDUAL`, `L2244` (readmit ceiling gives up silently), `164.2-RECLAIM-PROVENANCE`, `FANOUT-COHORT-SIBLING-POLL-01`.
- **Table stakes:** a finalize-wizard strategy whose first enqueue dropped is re-enqueued or surfaced; a job behind slow batch-mates is not reset and run twice; a readmit that hits its ceiling emits a signal; a reclaimed job keeps its curated error sentence.
- **Differentiators:** a job lease or heartbeat instead of a fixed watchdog override.
- **Anti-features:** bolt a second predicate onto the reconcile sweep (its own header says the first-hop drop needs "a separate mechanism, not a second predicate bolted in here"); give up silently.
- **Complexity:** M (L if the lease is built).
- **Code:** `supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql` (header "TWO KNOWN NON-COVERAGES", item 1 the wizard first-hop drop), `supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql`, `supabase/schema/functions/reclaim_stuck_compute_jobs.sql` (no `sync_strategy_analytics_status` call), `analytics-service/main_worker.py` (`WATCHDOG_PER_KIND_OVERRIDES` at :336), `supabase/schema/functions/enqueue_poll_positions_for_all_strategies.sql` (`s.status IN ('published', 'pending_review')` at :44).
- **Groups:** ⚠ **Conflict with Phase 224.** `FANOUT-COHORT-SIBLING-POLL-01` wants the positions poll to include private strategies; Phase 224's goal retires `enqueue_poll_positions_for_all_strategies` as a retired-kind enqueue. Both cannot hold. Needs a ruling before either phase plans: if 224 retires the poll, the entry closes as moot; if the poll is live, 224's premise is wrong for it. Also shares the first-attempt cause mechanism with MT5DERIVE2; `166.5.1` is latent (its own trigger not met 2026-10-26).
- **Classes:** DI (first-hop drop, private poll), INT (reset residual, reclaim provenance, readmit signal; Rule 12 fail-loud).
- **Requirement:** "A strategy whose first sync enqueue dropped, whose readmit hit its ceiling, or whose job was reclaimed after a crash ends with either fresh dailies or a named, visible state (and an alert for the ceiling), and keeps its curated error sentence."

#### FIGUREMATH — one set of figure constants across stored, factsheet and Scenario engines
Members: `194-ENGINE-CONSTANTS`, `QUANTSTATS-0086-REDERIVE-01`, `L2214` (independent Sharpe/TWR stacks; composite half excluded), `167.1.2.2.1-CAGR-EMPTY-SPAN`.
- **Table stakes:** one year length and one ddof chosen per metric class and pinned by a parity test, or the founder rules the difference intended and it stays labelled; the CAGR span rule states whether emptied stretches count.
- **Differentiators:** an engine-parity test over all three engines.
- **Anti-features:** change constants without a reviewed re-baseline; bump quantstats without re-deriving (0.0.86 moves `cvar` from about −0.0279 to −0.0344 on the benign fixture and reds 8 tests, per the entry).
- **Complexity:** L. `scenario.ts` and the factsheet engine are pin-frozen (SCENARIO-05 / BODY-02); any change moves published numbers, so it needs a founder ruling plus a reviewed re-baseline.
- **Code:** `analytics-service/services/metrics.py` (CAGR as `mean * periods_per_year` at :2162-2164), `src/lib/factsheet/compute.ts` (comment at :99 documents `days / 365.25`), `src/lib/scenario.ts` (comment at :588, 365.25), `analytics-service/requirements.txt:223` and `requirements-dev.txt:16` (`quantstats==0.0.81`), `analytics-service/routers/portfolio.py` (`_compute_portfolio_analytics` at :653).
- **Groups:** Phase 155.2 (any constant change mid-verdict forces a parity re-run); FACTSHEETHONEST (labels).
- **Classes:** DI (all four).
- **Requirement:** "For the same strategy and period, the stored, factsheet and Scenario engines report the same CAGR and Sharpe to a pinned tolerance, or each surface labels its engine and a founder ruling records why they differ; a test fails if any engine's year length or ddof changes."

### User-facing

#### FACTSHEETHONEST — a withheld, re-running or never-computed factsheet says so everywhere
Members: `164.6.6.3.3-WITHHELD-RESIDUE`, `190-RERUN-SURFACES-NOT-HOLDING`, `166.5-COMPUTED-AT-NEVER-COMPUTED-DEFAULT`, `164.6.6.2.1-OWNER-TRUST-TIER-UNPUBLISHED`, `170.1-STRATEGIES-NOTE-WAIT-WORDING`.
- **Table stakes:** a withheld factsheet prints no whole-record reading beside dashed rail figures; a re-run keeps every surface (share card, tear sheet, returns API, recommendations, composer) consistent with Phase 190's "stays published, quiet Updating line"; a never-computed row says never computed; the owner sees their own data source; the /strategies note never says "wait" when nothing runs.
- **Differentiators:** a census test listing every surface that reads the recompute verdict.
- **Anti-features:** un-publish on a re-run (Phase 190 D-02/D-03 forbids it); keep `DEFAULT now()` on `computed_at`.
- **Complexity:** M (the `computed_at` change is a migration plus a type change and reverses CONTEXT R-04, so founder decision first).
- **Code:** `src/lib/closed-sets.ts` (defines `isRecomputeOverStoredResult`; 0 references in `src/app/api/og/factsheet/[id]/route.tsx`), `src/lib/types.ts:307`, `src/app/factsheet/[id]/v2/page.tsx:447` (`readPublicVerificationSignals([id])`, a published-only read), `src/lib/status-surface-copy.ts:455` (`not_available` note).
- **Groups:** SURFACECACHE (same OG route), FIGUREMATH, Phase 222 (error copy).
- **Classes:** UF (all five); `computed_at` is also DI (freshness rule reads it).
- **Requirement:** "On a strategy that is withheld, re-running, or never computed, every surface that shows its figures (factsheet, share card, tear sheet, returns API, composer) shows the same state, a never-computed strategy never reads 'last computed', and the owner sees their own data source."

#### SURFACECACHE — cached or stored UI state reflects current truth
Members: `170.3-OG-NOTFOUND-CACHE`, `201.1-COMPOSER-RANGE-AS-DATES`, `164.6.6.2.1-USDVIEW-READFAIL-CACHED`, `164.6.6.2.1-DISCOVERY-RANKING-HONESTY`.
- **Table stakes:** a not-found OG card is not cached for a day; the composer range is stored as dates (founder 2026-11-13, "Book a fix"); a failed BTC price read is not cached as a normal payload; Discovery does not rank a BTC-unit return against USD returns with only a chip.
- **Differentiators:** none.
- **Anti-features:** serve a cached failure; keep axis indices "for simplicity".
- **Complexity:** S (OG, price read), M (composer range, Discovery ranking).
- **Code:** `src/app/api/og/factsheet/[id]/route.tsx:366` (`LONG_CACHE_CONTROL` for every non-failed render including not-found; `FAILURE_CACHE_CONTROL = "no-store"` only when failed), `src/app/factsheet/[id]/v2/factsheet-context.tsx:214-224` (`userRange` as `[number, number]` indices), `src/lib/factsheet/fetch-and-build-payload.ts:1149` (`usdViewUnavailable: "price_read_failed"` returned as a normal payload), `src/lib/queries.ts` and the strategy table (unit-blind rank: triage reading, not re-read).
- **Groups:** FACTSHEETHONEST (OG route). Discovery ranking's trigger is the first published native-unit strategy (0 on 2026-10-09, not re-measured). Next.js 16 caching differs from older versions (AGENTS.md): read `node_modules/next/dist/docs/` before changing cache headers.
- **Classes:** UF (all four).
- **Requirement:** "A strategy published after its OG card was first requested shows its real card on the next request, a 12-month composer pick keeps the same dates when the series grows at the front, a failed BTC price read is retried on the next view, and Discovery never ranks a BTC-unit return beside USD returns as if comparable."

#### CONNECTTRUTH — connecting a key or a CSV gets an honest answer
Members: `167.1.2-DRAFT-CLASH-SAYS-SO`, `L4097` (rotated MT5 password reports success, stores nothing), `L4105` (MT5 identity is login without server), `167.1.2-ORPHAN-COPY-FIX` (composite half excluded), `L2510` (validate-key error bodies differ per venue), `170.1-CSV-ODD-SPELLING-REJECTED`.
- **Table stakes:** no `200 deduped:true` that silently drops a credential; a reconnect with a new password validates it; MT5 identity includes the server; orphan copy names the key and the remedy; one error-body shape with a code field.
- **Differentiators:** month-name date parsing in CSV (or founder acceptance of the rejection).
- **Anti-features:** short-circuit on stored identity before validating the new secret.
- **Complexity:** M (L4105 is a PROD column migration plus backfill).
- **Code:** `src/app/api/strategies/create-with-key/route.ts` (`resolveByVenueIdentity` at :212; the `held.kind === "draft"` arm returning `deduped: true` at :716-725; `keyOrphanedResponse()` at :499 takes no parameters), `analytics-service/routers/exchange.py:591` (`HTTPException(400, detail=MT5_WRONG_SERVER_DETAIL)`, no code field), `analytics-service/services/csv_validator.py`.
- **Groups:** ⚠ **Overlaps Phase 225 ONEACCOUNTONCE.** `167.1.2-DRAFT-CLASH-SAYS-SO`, `L4097` and `L4105` all live in `resolveByVenueIdentity` and the identity value 225 refuses on. Recommend the roadmapper assigns those three to 225 (or makes CONNECTTRUTH depend on 225), so one phase owns the identity shape. The other three are independent.
- **Classes:** UF (all six); `L4105` and `L4097` are also DI (collision; nothing stored).
- **Requirement:** "A user who reconnects an account with a new password, connects a key matching their own draft, or connects an MT5 login that exists on another broker server gets a named answer that matches what was stored, and every validate-key error body carries the same machine-readable code field."

#### RATELIMITFAIR — anonymous edge limits match the buckets behind them
Members: `L4491`, `L4501`.
- **Table stakes:** a few anonymous visitors cannot exhaust the shared anon bucket; normal CSV iteration does not hit 429.
- **Differentiators:** none.
- **Anti-features:** raise every limit until nothing 429s.
- **Complexity:** S (founder call between a per-IP anon tier and raising the shared tier).
- **Code:** `src/lib/ratelimit.ts` (`publicIpLimiter` 10/60 s at :117, `csvValidateLimiter` 20/60 s at :206; docblock cites a stale upstream cap), `analytics-service/routers/process_key.py` (`_PROCESS_KEY_TENANT_LIMIT = "100/hour"` at :110, `_PROCESS_KEY_ANON_LIMIT = "30/hour"` at :117).
- **Groups:** none.
- **Classes:** UF.
- **Requirement:** "Ten anonymous visitors from different IPs can each run the verify teaser within its documented per-IP limit without exhausting a shared bucket, and a signed-in user can validate a CSV up to the edge limit without an upstream 429."

### Security

#### SECRETSHYGIENE — no credential live in public history, diagnostics or a wildcard destination
Members: `158-OPS-03` (HIGH), `164.8.4-REDACT-NO-POSITIVE-SCAN`, `SECRETSCAN-FULLHISTORY-01`, `167.1.2.2.2-CRON-TICK-RESIDUALS`.
- **Table stakes:** the two demo accounts (pair A, the shared e2e login; pair B, the seed-demo allocator) are deleted on every project where they exist (founder ruling 2026-11-23; account deletion is a founder action); their literals leave the tree; the cron destination allow-list names exact hosts, not a `.up.railway.app` suffix.
- **Differentiators:** absence guards by hash so the guard survives literal removal; a scheduled full-history secret scan.
- **Anti-features:** history rewrite (declined under SEC-02); deleting the absence-guard test to remove the literal.
- **Complexity:** S (code), M (cron allow-list migration, reviewers required).
- **Code:** `src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts` holds pair A as the needle of an absence assertion, retained deliberately; two archived files under `.planning/milestones/v0.16.0.0-phases/` and `v0.17.0.0-phases/` still quote pair A (per the entry). `supabase/migrations/20261010140000_cron_sync_tick.sql:93` and `20261020120000_ops_staleness_check.sql:129` (allow-list regex `https://[a-z0-9][a-z0-9.-]*\.up\.railway\.app`, a suffix wildcard), `.github/workflows/test-restore-from-baseline.yml:1623-1624` (six diagnostic channels not secret-scanned), gitleaks appears only in `.github/workflows/ci.yml` and `supabase-migrate.yml`; no workflow schedules a full-history scan (triage reading, consistent with that file list).
- **Groups:** ⚠ "remove the literals" collides with the guard test and the archived `.planning` files: plan both together. `164.8.4-REDACT-NO-POSITIVE-SCAN` carries a founder decision of 2026-09-19 ("NO PHASE, stays a TODO"); it is in scope only because the 2026-11-23 ruling pulled in all MEDIUM+. Surface that conflict at requirements time. `SECRETSCAN-FULLHISTORY-01` overlaps `.planning/WINDOWS.md` entry 61 (37 credential-shaped fixture literals in CHANGELOG prose).
- **Classes:** SEC (all four).
- **Requirement:** "The two demo accounts no longer exist on TEST or PROD, no tracked file contains either password literal (the absence guard checks a hash), a scheduled full-history secret scan runs, and the cron tick posts the service key only to a named host."

#### DBACCESS — anon and client roles read and lock only what they must
Members: `RANK-SPLAT-01`, `L2267` (api_keys writes bypass RLS, no DB backstop), `TRIGGERREVOKE-LOCKHOLD-01`, `170.6.1.1-API-KEY-ID-OPTIONAL-OWNER-GUARD`, `L2120` (six routes outside the audit-log law), `158-OPS-03` (orphaned `discovery-watchlist` spec with two RLS proofs).
- **Table stakes:** anon reads only named JSON keys, not a whole `metrics_json_by_basis` column; a client role cannot hold a table-wide lock indefinitely; RLS proofs run in CI.
- **Differentiators:** a DB trigger backstopping `api_keys.user_id` on insert; a compiler guard type for owner reads.
- **Anti-features:** widen the audit allowlist; set role timeouts without first proving PostgREST honours them on TEST.
- **Complexity:** M (migrations need migration-reviewer and rls-policy-auditor before merge; PROD auto-applies after TEST).
- **Code:** `src/lib/factsheet/fetch-and-build-payload.ts:320` (selects `metrics_json_by_basis` whole), `src/lib/types.ts:161` (`api_key_id?: string | null`), `src/__tests__/audit-coverage.test.ts:1699` (`H_0001_UNCOVERED_ALLOWLIST`), `e2e/discovery-watchlist.spec.ts` (tracked, wired into no workflow per the triage). No migration sets a role-level `idle_in_transaction_session_timeout` (searched `supabase/migrations`, no hit).
- **Groups:** SQLGATES2 (anon census and gate exemption arms); Phase 224 (`database.types.ts` freshness).
- **Classes:** SEC (all six).
- **Requirement:** "An anonymous request can read only the named metric keys a factsheet needs, a client role cannot stall a table with an explicit lock past a set timeout, and the watchlist RLS proofs run and can fail in CI."

### Observability

#### ALERTPAGE — an outage page opens, credits Sentry, recovers and closes exactly once
Members: `164.6.8-F4-WR03-DEBT-PAGE-NEVER-ENDS`, `164.6.8-R4-SFH-F1-DUPLICATE-RECOVERY`, `164.6.8-WR-D16-01-PROBE-BOUND-INLINE-CLOSE`, `164.6.8-WR-R4-01-SENTRY-CREDIT-INSIDE-RULE-INTERVAL`, `164.6.8-F3-SENTRY-HALF-NOOP`, `164.6.8-N2-OPEN-RECORD-FAILS-AT-WARNING`, `164.6.8-WR05-ALERT-PATH-HANDLERS-AT-WARNING`.
- **Table stakes:** one open, one recovered, one close per episode; Sentry is credited only when a notification can actually go out; any failure on the paging path logs at event level.
- **Differentiators:** an episode id used as the dedup key end to end (the standard incident-key pattern, LOW, web).
- **Anti-features:** credit Sentry on any event id (the rule's 60-minute action interval can suppress the notification); "restarted" wording on a duplicate recovery.
- **Complexity:** M.
- **Code:** `analytics-service/services/ops_alert.py` (`sentry_ok = event_id is not None` at :507 with no ERROR on None; `sentry_counts` rule at :349-362), `analytics-service/services/mt5_relogin.py:3059` (settled notice decided only by `debt_owed_at_start and not mt5_relaunch_debt(...)`), `analytics-service/services/mt5_outage_alert.py` (`_DURABLE_CHECKED` and `_RECOVERY_TASKS` at :168-172, no in-flight guard), `analytics-service/services/mt5_validation_liveness.py` (`PROBE_TICK_BOUND_S` at :126), `analytics-service/services/ops_alert_open.py:262-271` (record failure at `logger.warning`).
- **Groups:** ALERTREADERS (same `ops_alert.py`), Phase 222 (alert copy).
- **Classes:** INT (all seven; the founder is the only reader).
- **Requirement:** "A simulated MT5 outage that relapses inside an hour produces exactly one open and one recovered notice per episode, never credits Sentry for a suppressed notification, and any failure on the paging path produces an ERROR-level event."

#### ALERTREADERS — every alert reader sees every row and reports its own delivery failure
Members: `164.6.8-F5-READER-DELIVERY-UNOBSERVED`, `164.6.8-F6-SCRUB-READER-NEWEST-ONLY`, `164.6.8-N3-SCRUB-SECOND-FAILURE-SUPPRESSED`, `164.6.8-WR06-CRON-SYNC-ERRORS-PAGE-ON-PER-KEY-FAULTS`, `L2255` (match-engine cron health).
- **Table stakes:** the staleness check reads its own delivery outcome; the scrub reader reads every row since its last tick, not the newest; a second same-cause failure inside an hour is not marked paged and dropped; one flaky key does not page hourly; the match-engine cron's run outcome is checked.
- **Differentiators:** the freshness sentinel (see DERIBITSTALE) lives here.
- **Anti-features:** treat a pg_net "success" as delivered (repo rule: it only means queued).
- **Complexity:** M (WR06 needs a migration with a new stamp).
- **Code:** `supabase/migrations/20261020120000_ops_staleness_check.sql` (no `_http_response` reference; `v_cs_errs` count at :139), `analytics-service/services/mt5_validation_liveness.py` (`_read_newest_scrub_row` at :330), `analytics-service/services/ops_alert.py` (`_admit_through_window` at :304). For `L2255`: `scripts/prod-prober/cron-manifest.json` already registers `match_engine_cron` (:79-85), so what is missing is a check on the cron's run outcome, not its registration. The triage notes every tick in pg_net retention returned HTTP 200 with `processed:0`, a separate founder question.
- **Groups:** ALERTPAGE, DERIBITSTALE, Phase 222 (ops-alert theme).
- **Classes:** INT (F5, F6, N3, WR06), DI-adjacent (`L2255`: stale match data reaches allocators silently).
- **Requirement:** "Two failed scrubs of the same cause inside an hour, a failed staleness-alert delivery, and a match-engine cron tick that processes nothing each produce a readable signal, and one key failing two syncs in a row does not page hourly."

#### SENTRYHELD — anon and landing captures are held and throttled
Members: `170.6.1.1-FAILANONREAD-CAPTURE-HELD`, `170.6.1.1-LANDING-CAPTURE-THROTTLE`.
- **Table stakes:** a capture before a throw is awaited or flushed; the landing page captures at most once per window, not per stat per view.
- **Differentiators:** none.
- **Anti-features:** dropping the capture to cut noise (the failure then goes unseen).
- **Complexity:** S.
- **Code:** `src/lib/queries.ts:610-614` (`failAnonRead` fires `captureToSentry` then throws without holding the promise), `src/app/(marketing)/page.tsx:39` and `:55` (per-stat capture, no throttle).
- **Groups:** shares `captureToSentry` with Phase 221. Both sites are server-side (`src/lib/queries.ts` imports `next/server` and the server Supabase client; the marketing page imports the server client), so 221's client-init ordering does not bind them; plan them after or with 221 only to avoid editing the same helper twice.
- **Classes:** INT.
- **Requirement:** "A failing anonymous read produces exactly one tagged Sentry event that arrives, and a landing page view with three failing stats produces at most one event per throttle window."

#### MT5WEDGE (live-gated) — the -10005 account-switch wedge is named from captured evidence
Member: `MT5-SWITCH-WEDGE-CAUSE-01`.
- **Table stakes:** the evidence snapshot is captured before the auto-recycle erases it, and the mechanism is named from it. No real wedge since the snapshot shipped (entry, 2026-10-14).
- **Differentiators:** none.
- **Anti-features:** disabling the auto-recycle to keep evidence (it is what restores service).
- **Complexity:** S once a wedge occurs; cannot be scheduled.
- **Groups:** MT5DERIVE2 (possible retry cause).
- **Classes:** INT. Not plannable as ordinary work: it waits on an event.
- **Requirement:** "When the next real -10005 wedge occurs, its captured snapshot names the mechanism before the recycle runs."

### CI and tooling

#### SQLGATES2 — census and gate pins fail when an axis drifts
Members: `170.6.1.1-CENSUS-STALE-AXES`, `170.6.1.1-GATE-HIDDEN-EXEMPTIONS-UNENFORCED`, `167.1.2.2.2-PROVENANCE-GATE-RESIDUALS`, `164.8-APPLYTEST-CANNOT-TELL-SEEDED-FROM-APPLIED`, `164.7-MIGRATION-COMMENT-DRIFT`.
- **Differentiators:** none.
- **Table stakes:** the anon census derives its route list from `PUBLIC_ROUTES`, not 8 hand-copied dirs; the hidden-column exemption list is asserted anon-denied; apply-test tells a seeded ledger row from an applied one, and its documented remedy no longer sends a migration to PROD without crossing TEST.
- **Anti-features:** fix the applied migration's comment by editing the applied file without the CLI plan reading (the entry says to take it first); the `apply-test` remedy "re-run via workflow_dispatch" bypasses TEST while PROD auto-applies with no human stop (since 2026-09-23).
- **Complexity:** M. `164.7-MIGRATION-COMMENT-DRIFT` is comment-only (triage graded it LOW; MEDIUM because the brief required it).
- **Code:** `src/lib/anon-strategies-projection.test.ts:46` (`ANON_ROUTE_DIRS`, 8 hand-copied dirs, against 24 entries in `PUBLIC_ROUTES` at `src/proxy.ts:19`), `supabase/tests/test_strategies_anon_grants.sql:86` (`v_hidden_column_exemptions` empty, no denial arm), `.github/workflows/supabase-migrate.yml:1005` (the "applied ZERO migrations" refusal and its dispatch remedy), `supabase/migrations/20260907130000_ledger_refresh_switch_to_system_flags.sql`, `supabase/tests/test_strategy_analytics_trade_fetch_provenance.sql` (missing arms: triage reading).
- **Groups:** DBACCESS; any new SQL gate moves several censuses (mutation floors, lint) in the same PR.
- **Classes:** INT (SQLGATES2 is CI), with `APPLYTEST` touching deploy safety.
- **Requirement:** "Adding a public route without updating the anon census, adding a hidden-column exemption without an anon-denial arm, or a TEST push that applies zero migrations because the ledger was seeded each fails CI with a named reason, shown RED first."

#### TESTLANES — every live-DB lane test executes and passes
Members: `164.9-LIVEDB-LANE-EXECUTION-CENSUS`, `164.9-RPC-RETRY-NARROWED-SKIP-REOPENED`, `LINT-CACHE-MASKS-WARNINGS`, `164.4.2-PROD-SUPAUTILS-FUNCTION-DENIAL-CRASH`.
- **Table stakes:** the 7 carried live-DB failures pass or are fixed at root (the wizard RPC 42501 may be a real role-gate defect); a read timeout on a fence RPC cannot skip green; the lint verdict does not depend on cache warmth; the PROD image's supautils crash risk is measured.
- **Differentiators:** none.
- **Anti-features:** weaken assertions to clear the ledger (entry forbids it); restore a stale ESLint cache by prefix.
- **Complexity:** M; the supautils item needs PROD Postgres logs (founder or MCP log access, not SQL).
- **Code:** `scripts/live-db-execution-ledger.txt:103` (`ENTRY_COUNT = 7`), `analytics-service/tests/live_db_transport.py:147` (`_NON_IDEMPOTENT_BUILDER_METHODS` includes rpc), `package.json:11` (`eslint --cache`), `.github/workflows/ci.yml:394-397` (cache key with a prefix `restore-keys` fallback).
- **Groups:** DBACCESS (42501 role gate), SQLGATES2.
- **Classes:** INT; the 42501 failure may turn out DI/SEC.
- **Requirement:** "The live-DB execution ledger reads `ENTRY_COUNT = 0` with no assertion weakened, a timed-out fence RPC fails rather than skips, and the lint job reports the same warnings with a cold and a warm cache."

#### MT5SOAK — the derive soak checks what it claims
Members: `164.6.6.2.3-SOAK-BTC-FLOORS`, `164.6.6.2.3-SOAK-TIMED-DAYS-UNCHECKED`, `164.6.6.2.3-SOAK-DAY-ATTRIBUTION`.
- **Table stakes:** BTC-unit accounts judged on their unit's floors; timed-day returns reject NaN and implausible values, not only infinity; day attribution checked against an independent per-day accumulation (repo rule: money-math oracles are independent invariants).
- **Differentiators:** none.
- **Anti-features:** derive the expected return from the fold's own per-day P&L (that is the current flaw: it cannot disagree with itself).
- **Complexity:** S to M.
- **Code:** `analytics-service/scripts/mt5_soak.py` (imports `USD_FLOORS` at :146, judges on them at :309-313).
- **Groups:** MT5DERIVE2 (the soak is its harness); Phase 155.2.
- **Classes:** INT (soak script, not a user path), protecting DI.
- **Requirement:** "The MT5 soak goes RED on a BTC-unit account with a mis-bucketed deal, a NaN timed-day return, or a day attributed to the wrong UTC date."

### Carried phases (scope fixed in ROADMAP.md; listed so the requirements step keeps one vocabulary)

Requirement sentences for 221–225 are drafted from each ROADMAP section's success criteria, because those phases were booked with `Requirements: TBD`. 155.2 and 157 already carry ids; they are pointed at, not redrafted.

| Phase | What "correct or fails loudly" means | Class | Complexity | Notes and conflicts |
|-------|--------------------------------------|-------|-----------|---------------------|
| 155.2 LIVEPARITY | Rendered MT5 numbers match terminal and broker within `MT5_PARITY_TOLERANCE` (D-B); every gap fixed at root or ruled (MT5-07..10, MT5-15, MT5-GOAL-01) | DI | L, founder-gated | ROADMAP shows plans 11–14 open and 15–17 shipped; the scope file says "plans 14–17". The ROADMAP is the newer record (gap closure 2 shipped in #1306): trust it, flag the scope wording. Any DI fix above that moves MT5 numbers needs a parity re-run |
| 157 FOUNDER-CONFIRM | Founder observes FCONF-01..03 in a real wizard and rotates the spike password after the last live read (FCONF-04) | UF | S, founder-gated | Same sitting as 155.2 |
| 221 SENTRYSCRUB2 | No Sentry event carries PostgREST `details`/`hint`; browser captures report | SEC/INT | M | `scrubSentryEvent` at `src/instrumentation.ts:440`. Must land before SENTRYHELD changes client capture |
| 222 ALERTTRUTH | Error copy names a real channel; benchmark outage label distinct from stale | UF | M (migration) | `supabase/schema/functions/computation_error_copy.sql` still says "contact support" (:44, :51) |
| 223 FLOWKINDS | Every derive path reads the same flow kinds and refuses a malformed read by name | DI | M | ⚠ ROADMAP goal and SC-1/SC-2 still describe the composite path (`run_stitch_composite_job`, composite member read). Per founder ruling only the flow-source half survives: SC-3 (funding-caller decisions, minus the composite member read) and SC-4 (malformed counts) |
| 224 DEADLEFTOVERS | Nothing in the repo looks alive that is not | INT | M (migration) | ⚠ Conflicts with JOBHEAL's `FANOUT-COHORT-SIBLING-POLL-01` (see JOBHEAL) |
| 225 ONEACCOUNTONCE | Same-owner duplicate accounts refused by name; cross-user sharing allowed | DI/UF | M | Recommend it absorbs CONNECTTRUTH's three identity entries |

**Suggested requirement sentences (carried phases):**
- **155.2:** use MT5-07, MT5-08, MT5-09, MT5-10, MT5-15 and MT5-GOAL-01 verbatim from `.planning/milestones/v1.18-REQUIREMENTS.md`, bound by D-A..D-E (D-E as amended 2026-11-22).
- **157:** use FCONF-01..04 verbatim from the same file.
- **221:** "A direct `Sentry.captureException` of an object carrying PostgREST `details` and `hint` produces an envelope with neither, a `captureToSentry` call in a client module produces an event that passes the same scrub, and the auth callback logs a GoTrue `error_code` but never `error_description`."
- **222:** "No user-readable error sentence from the analytics service or `computation_error_copy` says 'contact support'; a total benchmark source failure shows wording distinct from a stale benchmark; and a failed follow-on analytics enqueue never leaves a strategy reading `complete` with no analytics."
- **223 (flow-source half only):** "`run_sync_funding_job` and `okx_archive_job` each have a recorded, test-pinned decision to refuse a malformed funding row by name or keep dropping it, and the per-key count of `daily_pnl_malformed_<venue>` flags is recorded and ruled on by the founder before any refusal is switched on." (ROADMAP SC-1, SC-2 and the composite member read in SC-3 are composite work and leave scope.)
- **224:** "`get_admin_compute_jobs`, the retired job kinds' enqueues, Phase 176's inert leftovers and the reconstruct cap and marker machinery no longer exist or have a live caller, and `src/lib/database.types.ts` declares no function the schema lacks." (Subject to the JOBHEAL ruling on the positions poll.)
- **225:** "A user connecting a key or saving a draft whose account identity matches one they already hold is refused by name in the wizard and the API, while the same account connected by a different user stays allowed and keeps its share link."


---

## Feature Dependencies

```
Per-attempt failure record (new)
    └──enables──> MT5DERIVE2 (175 retry cause)
    └──enables──> JOBHEAL (readmit ceiling signal, reclaim provenance)

Freshness sentinel (new, independent of job status)
    └──requires diagnosis from──> DERIBITSTALE
    └──hosted by──> ALERTREADERS

Phase 225 ONEACCOUNTONCE (identity shape)
    └──required by──> CONNECTTRUTH (draft clash, rotated password, login+server)
    └──shares files with──> HOLDINGSTRUTH (read side of "one account counts once")
    └──shares files with──> MT5DERIVE2 (167.1.2-MT5-FAILING-HOLDER, account_identity.py)

Phase 221 SENTRYSCRUB2 ──shares captureToSentry with──> SENTRYHELD (server-side sites; no ordering forced)
ALERTPAGE ──shares ops_alert.py with──> ALERTREADERS (sequence or merge)
Phase 223 FLOWKINDS ──shares exchange.py with──> BYBITREADS, OKXTRADES (no ordering evidenced)
MT5SOAK ──harness for──> MT5DERIVE2
FIGUREMATH, MT5DERIVE2, any MT5-number change ──forces re-run of──> Phase 155.2 verdict
SECRETSHYGIENE (literal removal) ──requires──> hash-based absence guard (same PR)

Phase 224 (retire positions-poll enqueue) ──conflicts──> JOBHEAL FANOUT-COHORT-SIBLING-POLL-01
```

### Dependency Notes

- **225 before CONNECTTRUTH's identity entries:** `167.1.2-DRAFT-CLASH-SAYS-SO`, `L4097` and `L4105` live in `resolveByVenueIdentity` (`create-with-key/route.ts:212`) and the identity value 225 refuses on; two phases editing that shape in parallel would fight.
- **221 and SENTRYHELD share a helper, not an order:** 221's criterion 2 binds the browser init; both SENTRYHELD sites are server-side, so they are not blocked by it. Planning them together avoids two edits to `captureToSentry`.
- **"Shares files" is not "requires":** HOLDINGSTRUTH vs 225 and BYBITREADS/OKXTRADES vs 223 edit the same modules but no evidence forces an order. The roadmapper may run them in parallel with separate worktrees or sequence them; only the three CONNECTTRUTH identity entries are a hard dependency on 225.
- **155.2 is a sink:** a parity verdict holds only for the code it was run on. DI fixes that move MT5 or shared money-math numbers either land before the Gate B re-run (plan 12) or trigger another run.
- **JOBHEAL vs 224:** needs a founder or planner ruling on whether `enqueue_poll_positions_for_all_strategies` is live or retired before either phase plans.

---

## MVP Definition (ordering for this milestone; nothing is optional, this is sequence)

### Land first (data integrity: the numbers themselves)
- [ ] Per-attempt failure record plus MT5DERIVE2: a live daily recurrence since 2026-11-20 (entry reading)
- [ ] DERIBITSTALE diagnosis plus freshness sentinel: possible silent stale published returns
- [ ] Phase 225 and HOLDINGSTRUTH: one account counted once (sequence to avoid double edits; not a hard order)
- [ ] BYBITREADS and OKXTRADES (alongside Phase 223, shared files), NOCAPITAL, JOBHEAL
- [ ] FIGUREMATH: founder ruling first, then the parity test and re-baseline

### Then user-facing
- [ ] FACTSHEETHONEST, SURFACECACHE, CONNECTTRUTH, RATELIMITFAIR, Phase 222

### Then security
- [ ] SECRETSHYGIENE (`158-OPS-03` is the only HIGH; the account deletion can happen any time, independent of code), DBACCESS, Phase 221

### Then the rest
- [ ] ALERTPAGE, ALERTREADERS, SENTRYHELD, SQLGATES2, TESTLANES, MT5SOAK, Phase 224
- [ ] Founder-gated: 155.2 (statements), 157 (same sitting), DERIBITBOOK option replay approvals
- [ ] Event-gated: MT5WEDGE

### Out of scope (founder rulings)
- [ ] Composite work of any kind, including 223's composite half and composite halves of `167.1.2-ORPHAN-COPY-FIX` and `L2214`
- [ ] Latent Binance and sFOX groups; GLB-1

## Feature Prioritization Matrix

| Group | User Value | Implementation Cost | Priority |
|-------|------------|---------------------|----------|
| MT5DERIVE2 | HIGH | MEDIUM | P1 |
| DERIBITSTALE | HIGH | LOW-MEDIUM | P1 |
| HOLDINGSTRUTH (+225) | HIGH | MEDIUM | P1 |
| BYBITREADS | HIGH | MEDIUM | P1 |
| OKXTRADES | MEDIUM | MEDIUM | P1 |
| JOBHEAL | HIGH | MEDIUM | P1 |
| NOCAPITAL | MEDIUM | MEDIUM | P1 |
| FIGUREMATH | HIGH | HIGH | P1 (ruling first) |
| DERIBITBOOK | MEDIUM (one book) | HIGH | P1, founder-gated |
| FACTSHEETHONEST | HIGH | MEDIUM | P2 |
| SURFACECACHE | MEDIUM | LOW-MEDIUM | P2 |
| CONNECTTRUTH | MEDIUM | MEDIUM | P2 |
| RATELIMITFAIR | LOW (no clients) | LOW | P2 |
| SECRETSHYGIENE | HIGH (HIGH-severity entry) | LOW-MEDIUM | P2 by founder order, P1 for the account deletion |
| DBACCESS | MEDIUM | MEDIUM | P2 |
| ALERTPAGE / ALERTREADERS | MEDIUM | MEDIUM | P3 |
| SENTRYHELD | LOW | LOW | P3 |
| SQLGATES2 / TESTLANES / MT5SOAK | MEDIUM (protects the rest) | MEDIUM | P3 |
| MT5WEDGE | LOW until a wedge | LOW | event-gated |

**Priority key:** P1 data integrity, P2 user-facing and security, P3 the rest (founder order 2026-11-23).

## Comparable Practice (mature fund-data platforms)

| Concern | Mature practice | Our approach |
|---------|-----------------|--------------|
| Large cash flows in TWR | GIPS: revalue at large external flows, threshold set in advance and not set high to avoid revaluation (LOW, web) | Day-level flow timing with `FLOW_TIMING_LARGE_RATIO`; the band choice stays a founder ruling (D-15), recorded |
| Data freshness | Freshness checked independently of the job, per dataset, with an SLA (LOW, web) | Add the per-key freshness sentinel; never infer freshness from job status |
| Incident lifecycle | One key per incident; repeats fold in; a resolve with the same key closes it (LOW, web) | One episode, one open, one recovered, one close |
| Leaked credentials | Revoke or rotate first; history rewrite does not reach clones (LOW, web) | Delete the demo accounts; forward-only literal removal; hash-based guard |

## Sources

- Repo, read at HEAD `1c361e676`: every path and symbol cited above; `TODOS.md` entries by id; `.planning/ROADMAP.md` next-milestone section; `.planning/PROJECT.md` (Current Milestone, Constraints, Key Decisions); `.planning/milestones/v1.18-REQUIREMENTS.md` (MT5-07..10, MT5-15, MT5-GOAL-01, FCONF-01..04, D-A..D-E); `.planning/debug/derivecron-compose-divergence.md` (Deribit stale-returns observation).
- Founder scope input and the TODOS triage file (2026-11-23), both in the orchestrator's session scratchpad.
- [GIPS Q&A database: large cash flows](https://www.gipsstandards.org/?GIPSID=034) (LOW via search summary)
- [Datadog: what is data freshness](https://www.datadoghq.com/knowledge-center/data-freshness/) (LOW)
- [PagerDuty: alerts and deduplication](https://support.pagerduty.com/docs/alerts) (LOW)
- [GitHub Docs: removing sensitive data from a repository](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) (LOW)

---
*Feature research for: quant fund-data platform hardening (v1.22 TRUTH)*
*Researched: 2026-11-23*

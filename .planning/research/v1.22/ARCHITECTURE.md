# Architecture Research

**Domain:** Hardening milestone v1.22 TRUTH: how each fix group plugs into the existing Quantalyze architecture
**Researched:** 2026-11-23 (code read at worktree HEAD `1c361e676`; no database was queried)
**Confidence:** HIGH for integration points (files, symbols and absence claims were re-read at HEAD; anything marked *triage-cited* was not); MEDIUM for build order (it rests on triage readings that this research did not re-measure on PROD); LOW for the Deribit stale-returns cause (undiagnosed)

> Cite by symbol, never by line. The triage's line numbers were taken at a different sha and have
> already drifted at HEAD (for example, the triage puts `main_worker.py`'s poll enqueue at one line and
> HEAD has it in `daily_enqueue_tick` elsewhere). Every anchor below is a file plus a function, constant or
> migration file name.
>
> The template's Component Responsibilities and Recommended Project Structure sections are left out on
> purpose: this milestone adds no components and no folders. The seam and per-group tables take their place.

## Standard Architecture

### System Overview (only the parts these fixes touch)

```
┌──────────────────────────── Vercel: Next.js 16 App Router (src/) ─────────────────────────────┐
│ Connect: api/strategies/create-with-key/route.ts   Factsheet: factsheet/[id]/v2/page.tsx       │
│          api/strategies/csv-validate|csv-finalize            lib/factsheet/fetch-and-build-... │
│ Holdings: lib/latest-holdings-per-key.ts                     api/og/factsheet/[id]/route.tsx   │
│           lib/portfolio-exposure.ts, allocations/lib/key-data-gaps.ts                          │
│ Figures:  lib/figure-gate.ts, lib/factsheet/compute.ts, lib/scenario.ts                        │
│ Sentry:   instrumentation.ts (scrubSentryEvent)  lib/sentry-capture.ts (captureToSentry)       │
│ Limits:   lib/ratelimit.ts (publicIpLimiter, csvValidateLimiter)   proxy.ts (PUBLIC_ROUTES)    │
└───────────────┬───────────────────────────────────────────────────────────────┬──────────────┘
                │ PostgREST (RLS, SECDEF RPCs)                                    │ HTTPS
┌───────────────▼────────────────────── Supabase Postgres ──────────┐ ┌──────────▼───────────────┐
│ compute_jobs queue: claim_compute_jobs_with_priority,              │ │ Railway: analytics-service│
│   reset_stalled_compute_jobs, reclaim_stuck_compute_jobs,          │ │ main_worker.py            │
│   mark_compute_job_failed, sync_strategy_analytics_status          │◄┤  dispatch_tick, watchdog, │
│ pg_cron + pg_net: cron_sync_tick, ops_staleness_check,             │ │  daily_enqueue_tick       │
│   dropped-enqueue sweep (inline cron command), ledger fanout       │ │ services/job_worker.py    │
│ Tables: api_keys (venue_account_id), csv_daily_returns,            │ │  run_derive_broker_dailies│
│   allocator_equity_derived (key_inputs:<key>), strategy_analytics, │ │  run_derive_allocator_eq. │
│   allocator_holdings, computation_error_copy()                     │ │  run_sync_trades_job ...  │
└────────────────────────────────────────────────────────────────────┘ │ venue readers, nav_twr,   │
                                                                       │ ops_alert*, mt5_*         │
                                                                       └───────────────────────────┘
```

### The five shared seams that decide the build order

Nearly every data-integrity group lands in one of five seams. Treat the **(file, top-level symbol)** pair as the unit two phases contend for, not the file: `analytics-service/services/job_worker.py` alone is touched by about ten groups, so a file-level rule would make everything serial, which is wrong.

| Seam | Where it lives at HEAD | Groups that touch it |
|---|---|---|
| **S1 Derive writer** | `job_worker.py` `run_derive_broker_dailies_job` (one function, roughly 6,700 lines, every venue branch inside it: `venue == "deribit"`, `"mt5"`, `"okx"`, `"bybit"`, `"sfox"`), its key-mode exits (the `<2-day` short-circuit and the `>=2-day` exit, both ending in `_run_key_mode_compose_epilogue`), `_native_key_usd_writer_basis`, plus `services/nav_twr.py` (`chain_linked_twr`, `_judged_cohorts`, `FLOW_TIMING_LARGE_RATIO`) | MT5DERIVE2, DERIBITBOOK, Deribit stale returns, BYBITREADS (anchor), 155.2 fixes |
| **S2 Compose reader** | `job_worker.py` `run_derive_allocator_equity_job` (the no-capital machinery: `_no_capital_level_on_last_return_day`, `_no_capital_exit_consumes_only_dust`, `no_capital_candidates`), `services/allocator_equity_derive.py` (`read_writer_basis`, `DegradeReason.KEY_INPUTS_MISMATCH`, `FULL_HISTORY_VENUES`), `services/equity_reconstruction.py` (`_NO_CAPITAL_ANCHOR_REASONS`) | NOCAPITAL, HOLDINGSTRUTH (writer basis), Deribit stale returns (the `out_of_window_flow` it trips) |
| **S3 Job lifecycle** | SQL: `claim_compute_jobs_with_priority`, `reset_stalled_compute_jobs`, `reclaim_stuck_compute_jobs`, `mark_compute_job_failed`, the dropped-enqueue sweep cron command, `enqueue_poll_positions_for_all_strategies`. Python: `main_worker.py` (`WATCHDOG_PER_KIND_OVERRIDES`, `dispatch_tick`'s reconcile-sweep capture, `daily_enqueue_tick`) | MT5DERIVE2 (`175`), JOBHEAL, 224 |
| **S4 Account identity** | `src/app/api/strategies/create-with-key/route.ts` (`resolveByVenueIdentity`, the `venueMatch.kind === "draft"` arms, `keyOrphanedResponse`), `analytics-service/services/account_identity.py` (`stamp_account_identity`, `_find_live_holder`, `_share_kind`, `_mark_shared`), `api_keys.venue_account_id` and its live-scoped partial UNIQUE | 225, CONNECTTRUTH (4 members), MT5DERIVE2's `167.1.2-MT5-FAILING-HOLDER`, then HOLDINGSTRUTH reads, DBACCESS `L2267` (api_keys trigger) |
| **S5 Ops alert SQL** | `ops_staleness_check()` (latest definition: `20261020120000_ops_staleness_check.sql`) and `cron_sync_tick()` (latest: `20261010140000_cron_sync_tick.sql`); both carry the same `.up.railway.app` destination allowlist and `btrim` key check | ALERTREADERS (F5, WR06, `L2255`), SECRETSHYGIENE (`167.1.2.2.2-CRON-TICK-RESIDUALS`) |

## Per-group integration map

Legend: **NEW** = new file, function, migration or workflow. **MOD** = change to existing code. **MIG** = needs a migration (auto-applies to PROD on merge; migration-reviewer and rls-policy-auditor must be clean before merge). **Gate** = what must happen before or during the phase that code cannot do.

### Data integrity

#### MT5DERIVE2 (7 entries)

| Member | Integration point at HEAD | New / mod | Data-flow change |
|---|---|---|---|
| `175-NIGHTLY-MT5-DERIVE-CHECK` | **Root of "cause unread" found:** both claim RPCs (`claim_compute_jobs_with_priority` and `claim_compute_jobs`, latest bodies in `20260927120000_claim_pair_pre_rank_exclusion.sql`) set `last_error = NULL` and `error_kind = NULL` on every re-claim (comment "M-1137/M-1138"). `reset_stalled_compute_jobs` writes `last_error = 'worker_stalled'` and the next claim erases it. So a `done` job with `attempts=2` can never show what attempt 1 hit. **⛔ The clearing is deliberate and pinned twice:** that migration's own post-apply self-verify raises unless the claim body matches `last_error\s*=\s*NULL`, and `supabase/tests/test_compute_jobs_rpc_error_clear_and_fanin.sql` gates it. | MOD + **MIG** (re-base the claims on `20260927120000_claim_pair_pre_rank_exclusion.sql` and `mark_compute_job_failed` on `20261024120000_fan_in_graph_and_decision_cascade.sql`) | **Keep the clear; add history.** Copy the outgoing `last_error`/`error_kind` into an append-only per-attempt record (for example a `metadata` array; the claim already merges `metadata` with `COALESCE(metadata,'{}') \|\|`) before it is cleared, or have `mark_compute_job_failed` and `reset_stalled_compute_jobs` append it. Then read the real root cause from PROD after a few nights. |
| `202-MT5-CLOCK-LEAD-01` | `services/mt5_server_clock.py` `resolve_mt5_server_clock()`, and `mt5_server_clock_readings` (migration `20261117120000`) | MOD (test or replay only) | None unless confirmed. Closing means a replay under both clock settings. |
| `164.6.6.2.3-EMPTY-COHORT0-REFUND` | `nav_twr.py` `_judged_cohorts` | MOD | Changes published MT5 returns on re-funded days |
| `164.6.6.2.3-INCEPTION-DAY0-PNL` | `nav_twr.py` `chain_linked_twr` inception skip | MOD | Counts or documents a dropped day-0 P&L |
| `164.6.6.2.3-D15-THRESHOLD-BAND` | `nav_twr.py` `FLOW_TIMING_LARGE_RATIO` | MOD or record-accepted | Founder D-15 choice; may close as accepted in CONTEXT |
| `164.6.6.2.3-MT5-BASIS-SILENT-NONE` | `job_worker.py` `_native_key_usd_writer_basis` (returns None on several branches, caller skips with no log) | MOD | Adds a counted warning or block. **Same data contract as HOLDINGSTRUTH's `167.1.2.2.1-WRITER-BASIS-VALUES`** (reader: `allocator_equity_derive.py` `read_writer_basis`). Do both in one phase. |
| `167.1.2-MT5-FAILING-HOLDER` | `account_identity.py` `_find_live_holder` / `_stamp` | MOD | **This is an S4 identity member, not a derive member.** Move it to the 225 phase. |

**Gate:** the root-cause half of `175` needs real nights of data after the first-attempt error is preserved. Any `nav_twr.py` change moves MT5 numbers, so it lands before 155.2 plan 12's recapture or after plan 14, never between (see 155.2 below).

#### BYBITREADS (4 entries)

| Member | Integration point | New / mod | Notes |
|---|---|---|---|
| `167.2.1.1-DERIVE-USDT-ONLY-ANCHOR` | `services/exchange.py` `fetch_usdt_balance_with_status` (derive anchor) against `fetch_account_equity_and_upnl_usd` / reconstruct anchor, pinned by `test_coin_coverage_bybit_derive_reads_usdt_only_while_reconstruct_sums_every_stable_coin` | MOD | Flipping the pin is the intended RED-first test. The anchor feeds `key_inputs.anchor_usd` (S1 to S2). |
| `167.2.1.1-BYBIT-POSITIONS-USDT-LINEAR-ONLY` | `services/positions.py` `_fetch_positions_bybit` (`{"category": "linear", "settleCoin": "USDT"}`) | MOD | Bybit v5 `position/list` needs `symbol` or `settleCoin` for `linear` and takes `inverse` as its own category, so the fix iterates USDT and USDC settle coins plus `category=inverse` (Bybit docs, LOW tier via the seam, consistent with the repo's own RESEARCH). |
| `167.2.1.1.2.1-STRATEGY-BYBIT-7DAY` | `exchange.py` `_fetch_raw_trades_bybit` (start-only first page, no `endTime`) | MOD | Bybit's execution-list docs say a start-only request answers start to start+7 days, which confirms the repo's assumption A7. Fix shape already exists in the allocator rebuild's windowed reader: 7-day windows with an explicit end. Measure first with a counts-only probe. |
| `186-BYBIT-ONCHAIN-DEPOSIT-UNVERIFIED` | `services/bybit_unified_flows.py` `fetch_bybit_unified_flows` and the flow-source `replace` verdict; probe `analytics-service/scripts/derivegaps_probe.py` | MOD after probe | **This is a flow-source member.** It belongs with 223's flow-source half. 223's booked text keeps the anchor and positions entries out of 223, which is a decision, so only this member moves. |

**Gate:** the founder action `167.1.2.2-BYBIT-STATIC-EGRESS` (static egress IP allow-list) stops the Bybit owner's derive from failing daily. Until then, live Bybit verification of any fix is partly blind.

#### OKXTRADES (3 entries)

| Member | Integration point | New / mod |
|---|---|---|
| `167.1.2.2.2.1-OKX-DAILY-PNL-MIXED-CCY` | `exchange.py` `fetch_daily_pnl` OKX branch (sums pnl+fee per day, no currency check) | MOD |
| `167.1.2.2.2-OKX-PERSISTENT-TRUNCATION` | `exchange.py` `OKX_BILLS_PAGE_CAP`, `_okx_bills_fetch_with_backoff`; flag `daily_pnl_truncated_okx` in `job_worker.py` | MOD (trigger not fired; first check whether phase 167.1.2.2.2.1 OKXHISTORY already closed it) |
| `167.1.2.2.2-LAST-FETCHED-TRADE-TS-AHEAD` | `job_worker.py` `run_sync_trades_job` (reads `last_fetched_trade_timestamp` as `preferred`; advances only through `advance_fetched_cursor`) | MOD. **Shares `run_sync_trades_job` with 222's `SYNCTRADES-ENQUEUE-DONE`.** |

#### DERIBITBOOK (3 entries) and the Deribit stale-returns observation

| Member | Integration point | New / mod | Gate |
|---|---|---|---|
| `185-BOOK-CUMULATIVE-UNEXPLAINED` | Deribit branch of `run_derive_broker_dailies_job`; `services/deribit_txn.py`, `services/native_nav.py`, `services/deribit_ingest.py` | Diagnose first (start from the 185-01 debug session and plan 10's `sc4-book:` lines) | Founder |
| `189-OPTIONREPLAY-NEXT-MILESTONE` | `LedgerValuationError` raised in `nav_twr.py` / `deribit_ingest.py`; spec is the archived v1.20 `### Phase 189` section | MOD | **Founder approval for each worker run.** Must not turn on `SMOOTHED_MTM_ENABLED` (GLB-1 is not triggered). |
| `L2219` (correction residual) | `deribit_txn.py` per-row correction classifier (substring capital denylist) | MOD | None |
| **Deribit stale returns (new, undiagnosed)** | Key-mode exits of `run_derive_broker_dailies_job` that end `DispatchOutcome.DONE`. At HEAD there are three DONE returns in the function. The two key-mode ones both run `_run_key_mode_compose_epilogue` (which upserts `allocator_equity_derived` kind `key_inputs:<api_key_id>` with the fresh `flows` and anchor), but write returns to `csv_daily_returns` differently. **Candidates, none confirmed:** (a) the `<2-day` short-circuit, which upserts at most the measured mark-day rows and then runs `_stale_day_delete` over `_calendar_days_absent_from(...)`, so an idle key's flows advance while its returns do not; (b) the `>=2-day` exit's `returns.dropna()`, where days guarded out by the tiny-base, dust or negative-NAV rules leave no row (by design, but then it must be named); (c) the reconcile deletes (`_reconcile_span_delete`); (d) which of the account's keys the compose reads. 90 `done` derives in 30 days is three a day, which fits one account read through three keys, and the only holder logic inside the derive at HEAD is the MT5 terminal holder registry, so no Deribit-side holder gate decides which key writes returns. Check whether every key writes its own rows and which key's rows the compose consumes. The compose then sees a flow after the last return day and raises `out_of_window_flow` (`allocator_equity_derive.py`). | **Diagnose-first** (`/gsd-debug` before planning). The fix is MOD in S1 and possibly a named flag in S2. | Read-only PROD reads for the one key |

**Recommendation:** one Deribit phase (DERIBITBOOK plus stale returns), diagnose-first, sequenced **after** MT5DERIVE2's S1 edits merge, because candidate (a) is the shared key-mode exit MT5 also uses.

#### HOLDINGSTRUTH (5 entries)

| Member | Integration point | New / mod |
|---|---|---|
| `170.4-IDENTITY-READ-COMPLETENESS` | `src/lib/latest-holdings-per-key.ts` `keyAccountOf` (falls back to `key:${keyId}`), `src/lib/portfolio-exposure.ts` `fetchHoldings` | MOD |
| `170.4-MATCH-UNPRICED-PER-KEY` | `analytics-service/routers/match.py` per-key `unpriced_days` drop | MOD (needs an account-level max marker day, which needs the identity key S4 defines) |
| `170.4-DASHBOARD-MARKER-READ-SILENT` | `src/lib/queries.ts` dashboard caller of `fetchLatestHoldingsPerKey` (*triage-cited*); `markerReadError` is consumed only in `src/app/api/allocator/scenario/commit/route.ts` | MOD |
| `198-SHARED-ACCOUNT-FALLBACK-UNNAMED` | `src/app/(dashboard)/allocations/components/MissingDataMessage.tsx` (consumer) and the producer `src/app/(dashboard)/allocations/lib/key-data-gaps.ts` (must emit attributed key ids) | MOD, producer first |
| `167.1.2.2.1-WRITER-BASIS-VALUES` | `allocator_equity_derive.py` `read_writer_basis` (calendar-only gate) | MOD. Move it next to MT5DERIVE2's writer half. |

**Dependency:** "one account counts once" reads the identity model. S4 (225 plus `L4105`) can change what `venue_account_id` holds for MT5 (login only today, no server). Land HOLDINGSTRUTH's read changes after S4 settles the identity value, or they get rewritten.

#### NOCAPITAL (4 entries)

All in S2: `run_derive_allocator_equity_job` no-capital branch, `allocator_equity_derive.py` (`key_inputs_mismatch` residue on candidate fallback), `equity_reconstruction.py` `_NO_CAPITAL_ANCHOR_REASONS`. The `no_capital_exit_refused` token suggested by `166.3.1-NOCAP-FALLBACK-TRACE` has 0 hits at HEAD (NEW log token). `166.3.1-NOCAP-NONNAV-EXCEPTIONS`: the revert arms catch `NavReconstructionError` only (MOD). No migration. Python only. **This is an allocator book path, not composite work**, so the composite ruling does not remove it.

#### JOBHEAL (5 entries)

| Member | Integration point | New / mod |
|---|---|---|
| `L4282` wizard first-hop drop | The dropped-enqueue sweep is an inline `cron.schedule` command, registered in `20260816140000_reconcile_dropped_enqueue_sweep.sql` and re-registered in `20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql`. It declares the wizard first-hop drop not covered. | **NEW MIG** with its own signal (api_key present, no job ever, longer grace) and false-positive analysis |
| `L2244` silent readmit give-up | Same sweep command (the ceiling), plus `main_worker.py` `dispatch_tick`'s reconcile-sweep capture, keyed on the heal | **MIG** plus MOD. Founder decision: audit row vs external alert |
| `164.2-RECLAIM-PROVENANCE` | `reclaim_stuck_compute_jobs` (latest: `20260516104201_compute_jobs_audit_2026_05_07_residual.sql`) requeues without `PERFORM sync_strategy_analytics_status` (latest: `20261105120000_sync_status_protect_refused_derive.sql`) | **MIG** |
| `166.5.1-DERIVE-BATCH-RESET-RESIDUAL` | `main_worker.py` `WATCHDOG_PER_KIND_OVERRIDES` plus the claim's single `claimed_at` per batch | NEW lease or heartbeat (**MIG** for a renew RPC). Trigger not met; latent |
| `FANOUT-COHORT-SIBLING-POLL-01` | `enqueue_poll_positions_for_all_strategies` (latest: `20260412094449_compute_jobs_admin_and_defer.sql`), called by `main_worker.py` `daily_enqueue_tick` | **⛔ Conflicts with 224, see below** |

**⛔ Unresolved contradiction (Rule 7), blocking for both JOBHEAL and 224.** 224's owned entry ("Retired job kinds still carry a live daily enqueue that has fired nothing since 2026-06-14") says no `poll_positions` job has been created on PROD since 2026-06-14 and asks to retire the enqueue. `FANOUT-COHORT-SIBLING-POLL-01` says the same fan-out "IS live", that every published strategy's position snapshot is current, and proposes widening its two conjuncts. Both cannot be true. This research could not read PROD and does not pick. **Put `FANOUT-COHORT-SIBLING-POLL-01` in, or after, 224, and gate both on one read-only PROD count of `compute_jobs` kind `poll_positions` by day.** If the enqueue is dead, 224 retires it and the cohort entry closes as moot. If it is live, 224 must not retire it, and the cohort widening is decided on a fresh measurement of both conjuncts.

#### FIGUREMATH (4 entries)

| Member | Integration point | Gate |
|---|---|---|
| `194-ENGINE-CONSTANTS` | `src/lib/factsheet/compute.ts` (`days / 365.25`), `src/lib/scenario.ts` (365.25 calendar clock), also `src/lib/figure-gate.ts`, `src/lib/closed-sets.ts`, `src/lib/factsheet/record-length.ts`, `src/lib/factsheet/og-metrics.ts`; Python `services/metrics.py` (365, `ddof=1`) | **Founder decision** on which constants win. The scenario math is frozen by SCENARIO-05 / BODY-02 regression pins, which must move in the same PR. |
| `QUANTSTATS-0086-REDERIVE-01` | `analytics-service/requirements-dev.txt` pin and `requirements.txt`, `.github/dependabot.yml` ignore for `quantstats` | A version bump means a **fleet re-derive** of stored figures |
| `L2214` | `analytics-service/routers/portfolio.py` `_compute_portfolio_analytics` (its own stack; also imported by `routers/cron.py`, `services/portfolio_limits.py`, `job_worker.py`) | Composite half excluded. Shares `portfolio.py` with 222's benchmark label. |
| `167.1.2.2.1-CAGR-EMPTY-SPAN` | `services/metrics.py` CAGR (mean × periods over all days) | None |

**Gate:** FIGUREMATH moves published numbers on every surface, MT5 included. Hold it until after 155.2 plan 14, or land it before plan 12's recapture with the founder's constant decision in hand.

### User-facing

#### FACTSHEETHONEST (5) and SURFACECACHE (4): one factsheet seam

| Member | Integration point | Notes |
|---|---|---|
| `190-RERUN-SURFACES-NOT-HOLDING` | `isRecomputeOverStoredResult` is used in the strategy-review route, `queries.ts`, closed-sets, strategyGate, `fetch-and-build-payload.ts`, headline-basis; **0 uses in `src/app/api/og/factsheet/[id]/route.tsx`** | MOD |
| `170.3-OG-NOTFOUND-CACHE` | Same OG route: `LONG_CACHE_CONTROL` on every non-failed render, including a real not-found | **Same file as 190.** One plan, or strictly sequential. |
| `164.6.6.2.1-USDVIEW-READFAIL-CACHED` | `src/lib/factsheet/fetch-and-build-payload.ts` returns `usdViewUnavailable` `price_read_failed` as a normal payload; `src/app/factsheet/[id]/v2/page.tsx` skips the cache only for `conventionsDegraded` | MOD |
| `164.6.6.2.1-OWNER-TRUST-TIER-UNPUBLISHED` | `v2/page.tsx` calls `readPublicVerificationSignals` (published-only) | MOD (an owner-scoped read) |
| `201.1-COMPOSER-RANGE-AS-DATES` | `src/app/factsheet/[id]/v2/factsheet-context.tsx` `userRange` as `[number, number]` axis indices | MOD (founder already decided "book a fix") |
| `164.6.6.2.1-DISCOVERY-RANKING-HONESTY` | `src/lib/queries.ts` ranking plus `StrategyTable.tsx` chip; rank, sort and percentiles are unit-blind | Trigger: first published native-unit strategy (PROD count needed) |
| `164.6.6.3.3-WITHHELD-RESIDUE` | Three founder-deferred D6 items (Worst 10 Drawdowns, EOY/Calmar by year, Style Drift KS) | Founder |
| `166.5-COMPUTED-AT-NEVER-COMPUTED-DEFAULT` | `strategy_analytics.computed_at DEFAULT now() NOT NULL`; `src/lib/types.ts` `computed_at: string` | **MIG** and a **founder decision** first (it reverses CONTEXT R-04). Every freshness reader keys on `computed_at`. |
| `170.1-STRATEGIES-NOTE-WAIT-WORDING` | `src/lib/status-surface-copy.ts` `MINT_TOKEN_NOTES.not_available` | MOD (copy) |

**Also touching this seam:** DBACCESS `RANK-SPLAT-01` edits the `metrics_json_by_basis` whole-column select in `fetch-and-build-payload.ts`. Run it in or right after the factsheet phase.

**Recommendation:** merge FACTSHEETHONEST and SURFACECACHE into one phase with a single owner for the OG route and for `fetch-and-build-payload.ts`.

#### CONNECTTRUTH (6): split by seam

- **Identity members go to 225** (S4): `167.1.2-DRAFT-CLASH-SAYS-SO` (the `venueMatch.kind === "draft"` arm that answers 200 `deduped: true` with no message), `L4097` (`resolveByVenueIdentity` short-circuits on `venue_account_id` before `validateKey`, so a rotated MT5 password reconnect reports success and stores nothing), `L4105` (MT5 identity is the login with no server qualifier: **MIG plus backfill on `api_keys.venue_account_id`**), `167.1.2-ORPHAN-COPY-FIX` (`keyOrphanedResponse()` takes no parameters). All four are in `create-with-key/route.ts`, the file 225 rewrites.
- **The rest stays user-facing:** `L2510` (`analytics-service/routers/exchange.py` raises `HTTPException(400, detail=MT5_WRONG_SERVER_DETAIL)` with no `code` field) and `170.1-CSV-ODD-SPELLING-REJECTED` (`services/csv_validator.py` month-name check). **`csv_validator.py` is also edited by 222** (its "contact support" string).

#### RATELIMITFAIR (2)

`src/lib/ratelimit.ts` `publicIpLimiter` (10/min/IP) against `analytics-service/routers/process_key.py` `_PROCESS_KEY_ANON_LIMIT` and the single `ANON_PAYLOAD` bucket in `services/rate_limit.py`; `csvValidateLimiter` (20/min) against the tenant bucket in `process_key.py`, with a stale docblock in `ratelimit.ts`. `publicIpLimiter` is also used by the factsheet-share, scenario-share, BTC benchmark and tearsheet PDF routes, so retuning it moves those too. **Founder call first** (per-IP anon tier, or raise the shared tier). No migration. Isolated: safe to run in parallel with anything.

#### Carried 222 ALERTTRUTH

`supabase/schema/functions/computation_error_copy.sql` arms (latest migration: `20260826120000_computation_error_curated_copy.sql`, **MIG**); `services/csv_validator.py`, `job_worker.py` and `routers/portfolio.py` strings; `routers/portfolio.py` `BENCHMARK_NOTE_STALE` mapping; `job_worker.py` `run_sync_trades_job`'s `_mark_analytics_failed` then `DispatchOutcome.DONE`. It shares `run_sync_trades_job` with OKXTRADES, `csv_validator.py` with CONNECTTRUTH, and `portfolio.py` with FIGUREMATH `L2214`. Different symbols in each case, so a parallel run is safe if each plan's write scope is listed by symbol.

### Security

#### SECRETSHYGIENE (4)

| Member | Integration point | Gate |
|---|---|---|
| `158-OPS-03` (HIGH) | Two demo auth accounts (their values sit in public history; the entry names the commits, never the values). Founder ruling: the accounts are unused, so **disable or delete them**, and remove any remaining literals from the tree. | **PROD auth write**, plus the same on TEST. Deleting the accounts makes the history copies dead, so no history rewrite is needed. The literals must never be quoted in a CHANGELOG, PR body or TODOS entry. |
| `SECRETSCAN-FULLHISTORY-01` | **NEW** scheduled workflow under `.github/workflows/` running gitleaks over full history | **Depends on `.planning/WINDOWS.md` entry 61**: a full-history scan finds 37 credential-shaped fixture literals in CHANGELOG prose today, so the new workflow is red on day one unless those are triaged first |
| `164.8.4-REDACT-NO-POSITIVE-SCAN` | `.github/workflows/test-restore-from-baseline.yml`, six diagnostic channels redacted by `sed` only | Founder said "no phase" on 2026-09-19; the 2026-11-23 "all MEDIUM+" ruling supersedes it. Record that. |
| `167.1.2.2.2-CRON-TICK-RESIDUALS` | `cron_sync_tick()` and `ops_staleness_check()` (`.up.railway.app` wildcard host, spaces-only `btrim`) | **MIG on S5, shared with ALERTREADERS** |

#### DBACCESS (6)

| Member | Integration point | New / mod |
|---|---|---|
| `RANK-SPLAT-01` | `fetch-and-build-payload.ts` whole-column `metrics_json_by_basis` select (and an anon grant if the column is narrowed) | MOD, possibly **MIG** |
| `L2267` | `api_keys` has no BEFORE INSERT `user_id` trigger (only `enforce_api_keys_published_composite_integrity`) | **MIG** on `api_keys`, **the table 225 changes**. Land after 225. |
| `TRIGGERREVOKE-LOCKHOLD-01` | No `ALTER ROLE anon/authenticated SET statement_timeout / idle_in_transaction_session_timeout` exists | **MIG**, role-level. Must first be measured on TEST, to show PostgREST honours it and no legitimate request needs longer. A wrong value breaks every client request on PROD with no human stop. |
| `170.6.1.1-API-KEY-ID-OPTIONAL-OWNER-GUARD` | `src/lib/types.ts` optional `api_key_id` | MOD (types) |
| `L2120` | `src/__tests__/audit-coverage.test.ts` `H_0001_UNCOVERED_ALLOWLIST` (six unaudited routes) | MOD, one judgment per route |
| `158-OPS-03`@`discovery-watchlist` | `e2e/discovery-watchlist.spec.ts` is referenced by no workflow | MOD `ci.yml` (wire it into a seeded lane) |

#### Carried 221 SENTRYSCRUB2 and SENTRYHELD

- 221: `src/instrumentation.ts` `scrubSentryEvent` (no arm for `extra.__serialized__`); direct `Sentry.captureException` sites that bypass `scrubCaptureInput` in `src/app/error.tsx`, `src/app/global-error.tsx`, `src/app/api/alert-digest/route.ts`, `src/app/api/cron/ops-alert/route.ts`, `src/app/api/cron/founder-lp-report/route.ts`, `src/app/api/preferences/route.ts`, `src/app/api/for-quants-lead/route.ts`, `src/lib/admin.ts`, `src/lib/preferences.ts`, `src/lib/audit.ts`, `src/lib/for-quants-leads-admin.ts`; **NEW** `src/instrumentation-client.ts` (does not exist at HEAD) only after the scrub; `src/app/auth/callback/route.ts` error-code log.
- SENTRYHELD: `src/lib/queries.ts` `failAnonRead` and `src/app/(marketing)/page.tsx` `getSocialProofStats`. **Caller-only.** `captureToSentry` already returns a promise ("SOURCE-COMPATIBLE BY DESIGN"), and `shouldCaptureNow` already exists in `src/lib/sentry-capture.ts`. The module must not import `next/server` because six client components import it, so `after()` lives at the call site. No signature change, so **no file conflict with 221**. It can fold into 221 as one plan, or run alone.
- **ALERTPAGE is not part of this seam.** It is the Python SDK path (`analytics-service/services/ops_alert.py`). The suspected three-way Sentry overlap (221 / ALERTPAGE / SENTRYHELD) is a shared theme, not a shared file.

### Observability

#### ALERTPAGE (7) and ALERTREADERS (5): one alert seam, two layers

| Member | Integration point |
|---|---|
| `164.6.8-F3-SENTRY-HALF-NOOP` | `services/ops_alert.py` `sentry_ok = event_id is not None` (no ERROR log when None; no startup ERROR for an unset DSN) |
| `164.6.8-WR-R4-01-SENTRY-CREDIT-INSIDE-RULE-INTERVAL` | `ops_alert.py` `sentry_counts = sentry_ok` (no per-fingerprint last-credit time) |
| `164.6.8-R4-SFH-F1-DUPLICATE-RECOVERY` | `services/mt5_outage_alert.py` `_durable_recovery_request` guarded only by `_DURABLE_CHECKED` and `_RECOVERY_TASKS` (no in-flight set) |
| `164.6.8-WR-D16-01-PROBE-BOUND-INLINE-CLOSE` | `mt5_outage_alert.py` `_finish_recovered` runs inline; `services/mt5_validation_liveness.py` `PROBE_TICK_BOUND_S` comment |
| `164.6.8-WR05-ALERT-PATH-HANDLERS-AT-WARNING` | `mt5_outage_alert.py` paging handlers log at warning |
| `164.6.8-N2-OPEN-RECORD-FAILS-AT-WARNING` | `services/ops_alert_open.py` `record_open_page` failures at warning |
| `164.6.8-F4-WR03-DEBT-PAGE-NEVER-ENDS` | `services/mt5_relogin.py` settled notice decided by `debt_owed_at_start` |
| `164.6.8-F6-SCRUB-READER-NEWEST-ONLY` + `N3` | `mt5_validation_liveness.py` `_read_newest_scrub_row` (`limit(1)`) and `ops_alert.py` `_admit_through_window` keyed on (source, cause, event). Fix them together. |
| `164.6.8-F5-READER-DELIVERY-UNOBSERVED` | `ops_staleness_check()` never reads `net._http_response` (**MIG, S5**) |
| `164.6.8-WR06-CRON-SYNC-ERRORS-PAGE-ON-PER-KEY-FAULTS` | `ops_staleness_check()` `v_cs_errs >= 2` plus `routers/cron.py` `_cron_sync_heartbeat_row` (**MIG, S5**, new stamp) |
| `L2255` | *Triage-cited:* no health check for the match-engine pg_cron job (`src/app/api/cron/` and `vercel.json` not re-read); the natural home is a new arm in `ops_staleness_check()` (**S5**), plus `scripts/prod-prober/cron-manifest.json` |

**S5 rule:** ALERTREADERS' three SQL members and SECRETSHYGIENE's cron residual all `CREATE OR REPLACE ops_staleness_check()`. **SECRETSHYGIENE goes first and closes the wildcard destination in both functions** (`cron_sync_tick` and `ops_staleness_check`) in one migration, because it is the security fix and must not wait for a wave-4 alert phase. The alert phase then re-bases its F5, WR06 and `L2255` arms on that body. Never two open PRs each carrying a full copy of the function.

#### MT5WEDGE

`MT5-SWITCH-WEDGE-CAUSE-01`: **live-gated**. It needs a real -10005 wedge captured before the auto-recycle erases it. There is no code integration point to plan against, so it sits outside the phase order and is not a blocker.

### CI and tooling

| Group | Integration points | Notes |
|---|---|---|
| **SQLGATES2** | `src/lib/anon-strategies-projection.test.ts` `ANON_ROUTE_DIRS` against `src/proxy.ts` `PUBLIC_ROUTES`; `supabase/tests/test_strategies_anon_grants.sql` `v_hidden_column_exemptions`; `supabase/tests/test_strategy_analytics_trade_fetch_provenance.sql` (no authenticated-UPDATE arm); `.github/workflows/supabase-migrate.yml` `apply-test` "applied ZERO migrations" refusal; migration `20260907130000_ledger_refresh_switch_to_system_flags.sql` comment drift | **Internal order:** the comment drift is corrected *forward*, with a new migration or a `COMMENT ON`, never by editing the applied file. An edit to an applied file is exactly the zero-applied push that apply-test refuses, and that refusal is the `164.8-APPLYTEST-CANNOT-TELL-SEEDED-FROM-APPLIED` member. New SQL gate arms move the mutation and lint censuses (`scripts/mutation-floors.mjs` by symbol, the `sql-gate-lint` self-test). |
| **TESTLANES** | `scripts/live-db-execution-ledger.txt` (`ENTRY_COUNT`); `src/__tests__/wizard-rpcs-live-db.test.ts` and `src/__tests__/sanitize-user-rpc.test.ts`; `analytics-service/tests/live_db_transport.py` `_NON_IDEMPOTENT_BUILDER_METHODS`; `package.json` `lint` (`eslint --cache`) plus `ci.yml` cache `restore-keys`; PROD supautils crash measurement | The six wizard RPC failures come from the function body's own role gate, so they may need a **MIG** or an invariant decision. The supautils reading needs PROD Postgres logs over MCP (read-only), not SQL. |
| **MT5SOAK** | `analytics-service/scripts/mt5_soak.py` only (`USD_FLOORS`, the timed-day check, the per-day attribution) | Isolated file. **Recommended before MT5DERIVE2's `nav_twr.py` edits** so the soak is an independent oracle when they land (money-math oracles must be independent invariants). |

### Carried phases

| Phase | Integration and gate |
|---|---|
| **155.2 LIVEPARITY** | Open plans 11 to 14 are all `autonomous: false`. Plan 11 waits for the founder's broker statements. Plan 12 takes a **fresh sealed PROD capture after this phase's fixes are deployed and each founder strategy is recomputed**. Plan 13's surface checklist is bound to `computed_at` from that recapture. Plan 14 is the founder's exits. **Freeze window:** any change that moves MT5 numbers for MM2, MM3 or FX-AI_V (MT5DERIVE2's `nav_twr.py` members, FIGUREMATH, 225's resolution of the MM3-publishes-MM2 duplicate, NOCAPITAL if an MT5 key is no-capital) must merge before plan 12's recapture or after plan 14. A merge in between voids plan 13's binding. |
| **157 FOUNDER-CONFIRM** | Founder sitting in the same session as 155.2. `157-03`'s password rotation comes after 155.2's last live read. No code. |
| **221 / 222** | See above. 222 carries a MIG. |
| **223 FLOWKINDS** | **The booked ROADMAP text is stale against the founder ruling.** Its Goal sentence and SC-1/SC-2 (`run_stitch_composite_job` reading Bybit flows; the composite member read refusal) are composite work and are out. What remains: `186-OTHER-FUNDING-CALLERS-DROP` minus its composite caller, which is `run_sync_funding_job` (`job_worker.py`) and `services/okx_archive_job.py`, each calling a `services/funding_fetch.py` fetcher whose default is `on_malformed="drop"`; `186-REALIZED-MALFORMED-COUNT` (`daily_pnl_malformed_<venue>` flags read in `services/analytics_runner.py`; a read-only PROD count, then a founder ruling). Add BYBITREADS' `186-BYBIT-ONCHAIN-DEPOSIT-UNVERIFIED` as the flow-source member. `180-BYBIT-LIVE-FLOW-KINDS` and `186-COMPOSITE-MEMBER-READ-GAPS` are composite-only and go to the delete list. The triage classed them so, and HEAD agrees for 180: the entry itself says `run_derive_broker_dailies_job` already reads Bybit flows through `fetch_bybit_unified_flows`, and the per-key derive's remaining `fetch_ccxt_transfers` calls sit in the non-Bybit `else` arm of its `venue == "bybit"` branch; the other non-composite caller is `okx_archive_job.py` (OKX). The only Bybit reader left on on-chain kinds is `run_stitch_composite_job`. **No stitch or composite file is an integration point anywhere in this milestone.** The roadmapper must rewrite 223's Goal and SC-1/SC-2, rather than carry them in. |
| **224 DEADLEFTOVERS** | `get_admin_compute_jobs` (**MIG** DROP; still in `src/lib/database.types.ts`); `main_worker.py` `daily_enqueue_tick` and `enqueue_poll_positions_for_all_strategies` (**see the FANOUT contradiction**); `compute_job_kinds` rows (MIG, only after a read-only PROD count shows no queued row of that kind); `managerSideKeyIds` and `excludedManagerSide` in `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` and `src/app/(dashboard)/allocations/lib/live-holdings-summary.ts`; the `database.types.ts` freshness rule |
| **225 ONEACCOUNTONCE** | S4 owner. Absorb CONNECTTRUTH's four identity members and `167.1.2-MT5-FAILING-HOLDER`. Possible **MIG** (a per-owner refusal on `api_keys`, the `L4105` backfill). A read-only PROD duplicate count goes to the founder first. |

## Gate table (what code alone cannot clear)

| Group or member | Gate kind | What it waits on |
|---|---|---|
| 155.2 | Live and founder | Broker statements (plan 11), recapture after fixes deploy (plan 12), signed-in browser read (plan 13), written rulings (plan 14) |
| 157 | Founder sitting | Same sitting as 155.2; `157-03` after 155.2's last live read |
| MT5WEDGE | Live | A real -10005 wedge captured before the auto-recycle |
| `175` root cause | Data | Nights of preserved per-attempt errors after JOBLEDGER deploys |
| `202-MT5-CLOCK-LEAD-01`, `D15-THRESHOLD-BAND` | Founder | Assignment; D-15 may close as accepted |
| BYBITREADS (all), `186-BYBIT-ONCHAIN-DEPOSIT-UNVERIFIED` | Founder action and probe | Static egress IP allow-list (`167.1.2.2-BYBIT-STATIC-EGRESS`); read-only probes before any fix |
| `167.1.2.2.2.1-OKX-DAILY-PNL-MIXED-CCY`, `OKX-PERSISTENT-TRUNCATION` | Trigger not fired | A non-USDT bill or a live truncation (check whether OKXHISTORY closed it first) |
| DERIBITBOOK `185`, `189`; Deribit stale returns | Founder and diagnosis | Debug session first; founder approval per worker run for 189; GLB-1 stays off |
| `194-ENGINE-CONSTANTS`, `QUANTSTATS-0086` | Founder | Which constants win; a fleet re-derive window |
| `L2244` | Founder | Audit row or external alert |
| 225 and `L4097` | Founder | Read-only PROD duplicate count; the product call on a rotated-password reconnect |
| `L4105` | PROD backfill | MIG plus backfill of `api_keys.venue_account_id` |
| `170.4-IDENTITY-READ-COMPLETENESS` | Trigger not fired | Next `/allocations` data phase (reachable only if the FK is bypassed) |
| `166.5-COMPUTED-AT-NEVER-COMPUTED-DEFAULT` | Founder | Reverses CONTEXT R-04 |
| `164.6.6.3.3-WITHHELD-RESIDUE` | Founder | The three deferred D6 items |
| `164.6.6.2.1-DISCOVERY-RANKING-HONESTY` | Trigger | First published native-unit strategy (PROD count) |
| `SYNCTRADES-ENQUEUE-DONE` (222) | Founder | Behaviour decision; the 161.1 F1 remedy does not transfer as-is |
| `170.1-CSV-ODD-SPELLING-REJECTED` | Founder | Accept, or parse month names |
| RATELIMITFAIR | Founder | Per-IP anon tier, or raise the shared tier |
| `158-OPS-03` | PROD and TEST auth write | Disable or delete the two demo accounts |
| `SECRETSCAN-FULLHISTORY-01` | Prior work | `.planning/WINDOWS.md` entry 61's 37 findings |
| `L2267` | Founder | Architecture decision; lands after 225 |
| `TRIGGERREVOKE-LOCKHOLD-01` | TEST measurement | PostgREST honours role-level timeouts |
| `170.6.1.1-API-KEY-ID-OPTIONAL-OWNER-GUARD`, `GATE-HIDDEN-EXEMPTIONS-UNENFORCED` | Trigger not fired | Latent; the first wildcard owner select or the first exemption |
| `LINT-CACHE-MASKS-WARNINGS` | Decision | Fix option undecided |
| `164.9-LIVEDB-LANE-EXECUTION-CENSUS` | Decision | MIG or invariant for the wizard RPC role gates |
| `164.4.2-PROD-SUPAUTILS-FUNCTION-DENIAL-CRASH` | PROD logs | Read-only Postgres log read over MCP |
| `FANOUT-COHORT-SIBLING-POLL-01` + 224 | PROD read | `poll_positions` jobs by day (contradiction above) |

## Architectural Patterns (apply to every group)

### Pattern 1: Preserve the first failure, then fix the root cause
**What:** Before fixing a fault that a retry heals, make the healed fault durable. At HEAD the claim RPC erases `last_error` on re-claim, which is why `175` is unreadable. The erase itself is a pinned invariant (M-1137/M-1138), so the history goes beside it, never in place of it.
**When:** MT5DERIVE2 `175`, JOBHEAL `L2244`, ALERTREADERS F5.
**Trade-off:** One migration on the hottest RPC in the system. Re-base on `20260927120000_claim_pair_pre_rank_exclusion.sql`, keep every clause its self-verify pins (the pre-rank exclusion, the M-1137 clear, the C39 guard, the `unified_backbone_at_claim` COALESCE), and carry that self-verify forward.

### Pattern 2: Refuse by name, keep the last good values (186 D-05)
**What:** A truncated or malformed read raises a named refusal (`_refuse_incomplete_read`, `_record_read_incomplete`, the `on_malformed="raise"` path) instead of storing a partial series as complete.
**When:** 223, OKXTRADES truncation, BYBITREADS 7-day window, the Deribit stale-returns outcome if (a) or (b) is confirmed.
**Trade-off:** A refusal on a published key withholds numbers. Where a published number changes, a founder ruling comes first.

### Pattern 3: Writer and reader of one contract change in one phase
**What:** `_native_key_usd_writer_basis` (writer) and `read_writer_basis` (reader) are one contract. So are `key-data-gaps.ts` (producer) and `MissingDataMessage.tsx` (consumer), and `api_keys.venue_account_id` (writer: `account_identity.py` and `create-with-key`) and `keyAccountOf` (reader).
**When:** MT5DERIVE2 with HOLDINGSTRUTH, and S4 with HOLDINGSTRUTH.
**Trade-off:** Larger phases, but no window in which the writer and reader disagree on PROD.

### Pattern 4: RED-first gate, restored from a byte backup
Every new gate is shown RED before it counts (milestone rule). SQL arms carry `RED-UNDER` annotations so `sql-mutation` bites them, and the floors move by symbol in `scripts/mutation-floors.mjs`.

## Data Flow (what changes)

```
exchange / MT5 terminal
   │ venue readers (exchange.py, positions.py, bybit_unified_flows.py, funding_fetch.py,
   │                deribit_txn.py, mt5_*)                    ◄── BYBITREADS, OKXTRADES, 223, DERIBITBOOK
   ▼
run_derive_broker_dailies_job  (S1)                            ◄── MT5DERIVE2, Deribit stale returns, 155.2
   ├─► csv_daily_returns (key or strategy)                     ◄── stale-returns candidates (a)(b)(c)
   ├─► strategy_analytics (via bridge sync_strategy_analytics_status)
   └─► allocator_equity_derived key_inputs:<key> {flows, anchor_usd, dropped_day_pnl, tiny_base_days, writer basis}
          ▼
run_derive_allocator_equity_job (S2)                           ◄── NOCAPITAL, writer-basis reader
          ▼
allocator curves → Holdings / match.py / dashboard              ◄── HOLDINGSTRUTH (identity from S4)
          ▼
factsheet payload / OG / Scenario (figure-gate, compute.ts, scenario.ts)  ◄── FACTSHEETHONEST, SURFACECACHE, FIGUREMATH

compute_jobs lifecycle (S3) wraps every arrow above            ◄── 175, JOBHEAL, 224
ops_staleness_check / cron_sync_tick (S5) watch the crons      ◄── ALERTREADERS, SECRETSHYGIENE
```

The only new data the milestone stores: per-attempt job errors (S3), possibly a per-owner identity constraint and an MT5 server-qualified `venue_account_id` (S4), a cron-sync per-key-fault stamp and an `_http_response` delivery reading (S5), and a nullable `computed_at` if the founder approves.

## Migration lane

Migrations auto-apply to PROD on merge with no human stop. Treat them as **one serial lane**: one migration-bearing PR open at a time, each re-picked from `origin/main`, each re-based on the latest definition of every function it replaces. Never add a data-reading `DO`-block guard; `scripts/lint-migration-data-dependence.mjs` refuses them, which matters for the `L4105` backfill.

| Group | Migration? | Functions or tables it replaces | Latest `CREATE OR REPLACE` at HEAD (checked by a case-insensitive, quote-tolerant grep over `supabase/migrations`; re-read the body before re-basing) |
|---|---|---|---|
| MT5DERIVE2 (`175`) | Yes | `claim_compute_jobs_with_priority` and `claim_compute_jobs` (keep the M-1137 clear), possibly `reset_stalled_compute_jobs` and `mark_compute_job_failed` | `20260927120000_claim_pair_pre_rank_exclusion.sql`, `20260516104201_compute_jobs_audit_2026_05_07_residual.sql`, `20261024120000_fan_in_graph_and_decision_cascade.sql` |
| JOBHEAL | Yes | `reclaim_stuck_compute_jobs` (and its call into `sync_strategy_analytics_status`), the sweep cron command, possibly a lease RPC | `20260516104201_compute_jobs_audit_2026_05_07_residual.sql`, `20261105120000_sync_status_protect_refused_derive.sql` (read only, called), `20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql` |
| 222 | Yes | `computation_error_copy` | `20260826120000_computation_error_curated_copy.sql` |
| 224 | Yes | DROP `get_admin_compute_jobs`; `compute_job_kinds` rows; maybe `enqueue_poll_positions_for_all_strategies` | both functions: `20260412094449_compute_jobs_admin_and_defer.sql` |
| 225 + `L4105` | Likely | `api_keys` constraint and `venue_account_id` backfill | the live-scoped partial UNIQUE's migration |
| SECRETSHYGIENE cron residual, then ALERTREADERS | Yes, in that order | `cron_sync_tick` and `ops_staleness_check` allowlist first; the alert arms of `ops_staleness_check` second | `20261010140000_cron_sync_tick.sql`, `20261020120000_ops_staleness_check.sql`; also update `scripts/prod-prober/cron-manifest.json` |
| DBACCESS | Yes | `api_keys` trigger, role-level timeouts, maybe an anon grant | measure timeouts on TEST first |
| FACTSHEETHONEST (`166.5`) | If approved | `strategy_analytics.computed_at` default | founder decision first |
| SQLGATES2 | Forward-only | comment correction for `20260907130000` | never edit the applied file |
| TESTLANES | Maybe | wizard RPC role gates | invariant decision first |
| NOCAPITAL, FIGUREMATH, OKXTRADES, BYBITREADS, MT5SOAK, SENTRYHELD, ALERTPAGE, RATELIMITFAIR, 221, 223 | No (expected) | n/a | n/a |

## Suggested build order

Founder order: data integrity, then user-facing, then security, then the rest. Dependencies override position inside a tier, never across it, except where noted.

**Wave 0 (now, parallel, no seam conflicts):** MT5SOAK (independent oracle for wave 1) · DERIBIT diagnose-only debug session (read-only) · the read-only PROD counts that gate later phases (poll_positions by day; same-owner duplicates; `daily_pnl_malformed_<venue>` per key; Bybit on-chain rows; published native-unit strategy count) · founder decisions queued: 194 constants, `L2244` signal, RATELIMITFAIR tiers, 155.2 statements.

**Wave 1, data integrity (S3 and S4 first, because later phases read their output):**
1. **JOBLEDGER** = `175`'s readable-first-failure half + JOBHEAL (`164.2-RECLAIM-PROVENANCE`, `L4282`, `L2244`, `166.5.1`). Owns S3. MIG. Its deploy starts the clock for `175`'s root cause.
2. **225 ONEACCOUNTONCE + CONNECTTRUTH identity members + `167.1.2-MT5-FAILING-HOLDER`.** Owns S4. Likely MIG. Before 155.2 plan 12 (it changes what MM3 publishes).
3. **MT5DERIVE2 (rest) + `167.1.2.2.1-WRITER-BASIS-VALUES`.** S1 (`nav_twr.py`, `_native_key_usd_writer_basis`) + S2 reader. No MIG. Before 155.2 plan 12, after MT5SOAK.
4. **223 FLOWKINDS (flow-source half, rewritten) + `186-BYBIT-ONCHAIN-DEPOSIT-UNVERIFIED`**, and in parallel **BYBITREADS (anchor, positions, 7-day)** and **OKXTRADES**. Different symbols of `exchange.py`, `positions.py`, `funding_fetch.py`, `okx_archive_job.py`; parallel-safe if plan write scopes are listed by symbol. OKXTRADES' cursor member shares `run_sync_trades_job` with 222.
5. **DERIBITTRUTH** = DERIBITBOOK + stale returns, after item 3 merges (shared key-mode exits).
6. **NOCAPITAL** (S2 only), parallel with 4.
7. **HOLDINGSTRUTH (reads)**, after 2.
8. **FIGUREMATH**, after 155.2 plan 14 unless the founder decides constants early. Fleet re-derive.

**Wave 2, user-facing:** **FACTSHEET** (FACTSHEETHONEST + SURFACECACHE, plus DBACCESS `RANK-SPLAT-01`) · **222 ALERTTRUTH** (MIG) · CONNECTTRUTH remainder (`L2510`, CSV month names; coordinate `csv_validator.py` with 222) · RATELIMITFAIR.

**Wave 3, security:** **SECRETSHYGIENE** (`158-OPS-03` first: PROD and TEST auth writes; full-history scan after WINDOWS 61; the destination allowlist in both `cron_sync_tick` and `ops_staleness_check`) · **DBACCESS** (rest; `L2267` after 225; timeouts after a TEST measurement) · **221 SENTRYSCRUB2 + SENTRYHELD**.

**Wave 4, the rest:** **ALERTS** (ALERTPAGE + ALERTREADERS; its S5 migration re-bases on SECRETSHYGIENE's) · **224 DEADLEFTOVERS** (+ the `FANOUT-COHORT-SIBLING-POLL-01` decision, gated on the PROD count) · SQLGATES2 (apply-test fix before the forward comment correction) · TESTLANES.

**Live- and founder-gated, outside the wave order:** 155.2 (statements, then plan 12 recapture after waves 1.2 and 1.3 deploy), 157 (same sitting; rotation after the last live read), MT5WEDGE (a real wedge).

### Merge into one phase

| Merge | Why |
|---|---|
| `175` readable-error half + JOBHEAL | Same lifecycle RPCs and `main_worker.py` |
| 225 + CONNECTTRUTH identity members + MT5 failing holder | Same route file and `account_identity.py` |
| MT5DERIVE2 writer basis + HOLDINGSTRUTH `WRITER-BASIS-VALUES` | One writer and reader contract |
| 223 (rewritten) + Bybit on-chain deposit | Both are the Bybit flow source |
| DERIBITBOOK + Deribit stale returns | Same venue branch, both diagnose-first |
| FACTSHEETHONEST + SURFACECACHE (+ `RANK-SPLAT-01`) | OG route and payload builder shared |
| ALERTPAGE + ALERTREADERS | `ops_alert.py`, `mt5_validation_liveness.py`, and the alert arms of `ops_staleness_check` (re-based on SECRETSHYGIENE's allowlist migration) |
| 221 + SENTRYHELD (optional) | Same theme; caller-only, so no conflict either way |
| 224 + `FANOUT-COHORT-SIBLING-POLL-01` | Same function, contradictory premises |

### Must stay separate (or strictly sequential) because they share a file region

- MT5DERIVE2 (S1) → DERIBITTRUTH: same key-mode exits in `run_derive_broker_dailies_job`.
- JOBLEDGER → MT5DERIVE2's `175` root-cause fix: the second needs data the first starts collecting.
- 225 → HOLDINGSTRUTH reads → DBACCESS `L2267`: identity value first, then readers, then the api_keys trigger.
- 222 ‖ OKXTRADES: both edit `run_sync_trades_job`. Parallel only with symbol-scoped write lists, otherwise sequential.
- SQLGATES2's apply-test fix → its comment correction.
- Any S5 migration after any other S5 migration (re-base).

## Anti-Patterns

### Anti-Pattern 1: Fixing the retry and losing the evidence
**What people do:** Make the MT5 derive pass on the first attempt by widening a timeout or a tolerance.
**Why it's wrong:** The claim RPC already erases attempt 1's error, so "fixed" cannot be told apart from "hidden".
**Do this instead:** Preserve per-attempt errors first, read a week of them, then fix the cause.

### Anti-Pattern 2: Editing an applied migration to correct a comment
**What people do:** Fix `20260907130000`'s contradictory comment in place.
**Why it's wrong:** The push applies zero migrations, apply-test exits 1, and the "re-run via workflow_dispatch" route bypasses the only check before PROD.
**Do this instead:** Correct it forward in a new migration.

### Anti-Pattern 3: Carrying a booked phase's text past a ruling
**What people do:** Plan 223 from its ROADMAP section as written.
**Why it's wrong:** SC-1 and SC-2 are composite work the founder removed.
**Do this instead:** Rewrite 223's Goal and success criteria to the flow-source half before planning.

### Anti-Pattern 4: Moving MT5 numbers inside the 155.2 freeze window
**What people do:** Merge a money-math fix while the parity recapture is being read.
**Why it's wrong:** Plan 13's checklist is bound to `computed_at` from plan 12's recapture.
**Do this instead:** Land before plan 12 or after plan 14.

## Scaling Considerations

Pre-revenue with no clients, so scale is not the constraint. What breaks first is contention, not load:

1. **First bottleneck: `run_derive_broker_dailies_job`.** One roughly 6,700-line function is the S1 seam for about six groups. Do not split it during this milestone (a refactor is not a hardening fix, Rule 3). Do list write scopes by symbol in every plan.
2. **Second bottleneck: the migration lane.** About ten groups may carry a migration, each auto-applying to PROD. One at a time.

## Integration Points

### External Services

| Service | Integration pattern | Notes |
|---|---|---|
| Bybit v5 | `exchange.py`, `positions.py`, `bybit_unified_flows.py` | Execution list: start-only means start+7d. Positions: `linear` needs `symbol` or `settleCoin` (USDT and USDC separately), and `inverse` is its own category. Static egress IP is a founder action. |
| OKX | `exchange.py` `fetch_daily_pnl`, `okx_archive_*` | Bills page cap; mixed-currency bills |
| Deribit | `deribit_txn.py`, `deribit_ingest.py`, `native_nav.py` | Option replay refusals need founder approval per worker run |
| MT5 gateway | `mt5_*` services, `account_identity.py` | Live-gated readings (155.2, MT5WEDGE) |
| Sentry (TS and Python) | `src/instrumentation.ts`, `src/lib/sentry-capture.ts`; `services/ops_alert.py` | Separate SDKs, no shared file |

### Internal Boundaries

| Boundary | Communication | Notes |
|---|---|---|
| derive writer ↔ compose reader | `allocator_equity_derived` `key_inputs:<key>` JSON payload (no version field; fields are additive) | New fields must stay optional for old rows |
| worker ↔ queue | `compute_jobs` RPCs | S3. Every RPC change is a MIG |
| connect route ↔ identity stamp | `api_keys.venue_account_id` plus share-link marker | S4 |
| pg_cron ↔ worker | pg_net POST to an allowlisted host | S5; a cron "success" only means queued |

## Sources

- Code at worktree HEAD `1c361e676` (direct reads; HIGH): `analytics-service/services/job_worker.py`, `main_worker.py`, `nav_twr.py`, `allocator_equity_derive.py`, `account_identity.py`, `exchange.py`, `positions.py`, `funding_fetch.py`, `ops_alert.py`, `mt5_outage_alert.py`, `mt5_validation_liveness.py`, `ops_alert_open.py`; `src/lib/sentry-capture.ts`, `src/instrumentation.ts`, `src/lib/queries.ts`, `src/app/(marketing)/page.tsx`, `src/app/api/strategies/create-with-key/route.ts`; `supabase/schema/functions/claim_compute_jobs_with_priority.sql`, `reset_stalled_compute_jobs.sql`; `supabase/migrations/*` (latest definition per function, by file name); `.github/workflows/supabase-migrate.yml`.
- Planning inputs: `.planning/PROJECT.md` (v1.22 section), `.planning/ROADMAP.md` (155.2, 157, 221 to 225), `TODOS.md` entries by id, the 2026-11-23 TODOS triage and founder scope note, the 155.2 plan files 11 to 14, the resolved debug session `derivecron-compose-divergence.md` (the source of the Deribit stale-returns observation).
- Bybit v5 API docs, execution list and position list pages (fetched 2026-11-23; LOW tier by the confidence seam, consistent with the repo's own RESEARCH assumption A7).

---
*Architecture research for: v1.22 TRUTH hardening (integration of fix groups into the existing system)*
*Researched: 2026-11-23*

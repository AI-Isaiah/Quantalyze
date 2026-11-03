# Phase 185: DERIBITFLOWTIME (replanned 2026-11-01, D-04: Deribit allocator books value open options at market) - Research

**Researched:** 2026-11-01 (forced re-research; the flow-time-split research this file held before is superseded and was not carried over except where re-verified below)
**Domain:** Deribit key-mode (allocator book) daily returns, option accounting bases (`cash_settlement`, `mark_to_market`, `smoothed_mtm`), the NAVMTM marks seam, allocator compose, the /allocations interim caveat
**Confidence:** HIGH on the code paths (all read this session); MEDIUM on cost and on whether the smoothed basis removes every large day (nothing measured against live data yet: the first plan must be a read-only dry run); LOW on `SMOOTHED_MTM_ENABLED`'s PROD value (not in the repo).

<user_constraints>
## User Constraints (from CONTEXT.md)

D-04 is the binding decision. D-02/D-03's fix half and the "Rules carried" flow-split rules are lineage (CONTEXT marks them so). Copied from CONTEXT.md:

### Locked Decisions

- **D-01 - Investigate the root cause.** Founder 2026-11-01: the extreme days are a defect to trace, not data to clip, cap or hide.
- **D-02 - Re-crawl, then fix.** The re-crawl half is done (185-01 SUMMARY, verdict B). Its fix half ("store each Deribit flow's time and split the day at it") is superseded by D-04.
- **D-03 - Book the fix now; the re-crawl is the phase's first step.** Done; verdict B means the phase replans.
- **D-04 - Replan for options; drop the flow split.** Founder 2026-11-01, AskUserQuestion, after the re-crawl verdict B: "Replan 185 for options (Recommended)": "Replan 185 around valuing options at market in allocator books. The mark-to-market and smoothed bases already exist for strategies, but are switched off in allocator (key) mode. Keep the interim caveat on the book. Drop the flow-time split, which barely helps."
  - The fix reuses the existing strategy-mode MTM and smoothed bases (`job_worker.py` gates them on `not is_key_mode`; `deribit_txn.py` `DEFAULT_PNL_BASIS` is `cash_settlement`; the smoothed basis sits behind `SMOOTHED_MTM_ENABLED`). It is not a new basis.
  - The interim caveat stays on the book until the fix ships.
  - Evidence (185-01 SUMMARY): on 20 of the 23 readable days with |r| > 0.3, splitting at the flows gives the stored return within 1%. Only key A 2025-08-04 drops (3.93 against 5.29 stored). The big days are option trade and delivery rows booked at cash value. Key C 2026-10-28, a marked day, reads -52.7% from one `negative_balance_fee` row and must be explained.
- Still binding from the carried rules: "Never invent data: an uncomputable day is null" and "Tests go RED on the current rule", now for the key-mode cash basis.

### Claude's Discretion

CONTEXT's three discretion items belonged to the dropped flow split. The replan's research sets the new ones; they are answered below as recommendations, with the product-shaped ones in "Open Questions (founder)".

### Deferred Ideas (OUT OF SCOPE)

- 164.6.6.2.3 FLOWTIMING `[164.6.6.2.3-DERIBIT-INTRADAY-TIMING]` (position-attributed Deribit P&L): not in scope.
- 167.2.1.1.1 NAVMTM and 177 DERIBITFLOWS: marked days already place a flow by its instant; this phase must not move them.
- SC-4 (and any PROD read) is run by the orchestrator only, never by a dispatched executor.
</user_constraints>

<phase_requirements>
## Phase Requirements

No REQUIREMENTS.md ids are mapped (ROADMAP: "Requirements: TBD"). The ROADMAP's corrected success criteria are the requirements.

| ID | Description (ROADMAP `### Phase 185`, corrected) | Research Support |
|----|--------------------------------------------------|------------------|
| SC-1 | Read-only re-crawl settles mechanism A vs B | MET (185-01 SUMMARY, `gate: B`). Nothing to plan. |
| SC-2 | Key mode computes a Deribit key's returns on a basis that values open options at market; the plan states how pre-mark history and already-marked days join; a test shows no day is counted twice | Q1, Q2, Q6: the smoothed ledger replaces the cash ledger as the source of `returns`, `day_pnl`, `composed_flows`, `realized_terminal` for option-activity keys; `apply_marks` is the single seam |
| SC-3 | Until it ships, affected books carry a named caveat on screen | Q8: no existing label fits; reuse the transport chain and the existing amber paragraph, with a new flag and sentence |
| SC-4 | After deploy: no |r| > 50% day the re-crawl attributes to cash-basis options; recomputed cumulatives reported; key C 2026-10-28 explained | Q7, Q9, "Validation Architecture"; marked days are mark-based and will NOT change |
| SC-5 | Tests go RED on today's cash basis in key mode; an uncomputable day is null | Q10, Q5: RED-first oracle verified this session; null-versus-cash-fallback is founder question F2 |
</phase_requirements>

## Summary

The defect is an accounting-basis choice, not a flow-timing one. In allocator (key) mode a Deribit key is always built on `cash_settlement`: an option premium books on the trade day and the payout on the delivery day, and the level the return divides by is the cash wallet, because the terminal wedge is `equity - balance` and `balance` excludes the open option book. So a long-option round trip prints a large loss and then a large gain against a premium-shrunk wallet. The repo's own `chain_linked_twr`, fed a synthetic round trip with the option book in the level, gives the same cumulative return and a moderate daily path (run this session, Q10).

The cure already exists in code: `build_deribit_native_ledger(pnl_basis=smoothed_mtm)` merges a per-day change in the replayed option book valued at Deribit's own daily chart closes into `native_pnl`, and sets the terminal wedge to the session uPnL only, so the rolled level includes the option book. Strategy mode runs it only as an ADDITIVE third pass (a second and third full re-crawl, never the headline). Key mode must run it as the HEADLINE source, for option-activity keys only, from the SAME crawl (a second full crawl cannot fit the 900 s derive budget), and must fall back to cash with a named caveat instead of failing when the smoothed pass cannot be built. The marks seam (`apply_marks`) is already the only join between pre-mark history and marked days; it needs the smoothed ledger's day P&L, flows and realized terminal to be handed to it, and then no day is counted twice by construction.

Three things the planner must not assume. (1) Marked days (from the first mark, about 2026-10) are mark-based: they do NOT change, so the fix recomputes pre-mark history and the seam day only, and key C 2026-10-28 stays what it is unless it is a defect of its own (Q7). (2) Nothing here proves the smoothed series removes every big day (futures session uPnL stays outside every non-marked level; key A 2025-08-04 also carries a same-day in-and-out). The first plan must be a read-only dry run in the worker, like plan 01, before any plumbing. (3) The smoothed basis has never run on live data as far as the repo shows (`SMOOTHED_MTM_ENABLED` ships dark; its PROD value is unmeasured), and it has known structural failure modes (expiry-day book-channel breach, retention straddlers) that today degrade silently in strategy mode and would FAIL a key-mode derive permanently if not caught locally.

**Primary recommendation:** Wave 0 = read-only dry run in the worker on keys A and C (smoothed ledger from one crawl, compared day by day with the stored cash returns; counts and ratios only). Then PR-1 = interim caveat (new flag, existing amber paragraph, existing key_inputs transport chain, adapted from plans 06/07). PR-2 = key-mode options basis (one crawl, smoothed assembled from the same raw rows, option-activity keys only, local fallback to cash plus the caveat flag). The nightly derive recomputes history; the orchestrator reads SC-4 the next morning.

## Project Constraints (from CLAUDE.md)

Directives from `CLAUDE.md`, `AGENTS.md` and the user's global rules that the plans must be checked against:

- **Which database am I on:** the checkout's Supabase CLI link is PRODUCTION. Any write is preceded by the `COMMENT ON DATABASE` marker query (NULL means stop). This phase has NO migration and NO SQL write. PROD reads (SC-4, the Q7 reads, the dry run) are orchestrator-only, marker first, counts and ratios only. No `supabase ... --linked`, no Railway call from this research or from an executor.
- **Public repo with `.planning/` tracked:** no key ids or tags, PROD ids, amounts, logins, account numbers or home paths in tracked text. Keys are "key A", "key C". Test fixtures use ratios or arbitrary scaled amounts. Cite code by symbol, not line number.
- **Banned packages:** `react-native-international-phone-number`, `react-native-country-select`. This phase installs no package.
- **CHANGELOG discipline:** every ship writes an entry in the same commit as the `VERSION` bump (`chore(release): vX.Y.Z.B`), mapping every commit to a bullet; `VERSION` and `package.json` byte-equal 4-digit strings; never `npm version`. Section vocabulary is the repo's own (`### Fixed`, `### Added`, `### Changed`, `### Root cause`, `### Tests`, `### Notes`, `### Why`).
- **CI skip-trailer tokens are forbidden anywhere in a commit message or PR body, even in prose.** Count checks bound to the head SHA.
- **No AI-authorship trailers** in commits or PRs (founder 2026-10-20), overriding any default attribution line.
- **A ship branch must change nothing under `.planning/`.** Planning edits go to main afterwards.
- **Completion is historical:** VERIFICATION uses `verified_at_sha` + `drift_subjects`; `covered_digest`/`covered_files` are banned; `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json` never go in `drift_subjects`.
- **Never hand-dispatch `gsd-*` agents; execute via `/gsd-execute-phase`.** `gsd-tools` state handlers: run, then `git diff` every time. The ROADMAP/STATE shape is guarded by `scripts/check-planning-hygiene.ts` rules 6d/6e/7 (`npm run lint`); a ROADMAP rewrite of the Phase 185 plan list must keep that shape.
- **Testing rules:** data-integrity and user-facing gates must be able to fail (neuter, see RED, restore from a byte backup, never `git checkout/restore/stash` on uncommitted work). Money-math oracles are independent invariants. `grep -a`. pytest only from `analytics-service/`; never `importlib.reload`.
- **Analytics-service gates every brief must carry** (CI mypy, verbatim, run from `analytics-service/`): `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`.
- **Never invent data:** an uncomputable metric is null. Annualization: risk by frequency (crypto 365), returns by calendar.
- **PROD access:** reads and writes are authorized for the orchestrator (founder 2026-10-03), marker query first, prefer the product's own paths over hand SQL writes, keep data. This research did none.
- **Design:** read `DESIGN.md` before any UI text change. Amber `--color-warning` (`#B45309`) is "system- or user-recoverable disclosure"; muted is steady state; red is permanent. The existing caveat paragraph already uses the amber pattern.
- **AGENTS.md:** "This is NOT the Next.js you know ... Read the relevant guide in `node_modules/next/dist/docs/` before writing any code." The caveat plans touch client components and `src/lib` readers only, not a route handler or server component; if a plan touches either, read the guide first.
- **Review stack:** gsd-code-reviewer plus silent-failure-hunter, MEDIUM and above; a user-facing or data-integrity MEDIUM triggers a fixer round. This phase is both. Subagents: executors Sonnet high; planner and UI agents omit `model`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Option book replay and daily marks (basis choice) | Analytics worker (`deribit_txn.py` pure core, `deribit_ingest.py` adapter) | Deribit public chart endpoint | Needs exchange egress and the crawl's raw rows; no raw-log store exists |
| Key-mode basis selection, fallback to cash, budget bound | Analytics worker (`job_worker.py` `run_derive_broker_dailies_job`) | - | The one place key mode builds its ledger |
| Pre-mark / marked-day join | Analytics worker (`nav_marks_apply.apply_marks`, pure) | `api_key_nav_marks` table | Already the single seam (D-04/D-05 of NAVMTM) |
| Book curve and returns | Analytics worker compose (`allocator_equity_compose.portfolio_returns`, `derive_allocator_equity`) | Database `allocator_equity_derived` | Re-reads stored per-key rows; never re-chains |
| Interim caveat flag (writer) | Analytics worker (`key_inputs:<key>` payload) | - | Same chain as `marks_since` |
| Caveat reader and display | Frontend server reader (`src/lib/queries.ts` `readMarksStart`) then client (`AllocationDashboardV2`, `FactsheetView` amber paragraph) | - | Existing owner-RLS read and existing paragraph |
| Recompute | Cron fan-out (`derive-allocator-key-dailies`) | Orchestrator reads | Full-span upsert is authoritative within span |
| Dry run and SC-4 reading | Orchestrator inside the Railway worker, read-only | - | Needs decrypt and exchange egress; never an executor |

## Standard Stack

No new libraries. Everything is in-repo.

| Item | Version | Purpose | Why standard |
|------|---------|---------|--------------|
| Python (analytics venv `analytics-service/.venv`) | 3.12.13 [VERIFIED: ran `.venv/bin/python --version`] | worker, tests | CI runtime |
| pytest | run this session: `tests/test_mtm_single_key.py tests/test_smoothed_mtm_core.py` = 80 passed, 25 s [VERIFIED: ran] | tests | repo standard |
| mypy | 2.4.0 [VERIFIED: ran `.venv/bin/python -m mypy --version`] | CI strict gate | repo standard |
| Node / vitest | Node v25.8.1; `node_modules/.bin/vitest` present [VERIFIED: ran] | frontend tests | repo standard |
| `services.deribit_ingest.build_deribit_native_ledger`, `services.deribit_txn.option_mtm_daily`, `services.nav_marks_apply.apply_marks`, `services.nav_twr.chain_linked_twr` | in-repo | the whole fix | "a bespoke `r_t` loop is FORBIDDEN" (`combine_native_ledger` docstring) |

**Installation:** none. **Package legitimacy audit:** no external package is installed or recommended, so the `package-legitimacy` gate has nothing to check.

| Package | Registry | Verdict | Disposition |
|---------|----------|---------|-------------|
| (none) | - | - | - |

**Packages removed due to [SLOP]:** none. **Packages flagged [SUS]:** none.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `smoothed_mtm` for key mode | `mark_to_market` (Deribit's `options_settlement_summary` channel) | MTM exists only from the summary rollout (a pre-rollout straddle FAILS LOUD; pre-coverage option rows fall back to cash `change`), and its session lumps are what smoothed was built to remove. Smoothed is bounded by the ~913-day chart window instead. Founder question F1. |
| Second full crawl (the strategy-mode pattern) | Assemble smoothed from the SAME crawl's raw rows | A second full-history crawl can take about 12 minutes on a large account against a 900 s total budget; reuse the rows (the NAV-twin precedent: "NO venue call and no second crawl") |

## Q1-Q10 Findings

### Q1. The gates in `job_worker.py`, what the passes compute and store, what key mode needs

Three gates, all in `run_derive_broker_dailies_job` (cited by symbol). Verbatim predicates:

- MTM second pass: `if (not is_key_mode and pnl_basis == DEFAULT_PNL_BASIS and _completeness.has_option_activity):` [VERIFIED: job_worker.py, comment block "MTM-01 (Phase 101): additive mark_to_market SECOND pass"]
- Smoothed third pass: `if (is_smoothed_mtm_enabled() and not is_key_mode and pnl_basis == DEFAULT_PNL_BASIS and _completeness.has_option_activity):` [VERIFIED: "SMTM-01 (Phase 132): additive smoothed_mtm THIRD pass"]
- Composite stitch (`run_stitch_composite_job`): `smoothed_ok = is_smoothed_mtm_enabled() and smoothed_mtm_available(member_signals)` (composite route, out of scope here).
- Key mode's basis: `pnl_basis = (denominator_config.pnl_basis if denominator_config is not None else DEFAULT_PNL_BASIS)`; key mode has no `denominator_config`, so it is always `cash_settlement` [VERIFIED: job_worker.py near the "RT-4 (kill-switch integrity)" comment]. The RT-4 guard right after it FAILS a derive PERMANENT when `pnl_basis == PNL_BASIS_SMOOTHED_MTM and not is_smoothed_mtm_enabled()`: a key-mode path that sets the basis must not run through that guard unaware.

What the passes do in strategy mode (the headline stays cash; both are ADDITIVE):
1. Each pass calls `build_deribit_native_ledger(...)` again with its own `pnl_basis`: a FULL-HISTORY re-crawl each (`since_ms=None`), bounded to `0.7 x remaining derive budget`, refused below 60 s, degraded (never failed) on timeout or on the structural tuple `LedgerValuationError, NavReconstructionError, LedgerCompletenessError, LedgerTruncatedError, CurrencyEnumerationError, ScopeAuthError`. Constants verbatim: `_MTM_SECOND_PASS_BUDGET_FRACTION = 0.7`, `_MTM_SECOND_PASS_MIN_SECONDS = 60.0`, `_DERIVE_OUTER_BUDGET_S: Final[float] = 900.0`, `_DERIVE_POST_CRAWL_RESERVE_S: Final[float] = 90.0`.
2. `combine_native_ledger(ledger, indexable, denominator_config=...)` gives the basis return series (`mtm_returns`, `smoothed_returns`), run off the loop for smoothed (`asyncio.to_thread`).
3. Persist: `derive_basis_series` then `persist_basis_series(supabase, strategy_id, basis=...)` writes `strategy_analytics_series` kinds `KIND_MTM_DAILY_RETURNS = "mtm_daily_returns"` and `KIND_SMOOTHED_MTM = "smoothed_mtm_daily_returns"` [VERIFIED: basis_series.py], plus `strategy_analytics.metrics_json_by_basis` keys `mark_to_market` / `smoothed_mtm`. The cash headline is separate: `csv_daily_returns (strategy_id, date)` and kind `cash_settlement`.

Key mode owns none of those tables. Its stores are `csv_daily_returns` rows `(api_key_id, date)` and `allocator_equity_derived` kind `"key_inputs:" + api_key_id` (payload: `realized_terminal_*`, `composed_day_pnl`, `composed_flows`, `flows`, `anchor_usd`, `marks_since`, ...), then the compose is enqueued. The compose does not re-chain: it rolls each key's level backward from `realized_terminal` through the stored `composed_day_pnl` and `composed_flows` (`WRITER_BASIS_VENUES: Final[frozenset[str]] = frozenset({"deribit", "mt5"})`), and the book return is `r_t = Σ_k E_{k,t−1}·r_{k,t} / Σ_k E_{k,t−1}` (`portfolio_returns` docstring) [VERIFIED].

**What lifting the gate changes, precisely.** A key-mode series cannot be "additive": there is no by-basis table, and the book needs ONE curve. So the options basis must become the key's HEADLINE inputs: the ledger that feeds `combine_native_ledger`, `native_ledger_day_pnl`, `native_ledger_composed_flows`, `native_ledger_realized_terminal` and `native_ledger.flow_instants` for option-activity keys is the smoothed one. The level (denominator) then comes from `reconstruct_native_nav_and_twr`: per currency, terminal native equity minus the terminal wedge, rolled backward through `native_pnl` (cash change plus the daily change in the option book) and the flows, valued at the day marks. With smoothed the wedge is `state.native_upnl` (session uPnL only), so the rolled level contains the option book at the settled mark; with cash the wedge is `equity - balance`, which strips it.

**Design constraints the planner must carry:**
- Build from ONE crawl. A second full-history crawl (what the strategy passes do) plus the first can exceed the budget (`_BROKER_CRAWL_TIMEOUT_S` defaults to `_DERIVE_OUTER_BUDGET_S - _DERIVE_POST_CRAWL_RESERVE_S` = 810 s; the comment above it records "the v1.11 incident measured ~12 min" for a large account). Split `build_deribit_native_ledger` into crawl and assemble (`_crawl_deribit_ledger` already returns `raw_rows`), or add an opt-in that assembles a second ledger from the same rows into the report like `nav_twin_ledger` ("makes NO venue call and no second crawl").
- Apply the smoothed basis only to option-activity keys. The terminal wedge differs by basis (`if pnl_basis in (PNL_BASIS_MARK_TO_MARKET, PNL_BASIS_SMOOTHED_MTM): terminal_upnl_native = state.native_upnl` else `_cash_basis_wedge`), so a perp-only key built smoothed would NOT be byte-identical to cash whenever `futures_session_rpl` is nonzero. Gate on `deribit_raw_rows_have_option_activity(raw_rows)` (the existing `has_option_activity` source), not on "every Deribit key". [VERIFIED by reading `build_deribit_native_ledger`]
- Catch the smoothed failure locally and fall back to cash. In key mode the build and `combine_native_ledger` sit inside the cash pass's `try`; its arms `except LedgerValuationError` and `except NavReconstructionError` return `DispatchOutcome.FAILED, error_kind="permanent"` and call `_record_refusal`. A smoothed-only failure (hole, book-channel breach, section-5 residual) must not reach those arms or a key's curve freezes on its last row. Use the strategy passes' structural tuple, then keep the cash ledger and set the caveat flag.
- `SMOOTHED_MTM_ENABLED` is read per call from the worker env: `return (os.getenv("SMOOTHED_MTM_ENABLED") or "").strip().lower() == "true"` [VERIFIED: closed_sets.py]. Reusing it couples key mode to strategy rollouts and to an unknown PROD value; see F6.

### Q2. The bases and what each does

| Basis | Option premium / payout | Level (terminal wedge) | Notes |
|-------|------------------------|------------------------|-------|
| `cash_settlement` (`DEFAULT_PNL_BASIS: str = PNL_BASIS_CASH_SETTLEMENT`) | Full cash `change` on the trade day (premium, net of commission) and on the delivery/assignment day (payout); `options_settlement_summary` inert | `equity - balance` per currency (`_cash_basis_wedge`): the rolled level is the cash wallet, which excludes the open option book and futures session uPnL | What every key-mode derive runs today |
| `mark_to_market` (`PNL_BASIS_MARK_TO_MARKET: str = "mark_to_market"`) | The `options_settlement_summary` channel (`realized_pl + unrealized_pl`, a session delta) drives option P&L; option rows keep only the commission arm inside the coverage window; rows outside coverage fall back to cash `change` | `state.native_upnl` (session uPnL only) | Pre-rollout straddle FAILS LOUD (no boundary anchor); needs the summary stream; session-lump shape |
| `smoothed_mtm` (`PNL_BASIS_SMOOTHED_MTM: str = "smoothed_mtm"`) | Every option row books its FULL cash `change` (byte-identical cash channel) AND the adapter merges `ΔMTM[ccy][d] = Book[d] - Book[d-1]` with `Book[d] = Σ position × mark[d]` (replayed book, Deribit 1D chart closes) | `state.native_upnl`; the settled open book is inside `native_pnl`, so section 5 closes (WR-01 comment) | Total-preserving (telescoping): flat terminal book gives the same total as cash. Spreads a lump across the days it accrued. Needs a full-history crawl (`since_ms` must be None) |

[VERIFIED: deribit_txn.py basis comment block and `txn_rows_to_native_daily`; deribit_ingest.py `build_deribit_native_ledger`. Quotes above are verbatim.] An unknown basis raises `LedgerValuationError` ("refusing to compute daily P&L on an unrecognized accrual basis").

What "smoothed" means in code: `replay_option_positions` rebuilds the signed per-instrument end-of-day position from the post-trade `position` field of option `trade`/`delivery`/`assignment` rows (plus the D-09 zero-cash `expiry` close); `_build_smoothed_option_mtm` fetches ONE public chart request per held instrument; `option_mtm_daily` values the book on a dense calendar grid and fails loud on any day with a nonzero carried position and no bar ("refusing to interpolate"). `assert_balance_identity` then reconciles the terminal book against the venue anchor's settled book (`options_value - options_session_upl`) and cross-checks the summary stream.

### Q3. `SMOOTHED_MTM_ENABLED`

- Read in `services/closed_sets.py` `is_smoothed_mtm_enabled()` (per call, fail-closed: only the exact string `true` after strip/lower enables). Imported in `job_worker.py` and used at three places: the RT-4 permanent refusal for a smoothed headline config, the single-key third pass, and the composite third pass. The UI half is `NEXT_PUBLIC_SMOOTHED_MTM_ENABLED` in `src/lib/closed-sets.ts` (hides the third segment) [VERIFIED].
- Default: OFF ("ships DARK ... both default OFF", CHANGELOG v1.14 entry). Repo shows no `.env.example` or config setting it [VERIFIED: grep]. The CHANGELOG entry for 168 says "Its production value was not measured". **The PROD value is not in the repo and this research did not read it.** The orchestrator can read the one variable's value (a boolean, not a secret) from the worker service configuration as part of the dry run. [ASSUMED] that it is still off.
- Consequence: if it is off in PROD, the smoothed pass has never run on live data since v1.14 (July 2026), the GLB-1 expiry-day risk in `TODOS.md` ("best validated against real options books in the live dogfood") is unvalidated, and Wave 0's dry run is the first real exercise.

### Q4. Derive budget and the cost of the options step per key

Facts [VERIFIED, constants verbatim]: `TIMEOUT_PER_KIND["derive_broker_dailies"]` = `15 * 60` (900 s outer); `_DERIVE_POST_CRAWL_RESERVE_S: Final[float] = 90.0`; `LEDGER_PAGE_COUNT: int = 250`, `LEDGER_PACE_SECONDS: float = 1.0` (the transaction log is paged 250 rows per request with a 1 s pace, per scope and currency); the crawl comment records "~12 min" measured for a large account. The worker is sequential and the fan-out claims a batch at once, so a heavy key delays the keys behind it and the watchdog can reclaim the batch tail ("R2: batch-tail watchdog reclaim", `docs/runbooks/derivecron-go-live.md`).

Cost model for the options step when built from the SAME raw rows:
- no second crawl;
- `N_held` public chart requests, one per instrument that ever carried a nonzero end-of-day position (an instrument opened and closed intraday is skipped: IN-03). Verbatim from the fetch docstring: "A 1D series spans at most a few thousand points, so ONE request suffices (no pagination)." There is no pacing sleep between instruments in `_build_smoothed_option_mtm`; each request retries a transient with exponential backoff (`PUBLIC_READ_MAX_RETRIES = LEDGER_MAX_RETRIES` = 8);
- the dense index-mark fetch (`_build_dense_native_marks`) per indexable currency, which must cover the union of cash days and ΔMTM days if the cash ledger's marks are reused (design item for the planner; verify with a test, do not assume the cash marks span is enough);
- `option_mtm_daily` and the combine are pure CPU (run `combine_native_ledger` via `asyncio.to_thread`, as the smoothed pass does).

`N_held` and the per-request latency are UNMEASURED [ASSUMED]. The scale hint: key C had 1840 option trades on one day (185-01 SUMMARY), so instruments number in the tens to hundreds. The dry run must print `N_held`, the options step's wall time, and the crawl's wall time, so the plan can set the bound from a measurement. Bound the options step with the existing machinery: a slice of the remaining budget (`0.7 ×` remaining, refuse below 60 s) via `asyncio.wait_for`; on refusal or timeout fall back to cash plus the caveat flag, never fail the derive, never retry the whole derive (that is the FIX-2 / HIGH-01 lesson in the code comments).

If the key were built the strategy way (a second full crawl), a large account would degrade on most nights, which would leave the caveat on permanently and the fix inert. That is why reuse of the crawl is a hard requirement, not an optimisation.

### Q5. Option-price retention and what a too-old day does

Where the limit lives [VERIFIED, verbatim from `services/deribit_ingest.py`]: `_OPTION_MARK_RETENTION_DAYS_DEFAULT: int = 913`; `_OPTION_MARK_RETENTION_TOLERANCE_DAYS: int = 30`; `_option_mark_retention_days()` reads env `DERIBIT_OPTION_MARK_RETENTION_DAYS` (positive int; a bad value is ignored with a warning). The comment calls 913 "a ONE-PROBE point estimate of an UNCONTRACTED Deribit behaviour" [CITED: that comment; tagged as an uncontracted venue behaviour, not verified against Deribit documentation this session].

What happens, by case (`_build_smoothed_option_mtm`, `option_mtm_daily`):
1. An instrument with a nonzero end-of-day position whose chart response is WHOLLY empty AND whose expiry is older than the soft cutoff (`today - (913 - 30)` days): bucketed as pre-retention. Its `(ccy, day)` buckets keep their cash-basis value, the report carries `pre_mark_retention_option_days`, and the strategy pass stamps `meta["pre_mark_retention_option_dailies"]` (a registered `NAV_TWR_GUARD_KEYS` warning, status `complete_with_warnings`). So the day is NOT null and NOT refused: it falls back to cash and is flagged. As of 2026-11-01 the hard cutoff is about 2024-05-02.
2. An in-retention instrument with a wholly empty response, or a retention STRADDLER with partial marks (a head hole inside its held life): `option_mtm_daily` raises `LedgerValuationError` (D-07, "refusing to interpolate"). The whole smoothed pass fails. In strategy mode that degrades (smoothed series omitted, cash headline ships); in key mode it must fall back to the whole cash ledger (nothing partial is ever written).
3. Plain MTM at the other end of history: option rows before the summary rollout (about 2025-01-12) fall back to cash `change` (`pre_coverage_option_days`), and a pre-rollout straddle fails loud.

Ratchet [ASSUMED from the cutoff arithmetic]: the cutoff moves one day per day, so each night more history becomes un-markable and more instruments become straddlers; the code comment says so: "a currently-green options key can begin hard-failing on future recomputes as the ~2.5yr retention window advances (accepted D-07 consequence)". The two big-day clusters in the evidence (key A 2025-07/08, key C 2026) are inside the window today; key A's roll out in early 2028.

Never invent data, interpreted: cash fallback is a real (cash-basis) measurement flagged as such; null would be a chain break (`combine_native_ledger` notes that an interior break makes the cumulative compound only the post-break suffix). Which one the founder wants is F2.

What strategy-mode MTM does today for such days: the same fallbacks above, surfaced as warnings on the strategy factsheet. There is NO frontend reader for `pre_mark_retention_option_dailies` or `pre_summary_rollout_option_dailies` (zero hits in `src/`) [VERIFIED: grep], so even the strategy side shows nothing on screen for them.

### Q6. Pre-mark history versus marked days: the seam

Source of truth: the `apply_marks` module docstring (`services/nav_marks_apply.py`), rules 2-6, 8, 9, 13, 14 [VERIFIED, read in full]. Which days use which source:

| Days | Source | How |
|------|--------|-----|
| Before `S` (the first mark day) | the writer's ledger series (today cash; after the fix smoothed for option-activity keys) | "Every input day before `S` keeps its value exactly (L1). Nothing before `S` is recomputed, and nothing is invented from position history (D-09)." |
| `S` | the first stored mark `M_S` against the writer's own level the day before | `r(S) = (M_S − base − F_S)/base`, `base = L(S−1)`, where for a writer-chain venue (Deribit key and strategy mode, since G-01 shipped as v0.133.13.0) `L(S−1)` is "the writer's OWN realized level, reached from its terminal `(T_day, T)` by the writer's identity `L(d) = L(d-1) + P_d + F_d` over its own day P&L and its own flows" |
| After `S`, mark days | stored marks | `r(d) = (M_d − base − F_d)/base`, `base = level(p) + Σ flows of the gap days`; "One return, stamped on `d`, covers the whole gap" |
| After `S`, gap days (no mark) | none | absent from the output; listed in `mark_gap_days`; "every realized input day on or after `S` is absent (Pitfall 7)" |

Nothing is counted twice or skipped by construction: the output is the input days before `S` plus exactly the mark days with a return, and a day's flow is placed once (before `S` in the writer's flows, on `S` and after in the base or numerator, per rule 5; rule 9 holds a flow after the last mark out of this derive).

**Where an options-aware pre-mark series plugs in.** Four quantities come from one ledger today (`native_ledger`) in the key-mode block: `returns, meta = combine_native_ledger(native_ledger, ...)`, `_day_pnl_usd`, `_composed_flows_usd`, `_realized_terminal` (the last three via `native_ledger_day_pnl`, `native_ledger_composed_flows`, `native_ledger_realized_terminal`). `apply_marks(returns, _apply_flows, _marks_in, day_pnl=..., roll_basis="day_pnl", flow_instants=..., writer_terminal=_apply_writer_terminal)` is fed from those exact variables, and `writer_terminal` is `_realized_terminal` read before the key-mode block overwrites it. **All four must come from the same (smoothed) ledger.** If `returns` were smoothed but the terminal or day P&L still cash, `L(S−1)` would be the cash level and the first marked day would book the whole option book as a return on day `S` (the G-01 class of defect reappearing, now with options). The refusal token `mark_writer_terminal_absent` already guards a missing terminal.

**Consequence for the seam day.** Under cash today, `base = L_cash(S−1)` excludes the option book, so `r(S)` absorbs the whole open option value as return. Under smoothed, `L_sm(S−1)` includes the option book valued at the settled bar, and `r(S)` reduces to the real move between that level and the mark read (the read is early on the UTC day after the label, `mark_day = UTC date of marked_at − 1`). The day-bar skew (a 1D bar stamped `D 08:00 UTC` completes at `D+1 08:00`; "the ≤8h skew ... is intraday attribution noise WITHIN the one-day class" in `option_mtm_daily`) is absorbed in `r(S)`: second order, size unmeasured.

Marked days themselves do not change under this phase. They are mark-based (`api_key_nav_marks.nav_usd`, equity including open profit). The fix changes: every pre-`S` return of an option-activity key, the pre-`S` levels the compose rolls, and the seam day's base.

Test shape that pins the join (SC-2): build a ledger with an open option book across `S`, run `apply_marks` once with the cash ledger's four quantities and once with the smoothed ledger's, and assert (i) days before `S` equal the smoothed series, (ii) days on and after `S` are exactly the mark days, (iii) the day set is disjoint and gap days equal `mark_gap_days`, (iv) `replay_key_equity` (the compose's own roll) from the last mark reproduces every marked level AND the smoothed level at `S−1` (the existing `test_nav_marks_compose_roundtrip.py` pattern), (v) a RED variant where only `returns` is smoothed and the terminal stays cash fails (iv).

### Q7. The 2026-10-28 oddity (key C)

How a marked day's return is computed (from the `apply_marks` rules above): `r(d) = (M_d − base − F_d)/base`. **The day's cash rows do not enter at all.** `M_d` is the stored `nav_usd`, the venue equity at the read instant (each currency priced at "Deribit's own index read at `marked_at`", `DERIBIT_USD_BASIS = "venue_index_at_marked_at"`), `open_pnl_usd` is `equity − balance` under cash (`cash_basis_open_profit_native`). So a marked-day return can be non-zero with `rows_pnl_over_stored_pnl = 0`: the 185-01 figures for 2026-10-27 (+46.98%, rows −1.7389× stored P&L) and 2026-10-28 (−52.67%, rows 0.0) mean the move between two reads was not realized cash. The 10-27 and 10-28 stored P&Ls are of opposite sign, which looks like one swing out and back in non-cash value.

Plausible mechanisms, most likely first (all [ASSUMED] until the reads below):
1. **A real swing in non-cash value** (futures/perp session uPnL or the option book: both are in `equity` and outside `balance`). With a small base this is large in relative terms. A −50% day needs BTC to have moved a lot or the exposure to be leveraged many times (the 2025 days moved at most 2.2% a day).
2. **A mark taken on a partial or mispriced read**: one currency missing from the summaries (the refusal tokens cover `balance_error`, `upnl_unreadable`, `nonfinite`, `dust`, but a single currency absent from a successful read is not obviously one) or one coin priced at a wrong or stale index.
3. **Read-to-read windows are not UTC days.** Since the chain moved to 00:10Z/00:40Z (CHANGELOG v0.133.1.2, 2026-10-27, by hand in PROD cron), the first marks were read about 5.5-6.7 hours after midnight (CHANGELOG G-01 entry) and later ones about 40 minutes after: two windows of different length. A window of different length does not explain ±50% by itself, but it moves option and futures P&L between days.
4. **Flow placement** (Phase 177 rule 10): a large flow near the read instant moved to the other side of the read. The 185-01 SUMMARY shows no flow on 10-28; 10-27 not stated. Cheap to rule out.
5. **A gap (D-05)**: if a mark is missing, one return covers several days, and the return is stamped on the next marked day.
6. **The seam (G-01)**: if `S` is 10-26 or 10-27, `r(S)` carries the cash-versus-equity boundary. G-01 (v0.133.13.0, 2026-11-01) changed that base to the writer's own level, and its CHANGELOG says "The two affected books heal on the next nightly derive". The re-crawl may have read stored rows from before that derive. Check the stored row's `computed_at` against the G-01 deploy.
7. A tiny base: the stored levels for key C had a median prior level near 5% of its maximum (debug session), so any non-cash move reads large.

**Read-only PROD reads the orchestrator would run** (marker query first; counts and ratios; do NOT run now):
- R-a: `api_key_nav_marks` for key C, `mark_day` 2026-10-24 to 2026-10-31: `mark_day`, `marked_at` (hour only), `nav_usd / lag(nav_usd)`, `open_pnl_usd / nav_usd`, the per-currency `native_detail` shares. Decisive: if the NAV ratio tracks the `open_pnl_usd` change, it is a non-cash swing (mechanism 1); if one currency's native equity or index share jumps, mechanism 2; also gives `min(mark_day)` = `S`.
- R-b: the key's `key_inputs` row: `marks_since`, `mark_gap_days`, `marks_trailing_since`, `computed_at`, `composed_day_pnl` and `composed_flows` for 2026-10-26 to 2026-10-29 as ratios to the day's level, and `account_summary` ratios (`options_value / equity`, session uPnL / equity per currency).
- R-c: the benchmark day move for BTC and ETH on 2026-10-26 to 2026-10-29 (`benchmark_prices`).
- R-d: `nav_mark_refusal:<key>` rows (a refusal streak shows as a gap).
- R-e: the same key's event-time `flows` for those days against the composed flows (rules out placement).
- A worker-side re-crawl of the day's log (counts by row type only) if R-a points at cash rows after all.

SC-4 asks for the day to be "explained", not removed. Under this phase it stays unless it proves to be a defect of its own; see F7.

### Q8. The interim caveat

Candidates checked [VERIFIED by reading and grep]:
- `flow_timing_day_level_large`: set by `chain_linked_twr` only when a day's |net flow| ≥ the prior balance, strategy mode only today (`singleKeyDataQuality` reads it from `data_quality_flags`; key mode returns before the pre-stamp). Its sentence ("Some days carried a deposit or withdrawal at least as large as the balance before it, with no time of day, so their returns can be extreme.") would be FALSE for an option-premium day. The label also never fires on a day without a large flow, and the evidence says most big days carry no flow. **Not usable.** The cash-basis repro run this session raises it (its day 3 has a withdrawal) but an option-only day would not.
- `small_base_measured` ("Some days were measured on a very small balance, so their returns can be extreme."): a balance floor trigger, not options; not raised by key mode.
- `pre_mark_retention_option_dailies` / `pre_summary_rollout_option_dailies`: backend guard keys, no frontend reader (zero `src/` hits).
- `marks_since` / `marks_trailing_since`: unrelated (recorded-equity start).

**No existing label can carry "options valued at cash".** The reusable parts are the transport and the component, not the label:
1. Writer: a present-only bool in the key's `key_inputs` payload, beside the `marks_since` block in `_run_key_mode_compose_epilogue` (plan 06's design).
2. Reader: `readMarksStart` in `src/lib/queries.ts` already reads every included key's `key_inputs` row on the user client under owner RLS with the allocator filter, fail-closed on `departed_history_unavailable`; extend it (plan 07's design) rather than add a read.
3. Carry: `MyAllocationDashboardPayload` field, `AllocationDashboardV2` prop (in the `useMemo` dependency list), `buildAllocatorPortfolioFactsheetPayload(..., meta)` writing `payload.dataQuality.<flag>`, typed in `src/lib/factsheet/types.ts`.
4. Display: the existing amber paragraph in `FactsheetView.tsx` that already switches its sentence by flag (`smallBaseMeasured` versus `flowTimingDayLevelLarge`). Add a third condition and sentence (existing component, existing amber token). Optional second surface: the existing `EquityChart` caption lines (`marks-trailing-note` pattern).

Trigger: `_completeness.has_option_activity` for a Deribit key in key mode, AND the key's returns are on the cash basis. Pre-fix (PR-1) that is every such key. After the fix (PR-2) the writer sets it only when the key's options are still on cash (smoothed unavailable, budget refusal, or `pre_mark_retention_option_days` non-empty), so the caveat clears per key on its first derive after PR-2 and stays only where it is still true. Copy and placement are founder question F3.

**Plans 185-06 and 185-07: adapt, do not discard.** Their structure (writer, strict TS constant, literal pin across Python and TypeScript, dashboard payload hop, factsheet payload hop, rendered-sentence test, each hop RED-first with a neuter drill) is exactly what is needed. What changes: the flag name and sentence (not `flow_timing_day_level_large`), the trigger (option activity under cash basis, not the label from `chain_linked_twr` meta), the Q2 options (the q2-c gross-flow helper `_deribit_gross_flow_large` is dropped), and the removal rule (self-clearing via PR-2). Plans 02-05 (flow split) are dropped; 08 (SC-4 reading) adapts to the new SC-4 text. 185-01 stays as is.

### Q9. Blast radius and recompute path

- Keys affected: Deribit keys in key mode whose ledger has any option row (`deribit_raw_rows_have_option_activity`: an `options_settlement_summary` row or an option-instrument row). The stored evidence: all 22 days with |r| > 50% sit on 5 Deribit keys across 3 books (ROADMAP evidence). A repo-side count of option-activity keys does not exist: there is no raw-log store, and `ledger_digest` is a count, max timestamp and sha. The dry run should print `has_option_activity` for every Deribit key (a boolean per key, no ids).
- No key had open options on 2026-11-01 (debug session reads), which is consistent with the fix mattering for HISTORY.
- Strategy-mode Deribit keys already run MTM and smoothed, but only as additive series on the factsheet and only when `has_option_activity` (and, for smoothed, the flag). The strategy HEADLINE stays cash unless `returns_denominator_config.pnl_basis` pins another basis. So after the fix key mode and a strategy on the same account agree on the smoothed series (same builder, same code path), NOT on the headline; no strategy sits on the founder's logins, so there is no live twin to compare (debug session R2). Byte-for-byte agreement is not a goal (F5).
- Recompute: `csv_daily_returns` is authoritative within the derive's span (upsert first, then delete of absent span days), and `derive-allocator-key-dailies` (`enqueue_derive_broker_dailies_for_allocator_keys()`, cron at 00:40Z per the 2026-10-27 CHANGELOG entry) re-derives every eligible key's full history, then enqueues the compose. So the next nightly derive is the recompute; no migration, no backfill table. A one-off derive is the product's own enqueue path if the founder wants the SC-4 reading the same day (F4). The cron time is from the CHANGELOG, not re-read from PROD [ASSUMED current].
- A key whose derive fails keeps its previous row and curve (fail-safe), which is why the fallback must not be a permanent FAIL.

### Q10. Tests

Existing, to extend or consciously rewrite:
- `analytics-service/tests/test_mtm_single_key.py`: the key-mode harness (`_ctx(strategy_row=None, key_mode=True)`, `_base_patches`, `_apply`, `_recording_ledger`, `_report`, `_ledger_meta`). **`test_key_mode_never_runs_second_pass` pins the very gate D-04 reverses** (`assert len(calls) == 1, "key-mode must NOT run a second mark_to_market pass"`; the module docstring lists it as "kills dropping the `not is_key_mode` guard"). It will go RED when the gate lifts; the plan must rewrite it to the new contract on purpose and update the docstring, not delete it silently. The strategy-mode tests in that file stay.
- `tests/test_smoothed_mtm_core.py` (pure core, adapter merge, retention, book channel, `test_perp_only_smoothed_zero_fetches_byte_identical`), `tests/test_deribit_ingest.py`, `tests/test_job_worker_deribit.py`, `tests/test_allocator_equity_writer_basis.py` (`_run_derive`: a key-mode Deribit derive over a real ledger with the real `combine`, day P&L, terminal and composed-flow functions; returns the persisted `key_inputs` payload), `tests/test_nav_marks_compose_roundtrip.py`, `tests/test_nav_marks_deribit_open_profit.py`, `tests/test_nav_marks_option_value.py`, `tests/test_deribit_nav_twin.py`.

**RED-first oracle, verified this session** (ran the repo's own `chain_linked_twr` from `analytics-service/.venv`, scaled so day-0 is 100,000 USD because the USD floors treat levels under 1 USD as dust and return all-NaN; ratios below are multiples of the day-0 level, no real amounts):

| | day 0 | day 1 | day 2 | day 3 |
|---|---|---|---|---|
| cash wallet (level) | 1.000 | 0.516 | 0.530 | 1.698, with a withdrawal of 0.602 on day 3 |
| option book value | 0 | 0.484 | 0.643 | 0 |
| level with the option book | 1.000 | 1.000 | 1.174 | 1.698 |
| return, cash basis | 0 | -0.4839 | +0.0280 | +3.3339 (raises `flow_timing_day_level_large`) |
| return, option book in the level | 0 | 0.0000 | +0.1740 | +0.9586 |

Cumulative is +1.2994 on both [VERIFIED: ran]. This is the 2025-07-11..07-13 shape (-48.4%, +2.8%, +333.4%) from the debug session. The 2025-08-03/04 pair (-78%, +529%) additionally has an in-and-out flow on the +529% day and the re-crawl's flow-split gave 3.93 there; do NOT promise the smoothed series removes it. The dry run decides.

Test layout the plans should use:
1. Pure/unit: a `NativeLedger` with a cash channel that reproduces the table's cash column and a ΔMTM channel that reproduces the book column; `combine_native_ledger` on each; assert the shapes above (RED on today's key-mode path because key mode never builds the second ledger).
2. Key-mode derive (via `_run_derive`-style harness): option-activity ledger gives the smoothed-basis `returns`, `composed_day_pnl`, `realized_terminal_usd` in the persisted rows; a perp-only ledger gives the cash rows byte-identical (guards finding "apply only to option-activity keys").
3. Fallback: a smoothed build that raises `LedgerValuationError` (hole, book-channel breach, `InceptionReconciliationError`) leaves the derive `DONE`, writes the cash rows, and sets the caveat flag; a transient (`DeribitTransientReadError`) still propagates and retries.
4. Budget: an options step that exceeds its slice degrades to cash plus flag (mirror `test_mtm_second_pass_timeout_degrades_loud_not_failed_final`).
5. Seam: Q6's five assertions.
6. Neuter drills for each data-integrity gate: byte-backup, neuter, see RED, restore from backup and `cmp` (the repo's drill).

## Architecture Patterns

### System Architecture Diagram

```
Deribit private/get_transaction_log (250 rows/page, 1 s pace) ──► _crawl_deribit_ledger  (ONE crawl)
                                                                     │ raw_rows
        ┌────────────────────────────────────────────────────────────┼─────────────────────────────┐
        ▼                                                            ▼                             ▼
 txn_rows_to_native_daily(cash)                  deribit_raw_rows_have_option_activity?      flow_instants
        │                                          │ no: cash ledger = headline (byte-identical)
        │                                          ▼ yes
        │              replay_option_positions ─► per-instrument public chart (1D) ─► option_mtm_daily
        │                                          │ ΔMTM per (ccy, day) + terminal book
        │                                          ▼
        │              assert_balance_identity (book channel vs venue anchor, summary cross-check)
        │                                          │ any structural failure ─► KEEP cash ledger + caveat flag
        ▼                                          ▼
   native_pnl = cash + ΔMTM ; terminal wedge = native_upnl  ──►  NativeLedger (headline for the key)
        │
        ├─► combine_native_ledger ─► returns (pre-mark days)
        ├─► native_ledger_day_pnl / composed_flows / realized_terminal  (writer basis)
        ▼
 api_key_nav_marks (from S) ──► apply_marks(returns, flows, marks, day_pnl, writer_terminal)
        │      output = days before S (smoothed) + mark days from S (marks win)
        ▼
 csv_daily_returns (api_key_id, date)   +   allocator_equity_derived key_inputs:<key>
        │                                      (realized_terminal, composed_*, marks_since, caveat flag)
        ▼
 derive_allocator_equity (replay levels; portfolio_returns) ─► equity_curve ─► /allocations
        ▲                                                                    │
        └──── readMarksStart reads key_inputs flag ─► dashboard payload ─► AllocationDashboardV2 ─► FactsheetView amber paragraph
```

### Recommended Project Structure
```
analytics-service/services/
├── deribit_ingest.py      # crawl/assemble split OR opt-in second ledger in the report; options-basis fallback result
├── job_worker.py          # key-mode basis selection + local fallback + caveat flag (no new module for single-use code)
└── (nav_marks_apply.py, native_nav.py, deribit_txn.py: unchanged)
analytics-service/tests/   # one new module for the key-mode options basis; test_mtm_single_key.py updated
src/lib/                   # one small flag module (constant + strict reader), as nav-marks-start.ts
src/__tests__/             # one literal-pin test (writer/reader literal across languages)
```

### Pattern 1: Assemble a second ledger from the same crawl (NAV-twin precedent)
**What:** `build_deribit_native_ledger(..., nav_twin=True)` re-aggregates the crawl's own raw rows into `report.nav_twin_ledger` with "NO venue call and no second crawl", and a twin that cannot be built never fails the build (`nav_twin_error` names the class). **When to use:** the options-basis ledger. **Source:** `build_deribit_native_ledger` docstring [VERIFIED].

### Pattern 2: Present-only strict flag through the key_inputs chain (MARKSSTART precedent)
**What:** writer `if cond: _key_inputs_payload["<flag>"] = True`; reader `payload?.[FLAG]` through a strict `=== true` function; pinned across Python and TypeScript by a raw-file literal test. **Source:** plans 185-06/07 (this directory) and `src/__tests__/nav-marks-start-literal-pin.test.ts`.

### Anti-Patterns to Avoid
- **Reusing the `flow_timing_day_level_large` string for an options cause:** its on-screen sentence is about deposits and withdrawals; it would state something false.
- **A second full crawl for the options basis:** budget (Q4).
- **Smoothed for every Deribit key:** the wedge differs by basis (Q1).
- **Hybrid ledgers:** smoothed `returns` with a cash terminal or day P&L (Q6).
- **A permanent FAIL on a smoothed-only failure:** freezes the key's curve on its last good row.
- **Clipping, capping or hiding the large days:** D-01.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Daily option P&L accrual | a new "options at market" basis | `smoothed_mtm` via `build_deribit_native_ledger` / `option_mtm_daily` | exists, total-preserving, fail-loud on holes, tested |
| Joining history to marks | a custom splice | `apply_marks` with the same ledger's writer quantities | pure, pinned by rules 1-14 and the compose round trip |
| Level and return chain | a bespoke `r_t` loop | `reconstruct_native_nav_and_twr` / `chain_linked_twr` | "a bespoke `r_t` loop is FORBIDDEN" |
| Retention logic | a new horizon constant | `_option_mark_retention_days()` (env `DERIBIT_OPTION_MARK_RETENTION_DAYS`) | one source |
| Caveat transport and component | a new component | the `key_inputs` chain and the amber paragraph | SC-3 "existing UI only" |
| Time budget | ad hoc timers | the `_MTM_SECOND_PASS_*` machinery and `asyncio.wait_for` | FIX-2/HIGH-01 lessons |

**Key insight:** every piece exists; the work is choosing the headline ledger in key mode, keeping its four writer quantities consistent, and failing soft.

## Runtime State Inventory

This is a behaviour change to a derived series, not a rename, but stored state is affected:

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `csv_daily_returns (api_key_id, date)` and `allocator_equity_derived` `key_inputs:<key>` / `equity_curve` rows for option-activity Deribit keys hold cash-basis values | Data recompute by the next full-span derive (authoritative within span). No migration. |
| Live service config | `SMOOTHED_MTM_ENABLED` (worker env) value unknown; `DERIBIT_OPTION_MARK_RETENTION_DAYS` may be set | Orchestrator reads both names/values in the dry run; neither is in git |
| OS-registered state | pg_cron `derive-allocator-key-dailies` (00:40Z per CHANGELOG), set by hand, not a migration | None: the schedule is unchanged. |
| Secrets/env vars | none renamed | None |
| Build artifacts | none | None |

## Common Pitfalls

### Pitfall 1: The fix lands but option-less keys shift
**What goes wrong:** a perp-only key built on the smoothed basis gets the `native_upnl` wedge instead of `equity - balance`, so its level and §5 residual change. **How to avoid:** gate on `has_option_activity` and assert byte-identity of perp-only rows in a test. **Warning sign:** `test_perp_only_*` byte-identity tests going red or a new `inception_unreconciled`.

### Pitfall 2: A smoothed failure fails the derive
**What goes wrong:** `LedgerValuationError` (hole, retention straddler, GLB-1 expiry-day book-channel breach) or `InceptionReconciliationError` reaches the cash pass's permanent arms. **How to avoid:** local catch (the strategy structural tuple), fall back to cash, set the flag, log class names only. Transients keep propagating.

### Pitfall 3: Mixed-basis writer quantities
**What goes wrong:** the seam day books the option book as a return (G-01 class). **How to avoid:** one ledger object feeds all four quantities; Q6 test (v).

### Pitfall 4: Budget
**What goes wrong:** the options step plus the crawl pass 900 s, the outer `wait_for` fires, transient retries, `failed_final`. **How to avoid:** reuse the crawl, bound the step, degrade; the dry run measures `N_held` and wall time.

### Pitfall 5: The retention ratchet and the straddler cliff
One straddler instrument degrades the whole key to cash; the cutoff advances daily. Report the count of bucketed days and the degrade reason; the caveat must follow the degrade.

### Pitfall 6: Test fixtures under the dust floor
USD floors treat levels under 1 USD as dust; a BTC-scale fixture yields all-NaN returns (hit this session). Scale fixtures to a large USD day-0.

### Pitfall 7: Old pins
`test_key_mode_never_runs_second_pass` and the comments saying "key-mode owns no strategy_analytics row" (true, but no longer a reason to skip the basis) will mislead an executor; update them with the contract.

### Pitfall 8: Public-repo leakage
Dry-run output, key tags, amounts and the debug session's raw numbers stay out of tracked text and logs; the dry-run script is not committed while it carries key tags.

## Code Examples

### The key-mode headline-ledger choice (shape, not final code)
```python
# Source: shape derived from build_deribit_native_ledger's twin precedent + the strategy structural tuple
# in run_derive_broker_dailies_job (names are real; the wiring is the plan's job).
# 1. one crawl -> raw_rows (cash ledger built as today)
# 2. if _completeness.has_option_activity (key mode only):
#       try:  options_ledger, options_report = <assemble smoothed from the SAME raw_rows>, bounded by wait_for
#             returns, meta = combine_native_ledger(options_ledger, indexable)       # headline
#             native_ledger = options_ledger                                         # ALL four writer quantities read this
#       except (LedgerValuationError, NavReconstructionError, LedgerCompletenessError,
#               LedgerTruncatedError, CurrencyEnumerationError, ScopeAuthError, asyncio.TimeoutError):
#             keep the cash ledger; _key_inputs_payload[<flag>] = True
# 3. day_pnl / composed_flows / realized_terminal / flow_instants / apply_marks writer_terminal: from native_ledger
```

### The RED-first oracle (verified)
```python
# Source: ran against services.nav_twr.chain_linked_twr, analytics-service/.venv, 2026-11-01
S = 100_000.0  # day-0 level in USD (the USD floors treat < 1 USD as dust)
levels_cash = [1.0, 0.5161, 0.5305, 1.6977]       # x S ; withdrawal 0.6016 x S on day 3
levels_opt  = [1.0, 1.0,    1.1740, 1.6977]
# chain_linked_twr(pd.Series(levels * S), pnl, flows, prev0=S) ->
#   cash: [0, -0.4839, +0.0280, +3.3339]  (flags include flow_timing_day_level_large)
#   opt : [0,  0.0000, +0.1740, +0.9586]  ; cumulative +1.2994 on both
```

## State of the Art

| Old approach | Current approach | When | Impact |
|--------------|------------------|------|--------|
| Key mode always cash, wallet denominator | marks (NAVMTM) from about 2026-10 give equity incl. options for marked days | 167.2.1.1.1, deployed 2026-10 | days from `S` are already at market; history before `S` is not |
| First mark's base = the mark's wallet | writer's own realized level (G-01) | v0.133.13.0, 2026-11-01 | the seam day no longer double-books hours; with options still books the book if the writer is cash |
| Flow-time split | dropped (D-04) | 2026-11-01 | the re-crawl showed it barely helps |

**Deprecated/outdated:** the previous research file's mechanism-A material (the flow-split design, `DayTiming` pairing, P&L placement policy) is superseded and removed.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `SMOOTHED_MTM_ENABLED` is off in PROD (value not in the repo) | Q3 | the smoothed code may already run for strategies; low impact on the key-mode design, changes F6 |
| A2 | The 913-day chart horizon is a one-probe venue behaviour, uncontracted | Q5 | cutoff earlier or later; the env override exists |
| A3 | `N_held` (distinct held option instruments) and per-request latency are tens to hundreds and sub-second | Q4 | budget degrade on large keys; the dry run measures |
| A4 | The smoothed series removes the large days on keys A and C | Summary, Q10 | futures session uPnL and key A 2025-08-04's in-and-out may keep some days large; the dry run decides |
| A5 | `derive-allocator-key-dailies` runs at 00:40Z today (from the 2026-10-27 CHANGELOG, not re-read from PROD) | Q9 | recompute timing statement |
| A6 | The dense index marks built for the cash ledger may not span the ΔMTM days | Q4 | a missing-mark refusal; test it |
| A7 | Mechanisms 1-7 for the 2026-10-28 day (ranking) | Q7 | the reads decide |
| A8 | The ≤8h option-bar skew at the seam day is second order | Q6 | `r(S)` noise; measure in the dry run if `S` falls inside the dry-run window |
| A9 | Marked days will not change under this phase | Q6 | true by `apply_marks` rule 2/L1; stated here for the SC-4 expectation |

## Open Questions (founder)

None of these is decided here. Each needs a founder answer before the plan that depends on it executes. Recommendation first.

**F1. Which options basis does an allocator book use?**
- (a) Smoothed (recommended): spreads each option session over the days it accrued; no dependency on the summary stream; limited by the ~913-day chart window. Matches the goal of removing multi-hundred-percent prints.
- (b) Plain mark-to-market: Deribit's own session summaries; only from the summary rollout (about 2025-01); lumpier; pre-rollout straddle refuses.
- (c) Smoothed where it works, plain MTM where smoothed refuses: more coverage, two bases on one curve, harder to explain.

**F2. What does a day older than the option-price window show?**
- (a) Keep the cash-basis number for those days, flagged and caveated (recommended; this is what the existing smoothed pass already does for wholly pre-window instruments; keeps the chain).
- (b) Null for those days: honest, but breaks the chain and the cumulative compounds only the post-break suffix.
- (c) Refuse the options basis for the whole key and show all cash with the caveat (what a straddler forces today).
- Consequence for (a): the caveat must stay true for those days after the fix ships.

**F3. Caveat wording, placement, trigger, removal.**
- Placement: (a) the existing amber paragraph in the portfolio factsheet on /allocations Overview (recommended; sentence chosen by flag, as `smallBaseMeasured` does); (b) the equity chart caption; (c) per key.
- Trigger: (a) a Deribit key with option rows whose returns are on cash (recommended: no invented threshold); (b) additionally require a day over a size threshold (a threshold invented by us).
- Removal: (a) self-clears per key on its first derive after the fix ships and stays where options are still on cash (recommended); (b) removed for all books when the fix ships.
- Sentence: a founder-supplied sentence is needed; a proposal: "Some days on a Deribit account were measured against its cash balance, which leaves out open option positions, so their returns can be extreme."

**F4. Recompute timing.** (a) The next nightly derive, SC-4 read the next morning (recommended: the product's own path, no manual write); (b) a one-off derive of the affected keys right after deploy, for a same-day SC-4 reading.

**F5. Must strategy mode and key mode agree byte for byte?** (a) No: same builder, so the smoothed series agree; the strategy headline stays cash (recommended; changing a strategy headline is a separate product decision); (b) Yes: moves strategy headlines to smoothed (out of scope, new phase).

**F6. Rollout switch.** (a) No new switch; key mode runs the options basis for option-activity keys with a local fall-back to cash, gated by the Wave 0 dry run and tests, rollback = revert the merge (recommended; no coupling to the strategy flag); (b) a new key-mode kill-switch default off, then flipped; (c) reuse `SMOOTHED_MTM_ENABLED` (couples to strategy rollouts and to an unmeasured value).

**F7. Key C 2026-10-28 after it is explained.** (a) If the reads show a real non-cash swing, accept it as a true marked-to-market day and say so in the SC-4 report (recommended); (b) if it shows a pricing or partial-read defect, book a separate phase (marked days are outside this fix).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python venv (`analytics-service/.venv`) | all analytics tests | yes | 3.12.13 | - |
| pytest | tests | yes (80 passed on two modules) | - | - |
| mypy | CI gate | yes | 2.4.0 | - |
| Node / vitest | frontend tests | yes | v25.8.1 | - |
| PROD / TEST databases, Railway worker, Deribit read endpoints | dry run, Q7 reads, SC-4 | not used by this research | - | orchestrator-only |

**Missing dependencies with no fallback:** none for code work. The dry run and SC-4 need the orchestrator's worker access.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (analytics-service), vitest (frontend) |
| Config file | `analytics-service/pytest.ini`, `analytics-service/pyproject.toml` (`[tool.mypy]`), `vitest.config.ts` |
| Quick run command | `cd analytics-service && .venv/bin/python -m pytest tests/test_mtm_single_key.py tests/test_smoothed_mtm_core.py tests/test_allocator_equity_writer_basis.py tests/test_nav_marks_compose_roundtrip.py -q -p no:cacheprovider` (first two modules: 80 passed in 25 s this session) |
| Full suite command | `cd analytics-service && .venv/bin/python -m pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80`; frontend: `npm run typecheck && npm run lint && npx vitest run <files>` |
| Type gate | `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |

### Phase Requirements to Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| SC-1 | verdict recorded | record | `grep -a "gate: B" .planning/phases/185-*/185-01-SUMMARY.md` | yes (met) |
| SC-2 | key mode on cash gives the (-0.4839, +0.0280, +3.3339) shape; on the options basis gives (0, +0.1740, +0.9586), same cumulative | unit/key-mode derive | `pytest tests/test_deribit_key_mode_options_basis.py -q` (new) | Wave 0 |
| SC-2 | option-activity keys only; perp-only byte-identical | derive | same module | Wave 0 |
| SC-2 | seam: days before `S` smoothed, from `S` marks, disjoint, compose round trip lands on marked levels and on `L(S-1)` | derive/pure | same module + `tests/test_nav_marks_compose_roundtrip.py` | Wave 0 / yes |
| SC-2 | smoothed failure and budget overrun fall back to cash, derive `DONE`, flag set; transient still retries | derive | same module (mirror `test_structural_smoothed_failure_degrades_keeps_cash_mtm`) | Wave 0 |
| SC-2 | the old gate pin is rewritten | derive | `pytest tests/test_mtm_single_key.py -q` | yes (edit) |
| SC-3 | writer sets the flag only when true and strict; clears when the options basis applies | derive | new tests | Wave 0 |
| SC-3 | literal pin Python to TypeScript; reader strict; each hop RED when neutered; sentence renders | vitest | `npx vitest run src/__tests__/<new-literal-pin>.test.ts src/lib/queries.my-allocation.test.ts src/lib/factsheet/allocator-portfolio-payload.test.ts "src/app/factsheet/[id]/v2/FactsheetView.kpistrip.test.tsx"` | Wave 0 / yes (edit) |
| SC-4 | no |r| > 50% attributed to cash-basis options in the founder's book after the recompute; recomputed cumulatives; 10-28 explained | PROD read (orchestrator, marker first, counts and ratios) | read-only SQL, after the nightly derive | Wave 0 baseline |
| SC-5 | tests RED on today's cash basis; uncomputable day null (or cash-flagged per F2) | neuter drill | byte backup, neuter, `pytest`, restore, `cmp` | Wave 0 |

### Sampling Rate
- Per task commit: the quick run command plus mypy for any Python touched.
- Per wave merge: both suites' touched files plus `npm run typecheck`, `npm run lint`.
- Phase gate: full suites green, CI checks counted on the head SHA, then `/gsd-verify-work`; SC-4 is the orchestrator's post-deploy reading.

### Wave 0 Gaps
- [ ] Read-only dry run (orchestrator, in the worker, like 185-01): build the smoothed ledger for keys A and C from one crawl; print per day `stored_r` (cash) against `smoothed_r` for the 24 days with |r| > 0.3 and the 9 above 0.5; `N_held`; wall time of crawl and options step; bucketed pre-retention day count; any `LedgerValuationError` class; the `SMOOTHED_MTM_ENABLED` and `DERIBIT_OPTION_MARK_RETENTION_DAYS` values; `has_option_activity` per Deribit key (booleans). Counts and ratios only; the script is not committed while it holds key tags. **Gate: if most big days remain, replan again.**
- [ ] `analytics-service/tests/test_deribit_key_mode_options_basis.py` and an option-book ledger fixture with a marks start `S`.
- [ ] `src/lib/` flag module, `src/__tests__/` literal pin, adaptations of plans 06/07 tests.
- [ ] A pre-change baseline of the founder's book (the 185-01 SUMMARY says none was read).

## Security Domain

`security_enforcement` is not set to false in config (absent means enabled).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | unchanged |
| V3 Session Management | no | unchanged |
| V4 Access Control | yes | the caveat flag rides `allocator_equity_derived`, owner-SELECT under RLS, read with the allocator filter written out on the user client; service-role write only |
| V5 Input Validation | yes | strict `=== true` coercion on the TS reader, `is True` on the Python writer; unknown or malformed stored values read as absent |
| V6 Cryptography | no | no new secrets; API credentials are decrypted by the existing preflight |
| V7 Error handling and logging | yes | log exception class names only, never amounts, instruments with sizes, key ids or exchange error text (`scrub_freeform_string`, T-74-03) |
| V10 Malicious code / supply chain | no | no package installed |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Silent loss of the caveat (literal drift across languages) | Tampering | one literal pinned by a raw-file test, neuter-drilled |
| Truthy coercion shows or hides the caveat wrongly | Tampering | `is True` writer, `=== true` reader, tests for `"true"`, 1, false |
| Unbounded public-endpoint loop in the derive | Denial of service | `asyncio.wait_for` slice, floor, degrade; no whole-derive retry |
| Disclosure of PROD identifiers in tracked text or logs | Information disclosure | keys named A/C, ratios only, uncommitted dry-run script |
| A permanent FAIL on a soft failure freezes a user's curve | Denial of service (availability of correct data) | local fallback to cash plus caveat |

## Sources

### Primary (HIGH confidence): the repo at HEAD of branch `feat/185-planning`, read this session
- `analytics-service/services/job_worker.py` (`run_derive_broker_dailies_job`: the MTM and smoothed passes, RT-4 guard, key-mode block, `apply_marks` call, key_inputs epilogue; `TIMEOUT_PER_KIND`; budget constants)
- `analytics-service/services/deribit_txn.py` (bases, `txn_rows_to_native_daily`, `replay_option_positions`, `option_mtm_daily`)
- `analytics-service/services/deribit_ingest.py` (`build_deribit_native_ledger`, `_build_smoothed_option_mtm`, `fetch_deribit_option_daily_marks`, retention constants, ledger pacing)
- `analytics-service/services/native_nav.py`, `broker_dailies.py` (`combine_native_ledger`, `native_ledger_*`), `nav_marks_apply.py` (module docstring rules 1-14), `nav_marks.py`, `allocator_equity_compose.py` (`portfolio_returns`), `basis_series.py`, `closed_sets.py`
- `src/lib/queries.ts` (`readMarksStart`), `src/lib/factsheet/allocator-portfolio-payload.ts`, `src/lib/factsheet/composite-read-path.ts`, `src/lib/factsheet/types.ts`, `src/app/factsheet/[id]/v2/FactsheetView.tsx`, `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx`, `.../EquityChart.tsx`
- `CHANGELOG.md` (v0.133.13.0 G-01, v0.133.1.2 chain move, v1.14 smoothed dark launch, 168), `TODOS.md` (GLB-1), `docs/runbooks/derivecron-go-live.md`, `DESIGN.md`
- Executed this session: `chain_linked_twr` oracle; `pytest` on two modules; version commands
- `.planning/phases/185-*/185-CONTEXT.md`, `185-01-SUMMARY.md`, `185-06-PLAN.md`, `185-07-PLAN.md`, ROADMAP `### Phase 185`

### Secondary (MEDIUM): the Deribit implausible-returns debug session (local, untracked): used for the 07-11..07-13 shape and the earlier PROD reads; none of its identifiers are reproduced here.

### Tertiary (LOW): none. No web search was run: the phase is in-repo, and the venue's chart retention is recorded as an uncontracted behaviour (A2).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new libraries, versions run.
- Architecture (gates, seam, writer quantities): HIGH, read in full.
- Cost, retention behaviour, effect on the big days: MEDIUM to LOW, unmeasured; the Wave 0 dry run is the remedy.
- Pitfalls: HIGH where tied to a quoted code path.

**Research date:** 2026-11-01
**Valid until:** 2026-11-08 (the retention cutoff, `S` and the PROD flag values move; re-read the dry-run output before planning on it)

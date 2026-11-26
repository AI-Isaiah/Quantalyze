---
phase: 250-binancefills-a-binance-fills-read-walks-every-window-and-nev
plan: 08
subsystem: phase gates and ship hand-over (no production or test file edited)
tags: [binance, pre-push-gates, source-coverage-audit, ship-changelog, SC-4, SC-5]
status: complete
requires: ["250-07"]
provides:
  - "the targeted pre-push readings on the merged phase code (mypy strict on the touched files, 1856-test serial subset, plan-anchor verifier, planning hygiene)"
  - "the source coverage audit over the eight plans, no row left unplanned"
  - "the unified 'For the ship CHANGELOG' hand-over"
affects: []
key-files:
  created:
    - .planning/phases/250-binancefills-a-binance-fills-read-walks-every-window-and-nev/250-08-SUMMARY.md
requirements-completed: [SC-4, SC-5]
plan_head_before: aa9c405b6253cccc039994310b0f4e9b8e310554
plan_head_after: aa9c405b6253cccc039994310b0f4e9b8e310554
commits: 0
actuals:
  tokens: 9000
  tasks: 2
  commits: 0
---

# Phase 250 Plan 08: the phase gates and the unified ship CHANGELOG hand-over Summary

Verification and hand-over only: no production or test file is edited, and no gate, threshold or expectation was touched. The targeted gates are green on the merged phase code, the source audit finds every row delivered by the SUMMARY it names, and the ship has its complete CHANGELOG material. **The full-suite truth is NOT met locally: the full pytest run with coverage, its TOTAL line and the base-versus-head failure-list comparison are owed from CI (see the named deviation).**

`commits: 0` is measured from the per-plan ledger (`aa9c405b6..HEAD` held no commit when this file was written; the only change is this SUMMARY, which is a docs-only commit). The phase as a whole is 33 commits on top of the phase base `21b9ad929` at the time of writing.

## Source audit report (first lines, per Task 2)

No row of the audit below is left unplanned: every row is delivered by the SUMMARY it names. One row family carries a named deviation (the SC-5 and RESEARCH Q9 phase-gate halves owned by this plan, see "Deviations from Plan").

## Pre-push readings (Task 1)

Run from the phase worktree at HEAD `aa9c405b6` (250-07 merged), `ccxt` 4.5.89 confirmed by the precondition.

1. CI mypy strict, touched files only (coordinator load limit; the CI command covers `services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`):

```
$ cd analytics-service && .venv/bin/mypy --strict --follow-imports=silent --config-file=pyproject.toml services/exchange.py services/job_worker.py
Success: no issues found in 2 source files
```

(250-07's SUMMARY carries the full-surface reading taken by that plan at its own head: `Success: no issues found in 143 source files`. It is cited, not re-taken.)

2. Targeted pytest set, credential-free (`env -i PATH="$PATH" HOME="$HOME"`), serial, no coverage, from `analytics-service/`:
   `tests/test_binancefills_adapter.py test_binancefills_cursor.py test_binancefills_e2e.py test_binancefills_harness.py test_binancefills_walk.py test_exchange.py test_exchange_harness.py test_okxtrades_walk.py test_cron_router.py test_ana_recon_audit.py test_daily_pnl_read_verdict.py test_derive_broker_dailies_dualmode.py` plus the eight `tests/test_job_worker*.py` files.

```
1856 passed, 1 skipped, 115 warnings in 64.14s (0:01:04)
```

   A second run with `-rs -W ignore` (same set) read `1856 passed, 1 skipped in 62.33s`. The one skip, named per the fail-loud rule: `tests/test_job_worker.py:4326: LANE_DB_URL unset (local dev)`. It is a live-DB lane arm that needs the local Supabase stack; the coordinator load limit forbids booting one, so it is not run here and is not claimed. There was no failure, so no rerun-alone or base comparison arose. The planning-time network-dependent failure `tests/test_exchange.py::TestValidateKeyPermissions::test_invalid_credentials_returns_auth_error` did not recur in this set.

3. Plan-anchor verifier:

```
$ node scripts/verify-plan-anchors.mjs --pending
claims: 40 checked
OK: 15 plan file(s), no stale claims.
```

4. Planning hygiene:

```
$ npx tsx scripts/check-planning-hygiene.ts
[check-planning-hygiene] OK — 12354 tracked files scanned, none carry the local username or an absolute home path (rule 1 ...).
[check-planning-hygiene] ROADMAP-STRUCTURE (rule 6) OK — 34 phase headings, 34 checklist bullets, 34 Progress rows (...).
[check-planning-hygiene] STATE-POSITION (rule 7) OK — STATE.md's Current Position carries at most one each of Phase: Plan: Status: Last activity: Progress:
```

5. Scope fences: `git diff --quiet "$(git merge-base HEAD origin/main)" -- TODOS.md CHANGELOG.md` exits 0 (checked before this SUMMARY was written). VERSION and package.json are untouched by this plan. No Docker, local stack or `supabase` CLI command was run.

## Deviations from Plan

**1. [Coordinator load limit 2026-11-25] The full-suite pytest with coverage, its TOTAL line and the base-versus-head failure-list comparison were NOT taken locally; they are owed from the CI `python` job on the PR head SHA.** Task 1 step 2 (the CI pytest command with `-n auto --cov-fail-under=80`, the detached base worktree run, `comm -13` of the failure lists, the skipped-count comparison) and step 1 over the whole mypy surface were replaced by the targeted set above, by the coordinator's instruction after a previous session overloaded the developer machine while four other agents were running. No coverage number was measured by this plan and none is written here. The planning-time reading in the plan (`1 failed, 16689 passed, 93 skipped`, `TOTAL ... 95%`, `Total coverage: 94.92%` at d07e276b3) is the plan author's, taken on an earlier head, and is not evidence about this head. Consequence: the must_have "the CI pytest command with `--cov-fail-under=80` ... compared with the phase base" is not met by this plan; the ship's CI run on the PR head SHA is the instrument. No gate, threshold or test expectation was edited and no earlier plan's write scope was touched.

No Rule 1-4 deviation otherwise. Authentication gates: none.

## Source coverage audit

Re-checked against the SUMMARY of every plan each row names. Evidence is an arm name, a PROOF-01 id (N-number) or the SUMMARY section that delivers the row.

| Source | ID | Item | Plan | Status | Evidence in the SUMMARY |
|---|---|---|---|---|---|
| GOAL | — | A Binance raw fills read covers every window from its cursor to now and its cursor never stalls, silently or because one symbol fails; lands before `USE_RAW_TRADE_INGESTION` is on for Binance | 01-07, 08 (phase gates) | COVERED with a recorded limit: the quiet-prefix deadline case is a named, loud, bounded known limit by founder ruling 2026-11-25 (UTC), the one exception ROADMAP SC-1 names (07 records it, 02 names it at the switch) | 01 strict-xfail reproduction, 03 promotion, 07 "Known limit" bullet, 02 SC-4 sentence; 08's full-suite half is OWED from CI (deviation 1) |
| REQ | — | none mapped (ROADMAP); plans map to SC-1..SC-5 | — | N/A | — |
| SC | SC-1 | quiet stretch walked, newer fills reached, cursor never past stored data, RED test on today's code; one named exception (deadline-stopped quiet prefix) | 01 (strict-xfail reproduction), 03 (walk, promoted arm), 04 (pins), 05 (onboarding walks from the reach, N30), 07 (exception recorded, sync budget) | COVERED for every read that reaches now; the named exception is recorded as the founder-ruled known limit | 01 R2-02 strict xfail; 03 "R2-02 promoted ... passing end-to-end gate"; 04 N1r N2 N3 N4 N5; 05 N30 (`test_onboarding_without_a_since_walks_from_the_reach_and_returns_a_fill_older_than_seven_days`); 07 hand-over bullets |
| SC | SC-2 | failing symbol named every run, healthy symbols stored, transient span re-read | 02 (gate), 05 (producer, e2e) | COVERED | 02 `test_a_non_holding_flag_alone_stamps_the_newest_fill[unlisted-symbols]`, N7 N8; 05 `test_an_unlisted_symbol_is_named_and_not_held`, tracer e2e, N6 N8b N23 |
| SC | SC-3 | capped symbol named, cursor never past its unread fills, later run resumes past the cap | 03, 02, 06 (flags, bound, e2e resume; overlap pages exempt, N29), 07 (deadline kind) | COVERED with no exception | 06 N9 N10e N16 N21 N25 N29 (two-run e2e resume, full-overlap arm); 07 N13 (deadline kind); 02 N10 N11 N12 |
| SC | SC-4 | precondition for the switch recorded, naming the quiet-prefix exception | 02 (comment) + the ship CHANGELOG sentence handed over in 250-02-SUMMARY and collected by 08 Task 2 | COVERED | 02 "For the ship CHANGELOG (SC-4)" and the comment above `_RAW_TRADE_INGESTION_ENABLED` (acceptance greps in 02); the sentence is copied verbatim below |
| SC | SC-5 | PROOF-01 per gate | 01-07 (N0-N30, each in exactly one plan); 08 (phase gates) | COVERED for N0-N30 (each N-number is recorded in its owning SUMMARY: 01 N0; 02 N7 N8 N10 N11 N12 N20; 03 N1; 04 N1r N2 N3 N4 N5 N17 N18 N19 N22; 05 N6 N8b N14 N15 N23 N30; 06 N9 N10e N16 N21 N25 N29; 07 N13 N24 N26 N27 N28). The phase-gate half owned by 08 is PARTIAL: targeted gates green, full-suite coverage reading OWED from CI (deviation 1) | see the N-number census in the Status cell |
| CONTEXT | Founder ruling 2026-11-25 (UTC) | quiet-prefix case named, loud, bounded; the switch names it as an exception; sync gets about 840 s of its 900 s, reconcile keeps 240 s; the reconcile endpoint fix gets its own CHANGELOG line | 07 (limit, budget), 02 (exception at the switch), 05 (reconcile fix), 08 (every line collected) | COVERED | 07 hand-over bullets and constants; 02 SC-4 sentence; 05 hand-over item 2; the collected lines below |
| CONTEXT | Orchestrator decision 2026-11-25 (840 s leaves about 60 s) | the sync handler tail as a second named limit, T-250-19, in the ship CHANGELOG; the constant stays 840 s | 07 (constant comment), 08 (CHANGELOG line) | RECORDED | 07 "Known limit, the sync handler tail" bullet, Threat Flags (T-250-19 accepted); line below |
| CONTEXT | Orchestrator decision 2026-11-25 (overlap pages) | pages re-reading the 1 h overlap below the pre-overlap seed do not count toward `BINANCE_PAGE_CAP`; the cap stays 20; SC-3 without exception | 06 (exemption, full-overlap arm, N29), 07 (deadline check covers exempt pages, case (d)) | COVERED | 06 N29 and "Notes for later plans"; 07 case (d) of `test_a_deadline_stops_every_symbol_with_a_read_through_bound`, N13 |
| CONTEXT | [Window walk, R2-02] Shape of the fix | explicit until, windows of at most 7 days, oldest-first pages, empty window advances | 03, 04 | COVERED | 03 tracer commit (walk, constants, helper); 04 span and boundary arms |
| CONTEXT | [Window walk, R2-02] Seed when since_ms is None | walk from the reach, never a start-less request | 03, 04 | COVERED | 03 walk; 05 N30 pins the adapter caller |
| CONTEXT | [Window walk, R2-02] Seed older than the reach | clamp plus non-holding flag | 03 (producer), 04 (pins, e2e), 02 (non-holding arm) | COVERED | 02 non-holding arm; 04 clamp pins |
| CONTEXT | [Window walk, R2-02] Empty tail (CORRECTED 2026-11-25) | 232 stored-fill rule kept, no non-fill stamp; a deadline-stopped run over a quiet prefix is the known limit | 03, 02, 07 | COVERED | 02 gate arms; 07 quiet-prefix bullet |
| CONTEXT | [Unlisted symbols, R2-01] Healthy symbols advance | BadSymbol non-holding flag, other failures hold, total-failure raise unchanged | 02, 05 | COVERED | 05 `test_a_transient_failure_keeps_the_hold`, `test_every_symbol_unlisted_still_raises` (N8b), N23 |
| CONTEXT | [Unlisted symbols, R2-01] BadSymbol vs nothing to read | map measured and fixed (markets load, precedence), recovery text | 05 | COVERED | 05 `test_unloaded_markets_are_loaded_before_the_map`, N14 N15, hand-over item 1 |
| CONTEXT | [Page cap stop] Flag and resume | cap 20 per window, named, gate stamps at the bound, next run resumes | 03, 02, 06 | COVERED | 06 two-run e2e arm, N9 N21; 02 gate |
| CONTEXT | [Page cap stop] Holds versus the cap stamp | every hold wins | 02 | COVERED | 02 N10 N11 N12 |
| CONTEXT | [Budget] | deadline stop of the same shape as the cap; per the ruling a per-caller budget (sync 840 s, reconcile 240 s) | 07 | COVERED: stop shape, progress when each covered prefix holds a stored fill, per-caller budget | 07 N24 (ordering, 4 deadline-stopped runs then a run reaching now), N26 N27 N28, `TestBinanceFillsReadBudgetPerCaller`, `test_the_read_deadlines_are_pinned` |
| CONTEXT | [Write scope] | by symbol, 222 and 251 untouched; widened to one sync call-site argument and to the keywords `read_deadline_s` and `pre_overlap_seed_ms` on `fetch_raw_trades`' Binance branch | 01-07 (frontmatter `write_scope`), 06, 07 | COVERED | 06 "Write scope held" paragraph; 07 job_worker.py fence (two hunks) |
| CONTEXT | [SC-4 precondition] | declaration comment plus CHANGELOG, no prose test | 02 (comment), 08 (CHANGELOG sentence) | COVERED | 02 acceptance greps; sentence below |
| CONTEXT | [Tests] | venue-modelling fake, RED on pre-fix or neutered copy | 01 (helper, N0), all | COVERED | 01 `BinanceFillsVenue`, N0; every later plan's N-number record |
| RESEARCH | finding 1 | markets not loaded -> spot endpoint | 05 | COVERED (its own CHANGELOG line: live reconcile behaviour) | 05 `test_unloaded_markets_are_loaded_before_the_map` RED on the base, hand-over item 2 |
| RESEARCH | finding 2 | explicit derivative-over-spot precedence | 05 | COVERED | 05 collision arm, both orders, N15 |
| RESEARCH | finding 3 | one `binance_read_through_ms` scalar for cap and deadline | 02, 06, 07 | COVERED (plus the untimed kind) | 06 `test_two_stopped_symbols_record_the_smaller_bound_once`, N16; 07 deadline kind folded into the same list |
| RESEARCH | finding 4 | PROD holds no Binance data; budget is a bound | 07, 08 (CHANGELOG note, assumption A7) | COVERED | 07 quiet-prefix bullet ("PROD held 0 Binance keys on 2026-11-25"); line below |
| RESEARCH | Pattern 1 | 24-hour windows for a spot-resolved name | 03, 04 | COVERED | 04 `test_a_spot_only_symbol_walks_one_day_windows` |
| RESEARCH | Q1 | local BadSymbol raise for an unmapped name with loaded markets | 05 | COVERED by ccxt's own client-side `BadSymbol` (planner decision in 250-05; the DELISTEDUSDT arms exercise it) | 05 unlisted arms |
| RESEARCH | Q4 | read deadline 240 s; interleaving claim | 07 | COVERED; 240 s is the default (reconcile), the sync passes 840 s per the ruling, the interleaving claim is measured (07 Task 1, N24) | 07 N24, Task 1 greps |
| RESEARCH | Q6 | real ccxt plus venue fake; migrate the 14-test census | 01, 03, 04 | COVERED | 01 harness; 03 and 04 migration (13 migrated, source-inspection test kept green, per their SUMMARYs) |
| RESEARCH | Q6 | `newest_first` venue switch and its single-page arm | — | EXCLUDED: ccxt's `parse_trades` sorts every page, so no code path of this phase can be neutered to turn such an arm red; assumption A2 (venue order) stays UNMEASURED and is listed as a known limit | no arm by design; known limit below |
| RESEARCH | Q9 | CI mypy strict, CI pytest with coverage; ruff is not a gate | 08 | COVERED in part: mypy strict green on the touched files here (and on the full 143-file surface in 07); the CI pytest-with-coverage reading is OWED from the CI `python` job (deviation 1) | Pre-push readings 1 and 2 |
| RESEARCH | Open Question 1 | per-symbol loop order | 03, 07 | COVERED | 03 per-symbol tasks; 07 N24 |
| RESEARCH | Open Question 2 | reconcile log line for a stopped read | — | EXCLUDED: RESEARCH recommends out of scope; recorded as a CHANGELOG known limit (below) | known limit below |
| RESEARCH | Open Question 3 | `BinanceFillsOutOfWindow` self-check | 03, 04 | COVERED (N18) | 04 N18 |
| RESEARCH | Open Question 4 (RESOLVED, superseded 2026-11-25) | the more-than-20K-fills-within-1-hour stall | 06 | COVERED as resolved: the stall is removed (overlap pages exempt from the cap, N29); the plain cap WARNING stays for any cap stop (N21) | 06 N29, N21 |
| RESEARCH | Pitfalls 1-7 | markets, source inspection, all unlisted, overlap stall (removed by the exemption), NULL column anchor, hold beats stop, int sum | 02, 03, 05, 06 | COVERED | 02 NULL-anchor and hold arms; 03 source-inspection pin; 05 unlisted; 06 N29 |
| RESEARCH | Pitfall 8 | per-key cursor vs per-strategy symbols | — | EXCLUDED: RESEARCH says do not widen scope to it | — |
| PLANNING | measured 2026-11-25 | a `_record_dq_flag` inside a gathered `_fetch_one` task is lost (context copy); HEAD's `binance_fill_cursor_advance_plus1` never reaches the drain | 03 (fix), 04 (N22), every later plan (flags recorded in the parent, frozen contract) | COVERED | 04 N22; 06 and 07 record every flag in the parent result loop |
| CONTEXT | Orchestrator decision 2026-11-25 (third caller) | `BinanceAdapter.fetch_raw` on the LIVE onboarding path (`process_key_long`) reads through the walk; one arm drives it with no `since_ms`; its own CHANGELOG line; the adapter file is not edited | 05 (adapter arm, RED-on-HEAD, N30), 06, 07, 08 (own line, undrained flags as a known limit) | COVERED | 05 hand-over item 3, N30, `tests/test_binancefills_adapter.py` RED on the base; 06 and 07 "Notes for later plans"; lines below |
| REVIEW | checker 2026-11-25 warning 3 | HEAD's missing-timestamp guard stopped a symbol with a log line only | 03 (stop kind and bound), 06 (flag, N25), 02 (gate stop list) | COVERED | 06 N25 |
| REVIEW | checker 2026-11-25 warning 2 | a deadline stop's resumability | 07 | COVERED with a recorded limit: the ordering half by 07 Task 1 and N24; the quiet-prefix half is the founder-ruled known limit | 07 N24 and quiet-prefix bullet |
| REVIEW | checker iteration 2 warning 1 | more than 20,000 fills inside the 1 h overlap re-capped at the same instant every run | 06 | COVERED: the corner is removed by the overlap decision; no exception recorded | 06 N29 |
| REVIEW | checker iteration 2 warning 2 | 250-07 at its whole context budget | 07, 08 | COVERED: pre-push gates, source audit and hand-over moved to 08 | this SUMMARY (gates partial per deviation 1) |
| CONTEXT | Deferred Ideas | non-fill stamp, per-symbol cursors, flag clearing (Phase 251) | — | NOT PLANNED (deferred by CONTEXT); the founder ruling chose the known limit over the first two | — |

## For the ship CHANGELOG

One line per item, each on its own line so the ship entry can file it under its own heading. The ship writes CHANGELOG.md; this plan does not.

- Overlap-page exemption (250-06): re-read pages inside the 1 h overlap no longer count toward `BINANCE_PAGE_CAP`, so a capped Binance symbol always resumes past its cap on the next run; the cap stays 20 and no fromId paging is needed. A symbol whose walk stops at the cap, or at a full page with no timestamp, is named (`binance_page_cap_symbols`, `binance_untimed_page_symbols`).
- Known limit, the quiet-prefix deadline case (founder ruling 2026-11-25 UTC; the one named exception to ROADMAP SC-1, named at the switch): when a sync read is stopped by its deadline and its covered prefix holds no stored fill after the cursor C, the Phase 232 stored-fill stamp leaves the cursor at C and the next run re-reads the same prefix. Loud: a WARNING on every such run, and the flag `binance_deadline_symbols` on that sync's data-quality stamp (round-3 review: the chained `derive_broker_dailies` and CSV analytics writes rebuild `data_quality_flags` without `binance_*` keys, so the WARNING is the lasting signal; unconfirmed whether an early return in the derive skips the overwrite; routed to `[250-BINANCE-STOP-BELOW-CURSOR]`), bounded by the reach clamp; a deadline stop inside the 1 h overlap re-read is the same case, not a new exception. DERIVED region at the 840 s sync budget, not measured (the 229 ms per weight-5 request throttle was measured without network latency; the venue's out-of-reach behaviour is unmeasured; PROD held 0 Binance keys on 2026-11-25): about 3,668 requests per run; up to about 280 symbols a cold 85-day walk reaches in one run; at 300 symbols one run covers about 84 days, at 400 about 63, at 500 about 49, at 1,000 about 28.
- Known limit, the sync handler tail (T-250-19, DERIVED): the 900 s handler timeout covers the whole of `run_sync_trades_job`, the 840 s read clock only the read's requests, so about 60 s remain for the pre-read work, the at most five requests already past the deadline check (each bounded by ccxt's 10 s default timeout) and the persist of every fill read. A fill-heavy read that also runs to its deadline can exceed the handler timeout; then `wait_for` cancels before the cursor RPC, the upserted fills are kept, the job fails loudly as a timeout and the cursor stays; the next run then re-reads the same span to the same frontier, persists the same fills and times out again, so the stall repeats on every run (loud, permanent until the account's fills thin out), not one failed run; there is no fill-count stop (corrected by round-1 review WR-03). UNMEASURED term: the DB round-trip time from the worker. The constant stays 840 s per the ruling.
- Sync read budget: a Binance sync read now gets 840 s of the sync job's 900 s (`BINANCE_SYNC_FILLS_READ_DEADLINE_S`, founder ruling 2026-11-25 UTC); the nightly reconcile keeps 240 s (`BINANCE_FILLS_READ_DEADLINE_S`); the sync path is dormant in PROD while `USE_RAW_TRADE_INGESTION` is off.
- Known limit: the reconcile discards the read's flags, so a stopped read looks short to its diff (RESEARCH Open Question 2).
- Known limit: a same-millisecond cluster larger than one page is passed by the +1 step.
- Known limit: ccxt's `parse_trades` drops a venue row whose timestamp is missing or 0 whenever `since` is set, so such a row on a full page would shorten it below the limit and end the window early without a flag (UNMEASURED at the venue, where `time` is a documented field of every row; pre-existing at HEAD).
- Known limit: the venue behaviours RESEARCH lists as UNMEASURED (the USD-M and COIN-M result order for a time-bounded request (the spot order is documented: chronological, oldest from `startTime`), a `startTime` older than the reach, the 3-month line read through a summarising fetch).
- Known limit: healthy symbols' newer fills are re-read while a capped symbol catches up.
- Known limit: the onboarding caller `BinanceAdapter.fetch_raw` passes no overlap seed and drains none of the read's flags, so a cap, untimed, deadline or unlisted stop on that path is recorded nowhere (the HTTP key route in `routers/process_key.py` reaches the same read).
- Unlisted-span recovery (known limit, not a Fixed line, 250-05): a span skipped while a symbol was unlisted is recovered by a reconcile or a backfill with an explicit since; `binance_unlisted_symbols` names the symbol on every run and does not hold the cursor.
- Fixed, on its OWN line, never folded into the known limits (founder ruling 2026-11-25, 250-05): the nightly reconcile of a Binance key now loads markets before it maps stored symbols, so a stored linear symbol such as BTCUSDT is read from the USDⓈ-M futures endpoint instead of the spot endpoint and its diff compares the account's real fills. The reconcile is not gated by `USE_RAW_TRADE_INGESTION`, so this changes live behaviour on merge; PROD held 0 Binance keys on 2026-11-25 (RESEARCH Q4).
- SC-4 (250-02's sentence, verbatim): Keep `USE_RAW_TRADE_INGESTION` off for Binance until this release (Phase 250, SC-1 to SC-3) is on main; it is one of several venue conditions for that switch. One named exception to SC-1 ships with it (the quiet-prefix deadline known limit, founder ruling 2026-11-25 UTC): a sync read stopped by its deadline over a prefix holding no stored fill leaves the cursor where it was, named by `binance_deadline_symbols` on every such run and bounded by the reach clamp.
- Live onboarding read, on its OWN line: live Binance onboarding (`process_key_long`) now reads up to the 85-day reach, bounded by the 240 s deadline, instead of the venue's last 7 days. Pinned by 250-05's `test_onboarding_without_a_since_walks_from_the_reach_and_returns_a_fill_older_than_seven_days` (N30), RED on the base.
- Fixed (round-1 review CR-01, data-integrity): a Binance sync whose cursor column is NULL and that has no fills seed now anchors the column at the walk's real start (now minus `BINANCE_FILLS_REACH_DAYS`), so a stopped cold read that stamps nothing is re-read from the reach on the next run instead of from the daily high-water that run's own Phase 1 moved past the unread span. Pinned by `test_a_stopped_cold_read_is_re_read_from_the_reach_on_the_next_run` (neuter N-CR01).
- Venue order, recorded (round-1 review WR-02, rebutted in round 2): the spot `GET /api/v3/myTrades` order for a time-bounded request is documented, not unknown: the spot docs' General API Information says data is returned in chronological order and "With both, behaves like `startTime` but does not exceed `endTime`" (oldest items from `startTime`). A round-1 full-spot-page stop built on a misread of the `fromId` note was reverted before ship, so no behaviour change ships for it. The USD-M and COIN-M order for a time-bounded request stays UNMEASURED.
- Fixed (round-1 review SFH-3): the fills window is chosen from the market ccxt itself resolves (`exchange.market()`), not from `markets.get`, so a stored name ccxt resolves by venue id gets that market's window. Pinned by `test_a_name_ccxt_resolves_by_venue_id_is_windowed_by_that_market` (R1-N1). The `:USD` strip (which turns `BTC/USDC:USDC` into `BTCUSDCC`) is the consistent stored form across `normalize_symbol`, the symbol map and `services/positions.py`; it was not changed.
- Known limit, a recorded OPEN gap in SC-3, not covered by any founder ruling (round-1 review WR-01, round-2 review WR-01): when the cursor column is ahead of the strategy's newest stored fill, a bounded stop stamp is below the column and the forward-only `advance_sync_cursor` RPC drops it (migration 20260602173710), so the stopped symbol's span between its bound and the column is not re-read. Likeliest entry: the first sync of a second strategy on a key shared with another strategy (the column was set by the other strategy and this one has no stored fill or daily row). Each such run logs a WARNING naming the strategy, the column and the bound, and sets the data-quality flag `binance_stop_below_cursor`; it does not hold the cursor and does not close the gap. The flag does not last: the chained `derive_broker_dailies` job and the CSV analytics step rewrite `data_quality_flags` without the `binance_*` keys (pre-existing for every sync-time flag, `binance_deadline_symbols` included), so the WARNING is the lasting signal. The flag also misses a run where a stop and a partial symbol coincide (round-3 review). Closing the gap (an RPC change), the flag predicate and the flag's survival are booked as `[250-BINANCE-STOP-BELOW-CURSOR]` in TODOS.md. Pre-existing at the base.
- Ship-gate note: the full pytest-with-coverage reading and the base-versus-head failure-list comparison were not taken in this phase's worktree (coordinator load limit 2026-11-25); read them from the CI `python` job on the PR head SHA before claiming the full-suite truth.

## Known Stubs

None.

## Threat Flags

None. This plan edits no production or test file; T-250-20 (credential-free run: `env -i` used for every pytest and mypy run, no `supabase` CLI, no Docker) held, T-250-21 (base-versus-head comparison) is open by deviation 1 and owed from CI.

## Self-Check: PASSED

- FOUND: this SUMMARY; the hand-over and audit verify command of Task 2 is run after writing and printed `hand-over and audit OK` (see the final report).
- `git diff --quiet "$(git merge-base HEAD origin/main)" -- TODOS.md CHANGELOG.md` exits 0.
- No commit hash is claimed beyond `aa9c405b6` (the HEAD this plan started from); the 250-01..07 commits are in their own SUMMARYs.

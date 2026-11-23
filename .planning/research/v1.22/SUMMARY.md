# Project Research Summary

**Project:** Quantalyze, milestone v1.22 TRUTH: data you can trust
**Domain:** Hardening a live allocator-analytics platform (broker-key derives, factsheets, Holdings, alert paging). No new capability.
**Researched:** 2026-11-23
**Confidence:** HIGH for repo integration facts (read at worktree HEAD `1c361e676`). MEDIUM for build order and upstream library facts. LOW for the Deribit stale-returns cause, which nobody has diagnosed yet.

## Executive Summary

v1.22 is a correctness milestone. The goal is "every number, label and alert we show is correct, or it fails loudly". The scope is every open MEDIUM-and-higher `TODOS.md` entry: 21 topic groups plus the carried Phases 155.2, 157 and 221 to 225. The research agrees on what experts do with a fund-data pipeline like this one. A green job does not prove the data is fresh. A retry that heals a fault must not erase that fault. A partial read refuses by name rather than publishing as complete. One account counts once. One figure follows one convention across engines. Alerts follow an episode lifecycle: open once, recover once, close once. Every one of these is broken somewhere in the repo today, and most of the breaks fall into five shared seams. Those seams are the derive writer (S1), the compose reader (S2), the job lifecycle RPCs (S3), account identity (S4) and the ops-alert SQL (S5).

The approach: **add nothing to the runtime stack**, and run the milestone as root-cause fixes on those seams. Each seam gets one owning phase. Write and read sides of a contract ship in the same phase. All migrations go through one serial lane, because migrations auto-apply to PROD with no human stop. Order is the founder's: data integrity, then user-facing, then security, then the rest. Inside a tier, dependencies set the order. The milestone makes only three deliberate version or config moves. quantstats goes from 0.0.81 to 0.0.86 inside FIGUREMATH only, gated on per-metric decisions. `sentry-sdk` stays on 2.x, because 3.0.0 removes `before_send_transaction`, which the service's redaction depends on. And a scheduled full-history gitleaks scan runs on the gitleaks 8.30.1 binary already pinned.

The dominant risk is **a fix that looks done but cannot fail**. Examples: a retry budget raised so the nightly goes green; a test re-pinned to the new output; a cache that re-serves a failure; an alert test that checks the first tick only; a soak that agrees with the code because it is built from the same code; a census that reads a hand-copied list. The mutation runner proves only `supabase/tests/*.sql`. Most v1.22 gates are vitest, pytest or alert-path tests, and nothing in CI notices when their RED proof is missing. So the PITFALLS gate-proof protocol (neuter, RED on the named arm, byte restore, GREEN, recorded verbatim) has to be an explicit success criterion in every phase. The second risk is the order of number-moving changes against the 155.2 parity window. The third is the set of unresolved conflicts and founder calls listed under "Open Questions" below. Several of them block planning.

## Key Findings

### Recommended Stack

None of the 21 groups or the carried phases needs a new package. Every fix uses pinned libraries or repo-owned tooling: the prober, the mutation runner, the lint scripts, the local-stack lane and the gitleaks pin. (Source: STACK.md.)

**Core technologies (unchanged unless noted):**
- **quantstats 0.0.81 → 0.0.86, FIGUREMATH only:** upstream 0.0.82 to 0.0.86 fix estimators the repo still mirrors, CVaR above all. The bump must ship in the same PR as a per-metric decision record. The parity arms that go RED are the forcing function. Loosening a tolerance or re-pinning values without a decision is not a close.
- **`sentry-sdk` stays on 2.x (2.73.0):** add a Dependabot `>=3` ignore with a reason. Moving to 3.0 later is its own booked phase, after 221 and ALERTPAGE.
- **`@sentry/nextjs` 11.11.0 / Next 16.4.2:** client init (221) needs only `src/instrumentation-client.ts` plus the existing scrub. Do NOT adopt `use cache` / Cache Components. Fix SURFACECACHE inside `unstable_cache` and Cache-Control.
- **ccxt 4.5.89 (exact pin):** every Bybit, OKX and Deribit endpoint the venue fixes need is in the tagged source. Bump only together with a cassette refresh.
- **gitleaks 8.30.1:** for the full-history scan, suppress historical findings with commit-scoped `.gitleaksignore` fingerprints. Never commit a `--baseline-path` report: it republishes the literals and author emails. Do not use gitleaks as the diagnostic-log check; extend `refuse_credential_in_published_sql` instead.
- **No history rewrite, no new paging vendor, no Redis limiter backend, no `@upstash/ratelimit` 2.2.x.**
- **Contingency:** a PDF or XLSX parser for 155.2 only if the broker statements arrive in a form other than the terminal's HTML report. Decide that on the real file.

### Expected Features (behaviours that must hold)

"Feature" here means an observable invariant, not a capability. (Source: FEATURES.md.)

**Must have (table stakes, cross-cutting):**
- A job that ends `done` produced current data, checked outside the job (freshness = `computed_at` plus series end, never `last_sync_at`).
- A failed attempt's cause survives its successful retry.
- Every exchange read covers the whole account (every stable coin, settle type and window) or refuses by name.
- One account counts once on every surface.
- One convention per figure across the stored, factsheet and Scenario engines, or a labelled and pinned difference.
- Uncomputable values are null (`computed_at DEFAULT now()` is the clearest live violation).
- A withheld or re-running figure is withheld the same way on every surface (OG card, PDF, returns API, composer).
- An alert opens, recovers and closes once, and a failure in its own path is loud.
- A leaked credential is disabled at the source.
- Every gate is shown RED before it counts.

**Should have (differentiators):**
- An independent per-key freshness sentinel: newest return day against newest flow day and anchor day, for every venue.
- Per-attempt failure history for every job kind.
- Hash-based absence guards, so the `158-OPS-03` guard keeps working without the literal.
- An engine-parity test over all three engines.
- A recorded first-failure reason inside every "kept last good" refusal.

**Anti-features (never build):** retry until green; silent backfill; defaulting a never-computed timestamp; serving a cached failure; widening tolerances; history rewrite; a silent `200 deduped:true`; paging hourly on one flaky key; paging-path failures logged at WARNING; making drift or freshness block merges; fixing LOW/INFO entries.

**Out of scope (founder rulings):** composite work of any kind (223's composite half; the composite halves of `167.1.2-ORPHAN-COPY-FIX` and `L2214`); the latent Binance and sFOX groups; GLB-1. **MT5WEDGE** is event-gated and cannot be scheduled.

### Architecture Approach

The milestone adds no components. Contention, not load, is the constraint. `run_derive_broker_dailies_job` is one function of roughly 6,700 lines, and about six groups touch it. About ten groups may carry a migration. Treat a (file, top-level symbol) pair as the unit of contention, not a whole file, and list every plan's write scope by symbol. Never refactor the derive function in this milestone. (Source: ARCHITECTURE.md.)

**The five seams that decide build order:**
1. **S1 Derive writer:** `run_derive_broker_dailies_job` and its key-mode exits, `_native_key_usd_writer_basis`, `nav_twr.py`. Touched by MT5DERIVE2, DERIBITBOOK, Deribit stale returns, the BYBITREADS anchor and 155.2.
2. **S2 Compose reader:** `run_derive_allocator_equity_job` (no-capital machinery), `allocator_equity_derive.py` `read_writer_basis`. Touched by NOCAPITAL, HOLDINGSTRUTH (writer basis) and the stale-returns `out_of_window_flow`.
3. **S3 Job lifecycle:** the claim, reset, reclaim and mark-failed RPCs, the dropped-enqueue sweep, `enqueue_poll_positions_for_all_strategies`, `main_worker.py`. Touched by 175, JOBHEAL and 224.
4. **S4 Account identity:** `create-with-key/route.ts` `resolveByVenueIdentity`, `account_identity.py`, `api_keys.venue_account_id`. Touched by 225, four CONNECTTRUTH members, `167.1.2-MT5-FAILING-HOLDER`, HOLDINGSTRUTH reads and DBACCESS `L2267`.
5. **S5 Ops-alert SQL:** `ops_staleness_check()` and `cron_sync_tick()`, which share the `.up.railway.app` wildcard allowlist. Touched by ALERTREADERS and SECRETSHYGIENE.

**Patterns:**
- Preserve the first failure, then fix the root. Keep the deliberate M-1137 `last_error` clear and add history beside it.
- Refuse by name and keep last good (186 D-05).
- Writer and reader of one contract change in one phase.
- RED-first gates restored from a byte backup.
- Migrations form one serial lane, each rebased on the dump in `supabase/schema/functions/`.

### Critical Pitfalls

PITFALLS.md is the dimension that matters most here. Top pitfalls, each with its prevention:

1. **The retry that heals hides the first failure (175).** The claim RPC erases `last_error` on re-claim. That clear is deliberate and pinned twice. Three producers (re-claim after failure, a watchdog reset, the reaper) look alike. *Avoid:* add an append-only per-attempt record, written before the clear and distinguishing `worker_stalled` from a real error. Then read real nights of data, then fix the named cause (likely a lease heartbeat, shared with JOBHEAL `166.5.1`). Never close by raising retries or watchdog thresholds.
2. **`done` is not fresh.** A Deribit account has 90 `done` derives while its returns end weeks before its newest flow. The cause is undiagnosed. *Avoid:* diagnose read-only first. State the fix as an invariant (series end ≥ min(latest flow, anchor) − 1 day, or a named stale reason). Check it for every venue as its own gate.
3. **A venue-scoped fix for a class defect, and mocks that share the bug.** *Avoid:* before fixing, census every read path for the axis (coin, settle, currency, window, classifier word). Fix or decide every row, with a test per row. Flip the narrow pinning tests deliberately; never delete them. Use fixtures from real payload shapes. A probe that cannot tell the alternatives apart yields "undecided".
4. **Two engines, two constants.** Python uses 365.0 and ddof 1. TS uses 365.25 and ddof 0 on narrowed-range Sharpe. The `L2214` list names more bespoke stacks. *Avoid:* founder ruling first, then one named constant per language, a cross-language pin, a census of every annualising site, a reviewed re-baseline of the frozen spine, and a CHANGELOG note that figures move. Never re-run `regen_golden.py` in a constants PR.
5. **Migrations auto-apply to PROD with no human stop.** Hazards: data-reading `DO` guards, `CREATE OR REPLACE` written from memory, edits to applied migrations, the `workflow_dispatch` escape, Vercel deploys not ordered against the apply, and `DROP FUNCTION` with a live cron caller. *Avoid:* migration-reviewer and rls-policy-auditor clean before merge; rebase on the dumps; two PRs when TS depends on schema; census `cron.job` and RPC callers before a drop. The remedy for a refusal on TEST is to revert the merge.

The other pitfalls carry into phase criteria: caches re-serving old truth across deploys (5); alert episodes (6); rate limits keyed on the proxy IP (7); a credential removed but still valid or still needed as a needle (9); owner and anon surfaces diverging (10); passing by skip, cache or a suppressed run (11); a tautological soak (12); stale census pins (13); a transient read taken as no-capital proof (14).

## Gate-Proof Method (success-criterion material for every phase)

Most v1.22 gates are vitest, pytest or alert-path tests, and **no machine proves they can go RED**. The roadmapper should therefore write the following into every phase's success criteria. (Source: PITFALLS.md §C.)

1. **RED on today's code first.** A defect-fix gate must fail on pre-fix code and name the arm. A gate written after the fix and never seen failing is unproven.
2. **Neuter, then restore from bytes.** `cp` the file under test to the scratchpad. Re-introduce the defect with the smallest edit. The gate must go RED **with the expected named arm as the first failure**; RED on another arm is a failed proof. `cp` back, `cmp` against the backup, re-run GREEN. Never use `git checkout`, `restore` or `stash` on uncommitted work.
3. **Record it verbatim in the plan SUMMARY:** the neuter edit, the command, the RED line and the GREEN line.
4. **Per-kind rules:**
   - SQL gates carry `RED-UNDER:` and `RED-UNDER-M:` twins with a measured `occurrences`, and list the migration under test in `RED-UNDER-SETUP`. Otherwise mutation, including the nightly, cannot see it.
   - Money-math oracles import no production helper.
   - Census pins are exact-set, two-directional and derived from the source of truth.
   - Alert tests run on a fake clock across multiple ticks: a flaky key, a debt cleared between ticks, Sentry returning None, a pg_net 401.
   - Soak nudges: 1e-3 on a timed day, one deal moved by one day, a BTC account.
   - Freshness gates hold a series end back on a lane fixture.
5. **Census side effects:** a new SQL gate file or arm moves the mutation floors, the `unreachable:` set and the gate-family registries. Update them in the same PR. `WAIVED_CEILING` stays 0.
6. **Bind green to the head SHA** with the expected check count, and check main after merge. Never write the skip trailer.
7. **Forbidden closures** (PITFALLS §D.1), to be listed as non-closures in phase criteria:
   - a loosened tolerance or re-pinned values;
   - a ledger line added, or a new `skipIf`;
   - `rpc` put back on the retried side;
   - an edit to an applied migration;
   - a loosened apply-test refusal, or a `supabase-migrate.yml` edit;
   - an opt-out marker in the data-dependence linter;
   - a mutation waiver;
   - `158-OPS-03` closed on text removal alone;
   - `FORCE RLS` on `api_keys`;
   - drift used as a gate.

## Implications for Roadmap

New phases number after 225. The order follows ARCHITECTURE's waves, reconciled with the founder's tier order.

### Wave 0 (now, parallel, no seam conflicts)
**Rationale:** these items unblock later phases and touch no shared seam.
**Delivers:**
- **MT5SOAK** as an independent oracle: BTC floors, timed-day NaN and implausible values, an independent per-day attribution walk. It must land before the `nav_twr.py` edits.
- A read-only Deribit diagnosis (`/gsd-debug`).
- The read-only PROD counts that gate later phases (see Open Questions).
- The founder decision queue.
**Avoids:** Pitfalls 12 and 2.

### Phase A: JOBLEDGER (175 readable-first-failure half + JOBHEAL)
**Rationale:** S3 owner. Its deploy starts the clock for reading 175's root cause from real nights.
**Delivers:** per-attempt failure record (MIG, rebased on `20260927120000_claim_pair_pre_rank_exclusion.sql`, carrying its self-verify forward); `reclaim_stuck_compute_jobs` calls `sync_strategy_analytics_status`; the first-hop drop gets its own signal; the readmit ceiling emits a signal; lease or heartbeat (latent).
**Avoids:** Pitfalls 1, 2, 8. **Criterion:** a lane test where attempt 1's error stays readable after attempt 2 succeeds; a watchdog reset leaves a reason.

### Phase B: 225 ONEACCOUNTONCE (+ CONNECTTRUTH identity members + `167.1.2-MT5-FAILING-HOLDER`)
**Rationale:** S4 owner. HOLDINGSTRUTH reads and DBACCESS `L2267` depend on the identity value it settles. It must land before 155.2 plan 12, because it changes what MM3 publishes.
**Delivers:** same-owner duplicates refused by name, cross-user sharing still allowed; `L4105` server-qualified MT5 identity (MIG plus a backfill, with no data-reading DO guard); `L4097` validates a rotated password; draft clashes and orphan copy name the key.
**Avoids:** Pitfalls 8, 10, 14. **Criterion:** tests for both the refused case and the allowed cross-user case; existing pairs surfaced, never merged.

### Phase C: MT5DERIVE2 (rest) + `167.1.2.2.1-WRITER-BASIS-VALUES`
**Rationale:** writer and reader of the writer-basis contract change together. Lands after MT5SOAK and before 155.2 plan 12.
**Delivers:** `nav_twr.py` fixes (empty-cohort refund, day-0 P&L, D-15 band ruled or fixed); basis-silent-None counted or blocked; the 175 root-cause fix once the data exists; `202-MT5-CLOCK-LEAD-01` replayed under both clock settings.
**Avoids:** Pitfalls 1, 14.

### Phase D: Venue reads (223 FLOWKINDS flow-source half, rewritten, + BYBITREADS + OKXTRADES)
**Rationale:** these share `exchange.py` but not symbols, so they are parallel-safe with symbol-scoped write lists. OKX's cursor member shares `run_sync_trades_job` with 222.
**Delivers:** the venue-by-path census table; Bybit all-coin anchor, USDC and inverse positions, a full trade window; OKX mixed-currency bills converted or refused, truncation completed, the cursor never ahead of stored data; 223's funding-caller decisions and the malformed-count ruling; the Bybit on-chain deposit verdict decided on probe evidence.
**Avoids:** Pitfall 3.

### Phase E: DERIBITTRUTH (DERIBITBOOK + stale returns + the freshness sentinel)
**Rationale:** diagnose first. It comes after Phase C merges, because candidate (a) is the key-mode exit MT5 also uses.
**Delivers:** the stale-returns root fix; a per-venue freshness invariant gate (it pages, never blocks CI); the correction classifier fixed with per-shape fixtures; the 185 cumulative explained or withheld by name; 189 only if it stays in scope (see Open Questions).
**Avoids:** Pitfall 2. Never backfill, never apply a plausibility bound.

### Phase F: NOCAPITAL (S2, parallel with D) and Phase G: HOLDINGSTRUTH reads (after B)
**Delivers:**
- NOCAPITAL: transient-zero MT5 keys keep their capital; any exception reverts the row; a counted payload flag on fallback; no residue reason left.
- HOLDINGSTRUTH: identity-read misses fail loud; match scoring treats unpriced days per account; the dashboard surfaces `markerReadError`; every failing shared-account key is named.
**Avoids:** Pitfalls 10, 14.

### Phase H: FIGUREMATH
**Rationale:** it moves published figures everywhere, MT5 included. Founder ruling first. It lands after 155.2 plan 14, or before plan 12 if the ruling comes early. It needs a fleet re-derive.
**Delivers:** one year length and ddof per metric class; cross-language pin and census of annualising sites; quantstats 0.0.86 with per-metric decisions; the CAGR empty-span rule; a spine re-baseline as a reviewed act.
**Avoids:** Pitfall 4.

### Wave 2, user-facing: FACTSHEET (FACTSHEETHONEST + SURFACECACHE + DBACCESS `RANK-SPLAT-01`), 222 ALERTTRUTH, CONNECTTRUTH remainder, RATELIMITFAIR
- FACTSHEET has one owner for the OG route and `fetch-and-build-payload.ts`. It needs a reader-census test, a good-after-bad-within-TTL test on the real cache wrapper, failures thrown inside the cache callback, and owner and anon tests per surface.
- 222 needs a copy census for "contact support" and a MIG on `computation_error_copy`.
- CONNECTTRUTH remainder: `L2510` error-body code and the CSV month names. Coordinate `csv_validator.py` with 222.
- RATELIMITFAIR waits on a founder call and must avoid keying on the proxy IP.
- **Avoids:** Pitfalls 5, 7, 10.

### Wave 3, security: SECRETSHYGIENE, DBACCESS (rest), 221 SENTRYSCRUB2 (+ SENTRYHELD)
- **SECRETSHYGIENE** goes first. The founder deletes the demo accounts on every project, recorded with a date. The text PR then redesigns the absence guard to use a digest needle that can still go RED, and retires the seed and drain coupling. The same phase narrows the S5 wildcard in both functions in one migration, which ALERTS later rebases on. It also adds the full-history scan and a positive redaction scan.
- **DBACCESS:** `L2267` trigger after 225; role timeouts only after a TEST measurement; the watchlist RLS spec wired into CI.
- **221:** scrub before client init. SENTRYHELD is caller-only.
- **Avoids:** Pitfalls 8, 9, 10.

### Wave 4, the rest: ALERTS (ALERTPAGE + ALERTREADERS), 224 DEADLEFTOVERS (+ `FANOUT-COHORT-SIBLING-POLL-01`), SQLGATES2, TESTLANES
- **ALERTS:** episode model; fake-clock scenario tests shown RED first; delivery read from `net._http_response`; every new check in the prober manifest.
- **224:** census of `cron.job` and RPC callers before any drop; the contradiction resolved first.
- **SQLGATES2:** the apply-test seeded-vs-applied fix comes before the forward comment correction; censuses derived from their source.
- **TESTLANES:** ledger driven to 0 with no assertion weakened; lint run without cache in CI; the supautils check measured on the PROD image version locally.
- **Avoids:** Pitfalls 6, 8, 11, 13.

### Outside the wave order
- **155.2:** statements → plan 12 recapture after Phases B and C deploy → plans 13 and 14.
- **157:** same founder sitting as 155.2; the password rotation comes after the last live read.
- **MT5WEDGE:** waits on a real wedge.

### Phase Ordering Rationale
- S3 and S4 come first because later phases read their output (Pattern 3 and the identity dependency).
- Strictly sequential pairs:
  - Phase C → Phase E (shared key-mode exits);
  - Phase A → the 175 root-cause fix (needs data);
  - Phase B → Phase G → DBACCESS `L2267`;
  - any S5 migration → the next S5 migration;
  - SQLGATES2 apply-test fix → its comment correction;
  - 222 ‖ OKXTRADES only with symbol-scoped writes.
- Number-moving changes (MT5DERIVE2 `nav_twr.py`, FIGUREMATH, 225's MM3 duplicate, NOCAPITAL if an MT5 key is no-capital) merge before 155.2 plan 12 or after plan 14, never in between.
- One migration-bearing PR open at a time.

### Research Flags
- **Diagnose or research first (`--research-phase`):**
  - Phase E DERIBITTRUTH (undiagnosed; debug session first);
  - Phase C MT5DERIVE2 (175 cause unmeasured; 202 needs a replay);
  - Phase A JOBHEAL lease design and the false-positive analysis for the first-hop signal;
  - Phase D (venue census, Bybit on-chain probe, OKXHISTORY overlap check);
  - Phase H FIGUREMATH (per-metric quantstats decisions);
  - DBACCESS lock-hold (TEST measurement as a client role);
  - TESTLANES supautils (PROD-image measurement);
  - Phase B (PROD duplicate count, `L4105` backfill design).
- **Standard patterns (skip research):**
  - SURFACECACHE (the throw-inside-callback house pattern exists);
  - SENTRYHELD;
  - the 221 ordering;
  - the SQLGATES2 census fixes;
  - RATELIMITFAIR once the founder call is made;
  - MT5SOAK.

## Open Questions: founder rulings and read-only measurements needed before planning

Collected from all four files and listed, not resolved.

**Conflicts between records or files (Rule 7):**
1. **Phase 223's goal text is composite-worded.** ROADMAP's goal and SC-1/SC-2 name `run_stitch_composite_job` and the composite member read. The founder ruled flow-source only. The section has to be restated before any planner reads it. What survives: SC-3 minus the composite member read, and SC-4. Proposed adds: `186-BYBIT-ONCHAIN-DEPOSIT-UNVERIFIED`. Proposed delete-list items: `180-BYBIT-LIVE-FLOW-KINDS` and `186-COMPOSITE-MEMBER-READ-GAPS`.
2. **224 vs `FANOUT-COHORT-SIBLING-POLL-01`.** 224 says the `poll_positions` enqueue has fired nothing since 2026-06-14 and should be retired. The cohort entry says the fan-out is live and should be widened. Both cannot be true. It needs one read-only PROD count of `compute_jobs` kind `poll_positions` by day before either phase plans.
3. **FIGUREMATH constants.** The v1.8 Key Decision names 365 (calendar) for CAGR and Python follows it. The TS engines use 365.25, and no decision covers ddof (Python 1, TS narrowed-range Sharpe 0). Either the TS engines move to 365, or the founder amends the decision. Either way published figures and the frozen spine move.
4. **quantstats CVaR estimator.** 0.0.83 retracted the 0.0.81 mixed estimator the repo mirrors. The choice is closed-form normal ES or historical, plus a minimum-observation null rule. STACK leans historical (MEDIUM confidence; a founder domain call). Also unmeasured: whether NaN reaches the live `win_rate` after Phase 188's null tiny-base days.
5. **CONNECTTRUTH identity entries vs Phase 225.** FEATURES assigns three (`DRAFT-CLASH-SAYS-SO`, `L4097`, `L4105`) to 225. ARCHITECTURE assigns four, adding `167.1.2-ORPHAN-COPY-FIX`, plus `167.1.2-MT5-FAILING-HOLDER`, which FEATURES lists under MT5DERIVE2. The roadmapper has to pick one assignment.
6. **The 155.2 freeze window and plan numbering.** The scope file says "plans 14–17". ROADMAP shows plans 11–14 open and 15–17 shipped; FEATURES trusts ROADMAP as the newer record. The freeze rule (merge before plan 12's recapture or after plan 14) needs confirming against the real plan numbers, and someone must decide which number-moving phases go before it and which after.
7. **`164.8.4-REDACT-NO-POSITIVE-SCAN`** carries a founder decision of 2026-09-19: "NO PHASE, stays a TODO". It is in scope only because the 2026-11-23 "all MEDIUM+" ruling may supersede it. Confirm, and record the supersession.
8. **`189-OPTIONREPLAY-NEXT-MILESTONE`.** PROJECT.md's v1.20 Key Decision says the venue-specific phases (187, 189) left the milestone, and the row is still "Pending (owned by TODOS until re-booked)". The scope file and FEATURES put 189 in DERIBITBOOK. Confirm whether 189 is in v1.22. If it is, every worker run needs founder approval and `SMOOTHED_MTM_ENABLED` stays off.
9. **The full-history scan's historical findings: fingerprint or fake?** STACK recommends `.gitleaksignore` fingerprints. PITFALLS prefers making the fixture literals obviously fake rather than allowlisting them. The finding count is also unsettled: 37 on 2026-09-17 (WINDOWS entry 61), a different set on 2026-09-05, neither re-measured. Also decide whether a red scheduled scan may attach a failing check to main's head and block a Railway redeploy (the D-11 coupling).
10. **SENTRYHELD ordering against 221.** FEATURES and ARCHITECTURE say both sites are server-side and caller-only, so 221 does not block them. PITFALLS says land SENTRYHELD after 221. Pick one.
11. **Where the S5 allowlist fix lands.** ARCHITECTURE puts SECRETSHYGIENE's wildcard fix first, before the wave-4 alert phase. PITFALLS pairs the `ops_staleness_check` edit with 222. Confirm one serial owner order for the three S5 migrations.

**Founder rulings needed:**
- `166.5-COMPUTED-AT-NEVER-COMPUTED-DEFAULT` reverses CONTEXT R-04 (nullable `computed_at`).
- `164.6.6.2.3-D15-THRESHOLD-BAND`: fix, or record as accepted.
- `L2244`: audit row or external alert.
- RATELIMITFAIR: a per-IP anon tier via the signed claim, or a raised shared tier.
- `SYNCTRADES-ENQUEUE-DONE` (222): the behaviour.
- `170.1-CSV-ODD-SPELLING-REJECTED`: accept the rejection, or parse month names.
- `164.6.6.3.3-WITHHELD-RESIDUE`: the three deferred D6 items.
- `186-REALIZED-MALFORMED-COUNT`: the refusal ruling after the count.
- `L4097`: the product call on a rotated-password reconnect.
- `L2267`: architecture sign-off.
- `164.9-LIVEDB-LANE-EXECUTION-CENSUS`: a migration or an invariant for the wizard RPC role gate (42501).
- `LINT-CACHE-MASKS-WARNINGS`: `--no-cache` in CI, or drop the `restore-keys` fallback.
- The quantstats and fleet re-derive window.
- `158-OPS-03`: the founder (or an authorized agent per standing PROD-write rules) deletes the accounts on TEST and PROD, recorded with a date.
- The absence-guard redesign (a digest needle) and the seed/drain coupling, decided explicitly in the SECRETSHYGIENE plan.
- Whether to amend `202-MT5-CLOCK-LEAD-01`'s assignment.

**Read-only measurements before planning:**
- `poll_positions` jobs by day (item 2).
- Same-owner duplicate account count (225).
- `daily_pnl_malformed_<venue>` per key (223).
- Bybit on-chain deposit rows (whether the probe can tell replace from union).
- Published native-unit strategy count (the Discovery ranking trigger).
- The Deribit stale-returns diagnosis for the one key: which keys write rows, and which the compose reads.
- Whether OKXHISTORY (167.1.2.2.2.1) already closed `OKX-PERSISTENT-TRUNCATION`.
- Analytics-service replica count on Railway (the `memory://` limiter is per-replica).
- Whether a `prod-prober` arm already asserts `match_engine_cron` cadence. Also, match-engine ticks return `processed:0`, a separate founder question.
- Whether PostgREST honours role-level timeouts (TEST measurement).
- The supautils function-denial crash on the PROD image version, reproduced locally and never against PROD.
- The landing page's render mode before relying on `after()`.
- A fresh full-history gitleaks count.
- Whether the Bybit static egress allow-list (`167.1.2.2-BYBIT-STATIC-EGRESS`, a founder action) is in place. Without it, live Bybit verification is partly blind.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH (repo) / MEDIUM (upstream) | Pins read at HEAD. Upstream changelogs, registries and ccxt tags read from primary artifacts, but the fetch seam rates web as LOW. The no-new-package verdict is robust. |
| Features | HIGH (repo) / LOW (external practice) | Paths and symbols confirmed at HEAD. PROD figures are triage or TODOS readings, not re-measured. External practice notes are context only. |
| Architecture | HIGH (integration) / MEDIUM (order) | Seams and latest migration bodies identified by symbol. Build order rests on unmeasured PROD readings and the open conflicts above. |
| Pitfalls | HIGH | Each pitfall read at HEAD with its mechanism. Two mechanisms are marked as hypotheses (the batch-mate reset as the 175 producer; the stale-returns candidates). |

**Overall confidence:** MEDIUM-HIGH. The repo facts are solid. The order and several phase scopes depend on the open questions above.

### Gaps to Address
- **The Deribit stale-returns cause** is unknown, so its phase size ranges from S (a named tiny-base reason) to M (a real gap). Diagnose before planning.
- **The 175 root cause** cannot be known until per-attempt history has collected real nights.
- **PROD readings** throughout are triage-dated (2026-11-23 or earlier), and none were re-measured by this research. Re-measure at HEAD before acting.
- **Line numbers** in TODOS and the triage have drifted. Cite by symbol.
- **The v1.18 `.planning/research/PITFALLS.md`** still governs 155.2's own pitfalls: tautological oracle, window-end trap, basis mismatch, tolerance drift.

## Sources

### Primary (HIGH confidence)
- Repo at worktree HEAD `1c361e676`:
  - `analytics-service/` services, routers, scripts and tests;
  - `src/` lib, app and tests;
  - `supabase/schema/functions/` and `supabase/migrations/` (latest body per function);
  - `scripts/` (mutation runner, floors, lints, live-DB ledger, prober);
  - `.github/workflows/`.
- Planning records: `.planning/PROJECT.md` (Current Milestone, Key Decisions), `.planning/ROADMAP.md` (155.2, 157, 221 to 225), `.planning/milestones/v1.18-REQUIREMENTS.md`, `.planning/debug/derivecron-compose-divergence.md`, `.planning/WINDOWS.md` entry 61.
- Next.js 16 bundled docs (`after.md`, `unstable_cache.md`, `instrumentation-client.md`).

### Secondary (MEDIUM confidence)
- `TODOS.md` entries by id (recorded readings).
- The founder scope file and TODOS triage (2026-11-23).
- quantstats CHANGELOG 0.0.82 to 0.0.86.
- sentry-python 3.0.0 CHANGELOG and migration guide.
- ccxt source at v4.5.89 and v4.5.93.
- gitleaks v8.30.1 README and `detect/baseline.go`.
- PyPI, npm and GitHub release registries.
- Supabase pg_net docs (cross-checked against the repo).

### Tertiary (LOW confidence)
- Bybit v5 execution-list and position-list docs.
- GIPS large-cash-flow Q&A.
- Datadog on data freshness.
- PagerDuty on dedup.
- GitHub Docs on removing sensitive data.

---
*Research completed: 2026-11-23*
*Ready for roadmap: yes, conditional on the Open Questions items marked as blocking planning (223 restatement, the 224/FANOUT count, the FIGUREMATH ruling, the CONNECTTRUTH/225 assignment, 189's scope).*

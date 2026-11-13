# Quantalyze

> Reconstructed 2026-06-21 at the v1.1.0 milestone start. The prior PROJECT.md
> was lost during the v1.0.0 archival (STATE.md still pointed at it). Validated
> requirements below are inferred from MILESTONES.md + the live codebase.

## What This Is

Quantalyze is a platform that connects capital **allocators** with quant
**strategy managers**. Allocators get a mandate-aware "Bridge" recommendation
engine that matches strategies to their book, can act on those recommendations,
track whether they actually worked, and inspect every strategy through
institutional-grade factsheets. Strategy managers onboard track records via
broker API keys (OKX, Bybit, Binance, Deribit; sFOX dormant behind a flag), CSV upload, or a
read-only MT5 account sync, and get the same factsheet surface. There is also an admin role.
Since v1.20 the numbers on every one of those surfaces carry their basis: published rankings
exclude failed computations, annualization follows the attested venue, a refused or truncated
read says so by name instead of publishing a partial curve, and a share link is revocable.
Since v1.21 the app reads as one product: each role lands on its own page, a strategy has one page
(the factsheet), a figure means the same thing on every page and is withheld on a short record,
viewing writes nothing, and the public site tells one true story with the demo retired.

## Core Value

Allocators act on Bridge recommendations and see whether those suggestions
actually worked — and can model the impact of composition changes before they
make them.

## ✅ Shipped: v1.21 UX — trustworthy, navigable, lean (2026-11-06 → 2026-11-13)

**Closed 2026-11-13 with audit `tech_debt`** (`.planning/milestones/v1.21-MILESTONE-AUDIT.md`): requirements
**32/32** satisfied, phases **18/18** verified `passed`, integration 10/10 seams and 3/3 flows, app version
v0.133.24.0 through v0.133.39.0. Phases 192 to 206 with inserted decimals (194.1, 194.2, 201.1).

**Delivered** (from the five-persona UX review of 2026-11-06; trust first, fix and trim only):
- **Trust (192, 193, 194, 194.1, 194.2, 205)** — public claims made true and consistent and the public demo
  retired (D-11); a wheel never changes a chart's range and a narrowed range is never restored; no developer or
  demo text on a factsheet; one figure gate (`figure-gate.ts`, D-15 total-record rule) on every figure path;
  opening a page writes nothing.
- **Navigation (196, 197, 198, 199, 200)** — a landing page per role (`/home`); a strategy has one page, the
  factsheet, with a back link and a next step; Compare from a discovery selection; My allocation in three tabs that
  answer "how is my book doing?"; one key panel showing what each key feeds, with confirmed re-pointing and one
  rename place.
- **Clarity (197, 201, 201.1)** — discovery columns state period and basis, stale strategies flagged, a glossary
  behind specialist terms, one name per concept, one date format, and the residual UAT polish.
- **Lean (195, 196, 198, 199, 200)** — `/portfolios`, the dark-mode option and leftover panels gone and Decks hidden; one
  strategies list; the factsheet opens as a summary with the rest under Advanced.
- **Residual (202, 203)** — the 188 SC-4 value churn attributed or named unexplained (1142 of 1214 attributed, 72 unexplained), and book b3's reasons explained.
- **Hardening (204, 206)** — the intro path's database-side authorization matches the route; a revoked but
  unexpired session cookie no longer loops the signed-in bounce.

**Close notes:** the pre-close `audit-open` check was skipped by founder decision because it refuses on archived
history (seven older VERIFICATION statuses outside its closed set); recorded in the audit and MILESTONES.md. The
composer's range-as-dates fix is decided and booked for the next milestone (`201.1-COMPOSER-RANGE-AS-DATES`).

## ✅ Shipped: v1.20 Backlog Burndown (2026-08-20 → 2026-11-06)

**Closed 2026-11-06 with audit `tech_debt`** (`.planning/milestones/v1.20-MILESTONE-AUDIT.md`): requirements
**62/64** satisfied, phases **142/142** verified `passed`, integration 9/9 seams and 4/4 flows, app
version through v0.133.23.2. No requirement is unsatisfied or orphaned; the two that are not
satisfied are accounted for below. Phase numbering ran 158 → 191 with inserted decimals (150 phases
in the roadmap, 142 delivered).

**Delivered:** the largest relevancy-ranked, agent-deliverable slice of the verified-open backlog,
in the groups it was scoped as — and `TODOS.md` was left telling the truth (included items deleted
into `REQUIREMENTS.md`, 31 verified-stale entries closed).
- **RANK (159, 160)** — failed/stale-computation KPIs out of every published percentile; anon
  `strategy_analytics (*)` splats replaced by explicit projections; `api_keys.exchange` server-authoritative
  at every INSERT with a census-guarded `REVOKE INSERT`; the √365/√252 stamp derives from the attested
  venue (null-attestation guarded); quantstats sign-flip and blend-annualization default closed; FILL-arm CAS.
- **SHARE (164)** — Copy Link always yields a viewable, revocable per-strategy token link; the id stays a
  non-secret; the token lane never poisons the id-keyed public cache (adversarial acceptance).
- **WIZERR (161) / HONEST (162, 163)** — thirteen error surfaces stop rendering `UNKNOWN` or false
  sentences; no raw Python exception as copy; freshness badges follow series recency; real equity curves;
  the clicked key preselected.
- **OPS (158, 163) / SEC (163)** — an external FIFO mutex plus a `cancelled`-conclusion watcher close the
  shared-test-db eviction that silently skipped the Railway deploy (#616); `sql-tests` gated; orphaned e2e
  specs run; structlog redaction closed at both failure modes; password policy measured; `.planning`
  username scrubbed with a no-allowlist gate; RPC audit gate; `bridgeComputeLimiter`.
- **LEDGER (161.1)** — recurring strategy refresh for ledger-backed venues, shipped dormant behind two locks.
- **VAC (164.3)** — a control that cannot fail is caught by machine: the SQL-gate mutation runner,
  `sql-gate-lint`, plan-anchor verification and repo-vs-PROD/TEST drift gates run in CI.
- **Inserted follow-through (164.x, 166–191)** — everything the burndown surfaced and booked as it ran:
  prod observability and a single periodic prober; MT5 gateway isolation, relogin and native-unit (BTC)
  accounts; quantstats truth and recompute; credential-trust copy; allocator equity made marked-to-market
  (NAVMTM) with one stated price rule, the legacy equity curve retired (176), Deribit flow timing (185),
  derive gaps (186: a truncated or failed read refuses by name, a failing key affects only itself),
  tiny-base days left out of performance (188), a re-run that never hides a computed factsheet (190),
  and a refusal-marker race closed (191).

**NOT delivered, and recorded as such:**
- ⛔ **DEPS-01 descoped.** Phase 165 (and 165.1, 165.2) was retired 2026-09-27 by founder decision
  ("Land as maintenance, retire the phases"). The dependabot work landed one PR at a time as
  maintenance, outside any phase.
- ⏸️ **HONEST-07 still deferred.** The job kind it names is retired, with no site at HEAD and no traceback;
  re-assessed at the audit, still none. It is not carried as a requirement.
- ➡️ Out of the milestone by founder decision 2026-11-03: Phase 187 BINANCEINCOME and Phase 189
  OPTIONREPLAY (venue-specific, moved to `TODOS.md`), and 164.6.6.3.6 MT5SERVERLEARN (kept on its branch).
  Phases 181 and 182 were absorbed into 176 and superseded, respectively.

**Tech debt carried (named owners in the audit):** Phase 188's **SC-4 residual** — see below, the largest
item; TODOS entries from 185, 186, 190 and 191; and two integration notes — `analytics-deploy-verify.yml`
is a scheduled verifier, not a deploy gate (so "deploy only after green CI" rests on Railway's
check-suite setting, outside repo code), and `tiny_base_days` has two Python producer paths with no
shared Python constant mirroring the TS flag.

⭐ **Next milestone = a UX milestone** (founder 2026-11-06). It carries the **Phase 188 SC-4 residual**
as a follow-up phase (founder D-13, 2026-11-06): 1214 stored values changed between two nightlies,
mostly on scopes outside the fix's code path, moving four books' curves by up to 6.1e-5 relative, cause
unmeasured. That phase measures it with a control capture across a nightly that has no deploy between,
and takes up book b3's earlier untrustworthy reasons (`out_of_window_flow`, `window_truncated`).
188 itself closed on the defect it owned (key C's near-empty days no longer stored; `key_inputs_mismatch`
cleared from every book).

**Historical scope basis, retained:** every candidate was re-verified at HEAD by a 17-agent triage
(269 items → 211 open / 27 partial / 31 stale; 33 founder-gated set aside). Research was TARGETED
(user call 2026-08-20) on the highest-risk items. Out of milestone by construction: founder-gated ops
(RESEND key, Zavara activation, sFOX/Nautilus go-live, MT5 live parity = v1.18) and founder-decision
items (AUM basis, retunes). Full detail: `MILESTONES.md` + `milestones/v1.20-*`.

## Current Milestone: v1.18 MT5-VERIFY & founder confirmations (started 2026-08-14, parked 2026-08-20, RESUMED 2026-11-13)

**Goal:** The numbers Quantalyze renders for the live funded MT5 accounts **MM2, MM3 and FX-AI_V**
are proven true against the terminal's own figures, and the handful of observations only the
founder can make are made.

**Target features:**
- **Phase 155 MT5-VERIFY:** server-UTC offset measured live with a near-midnight deal regression
  (MT5-06); external-oracle parity against the terminal within 1% including open P&L over a window
  ending before the run day (MT5-07, MT5-08); the same numbers on strategy detail, factsheet,
  composer, PDF and browse (MT5-09); every divergence fixed at its root, uncapped, and the
  `complete_with_warnings` flags explained (MT5-10, MT5-15); umbrella acceptance MT5-GOAL-01.
- **Phase 157 FOUNDER-CONFIRM:** the wizard-resume restart gone, the amber recomputing block seen,
  the four 153.7 copy members rendering (no Retry on `SEAM_INTERNAL_FAULT`), and
  `MT5_SPIKE_INVESTOR_PASSWORD` rotated.

**Resumed 2026-11-13 (founder):** "New milestone v1.18", accounts MM2, MM3 and FX-AI_V, and
"Later, after planning": agents plan and pre-build the parity harness and pre-verify every
agent-checkable item first, then the founder gives one short scripted terminal session on the next
trading day. ⭐ **Gate 1 is cleared, measured on PROD 2026-11-13:** all three keys show
`sync_status='complete'` with `last_sync_at` 01:02–01:09 UTC that day, so the new investor
passwords are in. Gate 2 (the founder at the terminal on a trading day) still stands, for the
terminal readings only. Carried context for Phase 155 from `TODOS.md`: timeout findings #8 and #10
(need the real latency data) and the product call on MT5 as a composite member.

The former v1.16 carry (Phases 143–146) shipped and closed as **v1.19 on 2026-08-20** (audit
`tech_debt`, 9/9 requirements; archive at `.planning/milestones/v1.19-ROADMAP.md`).

⭐ **Parity tolerance is settled at 1%, INCLUDING open P&L** (founder call 2026-08-14). The
measurement window MUST end before the day of the run: `broker_dailies` anchors to today
(`initial capital = current_equity − total_pnl`), so error accrues *backward* and comparing today's
equity is near-tautological.

---

## ✅ Shipped: v1.17 MT5 — ingested, wizardable, surfaced (2026-08-04 → 2026-08-14)

⚠️ **Scope amended on close.** The original title claimed *"usable end-to-end, not merely
ingested"*. Phase 155 (MT5-VERIFY) was **carried to v1.18**, taking MT5-06..10, MT5-15 and
MT5-GOAL-01 with it. What v1.17 earns: MT5 ingests, is declarable in the wizard, projects in a
scenario, has a viewable factsheet, and the wizard's write is the server's alone. ⛔ What it does
**NOT** earn: any claim that the performance we render matches the broker's. **Nobody has compared
them.** Do not advertise MT5 until Phase 155 passes.

**Historical goal statement, retained:**

**Goal:** MT5 *works* in the founder's sense rather than the wizard's — it ingests (done), it projects
in a scenario, and its factsheet is viewable by the allocator who uploaded it.

**Founder verbatim (2026-08-04, minutes after MT5-05 was discharged on PROD):**
> *"The goal is that MT5 works. And at the moment, maybe it ingests the data, but I cannot use it in
> the scenario, and I can still not produce a factsheet."*

**Target features (REQ groups — see `.planning/REQUIREMENTS.md`):**
- **SCEN — the series actually reaches the engine.** `strategy_analytics.daily_returns` has **no
  production writer at all** (PROD: 0 of 27 real strategies populated vs 15/15 demo seeds), and the
  scenario's data route reads only that column. Affected strategies contribute nothing and the
  composer renders zeros with no error. Plus the composer's own legibility: ownership marker,
  clickable rows, labelled numbers, duplicate browse entries.
- **OWN / NAV — an allocator can see and reach their own strategy.** The owner factsheet 404s today
  (⛔ its acceptance test is adversarial: after an owner views their draft, an anon request for the
  same id must STILL 404 — that route is publicly cached), and there is no "my strategies" nav entry,
  so the allocator side is write-only.
- **AUM — a book you can reach and a size you can set.** The holdings sync crashes on every non-ccxt
  venue (a raw `AttributeError` sits in a user-visible column on PROD), an all-or-nothing per-key gate
  hides a live book behind a forced blank slate, AUM is derived-only with no input anywhere, and the
  refusal copy names a control that was deliberately never built.
- **WIZ — the wizard stops costing submits.** Inline field errors, a resume path for allocators,
  credential dedup, no stale screens, and MT5 selectable as its own venue.
- ➡️ **MT5-VERIFY — the numbers are true.** Server-UTC offset measured live, rendered performance
  checked against an external oracle, on a live funded account on a real trading day.
  ⛔ **CARRIED TO v1.18 on 2026-08-14 — this was NOT delivered in v1.17.** Listed here because it
  was in the original scope statement; struck from the delivered set.

⭐ **Defining constraint: almost NONE of this is an MT5 defect.** MT5 is the first venue to traverse
the whole path from a cold start, so it is exposing pre-existing holes in the surfaces AFTER
ingestion. SCEN-01 affects every real strategy at every venue; OWN-02 blocks every unpublished
strategy; AUM-05 will hit sFOX the day its flag flips. **A fix scoped to `exchange === 'mt5'` is the
wrong fix for nearly all of it.**

**Scope decisions (founder 2026-08-04):** v1.16 **PARKED at 68%, not shipped** — 13/19 phases,
119/127 plans, with Phases 143–146 outstanding; to be reopened after v1.17 delivers. Research SKIPPED
(zero new external features; every requirement is a defect already root-caused with PROD evidence and
file:line citations). Phase numbering continues from **147**.

## ⏸️ PARKED Milestone: v1.16 Production Resilience & Reliability (planning, started 2026-07-25)

⛔ **PARKED 2026-08-04 at 68% — NOT shipped, NOT complete.** Outstanding: Phase 143 (dropped-enqueue
sweep), 144 (WR-02 orphaned-running DELETE→terminal UPDATE — carries the live TEST-DELETE/PROD-reset
founder call), 145 (csv-finalize atomicity), 146 (RATE audit). Resume at Phase 143. All 29 phase
directories were deliberately PRESERVED (the workflow's `phases.clear` was skipped by founder call) so
this milestone resumes without reconstruction.

**Goal:** Give the live money-bearing plumbing failure handling — so a hung Railway request, a silently-dropped compute-job enqueue, or a mid-job worker crash can't strand a real investor factsheet on a spinner that never resolves. This is hardening of existing seams (Deribit, MT5, and sFOX/Nautilus now carry real accounts), not new external features. The biggest live-surface risk is no longer correctness math (mostly latent/flag-gated) — it's that the plumbing has no failure handling.

**Target features (REQ groups — see `.planning/REQUIREMENTS.md`):**
- **SEAM — Vercel→Railway resilience** (top item): `analytics-client.ts` gets a bounded fetch timeout + retry-with-backoff (idempotent reads only) + circuit breaker, so a hung Railway request fails fast with a clean error instead of holding a Vercel lambda open until the platform kills it and cascade-500s `keys/sync`, `verify-strategy`, `admin/match/*`. Live keys sync through this seam.
- **JOB — Job-state integrity** (no forever-spinners): detect strategy-with-data-but-no-compute-job (`after()` enqueue drop → stuck "computing"); make csv-finalize transactional / orphan-cleaned; worker-crash `computing`-row janitor (also removes the recurring shared-test-DB fence flake — two birds). The worker orphaned-`running` DELETE-vs-reset founder call (TEST DELETE / PROD reset, same migration) resolves here.
- **RATE — Rate limiting** on the currently-unlimited authed routes that hit the Python service (`verify-strategy`, `keys/{sync,validate,encrypt}`, `admin/match/recompute`, `admin/partner-import`, `trades/upload`, `intro`) → arbitrary quota-burn / DoS surface now that real keys exist.

**Scope decisions (founder 2026-07-25):** CRON (match-engine cron health check + founder-LP/email idempotency) DEFERRED to a follow-up milestone. Runner-up "Money-Path Correctness Unification" (backbone-bypass parity + latent quantstats/blend/short-window-CAGR bugs) deferred — mostly latent/edge-case, less urgent than the live plumbing gaps. **Research:** first (founder chose). Phase numbering continues from **140**.

## ✅ Shipped Milestone (FOUNDATION, flag-OFF): v1.12 sFOX Verified Integration — Phases 118–123, shipped 2026-07-19, tag `v1.12` @ `92be47af` (v0.46.0.0, PR #623)

**Delivered (dormant):** the foundation for live sFOX verified integration — a non-ccxt `SfoxClient`/`SfoxAdapter` reconstructing daily equity through the ONE backbone with the `api_verified` stamp; `sfox` accepted at every key chokepoint (read-only STRUCTURAL, honest `KEY_AUTH_FAILED`) + a prod-applied constraint-widening migration; flag-gated add-key UI + badge + read-only setup guide; and worker-hardening groundwork (`asyncio.wait_for`-bounded crawls, prod-applied kind-filtered claim RPC, E2 anchor/flip fixtures, go-live runbook, Fly egress-proxy artifacts). **All flag-OFF** (`NEXT_PUBLIC_SFOX_ENABLED`/`SFOX_ENABLED` empty) — zero prod impact, nothing reads live. **Closed as Foundation:** go-live is founder-gated ops (Fly deploy + IP-whitelist, FLIP cutover, live E2) + a real factsheet e2e defect + an evidence-gated deribit phase — all **re-homed to v1.13**, enumerated, not silently accepted. Full detail: `MILESTONES.md` + `milestones/v1.12-*`.

**Original goal:** Add a LIVE sFOX exchange adapter that reads the actual account (`api_verified` ground truth — defeating CSV fabrication), backed by a Fly.io static-IP egress so IP-whitelisted sFOX keys work; and burn down the two backbone follow-ups parked at v1.11 close.

**Why (founder, load-bearing):** CSV track records are `self_reported` — a submitter can fabricate the numbers. A live API read of the real sFOX account is `api_verified` ground truth they can't fake. That trust distinction (the Phase-111 provenance tiers) IS the point of the big adapter over the trivial CSV path. sFOX is NOT in ccxt → a custom non-ccxt adapter is required. sFOX keys can be IP-whitelisted → the Fly static-IP egress is load-bearing, not optional.

**Target features (REQ groups — see `.planning/REQUIREMENTS.md`):**
- **SFOX (5-phase core)** — (1) research + non-ccxt `SfoxClient` adapter contract (the real unknown: *can we reconstruct daily equity from what sFOX exposes?*), green sandbox smoke test; (2) read adapter (balance/trades/txns, read-only enforced) + worker `validate_key`/`encrypt_key` + all 3 Vercel key routes accept `sfox` + a DB constraint-widening migration admitting `'sfox'` across the ≥5 hardcoded exchange CHECKs; (3) equity reconstruction → daily returns → unified backbone with `api_verified` stamp + ground-truth parity check; (4) **Fly.io static-IP egress** ($2/mo dedicated v4 proxy in `ams`, tinyproxy CONNECT-443, worker aiohttp/ccxt proxy wiring — VERIFY egress IP == dedicated v4 before whitelisting); (5) add-key UI exchange picker + onboarding + e2e (all roles), assert the `api_verified` badge renders.
- **FLIPRETRY** — retry the v1.11-rolled-back derived-allocator-equity FLIP with its ROOT-CAUSE fix: a hard `asyncio.wait_for` timeout on each derive's exchange crawl + batched/off-hours backfill on its OWN worker (never the sequential prod worker's event loop) + re-`cron.schedule('derive-allocator-key-dailies', ...)`, THEN `E2_GROUND_TRUTH_*` anchor-consistency validation. Flip is data-driven (no flag): `queries.ts` `extractTrustworthyDerivedCurve` → `equityCurveSource`.
- **DERIBITFIX** — classify the unhandled deribit `correction` txn-log type (a `LedgerValuationError` fail-loud that currently blocks ingesting any deribit account with a `correction` entry). Fix needs EVIDENCE of what deribit `correction` means, not a guess.

**Governing principles:** live API read = `api_verified` ground truth ([[project_sfox_verified_integration_milestone]]); dailies-canonical backbone ([[feedback_dailies_canonical_unified_derive]]) — sFOX balances/trades → daily returns → the ONE backbone; fail-loud, no invented data. flyctl is NOT installed locally → founder runs `fly deploy` + provisions/whitelists the IP; I generate Dockerfile + fly.toml + tinyproxy.conf.

**Scope decisions (2026-07-18):** milestone-level ecosystem research SKIPPED (4 mature exchange adapters already exist; sFOX-specific research lives in Phase-1 RESEARCH.md). Phase numbering continues from Phase 118 (no reset). Static-IP provisioning + IP-whitelisting are founder-run ops gates, not code blockers.

## ✅ Shipped Milestone: v1.10 Demo-Hero Portfolio Intelligence + Options MTM + Backbone Unification (Phases 98–108, shipped 2026-07-15, tag `v1.10` @ `32494ba2`)

**Delivered:** the allocator dashboard became the demo-hero surface (Exposure/Net-Exposure/Allocation widgets + optimizer sleeve + Notes + folded KPI panel, PI-01..07); the options `cash_settlement ↔ mark_to_market` toggle now swaps the daily SERIES so the whole factsheet follows (MTM-01..04); every derive path unified onto the one dailies-canonical backbone with the legacy trades-based chain deleted (BB-01..03); and leverage + the scenario-planner both re-derive off that backbone with ~990 LOC of frontend re-scale / second-Sharpe disclosure deleted (LEV-BB, SCEN-BB). Full detail: `MILESTONES.md` + `milestones/v1.10-*`.

**Original goal:** Make the allocator dashboard the 10/10 demo-hero surface for the next
cap-intro / pilot-allocator meeting (the project north-star), and give
options-trading strategies an honest working mark-to-market view on the
factsheet. v1.9/v1.9.1 shipped + hardened multi-key composites; v1.10 turns the
dashboard from placeholders into the demo, and finally builds the twice-deferred
options MTM smoothing.

**Target scope (REQ groups — see `.planning/REQUIREMENTS.md`):**
- **PI** — Portfolio Intelligence (M-A, demo-hero): position/weight-history data foundation + cross-process recompute UNIQUE INDEX (PI-07); Exposure-by-Asset-Class / Net-Exposure-Over-Time / Allocation-Over-Time widgets (PI-01/02/03); optimizer sleeve replaces the hardcoded 10% + favorites UX (PI-05); Notes widget (PI-04); `PortfolioKPIRow` shared-panel fold (PI-06).
- **MTM** — Options mark-to-market on the factsheet (NEW): enable the `cash_settlement ↔ mark_to_market` toggle for options-trading strategies via the deferred Phase-83 daily-option smoothing (MTM-01), compose with the composite stitch + coverage mask (MTM-02), Zavara corroboration + full byte-identity regression (MTM-03).

**Split decision (2026-07-12):** the infra/pipeline tail — **M-E Pipeline Cutover & Correctness** + **M-C CI/Test-Infra Ratchet** (incl. the v1.9.1-deferred `-n auto` fence parallelization) — is deferred to **v1.11** so v1.10 stays demo-focused and shippable. **M-B cron/notification reliability** also stays deferred (next-up). All captured in `.planning/FUTURE-MILESTONES.md`. Phase numbering continues from v1.9.1 (Phase 98+).

**Research dependency:** MTM-01 daily-option mark methodology is research-heavy (twice-deferred) — the Phase-101 researcher must surface the smoothing approach + its honest-gating boundary before planning; MTM must keep `cash_settlement` byte-identical (SC-4). PI widgets are blocked on data plumbing (Phase 98), not UI.

## Requirements

### Validated

<!-- Shipped and confirmed in the codebase. Inferred from MILESTONES.md. -->

- ✓ Bridge recommendation engine + mandate-aware scoring + outcome feedback loop — v0.14.0.0
- ✓ Outcome tracking: allocators record what they did, system computes realized 30/90/180-day deltas — v0.14.0.0
- ✓ Full qstats-parity factsheets (7-panel) on Discovery + Single-Strategy — v0.17.0.0
- ✓ Discovery v2 (watchlist, per-user customize, sparklines) — v0.17.0.0
- ✓ Strategy-level correlation matrix on the Risk tab — v0.17.x
- ✓ Unified ingestion backbone (`POST /process-key`) — API-key, CSV, and MT5-EA paths behind one adapter Protocol — v1.0.0
- ✓ Founder-LP monthly factsheet report cron — v1.0.0
- ✓ Scenario **draft engine**: compose a what-if portfolio (toggle holdings, reweight, add strategies), live KPI / equity / drawdown projection vs the live book, per-strategy leverage what-if, single-transaction commit to the `bridge_outcomes` audit trail — v1.0.0 + PR #493 (R4 leverage, H-0133 weight plumbing)
- ✓ **Scenario Analysis (v1.1.0, Phases 21–28)**: surfacing + correlation heatmap + "PROJECTED — hypothetical" framing; per-stat method/overlap-N/horizon disclosure + shared sample-floor gate; save/reopen/list/rename/delete + compare named scenarios (DB + RLS + `schema_version`); benchmark overlay (TE/IR/alpha-beta); revocable read-only share links (leak-scoped SECURITY DEFINER); β-propagated stress + VaR/CVaR; block-bootstrap Monte-Carlo confidence bands (first Web Worker); min-vol/max-Sharpe weight optimizer (Python, write-to-draft-only, TS↔Py parity) — v0.25.0.0 → v0.28.0.2
- ✓ **Allocator Cohesion (v1.2, Phases 29–33)**: the three fractured allocator surfaces (Strategy Sandbox `/scenarios`, legacy Portfolios pages, own-book Scenario composer) collapsed into ONE factsheet-grade composer on the live blended book — entry-mode (blank-slate or seed-from-book) + merged verified+example Browse catalog + scoped RLS lazy-returns route so an added strategy moves the projection (29); factsheet-grade graphs on the blend (equity/drawdown + returns distribution + rolling Sharpe/vol/Sortino, each disclosing method/overlap-N/horizon, peer/percentile panels structurally suppressed) (30); collapsible composition controls so graphs lead, hide-not-unmount preserving edits (31); `/scenarios` retired to a 307 redirect, ScenarioBuilder deleted, nav consolidated to one allocator entry, dead add-strategy link fixed — no DDL (32); Bridge→composer continuity + DESIGN.md focus rings + a live WCAG-AA composer axe gate (33). Additive client-TS/TSX over the FROZEN `scenario.ts` engine — v0.29.0.0 → v0.30.0.1 (tag `v1.2` @ 11775460)
- ✓ **scenario-tab-hardening (v1.2.1, Phases 34–38)**: unified every exchange API key's stats through the ONE CSV → `compute_all_metrics` path so Overview, Scenario, and factsheets read the same honest source, and finished the composer's convergence onto the factsheet — explicit `periods_per_year=252` at the call site + `equity_reconstruction` converged to 252 (no ×1.20 mismatch) (34); `csv_daily_returns` dual-axis (`api_key_id`) per-key dailies foundation + allocator-key-scoped realized+funding derive job + backfill + per-key owner RLS (35); Overview equity/KPIs repointed onto a per-key blend through the frozen `computeScenario` engine (all-or-nothing gate, snapshot fallback, HOLDINGS untouched) (36); honest per-`api_key` include/exclude toggle that re-blends the curve + KPIs from the remaining per-key series (37); composer scenario equity + drawdown reuse the REAL factsheet `TimeSeriesChart` + `MasterBrush` under an additive `persist={false}` provider at 1440 width + blank-slate scenario overlay (38). Additive client-TS/TSX + Python over the FROZEN `scenario.ts` engine; one storage migration (Phase 35) — v0.30.1.0 → v0.33.0.0 (tag `v1.2.1` @ `e5e4f3d2`)

- ✓ **scenario-tab-factsheet-parity (v1.2.2, Phases 39–43)**: the /allocations Scenario composer renders the REAL factsheet on a hypothetical blend, computed client-side (`compute.ts`) with parity by construction — `buildScenarioFactsheetPayload` extended minimal→complete (full scalar + panel metrics, degenerate-safe) (39); the real `FactsheetBody` mounted under the scenario `FactsheetProvider(persist=false)` behind an additive byte-identical `scenarioMode` flag, api-only panels absent on the csv blend (40); a constituent correlation / diversification matrix (ρ≥0.85 too-similar flag, percent-contribution-to-risk, cluster reorder) (41); an honest AGGREGATE peer rank for the blend via an additive `scenarioPeer` carve-out (deliberate, audited override of the no-peer-rank-a-hypothetical invariant — never an `ingestSource` flip), per-constituent mandate chips, own-book delta (42); compose toggles folded into the factsheet layout behind four permanent guards — byte-identity / axe a11y / coverage / no-state-bleed (43). Additive over the FROZEN `scenario.ts` engine; no migration — v0.34.0.0 → v0.34.0.3 (tag `v1.2.2` @ `43e57dd0`)

- ✓ **Mobile & Adaptive UI (v1.3, Phases 44–48)**: the whole app is usable, touch-inspectable, and WCAG-AA accessible on a phone (320px → 400% zoom) with the desktop render byte-identical — SSR-safe `useBreakpoint` + `ResponsiveTable`/`ResponsiveChartFrame` primitives and bespoke CI gates for the WCAG checks axe can't do (320px reflow, 400% zoom, 44px target-size, mobile keyboard/focus) (44); role-aware mobile bottom nav single-sourced from Sidebar + inert-background drawer + app-shell skip-link + CSS-first scrollable tab strip (45); every data table usable at 320px with no dropped columns (ResponsiveTable + all-columns guards) + wizard de-blocked below 640px + parametrized reflow sweeps across public/authed/degenerate routes (46); 16 hand-rolled SVG charts touch-inspectable via shared `useTapPin` + 320px legibility + portrait tuning, frozen math byte-identical (47); all 18 Recharts charts via breakpoint-gated `TouchTooltip` + the 2277-LOC `EquityChart` touch path (additive `useTapPin`, desktop byte-identical) + app-wide axe route×viewport matrix + `@lhci/cli` mobile perf budget, FLOW-01 dual-wired (48). Presentation-layer only over the FROZEN `scenario.ts` engine; no migration — v0.35.0.0 → v0.35.0.3 (tag `v1.3` @ `37b12c8c`)
- ✓ **Frontend Excellence (v1.4, Phases 49–54)**: app-wide UI/UX overhaul to best-in-class rendering across the full resolution range with the math engine frozen — a state-of-the-art design system + fluid `--text-*`/`--space-*` token spine in a plain `@theme` block + clamp/raw-hex/raw-px lint guards (49); refreshed primitives + new Table/Tabs/Dialog/Select/Field/Breadcrumb (`radix-ui@1.6.0` scoped to non-native widgets only) + reusable loading/error/empty state primitives (50); a `(marketing)` URL-invisible route-group shell + IA restructure + route-contract guard + `PUBLIC_ROUTES` sync (51); per-surface application to the allocator journey (`@container` reshape, fluid-fill to ~1920px, honest route states; composer stays a frozen client island, BODY-02) (52) and to the wizard/security/admin/public surfaces behind a per-surface DESIGN.md-conformance gate (53); app-wide verification — 2560px ultra-wide axe/reflow row, hermetic authed/mobile axe re-enable, lhci 0.60→0.65, a runtime no-clip guard, tolerance-based Playwright goldens, and `no-raw-font-px` flipped to error repo-wide (54). Presentation-layer only over the FROZEN `scenario.ts`/`compute.ts`/`FactsheetBody`; desktop byte-identity LIFTED; one new prod dep (`radix-ui@1.6.0`) — v0.35.0.6 → v0.35.0.12 (tag `v1.4` @ `4c4ca537`)
- ✓ **Scenario Coverage-Window Blend (v1.5, Phases 55–61)**: the frozen `scenario.ts` blend convention DELIBERATELY rewritten to coverage-window membership — member iff `enabled AND span ⊇ window`, divisor counts members only, weighted blends renormalize, ended strategies no longer dilute the tail toward zero; explicit `state.window` + pure `scenario-window.ts` helpers + `member_count`/`effective window`/`N` exposed on `ComputedMetrics`, pinned to an independent numpy re-derivation to fp precision (55); factsheet parity-by-construction re-proven with a two-layer guard (56); window control with intersection default, dual presets, widen→auto-drop / narrow→auto-restore within the selected subset, guided empty-intersection fix (57); coverage legibility — honest blend header, three-state row chips, mini-gantt timeline, include-cost affordance, one-time default-change note (58); windows persisted across save/share/compare (schema v2→v3 non-destructive codec, share threads the owner's window verbatim through the SECDEF RPC, compare per-column windows) (59); safety-net re-bake honestly re-scoped to a proven no-op + the restored e2e net caught 3 latent bugs (60); authed prod canary verified the whole chain live and DISCOVERED the inert-added-strategies + empty-book-draft bugs (P61-BUG-1/2), fixed tests-first via `mergeAddedIntoPerKeySet` + compare engine-set mirroring + honest book-only share 409 (61). SCENARIO-05 re-baselined as a reviewed act; no-invented-data held — v0.35.0.26 → v0.35.0.31 (tag `v1.5` @ `f8b502e7`)
- ✓ **sFOX Verified Integration FOUNDATION (v1.12, Phases 118–123, flag-OFF)**: the dormant foundation for a live `api_verified` sFOX exchange — a non-ccxt `SfoxClient` (Bearer, 4 read endpoints, proxy seam) + `SfoxAdapter` reconstructing daily equity from the balance-history series through the ONE `derive_basis_series` backbone with the Phase-111 `api_verified` provenance stamp (SFOX-01/05); `sfox` accepted at the worker validate/encrypt path + all 3 Vercel key routes with an empty-secret Q1 carve-out, read-only asserted STRUCTURALLY, honest `KEY_AUTH_FAILED`, plus a prod-applied constraint-widening migration admitting `'sfox'` across the ≥5 exchange CHECKs (SFOX-02/03/04); flag-gated add-key UI (`NEXT_PUBLIC_SFOX_ENABLED`, OFF = byte-identical) + `api_verified` badge + read-only setup guide (SFOX-08/09); and worker-hardening groundwork — `asyncio.wait_for`-bounded derive crawls + a prod-applied kind-filtered claim RPC + E2 anchor/flip fixtures + Fly egress-proxy artifacts (FLIPRETRY-01/02, SFOX-07 groundwork). Shipped **dormant** (no user can connect, nothing reads live). Per-phase opus verifier + code-review + Fable red team; P115 economic-oracle discipline. **Go-live re-homed to v1.13** (Fly IP-bind, factsheet e2e, E2 ground-truth, FLIP cutover, deribit `correction`) — v0.46.0.0 (tag `v1.12` @ `92be47af`, PR #623)
- ✓ **Scenario Composer v2 (v1.11, Phases 109–117 + 110.1/115.1)**: every scenario source normalized to ONE daily-series constituent under a coherent manager/allocator role model, with the dailies-canonical backbone tail finished on the allocator surface — role/nav/API guards derive from one predicate (`is_admin` ops-overlay only), dropping the `|| isAdmin` 403 cluster (ROLE); allocator private-by-default strategy contribution via a reusable `ContributionWizardOverlay` with an owner-only `status='private'` finalize path RLS-audited against catalog-wide leak (CONTRIB); the "Data Sources" section deleted so api-key/CSV/catalog/composite each render as ONE badged constituent row, blend parity proven = interpretation A to 1e-9 (CONSTIT); per-key weight + leverage rows on the engine-unit basis (`wᵢ·Lᵢ·rᵢ`) + a max-DD→leverage back-solver, all over the FROZEN `scenario.ts` (WEIGHTS); the 2nd Sharpe/vol/TWR stack deleted behind a golden gate + allocator equity reconstruction onto the backbone (BACKBONE E1/E2, derived path dormant in prod pending two founder-gated ops); context-aware +Allocation/+Strategy (ADDALLOC); tooltip-portal / focus-ring / KPI-value fixes (UIFIX). Per-phase opus verifier + code-review + Fable red team; SC-3 byte-frozen throughout — v0.44.x → v0.45.0.0 (tag `v1.11` @ `a42f4bcf`, PRs #620 + #622)
- ✓ **Demo-Hero Portfolio Intelligence + Options MTM + Backbone Unification (v1.10, Phases 98–108)**: allocator-dashboard demo-hero surface — Exposure-by-Class / Net-Exposure / Allocation-over-Time widgets on an owner-scoped secretless read layer, optimizer sleeve replacing the hardcoded 10% favorites, Notes storage, shared-`KpiPanel` fold, and a real-PG partial-UNIQUE cross-process fence (PI-01..07); the `cash_settlement ↔ mark_to_market` factsheet toggle swaps the daily return SERIES so all charts follow (single-key + composite) with a per-basis coverage mask + honest gating, cash byte-identical (MTM-01..04); the dailies-canonical backbone finished — `services/basis_series.py::derive_basis_series` the ONE shared route, composite + onboarding routed onto it, the trades-based legacy analytics chain + all 4 dark re-entry points deleted, `USE_COMPUTE_JOBS_QUEUE` mandatory (BB-01..03); leverage as an `r→L·r` dailies transform + the scenario-planner both re-derive off the backbone, ~990 LOC frontend re-scale / second-Sharpe disclosure deleted (LEV-BB, SCEN-BB). Full close pipeline every phase (opus review + opus verifier + Fable red team). Full suite 8161+ green — v0.42.0.0 → v0.43.0.0 (tag `v1.10` @ `32494ba2`)

- ✓ **Backlog Burndown (v1.20, Phases 158–191, 62 of 64 requirements)**: the verified-open, agent-deliverable backlog slice, recorded below by requirement group (62 satisfied; DEPS-01 descoped and HONEST-07 deferred, see Out of Scope / Active):
- ✓ RANK-01..09 — percentile gate on failed/stale KPIs (both engines), anon `(*)` splats become explicit projections, `api_keys.exchange` server-authoritative at every INSERT, venue-derived √365/√252 stamp, quantstats sign-flip, blend-annualization default, FILL-arm CAS, re-mint fingerprint classification, `withPublishedOrOwner` uid shape — v1.20
- ✓ SHARE-01..04 — revocable per-strategy share token, id-keyed public cache never poisoned, revoke control, honest affordance class — v1.20
- ✓ WIZERR-01..13 — honest error surfaces (MT5 gateway copy from `terminal_info`, draft-safe "Try another key", orphaned-key remedy, Retry-After threading, `KEY_INVALID_FORMAT` split, CSV floor/copy pairs, venue-parameterized `AUTH_FAILED`) — v1.20
- ✓ HONEST-01..06, HONEST-08 — no raw Python exceptions as copy, freshness badges follow series recency (factsheet and discovery), real equity curves, drawer-row CAGR/Sharpe, key preselect — v1.20
- ✓ OPS-01..11 — shared-test-db eviction closed (FIFO mutex plus `cancelled` watcher, #616), `sql-tests` gated, orphaned e2e specs and DB-types gate, TEST stale-pending drain, structlog redaction class, post-commit `createAdminClient` class, flag-monitor honesty, `INTO STRICT`/`ORDER BY`/`body.cancel` — v1.20 (OPS-08 applied and verified on PROD; TEST still runs the pre-fix body)
- ✓ SEC-01..06 — hosted password floor measured and accepted, `.planning` username scrub with a no-allowlist gate, RPC audit-coverage decision, `bridgeComputeLimiter`, tenth IP-keyed route, mid-validate POST abort — v1.20
- ✓ LEDGER-01..04 — recurring strategy refresh for ledger-backed venues, shipped dormant behind two locks — v1.20
- ✓ VAC-01..08 — mutation runner, disposable-PostgreSQL lane, SQL gate linter, repo-vs-PROD/TEST drift gates, plan-anchor verification, concurrent csv-finalize spec — v1.20

- ✓ **UX — trustworthy, navigable, lean (v1.21, Phases 192–206, 32 of 32 requirements)**, recorded by requirement group:
- ✓ TRUST-01..06 — one true public story (demo retired), quiet charts and session-local ranges, no foreign or developer text, one value per metric, figures withheld on a short total record (D-05: implausible values shown, not flagged), page views write nothing — v1.21
- ✓ ROUTE-01..11 — role landing pages, signed-in users never treated as visitors, factsheet back link and next step, Compare from discovery, the allocator's "+ Allocation", My allocation answers how the book is doing, correct Holdings labels, key feeds and confirmed re-pointing, one rename place, actionable degrade warnings with a chip legend — v1.21
- ✓ CLAR-01..06 — discovery columns state period and basis, stale strategies flagged and not ranked as current, glossary tooltips, one name per concept, shared-account notice, factsheet consistency fixes — v1.21
- ✓ LEAN-01..07 — one strategies list, one strategy page, `/portfolios` removed and Decks hidden, one entry point each for adding a strategy, keys and renaming, a summary-first factsheet, three-tab My allocation, leftovers removed — v1.21
- ✓ RESID-01..02 — the 188 value churn attributed or named unexplained (control capture across a quiet nightly; 1142 of 1214 attributed, 72 unexplained), book b3's `out_of_window_flow` and `window_truncated` explained as intended behaviour — v1.21

### Active

<!-- Carried out of v1.21 (closed 2026-11-13). The next milestone's requirements are defined at its start. -->

- **v1.18 (current):** MT5-06, MT5-07, MT5-08, MT5-09, MT5-10, MT5-15 and the umbrella MT5-GOAL-01 (Phase 155), plus the Phase 157 founder confirmations. See `.planning/REQUIREMENTS.md`.

The items below stay carried for a later milestone; they are not v1.18 scope.

- **Composer range as dates (founder 2026-11-13, "Book a fix")** — save the composer's selected range as dates so presets like 12M always end on the latest day, and re-pin "kept when the series grows" to mean the same dates are kept. Next milestone; `TODOS.md` `201.1-COMPOSER-RANGE-AS-DATES`.
- **TERMS-01, TERMS-02** (deferred out of v1.21 by the fix-and-trim scope) — manager-entered fees, terms and thesis on the factsheet; net vs gross, base currency and "Data source" for every strategy.
- **HONEST-07** — still deferred (no site at HEAD, no traceback); revisit only if the failure reappears.
- The v1.21 audit's tech-debt list (`milestones/v1.21-MILESTONE-AUDIT.md`) and the 52 open `WINDOWS.md` entries.

<!-- v1.8 Flow-Aware Time-Weighted Returns — Phases 73+. See ## Current Milestone above + .planning/REQUIREMENTS.md. -->

- **v1.8 Flow-Aware Time-Weighted Returns (Phases 73+)** — daily-NAV backward reconstruction + chain-linked TWR replacing anchor-to-today, dated external-flow valuation per exchange, fail-loud DQ guards, golden parity. Requirements in `.planning/REQUIREMENTS.md`.
- **v1.7 Deribit Exchange Coverage & Carry-Forward Burn-Down (Phases 66–72)** — ⏳ OPEN. Phases 66–71 shipped; Deribit full parity + valuation engine live and verified (key #1 clean). Phase 72 LTP acceptance verification is BLOCKED on v1.8 (anchor bug inflates flow-heavy returns) and carried forward as a v1.8 requirement. Closes once v1.8 lands + P72 canary re-runs green.

### Deferred (tracked tech debt)

- [ ] Real-device authed sign-off (VERIFY-05 / 54-VERIFICATION.md) — partially discharged across milestones via live authed prod canaries (real Chromium, 0 console errors on /allocations + /discovery); full multi-device manual walkthrough on authed surfaces (no reflow/clip/a11y regression + the RT-W2 admin width caps) remains the user's gate. Headless can't hydrate authed pages.
- [ ] Live golden-PNG bake (VERIFY-01/04) — the tolerance-based Playwright `toHaveScreenshot()` goldens land green-by-skip (WR-02 guard) until a deliberate per-chart re-baseline in a seeded CI run; never blind `--update-snapshots`.
- [x] ~~Ratchet `lighthouse-mobile` up from 0.60~~ — done in v1.4 (VERIFY-03, 0.60→0.65).
- [x] ~~Re-enable authed/mobile axe rows against a hermetic seeded DB~~ — done in v1.4 (VERIFY-02, seeded MA-8, teardown-by-id).

### Out of Scope

<!-- Explicit boundaries with reasoning. -->

- Full Overview-factsheet recompute on a hypothetical blend — false-precision risk (`ingestSource:"api"` unlocks peer/allocator panels on a what-if). Revisit only if an allocator asks twice.
- Consolidating the 3 correlation surfaces (Risk-tab matrix vs reusable heatmap vs `/scenarios`) — code-motion, defer until a feature forces convergence on the WCAG-audited palette.
- "Decision-memo generator" vision — strong future direction, not this milestone.
- Scenario export (PDF/CSV) — defer until save/load proves the workflow.
- DEPS-01 as a phase (v1.20) — Phase 165 and its two inserts were retired 2026-09-27 by founder decision; dependabot PRs land one at a time as maintenance under the green rule, not as milestone scope.
- Venue-specific go-live work (v1.20, founder 2026-11-03): Binance futures income (Phase 187) and the Deribit option-history replay (Phase 189) live in `TODOS.md`, not in a milestone. Binance, Deribit and sFOX gaps are not milestone scope until the founder re-books them.
- CSP nonce migration, the D-09 composite `stitch_composite` re-run mechanism, and the FILL-arm recompute guarantee (v1.20) — each phase-scale on its own; deliberately not squeezed into a burndown, still in the backlog.
- Raising the hosted password floor (v1.20 SEC-01) — measured at 6 characters with no class rule and ACCEPTED by the founder 2026-08-26; revisit on paying clients, a custody/compliance requirement, or evidence of credential stuffing.

## Last Shipped Milestone: v1.6 Scenario Series-Space Purification (✅ shipped 2026-07-04, tag `v1.6` @ `f78f036b`)

**Goal:** The scenario tab operates purely in series space — explicit per-key draft membership
(`memberKeyIds`, schema v4, non-destructive upgrades), holdings-snapshot fallback engine deleted
(ONE `buildAddedOnlySet` feeds composer/compare/share, source-scan guard against reintroduction),
KPI strip return-form only, mixed-share honesty caption with zero member-UUID leakage. Phases 62–65
in a single PR #572 (v0.36.0.0); audit PASSED 16/16 reqs · 4/4 phases · 6/6 seams; live canary
GUARD-04 clean, 0 bugs. Frozen engine zero-diff the whole milestone.

**Notable:** a pre-landing Fable red team caught F-1 CRITICAL (blank-session Update silently wiping
book membership) that 6 specialists missed; fixed at the root and verified live at the persisted
layer. Full per-phase detail: `.planning/MILESTONES.md` + `milestones/v1.6-*`.

## Context

- **Pre-revenue, no clients yet** — destructive ops and short soak gates are acceptable; strategies are re-uploadable. Decisions are made autonomously rather than gated on customer impact.
- The scenario math is **client-side TypeScript** (`src/lib/scenario.ts` + `compute.ts`, frozen by SCENARIO-05 / BODY-02 regression pins). The client-TS-vs-Python split is settled (v1.1.0): heavy compute stays client-side except the one Python optimizer endpoint (Ledoit-Wolf + SLSQP); Monte-Carlo runs in a client Web Worker.
- The design system was refreshed to a state-of-the-art aesthetic in v1.4 (DESIGN.md is the SoT), with a fluid `--text-*`/`--space-*` token spine in a plain `@theme` block, `radix-ui@1.6.0` scoped to non-native widgets, and `no-raw-font-px`/`no-raw-hex`/`clamp-without-rem` lint guards enforcing conformance.
- App ships continuously on Vercel (frontend) + Railway (Python analytics); Supabase migrations auto-apply on merge. Since 2026-09-23 a migration merge that passes the TEST apply reaches PROD with no human stop, so every review a migration needs happens before the merge.
- After v1.20 (app v0.133.23.2): allocator equity is marked-to-market (NAVMTM) under one stated price rule, the legacy `allocator_equity_snapshots` curve is retired, and days measured against a near-empty account (under 5% of the 30-day peak) are left out of performance rather than read as returns. CI proves its own SQL gates can fail (mutation runner, lint rules, drift gates) and runs the SQL corpus on a private local stack, not shared TEST.
- Known technical debt at v1.20 close: Phase 188's SC-4 residual (unexplained value churn between nightlies), the per-phase TODOS entries listed in the audit, `analytics-deploy-verify.yml` being a scheduled verifier rather than a deploy gate, and `tiny_base_days` having no shared Python constant. Nyquist validation was discovery-only (4 compliant of 142).

## Constraints

- **Tech stack**: Next.js 16 App Router (NOT vanilla Next — read `node_modules/next/dist/docs/` before writing route/cache code), React client components, TypeScript; FastAPI/Python analytics-service on Railway; Supabase Postgres + Auth + RLS.
- **No-invented-data invariant**: degenerate inputs (0/1 active strategy, <10 overlapping days, non-finite returns) render honest empty states — never fabricated zeros, garbage numbers, or false precision.
- **Design**: DESIGN.md governs all visual decisions (palette, typography, spacing). Read it before any UI.
- **Convention**: annualization is split by metric (v1.8 TWR-05, enforced in v1.20 RANK-04/06): risk metrics (Sharpe, volatility, Sortino) annualize by the venue's frequency (crypto 365, traditional 252), returns/CAGR by the calendar, and a blend counts as crypto for risk if any leg is crypto or unknown. The stamp derives from the server-attested venue, never client input. Do not introduce another convention.
- **Fail loud, fail alone**: a truncated or failed exchange read refuses by name and the last good stored values stay (186 D-05); a failing key affects only itself and leaves the book that day (186 D-03/D-07; founder rule 2026-10-28). Uncomputable metrics are null, never invented.
- **Public repo hygiene**: `.planning/` is tracked in a public repo, so no secrets, PROD ids, home paths or account numbers in tracked text. A no-allowlist gate in `npm run lint` enforces the username scrub (SEC-02).
- **Privacy**: scenario sharing touches RLS — a shared scenario must not leak the allocator's book or another tenant's data.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Reuse the existing scenario engine, never rebuild | `computeScenario` + toggle state + factsheet panels already do the hard part | ✓ Good (R4/H-0133 shipped on it) |
| Leverage v1 = caveat-only (no borrow/funding cost) | `L·r` is scale-invariant → Sharpe/correlation unchanged; honest label beats fake precision | ✓ Good (shipped #493) |
| Scenario Impact view = delta-only, no FactsheetBody | `ingestSource:"api"` peer-ranks a hypothetical blend → no-invented-data violation | ✓ Shipped (v1.1.0; IMPACT-02 guard) |
| Heavy scenario compute location (client TS vs Python) | Monte-carlo + optimizer are heavier than the current client engine | ✓ Resolved (v1.1.0: MC in client Web Worker; optimizer the one Python endpoint) |
| v1.2: unify Portfolios + Scenario tab + Sandbox into ONE composer | Three fractured surfaces + a dead `/portfolios` add-strategy link broke the workflow end-to-end | ✓ Shipped (v1.2; unified composer, `/scenarios` retired) |
| v1.2: "factsheet parity" = graphs only, peer panels stay suppressed | Honesty invariant locked — you cannot peer-rank a hypothetical blend | ✓ Shipped (v1.2; GRAPH-04 + IMPACT-02 guard) |
| v1.2.1: 252 stays the universal annualization basis (not crypto-365) | Displayed/ranking metrics must stay apples-to-apples; `periods_per_year` param makes a future per-asset divergence a one-line call-site change | ✓ Shipped (v1.2.1; ANNUAL-02/03/04/05 redefined, mutation-verified 365-rescale proof) |
| v1.2.1: per-key axis on existing `csv_daily_returns` (not a new table) | Resolves the `strategy_id NOT NULL FK→strategies` blocker without inventing synthetic strategy rows | ✓ Shipped (v1.2.1; dual-axis strategy XOR `api_key_id` + per-key owner RLS) |
| v1.2.1: composer factsheet parity = chart reuse, not a fork | Mounting the REAL `TimeSeriesChart`/`MasterBrush` under `persist={false}` keeps the factsheet byte-identical while the composer gets full interaction parity | ✓ Shipped (v1.2.1; Overview untouched, scope-bounded) |
| v1.2.2: reuse the factsheet wholesale, never rebuild | Feed the blend into the REAL `FactsheetBody` via one adapter + an additive `scenarioMode` flag; minimizes new code and guarantees parity by construction | ✓ Shipped (v1.2.2; factsheet byte-identical, BODY-02 gate) |
| v1.2.2: peer-rank override = aggregate-only `scenarioPeer` carve-out | An honest blend-vs-verified-universe rank is valuable, but per-constituent ranking or an `ingestSource` flip would re-invent data; a separate aggregate path stays inside no-invented-data | ✓ Shipped (v1.2.2; PEER-01, audit-c20 pin replaced) |
| v1.2.2: untrack live `.planning` ROADMAP/REQUIREMENTS/STATE | They were force-tracked at a frozen v1.1.0 snapshot, so branch ops kept reverting them and clobbering each milestone close; `.planning` is gitignored by design | ✓ Fixed (PR #530, 2026-06-27) |
| v1.4: presentation-layer milestone — lift desktop byte-identity, keep the math frozen | The visual layer needed to change to fix scaling/clipping/hierarchy, but `scenario.ts`/`compute.ts`/`FactsheetBody` must stay byte-identical | ✓ Shipped (v1.4; SCENARIO-05/BODY-02 green, frozen-spine + git-delta guards) |
| v1.4: fluid type = pure CSS `clamp()` in a plain `@theme` block (not `@theme inline`) | `@theme inline` flattens the variable chain; plain `@theme` keeps the token indirection so surfaces inherit no-clip scaling. Zero new deps for type/container/motion | ✓ Shipped (v1.4; clamp-without-rem F94 guard) |
| v1.4: one new prod dep (`radix-ui@1.6.0`), scoped to non-native widgets only | Native `<dialog>`/`<select>` stay native; Radix only where there's no native HTML equivalent (Tabs etc.) | ✓ Shipped (v1.4; Table/Field are semantic HTML, Tabs the lone Radix primitive) |
| v1.4: `no-raw-font-px` flipped to error repo-wide, frozen-chart islands off-glob exempted | App-wide token conformance without touching the byte-frozen chart SVGs (which carry intentional raw px) | ✓ Shipped (v1.4; 233 sites/60 files migrated byte-identically) |
| v1.4: visual regression = tolerance-based Playwright goldens, never blind `--update-snapshots` | Blind snapshot updates mask real regressions; deliberate per-chart re-baseline + tolerances + masked dynamic regions instead | ⚠ Partial (v1.4; harness landed, live PNG bake deferred-to-CI via WR-02 green-by-skip) |
| v1.5: REPLACE the blend convention with coverage-window membership (not additive) | An ended strategy dividing the blend toward zero is a bad convention, not a bug; two conventions in one engine would be worse | ✓ Shipped (v1.5; BLEND-01..07, numpy-pinned) |
| v1.5: first deliberate rewrite of the FROZEN `scenario.ts` since v1.2 — spine guards re-baselined as a reviewed act, never deleted | Frozen-by-default stays the rule; changes go through independent re-derivation (BLEND-07) + parity re-verify + staged re-bake, never a silent drift | ✓ Shipped (v1.5; frozen again post-#565, zero-diff through #570) |
| v1.5: persist the coverage window in the draft (schema v2→v3, non-destructive upgrade branch) | A VIEW-derived default that isn't persisted diverges cross-surface (RT-1 class); saved/shared/compared must recompute at the OWNER's window | ✓ Shipped (v1.5; PERSIST-01..03, `upgraded_v2_windowless`) |
| v1.5: derive the intersection default via ONE shared helper chain everywhere | Same inputs through different derivations = silently divergent membership between composer, share, and compare | ✓ Shipped (v1.5; integration-checker verified 3/3 sites) |
| v1.5: merge added units into the per-key engine set at ONE point, normalizing USD→shares there only | The two adapter paths disagreeing by construction caused P61-BUG-1/2; a merge helper keeps the keys-only blend byte-identical (engine is scale-invariant per selected set) | ✓ Shipped (#570; both call sites verified) |
| v1.5: book-only shares fail honest at MINT (409), live-book privacy boundary kept | The public page must never resolve owner book series; a dead em-dash share page reads as broken — refuse early with the reason instead | ✓ Shipped (#570; already-minted links render honest-absence) |
| **v1.8: SPLIT the annualization basis — RETURN/CAGR on 365 (calendar), RISK/Sharpe on 252** | Founder-corrected 2026-07-05 (my initial "252 universal" was wrong). quantstats 0.0.81 `cagr` computes `years = len(returns)/periods` then `(1+total)^(1/years)−1`; a 24/7 crypto series has a return every calendar day, so `periods=252` makes a 365-day record read as 1.45 years and mis-annualizes the return. **CAGR (and Calmar = CAGR/\|maxDD\|) must annualize on the true calendar clock → 365** (best implemented as true elapsed-calendar-days, frequency-proof). **Sharpe/volatility/Sortino/rolling_\* stay 252** — that √252 risk-comparability convention is what ANNUAL-02 actually protects, and it is preserved. This **supersedes ANNUAL-02 for the return metric only**; it changes displayed CAGR/Calmar for every crypto factsheet, so it rides the Phase 78 golden-parity gate. | ▶ Decided 2026-07-05 (v1.8; founder domain call — return vs risk are orthogonal clocks). Requirement TWR-05. |
| **v1.8: uPnL basis — realized-basis intra-window NAV + fail-loud DQ flag when the anchor's uPnL wedge is material** | The anchor is mark-to-market (incl. open uPnL) but daily `pnl_t` is realized-only, so a backward roll drifts by the running uPnL wedge. Default: reconstruct on a realized-basis terminal NAV, re-add uPnL only to the reported *current* NAV, and raise `unrealized_pnl_in_anchor` (`complete_with_warnings`) when material. A per-day uPnL true-up is pursued ONLY if Phase 5 confirms historical open-position marks are retrievable on read-only keys per venue (MEDIUM confidence). Never silently absorb the wedge. | ▶ Decided 2026-07-05 (v1.8 pre-gate; Phase-5 availability check may upgrade to per-day true-up) |
| **v1.10: dailies are canonical — every metric/chart/panel derives from the daily return SERIES through the ONE backbone (`derive_basis_series`)** | Scalars-first bred divergence (the Phase-101 √252 class, cash-vs-MTM chart drift); making the daily series the single source of truth and deriving scalars as a cache from it kills the whole class. Realized by routing composite + onboarding onto the shared route, deleting the trades-based legacy chain + all 4 dark re-entry points, and making `USE_COMPUTE_JOBS_QUEUE` mandatory. | ✓ Shipped (v1.10 BB-01..03; grep-gates 0, prod-verified) |
| **v1.10: leverage evolves from caveat-only re-scale to an `r→L·r` dailies transform that re-derives the WHOLE factsheet** | The v1 caveat-only frontend re-scale (`useLeveragedMetrics`) was a bypass of the backbone; making leverage a dailies preparation transform makes β→L·β / α→L·α fall out honestly and the charts+rail follow, deleting ~780 LOC of disclosure. Still excludes borrow/funding cost (labeled what-if), L=1 by-reference byte-identity. Supersedes the v1 "caveat-only" decision. | ✓ Shipped (v1.10 LEV-BB; scenario-planner followed via SCEN-BB) |
| **v1.12: a live sFOX API read is `api_verified` ground truth; the custom non-ccxt adapter earns its cost over the CSV path** | CSV track records are `self_reported` — fabricatable. A live read of the real account is ground truth a submitter can't fake (the Phase-111 provenance tier). sFOX is NOT in ccxt, so a bespoke `SfoxClient` is required; read-only is asserted STRUCTURALLY (no write surface, no scope endpoint), never a probed permission triple. | ✓ Shipped dormant (v1.12 SFOX-01/05; flag-OFF, go-live → v1.13) |
| **v1.12: close as FOUNDATION (flag-OFF) with go-live re-homed, rather than block or fake completion** | v1.12 is code-complete but its acceptance is founder-gated ops (Fly deploy + IP-whitelist, FLIP cutover, live E2) + a real e2e defect + an evidence-gated deribit phase — none landable this session. Shipping the foundation dormant + re-homing the enumerated go-live spine to v1.13 keeps prod safe and the ledger honest. | ✓ Foundation close (v1.12; `close_type: foundation`, re-home table in the audit doc + v1.13 seed) |
| **v1.20: scope = verified-open, agent-deliverable items only, re-measured at HEAD** | A 17-agent triage (269 items: 211 open, 27 partial, 31 stale, 33 founder-gated) showed the backlog's own recorded remedies were measurably wrong in three places; only re-verified items entered, stale ones were closed, and the phases carry the corrections, not the bullets. | ✓ Good (v1.20; 62/64, audit tech_debt) |
| **v1.20: OPS-01 fix = an external FIFO mutex plus a `cancelled`-conclusion watcher, not a smaller concurrency group** | Eviction is cross-run, so shrinking the group does not stop a PR from cancelling main CI and silently skipping the Railway deploy (#616). | ✓ Good (v1.20 Phase 158; the mutex later became the shared-TEST serialization) |
| **v1.20: `api_keys.exchange` is server-authoritative; the √365/√252 stamp derives from the attested venue** | A client-supplied venue could forge the annualization stamp. Deploy writers first, soak, then a census-guarded `REVOKE INSERT`; a null attestation must not read as traditional. | ✓ Good (v1.20 RANK-03/04, Phase 160) |
| **v1.20: SHARELINK-01 — revocable per-strategy share token; the id stays a non-secret** | Copy Link must always produce a viewable link without making the id a credential. The token lane may never poison the id-keyed public cache (adversarial anon-404 acceptance). | ✓ Good (v1.20 SHARE-01..04, Phase 164) |
| **v1.20: password floor measured, not raised (founder 2026-08-26)** | The hosted minimum was read from the live endpoint (6, no class rule); the founder accepted it knowingly. The repo pins only what it controls. | ⚠️ Revisit (on paying clients, custody/compliance need, or credential-stuffing evidence) |
| **v1.20: `.planning` username scrub is forward-only; history rewrite declined (founder 2026-08-26)** | The string was already public, cloned and cached; a `filter-repo` would break open PR refs and not unpublish it. A no-allowlist lint gate stops new leakage. | ✓ Good (v1.20 SEC-02) |
| **v1.20: Phase 165 DEPS retired; dependabot lands as maintenance (founder 2026-09-27)** | "Land as maintenance, retire the phases": one PR at a time under the green rule needs no phase. DEPS-01 is descoped, not failed. | ✓ Good (v1.20; Phases 165, 165.1, 165.2 retired) |
| **v1.20: a control that cannot fail is caught by machine (Phase 164.3 VACUITY)** | Red-team review kept finding gates that could not go red. A mutation runner over every `RED-UNDER` arm, a static linter, and ratcheted floors (`WAIVED_CEILING` stays 0) make vacuity a CI failure. | ✓ Good (v1.20 VAC-01..08) |
| **v1.20: completion is historical; drift is a separate report (founder 2026-09-18)** | A `passed` verification was being demoted to `stale` the moment a covered file changed, so the more carefully a phase was verified the less likely a milestone could close. Use `verified_at_sha` plus `drift_subjects`; the drift report never gates. | ✓ Good (v1.20; repo-owned rule) |
| **v1.20: the Production migration reviewer gate removed (founder 2026-09-23)** | "It should just apply. I want to develop fast." PROD migrations auto-apply once the TEST apply succeeds; all review moves before the merge. Pre-revenue acceptable. | ⚠️ Revisit (when the first client lands) |
| **v1.20: a push to main mutates only what the pushed range needs (Phase 164.9.6, D-09)** | The 20-minute `sql-mutation` ceiling is never raised; a founder-scoped exception to the vacuity fence on pushes to main, with a nightly full-corpus run holding the floors. Any doubt runs FULL. | ✓ Good (v1.20) |
| **v1.20: allocator equity is marked-to-market; the legacy `allocator_equity_snapshots` curve is dropped (Phase 176 D-02)** | One stated price rule everywhere; every reader moves to the derived series. One-way migration (restore from backup to undo). | ✓ Good (v1.20 Phases 167.2.1.1.1, 167.2.1.1.1.1, 176) |
| **v1.20: Deribit flows are booked at the flow's time, not end of day (Phase 185, founder 2026-11-01 "Book the fix now")** | End-of-day netting turned an intraday deposit into a phantom return on the capital that was actually there. | ✓ Good (v1.20 Phase 185, verified) |
| **v1.20: a bad read holds last good and names it; a failing key affects only itself (Phase 186 D-02/D-03/D-05/D-07)** | Nothing partial is ever published. Bybit internal transfers are flows (reverses 180 D-02); a dead key leaves the book that day instead of blocking everyone. | ✓ Good (v1.20 Phase 186, verified 7/7, security 36/36) |
| **v1.20: a day on a tiny base is left out, not shown as performance (Phase 188 D-01..D-08)** | Key C's +47% and -53% days were correct arithmetic on about 0.4% of the account. Under 5% of the 30-day peak the day is null; zero base stays out of the rule; the scenario readers were fixed in the same phase. | ✓ Good (v1.20 Phase 188; key C's rows absent, `key_inputs_mismatch` cleared) |
| **v1.20: 188 closes on what passed; the SC-4 residual goes to the next milestone (D-13, founder 2026-11-06)** | The re-reading read NOT CONFIRMED under its strict rule (1214 stored values moved between nightlies, cause unmeasured). The founder first chose a control capture, then closed 188 and moved the rest. | ✓ Good (v1.21 Phases 202 and 203: 1142 of 1214 values attributed, 72 named unexplained; b3's reasons explained) |
| **v1.20: a re-run never un-publishes a computed factsheet (Phase 190 D-02/D-03)** | A pending or computing re-run used to fail the strategy gate and drop the strategy from allocators. It stays published with a quiet "Updating" line. | ✓ Good (v1.20 Phase 190, verified) |
| **v1.20: the refusal-marker race closes in two PRs, migration first, and the marker counts only on a confirmed write (Phase 191 D-06/D-07)** | Migrations auto-apply on merge and the Vercel deploy is not ordered against the apply; a zero-row update must fail TRANSIENT, not pass silently. | ✓ Good (v1.20 Phase 191, verified 5/5; PROD did not exercise the race in the window, the live two-connection CI probe carries the proof) |
| **v1.20: venue-specific phases (Binance income 187, Deribit option replay 189) leave the milestone (founder 2026-11-03)** | Not delivered; `TODOS.md` carries them (`187-BINANCEINCOME-NEXT-MILESTONE`, `189-OPTIONREPLAY-NEXT-MILESTONE`). | — Pending (owned by TODOS until re-booked) |
| **v1.20 close: the next milestone is a UX milestone (founder 2026-11-06)** | v1.20 was correctness and integrity; the product surface comes next, carrying the 188 SC-4 residual follow-up. | ✓ Good (v1.21 shipped 2026-11-13) |
| **v1.21: trust first; fix and trim only (founder 2026-11-06)** | The five-persona review found false claims, dead ends and duplicate surfaces; new manager-entered data (TERMS-01/02) waits, empty "on request" rows are hidden instead. | ✓ Good (v1.21; 32/32) |
| **v1.21: retire the public demo instead of repairing it (Phase 192 D-11, founder 2026-11-07)** | "Retire the whole demo part": a demo that needs constant upkeep is a standing source of false claims. ROUTE-03 amended to match. | ✓ Good (v1.21 Phase 192) |
| **v1.21: show, don't flag; withhold only on a short total record (Phase 194 D-05, D-15)** | No plausibility bound is set. A crypto record under 90 days or another under 60 observations withholds an annualised figure; a window under a year is qualified. One `figure-gate.ts` verdict on every path (194.1, 194.2, 205). | ✓ Good (v1.21) |
| **v1.21: a strategy has one page, the factsheet (Phase 196 D-03)** | `/strategy/<id>`, `/v2` and the discovery detail routes 308-redirect to `/factsheet/<id>` with origin parameters for the back link; the tearsheet is its print view. | ✓ Good (v1.21) |
| **v1.21: real name everywhere a strategy is visible; managers stay pseudonymous (Phase 201 D-09, founder 2026-11-10)** | One resolver decides name, then codename, then `Strategy #<id>` by the caller's visibility. | ✓ Good (v1.21) |
| **v1.21: b3's `window_truncated` is intended behaviour (Phase 203)** | The token is one boolean over unequal member windows, classed benign and outside the blocking set; recorded with evidence, not fixed. | ✓ Good (v1.21 RESID-02) |
| **v1.21: composer range stored as dates (founder 2026-11-13, "Book a fix")** | Indices drift when the axis grows at the front; the "kept when the series grows" contract is re-pinned to mean the same dates are kept. | — Pending (next milestone, `201.1-COMPOSER-RANGE-AS-DATES`) |
| **v1.21 close: skip gsd-tools' `audit-open` pre-close check, record it (founder 2026-11-13)** | It refuses on seven archived VERIFICATION statuses outside its closed set; rewriting historical verdicts is not acceptable. Upstream issue drafted. | — Pending (until gsd-core reads archived reports leniently) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

## Current State

**v1.21 UX — trustworthy, navigable, lean shipped and closed 2026-11-13** (audit `tech_debt`, 32/32
requirements, 18/18 phases `passed`). See the `## ✅ Shipped: v1.21` section above. The next milestone is not
started; it carries the composer range-as-dates fix and TERMS-01/02.

**v1.20 Backlog Burndown shipped and closed 2026-11-06** (audit `tech_debt`, 62/64 requirements, 142/142
phases `passed`; DEPS-01 descoped with Phase 165, HONEST-07 still deferred). See the
`## ✅ Shipped: v1.20` section above. The next milestone is a UX milestone (founder 2026-11-06) and it
carries the Phase 188 SC-4 residual follow-up (D-13). The paragraphs below are older and historical:
the "v1.17 in flight" and "Now starting v1.16" notes do not describe the current state, and the
authoritative shipped history is `MILESTONES.md` + `milestones/`.

**v1.17 in flight — Phase 151 (AUM) complete 2026-08-07** (5/9 phases done: 147–151).
Direct AUM input + per-strategy dollar sizing, non-ccxt holdings-sync class fix
(MT5 equity row + sFOX proof), partial-book gate with role-based manager-key
exclusion, honest refusal copy. 30/30 must-haves verified; 4 PROD-gated UAT items
open in `151-HUMAN-UAT.md`. Next: 152 SCEN composer legibility.

**v1.15 MetaTrader 5 shipped + LIVE 2026-07-25** (tag `v1.15`, v0.49.4.0) — MT5
elevated to a live `api_verified` account sync, flags flipped on quantalyze.xyz
(Vantage acct soaked, factsheet proven). v1.13 Infra + v1.14 Smoothed-MTM also
shipped since the last PROJECT.md milestone rewrite; the authoritative shipped
history is `MILESTONES.md` + `milestones/` (this document's older shipped-milestone
sections below jump v1.12 → v1.10 and were not backfilled).

**Now starting v1.16 Production Resilience & Reliability** (planning, Phases 140+).
Having gone live with real money-bearing integrations (Deribit, MT5, sFOX/Nautilus
next), the top live-surface risk is that the plumbing has no failure handling: the
Vercel→Railway analytics seam has no timeout/retry/circuit-breaker; a dropped
`after()` enqueue or a worker crash strands a strategy on a "computing" spinner
forever; and the authed routes hitting Python are unrate-limited. Scope = **SEAM +
JOB + RATE** (CRON deferred, founder 2026-07-25). Research-first. **Next:** define
requirements → roadmap.

<details>
<summary>Stale pre-v1.9 close context (retained; authoritative history is MILESTONES.md + milestones/)</summary>

**Active milestone: v1.7 Deribit Exchange Coverage & Carry-Forward Burn-Down** (started 2026-07-04;
Phases 66+; see ## Current Milestone above). Prior close context below.

**v1.6 Scenario Series-Space Purification closed 2026-07-04** (tag `v1.6` @
`f78f036b`, app version v0.36.0.0, single PR #572; audit PASSED 16/16 reqs · 4/4 phases · 6/6
integration seams; live canary GUARD-04 clean, 0 bugs). The scenario tab now operates purely in
series space: saved drafts persist explicit per-key membership (`memberKeyIds`, schema v4,
non-destructive upgrades), ONE `buildAddedOnlySet` engine feeds composer/compare/share (the
holdings-snapshot builder + scenario-dealias machinery are deleted with a source-scan guard against
reintroduction), the KPI strip is return-form only (commit weight×AUM boundary intact), and public
mixed shares carry the honesty caption with zero member-UUID leakage. The frozen engine stayed
zero-diff the whole milestone (vs `e5e83247`). A pre-landing Fable red team caught F-1 (blank-session
Update silently wiping book membership); fixed at the root, verified live at the persisted layer.
Archived at `milestones/v1.6-ROADMAP.md` / `v1.6-REQUIREMENTS.md` / `v1.6-MILESTONE-AUDIT.md` /
`v1.6-phases/`.

**Deferred at close (tracked in TODOS.md, git-tracked):** P1 dead `holdingReturnsByScopeRef` SSR
pipeline removal (planning-locked KEEP through v1.6); P2 dead share-mint `isBookOnlyDraft` disjunct
(red-team F-3); P3 >64-key save-cap misleading error (F-5); P3 deploy-skew membership
strip/downgrade window (F-4). Planning-ledger only: `holdingsSummary` SSR removal; 6 `phase10-rpc-*`
residue auth.users rows; D3 persist source-toggles; friendly gantt key labels (P61 B1);
compare-panel payload-cast type-safety (AllocationsTabs.tsx:964). Standing human checkpoints carried
from v1.4/v1.5: real-device authed sign-off; deliberate golden-PNG re-baseline.

**Next:** v1.7 requirements → roadmap (in progress). Phase numbering continues from Phase 66 (no
reset). The v1.6 deferred list above is now IN SCOPE for v1.7 (carry-forward burn-down).

**Baseline (locked):** the frozen engine (`src/lib/scenario.ts` + `scenario-window.ts`, coverage-window
model, zero-diff again post-v1.5) + save/compare/share/stress/Monte-Carlo/optimizer (v1.1.0) + the
unified composer (v1.2) + the per-key honest source (v1.2.1) + the real-factsheet-on-the-blend
(v1.2.2) + the mobile/adaptive layer (v1.3) + the evolved design system & fluid token spine (v1.4) +
honest coverage-window membership with durable windows (v1.5) — reuse, never rebuild. The
no-invented-data invariant stays LOCKED; the no-peer-rank invariant has its one audited AGGREGATE
override (`scenarioPeer`, never `ingestSource`). `compute.ts`/`FactsheetBody` parity (BODY-02) and
the WCAG-AA floor stay green.

</details>

---
*Last updated: 2026-11-13 at v1.18 resume (after v1.21 closed, audit tech_debt, 32/32). Older shipped-milestone sections here are historical; `MILESTONES.md` + `milestones/` are authoritative.*

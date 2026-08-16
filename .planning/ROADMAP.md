# Roadmap: Quantalyze

## Shipped Milestone: v1.17 MT5 — ingested, wizardable, surfaced (Phases 147–154, 156) ✅ CLOSED 2026-08-14

⚠️ **SCOPE AMENDED 2026-08-14, and the amendment is the point.** This milestone originally ran
147–155 and its title claimed *"usable end-to-end, not merely ingested"*. Phase 155 (MT5-VERIFY —
the live trading-day parity run against the terminal's own figures) was **REMOVED from scope and
carried to v1.18**. It was neither silently dropped nor ticked unmet. With it went MT5-06, MT5-07,
MT5-08, MT5-09, MT5-10, MT5-15 and the umbrella acceptance MT5-GOAL-01.

**Founder decision (2026-08-14).** A bounded alternative — move 155 to TODOS.md and tick v1.17
complete — was offered and **declined**, on the grounds that it would leave every ledger reading
"MT5 usable end-to-end" while our numbers had never once been compared to the broker's.

⛔ **CLOSED but NOT ARCHIVED, and MT5 is NOT advertised.** What v1.17 actually earns: MT5
*ingests*, is *declarable in the wizard*, *projects in a scenario*, has a *viewable factsheet*,
and the wizard's write is the server's alone. What it does NOT earn: any claim that the
performance we render matches the terminal's. Nobody has compared them.

⭐ **MT5-GOAL-01 was written as a tripwire against exactly this reading** — it exists, in its own
words, "so 'MT5-05 ✅' can never again be mistaken for 'MT5 works'." Carrying it into v1.18 keeps
the tripwire armed. Discharging it by relocation would have disarmed it, which is precisely
v1.15's failure mode: shipped 6/6 green with both open items intact.

---

## Current Milestone: v1.18 MT5-VERIFY & founder confirmations (Phases 155, 157)

**Goal:** The numbers Quantalyze renders for the live funded MT5 account are proven true against
the terminal's own figures — and the handful of observations only the founder can make are made.

⛔ **EVERY phase in this milestone is founder-gated. That is its defining property, not an
accident of sequencing.** Nothing here can be delivered by an agent. The milestone was created on
2026-08-14 so that the agent-deliverable work in v1.17 could close without waiting on a calendar.

**Blocked on, both required:**

1. ⛔ **New MT5 investor passwords.** The founder changed the account passwords on/around
   2026-08-14, so the stored credentials are stale and will not authenticate. MEASURED on PROD
   that day: three `mt5` keys exist (labels `FX-AI_V`, `MM2`, `MM3` — ⚠️ **there is NO key
   labelled `MM1`**, so the founder's "MM1 and MM2 are erroring" does not map 1:1 onto stored
   rows; **re-verify ALL THREE at reconnect**), all `disconnected_at IS NULL`, all
   `sync_status='complete'` with `last_sync_at` 04:01–04:07 UTC — those are the last *successful*
   syncs, taken **before** the change.
   ⛔ **When these flip to `error`, that is EXPECTED. Do not investigate it as a code defect.**

2. ⛔ **The founder physically at the MT5 terminal, on a TRADING day**, with the live funded
   account's read-only investor password. A demo account, the v1.15 soak account, or a weekend run
   does not satisfy it.

**Settled inputs — do not re-litigate:**

- Parity tolerance **1%, INCLUDING open P&L** (founder call 2026-08-14). Adjustable later; keep it
  a named test constant, never a hardcoded literal.

- ⭐ **The measurement window MUST end before the day of the run.** `broker_dailies` anchors to
  today — initial capital is derived as `current_equity − total_pnl` — so reconstruction error
  accrues *backward into the past*. Comparing today's equity is therefore near-tautological, and a
  historical window is the only one that can actually fail.

**Requirements:** MT5-06, MT5-07, MT5-08, MT5-09, MT5-10, MT5-15, MT5-GOAL-01 (umbrella acceptance)

⛔ **Do not advertise MT5 until Phase 155 passes.** Carried verbatim from v1.17.

---

## Current Milestone: v1.19 JOB/RATE — job-lifecycle reliability and the rate limits that hold (Phases 143–146)

**Goal:** A compute job that is dropped, orphaned, or half-written is DETECTED and terminates visibly — and every authed route that reaches the Python service carries the right limit, enforced by something a new route cannot silently bypass.

⭐ **Created 2026-08-14 by carrying Phases 143–146 out of v1.16, which closed scoped-down at 15 phases.** The phase NUMBERS are unchanged on purpose: `REQUIREMENTS.md` and `TODOS.md` cite them by number in dozens of places, and renumbering would break every one of those references to buy nothing.

⭐ **Why this is a milestone and not a v1.16 resumption:** GSD models ONE current milestone and v1.18 already held that slot while being entirely founder-gated. Working four phases under a header that says PARKED is the ledger-vs-reality drift that produced four blockers in the v1.17 audit. This milestone is also the one that is fully **agent-deliverable** — v1.18 cannot move without the founder at an MT5 terminal.

**Requirements:** JOB-04, JOB-05, JOB-06, JOB-08, RATE-01, RATE-02, RATE-03, RATE-04, RATE-05 (9 total)

⛔ **EXECUTION ORDER IS 143 → 144 → 145 → 146 AND IT IS A DECLARED DEPENDENCY CHAIN, not a preference.** 143 depends on Phase 142 (complete); 144 on 143; 145 on 144. 146 depends on nothing upstream but is sequenced LAST *because its deliverable is a fresh grep* — run earlier it audits a codebase about to change and reads as coverage it does not have. ⚠️ A risk-first reordering (145/146 first, 144 last) was proposed on 2026-08-14 and rejected for inverting 145's dependency.

⚠️ **143 and 144 carry pg_cron MIGRATIONS. Merging `supabase/migrations/**` to `main` AUTO-APPLIES to PROD.** Founder call 2026-08-14: land them unattended. ⛔ **144 is the dangerous one and it runs SECOND, so it gets no long PROD soak** — the sequencing mitigation does not exist here. Its safety comes from the change itself: assert the migration writes a terminal `failed` state and issues NO `DELETE`, prove it on TEST, verify on PROD before 145 begins. A reaper that deletes rows it should have reset is **not revertible**.

⭐ **Two phases are MEASURE-FIRST by design and must not be shortcut:** 144 SC4 requires a committed PROD measurement of the stale-`pending` population BEFORE any sweep is scoped ("zero on prod" is a valid, budget-saving outcome), and 145 SC1 requires a committed reproduction attempt of the 42501 claim BEFORE a fix is scoped ("could not reproduce" likewise).

**Plans**: TBD — none of these four has ever been planned; no phase directory exists for any of them.

---

### Phase 143: JOB — Dropped-enqueue reconciliation sweep

**Goal**: "`after()` never ran at all" enqueue drops — architecturally invisible from inside the route handler — are detected by absence and healed
**Depends on**: Phase 142 (same three-table triangle; scheduled as one non-racing mechanism)
**Requirements**: JOB-04
**Success Criteria** (what must be TRUE):

  1. A strategy with persisted daily-returns data but NO `compute_jobs` row of ANY status and no terminal `strategy_analytics` row, past a grace window, is re-enqueued by a pg_cron sweep and a Sentry alert fires — the hole the in-closure `writeFailedStrategyAnalyticsPlaceholder` guard structurally cannot catch.
  2. Running the sweep twice in a row produces no duplicate job. ⚠️ MECHANISM CORRECTED 2026-08-16 (Phase 143-02, falsified by an observed neuter): the operative guard is the sweep's `FOR UPDATE SKIP LOCKED` — an INSERT into `compute_jobs` key-share-locks its parent `strategies` row — NOT the partial unique index. Sequential double-execution cannot conflict at all, because tick 1's INSERT removes the strategy from the zero-jobs conjunct. The index only redeems a genuine READ COMMITTED race with `SKIP LOCKED` also removed. Corollary: a gate that runs the body twice in one session CANNOT FAIL and must not be written.
  3. A strategy inside the grace window, or with any existing job row, or with a terminal analytics row, is never touched by the sweep.

**Plans:** 3/4 plans executed

Plans:
**Wave 1**

- [x] 143-01-PLAN.md — Worker alert path: init_sentry() into main_worker.main() + reconcile-sweep marker capture on claim (the D-11 correction; RED-first pytests)
- [x] 143-02-PLAN.md — Census (TEST+PROD, STOP rules) + the sweep migration (inline pg_cron body, MATERIALIZED LIMIT 25, hourly at :35, composite-excluded) + throwaway-Postgres end-to-end tracer proof

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 143-03-PLAN.md — CI gates: SQL gate Parts 1-4 (deployed-body oracle), TS migration-content gate, pytest cross-language marker contract; nine observed neuter REDs

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 143-04-PLAN.md — [BLOCKING] Apply to TEST via Supabase MCP, sql-tests RED→GREEN, ONE real tick heals a seeded orphan (the FORCE-RLS/L-2 proof), worker SENTRY_DSN verdict, TODOS deferrals, human gate

**Note**: Constrained by JOB-07 (Phase 142) — sweep runs in pg_cron, never the worker loop. The "what counts as orphaned" design pass is settled in 143-CONTEXT.md + 143-02-PLAN.md's decision map (source-agnostic dailies anchor; ANY-kind/ANY-status job conjunct; terminal-analytics safety conjunct; composites and the wizard first-hop drop excluded as documented non-coverage).

### Phase 144: JOB — WR-02 orphaned-running DELETE→terminal UPDATE + cadence

**Goal**: An orphaned `running` compute job terminates VISIBLY — pollers break out, the audit trail survives — resolving the founder's open WR-02 DELETE-vs-reset call
**Depends on**: Phase 143 (JOB sequence; independent mechanism on `compute_jobs`)
**Requirements**: JOB-05, JOB-08
**Success Criteria** (what must be TRUE):

  1. An orphaned `running` `compute_jobs` row (past the UNCHANGED 4h `claimed_at` threshold) transitions to a terminal `failed` status instead of being DELETEd — so a wizard poller sees a real outcome and the row survives for audit until the existing 30/90-day retention crons delete it.
  2. Detection latency drops from ~24h to the tightened cadence (e.g. hourly) while a legitimate batch-tail job under 4h is never touched — the threshold, not the frequency, is what protects live jobs (the WORKER-04 2h→4h lesson).
  3. The change ships as a NEW migration layered on `20260720120000` (the shipped migration is never edited), reconciling the TEST-DELETE / PROD-reset split into ONE behavior.
  4. A committed measurement of the stale-`pending` `compute_jobs` population **on PROD** exists BEFORE any stale-`pending` sweep is scoped, and the gap is closed EITHER by adding `pending` as a fourth swept status (using SC 1's terminal-UPDATE pattern, never `DELETE`) OR by an explicit WON'T-FIX carrying that measurement — "zero on prod" is a valid, budget-saving outcome. The retention family covers `done` (jobid 4), `failed_*` (jobid 8) and orphaned `running` (jobid 11); stale `pending` is the one status an undrained enqueue cron produces and the only one nothing sweeps.

**Plans**: TBD
**Note**: The "fence flake also clears" claim is observation-only, NOT an acceptance criterion (research correction #4). Constrained by JOB-07 (pg_cron only).
**Note (SC 4 / JOB-08, added 2026-08-03)**: routed here from `TODOS.md` § CI / test-infra ratchet — same table, same cron family this phase already edits, and SC 3's TEST-vs-PROD split is the same gap. Full evidence and the two ⛔ traps (never `DELETE` pending; never `cron.unschedule(9)`) are in `REQUIREMENTS.md` § JOB-08. ⚠️ The gap is CERTAIN on the TEST project and UNMEASURED on prod — that asymmetry is why SC 4 is measure-first rather than build-first.

### Phase 145: JOB — csv-finalize atomicity (reproduce-first)

**Goal**: A mid-request csv-finalize failure leaves no orphan strategy row — and no budget is spent re-fixing the likely-stale 42501 bug
**Depends on**: Phase 144 (JOB sequence; order-independent within JOB — last because its scope needs the reproduction result first)
**Requirements**: JOB-06
**Success Criteria** (what must be TRUE):

  1. A documented reproduction attempt of the 42501 / `PROCESS_KEY_UNIFIED_BACKBONE` claim against current `main` exists (committed pass/fail) BEFORE any fix is scoped — "could not reproduce" is a valid, budget-saving outcome.
  2. A fault injected between `finalize_csv_strategy`, `persist_csv_daily_returns`, and the `after()` enqueue leaves no orphan strategy row — either the steps share one SECURITY DEFINER transaction, or explicit compensating cleanup runs + Sentry alerts (the choice recorded per the reproduction outcome and the CONTRIB-02 `p_terminal_status` owner-only variant's survival).
  3. Happy-path csv-finalize behavior is unchanged — including the CONTRIB-02 owner-only private-finalize path if the RPCs are folded.

**Plans**: TBD
**Note**: Constrained by JOB-07 (any cleanup mechanism stays off the worker loop).

### Phase 146: RATE — Audit + close the two verified gaps

**Goal**: Every authed route hitting the Python service has the RIGHT rate limit — and a newly-added route can't silently ship with none
**Depends on**: Nothing upstream (mechanical; sequenced last so its gap list comes from a fresh grep)
**Requirements**: RATE-01, RATE-02, RATE-03, RATE-04, RATE-05
**Success Criteria** (what must be TRUE):

  1. A committed kickoff re-grep artifact lists every `src/app/api` route calling either seam client × its `checkLimit` status — the authoritative gap list, replacing the stale `TODOS.md` route list (which named seven routes that were already limited).
  2. Burst requests to `admin/match/eval` beyond a per-`user.id` limit sized to real eval-tooling cadence receive `429` + `Retry-After`.
  3. Requests hitting Railway's `routers/match.py` (`/recompute`, `/eval`) directly — bypassing Vercel with a leaked `X-Service-Key` — are rejected `429` by server-side slowapi limits mirroring `portfolio.py`'s pattern (defense-in-depth).
  4. A committed audit of the seven existing limiter VALUES against real Python-side cost exists, with adjustments applied where a value was wrong — the substantive remaining RATE question.
  5. A `withRateLimit(handler, limiter)` HOF exists and composes alongside `withAuth`/`withRole`, wired on the routes this phase touches — so the no-CI-gate hand-wiring weakness has a structural successor.

**Plans**: TBD

---

## v1.17 phase detail, retained (Phases 147–156)

**Goal:** MT5 *works* in the founder's sense rather than the wizard's — it ingests (done), it
projects in a scenario, and its factsheet is viewable by the allocator who uploaded it.

**Founder verbatim (2026-08-04, minutes after MT5-05 was discharged on PROD):**
> *"The goal is that MT5 works. And at the moment, maybe it ingests the data, but I cannot use it
> in the scenario, and I can still not produce a factsheet."*

**Scope:** 30 in-scope requirement IDs — SCEN-01..05, AUM-01..05, NAV-01, OWN-02..05, MT5-06..10,
MT5-14, MT5-15, WIZFORM-01..05, WIZCONT-01..02, STALE-01, plus the umbrella acceptance requirement
MT5-GOAL-01 — per `.planning/REQUIREMENTS.md`. ⛔ OWN-01 excluded (already met — CONTRIB-03,
verified in code 2026-08-04; do not re-implement). ⛔ SEAM / JOB / RATE / PYAPI* / SEAMCORE /
SEAMUX remain v1.16 (PARKED below) and appear in NO v1.17 phase. Research SKIPPED (zero new
external features; every requirement is an already-root-caused defect carrying PROD evidence and
file:line citations in REQUIREMENTS.md). Phase numbering continues from 147 (v1.16 ended at 146).

⭐ **Defining constraint: almost NONE of this is an MT5 defect.** MT5 is the first venue to
traverse the whole path from a cold start, so it is exposing pre-existing holes in the surfaces
AFTER ingestion. SCEN-01 affects every real strategy at every venue; OWN-02 blocks every
unpublished strategy; AUM-05 will hit sFOX the day its flag flips. **A fix scoped to
`exchange === 'mt5'` is the wrong fix for nearly all of it.**

**Ordering rationale (non-negotiable — these are real dependencies, not preferences):**

- **SCEN-01 (147) FIRST** — a silent money-path correctness bug
  (`strategy_analytics.daily_returns` has NO production writer: 0 of 27 real strategies populated
  vs 15/15 demo seeds) AND it blocks meaningful verification of every other scenario surface —
  you cannot judge a composer whose engine receives an empty series.

- **OWN-02 (148) before NAV-01 (149), OWN-04 (same phase, strictly after) and SCEN-03 (152)** —
  all three link to a factsheet that today 404s; shipping them first builds the exact dead-end the
  previous milestone existed to delete.

- **148/149/150 split (revision 2026-08-04, superseding the approved single Phase 148):** the
  approved roadmap carried OWN-02 + OWN-03 + OWN-04 + NAV-01 as one phase. NAV-01 was then
  SHARPENED by the founder from "an overview" to a full **ranking at discovery parity** over every
  uploaded key incl. `private`/`draft` rows, and the bundled phase would have mixed three review
  profiles that dilute each other: a cache-disclosure fix with an adversarial acceptance test
  (OWN-02), a parity/no-invented-data UI surface (NAV-01), and the OWN set's first money-path
  WRITE (OWN-03, founder-mandated money-path review). Split so each gets the review it needs;
  every ordering constraint is unchanged and now structural (149 cannot start before 148).

- **AUM (151) after SCEN-01** — its symptom (zeros on screen) is entangled with SCEN-01's and
  would otherwise appear unfixed. ⚠️ AUM-01 does NOT fix the 0.00 metrics — that is SCEN-01.

- **MT5-06..10 (155) LAST** — they need a live funded account on a real trading day and a stable
  surface to measure; running them earlier means re-running them.

## Phases

- [x] **Phase 147: SCEN-01 — The scenario engine receives the real series** - Fix the READER (never the writer): every added strategy contributes its actual daily returns via the existing `resolveDailyReturnSeries`; wealth-index `returns_series` is differenced, never forwarded raw (completed 2026-08-05)
- [x] **Phase 148: OWN — Owner factsheet without cache disclosure** - The owner views the full factsheet of their own unpublished strategy; adversarial anon-404 acceptance on the public `unstable_cache`d route; wizard-preview link that can never dead-end (OWN-04 strictly after OWN-02) (completed 2026-08-05)
- [x] **Phase 149: NAV — "My strategies": a ranking at discovery parity** - Sidebar entry showing every uploaded key + derived strategy incl. `private`/`draft` rows, ranked with the SAME component/query as the external ranking (visibility predicate is the only difference); honest pending states, never zeros (completed 2026-08-05)
- [x] **Phase 150: OWN-03 — The wizard asks whose capital this is** - Own-capital-with-allocation vs verifying-a-team question at allocator finalize; (b) stays the default and a no-op; only an explicit (a) creates the portfolio position (money-path reviewed) (completed 2026-08-06)
- [x] **Phase 151: AUM — A book you can reach and a size you can set** - Direct AUM input, non-ccxt holdings-sync crash fixed as a CLASS (MT5 + latent sFOX), all-or-nothing book gate fixed incl. cross-role contamination, honest refusal copy (completed 2026-08-07)
- [x] **Phase 152: SCEN — Composer legibility** - Ownership marker, clickable rows with a working factsheet link, labelled numbers, no duplicate browse entries (completed 2026-08-07)
- [x] **Phase 153: WIZFORM — Form errors belong on the form (+ MT5 declarable)** ✅ **GOAL MET 2026-08-14 — via the INSERTED Phase 153.7, not by the original span.** Inline field validation, honest error codes from emitting sites, transient infra absorbed not surfaced, venue-appropriate copy, MT5 preselected in metadata. ⭐ **The mechanism is named on purpose and a bare tick would erase it:** the 153.1→153.6 span verdict REMAINS `failed` 5/6 in `153-VERIFICATION.md` and must not be rewritten — that file is the historical record that the span shipped short on WIZFORM-02. Phase 153.7 closed all four of its `missing` items, re-derived from source by the v1.17 milestone audit (router-vocabulary disposition at `wizardErrors.ts:3081`; population root widened at `seam-venue-vocabulary.invariant.test.ts:89` plus the `service_error` callee family at `:318`; boundary decision with per-exclusion reasons and count pins at `SCAN_EXCLUSIONS:134`; `KNOWN_CODELESS_FINALIZE_REJECTIONS = 0`), with both invariants executed at this tree — 2 files / 60 tests passed
- [x] **Phase 154: WIZCONT/STALE — Wizard continuity, no stale screens** - Draft-aware entry chooser, stale-screen root cause investigated BEFORE fixed (verdict M2(ii)), token-less credential dedup toward the existing row (completed 2026-08-12)
- [x] **Phase 153.7: WIZFORM-02-CLASS — every code that can reach a user is covered** ✅ **COMPLETE 2026-08-14** (INSERTED 2026-08-14) - The coverage law's population is DERIVED from every user-reachable code (`analytics-service/**`, positional `service_error(...)` as well as `error_code =`), and a code absent from BOTH halves reds CI; closes the one requirement the 153 span failed. 3/3 plans: population 17 → 37, all 37 dispositioned, and the last three code-less `finalize-wizard` rejections coded (ledger 3 → 0 with `EXPECTED_FINALIZE_REJECTION_SITES` never edited). **WIZFORM-02 ticked.** ⛔ NOT "add two rows" — see TODOS.md FIX NOW #6
- [→] **Phase 155: MT5-VERIFY — The numbers are true, live on a trading day** — ➡️ **CARRIED OUT OF v1.17 TO v1.18 on 2026-08-14.** Not started, not dropped, not ticked. Server-UTC offset measured, external-oracle parity on the live funded account, five surfaces agree, discrepancies fixed (uncapped), warnings explained; MT5-GOAL-01 acceptance gate. ⛔ Founder-gated twice over: new investor passwords AND the founder at the terminal on a trading day. Detail block below is retained in place; the milestone header at the top of this file owns its blockers
- [→] **Phase 157: FOUNDER-CONFIRM — the observations only the founder can make** — ➡️ **v1.18** (CREATED 2026-08-14). Discharges the human-verification items Phases 153.7 and 154 left open: the resume banner, the amber recomputing block, the four new copy members rendering (with NO Retry on `SEAM_INTERNAL_FAULT`), and the `MT5_SPIKE_INVESTOR_PASSWORD` rotation
- [x] **Phase 156: CONNECT-REFACTOR — the venue the server validated is the venue the server writes** ✅ **COMPLETE 2026-08-13** - `attested_venue` written by a service-role writer from the venue this server observed a successful read-only authentication at; `authenticated` EXECUTE withdrawn from both wizard RPCs; closes the PARITY-04 deferred control (CR-01, was live on PROD). Shipped as TWO PRs with a live PROD gate between them. ⛔ The pull-forward-ahead-of-155 trigger (sFOX go-live) is now moot — the residual it protected against is closed

## Phase Details

### Phase 147: SCEN-01 — The scenario engine receives the real series

**Goal**: A strategy added to a scenario contributes its actual return series — never silent zeros
**Depends on**: Nothing (first phase of v1.17)
**Requirements**: SCEN-01
**Success Criteria** (what must be TRUE):

  1. Adding any REAL (non-demo) strategy to a scenario — MT5, OKX, Bybit, CSV — projects non-zero metrics with an overlapping-days count matching its stored `csv_daily_returns` span (the founder's MT5 strategy contributes its 136 days, not "0 overlapping days" / 0.00 everywhere).
  2. The series the composer blends for a strategy equals the series that strategy's own detail pages render — both resolved through the ONE existing `resolveDailyReturnSeries`, with no third resolution mechanism minted (structurally asserted, not just observed).
  3. A wealth-index `returns_series` is never forwarded raw: a regression test feeds a series starting at exactly 1.0 and proves it is DIFFERENCED (day one is not +100%).
  4. A strategy with genuinely no stored series renders an honest empty/degraded state — never 0.00 metrics with no error, no warning, no empty-state.

**Plans**: 6 plans, 4 waves
Plans:
**Wave 1**

- [x] 147-01-PLAN.md — Foundation: resolve-series leaf extraction + SeriesState/deriveEmptySeriesState (16h age bound) (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 147-02-PLAN.md — Returns route (the SCEN-01 bug proper) + OG route: widen, resolve, series_state (wave 2)
- [x] 147-03-PLAN.md — Share path: Phase-84 sibling read + pure-layer resolver, zero DDL (wave 2)
- [x] 147-04-PLAN.md — Book path (`src/lib/queries.ts` — `getMyAllocationDashboard` defined :3323, its `portfolio_strategies` read :4217; the 4th reader): server-side resolution + derived series_state (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 147-05-PLAN.md — Composer UI: chip states syncing/no-series, tolerance, notes, SC4 matrix (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 147-06-PLAN.md — P6 reopen/refresh hydration fetch + SC2 structural grep-gate + audit/ledger closure (wave 4)

**Notes (binding traps)**:

- ⛔ **The READER is wrong, not the writer.** `strategy_analytics.daily_returns` has NO production writer at all (only the two demo/e2e seed scripts write it); the composer's returns route (`src/app/api/strategies/[id]/returns/route.ts` — the `strategy_analytics` `.select(` at :251-255) selects only that column. Do NOT backfill the column — that fights migration 087 (`20260428120919`, decision D-02), which deliberately moved heavy series off `strategy_analytics` (1MB TOAST ceiling).
- ⚠️ `returns_series` is a WEALTH INDEX — `_drop_nonfinite(cumprod(1+returns))`, verified on PROD for `4eab92b0`: starts at exactly 1.0, ends 0.7196. Shape-identical to `DailyPoint[]`, semantically inverted. It must be differenced.
- ⭐ Reuse `resolveDailyReturnSeries(daily_returns, returns_series)` — it already backs BOTH strategy-detail surfaces (`src/app/factsheet/[id]/v2/page.tsx` — `resolveDailyReturnSeries` call :121, `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx` — same call :65), has its own tests, and its docstring names this exact bug. Rule 7: do not mint a third mechanism.

### Phase 148: OWN — Owner factsheet without cache disclosure

**Goal**: The allocator who uploaded a strategy can view its full factsheet from that account — while it stays invisible to everyone else, and publication stays admin-only
**Depends on**: Phase 147 (sequencing; OWN-02 is itself the hard prerequisite for every factsheet link shipped later — NAV-01 in 149, SCEN-03 in 152, and OWN-04 within this phase)
**Requirements**: OWN-02, OWN-04
**Success Criteria** (what must be TRUE):

  1. The owner, from the account that uploaded it, views the FULL factsheet of their own unpublished (private/draft) strategy — today `withPublishedOnly` at `src/app/factsheet/[id]/v2/page.tsx` — the public arm `fetchAndBuildPayload(id, withPublishedOnly)` :296, whose miss reaches `notFound()` :454 — 404s them.
  2. **Adversarial, not happy-path:** AFTER an owner has viewed their draft, an anonymous request for the same id still 404s — the public `unstable_cache`d factsheet route never serves a cache entry populated by an owner render. Proven by a test.
  3. The wizard preview links to the full factsheet, and no link shipped in this phase can land on `notFound()` (OWN-04 — strictly after OWN-02 within the phase).
  4. Nothing shipped here widens visibility beyond the owner: anonymous and non-owner authed requests still see published-only on every surface the gate change touches, and publication remains admin-only.

**Plans:** 5/5 plans complete

Plans:
**Wave 1**

- [x] 148-01-PLAN.md — viewerNotice banner capability in FactsheetView (additive prop, byte-neutral, UI-SPEC verbatim)
- [x] 148-02-PLAN.md — DI seam: fetchAndBuildPayload(id, visibility) required param; cached wrapper stays visibility-free with the withPublishedOnly literal; false cache-key comment corrected; force-dynamic pin

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 148-03-PLAN.md — Lane B owner lane (probe-first, uncached build) + page.owner-lane.test.tsx with unstable_cache SPY (SC1/SC2-A/SC4)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 148-04-PLAN.md — SC2-B structural CI invariant (147-guards clone) + Rule-9 mutations at two sites

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 148-05-PLAN.md — OWN-04 wizard link, both success branches, structurally absent pre-success + phase gate & VALIDATION sign-off

**UI hint**: yes
**Notes (binding traps)**:

- ⛔ **OWN-02 is NOT a one-line `withPublishedOnly` → `withPublishedOrOwner` swap.** The route is PUBLIC and `unstable_cache`d keyed on `${id}::${computedAt}`, and its own header justifies the cache as safe *because "the only fields we cache come from the published row."* An owner-inclusive gate without cache work is a disclosure bug (same class as the `strategy_analytics (*)` anon splat in TODOS). Criterion 2 is the acceptance test.
- ⛔ OWN-04 must not land before OWN-02 within the phase — a link to `notFound()` is the dead-end class Phase 142.2 existed to delete.
- ℹ️ NAV-01 (the "my strategies" ranking) moved to Phase 149 in the 2026-08-04 revision; it consumes this phase's cache-safe `withPublishedOrOwner` gate and MUST NOT be pulled forward into this phase.

### Phase 149: NAV — "My strategies": a ranking at discovery parity

**Goal**: The allocator side stops being write-only — a sidebar entry shows every key they uploaded and every strategy derived from them as a ranking at parity with the external/discovery ranking, and every row opens its factsheet
**Depends on**: Phase 148 (OWN-02 — both the cache-safe visibility predicate and a factsheet that resolves; a ranking whose rows link to `notFound()` is the dead-end class Phase 142.2 existed to delete)
**Requirements**: NAV-01
**Success Criteria** (what must be TRUE):

  1. A sidebar "my strategies" entry (MY WORKSPACE) opens a ranking covering **every key the allocator uploaded AND the strategies derived from them — including `private` and `draft` rows**, which are exactly what every existing ranking surface filters out. Proof case: the founder's account (8 active keys — bybit, okx, deribit ×3, mt5 ×3), none of which appears on any ranking today, all present here.
  2. The ranking is at **PARITY with the external/discovery ranking** — same metric columns, same sort affordances, same `#n` + percentile presentation per DESIGN.md — so the allocator judges their own uploads on the same axes they judge third-party strategies.
  3. **Structural reuse, asserted not merely observed:** the surface is the EXISTING ranking component/query, and the visibility predicate is the only genuine difference (own-including-unpublished via OWN-02's `withPublishedOrOwner`, vs published-only). No second ranking implementation exists to drift.
  4. Metrics for `private`/`draft` rows come from the same analytics the factsheet renders — never a placeholder or a reduced column set for unpublished rows; a row whose analytics have not computed yet shows an honest pending state, never zeros (no-invented-data).
  5. Clicking any row — including a `private`/`draft` one — opens its factsheet (via OWN-02), never `notFound()`.

**Plans**: 5 plans in 4 waves (planned 2026-08-05)

Plans:
**Wave 1**

- [x] 149-01-PLAN.md — StrategyTable `visibility` parameterization (Pitfall 1) + grid-toggle suppression + published-gated Simulate button (Wave 1)
- [x] 149-02-PLAN.md — getMyStrategies (own-only predicate, documented deviation) + strategy-less-keys anti-join (both key links) + Badge `private` fix (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 149-03-PLAN.md — status marker + honest pending chip + Delta-5 placeholder rows (Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 149-04-PLAN.md — /my-strategies page + comparison-set line + sidebar entry + role wiring (Wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 149-05-PLAN.md — phase-149 structural CI gate + Rule-9 mutation campaign + phase gate (Wave 4)

**UI hint**: yes
**Notes (binding traps)**:

- ⚠️ **Reuse cuts both ways.** Parameterize the visibility predicate; do NOT globally widen the shared query — the published-only predicate on discovery/public surfaces must be provably unchanged, or this phase ships the leak OWN-02's cache work exists to prevent. An unpublished row's metrics must never reach any anon or non-owner surface through the shared path.
- ⚠️ **Percentile population is a deliberate plan-time decision** (own rows ranked against the published universe vs among themselves) — decide it explicitly at plan/discuss time, do not let it fall out of whichever query is handy. Whatever is chosen must be honest about its comparison set.
- ⛔ Do not start before Phase 148 lands — the dependency is structural, not stylistic.

### Phase 150: OWN-03 — The wizard asks whose capital this is

**Goal**: When an allocator adds a key the product asks the question it never asked — own capital, or a trading team's key being verified — stores the answer as a persistent ownership mark, and lets ONLY marked own-capital strategies be added to the allocation from the Holdings tab
**Depends on**: Phase 148 (soft — keeps the OWN cluster contiguous, and the created position's strategy is then visible via factsheet/ranking so the write can be verified end-to-end; no hard code dependency)
**Requirements**: OWN-03, OWN-05
**Success Criteria** (what must be TRUE):

  1. At allocator key-add, the wizard ASKS which of two things this is — (a) a key with my own capital in it, or (b) a trading team's key I am verifying (the DEFAULT) — and stores the answer as a persistent ownership mark. The wizard writes NO position and asks NO amount (2026-08-05 refinement: mark in wizard, allocate in Holdings — supersedes the 2026-08-04 finalize-form reading). Copy is CRISP and the question lives in the categorization step.
  1b. The categorization/profile step is culled to essentials: AUM, strategy-size, strategy-type and similar questions are removed or collapsed behind an optional disclosure (founder 2026-08-05, "just essentials, especially for the allocator") — with every culled answer's downstream consumer checked (hide per no-invented-data, never fabricate).
  1c. An allocator can rename their OWN private/draft strategies to a proper name (OWN-05); owner-authz only; the public codename/disclosure redaction contract stays byte-untouched; all owner surfaces (my-strategies, Browse own rows, owner factsheet, holdings alias) render the new name coherently.

  2. In the HOLDINGS tab, a strategy marked own-capital can be ADDED to the allocation (explicit action + amount — the money-path review applies to THIS write). Choosing (b) — or any path that never reaches the question — changes nothing: `status='private'`, portfolio untouched, behaviour-compatible with today.
  2b. ⛔ HARD INVARIANT: a team-review-marked strategy can NEVER become a position — no code path creates an allocation from it (an allocator cannot put money into a trading team's account). Asserted structurally, like the visibility gates. The retro path (marking pre-existing own strategies such as Black Swan so they become allocatable) is part of this phase.

  3. Auto-add remains refused: no code path adds to the portfolio without the explicit (a) answer — the founder has refused auto-add TWICE.
  4. Adding the same strategy twice has a defined, reviewed behaviour — never a silent duplicate position or a double-count.

**Plans**: 8 plans in 4 waves

Plans:
**Wave 1**

- [x] 150-01-PLAN.md — DB: capital_ownership column + D-03 BEFORE INSERT trigger + atomic flip RPC + pgTAP; [BLOCKING] MCP apply to TEST (wave 1)
- [x] 150-02-PLAN.md — Shared contracts: isAllocatable predicate, type widening, OwnershipTag, CapitalOwnershipRadioGroup, dollar-validator lift (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 150-03-PLAN.md — Wizard: capital question first + cull-to-disclosure + asset-class hoist + post-finalize mark persistence (wave 2)
- [x] 150-04-PLAN.md — Routes: PATCH ownership (retro mark + 409/confirm/RPC flip) + PATCH name (OWN-05 rename) + audit actions (wave 2)
- [x] 150-05-PLAN.md — Holdings data: allocation route (upsert, allocated_amount ONLY), getOwnCapitalStrategies, adapter + owner-name carve-out (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 150-06-PLAN.md — my-strategies + factsheet UI: tag, row actions, Mark/Rename dialogs, owner-lane thread (wave 3)
- [x] 150-07-PLAN.md — Holdings UI: rows, AllocateDialog, three-arm empty state, unsigned-weight fix + contract pin (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 150-08-PLAN.md — Structural D-03 gate with mutation ledger + full regression + VALIDATION close (wave 4)

**UI hint**: yes
**Notes (binding traps)**:

- ⚠️ **OWN-03 is the first WRITING requirement in the OWN set** → it needs its own money-path review (weights, allocation basis, what happens when the same strategy is added twice). That review is WHY this is its own phase rather than a rider on 148 — do not fold it back.
- ⛔ The deliverable is a WIZARD QUESTION, not an auto-add; (b) must stay the default and stay a no-op.
- ⚠️ Coordinate with AUM-04 (Phase 151): a position created from an owned strategy must not re-introduce cross-role gate contamination or double-count against live holdings.
- ⚠️ **DISCUSS-PHASE DECISION (founder-hit 2026-08-05): the retro path.** SC1's question fires at wizard FINALIZE — but the founder's already-contributed strategies (Black Swan, Alpha Centauri, Arctic Fox) finalized BEFORE the question existed, so they can NEVER be allocated without re-onboarding. Decide the allocate-existing-own-strategy affordance (e.g. an "Allocate…" action on the /my-strategies row or the owner factsheet) — same money-path review, same no-auto-add rule. Related observed confusion: the header "+ Allocation" button on non-Scenario tabs opens the connect-key wizard (Phase 116 design) with no path to an existing strategy, and the Holdings STRATEGIES panel says "No strategies onboarded yet" while contributed strategies exist — copy/affordance both belong to this phase's surface once positions become creatable.

### Phase 151: AUM — A book you can reach and a size you can set

**Goal**: An allocator can always reach their live book, size a hypothetical one directly, and no venue crashes the holdings sync
**Depends on**: Phase 147 (AUM's zeros-on-screen symptom is entangled with SCEN-01's and would otherwise appear unfixed)
**Requirements**: AUM-01, AUM-02, AUM-03, AUM-04, AUM-05
**Success Criteria** (what must be TRUE):

  1. The allocator sets AUM directly in the composer and weights/dollar sizes follow — a blank-slate scenario holding only added strategies can size and commit ("allocate $500k to this strategy" becomes expressible) (AUM-01).
  2. An MT5 account's equity contributes a holdings row, and no key ever again stamps a raw Python `AttributeError` into the user-visible `sync_error` column — fixed at the non-ccxt venue CLASS: the same test shape passes for sFOX (`get_balances`, not `fetch_balance`) BEFORE its go-live flip (AUM-02, AUM-05).
  3. The founder's own book (~$460k, 8 active keys of which 3 deribit + 3 mt5 carry zero per-key dailies) reaches "From my book" — the gate is no longer all-or-nothing over every eligible key, and MANAGER-side MT5 keys no longer pin the ALLOCATOR's book gate false permanently (cross-role contamination) (AUM-04).
  4. The AUM-zero refusal copy names only affordances that actually exist — never the deliberately-never-built live-holding toggle (AUM-03).

**Plans**: 7 plans

Plans:

- [x] 151-01-PLAN.md — Extract MT5 terminal-concurrency machinery into services/mt5_concurrency.py (leaf; the ONE lock registry)
- [x] 151-02-PLAN.md — Split the book gate SSR-side: deriveStrategyLinkedKeyIds + 3 additive payload fields on both branches
- [x] 151-03-PLAN.md — Non-ccxt venue dispatch + MT5 account-equity branch (kill switch, shared lock, honest skips, transient human copy)
- [x] 151-04-PLAN.md — sFOX branch + parametrized class-closure proof (mt5+sfox+unknown) + non-collapse oracle
- [x] 151-05-PLAN.md — Composer gate repoint: partial book reaches "From my book"; contributing-only rows + partial-book note
- [x] 151-06-PLAN.md — manualAumUsd draft field + Portfolio AUM input + AUM-03 refusal copy
- [x] 151-07-PLAN.md — Per-strategy dollar input via handleWeightChange + manual_aum_usd commit persistence (client_manual_aum sentinel)

**UI hint**: yes
**Notes (binding traps)**:

- ⚠️ **Fix the non-ccxt venue CLASS, not the MT5 instance** — sFOX carries the identical latent crash, invisible only because its flag is off with zero keys; it must be closed BEFORE the sFOX go-live flip, not discovered by it.
- ⚠️ MT5 holdings fetch is a SECOND job kind contending for the ONE shared Windows terminal — reuse `_mt5_terminal_lock_for`, the login bracket, the bounded-restart helper and the read-timeout discipline (MT5CONC class). Per-symbol MT5 holdings is a SEPARATE decision guarded by a deliberate client-facade pin — do not quietly widen it.
- ⚠️ AUM-01 does NOT cause or fix the 0.00 metrics (that was SCEN-01, closed in 147) — do not let it be planned as that fix.

### Phase 152: SCEN — Composer legibility

**Goal**: The composer is legible: rows say whose they are, what the numbers mean, open detail on click, and browse never presents an unresolvable duplicate
**Depends on**: Phase 147 (rows must carry real series to be worth inspecting), Phase 148 (SCEN-03's factsheet link needs OWN-02 or it is a dead end)
**Requirements**: SCEN-02, SCEN-03, SCEN-04, SCEN-05
**Success Criteria** (what must be TRUE):

  1. In the composition list, a strategy the allocator uploaded themselves is visually distinguishable from a third-party published one — the ownership bit (already computed server-side and discarded at `src/app/api/strategies/browse/route.ts` — `isOwnRow` :264) is wired through additively; this is a persisted-schema decision (`AddedStrategy` is zod-validated at `SCENARIO_SCHEMA_VERSION = 4`), not a client derivation (SCEN-02).
  2. Clicking a scenario row opens richer detail, including a working link to the strategy's factsheet (SCEN-03).
  3. The numbers on a row are labelled — weight, mode, leverage, notional — and a non-derivable notional reads as "not applicable", not as a broken em-dash (SCEN-04).
  4. The strategy browser never shows two indistinguishable rows for the same strategy — the two identical "Alpha Centauri" entries become distinguishable or resolved (SCEN-05; prevention of future duplicates is WIZCONT-02 in Phase 154 — this is the presentation half).

**Plans**: 6 plans in 4 waves (planned 2026-08-07)

Plans:

- [x] 152-01-PLAN.md — Browse-route wire: isOwn on every row + own-only created_at/status through a two-arm H-0300 fence
- [x] 152-02-PLAN.md — Draft-schema wire: isOwn on the NESTED addedStrategySchema, populated-fixture strip guard
- [x] 152-03-PLAN.md — SCEN-04: header label li (WEIGHT USD MODE LEV NOTIONAL) + cause-accurate honest notional
- [x] 152-04-PLAN.md — Drawer: isOwn through handleAdd, own-vs-own dedup line (Created date · Status), shared YoursChip + browse parity
- [x] 152-05-PLAN.md — Composer: isOwn at both twin seams (Bridge deliberately absent) + Yours chip on the added row
- [x] 152-06-PLAN.md — SCEN-03: inline detail expansion + factsheet link + axe expanded-panel coverage + phase-final gates

**UI hint**: yes

### Phase 153: WIZFORM — Form errors belong on the form (+ MT5 declarable)

**Goal**: The wizard stops costing submits — errors land inline on the offending field, transient infrastructure never becomes a user decision, copy never advises the impossible, and an MT5 strategy can declare its venue
**Depends on**: Nothing hard (sequenced after the money-path phases; before 155 so the wizard surface is stable for verification)
**Requirements**: WIZFORM-01, WIZFORM-02, WIZFORM-03, WIZFORM-04, WIZFORM-05, MT5-14
**Success Criteria** (what must be TRUE):

  1. A field the user can get wrong (e.g. a 2-character description) is refused inline at the field, red-highlighted, BEFORE submit — never a terminal full-page envelope after it, and never an error that sends users to corrupt unrelated fields (WIZFORM-01).
  2. No wizard failure renders `code: UNKNOWN` when the server DID classify it — every `finalize-wizard` `validatePayload` 400 arm carries a `code`, and the closing sweep is driven from the emitting sites, not a hand-listed set (the 142.2 plan-07 sweep missed this validator) (WIZFORM-02). SECOND LIVE INSTANCE (founder-hit 2026-08-05, correlation `wizard:0320530a-…`): the client rosters `KNOWN_CREATE_WITH_KEY_CODES` (`ConnectKeyStep.tsx`) and `KNOWN_ADD_KEY_CODES` (`MultiKeyConnectStep.tsx`) are missing `SERVICE_UNREACHABLE`, `KEY_MISSING_READ_SCOPE`, `KEY_PERMISSION_DENIED` — the server's honest verdict is downgraded to `UNKNOWN` client-side, invisible to Sentry. The derived-roster + coverage-assertion fix MUST cover these rosters, not only `validatePayload`. (A 3-member stopgap may land earlier via hotfix — the CLASS fix still belongs here; see REQUIREMENTS WIZFORM-02.)
  3. A transient seam failure on submit is absorbed: FIRST answer whether the per-submit permissions re-validation is needed at all (a recent successful validation + a live synced series is already evidence), and only then add bounded retry — respecting the seam-budget invariant and the `breaker:railway` (never retrying into an open breaker) — surfacing an error only after genuine exhaustion, with copy naming an action the user can take (WIZFORM-04).
  5. The MT5 validate-key deadline inversion is reconciled — an MT5 validation's honest verdict always arrives inside the budget the client grants: today `SEAM_ROUTE_BUDGETS["validate-key"].timeoutMs` (30s — `src/lib/resilient-fetch.ts`, key at :537 and `timeoutMs: 30_000` at :538) loses to `_MT5_PROBE_TIMEOUT_S` (35s) applied SEPARATELY to three stages (`analytics-service/routers/exchange.py` — `_MT5_PROBE_TIMEOUT_S` defined :62, applied :328/:380/:456 inside `_validate_mt5_key` :222), so a slow MT5 login can never report in time. Venue-aware budget or bounded Python probe — either way under this phase's existing seam-budget trap warning (WIZFORM-05, added 2026-08-05).
  4. No venue-shaped error copy renders for venues it cannot apply to — an MT5 user never sees "switch to a different exchange" (WIZFORM-03).
  5. MT5 is declarable in the supported-exchanges metadata step AND preselected from the key the founder already connected — do not ship the widening without the preselect (MT5-14).

**Plans**: TBD
**UI hint**: yes
**Notes (binding traps)**:

- ⛔ **MT5-14: the `closed-sets.mt5-flag` no-widening pin WILL go red — that is the guard working, not a regression to route around.** The pin must be re-cut deliberately, with its reasoning updated, in the same commit. This is NOT the MT5-11 drift class; the exclusion was a deliberate decision that is now outgrown.
- ⚠️ WIZFORM-04: a naive retry loop multiplies the budget `src/lib/seam-budgets.invariant.test.ts` recomputes, and retrying into an open breaker is how one slow venue takes down every other user's submits. The fix starts with "is the call needed", not "add a loop".
- ⚠️ The allocation-amount form Phase 150 (OWN-03) adds is IN SCOPE for the inline-validation criterion — a freshly-shipped wizard step must not re-introduce the terminal-envelope class this phase deletes.

⛔ **PARENT CHECKBOX STAYS UNTICKED — retroactive SPAN verification FAILED 2026-08-13** (`153-VERIFICATION.md`, 5/6 requirements). All six children shipped and 153.6 verified `passed_with_concerns`, but the PARENT goal was not met: **WIZFORM-02 closed two instances, not the class.** The derived-roster coverage law roots on 3 Next route files (`NextResponse.json({code,error},{status})`) and on `analytics-service/services/**` (`error_code =` assignments); `analytics-service/routers/exchange.py:866` matches **neither** — wrong root AND wrong emission shape — so the whole mt5-gateway fault family renders `code: UNKNOWN`. Third live instance hit on PROD 2026-08-12. ⛔ Do NOT tick this phase by adding the two missing codes; the boundary decision and its scope are **TODOS.md FIX NOW #6**. ✅ WIZFORM-01/03/04/05 and MT5-14 all verified (WIZFORM-03 is closed *further* than `REQUIREMENTS.md:1366` admits — that row contradicts `:1368`).

> ⛔ **PHASE 153 IS SPLIT FOUR WAYS (founder-approved 2026-08-08).** The planner measured 15–16 plans across two runtimes against a 3–5 plan budget and returned `## PHASE SPLIT RECOMMENDED` rather than thin the tasks. **Nothing is dropped or deferred** — all 6 requirements and all 34 locked decisions are assigned. Cut lines follow **file ownership**, so every co-commit constraint (D-14, D-15, D-16, D-26, and the admit-a-code-in-the-commit-that-emits-it rule) stays *inside* one sub-phase. Execute 153.1 → 153.2 and 153.3 → 153.4; the Python chain (153.3) is file-disjoint from the TypeScript chain and may run in parallel. Shared artefacts (RESEARCH, PATTERNS, UI-SPEC, VALIDATION, both EVIDENCE files) live in the parent `153-` directory and are read by every sub-phase.

### Phase 153.1: WIZFORM-CODES — Honest codes + the venue-capability foundation (INSERTED)

**Goal**: No wizard failure renders `code: UNKNOWN` when the server did classify it, and the copy layer gains a per-venue capability record so venue-shaped remedies are filtered by a class rule rather than by stacked instance checks
**Depends on**: Nothing (foundation for 153.2 and 153.4)
**Requirements**: WIZFORM-02, WIZFORM-03
**Decisions**: D-08, D-09(a/b), D-10, D-17, D-21, D-22, D-23, D-34 (D-18/D-28 referenced as superseded)
**Owns**: `src/lib/closed-sets.ts`(+test), `src/lib/wizardErrors.ts`(+test, +invariant test), `finalize-wizard/route.ts` (validatePayload only), `SubmitStep.tsx` (roster only), `seam-constants.pin.test.ts` (Wave-0 A-25 assertion only)
**Plans**: 6 plans in 5 waves

Plans:

- [x] 153.1-01-PLAN.md — Wave-0 scanner + A-25 gates: hardened `deriveRoster`, per-route status predicate, interpolation-safe error body, four SELF-TESTs, derived A-25 assertion (all green at HEAD)
- [x] 153.1-02-PLAN.md — `VENUE_CAPABILITIES` + the three predicates (fail-toward-probing on null) + `MAGNITUDE_CAPS.MIN_DESCRIPTION_CHARS`, pinned
- [x] 153.1-03-PLAN.md — WIZFORM-03 class filter: `FixRequirement` + `fixRequires` + ONE filter in `formatKeyError`; the three venue bullets and the surface bullet tagged; three whole-table sweeps
- [x] 153.1-04-PLAN.md — Ten new `WizardErrorCode` members (seven field-level, `SEAM_DEADLINE_EXCEEDED`, and the two live UNKNOWN residuals); `EXPECTED_TABLE_SIZE` moved at BOTH sites
- [x] 153.1-05-PLAN.md — `finalize-wizard`: 14 emitters reordered code-first, 11 `validatePayload` arms coded, `MIN_DESCRIPTION_CHARS` re-pointed, roster admitted in the same commit
- [x] 153.1-06-PLAN.md — Third `ROUTES` entry, per-route site literals, alias-aware coverage law (`CIRCUIT_OPEN`), vacuity floor sized against the reordered total, SC-2 mutations RUN

**UI hint**: no

- ⚠️ **PLANNER CORRECTION (2026-08-09, verified at `0c4f01d8`): the D-34 reorder is FOURTEEN sites, not six.** The six below are the SINGLE-LINE `{ error, code }` occurrences; eight more put `error:` on its own line inside a multi-line literal — same defect, invisible to a single-line grep (`:605-608`, `:625-628`, `:637-640`, `:952-955`, `:1007-1010`, `:1087-1093`, `:1754-1758`, `:1778-1782`). A THIRD blindness class was also measured: `EMITTER_RE`'s `error:[^}]*\}` cannot cross a `${…}` interpolation, so four bodies stay invisible even after the reorder. And `deriveRoster` returns `[]` for `KNOWN_FINALIZE_CODES` today (`indexOf("([")` → `-1`). All three are closed by 153.1-01 as Wave-0 gates.
- ⛔ **D-34: reordering is not cosmetic.** Six PRE-EXISTING arms (`:573 :617 :767 :1293 :1310` written `{ error, code }`, plus `:1319` lowercase) are invisible to `EMITTER_RE`. They are out of scope only because it gates on `status: 400`; the moment the third `ROUTES` entry lands **and** the predicate widens, the coverage assertion goes blind on them. Size the vacuity floor against the **reordered total**, never against the nine.
- ⚠️ The A-25 **derived** assertion lands here as a Wave-0 gate (green at HEAD) so that 153.4's budget raise cannot pass a pin that cannot fail.

### Phase 153.2: WIZFORM-FIELD — The form refuses at the field; MT5 declarable *and* submittable (INSERTED) ✅ COMPLETE 2026-08-10

**Status**: ✅ **COMPLETE** — 5/5 plans; `gsd-verifier` **25/25 must-haves, no gaps** (`human_needed` only for 5 browser items); `gsd-code-reviewer` found **1 blocker + 6 warnings, all fixed**. ⭐ The blocker (CR-01) was a live security defect: the scope-broadening probe's gate branched on `api_keys.exchange`, a column the key's own owner could rewrite — so the beneficiary could switch an ASVS V4 control off for their own key. Closed by migration `20260810120000` (table-level `REVOKE UPDATE` + a `SECURITY INVOKER` backstop trigger), **verified on TEST**: the exploit succeeded pre-fix and returns `42501` post-fix, with the worker sync path, `service_role` writes, user `SELECT` and user `DELETE` all confirmed intact. Residual (client-supplied `exchange` at INSERT) is self-defeating rather than harmful and is logged in TODOS.md with its real remedy.

**Goal**: A field the user can get wrong is refused inline, at the field, before submit — and an MT5 strategy can both declare its venue and actually complete a submit
**Depends on**: Phase 153.1 (copy members, `VENUE_CAPABILITIES`, `MIN_DESCRIPTION_CHARS`)
**Requirements**: WIZFORM-01, WIZFORM-04, MT5-14
**Decisions**: D-06, D-07, D-11, D-12, D-13, D-14(a+b), D-15, D-16, D-20, D-22
**Owns**: `MetadataStep.tsx`(+test), `AllocateDialog.tsx`(+test), `SubmitStep.tsx` (routing), `finalize-wizard/route.ts` (probe gate + catch-all), `closed-sets.mt5-flag.test.ts`, the wizard chip set — ⚠️ **PLUS `WizardClient.tsx`, added at planning time**: routing a field-level code back to its field requires a step change, and `WizardClient` is the sole owner of `step`. No other 153.x plan touches it.
**Plans**: 5 plans in 4 waves. Wave 1 runs 153.2-01 and 153.2-03 in parallel (disjoint files); waves 2-4 are forced sequential because four plans contend on `MetadataStep.tsx`. **MT5-14 + WIZFORM-04 are ONE plan (153.2-04)** per D-14, with the chip-set widening and the pin re-cut in the SAME task.

Plans:

- [x] 153.2-01-PLAN.md — ⛔ FLAG-3 as ONE indivisible task: the description client mirror reads `MIN_DESCRIPTION_CHARS`, becomes the `handleSubmit` predicate, the `:491` `disabled` and both stale comments go, the `:334` focus ring is upgraded — then the hint / `.title` / live-clear message states (D-11, D-13, D-23)
- [x] 153.2-02-PLAN.md — the rest of the form: category / AUM / capacity refuse through `Field` with aria-derived borders (AUM+capacity import the SERVER's own `isValidDollar`), and submit-with-errors opens the collapsed `<details>` before focusing the first invalid control, with a visible summary line `LiveRegion` re-states (D-11, D-13)
- [x] 153.2-03-PLAN.md — D-12: `AllocateDialog`'s money field converts from the JS ternary to `aria-[invalid=true]:border-negative` and clears live; the two rows that can tell the mechanisms apart (D-12, D-13)
- [x] 153.2-04-PLAN.md — ⛔ MT5-14 + WIZFORM-04 in ONE ship: `WIZARD_EXCHANGE_CODES`/`WIZARD_EXCHANGES` (Option B) with the `closed-sets.mt5-flag` pin re-cut + POSITIVE assertion in the SAME task; the pinned-`<span>` detected-venue chip, its mono provenance eyebrow and a payload that cannot omit the venue; `venueSupportsScopeProbe` gating BOTH probe call sites (fail-toward-probing on `null`) and the catch-all split so a parse miss and a missing internal token stop reading as network blips (D-06, D-07, D-14a+b, D-15, D-16, D-20, D-22)
- [x] 153.2-05-PLAN.md — a field-level server rejection routes back to the field: `FIELD_BY_CODE` + a totality assertion with a vacuity floor in `SubmitStep`, the handoff through `WizardClient`, and `MetadataStep` revealing + focusing the named field with its values intact (D-13, D-17 boundary)

**UI hint**: yes

- ⛔ **FLAG-3 is ONE indivisible task.** Deleting `MetadataStep.tsx:491`'s `disabled` without widening the `.trim()`-only `handleSubmit` guard at `:222-233` lets a 2-character description POST — re-shipping the very defect this phase deletes.
- ⛔ **INHERITED FROM 153.1-03 — WIZFORM-03 does not close without you.** The `fixRequires` class filter is live and correct in `wizardErrors.ts`, but **no `buildEnvelope` call site passes `context.venue` or `context.surface`** (verified across all 14 sites, 2026-08-09), and venue-absence deliberately preserves incumbent copy. **An MT5 user still reads "switch to a different exchange" in production until a call site names its venue.** `SubmitStep.tsx:414` is yours; `ConnectKeyStep.tsx:609` and `MultiKeyConnectStep.tsx` are 153.4's. **No further change to `wizardErrors.ts` is needed** — just pass the context.
  - 💡 **Free with the same edit: `charCount`.** `formatKeyError` grows the sentence to `Add at least 10 characters — you have 2.` when `context.charCount` is present (`wizardErrors.ts:2379`), and **no production emitter supplies it**, so the count never renders. Absence is correct-by-design, not a bug (TRAP-3 — never name a count you did not receive), so this is an upgrade, not a fix. Pass `charCount: description.length` in the same `buildEnvelope` argument you are already adding `venue`/`surface` to. Confirmed live on a TEST dev server 2026-08-09 — see `153.1-HUMAN-UAT.md` item 1.
- ⚠️ **A true sentence is temporarily hidden**: `SERVICE_UNREACHABLE`'s `/strategies` bullet now renders **nowhere** until a call site names its surface.
- ⛔ **INHERITED FROM 153.1-06 — WIZFORM-02 does not close without you either.** 153.1 closed the *named root cause* (the `validatePayload` arms; `deriveEmittedCodes` moved 0 → **25 sites / 19 distinct**), but the requirement's criterion is broader than its root cause. A derived sweep found **five live rejections that still render "We could not classify this failure"** — HTTP **429, 503, 500, 500, 502** — fenced in `src/lib/wizardErrors.invariant.test.ts` as `KNOWN_CODELESS_FINALIZE_REJECTIONS = 5`, with a sixth reddening by name. **Code those five and drive the literal to 0**; that is what ticks WIZFORM-02. ⚠️ Do NOT raise the fence to make a test pass — the fence exists to make the debt visible, and raising it would launder an open requirement into a green suite.
- ⛔ **INHERITED — two `npm test` failures are YOURS to clear.** ⚠️ **`seam-citations` is SELF-CAUSED by 153.1, not pre-existing** (corrected 2026-08-09 by the 153.1 verifier). The earlier "verified unchanged since `aff52516`" claim here was a proof that could not fail: `aff52516` is a 153.1-05 **docs** commit dated after all the source edits, so that diff was empty by construction. `git log -S` attributes all nine to `712c01a9`/`aeea5455`/`3011c659`. It reds on **9 bare `file:line` citations in `src/lib/wizardErrors.ts`, 3 of them already stale** — you are editing that file anyway, so re-derive from HEAD rather than patching the integers (this milestone has burned two full sessions on citation drift). The sibling `seam-venue-vocabulary` failure (`mt5.py:242`) is **Phase 153.3's**, not yours — leave it. That is the UI-SPEC's "fail toward saying less" working as designed, but it is a real loss on the one surface where the bullet applies — restored the moment you pass `surface`.
- ⛔ **MT5-14 and WIZFORM-04 ship together.** Widening the chip set without the probe skip leaves MT5 a HARD BLOCKER — declarable but still unsubmittable.
- ⚠️ The `closed-sets.mt5-flag` pin re-cut and the widening are the SAME commit, and the re-cut ADDS the positive flag-ON assertion the pin lacks today.

### Phase 153.3: WIZFORM-GW — MT5 gateway honesty (Python; file-disjoint) (INSERTED)

**Goal**: An MT5 validation's honest verdict can physically arrive — the nested-timeout inversion is removed, the terminal is shared through the lease that already exists instead of raced, and a key we cannot classify is refused rather than stamped read-only
**Depends on**: Nothing (independent of the TypeScript chain; sequenced BEFORE 153.4 per D-24)
**Requirements**: WIZFORM-05 (server leg)
**Decisions**: D-02, D-03, D-24, D-25, D-27, D-29, D-30, D-31, D-32, D-33 (D-28 superseded)
**Owns**: `analytics-service/services/mt5_client.py`, `services/mt5_validation.py`, `services/mt5_concurrency.py`, `routers/exchange.py`, `tests/test_mt5_*.py`, `docs/runbooks/mt5-go-live.md` — ⚠️ **PLUS `services/ingestion/mt5.py` (+ `tests/test_ingestion_mt5.py`), added at planning time**: it is the SECOND of the two callers of `is_trade_capable` (`:221`), so D-31 cannot be a class-level fail-closed fix without it. Python-only; file-disjoint from 153.1/153.2/153.4.
**Plans**: 6 plans in 6 waves (strictly sequential — every plan contends on `mt5_client.py` and/or `routers/exchange.py`). Wave 6 = **D-35**, the `shutdown()` class closure, added after gating: an `ast` scan measured **three** `Mt5Client.close()` callers (`routers/exchange.py`, `services/exchange.py`'s `aclose_exchange` mt5 arm, and `services/ingestion/mt5.py`'s validate `finally`) reaching exactly **two** `shutdown()` sites (`mt5_client.py:384` `close`, `:436` `restart`). Fixed at the **sink** — the teardown leaves `close()` entirely — so all three callers are fixed with zero call-site edits.

Plans:

- [x] 153.3-01-PLAN.md — 🔒 D-31: `terminal_info()` guard; tri-state `classify_trade_capability`; both call sites refuse what they cannot classify (SECURITY, sequenced FIRST so it is not blocked behind the refactors)
- [x] 153.3-02-PLAN.md — D-24/D-25: bind `initialize()`'s missing `timeout=`; extend the ordering guard to EVERY timeout-carrying call with a source-derived completeness floor; per-instance chain (`MT5_REQUEST_TIMEOUT_S` byte-unchanged)
- [x] 153.3-03-PLAN.md — D-02/D-03/D-30: ONE end-to-end deadline replacing three 35 s stages; `Mt5Client.release()` takes `shutdown()` off the request path; the `finally` survives the deadline and stays outside it (Pitfall 6)
- [x] 153.3-04-PLAN.md — D-29: the validate path takes the terminal lease it is the one caller to skip, with a bounded acquisition wait distinct from the operation timeout (batch keeps queueing patiently; NO account cap)
- [x] 153.3-05-PLAN.md — D-32/D-27/D-33: `stage` + `duration_ms` on every MT5 call and on the lease wait; runbook single-replica invariant, terminal trade-permission step, provisional-budget note

**UI hint**: no

- 🔒 **D-31 is a SECURITY fix, not a refactor.** `is_trade_capable` infers investor mode from two signals that are BOTH false for a MASTER account under the terminal's default-ON "Disable automatic trading through the external Python API". `terminal_info()` is called nowhere and does not exist on `Mt5Client` — it must be ADDED. Fail **CLOSED**: refuse what we cannot classify.
- ⛔ **D-25: `MT5_REQUEST_TIMEOUT_S` stays byte-unchanged.** The validate path takes its own longer chain via the existing `request_timeout_s` ctor arg. Moving the module constant reopens the v1.11 WEDGE-01 wedge class.
- ⭐ **D-29: the lease already exists and this path is the one caller that skips it.** `_mt5_terminal_lock_for` (`mt5_concurrency.py:126-134`) is taken by `job_worker.py:364`/`:3572` and `allocator_positions.py:656`, and by `routers/exchange.py` **zero** times. Add a BOUNDED acquisition timeout distinct from the operation timeout — today `wait_for` sits inside the lock, so a queued caller waits unbounded. No account cap: accounts are unlimited, concurrency is one.

### Phase 153.4: WIZFORM-BUDGET — Venue-aware budget + the honest long wait (INSERTED)

**Goal**: The client grants an MT5 validation a budget its honest verdict fits inside, and a long wait is legible and abortable rather than a silent stall
**Depends on**: Phase 153.1 (`SEAM_DEADLINE_EXCEEDED`, `serialized`); best AFTER 153.3 (a budget cannot fix a structurally censored verdict — D-24)
**Requirements**: WIZFORM-05 (client leg)
**Decisions**: D-01, D-04, D-05, D-19, D-21, D-26, D-27 (D-18 superseded)
**Owns**: `resilient-fetch.ts`, `analytics-client.ts`, `seam-constants.pin.test.ts`, `seam-budgets.invariant.test.ts`, `seam-retry-registry.ts`(+tests), `ConnectKeyStep.tsx`, `MultiKeyConnectStep.tsx` — ⚠️ **PLUS two NEW files added at planning time**: `src/lib/wizard/validate-budget.ts` (a client-safe duplicate of the two budget figures, pinned equal to `SEAM_BUDGETS`) and `src/app/(dashboard)/strategies/new/wizard/ValidateWaitCard.tsx` (the ONE long-wait card both connect steps consume). `resilient-fetch.ts` imports `next/server` and `@upstash/redis`, so a `"use client"` step can never read the budget it must quote in copy — the duplicate + equality pin is the repo's own convention for exactly that.
**Plans**: 5 plans in 3 waves

Plans:

- [x] 153.4-01-PLAN.md — the `validate-key-serialized` 120 000 ms row + `BREAKER_LOCK_TOMBSTONE_S` 60→90 in ONE commit, plus every pin site in `seam-constants.pin.test.ts` and the retry registry (wave 1)
- [x] 153.4-02-PLAN.md — `budgetKeyFor(exchange)` selecting by the `serialized` capability, the three validate routes re-branched, and `seam-budgets.invariant.test.ts` re-derived (wave 2)
- [x] 153.4-03-PLAN.md — the client-safe budget module + its equality pin, and `ValidateWaitCard` with the budget-fraction escalation ladder (wave 2)
- [x] 153.4-04-PLAN.md — `ConnectKeyStep` waits honestly: abortable validate, `Stop waiting`, client deadline → `SEAM_DEADLINE_EXCEEDED` (wave 3)
- [x] 153.4-05-PLAN.md — `MultiKeyConnectStep` gets the same wait, strictly PER PANEL (wave 3, parallel with 04)

**UI hint**: yes

- ⛔ **D-26: the `120_000` budget row and `BREAKER_LOCK_TOMBSTONE_S` 60 → 90 are the SAME commit.** A-25 then holds exactly: `(30 + 90) × 1000 = 120 000`.
- ⚠️ **`budgetKeyFor` must diverge from its analog deliberately.** `process-key-client.ts:123-134` throws on `default:` via a `never` assignment; this one takes a caller-supplied string, so `default:` **returns `"validate-key"` and never throws**. Write the divergence down or a reviewer will "fix" it back. Never interpolate a wire value into a breaker key (T-140-01).
- ⚠️ 16 pin sites (RESEARCH Table C) must move together, including the prose restatements that stay green while their premise breaks.

### Phase 153.5: WIZFORM-ABANDON — Work that outlives its timeout

**Goal**: No `asyncio.to_thread` work can keep touching the MT5 terminal after its `wait_for` fired and its caller released the lease
**Depends on**: Phase 153.3 (complete) — this closes findings its `/code-review high` deliberately deferred
**Requirements**: ABANDON-05, ABANDON-06, ABANDON-07 (minted at planning 2026-08-11 from the three findings below: ABANDON-05 = finding #5, ABANDON-06 = findings #6a/#6b, ABANDON-07 = finding #7)
**Owns**: `analytics-service/services/mt5_client.py` (the sink), `services/mt5_concurrency.py`, `routers/exchange.py`, `services/ingestion/mt5.py`, `services/job_worker.py` + `services/allocator_positions.py` (raw-lock→lease conversions found at planning), `routers/process_key.py` (two uncovered `adapter.validate` sites), `analytics-service/tests/**`
**Plans**: 5 plans in 3 waves
**UI hint**: no

Plans:

- [x] 153.5-01-PLAN.md — epoch registry + Mt5SessionAbandoned + occupancy ContextVar + 6-method fence + lease bump + shared test reset (wave 1)
- [x] 153.5-02-PLAN.md — restart's TWO checks w/ three-invariant fenced cleanup + __init__ construction fence (#5, #6) + rationale re-cuts (wave 2)
- [x] 153.5-03-PLAN.md — ONE release point: convert the 3 raw-lock worker acquisitions to mt5_terminal_lease; re-point neuter patches; ast class pin (wave 2, parallel with 02)
- [x] 153.5-04-PLAN.md — D-40 classification arms at all five caller surfaces incl. process_key's uncovered sites (wave 3)
- [x] 153.5-05-PLAN.md — the two guards: ast abandon-roster + D-37 runtime barrier/spy; shutdown-roster docstring re-cut (wave 3, parallel with 04)

⭐ **ONE defect, three faces — fix it at the SINK, not three times.** Work handed to `to_thread` outlives its `wait_for`; the caller unwinds, releases the terminal lease, and the abandoned thread keeps driving the same process-global MT5 session.

📌 **Anchors below are SYMBOLS, not line numbers** — the original 153.3-era line citations had already
rotted before this phase was planned (#6 and #7 were off by ~30 and ~130 lines respectively; #5 still
held). Line hints are `as of 2026-08-11` only: **if a hint disagrees with its symbol, the symbol wins.**

| # | Site (symbol anchor; line hint as of 2026-08-11) | Symptom |
|---|---|---|
| 5 | `services/mt5_concurrency.py` › `_mt5_bounded_restart` — the `wait_for(to_thread(client.restart), timeout=_MT5_RESTART_TIMEOUT_S)` (~L118) | `_mt5_bounded_restart` abandons at its 10s bound; the one permitted `mt5.shutdown()` can fire **after** the lease is released, under the next holder |
| 6 | `routers/exchange.py` › `_validate_mt5_key_probe` › nested `_connect_and_probe`, **STAGE 1 — connect** (~L513) (+ `services/ingestion/mt5.py` › `Mt5Adapter.validate`, the `wait_for(to_thread(_build_client))` inside the lease, ~L207) | a connect-stage timeout orphans an `Mt5Client` the thread then constructs — `client` was never assigned, so the Pitfall-6 `finally` releases nothing and the rpyc session leaks |
| 7 | `routers/exchange.py` › `_validate_mt5_key_probe` — **THE ONE END-TO-END DEADLINE (D-03)**, `wait_for(_connect_and_probe(), timeout=_MT5_VALIDATE_DEADLINE_S)` (~L817) | the end-to-end deadline fires; the abandoned probe keeps issuing rpyc calls, so D-29's serialization does not hold on the timeout path |

- ⛔ **Patching three call sites is the instance-not-class mistake this milestone has paid for sixteen times.** Candidate designs (a real decision, not a fixer's improvisation): a cancellation-aware wrapper; a generation/epoch counter the terminal checks before each call; or refusing to release the lease until the worker thread confirms it stopped.
- ⚠️ **The AST lease-roster CANNOT catch this.** Its enclosure proof is *lexical* — it reads the `shutdown` as inside the `async with` and passes while the runtime escapes. The fix needs a **runtime** assertion (observe the abandoned thread touching the session after release), never a second static pin. Guard #16 of Phase 153 lives here.
- 📌 Deferred to **Phase 155**, not here (both need the live latency data D-32 made collectable — do NOT guess): the 60s per-stage ceiling wrapping six round-trips of 45 000ms/55s each, and the 20s interactive lease wait being smaller than the worker's 40s read + 10s restart hold.

### Phase 153.6: PARITY — the fixes that only landed on one path (INSERTED)

**Goal**: Every fix the 153 span made on one path exists on its twin, and no broad `except` re-absorbs a refusal the fence was built to surface
**Depends on**: Phase 153.3 (the router fixes whose twins are missing), Phase 153.5 (the fence whose refusals are being swallowed), Phase 153.4 (the budget figure being corrected)
**Requirements**: PARITY-01, PARITY-02, PARITY-03, PARITY-04, PARITY-05 (minted at planning 2026-08-11; defined + traced in `.planning/REQUIREMENTS.md` — the W-153.5-1 debt is NOT repeated)
**Owns**: `analytics-service/services/ingestion/mt5.py`, `analytics-service/routers/exchange.py`, `analytics-service/services/mt5_client.py`, `src/lib/wizard/validate-budget.ts`, `src/lib/seam-budgets.invariant.test.ts`, `src/app/api/strategies/finalize-wizard/route.ts`, `supabase/migrations/**`, `analytics-service/tests/**`
**UI hint**: no
**Plans**: 6 plans

⭐ **Raised by `/code-review xhigh` over the whole 153→153.5 span (2026-08-11, 40 agents, 29 verified findings → 13 distinct defects).** Nine come here; two were fixed unplanned; two are deliberately out (see the bottom).

⛔ **THE SHAPE OF THIS PHASE IS "the fix landed once, not twice."** Three of the four root causes are the same failure: a correct fix applied to one path while its duplicate went untouched, with no guard asserting the two agree. That is the instance-not-class mistake — found *inside the span whose own charter said "fix it at the SINK, not three times."* Do not close these as N point patches; the question each cluster must answer is **what makes the two paths unable to diverge again**.

**A — Adapter parity (3 findings, ONE cause).** `services/ingestion/mt5.py` never received Phase 153.3's `routers/exchange.py` fixes:

| # | Site | Missing twin |
|---|---|---|
| A1 | `ingestion/mt5.py` › `_probe` | the terminal short-circuit that stops `order_check` running when the verdict is already `undetermined` — without it `_WRONG_SERVER_TOKENS` (which carry "terminal") turn an operator-side refusal into a 400 accusing the user their BROKER SERVER is wrong. **This is the exact documented incident the router-side fix was written to prevent.** |
| A2 | `ingestion/mt5.py` › `_read_terminal` | the broad `except Exception` around netref materialization — without it a transport failure escapes as a raw, unscrubbed rpyc exception. ⚠️ `mt5linux` f-string-interpolates the password into remotely-eval'd source, so exception TEXT is a credential-disclosure surface (T-134-01 / T-153.3-23). Only the exception CLASS is safe. |
| A3 | `ingestion/mt5.py` (D-31 arm) | raises a bare `RuntimeError` documented PERMANENT, which escapes `Mt5Adapter.validate` into `job_worker.classify_exception`'s `("unknown", str(exc))` fall-through — **so the worker RETRIES a fault that can never clear**, re-running the whole serialized probe against the ONE shared terminal each time, queueing ahead of every other user's validate, and finally showing the user raw internal copy naming investor/master passwords. |

**B — Absorption: broad `except` re-swallowing the fence (2 findings + 1 telemetry split).** D-42 made absorption structurally impossible *for the classify arms*; pre-existing catch-alls upstream reintroduced it.

- B1 `routers/exchange.py` › `_read_terminal`'s `except Exception` swallows `Mt5SessionAbandoned` → an operator triaging in Railway reads a gateway materialization fault **that never happened**, and the probe continues on a "terminal unreadable" premise that is false.
- B2 `routers/exchange.py` connect stage: the construction fence's `Mt5SessionAbandoned("connect")` is caught by the broad `except Exception as connect_err` before the dedicated D-40 arm, returning a **503 that counts toward the mt5-gateway breaker** — our own abandoned thread driving the breaker toward opening against a healthy gateway.
- B3 `mt5_client.py` › `restart()` check 2 raises from INSIDE `_timed`, which emits an `mt5.stage restart ok=False` event for a restart that was deliberately REFUSED. (Wording corrected per 153.6 D-16: the reconnect round-trip DID happen by the time check 2 fires, so `duration_ms` is real elapsed time — the defect is that a refusal enters the D-32 recovery-latency population Phase 155 reads, under a stage name real round-trips also use; that pollution is the exact thing check 1 was deliberately placed outside `_timed` to avoid, 153.5 RESEARCH §Q-4.) The two checks disagree about the telemetry contract.

**C — The budget correction, and the oracle that cannot see it (1 finding, 2 halves).** `connectAbortDeadlineMsFor` was sized against the branch table's **closed**-breaker column (~158 500 ms) when the governing figure is the **failing** column (175 500 ms serialized / 85 500 ms default) — the failing state being exactly the state a stalling seam is in when a client deadline fires. So CR-01's "nothing was saved" lie is reachable again ~10.5 s before the route finishes writing the key. ⛔ **Fixing the number alone is half the job: `seam-budgets.invariant.test.ts`'s oracle pins the wrong column and so is structurally unable to red on this.** A guard that cannot fail when the behaviour it names changes is the defect class this span shipped repeatedly.

**D — The venue lock is bypassable (1 finding, SECURITY, live on PROD).** Phase 153.2's CR-01 remedy `REVOKE UPDATE ON api_keys` does not hold: `authenticated` retains table-level **INSERT and DELETE**, and the browser already holds the server-minted ciphertext (`/api/keys/validate-and-encrypt` returns it; `ApiKeyManager.tsx` performs the INSERT), so an owner can DELETE and re-INSERT the same row under a different `exchange`. A `BEFORE UPDATE OF exchange` trigger never fires on that path — **neither the primary gate nor the backstop sees it** — and that same client-writable column is the sole authority for skipping `finalize-wizard`'s ASVS V4 scope-broadening probe. The migration header asserts the opposite ("the mislabelled row can never be corrected back"), which is the premise its own "self-defeating forgery" residual argument rests on; `supabase/tests/test_api_keys_exchange_not_user_writable.sql` proves DELETE survives but never tests the round trip.
⚠️ **Calibrate honestly: this is a SELF-targeted control bypass, not a tenant leak** — an owner mislabelling their own key to dodge a probe on their own key. What is lost is the assurance that a key read-only at Connect was not broadened to trade. Serious for a product selling verified performance; not a 3am page.
⚠️ **The migration is already on `main`, and `supabase/migrations/**` auto-applies to PROD on merge — so the hole is live.**
⛔ **This one needs a real design decision, not a patch** (revoke DELETE too? move the INSERT server-side? stop trusting a client-writable column as the probe gate? a trigger comparing against a server-held record?). The options differ materially in blast radius. Decide it in discuss.

**E — Retry affordance (1 finding).** A probe parse miss was moved off `KEY_NETWORK_TIMEOUT` onto `KEY_SCOPE_CHECK_UNAVAILABLE`, removing the Retry control for a condition that is **not** always permanent — a 2xx body the schema cannot read is also what a rolling analytics deploy produces. Belongs here rather than in an ad-hoc fix because touching a wizard error code ripples into 153.1's pinned code tables (`EXPECTED_TABLE_SIZE` and friends), which must be **re-cut, never deleted**.

📌 **Explicitly OUT of this phase:**

- **MT5 as a composite member** — the 153.4 CR-03 fix made an MT5 composite panel reachable for the first time, and `run_stitch_composite_job` has no `mt5` arm, so it `_stamp_failed`s the whole job as permanent (`venue 'mt5' is not a supported exchange`). That is a **product decision** (teach the stitch worker MT5, or block MT5 in the composite wizard), not a bug fix. Natural neighbour: Phase 155.
- **The epoch never re-binds** (`mt5_client.py` `_assert_live` binds on first touch only), so one `Mt5Client` is usable under exactly one lease for its life. No production path does this today — all five lease blocks were ast-verified — and Phase 153.5 already pinned the constraint with a named future fix (rebind on lease entry). Latent, documented, not scheduled.
- Two trivial findings (compare-route skeleton padding + its blind test oracle; the `as unknown as` composite-embed cast in `finalize-wizard`) were fixed unplanned in the same session.

Plans:

- [x] 153.6-01-PLAN.md — Cluster A + B1: extract `services/mt5_probe.py`, rewire both paths, A3 permanent classification (wave 1)
- [x] 153.6-02-PLAN.md — Cluster C: failing-column deadline on BOTH arms + the state-quantified economic oracle (wave 1)
- [x] 153.6-03-PLAN.md — Cluster D (DB): `attested_venue` migration, INVOKER trigger, count-pinned backfill, RPC re-bases, SQL round-trip test (wave 1)
- [x] 153.6-04-PLAN.md — Cluster D (route): the probe gate reads the attestation, never `exchange`; class sweeps re-pointed (wave 1)
- [x] 153.6-05-PLAN.md — Cluster B remainder (B2 connect-stage arm, B3 `_timed` suppression) + the ast parity roster (wave 2)
- [x] 153.6-06-PLAN.md — Cluster E: `KEY_SCOPE_CHECK_UNREADABLE` recoverable code + pin re-cuts 74→75, 32 UNMOVED (wave 2)

### Phase 153.7: WIZFORM-02-CLASS — every code that can reach a user is covered (INSERTED)

**Goal**: WIZFORM-02's CLASS closes — the coverage law's population is derived from every code that can reach a user-facing surface, so a server-classified failure can never again render `code: UNKNOWN`; and a newly-minted `service_error(...)` code with no disposition reds CI by name instead of arriving on a user's screen
**Depends on**: Phase 153.1 (the pinned code tables being re-cut), Phase 153.6 (the `VENUE_WIRE_CODE_TO_VERDICT` / `VENUE_WIRE_CODES_WITHOUT_VERDICT` halves this widens)
**Requirements**: WIZFORM-02 (the ONE requirement the 153 span failed — see `153-VERIFICATION.md`, status `failed`, 5/6)
**Owns**: `src/lib/seam-venue-vocabulary.invariant.test.ts`, `src/lib/wizardErrors.invariant.test.ts`, `src/lib/wizardErrors.ts`, `src/app/api/strategies/create-with-key/route.ts`, `src/app/api/strategies/finalize-wizard/route.ts`
**UI hint**: no — copy members only, no new surface
**Plans**: 3 plans in 3 waves (strictly sequential: 02 greens 01's designed red; 03 contends with 02 on `wizardErrors.ts` / `wizardErrors.test.ts`)

⛔ **Raised by the retroactive Phase 153 SPAN verification (2026-08-13, `failed`, 5/6).** THIRD live instance, hit by the founder on PROD 2026-08-12 while dogfooding MT5. The server classified the failure completely and the wizard rendered *"We could not classify this failure, so we cannot tell you what happened or whether your last action took effect."*

⭐ **BOUNDARY DECISION (2026-08-13, autonomous — reversible).** The coverage law's boundary becomes **"every code that can reach a user-facing surface"**, not "codes emitted in a particular directory in a particular syntactic shape". The current boundary is an artifact of how the scanners were written, not a product rule: no one decided a 500 from `routers/` deserves less honesty than a 400 from a Next route, and the user cannot tell the difference. Full rationale + scope: **TODOS.md FIX NOW #6**.

⛔ **THE SHAPE OF THIS PHASE IS "the guard's REACH was wrong, not its mechanism."** The derived-roster remedy was genuinely built and genuinely works (falsified: mutating an emitted code literal reds two assertions by name). It misses `routers/exchange.py` for **two structural reasons, either sufficient alone** — wrong root (`routers/`, not `services/`) AND wrong shape (a **positional** arg to `service_error(...)`, not an `error_code =` assignment). Fixing either alone leaves the file invisible.

⛔ **The fix is NOT "add two rows."** Landing `MT5_GATEWAY_UNCONFIGURED` and `MT5_GATEWAY_UNREACHABLE` as verdict rows *without* widening the scanner and adding the both-halves assertion is exactly the fourth instance of this defect.

⭐ **The actual defect is an ASYMMETRY, above any individual missing code.** Both codes are absent from **both halves** of the coverage law — no verdict row *and* no recorded no-verdict — so their absence could never have been loud. The phase does not close until a code missing from both halves is a CI failure.

⚠️ **Do NOT re-open WIZFORM-05 as part of this.** The 45,169/45,159/45,177 ms figures from the same incident are `_MT5_VALIDATE_INITIALIZE_TIMEOUT_MS = 45000` — the innermost, deliberately-first-firing layer. The verdict arrived at 45 s against a 120 s budget; the 30 s inversion is genuinely gone. What failed *after* arrival is WIZFORM-02. Lengthening the budget fixes nothing.

📌 **On completion, Phase 153's parent checkbox may finally tick** — it is unticked today because the span did not meet its own goal, not because a child is outstanding.

**Plans**:

- [x] 153.7-01-PLAN.md — Mechanism: parameterised root + call-shape matcher (AST cross-checked) + pin re-cuts + reach/both-shapes assertions + tmpdir falsifier — ENDS RED BY DESIGN naming the 20 undisposed codes (wave 1) — ✅ 2026-08-14, `153.7-01-SUMMARY.md`. Population 17 → **37**; the file ends with **exactly one** failing test naming exactly the 20 predicted codes, and the AST cross-check earned its keep by catching a real matcher bug (a `class` definition head read as a call). ⛔ **Do NOT "fix" the red** — greening it is Plan 02's whole job.
- [x] 153.7-02-PLAN.md — The 20 dispositions: 8 verdict rows (replay-tested through classifyKeyValidationError) + 12 individually-measured WITHOUT_VERDICT rows — greens 01's red (wave 2) — ✅ 2026-08-14, `153.7-02-SUMMARY.md`. ⭐ **01's designed red is GREEN**: the disposition assertion passes over all 37 codes, and the 8×UNKNOWN/500 replay red was recorded first. One member MINTED (`SEAM_INTERNAL_FAULT`, `EXPECTED_TABLE_SIZE` 76 → 77 in lockstep) because `SEAM_MISCONFIGURED`'s "we stopped before sending the request" is measurably FALSE at `INTERNAL`'s emitter and at one of `MT5_GATEWAY_UNCONFIGURED`'s four. Neuter-proof (FL-1) performed and recorded: deleting the `MT5_GATEWAY_UNREACHABLE` row reds BOTH the disposition assertion and its replay test, by name.
- [x] 153.7-03-PLAN.md — Three coded finalize rejections (ledger 3→0, sites 29→32, total pinned 32) + twin regression on BOTH key routes + prose re-cuts + TODOS.md deferral (wave 3) — ✅ 2026-08-14, `153.7-03-SUMMARY.md`. ⭐ **The ledger is EMPTY and its assertion has collapsed into "every rejection carries a code"** — the constant is KEPT, because at 0 it states the property outright. `EXPECTED_FINALIZE_REJECTION_SITES` was **never edited** and the derived count agreed at every run: 32 − 32 = 0. Three copy members, one per ARM rather than per subject, because each may claim a different amount about server state — `DRAFT_LOOKUP_FAILED` (a SELECT that errored, so "nothing was changed" is observable; the token is REUSED from `keys/sync`, not a synonym), `DRAFT_FINALIZE_FAILED` (the generic tail also catches a transport failure that can lose the answer to a write that landed, so it may NOT say nothing was saved), `SEAM_RESPONSE_UNREADABLE` (upstream answered 2xx — the submission was accepted and only the result is unreadable, so it may claim NEITHER outcome, and it is non-recoverable because a retry there is unpredictable rather than futile). `EXPECTED_TABLE_SIZE` 77 → 80 in lockstep; 3 roster rows. **Twin regressions on BOTH key routes, neuter-proven**: deleting the shared `MT5_GATEWAY_UNREACHABLE` verdict row reds both (503 → 500) plus the classifier replay naming UNKNOWN — zero production route edits. A second falsifier: neutering ONE finalize arm reds three independent oracles while the 32 total holds. Prose re-cuts landed (REGISTRY ×2, the `resilient-fetch` census — where `_validate_mt5_key` was a WRONG symbol that still exists, and the completeness pin was under-counted 13 → **15**, both arrivals inert 500s — and the alias docblock whose "correctly answers UNKNOWN" premise 02 deleted). **TWO** TODOS.md deferrals recorded separately.

✅ **PHASE COMPLETE — WIZFORM-02 TICKED.** All four `missing` items from `153-VERIFICATION.md` are closed across the three plans, and the sweep is driven from EMITTING SITES (falsified three ways). ⚠️ The honesty check that could have stopped the tick was run: `keys/[id]/permissions` **is** reachable from a wizard surface (`SyncPreviewStep` → `KeyPermissionBadge`), but that component never builds a `wizardErrors` envelope — it renders the route's own `{ code, error }` as text — so no `UNKNOWN` card is rendered there. Its defect is a remedy sentence, recorded in TODOS.md as its own item. 📌 **Phase 153's parent checkbox may now tick.**

### Phase 154: WIZCONT/STALE — Wizard continuity, no stale screens

**Goal**: Re-entering the wizard continues where the founder left off, screens never show a state the backend has already left, and a token-less credential re-connect cannot mint duplicates
**Depends on**: Nothing hard (sequenced before 155 so the wizard surface is stable for verification)
**Requirements**: WIZCONT-01, WIZCONT-02, STALE-01
**Success Criteria** (what must be TRUE):

  1. Re-entering "add a strategy" with an existing wizard draft resumes at the draft's step — the entry point BEFORE the wizard (`/strategies/new` branch chooser) becomes draft-aware, with the exact entry path established by observation FIRST (WIZCONT-01 — resume is NOT missing: `WizardClient` already resumes when `initialDraft` is present; fix the chooser, not the state machine).
  2. STALE-01's root cause is investigated and documented BEFORE any fix is planned — the poll loop should have terminated at 11:39:35 and did not; why is the open question. After the fix: the wizard never sits on "Fetching trades…" after the job chain has finished, and never renders a refusal computed from a stale analytics row while a re-derive is in flight.
  3. Re-connecting the same credentials from a context that has LOST the wizard-session token (different browser/profile, cleared localStorage, incognito) fails TOWARD the existing row — identity from a stable non-secret venue value where one exists, never uniqueness on ciphertext, and never a silent overwrite of a key whose `strategy_keys` membership other strategies depend on (WIZCONT-02 — LOW priority within the phase; the common case is already safe).

**Plans**: 8 plans in 3 waves

Plans:

- [x] 154-01-PLAN.md — STALE-01 investigation gate: Q1/Q2 PROD discriminator + T1/T2/T3 RED (wave 1)
- [x] 154-02-PLAN.md — WIZCONT-01 plumbing: single-sourced draft query + wizard-draft route + REQUIREMENTS correction (wave 1)
- [x] 154-03-PLAN.md — WIZCONT-02 DB: venue_account_id column, partial UNIQUE, scrub trigger, RPC re-base, TEST apply (wave 1)
- [x] 154-04-PLAN.md — STALE-01a shared fix: poller absent-row honesty (TWIN-3) + sync-progress widening (wave 2)
- [x] 154-05-PLAN.md — WIZCONT-01 resume UX: overlay deferred mount + CSV short-circuit truth table + e2e (wave 2)
- [x] 154-06-PLAN.md — WIZCONT-02 app: one-fence-two-keys, 23505 discrimination (TWIN-8), dedup notice (wave 2)
- [x] 154-07-PLAN.md — STALE-01 supplier arm (CONTINGENT on 154-01 verdict): Python/SQL root-cause fix or recorded NO-OP (wave 2)
- [x] 154-08-PLAN.md — STALE-01 honest screens: un-gated backstop, R2-5 twin, amber state, ledger closure (wave 3)

**UI hint**: yes

### Phase 155: MT5-VERIFY — The numbers are true, live on a trading day

**Goal**: The performance Quantalyze renders for the live funded MT5 account is proven true against the terminal's own figures on a trading day, on every surface that renders it — and the milestone's umbrella acceptance (MT5-GOAL-01) closes
**Depends on**: Phases 147–154 (needs a stable surface to measure — running earlier means re-running). ⚠️ Human- and calendar-gated: a founder at the MT5 terminal, on a trading day, with the live funded account's read-only investor password. A demo account, the v1.15 soak account, or a weekend run does not satisfy it.
**Requirements**: MT5-06, MT5-07, MT5-08, MT5-09, MT5-10, MT5-15, MT5-GOAL-01 (umbrella acceptance)
**Success Criteria** (what must be TRUE):

  1. The MT5 server-UTC offset is MEASURED live at connect and asserted on — never hardcoded (breaks at the next DST transition, wrong for every other broker) — and a near-midnight deal lands on the day the terminal shows, pinned by a regression test (MT5-06; the one failure MT5-07's oracle cannot see unaided).
  2. Rendered performance matches an EXTERNAL oracle — the terminal's own equity/balance or the broker statement — over a fixed window within a founder-stated tolerance, run against the LIVE funded account on a TRADING day (MT5-07, MT5-08). ⛔ Internal consistency does not satisfy this (the self-referential-oracle shape that let three money bugs survive six passes). ⛔ No tolerance number exists anywhere yet — founder call at /gsd-discuss-phase; do not invent one.
  3. Strategy detail, public factsheet, scenario composer, portfolio PDF and browse all show the same, correct MT5 numbers — the backbone-bypass surfaces (`_compute_portfolio_analytics`, `equity_reconstruction.py`, `portfolio-stats.ts` / `scenario-blend-panels.ts` / `health-score.ts`) are checked, and any divergence is a finding (MT5-09).
  4. Every surfaced discrepancy is fixed WITHIN this phase wherever its root cause lives, including shared backbone money-math affecting every venue (UNCAPPED by founder decision — a bounded alternative was offered and declined; the phase does not close while the terminal and the UI disagree) — and the `complete_with_warnings` carried by ALL THREE PROD MT5 strategies is explained: eliminated, or understood and accepted in writing (MT5-10, MT5-15; ⛔ MT5-07 does NOT close MT5-15 — external parity is not "why did our own pipeline flag itself").
  5. **MT5-GOAL-01 — umbrella acceptance gate, no implementation work of its own:** an MT5 strategy is usable end-to-end by the allocator who uploaded it — it ingests (done), it projects in a scenario (SCEN-01, Phase 147), and its factsheet is viewable (OWN-02, Phase 148) — confirmed live by the founder. It exists so "MT5-05 ✅" can never again be mistaken for "MT5 works".

**Plans**: TBD
**Notes**: Re-homed from v1.16 Phase 142.3 (which was split out of 142.2 at the D-14 valve on 2026-08-03 and will NOT run as a v1.16 phase). ⛔ Do not archive the milestone or advertise MT5 until this phase passes — v1.15's failure mode was shipping 6/6 green with both open items intact.
⚠️ **PRECONDITION — REPLACED 2026-08-14. Read this before re-deriving anything.**

**The blocker is stale credentials, not broken code.** The founder changed the MT5 account
passwords on/around 2026-08-14, so the stored credentials will no longer authenticate. Only the
founder can supply the new read-only investor passwords. See the v1.18 milestone header for the
measured PROD state and the ⚠️ `MM1` label mismatch (three keys exist: `FX-AI_V`, `MM2`, `MM3` —
**no key is labelled `MM1`**, so re-verify all three at reconnect).
⛔ **When the three keys flip to `sync_status='error'`, that is EXPECTED. Do not open an
investigation.**

~~PRECONDITION (found 2026-08-05): all 3 PROD MT5 keys sit at `sync_status='error'` —
`'Mt5Session' object has no attribute 'fetch_balance'`...~~ — ⭐ **STALE, and it was a trap.** That
hotfix **landed** as `e0493913` (PR #667, "MT5 key-sync routing for Mt5Session + wizard roster
stopgap"). MT5 sync has worked since: PROD synced all three keys at 04:01–04:07 UTC on 2026-08-14,
`sync_error` empty on every row. The note is struck through rather than deleted because a red MT5
key plus a roadmap note pointing at `Mt5Session.fetch_balance` is a near-perfect way to send the
next session bisecting a bug that was fixed nine days earlier.

### Phase 157: FOUNDER-CONFIRM — the observations only the founder can make

**Goal**: The handful of checks no test can perform are performed, so the requirements resting on
them stop resting on an assumption
**Depends on**: Nothing. Can run in any order relative to 155, in the same sitting.
**Requirements**: none of its own — it discharges human-verification items left open by Phases
153.7 and 154
**Success Criteria** (what must be TRUE):

  1. **The 2026-08-04 wizard restart is confirmed gone.** Open `+ Strategy` with a live wizard
     draft present: the resume banner appears, and Resume lands on the draft's step rather than
     step 1. ⚠️ The MECHANICS are already covered — `e2e/wizard-resume.spec.ts` ran **green on main
     at `5d43df6b`** (2026-08-13 22:32, `e2e-seeded`; the job asserts its seed secret is non-empty
     and fails loud otherwise, so the `HAS_SEED_ENV` skip predicate was false and the test really
     executed). What no test can cover: the founder is the only person who witnessed the original
     restart, so only they can say it is gone.

  2. **The amber `wizard-sync-recomputing` block is seen on screen.** Heading *"Recomputing this
     strategy's analytics"*; no red envelope, no metric numbers; contrast and spacing per
     `154-UI-SPEC.md`. No browser pass has ever been run on this block.

  3. **The four copy members Phase 153.7 minted are seen rendering in a real wizard** —
     `SEAM_INTERNAL_FAULT`, `DRAFT_LOOKUP_FAILED`, `DRAFT_FINALIZE_FAILED`,
     `SEAM_RESPONSE_UNREADABLE`. ⭐ `SEAM_INTERNAL_FAULT` must render with **NO Retry control** —
     that single check doubles as the regression catch for the classifier→roster hop
     (`W-153.7-1`), where a missing roster member leaves the whole suite green while the wizard
     offers a Retry against a permanent fault.

  4. **`MT5_SPIKE_INVESTOR_PASSWORD` is rotated.** It sits in plaintext in Railway env and was
     printed to a session scrollback. Founder-only: they hold the credential.

**Plans**: TBD
**Notes**: ⚠️ Criterion 3 shrinks to a glance if the component render tests land first — they are
agent-deliverable and tracked outside this milestone. Criterion 2 likewise: a localhost browser
pass can pre-verify the block, leaving the founder only a confirmation.

### Phase 156: CONNECT-REFACTOR — the venue the server validated is the venue the server writes ✅ COMPLETE 2026-08-13

**Goal**: `api_keys.attested_venue` becomes what its name claims — the venue **the server itself validated**, not a parameter the caller chose. The wizard's `api_keys` INSERT moves behind a service-role writer that passes the venue it validated at mint time, and `authenticated` EXECUTE is withdrawn from `create_wizard_strategy` and `add_wizard_composite_key`. This is CR-01 remedy **(a)** — the "connect-flow refactor" that both `20260810120000` and `20260811210000` defer.

**Depends on**: Nothing. ⭐ **PULLED FORWARD AHEAD OF 155 — founder call 2026-08-13.** The 2026-08-12 call sequenced this after MT5-VERIFY; the trigger below then fired. Phase 155 is blocked on three gates none of this phase's work can clear (a founder at the terminal on a trading day, a working MT5 validate — the `[Experts] Account=1` trap is still open — and a tolerance number that does not exist and must not be invented), while sFOX go-live is already booked. Since the block itself states MT5 work **cannot** arm this residual, waiting buys nothing and leaves a live-on-PROD deferred control open for longer. 155 does not depend on this phase, so its ordering is unaffected.

⛔ **PULL-FORWARD TRIGGER — sFOX go-live.** Phase 153.6 shipped remedy **(b)**: a `CHECK` pins `attested_venue = exchange`, so the probe-skip forgery drags the ingestion label with it and the key never syncs. **That defence is a property of the current venue set, not a control.** It holds only while every probe-exempt venue is unsyncable. `mt5` is the sole member today and cannot sync ccxt credentials — which is exactly why MT5 work (153.x, 154, 155) cannot arm this. The moment a **syncable** venue joins `scopeProbeSupported: false` in `src/lib/closed-sets.ts`, the forgery becomes FREE. Phase 153.6 RESEARCH names **sFOX** as the plausible next member, and sFOX go-live is already booked (TODOS 🔴 item 3). **If sFOX is scheduled before 155 completes, this phase moves ahead of it.**

**Requirements**: CONNECT-01, CONNECT-02, CONNECT-03, CONNECT-04, CONNECT-05 — ✅ **all five complete 2026-08-13** (minted at planning the same day; the PARITY-04 deferred-control threat flag is CLEARED). Sub-clauses `-01b`/`-01c`/`-02b`/`-03b` are parts of their parent ID, not separate IDs.

**Success Criteria** (what must be TRUE):

  1. A caller holding a valid session and the server-minted ciphertext **cannot** set `attested_venue` by any route — not by client INSERT (already closed by the scrub trigger in 153.6), and not by calling the wizard RPCs directly over PostgREST. Proven by a SQL assertion that calls the RPC as `authenticated` and is REFUSED, replacing 153.6's assertion 5d, which today passes *because* it asserts the door is open.
  2. `attested_venue` is written from a venue the server **verified against the live venue API at mint time**, not from a request parameter — traced from `/api/keys/validate-and-encrypt` through to the INSERT.
  3. The wizard still works end to end for every venue, single-key and composite. ⚠️ Both RPCs currently need the **user-scoped** client because their `auth.uid()` guards demand it; moving to a service-role writer must not lose that ownership check — the row must still be provably the caller's.
  4. The `CHECK (attested_venue IS NULL OR attested_venue = exchange)` from 153.6 is **kept**, not removed as redundant. It is the fence that stops a future writer letting the two columns diverge, independent of who does the writing.
  5. Every prose claim that 153.6 had to weaken is re-strengthened to match: the `attested_venue` column comment, `20260811210000`'s section 1b, `REQUIREMENTS.md` PARITY-04, and the deferred-control threat flag is cleared.
     ⚠️ **SC5 amended in flight:** `20260811210000` §1b was **NOT** edited — it is an applied migration and `migration-reviewer` invariant 11 makes any edit a CRITICAL. It is superseded **by name** in Migration B's header ⛔ (ii). The criterion is met by supersession, not by amendment; a future reader diffing §1b against the current system is not looking at a regression.

**Plans:** ✅ **10/10 executed** — 10 plans in 8 waves, shipping as **TWO PRs** (`156-RESEARCH.md` "Deploy order": both
single-migration orderings produce a total connect-a-key outage window, so Migration A grants
`service_role` while leaving `authenticated`'s grant standing, and Migration B withdraws it only
after PR A's route is verified live on PROD). ⛔ **SC1 does not close until PR B.**

Plans:

- [x] 156-01-PLAN.md — Wave 0: measure A1/A2/A3/A4 against TEST (does a service-key client really reach `auth.role() = 'service_role'` with `auth.uid()` NULL?) — the whole privilege design rests on two facts RESEARCH could not settle
- [x] 156-02-PLAN.md — [PR A] Re-cut both route test files to the post-156 contract and observe them RED (admin-client receiver, `p_user_id === user.id`, 503 `SEAM_MISCONFIGURED`) — incl. the composite twin's missing admin mock
- [x] 156-03-PLAN.md — [PR A] Migration A: transitional two-arm role gate (branched, never unioned) + `GRANT EXECUTE … TO service_role` on both RPCs; applied to TEST, PR-Y2 renamed, snapshots regenerated
- [x] 156-04-PLAN.md — [PR A] Swap both wizard routes onto `createAdminClient()`, fail-closed on a missing service key, pragma moved with the mutation
- [x] 156-05-PLAN.md — [PR A] CONNECT-02b structural guard (a second user-scoped writer reds a normal test run) + TODOS entries for the two logged-not-fixed items + version bump
- [x] 156-06-PLAN.md — ⛔ **THE HARD BOUNDARY**: ship PR A, then verify the service-role writer live on PROD in a real browser (single-key AND composite) before PR B is authored
- [x] 156-07-PLAN.md — [PR B] Migration B: `REVOKE … FROM authenticated`, both bodies narrowed to `auth.role() = 'service_role'` with **zero** `auth.uid()`, column comment re-stamped ⛔ preserving the `20260811210000` gate marker
- [x] 156-08-PLAN.md — [PR B] Invert assertion 5d (42501 + nothing minted) and mint its missing composite twin 5f/5g, plus the two marker cross-checks that stop the block SKIPping green
- [x] 156-09-PLAN.md — [PR B] Flip G1/G2, re-shape the six direct RPC call sites whose `authenticated` role claim the new gate refuses, replace Part 3b's now-vacuous guarantee, twin the stale-re-base canary
- [x] 156-10-PLAN.md — [PR B] Re-strengthen the five prose sites to exactly what is true, clear the PARITY-04 `threat_flag: deferred-control`, full-suite phase gate

**Notes**: Raised by `gsd-code-reviewer` as blocker **CR-01** during Phase 153.6 and shipped as an accepted residual in PR #675 (v0.58.0.0). Full reasoning: `.planning/phases/153.6-parity-the-fixes-that-only-landed-on-one-path/153.6-REVIEW.md` (CR-01, both remedies stated) and `153.6-07-SUMMARY.md` (why (b) was chosen and what it does NOT buy). ⚠️ The residual was **live on PROD** from 2026-08-12; **closed 2026-08-13**.

⭐ **THE WORKED EXAMPLE — copy this shape for the next privilege change.** The phase shipped as **TWO PRs with a live PROD gate between them**, because both single-migration orderings produce a total connect-a-key outage window:

  · **PR A (#680, v0.60.0.0, merged `25e28d3a`)** — Migration A grants `service_role` and keeps a **transitional two-arm role gate (BRANCHED, never unioned)**, because a `service_role`-only body would have refused the still-live old deploy. Both routes swap onto `createAdminClient()`.
  · **THE GATE** — `156-LIVE-ACCEPTANCE.md`, `status: pass`, rows 1–5 (+ optional row 6, MT5). A real browser against real PROD: a single-key connect at 19:02:40 UTC and a 2-member Deribit composite whose SECOND member was minted by `add_wizard_composite_key`. ⭐ The gate sits **between** the landings so PR B cannot convert a working-but-open state into a broken-and-closed one, and so that the REVOKE removes a path our own code was **observed** no longer taking rather than inferred not to take from a unit suite that mocks the very client under test.
  · **PR B** — Migration B revokes `authenticated`, deletes the transitional arm, and lands the SQL gates + prose in the SAME PR (merging the migration alone reddens `sql-tests`).

⚠️ **The most transferable defect of the phase, which recurred THREE times independently:** `pg_get_functiondef` returns `prosrc` VERBATIM **including comments**, so any assertion matching a function body must strip `--` comments first. It bit Migration B's own post-verify (which would have aborted its apply on its own Trap B documentation), plan 08's assertion 5h (permanently un-armed and silently green on exactly the database it guards), and plan 09's state-adaptive arming (armed one twin and not the other — measured end-to-end as letting a re-granted `authenticated` EXECUTE exit 0 green).

⚠️ **The related class: assertions that pass for the WRONG reason.** Migration A shipped a canary that passed on precisely the stale re-base it existed to catch; `test_wizard_composite_fence.sql` Parts 3b/3c would have passed VACUOUSLY after Migration B (catching the role refusal, never reaching the cross-user condition they name) and were **re-cut rather than left reporting safety they no longer provided**; plans 08 and 09 each shipped a provably unreachable assertion and each caught it with their own mutation battery.

⛔ **`REVOKE` is not durable, and that is a CLASS.** Supabase's `pg_default_acl` re-grants `anon` and `authenticated` on any `DROP`+`CREATE`. Nothing in a migration can close this — a post-verify runs once, at apply, and the migration that reopens the door is one nobody has written yet. The durable enforcement is **assertion 5h**, armed from the function body and the live ACL rather than from a comment marker, proven on a PG16 fixture by an actual DROP+CREATE where it was the ONLY assertion that reddened.

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 147. SCEN-01 engine series | 6/6 | Complete   | 2026-08-05 |
| 148. OWN owner factsheet | 5/5 | Complete   | 2026-08-05 |
| 149. NAV my-strategies ranking | 5/5 | Complete   | 2026-08-05 |
| 150. OWN-03 portfolio question | 8/8 | Complete    | 2026-08-07 |
| 151. AUM book + sizing | 7/7 | Complete    | 2026-08-07 |
| 152. SCEN composer legibility | 6/6 | Complete    | 2026-08-07 |
| 153. WIZFORM + MT5-14 | span complete | Goal met via inserted 153.7 (span verdict stays `failed` 5/6) | 2026-08-14 |
| 153.7. WIZFORM-02-CLASS (INSERTED) | 3/3 | Complete (shipped v0.62.0.0, merge `c4555fd0`) | 2026-08-14 |
| 154. WIZCONT + STALE | 8/8 | Complete   | 2026-08-12 |
| 155. MT5-VERIFY + acceptance | 0/? | ➡️ **CARRIED to v1.18** | - |
| 156. CONNECT-REFACTOR | 10/10 | Complete (2 PRs, live PROD gate between them) | 2026-08-13 |

**v1.17 closes at 10 phases delivered** (147, 148, 149, 150, 151, 152, 153, 153.7, 154, 156).
⚠️ Phase 153's own SPAN verdict is still the verifier's to issue — every one of its `missing`
items is closed and WIZFORM-02 is ticked in REQUIREMENTS.md, but the box at line 122 is
deliberately left for `gsd-verifier` rather than self-ticked. That re-verification is
agent-deliverable and does not gate the milestone close.

### v1.18 Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 155. MT5-VERIFY + acceptance | 0/? | ⛔ Blocked — founder at terminal + new passwords | - |
| 157. FOUNDER-CONFIRM | 0/? | ⛔ Blocked — founder observations | - |

## Requirement Coverage (v1.17)

| Phase | Requirements |
|-------|--------------|
| 147 | SCEN-01 |
| 148 | OWN-02, OWN-04 |
| 149 | NAV-01 |
| 150 | OWN-03 |
| 151 | AUM-01, AUM-02, AUM-03, AUM-04, AUM-05 |
| 152 | SCEN-02, SCEN-03, SCEN-04, SCEN-05 |
| 150 | OWN-05 |
| 153 | WIZFORM-01, WIZFORM-02, WIZFORM-03, WIZFORM-04, MT5-14 |
| 153.x | WIZFORM-05 (the validate-budget split; ⛔ explicitly FENCED OUT of 153.7) |
| 154 | WIZCONT-01, WIZCONT-02, STALE-01 |
| 155 | ➡️ MT5-06, MT5-07, MT5-08, MT5-09, MT5-10, MT5-15, MT5-GOAL-01 (umbrella) — **CARRIED TO v1.18 on 2026-08-14. Not delivered in v1.17.** |
| 156 | CONNECT-01, CONNECT-02, CONNECT-03, CONNECT-04, CONNECT-05 ✅ (all five complete 2026-08-13; also closes PARITY-04, whose deferred control 153.6 could not take inside its own phase) |

**31 in-scope requirement IDs mapped (30 work + 1 umbrella), each to exactly one phase.**
⚠️ **Corrected 2026-08-14 — this table said "29/29 mapped, no orphans" while omitting TWO
requirements** (`OWN-05` and `WIZFORM-05`, both added after it was written). Milestone-audit
warning **W2**. A completeness claim that predates the last two additions is worse than no claim:
it reads as a checked invariant when it is a stale count. ⭐ **24 of the 31 were DELIVERED in
v1.17; the 7 on the Phase 155 row were CARRIED to v1.18** and are not v1.17 gaps.
No duplicates. OWN-01 excluded (already met — CONTRIB-03, verified in code 2026-08-04).
⛔ Everything in SEAM / JOB / RATE / PYAPI* / SEAMCORE / SEAMUX remains v1.16 (PARKED below).
Revised 2026-08-04 after NAV-01 was sharpened: the approved Phase 148 (OWN-02/03/04 + NAV-01)
split into 148/149/150; later phases renumbered +2 (149→151 … 153→155) with dependencies intact.

---

## ✅ CLOSED Milestone: v1.16 Production Resilience & Reliability (Phases 140–142) — CLOSED 2026-08-14

⚠️ **SCOPE AMENDED ON CLOSE, and the amendment is dated on purpose.** This milestone ran 140–146
and sat ⏸️ PARKED at 13/19 phases for weeks. Phases **143, 144, 145 and 146 were CARRIED to the new
milestone v1.19 JOB/RATE** on 2026-08-14 — not dropped, not ticked, and not renumbered. With them
went JOB-04, JOB-05, JOB-06, JOB-08 and RATE-01..05.

**Why carried rather than resumed:** GSD models ONE current milestone, and v1.18 already held that
slot. Working four phases under a header reading PARKED is precisely the ledger-vs-reality drift
that produced four blockers in the v1.17 milestone audit. Fifteen phases that shipped weeks ago
also should not share a milestone with four that have never been planned.

⛔ **What v1.16 actually earns:** the shared resilience core and breaker, the Python service
contract, the wizard/client seam surface, retry-with-backoff, and the stuck-computing reaper.
⛔ **What it does NOT earn:** dropped-enqueue detection, orphaned-`running` visible termination,
csv-finalize atomicity, or a rate limit a new route cannot bypass. Those are v1.19's, and none has
been started.

⛔ **PARKED 2026-08-04 at 68% — NOT shipped, NOT complete.** 13/19 phases complete, 119/127
plans (68%). Outstanding: **Phase 143** (dropped-enqueue reconciliation sweep), **Phase 144**
(WR-02 orphaned-running DELETE→terminal UPDATE — ⚠️ carries a LIVE founder decision: the current
purge DELETEs orphaned-`running` rows rather than resetting them; TEST wants DELETE, PROD wants
reset, and both must be reconciled in the SAME migration), **Phase 145** (csv-finalize atomicity,
reproduce-first) and **Phase 146** (RATE audit). **Resume at Phase 143 after v1.17 delivers.**
All 29 phase directories were deliberately preserved (the workflow's `phases.clear` was skipped
by founder call) so this milestone resumes without reconstruction.

⚠️ **Re-homed into v1.17 (2026-08-04):** Phase 142.3's entire scope — MT5-06..10, the live
trading-day numeric verification — now lives in **v1.17 Phase 155**, and MT5-14 (wizard metadata:
MT5 declarable + preselected) in **v1.17 Phase 153**. Phase 142.3 will not run as a v1.16 phase.

**Goal:** Give the live money-bearing plumbing failure handling — so a hung Railway request, a
silently-dropped compute-job enqueue, or a mid-job worker crash can't strand a real investor
factsheet on a spinner that never resolves.

**Scope:** 18 v1 requirements (SEAM-01..06, JOB-01..07, RATE-01..05) per
`.planning/REQUIREMENTS.md` (written against the research-CORRECTED scope in
`.planning/research/SUMMARY.md`, not the original milestone prose). CRON + MONEY groups deferred
(founder 2026-07-25). Phase numbering continues from 140 (v1.15 ended at 139).

**Ordering rationale (non-negotiable, from research):**

- **Breaker (140) ships BEFORE retry (141)** — fail-fast alone carries zero double-execution risk
  and can land while the SEAM-05 idempotency audit is still being written; retry without a breaker
  actively amplifies an outage.

- **SEAM before JOB** — JOB's sweeps use SEAM's timeout-vs-upstream-vs-network error taxonomy to
  decide re-enqueue vs terminal-fail.

- **Every JOB reaper/sweep lands in pg_cron** — never the worker loop (same failure domain as the
  crash it backstops; re-exposes WEDGE-01) and never Vercel cron (plan cron-slot ceiling, a
  documented past cause of prod going dark).

- **142 before 143** — both sweep the same `strategies`/`strategy_analytics`/`compute_jobs`
  triangle; built in sequence as one non-racing mechanism, not two competing crons.

- **RATE last** — mechanical, and its gap list must come from a fresh kickoff grep, not from
  anything upstream.

## v1.16 Phases (PARKED)

- [x] **Phase 140: SEAM — Shared resilience core + circuit breaker** - Both Vercel→Railway chokepoints fail fast through one Upstash-backed breaker with unified timeout budgets and a clean 503 envelope (no retry yet) (completed 2026-07-25)
- [x] **Phase 140.1: PYAPI — Python service contract, status attributability & limiter identity** (INSERTED) - Tenant-scope the wizard-session leak, make 4xx/5xx attributable at the source, per-tenant `/process-key` throttling, complete idempotency (completed 2026-07-26)
- [x] **Phase 140.1.1: PYAPI-FIX — close Phase 140.1's own review findings** (INSERTED) - Cross-language duplicate-reply contract incoherence (a live 502 arm, but no caller reaches it today); 4 Python High findings; `error_contract.py`'s two remaining guard gaps that no downstream phase can reach; and every test the review's 36 injected mutations proved toothless (12 survived) (completed 2026-07-26)
- [x] **Phase 140.1.2: PYAPI-FIX2 — close the venue-transient class on the live route** (INSERTED) - The class 140.1.1 closed on teaser/csv is still open on `/api/validate-key`, where a venue blip renders as `UNKNOWN`/500 "team notified"; plus MT5 permanent-code misclassification (reproduce-first), the raw 429, four 429s missing `Retry-After`, the `_SHAPES` corpus fence, and artifact corrections (completed 2026-07-30; VERIFICATION **passed** 6/6; shipped to main @ 4f45dcab)
- [x] **Phase 140.2: SEAMCORE — Seam core & breaker correctness + harness integrity** (INSERTED) - Record on attributability not `>=500`, cover the body read, bound the store, pin every constant to a literal, verify against real Redis (completed 2026-07-27; 12/12 plans; 7/7 success criteria SATISFIED, SC4 with a named residual; 56 ledger rows re-run at the final tree, 55 RED + 1 GREEN with its replacement RED)
- [x] **Phase 140.3: SEAMUX — Client & wizard seam error surface** (INSERTED) - One source of truth for codes/copy, observe every HTTP outcome, never blame the user for our outage, non-destructive retry (shipped 2026-07-30, PR #651; VERIFICATION **gaps_found** 15/16 — 2 named residuals accepted as tracked tech-debt: **SEAMUX-03** (9 of 15 seam-importing routes still emit bare `{error}` not the typed `{code}` envelope — ⚠️user-facing error attribution) + poll-disjointness pin blind to `wizardFetch` (test-hygiene). See TODOS "v1.16 carried-forward residuals". ⏳ **G4–G8 gap-closure series is coding these arms route-by-route; G7 (2026-07-31) wire-audited `/api/strategies/csv-validate` and found per-arm machine codes ALREADY on the wire — 0 codeless arms — the VERIFICATION `grep -cE 'code:\s*"'` counted 0 only because this route carries `code` positionally through `csvErrorBody`; receipt is the extended `src/__tests__/csv-validate-route.test.ts` (arm-agnostic `json.code` sweep + SENTINEL_PII guard). G8 (2026-07-31) coded both admin match routes — `admin/match/eval` 0→6 coded arms, `admin/match/recompute` 0→10 incl. 2 coded deny bodies; TS-19 4xx forwards now carry `err.seamCode` with `dependency` intact; T-140-12 ordering preserved. G9 (2026-07-31) coded the TENTH route the VERIFICATION nine-route list MISSED — `/api/admin/strategy-review`, 0→27 coded arms (13 `REVIEW_SOURCE_READ_FAILED` byte-identical 503s, 5 `REVIEW_RECHECK_FAILED` 409s incl. a plan-missed status-pin 409, 2 `UNKNOWN` write-fault 500s, plus the auth/validation/gate tokens); arm-agnostic source-scan fence added; RED-on-neutering observed. Its only seam import is `scrubSeamError` (in-class by definition, no analytics call). **✅ SEAMUX-03 aggregate CLOSED 2026-07-31** — opus verifier PASSED (16/16 seam routes carry typed `{code}` on every reachable route-emitted arm; 817/817 tests; RED-on-neuter confirmed on 4 routes); `140.3-VERIFICATION.md` SEAMUX-03 → `resolved`. Non-blocking residuals → TODOS: 2 codeless `rateLimitDenyJson` deny bodies (SEAMRIM-05-pinned, rate-limiter boundary) + poll-disjointness pin (test-hygiene) + SC2 `COMPOSITE_UNSUPPORTED_UNIFIED` residual.**)
- [x] **Phase 140.4: SEAMRIM — close the wizard/client rim the core fix left open** (INSERTED) - Fabricated observations, destructive controls, our-fault-rendered-as-theirs, and the guards that cannot fail (shipped 2026-07-30, PR #652 + CR-01; VERIFICATION was `gaps_found` 39/43 but its user-facing gap is **STALE/RESOLVED** — verified 2026-07-31 that the `SEAM_MISCONFIGURED`→`UNKNOWN` translate hop IS present in current code at `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:538` + `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx:851` (`recogniseSeamErrorCode`); the fix landed after the VERIFICATION was written. Only a non-blocking `analytics-client` scrub-test ledger-row residual (doc-hygiene) remains. See TODOS)
- [x] **Phase 140.5: SEAMPROSE — attribution copy, harness fidelity, and prose/citation truth** (INSERTED) - What the codebase says about itself is true; ⭐carries `Retry-After` travels, a HARD PREREQUISITE for 141 (completed 2026-07-30)
- [x] **Phase 141: SEAM — Retry-with-backoff, gated on the idempotency audit** - Committed retry-safety audit, then bounded retry ONLY for allowlisted calls; teaser provably never retried (completed 2026-07-31)
- [x] **Phase 141.1: SEAMBACKOFF — Retry-After-aware backoff, breaker recalibration, and SEAM-05 evidence re-derivation** (INSERTED) - Scope from the 8-agent review campaign over 141; **zero user-facing and zero data-integrity defects found**, so no retry verdict changed and no budget row was un-flipped. 9/9 plans (completed 2026-07-31). VERIFICATION was `gaps_found` 19/20 and is now **passed** 20/20 on re-verification 2026-08-01 — all three gaps had been closed in the tree by post-verification work and the file was simply never re-run: D-06's last stale coordinate became a symbol anchor at `22332e34` (the whole self-relative-citation class is now absent from `resilient-fetch.ts`), the two deferred ledgers were reconciled so TODOS.md and `deferred-items.md` both carry all four `DEF-141.1-*` ids, and the Falsifiability Ledger closed at 20/20 observed with `nyquist_compliant: true`
- [x] **Phase 141.2: SEAMFIX — close the 141.1 code-review findings: duplicate onboard verification write, flag-monitor denominator integrity, breaker re-arm** (INSERTED) - 25 findings from the xhigh review (30 agents) deduped to 13; outcome is **twelve remediated, one dispositioned** — finding 8's retry↔limiter amplification is ACCEPTED, not fixed, and is stated as STILL LIVE everywhere it is summarised. Closes the duplicate `strategy_verifications` write on the money path (onboard's retry is now refused unless the call carries a truthy `wizard_session_id`, decided at the single chokepoint) and the three monitoring-integrity regressions D-16 shipped (unbounded `.select()` → `head: true` count, attacker-movable dedup deleted outright, read error now a distinct `denominator_read_failed` outcome rather than zero traffic). 6/6 plans (completed 2026-08-01). VERIFICATION was `human_needed` 17/17 and is now **passed** — three of its four production probes were discharged read-only on 2026-08-01 (42 rows / 42 distinct `correlation_id` / 0 `wizard:` prefix, flow_type resync 20 · csv 20 · onboard 2; unbounded `.select()` returned exactly 1000 rows at HTTP 200 with `error: null` against 7351 total, reproducing the silent truncation; all five breaker keys ABSENT, keeping finding 10 framed as hardening). The fourth — a real Railway-edge 503 carrying a malformed `Retry-After` — stays **Manual-Only and is not a gap**: it cannot be induced, and the only contract-bound 503 emitter we own structurally cannot emit one. ⏳ On PR #656, **not yet merged**
- [x] **Phase 142: JOB — strategy_analytics stuck-computing reaper + computing_started_at DDL** - Writer-stamped transition timestamp + pg_cron reaper to terminal `failed` + threshold-math CI invariant + WEDGE-01 regression test (completed 2026-08-02)
- [→] **Phase 143: JOB — Dropped-enqueue reconciliation sweep** — ➡️ **CARRIED to milestone v1.19 on 2026-08-14.** Never started; charter moved intact to the v1.19 section at the top of this file, number unchanged
- [→] **Phase 144: JOB — WR-02 orphaned-running DELETE→terminal UPDATE + cadence** — ➡️ **CARRIED to milestone v1.19 on 2026-08-14.** Never started; charter moved intact to the v1.19 section at the top of this file, number unchanged
- [→] **Phase 145: JOB — csv-finalize atomicity (reproduce-first)** — ➡️ **CARRIED to milestone v1.19 on 2026-08-14.** Never started; charter moved intact to the v1.19 section at the top of this file, number unchanged
- [→] **Phase 146: RATE — Audit + close the two verified gaps** — ➡️ **CARRIED to milestone v1.19 on 2026-08-14.** Never started; charter moved intact to the v1.19 section at the top of this file, number unchanged

## v1.16 Phase Details (PARKED)

### Phase 140: SEAM — Shared resilience core + circuit breaker

**Goal**: A hung or dying Railway fails fast at BOTH seam chokepoints with a clean typed error — never a lambda held until platform kill, never a cascade-500
**Depends on**: Nothing (first phase of milestone)
**Requirements**: SEAM-01, SEAM-02, SEAM-03, SEAM-04
**Success Criteria** (what must be TRUE):

  1. With Railway mocked to hang, a `keys/sync` request (via `postProcessKey()`) AND an `admin/match/*` request (via `analyticsRequest()`) each return a typed error within their documented timeout budget instead of holding the lambda open — both chokepoints route through the ONE shared `resilient-fetch` core.
  2. After repeated Railway failures, a seam call from a DIFFERENT module context (simulating a second Fluid Compute instance) short-circuits with the typed `503 CIRCUIT_OPEN` envelope + human message without touching Railway — breaker state lives in the shared Upstash store (`breaker:railway`), never per-instance memory.
  3. When Upstash itself errors, seam calls still attempt the real Railway request — the breaker fails OPEN, so a broken breaker can never itself become the outage (deliberate divergence from the rate limiter's fail-closed).
  4. A CI test asserts `timeout × (1 + retries) < maxDuration` for every route calling either chokepoint, driven from ONE exported per-call-site budget table (replacing the divergent 30s / hardcoded-60s ad-hoc budgets).
  5. No route handler calling either client surfaces a raw fetch/breaker error as a 500 — every failure arrives as the typed envelope (the cascade-500 escape in `analytics-client.ts` callers is retrofitted shut).

**Plans**: 7 plans, 4 waves
Plans:

- [x] 140-01-PLAN.md — resilient-fetch core: SEAM_BUDGETS table + Upstash breaker (fail-OPEN) + full unit contract (wave 1)
- [x] 140-02-PLAN.md — both clients through the ONE core + CIRCUIT_OPEN envelope + SC-1c wiring test (wave 2)
- [x] 140-03-PLAN.md — admin/match Class-1: typed arms, err.message leak closed, SC-1b seam test (wave 3)
- [x] 140-04-PLAN.md — wizard Class-2: type-checked SERVICE_UNAVAILABLE_RETRY before substring cascade (wave 3)
- [x] 140-05-PLAN.md — Class-3 five routes: CIRCUIT_OPEN arms + optimizer refund + dormant fetch through core (wave 3)
- [x] 140-06-PLAN.md — third seam (permissions) through core + B-route maxDuration pins + SC-1a seam test (wave 3)
- [x] 140-07-PLAN.md — SC-4 budget invariant test + no-raw-analytics-fetch ESLint rule + phase gate (wave 4)

> **Phases 140.1–140.3 repair the surface Phase 140 shipped.** Five review rounds against the
> verified Phase 140 tree found 46 + ~120 original-code defects; five ad-hoc fix batches were
> **discarded wholesale** (`wip/v1.16-phase140-fix-archive`) because repairs without the
> plan→plan-check gate ran ~1:1 fix-to-defect. Evidence per finding:
> `.planning/phases/140-seam-shared-resilience-core-circuit-breaker/140-FINDINGS-CONSOLIDATED.md`.
> **PART 2 ("TRAPS") is binding on every plan in these three phases** — it is what survives of the
> discarded batches and it documents how each naive fix breaks.
>
> **They must land before Phase 141.** 141 builds retry on top of the breaker; retry over a breaker
> that under-counts (SEAMCORE-02) or trips on caller faults (SEAMCORE-01) amplifies outages.
>
> **Contract between the three:** 140.1 owns what the service EMITS (status codes, body shapes,
> limiter identity) · 140.2 owns the error TYPES · 140.3 owns how they RENDER. They share almost no
> files, which is what makes independent planning safe — the coupling is what produced the fix-batch
> collisions.

### Phase 140.1: PYAPI — Python service contract, status attributability & limiter identity (INSERTED)

**Goal**: The analytics service tells the truth about whose fault a failure is, cannot leak one tenant's verification to another, and cannot be denied platform-wide by an anonymous caller
**Depends on**: Phase 140 (the seam core exists; this phase fixes what it consumes)
**Requirements**: PYAPI-01..10
**Success Criteria** (what must be TRUE):

  1. Two tenants submitting a colliding `wizard_session_id` each see only their own verification — an RLS/SQL gate under `supabase/tests/` fails if the uniqueness constraint is not tenant-scoped, and the duplicate pre-check cannot return a foreign row.
  2. An exchange-side fault (maintenance, revoked key, IP-allowlist change) and a bad-credential fault each answer **4xx**; only a genuine service-side fault answers 5xx — so a single user's broken key can no longer contribute to a platform-wide breaker trip.
  3. An anonymous caller hammering the public teaser cannot exhaust the `/process-key` allowance for authenticated tenants — throttling is bounded per tenant, not by one bucket keyed on the shared internal token.
  4. On `/process-key`, an unauthenticated request is rejected before validation and before throttling — it can neither enumerate feature flags nor consume throttle budget.
  5. No replay can return "duplicate" for work that was never enqueued, and no state exists from which the client is told to retry with no path to success.
  6. A missing or stale platform secret produces an operator signal; no response body echoes caller credentials; validation detail and throttle responses arrive machine-readable (`Retry-After`, structured `detail`).

**Plans**: 9 plans, 5 waves
Plans:

- [x] 140.1-01-PLAN.md — PYAPI-01 SQL half: tenant-scoped composite unique index + RED-first supabase/tests gate (wave 1)
- [x] 140.1-02-PLAN.md — PYAPI-01 query half + PYAPI-09: pre-check move/scoping/ownership, enqueue-aware duplicate path, RPC dedupe fence (wave 1)
- [x] 140.1-03-PLAN.md — PYAPI-05 contract artifact + R-2 helper; remap exchange.py S-01..S-07 + internal.py S-08..S-12 (wave 1)
- [x] 140.1-04-PLAN.md — PYAPI-05 remap match/simulator/portfolio S-13..S-20 + main.py S-23 JSONResponse literal (wave 2)
- [x] 140.1-05-PLAN.md — PYAPI-10: ok discriminator on all six 200 shapes; scope rejection 200→403 (wave 2)
- [x] 140.1-06-PLAN.md — PYAPI-04 auth-first middleware + PYAPI-02 HMAC tenant-claim limiter + TS mint (wave 3)
- [x] 140.1-07-PLAN.md — PYAPI-03: delete 3 private limiters, rekey all 9 IP-keyed routes, flow-cost table (wave 4)
- [x] 140.1-08-PLAN.md — PYAPI-07 scalar-detail 422 handler + PYAPI-08 machine-readable 429 + PYAPI-06 operator signal (wave 4)
- [x] 140.1-09-PLAN.md — Phase gate: CI-mirror runs, M1-M8 mutation ledger, TS-obligations artifact, PROD wedge count (wave 5)

### Phase 140.1.2: PYAPI-FIX2 — close the venue-transient class on the live route + the surviving 140.1.1 review findings (INSERTED)

**Goal**: The venue-transient class is closed on the route real users actually hit, and every finding that survived adversarial refutation is closed or explicitly, reasonedly deferred
**Depends on**: Phase 140.1.1 (closes findings against its 25 commits)
**Requirements**: PYAPIFIX2-01..06
**Evidence**: `140.1.1-STAGE1-FINDINGS.md` (5 lenses) + `140.1.1-STAGE2-FINDINGS.md` (5 red teams) + `140.1.1-REVIEW.md` (36 mutations, 30 caught, 6 survived). **An adversarial refutation pass refuted 4 of 10 findings outright and reduced 3 more — this scope is only what survived.**
**Success Criteria** (what must be TRUE):

  1. **A venue-transient fault answers a typed, classifiable error at EVERY consumer of `validate_key_permissions` — including `/api/validate-key`, the live key-connect route.** Today `analytics-service/routers/exchange.py` (the C6 site — `if result["error"]:` :596) and `analytics-service/routers/portfolio.py` (the C7 site — `if validation.get("error"):` :2338) collapse `RATE_LIMITED`/`DDOS_PROTECTION`/`EXCHANGE_UNAVAILABLE`/`NETWORK_UNAVAILABLE`/`PROBE_FAILED` into an opaque 400 with no `code` and no `retryable`. **The arm 140.1.1 fixed serves teaser/csv/internal_report; the unfixed one carries strictly more real traffic.** A test must prove that a Binance-maintenance-shaped failure during key-connect no longer renders as `UNKNOWN`/500 *"our team has been notified"* with no retry affordance. ⚠️ **DISPOSITION (140.1.2 plan 04): PYTHON HALF CLOSED (7/7 sites carry code+recoverable); RENDER HALF → OB-1, owner 140.3** (ledger row `TS-35`) — the *renders* assertion in this criterion is a TypeScript assertion (`create-with-key/route.ts` returns the classifier-computed status and discards the upstream one, RESEARCH C-1), so this criterion is HALF met by this phase, deliberately and on the record.
  2. **A permanent MT5 credential fault is never retried as a transient venue fault** — or the phase records, with evidence, that the path is unreachable. `MT5_WRONG_SERVER` / `MT5_MASTER_PASSWORD` are absent from both `PERMANENT_VALIDATION_ERROR_CODES` and `analytics-service/services/ingestion/long_fetch.py`'s local `permanent_codes` set (:406), so the live worker path burns 3 gateway-serialised retries on a credential that can never succeed — while TypeScript already calls both 400 client faults. **Reproduce-first: "could not reproduce" is a valid outcome** (one red team held MT5 never reaches `validate_key_permissions`).
  3. **`/internal` throttling emits the service's own envelope**, giving the 429 builder arm added in 140.1.1 its first call site — today `analytics-service/routers/internal.py`'s `_consume_rate_limit` throttle (guard :231, emit :251) raises a raw `HTTPException(429)` one line away from it, so the arm has zero callers and the response carries no `code`.
  4. **Every user-facing 429 carries a `Retry-After`** — `analytics-service/routers/match.py:1742`, `analytics-service/routers/portfolio.py:1964`, `analytics-service/routers/simulator.py:249` currently do not.
  5. **The 200-discriminator corpus cannot silently shrink.** Deleting a `_SHAPES` row was OBSERVED to survive (141→140 passed) after 140.1.1 correctly removed a self-referential guard that was *also* the only corpus fence.
  6. **The phase's artifacts state only what they can support**: `140.1.1-VERIFICATION.md` reads `gaps_found` (its "no already-correct test was removed" claim is false, and PYAPIFIX-02's carve-out was evidenced by a `grep -c` that proves a marker exists, not that a list is complete); and in `analytics-service/docs/STATUS_CONTRACT.md` the "not seam-reachable" list no longer points at a **live 424 arm** (`analytics-service/routers/exchange.py` — `service_error(424, "EXCHANGE_PROBE_FAILED", …)` :565), S-11's line ref is correct, the "four classes" heading matches its five-row table, and the dependency census is right. ⚠️ **No general comment sweep** — the "refs off by the inserted-line count" diagnosis was **refuted**; most drift pre-dates the phase, so any number recomputed as old+18 would be wrong.

**Plans**: 4 plans / 3 waves
Plans:

- [x] 140.1.2-01-PLAN.md — PYAPIFIX2-02: gated reproduce-first MT5 permanence (adapter-provenance fix or NOT-REPRODUCIBLE exit) (wave 1)
- [x] 140.1.2-02-PLAN.md — PYAPIFIX2-03 /internal 429 → service_error + PYAPIFIX2-04 Retry-After ×4 + the fenced census-comment exception + TS-34 (wave 1)
- [x] 140.1.2-03-PLAN.md — PYAPIFIX2-01: venue-transient class closed 7/7 via flat scalar-detail shape + machine code; TS-32 corrected + TS-35 added (wave 2)
- [x] 140.1.2-04-PLAN.md — PYAPIFIX2-05 _SHAPES↔AST fence + PYAPIFIX2-06 artifact truth + phase gate (wave 3)

### Phase 140.1.1: PYAPI-FIX — H-5 duplicate-reply contract break + close the 12 surviving mutations (INSERTED)

**Goal**: Phase 140.1's own review findings are closed — nothing it shipped breaks a live consumer, and every test the review's mutations proved toothless now bites
**Depends on**: Phase 140.1 (closes findings against its 41 commits)
**Requirements**: PYAPIFIX-01..06
**Evidence**: `.planning/phases/140.1-.../140.1-REVIEW.md` — `issues_found`, 0 critical / 24 warning / 12 info, **36 mutations injected, 12 SURVIVED**. Each survivor is proof of a toothless test, not an inference.
**Success Criteria** (what must be TRUE):

  1. **The `/process-key` duplicate reply and its consumer agree on ONE contract.** ⚠️ *De-escalated 2026-07-26 — this is NOT a live break.* Source-verified: **no live caller can trigger the 502 today** — `finalize-wizard/route.ts` and `keys/sync/route.ts` contain ZERO `wizard_session_id`; the duplicate path requires a caller-supplied one (`analytics-service/routers/process_key.py` — `idempotent_by_session` :1033-1035); csv arms return before the pre-check; `create-with-key`/`composite/add-key` use it only in direct SQL RPCs. It is **contract incoherence with a live 502 arm** — a trap for the next caller, and 140.2/140.3 add callers. Fix it for coherence, not urgency. `analytics-service/routers/process_key.py` — `_wizard_duplicate_reply` :717, body :737-747 — emits `queued:true` WITH `code`/`idempotent`; the guard at `src/lib/process-key-onboard-contract.ts` — `isProcessKeyOnboardResponse` :97, imported by `src/app/api/strategies/finalize-wizard/route.ts:31` — rejects exactly that shape (`if ("code" in r || "idempotent" in r) return false;` — "mixed envelope = bug"), and the miss arm emits Sentry + **HTTP 502**. A test must exercise the REAL Python reply against the REAL TS guard — today both suites are green **because each mocks the other**, which is precisely how this landed. *(Verified at source: the guard is Phase 140's own commit `57b11813` on this SAME unmerged branch — NOT deployed, and 140.1 never touched that file. So there is no rollout-ordering constraint; pick the fix direction on contract quality. At base `43449cc6` both duplicate arms hardcoded `"queued": False`, which the guard's `queued=false` branch accepts — that branch permits `code`/`idempotent`. The regression is solely that PYAPI-09 made `queued` sometimes true while keeping them.)*
  2. **Venue-transient faults are 424/retryable, not 403** — via a **permanent-code ALLOW-LIST**, never a transient denylist. No response body may say `recoverable:false` beside "Try again in a moment." *(Corrected 2026-07-26 at source: (a) the claim that `/exchange/validate-key` "already gets this right" is **FALSE** — `read_only is False` appears exactly twice repo-wide, `analytics-service/routers/process_key.py:1597` (in `_scope_rejected`) and `analytics-service/services/ingestion/long_fetch.py:331`; that route never evaluates it. The real analog is `analytics-service/services/ingestion/long_fetch.py` — `permanent_codes` :406-409 feeding `_is_permanent` :432-438. (b) The research's proposed **transient denylist fails unsafe — it is literally the existing bug's shape**; `long_fetch` uses a permanent allow-list, follow that. (c) `MISSING_SCOPE` **must** be in the allow-list — `analytics-service/services/exchange.py:1103-1116` (the deribit `scope_detail` branch inside `validate_key_permissions`) sets `read_only=False` + `error_code="MISSING_SCOPE"` and returns without `valid=True`, and it is absent from `long_fetch`'s `permanent_codes`, so a permanent scope fault would otherwise become a retryable 424. (d) The review both over- and under-counted: its "two sites" are one predicate + its single return, and it **missed `analytics-service/routers/process_key.py`'s `recoverable` derivation (:405-412)**, which omits `PROBE_FAILED`/`DDOS_PROTECTION` — no status-code change fixes that.)*
  3. **`create_exchange` failures are 500, not 424 — at all THREE sites.** `analytics-service/routers/internal.py` — `create_exchange` :485 and its `except Exception:` arm :488-522 (S-11) — classifies them as "problem at the venue", but that function performs **no network I/O** — every real failure (ccxt `TypeError`, `ImportError`, OOM) is ours. As 424 it is breaker-inert AND 4xx, so **nobody is ever paged**. *(Corrected 2026-07-26: the pattern-mapper found this is a **3-site class, not 1** — `analytics-service/routers/portfolio.py:2283` is a third, and the **same function's second `create_exchange` at `:2373` already answers 500**, which is in-repo proof the class is real. This is exactly the instance-not-class defect the mapper exists to catch; a point-fix would have shipped.)*
  4. **The `body.detail.detail` scalar guarantee is ENFORCED, not documented.** `analytics-service/services/error_contract.py` — `service_error_body` :230, its C1 scalar guard :245-256 — is what Phase 140.2 renders from; today lists and dicts emit verbatim (proven by execution). Every other class rule in that module is a hard guard.
  5. **Every one of the 12 surviving mutations turns a test RED**, re-run and observed first-hand. Named in the review; they include S-06's split pinned by a single ccxt subclass (narrowing `except ccxt.BaseError` survived **twice**, and under it `RateLimitExceeded` answers 500 — the exact A-01/C-12 defect this programme exists to fix), `RETRY_AFTER_SECONDS["supabase"]` (15→900 survived), `default_platform_key` returning `""` (**makes slowapi skip limiting entirely** and ships green), and the 429's `Retry-After` value.
  6. **`error_contract.py`'s remaining guard gaps are closed — the circular deferral is broken.** *(Added 2026-07-26 from two red teams; no downstream phase can fix these — 140.2/140.3 are TypeScript-only by their own CONTEXTs and 146 is a rate-limit phase, so they currently have NO reachable owner.)* **(a)** A `429` carrying `Retry-After` is **constructable**: today `retry_after` requires `retryable:true` while the CALLER arm raises on `retryable:true` (`analytics-service/services/error_contract.py` — `_validate` defined :100, its generic-CALLER arm :218-227, the `retry_after`-implies-`retryable` rule :118-119) — yet `140.1-VERIFICATION.md` gap 1 and obligation TS-23 both MANDATE migrating the two in-handler 429 sites onto that envelope. **(b)** The `>=500` arm rejects a venue `dependency`: today `service_error(500, "X", dependency="binance", retryable=False)` validates, and **Phase 140.2 keys the breaker on `dependency`** — a venue name on a 500 poisons a breaker key.

**Plans**: 7 plans / 4 waves
Plans:

- [x] 140.1.1-01-PLAN.md — PYAPIFIX-04+06: all 4 error_contract guard gaps (429 arm, 500-dep membership, scalar detail, retry_after source) + doc reconciliation (wave 1) — **DONE** 2026-07-26, 5 commits `0a195a5f..7454330c`; criteria 4 + 6a/6b observably true; 48 new tests, all RED-first; suite 4668/96 skipped, mypy 89 files clean
- [x] 140.1.1-02-PLAN.md — PYAPIFIX-02: permanent-code allow-list, 424 pre-gate + recoverable fix, TRAP-9 fence unedited, M-4 carve-out BLOCKED-BY: TS-05 (wave 1)
- [x] 140.1.1-03-PLAN.md — PYAPIFIX-01 Python half: predicate extraction to src/lib leaf + committed fixture proven equal to real TestClient bodies (wave 1) — **DONE** 2026-07-26, 2 commits `82f84f28` (extraction, 59 route tests green UNEDITED) + `0c45da2c` (fixture + 6 contract tests). `src/lib/process-key-onboard-contract.ts` has **0 imports**, both symbols exported, one implementation repo-wide; fixture **tracked in git** (5 cases, 2 positive / 3 negative), positives proven equal to REAL full-stack `main.app` TestClient replies on BOTH duplicate arms; falsifiability probe RED observed → reverted → GREEN. No Python production file touched. Suite 4704/96 skipped, mypy 89 files clean, tsc 0, lint 0 errors. **Wave 1 COMPLETE — `wave_0_complete: true`, plan 05 unblocked.**
- [x] 140.1.1-04-PLAN.md — PYAPIFIX-03: create_exchange class 3/3 sites -> 500 retryable:false + M-14 log companions (wave 2) — **DONE** 2026-07-26, 6 commits `9adbedae..6b754def` (3 RED/GREEN pairs). **Class closed at 3/3, not the review's 1 or RESEARCH's 2**: `analytics-service/routers/internal.py:517` (B1), `analytics-service/routers/exchange.py:541` (B2), `analytics-service/routers/portfolio.py:2309` (B3 — named by NOBODY, found only by the pattern-mapper because British "initialise" defeats the grep). All three raise `service_error(500, "ADAPTER_INIT_FAILED", retryable=False)` with ONE shared copy; **no `dependency` on any** (plan 01's C3 guard makes the old shape unconstructable); no `Retry-After`. `EXCHANGE_INIT_FAILED` retired at **0** raise sites; `grep "Failed to initiali" routers/` → **0**. `ValueError` → 400 preserved and newly pinned at all three. B4 (`analytics-service/routers/portfolio.py:2550` — the `500 "Strategy verification failed"` arm) and B5–B8 byte-unchanged. **M-14 closed at 2/2** (`analytics-service/main.py:777` `service_key.secret_unset` + `:804` `service_key.mismatch`), with the absent-header 0-event fence proved falsifiable by a neuter probe (dedent → 1 failed / 3 passed, reverted). 2 new test files, +12 tests. Suite **4716/96 skipped/0 failed**, mypy 89 files clean, 0 new `type: ignore`.
- [x] 140.1.1-05-PLAN.md — PYAPIFIX-01 TS half: widen guard + 3 new invariants, parity test, both-direction neuter proof, TS-OBLIGATIONS reconciliation, M-11 record (wave 2) — **DONE** 2026-07-26, 3 commits `8865400c` (RED parity test) → `2f776271` (GREEN widening + TS-03 comment inversion, same commit per the ledger's own warning) → `58441952` (route.test rewrite). **PYAPIFIX-01 CLOSED.** The mixed-envelope rejection is deleted and the union widened, with THREE compensating invariants (non-empty `code`; `idempotent` ⇒ `true` AND `code === "WIZARD_DUPLICATE"`, one-directional by design; `verification_id` string retained), each pinned by a negative fixture case in BOTH languages. **RED observed first (3 failed / 6 passed) — and richer than predicted: N2 (`code:""`) was ACCEPTED pre-widening, proving invariant 1 is genuinely new teeth, not a trade.** ⭐ **The oracle is BIDIRECTIONAL, both directions observed first-hand:** neutering `_wizard_duplicate_reply` (`"code"`→`"codes"`) ⇒ pytest **2 failed** (*"only in reply: ['codes']; only in fixture: ['code']"*); neutering the predicate (`return true` first) ⇒ vitest **4 failed** (every negative wrongly accepted). Both restored from scratch copies OUTSIDE the repo, tree clean, `grep -rn MUTANT` → 0. `grep -c "vi.mock"` on the parity test → **0**. `src/app/api/strategies/finalize-wizard/route.test.ts:1819` (the "PYAPIFIX-01 — the INVERTED contract" test) **REWRITTEN not deleted** (59 → 61, 0 deleted) with TWO retained negatives. Coverage gate (OQ-6) settled by measurement: 84.36/78.37/81.43/86.49 vs 80/72/74/82; full frontend suite **8878 passed / 0 failed**; tsc 0; lint 0 errors. Python re-verified after the cycles: **4716/96/0**, mypy 89 files clean. Ledger reconciled: TS-01/TS-03 **DONE-IN-140.1.1**, TS-02 sharpened, TS-23 **UNBLOCKED**, TS-32 (M-4 ↔ TS-05 pairing) + TS-33 (M-11) added, 31→33, TS-04..22/24..31 byte-unchanged. **M-11 DECIDED, not implemented.** **WAVE 2 COMPLETE.**
- [x] 140.1.1-06-PLAN.md — PYAPIFIX-05 batch 1: survivors #1/#2/#6/#7/#12 + M-15 AST fence, mutation re-runs observed RED (wave 3) — **DONE** 2026-07-26, 3 commits `33f03757` (ccxt family) → `803198ec` (#6/#7/#12) → `0ff9446e` (M-15 AST fence). **6 mutation cycles / 8 runs, EVERY result OBSERVED FIRST-HAND — zero "asserted only" rows.** #1 `except ccxt.BaseError`→`NetworkError` ⇒ **3 failed / 5 passed** (`PermissionDenied must answer 424, got 500`); #2 →`ExchangeNotAvailable` ⇒ **6 failed / 2 passed** (`RateLimitExceeded must answer 424, got 500`) — both `assert 500 == 424`. The parametrisation straddles BOTH ccxt roots (7 subclasses) so no single narrowing satisfies it, with the non-ccxt `RuntimeError` control INSIDE the table so an `except Exception` widening also fails. #6 `"supabase": 15`→`900` ⇒ **4 failed / 0 passed** `assert '900' == '15'` at all four sites (≥1 red per file, targeted node ids only); the verbatim mt5-gateway idiom is now applied 4×. #7 `_KEK_ALERT_WINDOW_S 300.0`→`1e18` ⇒ **1 failed** `assert 1 == 2` — the test is now a **driven three-phase clock** (1 inside / still 1 inside / **2 after the LITERAL 300 s expires**), because the old free-running-clock count assertion was satisfied by any window longer than the test. #12 junk copy ⇒ **1 failed** — the human sentence is pinned by EQUALITY against a literal, the `!= AUTH_FAILED_DETAIL` guard kept. **M-15 DELETED** (`len(_SHAPES) == 6` against a same-file list literal, plus its false docstring) and replaced by an **AST-fingerprint SET** derived from `routers/process_key.py`'s own source — 8 fingerprints, never a count (C-20: the six was a coincidence of one collapse cancelling one expansion) — with a 200-capable filter (no `status_code=` or literal 200) that excludes the 401/403/422/**424** arms, asserted from both sides. **All three probes observed:** (a) a 7th 200 return ⇒ **1 failed / 16 passed** naming `dict:code,mutant,ok`; (b) 3 blank lines above the handler ⇒ **17 passed**; (c) `return JSONResponse(status_code=418, …)` ⇒ **17 passed**. Every restore from a `cp` scratch copy under `/tmp` — **zero** `git stash`/`git checkout`/`git clean`. Wave-3 gate: **4724 passed / 96 skipped / 0 failed** (4716 + 7 + 1, reconciles exactly), mypy --strict 89 files clean, **0** new `# type: ignore`, `grep -rn MUTANT` → 0, **zero production files modified**. **WAVE 3 COMPLETE.**
- [x] 140.1.1-07-PLAN.md — PYAPIFIX-05 batch 2: slowapi #3/#4/#5 on 0.1.10 + claim-parser #8-#11 (both #11 sites) + phase-wide gates (wave 4) — **DONE** 2026-07-26, 3 commits `b7e7023c` (#3/#4 behavioural) → `d5a49fef` (#5 tight band) → `39688d69` (#8-#11 new file). **8 mutation runs, EVERY RED OBSERVED FIRST-HAND — zero "asserted only", zero non-reddening findings. With batch 1 this is 13/13 phase-wide = ROADMAP criterion 5 COMPLETE.** ⭐ **slowapi synced 0.1.9 → the CI pin `0.1.10` BEFORE any #3/#4/#5 cycle** and both dependent internals re-confirmed on it (`if all(args)` empty-key skip at `slowapi/extension.py:506-527` — the pinned dependency's own source, `analytics-service/.venv/.../site-packages/slowapi/extension.py`, not a repo file; `view_rate_limit` = `(limit, [key, scope])` at `:530`); env left at 0.1.10. #3 `default_platform_key` → `return ""` ⇒ **3 failed / 65 passed** incl. **`never answered 429 within 4 calls`**; #4 → per-request `uuid4().hex` ⇒ **3 failed / 65 passed** incl. the stability assertion + the same missing 429. The old oracle was `assert _key_func is default_platform_key` — object IDENTITY, true for any body — so the new gate drives **real HTTP requests** through a throwaway app whose route declares NO `key_func` (no production route exercises the singleton default at all), decorated ONCE at module scope, bounded-and-driven; the identity assertion (`analytics-service/tests/test_limiter_identity.py:495`) is RETAINED. #5 `_retry_after_seconds` → `return 1` ⇒ **2 failed** — `0 < 1 <= 3600` passed the old bound, so a `> window * 0.9` band was added at **BOTH** weak sites (route A `/api/verify-strategy` AND route B `/api/csv/validate`, different routers), derived from the test-declared limit string, never from the function under test; mutation hits the computation (`analytics-service/main.py` — `_retry_after_seconds` :461-490), oracle reads the header (`:529`). **New file `tests/test_tenant_claim_parsing.py` (14 tests) — the four guards had NO test at all, not weak tests.** #8 drop the 512 bound ⇒ **2 failed** (`a 513-char claim was ACCEPTED` + `ran hmac.new 1 time(s)`) — ⚠️ the fixture is a **correctly-minted, VALID, merely oversized** 513-char claim because 513 chars of junk would NOT redden (rsplit raises, the never-raise except swallows it, `is None` holds either way); the spy substitutes rate_limit's `hmac` MODULE attribute, with a negative control asserting an ordinary claim reaches the MAC exactly once. #9 `rsplit`→`split` ⇒ **3 failed**; #10 drop the empty-payload guard ⇒ **3 failed**, mutant bucket literally `'claimtest:t:'`. **#11 closed 2 of 2**: `:333` ⇒ **1 failed** (the `:417` test GREEN), `:417` ⇒ **1 failed** (the `:333` test GREEN) — the asymmetry is the proof of independent coverage. Zero symbols imported from the module under test except the 3 functions under test; every expectation a literal or stdlib-minted. **PHASE-WIDE GATE (all five, first-hand):** pytest **4743 passed / 96 skipped / 0 failed** (4724 + 5 + 0 + 14, reconciles exactly) · collection **4837**, 0 errors, and the 4837-vs-4839 delta traced to 2 PRE-EXISTING module-level `allow_module_level` skips rather than assumed · `mypy --strict` **89 files clean** · `npx tsc --noEmit` **0** · full `npm run test:coverage` **8878 passed / 0 failed** (697 files) with all four thresholds clear · `npm run lint` **0 errors** · **0** new `# type: ignore` phase-wide · `grep -rn MUTANT` → 0 · **zero production files modified**. **WAVE 4 COMPLETE — PHASE 140.1.1 EXECUTION COMPLETE (7/7 plans).**

### Phase 140.2: SEAMCORE — Seam core & breaker correctness + harness integrity (INSERTED)

**Goal**: The breaker counts the failures it exists for, ignores the ones it must not, and every constant governing it is falsifiable
**Depends on**: Phase 140 (the core), Phase 140.1 (consumes its status contract — do not ship a discriminator against a contract 140.1 is changing)
**Requirements**: SEAMCORE-01..11
**Success Criteria** (what must be TRUE):

  1. A stalling upstream that returns headers fast and the body slow **records a failure** — the recording window covers the body read, and the deadline surfaces as a typed seam error, not a raw `DOMException`.
  2. A caller fault (malformed service URL, bad timeout override) and an exchange-attributable upstream error each record **zero** breaker failures; a genuine service fault records one — including when the body is `text/plain`.
  3. Mutating any breaker constant or any per-route timeout budget turns a test **RED**. Today 10 simultaneous semantic mutations produce a byte-identical pass; this criterion is the direct inversion of that.
  4. The breaker's Redis-side semantics (sliding-window decay, weighted carry-over, `nx` trip idempotency) are verified against **real Redis**, not a fixed-window fake that cannot execute the deployed Lua.
  5. A degraded or hung breaker store cannot hold a lambda past its declared budget, and the budget invariant accounts for store round trips in the closed, open and failing states.
  6. Adding an import to the shared error leaf, swapping a call site's budget key, or routing a health warmer through the core each fail a test — the structural invariants are enforced, not documented.
  7. **`analytics-client.ts` mints the `X-Tenant-Claim` header, flipping the SIX rekeyed Python routes reachable from that client — five live, one dead — from `platform:<path>` to genuine per-tenant throttling.** ⚠️ *Corrected 2026-07-27 by plan 140.2-09, which delivered it.* This criterion previously read **"flipping all nine rekeyed Python routes"**, which is false and was false when written. The behaviour-derived answer comes from a reproducible sweep — `grep -rn "key_func=partial(tenant_or_platform_key" analytics-service/routers/` → 9 sites, each route path then grepped across `src/` and the hit READ: **6 reachable** from `analytics-client` (`validate-key`, `encrypt-key`, `optimize-weights`, `portfolio-optimizer`, `portfolio-bridge` **live**; `portfolio-analytics` reachable but its wrapper `computePortfolioAnalytics` has **zero production callers**, so it flips a dead path) and **3 unreachable from that client by construction**: `fetch-trades` is reached only by an eslint-allowlisted debug raw fetch, and `csv/validate` and `verify-strategy` have their TS routes re-targeted to `/process-key` (which was already per-tenant since 140.1), leaving the Python routes of those names with zero TS callers. Those three are **unaffected** by TS-04 and need a separate owner if they are ever to be flipped. (Inherited obligation **TS-04** from Phase 140.1, which completed the Python half — the same key function provably returns `optimize_weights:t:<user>` the instant a claim appears, and the cross-language HMAC link is proven end-to-end. Until this lands, PYAPI-02's per-tenant guarantee holds for `/process-key` ONLY. ⚠️ *Corrected 2026-07-26:* the claimless arm at `analytics-service/services/rate_limit.py` — `_platform_bucket` :169-188 — is `platform:<path>` **per route**, so the nine sit in **nine separate** platform-wide buckets, not one shared one — exhausting `/api/optimize-weights` does not touch the other eight. Also **not a merge regression**: pre-phase these routes were IP-keyed behind Vercel egress NAT, i.e. already effectively platform-wide. TS-04 makes them better; its absence does not make them worse.) A test must prove a request from tenant A cannot consume tenant B's allowance on at least one of the nine. *Satisfied on all FIVE live routes, not the minimum one, by `src/lib/analytics-client.test.ts` — which drives each wrapper twice with two server-derived identities and reproduces the Python bucket decision (`verify_tenant_claim` + `tenant_or_platform_key`, transcribed by hand) to show `<scope>:t:tenant-a` vs `<scope>:t:tenant-b` rather than one shared `platform:<path>`. It also refuses the payload-splice forgery. The zero-signature-change shortcut — satisfying the clause via `runPortfolioOptimizer`/`findReplacementCandidates` alone, both of which already carried an actor id — was available and deliberately NOT taken: it would have left the two busiest key-connect endpoints and the 20/minute optimizer on a platform bucket.*

**Plans**: 12 plans / 12 waves (`workflow.use_worktrees=false`, so waves order the work sequentially on the main tree rather than parallelising it)

> ⚠️ **Was 14 plans / 14 waves.** On 2026-07-26, during the plan-checker review, the developer re-homed
> two consumer-surface plans to Phase 140.3: `140.2-12` → `140.3-01` (TS-05/08/09) and `140.2-13` →
> `140.3-02` (TS-02/11–15). Old plan 14 became plan 12 (wave 12). **This is a re-home, not a scope
> cut** — the work and its six Falsifiability Ledger rows (M51–M56) moved intact and are recorded in
> `140.3-CONTEXT.md`'s handover note. The 140.2 ledger is correspondingly **55 rows**, not 57.

Plans:

- [x] 140.2-01-PLAN.md — SRH spike, then the real-Redis lane + `frontend-seam-redis` CI gate, and the six mutation rows only that lane can observe (SEAMCORE-09 / SC4)
- [x] 140.2-02-PLAN.md — the literal-pinned constant + budget oracle, the route-row deep compare, **and cutting the self-referential fake at all 4 `fakeRatelimitFor` sites** (SEAMCORE-07 / SC3) — ✅ **both oracle layers closed; `opts.limiter.tokens` → 0 in src/; M14b measured 1-failed → 7-failed across the cut; 20/20 rows OBSERVED RED**
- [x] 140.2-03-PLAN.md — 13/13 budget-key pins **+ a roster mechanism that fails on a 14th**, leaf purity, warmer exclusion (SEAMCORE-08 / SC6)
- [x] 140.2-04-PLAN.md — fixed-point alias taint in `no-raw-analytics-fetch` + all four URL shapes (SEAMCORE-08)
- [x] 140.2-05-PLAN.md — the try block in ONE pass: body-read window, URL/deadline hoist, `redirect: "error"`, override validation (SEAMCORE-02, SEAMCORE-11 / SC1)
- [x] 140.2-06-PLAN.md — attributability discriminator + per-dependency breaker keying + OB-8 (SEAMCORE-01 / SC2)
- [x] 140.2-07-PLAN.md — bounded store, the A-09 sentinel, single-read breaker state, no-re-arm, store-aware budget arithmetic (SEAMCORE-03/04/05 / SC5)
- [x] 140.2-08-PLAN.md — the redaction leaf at 15 log sites + 10 Sentry captures, and the breaker transition event (SEAMCORE-06)
- [x] 140.2-09-PLAN.md — `X-Tenant-Claim` minted from `analytics-client`, five live routes flipped (SC7 / TS-04)
- [x] 140.2-10-PLAN.md — composite fan-out capped at the query; the budget table models the branch actually taken (SEAMCORE-10)
- [x] 140.2-11-PLAN.md — one defined outcome for non-JSON 2xx / 204 / 205 / 304 across both clients; `CircuitOpenError` validation (SEAMCORE-11)
- [x] 140.2-12-PLAN.md — the Falsifiability Ledger re-run at the final tree, phase gates, artifact reconciliation — **DONE** 2026-07-27. **56 rows re-executed at `48e6e3e2` (55 as planned + M19R), 55 RED and 1 GREEN.** ⚠️ **M19 (`nx: true → nx: false`) NO LONGER REDDENS** — wave 7's `existing.expiresAtMs > now` early return now fires ahead of the lock write, so a sequential second trip never reaches `set(..., nx)` and the flag became unobservable by R-3. The property (trip idempotency) is still enforced and is still falsifiable via the replacement row **M19R**, which was OBSERVED RED; the `nx` flag ITSELF is now unfalsified and is handed to Phase 141. **M14b's two-test receipt reconfirmed at the final tree** (pin + the behavioural trip-count case, 8 failures total) and all four `fakeRatelimitFor` sites re-verified by code text as taking the hand-typed default — the wave-2 cut held. Gates: coverage 84.57 / 78.52 / 81.78 / 86.68 vs 80 / 72 / 74 / 82 on 9303 passed / 287 skipped (724 files); `tsc` 0; `lint` 0 errors (cache cleared); real-Redis lane 7/7 with its executed-case fence matching; **zero `.py` in the phase diff**; zero new type suppressions; `SEAM_RETRIES` still 0.

*(Re-homed to Phase 140.3 on 2026-07-26: the former 140.2-12 → `140.3-01`, the former 140.2-13 → `140.3-02`. **This is a re-home, not a scope cut** — recorded here so the 14 → 12 drop is not read as work that was dropped.)*

#### Success-criterion adjudication — plan 140.2-12, 2026-07-27

Each verdict is backed by a named receipt observed first-hand at the final tree, or by an explicit
reason. A phase that reports 7/7 by softening a criterion is the failure this programme exists to end.

| SC | Verdict | Evidence |
|---|---|---|
| **SC1** | **SATISFIED** | `resilient-fetch.test.ts > headers arrive, the body then aborts ⇒ exactly ONE recorded failure and a typed SeamBodyReadError`. Falsifier **M26** RED at the final tree — 12 cases across 4 files, incl. `expected DOMException{…} to be an instance of SeamBodyReadError`. |
| **SC2** | **SATISFIED** | Six attributability-class cases in `resilient-fetch.test.ts` + 65 cases in `seam-discriminator.test.ts`. **Both** `text/plain` readings covered (500 ⇒ ZERO, 503 ⇒ ONE on the residual global key). Falsifiers **M25** (3 RED), **M38** (3 RED), **M35** (3 RED), **M39** (4 RED). |
| **SC3** | **SATISFIED** | 69 cases in `seam-constants.pin.test.ts`. **M1–M13 each RED individually**; **M14/M14b/M15/M16/M17** RED; **M24** RED. "Any breaker constant" verified by MEASUREMENT, not by reading the pin file: five supplementary probes beyond the ledger — `BREAKER_LOCK_TOMBSTONE_S`, `BREAKER_STORE_RETRIES`, `BREAKER_STORE_BACKOFF_MS`, `BREAKER_KEY`, `SEAM_RETRIES` — were each mutated and each reddened (3 / 6 / 4 / 3 / 16 cases). **All ten exported breaker and store constants are falsifiable.** |
| **SC4** | **SATISFIED — with one named residual, and adjudicated on evidence rather than on plan 140.2-01's memo.** | The SRH verdict was PASS-EVALSHA, so the PASS arm applies, and it was re-verified first-hand rather than inherited: the lane ran 7/7 against the two digest-pinned containers, its anti-vacuity fence (`EXPECTED_CASES = 7`) matched the 7 cases executed, and **seven mutations were OBSERVED RED against real Redis executing the deployed Lua** — M14 (R-2), M15 (R-5), M16 (R-7), M18 (R-4), M19R (R-3), M20 (R-1), M20R (R-1). Decay and weighted carry-over (M15/M16) and trip idempotency (M19R) are all falsified. ⚠️ **RESIDUAL, stated rather than absorbed: the `nx` flag named in the criterion's own wording is NOT itself falsified any more** (see M19 above). Trip idempotency is; the `nx` mechanism is NOT redundant and is NOT a second layer — it is ORTHOGONAL. The wave-7 early return requires the read to have SEEN a live lock; `nx` guards the case that return structurally cannot reach, namely two Fluid Compute instances that both read `null` and both write. (Wording corrected post-review per W-1: `140.2-VALIDATION.md` §8 called it "a real behavioural difference and a real open falsifier gap" and the ledger was right. **Closed in the review-fix pass** — the `staleReadOnce` hook in `resilient-fetch.test.ts` makes the concurrent read reachable and M19 (`nx: true → nx: false`) was OBSERVED RED again; the same pass also closed HI-01, the tombstone branch that had no exclusion at all, and W-2's `written`-gates-the-emit property.) ⚠️ **Also outside this phase's control:** the 140.1 review recorded `rulesets: []` on this repo — i.e. **possibly no branch protection at all**, which would make `frontend-seam-redis` a gate in the workflow that nothing enforces at merge, along with every other CI gate. **Recorded for the founder; not acted on.** |
| **SC5** | **SATISFIED** | 45 SC-4b cases (15 routes × 3 breaker states), each against the route's **on-disk** `maxDuration`. Falsifiers **M27** (1 RED — the A-09 sentinel), **M29** (1), **M30** (4), **M40** (2), **M41** (24 RED **including the OPEN state**, `expected 360750 to be less than 300000`). |
| **SC6** | **SATISFIED — and two clauses were ADDITIVE work, not tightenings.** | (a) leaf purity — **M21** RED; (b) warmer exclusion — **M23** RED (3 cases); (c) budget-key bindings — **M22** ×3 RED plus **M22b**, which reddens EXACTLY ONE assertion (the roster-completeness mechanism) while all thirteen individual pins stay green. ⚠️ **SC6's health-warmer clause had NO existing guard to extend** — ESLint sets `no-raw-analytics-fetch` to `"off"` on both warmer paths, so this phase BUILT that guard rather than tightening one. The phase is not credited with tightening something that did not exist. |
| **SC7** | **SATISFIED at the CORRECTED scope — 6 reachable / 5 live, not "all nine".** | The corrected wording is in place above (criterion 7), placed by plan 140.2-09 which delivered it, with the reproducible sweep recorded. Delivered scope is the honest one: **five live routes**, not the zero-signature-change shortcut via `runPortfolioOptimizer`/`findReplacementCandidates` that the literal wording would have permitted. Falsifiers **M28** (16 RED), **M44** (48 RED), **M45** (17 RED), **M46** (4 RED), including `two different tenants land in two DIFFERENT per-tenant buckets` and `a claim minted with the WRONG secret degrades to the platform bucket`. |

**Also stated rather than implied:** **SEAMCORE-06's "every Sentry capture" clause is ADDITIVE.** The
seam captured NOTHING to Sentry before this phase — `captureException` / `captureMessage` across the
core, both clients and the three seam routes is zero. Ten `captureToSentry` calls became safe by one
edit at the chokepoint. **No leak was plugged; a mechanism was built.** Falsifiers **M34** (6 RED),
**M33** (3 RED), **M42** (1 RED), **M43** (2 RED).

### Phase 140.3: SEAMUX — Client & wizard seam error surface (INSERTED)

**Goal**: When the seam fails, every surface says something true, offers a way forward that isn't destructive, and tells us it happened
**Depends on**: Phase 140.2 (renders the error TYPES that phase owns), Phase 140.1 (codes originate there)
**Requirements**: SEAMUX-01..09
**Success Criteria** (what must be TRUE):

  1. With the breaker open, every seam-touching surface renders the breaker's own copy — not "our team has been notified", not "we fetched your trades", not "check your credentials", not "validation failed" with zero rows. No surface asserts work happened, or didn't, that the client cannot know.
  2. Drift between any two production copies of a seam error string fails a test; a code emitted by a route is a code the wizard classifier recognises.
  3. Every seam call site fails on an unrecognised or unparseable body rather than treating it as success — in particular, an unrecognised 200 never starts a poll for a job that was never enqueued.
  4. A recoverable seam error always offers a retry; that retry is never the only route to a destructive control (**TRAP-4** — five clicks of our own copy must not destroy a composite draft); `Retry-After` is honoured for the breaker's 503, not only for 429.
  5. A publish or permission gate fed by a drifted analytics response **fails closed** — a key holding trade/withdraw scope can never publish as read-only-verified.
  6. Funnel events carry the specific error code (an outage is distinguishable from a bad file) from every wizard variant, and failures reach Sentry wherever the copy claims they do.
  7. **A failed recompute never leaves the previous result on screen as if it were current.** With suggestions already loaded and the seam then failing, no ranked allocation, weight set or candidate list remains rendered with live action controls — the money-decision hazard B-26 documents, whose fix shape already exists in `WeightOptimizerSection.tsx`.

**Plans**: 17 plans / 16 waves (waves are sequential — `use_worktrees` is false, so they express dependency order, not parallelism). Plans 01 and 02 were re-homed from 140.2 on 2026-07-26; 03–16 planned 2026-07-27. Plan 13 was split into **13a + 13b** at revision round 2 (both wave 13, sequential) — a context measure, never a scope reduction. ⚠️ **This phase's own planning pass must start numbering at `140.3-03`** — slots 01 and 02 are taken. See `140.3-CONTEXT.md`'s handover note for the six ledger rows (M51–M56) and the two hard cross-phase prerequisites that arrived with them.

Plans:

- [x] 140.3-01-PLAN.md — the three Class-5 `typeof body.detail` sites × two contracts; two `WizardErrorCode` union members (TS-05/08/09) — *re-homed from 140.2-12; needs `seam-discriminator.ts` from 140.2-06.* ⚠️ **AMENDED 2026-07-27 at the planning gate:** the membership was a DIFFERENT 3 — `ScenarioCommitDrawer.tsx` dropped (correction C-2: gated on `409/portfolio_fingerprint_stale`; its route imports no seam module), `PortfolioImpactPanel.tsx` added (C-3: a real member, and the file the plan wrongly cited as the safe template). `STATUS_CONTRACT.md` §2.1 corrected in the same task; M51 re-pointed.
- [x] 140.3-02-PLAN.md — `/process-key` consumers branch on `ok`; `X-User-Access-Token` forwarded and scrubbed (TS-01/02/11/12/13/14/15) — *re-homed from 140.2-13; needs `seam-redaction.ts` from 140.2-08 (a SAFETY ordering: the token is a live user JWT)*
- [x] 140.3-03-PLAN.md — the fail-CLOSED publish gate at **both** members of the unchecked-cast class (`finalize-wizard` + `keys/[id]/permissions`, which caches its unvalidated verdict for 60 s) — SEAMUX-07. *Scheduled at the earliest free wave: a security gate, not error rendering.*
- [x] 140.3-04-PLAN.md — `src/lib/seam-copy.ts` leaf + purity guard + cross-copy pin; all 10 production emitters re-pointed; **the 12 test literals deliberately untouched (C-1 / TRAP-9)** — SEAMUX-01
- [x] 140.3-05-PLAN.md — `CIRCUIT_OPEN` becomes a first-class code at `SubmitStep`; `classifyKeyValidationError` reads `body.code` above the cascade; the S-5 parity test (TS-35) — SEAMUX-01/02/08
- [x] 140.3-06-PLAN.md — **THE PHASE'S ONLY PYTHON EDIT.** `400 → 424` at all 7 `VenueTransientHTTPException` sites + fixture + `EXPECTED_STATUS` in one commit (TS-32). Gated by `mypy --strict` + `pytest`.
- [x] 140.3-07-PLAN.md — discard the invalidated result at **both** live B-26 members (`PortfolioOptimizer`, `KeyPermissionBadge`) + `ReplacementPanel` pinned negatively — SEAMUX-09
- [x] 140.3-08-PLAN.md — observe the HTTP outcome at every seam call site (`ApiKeyManager` ×2, `AllocatorMatchQueue`, `WeightOptimizerSection`); kill the `SUPABASE_SERVICE_ROLE_KEY` copy — SEAMUX-05
- [x] 140.3-09-PLAN.md — **PLUMBING first**: a wait field on `WizardErrorContext` and `ErrorEnvelope` (SC4 is unrepresentable today); `Retry-After` honoured for the breaker's 503; TS-34's status half — SEAMUX-06
- [x] 140.3-10-PLAN.md — **the C-8 unit as ONE task**: codes on `keys/sync`'s five arms + the TRAP-3-live transport split + TRAP-4's confirmation. Table-wide TRAP-4 guard — SEAMUX-03/06
- [x] 140.3-11-PLAN.md — TS-19 (both admin routes stop flattening) then TS-18 (render the 424 as a named, recoverable venue state) — SEAMUX-03/04
- [x] 140.3-12-PLAN.md — the copy honesty pass: **7 false-claim strings across 5 codes** (2 more than any source document listed) + TS-09's real copy + TS-17 — SEAMUX-04
- [x] 140.3-13a-PLAN.md — funnel specificity at every wizard variant (`MultiKeyConnectStep` emits nothing today) + **decides the ONE capture policy** + Sentry at 4 of 9 routes (admin/match ×2, `keys/[id]/permissions`, `verify-strategy`) — SEAMUX-08
- [x] 140.3-13b-PLAN.md — the SAME policy applied verbatim at the remaining 5 routes (strategies ×3, `portfolio-optimizer`, `scenario/optimize`) + the **joint 9-of-9 audit** and the mutations — SEAMUX-08. *(13a+13b are a CONTEXT split of one plan, both at wave 13, sequential via `depends_on`; the 9-of-9 obligation is held jointly and neither half may close SEAMUX-08 alone. ⚠️ `csv-validate`'s test lives at `src/__tests__/csv-validate-route.test.ts`, not beside its route.)*
- [x] 140.3-14-PLAN.md — TS-37 (1 of 4 `COMPOSITE_MEMBERSHIP_UNKNOWN` arms gets a permanent code, `KNOWN_FINALIZE_CODES` same commit) + TS-33 (`wizard_session_id`, ONE field) — SEAMUX-03/04
- [x] 140.3-15-PLAN.md — TS-38 (`SEAM_MISCONFIGURED` stops wearing the upstream's envelope) + TS-20 (`correlation_id` reaches the render slot) — SEAMUX-03/04
- [x] 140.3-16-PLAN.md — **phase gate**: negative pins on the four already-strong properties; all 26 ledger rows re-run at the FINAL tree; 7 criteria / 9 requirements / 19 obligations adjudicated. Has a blocking human checkpoint (copy vs DESIGN.md; the destructive path proven in a real flow).

**Gap-closure series** *(added post-VERIFICATION, `gap_closure: true`; these 8 plans were executed and summarised but had no rows here until the 2026-08-01 close-out — the work itself is described in this phase's milestone-list entry above. There is no G3.)*

- [x] 140.3-G1-PLAN.md — poll-disjointness re-tiering + guard registration
- [x] 140.3-G2-PLAN.md — SC2 residual adjudication + the stale-count class
- [x] 140.3-G4-PLAN.md — SEAMUX-03 coded arms on the key-verification route surface
- [x] 140.3-G5-PLAN.md — SEAMUX-03 coded arms on `scenario/optimize` + simulator
- [x] 140.3-G6-PLAN.md — `/api/bridge` (9 arms) + `/api/portfolio-optimizer` (9 `code:` sites), incl. the B-26 money-bearing arm
- [x] 140.3-G7-PLAN.md — `/api/strategies/csv-validate` **wire audit**: found ZERO codeless arms (already coded positionally via `csvErrorBody`) — measurement, not a rewrite
- [x] 140.3-G8-PLAN.md — both admin match routes: `admin/match/eval` 0→6 coded arms, `admin/match/recompute` 0→10 incl. 2 coded deny bodies
- [x] 140.3-G9-PLAN.md — `/api/admin/strategy-review`, the TENTH route the VERIFICATION's nine-route list MISSED (instance-not-class): 0→27 coded arms

### Phase 140.4: SEAMRIM — close the wizard/client rim the core fix left open (INSERTED)

**Goal**: The surfaces stop asserting things we did not measure, stop offering a destructive control as the way forward, and stop attributing our own faults to the user or their venue — and the guards that claim these classes are closed can actually fail.
**Depends on**: Phase 140.3 (renders the error types; this phase closes the rim 140.1-140.3 left open)
**Requirements**: SEAMRIM-01..NN (to be derived at planning from `.planning/reviews/140-SYNTHESIS.md`)

**Why this phase exists**: the end-of-milestone review (14 registers, 5 specialists + 7 red teams + 2 mutation samples, `.planning/reviews/`) adjudicated all 94 original Phase-140 findings at HEAD: **58 CLOSED / 26 PARTIAL / 8 OPEN / 2 SUPERSEDED**. Cluster A (seam core) has **zero OPEN**; cluster B (wizard/client) is 10 CLOSED against **14 PARTIAL + 4 OPEN**. Two independent mutation samples (28 mutations) measured **93% of sampled CLOSED verdicts genuinely guarded** — so the core is real and the rim is where the work is.

⚠️ **The coverage law governs planning** (measured across everything since Phase 140):
| fix mechanism | measured coverage |
|---|---|
| forced through a shared artefact (chokepoint / leaf / table / component) | **100%** |
| hand-typed roster or allow-list | 9/37 codes · 8/15 files · 2/3 codes |
| per-site edit, no artefact | 1/8 · 2/56 · **0/32** |
Any remedy landing in row 2 or 3 is **partial by construction** and must say so.

**Plans:** 14 plans in 4 waves

Plans:

- [x] 140.4-01-PLAN.md — C-3a: `strategyGate` refuses an unrepresentable span (row 1, both consumers) + the admin publish route's 7 unchecked reads — SEAMRIM-01 *(wave 1)*
- [x] 140.4-03-PLAN.md — C-2: the CSV double-submit — a `(user_id, wizard_session_id, source)` partial index, the CSV writer, the SQL receipt with its cross-source control, the 23505 arm, the copy — SEAMRIM-03 *(wave 1)*
- [x] 140.4-04-PLAN.md — the raw-5xx `ast` census (12 sites / 9 triples) against a multiplicity-preserving quarantine; re-runs the mutation that was GREEN — SEAMRIM-09 *(wave 1)*
- [x] 140.4-05-PLAN.md — a visually-inert `<LiveRegion>` primitive + the 3 measured-regressing surfaces (3 of 27, partial by construction) — SEAMRIM-10 *(wave 1)*
- [x] 140.4-02-PLAN.md — C-3b: the wizard's 7 unchecked gate reads + a runtime receipt that read-failed ≠ genuinely-empty — SEAMRIM-02 *(wave 2)*
- [x] 140.4-06-PLAN.md — C-5a: `captureToSentry` returns its promise (copy `audit.ts`), `after()` at the breaker's three sinks, the limiter's timeout sentinel recorded — SEAMRIM-04 *(wave 2)*
- [x] 140.4-07-PLAN.md — scrub tail A: `keys/sync` (6), `csv-finalize` (6), `verify-strategy` (3) = 15 sites — SEAMRIM-06 *(wave 2)*
- [x] 140.4-08-PLAN.md — scrub tail B: the remaining 6 import-edge routes (12 sites) + `ratelimit.ts`'s Upstash-token log — SEAMRIM-06 *(wave 3)*
- [x] 140.4-09-PLAN.md — C-1 (LOW): `csv-validate`'s static 502 + the text-carrying-channel alias rule + the thrown twin — SEAMRIM-06 *(wave 3)*
- [x] 140.4-11-PLAN.md — C-4: the destructive control must be EARNED — invert the roster into a property (verified count is 1, not 9) — SEAMRIM-07 *(wave 3)*
- [x] 140.4-14-PLAN.md — the `no-unchecked-supabase-read` ESLint ratchet, scoped to the proven-clean glob — SEAMRIM-11 *(wave 3)*
- [x] 140.4-10-PLAN.md — derive `SEAM_FILES` from the IMPORT EDGE + `derived == SEAM_ROUTE_BUDGETS` + registry rows and floor — SEAMRIM-06 *(wave 4)*
- [x] 140.4-12-PLAN.md — the wire↔render vocabulary: translation becomes authoritative; the nested envelope is read — SEAMRIM-08 *(wave 4)*
- [x] 140.4-13-PLAN.md — C-5b: adopt `rateLimitDenyJson` at the 12 seam call sites + a derived-population posture guard — SEAMRIM-05 *(wave 4)*

### Phase 140.5: SEAMPROSE — attribution copy, harness fidelity, and prose/citation truth (INSERTED)

**Goal**: What the codebase SAYS about itself is true — in user copy, in comments, in citations, and in the tests that stand in for the contract — so the next phase can trust what it reads.
**Depends on**: Phase 140.4 (SEAMRIM closes the behavioural rim; this closes the descriptive one)
**Requirements**: SEAMPROSE-01..NN (derive at planning from `.planning/reviews/140-SYNTHESIS.md` WP-3, WP-10, WP-12, WP-13, WP-14, WP-15)

**Why this phase exists**: 140.4's planner audited its own source coverage and found six in-scope items it could not fit without recreating the context pressure that forced 140.3's 13a/13b split. **Not a difficulty judgement** — none lacks information or has a dependency conflict. They share almost no files with 140.4's waves, and file-disjointness is what made 140.1–140.3 independently plannable.

**Carried scope:**

1. **The comment/citation-rot class** (CONTEXT §6 of 140.4 named it IN SCOPE; moved here deliberately) — 881 citations, 18 provably past-EOF (15 in two files outside these phases); `keys/[id]/permissions` documents *"5 minutes"* vs `revalidate: 60`; `sentry-capture.ts` claims *"the seam captures nothing to Sentry"* when it is **41 sites across all 15 routes**; the contract registry says *"exactly three predicates"* (five) and *"the six seam files"* (eight, and the guard's own docblock says EIGHT). ⚠️ **7 of 17 comment findings were 140.2 comments falsified by 140.3 commits in the same range** — no phase re-measures what its predecessor wrote down.
2. ⭐ **`Retry-After` travels** — honoured at **1 of 4** surfaces; chokepoint is `process-key-client`, then 5 `buildEnvelope` threads. **HARD PREREQUISITE FOR PHASE 141** — retry-with-backoff consumes `Retry-After`, so 141 must not land on plumbing that reaches one surface in four.
3. `SERVICE_UNREACHABLE` at the three transport catches; the dead `"timed out"`/`"timeout"` branch (**B-02, a confirmed OPEN finding** — the commonest Railway outage still renders `UNKNOWN`); `fetchLivePermissions` carrying `{status, code, retryAfterSeconds}`; `PERMISSION_DENIED` + scope codes in `VENUE_WIRE_CODE_TO_VERDICT`.
4. Harness fidelity: `vi.unstubAllGlobals()` + env snapshot in `src/test-setup.ts`; `ci.yml`'s skip regex; `/\bimport\s*\(/` in the four purity pattern sets.
5. `mintTenantClaim(payload: string, secret: string)` — two adjacent same-typed strings (**latent type hazard, NOT a live attacker path** — orchestrator-resolved); `probe_error: z.boolean()`; `SeamBreakerVerdict` as a discriminated union.
6. Test fidelity: the six wrong 429 shapes, the `500 + retryable:true` body `_validate` refuses to construct, the 424 tested where it cannot arrive.
7. ⭐ **DEF-140.4-C — forwarded upstream 4xx renders as "your CSV is invalid"** (`.planning/phases/140.4-*/deferred-items.md`). Found in a **live browser QA pass** (2026-07-29) uploading a real founder CSV, and independently rediscovered server-side by 140.4's code reviewer as CR-02. The fix round closed the **502** arm and the duplicated title/body (`src/app/(dashboard)/strategies/new/wizard/steps/CsvValidationEnvelope.tsx` — heading render :162-166, cause render :167-168 — rendered `human_message` as heading AND cause when `errors.length === 0`). **Still live: the `!result.ok` arm forwards upstream verbatim, so a 401 — and equally 403/404/409 — lands on `CSV_VALIDATION_FAILED`.** Deliberately not point-fixed in 140.4: this is the instance-not-class shape that phase exists to stop. Close it as ONE rule over every forwarded upstream status. Also open on the same panel: the copy promises a per-row breakdown that does not render when there are no row-level errors.
8. **The plan-to-plan hand-off hole, twice in 140.4** — a defect class this phase should consider guarding, not just fixing. `SEAM_MISCONFIGURED` reached two wizard clients as `UNKNOWN` because plan 12's GREEN landed before plan 13's and neither plan's `## OPEN` named it; `eslint.config.mjs:175-181` still cited a blocker plan 12 had already removed (measured 0 violations). Both are "plan A's premise falsified by plan B in the same phase, with no re-measurement." Note the fixer's own residual: **no guard asserts that every wizard client consuming a `rateLimitDenyJson` route consults the shared wire→wizard table**, so the hole reopens at whichever client lacks the hop.

**Binding inheritance**: 140.4's CONTEXT §2 (coverage law) and §3 (a grep proves a state; only a guard proves it is held) apply unchanged.

⚠️ **Two false premises 140.4 left corrected — do not re-derive them from stale docblocks**: (a) the wire→wizard table and the client rosters are **NOT disjoint** — `KNOWN_KICKOFF_CODES` shares `RATE_LIMITED` — so the safety property is **agreement**, not disjointness; (b) `VALIDATION.md`'s "no guard to falsify" claim for the thrown twin was false (row M109), and the surviving "no row possible" count is **two**, not three.

**Plans:** 8/8 plans complete

Plans:

- [x] **W1** · 01 — harness fidelity flip + `source-scan.ts` + purity needles *(lands ALONE: the leak closure is TRAP-8 sequence-sensitive, and it creates the comment-handling module every later guard imports)*
- [x] **W2** · 02 — `wizardErrors` vocabulary owner + B-02 + venue codes *(publishes the §4a interface plan 05 consumes)*
- [x] **W2** · 03 — `Retry-After` travels + `SERVICE_UNREACHABLE` at all five transport catches ⭐ *HARD PREREQUISITE FOR 141*
- [x] **W2** · 04 — citation/prose corrections, repo-wide
- [x] **W3** · 05 — the CSV class fix ⭐ *DEF-140.4-C and the §6 hand-off hole closed as ONE defect at row 1*
- [x] **W3** · 06 — test fidelity + spec-disabling guard
- [x] **W3** · 07 — type invariants
- [x] **W4** · 08 — seam-surface conversion remainder + the citation guard + ALL guard registrations + phase gate *(guard lands AFTER conversions — "fix before guard"; single owner of `contracts-registry.test.ts`, which kills the same-wave floor-bump conflict that made plans 10 and 13 collide in 140.4)*

### Phase 141: SEAM — Retry-with-backoff, gated on the idempotency audit

**Goal**: Transient Railway blips self-heal — but ONLY for calls with a traced idempotency proof, so a retry can never double-execute a side effect
**Depends on**: Phase 140 (retry must respect the breaker and use the unified budgets)
**Requirements**: SEAM-05, SEAM-06
**Success Criteria** (what must be TRUE):

  1. A committed in-repo audit artifact maps every seam function and `/process-key` `flow_type` to retry-safe yes/no with traced server-side side-effect evidence — including the previously-unaudited `recomputeMatch` / `computePortfolioAnalytics` / optimizer / simulator / bridge set — and resolves whether `_get_recompute_lock` is distributed or process-local. Everything unproven defaults to no-retry.
  2. Under an injected single transient failure, an allowlisted call (e.g. `flow_type: resync`) succeeds on retry with exactly ONE server-side effect — proven against the real `compute_jobs` partial-unique-index + `WIZARD_DUPLICATE` contract.
  3. `flow_type: teaser` is provably never retried, and a regression test pins the contract (two identical teaser calls → TWO `strategy_verifications` rows) so a future refactor can't quietly start retrying it and minting duplicate verifications/`public_token`s/leads.
  4. With the breaker open, zero retry attempts fire — no bypass path exists, so retries cannot amplify an outage.

**Plans:** 4/4 plans complete

Plans:

- [x] **W1** · 141-01-PLAN.md — Python resync draft-SV dedup + DB proofs (SQL compute_jobs/SV-index gate, teaser two-rows pytest pin) ⭐ *the LOCKED precondition for allowlisting resync*
- [x] **W1** · 141-02-PLAN.md — retry loop + `retriesOverride` in `resilientFetch` (dormant: all rows stay 0), dual breaker gates, SC-4 mutation observed
- [x] **W2** · 141-03-PLAN.md — `seam-retry-registry.ts` leaf: the SC1 audit = the runtime allowlist (13 evidenced verdicts, absence ⇒ no-retry), SC-1 mutation observed
- [x] **W3** · 141-04-PLAN.md — wire both clients (flow_type-keyed, explicit `?? 0` belt), flip 5 rows + edit pins SAME commit, SC-4b charges backoff+jitterMax, SC-2/SC-3 mutations + phase gate

### Phase 141.1: SEAMBACKOFF — Retry-After-aware backoff, breaker recalibration, and SEAM-05 evidence re-derivation (INSERTED)

**Goal:** The retry honours the upstream's own `Retry-After` contract (built by 140.5, never consumed), the breaker threshold is a decided number under per-attempt counting, and the SEAM-05 audit artifact's evidence is re-derived from traced source so the documented audit and the runtime allowlist cannot drift. Scope from the 8-agent review campaign over 141 — see `141-REVIEW-CONSOLIDATED.md`. **Zero user-facing and zero data-integrity defects were found; no retry verdict changes and no budget row is un-flipped.**
**Requirements**: SEAM-05, SEAM-06 (evidence + guard repair; coverage tracked by decision ID D-01…D-20 from 141.1-CONTEXT.md)
**Depends on:** Phase 141
**Plans:** 9 plans

Plans:

- [x] **W1** · 141.1-01-PLAN.md — D-01 `Retry-After` fail-fast (SC-C/SC-C′) + D-02 threshold ratified (docblock + derived pin)
- [x] **W1** · 141.1-02-PLAN.md — D-03/D-04/D-05 evidence re-derived from traced source + D-06 both citation guards (SC-G/G′/H/H′, roster 34→35)
- [x] **W1** · 141.1-03-PLAN.md — D-14c `status='draft'` behaviour pin in Python tests (SC-P; OQ-2 decided: tests outside the fence)
- [x] **W2** · 141.1-04-PLAN.md — D-08 required `retriesOverride: 0 | 1`, fallback dropped (SC-E) + D-07 false prose corrected post-D-08
- [x] **W2** · 141.1-05-PLAN.md — D-11 frozen `as const satisfies` maps + real exhaustiveness + never-defaulted `budgetKeyFor` (SC-I)
- [x] **W3** · 141.1-06-PLAN.md — D-17 logging both silent arms (SC-M/M′ credential-negative) + G2 decodeBreakerLock bounds + D-12/D-13/D-10/D-14d headline mutations (SC-A/B/D/O)
- [x] **W3** · 141.1-07-PLAN.md — D-09 census retry axis (SC-F) + D-14a/b class-γ 3/3 + pins (SC-J/K) + D-15 per-leg SC-4b recharge (SC-L, 56,000ms)
- [x] **W1** · 141.1-08-PLAN.md — D-16 flag-monitor repair: numerator was structurally DEAD (OQ-1 resolved by probe) — rebuild on indexed fields + distinct-correlation_id denominator + anti-`path:` recurrence guard (SC-N strengthened)
- [x] **W4** · 141.1-09-PLAN.md — D-18 seam-breaker runbook + D-19 TODOS ledger (G1–G4 explicit, H1–H7) + D-20 ship-time 0.51.0.0 bump

### Phase 141.2: SEAMFIX — close the 141.1 code-review findings: duplicate onboard verification write, flag-monitor denominator integrity, breaker re-arm (INSERTED)

**Goal:** Close the 13 verified findings from the xhigh code review of 141.1 (30 agents, 25 findings deduped to 13). Two are the priority. **(A) A duplicate WRITE on the money path:** `onboard`'s retry grant rests on `idempotent_by_session`, but `finalize-wizard` omits `wizard_session_id` when `strategies.wizard_session_id` is NULL — nullable by design — so the Python side mints a fresh `uuid4()` per attempt, the unique constraint cannot collide, and ONE user submit inserts TWO `strategy_verifications` rows on a flow the registry marks retry-safe. **(B) The D-16 flag-monitor denominator rewrite shipped three monitoring-integrity regressions in one change** — an unbounded `.select()` PostgREST silently truncates at `max_rows=1000` (HTTP 200, `error: null`); dedup keyed on the attacker-controllable inbound `X-Correlation-Id` reachable via the UNAUTHENTICATED `/api/verify-strategy`; and a dedup that collapses nothing on the only two retry-eligible flows, because the service re-mints a uuid4 whenever the inbound id is not a bare UUID and `wizardFetch` sends `wizard:<uuid>`. 141.1 repaired an alert that never fired and replaced it with one that can be silenced, saturated, or falsely triggered.
**Requirements**: SEAM-05, SEAM-06 (defect closure — the audit's retry verdicts and the alert that watches them; ⚠️ unlike 141.1, this phase DOES change a retry verdict or add a guard, see findings 1 and 6)
**Depends on:** Phase 141.1
**Plans:** 6 plans

⚠️ **Evidence:** `141.2-FINDINGS.md` in the phase dir holds all 13 with per-finding
failure scenarios (inputs → wrong outcome). Two scoping notes there are SUPERSEDED:
research proved findings 10–11 were INTRODUCED by 141.1 (`f308b460`, single-commit
`git log -S`) — finding 10 is the phase's top priority — and the founder ordered all
13 fixed in code, including 12–13 (`141.2-CONTEXT.md` D-05 + ⚠️ RESEARCH CORRECTIONS).

⚠️ **That sentence records the INSTRUCTION, not the outcome.** As shipped: **twelve
remediated, one dispositioned.** Finding 8 (retry → limiter amplification) was accepted
rather than fixed — no limiter code changed, and the amplification is still live; the
re-raise conditions are on `retriesForFlow` and in `TODOS.md`. Do not restate this phase
as "all 13 fixed in code".

Plans:

- [x] 141.2-01-PLAN.md — breaker cluster: corrupt-lock write path arms (f10, REGRESSION), absolute epoch bound (f11), per-attempt admission (f5)
- [x] 141.2-02-PLAN.md — resync verdict map move to NO (f6) + pin surgery + Python comment-only DEF-141.1-02-A
- [x] 141.2-03-PLAN.md — flag-monitor denominator: counting form, attempt grain, fail-loud read error (f2,f3,f4,f7,f12)
- [x] 141.2-04-PLAN.md — Retry-After parsed, not presence-tested (f9)
- [x] 141.2-05-PLAN.md — onboard retry conditional on idempotency-key presence at the chokepoint (f1)
- [x] 141.2-06-PLAN.md — delete the unfalsifiable pin (f13), runbook rewritten once, D-07 recorded, D-08 changelog corrected

### Phase 142: JOB — strategy_analytics stuck-computing reaper + computing_started_at DDL

**Goal**: A mid-job worker crash can no longer strand a `strategy_analytics` row on `computing` forever — a wizard poll or page refresh sees a real terminal outcome
**Depends on**: Phase 141 (SEAM error taxonomy informs re-enqueue-vs-terminal decisions; JOB sequenced after SEAM)
**Requirements**: JOB-01, JOB-02, JOB-03, JOB-07
**Success Criteria** (what must be TRUE):

  1. A `strategy_analytics` row stuck in `computing` past the derived threshold with NO active `compute_jobs` row is transitioned by a recurring pg_cron reaper to a TERMINAL `failed` state carrying a user-recoverable message — superseding the one-off `reset_stuck_computing_rows.py` script.
  2. A row with a fresh `updated_at` but an old `computing_started_at` IS reaped, and a row with an old `updated_at` but a fresh `computing_started_at` is NOT — proving the reaper keys on the dedicated writer-stamped `computing_started_at` (set in the SAME statement that sets `computation_status='computing'`), never the 106-janitor-revert `updated_at`/`computed_at` mistake.
  3. A CI invariant (mirroring `test_every_kind_has_watchdog_headroom`) fails if any relevant handler's batch-inclusive worst case exceeds the reaper threshold — the threshold is re-derived from `strategy_analytics`'s own batch-tail math, never copied from the `compute_jobs` 4h number.
  4. A large synthetic backlog does not stall worker `healthz` past `STALE_THRESHOLD` — the JOB-07 regression test proving no reaper/sweep work runs on the worker's shared asyncio event loop (the WEDGE-01 crash class this janitor exists to clean up after).

**Plans**: 6 plans

Plans:
**Wave 1**

- [x] 142-01-PLAN.md — JOB-03 Python side: JOB_CHAIN_FOLLOW_ON topology (enqueue sites read it) + canonical reap-threshold constant + TestReaperThresholdInvariant (wave 1)
- [x] 142-02-PLAN.md — JOB-07 structural gate + healthz blocking-vs-yielding control pair; delete broken reset_stuck_computing_rows.py + stays-absent gate (wave 1)
- [x] 142-06-PLAN.md — JOB-01 row type: StrategyAnalytics.computing_started_at (string | null, never optional) + EMPTY_ANALYTICS + 7 fixture files — the checker-measured 8-file compile blast radius (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 142-03-PLAN.md — JOB-01 app writers: stamp W1 + clear 11 Python & 4 TS exit sites, D.10 census, two-runtime stamp CI gate (wave 2)
- [x] 142-04-PLAN.md — migration 20260802120000: DDL + backfill + index + re-based bridge (conditional stamp) + inline pg_cron reaper; SQL↔Python drift gate (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 142-05-PLAN.md — SQL gate (ungated structural + behavioral arms), [BLOCKING] MCP apply to TEST, ledger mutations SC-1/1b/2/2b, phase gate (wave 3)

**Note**: JOB-07 is a cross-cutting constraint — Phases 143/144/145 must also keep their mechanisms off the worker loop (pg_cron by construction), but the REQ-ID and its regression test land here only.

### Phase 142.1: Close 142 review findings: chain-start stamp preservation, deploy sequencing, terminal-writer parity (INSERTED)

**Goal:** Close the 16 items raised by three independent passes over Phase 142 (high-effort workflow review, blind `gsd-code-reviewer`, and the `gsd-verifier` goal-backward pass that had never run) — so that the reap clock genuinely measures the whole job chain, no terminal writer can launder a failure into a green factsheet, the `sql-function-snapshot` CI gate is green again, and Phase 142's own falsifiability evidence is complete rather than 4/11.
**Requirements**: JOB-01, JOB-02, JOB-03 (remediation of Phase 142 delivery; no new REQ IDs)
**Depends on:** Phase 142
**Plans:** 8/8 plans complete

**Scope + per-item failure scenarios:** `.planning/STATE.md` § "Phase 142.1 scope".
**Evidence:** `142-VERIFICATION.md` (status `gaps_found`, 9/10), `142-REVIEW.md` (0 blockers, 4 warnings).

⚠️ **Phase 142's goal IS achieved** — all four of its ROADMAP success criteria hold behaviourally, proven by executing the real cron body against a throwaway PostgreSQL 16. 142.1 is remediation, not a rescue.
⚠️ **Item 12 is a hard-red CI gate** (`npx tsx scripts/dump-sql-functions.ts --check` exits 1) and is a one-command fix — do it first.
⚠️ **Items 1, 2 and 16 are orchestrator-only** — they need TEST-DB access, and MCP tools are stripped from subagents.

Plans:
**Wave 1**

- [x] 142.1-01-PLAN.md — D-12 run 1 (FIRST commit, clears the hard-red snapshot gate) + D-13 JOB-03 text + D-14 ledger backfill + DEF-142.1-08 deferral

**Wave 2**

- [x] 142.1-02-PLAN.md — test hygiene: D-10 shared _scan_helpers (union surface), D-06 wall-clock deletion, D-09 backlog=0, D-15 arity hoist + new pytest
- [x] 142.1-03-PLAN.md — CI hardening: D-05 neutralizers DELETED — isolation by construction (D-18) + shared-test-db group + one-rule grep gate; D-02/R1 fail-loud migrate + YAML pins

**Wave 3**

- [x] 142.1-04-PLAN.md — stamp-gate rework: D-07 soften raise arms, D-04 widen TS census, D-03 terminal-warned parity + csv-finalize one-line fix
- [x] 142.1-05-PLAN.md — migration 20260803120000: D-17 BEFORE UPDATE trigger (D-18) + D-11 companion arm (arm D inverted + Part 4 retrofit + drift gate/comments re-pointed SAME commit) + D-12 run 2

**Wave 4**

- [x] 142.1-06-PLAN.md — D-01 comment correction + D-02/R2 PGRST204 fallback in _mark_unrecoverable (after D-07, per C-12)
- [x] 142.1-08-PLAN.md — SQL gate Part 6 (G1 trigger sentinel, seeds at INSERT per D-18; grep-gate pin 0→3)

**Wave 5**

- [x] 142.1-07-PLAN.md — [BLOCKING, orchestrator-only, autonomous:false] MCP apply to TEST + D-01/D-02 TEST confirmations + D-16 end-to-end gate run + ledger consolidation

### Phase 142.2: Get MetaTrader 5 running end to end on the unified backbone (INSERTED)

**Goal:** A founder can connect a real MetaTrader 5 account through the wizard and reach a rendered strategy — key → dailies → backbone → UI — with no step requiring a human to know an internal error code, a server name, or a flag, and with admissibility decided by the canonical daily series rather than a hand-maintained venue list.
**Requirements**: MT5-01..05, MT5-11, MT5-12 (set at /gsd-discuss-phase 2026-08-03; see `142.2-CONTEXT.md` for the sixteen decisions behind them). ⚠️ MT5-11/MT5-12 were added AFTER the discussion, from live dogfood: the gate is not on the unified backbone. MT5-01/02 are already complete.
**Depends on:** Phase 142
**Plans:** 8/8 plans complete — ✅ **SHIPPED TO PRODUCTION as `v0.53.0.0` (PR #660, squash `8b327594`, 2026-08-04).** ⚠️ **STILL NOT CLOSED.**

Migration `20260803150000` applied to PROD via the auto-apply path; verified there read-only as
**text / nullable / no default, 0 CHECK constraints, 0 of 40 rows stamped** (no backfill, as designed).
Vercel Production is on `8b327594`; `quantalyze.xyz` returns 200 with `/api/health` `ok`.

⛔ **MT5-05 is an OUTSTANDING blocking human gate — and the deploy that blocked it has now happened,
so it is RUNNABLE.** `142.2-HUMAN-UAT.md` carries `status: pending` / `gate: blocking-human`: a founder
must complete the MT5 connect flow on **production**, without needing to know an internal error code,
a server name, or a flag. It is deliberately **not** approved — it has not been run.
⛔ **And even once MT5-05 passes, this phase means MT5 is REACHABLE, not CORRECT.** The numbers are
Phase 142.3's gate (D-17). Do not archive the milestone or advertise MT5 on the strength of 142.2 —
that is precisely how v1.15 shipped 6/6 phases green with both open items intact.

⚠️ **SPLIT 2026-08-03 at the D-14 valve, on the researcher's sizing finding (`142.2-RESEARCH.md`).** The original scope (MT5-01..12) was two phases, and the second was unbounded *by construction*: MT5-10 is uncapped by founder decision, and MT5-06/07/08 are human- and calendar-gated on a live trading-day session at the terminal. **MT5-06..10 moved to Phase 142.3.** This is the founder's pre-authorised valve (D-14) — a follow-up phase, **not** a scope cut. The dependency graph across the cut is one-directional: 142.2 makes MT5 *reachable and honest*, 142.3 proves it *correct*.

**Known inputs (do NOT re-derive at plan time):**

- v1.15 shipped MT5 and is ARCHIVED at tag `v1.15`. Live config: worker `MT5_ENABLED=true` + `MT5_GATEWAY_HOST=mt5-gateway.railway.internal:8001`, Vercel `NEXT_PUBLIC_MT5_ENABLED=true`. N accounts serialize through ONE gateway lock.
- ⚠️ v1.15 closed with two OPEN items, both live: **server-UTC offset**, and **confirm on a TRADING day** (a weekend run proves nothing).
- Founder-observed dogfood defects are already recorded in `TODOS.md` § "MT5 wizard — founder-observed on live UI": the Broker-server field is password-masked and should be plain text + searchable typeahead, and the connect-failure copy renders a generic `KEY_INVALID_FORMAT` that names Binance/OKX/Bybit at an MT5 user.
- "Unified backbone" here means the ONE pipeline (`key → dailies → backbone → UI`), not a second MT5-specific path. Dailies are canonical; derive metrics/charts/coverage from them.

⚠️ **A green unit suite is not evidence that MT5 is correct** — v1.15 shipped with 6/6 phases green and both open items survived it. That evidence is Phase 142.3's job. What 142.2 *can* prove offline is its own safety property: **a fills-gapped perp fixture must still be REFUSED.** MT5 passing is not the test; that perp still failing is.

Plans:

- [x] 142.2-01-PLAN.md — series_completeness migration (additive nullable, self-verifying) + the CI-counting SQL gate
- [x] 142.2-02-PLAN.md — MT5-03: per-venue passphraseSecret flag; MT5 broker-server plain text, OKX byte-identical (SC-7)
- [x] 142.2-03-PLAN.md — Python producers: SeriesCompleteness registry + all EIGHT combiner return paths accounted for (5 stamped; 3 empty-series early returns exempted **in writing**, justified by the `analytics-service/services/job_worker.py:4365` (`int(returns.notna().sum()) < 2`) non-NaN short-circuit) + the D-15 economic oracle (SC-1 py)
- [x] 142.2-04-PLAN.md — [BLOCKING, orchestrator-only, autonomous:false] MCP apply to TEST + A1/A2 executed evidence + read-only PROD censuses (A6, Pitfall-6)
- [x] 142.2-05-PLAN.md — worker enforcement: fail-loud assert BEFORE the reconcile-delete + composite_stitched stitch stamp + keyless user_supplied in the runner (SC-5, SC-6; covers all THREE csv_daily_returns producers)
- [x] 142.2-06-PLAN.md — TS gate consolidation: isLedgerBackedExchange DELETED, verdict allow-list, one exported predicate at all three former sites, composites stay approvable (SC-1 ts, SC-2, SC-3, SC-4)
- [x] 142.2-07-PLAN.md — MT5-04: KEY_INVALID_FORMAT split across the 24 emitting sites (12+12), copy honesty fix, registry-drift invariant (SC-8, SC-9, SC-10)
- [x] 142.2-08-PLAN.md — [autonomous:false] TODOS deferrals + falsifiability ledger backfill + MT5-01/02 delivered-record + MT5-05 founder checkpoint (reachable, NOT correct — 142.3 gates correctness)

### Phase 142.3: Prove the MT5 numbers correct against the live terminal on a trading day (INSERTED)

**Goal:** The performance Quantalyze renders for a live funded MT5 account matches the MT5 terminal's own equity and balance figures on a trading day, on every surface that renders it, with the broker-server-to-UTC offset measured rather than assumed — and any discrepancy found is fixed, wherever its root cause lives.
**Requirements**: MT5-06..10 (split out of Phase 142.2 on 2026-08-03 at the D-14 valve; the decisions behind them are D-07..D-11 in `142.2-CONTEXT.md`).
**Depends on:** Phase 142.2 (MT5 must be reachable through the gate before its numbers can be checked)
**Plans:** 0 plans

**Known inputs (do NOT re-derive at plan time):**

- ⚠️ This phase is **human- and calendar-gated**. It cannot be completed by an agent alone or on a weekend: it needs a founder at the MT5 terminal, on a trading day, with the live funded account's read-only investor password.
- ⚠️ **MT5-10 is uncapped by explicit founder decision** (D-10). A bounded alternative — split shared-cause fixes into their own phase — was offered and **declined**. Shared-backbone money-math root causes are IN scope. Size for the unbounded case; do not treat it as an escape hatch.
- `MT5_SERVER_UTC_OFFSET_S=10800` is **already live** on the worker. The open problem is **DST and multi-broker**, not the base offset. The last-deal offset estimator was already built and already failed (the −810 stale-deal artifact), and `analytics-service/tests/test_mt5_client_contract.py` — `test_read_only_surface_no_trade_methods` :735, its `forbidden` parametrize :720-734 — explicitly forbids `symbol_info_tick` on `Mt5Client` — read `142.2-RESEARCH.md` before proposing a measurement mechanism.
- ⛔ **No tolerance number exists anywhere for MT5-07.** "Matching within a stated tolerance" with no stated number is unverifiable. This needs a founder call before MT5-07 can have an acceptance criterion — surface it at /gsd-discuss-phase 142.3, do not invent one.
- The residual risk MT5-09 exists to test is the **backbone-bypass surfaces** logged in `TODOS.md`: `_compute_portfolio_analytics` (`analytics-service/routers/portfolio.py:628`), `equity_reconstruction.py`, and the bespoke TS stacks — they re-derive metrics rather than reading them. One daily series checked five ways; a divergence is a finding.

⛔ **This phase is the gate on any "MT5 is done" claim.** 142.2 closing does not mean MT5 is verified — it means MT5 is reachable. The v1.15 failure mode was exactly this: ship green, open items survive. Do not archive the milestone or advertise MT5 until 142.3 passes.

Plans:

- [ ] TBD (run /gsd-plan-phase 142.3 to break down)

## v1.16 Progress (PARKED)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 140. SEAM core + breaker | 7/7 | Complete   | 2026-07-25 |
| 140.1. PYAPI contract/status/limiter (INSERTED) | 9/9 | Complete | 2026-07-26 |
| 140.1.1. PYAPI-FIX (INSERTED) | 7/7 | Complete    | 2026-07-26 |
| 141. SEAM retry (audit-gated) | 4/4 | Complete    | 2026-07-31 |
| 142. JOB reaper + DDL | 6/6 | Complete   | 2026-08-02 |
| 143. JOB dropped-enqueue sweep | 0/? | ➡️ **CARRIED to v1.19** | - |
| 144. JOB WR-02 terminal UPDATE | 0/? | ➡️ **CARRIED to v1.19** | - |
| 145. JOB csv-finalize atomicity | 0/? | ➡️ **CARRIED to v1.19** | - |
| 146. RATE audit + close | 0/? | ➡️ **CARRIED to v1.19** | - |

## Requirement Coverage (v1.16)

| Phase | Requirements |
|-------|--------------|
| 140 | SEAM-01, SEAM-02, SEAM-03, SEAM-04 |
| 141 | SEAM-05, SEAM-06 |
| 142 | JOB-01, JOB-02, JOB-03, JOB-07 |
| 143 | JOB-04 |
| 144 | JOB-05 |
| 145 | JOB-06 |
| 146 | RATE-01, RATE-02, RATE-03, RATE-04, RATE-05 |

18/18 v1 requirements mapped, each to exactly one phase. No orphans.

---

## Shipped Milestones

> Collapsed index — one line per shipped milestone. Full per-milestone detail
> lives in `.planning/MILESTONES.md` and the `.planning/milestones/` archives.
> (Rebuilt 2026-07-25 from MILESTONES.md after a truncation accident; the prior
> inline v1.12/v1.13 detail sections were duplicative of their archives.)

- ✅ **v0.14.0.0 — Sprint 8: Bridge V2**
- ✅ **v0.15.0.0 — Sprint 9: Demo-to-Production**
- ✅ **v0.16.0.0 — Phase 11: Onboarding & Security Readiness**
- ✅ **v0.17.0.0 — Sprint 12: KPI Parity and Discovery v2**
- ✅ **v1.0.0 — API-Key Rewrite** (Diagnose → Fix → Unify → Ship to LPs)
- ✅ **v1.1.0 — Scenario Analysis** (Surface → Honesty → Persist → Read → Quant)
- ✅ **v1.2 — Allocator Cohesion** (tag `v1.2` @ `11775460`)
- ✅ **v1.2.1 — scenario-tab-hardening** (tag `v1.2.1` @ `e5e4f3d2`)
- ✅ **v1.2.2 — scenario-tab-factsheet-parity** (tag `v1.2.2` @ `43e57dd0`)
- ✅ **v1.3 — Mobile & Adaptive UI** (2026-06-28)
- ✅ **v1.4 — Frontend Excellence** (tag `v1.4` @ `4c4ca537`)
- ✅ **v1.5 — Scenario Coverage-Window Blend** (tag `v1.5` @ `f8b502e7`)
- ✅ **v1.6 — Scenario Series-Space Purification** (tag `v1.6` @ `f78f036b`)
- ✅ **v1.7 — Deribit Exchange Coverage & Carry-Forward Burn-Down** (tag `v1.7` @ `9a1e7b8e`)
- ✅ **v1.8 — Flow-Aware Time-Weighted Returns + Native-Unit NAV** (tag `v1.8` @ `eb8e357e`)
- ✅ **v1.9 — Multi-Key Composite Strategy** (tag `v1.9` @ `044bee50`). Archive: `milestones/v1.9-ROADMAP.md`.
- ✅ **v1.9.1 — Composite Onboarding Hardening** (tag `v1.9.1` @ `be215b15`). Archive: `milestones/v1.9.1-ROADMAP.md`.
- ✅ **v1.10 — Demo-Hero Portfolio Intelligence + Options MTM + Backbone Unification** (2026-07-15). Archive: `milestones/v1.10-ROADMAP.md`.
- ✅ **v1.11 — Scenario Composer v2** (tag `v1.11` @ `a42f4bcf`, Phases 109–117). Every source is a daily-series constituent under a coherent manager/allocator role model. Archive: `milestones/v1.11-ROADMAP.md`.
- ✅ **v1.12 — sFOX Verified Integration (Foundation, flag-OFF)** (tag `v1.12` @ `92be47af`, Phases 118–123). Live sFOX `api_verified` foundation shipped dormant; go-live re-homed to v1.13. Archive: `milestones/v1.12-ROADMAP.md`.
- ✅ **v1.13 — Infra: sFOX go-live foundation + worker rebuild** (tag `v1.13`, Phases 125–130, shipped FLAG-OFF 2026-07-19, closed 2026-07-22). Railway static-egress + worker rebuild + trust-tier SECDEF. Archive: `milestones/v1.13-ROADMAP.md`.
- ✅ **v1.14 — Smoothed options MTM (third factsheet basis)** (tag `v1.14` @ `0adde939`, v0.48.0.x, Phases 131–133, shipped + flipped LIVE 2026-07-23; PRs #633 + #635). Additive third `pnl_basis` `smoothed_mtm` (daily ΔMTM redistribution, total-preserving; cash/MTM byte-identical). Archive: `milestones/v1.14-ROADMAP.md`. Review: `v1.14-BIG-REVIEW.md` (SHIP).
- ✅ **v1.15 — MetaTrader 5: live api_verified account sync** (tag `v1.15`, v0.49.0.0→v0.49.4.0, Phases 134–139, shipped DARK 2026-07-24 + flipped LIVE 2026-07-25; PRs #636 + #637/#640/#641/#642). Self-hosted Wine gateway + `mt5linux` net client → deal-ledger equity reconstruction → the ONE backbone with `api_verified`; √252 traditional; 3-field creds. Prod gateway private+live, Vantage acct 26547876 soaked green, flags flipped LIVE. Archive: `milestones/v1.15-ROADMAP.md` + `v1.15-REQUIREMENTS.md`. Audit: `v1.15-MILESTONE-AUDIT.md`.

## Current position

⭐ **CURRENT: v1.18 MT5-VERIFY & founder confirmations (Phases 155, 157)** — created 2026-08-14.
⛔ **Every phase is founder-gated**; nothing here is agent-deliverable. Blocked on (1) new MT5
investor passwords and (2) the founder at the terminal on a trading day. See the milestone header
at the top of this file.

✅ **v1.17 MT5 — ingested, wizardable, surfaced** — CLOSED 2026-08-14, 10 phases delivered
(147–154, 156), shipped through v0.62.0.0. ⚠️ Its original title said *"usable end-to-end, not
merely ingested"*; Phase 155 was carried to v1.18 and the title was amended to match what was
actually delivered. ⛔ **MT5 is NOT advertised** — nobody has compared our numbers to the
terminal's.

➡️ **NEXT AGENT WORK: v1.16, PARKED at 68% (13/19 phases, 119/127 plans).** Resume at Phase 143.
⚠️ Phase 144 carries the live WR-02 DELETE-vs-reset decision — the orphaned-running purge DELETEs
rather than resets, which loses PROD jobs; the charter already decides it (terminal `failed`
UPDATE, never a bare DELETE) and a reaper that deletes rows it should have reset is **not
revertible**.
Next: `/gsd:plan-phase 143`. ⛔ **Run 143 → 144 → 145 → 146 in that order — it is a declared
dependency chain, not a preference:** 143 depends on 142, 144 on 143, 145 on 144, and 146 is
sequenced last *so its gap list comes from a fresh grep* (running it earlier audits a codebase
about to change). ⚠️ A risk-first reordering (145/146 before the migrations) was proposed on
2026-08-14 and **rejected — it inverted 145's dependency on 144.** Note the consequence: 144 is
SECOND, not last, so it does not get a long PROD-soak behind it. Its safety must come from the
change itself — assert the migration writes a terminal `failed` state and issues NO `DELETE`,
prove it on TEST, and verify on PROD before 145 begins.

---

_Shipped milestone details: `.planning/MILESTONES.md` + `.planning/milestones/`._

# Phase 169: PAGETRUTH - Context

**Gathered:** 2026-09-25 (no discuss step; decisions below were taken by the planning orchestrator on
the research's open questions, and by the planner where the research left the call to the plan)
**Status:** Ready for execution (revised 2026-09-25 after the plan-checker pass: B1, B2, W1 to W7; see D-06, D-13 and D-17 to D-19; revised again 2026-09-25 after the round-3 re-check: B1, B2, W1 to W3; see D-20 to D-24; revised a third time 2026-09-25 on the orchestrator's decision that D-23 must name the plan that consolidates the discovery page, and on the founder principle "calculate Sharpe once; every page reads it": see the D-13 and D-23 amendments, D-25 and D-26; revised a fourth time 2026-09-26 on the founder's zoom decision of 2026-09-25: see D-27 and the D-13 amendment of that date; revised a fifth time 2026-09-26 after the final plan-check (W1 to W3, I1, I3) and the founder's decision to fix the compounding limit: see the D-27, D-13, D-19 and D-25 amendments of that date and the new plan 14b; split 2026-09-26 into Phases 169, 169.1, 169.2, 169.3 and 169.4, see D-37)
**Sources:** `.planning/ROADMAP.md` `### Phase 169` (9 success criteria, founder decision 2026-09-25),
`169-RESEARCH.md` (commit `2d01a2244`), CLAUDE.md, DESIGN.md.

<domain>
## Phase Boundary

Every number a page shows agrees with the same number on every other page and with the length of the
record it describes. Each contradiction is fixed at ONE source of truth, never patched per page.

**Excluded by founder decision (ROADMAP, verbatim):** "Phase 167.1.2 ACCOUNTTRUTH already owns the
Allocations equity curve, Sharpe beside a negative return, the Scenario zero weights/UUID/$0 total,
and the holdings total; they are EXCLUDED here." Layout, copy, typos, raw enums and internal text
belong to Phase 170 PAGECOPY.
</domain>

<decisions>
## Implementation Decisions

Each decision carries its date, its reason and its reversibility. "Orchestrator" means the planning
orchestrator's autonomous engineering-scope call on a research open question (OQn); "planner" means a
call the research left to the plan.

### D-01: The dead `get_admin_compute_jobs` function is NOT dropped in this phase (orchestrator, OQ1, 2026-09-25)
- Plan 01 stops calling it; the function stays in the catalogue, broken and unused.
- **Reason:** a DROP is a migration. Merging `supabase/migrations/**` auto-applies to TEST and then to
  PROD with no human gate, needs the 3-reviewer pass, and moves `database.types.ts` and the census
  pins. None of that is needed to fix SC1.
- **Routed:** `TODOS.md` `[169-DEAD-ADMIN-JOBS-RPC]` (FIX MID-TERM), to be dropped by the next
  migration-carrying phase, with `169-RESEARCH.md` root cause A as the evidence.
- **Reversibility:** reversible. Dropping later is one migration; nothing in this phase depends on it.

### D-02: Plan 07 OWNS the MetricsColumn period math (orchestrator, OQ2, 2026-09-25)
- Windows are calendar-date windows. Returns and CAGR run on calendar time. A period longer than the
  record is blanked (em-dash), never shown as the whole-record return.
- 167.1.2 plan 07 is trimmed by the orchestrator to drop its `periodReturn` / window edits (done
  separately, not by this phase). 169 plan 07 lands AFTER 167.1.2 PR C and must re-read
  `MetricsColumn.tsx` at HEAD before editing.
- **Reason:** only one of the two phases may own the `periodReturn` lines (RESEARCH Pitfall 6), and
  the calendar rule is the one that fixes SC6; an observation-clock look-back keeps the index-0 clamp.
- **Amended 2026-09-25 (D-17):** for the 3 Year and 5 Year rows, "blanked (em-dash)" is replaced by
  "not shown": SC6 says those rows are not shown. The em-dash rule still holds for every other window.
- **Reversibility:** reversible (presentation math, no stored data).

### D-03: One mandate rule, `deriveMandateIsSet`, chosen by evidence (orchestrator OQ3 + planner, 2026-09-25)
- **Evidence measured 2026-09-25:** `analytics-service/services/match_engine.py` reads `max_weight`
  and `preferred_strategy_types` (plus the other numeric preference fields) and NEVER reads
  `mandate_archetype`. `mandate_archetype` appears in the Python service only as a default
  (`services/match_defaults.py`). It is a free-text textarea in `MandateForm`. So the rule
  /recommendations uses today (`Boolean(preferences?.mandate_archetype)`) tests a field the engine
  ignores, and `deriveMandateIsSet` (`src/lib/queries.ts`, the W-02 truth table) tests fields the
  engine consumes.
- **Decision:** `deriveMandateIsSet` is canonical, unchanged. /recommendations imports and calls it.
  It is NOT widened to the other engine fields in this phase (Rule 2; widening changes /allocations
  behaviour, which no SC asks for).
- **Where:** plan 10, PR 2 (wave 4 after the 2026-09-25 revision, D-13), after 167.1.2 PR C, as the orchestrator decided.
- ⚠️ **Premise note (Rule 7, surfaced, not acted on):** the orchestrator placed this in wave 3 because
  of a `queries.ts` overlap. Measured: no 167.1.2 plan mentions `deriveMandateIsSet` or the mandate
  predicate, and plan 10 only IMPORTS it (no `queries.ts` edit). The wave-3 placement is therefore
  safe but not required; it is kept because the orchestrator decided it.
- **Reversibility:** reversible.

### D-04: The "Month-to-date" relabel on an ended record goes to Phase 170 PAGECOPY (orchestrator, OQ4, 2026-09-25)
- `compute()`'s `mtd` is the record's last month. Once SC3's `through` date and SC5's series-end line
  date it, the remaining defect is a label, which is copy.
- A dated line is added under ROADMAP `### Phase 170`.
- **Reversibility:** reversible.

### D-05: A user recommended their own strategy is fixed in plan 03, at the match engine (orchestrator OQ5 + planner, 2026-09-25)
- Same surface as SC8. **Root cause (measured):** `match_engine` builds its hard `owned_set` from the
  allocator's PORTFOLIO strategies only; a strategy the allocator AUTHORED (`manager_id`, projected
  from `strategies.user_id` in `routers/match.py` `_load_candidate_universe`) is not excluded.
- **Fix:** authored candidates are hard-excluded with the existing `ExclusionReason.OWNED`, in the
  engine, not filtered per page. An already-persisted batch clears on the next daily recompute.
- **Reversibility:** reversible.

### D-06: QA findings D12 and D14 routed by content (orchestrator rule, planner application, 2026-09-25)
- **D12** (the venue label shown on CSV-ingested strategies) is a label, so copy. It goes to Phase 170
  (a dated ROADMAP line).
- ~~**D14** ("attribution to verify") is a NUMBER surface (the Allocations attribution widgets).~~
  ⚠️ The QA sweep report is untracked and its text is not available to this planner, so D14's exact
  content is unknown. It is carried as an explicit browser re-check item in plan 11 (the plan that
  owns the attribution widget, on the same series as SC2). A disagreement found there is a 169 defect and is fixed
  or booked before the phase closes; it is NOT silently dropped.
- ⛔ **AMENDED 2026-09-25 (orchestrator decision, W1; the paragraph above is kept as lineage and is
  superseded).** D14 was identified: it is the `/admin` Strategy Review line "by <display_name> ·
  Synced" (`AdminTabs.tsx`), where two owners with the same display name read identically. It is an
  attribution LABEL, not a number, so by this decision's own content rule it is copy and goes to
  Phase 170: a dated routed item (c) under ROADMAP `### Phase 170` (owner disambiguation when display
  names collide, respecting 170 SC2's no-short-id rule; noting that the adjacent "Synced" label prints
  `computed_at`). **Reason:** the premise that D14 was a number surface was a guess made without the
  report text, and it was wrong. Plan 11 no longer carries a D14 check.
- **Also routed to Phase 170 on 2026-09-25 (orchestrator, QA I5):** the intro-requests "N in progress"
  relabel, as routed item (d) under ROADMAP `### Phase 170`.
- **Reversibility:** reversible.

### D-07: Wave split: plan 06 moves from wave 2 to wave 1 (planner, 2026-09-25)
- The research put 05 BENCHTRUTH and 06 CHIP+WINDOWS-MATH in wave 2 as "disjoint". Measured: both
  must modify `src/lib/factsheet/types.ts` (06 widens `ComputeResult`'s windows to `number | null`
  and adds `p3y` / `p5y`; 05 adds the comparator's `through` field) and both move snapshots under
  `src/lib/factsheet/__snapshots__/`. Same-wave plans must have zero file overlap.
- 06 has no dependency, so it moves to wave 1. 05 depends on 02, 04 and 06, and stays in wave 2. The
  two-PR boundary is unchanged: PR 1 = waves 1-2, PR 2 = wave 3.
- **Superseded in part 2026-09-25 (D-18):** plan 05 is now 05a (wave 2) and 05b (wave 3); PR 1 =
  waves 1-3, PR 2 = waves 4-5. The reason for moving 06 to wave 1 is unchanged.
- **Reversibility:** reversible (ordering only).

### D-08: BENCHFEED shape (orchestrator + planner, 2026-09-25)
- A daily Vercel cron route, `/api/cron/refresh-benchmark`, with the `CRON_SECRET` Bearer +
  `safeCompare` pattern of `warm-analytics`, calls a new analytics-service endpoint through
  `src/lib/analytics-client.ts`. The endpoint calls the EXISTING `services/benchmark.py`
  `get_benchmark_returns("BTC")` and returns `{through, stale}`. No second fetcher in TypeScript.
- **Planner correction to the research:** the research proposed the endpoint under `/internal`.
  Measured: `/internal/*` is skipped by `main.verify_service_key` and gated by its own
  `INTERNAL_API_TOKEN`, a narrower secret reserved for the per-key permission proxy. A benchmark
  refresh is a cron job, so it goes on `routers/cron.py` (prefix `/api`), behind the global
  `X-Service-Key` middleware, beside `/api/cron-sync`.
- Non-2xx on `None` or `is_stale=True`: Vercel cron only alarms on non-2xx (RESEARCH Pitfall 5).
- **Amended 2026-09-25 (W2):** the service's failure status is exactly **500, never 503**: in the seam
  status table (`seamBreakerVerdict`) only a 503 records a breaker failure, so a stale price must not
  trip the breaker every analytics call reads. The TypeScript half (the `benchmark-refresh`
  `SeamBudgetKey`, the cron route, and every seam census the new key and route move) is plan 02b.
- ONE paged reader of `benchmark_prices` (`src/lib/factsheet/benchmark-source.ts`), newest-first in
  1000-row pages until an EMPTY page, advancing by the rows actually received (planner refinement of
  the research's "until a short page": a server cap below 1000 would make every page short and stop
  the read early, which is the truncation this fixes); both `/api/benchmark/btc` and the factsheet builders use it
  (fixes the PostgREST `max_rows` truncation).
- **Reversibility:** reversible (a cron entry and a stateless endpoint).

### D-09: A comparator is measured only over the dates it has real prices for (planner, 2026-09-25)
- Each comparator block carries `through`: its last real price date on or before the strategy's
  last date. Its summary, joint metrics (alpha, beta, IR) and correlations are computed over the
  COVERED prefix only. A window (MTD, YTD, 3M, 6M, 1Y) that ends after `through` is `null` and
  renders the em-dash with a dated caption ("BTC prices through <date>"), never +0.00%. Per-day
  comparator arrays are `null` past `through`, so no chart draws a flat fabricated line.
- DB closes win on every date the DB has; the bundled fixture supplies only dates strictly before the
  DB's first date (no seam day inside the DB window).
- **A DB read error renders the comparator unavailable. It never falls back to the fixture** (that
  fallback is the stale bug itself).
- SPX, ETH, GLD and IEF stay on their static fixtures (the Python fetcher supports BTC only); they get
  the same `through` label automatically, which is honest.
- /allocations Overview reaches `buildFactsheetPayload` through `allocator-portfolio-payload.ts` and
  `queries.ts`, both 167.1.2 files. Until plan 11 wires the DB feed there (PR 2, wave 4), that path keeps
  the fixture WITH its `through` date, so it shows a dated em-dash instead of +0.00%.
- **Reversibility:** reversible.

### D-10: The factsheet headline reads the persisted scalars for single-key strategies (planner, 2026-09-25)
- `readSingleKeyBasisOpts` supplies the persisted top-level `strategy_analytics` scalars as the cash
  headline when `metrics_json_by_basis.cash_settlement` is absent, mapped through `BASIS_KPI_MAP`,
  gated on `isRankableAnalyticsRow` (the predicate recommendations uses). The OG card reads the same
  persisted values and keeps its own display policy.
- **Reason:** discovery, recommendations and my-strategies already read the persisted value; the
  overlay's own documented rationale is exactly SC4.
- **Reversibility:** reversible.
- **Note 2026-09-26 (D-44):** the OG card's half of this decision is owned by Phase 169.4.1 OGSHARPE
  (plan 169.4.1-01); Phase 169 plan 169-01 owns the factsheet half.

### D-11: One calendar coverage rule for every return window (planner, applying D-02, 2026-09-25)
- A window with cutoff date C (MTD: last day of the previous month; YTD: 31 Dec of the previous year;
  3M/6M/1Y: last date minus 90/182/365 days; 3Y/5Y: last date minus 3x365 / 5x365 days) is shown
  only when the record covers it: the first observation date is on or before C plus one day.
  Otherwise the value is `null` (em-dash).
- `compute()` gains `p3y` and `p5y` under this rule (plan 06), so plan 07 deletes `periodReturn`
  rather than rewriting it. 3Y is 3x365 calendar days, never 3x252 observations.
- **Reversibility:** reversible.

### D-12: Record length is stated one way (planner, 2026-09-25)
- One pure formatter (`src/lib/factsheet/record-length.ts`) states the length once, in calendar
  years, with the count as "daily observations" ("trading days" is wrong for 24/7 venues). The three
  sites (Strategy Thesis sentence, "Years Observed", the observation warning) call it (plan 07).
- **Amended 2026-09-25:** there is a FOURTH site, the Terms panel's "Sample size" Term in
  `MandatePanels.tsx` (found on revision); plan 07 routes it through the same formatter.
- **Reversibility:** reversible.

### D-13: Two PRs, and a machine-checked order gate for wave 3 (orchestrator, 2026-09-25)
- PR 1 = waves 1-2 (plans 01-06). PR 2 = wave 3 (plans 07-11).
- **Amended 2026-09-25 (B1, B2, W5):** PR 1 = waves 1-3 (01, 02, 02b, 03, 04, 06; then 05a; then
  05b). PR 2 = wave 4 (07, 08, 09, 10, 11) and wave 5 (12). Every PR 2 plan lists `169-05b` in
  `depends_on`, so the PR boundary is in the DAG and each declared wave equals its computed wave.
  05b ends with the PR 1 post-deploy browser checkpoint and plan 12 carries the PR 2 one (the
  wave-4 plans run in parallel, so no one of them is last). The order gate now also checks that
  `origin/main` carries 169 PR 1, and prints one `ORDER PASS` / `ORDER FAIL <check>: <reason>` line
  per check; the success token keeps its original name for traceability.
- **Planner addition (2026-09-25):** the research's plan 08 RISKTAB also had to carry the /allocations
  Overview BTC feed and alpha/beta vs BTC, which puts `queries.ts`, `allocator-portfolio-payload.ts`
  and `AllocationDashboardV2.tsx` beside the six risk widgets in one plan (more than 3 tasks, more
  than 5 files a task). It is split: plan 08 = the Risk tab's VaR / tail / decomposition /
  correlation on the book series; plan 11 = the BTC feed on the dashboard payload, the Overview
  comparator and alpha/beta vs BTC. The two are file-disjoint and both wave 3. Plan 10 is the
  mandate predicate (D-03).
- **Amended 2026-09-25 (orchestrator, D-23 amendment):** PR 2 = wave 4 (07, 08, 09, 10, 11), wave 5
  (13, the discovery page consolidation, after 11 because both edit `src/lib/queries.ts`) and wave 6
  (12, which now also depends on 13). Plan 13 has its own order gate (`PAGETRUTH_13_ORDER_OK`) that
  adds an `ORDER PASS` / `ORDER FAIL` line for Phase 167.2.1 being on `origin/main`. **Consequence:**
  PR 2 cannot ship before Phase 167.2.1 merges. If 167.2.1 stalls, that is a scheduling question for
  the orchestrator, not a reason to drop plan 13.
- **Amended 2026-09-26 (founder decision D-27):** wave 5 now holds 13 AND **14** (the KPI strip and
  the rail follow the zoom window). 14 depends on 05b (the PR boundary) and 07 (both edit
  `MetricsColumn.tsx`, so 14 runs after 07); it shares no file with 13, so both run in parallel in
  wave 5. Plan 12 (wave 6) now also depends on 14 and re-checks the zoom in the PR 2 browser
  checkpoint. PR 2 = wave 4 (07-11), wave 5 (13, 14), wave 6 (12). 14's first step runs the same
  `PAGETRUTH_W3_ORDER_OK` gate as 07.
- **Amended again 2026-09-26 (founder decision on the D-27 compounding limit; see D-27):** plan
  **14b** carries the fix. It edits `build-payload.ts`, which plan 13 also edits in wave 5, and the
  shared argument builder plan 14 creates in `basis-context.tsx`, so it depends on 13 and 14 and runs
  in **wave 6**. Plan 12 depends on 14b and moves to **wave 7**. PR 2 = wave 4 (07-11), wave 5 (13,
  14), wave 6 (14b), wave 7 (12). The paragraph above is kept as lineage.
- **Amended a third time 2026-09-26 (orchestrator decision 4, D-31):** plans **14c** and **14d**
  follow 14b in **wave 7** (file-disjoint, parallel). Plan 12 depends on both and moves to
  **wave 8**. PR 2 = wave 4 (07-11), wave 5 (13, 14), wave 6 (14b), wave 7 (14c, 14d), wave 8 (12).
  The paragraph above is kept as lineage.
- Every wave-3 plan's FIRST task runs a precondition that prints `PAGETRUTH_W3_ORDER_OK` only when
  `origin/main` carries 167.1.2 PR C's artefacts and HEAD contains `origin/main`; otherwise the
  executor STOPS. Same device as 167.1.2's `D12_ORDER_OK`.
- **Reversibility:** reversible.
- ⛔ **RETIRED 2026-09-26 (D-37): the two-PR packaging above is retired, and every paragraph of this
  decision is kept as lineage.** Phase 169 was split into five one-topic phases, one PR each. The
  order-gate device in the bullet above is KEPT (its checks were adjusted, see D-37).

### D-14: No migration (orchestrator, 2026-09-25)
- No plan in this phase adds a file under `supabase/migrations/`. If an executor finds one
  unavoidable, it STOPS and flags the 3-reviewer pass (migration-reviewer, rls-policy-auditor,
  silent-failure-hunter) before anything merges.
- **Reversibility:** n/a.

### D-15: The admin compute-jobs list reads the admin VIEW with the service-role client after the admin gate (planner, from RESEARCH A, 2026-09-25)
- `compute_jobs_admin` is `security_invoker`, exposes no `claim_token`, and is granted to
  `service_role`. Explicit column list, never `select("*")`. The client's empty state renders only
  when there is no error.
- **Reversibility:** reversible.

### D-16: The freshness chip's date line matches its subject (planner, 2026-09-25)
- When the series arm binds, the chip's date line shows the series end and its age (the same
  `resolveSeriesEnd` derivation `SeriesRecencyLine` uses), and the compute date moves to its own
  labelled "Computed <date>" line. The 3d/7d ladder is unchanged; no new threshold.
- **Reversibility:** reversible.

### D-17: SC6 is read literally: a 3 Year / 5 Year row is NOT SHOWN for a shorter record (orchestrator, W4, 2026-09-25)
- ROADMAP SC6: "3-year and 5-year rows are not shown for a record shorter than that period." Plan 07
  omits the row (no label, no value) when `compute()`'s `p3y` / `p5y` is null. It does not print an
  em-dash row. `compute()` still returns null for those windows (D-11); only the rendering differs.
- **Reason:** the plan as first written rendered the em-dash, which shows the row; the criterion says
  the row is not shown. Take the words as written.
- **Lineage, 2026-09-25 (round 3):** `p3y` / `p5y` are OPTIONAL in the type (plan 06, so hand-built
  summaries compile), so plan 07 hides a row on `== null`, which covers both ABSENT and null. A test
  of "not null" alone would render a row for an absent field. Plan 07's panel comment carries this
  line and cites D-17.
- **Reversibility:** reversible (one conditional per row).

### D-18: Plan 05 is split into 05a and 05b; the BENCHFEED seam half is plan 02b (planner, B2 + W2, 2026-09-25)
- 05a (wave 2): coverage-aware alignment and comparator numbers, the factsheet route's DB read, the
  cache key bump. 05b (wave 3): the payload-carried prices and browser re-derive, the discovery page,
  per-day nulls and the chart gap, the caption, both MandatePanels "forward-filled" sites (W6), and
  the PR 1 checkpoint. 02b (wave 1): the cron route, the `benchmark-refresh` seam key and every
  census it moves. **Reason:** the single plan 05 held 15 files at an estimated 130k tokens, and the
  seam registration is eight coordinated census edits that do not fit beside plan 02's work.
- **Reversibility:** reversible (ordering and packaging only).

### D-19: The factsheet cache shape key moves v6 -> v7 once, in plan 05a (planner, W3, 2026-09-25)
- 06, 05a and 05b all change the cached `FactsheetPayload` shape and deploy together in PR 1, so one
  bump covers them; 05a writes the lineage line naming all three and moves the pinning test; 05b
  corrects only its own clause and never bumps to v8. PR 2 changes no factsheet payload shape.
- **Amended 2026-09-25 (round 3, D-21):** PR 2 DOES change one payload value: plan 07 nulls
  `dailyReturns` past `through` and widens its type. No v8 bump: a stale v7 entry holds numbers,
  which the type-guarded EoY loops still accept, so it renders exactly PR 1's recorded known limit
  (D-21) for at most the 1 h drain and never crashes; plan 12's cache-drain rule keeps that window
  out of the PR 2 check. The sentence above is kept as lineage.
- **Amended 2026-09-26 (plan 14b, D-27 as amended):** PR 2 adds one OPTIONAL payload field,
  `cumulativeMethod`, and changes the arithmetic arm of `deriveSeriesBundle`'s metric triple. Still
  no v8 bump, by the same reasoning as the round-3 amendment: a stale v7 entry lacks the field, so the
  window arm reads it as geometric, which is exactly the pre-fix behaviour D-27 recorded as its
  known limit, for at most the 1 h drain; it never crashes, the full-history figures do not move
  (the four scalars the triple changes are all in `BASIS_KPI_MAP` and are overlaid from the
  persisted basis on every composite view), and plan 12's cache-drain rule keeps that window out of
  the PR 2 check. The house rule in the page's key comment ("bump whenever FactsheetPayload adds
  non-optional fields") does not require it, and one convention is used across PR 2 (Rule 7).
- **Amended again 2026-09-26 (D-28, D-30, D-31):** PR 2 adds a second OPTIONAL field, `dayBasis`;
  14c makes both fields appear on single-key payloads; 14d changes bucket VALUES on arithmetic
  series. Still no v8 bump, same reasoning: a stale v7 entry lacks the optional fields and holds the
  pre-fix values, which is exactly the pre-fix page, for at most the 1 h drain, with no crash. The
  statement above that "the full-history figures do not move" is narrowed: the seven overlaid KPI
  scalars do not move; on arithmetic series the drawdown-derived extended metrics (D-28), the
  single-key curves (14c) and the calendar windows and buckets (14d) DO move, to the values the
  engine's convention gives. Plan 12's cache-drain rule keeps the drain out of the PR 2 check.
- **Reversibility:** reversible.

### D-20: The benchmark-refresh cron route consumes a rate limiter; the no-limiter quarantine stays empty (orchestrator, round-3 B1, 2026-09-25)
- The new cron route `src/app/api/cron/refresh-benchmark/route.ts` (the Next.js route that calls the
  service's `/api/benchmark-refresh`) imports the seam core through `analytics-client`, so the
  from-disk walk in `src/lib/seam-ratelimit-posture.invariant.test.ts` finds it as a seam route. It
  gets a `checkLimit` arm with its deny routed through `rateLimitDenyJson`. It does NOT get a
  `NO_LIMITER_QUARANTINE` entry, and no allowlist or quarantine is widened.
- **Which limiter, measured 2026-09-25:** no existing cron route consumes a limiter (`checkLimit`
  appears in 0 of the 7 `src/app/api/cron/*/route.ts` files, and in no route that reads
  `CRON_SECRET`), and no existing cron route calls the analytics seam (`warm-analytics` is a
  `SEAM_EXCLUSIONS` health warmer on a raw `/health` fetch). So there is no cron precedent. The
  measured precedent is the seam routes whose trigger is a server-side operator action, not an end
  user: `admin/match/recompute` and `admin/match/eval`, both on `adminActionLimiter`. The cron route
  uses `adminActionLimiter` with one fixed identifier (`benchmark-refresh:cron`); Rule 2, no new
  limiter.
- **Order in the handler:** the `CRON_SECRET` gate first (401, limiter not consulted), then
  `checkLimit`, then the analytics call. A deny answers 429, and a misconfigured limiter answers 503,
  both through `rateLimitDenyJson` and both non-2xx, so Vercel cron alarms on either.
- **Censuses this moves (plan 02b):** the posture file's hand-typed `EXPECTED_LIMITER_ROUTES` and
  `EXPECTED_ROUTE_LIMITERS` each gain the route; `src/__tests__/vercel-cron-limits.test.ts`'s
  hand-typed "eight production crons" inventory becomes nine; `seam-budgets.invariant.test.ts`'s
  `expect(ROUTE_ENTRIES.length).toBe(15)` length fence becomes 16; and `contracts/REGISTRY.md`'s prose
  counts that state a CURRENT population ("13 `SEAM_BUDGETS`", "hand-typed 15-row map", "each of
  the 15 route files", "all 15 routes") are re-measured by grep and rewritten to the measured value.
  Prose that records a dated measurement ("Measured at plan time", "140.5-08: this read ...") is
  lineage and is not rewritten.
- **Reversibility:** reversible (one limiter call and its roster rows).

### D-21: No PR 1 type change may force an edit in a 167.1.2 file (orchestrator, round-3 B2, 2026-09-25)
- **Measured:** `scenario-factsheet-payload.ts` (under `src/app/(dashboard)/allocations/`) hand-builds
  a `ComparatorBlock` (`inertComparatorBlock`) and a whole `FactsheetPayload`. `MetricsColumn.tsx`'s
  `EoyReturnsPanel` and `DistributionPanels.tsx`'s `EndOfYearBarsPanel` read
  `comparators[key].dailyReturns[i]` and do arithmetic on it after a `Number.isFinite` check, which is
  not a type guard. So a REQUIRED new field on either type, or widening `dailyReturns` to
  `Array<number | null>`, fails `tsc` in a 167.1.2 file.
- **Decision:** `ComparatorBlock.through` and the `FactsheetPayload` BTC `{ prices, through }` field
  are OPTIONAL, the same device plan 06 uses for `p3y` / `p5y`. The builders always set them. A
  reader treats ABSENT as "no coverage information": no caption, and a re-derive with no carried
  prices yields the comparator's unavailable form, never the fixture (D-09's no-silent-fallback rule).
  ABSENT is distinct from the unavailable form (`through: null`, `summary: null`).
- `dailyReturns` stays `number[]` in PR 1. Plan 05b nulls only the chart arrays past `through`
  (`cumulative`, `cumVsBench`, `volMatched`, the rolling series). Padding `dailyReturns` with null,
  widening its type, and the two EoY reader loops (`MetricsColumn.tsx`, `DistributionPanels.tsx`)
  move to plan 07 in PR 2, which already owns `MetricsColumn.tsx` after 167.1.2 PR C (D-02).
  `HistogramChart.tsx` already guards `b != null`, so it needs no edit (measured).
- **Known limit, PR 1 to PR 2 window:** until plan 07 ships, `dailyReturns` past `through` still holds
  the forward-filled 0, so the EoY table's and EoY bars' comparator figure for the last year and the
  histogram's benchmark overlay count those days as 0%. The headline comparator numbers (05a) and the
  chart lines (05b) are already correct in that window. The PR 1 checkpoint records this rather than
  reporting it as a new defect; the PR 2 checkpoint (plan 12) checks it is gone.
- Amends D-09's "Per-day comparator arrays are null past `through`": true for the chart arrays in
  PR 1, and for `dailyReturns` from PR 2.
- **Reversibility:** reversible.

### D-22: Merge order with Phase 167.2.1 (orchestrator, round-3 W2, 2026-09-25; mirrors 167.2.1 D-09)
- 167.2.1 D-09 (on branch `feat/167.2.1`) states that Phase 169 plans edit `build-payload.ts`,
  `fetch-and-build-payload.ts` and `types.ts`, and that whichever of the two phases merges SECOND
  re-runs 167.2.1 plan 01's probe-to-builder parity table and its SC1 live reproduction on the local
  lane after the rebase, and records both runs.
- **Decision:** 169 carries the same rule. The 169 plans that touch those files are **169-04**
  (`fetch-and-build-payload.ts`), **169-05a** (`build-payload.ts`, `types.ts`,
  `fetch-and-build-payload.ts`) and **169-05b** (`build-payload.ts`, `types.ts`). If 167.2.1 is on
  `origin/main` when 169 PR 1 is rebased for merge, the 169 PR 1 ship step re-runs those two 167.2.1
  checks after the rebase and records both results in the 05b SUMMARY. A rebase that adds a null
  exit to `fetchAndBuildPayload` outside 167.2.1's shared resolve stage is fixed by moving the exit
  into the resolve stage, never by special-casing the probe (167.2.1 D-09's own rule). If 169 PR 1
  merges first, 167.2.1 carries the duty.
- **Amended 2026-09-26 (D-42), the text above kept as lineage.** Its owner is retired: there is no "169 PR 1
  ship step" and no "05b SUMMARY" after the split (D-37). The duty is now owned by **plan 169-08** (wave 4):
  it performs the phase's one rebase onto `origin/main` on the phase branch, and its Task 3 re-runs 167.2.1
  plan 01's probe-to-builder parity table and SC1 live reproduction on the local lane straight after that
  rebase, recorded in `169-08-SUMMARY.md`. 169-06 step 0 cites that record and repeats the two checks only if
  `origin/main` moved after 169-08. The "169 PR 1 merges first" arm is unreachable (D-41 (c)). The plans
  that touch the three files are, in the new numbering, 169-01, 169-02, 169-03, 169-05 (`types.ts`), 169-07 and
  169-08 (`fetch-and-build-payload.ts`, in its reconciliation).
- **Note 2026-09-26 (D-42 as amended):** "the phase's one rebase" above reads "the wave-4 rebase"; the phase
  branch's first sync is the gated phase-entry merge before wave 1 (see D-42's amendment). The D-22 duty is
  unchanged and stays with 169-08.
- **Reversibility:** n/a (process).

### D-23: The discovery detail page's duplicate builder assembly (167.2.1 D-03) (orchestrator + planner, round-3 W2, 2026-09-25)
- 167.2.1 D-03 routes to Phase 169 the drift risk that
  `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx` assembles the factsheet builder itself
  instead of calling `fetchAndBuildPayload`. **Phase 169 owns it.**
- **What 169 does now (plan 05b):** keeps the duplicate in LOCKSTEP. 05b gives the discovery page the
  same BTC read, bounds and unavailable rule as `fetchAndBuildPayload`, and adds a lockstep test that
  fails when the two build paths pass different `benchmarkPrices` for the same strategy. The drift
  the entry warns about then shows up as a red test.
- **Why the consolidation is not in 05b (planner, measured):** it does not fit. 05b already carries
  14 files in 4 tasks at about 90k tokens. The consolidation also rewrites the discovery page's read
  path (it reads the strategy on the user's RLS client for the rest of the page, and has its own
  `hasBuildableSeries` gate) and calls into `fetch-and-build-payload.ts`, which 167.2.1 plan 01 is
  splitting into a resolve stage and a probe while 169 is in flight. Consolidating before both have
  merged would re-open 167.2.1's probe-to-builder invariant twice.
- **Where it is tracked:** the `TODOS.md` drift-risk entry that 167.2.1 plan 04 writes (routed to
  Phase 169) and the dated routed note 167.2.1 added under ROADMAP `### Phase 169` (both on branch
  `feat/167.2.1`; neither is on this branch yet, measured 2026-09-25). The 05b SUMMARY
  names the lockstep test as the guard in force until the consolidation lands.
- ⛔ **AMENDED 2026-09-25 (orchestrator decision, following the founder's direction that a number is
  computed ONCE and every page reads it from there, D-25). The paragraphs above are kept as lineage;
  the "not in 05b" reasoning still holds, the "owned but unplanned" state does not.** Phase 169 no
  longer merely owns the consolidation: **plan 169-13 performs it**, in PR 2, wave 5.
  - **Gate:** plan 13's first task prints `ORDER PASS 167.2.1-probe-on-main` only when
    `probeFactsheetBuildable` is exported from `fetch-and-build-payload.ts` on `origin/main`, and
    `ORDER PASS 167.2.1-sc1-live-repro-on-main` only when 167.2.1's live spec is there; otherwise
    `ORDER FAIL ...` and the executor stops. That removes the second reason above (consolidating
    while 167.2.1 is splitting the builder would re-open its invariant twice).
  - **What it does:** the page calls `fetchAndBuildPayload(strategy.id, withPublishedOnly)` once and
    assembles nothing itself (D-26 for the shape). A one-path test proves the page's payload equals
    the shared path's, and that the page renders if and only if `probeFactsheetBuildable` answers
    buildable (167.2.1 D-04). Plan 13 then re-runs 167.2.1 plan 01's parity table and SC1 live
    reproduction on the local lane and records both (167.2.1 D-09).
  - **The 05b lockstep test:** NOT deleted from 05b. PR 1 ships with the duplicate, so the test is the
    only guard for the PR 1 to PR 2 window. Plan 13 deletes it once one path makes it redundant, and a
    source guard in `phase-147-series-resolution-guards.test.ts` (the page calls
    `fetchAndBuildPayload` and none of the assembly helpers) replaces it.
  - **Tracking:** 167.2.1's `[167.2.1-DISCOVERY-DETAIL-DOUBLE-ASSEMBLY]` TODOS entry and its "Routed
    in, 2026-09-25 (Phase 167.2.1 D-03)" ROADMAP note are not on this branch (measured 2026-09-25;
    both arrive with 167.2.1's merge). Plan 13 ticks the TODOS entry when it lands, or records that it
    is absent; a dated line under ROADMAP `### Phase 169` names plan 13 as the owner.
  - **Checkpoint:** plan 12's PR 2 browser check includes the discovery detail page against the same
    strategy's factsheet.

### D-24: Plans 05a and 05b are accepted at 13 and 14 files (planner, round-3 W3, 2026-09-25)
- 05a is 13 files after W1 (the dated NEUTER-D record file left its list). 05b is 14. **Reason:** in
  each, half the files are tests or the one shared snapshot; every source file carries one edit for
  one concern; no task touches more than 6 files. Splitting further would put the same shared
  `types.ts`, `build-payload.ts` and snapshot in a third sequential plan and add a wave to PR 1 for
  no reduction in any single task's context.
- **Reversibility:** reversible (packaging only).
- **Note 2026-09-26 (plan-check round 3 INFO):** plan 169-02 (old 05a) now lists 14 files; the 14th,
  `page.public-cache-key.test.tsx`, is touched only on its Task 3 three-part arm (D-42). The count above is lineage.

### D-25: Founder principle, 2026-09-25: "calculate Sharpe once; every page reads it" (founder direction, recorded by the orchestrator)
- **The rule:** any CAGR, Sharpe or record-length figure a page shows comes from the STORED metric or
  from ONE shared function. It is never a local re-computation on the page. It applies to every
  Phase 169 plan and is the reason D-23 now names a plan.
- **Audit of 169's plans against it (planner, 2026-09-25, by reading each plan and the code it
  names):**
  - Compliant, stored metric: the factsheet headline CAGR / Sharpe for single-key strategies (plan
    04, D-10, through the one owner `readSingleKeyBasisOpts`); the OG card (plan 04); discovery,
    recommendations and my-strategies already read the persisted values. The "not rankable" arm of
    plan 04 never renders a factsheet, because rankable is the same predicate as 167.2.1's G1 gate
    (`isRankableAnalyticsRow` delegates to `isComputedAnalytics`, measured).
  - Compliant, one shared function: the return windows MTD to 5Y (`compute()`, plan 06; plan 07
    deletes MetricsColumn's local `periodReturn`); record length (plan 07's `formatRecordLength` over
    `compute()`'s calendar `years`, no site divides a count by 252); the comparator numbers (`compute()`
    and `jointMetrics` over one bounded series, 05a; the browser re-derive gets the same prices, 05b);
    the Allocations alpha/beta widget (plan 11 calls `jointMetrics`, the function the Overview uses).
  - **Found and planned, 2026-09-25:** after plan 04 the cash headline is the persisted value, but
    `basis-context.tsx`'s levered arm re-pins Sharpe and Sortino to the persisted values only for the
    MTM and smoothed bases, on the premise that cash "already equals the client recompute". Plan 04
    makes that premise false, so on the cash basis at leverage L > 0, L != 1, Sharpe and Sortino would
    jump from the persisted value to the client recomputation. **Owner: plan 04, Task 2, step 5**
    (extend the existing re-pin to `metricsByBasis.cash_settlement`; test and neuter).
  - **Found and planned, 2026-09-25:** the discovery detail page's own assembly (plan 13, D-23).
  - **Remaining local computation, not removed by 169, with its owner:** (i) the levered and MTM
    re-derive of the leverage-VARIANT scalars (CAGR, volatility, drawdown, Calmar) in
    `basis-context.tsx`. No stored value exists for a levered view, and they come from one shared
    function (`deriveSeriesBundle` / `compute()`), so this is compliant by the second arm; no owner
    needed. (ii) Allocations book-level CAGR / Sharpe on the Overview and Scenario: Phase 167.1.2
    ACCOUNTTRUTH (excluded from 169 by founder decision). (iii) TypeScript Sharpe and dispersion
    sites outside the factsheet, which Phase 166.1 QSTATSRECOMPUTE is re-planning under the same
    principle. Cross-reference by file only, not duplicated here: `src/lib/sample-basis-ratios.ts`,
    `src/app/(dashboard)/compare/lib/holding-compare-adapter.ts`, `src/lib/scenario.ts`,
    `src/lib/diversification.ts` (166.1 plan 04); `src/lib/correlation-math.ts`,
    `src/lib/portfolio-stats.ts`, `src/app/(dashboard)/allocations/lib/scenario-benchmark.ts`,
    `scenario-stress.ts`, `widgets/risk/CorrelationMatrix.tsx` (166.1 plan 05); and
    `src/lib/factsheet/compute.ts`, `og-metrics.ts`, `bootstrap.ts`, `joint.ts`, `rolling.ts`,
    `comparator-block.ts`, `build-payload.ts`, `allocator.ts` (166.1 plan 06, measured on branch
    `feat/166.1` at `a7240515d`). ⚠️ 166.1 plan 06 edits `compute.ts`, `comparator-block.ts` and
    `build-payload.ts`, which 169 plans 05a, 05b, 06 and 07 also edit: whichever phase merges second
    rebases, as D-22 does for 167.2.1.
  - ⛔ **CORRECTED 2026-09-26 (from 166.1 CONTEXT D-19, re-planned at `d1bd9f50f`); the list above is
    kept as lineage.** 166.1 does NOT edit `comparator-block.ts`: it fixes that site at its source,
    `compute()`'s `ann_vol`, so drop it from 169's overlap list. For `og-metrics.ts`, 166.1 plan 06
    owns only the arm of `computeOgHeadline` that still COMPUTES a Sharpe (replaced by the shared
    `sharpe(...)`, 30-observation gate kept); 169 plan 04 keeps the persisted read for rankable rows.
    Different edits in the same function: whichever phase merges second rebases. 166.1 does not edit
    `og-metrics.test.ts`.
  - ⭐ **Executable step, 2026-09-26 (final plan-check W1).** The rebase duty above had no step that
    runs it. It now has two, mirroring D-22's for 167.2.1. **PR 1:** plan 05b Task 4 step 0b detects
    166.1 on `origin/main` (`src/lib/return-stats.ts` present, and `@/lib/return-stats` imported by
    `og-metrics.ts` and by `compute.ts`, measured absent 2026-09-26). If 169 merges second, it
    reconciles `computeOgHeadline` (169 plan 04's persisted read for rankable rows kept, 166.1's
    shared `sharpe(...)` arm kept for the rest, 30-observation gate kept), re-runs the og-metrics,
    compute and build-payload snapshot suites, classifies every moved snapshot key (a move caused
    only by 166.1's `ann_vol` residue fix on a constant-yield fixture is expected; any other move is
    a defect), and records all of it in the 05b SUMMARY. **PR 2:** plan 12 Task 2 step 0 runs the
    same detection before PR 2 merges, because 14b edits `deriveSeriesBundle` in `build-payload.ts`,
    which 166.1 plan 06 also edits.
- **Reversibility:** n/a (a standing rule).

### D-26: The shape of plan 13's consolidation (planner, 2026-09-25)
- **One call, uncached:** `fetchAndBuildPayload(strategy.id, withPublishedOnly)`, never the v2 page's
  cached wrapper. The page was uncached before; the cached public lane lags up to 1 h (167.2.1 D-11,
  the Phase 148 TODO), and the probe's invariant is stated on the uncached function.
- **Trust tier:** `fetchAndBuildPayload` passes `trustTier: null` and the v2 page overlays the tier
  after the build (`payloadWithTrust`). The discovery page overlays it the same way, from its
  `getStrategyDetail` projection.
- **A stale series behind a failed computation:** the page today builds from the previous run's
  series when the latest computation did not succeed (it has no G1 gate). After plan 13 it shows the
  KCS-10 sentence, as the public factsheet and the share page do. That is a behaviour change, and it
  is the correct one: it is the STALE-01 side door closed on the last surface that still had it.
- **`getStrategyDetail` stays** for the header, breadcrumb, `disclosureTier`, the slug guard and the
  published gate. Its discovery-only analytics projection existed only for the removed assembly
  (the queries.ts docblock names this page's reads as its MUST-STAY list), so plan 13 removes it
  rather than leave a projection that reads a return series twice per page load and a comment that
  is no longer true.
- **Any other divergence** the executor finds between the two paths is not decided here: plan 13
  stops and reports it.
- **Reversibility:** reversible.

### D-27: The KPI strip and the metrics rail follow the MasterBrush zoom window (FOUNDER DECISION, 2026-09-25; planned 2026-09-26)
- **Founder, verbatim (2026-09-25):** "when I look at a different time, it should adjust all KPIs, as
  why would I want to zoom into a certain part of the strategy?" Asked through AskUserQuestion where
  the work goes, the founder chose **"Add to 169's plans"**. Recorded as ROADMAP `### Phase 169`
  success criterion 10 on 2026-09-26.
- **Owner: plan 169-14**, PR 2, wave 5 (after 07, which owns `MetricsColumn.tsx` in wave 4; file-disjoint
  from 13, which runs in the same wave).
- **The rule.** When the shared zoom window (`useXRange`, the one `MasterBrush` and every chart
  already drive) is narrower than the full history, every window-dependent KPI is recomputed on the
  selected slice of the ACTIVE view's daily returns (`useBasisSeriesView`: the active basis, and the
  levered series when leverage applies). The recompute is the EXISTING shared path:
  `deriveSeriesBundle` in `build-payload.ts`, which calls `compute()` in `compute.ts`, `jointMetrics`,
  `worstDrawdowns`, `quantileSummary` and `bootstrapCI`, called with the same arguments the leverage
  arm of `useBasisSeriesView` already uses (one argument builder shared by both arms, so they cannot
  drift). No new formula (D-25: compute once, one shared function).
- **Full history vs a selection (planner, measured).** The range is "full history" when its start is
  index 0 and its end reaches the shorter of the cash axis end and the active view's axis end. That
  covers the initial and reset range (`fullRange` is cash-sized) under every basis, including an MTM
  axis longer or shorter than cash. At full history the strip and the rail show exactly what they
  show today, BY REFERENCE (the stored, persisted and overlaid values of plan 04, D-10, and the
  leverage re-pin of D-25). Resetting the zoom therefore restores the stored values.
- **No persisted value inside a window.** The persisted scalars and the leverage re-pin of Sharpe and
  Sortino describe the WHOLE record, so the window arm applies neither.
- **What follows the window:** the KPI strip's seven scalars, its alpha and IR, and its short-track
  caveat; in the rail, Compound Performance (start, end, years), Main Metrics (strategy and benchmark
  columns, and the observation warning), the Returns panel's Win Rate and Profit Factor, Max Drawdown,
  Bootstrap CI, Best / Worst Period, Worst 10 Drawdowns, Extended Metrics (quantile rows included) and
  §IV Joint Metrics. The benchmark figures run on the comparator block the same bundle builds on the
  slice's dates, so 05a's covered span and `through` rule (D-09) hold inside a window too.
  Rolling Metrics reads the full-history rolling arrays RESTRICTED to the window's indices, so the
  table summarises exactly the values the rolling charts draw in that window.
- **Calendar-anchored figures (the explicit decision).** MTD, YTD, 3 Month, 6 Month, 1 Year, 3 Year,
  5 Year and Since Inception end on the RECORD's last date, not the window's. They are **hidden while
  a range is selected** (the Returns panel's trailing rows and its benchmark cells, and the whole
  Cumulative Return Metrics panel), and one sentence in the Returns panel says why and how to see
  them. **Reason:** shown beside window figures, a full-record "1 Year" reads as the window's; kept
  and labelled, the rail would carry two CAGRs that disagree. Hiding is reversible by a reset.
  Per-calendar-year figures (EOY Returns, Calmar by Year) and the §III Style section (style drift,
  peer percentile, own-book delta, precomputed or cohort-ranked on the full record) stay full history
  and carry a "Full history" label while a range is selected.
- **The label.** Both the strip and the rail carry one data eyebrow stating the range the numbers
  cover: "Full history: <start> – <end>" or "Selected range: <start> – <end>" (DESIGN.md data-eyebrow
  voice: Geist Mono, uppercase, tracked, muted; dates in the rail's existing date format).
- **Short slices.** A slice with fewer than 2 observations renders every window figure as the em-dash
  (the same floor `buildFactsheetPayload` refuses below). From 2 to 251 observations the figures show
  with the existing short-track caveat, stated with the WINDOW's count. The zoom clamp already keeps a
  window at 5 or more observations; the floor guards the pure function, not a reachable UI state.
- **Scope of mounts.** The behaviour lives in `FactsheetBody`, so it applies on every mount of it (the
  factsheet, the share page, the discovery detail page, the `/allocations` Overview). At full history
  each mount is unchanged, so no 167.1.2-owned value moves.
- **Known limit, recorded not fixed:** the window arm passes `isArithmetic: false`, exactly as the
  leverage arm does today (the payload carries no cumulative-method flag). On a composite persisted
  with the arithmetic method, the window's cumulative return and CAGR are geometric while its equity
  chart is arithmetic. The full-history headline is unaffected. Reported to the orchestrator on
  2026-09-26 for a routing decision; not silently absorbed.
- **D-25 audit:** compliant by the second arm (one shared function).
- **Reversibility:** reversible (a client hook and its readers; no stored data, no payload shape change,
  no cache key bump).
- ⛔ **AMENDED 2026-09-26 (FOUNDER DECISION): the known limit above is FIXED, not recorded.** Asked
  through AskUserQuestion, the founder answered, verbatim: **"Fix it in plan 14 (Recommended)"**. The
  "Known limit, recorded not fixed" paragraph and the "no payload shape change" clause of the
  Reversibility line are kept as lineage; they describe plan 14 alone.
  - **Where the method is stored (measured 2026-09-26).** A composite's compounding method is frozen
    at stitch into `strategy_analytics.data_quality_flags.cumulative_method` (the RAW worker string
    `"simple"` or `"geometric"`; `job_worker.py` sets `merged_flags["cumulative_method"]`).
    `readCompositeFactsheet` (`composite-read-path.ts`) prefers that persisted value and falls back to
    `attributionBasisFromConfig(returns_denominator_config)` for older composites, mapping `"simple"`
    to `"arithmetic"`, and hands it to the builder as `buildOpts.cumulativeMethod`.
    `buildFactsheetPayload` turns it into `isArithmetic` for its three `deriveSeriesBundle` calls
    but does not put it on the payload, which is why the browser arms pass a literal `false`.
  - **What the arithmetic method changes (measured in `metrics.py`'s `compute_all_metrics`, the
    `cumulative_method == "simple"` arm).** The whole triple moves together: cumulative return is
    the sum of daily returns, equity is 1 + that sum, the drawdown comes off the running-sum series
    (TS already has both: `arithmeticEquity`, `arithmeticUnderwater` in `compute.ts`), and the
    annualized return is the mean daily return times `periods_per_year`, over the composite's
    calendar-dense series (`gap_fill_daily_returns` reindexes to `freq="D"` with 0.0). Calmar
    follows. `isArithmetic` today moves only the CURVES in `deriveSeriesBundle`
    (`strategyEquity`, `strategyDrawdowns`, `strategyWorst10`, the comparator's `cumVsBench`); its
    `strategyMetrics` still come from `compute()`, which is geometric. So passing the flag alone
    would NOT fix the windowed cumulative return or CAGR.
  - **The fix (plan 14b).** (1) `FactsheetCommon` gains optional `cumulativeMethod`
    (`"geometric" | "arithmetic"`), which `buildFactsheetPayload` emits from `opts.cumulativeMethod`
    (absent on single-key payloads, so they stay byte-identical). (2) `deriveSeriesBundle`, when
    `isArithmetic`, returns the arithmetic triple in its own `strategyMetrics`: `cum_ret` from
    `arithmeticEquity`, `max_dd` from `arithmeticUnderwater`, `cagr` as the sum of returns over
    the slice's calendar-day count times `periodsPerYear` (the gap-day-invariant form of the Python
    mean over the 0.0-filled calendar series), and `calmar` from those two. The bundle's metrics
    then agree with its own curves, as Python's do. It is the one shared function (D-25), not a
    page-local formula. (3) The one argument builder plan 14 extracts in `basis-context.tsx` passes
    `isArithmetic: payload.cumulativeMethod === "arithmetic"` for BOTH arms. For the leverage arm
    this is a no-op by construction: `leverageEligibleFor` excludes a payload whose
    `dataQuality.composite` is true, and single-key payloads carry no method. (4) A red-first test
    on an arithmetic composite fixture pins the windowed cumulative return, CAGR and Max DD to the
    arithmetic values and to the endpoint of the equity curve the chart draws.
  - **Packaging (planner).** The fix is plan 14's second half, **169-14b**, as D-18 split 05 into
    05a and 05b. It adds six files and a task to a three-task, seven-file plan already estimated at
    90k tokens, and `build-payload.ts` is also edited by plan 13 in wave 5, so the fix has to run
    after 13 anyway (D-13 as amended again 2026-09-26). The founder chose WHERE the fix lives (Phase
    169's zoom work, not a later phase); 14b is that work's second plan. Reported to the orchestrator
    so the founder can object to the split.
  - **Remaining limit, recorded and reported (not silently absorbed).** Python also has a
    `day_basis` convention (`"active"` annualizes on non-zero days only). The payload carries no
    day basis and `readCompositeFactsheet` reads none, so a window on an arithmetic composite with
    the active day basis annualizes its CAGR on the calendar basis. The full-history figures are
    unaffected. Reported to the orchestrator on 2026-09-26 for a routing decision.
- **Amended 2026-09-26 (final plan-check W2): the Scenario mount follows the window.**
  `ScenarioFactsheetChart.tsx` mounts `FactsheetBody` a fifth time, and its `PeriodControl` drives
  the same `setXRange`. By the founder's principle ("when I look at a different time, it should
  adjust all KPIs") it gets no opt-out: the window arm runs there too. Two measured facts decide
  what it shows. (a) `buildScenarioFactsheetPayload` builds its comparators with
  `inertComparatorBlock` (summary and joint null) and holds correlations and style drift empty or
  null on purpose. So the window arm takes from the slice bundle ONLY the fields the follow-list
  above reads (`dates`, `strategyReturns`, `strategyEquity`, `strategyDrawdowns`, `strategyMetrics`,
  `strategyWorst10`, `quantiles`, `bootstrapCI`, and each comparator block), and a comparator block
  whose summary and joint are both null in the base view stays the base block. A window never fills
  a block the full history holds unavailable, and it never fabricates correlations. (b) The Scenario
  payload carries no `periodsPerYear`, which every other mount's payload carries
  (`buildFactsheetPayload` emits it; the Overview's `allocator-portfolio-payload` goes through it).
  The window arm refuses to annualize on a guessed basis, the same fail-closed rule as the leverage
  arm's guard. So on the Scenario mount a selected range shows the "Selected range" eyebrow, every
  window figure as the em-dash, and one sentence saying the range figures need an annualization
  basis this view does not carry and that a reset shows the full-history figures. It never shows
  full-history numbers under a "Selected range" label. **Ownership boundary:** the Scenario's
  full-history values stay Phase 167.1.2's (D-25 (ii)); 169 does not edit
  `scenario-factsheet-payload.ts`. Giving that payload a `periodsPerYear` would also switch on the
  leverage control there (`leverageEligibleFor` reads the same field), a full-history behaviour
  change on a 167.1.2 surface, so it is reported to the orchestrator rather than done here.
- **Amended 2026-09-26 (final plan-check W3): the full-history eyebrow states the VIEW's dates.** The
  initial and reset range is cash-sized, so on an MTM axis longer than cash the range's end index
  is not the view's last day. At full scope the eyebrow reads the view's first and last dates
  (`dates[0]` and the last element); only a selected range reads the dates at its clamped indices.
- ⛔ **Amended 2026-09-26 (orchestrator decisions, see D-28 to D-31):** point (2) of "The fix (plan
  14b)" above, which put the arithmetic triple in `deriveSeriesBundle`, is SUPERSEDED by D-28: the
  triple lives in `compute()`. The "Remaining limit" paragraph (day basis) is SUPERSEDED by D-30: it
  is fixed in 14b. The Scenario paragraph's "reported to the orchestrator" is closed by D-29. The
  text above is kept as lineage.

### D-28: Plan 14b is the founder's "Fix it in plan 14", and the conventions live in `compute()` (orchestrator decision 1 + planner, 2026-09-26)
- **Orchestrator, 2026-09-26:** the split of the founder's "Fix it in plan 14 (Recommended)" into
  plan 14b is ACCEPTED. It is the same outcome for the same page, split for a measured budget reason
  (plan 14 was three tasks, seven files, ~90k tokens, and the fix has to run after plan 13's edit of
  `build-payload.ts`). It HONOURS the founder's decision: the founder chose where the fix lives
  (Phase 169's zoom work), and 14b is that work's second plan, as D-18 split 05 into 05a and 05b.
- **Where the arithmetic logic lives (planner, amends D-27 point (2)).** Plan 14d (D-31) must give
  `compute()` the compounding method, because its calendar windows and buckets are computed there
  and a second implementation of D-11's cutoffs elsewhere would break D-25. Keeping 14b's triple as a
  post-hoc override in `deriveSeriesBundle` would then put arithmetic logic in two places (Rule 7).
  So 14b gives `compute()` ONE optional conventions argument (`cumulativeMethod`, `dayBasis`,
  `calendarDense`; absent means geometric, calendar, observation-count, so every existing caller is
  byte-identical) and puts the triple there: under arithmetic, `eq` and `dd` come from the existing
  `arithmeticEquity` / `arithmeticUnderwater`, `cum_ret` is the equity's last value minus 1,
  `max_dd` the underwater minimum, `calmar` CAGR over |Max DD|, and every drawdown-derived figure
  (`longest_dd`, `pain_index`, `ulcer_index`, `recovery_factor`) rides the same arithmetic
  drawdown. `deriveSeriesBundle` passes the conventions through and its two curve ternaries read
  `compute()`'s own `eq` / `dd`.
- **Consequence, stated:** on an arithmetic composite the full-history extended metrics
  (Longest DD, pain, ulcer, recovery factor) move from the geometric drawdown to the arithmetic
  drawdown the chart and the Worst 10 table already draw. Before the fix they disagreed with their
  own page. The seven `BASIS_KPI_MAP` scalars are still overlaid from the persisted basis, so the
  KPI strip at full history does not move.
- **Consequence for 166.1:** 166.1 plan 06 also edits `compute.ts`. Plan 12 Task 2 step 0 (D-25 W1)
  covers `compute.ts` as well as `build-payload.ts`: whichever phase merges second rebases.
- **Reversibility:** reversible (an optional argument; default path byte-identical).

### D-29: The Scenario mount withholds window figures; its annualization basis is 167.1.2's (orchestrator decision 2, 2026-09-26)
- **ACCEPTED:** on the `/allocations` Scenario mount a selected range shows the em-dash for every
  window figure with the missing-annualization sentence (D-27 as amended, W2). Fail-closed: no
  guessed annualization.
- Giving `buildScenarioFactsheetPayload` a `periodsPerYear` would also switch on the leverage control
  there (`leverageEligibleFor` reads the same field), a full-history behaviour change on a
  167.1.2-owned surface. It is NOT planned in 169. Booked in `TODOS.md` as
  `[169-SCENARIO-WINDOW-ANNUALIZATION]`, owner Phase 167.1.2, with its trigger and gate.
- **Reversibility:** reversible.

### D-30: The day basis is carried and applied in plan 14b (orchestrator decision 3 + planner, measured 2026-09-26)
- **Orchestrator, 2026-09-26:** FOLD the day-basis gap into 14b, red-first.
- **Where the engine stores it (measured).** `compute_all_metrics` takes `day_basis`
  (`"calendar"` / `"active"`). Its INPUT is `returns_denominator_config.metrics_basis`, mapped by
  `metrics_day_basis` (`active_day` to `active`, `calendar_day` to `calendar`), in both
  `run_stitch_composite_job` and `run_csv_strategy_analytics`. It is NOT frozen into
  `data_quality_flags` (only `cumulative_method` is, and only for composites). Its one FROZEN copy
  is the `conventions` echo `derive_basis_series` writes into every persisted series row
  (`strategy_analytics_series` kinds `cash_settlement`, `mtm_daily_returns`,
  `smoothed_mtm_daily_returns`), the divergence-guard anchor the round-trip recomputes against. The
  `cash_settlement` row is persisted before the scalar flip since Phase 105, on both paths.
- **The source (planner).** One resolver in `composite-read-path.ts` returns `{ cumulativeMethod,
  dayBasis }`. Method: persisted `data_quality_flags.cumulative_method` (HARD-03's tier, kept) then
  the `cash_settlement` row's `conventions.cumulative_method` then `attributionBasisFromConfig`.
  Day basis: the `cash_settlement` row's `conventions.day_basis` then the config's `metrics_basis`
  then `"calendar"`. **Why not a Python freeze into `data_quality_flags`:** it would exist only for
  rows computed after the deploy, and ledger venues never re-compute; the echo exists today. **Why
  not the live config first:** it can be edited after publish without a recompute, the drift
  HARD-03 closed for the method. One JSON-path read (`payload->conventions`) of the one row, never
  the whole series; a read error degrades to the config tier with a logged error, never a throw.
- **Scope: the engine's whole rule, not CAGR alone.** Under `"active"` the engine computes the
  headline volatility, Sharpe and Sortino over the non-zero days, under ANY method, and the
  arithmetic CAGR as the mean of those days times `periods_per_year`. `compute()` applies the same
  rule under its conventions argument. A field named `dayBasis` that moved only CAGR would claim a
  convention it does not carry.
- **`calendarDense` (measured).** The arithmetic calendar-basis CAGR is a MEAN, and its denominator
  depends on how the engine conditioned the series: a composite is densified with `zero_fill`
  (every calendar day, gaps as 0.0), a single-key series with `sparse` / `broker_nan` (observed days
  only). So the mean runs over the calendar-day count on a composite and over the observation count
  on a single-key strategy. The browser builder sets `calendarDense` from
  `payload.dataQuality?.composite === true`, which is the same fact.
- **Payload:** `FactsheetCommon` gains optional `dayBasis` beside optional `cumulativeMethod`; the
  window and leverage arms both pass them through the one argument builder.
- **Stated limits, not fixed (reported 2026-09-26):** (i) on the CALENDAR basis the engine's
  composite volatility, Sharpe and Sortino run over the zero-filled calendar series, while the
  browser's windowed ones run over the present days, so a windowed Sharpe on a composite with
  interior gaps differs from what the engine would compute for that window. Full-history figures
  are the persisted ones and do not move. (ii) The rolling Sharpe chart's day basis is unchanged.
- **Reversibility:** reversible.
- ⛔ **AMENDED 2026-09-26 (plan-check revision, orchestrator): both stated limits above are FIXED,
  not recorded.** (i) is fixed in plan **169-14e** (D-32): on the calendar basis a composite's
  windowed and per-basis volatility, Sharpe and Sortino run over the zero-filled calendar series,
  as the engine's do. (ii) is fixed in plan **169-14e** (D-33): the rolling Sharpe runs on the
  headline's day basis. The "Stated limits, not fixed" bullet is kept as lineage; it describes
  plan 14b alone.

### D-31: Two pre-existing number-truth defects become plans 14c and 14d (orchestrator decision 4 + planner, 2026-09-26)
- **14c: a single-key strategy's compounding method.** The single-key arm of
  `fetchAndBuildPayload` passes no `cumulativeMethod`, so a single-key strategy configured for simple
  compounding (`returns_denominator_config.cumulative_method = "simple"`, the reference strategy's convention,
  which is single-key and config-bearing) draws geometric curves beside persisted arithmetic
  headline scalars. **Root cause:** only the composite arm resolves the method. **Fix:** the D-30
  resolver runs in `readSingleKeyBasisOpts`, the declared one owner of the single-key opts, so the
  single-key payload carries `cumulativeMethod` and `dayBasis` from the same tiers (a single-key
  `data_quality_flags` carries no `cumulative_method`, so the conventions echo is its first tier).
  **Consequence:** from 14c on, a single-key payload CAN carry `cumulativeMethod: "arithmetic"`, so
  14b's "leverage arm no-op" holds only for payloads without a resolved method. The levered view of
  an arithmetic strategy is then arithmetic, which is exact (the sum is linear in leverage), and
  14c pins it.
- **Refined the same day (planner, measured):** the resolver is NOT called inside
  `readSingleKeyBasisOpts`. Its tests pin a hot path that constructs no admin handle and returns
  `{}` for a non-options strategy, and an unconditional read there would break those pins and its
  documented posture. 14c adds a sibling, `readSingleKeyConventions`, in the same file, which the
  single-key arm of `fetchAndBuildPayload` (the one assembler of single-key opts after plan 13)
  calls beside `readSingleKeyBasisOpts`. The tier logic still lives only in the resolver. 14b makes
  the conventions read survive a thrown query chain as well as an `error` result, so the existing
  route and page mocks, which do not answer the new query, stay green. The sentence above naming
  `readSingleKeyBasisOpts` is kept as lineage.
- **14d: calendar windows and buckets on arithmetic series.** `compute()` compounds MTD, YTD, 3M,
  6M, 1Y, 3Y, 5Y and the weekly / monthly / quarterly / yearly buckets (best and worst rows, EOY)
  geometrically; `monthlyReturnsMatrix` (the heatmap cells and its YTD column) and `calmarByYear`
  do too. The engine's `simple` arm sums every one of them (`_bucket_return`, the monthly grid).
  **Root cause:** those three functions hard-code the product. **Fix:** they follow the same
  conventions argument D-28 introduces; D-11's cutoffs and coverage rule stay the only
  implementation. D-27 hides the calendar rows while a range is selected, so this is full history
  and each basis view.
- **Waves.** 14c and 14d are file-disjoint and both follow 14b in wave 7 (14c edits the read path,
  14d edits `compute.ts`, `period-buckets.ts`, `calmar-by-year.ts` and `build-payload.ts`, all after
  14b). Plan 12 depends on both and moves to wave 8, with a browser line for each.
- **Reversibility:** reversible.
- ⛔ **AMENDED 2026-09-26 (D-35):** plan 12 moves again, to wave 10, behind plans 14e (wave 8) and
  14f (wave 9). The sentence above is kept as lineage.

### D-32: A composite's calendar-basis risk statistics run over the zero-filled calendar series (orchestrator, plan-check blocker 1, 2026-09-26)
- **The defect D-30 (i) recorded.** On the calendar basis the engine computes a composite's
  headline volatility, Sharpe and Sortino in `compute_all_metrics` over the series
  `run_stitch_composite_job` hands it, which is `gap_fill_daily_returns` of the stitched series
  (`densify_policy="zero_fill"`: every calendar day from the first to the last, gaps as 0.0). The
  browser's `compute()` runs them over the present days. So on a composite with interior gaps a
  windowed Sharpe differed from the engine's for the same window, and the founder's rule (D-27:
  zooming recomputes ALL KPIs, and every number agrees with the engine) was broken for three of
  the strip's seven figures. Recording it was not enough; it is fixed.
- **The fix (plan 169-14e).** ONE exported helper in `compute.ts` returns the series the headline
  risk statistics run over, and each `dates[i]`'s position in it: under `dayBasis: "active"` the
  non-zero finite returns (the engine's `stat_returns`); under the calendar basis with
  `calendarDense` the zero-filled calendar series from `dates[0]` to the last date; otherwise the
  returns as given. `compute()` feeds that series to the mean, deviation and downside sum behind
  `ann_vol`, `sharpe` and `sortino`, and nothing else (skew, kurtosis, VaR, CVaR, win rate and
  profit factor stay on the returns as given, as the engine's do; D-36). Plan 14b writes its
  active-day filter AS this helper (`metricsBasisSeries`, the active and pass-through branches);
  14e adds the density branch and its callers, so the rule lives in one place.
- **Plan 14b's test.** 14b's tracer bullet 3 asserted that windowed Sharpe, Sortino and Ann. Vol on
  the gapped composite fixture equal `compute()` of the present days, which pinned the defect.
  It now states the engine value as the truth and asserts only what 14b can make true: the
  arithmetic and geometric builds agree on the three figures, and on a GAPLESS twin they equal
  `compute()` of the slice (zero-filling a gapless series is the identity). 14e asserts the gapped
  value red-first in its own tracer test.
- **Full history.** The composite strip's seven `BASIS_KPI_MAP` scalars are overlaid from the
  persisted basis, so the strip does not move at full history. Each basis bundle's
  `strategyMetrics.ann_vol` / `sharpe` / `sortino` DO move on a gapped composite (they were
  present-day figures); these are the expected snapshot moves, and only on a fixture that is a
  composite with interior gaps or carries `dayBasis: "active"`.
- **Reversibility:** reversible (the default path is byte-identical; D-36).

### D-33: The rolling Sharpe runs on the headline's day basis (orchestrator, plan-check blocker 2, 2026-09-26)
- **The engine's rule (measured):** `compute_all_metrics` sets
  `_rolling_basis = stat_returns if day_basis == "active" else returns` and computes its rolling
  Sharpe on it; rolling volatility and rolling Sortino run on `returns`.
- **The fix (plan 169-14e).** `deriveSeriesBundle` feeds `rollingSharpe` the D-32 helper's series
  and maps the result back onto `dates` through the helper's positions, null on a day the basis
  excludes, so the array stays index-aligned with `dates`: plan 14's window restriction and
  `RollingMetricsPanel`'s "Now" (the last non-null value in the window, `rollingStats`) keep
  working unchanged. On a calendar composite that is the zero-filled series; a filled day has no
  entry in `dates` and is not mapped back. The window length stays `pickRollingWindow(stratRet
  .length)`; a basis series shorter than it gives an all-null array, recorded, not special-cased.
  Rolling volatility and rolling Sortino are not changed.
- **Red-first test:** an active-basis payload built by `buildFactsheetPayload` whose non-zero day
  count equals the picked window: the rolling Sharpe at the last active date equals the headline
  Sharpe; every zero-return index is null.
- **Measured consequence, REPORTED to the orchestrator for a decision, not resolved here.**
  `TimeSeriesChart.tsx`'s `buildPath` starts a new subpath after every null, and today the only
  nulls are the leading warm-up. Under the active basis the rolling Sharpe line therefore breaks
  at every zero-return day. The named alternative is to carry the last active value across an
  excluded day (the engine's value as of that date; the same "Now", minimum and maximum, a
  different average, a continuous line). The brief specified null; 14e follows it and plan 12's
  browser check looks at the chart.
- **Reported residual, not fixed (brief: "rolling vol and rolling Sortino stay on `returns`, as
  in the engine").** On a calendar composite the engine's `returns` is the zero-filled series and
  the browser's is the present days, so the rolling volatility and rolling Sortino on a gapped
  composite still differ from the engine's. Reported to the orchestrator.
- **Reversibility:** reversible.

### D-34: The bootstrap CI and the stress windows follow the headline's method and day basis (orchestrator, plan-check warning 4, 2026-09-26)
- **Rule (founder, D-27):** every figure beside a headline agrees with it; excluding a panel from
  the rule is not an option.
- **Bootstrap (plan 169-14f).** `deriveSeriesBundle` passes `bootstrapCI` the D-32 helper's series
  (the day basis and the density), and `bootstrapCI` gains one optional method argument under
  which `headlineStats`' drawdown comes from `arithmeticUnderwater`. So the point Sharpe, Sortino
  and Max DD equal the headline's for the same series. Max DD is invariant to inserted or removed
  zero days (a 0.0 return advances neither the sum, the product nor the peak), so feeding the
  basis series moves no drawdown. `n` is the resampled series' length, as its own contract says
  (the reliability gate reflects the series resampled); every reader of it is listed in 14f's
  SUMMARY. No new ratio expression (D-36).
- **Stress windows (plan 169-14f).** `computeStressWindows` gains one optional method argument:
  under arithmetic, the strategy's window return is the sum and its window drawdown the minimum of
  `arithmeticUnderwater` over the window, reusing the helpers. The benchmark stays geometric (its
  headline beside it is `compute()` with no conventions). The day basis and the density do not
  move a sum, a product or an underwater minimum, so they are not threaded; a zero-insertion twin
  pins that. The coverage ratio stays on observed days: it is the no-invented-data guard that
  decides whether a named window is shown at all, not a statistic.
- **Scenario:** `buildScenarioFactsheetPayload` calls both functions without the new argument and
  stays byte-identical (a 167.1.2 file, not edited; D-29).
- **Reversibility:** reversible.

### D-35: Packaging of D-32 to D-34 (orchestrator + planner, measured 2026-09-26)
- **Orchestrator:** both blockers go in a NEW plan **169-14e** in wave 8 (14b is at 10 files and
  ratio 0.95); warning 4 goes in a sibling **169-14f** if it does not fit 14e.
- **It did not fit, and a same-wave 14f is not file-disjoint (measured).** Both halves edit
  `deriveSeriesBundle`'s call sites in `build-payload.ts` (14e the rolling Sharpe, 14f the
  bootstrap and stress calls) and both move the `build-payload` snapshot, and a signature change
  in `bootstrap.ts` / `stress-windows.ts` cannot land in parallel with the call-site wiring (the
  type check fails in whichever worktree lacks the other half). So **14f runs in wave 9**,
  depending on 14e, and **plan 12 moves to wave 10**, not the wave 9 the brief named. This departs
  from two explicit orchestrator instructions; it is reported.
- **Dependencies (orchestrator heads-up, 2026-09-26):** 14e depends on 14b and 14d (the last
  wave-7 editor of `compute.ts`, `build-payload.ts` and the snapshot); 14f depends on 14e. Neither
  depends on plans 01 to 11, so the zoom and calculation-convention track can move to its own
  phase without new cross-edges.
- **Reversibility:** reversible.

### D-36: The day-basis and density fixes switch INPUTS, never add a ratio; the default stays byte-identical (orchestrator, plan-check warnings 1 to 3, 2026-09-26)
- **Single source (W3, D-25, and Phase 166.1 plan 07's whole-tree shape matcher).** No new
  Sharpe-, Pearson- or beta-shaped expression may appear under `src/`. Every day-basis or density
  fix switches the INPUT series and reuses the ONE existing ratio expression, or calls the shared
  `sharpe(...)` in `src/lib/return-stats.ts` when that file exists at HEAD. Two measured traps:
  (a) an arithmetic CAGR written with `periodsPerYear` inside a closing parenthesis followed by a
  division matches that matcher's first Sharpe form, so a CAGR is written as a mean times
  `periodsPerYear`, or a sum divided by a count and then multiplied; (b) the Sortino expression
  is a COUNT-PINNED allowlist entry of exactly one in `compute.ts`, `bootstrap.ts` and
  `rolling.ts`, so a second Sortino line in any of them fails as stale. A red single-source gate
  is resolved by routing through the shared function, never by an allowlist entry (plan 12 step
  0 carries this).
- **Which fields follow `dayBasis` (W2, measured in `compute_all_metrics`).** Under `"active"`
  only `ann_vol`, `sharpe`, `sortino` and the arithmetic CAGR (and so `calmar` under arithmetic)
  move. `skew`, `kurt`, `var95`, `cvar95`, `win_rate` and `profit_factor` stay on all returns.
  `compute()` shares its mean and deviation with skew and kurtosis, so the basis statistics get
  their own mean and deviation; 14b pins every non-mover.
- **The shared ratio at HEAD.** If Phase 166.1 has merged first, `compute()`'s Sharpe is already a
  call to the shared `sharpe(...)`; the basis series is then what is passed to it.
- **Byte identity (W1).** 14b's no-argument pin compares against literals FROZEN from the
  pre-change `compute()` before any edit (an inline snapshot written and committed alone, then
  append-only), over three fixtures including a zero-days one, never against a value recomputed
  by the changed code. Plans 14b, 14d, 14e and 14f edit no existing `compute*.test.ts` and no
  Scenario test.
- **Reversibility:** n/a (a standing rule for these plans).

### D-37: Phase 169 is split into five one-topic phases, and D-13's two-PR packaging retires (founder decision + orchestrator, 2026-09-26)
- **Founder decision, 2026-09-26:** one logical topic per phase, one reviewable PR each. New phases are
  registered only through the `/gsd-phase` workflow (`--insert` for a new phase, `--edit` to narrow
  one). Plans that already passed their checks are MOVED by hand, not re-planned.
- **The five phases, and the old-to-new plan ids** (the id in each moved file's frontmatter is the
  new one; bare plan numbers in lineage prose, including every decision above, are the old ones):

  | Phase | Topic | Old 169 plan -> new id |
  |-------|-------|------------------------|
  | 169 FACTSHEETTRUTH (this directory, narrowed by `--edit`) | factsheet headline, comparator coverage, windows, record length | 04 -> 169-01, 05a -> 169-02, 05b -> 169-03, 06 -> 169-04, 07 -> 169-05, new re-check 169-06 |
  | 169.1 ZOOMKPIS | the KPIs follow the zoom window and the engine's conventions | 13 -> 169.1-01, 14 -> 169.1-02, 14b -> 169.1-03, 14c -> 169.1-04, 14d -> 169.1-05, 14e -> 169.1-06, 14f -> 169.1-07, 12 -> 169.1-08 (its re-check); new 169.1-09 (the rolling Sharpe line, 169.1 D-38 to D-40, added after the split) |
  | 169.2 BENCHFRESH | the BTC benchmark is refreshed and read in full | 02 -> 169.2-01, 02b -> 169.2-02, new re-check 169.2-03 |
  | 169.3 SMALLFIXES | admin jobs, recommendations, exchanges, the mandate rule | 01 -> 169.3-01, 03 -> 169.3-02, 09 -> 169.3-03, 10 -> 169.3-04, new re-check 169.3-05 |
  | 169.4 ALLOCTRUTH | the Allocations Risk tab and alpha/beta | 08 -> 169.4-01, 11 -> 169.4-02, new re-check 169.4-03 |

  ⚠️ In this directory the SAME file name now means a different plan: `169-01-PLAN.md` was old plan 04,
  and old plan 01 is `169.3-01`. Read a bare "plan 01" in a decision above as the OLD plan 01.
- **D-13 retires (the two-PR packaging), and is kept as lineage.** Each phase is one PR. The PR
  boundary edges (`depends_on 169-05b` on old plans 07 to 11 and 14) are dropped where they carried no
  data (old 08, 09, 10), and kept only as a real same-file edge (old 07 after 05b: `MandatePanels.tsx`).
  **Kept from D-13:** the order-gate device (its last bullet). The gates keep their token names
  (`PAGETRUTH_W3_ORDER_OK`, `PAGETRUTH_13_ORDER_OK`, ...) for traceability. Their checks changed as
  follows: old 09, 10 and 08 lose both "169 PR 1" checks; old 07 loses the basis-context check (05b is in
  its own phase now) and keeps the benchmark-reader check, renamed `169.2-on-main-benchmark-reader`;
  old 11 and 14 keep both, renamed `169.2-on-main-benchmark-reader` and
  `169-on-main-basis-context-prices`; old 13 replaces its commit-message grep for plan 11 with
  `169.4-on-main-queries-benchmark-feed` (plan 169.4-02's reader call in `src/lib/queries.ts` on
  `origin/main`) and adds `169-on-main-basis-context-prices`. The 167.1.2 PR C and 167.2.1 checks are
  unchanged.
- **Cross-phase edges leave `depends_on`.** A cross-phase id does not resolve in the plan DAG
  (`computeDependencyLevels` drops it with a warning), so each one is carried by the ROADMAP
  `Depends on` line, the plan's `coupling_justified` entry and its order gate. Waves are renormalised
  per phase, the first wave being 1.
- **Execution order is NOT the numeric order.** 169.2 and 169.3 first (169.3-03 and 169.3-04 wait for
  167.1.2 PR C); then 169 (169-02 reads 169.2-01's reader; 169-05 waits for 167.1.2 PR C); then 169.4
  (it needs 169 and 169.2); then 169.1 (it needs 169, 169.4, because 169.1-01 edits `queries.ts` after
  169.4-02, and 167.2.1). ⚠️ A numeric-order run (`--from`, autonomous) would try 169.1 before its
  dependencies; follow the `Depends on` lines. **Consequence, stated:** old plans 04, 05a, 05b and 06
  shipped in PR 1 independently of 167.1.2; grouped with old 07 in one phase, they now wait for 167.1.2
  PR C too.
- **Browser checkpoints.** Old plan 12 (the PR 2 checkpoint) and old 05b's Task 4 (the PR 1
  checkpoint) are split so each phase ends with its own re-check plan covering only its own items,
  each item's check text kept verbatim (169-06, 169.1-08, 169.2-03, 169.3-05, 169.4-03). Old 05b is no
  longer the last plan of a PR, so its Task 4 moved out and it is autonomous with 3 tasks; its 167.2.1
  and 166.1 merge-order steps (D-22, D-25) moved to 169-06.
- **Success criteria** keep their original numbers in every phase, so each plan's `requirements` ids
  stay valid. A criterion several phases serve (SC3, SC4, SC9) is copied verbatim to each owner.
- **Decisions.** Each new phase's CONTEXT carries, verbatim, the decisions its plans cite, plus D-14
  and D-25, under a dated "carried from 169" header. The text here stays the lineage. New decisions for
  any of the five phases continue THIS sequence (D-38 onward) and are recorded in the owning phase's
  CONTEXT, so no two phases mint the same number.
- **Directory name.** This phase keeps the `169-pagetruth` directory: `/gsd-phase --edit` never renames
  a directory, and a rename would move every path reference in the five phases for no gain. Its title
  is FACTSHEETTRUTH.
- **Scrub.** D-31 named a real strategy; it was replaced by a neutral description before the copy, so
  the carried decisions inherit the scrubbed text.
- **Reversibility:** reversible (packaging and ordering only; no plan's substance changed).
- **Added after the split (2026-09-26, D-41):** 169-07 (a composite's failed `csv_daily_returns` read
  is answered `read_error` and never cached), wave 4, after 169-01 to 169-03; 169-06 stays last (wave 5).
  The table above is unchanged.
- **Added 2026-09-26 (D-42):** 169-08 (the phase's one rebase onto `origin/main` and the D-22 re-run), wave 4;
  169-05 and 169-07 move to wave 5 and 169-06 to wave 6, still last. The sentence above is kept as lineage.
- **Amended 2026-09-26 (D-42 as amended):** 169-08 owns the phase's wave-4 rebase, the second of two syncs; the
  first is the phase-entry merge before wave 1, gated by a new Task 1 in 169-01 and 169-04 (each plan's task count
  grows by one; no wave changes).

### D-41: A composite's failed `csv_daily_returns` read is a `read_error`, and the public cache never stores it (orchestrator (routed from 167.2.1 D-07), 2026-09-26)
- **The item.** 167.2.1 CONTEXT D-07 (round-2 revision; 167.2.1-REVIEW-R2 WR-02, 167.2.1-REVIEW-SFH-R2
  N-6) routes to "Phase 169 plan 04", now 169-01's phase (D-37): `readCompositeFactsheet` turns a failed
  `csv_daily_returns` read into an empty series, the shared resolve stage answers `composite_unbuildable`
  (a fact about the row), and `buildFactsheetPayloadCached` stores that null for the analytics run, so
  one read blip shows the placeholder on the public factsheet for up to the TTL while discovery,
  recommendations and /strategies show the strategy as live (an SC4 disagreement). The single-key path
  already throws `FactsheetReadError` out of the cache on `read_error` (167.2.1 WR-02).
- **Decision.** A new plan, 169-07, not an edit to 169-01 (which already passed plan-check and runs
  before 167.2.1's code need be on this branch). The reader throws an exported `CompositeSeriesReadError`
  carrying the PostgREST / SQLSTATE code; its success return and its `null` (missing or untrusted
  headline) are unchanged, so no existing caller or test of the reader moves. The resolve stage catches
  that class only and answers `read_error` with the code (build captures once, probe captures nothing),
  so 167.2.1's existing throw keeps it out of the cache with no change to the v2 page's code. The
  discovery detail page (dynamic, not cached) catches the same class and keeps its placeholder until
  169.1-01 removes its assembly. A returned discriminated result was rejected: it changes the reader's
  return type at every call site and in about twenty existing test cases for the same outcome.
- **Consequences, stated.** (a) A composite outage now reads as `read_error` on the owner lane and in
  /strategies' tally ("unreadable", with its code), not `composite_unbuildable` ("cannot build");
  that is the truthful answer, and `status-surface-copy.ts` is not edited. (b) D-19: no cache-key bump.
  No `FactsheetPayload` field changes; what changes is which outcome is stored, not what a stored entry
  holds, and the fix ships in the same PR as 169-02's v7 bump, so no v7 entry predates it. (c) D-22:
  169-07's order gate requires 167.2.1 on `origin/main`, so **167.2.1 MUST merge before Phase 169**;
  169-06 step 0's "169 merged first" arm is now unreachable, and the rebase that brings 167.2.1 in
  happens before wave 4, not at ship. That rebase is a D-22 item, not 169-07's: it must reconcile
  169-02's `["factsheet-v2-payload-v7", id]` key pin with 167.2.1's three-part `keyParts`
  (`computed_at` added) and move 167.2.1's own KEY SHAPE test from v6 to v7. (d) D-14: no migration.
  D-25: no figure is recomputed; this changes caching, never a number.
- **Note 2026-09-26 (D-42) on (c):** D-22's named owner ("the 169 PR 1 ship step") is retired; the rebase and
  its reconciliation are owned by plan 169-08 (wave 4), and 169-07 moves to wave 5 after it.
- **Reversibility:** reversible (one exported error class, one catch in each of two callers).

### D-42: One rebase of the phase branch, owned by a new plan 169-08 between wave 3 and wave 5 (orchestrator (plan-check blocker), 2026-09-26)
- **The blocker.** By the end of wave 3, `origin/main` carries what the phase branch lacks: Phase 169.2's
  reader, 167.1.2 PR C's modules and Phase 167.2.1's three-part cache key. So a rebase of the phase branch
  is certain, and both wave-4 order gates (169-05 Task 1, 169-07 Task 1) failed on `head-contains-origin-main`
  with no plan owning the rebase: 169-07 Task 2 disclaimed it, D-41 (c) handed it to D-22, and D-22 still
  named the retired "169 PR 1 ship step" and "05b SUMMARY". Two same-wave worktrees could each have rebased
  divergently, and a rebase inside a worktree would not move the phase branch at all.
- **Decision.** A new plan **169-08**, wave 4, `depends_on` 169-01 to 169-04, runs ALONE and INLINE on the
  phase branch (its Task 1 gate fails closed on any other branch or on a dirty tracked tree). It performs
  exactly one `git rebase origin/main` and reconciles: (a) the v2 page's keyParts become
  `["factsheet-v2-payload-v7", id, computedAt]` (169-02's two-part v7 key against 167.2.1's three-part v6
  key is a textual conflict); (b) 167.2.1's `page.public-cache-key.test.tsx` KEY SHAPE pin moves to v7, and
  its header gains a dated line naming v7 while its quote of the pre-167.2.1 id-only key stays (a v7 there
  would describe a key that never existed; the same rule as 169-02's W1 for dated records); (c) the CACHE KEY
  REALITY paragraph in `fetch-and-build-payload.ts` is 167.2.1's re-worded text with its quoted keyParts at
  v7, three parts; (d) 169-02's "exactly two files hold the v6 key string" check is restated in 169-08 as
  exactly three records, each once (the two dated NEUTER-D records and that header quote); (e) because
  169-01's edits now sit on 167.2.1's resolve-stage split, D-22's parity table and SC1 local-lane
  reproduction are re-run straight after the rebase (169-08 Task 3), not only at 169-06 step 0.
- **Waves after the change.** 1: 169-01, 169-04. 2: 169-02. 3: 169-03. 4: 169-08. 5: 169-05, 169-07 (each
  `depends_on` 169-08; their gates keep `head-contains-origin-main` and now name 169-08 as its owner; they
  never rebase). 6: 169-06 (`depends_on` adds 169-08; its SUMMARY loop and plan lists add 08). If
  `origin/main` moves after 169-08 and a wave-5 gate fails on it, 169-08 is re-run on the phase branch; no
  wave-5 plan rebases.
- **Second timing.** If 167.2.1 merges before this branch is refreshed for 169.2-01 (169-02's precondition),
  169-02 Task 3 meets the three-part key directly. It now has a three-part arm: keep `id` and `computedAt`,
  move only the version to v7, move the KEY SHAPE pin, and apply (d)'s three-record count. 169-08 then finds
  the key already reconciled and its checks still run.
- **Reversibility:** reversible (plan ordering and one cache-key reconciliation; no figure, schema or
  payload field changes).
- **Amended 2026-09-26 (plan-check round 2 blocker; orchestrator decision), the text above kept as lineage.**
  "One rebase" was wrong in effect: 169-02's precondition needs 169.2-01 on the branch at wave 2, the reader
  was on neither `origin/main` nor the phase branch at planning, so a sync before wave 2 was certain and no
  plan owned it; and in the second timing the 169-01 vs 167.2.1 overlap met no stated rule. The phase branch
  now takes in `origin/main` exactly **twice**, each sync with one owner:
  1. **The phase-entry sync, before wave 1.** The orchestrator merges `origin/main` (carrying Phase 169.2,
     which ships before 169 in the execution order) into the phase branch before any wave-1 code commit. It
     is a merge, not a rebase, and not a fast-forward: measured 2026-09-26 the branch was 19 commits ahead
     and 5 behind `origin/main`, its own side planning docs and `TODOS.md` only, so the merge touches no
     `src/` file on the phase side (a `.planning/**` or `TODOS.md` conflict keeps both sides' entries). A
     new **Task 1 entry gate in both wave-1 plans (169-01, 169-04)** proves it and fails closed otherwise:
     `readBenchmarkPrices` on `origin/main`, and `git merge-base --is-ancestor origin/main` true for both the
     phase branch ref and the HEAD the plan commits on (success token `PAGETRUTH_W1_ENTRY_SYNC_OK`). The
     ancestor form, not "the reader is present at HEAD", because a present reader also passes on a
     cherry-pick or partial merge that leaves the sync owed; both refs, because a wave worktree forked from
     `origin/HEAD` passes the HEAD check trivially. No plan syncs, merges or rebases to satisfy the gate.
  2. **The wave-4 rebase, plan 169-08**, between wave 3 and wave 5, on the phase branch, bringing what
     landed on `origin/main` after entry: 167.1.2 PR C and, unless it was already there, 167.2.1. Items (a)
     to (e) above are unchanged. Because the entry sync is a merge commit and `git rebase` drops merges and
     replays the phase's own docs commits, a `.planning/**` or `TODOS.md` conflict the entry merge resolved
     can recur; 169-08 resolves it the same way and records it (not a STOP).
- **Second timing, restated (2026-09-26).** If 167.2.1 is on `origin/main` at the phase-entry sync, that sync
  brings it in before any Phase 169 code exists, so 169-01 has no conflict with it: 169-01 is written against
  HEAD after the sync, re-reads `fetch-and-build-payload.ts` and `composite-read-path.ts` there, and places its
  seven scalars in the resolve stage's select and at the resolve stage's `readSingleKeyBasisOpts` call (169-08
  Task 2's rule). 169-02 then takes its three-part arm, and 169-08 Task 2 step 3 only verifies the KEY SHAPE pin
  and header line 169-02 wrote (no re-edit, no second header line, no red-first claim). The wave-1 gates print
  which timing held (`ORDER INFO 167.2.1-at-head`).
- **Measured 2026-09-26 (plan-check round 3):** Phase 167.2.1 has merged to `origin/main` (PR #866, merge
  commit `327bb9990`). The second timing is therefore the expected one: the phase-entry sync brings 167.2.1
  in, 169-02 takes its three-part arm, and 169-08 Task 2 step 3 takes its verify-only three-part arm. The
  gates that waited on 167.2.1 (169-07 Task 1, 169-08 Task 1, 169-06 step 0) keep their checks unchanged;
  they now pass on that fact rather than wait for it. Both arms stay in the plans, because the arm taken is
  read from the branch at execution, never from this note.

### D-43: Plan 169-01 builds on Phase 166.2's og-metrics (orchestrator, cross-phase note, 2026-09-26)
- **Fact (from the orchestrator, Phase 166.2 executing):** 166.2 moves `computeOgHeadline`'s computed
  Sharpe to the shared `sharpe(..., {ddof: 0}) ?? NaN` (166.2 D-07) and changes two side assertions in
  `src/lib/factsheet/og-metrics.test.ts` to expect a NaN Sharpe on a constant series: "CAGR hidden (NaN)
  for a dense sub-year series" and "single / duplicate / unsorted dates never produce Infinity".
- **Decision:** plan 169-01 (old 04, the owner of `og-metrics.ts` / `og-metrics.test.ts` in this
  phase) builds on 166.2's version. Its persisted read for rankable rows (D-10) is the first arm; the
  shared-Sharpe arm stays for the rest; it keeps both side cases and never re-asserts a finite Sharpe in
  them. 169-01's og task STOPs if 166.2 is not in the branch. Phase 169's ROADMAP `Depends on` line
  names 166.2. D-25's 166.1 merge-order step (169-06 step 0b) is unchanged; it still applies to 166.1.
- **Reversibility:** n/a (ordering).
- **RETIRED 2026-09-26 by D-44, the text above kept as lineage.** Plan 169-01 no longer edits
  `og-metrics.ts`, `og-metrics.test.ts` or the OG route: that task moved to Phase 169.4.1 OGSHARPE (plan
  169.4.1-01; its CONTEXT carries this decision verbatim, see
  `.planning/phases/169.4.1-ogsharpe-the-og-share-card-s-sharpe-reads-the-one-shared-sha/169.4.1-CONTEXT.md`).
  Phase 169's ROADMAP `Depends on` no longer names 166.2.

### D-44: The OG card's half of D-10 splits out to Phase 169.4.1 OGSHARPE (FOUNDER DECISION, 2026-09-26)
- **The blocker (plan-check round 3, 2026-09-26).** Phase 166.2 was not on `origin/main` (measured:
  `og-metrics.ts` there has no `sharpe(` call), neither of D-42's two syncs was said to carry it, and no
  automated gate checked it. The wave-1 entry gate could pass without 166.2, 169-01's code tasks would
  commit, and its OG task would then STOP with no recovery D-42 allows (a third sync is forbidden, and
  169-08 needs 169-01's SUMMARY).
- **Decision (founder, AskUserQuestion, "Split OG-card to 169.5"; option A).** The OG task (old 169-01
  Task 4: `og-metrics.ts`, `og-metrics.test.ts`, `src/app/api/og/factsheet/[id]/route.tsx`) and D-43 move
  to a new topic-split phase registered through `/gsd-phase --insert 169.4`. gsd-tools numbered it
  **169.4.1**, not 169.5, and that number is kept. Its plan 169.4.1-01 opens with a wave-1 Task 1 gate
  that fails before any code commit unless `git grep -q 'sharpe(' origin/main -- src/lib/factsheet/og-metrics.ts`
  holds (166.2 merged) and Phase 169 is on `origin/main`. Its ROADMAP section says Depends on: 166.2, 169.
  Plan 169.4.1-02 is its integration run and post-deploy browser re-check (the D-37 per-phase pattern).
- **What stays in Phase 169.** 169-01 keeps D-10's factsheet half (the persisted headline through
  `readSingleKeyBasisOpts`, both callers, the cash leverage re-pin) and drops to three tasks. Phase 169
  no longer depends on 166.2. D-42's two syncs are unchanged; neither needs to carry 166.2.
- **D-25's 166.1 merge-order step (169-06 step 0b).** Its `computeOgHeadline` reconciliation (b) no
  longer applies to Phase 169, which does not edit `og-metrics.ts`; it moves with the OG task to
  169.4.1-02. The `compute.ts` half of step 0b stays in 169-06.
- **SC4 coverage.** SC4 stays served by 169-01 (factsheet headline) and by 169.4.1 (the OG card); the
  criterion is copied verbatim to 169.4.1 (D-37's rule for a criterion several phases serve).
- **Execution order.** 169.4.1 runs after 169 and after 166.2 has merged; it touches no file another
  169.x phase edits.
- **Reversibility:** reversible (packaging and ordering only).

### Claude's Discretion
- Test file names, helper names not fixed above, and the exact caption wording within DESIGN.md's
  em-dash and dated-document rules.
</decisions>

<canonical_refs>
## Canonical References

- `.planning/ROADMAP.md` `### Phase 169` and `### Phase 170`
- `.planning/phases/169-pagetruth/169-RESEARCH.md` (root causes A to H, pitfalls 1 to 7)
- `DESIGN.md` (the em-dash null rule, the dated-document test)
- 167.1.2 CONTEXT D-09 (departed = disconnected OR revoked), D-11 (the duplicate marker), D-12 (PR
  split), on branch `feat/167.1.2-accounttruth`
</canonical_refs>

<deferred>
## Deferred Ideas

- Dropping `get_admin_compute_jobs`: `TODOS.md` `[169-DEAD-ADMIN-JOBS-RPC]` (D-01).
- A `periodsPerYear` on the Scenario payload, so a selected range there shows figures instead of
  the withheld form: `TODOS.md` `[169-SCENARIO-WINDOW-ANNUALIZATION]`, owner Phase 167.1.2 (D-29).
- "Month-to-date" relabel on an ended record, and the D12 venue label: Phase 170 (D-04, D-06).
- QA D14 (the `/admin` Strategy Review owner attribution when display names collide) and QA I5 (the
  intro-requests "N in progress" relabel): Phase 170 (D-06 as amended 2026-09-25).
- Widening `deriveMandateIsSet` to every engine-consumed preference field: not planned (D-03).
- A live feed for SPX, ETH, GLD and IEF: not planned; they carry a dated `through` label (D-09).
- ~~Consolidating the discovery detail page onto `fetchAndBuildPayload`: owned by Phase 169, kept in
  lockstep by plan 05b's test, not consolidated inside PR 1 (D-23, with the reason and the tracking).~~
  No longer deferred (2026-09-25, D-23 as amended): plan 13 does it in PR 2.
</deferred>

---

*Phase: 169-pagetruth*
*Context gathered: 2026-09-25*

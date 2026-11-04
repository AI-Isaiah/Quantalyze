# Phase 190: FACTSHEETQUEUED - Research

**Researched:** 2026-11-03
**Domain:** Next.js 16 route handler `after()` side effects (compute-job enqueue) and the factsheet read gates on `strategy_analytics.computation_status`
**Confidence:** HIGH on the code paths and the PROD count. MEDIUM on the read-gate scope D-02 implies (see Open Questions 1 and 2).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 — Booking.** Founder 2026-11-03, AskUserQuestion: "New phase, start now (Recommended)". STATUSBRIDGE 164.6.6.3.4 closed on 2026-10-08, so it could not absorb this.
- **D-02 — Stays published.** Founder 2026-11-03, AskUserQuestion. Question: "Today a pending or computing re-run fails the strategy gate, so the strategy shows as UNPUBLISHED (and drops out of what allocators see) until the run finishes. With computed analytics already stored, what should a re-run do to its published state?" Answer: "Stays published (Recommended)". The option text: "A strategy with stored analytics passes the gate during a re-run: it stays published and allocators keep seeing the last computed numbers. If the re-run then fails, the existing failed-status rules apply as today."
- **D-03 — Small line on the factsheet.** Founder 2026-11-03, AskUserQuestion. Question: "Where does the 'updating' note show while a re-run is pending or computing?" Answer: "Small line on the factsheet (Recommended)". The option text: "One quiet line near the factsheet's 'computed at' date, e.g. 'Updating with new data…', styled per DESIGN.md. Everyone who can see the factsheet sees it."

### Claude's Discretion
- When finalize genuinely needs a re-run, for example when the wizard changed an input that affects analytics after the first run. The planner derives this from the code and the SC-1 count. It must not drop a run that is needed.
- What "stored analytics" means for the gate. Use the same freshness source the product already uses: `strategy_analytics.computed_at`, never `last_sync_at`.
- The exact wording of the note, which needs a DESIGN.md check.

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

Requirement IDs are TBD (phase-local SC ids). The SCs come from `.planning/ROADMAP.md` `### Phase 190`.

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | Read-only PROD count of strategies whose finalize step queued a re-run after their first computation had finished, recorded before any code change | The draft query in **Code Examples / SC-1**, already run read-only on 2026-11-03: **4 jobs on 4 strategies, all 4 after a finished computation, all 4 on `private` strategies.** The 30-day retention window bounds what any count can see. |
| SC-2 | Finalize queues a re-run only when one is needed. A test goes RED on today's behaviour | **Defect 1** section: the enqueue sits in `runLegacyFinalize`'s `after()` block. The re-run rule (Pattern 1) and the RED test shape (Validation Architecture). |
| SC-3 | A strategy with stored analytics keeps showing them while a re-compute is pending or computing, with a small "updating" note. A test goes RED on today's behaviour | **Defect 2** section. The real hide is the STALE-01 gate in `resolveFactsheetInputs`, not `strategyGate`. `page.stale-analytics.test.tsx` V3 pins today's behaviour and is the natural RED test. |
| SC-4 | A strategy with no analytics yet still shows the queued or computing state | Pattern 2: admit `pending`/`computing` only when a stored result exists. Otherwise return `not_computed` exactly as today, so the owner lane's KCS-09 state line is unchanged. |
| SC-5 | After deploy, a PROD reading or a UI check confirms SC-2 and SC-3 | **SC-5 verification approach**, under Validation Architecture. |
| SC-6 | Never invent data | Pattern 2 shows only values the runner's success write stored. A first-ever compute shows nothing. The note never claims a time or a percentage. |
</phase_requirements>

## Summary

**Defect 1 is narrower than the ROADMAP wording suggests, and it is measured.** `finalize-wizard` has two arms. The **unified arm** (manager, single key) promotes the draft and calls `postProcessKey` with `flow_type: "onboard"`. It never writes a `source: "finalize-wizard"` job. The **legacy arm**, `runLegacyFinalize`, is reached by every contribution (`entryContext === "contribution"`) and every composite. In its `after()` block it **unconditionally** enqueues `sync_trades` (single key) or `stitch_composite` (composite) with `p_metadata: { source: "finalize-wizard" }`. By the time the user reaches SubmitStep, the wizard's SyncPreviewStep has already run `/api/keys/sync`, so the full `process_key_long → sync_trades → derive_broker_dailies → compute_analytics_from_csv` chain has usually finished. The PROD count (2026-11-03, read-only, marker query first) found **4 finalize-sourced `sync_trades` jobs on 4 strategies. All 4 came after a finished computation and all 4 are on `private` (contribution) strategies.** It found 0 finalize-sourced `stitch_composite` jobs and 0 unified-arm `onboard` jobs in the window. `create-with-key` enqueues nothing.

**Defect 2 is not where the ROADMAP points.** `checkStrategyGate` has exactly two production callers: the admin approval route and the wizard's SyncPreviewStep. **Neither the factsheet nor any allocator surface calls it.** The factsheet hides a re-computing strategy through the STALE-01 gate in `resolveFactsheetInputs` (`!isComputedAnalytics(analytics?.computation_status)` → `not_computed`). `shapeRowAnalytics` does the same for the list and detail shapers, and about 20 other `isComputedAnalytics` / `isRankableAnalyticsRow` call sites do it elsewhere. A recompute never changes `strategies.status`. The "UNPUBLISHED" the founder saw is the owner lane's notice on a `private` contribution, and that notice was there before the rename too. What changed was the factsheet body: it was replaced by the placeholder with the KCS09-QUEUED line. D-02's intent still applies ("stays published, allocators keep seeing the last computed numbers"). It is implemented on the **read gates**. `strategyGate`'s pending/computing arms only matter for admin approval during a re-run.

The premise that blocked showing old numbers is gone. `shapeRowAnalytics` says so itself: since Phase 166.3.1/166.5, `computed_at` is held through `computing` and `failed`, and only the runner's success write stamps it. So "Computed {date}" beside the previous run's numbers is now a true pairing. The fix is one shared predicate in `closed-sets.ts` that admits `pending`/`computing` only over a stored successful result. It is applied once in the resolve stage, so every factsheet lane inherits it, and the "updating" flag rides the payload under the status-keyed cache entry.

**Primary recommendations:**
- **(1)** In `runLegacyFinalize`, enqueue only when the strategy has no terminal-success analytics and no factsheet-chain job in flight, **or** when this finalize changed `strategies.asset_class`. `asset_class` is the only analytics input finalize writes.
- **(2)** Add one predicate, e.g. `isRecomputeOverStoredResult`, to `closed-sets.ts`. Apply it at G1 of `resolveFactsheetInputs` and thread an `analyticsUpdating` flag into the payload. Render one muted caption line under the FreshnessChip.
- **(3)** Leave every "did the run finish?" consumer on `isComputedAnalytics`: pollers, keys/sync, SyncPreviewStep, csv-finalize, ApiKeyManager.

## Project Constraints (from CLAUDE.md)

- **Database marker first.** Before any PROD statement, run `SELECT shobj_description(oid,'pg_database') …` and confirm it names PRODUCTION. Done this session; it named PRODUCTION. Only read-only aggregate queries were run.
- **Migrations auto-apply to PROD on merge** (`apply-test`, then PROD, with no human stop since 2026-09-23). Every review happens before merge. Never `supabase db push`. **This research recommends no migration** (see Open Question 2 for the one path that would need one).
- **Before CREATE OR REPLACE, re-base on the latest definition across all migrations.** This only applies if the planner takes the SQL cohort-rank path (`get_verified_cohort_rank`, latest in `20260821120000_*`) or touches the bridge (`sync_strategy_analytics_status`, latest `20261023120000_sync_status_runner_stamps_computed_at.sql`).
- **Migrations also need migration-reviewer and rls-policy-auditor clean before merge.** Only relevant on the migration path.
- **Data-integrity and user-facing gates must be able to fail.** Neuter, see RED, restore from a byte backup (never `git checkout`/`restore`/`stash` on uncommitted work).
- **Never invent data.** Uncomputable metrics are null. Freshness is `strategy_analytics.computed_at`, never `last_sync_at`.
- **AGENTS.md:** Next.js 16.4.2 has breaking changes. Read `node_modules/next/dist/docs/` before writing code (see Next.js notes below).
- **DESIGN.md governs the note's styling.** Flag deviations in QA.
- **CHANGELOG + VERSION bump on every ship.** VERSION and package.json must be byte-equal 4-digit strings. Never `npm version`.
- **The skip trailer must never be written** in a commit message or PR body, not even to deny it.
- **Ship branch changes nothing under `.planning`** (memory: ship-planning-guard).
- **Public repo:** no PROD ids, uuids, home paths or account numbers in tracked text. RESEARCH.md carries aggregate counts only.
- **No AI authorship trailers** in commits (memory, founder 2026-10-20).
- **Subagent and review rules** (memory): review is gsd-code-reviewer plus silent-failure-hunter, MEDIUM and above. A user-facing MEDIUM triggers a fixer round.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Decide whether finalize enqueues a re-run | API / Backend (`finalize-wizard` route, inside `after()`) | Database (`enqueue_compute_job` dedupes in-flight same kind only) | The decision needs the analytics row, the in-flight job set and whether `asset_class` moved, all of which the route already reads or writes. |
| Mark a strategy as "recomputing" (`computation_status`) | Database (`sync_strategy_analytics_status` bridge branch (a), Python `_mark_computing`) | — | Closed phase 164.6.6.3.4 owns it. **Do not change the writers.** Pollers depend on `computing` being advertised. |
| Decide whether stored analytics are displayable during a re-run | Frontend Server (SSR resolve stage `resolveFactsheetInputs`) | Shared lib (`closed-sets.ts` predicate) | One choke point that every factsheet lane (public cached, owner, share token, discovery detail) runs through. |
| Render the "updating" line | Frontend Server / RSC (`FactsheetView` header block) | — | Server-rendered from a payload field, so every viewer gets it, as D-03 requires. |
| Admin approval during a re-run (D-02 literal "passes the gate") | API / Backend (`admin/strategy-review` + `strategyGate`) | — | The only production caller of `checkStrategyGate`'s pending/computing arms besides the wizard. |

## Defect 1 — the wizard lifecycle and every enqueue (Question 1)

### Wizard sequence, with the routes each step calls

| Step | Route | Enqueues? | Evidence |
|------|-------|-----------|----------|
| ConnectKeyStep | `POST /api/strategies/create-with-key` | **No.** Creates the draft through `create_wizard_strategy` and force-stamps a venue-aware `asset_class`. | `create-with-key/route.ts:1468-1481` (RPC), `:1777-1792` (asset_class stamp). A grep for `enqueue_compute_job` in that file finds nothing. [VERIFIED: codebase read] |
| SyncPreviewStep | `POST /api/keys/sync` | **Yes, the first computation.** Single key: unified `postProcessKey` `flow_type=resync`, then Python enqueues `process_key_long` with `metadata: {correlation_id, verification_id, flow_type, source: <venue>}`. Composite: `stitch_composite` with `p_metadata: { source: "keys/sync", correlation_id }`. | `keys/sync/route.ts:358-362`, `:537-541`. `analytics-service/routers/process_key.py:1909-1921`. [VERIFIED: codebase read] |
| (worker) | — | `process_key_long → sync_trades → derive_broker_dailies → compute_analytics_from_csv` | `analytics-service/services/job_worker.py:1006-1014` `JOB_CHAIN_FOLLOW_ON`. [VERIFIED: codebase read] |
| MetadataStep | (draft save) | No | — |
| SubmitStep | `POST /api/strategies/finalize-wizard` | **Unified arm (manager, single key):** `postProcessKey` `flow_type: "onboard"`, which enqueues a new `process_key_long` with `source: <venue>`, never `finalize-wizard`. **Legacy arm (every contribution, every composite):** `after()` enqueues `sync_trades` / `stitch_composite` with `source: "finalize-wizard"`. | `finalize-wizard/route.ts:1720-1722` (contribution routes to legacy), `:1702` (composite routes to legacy), `:2236-2342` (the legacy enqueue), `:2645-2682` (unified `postProcessKey`). [VERIFIED: codebase read] |

The enqueue as it stands today (`finalize-wizard/route.ts:2316-2329`) [VERIFIED: codebase read]:

```ts
          // Single-key path (zero strategy_keys members). Phase 106 Stage B
          // ...
          if (!keyLink?.api_key_id) return;
          const { error: enqueueErr } = await admin.rpc(
            "enqueue_compute_job",
            {
              p_strategy_id: resolvedId,
              p_kind: "sync_trades",
              p_metadata: { source: "finalize-wizard" },
            },
          );
```

The composite twin is at `:2260-2264`, with `p_kind: "stitch_composite"` and `p_metadata: { source: "finalize-wizard" }`.

**Why it is redundant.** `enqueue_compute_job`'s dedupe only collapses onto an **in-flight job of the same kind** (`status IN ('pending', 'running', 'done_pending_children')`, `baseline.sql` inside `_enqueue_compute_job_internal`, ~:484-506) [VERIFIED: codebase read]. Once the preview chain is `done`, a new `sync_trades` row is inserted and the whole tail chain runs again. If `process_key_long` were still in flight, a `sync_trades` enqueue would not dedupe onto it either, because the kinds differ.

### What finalize can change that genuinely needs a re-run

The analytics service reads only these `strategies` columns: `asset_class`, `returns_denominator_config` and `api_key_id`. This comes from an aggregate of every `.table("strategies").select(...)` in `analytics-service/services` and `routers`. Their only analytics inputs are `asset_class` and `returns_denominator_config` [VERIFIED: codebase grep].

- `finalize_wizard_strategy` (latest def `baseline.sql:6691`) writes name, description, category, types, subtypes, markets, supported_exchanges, leverage_range, aum and max_capacity. It does not touch `strategy_analytics` or `compute_jobs` [VERIFIED: codebase read]. None of those columns is an analytics input.
- The route **does** write `strategies.asset_class` before routing (`finalize-wizard/route.ts:1350-1362`): `apiKeyId ? (isCryptoExchange(attestedVenue) ? "crypto" : "traditional") : isCompositeForAssetClass ? "crypto" : fields.asset_class`. It skips the write when the venue is unattested (`:1318`). **`asset_class` is the annualization clock** (√365 vs √252, the worker reads it directly). If this write changes the value, a re-run IS needed.
- `create-with-key` stamped `isCryptoExchange(exchange) ? "crypto" : "traditional"` on the draft (`create-with-key/route.ts:1779-1782`). The attested venue equals `exchange` by the `api_keys_attested_venue_matches_exchange` CHECK. So for a normal single-key draft, finalize's write is a no-op.
- `capital_ownership` (contribution mark) is not an analytics input.
- Composite: a member-set change already flips a completed row back to `pending` (`set_wizard_composite_members`, `baseline.sql:10416-10419`, `SET computation_status = 'pending' … AND computation_status IN ('complete', 'complete_with_warnings')`) [VERIFIED: codebase read]. A finalize after a member change therefore sees a non-terminal row.

**PROD cross-check (2026-11-03):** all 4 affected strategies have an attested venue, and their `asset_class` matches the venue rule. So none of the 4 re-runs was needed for an `asset_class` change.

### The re-run rule (recommended)

Enqueue in `runLegacyFinalize`'s `after()` iff **any** of these holds:
1. The strategy's `strategy_analytics` row is absent or not a terminal success (`!isComputedAnalytics(status)`) **and** no factsheet-chain job is in flight. "Factsheet chain" means `FACTSHEET_CHAIN_KINDS` from `src/lib/compute-state.ts:40-46`, plus `stitch_composite` for a composite, with a status in `('pending','running','done_pending_children','failed_retry')`. A preview that failed, never ran, or was invalidated by a member change keeps its run.
2. This finalize changed `strategies.asset_class`. Read the value before the existing update at `:1350`, compare it with the value written, and pass `assetClassChanged` into `runLegacyFinalize`. Force the enqueue even if a chain is in flight, because a hop that already read the old clock would publish the wrong annualization.
3. Otherwise skip, and log one structured line (`[strategies/finalize-wizard] analytics already current; no re-run queued`) so the skip is visible.

Fail direction: if the analytics read or the in-flight read **errors**, enqueue (today's behaviour). Never fail closed into a missing run. The reconcile cron is a backstop only for `pending` rows (`:2333-2336` comment). Rule 12: a failed read is not "already current".

Apply the same rule to the composite `stitch_composite` arm (`:2253-2315`). It is the same defect class, but it is unmeasured: 0 jobs in the 30-day window. The existing `compositeMemberCount` fail-closed path stays first.

The unified arm's `onboard` `process_key_long` is also a full chain re-run after the preview. **Keep it out of this phase's code change.** It is the only thing that advances the onboard `strategy_verifications` row the trust-tier readers use (`finalize-wizard/route.ts:2632-2635`), and dropping it would drop a needed run. It is unmeasured too (0 onboard jobs in the window). See Open Question 3.

## Defect 2 — where the computed factsheet is actually hidden (Questions 2 and 3)

### How `computation_status` moves (closed phase 164.6.6.3.4 STATUSBRIDGE; read, not reopened)

- **Enum** (`baseline.sql:13403`) [VERIFIED: codebase read]: `CHECK (("computation_status" = ANY (ARRAY['pending'::"text", 'computing'::"text", 'complete'::"text", 'complete_with_warnings'::"text", 'failed'::"text"])))`. Column default `'pending'`.
- **`computed_at` is `DEFAULT now() NOT NULL`**, so it cannot tell "never computed" from "computed". **Do not use `computed_at IS NOT NULL` as the stored-result test.** Since 166.3.1/166.5, `computed_at` is held on entry to `computing`/`failed` (trigger `strategy_analytics_hold_computed_at_until_success`) and stamped only by the runner's success write. So on a re-computing row it **is** the date of the last good compute, and that is what the FreshnessChip shows.
- **Branch (a)** of `sync_strategy_analytics_status` (latest `20261023120000_sync_status_runner_stamps_computed_at.sql`, around line 798 onward) writes `'computing'` whenever any non-terminal job exists. It keeps `complete_with_warnings` / `computation_warned` rows as they are, and keeps a plain `complete` row only under `v_refresh_keep` (marked ledger refreshes). **So a plain `complete` row bounces to `computing` on a user re-run, while a `complete_with_warnings` row does not. That asymmetry is part of why the founder saw the factsheet disappear.**
- `'pending'` is reached only through the column default on a first-ever row and through `set_wizard_composite_members` invalidation. Nothing else writes it (TS and Python greps found no writer).
- **Failure writes never write data columns.** Some Python failure arms NULL `metrics_json_by_basis` while leaving series rows behind (`composite-read-path.ts:1302-1308` comment). This matters for the stored-result test (Pitfall 2).

### Every consumer of `checkStrategyGate`

Callers outside tests: `src/app/api/admin/strategy-review/route.ts:251` (approval) and `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx:2043` (it runs only inside the poll's terminal handler) [VERIFIED: grep + read]. The other mention, `wizardErrors.ts:4825-4826`, is copy mapping for the codes. **The factsheet page, discovery, share cards and listings do not call it.** The arms (`strategyGate.ts:519-535`) [VERIFIED: codebase read]:

```ts
  if (input.computationStatus === "pending") {
    return { passed: false, code: "ANALYTICS_PENDING",
      reason: "Analytics computation is queued and has not started yet.", detail: null };
  }
  if (input.computationStatus === "computing") {
    return { passed: false, code: "ANALYTICS_COMPUTING",
      reason: "Analytics computation is still running.", detail: null };
  }
```

The string the founder saw is NOT this one. It is `status-surface-copy.ts:70-74` [VERIFIED: codebase read]: `queued: { id: "KCS09-QUEUED", tone: "muted", text: "A computation for this strategy is queued and has not started yet." }`. It is rendered by the owner lane's placeholder (`factsheet/[id]/v2/page.tsx:673-679`, `:765-775`) when the build returns no payload.

### Every read gate on `computation_status` (D-02 surface map)

`isComputedAnalytics` (`closed-sets.ts:781-785`) [VERIFIED: codebase read] is `status === "complete" || status === "complete_with_warnings"`. `isRankableAnalyticsRow` (`:824-828`) delegates to it, and its SQL twin is `get_verified_cohort_rank` ("Change one, change the other", `:819-823`).

| Site | Kind | Recommendation |
|------|------|----------------|
| `src/lib/factsheet/fetch-and-build-payload.ts:419` (resolve stage G1) | **Display: every factsheet lane** (public cached, owner, share token `factsheet-share/[token]/page.tsx:367`, discovery detail `discovery/[slug]/[strategyId]/page.tsx:121`, `/strategies` probe) | **CHANGE.** This is the SC-3 site. |
| `composite-read-path.ts:761` `singleKeyBasisOpts`, `:1256`, `:1281`, `:1338`, `:1366` (`should…Series`), `headline-basis.ts:209` `storedCashHeadlineGate`, `headlineVerdict(…, computationStatus)` at `composite-read-path.ts:550` | Display, inside the resolve stage | **CHANGE together with G1.** Otherwise an admitted computing row builds with MTM/smoothed/cash basis series withheld, or its composite headline refuses (`composite_unbuildable`). Pass the resolve stage's single decision down rather than re-asking with the raw status. |
| `src/lib/factsheet/v2-joint.ts:186` | Display (joint panel) | **CHANGE** for consistency on the same page. |
| `src/lib/queries.ts:696` `shapeRowAnalytics` (lists, `getPublicStrategyDetail`, `getFactsheetDetail`, `getStrategyDetail`, `/browse/[slug]/[id]`, tearsheet grid, `/strategy/[id]` metadata) | Display: "what allocators see" | **CHANGE if D-02 covers lists** (Open Question 1). Its own comment (`queries.ts` ~:698-712) says the `computing` arm's premise "is under review". |
| `StrategyTable.tsx:275`, `:1307`, `og/factsheet/[id]/route.tsx:222`, `og-metrics.ts:100`, `factsheet/[id]/tearsheet/page.tsx:377,446`, `api/factsheet/[id]/pdf/route.ts:235-236`, `tearsheet.pdf/route.ts:203-204`, `api/strategies/[id]/returns/route.ts:405`, `recommendations/page.tsx:288`, `portfolios/[id]/page.tsx:359`, `StrategyBreakdownTable.tsx:127`, `portfolio-pdf/[id]/page.tsx:160`, ScenarioComposer reads | Display (secondary surfaces) | Same decision as `shapeRowAnalytics`. Each has a `*.stale-analytics.test.*` pin that encodes today's withholding. |
| `queries.ts:270` `getPercentiles`, `:1139/:1161` `getOwnRowPercentiles`, SQL `get_verified_cohort_rank` (`baseline.sql:7354`, `:7401`) | **Ranking** | **KEEP** on terminal-success (no migration). A row under recompute leaves the cohort for about 10-15 minutes. See Open Question 2. |
| `useStrategySyncPoller.ts:359`, `SyncPreviewStep.tsx:926,1414,3026`, `keys/sync/route.ts:574`, `csv-finalize/route.ts:1903`, `ApiKeyManager.tsx:428,712`, `AdminTabs.tsx:387`, `founder-lp/readiness.ts`, `/strategies/page.tsx:673` (probe skip) | **Progress: "did the run finish?"** | **KEEP.** Changing these breaks pollers, which then never see the run end, and the keys/sync failed-stamp guard. |
| `admin/strategy-review/route.ts:251` (`checkStrategyGate`) and `:385` (re-check `isComputedAnalytics`) | Approval | **CHANGE both together** to honour D-02's literal "passes the gate". Add a REQUIRED stored-result input to `StrategyGateInput`, following the `seriesCompleteness` precedent: required and nullable, so a forgetful caller is a compile error. |

**SQL mirrors of the publish gate:** no RLS policy filters on `computation_status`; a grep of every `computation_status` line in `baseline.sql` found none in a policy. The SQL mirrors are `get_verified_cohort_rank` (ranking) and the ops view `ledger_refresh_staleness` (`baseline.sql:13527-13530`, a staleness monitor). **So D-02 needs no migration unless the founder wants ranking to hold during a re-run as well.**

## Standard Stack

No new packages. Everything uses what is installed.

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| next | 16.4.2 (main checkout `node_modules`) | `after()` in route handlers, `unstable_cache` for the public factsheet | Already the route's mechanism [VERIFIED: node_modules/next/package.json] |
| vitest | repo pin (`vitest.config.ts`) | Unit and route tests | House standard; the coverage ratchet lives in `vitest.config.ts` |
| @supabase/supabase-js | repo pin | Admin reads inside `after()` | Already used by the route |

## Package Legitimacy Audit

No external packages are installed by this phase.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none) | — | — | — | — | — | — |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
Wizard SubmitStep ──POST──> finalize-wizard route
                              │  (asset_class: read old → write new → assetClassChanged)
                              ├─ contribution / composite ──> runLegacyFinalize
                              │       └─ finalize_wizard_strategy RPC (status → private | pending_review)
                              │       └─ after():  read strategy_analytics.computation_status
                              │                    read in-flight chain jobs (compute_jobs)
                              │                    ┌ needed? (not terminal-success & nothing in flight) OR assetClassChanged
                              │                    ├─ yes → enqueue_compute_job(sync_trades | stitch_composite, source finalize-wizard)
                              │                    └─ no  → log "analytics already current", no job
                              └─ manager single-key ──> unified arm → postProcessKey(onboard) [UNCHANGED this phase]

compute_jobs ──worker──> chain hops ──bridge──> strategy_analytics.computation_status (computing … complete)
                                                 computed_at held until success write

Viewer GET /factsheet/[id] ──> signature probe (computed_at, computation_status keyParts)
     ──> resolveFactsheetInputs (G1):
           terminal success ───────────────────────────────> build (analyticsUpdating=false)
           pending|computing AND stored result present ────> build (analyticsUpdating=true)
           pending|computing AND no stored result ─────────> not_computed (KCS-09 queued/running line, as today)
           failed ─────────────────────────────────────────> not_computed + analyticsFailed (as today)
     ──> FactsheetView: FreshnessChip ("Computed {last good date}") + "Updating with new data…" line
```

### Pattern 1: Re-run decision inside `after()`
**What:** Compute `needsRerun` from facts the route reads in `after()` and gate only the enqueue on it. `notify_founder_new_strategy` and `api_keys_last_sync_at_touch` stay unconditional.
**When to use:** The legacy arm's `enqueue_sync_trades_job` side effect (`:2236-2342`).
**Shape:**
```ts
// Source: pattern derived from finalize-wizard/route.ts:2184-2343 (existing sideEffects array)
// Inside the existing `enqueue_sync_trades_job` run(): before either enqueue.
const decision = await decideFinalizeRerun(admin, resolvedId, { assetClassChanged });
// decision: { enqueue: true, reason: "no_terminal_success" | "asset_class_changed" | "read_failed" }
//         | { enqueue: false, reason: "already_current" | "chain_in_flight" }
if (!decision.enqueue) { console.info(`[strategies/finalize-wizard] analytics already current; no re-run queued (${decision.reason})`); return; }
```
Put `decideFinalizeRerun` in a small pure helper module so its truth table is unit-testable without the 5,300-line route test harness. The route test then only proves the wiring.

### Pattern 2: One stored-result predicate, decided once in the resolve stage
**What:** Add the predicate to `closed-sets.ts` next to `isComputedAnalytics`:
```ts
// Source: new; mirrors closed-sets.ts:781-785 style
export function isRecomputeOverStoredResult(
  status: string | null | undefined,
  hasStoredResult: boolean,
): boolean {
  return (status === "pending" || status === "computing") && hasStoredResult;
}
```
`hasStoredResult` is the evidence that the runner's success write happened at least once and its numbers are intact. In the resolve stage, use: a stored series (`daily_returns` or `returns_series` holds at least one dated entry, using the existing stored-entry counting idiom in `fetch-and-build-payload.ts` ~:160-230) **and** a finite stored headline (`cumulative_return`, already on the embed at `:338-339`). A first-ever compute has neither. A failure arm that NULLed the scalars fails the second check (fail closed). Then:
- G1 admits the row and records `analyticsUpdating = true`. Every inner gate (`readSingleKeyBasisOpts`, `readCompositeFactsheet`'s headline verdict, `storedCashHeadlineGate`) receives the **resolved decision**, not the raw status. Pass `"complete"`-equivalent semantics through one variable, or change those helpers to take a boolean `done`. Pick one and use it everywhere. Do not leave half the gates on the raw status.
- `FactsheetPayload` gains `analyticsUpdating: boolean`. Bump the cache keyPart version (`"factsheet-v2-payload-v19"` → `v20`, `factsheet/[id]/v2/page.tsx:271`) per the file's own convention. `computationStatus` is already a keyPart, so a `computing` payload is cached apart from a `complete` one.

### Pattern 3: The "updating" line (D-03)
Place it directly under `<FreshnessChip …/>` inside the existing header `<div>` (`FactsheetView.tsx:1304-1306`), before `SeriesRecencyLine`. Use the sibling line's tokens (`SeriesRecencyLine`, `FactsheetView.tsx:1628`): `className="mt-1 text-caption text-text-muted"`. DESIGN.md: **muted** is "steady-state, honest-empty". The KCS09 queued/running lines are `tone: "muted"`, and amber is for recoverable retry states, which this is not. Use a declarative, sentence-case caption with no exclamation mark. Suggested copy (discretion): **"Updating with new data. These figures are from the last completed computation."** The FreshnessChip already shows the date, so the line does not repeat it and makes no time promise. Render it only when `payload.analyticsUpdating === true`. Add a `data-testid` so tests can find it.

### Anti-Patterns to Avoid
- **Widening `isComputedAnalytics` or `isRankableAnalyticsRow` themselves.** Pollers, keys/sync and the wizard would never see a run end. `get_verified_cohort_rank` parity would silently break ("Change one, change the other", `closed-sets.ts:819-823`).
- **Changing the bridge (branch (a)) so `complete` stays `complete` during a re-run.** That would kill the `computing` advertisement `useStrategySyncPoller` and SyncPreviewStep rely on, and it reopens a closed phase.
- **Using `computed_at IS NOT NULL` as "has stored analytics".** It is `DEFAULT now() NOT NULL`, so it is always true.
- **Rendering the updating line from lane state.** It must come from row state on the payload. The page's own rule is that lane state never enters the shared cached object, and D-03 says every viewer sees the line.
- **Dropping the unified arm's `onboard` call to "fix" redundancy.** It carries the verification row.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| "Is a chain job in flight?" | A new status list | `FACTSHEET_CHAIN_KINDS` (`compute-state.ts:40-46`) and the non-terminal set the Python side mirrors (`IN_FLIGHT_JOB_STATUSES` in `compute-state.ts`) | Status lists drift. These are the pinned mirrors. |
| Terminal-success test | `status === "complete"` | `isComputedAnalytics` | An exact match drops `complete_with_warnings` (the SI-01 census grep catches it). |
| Factsheet visibility | Per-page status checks | The resolve stage `resolveFactsheetInputs` | Every lane already funnels through it. Per-page copies are the documented drift class. |
| Stored-entry count | A new series parser | The existing stored-return counting helper in `fetch-and-build-payload.ts` (~:160-230) and `resolveDailyReturnSeries` | It handles all three `daily_returns` shapes. |

## Runtime State Inventory

Not a rename or migration phase. Each category was still checked:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | 4 PROD strategies with a redundant finalize-sourced `sync_trades` job. All 4 now read `complete`, so the redundant runs have already finished. | None. No data repair (the extra runs recomputed the same inputs). |
| Live service config | None. Nothing lives outside git. | None |
| OS-registered state | None | None |
| Secrets/env vars | None | None |
| Build artifacts | Public factsheet `unstable_cache` entries keyed `factsheet-v2-payload-v19` | Bump to v20 with the payload field. Old entries drain within the 3600 s TTL. |

## Common Pitfalls

### Pitfall 1: The STALE-01 pins are RED by design
**What goes wrong:** `page.stale-analytics.test.tsx` "V3: a live `computing` run is withheld the same way", plus `queries.stale-analytics-detail.test.ts`, `StrategyTable.stale-analytics.test.tsx`, the tearsheet, OG and `fetch-and-build-payload.test.ts` stale pins, encode today's behaviour.
**How to avoid:** Re-cut each one deliberately in the plan that changes its site. A `computing` row **with** a stored result builds and carries `analyticsUpdating`. A `computing` row **without** one is still withheld (SC-4). `failed` is still withheld. Never delete the failed arm.
**Warning signs:** A plan that changes `fetch-and-build-payload.ts` without naming V3.

### Pitfall 2: Failed-then-retry rows
**What goes wrong:** Branch (a) moves `failed` → `computing` on a user retry and clears `computation_error`, so nothing records that the previous state was a failure. Some failure arms NULL `metrics_json_by_basis` but leave series rows.
**How to avoid:** Require **both** a stored series and a finite stored headline as evidence. That admits only rows whose success-written values are intact. The founder may still not want failed-then-retry rows shown (Open Question 4).

### Pitfall 3: Non-atomic success write
**What goes wrong:** The runner persists basis series rows (`analytics_runner.py` ~:2439, :2766) separately from the status write. A viewer during `computing` could briefly read a new basis series beside old headline scalars.
**How to avoid:** Confirm the order in the runner. If series rows land before the success status, either accept the window and record it, or keep basis-series reads gated on terminal success while the headline and main series show. The latter is the conservative choice. [ASSUMED risk size; not measured]

### Pitfall 4: Cache poisoning across status
**What goes wrong:** An `analyticsUpdating` payload served after completion, or the reverse.
**How to avoid:** `computationStatus` is already a keyPart (`page.tsx:271`, `:588`), and the flag must be derived inside the cached builder from the same row. Bump the key version. `page.public-cache-key.test.tsx` is the place to pin it.

### Pitfall 5: A legacy-arm enqueue rule that drops a needed run
**What goes wrong:** Skipping on a `complete` row whose `asset_class` was just corrected, or on a read error.
**How to avoid:** Force the enqueue when `assetClassChanged` is true or any read errored. Keep the existing contribution test's assertion: KPIs must reach the composer, so with no computed analytics the enqueue still fires (`finalize-wizard/route.test.ts:3429-3456`).

### Pitfall 6: The worktree has no `node_modules`
**What goes wrong:** `npx vitest` in `quantalyze-190` fails or picks up the wrong toolchain.
**How to avoid:** Plan 01's first task runs `npm ci` in the worktree.

## Code Examples

### SC-1 — the read-only PROD count (validated 2026-11-03)
Definition of "after the first computation had finished": a finalize-sourced head job J, for which an earlier job D exists for the same strategy with `D.kind IN ('compute_analytics_from_csv','stitch_composite','compute_analytics')`, `D.status = 'done'` and `D.updated_at <= J.created_at`. Those are the factsheet-producing terminal hops. `updated_at` on a `done` row is when it reached `done`, because `done` is terminal. Columns per `baseline.sql:1930-1968` [VERIFIED: codebase read]: `kind`, `status` (`'pending'`, `'running'`, `'done'`, `'done_pending_children'`, `'failed_retry'`, `'failed_final'`), `metadata jsonb`, `created_at`, `updated_at`, `strategy_id`.

```sql
WITH fin AS (
  SELECT j.id, j.strategy_id, j.kind, j.status, j.created_at
    FROM public.compute_jobs j
   WHERE j.metadata ->> 'source' = 'finalize-wizard'
     AND j.kind IN ('sync_trades', 'stitch_composite')
),
classified AS (
  SELECT f.*,
         EXISTS (
           SELECT 1 FROM public.compute_jobs d
            WHERE d.strategy_id = f.strategy_id
              AND d.id <> f.id
              AND d.kind IN ('compute_analytics_from_csv', 'stitch_composite', 'compute_analytics')
              AND d.status = 'done'
              AND d.created_at < f.created_at
              AND d.updated_at <= f.created_at
         ) AS prior_compute_done
    FROM fin f
)
SELECT kind,
       count(*) AS finalize_jobs,
       count(DISTINCT strategy_id) AS strategies,
       count(*) FILTER (WHERE prior_compute_done) AS jobs_after_first_compute_done,
       count(DISTINCT strategy_id) FILTER (WHERE prior_compute_done) AS strategies_after_first_compute_done,
       min(created_at)::date AS oldest_seen,
       max(created_at)::date AS newest_seen
  FROM classified
 GROUP BY kind;
```

**Reading (2026-11-03, marker = PRODUCTION):**

| kind | finalize_jobs | strategies | after first compute done | strategies after first compute done | oldest | newest |
|------|---------------|------------|--------------------------|------------------------------------|--------|--------|
| sync_trades | 4 | 4 | 4 | 4 | 2026-10-04 | 2026-11-02 |
| stitch_composite | 0 | 0 | 0 | 0 | — | — |

**Breakdown:** all 4 strategies are `strategies.status = 'private'`, which is the contribution path. All 4 now read `computation_status = 'complete'`. All 4 have an attested venue, and their `asset_class` matches the venue rule. There were **0** `process_key_long` jobs with `metadata.flow_type = 'onboard'` in the window, so no manager single-key finalize happened in 30 days.

**Limits of the reading (record them in plan 01):**
- `done` jobs are deleted after 30 days by pg_cron `retention_compute_jobs_done` (`20260515113853_retention_crons_safe.sql:188-200`: `DELETE FROM compute_jobs WHERE status = 'done' AND created_at < now() - interval '30 days'`), and `failed_*` jobs after 90 days. Both crons exist on PROD. So the count covers about the last 30 days, not all history. Plan 01 records it as "4 of 4 in the retention window".
- Plan 01 re-runs the query at its own HEAD time (numbers move daily) and records the run timestamp beside the table.
- Run it from the **main checkout** (it holds the `supabase/.temp` link): `supabase db query --linked -f <file>`, with the file not starting with `--` and the marker query run first on its own.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Bridge stamped `computed_at = now()` on every transition | The runner stamps it on success only, and a trigger holds it on `computing`/`failed` | Phases 166.3.1 / 166.5 (2026-10) | Removes reason 1 in `shapeRowAnalytics` for blanking `computing` rows. A re-computing row's date is now the last good compute. |
| Finalize never enqueued (orphaned drafts) | Finalize enqueues unconditionally (H-0330, Phase 106) | 2026-05 | That fix overshot. The wizard's preview has since become the first compute, which makes the finalize enqueue redundant. |
| `unstable_cache` | Next 16 recommends `use cache` / Cache Components | Next 16 | **Do not migrate in this phase.** The factsheet's cache-isolation guards (`phase-148-owner-lane-cache-isolation.test.ts`) pin `unstable_cache` usage. Keep the existing wrapper and bump its key. [CITED: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_cache.md] |

**Next.js 16.4.2 notes that matter here** [CITED: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md]:
- `after()` runs after the response, even when the response did not complete successfully, and within the route's `maxDuration`. The re-run decision belongs inside it, so it adds no latency and does not touch the pinned seam budgets (`seam-budgets.invariant.test.ts`). Those count external seam calls, not admin DB reads.
- Request APIs (`headers`) are allowed inside `after()` in route handlers. The route already resolves the correlation id before scheduling `after()` (`:2136`), so keep that ordering.
- The `unstable_cache` callback cannot read request data. `analyticsUpdating` must come from the row read inside the builder, never from `cookies`/`headers` (`unstable_cache.md`, "Unsupported operations").

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Basis series rows are written before the success status write, so they can briefly mismatch the headline during `computing` | Pitfall 3 | A short-lived mixed render. Verify the order in `analytics_runner.py` before choosing whether basis reads stay terminal-gated. |
| A2 | No failure path writes `daily_returns`/`returns_series`/`cumulative_return`. A grep found no TS writer of those columns, and Python failure arms write status, error and flags (`_upsert_error_only`). | Pattern 2 | If one does, the stored-result evidence could admit a failed run's partial data. The planner should add a grep-based check of the Python writers. |
| A3 | `D.updated_at` on a `done` job is its completion time | SC-1 | Metadata retractions update in-flight rows, not `done` ones. If wrong, the "after first compute" count could over-count, not under-count. |
| A4 | The suggested note copy is acceptable under DESIGN.md voice | Pattern 3 | A copy change only. The founder may prefer the D-03 example "Updating with new data…". |

## Open Questions

1. **Does D-02 extend beyond the factsheet to lists, detail shapers, OG cards, PDFs and the composer?**
   - What we know: SC-3 names the factsheet. D-02 says "allocators keep seeing the last computed numbers". `shapeRowAnalytics` blanks `computing` rows on discovery lists and detail pages today, and its own comment flags that premise as "under review".
   - Recommendation: Do the factsheet resolve stage (every factsheet lane) and `shapeRowAnalytics` plus `StrategyTable` (the lists allocators browse) in this phase with the shared predicate. Route the remaining display sites (OG, tearsheet/PDF, returns API, portfolios, composer) only if the planner can keep the phase reviewable. Otherwise book them as a follow-up, and **name them in the phase VERIFICATION as not yet holding**. Do not leave them silently inconsistent.
2. **Should ranking (percentiles and `get_verified_cohort_rank`) also hold during a re-run?**
   - What we know: changing it requires a migration that re-bases `get_verified_cohort_rank` (latest `20260821120000_*`), plus migration-reviewer, rls-policy-auditor and an auto-apply to PROD.
   - Recommendation: Keep ranking on terminal success (no migration). A row leaves the cohort for one recompute window, about 10-15 minutes. The reaper census measured 0 rows at `computing` on PROD. Record the split explicitly in `closed-sets.ts` beside `isRankableAnalyticsRow`.
3. **The unified arm's `onboard` re-run (manager single key)** is also a full chain after the preview. It is unmeasured (0 in the window) and it carries the onboard verification row.
   - Recommendation: Out of this phase's code. Mention it in the VERIFICATION and let the founder decide whether to book it.
4. **Failed-then-retry rows (Pitfall 2):** show the pre-failure numbers with "updating", or keep them withheld until the retry succeeds?
   - Recommendation: Show them, because D-02 says "with stored analytics", but only when both evidence checks pass. Raise it at plan-check as a one-line founder confirmation if the planner judges it user-facing enough.
5. **Premise correction for the record:** a recompute never sets `UNPUBLISHED`. `strategies.status` is untouched, and the notice is the owner-lane label of a `private`/`pending_review` strategy. This does not change D-02's direction. The plan should quote it so the VERIFICATION does not claim to have fixed a status flip that never happened.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node / npm | vitest, tsc, eslint | ✓ (main checkout) | Next 16.4.2 in main `node_modules` | — |
| Worktree `node_modules` | Running tests in `quantalyze-190` | ✗ | — | `npm ci` in the worktree (plan 01, task 1) |
| Supabase CLI (linked PROD in main checkout) | SC-1, SC-5 PROD reads | ✓ | 2.84.2 | — |
| PROD DB password (Keychain `quantalyze-prod`) | Same | ✓ | — | — |
| Signed-in admin browser (claude-in-chrome) | SC-5 UI check | Founder's session (seeding/deleting test data via UI authorized 2026-10-09) | — | PROD reading only |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** worktree `node_modules` (run `npm ci`).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (repo pin), jsdom per-file via `/** @vitest-environment jsdom */` |
| Config file | `vitest.config.ts` (coverage thresholds are a ratchet; read them there) |
| Quick run command | `npx vitest run <path>` |
| Full suite command | `npm test` (= `vitest run`), plus `npm run typecheck` (`tsc --noEmit`) and `npm run lint` (eslint plus `check-planning-hygiene` and the other repo checks) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SC-2 | Truth table: complete with nothing in flight → no enqueue. Absent, pending, failed or no row → enqueue. Chain in flight → no enqueue. `assetClassChanged` → enqueue. Read error → enqueue. | unit (pure helper) | `npx vitest run src/lib/finalize-rerun-decision.test.ts` | ❌ Wave 0 (name is the planner's) |
| SC-2 | Route wiring: contribution finalize on a `complete` row issues **no** `enqueue_compute_job` `sync_trades`. **RED today**: the route enqueues unconditionally (`route.ts:2321-2329`). The existing contribution test (`route.test.ts:3429-3456`) keeps passing on a not-yet-computed row. | route (after() via `STATE.runAfterCallback = true` + `flushAfter()`) | `npx vitest run src/app/api/strategies/finalize-wizard/route.test.ts` | ✅ (extend the admin mock with a `strategy_analytics` read and a `compute_jobs` in-flight read) |
| SC-2 | Composite: same rule for `stitch_composite` | route | same file | ✅ (extend) |
| SC-3 | A `computing` row with a stored series and headline builds a payload with `analyticsUpdating: true`. **RED today: V3 asserts it is withheld.** | page (real `fetchAndBuildPayload`, `unstable_cache` mocked to identity) | `npx vitest run "src/app/factsheet/[id]/v2/page.stale-analytics.test.tsx"` | ✅ (re-cut V3, add V3b) |
| SC-3 | The "updating" line renders under the FreshnessChip only when `analyticsUpdating` | component | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetView.recency-line.test.tsx"` (or a new `FactsheetView.updating-line.test.tsx`) | ✅ / ❌ |
| SC-3 | Resolve stage: inner basis and headline gates follow the resolved decision. A computing composite is not `composite_unbuildable`. | unit | `npx vitest run src/lib/factsheet/fetch-and-build-payload.test.ts src/lib/factsheet/composite-read-path.test.ts` | ✅ (extend) |
| SC-3 | Cache key: version bumped. A computing and a complete payload never share an entry. | page | `npx vitest run "src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx"` | ✅ (extend) |
| SC-3 (D-02 literal) | `checkStrategyGate` passes pending/computing when a stored result exists, and still refuses without one | unit | `npx vitest run src/lib/strategyGate.test.ts` | ✅ (lines 616-623 pin today) |
| SC-4 | A `computing`/`pending` row with **no** stored result is still `not_computed`. The owner lane shows KCS09-QUEUED or a running line. | page | `npx vitest run "src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx" "src/app/factsheet/[id]/v2/page.stale-analytics.test.tsx"` | ✅ |
| SC-6 | A `failed` row stays withheld (V1/V2 unchanged). No line renders without the flag. | page | as above | ✅ |

**Can-fail proof (house rule):** for the SC-2 route test and the SC-3 page test, the executor neuters the fix, records RED, then restores from a byte backup. For example, temporarily force `decision.enqueue = true`, or make G1 ignore the stored-result arm. Never use `git checkout`/`stash`.

### Sampling Rate
- **Per task commit:** the touched test files via `npx vitest run <paths>`, plus `npm run typecheck`.
- **Per wave merge:** `npm test` and `npm run lint`.
- **Phase gate:** full suite green before `/gsd-verify-work`.

### SC-5 verification approach (post-deploy)
1. **SC-2, PROD reading** (marker first, read-only): re-run the SC-1 query restricted to `j.created_at > '<deploy time>'`. Expect 0 finalize-sourced jobs with `prior_compute_done`. **Non-vacuity:** the reading means something only if at least one contribution finalize happened after the deploy. Get one by running a contribution wizard in the founder's signed-in browser (UI seeding authorized), then delete it through the UI. Record `count(*) = 0` beside the count of contribution finalizes after deploy, which must be at least 1. A zero-finalize window is VOID, not a pass.
2. **SC-3, UI check:** on a strategy with stored analytics, trigger a resync (the product's own "Sync now" / `/api/keys/sync`). Within the computing window (about 10-15 min), load its factsheet on the owner lane and, for a published strategy, logged out. The figures must show, the FreshnessChip must show the last good date, and the "updating" line must be present. Screenshot both. The PROD reading `SELECT computation_status FROM strategy_analytics WHERE strategy_id = <id>` must read `computing` at capture time; record the status only, never the id.
3. **SC-4:** the new contribution draft from step 1 shows the queued or running state before its first compute finishes.

### Wave 0 Gaps
- [ ] `npm ci` in the worktree
- [ ] Pure helper and test for the re-run decision (SC-2)
- [ ] Admin-mock extension in `finalize-wizard/route.test.ts` for the `strategy_analytics` status read and the `compute_jobs` in-flight read
- [ ] `FactsheetView` updating-line test (SC-3)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | The visibility predicates (`withPublishedOnly`, `withPublishedOrOwner`, token bearer) and the request-scoped signature probe are **unchanged**. The change touches only the status gate after visibility has passed. The new `after()` reads run on the admin client scoped to `resolvedId` (as today). |
| V5 Input Validation | no new input | The route's zod validation is unchanged. No new body field (do not accept an "already computed" hint from the client). |
| V6 Cryptography | no | — |
| Data integrity (house) | yes | Only success-written values are shown. A first-ever compute shows nothing. `failed` is still withheld. The cache key carries status. |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stale or incorrect numbers shown as current | Tampering / Repudiation | The `computed_at` date plus the "updating" line, and admission only over intact stored results |
| Cross-viewer cache bleed | Information disclosure | The flag is row state on the payload. Lane state stays out. Status is already a keyPart. Bump the version. |
| Client-forged skip of a needed run | Tampering | The decision is server-derived from DB rows only, and errors fail toward enqueue |

## Sources

### Primary (HIGH confidence)
- Codebase reads this session: `finalize-wizard/route.ts` (:1100-1400, :1690-1850, :1980-2797), `strategyGate.ts` (:1-547), `fetch-and-build-payload.ts` (:1-160, :230-790), `factsheet/[id]/v2/page.tsx` (:570-910), `FactsheetView.tsx` (:1270-1330, :1474-1690), `closed-sets.ts` (:772-829), `status-surface-copy.ts` (:69-74), `compute-state.ts` (:36-55), `queries.ts` (:600-740), `supabase/schema/baseline.sql` (`compute_jobs` :1930-1968, `strategy_analytics` columns and CHECK :13360-13404, `_enqueue_compute_job_internal`, `finalize_wizard_strategy` :6691), `20261023120000_sync_status_runner_stamps_computed_at.sql` (branch (a)), `analytics-service/routers/process_key.py`, `services/job_worker.py:1006-1014`, `164.6.6.3.4-CONTEXT.md`
- PROD read-only queries, 2026-11-03: the marker query (PRODUCTION), the SC-1 aggregate, the head breakdown, and the asset_class consistency check
- Next.js docs in `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md` and `unstable_cache.md`

### Secondary (MEDIUM confidence)
- DESIGN.md semantic-color gates and voice rules (lines 194-212, 430-440)

### Tertiary (LOW confidence)
- None used for decisions

## Metadata

**Confidence breakdown:**
- Defect 1 mechanism and count: HIGH. Code read plus the PROD measurement.
- Defect 2 location: HIGH. Every caller enumerated.
- D-02 scope beyond the factsheet: MEDIUM. A founder-intent question (OQ-1/2).
- Pitfalls: MEDIUM. A1 and A2 need a writer-order check.

**Research date:** 2026-11-03
**Valid until:** 2026-11-17. Re-measure SC-1 at plan-01 time: done jobs age out after 30 days.

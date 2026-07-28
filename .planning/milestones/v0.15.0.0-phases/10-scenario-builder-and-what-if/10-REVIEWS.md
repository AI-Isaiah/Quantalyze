---
phase: 10
phase_name: scenario-builder-and-what-if
reviewers: [grok-4.20-0309-reasoning, claude-opus-4-7-fresh-context]
reviewed_at: 2026-04-25T17:17:06Z
plans_reviewed:
  - 10-01-PLAN.md
  - 10-02-PLAN.md
  - 10-03-PLAN.md
  - 10-04-PLAN.md
  - 10-05-PLAN.md
  - 10-06a-PLAN.md
  - 10-06b-PLAN.md
  - 10-07-PLAN.md
context_inputs:
  - .planning/PROJECT.md (first 80 lines)
  - .planning/ROADMAP.md §Phase 10
  - .planning/REQUIREMENTS.md §SCENARIO-01..09
  - 10-CONTEXT.md
  - 10-RESEARCH.md
  - 10-UI-SPEC.md
  - 10-VALIDATION.md
verdicts:
  grok: REQUEST_CHANGES (risk MEDIUM)
  claude: REQUEST_CHANGES (risk HIGH)
---

# Cross-AI Plan Review — Phase 10 (Scenario Builder and What-If)

> Two-reviewer run.
> - **Grok 4.2 reasoning** (`grok-4.20-0309-reasoning`) — direct xAI API call (claude self-skipped, codex skipped per "Grok replaces Codex" preference). Plan-only review, did not read migration source files.
> - **Claude Opus 4.7 (fresh-context subagent)** — explicitly requested by user as a second voice. Read CONTEXT/RESEARCH/UI-SPEC/VALIDATION + all 8 plans + AGENTS.md/CLAUDE.md AND verified specific claims against the live codebase (`supabase/migrations/059_*.sql`, `supabase/migrations/073_*.sql`, `src/lib/queries.ts`, `src/app/(dashboard)/allocations/AllocationContext.tsx`).

The Claude reviewer's verification against the live schema turned up two showstoppers Grok could not have caught from the plans alone. These are folded into the consensus below.

---

## Grok Review (`grok-4.20-0309-reasoning`)

**Summary**
The 8 plans (01–07, with 06 split) are exceptionally thorough, TDD-strict, and faithful to every locked decision in CONTEXT.md. They correctly treat `src/lib/scenario.ts` as frozen, reuse the exact Bridge V2 form contracts, pin the B4 adapter signature with lookup maps (no pre-casting), and ship the full SCENARIO-01–09 surface under the existing `allocations.ui_v2` flag without new deps or LAYOUT_VERSION bumps. Ship-readiness is high once two HIGH gaps are closed; the biggest concern is that voluntary_add rows are deliberately left unprocessed by the daily delta cron (Pitfall 5 / Deferred Ideas), silently breaking the "realized performance vs original strategy" feedback loop that is the product's core value.

**Strengths**
- Wave ordering and explicit depends_on are correct; pure-TS foundation (01) lands before any React or DB work.
- B4 adapter pinning, N1 per-allocator localStorage key, N3 explicit `toVoluntary*Decision` calls, and N4 vi.mock technique are all enforced by acceptance_criteria greps.
- Every plan includes live-DB RLS regressions, self-verifying DO block, atomic D-23 migration+ADR, and explicit preservation of Phase 07/09.1 invariants (warmup, equity-curve.equitydailypoints, ScenarioStub v1 path).
- Threat models per plan are concise and actually address the real risks (cross-tenant holding_ref, admin-client ownership gate, return-vs-wealth Pitfall 1, fingerprint collision).
- UI-SPEC copy, tokens, a11y, and destructive-action matrix are verbatim in the composer and drawers; no drift.

**Concerns**

**HIGH** – Voluntary_add cron coverage is explicitly deferred (10-02, 10-RESEARCH Pitfall 5, 10-CONTEXT.md ## Deferred Ideas) yet the daily delta cron is the only mechanism that populates 30/90/180-day realized deltas. A voluntary_add row (both original_* NULL, suggested_strategy_id NOT NULL) satisfies neither existing branch in migration 073; it will stay NULL forever. This breaks the "Bridge recommendations actually worked" closed feedback loop that is the entire product's core value (PROJECT.md). The acceptance_criteria in 10-07 do not test a full round-trip outcome delta for a voluntary_add.

**HIGH** – Commit route uses per-row independent atomicity (good for UX) but the ScenarioCommitDrawer success path assumes *all* rows succeed or the drawer stays open with inline errors. The route returns `{recorded: N, errors: […]}` yet the drawer test (T_D12) only checks the partial state; there is no test that a later failing row does *not* roll back earlier successful inserts (the UI contract in 10-UI-SPEC and D-09). Combined with admin-client INSERTs, a partial failure could leave the DB and local draft out of sync.

**HIGH** – 10-06b composer calls `buildStrategyForBuilderSet` with the B4 lookup-map signature, but the test only greps for the *call site*; it does not assert that the returned `strategies` array never contains a hand-rolled `StrategyForBuilder` literal for added strategies (the N4 anti-pre-cast guard is only in the test file, not enforced at compile time). A future refactor could silently re-introduce the exact shape collision Pitfall 2 warns about.

**MEDIUM** – Fingerprint-mismatch banner defaults to "Keep my draft" (Claude's discretion) but the hook's auth-change effect clears the *old* allocator's key while the new allocator's draft may be stale. The test (T_USE11) only checks the clear; it does not verify that a mismatched draft for the *new* allocator still shows the banner. Edge case: user switches accounts on same browser.

**MEDIUM** – Migration 080 backfill sets *all* existing rows to `bridge_recommended` even if they were created by the old strategy-side path. The self-verifying DO block asserts zero NULLs but does not assert that every pre-existing row still satisfies its new CHECK. A malformed historic row would now be legal.

**LOW** – DrawdownChart scaling by `scenarioAum` assumes the equity_curve wealth series starts at 1.0; if the warm-up gate in the adapter drops the first few days, the drawdown anchor shifts. The test only checks that `deriveSnapshotDrawdowns` is called, not the resulting values.

**LOW** – No test asserts that the sticky footer z-index does not collide with HoldingNoteRow / OutcomesWidget sub-row stickies (explicit verification item in Claude's Discretion).

**Suggestions**
- Make the voluntary_add cron branch mandatory in the same atomic commit as 080 (add the third CTE branch that joins on `suggested_strategy_id` when both original_* are NULL). Update the DO block to assert it. Remove the deferral note.
- In the commit route, wrap the entire batch in a Postgres transaction (`BEGIN; … COMMIT;`) *unless* the per-row error contract is explicitly documented as "best-effort". Add a test that a failing row 2 does not prevent row 1 from being visible in the outcomes timeline.
- Add a TypeScript branded type `type AddedStrategyId = string & { readonly __brand: "added" }` and use it in the adapter signature so a pre-cast StrategyForBuilder cannot be passed at compile time.
- In `useScenarioState`, when `allocatorId` changes, also clear the *new* allocator's key if its stored fingerprint no longer matches (force the banner). Add the test.
- Extend the migration DO block to assert pre-existing `bridge_recommended` rows satisfy the new CHECK (no NULL/NULL pairs).
- In the DrawdownChart scenario test, assert the first drawdown value is anchored to the same peak as the live series after warm-up exclusion.
- Add a z-index audit in the ScenarioComposer test (or a manual probe in VALIDATION.md) that the footer never overlaps a sticky note row.

**Risk Assessment**
**MEDIUM**. The plans are among the best I have seen for this codebase—modular, regression-obsessed, zero new deps, explicit pinning of every inherited contract. Execution risk is concentrated in two places: (1) the deferred cron branch silently breaks the product's core learning loop, and (2) the commit drawer's per-row error path + drawer success/reset timing can leave the client draft and server outcomes out of sync.

**Sign-off recommendation**
**REQUEST_CHANGES**.

---

## Claude Review (Opus 4.7, fresh context)

**Summary**

Phase 10's planning is broad, well-decomposed across waves, and very disciplined about decision lineage (D-01..D-17, B4 adapter pinning, N1 per-allocator localStorage scoping). The frontend-side plans (10-01, 10-04, 10-05, 10-06a, 10-06b) read like a competent, low-risk extension of Phase 09.1's primitives — and the migration plan (10-02) is in good shape. **However, the SCENARIO-07 commit pipeline (Plan 10-07) is fundamentally broken at the schema level**: the route inserts `bridge_outcomes` rows that violate three independent NOT NULL / CHECK constraints from migration 059, and the `voluntary_add` cron-coverage "deferral" rests on a research claim that does not match the actual cron filter in migration 073. As written, Plan 10-07 will throw every commit and the only thing the schema regression tests in 10-02 will catch is the *match_decisions* shape — not the bridge_outcomes mismatch downstream. Two more issues block clean execution: AllocationsTabs has no `allocatorId` to give the composer (Plan 06b silently punts on this), and the discriminated-zod schema for the commit route doesn't carry the fields the bridge_outcomes table actually requires. **Verdict: REQUEST_CHANGES.** The phase needs a tightened bridge_outcomes shape decision (and likely a 081 migration relaxing bridge_outcomes constraints in lockstep with match_decisions) before execute is safe.

**Strengths**

- Decision lineage is excellent. Every plan cites D-XX gates; CONTEXT.md locks the phase and PLAN files defer rather than re-open. The B4 lookup-map adapter signature pin (Plan 01 / Plan 06b) is genuinely good — it forecloses the easy mistake of pre-casting in the composer.
- Plan 01's pure-TS-first sequencing is the right move. scenario-state and scenario-adapter are testable without DOM, deterministic fingerprint, immutable transforms, SSR-safe localStorage. The N1 per-allocator-scoped storage key (`allocations.scenario_v0_15.{allocatorId}`) is a real defense-in-depth win over the original CONTEXT.md "single key" design.
- Plan 02 (migration 080) is essentially correct: per-kind CHECK constraints with backfill, self-verifying DO block, atomic ADR-0023 sync, lock_timeout=3s. Pattern matches migration 072's discipline. The four CHECK constraints correctly mirror the four kinds.
- Plan 04's KpiStrip extension preserves the Phase 07 D-09 warmup gate verbatim by gating the new path on `mode === "scenario" && !warmingUp`. KpiStrip.warmup.test.tsx will stay green.
- Plan 06a's auth-change clear in `useScenarioState` (clear OLD allocator's key, NOT the new one's) is subtle and right.
- N4-pinned `vi.mock` test technique in Plan 06b avoids the brittle `vi.spyOn(import)` pattern.
- The frozen-engine discipline (`src/lib/scenario.ts` and its regression suite are zero-diff requirements verified by acceptance_criteria) is enforced consistently across every plan.

**Concerns**

**HIGH** – Plan 10-07 will fail every INSERT it attempts because the bridge_outcomes table schema doesn't match the route's payload. Migration 059 enforces:
- `strategy_id UUID NOT NULL REFERENCES strategies(id)` — voluntary_remove has no strategy → INSERT fails with NOT NULL violation
- Unique index on `(allocator_id, strategy_id)` — voluntary_remove can't satisfy
- Row CHECK: `kind='allocated' AND percent_allocated IS NOT NULL AND allocated_at IS NOT NULL AND rejection_reason IS NULL` — route sets none of these
- Row CHECK: `kind='rejected' AND rejection_reason IS NOT NULL AND percent_allocated IS NULL AND allocated_at IS NULL` — route doesn't pass rejection_reason as required (only `.nullish()` in zod)
- The `size_at_decision_usd` column the route INSERTs does not exist on bridge_outcomes (it's a column on `match_decisions` per Phase 06, not on `bridge_outcomes`).

This means SCENARIO-07's commit path is non-functional. The phase needs either (a) a parallel migration 081 relaxing bridge_outcomes for voluntary kinds (NULL-safe strategy_id for voluntary_remove + voluntary_modify; relaxed CHECK; widen the unique index), or (b) a redesign that does NOT INSERT bridge_outcomes for voluntary_remove (treat it as a synthetic match_decision only). Either way, the plan as written will fail acceptance_criteria T_R5..T_R8 the moment they run against the live DB.

**HIGH** – `voluntary_add` cron-coverage "deferral" rests on a research claim that contradicts migration 073's actual filter. The Pitfall 5 / Plan 02 deferral says voluntary_add deltas will fill via the existing strategy branch "once returns_series accumulate". I read migration 073 lines 167–173: the strategy_candidates filter is `bo.match_decision_id IS NULL OR (md.original_strategy_id IS NOT NULL AND md.original_holding_ref IS NULL)`. Voluntary_add rows have `match_decision_id NOT NULL` (route inserts it) AND `md.original_strategy_id IS NULL` AND `md.original_holding_ref IS NULL`. They satisfy NEITHER (a) NOR (b) and are silently skipped **forever**. Grok flagged this as HIGH; I concur — the deferral should explicitly accept "delta_30d remains NULL forever for voluntary_add rows in v0.15" OR migration 080 should add the third branch atomically. As written the CONTEXT.md ## Deferred Ideas note is technically accurate ("acceptable product behavior") but the *justification* in RESEARCH Pitfall 5 is wrong and will mislead future maintainers.

**HIGH** – `allocatorId` is not propagated to AllocationsTabs / ScenarioComposer. Plan 06b Task 2 step 4 acknowledges this: *"verify allocatorId is on MyAllocationDashboardPayload. If not present, EITHER (a) add it in Plan 03 retroactively (out of scope), OR (b) read it from a server-side context provider"*. I verified `MyAllocationDashboardPayload` (queries.ts:544–700) — it does NOT carry an allocator/user id. `AllocationContext.tsx` lines 37–43 expose only `flaggedCount`. The localStorage scoping (Plan 06a's whole N1 defense) and the API ownership gate both need a real source for the allocator id at the composer. Plan 06b punts to "search AllocationsTabs.tsx" but doesn't pin where it comes from. This needs to be resolved in Plan 03 (extend the payload) or via a wrapper component that already has access to `user.id` from the server-rendered page.

**HIGH** – The commit-route's per-row independent atomicity contradicts CONTEXT D-09's "single transaction" intent and creates a real desynchronization risk. The UI-SPEC (line 207) and Plan 07's threat-model both lean on per-row independent atomicity for graceful degradation. But the composer's success path (Plan 07 Task 2) calls `scenario.reset()` after `onSubmitSuccess()` — which clears localStorage. If a 5-diff commit returns `{recorded: 3, errors: [{index: 1, ...}, {index: 4, ...}]}`, the drawer shows "partial" state and DOES NOT call onSubmitSuccess. Good. But the user is now in a state where 3 diffs are persisted to the Bridge graph, 2 are still in the local draft, and the only "fix" is to re-submit the failing 2 — which works for some errors (transient network) but not for "Holding not owned" or "Strategy not published" (deterministic). The plan needs an explicit UX path for "deterministic per-row failure → tell the user to remove that row and resubmit", and the localStorage draft needs to be **partially** reduced (drop the successful indices) on partial-success. Right now the draft is either fully cleared or left untouched.

**MEDIUM** – Empty-portfolio voluntary-add path crashes the projection. CONTEXT.md "Empty-portfolio path" Claude's Discretion says the planner *"verifies the projection math handles 'all-added, no-baseline' gracefully (live baseline = empty curve)."* Plan 06b's empty-state branch returns early (renders `EmptyState` only) — there's no live-vs-scenario delta visible until the first holding lands. But the SCENARIO-04 acceptance criterion says *"Allocator can browse verified strategies and add any to the scenario composition"* — which a zero-holding allocator should be able to do via the EmptyState's "Browse strategies" CTA. That CTA opens the drawer, which calls `scenario.addStrategyBrowse`, which mutates state — but the composer is in the early-return EmptyState branch, so the projection charts and KpiStrip are never rendered. Either the empty-state branch needs to dynamically transition to the full composer once the user adds a strategy via the empty-state drawer, or the spec needs to lock empty-portfolio scenarios as out-of-scope.

**MEDIUM** – Plan 06b's adapter call for the live baseline is unnecessarily expensive and re-derives every render. It calls `buildStrategyForBuilderSet(holdingsSummary, new Set<string>(), [], holdingReturnsByScopeRef, {}, {})` inside a useMemo with `[holdingsSummary, holdingReturnsByScopeRef]` deps. Both inputs are stable across most renders, so the useMemo is fine — but the live baseline never changes for the same payload. It should be derived ONCE at the SSR boundary in queries.ts (Plan 03), packaged as a `liveBaselineMetrics` field, so the composer doesn't recompute computeScenario over the entire holdings set on every reflow. This is a real performance issue once an allocator has ≥30 holdings × ≥365 days of returns.

**MEDIUM** – `holdingReturnsByScopeRef` reconstruction merges venues silently and the assumption is documented but never validated by an alarm. The reconstruction's caveat (research Pattern 3 / Caveats line) merges BTC@binance + BTC@okx into a single returns series via the symbol key on `breakdown` jsonb. Acceptable as Phase 10 mirroring Phase 09 Python-engine convention — but two scope_refs end up pointing at the same data, and `computeScenario`'s correlation matrix will treat them as IDENTICAL series (correlation = 1.0). For an allocator who legitimately holds the same asset on multiple venues with different exposure (e.g. BTC spot on Binance + BTC perpetual on OKX), the projection will understate diversification.

**MEDIUM** – Discriminated-zod commit schema is missing the fields bridge_outcomes actually requires. Even ignoring the schema-mismatch HIGH above, Plan 07's zod has `rejection_reason: z.string().max(100).nullish()` for voluntary_remove. Bridge_outcomes' rejection_reason is constrained `IN ('mandate_conflict','already_owned','timing_wrong','underperforming_peers','other')`. The route would reject any voluntary_remove with `rejection_reason='other'` only IF the column accepts it; but more crucially the route doesn't pass `rejection_reason` to the INSERT call at all (Plan 07 Task 1 GREEN block lines ~313–321).

**MEDIUM** – `bridge_recommended` commit-route branch uses an "if exists, reuse else create" path that's a race condition. Plan 07 spec for T_R8: *"if existing match_decision exists for the (allocator, holding_ref, candidate) tuple, REUSE its id; else INSERT new"*. The implementation skeleton in Task 1 GREEN doesn't actually do this lookup — the route always INSERTs. With migration 074's widened unique index this could collide on a duplicate (allocator, original_holding_ref, suggested_strategy_id) tuple if the user clicked "Add to scenario" then later "Send intro" (or vice versa). The "reuse" semantics are stated in `truths` but never implemented.

**MEDIUM** – Plan 06b's diff-count semantics double-count weight changes that are caused by toggle-off. `useScenarioState.diffCount` (Plan 06a) computes: changed toggles + addedStrategies.length + weight overrides differing from default by >1e-9. But toggling a holding off triggers `renormalizeWeights` which writes new values to `weightOverrides` for every remaining enabled row. So a single toggle-off produces 1 toggle-diff + (N-1) weight-overrides "diffs". The footer chip will show "5 changes" for what the user thinks is 1 action.

**MEDIUM** – ScenarioFlaggedHoldingsList double-render risk in v2 path. The composer embeds `ScenarioFlaggedHoldingsList` as the Bridge inline card section AND wires up its own `BridgeDrawer` with `onAddToScenario`. Both paths surface flagged holdings; the user could add the same candidate twice. Plan 01's `addStrategyBridge` doesn't dedupe — it just appends to addedStrategies.

**MEDIUM** – Plan 03's `/api/strategies/browse` returns ALL published strategies with no pagination. CONTEXT marks this acceptable ("verified strategy count is ~tens, not thousands") but the route has no upper bound. A v0.16 strategy-onboarding push could 10× this.

**MEDIUM** – Pre-flight modal nesting violates a11y best practice. Plan 07 Task 2 puts the pre-flight confirmation modal *inside* the ScenarioCommitDrawer's role="dialog" container. Two role="dialog" elements nested with a focus trap on the outer = focus management bugs.

**LOW** – Migration 080 self-verifying DO block is missing assertion (e): *no rows violate any of the four CHECK constraints* (after the constraints are added).

**LOW** – Mandate-fit tier rubric (Plan 05) maps `0.8 = green` for fraction-overlap, but D-08 specifies `≥0.7 = green`. Pin to 0.7 for grep-consistency with D-08.

**LOW** – Plan 06b uses `dynamic(() => ..., {ssr: false})` with `useScenarioState` (which reads localStorage), creating a hydration flash on every Scenario tab activation.

**LOW** – Plan 06a's `defaultDraftFromHoldings` signature is ambiguous between Plan 01 (1 arg) and Plan 06a (2 args); pin in Plan 01.

**LOW** – Plan 03 reconstructs `holdingReturnsByScopeRef` from `equitySnapshots` only; if `breakdown` is NULL on every snapshot the result is empty record. Test case T11 "all-NULL breakdown" missing.

**Suggestions**

- **Block-the-phase fix #1 (HIGH-1):** Add an 081 migration relaxing bridge_outcomes for voluntary kinds: nullable `strategy_id` when `match_decision.kind` is `voluntary_remove` (or ditch bridge_outcomes for voluntary_remove entirely — record the outcome only via match_decisions audit metadata). Widen or drop the `(allocator_id, strategy_id)` unique index to `(allocator_id, match_decision_id)`. Update CHECK to a kind-aware shape. ADR-0023 sync.
- **Block-the-phase fix #2 (HIGH-2):** Decide explicitly: does voluntary_add get a third cron branch in migration 080 (preferred — closes the loop properly), or accept "voluntary_add deltas are NULL forever" with a UI banner ("realized return tracking unavailable for self-added strategies in v0.15")? The current "we'll defer and the existing branch will pick it up" is wrong on its premise.
- **Block-the-phase fix #3 (HIGH-3):** Pin `allocatorId` propagation. Either add `allocator_id: string` to MyAllocationDashboardPayload in Plan 03 (cheapest, additive) OR have the parent server component (`MyAllocationClient.tsx` or wherever the page mounts) pass `allocatorId` as a prop through AllocationsTabs to ScenarioComposer.
- **Block-the-phase fix #4 (HIGH-4):** Pin commit-route partial-failure semantics. On `partial`, the drawer must (a) drop successful diffs from the localStorage draft, (b) keep failed diffs visible with their per-row error, (c) require the user to fix or remove failed rows before re-submitting. Replace `onSubmitSuccess` with `onSubmitResult({recorded, errors})`.
- Add a regression test specifically for `bridge_outcomes` insert success against the live DB in Plan 02 (or a new 081 plan).
- Lift the live-baseline `computeScenario` call to SSR (Plan 03 returns `liveBaselineMetrics` as part of payload).
- Add a `scenario_id_dedupe` guard to `addStrategyBridge` and `addStrategyBrowse` — return same draft if `id` already in `addedStrategies`.
- Pin `LIMIT 200` on `/api/strategies/browse` and document the cap.
- Pin mandate-fit fraction threshold at 0.7 for D-08 grep-consistency.
- Migration 080's DO block: add assertion (e) "all existing rows pass all four CHECK constraints".
- Restructure ScenarioCommitDrawer so pre-flight modal renders OUTSIDE the drawer's role="dialog" container.
- Plan 06b: pin `defaultDraftFromHoldings` signature in Plan 01 to take an optional `fingerprint?: string`; add a Plan 01 test case for the 2-arg form.

**Risk Assessment**

**HIGH**. The schema mismatch in Plan 07 is a hard blocker — no commit will succeed when run against the live DB, regardless of how many vitest mocks pass. The cron-coverage misjustification is a permanent data-quality bug for voluntary_add rows that wouldn't be caught until 30 days post-pilot. The allocatorId gap breaks both the N1 localStorage scoping AND the commit-route ownership gate that depends on knowing which allocator is committing — this would surface as a TypeScript error during Plan 06b execution and block the entire wave.

**Top three things to fix before execute:**
1. Resolve bridge_outcomes constraint mismatch (HIGH-1) — needs an 081 migration or a redesign that doesn't insert bridge_outcomes for voluntary_remove.
2. Decide voluntary_add cron coverage explicitly (HIGH-2) — either ship the third cron branch in migration 080 or document the NULL-forever acceptance with UI surface.
3. Pin allocatorId source in Plan 03 (cheapest fix) — extend MyAllocationDashboardPayload with `allocator_id: string`.

**Sign-off recommendation**

**REQUEST_CHANGES**. The phase has strong bones — context, decisions, wave decomposition, B4/N1 invariants, frozen-engine discipline are all excellent. But Plan 07 cannot ship as written, the cron deferral is justified by a false claim, and the allocatorId gap blocks two waves.

---

## Consensus Summary

Both reviewers independently land on **REQUEST_CHANGES**. Grok rates the phase **MEDIUM risk**; Claude (after verifying against migrations 059/073 and `queries.ts` directly) rates it **HIGH risk** because two of Claude's HIGH findings are showstoppers Grok could not catch from plans alone.

### Agreed strengths (concur from both reviewers)
- Wave ordering correct; pure-TS foundation (Plan 01) lands before React or DB.
- B4 lookup-map adapter pinning is a real defense against shape-collision regression.
- N1 per-allocator localStorage scoping is the right call (defense in depth over the original "single key" CONTEXT.md design).
- Plan 02 migration 080 discipline (per-kind CHECKs, atomic ADR-0023 sync, lock_timeout, self-verifying DO block) matches migration 072 standard.
- Phase 07 warmup gates and Phase 09.1 invariants explicitly preserved.
- UI-SPEC fidelity: copy, tokens, a11y matrix, destructive-action matrix verbatim in the composer/drawers.
- Threat models per plan address the real risks (cross-tenant holding_ref, return-vs-wealth Pitfall 1, fingerprint collision).

### Agreed concerns (highest priority — both reviewers flagged HIGH)

1. **HIGH — voluntary_add cron coverage is broken, not just deferred** (concur HIGH). Both reviewers verified the cron branches in migration 073 won't fire on rows where both `original_*` are NULL. The deferral note in CONTEXT.md is technically defensible as product behavior; the *justification* in RESEARCH Pitfall 5 ("the existing strategy branch will pick it up") is **factually wrong**. Either ship the third cron branch in migration 080 atomically or document "delta_30d NULL forever for voluntary_add in v0.15" with a UI banner.

2. **HIGH — commit-route partial-failure desyncs client and server** (concur HIGH). Per-row independent atomicity is fine for UX but the current spec clears the entire localStorage draft on full success and leaves it untouched on partial. With deterministic per-row failures (e.g. "Strategy not published"), the user can only re-submit. Need explicit "drop successful indices from draft, keep failed visible with per-row error" semantics and a single Postgres tx OR explicit best-effort documentation with a regression test.

### Concerns Claude alone flagged HIGH (Grok could not have seen these without reading migrations)

3. **HIGH — Plan 10-07 bridge_outcomes INSERT will throw against the live schema** (Claude verified migration 059). Voluntary_remove can't satisfy `strategy_id NOT NULL`, the `(allocator_id, strategy_id)` unique index, the `kind='allocated'`/`kind='rejected'` CHECK constraints, or the route's nonexistent `size_at_decision_usd` column. SCENARIO-07 will fail every commit on the first live-DB run. Needs migration 081 relaxing bridge_outcomes for voluntary kinds, OR a redesign that records voluntary_remove as a synthetic match_decision only (no bridge_outcomes row). **This is a showstopper.**

4. **HIGH — `allocatorId` is not on `MyAllocationDashboardPayload`** (Claude verified `queries.ts:544–700` and `AllocationContext.tsx:37–43`). Plan 06b acknowledges the gap and punts. Plan 06a's N1 per-allocator localStorage key, Plan 07's per-row ownership gate, and the auth-change `useEffect` all need a real source. Cheapest fix: add `allocator_id: string` to the payload in Plan 03 retroactively.

### Concerns Grok alone flagged

5. **HIGH (Grok)** — B4 adapter shape-collision guard is test-only, not type-level. Branded type recommended (`AddedStrategyId = string & { __brand: "added" }`).

### Additional concerns Claude alone flagged

6. **MEDIUM** — Empty-portfolio voluntary-add UX crashes between EmptyState early-return branch and the composer body once a strategy is added.
7. **MEDIUM** — Live-baseline `computeScenario` recomputes per render; should lift to SSR (Plan 03 → `liveBaselineMetrics`). Real perf hit at ≥30 holdings × ≥365 days.
8. **MEDIUM** — `holdingReturnsByScopeRef` merges multi-venue same-symbol holdings (BTC@binance + BTC@okx → identical series → correlation = 1.0). Understates diversification. Multi-venue test fixture missing.
9. **MEDIUM** — Discriminated zod missing `rejection_reason` enum mapping; route never passes it to INSERT.
10. **MEDIUM** — `bridge_recommended` commit-route "reuse-or-create" semantics stated in `truths` but never implemented.
11. **MEDIUM** — `diffCount` double-counts weight changes from toggle-off renormalization (1 toggle = N "changes" in the chip).
12. **MEDIUM** — `ScenarioFlaggedHoldingsList` and `BridgeDrawer.onAddToScenario` both feed `addStrategyBridge`; no dedupe → double-add bug.
13. **MEDIUM** — `/api/strategies/browse` has no `LIMIT`. Add 200, document the cap.
14. **MEDIUM** — Pre-flight confirmation modal nested inside `role="dialog"` drawer = focus-trap a11y bug.
15. **LOW** — Mandate-fit threshold drift: Plan 05 uses `0.8 = green`; D-08 says `≥0.7 = green`. Grep-inconsistency.
16. **LOW** — `defaultDraftFromHoldings` arity mismatch between Plan 01 (1 arg) and Plan 06a (2 args). Pin in Plan 01.
17. **LOW** — `dynamic(..., {ssr: false})` + localStorage `useScenarioState` = hydration flash on tab activation.
18. **LOW** — Plan 03 missing T11 "all-NULL breakdown" test fixture.

### Additional concerns Grok alone flagged
- **MEDIUM** — Auth-change clears the *old* allocator's key but doesn't force the fingerprint banner if the *new* allocator's stored draft is stale.
- **MEDIUM** — Migration 080 DO block doesn't assert pre-existing `bridge_recommended` rows actually satisfy the new CHECK.
- **LOW** — DrawdownChart anchor shifts if warm-up gate drops days.
- **LOW** — Sticky footer z-index vs HoldingNoteRow / OutcomesWidget sub-row stickies — no test.

### Divergent views
- **Risk level**: Grok says MEDIUM, Claude says HIGH. The divergence is entirely explained by the bridge_outcomes schema mismatch (Concern #3) — Grok did not read migration 059, and the plans don't mention the constraint set verbatim. Claude's HIGH rating is justified by that finding alone.

---

## How to incorporate

Feed this back into planning with:

```
/gsd-plan-phase 10 --reviews
```

### Recommended minimum before execute (consensus-prioritized)

1. **Schema integrity** (Claude HIGH-1) — decide bridge_outcomes shape for voluntary kinds: ship migration 081 (relax NOT NULL on `strategy_id`, widen unique index to `match_decision_id`, kind-aware CHECK) OR redesign so voluntary_remove records only via match_decisions audit metadata (no bridge_outcomes row). Without this, Plan 07 cannot land.
2. **Cron coverage** (both HIGH) — ship the third cron branch in migration 080 atomically OR explicitly accept "delta_30d NULL forever for voluntary_add in v0.15" with a UI banner. Fix the Pitfall 5 justification text either way (it is currently wrong).
3. **`allocatorId` propagation** (Claude HIGH) — add `allocator_id: string` to `MyAllocationDashboardPayload` in Plan 03. Cheapest, additive, unblocks Plan 06a's N1 scoping AND Plan 07's per-row ownership probe.
4. **Commit-route partial-failure semantics** (both HIGH) — pin: drop successful indices from localStorage draft, keep failed visible with per-row error; replace `onSubmitSuccess` with `onSubmitResult({recorded, errors})`; add a regression test that row-2 failure does not desync row-1.
5. **B4 type-level guard** (Grok HIGH) — branded type `AddedStrategyId` so the adapter signature is enforced at compile time.

The 13+ MEDIUM/LOW items below those are hygiene and would not block a careful execute, but several (live-baseline SSR lift, multi-venue correlation, dedupe guard, pagination cap, modal a11y) would be cheap to fold into the planner pass and worth doing.

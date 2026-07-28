# Phase 23: Scenario Persistence & Compare - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous — grey areas decided by orchestrator per no-clients directive; user may override)

<domain>
## Phase Boundary

This phase makes scenarios durable and comparable. It delivers four capabilities and nothing more:

1. **Save** a named scenario to Postgres, storing only the `ScenarioDraft` JSONB (refs + weights + added strategies + `schema_version`) — never the raw return series — RLS-scoped to the owning allocator.
2. **Reopen** a saved scenario back into the existing composer, re-resolving its return series from the *live* holdings payload and surfacing the existing fingerprint-mismatch banner when holdings drifted (never a silent recompute over a changed strategy set).
3. **Manage** the list: list / rename / delete the allocator's own saved scenarios.
4. **Compare** 2+ saved scenarios (and the live book) side-by-side, ranked by Sharpe / return improvement, each column stamped with its own overlap window + N, with degenerate scenarios shown as an honest em-dash.

Out of scope (later phases, do not build here): read-only sharing (Phase 25), benchmark overlay in the compare view (Phase 24), stress/VaR/Monte-Carlo/optimizer columns (Phases 26–28).
</domain>

<decisions>
## Implementation Decisions

### Persistence model & RLS
- New `scenarios` table: `id uuid pk default gen_random_uuid()`, `allocator_id uuid not null references profiles on delete cascade`, `name text not null` with a `length(btrim(name)) between 1 and 120` check, `draft jsonb not null`, `schema_version int not null`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`.
- `schema_version` is a **top-level column** (in addition to the value inside the draft JSONB), per the STATE.md key risk gate — Phases 26/27/28 must be able to branch on / extend the schema without reparsing the JSONB.
- RLS: enable RLS and add a single owner policy mirroring the proven `api_keys_owner` pattern — `FOR ALL USING (allocator_id = auth.uid()) WITH CHECK (allocator_id = auth.uid())`. This satisfies the "only sees their own scenarios" criterion. RLS leak here is lower-cost than Phase 25 (no sharing yet) but still asserted in tests on cross-tenant *content*, not just policy presence (RLS fails silently).
- Store **only** the `ScenarioDraft` JSONB. Never persist the resolved/raw return series — series are always re-resolved from live data on reopen/compare.
- "Leverage" in PERSIST-01's enumeration predates the #507 read-only-token-holdings refactor (commit 06971527) which removed the per-holding weight/leverage input from the composer (see `scenario-state.ts:49`). The live `ScenarioDraft` (v2) carries no separate leverage field. Decision (Rule 7 — favor the more-recent shipped code): persist the **full current draft shape as-is**; do not reintroduce removed leverage UI to satisfy stale requirement text. Flag for plan-phase to reconcile the exact field list against live `ScenarioDraft`.
- Name is **not** unique per allocator (avoid a 23505 timebomb the migration-reviewer flags; allocators may keep duplicate working names). Trim + 1..120 char check only. No per-allocator save cap (YAGNI; no clients yet).
- Migration: new forward-timestamped file under `supabase/migrations/` (`YYYYMMDDhhmmss_*.sql`) with a matching rollback under `down/`. Respect the backdated-migration guard (forward timestamp) and the canonical SQL-function snapshot/drift gate (a plain table + policy does not define a tracked function, so it should not trip the gate — verify at review time). `migration-reviewer` + `rls-policy-auditor` must run at review.

### Save & reopen behavior
- Save trigger: a "Save scenario" action in the composer toolbar → inline name input (not a heavy modal) → INSERT. When a saved scenario is currently open (track the loaded scenario id in composer state), the primary action becomes "Update" (writes back to that row, touches `updated_at`) with a secondary "Save as new". Floor = always-create; target = update-in-place when a saved scenario is open.
- Reopen: from the saved-scenarios list, "Open" loads the row's draft → hydrates the composer state → re-resolves return series from the **live** holdings payload → recomputes the holdings fingerprint vs current holdings → surfaces the **existing** fingerprint-mismatch banner when drifted. Never silently recompute over a changed strategy set.
- Schema-version mismatch on a reopened draft: run the saved draft through the **same** `scenarioDraftCodec` trichotomy used for localStorage (`ok` / `readonly` / `reset`). On `reset` (older incompatible format), render an honest notice ("this saved scenario uses an older format and can't be reopened") — do NOT silently default to an empty composer. On `readonly` (future version written by a newer build), block edits honestly. Reuses Phase 22 honesty discipline.
- Integration: `useScenarioState` currently seeds only from per-allocator localStorage. Add a one-shot "hydrate from a provided draft" entry point so Open can seed the composer from a DB draft, WITHOUT breaking the localStorage autosave of the unsaved working draft. Exact wiring is plan-phase's call; the locked behavior is "Open seeds the composer, then the normal autosave + fingerprint logic takes over."

### List & manage UI
- Location: a "Saved scenarios" section on the allocations **Scenario tab** (the tab surfaced in Phase 21), adjacent to the composer.
- Each row: name, saved/updated timestamp, and (when cheaply available without a full recompute) N + overlap window stamp.
- Rename: inline edit → PATCH name (trim/length re-validated). Delete: small destructive inline confirm (not a full modal) → DELETE.
- Empty state: reuse `EmptyStateCard` — "No saved scenarios yet" + body on how to save one.

### Compare UI & compute
- Selection: checkboxes on the saved-scenarios list plus a "Live book" pseudo-row (the allocator's current actual blend). "Compare selected" enables at ≥2 selections.
- Compute: for each selected saved scenario, re-resolve its draft's return series from live data and run `computeScenario()` (`src/lib/scenario.ts`) → `ComputedMetrics`. The live-book column reuses whatever already computes the live allocation's metrics.
- Render: mirror the existing `CompareTable` pattern (`src/components/strategy/CompareTable.tsx`) — metric rows × scenario columns with winner-highlighting. Metric rows from `ComputedMetrics`: Cumulative Return, CAGR, Sharpe, Sortino, Max Drawdown, Volatility.
- Ranking: by Sharpe (primary) / return improvement per PERSIST-04 — highlight the best per metric (CompareTable's `findWinner`) and surface the Sharpe leader.
- **Honesty (load-bearing):** each column stamps its OWN overlap window + N via `methodologyLine(n)` (Phase 22) — different scenarios have different windows; stamp independently, do NOT force a common window (benchmark window alignment is Phase 24's job). A degenerate scenario (N below usable / null metric) shows an em-dash "—", never a fabricated 0 (PERSIST-04 + the #509 heatmap-heading lesson: never let copy/values imply data that isn't there).
- Location: an in-tab compare panel on the Scenario tab (avoid a new authenticated route surface). Plan-phase may choose modal vs panel; default in-tab panel.

### Claude's Discretion
- Exact composer-hydration wiring, the precise route/server-action vs RSC split for CRUD, modal-vs-panel for compare, and the live-book metric source are at the planner's discretion within the locked behaviors above.

### No new dependencies / no Python
- All compute is pure TypeScript (`computeScenario`). Persistence is TS + one SQL migration. No `analytics-service` change → Railway deploy is a no-op (matches Phases 21/22).
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ScenarioDraft` + `SCENARIO_SCHEMA_VERSION` (=2) + `scenarioDraftSchema` (zod) + `scenarioDraftCodec()` trichotomy — `src/app/(dashboard)/allocations/lib/scenario-state.ts:57,75,499,521`. Persisted shape: `schema_version`, `init_holdings_fingerprint`, `toggleByScopeRef`, `addedStrategies[]`, `weightOverrides`, `userWeightOverrides?`, `lastEditedAt`. No raw series; no separate leverage field.
- `computeScenario(strategies, state, dateMapCache)` → `ComputedMetrics` (n, twr, cagr, volatility, sharpe, sortino, max_drawdown, equity_curve in RETURN form, correlation_matrix, avg_pairwise_correlation, effective_start/end) — `src/lib/scenario.ts:132,85`. Pure TS, pinned by `scenario.test.ts`.
- `computeHoldingsFingerprint()` + the fingerprint-mismatch banner logic in `useScenarioState` (`fingerprintMismatch`, `dismissFingerprintMismatchBanner`) — the reopen path reuses this verbatim.
- Phase-22 honesty: `methodologyLine(n)` (`src/lib/scenario-history.ts:41`), `evaluateSampleFloor` + `SAMPLE_FLOOR_OVERLAPPING_DAYS=60` (`src/lib/sample-floor.ts:37,70`), `EmptyStateCard` (`src/components/ui/EmptyStateCard.tsx`).
- `CompareTable` side-by-side pattern (metric rows × columns, `findWinner`) — `src/components/strategy/CompareTable.tsx`.

### Established Patterns
- Allocator-owned RLS: `api_keys_owner` — `FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())` (`supabase/migrations/20260405061912_rls_policies.sql:22`).
- Migrations: `YYYYMMDDhhmmss_snake_case.sql`; rollbacks in `migrations/down/`; latest is `20260620120000_*`. `security_invoker` VIEW + REVOKE-PUBLIC hardening pattern from PR #477 (Phase 19) for any view (not needed for a plain owner-RLS table).
- Auth on routes: `withAuth` middleware extracting `user.id`; ownership re-checked server-side even with RLS.

### Integration Points
- Scenario tab in `AllocationsTabs` (Phase 21) — the home for the saved-scenarios list + compare panel.
- `ScenarioComposer.tsx` + `useScenarioState` — the save/reopen seam.
- New: `scenarios` table + migration; a CRUD route/server-action; the saved-scenarios list, save control, and compare panel components.
</code_context>

<specifics>
## Specific Ideas

- The reopen criterion is explicit that drift must surface the *existing* banner, not a silent recompute — this is the same no-invented-data invariant as Phase 21/22 and the #509 heatmap fix. Treat any silent fallback as a bug.
- Compare must tolerate heterogeneous overlap windows across columns (each stamped independently). Forcing a single window is wrong here and belongs to Phase 24's benchmark alignment.
</specifics>

<deferred>
## Deferred Ideas

- Read-only revocable share link for a saved scenario → Phase 25 (RLS leak is the highest-cost silent failure there; snapshot-don't-reference + token-scoped SECURITY DEFINER read).
- Benchmark overlay / tracking-error columns in compare → Phase 24.
- Stress/VaR, Monte-Carlo bands, optimizer-suggested-weights columns → Phases 26/27/28 (they extend the persisted draft via the `schema_version` column reserved here).
</deferred>

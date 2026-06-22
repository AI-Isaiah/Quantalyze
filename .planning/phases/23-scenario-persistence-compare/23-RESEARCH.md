# Phase 23: Scenario Persistence & Compare - Research

**Researched:** 2026-06-21
**Domain:** Postgres persistence (Supabase RLS) + Next.js 16 allocator-owned CRUD + reuse of the existing client-side scenario engine for compare
**Confidence:** HIGH (every claim below is VERIFIED against in-repo code/CI; no new external packages)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Persistence model & RLS**
- New `scenarios` table: `id uuid pk default gen_random_uuid()`, `allocator_id uuid not null references profiles on delete cascade`, `name text not null` with `length(btrim(name)) between 1 and 120` check, `draft jsonb not null`, `schema_version int not null`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`.
- `schema_version` is a **top-level column** (in addition to the value inside the draft JSONB) — STATE.md gate: Phases 26/27/28 must branch on / extend the schema without reparsing the JSONB.
- RLS: enable RLS + single owner policy mirroring `api_keys_owner` — `FOR ALL USING (allocator_id = auth.uid()) WITH CHECK (allocator_id = auth.uid())`. Asserted in tests on cross-tenant *content*, not just policy presence (RLS fails silently).
- Store **only** the `ScenarioDraft` JSONB. Never persist resolved/raw return series — series re-resolved from live data on reopen/compare.
- "Leverage" in PERSIST-01's text predates the #507 read-only-holdings refactor; persist the **full current draft shape as-is**; do not reintroduce removed leverage UI. (See "Field-list reconciliation" below — this research confirms the exact persisted field list.)
- Name is **not** unique per allocator. Trim + 1..120 char check only. No per-allocator save cap (YAGNI).
- Migration: new forward-timestamped file under `supabase/migrations/` (`YYYYMMDDhhmmss_*.sql`) + matching rollback under `down/`. Respect the backdated-migration guard (forward timestamp) and the SQL-function snapshot/drift gate. `migration-reviewer` + `rls-policy-auditor` must run at review.

**Save & reopen behavior**
- Save trigger: "Save scenario" in composer toolbar → inline name input → INSERT. When a saved scenario is open (track loaded scenario id in composer state), primary becomes "Update" (writes back, touches `updated_at`) + secondary "Save as new". Floor = always-create; target = update-in-place when open.
- Reopen: "Open" → loads row's draft → hydrates composer → re-resolves return series from **live** holdings payload → recomputes fingerprint vs current holdings → surfaces the **existing** fingerprint-mismatch banner when drifted. Never silently recompute over a changed strategy set.
- Schema-version mismatch on reopen: run saved draft through the **same** `scenarioDraftCodec` trichotomy (`ok` / `readonly` / `reset`). `reset` → honest notice ("older format, can't be reopened"), never silent empty composer. `readonly` → block edits honestly.
- `useScenarioState` currently seeds only from per-allocator localStorage. Add a one-shot "hydrate from a provided draft" entry point so Open seeds the composer from a DB draft WITHOUT breaking localStorage autosave of the unsaved working draft.

**List & manage UI** — "Saved scenarios" section on the Scenario tab (Phase 21), adjacent to composer. Row: name, saved/updated timestamp, (when cheaply available) N + overlap window. Rename inline → PATCH. Delete small inline confirm → DELETE. Empty state reuses `EmptyStateCard`.

**Compare UI & compute** — Checkboxes on the list + a "Live book" pseudo-row. "Compare selected" at ≥2. For each saved scenario re-resolve draft's return series from live data + run `computeScenario()` → `ComputedMetrics`. Live-book column reuses whatever already computes live allocation metrics. Mirror `CompareTable` (metric rows × columns + `findWinner`). Rows: Cumulative Return, CAGR, Sharpe, Sortino, Max Drawdown, Volatility. Rank by Sharpe (primary)/return improvement. Each column stamps its OWN overlap window + N via `methodologyLine(n)` — heterogeneous windows; do NOT force a common window. Degenerate scenario → em-dash "—", never fabricated 0. In-tab panel default (planner may choose modal vs panel).

### Claude's Discretion
- Exact composer-hydration wiring, route/server-action vs RSC split for CRUD, modal-vs-panel for compare, live-book metric source — planner's discretion within the locked behaviors.

### Deferred Ideas (OUT OF SCOPE)
- Read-only revocable share link → Phase 25.
- Benchmark overlay / tracking-error columns in compare → Phase 24.
- Stress/VaR, Monte-Carlo bands, optimizer-suggested-weights columns → Phases 26/27/28 (extend the persisted draft via the `schema_version` column reserved here).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PERSIST-01 | Save a named scenario to DB (JSONB draft; never raw series) | `scenarios` table + owner RLS (mirror `api_keys_owner`); persist `ScenarioDraft` verbatim via `scenario-state.ts` shape. "leverage" in REQ text is stale (#507) — see Field-list reconciliation. INSERT via allocator-owned route (`withAllocatorAuth`). |
| PERSIST-02 | Reopen a saved scenario, rehydrating the draft into the composer | New one-shot `initialDraft`/hydrate seam in `useScenarioState`; reuse `scenarioDraftCodec` trichotomy + `computeHoldingsFingerprint` mismatch banner verbatim. Series re-resolved through the same adapter→`computeScenario` path the composer already runs. |
| PERSIST-03 | List, rename, delete own saved scenarios | GET (RSC fetch or route) + PATCH name + DELETE, all RLS-scoped + `withAllocatorAuth` server re-check. Reuse `EmptyStateCard`. |
| PERSIST-04 | Compare 2+ saved scenarios (+ live book) side-by-side, ranked by Sharpe/return | For each draft re-run `computeScenario` over the live `payload.strategies`/holdings set; live-book column = `liveBaselineMetricsFromHoldings` (or `payload.liveBaselineMetrics`). Mirror `CompareTable`. Per-column `methodologyLine(n)`; em-dash via `formatPercent`/`formatNumber` null path. |
</phase_requirements>

## Summary

This is a thin-but-load-bearing phase: there is **no new compute, no new external dependency, no Python**. The entire feature is (1) one new `scenarios` table + owner RLS migration, (2) a small allocator-owned CRUD surface that copies the existing `/api/allocator/scenario/commit` route conventions verbatim, (3) a single new "hydrate-from-provided-draft" seam in `useScenarioState`, and (4) a compare panel that re-runs the **already-frozen** `computeScenario` engine over each saved draft and renders into a `CompareTable`-mirrored grid.

The two genuine risks are honesty-correctness and the DB workflow. Honesty: the reopen path must reuse the **existing** `scenarioDraftCodec` trichotomy and fingerprint-mismatch banner — a reopened draft that no longer matches live holdings, or whose `schema_version` is older/newer, must surface the same honest UX the localStorage path already produces, never a silent recompute or an empty composer. The compare panel must stamp each column's own window via `methodologyLine(n)` and render `"—"` for degenerate columns (the `formatPercent`/`formatNumber` null path already does this for free). DB workflow: this repo does **not** `supabase db push` to a local DB from the executor — migrations are append-only files applied at deploy time, gated by `migration-policy.yml` (rejects backdated timestamps) and `dump-sql-functions.ts --check` (the SQL-function snapshot drift gate). The executor writes the forward migration + the `down/` rollback + a `supabase/tests/test_*.sql` RLS test + **hand-patches `src/lib/database.types.ts`** (it is `gen types`-generated but cannot be regenerated without prod DB access; the `[#14]` guard test pins this).

**Primary recommendation:** Copy the four established patterns exactly — `api_keys_owner` RLS, the `/api/allocator/scenario/commit` route shape (`withAllocatorAuth` + `NO_STORE_HEADERS` + zod body + redacted error envelope), the `useScenarioState` codec/fingerprint trichotomy, and `CompareTable`'s metric-rows × columns + `findWinner` layout — and add nothing novel. The only new module surface is the table, the CRUD route(s), the hydration seam, and the compare panel.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Persist named scenario (PERSIST-01) | Database (RLS table) | API/Backend (route + zod) | Ownership + tenant isolation is an RLS concern; the route is a thin validated writer. |
| Save / Update / Save-as-new gesture | Browser (composer toolbar state) | API/Backend (INSERT/UPDATE) | Which gesture (create vs update) is client UI state (loaded-scenario id); the write is server-side. |
| Reopen → hydrate composer (PERSIST-02) | Browser (`useScenarioState` seam) | API/Backend (GET draft) | Hydration + fingerprint + codec trichotomy are pure client domain logic already living in the hook. |
| List / rename / delete (PERSIST-03) | API/Backend (CRUD) | Database (RLS) | Allocator-owned writes; RLS is the binding gate, route re-checks server-side. |
| Re-resolve series + compute compare metrics (PERSIST-04) | Browser (pure TS `computeScenario`) | — | Engine is frozen pure TS; live returns already client-side in `payload`. No server compute. |
| Live-book column metrics | Browser (`liveBaselineMetricsFromHoldings`) or SSR (`payload.liveBaselineMetrics`) | — | Two existing producers; planner picks one (see Q4). |
| Cross-tenant isolation guarantee | Database (RLS) | Testing (`supabase/tests/*.sql`) | RLS fails silently → must assert on cross-tenant *content* in a SQL test. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zod` | already in repo (used by `scenarioDraftSchema` + every API route) `[VERIFIED: repo]` | Validate the persisted draft on read + the CRUD request body | The codebase's canonical validation seam; `scenarioDraftSchema` already exists and IS the draft contract. |
| `@supabase/supabase-js` | already in repo (`createClient`, `createAdminClient`) `[VERIFIED: repo]` | User-scoped client for RLS-bound CRUD | All allocator-owned writes use the user-scoped `createClient()` so `auth.uid()` resolves (NOT service-role). |
| Next.js (App Router) | repo's pinned version — **NOT training-data Next.js** (per AGENTS.md, read `node_modules/next/dist/docs/` before route/cache code) `[CITED: AGENTS.md]` | Route handlers / server actions / RSC for CRUD | Existing routes use `route.ts` handlers (`export const POST = withAllocatorAuth(...)`, `export const runtime = "nodejs"`). |

### Supporting (all in-repo, reuse verbatim — no install)

| Module | Path | Purpose |
|--------|------|---------|
| `scenarioDraftSchema` / `scenarioDraftCodec` / `ScenarioDraft` / `SCENARIO_SCHEMA_VERSION=2` | `src/app/(dashboard)/allocations/lib/scenario-state.ts` `[VERIFIED: repo]` | The persisted shape, its zod validator, and the ok/readonly/reset version trichotomy. |
| `computeScenario` / `buildDateMapCache` / `ComputedMetrics` | `src/lib/scenario.ts:132` `[VERIFIED: repo]` | The frozen compare-metrics engine (pinned by `scenario.test.ts`). |
| `useScenarioState` (+ `computeHoldingsFingerprint`, fingerprint-mismatch banner) | `src/app/(dashboard)/allocations/hooks/useScenarioState.ts` `[VERIFIED: repo]` | The save/reopen seam owner. |
| `liveBaselineMetricsFromHoldings` | `src/lib/queries.ts:2099` `[VERIFIED: repo]` | The live-book column metric source (see Q4). |
| `methodologyLine(n)` / `shortestHistoryName` | `src/lib/scenario-history.ts:41` `[VERIFIED: repo]` | Per-column overlap-window + N honesty stamp. |
| `evaluateSampleFloor` / `SAMPLE_FLOOR_OVERLAPPING_DAYS=60` / body builders | `src/lib/sample-floor.ts` `[VERIFIED: repo]` | Below-floor / degenerate gate copy. |
| `CompareTable` layout + `findWinner` | `src/components/strategy/CompareTable.tsx` `[VERIFIED: repo]` | Mirror target for the compare grid. |
| `formatPercent` / `formatNumber` | `src/lib/utils.ts` (return `"—"` on null/non-finite) `[VERIFIED: repo via CompareTable import]` | Em-dash honesty for free. |
| `EmptyStateCard` | `src/components/ui/EmptyStateCard.tsx` `[VERIFIED: UI-SPEC]` | Empty-list + honest below-data states. |
| `withAllocatorAuth` / `AllocatorUser` | `src/lib/api/withAllocatorAuth.ts` `[VERIFIED: repo]` | Auth+role gate for the CRUD routes. |
| `NO_STORE_HEADERS` | `src/lib/api/headers.ts` `[VERIFIED: repo]` | `Cache-Control: private, no-store` on every response (success + error). |
| `userActionLimiter` / `checkLimit` / `isRateLimitMisconfigured` | `src/lib/ratelimit` `[VERIFIED: repo]` | Per-user rate limit on side-effecting writes (consume AFTER input validation). |
| `captureToSentry` | `src/lib/sentry-capture` `[VERIFIED: repo]` | Fail-loud server-side on unexpected errors. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Route handlers (`route.ts`) | Next.js Server Actions | Repo's allocator-owned writes are all `route.ts` handlers (`/api/allocator/scenario/commit`). Server Actions are viable for the save/rename/delete mutations and reduce a fetch round-trip, but they bypass the established `withAllocatorAuth` + `NO_STORE_HEADERS` + rate-limit + error-envelope conventions the route helpers encode. **Recommendation: route handlers** for parity with the existing allocator CRUD surface and the F5a/F5b error-hygiene work. Planner may justify a server action for the read-only list (GET) only. `[VERIFIED: repo]` |
| Per-scenario `commit_scenario_batch`-style SECURITY DEFINER RPC | Plain `supabase.from("scenarios").insert/update/delete` under RLS | The commit RPC exists because that flow needs a multi-row single transaction. Phase-23 CRUD is single-row per call, so plain RLS-bound `.from()` writes are correct and simpler — **no RPC needed**. The SQL-function snapshot/drift gate therefore should NOT trip (a plain table + policy defines no tracked function). `[VERIFIED: repo]` |
| New compare-only fetch path | Reuse `payload.strategies` / `holdingReturnsByScopeRef` already in `ScenarioComposer` props | A new fetch path duplicates the SSR-lifted live data the composer already holds and risks a second, drifting source. **Reuse the existing payload** (see Q4). `[VERIFIED: repo]` |

**Installation:** none. CONTEXT locks "No new dependencies / no Python."

**Version verification:** No registry packages are added this phase, so no `npm view` step applies. All modules above are in-repo and `[VERIFIED: repo]` by direct file read on 2026-06-21.

## Package Legitimacy Audit

> Not applicable — this phase installs **no external packages** (CONTEXT: "No new dependencies / no Python"; UI-SPEC Registry Safety: "No new npm dependency this phase"). slopcheck N/A. Every dependency is an existing in-repo module verified by file read.

## Architecture Patterns

### System Architecture Diagram

```
                          ┌──────────────────────── Scenario tab (AllocationsTabs, TabKey="scenario") ──────────────────────┐
                          │                                                                                                   │
  SAVE / UPDATE           │   ScenarioComposer ──(working draft)── useScenarioState ──(localStorage autosave, unchanged)──┐  │
  ────────────►           │        │                                      ▲                                                │  │
  "Save scenario"         │        │ toolbar gesture                      │ NEW one-shot hydrate seam (initialDraft)        │  │
  / "Update scenario"     │        ▼                                      │                                                │  │
                          │   POST/PATCH /api/allocator/scenario/saved ───┼──────────────┐                                 │  │
                          │   (withAllocatorAuth + zod(scenarioDraftSchema)+ NO_STORE)    │                                 │  │
                          └───────────────────────────────────────────────┼─────────────┼─────────────────────────────────┘  │
                                                                           │             │
                                                          user-scoped supabase.from("scenarios")            ┌──── live data ───┐
                                                                           │  (RLS: allocator_id=auth.uid)  │ payload.strategies│
                                                                           ▼                                │ holdingReturns... │
                                                                  ┌──────────────────┐                      │ liveBaselineMetrics│
   REOPEN ◄──────── GET list/draft ◄────────────────────────────►│  scenarios table │                      └─────────┬─────────┘
   "Open" → scenarioDraftCodec(draft) → ok/readonly/reset         │  (jsonb draft +  │                                │
            → hydrate seam → fingerprint vs live → banner         │  schema_version) │                                │
                                                                  └──────────────────┘                                │
                                                                                                                       ▼
   COMPARE ─── select ≥2 + "Live book" ──► for each saved draft: scenarioDraftCodec → adapter → computeScenario(live returns) ──► ComputedMetrics
            ──► live-book column: liveBaselineMetricsFromHoldings (or payload.liveBaselineMetrics) ──► CompareTable-mirrored grid
                (per-column methodologyLine(n); degenerate column → "—" via formatPercent/formatNumber)
```

The load-bearing arrows: **every saved draft's return series is re-resolved from the SAME live payload the composer already holds** (never persisted, never separately fetched), and the reopen path passes the saved draft through the **same** codec + fingerprint logic as the localStorage path.

### Recommended Project Structure

```
supabase/
├── migrations/
│   └── YYYYMMDDhhmmss_scenarios_table_and_rls.sql   # forward (table + RLS + indexes + updated_at trigger)
├── migrations/down/
│   └── YYYYMMDDhhmmss-rollback.sql                   # DROP TABLE scenarios (+ trigger/fn)
└── tests/
    └── test_scenarios_rls.sql                        # two-tenant cross-content RLS assertions (mirror test_funding_fees_rls.sql)

src/
├── lib/
│   └── database.types.ts                             # HAND-PATCH: add scenarios Row/Insert/Update (see Q1)
├── app/(dashboard)/allocations/
│   ├── hooks/useScenarioState.ts                     # ADD one-shot initialDraft / hydrate seam (see Q2)
│   ├── components/
│   │   ├── SavedScenariosList.tsx                    # NEW: list + rename + delete + selection checkboxes
│   │   ├── ScenarioCompareTable.tsx                  # NEW: mirrors CompareTable; per-column methodologyLine(n)
│   │   └── ScenarioComposer.tsx                      # ADD Save/Update toolbar control + loaded-scenario id state
│   └── lib/
│       └── scenario-compare.ts                       # NEW pure helper: draft → computeScenario over live payload (testable)
└── app/api/allocator/scenario/saved/
    ├── route.ts                                      # GET list, POST create (withAllocatorAuth)
    └── [id]/route.ts                                 # PATCH (name), PUT (update draft), DELETE  (withAllocatorAuth)
```

### Pattern 1: Allocator-owned RLS table (mirror `api_keys_owner`)

**What:** A single `FOR ALL` owner policy keyed on `allocator_id = auth.uid()`, both `USING` and `WITH CHECK`.
**When to use:** Any allocator-private table with no cross-tenant read.
**Example:**
```sql
-- Source: supabase/migrations/20260405061912_rls_policies.sql:22 (api_keys_owner)
ALTER TABLE scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY scenarios_owner ON scenarios
  FOR ALL
  USING (allocator_id = auth.uid())
  WITH CHECK (allocator_id = auth.uid());
```
**Notes for the planner:**
- `allocator_id uuid not null references profiles on delete cascade` — `profiles.id` is the auth user id (`profiles_own` is keyed `id = auth.uid()`), so `allocator_id = auth.uid()` is correct.
- Add `index scenarios(allocator_id, updated_at desc)` for the list ordering.
- Add an `updated_at` trigger (or set `updated_at = now()` in the UPDATE route). The repo has no global `set_updated_at` trigger convention asserted, so the route touching `updated_at` on UPDATE is the simplest honest path; if a trigger is added it becomes a tracked function — verify against the snapshot gate (see Q1).

### Pattern 2: Allocator-owned CRUD route (copy `/api/allocator/scenario/commit` shape)

**What:** `withAllocatorAuth` handler → read body → zod-validate → rate-limit AFTER validation → user-scoped `supabase.from(...)` → redacted error envelope + `NO_STORE_HEADERS`.
**Example (canonical skeleton, adapt verbs):**
```ts
// Source: src/app/api/allocator/scenario/commit/route.ts
export const runtime = "nodejs";
export const POST = withAllocatorAuth(async (req: NextRequest, user: AllocatorUser): Promise<NextResponse> => {
  // 1. parse body
  const parsed = SaveScenarioBodySchema.safeParse(json);
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid request body", issues: parsed.error.issues },
      { status: 400, headers: NO_STORE_HEADERS });
  // 2. rate-limit AFTER validation (B15 ordering: auth → validate → ratelimit → handler)
  const rl = await checkLimit(userActionLimiter, `scenario_save:${user.id}`);
  if (!rl.success) { /* 503 if misconfigured else 429, Retry-After */ }
  // 3. user-scoped client → RLS binds the write
  const supabase = await createClient();
  const { data, error } = await supabase.from("scenarios")
    .insert({ allocator_id: user.id, name: parsed.data.name,
              draft: parsed.data.draft, schema_version: parsed.data.draft.schema_version })
    .select("id, name, created_at, updated_at, schema_version").single();
  // 4. redact DB errors (never echo supabase error.message to the client)
  if (error) {
    console.error("scenario_save error", { user: user.id, message: error.message });
    captureToSentry(error, { tags: { area: "scenario-save" } });
    return NextResponse.json({ error: "Save failed", message: "Couldn't save this scenario. Check your connection and try again." },
      { status: 500, headers: NO_STORE_HEADERS });
  }
  return NextResponse.json(data, { status: 200, headers: NO_STORE_HEADERS });
});
```
**Load-bearing conventions (F5a/F5b error-hygiene):**
- ALWAYS `NO_STORE_HEADERS` on EVERY response (success + error) — allocator payloads must never hit a shared cache.
- NEVER echo `supabase` `error.message` to the client (it leaks schema/column names) — log + Sentry server-side, return a stable user-facing message (the UI-SPEC copy: "Couldn't save this scenario. …" / "Couldn't open this scenario. Try again.").
- The body's `allocator_id` (if a hostile client sends one) is dropped — `allocator_id: user.id` is always sourced from `withAllocatorAuth`. RLS `WITH CHECK` is defense-in-depth on top.
- 400 (validation) does NOT consume a rate-limit token.

### Pattern 3: Validate the draft on the wire AND on read

**What:** The request body's `draft` field is validated with the **same** `scenarioDraftSchema` the localStorage codec uses, so a malformed draft can never be written. On reopen, the row's `draft` JSONB runs through `scenarioDraftCodec` (NOT a bare cast).
**Why:** This is the M-0153 lesson — never `JSON.parse(raw) as ScenarioDraft`. The wire and the read both go through zod.

### Anti-Patterns to Avoid

- **Persisting the resolved/raw return series.** CONTEXT-locked: store only the draft JSONB. Series are always re-resolved from live data. A persisted series would go stale and silently misrepresent.
- **Silent recompute on reopen drift.** If the reopened draft's `init_holdings_fingerprint` ≠ current live fingerprint, the **existing** banner must show — never recompute silently. (Same invariant as #509 heatmap + Phase 21/22.)
- **Silent default to empty composer on `reset` codec outcome.** Render the honest "older format, can't be reopened" notice instead.
- **Forcing a single shared overlap window across compare columns.** Each column stamps its OWN `methodologyLine(n)`. (Common-window alignment is Phase 24.)
- **Fabricated `0` / `0.00%` / `N/A` for a degenerate column.** Use the em-dash via `formatPercent`/`formatNumber` null path.
- **Service-role client for the CRUD writes.** Use the user-scoped `createClient()` so `auth.uid()` resolves and RLS binds. Service-role bypasses RLS and would defeat the tenant gate.
- **`name` UNIQUE constraint.** CONTEXT-locked OUT (23505 timebomb). Trim + 1..120 check only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Draft validation on save/read | A custom shape check | `scenarioDraftSchema` (zod) `[VERIFIED: scenario-state.ts:499]` | The shape contract already exists; a second validator drifts. |
| Schema-version handling on reopen | A bespoke version `if` ladder | `scenarioDraftCodec` ok/readonly/reset trichotomy `[VERIFIED: scenario-state.ts:521]` | The honesty contract (readonly for future versions, reset for older) is already correct + fail-loud. |
| Holdings-drift detection on reopen | A new fingerprint scheme | `computeHoldingsFingerprint` + `fingerprintMismatch` banner `[VERIFIED: useScenarioState.ts:157]` | Identical to the working localStorage drift UX. |
| Compare metrics | Re-deriving Sharpe/CAGR/etc. | `computeScenario` → `ComputedMetrics` `[VERIFIED: scenario.ts:132]` | Frozen, test-pinned, leverage/NaN/degenerate-safe. |
| Live-book metrics | A new live-blend computation | `liveBaselineMetricsFromHoldings` `[VERIFIED: queries.ts:2099]` or `payload.liveBaselineMetrics` | Already computes the all-on equity-weighted live blend (de-aliased). |
| Winner highlight + em-dash | Custom min/max + null formatting | `findWinner` + `formatPercent`/`formatNumber` `[VERIFIED: CompareTable.tsx]` | `findWinner` skips nulls; formatters return `"—"` for free. |
| Per-column window stamp | Inline string | `methodologyLine(n)` `[VERIFIED: scenario-history.ts:41]` | Single source so the two surfaces can't drift. |
| Auth + role gate on CRUD | Inline profile-role lookup | `withAllocatorAuth` `[VERIFIED: withAllocatorAuth.ts]` | The exact pattern audit-2026-05-07 exists to retire (no per-site inlining). |

**Key insight:** Phase 23 is almost entirely *wiring existing primitives*. The risk is in the seams (reopen drift/version honesty, RLS content-assertion, compare em-dash), not in any new algorithm.

## Runtime State Inventory

> Phase 23 is a greenfield **additive** feature (new table, new routes, new components, one new hook seam) with **no rename/refactor/migration of existing runtime state**. The one persistence change is additive (new `scenarios` table). The inventory is therefore mostly N/A, recorded explicitly:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None renamed. NEW: `scenarios` table holds the `ScenarioDraft` JSONB. The existing per-allocator localStorage draft (`allocations.scenario_v0_15.{allocatorId}`) is **untouched** — the hydrate seam must NOT clobber it. | New migration only; no data migration of existing records. |
| Live service config | None — verified: no n8n/Datadog/external-service config references a "scenario" string for this feature. | None. |
| OS-registered state | None — no scheduled task / cron / pm2 process is added. Railway deploy is a no-op (CONTEXT: no analytics-service change). | None. |
| Secrets/env vars | None — verified: no new env key. The env-manifest gate (`src/__tests__/contracts/env-manifest.test.ts`, tech-debt #15) would fail if a new `process.env.*` read were introduced; do not add one. | None. |
| Build artifacts | `src/lib/database.types.ts` becomes stale the moment the `scenarios` table is added — it is `gen types`-generated but **cannot be regenerated by the executor** (no prod DB access). MUST be hand-patched (see Q1). | Hand-patch DB types + keep the `[#14]` guard comments intact. |

**The canonical question** — after every file is updated, what runtime state still has stale data? Only `database.types.ts` (hand-patch). No stored records, no OS state, no secrets.

## Common Pitfalls

### Pitfall 1: RLS leak passes tests because tests only assert policy *presence*
**What goes wrong:** A test that checks `CREATE POLICY scenarios_owner` exists, or that a single-tenant SELECT returns rows, passes even if the policy predicate is wrong — RLS fails *silently* (returns 0 rows, no error).
**Why it happens:** A loosened predicate (or a `USING (true)`) doesn't error; it just over-shares.
**How to avoid:** Mirror `supabase/tests/test_funding_fees_rls.sql` exactly — seed **two** synthetic tenants end-to-end (auth.users → profiles → scenarios), forge `request.jwt.claims` sub for each, `SET LOCAL ROLE authenticated`, and assert tenant A sees tenant A's row and **CANNOT see tenant B's row** (assert on *content* — the specific row id — not just a count). Also assert tenant A cannot UPDATE/DELETE tenant B's row.
**Warning signs:** A SQL test with no `set_config('request.jwt.claims', …)` + `SET LOCAL ROLE authenticated` block, or one that only asserts `EXISTS (SELECT 1 FROM pg_policies …)`.

### Pitfall 2: Reopen silently recomputes over drifted holdings (no banner)
**What goes wrong:** Open loads a draft built against an old holdings set; the composer recomputes the projection over the new live holdings without telling the user.
**Why it happens:** The hydrate seam sets the draft but bypasses the fingerprint-mismatch derivation.
**How to avoid:** The hydrate seam must route the DB draft through the same `value`-comparison the hook already does (`value.init_holdings_fingerprint !== fingerprint`). The mismatch is **pure derived render state** (`storedMismatch`), so as long as the hydrated draft's `init_holdings_fingerprint` flows into `value`, the banner fires automatically. Do NOT special-case the DB path.
**Warning signs:** A new "loadedFromDb" branch that bypasses `fingerprintMismatch`.

### Pitfall 3: Older/newer `schema_version` drafts loaded without the codec trichotomy
**What goes wrong:** A v1 draft (or a future v3 draft) loads as if it were current, mis-driving the projection — or an empty composer appears silently.
**Why it happens:** The DB read bypasses `scenarioDraftCodec` and casts.
**How to avoid:** Run the row's `draft` JSONB through `scenarioDraftCodec(defaultDraft).decode(JSON.stringify(draft))` (or refactor the codec to accept a parsed object). `reset` → honest "older format" notice; `readonly` → block edits. The **top-level `schema_version` column** lets the route/list cheaply branch (e.g. show a "needs newer/older version" badge) without parsing the JSONB — that is exactly why STATE.md mandates it.
**Warning signs:** `const draft = row.draft as ScenarioDraft`.

### Pitfall 4: `database.types.ts` regenerated (not hand-patched) → loses tripwire comments
**What goes wrong:** Someone runs `supabase gen types` linked to a project missing a migration; the regen strips the `[#14]` HAND-PATCHED tripwire comments and silently reverts columns.
**Why it happens:** The file *looks* auto-generated, so the instinct is to regenerate.
**How to avoid:** **Hand-add** the `scenarios` Row/Insert/Update block to `src/lib/database.types.ts`, preserving the existing GENERATED-FILE header + the `HAND-PATCHED` / `migration 115` tripwire comments (the `critical-regressions.test.ts [#14]` block asserts they survive). The `database.types.test.ts` `expectTypeOf` pattern is the template for pinning the new columns' presence + nullability.
**Warning signs:** A diff that removes any `HAND-PATCHED` comment, or a CI failure in `[#14] database.types.ts hand-patch integrity`.

### Pitfall 5: Compare forces a common window / fabricates a 0 for a short scenario
**What goes wrong:** One saved scenario has N=412 days, another N=20; the table renders them on a shared axis or shows `0.00%` for the short one's Sharpe.
**Why it happens:** A single header `methodologyLine` for the whole table + not routing nulls through the formatters.
**How to avoid:** Each column stamps its OWN `methodologyLine(scenarioMetrics.n)`. A column whose `computeScenario` returned null metrics (n<10, or NaN-poisoned) renders `"—"` via `formatPercent`/`formatNumber`. If a whole column is below `SAMPLE_FLOOR_OVERLAPPING_DAYS` (60), gate it with `evaluateSampleFloor` + `sampleFloorBody` copy (neutral, no red/amber — UI-SPEC).
**Warning signs:** A single shared "N overlapping days" header; a literal `?? 0` on a metric value.

### Pitfall 6: Hydrate seam clobbers the unsaved working draft in localStorage
**What goes wrong:** Opening a saved scenario overwrites/erases the allocator's in-progress unsaved draft.
**Why it happens:** The seam writes directly to the localStorage key on hydrate.
**How to avoid:** The seam should set the in-memory working draft (the same way `reset()` calls `removeStored(defaultDraftRef.current)` sets in-memory WITHOUT re-persisting). The next user edit persists the now-hydrated draft. CONTEXT-locked: "Open seeds the composer, then the normal autosave + fingerprint logic takes over." See Q2 for the proposed seam shape.

## Code Examples

### Re-resolve a saved draft's series + compute compare metrics (proposed pure helper)
```ts
// NEW src/app/(dashboard)/allocations/lib/scenario-compare.ts — testable, mirrors ScenarioComposer's projectionState→deAliased→computeScenario chain
// Source pattern: ScenarioComposer.tsx lines 460-630 (adapter → projectionState → collapseAliasedHoldingStrategies → buildDateMapCache → computeScenario)
import { computeScenario, buildDateMapCache, type ComputedMetrics } from "@/lib/scenario";
import { collapseAliasedHoldingStrategies } from "@/lib/scenario-dealias";
import { buildStrategyForBuilderSet } from "./scenario-adapter";
import type { ScenarioDraft } from "./scenario-state";

// Given a saved draft + the SAME live payload the composer already holds,
// rebuild the adapter strategies, overlay the draft's toggle+weight state,
// collapse aliases, and run the frozen engine. Returns null-metric ComputedMetrics
// for degenerate sets (computeScenario already does this) → caller renders "—".
export function computeMetricsForDraft(
  draft: ScenarioDraft,
  liveInputs: { holdingsSummary; addedStrategyReturnsLookup; addedStrategyMetadataLookup; holdingReturnsByScopeRef; symbolByHoldingId },
): ComputedMetrics {
  // ... build adapterOutput + projectionState from draft.toggleByScopeRef / draft.weightOverrides
  //     (NO leverage — leverage is ephemeral useState, never persisted) ...
  const deAliased = collapseAliasedHoldingStrategies(adapterStrategies, projectionState, symbolByHoldingId);
  return computeScenario(deAliased.strategies, deAliased.state, buildDateMapCache(deAliased.strategies));
}
```

### Per-column honesty stamp + em-dash (compare cell)
```tsx
// Source: methodologyLine (scenario-history.ts:41) + formatPercent/formatNumber (utils.ts) + CompareTable winner pattern
<th>{scenarioName}</th>
// ... value cell:
<span className={isWinner ? "text-accent font-bold" : "text-text-secondary"}>
  {formatPercent(m.twr)}{isWinner && " ✓"}   {/* formatPercent(null) === "—" */}
</span>
// ... per-column footer/sub-row:
<td className="text-[11px] text-text-muted">{methodologyLine(m.n)}</td>
```

## Detailed Answers to the Planner's Six Research Questions

### Q1 — Migration + DB-types workflow in THIS repo `[VERIFIED: repo + CI]`

**How migrations apply here (NOT a local `db push`):**
- Migrations are **append-only SQL files** in `supabase/migrations/` named `YYYYMMDDhhmmss_snake_case.sql` (latest applied: `20260620120000_*`). Rollbacks live in `supabase/migrations/down/` named `YYYYMMDDhhmmss-rollback.sql` (note: hyphen + `-rollback`, e.g. `20260620120000-rollback.sql`).
- They are applied to **prod at deploy time** (the `supabase-migrate.yml` apply job runs `db push --include-all`). **The executor MUST NOT push to prod.** Migrations are verified anon-NO-EXEC and apply at /land-and-deploy time (matches the Phase 19/B5 pattern in MEMORY).
- **`migration-policy.yml`** (`.github/workflows/migration-policy.yml`) is a PR-time gate: it queries the remote tip fresh via `supabase db query --linked` and **rejects any newly-added migration whose timestamp is older than the remote tip** (backdated-migration guard). → The new migration MUST carry a **forward** timestamp (later than `20260620120000` and later than the remote tip at PR time). An allowlist (`.github/migrate-backdated-allowlist.txt`) is the only exception channel; Phase 23 should NOT need it.
- **SQL-function snapshot/drift gate (tech-debt #2, PR #500):** `scripts/dump-sql-functions.ts` replays all migrations and writes each function's latest body to `supabase/schema/functions/<name>.sql`; `npm run schema:functions:check` (`--check`) fails CI if the snapshot is stale. **SCOPE = functions only** — tables, columns, policies, triggers are NOT covered. A plain `scenarios` table + an owner policy defines **no tracked function**, so this gate should NOT trip. ⚠️ **If the planner adds a `set_updated_at()` trigger function**, it becomes a tracked function → the executor MUST run `npm run schema:functions` to regenerate the snapshot and commit `supabase/schema/functions/set_updated_at.sql`. Prefer touching `updated_at = now()` in the UPDATE route to avoid the gate entirely.

**What the executor MUST do (instead of pushing):**
1. Write the forward migration: `CREATE TABLE scenarios (…)`, `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, `CREATE POLICY scenarios_owner …`, the `length(btrim(name)) between 1 and 120` CHECK, and the `(allocator_id, updated_at desc)` index.
2. Write the matching `supabase/migrations/down/<same-ts>-rollback.sql` (`DROP TABLE scenarios CASCADE;` + drop any trigger/fn it created).
3. **Hand-patch `src/lib/database.types.ts`** — add the `scenarios` `Row`/`Insert`/`Update`/`Relationships` block, preserving the GENERATED-FILE header and the `[#14]` `HAND-PATCHED` / `migration 115` tripwire comments. It is `gen types`-generated (`PostgrestVersion 14.5`) but **cannot be regenerated without prod DB access**; `critical-regressions.test.ts [#14]` asserts the tripwire comments survive, and `database.types.test.ts` is the `expectTypeOf` template to pin the new columns. The **env-manifest gate (`env-manifest.test.ts`, tech-debt #15)** is unrelated to DB types but will fail if a new `process.env.*` read is added — don't add one.
4. Write `supabase/tests/test_scenarios_rls.sql` (see Q6) — the `sql-tests` CI job auto-discovers `test_*.sql` and runs each under `psql -v ON_ERROR_STOP=1` against the test project (`qmnijlgmdhviwzwfyzlc`). The job is gated on `vars.E2E_TEST_DB_CONFIGURED` and a fork-author check; a meta-command preflight rejects `\!`/`\copy`/`\o` — write plain PL/pgSQL `DO $$ … $$` with `RAISE EXCEPTION` on failure.
5. At review: `migration-reviewer` + `rls-policy-auditor` (CONTEXT-mandated). ⚠️ Before any `CREATE OR REPLACE` of an existing function, grep ALL migrations for its name and re-base on the latest body (the B5b lesson) — N/A here unless a trigger fn is added.

### Q2 — The composer reopen/hydration seam `[VERIFIED: repo]`

**Current state:** `useScenarioState({ holdingsSummary, allocatorId })` seeds the working draft from `useCrossTabStorage` (per-allocator localStorage) via `scenarioDraftCodec`. The working draft is `storedMismatch ? defaultDraft : value`; `fingerprintMismatch` is **pure derived render state** (`value.init_holdings_fingerprint !== fingerprint`, gated on `isHydrated`); mutators rebase onto the default via `baseOf`.

**Minimal seam (recommended):** add an imperative **one-shot hydrate** to the hook's returned API:
```ts
// useScenarioState return adds:
hydrateFromSaved: (draft: ScenarioDraft) => void;
```
Implementation routes through the SAME `setValue` the mutators use:
```ts
const hydrateFromSaved = useCallback((saved: ScenarioDraft) => {
  // Set the in-memory working draft to the saved draft. The normal autosave
  // then persists it on the next edit (or immediately, via setValue's debounce),
  // and `fingerprintMismatch` derives automatically because `value` now carries
  // the saved draft's init_holdings_fingerprint — if it != current `fingerprint`,
  // the banner fires with NO special-casing (Pitfall 2).
  setValue(() => saved);
  setMismatchDismissed(false); // a freshly-opened scenario gets a fresh banner
}, [setValue]);
```
Why this is correct + minimal:
- **Reuses the fingerprint banner verbatim** — because the seam writes into `value`, `storedMismatch`/`fingerprintMismatch` recompute exactly as for a localStorage draft. No new drift code.
- **Does not break localStorage autosave of the unsaved working draft** — `setValue` is the same path the composer's edits use; it does not clear or special-case the key. (If the planner wants the unsaved draft preserved for an "undo open", that's an extra concern CONTEXT does not require; the locked behavior is "Open seeds the composer, then normal autosave takes over.")
- **The codec trichotomy is applied BEFORE calling `hydrateFromSaved`** — the route/list layer (or a small wrapper) runs the row's `draft` JSONB through `scenarioDraftCodec(defaultDraft).decode(...)`:
  - `ok` → call `hydrateFromSaved(decoded.value)`.
  - `readonly` (future `schema_version`) → call `hydrateFromSaved` but render the read-only notice + block edits (UI gate, not a hook change).
  - `reset` (older incompatible) → do NOT hydrate; render "This saved scenario uses an older format and can't be reopened." (UI-SPEC copy).

  ⚠️ The codec's `decode` takes `raw: string | null`. The simplest reuse is `decode(JSON.stringify(row.draft))`; alternatively the planner extracts the version-trichotomy into a `decodeDraftObject(obj)` helper so a parsed JSONB object can be classified without a re-stringify round-trip. Either is fine; **do not bypass the trichotomy**.

**Loaded-scenario id tracking (Save vs Update):** the composer holds a `loadedScenarioId: string | null` `useState`. `Open` sets it; `Save scenario` (id null) → POST create; `Update scenario` (id set) → PUT/PATCH that row + touch `updated_at`; `Save as new` always POSTs a new row + sets the new id. Editing after Open keeps the id (so Update targets the right row); `reset()` clears it.

### Q3 — CRUD surface (route vs server action vs RSC) `[VERIFIED: repo]`

**What this codebase uses for allocator-owned writes today:** `route.ts` **route handlers** wrapped in `withAllocatorAuth`, e.g. `src/app/api/allocator/scenario/commit/route.ts` and `src/app/api/allocator/holdings/sync/route.ts`. The directory convention is `src/app/api/allocator/<resource>/[...]/route.ts`.

**The exact pattern to copy** (from the commit route):
- `export const runtime = "nodejs";`
- `export const POST = withAllocatorAuth(async (req, user: AllocatorUser) => { … })` — `user.id` is the authenticated allocator; never trust a client-sent `allocator_id`.
- Body: read `req.text()`, `JSON.parse` in a try/catch (400 on failure), `safeParse` with a zod schema (400 + `issues` on failure).
- **Rate-limit AFTER validation** (B15 ordering): `checkLimit(userActionLimiter, "scenario_save:" + user.id)` → 503 if `isRateLimitMisconfigured`, else 429 with `Retry-After`.
- **User-scoped client**: `const supabase = await createClient();` then `supabase.from("scenarios").insert/update/delete(...)` — RLS binds.
- **Error envelope (F5a/F5b hygiene)**: on a DB error, `console.error` + `captureToSentry` server-side, return a stable redacted message (`{ error, message }`) — NEVER echo `error.message`. Map known states (e.g. the `length` CHECK violation → 400 "Scenario names are limited to 120 characters.") if you want precise client copy; otherwise a generic 500 message.
- **ALWAYS `NO_STORE_HEADERS`** on every response.

**Recommended verb layout:**
- `POST /api/allocator/scenario/saved` — create (validate `name` + `draft`).
- `GET /api/allocator/scenario/saved` — list the caller's rows (id, name, schema_version, created_at, updated_at). RLS scopes it; the route is a thin reader. *Alternatively* the list can be an RSC server fetch in the Scenario tab's page (the tab is already an authed dashboard surface) — but a GET route keeps the client-side checkbox/compare flow self-contained. **Planner's discretion; default to the GET route for symmetry with POST.**
- `PATCH /api/allocator/scenario/saved/[id]` — rename (re-validate trim/length).
- `PUT /api/allocator/scenario/saved/[id]` — update the draft + touch `updated_at` (the "Update scenario" gesture).
- `DELETE /api/allocator/scenario/saved/[id]` — delete.

Next.js 16 note: `[id]` route params are async — read them per the repo's `node_modules/next/dist/docs/` (AGENTS.md mandate) before writing the handler signature. Do not assume the training-data sync-params shape.

### Q4 — Compare compute wiring `[VERIFIED: repo]`

**Re-resolving each saved scenario's series + running the engine:** the composer's existing chain is the template (`ScenarioComposer.tsx` ~460–630): from `payload.strategies` it builds `strategyById` → `addedStrategyReturnsLookup` + `addedStrategyMetadataLookup` → `buildStrategyForBuilderSet(holdingsSummary, disabledHoldingRefs, draft.addedStrategies, holdingReturnsByScopeRef, …)` → overlays the draft's `toggleByScopeRef`/`weightOverrides` into `projectionState` → `collapseAliasedHoldingStrategies(...)` → `buildDateMapCache(...)` → `computeScenario(...)`. **Compare reuses this exact chain per saved draft**, swapping the live `scenario.draft` for each saved draft. Factor it into the pure helper `computeMetricsForDraft(draft, liveInputs)` (see Code Examples) so it's unit-testable in isolation.

**The live "strategies/holdings payload" source compare must reuse (NOT a new fetch):** `MyAllocationDashboardPayload` — specifically `payload.strategies`, `payload.holdingsSummary`, and `payload.holdingReturnsByScopeRef` — which the `ScenarioComposer` already receives as props (SSR-lifted by `getMyAllocationDashboard`, `queries.ts:2340`). The compare panel lives on the same Scenario tab and should be handed the same `payload`. No second fetch path.

**Note on leverage:** the composer's leverage (`leverageByRef`) is **ephemeral `useState`, never persisted** (ScenarioComposer.tsx:361-367). A saved draft carries no leverage, so `computeMetricsForDraft` runs with leverage = 1 for every leg. This matches the persisted-shape decision — do not try to reconstruct leverage on reopen/compare.

**How the live-book column's metrics are computed today:** two existing producers, both correct — planner picks one:
1. `liveBaselineMetricsFromHoldings(holdingsSummary, holdingReturnsByScopeRef)` (`queries.ts:2099`) — builds an all-enabled, equity-weighted live set, de-aliases, runs `computeScenario`, returns `{ aum, ytdTwr, sharpe, maxDd, avgRho, equity, drawdown }`. This is a `ComputedMetrics`-derived blend.
2. `payload.liveBaselineMetrics` (already on the payload, SSR-lifted) — the same data, pre-computed; the composer adapts it via `liveBaselineToComputedMetrics` (ScenarioComposer.tsx:256) into a `ComputedMetrics`-shaped object (with `twr`/`sharpe`/`max_drawdown`/`avg_pairwise_correlation`; `cagr`/`sortino`/`volatility` are **null** on this path because the SSR baseline doesn't carry them).
   - ⚠️ **Honesty consequence for compare:** the compare table has Cumulative Return, CAGR, Sharpe, Sortino, Max Drawdown, Volatility rows. `payload.liveBaselineMetrics` lacks CAGR/Sortino/Volatility → those live-book cells would render `"—"`. If the planner wants the live-book column to have all six metrics, use **option 1** (`liveBaselineMetricsFromHoldings`) but note it ALSO doesn't populate cagr/sortino/volatility on the payload shape — to get the full `ComputedMetrics` for the live book, call `computeScenario` directly on the live all-on set (same inputs as `liveBaselineMetricsFromHoldings` builds internally) and read all six fields. **Recommendation: compute the live-book column with the SAME `computeMetricsForDraft`-style call over a synthetic "all live holdings, equal/equity weight" draft**, so the live column and the scenario columns are produced by one engine path and all six metrics are populated honestly. An em-dash on a genuinely-degenerate live book is then honest, not an artifact of a thin baseline shape.

### Q5 — `schema_version` forward-compat `[VERIFIED: repo + STATE.md]`

**Confirmed: the table needs a top-level `schema_version int not null` column** (CONTEXT + STATE.md key risk gate: "`schema_version` must exist from the FIRST `scenarios` migration so 26/27/28 can add fields"). It is stored **in addition to** the value inside the draft JSONB. The top-level column lets the list/route branch cheaply (e.g. flag a row as "needs newer version" / "older format") **without parsing the JSONB**.

**How reopened drafts flow through the trichotomy:** on Open, the row's `draft` JSONB is decoded through `scenarioDraftCodec` (current `SCENARIO_SCHEMA_VERSION = 2`):
- `draft.schema_version === 2` → whole-shape `scenarioDraftSchema.safeParse`; success → `ok` → hydrate. Schema-invalid → `reset`.
- `draft.schema_version > 2` (future build wrote it) → `readonly` → hydrate but block edits + show "saved by a newer version, read-only here" (UI-SPEC).
- `draft.schema_version` missing / `< 2` / non-integer → `reset` → render "older format, can't be reopened"; do NOT silently default to an empty composer.

The planner must **pin honest handling** — never `?? defaultDraft` silently on a `reset`. The codec already fails loud (console.warn + Sentry breadcrumb on `reset`). The top-level column should equal `draft.schema_version` at write time; if they ever diverge that's a bug worth a `[#23]`-style guard.

### Q6 — Test seams `[VERIFIED: repo]`

- **SQL/RLS:** `supabase/tests/test_*.sql` (plain PL/pgSQL `DO $$ … $$` + `RAISE EXCEPTION`; NO pgTAP). Auto-discovered by the `sql-tests` CI job and run under `psql -v ON_ERROR_STOP=1` against the test project. **Template: `test_funding_fees_rls.sql`** — seed two tenants, forge `request.jwt.claims` sub, `SET LOCAL ROLE authenticated`, assert **cross-tenant content** (tenant A sees own row by id, CANNOT see tenant B's row by id; UPDATE/DELETE of B's row by A is rejected/zero-row). Tear down via cascade on `auth.users`. Avoid `\!`/`\copy`/`\o` (the Finding-6 preflight rejects them).
- **Route handlers (vitest):** existing examples to copy — `src/app/api/allocator/scenario/commit/route.test.ts`, `src/app/api/allocator/holdings/sync/route.test.ts`, `src/lib/api/withAllocatorAuth.test.ts`. These mock the supabase client + assert status codes, `NO_STORE_HEADERS`, redacted error messages, and the rate-limit-after-validation ordering.
- **Compose/compare math:** `src/lib/scenario.test.ts` pins `computeScenario` behaviors (do not regress). The new `scenario-compare.ts` pure helper gets its own `*.test.ts` asserting: a draft round-trips to the same metrics the composer would show; a degenerate draft (n<10) yields null metrics → "—"; heterogeneous-window drafts each report their own `n`.
- **DB types:** `src/lib/database.types.test.ts` `expectTypeOf` pattern pins the new `scenarios` Row columns' presence + nullability; `critical-regressions.test.ts [#14]` guards the hand-patch tripwire comments.
- **Patterns the planner should require for RLS content assertions:** assert on a **specific row id** being visible/invisible across tenants, plus the negative write path — never just a row count or a `pg_policies` presence check (Pitfall 1).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `JSON.parse(raw) as ScenarioDraft` | whole-shape `scenarioDraftSchema` + version trichotomy | M-0153 / B7 | Reopen MUST use the codec, not a cast. |
| Per-holding leverage/weight UI in composer | read-only-tokens model (#507, commit 06971527) | 2026 (pre-Phase-23) | Persisted draft carries no leverage; v1 drafts dropped on load via `SCENARIO_SCHEMA_VERSION=2` bump. |
| Echoing supabase `error.message` to client | redacted stable message + Sentry server-side | F5a/F5b error-hygiene | CRUD routes must redact DB errors. |
| Migration-drift checked at apply time | `migration-policy.yml` PR-time backdating gate + `dump-sql-functions.ts --check` snapshot | tech-debt #2 (PR #500) | Forward timestamp mandatory; functions snapshot must stay fresh (N/A for a plain table). |

**Deprecated/outdated:** PERSIST-01's "leverage" enumeration (stale per #507 — do not reintroduce); `loadScenarioDraft`/`saveScenarioDraft` bare-localStorage helpers (back-compat only, NOT the hook's hot path).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A plain `scenarios` table + owner policy defines NO tracked SQL function, so `dump-sql-functions.ts --check` will not trip. | Q1 | LOW — verified the gate is functions-only; an added trigger fn would change this (called out explicitly). |
| A2 | The remote schema tip at PR time is at/around `20260620120000`; a forward timestamp later than that clears `migration-policy.yml`. | Q1 | LOW — guard queries the live tip fresh; executor just needs a clearly-forward timestamp at write time. |
| A3 | `scenarioDraftCodec.decode` can be reused via `decode(JSON.stringify(row.draft))`, or trivially refactored to accept a parsed object. | Q2/Q5 | LOW — decode signature is `(raw: string | null)`; round-trip works. |
| A4 | The live-book column is best produced by one engine path over a synthetic "all live holdings" draft (so all six metrics populate), rather than `payload.liveBaselineMetrics` (which lacks cagr/sortino/volatility). | Q4 | MEDIUM — if the planner prefers the thin baseline, three live-book cells render "—". This is a UX call; flagged for the planner to confirm. |
| A5 | `database.types.ts` cannot be regenerated by the executor (no prod DB link) → hand-patch is the only path. | Q1 | LOW — the GENERATED-FILE header + `[#14]` guard explicitly document hand-patching as the live workflow. |

## Open Questions

1. **Live-book column metric completeness (A4).**
   - What we know: two existing live-metric producers; both leave cagr/sortino/volatility null on the payload shape.
   - What's unclear: whether the live-book column should show all six metrics or accept three em-dashes.
   - Recommendation: compute the live book through the same `computeScenario` path as scenarios (synthetic all-on draft) so all six populate; an em-dash then means genuine degeneracy.

2. **List N + overlap-window stamp "when cheaply available."**
   - What we know: CONTEXT says show N + window "when cheaply available without a full recompute."
   - What's unclear: there is no cheap N without running `computeScenario` (N is the engine's overlap count). The persisted draft does not store N.
   - Recommendation: either omit the per-row N in the list (show only timestamps) and surface N only in the compare table (where the engine runs anyway), OR lazily compute it for visible rows. Default: omit in list, stamp in compare. Flag for discuss-phase if the list N is desired.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase Postgres (prod) | migration apply | ✓ (applied at /land-and-deploy, NOT by executor) | — | — |
| Test Supabase project `qmnijlgmdhviwzwfyzlc` | `sql-tests` CI RLS test | ✓ (gated on `vars.E2E_TEST_DB_CONFIGURED`) | — | If unset, sql-tests no-ops — RLS test still committed for when configured. |
| `psql` client | `sql-tests` CI job | ✓ (CI installs `postgresql-client`) | — | — |
| Node/Next.js toolchain (vitest, tsc, eslint) | route + math tests | ✓ | repo-pinned | — |
| Python / analytics-service | — | N/A | — | No Python this phase (CONTEXT); Railway deploy is a no-op. |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** the test DB secret (`TEST_SUPABASE_DB_URL`) may be unset on forks — the RLS test then no-ops in CI but is still committed and runs on the internal pipeline.

## Validation Architecture

> `workflow.nyquist_validation` not explicitly false → section included. This phase has four hard testable invariants: persistence correctness, RLS tenant-isolation, reopen-drift/version honesty, and compare-degenerate em-dash.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (TS unit/route) + plain PL/pgSQL `DO $$` blocks under `psql` (SQL/RLS) |
| Config file | `vitest.config.ts` (coverage thresholds: lines 82 / stmts 80 / fns 74 / branches 72) |
| Quick run command | `npx vitest run src/app/(dashboard)/allocations src/app/api/allocator/scenario` |
| Full suite command | `npm test` (vitest) + `sql-tests` CI job (`psql -v ON_ERROR_STOP=1 -f supabase/tests/test_*.sql`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PERSIST-01 | Save validates draft (zod) + writes RLS-scoped row; name 1..120 trim | route (vitest) | `npx vitest run src/app/api/allocator/scenario/saved/route.test.ts` | ❌ Wave 0 |
| PERSIST-01 | Cross-tenant: A cannot read/update/delete B's scenario (assert by id) | SQL/RLS | `psql … -f supabase/tests/test_scenarios_rls.sql` | ❌ Wave 0 |
| PERSIST-01 | DB types expose `scenarios` Row/Insert + nullability | type (vitest) | `npx vitest run src/lib/database.types.test.ts` | ⚠️ extend existing |
| PERSIST-02 | Reopen `ok` draft hydrates; drifted fingerprint → banner; `reset` → honest notice (no empty composer); `readonly` → block edits | hook/component (vitest) | `npx vitest run src/app/(dashboard)/allocations/hooks/useScenarioState` | ❌ Wave 0 |
| PERSIST-03 | List/rename/delete RLS-scoped; rename re-validates length | route (vitest) | `npx vitest run src/app/api/allocator/scenario/saved/[id]/route.test.ts` | ❌ Wave 0 |
| PERSIST-04 | Each draft → `computeScenario` over live payload; per-column N; degenerate → "—"; Sharpe-leader/winner highlight | math+component (vitest) | `npx vitest run src/app/(dashboard)/allocations/lib/scenario-compare.test.ts` | ❌ Wave 0 |
| PERSIST-04 | `computeScenario` behaviors not regressed | math (vitest) | `npx vitest run src/lib/scenario.test.ts` | ✅ (do not regress) |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched test file(s)>` (< 30s).
- **Per wave merge:** `npm test` (full vitest) + `npm run typecheck` + `npm run lint`.
- **Phase gate:** full suite green + `sql-tests` green (where the test DB is configured) before `/gsd:verify-work`. Coverage is a blocking CI gate (`frontend-coverage`).

### Wave 0 Gaps
- [ ] `supabase/tests/test_scenarios_rls.sql` — cross-tenant content RLS (covers PERSIST-01 isolation).
- [ ] `src/app/api/allocator/scenario/saved/route.test.ts` + `[id]/route.test.ts` — CRUD route conventions (covers PERSIST-01/03).
- [ ] `src/app/(dashboard)/allocations/lib/scenario-compare.ts` + `.test.ts` — pure draft→metrics helper (covers PERSIST-04 math).
- [ ] Hydration-seam test in/near `useScenarioState` — covers PERSIST-02 drift/version honesty.
- [ ] Extend `src/lib/database.types.test.ts` with `scenarios` `expectTypeOf` pins.
- [ ] No framework install needed — vitest + psql already wired.

## Security Domain

> `security_enforcement` not explicitly false → included.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `withAllocatorAuth` (composes `withAuth`) on every CRUD route. |
| V3 Session Management | no | Handled upstream by Supabase auth/middleware; no new session surface. |
| V4 Access Control | **yes (load-bearing)** | RLS owner policy `allocator_id = auth.uid()` (USING + WITH CHECK) + server-side `allocator_id = user.id` from `withAllocatorAuth` (never client-supplied) + the two-tenant content RLS test. |
| V5 Input Validation | yes | `scenarioDraftSchema` on the draft + a zod body schema (name trim/length, id uuid). 400 on failure, before rate-limit. |
| V6 Cryptography | no | No secrets/crypto introduced. |
| (caching) | yes | `NO_STORE_HEADERS` on every response (allocator payloads must never hit a shared cache). |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant read/write of another allocator's scenario | Information Disclosure / Tampering | RLS owner policy (USING + WITH CHECK) + server `allocator_id = user.id` + content RLS test (RLS fails silently → assert by row id). |
| Client forges `allocator_id` in body to write to another tenant | Spoofing / Tampering | Body `allocator_id` ignored; always `user.id`; `WITH CHECK` defense-in-depth. |
| Malformed/oversized draft JSONB poisons later reads | Tampering / DoS | `scenarioDraftSchema` on the wire; `scenarioDraftCodec` on read (never a bare cast); reasonable JSONB size bound on the body. |
| DB error message leaks schema/column names | Information Disclosure | Redact: log+Sentry server-side, return stable user-facing message (F5a/F5b). |
| Write-flood from a single allocator | DoS | `userActionLimiter` per `user.id` (consume after validation). |
| `name` injection into UI | (XSS) | React escapes by default; name is plain text, length-bounded; no `dangerouslySetInnerHTML`. |

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **This is NOT training-data Next.js (AGENTS.md):** read `node_modules/next/dist/docs/` before writing any route/cache/server-action/async-params code. Heed deprecation notices.
- **DESIGN.md governs all visual/UI decisions** — the UI-SPEC already pins every token (reuse-not-redesign). No new icons, no shadcn (`components.json` absent).
- **Coverage is a blocking CI gate** (lines 82 / stmts 80 / fns 74 / branches 72). New code must carry tests or it lowers coverage and fails CI.
- **Surgical changes / match conventions (Rules 3, 11):** copy the established RLS, route, hook, and CompareTable patterns; do not refactor adjacent code.
- **Fail loud (Rule 12):** redact DB errors to the client but Sentry + console.error server-side; never silently swallow a reopen `reset` or an RLS-empty result.
- **Tests verify intent (Rule 9):** the RLS test must assert cross-tenant *content* (by row id), not policy presence; the reopen test must fail if drift/version honesty regresses.
- **Always feature-branch + /ship → PR → /land-and-deploy** (migration applies at land time, anon NO-EXEC verified). Executor does NOT push migrations to prod.
- **Version bump both `VERSION` and `package.json`** in the same commit (critical-regressions test).
- **`.planning` is gitignored** — this RESEARCH.md is written but the commit step is a no-op.

## Sources

### Primary (HIGH confidence — direct file read 2026-06-21)
- `src/app/(dashboard)/allocations/lib/scenario-state.ts` — `ScenarioDraft`, `SCENARIO_SCHEMA_VERSION=2`, `scenarioDraftSchema`, `scenarioDraftCodec` trichotomy.
- `src/app/(dashboard)/allocations/hooks/useScenarioState.ts` — fingerprint-mismatch derived state, `baseOf`, `reset`/`removeStored`, codec wiring.
- `src/lib/scenario.ts` — `computeScenario`, `ComputedMetrics`, degenerate/NaN null path, `buildDateMapCache`.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — adapter→projectionState→deAliased→computeScenario chain; `liveBaselineToComputedMetrics`; ephemeral leverage.
- `src/lib/queries.ts:2099` — `liveBaselineMetricsFromHoldings`; `:2340` `getMyAllocationDashboard`; `:1750` `liveBaselineMetrics` payload shape.
- `src/components/strategy/CompareTable.tsx` — metric-rows × columns layout + `findWinner` + `formatValue` "—".
- `src/lib/scenario-history.ts` — `methodologyLine`, `shortestHistoryName`. `src/lib/sample-floor.ts` — `evaluateSampleFloor`, `SAMPLE_FLOOR_OVERLAPPING_DAYS=60`, body builders.
- `src/app/api/allocator/scenario/commit/route.ts` — `withAllocatorAuth`, zod body, rate-limit-after-validation, redacted error envelope, `NO_STORE_HEADERS`.
- `src/lib/api/withAllocatorAuth.ts`, `src/lib/api/headers.ts` — auth/role gate + no-store headers.
- `supabase/migrations/20260405061912_rls_policies.sql:22` — `api_keys_owner` RLS pattern.
- `supabase/tests/test_funding_fees_rls.sql` — two-tenant cross-content RLS test template.
- `scripts/dump-sql-functions.ts` — SQL-function snapshot/drift gate (tech-debt #2). `package.json` scripts `schema:functions[:check]`.
- `.github/workflows/ci.yml` (`sql-tests` job lines 598-743) — psql discovery + ON_ERROR_STOP + meta-command preflight.
- `.github/workflows/migration-policy.yml` — backdated-migration PR gate.
- `src/lib/database.types.ts` header + `src/lib/database.types.test.ts` + `src/__tests__/critical-regressions.test.ts [#14]` — hand-patch workflow + tripwire.
- `src/__tests__/contracts/env-manifest.test.ts` — env-manifest gate (tech-debt #15).

### Secondary (MEDIUM)
- MEMORY.md (project memory) — #507 read-only-holdings refactor (commit 06971527), B5b CREATE-OR-REPLACE re-base lesson, migration-applies-at-land-time pattern, .planning gitignored.

### Tertiary (LOW)
- None — no WebSearch needed; the phase is entirely in-repo wiring.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every module verified by direct file read; no external packages.
- Architecture (RLS / route / hydrate seam / compare wiring): HIGH — all four patterns copied from in-repo canonical examples.
- Pitfalls: HIGH — derived from the codec/fingerprint code, the RLS-fails-silently test template, the `[#14]` guard, and the #509/Phase-21-22 honesty lineage.
- Live-book column completeness (A4) + list-N (Open Q2): MEDIUM — UX calls flagged for the planner.

**Research date:** 2026-06-21
**Valid until:** ~2026-07-21 (stable in-repo patterns; revisit if `database.types.ts` regen workflow or the migration gates change).

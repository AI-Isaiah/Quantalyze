# Phase 42: Peer-cohort override & mandate - Research

**Researched:** 2026-06-26
**Domain:** Secure cross-tenant aggregated read (Supabase RLS / SECURITY DEFINER) + additive discriminated-union carve-out (TypeScript) + numerical-convention reconciliation (sample vs population stdev) + Next.js authed route handler.
**Confidence:** HIGH (every claim grounded in a read file:line; the convention reconciliation is pinned to verified quantstats source + the golden-fixture test).

> **ADR-0025 is the authoritative decision.** This research is downstream of it. Nothing here re-opens a locked decision — it specifies *how* to implement what the ADR + 42-CONTEXT already decided.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**The peer carve-out & gate (PEER-01/02):**
- **USER REFRAMING (foundational):** the peer rank is NOT an api-special computation. api → daily returns → metrics → rank; csv already has daily returns → same; the blend derives blended daily returns → SAME path. The only reason `peerPercentile` was "api-only" is the historical DEMO cohort (`peer-cohort.ts`, seed=42), NOT a computation barrier. The blend's peer rank is a LEGITIMATE same-path computation: reuse `computePeerPercentile` fed the blend's daily-returns-derived Sharpe/Sortino/maxDD, ranked against the REAL cohort. `scenarioPeer` is merely the SCOPED PLUMBING to surface it without unlocking the 3 genuinely-api panels.
- **Field:** add optional `scenarioPeer?: PeerPercentilePayload` to `FactsheetCsvPayload` (additive; api arm + `peerPercentile` + `ingestSource` untouched). Blend-scoped (NOT moved to `FactsheetCommon`).
- **Gate (MetricsColumn):** `ingestSource==="api" OR (scenarioMode && payload.scenarioPeer != null)` — activates the Phase-40 inert `scenarioMode` seam; the api path is provably unchanged when scenarioMode=false.
- **Invariant test (PEER-01):** REPLACE the audit-c20 BEHAVIORAL pin ("csv arm → peer panel never renders") with: a csv+scenarioPeer payload renders the peer panel BUT `peerPercentile`/`allocatorPortfolios`/`eventSignatures`/`benchEventSignatures` stay STRUCTURALLY ABSENT and `ingestSource` stays `"csv"`. KEEP the type-field invariant (the 4 api-only fields never on csv).
- **Sample floor (PEER-02):** `n < 252` → peer suppressed (reuse the factsheet low-sample floor); the rank is reload-stable; on-panel disclosure.

**The cohort (server fetch + security) — ALL ACCEPTED:**
- Cohort = the verified/published-strategy universe via an AGGREGATED read built on the `getPercentiles()` pattern. A minimal SECURITY DEFINER RPC ONLY if the `strategy_verifications` join forces a cross-tenant read RLS can't do safely. "Verified" = a `strategy_verifications.trust_tier` present (any tier).
- **Min-N ~20** (PEER-03): below it, suppress with an honest empty state. (`getPercentiles`' existing floor of 5 is too thin for ranking a hypothetical.)
- **No identity leak (security-critical):** the server returns ONLY the aggregated percentile distribution (or the blend's already-computed rank) — NO per-strategy id / name / returns / PII / mandate. The blend's rank is computed against the distribution server-side. Min-N also prevents cell-size inference.
- **Plumbing:** `withAuth` + `assertProfileApproved` + `checkLimit` (rate-limit) + `NO_STORE_HEADERS` (the preferences-route pattern). RLS test (HAS_LIVE_DB).

**Ranking convention, mandate chips, own-book delta — ALL ACCEPTED:**
- **⛔ Convention reconciliation (correctness-critical):** the cohort's stored `strategy_analytics` metrics are computed by the PYTHON analytics-service with SAMPLE stdev (`std(ddof=1)`) × √252. The blend's Phase-39 `strategyMetrics` use `compute.ts` POPULATION stdev. To rank apples-to-apples, the blend's RANKING Sharpe/Sortino/maxDD MUST be computed on the cohort's SAMPLE/252 basis — NOT the population headline. Disclosure states the basis. NEVER a silent cross-convention rank.
- **Mandate chips (PEER-04):** per-constituent chips from GENUINELY-AVAILABLE fields — `leverage_range`, `strategy_types`, `markets`, `description`. Honest-empty per constituent when absent. NO fabricated AGGREGATE single-strategy mandate.
- **Own-book delta (PEER-05):** the blend's core ratios MINUS the allocator's live book's ratios (from `allocator_equity_snapshots`, computed on the SAME basis as the blend's ranking metrics), shown as a DELTA — not a percentile.
- **Disclosure (PEER-02):** "hypothetical blend · ranked vs verified strategies" + cohort size N + the n<252 suppression note.

### Claude's Discretion
- The exact route path/method shape (POST-rank-server-side vs GET-distribution); RECOMMENDATION below.
- Whether a SECURITY DEFINER RPC is required vs reusing the `getPercentiles` query pattern; RECOMMENDATION below (RPC IS required).
- The chip component choice (reuse vs new read-only chip); RECOMMENDATION below.
- The min-N exact value (CONTEXT says ~20); RECOMMENDATION: 20, named constant.

### Deferred Ideas (OUT OF SCOPE)
- Peer/percentile on the per-key or Overview surfaces — out-of-scope (blend only).
- Toggle fold + guards + the Phase-40/41 UI-review carry-forwards → Phase 43.
- Promoting `peerPercentile` / `scenarioPeer` to `FactsheetCommon` → future milestone.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PEER-01 | Surface the peer rank on the blend via additive `scenarioPeer` on the csv arm + MetricsColumn gate; never flip `ingestSource`. | §"Type + Gate + Panel" — exact additive change at `types.ts:436-438`, gate at `MetricsColumn.tsx:121`, audit-c20 replacement. |
| PEER-02 | n<252 suppression + reload-stable rank + on-panel disclosure (basis + cohort N + hypothetical). | §"Type + Gate + Panel" (panel read), §"Convention Reconciliation" (reload-stability is a pure function of inputs). |
| PEER-03 | Cohort = real verified-strategy universe via aggregated, RLS-respecting, identity-stripped server read; min-N≈20 suppress. | §"Server-Fetch Design" + §"The Cohort Query" — SECURITY DEFINER RPC `get_verified_cohort_rank`, min-N gate, identity-strip. |
| PEER-04 | Per-constituent mandate chips from genuinely-available fields; honest-empty; no fabricated aggregate. | §"Mandate Chips" — `StrategyForBuilder` fields, read-only chip recommendation. |
| PEER-05 | Own-book head-to-head delta (blend ratios − own-book ratios) on the SAME sample basis; shown as a delta. | §"Own-Book Delta" — `payload.liveBaselineMetrics` / `allocator_equity_snapshots`, sample-basis recompute. |
</phase_requirements>

---

## Summary

This phase surfaces a Peer-Percentile panel on the Scenario composer's hypothetical blend — ranked against the platform's **real verified-strategy universe**, not the seed=42 demo cohort. ADR-0025 fixes the mechanism: an *additive* optional `scenarioPeer?: PeerPercentilePayload` on the `FactsheetCsvPayload` arm plus one gate clause in `MetricsColumn`, **never** an `ingestSource` flip (which would unlock 3 genuinely-synthetic panels). The discriminated-union backstop and the real factsheet/Overview byte-identity are preserved.

Three findings dominate the implementation:

1. **A SECURITY DEFINER RPC is required** (not a reuse of `getPercentiles()`). `getPercentiles` ranks *published* strategies, not *verified* ones, and the verified universe requires a `strategy_verifications` join. That table's RLS (migration 093) grants a normal authed allocator SELECT only on **their own** strategies' verification rows — a cross-tenant aggregate read is impossible under the tenant boundary. The safe construction is a `SET search_path`, `REVOKE PUBLIC`, `auth.role()`-gated SECURITY DEFINER function that returns *only* the aggregated distribution (or the computed rank), suppressed below min-N=20, with zero per-strategy identity.

2. **The convention reconciliation is already solved by existing code.** The cohort's `strategy_analytics` sharpe/sortino/max_drawdown are written by `compute_all_metrics` via `qs.stats.sharpe/sortino` — verified to use **sample std (ddof=1) × √252** (quantstats source + the golden-fixture test). The blend's `compute.ts` `strategyMetrics` use **population** stdev — wrong basis. But `scenario.ts` (the engine) *already* computes the blend's `sharpe`/`sortino`/`max_drawdown` on the **sample (ddof=1) × √252** basis — and the composer already holds that result as `scenarioMetrics`. The ranking metrics must come from `scenarioMetrics` (sample basis), NOT `payload.strategyMetrics` (population basis). I verified the Sortino denominator matches quantstats too (both divide downside-RMS by total n).

3. **The own-book ratios are already client-side** via `props.payload` (`MyAllocationDashboardPayload`) — but in population/custom basis. PEER-05's delta should recompute own-book Sharpe/Sortino on the sample basis from the own-book daily returns the composer already has, so the delta is basis-consistent with the blend's ranking metrics.

**Primary recommendation:** Build a `POST /api/scenario/peer-rank` route (RECOMMENDED flow (a) — client posts the blend's 3 sample-basis ranking metrics + N; the server computes the rank against the cohort distribution and returns *only* 3 percentiles + cohort N; the distribution never leaves the server). Back it with a `get_verified_cohort_rank` SECURITY DEFINER RPC. Plumb the returned `PeerPercentilePayload` into `scenarioPeer` on the synth csv payload. Gate `MetricsColumn` on `scenarioMode && payload.scenarioPeer != null`. Compute the blend's ranking metrics from `scenario.ts`'s sample-basis output, not `compute.ts`. Mandate chips reuse the constituent `StrategyForBuilder` fields via a new read-only chip. Own-book delta recomputes own-book ratios on the sample basis.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cohort distribution + verified join | Database (SECURITY DEFINER RPC) | — | `strategy_verifications` RLS forbids cross-tenant reads from an authed client; the verified universe is a privileged aggregate. Min-N + identity-strip enforced in SQL so the boundary can't be bypassed by a different caller. |
| Rank computation (blend metrics vs cohort) | API / Backend (route handler) | Database (RPC returns distribution OR rank) | Keeps the cohort distribution on the server (RECOMMENDED flow (a)). The route owns auth/approval/rate-limit/no-store. |
| Blend ranking metrics (sample-basis Sharpe/Sortino/maxDD) | Browser / Client (`scenario.ts` engine, already computed) | — | The engine already produces `scenarioMetrics` on the sample basis client-side; no recompute needed for the blend. |
| `scenarioPeer` plumbing onto the synth payload | Browser / Client (composer) | — | The synth `FactsheetCsvPayload` is built client-side; the fetched rank is attached there. |
| Render gate + panel | Browser / Client (MetricsColumn / BatchDPanels) | — | Pure presentational gate on the discriminated union. |
| Mandate chips | Browser / Client (composer) | — | Constituent `StrategyForBuilder` fields are already in `deAliased.strategies`. |
| Own-book ratios + delta | Browser / Client (composer) | — | `props.payload` already carries the own-book series/metrics; recompute on sample basis client-side. |

---

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **AGENTS.md:** "This is NOT the Next.js you know" — read `node_modules/next/dist/docs/` before writing route-handler code. Heed deprecation notices. (Relevant: route handler signature, `NextRequest`/`NextResponse`, async params.)
- **Migrations:** timestamp-named (`YYYYMMDDHHMMSS_descriptive.sql`); SECURITY DEFINER with `SET search_path = public, pg_catalog`, `REVOKE ALL … FROM PUBLIC, anon`, explicit `GRANT EXECUTE TO authenticated`, an `auth.role()`/`auth.uid()` guard, and a self-verifying `DO $$ … $$` block (mirror migration 093). Apply to the linked TEST project via `mcp__supabase__apply_migration`; prod auto via Supabase Migrate at /ship.
- **Coverage gate (BLOCKING CI):** lines 82 / statements 80 / functions 74 / branches 72 (`vitest.config.ts`). New code must not drop coverage below the ratchet — write the tests in the same PR.
- **DESIGN.md:** read before any visual decision (the peer panel + chips are UI). "data density > card density"; no card chrome between sub-panels; hairline dividers. The factsheet's existing `PercentileBar`/section styling is the reference.
- **No clients yet → decide autonomously** on prod-risk/migration-safety; destructive ops fine; soak gates can be short. (From MEMORY: `feedback_no_clients_take_decisions`.) The verified universe will often be `< min-N` in prod → the panel honestly suppresses. Acceptable + expected.
- **.planning is gitignored** — ship CODE only; never `git add` `.planning`.
- **Adversarial review = fresh Claude subagent** (no Grok, no Codex) per MEMORY directives.

---

## Standard Stack

No new external packages. Everything is in-repo. This phase touches:

### Core (existing, reused)
| Module | file:line | Purpose | Why reused |
|--------|-----------|---------|------------|
| `computePeerPercentile` / `percentileRank` | `src/lib/factsheet/peer-cohort.ts:99-114` | Rank a value against a cohort distribution. | ADR §3 mandates reuse — same rank math, real distribution swapped in. NOTE: `getPeerCohort()` (the seed=42 demo) is the part being *replaced*, not `percentileRank`. |
| `PeerPercentilePayload` | `src/lib/factsheet/types.ts:171-176` | `{cohortSize, sharpe, sortino, max_dd}` — the panel's data shape. | `scenarioPeer` carries exactly this shape (ADR §1). |
| `PeerPercentilePanel` | `src/app/factsheet/[id]/v2/BatchDPanels.tsx:78-107` | Renders the 3 percentile bars + cohort N + badge + disclosure. | Parameterize the badge ("Demo cohort" → real-cohort + hypothetical disclosure) and add a `scenarioPeer` read path. |
| `ScenarioResult` / `ComputedMetrics` (sample-basis sharpe/sortino/max_drawdown) | `src/lib/scenario.ts:341-388`, type `:58`, `:ComputedMetrics` | The blend's ranking metrics on the **sample (ddof=1) × √252** basis. | This IS the cohort-matching basis (see §"Convention Reconciliation"). Already computed as `scenarioMetrics` in the composer (`ScenarioComposer.tsx:1512`). |
| `getPercentiles` | `src/lib/queries.ts:113-191` | The aggregated, identity-stripped cross-tenant read *pattern*. | The PATTERN to mirror (aggregate, no per-strategy identity leaves). Not directly reusable — it ranks *published*, floor=5, no verified join. |
| `buildScenarioFactsheetPayload` | `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts:401-487` | Builds the synth `FactsheetCsvPayload`. | Add `scenarioPeer` to the returned object (optional arg). |
| Route plumbing | `src/lib/api/withAuth.ts:32`, `src/lib/api/approval-gate.ts:29`, `src/lib/ratelimit.ts:278` (`checkLimit`), `src/lib/api/headers.ts:13` (`NO_STORE_HEADERS`), `src/lib/csrf.ts` (`assertSameOrigin`) | Auth + approval + rate-limit + no-store + CSRF. | The exact preferences-route pattern. |
| `MandateChipGroup` | `src/components/mandate/MandateChipGroup.tsx:24` | Existing chip group. | **Not directly reusable** — it's an interactive `role=checkbox` multi-select. Mandate chips here are READ-ONLY display → see §"Mandate Chips" for the recommendation. |
| `Badge` | `src/components/ui/Badge.tsx` | Generic badge. | Candidate for the read-only mandate chips + the hypothetical-cohort badge. |

### Supporting (existing test infra)
| Module | file | Purpose |
|--------|------|---------|
| `@/lib/test-helpers/live-db` | exports `HAS_LIVE_DB`, `LIVE_DB_URL`, `LIVE_DB_SERVICE_ROLE_KEY`, `createLiveAdminClient`, `createTestUser`, `cleanupLiveDbRow`, `advertiseLiveDbSkipReason` | The HAS_LIVE_DB RLS-test gate. Model: `src/__tests__/strategy-verifications-rls.test.ts`. |
| `src/app/api/preferences/route.test.ts` | The route-handler test model (auth gate, rate-limit, no-store, structured errors). | Model for the new `/api/scenario/peer-rank` route test. |

**Installation:** none. `npm` registry not touched.

## Package Legitimacy Audit

> Not applicable — this phase installs **zero** external packages. All work uses in-repo modules + the existing Supabase/Next.js/Vitest stack. No `npm install`, no `pip install`, no new dependency. slopcheck/registry verification is moot.

---

## Architecture Patterns

### System Architecture Diagram (data flow)

```
[Composer (client)]                                    [Server]                          [Database]
deAliased.strategies ──┐
deAliased.state        │
        │              ▼
        │   scenario.ts computeScenario()
        │   → scenarioMetrics: ComputedMetrics
        │     { sharpe, sortino, max_drawdown    ← SAMPLE (ddof=1)×√252 basis
        │       on the LEVERED blend daily returns }
        │              │
        │              │  n = scenarioMetrics.n
        │              ▼
        │   n >= 252 ? ──no──► scenarioPeer = null (panel suppressed, disclosure)
        │       │ yes
        │       ▼
        │   POST /api/scenario/peer-rank ───────────► withAuth + assertProfileApproved
        │   body: { sharpe, sortino, maxDD, n }       + checkLimit + CSRF + NO_STORE
        │                                                     │
        │                                                     ▼
        │                                            supabase.rpc('get_verified_cohort_rank',
        │                                              { p_sharpe, p_sortino, p_max_dd })
        │                                                     │ SECURITY DEFINER
        │                                                     ▼
        │                                            ┌──────────────────────────────────┐
        │                                            │ strategies ⋈ strategy_analytics  │
        │                                            │ ⋈ strategy_verifications          │
        │                                            │   WHERE trust_tier IS NOT NULL    │
        │                                            │   AND status='published'          │
        │                                            │ cohort_n := count(*)              │
        │                                            │ IF cohort_n < 20 → RETURN NULL    │  ◄ min-N gate
        │                                            │ ELSE percentile_rank of each      │
        │                                            │   metric vs cohort                │
        │                                            │ RETURN (cohort_n, sh%, so%, dd%)  │  ◄ NO identity
        │                                            └──────────────────────────────────┘
        │                                                     │
        │   ◄──── { cohortSize, sharpe, sortino, max_dd } OR { cohortSize: null } ──────┘
        │       │  (the cohort DISTRIBUTION never crosses this boundary)
        ▼       ▼
buildScenarioFactsheetPayload({ ..., scenarioPeer })
   → FactsheetCsvPayload { ingestSource:'csv', scenarioPeer }
        │
        ▼
ScenarioFactsheetChart / MetricsColumn(scenarioMode=true)
   gate: scenarioMode && payload.scenarioPeer != null → <PeerPercentilePanel/>
```

**Key boundary property:** in the RECOMMENDED flow (a), the cohort *distribution* (the list of per-strategy metric values) NEVER reaches the client. The client posts 3 scalars + N; the server returns 3 percentiles + 1 count. Cross-tenant leakage is structurally impossible because the only data that crosses the network boundary is the rank of the *caller's own* hypothetical against an aggregate.

### Pattern 1: Server-side rank, distribution stays in SQL (RECOMMENDED — flow (a))

**What:** The RPC computes the percentile rank *inside Postgres* using `percentile_rank`-equivalent SQL over the cohort, returns 4 scalars `(cohort_n, sharpe_pct, sortino_pct, max_dd_pct)`. The route returns `{ cohortSize, sharpe, sortino, max_dd }` matching `PeerPercentilePayload`.

**When to use:** Always, here. ADR §3 says "The server returns only the aggregated distribution / the computed rank — never per-strategy identity, returns, or PII." Returning the rank (not the distribution) is strictly safer.

**Why not flow (b) (GET distribution, rank client-side):** Even an aggregated distribution histogram of size 20-50 is a weaker boundary — a determined caller could probe metric buckets to infer cohort composition, and the min-N cell-size argument is harder to defend when the raw distribution is on the wire. Flow (a) returns 3 percentiles, which leak nothing about any individual strategy. **Recommend flow (a).**

**Reload-stability (PEER-02):** The rank is a deterministic pure function of `(blend sharpe/sortino/maxDD, cohort snapshot)`. Same inputs → same output. `scenarioMetrics` is `useMemo`'d on `[deAliased, dateMapCache]`, so it doesn't churn; the cohort is a DB snapshot. No PRNG, no `Date.now()`. (Contrast the demo cohort, which was reload-stable only because of a fixed PRNG seed.)

### Pattern 2: SECURITY DEFINER aggregate read (mirror migration 093)

**What:** A `SECURITY DEFINER` function with `SET search_path = public, pg_catalog`, `REVOKE ALL FROM PUBLIC, anon`, `GRANT EXECUTE TO authenticated`, an `auth.role()` guard, and a self-verifying `DO` block.

**Example (skeleton — the planner writes the final SQL):**
```sql
-- Source: pattern from supabase/migrations/20260501055202_strategy_verifications.sql:185-271
CREATE OR REPLACE FUNCTION public.get_verified_cohort_rank(
  p_sharpe   DOUBLE PRECISION,
  p_sortino  DOUBLE PRECISION,
  p_max_dd   DOUBLE PRECISION  -- magnitude convention TBD — see Pitfall 2
)
RETURNS TABLE (cohort_n INT, sharpe_pct INT, sortino_pct INT, max_dd_pct INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_n INT;
BEGIN
  -- Caller must be an authenticated (non-anon) session. The route layer
  -- (withAuth + assertProfileApproved) is the primary gate; this is
  -- defence-in-depth so the DEFINER fn can't be abused by anon.
  IF auth.role() = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'get_verified_cohort_rank requires an authenticated session'
      USING ERRCODE = '42501';
  END IF;

  -- Cohort = published strategies WITH a verification trust_tier (any tier).
  SELECT count(*) INTO v_n
  FROM strategies s
  JOIN strategy_analytics a ON a.strategy_id = s.id
  WHERE s.status = 'published'
    AND EXISTS (SELECT 1 FROM strategy_verifications v
                WHERE v.strategy_id = s.id AND v.trust_tier IS NOT NULL);

  -- Min-N floor — below it, return a single all-NULL row (honest empty).
  -- Prevents cell-size inference: with < 20 strategies, a percentile would
  -- pin a near-individual rank.
  IF v_n < 20 THEN
    RETURN QUERY SELECT v_n, NULL::INT, NULL::INT, NULL::INT;
    RETURN;
  END IF;

  -- Percentile rank: % of cohort whose value is <= the blend's. Higher=better
  -- for sharpe/sortino; for max_dd use the magnitude inversion (Pitfall 2).
  -- NB: aggregate-only. No strategy id / name / returns ever selected.
  RETURN QUERY
  SELECT
    v_n,
    round(100.0 * count(*) FILTER (WHERE a.sharpe        <= p_sharpe)  / v_n)::INT,
    round(100.0 * count(*) FILTER (WHERE a.sortino       <= p_sortino) / v_n)::INT,
    round(100.0 * count(*) FILTER (WHERE abs(a.max_drawdown) >= p_max_dd) / v_n)::INT  -- shallower=better
  FROM strategies s
  JOIN strategy_analytics a ON a.strategy_id = s.id
  WHERE s.status = 'published'
    AND EXISTS (SELECT 1 FROM strategy_verifications v
                WHERE v.strategy_id = s.id AND v.trust_tier IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.get_verified_cohort_rank(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_verified_cohort_rank(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_verified_cohort_rank(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO service_role;
-- + self-verifying DO block (mirror migration 093 STEP 7): fn registered,
--   SECURITY DEFINER, search_path set, EXECUTE revoked from PUBLIC/anon.
```
`[ASSUMED]` — the exact column names (`strategy_analytics.sharpe`/`sortino`/`max_drawdown`), the `strategies.status='published'` predicate, and the max_dd magnitude convention need verification against the live schema before the planner finalizes the SQL. The `getPercentiles` query (`queries.ts:113-129`) confirms `strategy_analytics` has `sharpe, sortino, max_drawdown` columns and that `withPublishedOnly` is the published predicate — but the planner should run `list_tables` / read `withPublishedOnly` to pin the exact published filter.

### Anti-Patterns to Avoid
- **Flipping `ingestSource` to `"api"`** — unlocks `allocatorPortfolios`/`eventSignatures`/`benchEventSignatures` (ADR Alternatives, explicit Out-of-Scope). The csv arm + additive field is the ONLY sanctioned path.
- **Ranking population-basis Sharpe against a sample-basis cohort** — biases the rank high (population stdev < sample stdev → bigger Sharpe → inflated percentile). Use `scenarioMetrics` (sample basis), not `payload.strategyMetrics` (population basis).
- **Returning the cohort distribution to the client** — use flow (a) (return the rank).
- **Reading the cohort from a normal authed client with a `strategy_verifications` join** — RLS returns only the caller's own rows → a silently-tiny, wrong cohort. MUST be a SECURITY DEFINER RPC.
- **Reusing `MandateChipGroup` for read-only chips** — it's an interactive `role=checkbox` multi-select; rendering it read-only would ship misleading a11y semantics. Use a plain read-only chip (see §"Mandate Chips").
- **Promoting `scenarioPeer` to `FactsheetCommon`** — out-of-scope; would re-derive peer on every csv strategy + Overview. Blend-only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Percentile rank math | A new `percentileRank` | `percentileRank` / `computePeerPercentile` (`peer-cohort.ts:99-114`) OR the SQL `count FILTER` (flow a) | Already correct + tested; the SQL form keeps the distribution server-side. |
| Sample-basis blend Sharpe/Sortino | A new sample-std metric for the blend | `scenario.ts:341-371` `ComputedMetrics` (already sample-basis) | Already computed, already in the composer as `scenarioMetrics`, already matches the cohort basis. |
| Auth/approval/rate-limit/no-store/CSRF on the route | Hand-rolled checks | the preferences-route inline pattern OR `withAuth` wrapper | One canonical, audited pattern; misconfigured-limiter fails closed (503). |
| Cross-tenant aggregate read | A client-side join | SECURITY DEFINER RPC (migration 093 pattern) | RLS forbids the join from an authed client; the DEFINER fn is the only safe aggregate path. |
| The synth payload | A new payload builder | `buildScenarioFactsheetPayload` + an optional `scenarioPeer` arg | Parity-by-construction; keeps every factsheet test byte-identical. |
| Read-only mandate chip | A bespoke styled span per field | a small read-only chip component (or `Badge`) | DESIGN.md compliance + one styling source. |

**Key insight:** Almost everything this phase needs already exists. The genuinely *new* code is: one SECURITY DEFINER RPC + migration, one route handler, one optional payload field + gate clause, one panel read-path, one read-only chip, one own-book delta computation. The risk is not "build complex things" — it's "wire the RIGHT basis + the RIGHT security boundary."

## ⛔ Convention Reconciliation (correctness-critical)

**Verified facts:**

1. **Cohort basis = sample (ddof=1) × √252.** `strategy_analytics` sharpe/sortino/max_drawdown are written by `compute_all_metrics` (`analytics-service/services/metrics.py:352`), which computes them via `qs.stats.sharpe(returns, periods=252)` (`:461`), `qs.stats.sortino(returns, rf=MAR, periods=252)` (`:466`), `qs.stats.volatility(...)` (`:460`). I read the quantstats source:
   - **Sharpe** (`quantstats/stats.py:841`): `divisor = returns.std(ddof=1)` — **sample std**, annualized `× √periods`.
   - **Sortino** (`quantstats/stats.py:982`): `downside = np.sqrt((returns[returns<0]**2).sum() / len(returns))` — downside RMS divided by **total n**, annualized `× √periods`.
   This is corroborated by `analytics-service/tests/test_mt5_golden_fixtures.py:381` which hand-derives `sample std (ddof=1)` and asserts `qs.stats.volatility / sharpe` match it exactly. `[VERIFIED: quantstats source + golden-fixture test]`

2. **The factsheet headline basis = population.** `src/lib/factsheet/compute.ts:24` uses `pstdev(rets)` (population), `:33` Sharpe `= (m·252)/(s·√252)` with population `s`, `:36` Sortino downside-RMS `/n` (population). So `payload.strategyMetrics` (and the Phase-39 synth payload's `strategyMetrics`, which calls `compute()` at `scenario-factsheet-payload.ts:348`) are **population basis — the WRONG basis for ranking.** `[VERIFIED: compute.ts source]`

3. **The blend ALREADY has a sample-basis metric set.** `src/lib/scenario.ts:341-388` (`computeScenario` → `ComputedMetrics`):
   - **Sharpe** (`:347-351`): `variance = Σ(r−mean)²/(n−1)` (sample ddof=1), `vol = √variance·√252`, `sharpe = mean·252/vol`. **Matches quantstats Sharpe exactly.** `[VERIFIED]`
   - **Sortino** (`:364-371`): `downsideSumSq = Σ(r<0 ? r² : 0)`, `downsideVar = downsideSumSq/n` (÷ total n), `downsideVol = √downsideVar·√252`, `sortino = mean·252/downsideVol`. **Matches quantstats Sortino exactly** (both divide by total n, both annualize the full ratio). `[VERIFIED]`
   - **max_drawdown** (`:373-388`): peak-to-trough on the cumulative blend curve — a unit-free ratio, **basis-invariant** (no stdev involved), so it matches `strategy_analytics.max_drawdown` (both quantstats `to_drawdown_series` and this loop measure the same fraction). `[VERIFIED — basis-invariant]`

**Conclusion (the locked answer to MUST-ANSWER #3):**
> The blend's RANKING Sharpe/Sortino/maxDD MUST come from `scenario.ts`'s `ComputedMetrics` (the composer's `scenarioMetrics`), NOT from `compute.ts`/`payload.strategyMetrics`. No NEW sample-basis computation is needed — `scenario.ts` already produces exactly the cohort's quantstats basis. This is the apples-to-apples comparison ADR §4 requires.

**Pin it with a test (REQUIRED):** a golden test that feeds a fixed returns blend through BOTH `scenario.ts` (sample) and a quantstats reference value, asserting `scenarioMetrics.sharpe` / `.sortino` equal the quantstats `qs.stats.sharpe/sortino` (within float tolerance) on the same series. The existing golden-fixture arithmetic (`test_mt5_golden_fixtures.py:370-388`) provides reference numbers (e.g. `sharpe = 31.148...` for that fixture). A TS-side pin asserting `scenario.ts` reproduces a known sample-basis Sharpe protects against a future drift in either convention. This is the test ADR §"Negative/risks" calls for ("the ranking-basis choice is pinned by a test").

**Subtle landmine (flag for the planner):** quantstats Sharpe subtracts `rf` (default 0) and Sortino uses `rf=MAR` (the analytics service passes `MAR`, `metrics.py:466`). `scenario.ts` uses `rf=0` for both (`scenario.ts:345` comment). **If `MAR ≠ 0`, the blend's Sortino and the cohort's Sortino diverge by the MAR offset.** The planner MUST verify the value of `MAR` (grep `analytics-service/services/metrics.py` for `MAR =`). If `MAR == 0`, the bases match perfectly. If `MAR != 0`, the blend's Sortino computation needs the same MAR — note this as a verification gate. `[ASSUMED: MAR == 0 — VERIFY]`

---

## Type + Gate + Panel (PEER-01/02)

### The additive type change (`src/lib/factsheet/types.ts:436-438`)
```ts
export type FactsheetCsvPayload = FactsheetCommon & {
  ingestSource: "csv";
  /** Phase 42 (PEER-01) — blend-only peer rank vs the REAL verified universe,
   *  on the cohort's sample/252 basis. Optional + additive: absent on every
   *  existing csv call site (real factsheet route, Discovery, Overview) so the
   *  api path + the 3 synthetic-panel absences are provably unchanged. The 4
   *  api-only fields stay structurally absent on this arm (type-field invariant).*/
  scenarioPeer?: PeerPercentilePayload;
};
```
This is purely additive: `FactsheetApiPayload` (`:420-430`), `peerPercentile` (`:423`), and `ingestSource` are untouched. Because `scenarioPeer` is `?`-optional, **every existing call site that constructs a csv payload remains valid and byte-identical** — `buildScenarioFactsheetPayload` (Phase 39) and `build-payload.ts:278` (`return { ...common, ingestSource: "csv" }`) simply don't set it. `[VERIFIED: types.ts + build-payload.ts]`

### The gate (`src/app/factsheet/[id]/v2/MetricsColumn.tsx:116-122`)
Current (`:121`): `{payload.ingestSource === "api" && <PeerPercentilePanel />}`. The `scenarioMode` prop is already threaded inert at `:19-24` (`void scenarioMode`). The Phase-42 change:
```tsx
// Drop the `void scenarioMode;` no-op at :24. Replace the gate at :121:
{(payload.ingestSource === "api" ||
  (scenarioMode && payload.ingestSource === "csv" && payload.scenarioPeer != null)) && (
  <PeerPercentilePanel />
)}
```
Note the explicit `payload.ingestSource === "csv"` narrow before reading `payload.scenarioPeer` — `scenarioPeer` lives only on the csv arm, so the union must be narrowed for the field access to type-check (mirrors the existing B6 narrowing discipline at `BatchDPanels.tsx:84,130`). With `scenarioMode === false` (every existing call site — the real route, Discovery, Overview, per `MetricsColumn.tsx:19` default + ADR §2), the second disjunct is dead and the api path is provably unchanged. `[VERIFIED: MetricsColumn.tsx]`

### The panel read path (`src/app/factsheet/[id]/v2/BatchDPanels.tsx:78-107`)
`PeerPercentilePanel` currently hard-narrows `if (payload.ingestSource !== "api") return null;` (`:84`) then reads `payload.peerPercentile`. Phase 42 must let it read EITHER source:
```tsx
export function PeerPercentilePanel() {
  const payload = usePayload();
  // Read the api cohort OR the scenario carve-out (whichever arm is active).
  const p = payload.ingestSource === "api"
    ? payload.peerPercentile
    : payload.scenarioPeer ?? null;   // csv arm — scenarioPeer is the carve-out
  if (!p) return null;
  const isScenario = payload.ingestSource === "csv";
  // …badge: isScenario ? "Hypothetical · vs verified strategies" : "Demo cohort"
  // …disclosure: isScenario
  //   ? "Hypothetical blend ranked vs the platform's verified strategies
  //      (sample/252 basis). N = cohort size; suppressed below N=20 or <252 obs."
  //   : <existing demo disclosure>
}
```
The `DemoBadge` (`BatchDPanels.tsx:214`) becomes a parameterized badge (real-cohort label vs demo label). `[VERIFIED: BatchDPanels.tsx]`

### The audit-c20 test replacement (`src/lib/factsheet/audit-c20.test.ts:364-411`)
- **KEEP** `SYNTH_FIELDS = [peerPercentile, allocatorPortfolios, eventSignatures, benchEventSignatures]` (`:364-369`) and the type-level B6 block (`:422+`). The type-field invariant (4 api-only fields never on csv) is PRESERVED — `scenarioPeer` is a DIFFERENT field name, so the absence assertion still holds.
- **ADD/REPLACE** a behavioral case: a csv payload WITH `scenarioPeer` set renders the peer panel (under `scenarioMode=true`) while `ingestSource` stays `"csv"` and the 4 `SYNTH_FIELDS` stay structurally absent (`f in payload === false`). Exact shape:
```ts
it("csv + scenarioPeer: peer renders, 3 synth panels absent, ingestSource stays csv", () => {
  const payload = buildScenarioFactsheetPayload({
    portfolioDaily: makeReturns(),
    scenarioPeer: { cohortSize: 42, sharpe: 70, sortino: 65, max_dd: 55 },
  });
  expect(payload.ingestSource).toBe("csv");
  expect(payload.scenarioPeer).not.toBeNull();          // carve-out present
  for (const f of SYNTH_FIELDS) {
    expect(f in payload).toBe(false);                    // 4 api-only fields still absent
  }
  // render assertion: MetricsColumn(scenarioMode=true) mounts <PeerPercentilePanel/>
  // and the panel shows N=42 + the hypothetical disclosure (render test, see below).
});
```
This requires `buildScenarioFactsheetPayload` to accept an optional `scenarioPeer` arg (the additive plumbing). `[VERIFIED: audit-c20.test.ts structure]`

---

## Server-Fetch Design (security-critical — MUST-ANSWER #1)

**Recommendation: flow (a) — POST blend metrics, server computes + returns the rank.**

| Aspect | Spec |
|--------|------|
| Route | `POST /api/scenario/peer-rank` (new: `src/app/api/scenario/peer-rank/route.ts`) |
| Method | `POST` — carries the blend's 3 metrics in the body (not URL-loggable; CSRF-checked). A GET would put metrics in the URL (logged) and can't cleanly carry the triple. |
| Auth | `withAuth(handler)` (`src/lib/api/withAuth.ts:32`) — gives `auth.getUser()` 401 + `assertProfileApproved` (default `requireApproval:true`) + CSRF (`assertSameOrigin` on POST). OR the inline preferences-route pattern. Recommend `withAuth` for brevity (POST gets CSRF automatically). |
| Rate-limit | `checkLimit(<a 60/min sliding limiter>, \`scenario-peer:${user.id}\`)` with `isRateLimitMisconfigured → 503`. Reuse `preferencesReadLimiter` (60/60s, `ratelimit.ts:166`) or add a `scenarioPeerLimiter`. A 429 must carry `Retry-After` (preferences pattern). |
| No-store | `NO_STORE_HEADERS` (`src/lib/api/headers.ts:13`) on EVERY response (200/401/429/503/500) — the rank is per-request, never cacheable. |
| Request body | `{ sharpe: number, sortino: number, maxDD: number, n: number }`. Validate: all finite numbers; reject non-object/non-finite with a structured 400 (preferences `:107-115` pattern). `n` is the blend's observation count (for the n<252 belt-and-suspenders; the panel already suppresses client-side). |
| Response (200) | `{ peer: PeerPercentilePayload }` i.e. `{ peer: { cohortSize, sharpe, sortino, max_dd } }` OR `{ peer: null }` when `cohort_n < 20`. NOTHING else. |
| Caller | The composer, after `scenarioMetrics` resolves and `scenarioMetrics.n >= 252`. `useEffect`/`useMemo`-keyed on the 3 metrics; set `scenarioPeer` state; pass to `buildScenarioFactsheetPayload`. Client suppresses fetch entirely when `n < 252` (no point ranking a thin blend). |

**Cohort-never-leaves-the-server confirmation (flow a):** the route's only DB call is `supabase.rpc('get_verified_cohort_rank', { p_sharpe, p_sortino, p_max_dd })` which returns `(cohort_n, sharpe_pct, sortino_pct, max_dd_pct)` — 4 scalars. The per-strategy metric values, ids, names, returns are SELECTed only inside the DEFINER function's body and never escape it. The response is 3 percentiles + 1 count. **The cohort distribution is structurally unreachable from the client.** `[VERIFIED: by construction — the route returns the RPC's scalar tuple verbatim]`

**Client-side suppression order (defence-in-depth):** (1) client skips the fetch when `n < 252`; (2) the RPC returns NULL when `cohort_n < 20`; (3) the panel renders nothing when `scenarioPeer == null`. Three independent suppressions; any one alone is sufficient.

## The Cohort Query — reuse `getPercentiles` vs new RPC (MUST-ANSWER #2)

**A new SECURITY DEFINER RPC is REQUIRED. `getPercentiles()` cannot serve.** Three reasons, each independently disqualifying:

1. **Wrong universe.** `getPercentiles` ranks *published* strategies (`withPublishedOnly`, `queries.ts:113-129`) with NO verification filter. The cohort must be *verified* (a `strategy_verifications.trust_tier`, any tier — 42-CONTEXT). That's an added join.

2. **RLS forbids the verified join from an authed client.** `strategy_verifications` RLS (migration 093, `:118-141`): `strategy_verifications_owner_select` grants SELECT only `WHERE strategy_id IN (SELECT id FROM strategies WHERE user_id = auth.uid())` — i.e. an allocator sees ONLY their own strategies' verification rows. A normal-client join would silently return a 1-row (or 0-row) "cohort" — wrong AND a confidentiality non-issue only because it returns nothing useful. To read the verified universe aggregate, the read MUST run under elevated privilege → SECURITY DEFINER. `[VERIFIED: migration 093:118-141]`

3. **Wrong floor.** `getPercentiles` floors at 5 (`queries.ts:142,152`). The phase needs ≥20 (PEER-03) — too thin a set makes a hypothetical's rank near-deterministic per individual.

**The RPC spec** (see Pattern 2 above for the SQL skeleton):
- **Query:** verified+published strategies' `sharpe`/`sortino`/`max_drawdown` from `strategy_analytics`, joined to `strategy_verifications` via `EXISTS (… trust_tier IS NOT NULL)`.
- **Min-N gate:** `IF count(*) < 20 → RETURN a NULL-rank row`. Named constant; document the 20 = cell-size floor.
- **Identity strip:** the function SELECTs only aggregates (`count`, `count FILTER`); it NEVER returns id/name/returns. The `RETURNS TABLE` is `(cohort_n INT, sharpe_pct INT, sortino_pct INT, max_dd_pct INT)` — provably PII-free.
- **Hardening:** `SET search_path = public, pg_catalog`; `REVOKE ALL FROM PUBLIC, anon`; `GRANT EXECUTE TO authenticated, service_role`; `auth.role()='anon'` / `auth.uid() IS NULL` → `RAISE EXCEPTION 42501`; self-verifying `DO` block (fn registered + DEFINER + search_path + REVOKE). Timestamp-named migration per AGENTS.md, applied to TEST project via `mcp__supabase__apply_migration`.

**Cross-tenant leak surface + how min-N prevents inference:**
- *Surface:* a new aggregate read over OTHER allocators' verified strategies. *Mitigation:* aggregate-only (`count FILTER`), no row identity, gated by auth+approval+rate-limit+no-store, RPC-internal min-N.
- *Cell-size inference:* with `cohort_n < 20`, a percentile maps to a small, near-individual rank (e.g. with n=3, the percentile reveals "you beat exactly 2 of the 3 verified strategies" — a near-identification). Min-N=20 means each percentile point spans ≥0.2 strategies, so no single strategy's metric is recoverable from the returned rank. `[VERIFIED: cell-size argument; ASSUMED: 20 is sufficient — standard k-anonymity-style floor, reasonable for this surface]`

**max_dd magnitude convention (Pitfall 2 — flag):** `getPercentiles` notes `strategy_analytics.max_drawdown` is stored NEGATIVE (`-0.30 = 30% drop`, `queries.ts:162-168`) and takes `Math.abs` before the LOWER_IS_BETTER inversion. `scenario.ts` `max_drawdown` is also negative (`scenario.ts:385`, `dd = cumulative[i]/peak − 1 ≤ 0`). The RPC must compare on a consistent magnitude convention — "shallower drawdown = better = higher percentile." The skeleton uses `abs(a.max_drawdown) >= p_max_dd` with `p_max_dd = abs(blend max_dd)`. The planner must verify the sign passed from the client matches what the SQL expects. `[VERIFIED: both stored negative; the comparison direction needs a pin test]`

---

## Mandate Chips (PEER-04)

**Available per-constituent fields** — from `StrategyForBuilder` (`src/lib/scenario.ts:58-71`):
```ts
export interface StrategyForBuilder {
  id, name, codename,
  disclosure_tier: string,
  strategy_types: string[],   // ← PEER-04 chip source
  markets: string[],          // ← PEER-04 chip source
  start_date: string | null,
  daily_returns, cagr, sharpe, volatility, max_drawdown,
}
```
The composer already holds these as `deAliased.strategies` (`ScenarioComposer.tsx:1498-1512`), and already reads `s.markets` / `s.strategy_types` elsewhere (`:1914-1915`). **So `strategy_types` + `markets` are directly available per constituent, client-side, no fetch.** `[VERIFIED: scenario.ts:58-71 + ScenarioComposer.tsx:1914]`

**`leverage_range` + `description` are NOT on `StrategyForBuilder`.** They live on `FactsheetCommon` (`types.ts:337,344`: `description`, `leverageRange`) — i.e. the factsheet payload, not the scenario builder type. 42-CONTEXT lists them as candidate fields, but the composer's constituent objects don't carry them. **Recommendation:** the v1 chips use `strategy_types` + `markets` (genuinely available client-side). `leverage_range`/`description` would require threading new fields onto `StrategyForBuilder` and the adapter (`scenario-adapter.ts`) — flag this as an effort tradeoff; the honest-minimal v1 is types+markets. Per-constituent leverage IS available via `deAliased.state.leverage[id]` (`scenario.ts:ScenarioState.leverage`) if a leverage chip is wanted. `[VERIFIED: types.ts:337,344 vs scenario.ts:58-71]`

**Honest-empty per constituent:** when a constituent's `strategy_types` and `markets` are both `[]`, render an explicit "No mandate metadata" state for THAT constituent — never borrow another constituent's tags, never fabricate an aggregate (42-CONTEXT: "NO fabricated AGGREGATE single-strategy mandate").

**Chip component:** do NOT reuse `MandateChipGroup` (`src/components/mandate/MandateChipGroup.tsx:24`) — it's an interactive `role="checkbox" aria-checked` multi-select (`:59-60`); shipping it read-only would assert false a11y affordances. **Recommendation:** a small read-only chip — either `src/components/ui/Badge.tsx` (generic) styled per DESIGN.md, or a tiny presentational `<span className="rounded-md border px-2 py-0.5 text-xs …">` matching the factsheet's existing tag styling. Read DESIGN.md before choosing. `[VERIFIED: MandateChipGroup is interactive]`

## Own-Book Delta (PEER-05)

**Where the own-book data comes from:** the composer receives `props.payload: MyAllocationDashboardPayload` (`ScenarioComposer.tsx:268`) + `allocatorId` (`:269`). That payload is built by `getMyAllocationDashboard` (`queries.ts:2590`), which reads `allocator_equity_snapshots` (`:2691-2701`, own-tenant via owner-RLS + an `auth.uid()===userId` backstop) and derives daily returns (`queries.ts:2064-2073`). The composer also has `props.payload.liveBaselineMetrics` (custom-named `sharpe`/`maxDd` — `ScenarioComposer.tsx:305-318` M4 adapter) and `baselineEquityDailyPoints` (`:531`). **So the own-book series + a baseline metric set are ALREADY client-side via props — no server fetch needed for PEER-05.** `[VERIFIED: ScenarioComposer.tsx:268,305,531 + queries.ts:2590]`

**The basis problem:** `liveBaselineMetrics.sharpe`/`maxDd` come from a different pipeline (population or the Python store) and may not be on the sample basis the blend's ranking metrics use. **For the delta to be apples-to-apples (PEER-05 requires "the SAME basis as the blend's ranking metrics"), recompute the own-book Sharpe/Sortino/max_drawdown from the own-book daily returns** (`baselineEquityDailyPoints` → returns) using the SAME sample-basis computation `scenario.ts` uses — i.e. feed the own-book daily returns through `computeScenario`-equivalent sample-basis math, OR extract the sample-basis Sharpe/Sortino helper from `scenario.ts:341-371` into a shared pure function and call it on both the blend and the own-book series. **Recommendation:** extract a tiny `sampleBasisRatios(dailyReturns): { sharpe, sortino, max_drawdown }` pure helper (the exact `scenario.ts:346-388` math), use it for the own-book leg, and have the blend leg keep using `scenarioMetrics` (which already calls that math). This guarantees both legs share one code path → the delta is honest by construction. `[VERIFIED basis requirement; the extraction is the clean implementation]`

**The delta presentation:** `blendSharpe − ownSharpe`, `blendSortino − ownSortino`, `blendMaxDD − ownMaxDD` — rendered as signed deltas (not percentiles). The EOY-returns `Δ` column (`MetricsColumn.tsx:569-574`) is the styling precedent (signed, color by sign). Honest-empty when the own-book has no equity history (fresh allocator → no `allocator_equity_snapshots` → no own-book leg → show "No live book to compare against yet").

**If the own-book data were NOT client-side** (it is, here): the same `/api/scenario/peer-rank` route could return an own-book ratio block. Not needed — keep PEER-05 client-side.

---

## Runtime State Inventory

> N/A — this is an additive feature phase, not a rename/refactor/migration. No stored string is renamed; no live-service config, OS-registered state, secrets, or build artifacts carry a string this phase changes. The new `get_verified_cohort_rank` RPC + migration is net-new schema, not a rename. **None — verified by the additive nature of every change (optional field, new gate clause, new route, new RPC).**

## Common Pitfalls

### Pitfall 1: Ranking the population-basis headline against the sample-basis cohort
**What goes wrong:** the rank is biased HIGH (population stdev < sample stdev → Sharpe inflated → percentile inflated).
**Why:** `payload.strategyMetrics` (and the synth payload's) come from `compute.ts` (population). The cohort is quantstats (sample).
**How to avoid:** feed the rank from `scenarioMetrics` (`scenario.ts`, sample basis), NEVER `payload.strategyMetrics`. Pin with the convention test.
**Warning sign:** the blend ranks suspiciously high vs intuition; a 50th-percentile blend shows 60th+.

### Pitfall 2: max_dd sign/magnitude convention mismatch in the RPC
**What goes wrong:** comparing a negative blend max_dd against negative stored values with the wrong operator ranks the DEEPEST drawdown as best (the `getPercentiles` `Math.abs` comment, `queries.ts:162-168`).
**How to avoid:** compare on magnitude (`abs`), "shallower = higher percentile"; pin the direction with a test where a known-shallow blend ranks above a known-deep cohort.

### Pitfall 3: Reading `scenarioPeer` off the bare union without narrowing
**What goes wrong:** `payload.scenarioPeer` is a compile error on the api arm (it's a csv-only field) → tsc fails.
**How to avoid:** narrow `payload.ingestSource === "csv"` before the field access (mirror the B6 narrowing discipline, `BatchDPanels.tsx:84`).

### Pitfall 4: The cohort distribution crossing the network boundary
**What goes wrong:** flow (b) puts the aggregated distribution on the wire — a weaker confidentiality posture.
**How to avoid:** flow (a) — the RPC returns the RANK; the distribution stays in SQL.

### Pitfall 5: Min-N suppression tested only at the happy path
**What goes wrong:** in prod (no clients) the cohort is `< 20` constantly; if the empty path is untested, a NULL-rank row could crash the panel.
**How to avoid:** test `cohort_n < 20 → { peer: null } → panel renders nothing` explicitly. This is the COMMON prod path, not an edge case.

### Pitfall 6: MAR ≠ 0 desyncing Sortino
**What goes wrong:** the cohort's Sortino uses `rf=MAR` (`metrics.py:466`); `scenario.ts` uses `rf=0`. If `MAR != 0`, the Sortino ranks are on different rf bases.
**How to avoid:** verify `MAR` value; if non-zero, thread the same MAR into the blend's Sortino or document the rf-mismatch caveat. `[ASSUMED MAR==0 — VERIFY]`

---

## Security

### Threat model

| Threat | STRIDE | Vector | Mitigation |
|--------|--------|--------|------------|
| **Cross-tenant cohort leak** | Information disclosure | A caller reads OTHER allocators' verified-strategy metrics/identities. | Flow (a): the RPC returns 3 percentiles + 1 count, never row identity/returns/PII. Aggregate-only SELECT inside a DEFINER fn. `withAuth`+approval+rate-limit+no-store on the route. |
| **RLS bypass via the DEFINER fn** | Elevation of privilege | The SECURITY DEFINER fn runs as owner; if callable by anon or abusable, it bypasses `strategy_verifications` RLS. | `REVOKE ALL FROM PUBLIC, anon`; `GRANT EXECUTE TO authenticated` only; in-fn `auth.role()='anon'`/`auth.uid() IS NULL → 42501`; `SET search_path` (prevents search-path hijack). The fn returns ONLY aggregates, so even if reached it leaks nothing per-strategy. |
| **Cell-size inference** | Information disclosure | With a tiny cohort, a percentile near-identifies an individual strategy's metric. | Min-N=20 floor inside the RPC → NULL-rank below it. |
| **`ingestSource` flip** | Tampering (of the data contract) | Flipping the blend to `"api"` unlocks 3 fabricated synthetic panels. | The carve-out is an ADDITIVE csv-only field; `ingestSource` stays `"csv"`. The type-field invariant test + the B6 discriminated union enforce the 4 api-only fields stay absent. |
| **Convention bias** | (integrity / honesty) | Ranking population-basis Sharpe against sample-basis cohort inflates the rank — a dishonest "better than peers" claim. | Rank from `scenarioMetrics` (sample basis); pin with the convention test; disclose the basis on-panel. |
| **CSRF on the POST** | Tampering | Cross-site forced rank requests. | `withAuth` applies `assertSameOrigin` on POST (`withAuth.ts:52-55`). |
| **Egress amplification** | DoS | An authed allocator scripts unbounded rank calls. | `checkLimit` rate-limit (60/min), `Retry-After` on 429, fail-closed 503 on misconfigured limiter. |

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `withAuth` → `supabase.auth.getUser()` 401; `auth.uid()` guard in the RPC. |
| V3 Session Management | yes | Supabase session cookie; no new session surface. |
| V4 Access Control | yes (CRITICAL) | RLS on `strategy_verifications` (owner/admin/service); the DEFINER fn is the ONLY sanctioned cross-tenant aggregate path; `assertProfileApproved`; min-N. |
| V5 Input Validation | yes | Body validation: finite numbers only; non-object/non-finite → structured 400 (preferences pattern). |
| V6 Cryptography | no | No crypto in this phase. |
| V7 Error Handling & Logging | yes | Structured errors (no raw DB messages forwarded — preferences `:261-276` precedent); `captureToSentry` on RPC error; `NO_STORE_HEADERS` on every response. |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Live Supabase TEST project (`qmnijlgmdhviwzwfyzlc`) | RLS test + `apply_migration` | ✓ (per MEMORY + migration 093 history) | — | RLS test skips via `advertiseLiveDbSkipReason` when `NEXT_PUBLIC_SUPABASE_URL`+`SUPABASE_SERVICE_ROLE_KEY` absent. |
| `mcp__supabase__apply_migration` | Apply the new RPC migration to TEST | ✓ (MCP server connected) | — | Manual SQL apply. |
| quantstats (analytics `.venv`) | Convention verification (research only) | ✓ (`analytics-service/.venv/.../quantstats/stats.py`) | installed | — (research-time only; not a runtime dep of the TS feature). |
| Vitest + `@/lib/test-helpers/live-db` | All tests | ✓ | per `vitest.config.ts` | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** the RLS test gracefully skips without live-DB creds (standard CI) — its assertions run only in the live-DB lane.

---

## Validation Architecture

> nyquist_validation is enabled (`config.json: workflow.nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (TS) + pytest (analytics, for the convention reference only) |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run <path> -x` |
| Full suite command | `npm run test:coverage` (BLOCKING CI gate — lines 82/stmts 80/fns 74/branches 72) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PEER-01 | csv+scenarioPeer renders peer; 4 synth fields absent; ingestSource stays csv | unit | `npx vitest run src/lib/factsheet/audit-c20.test.ts -x` | ✅ (replace the block at :364-411) |
| PEER-01 | type-field invariant (4 api-only fields never on csv) preserved | type | `npm run typecheck` (B6 block at audit-c20.test.ts:422+) | ✅ |
| PEER-01/02 | MetricsColumn gate: scenarioMode && scenarioPeer→panel; scenarioMode=false→api unchanged | unit/render | `npx vitest run src/app/factsheet/[id]/v2/MetricsColumn.test.tsx -x` | ❌ Wave 0 (or extend existing) |
| PEER-02 | n<252 → scenarioPeer suppressed; reload-stable rank; disclosure renders | render | `npx vitest run src/app/factsheet/[id]/v2/BatchDPanels.test.tsx -x` | ❌ Wave 0 |
| PEER-03 (convention) | blend sample-basis Sharpe/Sortino == quantstats reference on a golden series | unit | `npx vitest run src/lib/scenario.peer-basis.test.ts -x` | ❌ Wave 0 (the pin test) |
| PEER-03 (RLS) | cohort read does not leak cross-tenant; owner sees only own verification rows; service sees all | integration (HAS_LIVE_DB) | `npx vitest run src/__tests__/verified-cohort-rank-rls.test.ts -x` | ❌ Wave 0 (model: strategy-verifications-rls.test.ts) |
| PEER-03 (RPC) | min-N: cohort_n<20 → NULL rank; ≥20 → ranks; no identity columns in result | integration (HAS_LIVE_DB) | same file as above | ❌ Wave 0 |
| PEER-03 (route) | POST auth gate (401/approval), rate-limit (429+Retry-After/503), no-store, body validation (400), 200 returns `{peer}` only | unit | `npx vitest run src/app/api/scenario/peer-rank/route.test.ts -x` | ❌ Wave 0 (model: api/preferences/route.test.ts) |
| PEER-04 | mandate chips render strategy_types+markets per constituent; honest-empty when both []; no aggregate fabrication | render | `npx vitest run src/app/(dashboard)/allocations/components/<MandateChips>.test.tsx -x` | ❌ Wave 0 |
| PEER-05 | own-book delta = blend ratios − own ratios on SAME sample basis; signed delta; honest-empty with no live book | unit/render | `npx vitest run src/app/(dashboard)/allocations/components/<OwnBookDelta>.test.tsx -x` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the relevant `npx vitest run <file> -x` (sub-30s).
- **Per wave merge:** `npm run test:coverage` (full suite, the blocking ratchet).
- **Phase gate:** full suite green + coverage ratchet held before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/__tests__/verified-cohort-rank-rls.test.ts` — RLS anti-leak + min-N + no-identity (HAS_LIVE_DB; model: `strategy-verifications-rls.test.ts`). Covers PEER-03.
- [ ] `src/app/api/scenario/peer-rank/route.test.ts` — auth/rate-limit/no-store/validation/shape (model: `api/preferences/route.test.ts`). Covers PEER-03.
- [ ] `src/lib/scenario.peer-basis.test.ts` — the convention pin (sample-basis Sharpe/Sortino == quantstats reference). Covers PEER-03.
- [ ] Extend `src/lib/factsheet/audit-c20.test.ts` — the carve-out behavioral case + keep the type-field invariant. Covers PEER-01.
- [ ] Render tests for `PeerPercentilePanel` (csv/scenarioPeer disclosure, n<252 suppress), `MetricsColumn` gate, mandate chips, own-book delta. Covers PEER-01/02/04/05.
- [ ] The new migration's self-verifying `DO` block IS its own apply-time test; pair it with a schema-sync TS test if a `*-schema-sync.test.ts` precedent is wanted (model: `mandate-columns-schema-sync.test.ts`).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Peer rank = seed=42 demo cohort, api-only | Real verified-universe cohort via SECURITY DEFINER RPC, additive csv carve-out | Phase 42 (this) | Honest peer rank on the blend; demo cohort retained only for the api arm (out-of-scope to change). |
| `peerPercentile` gated `ingestSource==="api"` | gate `||(scenarioMode && scenarioPeer != null)` | Phase 42 | Blend shows peer without unlocking synthetic panels. |

**Deprecated/outdated:**
- `getPeerCohort()` (the seed=42 demo, `peer-cohort.ts:79-93`) is NOT removed (the api arm still uses it via `build-payload.ts:241`). It is simply NOT used by the blend. The file's header comment ("Production should replace this with a query against the platform's strategy DB") describes exactly this phase — but the replacement is scoped to the BLEND, not the api arm (out-of-scope per ADR §6).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `MAR == 0` in `metrics.py` (so blend's `rf=0` Sortino matches the cohort's `rf=MAR` Sortino) | Convention Reconciliation / Pitfall 6 | If `MAR != 0`, the Sortino ranks are on different rf bases — the blend's Sortino must thread the same MAR. **Planner MUST grep `MAR =` in metrics.py.** |
| A2 | `strategy_analytics` columns are exactly `sharpe`, `sortino`, `max_drawdown` and the published filter is `withPublishedOnly`-equivalent | Cohort Query / RPC SQL | Wrong column/predicate → the RPC fails or ranks the wrong universe. Confirmed plausible by `queries.ts:116,125` but the planner should `list_tables` / read `withPublishedOnly` to pin the exact SQL. |
| A3 | min-N = 20 is a sufficient cell-size floor for cross-tenant inference resistance | Security / Cohort Query | Too low → near-individual inference; too high → panel never shows. 20 is a reasonable k-anonymity-style floor for this surface; revisit if regulators/clients impose a stricter k. |
| A4 | The max_dd sign passed client→RPC and the SQL comparison direction agree ("shallower=better") | Pitfall 2 / RPC SQL | Wrong direction ranks the deepest drawdown as best. Pin with a directional test. |
| A5 | `leverage_range`/`description` are NOT worth threading onto `StrategyForBuilder` for v1 chips (types+markets suffice) | Mandate Chips | If the user wants leverage/description chips, the adapter (`scenario-adapter.ts`) + `StrategyForBuilder` need new fields — an effort delta, not a blocker. |

## Open Questions (RESOLVED)

1. **Does `strategies.status='published'` correctly scope the "verified universe", or should it be a different status (e.g. `pending_review` strategies with a trust_tier)?**
   - What we know: CSV-finalized strategies land `status='pending_review'` (migration 093:250) with `trust_tier='csv_uploaded'`; published is the marketplace-visible state.
   - What's unclear: whether the cohort should be published-only or any-verified.
   - Recommendation: published + verified (the marketplace-comparable universe). The planner should confirm with the discuss-phase if a broader "any verified" set is intended. The min-N suppression makes either choice safe.

2. **Should the own-book delta itself disclose its basis** (sample/252) like the peer panel does?
   - Recommendation: yes — one shared "sample/252 basis" disclosure covers both, since both legs use the same `sampleBasisRatios` helper.

## Sources

### Primary (HIGH confidence)
- `docs/architecture/adr-0025-scenario-peer-carveout.md` — the authoritative decision (carve-out, gate, convention, security).
- `.planning/phases/42-peer-cohort-override-mandate/42-CONTEXT.md` — locked decisions.
- `quantstats/stats.py:841` (sharpe `std(ddof=1)`), `:982` (sortino downside-RMS `/len(returns)`) — verified in `analytics-service/.venv`.
- `analytics-service/tests/test_mt5_golden_fixtures.py:370-388` — sample-std golden arithmetic confirming the cohort basis.
- `analytics-service/services/metrics.py:352,460-466` (`compute_all_metrics` → qs.stats) — the `strategy_analytics` writer.
- `src/lib/scenario.ts:58-71,341-388` — `StrategyForBuilder` + the blend's sample-basis `ComputedMetrics`.
- `src/lib/factsheet/compute.ts:24,33,36` — the population headline basis.
- `src/lib/factsheet/types.ts:171-176,420-449` — `PeerPercentilePayload` + the discriminated union.
- `src/app/factsheet/[id]/v2/MetricsColumn.tsx:19-24,116-122` — the gate + scenarioMode seam.
- `src/app/factsheet/[id]/v2/BatchDPanels.tsx:78-107,214` — the panel + DemoBadge.
- `src/lib/factsheet/audit-c20.test.ts:356-411` — the invariant test to replace.
- `src/lib/queries.ts:113-191` (`getPercentiles`), `:2590-2701` (`getMyAllocationDashboard` + `allocator_equity_snapshots`).
- `supabase/migrations/20260501055202_strategy_verifications.sql:77-141,185-286` — table, RLS, the SECURITY DEFINER pattern.
- `src/__tests__/strategy-verifications-rls.test.ts` — the HAS_LIVE_DB RLS-test model.
- `src/app/api/preferences/route.ts` — the auth/approval/rate-limit/no-store/CSRF route pattern.
- `src/lib/api/withAuth.ts:32-74`, `src/lib/ratelimit.ts:166,278`, `src/lib/api/headers.ts:13` — route plumbing.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:267-299,1498-1584,1914,2296` — composer integration points.
- `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts:401-487` — the synth payload builder.
- `src/components/mandate/MandateChipGroup.tsx` — the (interactive) chip group to NOT reuse for read-only.

### Secondary (MEDIUM confidence)
- MEMORY topic `project_apikey_dailies_unification` / `project_milestone_v1_2_2_factsheet_parity` — milestone framing + the scenarioPeer carve-out directive.

### Tertiary (LOW confidence)
- None — every claim is grounded in a read file:line or verified tool output.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — everything is in-repo, read at file:line.
- Convention reconciliation: HIGH — quantstats source + golden fixture + scenario.ts read directly; the only residual is MAR (A1).
- Security/RLS: HIGH — migration 093 RLS read directly; SECURITY DEFINER pattern is the established one.
- RPC SQL exactness: MEDIUM — column names/published-predicate need a `list_tables` confirm (A2).
- Mandate chips field availability: HIGH for types+markets; leverage/description correctly flagged as not-on-StrategyForBuilder (A5).

**Research date:** 2026-06-26
**Valid until:** 2026-07-26 (stable in-repo surface; re-verify if `strategy_analytics` schema, `scenario.ts` metric math, or `metrics.py` MAR change).

---

## RESEARCH COMPLETE

Phase 42 surfaces a Peer-Percentile on the Scenario blend honestly: an additive optional `scenarioPeer?: PeerPercentilePayload` on the `FactsheetCsvPayload` arm (`types.ts:436-438`) plus one `scenarioMode && scenarioPeer != null` gate clause in `MetricsColumn` (`:121`) — never an `ingestSource` flip — so the three genuinely-synthetic panels stay structurally absent and the api path is provably unchanged. The cohort is the real verified-strategy universe, read via a NEW `get_verified_cohort_rank` SECURITY DEFINER RPC (required — `strategy_verifications` RLS forbids the cross-tenant join from an authed client, migration 093) that returns ONLY the rank + a count (flow (a): the distribution never leaves the server), suppressed below min-N=20, fronted by a `POST /api/scenario/peer-rank` route on the preferences-route auth/approval/rate-limit/no-store/CSRF pattern. The correctness-critical convention reconciliation is already solved: the blend's ranking Sharpe/Sortino/maxDD must come from `scenario.ts`'s `ComputedMetrics` (sample ddof=1 × √252 — verified to match the cohort's quantstats basis exactly, including the Sortino total-n denominator), NOT `compute.ts`'s population headline; pin it with a golden test (residual risk: verify `MAR == 0`). Mandate chips use the genuinely-available per-constituent `strategy_types`+`markets` from `deAliased.strategies` via a NEW read-only chip (not the interactive `MandateChipGroup`); the own-book delta recomputes own-book ratios on the same sample basis from the props-supplied `allocator_equity_snapshots` series and renders a signed delta. The test surface spans an RLS anti-leak + min-N + no-identity integration test (HAS_LIVE_DB), a route-handler test, the convention pin, the replaced audit-c20 invariant, and render tests — every security landmine (cross-tenant leak, RLS bypass, cell-size inference, ingestSource-flip, convention bias, CSRF, MAR-desync) is enumerated in the Security section with its mitigation.

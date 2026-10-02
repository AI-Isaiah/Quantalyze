# Phase 42: Peer-cohort override & mandate - Context

**Gathered:** 2026-06-26
**Status:** Ready for planning
**ADR:** docs/architecture/adr-0025-scenario-peer-carveout.md (REQUIRED before touching FactsheetCsvPayload)

<domain>
## Phase Boundary

Show Peer-Percentile on the hypothetical scenario blend — honestly. Per the user
override (2026-06-25) this OVERRIDES the locked no-peer-rank-a-hypothetical
invariant. Mechanism: an additive optional `scenarioPeer` field on the `csv`
FactsheetPayload arm + a per-panel gate in `MetricsColumn`, WITHOUT flipping
`ingestSource` to `"api"` (which would unlock 3 genuinely-api-synthetic panels).
The cohort is the platform's REAL verified-strategy universe via a scoped,
RLS-respecting, aggregated server fetch (min-N-gated, identity-stripped). Plus
per-constituent mandate chips (from genuinely-available fields) and an own-book
head-to-head delta. Scoped to the Scenario composer's blend ONLY (Overview /
factsheet honesty gates elsewhere stay as-is).

</domain>

<decisions>
## Implementation Decisions

### The peer carve-out & gate (PEER-01/02)
- **USER REFRAMING (Q1, foundational):** the peer rank is NOT an api-special
  computation. api converts to daily returns → computes metrics → ranks; csv
  already has daily returns → same; the blend derives blended daily returns (from
  already-leveraged constituent returns + weighting) → SAME path. The only reason
  `peerPercentile` was "api-only" is the historical DEMO cohort
  (`peer-cohort.ts`, seed=42), NOT any computation barrier. So the blend's peer
  rank is a LEGITIMATE same-path computation: reuse the existing
  `computePeerPercentile` fed the blend's daily-returns-derived Sharpe/Sortino/
  maxDD, ranked against the REAL cohort. The `scenarioPeer` field is merely the
  SCOPED PLUMBING to surface it on the blend without unlocking the 3 genuinely-api
  panels (allocatorPortfolios / eventSignatures / benchEventSignatures — those
  need demo fixtures, NOT daily-returns-derivable).
- **Field:** add optional `scenarioPeer?: PeerPercentilePayload` to
  `FactsheetCsvPayload` (additive; api arm + `peerPercentile` + `ingestSource`
  untouched). Blend-scoped (NOT moved to FactsheetCommon — peer-on-all-csv is
  out-of-scope for v1.2.2 per REQUIREMENTS). The field just CARRIES the
  same-path-computed rank.
- **Gate (MetricsColumn):** `ingestSource==="api" OR (scenarioMode &&
  payload.scenarioPeer != null)` — activates the Phase-40 inert `scenarioMode`
  seam; the existing api path is provably unchanged when scenarioMode=false.
- **Invariant test (PEER-01):** REPLACE the audit-c20 BEHAVIORAL pin ("csv arm →
  peer panel never renders") with: a csv+scenarioPeer payload renders the peer
  panel BUT `peerPercentile`/`allocatorPortfolios`/`eventSignatures`/
  `benchEventSignatures` stay STRUCTURALLY ABSENT and `ingestSource` stays
  `"csv"`. KEEP the type-field invariant (the 4 api-only fields never on csv).
- **Sample floor (PEER-02):** `n < 252` → peer suppressed (reuse the factsheet
  low-sample floor); the rank is reload-stable; on-panel disclosure.

### The cohort (server fetch + security) — ALL ACCEPTED
- Cohort = the verified/published-strategy universe via an AGGREGATED read built
  on the `getPercentiles()` pattern (queries.ts:113 — published strategies,
  returns the percentile DISTRIBUTION only). A minimal SECURITY DEFINER RPC ONLY
  if the `strategy_verifications` join forces a cross-tenant read RLS can't do
  safely. "Verified" = a `strategy_verifications.trust_tier` present (any tier).
- **Min-N ~20** (PEER-03): below it, suppress with an honest empty state — never
  rank against a thin/illustrative set. (getPercentiles' existing floor of 5 is
  too thin for ranking a hypothetical.)
- **No identity leak (security-critical):** the server returns ONLY the aggregated
  percentile distribution (or the blend's already-computed rank) — NO per-strategy
  id / name / returns / PII / mandate. The blend's rank is computed against the
  distribution server-side. Min-N also prevents cell-size inference.
- **Plumbing:** `withAuth` + `assertProfileApproved` + `checkLimit` (rate-limit) +
  `NO_STORE_HEADERS` (the preferences-route pattern). RLS test (HAS_LIVE_DB).

### Ranking convention, mandate chips, own-book delta — ALL ACCEPTED
- **⛔ Convention reconciliation (correctness-critical, Area 3 Q1):** the cohort's
  stored `strategy_analytics` metrics are computed by the PYTHON analytics-service
  with SAMPLE stdev (`std(ddof=1)`) × √252 (confirmed: portfolio.py
  `_compute_sharpe_and_vol`; test_mt5_golden_fixtures.py:381). The blend's Phase-39
  `strategyMetrics` use compute.ts POPULATION stdev. To rank apples-to-apples, the
  blend's RANKING Sharpe/Sortino/maxDD MUST be computed on the cohort's SAMPLE/252
  basis — NOT the population headline (population stdev < sample → would bias the
  rank high). Either compute a sample-basis ranking metric for the blend, or
  recompute the cohort on population basis; the disclosure states the basis. NEVER
  a silent cross-convention rank. (This is exactly the user's "same path" point —
  it requires choosing ONE convention for the rank; the cohort's is the anchor.)
- **Mandate chips (PEER-04):** per-constituent chips from GENUINELY-AVAILABLE
  fields — `leverage_range`, `strategy_types`, `markets`, `description` (the
  strategies table has NO dedicated thesis/terms columns). Honest-empty per
  constituent when absent. NO fabricated AGGREGATE single-strategy mandate.
- **Own-book delta (PEER-05):** the blend's core ratios MINUS the allocator's live
  book's ratios (from `allocator_equity_snapshots`, computed on the SAME basis as
  the blend's ranking metrics), shown as a DELTA — not a percentile.
- **Disclosure (PEER-02):** "hypothetical blend · ranked vs verified strategies" +
  cohort size N + the n<252 suppression note.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PeerPercentilePanel` (BatchDPanels.tsx:78-107) — renders sharpe/sortino/max_dd
  percentile bars + cohort N + a "Demo cohort" badge (replace/parameterize the
  badge for the real cohort + the hypothetical disclosure).
- `computePeerPercentile` + `percentileRank` (peer-cohort.ts:100-114) — the rank
  computation to REUSE (feed real cohort distribution instead of the seed=42 demo).
- `PeerPercentilePayload` (types.ts:171-176): `{cohortSize, sharpe, sortino, max_dd}`.
- `FactsheetCsvPayload` (types.ts:436-438) — add `scenarioPeer?`; `FactsheetApiPayload`
  (types.ts:420-430) untouched; union (types.ts:449).
- `MetricsColumn.tsx:117-122` peer gate (`scenarioMode` threaded inert at :19-24).
- `audit-c20.test.ts:364-411` — the invariant test (SYNTH_FIELDS absence at :371-384).
- `getPercentiles()` (queries.ts:113-150) — the safe aggregated cross-tenant read
  (published strategies, `withPublishedOnly`, returns aggregated, null if <5).
- `strategy_verifications` (mig 20260501055202) + RLS (owner/admin/service_role) +
  the RLS test (strategy-verifications-rls.test.ts).
- Own-book: `allocator_equity_snapshots` (RLS to own data); `getMyAllocationDashboard`.
- Route pattern: src/app/api/preferences/route.ts (withAuth + assertProfileApproved
  + checkLimit + NO_STORE_HEADERS + Sentry). `src/lib/ratelimit.ts`.

### Established Patterns
- The 2 genuinely-api panels need demo fixtures (allocator portfolios + BTC event
  signatures) → NOT daily-returns-derivable → stay absent on the blend.
- compute.ts = population (factsheet headline). Python analytics-service = sample
  (stored strategy_analytics). Both coexist deliberately — the rank uses the
  cohort's (sample) basis.

### Integration Points
- buildScenarioFactsheetPayload (Phase 39) computes the blend's metrics → feed the
  sample-basis ranking metrics to the peer fetch → set `scenarioPeer` on the csv
  payload. The server fetch is auth-gated + min-N + aggregated.

</code_context>

<specifics>
## Specific Ideas

- ⭐ Memory directive: additive scenarioPeer carve-out, NEVER ingestSource flip;
  cohort = real verified universe. The ADR must precede touching FactsheetCsvPayload.
- No clients yet → the live verified universe may be < min-N often → the peer panel
  HONESTLY suppresses (empty state). The infrastructure is built correctly for when
  the universe grows. This is acceptable + honest (PEER-03).

</specifics>

<deferred>
## Deferred Ideas

- Peer/percentile on the per-key or Overview surfaces — out-of-scope (this
  milestone scopes it to the blend only).
- Toggle fold + guards + the Phase-40/41 UI-review carry-forwards → Phase 43.

</deferred>

# ADR-0025: Scenario peer-percentile via an additive `scenarioPeer` carve-out (not an `ingestSource` flip)

## Status

Accepted (2026-06-26) — milestone v1.2.2 Phase 42.

## Context

The factsheet ranks a strategy's Sharpe / Sortino / max-drawdown against a peer
cohort and renders the result in `PeerPercentilePanel`. Today this panel is gated
to `ingestSource === "api"` (see `MetricsColumn.tsx` and the `FactsheetApiPayload`
arm in `src/lib/factsheet/types.ts`), and the cohort it ranks against is a
**deterministic demo cohort** (`src/lib/factsheet/peer-cohort.ts`, Mulberry32 PRNG
seed 42), tagged "Demo cohort".

The Scenario composer (milestone v1.1.0+) lets an allocator build a hypothetical
**blend** of strategies and renders the real `FactsheetBody` on it (v1.2.2 Phase
40). The user has directed (2026-06-25) that the blend should also show a
Peer-Percentile — overriding the previously-locked "never peer-rank a hypothetical"
invariant — provided it is done **honestly**: ranked against the platform's REAL
verified-strategy universe, sample-floor-gated, and clearly disclosed as a
hypothetical.

Two facts shape the decision:

1. **The peer rank is a daily-returns-derived metric, not an api-special panel.**
   The api ingest path converts to daily returns and then computes every metric
   from them; the csv path already has daily returns; the blend derives blended
   daily returns from already-leveraged constituent returns plus weighting. All
   three feed the *identical* daily-returns → metrics → percentile-rank path. The
   only reason `peerPercentile` was "api-only" is the historical demo cohort — not
   any computational barrier. (User, 2026-06-25.)

2. **The three OTHER api-only panels are genuinely synthetic.**
   `allocatorPortfolios` (demo allocator blends), `eventSignatures` and
   `benchEventSignatures` (BTC-fixture event studies) are NOT derivable from a
   blend's daily returns — they require demo fixtures. Flipping the blend's
   `ingestSource` from `"csv"` to `"api"` to unlock the peer panel would *also*
   unlock these three, presenting fabricated data the override never authorized.

3. **Two annualization conventions coexist deliberately.** The factsheet headline
   metrics (`src/lib/factsheet/compute.ts`) use population stdev; the stored
   `strategy_analytics` cohort metrics are computed by the Python analytics-service
   with sample stdev (`std(ddof=1)`) × √252. Ranking a population-basis Sharpe
   against a sample-basis cohort would bias the rank high.

## Decision

1. **Additive carve-out, never an `ingestSource` flip.** Add an optional
   `scenarioPeer?: PeerPercentilePayload` to the `FactsheetCsvPayload` arm only.
   `ingestSource` stays `"csv"`; the `FactsheetApiPayload` arm and the existing
   `peerPercentile` field are untouched. The three genuinely-synthetic panels
   remain structurally absent on the blend by construction.

2. **Render gate.** `MetricsColumn` renders the peer panel when
   `ingestSource === "api"` **OR** `(scenarioMode && payload.scenarioPeer != null)`.
   With `scenarioMode === false` (every existing call site — the real route, the
   Discovery page, the Overview widget) the api path is provably unchanged.

3. **Same-path computation, real cohort.** The blend's rank reuses the existing
   `computePeerPercentile` over the blend's daily-returns-derived Sharpe / Sortino /
   max-DD, ranked against the **real verified-strategy universe** (strategies with a
   `strategy_verifications.trust_tier`), fetched via an aggregated, RLS-respecting,
   identity-stripped server read (built on the `getPercentiles` pattern; a minimal
   `SECURITY DEFINER` RPC only if the verifications join requires it). The server
   returns only the aggregated distribution / the computed rank — never per-strategy
   identity, returns, or PII. A **min-N ≈ 20** floor suppresses the panel (honest
   empty) rather than rank against a thin set.

4. **Convention reconciliation.** The blend's *ranking* metrics are computed on the
   cohort's **sample / 252** basis (matching the Python `strategy_analytics`), NOT
   the population headline basis — so the comparison is apples-to-apples. The
   disclosure states the basis.

5. **Honesty gates.** A sample floor (`n < 252` → suppressed); an on-panel
   disclosure ("hypothetical blend · ranked vs verified strategies" + cohort N); a
   reload-stable rank. The audit-c20 *behavioral* invariant ("csv → peer panel never
   renders") is **replaced** (not deleted) with one that asserts the carve-out
   renders peer while the three synthetic panels stay absent and `ingestSource`
   stays `"csv"`; the type-field invariant (the four api-only fields never on the
   csv arm) is preserved.

6. **Scope.** Blend-only. `scenarioPeer` is NOT promoted to `FactsheetCommon` and
   peer/percentile is NOT re-derived on the per-key or Overview surfaces this
   milestone.

## Consequences

**Positive**
- The blend shows an honest peer rank against real strategies without unlocking any
  unauthorized synthetic panel; the discriminated-union compile-time backstop and
  the api path stay intact.
- The carve-out is one optional additive field + one gate clause + one server fetch;
  the byte-identity of the real factsheet route / Overview is preserved.
- The cohort read is aggregated + min-N + identity-stripped → no cross-tenant leak.

**Negative / risks**
- With few verified strategies in production (no clients yet), the cohort is often
  below min-N, so the panel honestly suppresses much of the time. Acceptable — the
  infrastructure is correct for when the universe grows.
- Two conventions remain in the codebase; the rank must be computed on the cohort's
  sample basis. A future drift in the Python convention would desync the rank — the
  ranking-basis choice is pinned by a test.
- A new cross-tenant aggregated read is a security surface; it is gated by
  `withAuth` + approval + rate-limit + `NO_STORE`, returns aggregates only, and is
  covered by an RLS test and the migration/RLS auditors.

## Alternatives considered

- **Flip `ingestSource` to `"api"` for the blend.** Rejected — unlocks 3 unauthorized
  synthetic panels (the milestone's explicit Out-of-Scope).
- **Promote `peerPercentile` to `FactsheetCommon` (peer on all csv).** Rejected for
  v1.2.2 scope — correct in principle (the user's "same path" point), but expands the
  honesty change to every csv strategy + the Overview; deferred to a future milestone.
- **Keep ranking against the demo cohort.** Rejected — a hypothetical ranked against
  fabricated peers is exactly the dishonesty the override forbids.

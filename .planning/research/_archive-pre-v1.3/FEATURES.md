# Feature Research — v1.2.2 scenario-tab-factsheet-parity

**Domain:** Institutional portfolio analytics — rendering a full factsheet on a *hypothetical blended* portfolio (multi-strategy / fund-of-funds analytics), plus a constituent-correlation diversification view and an honest peer-percentile cohort for a synthetic blend.
**Researched:** 2026-06-25
**Confidence:** MEDIUM-HIGH (domain conventions HIGH via institutional sources; codebase-reuse mapping HIGH from direct reads; the two design-heavy items — constituent-correlation spec and peer-cohort definition — are MEDIUM because they involve product judgment, not just convention)

> Supersedes the v1.2 FEATURES.md (Allocator Cohesion, 2026-06-23). That milestone shipped; this file is the ACTIVE v1.2.2 research.

---

## Scope note (read first)

This is a SUBSEQUENT milestone on a shipped app. The factsheet UI, scenario composer, blend graphs, v1.1 correlation heatmap / stress / Monte-Carlo, and the per-key honest source already exist and are NOT re-researched. The north-star is **adapter-only**: feed the existing `FactsheetView` a *complete* `FactsheetPayload` synthesized from the blend. So "table stakes" below means *"a metric/panel the real factsheet already renders that an allocator will expect to also see on the blend"* — the work is populating it honestly from blend data, not building the panel. The genuinely-new surface is exactly two things: the **constituent-correlation panel** and the **peer-cohort decision** (the v1.2 "no-peer-rank" anti-feature is now being deliberately overridden — see below).

Grounding reads (this session, all HIGH):
- `scenario-factsheet-payload.ts` — `buildScenarioFactsheetPayload` today emits a MINIMAL `csv`-arm payload with a `zeroedComputeSummary()` (every scalar = 0) because no KPI strip mounts yet. The milestone fills these in. The `FactsheetCsvPayload` shape already enumerates the full metric set (skew, kurt, var95, cvar95, profit_factor, win_rate, mtd/ytd/p3m/p6m/p1y, calmarByYear, bootstrapCI, monthlyReturns, dailyHeatmap, styleDrift, stressWindows, quantiles, recovery_factor, pain/ulcer index, tail/omega/common_sense ratio).
- `scenario-blend-panels.ts` — already derives histogram / quantiles / rolling Sharpe-vol-Sortino from the frozen engine's `portfolio_daily_returns`, 252-annualized, with a `MIN_USABLE=10` degenerate gate. Much of the "complete metric set" lifts off the same daily-return vector.
- `peer-cohort.ts` — there is ALREADY a `getPeerCohort()` of **20 synthesized demo peers** (seeded 42, tagged "demo cohort" in the UI), used by the single-strategy factsheet's Peer Percentile panel. Its own header says *"Production should replace this with a query against the platform's strategy DB."* This is the anchor for the peer-cohort decision.
- The payload ALREADY has a `correlationMatrix: { labels, matrix }` field — but that is the factsheet's OWN returns-heatmap / cross-asset correlation, a DIFFERENT thing from the constituent-correlation matrix this milestone wants. Do NOT overload it.

---

## Feature Landscape

### Table Stakes (Allocators Expect These on a Blend)

Features users assume exist. Missing these = the "factsheet parity" promise feels broken. All are **populate-the-existing-panel** work via the adapter.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Full KPI strip on the blend** (CAGR, ann-vol, Sharpe, Sortino, Calmar, max-DD, cum-ret) | This is *the* point of the milestone — the blend gets a real factsheet, not just graphs | LOW | Compute from the engine's `portfolio_daily_returns` (same vector blend-panels already consume). These aggregate cleanly from daily returns — the correct level. |
| **Distribution / tail moments** (skew, kurtosis, VaR95, CVaR95, best/worst day-week-month-quarter-year, quantiles) | Already on the single-strategy factsheet; an allocator reads tails to judge blend risk | LOW-MEDIUM | All derivable from the daily-return series; v1.1 already computes VaR/CVaR for stress. Reuse, don't reinvent. |
| **Period returns** (MTD, YTD, 3M, 6M, 1Y) | Standard factsheet row | LOW | Window slices of the blend curve. |
| **Equity + drawdown + rolling Sharpe/vol/Sortino** | Already shipped as blend graphs (v1.2 / v1.2.1 PARITY) | DONE | Already in `scenario-blend-panels.ts` + real `TimeSeriesChart`/`MasterBrush` reuse. Just wire into the factsheet body layout. |
| **Calmar-by-year, monthly/daily returns heatmaps, EoY table** | Present on the real factsheet; an allocator scanning a factsheet expects the seasonality grid | MEDIUM | Bucketing the blend's daily returns by month/year. Mechanical but several panels. |
| **Bootstrap confidence intervals** on Sharpe/Sortino/max-DD | The real factsheet shows CIs; the v1.1 block-bootstrap Monte-Carlo Web Worker already exists | MEDIUM | Reuse the v1.1 bootstrap. CIs matter *more* on a blend (it's hypothetical) — honest uncertainty bands fit the no-invented-data invariant. |
| **Constituent correlation matrix** (pairwise corr between the blend's strategies / API-key-strategies) | The allocator's explicit diversification question: "are any two components the same bet?" — table stakes for *any* fund-of-funds tool | MEDIUM-HIGH | **The ONE genuinely-new panel.** Concretely specified below. This is what makes the factsheet *useful for composing a blend*, not just describing it. |
| **"Constituents" / holdings list with weights** | A FoF factsheet always lists what's inside and at what weight | LOW | The composer already knows constituents + weights (it's the blend definition). Render as the matrix's row/col labels + a weight column. |
| **Benchmark overlay (TE / IR / alpha-beta)** | Already shipped (v1.1 benchmark overlay; adapter already injects `comparators.btc.cumulative`) | DONE | Carry through. |

### Differentiators (Competitive Advantage)

Features that set the product apart. These lean directly on the Core Value ("model the impact of composition changes before you make them") and are where this milestone earns its keep.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Diversification scorecard** beside the constituent matrix — diversification ratio, effective-number-of-bets, max + average pairwise correlation | Turns a raw matrix into a one-glance "is my blend actually diversified?" answer. Institutional FoF tools compute these; few retail-facing tools surface them honestly | MEDIUM | DR = (wᵀσ)/√(wᵀΣw); ENB via Meucci or DR²; both fall straight out of the constituent covariance the matrix already needs. High value-per-line. |
| **"Too similar" flags / clustering** on the constituent matrix | Directly answers the user's framing — *spot when two components are too similar.* Thresholded highlight (>0.85 = "redundant bet") + optional hierarchical-cluster reorder so similar managers sit in a block | MEDIUM | Threshold flag = trivial. Hierarchical-cluster reorder (distance = ½(1−ρ), agglomerative) is the polished version — defer the dendrogram, ship the block-reorder + flag. |
| **Marginal / percent contribution-to-risk per constituent** | "Which holding is driving my blend's risk?" — a risk-budgeting view the composer can act on (reweight the risk hog). PCRs sum to 100%, so it's honest and complete | MEDIUM | PCRᵢ = wᵢ·(Σw)ᵢ / (wᵀΣw); the component-VaR analog sums exactly to total. Pairs naturally with the constituent covariance. Strong differentiator, low marginal cost once Σ exists. |
| **Honest peer-percentile on the blend** (the override) | User explicitly WANTS Peer-Percentile shown on the blend. Doing it *honestly* (clearly-labelled cohort, min-N gate) is a differentiator vs tools that either hide it or fake it | MEDIUM | The design-heavy item #2. Cohort options + honesty tradeoffs enumerated below. |
| **Constituent contribution-to-return** (each component's weighted share of blend return) | Complements contribution-to-risk: "this 10% sleeve drove 40% of the gain" | LOW | Weighted return decomposition is a one-liner from weights × constituent returns. Cheap, intuitive. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem natural to carry onto a blend but inject false precision into a hypothetical — direct violations of the locked no-invented-data invariant.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Aggregate win-rate / profit-factor / avg-win-loss on the blend** | They're on the single-strategy factsheet, so "parity" tempts you to fill them | These are **trade-level** metrics that do NOT aggregate from constituents' daily returns. A blend has no "trades." Computing win-rate from blended *daily* returns is a different, weaker statistic than the strategy's trade win-rate, and silently relabelling it misleads (research: "Omega ≈ profit-factor at the daily level" — not the same metric at a different scope). | Compute the **daily-return analogs** and **label them as daily** (e.g. "% up days", daily Omega), OR omit. Do NOT print "Win Rate 58%" implying trade-level. The adapter currently zeroes these — keep them zeroed/omitted unless explicitly relabelled. |
| **Mandate / thesis / terms / leverage panel on the blend** | The single-strategy factsheet has a mandate panel; parity tempts a "blend mandate" | A blend has **no single mandate** — no one thesis, fee, leverage, or capacity. Synthesizing an "aggregate mandate" invents a product that doesn't exist. AUM/capacity/fees especially do not aggregate meaningfully. | **Omit the single-mandate panel; show per-constituent mandate chips** (each component's thesis/leverage) in a "Constituents" section. Honest *and* more useful (the allocator sees the mix). Decision called out below. |
| **Style-drift panel computed on the blend** | It's a factsheet panel | Style drift regresses a strategy's returns on style factors over time. On a hypothetical blend it's *computable* but muddy in meaning (drift of a thing you never ran). Borderline, not clearly false. | Lower priority. If shown, inherit the "PROJECTED — hypothetical" framing. Safe to defer to v1.x; not table-stakes. |
| **Peer-percentile against a tiny / wrong cohort** | "Just rank it against everything we have" | A meaningful percentile needs **20–30+ peers** (50–100 preferred); ranking against <20 strategies, or against single-strategy peers when the subject is a *blend*, produces a confident-looking but meaningless number — the exact false-precision the invariant forbids | See peer-cohort decision: pick a cohort with a real, disclosed denominator and label it; gate the panel below a minimum-N floor (mirror the existing `MIN_USABLE` / sample-floor pattern). |
| **Live Overview-grade panels** (`ingestSource:"api"` allocator/portfolio panels) | They look richer | Already out-of-scope per PROJECT.md — these unlock peer/allocator panels on a what-if. The adapter deliberately uses the `csv` arm. | Stay on the `csv` arm. The peer panel is added *explicitly and honestly*, not by flipping `ingestSource`. |
| **Capacity / max-AUM / turnover for the blend** | Fields exist on the payload | A blend's capacity isn't the sum (correlated strategies share capacity; leverage changes it). Summing is wrong; min is arbitrary | Leave null (the adapter already nulls `aum`/`maxCapacity`/`avgDailyTurnover`). Show per-constituent if anything. |

---

## The two design-heavy items (called out per downstream consumer)

### A. Constituent correlation / diversification view (CONCRETE SPEC)

This is the ONE new panel. It is **not** the factsheet's returns-heatmap (`correlationMatrix` on the payload) and **not** the v1.1 scenario correlation-heatmap of *named saved scenarios*. It is a pairwise correlation matrix across **the components of the current blend** — each verified strategy and each API-key-strategy the composer has toggled on.

**Inputs (all already available client-side):**
- Per-constituent daily-return series (the same per-key/per-strategy dailies the engine blends — v1.2.1 unified these through the CSV path).
- The blend weights (the composer owns these).
- The overlapping-window gate already used elsewhere (pairwise correlation must use the common overlapping dates; honor the existing overlap-N disclosure + sample-floor pattern).

**Table-stakes contents:**
1. **N×N pairwise correlation matrix** (Pearson on overlapping daily returns), colour-scaled, with constituent names as row/col labels and a weight column. Diagonal = 1.
2. **Per-pair overlap-N disclosure** — degenerate pairs (<10 overlapping days) render an honest blank cell, never a fabricated 0 (mirror `MIN_USABLE`).
3. **"Too similar" flag** — highlight pairs above a threshold. Research-grounded bands: **>0.85 = "behaves as one risk unit / redundant"**, 0.5–0.85 = partial overlap, <0.5 = meaningful diversification. Make the threshold a named constant, not magic.

**Differentiator contents (the scorecard):**
4. **Max pairwise correlation** and **average pairwise correlation** (single headline numbers; avg-pairwise <0.7 is the practitioner target).
5. **Diversification Ratio** DR = (wᵀσ) / √(wᵀΣw). DR=1 means concentrated/redundant; higher = more diversified. Cheap once Σ exists.
6. **Effective Number of Bets** (Meucci, or the DR² proxy) — "your 6-strategy blend has only ~2 independent bets." Most intuitive single number for the allocator's actual question.
7. **Percent-contribution-to-risk per constituent** PCRᵢ = wᵢ·(Σw)ᵢ / (wᵀΣw), summing to 100% — risk-budgeting view (which sleeve dominates blend risk).

**Polish / defer:**
8. **Hierarchical-cluster reorder** (distance = ½(1−ρ), agglomerative) so similar constituents form a visible block-diagonal — ship the threshold flag first, add clustering later. Full dendrogram is v2.

**Honesty rules for this panel:**
- Use overlapping windows only; disclose N per pair.
- Crypto-heavy blends correlate hard in stress — a static full-sample corr understates tail co-movement. A "crisis correlation" note or a stress-window sub-correlation is a strong (deferred) honesty add; at minimum, don't imply the printed correlation holds in a drawdown.
- Small-N correlation is noisy (random-matrix-theory caveat for hedge-fund-length samples). The sample-floor gate already in the codebase covers this; reuse it.

**Complexity:** MEDIUM-HIGH. Matrix + threshold flag + max/avg headline is MEDIUM (pure TS off existing dailies, one new panel in the DESIGN.md palette). DR + ENB + PCR add LOW marginal cost once the constituent covariance Σ is built — build Σ once, derive all four. **The covariance Σ is the load-bearing shared dependency.**

### B. Peer-cohort for a synthetic blend (OPTIONS + HONESTY TRADEOFFS)

The user is **overriding** the locked "no-peer-rank-a-hypothetical" invariant (the v1.2 anti-feature) and WANTS a real percentile number on the blend. The snag: a hypothetical blend has no native peer cohort. The job is to pick an honest, clearly-labelled denominator. The platform ALREADY ships a *disclosed-synthetic* cohort pattern: `getPeerCohort()` (20 synthesized demo peers, tagged "demo cohort") on the single-strategy factsheet. Options, best → worst on honesty:

| Cohort option | What it ranks against | Honesty tradeoff | Verdict |
|---------------|----------------------|------------------|---------|
| **Verified-strategy universe** (rank the blend's Sharpe/Sortino/max-DD vs all verified single strategies on the platform) | The platform's real strategies | Apples-to-oranges in *kind* (blend vs single strategy) but the denominator is **real and disclosable** ("vs N verified strategies"). Honest if labelled "vs single strategies, not other blends." Needs ≥20–30 to be meaningful. | **Recommended primary** — real denominator, no fabrication, reuses existing strategy DB. Gate below a min-N. |
| **Category / sub-strategy cohort** (rank vs strategies sharing the blend's dominant style/market) | A filtered slice of the real universe | Institutionally "correct" (strategy + sub-strategy is how real peer groups are defined) BUT a *blend* has no single category, and filtering shrinks N below the 20–30 floor fast | Defer — needs a blend-category derivation + risks tiny-N. Good v1.x once the universe is bigger. |
| **Allocator's own book** (rank the what-if blend vs the allocator's current live blend / saved scenarios) | The allocator's own portfolios | Most *decision-relevant* ("is this better than what I have?") and impossible to fake — it's their data. But N is tiny (often 1–2), so it's a *comparison*, not a *percentile* | **Recommended as a complement**, framed as a head-to-head delta (the v1.0 Impact/delta surface), NOT as a percentile. |
| **Synthesized demo cohort** (the existing seeded-42 20-peer set) | Fabricated peers | Already shipped for single strategies and clearly tagged "demo." Honest ONLY because of the label. For a *blend* it's the weakest — fabricated peers ranking a fabricated portfolio | Acceptable fallback ONLY if labelled "illustrative cohort" exactly as today; not the headline. |

**Honesty pitfalls of ranking a thing that doesn't exist (anti-features for this panel):**
- **Tiny-N false precision** — "82nd percentile" against <20 peers is meaningless. Gate the panel on a minimum cohort size (reuse the sample-floor pattern); below it, show "cohort too small to rank," not a number.
- **Category mismatch unlabelled** — ranking a blend against single strategies without saying so implies a like-for-like comparison that isn't. The label must name the denominator ("vs N verified single strategies").
- **Survivorship / selection** in the cohort — if the universe is only currently-listed strategies, the percentile is inflated. Disclose.
- **Metric cherry-pick** — show the same Sharpe/Sortino/max-DD triple the existing cohort uses; don't pick the flattering metric.
- **"PROJECTED — hypothetical" framing must persist** — the percentile sits on a what-if; it inherits the existing hypothetical banner. (SEC Marketing Rule territory: hypothetical/backtested performance must be presented with its limitations, not as if achieved.)

**Recommendation:** Headline percentile = **verified-strategy universe**, gated on min-N, labelled with the real denominator and "vs single strategies." Complement with the **own-book head-to-head** as a delta (not a percentile). Keep the demo cohort only as a labelled fallback. This satisfies the user's override while staying inside the no-invented-data *spirit*: the *number* is real (real denominator), only the *subject* is hypothetical (and already banner-framed).

### B′. Mandate-panel disposition (smaller decision, bundled)

A blend has no single mandate/thesis/terms/leverage. **Decision: OMIT the single-mandate panel; render per-constituent mandate chips** in a "Constituents" section (each component's thesis + leverage, which the catalog already carries). Honest (no invented aggregate) and strictly more useful (the allocator sees the mix of mandates they're combining). AUM/capacity/fee stay null. Dovetails with the constituent-correlation panel's row labels — same constituents, two views (correlation + mandate).

---

## Feature Dependencies

```
Per-constituent daily returns (EXISTS — v1.2.1 unified per-key dailies)
    └──feeds──> Constituent covariance Σ (NEW, build once)
                   ├──> Constituent correlation matrix + "too similar" flags   [table-stakes panel]
                   ├──> Diversification Ratio + Effective Number of Bets        [scorecard]
                   └──> Percent-Contribution-to-Risk per constituent            [risk budget]

Frozen engine portfolio_daily_returns (EXISTS)
    └──feeds──> Complete metric set (skew/kurt/VaR/CVaR/periods/Calmar-yr/heatmaps/EoY)
                   └──> buildScenarioFactsheetPayload (extend minimal→complete)
                            └──> Real FactsheetView body (REUSE — byte-identical)

Verified-strategy DB (EXISTS) ──feeds──> Honest peer cohort ──> Peer-Percentile panel (override)
Existing getPeerCohort() demo cohort ──fallback──> Peer-Percentile panel

Catalog mandate data (EXISTS) ──feeds──> Per-constituent mandate chips (replaces single-mandate panel)

v1.1 block-bootstrap MC Worker (EXISTS) ──feeds──> Bootstrap CIs on Sharpe/Sortino/max-DD
v1.1 stress/VaR (EXISTS) ──enhances──> (optional) crisis-correlation sub-matrix

Trade-level metrics (win-rate/profit-factor) ──CONFLICTS──> blend (no trades; do not aggregate)
ingestSource:"api" panels ──CONFLICTS──> hypothetical blend (out of scope; stay on csv arm)
```

### Dependency Notes

- **Everything-new hangs off one object: the constituent covariance Σ.** Build Σ once from the per-constituent overlapping daily returns; the correlation matrix, DR, ENB, and PCR all derive from it. This is the single most leverage-y piece of new code and should be its own pure-TS module + test (mirrors `scenario-blend-panels.ts`).
- **The complete metric set is mostly a lift, not new math** — skew/kurt/VaR/CVaR/periods/heatmaps all come off the blend's daily-return vector the engine already produces, and several already exist (blend-panels, v1.1 VaR, v1.1 bootstrap). The adapter's job is wiring real values into the fields `zeroedComputeSummary()` currently zeroes.
- **Peer cohort depends on the strategy-DB query**, a small server fetch — the one place the otherwise-pure-client adapter touches data. Scope it; it's the only non-pure-TS addition.
- **Trade-level metrics conflict with the blend model** — keep them zeroed/omitted or relabel as daily analogs. Do not silently print them.

---

## MVP Definition

### Launch With (v1.2.2 core)

- [ ] **Extend `buildScenarioFactsheetPayload` minimal→complete** — fill the `ComputeSummary` (CAGR, vol, Sharpe, Sortino, Calmar, max-DD, cum-ret, skew, kurt, VaR95, CVaR95, MTD/YTD/3M/6M/1Y, best/worst buckets, quantiles) + calmarByYear + monthlyReturns + dailyHeatmap + bootstrapCI from the blend's daily returns — *because this IS the milestone.*
- [ ] **Mount the real `FactsheetView` body in the composer** under the existing scenario `FactsheetProvider` — *north-star: reuse-wholesale; factsheet stays byte-identical.*
- [ ] **Constituent correlation matrix + "too similar" flag + max/avg pairwise headline** — *the one new table-stakes panel; the allocator's explicit diversification question.*
- [ ] **Diversification Ratio + Effective Number of Bets** — *near-zero marginal cost off Σ; clearest "is my blend diversified?" answer.*
- [ ] **Per-constituent mandate chips** (omit single-mandate panel) — *honest aggregate doesn't exist; chips are honest + more useful.*
- [ ] **Honest peer-percentile vs verified-strategy universe, min-N gated, labelled denominator** — *the user's explicit override; honest cohort is available.*
- [ ] **Fold on/off/add-strategy toggles into the factsheet-shaped layout** — *listed milestone target; composer controls already exist.*

### Add After Validation (v1.x)

- [ ] **Percent-contribution-to-risk per constituent** — trigger: allocator asks "which sleeve drives my risk?" (cheap once Σ exists; could even be MVP if time allows).
- [ ] **Hierarchical-cluster reorder of the constituent matrix** — trigger: blends routinely exceed ~6 constituents and the raw matrix gets hard to scan.
- [ ] **Own-book head-to-head delta** alongside the percentile — trigger: allocators have ≥2 saved blends to compare.
- [ ] **Style-drift panel on the blend** (with hypothetical framing) — trigger: an allocator asks; not table-stakes.

### Future Consideration (v2+)

- [ ] **Crisis / stress-window constituent correlation** (correlation conditional on drawdown windows) — defer: meaningful but heavier; the static matrix ships the 80%.
- [ ] **Category/sub-strategy peer cohort** — defer: needs a blend-category derivation + a bigger universe to clear the 20–30 floor.
- [ ] **Full dendrogram visualization** — defer: block-reorder delivers most of the value.
- [ ] **Scenario factsheet export (PDF/CSV)** — already explicitly out of scope until save/load proves the workflow.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Complete metric set in the payload (KPI/distribution/periods/heatmaps) | HIGH | MEDIUM | P1 |
| Mount real FactsheetView body | HIGH | LOW (reuse) | P1 |
| Constituent correlation matrix + too-similar flag | HIGH | MEDIUM | P1 |
| Diversification Ratio + ENB | HIGH | LOW (off Σ) | P1 |
| Per-constituent mandate chips (omit aggregate) | MEDIUM | LOW | P1 |
| Honest peer-percentile (verified-universe, gated) | HIGH (user override) | MEDIUM | P1 |
| Fold compose toggles into layout | MEDIUM | LOW | P1 |
| Percent-contribution-to-risk | MEDIUM | LOW | P2 |
| Hierarchical-cluster reorder | MEDIUM | MEDIUM | P2 |
| Own-book head-to-head delta | MEDIUM | LOW (delta exists) | P2 |
| Aggregate trade-level win-rate/profit-factor | LOW (misleading) | LOW | **AVOID / relabel-as-daily** |
| Crisis-correlation matrix | MEDIUM | HIGH | P3 |
| Style-drift on blend | LOW | MEDIUM | P3 |

**Priority key:** P1 = must-have for this milestone · P2 = should-have, add when possible · P3 = future.

## Competitor / Domain Feature Analysis

| Feature | Institutional FoF tools (AlternativeSoft, FactSet, eVestment) | Retail/quant tools (Portfolio Visualizer, riskfolio-lib, PortfolioOptimizer) | Our approach |
|---------|--------------|--------------|--------------|
| Blend factsheet | Full multi-manager analytics on the aggregate; metrics computed on blend *returns*, not summed from constituents | Tearsheets on a weighted portfolio of return series | Synthesize one complete `FactsheetPayload` from blend daily returns; reuse real FactsheetView (byte-identical) |
| Constituent correlation | Correlation matrix + random-matrix denoising for short hedge-fund samples; cluster-block reorder | Correlation matrix + hierarchical clustering (HRP, distance ½(1−ρ)) | Pearson matrix on overlapping dailies + threshold flag; cluster-reorder deferred; sample-floor gate covers small-N noise |
| Diversification metric | Marginal/percent contribution-to-risk; diversification ratio | Diversification Ratio + Effective Number of Bets (Meucci) | DR + ENB headline + PCR (P2), all off one Σ |
| Peer ranking | Strategy + sub-strategy + AUM-tier + 3–5yr inception cohort; 20–30+ funds for a meaningful percentile | Generally absent on synthetic blends | Verified-strategy universe, min-N gated, labelled denominator; demo-cohort fallback (already shipped pattern) |
| Trade-level metrics on a blend | Not aggregated — reported per-manager, not summed | Reported at the portfolio-return (daily) level, distinct from per-trade | Omit/relabel-as-daily; never print trade-level on the blend |
| Mandate/terms on a blend | Per-manager mandate sheets, not an aggregate | N/A | Per-constituent mandate chips; no synthetic aggregate mandate |

## Sources

- The Diversification Ratio — Portfolio Optimizer: https://portfoliooptimizer.io/blog/the-diversification-ratio-measuring-portfolio-diversification/ (HIGH — formula DR=(wᵀσ)/√(wᵀΣw), DR² ≈ effective bets)
- The Effective Number of Bets (Meucci 2009) — Portfolio Optimizer: https://portfoliooptimizer.io/blog/the-effective-number-of-bets-measuring-portfolio-diversification/ (HIGH)
- Correlation, Diversification & Portfolio Math — Foxholm Financial: https://foxholm.com/q/concepts/correlation-diversification/ (MEDIUM — >0.85 "one risk unit", avg-pairwise <0.7 target, crisis correlation spike)
- Hierarchical Clustering & Dendrograms — Portfolio Optimization (Palomar): https://bookdown.org/palomar/portfoliooptimizationbook/12.2-hierarchical-clustering-and-dendrograms.html (HIGH — distance ½(1−ρ), block-diagonal reorder)
- Hierarchical Risk Parity — Hudson & Thames: https://hudsonthames.org/an-introduction-to-the-hierarchical-risk-parity-algorithm/ (HIGH — clustering of redundant return-correlation structures)
- Risk budgeting / component VaR (risk contributions sum to total) — bookdown introFinRbook: https://bookdown.org/compfinezbook/introFinRbook/Risk-Budgeting.html and faculty.washington.edu/ezivot ssrn-id684221 (HIGH — PCRᵢ = wᵢ·(Σw)ᵢ/(wᵀΣw))
- How to Benchmark Hedge Funds Against a Peer Group — AlternativeSoft: https://www.alternativesoft.com/how-to-benchmark-hedge-funds-against-peer-group.html (HIGH — cohort = strategy+sub-strategy+AUM+geography+inception; 20–30 min, 50–100+ preferred; small cohorts "statistically meaningless and misleading")
- Total Return Percentile Rank methodology — Morningstar: https://awgmain.morningstar.com/webhelp/glossary_definitions/mutual_fund/mfglossary_PercentileRankCategory.html (HIGH — percentile vs same-category peers)
- SEC Marketing Rule — Hypothetical/Backtested Performance — Troutman Pepper Locke: https://www.troutman.com/insights/the-secs-new-marketing-rule-practically-speaking-hypothetical-performance/ and BCLP enforcement sweep: https://www.bclplaw.com/en-US/events-insights-news/sec-enforcement-sweep-regarding-hypothetical-performance.html (MEDIUM — hypothetical performance must be framed with limitations; honesty anchor for the peer override)
- Random matrix theory & FoF correlation noise — ScienceDirect: https://www.sciencedirect.com/science/article/abs/pii/S0378437107004086 (MEDIUM — short hedge-fund samples make correlation matrices noisy; sample-floor justification)
- Blended/aggregate metrics can mislead; daily-return vs per-trade distinction (Omega ≈ profit-factor at daily level) — Gainium strategy metrics + ProductHQ blended metrics: https://gainium.io/blog/strategy-performance-metrics , https://producthq.org/product-analytics/blended-metrics/ (MEDIUM — anchors the trade-level anti-feature)
- Codebase (HIGH, direct reads this session): `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts` (the adapter + `zeroedComputeSummary` enumerating the full metric set), `src/lib/scenario-blend-panels.ts` (existing 252-annualized blend derivations + MIN_USABLE gate), `src/lib/factsheet/peer-cohort.ts` (existing 20-peer demo cohort, "replace with strategy-DB query"), `.planning/PROJECT.md` (north-star, locked invariants, out-of-scope).

---
*Feature research for: institutional factsheet-on-a-hypothetical-blend + constituent-correlation diversification + honest peer-cohort (Quantalyze v1.2.2)*
*Researched: 2026-06-25*

# Phase 194: FIGURETRUTH — a figure means one thing everywhere and shows only when it can mean something - Context

**Gathered:** 2026-11-07
**Status:** Ready for planning

<domain>
## Phase Boundary

A metric with the same name shows the same value for the same strategy and period on My Strategies, the factsheet, the tearsheet, Scenario and Holdings. Where two figures differ on purpose, the label says what each one is. A figure that cannot mean anything (track too short) is withheld with a reason, and a missing figure is never treated as 0. Requirements TRUST-04 and TRUST-05. See the ROADMAP "Phase 194" section for the success criteria and the evidence at HEAD.

</domain>

<decisions>
## Implementation Decisions

### Which number is the truth
- **D-01:** The analytics service's STORED figure for the full history is canonical on every page. The factsheet's browser engine (`src/lib/factsheet/compute.ts`) is used only for a range the user narrowed, and that range is labelled as such (193's "Selected range" label). Scenario's engine (`src/lib/scenario.ts`) is used only for blends, which have no stored value. A parity test goes RED when two pages disagree on the same strategy and period. (Founder 2026-11-07: "Stored value, full history".)
- **D-02:** VaR/CVaR use the HISTORICAL method (worst 5% of days) everywhere. The tearsheet and the stored metric (parametric today, `analytics-service/services/metrics.py` ~:2190) move to the historical method the factsheet uses (`compute.ts` ~:236). (Founder: "Historical".) — **Reversibility:** costly — changes a stored metric, so a PROD recompute is needed for stored values to agree; the planner decides whether 194 runs it (cf. the never-run `[164.6.6.3.3-WAVE5-RECOMPUTE]`).
- **D-03 (settled by the house rule "returns by calendar"):** trailing-period returns (3 month, 6 month) are calendar windows (91/182 days), not row counts. Today `metrics.py` ~:2156 takes the last 126 rows, about 4 months on a 7-day crypto venue.

### When a figure may show
- **D-04:** Annualised figures (CAGR, Sharpe, Sortino, Calmar, annualised vol) are WITHHELD with a stated reason under 90 days of record (the existing `MIN_ANNUALIZATION_DAYS`). From 90 days to one year they show with a short-track note, and from one year on they show plain. The same rule applies on every page. (Founder: "Hide <90d, qualify 90d-1y".)
  - ⛔ **Superseded by D-15 (2026-11-07) where it gates on window length.** A selected range, a blend window, a rolling window, an overlap or a half under 90 days no longer withholds; only the strategy's TOTAL record under D-15's minimum does. The 90-day calendar bound survives as D-15's crypto bound, and the one-year note survives. The text above is kept as lineage.
- **D-05:** Implausible values are SHOWN and NOT flagged: no plausibility bound, no withholding, no warning badge. (Founder 2026-11-07: "Show don't flag", choosing against the recommendation to withhold above +1,000% or at/below −100%.) Only D-04 and genuine nulls withhold a figure.

### Labels and rows
- **D-06:** The tearsheet's "Minimum Allocation" row (it prints AUM today, `src/app/factsheet/[id]/tearsheet/page.tsx` ~:657-665) is relabelled **"AUM"** and shown ONLY to signed-in users with the allocator role, plus the strategy's own manager on their own strategy. Public visitors and other managers do not see it. The "Negotiable" fallback goes. (Founder: "We need to show AUM somewhere. So just label it. It should be only shown to the actual allocator", clarified as "Signed-in allocators only".)
- **D-07:** The hard-coded "Lockup: None (read-only API)" row is removed. (Founder: "Remove it".)
- **D-08:** Equity and exposure labels name the quantity: "Book equity", "Modelled equity", "Gross exposure", "Net exposure". The numbers are not merged or dropped; only the ambiguity goes. (Founder: "Name the quantity in each label".)
- **D-09:** In lists (discovery `StrategyTable.tsx` ~:506, :518-529, My Strategies, and any other sortable/filterable metric list), a missing figure shows as withheld, sorts LAST in both directions, and never matches a range filter. The list states how many rows a filter excluded for missing data. (Founder: "Missing sorts last, never matches a filter".)

### Founder answers after planning round 2 (2026-11-07)
- **D-10 (phase split):** Founder: "194 + new 194.1 sweep (Recommended)". 194 keeps the pages its plans already cover (My Strategies/discovery, factsheet, tearsheet, Scenario, Holdings, browse strategy page, Compare). The other pages in `194-ANNUALISED-CENSUS.md` (B1-B13, admin included) go to Phase 194.1 "D-04 sweep".
- **D-11 (D-04 widened):** Founder chose all four: "Sharpe deltas / lifts", "Alpha, tracking error, info ratio", "Peer percentile ranks", "Rolling-window charts". This goes **beyond D-04's five-figure list** (CAGR, Sharpe, Sortino, Calmar, annualised vol) and beyond the recommendation, which had left peer ranks and rolling charts out. The same 90-day / 1-year thresholds apply:
  - **Deltas / lifts** (e.g. Sharpe lift, change in Sharpe): gated on the shorter of the spans of the figures they compare. Under 90 days withheld; 90 days to 1 year shown with the short-track note.
  - **Alpha, tracking error, information ratio:** gated on the overlapping span of the strategy and its benchmark, same thresholds.
  - **Peer percentile ranks:** a rank of an annualised figure is withheld when that figure is withheld for this strategy (under 90 days) and carries the short-track marker from 90 days to 1 year. A strategy whose figure is withheld is also left out of the peer set it is ranked against.
  - **Rolling-window charts:** a rolling annualised series (e.g. rolling Sharpe/volatility) is drawn only when its window is at least 90 days. A 90-day-to-1-year window is drawn with the short-track note on the chart. A chart whose window is under 90 days, or a record shorter than one window, shows the withheld reason in place of the series. Points before the first full window are never drawn.
  - ⛔ **Superseded by D-15 (2026-11-07) wherever the four kinds above gate on a window's or an overlap's length.** Each kind is now withheld only when the TOTAL record (for a delta, either compared record) is under D-15's minimum. Above it every window, overlap and rank shows, with the one muted note when its window is under one year. Unchanged: points before the first full window are never drawn, a record shorter than one full window still has no series to draw, and a strategy whose figure is withheld is left out of the peer set. The text above is kept as lineage.
- **D-12 (admin):** Founder: "Admin gets the rule, no AUM". Admin pages follow the D-04/D-11 rule. An admin who is neither an allocator nor the strategy's own manager does NOT see the tearsheet AUM row (D-06 read literally).
- **D-13 (warning style):** Founder: "One muted note (Recommended)". UI-SPEC assumption A-3 stands: the factsheet's three amber short-record warnings become one muted note with no glyph. **Confirmed 2026-11-07:** founder chose "Confirm planner's split (Recommended)": the Bootstrap and StyleDrift short-record warnings become muted; the Calmar-by-year warning stays amber.
- **D-14 (one-year rolling window, 2026-11-07):** Founder chose "Add a 365-day window" (the option read: "Adds a 1-year rolling window that can show without the note. Adds analytics work and a recompute to 194."). Rolling charts gain a 365-calendar-day window that, under D-11, is drawn without the short-track note once the record covers it. The existing shorter windows keep D-11's rule. This adds analytics work and widens Phase 194's recompute (plan 09).
- **D-15 (total-record gate, 2026-11-07) — FOUNDER-DECIDED (typed by the founder in chat on 2026-11-07, then confirmed by AskUserQuestion; not a planner inference):** Founder, verbatim: "if someone shortens the timeframe, and thus zooms in, then we show even for the shortest timeframe, so less than three months sharpe and all other KPIs. Only if in total, there is less than three months (around 60 days for non crypto & 90 days for crypto) do we not show the KPIs. Otherwise, if a client zooms in, then he wants the KPIs on shorter timeframes, and is aware that they are less stable. it is the client who essentially wants to evaluate his own timeframes for drift". Follow-up (AskUserQuestion): the founder chose "Keep the muted note (Recommended)", whose option text read: "Figures show for every window; windows under 1 year carry the single muted note. Mirrors your 'One muted note' decision." (Both answers relayed to the planner by the plan-phase orchestrator on 2026-11-07.) What the plans pin:
  - The withhold gate is the strategy's TOTAL track record, never the selected window. Below the minimum, every annualised figure is withheld with the reason shown.
  - The minimum: **crypto, 90 calendar days** from the first to the last return date (the existing `MIN_ANNUALIZATION_DAYS`); **non-crypto, 60 return observations** (trading days, `MIN_ANNUALIZATION_OBS`). Crypto vs non-crypto follows the house annualisation convention (`annualizationPeriods`: crypto 365, everything else 252). **A blend counts as crypto if any leg is crypto** (`blendPeriodsPerYear`).
  - Above the minimum, every window, zoom, overlap, half and rolling window shows Sharpe and every other KPI, even under three months. A figure whose window is under one year (365 calendar days) carries the single muted note of D-13; a window of one year or more shows plain.
  - Rolling charts and peer ranks follow the same rule: withheld only when the total record is under the minimum. A short rolling window (the 30-row one) is drawn, with the note. D-14's 365-day window stays and shows without the note.
  - D-04's and D-11's window-length gating is superseded (marked at each). D-05, D-13 and D-14 are unchanged.

### D-16 Benchmark column on a zoom follows D-15 (FOUNDER-DECIDED 2026-11-07, review WR-01)
- Founder answer: "D-15 wins". The factsheet benchmark column (BTC / S&P 500) shows CAGR, volatility, Sharpe, Sortino and Calmar on any zoom, with the same muted under-1y note as the strategy column. Phase 170.6 D-07's 90-day overlap gate on the benchmark summary is superseded.

### D-17 A stored KPI always has its return series (FOUNDER-DECIDED 2026-11-07, review SFH-M1)
- Founder answer: "Always Store Return Series". The fix for an unmeasurable record (stored KPIs, no return series) is at the producer: every analytics write that stores annualised KPIs also stores the return series they were computed from, so the gate's unknown state does not arise from a missing series. Existing rows are repaired by plan 09's recompute. The gate's "null" (unknown) state is not reinterpreted as withheld.

### D-18 Short records leave the annualised peer ranks only (FOUNDER-DECIDED 2026-11-07, review WR-02)
- Founder answer: "Annualised ranks only". In SQL (get_verified_cohort_rank) and TS (percentile-core) alike, a record under the D-15 minimum leaves the Sharpe and Sortino peer sets and stays in the Max drawdown set.

### D-19 The benchmark column follows the strategy's total-record verdict (FOUNDER-DECIDED 2026-11-07, fix round 1)
- Founder answer: "Yes, follow the strategy". When the strategy's TOTAL record is under the D-15 minimum, the factsheet benchmark column's annualised cells (CAGR, volatility, Sharpe, Sortino, Calmar) are withheld with the same reason. Above the minimum, D-16 holds: every zoom shows them with the muted under-1y note.

### D-20 A record's length counts the days its returns cover (FOUNDER-DECIDED 2026-11-08, review WR-05)
- Founder answer: "Count returns". One year of daily returns is a full year: 365 daily returns are 365 days of record, so no under-1y note. The record length counts the period the returns cover (each daily return covers one day), not the first-to-last calendar gap, which reads one day short. This changes the ONE shared span definition, so every surface (TS figure-gate, the Python producer verdicts, the SQL peer-rank flag) moves together, and parity tests pin them equal. The D-15 thresholds (90 days crypto, 60 observations non-crypto, 365 for the note) are unchanged; only how the days are counted changes.

### D-21 The 1-year rolling window uses the D-20 count (FOUNDER-DECIDED 2026-11-08, fix H follow-up)
- Founder answer: "Same count". A 1-year (365-day calendar) rolling window fills once the returns it holds cover 365 days by the D-20 count, so a record of exactly 365 daily returns draws its first 1-year rolling point, matching its full-year KPIs. The TS rolling window (src/lib/rolling.ts, rollingCalendarStats / rolling1y) and its Python twin change together, pinned by their parity tests.

### D-22 AUM follows D-06 on the public factsheet too (FOUNDER-DECIDED 2026-11-08, security audit O-2)
- Founder answer: "Gate both in 194". The v2 factsheet's AUM chip (CapacityChip in the FactsheetView header) and the factsheet JSON-LD (`feesAndCommissionsSpecification: "AUM …"` in src/lib/factsheet/json-ld.ts) show AUM only to an allocator or the strategy's own manager, the same rule as the tearsheet AUM row (tearsheet/page.tsx `showAum`). Anyone else, including an anonymous visitor and a search engine, sees no AUM. The decision is per viewer, so it must not leak through a payload cached across viewers.

### Claude's Discretion
- The parity test's shape (D-01) and the wording of the withheld reasons and the short-track note (D-04), within DESIGN.md's voice.
- Whether the D-02 change to the stored metric needs a PROD recompute inside this phase or a booked follow-up. If a recompute is run, it goes through the product's own recompute path, and PROD writes need the orchestrator to ask the founder first.

</decisions>

<canonical_refs>
## Canonical References

- `.planning/ROADMAP.md` § "Phase 194: FIGURETRUTH" — goal, success criteria, evidence at HEAD
- `.planning/REQUIREMENTS.md` — TRUST-04, TRUST-05
- `DESIGN.md` — dated-document principle, data density
- `.planning/phases/193-quietview-viewing-a-strategy-changes-nothing-and-shows-only/193-CONTEXT.md` — session-local range and the "Selected range" label (D-01 relies on it)
- `.planning/phases/195-trim-leftover-and-duplicate-surfaces-are-gone/195-CONTEXT.md` (branch feat/195-trim, running in parallel) — removes the density toggle in `StrategyTable.tsx` and dark mode in `FactsheetView.tsx`; expect overlap
- `CLAUDE.md` house rules (in MEMORY): risk annualizes by frequency (crypto 365, traditional 252), returns by calendar, blends use 365 if any leg is crypto; uncomputable metrics are null; freshness = `strategy_analytics.computed_at`
- `TODOS.md` `[164.6.6.3.3-WAVE5-RECOMPUTE]` and the items deferred at `TODOS.md` ~:1636 (out of scope here)

</canonical_refs>

<code_context>
## Existing Code Insights

- Three engines: stored (`analytics-service/services/metrics.py`, read by My Strategies/discovery, tearsheet, Holdings), factsheet browser (`src/lib/factsheet/compute.ts`), Scenario (`src/lib/scenario.ts`).
- `MIN_ANNUALIZATION_DAYS` already exists; reuse it for D-04.
- PROD read 2026-11-07 (read-only aggregates, marker first): 18 complete analytics rows. 12 have fewer than 365 points in their stored return series, including all 3 published strategies, and 11 of those show a Sharpe. No stored cumulative return is exactly 0 or null, so the "0.00% in lists" seen in review is not a stored zero; the per-page reading SC-1 asks for is still owed.
- Overlap: 194 should keep factsheet edits in `MetricsColumn.tsx` and the read helpers, and land after 195 where both touch `StrategyTable.tsx`.

</code_context>

<specifics>
## Specific Ideas

- Scout notes with file:line evidence: kept outside the repo (not tracked); the planner/researcher re-measures at HEAD.

</specifics>

<deferred>
## Deferred Ideas

- A plausibility bound (withholding values above +1,000% or at/below −100%) was offered and declined (D-05).

</deferred>

---

*Phase: 194-figuretruth*
*Context gathered: 2026-11-07*

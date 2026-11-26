# Phase 252: DERIBITOPTIONS - Research

**Researched:** 2026-11-25
**Domain:** Honest-figure gating across a Next.js (non-standard version) read path plus a Python analytics worker; Deribit options accounting
**Confidence:** HIGH on the verdict/read-path/OG/list-shaper/Compare design (read in full); MEDIUM on the long tail of surfaces (rows 6, 12-15 read at select/grep level) and on the blast radius (census by trigger not yet run); LOW-MEDIUM on wave 2 outcome (founder-gated worker run)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
### Remedy (founder ruling)
- FOUNDER RULING, 2026-11-25 (AskUserQuestion via the coordinator), verbatim answer "Withhold first, then MTM (Recommended)". The option text chosen, verbatim: "Ship now: withhold the headline of a Deribit options book whose figure comes from the cash wallet, with the reason named on every surface (factsheet, share card, Compare, Discovery). The trigger is the existing 'unsmoothed options book' flag, not a size threshold. This extends D-05, so you'd be accepting a new named withhold, like you did for 233 today. Then measure market-price valuation and switch the headline to it only if it actually works for these keys." — **Reversibility:** costly — it changes what published surfaces show for a class of strategies and extends a founder decision.
- This EXTENDS Phase 194 D-05. D-05 read "Implausible values are SHOWN and NOT flagged ... Only D-04 and genuine nulls withhold a figure." The founder accepts one more named withhold: a Deribit options book measured on the cash wallet. It is a structural, non-numeric trigger. It is not a plausibility bound, and no criterion in this phase applies a magnitude threshold. The KPI-gate ruling (withhold KPIs only under about 3 months of total record) is unchanged and still applies on its own.

### Wave 1: the named withhold
- Trigger: `strategy_analytics.data_quality_flags.mtm_gated_reason === "unsmoothed_options_book"` (strict string equality), read on a row whose headline is the cash-settlement basis. Today only the composite stitch produces that value (`stitch_composite.py` `MTM_REASON_OPTIONS`, via `mark_to_market_available`). — **Reversibility:** costly — every surface keys off it.
- The withhold NEVER fires on `twr_chain_broken` alone and NEVER on an MT5 row. Other `mtm_gated_reason` values (`mtm_basis_unavailable_for_venue`, `mtm_summary_coverage_incomplete`, the second-pass timeout and uncomputable reasons) do not trigger it. A test pins each of these negatives.
- Surfaces: the factsheet headline and KPIs, the share card and OG image, Compare, and Discovery (grid, table and ranking), plus every other surface that already honours the headline verdict or the D-15 withhold for the same stored scalars. They agree for the same row, and the reason is named on each one.
- The withhold applies to the headline figures measured on the cash wallet: cumulative return, CAGR and the ratios derived from the stored cash scalars. Where a non-cash basis series (MTM or smoothed) is actually stored and shown behind the basis toggle, it is not withheld by this rule.

### Wave 2: market-price valuation, measured first
- Measure before promoting. The first wave-2 plan measures whether the existing smoothed mark-to-market reconstruction computes for these keys (no missing daily option marks on held days, no `LedgerValuationError`) and what it produces. The headline switches to it only if the measurement passes criteria the plan states in advance. If it does not pass, the withhold stays and the result is recorded.
- The measurement is read-only. A run that needs the keys' credentials, so it runs in the worker, is a founder-gated step, as R11 was in the debug session.

### DEF-142.2-07
- The census was re-run on PROD at HEAD on 2026-11-25 (marker query first, read-only). Deribit strategy rows carrying `twr_chain_broken`: 2 total, 0 published. Both are private composites stamped `composite_stitched` with `mtm_gated_reason = unsmoothed_options_book`. Deribit rows stamped `ledger_complete` with a broken chain (the entry's own subject): 0. PROD has no single-key Deribit strategy. All venues: 6 rows (2 Deribit, 4 MT5), all private. The planner decides whether the ship closes and deletes the entry or rewrites it with these numbers, and says which.

### Decided autonomously
- [Wave 1] Q: "Where does the withhold decision live?" → Selected: "One TS owner beside the existing headline verdict in `src/lib/factsheet/headline-basis.ts`, read by every surface; Python needs no change for wave 1 because the composite already stamps the flag" — internal code location, cheap to move.
- [Wave 1] Q: "Does wave 1 need a re-derive?" → Selected: "No backfill UPDATE, ever. The trigger is already stored on both affected rows; after deploy, re-stitch them through the product's own job only if the planner finds a stored value the read path needs that is missing" — the re-stitch path exists and is repeatable.
- [Wave 1] Q: "How is SC-2's RED fixture built?" → Selected: "A fixture with the debug session's wallet shape 0.311 → 0.1605 → 0.165 → 0.528 on an options member goes RED on today's code (its headline reaches a surface) and GREEN after (withheld with the named reason)" — test-only.
- [Ship] Q: "One PR or two?" → Selected: "Wave 1 ships in the phase PR. Wave 2's measurement tooling ships with it if it is ready; the founder-gated measurement run and any promotion follow the measurement" — release sequencing, cheap to change.

### Claude's Discretion
- The public wording of the withheld reason follows the existing withheld-headline sentences and DESIGN.md, with no flag names or job vocabulary. It is user-facing copy, so the founder sees it at the visual check.

### Deferred Ideas (OUT OF SCOPE)
- A single-key Deribit options strategy whose MTM second pass succeeds still headlines on cash and carries no `unsmoothed_options_book`. PROD has none today. Wave 2's promotion, or a follow-up phase, owns it if one appears.
- Deribit allocator books in key mode: Phase 233 DERIBITTRUTH.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs are mapped (routed from debug session `deribit-implausible-returns` mechanism B and TODOS `DEF-142.2-07`). The ROADMAP success criteria stand in:

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | Remedy recorded citing D-05 and the KPI-gate ruling, no numeric bound | Founder ruling in CONTEXT; this file's gate design is purely structural (strict string equality) |
| SC-2 | Option buy + later close yields equity-reflecting returns OR a named withhold every surface honours; 0.311 -> 0.1605 -> 0.165 -> 0.528 fixture RED on today's code | Q4 fixtures; surface inventory (Q1); one predicate (Q2) |
| SC-3 | Quantum Drift owner factsheet shows MTM figures or a named withhold, never cash cumulative/CAGR/Calmar; surfaces agree | Evidence row is verdict `dated` today; new cause beats `dated` (Pitfall 1) |
| SC-4 | DEF-142.2-07 census re-run, entry closed+deleted or rewritten | Q6 |
| SC-5 | Every Deribit strategy whose published figures move is re-derived and listed in CHANGELOG; no MT5 figure moves | Q8 section. Wave 1 is read-side only (no re-derive, no stored value moves). Which published rows carry the trigger is `[ASSUMED]` pending the count by `mtm_gated_reason` (Open Question 0) |
| SC-6 | PROOF-01 RED/GREEN per gate; migration (if any) through migration-reviewer + rls-policy-auditor | Validation Architecture |
</phase_requirements>

## Summary

The evidence strategy is a COMPOSITE, so wave 1 is a read-side change: the producer already stamps the trigger on both affected rows. `mark_to_market_available` returns `(False, MTM_REASON_OPTIONS)` for any member with option activity, and `run_stitch_composite_job` persists it when `not mtm_ok`. [VERIFIED: analytics-service/services/stitch_composite.py:101 `MTM_REASON_OPTIONS = "unsmoothed_options_book"`; analytics-service/services/job_worker.py:14493 `merged_flags["mtm_gated_reason"] = mtm_reason`]. Nothing on the TS side withholds such a row today because the verdict `headlineVerdict` returns `clean` unless `twr_chain_broken === true`, and then `dated` when `headline_since` exists [VERIFIED: src/lib/factsheet/headline-basis.ts:167-177].

The recommended design is ONE pure predicate in `headline-basis.ts` (`isOptionsCashWalletBook(flags)`, strict `=== "unsmoothed_options_book"`), consumed through three seams that together cover every surface: (1) `headlineVerdict` gains a fourth `HeadlineWithholdCause` (`options_cash_wallet`), evaluated BEFORE the chain-broken checks and independent of the gate, which covers the factsheet read path (composite and single-key arms), the share/OG card, the PDF route that goes through the payload (`/api/factsheet/[id]/pdf`), json-ld and the rail panels; (2) `shapeRowAnalytics` gets one new blanking arm plus a one-field marker so every Discovery/owner-list/detail-fetcher row agrees and can name the reason; (3) `figureRecord` gets an optional marker that makes `recordClears` false, so the 28 non-test files that call `gateAnnualized` and the percentile peer sets withhold annualized figures with a named sentence. Compare shapes its own rows and needs its own alias pair. Everything keys off the same string, and a completeness census test (below) is what makes "surfaces agree" falsifiable rather than assumed.

Wave 2 is the harder half and its outcome is unknown. Phase 185 measured the same smoothed options basis on PROD Deribit keys in key mode, and the founder accepted a FAIL reading of its SC-4: days above 50% fell from 6 to 2, two days remained, one key stayed on cash with a caveat, and the cumulative did not come down [CITED: `git show dfedac44d`, text "CORRECTED 2026-11-03 (D-14)"]. Whether those keys are the two composites' member keys is unknown (A2), so treat 185 as a prior, not a prediction. The composite path was not touched by 185 (its members run `build_deribit_native_ledger(pnl_basis=basis)` with cash as the headline), and its smoothed third pass sits behind the dark `SMOOTHED_MTM_ENABLED` switch [VERIFIED: analytics-service/services/job_worker.py:14117 `smoothed_ok = is_smoothed_mtm_enabled() and smoothed_mtm_available(member_signals)`]. The measurement can reuse the existing assertions rather than invent bounds.

**Blast radius is NOT yet measured (retag).** CONTEXT's census counted rows carrying `twr_chain_broken` (2 Deribit rows, both stamped `unsmoothed_options_book`). The trigger is `mtm_gated_reason`, which a composite stamps whenever any member has option activity, chain intact or not [VERIFIED: job_worker.py:14493 inside `if not mtm_ok and mtm_reason is not None:`]. So "how many rows, published or not, carry the trigger" is `[ASSUMED]` until the orchestrator runs a count by `mtm_gated_reason` (Open Question 0).

**Primary recommendation:** Ship wave 1 as TS-only (predicate + verdict cause + `shapeRowAnalytics` arm + `figureRecord` marker + Compare alias pair + payload cache bump), pin it with a same-row page/card parity test and a table-driven negatives test, and treat the SQL cohort RPC as a separate, founder-visible decision (migration lane). Close and delete `DEF-142.2-07`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Stamp `mtm_gated_reason` | Python worker (`run_stitch_composite_job`) | — | Already done; wave 1 changes nothing here |
| Decide "headline is withheld, and why" | Pure TS module `headline-basis.ts` | — | Client-safe, shared by RSC read path, OG route, lists |
| Redact stored scalars on the factsheet | RSC read path (`composite-read-path.ts`) | `build-payload.ts` | Existing Withheld machinery nulls 7 scalars + 7 windows |
| Blank list/Discovery cells | Server query shaping (`queries.ts shapeRowAnalytics`) | Client cells read a marker | One shaper feeds Discovery, owner list, detail fetchers |
| Annualized-figure gating on 28 files | `figure-gate.ts` (`figureRecord` marker) | — | Existing D-15 owner; marker makes `recordClears` false |
| Compare columns | Server page (`compare/page.tsx`) shapes its own rows | `CompareTable` | Compare does not use `shapeRowAnalytics` |
| Cohort rank population | Postgres RPC `get_verified_cohort_rank` | TS `getPercentiles` | Migration-bound; see Open Question 1 |
| Wave 2 measurement | Railway worker (decrypted keys) | Local pure tests | R11 precedent; founder-gated |

## Standard Stack

No new packages. Wave 1 and wave 2 use only what the repo already ships. [VERIFIED: no dependency named in any plan-relevant file; all symbols are in-repo]

### Core (existing, reused)
| Module | Role | Why |
|--------|------|-----|
| `src/lib/factsheet/headline-basis.ts` | The one verdict owner (`readHeadlineBasis`, `headlineVerdict`, `HeadlineWithholdCause`, `storedCashHeadlineGate`) | Locked decision: one TS owner here |
| `src/lib/figure-gate.ts` | D-15 gate (`figureRecord`, `recordClears`, `gateAnnualized`, `withheldReason`, `withheldCellTitle`) | Already read by the annualized-figure sites |
| `src/lib/stored-analytics-result.ts` `effectiveDataQualityFlags` | Picks live flags vs the `last_success_snapshot` flags bound to `computed_at` | Every surface must read the SAME generation of flags |
| `analytics-service/tests/fixtures/deribit_option_round_trip.py` | Shared option round-trip ledger pair | Cash returns -0.4839, +0.0280, +3.3339; options basis 0.0000, +0.1740, +0.9586 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `HeadlineWithholdCause` | Overload `twr_chain_broken: true` in the payload | Rejected: would print "earlier history is unreliable (it includes ...)" and "Measured since" text that is false for an intact chain |
| Re-stitch/backfill to stamp anything | — | Not needed: both rows already carry the trigger; backfill UPDATE is banned |

**Installation:** none. **Package Legitimacy Audit:** not applicable, no external package is installed by this phase.

## Architecture Patterns

### System Architecture Diagram

```
Python worker (unchanged in wave 1)
  run_stitch_composite_job
    member option activity -> mark_to_market_available -> (False, "unsmoothed_options_book")
    merged_flags["mtm_gated_reason"] persisted in strategy_analytics.data_quality_flags
                |
                v   (stored flags; viewer-independent)
 effectiveDataQualityFlags(row)  -> flags generation (live | last_success snapshot)
                |
                v
 isOptionsCashWalletBook(flags)   <-- THE ONE PREDICATE (strict ===, pure, client-safe)
     |                 |                         |                       |
     v                 v                         v                       v
 headlineVerdict   shapeRowAnalytics        figureRecord(marker)    Compare page shaping
 cause=options_    blank + marker           recordClears=false      alias pair -> marker
 cash_wallet       on the shaped row        withheldReason names it
     |                 |                         |                       |
     v                 v                         v                       v
 factsheet page   Discovery grid/table/     28 gateAnnualized      CompareTable,
 (composite+      owner list/detail         sites + percentile      overlay
 single-key),     fetchers/metadata         peer sets (TS)
 OG card, PDFs
```

### Surface inventory (Question 1)

"Flags available?" says whether the surface already receives `data_quality_flags`, or a flags alias, or neither. Every list projection is an explicit allowlist: it never ships the whole blob (privacy rule), so a new scalar alias is the minimal change. A PostgREST alias in an embedded select needs NO migration or view change (it is a request-time JSON path), but the pinned projection tests must move.

| # | Surface | Reads | Flags available today? | Minimal change |
|---|---------|-------|------------------------|----------------|
| 1 | Factsheet page, composite arm (`readCompositeFactsheet`, `applyHeadlineBasis` at composite-read-path.ts:430) | stored `cash_settlement` scalars | Yes: `dqf` = effective flags (`fetch-and-build-payload.ts` passes `effectiveFlags.flags`) | `headlineVerdict` new cause; `applyHeadlineBasis` stops hard-coding `twrChainBroken: true` |
| 2 | Factsheet page, single-key arm (`readSingleKeyBasisOpts`, composite-read-path.ts:904) | stored scalars | Yes (`dqf`) | Same verdict. ALSO the `else if (dqf?.twr_chain_broken === true)` branch at :1033 must learn the new trigger, or an options row with a non-applicable gate computes whole-record figures |
| 3 | Factsheet rail panels, KPI strip, Main Metrics, benchmark cells (`MetricsColumn.tsx`, `build-payload.ts`) | `payload.dataQuality` | Via payload | Drop the `twrChainBroken === true &&` coupling at MetricsColumn.tsx:100, 125, 236, 272 and build-payload.ts:905; new sentences per cause |
| 4 | OG image / share card (`og-metrics.ts computeOgHeadline`) | stored sharpe/cagr/max_dd | Yes: calls `headlineVerdict(effectiveDataQualityFlags(persisted).flags, gate, status)` | None beyond the verdict (card prints NaN for every cause) |
| 5 | Factsheet public/share (`factsheet-share/[token]`, `discovery/[slug]/[id]`, `/api/factsheet/[id]/pdf`) | `buildFactsheetPayloadCached` | Via the same resolve stage | None beyond #1/#2, but bump the payload cache key (Pitfall 3) |
| 6 | `/api/factsheet/[id]/tearsheet.pdf` | selects `cumulative_return, daily_returns, returns_series, data_quality_flags` and computes metrics from the series | Yes (blob selected) | Needs its own predicate call: it has NO chain-broken handling today. Read its route before planning the refusal shape |
| 7 | json-ld (`json-ld.ts`) | `payload.strategyMetrics.cagr`, `payload.figureRecord` | Via payload | Covered by the redacted payload (NaN cagr returns undefined) |
| 8 | Discovery grid/table/ranking, `/strategies` owner list, `getMyStrategies`, detail fetchers (metadata, tearsheet page) | `shapeRowAnalytics` over `CATEGORY_RANKING_ANALYTICS_COLUMNS` | NOT projected (anon list ships scalar aliases only) | Add `mtm_gated_reason:data_quality_flags->>mtm_gated_reason` and `last_success_mtm_gated_reason:data_quality_flags->last_success_snapshot->flags->>mtm_gated_reason`; new arm in `shapeRowAnalytics`; drop the `last_success_*` alias after use like the others |
| 9 | Compare (`compare/page.tsx`, `CompareEquityOverlay`, `CompareTable`) | own shaping over `COMPARE_ANALYTICS_COLUMNS`, composes over `EMPTY_ANALYTICS`, does NOT call `shapeRowAnalytics` | NOT projected | Same alias pair appended in the page select (the file already appends `record_observations` there) plus the effective-generation pick (`usesLastSuccessSnapshot`) the page already does for `twr_chain_broken`; blank figures + marker; the overlay must also stop drawing the curve |
| 10 | Percentile ranks (`getPercentiles`, `getOwnRowPercentiles`, `percentile-core withholdShortRecordRanks`) | `PERCENTILE_SPAN_COLUMNS` aliases | NOT projected | Fifth alias in `PERCENTILE_SPAN_COLUMNS`. PRESCRIPTIVE: a flagged row is skipped entirely before `rows.push` (the same place `isRankableAnalyticsRow` drops a non-computed row), so it leaves EVERY peer set and receives no rank. Do not rely on the marker through `withholdShortRecordRanks`: it nulls only the five annualized metrics, and D-18's reason for leaving max drawdown in (it is not annualised) does not hold here, because max drawdown and cumulative return of this row are themselves cash-wallet artefacts |
| 11 | SQL RPC `get_verified_cohort_rank` | `strategy_analytics` rows of the published universe | n/a (SQL) | MIGRATION. See Open Question 1 |
| 12 | Allocations portfolio constituents (`queries.ts` ~6068 select: `daily_returns, cagr, sharpe, volatility, max_drawdown, data_quality_flags, returns_series, computation_status, cumulative_return, computed_at, record_observations`; `allocations/lib/constituent-figure.ts`, `book-figures.ts`) | `constituent-figure.ts` builds a record and calls `gateAnnualized` only [VERIFIED: constituent-figure.ts:96 `return { figureState: gateAnnualized(record), figureRecord: record };`] | Yes (blob selected) | Marker covers the annualized figures only. `cumulative_return`, `max_drawdown` and the series of a flagged constituent need a per-file decision (see the completeness census below). Blends and scenarios consume each leg's `returns_series` / `daily_returns` (`scenario-adapter.ts`); a flagged leg inside a blend feeds the artefact into blend figures. Not resolved here: Open Question 7 |
| 13 | `recommendations/page.tsx` (selects the blob plus `RECORD_SCALAR_ALIASES`, `cumulative_return`), `admin/page.tsx` (aliases + `cagr, sharpe, max_drawdown`), `AdminTabs`, `CandidateDetail`, `admin/intros` | marker for annualized; cumulative and max drawdown ungated | recommendations: blob; admin: aliases only | Fifth alias; marker; plus per-file blanking of `cumulative_return` / `max_drawdown` through the predicate. Grep-level evidence only: the planner reads each file's select and printed scalars before tasking |
| 14 | Wizard `SyncPreviewStep.tsx` (owner onboarding preview) | `cumulative_return`, `cagr`, ..., `metrics_json_by_basis`, `data_quality_flags` | Yes (blob; reads `dq.mtm_gated_reason` at :1866) | Predicate call; it already prints the raw flag name in a test-pinned string ("Mark-to-market view unavailable — unsmoothed_options_book"), a pre-existing flag-name leak to the owner. Decide in or out (Open Question 4) |
| 15 | `intro/snapshot.ts`, `HoldingFactsheet.tsx`, `PeerRanksSection.tsx`, `comparator-block.ts` | record via `figureRecord` | via marker | Covered by the marker where records are built from the extended aliases; verify each builds its record through `recordFromScalars`/`figureRecord` |

Provenance: sites enumerated by grep of `gateAnnualized(`, `strategy_analytics (` selects, `headlineVerdict`/`readHeadlineBasis`/`storedCashHeadlineGate` users and `data_quality_flags` users this session. `gateAnnualized(` appears in 28 non-test files, `figure-gate.ts` itself included [VERIFIED: `grep -rl "gateAnnualized(" src` minus tests, count 28]. Rows 6, 12, 13, 14, 15 were read only at select/grep level; rows 1-5, 8-10 were read in full.

**What the marker does NOT cover, and the mechanism that closes it.** The `figureRecord` marker withholds annualized figures (CAGR, volatility, Sharpe, Sortino, Calmar) and widened kinds. It does not touch `cumulative_return`, `max_drawdown`, sparklines or series-derived figures, which `figure-gate` never gated. Rather than trust a hand list, prescribe a completeness census test modelled on `figure-gate-census.test.ts` (comment-stripped scan, typed oracle independent of production constants): every non-test file under `src/` that selects `strategy_analytics` scalars or `data_quality_flags` must import the predicate module (or `shapeRowAnalytics`), or sit in an `EXCLUDED` map under a closed reason set (`label only`, `gated upstream: <path>` where the target itself imports the predicate, `owner-only, decided: <ruling>`). That test is what makes "every surface agrees" falsifiable, and it makes a surface this research under-read fail loudly instead of shipping the artefact.

### Recommended design (Question 2)

**Choice: one predicate, two integration points, NOT a second independent decision.**

1. `headline-basis.ts` exports the constant and predicate:
   ```ts
   // The flag value stamped by stitch_composite.py MTM_REASON_OPTIONS (pinned by a vitest, Validation Architecture).
   export const OPTIONS_CASH_WALLET_REASON = "unsmoothed_options_book" as const;
   export function isOptionsCashWalletBook(dqf: unknown): boolean {
     const flags = dqf !== null && typeof dqf === "object" && !Array.isArray(dqf) ? (dqf as Record<string, unknown>) : null;
     return flags !== null && flags.mtm_gated_reason === OPTIONS_CASH_WALLET_REASON; // strict, no trim, no case fold
   }
   ```
2. `HeadlineWithholdCause` gains `"options_cash_wallet"`; `headlineVerdict` tests it FIRST, before `readHeadlineBasis` and before the `gate.applicable` test, returning `{ kind: "withheld", cause: "options_cash_wallet" }`. Reason for FIRST and gate-independent: when the stored headline is not applicable (row computing/failed/missing keys) the page computes whole-record figures from the cash series, which is the artefact itself. The evidence row (`twr_chain_broken` + valid `headline_since`) is `dated` today; the new cause must beat `dated`.
3. `figureRecord({... , withheldBy?: "options_cash_wallet"})` sets a marker on `FigureRecord` that `recordClears` reads (false, like `unreadable`), and `withheldReason` / `withheldCellTitle` / `widenedWithheldReason` get a branch that names the reason instead of the record length (otherwise they print "appear once the record reaches 90 days. This record covers 122 days.", which is false). This single change covers the `gateAnnualized`, `gateDelta`, `gateRollingWindow` and `withholdShortRecordRanks` sites.
4. `shapeRowAnalytics` (queries.ts:944) gets an arm before `isRankableAnalyticsRow`: a row whose effective flags satisfy the predicate returns the same blank shape the failed arm returns (`EMPTY_ANALYTICS` + `strategy_id` + the real `computation_status` + `trades_fetched_at`) plus one new optional field on `StrategyAnalytics` (types.ts) naming the withhold, so cells can show the phrase. This is the existing "absence is the convention" pattern [VERIFIED: queries.ts comment above `shapeRowAnalytics`], and it covers cumulative return and max drawdown, which `figure-gate` never gates.

Phrase table: one compile-checked record in `headline-basis.ts` (like `GUARD_REASON_PHRASES`), `satisfies Record<..., string>`; no flag name in any string. Draft wording for the founder visual check (Claude's discretion): headline "Headline figures withheld: this strategy trades options, and its returns are measured against the cash wallet, which leaves out the market value of open option positions." Panel: "Withheld: this panel is measured against the cash wallet, which leaves out the market value of open option positions." Cell title: "Withheld: measured on the cash wallet, which leaves out open option positions." These are drafts. They follow the neighbouring withheld sentences and the "no contractions" voice stated in the `mtmDisabledReasonCopy` docblock [VERIFIED: basis-context.tsx docblock "DESIGN.md voice: factual, institutional, no contractions"]; DESIGN.md itself says only that copy "states its own limits" and that a null renders as the em dash, never 0 or blank [VERIFIED: DESIGN.md:22, :161]. **Tone, a real finding:** DESIGN.md reserves the warning amber for transient states the system will re-attempt [VERIFIED: DESIGN.md:175, "warning is reserved for transient recoverable states"]. The existing Withheld note renders amber with a warning glyph (`headlineNoteColor("withheld")`, `WITHHELD_GLYPH`), which is right for a recompute and wrong for this cause: it does not heal on its own until wave 2 promotes. The options variant should be muted (steady), the way `mtmReasonTone` classes `unsmoothed_options_book` as `"steady"` [VERIFIED: basis-context.tsx `mtmReasonTone`]. Add a tone input to `HeadlineNote` (or a variant) rather than reusing `"withheld"`. Also: the MTM toggle's disabled copy for this reason says composites with options "report cash settlement only" [VERIFIED: basis-context.tsx `mtmDisabledReasonCopy`], which will sit beside a withheld cash headline; reword it in the same change.

### Tests that pin closed sets and must move (Question 2)

| Test | Why it moves |
|------|--------------|
| `src/lib/factsheet/headline-basis.test.ts` | enumerates verdict/cause behaviour; add the new cause + precedence over `dated` |
| `src/lib/factsheet/headline-verdict.parity.test.ts` | template for the page-vs-card same-row parity; `CASES` tuple type is `"recomputing" \| "failed" \| undefined`, widen |
| `src/__tests__/recompute-verdict-census.test.ts` | pins `file::symbol` call COUNTS for `storedCashHeadlineGate(`, `effectiveDataQualityFlags(`, `isRecomputeOverStoredResult(` etc. A new caller of any of those, in any file, fails until classified. `shapeRowAnalytics` arm that calls `effectiveDataQualityFlags` raises `queries.ts` from 3 to 4 [VERIFIED: census entry `"src/lib/queries.ts::effectiveDataQualityFlags": { count: 3 ...}`]. Prefer reading flags WITHOUT adding a new call (reuse the effective-flags object already computed in `shapedNativeUnit`) or update the census row with a reason |
| `src/__tests__/figure-gate-census.test.ts` | counts files naming annualized figures vs gate imports; the new marker adds no new file if only `figure-gate.ts` and the shared alias change |
| `src/lib/figure-record-scalars.test.ts`, `src/lib/queries.test.ts`, `src/lib/queries.percentile-columns.test.ts` | pin the alias lists byte-for-byte and "only these `->>` forms": a fifth alias must be added in all three projections in the same commit |
| `src/lib/factsheet/composite-read-path.test.ts` (:1528, :1791-1800) and `composite-read-path.headline-basis.test.ts` (`(g) a clean composite's dataQuality is byte-identical to HEAD`) | existing tests give an options composite `mtm_gated_reason: "unsmoothed_options_book"`; any that assert the cash headline is KEPT now flips. Update intent, do not delete |
| `FactsheetBody.basis.test.tsx`, `FactsheetBody.smoothed-killswitch.test.tsx`, `basis-context.test.tsx` | pass `mtmGate: { available: false, reason: "unsmoothed_options_book" }` directly (payload-level); unaffected unless they also assert KPI text from a cash headline |
| `SyncPreviewStep.composite.render.test.tsx` (:1019-1089) | pins the wizard string with the raw flag name; moves only if the wizard is brought in scope |
| `page.public-cache-key` / `phase-148-owner-lane-cache-isolation` tests | pin the factsheet payload cache key; bump with the payload shape |
| `closed-sets.cohort-gate-parity.test.ts` | SQL snapshot `supabase/schema/functions/get_verified_cohort_rank.sql` vs TS; only moves if the RPC changes |

There is no existing closed-set test for the `mtm_gated_reason` vocabulary on the TS side. The seven values are copied by hand in `mtmDisabledReasonCopy` [VERIFIED: basis-context.tsx switch cases]. Add a cross-language pin (below).

### Recommended Project Structure (changes only)
```
src/lib/factsheet/headline-basis.ts      # predicate, constant, cause, phrase table
src/lib/figure-gate.ts                   # FigureRecord marker + copy branches
src/lib/queries.ts                       # alias pair, shapeRowAnalytics arm
src/lib/types.ts                         # StrategyAnalytics: marker + alias input fields
src/lib/factsheet/composite-read-path.ts # applyHeadlineBasis, :1033 branch
src/lib/factsheet/build-payload.ts       # :905 coupling
src/app/factsheet/[id]/v2/MetricsColumn.tsx, basis-context.tsx  # gates + copy
src/app/(dashboard)/compare/page.tsx, src/components/strategy/CompareEquityOverlay.tsx
analytics-service/scripts/deribit_options_smoothed_probe.py      # wave 2, new, read-only
```

### Anti-Patterns to Avoid
- **Reading `data_quality_flags` raw on a surface.** Use the effective generation (`effectiveDataQualityFlags` or the `last_success_*` alias when `usesLastSuccessSnapshot`). During a derive the live flags are replaced by a prestamp that drops `mtm_gated_reason`; a raw read un-withholds the row for minutes.
- **A second predicate per surface.** Surfaces must import the one function; the vitest source scan below fails a duplicate string compare.
- **A magnitude test anywhere** (D-05). The only input is the string.
- **Editing Phase 233's write scope** (`correction_is_trading`, `assert_correction_classifiable`, `_correction_names_instrument`, `_CORRECTION_INSTRUMENT_TOKEN_RE`, `scripts/deribit_book_oracle.py`, prober files). Wave 1 touches no Python. Wave 2 only READS `deribit_txn.py` symbols.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Which flags generation a row belongs to | A per-surface live-vs-snapshot pick | `effectiveDataQualityFlags` / `usesLastSuccessSnapshot` | Phase 190 bound the snapshot to `computed_at` |
| Redacting the seven stored scalars | A new redaction | `applyHeadlineBasis` Withheld arm (nulls every `BASIS_KPI_MAP` key) | Already pinned, including windows and benchmark cells |
| Withheld copy | Inline strings | A phrase record `satisfies Record<Cause, string>` | Compile-error on a missing phrase; keeps flag names out of public text |
| Smoothed MTM correctness bounds | New tolerances | `_assert_smoothed_book_channel`, `_assert_smoothed_summary_cross_check`, the D-07 hole guard in `option_mtm_daily` | They already raise `LedgerValuationError` (never loosen; the code says so) |
| Cash-vs-options oracle | New numbers | `tests/fixtures/deribit_option_round_trip.py` | Independent invariant: both bases reach the same cumulative on the flat-ending round trip |

## Runtime State Inventory

Not a rename or migration phase. Stored state relevant to the decision, stated explicitly:

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | The two private composites in CONTEXT's census already carry `mtm_gated_reason = unsmoothed_options_book` (CONTEXT; not re-read here). Other rows carrying it with an intact chain are unmeasured (Open Question 0) | None. No backfill. Verify on PROD after deploy that the owner factsheet reads withheld |
| Live service config | None found | None |
| OS-registered state | None found | None |
| Secrets/env vars | `SMOOTHED_MTM_ENABLED` (Railway worker env, fail-closed unless exactly `"true"`) [VERIFIED: analytics-service/services/closed_sets.py:210-212] | Wave 2 must NOT flip it for the measurement; script builds ledgers directly |
| Build artifacts / caches | Factsheet public payload cache key `factsheet-v2-payload-v27` [VERIFIED: src/app/factsheet/[id]/v2/page.tsx:345] | Bump to v28 in the same change (Pitfall 3) |

## Common Pitfalls

### Pitfall 1: The evidence row is `dated`, so a chain-broken-first design never fires
**What goes wrong:** Adding the new cause after the `twrChainBroken` and `headlineSince` checks leaves Quantum Drift on `dated` (it has `headline_since`) and a non-chain-broken options composite on `clean`.
**How to avoid:** Check the predicate first, unconditionally. Test with the exact evidence shape `{ composite: true, twr_chain_broken: true, headline_since: "2025-12-16", mtm_gated_reason: "unsmoothed_options_book" }` and with the same flags minus the two chain flags.
**Warning signs:** a test that only exercises `twr_chain_broken: true`.

### Pitfall 2: Withheld machinery is welded to `twrChainBroken`
**What goes wrong:** `isHeadlineWithheld`, `headlineCoverageNote`, `windowCoverageNote`, `headlineBenchSource` and `build-payload.ts:905` all AND with `dataQuality.twrChainBroken === true`; `applyHeadlineBasis` hard-codes `twrChainBroken: true` for every non-clean verdict. Setting the new cause without relaxing them either does nothing (panels and notes silent) or prints the chain-break sentence ("earlier history is unreliable (it includes a break in the return chain)") over an intact chain, which is false.
**How to avoid:** `quality` carries `twrChainBroken` only when the row is chain-broken; the withheld gates key on `headlineWithheld === true`; the cause picks the sentence BEFORE the reasons join. `leverageEligibleFor` (basis-context.tsx) excludes chain-broken rows because a Withheld row must not lever; it must exclude `headlineWithheld` rows too, or a single-key options row fabricates figures from the series at L != 1.

### Pitfall 3: Cached payloads keep shipping the cash headline
**What goes wrong:** The public factsheet payload is cached 1 h under a versioned key. Without a bump a v27 entry serves the artefact after deploy.
**How to avoid:** bump `factsheet-v2-payload-v27` and add the dated comment line the file keeps for every bump; the cache-key tests will fail until updated. The owner lane is cache-isolated.

### Pitfall 4: A pinned alias list fails in three places
**What goes wrong:** `RECORD_SCALAR_ALIASES`, `PERCENTILE_SPAN_COLUMNS` and `RECORD_SPAN_SELECT`'s inner list are pinned equal; `CATEGORY_RANKING_ANALYTICS_COLUMNS` and `COMPARE_ANALYTICS_COLUMNS` have exact-set pins in `queries.test.ts`. Editing one projection fails the others.
**How to avoid:** one commit changes all of them; keep the alias a `->>` text scalar (a closed vocabulary string, never the blob).

### Pitfall 5: The census test counts calls
**What goes wrong:** `recompute-verdict-census.test.ts` pins exact counts of `effectiveDataQualityFlags(` and `storedCashHeadlineGate(` per file.
**How to avoid:** reuse an already-computed effective-flags object, or add the census row with an honest reason in the same commit.

### Pitfall 6: Cross-language string drift
**What goes wrong:** the Python constant and the TS literal are hand-copied. A rename on one side silently stops the withhold.
**How to avoid:** a vitest reads `analytics-service/services/stitch_composite.py`, extracts `MTM_REASON_OPTIONS = "..."` and asserts equality with `OPTIONS_CASH_WALLET_REASON` (the repo already does this for `MIN_ANNUALIZATION_DAYS`; see `figure-gate.ts` header).

### Pitfall 7: Zoomed windows and the chart still use the cash series
**What goes wrong:** the existing Withheld pattern nulls the seven scalars, seven windows, benchmark cells and rail panels; a SELECTED RANGE is re-derived client-side from the stored cash series and shows figures, and the equity curve still draws (the legacy chain-broken Withheld row behaves the same, with the "this range may span it" note). For an options book that range figure is the artefact.
**How to avoid:** match the existing pattern for wave 1 and surface it as an explicit decision (Open Question 3); do not silently widen to the chart.

### Pitfall 8: `queries.ts` blanking drops the reason
**What goes wrong:** blanking to `EMPTY_ANALYTICS` gives em dashes with no reason, which fails "reason named on every surface".
**How to avoid:** the one new marker field on the shaped row, read by the cell title; also check `StrategyTable` health/chip logic with `computation_status: "complete"` and no series (`deriveEmptySeriesState` answers `"empty"` for a terminal status, which the table renders as a muted "No data" chip, so the withheld sentence must win over that chip).

## Code Examples

### Verdict (shape only; values from the verified type)
```ts
// headline-basis.ts. Existing today [VERIFIED: headline-basis.ts:160]:
//   export type HeadlineWithholdCause = "unmeasured" | "recomputing" | "failed";
export type HeadlineWithholdCause = "unmeasured" | "recomputing" | "failed" | "options_cash_wallet";

export function headlineVerdict(dqf: unknown, gate: StoredCashHeadlineGate, computationStatus?: unknown): HeadlineVerdict {
  if (isOptionsCashWalletBook(dqf)) return { kind: "withheld", cause: "options_cash_wallet" };
  const basis = readHeadlineBasis(dqf);
  // ...unchanged below
}
```

### Negative pin (Question 3)
The closed list of `mtm_gated_reason` values the producers can write, quoted verbatim [VERIFIED: stitch_composite.py:101, 102, 110, 119, 128, 150, 160]:
`"unsmoothed_options_book"` (the trigger), `"mtm_basis_unavailable_for_venue"`, `"mtm_summary_coverage_incomplete"`, `"mtm_series_uncomputable"`, `"mtm_second_pass_timeout"`, `"mtm_anchor_race"`, `"mtm_option_row_field_missing"`.

```ts
// Table-driven; each row runs through headlineVerdict, applyHeadlineBasis, computeOgHeadline and shapeRowAnalytics.
const NOT_TRIGGERS: Array<[string, Record<string, unknown>]> = [
  ["chain broken, dated, no mtm reason", { twr_chain_broken: true, headline_since: "2025-12-16" }],
  ["chain broken, undated (legacy withheld: cause stays unmeasured)", { twr_chain_broken: true }],
  ["venue reason on an MT5-only composite", { composite: true, mtm_gated_reason: "mtm_basis_unavailable_for_venue" }],
  ...["mtm_summary_coverage_incomplete","mtm_series_uncomputable","mtm_second_pass_timeout","mtm_anchor_race","mtm_option_row_field_missing"]
    .map((r): [string, Record<string, unknown>] => [r, { mtm_gated_reason: r }]),
  ["case variant", { mtm_gated_reason: "UNSMOOTHED_OPTIONS_BOOK" }],
  ["padded", { mtm_gated_reason: " unsmoothed_options_book" }],
  ["boolean true", { mtm_gated_reason: true }],
  ["array", { mtm_gated_reason: ["unsmoothed_options_book"] }],
  ["null / absent", { mtm_gated_reason: null }],
];
```
MT5 guarantee: the sole producer of the trigger is `mark_to_market_available`, whose `has_option_activity` is set only from the Deribit ledger (`deribit_raw_rows_have_option_activity`) and the Deribit member arm; a ccxt member appends `MemberBasisSignal(seq=seq, venue=venue, has_option_activity=False)` [VERIFIED: job_worker.py:13556; deribit_ingest.py:2753]. An MT5-only composite therefore gets the VENUE reason. A MIXED composite (Deribit options member plus any other venue) DOES get the trigger by the locked definition; say so in the CHANGELOG so it is a known scope, not a surprise. The pin for "never an MT5 row" is the table above plus a snapshot test that an MT5-shaped dqf yields byte-identical verdict, payload quality and shaped row to HEAD.

### Page vs card parity (SC-2 TS RED, Question 4)
Reuse the `headline-verdict.parity.test.ts` pattern: the same row through `readSingleKeyBasisOpts` / `readCompositeFactsheet` and `computeOgHeadline`, with a stored cash headline built from the wallet-shaped series. RED today: `p.dataQuality?.headlineWithheld` is undefined and `p.metricsByBasis.cash_settlement.cumulative_return` is the stored artefact; `computeOgHeadline(SERIES, ...)` returns finite numbers. GREEN after: `dataQuality` has `headlineWithheld: true, headlineWithheldCause: "options_cash_wallet"`, all seven scalars null, card all NaN, `shapeRowAnalytics` row blank with the marker.

Wallet-shape numbers: the debug sim returned -0.484, +0.028, +3.334 for wallet 0.311 -> 0.1605 -> 0.165 -> 0.528 with a -0.1871 withdrawal [VERIFIED: .planning/debug/deribit-implausible-returns.md "Local repro" and Evidence]. The Python fixture holds the same shape with exact figures: cash `-0.4839, +0.0280, +3.3339`, options `0.0000, +0.1740, +0.9586` [VERIFIED: analytics-service/tests/fixtures/deribit_option_round_trip.py module docstring]. For the TS side build the series from the fixture's cash returns scaled to a long record (the existing parity test builds a 400-day series; the options round trip is the first three days) so only the verdict can hide a figure (anti-vacuity: assert the whole-record series computes finite figures before asserting NaN).

Python side of SC-2: the stamping already exists and passes (test_stitch_composite_job.py:1207 `assert dq.get("mtm_gated_reason") == MTM_REASON_OPTIONS == "unsmoothed_options_book"` [VERIFIED]), so SC-2's Python half is not RED today; do not invent a RED Python test for wave 1. Reuse it as the producer half of the handshake, and add the composite test for wave 2 (promotion) against the fixture's options-basis oracle.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Key-mode Deribit books on cash wallet | Key mode builds the smoothed options basis as the key's HEADLINE when `has_option_activity is True`, with a cash fallback + caveat | Phase 185 plan 08 (merged) | The debug session's "key mode always cash" is stale for allocator keys. It is NOT true of composites, which Phase 252 covers [VERIFIED: job_worker.py:6560-6640 `_KEY_MODE_OPTIONS_BASES`, `build_deribit_options_basis_ledger`] |
| Composite smoothed pass | Dark behind `SMOOTHED_MTM_ENABLED`; persists `smoothed_mtm` by-basis key + series only when on and option-active | Phase 132-134 | PROD has never stored one (CONTEXT) |

**Phase 185 measured outcome on PROD keys:** SC-4 read FAIL, founder accepted named days: days above 50% fell 6 to 2, the +529% day is gone, two days remain on key A on the smoothed basis (2025-07-13 +62.3% from +333.6%, 2025-08-05 +64.8%), key C stays on cash with the caveat, cumulative x3516 became x3836 [CITED: `git show dfedac44d` ROADMAP/CONTEXT/185-10-SUMMARY text]. Wave 2's planner should read that commit before writing criteria, and should expect partial results.

## Wave 2 plan outline (Question 5)

**Can it run offline?** No. The build needs each member key's decrypted credentials and live Deribit reads (account summary, transaction log, `get_tradingview_chart_data` 1D candles). It runs in the Railway worker, founder-gated, exactly like R11 and `scripts/deribit_acceptance.py` (`railway ssh "cd /app && python -m scripts...."`, orchestrator-only) [VERIFIED: deribit_acceptance.py module docstring].

**Script (suggested name `analytics-service/scripts/deribit_options_smoothed_probe.py`):** read-only, no DB write, redacted output in the style of `flowtiming_dry_run.py` (ordinals, counts, ratios; ids/amounts never printed; every string through a scrub). Per Deribit member key of each composite: `fetch_deribit_native_account_state`, then `build_deribit_native_ledger(exchange, account_state=..., pnl_basis=PNL_BASIS_SMOOTHED_MTM)` and, for contrast, the cash ledger; `assert_ledger_complete`; `combine_native_ledger`. Do NOT call `run_stitch_composite_job` (it persists) and do NOT set `SMOOTHED_MTM_ENABLED` (it would flip the pass for every options book, including single-key at job_worker.py:6988).

**Existing key-mode pattern to copy:** `_KEY_MODE_OPTIONS_BASES: Final[tuple[str, ...]] = (_OPTIONS_BASIS_SMOOTHED,)` [VERIFIED: job_worker.py:1201]; key mode runs `build_deribit_options_basis_ledger` from the SAME crawl (`retain_raw_rows`) and falls back to the cash ledger with a caveat on a structural error, timeout or bucketed days.

**Pass criteria (state in the plan BEFORE the run, none numeric-bound):**
1. C1 completes with no `LedgerValuationError` or `NavReconstructionError` on every member. This already includes the cash-channel flat-at-settlement identity, the settled-book anchor check `_assert_smoothed_book_channel` and the summary cross-check `_assert_smoothed_summary_cross_check` (they run inside the smoothed assembly when `pnl_basis == PNL_BASIS_SMOOTHED_MTM` [VERIFIED: deribit_txn.py:2040-2062]). Their tolerances are the code's own; never loosen.
2. C2 every instrument held across a settlement has daily marks: `fetch_deribit_option_daily_marks` raises on a transient and the hole guard in `option_mtm_daily` raises on a structural hole; a raise is a FAIL, not a retry-until-green.
3. C3 `completeness.pre_mark_retention_option_days` is EMPTY for every day inside the span the headline would cover. Pre-retention buckets fall back to cash for those days [VERIFIED: deribit_ingest.py `_build_smoothed_option_mtm` docstring "→ cash-basis bucket"], so a non-empty set inside the headline span means the promoted headline would still contain cash-wallet days. Report the bucketed span; fail promotion for any member with bucketed days inside it (or limit the promoted span, a founder call).
4. C4 identity: the smoothed series' day P&L telescopes to terminal equity minus start minus flows through the ledger's own realized terminal (`native_ledger_realized_terminal`); report agreement as pass/fail on the code's own tolerance.
5. Report, do not gate: per member and basis, count of days with |r| above the existing `pnl_dominated_guard` trigger and the dates (ordinals) of the top days, so the founder reads what survives. This is descriptive, never a pass bound (D-05).

**Expected result:** unknown. Phase 185's partial result on PROD keys (one key stayed on cash) is a prior only, because the key mapping to these composites is unconfirmed (A2). If any member fails C1-C4, the withhold stays and the result is recorded in the plan SUMMARY (the locked decision).

**What promotion touches:** (a) Python `run_stitch_composite_job` (job_worker.py:13952-14500): when all members pass, persist the smoothed series as the composite's HEADLINE (`csv_daily_returns` + top-level scalars) the way 185 D-04 did for keys, and stop stamping `unsmoothed_options_book` on that row, or keep stamping and add a stored marker saying the headline basis is smoothed; (b) the TS predicate must then read "headline is cash" not just the flag, because today the composite stamps the reason whenever `not mtm_ok` even when `smoothed_mtm` is stored and shown behind the toggle. The locked scope line "where a non-cash basis series is actually stored and shown behind the basis toggle, it is not withheld by this rule" is satisfied by the BASIS check in `isHeadlineWithheld` (`basis === "cash_settlement"`), so wave 1 does not need the marker, but promotion does. (c) A stitch change means re-stitching the two rows through the product's job, never an UPDATE. **Collision with 233:** none by symbol. 233 owns `correction_is_trading`, `assert_correction_classifiable`, `_correction_names_instrument`, `_CORRECTION_INSTRUMENT_TOKEN_RE`, `deribit_book_oracle.py`, prober arms/workflow/wiring test, and tests `test_deribit_txn.py`, `test_deribit_book_oracle.py`. Wave 2 edits only `job_worker.py` and a new script, and reads `deribit_txn.py`. Re-check `git diff origin/gsd/phase-233-deribittruth -- analytics-service/services/job_worker.py` before the promotion plan; this research did not diff it.

## 155.2 freeze: can this move an MT5 number? (Question 8)

**Wave 1: no.** The change is read-side only. No Python is edited, no worker job runs, nothing is re-derived and no stored value (`strategy_analytics` scalars, series rows, `computed_at`) is written, so no MT5 figure, series or `computed_at` that plan 13's binding depends on can move. What can change is only what a surface RENDERS for a row whose stored flags equal the one string, and the Python producer of that string cannot be an MT5 key:
- The sole producer of `"unsmoothed_options_book"` is `mark_to_market_available`, in the composite job only; its `has_option_activity` input is set from `deribit_raw_rows_have_option_activity(raw_rows)` (`report.has_option_activity` at deribit_ingest.py:2753) and the Deribit member arm; every ccxt member appends `has_option_activity=False` [VERIFIED: job_worker.py:13556 `MemberBasisSignal(seq=seq, venue=venue, has_option_activity=False)`].
- The composite fan-out has a Deribit arm and a ccxt arm whose `else` says `# pragma: no cover — routing only ever passes the 3 ccxt venues` (binance, okx, bybit) [VERIFIED: job_worker.py:13075-13090]. I found no MT5 arm in that region (the only "MT5" mentions between :11800 and :14000 are comments). That is MEDIUM evidence, not proof: a read of the arm-selection code (`_COMPOSITE_DEGRADE_VENUES`, `closed_sets.CRYPTO_VENUES` = `{"deribit", "binance", "okx", "bybit", "sfox"}` [VERIFIED: closed_sets.py:289-291]) should confirm that an MT5 key cannot be a composite member before the planner states it as fact. If one can, a mixed composite carrying a Deribit options member is withheld in wave 1 and its MT5 leg's contribution is hidden, which is a visible change to that composite, not to the MT5 account's own strategy row.
- The strict string means every MT5 row's dqf (no such reason; or `mtm_basis_unavailable_for_venue`) falls through to today's code path. The negatives table in Code Examples plus an MT5-shaped byte-identical snapshot test pins it.

**Wave 2 caveat:** promotion edits `run_stitch_composite_job`, a function the MT5 composite path would share if an MT5 key can be a composite member. In that case a stitch change moves MT5 numbers and the ROADMAP's freeze rule governs the merge (before 155.2 plan 12's recapture or after plan 14). Add a pytest that an MT5-only composite's stitched output is byte-identical before and after the promotion edit.

**Pre-merge check for the orchestrator (read-only, marker first):** count `strategy_analytics` rows by `data_quality_flags->>'mtm_gated_reason'` joined to `strategies.status` and the member venues (Open Question 0); expect 0 MT5 members.

## DEF-142.2-07 recommendation (Question 6)

**Close and delete the entry in the ship PR**, naming it in the CHANGELOG entry (repo rule: every phase ship deletes the TODOS entries it closed, same PR). Reasoning:
1. The entry's subject is "tighten `ledger_complete` when a Deribit chain is broken". Its own population is 0 at HEAD for the second time (census 2026-11-25: 0 rows stamped `ledger_complete` with a broken chain), so tightening still affects nothing.
2. The population the earlier census missed (2 private composites, stamped `composite_stitched`) is a different verdict path and is now handled by the named withhold, not by the entry's tightening.
3. The remedy rule the entry carries (re-derive, never backfill UPDATE) is already repo-wide (CONTEXT established patterns and the DEF-142.2-09 item).
4. The remaining risk, a future single-key Deribit options book, is already recorded as a Deferred Idea in CONTEXT; single-key allocator keys are on the Phase 185 options basis.
5. A zero-population entry with a "founder decision" label is noise that the next TODOS sweep deletes (repo rule: TODOS holds open work only).
Caveat for the planner: the entry labels the call "FOUNDER DECISION". CONTEXT explicitly delegates it to the planner, so record the census numbers (2 total, 0 published, 0 `ledger_complete`) and the verdict in the CHANGELOG and phase SUMMARY so the founder can reopen it. If the planner prefers a rewrite, the minimum is replacing "0" with the 2/0/0 reading and re-pointing the decision to the single-key case.

## Pre-push gates (Question 7)

| Gate | Exact command | Notes |
|------|---------------|-------|
| TS typecheck | `npm run typecheck` (`tsc --noEmit`) | [VERIFIED: package.json:12] |
| Lint (includes planning hygiene) | `npm run lint` = eslint + `check-admin-route-manifest.ts` + `check-route-contract.ts` + `check-planning-hygiene.ts` + `check-canonical-domain.ts` + `check-demo-credential-digests.ts` | [VERIFIED: package.json:11] |
| Planning hygiene alone | `npm run check:planning-hygiene` | rules 6d/6e/7 guard ROADMAP/STATE shape |
| Plan anchors | `node scripts/verify-plan-anchors.mjs --pending` (CI self-test first: `node scripts/verify-plan-anchors.mjs --self-test`) | [VERIFIED: ci.yml `plan-anchor-verify` step]; vitest twin `src/__tests__/verify-plan-anchors.test.ts` |
| Vitest | `npx vitest run <paths>`; full `npm test` | tests that read `.planning` (found by content grep for `.planning` under `src/__tests__`, first hits: `verify-plan-anchors`, `critical-regressions`, `accounttruth-census`, `baseline-wiring-claim`, `vac06-mechanism-arms`, `self-referential-oracle`, plus `check-planning-hygiene`): run `grep -rl '\.planning' src/__tests__` and execute that set before any docs-only push |
| Python mypy strict (CI) | from `analytics-service/`: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (same as `make typecheck`) | [VERIFIED: .github/workflows/ci.yml step "Type gate - mypy strict over the running-service surface"]; `scripts/` is NOT gated, tests untyped |
| Python tests | `pytest` only from `analytics-service/` (never importlib.reload) | CI runs serially; `make test` |
| SQL gate lint | `node scripts/lint-sql-gates.mjs --self-test` (only if SQL gates change) | |
| Version/CHANGELOG | `VERSION` and `package.json` byte-equal 4-digit; CHANGELOG entry BEFORE push, same commit; never `npm version`; never write the CI skip trailer tokens in any message | CLAUDE.md |
| Ship branch guard | a ship branch must change nothing under `.planning` | memory: ship-planning-guard |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | vitest, tsc, lint | yes | v25.8.1 | CI uses 22; run `npm ci` under the repo engines if a mismatch bites |
| node_modules in this worktree | vitest, typecheck | NO (`ls node_modules` empty in the worktree) | — | `npm ci` in the worktree before the first test run (or symlink per the repo's worktree practice) |
| Python | pytest, mypy | yes | 3.14.3 locally | CI pins its own; run `pytest` from `analytics-service/` with the project venv, not the system interpreter, before trusting a green |
| mypy / pytest | Python gates | yes | 2.0.0 / 9.0.2 | CI pin differs; confirm against `analytics-service/requirements-dev.txt` |
| Deribit credentials / Railway worker | wave 2 measurement | not available to agents | — | Founder-gated worker run (R11 pattern) |
| Docker / local Supabase | `supabase/tests` corpus, RPC migration | not booted (instructed) | — | Needed only if the cohort RPC migration is taken (Open Question 1) |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (TS), pytest 9 + mypy strict (Python) |
| Config file | `vitest.config.ts`; `analytics-service/pyproject.toml` |
| Quick run command | `npx vitest run src/lib/factsheet/headline-basis.test.ts src/lib/factsheet/headline-verdict.parity.test.ts src/lib/factsheet/composite-read-path.headline-basis.test.ts` |
| Full suite command | `npm test`; `cd analytics-service && pytest` |

### Success Criteria to Test Map
| SC | Behavior | Test Type | Automated Command | File Exists? |
|----|----------|-----------|-------------------|-------------|
| SC-2 / SC-3 | Evidence-shaped row (chain broken + `headline_since` + options flag) is withheld with the named cause on page and card; same row minus chain flags too | unit/parity | `npx vitest run src/lib/factsheet/headline-verdict.parity.test.ts` | extend (Wave 0: new cases) |
| SC-2 | Wallet-shape series: RED on pre-fix code (headline unredacted, card finite), GREEN after | unit | same file, new `describe` | Wave 0 |
| SC-3 | `shapeRowAnalytics`, Compare shaping, `figureRecord`/`withholdShortRecordRanks` all agree for the same flags | unit | new `src/__tests__/options-cash-wallet-withhold.census.test.ts` (one row through every seam) | Wave 0 |
| Negatives | Every other `mtm_gated_reason` value, chain-broken alone, MT5 shape, case/pad/typed variants never trigger | unit, table-driven | `npx vitest run src/lib/factsheet/headline-basis.test.ts` | extend |
| Cross-language | TS literal equals `MTM_REASON_OPTIONS` read from `stitch_composite.py` | vitest reads file | new test beside the above | Wave 0 |
| Surfaces | Source scan: no surface compares `mtm_gated_reason` to the literal outside `headline-basis.ts`. Today's non-test hits that the scan must ALLOWLIST by file: `FactsheetView.tsx:3286` (`mtmGate?.reason === "unsmoothed_options_book"`, the toggle), the `basis-context.tsx` switch, the `types.ts` union, `SyncPreviewStep.tsx`, `composite-read-path.ts` (:494 reads `mtm_gated_reason` into `mtmGate`) | vitest source scan (use `stripCommentsPreserveLines`) | in the census test | Wave 0 |
| Completeness | Every file selecting `strategy_analytics` scalars or `data_quality_flags` imports the predicate or `shapeRowAnalytics`, or sits in a closed-reason `EXCLUDED` map | vitest census modelled on `figure-gate-census.test.ts` | in the census test | Wave 0 |
| SC-5 / 155.2 | MT5-shaped dqf: verdict, payload quality and shaped row byte-identical to HEAD snapshot | unit | headline-basis test | Wave 0 |
| Cache | factsheet payload cache key bumped | existing | `npx vitest run "src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx"` | update |
| Alias pins | five-alias projections equal across `RECORD_SCALAR_ALIASES`, `PERCENTILE_SPAN_COLUMNS`, `RECORD_SPAN_SELECT` | existing | `npx vitest run src/lib/figure-record-scalars.test.ts src/lib/queries.test.ts src/lib/queries.percentile-columns.test.ts` | update |
| Census | verdict-reader census counts | existing | `npx vitest run src/__tests__/recompute-verdict-census.test.ts src/__tests__/figure-gate-census.test.ts` | update rows |
| Wave 2 producer | composite promotion vs the options-basis oracle | pytest | `cd analytics-service && pytest tests/test_stitch_composite_job.py tests/test_deribit_options_basis_ledger.py -x` | extend, only if promoted |
| Wave 2 measurement | read-only probe self-test on a stubbed exchange | pytest | `cd analytics-service && pytest tests/test_deribit_options_smoothed_probe.py` | Wave 0 (script ships with tests) |

### PROOF-01 (RED then GREEN, per gate)
For each new gate: (1) write the test against pre-fix code or a neutered copy and record the RED output naming the failing arm; (2) back up the neutered file by byte copy first (`cp file file.bak`), neuter the line (e.g. return `false` from `isOptionsCashWalletBook`, or delete the verdict's first `if`), run, record RED with the arm named; (3) restore by `cp` back and `cmp` to prove byte equality, run GREEN, record both verbatim in the plan SUMMARY. Never `git checkout`/`restore`/`stash` on uncommitted work (repo rule). Neuter targets: the predicate, the verdict's first line, the `shapeRowAnalytics` arm, the `figureRecord` marker read in `recordClears`, the Compare alias pick, the cache key bump.

### Sampling Rate
- **Per task commit:** the quick command above plus the touched test file.
- **Per wave merge:** `npm run typecheck && npm run lint && npx vitest run src/lib src/__tests__` and, for any Python touch, the mypy command from the table.
- **Phase gate:** full `npm test`, pytest, mypy green before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `src/__tests__/options-cash-wallet-withhold.census.test.ts` (one row through every seam; source scan; cross-language pin)
- [ ] new cases in `headline-basis.test.ts` and `headline-verdict.parity.test.ts`
- [ ] `analytics-service/scripts/deribit_options_smoothed_probe.py` + `analytics-service/tests/test_deribit_options_smoothed_probe.py` (wave 2)
- [ ] `npm ci` in the worktree (no `node_modules`)

## Security Domain

`security_enforcement` is not set false in `.planning/config.json` (key absent), so it applies.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | List projections stay explicit allowlists; the new alias is one closed-vocabulary `->>` scalar, never the flags blob; owner/public lanes unchanged; no admin-client widening |
| V5 Input Validation | yes | Strict `=== "unsmoothed_options_book"`; non-string, case variants and padded strings do not trigger; untrusted JSONB read through the existing record-or-null guard |
| V6 Cryptography | no | Wave 2 reads decrypted keys only inside the worker through the existing key path; never print, log or store them |
| V8 Data Protection | yes | Withheld text carries no flag names, balances or job vocabulary; public repo, so no PROD ids or account numbers in tracked text (plan SUMMARY included) |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stale flags during a derive prestamp un-withhold the row | Information disclosure | Read the effective flags generation everywhere (snapshot alias for lists and Compare) |
| Anonymous list leaks the blob | Information disclosure | Scalar aliases only; `queries.test.ts` pins the allowed `->>` forms |
| Cached payload serves the artefact | Information disclosure | Cache key bump |
| Wave 2 probe prints a credential or balance | Information disclosure | Ordinals/counts only, scrub pass, no `--out` with raw ids; founder-gated run |
| CI suppression by a skip token in a commit/PR body | Tampering | Never write the tokens, even to deny them (CLAUDE.md) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Draft withheld wording is acceptable to the founder | Recommended design | Copy rewrite only; user sees it at the visual check |
| A2 | The mapping of PROD Deribit keys A/B/C in the 185 outcome to the two composites' member keys is unknown; wave 2 may differ from 185's result | Wave 2 | Mis-set expectation; the criteria are structural so the run decides |
| A3 | `leverageEligibleFor` needs the `headlineWithheld` exclusion only for a future single-key options row (composites are already excluded) | Pitfall 2 | Low; the exclusion is cheap and safe either way |
| A4 | The tearsheet.pdf route has no chain-broken handling (grep found none) and needs a bespoke refusal shape | Surface 6 | Planner reads the route; a wrong shape fails a route test |
| A5 | Wave 2 promotion can reuse the 185 `build_deribit_options_basis_ledger` pattern inside the composite member arm rather than the third-pass smoothed series | Wave 2 | If the member arm cannot take a single crawl, promotion needs the third pass behind the kill switch instead |
| A6 | No diff was taken of `origin/gsd/phase-233-deribittruth` against `job_worker.py` | Wave 2 | Merge conflict surprise in the promotion plan |
| A7 | The number and publication status of rows carrying `mtm_gated_reason = unsmoothed_options_book` beyond the 2 chain-broken composites | Summary, SC-5, Open Question 0 | The blast radius, the SC-5 CHANGELOG list and the RPC decision rest on it |
| A8 | An MT5 key cannot be a composite member (grep and one arm read; arm-selection code not read) | Q8 | A mixed composite would be withheld in wave 1 and wave 2's stitch edit would touch MT5 numbers |
| A9 | Deribit docs facts in CONTEXT (equity identity, mark-history coverage) were not re-fetched | Sources | Wave 2 criteria built on them need a re-read of the docs |

## Open Questions (RESOLVED)

0. **Census by trigger, not by chain break (blocks the blast-radius claim).**
   - Known: CONTEXT counted Deribit rows carrying `twr_chain_broken` (2 total, 0 published, both stamped `unsmoothed_options_book`). The trigger is `mtm_gated_reason`, stamped on any composite with an option-active member, chain intact or not.
   - Unclear: how many `strategy_analytics` rows, published or not, carry `mtm_gated_reason = 'unsmoothed_options_book'`, with what member venues and `strategies.status`; whether any published strategy would change.
   - Recommendation: the orchestrator runs one read-only PROD count (marker query first, `grep -a`, one statement per call) grouped by `strategies.status` and member venue, and the plans quote that reading. Until then SC-5's "no published figure moves" and the RPC question below are `[ASSUMED]`.
   - **RESOLVED:** CONTEXT `### Decided at planning` (trigger population read 2026-11-25: 2 rows, both private composites, every member Deribit).

1. **Cohort RPC (`get_verified_cohort_rank`): migrate or accept the asymmetry?**
   - Known: it ranks a hypothetical blend against the published+verified universe using the stored Sharpe/Sortino/max_dd; TS `getPercentiles` mirrors it; the TS/SQL parity test covers the status list only; the checked-in function snapshot and baseline must stay in sync. Whether any published row carries the flag is `[ASSUMED]` (Open Question 0); CONTEXT only established it for the chain-broken rows.
   - Unclear: whether an aggregate, decile-quantised peer sample counts as "publishing" a figure.
   - Recommendation: do the TS side (it is just the marker) and put the SQL re-base in its own last plan in the serial migration lane with migration-reviewer and rls-policy-auditor, re-basing on the LATEST definition (`20261110120000_get_verified_cohort_rank_unreadable_dates.sql`), with no data-reading guard. PROD migrations auto-apply after TEST apply with no human gate, so all review happens before merge. If the founder prefers no migration this phase, record the asymmetry as a decision. Needs a founder answer; flag it.
   - **RESOLVED:** CONTEXT `### Decided at planning` (no migration; `get_verified_cohort_rank` unchanged; TS percentile ranks skip a flagged row).
2. **Should the share card name the reason?** The OG card has only NaN dashes and ignores every cause today (headline-basis doc). The ruling says "reason named on every surface incl. share card". Recommendation: confirm with the founder; if yes, a one-line text row is a new card element (design work). Default if unanswered: dashes, same as chain-broken.
   - **RESOLVED:** the share card names the reason (CONTEXT `### Decided at planning`; plan 252-01).
3. **Selected-range figures and the equity chart** still derive from the cash series under the existing Withheld pattern (Pitfall 7). Recommendation: match the existing legacy-withheld behaviour in wave 1 with a range note analogous to `windowCoverageNote`, and let the founder rule at the visual check on hiding the curve.
   - **RESOLVED:** orchestrator decision 2026-11-25, revision round 1: for this cause the selected-range and zoomed-window figures are withheld with the same named reason, and the equity and rolling charts may still draw with the named note (plans 252-01 and 252-02).
4. **Wizard preview and admin approve:** bring `SyncPreviewStep` (owner preview) and the admin approve path in scope? Recommendation: yes for the preview (same predicate, it already reads the reason; removes the raw flag name from its copy); for admin approve, show the named withhold and do not block approval (blocking is a new product rule, not in the ruling).
   - **RESOLVED:** out of scope (CONTEXT `### Decided at planning`: the wizard preview and admin approve are out of scope).
5. **Mixed composites** (Deribit options member plus another venue) trigger by definition. Recommendation: accept and state in CHANGELOG.
   - **RESOLVED:** accepted. A mixed composite is withheld by definition, and the ship CHANGELOG says so (plan 252-05).
6. **Single-key Deribit options that fell back to cash on 185** carry `options_cash_basis` in a key payload, not the trigger. Out of scope (233, Deferred Ideas); noted so the planner does not widen the trigger.
   - **RESOLVED:** deferred (CONTEXT `<deferred>`); plan 252-05 books the single-key follow-up entry.
7. **Blends and constituents that carry a flagged leg.** Allocations constituents and scenario blends consume each leg's `daily_returns` / `returns_series` (`scenario-adapter.ts`, the portfolio constituent select at `queries.ts` ~6068). The marker withholds only a constituent's annualized figures; a blend containing a flagged leg still compounds the artefact series. Options: withhold the blend figure with the named reason, exclude the leg with a visible note (precedent: `tiny_base_days` leaves named days out of a leg, scenario.ts:127), or accept and record. Recommendation: withhold the blend's annualized figures with the named reason, because excluding a leg silently changes the allocator's book. Needs a founder ruling; it is outside the 'published strategy' wording of the ruling.
   - **RESOLVED:** deferred (CONTEXT `### Decided at planning`: blend-level handling is deferred; a constituent's own annualized figures are withheld through the figure-record marker).
8. **Compare and the factsheet disagree on the curve.** The factsheet keeps drawing the whole-record curve under a Withheld row, while Compare's overlay for an undatable row draws none. Pick one rule for this cause. Recommendation: Compare draws no curve for a flagged row (it is a cross-strategy comparison, so an artefact curve misleads most there), the factsheet keeps its own pattern until the founder rules at the visual check.
   - **RESOLVED:** plan default (Compare draws no curve for a flagged row; the factsheet charts draw with the named note). The founder rules at the visual check, which `/gsd-verify-work` owns.

## Project Constraints (from CLAUDE.md)

- AGENTS.md: this Next.js has breaking changes; read `node_modules/next/dist/docs/` before using any Next API. This phase proposes no new Next API (server components, RSC reads and an existing `unstable_cache` key bump only). If a task touches a route handler or cache API, read the matching guide first.
- DESIGN.md governs any withheld-reason copy; read it before finalising wording.
- Database: this checkout's Supabase CLI is linked to PRODUCTION; run the `COMMENT ON DATABASE` marker query before any write; do not unlink. PROD migrations auto-apply after TEST apply (no reviewer gate). Migrations need migration-reviewer and rls-policy-auditor clean; `scripts/lint-migration-data-dependence.mjs` refuses data-reading `DO` guards.
- CHANGELOG discipline: every ship writes an entry, written before push in the same commit as the VERSION bump; enumerate commits, group by theme, cross-check; name the closed TODOS entries; no ship branch change under `.planning`.
- TODOS.md holds open work only; a ship deletes the entries it closes (DEF-142.2-07 here); LOW/Info review survivors are not booked.
- Completion is historical: verification frontmatter uses `verified_at_sha` + `drift_subjects`, never `covered_digest`/`covered_files`; `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json` never in `drift_subjects`.
- Never write the CI skip-trailer tokens in a commit message or PR body, not even to deny them.
- Never dispatch `gsd-*` agents by hand; run the workflow's dispatch step. gsd-tools state handlers: `git diff` after every run.
- Coverage: read vitest thresholds from `vitest.config.ts`, never a restated number.
- Tests must be able to fail (neuter, see RED, restore from a byte backup); always `grep -a`; pytest only from `analytics-service/`; a new `supabase/tests` file or arm moves several censuses (grep them all) if the RPC migration is taken.
- Public repo with tracked `.planning/`: no secrets, PROD ids, home paths, account numbers; the 2 composites are named by role only (the ROADMAP names Quantum Drift; keep any further identifiers out).
- 155.2 freeze (conditional): no MT5 number may move; if one does it merges before plan 12's recapture or after plan 14.
- Phase 233 write scope is off limits (listed above). Founder memory: no AI authorship trailers in commits or PRs.

## Sources

### Primary (HIGH confidence, all read this session)
- `src/lib/factsheet/headline-basis.ts` (whole file), `src/lib/figure-gate.ts` (whole file), `src/lib/stored-analytics-result.ts` (whole file), `src/lib/figure-record-scalars.ts`
- `src/lib/factsheet/composite-read-path.ts` (:320-640, :880-1060), `og-metrics.ts` (:40-200), `build-payload.ts` (:780-930), `types.ts` (:855-945)
- `src/app/factsheet/[id]/v2/MetricsColumn.tsx` (:40-300), `basis-context.tsx` (:770-990)
- `src/lib/queries.ts` (:215-420, :560-720, :780-1010), `src/app/(dashboard)/compare/page.tsx` (:92-380), `src/lib/percentile-core.ts`
- `analytics-service/services/stitch_composite.py` (:87-165, :280-375), `job_worker.py` (:6560-6760, :12885-13030, :13935-14300, :14480-14500), `deribit_txn.py` (:2040-2200), `deribit_ingest.py` (:759-830, :2567-2700), `closed_sets.py` (:207-213)
- `.planning/debug/deribit-implausible-returns.md`; `.planning/ROADMAP.md` Phase 252; `TODOS.md` DEF-142.2-07; `package.json`; `.github/workflows/ci.yml` mypy step
- Test templates: `headline-verdict.parity.test.ts`, `composite-read-path.headline-basis.test.ts`, `recompute-verdict-census.test.ts` (header), `figure-gate-census.test.ts` (header), `tests/fixtures/deribit_option_round_trip.py`, `tests/test_deribit_key_mode_options_basis.py`, `tests/test_stitch_composite_job.py:1195-1215`
- `git show dfedac44d` (Phase 185 SC-4 outcome)

### Secondary / Tertiary
- Deribit documentation facts (equity identity, `get_mark_price_history` coverage) are taken from CONTEXT (read there 2026-11-25) and were NOT re-fetched this session: treat as [ASSUMED] for any plan that depends on them beyond what the code already encodes.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new packages
- Architecture / surface inventory: HIGH for sites read; MEDIUM for surface 6, 12, 13, 15 where only grep evidence was taken
- Pitfalls: HIGH, each traced to a read line
- Wave 2 outcome: MEDIUM-LOW, depends on a founder-gated run and on Phase 185's partial result

**Process note:** the gsd init, graphify (`graphify status` / queries) and `research-plan` / `research-store` seam steps were NOT run in this session; research was done by direct reads and greps of the worktree. No web or Context7 lookups were made.

**Research date:** 2026-11-25
**Valid until:** 2026-12-02 (fast-moving: Phases 233, 225, 155.2 land in parallel; re-diff `headline-basis.ts`, `queries.ts` and `job_worker.py` against `origin/main` before planning)

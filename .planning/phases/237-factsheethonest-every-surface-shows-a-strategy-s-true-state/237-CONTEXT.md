# Phase 237: FACTSHEETHONEST — every surface shows a strategy's true state, and no cache re-serves a stale or failed one - Context

**Gathered:** 2026-11-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Every surface shows a strategy's true state (withheld, re-running or owner-private), and no cache re-serves a stale or failed one. This phase is the one owner of the factsheet seam: the OG route `src/app/api/og/factsheet/[id]/route.tsx`, `src/lib/factsheet/fetch-and-build-payload.ts` and `src/app/factsheet/[id]/v2/page.tsx`. Requirements: FACT-01, FACT-02, FACT-04, CACHE-01, CACHE-03. TODOS entries this phase closes: `164.6.6.3.3-WITHHELD-RESIDUE` (FACT-01), `[190-RERUN-SURFACES-NOT-HOLDING]` (FACT-02), `164.6.6.2.1-OWNER-TRUST-TIER-UNPUBLISHED` (FACT-04), `170.3-OG-NOTFOUND-CACHE` (CACHE-01), `164.6.6.2.1-USDVIEW-READFAIL-CACHED` (CACHE-03).

Out of scope: FACT-03 and FACT-05 (Phase 238), CACHE-02 (Phase 239), DBACC-01's whole-column select (v1.23; it re-bases on this seam later). No migration is expected.

</domain>

<decisions>
## Implementation Decisions

### FACT-01: the three D6 items on a Withheld factsheet (founder ruling, 2026-11-23)
- Q1 Worst 10 Drawdowns, founder answer "Withhold panel (Recommended)": on a Withheld full-history view with no what-if, the whole Worst 10 Drawdowns panel is replaced by the Withheld note. A zoomed window keeps its own slice.
- Q2 EOY Returns and Calmar by Year, founder answer "Withhold both (Recommended)": on a Withheld full-history view with no what-if, both by-year panels are withheld (the year that holds the break compounds across it and a Withheld row cannot name which year it is). A zoomed window keeps its own slice.
- Q3 Style Drift, founder answer "Withhold panel + KS (Recommended)": on a Withheld full-history view with no what-if, the Style Drift panel and its Kolmogorov-Smirnov line are withheld. A zoomed window keeps its own slice.
- All three use the same predicate as D-15 and its extensions in Phase 164.6.6.3.3 (`isHeadlineWithheld`, full history, no what-if), so the strip, the rail and these panels can never disagree about what "withheld" means.

### FACT-02: re-run holding reach (founder ruling, 2026-11-23)
- Founder answer "7 + (a) + (b) (Recommended)". During a pending or computing re-run over a stored success result, these surfaces stay published and show the last computed figures with the quiet Updating line (Phase 190 D-03, D-06 wording "Updating with the latest data. These figures are from the last completed computation."): the share card image (`/api/og/factsheet/[id]`), the tear sheet, both PDF routes (`/api/factsheet/[id]/pdf`, `/api/factsheet/[id]/tearsheet.pdf`), the returns API (`/api/strategies/[id]/returns`), recommendations, portfolios (`StrategyBreakdownTable` and the portfolio PDF) and the scenario composer; plus (a) the strategy page's own panels (`getStrategyDetailV2`, today a terminal-status gate with live data-quality chips) and (b) the detail reads that share `PUBLIC_ANALYTICS_COLUMNS` and withhold by design today: `getPublicStrategyDetail`, `getStrategyDetail` (and `getFactsheetDetail`, the tear sheet read, which the tear sheet needs anyway).
- (c) composite approval answering 409 during a re-stitch is RULED OUT by the founder as a write gate rather than a display. It stays as it is, and the census classifies it so.
- `[190-RERUN-SURFACES-NOT-HOLDING]` is closed on that basis in the ship PR.
- Every holding surface follows Phase 190 plan 03's rule: `hasStoredAnalyticsResult` with `isRecomputeOverStoredResult`, plus `hasUnboundDerivePrestamp` where it reads the flags blob. A machine surface (the returns API) carries the state as a field rather than a line of text.
- A census test lists every reader of the recompute verdict with a classification, and fails when a new reader is added unclassified (SC-2).


### Measured at HEAD after the ruling (2026-11-23, UI-SPEC research, re-checked by the phase agent)
- Five surfaces the FACT-02 ruling names no longer exist, so they have nothing to hold: portfolios (`StrategyBreakdownTable` deleted, portfolio PDF retired by Phase 195 TRIM D-03; `/portfolio-pdf/[id]` is now a figure-free landing page), (a) `getStrategyDetailV2` (deleted, Phase 196 plan 14), and (b) `getPublicStrategyDetail` and `getStrategyDetail` (deleted, Phase 196 plan 14). Of (b) only `getFactsheetDetail`, the tear sheet read, is live and it is in scope. The census lists the retired ones as retired with the command that proves it, and `[190-RERUN-SURFACES-NOT-HOLDING]` closes on: every listed live surface holds, the retired ones are gone, and (c) is ruled out by the founder.
- The composer's book-strategy rows (the live successor of "portfolios") already show stored figures during a re-run but without the Updating line; they are in scope as part of the composer and get the line.

### Follow-ons of the FACT-01 ruling (phase agent, 2026-11-23; derived from the founder's stated reason, reversible, flagged in the ship report)
- The same figures a withheld panel hides are withheld wherever else they render on the same Withheld full-history view: the EOY bar chart value labels, the heatmap per-year YTD column, the Worst 10 chart bands and the hover note named in the TODOS entry heading. Showing the identical number in a second rendering would defeat the ruling.
- EOY Returns, Calmar by Year and Style Drift show the whole record even inside a zoom, so they have no slice to keep and stay withheld under a zoom; Worst 10 Drawdowns keeps its zoomed slice.
- A failed-cause panel stays omitted as today (no Withheld note on a failed row).
- The new panel notes use panel-specific sentences (UI-SPEC FH237-PANEL-WITHHELD).
- CACHE-03 makes the USD read-failed sentence "It is retried within the hour." false; it becomes the reload sentence (UI-SPEC A-RELOAD).
- Both PDF routes and the share card take the short cache while they render a held re-run.
- A share-link recipient of an unpublished strategy still reads "Data source —" (owner lane only, per the FACT-04 decision and the TODOS gate).


### Research follow-ups (phase agent, 2026-11-23, reversible; supersedes the "about 60 s" not-found value above, which stays as lineage)
- CACHE-01: ROADMAP SC-3 says the real card shows "on the next request". A 60 s cache cannot promise that, so a genuine not-found card (unknown, unpublished and malformed id alike, one identical header and card so the header is no existence oracle) and any published card rendered WITHOUT figures (first compute, failed, composite re-stitch, D-04 fallback) are sent `no-store`. A card rendered during a held re-run (figures plus the Updating line) takes the short cache `public, max-age=60, s-maxage=60`. Rendered terminal data keeps the long cache.
- Bump the factsheet payload cache key and `OG_CARD_VERSION` once each, so no entry from before the change is served after deploy.
- `getFactsheetDetail` is classified in the census, not widened: the tear sheet's figures come from the payload builder, which already holds; its `analytics` output is only null-checked.
- Out of scope, reported in the ship notes: `readFactsheetBenchmark` failures stay cached under the earlier decision D-52 (CACHE-03 is the USD price read). A terminal-success row with an unbound derive prestamp now withholds on OG, returns and the PDFs as it already does on the factsheet (parity behaviour change).

### Decided autonomously
- [FACT-04] Q: "How does the owner's private factsheet get its own trust tier?" → Selected: "On the owner lane (Lane B of `v2/page.tsx`) only, read the latest `strategy_verifications` row with the request's user-scoped client; the existing `strategy_verifications_owner_select` RLS policy is the ownership check. `get_published_trust_signals` is not widened, and anon and non-owner readers still get nothing for an unpublished strategy. Owner and anon are tested per surface." — no schema change, one read on one lane.
- [CACHE-01] Q: "What cache does a not-found OG card get?" → Selected: "A genuine not-found (unpublished, unknown or malformed id) gets a short cache (about 60 s, never `LONG_CACHE_CONTROL`); rendered data keeps the long cache. A card rendered during a re-run (FACT-02) also gets the short cache so its Updating line is never pinned at the CDN for a day." — a header constant.
- [CACHE-03] Q: "How is a failed BTC price read kept out of the payload cache?" → Selected: "A `price_read_failed` build throws inside the `unstable_cache` callback, the house degraded-build pattern (ROADMAP: `use cache` is not adopted); the page renders that view uncached and the next view retries. A shorter TTL is not a close." — local to the builder and its wrapper.
- [Gates] Q: "How are SC-3's cache cases proven?" → Selected: "A good-after-bad-within-TTL test on the real cache wrapper for each case; each gate goes RED on pre-fix code or a neutered copy with its named arm first, restored from a byte backup (`cp` back, `cmp`) and GREEN, recorded verbatim in the plan SUMMARY (PROOF-01)." — tests only.

### Claude's Discretion
- Exact short-cache value for the not-found and re-run OG cards, the census test's file location and classification vocabulary, and how plans split by topic.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/stored-analytics-result.ts`: `hasStoredAnalyticsResult`, `isRecomputeOverStoredResult`, `hasUnboundDerivePrestamp` (Phase 190 plan 03, dependency-free, shared by factsheet, lists, admin route and client code).
- `isHeadlineWithheld` (Phase 164.6.6.3.3 D-15): the Withheld full-history no-what-if predicate the strip and rail already use.
- `withTrustTier` in the factsheet page: the post-build tier overlay that also reaches `usdView.payload` (164.6.6.2.1 CR-02).
- OG route already has `FAILURE_CACHE_CONTROL = "no-store"` beside `LONG_CACHE_CONTROL`.

### Established Patterns
- Degraded builds throw inside the `unstable_cache` callback so `unstable_cache` never stores them (`v2/page.tsx` read_error and stale-generation throws).
- Trust tier is per-request, never cached with the payload.
- Two-lane factsheet: Lane A published and cached; Lane B owner-only, built directly and never through the shared cache. Lane order is load-bearing.

### Integration Points
- Recompute-verdict readers today: `src/lib/strategyGate.ts`, `src/lib/queries.ts`, `src/lib/factsheet/fetch-and-build-payload.ts`, `src/lib/factsheet/headline-basis.ts`, `src/app/api/admin/strategy-review/route.ts`, `src/lib/closed-sets.ts`.
- Surfaces with their own terminal-success gate: `src/app/api/og/factsheet/[id]/route.tsx`, `src/app/api/factsheet/[id]/pdf/route.ts`, `src/app/api/factsheet/[id]/tearsheet.pdf/route.ts`, `src/app/api/strategies/[id]/returns/route.ts`, `src/app/(dashboard)/recommendations/page.tsx`, `src/lib/portfolio-analytics-adapter.ts`, the composer.
- `buildUsdView` in `fetch-and-build-payload.ts` returns `usdViewUnavailable: "price_read_failed"` as a normal payload today.

</code_context>

<specifics>
## Specific Ideas

- The Updating wording is Phase 190 D-06's, verbatim.
- TODOS `164.6.6.2.1-OWNER-TRUST-TIER-UNPUBLISHED` names its own "Not a close": widening `get_published_trust_signals` to unpublished strategies for every caller.
- TODOS `164.6.6.2.1-USDVIEW-READFAIL-CACHED` names its own "Not a close": a shorter TTL.

</specifics>

<deferred>
## Deferred Ideas

- Composite approval during a re-stitch (409) — ruled out by the founder 2026-11-23 as a write gate, not deferred.
- The "one hover note" mentioned in the `164.6.6.3.3-WITHHELD-RESIDUE` heading is not among the three D6 items; the planner re-reads the entry and either covers it or names it.

</deferred>

---
phase: 159-rank-public-ranking-integrity
plan: 03
subsystem: api
tags: [postgrest, projections, rls, anon-reads, supabase, vitest, nextjs]

requires:
  - phase: 159-02
    provides: "PERCENTILE_GATE_COLUMN + isRankableAnalyticsRow — the byte-freeze discipline on PERCENTILE_ANALYTICS_COLUMNS this plan had to preserve while editing the same file"
  - phase: 126-FACTSHEET-01
    provides: "readPublicVerificationSignals / get_published_trust_signals — the column-explicitness precedent the projections follow"
provides:
  - "CATEGORY_RANKING_ANALYTICS_COLUMNS — explicit projection for the anon browse/discovery list, with a JSONB-key alias preserving the 3M filter"
  - "STRATEGY_DETAIL_PUBLIC_ANALYTICS_COLUMNS / STRATEGY_DETAIL_DISCOVERY_ANALYTICS_COLUMNS + a variant param on getStrategyDetail"
  - "COMPARE_ANALYTICS_COLUMNS — explicit projection on the cross-tenant allocator compare read"
  - "The documented D-02 owner exemption at the getMyStrategies select site"
  - "MEASURED refutation of the 'PostgREST cannot project a JSONB sub-tree' claim (assumption A4 confirmed)"
affects: [159-04, 159-05, 160-venue-provenance, browse, discovery, compare, factsheet]

actuals:
  tokens: 10249   # chars/4 over the realized diff (40,996 chars, 8 files, +566/-20)
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "PostgREST JSONB-key alias (`alias:column->key`) inside an EMBEDDED resource — keeps one blob key without shipping the blob"
    - "Caller-scoped projection variants with the MINIMAL list as the DEFAULT, so a new caller is safe by construction"
    - "Partial projection composed over EMPTY_ANALYTICS (defaults first, fetched second) to keep a widened type total"
    - "Render-shape guard built from the MEASURED wire response, not a hand-filled fixture"

key-files:
  created: []
  modified:
    - src/lib/queries.ts
    - src/lib/queries.test.ts
    - src/components/strategy/StrategyTable.tsx
    - src/components/strategy/StrategyTable.test.tsx
    - src/app/(dashboard)/compare/page.tsx
    - src/app/(dashboard)/compare/page.test.tsx
    - src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx
    - src/__tests__/phase-147-series-resolution-guards.test.ts

key-decisions:
  - "Took the A4 alias arm on MEASUREMENT, not assumption: the embedded alias returned a real number from TEST, so the 3M filter is preserved rather than degraded"
  - "StrategyTable reads the alias FIRST and falls back to metrics_json — without that fallback the owner surface (/my-strategies, which keeps the splat) would have silently lost the 3M filter"
  - "The discovery variant carries daily_returns/returns_series/metrics_json_by_basis, which the plan's spec omitted; the plan's literal list would have rendered the 'still computing' placeholder instead of the factsheet"
  - "Projection constants left module-private, matching every sibling constant in queries.ts, and pinned behaviourally through the select string rather than by export"
  - "Adjacent NON-splat sites that project excluded columns (getStrategyDetailV2, getFactsheetDetail) are classified and FLAGGED, not silently narrowed — narrowing them is a visual regression this phase forbids"

patterns-established:
  - "Measure the wire before choosing a projection shape: every column list here was replayed against TEST and its returned key set recorded"
  - "Pin the select STRING and the rendered CONSEQUENCE — an over-narrow projection throws nothing and fails no type check"

requirements-completed: [RANK-02]

coverage:
  - id: D1
    description: "The anon browse/discovery list read projects an explicit column list; daily_returns, the metrics_json blob and data_quality_flags are absent from the anon response"
    requirement: RANK-02
    verification:
      - kind: unit
        ref: "src/lib/queries.test.ts#issues an explicit analytics column list, never the wildcard embed"
        status: pass
      - kind: unit
        ref: "src/lib/queries.test.ts#never projects daily_returns, the metrics_json blob, or data_quality_flags"
        status: pass
      - kind: integration
        ref: "TEST project replay with the ANON key — 12 keys returned, excluded columns NONE (transcript below)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every field the browse list renders survives the projection (sparklines, chip status, KPI cells, sorts, range filters)"
    requirement: RANK-02
    verification:
      - kind: unit
        ref: "src/lib/queries.test.ts#keeps every analytics field the browse list actually renders"
        status: pass
      - kind: automated_ui
        ref: "src/components/strategy/StrategyTable.test.tsx#still draws BOTH sparklines when metrics_json/daily_returns are absent"
        status: pass
      - kind: automated_ui
        ref: "src/components/strategy/StrategyTable.test.tsx#renders real metric values, not em-dashes, for every projected KPI"
        status: pass
    human_judgment: false
  - id: D3
    description: "The 3M advanced filter keeps working without the metrics_json blob, via a JSONB-key alias, on BOTH the anon list and the owner list"
    requirement: RANK-02
    verification:
      - kind: unit
        ref: "src/lib/queries.test.ts#carries the 3M advanced filter as an aliased JSONB key, not the blob"
        status: pass
      - kind: integration
        ref: "TEST replay: strategy_analytics(three_month:metrics_json->three_month) => HTTP 200 {\"three_month\": 0.0}"
        status: pass
    human_judgment: true
    rationale: "The alias VALUE path and the owner-surface blob fallback are proven separately (wire replay + a unit-level read-site change), but no single test drives the real 3M filter end-to-end against a row whose three_month is non-zero — every TEST row carrying the key holds 0.0. A human should exercise the 3M filter on both /browse and /my-strategies against data with a non-zero 3M figure."
  - id: D4
    description: "getStrategyDetail serves caller-scoped projections: the default public list excludes the three columns and keeps computation_status; the discovery list adds exactly what the authed page reads"
    requirement: RANK-02
    verification:
      - kind: unit
        ref: "src/lib/queries.test.ts#public variant (the default) excludes the three columns and keeps computation_status"
        status: pass
      - kind: unit
        ref: "src/lib/queries.test.ts#discovery variant additionally projects every field the authed detail page reads"
        status: pass
      - kind: unit
        ref: "src/lib/queries.test.ts#the two variants differ — data_quality_flags is the authed-only column"
        status: pass
      - kind: integration
        ref: "TEST replay: public variant 12 keys / excluded NONE; discovery variant 16 keys incl. daily_returns + data_quality_flags"
        status: pass
    human_judgment: false
  - id: D5
    description: "The compare read projects an explicit list excluding the three columns, composed over EMPTY_ANALYTICS so downstream typed reads stay total"
    requirement: RANK-02
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/compare/page.test.tsx#issues an explicit analytics column list, never the wildcard embed"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/compare/page.test.tsx#keeps every analytics field the compare UI consumes"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/compare/page.test.tsx#never projects daily_returns, metrics_json, or data_quality_flags"
        status: pass
    human_judgment: false
  - id: D6
    description: "The splat class is closed: exactly one code occurrence survives (the owner-scoped getMyStrategies read) and it carries an exemption comment"
    requirement: RANK-02
    verification:
      - kind: other
        ref: "repo-wide grep of `strategy_analytics (*)` over src/ scripts/ supabase/ e2e/ — 14 hits, 1 code + 13 prose/assertion, full disposition table below"
        status: pass
      - kind: other
        ref: "region-scoped awk over getMyStrategies — the `.select(` line still carries the splat, adjacent exemption comment present"
        status: pass
    human_judgment: false
  - id: D7
    description: "The rendered output of browse, strategy-detail, discovery and compare is unchanged"
    verification:
      - kind: unit
        ref: "full local vitest suite — 786 files / 12042 tests passed, 0 failed (worktree carries no .env files, so this is a valid local gate)"
        status: pass
    human_judgment: true
    rationale: "No dev-server render spot-check was performed — see 'Verification NOT performed' below. The evidence is a wire replay plus jsdom render assertions, which is strong for the LIST surface and weaker for the discovery-detail factsheet, whose composite/single-key branches were not rendered against real composite data."

duration: 50min
completed: 2026-08-21
status: complete
---

# Phase 159 Plan 03: RANK-02 splat-class closure Summary

**Every anon-reachable `strategy_analytics` wildcard embed is now an explicit, consumer-enumerated projection — verified by replaying each projection against the TEST project through the anonymous key — with the 3M advanced filter preserved through a PostgREST JSONB-key alias that the codebase's own comment said was impossible.**

## Performance

- **Duration:** 50 min
- **Started:** 2026-08-21T12:44:00Z
- **Completed:** 2026-08-21T13:32:21Z
- **Tasks:** 3
- **Files modified:** 8 (0 created) — +566 / -20

## Accomplishments

- **The class is closed to ONE occurrence.** A repo-wide grep now returns a single *code* hit — the owner-scoped `getMyStrategies` read, exempt by D-02 and carrying an exemption comment at the select site. The other 13 hits are prose or negative test assertions, each dispositioned below.
- **Proven on the wire, not in a mock.** Every projection was replayed against the TEST project. The browse list returns exactly 12 keys with `daily_returns` / `metrics_json` / `data_quality_flags` **absent** — read through the **anonymous** key, which is the actual threat path, not a service-role proxy for it.
- **The 3M filter did not degrade.** Assumption A4 held: `strategy_analytics(three_month:metrics_json->three_month)` returns `{"three_month": 0.0}` — a real number, HTTP 200. The alternative was shipping every `metrics_json` key (alpha, beta, VaR, CVaR, skew, kurtosis…) to anonymous readers to keep one number.
- **Two plan-spec corrections caught by enumeration** rather than by production breakage — see Deviations. Both would have shipped a silent visual regression.

## Task Commits

1. **Task 1 (tracer, TDD): anon browse list projection** — `1b600439` (feat)
2. **Task 2 (TDD): caller-scoped detail variants + compare** — `f17e2102` (feat)
3. **Task 3: owner exemption + prose reconciliation** — `d8766356` (docs)
4. **Render-shape guard (T-159-10)** — `d519eaed` (test)

_Tasks 1 and 2 were TDD; RED was observed before each implementation and the commits were squashed per task rather than split test/feat, since each task's pins and code are one contract._

## The A4 alias measurement (verbatim)

The plan required this to be **measured, never assumed, in either direction**. Probed against the TEST project (`qmnijlgmdhviwzwfyzlc`), service-role for row access, anon for the disclosure check:

```
=== arrow alias  -> ===   select: id,strategy_analytics(three_month:metrics_json->three_month)
HTTP 200
[{"id":"7fd0ebdc-…","strategy_analytics":{"three_month": null}}, …]

=== embedded alias on a strategy whose analytics HAS three_month ===
strategies?select=id,strategy_analytics!inner(three_month:metrics_json->three_month)
  &strategy_analytics.metrics_json->three_month=not.is.null
HTTP 200
[{"id":"1cff1fea-…","strategy_analytics":{"three_month": 0.0}}]
```

**Verdict: A4 CONFIRMED — the alias arm was taken.** The first probe alone would have been insufficient evidence: it returns `null` for every row, which is equally consistent with "the alias works and the key is absent" and "the alias silently yields nothing". The second probe filters to a row that actually holds the key and shows a **number** arriving under the alias name. `->` (not `->>`) is used deliberately: it yields a JSON number, matching the `Record<string, number>` the filter already expects; `->>` would have yielded a string and made every comparison a lexicographic one.

This **refutes** `queries.ts`'s own docblock claim that "PostgREST cannot project a JSONB sub-tree without an RPC". That sentence was corrected in place (house Rule 7 — pick the measured truth, name the conflict) while preserving the *separate* and still-valid reason `getStrategyDetailV2` fetches the blob whole: it consumes a dozen keys, so one blob beats twelve aliases.

## Anon-path wire verification

Issued through the **anonymous** key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`), `status=eq.published`:

| Projection | HTTP | Keys returned | Excluded columns present |
|---|---|---|---|
| browse list (`CATEGORY_RANKING_ANALYTICS_COLUMNS`) | 200 | 12 | **NONE** |
| `getStrategyDetail` public variant | 200 | 12 | **NONE** |
| `getStrategyDetail` discovery variant (service/authed) | 200 | 16 | `daily_returns`, `data_quality_flags` — **expected**, authed-only |
| compare (`COMPARE_ANALYTICS_COLUMNS`, authed) | 200 | 10 | **NONE** |

Browse-list keys, exactly: `cagr, calmar, sharpe, volatility, computed_at, three_month, max_drawdown, six_month_return, cumulative_return, sparkline_returns, computation_status, sparkline_drawdown`.

## Consumer enumerations (enumerate before cutting — Pitfall 5)

**Site 1 — `getStrategiesByCategory` → `StrategyTable`** (`src/components/strategy/StrategyTable.tsx`):

| Field | Read at | Why it must stay |
|---|---|---|
| `sparkline_returns` | :1111, :1143 | sparkline cell + the DISCO-04 colour rule |
| `sparkline_drawdown` | :1118, :1150 | drawdown sparkline cell |
| `computation_status` | :899 | the ONE chip-derivation site → `deriveEmptySeriesState` |
| `computed_at` | :299 (sort), :1051 | `SyncBadge` + the `computed_at` sort |
| `cumulative_return` | :556, :1083 | column + filter + sort |
| `cagr` | :557, :1087 | column + filter + sort |
| `max_drawdown` | :558, :1095 | column + filter + sort |
| `volatility` | :559, :866 | filter + collapsible cell |
| `sharpe` | :560, :1091 | column + filter + sort |
| `six_month_return` | :561, :301, :1103 | column + filter + sort |
| `calmar` | :562 | advanced range filter (filter-only, still user-visible) |
| `metrics_json.three_month` | :567-568 | 3M advanced filter → replaced by the alias |

Dynamic access at :303 is bounded by `TableSortKey` = `SortKey` (`src/lib/discovery-types.ts:13` — `computed_at, cumulative_return, cagr, sharpe, max_drawdown, volatility, aum`) plus `name` and `six_month_return`; `aum`/`name` come off the strategy row, so the union adds no analytics column beyond the table above. `sortino` and `max_drawdown_duration_days` were **cut** — nothing on the list surface reads them.

**Site 3 — `getStrategyDetail` → `discovery/[slug]/[strategyId]/page.tsx`**: `daily_returns` (:66), `returns_series` (:69), `data_quality_flags` (:85, as `dqf`), `metrics_json_by_basis` + `computation_status` (threaded into `readCompositeFactsheet` / `readSingleKeyBasisOpts`), `computed_at` (:149, the FreshnessChip epoch sentinel). Everything else in `buildFactsheetPayload` comes off the `strategy` row, not analytics.

**Site 4 — compare** (`CompareTable.tsx:27-37` `METRICS`, read by dynamic key): `cumulative_return, cagr, sharpe, sortino, calmar, max_drawdown, max_drawdown_duration_days, volatility, six_month_return`; plus `returns_series`, read by **both** `CompareEquityOverlay` (:40) and `CompareCorrelationMatrix` (:26).

## Class-closure inventory (D-02) — every occurrence dispositioned

Repo-wide grep of `strategy_analytics (*)` over `src/ scripts/ supabase/ e2e/` at HEAD: **14 hits, 1 code + 13 non-code. Zero unclassified.**

| # | Location | Kind | Disposition |
|---|---|---|---|
| 1 | `src/lib/queries.ts:375` | **CODE** | `getMyStrategies` — **OWNER-ONLY, EXEMPT (D-02)**. `.eq("user_id", userId)` on the next line is the scoping fact; exemption comment added at the select site. |
| 2 | `src/lib/queries.ts:209` | prose | New `CATEGORY_RANKING_ANALYTICS_COLUMNS` docblock naming what it replaced. Correct by construction. |
| 3 | `src/lib/queries.ts:397` | prose | `hasAnyOwnStrategies` docblock describing `getMyStrategies`'s splat. **Still true** (the splat is retained) — untouched. |
| 4 | `src/lib/queries.ts:1265` | prose | `getStrategyDetailV2` docblock, historical ("Replaces the wildcard…"). Still true. The *adjacent* false JSONB sentence WAS corrected. |
| 5-7 | `src/lib/queries.test.ts:365, 435, 450` | assertion | Negative pins — the literal IS the forbidden thing. Correct by construction. |
| 8 | `src/lib/queries.test.ts:412` | prose | New describe docblock. Correct by construction. |
| 9 | `src/lib/queries.test.ts:848` | prose | Says `getStrategyDetailV2` fetches via the splat join. **Pre-existing inaccuracy** — v2 has used `STRATEGY_V2_*` since its own earlier conversion, so this phase did not falsify it. Left untouched (house Rule 3); logged below. |
| 10 | `src/app/(dashboard)/compare/page.test.tsx:363` | assertion | Negative pin. Correct by construction. |
| 11-12 | `src/app/(dashboard)/my-strategies/page.test.tsx:17, :60` | prose | Pins the OWNER splat shape — consistent with the exemption, still true. Untouched. |
| 13 | `src/__tests__/phase-147-series-resolution-guards.test.ts:38` | prose | **CORRECTED this phase** — see below. |
| 14 | `src/lib/queries.has-any-own-strategies.test.ts:15` | prose | "The predecessor selected…" = `getMyStrategies`. Still true. Untouched. |

Also searched and found **zero** hits for splat variants (`strategy_analytics(*)` without the space, `!inner (*)`) and **zero** `select("*")` reads against the `strategy_analytics` table directly.

### Adjacent NON-splat sites: classified, deliberately NOT changed

These are outside the splat class D-02 defines, but they project columns on the RANK-02 exclusion list, so silence about them would be dishonest:

| Site | Reachability | Projects | Why unchanged |
|---|---|---|---|
| `getPublicStrategyDetail` (`queries.ts`) | **ANON** (`/strategy/[id]`) | `PUBLIC_ANALYTICS_COLUMNS` | Already compliant — explicit, none of the three. |
| `getStrategyDetailV2` (`STRATEGY_V2_ANALYTICS_COLUMNS`) | **ANON** (`/strategy/[id]/v2` — no auth gate) | `metrics_json`, `data_quality_flags` | ⚠️ **FLAGGED.** Both are load-bearing: an existing `CRITICAL:` comment records that dropping `data_quality_flags` silently killed every DQ chip in production once, and `metrics_json` drives four panels. Removing either is a visual regression this phase forbids. |
| `getFactsheetDetail` | anon-openable tearsheet | `metrics_json`, `monthly_returns` | ⚠️ **FLAGGED.** Same shape of argument — the blob is what the tearsheet renders. |
| `api/strategies/[id]/returns` | AUTHED (`withPublishedOrOwner` on a session uid) | `daily_returns`, `data_quality_flags` | Not a class member: authed, and neither raw column is forwarded — only the resolved series and a derived boolean ship (documented at the site). |
| `scenario-share/[token]` | anon (token-gated) | `strategy_id, returns_series` | Already narrow. Compliant. |

**This is a finding, not a fix request I silently skipped:** RANK-02's truth as literally worded ("`metrics_json` absent from *every* anon-reachable `strategy_analytics` response") does **not** hold at HEAD after this plan, because `/strategy/[id]/v2` and the tearsheet legitimately need the blob to render. Closing that would require an RPC or a per-key alias set for a dozen keys — a design change, not a projection swap. Recommend the phase either scope RANK-02 explicitly to the splat class (which is what D-02 says) or open a follow-up.

## Prose reconciliation (before → after)

**1. `src/lib/queries.ts` — `getStrategyDetailV2` docblock**
- **Before:** "…drive multiple panels and **PostgREST cannot project a JSONB sub-tree without an RPC**."
- **After:** "…drive multiple panels, so pulling the blob once beats enumerating a dozen key aliases." + an explicit `⚠️ CORRECTION` paragraph recording the measurement that refutes the old claim.
- **Why:** falsified by this plan's own measurement. Corrected by evidence, not by argument.

**2. `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx:123`**
- **Before:** "getStrategyDetail selects `strategy_analytics (*)` (queries.ts) so `computation_status` arrives on the row"
- **After:** names the `"discovery"` variant and its explicit projection, and states that narrowing that constant without this read in mind is how this line breaks silently.
- **Why:** the splat it cites no longer exists on that path.

**3. `src/__tests__/phase-147-series-resolution-guards.test.ts:38`**
- **Before:** "`strategy_analytics (*)` splats (queries.ts, discovery reads) — the splat selects BOTH columns, and **never names `daily_returns`**, so it is never a candidate."
- **After:** scoped to the `getMyStrategies` splat; records that the discovery projection now **does** name `daily_returns` and satisfies Layer A honestly by also naming `returns_series` — the rule, not a tolerance. Also records that Layer A inspects `.select()` **arguments**, so a payload built in a named constant is covered by Layer B, not Layer A.
- **Why:** this phase made the "never names daily_returns" clause false. The guard itself still passes (12/12) — only its stated reason had gone stale, which is the more dangerous failure since it invites a future author to trust a tolerance that no longer applies.

**Not corrected (logged, out of scope):** `queries.test.ts:848` describes `getStrategyDetailV2` as fetching through the splat join. It was already inaccurate before this phase, so under house Rule 3 it is not this plan's to touch.

## Observed REDs (anti-vacuity ledger)

Every new pin was observed failing. Drills were applied to the **source constants**, then restored.

| Drill | Mutation | Observed RED |
|---|---|---|
| Pre-fix (Task 1) | none — original splat | 3 of 4 list pins red (`embed` was `*`) |
| A | `daily_returns, metrics_json, data_quality_flags` added to the list constant | negative pin red |
| B | bare `metrics_json` alone added | negative pin red on `/metrics_json(?!->)/` — proves the lookahead distinguishes blob from alias |
| Pre-fix (Task 2) | none | 3 detail pins + 2 compare pins red |
| C | `data_quality_flags, daily_returns` added to the **public** variant | 3 red, including the lockstep-parity pin |
| D | discovery variant narrowed to `+ returns_series` only | 2 red |
| E | compare list loses `returns_series`, gains `metrics_json, data_quality_flags` | 2 red |
| F | sparkline columns removed from the projected-row fixture | render pin red — `expected null to be 'var(--color-accent)'` |
| G | `sharpe` + `cumulative_return` removed from the projected-row fixture | render pin red — "Unable to find an element with the text: 1.50" |

**One vacuity admitted and fixed.** The list negative-pin passes *pre-fix* for the wrong reason: the string `*` does not contain `daily_returns`, so it is green against the very code it exists to reject. Drills A and B are its real falsifiers, and they are recorded above rather than glossed. Separately, a first draft of the render guard asserted the **absence** of a "Syncing" chip; setting `computation_status: "pending"` did **not** red it (the chip additionally requires a recent `created_at`). That assertion could not fail, so it was **replaced** with per-KPI rendered-value assertions rather than kept as decoration.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's `/strategy/[id]` anon classification is false at HEAD**
- **Found during:** Task 2 `read_first`
- **Issue:** RESEARCH (§RANK-02 site 3) and the plan classify `getStrategyDetail` as **ANON**, "called by `src/app/strategy/[id]/page.tsx:28,:86`". That page imports **`getPublicStrategyDetail`** (:5) and binds it to a **local** `const getStrategyDetail = cache(getPublicStrategyDetail)` (:18). The classification read the local alias, not the export. `getStrategyDetail`'s only production caller is the **authed** discovery detail page.
- **Fix:** implemented the caller-scoped variants as the plan directs, but with `public` as the **default** — a safety property for the exported surface rather than a live anon path — and documented the correction at the constant, in the test docblock and in the commit message. The genuine anon detail path (`getPublicStrategyDetail`) was **already** explicitly projected and already excludes all three columns.
- **Verification:** `grep -rn "getStrategyDetail\b" src/` — no production caller besides `discovery/[slug]/[strategyId]/page.tsx:39`; wire replay of both variants.
- **Committed in:** `f17e2102`

**2. [Rule 2 - Missing Critical] The plan's discovery column list would have broken the discovery factsheet**
- **Found during:** Task 2 enumeration
- **Issue:** the plan specifies `STRATEGY_DETAIL_DISCOVERY_ANALYTICS_COLUMNS` as "the public list **plus `data_quality_flags`**". The discovery page also reads `daily_returns` (:66), `returns_series` (:69) and `metrics_json_by_basis`. Shipping the literal spec would leave `dailyReturns` empty, `buildFactsheetPayload` would return null, and the page would render the **"still computing"** placeholder instead of the factsheet — for every strategy, silently.
- **Fix:** the discovery list carries all four enumerated columns, each named in a guard comment with the consequence of removing it.
- **Verification:** discovery-variant wire replay returns 16 keys including all four; `page.smoothed-wiring` and discovery suites green.
- **Committed in:** `f17e2102`

**3. [Rule 2 - Missing Critical] The alias would have silently degraded the OWNER 3M filter**
- **Found during:** Task 1
- **Issue:** moving `StrategyTable`'s 3M read to `s.analytics.three_month` fixes the anon list but breaks `/my-strategies`, whose rows come from `getMyStrategies` — which keeps the **splat** under the D-02 exemption and therefore carries `metrics_json`, not the alias. A straight read-site swap would have silently disabled the filter on the owner surface.
- **Fix:** alias first, blob fallback: `s.analytics.three_month ?? mj?.three_month ?? null`. Both surfaces keep identical behaviour.
- **Verification:** `my-strategies` suites green (31 tests); the optional `three_month?` field is documented on the row type.
- **Committed in:** `1b600439`

**4. [Rule 2 - Missing Critical] Two byte-identical projection literals are an edit hazard**
- **Found during:** Task 2 drills — discovered by *being bitten*: a `perl` find-and-replace aimed at `STRATEGY_DETAIL_PUBLIC_ANALYTICS_COLUMNS` hit `PUBLIC_ANALYTICS_COLUMNS` instead (identical membership, earlier in the file), quietly widening the **real anon factsheet** projection to include `data_quality_flags`.
- **Fix:** reverted immediately (caught by `git diff` review before any commit — no bad commit exists), then added a behavioural **lockstep pin** asserting the two projections have identical member sets, so the intended coupling is checked by CI instead of assumed. All later drills used exact-match edits.
- **Verification:** the lockstep pin was itself observed RED under drill C.
- **Committed in:** `f17e2102`

**5. [Rule 3 - Blocking] Test harness could not observe list-shaped reads**
- **Found during:** Task 1
- **Issue:** `queries.test.ts`'s strategies chain terminates at `.single()`/`.maybeSingle()`; `getStrategiesByCategory` awaits the builder itself, so it hung rather than resolving.
- **Fix:** the chain becomes a thenable **only** when a test seeds `listRows`, leaving all 49 pre-existing tests byte-identical in behaviour. Same approach for `compare/page.test.tsx`, whose `select` became a recording implementation instead of `.mockReturnThis()`.
- **Verification:** full local suite green.
- **Committed in:** `1b600439`, `f17e2102`

### Documented departure from the plan text (not a defect)

The plan says "define an **exported** constant" for the Task-1 list. All three new projection constants are **module-private**, matching every sibling in `queries.ts` (`PERCENTILE_ANALYTICS_COLUMNS`, `PUBLIC_ANALYTICS_COLUMNS`, `STRATEGY_V2_*`) — house Rule 11, and an exported constant with no importer is surface without a consumer. They are pinned **behaviourally** through the issued select string, which is strictly stronger than a constant-identity assertion: it survives a rename and fails if the constant stops reaching the query.

---

**Total deviations:** 5 auto-fixed (1 bug, 3 missing-critical, 1 blocking) + 1 documented departure.
**Impact:** deviations 1-3 each prevented a silent user-visible regression; no scope creep, no pin weakened.

## Verification NOT performed (stated plainly)

**No dev-server render spot-check was run.** Tasks 1 and 2 each ask for one. Reasons, and what stands in its place:

1. The worktree carries **no `.env` files** (untracked), so a dev server would need env injected by hand — and the one env I may point at is TEST.
2. **TEST data cannot demonstrate the thing the check is for:** every published TEST row returns `sparkline_returns: null` and `three_month: 0.0` (measured, above). A browse page rendered against TEST would show blank sparklines *whether or not the projection is correct* — the check would have been unfalsifiable, the exact failure mode this plan's other pins were written to avoid.

**Compensating evidence:** the anon-key wire replay (exact key sets, above), plus a jsdom render guard built from that measured shape asserting both sparklines draw and each KPI cell shows its real value, plus the full local suite. **Residual:** the discovery-detail factsheet's *composite* branch was not rendered against real composite data — the plan's own `<verification>` treats the render check as a backstop, and this is the part of it that remains genuinely open. Ledger command below.

## Files Modified

- `src/lib/queries.ts` — three projection constants, the `StrategyDetailVariant` param, the owner exemption comment, the corrected JSONB claim
- `src/lib/queries.test.ts` — list + both detail variants + lockstep parity pins; list-read thenable harness
- `src/components/strategy/StrategyTable.tsx` — `three_month?` on the row type; alias-first / blob-fallback 3M read
- `src/components/strategy/StrategyTable.test.tsx` — projected-row-shape render guard (T-159-10)
- `src/app/(dashboard)/compare/page.tsx` — `COMPARE_ANALYTICS_COLUMNS` + `EMPTY_ANALYTICS` composition
- `src/app/(dashboard)/compare/page.test.tsx` — select-recording harness + three projection pins
- `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx` — opts into the `"discovery"` variant; corrected prose
- `src/__tests__/phase-147-series-resolution-guards.test.ts` — corrected Layer A prose

## Issues Encountered

- **`PERCENTILE_ANALYTICS_COLUMNS` byte-freeze honoured.** This plan edits the same file plan 159-02 froze that constant in. Verified unchanged at HEAD: the grep still returns the exact seven-member string, one match. No projection here composes with it.
- **The 159-06 `audit-coverage` failure reported by plan 02 is NOT present on this base.** The full local suite is 786 files / 12042 tests / **0 failed**. Either it was fixed before my base (`e21661c0`) or it never reached this branch — reporting the measurement, not a conclusion.
- **No sibling-file contention.** `src/lib/closed-sets.ts` (plan 159-04's `blendPeriodsPerYear`) was **read but never edited**, as instructed.

## Orchestrator follow-ups (shared artifacts untouched)

I did **not** modify `STATE.md`, `ROADMAP.md`, `REQUIREMENTS.md` or `WINDOWS.md`.

1. **Mark RANK-02 complete** once every plan declaring it has a SUMMARY (shared-ID gate):
   ```bash
   gsd-tools query requirements.ready-ids .planning/phases/159-rank-public-ranking-integrity/159-03-PLAN.md RANK-02 --raw
   ```
2. **File the un-rendered composite-branch residual** (ready to run):
   ```bash
   gsd-tools windows append \
     --kind unrun-verify \
     --phase 159 \
     --file "src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx" \
     --description "159-03 narrowed getStrategyDetail to the discovery projection; the composite (dqf.composite===true) render branch was never exercised against real composite data — no dev-server spot-check was possible (worktree has no .env; TEST rows have null sparklines). Render one composite strategy on /discovery/<slug>/<id> before ship."
   ```
3. **File the anon-reachable metrics_json finding** (ready to run):
   ```bash
   gsd-tools windows append \
     --kind unmet-truth \
     --phase 159 \
     --file "src/lib/queries.ts" \
     --description "RANK-02's literal truth ('metrics_json absent from every anon-reachable response') does NOT hold: STRATEGY_V2_ANALYTICS_COLUMNS (anon /strategy/[id]/v2) and getFactsheetDetail (tearsheet) both project metrics_json, and data_quality_flags in v2's case. Both are load-bearing — removing them is a visual regression. Either scope RANK-02 to the splat class (as D-02 words it) or open a follow-up for an RPC/alias-set design."
   ```
4. **File the stale prose note** (optional, low priority):
   ```bash
   gsd-tools windows append \
     --kind todo \
     --phase 159 \
     --file "src/lib/queries.test.ts" \
     --line 848 \
     --description "Docblock says getStrategyDetailV2 fetches via '*, strategy_analytics (*)'; it has used STRATEGY_V2_* since its own conversion. Pre-existing, not falsified by 159-03, left untouched under Rule 3."
   ```

## Known Stubs

None — no placeholder values, no unwired components, no skipped tests introduced.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: information-disclosure | `src/lib/queries.ts` (`STRATEGY_V2_ANALYTICS_COLUMNS`) | Anon-reachable `/strategy/[id]/v2` projects `metrics_json` + `data_quality_flags`. Pre-existing, NOT introduced here, outside the splat class — but it is anon-reachable surface carrying two exclusion-list columns. See follow-up 3. |

The plan's own register is otherwise satisfied: **T-159-08** by the three conversions plus negative pins verified on the wire; **T-159-09** by pins that are neuterable regression tests plus the classified inventory above as the audit baseline; **T-159-10** by enumerate-before-cut, must-stay guard comments, and the render guard — with the composite-branch residual named honestly rather than closed by assertion.

## User Setup Required

None.

## Next Phase Readiness

- **RANK-02 is closed as a class** at the source level, with the closure auditable from the inventory above rather than from a promise.
- **Zero visual change is the intent and the evidence supports it for the list surface**; the discovery-detail composite branch is the one place a human should look before ship (follow-up 2).
- **Nothing here touches the percentile constants**, so plan 159-02's byte-freeze and plan 159-06's mirror prose are undisturbed. `closed-sets.ts` was not edited, so plan 159-04 should merge without conflict.

## Self-Check: PASSED

- All 8 modified files present on disk; **no files deleted** (`git diff --diff-filter=D` over the full plan range: empty)
- All 4 commits present on `worktree-agent-a4120a81630ca0ab2`: `1b600439`, `f17e2102`, `d8766356`, `d519eaed`
- `npx tsc --noEmit` clean; `npm run lint` clean (2 pre-existing warnings in untouched files); `check-admin-route-manifest` + `check-route-contract` OK
- Full local vitest: **786 files passed / 19 skipped, 12042 tests passed / 281 skipped, 0 failed**
- Task gates re-run at close: Task 1 awk region (114 lines, 0 splat hits), Task 2 public-constant awk region contains `computation_status`, compare file has 0 splat occurrences, Task 3 owner-region `.select(` line still carries the splat

---
*Phase: 159-rank-public-ranking-integrity*
*Completed: 2026-08-21*

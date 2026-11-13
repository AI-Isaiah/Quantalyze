# Phase 197: SCREEN - Research

**Researched:** 2026-11-08
**Domain:** Next.js 16 / React 19 client table (discovery `StrategyTable`), server-side admin-only data, `/compare` page and search
**Confidence:** HIGH (every in-repo claim was read at `feat/197-screen` HEAD `130c927ef` this session; no new package; no migration)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
(verbatim from `197-CONTEXT.md` `## Implementation Decisions`)

### Shared-account notice (discussed with the founder)
- **D-01 Audience: admins only.** Founder pick "Admins only" (2026-11-08). The notice ("Shares an exchange account with <other strategy>") renders only when the viewer is an admin; allocators, managers and visitors see nothing. This narrows ROADMAP SC-4 / CLAR-05 ("A listing says…"); the narrowing is recorded in the ROADMAP Phase 197 section as well (deviation policy). Built from stored data only (no new manager-entered data); no account identifiers shown.
- **D-02 Unpublished partner: nothing.** If the other strategy on the account is unpublished, the published one shows no notice; an unpublished strategy is never named or hinted at.

### Settled on the recommendation (founder left these to me, 2026-11-08)
- **D-03 Stale:** stale = the newest stored return day is older than 7 calendar days (crypto) / 10 calendar days (traditional). The phase names the field it reads; never `strategy_analytics.computed_at` (a recompute on old data is not fresh). Stale rows show "Data from <date>" and sort below all current rows within whatever sort is active; they are never removed. A test with a stale fixture goes RED on today's ranking.
- **D-04 Compare selection:** a checkbox per discovery row; a sticky "Compare (n)" bar appears from 2 selected, max 4; it opens `/compare` with those strategies. `/compare` gets an "Add strategy" search and no longer says adding is "not available yet".
- **D-05 Column headers:** the header itself states period and annualisation (e.g. "Return 1y, ann.", "Vol 1y, ann."), a tooltip carries the definition; volatility shows no sign; a "Track" column shows months of record.

### Carried forward
- Phase 194 figure gate: withheld figures read as withheld in discovery columns; definitions are 194's.
- Phase 195: do-nothing toggles already gone.

### Claude's Discretion
- How the shared-account link is derived from stored data (key/account fingerprint), admin check mechanism, compare URL format, threshold constant placement.

### Deferred Ideas (OUT OF SCOPE)
- None.

### Binding design contract
`197-UI-SPEC.md` (status `approved`, 2026-11-08) is the UI contract: decisions U-01..U-14, the copy table, the mount rules, assumptions A-1..A-5. The planner treats its copy and mount rules as locked. Where this research finds a UI-SPEC premise false, it says so below (two places: the "reuse the `duplicate_account` derivation" note, and the "shared-account line cannot fail separately" dismissal).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description (REQUIREMENTS.md:27, :37, :38, :41) | Research Support |
|----|-------------|------------------|
| ROUTE-05 | An allocator can select strategies in discovery and open Compare from the UI. | `/compare` already parses `?ids=` comma-separated, first 4 (`compare/page.tsx:63`). Selection lives in `StrategyTable` state behind an opt-in prop passed only by `discovery/[slug]/page.tsx`. Search reuses `GET /api/strategies/browse` (allocator-auth, rate-limited, pseudonymised names). See Patterns 4 and 5. |
| CLAR-01 | Every discovery column states its period and whether it is annualised; volatility carries no sign; a track-length column exists. | U-01 verified against `metrics.py`: every list scalar is computed over the full record or its post-break suffix; 6M is a 182-calendar-day window. The `+` comes from `formatPercent`'s `signed ?? true` default. Track reads `rowRecord(s).spanDays`. See Pattern 1 and "Verification of U-01". |
| CLAR-02 | A stale strategy is flagged in discovery and does not rank as if it were current. | `series_end` (`returns_series->-1->>date`) is already projected on the list read and reaches every shaped row. Today the ranking ignores it: a stale row with the best Sharpe renders `#1`. See Pattern 2 and the SC-3 RED test. |
| CLAR-05 (narrowed by D-01) | A listing says when two strategies draw on the same exchange account (admins only). | `api_keys` is owner-only under RLS, so the read must be service-role, gated on `isAdminUser` server-side, scoped to published strategies. No migration needed. Group by case-blind `(exchange, venue_account_id)` (the Python identity rule) plus same-key and holder-pointer identities. See Pattern 3. |
</phase_requirements>

## Summary

Every input this phase needs is already stored and, except one, already on the wire to the discovery table. The list read (`getStrategiesByCategory`, `src/lib/queries.ts:601`) projects `series_end:returns_series->-1->>date`, `series_start`, `headline_since` and `record_observations`, and the shaper hands them to `StrategyTable` on every displayed row. So the stale flag (CLAR-02), the Track column (CLAR-01) and the header qualifiers are pure client-side changes to `src/components/strategy/StrategyTable.tsx` and `StrategyGrid.tsx`. The volatility `+` is `formatPercent`'s default (`plus: options?.signed ?? true`, `src/lib/utils.ts:15`); the fix is `formatPercent(v, 2, { signed: false })` at the volatility cell.

The UI-SPEC's central premise (U-01: the headers say "Full record", not "1y") is **correct**. `compute_all_metrics` builds one `headline` series (the whole record, or the suffix after the last interior break) and every list scalar rides it; the stored 6M is a calendar window of 182 days ending on the headline's last date. Writing "1y" into a header would be false for every published strategy (194 measured all 3 under 365 points).

The shared-account notice is the only part that needs data the page does not have: `strategies.api_key_id` is not on the public projection and `api_keys` is readable only by its owner (`CREATE POLICY "api_keys_owner" ... USING (("user_id" = "auth"."uid"()))`). The existing, no-migration path is the one the admin pages already use: `isAdminUser(supabase, user)` on the user-scoped client, then `createAdminClient()` for the read, inside a `server-only` module, with the result passed to `StrategyTable` as a prop **only** when the viewer is an admin, so it is absent from a non-admin's RSC payload. `/compare`'s search reuses `/api/strategies/browse`, filtered client-side to published rows not already compared.

The heavy cost of this phase is not the features; it is the test and fixture fallout of changing a shared table that four pages mount: a hand-edited byte-pin fixture with no write path, cross-surface parity tests that assert the table and the tearsheet print the same volatility text, index-based and exact-text header helpers in about a dozen vitest files, and a seeded e2e spec in CI that hard-codes `rankI = 0; starI = 1` on `/discovery`. Plan for it explicitly.

**Primary recommendation:** Serialise the `StrategyTable.tsx` work into ordered plans (headers/Track/unsigned vol, then stale partition, then selection + bar, then the admin line), run the `/compare` work and the server-only shared-account reader in parallel (file-disjoint), add no migration, and give each `StrategyTable` plan its own budgeted test-fallout task.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Header labels, qualifiers, tooltips, unsigned vol, Track cell | Browser / Client (`StrategyTable`, `StrategyGrid`, "use client") | — | Pure presentation over row fields already shipped. |
| Stale verdict, stale ordering, no `#n`/`Pnn` on stale rows | Browser / Client (`StrategyTable` sort comparator and rank map) | Frontend Server (page seeds the "now" instant, recommended) | The partition must sit in the same comparator as STALE-01; the instant should come from the server so SSR and hydration agree (Pitfall 6). |
| Admin check | Frontend Server (RSC page, `isAdminUser`) | Database (`profiles.is_admin` RLS) | Never decided in the browser; fail closed. |
| Shared-account partner map | Frontend Server (`server-only` module, service-role read) | Database (`api_keys`, `strategy_keys`, `strategies`) | RLS forbids the read for a non-owner; the server computes names only and never ships account identifiers. |
| Selection state and sticky bar | Browser / Client (`StrategyTable` state) | — | U-13: not URL, not storage. |
| `/compare` id parsing, published-only read, Remove hrefs | Frontend Server (`compare/page.tsx`) | — | Already server-side; Remove hrefs are computed from the parsed `ids`. |
| `/compare` "Add strategy" search | Browser / Client (new client component) | API (`GET /api/strategies/browse`) | Reuses the catalogue endpoint, its auth, rate limit and pseudonymity. |

## Verification of U-01 (headers depend on it)

**Claim:** the discovery headline figures (Return, CAGR, Sharpe, Volatility, Max DD) are full-record or since-last-break, and 6M is 182 calendar days. **Verdict: TRUE.** [VERIFIED: analytics-service/services/metrics.py, read this session]

- `metrics.py:1959-1962` (verbatim): `headline = _suffix if _chain_broken else returns` / `headline_since: str | None = (` / `_suffix.index[0].strftime("%Y-%m-%d") if _chain_broken else None`. The comment above it (`:1943-1955`) states "EVERY headline-class stat below reads it".
- `stat_returns` is built from `headline` (`:1971-1975`); Sharpe reads it (`:2258`, `sharpe = _safe_float(_annualized_vol_sharpe(stat_returns, periods_per_year)[1])`), Volatility reads it (`:2209-2213`, `qs.stats.volatility(stat_returns, periods=periods_per_year, prepare_returns=False)`), Max DD reads `_wealth = (1.0 + headline.fillna(0)).cumprod()` (`:2161-2166`). Cumulative return on the geometric path is `cumulative_twr_segmented(returns)[0]` (`:2108`), which compounds only the post-break suffix (comment `:2043-2047`); the simple path raises on any interior NaN (`:2049-2057`), so it can have no break.
- Annualised: CAGR (calendar-clock compound, `:2108-2137`), Sharpe (`× sqrt(periods)`), Volatility (`periods=periods_per_year`). Not annualised: cumulative return, Max DD, 6M.
- 6M: `SIX_MONTH_WINDOW_DAYS = 182` (`metrics.py:227`) and `six_month = _calendar_window_return(headline, SIX_MONTH_WINDOW_DAYS, _bucket_return)` (`:2385`); `_calendar_window_return` keeps "dates strictly after ``last date - days``" (`:876-885`), so the window is the 182 calendar days ending on the record's last day, and `None` when the record does not cover it. TS twin: `export const SIX_MONTH_WINDOW_DAYS = 182;` (`src/lib/factsheet/compute.ts:12`).

**Consequence for headers:** D-05's example "Return 1y, ann." is a *format*, not a period. The UI-SPEC's "Full record · not ann." etc. are the true periods. Note a subtlety the tooltip already handles: on a stale row, "Last 6 months" means the 6 months ending on the record's last day, not the 6 months before today.

## Standard Stack

No new library. Everything is in-repo.

### Core (in-repo, reused)
| Module | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.4.2 (main checkout `node_modules`) | App Router RSC pages, `next/link`, `useRouter` from `next/navigation` | Project framework [VERIFIED: node_modules/next/package.json] |
| react | 19.3.1 | client state, `useId` | Project framework [VERIFIED: node_modules/react/package.json] |
| `src/components/strategy/annualized-cell.tsx` | in-repo | `rowRecord(s)`, `annualizedCell` | 194's list gate; Track reads `rowRecord(s).spanDays` |
| `src/lib/figure-gate.ts` | in-repo | `figureRecord`, `figureSpan`, `gateAnnualized`, `ONE_YEAR_DAYS`, copy helpers | Single source for the record span (D-20 covered days) |
| `src/lib/freshness.ts` | in-repo | `SERIES_STALE_DAYS = 7`, `SERIES_END_FUTURE_ALLOWANCE_DAYS`, the series age bucket | Crypto stale threshold is already this constant |
| `src/lib/list-figures.ts` | in-repo | `compareWithMissingLast`, `isMissingFigure`, `rangeMatches` | D-09 missing-last sort (Track unknown sorts last) |
| `src/lib/admin.ts` | in-repo | `isAdminUser(supabase, user)` | The one admin rule; never throws, fails closed |
| `src/lib/supabase/admin.ts` | in-repo | `createAdminClient()` (`import "server-only"`) | Service-role read for the partner map |
| `src/lib/visibility.ts` | in-repo | `withPublishedOnly(query)` | Published-only predicate; works on the service-role builder (comment `:82-88`) |
| `GET /api/strategies/browse` | in-repo | catalogue for the `/compare` search | Allocator auth, per-user rate limit, `displayStrategyName` pseudonymity |
| `src/components/ui/Tooltip.tsx`, `Button.tsx`, `Input.tsx` | in-repo | header definitions, bar buttons, search field | UI-SPEC primitives |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Service-role read gated by `isAdminUser` | A `SECURITY DEFINER` RPC that checks `is_admin()` and returns partner pairs | Needs a migration: TEST-first apply, auto-apply to PROD with no human stop (CLAUDE.md 2026-09-23), migration-reviewer + rls-policy-auditor. Buys nothing here because the page already runs server-side and the admin pages already use this exact pattern. Rejected. |
| Grouping by `(exchange, venue_account_id)` | `api_keys.account_shared_with_api_key_id` alone | The pointer is SAME-OWNER only and LIVE-holder only (migration `20260925120000` comment: "the holder must exist, belong to the same owner, be live"). The founder's intended case is one exchange account under several logins (different owners), which the pointer cannot express. PROD: 14 strategy keys carry a venue id, only 2 carry a pointer. Use the venue pair; fold the pointer in as an extra identity (cheap, covers nothing the pair misses today but costs nothing). |
| New search API route | `GET /api/strategies/browse` | A new route needs `check-route-contract` / admin-route-manifest entries, auth, rate limit, pseudonymity. The existing one has all four. |
| Selection in URL or localStorage | Table state (U-13) | Locked by the UI-SPEC. |

**Installation:** none.

## Package Legitimacy Audit

No external package is installed by this phase. `package-legitimacy check` was not run because the package list is empty.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none) | — | — | — | — | — | — |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 /discovery/[slug] (RSC, allocator-gated by discovery/layout.tsx)
   │
   ├─ getStrategiesByCategory(slug) ── user-scoped client, withPublishedOnly,
   │      projects series_end/series_start/headline_since/record_observations
   ├─ getPercentiles, getRealPortfolio, getMyWatchlist (unchanged)
   ├─ isAdminUser(supabase, user) ──false──────────────────────────────┐
   │        │true                                                       │
   │        ▼                                                           │
   │   getSharedAccountPartners()  [server-only, createAdminClient]     │
   │     strategies(status=published) ∪ strategy_keys → api_keys        │
   │     identity = key id | holder id | lower(exchange)+venue id       │
   │     → { strategyId: [published partner names] }   (no account ids) │
   │        │ (error → Sentry, no notices)                              │
   ▼        ▼                                                           ▼
 <StrategyTable strategies selectable sharedAccountPartners? nowMs? ...>   (prop OMITTED
   │                                                                   for non-admins:
   │  client:                                                          not in RSC payload)
   │  filter → stale verdict (series_end vs nowMs, 7d crypto / 10d other)
   │        → sort: [displayed & current] [displayed & stale|unknown] [undisplayed]
   │                 each partition by active key, missing-last
   │        → rankOrdinals over current rows only; Pnn only on current rows
   │        → render: Track cell, 2-line headers + Tooltip, unsigned vol,
   │                  stale chip, admin line, select checkbox
   │        → sticky bar (≥2 selected) ──Link──► /compare?ids=a,b,c
   ▼
 /compare (RSC, allocator-gated)
   ├─ parse ids (≤4, holdings + strategies) → withPublishedOnly read
   ├─ CompareTable (+ per-column Remove link, server-computed href)
   └─ <CompareAddStrategy currentIds> (client) ──fetch once──► GET /api/strategies/browse
          filter: published, not already compared, name/codename match ≥2 chars
          choose → router.push("/compare?ids=<existing>,<new>")
```

### Recommended Project Structure (new files only)
```
src/lib/discovery/
├── shared-account-partners.ts       # import "server-only"; service-role read + pure grouping
└── shared-account-partners.test.ts  # grouping, published-only, no identifiers in output
src/lib/
└── freshness.ts                     # + traditional stale constant + pure stale verdict (extend, do not fork)
src/components/strategy/
├── StrategyTable.tsx                # DISCOVERY_COLUMNS map, Track, stale, selection, bar, admin line
├── StrategyTable.stale-series.test.tsx   # SC-3 RED-first test (new)
├── StrategyTable.selection.test.tsx      # ROUTE-05 bar/cap/persistence (new)
└── StrategyTable.headers.test.tsx        # CLAR-01 qualifiers, unsigned vol, Track (new)
src/app/(dashboard)/compare/
├── CompareAddStrategy.tsx           # "use client" combobox (new)
└── CompareAddStrategy.test.tsx      # (new)
src/app/(dashboard)/discovery/[slug]/
└── page.test.tsx                    # admin gate + prop absence (new; no page test exists today)
```

### Pattern 1: one column map, read by table and grid (CLAR-01)
**What:** Replace the `COLUMNS` array's single `label` with a label + qualifier + tooltip + accessible-name record, and have `StrategyGrid`'s footer read the same map (U-07).
**At HEAD** [VERIFIED: src/components/strategy/StrategyTable.tsx:304-317]:
```ts
const COLUMNS: { key: TableSortKey; label: string; align?: "right"; }[] = [
  { key: "name", label: "Strategy" },
  { key: "cumulative_return", label: "Return %", align: "right" },
  { key: "cagr", label: "CAGR", align: "right" },
  { key: "sharpe", label: "Sharpe", align: "right" },
  { key: "max_drawdown", label: "Max DD", align: "right" },
  { key: "volatility", label: "Volatility", align: "right" },
  { key: "six_month_return", label: "6 Month", align: "right" },
  { key: "aum", label: "AUM", align: "right" },
];
```
The two sparkline headers and Actions are written inline after the map (`:1293-1295`: `>Return</th>`, `>Underwater</th>`, `>Actions</th>`).
**Track sort key:** `type TableSortKey = SortKey | "name" | "six_month_return" | "created_at";` (`StrategyTable.tsx:100`). Add `"track"` to `TableSortKey` only, never to `SortKey` (`src/lib/discovery-types.ts:13-20`): `SortKey` is validated by the prefs codec (`VALID_SORT_KEYS`, `src/lib/discovery-prefs.ts:29`), so a persisted `"track"` would need a codec change. `getSortValue` gains `case "track": return rowRecord(s).spanDays;` (null sorts last via `compareWithMissingLast`).
**Unsigned volatility:** at HEAD `const volatilityText = formatPercent(volatilityShown);` (`StrategyTable.tsx:1312`) and `formatPercent` defaults to signed (`plus: options?.signed ?? true`, `src/lib/utils.ts:15`). Change to `formatPercent(volatilityShown, 2, { signed: false })`; the `annualizedCell`/withheld path is unchanged.
**Track months:** `floor(spanDays × 12 / 365.25)` per UI-SPEC, where `spanDays` is `rowRecord(s).spanDays`, the D-20 covered-days count from the later of `series_start` and a readable `headline_since` (`figureSpan`, `src/lib/figure-gate.ts:95-106`). The `title` needs the start date; `figureSpan` does not return it. Add one exported helper in `figure-gate.ts` that `figureSpan` itself calls for its start (so the title and the span cannot disagree), rather than re-deriving "later of start and headline_since" in the table.

### Pattern 2: the stale partition (CLAR-02, D-03)
**Field:** `strategy_analytics.returns_series` last date, projected as `series_end:returns_series->-1->>date` in `CATEGORY_RANKING_ANALYTICS_COLUMNS` [VERIFIED: src/lib/queries.ts:576-577, the constant contains the literal `series_end:returns_series->-1->>date`]. Never `computed_at` (PROD: one published crypto strategy's series ends 177 days ago while `computed_at` is today), never `trades_fetched_at`.
**Why the last element is the newest day:** the writer refuses a non-monotonic index (`queries.ts:517-522` cites `metrics.py:491-499`), and the 5000-point cap keeps the most recent points: `def cap_data_points(data: list[Any], max_points: int = 5000)` / `"""Truncate data to max_points, keeping the most recent."""` / `return data[-max_points:]` [VERIFIED: analytics-service/services/transforms.py:436-440].
**Thresholds:** `export const SERIES_STALE_DAYS = 7;` already exists [VERIFIED: src/lib/freshness.ts:124] and is what `SyncBadge`'s series ladder calls `stale` (`if (days <= SERIES_STALE_DAYS) return "warm"; return "stale";`, `:269-270`). Reuse it for crypto; add one sibling constant for the 10-day traditional threshold beside it. Crypto vs traditional comes from `annualizationPeriods(asset_class)`: `return assetClass === "crypto" ? 365 : 252;` [VERIFIED: src/lib/closed-sets.ts:616-620] (a null `asset_class` reads as traditional, so it gets 10 days).
**Age arithmetic:** mirror `bucketSeriesAge` (`freshness.ts:250-271`): whole elapsed UTC days, `Math.floor((now - seriesEndMs) / 86_400_000)`, so "older than 7 days" means `days > 7`, the same boundary as the badge's red arm. Put the verdict in `freshness.ts` as one exported pure function (e.g. `listSeriesVerdict(seriesEnd, assetClass, nowMs) → "current" | "stale" | "unknown"`) so the table, the grid and the tests share it.
**Where it plugs in:** the existing STALE-01 comparator, right after its displayed/undisplayed check (`StrategyTable.tsx:903-907`):
```ts
if (effectiveSortKey !== "created_at") {
  const aRanked = isRankedRow(a);
  const bRanked = isRankedRow(b);
  if (aRanked !== bRanked) return aRanked ? -1 : 1;
}
// 197: then current-before-stale among displayed rows, same direction-independence,
// then compareWithMissingLast(getSortValue(...), ..., effectiveSortDir)
```
and the rank map (`:940-947`), which must count current displayed rows only. `pctSuffix` (`:1045-1061`) must return null for a stale row (U-09). Gate everything on `visibility === "published-only"` so the two owner mounts are unchanged (U-04). Decide explicitly whether the `created_at` exemption also exempts the stale partition; `created_at` sort exists only on the manager mount, where stale does not apply, so it is moot in practice.
**Not removed:** `filtered` keeps the row; only order, `#n` and `Pnn` change.

### Pattern 3: admin-only partner map, server-side (CLAR-05, D-01, D-02)
**Why server-side and service-role:** `CREATE POLICY "api_keys_owner" ON "public"."api_keys" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));` [VERIFIED: supabase/schema/baseline.sql:16434] is the only `api_keys` policy, and `strategy_keys` is likewise owner-only (`CREATE POLICY "strategy_keys_owner" ... USING (("owner_id" = "auth"."uid"()))`, `baseline.sql:17036`). `GRANT SELECT (venue_account_id) ON api_keys TO authenticated;` (`migrations/20260920120000_api_keys_venue_account_id_grant.sql`) is a column grant still scoped by that owner RLS. The public list projection carries no `api_key_id`. So no user-scoped read can see another user's key; an admin read needs the service role.
**Precedent:** `src/app/(dashboard)/admin/page.tsx:21-23`: `if (!(await isAdminUser(supabase, user))) redirect(...)` then `const admin = createAdminClient();`.
**Admin check fails closed:** `isAdminUser` "never throws to the caller"; `hasIsAdminFlag` returns `false` on any error (`src/lib/admin.ts:203-231`), `hasAdminRoleRow` likewise (`:164-190`).
**Identity rule (mirror the Python one, do not invent one):** `account_identity_collisions` groups on `(exchange_key, venue_id.strip())` with `exchange_key = exchange.strip().lower()`, and "A NULL or blank venue id is unknown identity ... and never collides here" [VERIFIED: analytics-service/services/job_worker.py:15272-15301]. For a listing (no book, no counted days), drop the interval-overlap part: two strategies share an account when they share any identity, where each key contributes `key:<api_key_id>`, `key:<account_shared_with_api_key_id>` when set, and `venue:<lower(trim(exchange))>:<trim(venue_account_id)>` when the venue id is non-blank. A strategy's keys are `strategies.api_key_id` ∪ `strategy_keys.api_key_id` (composites), the same union `get_published_trade_venues` uses (`baseline.sql:7156` comment: "reached through strategies.api_key_id and strategy_keys").
**Published only, by construction (D-02):** read `withPublishedOnly(admin.from("strategies").select("id, name, api_key_id"))`. Because the service role bypasses RLS, that predicate is the ONLY fence; pin it with a test that seeds an unpublished partner and asserts it is never named and never makes a published row show a notice. Reading only published strategies means an unpublished partner can never enter a group, so "never named, counted or hinted at" holds structurally.
**Output shape:** `Record<strategyId, string[]>` of partner **names** (the same `strategies.name` the discovery row prints), sorted deterministically. Never an exchange, venue id, key id or label. Select only `id, exchange, venue_account_id, account_shared_with_api_key_id` from `api_keys`, never the encrypted columns.
**RSC payload:** "The RSC Payload contains: ... Any props passed from a Server Component to a Client Component" [CITED: node_modules/next/dist/docs/01-app/01-getting-started/ (server-and-client-components), line 113-117]. So the page must not call the reader, and must not pass the prop (not even `{}`), unless `isAdminUser` is true.
**Failure:** the UI-SPEC dismissal "computed with the list ... cannot fail separately" is not accurate: this is a separate read. Recommend: on error, `captureToSentry` + log, render no notices (fail closed), never throw (an admin-only informational line must not take discovery down). See Open Question 2.
**The UI-SPEC's "reuse the `duplicate_account` derivation behind `EquityHistoryRebuilding.tsx:237`" cannot be followed literally:** that line renders a Python refusal token (`account_identity_collision` / `account_duplicate`) read from a derived allocator BOOK payload (`untrustworthyRebuildReason`, `src/lib/queries.ts:5087-5130`). It is per-book and per-owner, not per-listing. What is reusable is the identity RULE behind it (above).

### Pattern 4: selection column and sticky bar (ROUTE-05, D-04)
- Opt-in prop (e.g. `selectable`) passed only by `discovery/[slug]/page.tsx`. `/browse/[slug]` and the owner mounts never pass it; pin that with an absence test next to pin 2 of `src/__tests__/phase-149-my-strategies-parity.test.ts:440-457` (which already asserts the public pages pass no `visibility=`, `placeholderKeys`, `managerRows`, ...).
- `usePinnedStackOffsets` (`StrategyTable.tsx:128-159`) measures rank and star widths into `--pin-star-left` / `--pin-strategy-left`; extend it to measure the select cell first (UI-SPEC: no px literal).
- `emptyRowColSpan` (`:1024-1025`) must count the select column and the Track column.
- Href: `/compare?ids=${ids.join(",")}` in selection order, at most 4. `/compare` parses exactly that: `const ids = params.ids?.split(",").filter(Boolean).slice(0, 4) ?? [];` [VERIFIED: src/app/(dashboard)/compare/page.tsx:63]. Strategy ids are server UUIDs, so no encoding issue; still build the string from ids only.
- Selection keyed by strategy id survives paging/sort/filter/scope/view; reset on category change is free because both pages key the table by slug (`key={`${user.id}:${slug}`}`, `discovery/[slug]/page.tsx`).

### Pattern 5: `/compare` "Add strategy" and Remove (ROUTE-05)
- **Copy to delete** [VERIFIED: compare/page.tsx:80 and :301]: `Adding strategies to a comparison from this page is not available yet.` and `One strategy selected. Adding a second strategy from this page is not available yet.`
- **Search source:** `GET /api/strategies/browse` (`withAllocatorAuth`, `userActionLimiter`, `withPublishedOrOwner(...)` at `route.ts:173`, `STRATEGY_BROWSE_LIMIT = 200` at `:128`, alphabetical, no server-side query parameter). It returns the caller's OWN unpublished rows too (with `status` on own rows only) and pseudonymises everyone else's name through `displayStrategyName`. `/compare` renders published only (`withPublishedOnly`, `page.tsx:93`), so the client must drop rows where `isOwn === true && status !== "published"`, then drop ids already in the URL. Fetch once on first qualifying input (the `StrategyBrowseDrawer` idiom, `allocations/components/StrategyBrowseDrawer.tsx:223-270`, AbortController), filter on `name` and `codename` client-side (the drawer's `:338-348`), debounce 250 ms.
- **Navigation:** `router.push` from `next/navigation` with a path built from ids only. Next 16 docs: "You must not send untrusted or unsanitized URLs to `router.push`" [CITED: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md].
- **Remove links:** `CompareTable` is a client component that sees only items, not the URL. Compute a `removeHref` per strategy id in `page.tsx` from the parsed `ids` (holdings kept, order kept) and pass it down; `/compare` with no ids remaining is `/compare`.
- **State split:** the page already branches on `ids.length === 0`, `items.length === 0` and `items.length === 1` (`page.tsx:65`, `:224`, `:299`). The search renders in the empty, all-unavailable, one-item and two-or-three-item states, not at four (holding ids count toward 4).
- `PageHeader title="Compare strategies"` in the empty state is an e2e anchor (`e2e/reflow-sweep-authed.spec.ts:382`, `e2e/layout-narrow.spec.ts:1147`): keep it.

### Anti-Patterns to Avoid
- **Computing the partner map in `getStrategiesByCategory`:** that function serves anonymous `/browse` too. Keep admin data in its own server-only module called from the discovery page only.
- **Passing `sharedAccountPartners={isAdmin ? map : {}}`:** an empty object is still a prop and still a signal; omit the prop for non-admins.
- **Re-deriving "is this row displayed" or the stale verdict inline in the render:** STALE-01's rule is one hoisted predicate shared by sort, rank and render (`isDisplayedRow`, `:288-294`). Add the stale verdict the same way.
- **Restating 7, 10, 90, 365 as literals in the table:** import the constants (194 rule: "no helper restates 60, 90 or 365").
- **A new `SortKey`:** see Pattern 1.
- **Unsigning volatility with a string replace:** use the formatter option.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Record length in days | a new span count from `series_start`/`series_end` | `rowRecord(s).spanDays` (`figureSpan`, D-20 covered days, headline_since aware) | The 194 gate, the Track column and the figures beside it must count the same record |
| Series age | a new date diff | the `bucketSeriesAge` arithmetic in `freshness.ts` (UTC whole days, future allowance) | The badge and the chip must not disagree about the same day |
| Missing-last sort | an inline null check | `compareWithMissingLast` | D-09 contract, both directions |
| Admin decision | a `profiles.is_admin` query in the page | `isAdminUser` | One rule, fail closed, ADR-0005 |
| Published predicate | `.eq("status","published")` literal | `withPublishedOnly` | Pinned helper; works on the service-role builder |
| Catalogue search + pseudonymity | a new route or a raw `strategies` read in the client | `GET /api/strategies/browse` | Auth, rate limit, `displayStrategyName` already there |
| Tooltip | a CSS hover bubble | `src/components/ui/Tooltip.tsx` | Portaled out of the table's `overflow-x-auto`, `role="tooltip"` |

**Key insight:** every hard part of this phase (record length, staleness, publication, pseudonymity, admin) already has exactly one owner in the repo, and the shared table is mounted by an anonymous page. A second copy of any of these rules is how two surfaces start disagreeing about one strategy.

## Runtime State Inventory

Not a rename/refactor/migration phase. Header text changes, but no stored data, live config, OS registration, secret or build artifact embeds the old header strings. Verified by grep: the old labels occur in source and tests only (see Pitfall 3 list); the persisted discovery prefs store a `SortKey`, not a label, and this phase adds no `SortKey`.

## Common Pitfalls

### Pitfall 1: U-08 turns every existing published-only fixture into "Data date unknown"
**What goes wrong:** most `StrategyTable` test fixtures carry no `series_end` (e.g. `StrategyTable.stale-analytics.test.tsx` `analyticsEmbed`, `:151-172`; `StrategyTable.default-mounts.test.tsx` `makeAnalytics`). Under U-08 an unreadable newest day ranks with the stale rows, so the LIVE control rows lose `#1`. Counted at HEAD: 13 rank-text assertions in `StrategyTable.stale-analytics.test.tsx`, 3 in `StrategyTable.test.tsx`, plus published-only mounts elsewhere.
**How to avoid:** give every published-only control fixture a current `series_end` relative to a frozen clock (`vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime`, the default-mounts idiom). Do not weaken U-08 to make old tests pass.
**Warning sign:** a red `toBe("#1")` on a row named "Live" or "Alpha".

### Pitfall 2: the byte-pin fixture has no write path
**What goes wrong:** `StrategyTable.default-mounts.test.tsx` compares each mount's `innerHTML` to `__fixtures__/strategy-table-default-mounts.json` and states "THIS TEST HAS NO WRITE OR UPDATE PATH, on purpose ... the fix is the SOURCE, never a regenerated fixture." Every StrategyTable plan changes all three pinned mounts (Track column, two-line headers, Tooltip wrappers, "Return curve", unsigned volatility; on discovery/browse also the "Data date unknown" chips and `—` rank cells, because those fixture rows have no `series_end` and `FROZEN_NOW = new Date("2026-10-10T12:00:00Z")`).
**How to avoid:** follow the file's own convention: a dated "SURGICAL EDIT" paragraph per change, hunks counted per mount, edited by hand. Budget it as its own task per plan. Decide up front whether the fixture rows get a `series_end` (fewer stale hunks, but SyncBadge then renders a series dot, more hunks) and record the choice.

### Pitfall 3: header-text and column-index helpers across ~12 test files and one CI e2e spec
**What goes wrong:** helpers locate columns by header text (exact: `cellUnderHeader`, `StrategyTable.test.tsx:781-790`, `(th.textContent ?? "").trim() === label`; prefix: `tableCell`, `figure-parity-pages.test.tsx:371-378`; `metricCell`, `StrategyTable.test.tsx:1545-1551`) or by fixed index (`cellText(priv, 6)` for Volatility, `StrategyTable.visibility.test.tsx:351`). Track inserted after Strategy shifts every index by one; qualifiers break exact matches; three headers now start with "Return".
Files at HEAD that name the old labels or indices: `StrategyTable.test.tsx`, `StrategyTable.visibility.test.tsx`, `StrategyTable.manager-rows.test.tsx` (header list `:174-182`, `columnheader` `Sharpe` `:956-1015`), `StrategyTable.phone-columns.test.tsx:115`, `src/__tests__/phase-52-container-tabular-nums.test.tsx:230-267`, `src/__tests__/figure-parity-pages.test.tsx:525-604`.
**e2e (runs in CI):** `e2e/layout-narrow.spec.ts` is in the seeded list (`.github/workflows/ci.yml:7056`). It finds columns with `startsWith("Return %")` (`:609`, `:858`, `:1633`, `:2016`) and, on `/discovery/crypto-sma`, hard-codes `const rankI = 0;` / `const starI = 1;` (`:2013-2014`). The select column (index 0 on discovery) and Track change both. A miss reads `<missing>` and fails loudly, but only in the seeded e2e job, after push.
**How to avoid:** a grep census task per plan: `grep -rn -a -E '"Return %"|"6 Month"|"Volatility"|cellText\(|rankI|starI|startsWith\(' src e2e`, update, and run the vitest files locally. Accessible names change too (`getByRole("columnheader", { name: "Sharpe" })` matches the header's accessible name, which will now include the qualifier).

### Pitfall 4: the cross-surface parity test asserts the table and the tearsheet print the same volatility text
**What goes wrong:** `figure-parity-pages.test.tsx` "the StrategyTable and the tearsheet print the SAME text for every metric they share" (`:579-600`) compares `Volatility` text, and the StrategyTable case asserts `formatPercent(stored.volatility)` (signed) (`:561`). Unsigning the table makes it red while the tearsheet (Phase 196's file, out of scope) still prints `+`. `CompareTable` also prints `+` (UI-SPEC A-3).
**How to avoid:** this is a real conflict, not a test to "fix": CLAR-01 is scoped to discovery, D-05 says volatility shows no sign, and the tearsheet belongs to 196. Recommend: the parity test compares Volatility by value with the sign stripped on the table side, with a dated note, and the tearsheet/CompareTable `+` is booked for Phase 201 (whose ROADMAP section already depends on 196 and 197). Raise it to the founder only if the planner prefers widening 197.
Also: `StrategyTable.stale-analytics.test.tsx:139` `STALE_TEXT` contains `"+18.55%"`; after unsigning, a leaked volatility would print `18.55%` and the leak assertion would pass vacuously. Change that entry to `"18.55%"` (a substring of both forms).

### Pitfall 5: DESIGN.md's Numbers Contract says percentages are signed
**What goes wrong:** `DESIGN.md:157`: "Percentages | 1 decimal place, **signed** — a `+` prefix on gains". Volatility is not a gain, but the contract does not carve it out, and CLAUDE.md says "Do not deviate without explicit user approval."
**How to avoid:** D-05 ("volatility shows no sign") is the founder's approval. Add one dated line to the Numbers Contract recording that a figure that cannot be negative (volatility) carries no sign, citing 197 D-05, so a later QA pass does not flag it.

### Pitfall 6: the stale verdict depends on the clock in a client component that is server-rendered
**What goes wrong:** `const [mountedAtMs] = useState(() => Date.now());` (`StrategyTable.tsx:601`) runs once on the server render and again on hydration. Today it only feeds a filter that is empty on first paint. The stale verdict changes row ORDER and text, so a different day on the client (a skewed client clock, or a UTC midnight between render and hydrate) is a text hydration mismatch. The seeded e2e lane runs a hydration guard that fails on these (`e2e/helpers/hydration-guard.ts`).
**How to avoid (recommended):** the discovery and browse pages pass a server instant (e.g. `nowMs={Date.now()}`) and the table seeds `mountedAtMs` from it when present. `SyncBadge` already calls `Date.now()` in render (`SyncBadge.tsx:115`, `:213`), so this risk class exists today; do not widen it to ordering.

### Pitfall 7: the service-role read has no RLS backstop
**What goes wrong:** `createAdminClient()` bypasses RLS. If the published predicate is dropped, unpublished names enter the partner map; if the module is imported somewhere client-reachable, the key leaks.
**How to avoid:** `import "server-only"` in the module (as `src/lib/supabase/admin.ts` does), `withPublishedOnly` on the strategies read, a test with an unpublished partner fixture, and the page test asserting the reader is not called at all for a non-admin.

### Pitfall 8: Phase 196 also edits `StrategyTable.tsx` and the two category pages
**What goes wrong:** 196's UI-SPEC (Back Link Contract D-01) adds an origin prop to `StrategyTable` and rewrites the name link (`/factsheet/${s.id}` gains `from`/`cat` params), and touches `browse/[slug]/page.tsx` (the signed-in sign-up box). 197 edits the same Strategy cell (chip, admin line) and the same pages. `e2e/layout-narrow.spec.ts` anchors rows by `a[href="/factsheet/${s.id}"]`, which 196's change will also move.
**How to avoid:** anchor every edit by symbol, not line; whichever phase merges second rebases and re-runs the default-mounts pin; do not reflow the Strategy cell. 194.1 does NOT touch `StrategyTable.tsx`, `StrategyGrid.tsx`, `compare/page.tsx` or `CompareTable.tsx` (its plan split, `feat/194.1-d04sweep:.../194.1-RESEARCH.md` "Plan split": "StrategyTable.tsx/FactsheetView.tsx are free, and 194.1 touches neither"; its plan 08 touches `HoldingFactsheet.tsx` and `compare/lib/holding-compare-adapter.ts`, and its plan 12 touches `queries.ts` `getStrategyDetailV2` only). 194.1 plan 01 adds `src/__tests__/figure-gate-census.test.ts` with an allow-list; if it scans for annualised-figure sites, 197's new volatility/Track cells may need an allow-list entry after rebase.

### Pitfall 9: percentile cohorts still include stale peers
**What goes wrong:** U-09 removes a stale row's own `Pnn`, but `getPercentiles` (server) still ranks current rows against a population that includes stale rows, so a current row's `P82` is partly "relative to dead records".
**How to avoid:** out of the UI-SPEC's scope and touches `getPercentiles` (pinned by phase-149 pin 5). Recommend leaving the cohort unchanged and booking it; see Open Question 3.

### Pitfall 10: SyncBadge and the stale chip disagree for traditional rows aged 8-10 days
**What goes wrong:** the badge's series ladder is 3/7 days for every asset class, so a traditional row 8-10 days old shows the badge's red series dot while it ranks as current (D-03's 10 days). UI-SPEC A-4 books the colour clash for crypto; this is the second half of it.
**How to avoid:** do not change `SyncBadge` (shared with portfolio tables). Book the reconciliation with A-4.

## Code Examples

### Stale verdict (place in `src/lib/freshness.ts`, beside `SERIES_STALE_DAYS`)
```ts
// Source: pattern of bucketSeriesAge (src/lib/freshness.ts:250-271) and D-03.
// SERIES_STALE_DAYS (7) and SERIES_END_FUTURE_ALLOWANCE_DAYS already exist in this module.
export const SERIES_STALE_DAYS_TRADITIONAL = 10; // [ASSUMED name] D-03
export type ListSeriesVerdict = "current" | "stale" | "unknown";
export function listSeriesVerdict(
  seriesEnd: string | null | undefined,
  periodsPerYear: number,          // annualizationPeriods(asset_class)
  nowMs: number,
): { verdict: ListSeriesVerdict; ageDays: number | null; thresholdDays: number } {
  const thresholdDays = periodsPerYear === 365 ? SERIES_STALE_DAYS : SERIES_STALE_DAYS_TRADITIONAL;
  if (!seriesEnd) return { verdict: "unknown", ageDays: null, thresholdDays };
  const endMs = Date.parse(`${seriesEnd.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(endMs)) return { verdict: "unknown", ageDays: null, thresholdDays };
  const ageDays = Math.floor((nowMs - endMs) / 86_400_000);
  return { verdict: ageDays > thresholdDays ? "stale" : "current", ageDays, thresholdDays };
}
```

### Admin-gated page wiring (discovery page)
```tsx
// Source: src/app/(dashboard)/admin/page.tsx:21-23 pattern; isAdminUser never throws.
const isAdmin = await isAdminUser(supabase, user);
const partners = isAdmin ? await getSharedAccountPartners() : null; // null on read error too
// existing props (key, strategies, categorySlug, portfolioId, userId, initialWatchedSet,
// percentiles) stay as they are; only the two lines below are new.
<StrategyTable
  selectable
  {...(partners ? { sharedAccountPartners: partners } : {})}
/>
```

### Partner grouping core (pure, unit-testable)
```ts
// Source: identity rule of account_identity_collisions (analytics-service/services/job_worker.py:15272-15301)
function identities(k: { id: string; exchange: string | null; venue_account_id: string | null;
                         account_shared_with_api_key_id: string | null }): string[] {
  const out = [`key:${k.id}`];
  if (k.account_shared_with_api_key_id) out.push(`key:${k.account_shared_with_api_key_id}`);
  const v = k.venue_account_id?.trim();
  if (v) out.push(`venue:${(k.exchange ?? "").trim().toLowerCase()}:${v}`);
  return out;
}
// strategy -> union of identities of its keys (strategies.api_key_id ∪ strategy_keys.api_key_id);
// partners(s) = published strategies t ≠ s sharing ≥1 identity; emit names only.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `computed_at` as freshness | `series_end` (series last date) | Phase 163 HONEST-08 | The list already projects it; 197 uses it for ranking, not only for the badge |
| Row-count 6M (126 rows) | calendar 182 days | 194 D-03 (`FIGURE_DEFS_VERSION = 2`) | Header "Last 6 months" is accurate |
| Window-length gate | total-record gate (90 d / 60 obs) | 194 D-15 | Track and the `<1y` marker read the same record |

**Deprecated/outdated:** the UI-SPEC/CONTEXT line numbers `page.tsx:75` / `:266` (ROADMAP) are stale: the sentences are at `:80` and `:301` today.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Two strategies "draw on the same exchange account" whenever any of their keys share an identity, at any time (no interval-overlap test, departed keys included) | Pattern 3 | A rotated-away key could name a partner the admin considers unrelated; low impact (admin-only, informational) |
| A2 | Composite members (`strategy_keys`) count as the strategy's accounts | Pattern 3 | Under-reports sharing for composites if excluded; over-reports if a member window is long past |
| A3 | A `series_end` more than one day in the future is treated as `current` (it is not older than the threshold) | Code Examples | A future-stamped row ranks as current; SyncBadge already shows its muted "future" dot |
| A4 | Name of the new constant/function (`SERIES_STALE_DAYS_TRADITIONAL`, `listSeriesVerdict`) | Code Examples | Cosmetic; planner names them |
| A5 | Partner names use raw `strategies.name` (what the discovery row prints), not `displayStrategyName` | Pattern 3 | Admin-only; consistent with the row it sits in |
| A6 | Records longer than 5000 points report Track from the capped series start (~13.7 years crypto) | Pattern 2 | Track understated for very long records; none on PROD today (all 3 published under 365 points per 194) |

## Open Questions

1. **Search label vs table label on `/compare`.** `/api/strategies/browse` names other managers' exploratory rows by codename or `Strategy #<id-prefix>`, while discovery and `CompareTable` print raw `strategies.name`. An allocator who types the name they saw in discovery may find nothing.
   - Recommendation: follow the UI-SPEC (browse endpoint, `displayStrategyName`); search on `name` and `codename`; book the existing discovery/compare raw-name exposure as a separate pseudonymity question rather than widening 197.
2. **Partner-map read failure.** Recommendation: Sentry capture, no notices, page renders. The alternative (a muted "Shared-account check unavailable" line for admins) is not in the UI-SPEC.
3. **Stale rows in percentile cohorts** (Pitfall 9). Recommendation: unchanged in 197, booked.
4. **Parity test vs tearsheet `+`** (Pitfall 4). Recommendation: compare by value on the table side, book tearsheet and `CompareTable` sign for Phase 201.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node | vitest, tsc, eslint | ✓ | v25.8.1 | — |
| `node_modules` in the 197 worktree | every local test run | ✗ (absent in the 197 worktree) | — | `npm ci` in the worktree (main checkout has next 16.4.2 / react 19.3.1) |
| Supabase TEST/PROD | none (no migration, no data write) | n/a | — | — |
| Seeded e2e lane | `e2e/layout-narrow.spec.ts` updates | CI only | — | run the changed vitest files locally; the e2e change is verified on the PR run |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** worktree `node_modules` (install).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 5 (`"vitest": "^5.0.3"`), Testing Library, jsdom; Playwright 1.64 for e2e |
| Config file | `vitest.config.ts` (coverage thresholds are a ratchet; read them there) |
| Quick run command | `npx vitest run src/components/strategy/StrategyTable src/components/strategy/StrategyGrid "src/app/(dashboard)/compare" "src/app/(dashboard)/discovery/[slug]/page.test.tsx" src/lib/discovery src/lib/freshness.test.ts` |
| Full suite command | `npm test` then `npm run typecheck` and `npm run lint` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLAR-02 (SC-3) | A displayed row whose `series_end` is older than the threshold and holds the best Sharpe renders below every current row, shows `—` not `#1`, no `Pnn`, the `Data from YYYY-MM-DD` chip, under asc AND desc and under `name` sort. **RED at HEAD** (HEAD ranks it `#1`). Neuter `listSeriesVerdict` to always `"current"` → RED; restore from a byte backup → GREEN. | component | `npx vitest run src/components/strategy/StrategyTable.stale-series.test.tsx` | ❌ Wave 0 |
| CLAR-02 | Seam: mocked `getStrategiesByCategory` row carrying the `series_end` alias reaches the table and drives the partition (proves the field is the projected one, not `computed_at`; fixture sets `computed_at` = now) | seam | same file, Group A | ❌ Wave 0 |
| CLAR-02 | 7 vs 10 day boundary by asset class; null/unparseable → unknown; future within allowance → current | unit | `npx vitest run src/lib/freshness.test.ts` | ✅ (extend) |
| CLAR-02 | Owner mounts unchanged (U-04) | component pin | `npx vitest run src/components/strategy/StrategyTable.default-mounts.test.tsx` | ✅ (hand-edited fixture) |
| CLAR-01 | Each header shows label + qualifier; accessible name per UI-SPEC; tooltip text present on focus | component | `npx vitest run src/components/strategy/StrategyTable.headers.test.tsx` | ❌ Wave 0 |
| CLAR-01 | Volatility prints no `+` (existing `"+33.77%"` assertion, `StrategyTable.test.tsx:798`, flips; that is the RED evidence) | component | `npx vitest run src/components/strategy/StrategyTable.test.tsx` | ✅ (update) |
| CLAR-01 | Track: ≥30 d → whole months, 1-29 d → `<1`, null → `—`; sorts unknown-last both directions; chain-broken row counts from `headline_since` | component | `StrategyTable.headers.test.tsx` | ❌ Wave 0 |
| CLAR-01 | Grid footer reads the same map (U-07) | component | `npx vitest run src/components/strategy/StrategyGrid.test.tsx` | ✅ (extend) |
| ROUTE-05 | Discovery mount: tick 2 → bar with `Compare (2)` link `href="/compare?ids=a,b"` in tick order; 1 selected → no bar; 4 → unchecked boxes disabled; selection survives sort/page/filter/scope/grid; Clear empties | component | `npx vitest run src/components/strategy/StrategyTable.selection.test.tsx` | ❌ Wave 0 |
| ROUTE-05 | `/browse` and owner mounts render no checkbox and no bar; `browse/[slug]/page.tsx` passes no `selectable`/`sharedAccountPartners` | component + source pin | `npx vitest run src/__tests__/phase-149-my-strategies-parity.test.ts` (extend pin 2) | ✅ (extend) |
| ROUTE-05 | `/compare`: no "not available yet" in any state; search renders in 0/1/2-3 states, not at 4; Remove href drops one id and keeps holdings | page | `npx vitest run "src/app/(dashboard)/compare/page.test.tsx"` | ✅ (update `:931-992`) |
| ROUTE-05 | Combobox: <2 chars closed; loading line; no match line; failure `role="alert"` + Try again; own unpublished and already-compared rows excluded; choose → `router.push("/compare?ids=...,new")` | component | `npx vitest run "src/app/(dashboard)/compare/CompareAddStrategy.test.tsx"` | ❌ Wave 0 |
| ROUTE-05 | Removed copy absent from `src/` | grep | `grep -rn -a "not available yet" "src/app/(dashboard)/compare"` returns nothing | n/a |
| CLAR-05 | Grouping: same venue pair (case-blind exchange) → partners; blank venue id never groups; same key → partners; composite member key counts; unpublished partner never named and never triggers a notice; output carries no exchange/venue/key id | unit | `npx vitest run src/lib/discovery/shared-account-partners.test.ts` | ❌ Wave 0 |
| CLAR-05 (D-01) | Discovery page: non-admin → reader NOT called and `StrategyTable` receives no `sharedAccountPartners` prop; `isAdminUser` false on error → same; admin → prop passed | page (mock `StrategyTable` to capture props) | `npx vitest run "src/app/(dashboard)/discovery/[slug]/page.test.tsx"` | ❌ Wave 0 |
| CLAR-05 | Table renders 1 / 2 / 3+ partner sentences, nothing when absent | component | `StrategyTable.headers.test.tsx` or a dedicated file | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the quick run command for the files that task touched.
- **Per wave merge:** `npm test` (full vitest, coverage thresholds from `vitest.config.ts`), `npm run typecheck`, `npm run lint`.
- **Phase gate:** full suite green, plus the PR's seeded e2e job green with `e2e/layout-narrow.spec.ts` updated; bound to the head SHA.

### Wave 0 Gaps
- [ ] `src/components/strategy/StrategyTable.stale-series.test.tsx` — SC-3 RED-first (CLAR-02)
- [ ] `src/components/strategy/StrategyTable.headers.test.tsx` — headers, Track, unsigned vol, partner line (CLAR-01, CLAR-05 render)
- [ ] `src/components/strategy/StrategyTable.selection.test.tsx` — ROUTE-05
- [ ] `src/app/(dashboard)/compare/CompareAddStrategy.test.tsx` — ROUTE-05 search
- [ ] `src/app/(dashboard)/discovery/[slug]/page.test.tsx` — admin gate and payload absence (no page test exists for this route today)
- [ ] `src/lib/discovery/shared-account-partners.test.ts` — CLAR-05 grouping and published-only fence
- [ ] Fixture freshness: give published-only control rows a current `series_end` under a frozen clock across the existing StrategyTable test files (Pitfall 1)

## Security Domain

`security_enforcement` is not set to false in `.planning/config.json`, so this section applies.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (inherited) | `supabase.auth.getUser()` + redirect, unchanged |
| V3 Session Management | no | unchanged |
| V4 Access Control | **yes** | `isAdminUser` server-side, fail closed; `requireRolePage(..., "allocator")` on `/discovery` and `/compare`; `withAllocatorAuth` on the search API; `withPublishedOnly` as the only fence on the service-role read |
| V5 Input Validation | yes | `/compare` ids: PostgREST `.in()` (parameterised) and `parseHoldingCompareId` charset check, unchanged; client builds hrefs from server-returned UUIDs only |
| V6 Cryptography | no | no encrypted column is selected |
| V8 Data Protection | **yes** | No account identifier, key id, label or exchange in the payload; partner map omitted from non-admin RSC payloads |

### Known Threat Patterns for this phase
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Admin-only partner data in a non-admin's RSC payload or DOM | Information disclosure | Call the reader and pass the prop only after `isAdminUser` is true; page test asserts absence and that the reader is not invoked |
| Unpublished partner named or hinted (count, "and 1 more") | Information disclosure | Service-role strategies read wrapped in `withPublishedOnly`; groups formed among published rows only; test with an unpublished partner fixture |
| Account identity leaked (venue id, exchange UID, key label) | Information disclosure | Select only identity columns, emit names only; test asserts output values are strategy names from the fixture |
| Service-role key reachable from client bundle | Elevation of privilege | `import "server-only"` in the new module (as `supabase/admin.ts`) |
| Compare search lists strategies `/compare` will not render, or another manager's real name | Information disclosure | Reuse `/api/strategies/browse` (owner-or-published + `displayStrategyName`); client drops own unpublished rows |
| Catalogue enumeration through the search | Information disclosure | Existing per-user `userActionLimiter`; fetch once per mount |
| Open redirect / script URL via `router.push` | Tampering | Build `/compare?ids=` from ids only (Next 16 docs warn against untrusted URLs in `router.push`) |
| Stale strategy presented as a current #1 | Spoofing (misleading ranking to an LP) | The SC-3 partition, `#n` and `Pnn` withheld, chip names the date |

## Project Constraints (from CLAUDE.md)

- Read `DESIGN.md` before UI decisions; do not deviate without approval (see Pitfall 5 for the one deviation and its approval, D-05).
- AGENTS.md: read `node_modules/next/dist/docs/` for any Next API used (done here for `useRouter` and RSC props; the worktree has no `node_modules`, the main checkout does).
- CHANGELOG discipline: every ship writes one unified entry, enumerating every branch commit, in the same commit as the VERSION bump; `VERSION` and `package.json` byte-equal 4-digit strings; never `npm version`.
- Never write the skip-CI tokens in a commit message or PR body, not even to deny them.
- Coverage thresholds: read from `vitest.config.ts`, never restated.
- Verification frontmatter: `verified_at_sha` + `drift_subjects`; `covered_digest` / `covered_files` are banned; never list `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json` in `drift_subjects`.
- Migrations (none expected): if one became necessary, it applies TEST first then PROD with no human stop, needs migration-reviewer + rls-policy-auditor clean, and no data-reading `DO` block that can refuse on empty TEST.
- Public repo: no PROD ids, names, amounts, home paths or account numbers in tracked text (this file quotes PROD counts only).
- Founder working rules (memory): gates must be able to fail (neuter, see RED, restore from a byte backup, never `git checkout`/`stash` on uncommitted work); always `grep -a`; one executor per plan, same-wave plans only when file-disjoint.
- `gsd-tools` handlers: `git diff` after every run (STATE/ROADMAP).

## Plan-split hint (for the planner; not a decision)

`StrategyTable.tsx` is one 1961-line file, so plans that edit it run in sequence. File-disjoint work runs in parallel:

| Order | Topic | Main files | Parallel with |
|---|---|---|---|
| A1 | Pure helpers: stale verdict, Track start helper | `src/lib/freshness.ts`, `src/lib/figure-gate.ts` (+ tests) | B, C |
| A2 | Headers map, Track column, unsigned vol, grid footer, test/fixture/e2e header census | `StrategyTable.tsx`, `StrategyGrid.tsx`, tests, `e2e/layout-narrow.spec.ts`, default-mounts fixture | B, C |
| A3 | Stale partition, chip, no `#n`/`Pnn`, SC-3 RED test, page `nowMs` | `StrategyTable.tsx`, `StrategyGrid.tsx`, discovery + browse pages | B, C |
| A4 | Selection column + sticky bar, discovery `selectable`, absence pin, e2e index fix | `StrategyTable.tsx`, `StrategyGrid.tsx`, discovery page | C |
| B | Shared-account reader (server-only) + discovery page admin wiring + page test; table line lands with A4 or as A5 | `src/lib/discovery/*`, discovery page | A1-A3 (page edits must sequence with A3/A4) |
| C | `/compare` Add strategy, Remove, copy | `compare/page.tsx`, `CompareTable.tsx`, `CompareAddStrategy.tsx` (+ tests, e2e copy at `layout-narrow.spec.ts:1168`) | A, B |
| Z | Close: DESIGN.md line, bookings (A-3/A-4, Pitfalls 4/9/10), CHANGELOG/VERSION | records | — |

## Sources

### Primary (HIGH confidence, opened this session at HEAD `130c927ef`)
- `src/components/strategy/StrategyTable.tsx` (:100, :107, :128-159, :169-170, :258-317, :492-531, :601, :739-947, :1024-1061, :1150-1316, :1435-1436, :1568-1605, :1674-1680), `StrategyGrid.tsx`, `annualized-cell.tsx`
- `src/lib/queries.ts` (:576-577, :601-671, :692-709, :836-977, :5087-5130), `src/lib/figure-gate.ts` (:1-170), `src/lib/freshness.ts` (:100-271), `src/lib/utils.ts` (:4-39, :150-158, :270-284), `src/lib/closed-sets.ts:616-620`, `src/lib/admin.ts` (:164-231, :283-310), `src/lib/supabase/admin.ts`, `src/lib/visibility.ts:81-93`, `src/lib/strategy-display.ts`, `src/lib/discovery-types.ts`, `src/lib/constants.ts:284-319`, `src/lib/factsheet/compute.ts:11-12`, `src/lib/auth/requireRolePage.ts`
- `src/app/(dashboard)/discovery/[slug]/page.tsx`, `discovery/layout.tsx`, `src/app/browse/[slug]/page.tsx`, `src/app/(dashboard)/compare/page.tsx`, `src/components/strategy/CompareTable.tsx`, `src/app/api/strategies/browse/route.ts`, `allocations/components/StrategyBrowseDrawer.tsx`, `allocations/components/EquityHistoryRebuilding.tsx:220-250`, `src/components/ui/Tooltip.tsx`
- `analytics-service/services/metrics.py` (:215-228, :871-885, :1940-2010, :2040-2262, :2378-2390), `transforms.py:436-440`, `job_worker.py:15272-15330`
- `supabase/schema/baseline.sql` (:7156, :13625-13646, :15037, :16434, :17036), migrations `20260920120000`, `20260925120000`
- Tests: `StrategyTable.stale-analytics.test.tsx`, `StrategyTable.default-mounts.test.tsx`, `StrategyTable.test.tsx`, `StrategyTable.visibility.test.tsx`, `src/__tests__/figure-parity-pages.test.tsx`, `src/__tests__/phase-149-my-strategies-parity.test.ts`, `compare/page.test.tsx`; e2e `layout-narrow.spec.ts`, `reflow-sweep-authed.spec.ts`, `helpers/hydration-guard.ts`, `helpers/seed-test-project.ts`; `.github/workflows/ci.yml:6386, :7037-7066`
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md`, `.../01-getting-started/` server-and-client-components (main checkout, next 16.4.2)
- Planning: `197-CONTEXT.md`, `197-UI-SPEC.md`, `REQUIREMENTS.md`, `ROADMAP.md` (Phases 194.1, 196, 197, 201), `194-CONTEXT.md`, `DESIGN.md:148-170`; `feat/194.1-d04sweep` 194.1-RESEARCH.md plan split; `quantalyze-196` worktree `196-CONTEXT.md` and `196-UI-SPEC.md` Back Link Contract

### Secondary
- PROD counts supplied by the orchestrator (2026-11-08, read-only, marker confirmed): 3 published; one published crypto series 177 days old with `computed_at` today; 16 strategies with a key, 14 with a venue id, 2 with a holder pointer, 9 accounts, 1 account with 2+ published strategies.

### Tertiary
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, all in-repo, read this session; no package.
- Architecture: HIGH for the admin path, the stale field and the compare parser (read); MEDIUM for the grouping semantics A1/A2 (a definitional choice).
- Pitfalls: HIGH, each cites the test or file that will go red.

**Research date:** 2026-11-08
**Valid until:** 2026-11-15 (196 and 194.1 are moving the same files; re-resolve by symbol after either merges)

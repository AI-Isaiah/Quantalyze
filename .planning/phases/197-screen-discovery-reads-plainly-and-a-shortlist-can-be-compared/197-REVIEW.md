---
phase: 197-screen
reviewed: 2026-11-08T21:21:21Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - src/app/(dashboard)/compare/CompareAddStrategy.tsx
  - src/app/(dashboard)/compare/page.tsx
  - src/app/(dashboard)/discovery/[slug]/page.tsx
  - src/components/strategy/CompareTable.tsx
  - src/components/strategy/SelectCheckbox.tsx
  - src/components/strategy/SharedAccountNote.tsx
  - src/components/strategy/StaleSeriesChip.tsx
  - src/components/strategy/StrategyGrid.tsx
  - src/components/strategy/StrategyTable.tsx
  - src/components/strategy/discovery-columns.ts
  - src/lib/compare-href.ts
  - src/lib/discovery/shared-account-partners.ts
  - src/lib/figure-gate.ts
  - src/lib/freshness.ts
  - e2e/layout-narrow.spec.ts
  - DESIGN.md
  - TODOS.md
findings:
  critical: 0
  warning: 3
  info: 0
  total: 3
  necessity: 0
status: issues_found
---

# Phase 197: Code Review Report

**Reviewed:** 2026-11-08T21:21:21Z
**Depth:** standard
**Files Reviewed:** 17 source files, plus the phase's test edits read for intent and whether they can fail
**Status:** issues_found

## Summary

Scope: `git diff 73101d64c..HEAD -- . ':!.planning'` on `feat/197-screen`. Only MEDIUM and above are reported, as the caller asked. LOW and INFO are left out. Severity is given as MEDIUM in each finding. In the frontmatter, MEDIUM counts as `warning` and nothing reached `critical`.

Areas checked that turned up no MEDIUM+ defect:

- **Admin-only partner names.** `getSharedAccountPartners` runs `isAdminUser` before `createAdminClient()`. `isAdminUser` returns false on error and does not throw. The module imports `server-only`. The discovery page spreads the prop only when the map is non-null. `/browse/[slug]` neither imports the reader nor passes the prop, and `phase-149-my-strategies-parity.test.ts` pins 2b and 2c say so. Every read error returns `null` and is sent to Sentry. A throw is caught. Strategies are read through `withPublishedOnly`. `api_keys` is read for identity columns only, and the output holds names only. I found no path that reaches a non-admin, the anonymous page or a client bundle. (Silent truncation is a separate issue: WR-02.)
- **Stale verdict.** It reads `series_end` only. Thresholds are 7 days for crypto and 10 for everything else, with a null asset class taking 10. Age is whole UTC days, a future date counts as current, and `unknown` counts as not current. It applies only on published-only mounts. The verdict is used as one predicate by the sort, the ordinals, the percentile suffix and the chip. `nowMs` is seeded server-side on `/discovery`. The `/browse` hydration residual is booked as T-197-18.
- **Track arithmetic.** It divides by 365 and returns `<1` under 30 days, clamped to at least 1 from 30 days. Correct, except for the unreadable-record case in WR-01.
- **`/compare` ids.** Ids are encoded through `encodeURIComponent` with the path fixed. The cap of 4 holds in the page parser, in the search (shown only below the cap) and in the selection reducer. The search drops the caller's own unpublished rows, and Remove links are built from resolved ids.
- **Selection bar.** The cap holds in the reducer as well as on the disabled boxes. The live region is always mounted. Focus goes to the next or previous chip, then the strategy's checkbox, then the first checkbox.
- **Volatility.** It is unsigned on discovery only. The tearsheet and `CompareTable` still sign it, which is booked as `[197-VOL-SIGN-TEARSHEET-COMPARE]`.

Known items that are already booked and so are not repeated as findings: `[197-COMPARE-NAME-PSEUDONYMITY]`, `[197-SYNCBADGE-SERIES-LADDER]`, `[197-PERCENTILE-COHORT-STALE]` and T-197-18.

Tests: the stale-series, selection, shared-account and partner-reader suites encode intent and can fail. They cover the thresholds at the boundary, direction-independence, a fresh `computed_at` not rescuing a stale row, a non-admin never creating the admin client, the published fence, and output with no identifiers. The parity relaxation for volatility (strip a leading `+` on the tearsheet side) is scoped to one metric and booked. None of the suites covers the WR-01 or WR-02 cases.

## Warnings

### WR-01: MEDIUM — Track prints and sorts by a record length the 194 gate refuses to read (unreadable `headline_since`)

**File:** `src/components/strategy/StrategyTable.tsx:1590-1595` (cell and title), `src/components/strategy/StrategyTable.tsx:607-610` (`getSortValue` `"track"`)
**Issue:** The Track cell uses `trackMonths(record.spanDays)` and the sort uses `rowRecord(s).spanDays`, and neither checks `record.unreadable`. In `figureRecord`, a chain-broken row whose `headline_since` is present but not a date gets `unreadable: true` while `spanDays` is still computed. `figureSpan` skips the unreadable `headlineSince` and spans the whole series from `seriesStart`. `figureSpan`'s own doc comment (`src/lib/figure-gate.ts`) says this generous span "is never what a gate judges on", because the record is withheld and "its reason names no length". Track now prints exactly that span:
- The cell shows N months of record.
- The title says "N days of record, <series_start> to <series_end>".
- The row sorts by that length.

Meanwhile the CAGR, Sharpe and volatility cells on the same row are withheld because the length cannot be read. The pre-break part of a chain-broken record gets reported as track record.
**Why it matters:** Data integrity and user-facing. An allocator sees a longer track record than the house rule admits, on the one row where the rule deliberately refuses to state a length. The cell also contradicts the withheld reason beside it.
**Fix (minimal):** treat an unreadable record as an unknown span in both places.
```tsx
// StrategyTable.tsx, cell
const trackSpan = record.unreadable ? null : record.spanDays;
const trackShown = trackMonths(trackSpan);
const trackTitle = trackSpan != null && trackFirst && trackLast ? `...${formatNumber(trackSpan, 0)} days of record...` : undefined;

// getSortValue
case "track": {
  const r = rowRecord(s);
  return r.unreadable ? null : r.spanDays;
}
```
Add one table test: a row with `headline_since: "not-a-date"` shows an em dash in Track and sorts last.

### WR-02: MEDIUM — The admin partner read takes every published strategy with no range, so PostgREST `max_rows` truncates it without any error

**File:** `src/lib/discovery/shared-account-partners.ts:149-154`
**Issue:** `withPublishedOnly(admin.from("strategies").select("id, name, api_key_id"))` has no `.range()` and no pagination. PostgREST caps every response at `max_rows` (`supabase/config.toml:18`, `max_rows = 1000`), and returns a truncated page with no error. Past that size, two things go wrong:
- A partner beyond the cut is never named.
- A listed strategy beyond the cut is missing from `input.strategies`, so `groupSharedAccountPartners` gives it no entry at all.

Either way the reader returns a map that looks complete and sends nothing to Sentry. That contradicts the module's fail-closed and fail-loud contract. The module already plans for a growing catalogue (`IN_CHUNK` exists because "an unbounded id list on a growing catalogue would eventually exceed the request-line limit"), but it guards the URL length and not the row cap. The same cap applies per chunk to `strategy_keys` and `api_keys`, though at 100 ids per chunk that is far off.
**Why it matters:** Data integrity of an admin signal. Missing notices read as "no shared account". The defect is latent until the published catalogue passes 1000 rows. No failure shows when that happens.
**Fix (minimal):** page the strategies read until a short page comes back, for example:
```ts
const strategies: StrategyRow[] = [];
for (let from = 0; ; from += PAGE) {
  const r = await withPublishedOnly(admin.from("strategies").select("id, name, api_key_id"))
    .order("id").range(from, from + PAGE - 1).returns<StrategyRow[]>();
  if (r.error) return failed("strategies_read_error", r.error.message);
  strategies.push(...(r.data ?? []));
  if ((r.data?.length ?? 0) < PAGE) break;
}
```
Choose `PAGE` at or below `max_rows`. A smaller change is to read only the listed ids plus any strategy sharing their key ids, but that needs a second query shape.

### WR-03: MEDIUM — The /compare search says "No published strategy matches" for a strategy past the browse route's 200-row cap

**File:** `src/app/(dashboard)/compare/CompareAddStrategy.tsx:38-43` (`fetchBrowse`), `:187-191` (no-match line)
**Issue:** The search reads `GET /api/strategies/browse`. That route returns at most `STRATEGY_BROWSE_LIMIT = 200` rows in alphabetical order (`src/app/api/strategies/browse/route.ts:128`, `:204`). The caller's own unpublished rows also count toward the 200. The route sends `has_more: true` when it truncates, so a client can warn. `fetchBrowse` keeps only `json.strategies` and drops `has_more`. Once more than 200 rows are visible to the caller, any published strategy whose name sorts past the cut cannot be found. The component then shows the definite claim `No published strategy matches "<query>".`, which is false. The research named the cap (RESEARCH line 237), and no plan or TODO deals with it.
**Why it matters:** User-facing. An allocator is told a strategy they can see in Discovery does not exist, and cannot add it from the page built for adding. The defect is latent until the catalogue passes 200 rows, and the drawer that shares the route carries the same deferred gap.
**Fix (minimal):** keep `has_more` and say the result is partial:
```ts
const json = (await res.json()) as { strategies?: StrategyBrowseRow[]; has_more?: boolean };
return { rows: json.strategies ?? [], hasMore: json.has_more === true };
// no-match branch:
hasMore
  ? `No match in the first ${rows.length} strategies. Select it in Discovery instead.`
  : `No published strategy matches "${settled.trim()}".`
```
Alternatively, book it in `TODOS.md` beside `[197-COMPARE-NAME-PSEUDONYMITY]` with a trigger at a catalogue of 200 rows.

---

_Reviewed: 2026-11-08T21:21:21Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Fix round 1

| Finding | Commit | Test | Files |
|---|---|---|---|
| WR-01 (Track column states a record length the 194 gate refuses to read) | `26da0389b` | `StrategyTable.headers.test.tsx`: "treats a present but malformed headline_since as an unknown length, not the full-series span (197 WR-01)" and "sorts an unreadable-record row last ascending and descending, never by its full-series span (197 WR-01)" | `StrategyTable.tsx` (Track cell, title, `getSortValue` "track") |
| SFH-D future/impossible series_end | `0a260a531` | `freshness.test.ts`: "a date more than 2 whole UTC days ahead is unknown, never current: ...", "a calendar-impossible day is unknown, not rolled over to the next month", "a date within the 2-day skew tolerance is current: one day ahead ..."; `StrategyTable.stale-series.test.tsx`: "a far-future series_end (a corrupt write) does not rank as current: no #n, 'Data date unknown', after the current rows" | `freshness.ts` (`listSeriesVerdict`, docblock) |

Notes:
- WR-01: `StrategyGrid` does not render Track, so no grid change was needed.
- SFH-D: the superseded "any future date is current" test was replaced. Tolerance is 2 whole UTC days ahead (a date 3 days ahead is `unknown`); a day whose parsed UTC date does not round-trip to the same `YYYY-MM-DD` is `unknown`.
- Each test was shown RED against the neutered fix (restored byte-identical, `cmp` clean) before commit.

## Fix round 2

| Finding | Commit | Test | Files |
|---|---|---|---|
| WR-03 (/compare search says "No published strategy matches" past the browse route's 200-row cap) + SFH malformed-response (a 200 without `strategies` read as an empty catalogue) | `f30602aed` | `CompareAddStrategy.test.tsx`: "says the search covered only part of the catalogue when the route truncated, never a flat no-match", "still offers a match found inside a truncated catalogue", "a 200 without a strategies array is the error state with Try again, not 'no match'", "carries has_more and limit from the response into the partial-catalogue line", "has_more false with no match keeps the original no-match line" (plus the existing no-match test, unchanged) | `CompareAddStrategy.tsx` (`fetchBrowse`, `Catalogue` seam, no-match line) |
| WR-02 (admin partner read cut silently at PostgREST `max_rows`) | `c598dba4d` | `shared-account-partners.test.ts`: "reads a full first page and a short second page, and names a partner that only page 2 holds", "returns null and captures to Sentry when the second page errors, never a half-read map", "stops after one page when it comes back short" | `shared-account-partners.ts` (strategies read paged by `id`, `PAGE = 1000`) |

Notes:
- WR-03: the fetch seam now returns `{ rows, hasMore, limit }`; the line reads "No match in the first {limit} strategies. Try a more specific name." with `limit` taken from the response. The existing tests were moved to the new seam shape.
- WR-02: the chunked `strategy_keys` and `api_keys` reads stay unpaged (a 100-id chunk gives at most 100 `api_keys` rows; `strategy_keys` would need more than ten links per strategy to reach the cap). A comment on `PAGE` says so.
- Each test was shown RED against the neutered fix (restored byte-identical, `cmp` clean) before commit.

## Re-review (round 2)

**Reviewed:** 2026-11-08T21:31:49Z, `feat/197-screen` at `a8cb4864c`, fix range `6fe59cc10..HEAD` (`26da0389b`, `0a260a531`, `f30602aed`, `c598dba4d` plus two docs commits). Read in full: `src/lib/freshness.ts` (`listSeriesVerdict` and its docblock), `src/lib/discovery/shared-account-partners.ts`, `src/app/(dashboard)/compare/CompareAddStrategy.tsx`, the browse route's response contract (`src/app/api/strategies/browse/route.ts`, `BrowseResponse`), the touched parts of `src/components/strategy/StrategyTable.tsx`, and every touched test. The five touched suites pass at HEAD (173 tests). For each new test I traced whether reverting its fix turns it red. MEDIUM and above only.

### Verdict per round-1 finding

| Finding | Verdict | Basis |
|---|---|---|
| WR-01 Track states an unreadable record's length | **CLOSED** | The cell, the title and `getSortValue("track")` all read `record.unreadable ? null : spanDays`. A malformed `headline_since` therefore shows an em dash with no title and sorts last in both directions through `compareWithMissingLast`. `StrategyGrid` renders no Track. Both tests go red if the fix is reverted: the cell would print 18 and the sort would put the 900-day row first. |
| SFH future or impossible `series_end` | **CLOSED** | A date more than 2 whole UTC days ahead now reads `unknown` (not ranked, "Data date unknown", after the current rows). The boundary is consistent by UTC date: today+2 stays current at any time of day and today+3 is unknown. A day that does not round-trip through `toISOString` (2026-02-31, 2025-02-29) is `unknown`, and a real leap day still reads. The verdict is still the one predicate behind the sort, the ordinals, the percentile and the chip. `nowMs` seeding is unchanged and the round-trip is deterministic, so no new hydration input was added. The tests go red without the fix. A gap below MEDIUM: nothing pins exactly 2 days ahead, so tightening `< -2` to `< -1` would pass. |
| SFH malformed /compare browse response | **CLOSED** | A 200 with no `strategies` array throws into the error state with "Try again". A non-JSON body fails at `res.json()` and lands in the same catch. The test stubs `fetch` and drives the real `fetchBrowse`, so it bites. |
| WR-02 partner read cut silently at `max_rows` | **CLOSED** | The read pages by `.order("id")` (unique, so consecutive ranges are disjoint) with `.range(from, from+999)` until a page comes back short. A catalogue that is an exact multiple of 1000 costs one extra empty page and then stops. Any page error returns `null` and goes to Sentry (`strategies_read_error`), and a throw is caught. The admin check still runs before `createAdminClient()`, so the loop never runs for a non-admin and no name can reach one. The tests use a fake that caps every response at 1000 rows: a partner that only page 2 holds is named, a page-2 error fails closed, and a short first page stops the loop. Residuals below MEDIUM: (a) `PAGE` equals `max_rows` exactly. If the hosted `max_rows` were ever set below 1000, every page would look short and the cut would be silent again. Stepping `from` by `data.length` and stopping on an empty page would hold for any cap. (b) Offset paging on a live table can skip or repeat one row when a strategy is published between two pages. |
| WR-03 /compare "No published strategy matches" past the 200 cap | **PARTIALLY CLOSED, see WR-04** | The false claim of non-existence is gone. With `has_more`, the line now names the partial catalogue, and `limit` comes from the response. But the remedy it gives the user cannot work. |

### New findings

#### WR-04: MEDIUM — The partial-catalogue line tells the allocator to "Try a more specific name", which can never surface a strategy past the cut

**File:** `src/app/(dashboard)/compare/CompareAddStrategy.tsx:210-212`; the copy is pinned in `CompareAddStrategy.test.tsx` ("says the search covered only part of the catalogue…", "carries has_more and limit…")
**Issue:** The catalogue is fetched once per mount (`load === "idle"` gate, `:117`) from `GET /api/strategies/browse` with no parameters. The route reads no search parameters at all (`grep searchParams` finds no hit in `route.ts`), and it cuts at 200 rows ordered by the raw `name`. Matching is a client-side `includes` over those ≤200 rows (`:124-136`). Typing a longer or more specific query only filters the same 200 rows, so a strategy past the cut can never appear. The user does what the line says and gets the same line again. Round 1's finding was that the strategy "cannot be added from the page built for adding". It is still unreachable, and the copy now points to a dead end rather than to the route that works: selecting the strategy in Discovery and comparing from the selection bar. A smaller related gap: when `hasMore` is true and the query does match something within the first 200, the options render with no hint that the list is partial, so a same-named strategy past the cut is missed without any notice.
**Why it matters:** User-facing. This is the live copy for the exact case WR-03 was about, and it misdirects. The round-1 fix text proposed "Select it in Discovery instead." The shipped text replaced that with an instruction that cannot succeed, and the test pins it.
**Fix (minimal):** change the copy to name the path that works, and update the two tests that pin it:
```tsx
{catalogue?.hasMore
  ? `No match in the first ${catalogue.limit} strategies. Select it in Discovery and compare from there.`
  : `No published strategy matches "${settled.trim()}".`}
```
Optionally, when `hasMore` is true and options do render, add the same one-line caption under the list.

No other new MEDIUM+ defect. Checked:
- Sort order and the stale partition: an unreadable Track and a far-future `series_end` both fall into the existing missing-last and not-current branches. No comparator was changed.
- The partner map: self is excluded by id. Names stay names-only and sorted. The admin fence is unchanged.
- /compare states: loading, error with "Try again", no match, partial and options are mutually exclusive on `load` and `options.length`.
- Hydration and time: no new clock read.

_Re-reviewed: 2026-11-08T21:31:49Z · Reviewer: Claude (gsd-code-reviewer) · Depth: standard_

## Fix round 3

| Finding | Commit | Test | Files |
|---|---|---|---|
| WR-04 (the partial-catalogue line advised "Try a more specific name", which can never surface a strategy past the 200-row cut) | `1789c4221` | `CompareAddStrategy.test.tsx`: "says the search covered only part of the catalogue when the route truncated, never a flat no-match" (now also asserts the line carries no "more specific" advice) and "carries has_more and limit from the response into the partial-catalogue line" | `CompareAddStrategy.tsx` (no-match line), `CompareAddStrategy.test.tsx` |

Notes:
- WR-04: the line now reads "No match in the first {limit} strategies. Select it in Discovery and compare from there." Plain text, no new link. The optional caption for a partial list that does render options was not added (below the minimal fix).
- Both pinning tests went RED with the old copy restored from a byte backup (2 failed, 20 passed), then GREEN after restoring the fix (`cmp` identical).
- The paging residuals from round 2 (WR-02 a and b) are below MEDIUM and are untouched.

---
phase: 197-screen-discovery-reads-plainly-and-a-shortlist-can-be-compared
verified: 2026-11-08T22:00:00Z
status: passed
score: 4/4 roadmap success criteria verified (5/5 locked decisions D-01..D-05 delivered); 0 gaps
verified_at_sha: 9bc83f894fa4a249ea3582fb26282c86d86797b3
behavior_unverified: 0
overrides_applied: 0
drift_subjects:
  - src/components/strategy/StrategyTable.tsx
  - src/components/strategy/StrategyGrid.tsx
  - src/components/strategy/discovery-columns.ts
  - src/components/strategy/SelectCheckbox.tsx
  - src/components/strategy/SharedAccountNote.tsx
  - src/components/strategy/StaleSeriesChip.tsx
  - src/components/strategy/CompareTable.tsx
  - src/lib/freshness.ts
  - src/lib/figure-gate.ts
  - src/lib/compare-href.ts
  - src/lib/discovery/shared-account-partners.ts
  - "src/app/(dashboard)/discovery/[slug]/page.tsx"
  - "src/app/(dashboard)/compare/page.tsx"
  - "src/app/(dashboard)/compare/CompareAddStrategy.tsx"
  - e2e/layout-narrow.spec.ts
human_verification:
  - test: "Visual backstop of the discovery table at 375px and 1280px (select column, two-line headers, Track column, stale chip, shared-account line, sticky Compare bar)"
    expected: "Pinned stack (select, rank, star, Strategy) aligns at rest and at max horizontal scroll; headers do not clip; the bar does not cover the last row's controls; layout matches DESIGN.md and 197-UI-SPEC.md"
    why_human: "Needs a real browser; jsdom has no layout. The geometry assertions live in e2e/layout-narrow.spec.ts (seeded e2e lane), which cannot run here."
  - test: "Keyboard walk on /discovery/[slug]: Tab to a row checkbox, Space to select, tick a 5th box (disabled), activate a chip's x, Clear, then Enter on Compare (n)"
    expected: "Focus lands where 197-UI-SPEC says after each action (next or previous chip, then the strategy's checkbox, then the first checkbox); the live region announces the count; Compare (n) opens /compare?ids= with exactly those strategies in tick order"
    why_human: "Focus order and screen-reader announcement are covered in jsdom (StrategyTable.selection.test.tsx) but real focus and AT behaviour need a browser."
  - test: "Keyboard walk on /compare: type 2+ characters in Add strategy, Up/Down/Enter, Escape, then Remove a column"
    expected: "Combobox adds the strategy and refocuses the emptied field; the search disappears at 4 items; Remove drops one column; no 'not available yet' text anywhere"
    why_human: "ARIA combobox behaviour with a real browser and the live /api/strategies/browse route."
  - test: "Admin shared-account line against real data: as an admin open a /discovery category that holds two published strategies on one exchange account; then as an allocator and as a logged-out visitor open /browse/[slug]"
    expected: "Admin sees 'Shares an exchange account with <name>.' under both listings; allocator and visitor see nothing and the page source contains no partner names; an unpublished partner is never named"
    why_human: "Needs a seeded or PROD pair of strategies on one account and three viewer roles; unit tests prove the reader, the fence and the prop wiring with fakes, not a live pair."
  - test: "Seeded e2e lane (e2e/layout-narrow.spec.ts) and CI run bound to the head SHA"
    expected: "Green with the expected check count on 49d90ef5b; src/lib/factsheet/compute.conventions.test.ts passes on Node 22 (.nvmrc)"
    why_human: "The e2e lane and a Node 22 full-suite run are CI-side. Locally the two compute.conventions snapshot cases differ by the last float digit on Node v25 (environmental, src/lib/factsheet is byte-identical to origin/main)."
---

# Phase 197: SCREEN - Verification Report

**Phase Goal:** An allocator screening in discovery can read every column without guessing (period, annualisation, track length), sees stale strategies flagged and not ranked as current, learns when two listings draw on one exchange account, and can select strategies and open Compare from the UI.
**Verified:** 2026-11-08 at `49d90ef5b5ae82e41f322548d60d57dc11ebbe07` (`feat/197-screen`)
**Status:** passed (human items closed 2026-11-10 by production UAT, see `197-UAT.md`; the code verification was issued at `49d90ef5`)

> **Update 2026-11-10.** All five human items ran on production at main `9bc83f89` and passed (`197-UAT.md`, 5/5). One cross-surface defect surfaced in test 3 and is routed, not a 197 gap: "Add strategy" searches the browse route, which returns other owners' strategies as "Strategy #<id>", so a name shown on discovery ("Fib") finds nothing. Founder: "Real name everywhere", Phase 201 PLAINWORDS (`TODOS.md` `197-STRATEGY-NAME-PSEUDONYM-01`).
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria, the contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | An allocator can select strategies in a discovery list and open Compare with them, and Compare no longer says adding is "not available yet" | VERIFIED | `StrategyTable.tsx` `selectable` prop, `selectedIds` state capped at `COMPARE_MAX_ITEMS` (4) in the setter, sticky bar from 2 with `href={compareHref(selectedIds)}`; discovery page passes `selectable` (`discovery/[slug]/page.tsx:116`); `compare-href.ts` fixes the path and `encodeURIComponent`s ids; `/compare` parses `ids` with the same cap, mounts `CompareAddStrategy` and per-column Remove links. `grep -rn "not available yet" src e2e` has no hit on /compare (remaining hits are unrelated factsheet copy). `StrategyTable.selection.test.tsx`, `CompareAddStrategy.test.tsx`, `compare/page.test.tsx`, `compare-href.test.ts` pass. Phase-149 pin 2b keeps `selectable` off the anonymous /browse page. |
| 2 | Every discovery column header states its period and whether it is annualised, volatility shows no sign, and a track-length column exists | VERIFIED | `discovery-columns.ts` is the one label map for table header and grid footer: Return/CAGR/Sharpe/Max DD/Volatility say "full record" with annualised true or false, 6-month Return says "last 6 months, not annualized", AUM "stated by manager", plus `track` ("months of record") and tooltips. Period reads "full record", not "1y" as D-05's example, because the stored scalars cover the full record (documented in the module). Volatility cell uses `formatPercent(..., { signed: false })` (`StrategyTable.tsx:1588`); the grid shows no volatility. Track = `trackMonths(spanDays)` over the 194 covered-day record (`figure-gate.ts`), `<1` under 30 days, divides by 365, and treats an unreadable record as unknown (WR-01). `StrategyTable.headers.test.tsx` (455 lines), `figure-gate.test.ts`, `StrategyGrid.test.tsx` pass. Tearsheet and CompareTable still sign volatility: booked `[197-VOL-SIGN-TEARSHEET-COMPARE]` (Phase 201), outside this SC (discovery). |
| 3 | A stale strategy (newest stored return day or last successful fetch older than a stated threshold) is flagged in its row and does not rank as current; the phase names the field and does not use `computed_at`; a stale fixture test goes RED on today's ranking | VERIFIED | `listSeriesVerdict` (`freshness.ts`) reads only `series_end` (= `returns_series->-1->>date`, projected by the ranked-list embed in `lib/queries.ts`); thresholds 7 whole UTC days (crypto) / 10 (other, null included); unreadable or more than 2 days ahead = `unknown`, not current. One `seriesVerdicts` memo and one `isCurrentRow` predicate feed the direction-independent stale partition (after the ranked partition), `rankOrdinals` (no `#n`), the percentile suffix and `StaleSeriesChip` ("Data from {date}"); grid reads the same map; discovery page seeds `nowMs`. **My own neuter:** replacing the `isCurrentRow` predicate with `true` turned 12 `StrategyTable.stale-series.test.tsx` cases RED (stale row ranking #1 under Sharpe desc and asc, fresh `computed_at` rescuing it, 8/11-day boundaries, far-future date, name/track sorts); restored byte-identical (`cmp` clean). |
| 4 | A listing says when two strategies draw on the same exchange account using only stored data; a non-shared strategy shows no notice. Narrowed 2026-11-08 (D-01): admins only; an unpublished strategy is never named | VERIFIED (with human item 4 for a live pair) | `shared-account-partners.ts`: `server-only`; `isAdminUser` before `createAdminClient()`; strategies read via `withPublishedOnly` (the only fence under service role), paged by id at `PAGE = 1000` (WR-02); identity from stored `api_keys.venue_account_id`, `account_shared_with_api_key_id`, `strategy_keys` (migrations present); returns strategy id to NAMES only, `null` plus Sentry on any failure. Discovery page spreads `sharedAccountPartners` only when non-null, so non-admin RSC payload carries no names; `/browse/[slug]` neither imports the reader nor passes the prop (pin 2c). `SharedAccountNote` returns null for an empty list. **My own neuter:** removing the admin check turned `returns null for a non-admin and never creates the service-role client` and the null-viewer case RED (2 failed, 44 passed); restored byte-identical. |

**Score:** 4/4 truths verified, 0 present-but-behavior-unverified. Locked decisions: D-01 (admin only) and D-02 (unpublished never named) in truth 4; D-03 in truth 3; D-04 in truth 1; D-05 in truth 2.

### Deferred Items

None. The four booked observations (`[197-VOL-SIGN-TEARSHEET-COMPARE]` to Phase 201, `[197-SYNCBADGE-SERIES-LADDER]`, `[197-PERCENTILE-COHORT-STALE]`, `[197-COMPARE-NAME-PSEUDONYMITY]`) are recorded in `TODOS.md` and none of them is a success-criterion gap. The `/browse` hydration-order residual is accepted as T-197-18.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/components/strategy/discovery-columns.ts` | one label map | VERIFIED | Imported by `StrategyTable.tsx:34` (drives `COLUMNS` and `PLAIN_COLUMNS`) and the grid |
| `src/lib/freshness.ts` `listSeriesVerdict` | data-age verdict | VERIFIED | Used by `StrategyTable.tsx:51,717`; never reads `computed_at` |
| `src/components/strategy/StaleSeriesChip.tsx` | chip, reason | VERIFIED | Used by table and grid |
| `src/lib/figure-gate.ts` `recordStartDay`, `trackMonths` | Track figure | VERIFIED | `figureSpan` shares `recordStartDay` |
| `src/lib/compare-href.ts` | URL + cap | VERIFIED | Used by page, search, selection bar |
| `src/app/(dashboard)/compare/CompareAddStrategy.tsx` | Add strategy combobox | VERIFIED | Mounted on /compare below the cap; partial-catalogue line points to Discovery (WR-03/WR-04) |
| `src/components/strategy/SelectCheckbox.tsx` | 44px checkbox | VERIFIED | Table cell and grid overlay |
| `src/lib/discovery/shared-account-partners.ts` | admin-gated reader | VERIFIED | Sole importer is the discovery page |
| `src/components/strategy/SharedAccountNote.tsx` | one sentence | VERIFIED | Table row and grid card |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| discovery page | StrategyTable | `selectable`, `nowMs`, conditional `sharedAccountPartners` spread | WIRED |
| StrategyTable selection bar | /compare | `compareHref(selectedIds)` (cap in reducer) | WIRED |
| /compare page | CompareAddStrategy and CompareTable Remove | resolved ids, `compareHref` | WIRED |
| `CATEGORY_RANKING_ANALYTICS_COLUMNS` | verdict | `series_end` alias into `s.analytics.series_end` | WIRED |
| discovery page | reader | `getSharedAccountPartners(supabase, user, ids)`; null means prop absent | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Variable | Source | Real data | Status |
|----------|----------|--------|-----------|--------|
| stale chip, sort, `#n` | `series_end` | `returns_series->-1->>date` in the ranked-list embed | yes | FLOWING |
| Track cell | `spanDays` | `rowRecord(s)` from `series_start`, `series_end`, `headline_since` | yes | FLOWING |
| shared-account line | partner names | `strategies`, `strategy_keys`, `api_keys` service-role reads, published only | yes (live pair is human item 4) | FLOWING |
| /compare search | catalogue | `GET /api/strategies/browse` (200-row cap surfaced via `has_more`) | yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Type check | `npx tsc --noEmit` | no output, exit 0 | PASS |
| Phase suites and adjacent pins | `npx vitest run src/components/strategy src/lib/freshness.test.ts src/lib/figure-gate.test.ts src/lib/compare-href.test.ts src/lib/discovery "src/app/(dashboard)/compare" "src/app/(dashboard)/discovery" "src/app/(dashboard)/strategies" src/__tests__/figure-parity-pages.test.tsx src/__tests__/phase-149-my-strategies-parity.test.ts src/__tests__/phase-52-container-tabular-nums.test.tsx src/__tests__/figure-gate-census.test.ts` | 150 files, 2861 tests passed | PASS |
| SC-3 test can fail | neuter `isCurrentRow` to `true` | 12 cases RED, restored `cmp` clean | PASS |
| Admin fence can fail | remove `isAdminUser` early return | 2 cases RED, restored `cmp` clean | PASS |

### Probe Execution

Step 7c: SKIPPED. The phase declares no probes (UI and server-read phase, no `probe-*.sh`).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ROUTE-05 | 04, 05 | Select in discovery, open Compare | SATISFIED | Truth 1 |
| CLAR-01 | 01 | Period, annualisation, unsigned volatility, Track column | SATISFIED | Truth 2 |
| CLAR-02 | 03 | Stale flagged and not ranked as current | SATISFIED | Truth 3 |
| CLAR-05 | 02, 06 | Shared exchange account noted (admin only, D-01) | SATISFIED | Truth 4; the narrowing is recorded in ROADMAP (line 339) and CONTEXT D-01 |

No orphaned requirements: REQUIREMENTS.md maps exactly these four IDs to Phase 197.

### Review Disposition

`197-REVIEW.md`: round 1 raised WR-01, WR-02, WR-03 (plus an SFH future-date finding and an SFH malformed-response finding); re-review round 2 closed WR-01, WR-02, the SFH items and raised WR-04 (partial-catalogue copy); fix round 3 (`1789c4221`) addressed WR-04 with tests shown RED against the old copy. I read the fix code at HEAD for each (Track unreadable guard, `listSeriesVerdict` future and impossible-date handling, paged partner read, `has_more` handling) and the suites covering them pass. Open residuals, all below MEDIUM and recorded in the review: paging `PAGE` equals `max_rows`, offset paging can skip or repeat one row on a live table, no test pins exactly 2 days ahead.

### Anti-Patterns Found

None. No `TBD`, `FIXME`, `XXX`, `TODO`, `HACK` or `PLACEHOLDER` marker in any source file the phase changed (the only matches are pre-existing prose in `DESIGN.md`). No stub, empty-handler or hardcoded-empty-prop pattern flows to rendering.

### Human Verification Required

See the frontmatter `human_verification` list (five items): the 375px and 1280px visual backstop, the discovery and /compare keyboard walks, the admin shared-account line on a real pair across three viewer roles, and the seeded e2e lane plus a Node 22 CI run bound to the head SHA. None is demanded as automated by a success criterion.

### Environment Note

`src/lib/factsheet/compute.conventions.test.ts` fails 2 snapshot cases locally on Node v25 by the last float digit of `skew`. `src/lib/factsheet` is unchanged on this branch and `.nvmrc` pins 22, so it is treated as environmental and not a phase gap (logged in `deferred-items.md`). I did not run the full suite (the orchestrator is doing so).

### Gaps Summary

No gaps. Every success criterion and requirement is delivered in code at HEAD and covered by tests that I saw fail when the behavior was removed. Status is `human_needed` only because browser, live-data and CI-bound checks remain.

---

_Verified: 2026-11-08T22:00:00Z_
_Verifier: Claude (gsd-verifier)_

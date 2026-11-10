# Phase 196 census (SC-5): the factsheet before and after

Strategies are named by their public display name and a profile letter only. No strategy id,
share link or URL carrying one is recorded here; the run reads ids from the environment and
refuses to print one (`scripts/factsheet-census/run.ts`, exit 2).

## Before: 2026-11-09

Measured on the production site (deployed main at the run date) before any Phase 196 layout
change is deployed. The version string is not exposed by the site, so none is recorded.

### Method

- Tool: `scripts/factsheet-census/run.ts --mode before`, a Playwright (Chromium, 1440 x 900) pass
  over the live site, counting with `countFactsheetCensus` from `scripts/factsheet-census/count.ts`
  inside `article#factsheet-main` only.
- **Anonymous.** UI-SPEC § Census says "as an allocator". The run is anonymous instead, because no
  credential may be entered and the founder's browser is not needed. The only allocator-only
  element inside the article is the AUM chip (194 D-22). The before and the after run are both
  anonymous, so the comparison is like for like.
- Each page is loaded to network idle, then scrolled through in viewport steps (twice) so the
  `LazyMount` panels (heatmaps, signatures) mount before the count. Both runs do this.
- No production database access of any kind. The strategies were picked from the public browse
  page, unauthenticated.

### Definitions (the rules `countFactsheetCensus` applies)

Counting is by what is visible: an element is skipped when it or an ancestor inside the article is
`.sr-only`, `hidden`, `display: none`, marked `data-census-skip`, or sits under a closed
`<details>` (other than that details' own summary).

| Count | Rule |
|-------|------|
| sections | `details[id^="factsheet-"]` (every `CollapsibleSection`, and the Advanced row once it exists), `section` blocks whose own `header` holds an `h2` (every `EditorialSection`), the KPI strip `section` (the one holding `factsheet-kpi-label` cells), and every `[data-census-section]` element (the hook plan 10 adds). Deduped by element. |
| charts | `figure` elements plus `[role="img"]` elements not inside a counted figure. Heatmaps and the box plot are figures. The MasterBrush is excluded and listed apart. |
| brush | MasterBrush roots (`[aria-label="Master timeline brush"]`). A range control, not a chart. |
| repeated metrics | Normalised metric labels that occur more than once. Label sources: KPI strip cell labels, the label cell of every `table.text-fixed-12` row (the `Row` / `RollingRow` markup), and every `dl > dt` (the `Term` markup). One row is one occurrence however many columns it has. Normalisation: case-fold, trim, drop sr-only and aria-hidden text, drop trailing parenthetical qualifiers (repeatedly), drop a trailing colon or asterisk, then apply the alias table. |
| small-sample warnings | One entry per element of the family below. |
| hints | Visible elements whose text holds "wheel to zoom" or "Ctrl/Cmd + wheel", plus the element with id `factsheet-chart-hint`, counted once. |
| on request | `dd` / `td` cells whose visible text is exactly "— on request". |

Alias table (applied after normalisation; `CENSUS_ALIASES` and `CENSUS_ALIAS_PREFIXES` in `count.ts`):

| Label (normalised) | Counts as |
|--------------------|-----------|
| since inception | cumulative return |
| cum. return | cumulative return |
| max dd | max drawdown |
| ann. vol | annualized volatility |
| ann. volatility | annualized volatility |
| alpha | alpha |
| information ratio | information ratio |
| observation start | start date |
| observation end | end date |
| prefix `α vs ` + comparator name | alpha |
| prefix `ir vs ` + comparator name | information ratio |

Small-sample note family (the rule is this list; `warningKinds` in the output names each kind found):

| Kind | Where it comes from |
|------|---------------------|
| `strip-figure-gate-note` | the KPI strip's figure-gate note (the one note the layout keeps) |
| `figure-gate-note` | the rail's Main Metrics figure-gate note |
| `bootstrap-line` | the Bootstrap panel's "Bootstrap resamples are drawn from N observations." line |
| `rolling-subtitle` | the rolling charts' short-track subtitle suffix ("Rolling figures are annualized from a N-day window, under one year.") |
| `not-enough-data-card` | `NotEnoughDataPanel` cards, "... — Not enough data" / "... — Not available" |

Not in the family, kept by the UI-SPEC: `bench-figure-gate-note`, joint-floor and flat-leg reasons,
the window-withheld reason, the `<1y` marker, and the strip's data-quality caveats.

### Before table (production, anonymous, as loaded)

Every public strategy on 2026-11-09 is API-verified and under a year of record, so the profiles
resolve as follows. **Profile A has no match:** no published strategy matches profile A on
2026-11-09 (API-verified, a record of a year or more, comparator available). The longest public
record is 0.70 years. No other strategy was substituted for A; its before state is covered by the
fixture row further down.

| Profile | Display name | Record | sections | charts | brush | repeated metrics | small-sample warnings | visible hints | "— on request" rows |
|---------|--------------|--------|----------|--------|-------|------------------|-----------------------|---------------|---------------------|
| A | no published strategy matches profile A on 2026-11-09 | | | | | | | | |
| B | Momentum Sphinx | 0.52 years | 12 | 38 | 1 | 20 | 7 | 1 | 7 |
| C | Fibonacci Ghost | 0.21 years (under 90 days) | 12 | 31 | 1 | 19 | 6 | 1 | 7 |

Repeated metrics per strategy:

- B, Momentum Sphinx: 3 month, 6 month, alpha, annualized volatility, cagr, calmar, cumulative return, cvar 95%, end date, information ratio, kurtosis, max drawdown, month-to-date, profit factor, sharpe, skew, sortino, start date, var 95%, year-to-date
- C, Fibonacci Ghost: 3 month, alpha, annualized volatility, cagr, calmar, cumulative return, cvar 95%, end date, final month, information ratio, kurtosis, max drawdown, profit factor, sharpe, skew, sortino, start date, var 95%, year-to-date

### Small-sample note family: every instance found

| Strategy | Instances |
|----------|-----------|
| B, Momentum Sphinx (7) | strip-figure-gate-note x1, figure-gate-note x1, bootstrap-line x1, rolling-subtitle x4 |
| C, Fibonacci Ghost (6) | strip-figure-gate-note x1, figure-gate-note x1, bootstrap-line x1, not-enough-data-card x3 |
| Supplementary, Phoenix Protocol (6) | strip-figure-gate-note x1, figure-gate-note x1, rolling-subtitle x4 |

### Supplementary rows

A second profile-B strategy, measured the same way, as a cross-check on the B row (it also carries
a rebuilt-from-statement note under the masthead, which the census does not count):

| Profile | Display name | Record | sections | charts | brush | repeated metrics | small-sample warnings | visible hints | "— on request" rows |
|---------|--------------|--------|----------|--------|-------|------------------|-----------------------|---------------|---------------------|
| B (second) | Phoenix Protocol | 0.70 years | 12 | 38 | 1 | 20 | 6 | 1 | 7 |

Profile A, before, from the fixture payload (`censusPayloadA()`, a 730-day API-verified series with
the BTC comparator, rendered by jsdom through the real `FactsheetBody` at this base commit). This is
a fixture render, not a production measurement, and jsdom does not mount the signatures section, so
its chart count is lower than a browser's (22 here against 38 for the production B row):

| Fixture | sections | charts | brush | repeated metrics | small-sample warnings | visible hints | "— on request" rows |
|---------|----------|--------|-------|------------------|-----------------------|---------------|---------------------|
| A (jsdom) | 12 | 22 | 1 | 22 | 4 (rolling-subtitle x4) | 1 | 7 |
| B (jsdom) | 12 | 22 | 1 | 20 | 7 | 1 | 7 |
| C (jsdom) | 10 | 14 | 1 | 17 | 4 | 1 | 7 |

Repeated metrics, fixture A: 1 year, 3 month, 6 month, alpha, annualized volatility, cagr, calmar, cumulative return, cvar 95%, end date, final month, information ratio, kurtosis, max drawdown, profit factor, sharpe, skew, sortino, start date, var 95%, volatility, year-to-date.

### Notes and limits

- Three strategies are public. The census therefore covers profiles B and C on production, and
  profile A only through the fixture.
- Browser counts exceed jsdom counts on the same layout because the browser mounts the lazy
  signatures section. Compare browser to browser, and jsdom to jsdom.
- Anything outside `article#factsheet-main` (the viewer bar, the visitor header, the sign-up line)
  is not counted. A new element of that kind that lands inside the article must carry
  `data-census-skip`.

## After

Two readings: the fixture census (jsdom, measured 2026-11-09 on the final Phase 196 tree) and the
production census (pending deploy). They are never mixed: compare jsdom to jsdom, browser to browser.

Targets (UI-SPEC § Census):

| Count | Target |
|-------|--------|
| opening view | 3 content blocks plus the Advanced row |
| charts visible on open | 2 (curve and drawdown) |
| repeated metrics | 0, with Advanced closed and open |
| small-sample warnings | 1 or fewer |
| visible chart hints | 1 |
| "— on request" rows | 0 |

### Fixture census, after (jsdom, document layout)

Source: `npx vitest run "src/app/factsheet/[id]/v2/FactsheetBody.census.test.tsx"`, 27 arms passed on the final
tree. Counts by `countFactsheetCensus` over `censusPayloadA/B/C` from
`src/app/factsheet/[id]/v2/test-fixtures/census-payloads.ts`. "Closed" is Advanced closed, the opening
view; "open" has Advanced open with its contents mounted. The closed rows and the open rows' hints, warnings
and on-request counts are asserted by that test on every CI run; the open section and chart counts, and the
open repeated-metric sets, were read off the same counter on the final tree. Before values are the jsdom
fixture rows of the Before section above.

| Fixture | State | sections | charts | brush | repeated metrics | small-sample warnings | visible hints | "— on request" rows |
|---------|-------|----------|--------|-------|------------------|-----------------------|---------------|---------------------|
| A | before | 12 | 22 | 1 | 22 | 4 | 1 | 7 |
| A | after, closed | 4 | 2 | 1 | 0 | 0 | 1 | 0 |
| A | after, open | 15 | 22 | 1 | 3 (sharpe, sortino, volatility) | 0 | 1 | 0 |
| B | before | 12 | 22 | 1 | 20 | 7 | 1 | 7 |
| B | after, closed | 4 | 2 | 1 | 0 | 1 | 1 | 0 |
| B | after, open | 14 | 21 | 1 | 2 (sharpe, sortino) | 1 | 1 | 0 |
| C | before | 10 | 14 | 1 | 17 | 4 | 1 | 7 |
| C | after, closed | 4 | 2 | 1 | 0 | 1 | 1 | 0 |
| C | after, open | 12 | 13 | 1 | 2 (sharpe, sortino) | 1 | 1 | 0 |

Targets against the after rows:

| Count | Closed | Open |
|-------|--------|------|
| opening view: 3 content blocks plus the Advanced row (4 sections) | met (4 on A, B, C) | not applicable: opening view only |
| charts visible on open: 2 | met (2 on A, B, C) | not applicable (Advanced contents are 13 to 22 charts by design; the test uses it as a positive control) |
| repeated metrics: 0 | met | **not met**: A 3, B 2, C 2, all from the two Rolling Metrics tables (booked: `196-ROLLING-REPEATS-01` in TODOS.md) |
| small-sample warnings: 1 or fewer | met (A 0, B 1, C 1) | met (A 0, B 1, C 1) |
| visible chart hints: 1 | met | met |
| "— on request" rows: 0 | met | met |

The open section counts here (15, 14, 12) are one lower than the 16, 15 and 13 plan 11 recorded. The cause
was not traced: the test pins the closed section count (4) and does not pin the open one, and the closed
counts did not move. The Style Drift table is not visible to the counter, so the repeated-metrics reading
does not cover it (booked: `196-STYLE-DRIFT-CENSUS-BLIND-01`).

### Production after-run

**Pending until the phase deploys.** Phase 196 was built with no production access, and the named
strategies on production still run the pre-phase layout. Run it on the deployed phase, then record the
table here with the date and the same definitions. Same three profiles by display name as the Before
table (B: Momentum Sphinx; C: Fibonacci Ghost; A has no matching published strategy, so it stays on the
fixture row), measured anonymous, Chromium 1440 x 900, Advanced closed then open, scrolled twice before
each count. The command, with the ids supplied from the environment (never written here):

```
CENSUS_BASE_URL=https://quantalyze.xyz CENSUS_STRATEGIES='B:<ids from env>,C:<ids from env>' \
  npx tsx scripts/factsheet-census/run.ts --mode after
```

The print snapshot (a print-media render of each strategy's tearsheet) and the share-link render counts are
part of that same pending run:

```
... npx tsx scripts/factsheet-census/run.ts --mode after --print
CENSUS_SHARE_URL=<from env> ... npx tsx scripts/factsheet-census/run.ts --share
```

Expected from the fixtures, not a measurement: the closed state lands on 4 sections and 2 charts, one hint,
at most one warning and no "— on request" row; repeated metrics in the open state will report the rolling
labels until `196-ROLLING-REPEATS-01` is decided.

### Gate run

2026-11-09, final Phase 196 tree (plan 21 worktree, all 20 other plans merged): `npx tsc --noEmit` clean (0 `error TS`);
`npm run lint` exit 0 (0 errors, 4 warnings); `npm test` 1178 files passed, 1 failed, 20 skipped, 24504 tests passed, 2 failed,
306 skipped, the 2 being the known Node 25 versus Node 22 `compute.conventions` snapshot skew; `npm run check:route-contract`
OK (48 page routes, all declared). Read the census and the gates together.

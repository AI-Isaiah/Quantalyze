# Phase 236 FIGUREMATH: the figures that move (for the ship's CHANGELOG entry)

Source: the ten plan SUMMARYs of this phase (01 to 08, 10, 11), `236-QUANTSTATS-DECISIONS.md` and the
three founder rulings in `236-CONTEXT.md` (Q1 calendar span shown, Q2 CVaR floor on the total record,
Q3 adopt quantstats 0.0.86 per metric). Written 2026-11-25. Nothing here is a measured PROD number:
the fleet re-derive that moves the stored rows is the coordinator's, from
`docs/runbooks/figuremath-fleet-rederive.md`, and FIG-05 stays pending until it is recorded.

**The CHANGELOG entry must reference `236-QUANTSTATS-DECISIONS.md` (the per-metric record, 16 rows).**
It lives in the phase directory, so name it by file; a filtered `-pr` branch drops `.planning/`.

How a row moves. A strategy's stored figures change on its next recompute. Until then
`figure_defs_version` 3 (was 2, plan 01) makes the factsheet read the TypeScript engine's computed
figures, which are already on the new convention, instead of a stored version-2 row. So the factsheet
is on the new convention immediately and the stored headline catches up at the re-derive.

## 1. Year length and the CAGR span (F-5, Q1 "Keep calendar span, show it")

One rule everywhere: first to last observed date of the same suffix, whole days (floor), divided by 365.
Emptied stretches stay in the span.

| Figure | What moved | For whom | Decision, plan |
|---|---|---|---|
| CAGR and Calmar, narrowed range and window KPIs (`compute()`) | `days / 365.25` over fractional days becomes whole days / 365, with the one-day floor kept. Cumulative return is unchanged, so only the exponent moves: `ln(1 + cagr)` scales by 365 / 365.25 (about 0.07%) plus the flooring of a sub-day residue. Frozen fixture A: cagr 0.5234445 to 0.5230056, calmar 20.2784 to 20.2614 | every narrowed range and every computed-fallback factsheet (including a v2 stored row until re-derived) | F-5, Q1; 236-10 |
| `years` shown by the factsheet record length | 165 / 365.25 becomes 165 / 365; the 438-day record reads 1.2000 years exactly | same | 236-10 |
| Scenario planner CAGR and Calmar (`calendarYears`) | same rule: 812 whole days gives cagr 0.41303 to 0.41270 on the BLEND-07 numpy gate | every blend in Scenario | F-5, Q1; 236-02 |
| OG share card CAGR and Calmar | same rule (`calendarYears` is shared); 300-day case 0.200398 to 0.200548. **`OG_CARD_VERSION` bumped 3 to 4** (see section 8) | every card | F-5, Q1; 236-02 |
| Stored (Python) CAGR | no change: it was already first-to-last whole days / 365 | none | reference rule |
| New: the span line | the factsheet prints "CAGR over <first> to <last> (<n> days)" under the CAGR row: the stored span at full history, the window's own dates on a range. New stored keys `cagr_start`, `cagr_end` (also on the simple capital-reset convention: first and last observed day of the series the mean is taken over) | every re-derived row; an old row prints no line | Q1, FIG-04; 236-03, 236-11 |

## 2. Sample sd, ddof 1 (F-5)

Every TypeScript annualized dispersion now divides by n - 1 (`SD_DDOF`), so the TS engines agree with
the stored Python engine (pandas ddof 1). A volatility moves by sqrt(n / (n - 1)) up and a Sharpe by
sqrt((n - 1) / n) down. Every site moved (census, plan 01 and 05): `compute()` annualized vol and Sharpe
(`ddof: 0` and `dispersion(x, 0)`), `og-metrics` Sharpe (`ddof: 0`), `rolling.ts` (the 126-row and 30-row
windows, both the vol `dispersion(w, 0)` and the Sharpe), `joint.ts` (tracking error and information
ratio), `bootstrap.ts` (the Sharpe band), `holding-compare-adapter.ts` (vol and Sharpe, two sites each).

| Figure | What moved | For whom | Decision, plan |
|---|---|---|---|
| Factsheet headline vol and Sharpe (`compute()`) | population sd to sample sd. Frozen fixture A: ann_vol 0.1301830 to 0.1324085, sharpe 3.19059 to 3.13696 (n = 30) | every narrowed range and computed-fallback factsheet | F-5; 236-05 |
| The Sharpe confidence band (bootstrap) | centered on the new headline, band endpoints scale by sqrt(61 / 62) on the test series | every factsheet with a band | 236-05 |
| Rolling vol and Sharpe charts (126-row, 30-row and 365-day windows) | sample sd; a 30-return window reads vol x sqrt(30 / 29) | every rolling chart | 236-05 |
| Tracking error and information ratio | sample sd | every comparator view | 236-05 |
| OG card Sharpe | sample sd; equals `compute()` on the same series | every card | 236-05 |
| Compare surface vol and Sharpe | sample sd; equals `compute()` on the same series | every compare view | 236-05 |
| **Scenario planner rolling vol and Sharpe hover values** | about 0.4% at w = 126 (sqrt(w / (w - 1))); even-window alternating series: A x sqrt(w / (w - 1)). **Supersedes the Phase 108 user decision "population std is canonical (backbone)"**, which `scenario-blend-adapter.ts` and its test recorded; F-5 replaces it and the adapter derives from `rolling.ts`, which moved | every Scenario hover | F-5; 236-05 (conflict surfaced, Rule 7) |
| Unchanged on purpose | `sample-basis-ratios`, `portfolio-stats`, `scenario-benchmark` and `scenario.ts` were already ddof 1 (now read by name); skew and kurtosis stay population moments (not annualized); the Sortino downside RMS is not a standard deviation and is untouched | none | 236-05 |
| Also the optimizer clock | `optimize_weights` annualizes on the blend's frequency clock (365 crypto, 252 traditional) instead of a fixed 252. Scale-invariant objectives: no suggested weight moves beyond solver tolerance (pinned) | none visible | A5; 236-04 |

## 3. CVaR is historical and null below one named minimum (F-6, Q2 "Total record only")

`CVAR_MIN_OBS = 60`, one constant per language. It nulls CVaR only when the TOTAL record has fewer than
60 observations; a zoomed window always shows CVaR (consistent with the 2026-11-07 KPI rule). VaR is
never floored.

| Figure | What moved | For whom | Decision, plan |
|---|---|---|---|
| Stored `cvar` | null where the total record has fewer than 60 non-NaN returns; `var_1d_95` unchanged | every strategy with a short record, on re-derive | Q2; 236-03 |
| Factsheet whole-record `cvar95` (strategy factsheet and the allocator-portfolio payload) | the dash below 60 observations, whether the figure comes from the stored row or the computed fallback; a stored non-null CVaR on a record under the floor is withheld | short records | Q2; 236-07 |
| The book's ES95 widget | the dash below 60 returns while VaR95 and VaR99 still show; the n < 10 insufficient state is kept | books with fewer than 60 returns | Q2; 236-07 |
| Scenario blend CVaR | null below 60 observations of the blend's whole common series (replaces the n < 10 floor); VaR still shows | blends under 60 days | A6, Q2; 236-07 |
| Unchanged | the CVaR definition (historical, floor-index rule), shared with the TS twin; a narrowed window | none | F-6; 236-06 row 2 |

## 4. smart_sharpe and smart_sortino (A4)

Both scaled by a hard-coded `sqrt(252)`; they now scale by `sqrt(periods_per_year)`. Crypto strategies
(365) move by sqrt(365 / 252), about x1.2035. Traditional strategies (252) do not move. 236-03.

## 5. XIRR / money-weighted return (A5)

`compute_mwr` divides day spans by `CALENDAR_DAYS_PER_YEAR` (365) instead of 365.25. The log-rate scales
by 365 / 365.25 (verified on the reference sequence). Reference sequence 0.15636675 to 0.15625176; a
single outflow held exactly 365 days reads 0.10 where it read 0.10007186. Stored in
`allocator_equity_derived` kind `equity_curve`, `payload.scalars.mwr`, so it moves for every allocator
on the next derive-allocator-equity compose. 236-04.

## 6. quantstats 0.0.86 (Q3, every row in `236-QUANTSTATS-DECISIONS.md`)

The pin moved 0.0.81 to 0.0.86 (digest checked against PyPI's JSON API, lock diff touches one line,
banned packages absent). Values that move, per decision row:

| Metric | Decision | Moves for | Values (fixture) |
|---|---|---|---|
| `serenity_index` (its CVaR leg is now the historical tail of the drawdown series, as 0.0.86 `cvar(dd, method="historical")`; the parametric default is rejected) | ADOPT | **every strategy with a drawdown** | golden_252d 0.019258489731125872 to 0.01893104775322315; benign_mixed 0.143686058754821 to 0.1494210488068295 |
| `common_sense_ratio` (profit factor x tail ratio on observed rows) | ADOPT (A3) | NaN-carrying series only | 0.9094449129830964 to 0.909416022493258 |
| `time_in_market` (observed denominator, unrounded kept) | ADOPT | NaN-carrying series only | 0.994 to 1.0 |
| `probabilistic_sharpe_ratio` (Sharpe base on observed rows) | ADOPT (measured extension of A3 under Q3) | NaN-carrying series only | 0.3564452921230312 to 0.35603160170583026 |

Decided and not moving: stored `cvar` and `var_1d_95` (KEEP the repo's floor-index historical rule, F-6),
`win_rate` (measured no move), rolling alpha, strategy-gap greeks and r_squared, the sortino count
(already adopted, now live arms), `r_squared` on a benchmark gap (KEEP 166.4 D-A), ulcer, UPI, recovery,
kelly, payoff, cpc, omega and the live leaves. The coordinator may overrule the two measured extensions
(PSR base, `time_in_market`): each reverts in one line and its arm names it.

## 7. figure_defs_version 3

`FIGURE_DEFS_VERSION` 2 to 3 in `metrics.py` and `figure-gate.ts`, bumped in one commit (a half-bumped
pair fails the cross-language pin by design). A stored row at version 2 is read as OLD and the factsheet
shows computed figures until the row is re-derived. `golden_252d_expected.json` carries the marker by
hand edit (`regen_golden.py` was not run).

## 8. OG share card cache (measured, and the decision)

Measured in `src/app/api/og/factsheet/[id]/route.tsx`: a rendered terminal card is sent with
`Cache-Control: public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800` (1 hour in the
browser, 24 hours at the CDN, then up to 7 days served stale while it revalidates). Unfurlers key a card
by URL on their own clocks. So a card rendered under the old rules can keep answering well past one day
after deploy (worst case 24 h plus 7 days at the CDN alone). Decision: bump `OG_CARD_VERSION` 3 to 4 in
`og-metrics.ts` (the published OG URL carries `?v=`), pinned by a test in `og-metrics.test.ts` that the
version stays past 3. The TTL was not shortened.

## 9. The freeze side

Measured 2026-11-25 by plan 236-09, after a fresh `git fetch origin main`:

```
T=$(git ls-tree -r --name-only origin/main -- .planning/phases/)
printf '%s\n' "$T" | grep -a -c '155.2-12-SUMMARY.md'
0
git rev-parse origin/main
0fd4e8e49788920802e345b88d41b9d414c8c404
```

236 merges BEFORE 155.2 plan 12's recapture (`155.2-12-SUMMARY.md` is absent on origin/main; plan 12's
PLAN file is present and has no SUMMARY). The CHANGELOG entry carries this side. Re-check it before the
push, because the answer is only true until 155.2 plan 12 lands.

## 10. Known limits for the CHANGELOG notes

- The fleet re-derive is not done by this phase. Until it runs, stored rows read version 2, the factsheet
  shows computed figures, and the allocator MWR and the stored `cvar` / `smart_*` / `serenity_index`
  keep their old values. FIG-05 stays pending on the coordinator's recorded re-derive.
- `compute()`'s Sortino downside RMS divides by the observed count, outside the ddof rule; left as is.
- The unknown-leg asymmetry (Python reads an unknown leg as 252, the TS blend clock as 365) is deliberate
  and unowned; no Phase 236 decision covers it and no parity vector uses an unknown leg.
- A span under one whole day reads 0 years in the Scenario and OG engines where Python clamps to
  `max(days, 1)`; ISO day strings cannot produce such a span.
- The composite half of the old `L2214` item is out (F-2) and is untouched.
- TODOS entries this phase closes, deleted from `TODOS.md` in the same change per the repo rule:
  `[194-ENGINE-CONSTANTS]`, `QUANTSTATS-0086-REDERIVE-01` (heading and its own paragraphs only),
  `167.1.2.2.1-CAGR-EMPTY-SPAN`, and the non-composite "Backbone-bypass parity surfaces" bullet.

---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
slug: figuretruth
status: secured
asvs_level: 1
block_on: high
threats_total: 49
threats_closed: 49
threats_open: 0
audited_head: 77d8a6552
diff_base: 6f090001af1e1b340c2d7285505a3b718e22f1a3
audited_at: 2026-11-08
---

# Phase 194 FIGURETRUTH: security verification

Verdict: SECURED. 49 of 49 registered threats resolve to CLOSED (45 mitigate, 4 accept). 0 open, 0 blocking.
ASVS level is 1 (the level every plan's register declares). `block_on` is `high` (the default; `.planning/config.json`
carries no override). Method: each mitigation was located in the implemented code at HEAD, not taken from SUMMARY text.
Implementation files were read only.

One carry-forward (not an open threat): plan 09 (the PROD recompute, T-194-17 and T-194-18) is `human_needed`
and unexecuted. No `194-RECOMPUTE.md` and no plan 09 SUMMARY exist, so no PROD write has happened. Re-audit those two rows when the file lands.

## Threat verification

| Threat | Category | Sev | Disp | Status | Evidence |
|---|---|---|---|---|---|
| T-194-01 | Info disclosure | high | mitigate | CLOSED | `194-SC1-READING.md` is labelled S1/book, percentages only. Grep of the file for uuid, local home-directory paths, `$<digit>`, writing keywords returns nothing. Task 1 verify in `194-01-PLAN.md:95` carries the same refusals. |
| T-194-02 | Tampering | critical | mitigate | CLOSED | `194-SC1-READING.md` holds exactly three statements (lines 22, 31, 64): the marker (`shobj_description`) first and alone, then two SELECTs. No INSERT/UPDATE/DELETE/DDL anywhere. |
| T-194-03 | Tampering | high | mitigate | CLOSED | `analytics-service/tests/fixtures/figure_parity_vectors.json` and `rolling_1y_vectors.json` read by both languages (`test_figure_parity.py`, `src/lib/figure-parity.test.ts`, `rolling-calendar.test.ts`). |
| T-194-04 | Repudiation | medium | mitigate | CLOSED | `metrics.py:2442` writes `figure_defs_version = FIGURE_DEFS_VERSION` (226) on every new row. Readers gate on it: `figure-gate.ts:41`, `basis-metrics.ts:138`, `tearsheet/page.tsx:463`. |
| T-194-05 | Tampering | medium | mitigate | CLOSED | `src/lib/list-figures.ts:14,32-40,44-55`: a missing figure sorts last in both directions and never matches an active range; no 0 substituted. `StrategyTable.tsx:858-862,914` call it. |
| T-194-06 | Tampering | low | mitigate | CLOSED | `list-figures.ts:50-53`: non-finite value returns false under any bound; unparsable bound text compares false (no limit on a finite value); both-empty filter returns true. |
| T-194-07 | Repudiation | medium | mitigate | CLOSED | `basis-metrics.ts:138` returns `base` unless `figureDefsVersion >= FIGURE_DEFS_VERSION`. Test `fetch-and-build-payload.test.ts:1604-1640` covers marker and no-marker rows. |
| T-194-20 | Info disclosure | medium | mitigate | CLOSED | `fetch-and-build-payload.ts:315-318` selects only `six_month_return` plus four `metrics_json->key` aliases and `record_observations`. Pinned by `fetch-and-build-payload.test.ts:1604-1621` (`not.toMatch(/metrics_json(?!_by_basis\|->)/)`). Overlay copies five numbers via `numOrNull` (`:949-953`). |
| T-194-09 | Tampering | low | mitigate | CLOSED | Label-only changes; value-parity tests (`figure-parity-pages.test.tsx`, `format-percent-contract.test.ts`) in the diff. |
| T-194-47 | Info disclosure | low | mitigate | CLOSED | `src/app/api/scenario/peer-rank/route.ts` is UNCHANGED in the phase (`git diff` empty). Route still runs CSRF, getUser 401, approval gate, body validation, `scenarioPeerLimiter` fail-closed 503/429, aggregate-only payload, `NO_STORE_HEADERS`, own 20 floor (`:75`, `:196-201`). The removed 252-observation floor was client-only (`scenario-peer-request.ts`); a caller could always post any finite numbers to the route, so no server control was lost. |
| T-194-10 | Info disclosure | medium | mitigate | CLOSED | `queries.ts:576-577` adds only `series_start`, `headline_since`, `record_observations` as `->`/`->>` scalar aliases. Pin `queries.test.ts:443-475` strips each allowed form and asserts no bare `data_quality_flags`, `metrics_json` or `returns_series` remains. The projection carries four aliases, one more than the plan's "three" wording (the plan 10 row says four); all are scalars. |
| T-194-11 | Tampering | medium | mitigate | CLOSED | `list-figures.ts` swap in `StrategyTable.tsx:45,858,914`; `grep -c '?? 0' StrategyTable.tsx` is 0; negative test `StrategyTable.test.tsx:1117,1750`. |
| T-194-12 | Info disclosure | high | mitigate | CLOSED | `tearsheet/page.tsx:351-392,760-769`: `showAum` defaults false, set only after server `getUser()` and either owner match or `getUserRolesResult` containing allocator; every catch leaves false; row rendered only under `{showAum && ...}` so it is absent from the DOM. Tests `page.test.tsx:283-355,421-470`. |
| T-194-13 | Info disclosure | high | mitigate | CLOSED | `tearsheet/page.tsx:57` `export const dynamic = "force-dynamic"`; no cache directive in the file. |
| T-194-14 | Elevation of privilege | medium | mitigate | CLOSED | `tearsheet/page.tsx:381` compares server-read `viewerId` (from `auth.getUser()`) to `result.strategy.user_id` from the server query. No client input. |
| T-194-15 | Repudiation | medium | mitigate | CLOSED | `tearsheet/page.tsx:461-463` `historicalVar` requires `figure_defs_version >= FIGURE_DEFS_VERSION`. |
| T-194-19 | Info disclosure | medium | mitigate | CLOSED | `record-span-read.ts:31-32` four scalar aliases; `withPublishedOnly` (`:66`); request-scoped client passed in (no admin client); `import "server-only"`; field-type coercion `asString`/`asCount`; pinned by `record-span-read.test.ts`. |
| T-194-16 | Tampering | high | mitigate | CLOSED | `src/__tests__/figure-parity-pages.test.tsx` in the diff (parity over one stored fixture, RED proofs recorded in `194-08-SUMMARY.md`). |
| T-194-17 | Tampering | critical | mitigate | CLOSED, carry-forward | Control is procedural and present in the plan: `194-09-PLAN.md` `autonomous: false`, `checkpoint:decision gate="blocking-human"` (line 74), PROD write is a `checkpoint:human-action` run by the orchestrator (line 93), marker first and alone, product enqueue path only (lines 100-105), deploy-then-recompute precondition (line 95). No code path writes PROD. Not yet exercised: see carry-forward. |
| T-194-18 | Info disclosure | high | mitigate | CLOSED, carry-forward | `194-09-PLAN.md:110` verify refuses uuid and `/Users|home/`. File does not exist yet. |
| T-194-21 | Info disclosure | medium | mitigate | CLOSED | Browse page calls `readRecordSpan` (`browse/[slug]/[strategyId]/page.tsx`, reuse of plan 07 helper), published-only, request-scoped. |
| T-194-22 | Info disclosure | low | mitigate | CLOSED | `compare/page.tsx`: `record_observations` appended as one scalar alias at the page's own select, consumed into a `FigureRecord` map and `delete fetched.record_observations` before items reach client components; existing `queries.test.ts` "never projects metrics_json" pin still holds. |
| T-194-23 | Tampering | medium | mitigate | CLOSED | `194-ANNUALISED-SITES.md:112` "nothing is `unrouted`"; `194-10-SUMMARY.md:96` `ann-new: 0`. |
| T-194-24 | Info disclosure | low | mitigate | CLOSED | `queries.ts:2818-2853` `figureRecordScalars` returns only `figure_span_days`, `figure_observations`, `figure_crypto` (three scalars; plan said "one scalar", still scalars only). `queries.ts:3000-3003` destructures out `returns_series`, `daily_returns`, `data_quality_flags`, `record_observations`; `asset_class` dropped at `:2979`. |
| T-194-25 | Tampering | medium | mitigate | CLOSED | `strategies-row-adapter.ts:166-189` `gatedSharpe` uses `gateAnnualized` + `gatedValue` for both union halves; tests `HoldingsTable.figure-gate.test.tsx`. See observation O-3. |
| T-194-26 | Tampering | medium | mitigate | CLOSED | `figure-gate.ts:153,198,244,379` single verdict family built on `recordClears`/`gateAnnualized`; `figure-gate.d11.test.ts`, `closed-sets.cohort-gate-parity.test.ts`. |
| T-194-27 | Tampering | medium | mitigate | CLOSED | `portfolio_optimizer.py:169-188,827` emits `sharpe_lift_span_days` and state from the same window via `sharpe_lift_gate`; `match_engine.py`/`match.py` in diff with `test_match_engine.py`. |
| T-194-28 | Info disclosure | low | accept | CLOSED (accepted) | See Accepted risks. One integer day count, owner-visible data. |
| T-194-29 | Tampering | medium | mitigate | CLOSED | `rolling.ts:144` `ROLL_WINDOW_1Y_DAYS`; `build-payload.ts:571` 1y window only via `gateRollingWindow` and null under 365 days; `basis-context.tsx:257` `rederiveArgs` carries the total record to every `deriveSeriesBundle` call (`:400`, `:655`). |
| T-194-30 | Tampering | medium | mitigate | CLOSED | Rail copy and verdicts come from `figure-gate.ts` (`FactsheetView.tsx:154-155`, `:894`, `:1930-1944`). |
| T-194-31 | Info disclosure / integrity | medium | mitigate | CLOSED | `json-ld.ts:46-66` omits withheld CAGR, wraps short CAGR in a note; `page.tsx:834-835` `JSON.stringify(...).replace(/</g, "\\u003c")`. |
| T-194-32 | Tampering | low | mitigate | CLOSED | `factsheet/[id]/v2/page.tsx` cache key bumped `factsheet-v2-payload-v20` to `v21`; `page.public-cache-key.test.tsx` in the diff. |
| T-194-33 | Tampering | medium | mitigate | CLOSED | `ScenarioBenchmarkSection.tsx`, `scenario-factsheet-payload.ts`, `portfolio-stats.ts` in the diff with `.d11` tests. |
| T-194-34 | Tampering | medium | mitigate | CLOSED | `percentile-core.ts:51,77` `withholdShortRecordRanks` applied to population and subjects; `percentile-core.test.ts`, `queries.percentiles.test.ts`. |
| T-194-35 | Info disclosure | low | mitigate | CLOSED | `queries.ts:220-309` `percentileSelect` uses `PERCENTILE_SPAN_COLUMNS` (scalar aliases) inside `withPublishedOnly(...)` (`:309`, and `:114` area); `queries.percentile-columns.test.ts`. |
| T-194-36 | Elevation of privilege | high | mitigate | CLOSED | Migration `20261107140000_get_verified_cohort_rank_span_gate.sql`: full re-base, `SECURITY DEFINER` (`:273`), `SET search_path = public, pg_catalog` (`:274`), in-function guard `auth.role()='anon' OR auth.uid() IS NULL` raising 42501 (`:291-293`), `REVOKE ALL ... FROM PUBLIC, anon` (`:394`), `GRANT` only to authenticated and service_role (`:395-396`). DO block re-asserts each: prosecdef (`:446-450`), no PUBLIC/anon EXECUTE (`:452-460`), authenticated EXECUTE (`:462-466`), proconfig search_path (`:481-486`), min-N text (`:490`), 42501 text (`:493`). Called helper `ledger_refresh_parse_series_date` is `SET search_path` pinned and runs under the definer, so its revoked grants do not matter. |
| T-194-37 | Info disclosure | medium | mitigate | CLOSED | Output unchanged: `RETURNS TABLE (cohort_n, sharpe_pct, sortino_pct, max_dd_pct)` (`:262-267`); every projected expression is an aggregate; deciles via `round(round(...)/10)*10` (`:368-370`); `v_min_n CONSTANT INT := 20` (`:279`) with early return when `v_n_all < 20` (`:336`) and per-rank NULL when `v_n < 20` (`:368-369`). Route re-checks floor and NULL ranks (`route.ts:196-201`) and rate limiter is intact. No per-strategy id, name or value reaches the caller; probe oracle posture is unchanged (decile quantization plus `scenarioPeerLimiter`). |
| T-194-38 | DoS | low | accept | CLOSED (accepted) | See Accepted risks. The implementation is stronger than the plan states: the date cast goes through `ledger_refresh_parse_series_date`, which returns NULL on an impossible date instead of raising, and a regex pre-filter and `{1,9}` count regex guard the casts (`:319`). |
| T-194-39 | Tampering | high | mitigate | CLOSED | DO block (`:405-527`) reads only `pg_proc`, `pg_namespace`, `has_function_privilege`, `pg_get_functiondef`; no table reads, so an empty TEST does not refuse. Migration is wrapped `BEGIN;`(`:254`)...`COMMIT;`. Rollback kept off the auto-apply path in `supabase/migrations/down/`. PROD apply is via CI after `apply-test`, per repo rules; no CLI push is present in any tracked script of the diff. |
| T-194-40 | Tampering | medium | mitigate | CLOSED | `supabase/tests/test_get_verified_cohort_rank_gate.sql` carries 31 `RED-UNDER` markers, `RED-UNDER-M` arms targeting the new migration (arms 1, 2a, 3, 4a, 7, 8 ...); `scripts/mutation-floors.mjs` `ARMS_FLOOR = 811`, `WAIVED_CEILING = 0`. |
| T-194-41 | Tampering | medium | mitigate | CLOSED | `basis-context.tsx:257,400,655` `rederiveArgs`; `basis-context.joint-record.test.tsx`, `comparator-block.d11.test.ts`, `MetricsColumn.comparator-floor.test.tsx` in the diff. |
| T-194-42 | Tampering | medium | mitigate | CLOSED | `PortfolioImpactPanel.tsx`, `PortfolioOptimizer.tsx` read one gated object; `portfolio_optimizer.py:169-188`. |
| T-194-43 | Tampering (input) | low | mitigate | CLOSED | `portfolio-analytics-adapter.ts:158-213`: closed-set `parseLiftState` (`LIFT_STATES`), `parseWireFigureRecord` requires numeric `span_days`/`observations` and boolean `crypto`, `asNumber` for the count; a present out-of-set state fails closed to `"withheld"` (`:200`), stronger than the plan's "null". |
| T-194-48 | DoS | medium | mitigate | CLOSED | `simulatorSchema.ts`: `annualization_periods: z.number().int().positive().optional()` on the strict ok branch; the producer emits it (`simulator_scoring.py:249`); absent leads the consumer to withhold, not to 500. |
| T-194-44 | Tampering | high | mitigate | CLOSED | `rolling_1y_vectors.json` read by `test_rolling_1y.py` and `rolling-calendar.test.ts`; `metrics.py:2340-2349` produces the three 1y series, `rolling.ts:144-149` is the twin. |
| T-194-45 | DoS | low | mitigate | CLOSED | `metrics.py:2344-2349` each 1y series goes through `_finalize_rolling_calendar` into `_finalize_rolling` (`:3366-3415`) which ends `cap_data_points(...)`. |
| T-194-46 | Info disclosure | low | accept | CLOSED (accepted) | See Accepted risks. |
| T-194-49 | Tampering | medium | mitigate | CLOSED | `FactsheetView.tsx:894` and `rolling-window-choice.tsx` gate the chart from the verdict computed once in `build-payload.ts:539,571`; `FactsheetView.rolling-gate.test.tsx` in the diff. |
| T-194-SC | Tampering | low | accept | CLOSED (accepted) | `git diff` shows no change to `package.json`, lockfiles, `requirements*`, `pyproject` or `Cargo` files: no package installed. |

## Accepted risks log

| ID | Risk | Rationale (verified) |
|---|---|---|
| T-194-28 | Stored optimizer suggestion gains one integer `sharpe_lift_span_days` | An integer day count over data the owner already sees; no date or return added (`portfolio_optimizer.py:188`). |
| T-194-38 | A calendar-invalid, date-shaped string could raise in the cohort RPC's date cast | Not reachable as written: `ledger_refresh_parse_series_date` returns NULL on 22007/22008, so such a row reads "undeterminable" and stays in the cohort. The route also handles an RPC error with a constant 500 (`route.ts:176-182`). |
| T-194-46 | New stored `rolling_metrics` keys | Derived from returns the row already stores and the same readers already see. |
| T-194-SC | Supply chain | No package added in the phase. |

## New Sentry call sites (reviewed, no secrets or PII)

Every `captureToSentry` added since the base was read. `extra` carries only strategy ids, ISO date strings, a state string and the Supabase error message: `queries.ts:274,2838`, `build-payload.ts` (figure record), `record-span-read.ts:113`, `PortfolioOptimizer.tsx:180-188`, `ScenarioComposer.tsx` (tags only), the browse page (tags only). No returns values, keys, tokens, emails or names. Tags use stable reason strings. Clean.

## Stored-JSON parsing of producer verdicts (fail closed)

- `parseLiftState` / `parseWireFigureRecord` / the optimizer row parser fail closed to `"withheld"` (above).
- `figureRecord` marks a present-but-unparsable `seriesStart`, `seriesEnd` or `headlineSince` as `unreadable`, and `recordClears` returns false for it (`figure-gate.ts:113-130,138-141`), so `gateAnnualized` withholds.
- `overlayStoredFigureDefs` ignores a row with no or an old marker (`basis-metrics.ts:138`).

## Public-repo rule check (tracked text added since the base)

Scanned all 42,837 added lines. No home path, no real UUID (the 8 distinct UUIDs are all synthetic test fixtures such as `22222222-0000-4000-8000-00000000000a`), no Supabase project ref (compared against `supabase/.temp/project-ref`), no credential-shaped literal, no account number. One finding, below (U-1).

## Unregistered flags and observations (none blocking)

SUMMARY `## Threat Flags` sections: all 24 read "None" or restate a registered threat. No unregistered flag from the executors. The auditor adds:

- U-1 (WARNING, low): PROD book amounts in tracked text. `194-05-PLAN.md:55` (added by this phase) repeated the book's AUM, gross and net dollar figures (now reworded to a relation), copied from `ROADMAP.md:217`, which already carried it at the base commit. These are real PROD dollar amounts of the founder's book, against the repo rule "no PROD ids, amounts or account numbers in tracked text" that plans 01 and 09 impose on their own files. Not a credential or identifier, so non-blocking. Suggested action: reword both to a relation ("gross exceeds net, both differ from the stated AUM").
- O-2 (informational): `feesAndCommissionsSpecification: "AUM <n>"` in the public factsheet JSON-LD (`json-ld.ts:54`) and the v2 `FactsheetView` Allocation block (`:1376`) still show the manager's AUM to anonymous viewers. This predates the phase and D-06 is scoped to the tearsheet row (T-194-12 is closed on that scope), but D-06's intent ("only the allocator") is not extended to these two public surfaces. Founder call whether to route it.
- O-3 (informational, integrity): the Holdings `gatedSharpe` rebuilds a `FigureRecord` from three scalars and so drops the `unreadable` flag (`strategies-row-adapter.ts:176-181`); the producer reports it to Sentry but a malformed-date series with a stored count of 60 or more reads as state `"null"` and shows the stored Sharpe. The cohort SQL has the same permissive reading of a malformed date (undeterminable stays in; migration header, A-194-D15-02), while the TS gate withholds. The only writer is the analytics service, which emits real dates, so this is a corrupt-data edge, not an attack path.

## Verdict

SECURED. threats_open: 0.

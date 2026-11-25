---
phase: 236
slug: figuremath
status: secured
asvs_level: 2
block_on: high
threats_total: 26
threats_closed: 26
threats_open: 0
audited_range: 8507564ef..HEAD (non-.planning)
---

# Phase 236 FIGUREMATH: security audit

Verification is by code read at HEAD, not by SUMMARY claims. No test suite, database or Docker was run.
Register = the 24 numbered threats (T-236-01 to T-236-24) plus the T-236-SC supply-chain row, which the plans
declare twice with different dispositions (accept in plans 01 to 05, 07 to 11; mitigate in plan 06), counted as 2.

## Threat verification

| ID | Category | Sev | Disposition | Status | Evidence |
|----|----------|-----|-------------|--------|----------|
| T-236-01 | Tampering (one-sided constant drift) | high | mitigate | CLOSED | `src/lib/figure-conventions.test.ts:24` and `analytics-service/tests/test_figure_conventions.py:33` read both source files and assert each constant is defined exactly once; constants at `src/lib/figure-conventions.ts:25-38` and `analytics-service/services/figure_conventions.py:30-39` |
| T-236-02 | Tampering (stale stored figure after engines move) | high | mitigate | CLOSED | `FIGURE_DEFS_VERSION = 3` in both languages (`src/lib/figure-gate.ts:42`, `analytics-service/services/metrics.py:336`, stored at `metrics.py:2630`); overlay falls back to computed figures for older rows (`src/lib/factsheet/basis-metrics.ts:138`); payload cache key moved v27 to v28 (commit 0dc0843f3) |
| T-236-03 | Repudiation (unclassified annualizing site) | medium | mitigate | CLOSED | `src/__tests__/annualization-census.test.ts` (exact set, per-file `must_use` at lines 68-111, `NOT_YET_MIGRATED = []` at :264) and `analytics-service/tests/test_annualization_census.py` |
| T-236-04 | Tampering (pin re-pinned from engine output) | high | mitigate | CLOSED | Old -> new -> why table in `236-02-SUMMARY.md`; constit golden `cagr` moved by hand with the derivation written in the fixture `_readme` (`analytics-service/tests/fixtures/constit_parity_golden.json`); `scripts/capture-constit-parity-golden.ts` diff carries the note only |
| T-236-05 | Tampering (fractional or off-by-one day span) | medium | mitigate | CLOSED | One helper `wholeCalendarDays` (floor, non-finite or non-positive is 0) at `src/lib/figure-conventions.ts:44-49`; unparseable dates give NaN not a one-day floor (commit 411bc0c1e) |
| T-236-06 | Tampering (CVaR on a too-short record) | high | mitigate | CLOSED | `analytics-service/services/metrics.py:952` (`if n < CVAR_MIN_OBS`, imported :26); TS floor at `build-payload.ts:675,904`, `scenario-stress.ts:198`, `VarExpectedShortfall.tsx:60`, `scenario-factsheet-payload.ts:482` |
| T-236-07 | Tampering (TS twin floored by shared fixture edit) | medium | mitigate | CLOSED | Floor vectors in a separate `cvar_floor` section (`236-03-SUMMARY.md` golden decision section; `src/lib/factsheet/cvar-floor.test.ts`); `var_cvar` section left unfloored for the TS helper |
| T-236-08 | Info disclosure (cagr_start / cagr_end) | low | accept | CLOSED | Accepted risk AR-1 below |
| T-236-09 | Tampering (client-supplied periods_per_year) | low | mitigate | CLOSED | Route: `typeof` number plus closed-set check, 400 `VALIDATION_FAILED` (`src/app/api/scenario/optimize/route.ts:114-125`, set at :52-58); Python: `periods_per_year: Literal[252, 365]`, required (`analytics-service/models/schemas.py:344`); negative arms in `route.test.ts` (missing, 300, 0, "365", null, 365.25) |
| T-236-10 | DoS (new required field breaks old caller) | low | mitigate | CLOSED | Every caller supplies it: `analytics-client.ts:912-923`, `route.ts:195-200`, `WeightOptimizerSection.tsx:166`, `routers/optimizer.py:57`; `optimize_weights` keyword is required (`services/optimizer.py:139`); no other call site found by grep |
| T-236-11 | Tampering (headline vs band on different ddof) | high | mitigate | CLOSED | Census forbids ddof-0 and bare ddof-1 literals in engine files and has a positive `must_use: ["SD_DDOF"]` arm (`annualization-census.test.ts:84-111`), migration list empty |
| T-236-12 | Tampering (ddof pins re-pinned from engine output) | high | mitigate | CLOSED | Inline sample-sd oracles and the old -> new -> why table in `236-05-SUMMARY.md`; diff stat shows pin edits in tests only, no tolerance edits |
| T-236-13 | Tampering (dependency bump silently moves figures) | high | mitigate | CLOSED | RED list measured first, one decision row per metric (`236-QUANTSTATS-DECISIONS.md`, `236-06-SUMMARY.md` lines 77-240); live parity arms in `analytics-service/tests/test_metrics.py`; `qstats_gate.py` / `test_qstats_gate.py` recalibrated with `test_fig03_cvar_honours_prepare_returns_false` |
| T-236-14 | Tampering (CVaR on short record via fallback or second reader) | high | mitigate | CLOSED | Floor at `overlaid` shared by both payloads (`build-payload.ts:904`), bundles (:675), widget, blend; `src/__tests__/cvar-reader-census.test.ts` classifies every reader |
| T-236-15 | Tampering (zoomed window wrongly nulled) | medium | mitigate | CLOSED | `CVAR_MIN_OBS` is absent from `src/lib/factsheet/compute.ts` (grep over non-test src shows no hit there) and the census forbids it in window readers; narrowed-window test in `cvar-floor.test.ts` |
| T-236-16 | Spoofing (invented span text) | low | mitigate | CLOSED | `formatCagrSpan` returns null on missing, malformed or sub-day keys (`src/lib/factsheet/record-length.ts:64-71`); `MetricsColumn.cagr-span.test.tsx` |
| T-236-17 | Tampering (oracle imports the engine it checks) | high | mitigate | CLOSED | `analytics-service/tests/fixtures/annualization_parity_vectors.json` closed forms; `test_annualization_parity.py` and `annualization-parity.test.ts` recompute with `math` / `Date` / plain loops (per `236-08-SUMMARY.md` and file headers) |
| T-236-18 | Tampering (tolerance widened) | high | mitigate | CLOSED | Derived tolerance stated in both headers (`annualization-parity.test.ts` carries `1e-9`, 6 occurrences); PROOF-01 recorded in `236-08-SUMMARY.md` |
| T-236-19 | Tampering (PROD re-derive run from a plan) | high | mitigate | CLOSED | `docs/runbooks/figuremath-fleet-rederive.md` is the only artifact (747 lines); no write was run (`236-09-SUMMARY.md`). Marker query first at section 2 (:126-139); all three write forms are gated on `which_database = '<MARKER>'` inside the statement (`:381-384`, `:481-486`, `:598-605`), each tagged `-- WRITE`, and the runbook says "no row back from a WRITE form is a STOP". Marker is read from `scripts/prod-prober/cron-manifest.json`, never retyped |
| T-236-20 | Repudiation (unrelated TODOS entries lost) | medium | mitigate | CLOSED | `git show` count of `^- \[ \]` is 163 at base and at HEAD; `^### ` headings 147 -> 144, exactly the three entries this phase closes (QUANTSTATS-0086-REDERIVE-01, 167.1.2.2.1-CAGR-EMPTY-SPAN, 194-ENGINE-CONSTANTS) |
| T-236-21 | Tampering (re-baseline done by regen) | high | mitigate | CLOSED | `regen_golden.py` is not in the change set; golden edits are minimal and hand-derived; reviewed-act blocks in `phase-29-frozen-spine-guards.test.ts` and `phase-52-frozen-spine-guards.test.ts` (+67 lines each) |
| T-236-22 | Tampering (factsheet pin re-pinned from engine output) | high | mitigate | CLOSED | Inline oracles and old -> new -> why in `236-10-SUMMARY.md`; `og-metrics.test.ts`, `record-length.test.ts` carry the moves |
| T-236-23 | Tampering (golden keys pasted from engine output) | high | mitigate | CLOSED | `golden_252d_expected.json` diff for the span keys is exactly the two committed-date lines; decision note in `236-03-SUMMARY.md` (T-236-23); `regen_golden.py` not run |
| T-236-24 | Tampering (merge lands inside 155.2 freeze window) | high | mitigate | CLOSED | Runbook section 1 step 3 (`figuremath-fleet-rederive.md:~96-125`): fetch-failure STOP, written coordinator confirmation as the deciding input, counts table, STOP on any other combination |
| T-236-SC (plans 01-05, 07-11) | Tampering (npm/pip installs) | low | accept | CLOSED | Accepted risk AR-2; no package added by those plans (diff of `package.json` / lockfiles empty, only Python pins moved, see next row) |
| T-236-SC (plan 06) | Tampering (pip install quantstats 0.0.86) | high | mitigate | CLOSED | See "Supply chain" below |

## Supply chain: quantstats 0.0.81 -> 0.0.86

- Pin moved in lockstep in `analytics-service/requirements.in`, `requirements.txt:223` and `requirements-dev.txt`; exact `==` pins, no range.
- `git diff -U0` of `requirements.txt` is the single line `quantstats==0.0.81 -> 0.0.86`: no transitive dependency added, removed or moved.
- Independently re-measured in this audit against PyPI's JSON API: version 0.0.86, not yanked, wheel sha256 `4cfb157c8228cbb47681d6a81767d465fbc2bdf529643dd7e836479d2165efd6` and sdist sha256 `eb348e342410f0abb9b7a457f524df703dc337ed075303b842eaba220a11c7e1`. The wheel digest equals the one the executor recorded in `236-06-SUMMARY.md`.
- Banned-package assertion (`react-native-international-phone-number`, `react-native-country-select`): 0 hits in all three requirement files, recorded in the SUMMARY; neither is a Python package.
- `requirements.txt` carries no `--hash` lines (0 matches) and the Dockerfile installs with plain `pip install --no-cache-dir -r requirements.txt`. That is the repo's standing convention for the whole file, not introduced by this phase; so there is no per-artifact hash to confirm in-repo. See AR-3.
- The Dependabot `quantstats` ignore was removed (`.github/dependabot.yml`) by design, so future quantstats bumps arrive as PRs again and are gated by the parity arms.

## Runbook hygiene (`docs/runbooks/figuremath-fleet-rederive.md`)

- Every write is gated on the database marker inside the SQL; the standalone marker read is first (section 2) and the manifest value is substituted by `render`, not typed.
- Grep of the runbook for home paths, UUIDs, 20-character project-ref shapes, `supabase.co` hosts, JWT or key prefixes, emails and long digit runs: no hits. The two mentions of credentials are the generic instruction to read the DB password from the macOS Keychain inline and never echo it (`:91-92`), and a closing rule "Never write an id, an email, an account number or a project ref into a tracked file" (`:739`). Scratch CSVs holding ids live in `$FM_SP`, outside the repo.
- The same grep over the rest of the non-planning diff found no home path or project host.

## Scenario optimize route: upstream-422 Sentry capture (unregistered surface)

Added in review round 1 (commit c09dbc987), in no plan's threat model and in no SUMMARY Threat Flags. Verified clean:

- `route.ts:283-293` calls `captureToSentry(err, { tags: {surface, step}, extra: { upstream_status, objective, series_count } })`. The `extra` carries a status, the closed objective enum and a count: no request body, series values, strategy ids, or user id.
- The error message comes from the Python 422 handler's `detail`, which `_validation_detail` builds from `type` + `loc` only and explicitly never reads `input`, `ctx`, `msg` or `url` (`analytics-service/services/app_error_handlers.py:66-77,98-122`).
- `captureToSentry` rebuilds the error with `scrubSeamString` over message, name and stack, and scrubs `tags` / `extra` (`src/lib/sentry-capture.ts:102-131,195-215`).
- The user response stays the flat 502 with the generic copy (`route.ts:295-302`); positive test at `route.test.ts` ("an upstream 422 IS captured as contract drift, and the user still gets the flat 502").

## Unregistered flags

- WARNING (informational, no blocker): the upstream-422 capture above. No threat ID, but audited and closed.
- SUMMARY `## Threat Flags` sections: all "None" or mapped to existing IDs (plans 01 to 09, 11); plans 04 and 06 name T-236-09 and the provenance section respectively. No other new attack surface found in the diff (no new endpoint, auth path, schema or migration).

## Accepted risks

| ID | Risk | Rationale |
|----|------|-----------|
| AR-1 (T-236-08) | `cagr_start` / `cagr_end` expose the first and last observed day of a CAGR window | Derived from `returns_series` dates that the same payloads already publish; no new information. |
| AR-2 (T-236-SC, accept rows) | Nine plans install no packages | Nothing was added; `npm ci` installs the locked tree only. |
| AR-3 (T-236-SC plan 06 residual) | quantstats provenance is a digest match against PyPI's own JSON plus a one-line lock diff, not an in-repo hash lock | A compromised upstream publisher would publish a matching digest, which this check cannot detect (the executor says so in `236-06-SUMMARY.md`); and the executor compared only the wheel (this audit compared both digests to PyPI, not the sdist bytes). Residual is bounded by exact pinning, the unchanged transitive set, and live parity arms that run against 0.0.86. A hash-locked requirements file is a repo-wide change outside this phase. |

## Notes (non-blocking)

- The TODOS.md diff also deleted a `Backbone-bypass parity surfaces` bullet carrying the "Owned by Phase 236" tag. It is the 236-owned residual and the open `- [ ]` count is unchanged, so T-236-20 holds; flagged only so a reader knows the bullet went with the 194 entry.

**threats_open:** 0

---
phase: "169"
slug: "pagetruth"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
block_on: high
created: "2026-09-29"
audited_at_sha: 48ee02a13
scope: "plans 169-01, 04, 05, 06, 07, 09, 10 and the surface added by review fix rounds T1-T6. The comparator plans moved to 169.5 and are out of scope."
---

# Phase 169 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| public/anon viewer -> factsheet | anyone may view a published factsheet; the numbers are an investment-grade claim | published strategy metrics |
| factsheet route -> strategy_analytics | the visibility gate (published or owner) is unchanged; the select widens only by public scalars | seven headline scalars already in `PUBLIC_ANALYTICS_COLUMNS` |
| service-role read -> shared public cache | a transient read failure must not become the cached answer for the TTL | factsheet payload |
| service-role read -> `strategy_analytics_series` (fix round, H-1) | deny-all table read by the service role for the cash-series span | one strategy's cash series, filtered by `strategy_id` |
| resolve stage -> Sentry | an outage event names the row by id only | strategy id, table name, error code |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-169-13 | Tampering / integrity | persisted-scalar overlay | high | mitigate | `persistedCashHeadline` returns undefined unless `isRankableAnalyticsRow` (`composite-read-path.ts:881-883`); a persisted non-number stays null and renders the em-dash (`:931-936`); both callers go through it | closed |
| T-169-14 | Information disclosure | widened analytics select | low | mitigate | only the seven scalars already public via `PUBLIC_ANALYTICS_COLUMNS` (`fetch-and-build-payload.ts:319-320`, `queries.ts:1065`); predicate still wraps the query (`:323`) | closed |
| T-169-15 | Integrity | chart vs headline | medium | mitigate | Pitfall 1 invariant pinned (`build-payload.headline-source.test.ts:251`); broken-chain caveat rendered (`MetricsColumn.tsx:46-47`) | closed |
| T-169-16 | Integrity | compute() windows | high | mitigate | one helper `windowReturn` (`compute.ts:234-243`) for all seven windows; calendar 3Y/5Y; weekday allowance only when the series spans a Saturday with no weekend print (D-11 amended, WR-R2-01); tests `compute.metrics.test.ts:208-259` | closed |
| T-169-17 | Integrity | FreshnessChip | medium | mitigate | date line from `resolveSeriesEnd` (`FactsheetView.tsx:1233`), the recency line's derivation | closed |
| T-169-18 | Integrity (cross-phase) | MetricsColumn / allocations files | medium | mitigate | plan-04 merge `0e6c7d47e` touches neither area | closed |
| T-169-23 | Integrity | 3Y / 5Y rows | high | mitigate | rows render only when `p3y`/`p5y` non-null (`MetricsColumn.tsx:499-500`); index-clamped fallback deleted (`8cd75cc79`) | closed |
| T-169-23b | Integrity | 6M / 1Y rows, factsheet and scenario | high | mitigate | both panels omit a null row (`MetricsColumn.tsx:168-169`, `:496,498`); scenario mount tested | closed |
| T-169-24 | Tampering (cross-phase) | MetricsColumn.tsx and C3's test | medium | mitigate | amended at audit: `217af15f6` changed the two length literals (`0.79y` -> `0.54y`, lines 120 and 150) of C3's test, no threshold assertion; recorded in `169-05-SUMMARY.md:41` | closed |
| T-169-06-A | Integrity (integration drift) | merged phase branch | medium | mitigate | plan 06 Task 1 ran on the merged branch at `439e9e259`, after the last merge of origin/main (`ab12aff26`, bringing 167.1.2 C3; `git merge-base --is-ancestor origin/main HEAD` exit 0): tsc 0 errors; lint exit 0; full suite 17524 passed, 1 failed (`ci-anti-skip-gate.contract.test.ts`, 5 s timeout under load; 33/33 alone); compute-once + critical-regressions 203 passed; D-22 parity table `fetch-and-build-payload.test.ts` 38 passed; SC1 live reproduction on the private local lane 7 passed, 0 skipped (`REPRO-SINGLE-ONE-POINT`, `CONTROL-BUILDABLE` present); `test:live-db:ledger` exit 0, "the failing set is EXACTLY the ledger (7/7)", 408 executed across 50 files. The keyset reader ran against a real PostgREST in the two composite SC1 cases (one data page, then the empty page that ends the read); the past-1000-rows case is unit-tested only (the 1112-row fake). No integration fix was needed. Evidence in `169-06-SUMMARY.md`. *Lineage (2026-09-29, at `48ee02a13`):* "Not yet recorded at `48ee02a13`: no 169-06 SUMMARY, and the live-DB suite that exercises the CSV-READ-CAP keyset paging was not run. Re-run owned by plan 06 before ship" | closed (2026-09-29, plan 06 Task 1 re-run; was open, medium, non-blocking) |
| T-169-06-B | Repudiation | post-deploy check | medium | mitigate | pre-deploy half in place (v8 key at `v2/page.tsx:191`); post-deploy browser check bound to the deployed SHA is plan 06 Task 3, pending | closed (post-deploy half pending) |
| T-169-06-C | Information disclosure | CHANGELOG / SUMMARY | medium | mitigate | no identifiers, credential-shaped literals or skip tokens in the CHANGELOG diff or the 109 branch commit messages; planning hygiene OK | closed |
| T-169-06-D | Integrity (shared DB) | SC1 live reproduction | high | mitigate | local lane only (`scripts/local-stack/run.sh`); `vitest.livedb.globalsetup.ts:136-139` refuses any non-localhost API URL | closed |
| T-169-07-A | Denial of service (cached outage) | `buildFactsheetPayloadCached`, composite and single-key series reads | medium | mitigate | reader throws `CompositeSeriesReadError` (`composite-read-path.ts:260-274`), resolve answers `read_error` (`fetch-and-build-payload.ts:454-455`), cached callback throws before storing (`v2/page.tsx:142`). Widened at audit: covers the CSV-READ-CAP codes (`page_order`, `no_data`, `row_ceiling`, bounded by `CSV_READ_MAX_ROWS`) and the single-key MTM / smoothed / cash-series outages (WR-05, H-1) | closed |
| T-169-07-B | Repudiation | owner-lane note and /strategies tally | low | mitigate | `read_error` with its code (`fetch-and-build-payload.ts:263-290`); tally and owner note map it | closed |
| T-169-07-C | Information disclosure | error message and log line | low | mitigate | message names the series/table, never the strategy (`composite-read-path.ts:203`); H-3 capture scrubbed by `scrubCaptureInput` (`sentry-capture.ts:99-115`) | closed |
| T-169-07-D | Integrity (stale cache) | factsheet cache | medium | mitigate | key v8 (`v2/page.tsx:191`); both hand-typed pins moved; no `payload-v7` left | closed |
| T-169-09-A | Integrity | RiskAttribution | medium | mitigate | one conversion `percentToFraction` (`RiskAttribution.tsx:33-35`) | closed |
| T-169-09-B | Integrity (cross-consumer drift) | adapter / portfolio-insights | low | mitigate | amended at audit: fix-round M-5 (`5ece86168`) did edit both files, null handling only: `weight_pct` is `number \| null` (`types.ts:1500`), both consumers filter null, neither converts units | closed |
| T-169-10-A | Integrity (money) | price and P&L cells | medium | mitigate | one formatter module (`dollar-validation.ts:78,93,126`) used by both tables. Amended at audit: `formatUsd` now rounds first, normalises -0 and returns the em-dash for non-finite input (`e041950e8`); the original pins are unedited and pass | closed |
| T-169-10-B | Integrity (colour) | pnlColor | low | mitigate | reads `signAtCents`, the decision `formatUsdSigned` uses | closed |
| T-169-25 | Information disclosure / integrity | `readHeadlineCoversFrom` service-role read of `strategy_analytics_series` (fix round H-1) | low | mitigate | filtered by `strategy_id` (`composite-read-path.ts:558-567`); runs only when `cashHeadline` exists and `shouldReadSingleKeyCashSeries` passes (`:806-810`), both reducing to `isComputedAnalytics`; the id always comes from a visibility-gated caller; a failed read answers `read_error` | closed |
| T-169-01-SC / 04-SC / 05-SC / 06-SC / 07-SC / 09-SC / 10-SC | Tampering (supply chain) | dependencies | low | accept | only the version line of `package.json` changed; no lockfile or Python requirements diff | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-169-01 | T-169-01-SC, 04-SC, 05-SC, 06-SC, 07-SC, 09-SC, 10-SC | No package installed or changed; the only `package.json` diff is the version line | plan threat models (planner), confirmed by gsd-security-auditor | 2026-09-29 |
| AR-169-02 | (note, no row) | A probe's abort signal reaches only the strategy read; paged csv reads and the H-1 read finish in the background after a probe times out (up to about 21 pages for a long composite). Pre-existing behaviour, bounded by `CSV_READ_MAX_ROWS`, read-only | gsd-security-auditor note | 2026-09-29 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-29 | 28 (27 planned + T-169-25 from the fix rounds) | 27 | 1 (T-169-06-A, medium, non-blocking) | gsd-security-auditor (ASVS L1, block_on high) at `48ee02a13` |
| 2026-09-29 | 28 | 28 | 0 | gsd-executor, plan 169-06 Task 1 re-run at `439e9e259` (after merge `ab12aff26`): T-169-06-A closed with the integration, D-22 parity and SC1 live-lane evidence; no other row changed |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-29; T-169-06-A closed 2026-09-29 by plan 06 Task 1's re-run at `439e9e259`. *Lineage:* "verified 2026-09-29 (T-169-06-A open below the block threshold; closed by plan 06 Task 1's re-run before ship)"

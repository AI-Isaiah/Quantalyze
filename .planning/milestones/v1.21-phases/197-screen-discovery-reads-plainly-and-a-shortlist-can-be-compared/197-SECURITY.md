---
phase: 197
verdict: SECURED
threats_total: 24
threats_open: 0
audited_at_sha: 49d90ef5b
auditor: gsd-security-auditor (read-only, code reads and greps; tests cited by existence)
---

# Phase 197 (SCREEN) security audit

Every T-197-* threat in plans 01-06 has its mitigation in code at the boundary the plan named.
21 are mitigated, 2 accepted and documented (T-197-12 catalogue enumeration, T-197-18 /browse
hydration order), and the supply-chain row repeated per plan is counted once.

## Threats

| Threat | Disposition | Evidence | Status |
|---|---|---|---|
| T-197-01 figure label spoofing | mitigate | `discovery-columns.ts` period qualifiers and accessible names; no "1y" string in the map | closed |
| T-197-02 record length tampering | mitigate | Track reads the 194 gate record (`rowRecord(s)`), `ONE_YEAR_DAYS = 365` | closed |
| T-197-03 unpublished strategy disclosure | mitigate | `shared-account-partners.ts` strategies read wrapped in `withPublishedOnly` (only strategies read in the module) | closed |
| T-197-04 reader output disclosure | mitigate | `api_keys` select has no credential columns; output is strategy id to partner names only | closed |
| T-197-05 import-graph elevation | mitigate | `import "server-only"` line 1; only importer is the async server page `discovery/[slug]/page.tsx` | closed |
| T-197-06 admin gate | mitigate | `isAdminUser` runs before `createAdminClient()`; returns false on every error path | closed |
| T-197-07 page DoS on read failure | mitigate | every read error and throw goes to `failed()` (Sentry + null); paged read never returns a half map | closed |
| T-197-08 misleading rank | mitigate | `listSeriesVerdict` on `series_end` drives sort, ordinal, percentile and chip | closed |
| T-197-09 server/client order | mitigate | discovery page passes `nowMs={Date.now()}`; table seeds from it | closed |
| T-197-10 compare search disclosure | mitigate | own non-published rows and compared ids dropped; reuses `/api/strategies/browse` unchanged | closed |
| T-197-11 open redirect / script URL | mitigate | `compareHref` fixed path + `encodeURIComponent`; Remove hrefs from resolved ids only | closed |
| T-197-12 catalogue enumeration | accept | existing per-user limiter, one fetch per mount, allocator-gated page | closed (accepted) |
| T-197-13 oversized compare URL | mitigate | `COMPARE_MAX_ITEMS = 4` in reducer, page slice and search mount | closed |
| T-197-14 allocator control on anonymous page | mitigate | `selectable` only on `/discovery/[slug]`; phase-149 pin 2b | closed |
| T-197-15 RSC payload disclosure | mitigate | partner prop spread only when non-null; `/browse` has neither the prop nor the reader (pin 2c) | closed |
| T-197-16 admin check fails open | mitigate | as T-197-06/07; no second check in the page | closed |
| T-197-17 count hints at unpublished | mitigate | reader sees published strategies only | closed |
| T-197-18 /browse hydration order | accept | documented in 197-03; remedy `nowMs` once Phase 196 lands | closed (accepted) |
| T-197-SC npm installs | mitigate | no change to package.json, package-lock.json or `src/app/api` | closed |

## Structural checks

- No migration: `git diff 73101d64c..HEAD --name-only -- supabase/` is empty.
- No new API route: the `src/app/api` diff is empty.
- `createAdminClient` appears in new phase code only in `shared-account-partners.ts`, after the admin gate.

## Non-blocking observations (not threats)

1. `isAdminUser` is called outside the reader's `try`, so "the reader never throws" is slightly
   stronger than the code; only an exceptional supabase-js throw could reach the page, with no data leak.
2. `CompareAddStrategy.choose()` relies on the page not mounting the search at four items for the cap.
3. `withPublishedOnly` is the single fence on the service-role read; its test was seen RED with the fence removed.

---
phase: 210-publictruth-public-factsheet-cues-come-from-real-data-only
verified: 2026-11-14T12:45:00Z
status: passed
score: 4/4 must-haves verified
verified_at_sha: d1663b63a75404b7e08cf19b7b044fde82004a2f
drift_subjects:
  - supabase/migrations/20261114120000_get_published_trade_venues_open_windows.sql
  - supabase/migrations/down/20261114120000-rollback.sql
  - supabase/schema/functions/get_published_trade_venues.sql
  - supabase/tests/test_get_published_trade_venues.sql
  - scripts/mutation-floors.mjs
  - src/lib/factsheet/build-payload.ts
  - src/lib/factsheet/types.ts
  - src/lib/factsheet/trade-fetch-provenance.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/app/factsheet/[id]/trade-fetch-lines.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/page.tsx
behavior_unverified: 0
overrides_applied: 0
human_verification_resolved:
  - test: "migration-reviewer and rls-policy-auditor on supabase/migrations/20261114120000_get_published_trade_venues_open_windows.sql"
    result: "Both CLEAN on 2026-11-14 (migration-reviewer: 0 CRITICAL/HIGH/MEDIUM/LOW; rls-policy-auditor: 0 findings, leak scopes none). Run by the phase agent before ship."
---

# Phase 210: PUBLICTRUTH Verification Report

**Phase Goal:** public factsheet cues come from real data only: no false venue-mismatch cue after a key rotation, no invented peer or allocator data in a public payload, and a malformed gap record is disclosed instead of reading as "no gaps".
**Verified:** 2026-11-14
**Status:** passed (all four success criteria verified in the code; the pre-merge migration-reviewer and rls-policy-auditor review named by SC-1 ran clean on 2026-11-14, recorded below)
**Re-verification:** No, initial verification
**HEAD:** d1663b63a (branch feat/210-publictruth), diff base 8fc78b69a

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP SC) | Status | Evidence |
|---|--------------------|--------|----------|
| 1 | `get_published_trade_venues` filters closed key windows, so a key rotation does not raise a false venue-mismatch cue | VERIFIED (review half pending, see Human Verification) | New migration `20261114120000_...open_windows.sql` re-bases the full body and adds `AND (sk.window_end IS NULL OR sk.window_end > current_date)` to the `strategy_keys` arm only; the single-key arm is byte-identical. SECDEF, `SET search_path = public, pg_temp`, `RETURNS TABLE (strategy_id uuid, exchange text)`, REVOKE FROM PUBLIC and GRANT to anon/authenticated/service_role are restated. The self-verify reads only `pg_proc`, `has_function_privilege` and `aclexplode(proacl)`, never a table, so it applies on empty TEST ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]). Rollback restores the 20261019120000 body with `CREATE OR REPLACE`, no DROP. Schema snapshot `supabase/schema/functions/get_published_trade_venues.sql` carries the new predicate. I ran the gate on a throwaway pg-lane: baseline exit 0, 12/12 arms RED with identity ok (see Spot-Checks). Reader `readPublishedTradeVenues` is unchanged and already leaves a zero-row strategy without venue fields (D-06), pinned by `queries.trade-venues.test.ts`; `SyncBadge.venue.test.tsx` pins `[okx]` for a listed okx as no mismatch and `[binance, okx]` as mismatch. |
| 2 | No public payload carries invented peer or allocator data | VERIFIED | `FactsheetApiPayload` in `types.ts` no longer has `peerPercentile` or `allocatorPortfolios`; `AllocatorPortfolioPayload` deleted; the api arm of `buildFactsheetPayload` returns only `eventSignatures` / `benchEventSignatures` on top of `common`. `src/lib/factsheet/peer-cohort.ts` and `allocator.ts` (and their tests) are deleted. `grep` over `src`, `analytics-service`, `scripts`, `supabase` finds no production reader of `peerPercentile`, `allocatorPortfolios`, `computePeerPercentile`, `alignBlend`, `buildAllocatorMetrics` or `hideAllocatorSection`; every hit is an absence assertion or prose. `PeerPercentilePayload` / `scenarioPeer` stay on the csv arm (real verified universe, out of scope per CONTEXT). `SPX/IEF/GLD/ETH_DAILY` stay because the comparator correlations still read them (`build-payload.ts:188-191`). Cache key bumped once, `factsheet-v2-payload-v24` to `v25`, and it is the only `unstable_cache` storing a factsheet payload; no `v24` string remains in `src`. `tsc --noEmit -p .` is clean. |
| 3 | A malformed gap record reaches Sentry and the tear sheet withholds instead of claiming no gaps | VERIFIED | `readUnrecoveredGaps` returns `{ gaps, malformed }`; every malformed branch yields a non-null reason (`trade-fetch-provenance.ts`). `fetch-and-build-payload.ts:989-1000` reports a non-null reason via `captureToSentry` with tags `stage`, `reason`, `strategy_id` and only the reason string in `extra.detail` (no raw provenance, no dates; `T-210-11` pins that), and sets `unrecoveredGapsUnavailable: true` (threaded through `build-payload.ts:1082` into the payload). `FactsheetView.tsx:1653-1655` passes it to `UnrecoveredGapLines`, which renders the locked sentence "Record of days without trade data unavailable. Some days may be missing from the record." in muted-secondary and no gap line. The tear sheet renders `FactsheetView` from the same builder; the `printView` render test shows the sentence exactly once. The only production reader is `readUnrecoveredGaps`; the shorter `parseUnrecoveredGaps` wrapper survives only for tests (see Advisory). |
| 4 | Each fix has a test that goes RED when it is reverted | VERIFIED | Measured, not read. SQL: 12/12 mutation arms RED, including `TV-closed-window` and `TV-window-end-today` (new) and the five re-pointed body-editing arms. TS: with the four source files backed up byte-for-byte, I neutered (a) `malformed: reason` to `malformed: null`, (b) the `captureToSentry` branch, (c) the `unavailable` branch in `UnrecoveredGapLines`, (d) re-added `peerPercentile` / `allocatorPortfolios` (with "60/40 Stocks/Bonds") to the api return. 17 tests went RED across five files: the nine reader-verdict cases in `trade-fetch-provenance.test.ts`, the Sentry-and-flag and reason-only cases in `fetch-and-build-payload.test.ts`, the three render cases in `FactsheetView.unrecovered-gap.test.tsx`, the api-payload absence test and byte-identical snapshot in `build-payload.test.ts`, and the "premise" case in `FactsheetBody.no-demo-content.test.tsx`. Files restored by `cp` from the backups; `git status` is clean at HEAD. |

**Score:** 4/4 truths verified (0 present-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `supabase/migrations/20261114120000_get_published_trade_venues_open_windows.sql` | Open-window predicate, grants, catalogue self-verify | VERIFIED | Substantive, 168 lines; applied by the gate's RED-UNDER-SETUP; predicate in snapshot |
| `supabase/migrations/down/20261114120000-rollback.sql` | Non-DROP rollback | VERIFIED | Restores prior body with CREATE OR REPLACE |
| `supabase/tests/test_get_published_trade_venues.sql` | Closed-window arms, re-pointed arms | VERIFIED | 12 arms, all bite |
| `scripts/mutation-floors.mjs` | `ARMS_FLOOR` 830 to 832 | VERIFIED | `--parse-only`: `No static defects`; floors tests, gate-family-meta and annotation-parser tests pass |
| `src/lib/factsheet/trade-fetch-provenance.ts` | `readUnrecoveredGaps` with verdict | VERIFIED | Wired into `fetch-and-build-payload.ts` |
| `src/lib/factsheet/fetch-and-build-payload.ts` | Sentry report and flag | VERIFIED | Wired to payload and view |
| `src/app/factsheet/[id]/trade-fetch-lines.tsx` | `unavailable` prop and sentence | VERIFIED | Rendered by `FactsheetView.tsx:1653` |
| `src/lib/factsheet/build-payload.ts`, `types.ts` | Demo fields gone from api arm | VERIFIED | No remaining producer or reader |
| `src/lib/factsheet/peer-cohort.ts`, `allocator.ts` | Deleted | VERIFIED | Absent from tree |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `readUnrecoveredGaps` | Sentry | `captureToSentry` in `buildFromResolved` | WIRED | Fires once per build on non-null `malformed` |
| `fetch-and-build-payload.ts` | `buildFactsheetPayload` | `unrecoveredGapsUnavailable` strategy input | WIRED | Spread into `common` only when true (`build-payload.ts:1082`) |
| payload flag | `UnrecoveredGapLines` | `FactsheetView.tsx:1653-1655` | WIRED | Same view serves the tear sheet |
| `get_published_trade_venues` | Discovery cue | `readPublishedTradeVenues` to `SyncBadge` | WIRED | Reader unchanged; zero rows mean no venue fields and no cue |
| migration | gate | RED-UNDER-SETUP lists both migrations in order | WIRED | Gate applies the new body over the old one |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `UnrecoveredGapLines` | `unavailable` / `gaps` | `series_provenance` from the analytics row via `readUnrecoveredGaps` | Yes | FLOWING |
| Discovery venue cue | `tradeVenues` | `get_published_trade_venues` RPC over `strategy_keys` / `api_keys` | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| SQL gate bites on revert | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_get_published_trade_venues.sql` | baseline exit 0; `arms: 12/12/0`; `biting: 12`; `lane-invocations: 12`; restore exit 0 | PASS |
| Census static parse | `node scripts/mutation-runner/run.mjs --parse-only` | `coverage: files 81/108`; `No static defects` | PASS |
| TS tests, 12 phase files | `vitest run` (Node 22) | 12 files, 651 tests passed | PASS |
| Census and parity tests | `vitest run` return-stats sites, sites-joint, figure-parity-pages, degenerate, composite-read-path | 372/373; the one failure is the known `single-source` load-timeout flake, which passes alone (34/34) | PASS |
| Typecheck | `npx tsc --noEmit -p .` | no output | PASS |
| Neuter-and-RED, 4 source files | back up, neuter, `vitest run`, restore by `cp` | 17 tests RED; `git status` clean after restore | PASS |

### Probe Execution

No probe-based verification declared. SKIPPED.

### Requirements Coverage

No requirement IDs declared for this phase in PLAN frontmatter beyond the four ROADMAP success criteria; all four covered above.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (phase source files) | - | TBD / FIXME / XXX debt markers | none found | - |
| `src/lib/factsheet/trade-fetch-provenance.ts` | 100-107 | `parseUnrecoveredGaps` exported with no production caller; it drops the malformed verdict | Warning (LOW, necessity; same as REVIEW WR-01) | A future surface could pick the shorter name and reintroduce the silent `[]`. Not a goal failure |

### Advisory (carried from 210-REVIEW.md, not blocking)

- No arm names the `sk.window_end IS NULL` disjunct (IN-01); behaviour is caught by TV-strategy-keys and TV-closed-window, and no fixture has an open window with a future non-NULL end.
- The tear sheet pass-through test in `page.trade-fetch.test.tsx` mocks a payload that already carries the flag, so it cannot go RED on revert (IN-02). Real tear-sheet coverage is the `printView` case in `FactsheetView.unrecovered-gap.test.tsx`, which I confirmed goes RED.
- `SyncBadge.venue.test.tsx` and `queries.trade-venues.test.ts` pin contracts that pre-date the phase and cannot go RED on a migration revert (IN-03); SC-4 for the venue fix rests on the SQL arms, which do bite.
- The regenerated function snapshot copies a now-inert `prod-body-ack` hash (IN-04). The gap Sentry report fires on every uncached build, not once per cache miss (IN-05).

### Human Verification Required (resolved 2026-11-14)

Resolved: the phase agent ran migration-reviewer and rls-policy-auditor on the migration on 2026-11-14. Both returned CLEAN with zero findings at any severity. The original request is kept below as lineage.

#### 1. migration-reviewer and rls-policy-auditor on the new migration

**Test:** Run migration-reviewer and rls-policy-auditor on `supabase/migrations/20261114120000_get_published_trade_venues_open_windows.sql`.
**Expected:** Both clean, before merge.
**Why human:** SC-1 names this review. It was deferred by the plan to the phase review step, 210-REVIEW.md does not cover it, and nothing in the phase directory records a run. Because PROD auto-applies once `apply-test` succeeds, with no human reviewer gate, this review has to happen before the merge. My own read found SECDEF, pinned `search_path`, a column-allow-listed result table, explicit grants, no table read in the self-verify and no RLS or grant change on `api_keys` or `strategy_keys`; that is evidence, not the named review.

### Gaps Summary

No gaps. All four success criteria are verified in the code, and criterion 4 was measured by neutering the source and watching the tests go RED. The status was `human_needed` solely because the migration-reviewer and rls-policy-auditor review that SC-1 names had no recorded run; both ran clean on 2026-11-14, so the status is `passed`. PROD effect at deploy is nil by the CONTEXT's own measurement (0 closed windows on published strategies); the value is the first key rotation.

---

_Verified: 2026-11-14_
_Verifier: Claude (gsd-verifier)_

---
phase: 235-holdingstruth-one-account-counts-once-on-holdings-match-scor
plan: 01
subsystem: holdings
tags: [holdings, identity, fail-loud, HOLD-01]
requires: []
provides:
  - HoldingsIdentityError
  - strict keyAccountOf closure
  - strictAccountOf
affects: [src/lib/portfolio-exposure.ts, src/lib/queries.ts, src/app/api/allocator/scenario/commit/route.ts]
tech-stack:
  added: []
  patterns: [named error class, map-membership strictness]
key-files:
  created:
    - src/app/api/allocator/scenario/commit/route.holdings-identity.test.ts
  modified:
    - src/lib/latest-holdings-per-key.ts
    - src/lib/latest-holdings-per-key.test.ts
    - src/lib/portfolio-exposure.test.ts
    - src/lib/holdings-account-day.ts
    - src/lib/queries.ts
    - src/lib/queries.holdings-per-key.test.ts
    - src/lib/queries.test.ts
    - src/app/api/allocator/scenario/commit/route.ts
decisions:
  - "keyAccountOf is strict by map MEMBERSHIP; an in-keys key the identity cannot place keeps key:<id>"
  - "one strictAccountOf helper serves both dollar callers; derivePhase07Fields keeps its {} default and signature"
metrics:
  duration: n/a
  completed: 2026-11-26
status: complete
actuals:
  tokens: 14000
  tasks: 3
  commits: 3
plan_head_before: a1e669177f0a5c96bbe515c57bc2db78851650ac
plan_head_after: 5f8c52e61351432eb7c34faf0a0e44114bd3e9d4
---

# Phase 235 Plan 01: HOLD-01 identity completeness Summary

A holdings row whose key is absent from the owner's api_keys identity read now fails loud (`HoldingsIdentityError`) in all three readers: `fetchHoldings` (both series reads reject), the per-key dollar path `derivePhase07Fields`, and the scenario commit's audit recompute (`lookup_failed`, commit still 200).

## Commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | debf69c9b | `HoldingsIdentityError`, strict `keyAccountOf`, docblocks; arms A1 to A3 |
| 2 | c99c0a43d | `strictAccountOf`, `derivePhase07Fields` uses it, seven fixtures given explicit identity; arm A4 |
| 3 | 5f8c52e61 | commit route uses `strictAccountOf(read.accountByKey)`; new `route.holdings-identity.test.ts`; arms A5, A6 |

## Verification results

- Task 1: `npx vitest run src/lib/latest-holdings-per-key.test.ts src/lib/portfolio-exposure.test.ts src/lib/holdings-account-day.test.ts`: 3 files, 168 tests passed.
- Task 2: the 17-file command: `Test Files  17 passed (17)`, `Tests  1208 passed (1208)` (includes the recompute-verdict, computed-at-reader and holding-scope-key censuses).
- Task 3: `npx vitest run src/app/api/allocator/scenario/commit/ src/__tests__/scenario-commit-rls.test.ts`: `Test Files  5 passed (5)`, `Tests  112 passed | 13 skipped (125)`. The 13 skips are pre-existing (12 are in `scenario-commit-rls.test.ts`, which is database-gated; this plan added no skip).
- `npm run typecheck` (tsc --noEmit): clean. `npx eslint` over the nine files: exit 0.
- `git diff --quiet -- src/lib/portfolio-exposure.ts`: clean (no production change there).

## PROOF-01 transcripts (verbatim; backups in the scratchpad `p235/plan-01/`, shown as `<scratchpad>`)

### Pre-fix RED lines

A1 and A2 (Task 1, before any production edit; `<scratchpad>/t1-prefix-red.txt`):

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > the account identity carries venue_server (225 CONN-03, CONTEXT Q6) > keyAccountOf throws HoldingsIdentityError for a key absent from keys and keeps key:<id> for a key in keys it cannot place (HOLD-01)
AssertionError: expected null to match object { name: 'HoldingsIdentityError' }
+ Received:
 FAIL  |jsdom| src/lib/portfolio-exposure.test.ts > D-11: one exchange account counts once per (day, holding_type) in both series > a holdings row whose key is absent from the api_keys identity read rejects with HoldingsIdentityError (HOLD-01)
AssertionError: promise resolved "{ points: [ { …(3) } ], gaps: [] }" instead of rejecting
+ Received
 Test Files  2 failed (2)
      Tests  2 failed | 121 passed (123)
```

A4 (Task 2, before `strictAccountOf` existed):

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/lib/queries.holdings-per-key.test.ts > derivePhase07Fields: one row per key (D-08) > a counted row whose key the account map lacks throws HoldingsIdentityError (HOLD-01; the retired default)
AssertionError: expected null to match object { name: 'HoldingsIdentityError' }
 Test Files  1 failed (1)
      Tests  1 failed | 10 passed (11)
```

A5 (Task 3, before the route edit; A6 is the guard and was green pre-fix):

```
     × a counted row whose key accountByKey lacks is lookup_failed, sizes nothing, and the commit still lands (200) 17ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/api/allocator/scenario/commit/route.holdings-identity.test.ts > 235 HOLD-01: the commit's audit recompute counts a row only through a complete identity > a counted row whose key accountByKey lacks is lookup_failed, sizes nothing, and the commit still lands (200)
AssertionError: expected 'server_aum' to be 'lookup_failed' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```

### N1 and N2 (Task 1; arms A1, A2, A3)

```
$ cp src/lib/latest-holdings-per-key.ts <scratchpad>/235-01-lhpk.bak
--- N1: membership check removed
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > the account identity carries venue_server (225 CONN-03, CONTEXT Q6) > keyAccountOf throws HoldingsIdentityError for a key absent from keys and keeps key:<id> for a key in keys it cannot place (HOLD-01)
AssertionError: expected null to match object { name: 'HoldingsIdentityError' }
 FAIL  |jsdom| src/lib/portfolio-exposure.test.ts > D-11: one exchange account counts once per (day, holding_type) in both series > a holdings row whose key is absent from the api_keys identity read rejects with HoldingsIdentityError (HOLD-01)
AssertionError: promise resolved "{ points: [ { …(3) } ], gaps: [] }" instead of rejecting
 Test Files  2 failed (2)
      Tests  2 failed | 121 passed (123)
$ cp <scratchpad>/235-01-lhpk.bak src/lib/latest-holdings-per-key.ts
$ cmp <scratchpad>/235-01-lhpk.bak src/lib/latest-holdings-per-key.ts
cmp exit=0 (silent)
--- N2: throws when map VALUE is null/missing
⎯⎯⎯⎯⎯⎯ Failed Tests 64 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey (D-16, bounded read) > returns each key's rows at its own latest asof, from an ascending table
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey (D-16, bounded read) > a key with no holdings contributes nothing and is not an error
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey (D-16, bounded read) > another user's keys and rows are never read
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey (D-16, bounded read) > an error in a rows read is returned as error, with no partial data
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey (D-16, bounded read) > a per-key rows read that reaches the row cap returns a named error, never a partial list
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey (D-16, bounded read) > one row under the cap is still returned whole
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a later clean poll supersedes older rows (SFH-C4-02) > a clean, empty poll after the key's latest rows leaves the key with no current rows
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a later clean poll supersedes older rows (SFH-C4-02) > the newest clean poll decides: an empty poll before a later poll with rows does not hide them
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a later clean poll supersedes older rows (SFH-C4-02) > a poll with warnings (a read failed, so empty proves nothing) keeps the key's latest rows
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a later clean poll supersedes older rows (SFH-C4-02) > an event written before the poll recorded its day (no asof) keeps the key's latest rows
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a later clean poll supersedes older rows (SFH-C4-02) > a malformed row_count keeps the key's latest rows
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a later clean poll supersedes older rows (SFH-C4-02) > no metadata at all keeps the key's latest rows
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a later clean poll supersedes older rows (SFH-C4-02) > WR-02 not-worse: a clean poll that wrote rows the key no longer owns does not bring back its older rows
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a later clean poll supersedes older rows (SFH-C4-02) > another user's poll events are never read
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a same-day clean empty newest poll hides the key (D-02) > Case A: a clean poll with rows, then a LATER clean empty poll on the same day, hides the key
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a same-day clean empty newest poll hides the key (D-02) > Case A2: the same-day clean empty poll as the key's only event hides it too
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a same-day clean empty newest poll hides the key (D-02) > Case B: a non-empty clean poll on the rows' day keeps the rows (the strict rule is unchanged)
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a same-day clean empty newest poll hides the key (D-02) > Case C: a clean empty poll followed by a LATER warnings poll keeps the rows (second condition)
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a same-day clean empty newest poll hides the key (D-02) > Case D: a warnings poll that read zero rows keeps the rows
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a same-day clean empty newest poll hides the key (D-02) > Case E: a clean poll with no recorded day is no evidence and keeps the rows
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a same-day clean empty newest poll hides the key (D-02) > Case E: a clean poll with a string row_count is no evidence and keeps the rows
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a same-day clean empty newest poll hides the key (D-02) > Case E: a clean poll with a fractional row_count is no evidence and keeps the rows
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a same-day clean empty newest poll hides the key (D-02) > Case F: a clean empty poll dated BEFORE the rows keeps them
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a same-day clean empty newest poll hides the key (D-02) > Case H: another user's clean empty poll for the same key id is never read
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a same-day clean empty newest poll hides the key (D-02) > only the emptied key is hidden: another key's rows are untouched
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: one exchange account, one reading (SFH-C4-01) > keys with no known account identity are each their own account
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: accountByKey (170.4 plan 11, D-10) > two tied keys of one account are BOTH returned and share one account token
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > the account identity carries venue_server (225 CONN-03, CONTEXT Q6) > keyAccountOf puts two servers of one login in two accounts and a no-server key beside them in its own key:<id>
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > the account identity carries venue_server (225 CONN-03, CONTEXT Q6) > keyAccountOf throws HoldingsIdentityError for a key absent from keys and keeps key:<id> for a key in keys it cannot place (HOLD-01)
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: the poll that wrote the rows could not read positions (WR-R2-03) > a partial poll names the key
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: the poll that wrote the rows could not read positions (WR-R2-03) > a partial poll, then a failed poll: the rows stay and so does the flag
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: the poll that wrote the rows could not read positions (WR-R2-03) > a later clean poll on the same day read the positions: no flag
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: the poll that wrote the rows could not read positions (WR-R2-03) > a later clean poll on a later day: no flag
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: the poll that wrote the rows could not read positions (WR-R2-03) > a partial poll on a day other than the rows' day did not write them: no flag
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: the poll that wrote the rows could not read positions (WR-R2-03) > a partial event with no recorded day is no evidence: no flag
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: the poll that wrote the rows could not read positions (WR-R2-03) > another user's partial event is never read
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: the poll that wrote the rows could not read positions (WR-R2-03) > an error returns no flags
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a native key the newest poll left unpriced (CR-01) > contributes nothing once the poll's record is dated after its rows
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a native key the newest poll left unpriced (CR-01) > keeps the rows when the record is of the rows' own day
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a native key the newest poll left unpriced (CR-01) > ignores another key's record
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a native key the newest poll left unpriced (CR-01) > a forged audit event is no evidence: the same event shapes the poll once wrote change nothing
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: a native key the newest poll left unpriced (CR-01) > a failed record read keeps the key's rows (no worse than before) and is logged, not swallowed
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: { auditEvidence: false } (170.4 plan 12) > issues no audit_log read at all
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: { auditEvidence: false } (170.4 plan 12) > KNOWN LIMIT: a newer clean empty poll supersedes the key's rows on the dashboard (default) and cannot in the commit's mode
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: { auditEvidence: false } (170.4 plan 12) > KNOWN LIMIT, same day (D-02): a clean empty poll on the rows' own day hides the key on the dashboard and cannot in the commit's mode
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: { auditEvidence: false } (170.4 plan 12) > names no partial read even when a partial poll event wrote the rows' day
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: { auditEvidence: false } (170.4 plan 12) > still drops a native-unpriced key (service-written evidence) and keeps accountByKey
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: { auditEvidence: false } (170.4 plan 12) > a failed marker read is surfaced as markerReadError and the rows are kept
 FAIL  |jsdom| src/lib/latest-holdings-per-key.test.ts > fetchLatestHoldingsPerKey: { auditEvidence: false } (170.4 plan 12) > markerReadError is null when every marker read succeeded
 FAIL  |jsdom| src/lib/portfolio-exposure.test.ts > the series reads' shared fetch (owner gate and projection, T-98-07 / T-98-08) > owner gate: issues .eq('allocator_id', userId) and a 730-day .gte('asof') cap
 FAIL  |jsdom| src/lib/portfolio-exposure.test.ts > the series reads' shared fetch (owner gate and projection, T-98-07 / T-98-08) > secretless projection (T-98-08): the holdings select is EXACTLY the eight allow-listed columns
 FAIL  |jsdom| src/lib/portfolio-exposure.test.ts > the series reads' shared fetch (owner gate and projection, T-98-07 / T-98-08) > the key-identity read (T-170.4-40): the per-key reader's identity columns, owner-scoped, on the user client
 FAIL  |jsdom| src/lib/portfolio-exposure.test.ts > D-11: one exchange account counts once per (day, holding_type) in both series > an unparseable updated_at on a counted row rejects with HoldingsUpdatedAtError
AssertionError: expected HoldingsIdentityError: holdings row names… to match object { name: 'HoldingsUpdatedAtError' }
 FAIL  |jsdom| src/lib/portfolio-exposure.test.ts > getNetExposureSeries > no zero-fill: emits a point per existing asof and MARKS the interior gap
 FAIL  |jsdom| src/lib/portfolio-exposure.test.ts > ROUTE-08: cash is not exposure in the net series, and stays in the allocation weights > a day with BTC spot 10000 and USDT 5000 is net 10000 / gross 10000, cash excluded
 FAIL  |jsdom| src/lib/portfolio-exposure.test.ts > ROUTE-08: cash is not exposure in the net series, and stays in the allocation weights > a day read with only USDT 5000 stays a zero point and is not a gap
 FAIL  |jsdom| src/lib/portfolio-exposure.test.ts > ROUTE-08: cash is not exposure in the net series, and stays in the allocation weights > a USDT derivative-typed row is not cash (the rule is spot-only) and still counts
 FAIL  |jsdom| src/lib/portfolio-exposure.test.ts > ROUTE-08: cash is not exposure in the net series, and stays in the allocation weights > getAllocationSeries still counts the USDT value in its venue weight (where capital sits)
 FAIL  |jsdom| src/lib/portfolio-exposure.test.ts > getAllocationSeries > per-venue weights (D-P3): venue A gross 300 / venue B gross 100 → 0.75 / 0.25 summing to 1
 FAIL  |jsdom| src/lib/portfolio-exposure.test.ts > getAllocationSeries > zero-gross asof emits NO AllocationPoint (no NaN weights)
 FAIL  |jsdom| src/lib/portfolio-exposure.test.ts > F-1 (v1.10): PostgREST 1000-row truncation must not drop newest holdings > getNetExposureSeries paginates a >1000-row window and returns the COMPLETE series incl. the newest asof
 FAIL  |jsdom| src/lib/portfolio-exposure.test.ts > F-1 (v1.10): PostgREST 1000-row truncation must not drop newest holdings > getAllocationSeries also paginates a >1000-row window (no dropped newest asof)
 FAIL  |jsdom| src/lib/portfolio-exposure.test.ts > F-2 (v1.10): a boundary zero-gross asof is MARKED as a gap, never silently dropped > leading AND trailing zero-gross asofs both become marked gaps
 FAIL  |jsdom| src/lib/portfolio-exposure.test.ts > F-2 (v1.10): a boundary zero-gross asof is MARKED as a gap, never silently dropped > an interior zero-gross asof is still marked (regression guard for the pre-existing interior case)
 Test Files  2 failed (2)
      Tests  64 failed | 59 passed (123)
$ cp <scratchpad>/235-01-lhpk.bak src/lib/latest-holdings-per-key.ts
$ cmp <scratchpad>/235-01-lhpk.bak src/lib/latest-holdings-per-key.ts
cmp exit=0 (silent)
--- GREEN re-run
 Test Files  3 passed (3)
      Tests  168 passed (168)
```

N2 note: the neuter (throw whenever the map VALUE is null) also breaks every `fetchLatestHoldingsPerKey` test whose keys the identity does not group (their value is null), which is why 64 tests fail. Arm A3 is among them, `keyAccountOf throws HoldingsIdentityError for a key absent from keys and keeps key:<id> ...`, and the collateral failures are the same discriminator seen from the callers.

### N3 (Task 2; arm A4)

```
$ cp src/lib/latest-holdings-per-key.ts <scratchpad>/235-01-lhpk-t2.bak
--- N3: strictAccountOf returns the key id when accountByKey lacks it
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/lib/queries.holdings-per-key.test.ts > derivePhase07Fields: one row per key (D-08) > a counted row whose key the account map lacks throws HoldingsIdentityError (HOLD-01; the retired default)
AssertionError: expected null to match object { name: 'HoldingsIdentityError' }
 Test Files  1 failed (1)
      Tests  1 failed | 10 passed (11)
$ cp <scratchpad>/235-01-lhpk-t2.bak src/lib/latest-holdings-per-key.ts
$ cmp <scratchpad>/235-01-lhpk-t2.bak src/lib/latest-holdings-per-key.ts
cmp exit=0 (silent)
--- GREEN re-run
 Test Files  2 passed (2)
      Tests  171 passed (171)
```

### N4 and N5 (Task 3; arms A5, A6)

```
$ cp src/app/api/allocator/scenario/commit/route.ts <scratchpad>/235-01-route.bak
--- N4: route accountOf returns the key id when read.accountByKey lacks it
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/api/allocator/scenario/commit/route.holdings-identity.test.ts > 235 HOLD-01: the commit's audit recompute counts a row only through a complete identity > a counted row whose key accountByKey lacks is lookup_failed, sizes nothing, and the commit still lands (200)
AssertionError: expected 'server_aum' to be 'lookup_failed' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
$ cp <scratchpad>/235-01-route.bak src/app/api/allocator/scenario/commit/route.ts
$ cmp <scratchpad>/235-01-route.bak src/app/api/allocator/scenario/commit/route.ts
cmp exit=0 (silent)
$ cp src/lib/latest-holdings-per-key.ts <scratchpad>/235-01-lhpk-t3.bak
--- N5: strictAccountOf throws for every key
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/api/allocator/scenario/commit/route.holdings-identity.test.ts > 235 HOLD-01: the commit's audit recompute counts a row only through a complete identity > guard: the same row with its key in accountByKey is server_aum, 10% of 40000 = 4000
AssertionError: expected 'lookup_failed' to be 'server_aum' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
$ cp <scratchpad>/235-01-lhpk-t3.bak src/lib/latest-holdings-per-key.ts
$ cmp <scratchpad>/235-01-lhpk-t3.bak src/lib/latest-holdings-per-key.ts
cmp exit=0 (silent)
--- GREEN re-run
 Test Files  5 passed (5)
      Tests  112 passed | 13 skipped (125)
```

## Deviations from Plan

### Auto-fixed Issues

None needing a Rule 1 to 3 fix.

### Minor shape deviations (recorded, no behaviour change)

1. **queries.test.ts helper placement.** The plan asks for `ownAccounts(...keyIds)` passed as the fifth argument in each of the four named arms. All four arms read through the single local `summarize` helper, so the explicit identity is passed there once (`ownAccounts(...new Set(rows.map((r) => r.api_key_id)))`), with `[]` for `partialReads`. Expectations are byte-for-byte unchanged. The explicit identity exists for each of the four arms.
2. **N2 is noisy.** See the N2 note above; the plan's expected RED line (`of("k-c")` throws) is present among the failures.
3. **A2/A3 asserted by name.** Per RESEARCH Pitfall 2, the absent-id assertion catches the throw and matches `name`, never importing the class in tests.

## Flagged assumption (carried from the plan, unchanged)

Only map MEMBERSHIP is an edge: a key in `keys` with a null identity token keeps `key:<id>` (pinned by A3); an absent key throws; with an empty `keys` list any holdings row in the window makes `fetchHoldings` throw. By the schema fact (`allocator_holdings.api_key_id` NOT NULL, FK `ON DELETE RESTRICT`, owner-coherence trigger) this cannot arise for a real owner. The verifier should confirm this assumption.

## Known Stubs

None.

## Threat Flags

None (no new endpoints, auth paths or schema surface; the error message names only the owner's own key id).

## Self-Check: PASSED

All created files exist; commits debf69c9b, c99c0a43d and 5f8c52e61 are ancestors of HEAD. `commits: 3` is measured from the plan ledger before this SUMMARY's own commit.

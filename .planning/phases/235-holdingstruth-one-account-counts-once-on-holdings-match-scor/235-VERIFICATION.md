---
phase: 235-holdingstruth-one-account-counts-once-on-holdings-match-scor
verified: 2026-11-26T17:55:00Z
status: human_needed
score: 6/7 must-haves verified
verified_at_sha: 829e18b7d9daddb818a0eb15046e1dd4f333e564
drift_subjects:
  - src/lib/latest-holdings-per-key.ts
  - src/lib/holdings-account-day.ts
  - src/lib/portfolio-exposure.ts
  - src/lib/queries.ts
  - src/lib/degrade-warnings.ts
  - src/app/api/allocator/scenario/commit/route.ts
  - analytics-service/routers/match.py
  - src/app/(dashboard)/allocations/lib/key-data-gaps.ts
  - src/app/(dashboard)/allocations/components/MissingDataMessage.tsx
  - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
  - src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Open My Allocation at a 390px viewport on a book whose native-unpriced marker read fails (or force the flag), on the Overview and on the Holdings tab."
    expected: "The note 'We could not check whether each account's newest day could be priced in USD ...' is visible on both surfaces, wraps inside its column, and #main-content does not scroll horizontally."
    why_human: "UI-SPEC marks this truth `backstop` (non-inferable). jsdom has no layout engine, so the shipped tests only prove the class lists carry no hidden/md:block toggle. Plan 04 itself says the verifier confirms it in a browser at 390px or records human_needed."
---

# Phase 235: HOLDINGSTRUTH Verification Report

**Phase Goal:** Once 225 has settled what the account identity holds, every reader counts one account once.
**Verified:** 2026-11-26T17:55:00Z
**Status:** human_needed
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC-1 / HOLD-01: a Holdings row whose key is missing from the identity read fails loud, with a test per reader | VERIFIED | `keyAccountOf` (`src/lib/latest-holdings-per-key.ts:122-147`) throws `HoldingsIdentityError` on map MEMBERSHIP (`identity.has`), keeping `key:<id>` for a key that IS in `keys` but ungrouped. `fetchHoldings` (`portfolio-exposure.ts:320`) calls it per row and does not catch. `strictAccountOf` (`:154-170`) replaces `?? keyId` in `derivePhase07Fields` (`queries.ts:5203-5206`) and the commit route (`route.ts:885`, still inside the try that yields `holdingsLookupErr`). Tests: `latest-holdings-per-key.test.ts`, `portfolio-exposure.test.ts`, `queries.holdings-per-key.test.ts`, `route.holdings-identity.test.ts` all green. I neutered `identity.has` (`if (false)`): 2 HOLD-01 arms went RED (the keyAccountOf arm and the fetchHoldings arm), restored byte-equal, `git status` clean. |
| 2 | SC-2 / HOLD-02: for a multi-key account, match AUM and unpriced days equal what Holdings reports | VERIFIED | `match.py` `_load_holding_portfolio_context`: marker day is the key's READING day when strictly after its newest asof (or no rows) via `_reading_day`; account newest day = max over keys (`newest_day` loop over `key_rows`); marker read covers every owner key (`sorted(str(k["id"]) for k in key_rows)`); failed read logged at ERROR, rows kept. This is the TS reader's rule (`fetchLatestHoldingsPerKey`, `unpricedAsof > latestAsof` -> `{day, hasRows:false}`). One JSON table (`native_unpriced_account_day_cases.json`) is replayed by `test_match_native_unpriced_account_day.py` (7 passed) and `native-unpriced-account-day.parity.test.ts` (green, both dashboard and commit modes). Neutered `_reading_day`'s marker branch: pytest RED on the marker arms plus the failed-read log arm, restored byte-equal. mypy strict: no issues in 146 files. |
| 3 | SC-3a / HOLD-04: when the dashboard's marker read fails, a Sentry event fires | VERIFIED | `getMyAllocationDashboard` (`queries.ts:5762-5790`): `holdingsUnpricedCheckFailed = markerReadError !== null`; `console.error` every load; `captureToSentry` (level warning, tags op/reason/area, extra userId + supabase message, no key id) behind the 6 h `shouldCaptureDerivedRowRejection` window so the 30 s poll does not flood. Flag set in both return literals (`:6256`, `:6828`). `queries.my-allocation.test.ts` green. |
| 4 | SC-3b / HOLD-04: stale rows are never shown silently (rows kept, note shown) | VERIFIED | New registry entry `allocation.holdings-unpriced-check-failed` (read_failure, scope none, A-RELOAD). Rendered through `DegradeLine` on the Overview (`AllocationDashboardV2.tsx`, below `MissingDataMessage`, not gated on rebuilding) and the Holdings tab (`HoldingsTabPanel.tsx`), each only when the flag is true AND `holdingsSummary` is non-empty (no rows, nothing to mislead). Rows are not hidden when the flag is true (arm H4/regression guard). Tests `AllocationDashboardV2.unpriced-check.test.tsx`, `HoldingsTabPanel.unpriced-check.test.tsx`, `degrade-warnings.test.tsx`, `degrade-warning-scan.test.ts` green. |
| 5 | SC-4 / HOLD-05: every failing key of a shared account is named, including a second key whose cause another key already printed | VERIFIED | Producer: `sharedAccountFailingGroups` (`key-data-gaps.ts:292-305`) uses the same `accountGroups`/`failing` logic as the `shared_account_failing` gap arm, so every all-failing group is emitted with or without a tail range; owner-only ids (T-186-18). `deriveSharedAccountFailingGroupsField` shares one private input builder with `deriveKeyDataGapsField`; field set in BOTH payload literals. Message: `missingDataLines` applies the R3-01 rule (`MissingDataMessage.tsx:348-388`): a group is named by a printed dated gap with exactly its ids, else by a new undated labelled line (`allocation.key-gap.shared-account-failing-undated`, no date, no "no complete history" claim); the book fallback stays for any group with a key the list cannot label. Overview passes `sharedFailingGroups`. Tests green (`key-data-gaps.test.ts`, `MissingDataMessage.test.tsx`, `...shared-account-named.test.tsx`, `queries.my-allocation.test.ts`). Neutered the undated push: 5 arms RED (M1, M2, M3, M6, M8), restored byte-equal. ⛔ CORRECTED 2026-11-26 (review round 1 WR-01, verified fixed in round 2): when any shared-account group is named only by the undated line, the book-level fallback line also prints (`everyGroupNamed && !anyUndated` in `missingDataLines`). The fallback is dropped only when every group is named by a printed dated gap. Every failing key is still named by label (SC-4). The row text before this note is kept as lineage. |
| 6 | SC-5 / PROOF-01: each gate goes RED with its named arm first, restored from a byte backup, GREEN, recorded verbatim in the plan SUMMARY | VERIFIED | All six SUMMARYs carry a `PROOF-01 transcripts` section with pre-fix RED lines, per-neuter RED, `cmp` against backup (silent) and a GREEN re-run (01: lines 62-236; 02: 64-212; 03: 66-202+; 04: 82-187; 05: 58-126+; 06: 67-123+). Three independent spot neuters by this verifier reproduced RED on the named arms. |
| 7 | UI-SPEC long-text (`backstop`): at 390px both unpriced-check notes are visible and wrap with no horizontal scroll | HUMAN | Class lists carry no hidden/breakpoint toggle (Mount B has `[overflow-wrap:anywhere]`; Mount A is a plain sentence with no unbreakable token) and a jsdom arm pins that, but layout cannot be exercised without a browser. See Human Verification. |

**Score:** 6/7 truths verified (0 present-but-behavior-unverified; 1 routed to human, a `backstop` truth).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/latest-holdings-per-key.ts` | `HoldingsIdentityError`, strict `keyAccountOf`, `strictAccountOf` | VERIFIED | Present, exported, used by 3 readers + commit route |
| `analytics-service/routers/match.py` | per-account marker reading day | VERIFIED | Substantive, matches TS rule, covered by shared table |
| `analytics-service/tests/fixtures/native_unpriced_account_day_cases.json` | shared case table | VERIFIED | Replayed by pytest and vitest |
| `src/lib/queries.ts` | flag, Sentry capture, groups field, strict dollar caller | VERIFIED | Wired in both return literals |
| `src/lib/degrade-warnings.ts` | two new registry entries | VERIFIED | Rendered through `DegradeLine`; registry test + scan ledger green |
| `key-data-gaps.ts` / `MissingDataMessage.tsx` / `AllocationDashboardV2.tsx` / `HoldingsTabPanel.tsx` | producer, message, mounts | VERIFIED | Wired end to end (payload -> prop -> `missingDataLines` -> render) |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `fetchHoldings` | `keyAccountOf` strict throw | `oneKeyPerAccountDay(..., accountOf)` | WIRED |
| `derivePhase07Fields`, commit route | `strictAccountOf(accountByKey)` | replaces `?? keyId` | WIRED |
| `getMyAllocationDashboard` | `markerReadError` -> flag + Sentry | both return literals | WIRED |
| payload `holdingsUnpricedCheckFailed` | Overview + Holdings tab note | `props.holdingsUnpricedCheckFailed` | WIRED |
| payload `sharedAccountFailingGroups` | `missingDataLines` | `sharedFailingGroups` argument | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| Holdings/Overview note | `holdingsUnpricedCheckFailed` | `fetchLatestHoldingsPerKey` `markerReadError` (per-key `allocator_equity_derived` read) | Yes | FLOWING |
| Missing-data undated line | `sharedAccountFailingGroups` | `api_keys` identity + `failing` facts, same builder as `keyDataGaps` | Yes | FLOWING |
| Match AUM | `unpriced_days` | `read_native_unpriced_days` over all owner keys | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| HOLD-01 / HOLD-02 TS readers | `npx vitest run` on 5 files (latest-holdings-per-key, portfolio-exposure, parity, route.holdings-identity, queries.holdings-per-key) | 151 passed | PASS |
| HOLD-04 / HOLD-05 and registry | `npx vitest run` on 9 files (queries.my-allocation, queries, degrade-warnings, degrade-warning-scan, key-data-gaps, MissingDataMessage, 2 unpriced-check, shared-account-named) | 650 passed | PASS |
| Matcher table | `pytest tests/test_match_native_unpriced_account_day.py -q` | 7 passed | PASS |
| Types | `npm run typecheck`; mypy strict (analytics) | clean; "Success: no issues found in 146 source files" | PASS |
| Neuter 1 (match `_reading_day` marker branch) | pytest same file | RED, restored (`cmp` silent) | PASS |
| Neuter 2 (`identity.has` -> false) | vitest two files | 2 RED, restored | PASS |
| Neuter 3 (skip undated line push) | vitest MissingDataMessage | 5 RED, restored | PASS |

### Probe Execution

Not applicable: no probe is declared by any plan.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| HOLD-01 | 235-01 | A Holdings row whose key is missing from the identity read fails loud | SATISFIED | Truth 1 |
| HOLD-02 | 235-02 | Match scoring applies the native-unpriced marker per account | SATISFIED | Truth 2 |
| HOLD-04 | 235-03, 235-04 | Marker-read failure: note + Sentry event | SATISFIED in code; 390px layout is human item | Truths 3, 4, 7 |
| HOLD-05 | 235-05, 235-06 | Every failing shared-account key named | SATISFIED | Truth 5 |

HOLD-03 is Phase 229 (Complete), correctly not claimed. No orphaned requirement: REQUIREMENTS.md maps HOLD-01/02/04/05 to Phase 235 and every ID appears in a PLAN `requirements:` field. The REQUIREMENTS.md checkboxes/traceability still read Pending; flipping them is a close-out step, not a code gap.

### Executor-flagged items, adjudicated

1. **Plan 01, empty `keys` with any holdings row now throws in `fetchHoldings`: unreachable by schema.** `allocator_holdings.api_key_id` is `NOT NULL`, has FK `allocator_holdings_api_key_id_fkey ... ON DELETE RESTRICT` (baseline.sql:13707, 17577), and `enforce_allocator_holdings_owner_coherence` raises unless the key exists and its `user_id` equals `allocator_id` (baseline.sql:4699-4722). So every owner row names an owner key, and the identity read (with its row-cap guard) carries it. The throw can only fire on a genuinely incomplete read, which is the intended fail-loud. Accepted.
2. **Plan 03 assumptions (b)-(d) (several failed keys, no keys, keys with zero rows): confirmed by code read, acceptable.** `fetchLatestHoldingsPerKey` reads the marker for every key (including keys with no rows) and returns `readings.find(markerError !== null)?.markerError ?? null`: several failures collapse to the first message, no keys gives null (no flag), zero-row keys still surface their marker error. The note additionally requires `holdingsSummary` non-empty. Not a gap.
3. **Plan 04 390px truth: `human_needed`** (not passed). The truth is a `backstop` per UI-SPEC and the plan's own text; jsdom cannot evidence layout.
4. **Plan 06 unprinted shared-account gap whose ids match no group loses the book fallback: skewed payload only.** The producer builds gaps and groups from the same `accountGroups` + `failing` logic and the same owner filter, so ids always match in a real payload. Recorded as an Info observation; no gap.
5. **`degrade-warnings.ts:959` cites TODOS id `170.4-DASHBOARD-MARKER-READ-SILENT`: ship-PR obligation, not a phase gap.** The four entries (`170.4-IDENTITY-READ-COMPLETENESS`, `170.4-MATCH-UNPRICED-PER-KEY`, `170.4-DASHBOARD-MARKER-READ-SILENT`, `198-SHARED-ACCOUNT-FALLBACK-UNNAMED`) still exist in `TODOS.md` (correct before ship). Per CLAUDE.md rule (b) the ship PR must delete all four, name them in the CHANGELOG, and reword that one comment so it no longer cites a deleted id. Nothing in `src/` or tests reads TODOS.md for these ids (grep: the only non-TODOS/CHANGELOG hit is that comment).

### Anti-Patterns Found

None blocking. No `TBD`/`FIXME`/`XXX` in the diff of non-planning files. Only added-line match for the TODO scan is the comment's literal word "TODOS". Out-of-scope observation: `src/components/exchanges/AllocatorExchangeManager.tsx:292` keeps `?? key:<id>`; it is a display helper over the key list, not a holdings reader, and is outside HOLD-01's named readers.

### Human Verification Required

#### 1. Unpriced-check note at 390px

**Test:** At a 390px viewport, load My Allocation with the marker read failing (or the flag forced) and look at the Overview and the Holdings tab.
**Expected:** The one-line note is visible on both, wraps inside its column, and `#main-content` has no horizontal scroll.
**Why human:** `backstop` truth; no layout engine in jsdom.

### Gaps Summary

No gaps. Every must-have is verified in code except the 390px rendering truth, which needs one browser look. CI on the head SHA (check count bound to `829e18b7`) was not part of this verification. Ship PR must also delete the four TODOS entries, name them in the CHANGELOG and fix the comment at `degrade-warnings.ts:959`.

---

_Verified: 2026-11-26T17:55:00Z_
_Verifier: Claude (gsd-verifier)_

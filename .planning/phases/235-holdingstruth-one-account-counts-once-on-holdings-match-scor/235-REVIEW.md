---
phase: 235-holdingstruth-one-account-counts-once-on-holdings-match-scor
reviewed: 2026-11-26T16:10:19Z
depth: standard
files_reviewed: 26
files_reviewed_list:
  - analytics-service/routers/match.py
  - analytics-service/tests/fixtures/native_unpriced_account_day_cases.json
  - analytics-service/tests/test_match_native_unpriced_account_day.py
  - src/__tests__/degrade-warning-scan.test.ts
  - src/app/(dashboard)/allocations/AllocationDashboardV2.shared-account-named.test.tsx
  - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
  - src/app/(dashboard)/allocations/AllocationDashboardV2.unpriced-check.test.tsx
  - src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
  - src/app/(dashboard)/allocations/HoldingsTabPanel.unpriced-check.test.tsx
  - src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx
  - src/app/(dashboard)/allocations/components/MissingDataMessage.tsx
  - src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts
  - src/app/(dashboard)/allocations/lib/key-data-gaps.ts
  - src/app/api/allocator/scenario/commit/route.holdings-identity.test.ts
  - src/app/api/allocator/scenario/commit/route.ts
  - src/lib/degrade-warnings.test.tsx
  - src/lib/degrade-warnings.ts
  - src/lib/holdings-account-day.ts
  - src/lib/latest-holdings-per-key.test.ts
  - src/lib/latest-holdings-per-key.ts
  - src/lib/native-unpriced-account-day.parity.test.ts
  - src/lib/portfolio-exposure.test.ts
  - src/lib/queries.holdings-per-key.test.ts
  - src/lib/queries.my-allocation.test.ts
  - src/lib/queries.test.ts
  - src/lib/queries.ts
findings:
  critical: 0
  warning: 0
  info: 2
  total: 2
  necessity: 0
status: clean
review_round: 2
---

# Phase 235: Code Review Report

**Reviewed:** 2026-11-26T17:30:00Z
**Depth:** standard (adversarial, traced into callees)
**Files Reviewed:** 26
**Status:** issues_found

## Summary

Scope: `git diff origin/main...HEAD -- . ':!.planning'` in the phase worktree, 26 files. This
report replaces the earlier inline review, which the orchestrator ran without a dispatched
reviewer. That review's IN-01 is carried below as Info, unchanged in severity.

What was traced, and held up:

- **HOLD-01.** `keyAccountOf` now throws on a missing map entry and checks membership, not
  null, so a key that is present but ungrouped still maps to `key:<id>`. `accountIdentityTokens`
  returns an entry for every input key, so the reader's own calls (`latest-holdings-per-key.ts:554`)
  cannot throw. `strictAccountOf` cannot throw on the dashboard or commit path, because
  `accountByKey` is built from exactly the `toRead` keys whose rows make up `data`. These are the
  only two callers of `fetchLatestHoldingsPerKey` (`queries.ts:5401`, `route.ts:855`), and no
  `accountByKey[k] ?? k` fallback is left anywhere. The commit route's throw still ends as
  `holdingsLookupErr`.
- **HOLD-02 (`match.py`).** `newest_day` is now built from `key_rows` × `_reading_day`. Every
  holdings row comes from a key that has a `latest_by_key` entry, so the lookup `newest_day[account]`
  at the row filter cannot KeyError. The marker rule (a marker strictly after the rows day, or a
  key with no rows) matches the TS reader at `latest-holdings-per-key.ts:499`. The old per-key
  drop (`asof < marker`) is a strict subset of the new behaviour. When the marker read fails, the
  rows still count, as in TS. Both parity tests drive the real code (`fetchLatestHoldingsPerKey`
  and `_load_holding_portfolio_context`) against one fixture, not a reimplementation.
- **HOLD-04.** The flag is `markerReadError !== null`. Every early return of the reader sets that
  field to null, and `assertOk` runs before it. The Sentry capture is throttled per (allocator,
  token). Both notes are gated on a non-empty `holdingsSummary` and render through the registry.
- **HOLD-05.** `sharedAccountFailingGroups` uses the same `accountGroups(..., {countedOnly:false})`
  grouping, the same all-failing predicate and the same owner filter and sort as the
  `shared_account_failing` arm of `keyDataGaps`. So the `printedSets`/`anySets` id-set matching in
  `missingDataLines` is internally consistent. The defect below is about how the TS side's groups
  relate to the derive's groups, not about the two TS producers agreeing with each other.

## Warnings

### WR-01: HOLD-05 removes the book-level fallback using TS-side groups that do not match the derive's groups, so a failing account the derive flagged can end up with no line at all (MEDIUM, user-facing)

**File:** `src/app/(dashboard)/allocations/components/MissingDataMessage.tsx:356-387`, with
`src/app/(dashboard)/allocations/lib/key-data-gaps.ts:292-305` and `src/lib/queries.ts:4669-4697`
**Issue:** The `shared_account_no_working_key` reason comes from the derive. In
`analytics-service/services/job_worker.py:17739-17747`, `no_working_groups` counts groups from
`allocator_equity_derive.account_groups`. Those are **marker** groups: a holder plus every key
whose `account_shared_with_api_key_id` points at it (`allocator_equity_derive.py:457-472`).
Members are limited to `eligible_ids`, and a key is "working" by `working_holder_predicate`
(`is_active`, `disconnected_at IS NULL`, and `sync_status`). The TS producer groups by
**login identity** instead: `accountLoginIdentity` is exchange, login and server, with no marker
links. It considers every owner key, disconnected ones included, and calls a key failing only by
`failingToSync` (`sync_status` alone, `queries.ts:4601`).
So the two sides can disagree about which accounts are "all failing". Before this phase, an
all-failing account with no tail range produced no line at all. That left the cause out of
`causesPrinted`, and the book line ("The keys that read one of your exchange accounts are all
failing to sync...") always printed. Now one TS group, named by the new undated line, is enough
for `everyGroupNamed` to stay true. `causesPrinted.add("shared_account_failing")` then drops the
book line. The derive's flagged account can be a marker-linked group with no shared login, or one
of its members can be inactive or disconnected while still having an ok `sync_status`. Either
way, on a rebuilding book that account gets no line, and the only explanation the page had for
why the whole history is hidden disappears. The dated arm (`keyDataGaps`) had the same mismatch
before this phase. This phase extends it to every all-failing login group, which is the common
case HOLD-05 targets. This needs two or more shared accounts with different shapes, so it is
narrow, but it silently drops the one owner-actionable sentence.
**Fix:** Build `sharedAccountFailingGroups` with the derive's rule rather than the gap
producer's. Group by the marker links the derive uses (a TS twin of `account_groups`). Limit
members to the keys the derive treats as eligible, and treat a key as failing when it is
`!isWorkingHolder` (`src/lib/account-share-note.ts`, the documented twin of
`working_holder_predicate`). Then pin both runtimes to one case table, as the
`derive_refusal_rows.json` precedent does. If that is too much for this phase, use the minimal
alternative. Keep the book fallback unless the number of TS groups equals the derive's
`no_working_groups`. That number would need to be carried in the equity-curve payload, which
the derive already logs at `job_worker.py:17966`.

### WR-02 (silent-failure-hunter SFH-01): a failed native-unpriced marker read in the matcher is swallowed, and the batch it feeds is persisted with overstated AUM (MEDIUM, data-integrity)

**File:** `analytics-service/routers/match.py` Step 1b (`_load_holding_portfolio_context`, the `try/except Exception` around `read_native_unpriced_days`, about lines 876-905).

**Issue:** If the marker read raises, the matcher logs at ERROR and treats every marker as absent. A native-unpriced MT5 account's older rows then count in `portfolio_aum`, the weights and the AUM share. The comment justifies this with "this is a request-time scorer, and nothing it computes is persisted". That is false: this context feeds `holding_flags` and the scores that `_score_one_allocator` persists into `match_batches` (the `holding_flags_list` insert). The batch carries no degraded marker. Meanwhile the dashboard (HOLD-04) says that account is left out, so the two surfaces disagree silently. The Python read is a single `in_` query, so one failure drops every key's marker. The comment predates the phase, but the phase rewrote the block. Every other read in this function (the `api_keys` read, both `allocator_holdings` reads, `HoldingsReadTruncated`) propagates its failure.

**Fix:** Let the marker read fail the way the function's other reads do: remove the swallow so the exception propagates, and make the comment true. A batch is then not written from a book whose markers could not be read.

## Info

### IN-01: The match AUM still ignores the clean-poll evidence Holdings uses, so a multi-key account whose newest clean poll read nothing can count differently in matching and on Holdings

**File:** `analytics-service/routers/match.py:880-885` (Step 1b docstring) and `:930-948`
(`_reading_day` / `newest_day`)
**Issue:** Carried from the earlier inline review, still Info. The dashboard calls
`fetchLatestHoldingsPerKey` with `auditEvidence: true`. A newer clean poll then supersedes a
key's rows (`cleanPollDay`), and so does a clean empty poll dated the rows' own day
(`cleanEmptyPollDay`). The matcher reads only rows and native-unpriced markers. RESEARCH places
this outside HOLD-02 ("parity is rows plus markers only"). But the new docstring says the marker
is applied "exactly as `fetchLatestHoldingsPerKey` ... applies it", which a reader could take as
full parity with Holdings. No TODOS entry carries the remaining gap.
**Fix:** Narrow the docstring to say the clean-poll supersession is not mirrored, and/or book
the residual.

### IN-02: The TS parity test counts rows with a non-strict lookup, unlike production code

**File:** `src/lib/native-unpriced-account-day.parity.test.ts:170`
**Issue:** The test calls `oneKeyPerAccountDay(rows, (k) => read.accountByKey[k])`. Both
production callers now pass `strictAccountOf(read.accountByKey)`. Line 168 asserts that every row
key is defined, so the test is not wrong today. It is simply not the code path that ships.
**Fix:** Use `strictAccountOf(read.accountByKey)` so the parity test exercises the production
lookup.

---

_Reviewed: 2026-11-26T17:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Round 1 fixes (2026-11-26)

Applied inline by the phase agent: no subagent-dispatch tool was available in this run, so no
`gsd-code-fixer` was dispatched and no round-2 re-review by a dispatched reviewer has run yet.

- **WR-01 fixed** (`MissingDataMessage.tsx`): the derive's `no_working_groups` is only logged,
  not carried in the payload, so the count-comparison path was not cheap. A group named only by
  the new undated line now keeps the book-level line (`anyUndated`). Every failing key is still
  named by label (SC-4). Tests M1, M6, M8, O1 updated; neutering `!anyUndated` turns 4 RED.
- **WR-02 fixed** (`routers/match.py`): rows kept as CONTEXT [HOLD-02] locks; the false comment
  corrected; `_load_holding_portfolio_context` returns `unpriced_check_failed`;
  `_score_one_allocator` appends `unpriced_check_failed_entry()` (D-22 shape). Parity test asserts
  the flag; a new e2e test asserts the persisted batch carries the entry. Neutering turns 2 RED.
- IN-01, IN-02: Info, not fixed (repo rule).

## Round 2

**Reviewed:** 2026-11-26T16:10:19Z
**Reviewer:** Claude (gsd-code-reviewer, dispatched)
**Head:** `2edb6f584` (fix commit `4e4e7ad5f`)
**Scope:** `git diff origin/main...HEAD -- . ':!.planning'`, with the focus on `git show 4e4e7ad5f`
(6 files: `routers/match.py`, `test_match_book_join_e2e.py`,
`test_match_native_unpriced_account_day.py`, `MissingDataMessage.tsx`, its test, and
`AllocationDashboardV2.shared-account-named.test.tsx`).
**Severity filter:** MEDIUM and above, as briefed. IN-01 and IN-02 stay Info and are not repeated.
**Result:** no MEDIUM+ finding. Both round-1 warnings are fixed correctly and completely, and no
regression was found.

### WR-01: verified fixed

- `missingDataLines` (`MissingDataMessage.tsx:362-395`) now suppresses the
  `shared_account_failing` cause only when `everyGroupNamed && !anyUndated`. `anyUndated` is set
  only on the path that pushes an undated line. So the book line is now dropped only when every TS
  group is matched by a printed dated gap. That is strictly more conservative than the
  pre-phase rule, which dropped it when every `shared_account_failing` gap printed. The
  remaining TS-vs-derive mismatch sits on the dated arm only, which round 1 recorded as
  pre-existing.
- Edge cases traced: `sharedFailingGroups` absent, `null` or `[]` skips the block, so the
  gap-count rule decides (M7). An unlabelable group or one whose ids are in `anySets` but not
  printed sets `everyGroupNamed = false`, so the book line stays (SFH-4 unchanged). If any group
  is undated, the book line stays, so every failing key is still named by label and SC-4 holds.
- `missingDataLines` has one production caller (`AllocationDashboardV2.tsx:170`). Nothing reads
  the line ids or the book line's presence, apart from `noteBelow={missingLines.length > 0}`, and
  the extra book line can only make that true where it was already true.
- CONTEXT HOLD-05 has a dated correction (`235-CONTEXT.md:49`) recording this behaviour, so the
  code and the locked decision agree.
- Accepted trade-off, not a finding: in the one-account case (M6) the undated labelled line and
  the book line both describe the same account. That is the cost of the
  "cannot prove coverage" rule, and CONTEXT records it.

### WR-02: verified fixed

- Both returns of `_load_holding_portfolio_context` carry `unpriced_check_failed`: the early
  return with no eligible rows (`match.py:1010`) and the full return (`:1187`). The flag is set
  only inside the `except` around `read_native_unpriced_days`. That reader raises on a failed
  read after `db_read_with_retry_sync` and never reports "no markers" for one
  (`services/allocator_positions.py:1933-1978`), so the flag is true exactly when the rows were
  kept without a marker check.
- `_load_allocator_context` forwards it as `_unpriced_check_failed` (`:1464`).
  `_score_one_allocator` appends `unpriced_check_failed_entry()` after `compute_holding_flags`,
  beside the D-22 and D-23 book entries (`:2011-2012`), before the `match_batches` insert. Both
  entry paths reach it: the HTTP and cron path (`match.py:1877`) and `run_rescore_allocator_job`,
  which passes `precomputed_ctx` (`job_worker.py:16852`, `:16897`).
- The comment is now true: it says the batch is persisted and names the entry.

### Every consumer of `match_batches.holding_flags` tolerates the new `kind: "book"` entry

Every reader was found by grepping for `holding_flags` and `match_batches` over `analytics-service`,
`src`, `scripts`, `supabase/migrations`, `supabase/tests`, `supabase/functions` and
`supabase/schema/baseline.sql`. The projection of each `match_batches` read was then checked by eye:

- **TS, `src/lib/queries.ts:5418` and `:5883-5895`.** This is the only reader that projects
  `holding_flags`. It filters `f.flagged && f.top_candidate_strategy_id` before it touches any
  other field, and `rawFlags` is used nowhere else (`:5893`, `:5908`, `:5963` are all
  downstream of the filter). The new entry has `flagged: false`, so it is dropped and its null
  `holding_ref` is never read. `src/lib/queries.audit-2026-05-07.test.ts:851` already pins this
  for the same `kind: "book"`, `holding_ref: null`, `flagged: false` family.
- **Every other `match_batches` read projects specific columns, and none of them includes
  `holding_flags`:** `src/lib/admin/match.ts:101` (batch metadata), `src/app/api/admin/match/allocators/route.ts:72`
  (`id, allocator_id, computed_at, mode, candidate_count, filter_relaxed`),
  `services/match_eval.py:165` and `:393`, `services/feedback_engine.py:187` (`id`), and
  `routers/match.py:2270` (`computed_at, engine_version`), `:2378` and `:2402` (`id`). The
  insert at `routers/match.py:2045` gets the row back but uses only `id`. The recommendations
  page does not read `match_batches` at all; its one hit is a doc comment. The GDPR export
  (`gdpr-export-manifest.ts:714`) dumps the row verbatim, and the entry holds no third-party or
  sensitive data.
- **Python:** nothing reads `holding_flags` back. `match.py` only writes it.
- **SQL:** no function, view or trigger reads the column. `baseline.sql` has two hits, the column
  definition and its COMMENT. `supabase/tests` and `supabase/functions` have no hits.

### Tests run (targeted)

- `analytics-service`: `pytest tests/test_match_*.py tests/test_holding_flags_phase09.py
  tests/test_holding_equity_contribution.py tests/test_holding_price_gap.py
  tests/test_e2_match_score_golden.py` gave **474 passed**. That includes the new
  `test_a_failed_unpriced_marker_read_is_named_in_the_persisted_batch` and the parity test's new
  `unpriced_check_failed` assertion.
- `mypy routers/match.py`: no issues.
- `vitest run` on `MissingDataMessage.test.tsx`,
  `AllocationDashboardV2.shared-account-named.test.tsx`, `key-data-gaps.test.ts`,
  `degrade-warnings.test.tsx` and `degrade-warning-scan.test.ts` gave **209 passed**.
- The fixer's neutering claims were not re-run, because this review edits no source. Each new
  assertion compares an exact list or value, so removing either fix necessarily fails it.

### Observations outside the review scope (planning artifacts, not findings)

- `235-UI-SPEC.md:295-296` (P4) and `:419` still say that one all-failing account reaching
  yesterday prints its undated line "and no fallback". `235-VERIFICATION.md:44` (row 5) still
  describes the pre-fix rule and its neutering count. Both were written before `4e4e7ad5f`, and
  CONTEXT is the corrected source. Re-run or annotate the verifier before the phase closes, so
  that UAT does not test for the old "no fallback" render.
- No surface reads the new batch entry yet; the D-22 and D-23 book entries are in the same
  position. The batch is now distinguishable from one whose markers were read, which is what
  WR-02 asked for. The allocator-facing recommendations page shows no equivalent of the HOLD-04
  note. That is a product choice under CONTEXT [HOLD-02] (rows kept), not a defect in this fix.

_Round 2 reviewed: 2026-11-26T16:10:19Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

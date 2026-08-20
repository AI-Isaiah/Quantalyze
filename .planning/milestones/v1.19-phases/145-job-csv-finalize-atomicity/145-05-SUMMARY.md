---
phase: 145-job-csv-finalize-atomicity
plan: 05
subsystem: testing
tags: [vitest, test-vacuity, sentry, csv-finalize, todos, deferral]

requires:
  - phase: 145-04
    provides: "the fold caller arms these gates drive — finalizeAtomicOrErrorResponse (fold-fail 500 CSV_FINALIZE_FAIL, step=finalize-fold-fail) + resolveExistingStrategyOrRefuse (409 CSV_SESSION_REUSED step=finalize-resolve-refused, 503 step=finalize-resolve-read-fail, read-only echo)"
  - phase: 145-02
    provides: "145-REPRODUCTION.md census (queries 1-4, PROD+TEST, 2026-08-17) — the measured numbers the TODOS deferrals cite"
provides:
  - "src/__tests__/csv-finalize-c14-regression.test.ts — vacuous RED-TEAM-M1 block DELETED; NEW-C14-07 describe.skip DELETED (dissolved arm); three replacement gates (A fold-fail capture+copy, B resolve-refused capture+copy+no-metadata-write, C resolve-echo read-only contract), each observed RED under a scratch-variant neuter"
  - "TODOS.md — Phase 145 deferrals section: window E (census (3) PROD=1 cited + composite attribution), wizard first-hop drop (never-widen constraint + (1)-minus-(2) PROD=0/TEST=8107), inert flag-row/env cleanup (20260620120000:86-89 RAISE trap verbatim + measured guard semantics)"
  - "consolidated phase-wide TS neuter-RED table (Plan 04's 12 rows + Plan 05's 3 rows) with pointers to Plan 03's SQL matrix — the evidence Plan 06's human gate presents"
affects: [145-06 (TEST apply + live exercise + merge gate; owns deferred-items #5 disposition)]

actuals:
  tokens: 10586   # chars/4 over the two realized diffs (git show c5851564 + bcf90a8d = 42,347 chars)
  tasks: 2
  commits: 3      # 2 task commits + this docs commit

tech-stack:
  added: []
  patterns:
    - "Neuter-RED via generated route VARIANTS + a temporary vitest alias config — the production file is never edited for a neuter; the generator refuses no-op/missing-anchor transforms (the Plan 03/04 register, reused)"
    - "Read-only-contract pinning: dedicated write-shaped mocks (update/insert/upsert) asserted not-called, plus an exact RPC call count, so ANY write from inside the resolve arm reds the gate regardless of which write shape a regression uses"

key-files:
  created: []
  modified:
    - src/__tests__/csv-finalize-c14-regression.test.ts
    - src/app/api/strategies/csv-finalize/route.ts   # ONE comment reworded (see Deviations 1)
    - TODOS.md
    - .planning/WINDOWS.md
    - .planning/phases/145-job-csv-finalize-atomicity/deferred-items.md

key-decisions:
  - "NEW-C14-07 DELETED, not unskipped: the upstream-body spread it pinned dissolved with hop 0 (there is no /process-key body to strip), and the surviving TS-13 discipline is pinned by route.test.ts's re-pointed describe — Plan 04's skip comment explicitly assigned this file's disposal to Plan 05"
  - "Window E's pre-registered re-rank trigger (census (3) non-zero on PROD) technically fired at PROD=1 — addressed, not hidden: the single row is the KNOWN composite already tracked by 143's D-09 TODOS entry (chain-terminal by design), so the entry stays mid-term with the attribution recorded"
  - "deferred-items #5 (csv-finalize-rpc.test.ts names the dropped RPC) deliberately routed to Plan 06: it is exercisable only against a migrated live DB, so a Plan-05 re-point would be a test whose RED/GREEN cannot be observed — the exact disease this plan exists to cure"

metrics:
  duration: 25m
  completed: 2026-08-17

status: complete
---

# Phase 145 Plan 05: honesty-gate rebuild + deferral filing Summary

The test that could never fail is gone and its file now holds only gates observed to fail for the reasons they exist: the vacuous RED-TEAM-M1 block and the dissolved NEW-C14-07 skip were deleted and replaced IN THE SAME COMMIT (`c5851564`) with three gates driving the fold caller's real post-RPC arms — each observed RED under a scratch-variant neuter — and the three consciously-deferred items are filed in TODOS.md with their constraints and measured census citations attached (`bcf90a8d`).

## Commits

| Hash | Message | Files |
|------|---------|-------|
| `c5851564` | `test(145-05): delete the vacuous RED-TEAM-M1 block; replace with gates that can fail` | c14 test file (rebuilt), route.ts (one comment reworded) |
| `bcf90a8d` | `docs(145-05): file window-E / first-hop / flag-cleanup deferrals with constraints` | TODOS.md (+52 lines, pure append), WINDOWS.md (entry 1 → fixed), deferred-items.md (#5 routed) |

## Task outcomes

| Task | Outcome |
|------|---------|
| 1 | RED-TEAM-M1 block deleted (0 occurrences of its name in the file, count-asserted); its search string at ZERO occurrences in all of src/ (count-asserted — required one comment reword, Deviation 1); NEW-C14-07 skip block deleted (key decision 1); Tests A/B/C authored in the after-failloud idiom (assert tags.step AND the surviving console line), each observed RED (table below); file green after restore 32/32; five csv-finalize sibling suites green 101/101; eslint clean; `npx tsc --noEmit` exit 0 |
| 2 | Three TODOS entries appended in the phase-section register format (52 inserted lines, zero other bullets touched — verified `git diff --stat` = insertions only); verify chain green (`20260620120000` ×2, `first-hop` ×3, TODOS.md in HEAD stat); WINDOWS ledger entry 1 (the NEW-C14-07 skip) marked fixed; consolidated neuter-RED table below |

## Why the deleted block could never fail (from its own comments, for the record)

The single `it` drove the **pre-create** 400 (`metadata: { aum: "-999" }` rejected at the parse boundary — the RPC was never called), then asserted `captureToSentry` was **NOT** called with a message containing a three-word orphan phrase that existed nowhere in src/ as an emitted string. Its own comments admitted the post-RPC path was unreachable from the body alone ("we cannot inject a post-RPC failure via the body alone in unit tests without mocking the helper… that fires BEFORE the RPC"). A not-called assertion about a never-emitted string on a never-reached path: vacuously true forever, titled for a guarantee ("post-RPC metadata validation orphan Sentry capture") nobody implemented. The fold supersedes the guarantee itself — a failed finalize now commits NOTHING (migration `20260819120000`, no EXCEPTION block), so there is no orphan to capture (145-REPRODUCTION.md: CANNOT REPRODUCE; the deletion condition CONTEXT's discretion clause set on landing SC#2).

## Plan 05 observed-RED records (Task 1, all three)

Every neuter ran against a generated VARIANT of route.ts wired in via a temporary vitest alias config (`vitest.neuter.config.ts`, deleted before commit); the generator refused no-op/missing-anchor transforms; the production file was never edited for a neuter.

| Test | Neuter (variant transform) | Observed RED (verbatim head) | Restored |
|------|---------------------------|------------------------------|----------|
| A — fold-fail capture | the fold-failure `captureToSentry(error ?? …)` call removed (replaced with `void 0;`) | `AssertionError: expected undefined to be defined` (at `findCapture("finalize-fold-fail")`; 1 failed \| 31 passed) | GREEN 32/32 |
| B — resolve-refused, checks-before-metadata | a `strategies` UPDATE injected BEFORE CR-01 check 1 (name) in `resolveExistingStrategyOrRefuse` — the pre-fold 409-lie ordering | `AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times` at `expect(updateMock).not.toHaveBeenCalled()` (2 failed \| 30 passed — the injected write precedes BOTH the refusal and echo paths, so Test C redded too; expected collateral) | GREEN 32/32 |
| C — resolve-echo read-only contract | a `strategies` UPDATE injected on the echo path AFTER both checks pass | `AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times` at Test C's `expect(updateMock).not.toHaveBeenCalled()` (1 failed \| 31 passed) | GREEN 32/32 |

## CONSOLIDATED Phase-145 TS neuter-RED table (the evidence for Plan 06's human gate)

Plan 04's 12 rows (from `145-04-SUMMARY.md` — every neuter on a verified-differing variant, production files never edited) + Plan 05's 3 rows above. No after-failloud re-points happened in Plan 05 (Plan 04's row 10 already re-pointed and re-observed that driver; its four tests ran green here, 4/4, unchanged). SQL-side evidence: **Plan 03's Neuter-RED matrix, `145-03-SUMMARY.md` § "Neuter-RED matrix"** (8 required neuters + 3 extra observations on the throwaway PG 16.13 cluster, db q145f).

| # | Plan | Arm / gate | Neuter | Observed RED (verbatim head) |
|---|------|-----------|--------|------------------------------|
| 1 | 04 | Merge case (2025 onto committed 2024 → 409) | range refusal disabled (`> 0` → `> 9999`) | `AssertionError: the route reported success for a submission whose file the committed strategy does not hold … expected 200 not to be 200` |
| 2 | 04 | Range filter uses payload's own min/max | min-bound corrupted (`date.lt.${minDate}` → `date.lt.${maxDate}`) | `AssertionError: expected [ Array(1) ] to deeply equal [ Array(1) ]` (filter mismatch) |
| 3 | 04 | POSITIVE first submit creates via fold | success check disabled (`if (!error && isUuid(...))` → `if (!error && false && ...)`) | `AssertionError: expected 500 to be 200` |
| 4 | 04 | POSITIVE instructed retry resolves | name check inverted (`!==` → `===`) | `AssertionError: expected 409 to be 200` |
| 5 | 04 | Failed resolve read fails CLOSED | fail-closed disabled (`if (staleErr)` → `if (staleErr && false)`) | `AssertionError: expected 200 to be 503` |
| 6 | 04 | D-08 'private' wire pin (route.test.ts) | `terminalStatus: "private"` → `"pending_review" as "private"` | `AssertionError: expected 'pending_review' to be 'private'` |
| 7 | 04 | D-12 fold-fail capture pin | step tag renamed (`finalize-fold-fail` → `neutered-step`) | `AssertionError: expected "vi.fn()" to be called with arguments: [ …(2) ]` |
| 8 | 04 | D-11 honest-copy pin | sentence replaced (`Nothing was saved — the submission rolled back completely` → `The submission may have partially saved`) | `AssertionError: expected 'Your strategy could not be saved. The…' to contain 'Nothing was saved'` |
| 9 | 04 | TS-13 error-never-restamped pin | success decided by isUuid alone (`if (!error && isUuid(...))` → `if (isUuid(...))`) | `AssertionError: Deciding the success path by isUuid(strategy_id) alone … expected true to be false` |
| 10 | 04 | after-failloud path 1 (placeholder-upsert capture, re-pointed driver) | step tag renamed (`placeholder-upsert` → `neutered-ph`) | `AssertionError: expected undefined to be defined` (capture absent) |
| 11 | 04 | D-07 p_rows wire pin (manager fold call carries the series) | `p_rows: args.rows` → `p_rows: []` | `AssertionError: expected [] to deeply equal [ { date: '2024-01-01', …(1) } ]` |
| 12 | 04 | Python dead-branch pin (`…csv_finalize_branch_is_dead_answers_422`) | run against the PRE-DELETION router (throwaway `git worktree` at `8fecdab9`) | `AssertionError: … assert 'CSV_FINALIZE_FAILED' == 'MISSING_STRATEGY_ID'` |
| 13 | **05** | 145-05 A — fold-fail capture + truthful copy | capture call removed (`void 0;`) | `AssertionError: expected undefined to be defined` |
| 14 | **05** | 145-05 B — resolve-refused: NO write before the checks | write injected before CR-01 check 1 | `AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times` |
| 15 | **05** | 145-05 C — resolve-echo: the arm persists NOTHING | write injected on the echo path | `AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times` |

Restore proof: variant + temp config deleted; the c14 file and its four csv-finalize siblings re-ran GREEN against the real route (32/32 scoped; 101/101 across the five suites); `git status` carried no harness files at either commit.

## TODOS deferrals filed (Task 2) — each with its constraint verbatim

1. **Window E** — cites census query (3)'s measured result (PROD = 1, TEST = 0, 2026-08-17). The pre-registered re-rank trigger fired at PROD=1 and is addressed in the entry: the row is the known composite already tracked by 143's D-09 entry, so no genuine window-E population exists and the item stays mid-term.
2. **Wizard first-hop drop** — ⛔ "never absorb it by widening a predicate" carried; cites (1)-minus-(2): PROD = 0, TEST = 8107 (e2e-seed residue class); explicitly forbids bolting a second predicate onto `20260816140000` or the fold's resolve arm.
3. **Inert flag-row/env cleanup** — ⛔ `20260620120000:86-89` RAISE-at-apply constraint verbatim, plus the measured guard semantics (fires on `value='off'` AND `updated_by <> 'migration-104-seed'`; a DELETE leaves NULL which passes, a flip to `'off'` trips; TEST already reads `'off'`). Cleanup ordering prescribed: retire/guard the check first.

The fourth CONTEXT-deferred item (onboard/resync token forwarding) was NOT re-filed — it is a standing 140.1 obligation (`140.1-TS-OBLIGATIONS.md:251`), exactly as the plan instructed.

## Deviations from Plan

### Auto-fixed

**1. [Rule 3 - Blocking] route.ts:1316 comment reworded — the plan's "the search string exists nowhere in src/ today" premise was stale.** The three-word phrase the deleted test grepped for existed in a route.ts comment dating from Phase 106 (`b196de6c`), so the plan's count-asserted acceptance (`grep -rc … src/` = 0) could not pass without touching it. Reworded to "orphaned `strategies` row" with an inline warning that the exact phrase is count-asserted to zero and must not be reintroduced. One comment, same commit, meaning preserved.

**2. [Rule 1 - Bug] Three TS7006 implicit-any errors in the new tests** (`.mock.calls.some((c) => …)` on `vi.spyOn` results) caught by `npx tsc --noEmit` before commit; annotated `(c: unknown[])`. Also re-learned the repo rule the hard way: the first tsc run piped to `tail` masked the exit code — re-ran unpiped.

### Considered decisions (within plan scope)

**3. NEW-C14-07 deleted, not unskipped** — the prompt asked to check whether the rebuild covers it; it cannot: the arm it pinned (the /process-key upstream-body spread) no longer exists in any form. Disposal per Plan 04's own skip comment ("Plan 05 owns this file … and disposes of this block properly"); the surviving TS-13 discipline is pinned by route.test.ts. WINDOWS ledger entry 1 closed accordingly.

**4. deferred-items.md #5 routed to Plan 06 with rationale** (not discharged here) — a re-point of a live-DB-only test is unverifiable without the migrated DB; Plan 06's TEST apply is the first verifiable moment.

**5. [Note] Commits made on `feat/v1.19-phase-145`** — the branch the orchestrator explicitly designated for this worktree (same recorded note as Plans 03/04).

**6. [Note] JOB-06 deliberately NOT marked complete** — Plan 06 (TEST apply + live exercise + merge gate) remains; same register as Plans 01-04.

## Known Stubs

None. No skipped tests remain in the rebuilt file (0 skips; the prior `describe.skip` is deleted and its WINDOWS entry closed).

## What could NOT be verified here (and why)

- **The fold against a real database** — no Supabase MCP/psql in this session by design; the route-level gates mock the RPC boundary. Plan 06 (orchestrator-only) owns the TEST apply + live exercise.
- **Full CI shard behavior / `npm run test:coverage`** — the five csv-finalize suites ran locally green (101 tests); the sharded coverage run is CI's job.
- **TEST's flag-row `updated_by`** (whether it is the `migration-104-seed` exemption) — no DB access; recorded as unverified inside the TODOS entry itself.
- **`csv-finalize-rpc.test.ts`** — deliberately untouched (Deviation 4); still names the dropped RPC; owner Plan 06.

## Self-Check: PASSED

- `src/__tests__/csv-finalize-c14-regression.test.ts` — FOUND (RED-TEAM-M1 ×0, describe.skip ×0, `finalize-fold-fail` / `finalize-resolve-refused` asserted; 32/32 green)
- `grep -rc "orphan strategy row" src/` non-zero files — 0 — VERIFIED
- TODOS.md Phase 145 section — FOUND (`20260620120000` ×2, `first-hop` ×3)
- Commits `c5851564`, `bcf90a8d` — FOUND in `git log`
- No harness files (`route.neuter.gen.ts`, `vitest.neuter.config.ts`) in tree — VERIFIED
- Zero hunks on `20260816140000` / `20260817120000` / `20260819120000` — VERIFIED (`git show c5851564 bcf90a8d -- supabase/migrations/` empty)

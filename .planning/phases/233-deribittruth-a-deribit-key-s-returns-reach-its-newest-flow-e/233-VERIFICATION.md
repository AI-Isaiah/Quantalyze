---
phase: 233-deribittruth-a-deribit-key-s-returns-reach-its-newest-flow-e
verified: 2026-11-26T04:30:00Z
status: passed
score: 5/5 must-haves verified
verified_at_sha: 177ac6a9e737a0250235024da341156a8803c763
drift_subjects:
  - scripts/prod-prober/arms/freshness.mjs
  - scripts/prod-prober/run.mjs
  - scripts/prod-prober/fixtures/freshness/ok.json
  - scripts/prod-prober/fixtures/freshness/stale.json
  - .github/workflows/prod-prober.yml
  - src/__tests__/prod-prober-wiring.test.ts
  - analytics-service/services/deribit_txn.py
  - analytics-service/tests/test_deribit_txn.py
  - analytics-service/scripts/deribit_book_oracle.py
  - analytics-service/tests/test_deribit_book_oracle.py
  - .planning/debug/deribit-stale-returns.md
behavior_unverified: 0
overrides_applied: 0
---

# Phase 233: DERIBITTRUTH Verification Report

**Phase Goal:** A Deribit key's returns reach its newest flow and anchor day or carry a named reason, every day of the founder's Deribit book is explained or withheld, a capital correction is never trading P&L, and a stale series pages on every venue.
**Verified:** 2026-11-26
**Status:** passed
**Re-verification:** No, initial verification

The success criteria were read through the ROADMAP's two dated deviation notes (the 2026-11-24 founder rulings Q1 to Q4 and the 2026-11-25 q-dbook01 answer "Accept (Recommended)"). Those notes amend the contract and are founder decisions, so they are not frontmatter overrides.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1 (FRESH-01): the diagnosis names the cause; the account's series reaches its newest flow and anchor day or the gap carries a stored, named reason; nothing is backfilled | VERIFIED | `.planning/debug/deribit-stale-returns.md` is `status: resolved`. Cause: Phase 188 tiny-base rule (key_inputs.tiny_base_days) after a near-total withdrawal, not a writer defect. 233-06-SUMMARY holds the 2026-11-26 PROD reading: `fresh01-rows` D1, D2 and D3 each have a 2026-11-25 row and `gap_rows=0`; `fresh01-inputs` shows the gap days listed in `tiny_base_days`; derive jobs `done`; `fresh01-verdict: CONFIRMED`. No writer or compose file is in the phase diff (S1 and S2 untouched, as ruled). The "fix lands at the missing reader" is the freshness arm's day-by-day tiny_base_days rule (`judgeFreshness`), which has a diagnosed-shape green control. |
| 2 | SC2 (FRESH-02): a check outside the derive job pages every daily-derived key, on every venue, trailing its newest flow or anchor day by more than the bound without a named reason; RED on a held-back fixture; never blocks CI | VERIFIED | `scripts/prod-prober/arms/freshness.mjs`: `FRESHNESS_BOUND_DAYS = 2`, scope is every key with a `derive_broker_dailies` job in 3 days on any venue, reasons are exactly day-by-day tiny_base_days and anchor_null_reason, defect kind `freshness-stale`, plus `freshness-no-scope` and measure-fail guards (zero scope, no terminal day, row-count mismatch, per-venue not-judged). Registered in `run.mjs` with `ARMS_FLOOR = 5`. I ran `node scripts/prod-prober/run.mjs --self-test`: `SELF-TEST PASSED: 109/109 scenarios`. Fixtures `stale.json`, `partial-cover.json`, `bound-plus-one.json` and `tail-edge-uncovered.json` page, and `ok.json` is the control. `npx vitest run src/__tests__/prod-prober-wiring.test.ts`: 124 passed. Runs in `.github/workflows/prod-prober.yml` (hourly schedule); `ci.yml` has no freshness arm (2 grep hits are unrelated comments and an e2e spec name), so the check cannot gate CI. A5 (the prober role can read the FORCE-RLS tables) is proven by prober run 45736879079: `scope derived=25 with_inputs=25 with_terminal=24`, `judged=20 ... stale=0`, venues bybit, deribit, mt5 and okx. That run's `freshness.mjs`, `run.mjs`, `deribit_txn.py` and `deribit_book_oracle.py` are byte-identical to HEAD (`git diff b0b5b8b3 HEAD` quiet on each). |
| 3 | SC3 (DBOOK-01): every day of the founder's Deribit book cumulative return is explained by booked P&L and flows, or withheld by name, with no plausibility bound; the close is an attribution reading | VERIFIED (as amended by the founder) | `analytics-service/scripts/deribit_book_oracle.py` is stdlib-only (an AST independence scan with a self-test is in `test_deribit_book_oracle.py`) and uses closed reason sets, equality tolerances only (`_BOOK_RETURN_REL_TOL = 1e-9`, which is not a plausibility bound), and a verdict order of key-set, vacuity, STOP, CLEAN. PROD reading in 233-07-SUMMARY: `published=920 explained=806 withheld=114 omitted=327`, `oracle-key-set ... reproduced=yes`, `omission_unexplained=0`, no `attribution_mismatch` or `emptied_stretch` days. All 114 withheld days are structural and named: `no_stored_base_level` 110, `key_set_not_reproducible` 3, `key_basis_not_reproducible` 1. The six big days are explained, and capital-outside-base is annotated and not nulled. The verdict is STOP on those withheld days, and the founder answered q-dbook01 "Accept (Recommended)": the days stay published, named withheld in the reading, and DBOOK-01 closes as a reading. That answer is recorded in CONTEXT, ROADMAP and 233-07-SUMMARY. I ran `tests/test_deribit_book_oracle.py` (with `test_deribit_txn.py`): 255 passed. |
| 4 | SC4 (DBOOK-02): a correction row with a capital reason never classifies as trading P&L, including a trading token with no capital word; one fixture per correction shape | VERIFIED | `analytics-service/services/deribit_txn.py` `correction_is_trading`: the capital denylist is matched first and wins, then a trading word AND a named instrument (`_correction_names_instrument`: an anchored upper-case token, or a string `instrument_name` that fullmatches the same pattern) are both required. Everything else fails loud through `assert_correction_classifiable`. `test_deribit_txn.py` carries a headline test (`funding account correction` fails loud), structured name, token variants, capital-beats-instrument, no-instrument, near-miss tokens, lowercase, and blank or non-string `instrument_name`. 255 passed (run above). `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/deribit_txn.py`: no issues. |
| 5 | SC5 (PROOF-01): each gate goes RED on a neutered copy with its named arm first, is restored from a byte backup (`cp`, `cmp`) and goes GREEN, recorded verbatim; no migration | VERIFIED | Plan SUMMARIES 01, 02, 03, 04, 05 and 07 each carry a PROOF-01 table with the neuter edit, the RED line, `cmp: exit 0, no output` and the GREEN line (3, 3, 5, 5, 5 and 9 `cmp` rows). The review fix rounds record neuters for WR-01 to WR-06 in `233-REVIEW.md`. Plan 06 is a PROD reading with no gate. No `supabase/migrations` file is in the phase's scope, consistent with the Q3 ruling (the migration-reviewer and rls-policy-auditor clause does not apply). Review round 4: 0 Critical, 0 Warning, 15 Info, which the repo rule leaves unfixed. |

**Score:** 5/5 truths verified (0 behavior-unverified).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Prober self-test including the held-back RED fixtures | `node scripts/prod-prober/run.mjs --self-test` | `SELF-TEST PASSED: 109/109 scenarios` | PASS |
| Registry, floor 5 and scenario-count pins | `npx vitest run src/__tests__/prod-prober-wiring.test.ts` | 124 passed | PASS |
| Classifier and book oracle | `.venv/bin/python -m pytest -q tests/test_deribit_txn.py tests/test_deribit_book_oracle.py` (from `analytics-service/`) | 255 passed | PASS |
| Strict typing of the classifier | `.venv/bin/mypy --strict --follow-imports=silent --config-file=pyproject.toml services/deribit_txn.py` | Success: no issues | PASS |

Full suites, the mutation runner, e2e and any PROD access were not run, per the load limit. PROD evidence is the recorded 2026-11-26 reading and prober run 45736879079, not a re-read.

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| FRESH-01 | SATISFIED | SC1: the diagnosis, the 2026-11-26 PROD reading (CONFIRMED) and the arm accepting stated left-out days. |
| FRESH-02 | SATISFIED | SC2: the fifth prober arm `freshness`. |
| DBOOK-01 | SATISFIED (reading, per q-dbook01) | SC3: the attribution reading, 806 of 920 days explained, 114 named structural withholds, founder Accept. |
| DBOOK-02 | SATISFIED | SC4: the instrument-conjunction classifier and its fixtures. |

### Anti-Patterns Found

None blocking. Debt-marker scan found no unreferenced TBD, FIXME or XXX in the phase's source files that I checked. The 15 open Info items in `233-REVIEW.md` (for example IN-02 vacuous field-name pins, IN-16 the `unknown` venue bucket) are recorded per repo rule and are not fixed.

### Human Verification Required

None.

### Gaps Summary

No gaps. Four items outside this verdict for the orchestrator:

1. **Ship-step items not yet done.** The `TODOS.md` deletions (`[185-BOOK-CUMULATIVE-UNEXPLAINED]` and the `Deribit correction residual` bullet), the CHANGELOG entry and the VERSION bump belong to the ship PR. `185-BOOK-CUMULATIVE-UNEXPLAINED` is still present in `TODOS.md` in this worktree. The new FIX MID-TERM entry for strategy-mode freshness (orchestrator decision O6) is also a ship-step item.
2. **Phase 234 handoff.** 233-06 found that book B still carries `out_of_window_flow` and `is_trustworthy=false` after the 2026-11-26 compose. CONTEXT Q2 and the ROADMAP Phase 234 note assumed the flag clears by itself, so that note should be corrected when 234 is planned. This does not reopen FRESH-01.
3. **DBOOK-02 residual.** The classifier fails loud on any capital reason without an instrument, but a capital adjustment that names an instrument and a trading word with no capital word would classify as trading. That is the founder-accepted shape; no PROD key was measured for it (A1 in 233-01-SUMMARY).
4. **Unrun on PROD.** The freshness arm has never paged a real PROD key; its RED path is proven on fixtures only, and its GREEN path on one PROD run.

---

_Verified: 2026-11-26_
_Verifier: Claude (gsd-verifier)_

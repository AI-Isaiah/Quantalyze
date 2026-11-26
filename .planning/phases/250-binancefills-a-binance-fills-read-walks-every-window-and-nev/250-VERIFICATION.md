---
phase: 250-binancefills-a-binance-fills-read-walks-every-window-and-nev
verified: 2026-11-26T00:00:00Z
status: passed
score: 5/5 roadmap success criteria verified on their main path; 2 recorded open corners need a founder decision; 1 CI-owed reading
verified_at_sha: ca6d7ff64d7f1e7367726bacabb70ec6e6e992e4
drift_subjects:
  - analytics-service/services/exchange.py
  - analytics-service/services/job_worker.py
  - analytics-service/tests/_binance_fills.py
  - analytics-service/tests/test_binancefills_walk.py
  - analytics-service/tests/test_binancefills_cursor.py
  - analytics-service/tests/test_binancefills_e2e.py
  - analytics-service/tests/test_binancefills_harness.py
  - analytics-service/tests/test_binancefills_adapter.py
  - analytics-service/tests/test_exchange.py
behavior_unverified: 0
overrides_applied: 1
re_verification:
  previous_status: none
coincidental_reliance_items: []
human_verification:
  - test: "Founder decision: accept or reject the recorded open SC-3/SC-2 corner `[250-BINANCE-STOP-BELOW-CURSOR]` as non-blocking for closing Phase 250"
    expected: "Either accept it explicitly (the gap stays booked, and the switch for Binance stays off until a phase closes it), or route a fix phase before Phase 250 is marked complete. No founder ruling covers it today; the ruling of 2026-11-25 covers only the quiet-prefix deadline case."
    why_human: "The code is honest and loud about it (flag `binance_stop_below_cursor`, WARNING log, a comment at `_RAW_TRADE_INGESTION_ENABLED`, a TODOS entry), but a state exists where a stopped or failed symbol's span is never re-read. A verifier cannot grant a scope exception."
  - test: "CI python job on the PR head SHA: full analytics-service pytest, `--cov-fail-under=80`, and the base-versus-head failure-list comparison"
    expected: "Green (or only failures identical to base), TOTAL coverage at or above 80, bound to the head SHA with the expected check count."
    why_human: "Plan 08's must-have for the full suite and coverage was NOT run locally (coordinator hard load limit). 250-08-SUMMARY.md records it as a named deviation. This verification did not run it either."
---
## Founder ruling 2026-11-26 (human verification resolved)

Founder ruling 2026-11-26, relayed by the coordinator: "ship Phase 250 now. `[250-BINANCE-STOP-BELOW-CURSOR]` is routed to a follow-up phase, which the main session books on main with /gsd-phase add. The Binance switch stays off until that phase closes."

- UAT item 1 (`[250-BINANCE-STOP-BELOW-CURSOR]`): ACCEPTED AS ROUTED to a follow-up phase; `USE_RAW_TRADE_INGESTION` stays off for Binance until it closes.
- UAT item 3 (the quiet-prefix limit's flag does not survive the derive chain; the WARNING is the lasting signal): ACCEPTED as a known limit, carried by the same routed entry.
- UAT item 4 (T-250-19 sync handler tail repeats every run): ACCEPTED as a known limit.
- UAT item 2 (full-suite pytest, coverage at 80 or more, base-versus-head comparison): closes on the ship PR's CI `python` job, bound to its head SHA.
- ⭐ **UAT item 2 CLOSED 2026-11-26 by the reading.** At #1355's head `72c3c2eb`, CI run 45771729612, job `python` 139745852475 succeeded: `17175 passed, 11 skipped, 2 xpassed`, 0 failed, so there is no failure list to compare with base. TOTAL coverage was 94.99%, above the 80 floor. Shipped as v0.133.84.0 (#1355), merge commit `c57961a54`.

`status` moved from `human_needed` to `passed` on this ruling (the workflow's human-validation path); `verified_at_sha` is unchanged, the verdict was issued at that commit.


# Phase 250: BINANCEFILLS Verification Report

**Phase Goal:** A Binance raw fills read covers every window from its cursor to now, and its cursor never stalls, silently or because one symbol fails. It must land before `USE_RAW_TRADE_INGESTION` is turned on for Binance.
**Verified:** 2026-11-26 at `ca6d7ff64d7f1e7367726bacabb70ec6e6e992e4`
**Status:** human_needed
**Re-verification:** No, initial verification

## Verdict in one paragraph

The goal is achieved on every path the roadmap success criteria describe. The walk, the non-holding unlisted-symbol flag, the page-cap and deadline read-through stamp, and the SC-4 precondition are all present in `services/exchange.py` and `services/job_worker.py`, wired through the real `run_sync_trades_job`, and each gate was seen going RED in this verification under a neuter and GREEN after a byte restore. Two items keep the status from `passed`: (1) a MEDIUM data-integrity corner, recorded openly by the phase, in which a stopped or failed symbol's span is never re-read because the forward-only cursor RPC drops a stamp below the column; (2) the full-suite and coverage reading, owed from CI. The second is the named plan 08 deviation; the first is NOT, so the deviation is not the only gap.

## Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | A Binance linear key with more than 7 quiet days after its cursor keeps reading window by window, reaches newer fills, never stalls at C, never stamps past stored data; named exception: deadline-stopped read over a prefix with no stored fill leaves the cursor at C, loudly via `binance_deadline_symbols`, bounded by the reach clamp (founder ruling 2026-11-25). A test RED on old code feeds the quiet stretch. | VERIFIED | `exchange.py:2743-2898`: one `read_now`, `walk_start_ms` from the seed or the reach, window loop with `params={"until": window_end}` on every request, each window starts at the previous one's end, loop ends at `window_end >= read_now`. The stamp is the max PERSISTED fill (`job_worker.py` gate), never a window end or the clock. Test `test_tracer_a_quiet_stretch_is_walked_and_the_cursor_stamps_the_newer_fill` drives it through the real job on a venue-faithful fake over a real ccxt instance. Neuter N-A (collapse the walk to one window) turned 6 e2e arms RED, including that tracer, a stamp-after-reach-clamp arm and the deadline-frontier arm. Restored, `cmp` silent. The quiet-prefix exception is recorded in CONTEXT, ROADMAP and the `_RAW_TRADE_INGESTION_ENABLED` comment. |
| SC-2 | A symbol that fails every run is named every run, healthy symbols past C+7d are still read and stored, and a transiently failed symbol's span is re-read on the next clean run, never skipped silently. | VERIFIED (main path); corner recorded, see Human Verification 1 | `exchange.py:2927-2942, 3003-3004`: only `ccxt.BadSymbol` goes to `binance_unlisted_symbols` (non-holding, named every run, counted toward the all-failed raise); every other exception keeps the holding `binance_partial_symbols`. The gate's `_fills_incomplete` holds only on `sync_truncated_*` and `binance_partial_symbols`. Markets are loaded before the symbol map (`exchange.py:2716-2717`) with the derivative winning a stripped-name collision, so a stored linear name is not misrouted to spot. Neuter N-B (BadSymbol branch disabled) turned `test_tracer_an_unlisted_symbol_is_named_and_the_healthy_symbol_stamps` and `test_an_unlisted_symbol_is_named_and_not_held` RED; restored, `cmp` silent. The transient re-read arm `test_a_transient_symbol_is_reread_on_the_next_clean_run` is GREEN and went RED under the N-A neuter. |
| SC-3 | A capped symbol records a named flag, the cursor never stamps past its unread fills, a later run resumes past the cap. | VERIFIED (main path); corner recorded, see Human Verification 1 | `exchange.py:2785-2894, 3011-3024`: per-window cap, named `binance_page_cap_symbols`, one `binance_read_through_ms` recorded as the MINIMUM across stopped symbols (the DQ-flag SUM pitfall is avoided). `job_worker.py` gate filters stamp candidates to `ts <= _read_through`, holds win over a stop, an unusable bound holds. Overlap pages do not count toward the cap, so a capped symbol resumes past it. Neuter N-C (bound filter disabled) turned 9 arms RED, including `test_a_capped_symbol_resumes_past_the_cap_on_the_next_run`, which names "the stamp passed the capped symbol's newest read fill". Restored, `cmp` silent. |
| SC-4 | `USE_RAW_TRADE_INGESTION` is not turned on for Binance before SC-1..3 are on `main`; the phase records this as an explicit precondition. | VERIFIED | The flag is unchanged (`os.environ.get("USE_RAW_TRADE_INGESTION", "false")`, off in PROD). A comment on the declaration (`job_worker.py` above `_RAW_TRADE_INGESTION_ENABLED`) names the precondition, the quiet-prefix exception (accepted), the open stop-below-cursor gap and the handler-tail gap (both recorded, not accepted). TODOS.md carries `[250-BINANCE-STOP-BELOW-CURSOR]` with "book a phase before `USE_RAW_TRADE_INGESTION` is turned on for Binance". CONTEXT chose a comment over a prose-reading test, deliberately. |
| SC-5 | PROOF-01: each gate RED on pre-fix code or a neutered copy with its named arm first, restored from a byte backup (`cp` back, `cmp`), GREEN, recorded verbatim in the plan SUMMARY. | VERIFIED | Plans 01-07 SUMMARYs record tracer RED lines and neuter tables with `cp` + `cmp silent` + GREEN (for example 250-02 N7-N20, 250-03 N1, 250-04 N2-N22, 250-06 N10e, 250-07 N13). This verification independently reproduced three neuters (N-A, N-B, N-C above), each RED then restored with `cmp` silent; `git status` clean afterwards. |

**Score:** 5/5 criteria verified on their main path. `behavior_unverified`: 0, because every behavior-dependent truth (cancellation, cursor stamp ordering, deadline stop) has a passing behavioral test that was also shown able to fail.

## Required Artifacts and Key Links

| Artifact | Status | Details |
|----------|--------|---------|
| `analytics-service/services/exchange.py::_fetch_raw_trades_binance` | VERIFIED | Substantive (458 changed lines), wired: `fetch_raw_trades` threads `read_deadline_s` and `pre_overlap_seed_ms` to it on the Binance branch; third caller `BinanceAdapter.fetch_raw` is covered by `test_binancefills_adapter.py`. |
| `analytics-service/services/job_worker.py::run_sync_trades_job` gate block | VERIFIED | Gate moved above the H-0691 stamp block (round-3 review confirmed the 121 moved lines are byte-identical). The call site passes `read_deadline_s=BINANCE_SYNC_FILLS_READ_DEADLINE_S` (840 s) as the founder ruled. `advance_sync_cursor` RPC position and inputs unchanged. |
| `tests/_binance_fills.py` + 5 `test_binancefills_*.py` files, `tests/test_exchange.py` | VERIFIED | The venue fake models the venue, not ccxt's convenience (7-day cap, 1000 rows, refuses over-long windows), through a REAL ccxt instance. |
| Data-flow: fills read -> `raw_fills` -> persist -> `_p_last_fetched` -> `advance_sync_cursor` | FLOWING | Stamp is computed from persisted fills only; e2e arms assert the written RPC argument. |

## Behavioral Spot-Checks and Gates Run

| Check | Command (from `analytics-service/`) | Result |
|-------|--------------------------------------|--------|
| Targeted tests, serial | `pytest -q -p no:cacheprovider tests/test_binancefills_{walk,cursor,e2e,harness,adapter}.py tests/test_exchange.py` | 304 passed, 0 failed |
| mypy strict | `mypy --strict services/exchange.py services/job_worker.py` | Success: no issues found in 2 source files |
| Neuter N-A, N-B, N-C | single-occurrence edit from a scratchpad byte backup, run e2e + cursor + walk, `cp` back, `cmp` | RED (6, 2, 9 failing arms) each, `cmp` silent each, tree clean |
| Debt markers in added lines | grep for `TBD`, `FIXME`, `XXX` over the diff | none |

Not run, by the hard load limit and the known deviation: full pytest, coverage, base-vs-head failure comparison, probes (the phase declares none).

## Requirements Coverage

No requirement IDs are mapped to this phase (plans map to SC-1..SC-5). Orphaned requirements: none.

## Anti-Patterns

None blocking. No debt markers in added lines. The empty-list and `None` initialisers in the walk (`all_trades = []`, `stop = None`) are overwritten by the read and are not stubs.

## Human Verification Required

### 1. Recorded open gap `[250-BINANCE-STOP-BELOW-CURSOR]` (MEDIUM, data-integrity)

**Test / decision:** Accept it as non-blocking for closing Phase 250, or route a fix before completion.
**What it is:** When the fills cursor column is ahead of the strategy's newest stored fill (likeliest: the first sync of a second strategy on a key shared with another strategy; also pre-232 wall-clock stamps and deleted fills), a stopped or failed symbol's bounded stamp is below the column. The forward-only `advance_sync_cursor` RPC (migration `20260602173710`) drops it, the next seed is the column, and that symbol's span between its bound and the column may never be re-read. This is a literal shortfall against SC-3's "a later run resumes past the cap" and SC-2's "span is re-read on the next clean run", in that state only.
**What the phase did:** named it with `binance_stop_below_cursor` plus a WARNING, recorded it at `_RAW_TRADE_INGESTION_ENABLED`, and booked it in TODOS.md. Round 3 found its signal incomplete (a stop plus a failed symbol is not flagged; the flag is overwritten by the chained derive and CSV analytics writes, so the WARNING is the only lasting signal). Closing it needs an RPC or seed-rule change, outside this phase's fence.
**Why human:** No founder ruling covers it, and the switch precondition in SC-4 depends on it being closed first. The sync path is dormant in PROD (`USE_RAW_TRADE_INGESTION` off), but the nightly reconcile and onboarding are live callers of the walk; they only read and diff, so they are not exposed to the cursor corner.

### 2. CI-owed full-suite and coverage reading (named plan 08 deviation)

**Test:** CI `python` job on the PR head SHA.
**Expected:** full pytest GREEN or failures identical to base, coverage at or above 80.
**Why human:** not run locally; see the deviation in `250-08-SUMMARY.md`. This is a binding step, not a defect in the code.

### Also recorded, not gating (listed so nothing is silent)

- Known limit T-250-19, the sync handler tail: a fill-heavy read that also runs to its 840 s deadline can overrun the 900 s handler during persist and repeat as a loud timeout. Orchestrator decision, recorded in the code comment and the ship hand-over; no founder ruling.
- LOW round-3 items (WR-04 to WR-06) are recorded in `250-REVIEW-R3.md` only, per the repo rule.
- The ship CHANGELOG and VERSION bump are a ship-step duty (the hand-over text is in `250-08-SUMMARY.md`); this branch does not carry them, which is expected before ship.

## Gaps Summary

No success criterion is FAILED on its described path, and no must-have is missing, stubbed or unwired. If the founder accepts the recorded corner (item 1) and CI binds the full suite (item 2), the status moves to `passed`. If the CI deviation were the only open item it could be bound to CI alone; it is not the only one.

---

_Verified: 2026-11-26_
_Verifier: Claude (gsd-verifier)_

---
phase: 234-nocapital-a-no-capital-key-takes-one-named-path-and-a-transi
reviewed: 2026-11-25T11:36:24Z
round: 2
depth: standard
files_reviewed: 6
files_reviewed_list:
  - analytics-service/services/allocator_equity_derive.py
  - analytics-service/services/allocator_equity_compose.py
  - analytics-service/services/job_worker.py
  - analytics-service/tests/test_allocator_equity_no_capital_exit.py
  - analytics-service/tests/test_derive_allocator_equity_job.py
  - analytics-service/tests/test_allocator_equity_inception.py
findings:
  critical: 0
  warning: 1
  info: 3
  total: 4
  necessity: 0
status: issues_found
---

# Phase 234: Code Review Report (round 2)

**Reviewed:** 2026-11-25T11:36:24Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found (one WARNING: a test gap. No production defect found.)

## Summary

Scope:

- The round-1 fix commits: `git log -p e779994d4..HEAD -- analytics-service`, which covers 87463035f, 681a307d8, 041e42e0d and 6dc860523.
- A re-scan of the whole phase diff: `git diff 29e5448e9..HEAD -- analytics-service`.
- Judged against `234-CONTEXT.md`, including its "CORRECTED 2026-11-25" note.

Test run at HEAD: the three phase suites plus `test_derive_refusal_rows.py` give `254 passed`.

**How the fixes were checked.** Each fix was reverted or mutated in a throwaway copy of
`analytics-service/`, and the three phase suites were run against each mutant. The worktree was
not touched.

- In that copy, `test_working_holder_status_set_matches_ts_and_sql` fails even with no mutation, because it reads TS and SQL files outside `analytics-service/`. Its failure is therefore not counted as a kill below.
- Every round-1 fix is killed by its own new test.
- Two narrower mutants and the band-width mutants survive. See WR-01 and IN-A/IN-B.

**What the fixes did not break:**

- **Band boundaries.** The production comparisons are strict (`> DUST_NAV_FLOOR`, `< -DUST_NAV_FLOOR`; `job_worker.py:17836`, `:17839`), so the band is inclusive on both sides: `-DUST_NAV_FLOOR <= level <= DUST_NAV_FLOOR`. That matches the docstring, the CONTEXT note, and the selection gate's `negative_terminal` boundary. There is no off-by-one.
- **Sentry events (M1).** Both new captures (`job_worker.py:17926-17933`, `:18372-18379`) send a static message. Their only tags are `compute_job_id` and `exception_class`, the same shape as the existing capture at `:17201`.
  - `sentry_init.py` sets `include_local_variables=False` and `send_default_pii=False`.
  - `attach_stacktrace` is left at the SDK default (off), so a `capture_message` carries no frame.
  - The live `_nc_exc` / `exc`, the key-id-keyed maps and the USD levels in the frame therefore cannot reach the event. Nothing leaks.
- **Refusal payload shape (M2).**
  - `refusal_payload` adds `inputs.no_capital_exit_refused` only when the counts are non-empty, so the default call is byte-identical.
  - `tests/fixtures/derive_refusal_rows.json` is not in the diff, and `test_derive_refusal_rows.py` passes.
  - The TS reader (`src/lib/queries.ts`, `untrustworthyRebuildReason`) reads `refusal` and `degrade_reasons`, never `inputs`.
  - The `compose_empty` and `compose_empty_blocked` records already carried this field earlier in the phase, so the cross-runtime pin does not move.
- **New closed token.** `ledger_level_negative` is a member of `NO_CAPITAL_REFUSAL_REASONS`, and the whole-set pin was updated. No `DegradeReason` or `DeriveRefusal` member moved, and no TS or SQL mirror of the set exists (grep over `src/`, `supabase/` and `scripts/`).

**Re-scan of the full phase diff.** It found no new MEDIUM+ production defect.

- `read_tiny_base_days` raises `TypeError` and `ValueError`. Both are inside the `except (ValueError, TypeError, KeyError)` corrupt-input arm (`job_worker.py:17598`), so neither escapes as a transient.
- The apply-loop revert restores every map the loop writes. `tiny_base_days_by_key` and `writer_basis_raw` are never written by the loop.
- The post-compose merge counts each key once per route.

Necessity was assessed using `necessity-review.md`. No finding qualifies: every new guard sits on stored `key_inputs` data, which is a trust boundary.

**The PROD re-measure was not repeated in this review.** The CONTEXT note records it: both live MT5 exits sit at a level of -1.6e-11 under the two-sided predicate.

## Round 1 disposition

| Item | Status | Evidence |
|---|---|---|
| CR-01: the one-sided ledger proof accepts a far-negative ledger | **Fixed** (87463035f) | `job_worker.py:17839-17841` refuses `level < -DUST_NAV_FLOOR` as `ledger_level_negative`. Reverting the branch turns both `[-20000.0]` and `[-500000.0]` arms of `test_no_capital_exit_mt5_ledger_far_below_zero_is_refused_as_ledger_level_negative` RED. Mutating `<` to `<=` turns `test_no_capital_exit_mt5_ledger_exactly_at_minus_the_dust_floor_still_exits` RED. The docstring and the CONTEXT line-69 rationale are corrected. |
| WR-01: an empty writer basis counts as proof | **Fixed** (681a307d8) | `job_worker.py:16753`: `if basis is None or not basis[1]: return None`. Reverting it turns `test_no_capital_exit_mt5_empty_basis_lists_are_refused_as_ledger_basis_absent` and `test_no_capital_ledger_level_is_pure_over_the_stored_basis` RED. |
| IN-01 / SFH M1: the catch-all handlers emit no Sentry event | **Fixed** (041e42e0d) | One class-only warning event in each handler. Replacing either capture with a no-op turns its own parametrised arm of `test_no_capital_exit_a_candidate_fault_reaches_sentry_as_one_class_only_event` RED. The test asserts exactly one call, `level="warning"`, the exact tag set, and that no key id, exception text or amount is in the message. No leak (see Summary). |
| SFH M2: `_compose_refused` dropped the run's no-capital counts | **Fixed** (6dc860523) | `job_worker.py:18306-18309` passes `no_capital_refusal_field(no_capital_refusals) or None`. Reverting it turns `test_no_capital_exit_a_fault_in_the_stored_input_compose_keeps_todays_path` RED. Its control asserts the field is absent when no fallback ran. See IN-B for the part left unpinned. |
| IN-02: a working no-capital key with inputs and no returns is uncounted | **Closed by decision** | The CONTEXT `[Review round 1, 2026-11-25]` entry excludes it by design: it never reaches selection, and it is the existing `no_anchor` + `missing_series` route. |
| IN-03: only the D-10 refusal gets a log line | **Open (Info)** | Not changed. Under repo policy Info items are recorded, not fixed. |
| IN-04: dead placeholder in a test helper | **Open (Info)** | Still at `test_allocator_equity_inception.py:379-380`. The file has no commits since round 1. |
| IN-05: the "listed day inside the window" arm cannot fail on its premise | **Open (Info)** | Not changed (same file, no commits since round 1). |

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: The ledger band's width is unpinned: a 10x wider band, on either side, passes every test

**File:** `analytics-service/services/job_worker.py:17836-17841` (the gate). The tests are in `analytics-service/tests/test_derive_allocator_equity_job.py`, `4366-4418` and `4350-4362`.

**Issue:**

- The two-sided band is the whole of the NOCAP-01 proof on MT5. It is a data-integrity gate: a ledger outside the band that passes lets a funded key exit while the book reads `is_trustworthy=True`.
- The only arms near an edge are:
  - inside the lower edge: exactly `-DUST_NAV_FLOOR` exits (`:4406`);
  - far outside it: -20,000 and -500,000 (`:4385`);
  - far outside the upper edge: the 60,000 tracer and the `'MT5'` case arm.
- Nothing pins either edge from just outside, and nothing pins the upper edge's inclusion.
- Mutants run against the three phase suites, all passing (241 passed, the scratch-only TS/SQL test deselected):

| Mutant | Effect | Result |
|---|---|---|
| `_nc_ledger_level > DUST_NAV_FLOOR` becomes `> 10 * DUST_NAV_FLOOR` | a +500 ledger proves an account empty | survives |
| `_nc_ledger_level < -DUST_NAV_FLOOR` becomes `< -10 * DUST_NAV_FLOOR` | a -500 ledger proves an account empty | survives |
| `> DUST_NAV_FLOOR` becomes `>= DUST_NAV_FLOOR` | a ledger of exactly +100.0 is refused | survives |

- A later refactor could swap in a different constant, for example `EMPTIED_RESTART_FLOOR_USD`, or a relative tolerance, and every test would stay green. This is the "a test that cannot fail when the business logic changes" class (CLAUDE.md Rule 9, and the repo's "data-integrity gates must be able to fail" rule).

**Fix:** Add three arms with `_nc_mt5_ledger_book`, which already exists. Each arm's outcome
below was checked against HEAD with a probe:

```python
@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("ledger", "refused"),
    [
        # upper edge, inclusive: passes the ledger gate. A +100 ledger against a 0.0 terminal implies
        # a negative start, so the replay then refuses it (probe at HEAD: {"replay_refused": 1}).
        # The arm pins that the LEDGER gate did not refuse it.
        (DUST_NAV_FLOOR, {"replay_refused": 1}),
        (DUST_NAV_FLOOR + 0.01, {"ledger_level_funded": 1}),       # just above: funded
        (-DUST_NAV_FLOOR - 0.01, {"ledger_level_negative": 1}),    # just below: negative
    ],
)
async def test_no_capital_exit_mt5_ledger_band_edges(ledger, refused) -> None:
    d = _BTC_DAYS
    payload = await _compose_no_capital_book(_nc_mt5_ledger_book(flows={d[3]: ledger}))
    assert _nc_refused(payload) == refused
```

Probe at HEAD: +100.0 gives `{"replay_refused": 1}`, +100.01 gives `{"ledger_level_funded": 1}`
and -100.01 gives `{"ledger_level_negative": 1}`. The same results hold when the +ledger sits in
the basis P&L on day 1 instead of a flow. Each arm goes RED under its mutant above: `>=` turns the
first arm into `ledger_level_funded`, and each 10x widening turns its own just-outside arm into
`replay_refused` or an exit.

## Info

- **IN-A: only the both-empty shape of WR-01 is pinned.** Weakening the fix to `not basis[0] and not basis[1]` survives the tests. The weakened form would accept a basis with flows present and an empty day P&L, which the writer never stores (`job_worker.py:16753`). An arm with `({d[3]: -50.0}, {})` asserting `is None` would pin the stated rule ("an empty day P&L is no basis").
- **IN-B: M2 pins only `candidate_exception` on the refusal record.** A mutant that drops selection and loop counts (`funded_terminal`, `ledger_level_*` and others) from `_compose_refused`'s field, keeping only `compose_reverted` and `candidate_exception`, survives. Those counts are diagnostic, not user-facing. A compose refusal with one `funded_terminal` key and no candidate would pin it.
- **IN-C: a stale test name.** `test_no_capital_refusal_reasons_are_the_eleven_plan_01_to_03_tokens` (`test_derive_allocator_equity_job.py:5227`) now asserts twelve tokens, including the round-2 `ledger_level_negative`.

---

_Reviewed: 2026-11-25T11:36:24Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

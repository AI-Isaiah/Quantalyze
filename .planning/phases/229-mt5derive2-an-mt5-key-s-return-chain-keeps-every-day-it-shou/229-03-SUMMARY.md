---
phase: 229-mt5derive2-an-mt5-key-s-return-chain-keeps-every-day-it-shou
plan: 03
subsystem: analytics-service
tags: [mt5, allocator-equity, key_inputs, writer-basis, degrade-reasons]
requires: []
provides:
  - "writer_basis_withheld: a closed branch token on the key_inputs payload of a timed MT5 key that stores no writer basis"
  - "WRITER_BASIS_WITHHELD_TOKENS and read_writer_basis_withheld (allocator_equity_derive.py)"
  - "the compose blocks the book as key_inputs_mismatch while any key carries the token"
affects: [allocator_equity compose, derive_broker_dailies epilogue]
tech-stack:
  added: []
  patterns: ["present-only additive jsonb token, written by the derive and read by the compose (no migration)"]
key-files:
  created: []
  modified:
    - analytics-service/services/allocator_equity_derive.py
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_allocator_equity_writer_basis.py
key-decisions:
  - "Block on the stored token, never on an absent basis: rows written before 229 carry no token and are never blocked"
  - "read_writer_basis left byte-unchanged (sha256 prefix acd576aa4b645c00 before and after); the reader is a new sibling"
requirements-completed: [MT5D-07]
duration: 25min
completed: 2026-11-24
status: complete
actuals:
  tokens: 8800
  tasks: 2
  commits: 2
commits: 2
plan_head_before: 13872bbc0ab2258927b3c100d92c004ab2095825
plan_head_after: 0dc5d243a95c22549d7d9c4efdae1aaec5286cab
---

# Phase 229 Plan 03: a timed MT5 key with no writer basis is blocked by name (MT5D-07)

A timed MT5 key that reaches the derive's store gate without a writer basis now stores a closed branch token (`writer_basis_withheld`), and the allocator compose raises the blocking `key_inputs_mismatch` for its book, so the silent legacy-roll shape no longer composes as trustworthy.

## Tasks

| Task | Name | Commit |
|---|---|---|
| 1 (tracer) | end to end, a timed BTC MT5 key with a trailing unpriced close is blocked as key_inputs_mismatch with its branch named | `31cab69d4` feat(229-03): a timed MT5 key with no writer basis is blocked by name (MT5D-07) |
| 2 | the departed and stitch-source sites, the no-history removal, the token census, the reader arms and every unchanged pin | `0dc5d243a` feat(229-03): the departed and stitch-source sites honour the withheld token (MT5D-07) |

## What changed

- `allocator_equity_derive.py`: `WRITER_BASIS_WITHHELD_TOKENS` (the eight tokens, each branch commented) and `read_writer_basis_withheld` after `read_writer_basis`. Absent or null returns None; a non-empty string returns unchanged (an unknown token still blocks); anything else raises `ValueError` with no stored value echoed.
- `job_worker.py`: defaulted trailing `_NativeKeyUsd.writer_basis_reason`; `_convert_native_key_to_usd` names `no_usd_return_day`, `interior_hole`, `unpriced_days_without_interior_hole`; `_native_key_usd_writer_basis` now returns the basis tuple or a token string (`no_levels_or_pnl`, `first_day_unpriceable`, `calendar_day_without_close`, `no_carried_level`); derive local `_writer_basis_reason` declared beside `_composed_day_pnl_usd`; an `elif venue == "mt5" and timed_days > 0` branch at the store gate writes the token (fallback `store_gate_unmet`) with one counts-only warning; the compose reads the token at all three sites (counted, departed, stitch source), drops it for a key the no-history rule removes, logs one counts-only warning (key count plus a histogram over the closed set, unknown strings counted as `unknown`), and adds `(DegradeReason.KEY_INPUTS_MISMATCH, bool(withheld_by_key))` to `_compose`'s reason list.
- No migration: the field is additive and present-only in the `allocator_equity_derived.payload` jsonb, rewritten whole on every derive, so it clears itself on the next derive that stores a basis.

## Tracer: HEAD RED reading (unedited production code)

The fixture is in `_btc_silent_timed_ledger` (deposit day 0, a trade day 1, a small timed deposit 09:00 then a tiny position 10:00-15:00 on day 2, flow-free trades on days 3 and 4, closes for every day except 10-07). Two deviations from the RESEARCH recipe were needed to reproduce the silent shape, see Deviations.

Composing the unedited derive's payload with its own stored returns (probe, not committed):

```
HEADREAD [] True ['2026-10-07', '2026-10-08'] [] None
   (degrade_reasons, is_trustworthy, unpriced_days, segment_terminals, composed_day_pnl)
```

The committed tracer on unedited code failed on its first behavioural assertion:

```
>       assert payload.get("writer_basis_withheld") == "unpriced_days_without_interior_hole"
E       AssertionError: assert None == 'unpriced_days_without_interior_hole'
1 failed in 5.05s
```

(Before the fixture was shrunk, a 0.5 BTC timed deposit gave `HEADREAD ['inception_unreconciled'] False`: the incidental block of RESEARCH Pitfall 1, which is why the tracer asserts `key_inputs_mismatch` by name.)

## PROOF-01 (neuter, RED, restore by cp and cmp from a byte backup outside the repo, GREEN)

Task 1 tracer `test_a_timed_btc_key_with_a_trailing_unpriced_close_is_blocked_by_name`:

```
=== PROOF-01 (a): drop the store-gate token write ===
>       assert payload.get("writer_basis_withheld") == "unpriced_days_without_interior_hole"
E       AssertionError: assert None == 'unpriced_days_without_interior_hole'
E        +  where None = <built-in method get of dict object at 0x119f77880>('writer_basis_withheld')
cmp: restored byte-identical (silent)
=== PROOF-01 (b): drop the compose reason row ===
>       assert "key_inputs_mismatch" in book["degrade_reasons"], book["degrade_reasons"]
E       AssertionError: []
E       assert 'key_inputs_mismatch' in []
1 failed in 4.66s
cmp: restored byte-identical (silent)
=== GREEN ===
1 passed in 4.63s
```

Task 2:

```
=== PROOF-01 (c): drop the departed-site recording ===
E       assert 'key_inputs_mismatch' in ['classified_rotation', 'inception_unreconciled', 'window_truncated']
FAILED tests/test_allocator_equity_writer_basis.py::test_a_departed_or_stitch_source_key_with_the_token_blocks_the_book[departed]
1 failed, 2 passed in 5.45s
cmp: restored byte-identical (silent)
=== PROOF-01 (d): drop the stitch-source recording ===
E       assert 'key_inputs_mismatch' in []
FAILED tests/test_allocator_equity_writer_basis.py::test_a_departed_or_stitch_source_key_with_the_token_blocks_the_book[stitch-source]
1 failed, 2 passed in 4.89s
cmp: restored byte-identical (silent)
=== PROOF-01 (e): drop the no-history removal discard ===
E       assert 'key_inputs_mismatch' not in ['key_inputs_mismatch']
FAILED tests/test_allocator_equity_writer_basis.py::test_a_removed_no_history_key_with_the_token_does_not_block_the_book
1 failed in 4.76s
cmp: restored byte-identical (silent)
=== GREEN ===
4 passed in 5.06s
```

## Token census

| Token | Reached by | How driven |
|---|---|---|
| `no_usd_return_day` | closes on no return day, `priced_through` None | `_convert` in `test_every_writer_basis_branch_names_a_closed_token` |
| `interior_hole` | a priced event follows an unpriced gap | five-day hand-built key, closes 4,5,7,8; also end to end by the holed timed BTC derive (payload carries it) |
| `unpriced_days_without_interior_hole` | unpriced days with nothing priced after | five-day key, closes 4,5,6,8; end to end by the tracer |
| `no_levels_or_pnl` | empty levels and P&L | `_native_key_usd_writer_basis` called directly |
| `first_day_unpriceable` | first NAV day absent from the P&L index | direct call |
| `calendar_day_without_close` | a calendar day inside the range with no close | direct call |
| `no_carried_level` | unreachable by construction (`first = min(levels)`) | member of the closed set only, asserted |
| `store_gate_unmet` | store-gate fallback when no branch named itself | member of the closed set only, asserted |

Branches H2 and H3 are unit-tested on the pure function, not driven end to end (flagged assumption A-03-2).

## Verification

- `tests/test_allocator_equity_writer_basis.py tests/test_derive_allocator_equity_job.py tests/test_allocator_equity_dropped_day_pnl.py tests/test_mt5_derive_branch.py tests/test_nav_marks_compose_roundtrip.py`: 449 passed.
- mypy strict (CI command from 229-VALIDATION.md): `Success: no issues found in 142 source files`.
- vitest literal pins `tiny-base-literal-pin` and `options-cash-basis-literal-pin`: 2 files, 21 tests passed.
- `read_writer_basis` sha256 prefix `acd576aa4b645c00`, identical to the plan's HEAD value.
- Acceptance greps: `def read_writer_basis_withheld` 1; `WRITER_BASIS_WITHHELD_TOKENS` 2; `_key_inputs_payload["writer_basis_withheld"]` 1; `writer_basis_reason` 11; `read_writer_basis_withheld(` 3; the two named tests 1 each.
- The stitched-MT5 legacy test and `test_the_writer_basis_adds_no_degrade_reason` are unedited and pass. Holed timed key still blocks and now carries `interior_hole`; holed untimed key and the USD MT5 key carry no token; the hole-free timed BTC key stores its basis and carries no token.

## Accepted limit (A-03-1, marks era)

"Timed" is `flow_timing_timed_days > 0` from the realized combine, counted before nav marks. A key whose timed days all fall inside the nav-marks era is blocked although its marked rows are invertible. A conservative over-block that clears itself the day the basis returns. Recorded, not fixed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in plan fixture] The RESEARCH fixture did not reproduce the silent shape**
- **Found during:** Task 1 (RED run)
- **Issue:** with "nothing on days 3 and 4" no native return rows exist for those days, so `unpriced_days` was empty; and with the 0.5 BTC timed deposit the book was blocked incidentally by `inception_unreconciled` (the plan's own Pitfall 1 warning).
- **Fix:** flow-free 0.001 BTC trades on days 3 and 4 so those days carry return rows the missing 10-07 close leaves unpriced, and a 0.01 BTC timed deposit with a 0.0005 BTC timed trade on day 2. The test asserts the preconditions (unpriced days, empty terminals, no basis) and the reason by name.
- **Files modified:** analytics-service/tests/test_allocator_equity_writer_basis.py
- **Commit:** 31cab69d4

**2. [Rule 3 - test shape] Test names consolidated to the plan's artifact table**
- The departed and stitch-source arms are one parametrized `test_a_departed_or_stitch_source_key_with_the_token_blocks_the_book` (sites departed, stitch-source, counted) and the reader arms one parametrized `test_the_withheld_token_reader`, matching the plan's artifacts. Two extra tests added: a corrupt-token disposal and an unknown-token census (counted as `unknown`, never echoed).
- **Commit:** 0dc5d243a

The plan's Task 1 instructed the departed and stitch-source reads in Task 2; the counted-site read landed in Task 1 and the other two in Task 2 as specified, so the Task 1 commit alone would have let a removed no-history key block a book (fixed one commit later; no release between them).

## Known Stubs

None.

## Threat Flags

None. The two new log lines carry closed token names and counts only (asserted in tests: no login, no key id, no allocator id, no ISO day, no amount; unknown stored strings are counted as `unknown`).

## Self-Check: PASSED

- `analytics-service/services/allocator_equity_derive.py`, `analytics-service/services/job_worker.py`, `analytics-service/tests/test_allocator_equity_writer_basis.py`: FOUND (modified).
- Commits `31cab69d4` and `0dc5d243a`: present on `worktree-agent-229-03` after `13872bbc0`.
- STATE.md and ROADMAP.md: not modified.

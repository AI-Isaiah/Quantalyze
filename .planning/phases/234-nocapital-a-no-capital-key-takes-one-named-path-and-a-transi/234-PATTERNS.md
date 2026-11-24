# Phase 234: NOCAPITAL - Pattern Map

**Mapped:** 2026-11-24
**Files analyzed:** 9 (3 source files modified, 1 fixture-pinned helper surface, 5 test files modified or extended)
**Analogs found:** 9 / 9 (every file is a modification of, or sits beside, an existing sibling; no file is new)

All paths are relative to `analytics-service/`. Every analog is git-tracked source (`git ls-files` checked for the three services, the four test files and `tests/fixtures/derive_refusal_rows.json`). Anchors are cited by symbol; the lines named in RESEARCH.md drift with S2 edits, so re-resolve by symbol at plan time (the `plan-anchor-verify` CI job re-resolves every `file:line` a PLAN asserts).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `services/job_worker.py` : `run_derive_allocator_equity_job` (candidate selection, apply loop, revert, compose call, empty-curve refusal, key-inputs read loop) | service (worker job) | batch / transform | itself: the plan-09 candidate block + `except NavReconstructionError` revert | exact (extend in place) |
| `services/job_worker.py` : new `_no_capital_ledger_level` helper | utility (pure) | transform | `_no_capital_exit_consumes_only_dust`, `_no_capital_level_on_last_return_day` | exact |
| `services/job_worker.py` : `_persist_refusal` (forward the counts) | service | CRUD (upsert) | itself (`extra_reasons` pass-through) | exact |
| `services/allocator_equity_compose.py` : `compose_allocator_equity` (segment loop, replay loop, `fell_back`, payload `inputs`, new `tiny_base_days_by_key` param) | service (pure compose) | transform | itself: `fell_back` / `fell_back_refused` / `fell_back_blocking` block | exact |
| `services/allocator_equity_derive.py` : `replay_key_equity` (`stated_tail_days` kwarg, `out_of_window_flows`) | utility (pure replay) | transform | itself: existing optional kwargs (`dropped_day_pnl`, `realized_terminal`, `writer_flows`) | exact |
| `services/allocator_equity_derive.py` : `read_tiny_base_days`, `LEDGER_PROOF_VENUES`, `NO_CAPITAL_REFUSAL_REASONS`, `refusal_payload` kwarg | utility / config | transform | `read_dropped_day_pnl`; `FULL_HISTORY_VENUES`; `DeriveRefusal`; `refusal_payload` | exact / role-match |
| `tests/test_allocator_equity_no_capital_exit.py` | test (compose level) | transform | itself: `_hole_candidate_book`, `_today`, `_without_clock` | exact |
| `tests/test_derive_allocator_equity_job.py` | test (job level, `_FakeSupabase`) | request-response | itself: `_nc_assemble`, `_nc_payload`, `_compose_no_capital_book`, `test_no_capital_exit_compose_refusal_reverts_the_candidates_and_keeps_the_row` | exact |
| `tests/test_allocator_equity_inception.py` | test (replay level) | transform | `test_post_window_flow_keeps_out_of_window_flow_even_with_a_clean_opening` | exact |
| `tests/test_derive_refusal_rows.py` + `tests/fixtures/derive_refusal_rows.json` | test + shared fixture | transform | itself (must stay green, not edited) | exact |

## Pattern Assignments

### `services/job_worker.py` : `_no_capital_ledger_level` (utility, transform) - NOCAP-01

**Analog:** `_no_capital_exit_consumes_only_dust` (and its sibling `_no_capital_level_on_last_return_day`), module-level pure helpers directly above `run_derive_allocator_equity_job`.

**Shape to copy:** module-level, no I/O, a docstring that names the decision id (166.3.1 D-xx), what it decides, and "Pure over stored numbers"; a function-local `from services.nav_twr import DUST_NAV_FLOOR` where the constant is needed (inside the job, `DUST_NAV_FLOOR` is already imported at function scope, so the apply loop uses that name and the helper needs none).

```python
def _no_capital_level_on_last_return_day(
    terminal_day: str,
    terminal_level: float,
    last_return_day: str,
    flow_by_day: Mapping[str, float],
    pnl_by_day: Mapping[str, float],
) -> float:
    """166.3.1 D-08 A3: ... Applying it latest day first, over the stored numbers only, gives the
    level on ``L``; nothing is invented. ... A non-finite result is not handled here: the replay
    refuses it ..."""
    level = terminal_level
    for day in sorted({d for d in (*flow_by_day, *pnl_by_day) if last_return_day < d <= terminal_day}, reverse=True):
        level = level - flow_by_day.get(day, 0.0) - pnl_by_day.get(day, 0.0)
    return level
```

**Operand type** (copy from `read_writer_basis` in `allocator_equity_derive.py`): returns `tuple[dict[str, float], dict[str, float]] | None` = `(flows_by_day, pnl_by_day)`, each `{ISO day: USD}`. The job holds it per key in `writer_basis_raw` (declared `dict[str, tuple[dict[str, float], dict[str, float]]]`, filled in the key-inputs read loop by `writer_basis_raw[api_key_id] = _basis`). Use `writer_basis_raw.get(_k)`, the key's OWN row. Do NOT use `writer_basis_by_key` (it holds `ExternalFlow` lists and carries the stitched joined basis for kept keys).

**Formula** (RESEARCH "NOCAP-01"): `sum(flows.values()) + sum(pnl.values())`; return `None` for a missing basis or a non-finite total; `math` is imported in `job_worker.py` (verify at edit time). One-sided `<= DUST_NAV_FLOOR`; state in the docstring that the lower side is caught downstream by the replay's zero-start check (`inception_unreconciled`).

---

### `services/job_worker.py` : candidate selection + apply loop (service, batch) - NOCAP-01 / NOCAP-03

**Analog:** the existing block in `run_derive_allocator_equity_job` that opens with the comment "D-08 (option A) - a NO-CAPITAL key with real history" and builds `no_capital_candidates`, then the apply loop `for _k in sorted(no_capital_candidates):` after `no_capital_stored = _AllocatorKeyInputs(...)`.

**Selection (A2 gate) to extend:** today a single boolean `if (...)` ends with `and _nc_terminal[1] <= DUST_NAV_FLOOR`. Restructure so the terminal test is evaluated after the other conditions and a failure is COUNTED (Pitfall 3: count only a key that would otherwise be a candidate):

```python
_nc_reason = null_anchor_reasons.get(api_key_id)
_nc_terminal = realized_terminal_by_key.get(api_key_id)
if (
    anchors_by_key.get(api_key_id) is None
    and _nc_reason in _NO_CAPITAL_ANCHOR_REASONS
    and api_key_id in last_return_day
    and api_key_id not in departed_end_by_key
    and _nc_terminal is not None
    # A2: ... A live read that says empty over a funded terminal is a transient zero ...
    and _nc_terminal[1] <= DUST_NAV_FLOOR
):
    no_capital_candidates[api_key_id] = (str(_nc_reason), _nc_terminal)
```

(NOCAP-01 adds `-DUST_NAV_FLOOR <= terminal` here as a second counted refusal, `negative_terminal`, for every venue.)

**Refusal counter precedent:** today the apply loop keeps a bare `no_capital_refused = 0` int and the D-10 arm does `no_capital_refused += 1; continue`, followed by a counts-only warning (`"%d no-capital key(s) of allocator %s keep dropped_key ..."`). NOCAP-03 replaces the int with one counts dict keyed by the closed `NO_CAPITAL_REFUSAL_REASONS` set; keep the warning counts-only.

**Apply-loop gate placement** (RESEARCH "Code Examples", before the D-10 call): MT5 venue read as `str(rows_by_id[_k].get("exchange") or "").strip().lower()` (same expression as the `full_history_keys` comprehension in `_compose`, and `rows_by_id` exists at function scope), membership in `LEDGER_PROOF_VENUES`.

**Revert-state precedent** (all eight maps; Pitfall 2): the snapshot is `_AllocatorKeyInputs(dict(anchors_by_key), dict(null_anchor_reasons), dict(flows_by_key), dict(dropped_pnl_by_key), dict(realized_terminal_by_key), dict(writer_basis_by_key), dict(departed_end_by_key), {})` taken when `no_capital_candidates` is non-empty. The loop mutates `anchors_by_key`, `null_anchor_reasons`, `realized_terminal_by_key`, `departed_end_by_key`, `no_capital_exit_by_key`, and rebinds entries of `flows_by_key`, `dropped_pnl_by_key`, `writer_basis_by_key`. A restore is `clear()` + `update(stored.<field>)` per map plus `no_capital_exit_by_key.clear()`.

---

### `services/job_worker.py` : NOCAP-02 exception arms (service, batch)

**Analog:** the existing compose try/except in `run_derive_allocator_equity_job` (`try: payload = _compose(_AllocatorKeyInputs(...))` ... `except NavReconstructionError as exc:`). Keep that arm first and untouched in behaviour; add a sibling arm and a wrapper around the apply loop.

```python
    except NavReconstructionError as exc:
        if no_capital_stored is None or not no_capital_exit_by_key:
            return await _compose_refused(exc)
        # 166.3.1 plan 09 (D-08, T-166.3.1-39): ... compose ONCE more on the inputs exactly as stored ...
        logger.warning(
            "derive_allocator_equity: compose refused (%s) with %d no-capital candidate(s) in "
            "play for allocator %s - re-composing once with them reverted to %s",
            type(exc).__name__, len(no_capital_exit_by_key), allocator_id, DegradeReason.DROPPED_KEY.value,
        )
        try:
            payload = _compose(no_capital_stored)
        except NavReconstructionError as exc_again:
            return await _compose_refused(exc_again)
```

New arm: `except Exception as exc:  # noqa: BLE001` (repo convention, 62 of 80 broad catches in this file carry the trailing `# noqa: BLE001`), `if no_capital_stored is None or not no_capital_exit_by_key: raise`, then the same revert; the nested stored recompose keeps `except NavReconstructionError -> _compose_refused` and lets anything else propagate. Log `type(exc).__name__` and counts only.

**Scope limit:** wrap only the apply loop and the compose call. The DB calls between them (`db_execute(_delete_orphan)`, the markers re-read) must keep bubbling as transient. `BaseException` is never caught.

**Dispatcher fact for the retry test:** `dispatch` wraps the handler in `except Exception` and calls `classify_exception`; non-listed exceptions end `("unknown", ...)` which is retried (docstring of the module: "everything else -> unknown (retried by default)").

---

### `services/job_worker.py` : key-inputs read loop + `_compose` + empty-curve refusal (service) - out-of-window threading / NOCAP-03

**Read-loop analog** (counted-key branch, `key_inputs_ids.add(api_key_id)` onward): one stored field per line, each through a reader from `allocator_equity_derive`:

```python
dropped_pnl_by_key[api_key_id] = read_dropped_day_pnl(payload)
_terminal = read_realized_terminal(payload)
if _terminal is not None:
    realized_terminal_by_key[api_key_id] = _terminal
_basis = read_writer_basis(payload)
if _basis is not None:
    writer_basis_raw[api_key_id] = _basis
```

Add `tiny_base_days_by_key[api_key_id] = read_tiny_base_days(payload)` here (and in the departed-key branch beside `writer_basis_raw[api_key_id] = _departed_basis`, RESEARCH Open Question 5). Add `read_tiny_base_days` to the function-local `from services.allocator_equity_derive import (...)` list at the top of the function. The literal read key `"tiny_base_days"` must equal the writer's (`_key_inputs_payload["tiny_base_days"] = _tiny_listed`, key-mode derive); `tiny-base-literal-pin.test.ts` regexes the WRITER line, so do not touch it.

**`_compose` analog:** one `compose_allocator_equity(...)` call carrying one keyword per concern with a dated comment, e.g. `segment_terminals_by_key=segment_terminals_by_key or None,` then `no_capital_exit_by_key=inputs.no_capital_exit or None,`. Add `tiny_base_days_by_key=tiny_base_days_by_key or None,` the same way (outside `inputs`: it is not mutated by the candidate rule, so it is not part of `_AllocatorKeyInputs`).

**Counts merge analog** (after the compose, before the empty-curve branch):

```python
if departed_basis_unchecked:
    payload["inputs"]["departed_writer_basis_unchecked_keys"] = len(departed_basis_unchecked)

if absent_stitched_accounts:
    payload["inputs"]["writer_basis_missing_members"] = absent_members
    payload["inputs"]["writer_basis_stitched_members"] = absent_stitched_members
```

Merge the job's own refusal counts into `payload["inputs"]["no_capital_exit_refused"]` (sum per reason with the compose's, sorted keys, written only when non-empty).

**Refusal-record analog (must carry the field, RESEARCH "NOCAP-03"):** the empty-curve branch, `if not (payload.get("curve") or []):`, ends `await _persist_refusal(DeriveRefusal.COMPOSE_EMPTY_BLOCKED.value, extra_reasons=_blocking)`. Pass the merged counts as a new optional kwarg on both `_persist_refusal` calls in that branch. `_compose_refused` does not carry it (record that reason in the plan).

**`_persist_refusal` analog:** nested helper that builds `refusal_payload(token, composed_at=..., extra_reasons=extra_reasons)` and upserts with `on_conflict="allocator_id,kind"`; add `no_capital_exit_refused: Mapping[str, int] | None = None` and forward it.

---

### `services/allocator_equity_compose.py` : `compose_allocator_equity` (service, transform) - NOCAP-03 / NOCAP-04 / out-of-window

**Analog:** the `fell_back` machinery, immediately after the "Per-key $-equity backward replay" comment.

**Fall-back core to extend** (copy this exactly, add one counts dict beside the two existing tallies):

```python
no_capital_exit = dict(no_capital_exit_by_key or {})
per_key_equity: dict[str, KeyEquity] = {}
fell_back_refused = 0
fell_back_blocking: set[DegradeReason] = set()
fell_back: list[str] = []
for k in anchored_keys:
    owner = parent.get(k, k)
    if owner in fell_back:
        continue  # a sibling unit already took the key back; this unit leaves with it
    try:
        key_equity = replay_key_equity(
            anchored_returns[k], anchored_flows[k], unit_anchors[k],
            history_reaches_inception=k in history_first,
            dropped_day_pnl=dropped_pnl.get(k),
            realized_terminal=realized_terminal.get(k),
            writer_flows=writer_basis[k][0] if k in writer_basis else None,
            writer_day_pnl=writer_basis[k][1] if k in writer_basis else None,
        )
    except NavReconstructionError:
        if owner not in no_capital_exit:
            raise
        fell_back_refused += 1
        fell_back.append(owner)
        continue
    if owner in no_capital_exit and (key_equity.equity is None or not _is_trustworthy(key_equity.degrade_reasons)):
        fell_back_blocking |= key_equity.degrade_reasons
        fell_back.append(owner)
        continue
    per_key_equity[k] = key_equity
```

- NOCAP-03: count `replay_refused` where `fell_back_refused += 1`, `blocking_reason` where `fell_back_blocking |= ...`, per owner key (the `fell_back` list is already per owner).
- Out-of-window: add `stated_tail_days=(tiny_base_days_by_key or {}).get(k)` to the `replay_key_equity(...)` call. Segment units (`k#hole0`) have no entry, so only the unit carrying the key's own id gets the list.
- The counts-only warning that follows (`"compose: %d no-capital candidate(s) fell back to %s ..."`, counts and reason classes only, T-166.3.1-34) is unchanged.

**NOCAP-04 segment loop (the residue):** the missing-terminals branch of the interior-hole loop today:

```python
terminals = (segment_terminals_by_key or {}).get(k, {})
if any(e not in terminals for e in ends):
    # The writer should have stored the level on each of these days. ...
    reasons.add(DegradeReason.KEY_INPUTS_MISMATCH)
    logger.warning("compose: a key has %d interior unpriced hole(s) but no stored level on %d of ...", ...)
    continue
```

Fix shape (RESEARCH "NOCAP-04"): hoist `no_capital_exit = dict(no_capital_exit_by_key or {})` above this loop; in this branch `if k in no_capital_exit:` add `k` to a local `segment_refused` set, skip the reason and the log, `continue`; else today's behaviour unchanged. In the replay loop, before `replay_key_equity`, `if owner in segment_refused: fell_back.append(owner); counts["segment_terminals_missing"] += 1; continue`. The existing `for owner in fell_back:` cleanup (removes units, resets `unit_anchors[owner] = None`, `del no_capital_exit[owner]`) does the rest.

**Payload field analog** (benign additive field written only when non-empty):

```python
"inputs": {"n_keys": len({parent[k] for k in anchored_keys}), "anchor_asof": anchor_asof, "composed_at": datetime.now(timezone.utc).isoformat()},
...
if no_capital_exited:
    # Additive, present only when a no-capital key exited (an older reader never sees it).
    payload["no_capital_exited_keys"] = no_capital_exited
```

Write `payload["inputs"]["no_capital_exit_refused"] = {reason: count, ...}` (sorted keys) after the dict is built and only when the counts are non-empty. It must not enter `reasons` or `flag_tokens` (so `is_trustworthy` and `degrade_reasons` are untouched).

---

### `services/allocator_equity_derive.py` : `replay_key_equity` (utility, transform) - out-of-window ruling

**Analog:** the function's own optional keyword-only parameters:

```python
def replay_key_equity(
    returns: pd.Series, flows: Sequence[Any] | None, anchor: float | None, *,
    history_reaches_inception: bool = False,
    dropped_day_pnl: Mapping[str, float] | None = None,
    realized_terminal: tuple[str, float] | None = None,
    writer_day_pnl: Mapping[str, float] | None = None,
    writer_flows: Sequence[Any] | None = None,
) -> KeyEquity:
```

Add `stated_tail_days: Collection[str] | None = None` last (default none, every existing caller unchanged). Import `Collection` from `collections.abc` or `typing` per the file's existing imports.

**Count to change** (the single `out_of_window_flows` computation, after the `ret_days = sorted(r)` / `lo, hi = ret_days[0], ret_days[-1]` lines; `fbd` is the writer flows in writer mode):

```python
out_of_window_flows = sum(1 for fd in fbd if fd < lo or fd > hi) - len(opening_run)
```

becomes `sum(1 for fd in fbd if fd < lo or (fd > hi and fd not in stated)) - len(opening_run)` with `stated = frozenset(stated_tail_days or ())`. `fd < lo` and an unstated `fd > hi` still count; no other gate moves. The flag is exposed by `if out_of_window_flows: flags["out_of_window_flows"] = out_of_window_flows` (unchanged).

---

### `services/allocator_equity_derive.py` : `read_tiny_base_days`, constants, `refusal_payload` kwarg (utility/config)

**`read_tiny_base_days` analog:** `read_dropped_day_pnl`: `payload.get(...)` absent or null is the old row (`{}`/empty), days validated with `date.fromisoformat(str(...)).isoformat()`. Unlike it, RESEARCH recommends a TOLERANT reader (it only relaxes a gate): return an empty `frozenset` on anything malformed and log a count-only warning, never echo a stored string. This is a design call (RESEARCH A5); the strict style raises `ValueError`/`TypeError` so the job's `except (ValueError, TypeError, KeyError)` -> `_permanent_corrupt_input`. State the choice in the docstring.

```python
def read_dropped_day_pnl(payload: Mapping[str, Any]) -> dict[str, float]:
    raw = payload.get("dropped_day_pnl")
    if raw is None:
        return {}
    out: dict[str, float] = {}
    for row in raw:
        day = date.fromisoformat(str(row["utc_day_iso"])).isoformat()
        ...
```

**`LEDGER_PROOF_VENUES` analog:** `FULL_HISTORY_VENUES: frozenset[str] = frozenset({"deribit", "mt5"})` (just above `replay_key_equity`'s docstring region, with its explanatory comment block). Add `LEDGER_PROOF_VENUES: frozenset[str] = frozenset({"mt5"})` beside it with a comment that the stored terminal is the live balance for these venues. Add a pin test `LEDGER_PROOF_VENUES == {"mt5"}`.

**`NO_CAPITAL_REFUSAL_REASONS` analog:** `DeriveRefusal(str, Enum)` documents a closed set with a comment per member. RESEARCH proposes a `Final[frozenset[str]]` (NOT a `DegradeReason` or `DeriveRefusal` member: `test_derive_refusal_rows.py` pins both sets against the shared fixture the TS reader test and the census also read). Every writer asserts membership; an unknown token is a loud code bug.

**`refusal_payload` analog and the one-kwarg extension:**

```python
def refusal_payload(token: str, *, composed_at: str, extra_reasons: Sequence[str] = ()) -> dict[str, Any]:
    ...
    return {
        "curve": [], "returns": [], "version": 2, "flags": [],
        "degrade_reasons": sorted({_value(token), *(_value(r) for r in extra_reasons)}),
        "is_trustworthy": False, "refusal": _value(token),
        "scalars": {"mwr": None, "dietz": None, "computable": False},
        "inputs": {"n_keys": 0, "anchor_asof": None, "composed_at": composed_at},
    }
```

Add `no_capital_exit_refused: Mapping[str, int] | None = None`; write `inputs["no_capital_exit_refused"]` only when non-empty, so the default call stays byte-identical and `test_refusal_payload_is_the_fixture_row` keeps passing.

---

### `tests/test_allocator_equity_no_capital_exit.py` (test, compose level) - NOCAP-03 / NOCAP-04

**Analog:** the file's own fixtures. Imports (head of file): `from services.allocator_equity_compose import compose_allocator_equity`, `from services.external_flows import ExternalFlow`, `pandas as pd`, `pytest`. Fixtures: `DAYS = _days("2026-06-06", 5)`, `_flat(days)`, `_candidate_book(anchor=, terminal=, flows=, end_day=)`, `_hole_candidate_book(last_terminal=, first_terminal=, first_flows=)`, `_today(kwargs)` (the same book as it composes with no candidacy), `_without_clock(payload)` (blanks `inputs.composed_at`), `_compose(kwargs)` (pops the four positional args).

**Equality pattern to copy, then extend with the NOCAP-03 exception stated in the test** (existing form, in `test_hole_candidate_whose_last_segment_blocks_falls_back_as_a_whole_key` and `..._earlier_segment_refuses_falls_back_instead_of_failing`):

```python
payload = _compose(dict(kwargs))
assert _without_clock(payload) == _without_clock(_compose(_today(kwargs)))
```

These two equality assertions break by design: pop `no_capital_exit_refused` from `payload["inputs"]` before comparing and assert its exact value separately.

**NOCAP-04 test:** `kwargs = _hole_candidate_book(last_terminal=(DAYS[3], 600.0))` then `kwargs["segment_terminals_by_key"] = {}`; also the blocking-last-segment shape `last_terminal=(DAYS[4], 600.0)` with empty terminals. Assert equality with `_today(kwargs)` after popping the field, and `no_capital_exit_refused == {"segment_terminals_missing": 1}`. Keep `test_hole_segment_of_a_key_that_is_not_a_candidate_still_raises` and add a sibling asserting a NON-candidate with missing terminals still adds `key_inputs_mismatch`.

**Log-hygiene analog:** `test_no_capital_exit_fallback_logs_counts_and_reason_class_only` (uses `caplog.at_level(logging.WARNING, logger="services.allocator_equity_compose")`, key id `"KEY-ID-B"`, asserts the id, the day and the amounts are absent). Copy for the new counts.

---

### `tests/test_derive_allocator_equity_job.py` (test, job level) - NOCAP-01 / NOCAP-02 / NOCAP-03 / threading

**Analog fixtures** (in-file): `_FakeSupabase`, `_NOCAP_ALLOC`, `_BTC_DAYS`, `_nc_candidate(key, exchange, return_days, payload, returns=)`, `_nc_assemble(candidates, a_days=)`, `_nc_payload(token, venue, terminal_usd, terminal_day, flows=, dropped_pnl=, basis_flows=, basis_pnl=)` (a basis is written only when `basis_pnl is not None`), `_nc_mt5_withdrawal_book()`, `_nc_deribit_a3_book()`, `_nc_curve`, `_nc_book_returns`, `_compose_no_capital_book(seed)`:

```python
async def _compose_no_capital_book(seed: dict[str, list[dict]]) -> dict:
    from unittest.mock import patch
    from services.job_worker import run_derive_allocator_equity_job

    fake = _FakeSupabase(seed)
    job = {"id": "j-nocap", "kind": "derive_allocator_equity", "allocator_id": _NOCAP_ALLOC}
    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(job)
    assert result.outcome.name == "DONE", (result.error_kind, result.error_message)
    curve = [u for u in fake.upserts if _is_equity_curve_upsert(u[1])]
    assert len(curve) == 1, fake.upserts
    return _extract_payload(curve[0][1])
```

**NOCAP-02 analog (copy the shape):** `test_no_capital_exit_compose_refusal_reverts_the_candidates_and_keeps_the_row`: wrapper `_refuse_with_a_candidate(*args, **kwargs)` that records calls and raises only `if kwargs.get("no_capital_exit_by_key")`, patched via `patch("services.allocator_equity_compose.compose_allocator_equity", wrapper)`; seeds a stale `equity_curve` row into `seed[DERIVED_TABLE]`; asserts no `equity_curve` delete in `fake.deletes`, exactly one equity-curve upsert, and `first, second = calls` with `second` lacking `no_capital_exit_by_key`. New arms use `ValueError` (compose) and `patch("services.job_worker._no_capital_exit_consumes_only_dust", side_effect=KeyError(...))` (apply loop); negative control: a candidate-free book where the compose raises `ValueError` must still raise. Retry: run twice against one `_FakeSupabase`; to prove the retry classification drive `dispatch(job)` (needs `get_supabase` patched).

**NOCAP-01 re-fixturing (flip by design, do not weaken):** the four MT5 candidate tests that carry no `basis_pnl` today and exit (`test_no_capital_exit_mt5_nonpositive_key_emptied_by_a_final_withdrawal`, `test_no_capital_exit_mt5_dust_key_with_a_small_positive_terminal`, `test_no_capital_exit_a3_mt5_withdrawal_after_last_return` via `_nc_mt5_withdrawal_book`, the MT5 key D in `test_no_capital_exit_two_candidates_each_leave_on_their_own_day`) need a hand-derived basis whose `sum(F + P)` is at or below the floor (writer identity `L_{t-1} = L_t - F_t - P_t`, `prev0 = 0`); re-derive the expected curve by hand (money-math oracle rule). Adding a basis moves the replay into writer mode.

**RED fixture shape (RESEARCH Pitfall 1):** MT5 candidate, token `nonpositive`, stored terminal 0.0 on day 4, own basis flows `{d1: +80000, d4: -20000}` (ledger sum 60000, funded), returns flat on days 1-3. Never a flat funded account (the replay already refuses it).

**Threading arm (out-of-window):** a counted key row whose payload carries `"tiny_base_days": [<tail flow day>]` composes trustworthy; the same row without it carries `out_of_window_flow`.

---

### `tests/test_allocator_equity_inception.py` (test, replay level) - out-of-window ruling

**Analog:** `test_post_window_flow_keeps_out_of_window_flow_even_with_a_clean_opening`:

```python
flows = {-1: 100_000.0}
start = _start_for_share(0.5e-4, 100_000.0)
post = {_N_WINDOW: 5_000.0}
level_lo, anchor_before = _exact_book(start, flows)
anchor = anchor_before + 5_000.0
ke = replay_key_equity(_returns(), _flows({**flows, **post}), anchor, history_reaches_inception=True)
assert ke.degrade_reasons == frozenset({DegradeReason.OUT_OF_WINDOW_FLOW})
assert ke.flags["out_of_window_flows"] == 1
assert ke.flags["opening_flows_reconciled"] == 1
```

Copy for five arms: (1) same book with `stated_tail_days={_iso(_N_WINDOW)}` has no `out_of_window_flow` and no `out_of_window_flows` flag; (2) the day not stated still counts; (3) a flow BEFORE the first return day listed in `stated_tail_days` still counts; (4) a listed day not after `hi` is irrelevant; (5) job-level threading arm lives in the job file. The pre-window sibling test above it (flow at day `-5`, `ke.flags["out_of_window_flows"] == 1`) is the unchanged-behaviour control.

---

### `tests/test_derive_refusal_rows.py` and `tests/fixtures/derive_refusal_rows.json` (shared fixture, do not edit)

`test_refusal_payload_is_the_fixture_row` builds `refusal_payload(row["token"], composed_at=TABLE["composed_at"], extra_reasons=tuple(row["extra_reasons"]))` and requires `json.loads(json.dumps(built)) == row["payload"]`; `test_the_fixture_has_one_refusal_row_per_derive_refusal_member` pins the closed sets. The `refusal_payload` kwarg must default to byte-identical output; no `DeriveRefusal` / `DegradeReason` member is added.

## Shared Patterns

### Counts-only payload fields and logs
**Source:** the job's merge block after the compose (`departed_writer_basis_unchecked_keys`, `writer_basis_missing_members`, `writer_basis_stitched_members` written into `payload["inputs"]`), and the compose's fall-back warning.
**Apply to:** every NOCAP-03 write and every log line in this phase.
Counts and closed-set tokens only; no key id, venue id, day or USD (T-167.1.2-22, T-166.3.1-34). Present only when non-empty, so a healthy payload is unchanged. Never enters `degrade_reasons` or `flags`.

### Candidate fall-back is "today's result"
**Source:** `compose_allocator_equity` post-loop `if fell_back: reasons.add(DegradeReason.NO_ANCHOR); reasons.add(DegradeReason.DROPPED_KEY)` and the job's `no_capital_stored` recompose.
**Apply to:** NOCAP-01 refusals, NOCAP-02 reverts, NOCAP-04 forced fall-back. A refused candidate must leave exactly the no-candidate payload plus the NOCAP-03 field.

### Broad catch convention
**Source:** `except Exception as exc:  # noqa: BLE001` throughout `job_worker.py`.
**Apply to:** the two NOCAP-02 arms. No ruff/flake8 step enforces it, but match it.

### Imports inside the job
**Source:** the function-local import block at the top of `run_derive_allocator_equity_job` (`from services.allocator_equity_derive import (...)`, `from services.nav_twr import DUST_NAV_FLOOR, NavReconstructionError`).
**Apply to:** new names (`LEDGER_PROOF_VENUES`, `NO_CAPITAL_REFUSAL_REASONS`, `read_tiny_base_days`) are added to that import list; never restate `DUST_NAV_FLOOR`.

### Tests: neuter, see RED, restore
**Source:** CLAUDE.md / MEMORY (data-integrity gates must be able to fail). RESEARCH "PROOF-01" table names the arm to neuter per gate.
**Apply to:** every gate. `cp` a byte backup to the scratchpad, neuter, run the named arm RED, `cp` back, `cmp`, run GREEN, record verbatim in the plan SUMMARY. Never `git checkout`/`stash` on uncommitted work.

### Guards over `job_worker.py` source
**Source:** `tests/test_legacy_table_not_named.py`, `tests/test_stamp_io_exhaustive.py`, `tests/test_derive_silent_failure_f1_f4_f7.py` (AST/grep scans).
**Apply to:** all job_worker edits: do not name the legacy snapshots table and do not add a stamp call.

### Run commands
`cd analytics-service && python3 -m pytest tests/test_allocator_equity_no_capital_exit.py tests/test_allocator_equity_inception.py -q -p no:cacheprovider` (measured 28 passed); job subset `python3 -m pytest tests/test_derive_allocator_equity_job.py -k no_capital -q -p no:cacheprovider` (30 passed); mypy strict from `analytics-service/` (CI pins `mypy==2.4.0`, local is 2.0.0).

## No Analog Found

None. Every file extends an existing sibling. The only genuinely new artefacts are small and have close siblings:

| Artefact | Role | Why no exact match | Nearest sibling |
|----------|------|--------------------|-----------------|
| `_no_capital_ledger_level` | pure helper | no existing helper sums a writer basis | `_no_capital_exit_consumes_only_dust` (shape), `read_writer_basis` (operand) |
| `no_capital_exit_refused` field | payload counts | no existing per-reason counts DICT in `inputs` (existing fields are scalars) | `departed_writer_basis_unchecked_keys`, `writer_basis_missing_members` (placement and conventions) |
| `read_tiny_base_days` (tolerant) | reader | every existing `read_*` is strict (raises) | `read_dropped_day_pnl` (parse), the tolerant choice is RESEARCH A5 |

## Metadata

**Analog search scope:** `analytics-service/services/{job_worker,allocator_equity_compose,allocator_equity_derive}.py`, `analytics-service/tests/{test_allocator_equity_no_capital_exit,test_derive_allocator_equity_job,test_allocator_equity_inception,test_derive_refusal_rows}.py`, `tests/fixtures/derive_refusal_rows.json`.
**Files scanned:** 8 read in targeted ranges (`job_worker.py` is far over 2000 lines, so located by `grep -an` and read in non-overlapping ranges).
**Pattern extraction date:** 2026-11-24
**Not verified here:** RESEARCH's probe results (1 and 2) were not re-run; line numbers in RESEARCH.md were not re-resolved, only symbols. The 155.2 freeze check is a push-time step.

## PATTERN MAPPING COMPLETE

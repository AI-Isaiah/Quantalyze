# Phase 179: OKXBILLSCHAIN - Pattern Map

**Mapped:** 2026-10-28
**Files analyzed:** 8 (4 new, 4 additive edits)
**Analogs found:** 8 / 8 (every analog is git-tracked source; checked with `git ls-files` from `analytics-service/`)

All paths below are relative to `analytics-service/` unless they start with `.planning/`. Line numbers were read in the Phase 179 worktree on 2026-10-28 and match the anchors in 179-RESEARCH.md (probe tuple end `:287`, validators end `:404`, defaults end `:1302`, `_measure_anchor` tail `:1092-1099`). Phase 173 keeps landing review fixes in the probe, so re-run `grep -an` for each anchor at execution time.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `services/okx_bills_chain.py` (NEW) | service (pure analysis + async GET readers) | transform (pure fold) + request-response (GET) | `services/okx_opening_balance.py` (oracle, readers) and `services/okx_archive_classify.py` `verify_bal_chain` (per-ccy break counting) | role-match (two analogs, one per half) |
| `scripts/okx_chain_record.py` (NEW) | utility (record vocabulary, validators, defaults) | transform | the validator block of `scripts/allocator_history_probe.py` (`:309-343`) and `scripts/bybit_upnl_probe.py` (`:166-203`) | exact (same predicates, same vocabulary style) |
| `tests/test_okx_bills_chain.py` (NEW) | test | request-response with fakes | `tests/test_okx_opening_balance.py` (`_World`, `_GAP_CASES`, static pin) | exact |
| `tests/test_okx_chain_record.py` (NEW) | test | transform | `tests/test_allocator_history_probe.py` `test_the_diagnostic_keys_refuse_values_outside_their_vocabulary` (`:2289`) and `tests/test_bybit_upnl_probe.py` `test_emitter_refuses_a_key_or_a_value_outside_the_whitelist` (`:598`) | exact |
| `services/okx_opening_balance.py` (EDIT, additive) | service | request-response | itself (`_parse_bill` `:221-240`, `OkxOpeningReading` `:142-151`, `read_okx_opening` `:408-464`) | exact (self) |
| `scripts/allocator_history_probe.py` (EDIT, additive) | script (probe) | request-response, read-only | itself (`_measure_anchor` tail `:1077-1099`, record tuple/validators/defaults) | exact (self) |
| `tests/_okx_bills.py` (EDIT, additive) | test helper (venue fakes) | request-response fake | itself (`OkxBillsArchive` `:111-162`, `okx_bill` `:24-43`, `okx_detail` `:81-98`) | exact (self) |
| `tests/test_allocator_history_probe.py` (EDIT, append at END only) | test (e2e through `hp.run()`) | request-response with fakes | itself (`_OkxAnchorVenue` `:1657`, `test_a_completed_walk_keeps_its_counters_when_a_later_step_fails` `:2197`) | exact (self) |

## Pattern Assignments

### `services/okx_bills_chain.py` (service, pure transform + GET readers)

**Analog A (pure fold):** `services/okx_archive_classify.py` `verify_bal_chain`, lines 336-365. It already counts breaks per currency rather than stopping at the first, which is what `analyse_chain` must do (the oracle's `per_ccy_opening` stops at the first failing currency).

**Per-ccy break counting to copy** (`okx_archive_classify.py:336-365`):
```python
        for row, index in sorted(unique.values(), key=lambda pair: _bill_order_key(pair[0])):
            ...
            entry = ccys.setdefault(
                row.ccy,
                {"pairs_checked": 0, "first_day": row.day, "last_day": row.day,
                 "breaks": 0, "first_break_day": None, "seam_breaks": 0},
            )
            prior = previous.get(row.ccy)
            if prior is not None:
                entry["pairs_checked"] += 1
                if row.bal != prior[0].bal + row.bal_chg:
                    entry["breaks"] += 1
```
Order key to reuse the idea of (`okx_archive_classify.py:192-194`): numeric billId, non-digit last. The oracle's own key is `int(b["billId"])` (`okx_opening_balance.py:301`); `analyse_chain` must use the SAME key for the verdict-equivalent arm and add the alternative sorts as extra counts.

**Analog B (the oracle's exact arms, the thing `analyse_chain` diagnoses, never edits)** `services/okx_opening_balance.py:296-313`:
```python
    by_ccy: dict[str, list[Mapping[str, str]]] = {}
    for bill in bills:
        by_ccy.setdefault(bill["ccy"], []).append(bill)
    openings: dict[str, Decimal] = dict(cash_by_ccy)
    for ccy, group in by_ccy.items():
        ordered = sorted(group, key=lambda b: int(b["billId"]))
        first_bal = _decimal(ordered[0]["bal"], "malformed_bills")
        openings[ccy] = first_bal - _decimal(ordered[0]["balChg"], "malformed_bills")
        prev_bal = first_bal
        for bill in ordered[1:]:
            bal = _decimal(bill["bal"], "malformed_bills")
            bal_chg = _decimal(bill["balChg"], "malformed_bills")
            if bal != prev_bal + bal_chg:
                raise OpeningUnavailable("chain_break")
            prev_bal = bal
        if prev_bal != cash_by_ccy.get(ccy, Decimal(0)):
            raise OpeningUnavailable("chain_break")
```
Copy: exact `Decimal` equality, the `cash_by_ccy.get(ccy, Decimal(0))` comparison for a currency absent from the balance row, `billId`-numeric ordering. Do NOT raise: collect into a report.

**Module header / imports / constants convention** (`okx_opening_balance.py:68-86, 101-107, 129-131`): a docstring that opens with the phase and explains WHY, then:
```python
from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Final

from services.closed_sets import STABLECOINS
from services.exchange import _okx_bills_fetch_with_backoff

#: OKX's maximum page size for ``bills-archive``.
BILLS_ARCHIVE_PAGE_ROWS: Final[int] = 100
_BILLS_METHOD: Final[str] = "private_get_account_bills_archive"
```
Frozen dataclass for the report, as `OkxOpeningReading` (`:142-151`): `@dataclass(frozen=True)` with a one-line docstring. `services/` is mypy `--strict` and counts toward `--cov-fail-under=80`, so annotate everything and cover every branch.

**GET reader pattern (every extra bills/subtypes page goes through the backoff helper)** `okx_opening_balance.py:259-266` and `exchange.py:1378-1385` (signature `(exchange, method_name, params, *, label, page)`):
```python
        params = {"limit": str(BILLS_ARCHIVE_PAGE_ROWS)}
        if cursor is not None:
            params["after"] = str(cursor)
        reply: Any = await _okx_bills_fetch_with_backoff(
            exchange, _BILLS_METHOD, params, label="opening", page=page_no
        )
        rows = _page_rows(reply)
```
For `/account/bills` use method name `"private_get_account_bills"` (same helper, already used at `exchange.py:1464-1470`). For `/account/subtypes` copy `okx_archive_job.py:805-818`:
```python
    raw = await _okx_bills_fetch_with_backoff(
        exchange, "private_get_account_subtypes", {}, label="account/subtypes", page=0
    )
    live = _parse_live_subtypes(raw)
```
Do not import `okx_archive_job._parse_live_subtypes` (pulls the job worker in). Copy its tolerance instead (`okx_archive_job.py:764-802`): accept nested `subTypeDetails` AND a flat `{type, subType}` entry, and report "0 types" as a count, never a pass (its own comment records that the first real call read 0 entries because the shape was guessed).

**Post-walk balance read** reuse `obal.read_okx_balance_row(exchange)` and `obal.cash_balances(row)` (`okx_opening_balance.py:178-208`): no catch, a venue exception propagates; the caller wraps by class.

**Venue-number parsing:** walked bills are already strings validated by `_parse_bill` (`:221-240`), so `Decimal(b["bal"])` is safe on them. Any NEW venue payload (the `/account/bills` rows, `uTime`) must go through `obal._decimal`/`obal._digits` semantics (`:154-175`: reject bool, non-str/int/float, NaN, inf; digits only for ids and ts), never `float(x)`.

**Error handling:** none inside the pure function. Readers let venue exceptions propagate (PD-I: no catch-and-convert). The probe block wraps each GET group separately and records `classify_failure(exc)` (see probe section).

**Static GET-only pin must hold for this file** (pinned in `tests/test_okx_opening_balance.py:576-592` for the oracle; copy for the new module): no `.insert(` `.update(` `.upsert(` `.delete(` `.rpc(`; no `private_(post|put|delete)_`; no `create_order|cancel_order|withdraw|transfer(` (name helpers `transfers_net_...`, never `...transfer(`); never `_stamp_429`, `_cache_coingecko_prices` or `bills_history_archive`.

---

### `scripts/okx_chain_record.py` (utility, record vocabulary)

**Analog:** the predicate set and validator dict in `scripts/allocator_history_probe.py:309-343` (same predicates are duplicated in `scripts/bybit_upnl_probe.py:173-203`, which is the precedent for a script module carrying its own tiny predicates rather than importing across probes).

**Imports:** import only `FIELD_ABSENT`, `FAILURE_CLASSES`, `sig3` from `scripts.bybit_upnl_probe` (`allocator_history_probe.py:130`) and `STABLECOINS` from `services.closed_sets`. Must NOT import `scripts.allocator_history_probe` (circular: the probe imports this module). Define the predicates locally.

**Predicates to copy verbatim** (`allocator_history_probe.py:309-342`):
```python
def _is_bool(x: Any) -> bool:
    return isinstance(x, bool)

def _is_bool_or_absent(x: Any) -> bool:
    return _is_bool(x) or (isinstance(x, str) and x == FIELD_ABSENT)

def _is_count(x: Any) -> bool:
    return isinstance(x, int) and not isinstance(x, bool) and x >= 0

def _is_count_or_absent(x: Any) -> bool:
    return _is_count(x) or (isinstance(x, str) and x == FIELD_ABSENT)

def _is_str_matching(pattern: re.Pattern[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and pattern.match(x) is not None

def _is_one_of(allowed: Sequence[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and x in allowed
```

**Shape of the three exported objects** mirror the probe's three structures (`ACCOUNT_RECORD_KEYS` tuple `:230-288`, `_ACCOUNT_VALIDATORS` dict `:343-405`, defaults inside `_account_record` `:1244-1304`):
- `CHAIN_KEYS: tuple[str, ...]` (flat `chain_*` keys), spliced as `*okx_chain_record.CHAIN_KEYS`.
- `CHAIN_VALIDATORS: dict[str, Callable[[Any], bool]]`, spliced as `**okx_chain_record.CHAIN_VALIDATORS`.
- `chain_defaults() -> dict[str, Any]`: every unmeasured value is `FIELD_ABSENT` or `"not-run"`/`"none"` per the vocabulary, never `0`/`False` (the probe's rule at `:389` comment: "'Not measured' is `field-absent` for every reading below, never 0 or False").
- `chain_values(report) -> dict[str, Any]`: maps the `ChainReport` to the flat keys. This is the only place a count/bucket/token is produced for printing.

**Vocabulary style to copy** (`allocator_history_probe.py:181-208`): closed tuples of tokens, then `_is_one_of(TUPLE)`:
```python
_WINDOW_AGE_BUCKETS: tuple[str, ...] = ("none", "0-29", "30-89", ...)
...
    "last_window_age_bucket": _is_one_of(_WINDOW_AGE_BUCKETS),
```
Apply to `chain_arm` (`none|interior|close|both`), the residual buckets, the age buckets, `chain_diagnostic` (`not-run|run|failed`; copy `allocator_history_probe.py:375`), `chain_diagnostic_failure_class` (`_is_one_of((*FAILURE_CLASSES, "truncated"))` as the probe's `_FAILURE_CLASSES` `:139`), and `chain_repeat_reason` (`("not-run", "none", *sorted(obal.OPENING_UNAVAILABLE_REASONS))` as `_OPENING_REASON_TOKENS` `:169`).

**Ratio / rounding:** if any key carries a ratio, route it through the probe's `ratio_or_absent`-style `sig3` (`allocator_history_probe.py:791-801`); a `_is_ratio` validator would be `_is_sig3_float` (`:325-332`). The chain keys are mostly counts and tokens, so prefer counts.

**Key-name pitfall:** `assert_sanitized` (`scripts/deribit_ground_truth.py:334-340, 349, 390-411`) rejects any key containing `secret`, `token`, `api_key`, `apikey`, `password` and any string value matching `[A-Za-z0-9+/=_-]{40,}`. Never name a key `chain_*_token`; keep token-list values short with `.`/`:`/`,` separators. Token-list and `chain_worst_ccy` validators must also reject a run of 10 or more digits and any uuid shape (RESEARCH Security table).

---

### `tests/test_okx_chain_record.py` (test, vocabulary / redaction)

**Analog:** `tests/test_allocator_history_probe.py:2255-2327` (`_diagnostic_control` + `test_the_diagnostic_keys_refuse_values_outside_their_vocabulary`).

**Control-then-bad-values pattern to copy** (`:2289-2327`):
```python
    control = _diagnostic_control()
    assert json.loads(hp.emit_record(control))["anchor_over_replay"] == 7.0  # the honest record prints

    bad: list[tuple[str, Any]] = [
        ("anchor_over_replay", 7.123456),  # not three figures
        ("bills_read", True),  # True where a count is declared
        ("diagnostic_failure_class", "ExchangeError: 4321.5"),
        ...
    ]
    for key, value in bad:
        with pytest.raises(ValueError) as exc:
            hp.emit_record(dict(control, **{key: value}))
        assert key in str(exc.value), key  # the refusal names the key...
        assert "4321" not in str(exc.value) and "7.12" not in str(exc.value)  # ...never the value
```
The chain control record is `hp._account_record("a1", "2026-10-27", **chain_values(report))`. Bad values per RESEARCH Validation map: unrounded float, bool for a count, `chain_worst_ccy` outside the regex, kind list containing an amount, a 40+ character string, an unlisted arm/bucket.

**Pure-census tests also here** (the file is deliberately free of the probe end-to-end): `set(CHAIN_KEYS) == set(chain_defaults())`; every default passes its own validator; no key name contains a deny substring (`from scripts.deribit_ground_truth import _DENY_KEY_SUBSTRINGS`); synthetic distinctive amounts and billIds never appear in `emit_record` output (copy the leak loop at `test_allocator_history_probe.py:1802-1804`: `for leak in (...): assert leak not in everything, leak`).

**Imports** follow the probe test (`test_allocator_history_probe.py:31-45`): `from __future__ import annotations`, `import json`, `import pytest`, `import scripts.allocator_history_probe as hp`. Module docstring states WHY each group matters (Rule 9), as `:1-30`.

---

### `tests/test_okx_bills_chain.py` (test, pure analysis + GET readers on fakes)

**Analog:** `tests/test_okx_opening_balance.py`.

**Imports + helpers** (`:12-61`):
```python
from tests._okx_bills import (
    OkxBillsArchive,
    okx_balance_payload,
    okx_bill,
    okx_bill_chain,
    okx_detail,
)

OPENING_DAY = date(2026, 4, 6)
OPENING_MS = int(datetime(2026, 4, 6, tzinfo=timezone.utc).timestamp() * 1000)
DAY_MS = 24 * 60 * 60 * 1000

def _exchange(archive: OkxBillsArchive, *, candles: Any = None) -> SimpleNamespace:
    """A plain namespace, NOT ``AsyncMock()``: an unset method on an ``AsyncMock`` answers
    with a ``MagicMock`` and the oracle would "work" on a mock (RESEARCH Pitfall 2)."""
    return SimpleNamespace(
        private_get_account_bills_archive=archive,
        fetch_ohlcv=AsyncMock(return_value=[] if candles is None else candles),
    )
```
Use `SimpleNamespace` exchanges with explicit `private_get_account_bills`, `private_get_account_subtypes`, `private_get_account_balance` methods. Never a bare `AsyncMock()` for an OKX method.

**Scenario-per-world parametrization** (`:133-145, 244-319`): a `NamedTuple _World`, one `_gap_*` builder per scenario, a `pytest.param(token, builder, id="...")` list, one parametrized test asserting the outcome. Copy this for `analyse_chain` (builders: interior-only, close-only, both, none, multi-currency where the FIRST currency in dict order is clean, tie, inversion, deleted middle bill, hidden tail). A deleted-middle-bill builder already exists as the template:
```python
def _gap_missing_middle_bill() -> _World:
    chain = okx_bill_chain("USDT", "1000", ["1"] * 5, first_id=100, first_ts=OPENING_MS + 60_000)
    del chain[2]
    return _usdt_world(chain, "1005")
```
Test constants are the test's own (`# the test's own constants`), never recomputed by the module under test (module docstring `:6-9`).

**RED-on-old-reading template for the fix plans** (`:338-353`, the replayed live a4 shape; later fix tests copy its layout: seed the shape, assert `unavailable_reason == "chain_break"` on the old reading and `none` / measured on the new one):
```python
    reading = await obal.read_okx_opening(
        _exchange(OkxBillsArchive([_reach_bill(), *chain])), None, OPENING_DAY, row
    )
    assert reading.opening_usd is None
    assert reading.unavailable_reason == "chain_break"
    assert reading.bills_read == 100
```
Fix tests must ALSO run through the real forced path in the `tests/test_okx_anchor_rule.py` style: `_okx_world(bills, usdt_cash=...)` (`:93-116`) plus `run_reconstruct_allocator_history_job(_forced_job())` (`:137`) and the `_UNPROVABLE_CASES` / `_OPENING_CHECK_VOCABULARY` lists (`:264-304`). A NEW refusal token (founder decision, D-03) moves three censuses together: `tests/test_okx_opening_balance.py:356-359` (`_GAP_CASES`), `tests/test_okx_anchor_rule.py:304, 406-408`, and the probe's `_OPENING_REASON_TOKENS` (`allocator_history_probe.py:169`).

**Backoff test (mutation N6)** copy `tests/test_okx_bills_backoff.py:34-66`: a `_ScriptedExchange` that raises `ccxt.RateLimitExceeded` `fail_times` then answers, `monkeypatch.setattr(exchange_mod.asyncio, "sleep", _fake_sleep)`, assert `ex.calls == 3` and `len(slept) == 2`. For the oracle-level 429 propagation copy `test_okx_opening_balance.py:548-564` (set `OKX_BILLS_BACKOFF_BASE_S` to 0.0 and `random.uniform` to 0, `pytest.raises(exc)`).

**Static GET-only pin on the NEW module** copy `test_okx_opening_balance.py:576-592` and swap `obal.__file__` for the new module; the assertions that name `private_get_account_bills_archive` / `private_get_account_balance(` become the new module's own GET names.

**Mutation list** is in 179-RESEARCH.md "Mutations to run" (N1-N10); neuter, see RED, restore from a byte backup.

---

### `services/okx_opening_balance.py` (EDIT, additive only)

**Analog:** itself. Keep `per_ccy_opening`, `walk_okx_bills_archive` control flow, `opening_agrees`, `OPENING_UNAVAILABLE_REASONS` and `_okx_forced_opening_check` unedited (RESEARCH Pattern 4).

**Edit 1, `_parse_bill` keeps three more string keys** (`:232-240`, today):
```python
    return {
        "billId": str(bill_id),
        "ts": str(ts),
        "ccy": ccy,
        "bal": str(bal),
        "balChg": str(bal_chg),
        "type": str(row.get("type") or ""),
        "instType": str(row.get("instType") or ""),
    }
```
Add `"subType"`, `"mgnMode"`, `"posBalChg"` in the same `str(row.get(...) or "")` idiom, after `instType`. They are diagnostic-only; they must not enter any verdict path. Check that no existing test pins `_parse_bill`'s exact key set before editing (`grep -an "_parse_bill\|\"instType\"" tests/`).

**Edit 2, `OkxOpeningReading.walked`** (`:142-151`): the dataclass is `frozen=True`, so add a defaulted trailing field:
```python
    walked: tuple[Mapping[str, str], ...] = ()
```
It is constructed only inside this module (`:447-454` success arm, `:457-464` except arm). Fill it on BOTH: hoist `bills` above the `try` (next to `bills_read = 0` at `:418`, e.g. `bills: list[dict[str, str]] = []`) so the `except OpeningUnavailable` arm can hand over what the walk fetched. Careful: `walk_okx_bills_archive` raises before returning (`reach_unproven`, `malformed_bills`, `page_ceiling`), so `walked` stays `()` for those; only a post-walk `chain_break` / `unpriced_ccy` carries the bills. This is what N10 in the mutation list checks.

**Existing regression net, must stay green untouched:** `_GAP_CASES` (`test_okx_opening_balance.py:244-295`) and `_UNPROVABLE_CASES` (`test_okx_anchor_rule.py:264`). Add one assertion that `OkxOpeningReading(...)` defaults `walked == ()`.

**mypy:** this file passes `--strict` today; `tuple[Mapping[str, str], ...]` with `from __future__ import annotations` already present.

---

### `scripts/allocator_history_probe.py` (EDIT, additive; four one-line splices + one tail block)

**Analog:** itself. Do NOT touch `_read_member`, `_probe_member`, `_probe_account`, `summarize`, `SUMMARY_*` (Phase 173 owns those hunks).

**Splice 1, import** after the `from services...` lines (`:130-135`), not beside the `collections.abc` line at `:125` (173 edits that one):
```python
from scripts import okx_chain_record  # or: from scripts.okx_chain_record import ...
```
Follow the file's existing `from scripts.x import ...` form (`:130-131`).

**Splice 2, last line of `ACCOUNT_RECORD_KEYS`** (`:287-288`):
```python
    "opening_day_is_window_start",
    *okx_chain_record.CHAIN_KEYS,
)
```
**Splice 3, last entry of `_ACCOUNT_VALIDATORS`** (`:404-405`):
```python
    "opening_day_is_window_start": _is_bool_or_absent,
    **okx_chain_record.CHAIN_VALIDATORS,
}
```
**Splice 4, last entry of `_account_record`** (`:1302-1304`):
```python
        "opening_day_is_window_start": FIELD_ABSENT,
        **okx_chain_record.chain_defaults(),
    }
    return {**record, **values}
```

**Tail block in `_measure_anchor`** (the `else:` after `reading`, `:1077-1099`). The existing wrap-by-class idiom to copy for EACH extra GET group (`:1079-1084`):
```python
            try:
                reading = await obal.read_okx_opening(client, supabase, opening_day, row)
            except Exception as exc:  # noqa: BLE001 - recorded by CLASS; the message is never read
                # Review SFH-04: the walk is the last read, so its failure (a 429 that outlives
                # the backoff) must not discard the ratios already in ``out``.
                out["opening_check"] = "unavailable"
                out["diagnostic_failure_class"] = classify_failure(exc)
                return out
```
For the chain block: run only when `reading.unavailable_reason == "chain_break"`; set `out["chain_diagnostic_failure_class"] = classify_failure(exc)` (a NEW key, never overwrite `diagnostic_failure_class`) and keep the earlier chain keys. The counters-guard idiom just above shows how to treat "walk never finished" (`:1093-1098`, `_WALK_NOT_COMPLETED_REASONS` `:174-176`): `walked == ()` after `chain_break` would be a bug, so assert it in the e2e test rather than guarding silently. Merge values with the file's own idiom `out = {**out, **balance_row_readings(row)}` (`:1058`): `out = {**out, **okx_chain_record.chain_values(report)}`.

The whole `_measure_anchor` already runs under `asyncio.wait_for(..., er._RECONSTRUCT_CRAWL_TIMEOUT_S)` in `_anchor_diagnostic` (`:1102-1119`); do not add a second timeout, and do not change the `supabase: ReadOnlySupabase` annotations (pinned at `tests/test_allocator_history_probe.py:2346-2362`).

**Static pins the edit must not trip** (`tests/test_allocator_history_probe.py`): `:796` no `create_order|cancel_order|withdraw|transfer(`; `:799` no `private_(post|put|delete)_`; `:2362` `"private_get_account_bills_archive" not in _PROBE_SRC`; `:802-806` only two `.table(` literals; `:786-792` forbidden names. All venue I/O therefore lives in `services/okx_bills_chain.py`, reached through a module attribute like `obal.` is (`obal.read_okx_opening(` `:2361`).

**Docstring:** add a NEW item after the module docstring's item 5 (`:38-50`); do not edit items 2-5 or the READ-ONLY paragraph (`:62-73`), which 173 rewrites.

---

### `tests/_okx_bills.py` (EDIT, additive, default-off)

**Analog:** itself. All new switches default off so every Phase 172 test is untouched.

**`okx_bill` gains keyword-only extras** (`:24-43`, today ends with `type`/`instType`): add `sub_type: str = ""`, `mgn_mode: str = ""`, `pos_bal_chg: str = ""` keyword args that add `"subType"`, `"mgnMode"`, `"posBalChg"` to the dict only when set (or always, since `_parse_bill` uses `row.get(...) or ""`); keep positional parameters unchanged.

**`okx_detail` gains `u_time: str | None = None`** (`:81-98`) adding `"uTime"`; the dict keys already include `ccy`, `cashBal`, `eq`, `eqUsd`, `stgyEq`, `upl`.

**`OkxBillsArchive` switches** follow the existing constructor-flag style (`:129-144`, e.g. `ignore_after`, `empty_after_cursor`, `oldest_first_with_begin`): add `tail_hidden: int = 0` (omit the newest N rows), `hide_type: frozenset[str] = frozenset()` (an unfiltered query omits that type, a query carrying `type=` serves it), and a tie/inversion helper (a function building same-`ts` pairs whose `billId` order is not the balance-update order). Filtering sits in `__call__` (`:146-162`) beside the `begin`/`end`/`after` filters; add `type`/`instType` filter branches there. The 7-day `/account/bills` fake can be the same class instantiated over a different row list (same `__call__(params)` shape).

**New small fakes in the same file, same docstring style** (`:1-16`, "Every number is a string, as OKX sends it. Every value is synthetic."): `OkxBalanceSequence([payload_before, payload_after])` whose `private_get_account_balance` answers differently per call, and a subtypes fake (nested `subTypeDetails`, flat, empty) returning `{"code": "0", "data": [...]}`. `okx_balance_payload` (`:101-108`) already builds the per-call payloads.

---

### `tests/test_allocator_history_probe.py` (EDIT, append ONE test at the very END)

**Analog:** itself, `:1657-1697` and `:2197-2219`. Append after line 2362; edit nothing above (Phase 173 edits `_OkxAnchorVenue`, `_refusing_reader`, `_anchoring_reader`).

**Venue + services wiring to reuse unmodified** (`:1657-1678`): `_OkxAnchorVenue(pages, balance=..., bills=...)` exposes only `private_get_account_balance` and `private_get_account_bills_archive`. The chain GETs need `private_get_account_bills` / `private_get_account_subtypes` on the venue; do NOT edit `_OkxAnchorVenue`. Subclass it in the appended test section (`class _ChainVenue(_OkxAnchorVenue): ...`) so 173's changes to the base merge cleanly.

**The a4-shaped chain_break e2e to copy** (`:2197-2219`, then extend):
```python
    opening_ms = _ms(_OPENING_DAY)
    rows = [
        okx_bill(1, opening_ms - 5 * 86_400_000, "USDT", "60000", "5"),
        okx_bill(10, opening_ms + 3_600_000, "USDT", "60000", "0"),
        okx_bill(12, opening_ms + 9_000_000, "USDT", "1", "-40000"),  # 60000 - 40000 != 1
    ]
    okx = _OkxAnchorVenue([[], [], [], []], balance=_anchor_balance(), bills=OkxBillsArchive(rows))
    services = _Services(_okx_only_book(), [okx], window=_ANCHOR_WINDOW)
    services.reader = _refusing_reader(pages_per_pass=2)
    services.install(monkeypatch)

    assert await hp.run() == 1
    captured = capsys.readouterr()
    account, _summary = (json.loads(line) for line in captured.out.splitlines() if line.strip())
    assert account["opening_check"] == "unavailable"
    assert account["opening_unavailable_reason"] == "chain_break"
```
Extend with: `account["chain_arm"] == "interior"` (or the scenario's arm), the other `chain_*` keys, `account["member_refusal"] == "anchor_skipped_implausible"` (the refusal stays, mutation N9), the forced pass's counters not doubled (`account["trade_calls"] == 2`, `[a.require_anchor for a in services.read_args] == [True, None]`, copy `:1793-1798`), `services.supabase.writes == []`, and the leak loop (`:1802-1804`) over distinctive synthetic amounts and billIds. Failure-keeps-earlier-keys: copy `:2137-2170` (venue raises `ccxt.AuthenticationError(f"... {_KEY_OKX} signature=abc123")`; assert `chain_diagnostic_failure_class == "AuthenticationError"`, no leak of `"4321.5"`, `_KEY_OKX`, `"signature"`, `"abc123"`).

**Census guard that must keep passing** (`:936-941`): `assert set(hp.ACCOUNT_RECORD_KEYS) == set(hp._account_record("a1", "2026-10-23"))`; `_diagnostic_control()` (`:2255`) builds from `_account_record`, so it picks up the new defaults automatically.

---

## Shared Patterns

### Fail closed; the forced path is unchanged
**Source:** `services/okx_opening_balance.py:55-66` (module docstring "Failure semantics") and `:455-464`.
**Apply to:** every file. Only STRUCTURAL gaps are "unavailable", each with exactly one token from `OPENING_UNAVAILABLE_REASONS` (`:90-99`, closed set; a new token is a founder decision, D-03). A VENUE exception propagates unchanged (PD-I, no automatic re-crawl). Diagnostic code never changes the refusal: the probe records the diagnostic's own failure by CLASS in its own key.

### Redaction contract (counts, booleans, closed tokens, 3-sig-fig ratios)
**Source:** `scripts/allocator_history_probe.py:52-60` (docstring), `:429-453` (`validate_record`/`emit_record`), `scripts/deribit_ground_truth.py:334-411` (`assert_sanitized`).
**Apply to:** `scripts/okx_chain_record.py`, the probe tail block, both new test files.
```python
def emit_record(record: Mapping[str, Any]) -> str:
    """The ONLY path to stdout: validate, then serialize one compact JSON line."""
    validate_record(record)
    return json.dumps(record, sort_keys=True, separators=(",", ":"), allow_nan=False)
```
`validate_record` runs `_check_keys` (extra or missing key raises, message names the PATH not the value, `:422-447`) then each key's validator then `assert_sanitized`. Not measured is `field-absent`, never 0 or False.

### Exception recorded by CLASS, never by message
**Source:** `scripts/bybit_upnl_probe.py:487-501` (`classify_failure`), used at `allocator_history_probe.py:1083, 1117`.
**Apply to:** the probe tail block, the readers' callers. A ccxt message can carry a signed URL, an amount or an id.

### GET-only, through the existing 429 backoff
**Source:** `services/exchange.py:1378-1418` (`_okx_bills_fetch_with_backoff`, `OKX_BILLS_MAX_RETRIES`, `OKX_BILLS_BACKOFF_BASE_S`).
**Apply to:** every new bills/bills-archive/subtypes page in `services/okx_bills_chain.py`. Retries only `RateLimitExceeded`/`DDoSProtection`; everything else re-raises. A hard call ceiling (suggest 120 total) and `*_complete` booleans when it is hit; never an unbounded sweep.

### Venue numbers parse through `_decimal` semantics
**Source:** `services/okx_opening_balance.py:154-175` (`_decimal`, `_digits`).
**Apply to:** any NEW venue payload read (`/account/bills` rows, `uTime`). Reject bool, non-numeric, NaN, inf; ids and timestamps are all-ASCII-digit strings.

### Fakes are plain namespaces with explicit dict-shaped methods
**Source:** `tests/test_okx_opening_balance.py:45-51` and `tests/test_okx_anchor_rule.py:93-116`.
**Apply to:** all new tests. An unset method on an `AsyncMock` answers with a `MagicMock`; set every OKX method explicitly.

### Tests encode WHY, with the test's own constants
**Source:** module docstrings of `tests/test_okx_opening_balance.py:1-9` and `tests/test_allocator_history_probe.py:1-30`.
**Apply to:** all new tests. Seed the venue's running balance with constants of the test's own; a gate must be able to fail (neuter, see RED, restore from a byte backup, never `git checkout`/`restore`/`stash`).

### CI gates the planner must put in every analytics brief
`cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (a new `services/` module is strict-typed and counts toward `--cov-fail-under=80`; `scripts/` is not in the mypy line). pytest only from `analytics-service/`; no `importlib.reload`; always `grep -a`.

## No Analog Found

None outright. Two partial spots where the planner leans on RESEARCH.md rather than a codebase twin:

| File / part | Role | Data Flow | Reason |
|-------------|------|-----------|--------|
| `analyse_chain` order-independent checks (start/end multiset degree test, re-close under `(ts, billId)` and `(ts, -billId)`, billId-vs-ts inversions) | pure transform | transform | `verify_bal_chain` only counts breaks in one order; no existing code tests an order-independent chain. Use the `Counter` sketch in 179-RESEARCH.md "The pure analysis skeleton" (necessary-not-sufficient, stated in the key's description). |
| Type / instType presence sweep and the 7-day `/account/bills` overlap diff | async reader | request-response | No existing code compares `/account/bills` with the archive or sweeps `type=`/`instType=` filters. Closest: `exchange.py:1440-1500` (`fetch_daily_pnl` pages `private_get_account_bills` per instType through the backoff helper, `after`/`begin` params) for the page loop, and `okx_archive_job.py:764-818` for subtype parsing. |

## Collision notes (Phase 173 owns parallel hunks in the probe and its tests)

Follow 179-RESEARCH.md "Phase 173 collision map": splices go at the LAST line of each of the three structures, the import goes after the `from services...` lines, the chain block sits at the END of `_measure_anchor`, the docstring change is a NEW item after item 5, pure tests live in the two new test files, and the single e2e test is appended after line 2362. Re-run `git diff origin/main...HEAD -- analytics-service/scripts/allocator_history_probe.py` in the 173 worktree at execution time.

## Metadata

**Analog search scope:** `analytics-service/services/`, `analytics-service/scripts/`, `analytics-service/tests/`.
**Files read:** 15 (okx_opening_balance.py, allocator_history_probe.py regions, bybit_upnl_probe.py regions, deribit_ground_truth.py regions, okx_archive_classify.py regions, okx_archive_job.py regions, exchange.py regions, tests/_okx_bills.py, test_okx_opening_balance.py, test_allocator_history_probe.py regions, test_okx_anchor_rule.py regions, test_okx_bills_backoff.py, test_bybit_upnl_probe.py index).
**Tracked-source gate:** every named analog path printed by `git ls-files` from `analytics-service/`; no gitignored mirror path is used.
**Pattern extraction date:** 2026-10-28

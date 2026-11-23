# Phase 217: SERVERRULE - Pattern Map

**Mapped:** 2026-11-18
**Files analyzed:** 9 (2 source modified, 1 source touched for docstring only, 3 test files modified, 2 runbooks, CHANGELOG/VERSION)
**Analogs found:** 9 / 9 (every file extends or sits beside an existing analog; this is plumbing inside existing modules)

All paths are relative to the worktree root. Cite by SYMBOL in plans (`plan-anchor-verify`); line numbers below are orientation at HEAD `5ad0847ba` and drift on the first edit. Every analog below was confirmed git-tracked (`git ls-files`).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `analytics-service/services/mt5_server_clock.py` (add env const, malformed-map message, `parse_mt5_server_time_rules`, `select_mt5_server_clock`) | utility (stdlib leaf, config resolver) | transform | same file: `resolve_mt5_server_clock` + `_parse_fixed_offset_s` + `MT5_SERVER_CLOCK_CONFIG_MESSAGES` | exact (self) |
| `analytics-service/services/job_worker.py` (`run_derive_broker_dailies_job`: pre-read parse, post-read select, two-way mismatch arm) | service (job handler) | request-response | same function: `arm=server_clock_config` arm + `arm=server_clock_mismatch` arm | exact (self) |
| `analytics-service/services/mt5_server_clock_reading.py` (docstring only: `server_label_hash` "one consumer" claim) | utility | transform | same file | exact (comment-only edit) |
| `analytics-service/tests/test_mt5_server_clock.py` (parser/select unit tests; adapt 4 pins) | test | transform + AST | same file: `_FAULTS` table, `test_each_configuration_fault_has_its_own_message`, `test_single_reader`, `test_one_clock_per_derive` | exact (self) |
| `analytics-service/tests/test_mt5_derive_branch.py` (job-level J1..J11) | test | request-response | same file: `test_a_server_clock_mismatch_refuses_...`, `test_a_clock_configuration_fault_fails_transient_...`, `test_a_failing_server_clock_reading_insert_...` | exact (self) |
| `analytics-service/tests/conftest.py` (clear `MT5_SERVER_TIME_RULES`) | test config (autouse fixture) | config | `_mt5_server_clock_defaults_to_the_fixed_zero_form` | exact (self) |
| `analytics-service/tests/test_mt5_server_clock_readings_parity.py` (R1: optional fixed(0) row case) | test | transform | same file (existing key/CHECK parity) | role-match |
| `docs/runbooks/mt5-go-live.md` (server-clock step 3) | docs | n/a | same step 3 paragraph | exact (self) |
| `docs/runbooks/navmtm-chain-move-go-live.md` (pre-flight P6) | docs | n/a | same P6 paragraph | exact (self) |
| `CHANGELOG.md`, `VERSION`, `package.json` (ship) | docs/config | n/a | latest entry in `CHANGELOG.md` | process (see Shared Patterns) |

## Pattern Assignments

### `analytics-service/services/mt5_server_clock.py` (utility, transform)

**Analog:** itself. New code must look like `resolve_mt5_server_clock` and its closed-set messages.

**Import allow-list (HARD pin, `test_the_clock_module_is_a_stdlib_leaf`):** only `__future__, calendar, collections.abc, dataclasses, datetime, functools, math, os, typing`. No `re`, no `hashlib`, no `services.*`. The module already imports `os`, `Mapping`, `dataclass`, `Final`, `Literal` (header block, `from __future__ import annotations` ... `from typing import Final, Literal`). Add nothing.

**Env constant pattern** (top of module):
```python
MT5_SERVER_TIME_RULE_ENV = "MT5_SERVER_TIME_RULE"
MT5_SERVER_UTC_OFFSET_ENV = "MT5_SERVER_UTC_OFFSET_S"
MT5_DST_RULE_IDS: frozenset[str] = frozenset({"eu", "us"})
```
Add `MT5_SERVER_TIME_RULES_ENV = "MT5_SERVER_TIME_RULES"` beside them. Do NOT add `utc` to `MT5_DST_RULE_IDS` (would make `MT5_SERVER_TIME_RULE=utc` a valid default and break the unknown-rule fault table); `utc` exists only as a map VALUE, translated at parse time.

**Closed-set, value-free message pattern** (copy shape exactly: names variable and allowed grammar, never the value, ends `— fail loud`):
```python
_MALFORMED_OFFSET_MESSAGE = (
    "MT5_SERVER_UTC_OFFSET_S must be a whole number of seconds within plus or "
    "minus 13 hours — fail loud"
)
MT5_SERVER_CLOCK_CONFIG_MESSAGES: tuple[str, ...] = (
    _NEITHER_SET_MESSAGE,
    _UNKNOWN_RULE_MESSAGE,
    _BOTH_SET_MESSAGE,
    _MALFORMED_OFFSET_MESSAGE,
)
```
Add `_MALFORMED_RULES_MESSAGE` (must contain the substring `MT5_SERVER_TIME_RULES`; must NOT contain classifier phrases `trade server not found`, `invalid password`, `wrong password`, etc.; must not interpolate any part of the value) and append it to the tuple (length 5). Appending feeds `test_every_new_derive_message_is_blame_free_for_the_mt5_classifier` for free.

**Fail-loud resolver pattern to mirror** (strip once, lower-case once, empty means unset, raise the closed-set error):
```python
source = os.environ if environ is None else environ
rule = (source.get(MT5_SERVER_TIME_RULE_ENV) or "").strip().lower()
...
raise Mt5ServerClockConfigError(_UNKNOWN_RULE_MESSAGE)
```
**ASCII-strictness pattern** (why hex is checked by char set, not `isalnum`): `_parse_fixed_offset_s` uses `body.isascii() and body.isdigit()` because `int()`/`isdigit` accept non-ASCII. For the 64-hex key use `len(key) == 64 and set(key) <= set("0123456789abcdef")` (RESEARCH Don't Hand-Roll).

**Core pattern to add** (RESEARCH "Parser and selection" is the vetted shape; copy it): `parse_mt5_server_time_rules(environ=None) -> dict[str, Mt5ServerClock]` with `utc -> fixed_server_clock(0)`, `eu/us -> server_clock_for_rule(value)`, duplicate key a fault regardless of value, `a=us=eu` a fault (value branch), empty parts skipped, unset/empty/blank -> `{}`; and a frozen dataclass `Mt5ServerClockSelection(clock, mapped)` with `select_mt5_server_clock(default, rules, server_hash)` taking the ALREADY-computed hash (`None` -> default, `mapped=False`, never looked up). `mapped` is a returned flag, never `clock != default`.

**Decide and pin (A3):** whitespace around `=` tolerated (sketch strips key and value separately). Tests and runbook must state it.

---

### `analytics-service/services/job_worker.py` -> `run_derive_broker_dailies_job` (service, request-response)

**Analog:** the two arms in the same function.

**Import block to extend** (inside the function, the pre-read local imports, currently):
```python
from services.mt5_server_clock import (
    Mt5ServerClockConfigError,
    Mt5ServerClockMismatchError,
    assess_server_clock_reading,
    format_offset_hours,
    resolve_mt5_server_clock,
)
from services.mt5_server_clock_reading import (
    MT5_SERVER_CLOCK_READINGS_TABLE,
    build_mt5_server_clock_reading_row,
)
```
Add `parse_mt5_server_time_rules`, `select_mt5_server_clock` to the first, `server_label_hash` to the second.

**Config-fault arm (pre-read, EXTEND, do not change the arm):**
```python
try:
    _mt5_clock = resolve_mt5_server_clock()
except Mt5ServerClockConfigError as _clock_exc:
    logger.error(
        "derive_broker_dailies: mt5 server clock configuration fault "
        "(job=%s arm=server_clock_config) — %s",
        job.get("id"), _clock_exc,
    )
    return DispatchResult(
        outcome=DispatchOutcome.FAILED,
        error_message=f"derive_broker_dailies: {_clock_exc}",
        error_kind="transient",
    )
```
Change to bind `_mt5_default_clock = resolve_mt5_server_clock()` and `_mt5_server_rules = parse_mt5_server_time_rules()` INSIDE this same `try` (one `except`, one `arm=server_clock_config` log line; the existing test counts exactly one such line). Stay before `from services.broker_dailies import ...` and before any terminal call. The word `_mt5_clock` must NOT be bound here.

**Selection point (new, directly after the read, before the assessment).** Read site: `_mt5_info = _mt5_read.info` (PRE `account_info`). The first `_mt5_clock` use is `assess_server_clock_reading(_mt5_clock, ...)` after the lease block; insert the select immediately above `_mt5_tick = _mt5_read.tick`:
```python
_mt5_server_hash = server_label_hash(_mt5_info.get("server"))
_mt5_selection = select_mt5_server_clock(
    _mt5_default_clock, _mt5_server_rules, _mt5_server_hash
)
_mt5_clock = _mt5_selection.clock   # the ONLY binding of _mt5_clock
```
All eleven existing `_mt5_clock` uses (assessment, row builder, mismatch arm, `combine_mt5_deal_ledger`, `mt5_day_pnl` x2, `reconstruct_mt5_nav_levels`, `deal_utc_day`, `deal_utc_instant_ms`) stay byte-identical and read this one name. The hash must never be logged, tagged or put in `detail` (D-17).

**Assessment + row + insert (UNCHANGED; the insert arm precedes the new branch, so J9 holds):**
```python
_mt5_clock_assessment = assess_server_clock_reading(
    _mt5_clock,
    newest_tick_ms=None if _mt5_tick is None else _mt5_tick.newest_time_msc,
    utc_now_ms=int(_mt5_read.tick_read_at.timestamp() * 1000),
    tick_read_failed=_mt5_read.tick_read_failed,
)
...
server=_mt5_info.get("server"),
```
and `except Exception as _clock_insert_exc` ... `error_message=_MT5_CLOCK_READING_INSERT_MESSAGE`.

**Mismatch arm: branch on `_mt5_selection.mapped`.** Current arm (the MAPPED branch keeps this byte-identical; it is the refusal):
```python
if _mt5_clock_assessment.verdict == "mismatch":
    _mt5_clock_mismatch = Mt5ServerClockMismatchError(
        rule=_mt5_clock.rule,
        expected_offset_s=_mt5_clock_assessment.expected_offset_s or 0,
        measured_offset_s=_mt5_clock_assessment.measured_offset_s or 0,
    )
    logger.error(
        "derive_broker_dailies: mt5 server clock does not match the "
        "configured rule (job=%s api_key_id=%s arm=server_clock_mismatch "
        "rule=%s expected=%s measured=%s) — refusing before any write",
        job.get("id"), ctx.key_row["id"], _mt5_clock.rule,
        format_offset_hours(_mt5_clock_mismatch.expected_offset_s),
        format_offset_hours(_mt5_clock_mismatch.measured_offset_s),
    )
    await ops_alert.page(
        "mt5_server_clock",
        "clock_mismatch",
        event="outage",
        detail=(
            f"rule={_mt5_clock.rule} "
            f"expected={format_offset_hours(_mt5_clock_mismatch.expected_offset_s)} "
            f"measured={format_offset_hours(_mt5_clock_mismatch.measured_offset_s)}"
        ),
        extra_tags={"first_api_key_id": str(ctx.key_row["id"])},
    )
    return DispatchResult(
        outcome=DispatchOutcome.FAILED,
        error_message=f"derive_broker_dailies: {_mt5_clock_mismatch}",
        error_kind="transient",
    )
```
Construct `_mt5_clock_mismatch` once above the `if _mt5_selection.mapped:` split; mapped branch = existing log+page+return. **UNMAPPED branch (Q2 override):** same log shape but a DIFFERENT arm name that does not contain the substring `arm=server_clock_mismatch` (Pitfall 9; use `arm=server_clock_unmapped_drift`), page cause `unmapped_clock_mismatch` (matches `[a-z0-9_:.-]{1,64}`, no registry), identical `event="outage"`, identical hours-only `detail`, identical `extra_tags`, and NO `return` (fall through to the `classify_account_currency` step under the default clock). Log at ERROR (the existing test filters `levelno == logging.ERROR`). Never include server name or hash.

**Comment fixes (Pitfall 12):** the derive comment "`MT5_SERVER_TIME_RULE` stays the only carrier" and "ONE `_mt5_clock` resolved above" go stale; update text only.

---

### `analytics-service/services/mt5_server_clock_reading.py` (comment-only)

`server_label_hash` docstring: "its one consumer is the per-key equality check of criterion 4" becomes false once the hash is also a lookup key in operator config. Add one line (still unsalted by design; the operator needs the hash in the clear to configure the map). Do NOT touch logic: the row builder hashes `server_label_hash(server)` so chosen rule and row hash are equal by construction:
```python
"server_label_hash": server_label_hash(server),
```
Leaf-import rule here: it may import `services.mt5_probe` and `services.mt5_server_clock`; it must never import `services.job_worker`.

---

### `analytics-service/tests/test_mt5_server_clock.py` (test, transform + AST)

**Analog:** itself. Header imports to extend with the new public names:
```python
from services.mt5_server_clock import (
    MT5_SERVER_CLOCK_CONFIG_MESSAGES,
    Mt5ServerClock,
    Mt5ServerClockConfigError,
    fixed_server_clock,
    resolve_mt5_server_clock,
    server_clock_for_rule,
)
```
Local constants to reuse: `_RULE = "MT5_SERVER_TIME_RULE"`, `_OFFSET = "MT5_SERVER_UTC_OFFSET_S"`.

**Parser fault-table pattern** (clone `_FAULTS` + its test; `(environ, planted_value_no_message_may_echo)`):
```python
_FAULTS: list[tuple[dict[str, str], str | None]] = [
    ({}, None),
    ({_RULE: "summer"}, "summer"),
    ...
]

@pytest.mark.parametrize(("environ", "planted"), _FAULTS)
def test_the_resolver_fails_loud_with_a_closed_value_free_message(environ, planted):
    with pytest.raises(Mt5ServerClockConfigError) as raised:
        resolve_mt5_server_clock(environ)
    message = str(raised.value)
    assert message in MT5_SERVER_CLOCK_CONFIG_MESSAGES
    assert _RULE in message or _OFFSET in message
    if planted is not None:
        assert planted not in message
```
Add a `_RULES_FAULTS` table for the parser (no `=`; key 63/65 chars; UPPERCASE hex; non-hex char; empty key; values `fixed`, `summer`, empty; duplicate hash same value AND different value; `a=us=eu`) with hand-typed 64-hex literals (never computed from `server_label_hash`, Pitfall 4). `_RULE in message` is satisfied by `MT5_SERVER_TIME_RULES` (substring).

**Closed-set pin to ADAPT** (`test_each_configuration_fault_has_its_own_message`): currently
```python
assert len(MT5_SERVER_CLOCK_CONFIG_MESSAGES) == 4
assert len(set(MT5_SERVER_CLOCK_CONFIG_MESSAGES)) == 4
seen: set[str] = set()
for environ, _planted in _FAULTS:
    with pytest.raises(Mt5ServerClockConfigError) as raised:
        resolve_mt5_server_clock(environ)
    seen.add(str(raised.value))
assert seen == set(MT5_SERVER_CLOCK_CONFIG_MESSAGES)
```
Becomes 5, and `seen` must also union the texts reached by the parser table (the resolver table cannot reach the new text). Hand-typed literal `5`, not `len(...)`.

**Stdlib-leaf pin** `test_the_clock_module_is_a_stdlib_leaf`: UNCHANGED (it is the guard that no `re`/`hashlib` slipped in; do not widen `allowed`).

**Single-reader pin to ADAPT:**
```python
_SETTING_NAMES = frozenset({_OFFSET, _RULE})
```
add `"MT5_SERVER_TIME_RULES"` (separate local `_RULES = "MT5_SERVER_TIME_RULES"`), and the positive control in `test_single_reader` must also assert `clock_constants.count(_RULES) >= 1`. (Without this the exact-match scan would not notice a stray reader of the new name.)

**AST one-clock pin to ADAPT** (`test_one_clock_per_derive`). Current body:
```python
scope = _function(ast.parse(path.read_text(), filename=str(path)), "run_derive_broker_dailies_job")
assert len(_calls_to(scope, {"resolve_mt5_server_clock"})) == 1
assert _resolve_bound_to(scope, "_mt5_clock") == 1
sites = _calls_to(scope, _OFFSET_SITE_CALLS)
assert len(sites) == 6, ...
stray = [_call_name(c) for c in sites if not _passes_clock(c, "_mt5_clock")]
assert stray == [], ...
```
`_resolve_bound_to(scope, "_mt5_clock")` becomes 0 (resolve is bound to `_mt5_default_clock`, assert `== 1` for that target). Add, with the existing helpers (`_function`, `_calls_to`, `_call_name`, `_passes_clock`): exactly one `parse_mt5_server_time_rules` call; exactly one `select_mt5_server_clock` call; exactly one `ast.Assign` to `_mt5_clock` (from the selection); `assess_server_clock_reading` and `build_mt5_server_clock_reading_row` each receive the Name `_mt5_clock` (first positional / `clock=` keyword); the default-clock Name is loaded only as the select call's argument; offset sites still exactly 6 passing `_mt5_clock`. Ordering pin by `lineno`: resolve/parse line < the `read_mt5_deal_ledger` Name (it is an `ast.Name` argument to `asyncio.to_thread`, not a `Call`) < select line < first offset-site line.

---

### `analytics-service/tests/test_mt5_derive_branch.py` (test, request-response)

**Analog:** the Phase 155.1 block (helpers `_clock_derive_env`, `_clock_transport`, `_recording_page`, `_clock_readings`, `_PLANTED_SERVER`, `_CLOCK_NOW`).

**Fixture helpers to reuse verbatim:**
```python
_PLANTED_SERVER = "Planted-Server-Value"
_CLOCK_NOW = datetime(2026, 10, 28, 12, 0, 0, tzinfo=timezone.utc)

def _clock_readings(capture: dict) -> list[dict]:
    return [p for t, p in capture["inserts"] if t == "mt5_server_clock_readings"]

def _clock_derive_env(monkeypatch, *, rule: str = "us") -> None:
    monkeypatch.setenv("MT5_ENABLED", "true")
    monkeypatch.setenv("MT5_SERVER_TIME_RULE", rule)
    monkeypatch.delenv("MT5_SERVER_UTC_OFFSET_S", raising=False)
    monkeypatch.setattr("services.mt5_read._tick_read_now", lambda: _CLOCK_NOW)

def _clock_transport(tick_answer: object = None) -> _FakeMt5Transport:
    return _FakeMt5Transport(
        account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD",
                 "login": 123456, "server": _PLANTED_SERVER},
        deals=_canonical_deals(),
        tick_answer=tick_answer,
    )

def _recording_page(monkeypatch) -> AsyncMock:   # swaps jw.ops_alert for an AsyncMock page
```
A tick at `int(_CLOCK_NOW.timestamp() * 1000) + 7_200_000 - 100` is a +2h server; `... - 100` alone is +0h (UTC-keeping). Tick shape: `tick_answer=("answered", 1416, 14, 14, newest_tick_ms)`. Set the map with `monkeypatch.setenv("MT5_SERVER_TIME_RULES", f"{hashlib.sha256(b'planted-server-value').hexdigest()}=utc")` (independent `hashlib` over the trimmed casefolded name, Pitfall 4).

**J3 (adapt the existing refusal test, do NOT delete).** `test_a_server_clock_mismatch_refuses_the_derive_pages_once_and_keeps_its_reading` currently runs with an UNMAPPED server under `rule="us"` and a +2h tick, so under Q2 it would flip to the write-and-alert path. Add the MAPPED map entry (parametrize: map `us` with default `us`, and map `eu` with default `us`). Keep these assertions as the template:
```python
assert result.outcome == DispatchOutcome.FAILED
assert result.error_kind == "transient"
expected_text = str(Mt5ServerClockMismatchError(rule="us", expected_offset_s=10800, measured_offset_s=7200))
assert result.error_message == "derive_broker_dailies: " + expected_text
errors = [r.getMessage() for r in caplog.records
          if r.levelno == logging.ERROR and "arm=server_clock_mismatch" in r.getMessage()]
assert len(errors) == 1
assert "api_key_id=key-mt5" in errors[0]
assert capture["inserts"] == [("mt5_server_clock_readings", readings[0])]
assert capture["upserts"] == [] and capture["updates"] == [] and capture["rpc_calls"] == []
page.assert_awaited_once()
assert page.await_args.args == ("mt5_server_clock", "clock_mismatch")
assert page.await_args.kwargs["event"] == "outage"
assert "rule=us expected=+3h measured=+2h" in detail
assert not re.search(r"\d{5,}", detail)
assert page.await_args.kwargs["extra_tags"] == {"first_api_key_id": "key-mt5"}
for text in [result.error_message or "", detail] + [r.getMessage() for r in caplog.records]:
    assert _PLANTED_SERVER not in text
    assert readings[0]["server_label_hash"] not in text
```

**J4 (new, unmapped mismatch, same file idiom).** Same setup with NO map entry: assert `DONE`; `_clock_readings(capture)` has one row with `verdict == "mismatch"` and `configured_rule == "us"`; `page.assert_awaited_once()` with `args == ("mt5_server_clock", "unmapped_clock_mismatch")`, `event="outage"`, detail `rule=us expected=+3h measured=+2h`, `extra_tags == {"first_api_key_id": "key-mt5"}`; no `clock_mismatch` page; `capture["upserts"]` non-empty (the derive really persisted; Pitfall 10); reading inserted before any upsert (`capture["order"][0] == ("insert", "mt5_server_clock_readings")`); an ERROR log containing `arm=server_clock_unmapped_drift` and `api_key_id=key-mt5`, none containing `arm=server_clock_mismatch`; server name and hash absent from every record.

**J1/J2 (mapped utc).** Template: `test_a_leased_derive_reads_the_server_clock_and_persists_a_match_reading` (sets `MT5_SERVER_TIME_RULE="us"` + delenv `MT5_SERVER_UTC_OFFSET_S`, so the default is NOT the suite's fixed 0; Pitfall 3) with tick at `now - 100` and the map `<hash>=utc`: expect `row["verdict"] == "match"`, `row["configured_rule"] == "fixed"`, `row["expected_offset_s"] == 0 == row["measured_offset_s"]`, `row["server_label_hash"]` equal to the hashlib literal, no `mt5_server_clock` page. Dating (J2): copy the shape of `_derive_and_observe_apply_marks` / `_winter_deposit_after_the_read_deals` (patches `read_key_marks`, spies `apply_marks`); it builds the account WITHOUT a `server` key, so write a variant whose account dict carries `"server": _PLANTED_SERVER` and compare mapped-utc vs unmapped-default-`us` results on the same wall-time deposit.

**J8 (malformed map pre-read).** Clone `test_a_clock_configuration_fault_fails_transient_and_makes_no_terminal_read` (parametrize over malformed `MT5_SERVER_TIME_RULES` values; keep these assertions):
```python
assert result.outcome == DispatchOutcome.FAILED
assert result.error_kind == "transient"
fault_lines = [r.getMessage() for r in caplog.records
               if r.levelno == logging.ERROR and "arm=server_clock_config" in r.getMessage()]
assert len(fault_lines) == 1
message = result.error_message or ""
prefix = "derive_broker_dailies: "
assert message.startswith(prefix)
assert message[len(prefix):] in MT5_SERVER_CLOCK_CONFIG_MESSAGES
assert transport.calls == []
assert not any(u[0] == "strategy_analytics" for u in capture["upserts"])
assert not any(u[0] == "csv_daily_returns" for u in capture["upserts"])
```
Add: planted malformed value absent from message and log; plus a case with a VALID map and a faulty default (neither default variable set) still faulting.

**J9 (insert failure still refuses on an unmapped mismatch).** Parametrize the existing `test_a_failing_server_clock_reading_insert_fails_the_derive_transient` over a mismatching tick (it currently uses the default no-tick transport); its `_table` monkeypatch that makes `tbl.insert.side_effect` raise `APIError` for `mt5_server_clock_readings` is reusable verbatim. Assert `error_message == jw._MT5_CLOCK_READING_INSERT_MESSAGE` and that the `unmapped_clock_mismatch` page did not fire.

**Blame-free pin:** `test_every_new_derive_message_is_blame_free_for_the_mt5_classifier` already iterates `MT5_SERVER_CLOCK_CONFIG_MESSAGES` behind `"derive_broker_dailies: "` through `classify_mt5_login_error` and asserts `transient`; extending the tuple covers the new text with no test edit.

**Neuter evidence (project rule):** for P2, P4, P6, J1-J4, J8 neuter from a BYTE BACKUP (never `git checkout/restore/stash`), see RED, restore; record in the SUMMARY.

---

### `analytics-service/tests/conftest.py` (autouse fixture)

**Analog:** the existing fixture, extend it:
```python
@pytest.fixture(autouse=True)
def _mt5_server_clock_defaults_to_the_fixed_zero_form(monkeypatch):
    monkeypatch.setenv("MT5_SERVER_UTC_OFFSET_S", "0")
    monkeypatch.delenv("MT5_SERVER_TIME_RULE", raising=False)
```
Add `monkeypatch.delenv("MT5_SERVER_TIME_RULES", raising=False)` so a developer shell or CI value cannot leak into the 54+ MT5 tests. Tests that need a map `setenv` later in the test body, which wins over the fixture (same note already in the comment above the fixture).

---

### `analytics-service/tests/test_mt5_server_clock_readings_parity.py` (optional R1)

Existing parity file pins row keys and CHECK sets against the migration text. Optional: one case building a row under `fixed_server_clock(0)` asserting `configured_rule == "fixed"` and `expected_offset_s == 0` (evidence that no migration is needed; the migration CHECK is `configured_rule IN ('eu', 'us', 'fixed')`). Do not edit the applied migration; its `configured_rule` COMMENT ("MT5_SERVER_TIME_RULE stays the only carrier") is lineage, noted in the CHANGELOG.

---

### Runbooks (docs)

**`docs/runbooks/mt5-go-live.md`, server-clock step 3**, existing text to extend (insert after it, same paragraph voice):
```
Since Phase 175 the worker reads the broker offset as a rule, `MT5_SERVER_TIME_RULE`
(`eu` or `us`, +2 h in winter and +3 h in summer) or, for a broker without daylight
saving, `MT5_SERVER_UTC_OFFSET_S` alone (whole seconds); never both and never neither
(each is a fail-loud configuration error: the derive retries, then stamps the strategy
with the automatic-retries sentence).
```
**`docs/runbooks/navmtm-chain-move-go-live.md`, pre-flight P6**, existing text to extend: P6 currently says `**Abort if** the setting is absent on any of those services, both variables are set, or the setting disagrees with the reading`. Update so (a) the per-server entry is read on BOTH services (`quantalyze-analytics`, `quantalyze-analytics-backfill`), and (b) an UNMAPPED mismatch no longer refuses in the worker (it pages and continues), so P6's abort condition becomes the operator's check.

Both docs gain (RESEARCH "Runbooks" list): variable name and grammar `<64-hex>=eu|us|utc`, comma separated, lower-case hex, no duplicates; `utc` is fixed offset 0 and shows as `configured_rule = fixed`; how to read the full hash (read-only `SELECT DISTINCT server_label_hash FROM public.mt5_server_clock_readings WHERE api_key_id = '<key uuid>'`, marker query first); malformed map fails EVERY MT5 derive pre-read (transient, retries then `failed_final`); unmapped mismatch pages and continues, mapped mismatch refuses; set-before-deploy ordering on both services; a no-echo validation one-liner printing only a count. Tracked text uses `<64-hex>` placeholders and hash PREFIXES only (public repo).

---

## Shared Patterns

### Value-free closed-set errors (T-134-01, D-17)
**Source:** `services/mt5_server_clock.py` (`MT5_SERVER_CLOCK_CONFIG_MESSAGES`, `Mt5ServerClockMismatchError`)
**Apply to:** the new malformed-map message, the unmapped-drift log, the new page. Messages name variables and allowed grammar; the page `detail` is `rule=<id> expected=<+Nh> measured=<+Nh>` (`format_offset_hours`, HOURS so `10800` never trips the `scrub_alert_detail` 5+ digit mask). Server name and hash never appear in `detail`, `extra_tags`, `error_message` or any log line; key id (uuid) is allowed.

### Pre-read config fault, transient (175 / D-04, Pitfall 3)
**Source:** `run_derive_broker_dailies_job`, `arm=server_clock_config` arm (excerpt above)
**Apply to:** `MT5_SERVER_TIME_RULES` parse faults. Same single `try`/`except Mt5ServerClockConfigError`, `FAILED` + `error_kind="transient"`, no stamp, no write, no terminal call.

### ops_alert.page convention
**Source:** `run_derive_broker_dailies_job`, `clock_mismatch` page
**Apply to:** the new unmapped page. `await ops_alert.page("mt5_server_clock", <cause>, event="outage", detail=..., extra_tags={"first_api_key_id": str(ctx.key_row["id"])})` awaited on the event loop (never inside `to_thread`); `page` never raises and windows per `(source, cause, event)` per hour, so a new cause gets its own hourly window and cannot starve `clock_mismatch`. Source `mt5_server_clock` is already in `OPS_ALERT_SOURCES`; cause charset `[a-z0-9_:.-]{1,64}`; no cause registry or TS edit.

### Neuter-and-restore evidence
**Source:** project CLAUDE.md / memory ("gates must be able to fail")
**Apply to:** every new test row; restore from a byte backup, never `git checkout/restore/stash` on uncommitted work. The suite default is fixed 0 == the `utc` clock, so mapped-utc tests MUST override the default to `us` or they pass with the selection deleted.

### Gates to run (agent-gates-include-mypy)
From `analytics-service/` only: `python3 -m pytest tests/test_mt5_server_clock.py tests/test_mt5_server_clock_reading.py tests/test_mt5_server_clock_readings_parity.py tests/test_mt5_derive_branch.py -q`; `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`; then from repo root `npx vitest run src/__tests__/tiny-base-literal-pin.test.ts src/__tests__/options-cash-basis-literal-pin.test.ts src/__tests__/nav-marks-start-literal-pin.test.ts` as a smoke check after editing `job_worker.py`. Always `grep -a`.

### CHANGELOG discipline (project rule)
**Source:** `CHANGELOG.md` latest entry; CLAUDE.md "CHANGELOG discipline"
**Apply to:** the ship commit `chore(release): vX.Y.Z.B - <name>`: `VERSION` and `package.json` byte-equal 4-digit strings (never `npm version`); sections from this repo's vocabulary: `Added` (variable, parser, selection, new alert cause), `Changed` (dated founder override of 155.1 D-01 for UNMAPPED servers with its accepted cost; named explicitly), `Tests`, `Notes` (no migration; migration `configured_rule` COMMENT is lineage; `202-MT5-CLOCK-LEAD-01` NOT closed, so no `TODOS.md` deletion). Never write a CI-skip token, not even to deny it. No AI attribution trailers. Ship branch must change nothing under `.planning`.

## No Analog Found

None. The only construct without a direct twin is the two-way mismatch arm (mapped refuses, unmapped writes and alerts); it is built from the existing mismatch arm by splitting it, and the unmapped branch is the existing arm minus the `return` plus a new cause and a distinct arm name.

## Metadata

**Analog search scope:** `analytics-service/services/{mt5_server_clock,mt5_server_clock_reading,job_worker}.py`, `analytics-service/tests/{test_mt5_server_clock,test_mt5_derive_branch,conftest}.py`, `docs/runbooks/{mt5-go-live,navmtm-chain-move-go-live}.md`
**Files scanned:** 8 read in targeted ranges (job_worker.py is large; read by grep-located ranges)
**Pattern extraction date:** 2026-11-18

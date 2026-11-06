# Phase 175: MT5OFFSET - Pattern Map

**Mapped:** 2026-10-27
**Files analyzed:** 14 (2 new modules/scripts + 1 new test pair, 7 modified source, 3 docs/tests)
**Analogs found:** 13 / 14 (all paths git-tracked; verified with `git ls-files`)

All paths are under ``. Line numbers were read at this worktree's HEAD.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `analytics-service/services/mt5_server_clock.py` (NEW) | utility (pure leaf + env resolver) | transform | `analytics-service/services/mt5_deals.py` (pure leaf, fail-loud) + `services/closed_sets.py:141` (env gate) | role-match |
| `analytics-service/services/mt5_deals.py` (mod) | utility (the one seam) | transform | itself, lines 184-307 | exact |
| `analytics-service/services/broker_dailies.py` (mod, 5 annotations) | service | transform | itself (`_fold_mt5_deals` :700, `combine_mt5_deal_ledger` :809, `reconstruct_mt5_nav_levels` :956, `mt5_day_pnl` :1074, `_mt5_flow_day_timing` :620) | exact |
| `analytics-service/services/job_worker.py` (mod, 6 reads) | service (job) | batch / request-response | itself, `:5915` kill-switch gate + reads at `:6584 :6591 :6611 :6715 :6731 :7543` | exact |
| `analytics-service/services/equity_reconstruction.py` (mod, 1 read + 1 message key) | service (job) | batch | itself, `:5033` and `_MT5_BACKFILL_MESSAGES` `:4452` | exact |
| `analytics-service/scripts/mt5offset_dry_run.py` (NEW) | utility (script, read-only report) | batch / transform | `analytics-service/scripts/flowtiming_dry_run.py` | exact |
| `analytics-service/tests/test_mt5_server_clock.py` (NEW) | test | transform | `analytics-service/tests/test_mt5_deal_timing.py` | role-match |
| `analytics-service/tests/test_mt5offset_dry_run.py` (NEW) | test | batch | `analytics-service/tests/test_flowtiming_dry_run.py` | exact |
| `analytics-service/tests/conftest.py` (mod, autouse env fixture) | test config | n/a | same file `:401` `_mt5_known_servers_admit_the_suites_synthetic_servers` | exact |
| `analytics-service/tests/test_mt5_deal_timing.py`, `test_mt5_deal_reconstruction.py`, `test_mt5_derive_branch.py`, `test_equity_reconstruction.py` (extend) | test | transform | themselves | exact |
| `docs/runbooks/navmtm-chain-move-go-live.md` (mod) | doc | n/a | same file `## Pre-flight` `:154-182` (P0..P5) | exact |
| `docs/runbooks/mt5-go-live.md` (mod) | doc | n/a | same file Step 2 item 3 `:194-196` | exact |
| `CHANGELOG.md`, `VERSION`, `package.json` (ship) | config | n/a | repo CHANGELOG discipline (CLAUDE.md); `CHANGELOG.md:50` is the line to close | exact |
| Single-reader source pin (inside `test_mt5_server_clock.py`) | test | source scan | `analytics-service/tests/test_mt5_abandon_roster.py` (ast-parses source files by path) | partial |

## Pattern Assignments

### `analytics-service/services/mt5_server_clock.py` (NEW; utility, transform)

**Analog 1:** `analytics-service/services/mt5_deals.py` for the leaf discipline: stdlib only, no network/pandas, `from __future__ import annotations`, fail-loud messages that name the FIELD never a value.

**Leaf module header to copy** (mt5_deals.py:1-13): module docstring stating "imports ONLY the standard library + typing", then
```python
from __future__ import annotations

from datetime import datetime, timedelta, timezone
```

**Fail-loud message style** (mt5_deals.py:184-189):
```python
def _require_offset_seconds(server_utc_offset_s: Any) -> None:
    if isinstance(server_utc_offset_s, bool) or not isinstance(server_utc_offset_s, int):
        raise Mt5DealClassificationError(
            "MT5 server_utc_offset_s must be an int (seconds) — fail loud"
        )
```
Never put a broker server name, login or amount in a message (T-134-01, leak-safety T-136-02/03). The config error must be a NEW exception class that is NOT a subclass of `Mt5DealClassificationError` (RESEARCH Pattern 2, Pitfall 3).

**Analog 2 (env read shape):** `analytics-service/services/closed_sets.py:141-143`
```python
def mt5_enabled_server() -> bool:
    """True iff MT5_ENABLED is set to "true" (fail-closed; see module note)."""
    return (os.getenv("MT5_ENABLED") or "").strip().lower() == "true"
```
Copy `(os.getenv(...) or "").strip().lower()` normalization once; unknown after that is an error. Resolver table, rule algorithm (`_nth_sunday`, `_dst_window_utc` with `lru_cache`, candidate formulation) and golden vectors are in RESEARCH Pattern 1 and Pattern 2 (use as the code to write; no repo analog has them). Restate `_MT5_MAX_SERVER_UTC_OFFSET_S = 13 * 3600` (source: `services/mt5_read.py:93`) in the leaf; do NOT import `mt5_read` (pulls the client stack); add a parity test.

---

### `analytics-service/services/mt5_deals.py` (modify; the one seam)

**Analog:** itself. Edit in place, keep behavior for ints.

**Validation to widen** (mt5_deals.py:184-189, shown above): keep rejecting `bool`/`float`/`str`/`None` with the SAME text (pinned by `test_mt5_deal_timing.py:153-158`), additionally accept `Mt5ServerClock`; wrap an int as a fixed clock.

**Single epoch parser, reused** (mt5_deals.py:192-213, `_server_epoch_seconds`): do not add a second parser; the day and the instant must keep sharing it.

**Day conversion site to make per-deal** (mt5_deals.py:216-242):
```python
def _utc_day_of_server_epoch(epoch: float, server_utc_offset_s: int) -> str:
    try:
        utc_epoch = epoch - server_utc_offset_s
        return datetime.fromtimestamp(utc_epoch, tz=timezone.utc).date().isoformat()
    except (OverflowError, OSError, ValueError) as exc:
        raise Mt5DealClassificationError(
            "MT5 deal time is out of the datable epoch range — fail loud"
        ) from exc
```
**Instant site** (mt5_deals.py:285-307): `instant_ms = server_ms - server_utc_offset_s * 1000`, then the day-agreement oracle `return instant_ms if instant_day == day else None`. Keep that oracle. For a clock: day uses first-occurrence/pre-transition offset; instant returns `None` for a repeated or missing hour (D-07).

**Docstring to rewrite** (mt5_deals.py:277-280, "Known limit (Pitfall 3 ...) The order of deals and flows within the broker clock is exact either way"): stale since NAVMTM D-23 (REVIEW-3 WR-02). Year-range guard (RESEARCH Open Question 5) raises `Mt5DealClassificationError` in the same style as the out-of-range raise above.

---

### `analytics-service/services/broker_dailies.py` (modify; annotations only)

**Analog:** itself. Change `server_utc_offset_s: int` to `int | Mt5ServerClock` at `:620` (`_mt5_flow_day_timing`), `:700` (`_fold_mt5_deals`), `:809` (`combine_mt5_deal_ledger`, keyword-only, default 0), `:956` (`reconstruct_mt5_nav_levels`), `:1074` (`mt5_day_pnl`). All reach the seam via `_fold_mt5_deals` (`:886 :1021 :1089`); `_mt5_flow_day_timing` calls `deal_utc_instant_ms` at `:653`. Keep the `= 0` defaults (surgical). Keep the parameter name.

---

### `analytics-service/services/job_worker.py` (modify; batch, six reads)

**Analog:** itself. Resolve ONCE right after the kill-switch gate (job_worker.py:5915-5921):
```python
if not mt5_enabled_server():
    return DispatchResult(
        outcome=DispatchOutcome.FAILED,
        error_message=f"derive_broker_dailies: {MT5_DISABLED_DETAIL}",
        error_kind="permanent",
    )
```
Copy this exact shape for the config fault: `DispatchResult(outcome=DispatchOutcome.FAILED, error_message=..., error_kind="permanent")` with NO `_stamp_strategy_analytics_failed` (RESEARCH Pattern 2, Pitfall 3). Then replace the six identical reads with one `_mt5_clock` variable:

- `:6584` `combine_mt5_deal_ledger(..., server_utc_offset_s=int(os.getenv("MT5_SERVER_UTC_OFFSET_S", "0")), floors=...)`
- `:6591` `mt5_day_pnl(_mt5_deals, server_utc_offset_s=int(os.getenv(...)))`
- `:6611` `reconstruct_mt5_nav_levels(...)` (multi-line `os.getenv(` at `:6610-6612`)
- `:6713-6716` `deal_utc_day(_deal.get("time"), int(os.getenv(...)))` feeds `_mt5_flow_by_day`
- `:6730-6732` `deal_utc_instant_ms(_deal, int(os.getenv(...)))` feeds `_event_flow_instants`
- `:7543` `mt5_day_pnl(...)` inside `_apply_day_pnl`

Sites 4 and 5 must use the same clock object (Pitfall 4: day and instant must come from one clock). Check that `_apply_day_pnl` (a closure) can see the variable.

---

### `analytics-service/services/equity_reconstruction.py` (modify; batch)

**Analog:** itself. Site `:5028-5036`:
```python
try:
    nav, meta = reconstruct_mt5_nav_levels(
        deals, equity, balance,
        server_utc_offset_s=int(os.getenv("MT5_SERVER_UTC_OFFSET_S", "0")),
        floors=_unit.floors,
    )
except Mt5DealClassificationError as exc:
```
Resolve the clock before this try; a config fault uses `_fail(<new key>, "transient")` (RESEARCH Pattern 2). Add the new key to `_MT5_BACKFILL_MESSAGES` (`:4452`), copying the entry shape:
```python
_MT5_BACKFILL_MESSAGES: dict[str, str] = {
    "kill_switch": f"reconstruct_allocator_history: {MT5_DISABLED_DETAIL}",
    "auth": (
        "reconstruct_allocator_history: the MT5 terminal refused the stored "
        "sign-in for this key — reconnect ..."
    ),
```
Sibling census before adding: grep `_MT5_BACKFILL_MESSAGES` and `history_unsettled`; `tests/test_reconstruct_whole_account.py:1797-1883` maps messages to arms, and `test_no_mt5_backfill_message_is_classifier_matchable` is an exhaustive proof over the set (the new message must not be classifier-matchable).

---

### `analytics-service/scripts/mt5offset_dry_run.py` (NEW; read-only report, batch)

**Analog:** `analytics-service/scripts/flowtiming_dry_run.py` (exact role and flow).

**Module docstring contract to copy** (lines 1-34): a pure read-only comparison, never opens a DB connection or a socket, writes no file except where `--out` names one; "REDACTION. The report speaks in ordinals, counts ... Identifiers, emails, logins and amounts are never rendered: ordinals come from list position".

**Imports/header** (lines 35-55): `from __future__ import annotations`, `argparse, json, ...`, `from services.broker_dailies import ...`.

**Redaction helper to copy** (lines 111-123):
```python
_UUID_RE = re.compile(r"[0-9a-fA-F]{8}-...-[0-9a-fA-F]{12}")
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_LONG_DIGITS_RE = re.compile(r"\d{9,}")
_HOME_RE = re.compile(r"/(?:Users|home)/\S*")

def _scrub(text: str) -> str:
    out = _UUID_RE.sub("[redacted]", str(text))
    out = _EMAIL_RE.sub("[redacted]", out)
    out = _HOME_RE.sub("[redacted]", out)
    return _LONG_DIGITS_RE.sub("[redacted]", out)
```
**Captured-ledger input shape**: `{"offset_s": int, "keys": {id: {"status": "captured", "deals", "equity", "balance", "currency"}}}` (read at flowtiming_dry_run.py:528 via `captured.get("offset_s", 0)`).

**CLI shape** (lines 1029-1062): `main(argv: Sequence[str] | None = None) -> int` with `argparse`, `--captured`, `--out`, `--note` (scrubbed), `if __name__ == "__main__": raise SystemExit(main())`. Output: counts and ordinals only (deals/flow deals whose UTC day changes between legacy int and rule, distinct days, deals in the repeated/missing hour).

---

### `analytics-service/tests/test_mt5_server_clock.py` (NEW; test)

**Analog:** `analytics-service/tests/test_mt5_deal_timing.py`.

**Header and helper to copy** (lines 1-40 of that file):
```python
from datetime import datetime, timedelta, timezone
import pytest
from services.mt5_deals import (..., Mt5DealClassificationError, deal_utc_day, deal_utc_instant_ms)

def _server_epoch(year, month, day, hour=0, minute=0, second=0) -> int:
    """A broker-server-time epoch (seconds): the server wall clock read as if it were UTC."""
    return int(datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc).timestamp())
```
**Validation pin that must keep passing** (test_mt5_deal_timing.py:153-158):
```python
@pytest.mark.parametrize("bad_offset", [True, 3.5, "10800", None])
def test_the_offset_is_validated_exactly_as_deal_utc_day_validates_it(bad_offset):
    with pytest.raises(Mt5DealClassificationError) as day_err:
        deal_utc_day(1_741_615_507, bad_offset)  # type: ignore[arg-type]
    ...
    assert str(instant_err.value) == str(day_err.value)
```
Oracle must be `zoneinfo` (`Europe/Athens`; `America/New_York` with +7 h), NOT a second copy of the formulas (CLAUDE.md independent invariants). Golden vectors: RESEARCH Pattern 1 table (16 rows). SC-2 anchor test: RESEARCH "Code Examples" reviewer repro through `apply_marks` (RED under fixed 10800, cum 0.549804 versus 0.02). Single-reader pin: scan `services/` and `routers/` by path for `MT5_SERVER_UTC_OFFSET_S` outside `mt5_server_clock.py`; for the file-scan technique copy `tests/test_mt5_abandon_roster.py` (line 42: source files are read by path and `ast.parse`d; never `inspect.getsource`). Neuter proof (resolver forced to fixed 10800 must go RED), restored from a byte backup.

---

### `analytics-service/tests/conftest.py` (modify; autouse fixture)

**Analog:** same file, `conftest.py:401-409`:
```python
@pytest.fixture(autouse=True)
def _mt5_known_servers_admit_the_suites_synthetic_servers(monkeypatch):
    from services import mt5_probe

    monkeypatch.setenv("MT5_KNOWN_SERVERS", ",".join(_SUITE_MT5_SERVERS))
    mt5_probe._reset_server_unknown_alerts_for_tests()
    yield
    mt5_probe._reset_server_unknown_alerts_for_tests()
```
Add a sibling autouse fixture `monkeypatch.setenv("MT5_SERVER_UTC_OFFSET_S", "0")` (and `delenv("MT5_SERVER_TIME_RULE", raising=False)`) so the ~54 tests that lean on the silent default keep passing (RESEARCH Pitfall 2). Fail-loud-table tests `monkeypatch.delenv` in their own body. Re-run the simulated-unset census over the whole `tests/` tree first.

---

### `analytics-service/tests/test_mt5offset_dry_run.py` (NEW)

**Analog:** `analytics-service/tests/test_flowtiming_dry_run.py` (exists; not read in this pass, planner should open it to copy its synthetic-captured-ledger fixture and its "no id/amount in output" assertion shape). Synthetic data only, no server name.

---

### `docs/runbooks/navmtm-chain-move-go-live.md` (modify)

**Analog:** same file `## Pre-flight — ALL BLOCKING` (lines 154-182). Items are bold-ID bullets `- **P0 — ... .**` with an explicit "**Abort if** ..." clause. Add a new item additively (e.g. `P6`) naming the server-clock reading (rule id, date, server minus UTC in whole hours only, never the server name). Do not renumber (Pitfall 8).

### `docs/runbooks/mt5-go-live.md` (modify)

**Analog:** Step 2 item 3 (lines 194-196): "Verify the VNC-displayed **server clock** against UTC to confirm the broker-server-time offset ...". Add one sentence naming the rule id; do not renumber (`scripts/prod-prober/arms/mt5.mjs:120`, `run.mjs:4581` and `src/__tests__/prod-prober-wiring.test.ts:3062` cite "Step 2").

## Shared Patterns

### Fail loud, name the variable not a value
**Source:** `services/mt5_deals.py:184-189`, `:206-213`
**Apply to:** `mt5_server_clock.py` resolver, seam widening, year-range guard. Messages carry field/variable names and allowed rule ids only.

### One resolver, one clock per derive
**Source:** replaces the seven `int(os.getenv("MT5_SERVER_UTC_OFFSET_S", "0"))` reads (list above). **Apply to:** `job_worker.py` MT5 branch (resolve after the `mt5_enabled_server()` gate), `equity_reconstruction.py`. Enforce with the single-reader source test.

### Config fault disposition
**Source:** `job_worker.py:5915-5921` (kill-switch `DispatchResult(... error_kind="permanent")`) for the derive; `_fail(<key>, "transient")` + `_MT5_BACKFILL_MESSAGES` for the backfill. Never `Mt5DealClassificationError` (it maps to a user-facing analytics stamp).

### Redaction / public repo
**Source:** `scripts/flowtiming_dry_run.py:111-123` (`_scrub`, ordinals). **Apply to:** the dry-run script, runbook notes, SUMMARY. No broker server name (T-134-01), no amounts, no ids, no home paths.

### Test-suite default env
**Source:** `tests/conftest.py:401` autouse-fixture precedent. **Apply to:** all MT5-driving tests.

### CI/mypy and ship discipline
`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` from `analytics-service/` (new module is under `services/`). CHANGELOG entry plus byte-equal 4-digit `VERSION`/`package.json` in one commit; entry closes `CHANGELOG.md:50`. No CI skip tokens, no Co-Authored-By/Claude-Session trailers. Ship branch changes nothing under `.planning`.

## No Analog Found

| File / Concern | Role | Data Flow | Reason |
|----------------|------|-----------|--------|
| DST rule algorithm inside `mt5_server_clock.py` (`_dst_window_utc`, candidate consistency, tie-break) | utility | transform | No tz-rule code exists in the repo; use RESEARCH Pattern 1 prototype (validated against `zoneinfo` on 420,864 quarter-hours). Oracle in tests is `zoneinfo`. |
| Pytest single-reader source pin for an env var | test | source scan | `test_mt5_abandon_roster.py` is the closest technique (ast scan by path), but no existing test pins "no env reader outside module X"; write it new. |

## Metadata

**Analog search scope:** `analytics-service/services/`, `analytics-service/scripts/`, `analytics-service/tests/`, `docs/runbooks/`
**Files read:** mt5_deals.py (1-40, 150-319), flowtiming_dry_run.py (1-125, 1029-1062), test_mt5_deal_timing.py (1-48, 150-175), conftest.py (395-420), job_worker.py and equity_reconstruction.py targeted ranges, both runbooks (targeted), closed_sets.py (141-163)
**Tracked check:** `git ls-files` printed `services/mt5_deals.py`, `scripts/flowtiming_dry_run.py`, `tests/test_mt5_deal_timing.py`, `services/mt5_read.py`, `tests/conftest.py`, both runbooks; no gitignored mirror paths used.
**Pattern extraction date:** 2026-10-27

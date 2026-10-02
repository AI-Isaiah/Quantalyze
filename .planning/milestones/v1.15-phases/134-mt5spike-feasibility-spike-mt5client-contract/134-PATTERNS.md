# Phase 134: MT5SPIKE — Feasibility spike + `Mt5Client` contract - Pattern Map

**Mapped:** 2026-07-23
**Files analyzed:** 4 new files
**Analogs found:** 3 / 4 (the go/no-go doc has no code analog — uses the RESEARCH template)

## File Classification

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `analytics-service/services/mt5_client.py` (`Mt5Client` + `Mt5ClientError`) | service / network-client | request-response (sync RPyC) | `analytics-service/services/sfox_client.py` (`SfoxClient` + `SfoxApiError`) | exact posture, different transport (RPyC not aiohttp; sync not async) |
| `analytics-service/tests/test_mt5_client_contract.py` | test (offline contract, CI gate) | request-response (injected double) | `analytics-service/tests/test_sfox_client.py` | exact (pure-unit, injected transport seam) |
| `analytics-service/scripts/mt5_spike.py` | script / live harness (`human_needed` to run) | batch / CLI + report emit | `analytics-service/scripts/deribit_ground_truth.py` (main/exit-codes/scrub) + `sfox_ground_truth.py` | role-match (CLI harness, secret-scrubbed report, exit codes) |
| `.planning/phases/134-.../MT5_GONOGO.md` (go/no-go doc template) | documentation | — | none (see RESEARCH.md lines 381–394 template) | no analog |

---

## Pattern Assignments

### `analytics-service/services/mt5_client.py` (`Mt5Client` + `Mt5ClientError`)

**Analog:** `analytics-service/services/sfox_client.py`. Mirror its posture method-for-method: module docstring stating the read-only contract, a typed fail-loud error class carrying a status/code, a single chokepoint, env-tunable timeout constants, and a bounded/idempotent close. **Key divergences (RESEARCH.md Pattern 1, lines 165–171):** synchronous (no `async`/`aiohttp` — rpyc classic is blocking), timeout set via constructor not per-request, structural read-only = facade composition (never wrap `order_send`).

**Imports + module-level docstring/constants pattern** — mirror `sfox_client.py` lines 36–66. sFOX declares its timeout knobs with rationale comments tying them to the ~90s healthz budget / v1.11 worker-wedge class:
```python
# sfox_client.py:36-66 (the template to mirror)
from __future__ import annotations
import asyncio, json, logging, os, time
from typing import Any
import aiohttp                                    # -> mt5: import mt5linux / rpyc lazily instead
from services.redact import scrub_freeform_string
logger = logging.getLogger("quantalyze.analytics")
...
SFOX_REQUEST_TIMEOUT_S = float(os.getenv("SFOX_REQUEST_TIMEOUT_S", "30"))
```
For MT5, define the two-timeout pair the RESEARCH mandates (Pitfall 3, lines 221–227) with the ordering rationale in the comment (RESEARCH.md sketch lines 278–279):
```python
MT5_REQUEST_TIMEOUT_S = float(os.getenv("MT5_REQUEST_TIMEOUT_S", "30"))   # rpyc sync_request_timeout
MT5_LOGIN_TIMEOUT_MS  = int(os.getenv("MT5_LOGIN_TIMEOUT_MS", "20000"))   # MT5 IPC ceiling, MUST be < rpyc
```

**Typed fail-loud error class** — copy the shape of `SfoxApiError` (`sfox_client.py` lines 82–93). It carries `status` so callers distinguish auth failures; the message NEVER contains a secret; embedded text is scrubbed at construction:
```python
# sfox_client.py:82-93
class SfoxApiError(RuntimeError):
    def __init__(self, status: int, detail: str) -> None:
        self.status = status
        super().__init__(f"sFOX API error (status={status}): {detail}")
```
`Mt5ClientError` mirrors this but carries the MT5 `(code, text)` from `last_error()` and scrubs the text (RESEARCH.md sketch lines 281–285):
```python
class Mt5ClientError(RuntimeError):
    def __init__(self, code: int, detail: str) -> None:
        self.code = code
        super().__init__(f"MT5 client error (code={code}): {scrub_freeform_string(detail)}")
```

**Injectable transport seam** — sFOX injects `_clock`/`_sleep` (ctor kwargs, `sfox_client.py` lines 99–129) to make the rate gate testable offline. Mt5Client injects `_connect` the same way so the offline suite drives a fake RPyC connection with no live terminal/network/Windows import (RESEARCH.md Pattern 4, lines 183–186; sketch lines 290–294):
```python
def __init__(self, host, port, *, _connect=None, request_timeout_s=MT5_REQUEST_TIMEOUT_S):
    connect = _connect or _default_connect        # injectable for offline tests
    self._mt5 = connect(host=host, port=port, timeout=request_timeout_s)
    self._closed = False
```

**Structural read-only = HARDCODE, not convention** — sFOX enforces this two ways: no public write methods AND `_request` has no `method` param (the verb is hardcoded to GET). See the load-bearing comment at `sfox_client.py` lines 179–184:
```python
# The HTTP verb is HARDCODED to GET (WR-03): read-only is enforced
# STRUCTURALLY at the one place that talks to the network, not merely by the
# absence of public write methods. There is no `method` parameter...
```
For MT5 the structural equivalent is **facade composition** (RESEARCH.md Pitfall 2, lines 215–219): expose ONLY `login`, `account_info`, `history_deals_get`, `order_check` (probe), `close`. NO `__getattr__` passthrough, NO `order_send` wrapper — even though the underlying `mt5linux` client exposes the full surface.

**`None` (error) vs `()` (honest empty) fail-loud discipline** — this is the highest-severity correctness pattern (RESEARCH.md Pitfall 1, lines 209–213). sFOX's analog is its fail-loud shape guards (`sfox_client.py` lines 274–277, 310–312, and `_unwrap_data` lines 347–356) which raise rather than coerce a missing envelope to `[]`. MT5 must capture `last_error()` IMMEDIATELY on any `None`/falsy return, then raise (RESEARCH.md sketch lines 296–316):
```python
def _raise_last(self) -> None:                     # capture last_error() IMMEDIATELY
    err = self._mt5.last_error()
    code, text = (err[0], err[1]) if err else (0, "unknown")
    raise Mt5ClientError(int(code), str(text))

def history_deals_get(self, from_ts, to_ts) -> list[dict]:
    deals = self._mt5.history_deals_get(from_ts, to_ts)
    if deals is None:                              # ERROR (never () — () is honest empty)
        self._raise_last()
    return [_materialize(d) for d in deals]        # () -> [] honest empty; else materialize
```
Do NOT write `if not deals:` (conflates `None` with `()`). Use `is None` (RESEARCH.md anti-patterns, lines 188–193).

**Netref → native materialization** — sFOX has no exact analog (aiohttp returns plain JSON via `json.loads`, `sfox_client.py` line 259), but the intent (callers never hold a live transport object) matches. RPyC returns netref proxies for namedtuples; materialize via `._asdict()` and fail loud on a degenerate shape (RESEARCH.md Pattern 3, lines 178–181; sketch lines 333–337):
```python
def _materialize(obj: Any) -> dict:
    if hasattr(obj, "_asdict"):
        return {str(k): _coerce(v) for k, v in obj._asdict().items()}
    raise Mt5ClientError(0, "MT5 returned a non-namedtuple/degenerate shape")
```

**Bounded, idempotent close** — mirror `SfoxClient.aclose` (`sfox_client.py` lines 358–381): `if self._closed: return`, flip the flag, swallow close errors so a teardown failure never masks the caller's error. MT5's is synchronous (`shutdown()` not `await session.close()`) — RESEARCH.md sketch lines 324–331.

**Secret hygiene** — every error text passes through `services.redact.scrub_freeform_string` (signature: `scrub_freeform_string(s: Any) -> Any`, `redact.py:239`). See Shared Patterns below.

---

### `analytics-service/tests/test_mt5_client_contract.py` (offline contract, CI gate)

**Analog:** `analytics-service/tests/test_sfox_client.py`. This is the load-bearing CI gate — it MUST be green with zero live dependencies (no terminal, no network, no `MetaTrader5`/Windows import) so phases 135/136 stub against a proven contract shape.

**Module docstring must encode WHY each case matters (Rule 9)** — copy the structure of `test_sfox_client.py` lines 1–32: a "Regression gates — WHY each case matters" block. Each MT5 test states the business consequence of the wiring breaking (e.g. "`None`→raise: conflating error with empty fabricates a flat account — the exact `no-invented-data` violation `api_verified` exists to prevent").

**Test the real wiring via an injected seam, never a self-referential helper** — sFOX patches `aiohttp.ClientSession.request` with an `AsyncMock` and asserts on the exact call kwargs (`test_sfox_client.py` lines 53–83). MT5's equivalent is the injected `_connect` factory returning a fake RPyC-shaped connection (RESEARCH.md sketch lines 340–379):
```python
class _FakeNamedTuple:
    def __init__(self, **fields): self._f = fields
    def _asdict(self): return dict(self._f)          # emulate a netref namedtuple

def _connect_factory(scenario):
    def _connect(host, port, timeout): return _FakeMt5(scenario)
    return _connect
```

**Required test cases** (RESEARCH.md Test Map, lines 469–473, and sketch lines 356–379):
- `login` failure → typed raise, secret NOT in `str(exc)` (mirror `test_sfox_client.py` secret-scrub test at lines ~290–299):
  ```python
  def test_login_failure_raises_typed_error_no_secret():
      c = Mt5Client("h", 1, _connect=_connect_factory({"login": False, "last_error": (134, "no money")}))
      with pytest.raises(Mt5ClientError) as e:
          c.login(123, password="s3cr3t", server="Broker-Demo")
      assert "s3cr3t" not in str(e.value)
  ```
- `history_deals_get`: `None`→raise, `()`→`[]`, populated→materialized dicts (the load-bearing trio).
- `account_info` netref → native dict (`isinstance(info, dict)`, not a proxy).
- `order_check` investor-vs-master branch (probe only; mark exact retcode `[ASSUMED]` until the live leg — RESEARCH.md A1, line 412).
- **Structural read-only surface guard** — mirror `test_sfox_client.py` lines 138–155 (`test_read_only_surface_no_write_methods` parametrized over forbidden methods + `test_request_chokepoint_has_no_method_parameter`):
  ```python
  def test_no_order_send_surface():
      assert not hasattr(Mt5Client, "order_send")     # structural read-only
  ```
  Extend to the full forbidden set (`order_send`, `positions_get`, `orders_get`, etc.) parametrized like the sFOX test.

**Async note:** `test_sfox_client.py` tests are `async def` (aiohttp). MT5 tests are plain `def` (sync client) — drop the `async`/`await`.

---

### `analytics-service/scripts/mt5_spike.py` (live harness — execution `human_needed`)

**Analog:** `analytics-service/scripts/deribit_ground_truth.py` (primary, for `main()`/exit-codes/secret-scrub) + `sfox_ground_truth.py` (reuse of the sanitization primitives). The harness LANDS now; the four live proof legs are `human_needed` (founder runs against a demo account with a running gateway).

**`main(argv)` + argparse + exit-code contract** — copy `deribit_ground_truth.py` lines 971–1036 verbatim in shape:
```python
def main(argv: list[str] | None = None) -> int:
    """Exit codes: 0 success, 2 scope violation, 3 missing env vars, 1 other."""
    import argparse, ...
    parser = argparse.ArgumentParser(description="...")
    ...
    client_id = os.getenv("DERIBIT_CLIENT_ID")            # -> MT5: login/investor-pw/server env vars
    if not client_id or not client_secret:
        print("ERROR: ... must be set ...", file=sys.stderr); return 3
    try:
        evidence = run(...)
    except ScopeViolationError as exc:                    # read-only premise violated
        print(str(exc), file=sys.stderr); return 2
    except Exception as exc:                              # noqa: BLE001
        print("ERROR: " + _redact_secret_values(str(exc), client_id, client_secret), file=sys.stderr)
        return 1
    clean = sanitize_evidence(evidence); assert_sanitized(clean)
    print(json.dumps(clean, indent=2, default=str)); return 0

if __name__ == "__main__":
    import sys as _sys
    _sys.exit(main())
```

**Credentials via env only, never a file or argv** — both harnesses read secrets from `os.getenv` (`deribit_ground_truth.py` lines 992–1000; `sfox_ground_truth.py` docstring lines 46–54). MT5 reads login / investor password / exact server string from env; they never reach stdout/stderr.

**Reuse the sanitization primitives, do NOT re-implement** — `sfox_ground_truth.py` lines 74–80 imports them from the deribit harness (single definition). Do the same:
```python
from scripts.deribit_ground_truth import (
    ScopeViolationError, _redact_secret_values, assert_sanitized, sanitize_evidence,
)
```
(`sanitize_evidence` `deribit_ground_truth.py:359`, `assert_sanitized:390`, `_redact_secret_values:63`, `ScopeViolationError:430`.)

**The four legs** (RESEARCH.md lines 382–393) — emit a structured go/no-go over: (1) unattended login N-cycle success rate, (2) `order_check` retcode + comment + `account_info().trade_allowed` (NEVER `order_send`), (3) `history_deals_get` `None` vs `()` vs populated + field presence + `DEAL_TYPE_BALANCE`, (4) server-time vs UTC offset. If leg 1 = NO-GO, print the native-Windows-VPS escape-hatch note.

---

### `.planning/phases/134-.../MT5_GONOGO.md` (go/no-go doc template) — NO CODE ANALOG

Use the template in RESEARCH.md lines 381–394. Sections: **Environment** (broker, server string, container image + port, image pin) · **Leg 1 unattended login** (cycles, success rate, verdict, escape-hatch trigger) · **Leg 2 read-only proof** (observed `order_check` retcode/comment, `trade_allowed`, verdict) · **Leg 3 deal reconstruction** (deal count, fields present, None-vs-() observed, history depth) · **Leg 4 server-time offset** (measured offset, DST note, normalization approach) · **Overall verdict + fallback decision**. Live-result cells left as `human_needed` placeholders for the founder to fill.

---

## Shared Patterns

### Secret scrubbing
**Source:** `analytics-service/services/redact.py` — `scrub_freeform_string(s: Any) -> Any` (`redact.py:239`), plus `_redact_secret_values(text, *secrets)` (`deribit_ground_truth.py:63`) for by-value belt-and-suspenders.
**Apply to:** every `Mt5ClientError` construction (scrub the `last_error()` text) and every error path in `mt5_spike.py` (`_redact_secret_values(str(exc), login, investor_pw, server)` before stderr). Belt-and-suspenders pattern from `sfox_client.py` lines 236–257: replace the KNOWN secret literal by value FIRST, then run the pattern-based freeform scrub. RPyC-specific concern (RESEARCH.md Security lines 503–506): NEVER log the interpolated `code` string — the investor password is interpolated into it.
```python
# Mt5ClientError body:
super().__init__(f"MT5 client error (code={code}): {scrub_freeform_string(detail)}")
```

### Fail-loud / no-invented-data
**Source:** `sfox_client.py` fail-loud shape guards (lines 258–268, 347–356) + `SfoxApiError` (lines 82–93).
**Apply to:** `Mt5Client` (`None`→raise via `_raise_last`, degenerate shape→raise in `_materialize`) and `mt5_spike.py` (material anomaly → non-zero exit). Never coerce an error into an empty/flat result. This is CLAUDE.md Rule 6 (root-cause) + the `no-invented-data` MEMORY entry.

### Timeout bounding (worker-wedge protection)
**Source:** `sfox_client.py` lines 54–66 (env-tunable `*_TIMEOUT_S` with the ~90s-healthz-budget / v1.11-wedge rationale in the comment) and the bounded `aclose` lines 358–381.
**Apply to:** `Mt5Client`'s two timeouts (`MT5_REQUEST_TIMEOUT_S` rpyc + `MT5_LOGIN_TIMEOUT_MS` IPC, the latter strictly below the former — RESEARCH.md Pitfall 3). Note: the outer `asyncio.to_thread`+`asyncio.wait_for` event-loop bound is a Phase 136/137 worker-seam concern, NOT part of this synchronous client (RESEARCH.md lines 169, 226).

### Injectable transport for offline testing
**Source:** `sfox_client.py` ctor `_clock`/`_sleep` injection (lines 99–129); `test_sfox_client.py` `_patch_request` seam (lines 62–66).
**Apply to:** `Mt5Client(_connect=...)` and the whole `test_mt5_client_contract.py` suite. The CI gate has zero live dependencies.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `.planning/phases/134-.../MT5_GONOGO.md` | documentation | — | No go/no-go doc precedent in the codebase; use the RESEARCH.md lines 381–394 template. |
| Netref→native materialization (`_materialize`) | client helper | transform | No exact code analog — aiohttp/sFOX returns plain JSON via `json.loads`, so there is no proxy to materialize. Pattern is specified fresh in RESEARCH.md Pattern 3 (lines 178–181); the *intent* (callers never hold a live transport object) matches SfoxClient owning its session. |

## Metadata

**Analog search scope:** `analytics-service/services/`, `analytics-service/tests/`, `analytics-service/scripts/`
**Files read:** `sfox_client.py` (full, 382 lines), `test_sfox_client.py` (head + grep tail), `sfox_ground_truth.py` (head + main grep), `deribit_ground_truth.py` (main 971–1036 + grep), `redact.py` (head + signature grep)
**Pattern extraction date:** 2026-07-23
</content>
</invoke>

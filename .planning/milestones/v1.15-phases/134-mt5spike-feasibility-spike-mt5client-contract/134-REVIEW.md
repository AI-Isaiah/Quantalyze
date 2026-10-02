---
phase: 134-mt5spike-feasibility-spike-mt5client-contract
reviewed: 2026-07-23T16:19:06Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - analytics-service/services/mt5_client.py
  - analytics-service/tests/test_mt5_client_contract.py
  - analytics-service/scripts/mt5_spike.py
  - analytics-service/tests/test_mt5_spike_harness.py
findings:
  critical: 1
  warning: 2
  info: 1
  total: 4
status: issues_found
fix_status: critical_warning_fixed
fixed_at: 2026-07-23T00:00:00Z
fixes:
  - id: CR-01
    status: fixed
    commit: cdd04b16
  - id: WR-01
    status: fixed
    commit: 67df28c9
  - id: WR-02
    status: fixed
    commit: 64e2d583
  - id: IN-01
    status: retained (deliberate — defensive, out of critical+warning scope)
---

# Phase 134: Code Review Report

**Reviewed:** 2026-07-23T16:19:06Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found (Critical + Warning fixed 2026-07-23; IN-01 deliberately retained)

## Summary

Reviewed the read-only `Mt5Client` network facade, its offline contract suite, the
four-leg spike harness, and the harness's offline tests. The core disciplines the
phase cares about are well executed: the read-only surface is pinned structurally
(no `__getattr__`, no trade methods, exact public set asserted), the `None` (error →
raise) vs `()` (honest empty) distinction is correct on every read and mirrored in
the harness, the `mt5linux` import is genuinely lazy, and the offline doubles are
shaped bridges (not blind MagicMocks) that assert real kwarg wiring.

The one serious defect is on the secret-hygiene error path — the disclosure vector
the module docstring itself names. The client only scrubs errors it *constructs*
(`Mt5ClientError`), never exceptions *raised by the transport*, so the documented
"every error detail passes through `scrub_freeform_string`" guarantee does not hold
for the highest-risk path (`login()` raising with the password interpolated into
the remote-eval code). Two robustness/config warnings and one dead exit-code path
round out the findings.

## Critical Issues

### CR-01: Transport-raised exceptions bypass the client's secret scrubbing (T-134-01 gap)

**Status:** FIXED (commit cdd04b16). All raw `self._mt5.<call>` reads (login,
account_info, history_deals_get, order_check) now catch transport-raised
exceptions and re-raise as scrubbed typed `Mt5ClientError`; login also redacts
credentials by value. Regression tests `test_login_transport_raise_is_scrubbed_and_typed`
and `test_read_transport_raise_is_scrubbed_and_typed` fail without the fix.

**File:** `analytics-service/services/mt5_client.py:157-201` (all reads; `login` is the credential-bearing one)

**Issue:** The module docstring (lines 51-56) states the client's security contract:
"every error detail passes through `services.redact.scrub_freeform_string` at
`Mt5ClientError` construction, and the interpolated remote `code` string is never
logged" — and the threat model is explicit that `mt5linux` "f-string-interpolates
the password into the remotely-eval'd code, so a leaked error string is a real
credential disclosure."

But scrubbing happens **only** inside `Mt5ClientError.__init__` (line 97), and
`Mt5ClientError` is **only** raised on a `None`/falsy return (`_raise_last`). The
raw transport call — `self._mt5.login(login, password=password, server=server,
timeout=...)` (lines 162-164) — is **not** wrapped in `try/except`. If the RPyC
round-trip itself raises (remote exception carrying the interpolated source line, a
mid-handshake abort, an rpyc timeout with code context), that exception propagates
out of `login()` untouched by any scrub the client controls. The client's contract
promise ("every error detail passes through `scrub_freeform_string`") is therefore
false for exactly the class the docstring flags as a real credential disclosure.

The contract test only exercises the falsy-*return* path
(`test_login_failure_raises_typed_error_no_secret`, contract suite lines 134-144);
there is no test for a transport-*raised* exception, so the gap is invisible to CI.
Note the shape-based `scrub_freeform_string` would only catch a `password='...'`
form *if* the caller happens to route the exception through the redact processor —
the client cannot rely on that, and its own contract says it owns the scrub.

**Fix:** Wrap the transport call in `login()` (and ideally every read) and re-raise
as a scrubbed typed error. Because `login()` has the credential values in scope, do
by-value redaction there too so login/server are covered, not just `password=`
shapes:
```python
def login(self, login: int, password: str, server: str) -> None:
    try:
        ok = self._mt5.login(
            login, password=password, server=server, timeout=MT5_LOGIN_TIMEOUT_MS
        )
    except Mt5ClientError:
        raise
    except Exception as exc:  # noqa: BLE001 — never let raw transport text escape
        safe = scrub_freeform_string(str(exc))
        for lit in (str(login), password, server):
            safe = safe.replace(lit, "[REDACTED]")
        raise Mt5ClientError(0, safe) from None
    if not ok:
        self._raise_last()
```
Add a regression test injecting a `_connect` whose `login` *raises* an exception
whose text embeds the password/login/server, and assert none of the three literals
survive in `str(exc_info.value)`.

## Warnings

### WR-01: Dual-timeout ordering invariant is documented as load-bearing but never enforced

**Status:** FIXED (commit 67df28c9). `__init__` now fails loud with `ValueError`
when `MT5_LOGIN_TIMEOUT_MS >= request_timeout_s*1000`. The existing
`test_connect_receives_request_timeout` fixture (12.5s, itself inverting) was
updated to 25.0s. Regression test `test_inverting_request_timeout_is_rejected`
fails without the fix; `test_default_construction_satisfies_timeout_ordering`
confirms the default is not over-rejected.

**File:** `analytics-service/services/mt5_client.py:79-83, 141-147, 157-164`

**Issue:** The docstring (lines 37-48, 79-83) makes the ordering
`MT5_LOGIN_TIMEOUT_MS < MT5_REQUEST_TIMEOUT_S * 1000` a hard, load-bearing
invariant ("MUST stay strictly BELOW") whose violation reintroduces the v1.11
WEDGE-01 wedge class. But the two values are decoupled and neither is checked at
runtime:
- `login()` uses the module-level constant `MT5_LOGIN_TIMEOUT_MS` (line 163).
- The rpyc timeout is a **per-instance** ctor parameter `request_timeout_s`
  (line 141), defaulting to `MT5_REQUEST_TIMEOUT_S`.

So `Mt5Client(host, port, request_timeout_s=10)` silently produces `login
timeout 20000ms > rpyc 10000ms` — the exact inversion the docstring warns against
— with no guard. The same happens via env if `MT5_REQUEST_TIMEOUT_S` is set below
20 while `MT5_LOGIN_TIMEOUT_MS` keeps its default. The contract test
(`test_login_passes_ipc_timeout_below_rpyc_timeout`, lines 147-156) only asserts
the relationship for the **default** constants, so a misconfiguration passes CI.

**Fix:** Enforce the invariant where the effective values meet — in `__init__` or
at the top of `login()`:
```python
if MT5_LOGIN_TIMEOUT_MS >= request_timeout_s * 1000:
    raise ValueError(
        "MT5 login IPC timeout must be strictly below the rpyc request timeout "
        f"({MT5_LOGIN_TIMEOUT_MS}ms >= {request_timeout_s * 1000}ms)"
    )
```
Then add a test that constructs with a too-small `request_timeout_s` and asserts it
raises.

### WR-02: `_raise_last` indexes `last_error()` without a shape guard, undermining fail-loud

**Status:** FIXED (commit 64e2d583). `_raise_last` now coerces `int(err[0])`/
`str(err[1])` inside a `try/except (TypeError, IndexError, KeyError, ValueError)`,
falling back to a typed `Mt5ClientError(0, "unknown (malformed last_error shape)")`.
Regression test `test_raise_last_malformed_shape_still_typed` (4 params) fails
without the fix.

**File:** `analytics-service/services/mt5_client.py:150-155`

**Issue:** `_raise_last` does `code, text = (err[0], err[1]) if err else (0,
"unknown")`. The `if err else` branch handles a falsy/empty result, but a
**truthy-but-malformed** `last_error()` (a 1-element tuple, a scalar, a dict) makes
`err[0]`/`err[1]` raise a raw `IndexError`/`TypeError`/`KeyError`. That raw
exception escapes the whole typed-error discipline the design leans on: instead of a
scrubbed `Mt5ClientError` carrying a code, the caller gets an untyped exception with
no code and no scrub. This is the single choke point for fail-loud, so it should be
the most defensive spot in the file.

**Fix:** Coerce defensively before unpacking:
```python
err = self._mt5.last_error()
try:
    code, text = int(err[0]), str(err[1])
except (TypeError, IndexError, ValueError):
    code, text = 0, "unknown (malformed last_error shape)"
raise Mt5ClientError(code, text)
```

## Info

### IN-01: Unreachable `ScopeViolationError` handler / documented exit code 2 can never occur

**Status:** RETAINED (deliberate). Out of the Critical+Warning fix scope. The
`except ScopeViolationError` branch / exit code 2 is defensive and harmless; left
as-is per the fix mandate. Flagged for a future decision (drop the dead handler
vs. wire a real runtime read-only assertion).

**File:** `analytics-service/scripts/mt5_spike.py:449-452` (see also docstring lines 59-64)

**Issue:** `main()` documents and handles exit code 2 for a "read-only premise
violated (`ScopeViolationError`)". `ScopeViolationError` is imported (line 74) and
re-exported "for main()", but nothing in `run_spike` or the legs ever performs a
scope check that raises it — the read-only property is enforced purely
structurally (the client has no trade path). The `except ScopeViolationError`
branch is therefore dead and exit code 2 is unproducible, which slightly
misrepresents the safety contract advertised in the module header.

**Fix:** Either drop the unreachable `except`/exit-2 documentation, or make the
premise a real runtime assertion (e.g. assert the injected client lacks
`order_send` before the live legs run) so the advertised gate actually fires.

---

_Reviewed: 2026-07-23T16:19:06Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

"""Neutralise the CANONICAL slowapi limiter for tests that call handlers directly.

Why this module exists (PYAPI-03, 2026-07-26)
---------------------------------------------
``routers/exchange.py``, ``routers/csv.py`` and ``routers/portfolio.py`` used to
declare their own ``Limiter(key_func=get_remote_address)`` at module scope. Test
modules that invoke a route handler **directly** — passing a ``MagicMock`` as
``request`` rather than driving a ``TestClient`` — neutralised the
``@limiter.limit(...)`` decorator by rebinding ``slowapi.Limiter`` to a no-op
class *before* importing the router.

PYAPI-03 deleted those three private instances in favour of the singleton in
``services.rate_limit`` (they keyed on the Railway EDGE ip, and each had its own
isolated ``memory://`` storage invisible to ``app.state.limiter``). That
**relocated the stub target**: a router which imports an ALREADY-CONSTRUCTED
limiter never reads ``slowapi.Limiter`` at all, so the old stub silently became a
no-op-on-the-no-op and **58 tests** began failing with

    Exception: parameter `request` must be an instance of starlette.requests.Request

— the real slowapi wrapper, now in the call path, rejecting the MagicMock.

The honest repair is to stub the **instance**. Call sites keep rebinding
``slowapi.Limiter`` as well: that still covers any module which constructs its
own limiter, and removing it would be an unrelated change.

A second, smaller consequence has no home here but is worth stating next to it:
consolidating onto one instance also consolidates its ``memory://`` **storage**,
so limiter counters now persist across a whole pytest session instead of being
reset by every router reload. Tests that drive the real limiter with real
``Request`` objects must therefore reset it per test — the idiom already in
``tests/test_simulator_router.py``'s ``client`` fixture, and now also in
``tests/test_verify_strategy_redaction.py``.

Do NOT use this to silence a limiter assertion. ``tests/test_limiter_identity.py``
deliberately drives the real singleton.
"""

from __future__ import annotations

import sys
from types import ModuleType
from typing import Any, Callable


class NoopLimiter:
    """Stand-in for ``slowapi.Limiter`` whose ``.limit()`` returns the function.

    ``reset()`` is a no-op rather than absent so callers can invoke it
    unconditionally.
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass

    def limit(self, *args: Any, **kwargs: Any) -> Callable[[Any], Any]:
        def decorator(fn: Any) -> Any:
            return fn

        return decorator

    def reset(self) -> None:
        pass


def _rate_limit_module() -> ModuleType:
    """Resolve ``services.rate_limit`` **at call time**, never at import time.

    ⚠️ Load-bearing. ``tests/test_process_key.py`` pops ``services.rate_limit``
    out of ``sys.modules`` at its own IMPORT time (so its router re-binds a real
    ``Limiter`` after the sibling files that shim ``slowapi.Limiter``). pytest
    imports every test module during collection, so that eviction happens before
    a single test runs. A module object captured at helper-import time is
    therefore stale for the rest of the session: patching it changes nothing the
    routers can see, and the 58 failures above come straight back — silently,
    because the patch itself still "succeeds".
    """
    mod = sys.modules.get("services.rate_limit")
    if mod is None:
        import services.rate_limit as mod  # noqa: PLC0415
    return mod


def patch_shared_limiter(monkeypatch: Any) -> None:
    """Point ``services.rate_limit.limiter`` at a :class:`NoopLimiter`.

    Function-scoped by construction: ``monkeypatch`` reverts it after the test,
    so no cross-file pollution is possible and no refcounted save/restore is
    needed. MUST run BEFORE the router module is imported or reloaded — the
    router binds the instance with ``from services.rate_limit import limiter`` at
    import time. As an autouse fixture that ordering is automatic.
    """
    monkeypatch.setattr(_rate_limit_module(), "limiter", NoopLimiter())

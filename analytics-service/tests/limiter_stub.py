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

import contextlib
import importlib.util
import sys
from types import ModuleType
from typing import Any, Callable, Iterator
from unittest.mock import MagicMock

# Sentinel for "there was nothing there before", distinct from None.
_ABSENT = object()


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

    ⚠️ Load-bearing, and it cost a debugging round to learn why.
    ``tests/test_process_key.py`` used to pop ``services.rate_limit`` out of
    ``sys.modules`` at its own IMPORT time — and pytest imports every test module
    during COLLECTION, so that eviction landed before a single test ran. A module
    object captured at helper-import time was therefore stale for the whole
    session: patching it changed nothing any router could see, the 58 failures
    came straight back, and the patch itself still reported success.

    That pop is gone as of PYAPI-03 (see the comment in ``test_process_key.py``,
    which explains why re-popping the singleton became actively harmful once four
    routers started binding it at import). Resolving lazily here anyway: nothing
    is gained by caching, and the failure mode is silent.
    """
    mod = sys.modules.get("services.rate_limit")
    if mod is None:
        import services.rate_limit as mod  # noqa: PLC0415
    return mod


def evict_module(name: str) -> None:
    """Really evict ``name`` so the next import RE-EXECUTES it.

    ⚠️ ``sys.modules.pop("routers.exchange")`` alone does **not** do this.
    ``from routers import exchange`` runs importlib's ``_handle_fromlist``, which
    only imports the submodule when the parent package lacks the attribute — and
    the parent keeps its ``exchange`` attribute after the pop. So the pop returns
    the STALE module object, silently, with its original decorators intact.

    Harmless while every fixture that pops was also the first thing in the
    session to import the router. PYAPI-03 ended that: ``routers.exchange`` now
    binds a shared limiter, so any earlier module that imports it (e.g.
    ``tests/test_limiter_identity.py``) leaves the attribute set, the "reload"
    silently no-ops, and the handler still carries the REAL slowapi wrapper —
    which then rejects the fixture's MagicMock request. 48 failures, none of them
    at the line that looked wrong.
    """
    sys.modules.pop(name, None)
    package_name, _, attribute = name.rpartition(".")
    package = sys.modules.get(package_name)
    if package is not None and hasattr(package, attribute):
        delattr(package, attribute)


@contextlib.contextmanager
def restoring(*names: str) -> Iterator[None]:
    """Put each of ``names`` back EXACTLY as it was on entry, however the block ends.

    For every dotted module name this snapshots the ``sys.modules`` entry (or its
    absence) and the parent package's attribute for the child (or its absence),
    and in a ``finally`` writes both back: a present object is re-set, an absent
    one is removed. Names are restored in reverse order.

    Why this exists (Phase 164.9.8.1, 2026-10-14). ``evict_module`` deletes the
    ``routers`` package attribute, and ten test files called it in teardown
    without putting anything back. ``tests/test_limiter_identity.py`` resolves
    ``routers.exchange`` as an ATTRIBUTE of the package at call time, so under
    ``pytest-xdist --dist loadgroup`` (which schedules ungrouped tests one by
    one) it raised ``AttributeError: module 'routers' has no attribute
    'exchange'`` whenever it ran right after a polluter on the same worker.
    Deterministic reproduction, from ``analytics-service/``::

        .venv/bin/pytest -p no:xdist -p no:cacheprovider -q --no-cov \\
          tests/test_exchange_router_c0202.py \\
          tests/test_limiter_identity.py::TestClassClosure::test_every_router_limiter_is_the_one_singleton

    Serial file order never showed it, because the victim's own earlier classes
    re-import the routers. The fixtures import a NEW module object after the
    eviction; the ORIGINAL object is never mutated, so restoring it restores the
    real-limiter binding the victim checks.

    ⚠️ ``monkeypatch.delitem(sys.modules, name, raising=False)`` is NOT a
    substitute: when the key is absent it records nothing, so a module imported
    during the test survives teardown, and it never touches the package
    attribute at all.

    ⚠️ The parent package may be ABSENT at entry (``routers`` not imported yet).
    Importing the child inside the block then imports the package and binds the
    child on it, so the exit path RE-RESOLVES the package instead of trusting the
    entry snapshot: skipping the restore for a ``None`` snapshot left
    ``routers.portfolio`` bound to the no-op-limited module for the rest of the
    process, and ``main.py``'s ``from routers import portfolio`` then mounted it
    (``tests/test_rate_limit_contract.py`` stopped seeing a 429). Measured by the
    pair gate in ``tests/test_limiter_stub_restore.py``. The package itself stays
    imported: popping it would orphan every other ``routers.*`` module imported
    meanwhile, and an absent child attribute is all "exact" requires of it.
    """
    snapshots: list[tuple[str, str, Any, Any, Any]] = []
    for name in names:
        package_name, _, attribute = name.rpartition(".")
        package = sys.modules.get(package_name) if package_name else None
        prior_module = sys.modules.get(name, _ABSENT)
        prior_attr = (
            getattr(package, attribute, _ABSENT) if package is not None else _ABSENT
        )
        snapshots.append((name, attribute, package, prior_module, prior_attr))
    try:
        yield
    finally:
        for name, attribute, package, prior_module, prior_attr in reversed(snapshots):
            if prior_module is _ABSENT:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = prior_module
            if package is None:
                package_name = name.rpartition(".")[0]
                # A top-level name has no parent; a dotted one whose parent was
                # absent at entry may have had it imported inside the block.
                package = sys.modules.get(package_name) if package_name else None
            if package is None:
                continue
            if prior_attr is _ABSENT:
                if hasattr(package, attribute):
                    delattr(package, attribute)
            else:
                setattr(package, attribute, prior_attr)


def _is_importable(name: str) -> bool:
    """True when ``name`` can be imported from disk. Never imports ``name`` itself.

    ``find_spec`` on a dotted name imports its PARENT, so a parent that is a
    ``MagicMock`` stub (no ``__path__``) raises; that means "not importable".
    """
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError, AttributeError):
        return False


def stub_missing_modules(*names: str) -> dict[str, MagicMock]:
    """``MagicMock``-stub each of ``names`` that is neither loaded NOR importable.

    Returns the stubs it installed, keyed by name, for :func:`unstub_modules`.

    Why not "stub whatever is not in ``sys.modules`` yet" (Phase 164.9.8.1,
    WR-01). That test is true for any installed package nobody has imported YET,
    so a polluter file's collection-time ``sys.modules["ccxt"] = MagicMock()``
    outlived its module and handed ``raise ccxt.NetworkError(...)`` in
    ``tests/test_cron_router.py`` a mock: ``TypeError`` instead of
    ``NetworkError``. Whether the suite was green then depended on which file
    happened to import real ccxt first. ccxt is a hard dependency; a stub is only
    legitimate where the package is genuinely missing.
    """
    installed: dict[str, MagicMock] = {}
    for name in names:
        if name in sys.modules or _is_importable(name):
            continue
        installed[name] = sys.modules[name] = MagicMock()
    return installed


def unstub_modules(installed: dict[str, MagicMock]) -> None:
    """Remove what :func:`stub_missing_modules` installed, if it is still there."""
    for name, stub in installed.items():
        if sys.modules.get(name) is stub:
            del sys.modules[name]
    installed.clear()


@contextlib.contextmanager
def evicted(name: str) -> Iterator[None]:
    """Evict ``name`` (see :func:`evict_module`) for the block, then restore it exactly.

    Use this in a fixture around the re-import and the ``yield``, instead of
    calling ``evict_module`` before and after. Inside the block ``name`` is gone
    from ``sys.modules`` and from its package, so the next import re-executes it
    under the fixture's stubs; on exit (including on an exception) the original
    module object and package attribute are back. See :func:`restoring` for the
    measured failure this prevents.
    """
    with restoring(name):
        evict_module(name)
        yield


def build_shared_limiter_from_real_slowapi() -> None:
    """Import ``services.rate_limit`` NOW, while ``slowapi`` is still the real package.

    Call this BEFORE a fixture swaps ``sys.modules["slowapi"]`` for a stub
    (Phase 164.9.8.1). ``services.rate_limit`` builds its process-wide
    ``limiter`` the first time it is imported, from whatever ``slowapi.Limiter``
    is then. When a stubbing fixture was the first to import it, the singleton
    became that fixture's ``_NoopLimiter`` for the rest of the process and
    ``tests/test_rate_limit_contract.py`` died in setup with
    ``'_NoopLimiter' object has no attribute 'reset'``. Idempotent: a no-op once
    the module is imported.
    """
    _rate_limit_module()


def patch_shared_limiter(monkeypatch: Any) -> None:
    """Point ``services.rate_limit.limiter`` at a :class:`NoopLimiter`.

    Function-scoped by construction: ``monkeypatch`` reverts it after the test,
    so no cross-file pollution is possible and no refcounted save/restore is
    needed. MUST run BEFORE the router module is imported or reloaded — the
    router binds the instance with ``from services.rate_limit import limiter`` at
    import time. As an autouse fixture that ordering is automatic.
    """
    monkeypatch.setattr(_rate_limit_module(), "limiter", NoopLimiter())

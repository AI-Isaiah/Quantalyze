"""Tests for ``tests.limiter_stub.restoring`` / ``evicted`` (Phase 164.9.8.1).

WHY these exist: ten test files evicted ``routers.*`` modules in teardown and
never put them back, which left the ``routers`` package without its router
attributes. ``tests/test_limiter_identity.py`` reads ``routers.exchange`` as a
package attribute at call time, so under ``pytest-xdist --dist loadgroup`` it
failed with ``AttributeError`` whenever it ran right after such a polluter on the
same worker. The helpers restore the exact pre-test module object and package
attribute; these tests pin that they do, including on an exception, and that a
polluter file followed by the victim in ONE process stays green.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from types import ModuleType

import pytest
from tests.child_deadman import run_child
from tests.limiter_stub import (
    evict_module,
    evicted,
    restoring,
    stub_missing_modules,
    unstub_modules,
)

SERVICE_ROOT = Path(__file__).resolve().parent.parent

_PKG = "_limiter_stub_probe_pkg"
_CHILD = f"{_PKG}.child"


@pytest.fixture()
def probe_pkg(monkeypatch: pytest.MonkeyPatch) -> tuple[ModuleType, ModuleType]:
    """A synthetic package with one child, installed with the child present."""
    pkg = ModuleType(_PKG)
    child = ModuleType(_CHILD)
    pkg.child = child  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, _PKG, pkg)
    monkeypatch.setitem(sys.modules, _CHILD, child)
    return pkg, child


@pytest.fixture()
def probe_pkg_without_child(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    """A synthetic package whose child is absent from both places."""
    pkg = ModuleType(_PKG)
    monkeypatch.setitem(sys.modules, _PKG, pkg)
    monkeypatch.delitem(sys.modules, _CHILD, raising=False)
    return pkg


def test_restoring_puts_back_the_original_when_the_block_replaces_it(probe_pkg) -> None:
    pkg, child = probe_pkg
    with restoring(_CHILD):
        replacement = ModuleType(_CHILD)
        sys.modules[_CHILD] = replacement
        pkg.child = replacement  # type: ignore[attr-defined]
    assert sys.modules[_CHILD] is child
    assert pkg.child is child  # type: ignore[attr-defined]


def test_restoring_puts_back_the_original_when_the_block_removes_it(probe_pkg) -> None:
    pkg, child = probe_pkg
    with restoring(_CHILD):
        evict_module(_CHILD)
        assert _CHILD not in sys.modules
        assert not hasattr(pkg, "child")
    assert sys.modules[_CHILD] is child
    assert pkg.child is child  # type: ignore[attr-defined]


def test_restoring_leaves_it_absent_when_it_was_absent(probe_pkg_without_child) -> None:
    pkg = probe_pkg_without_child
    with restoring(_CHILD):
        imported = ModuleType(_CHILD)
        sys.modules[_CHILD] = imported
        pkg.child = imported  # type: ignore[attr-defined]
    assert _CHILD not in sys.modules
    assert not hasattr(pkg, "child")


def test_restoring_handles_several_names_in_reverse_order(probe_pkg) -> None:
    pkg, child = probe_pkg
    sibling_name = f"{_PKG}.sibling"
    sibling = ModuleType(sibling_name)
    pkg.sibling = sibling  # type: ignore[attr-defined]
    sys.modules[sibling_name] = sibling
    try:
        with restoring(_CHILD, sibling_name):
            evict_module(_CHILD)
            evict_module(sibling_name)
        assert sys.modules[_CHILD] is child
        assert sys.modules[sibling_name] is sibling
        assert pkg.child is child  # type: ignore[attr-defined]
        assert pkg.sibling is sibling  # type: ignore[attr-defined]
    finally:
        sys.modules.pop(sibling_name, None)


def test_evicted_hides_the_module_inside_and_restores_it_after(probe_pkg) -> None:
    pkg, child = probe_pkg
    with evicted(_CHILD):
        assert _CHILD not in sys.modules
        assert not hasattr(pkg, "child")
    assert sys.modules[_CHILD] is child
    assert pkg.child is child  # type: ignore[attr-defined]


def test_evicted_restores_and_propagates_when_the_block_raises(probe_pkg) -> None:
    pkg, child = probe_pkg
    with pytest.raises(RuntimeError, match="boom"):
        with evicted(_CHILD):
            sys.modules[_CHILD] = ModuleType(_CHILD)
            raise RuntimeError("boom")
    assert sys.modules[_CHILD] is child
    assert pkg.child is child  # type: ignore[attr-defined]


def test_restoring_restores_and_propagates_when_the_block_raises(probe_pkg_without_child) -> None:
    pkg = probe_pkg_without_child
    with pytest.raises(RuntimeError, match="boom"):
        with restoring(_CHILD):
            sys.modules[_CHILD] = ModuleType(_CHILD)
            pkg.child = sys.modules[_CHILD]  # type: ignore[attr-defined]
            raise RuntimeError("boom")
    assert _CHILD not in sys.modules
    assert not hasattr(pkg, "child")


def test_evicted_real_router_keeps_the_singleton_limiter_binding() -> None:
    """The victim's invariant, driven through the real package.

    Inside the block a fresh ``routers.exchange`` is a different object; after
    it, ``routers.exchange`` is the original again and still holds the one
    shared limiter, which is what ``test_limiter_identity.py`` asserts.
    """
    import routers
    import routers.exchange  # noqa: F401
    from services import rate_limit as rl

    original = routers.exchange
    with evicted("routers.exchange"):
        import routers.exchange as fresh  # noqa: PLC0415

        assert fresh is not original
    assert routers.exchange is original
    assert sys.modules["routers.exchange"] is original
    assert original.limiter is rl.limiter


def _run_pytest_pair(*targets: str) -> subprocess.CompletedProcess[str]:
    """Run ``targets`` in ONE serial pytest process, in the order given.

    ``-n 4 --dist loadgroup`` schedules ungrouped tests one by one, so any test
    can follow any other on the same worker; this is such an order, made
    deterministic.
    """
    # The verdict is the child's exit code and output, never how long it took
    # (a child pytest session took 50-130 s under heavy load); `run_child` carries
    # only the shared DEADMAN, which names this test if the child hangs.
    return run_child(
        f"the limiter stub restores cleanly across a serial pytest pair {targets}",
        [
            sys.executable,
            "-m",
            "pytest",
            "-p",
            "no:xdist",
            "-p",
            "no:cacheprovider",
            "-q",
            "--no-cov",
            *targets,
        ],
        cwd=SERVICE_ROOT,
    )


def test_restoring_removes_the_child_from_a_package_absent_at_entry(monkeypatch) -> None:
    """The package is not imported when the block starts and is imported INSIDE it.

    The entry snapshot of the package is ``None``; the exit path must re-resolve
    it, or the child stays bound on the package although ``sys.modules`` forgot it
    and a later ``from pkg import child`` returns the stubbed object.
    """
    monkeypatch.delitem(sys.modules, _PKG, raising=False)
    monkeypatch.delitem(sys.modules, _CHILD, raising=False)
    try:
        with restoring(_CHILD):
            pkg = ModuleType(_PKG)
            imported = ModuleType(_CHILD)
            pkg.child = imported  # type: ignore[attr-defined]
            sys.modules[_PKG] = pkg
            sys.modules[_CHILD] = imported
        assert _CHILD not in sys.modules
        assert not hasattr(pkg, "child")
    finally:
        sys.modules.pop(_PKG, None)
        sys.modules.pop(_CHILD, None)


def test_a_polluter_file_then_the_victim_in_one_process_is_green() -> None:
    """Encodes the invariant the parallel suite depends on: a polluter cannot
    leave the ``routers`` package without its router attributes.
    """
    proc = _run_pytest_pair(
        "tests/test_exchange_router_c0202.py",
        "tests/test_limiter_identity.py::TestClassClosure::test_every_router_limiter_is_the_one_singleton",
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_the_portfolio_polluter_then_the_rate_limit_contract_is_green() -> None:
    """``test_routers_audit_2026_05_17.py`` imports ``routers.portfolio`` under a
    no-op limiter while ``routers`` is not yet imported. If its teardown leaves
    that module bound on the package, ``main.py`` mounts it and the 429 contract
    sees no throttle (6 failures, "did not throttle").
    """
    proc = _run_pytest_pair(
        "tests/test_routers_audit_2026_05_17.py",
        "tests/test_rate_limit_contract.py",
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr


_STUB_PROBE = "_limiter_stub_probe_missing_module"


def test_stub_missing_modules_stubs_only_what_is_absent_and_unstubs_it(monkeypatch) -> None:
    monkeypatch.delitem(sys.modules, _STUB_PROBE, raising=False)
    # Loaded: left alone. Importable but not yet loaded ("wave" is stdlib): left alone.
    monkeypatch.delitem(sys.modules, "wave", raising=False)
    installed = stub_missing_modules(_STUB_PROBE, "json", "wave")
    try:
        assert set(installed) == {_STUB_PROBE}
        assert sys.modules[_STUB_PROBE] is installed[_STUB_PROBE]
        assert "wave" not in sys.modules
    finally:
        unstub_modules(installed)
    assert _STUB_PROBE not in sys.modules
    assert installed == {}


def test_unstub_modules_leaves_a_module_someone_else_replaced(monkeypatch) -> None:
    monkeypatch.delitem(sys.modules, _STUB_PROBE, raising=False)
    installed = stub_missing_modules(_STUB_PROBE)
    real = ModuleType(_STUB_PROBE)
    sys.modules[_STUB_PROBE] = real
    try:
        unstub_modules(installed)
        assert sys.modules[_STUB_PROBE] is real
    finally:
        sys.modules.pop(_STUB_PROBE, None)


@pytest.mark.parametrize(
    "polluter",
    ["tests/test_routers_audit_2026_05_17.py", "tests/test_c19_portfolio_fixes.py"],
)
def test_a_ccxt_stubbing_polluter_then_the_cron_victim_is_green(polluter: str) -> None:
    """Both polluter files used to install ``sys.modules["ccxt"] = MagicMock()`` at
    collection and never remove it, so ``raise ccxt.NetworkError(...)`` in the
    victim raised ``TypeError`` and its exception-class assertion
    (``TestEveryCronSyncedVenueStampsTheFetchErrorFlag``) failed. Which order the
    suite ran in decided whether anyone saw it.
    """
    # The whole victim FILE, not the one node: measured against the unfixed
    # polluters, the node alone stays green and the file goes red.
    proc = _run_pytest_pair(polluter, "tests/test_cron_router.py")
    assert proc.returncode == 0, proc.stdout + proc.stderr


@pytest.mark.parametrize(
    "polluter",
    [
        "tests/test_exchange_router_c0202.py",
        "tests/test_mt5_validate.py",
        "tests/test_create_exchange_attribution.py",
    ],
)
def test_a_slowapi_stubbing_fixture_then_the_rate_limit_contract_is_green(polluter: str) -> None:
    """These fixtures swap ``sys.modules["slowapi"]`` for a stub whose ``Limiter`` is
    a no-op class. If one is the first thing in the process to import
    ``services.rate_limit``, the shared singleton is built from that no-op and
    ``test_rate_limit_contract.py`` errors in setup (``no attribute 'reset'``).
    The other converted fixtures share the one-line fix this pins.
    """
    proc = _run_pytest_pair(polluter, "tests/test_rate_limit_contract.py")
    assert proc.returncode == 0, proc.stdout + proc.stderr

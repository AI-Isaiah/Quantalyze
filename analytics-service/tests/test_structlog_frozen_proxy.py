"""OPS-05 (Phase 163) — the redaction chain reaches BOTH entrypoints, and the
module-scope-``.bind()`` shape that would permanently escape it is gated.

Why this file exists
--------------------
``services/logging_config.py`` builds the ONE processor chain that keeps secrets
out of the log sink: ``_redact_processor`` (structlog side) plus a
``logging.setLogRecordFactory`` wrapper (stdlib side, which exists precisely to
stop ``logger.warning("ccxt: %s", str(exc))`` leaking the HMAC signature embedded
in a ccxt exception). Neither exists in a process until ``configure_logging()``
has actually run there. Two shapes defeat it:

**Mode B — anything emitted before ``configure_logging()`` runs.** Measured
2026-08-26 at the phase's base commit: ``main_worker.py`` contained ZERO
references to ``configure_logging`` or ``structlog``. That is the process that
runs ccxt long-fetch and MT5 sync (the image's worker service overrides CMD to
``python -m main_worker``), so it emitted EVERY line through structlog's default
chain and never installed the stdlib bridge at all — an unconditional leak, not
a latent risk. ``main.py`` did configure, but BELOW its ``from routers import
...`` line, so the API process was safe only by the accident that no router
logged at import time. Both entrypoints now configure above every first-party
import, and ``TestEntrypointOrdering`` fails if either regresses.

**Mode A — a module-scope ``.bind()``.** ``BoundLoggerLazyProxy.bind()`` returns
a CONCRETE ``BoundLogger`` holding whatever processor list was in force at that
instant. At module scope that instant is import time, i.e. before any entrypoint
configures, so the object carries the default (unredacted) chain FOREVER — later
``structlog.configure()`` calls cannot reach it. ``TestModeAModuleScopeBind``
scans for that shape and pins the mechanism with a live subprocess demo.

⚠️ MEASURED CORRECTION to the phase research (2026-08-26, this session)
----------------------------------------------------------------------
The research (and the pre-2026-08-26 ``_stage_logger`` docstring in
``services/mt5_client.py``) framed Mode B as a *permanent* freeze, reasoning that
``cache_logger_on_first_use=True`` makes ``BoundLoggerLazyProxy.bind`` install a
``finalized_bind`` closure that never sees later ``structlog.configure()`` calls.
That is true of OUR config but NOT of the situation it was applied to: the
default config in force BEFORE ``configure_logging()`` runs carries
``cache_logger_on_first_use=False`` (verified against the installed structlog:
``structlog._config._CONFIG.cache_logger_on_first_use`` is ``False`` at a fresh
import, and ``BoundLoggerLazyProxy.bind`` only self-assigns ``finalized_bind``
when that flag is true). A plain module-scope ``structlog.get_logger(...)`` proxy
therefore re-reads ``_CONFIG`` on every use and SELF-HEALS once configure runs.

So Mode B is a WINDOW, not a freeze — but on the worker that window was the whole
process lifetime, which is strictly worse than the freeze the research described.
Mode A is the genuinely permanent one. Both statements are demonstrated below
rather than asserted: ``test_a_line_emitted_before_configure_leaks`` shows the
window leaking in a fresh, unconfigured interpreter, and
``test_a_module_scope_bind_leaks_even_after_configure`` shows a bind surviving a
subsequent ``configure_logging()``.

Anti-vacuity record — every gate observed RED
--------------------------------------------
Every gate here was neutered, observed failing, and restored. Byte backups were
taken first; each restore was confirmed by grepping for the restored call, not by
hash alone.

* **Mode B mutation M1** — commented out the ``configure_logging()`` call at
  module scope in ``main_worker.py`` (leaving the import in place). Observed
  4 failed / 5 passed, and the failures were the leak itself, not a proxy for it:

  - ``TestModeBWorkerEntrypoint::test_worker_entrypoint_installs_the_structlog_redactor``
    FAILED — no JSON line at all, because the default ConsoleRenderer was still
    installed. Captured stdout read
    ``[info ] worker_probe  api_key=QZ-OPS05-CANARY-… safe_field=kept``, i.e. the
    denylisted key in plaintext.
  - ``…::test_worker_entrypoint_installs_the_stdlib_logrecord_bridge`` FAILED with
    ``WARNING:quantalyze.analytics:ccxt failure: https://…&signature=QZ-OPS05-CANARY-…``
    — the exact HMAC-shaped leak the LogRecord factory exists to stop.
  - ``TestModeBNegativeControl`` and the ``main_worker.py`` case of
    ``TestEntrypointOrdering`` also reddened.

  Restored; the call is back at module scope above the first-party imports.
* **Mode B mutation M2** — moved ``configure_logging()`` in ``main.py`` from
  above the ``from routers import ...`` line to below it (its position before
  this phase). Observed 1 failed / 1 passed:
  ``TestEntrypointOrdering::test_entrypoint_configures_logging_before_any_first_party_import[main.py-routers]``
  FAILED with *"`configure_logging()` is at line 71 but the first-party import
  'routers' at line 67 runs BEFORE it"*. Restored.

* **Mode A mutation M3** — this gate is PREVENTIVE, so a violation had to be
  introduced on purpose. Pre-edit gate token, measured with this same AST walk at
  the phase's base commit BEFORE any edit: 111 non-test modules scanned, 0
  module-scope binds. Mutation: appended
  ``_frozen_scratch = structlog.get_logger("scratch").bind(component="scratch")``
  at module scope in ``services/rate_limit.py``. Observed 1 failed / 2 passed —
  ``TestModeAModuleScopeBind::test_no_module_scope_bind_in_non_test_code`` FAILED
  with ``module-scope `.bind()` found at ['services/rate_limit.py:140']``. The
  scratch line was removed and the gate returned GREEN; ``git status`` shows
  services/rate_limit.py unmodified.

⛔ ``structlog.testing.capture_logs`` is deliberately NOT used anywhere in this
file. It REPLACES the processor chain, so ``_redact_processor`` never runs and a
redaction assertion written against it cannot fail. Everything below goes through
the real chain — a subprocess plus its captured stdout/stderr.
"""

from __future__ import annotations

import ast
import json
import subprocess
import sys
from pathlib import Path

import pytest

_ANALYTICS_ROOT: Path = Path(__file__).resolve().parents[1]

# A canary that appears in NO source file, so finding it in a captured stream is
# an unambiguous leak signal rather than an incidental substring match.
_LEAK_TOKEN = "QZ-OPS05-CANARY-9f2c4b1e7a3d"

# The shape services/logging_config.py's LogRecord factory exists to scrub: an
# HMAC-bearing ccxt request URL interpolated into a stdlib log call.
_HMAC_URL = (
    "https://api.binance.com/api/v3/order?symbol=BTCUSDT"
    "&timestamp=1700000000&signature=" + _LEAK_TOKEN
)

_SUBPROCESS_TIMEOUT_S = 300


def _run_probe(code: str) -> subprocess.CompletedProcess[str]:
    """Run `code` in a FRESH interpreter rooted at analytics-service/.

    A subprocess, not `structlog.reset_defaults()`, because structlog config and
    `logging.setLogRecordFactory` are process-global: an in-process test of
    "what happens before configure" would both depend on and corrupt whatever
    sibling tests did to those globals. A fresh interpreter is the only honest
    way to observe an UNCONFIGURED process.
    """
    return subprocess.run(
        [sys.executable, "-c", code],
        cwd=str(_ANALYTICS_ROOT),
        capture_output=True,
        text=True,
        timeout=_SUBPROCESS_TIMEOUT_S,
        check=False,
    )


def _json_event(stdout: str, event: str) -> dict:
    """Return the JSONRenderer line whose `event` field equals `event`.

    Importing an entrypoint prints unrelated chatter, so the line is located by
    content rather than by position. A missing line is itself a finding: it means
    the JSON renderer never ran, i.e. the process was not configured.
    """
    for raw in stdout.splitlines():
        line = raw.strip()
        if not line.startswith("{"):
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(record, dict) and record.get("event") == event:
            return record
    raise AssertionError(
        f"no JSON log line with event={event!r} on stdout — the configured "
        f"chain (JSONRenderer + _redact_processor) never ran in the probe "
        f"process. Captured stdout:\n{stdout}"
    )


# ---------------------------------------------------------------------------
# Mode B — the pre-configure window actually leaks (the danger this phase closes)
# ---------------------------------------------------------------------------

_PROBE_PRE_CONFIGURE = """
import structlog
structlog.get_logger("quantalyze.probe").info(
    "before_configure", api_key="__TOKEN__", safe_field="kept"
)
""".replace("__TOKEN__", _LEAK_TOKEN)


class TestModeBLeakMechanism:
    """The harness can SEE a leak. Without this, every green below is unfalsifiable."""

    def test_a_line_emitted_before_configure_leaks(self) -> None:
        """An unconfigured process prints a denylisted value verbatim.

        This is the load-bearing control for the whole file: it proves the
        subprocess + captured-stream harness distinguishes a configured process
        from an unconfigured one. If structlog ever ships a redacting default
        chain this test goes RED — at which point the entrypoint fixes are
        belt-and-braces rather than load-bearing, and that is worth knowing.
        """
        result = _run_probe(_PROBE_PRE_CONFIGURE)
        assert result.returncode == 0, (
            f"probe failed to run:\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )
        stream = result.stdout + result.stderr
        assert _LEAK_TOKEN in stream, (
            "expected the UNCONFIGURED process to leak the canary verbatim; it "
            "did not, so this file's redaction assertions are no longer proving "
            f"anything. Captured:\n{stream}"
        )


# ---------------------------------------------------------------------------
# Mode B — the worker entrypoint (the live instance) configures at import
# ---------------------------------------------------------------------------

_PROBE_WORKER = """
import logging
import structlog

# A module-scope-style lazy proxy obtained BEFORE the entrypoint is imported —
# the same shape every services/* module uses at its own module scope.
_module_scope_proxy = structlog.get_logger("quantalyze.probe")

import main_worker  # noqa: F401 -- importing the entrypoint is what must configure

_module_scope_proxy.info("worker_probe", api_key="__TOKEN__", safe_field="kept")

# Stdlib side: the setLogRecordFactory bridge must scrub records created by the
# plain `logging` logger that routers/exchange.py uses for ccxt failures.
logging.basicConfig(level=logging.INFO)
logging.getLogger("quantalyze.analytics").warning("ccxt failure: %s", "__URL__")
""".replace("__TOKEN__", _LEAK_TOKEN).replace("__URL__", _HMAC_URL)


@pytest.fixture(scope="module")
def worker_probe() -> subprocess.CompletedProcess[str]:
    """Import `main_worker` ONCE in a fresh interpreter and keep the streams.

    Importing the entrypoint pulls ccxt and the whole services graph (~10s), so
    the two assertions below share one process. Importing is side-effect-free
    with respect to the job queue: the loops only start from `main()`, which is
    behind the `if __name__ == "__main__"` guard, and the prod-worker refusal
    guard is likewise a `main()`-time call. No job is ever claimed here.
    """
    result = _run_probe(_PROBE_WORKER)
    assert result.returncode == 0, (
        f"`import main_worker` probe failed:\nSTDOUT:\n{result.stdout}\n"
        f"STDERR:\n{result.stderr}"
    )
    return result


class TestModeBWorkerEntrypoint:
    """`python -m main_worker` emits through the redacting chain, or this reddens."""

    def test_worker_entrypoint_installs_the_structlog_redactor(
        self, worker_probe: subprocess.CompletedProcess[str]
    ) -> None:
        """Importing main_worker must configure structlog before anything emits.

        RED demo M1 (see module docstring): commenting out the module-scope
        `configure_logging()` in main_worker.py makes `_json_event` raise —
        there is no JSON line at all, because the default ConsoleRenderer is
        still installed.
        """
        record = _json_event(worker_probe.stdout, "worker_probe")
        assert record["api_key"] == "[REDACTED]", (
            f"denylisted key survived the worker's chain: {record!r}"
        )
        assert record["safe_field"] == "kept", (
            "redaction must not swallow non-sensitive fields — a chain that "
            f"drops everything would pass the assertion above for free: {record!r}"
        )
        assert _LEAK_TOKEN not in worker_probe.stdout, (
            f"canary leaked to worker stdout:\n{worker_probe.stdout}"
        )

    def test_worker_entrypoint_installs_the_stdlib_logrecord_bridge(
        self, worker_probe: subprocess.CompletedProcess[str]
    ) -> None:
        """`logger.warning("ccxt: %s", <hmac url>)` is scrubbed on the worker too.

        The structlog processor alone does not cover this path: routers and
        services also emit through plain `logging`, which only gets scrubbed
        because `configure_logging()` installs a LogRecord factory wrapper. The
        worker never called it before this phase.
        """
        stream = worker_probe.stdout + worker_probe.stderr
        assert "ccxt failure" in stream, (
            f"the stdlib probe line never reached a handler:\n{stream}"
        )
        assert _LEAK_TOKEN not in stream, (
            f"HMAC signature leaked through the stdlib path on the worker:\n{stream}"
        )
        assert "[REDACTED]" in stream, (
            f"expected the [REDACTED] marker on the scrubbed line:\n{stream}"
        )


_PROBE_WORKER_BROKEN_SCRUBBER = """
import structlog

_module_scope_proxy = structlog.get_logger("quantalyze.probe")

import main_worker  # noqa: F401
import services.logging_config as lc


def _boom(_value):
    raise RuntimeError("negative control: scrubber disabled on purpose")


lc._redact_scrub_pii = _boom

_module_scope_proxy.info("worker_probe", api_key="__TOKEN__", safe_field="kept")
""".replace("__TOKEN__", _LEAK_TOKEN)


class TestModeBNegativeControl:
    """Proof that the redaction assertion above is load-bearing, not decorative."""

    def test_breaking_the_scrubber_lets_the_canary_through(self) -> None:
        """Same entrypoint, same harness, scrubber disabled → the canary survives.

        Follows the house negative-control idiom in
        tests/test_logging_config.py (monkeypatch `_redact_scrub_pii` to raise,
        then assert the UNREDACTED value flows through — `_redact_processor` is
        documented fail-open, so a redaction bug degrades to plaintext rather
        than to a dropped line).

        This is what makes
        `test_worker_entrypoint_installs_the_structlog_redactor` falsifiable
        WITHOUT a manual neuter: only one variable differs between the two, and
        the observed outcome differs with it.
        """
        result = _run_probe(_PROBE_WORKER_BROKEN_SCRUBBER)
        assert result.returncode == 0, (
            f"negative-control probe failed:\nSTDOUT:\n{result.stdout}\n"
            f"STDERR:\n{result.stderr}"
        )
        record = _json_event(result.stdout, "worker_probe")
        assert record["api_key"] == _LEAK_TOKEN, (
            "with the scrubber disabled the canary should have survived "
            "verbatim. It did not, which means the GREEN in "
            "test_worker_entrypoint_installs_the_structlog_redactor is being "
            f"produced by something other than _redact_processor: {record!r}"
        )


# ---------------------------------------------------------------------------
# Mode B — entrypoint ORDERING is a source-level invariant, not a convention
# ---------------------------------------------------------------------------

# Import roots that are OUR code. Any of these can log at import time; none of
# them may be imported before the process has a redacting chain.
_FIRST_PARTY_ROOTS: frozenset[str] = frozenset(
    {"routers", "services", "sentry_init", "main", "main_worker", "main_worker_healthz"}
)

# The one first-party module that MUST be importable before configuration: it is
# what provides configure_logging(). It is a near-leaf (structlog +
# services.redact) and emits nothing at import.
_CONFIG_MODULE = "services.logging_config"

# Each entrypoint plus one first-party import it must dominate. The second element
# anchors the walk: if the AST scan silently stopped finding imports, an ordering
# assertion over an empty list would pass forever.
_ENTRYPOINTS: tuple[tuple[str, str], ...] = (
    ("main.py", "routers"),
    ("main_worker.py", "services.job_worker"),
)


def _callee_name(func: ast.expr) -> str | None:
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def _module_scope_configure_linenos(tree: ast.Module) -> list[int]:
    """Line numbers of top-level bare `configure_logging()` calls."""
    return [
        node.lineno
        for node in tree.body
        if isinstance(node, ast.Expr)
        and isinstance(node.value, ast.Call)
        and _callee_name(node.value.func) == "configure_logging"
    ]


def _module_scope_first_party_imports(tree: ast.Module) -> list[tuple[int, str]]:
    """(lineno, dotted name) for every top-level first-party import.

    `services.logging_config` is excluded — importing the configurator cannot
    precede configuring. Relative imports are excluded because an entrypoint is
    never a package member.
    """
    found: list[tuple[int, str]] = []
    for node in tree.body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == _CONFIG_MODULE:
                    continue
                if alias.name.split(".")[0] in _FIRST_PARTY_ROOTS:
                    found.append((node.lineno, alias.name))
        elif isinstance(node, ast.ImportFrom):
            if node.level != 0:
                continue
            module = node.module or ""
            if module == _CONFIG_MODULE:
                continue
            if module.split(".")[0] in _FIRST_PARTY_ROOTS:
                found.append((node.lineno, module))
    return sorted(found)


class TestEntrypointOrdering:
    """Both processes configure logging before any of our code can emit."""

    @pytest.mark.parametrize(("entrypoint", "anchor"), _ENTRYPOINTS)
    def test_entrypoint_configures_logging_before_any_first_party_import(
        self, entrypoint: str, anchor: str
    ) -> None:
        """THE ORDERING GATE. Sinking the call below the imports reddens here.

        RED demo M2 (see module docstring): moving `configure_logging()` in
        main.py back below `from routers import ...` — its position before this
        phase — fails this test for `main.py`, naming `routers` as the import
        that would now precede configuration.
        """
        tree = ast.parse((_ANALYTICS_ROOT / entrypoint).read_text(encoding="utf-8"))

        configure_at = _module_scope_configure_linenos(tree)
        assert configure_at, (
            f"{entrypoint} has no module-scope `configure_logging()` call. The "
            "process it starts emits through structlog's DEFAULT chain — no "
            "_redact_processor, no stdlib LogRecord bridge — for its entire "
            "lifetime. That is the exact state main_worker.py was in before "
            "OPS-05. Re-add the call; do not delete this gate."
        )

        imports = _module_scope_first_party_imports(tree)
        assert imports, (
            f"the AST walk found no first-party imports in {entrypoint}, so the "
            "ordering assertion below would agree with everything. The module "
            "layout changed or _FIRST_PARTY_ROOTS drifted. Re-anchor this gate."
        )
        assert any(
            name == anchor or name.startswith(anchor + ".") for _, name in imports
        ), (
            f"{entrypoint} no longer imports {anchor!r} at module scope. That "
            "import is this gate's anchor — without it the walk could be "
            f"measuring a truncated surface. Found: {[n for _, n in imports]}"
        )

        first_lineno, first_name = imports[0]
        assert min(configure_at) < first_lineno, (
            f"{entrypoint}: `configure_logging()` is at line {min(configure_at)} "
            f"but the first-party import {first_name!r} at line {first_lineno} "
            "runs BEFORE it. Any log line emitted while that module is being "
            "imported renders through the unredacted default chain — an "
            "HMAC-bearing ccxt string or an MT5 password in that line reaches "
            "the log sink verbatim. Hoist the call back above the imports."
        )


# ---------------------------------------------------------------------------
# Mode A — no module-scope `.bind()` anywhere in non-test code
# ---------------------------------------------------------------------------

# PRE-EDIT gate token. Measured 2026-08-26 against this phase's base commit,
# BEFORE any source edit in this phase, with the same AST walk used below:
#   files_scanned = 111, module_scope_bind_count = 0
# The gate is therefore PREVENTIVE. Its RED demo is mutation M3 in the module
# docstring — a deliberate scratch violation — because a preventive gate that has
# never been observed failing is indistinguishable from one that cannot fail.
_MODE_A_EXPECTED_BINDS = 0

# Anti-vacuity floor. 111 non-test modules at measurement; 90 leaves room for
# genuine deletions while still catching a walk that collapsed (wrong root, a
# renamed package, an exclusion rule that swallowed the tree).
_MIN_NON_TEST_MODULES = 90

# Modules the walk MUST reach. A floor alone does not prove the walk covers the
# code that actually matters — these are the entrypoints and the logging/credential
# surfaces this phase is about.
_ANCHOR_MODULES: frozenset[str] = frozenset(
    {
        "main.py",
        "main_worker.py",
        "services/logging_config.py",
        "services/mt5_client.py",
        "routers/exchange.py",
    }
)

_EXCLUDED_DIR_PARTS: frozenset[str] = frozenset(
    {"tests", "__pycache__", ".venv", "venv", "site-packages", "build", "node_modules"}
)


def _non_test_modules() -> list[Path]:
    return [
        path
        for path in sorted(_ANALYTICS_ROOT.rglob("*.py"))
        if not (_EXCLUDED_DIR_PARTS & set(path.relative_to(_ANALYTICS_ROOT).parts))
    ]


def _module_scope_binds() -> list[str]:
    """`relpath:lineno` for every top-level assignment whose value is a `.bind(...)`.

    AST, not grep, for the reason tests/test_redact.py gives for its own scan:
    docstring prose mentioning `.bind()` — this file is full of it, and so is
    services/mt5_client.py — would false-positive a text search. `tree.body`
    only, because a `.bind()` inside a function runs after configuration.
    """
    violations: list[str] = []
    for path in _non_test_modules():
        rel = path.relative_to(_ANALYTICS_ROOT).as_posix()
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=rel)
        for node in tree.body:
            if isinstance(node, ast.Assign):
                value = node.value
            elif isinstance(node, ast.AnnAssign) and node.value is not None:
                value = node.value
            else:
                continue
            if (
                isinstance(value, ast.Call)
                and isinstance(value.func, ast.Attribute)
                and value.func.attr == "bind"
            ):
                violations.append(f"{rel}:{node.lineno}")
    return violations


_PROBE_MODE_A = """
import structlog

# The forbidden shape, at module scope, before anything configures.
_frozen = structlog.get_logger("mode_a").bind(component="probe")

from services.logging_config import configure_logging

configure_logging()

_frozen.info("mode_a_event", api_key="__TOKEN__")
""".replace("__TOKEN__", _LEAK_TOKEN)


class TestModeAModuleScopeBind:
    """A module-scope `.bind()` escapes redaction permanently. Nothing may have one."""

    def test_the_walk_is_not_vacuous(self) -> None:
        """⚠️ ASSERTED FIRST, and it is not a formality.

        The gate below is a statement about a DERIVED population. If the
        derivation returns nothing — a moved root, an exclusion rule that ate the
        tree, a renamed package — `violations == []` passes against the empty set.
        A scan that reads nothing agrees with everything, forever.
        """
        modules = _non_test_modules()
        assert len(modules) >= _MIN_NON_TEST_MODULES, (
            f"the walk found only {len(modules)} non-test modules under "
            f"analytics-service/ (expected at least {_MIN_NON_TEST_MODULES}; 111 "
            "at the 2026-08-26 measurement). The scan root moved or an exclusion "
            "rule widened, so the gate below is measuring a truncated surface. "
            "Re-anchor this gate, do not delete it."
        )
        scanned = {p.relative_to(_ANALYTICS_ROOT).as_posix() for p in modules}
        missing = _ANCHOR_MODULES - scanned
        assert not missing, (
            f"the walk did not reach {sorted(missing)} — the entrypoints and "
            "credential-adjacent modules this gate exists for. A high file count "
            "with the wrong files in it is still a vacuous scan."
        )

    def test_no_module_scope_bind_in_non_test_code(self) -> None:
        """THE GATE. A new module-scope `.bind()` reddens here, by file and line.

        RED demo M3 (see module docstring): adding
        `_frozen_scratch = structlog.get_logger("scratch").bind(component="scratch")`
        at module scope in services/rate_limit.py failed this test with
        `module-scope `.bind()` found at ['services/rate_limit.py:140']` — the
        violation is reported by file AND line, so the failure is actionable
        without re-running a search. The scratch line was removed afterwards and
        services/rate_limit.py is unmodified in this phase.
        """
        violations = _module_scope_binds()
        assert len(violations) == _MODE_A_EXPECTED_BINDS, (
            f"module-scope `.bind()` found at {violations}. `.bind()` returns a "
            "CONCRETE BoundLogger built from the processor chain in force at that "
            "instant; at module scope that is import time, before any entrypoint "
            "configures, so the object carries structlog's default chain — no "
            "_redact_processor — for the life of the process, and no later "
            "structlog.configure() can reach it. Move the bind inside the "
            "function that logs (see services/mt5_client.py::_stage_logger), or "
            "bind onto a proxy obtained at call time. Do not add an allowlist."
        )

    def test_a_module_scope_bind_leaks_even_after_configure(self) -> None:
        """The mechanism the gate guards, demonstrated rather than asserted.

        A module-scope bind, then `configure_logging()`, then an emission
        carrying a denylisted key: the value comes out VERBATIM. This is what
        makes the gate above a security control rather than a style rule, and it
        is why the gate has no allowlist — there is no safe way to hold one of
        these.

        If a future structlog release makes the bound logger re-read the config,
        this test goes RED. That is the correct outcome: re-read the gate's
        rationale before relaxing it, do not silence this.
        """
        result = _run_probe(_PROBE_MODE_A)
        assert result.returncode == 0, (
            f"Mode A probe failed:\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )
        stream = result.stdout + result.stderr
        assert _LEAK_TOKEN in stream, (
            "expected the module-scope-bound logger to leak the canary even "
            "after configure_logging(); it did not. structlog's binding "
            f"semantics may have changed. Captured:\n{stream}"
        )

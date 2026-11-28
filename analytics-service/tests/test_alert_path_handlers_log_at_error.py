"""ALRT-04 pin (Phase 245 ALERTPAGE): every except arm on the paging path logs at
ERROR, captures a Sentry event, or re-raises into a handler that does.

WHY this exists (Rule 9: a test that cannot fail when the business logic changes is
wrong):

* An ERROR log line is a Sentry event under the default ``LoggingIntegration``
  (``event_level`` ERROR, measured by the phase research in the 3.12 venv). A WARNING
  reaches no rule. Before this phase a lost open-page record, a failed tracker, a
  failed debt page and a failed probe all logged at WARNING, so the path that exists
  to tell the founder something is wrong could fail with nobody told.
* A structural gate that is only ever run against the file it polices cannot be told
  apart from one that returns the empty list. That is why ``alert_path_defects`` is
  parameterised by SOURCE TEXT and is fed a table of mutants (one per rule), plus
  controls that must stay clean. If a rule stops firing, the mutant test fails.
* The allowlist is BY SYMBOL (``<module>.<qualname>:<handler type>@<callee>``), not by
  line number, so it survives unrelated edits, and every entry carries a reviewed
  reason a reader can check.
* The stale-entry rule (R4) exists so Phase 246 ALERTREADERS, which owns the
  scrub-reader arms (``164.6.8-F6-SCRUB-READER-NEWEST-ONLY``), is forced to delete its
  entries here when it moves those arms to ERROR: the pin goes red until it does.

RULES
  R1  a handler body (walked recursively) contains a WARNING-level call.
  R2  a handler is SILENT: no ERROR-level call, no ``sentry_sdk.capture_*`` call, and
      its last statement is not a bare ``raise``.
  R3  (``module_wide`` only) a WARNING-level call outside every handler.
  R4  an allowlist key that matches no R1/R2/R3 hit is itself a defect.
  R5  two in-scope arms (or outside calls) resolve to the same key, so one allowlist
      entry could silently cover a second one. Refine the discriminator, never
      allowlist around it.

KEY. ``<module>.<qualname>:<handler type>@<callee>``. ``<callee>`` is the matching
``try`` body's first awaited call in source order, IGNORING nested ``try`` statements,
with ``asyncio.wait_for(x(...))`` unwrapped to ``x``; failing that its first call (same
exclusion); failing that ``<none>``. A handler of a ``try`` sitting inside another
handler's body is keyed ``<enclosing key>/fallback`` when it catches ``BaseException``
(the IN-06 shape: an argument-free log line, no await) and
``<enclosing key>/nested:<type>@<callee>`` otherwise. A WARNING call outside every
handler is keyed ``<module>.<qualname>:call``.

Only ``ast``, ``pathlib``, ``typing`` and ``pytest`` are used.
"""

from __future__ import annotations

import ast
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

import pytest

_SERVICE_ROOT = Path(__file__).resolve().parent.parent

_LOG_RECEIVERS = frozenset({"logger", "logging", "log", "_logger", "LOGGER"})
_WARN_METHODS = frozenset({"warning", "warn"})
_ERROR_METHODS = frozenset({"error", "exception", "critical"})
_WARN_LEVELS = frozenset({"WARNING", "WARN"})
_ERROR_LEVELS = frozenset({"ERROR", "CRITICAL"})
_LOWER_LEVELS = frozenset({"INFO", "DEBUG", "NOTSET"})


def _names_in(expr: ast.AST) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(expr):
        if isinstance(node, ast.Name):
            names.add(node.id)
        elif isinstance(node, ast.Attribute):
            names.add(node.attr)
    return names


def _call_kind(node: ast.AST) -> str | None:
    """``"warning"``, ``"error"``, ``"capture"`` or ``None`` for one AST node."""
    if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
        return None
    attr = node.func.attr
    receiver = node.func.value
    if isinstance(receiver, ast.Name) and receiver.id == "sentry_sdk":
        return "capture" if attr.startswith("capture_") else None
    if not (isinstance(receiver, ast.Name) and receiver.id in _LOG_RECEIVERS):
        return None
    if attr in _WARN_METHODS:
        return "warning"
    if attr in _ERROR_METHODS:
        return "error"
    if attr == "log":
        level: ast.AST | None = node.args[0] if node.args else None
        for kw in node.keywords:
            if kw.arg == "level":
                level = kw.value
        if level is None:
            return None
        names = _names_in(level)
        if names & _WARN_LEVELS:
            return "warning"
        if names & _ERROR_LEVELS and not names & (_WARN_LEVELS | _LOWER_LEVELS):
            return "error"
    return None


def _is_bare_raise(stmt: ast.stmt) -> bool:
    return isinstance(stmt, ast.Raise) and stmt.exc is None


def _skip_nested_try(node: ast.AST) -> list[ast.AST]:
    """Every node under ``node`` (inclusive) except anything inside a nested Try."""
    found: list[ast.AST] = []

    def visit(n: ast.AST) -> None:
        found.append(n)
        for child in ast.iter_child_nodes(n):
            if isinstance(child, ast.Try):
                continue
            visit(child)

    visit(node)
    return found


def _call_name(call: ast.Call) -> str:
    func = ast.unparse(call.func)
    if func in {"asyncio.wait_for", "wait_for"} and call.args:
        inner = call.args[0]
        if isinstance(inner, ast.Call):
            return ast.unparse(inner.func)
    return func


def _callee(try_node: ast.Try) -> str:
    nodes: list[ast.AST] = []
    for stmt in try_node.body:
        nodes.extend(_skip_nested_try(stmt))
    by_position = sorted(
        nodes, key=lambda n: (getattr(n, "lineno", 0), getattr(n, "col_offset", 0))
    )
    for n in by_position:
        if isinstance(n, ast.Await) and isinstance(n.value, ast.Call):
            return _call_name(n.value)
    for n in by_position:
        if isinstance(n, ast.Call):
            return _call_name(n)
    return "<none>"


@dataclass
class _Arm:
    key: str
    lineno: int
    rules: list[str] = field(default_factory=list)


def alert_path_defects(
    source: str,
    module: str,
    *,
    scope: frozenset[str] | None,
    module_wide: bool,
    allow: Mapping[str, str],
) -> list[str]:
    """Every ALRT-04 defect in ``source``. Parameterised by text so mutants can be fed."""
    tree = ast.parse(source)
    arms: list[_Arm] = []
    outside: list[tuple[str, int]] = []  # (key, lineno) of WARNING calls outside handlers

    def in_scope(qual: str) -> bool:
        if scope is None:
            return True
        return any(qual == s or qual.startswith(s + ".") for s in scope)

    def visit(node: ast.AST, qual: str, enc_key: str | None) -> None:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            qual = f"{qual}.{node.name}" if qual else node.name
            enc_key = None
        if isinstance(node, ast.Try):
            for stmt in (*node.body, *node.orelse, *node.finalbody):
                visit(stmt, qual, enc_key)
            callee = _callee(node)
            for handler in node.handlers:
                htype = ast.unparse(handler.type) if handler.type is not None else "<bare>"
                if enc_key is None:
                    key = f"{module}.{qual or '<module>'}:{htype}@{callee}"
                elif htype == "BaseException":
                    key = f"{enc_key}/fallback"
                else:
                    key = f"{enc_key}/nested:{htype}@{callee}"
                arm = _Arm(key=key, lineno=handler.lineno)
                if in_scope(qual):
                    _judge_handler(handler, arm)
                    arms.append(arm)
                for stmt in handler.body:
                    visit(stmt, qual, key)
            return
        if enc_key is None and _call_kind(node) == "warning" and in_scope(qual):
            outside.append((f"{module}.{qual or '<module>'}:call", node.lineno))
        for child in ast.iter_child_nodes(node):
            visit(child, qual, enc_key)

    def _judge_handler(handler: ast.ExceptHandler, arm: _Arm) -> None:
        kinds = [
            _call_kind(n)
            for stmt in handler.body
            for n in ast.walk(stmt)
            if isinstance(n, ast.Call)
        ]
        if "warning" in kinds:
            arm.rules.append("R1 a WARNING-level call in a paging-path handler: use ERROR")
        silent = (
            "error" not in kinds
            and "capture" not in kinds
            and not (handler.body and _is_bare_raise(handler.body[-1]))
        )
        if silent:
            arm.rules.append(
                "R2 a SILENT handler: no ERROR log, no Sentry capture and no re-raise"
            )

    visit(tree, "", None)

    defects: list[str] = []
    hit_keys: set[str] = set()
    locations: dict[str, list[int]] = {}
    for arm in arms:
        locations.setdefault(arm.key, []).append(arm.lineno)
        if arm.rules:
            hit_keys.add(arm.key)
            if arm.key not in allow:
                for rule in arm.rules:
                    defects.append(f"{arm.key} (line {arm.lineno}): {rule}")
    if module_wide:
        for key, lineno in outside:
            locations.setdefault(key, []).append(lineno)
            hit_keys.add(key)
            if key not in allow:
                defects.append(
                    f"{key} (line {lineno}): R3 a WARNING-level call outside every "
                    "handler on the paging path: use ERROR"
                )
    for key in sorted(allow):
        if key not in hit_keys:
            defects.append(f"stale allowlist entry {key}: remove it")
    for key, lines in sorted(locations.items()):
        if len(lines) > 1:
            defects.append(
                f"ambiguous key {key} (lines {sorted(lines)}): one allowlist entry "
                "would cover both"
            )
    return defects


# --------------------------------------------------------------------------- #
# Mutant calibration: each rule must be able to fire, and the controls must not.
# --------------------------------------------------------------------------- #

_HEADER = "import logging\nlogger = logging.getLogger('x')\n"

_MUTANTS: list[tuple[str, str, bool, dict[str, str], tuple[str, ...]]] = [
    (
        "R1-logger-warning",
        _HEADER
        + "def f():\n    try:\n        g()\n    except Exception:\n"
        + "        logger.warning('x')\n",
        False,
        {},
        ("R1", "m.f:Exception@g"),
    ),
    (
        "R1-logger-log-WARNING",
        _HEADER
        + "def f():\n    try:\n        g()\n    except Exception:\n"
        + "        logger.log(logging.WARNING, 'x')\n",
        False,
        {},
        ("R1", "m.f:Exception@g"),
    ),
    (
        "R2-silent-return-none",
        "def f():\n    try:\n        g()\n    except Exception:\n        return None\n",
        False,
        {},
        ("R2", "m.f:Exception@g"),
    ),
    (
        "R2-in06-fallback-pass",
        _HEADER
        + "async def f():\n    try:\n        await g()\n    except Exception as exc:\n"
        + "        try:\n            logger.error('x %s', type(exc).__name__)\n"
        + "        except BaseException:\n            pass\n",
        False,
        {},
        ("R2", "m.f:Exception@g/fallback"),
    ),
    (
        "R3-module-function-warning-outside-handler",
        _HEADER + "def f():\n    logger.warning('x')\n",
        True,
        {},
        ("R3", "m.f:call"),
    ),
    (
        "R4-allow-key-matches-nothing",
        _HEADER
        + "def f():\n    try:\n        g()\n    except Exception:\n"
        + "        logger.error('x')\n",
        False,
        {"m.nothing:Exception@g": "stale"},
        ("stale allowlist entry m.nothing:Exception@g",),
    ),
    (
        "R5-two-siblings-one-key",
        _HEADER
        + "def f():\n    try:\n        g()\n    except Exception:\n"
        + "        logger.error('a')\n"
        + "    try:\n        g()\n    except Exception:\n        logger.error('b')\n",
        False,
        {},
        ("ambiguous key", "m.f:Exception@g"),
    ),
]

_CONTROLS: list[tuple[str, str, bool, dict[str, str]]] = [
    (
        "control-logger-error",
        _HEADER
        + "def f():\n    try:\n        g()\n    except Exception:\n"
        + "        logger.error('x')\n",
        True,
        {},
    ),
    (
        "control-bare-raise",
        "def f():\n    try:\n        g()\n    except Exception:\n"
        + "        cleanup()\n        raise\n",
        True,
        {},
    ),
    (
        "control-sentry-capture",
        "import sentry_sdk\ndef f():\n    try:\n        g()\n    except Exception as e:\n"
        + "        sentry_sdk.capture_exception(e)\n",
        True,
        {},
    ),
    (
        "control-warning-outside-handler-not-module-wide",
        _HEADER + "def f():\n    logger.warning('x')\n",
        False,
        {},
    ),
    (
        "control-allowlisted-hit",
        _HEADER
        + "def f():\n    try:\n        g()\n    except Exception:\n"
        + "        logger.warning('x')\n",
        False,
        {"m.f:Exception@g": "a reviewed reason"},
    ),
    (
        "control-logger-log-ERROR",
        _HEADER
        + "def f():\n    try:\n        g()\n    except Exception:\n"
        + "        logger.log(logging.ERROR, 'x')\n",
        True,
        {},
    ),
]


@pytest.mark.parametrize(
    "source, module_wide, allow, needles",
    [pytest.param(s, w, a, n, id=i) for i, s, w, a, n in _MUTANTS],
)
def test_the_pin_names_every_rule_on_a_mutant(
    source: str, module_wide: bool, allow: dict[str, str], needles: tuple[str, ...]
) -> None:
    defects = alert_path_defects(
        source, "m", scope=None, module_wide=module_wide, allow=allow
    )
    assert any(all(n in d for n in needles) for d in defects), (
        f"no defect carries {needles}; got {defects}"
    )


@pytest.mark.parametrize(
    "source, module_wide, allow",
    [pytest.param(s, w, a, id=i) for i, s, w, a in _CONTROLS],
)
def test_the_pin_stays_quiet_on_a_control(
    source: str, module_wide: bool, allow: dict[str, str]
) -> None:
    assert (
        alert_path_defects(source, "m", scope=None, module_wide=module_wide, allow=allow)
        == []
    )


# --------------------------------------------------------------------------- #
# The real files.
# --------------------------------------------------------------------------- #

_PHASE_246_SCRUB_READER = (
    "PHASE 246 ALERTREADERS owns the scrub reader (`164.6.8-F6-SCRUB-READER-NEWEST-ONLY`, "
    "which hides its own read errors at WARNING). Phase 246 deletes this entry when it "
    "moves the arm to ERROR; the stale-entry rule fails the pin until it does."
)

_TARGETS: list[
    tuple[str, str, frozenset[str] | None, bool, dict[str, str]]
] = [
    (
        "ops_alert",
        "services/ops_alert.py",
        None,
        True,
        {
            "ops_alert.page:call": (
                "the recovered floor line: a recovery is not an error (Phase 245 "
                "CONTEXT [Loud failures]); an outage's floor line is ERROR"
            ),
            "ops_alert._resolve_ops_alert_url:ValueError@urlsplit": (
                "a URL that does not parse falls through to the ERROR refusal a few "
                "lines below, which names the variable"
            ),
            "ops_alert.await_delivery:Exception@asyncio.shield": (
                "answers 'not delivered'; both callers (mt5_outage_alert."
                "_finish_recovered, mt5_validation_liveness._close_after_recovered) "
                "log ERROR on False"
            ),
        },
    ),
    ("mt5_outage_alert", "services/mt5_outage_alert.py", None, True, {}),
    (
        "ops_alert_open",
        "services/ops_alert_open.py",
        None,
        True,
        {
            "ops_alert_open._parse_since:ValueError@datetime.fromisoformat": (
                "a malformed stored timestamp reads as an unknown `since`; that is "
                "not a paging failure"
            ),
        },
    ),
    # Tier B: the wrappers, the probe and the monitor's tick. `module_wide=False`
    # because these files also hold code that is not the paging path.
    (
        "mt5_relogin",
        "services/mt5_relogin.py",
        frozenset({"_stash_for_outage_alert", "_page_for_outage_alert"}),
        False,
        {},
    ),
    (
        "mt5_validation_liveness",
        "services/mt5_validation_liveness.py",
        None,
        False,
        {
            "mt5_validation_liveness._scrub_restart_recovery:Exception"
            "@ops_alert_open.read_open_page": _PHASE_246_SCRUB_READER,
            "mt5_validation_liveness.read_unscrubbed_validation_terminal:Exception"
            "@_read_newest_scrub_row": _PHASE_246_SCRUB_READER,
            "mt5_validation_liveness.read_unscrubbed_validation_terminal:Exception"
            "@_read_newest_scrub_row/fallback": _PHASE_246_SCRUB_READER,
            "mt5_validation_liveness._parse_completed_at:ValueError"
            "@datetime.fromisoformat": (
                "the scrub reader's timestamp parse (Phase 246 ALERTREADERS owns the "
                "reader), and a malformed stored timestamp reads as unknown, which is "
                "not a paging failure"
            ),
            "mt5_validation_liveness._probe_blocking:Mt5ClientError"
            "@client.assert_session_authorized": (
                "the bridge's own answer mapped to a reading kind: a measurement the "
                "tracker counts and pages at the threshold, not a failure of the "
                "paging path"
            ),
            "mt5_validation_liveness.probe_validation_terminal:Mt5TerminalBusyError"
            "@asyncio.to_thread": (
                "busy_skip: a counted not-measured reading that the tracker pages at "
                "the threshold; a terminal state being measured, not a failure"
            ),
            "mt5_validation_liveness.probe_validation_terminal:asyncio.TimeoutError"
            "@asyncio.to_thread": (
                "budget_abandoned: a counted not-measured reading with its INFO "
                "reading line, paged at the threshold; a measured state, not a failure"
            ),
        },
    ),
    (
        "mt5_session_monitor",
        "services/mt5_session_monitor.py",
        frozenset({"run_mt5_session_monitor_tick"}),
        False,
        {
            "mt5_session_monitor.run_mt5_session_monitor_tick:asyncio.TimeoutError"
            "@read_unscrubbed_validation_terminal": _PHASE_246_SCRUB_READER,
        },
    ),
]


@pytest.mark.parametrize(
    "relpath, scope, module_wide, allow",
    [pytest.param(p, s, w, a, id=i) for i, p, s, w, a in _TARGETS],
)
def test_the_paging_path_arms_log_at_error(
    relpath: str, scope: frozenset[str] | None, module_wide: bool, allow: dict[str, str]
) -> None:
    path = _SERVICE_ROOT / relpath
    defects = alert_path_defects(
        path.read_text(encoding="utf-8"),
        path.stem,
        scope=scope,
        module_wide=module_wide,
        allow=allow,
    )
    assert defects == [], f"{relpath}:\n" + "\n".join(defects)

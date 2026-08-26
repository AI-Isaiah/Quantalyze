"""HONEST-01 / D-162-4 — the `computation_error` columns hold USER COPY.

Phase 162, plan 02. `portfolio_analytics.computation_error` renders verbatim on
the portfolio dashboard (``src/app/(dashboard)/portfolios/[id]/page.tsx``
StaleWarning), so whatever the catch-all writes there is a sentence an account
holder reads. It used to write ``f"{type(exc).__name__}: {str(exc)[:400]}"``.

These pins are the Python half of the same invariant
``analytics-service/tests/test_allocator_positions.py`` already holds over
``api_keys.sync_error``, and they assert all THREE of its parts, because any two
without the third describe a different (and wrong) fix:

  1. the raw text is ABSENT from the user-visible column;
  2. what IS there is the curated constant;
  3. the DIAGNOSIS SURVIVES on the operator surface — here the
     ``logger.exception(..., exc_info=True)`` line, which is what Sentry reads.

Part 3 is not decoration. Curating ``DispatchResult.error_message`` instead of
the write boundary was the rejected alternative for the STRATEGY side of this
same requirement (see ``162-02-DECISION.md`` and migration 20260826120000): it
looks like a relocation of the fix and is actually a regression, because it
trades a dishonest screen for a blind operator.

⚠️ The STRATEGY side of HONEST-01 is NOT pinned here. Its write boundary is SQL
— ``sync_strategy_analytics_status`` branches (b)/(b-prime) — and it is pinned
at apply time by migration 20260826120000's self-verify block and behaviourally
by ``supabase/tests/test_sync_status_marked_refresh_protected.sql`` arms A and I.
A Python test cannot reach that boundary; asserting the Python stamp here would
have been an assertion that passes while the user still sees a raw exception,
which is exactly the trap this phase walked into once already.
"""

from __future__ import annotations

import ast
import inspect
import logging
import sys
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from routers import portfolio as portfolio_mod

# A marker that could only have come from the raised exception. Chosen so that
# a substring test cannot pass by accident against ordinary English copy.
_CANARY = "canary_a41f9c_portfolio_boom"


@pytest.fixture(autouse=True)
def _pin_portfolio_module_in_sys_modules():
    """Other modules in this suite unload ``routers.portfolio``; when they have,
    ``patch("routers.portfolio.get_supabase")`` re-imports it and the re-import
    raises on a missing SUPABASE_URL. Same pin as
    test_portfolio_compute_integration.py, and restored the same way.
    """
    prior = sys.modules.get("routers.portfolio")
    sys.modules["routers.portfolio"] = portfolio_mod
    try:
        yield
    finally:
        if prior is None:
            sys.modules.pop("routers.portfolio", None)
        else:
            sys.modules["routers.portfolio"] = prior


def _supabase_that_explodes_after_the_computing_row() -> tuple[MagicMock, MagicMock]:
    """A supabase double that lets the INSERT of the 'computing' row succeed —
    so ``_fail`` has an ``analytics_id`` to write to — and then raises the
    canary out of the first statement inside the try. That is the shortest
    honest route to the catch-all: no partial pipeline, no second failure mode
    competing for the assertion.
    """
    pa = MagicMock()
    pa.insert.return_value.execute.return_value = MagicMock(data=[{"id": "analytics-1"}])
    pa.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[])

    ps = MagicMock()
    ps.select.return_value.eq.return_value.execute.side_effect = RuntimeError(_CANARY)

    tables: dict[str, MagicMock] = {
        "portfolio_analytics": pa,
        "portfolio_strategies": ps,
    }
    sb = MagicMock()
    sb.table.side_effect = lambda name: tables.setdefault(name, MagicMock())
    return sb, pa


def _computation_error_writes(pa: MagicMock) -> list[Any]:
    """Every value the run put into ``portfolio_analytics.computation_error``."""
    return [
        call.args[0]["computation_error"]
        for call in pa.update.call_args_list
        if call.args and "computation_error" in call.args[0]
    ]


class TestPortfolioFailCatchAll:
    """Test E / Test F — the ``_fail`` catch-all at the end of
    ``_compute_portfolio_analytics``."""

    @pytest.mark.asyncio
    async def test_catch_all_writes_curated_copy_not_the_exception(self, caplog):
        sb, pa = _supabase_that_explodes_after_the_computing_row()

        with caplog.at_level(logging.ERROR, logger="quantalyze.analytics"), \
                patch("routers.portfolio.get_supabase", return_value=sb):
            with pytest.raises(Exception):
                await portfolio_mod._compute_portfolio_analytics("portfolio-1")

        written = _computation_error_writes(pa)
        assert written, (
            "the catch-all did not write computation_error at all; the row would "
            f"be stuck at 'computing'. update calls: {pa.update.call_args_list!r}"
        )

        for value in written:
            # (1) the raw text is ABSENT from the user-visible column.
            assert _CANARY not in value, (
                f"raw exception text reached portfolio_analytics.computation_error: {value!r}"
            )
            assert "RuntimeError" not in value, (
                f"the exception's TYPE NAME reached the user column: {value!r}"
            )
            # (2) and what IS there is the curated constant.
            assert value == portfolio_mod.PORTFOLIO_COMPUTE_FAILED_COPY, (
                f"computation_error is not the curated constant: {value!r}"
            )

        # (3) the DIAGNOSIS is not lost — it survives on the operator surface.
        # `logger.exception(..., exc_info=True)` puts the class and the message
        # on the log record, which is what Sentry ships.
        def _operator_view(record: logging.LogRecord) -> str:
            # `exc_info` is a 3-tuple when the call carried it and a falsy
            # non-tuple otherwise; index it only once it is known to be a tuple,
            # or a mutation that turns exc_info off crashes this assertion
            # instead of failing it — a crash is a worse failure signal because
            # it reports the wrong cause.
            info = record.exc_info
            tail = str(info[1]) if isinstance(info, tuple) and len(info) > 1 else ""
            return record.getMessage() + "\n" + tail

        operator_text = "\n".join(_operator_view(record) for record in caplog.records)
        assert _CANARY in operator_text, (
            "the exception text must survive on the operator surface — curating "
            "the user column must not become curating every surface. Log records "
            f"seen: {[r.getMessage() for r in caplog.records]!r}"
        )


class TestFailCallSitesCloseTheClass:
    """Not the instance — the class. A single curated call site is one edit away
    from being joined by a second raw one, and the next raw one will be written
    by someone who never reads this file.
    """

    def test_no_fail_call_site_interpolates_exception_state(self):
        # ⛔ AST, not a regex over the source. A regex for `_fail(...)` matches
        # the PROSE too — `routers/portfolio.py` contains the sentence "_fail()
        # itself can raise if Supabase is down", and a DOTALL pattern anchored on
        # it swallows the following twenty lines and reports whatever it finds
        # there. Measured while writing this test: the regex form produced a
        # "finding" whose captured argument was three comment paragraphs. It
        # happened to be RED for the right reason on the mutation under test,
        # which is exactly how a check that reads as coverage gets kept.
        tree = ast.parse(inspect.getsource(portfolio_mod))
        calls = [
            node for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "_fail"
        ]

        # A COUNT, not a presence test: the failure mode this guards against is
        # the walk finding NOTHING (a rename, a re-shape, a helper moved behind
        # an attribute call) and reporting clean over a module full of raw
        # writes. If a legitimate new call site appears, update this integer and
        # say which site was added — do not relax it to `> 0`.
        assert len(calls) == 5, (
            f"expected exactly 5 _fail(...) call sites in routers/portfolio.py, "
            f"found {len(calls)}. If that is a legitimate change, update the "
            "integer here AND check the new site passes user copy, because this "
            "test is the only thing standing between a raw exception and the "
            "portfolio dashboard."
        )

        offenders: list[str] = []
        for call in calls:
            for arg in call.args:
                names = {
                    node.id for node in ast.walk(arg) if isinstance(node, ast.Name)
                }
                attrs = {
                    node.attr for node in ast.walk(arg) if isinstance(node, ast.Attribute)
                }
                if "exc" in names or "__name__" in attrs:
                    offenders.append(ast.unparse(arg))

        assert not offenders, (
            "a _fail() call site interpolates exception state into "
            "portfolio_analytics.computation_error, which the portfolio "
            f"dashboard renders verbatim to the account holder: {offenders!r}"
        )

    def test_the_curated_constant_says_what_happened_and_what_to_do(self):
        copy = portfolio_mod.PORTFOLIO_COMPUTE_FAILED_COPY
        # Shape contract from 162-UI-SPEC C-2: one sentence naming the problem,
        # one naming the next step. Pinned as structure, not as an exact string,
        # so wording can be improved without a test edit — but it cannot silently
        # degrade into a bare fragment or grow a `TypeName:` prefix.
        assert copy.count(".") >= 2, f"copy is not two sentences: {copy!r}"
        assert ":" not in copy, (
            f"copy carries a colon, the shape of a `TypeName: message` prefix: {copy!r}"
        )
        assert "error" not in copy.split(". ")[1].lower(), (
            f"the second sentence should name the next step, not the error: {copy!r}"
        )


class TestBrokerNavStampSentencesAreNotFragments:
    """IN-02 (162-REVIEW) — the strategy-side sibling of the class above.

    ``_dispose_broker_nav_error`` in ``services/job_worker.py`` is the shared
    terminal disposition for a structural ``NavReconstructionError``; its
    ``stamp_detail`` argument is the sentence that reaches
    ``strategy_analytics.computation_error`` and is rendered VERBATIM to the
    account holder.

    All four call sites kept the trailing space that used to separate the
    sentence from a ``+ scrubbed`` exception suffix. D-162-4 removed the suffix;
    the space stayed, so the user column shipped a fragment that was built to be
    concatenated with something no longer there.

    Structural, not four equality assertions, for the same reason the class
    above is: the defect is a leftover of concatenation, and a fifth call site
    copy-pasted from one of these four inherits both the space AND the temptation
    to interpolate. The gate covers both — a ``stamp_detail`` that is not a plain
    string literal is an interpolation (WR-01's class) at the same seam.
    """

    @staticmethod
    def _stamp_detail_args() -> list[tuple[int, ast.expr]]:
        from services import job_worker as job_worker_mod

        tree = ast.parse(inspect.getsource(job_worker_mod))
        found: list[tuple[int, ast.expr]] = []
        for node in ast.walk(tree):
            if not (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "_dispose_broker_nav_error"
            ):
                continue
            for kw in node.keywords:
                if kw.arg == "stamp_detail":
                    found.append((node.lineno, kw.value))
        return found

    def test_every_stamp_detail_is_a_plain_literal_with_no_dangling_whitespace(self):
        args = self._stamp_detail_args()

        # A COUNT, not a presence test — the failure mode this guards against is
        # the walk finding NOTHING (a rename, a helper moved behind an attribute
        # call) and reporting clean over four raw writes. If a legitimate new
        # call site appears, update this integer and say which seam was added.
        assert len(args) == 4, (
            f"expected exactly 4 _dispose_broker_nav_error(stamp_detail=...) call "
            f"sites in services/job_worker.py, found {len(args)}. If that is a "
            "legitimate change, update the integer here AND check the new site "
            "passes a whole user-facing sentence, because this test is the only "
            "thing standing between a copy-pasted fragment and the dashboard."
        )

        interpolated = [
            (lineno, ast.unparse(value))
            for lineno, value in args
            if not isinstance(value, ast.Constant) or not isinstance(value.value, str)
        ]
        assert not interpolated, (
            "a stamp_detail argument is not a plain string literal — an "
            "interpolated value at this seam puts developer-audience internals "
            "into the sentence the account holder reads (WR-01's class): "
            f"{interpolated!r}"
        )

        dangling = [
            (lineno, value.value)  # type: ignore[attr-defined]
            for lineno, value in args
            if value.value != value.value.strip()  # type: ignore[attr-defined]
        ]
        assert not dangling, (
            "a curated stamp sentence carries leading/trailing whitespace. It is "
            "the residue of a `+ scrubbed` suffix that D-162-4 removed, and it "
            "lands verbatim in strategy_analytics.computation_error: "
            f"{dangling!r}"
        )

"""Phase 164.6.7 round-1 review: the harm probe's own guards.

``scripts/probe_composite_claimtime.py`` writes to a database and prints the
verdict a runbook quotes. Each test below pins one way it could either reach a
database that is not the private lane or print a verdict that was not earned:

- the loopback guard reads what libpq will CONNECT to, not the URI netloc
  (WR-01 / SFH-04), and re-checks the connected peer;
- a branch is only classified once the handler wrote ``computation_error``
  (SFH-03), so an untouched row can never read as "protected";
- a cleanup error never replaces the arm's own failure (SFH-05);
- a run without ``--expect`` says ``unasserted``, never ``ok`` (SFH-06);
- a claimed job the probe did not seed fails every mode, and the probe refuses
  to claim while one is claimable (SFH-07 / IN-03);
- a post-fix LOUD arm does not count if a live re-read failed (SFH-08);
- the handler log cannot sit in a git work tree, and no traceback reaches
  stderr (SFH-09 / IN-04);
- the ``HARM-VERDICT:`` line is derived by the probe (IN-01);
- the bridge body carries every fragment the recomputed predicate hardcodes
  (IN-02).

No database is touched: every connection here is a fake.
"""

from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

import scripts.probe_composite_claimtime as probe

_LANE_DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
_MIGRATIONS = Path(__file__).resolve().parents[2] / "supabase" / "migrations"


@pytest.fixture(autouse=True)
def _hermetic_pg_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in ("PGHOST", "PGHOSTADDR", "PGSERVICE"):
        monkeypatch.delenv(var, raising=False)


# ---------------------------------------------------------------- WR-01 / SFH-04


class TestLoopbackGuardReadsWhatLibpqConnectsTo:
    def test_the_lane_dsn_is_accepted(self) -> None:
        # The GREEN half: without it every refusal below could be a guard that
        # refuses everything.
        probe._assert_loopback_dsn(_LANE_DSN, {})

    @pytest.mark.parametrize(
        "dsn",
        [
            _LANE_DSN + "?host=db.example.com",
            _LANE_DSN + "?hostaddr=203.0.113.9",
            _LANE_DSN + "?service=remote",
            "postgresql://postgres:postgres@127.0.0.1,db.example.com:54322/postgres",
            "postgresql:///postgres",
        ],
        ids=["query-host", "query-hostaddr", "query-service", "multi-host", "no-host"],
    )
    def test_a_netloc_that_libpq_overrides_is_refused(self, dsn: str) -> None:
        with pytest.raises(probe.ProbeError):
            probe._assert_loopback_dsn(dsn, {})

    @pytest.mark.parametrize(
        "environ",
        [
            {"PGHOSTADDR": "203.0.113.9"},
            {"PGSERVICE": "remote"},
            {"PGHOST": "db.example.com"},
        ],
        ids=["PGHOSTADDR", "PGSERVICE", "PGHOST"],
    )
    def test_an_environment_override_is_refused(self, environ: dict[str, str]) -> None:
        with pytest.raises(probe.ProbeError):
            probe._assert_loopback_dsn(_LANE_DSN, environ)

    def test_the_refusal_never_prints_the_dsn(self) -> None:
        with pytest.raises(probe.ProbeError) as exc:
            probe._assert_loopback_dsn(_LANE_DSN + "?hostaddr=203.0.113.9", {})
        assert "203.0.113.9" not in str(exc.value)
        assert "postgres:postgres" not in str(exc.value)

    def test_the_connected_peer_must_be_loopback(self) -> None:
        good = SimpleNamespace(info=SimpleNamespace(host="127.0.0.1", hostaddr="127.0.0.1"))
        probe._assert_connected_loopback(good)
        for host, hostaddr in (("127.0.0.1", "203.0.113.9"), ("db.example.com", "127.0.0.1")):
            bad = SimpleNamespace(info=SimpleNamespace(host=host, hostaddr=hostaddr))
            with pytest.raises(probe.ProbeError):
                probe._assert_connected_loopback(bad)


# ---------------------------------------------------------------------- SFH-03


class TestBranchNeedsTheHandlersOwnWrite:
    def test_an_untouched_row_is_not_error_only(self) -> None:
        # The seeded status with NO computation_error is a handler that wrote
        # nothing; reading it as "error_only" would pass the control arm vacuously.
        with pytest.raises(probe.ProbeError):
            probe._classify_branch(probe._SEEDED_STATUS, has_error=False)

    def test_both_branches_classify_once_the_error_is_written(self) -> None:
        assert probe._classify_branch(probe._SEEDED_STATUS, has_error=True) == "error_only"
        assert probe._classify_branch("failed", has_error=True) == "loud"


# ---------------------------------------------------------------------- SFH-05


class _RaisingCursor:
    def __enter__(self) -> _RaisingCursor:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def execute(self, *args: Any) -> None:
        raise RuntimeError("cleanup blew up")


class _RaisingConn:
    def cursor(self) -> _RaisingCursor:
        return _RaisingCursor()


class TestCleanupNeverMasksTheArmFailure:
    def test_the_arms_own_error_survives_a_failing_cleanup(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _body(*args: Any, **kwargs: Any) -> dict[str, Any]:
            raise probe.ProbeError("the claim did not return the probe's own job")

        monkeypatch.setattr(probe, "_run_arm_body", _body)
        with pytest.raises(probe.ProbeError, match="the claim did not return"):
            asyncio.run(
                probe._run_arm(
                    _RaisingConn(),
                    None,
                    None,
                    retracted=False,
                    warned_seed=True,
                    inflight="none",
                )
            )

    def test_a_cleanup_failure_after_a_clean_arm_is_a_named_stop(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _body(*args: Any, **kwargs: Any) -> dict[str, Any]:
            return {"ok": True}

        monkeypatch.setattr(probe, "_run_arm_body", _body)
        with pytest.raises(probe.ProbeError, match="cleanup failed for an arm"):
            asyncio.run(
                probe._run_arm(
                    _RaisingConn(),
                    None,
                    None,
                    retracted=False,
                    warned_seed=True,
                    inflight="none",
                )
            )


# ------------------------------------------------- SFH-06 / SFH-07 / SFH-08


def _reading(
    *,
    retracted: bool,
    branch: str,
    protected: bool,
    inflight: str = "none",
    foreign: int = 0,
) -> dict[str, Any]:
    return {
        "retracted": retracted,
        "inflight": inflight,
        "python_branch": branch,
        "sql_is_protected": protected,
        "layers_agree": (branch == "error_only") == protected,
        "bridge_agrees": "true" if inflight == "none" else "n/a",
        "foreign_rows_claimed": foreign,
    }


def _post_fix_readings(foreign: int = 0) -> list[tuple[str, dict[str, Any]]]:
    return [
        ("control", _reading(retracted=False, branch="error_only", protected=True)),
        ("retracted-warned", _reading(retracted=True, branch="loud", protected=False)),
        (
            "retracted-unwarned",
            _reading(retracted=True, branch="loud", protected=False, foreign=foreign),
        ),
        (
            "retracted-warned-inflight",
            _reading(retracted=True, branch="loud", protected=False, inflight="modelled"),
        ),
    ]


class TestJudge:
    def test_post_fix_readings_pass(self) -> None:
        # GREEN baseline: the refusals below are not a judge that fails everything.
        assert probe._judge("post-fix", _post_fix_readings()) == ("ok", 0)

    def test_no_expect_is_unasserted_not_ok(self) -> None:
        assert probe._judge(None, _post_fix_readings()) == ("unasserted", 0)

    @pytest.mark.parametrize("expect", [None, "pre-fix", "post-fix"])
    def test_a_foreign_claim_fails_every_mode(self, expect: str | None) -> None:
        assert probe._judge(expect, _post_fix_readings(foreign=1)) == ("FAIL", 1)

    def test_a_failed_live_reread_voids_a_post_fix_loud_reading(self) -> None:
        assert probe._judge("post-fix", _post_fix_readings(), reread_failures=1) == (
            "FAIL",
            1,
        )


class _CountCursor:
    def __init__(self, count: int) -> None:
        self._count = count

    def __enter__(self) -> _CountCursor:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def execute(self, *args: Any) -> None:
        return None

    def fetchone(self) -> tuple[Any, ...]:
        return (self._count,)


class _CountConn:
    def __init__(self, count: int) -> None:
        self._count = count

    def cursor(self) -> _CountCursor:
        return _CountCursor(self._count)


class TestClaimOnlyWhatTheProbeSeeded:
    def test_refuses_to_claim_while_a_foreign_job_is_claimable(self) -> None:
        with pytest.raises(probe.ProbeError, match="did not seed"):
            probe._assert_no_foreign_claimable(_CountConn(2), "own")
        probe._assert_no_foreign_claimable(_CountConn(0), "own")

    def test_claims_a_batch_of_one(self, monkeypatch: pytest.MonkeyPatch) -> None:
        seen: dict[str, Any] = {}

        class _Rpc:
            def __init__(self, params: dict[str, Any]) -> None:
                seen.update(params)

            def execute(self) -> SimpleNamespace:
                return SimpleNamespace(data=[{"id": "own", "claim_token": "t"}])

        supabase = SimpleNamespace(rpc=lambda _name, params: _Rpc(params))
        row, foreign = asyncio.run(probe._claim_own(supabase, _CountConn(0), "own"))
        assert (row["id"], foreign, seen["p_batch_size"]) == ("own", 0, 1)


class TestRereadFailureScan:
    def test_the_fragment_is_still_in_the_handler_source(self) -> None:
        # If the helper's line is reworded, the handler-log scan passes
        # vacuously; the probe refuses instead, and so does this test.
        probe._assert_reread_fragment_in_source(probe._JOB_WORKER_SOURCE)

    def test_a_reworded_source_is_refused(self, tmp_path: Path) -> None:
        src = tmp_path / "job_worker.py"
        src.write_text("logger.warning('something else')\n", encoding="utf-8")
        with pytest.raises(probe.ProbeError):
            probe._assert_reread_fragment_in_source(src)

    def test_the_scan_counts_failure_lines(self, tmp_path: Path) -> None:
        log = tmp_path / "handler.log"
        log.write_text(
            "INFO x ok\nWARNING x ledger-refresh: "
            f"{probe._REREAD_FAILURE_FRAGMENT} on compute_job\n",
            encoding="utf-8",
        )
        assert probe._count_reread_failures(log) == 1


# ------------------------------------------------------------ SFH-09 / IN-04


class TestHandlerLogStaysOutOfGit:
    def test_a_path_inside_the_repository_is_refused(self) -> None:
        with pytest.raises(probe.ProbeError):
            probe._resolve_handler_log(str(probe._REPO_ROOT / ".planning" / "h.log"))

    def test_a_path_inside_any_git_work_tree_is_refused(self, tmp_path: Path) -> None:
        (tmp_path / ".git").mkdir()
        with pytest.raises(probe.ProbeError):
            probe._resolve_handler_log(str(tmp_path / "sub" / "h.log"))

    def test_a_path_outside_git_is_accepted(self, tmp_path: Path) -> None:
        assert probe._resolve_handler_log(str(tmp_path / "h.log")) == (
            tmp_path / "h.log"
        ).resolve()

    def test_an_abort_before_the_handler_log_prints_no_traceback(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        async def _boom(args: Any) -> int:
            raise PermissionError("/somewhere/private/.stack-env")

        monkeypatch.setattr(probe, "_main_async", _boom)
        # As in a real run before the file handler exists: the root logger has
        # NO handler, so a logged traceback would fall to logging's last-resort
        # stderr handler. (pytest's own capture handlers are removed for this.)
        monkeypatch.setattr(logging.getLogger(), "handlers", [])
        code = probe.main(["--handler-log", "/nonexistent/h.log"])
        err = capsys.readouterr().err
        assert code == 2
        assert "HARM-PROBE error: PermissionError" in err
        assert "Traceback" not in err
        assert "/somewhere/private" not in err


# ---------------------------------------------------------------------- IN-01

_PRE_FIX_OUTPUT = "\n".join(
    [
        "HARM-PROBE verdict: arm=control retracted=false status_after_fail=complete_with_warnings "
        "warned_after_fail=true status_after_next_bridge=complete_with_warnings",
        "HARM-PROBE verdict: arm=retracted-warned retracted=true status_after_fail=failed "
        "warned_after_fail=true status_after_next_bridge=complete_with_warnings",
        "HARM-PROBE verdict: arm=retracted-unwarned retracted=true status_after_fail=failed "
        "warned_after_fail=false status_after_next_bridge=computing",
        "HARM-PROBE verdict: arm=retracted-warned-inflight retracted=true "
        "status_after_fail=complete_with_warnings warned_after_fail=true "
        "status_after_next_bridge=complete_with_warnings",
        "HARM-PROBE summary: expect=pre-fix arms=4 result=ok",
    ]
)


def _end_state(name: str, fail: str, warned: bool, nxt: str) -> tuple[str, dict[str, Any]]:
    return (
        name,
        {
            "retracted": name != "control",
            "status_after_fail": fail,
            "warned_after_fail": warned,
            "status_after_next_bridge": nxt,
        },
    )


class TestHarmVerdictIsProbeOutput:
    def test_the_verdict_names_exactly_the_arms_whose_end_state_moved(self) -> None:
        pre = probe._parse_verdict_lines(_PRE_FIX_OUTPUT)
        post = [
            _end_state("control", "complete_with_warnings", True, "complete_with_warnings"),
            _end_state("retracted-warned", "failed", False, "computing"),
            _end_state("retracted-unwarned", "failed", False, "computing"),
            _end_state("retracted-warned-inflight", "computing", False, "computing"),
        ]
        lines = probe._harm_lines(pre, post)
        assert [ln for ln in lines if ln.startswith("HARM-SIZE:")] == [
            "HARM-SIZE: arm=retracted-warned pre=failed/true->complete_with_warnings "
            "post=failed/false->computing differs=true",
            "HARM-SIZE: arm=retracted-unwarned pre=failed/false->computing "
            "post=failed/false->computing differs=false",
            "HARM-SIZE: arm=retracted-warned-inflight "
            "pre=complete_with_warnings/true->complete_with_warnings "
            "post=computing/false->computing differs=true",
        ]
        assert lines[-1] == (
            "HARM-VERDICT: end-state harm shown on the lane for retracted-warned, "
            "retracted-warned-inflight; scoped to the lane, production cohort unmeasured"
        )

    def test_an_unjudged_pre_fix_run_is_refused(self) -> None:
        unjudged = _PRE_FIX_OUTPUT.replace("result=ok", "result=unasserted")
        with pytest.raises(probe.ProbeError):
            probe._parse_verdict_lines(unjudged)

    def test_an_unexpected_token_is_never_echoed(self) -> None:
        tampered = _PRE_FIX_OUTPUT.replace(
            "status_after_fail=failed warned_after_fail=false",
            "status_after_fail=/private/path warned_after_fail=false",
        )
        with pytest.raises(probe.ProbeError):
            probe._parse_verdict_lines(tampered)


# ---------------------------------------------------------------------- IN-02


_DEFINES_BRIDGE = re.compile(
    r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(public\.)?sync_strategy_analytics_status\s*\(",
    re.IGNORECASE,
)


def _latest_bridge_body() -> str:
    """The newest migration that (re)defines the bridge, so this test follows a
    future re-base instead of pinning a superseded body."""
    defining = [
        p
        for p in sorted(_MIGRATIONS.glob("*.sql"))
        if _DEFINES_BRIDGE.search(p.read_text(encoding="utf-8"))
    ]
    assert defining, "no migration defines public.sync_strategy_analytics_status"
    return defining[-1].read_text(encoding="utf-8")


class _BodyConn:
    def __init__(self, body: str) -> None:
        self._body = body

    def cursor(self) -> _BodyCursor:
        return _BodyCursor(self._body)


class _BodyCursor:
    def __init__(self, body: str) -> None:
        self._body = body

    def __enter__(self) -> _BodyCursor:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def execute(self, *args: Any) -> None:
        return None

    def fetchone(self) -> tuple[str]:
        return (self._body,)


class TestBridgeFidelityPinsEveryHardcodedFragment:
    def test_the_latest_bridge_body_carries_every_fragment(self) -> None:
        probe._assert_bridge_definition(_BodyConn(_latest_bridge_body()))

    @pytest.mark.parametrize(
        ("label", "old", "new"),
        [
            # Each drift touches ONE part of the predicate, and the refusal must
            # name that part.
            ("the marker IN-list", "'ledger-refresh-composite')", "'ledger-refresh-x')"),
            ("the kind IN-list", "'compute_analytics_from_csv',", "'compute_x',"),
            (
                "the COALESCE-to-FALSE protected expression",
                ", FALSE ) AND v_publish_healthy AS is_protected",
                ", TRUE ) AND v_publish_healthy AS is_protected",
            ),
            (
                "the healthy-status pair",
                "sa.computation_status IN ('complete', 'complete_with_warnings')",
                "sa.computation_status IN ('complete')",
            ),
        ],
    )
    def test_a_body_drifted_in_one_part_is_refused(
        self, label: str, old: str, new: str
    ) -> None:
        body = " ".join(_latest_bridge_body().split())
        drifted = body.replace(old, new)
        assert drifted != body
        with pytest.raises(probe.ProbeError, match=label):
            probe._assert_bridge_definition(_BodyConn(drifted))

    def test_the_kind_triple_and_status_pair_are_pinned(self) -> None:
        # IN-02: the recomputed predicate hardcodes FOUR things; each must be
        # pinned against the lane's body, not just the alias and the marker list.
        fragments = " ".join(f for _, f in probe._BRIDGE_FRAGMENTS)
        assert probe._BRIDGE_KIND_IN_LIST in fragments
        assert probe._BRIDGE_HEALTHY_IN_LIST in fragments
        assert probe._BRIDGE_MARKER_IN_LIST in fragments
        assert "AS is_protected" in fragments

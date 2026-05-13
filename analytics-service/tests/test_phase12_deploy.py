"""Tests for analytics-service/scripts/phase12_deploy.py.

P2022 (SQL probe keyed parse + NaN/inf/negative reject):
    Mirrors the test surface of test_phase12_kill_switch.py — the deploy
    orchestrator runs the SAME analyze_metrics_size.sql once and forwards
    p999/count to the kill-switch via CLI args. The parsing has the same
    failure modes and must be just as strict.

P2025 (backfill enqueue per-row exception capture):
    `phase12_deploy.main`'s step-4 branch must surface a non-zero RC from
    the backfill enqueuer as an INCOMPLETE marker rather than silently
    declaring the deploy complete.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from scripts import phase12_deploy as dep


# --- P2022: probe value parser ---------------------------------------------


class TestParseProbeValue:
    @pytest.mark.parametrize("bad", ["nan", "NaN", "inf", "-inf", "Infinity"])
    def test_nonfinite_rejected(self, bad: str) -> None:
        with pytest.raises(ValueError):
            dep._parse_probe_value(bad)

    @pytest.mark.parametrize("neg", ["-1", "-0.0001", "-9999999"])
    def test_negative_rejected(self, neg: str) -> None:
        with pytest.raises(ValueError):
            dep._parse_probe_value(neg)

    def test_empty_rejected(self) -> None:
        with pytest.raises(ValueError):
            dep._parse_probe_value("")

    def test_valid_accepted(self) -> None:
        assert dep._parse_probe_value("123.4") == 123.4


# --- P2022: _run_sql_probe parse safety ------------------------------------


class TestRunSqlProbe:
    def _stub_psql(self, monkeypatch, stdout: str, returncode: int = 0, stderr: str = "") -> None:
        monkeypatch.setenv("DATABASE_URL", "postgresql://stub/x")
        result = MagicMock(returncode=returncode, stdout=stdout, stderr=stderr)
        monkeypatch.setattr("scripts.phase12_deploy.subprocess.run", lambda *a, **kw: result)

    def test_keyed_parse_happy_path(self, monkeypatch) -> None:
        self._stub_psql(
            monkeypatch,
            "p50,1\np95,2\np99,3\np999,456789\nmax,5\ncount,42\n",
        )
        p999, n = dep._run_sql_probe()
        assert p999 == 456789.0
        assert n == 42

    def test_missing_p999_raises(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "p50,1\ncount,1\n")
        with pytest.raises(RuntimeError, match="p999"):
            dep._run_sql_probe()

    def test_missing_count_raises(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "p999,1\n")
        with pytest.raises(RuntimeError, match="count"):
            dep._run_sql_probe()

    def test_nan_rejected(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "p999,nan\ncount,42\n")
        with pytest.raises(ValueError):
            dep._run_sql_probe()

    def test_inf_rejected(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "p999,inf\ncount,42\n")
        with pytest.raises(ValueError):
            dep._run_sql_probe()

    def test_negative_rejected(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "p999,-1\ncount,42\n")
        with pytest.raises(ValueError):
            dep._run_sql_probe()

    def test_psql_uses_dbname_flag(self, monkeypatch) -> None:
        """P2022: explicit --dbname is used rather than positional dbname."""
        monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
        captured: dict[str, list[str]] = {}

        def fake_run(args, **kw):  # type: ignore[no-untyped-def]
            captured["args"] = args
            return MagicMock(returncode=0, stdout="p999,1\ncount,1\n", stderr="")

        monkeypatch.setattr("scripts.phase12_deploy.subprocess.run", fake_run)
        dep._run_sql_probe()
        assert "--dbname" in captured["args"]
        # --dbname comes immediately before the URL value.
        idx = captured["args"].index("--dbname")
        assert captured["args"][idx + 1] == "postgresql://x/y"


# --- P2025: backfill failure → INCOMPLETE deploy --------------------------


class TestDeployIncompleteOnBackfillFail:
    """If phase12_backfill_enqueue.main returns non-zero, the deploy must
    print the INCOMPLETE marker rather than the 'complete' tail."""

    @pytest.mark.asyncio
    async def test_backfill_failure_prints_incomplete(self, monkeypatch, capsys) -> None:
        # Stub the M-01 file plumbing so the test focuses on flow control.
        monkeypatch.setattr(dep, "_read_trade_mix_flag_from_todos", lambda: "false")
        monkeypatch.setattr(dep, "_write_env_test", lambda flag: None)
        monkeypatch.setattr(dep, "_run_sql_probe", lambda: (100.0, 0))
        # Kill-switch path is OK (returns 0).
        with patch(
            "scripts.phase12_deploy.phase12_kill_switch.main",
            new=AsyncMock(return_value=0),
        ):
            # Backfill returns 1 — emulating P2025 per-row failure rollup.
            with patch(
                "scripts.phase12_deploy.phase12_backfill_enqueue.main",
                new=AsyncMock(return_value=1),
            ):
                rc = await dep.main()
        captured = capsys.readouterr()
        assert rc != 0
        assert "INCOMPLETE" in captured.out
        # Must NOT claim the deploy is complete when backfill failed.
        assert "Phase 12 deploy: complete ===" not in captured.out

    @pytest.mark.asyncio
    async def test_backfill_success_prints_complete(self, monkeypatch, capsys) -> None:
        monkeypatch.setattr(dep, "_read_trade_mix_flag_from_todos", lambda: "false")
        monkeypatch.setattr(dep, "_write_env_test", lambda flag: None)
        monkeypatch.setattr(dep, "_run_sql_probe", lambda: (100.0, 0))
        with patch(
            "scripts.phase12_deploy.phase12_kill_switch.main",
            new=AsyncMock(return_value=0),
        ):
            with patch(
                "scripts.phase12_deploy.phase12_backfill_enqueue.main",
                new=AsyncMock(return_value=0),
            ):
                rc = await dep.main()
        captured = capsys.readouterr()
        assert rc == 0
        assert "Phase 12 deploy: complete" in captured.out

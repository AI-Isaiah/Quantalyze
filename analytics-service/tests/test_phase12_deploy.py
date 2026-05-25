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

import os
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

    @pytest.mark.parametrize("neg_zero", ["-0", "-0.0"])
    def test_negative_zero_normalized(self, neg_zero: str) -> None:
        """float("-0") returns -0.0; normalize to +0.0 so the
        negative-rejected guarantee holds strictly (no sign-bit leak)."""
        import math
        val = dep._parse_probe_value(neg_zero)
        assert val == 0.0
        assert math.copysign(1.0, val) > 0


# --- M-01: TRADE_MIX_HAS_MAKER_TAKER must be explicit ----------------------


class TestTradeMixFlagFailsLoud:
    """The TRADE_MIX_HAS_MAKER_TAKER audit decision governs which Trade Mix
    bucketing path CI exercises. A silent "false" default would let a
    misconfigured deploy run parity tests against the 2-bucket path even
    when the strategy has maker/taker data — operator must supply the
    decision explicitly (Rule 12)."""

    def test_missing_todos_file_raises(self, monkeypatch, tmp_path) -> None:
        monkeypatch.setattr(dep, "TODOS_PATH", tmp_path / "nonexistent.md")
        with pytest.raises(SystemExit, match="TODOS.md not found"):
            dep._read_trade_mix_flag_from_todos()

    def test_missing_flag_line_raises(self, monkeypatch, tmp_path) -> None:
        todos = tmp_path / "TODOS.md"
        todos.write_text("# unrelated content\n")
        monkeypatch.setattr(dep, "TODOS_PATH", todos)
        with pytest.raises(SystemExit, match="TRADE_MIX_HAS_MAKER_TAKER line missing"):
            dep._read_trade_mix_flag_from_todos()

    @pytest.mark.parametrize("value", ["true", "false"])
    def test_present_flag_returned_verbatim(self, monkeypatch, tmp_path, value: str) -> None:
        todos = tmp_path / "TODOS.md"
        todos.write_text(f"TRADE_MIX_HAS_MAKER_TAKER = {value}\n")
        monkeypatch.setattr(dep, "TODOS_PATH", todos)
        assert dep._read_trade_mix_flag_from_todos() == value


# --- P2022: _run_sql_probe parse safety ------------------------------------


class TestRunSqlProbe:
    def _stub_psql(self, monkeypatch, stdout: str, returncode: int = 0, stderr: str = "") -> None:
        monkeypatch.setenv("DATABASE_URL", "postgresql://stub/x")
        result = MagicMock(returncode=returncode, stdout=stdout, stderr=stderr)
        monkeypatch.setattr("scripts.phase12_deploy.subprocess.run", lambda *a, **kw: result)

    def test_keyed_parse_happy_path(self, monkeypatch) -> None:
        self._stub_psql(
            monkeypatch,
            "relation_visible,t\nrow_security_active,f\np50,1\np95,2\np99,3\np999,456789\nmax,5\ncount,42\ntotal_rows,42\n",
        )
        p999, n = dep._run_sql_probe()
        assert p999 == 456789.0
        assert n == 42

    def test_missing_p999_raises(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "relation_visible,t\nrow_security_active,f\np50,1\ncount,1\ntotal_rows,1\n")
        with pytest.raises(RuntimeError, match="p999"):
            dep._run_sql_probe()

    def test_missing_count_raises(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "relation_visible,t\nrow_security_active,f\np999,1\ntotal_rows,1\n")
        with pytest.raises(RuntimeError, match="count"):
            dep._run_sql_probe()

    def test_missing_total_rows_raises(self, monkeypatch) -> None:
        """total_rows is required for the H4 NULL-metrics-only diagnostic."""
        self._stub_psql(monkeypatch, "relation_visible,t\nrow_security_active,f\np999,1\ncount,1\n")
        with pytest.raises(RuntimeError, match="total_rows"):
            dep._run_sql_probe()

    def test_nan_rejected(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "relation_visible,t\nrow_security_active,f\np999,nan\ncount,42\ntotal_rows,42\n")
        with pytest.raises(ValueError):
            dep._run_sql_probe()

    def test_inf_rejected(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "relation_visible,t\nrow_security_active,f\np999,inf\ncount,42\ntotal_rows,42\n")
        with pytest.raises(ValueError):
            dep._run_sql_probe()

    def test_negative_rejected(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "relation_visible,t\nrow_security_active,f\np999,-1\ncount,42\ntotal_rows,42\n")
        with pytest.raises(ValueError):
            dep._run_sql_probe()

    def test_empty_table_raises_wrong_db_diagnostic(self, monkeypatch) -> None:
        """count=0 AND total_rows=0 → wrong-DB diagnostic."""
        self._stub_psql(monkeypatch, "relation_visible,t\nrow_security_active,f\np999,\ncount,0\ntotal_rows,0\n")
        with pytest.raises(RuntimeError, match="empty.*0 rows"):
            dep._run_sql_probe()

    def test_null_metrics_only_raises_distinct_diagnostic(self, monkeypatch) -> None:
        """H4: total_rows>0 AND count=0 → table populated but no metrics
        yet. Must NOT misdiagnose as "wrong DB"."""
        self._stub_psql(monkeypatch, "relation_visible,t\nrow_security_active,f\np999,\ncount,0\ntotal_rows,17\n")
        with pytest.raises(RuntimeError, match="17 rows.*all metrics_json values are NULL"):
            dep._run_sql_probe()

    @pytest.mark.parametrize("visible_val", ["f", "false"])
    def test_relation_not_visible_raises_distinct_diagnostic(
        self, monkeypatch, visible_val: str
    ) -> None:
        """#5: if the table is missing OR the role lacks SELECT, count and
        total_rows both look like 0. Distinguish from "empty table" so the
        operator chases GRANTs / role config, not DATABASE_URL."""
        self._stub_psql(
            monkeypatch,
            f"relation_visible,{visible_val}\nrow_security_active,f\np999,\ncount,0\ntotal_rows,0\n",
        )
        with pytest.raises(RuntimeError, match="not visible to the connecting role"):
            dep._run_sql_probe()

    def test_psql_timeout_raises_loud_diagnostic(self, monkeypatch) -> None:
        """H1: hung psql must fail loud, not park the deploy indefinitely."""
        import subprocess as sp
        monkeypatch.setenv("DATABASE_URL", "postgresql://stub/x")

        def raises_timeout(*args, **kwargs):  # type: ignore[no-untyped-def]
            raise sp.TimeoutExpired(cmd=args[0], timeout=kwargs.get("timeout", 60))

        monkeypatch.setattr("scripts.phase12_deploy.subprocess.run", raises_timeout)
        with pytest.raises(RuntimeError, match="timed out"):
            dep._run_sql_probe()

    def test_psql_uses_dbname_flag(self, monkeypatch) -> None:
        """Explicit --dbname is used rather than positional dbname."""
        monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
        captured: dict[str, list[str]] = {}

        def fake_run(args, **kw):  # type: ignore[no-untyped-def]
            captured["args"] = args
            captured["kwargs"] = kw
            return MagicMock(
                returncode=0,
                stdout="relation_visible,t\nrow_security_active,f\np999,1\ncount,1\ntotal_rows,1\n",
                stderr="",
            )

        monkeypatch.setattr("scripts.phase12_deploy.subprocess.run", fake_run)
        dep._run_sql_probe()
        assert "--dbname" in captured["args"]
        idx = captured["args"].index("--dbname")
        assert captured["args"][idx + 1] == "postgresql://x/y"
        # H1: timeout kwarg must be forwarded to subprocess.run.
        assert isinstance(captured["kwargs"].get("timeout"), int)
        assert captured["kwargs"]["timeout"] > 0


# --- P2025: backfill failure → INCOMPLETE deploy --------------------------


class TestDeployIncompleteOnBackfillFail:
    """If phase12_backfill_enqueue.main returns non-zero, the deploy must
    print the INCOMPLETE marker rather than the 'complete' tail."""

    @pytest.mark.asyncio
    async def test_backfill_failure_prints_incomplete(self, monkeypatch, capsys) -> None:
        # Stub the M-01 file plumbing so the test focuses on flow control.
        monkeypatch.setattr(dep, "_read_trade_mix_flag_from_todos", lambda: "false")
        monkeypatch.setattr(dep, "_write_env_test", lambda flag: None)
        monkeypatch.setattr(dep, "_run_sql_probe", lambda: (100.0, 1))
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
        monkeypatch.setattr(dep, "_run_sql_probe", lambda: (100.0, 1))
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


# --- H-0604: cross-step abort contract for .env.test + os.environ ----------


class TestDeployAbortStepWriteContract:
    """H-0604: Step 1 writes .env.test AND mutates os.environ
    TRADE_MIX_HAS_MAKER_TAKER BEFORE Step 2's SQL probe runs. If the probe
    fails (or the kill-switch returns non-zero), main() returns early — the
    orchestrator is NOT atomic across steps. These tests make that contract
    EXPLICIT (the finding noted it was unresolved):

      * The value written to .env.test is ALWAYS the audited TODOS.md flag,
        never a stale/wrong value — so even though Step 1's write is not rolled
        back on a later-step abort, CI never sources a WRONG flag (the write
        only ever reflects the audited source-of-truth).
      * Steps 3 (kill-switch) and 4 (backfill) are NOT reached on a probe abort.

    If a future change makes .env.test contain something OTHER than the audited
    flag on abort, these tests fail — surfacing the "stale .env.test" bug class
    the finding flagged.
    """

    @pytest.mark.asyncio
    async def test_probe_failure_leaves_audited_flag_in_env_test(
        self, monkeypatch, tmp_path
    ) -> None:
        # Real TODOS.md with an explicit audited flag + real (empty) .env.test
        # target so we observe the ACTUAL _write_env_test side effect.
        todos = tmp_path / "TODOS.md"
        todos.write_text("TRADE_MIX_HAS_MAKER_TAKER = true\n")
        env_test = tmp_path / ".env.test"
        monkeypatch.setattr(dep, "TODOS_PATH", todos)
        monkeypatch.setattr(dep, "ENV_TEST_PATH", env_test)
        # Isolate the process env mutation from the rest of the suite.
        monkeypatch.delenv("TRADE_MIX_HAS_MAKER_TAKER", raising=False)

        # Step 2 probe FAILS.
        def _failing_probe():
            raise RuntimeError("DATABASE_URL unreachable")

        monkeypatch.setattr(dep, "_run_sql_probe", _failing_probe)

        # Spy on Steps 3 + 4 to prove they are NOT reached after the abort.
        ks = AsyncMock(return_value=0)
        bf = AsyncMock(return_value=0)
        with patch("scripts.phase12_deploy.phase12_kill_switch.main", new=ks):
            with patch(
                "scripts.phase12_deploy.phase12_backfill_enqueue.main", new=bf
            ):
                rc = await dep.main()

        # Abort: returns 1.
        assert rc == 1
        # Step 1 already shipped .env.test — it is NOT rolled back (documents
        # the non-atomic contract).
        assert env_test.exists(), (
            ".env.test was not written — Step 1 ordering changed"
        )
        contents = env_test.read_text()
        # Crucially: the value is the AUDITED flag, never stale/wrong.
        assert "TRADE_MIX_HAS_MAKER_TAKER=true" in contents
        assert "TRADE_MIX_HAS_MAKER_TAKER=false" not in contents
        # os.environ mirrors the audited flag (Step 1 set it before the probe).
        assert os.environ.get("TRADE_MIX_HAS_MAKER_TAKER") == "true"
        # Downstream steps must NOT run after a probe abort.
        ks.assert_not_awaited()
        bf.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_kill_switch_nonzero_aborts_before_backfill(
        self, monkeypatch, tmp_path
    ) -> None:
        """The finding also calls out the kill-switch non-zero path (Step 3):
        backfill (Step 4) must be skipped, but .env.test has already shipped
        with the audited flag — same non-atomic-but-correct-value contract."""
        todos = tmp_path / "TODOS.md"
        todos.write_text("TRADE_MIX_HAS_MAKER_TAKER = false\n")
        env_test = tmp_path / ".env.test"
        monkeypatch.setattr(dep, "TODOS_PATH", todos)
        monkeypatch.setattr(dep, "ENV_TEST_PATH", env_test)
        monkeypatch.delenv("TRADE_MIX_HAS_MAKER_TAKER", raising=False)
        monkeypatch.setattr(dep, "_run_sql_probe", lambda: (100.0, 1))

        # Step 3 kill-switch returns non-zero → abort before Step 4.
        ks = AsyncMock(return_value=2)
        bf = AsyncMock(return_value=0)
        with patch("scripts.phase12_deploy.phase12_kill_switch.main", new=ks):
            with patch(
                "scripts.phase12_deploy.phase12_backfill_enqueue.main", new=bf
            ):
                rc = await dep.main()

        assert rc == 2  # kill-switch rc propagated
        assert env_test.read_text().strip().endswith("TRADE_MIX_HAS_MAKER_TAKER=false")
        assert os.environ.get("TRADE_MIX_HAS_MAKER_TAKER") == "false"
        ks.assert_awaited_once()
        # Backfill (Step 4) must NOT run after a non-zero kill-switch.
        bf.assert_not_awaited()

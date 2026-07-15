"""Tests for analytics-service/scripts/phase12_deploy.py.

P2022 (SQL probe keyed parse + NaN/inf/negative reject):
    Mirrors the test surface of test_phase12_kill_switch.py — the deploy
    orchestrator runs the SAME analyze_metrics_size.sql once and forwards
    p999/count to the kill-switch via CLI args. The parsing has the same
    failure modes and must be just as strict.
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

    def test_psql_failure_redacts_dsn_password_from_stderr(self, monkeypatch) -> None:
        """SECURITY (2026-05-27): on a non-zero psql exit, the RuntimeError
        must NOT carry an embedded DATABASE_URL password from psql's stderr.

        psql echoes the connection URI back in stderr on auth / SSL / parse
        failures, and this probe passes the DSN via `--dbname db_url`, so an
        unredacted stderr would leak the password into the deploy log. The
        raised message runs through phase12_kill_switch._redact_dsn (the same
        scrubber the kill-switch uses), so the password and the full DSN are
        replaced with the redaction placeholder."""
        leaky_stderr = (
            'psql: error: connection to server at "db.example.com" '
            "(1.2.3.4), port 5432 failed: FATAL:  password authentication "
            "failed for connection "
            "postgresql://postgres:HUNTER2SECRET@db.example.com:5432/quantalyze"
            "?sslmode=require"
        )
        self._stub_psql(monkeypatch, stdout="", returncode=2, stderr=leaky_stderr)
        with pytest.raises(RuntimeError) as exc_info:
            dep._run_sql_probe()
        msg = str(exc_info.value)
        # The password must NOT appear anywhere in the raised message.
        assert "HUNTER2SECRET" not in msg, (
            "DSN password leaked into the SQL-probe-failure RuntimeError; "
            "psql stderr must be run through _redact_dsn before raising."
        )
        # And the full postgresql:// DSN is replaced by the redaction marker.
        assert "postgresql://postgres:HUNTER2SECRET" not in msg
        assert "<postgres-dsn-redacted>" in msg

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

    def test_dsn_password_not_in_argv_travels_via_env(self, monkeypatch) -> None:
        """SECURITY F4 (red-team HIGH9): the DSN (with password) MUST NOT appear
        in psql's argv — argv is world-readable via `ps auxe` / /proc/<pid>/
        cmdline / CI logs. The connection params must travel via the
        subprocess `env=` dict (PG* libpq vars), mirroring the sibling
        phase12_kill_switch pattern.

        Pre-fix the probe ran `psql --dbname <full-DSN>`, leaking the password
        into argv verbatim."""
        monkeypatch.setenv(
            "DATABASE_URL",
            "postgresql://postgres:HUNTER2SECRET@db.example.com:5432/postgres?sslmode=require",
        )
        captured: dict[str, object] = {}

        def fake_run(args, **kw):  # type: ignore[no-untyped-def]
            captured["args"] = list(args)
            captured["kwargs"] = kw
            return MagicMock(
                returncode=0,
                stdout="relation_visible,t\nrow_security_active,f\np999,1\ncount,1\ntotal_rows,1\n",
                stderr="",
            )

        monkeypatch.setattr("scripts.phase12_deploy.subprocess.run", fake_run)
        dep._run_sql_probe()

        argv = captured["args"]
        # (a) The password — and the full DSN — must NOT appear anywhere in argv.
        argv_joined = " ".join(argv)  # type: ignore[arg-type]
        assert "HUNTER2SECRET" not in argv_joined, (
            "DSN password leaked into psql argv (visible via ps/proc/CI logs)"
        )
        assert not any(str(a).startswith("postgresql://") for a in argv), (
            "DSN must not be passed positionally / via --dbname in argv"
        )
        assert "--dbname" not in argv, "DSN must not ride in a --dbname argv arg"

        # (b) The connection params must travel via the subprocess env.
        env = captured["kwargs"].get("env")  # type: ignore[union-attr]
        assert isinstance(env, dict), "subprocess.run must be called with env="
        assert env.get("PGHOST") == "db.example.com"
        assert env.get("PGUSER") == "postgres"
        assert env.get("PGPASSWORD") == "HUNTER2SECRET"
        assert env.get("PGDATABASE") == "postgres"
        assert env.get("PGPORT") == "5432"
        # Stale libpq fallback-file env must be neutralized.
        assert env.get("PGPASSFILE") == ""
        assert env.get("PGSERVICEFILE") == ""

        # H1: timeout kwarg must still be forwarded to subprocess.run.
        assert isinstance(captured["kwargs"].get("timeout"), int)  # type: ignore[union-attr]
        assert captured["kwargs"]["timeout"] > 0  # type: ignore[index]

    def test_stale_pg_env_stripped_before_overlay(self, monkeypatch) -> None:
        """F4: a stale PGPASSWORD/PGUSER in the inherited env must NOT survive
        into the subprocess env (it could silently authenticate as a different
        role). Only the DSN-derived PG* values may reach psql."""
        monkeypatch.setenv(
            "DATABASE_URL", "postgresql://realuser:realpass@realhost:5432/realdb"
        )
        monkeypatch.setenv("PGPASSWORD", "STALE_INHERITED_PASS")
        monkeypatch.setenv("PGUSER", "stale_user")
        monkeypatch.setenv("PGSERVICE", "stale_service")
        captured: dict[str, object] = {}

        def fake_run(args, **kw):  # type: ignore[no-untyped-def]
            captured["kwargs"] = kw
            return MagicMock(
                returncode=0,
                stdout="relation_visible,t\nrow_security_active,f\np999,1\ncount,1\ntotal_rows,1\n",
                stderr="",
            )

        monkeypatch.setattr("scripts.phase12_deploy.subprocess.run", fake_run)
        dep._run_sql_probe()

        env = captured["kwargs"]["env"]  # type: ignore[index]
        assert env["PGPASSWORD"] == "realpass", "DSN password must win, not the stale env"
        assert env["PGUSER"] == "realuser"
        assert "PGSERVICE" not in env, "stale PGSERVICE must be stripped, not inherited"


# --- M-0639: DATABASE_URL scheme/host validation ---------------------------


class TestValidatePostgresUrl:
    """M-0639: the DSN handed to psql must be shape-checked first. A
    non-postgres scheme or a host-less value (bare project ref, http://
    paste) must be rejected with a clear error here rather than surfacing
    as an opaque libpq failure once psql is invoked. Mirrors the scheme/
    host contract of phase12_kill_switch._parse_postgres_url."""

    @pytest.mark.parametrize(
        "good",
        [
            "postgresql://u:p@h:5432/db",
            "postgres://u:p@h:5432/db",
            "postgresql://u:p@db.example.com:5432/postgres?sslmode=require",
            "postgresql://only-host",
        ],
    )
    def test_valid_postgres_url_passes_through_unchanged(self, good: str) -> None:
        # Valid URLs must be returned verbatim (no normalization) so the
        # value handed to psql is byte-identical to the operator's input.
        assert dep._validate_postgres_url(good) == good

    @pytest.mark.parametrize(
        "bad",
        ["not-a-url", "mysql://u:p@h/d", "http://h/d", "abcd1234projectref", ""],
    )
    def test_non_postgres_scheme_rejected(self, bad: str) -> None:
        with pytest.raises(ValueError, match="scheme|no host"):
            dep._validate_postgres_url(bad)

    def test_host_less_postgres_url_rejected(self) -> None:
        """A postgres scheme with no host (`postgresql:///dbonly`) is
        malformed — psql would otherwise fall back to a local socket and
        connect to the WRONG database silently."""
        with pytest.raises(ValueError, match="no host"):
            dep._validate_postgres_url("postgresql:///dbonly")

    def test_run_sql_probe_rejects_malformed_database_url(self, monkeypatch) -> None:
        """Integration: a malformed DATABASE_URL must abort _run_sql_probe
        with a clear ValueError before subprocess.run is ever called."""
        monkeypatch.setenv("DATABASE_URL", "not-a-url")
        called = {"ran": False}

        def fake_run(*a, **kw):  # type: ignore[no-untyped-def]
            called["ran"] = True
            return MagicMock(returncode=0, stdout="", stderr="")

        monkeypatch.setattr("scripts.phase12_deploy.subprocess.run", fake_run)
        with pytest.raises(ValueError, match="scheme"):
            dep._run_sql_probe()
        assert called["ran"] is False, "psql must NOT run on a malformed DSN"

    def test_run_sql_probe_accepts_valid_database_url(self, monkeypatch) -> None:
        """A valid postgres DSN must pass validation and reach subprocess.run."""
        monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h:5432/db")

        def fake_run(*a, **kw):  # type: ignore[no-untyped-def]
            return MagicMock(
                returncode=0,
                stdout="relation_visible,t\nrow_security_active,f\np999,1\ncount,1\ntotal_rows,1\n",
                stderr="",
            )

        monkeypatch.setattr("scripts.phase12_deploy.subprocess.run", fake_run)
        p999, n = dep._run_sql_probe()
        assert (p999, n) == (1.0, 1)


# --- M-0636: TRADE_MIX flag is a closed Literal -----------------------------


class TestTradeMixFlagLiteral:
    """M-0636: the reader returns the closed two-value enum, not an arbitrary
    string. Pin the reader's returned value so a future edit that admits
    "FALSE"/"0"/"yes" is caught."""

    @pytest.mark.parametrize("value", ["true", "false"])
    def test_reader_returns_literal_value(self, monkeypatch, tmp_path, value: str) -> None:
        todos = tmp_path / "TODOS.md"
        todos.write_text(f"TRADE_MIX_HAS_MAKER_TAKER = {value}\n")
        monkeypatch.setattr(dep, "TODOS_PATH", todos)
        result = dep._read_trade_mix_flag_from_todos()
        assert result == value
        assert result in ("true", "false")


# --- kill-switch success → complete deploy --------------------------------


class TestDeployCompleteOnKillSwitchSuccess:
    """When the kill-switch returns zero, the deploy prints the 'complete'
    tail (D4 106-08: the backfill enqueue step was retired — the kill-switch
    is now the last step)."""

    @pytest.mark.asyncio
    async def test_kill_switch_success_prints_complete(self, monkeypatch, capsys) -> None:
        monkeypatch.setattr(dep, "_read_trade_mix_flag_from_todos", lambda: "false")
        monkeypatch.setattr(dep, "_write_env_test", lambda flag: None)
        monkeypatch.setattr(dep, "_run_sql_probe", lambda: (100.0, 1))
        with patch(
            "scripts.phase12_deploy.phase12_kill_switch.main",
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
      * Step 3 (kill-switch) is NOT reached on a probe abort.

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

        # Spy on Step 3 to prove it is NOT reached after the abort.
        ks = AsyncMock(return_value=0)
        with patch("scripts.phase12_deploy.phase12_kill_switch.main", new=ks):
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
        # Downstream step must NOT run after a probe abort.
        ks.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_kill_switch_nonzero_propagates_rc(
        self, monkeypatch, tmp_path
    ) -> None:
        """The finding also calls out the kill-switch non-zero path (Step 3):
        its rc propagates, but .env.test has already shipped with the audited
        flag — same non-atomic-but-correct-value contract."""
        todos = tmp_path / "TODOS.md"
        todos.write_text("TRADE_MIX_HAS_MAKER_TAKER = false\n")
        env_test = tmp_path / ".env.test"
        monkeypatch.setattr(dep, "TODOS_PATH", todos)
        monkeypatch.setattr(dep, "ENV_TEST_PATH", env_test)
        monkeypatch.delenv("TRADE_MIX_HAS_MAKER_TAKER", raising=False)
        monkeypatch.setattr(dep, "_run_sql_probe", lambda: (100.0, 1))

        # Step 3 kill-switch returns non-zero → rc propagates.
        ks = AsyncMock(return_value=2)
        with patch("scripts.phase12_deploy.phase12_kill_switch.main", new=ks):
            rc = await dep.main()

        assert rc == 2  # kill-switch rc propagated
        assert env_test.read_text().strip().endswith("TRADE_MIX_HAS_MAKER_TAKER=false")
        assert os.environ.get("TRADE_MIX_HAS_MAKER_TAKER") == "false"
        ks.assert_awaited_once()

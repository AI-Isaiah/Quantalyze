"""Tests for analytics-service/scripts/phase12_kill_switch.py.

P2021 (opt-IN RUN_KILL_SWITCH + truthy parse):
    The original `SKIP_KILL_SWITCH=1` opt-OUT polarity is wrong — kill-switch
    fires by default, which is dangerous on partial deploys. We invert to
    opt-IN `RUN_KILL_SWITCH` and require a real truthy parse (not literal
    "1" equality, which silently misreads `=true` as "do not run").
    Unknown values fail loud (SystemExit) per CLAUDE.md Rule 12.

P2022 (SQL probe keyed parse + NaN/inf/negative reject):
    The probe SQL now emits key,value pairs (`p999,820000`) so a column
    re-order in the SQL cannot silently shift the parsed p999 to a
    different percentile. NaN/inf/negative values raise rather than
    poisoning the kill-switch decision.

P2024 (atomic cutover via migration 129 RPC):
    `cutover_strategy` no longer SELECTs metrics_json + projects sibling
    payload in Python — it delegates the entire read+strip to the new
    `cutover_strategy_metrics_keys_atomic(p_strategy_id)` Postgres
    function, which locks the row with SELECT ... FOR UPDATE inside the
    function body. Closes the race window vs concurrent analytics_runner
    writes.

audit-2026-05-07 specialist-fix round:
    * H-0606: bounded asyncio.gather replaces serial cutover loop.
    * H-0611/H-0616/C-0217: DSN parsed into PG* env vars, never argv.
    * H-0614: --force / PHASE12_FORCE_CUTOVER bypasses p999 < threshold
      short-circuit to recover from partial-cutover state.
    * H-0620: strategy_id is UUID-validated at the cutover boundary.
    * H-0622: TODOS audit is atomic (tempfile + os.replace).
    * H-0623: psql stderr is redacted of any embedded DSN before being
      propagated into RuntimeError.
    * H-0624: --confirm-prod / PHASE12_KILL_SWITCH_CONFIRMED required
      when DATABASE_URL points at a prod-looking host.
    * M-0637: TODOS path missing is non-fatal — stderr AUDIT line is
      the primary durable record.
"""
from __future__ import annotations

import asyncio
import uuid
from unittest.mock import MagicMock, patch

import pytest

from scripts import phase12_kill_switch as ks


# --- Test fixtures ---------------------------------------------------------

# Real UUIDs for the cutover tests (H-0620 — non-UUID strategy_ids are rejected
# at the boundary). These are deterministic uuid5() values so test failures
# point at a stable identifier.
TEST_STRATEGY_UUID = str(uuid.uuid5(uuid.NAMESPACE_OID, "phase12_kill_switch_test"))
TEST_STRATEGY_UUID_2 = str(uuid.uuid5(uuid.NAMESPACE_OID, "phase12_kill_switch_test_2"))


@pytest.fixture(autouse=True)
def _confirm_prod_gate(monkeypatch):
    """H-0624: pre-grant the prod-confirm gate for every test that runs
    main() with RUN_KILL_SWITCH=true. Individual tests that need to
    exercise the gate itself can monkeypatch.delenv() to reset it.

    A localhost DATABASE_URL would have the same effect, but several
    tests assert against `capsys.readouterr().out` and pre-setting an
    env var keeps test stdout free of an extra "DATABASE_URL ..." line."""
    monkeypatch.setenv("PHASE12_KILL_SWITCH_CONFIRMED", "true")


def _uuid_for(label: str) -> str:
    """Generate a deterministic UUID for a test label so audit-log
    assertions can match a stable strategy_id substring."""
    return str(uuid.uuid5(uuid.NAMESPACE_OID, label))


# --- P2021: RUN_KILL_SWITCH truthy parse -------------------------------------


class TestParseRunFlag:
    """The truthy parser is the security boundary — anything that looks like
    'yes' must opt in, anything that looks like 'no' must opt out, anything
    else must fail loud rather than silently default."""

    @pytest.mark.parametrize("value", ["true", "TRUE", "True", "yes", "YES", "1", "on", "ON"])
    def test_truthy_values_parse_to_true(self, value: str) -> None:
        assert ks._parse_run_flag(value) is True

    @pytest.mark.parametrize("value", ["false", "FALSE", "False", "no", "NO", "0", "off", "OFF", ""])
    def test_falsy_values_parse_to_false(self, value: str) -> None:
        assert ks._parse_run_flag(value) is False

    @pytest.mark.parametrize("value", ["maybe", "kinda", "2", "truee", "y", "n"])
    def test_unknown_values_raise_systemexit(self, value: str) -> None:
        """CLAUDE.md Rule 12: fail loud. A typo like RUN_KILL_SWITCH=ture must
        not silently fall through to "do nothing" or "run anyway"."""
        with pytest.raises(SystemExit):
            ks._parse_run_flag(value)

    @pytest.mark.parametrize("value", ["  true  ", "\ttrue\n", " yes", "false ", "\t0\t"])
    def test_whitespace_around_value_is_stripped(self, value: str) -> None:
        """Env files / heredocs commonly inject trailing whitespace. The
        parser strips outer whitespace before case-folding — pin this so a
        future refactor that drops .strip() turns CI into a SystemExit."""
        # Whether each value is truthy/falsy is set by the inner token; this
        # asserts only that no SystemExit is raised (i.e. the strip is wired).
        ks._parse_run_flag(value)

    @pytest.mark.parametrize("value", ["   ", "\t\t", ""])
    def test_whitespace_only_is_falsy(self, value: str) -> None:
        """Whitespace-only normalizes to "" which is in _FALSY — parse to False."""
        assert ks._parse_run_flag(value) is False


class TestMainRunFlagGate:
    """The env-var gate must default to BYPASS (opt-in semantics)."""

    @pytest.mark.asyncio
    async def test_unset_run_kill_switch_bypasses(self, monkeypatch, capsys) -> None:
        """Default behavior: nothing in the environment → skip the cutover.
        This is the polarity inversion from the old SKIP_KILL_SWITCH=1 opt-out."""
        monkeypatch.delenv("RUN_KILL_SWITCH", raising=False)
        monkeypatch.delenv("SKIP_KILL_SWITCH", raising=False)
        rc = await ks.main(cli_p999=900_000.0, cli_count=10)
        assert rc == 0
        captured = capsys.readouterr()
        assert "RUN_KILL_SWITCH" in captured.out
        assert "bypassing" in captured.out.lower()

    @pytest.mark.asyncio
    @pytest.mark.parametrize("falsy", ["false", "0", "no", "", "off"])
    async def test_falsy_run_kill_switch_bypasses(self, monkeypatch, falsy: str, capsys) -> None:
        monkeypatch.setenv("RUN_KILL_SWITCH", falsy)
        rc = await ks.main(cli_p999=900_000.0, cli_count=10)
        assert rc == 0
        captured = capsys.readouterr()
        assert "bypassing" in captured.out.lower()

    @pytest.mark.asyncio
    async def test_garbage_run_kill_switch_fails_loud(self, monkeypatch) -> None:
        """An unrecognized RUN_KILL_SWITCH value must abort with SystemExit,
        not default to either bypass or run."""
        monkeypatch.setenv("RUN_KILL_SWITCH", "maybe")
        with pytest.raises(SystemExit):
            await ks.main(cli_p999=900_000.0, cli_count=10)

    @pytest.mark.asyncio
    async def test_truthy_run_kill_switch_proceeds_below_threshold(self, monkeypatch, capsys) -> None:
        """Truthy gate + p999 below threshold → proceeds past the gate but
        exits early in the threshold check (no DB calls)."""
        monkeypatch.setenv("RUN_KILL_SWITCH", "true")
        # p999 below threshold short-circuits before any get_supabase() call.
        rc = await ks.main(cli_p999=100_000.0, cli_count=10)
        assert rc == 0
        captured = capsys.readouterr()
        assert "no cutover needed" in captured.out.lower()


# --- P2022: SQL probe parse safety ------------------------------------------


class TestParseProbeValue:
    """The probe parser must reject any non-finite or negative value before
    it can poison the kill-switch decision."""

    @pytest.mark.parametrize("bad", ["nan", "NaN", "NAN", "inf", "Infinity", "-inf", "-Infinity"])
    def test_nan_and_inf_rejected(self, bad: str) -> None:
        with pytest.raises(ValueError):
            ks._parse_probe_value(bad)

    @pytest.mark.parametrize("neg", ["-1", "-1.0", "-0.00001", "-9999999"])
    def test_negative_rejected(self, neg: str) -> None:
        with pytest.raises(ValueError):
            ks._parse_probe_value(neg)

    @pytest.mark.parametrize("good,expected", [("0", 0.0), ("0.0", 0.0), ("123456", 123456.0), ("800000.0", 800000.0)])
    def test_valid_nonneg_finite_accepted(self, good: str, expected: float) -> None:
        assert ks._parse_probe_value(good) == expected

    @pytest.mark.parametrize("neg_zero", ["-0", "-0.0", "-0.000"])
    def test_negative_zero_normalized_to_positive_zero(self, neg_zero: str) -> None:
        """Python's float("-0") returns -0.0, which compares equal to 0 but
        leaks a sign bit through to downstream math. Normalize to +0.0 so
        the "negative rejected" guarantee holds strictly."""
        val = ks._parse_probe_value(neg_zero)
        assert val == 0.0
        # math.copysign distinguishes +0.0 from -0.0 where == does not.
        import math
        assert math.copysign(1.0, val) > 0, f"expected +0.0, got -0.0 for {neg_zero!r}"


class TestNonnegFiniteInt:
    """argparse `--count` validator: plain non-negative integer or reject.
    No silent truncation, no scientific notation, no decimal forms."""

    @pytest.mark.parametrize("good,expected", [("0", 0), ("1", 1), ("42", 42), ("100", 100)])
    def test_plain_integer_accepted(self, good: str, expected: int) -> None:
        assert ks._nonneg_finite_int(good) == expected

    @pytest.mark.parametrize("bad", ["3.7", "0.5", "1.0001", "99.9", "100.0", "1.0"])
    def test_decimal_form_rejected(self, bad: str) -> None:
        """Even integer-valued decimals (`100.0`) are rejected — --count
        takes a plain integer; if the operator's mental model says "1.0"
        that's almost certainly a typo or shell-expansion artifact."""
        with pytest.raises(ValueError, match="plain non-negative integer"):
            ks._nonneg_finite_int(bad)

    @pytest.mark.parametrize("bad", ["1e2", "1E2", "1.5e1", "1e-3", "1e+2"])
    def test_scientific_notation_rejected(self, bad: str) -> None:
        """H2: --count 1e2 silently being 100 is the worst kind of trap —
        looks deliberate, almost certainly a typo. Refuse the ambiguity."""
        with pytest.raises(ValueError, match="plain non-negative integer"):
            ks._nonneg_finite_int(bad)

    @pytest.mark.parametrize("bad", ["-1", "nan", "inf", "+1", "0x10", " 1", "1 "])
    def test_other_forms_rejected(self, bad: str) -> None:
        with pytest.raises(ValueError):
            ks._nonneg_finite_int(bad)


class TestSqlProbeParsing:
    """measure_p999_via_sql now parses key,value rows. Missing keys, bad
    values, or unknown stdout shapes must all raise."""

    def _stub_psql(self, monkeypatch, stdout: str, returncode: int = 0, stderr: str = "") -> None:
        monkeypatch.setenv("DATABASE_URL", "postgresql://stub/x")
        result = MagicMock(returncode=returncode, stdout=stdout, stderr=stderr)
        monkeypatch.setattr("scripts.phase12_kill_switch.subprocess.run", lambda *a, **kw: result)

    def test_psql_timeout_raises_loud_diagnostic(self, monkeypatch) -> None:
        """H1: a hung pgbouncer / network partition / held FOR UPDATE must
        time out with a loud diagnostic instead of parking the deploy
        forever with no signal."""
        import subprocess as sp
        monkeypatch.setenv("DATABASE_URL", "postgresql://stub/x")

        def raises_timeout(*args, **kwargs):  # type: ignore[no-untyped-def]
            raise sp.TimeoutExpired(cmd=args[0], timeout=kwargs.get("timeout", 60))

        monkeypatch.setattr("scripts.phase12_kill_switch.subprocess.run", raises_timeout)
        with pytest.raises(RuntimeError, match="timed out"):
            ks.measure_p999_via_sql()

    def test_psql_timeout_passed_to_subprocess(self, monkeypatch) -> None:
        """The timeout kwarg must actually be forwarded to subprocess.run
        (otherwise nothing prevents the hang)."""
        monkeypatch.setenv("DATABASE_URL", "postgresql://stub/x")
        captured: dict[str, object] = {}

        def capture(*args, **kwargs):  # type: ignore[no-untyped-def]
            captured.update(kwargs)
            return MagicMock(returncode=0, stdout="relation_visible,t\nrow_security_active,f\np999,1\ncount,1\ntotal_rows,1\n", stderr="")

        monkeypatch.setattr("scripts.phase12_kill_switch.subprocess.run", capture)
        ks.measure_p999_via_sql()
        assert isinstance(captured.get("timeout"), int) and captured["timeout"] > 0

    def test_keyed_parse_happy_path(self, monkeypatch) -> None:
        self._stub_psql(
            monkeypatch,
            "relation_visible,t\nrow_security_active,f\np50,12345\np95,234567\np99,345678\np999,456789\nmax,567890\ncount,42\ntotal_rows,42\n",
        )
        p999, n = ks.measure_p999_via_sql()
        assert p999 == 456789.0
        assert n == 42

    def test_missing_p999_key_raises(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "relation_visible,t\nrow_security_active,f\np50,12345\ncount,42\ntotal_rows,42\n")
        with pytest.raises(RuntimeError, match="p999"):
            ks.measure_p999_via_sql()

    def test_missing_count_key_raises(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "relation_visible,t\nrow_security_active,f\np999,456789\ntotal_rows,42\n")
        with pytest.raises(RuntimeError, match="count"):
            ks.measure_p999_via_sql()

    def test_missing_total_rows_key_raises(self, monkeypatch) -> None:
        """total_rows is required for the H4 NULL-metrics-only diagnostic."""
        self._stub_psql(monkeypatch, "relation_visible,t\nrow_security_active,f\np999,456789\ncount,42\n")
        with pytest.raises(RuntimeError, match="total_rows"):
            ks.measure_p999_via_sql()

    def test_nan_p999_in_probe_raises(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "relation_visible,t\nrow_security_active,f\np999,nan\ncount,42\ntotal_rows,42\n")
        with pytest.raises(ValueError):
            ks.measure_p999_via_sql()

    def test_inf_p999_in_probe_raises(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "relation_visible,t\nrow_security_active,f\np999,inf\ncount,42\ntotal_rows,42\n")
        with pytest.raises(ValueError):
            ks.measure_p999_via_sql()

    def test_negative_count_raises(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "relation_visible,t\nrow_security_active,f\np999,500\ncount,-3\ntotal_rows,42\n")
        with pytest.raises(ValueError):
            ks.measure_p999_via_sql()

    def test_empty_table_raises_with_explicit_diagnostic(self, monkeypatch) -> None:
        """count=0 AND total_rows=0 → wrong-DB diagnostic."""
        self._stub_psql(monkeypatch, "relation_visible,t\nrow_security_active,f\np999,\ncount,0\ntotal_rows,0\n")
        with pytest.raises(RuntimeError, match="empty.*0 rows"):
            ks.measure_p999_via_sql()

    def test_null_metrics_only_raises_distinct_diagnostic(self, monkeypatch) -> None:
        """H4: total_rows>0 AND count=0 → table populated but no metrics
        yet. Must NOT misdiagnose as "wrong DB"."""
        self._stub_psql(monkeypatch, "relation_visible,t\nrow_security_active,f\np999,\ncount,0\ntotal_rows,17\n")
        with pytest.raises(RuntimeError, match="17 rows.*all metrics_json values are NULL"):
            ks.measure_p999_via_sql()

    @pytest.mark.parametrize("visible_val", ["f", "false", "FALSE", "F"])
    def test_relation_not_visible_raises_rls_grant_diagnostic(
        self, monkeypatch, visible_val: str
    ) -> None:
        """#5: if to_regclass returns NULL or SELECT is denied, count and
        total_rows both look like 0 — must distinguish from "empty table"
        so operator chases the right root cause."""
        self._stub_psql(
            monkeypatch,
            f"relation_visible,{visible_val}\nrow_security_active,f\np999,\ncount,0\ntotal_rows,0\n",
        )
        with pytest.raises(RuntimeError, match="not visible to the connecting role"):
            ks.measure_p999_via_sql()

    @pytest.mark.parametrize("rls_val", ["t", "true", "TRUE"])
    def test_rls_active_with_zero_rows_emits_distinct_diagnostic(
        self, monkeypatch, rls_val: str
    ) -> None:
        """Round-3 #2: has_table_privilege returns true regardless of RLS,
        so an RLS-filtered role looks identical to "empty table". The new
        row_security_active key must surface a different diagnostic so the
        operator chases GRANTs/BYPASSRLS, not DATABASE_URL."""
        self._stub_psql(
            monkeypatch,
            f"relation_visible,t\nrow_security_active,{rls_val}\np999,\ncount,0\ntotal_rows,0\n",
        )
        with pytest.raises(RuntimeError, match="RLS enabled.*BYPASSRLS"):
            ks.measure_p999_via_sql()

    def test_missing_row_security_active_key_raises(self, monkeypatch) -> None:
        """Drift guard: row_security_active is required."""
        self._stub_psql(
            monkeypatch,
            "relation_visible,t\np999,1\ncount,1\ntotal_rows,1\n",
        )
        with pytest.raises(RuntimeError, match="row_security_active"):
            ks.measure_p999_via_sql()

    def test_missing_relation_visible_key_raises(self, monkeypatch) -> None:
        """The visibility key is required — drift in the SQL must surface
        as a parse failure, not a silent fallthrough."""
        self._stub_psql(monkeypatch, "p999,1\ncount,1\ntotal_rows,1\n")
        with pytest.raises(RuntimeError, match="relation_visible"):
            ks.measure_p999_via_sql()

    def test_unknown_stdout_shape_raises(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "absolute,garbage,here,no,commas")
        with pytest.raises(RuntimeError):
            ks.measure_p999_via_sql()

    def test_psql_nonzero_exit_raises(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "", returncode=2, stderr="role not found")
        with pytest.raises(RuntimeError, match="role not found"):
            ks.measure_p999_via_sql()

    def test_no_database_url_raises(self, monkeypatch) -> None:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("SUPABASE_DB_URL", raising=False)
        with pytest.raises(RuntimeError, match="DATABASE_URL"):
            ks.measure_p999_via_sql()


# --- Lazy timeout resolution (round-2 red-team #1) --------------------------


class TestResolveProbeTimeout:
    """Timeout resolution must be lazy and validate the env var. A malformed
    PHASE12_PROBE_TIMEOUT_S must NOT crash at module import (the prior
    `int(os.getenv(...))` ran at import and broke unrelated callers); a
    value of 0 must NOT silently turn every probe into an instant
    TimeoutExpired."""

    def test_default_when_unset(self, monkeypatch) -> None:
        monkeypatch.delenv("PHASE12_PROBE_TIMEOUT_S", raising=False)
        assert ks._resolve_probe_timeout_s() == ks._DEFAULT_PROBE_TIMEOUT_S

    def test_empty_string_uses_default(self, monkeypatch) -> None:
        monkeypatch.setenv("PHASE12_PROBE_TIMEOUT_S", "")
        assert ks._resolve_probe_timeout_s() == ks._DEFAULT_PROBE_TIMEOUT_S

    def test_valid_positive_int(self, monkeypatch) -> None:
        monkeypatch.setenv("PHASE12_PROBE_TIMEOUT_S", "120")
        assert ks._resolve_probe_timeout_s() == 120

    @pytest.mark.parametrize("bad", ["foo", "1.5", "60s", "abc"])
    def test_non_integer_raises_loud(self, monkeypatch, bad: str) -> None:
        monkeypatch.setenv("PHASE12_PROBE_TIMEOUT_S", bad)
        with pytest.raises(RuntimeError, match="not an integer"):
            ks._resolve_probe_timeout_s()

    @pytest.mark.parametrize("bad", ["0", "-1", "-60"])
    def test_non_positive_raises_loud(self, monkeypatch, bad: str) -> None:
        """PHASE12_PROBE_TIMEOUT_S=0 would turn every probe into an instant
        TimeoutExpired and the operator would chase a phantom hung
        connection. Refuse non-positive values."""
        monkeypatch.setenv("PHASE12_PROBE_TIMEOUT_S", bad)
        with pytest.raises(RuntimeError, match="positive integer"):
            ks._resolve_probe_timeout_s()


# --- P2024: atomic cutover via RPC ------------------------------------------


class TestCutoverDelegatesToAtomicRpc:
    """The Python side must no longer SELECT metrics_json and project a
    sibling payload — that's a race against analytics_runner writes. The new
    RPC reads + strips inside SELECT ... FOR UPDATE."""

    @pytest.mark.asyncio
    async def test_cutover_calls_atomic_rpc_with_strategy_id_only(self) -> None:
        """The atomic RPC takes ONLY p_strategy_id; the function body
        reads metrics_json itself under FOR UPDATE. Python must not pass
        a client-side payload."""
        mock_supabase = MagicMock()
        mock_rpc_chain = MagicMock()
        mock_supabase.rpc.return_value = mock_rpc_chain
        mock_rpc_chain.execute.return_value = MagicMock(data={"moved": 7})

        with patch("scripts.phase12_kill_switch.get_supabase", return_value=mock_supabase):
            moved = await ks.cutover_strategy(TEST_STRATEGY_UUID)

        assert moved == 7
        mock_supabase.rpc.assert_called_once_with(
            "cutover_strategy_metrics_keys_atomic",
            {"p_strategy_id": TEST_STRATEGY_UUID},
        )

    @pytest.mark.asyncio
    async def test_cutover_no_longer_selects_metrics_json(self) -> None:
        """Regression guard: the old code path SELECTed strategy_analytics
        first. The atomic version must not touch .table('strategy_analytics')
        at all from Python — the RPC does the read under lock."""
        mock_supabase = MagicMock()
        mock_rpc_chain = MagicMock()
        mock_supabase.rpc.return_value = mock_rpc_chain
        mock_rpc_chain.execute.return_value = MagicMock(data={"moved": 0})

        with patch("scripts.phase12_kill_switch.get_supabase", return_value=mock_supabase):
            await ks.cutover_strategy(TEST_STRATEGY_UUID)

        mock_supabase.table.assert_not_called()

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "bad_payload",
        [None, [], [{"moved": 7}], {}, {"other": 1}, "moved"],
        ids=["none", "empty_list", "wrapped_list", "empty_dict", "wrong_key", "string"],
    )
    async def test_cutover_fails_loud_on_unexpected_shape(self, bad_payload) -> None:
        """Migration 129 returns jsonb_build_object('moved', N) — a scalar
        JSONB dict. Anything else (None, list, dict-without-'moved', etc.)
        indicates the migration was rolled back or the wire shape changed.
        The helper must raise, NOT silently return 0 (which would log
        "moved 0 keys" as if the cutover succeeded)."""
        mock_supabase = MagicMock()
        mock_rpc_chain = MagicMock()
        mock_supabase.rpc.return_value = mock_rpc_chain
        mock_rpc_chain.execute.return_value = MagicMock(data=bad_payload)

        with patch("scripts.phase12_kill_switch.get_supabase", return_value=mock_supabase):
            with pytest.raises(RuntimeError, match="unexpected shape"):
                await ks.cutover_strategy(TEST_STRATEGY_UUID)

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "bad_moved,desc",
        [
            (None, "moved=None"),
            (True, "moved=True (bool — int subclass that must be rejected)"),
            (False, "moved=False (bool — int subclass that must be rejected)"),
            ("3", "moved=str"),
            (3.0, "moved=float"),
        ],
    )
    async def test_cutover_fails_loud_on_non_int_moved(self, bad_moved, desc) -> None:
        """C1: shape check alone isn't enough — {'moved': None} would crash
        on int(None) with a confusing TypeError, and {'moved': True} would
        coerce to 1 silently (bool is a subclass of int in Python). The
        guard must reject both."""
        mock_supabase = MagicMock()
        mock_rpc_chain = MagicMock()
        mock_supabase.rpc.return_value = mock_rpc_chain
        mock_rpc_chain.execute.return_value = MagicMock(data={"moved": bad_moved})

        with patch("scripts.phase12_kill_switch.get_supabase", return_value=mock_supabase):
            with pytest.raises(RuntimeError, match="expected int"):
                await ks.cutover_strategy(TEST_STRATEGY_UUID)

    @pytest.mark.asyncio
    async def test_cutover_does_not_drop_runner_writes(self) -> None:
        """Structural test for the race-window fix.

        Old behavior: Python SELECTed metrics_json, built `sibling_payload`
        from the snapshot, then called an RPC with that payload. Between
        the SELECT and the RPC, analytics_runner could write a NEW
        metrics_json that the cutover snapshot wouldn't observe.

        New behavior: the entire read+strip happens in the function body
        under SELECT ... FOR UPDATE, so concurrent writers either block
        or commit on top of a post-strip state.

        We can't run real concurrency without a live DB. Instead we assert
        the API contract: cutover_strategy makes exactly ONE call into the
        supabase client (the RPC), and that call passes ONLY p_strategy_id.
        Any sibling-payload arg in the call would indicate a regression
        back to the race-prone path."""
        mock_supabase = MagicMock()
        mock_rpc_chain = MagicMock()
        mock_supabase.rpc.return_value = mock_rpc_chain
        mock_rpc_chain.execute.return_value = MagicMock(data={"moved": 3})

        runner_writes: list[str] = []

        async def fake_runner_write() -> None:
            await asyncio.sleep(0)
            runner_writes.append("after_cutover_read")

        with patch("scripts.phase12_kill_switch.get_supabase", return_value=mock_supabase):
            # Interleave a "runner write" with cutover. Python coroutines can
            # only see one ordering of awaits; the point is that cutover's
            # ONLY mutation call is the RPC, with strategy_id only.
            await asyncio.gather(ks.cutover_strategy(TEST_STRATEGY_UUID), fake_runner_write())

        # The cutover made exactly one RPC call, with no sibling payload.
        assert mock_supabase.rpc.call_count == 1
        rpc_args = mock_supabase.rpc.call_args.args
        assert rpc_args[0] == "cutover_strategy_metrics_keys_atomic"
        assert rpc_args[1] == {"p_strategy_id": TEST_STRATEGY_UUID}
        # Most importantly: no client-side metrics_json snapshot was passed in.
        assert "p_kinds" not in rpc_args[1]
        assert "metrics_json" not in rpc_args[1]

    # H-0620: strategy_id must be UUID-validated at the cutover boundary --

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "bad_sid",
        ["strat-abc", "not-a-uuid", "12345", "", "00000000-0000-0000-0000-00000000000Z"],
    )
    async def test_non_uuid_strategy_id_rejected(self, bad_sid: str) -> None:
        """H-0620: a non-UUID strategy_id must fail at the Python boundary
        rather than hitting the Postgres UUID parser. The RPC must never
        be called with a malformed identifier — guards against accidental
        injection of stringified row dicts or schema-rename artifacts."""
        mock_supabase = MagicMock()
        with patch("scripts.phase12_kill_switch.get_supabase", return_value=mock_supabase):
            with pytest.raises(ValueError, match=r"strategy_id|UUID"):
                await ks.cutover_strategy(bad_sid)
        # RPC must NOT be called when validation fails.
        mock_supabase.rpc.assert_not_called()

    @pytest.mark.asyncio
    async def test_non_string_strategy_id_rejected(self) -> None:
        """Type guard: a non-string sid (e.g. an int slipped through from
        a malformed row dict) must raise before reaching the UUID parser."""
        mock_supabase = MagicMock()
        with patch("scripts.phase12_kill_switch.get_supabase", return_value=mock_supabase):
            with pytest.raises(ValueError, match="non-empty string"):
                await ks.cutover_strategy(12345)  # type: ignore[arg-type]
        mock_supabase.rpc.assert_not_called()


# --- Argparse validator ------------------------------------------------------


class TestArgparseValidator:
    """--p999 and --count must reject NaN, inf, and negative values at
    parse time (before the threshold compare can be poisoned)."""

    @pytest.mark.parametrize("bad", ["nan", "inf", "-1", "-1.0"])
    def test_p999_rejects_bad(self, bad: str) -> None:
        with pytest.raises(ValueError):
            ks._nonneg_finite(bad)

    @pytest.mark.parametrize("good,expected", [("0", 0.0), ("123.4", 123.4), ("999999.9", 999999.9)])
    def test_p999_accepts_good(self, good: str, expected: float) -> None:
        assert ks._nonneg_finite(good) == expected


# --- Drift guard: HEAVY_KINDS lives server-side only ------------------------


def test_no_python_heavy_kinds_constant() -> None:
    """Drift guard: after P2024 the v_allowlist lives in migration 129's
    SQL function body alone. A Python HEAVY_KINDS list would invite the
    two to drift. This test fails the moment someone re-adds it."""
    assert not hasattr(ks, "HEAVY_KINDS"), (
        "P2024: HEAVY_KINDS must NOT be defined in Python — single "
        "source of truth lives in supabase/migrations/129_*.sql v_allowlist."
    )


# --- Cutover loop per-strategy try/except + audit log -----------------------


class TestCutoverLoopPartialFailure:
    """If one strategy's RPC raises mid-loop, the surviving rows must still
    enqueue, the audit log must still be written (the mutations that DID
    land must be recoverable), and main() must return non-zero."""

    @pytest.mark.asyncio
    async def test_per_strategy_failure_continues_logs_returns_nonzero(
        self, monkeypatch, capsys, tmp_path
    ) -> None:
        # Redirect the TODOS audit log to a temp file so we can assert on it.
        todos_path = tmp_path / "TODOS.md"
        todos_path.write_text("# existing content\n")
        monkeypatch.setattr(ks, "TODOS_PATH", todos_path)
        monkeypatch.setenv("RUN_KILL_SWITCH", "true")

        # Map deterministic test UUIDs to short labels for assertions.
        sids = [_uuid_for(f"partial-strat-{i}") for i in range(3)]
        fail_sid = sids[1]

        # Cutover succeeds for indexes 0 and 2, fails for index 1.
        async def fake_cutover(sid: str) -> int:
            if sid == fail_sid:
                raise RuntimeError("simulated mid-loop RPC failure")
            return 5
        monkeypatch.setattr(ks, "cutover_strategy", fake_cutover)

        mock_supabase = MagicMock()
        select_chain = MagicMock()
        select_chain.execute.return_value = MagicMock(
            data=[{"strategy_id": sid} for sid in sids],
        )
        mock_supabase.table.return_value.select.return_value = select_chain

        with patch("scripts.phase12_kill_switch.get_supabase", return_value=mock_supabase):
            rc = await ks.main(cli_p999=900_000.0, cli_count=3)

        captured = capsys.readouterr()
        # Mid-loop failure is surfaced.
        assert "simulated mid-loop RPC failure" in captured.out
        # Bounded gather may interleave; the surviving strategies must still
        # have their "moved 5 keys" lines, irrespective of order.
        assert f"{sids[0]}: moved 5 keys" in captured.out
        assert f"{sids[2]}: moved 5 keys" in captured.out
        # Status reflects partial completion.
        assert "PARTIAL" in captured.out
        assert "2/3" in captured.out  # 2 succeeded out of 3
        # Audit log was written even though the loop had a failure.
        log = todos_path.read_text()
        assert "Kill-switch triggered" in log
        assert "1 failed" in log
        # Non-zero exit code when any strategy fails.
        assert rc == 1

    @pytest.mark.asyncio
    async def test_noop_run_appends_marked_audit_entry(
        self, monkeypatch, capsys, tmp_path
    ) -> None:
        """Reverses an earlier H3 fix that silently swallowed legit
        triggers. Now: ALWAYS append an audit-log entry on a triggered
        run; mark no-op cases with "(no-op ...)" so duplicates are
        distinguishable. Three real cases hit this path:
          * operator forces --p999 above threshold but keys already stripped
          * v_allowlist regressed to empty (operator MUST see)
          * zero published strategies (still record the trigger fired)"""
        todos_path = tmp_path / "TODOS.md"
        todos_path.write_text("# existing\n")
        monkeypatch.setattr(ks, "TODOS_PATH", todos_path)
        monkeypatch.setenv("RUN_KILL_SWITCH", "true")

        sids = [_uuid_for(f"noop-strat-{i}") for i in range(3)]

        async def fake_cutover(sid: str) -> int:
            return 0  # already-stripped — RPC says nothing to move
        monkeypatch.setattr(ks, "cutover_strategy", fake_cutover)

        mock_supabase = MagicMock()
        select_chain = MagicMock()
        select_chain.execute.return_value = MagicMock(
            data=[{"strategy_id": sid} for sid in sids],
        )
        mock_supabase.table.return_value.select.return_value = select_chain

        with patch("scripts.phase12_kill_switch.get_supabase", return_value=mock_supabase):
            rc = await ks.main(cli_p999=900_000.0, cli_count=3)

        assert rc == 0
        log = todos_path.read_text()
        assert "Kill-switch triggered" in log, (
            "triggered run MUST always leave an audit-log entry, even when no-op"
        )
        assert "(no-op" in log, (
            "no-op runs must be marked so post-incident the audit trail "
            "distinguishes them from real triggers"
        )

    @pytest.mark.asyncio
    async def test_missing_todos_path_is_stderr_only_not_fatal(
        self, monkeypatch, tmp_path, capsys
    ) -> None:
        """M-0637: when TODOS_PATH and its parent dir do not exist (the
        normal case in a deployed container — `.planning/` is dev-tree
        only), the kill-switch trigger MUST NOT raise. The stderr AUDIT
        line is the durable record in that environment.

        Replaces the prior "raise on missing TODOS_PATH" test — that
        behavior made the script unusable in production, which is
        exactly where the trigger fires. Revised semantics: the absence
        is logged loudly to stderr; the cutover proceeds and returns
        the per-strategy success status."""
        # Use a path inside a nonexistent parent so neither TODOS_PATH
        # NOR TODOS_PATH.parent exists.
        missing_path = tmp_path / "does" / "not" / "exist" / "TODOS.md"
        monkeypatch.setattr(ks, "TODOS_PATH", missing_path)
        monkeypatch.setenv("RUN_KILL_SWITCH", "true")

        sid = _uuid_for("missing-todos-strat")

        async def fake_cutover(s: str) -> int:
            return 1
        monkeypatch.setattr(ks, "cutover_strategy", fake_cutover)

        mock_supabase = MagicMock()
        select_chain = MagicMock()
        select_chain.execute.return_value = MagicMock(
            data=[{"strategy_id": sid}],
        )
        mock_supabase.table.return_value.select.return_value = select_chain

        with patch("scripts.phase12_kill_switch.get_supabase", return_value=mock_supabase):
            rc = await ks.main(cli_p999=900_000.0, cli_count=1)

        # Cutover succeeded → rc == 0; missing TODOS path is non-fatal.
        assert rc == 0
        captured = capsys.readouterr()
        # Stderr AUDIT line must be present — it's the durable record.
        assert "AUDIT" in captured.err
        assert "Kill-switch triggered" in captured.err
        # Stderr also notes the path was unavailable.
        assert "not in tree" in captured.err

    @pytest.mark.asyncio
    async def test_malformed_rows_recorded_as_failures(
        self, monkeypatch, tmp_path, capsys
    ) -> None:
        """#4: a row missing 'strategy_id' must not raise KeyError mid-loop
        and skip the audit log. Capture as a failure; continue.

        Round-3 #1: the success-count math must use input_total (the
        denominator the operator reads) not len(strategy_ids). With 1
        valid + 2 malformed inputs, the prior code emitted "-1/1" (a
        negative success count). The audit log must show "1/3".
        """
        todos_path = tmp_path / "TODOS.md"
        todos_path.write_text("# existing\n")
        monkeypatch.setattr(ks, "TODOS_PATH", todos_path)
        monkeypatch.setenv("RUN_KILL_SWITCH", "true")

        valid_sid = _uuid_for("malformed-row-valid")

        async def fake_cutover(sid: str) -> int:
            return 2
        monkeypatch.setattr(ks, "cutover_strategy", fake_cutover)

        mock_supabase = MagicMock()
        select_chain = MagicMock()
        # Mixed rows: one valid, one missing strategy_id, one with empty string.
        select_chain.execute.return_value = MagicMock(
            data=[
                {"strategy_id": valid_sid},
                {"other_field": "no strategy_id key"},
                {"strategy_id": ""},
            ],
        )
        mock_supabase.table.return_value.select.return_value = select_chain

        with patch("scripts.phase12_kill_switch.get_supabase", return_value=mock_supabase):
            rc = await ks.main(cli_p999=900_000.0, cli_count=3)

        # 1 valid succeeded; 2 malformed counted as failures → partial.
        assert rc == 1
        log = todos_path.read_text()
        assert "Kill-switch triggered" in log
        assert "2 failed" in log
        # Audit-log math must not go negative when malformed > valid.
        assert "1/3" in log, f"expected '1/3' in audit log, got: {log!r}"
        # The success fraction itself must not be negative — guard against
        # the specific "moved K keys across -N/M" regression.
        assert "across -" not in log, (
            f"audit-log success fraction must not be negative: {log!r}"
        )
        captured = capsys.readouterr()
        assert "1/3" in captured.out
        assert "across -" not in captured.out

    @pytest.mark.asyncio
    async def test_strategy_select_none_data_raises(self, monkeypatch) -> None:
        """If the strategy_analytics select returns rows.data=None, the
        loop must NOT silently iterate over [] and log "moved 0 keys
        across 0 strategies" (Rule 12 — fail loud)."""
        monkeypatch.setenv("RUN_KILL_SWITCH", "true")

        mock_supabase = MagicMock()
        select_chain = MagicMock()
        select_chain.execute.return_value = MagicMock(data=None)
        mock_supabase.table.return_value.select.return_value = select_chain

        with patch("scripts.phase12_kill_switch.get_supabase", return_value=mock_supabase):
            with pytest.raises(RuntimeError, match="strategy_analytics select returned None"):
                await ks.main(cli_p999=900_000.0, cli_count=3)


# --- asyncio.to_thread wrapping of blocking subprocess ---------------------


class TestMeasureP999OffloadsSubprocess:
    """measure_p999() is async; the fallback path must offload the blocking
    psql subprocess to a worker thread so the event loop stays live for
    any concurrently-awaiting coroutine."""

    @pytest.mark.asyncio
    async def test_subprocess_runs_in_thread_executor(self, monkeypatch) -> None:
        import threading
        captured: dict[str, object] = {}

        def fake_via_sql() -> tuple[float, int]:
            captured["thread"] = threading.current_thread()
            return (123.0, 4)

        monkeypatch.setattr(ks, "measure_p999_via_sql", fake_via_sql)
        p999, n = await ks.measure_p999(cli_p999=None, cli_count=None)
        assert (p999, n) == (123.0, 4)
        # Identity check, not name comparison — name is brittle across
        # Python versions and pytest-asyncio loop configurations.
        assert captured["thread"] is not threading.main_thread(), (
            "measure_p999_via_sql must run on a worker thread, not the main thread"
        )


# --- H-0611 / H-0616 / C-0217: DSN never in argv ---------------------------


class TestDsnEnvNotArgv:
    """The DATABASE_URL must be parsed into PG* libpq env vars and passed via
    subprocess.run(env=...), NEVER as a positional or --dbname argv argument.
    argv is visible to every local user via `ps auxe`, /proc/<pid>/cmdline,
    Railway's process-exec logger, and CI build logs."""

    def test_dsn_not_in_argv(self, monkeypatch) -> None:
        """C-0217 root chain: the credential string MUST NOT appear in the
        argv list passed to subprocess.run."""
        secret_dsn = "postgresql://postgres:hunter2@db.host.supabase.co:5432/postgres?sslmode=require"
        monkeypatch.setenv("DATABASE_URL", secret_dsn)
        captured: dict[str, object] = {}

        def capture(cmd, **kwargs):  # type: ignore[no-untyped-def]
            captured["cmd"] = cmd
            captured["env"] = kwargs.get("env")
            return MagicMock(
                returncode=0,
                stdout="relation_visible,t\nrow_security_active,f\np999,1\ncount,1\ntotal_rows,1\n",
                stderr="",
            )

        monkeypatch.setattr("scripts.phase12_kill_switch.subprocess.run", capture)
        ks.measure_p999_via_sql()

        # The DSN must NOT appear in any argv slot — that's the credential
        # disclosure surface H-0611 / H-0616 / C-0217 close.
        argv = captured["cmd"]
        assert isinstance(argv, list)
        for slot in argv:
            assert "hunter2" not in slot, f"password leaked into argv: {slot!r}"
            assert "postgresql://" not in slot, f"DSN scheme leaked into argv: {slot!r}"
            assert "postgres://" not in slot, f"DSN scheme leaked into argv: {slot!r}"
        # --dbname / -d / --URI flags are forbidden — even when followed by
        # a separate-token DSN they end up visible in argv.
        assert "--dbname" not in argv
        assert "-d" not in argv
        assert "--URI" not in argv

    def test_dsn_parsed_into_pg_env_vars(self, monkeypatch) -> None:
        """The parsed PG* env vars must be passed via env= so libpq picks
        them up. Verifies password rides in PGPASSWORD (the channel that
        does NOT appear in /proc/<pid>/cmdline)."""
        secret_dsn = "postgresql://alice:hunter2@db.example.com:5433/quantalyze?sslmode=require"
        monkeypatch.setenv("DATABASE_URL", secret_dsn)
        captured: dict[str, object] = {}

        def capture(cmd, **kwargs):  # type: ignore[no-untyped-def]
            captured["env"] = kwargs.get("env")
            return MagicMock(
                returncode=0,
                stdout="relation_visible,t\nrow_security_active,f\np999,1\ncount,1\ntotal_rows,1\n",
                stderr="",
            )

        monkeypatch.setattr("scripts.phase12_kill_switch.subprocess.run", capture)
        ks.measure_p999_via_sql()

        env = captured["env"]
        assert isinstance(env, dict)
        assert env.get("PGHOST") == "db.example.com"
        assert env.get("PGPORT") == "5433"
        assert env.get("PGUSER") == "alice"
        assert env.get("PGPASSWORD") == "hunter2"
        assert env.get("PGDATABASE") == "quantalyze"
        assert env.get("PGSSLMODE") == "require"

    def test_dsn_parse_rejects_unknown_scheme(self) -> None:
        with pytest.raises(ValueError, match="unrecognized scheme"):
            ks._parse_postgres_url("mysql://u:p@h/d")

    def test_dsn_parse_rejects_no_host(self) -> None:
        with pytest.raises(ValueError, match="no host"):
            ks._parse_postgres_url("postgresql:///dbonly")

    def test_dsn_parse_postgres_scheme_alias(self) -> None:
        """`postgres://` is libpq's older but still-valid alias for
        `postgresql://`. Accept both."""
        env = ks._parse_postgres_url("postgres://u:p@h:5432/d")
        assert env["PGHOST"] == "h"
        assert env["PGUSER"] == "u"

    def test_dsn_parse_handles_minimal_url(self) -> None:
        """A minimal URL with only host should produce only PGHOST."""
        env = ks._parse_postgres_url("postgresql://only-host")
        assert env == {"PGHOST": "only-host"}

    def test_malformed_database_url_redacts_in_error(self, monkeypatch) -> None:
        """A malformed DSN must produce a RuntimeError whose message does
        NOT contain the raw DSN — operators sometimes paste production
        URLs into env vars with stray characters; the error path must
        not echo the password back at them."""
        monkeypatch.setenv("DATABASE_URL", "not-a-url://has:secret@host/db")
        with pytest.raises(RuntimeError) as exc_info:
            ks.measure_p999_via_sql()
        msg = str(exc_info.value)
        # The scheme prefix is not in the redaction regex (it's not a
        # postgresql scheme), but the redactor should still strip
        # anything that looks like a postgres:// DSN. The malformed input
        # here doesn't match the DSN regex, but the test also pins that
        # we don't propagate the entire bad URL verbatim.
        assert "secret" not in msg or "<postgres-dsn-redacted>" in msg


# --- H-0623: stderr redaction ----------------------------------------------


class TestStderrRedaction:
    """psql commonly echoes the connection URI in stderr on auth / SSL /
    parse failures. The raised RuntimeError must NEVER carry the DSN."""

    def test_redact_dsn_strips_full_url(self) -> None:
        msg = (
            "connection to server at "
            '"postgresql://postgres:HUNTER2@db.xxx.supabase.co:5432/postgres?sslmode=require" '
            "failed: FATAL: password authentication failed"
        )
        redacted = ks._redact_dsn(msg)
        assert "HUNTER2" not in redacted
        assert "postgresql://" not in redacted
        assert "<postgres-dsn-redacted>" in redacted
        # The non-secret context survives — operators still see WHY it failed.
        assert "password authentication failed" in redacted

    def test_redact_dsn_handles_postgres_scheme_alias(self) -> None:
        msg = "trying postgres://user:pw@h:5432/d ... bad host"
        redacted = ks._redact_dsn(msg)
        assert "pw" not in redacted
        assert "<postgres-dsn-redacted>" in redacted

    def test_redact_dsn_passes_through_when_no_dsn(self) -> None:
        """Generic psql errors without DSN echo must be left untouched —
        otherwise the operator loses the diagnostic context."""
        assert ks._redact_dsn("FATAL: role \"deploy\" does not exist") == (
            'FATAL: role "deploy" does not exist'
        )

    def test_psql_stderr_with_dsn_is_redacted_in_raised_error(self, monkeypatch) -> None:
        """Integration: a psql failure that echoes the DSN in stderr must
        produce a RuntimeError whose message has the DSN scrubbed."""
        monkeypatch.setenv("DATABASE_URL", "postgresql://stub:secret@host/db")
        leaky_stderr = (
            "psql: error: connection to server at "
            '"postgresql://stub:secret@host/db?sslmode=require" failed: FATAL'
        )
        monkeypatch.setattr(
            "scripts.phase12_kill_switch.subprocess.run",
            lambda *a, **kw: MagicMock(returncode=2, stdout="", stderr=leaky_stderr),
        )
        with pytest.raises(RuntimeError) as exc_info:
            ks.measure_p999_via_sql()
        msg = str(exc_info.value)
        # Password and full DSN must NOT appear in the raised error.
        assert "secret" not in msg
        assert "postgresql://stub" not in msg
        # The redaction marker confirms the scrub ran.
        assert "<postgres-dsn-redacted>" in msg

    def test_redact_kv_password_form(self) -> None:
        """Specialist defense in depth: libpq's key=value error form
        (rare but emitted by pgbouncer SSL probes) carries the password
        in plain text. The kv redactor must scrub it even when the URI
        regex doesn't match anything."""
        msg = "could not connect: host=db.example.com user=postgres password=HUNTER2 dbname=q"
        redacted = ks._redact_dsn(msg)
        assert "HUNTER2" not in redacted
        assert "password=<redacted>" in redacted
        # Non-secret context must survive.
        assert "host=db.example.com" in redacted
        assert "user=postgres" in redacted

    def test_redact_kv_password_case_insensitive(self) -> None:
        """libpq accepts `Password=` / `PASSWORD=` interchangeably — the
        scrub must be case-insensitive to match."""
        assert "HUNTER2" not in ks._redact_dsn("PASSWORD=HUNTER2 trailing")
        assert "HUNTER2" not in ks._redact_dsn("Password = HUNTER2 trailing")


# --- H-0622: atomic TODOS write --------------------------------------------


class TestAtomicTodosAppend:
    """The audit log write must be atomic — a crash mid-write cannot
    truncate the file, and a concurrent invocation cannot clobber another
    operator's entry. tempfile + os.replace gives us the POSIX guarantee."""

    def test_atomic_append_preserves_existing_content(self, monkeypatch, tmp_path) -> None:
        todos = tmp_path / "TODOS.md"
        existing = "## Phase 12 plan\n- pre-existing line\n"
        todos.write_text(existing)
        monkeypatch.setattr(ks, "TODOS_PATH", todos)
        ks._atomic_append_todos("\n## new entry\n")
        result = todos.read_text()
        assert result.startswith(existing)
        assert "new entry" in result

    def test_atomic_append_no_tmp_leak_on_success(self, monkeypatch, tmp_path) -> None:
        """The .tmp file must be renamed away (os.replace) — no orphan
        .tmp files in the audit directory after a successful append."""
        todos = tmp_path / "TODOS.md"
        todos.write_text("# header\n")
        monkeypatch.setattr(ks, "TODOS_PATH", todos)
        ks._atomic_append_todos("\nline\n")
        leftover = list(tmp_path.glob(".phase12_kill_switch_audit_*.tmp"))
        assert leftover == []

    def test_atomic_append_no_tmp_leak_on_replace_failure(
        self, monkeypatch, tmp_path
    ) -> None:
        """If os.replace raises, the temp file must be cleaned up — a
        disk-full / permissions failure should not leave .tmp accumulating."""
        todos = tmp_path / "TODOS.md"
        todos.write_text("# header\n")
        monkeypatch.setattr(ks, "TODOS_PATH", todos)

        def fail_replace(*_, **__):
            raise OSError("simulated permission error")

        monkeypatch.setattr("scripts.phase12_kill_switch.os.replace", fail_replace)
        with pytest.raises(OSError, match="simulated permission error"):
            ks._atomic_append_todos("\nline\n")
        leftover = list(tmp_path.glob(".phase12_kill_switch_audit_*.tmp"))
        assert leftover == [], f"orphan tmp files leaked: {leftover!r}"

    def test_atomic_append_creates_parent_dir(self, monkeypatch, tmp_path) -> None:
        """Creates the parent directory when missing — supports a
        fresh-clone workflow where the .planning tree hasn't been
        populated yet."""
        target = tmp_path / "new_dir" / "TODOS.md"
        monkeypatch.setattr(ks, "TODOS_PATH", target)
        ks._atomic_append_todos("\nfirst line\n")
        assert target.exists()
        assert "first line" in target.read_text()


# --- H-0624: confirm gate against prod hosts -------------------------------


class TestConfirmProdGate:
    """RUN_KILL_SWITCH=true is necessary but not sufficient when pointing
    at a prod host. A second explicit confirmation (--confirm-prod CLI
    flag or PHASE12_KILL_SWITCH_CONFIRMED env var) is required."""

    @pytest.mark.parametrize(
        "host,expected_prod",
        [
            ("localhost", False),
            ("127.0.0.1", False),
            ("db.staging.supabase.co", False),
            ("stg.example.com", False),
            ("db.test.supabase.co", False),
            ("foo.dev.example.com", False),
            ("db.production.supabase.co", True),
            ("db.example.com", True),
            ("db.prod.example.com", True),
        ],
    )
    def test_prod_host_detection(self, host: str, expected_prod: bool) -> None:
        url = f"postgresql://u:p@{host}/d"
        assert ks._looks_like_prod_host(url) is expected_prod

    def test_no_url_defaults_to_prod(self) -> None:
        """Default-deny — if we can't detect the host, treat as prod
        so a missing-env-var misconfiguration doesn't quietly skip the
        confirm gate."""
        assert ks._looks_like_prod_host(None) is True
        assert ks._looks_like_prod_host("") is True

    @pytest.mark.asyncio
    async def test_prod_host_without_confirm_aborts(self, monkeypatch) -> None:
        """Without --confirm-prod or PHASE12_KILL_SWITCH_CONFIRMED, a
        prod-looking DATABASE_URL must produce SystemExit, not silently
        proceed to a cutover."""
        # The autouse fixture pre-sets PHASE12_KILL_SWITCH_CONFIRMED; undo it.
        monkeypatch.delenv("PHASE12_KILL_SWITCH_CONFIRMED", raising=False)
        monkeypatch.setenv("RUN_KILL_SWITCH", "true")
        monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@db.production.example.com/d")
        with pytest.raises(SystemExit, match="confirm-prod|CONFIRMED"):
            await ks.main(cli_p999=900_000.0, cli_count=3)

    @pytest.mark.asyncio
    async def test_prod_host_with_cli_confirm_proceeds(self, monkeypatch) -> None:
        """--confirm-prod (cli_confirm_prod=True) must unblock the gate."""
        monkeypatch.delenv("PHASE12_KILL_SWITCH_CONFIRMED", raising=False)
        monkeypatch.setenv("RUN_KILL_SWITCH", "true")
        monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@db.production.example.com/d")
        # p999 < threshold short-circuits before any DB calls.
        rc = await ks.main(
            cli_p999=100_000.0, cli_count=10, cli_confirm_prod=True
        )
        assert rc == 0

    @pytest.mark.asyncio
    async def test_prod_host_with_env_confirm_proceeds(self, monkeypatch) -> None:
        """PHASE12_KILL_SWITCH_CONFIRMED=true must unblock the gate too —
        phase12_deploy.py passes the confirmation through the env."""
        monkeypatch.setenv("RUN_KILL_SWITCH", "true")
        monkeypatch.setenv("PHASE12_KILL_SWITCH_CONFIRMED", "true")
        monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@db.production.example.com/d")
        rc = await ks.main(cli_p999=100_000.0, cli_count=10)
        assert rc == 0

    @pytest.mark.asyncio
    async def test_localhost_host_skips_confirm_gate(self, monkeypatch) -> None:
        """A localhost DSN must not require --confirm-prod — dev runs
        would otherwise need a redundant flag for every iteration."""
        monkeypatch.delenv("PHASE12_KILL_SWITCH_CONFIRMED", raising=False)
        monkeypatch.setenv("RUN_KILL_SWITCH", "true")
        monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost/d")
        rc = await ks.main(cli_p999=100_000.0, cli_count=10)
        assert rc == 0

    @pytest.mark.asyncio
    async def test_garbage_confirmed_value_fails_loud(self, monkeypatch) -> None:
        """Specialist gap: PHASE12_KILL_SWITCH_CONFIRMED=maybe must fail
        loud (SystemExit) rather than silently default to either polarity.
        Mirrors the RUN_KILL_SWITCH parser's Rule-12 contract."""
        monkeypatch.setenv("RUN_KILL_SWITCH", "true")
        monkeypatch.setenv("PHASE12_KILL_SWITCH_CONFIRMED", "maybe")
        monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost/d")
        with pytest.raises(SystemExit):
            await ks.main(cli_p999=100_000.0, cli_count=10)

    @pytest.mark.asyncio
    async def test_garbage_force_value_fails_loud(self, monkeypatch) -> None:
        """Same Rule-12 contract for PHASE12_FORCE_CUTOVER — a typo
        cannot silently flip the resume gate either polarity."""
        monkeypatch.setenv("RUN_KILL_SWITCH", "true")
        monkeypatch.setenv("PHASE12_FORCE_CUTOVER", "ture")
        monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost/d")
        with pytest.raises(SystemExit):
            await ks.main(cli_p999=100_000.0, cli_count=10)


# --- H-0614: --force overrides p999 threshold gate -------------------------


class TestForceFlag:
    """After a partial cutover, p999 may drop below threshold even though
    some strategies still have heavy keys. Without --force, the re-run
    would log "no cutover needed" and exit, leaving the partial state in
    place forever."""

    @pytest.mark.asyncio
    async def test_below_threshold_without_force_short_circuits(
        self, monkeypatch, capsys
    ) -> None:
        """Default behavior: p999 below threshold → exit 0 with a "no
        cutover needed" message AND a hint about --force for resume."""
        monkeypatch.setenv("RUN_KILL_SWITCH", "true")
        rc = await ks.main(cli_p999=100_000.0, cli_count=10)
        assert rc == 0
        out = capsys.readouterr().out
        assert "no cutover needed" in out.lower()
        # H-0614 resume hint must surface so operators know about --force.
        assert "--force" in out or "PHASE12_FORCE_CUTOVER" in out

    @pytest.mark.asyncio
    async def test_below_threshold_with_cli_force_proceeds(
        self, monkeypatch, tmp_path
    ) -> None:
        """--force must bypass the threshold short-circuit and run the
        cutover even when p999 < THRESHOLD_BYTES."""
        todos = tmp_path / "TODOS.md"
        todos.write_text("# existing\n")
        monkeypatch.setattr(ks, "TODOS_PATH", todos)
        monkeypatch.setenv("RUN_KILL_SWITCH", "true")

        sid = _uuid_for("force-strat")

        async def fake_cutover(s: str) -> int:
            return 0
        monkeypatch.setattr(ks, "cutover_strategy", fake_cutover)

        mock_supabase = MagicMock()
        select_chain = MagicMock()
        select_chain.execute.return_value = MagicMock(data=[{"strategy_id": sid}])
        mock_supabase.table.return_value.select.return_value = select_chain

        with patch("scripts.phase12_kill_switch.get_supabase", return_value=mock_supabase):
            rc = await ks.main(cli_p999=100_000.0, cli_count=1, cli_force=True)

        # Cutover proceeded despite p999 < threshold.
        assert rc == 0
        log = todos.read_text()
        assert "Kill-switch triggered" in log
        assert "(no-op" in log  # moved=0 below threshold but force=True

    @pytest.mark.asyncio
    async def test_below_threshold_with_env_force_proceeds(
        self, monkeypatch, tmp_path, capsys
    ) -> None:
        """PHASE12_FORCE_CUTOVER=true must have the same effect as --force."""
        todos = tmp_path / "TODOS.md"
        todos.write_text("# existing\n")
        monkeypatch.setattr(ks, "TODOS_PATH", todos)
        monkeypatch.setenv("RUN_KILL_SWITCH", "true")
        monkeypatch.setenv("PHASE12_FORCE_CUTOVER", "true")

        sid = _uuid_for("env-force-strat")

        async def fake_cutover(s: str) -> int:
            return 1
        monkeypatch.setattr(ks, "cutover_strategy", fake_cutover)

        mock_supabase = MagicMock()
        select_chain = MagicMock()
        select_chain.execute.return_value = MagicMock(data=[{"strategy_id": sid}])
        mock_supabase.table.return_value.select.return_value = select_chain

        with patch("scripts.phase12_kill_switch.get_supabase", return_value=mock_supabase):
            rc = await ks.main(cli_p999=100_000.0, cli_count=1)

        assert rc == 0
        out = capsys.readouterr().out
        assert "bypassing threshold gate" in out

    @pytest.mark.asyncio
    async def test_force_above_threshold_still_runs(
        self, monkeypatch, tmp_path
    ) -> None:
        """--force when p999 is ALREADY above threshold is a no-op
        relative to the default — the cutover runs in both cases."""
        todos = tmp_path / "TODOS.md"
        todos.write_text("# existing\n")
        monkeypatch.setattr(ks, "TODOS_PATH", todos)
        monkeypatch.setenv("RUN_KILL_SWITCH", "true")

        sid = _uuid_for("force-above-threshold")

        async def fake_cutover(s: str) -> int:
            return 3
        monkeypatch.setattr(ks, "cutover_strategy", fake_cutover)

        mock_supabase = MagicMock()
        select_chain = MagicMock()
        select_chain.execute.return_value = MagicMock(data=[{"strategy_id": sid}])
        mock_supabase.table.return_value.select.return_value = select_chain

        with patch("scripts.phase12_kill_switch.get_supabase", return_value=mock_supabase):
            rc = await ks.main(cli_p999=900_000.0, cli_count=1, cli_force=True)

        assert rc == 0
        assert "3" in todos.read_text()  # moved 3 keys logged


# --- H-0606: bounded concurrency on cutover loop ---------------------------


class TestBoundedConcurrency:
    """The per-strategy cutover loop must run with bounded concurrency
    (asyncio.Semaphore) — unbounded gather saturates the Postgres pool
    and starves other writers; serial is slow + extends the inconsistency
    window during which only some strategies have heavy keys stripped."""

    @pytest.mark.asyncio
    async def test_concurrent_cutovers_respect_semaphore_bound(
        self, monkeypatch
    ) -> None:
        """The number of concurrently-running cutover_strategy calls must
        not exceed _CUTOVER_CONCURRENCY."""
        concurrency = 3
        monkeypatch.setattr(ks, "_CUTOVER_CONCURRENCY", concurrency)

        in_flight = 0
        peak_in_flight = 0
        lock = asyncio.Lock()

        async def fake_cutover(sid: str) -> int:
            nonlocal in_flight, peak_in_flight
            async with lock:
                in_flight += 1
                peak_in_flight = max(peak_in_flight, in_flight)
            # Yield so other coroutines can run.
            await asyncio.sleep(0.01)
            async with lock:
                in_flight -= 1
            return 1

        monkeypatch.setattr(ks, "cutover_strategy", fake_cutover)

        sids = [_uuid_for(f"bounded-{i}") for i in range(10)]
        total, fails = await ks._run_cutovers_bounded(sids, concurrency=concurrency)
        assert total == 10
        assert fails == []
        # Peak in-flight must not exceed the bound.
        assert peak_in_flight <= concurrency, (
            f"semaphore violated: peak {peak_in_flight} > bound {concurrency}"
        )
        # And must actually achieve concurrency (otherwise the test is
        # accidentally proving "serial = bound" trivially).
        assert peak_in_flight > 1, (
            "expected at least 2 concurrent cutovers under bound 3"
        )

    @pytest.mark.asyncio
    async def test_one_failure_does_not_abort_others(self, monkeypatch) -> None:
        """A mid-batch RPC failure must NOT cancel sibling tasks. Returns
        partial (total_moved, failures) so the caller can write the audit
        log even when some strategies failed."""
        sids = [_uuid_for(f"failure-{i}") for i in range(5)]
        fail_idx = 2

        async def fake_cutover(sid: str) -> int:
            if sid == sids[fail_idx]:
                raise RuntimeError("simulated mid-batch failure")
            return 4

        monkeypatch.setattr(ks, "cutover_strategy", fake_cutover)
        total, fails = await ks._run_cutovers_bounded(sids, concurrency=5)
        # 4 successes × 4 keys = 16; 1 failure.
        assert total == 16
        assert len(fails) == 1
        assert fails[0][0] == sids[fail_idx]
        assert "simulated mid-batch failure" in fails[0][1]

    @pytest.mark.asyncio
    async def test_baseexception_in_one_cutover_does_not_drop_others(
        self, monkeypatch
    ) -> None:
        """Red-team: if `cutover_strategy` ever leaks a BaseException
        subclass (MemoryError, KeyboardInterrupt re-raise, custom
        BaseException), `return_exceptions=True` on gather must still
        capture the surviving strategies' results so the audit log
        records what DID land. The leaked exception lands in the
        failures list as repr(exc); main() still writes audit + stderr."""
        sids = [_uuid_for(f"baseexc-{i}") for i in range(3)]
        leak_idx = 1

        async def fake_cutover(sid: str) -> int:
            if sid == sids[leak_idx]:
                # MemoryError is a BaseException subclass that bypasses
                # the inner `except Exception` guard in _one.
                raise MemoryError("simulated allocator fault")
            return 7

        monkeypatch.setattr(ks, "cutover_strategy", fake_cutover)
        total, fails = await ks._run_cutovers_bounded(sids, concurrency=3)
        # 2 surviving cutovers × 7 keys = 14; 1 BaseException captured.
        assert total == 14
        assert len(fails) == 1
        # The failing sid is the one we sabotaged.
        assert fails[0][0] == sids[leak_idx]
        assert "MemoryError" in fails[0][1]


# --- M-0640: Bytes NewType + Final typing ----------------------------------


class TestTypingHygiene:
    """Drift guards for the typed-constant pattern. A future refactor that
    accidentally drops the Final qualifier or changes THRESHOLD_BYTES'
    underlying int would fail these."""

    def test_threshold_bytes_is_integral_800kb(self) -> None:
        assert int(ks.THRESHOLD_BYTES) == 800_000

    def test_bytes_newtype_exists(self) -> None:
        """The Bytes NewType is part of the module API — pin it so a
        refactor doesn't silently revert to a bare int."""
        assert hasattr(ks, "Bytes")

    def test_threshold_bytes_typed_as_bytes(self) -> None:
        """THRESHOLD_BYTES is constructed via Bytes(800_000) so the
        annotation correctly tags it. NewType at runtime is the identity
        function, so the value is a plain int — assert behavior, not
        annotation existence."""
        # Bytes(x) == x; the test is meaningful only when paired with a
        # mypy --strict pass.
        assert ks.Bytes(0) == 0
        assert ks.Bytes(123) == 123

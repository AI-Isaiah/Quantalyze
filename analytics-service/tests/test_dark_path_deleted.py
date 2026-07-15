"""Phase 106-09/10 (D4/D1) — the PERMANENT dark-path deletion grep-gate.

Stage B of the backbone unification retires the trades-based
``run_strategy_analytics`` chain and every re-entry point that reached it
(the HTTP ``compute_analytics`` endpoint, the ``run_compute_analytics_job``
worker handler, the ``BROKER_DAILIES_VIA_FUNDING`` funding-derive flag, and
the TypeScript legacy keys-sync shim). Once deleted, nothing may silently
resurrect a non-backbone strategy-compute path.

106-10 (D1) extends the gate to the retired rollback net + cosmetic residue:
the unified-backbone kill-switch readers (``isUnifiedBackboneActive`` /
``is_unified_backbone_active``) are deleted, the flag-monitor no longer
upserts the kill-switch row (``value: "off"``), and the cosmetic
``compute_analytics`` JobKind residue (admin table + types) is gone. These
must all stay dead too.

This is a SOURCE-SCAN gate, mirroring the established style of
``tests/test_cash_basis_series_sc4.py:646-750`` (``_repo_root`` +
``_strip_comment`` + comment-stripped literal counts). Grep-gate hygiene:
a ``#``/``//``/``*`` comment mentioning a retired token must neither trip
nor satisfy the gate, so pure-comment lines are stripped before counting.

Two directions are enforced, so the gate can never quietly rot:
  * NEGATIVE — the retired tokens appear ZERO times across the live compute
    surface (both runtimes).
  * POSITIVE (SC-3) — the KEPT CSV/backbone path and its shared helpers are
    still present, proving the deletion was surgical and the gate is not
    merely over-broad (a gate that also nuked the live path would pass the
    negative asserts vacuously).
"""

from __future__ import annotations

from pathlib import Path


def _repo_root() -> Path:
    """The monorepo root — the first ancestor containing BOTH ``src/`` and
    ``analytics-service/``. Resolved by walking up so the scan works from the
    ``analytics-service`` pytest cwd and in CI."""
    for parent in Path(__file__).resolve().parents:
        if (parent / "src").is_dir() and (parent / "analytics-service").is_dir():
            return parent
    raise RuntimeError(
        "could not locate the repo root (an ancestor with both src/ and "
        "analytics-service/)"
    )


def _strip_comment(line: str, *, lang: str) -> bool:
    """True when ``line`` is a pure comment for its language (grep-gate
    hygiene: a docstring/comment mentioning a token must neither trip nor
    satisfy the gate)."""
    stripped = line.lstrip()
    if lang == "py":
        return stripped.startswith("#")
    return stripped.startswith("//") or stripped.startswith("*")


def _count(path: Path, token: str, *, lang: str) -> int:
    """Comment-stripped occurrences of ``token`` in ``path``."""
    if not path.exists():
        return 0
    return sum(
        line.count(token)
        for line in path.read_text().splitlines()
        if not _strip_comment(line, lang=lang)
    )


def _py_scan_files() -> list[Path]:
    """The live PYTHON compute surface: the runner + worker + cron entrypoints
    plus a full walk of ``routers/`` and ``scripts/``. Any re-entry into the
    dark path would land in one of these."""
    svc = _repo_root() / "analytics-service"
    files: list[Path] = [
        svc / "services" / "analytics_runner.py",
        svc / "services" / "job_worker.py",
        svc / "routers" / "cron.py",
        svc / "main_worker.py",
        svc / "main.py",
    ]
    for sub in ("routers", "scripts"):
        files.extend(sorted((svc / sub).rglob("*.py")))
    # dedupe (cron.py is also under the routers walk) while preserving the
    # explicit entrypoints, and keep only files that exist.
    seen: set[Path] = set()
    scan: list[Path] = []
    for f in files:
        rf = f.resolve()
        if rf in seen or not rf.exists():
            continue
        seen.add(rf)
        scan.append(rf)
    return scan


# ---------------------------------------------------------------------------
# NEGATIVE — the retired dark path is gone from the live compute surface.
# ---------------------------------------------------------------------------


def test_dark_chain_run_strategy_analytics_fully_deleted() -> None:
    """The trades-based ``run_strategy_analytics`` chain (definition, docstring
    contract, and every caller) has ZERO occurrences across the live Python
    compute surface. A surviving reference is a dark-path re-entry."""
    scan = _py_scan_files()
    assert scan, "the py scan found no files — path resolution is broken"
    offenders = [
        f"{f}: {_count(f, 'run_strategy_analytics', lang='py')}"
        for f in scan
        if _count(f, "run_strategy_analytics", lang="py")
    ]
    assert not offenders, (
        "dark path re-entry survived deletion: `run_strategy_analytics` still "
        "referenced (non-comment) on the live compute surface — the trades "
        "chain must be fully deleted (106-09 D4):\n" + "\n".join(offenders)
    )


def test_compute_analytics_job_reentry_deleted() -> None:
    """Both retired re-entry points into the dark chain are gone: the
    ``run_compute_analytics_job`` worker handler AND the quoted job-name
    literal ``"compute_analytics"`` that enqueued/dispatched it. The quoted
    literal is substring-safe — it does NOT match
    ``"compute_analytics_from_csv"`` (the KEPT CSV job)."""
    scan = _py_scan_files()
    for token in ('run_compute_analytics_job', '"compute_analytics"'):
        offenders = [
            f"{f}: {_count(f, token, lang='py')}"
            for f in scan
            if _count(f, token, lang="py")
        ]
        assert not offenders, (
            f"dark path re-entry survived deletion: {token} still referenced "
            "(non-comment) on the live compute surface — the compute_analytics "
            "re-entry must be fully retired (106-08/09):\n" + "\n".join(offenders)
        )


def test_broker_dailies_via_funding_flag_deleted() -> None:
    """The ``BROKER_DAILIES_VIA_FUNDING`` funding-derive flag that fed the dark
    path is gone — no dormant env toggle can re-arm it."""
    scan = _py_scan_files()
    offenders = [
        f"{f}: {_count(f, 'BROKER_DAILIES_VIA_FUNDING', lang='py')}"
        for f in scan
        if _count(f, "BROKER_DAILIES_VIA_FUNDING", lang="py")
    ]
    assert not offenders, (
        "dark path re-entry survived deletion: BROKER_DAILIES_VIA_FUNDING "
        "still referenced (non-comment) — the funding-derive flag must stay "
        "deleted:\n" + "\n".join(offenders)
    )


def test_deleted_dark_path_files_stay_absent() -> None:
    """The dark-path module files deleted in 106-07/08 stay deleted."""
    svc = _repo_root() / "analytics-service"
    for rel in ("routers/analytics.py", "scripts/phase12_backfill_enqueue.py"):
        assert not (svc / rel).exists(), (
            f"dark path re-entry survived deletion: {rel} was recreated — the "
            "legacy compute_analytics HTTP route / phase12 backfill enqueue "
            "must stay deleted"
        )


def test_ts_reentry_points_stay_dead() -> None:
    """The TypeScript re-entry points retired earlier in Stage B stay dead
    (two-lang scan, ``lang="ts"``): the keys-sync route no longer exports the
    legacy handler and the analytics client no longer calls the legacy
    strategy-compute endpoint."""
    src = _repo_root() / "src"
    checks = [
        (src / "app" / "api" / "keys" / "sync" / "route.ts", "legacyKeysSyncHandler"),
        (src / "lib" / "analytics-client.ts", "computeAnalytics"),
    ]
    for path, token in checks:
        assert path.exists(), f"TS scan target missing — path resolution broke: {path}"
        assert _count(path, token, lang="ts") == 0, (
            f"dark path re-entry survived deletion: {token} still referenced "
            f"(non-comment) in {path.name} — the TS legacy compute re-entry "
            "must stay dead"
        )


def test_stage_b_flag_machinery_and_cosmetic_residue_stay_dead() -> None:
    """106-10 (D1): the retired rollback net + cosmetic residue stay deleted
    (two-lang scan, ``lang="ts"``):

      * the unified-backbone kill-switch readers are gone — ``feature-flags.ts``
        stays absent (``isUnifiedBackboneActive`` count 0 by absence);
      * the flag-monitor NEVER upserts the kill-switch row again — the literal
        ``value: "off"`` count in its route is 0 (auto-rollback retired);
      * the cosmetic ``compute_analytics`` JobKind residue is gone from the
        admin table + shared types. The QUOTED literal ``"compute_analytics"``
        is substring-safe — it does NOT match ``"compute_analytics_from_csv"``
        (the KEPT CSV job)."""
    src = _repo_root() / "src"
    checks = [
        # (path, token, human-readable reason)
        (
            src / "lib" / "feature-flags.ts",
            "isUnifiedBackboneActive",
            "the TS kill-switch reader must stay deleted",
        ),
        (
            src / "app" / "api" / "cron" / "flag-monitor" / "route.ts",
            'value: "off"',
            "flag-monitor must never upsert the kill-switch row (auto-rollback retired)",
        ),
        (
            src / "components" / "admin" / "ComputeJobsTable.tsx",
            '"compute_analytics"',
            "the compute_analytics KIND_OPTIONS residue must stay removed",
        ),
        (
            src / "lib" / "types.ts",
            '"compute_analytics"',
            "the compute_analytics JobKind union member must stay removed",
        ),
    ]
    for path, token, reason in checks:
        assert _count(path, token, lang="ts") == 0, (
            f"Stage-B residue survived: `{token}` still referenced (non-comment) "
            f"in {path.name} — {reason} (106-10 D1)"
        )


# ---------------------------------------------------------------------------
# POSITIVE (SC-3) — the KEPT backbone path + shared helpers survive, proving
# the deletion was surgical (the gate is not vacuously over-broad).
# ---------------------------------------------------------------------------


def test_live_csv_backbone_helpers_preserved() -> None:
    """SC-3: the ONE kept derive path and its shared helpers are still present.
    If a broad deletion had also removed the live CSV/backbone route, the
    negative asserts above would pass vacuously; these positive asserts make
    that failure mode loud."""
    svc = _repo_root() / "analytics-service"
    keep = [
        (svc / "services" / "analytics_runner.py", "run_csv_strategy_analytics"),
        (svc / "services" / "job_worker.py", '"compute_analytics_from_csv"'),
        (svc / "services" / "transforms.py", "trades_to_daily_returns_with_status"),
    ]
    for path, token in keep:
        assert _count(path, token, lang="py") > 0, (
            f"SC-3 KEEP broken: {token} is MISSING from {path.name} — the live "
            "CSV/backbone derive path (or a shared helper) was over-deleted; "
            "the dark-path gate must not remove live compute code"
        )

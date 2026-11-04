"""Phase 167.2.1.1.2.1 TRADEPAGES, plan 01: what is left of the trade-pages module after Phase 176.

The rebuild's trade read (Bybit 7-day windows, the OKX per-instrument-type walk, every other venue
read to an empty page) was deleted with the reconstruct crawl in Phase 176 (D-04), and so were the
tests that drove it. One text pin stays, on the Bybit Unified-transfer reader (Phase 186 D-02: the live derive reads it).
"""
from __future__ import annotations

from pathlib import Path


# ---------------------------------------------------------------------------
# Phase 180 BYBITFUNDING plan 06: the Bybit Unified-transfer reader
# ---------------------------------------------------------------------------


def test_job_worker_imports_the_unified_flows_reader_once() -> None:
    """Phase 180 D-02 kept the live derive off the Unified-transfer reader; Phase 186 D-02
    (founder 2026-11-01) reversed that for the per-key derive, so the old pin is replaced and not
    deleted. The worker names the module path on exactly ONE line and that line imports the reader
    (the live Bybit derive now reads it); the only other service module naming the function is the
    reader's own module. The archive job and ``broker_dailies`` still name neither the module nor
    the function: their flow kinds are unchanged."""
    services = Path(__file__).resolve().parent.parent / "services"
    naming = sorted(
        path.name
        for path in services.glob("*.py")
        if "fetch_bybit_unified_flows" in path.read_text(encoding="utf-8")
    )
    assert naming == ["bybit_unified_flows.py", "job_worker.py"], naming

    for name in ("broker_dailies.py", "okx_archive_job.py"):
        text = (services / name).read_text(encoding="utf-8")
        assert "fetch_bybit_unified_flows" not in text, name
        assert "bybit_unified_flows" not in text, name

    worker = (services / "job_worker.py").read_text(encoding="utf-8").splitlines()
    mentions = [line for line in worker if "services.bybit_unified_flows" in line]
    assert len(mentions) == 1, mentions
    assert "fetch_bybit_unified_flows" in mentions[0], mentions

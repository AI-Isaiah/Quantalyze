"""Phase 167.2.1.1.2.1 TRADEPAGES, plan 01: what is left of the trade-pages module after Phase 176.

The rebuild's trade read (Bybit 7-day windows, the OKX per-instrument-type walk, every other venue
read to an empty page) was deleted with the reconstruct crawl in Phase 176 (D-04), and so were the
tests that drove it. One text pin stays, on the Bybit Unified-transfer reader.
"""
from __future__ import annotations

from pathlib import Path


# ---------------------------------------------------------------------------
# Phase 180 BYBITFUNDING plan 06: the Bybit Unified-transfer reader
# ---------------------------------------------------------------------------


def test_no_service_module_calls_the_unified_flows_reader() -> None:
    """D-02: the live broker-dailies, composite and OKX-archive readers keep their kinds. The
    rebuild that read the flows was retired by Phase 176 (D-04), so the reader is orphaned (booked
    in TODOS ``176-RECONSTRUCT-CAP-MARKER-INERT``) and only its own module names the function.
    The second half is unchanged: the live readers do not name the reader, and the worker may
    import the reader's error class (the classifier arm) and nothing else from the module."""
    services = Path(__file__).resolve().parent.parent / "services"
    naming = sorted(
        path.name
        for path in services.glob("*.py")
        if "fetch_bybit_unified_flows" in path.read_text(encoding="utf-8")
    )
    assert naming == ["bybit_unified_flows.py"], naming

    for name in ("broker_dailies.py", "okx_archive_job.py"):
        text = (services / name).read_text(encoding="utf-8")
        assert "fetch_bybit_unified_flows" not in text, name
        assert "bybit_unified_flows" not in text, name

    worker = (services / "job_worker.py").read_text(encoding="utf-8").splitlines()
    mentions = [line for line in worker if "bybit_unified_flows" in line]
    assert len(mentions) <= 1, mentions
    for line in mentions:
        assert line.strip().replace("(", "").replace(")", "").endswith("import BybitUnifiedFlowReadError"), line

"""Route-level contract for the weight optimizer (Phase 28).

The math is pinned in test_optimizer.py; this verifies the thin HTTP transport:
the X-Service-Key gate, the series-object → optimizer adaptation, and the
ok / honest-absence envelopes. Uses FastAPI's TestClient against the real app
(middleware included) with the service key monkeypatched onto the module global
the middleware reads.
"""

import numpy as np
import pytest
from fastapi.testclient import TestClient

KEY = "test-service-key"


def _client(monkeypatch) -> TestClient:
    # Lazy import — do NOT import `main` (and, transitively, every router) at
    # module COLLECTION time. test_c19_portfolio_fixes patches
    # `slowapi.Limiter = _NoopLimiter` at its import time (restored only in its
    # module teardown); a collection-time `import main` here would, when collected
    # after test_c19, import routers.simulator inside that pollution window and
    # bind its limiter to the noop — breaking the G15-004 limiter-singleton test.
    # Importing at test-run time (pollution already restored, modules cached)
    # avoids perturbing the import order.
    import main

    monkeypatch.setattr(main, "SERVICE_KEY", KEY)
    return TestClient(main.app)


def _series(n: int, seed: int, vol: float):
    rng = np.random.default_rng(seed)
    vals = rng.normal(0.0, vol, n)
    out = []
    month, day = 1, 1
    for v in vals:
        out.append({"date": f"2024-{month:02d}-{day:02d}", "value": float(v)})
        day += 1
        if day > 28:
            day = 1
            month += 1
    return out


def test_requires_service_key(monkeypatch):
    client = _client(monkeypatch)
    resp = client.post("/api/optimize-weights", json={"series": {}, "objective": "min_vol"})
    assert resp.status_code == 401  # no X-Service-Key header


def test_min_vol_ok_envelope(monkeypatch):
    client = _client(monkeypatch)
    body = {
        "series": {"A": _series(120, 1, 0.005), "B": _series(120, 2, 0.02)},
        "objective": "min_vol",
    }
    resp = client.post("/api/optimize-weights", json=body, headers={"X-Service-Key": KEY})
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["objective"] == "min_vol"
    assert data["in_sample"] is True  # never a forecast
    assert data["weights"] is not None
    assert set(data["weights"].keys()) == {"A", "B"}
    assert data["weights"]["A"] + data["weights"]["B"] == pytest.approx(1.0, abs=1e-6)


def test_degenerate_returns_honest_absence(monkeypatch):
    client = _client(monkeypatch)
    # One strategy ⇒ ok:false, weights:null (never a fabricated vector).
    body = {"series": {"A": _series(120, 3, 0.01)}, "objective": "min_vol"}
    resp = client.post("/api/optimize-weights", json=body, headers={"X-Service-Key": KEY})
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is False
    assert data["weights"] is None
    assert data["reason"] == "few-strategies"

#!/usr/bin/env python3
"""
BLEND-07 fixture generator + from-scratch numpy verification (run-once, dev-only).

Produces the DETERMINISTIC 6-series fixture `src/lib/__fixtures__/blend07-six-series.json`
and prints the from-scratch numpy blend numbers (over the max-overlap window) that the
`BLEND-07-verification.md` artifact records and `scenario-blend07.test.ts` asserts against.

WHY a synthesised fixture (provenance): the 6 real production series
(mm / neon1 / pokeokx / uc244 + OKX + Bybit) are NOT committed anywhere in-repo, and
pulling them live at test time is non-deterministic (can't run in CI hermetically —
55-RESEARCH Assumption A2). Per the phase plan's key-constraints, this fixture is a
DETERMINISTIC REPRESENTATIVE dataset with a fixed RNG seed that reproduces the shape that
matters: staggered inceptions, a longer union span, and at least one ENDED-tail member so
the max-overlap intersection window is strictly tighter than the union — the whole point
of BLEND-07 is proving the ended strategy no longer dilutes the divisor. The OLD-convention
empirical numbers from the real 6-strategy prod audit (+586.86% / 51.82% / 2.43 / -15.15% /
n=1163, ADR-001:21) are recorded in the artifact for CONTRAST; the NEW window-bounded
numbers below are computed on THIS fixture.

The numpy formulas MATCH src/lib/scenario.ts:497-543 exactly:
  twr  = prod(1+r) - 1
  cagr = (1+twr)^(252/n) - 1
  vol  = std(ddof=1) * sqrt(252)          (SAMPLE std)
  sharpe = mean(r) * 252 / vol            (rf = 0)
  maxDD = min(equity/cummax - 1)          (equity = cumprod(1+r))
252-day annualization, product-wide.
"""

import json
import os

import numpy as np

# ---------------------------------------------------------------------------
# 1. Deterministic 6-series fixture construction.
# ---------------------------------------------------------------------------
# Business-day calendar (Mon-Fri) generator — mirrors scenario.test.ts buildDates
# so the TS gate and this script agree on the axis.
from datetime import date, timedelta


def business_days(start_iso: str, n: int) -> list[str]:
    out: list[str] = []
    d = date.fromisoformat(start_iso)
    while len(out) < n:
        if d.weekday() < 5:  # 0=Mon .. 4=Fri
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


# A shared master calendar long enough to host all 6 staggered series.
MASTER = business_days("2023-04-26", 820)  # ~3.1y of business days

# Per-strategy spans (index into MASTER). The INTERSECTION (max-overlap) window is
# bounded by the LATEST start and the EARLIEST end. Here uc244 starts latest
# (index 120) and pokeokx ends earliest (index 700) — so the max-overlap window is
# MASTER[120 .. 700]. mm and neon1 span the whole master; okx/bybit are the only
# LIVE-to-the-end pair (as in the real book), but here they DO cover the window.
#
# CRITICAL SHAPE: pokeokx is an ENDED-tail member relative to the UNION (it stops at
# index 700 while mm/neon1/okx/bybit run to 819). Under the OLD union convention its
# post-700 zero-fill would dilute the divisor. Under the NEW convention the max-overlap
# window STOPS at index 700 (pokeokx's last day), so ALL SIX cover it → member_count 6,
# an honest constant divisor. To ALSO prove the ended-member exclusion path, we add the
# window-membership assertion in the test at a WIDER window in scenario.test.ts already;
# here the point is the fp-precision blend equality on the derived max-overlap window.
SPANS = {
    "mm": (0, 819),
    "neon1": (0, 819),
    "pokeokx": (0, 700),  # ends earliest -> sets winEnd
    "uc244": (120, 819),  # starts latest -> sets winStart
    "okx": (60, 819),
    "bybit": (30, 819),
}

# Deterministic per-strategy daily returns via a seeded RNG. Distinct (mean, vol)
# per strategy so the blend is non-trivial; fixed seed => byte-stable fixture.
PARAMS = {
    "mm": (0.0011, 0.010, 11),
    "neon1": (0.0016, 0.018, 22),
    "pokeokx": (0.0022, 0.026, 33),
    "uc244": (0.0008, 0.008, 44),
    "okx": (0.0019, 0.021, 55),
    "bybit": (0.0013, 0.014, 66),
}

fixture: dict[str, list[dict]] = {}
for sid, (i0, i1) in SPANS.items():
    mean, vol, seed = PARAMS[sid]
    rng = np.random.default_rng(seed)
    span_dates = MASTER[i0 : i1 + 1]
    # Round to 6 decimals so the committed JSON is compact + exactly reproducible
    # when parsed back by JS Number (double) — no precision loss vs float64.
    rets = np.round(rng.normal(mean, vol, size=len(span_dates)), 6)
    fixture[sid] = [
        {"date": d, "value": float(v)} for d, v in zip(span_dates, rets)
    ]

# ---------------------------------------------------------------------------
# 2. From-scratch numpy blend over the max-overlap (intersection) window.
# ---------------------------------------------------------------------------
# coverageSpanOf: [first date WITH data, last date WITH data] per series.
spans = {
    sid: (pts[0]["date"], pts[-1]["date"]) for sid, pts in fixture.items()
}
# defaultWindowFor = intersection = [max(firsts), min(lasts)].
win_start = max(f for f, _ in spans.values())
win_end = min(l for _, l in spans.values())

# Members = strategies whose span covers [win_start, win_end] (inclusive-closed).
members = [
    sid
    for sid, (f, l) in spans.items()
    if f <= win_start and l >= win_end
]
members.sort(key=lambda s: list(SPANS).index(s))  # strategy order, like the engine

# Axis = union of members' dates within [win_start, win_end].
axis = sorted(
    {
        p["date"]
        for sid in members
        for p in fixture[sid]
        if win_start <= p["date"] <= win_end
    }
)
n = len(axis)

# Per-member vector over the axis, interior gaps 0-filled (numerator only).
lookup = {
    sid: {p["date"]: p["value"] for p in fixture[sid]} for sid in members
}
mat = np.array(
    [[lookup[sid].get(d, 0.0) for d in axis] for sid in members]
)  # shape (M, n)

# Equal-weight blend: Sigma r / N (constant divisor = member count).
port = mat.mean(axis=0)  # shape (n,)

# Metrics — EXACT scenario.ts formulas (252, ddof=1).
equity = np.cumprod(1.0 + port)
twr = float(equity[-1] - 1.0)
cagr = float((1.0 + twr) ** (252.0 / n) - 1.0)
vol = float(np.std(port, ddof=1) * np.sqrt(252.0))
sharpe = float(np.mean(port) * 252.0 / vol) if vol > 0 else None
running_max = np.maximum.accumulate(equity)
max_dd = float(np.min(equity / running_max - 1.0))

# ---------------------------------------------------------------------------
# 3. Emit fixture + report.
# ---------------------------------------------------------------------------
repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
out_path = os.path.join(
    repo_root, "src", "lib", "__fixtures__", "blend07-six-series.json"
)
with open(out_path, "w") as f:
    json.dump(fixture, f, indent=2)
    f.write("\n")

print(f"WROTE {out_path}")
print("--- BLEND-07 NEW window-bounded numbers (from-scratch numpy) ---")
print(f"win_start    = {win_start}")
print(f"win_end      = {win_end}")
print(f"member_count = {len(members)}  members = {members}")
print(f"n            = {n}")
print(f"twr   (total)= {twr:.10f}   ({twr*100:.2f}%)")
print(f"cagr         = {cagr:.10f}   ({cagr*100:.2f}%)")
print(f"vol          = {vol:.10f}")
print(f"sharpe       = {sharpe:.10f}")
print(f"max_drawdown = {max_dd:.10f}   ({max_dd*100:.2f}%)")
print("--- rounded to the engine payload precision (scenario.ts:617-622) ---")
print(f"twr.toFixed(5)          = {round(twr,5)}")
print(f"cagr.toFixed(5)         = {round(cagr,5)}")
print(f"volatility.toFixed(5)   = {round(vol,5)}")
print(f"sharpe.toFixed(3)       = {round(sharpe,3)}")
print(f"max_drawdown.toFixed(5) = {round(max_dd,5)}")

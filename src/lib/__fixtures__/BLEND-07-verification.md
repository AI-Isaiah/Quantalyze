# BLEND-07 — From-scratch numpy verification of the coverage-window blend

**Phase 55 · Plan 55-03 · ADR-001 · requirement BLEND-07**
**Recorded:** 2026-07-01 — BEFORE any Phase 60 golden re-bake (the non-negotiable ordering).

This is the milestone's **#1 correctness anchor**. It records an INDEPENDENT
from-scratch numpy re-derivation of the equal-weight scenario blend over the
max-overlap (intersection) window, and pins it against `computeScenario` via
`src/lib/scenario-blend07.test.ts`. The independent number is the gate that
defeats the highest-risk pitfall (PITFALLS Pitfall 8): a blind
`--update-snapshots` in Phase 60 canonizing a Phase-55 math bug. The goldens do
not derive from this number, so if the engine drifts, the gate fails before any
bake can mask it.

> **Artifact location note.** The phase plan listed this file under
> `.planning/phases/55-.../`, but `.planning/` is **gitignored** in this repo, so
> a file there would never be committed — defeating the CONTEXT Q3 requirement of a
> *committed durable* artifact. It lives here instead, co-located with the tracked
> fixture JSON (`blend07-six-series.json`). Both are git-committed.

---

## 1. Dataset & provenance

The 6-series fixture `src/lib/__fixtures__/blend07-six-series.json` holds raw
`date` / `daily_return` series for the real strategy ids
`mm / neon1 / pokeokx / uc244 + okx + bybit`.

**Provenance — DETERMINISTIC SYNTHESISED fixture, not a prod pull.** The real
production series are not committed anywhere in-repo, and pulling them live at test
time is non-deterministic and cannot run hermetically in CI (55-RESEARCH Assumption
A2). Per the plan's key-constraints, the fixture is a deterministic representative
dataset produced by a **fixed-seed** generator
(`analytics-service/scripts/gen_blend07_fixture.py`) that reproduces the shape that
matters for BLEND-07:

- **Staggered inceptions** — `uc244` starts latest (`2023-10-11`), setting `winStart`.
- **A longer UNION span** than the intersection — `mm / neon1 / uc244 / okx / bybit`
  all run to `2026-06-16`.
- **One ENDED-tail member** — `pokeokx` ends earliest (`2025-12-31`), setting
  `winEnd`. The whole point of BLEND-07 is proving this ended strategy no longer
  dilutes the divisor: under the OLD convention it stayed counted-and-zero-filled
  past its end; under the NEW convention the max-overlap window stops at its last
  day, and extending the window past it EXCLUDES it (member_count drops 6 → 5, see
  the anti-dilution assertion in the gate).

| id | first (with data) | last (with data) | span role |
|----|-------------------|------------------|-----------|
| mm | 2023-04-26 | 2026-06-16 | full |
| neon1 | 2023-04-26 | 2026-06-16 | full |
| pokeokx | 2023-04-26 | **2025-12-31** | **ended-tail → sets winEnd** |
| uc244 | **2023-10-11** | 2026-06-16 | **late-start → sets winStart** |
| okx | 2023-07-19 | 2026-06-16 | mid-start |
| bybit | 2023-06-07 | 2026-06-16 | mid-start |

**Max-overlap (intersection) window** `= [max(firsts), min(lasts)] = [2023-10-11, 2025-12-31]`.
All six strategies cover this closed window by construction (the window stops at
`pokeokx`'s last day), so **member_count === 6 — a constant, honest divisor**.

---

## 2. The from-scratch numpy script (run-once, dev-only)

Full source: `analytics-service/scripts/gen_blend07_fixture.py`. It generates the
fixture AND computes the blend below. The metric formulas MATCH
`src/lib/scenario.ts:497-543` **exactly** — 252-day annualization, SAMPLE std
(`ddof=1`), `rf=0` — so this is an independent oracle of the same math, not a
re-derivation from the engine.

```python
import json
import numpy as np

fx = json.load(open("src/lib/__fixtures__/blend07-six-series.json"))
ids = list(fx.keys())

# coverageSpanOf: [first date WITH data, last date WITH data] per series.
spans = {sid: (pts[0]["date"], pts[-1]["date"]) for sid, pts in fx.items()}

# defaultWindowFor = intersection = [max(firsts), min(lasts)].
win_start = max(f for f, _ in spans.values())
win_end = min(l for _, l in spans.values())

# Members = strategies whose span covers [win_start, win_end] (inclusive-closed).
members = [s for s in ids if spans[s][0] <= win_start and spans[s][1] >= win_end]

# Axis = union of members' dates within [win_start, win_end].
axis = sorted(
    {p["date"] for s in members for p in fx[s] if win_start <= p["date"] <= win_end}
)
n = len(axis)

# Per-member vector over the axis, interior gaps 0-filled (numerator only).
look = {s: {p["date"]: p["value"] for p in fx[s]} for s in members}
mat = np.array([[look[s].get(d, 0.0) for d in axis] for s in members])  # (M, n)

# Equal-weight blend: Sigma r / N  (constant divisor = member count).
port = mat.mean(axis=0)

# Metrics — EXACT scenario.ts formulas (252, ddof=1, rf=0).
equity = np.cumprod(1.0 + port)
twr = float(equity[-1] - 1.0)                       # prod(1+r) - 1
cagr = float((1.0 + twr) ** (252.0 / n) - 1.0)      # (1+twr)^(252/n) - 1
vol = float(np.std(port, ddof=1) * np.sqrt(252.0))  # SAMPLE std * sqrt(252)
sharpe = float(np.mean(port) * 252.0 / vol)         # mean * 252 / vol
max_dd = float(np.min(equity / np.maximum.accumulate(equity) - 1.0))
```

---

## 3. Results

### NEW — window-bounded convention (max-overlap window, THIS fixture)

Blend over `[2023-10-11, 2025-12-31]`, equal weight, **divisor === live-member
count === 6** (constant across the window):

| Metric | Raw (numpy, float64) | Engine payload (rounded) |
|--------|----------------------|--------------------------|
| window | `2023-10-11 → 2025-12-31` | `effective_start / effective_end` |
| member_count (divisor) | **6** | `member_count` |
| n (trading days) | **581** | `n` |
| total return (twr) | `1.1567855193398886` (**+115.68%**) | `1.15679` |
| CAGR | `0.3956732067196249` (**39.57%**) | `0.39567` |
| volatility (ann.) | `0.11463143681939332` | `0.11463` |
| Sharpe | `2.9673497576496706` (**2.967**) | `2.967` |
| MaxDD | `-0.06029498416617718` (**−6.03%**) | `-0.06029` |

`computeScenario` reproduces every one of these to floating-point precision
(`toBeCloseTo` at the payload's own decimals — 5 for twr/cagr/vol/maxDD, 3 for
Sharpe; the raw TS and numpy series agree to ~1e-10 before rounding). Verified by
`src/lib/scenario-blend07.test.ts` — **green**.

### OLD — union / tail-dilution convention (real 6-strategy prod audit, for CONTRAST)

From the ADR-001 verification session (2026-07-01) on the **real** production
6-strategy book — the convention this milestone REPLACES:

| Metric | OLD union value |
|--------|-----------------|
| total return | **+586.86%** |
| CAGR | **51.82%** |
| Sharpe | **2.43** |
| MaxDD | **−15.15%** |
| n | **1163** |

> The OLD numbers are on the real prod dataset over the full **union** span
> (n=1163) with the divisor stuck at 6 through the ended tail; the NEW numbers
> above are on the **synthesised** fixture over its intersection window (n=581).
> They are NOT the same dataset — the OLD row is preserved verbatim from the prod
> audit purely to document the CONVENTION contrast. The intended effect is that a
> window can no longer extend past the earliest-ending member without explicitly
> dropping it, so an ended strategy stops diluting the mean toward zero
> (`computeScenario` matched the OLD numpy blend to fp precision too — ADR-001:21 —
> so the current math was never a bug; the defect was the convention).

---

## 4. The divisor === live-member-count invariant

The gate asserts, over the derived max-overlap window:

- `member_count === 6` and `member_ids === [mm, neon1, pokeokx, uc244, okx, bybit]`
  — the divisor equals the **visible live membership**, not the started-strategy
  count (BLEND-06 tie-in).
- **Anti-dilution proof:** extending the window to the union end (`2026-06-16`)
  drops `pokeokx` from the divisor (`member_count === 5`, `member_ids` excludes
  `pokeokx`). Under the OLD convention it would have stayed counted-and-zero-filled,
  diluting the tail. This is the exact behavior v1.5 exists to deliver.

---

## 5. Reproduce

```bash
analytics-service/.venv/bin/python analytics-service/scripts/gen_blend07_fixture.py
npx vitest run src/lib/scenario-blend07.test.ts
```

The generator is idempotent (fixed RNG seeds) — re-running rewrites a
byte-identical fixture. If the fixture is ever regenerated with different
parameters, update BOTH the `NUMPY` oracle in `scenario-blend07.test.ts` AND the
Results table above in the same commit.

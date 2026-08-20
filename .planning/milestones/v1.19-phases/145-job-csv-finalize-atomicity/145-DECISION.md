# 145-DECISION.md — Founder caller decision (D-06, founder ruling 2 discharged)

**Selected: (i-b) — the route calls the folded RPC directly (the CONTRIB-02 shape, for both paths).**

Decided by the founder 2026-08-17 via blocking AskUserQuestion checkpoint (145-02 Task 3),
fed by the completed measurement — never assumed by a plan.

## The measurement table presented (145-MEASUREMENT.md §4, verbatim)

| Quantity | Value |
|---|---|
| Series payload (5000 rows, envelope+series) | 280,260 B |
| (i-a) NEW seam crossings for the rows | +1 (Next→Railway) |
| (i-b) NEW seam crossings for the rows | **0** (keeps today's single Next→PostgREST hop) |
| Upload+parse of the 280 KB body (HEAD model, lower bound) | ≈ 3.1 ms |
| Upload+parse with (i-a)-declared per-row field | ≈ 4.4 ms |
| (i-a) network leg (cross-provider, 280 KB) | UNMEASURED — no TEST Railway exists; PROD probing pre-banned |
| Full-cap persist delta (5000 vs 10 rows, live) | ≤ noise (−114 ms on ~2.9 s totals) |
| Live route totals (10 / 5000 rows) | 2966 / 2852 ms |

Latency was retired as an axis by the measurement (every measurable quantity is single-digit
milliseconds against ~3-second route totals); the choice was made on architecture.

## Rationale (as presented and selected)

- **Window A ceases to exist** — hop 0 (the Next→Python HTTP boundary) is removed from the
  finalize path entirely; with the fold, windows A/B/C/D all collapse into one transaction.
- **Two writers converge on one** route-side caller; the CONTRIB-02 path is the working
  existence proof of the shape.
- **Zero new seam payload** — the rows keep the single Next→PostgREST crossing they make
  today, now as an argument of the folded RPC. Notably, the only unmeasured quantity in the
  table (the cross-provider network leg) exists ONLY under (i-a); (i-b) does not depend on it.

## Obligations this decision creates (Plans 04/05 implement; none are optional)

1. Phase 106 Stage B's "unified backbone is the sole finalize path" ruling is REVERSED for
   this flow — recorded here as a conscious reversal, not drift.
2. The Python csv-finalize branch (`process_key.py` csv/finalize arm) becomes dead code and
   MUST be deleted in the same phase, with its tests re-pointed — leaving it live is a
   second writer and a drift bomb.
3. Plan 04's caller wiring implements EXACTLY this option; Plan 03's migration is
   caller-agnostic and unaffected.

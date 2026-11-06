---
phase: 160-provenance-the-server-s-venue-is-the-venue-that-annualizes
plan: 06
status: complete
completed: 2026-08-23
requirements: [RANK-04]
---

# Plan 160-06 Summary — golden-parity re-annualization: RECORDED NO-OP

Artifact: `160-PARITY.md`, landed in PR #704 (`ae53d3cd`).

## Outcome

**Zero candidates.** No strategy required golden-parity re-annualization, so the plan
discharges as a recorded no-op rather than a skipped step.

## The census line it rests on

`160-CENSUS.md` Query 2 (read-only against PROD `khslejtfbuezsmvmtsdn`, 2026-08-23)
returned **zero rows**: no strategy is linked to an un-attested key, so none can carry a
stamp that disagrees with its venue-derived expectation.

This follows necessarily from the artifact's anti-vacuity control: `attested_venue IS NULL`
matches 0 of 31 rows across the whole table, so Q2's JOIN has no left side for any linkage.
There are zero `stamped <> venue_derived` rows **because there are zero un-attested keys**,
not because the comparison was skipped. The population is real — 31 rows spanning
2026-04-05 → 2026-08-21, all satisfying `attested_venue = exchange`.

Re-confirmed post-REVOKE: 31 rows, 0 un-attested, 31/31 coherent.

## Expected-delta math, pinned anyway

Recorded even though no strategy needed it, so a future re-annualization has an oracle that
predates it rather than one derived from the implementation being checked:

| Metric class | Effect of a `traditional` → `crypto` stamp change | Why |
| --- | --- | --- |
| RISK — Sharpe, Sortino, volatility | scales by **√(365/252) ≈ 1.2039** | annualization is a FREQUENCY operation |
| RETURN — CAGR, cumulative return | **MUST NOT MOVE** | CALENDAR quantities; elapsed year is elapsed year |

(#597: RISK = frequency, RETURN/CAGR = calendar. A re-annualization that moved CAGR would
be evidence of a different bug.)

## Scope statement

No strategy was re-annualized. No `UPDATE` was issued against `strategies.asset_class` or
any analytics table by this plan. No backfill, bounded or otherwise, was run.

## What would re-open this

Any future census finding Q2 rows where `stamped <> venue_derived` — meaning an un-attested
key acquired a linked strategy whose stamp disagrees with its venue. At that point the
artifact gains a candidate table and per-strategy before/after snapshots, and the deltas
above become the adjudication oracle.

Note that after PR-2 the un-attested inflow is closed at the source: the browser can no
longer create `api_keys` rows, and the server writer stamps `attested_venue` on every
INSERT. New un-attested rows are no longer reachable through a client path.

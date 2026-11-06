# Phase 160 — Golden-parity re-annualization record (RANK-04 / D-09)

**Artifact:** `160-PARITY.md` (plan 160-06)
**Authored:** 2026-08-23
**Outcome:** **RECORDED NO-OP — zero candidates.**

## What this artifact discharges

ROADMAP 160 SC-4 requires that, *if the census finds affected strategies*, their
re-annualization gets golden-parity treatment: an old-vs-new metric snapshot with every
delta explained. D-09 bounds it to the census-identified rows — per-strategy, never a
blanket backfill.

The census found none. This file records that, with the citation, rather than leaving the
obligation silently unmet. A no-op that is never written down is indistinguishable from a
step that was forgotten.

## The census line this rests on

From `160-CENSUS.md` (executed read-only against PROD `khslejtfbuezsmvmtsdn`, 2026-08-23):

> **Query 2 — affected strategies (the golden-parity candidate list): ZERO ROWS.**
> No strategy is linked to an un-attested key, so no strategy can carry a stamp that
> disagrees with its venue-derived expectation.

The candidate predicate is exactly `stamped <> venue_derived` over rows where
`attested_venue IS NULL`. The anti-vacuity control in the same artifact establishes that
this is a **measured** zero rather than an empty table: `api_keys` holds 31 rows spanning
2026-04-05 → 2026-08-21, and **all 31** carry a non-NULL `attested_venue` satisfying
`attested_venue = exchange`. With `attested_null = 0` across the whole table, Q2's JOIN has
no left side for any linkage — so the comparison did not merely fail to fire, it had nothing
to fire on.

## The expected-delta math, pinned anyway

Recorded even though no strategy needs it, because the number is the thing a future
re-annualization would be checked against, and deriving it after the fact invites deriving
it from the implementation:

| Metric class | Effect of a `traditional` → `crypto` stamp change | Why |
| --- | --- | --- |
| RISK — Sharpe, Sortino, volatility | scales by **√(365/252) ≈ 1.2039** in the direction the stamp moved | annualization is a FREQUENCY operation: √periods_per_year |
| RETURN — CAGR, cumulative return | **MUST NOT MOVE** | these are CALENDAR quantities; the elapsed year is the elapsed year regardless of how many bars sampled it |

(#597: RISK = frequency, RETURN/CAGR = calendar. A re-annualization that moved CAGR would be
evidence of a different bug, not of the stamp change.)

## Scope statement

No strategy was re-annualized. No `UPDATE` was issued against `strategies.asset_class` or
any analytics table by this plan. No backfill, bounded or otherwise, was run.

## What would re-open this

A future census (for example the pre-REVOKE re-measure addendum in plan 160-05, or any
re-run after PR-2 lands) finding one or more Q2 rows where `stamped <> venue_derived`. That
would mean an un-attested key acquired a linked strategy whose stamp disagrees with its
venue — at which point this file gains a candidate table and per-strategy before/after
snapshots, and the deltas above become the adjudication oracle.

---

*Phase: 160-provenance-the-server-s-venue-is-the-venue-that-annualizes*
*Plan: 160-06 — discharged as a recorded no-op on the 160-CENSUS.md Q2 result*

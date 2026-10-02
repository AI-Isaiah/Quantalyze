# Phase 162 — CONTEXT (founder decisions)

Source: the four open decisions raised by `162-RESEARCH.md` (OD-1..OD-4), put to
the founder 2026-08-25 and answered. Recorded here rather than via discuss-phase
because the questions were already asked and answered in-session; this file is
the record, not a reconstruction.

## D-162-1 — Example-strategy repair (OD-1, couples to HONEST-03)

**DECIDED: recompute the 15 example rows to terminal success.**

The rows have been `failed` since 2026-05-27. #712 (`STALE-01`) stopped them
advertising a false "Synced" badge, so discovery is honest but badge-free. The
three-month failure is the bug; unpublishing would hide it.

**Fence:** if the rows cannot be recomputed, that is a finding — fall back to
unpublishing and say so. Do NOT synthesize values to make them look computed.

## D-162-2 — Flat-account factsheet copy (OD-2, HONEST-02)

**DECIDED: add a series-recency line — "Track record through {date}".**

Applies only if the HONEST-02 investigation concludes the account is genuinely
flat rather than suffering a derive gap. The line is literally true whatever the
cause, needs no threshold, and cannot mislead at a boundary the way a demote-past-N-days
rule does. Additive: existing badge logic is untouched.

**Fence:** DESIGN.md governs the visual. This is UI-SPEC territory.

## D-162-3 — Orphaned-key scope (OD-3, HONEST-06)

**DECIDED: full — add a use-existing-key server path.**

Preselect must work for every key, including `KEY_ORPHANED` ones. The minimal
draft-only option leaves "Finish setup →" an unwinnable loop for exactly the
users it was added to help — a user-facing lie, which is what this phase exists
to remove. Also closes the 161-recorded "manager cannot release their own
orphaned key" gap for the create direction.

**Fence:** this touches the service-role writer boundary (ADR-0001/0003
territory) and must carry that review. It is the one item in this phase with a
security-boundary blast radius.

## D-162-4 — Raw-exception strictness (OD-4, HONEST-01)

**DECIDED: strict — map the prefixed-`scrubbed` writers too.**

A prefixed suffix still puts exception text in front of a user, so it violates
the goal as written. Fixed copy per typed arm; raw detail to logs only.
~15 call sites rather than 3 — accepted deliberately to close the whole class,
because the point-fix shape is what lets a future writer reintroduce it.

## Standing constraint carried into every task

⚠️ Widening `/returns` (HONEST-05) or wiring equity curves (HONEST-04) WITHOUT the
`isRankableAnalyticsRow` gate re-opens the STALE-01 class that #712 hotfixed days
ago. Research pinned this as the phase's top pitfall. Any task touching either
surface must show the gate is applied, not assume it.

## Premise correction the planner must honour

HONEST-03's headline symptom (stale "Synced Nd ago" badges on discovery) **no
longer reproduces** — #712 closed it across eleven surfaces. What remains under
HONEST-03 is D-162-1's data repair plus an optional `is_example` class guard.
Do not re-plan the badge fix; it is live in PROD.

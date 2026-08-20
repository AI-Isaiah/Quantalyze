# Plan 136-05 — SUMMARY

**Status:** human_needed (NOT executed — blocking human-verify checkpoint; parked with runbook)
**Date:** 2026-07-23
**Autonomous:** false

## Outcome

Plan 136-05 is a `checkpoint:human-verify` (blocking, `autonomous: false`) that locks the exact
classification of the AMBIGUOUS `DEAL_TYPE` middle. It was **not executed** in the autonomous
run — recorded as `human_needed`, not done.

## Why deferred

The exact PnL/cost/external-flow/excluded classification of these `DEAL_TYPE_*` values is
broker-specific and cannot be settled without observing real deal rows from a live broker demo
account (the Phase-134 human_needed spike). They are `[ASSUMED]`:

| DEAL_TYPE | Current (safe) handling | Needs founder/live decision |
|-----------|-------------------------|-----------------------------|
| CHARGE | FAIL LOUD (unknown → `Mt5DealClassificationError`) | cost vs external-flow? |
| INTEREST | FAIL LOUD | realized cost vs excluded? |
| CANCELED | FAIL LOUD | exclude (net-zero)? |
| DIVIDEND | FAIL LOUD | realized PnL vs external-flow? |
| TAX | FAIL LOUD | realized cost? |
| CORRECTION | FAIL LOUD (permanent — the deribit lesson) | stays fail-loud |

Also parked: A2 (broker server-time→UTC offset confirmation) and A3 (the deal fold-rule) — both
pending the live spike.

## Why this does NOT block the phase goal

The buildable reconstruction path is SAFE by construction: any unlisted/ambiguous `DEAL_TYPE`
raises `Mt5DealClassificationError` and fails the whole job LOUD (136-01) — it is never silently
mis-folded into a return or a flow. So an account whose ledger contains only the verified types
(BUY/SELL/BALANCE/CREDIT/BONUS + the fail-loud CORRECTION) reconstructs correctly and earns
`api_verified` TODAY. The checkpoint only widens the *admitted* type set once the founder confirms
each ambiguous type's economic meaning against real data.

## What the founder does

When the Phase-134 live spike runs against a demo account: capture the actual `DEAL_TYPE` values
present in the deal ledger, decide each ambiguous type's classification, and add them to the
`services/mt5_deals.py` allow-list (with a hand-derived oracle per added type). Until then they
correctly fail loud.

## Resume

`/gsd:execute-phase 136 --wave 3` after the live spike, or edit `services/mt5_deals.py`
classification tables directly with the founder's confirmed mapping + oracles.

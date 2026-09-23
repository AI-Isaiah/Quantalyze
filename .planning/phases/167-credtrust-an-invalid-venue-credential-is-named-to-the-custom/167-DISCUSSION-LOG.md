# Phase 167 — Discussion Log

**Date:** 2026-09-22
**Mode:** Autonomous. Human reference only — downstream agents read `167-CONTEXT.md`, not this file.

## How this run was conducted, and the one deliberate departure

`/gsd-discuss-phase` normally puts gray areas to a human via `AskUserQuestion` and deep-dives the
selected ones. **No human was present in this session**, so an `AskUserQuestion` would have hung the
run rather than gathered an answer. The invocation stated this and delegated ordinary design calls.

The resolution rule was therefore borrowed from the workflow's own `--auto` mode
(`workflows/discuss-phase/modes/auto.md`): resolve every gray area from measured evidence and record
the evidence, rather than ask. This matches what `164.6.5-CONTEXT.md` and `164.6.6-CONTEXT.md` did.
The literal `--auto` token was NOT passed, so `auto_advance` was suppressed: this run ends at a
committed `CONTEXT.md` and does not chain into `/gsd-plan-phase`.

⛔ What was NOT done under that rule: no founder-owned decision was manufactured, and no genuinely
open one was closed to look complete. Exactly one decision (D-11) is left open, and the log below
says why.

## Areas analysed, and how each resolved

| # | Area | Resolved by | Outcome |
|---|---|---|---|
| 1 | Is the blocking dependency actually satisfied? | `164.7-07-SUMMARY.md`, `164.5.1-09-SUMMARY.md`, `scripts/prod-prober/cron-manifest.json` | D-01, D-02 — YES, but not by the phase the ROADMAP credits |
| 2 | Can staleness alone accuse a credential? | the ROADMAP's own counter-example + the dormancy gate in the fan-out body | D-03 — no; conjunction required |
| 3 | Which surface carries the cause? | the id-only `unstable_cache` in the factsheet route + the share route's SECURITY BOUNDARY header | D-04 — owner lanes only, rated one-way |
| 4 | Is a Python string change enough? | `AllocatorSyncStatus`'s `error` arm; `RECOVERABLE_ACTIONS` / `buildEnvelope` | D-05 — no, twice over |
| 5 | Which wizard code to route at? | the copy of `KEY_MUST_BE_RECONNECTED` and `KEY_AUTH_FAILED` read verbatim | D-07 — mint new; copy the shape, not the entry |
| 6 | Is suppressing Retry justified, or just prescribed? | the `-10005` modal-dialog mechanism + 164.6.5/164.6.6 findings on the shared terminal | D-08 — affirmatively correct |
| 7 | Where does venue-agnosticism live? | the *"retry automatically"* copy family in `allocator_positions.py`; `classify_exception` | D-09, D-10 |
| 8 | New `sync_status` value or reuse `revoked`? | the CHECK constraint history + the two `!== 'revoked'` filters | **D-11 — LEFT OPEN** |
| 9 | Notification channel? | the ROADMAP's own "in the product" wording + the existing rotation-reminder cron | D-14 — deferred |

## Why D-11 is the only one left open

Its arms are not merely different in effort, they differ in KIND:

- Arm A (reuse `revoked`) is the cheapest to write and has two measured side effects nobody asked
  for — it hides the key's holdings from the allocator dashboard and stops enqueueing its refresh —
  because `revoked` is read as a filter in two places, not only as a label.
- Arm B (mint a value) is a `CHECK` constraint migration that auto-applies to PROD, needs three
  reviewers before apply, and has a silent-failure mode: an unrecognised `sync_status` falls back to
  a neutral idle pill, so a half-done rollout renders a broken key as healthy.
- Arm C sidesteps both and costs a second source of truth.

That is a founder-shaped call with a one-way arm, and inventing an answer for it under an autonomous
rule would be exactly the failure the rule exists to avoid. It is rated and costed in CONTEXT.md so
the planner can put it behind a `checkpoint:decision` rather than re-research it.

## Corrections made during the run

- **My own inherited reading of the dependency was wrong and was corrected against the record.**
  I entered believing 164.7 being `Complete` with `status: passed` meant its plan 07 had activated
  the ledger refresh. `164.7-07-SUMMARY.md` says the opposite — the activation was DEFERRED at the
  founder gate. The activation is real, but it belongs to 164.5.1 plan 09. Had I stopped at the
  phase status, the ROADMAP's attribution error would have been carried forward into the plans.

## Scope creep redirected

Four ideas were captured and NOT acted on: proactive notification, the ROADMAP attribution fix, a
liveness assertion on the ledger-refresh flag, and de-duplicating the twin
`_map_exception_to_sync_status` tables. All are in `<deferred>` with the reason.

## What no tool could settle here

⛔ No database command may be run from this checkout — its Supabase CLI is linked to PRODUCTION. So
`system_flags.ledger_refresh_enabled` was NOT re-read at discussion time; the live evidence is a
manifest captured from PROD on 2026-09-18 and the execution record of the session that set it.
That limit is itself recorded as D-02 and as a deferred item, rather than papered over.

# Phase 96 — Deferred Items

Surfaced during the Phase-96 review cycle (verifier + data-safety + fable red
team) and intentionally NOT fixed in Phase 96.

## D-1 — READ COMMITTED check-then-delete race in the api_keys sweep
**Severity:** LOW · **Source:** fable red team (F-1) · **Status:** deferred (pre-existing class, disproportionate fix)

`cleanup_abandoned_wizard_drafts()` step 3 evaluates the 3× `NOT EXISTS`
anti-joins against the DELETE statement's snapshot. A key K, member of a ≥7-day
doomed draft (candidate-captured), could be swept even if — concurrently, while
the 02:00 cron runs — the owner attaches K to a FRESH draft in a transaction
that commits after the sweep's snapshot but before its DELETE resolves: the
DELETE blocks on the FK KEY SHARE lock, the attach commits, the DELETE resumes,
and Postgres does NOT EvalPlanQual-recheck the anti-joins (the `api_keys` tuple
itself was never updated), so K is deleted → `strategy_keys` CASCADE erases the
just-committed membership / `strategies.api_key_id` SET NULL, and the encrypted
credential is gone (user must re-enter the key).

**Why deferred:** (a) the window is milliseconds, once per day; (b) it is a
PRE-EXISTING class — the old SELECT-then-DELETE cron route had the same race;
(c) published composites are safe (the BEFORE DELETE guard's trigger query gets
a fresh snapshot and fails loud); the exposure is only the unguarded
draft/pending set, and it's recoverable (re-enter the key). The only real fix —
run the sweep SERIALIZABLE, or re-verify refs after taking a row lock on the
candidate keys — is disproportionate for a ms-window, recoverable, pre-existing
race on a just-gated destructive function. No single-session SQL test can pin it.

**Fix direction (if ever picked up):** `SET TRANSACTION ISOLATION LEVEL
SERIALIZABLE` for the sweep, or `SELECT … FOR UPDATE` the candidate keys before
the anti-join DELETE so a concurrent attach serializes.

## D-2 — Correlation id not server-logged on every wizard route
**Severity:** LOW · **Source:** fable red team (F-2), partially fixed · **Status:** residual deferred

UX-02 makes the client SEND `X-Correlation-Id` on all 11 wizard fetch sites and
DISPLAY it in error envelopes; the composite error routes (`composite/members`,
`composite/set-members`) now LOG the inbound id on their error paths (fixed,
commit `dc4cc47d`). Residual: the broader set of wizard-hit routes that already
prefer the inbound header via `getCorrelationId()` do so only where explicitly
wired (`keys/sync`, `csv-finalize`, `validate-and-encrypt`); a fully uniform
"every wizard route logs the inbound id" pass is a broader cross-cutting task,
not Phase-96 scope. `sync-progress` was intentionally excluded (its only failure
degrades to a 200, so it never shows the user an id to match). No dead-end
remains on the surfaces that display an id to the user.

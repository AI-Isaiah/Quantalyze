# Phase 153.2 — deferred / out-of-scope discoveries

Items found during execution that are **not** this phase's plans to fix. Logged rather than
fixed, per the scope-boundary rule.

## D-153.2-A — `WIZFORM-01` is ticked in REQUIREMENTS.md while its traceability row still reads "Pending"

**Found:** 153.2-02 execution (state-update step), 2026-08-09.
**Where:** `.planning/REQUIREMENTS.md:656` (checkbox `[x]`) vs `:1087` (table row `Pending`).

`153.2-03`'s completion run (commit `6c409d96`) flipped the `WIZFORM-01` checkbox to `[x]`
but the traceability table row was not moved off `Pending`, so the two statements about the
same requirement now disagree.

Separately, both 153.2-01 and 153.2-02 recorded the *opposite* call in `STATE.md`
(decision at `:547`): **WIZFORM-01 is deliberately not complete** until `153.2-05` lands the
server-side field-level code → field routing, since a field-level rejection that still
arrives from the server is exactly the failure the requirement describes.

**Why not fixed here:** un-ticking a sibling plan's requirement mark mid-phase is a
cross-plan decision, and 153.2-02 did not run `requirements mark-complete` for that reason.

**Owner:** whoever closes `153.2-05` — either tick both statements then, or un-tick the
checkbox now and tick both at the end. One of the two, not a blend.

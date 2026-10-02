# Phase 19 — Customer-Signal Gap (Theme 4 / BACKBONE-10 exit gate)

**Date:** 2026-06-20
**Decision:** Ship PR-D (verification_requests VIEW-shim) WITHOUT the customer-feedback exit gate.

## Why the gate is unmet

`customer-feedback.md` requires ≥1 verbatim entry from an onboarding team that ran
a real key submission through the unified flow. There are **no onboarding teams /
clients yet**, so there is no qualitative signal to capture. The gate cannot be
satisfied by construction at this stage.

## Policy basis

Theme 4 thresholding (mirrors the Phase 15 entry-gate language): below 1 feedback
entry, log the gap here and ship anyway. All *automated* soak gates are green:

- 168h soak COMPLETE (~620h elapsed since flip 2026-05-25T15:51:07Z)
- 0 writes to legacy `verification_requests` since the flip
- 14/7 daily error-rate rows recorded, max 0.0% (< 0.5% threshold)
- prod preconditions re-verified on apply day (BASE TABLE, sanitize_user
  un-repointed, 9 VIEW columns present, M-5 count 0)

## Follow-up

When the first onboarding team runs a real submission post-shim, capture their
verbatim feedback in `customer-feedback.md` and note any defect the live VIEW path
surfaces. The shim has a tested rollback (`supabase/migrations/down/20260620120000-rollback.sql`)
if a real defect appears.

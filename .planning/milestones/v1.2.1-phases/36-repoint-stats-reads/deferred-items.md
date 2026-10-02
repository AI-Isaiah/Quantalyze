# Phase 36 — Deferred Items / discoveries

## RESOLVED in-phase

### DEFER-36-02-01 — `gdpr-export-schema.test.ts` fails on `csv_daily_returns` surrogate `id` PK ✅ RESOLVED

**Found during:** 36-02 Task 2 regression check.
**Resolved by:** commit `e347fdbb` (post-merge integration fix), option 1.

The Phase 35 per-key-axis migration replaced `csv_daily_returns`' composite PK with a
surrogate `id BIGINT IDENTITY`; 36-01 reflected that in `database.types.ts`, which tripped
the schema test's "ORDER_COLUMN_OVERRIDES holds only id-less tables" invariant. Fixed by
removing the now-obsolete `csv_daily_returns: "date"` override so `getOrderColumn` falls
back to the unique, NOT-NULL, total-order `id` (strictly more deterministic than the
non-unique `date`). Updated the three tests that pinned the old `date` ordering
(`gdpr-export-schema.test.ts`, `gdpr-export.test.ts`, `gdpr-export-per-key-dailies.test.ts`).
Verified: full GDPR suite + coverage hook + tsc green.

## DEFERRED (genuine — out of scope for Phase 36, no regression)

These were raised by the fresh-Claude adversarial review of the 36-03 repoint. The
CRITICAL (C1, revoked-key gate) and HIGH (H1, missing test) were FIXED in-phase
(commit `6ae38672`). The following are non-blocking and do NOT regress existing behaviour
(the snapshot fallback path has the identical characteristics):

### DEFER-36-M1 — all-zero-weight book yields a flat-zero curve (honesty edge)

If every eligible key's current holdings net to ~0 equity (e.g. an all-derivatives book
currently flat, `unrealized_pnl_usd ≈ 0`), `totalWeight === 0` → every key's normalised
weight is 0 → the blended curve is flat-zero with degenerate Sharpe, even though each key
has a genuine non-trivial per-key return series. **Not a regression** —
`liveBaselineMetricsFromHoldings` (the fallback) does the same. The per-key path *could*
be more honest here (it holds the real series; an equal-weight fallback when
`totalWeight===0 && strategies.length>0` would surface the signal), but that is a behaviour
choice with its own design questions (is equal-weight more "honest" than current-weight?)
and belongs in a follow-up, not mid-phase scope creep. Document + revisit if a
derivative-heavy allocator reports a flat Overview curve.

### DEFER-36-L1 — non-finite `daily_return` rows silently dropped (no telemetry)

`buildPerKeyReturnsByApiKeyId` drops rows where `!Number.isFinite(daily_return)` without a
Sentry warning. Defensive-only: the `csv_daily_returns.daily_return` column is NOT NULL
numeric, so the derive job cannot persist a NaN/Inf in normal operation — the drop never
fires in practice. Slightly inconsistent with the codebase's fail-loud posture (cf.
`getUserApiKeys` escalating dropped rows to Sentry). Low value; revisit only if the derive
job is ever observed emitting non-finite returns.

### Addressed in code (no separate deferral)

- **M2 / L2** (avgRho includes weight-0 keys) — documented inline at the weight assignment
  in `liveBaselineMetricsFromPerKeyDailies` (commit `6ae38672`); consistent with the
  holdings path. No behaviour change needed.
- **N1** (GDPR ordering `date`→`id`) — verified correct (IDENTITY is monotonic/total; no
  rows lost). Intended (see DEFER-36-02-01 resolution).

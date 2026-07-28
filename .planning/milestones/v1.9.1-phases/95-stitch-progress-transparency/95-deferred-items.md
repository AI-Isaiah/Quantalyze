# Phase 95 — Deferred Items

Items surfaced during the Phase-95 review cycle (verifier + security +
silent-failure-hunter + fable red team) intentionally NOT fixed in Phase 95.

## D-1 — Retry during a dead sync-progress channel + `failed_retry` backoff can double-enqueue a stitch
**Severity:** MEDIUM-LOW · **Source:** fable red team (F-3), residual after the client-only fix · **Status:** deferred (bounded blast-radius decision)

The composite `stitch_composite` retry (`/api/keys/sync` kickoff) is NOT idempotent
against a job in `failed_retry`: the partial-unique index (`20260416125430`) and the
in-flight SELECT in `_enqueue_compute_job_internal` (`20260510180226`) both EXCLUDE
`failed_retry`, while the claim picks up `pending` AND `failed_retry`
(`20260428155809`). A manual retry issued during a `failed_retry` backoff window
inserts a second job → the queue claims both → two full stitches.

**Closed for the common case (commit `14c4655a`):** the sync-progress route projects
`jobStatus`; when it is `failed_retry` the wizard relabels to "retrying
automatically" and SUPPRESSES the manual Retry button. So a user with a live channel
never sees a retry control during backoff.

**Residual (deferred):** if the sync-progress channel is DEAD (RPC outage / sustained
429) AND the job is simultaneously in a `failed_retry` backoff window (30 s–2 min) AND
the user clicks the FIX-1 backstop retry in exactly that window, the client has no
`jobStatus` to suppress on → the double-enqueue can still occur.

**Why deferred, not fixed now:** the only complete fix (Option a) is to make the
shared enqueue idempotency treat `failed_retry` as in-flight — either widen the global
partial-unique index or the in-flight SELECT. That path governs EVERY compute_jobs
kind (single-key sync, intro snapshots, admin jobs, composites), so changing it for
this narrow composite edge is disproportionate blast radius. Today (single Railway
worker) the consequence is duplicate heavy stitch work + a post-completion status
churn — NOT data corruption. It becomes a genuine `csv_daily_returns`
delete→re-upsert race only once worker replicas > 1.

**Trigger to pick this up:** BEFORE scaling the analytics worker beyond one replica.
Fix direction (Option a): in the composite kickoff of `/api/keys/sync`, before
enqueuing, reset an existing `failed_retry` `stitch_composite` job to `pending` with
`next_attempt_at = now()` (nudge-in-place) instead of inserting a duplicate — bounded
to the composite path, avoiding the global index. The false "no-op by the
partial-unique index" T-95-09 comments were already corrected in `14c4655a`.

## D-2 — `p_limit:20` window in `get_user_compute_jobs` could hide a running stitch
**Severity:** LOW (INFO) · **Source:** security review (L4) · **Status:** deferred (unreachable in practice)

The sync-progress route reads the 20 newest jobs of ALL kinds for the strategy; if ≥20
newer non-composite jobs existed, the latest `stitch_composite` could fall outside the
window → route reports idle (false-negative UX, not a disclosure). Unreachable in
practice: a wizard-phase composite has essentially one stitch job and it is among the
newest. Note if the job-mix per strategy ever grows.

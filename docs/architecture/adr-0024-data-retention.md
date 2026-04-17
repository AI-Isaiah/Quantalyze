# ADR-0024: Data retention policy — two-stage audit archive + per-table thresholds

## Status
Accepted (shipped in Sprint 6 closeout Task 7.3)

## Context
Sprint 6 closeout Task 7.3 automates GDPR Art. 17 deletion (via
`sanitize_user`) and GDPR Art. 15 export (via `collectUserExportBundle`).
Alongside those user-facing data-subject operations, the product needs
a locked **retention policy** for rows that are NOT deletable on demand:

1. **audit_log** — tamper-proof forensic record of user-attributable
   actions. Needed for SOC2 and for internal compromise investigations.
   Cannot be deleted by a user's "forget me" request (the DB-layer
   deny policies in migration 049 + ADR-0023 §6 make this structural).
   But unbounded growth is operationally untenable and legally
   unnecessary — we need a retention horizon.
2. **notification_dispatches** — outbound email / notification ledger.
   Contains recipient_email as PII.
3. **compute_jobs** — durable job queue rows. Non-PII but operationally
   unbounded if not pruned.

Prior state: migration 010 created these tables but no retention policy
existed. audit_log rows from the alpha period would survive forever;
notification_dispatches would accumulate every outbound email since
launch; compute_jobs rows from 2024 queue runs would sit in `status='done'`
indefinitely.

### Regulatory grounding
- **SOC2 CC7.2** requires logs retained long enough to investigate
  incidents. Industry baseline is 1–3 years for most control families;
  7 years for financial auditing. We pick **7 years** for audit_log to
  cover the worst-case (IRS / SEC-adjacent) baseline.
- **GDPR Art. 5(1)(e)** — storage limitation. Personal data must not be
  kept in an identifiable form for longer than necessary. The
  `sanitize_user` function (migration 055) anonymizes on deletion
  request, but we also proactively purge long-cold logs to minimize
  the standing PII surface.
- **GDPR Art. 17 interaction** — anonymized rows are NOT "erased" in the
  regulation's strict sense (the row still exists), but the regulation
  permits pseudonymization as a compliance mechanism provided the
  anonymization is irreversible. Our retention policy applies to
  anonymized rows too: post-`sanitize_user`, the profile's `display_name`
  is `'[deleted]'` and the attribution is severed, but audit_log rows
  still reference the stable `user_id` UUID. At 7 years the audit rows
  are purged entirely via this retention policy — closing the residual
  PII association.

## Decision

### 1. Per-table retention windows

| Table | Threshold | Action | Cron job |
|-------|-----------|--------|----------|
| `audit_log` (hot) | 2 years | Move to `audit_log_cold` | `audit_log_hot_to_cold` |
| `audit_log_cold` | 7 years total (5y in cold) | DELETE | `audit_log_cold_purge` |
| `notification_dispatches` | 180 days | DELETE | `retention_notification_dispatches` |
| `compute_jobs` status=`done` | 30 days | DELETE | `retention_compute_jobs_done` |
| `compute_jobs` status IN (`failed_final`,`failed_retry`) | 90 days | DELETE | `retention_compute_jobs_failed` |

Thresholds are measured against `created_at` for every table. `created_at`
is the row's birth and is monotonic; using a claim/update column would
let a long-retried job outlive its successful ancestor by minutes.

### 2. Two-stage audit_log retention — hot + cold archive

The `audit_log` table has TWO retention thresholds, not one. This is the
key novel decision in this ADR:

- At **2 years**, rows move from `audit_log` (hot) to `audit_log_cold`.
  The move is INSERT-then-DELETE inside a single pg_cron command
  transaction, with `ON CONFLICT (id) DO NOTHING` on the INSERT so a
  crash+retry is idempotent. The row's `id` and `created_at` are
  preserved, so identity and birth-time survive the archival.
- At **7 years** (5 years in cold, measured from the same `created_at`),
  the cold row is DELETEd.

**Why two-stage rather than a single 7y DELETE?**

1. **Query locality for the common case.** 98%+ of audit queries are
   for recent activity (the user's own "Security" page showing
   past-90-days-of-my-events; the admin compute-jobs dashboard showing
   past-30-days-of-failures). Keeping the hot table small (≤2y of rows)
   makes those queries cheap via the existing `idx_audit_log_user` and
   `idx_audit_log_entity` indexes. A single 7y-hot table would grow
   unbounded and every owner-read would pay the planner cost.
2. **Planner-friendly partition analog.** Postgres native partitioning
   would be cleaner, but requires a more invasive migration (ALTER
   TABLE ... PARTITION BY RANGE, swap, backfill). The hot+cold split
   gives 80% of the query-locality benefit with a non-invasive migration
   — and if we later decide to move to native partitioning, migrating
   from hot+cold → partitioned is a straight data copy.
3. **Compliance safety.** Splitting into a separate cold table with
   ITS OWN append-only invariant means a bug in the hot-purge step
   can't accidentally destroy cold evidence — the two retention
   thresholds are independent. The 7y cold-purge requires superuser
   (postgres, running as pg_cron) to fire; there is no user-level or
   service_role-level path that can reach into the cold archive.

### 3. Cold archive location

The cold archive lives **in the same Postgres database**, not in S3 or
another object store.

- **Pro**: preserves RLS (owner + admin SELECT continues to work for
  2y-old-but-still-recent rows without custom storage glue).
- **Pro**: operational single-surface — one set of backups, one set of
  credentials, one monitoring dashboard.
- **Pro**: at our current and projected volumes (~100K audit rows/year
  under Sprint-6 instrumentation, ~10MB/year on disk), a 7-year cold
  table is ~70MB. Not meaningful at database scale.
- **Con**: paid Postgres storage is more expensive than S3 Glacier per
  byte. At our volume the delta is <$10/year — rejected.
- **Con**: a full-database compromise exposes cold rows alongside hot.
  The append-only deny policies (see §4 and ADR-0023 §6) apply equally
  to both tables, and a compromised superuser session can mutate either
  regardless, so the security posture doesn't differ from hot-only.

### 4. Append-only invariant spans both tables

Per ADR-0023 §6, the hot `audit_log` is append-only: `USING (false)`
deny policies + table-level `REVOKE UPDATE, DELETE`. The cold table
inherits the same policies and REVOKEs — see migration 056. The invariant
therefore holds for the full 7-year retention window: no PostgREST role
(not even service_role) can mutate or delete an audit row from either
table. Only superuser SQL — specifically, the `audit_log_cold_purge`
cron running as postgres — can DELETE, and only for rows older than the
7-year threshold.

### 5. Interaction with `sanitize_user`

When an admin approves a GDPR Art. 17 deletion request, the
`sanitize_user` RPC (migration 055) anonymizes the user's PII across
~25 tables. The `audit_log` table is explicitly in the PRESERVE column
of the matrix — migration 055 does NOT touch audit rows. The rationale:

- Audit rows contain `user_id` only (not PII directly). The anonymized
  `profiles` row makes that FK non-resolvable at the application
  layer.
- Migration 049's deny policies would refuse the UPDATE/DELETE even if
  `sanitize_user` tried — so the PRESERVE decision is enforced
  structurally, not by convention.

Retention policy applies to anonymized rows identically to non-anonymized
rows. A deleted-at-day-30 user has their audit rows moved to cold at
year 2 and purged at year 7, exactly like any other user.

### 6. Notification dispatches — 180d

`notification_dispatches.recipient_email` holds standing PII (the email
the message was sent to). 180 days is the sweet spot:

- Long enough to cover "why didn't user X get my email in February?"
  operator questions through the next quarterly review.
- Short enough that the standing PII surface is bounded — if the user
  deletes their account and we sanitize, any stale dispatch rows older
  than 180d are gone automatically.
- Matches the API-key-rotation-reminder's 60d + 90d cadence — a dispatch
  row from today's reminder is still visible for the next reminder's
  eligibility check 90 days out, then gone before the next rotation
  cycle.

### 7. compute_jobs — 30d / 90d

`compute_jobs` rows are pure operational observability (no PII).
Shorter retention is fine:

- **status='done'**: 30 days. The admin compute-jobs dashboard's
  retrospective queries rarely look back further than a month.
- **status IN ('failed_final','failed_retry')**: 90 days. Failures are
  more interesting than successes for root-cause; 90 days lets a
  quarterly incident review reach back that far.

### 8. Cron scheduling

All retention jobs run at 03:00 UTC (+/- 30 min for stagger). The slots
are:

| Time UTC | Job |
|----------|-----|
| 03:00 | `audit_log_hot_to_cold` |
| 03:05 | `audit_log_cold_purge` |
| 03:10 | `retention_notification_dispatches` |
| 03:20 | `retention_compute_jobs_done` |
| 03:30 | `retention_compute_jobs_failed` |
| 04:00 | `api_key_rotation_reminder` |

03:00 UTC avoids the 01:00 UTC match-engine cron (migration 015) and
falls in the lowest-traffic window for our users (early morning Europe,
late night Americas). Stagger between retention jobs prevents them all
competing for the same compute window. See ADR-0008 for the overall
cron architecture.

## Consequences

### Positive
- Audit retention is SOC2/compliance-defensible and bounded at 7 years.
- Hot-query locality is preserved as the table ages (hot table stays
  at ~2 years of data).
- Standing PII in notification_dispatches is bounded at 180 days.
- compute_jobs rows are pruned before they become a cost concern.
- `sanitize_user`'s PRESERVE-audit_log decision is reinforced by the
  retention policy's 7-year hard upper bound on residual PII association.
- Append-only invariant (ADR-0023 §6) applies to both hot and cold
  tables — no regression in tamper-proofness across the archival
  transition.

### Negative
- Two-stage retention is operationally novel; operators must remember
  that audit data older than 2 years is in `audit_log_cold`, not
  `audit_log`. Documented here, in migration 056, and in ADR-0023 §6 —
  but a cognitive overhead remains.
- The cold table doesn't have an explicit monitoring dashboard. If the
  hot→cold move starts failing (pg_cron crash, disk pressure), audit
  growth is silent until the hot table's size becomes noticeable. Tech
  debt: add a cron_runs-equivalent assertion in Sprint 7.
- Recovery of a 5-year-old audit row (e.g., a compliance auditor asks
  "what was this user doing in 2027?") requires a UNION query against
  both tables. The hot→cold move preserves `id` and `created_at`, so
  the UNION is straightforward, but no wrapper view exists today.
  Tech debt candidate.

## Evidence
- Migration 056: cold table + append-only policies + 6 cron jobs.
  `supabase/migrations/056_retention_crons.sql`.
- Migration 055: `sanitize_user` RPC and its PRESERVE-audit_log decision
  in the per-table matrix.
  `supabase/migrations/055_sanitize_user.sql`.
- Migration 049: hot-table append-only invariant (mirrored on cold).
  `supabase/migrations/049_audit_log_hardening.sql`.
- Migration 010: original `audit_log` table schema.
  `supabase/migrations/010_portfolio_intelligence.sql` (lines 66-75).
- ADR-0023: audit event taxonomy + §6 append-only invariant.
  `docs/architecture/adr-0023-audit-event-taxonomy.md`.
- ADR-0008: background job / cron architecture (context for the pg_cron
  mechanism used here).
  `docs/architecture/adr-0008-cron-architecture.md`.
- ADR-0017: deployment topology (Vercel + Supabase + Railway).
  `docs/architecture/adr-0017-deployment-topology.md`.

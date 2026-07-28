# PR-Y1 Schema State — corrected after sharp probes
Generated: 2026-05-15

## Goal of this audit
Confirm true schema state on prod (`khslejtfbuezsmvmtsdn`) and test (`qmnijlgmdhviwzwfyzlc`) for the 17 migrations that were missing from prod's `schema_migrations`. The original audit had buggy probes that produced false positives.

## True state matrix (sharp probes)

| NNN | Prod schema | Test schema | Action on prod |
|---|---|---|---|
| 047b used_ack_tokens | ✓ | ✓ | INSERT row only |
| 047c severity_critical | ✗ | ✓ | **APPLY** |
| 098 resend_message_correlation | ✗ | ✓ | **APPLY** |
| 107 verification_requests view shim | ✗ | ✓ | **APPLY** |
| 117 claim_token P97 fence | ✗ | ✓ | **APPLY (CRITICAL)** |
| 118 _enqueue ACL | ✓ | ✓ | INSERT row only |
| 119 positions_natural_key | ✗ | ✓ | **APPLY** |
| 120 sentinel triggers | ✗ | ✓ | superseded by 127 |
| 121 retention cron throttle | ✗ | ✓ | **APPLY** |
| 122 hot-to-cold admin gate | ✗ | ✓ | **APPLY** |
| 123 audit_log FK | ✗ | ✓ | **APPLY** |
| 124 data_deletion_requests FK SET NULL | ✗ | ✓ | **APPLY (P455 CRITICAL)** |
| 125 guard wizard auth.uid() | ✗ | ✓ | superseded by 127 |
| 126 guard wizard GUC bypass | ✗ | ✗ | superseded by 127 (skip on both) |
| 127 guard wizard current_user + LIKE sentinel | ✗ | ✓ | **APPLY** |
| 130 idempotency_keys table | ✓ | ✗ | INSERT row only on prod; **APPLY** on test |
| 131 commit_scenario_batch idempotency | ✓ | ✗ | INSERT row only on prod; **APPLY** on test |

## Execution order on prod (risk-ascending)

1. 047c — CHECK constraint widening (idempotent, no row impact)
2. 098 — CREATE TABLE IF NOT EXISTS (idempotent)
3. 123 — ALTER COLUMN NULL + ADD FK with SET NULL
4. 124 — ALTER FK CASCADE → SET NULL
5. 121 — STATEMENT triggers + cron.schedule (depends on pg_cron)
6. 122 — CREATE OR REPLACE function with role gate
7. 127 — CREATE OR REPLACE guard + reject_sentinel_writes + 4 triggers
8. 117 — ALTER ADD COLUMN + UPDATE backfill + 4 RPC replacements (largest)
9. 107 — ALTER RENAME table + CREATE VIEW + INSTEAD OF triggers + policies
10. 119 — UNIQUE constraint (must resolve dup groups first)

After 1–10 applied successfully, INSERT schema_migrations rows for:
- 047b, 118, 120, 125, 126, 130, 131

## Execution order on test (much smaller)

1. 130 — apply CREATE TABLE scenario_commit_idempotency
2. 131 — apply RPC signature change

## Open questions before applying
- pg_cron availability on prod (probe in flight)
- positions duplicate count on prod (probe in flight)
- Whether `apply_migration` MCP tool accepts DML statements (117 has UPDATE; might need fallback to execute_sql)

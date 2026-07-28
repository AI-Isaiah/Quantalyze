# PR-Y1 Audit Summary

Generated: 2026-05-15T11:13:46.873Z

Local files: 129
Test rows: 128
Prod rows: 122

## Classification counts

- clean: 103
- missing_in_prod: 15
- prod_duplicate_seq_and_ts: 9
- missing_in_test+missing_in_prod: 2

## Orphans (rows with no local file)

### Test orphans
- 20260513094906 / 121a_enable_pg_cron

### Prod orphans
- 20260430081243 / trades_dedup_fill_full_unique

## Synthesized new_version range

First: 20260405061911 (001_initial_schema)
Last:  20260515094801 (132_teaser_anchor_strategy)

## Files needing prod-side action

Total: 26

| NNN | Canonical | Classification | prod_seq | prod_ts |
|---|---|---|---|---|
| 047b | used_ack_tokens | missing_in_prod | - | - |
| 047c | severity_critical | missing_in_prod | - | - |
| 078 | equity_contract_size_healing | prod_duplicate_seq_and_ts | 078 | 20260424012820 |
| 079 | equity_defensive_heal | prod_duplicate_seq_and_ts | 079 | 20260424031238 |
| 084 | first_api_key_added_trigger | prod_duplicate_seq_and_ts | 084 | 20260426193121 |
| 085 | stamp_first_bridge_surfaced | prod_duplicate_seq_and_ts | 085 | 20260430055512 |
| 086 | compute_jobs_priority | prod_duplicate_seq_and_ts | 086 | 20260428120836 |
| 087 | strategy_analytics_series | prod_duplicate_seq_and_ts | 087 | 20260428120919 |
| 088 | cutover_strategy_metrics_keys | prod_duplicate_seq_and_ts | 088 | 20260428142831 |
| 089 | claim_failed_retry | prod_duplicate_seq_and_ts | 089 | 20260428155809 |
| 090 | claim_dedupe_partition_keys | prod_duplicate_seq_and_ts | 090 | 20260428190907 |
| 098 | resend_message_correlation | missing_in_prod | - | - |
| 107 | verification_requests_view_shim | missing_in_prod | - | - |
| 117 | compute_jobs_claim_token_fencing | missing_in_prod | - | - |
| 118 | enqueue_compute_job_internal_acl_remediation | missing_in_prod | - | - |
| 119 | positions_natural_key_remediation | missing_in_prod | - | - |
| 124 | data_deletion_requests_fk_set_null | missing_in_prod | - | - |
| 120 | sanitize_user_hardening | missing_in_prod | - | - |
| 121 | retention_crons_safe | missing_in_prod | - | - |
| 122 | test_force_hot_to_cold_audit | missing_in_prod | - | - |
| 123 | log_audit_event_service_hardened | missing_in_prod | - | - |
| 125 | guard_wizard_draft_updates_auth_uid | missing_in_prod | - | - |
| 126 | wizard_rpc_bypass_flag | missing_in_prod | - | - |
| 127 | redact_guc_bypass_use_current_user | missing_in_prod | - | - |
| 130 | idempotency_keys | missing_in_test+missing_in_prod | - | - |
| 131 | commit_scenario_batch_idempotency | missing_in_test+missing_in_prod | - | - |

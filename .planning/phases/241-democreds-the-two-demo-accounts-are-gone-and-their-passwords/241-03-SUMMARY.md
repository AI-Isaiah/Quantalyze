---
phase: 241-democreds-the-two-demo-accounts-are-gone-and-their-passwords
plan: 03
subsystem: records
tags: [security, one-way-delete, lane-rehearsal, SECR-01, PROOF-01]
requires: []
provides:
  - "the single-statement Pair B delete chain, proven fail-closed on the local-stack lane"
  - "census, existence and catalog queries and the admin-API delete that plan 04 replays on PROD"
  - "the lane catalog (strict md5 and lines) for plan 04's PROD comparison"
affects: [241-04]
tech-stack:
  added: []
  patterns: ["one DO statement with pinned ROW_COUNTs and in-block marker check", "census expect_* columns fill chain tokens one to one", "per-arm neuter, byte-restore (cp then cmp), re-run"]
key-files:
  created:
    - .planning/phases/241-democreds-the-two-demo-accounts-are-gone-and-their-passwords/241-PAIRB-chain.sql
    - .planning/phases/241-democreds-the-two-demo-accounts-are-gone-and-their-passwords/241-PAIRB-admin-delete.mjs
    - .planning/phases/241-democreds-the-two-demo-accounts-are-gone-and-their-passwords/241-PAIRB-lane-users.mjs
    - .planning/phases/241-democreds-the-two-demo-accounts-are-gone-and-their-passwords/241-PAIRB-fixture.sql
    - .planning/phases/241-democreds-the-two-demo-accounts-are-gone-and-their-passwords/241-PAIRB-rehearse.sh
    - .planning/phases/241-democreds-the-two-demo-accounts-are-gone-and-their-passwords/241-PAIRB-census.sql
    - .planning/phases/241-democreds-the-two-demo-accounts-are-gone-and-their-passwords/241-PAIRB-catalog.sql
    - .planning/phases/241-democreds-the-two-demo-accounts-are-gone-and-their-passwords/241-PAIRB-exists.sql
  modified: []
decisions:
  - "Census-filled tokens, not hand counts, drive every arm from Task 2 on, exactly as plan 04 will fill them"
  - "The fixture's venue id is unique per fixture, so earlier fixtures on one lane never count as sibling keys"
  - "The abort-cross-owner arm uses an UPDATE of an existing bystander decision to name Pair B as decided_by (the insert trigger accepts it, so the allocator_preferences fallback was not needed)"
metrics:
  duration: "about 3 hours wall clock (lane boots dominate under machine load)"
  completed: 2026-11-25
status: complete
actuals:
  tokens: 14000
  tasks: 3
  commits: 3
plan_head_before: 46edd1770689172024f109b5455bf9a1a051a694
plan_head_after: 40a3bc422222534e4b20d805629582c5304ef15b
---

# Phase 241 Plan 03: Pair B delete chain, lane rehearsal Summary

The Pair B delete is one atomic, order-independent SQL statement plus the GoTrue admin-API delete. Both ran end to end on a Pair-B-shaped fixture on the local-stack lane: every arm passes, each of the chain's checks is proven able to fail by name, and the four files plan 04 runs on PROD are fingerprinted. Nothing touched shared TEST or PROD.

## Commits

- `6b882cfcf` test(241-03): lane rehearsal of the Pair B delete chain and admin-API delete (Task 1, tracer)
- `dd8bfce5f` test(241-03): full Pair B FK shape, census, catalog and channel-equivalence arms (Task 2)
- `40a3bc422` test(241-03): abort arms and PROOF-01 for the Pair B delete chain (Task 3)

## Tracer gate

Task 1 ran `chain-admin` end to end on the thin shape (PASS), then Task 2 re-ran it on the full shape with census-filled tokens (PASS). The tracer slice was verified before expansion.

## Arm results (`241-PAIRB-rehearse.sh --all`, lane up)

```
PASS census-shape
PASS chain-admin
channels-equivalent yes
PASS chain-sql
plain-delete-rollback outcome: the plain one-statement delete FAILED on the lane: 23503: update or delete on table "profiles" violates foreign key constraint "allocator_preferences_edited_by_user_id_fkey" on table "allocator_preferences"
(lane evidence of order sensitivity only; no claim about PROD)
PASS plain-delete-rollback
PASS catalog-lane
PASS abort-wrong-count
PASS abort-cross-owner
PASS abort-no-match
PASS abort-marker
SUMMARY pass=9 fail=0
```

9 PASS, 0 FAIL, one `channels-equivalent yes`.

What each arm asserts, all by per-table counts (never ids):

- `census-shape`: before the chain, `pair_b_ids` is 1, every `zero_*` column is 0, each `expect_*` and `info_*` value equals both the constant the fixture inserted and an independent per-table count, the existence query finds the fixture login and does not find a random digest. A fixture with an empty class fails the arm, so a PASS is not vacuous.
- `chain-admin`: census fills the tokens, the chain commits, the admin-API delete reports `matches-before=1 deleted=1 matches-after=0`, B has zero rows in every table (including auth.users, auth.sessions, auth.identities, profiles), B's 5 audit rows survive with user_id NULL, and the bystander snapshot (md5 of every row of X and M, per table) is unchanged.
- `chain-sql`: the same chain, then a raw delete of the auth user, on a second fixture. The two channels' post-state signatures (B zero set, audit, per-table global count deltas) are identical.
- `plain-delete-rollback`: BEGIN, plain delete of the auth user with no chain first, ROLLBACK. Outcome recorded verbatim above: on the lane the one-statement delete is REFUSED, on `allocator_preferences_edited_by_user_id_fkey` (SQLSTATE 23503). Counts unchanged afterwards and the login still exists. This is lane evidence of order sensitivity only, never a claim about PROD.
- Abort arms: each asserts a non-zero exit, the named check in the error, and identical whole-table counts before and after.

Cross-owner edge used by `abort-cross-owner`: `match_decisions.decided_by` (an existing bystander decision made to name B as decided_by). The insert-side trigger accepted it, so the `allocator_preferences.edited_by_user_id` fallback was not used.

## PROOF-01

Each neuter was applied with the Edit tool to `241-PAIRB-chain.sql` from a byte backup (`cp` to the session scratch directory first), the named arm was run for its FAIL line, the file was restored with `cp`, then `cmp` (no output, exit 0) and `git diff --quiet` (exit 0) on the file, and the arm re-run for its PASS line.

| row | neuter edit | command | RED (FAIL) | restore | GREEN (PASS) |
|---|---|---|---|---|---|
| R-01 neuter-cross-owner | deleted the `cross-owner:match_decisions.decided_by` check | `241-PAIRB-rehearse.sh --arm abort-cross-owner` | `FAIL abort-cross-owner: the chain aborted, but not on the named check cross-owner:match_decisions.decided_by (saw: cross-owner:bridge_outcomes.match_decision_id 1)` | cmp: exit 0, no output; git diff --quiet: exit 0 | `PASS abort-cross-owner` |
| R-02 neuter-ids | deleted the exactly-one `pair-b-ids` check | `241-PAIRB-rehearse.sh --arm abort-no-match` | `FAIL abort-no-match: the chain aborted, but not on the named check pair-b-ids: expected 1 got 0 (saw: sibling-keys: expected 1 got 0)` | cmp: exit 0, no output; git diff --quiet: exit 0 | `PASS abort-no-match` |
| R-03 neuter-count | deleted the `count-mismatch:allocator_holdings` ROW_COUNT comparison | `241-PAIRB-rehearse.sh --arm abort-wrong-count` | `FAIL abort-wrong-count: the chain COMMITTED instead of aborting on count-mismatch:allocator_holdings` | cmp: exit 0, no output; git diff --quiet: exit 0 | `PASS abort-wrong-count` |
| R-04 neuter-marker | deleted the `marker-mismatch` check | `241-PAIRB-rehearse.sh --arm abort-marker` | `FAIL abort-marker: the chain COMMITTED instead of aborting on marker-mismatch` | cmp: exit 0, no output; git diff --quiet: exit 0 | `PASS abort-marker` |

R-01 and R-02 show why an arm names its check: the neutered chain still stopped later on a different check, and the arm went RED anyway. R-03 and R-04 are the destructive cases, where the block committed. After the four restores `--all` printed 9 PASS and 0 FAIL (above).

## PROD file fingerprints

Plan 04 refuses to run if any differs. Taken from the committed files at `40a3bc422` (`git diff --quiet` on all four: exit 0).

```
8acb1c4942ad39ff2c650d50047755d504119fc5eda85646c97a72851b2bad62  241-PAIRB-chain.sql
526313a1ccc12b53b1a51c64715fca6aac8d2f08ff435b9239973b22ce07d178  241-PAIRB-census.sql
2962c1ecee57c28bd9caedd777be498288bd6fa86c207441202bdf89fbe225d6  241-PAIRB-exists.sql
0ba5d407627020fc3e4c619eb4fab6da05df5d47ce33c2ea41c3b67f554ea7b6  241-PAIRB-admin-delete.mjs
```

Produced by `shasum -a 256` run inside the phase directory.

## Lane catalog

`241-PAIRB-catalog.sql` on the lane (Postgres image pinned by the lane to `17.6.1.113`, dump `98821446d34e729e…`, replay set empty). Plan 04 runs the same file on PROD and compares `strict_md5`; the lines are there to diff when it differs. Lines hold table, constraint and trigger names only. The lines are sorted `COLLATE "C"`.

```
strict_rows=137
strict_md5=5eb524f40ac0decea1d1f9adfeb1920f
auth_rows=13
auth_md5=5e53514de9c645be9bcaccb72a9d854c
```

The arm also asserts the strict lines include `allocator_holdings_api_key_id_fkey` with delete type `r` and `match_decisions_decided_by_fkey` with delete type `a`, so the walk cannot pass by returning nothing.

strict_lines:

```
fk|public.allocation_events|allocation_events_portfolio_id_fkey|public.portfolios|c|false
fk|public.allocation_events|allocation_events_strategy_id_fkey|public.strategies|a|false
fk|public.allocator_equity_derived|allocator_equity_derived_allocator_id_fkey|auth.users|c|false
fk|public.allocator_holdings|allocator_holdings_allocator_id_fkey|auth.users|c|false
fk|public.allocator_holdings|allocator_holdings_api_key_id_fkey|public.api_keys|r|false
fk|public.allocator_preferences|allocator_preferences_edited_by_user_id_fkey|public.profiles|a|false
fk|public.allocator_preferences|allocator_preferences_user_id_fkey|public.profiles|c|false
fk|public.allocator_trade_read_windows|allocator_trade_read_windows_api_key_id_fkey|public.api_keys|c|false
fk|public.allocator_trade_reads|allocator_trade_reads_api_key_id_fkey|public.api_keys|c|false
fk|public.api_key_flow_prices|api_key_flow_prices_api_key_id_fkey|public.api_keys|c|false
fk|public.api_key_nav_marks|api_key_nav_marks_allocator_id_fkey|auth.users|c|false
fk|public.api_key_nav_marks|api_key_nav_marks_api_key_id_fkey|public.api_keys|c|false
fk|public.api_keys|api_keys_account_shared_with_api_key_id_fkey|public.api_keys|n|false
fk|public.api_keys|api_keys_user_id_fkey|public.profiles|c|false
fk|public.audit_log|audit_log_user_id_fkey|auth.users|n|false
fk|public.bridge_outcome_dismissals|bridge_outcome_dismissals_allocator_id_fkey|public.profiles|c|false
fk|public.bridge_outcome_dismissals|bridge_outcome_dismissals_strategy_id_fkey|public.strategies|c|false
fk|public.bridge_outcomes|bridge_outcomes_allocator_id_fkey|public.profiles|c|false
fk|public.bridge_outcomes|bridge_outcomes_match_decision_id_fkey|public.match_decisions|n|false
fk|public.bridge_outcomes|bridge_outcomes_strategy_id_fkey|public.strategies|c|false
fk|public.compute_job_attempt_failures|compute_job_attempt_failures_allocator_id_fkey|auth.users|c|false
fk|public.compute_job_attempt_failures|compute_job_attempt_failures_api_key_id_fkey|public.api_keys|c|false
fk|public.compute_job_attempt_failures|compute_job_attempt_failures_portfolio_id_fkey|public.portfolios|c|false
fk|public.compute_job_attempt_failures|compute_job_attempt_failures_strategy_id_fkey|public.strategies|c|false
fk|public.compute_job_dedup_events|compute_job_dedup_events_job_id_fkey|public.compute_jobs|c|false
fk|public.compute_jobs|compute_jobs_allocator_id_fkey|auth.users|c|false
fk|public.compute_jobs|compute_jobs_api_key_id_fkey|public.api_keys|c|false
fk|public.compute_jobs|compute_jobs_portfolio_id_fkey|public.portfolios|c|false
fk|public.compute_jobs|compute_jobs_strategy_id_fkey|public.strategies|c|false
fk|public.contact_requests|contact_requests_allocator_id_fkey|public.profiles|c|false
fk|public.contact_requests|contact_requests_replacement_for_fkey|public.strategies|n|false
fk|public.contact_requests|contact_requests_strategy_id_fkey|public.strategies|c|false
fk|public.csv_daily_returns|csv_daily_returns_allocator_id_fkey|auth.users|c|false
fk|public.csv_daily_returns|csv_daily_returns_api_key_id_fkey|public.api_keys|c|false
fk|public.csv_daily_returns|csv_daily_returns_strategy_id_fkey|public.strategies|c|false
fk|public.data_deletion_requests|data_deletion_requests_user_id_fkey|auth.users|n|false
fk|public.deck_strategies|deck_strategies_strategy_id_fkey|public.strategies|c|false
fk|public.first_hop_enqueue_retries|first_hop_enqueue_retries_strategy_id_fkey|public.strategies|c|false
fk|public.for_quants_leads|for_quants_leads_processed_by_fkey|public.profiles|a|false
fk|public.funding_fees|funding_fees_strategy_id_fkey|public.strategies|c|false
fk|public.investor_attestations|investor_attestations_user_id_fkey|public.profiles|c|false
fk|public.key_permission_audit|key_permission_audit_api_key_id_fkey|public.api_keys|c|false
fk|public.match_batches|match_batches_allocator_id_fkey|public.profiles|c|false
fk|public.match_candidates|match_candidates_allocator_id_fkey|public.profiles|c|false
fk|public.match_candidates|match_candidates_batch_id_fkey|public.match_batches|c|false
fk|public.match_candidates|match_candidates_strategy_id_fkey|public.strategies|c|false
fk|public.match_decisions|match_decisions_allocator_id_fkey|public.profiles|c|false
fk|public.match_decisions|match_decisions_candidate_id_fkey|public.match_candidates|a|false
fk|public.match_decisions|match_decisions_contact_request_id_fkey|public.contact_requests|a|false
fk|public.match_decisions|match_decisions_decided_by_fkey|public.profiles|a|false
fk|public.match_decisions|match_decisions_original_strategy_id_fkey|public.strategies|r|false
fk|public.match_decisions|match_decisions_strategy_id_fkey|public.strategies|c|false
fk|public.mt5_server_clock_readings|mt5_server_clock_readings_api_key_id_fkey|public.api_keys|c|false
fk|public.organization_invites|organization_invites_invited_by_fkey|public.profiles|a|false
fk|public.organization_invites|organization_invites_organization_id_fkey|public.organizations|c|false
fk|public.organization_members|organization_members_organization_id_fkey|public.organizations|c|false
fk|public.organization_members|organization_members_user_id_fkey|public.profiles|c|false
fk|public.organizations|organizations_created_by_fkey|public.profiles|a|false
fk|public.portfolio_alerts|portfolio_alerts_portfolio_id_fkey|public.portfolios|c|false
fk|public.portfolio_alerts|portfolio_alerts_strategy_id_fkey|public.strategies|n|false
fk|public.portfolio_analytics|portfolio_analytics_portfolio_id_fkey|public.portfolios|c|false
fk|public.portfolio_strategies|portfolio_strategies_portfolio_id_fkey|public.portfolios|c|false
fk|public.portfolio_strategies|portfolio_strategies_strategy_id_fkey|public.strategies|c|false
fk|public.portfolios|portfolios_user_id_fkey|public.profiles|c|false
fk|public.position_snapshots|position_snapshots_strategy_id_fkey|public.strategies|c|false
fk|public.positions|positions_strategy_id_fkey|public.strategies|c|false
fk|public.profiles|profiles_id_fkey|auth.users|c|false
fk|public.reconcile_readmit_exhaustions|reconcile_readmit_exhaustions_strategy_id_fkey|public.strategies|c|false
fk|public.reconciliation_reports|reconciliation_reports_strategy_id_fkey|public.strategies|c|false
fk|public.relationship_documents|relationship_documents_contact_request_id_fkey|public.contact_requests|c|false
fk|public.relationship_documents|relationship_documents_portfolio_id_fkey|public.portfolios|c|false
fk|public.relationship_documents|relationship_documents_strategy_id_fkey|public.strategies|n|false
fk|public.relationship_documents|relationship_documents_uploaded_by_fkey|auth.users|a|false
fk|public.scenario_commit_idempotency|scenario_commit_idempotency_allocator_id_fkey|public.profiles|c|false
fk|public.scenario_shares|scenario_shares_created_by_fkey|public.profiles|c|false
fk|public.scenario_shares|scenario_shares_scenario_id_fkey|public.scenarios|c|false
fk|public.scenarios|scenarios_allocator_id_fkey|public.profiles|c|false
fk|public.strategies|strategies_api_key_id_fkey|public.api_keys|n|false
fk|public.strategies|strategies_organization_id_fkey|public.organizations|a|false
fk|public.strategies|strategies_user_id_fkey|public.profiles|c|false
fk|public.strategy_analytics_series|strategy_analytics_series_strategy_id_fkey|public.strategies|c|false
fk|public.strategy_analytics|strategy_analytics_strategy_id_fkey|public.strategies|c|false
fk|public.strategy_keys|strategy_keys_api_key_id_fkey|public.api_keys|c|false
fk|public.strategy_keys|strategy_keys_owner_id_fkey|auth.users|c|false
fk|public.strategy_keys|strategy_keys_strategy_id_fkey|public.strategies|c|false
fk|public.strategy_shares|strategy_shares_created_by_fkey|public.profiles|c|false
fk|public.strategy_shares|strategy_shares_strategy_id_fkey|public.strategies|c|false
fk|public.strategy_sync_cursors|strategy_sync_cursors_strategy_id_fkey|public.strategies|c|false
fk|public.strategy_verifications|strategy_verifications_strategy_id_fkey|public.strategies|c|false
fk|public.system_flags|system_flags_updated_by_fkey|public.profiles|a|false
fk|public.system_settings|system_settings_updated_by_fkey|public.profiles|a|false
fk|public.trades|trades_strategy_id_fkey|public.strategies|c|false
fk|public.used_ack_tokens|used_ack_tokens_alert_id_fkey|public.portfolio_alerts|n|false
fk|public.user_app_roles|user_app_roles_granted_by_fkey|auth.users|n|false
fk|public.user_app_roles|user_app_roles_user_id_fkey|auth.users|c|false
fk|public.user_favorites|user_favorites_strategy_id_fkey|public.strategies|c|false
fk|public.user_favorites|user_favorites_user_id_fkey|auth.users|c|false
fk|public.user_notes|user_notes_user_id_fkey|public.profiles|c|false
fk|public.verification_requests_legacy|verification_requests_matched_strategy_id_fkey|public.strategies|a|false
fk|public.weight_snapshots|weight_snapshots_portfolio_id_fkey|public.portfolios|c|false
fk|public.weight_snapshots|weight_snapshots_strategy_id_fkey|public.strategies|c|false
trigger|public.allocator_holdings|allocator_holdings_enforce_owner_coherence|BEFORE INSERT OR UPDATE ROW
trigger|public.allocator_holdings|allocator_holdings_set_updated_at|BEFORE UPDATE ROW
trigger|public.api_key_nav_marks|api_key_nav_marks_owner_coherence|BEFORE INSERT OR UPDATE ROW
trigger|public.api_keys|api_keys_account_share_same_owner|BEFORE INSERT OR UPDATE ROW
trigger|public.api_keys|api_keys_lock_exchange|BEFORE UPDATE ROW
trigger|public.api_keys|api_keys_published_composite_delete_guard|BEFORE DELETE ROW
trigger|public.api_keys|api_keys_scrub_attested_venue|BEFORE INSERT ROW
trigger|public.api_keys|api_keys_scrub_venue_account_id|BEFORE INSERT ROW
trigger|public.api_keys|api_keys_stamp_first_added|AFTER INSERT ROW
trigger|public.audit_log|audit_log_retention_guard|AFTER DELETE STATEMENT
trigger|public.bridge_outcomes|bridge_outcomes_set_updated_at_trigger|BEFORE UPDATE ROW
trigger|public.bridge_outcomes|bridge_outcomes_sync_holding_ref_trigger|BEFORE INSERT OR UPDATE ROW
trigger|public.compute_jobs|compute_jobs_record_orphan_reaped_attempt|AFTER UPDATE ROW
trigger|public.compute_jobs|compute_jobs_set_updated_at_trigger|BEFORE UPDATE ROW
trigger|public.csv_daily_returns|csv_daily_returns_owner_coherence|BEFORE INSERT OR UPDATE ROW
trigger|public.match_decisions|match_decisions_visibility_check|BEFORE INSERT ROW
trigger|public.mt5_server_clock_readings|mt5_server_clock_readings_write_once|BEFORE DELETE OR UPDATE ROW
trigger|public.portfolio_strategies|portfolio_strategies_seed_weight_snapshot_trigger|AFTER INSERT ROW
trigger|public.portfolio_strategies|trg_portfolio_strategies_own_capital_on_repoint|BEFORE UPDATE ROW
trigger|public.portfolio_strategies|trg_portfolio_strategies_own_capital_only|BEFORE INSERT ROW
trigger|public.portfolios|portfolios_reject_sentinel|BEFORE INSERT OR UPDATE ROW
trigger|public.portfolios|portfolios_seed_weight_snapshots_trigger|AFTER INSERT ROW
trigger|public.positions|positions_set_updated_at_trigger|BEFORE UPDATE ROW
trigger|public.profiles|profiles_lock_privileged_cols|BEFORE INSERT OR UPDATE ROW
trigger|public.profiles|profiles_reject_sentinel|BEFORE INSERT OR UPDATE ROW
trigger|public.strategies|check_strategy_api_key_ownership_trigger|BEFORE INSERT OR UPDATE ROW
trigger|public.strategies|guard_strategies_publish_transition_trigger|BEFORE INSERT OR UPDATE ROW
trigger|public.strategies|guard_wizard_draft_updates_trigger|BEFORE UPDATE ROW
trigger|public.strategies|strategies_reject_sentinel|BEFORE INSERT OR UPDATE ROW
trigger|public.strategies|trg_strategies_team_review_mark_guard|BEFORE UPDATE ROW
trigger|public.strategy_analytics|strategy_analytics_drop_stale_error_provenance_trigger|BEFORE UPDATE ROW
trigger|public.strategy_analytics|strategy_analytics_hold_computed_at_until_success_trigger|BEFORE UPDATE ROW
trigger|public.strategy_analytics|strategy_analytics_stamp_computing_started_trigger|BEFORE UPDATE ROW
trigger|public.strategy_keys|strategy_keys_owner_coherence|BEFORE INSERT OR UPDATE ROW
trigger|public.strategy_shares|strategy_shares_monotonic_generation|BEFORE INSERT OR UPDATE ROW
trigger|public.user_notes|user_notes_set_updated_at_trigger|BEFORE UPDATE ROW
```

auth_lines (GoTrue's own, version dependent, compared separately and not gating):

```
fk|auth.identities|identities_user_id_fkey|auth.users|c|false
fk|auth.mfa_amr_claims|mfa_amr_claims_session_id_fkey|auth.sessions|c|false
fk|auth.mfa_challenges|mfa_challenges_auth_factor_id_fkey|auth.mfa_factors|c|false
fk|auth.mfa_factors|mfa_factors_user_id_fkey|auth.users|c|false
fk|auth.oauth_authorizations|oauth_authorizations_user_id_fkey|auth.users|c|false
fk|auth.oauth_consents|oauth_consents_user_id_fkey|auth.users|c|false
fk|auth.one_time_tokens|one_time_tokens_user_id_fkey|auth.users|c|false
fk|auth.refresh_tokens|refresh_tokens_session_id_fkey|auth.sessions|c|false
fk|auth.sessions|sessions_user_id_fkey|auth.users|c|false
fk|auth.webauthn_challenges|webauthn_challenges_user_id_fkey|auth.users|c|false
fk|auth.webauthn_credentials|webauthn_credentials_user_id_fkey|auth.users|c|false
trigger|auth.users|on_auth_user_created|AFTER INSERT ROW
trigger|auth.users|on_auth_user_email_updated|AFTER UPDATE ROW
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Census used `= ANY ((SELECT ids FROM x))`, which Postgres parses as a row subquery**
- **Found during:** Task 2 (`census-shape`)
- **Issue:** `operator does not exist: uuid = uuid[]`
- **Fix:** wrapped as `ANY (coalesce((SELECT ids FROM x), '{}'::uuid[]))`
- **Files modified:** `241-PAIRB-census.sql`
- **Commit:** dd8bfce5f

**2. [Rule 1 - Bug] Fixture sibling check counted earlier fixtures' keys, and the second portfolio violated the one-real-portfolio-per-user index**
- **Found during:** Task 2
- **Issue:** a fixed venue id made every earlier X key a sibling (`expect_sibling_keys` was 7); two real portfolios per user is refused by `portfolios_one_real_per_user`
- **Fix:** venue id derived per fixture; second portfolio is `is_test`
- **Files modified:** `241-PAIRB-fixture.sql`
- **Commit:** dd8bfce5f

**3. [Rule 1 - Bug] Driver parse bugs (psql prefix on error lines, replacement-string expansion in the spec builder, an acceptance-gate false positive on a comment)**
- **Fix:** match `ERROR:` anywhere in the line, build the SQL predicates through variables, reword two comments
- **Files modified:** `241-PAIRB-rehearse.sh`, `241-PAIRB-census.sql`
- **Commit:** 6b882cfcf, dd8bfce5f

### Plan adaptations (not defects)

- Task 1 loaded the thin shape and filled tokens from hand counts; Task 2 replaced that with the census fill, as the plan describes.
- `abort-cross-owner` seeds by UPDATE of an existing bystander decision, not a fresh insert (same edge, same check).
- The plan lists `ARM` outputs as PASS lines only; the driver also prints the `channels-equivalent` and `plain-delete-rollback outcome` lines the plan asks the SUMMARY to carry.

## Authentication gates

None. The lane uses its own loopback GoTrue and service key from the gitignored handoff file; no value was printed.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint or trust boundary; the admin-API script refuses a non-loopback host for `--target lane` and an https non-loopback host check for `--target prod` plus `--confirm-prod`.

## Notes for plan 04

- The chain's marker literal sits in a dollar-quoted string, so the PROD marker text must not contain the sequence dollar-m-dollar.
- Fill tokens with `FILL_*` environment variables into a scratch copy (the driver's `fill_file`), not with sed: a marker may hold characters sed treats specially.
- `241-PAIRB-census.sql` `zero_*` columns must all be 0 on PROD before the chain; an unfilled token is a syntax error, so a half-filled block fails closed before any write.
- The PROD catalog comparison is `strict_md5`; a difference means diff `strict_lines` before any write.
- The chain does not delete the auth user. Run the admin-API script after the chain commits, then the existence query (expected count 0).

## Self-Check: PASSED

- All eight `241-PAIRB-*` files exist beside the plan (checked with `ls`); the four fingerprinted files are byte-identical to HEAD.
- Commits `6b882cfcf`, `dd8bfce5f`, `40a3bc422` are ancestors of HEAD; measured `commits: 3` from the plan ledger.
- No uuid and no 64-hex string in any `241-PAIRB-*` file (grep count 0), no shell tracing, no sanitize-bypass setting named in the chain.
- Lane brought down: zero `supabase_` containers; handoff file removed by `down`.

# Phase 241 DEMOCREDS: account measurement before any delete (2026-11-24)

Read-only. The marker query preceded each PROD read except two early ones (noted as a slip).
Accounts were matched by a sha256 of the lowercased login, never by the login text, and
are named here by role only: **Pair A** is the shared e2e login, **Pair B** is the
`seed-full-app-demo` allocator. No login, id, digest or password appears in this file.

## Premise check: the roadmap says "two unused demo accounts". PROD disagrees.

| | TEST | PROD |
|---|---|---|
| Pair A exists | no | yes; created 2026-04-05; last sign-in 2026-09-24 |
| Pair B exists | yes; auth rows only (1 identity, 11 sessions); no profile | yes; created 2026-04-09; last sign-in 2026-08-23; 2 live sessions |

PROD Pair A holds the `admin` and `quant_manager` roles. Without it, **1** admin remains.
It owns **19 strategies: 1 published, 4 pending_review, 14 archived.** PROD has **2**
published strategies in total, so deleting Pair A removes half of the published catalogue.

Keys: each pair has one OKX key that is connected and synced today (2026-11-24), plus
disconnected Bybit keys (A: 2, B: 1). Each OKX key shares its venue account with 3 keys
under other logins, so the exchange account is not lost; these keys and their derived
rows are. None of these keys is one of the seed's fixed `API_KEY_IDS`.

## Direct rows per account on PROD (FK walk from auth.users and profiles)

| table | on delete | A | B |
|---|---|---|---|
| allocator_holdings | cascade | 3517 | 3511 |
| audit_log | SET NULL | 3398 | 3699 |
| csv_daily_returns | cascade | 549 | 369 |
| compute_jobs | cascade | 32 | 32 |
| api_key_nav_marks | cascade | 29 | 29 |
| strategies | cascade | 19 | 0 |
| match_candidates | cascade | 14 | 14 |
| match_batches | cascade | 7 | 7 |
| allocator_equity_derived | cascade | 3 | 2 |
| api_keys | cascade | 3 | 2 |
| portfolios | cascade | 1 | 3 |
| strategy_shares (created_by) | cascade | 2 | 0 |
| user_app_roles | cascade | 2 | 1 |
| contact_requests | cascade | 1 | 0 |
| investor_attestations | cascade | 1 | 1 |
| allocator_preferences | cascade | 0 | 1 |
| bridge_outcomes | cascade | 0 | 2 |
| match_decisions (allocator_id) | cascade | 0 | 2 |
| match_decisions (decided_by) | no action | 0 | 2 |
| auth.sessions | cascade | 0 | 2 |
| auth.identities | cascade | 1 | 1 |
| profiles | cascade | 1 | 1 |

## Second level (children of the accounts' strategies, keys and portfolios)

Pair A strategies: csv_daily_returns 2459, funding_fees 335, trades 287,
reconciliation_reports 197, compute_jobs 140, strategy_analytics_series 127,
match_candidates 119, position_snapshots 31, strategy_analytics 19,
strategy_verifications 12, positions 8, strategy_shares 2, strategy_sync_cursors 1,
contact_requests 1.
Pair A keys: allocator_holdings 3517 (**ON DELETE RESTRICT**), csv_daily_returns 549,
compute_jobs 78, api_key_nav_marks 29, key_permission_audit 6, strategies.api_key_id 1 (no action).
Pair B keys: allocator_holdings 3511 (**RESTRICT**), csv_daily_returns 369, compute_jobs 71,
api_key_nav_marks 29. Pair B portfolios: portfolio_analytics 3.

**Cross-user blast radius.** 105 of the 119 match_candidates rows on Pair A's strategies
belong to **15 other allocators**. The 140 compute_jobs rows on those strategies carry no
pair-owned allocator_id. No contact request from another allocator.

No storage objects. No composite FKs into these parents.

## Will a plain delete run?

Probably not as one statement. Unrehearsed:
- `allocator_holdings.api_key_id` is ON DELETE RESTRICT (about 3.5k rows per pair).
  Whether the allocator_id cascade removes them before the api_keys cascade checks is
  order-dependent.
- `api_keys_published_composite_delete_guard` is a BEFORE DELETE trigger on api_keys.
  Pair A's published strategy sits on its OKX key.
- `audit_log` is SET NULL, an UPDATE on a table the migrations call immutable.
  `audit_log_retention_guard` is AFTER DELETE, so it does not fire.

The product's erasure path, `sanitize_user` (latest `20261124120700`), **anonymises** and
does not delete. It nulls the login and password, bans the account forever, deletes
api_keys (meeting the same RESTRICT), and keeps the auth row. It would kill the credential.
It would not meet "no longer exists".

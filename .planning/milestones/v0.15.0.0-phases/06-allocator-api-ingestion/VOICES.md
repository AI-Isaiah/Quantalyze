# Outside Voices — Phase 06

**Voice A (Claude subagent, fresh context, opus):** verdict=revise — The migration DO block's multi-actor RLS probe (Plan 01 Task 1 Step 10) is likely false-positive because the migration runs as a BYPASSRLS superuser; `set_config('role', 'authenticated', true)` sets a GUC, not the session role. Several other landmines around cross-boundary data consistency, fire-and-forget first-run UX, and Deribit silent-empty sync paths also flagged.

**Voice B (Grok grok-4-1-fast-reasoning):** verdict=approve — Plans align tightly with phase goal and success criteria without scope creep or overcomplexity. No findings.

## Consensus findings (auto-fold into replan)

_None — voices diverged completely._

## Divergent findings (require user decision)

| # | Priority | Area | Title | Voice A says | Voice B says |
|---|----------|------|-------|--------------|--------------|
| f1 | P0 | verification | DO-block RLS probe uses `set_config('role', …)` which does NOT switch the enforcing role — probe is likely false-positive | BLOCKER / HIGH — Replace with `EXECUTE 'SET LOCAL ROLE authenticated'` + assert `NOT rolbypassrls`. Move probe out of DO or wrap role switch in EXECUTE. | (not flagged) |
| f2 | P0 | sequencing | Migration 066 applied directly to production with no staging/preview path | BLOCKER / HIGH — Add a preview-branch apply + smoke test of both `enqueue_poll_positions_for_all_strategies()` and `enqueue_poll_allocator_positions_for_all_keys()` before production promotion. Document rollback SQL. | (not flagged) |
| f3 | P1 | risk | Deribit `fetch_balance()` shape unverified — silent-empty sync if wrong | WARNING / HIGH — Add Deribit-shaped pytest case; implement per-currency branch if test fails, or narrow D-17 to exclude Deribit from Phase 06 and defer. | (not flagged) |
| f4 | P1 | risk | `handleAddKey` first-run sync is fire-and-forget; 403/500 produces stuck "Syncing…" pill | WARNING / MED — Await the POST; on non-2xx surface helper text on the row (same pattern as `handleSync`). Add test `handleAddKey_shows_error_when_first_run_sync_fails_with_403`. | (not flagged) |
| f5 | P1 | architecture | No DB constraint enforces `allocator_holdings.allocator_id = api_keys.user_id` | WARNING / HIGH — Add trigger or SECURITY DEFINER CHECK function on INSERT/UPDATE of `allocator_holdings`; alternative = drop `allocator_id` column and derive via view. | (not flagged) |
| f6 | P2 | risk | Cron idempotency key can race across day boundaries due to 0–600s run_at jitter | WARNING / MED — Compute idempotency key against `(now() + run_at_jitter)` day, or assert cron schedule stays ≥1h from midnight boundary + jitter window. | (not flagged) |
| f7 | P1 | verification | `_emit_audit` points at `services.audit.log_audit_event_service` — existence unverified | WARNING / MED — Pre-task to read `analytics-service/services/audit.py`; either assert the function/constants exist or add them in Plan 02. Acceptance must grep the event names in both `services/audit.py` AND handler. | (not flagged) |
| f8 | P3 | architecture | Cross-worker rate-limit contagion — strategy-side 429s block allocator syncs on the same exchange | INFO / MED — Either document explicitly (pill may show "Syncing…" up to 10 min during cooldown) or surface `deferred` state in UI; worst-case split circuit breaker to `(exchange, api_key_id)`. | (not flagged) |

## Notes

- Grok returned `approve` / empty findings — that's one of the two "silence is correct" outcomes per the brief. Every finding is Voice A divergent.
- Voice A's analysis references specific files, line numbers, and task IDs — the findings are not pattern-matched hallucinations.
- f1 (RLS probe false-positive) is the single highest-stakes finding: if true, INGEST-09 / SC4 passes the migration DO block vacuously and the only real proof is the Vitest live-DB spec (which may be skipped in CI).

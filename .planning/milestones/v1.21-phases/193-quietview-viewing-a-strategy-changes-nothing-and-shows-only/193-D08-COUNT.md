# Phase 193 D-08: read-only PROD count of empty notes

Purpose (D-08): record, before plan 193-07 changes any note code, how many empty note rows PROD
holds and when they were first and last written, and how many zero-length saves the audit trail saw
per note action. Counts and dates only.

Operator: the orchestrator session through the Supabase MCP, one statement per call, never chained.
The marker statement (Q0) runs first and alone; its answer must equal `database_marker` in
`scripts/prod-prober/cron-manifest.json`, otherwise nothing further runs. Only if the MCP is
unreachable does the CLAUDE.md CLI fallback run, still one statement per call.

Rule: the empty note rows are left in place. Every statement below is a SELECT. Copy each statement
as it stands.

## Q0 marker

SELECT shobj_description(oid, 'pg_database') AS which_database FROM pg_database WHERE datname = current_database();

Result: the answer equalled `database_marker` in `scripts/prod-prober/cron-manifest.json` (the
PRODUCTION marker). Q1 and Q2 ran only after that.

| which_database |
|---|
| PRODUCTION (equals the manifest's `database_marker`) |

## Q1 empty notes by scope

SELECT scope_kind,
       count(*)                                       AS total_rows,
       count(*) FILTER (WHERE btrim(content) = '')    AS empty_rows,
       min(created_at) FILTER (WHERE btrim(content) = '') AS first_empty_at,
       max(created_at) FILTER (WHERE btrim(content) = '') AS last_empty_at
  FROM public.user_notes
 GROUP BY scope_kind
 ORDER BY scope_kind;

Result:

| scope_kind | total_rows | empty_rows | first_empty_at | last_empty_at |
|---|---|---|---|---|
| holding | 1 | 1 | 2026-07-20 | 2026-07-20 |
| strategy | 1 | 1 | 2026-11-06 | 2026-11-06 |

## Q2 empty saves in the audit trail

SELECT action,
       count(*) AS saves,
       count(*) FILTER (WHERE (metadata->>'content_length')::int = 0) AS zero_length_saves
  FROM public.audit_log
 WHERE action LIKE 'user_note.%.update'
 GROUP BY action
 ORDER BY action;

Result:

| action | saves | zero_length_saves |
|---|---|---|
| user_note.holding.update | 1 | 1 |
| user_note.strategy.update | 1 | 1 |

## Lines

marker: PRODUCTION
d08-head: eb9f06d9f178eb755b2f474a28b21900e9b591e3
d08-read-at: 2026-11-06T20:43Z
d08-source: mcp
d08-notes: scope_kind=holding total=1 empty=1 first_empty=2026-07-20 last_empty=2026-07-20
d08-notes: scope_kind=strategy total=1 empty=1 first_empty=2026-11-06 last_empty=2026-11-06
d08-audit: action=user_note.holding.update saves=1 zero_length=1
d08-audit: action=user_note.strategy.update saves=1 zero_length=1

## Reading

PROD holds two note rows, one per scope, and both are empty: one `holding` note written on
2026-07-20 and one `strategy` note written on 2026-11-06. The audit trail matches them: each scope
has exactly one `user_note.<scope>.update` save, and that save carried a content length of zero.
So every note save PROD has recorded is an empty one, which is consistent with the open-and-leave
write path D-09 measures (auto-focus plus save on blur). Limit (A-193-01): a row that a user emptied
on purpose also counts as empty here, and these counts cannot tell the two apart. The reading was
taken by the orchestrator session through the Supabase MCP, marker first and alone, one statement
per call. The rows are left in place (D-08).

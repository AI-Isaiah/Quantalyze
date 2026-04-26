# ADR-0023: Audit event taxonomy — namespaced actions, per-row entity anchoring, append-only immutability

## Status
Accepted (shipped in Sprint 6 closeout Task 7.1a)

## Context
Migration 010 created the `audit_log` table as a forensic record of
user-attributable actions, but the table sat unused until Sprint 6.
With exchange API keys at rest, GDPR Art. 17 deletion intake, and
allocator-to-manager intros all live, the product now has real
compliance surface area — "who did what, when, on what entity" is a
question we need to answer.

Sprint 6 Task 7.1a ships the first three instrumented audit events and
the `log_audit_event` RPC that writes them. Future tasks (7.1b) will
fan out instrumentation to ~27 other mutation sites. Without a locked
taxonomy now, those sites will invent their own action strings and the
table becomes ungreppable.

### What was unclear before this ADR
- Whether action strings should be `dotted.namespace` or `flat_verb`.
- What `entity_type` should hold when an action doesn't map to a single
  table row (e.g., "user logged in").
- Whether audit rows are mutable or append-only.
- How the RPC gates user attribution to prevent spoofing.
- How Python (analytics-service) will emit cross-service audit events.

## Decision

### 1. Action strings are namespaced `<subject>.<verb>`
Every action string is lowercase, dotted, and shaped `<subject>.<verb>`.
Subjects are singular nouns naming the entity the verb acts on; verbs
are short past- or present-tense English (`decrypt`, `send`, `create`,
`revoke`, `export`).

Examples:
- `api_key.decrypt`
- `intro.send`
- `deletion.request.create`
- `strategy.publish`
- `portfolio.optimize`

The namespace makes the table greppable and self-documenting. It also
lets future dashboards group by subject (e.g., "show all `api_key.*`
events in the last 30 days for user X") without parsing free-form
strings.

### 2. TypeScript enum, synced with this ADR
The authoritative enum lives in `src/lib/audit.ts`. Task 7.1b fanned it
out from 9 → 30 values; the /review follow-up added 3 more (lead
processing + sync.start) for 33 total:

```ts
export type AuditAction =
  // 7.1a pilot
  | "api_key.decrypt"
  | "intro.send"
  | "deletion.request.create"
  // 7.2 RBAC
  | "role.grant"
  | "role.revoke"
  // 7.3 GDPR workflow
  | "account.sanitize"
  | "account.export"
  | "deletion.request.approve"
  | "deletion.request.reject"
  // 7.1b TS fanout
  | "allocation.update"
  | "contact_request.status_change"
  | "portfolio_document.create"
  | "alert.acknowledge"
  | "allocator.approve"
  | "notification_preferences.update"
  | "attestation.accept"
  // Phase 08: multi-scope notes (user_note.*) — replaces portfolio_note.update
  | "user_note.portfolio.update"
  | "user_note.holding.update"
  | "user_note.bridge_outcome.update"
  | "user_note.strategy.update"
  | "admin.kill_switch"
  | "match.decision_record"
  | "match.decision_delete"
  | "strategy.delete"
  | "strategy.approve"
  | "strategy.reject"
  | "api_key.revoke"
  | "trades.upload"
  | "admin.partner_import"
  // /review follow-up (T4-C1 + T4-M6)
  | "lead.process"
  | "lead.unprocess"
  | "sync.start"
  // 7.1b Python cross-service (via log_audit_event_service)
  | "bridge.score_candidates"
  | "simulator.run"
  | "optimizer.run"
  | "reconcile.compare";
```

Adding a new action requires:
1. Adding the literal to the `AuditAction` union.
2. Adding the action + entity_type mapping to the table below.
3. Adding the emission call at the site.

A free-form `string` is NOT accepted — `AuditAction` is a closed union
so a typo fails at compile time rather than polluting the table.

### 3. entity_type + entity_id are always populated
`audit_log.entity_id` is `NOT NULL` (migration 010). Every action must
identify the row it mutated or referenced. Actions without a natural
entity (e.g., "user logged in") use the user's own profile row id and
set `entity_type = 'user'`.

We do NOT smuggle a sentinel UUID. If an action has no entity, the
action doesn't belong in audit_log — it belongs in product analytics
(PostHog).

### 4. Action → entity_type mapping (Sprint 6 closeout pilot + RBAC + GDPR + 7.1b fanout)

| Action | entity_type | entity_id source | Metadata keys |
|--------|-------------|------------------|---------------|
| `api_key.decrypt` | `api_key` | `api_keys.id` (the key whose ciphertext was decrypted) | route, reason |
| `intro.send` | `contact_request` | `contact_requests.id` (the newly inserted intro row) | source, strategy_id, replacement_for |
| `deletion.request.create` | `data_deletion_request` | `data_deletion_requests.id` (the intake row) | — |
| `role.grant` | `user_app_role` | target user's `auth.users.id` (NOT a user_app_roles row id — the (user_id, role) composite PK has no standalone UUID) | role, granted_by |
| `role.revoke` | `user_app_role` | target user's `auth.users.id` | role, revoked_by, removed_rows |
| `account.sanitize` | `user` | target user's `auth.users.id` (the account being anonymized) | request_id, was_first_run |
| `account.export` | `user` | target user's `auth.users.id` (the exporter — may be the same as the caller or a different user when an admin exports on their behalf) | storage_path, expires_at, table_count |
| `deletion.request.approve` | `data_deletion_request` | the `data_deletion_requests.id` being approved | target_user_id, approved_by |
| `deletion.request.reject` | `data_deletion_request` | the `data_deletion_requests.id` being rejected | target_user_id, rejected_by, reason |
| `allocation.update` | `allocation` | `portfolios.id` (the top-level ownership anchor — portfolio_strategies has a composite PK with no standalone UUID) | strategy_id, alias |
| `contact_request.status_change` | `contact_request` | `contact_requests.id` | new_status, has_note |
| `portfolio_document.create` | `portfolio_document` | `relationship_documents.id` | portfolio_id, strategy_id, doc_type |
| `alert.acknowledge` | `alert` | `portfolio_alerts.id` | source (in_app_list / in_app_banner / email), alert_type |
| `allocator.approve` | `user` | target user's `profiles.id` | new_status |
| `notification_preferences.update` | `user` | target user's `allocator_preferences.user_id` (matches profiles.id; composite-keyed table uses user_id as anchor) | fields, self_edit, edited_by? |
| `attestation.accept` | `investor_attestation` | caller's own `profiles.id` (investor_attestations keys on user_id) | version, has_ip |
| `user_note.portfolio.update` | `user_note` | `portfolios.id` (scope_ref as UUID) | scope_kind, scope_ref, content_length |
| `user_note.holding.update` | `user_note` | caller's `profiles.id` (no single row aggregates a holding scope — see Research Finding #8) | scope_kind, scope_ref, content_length |
| `user_note.bridge_outcome.update` | `user_note` | `bridge_outcomes.id` (scope_ref as UUID) | scope_kind, scope_ref, content_length |
| `user_note.strategy.update` | `user_note` | `strategies.id` (scope_ref as UUID) | scope_kind, scope_ref, content_length |
| `admin.kill_switch` | `system_flag` | acting admin's `profiles.id` (system_flags keyed on text `key`, no UUID available) | flag, new_value |
| `match.decision_record` | `match_decision` | `match_decisions.id` | allocator_id, strategy_id, decision |
| `match.decision_delete` | `match_decision` | `match_decisions.id` of the removed row | allocator_id, strategy_id, decision |
| `strategy.delete` | `strategy` | `strategies.id` | source, status_before_delete |
| `strategy.approve` | `strategy` | `strategies.id` | new_status |
| `strategy.reject` | `strategy` | `strategies.id` | new_status, review_note |
| `api_key.revoke` | `api_key` | `api_keys.id` | reason, strategy_id? |
| `trades.upload` | `strategy` | `strategies.id` (trades.upload is a bulk insert; strategy is the ownership anchor) | inserted, batches |
| `admin.partner_import` | `partner_import` | deterministic hash UUID of `partner_tag` + timestamp (no DB row for the import batch) | partner_tag, managers_created, strategies_created, allocators_created |
| `lead.process` | `for_quants_lead` | `for_quants_leads.id` of the lead being marked processed | — |
| `lead.unprocess` | `for_quants_lead` | `for_quants_leads.id` of the lead being unmarked | — |
| `sync.start` | `sync` | `strategies.id` — the strategy whose trades + analytics are being synced | path (queue / legacy) |
| `bridge.score_candidates` | `bridge_run` | `portfolios.id` — the portfolio the bridge was run against | underperformer_strategy_id, candidate_count |
| `simulator.run` | `simulator_run` | `portfolios.id` — the portfolio the ADD scenario targeted | candidate_strategy_id |
| `optimizer.run` | `optimizer_run` | `portfolios.id` | suggestion_count |
| `reconcile.compare` | `reconcile_run` | `strategies.id` — the strategy being reconciled | status, discrepancy_count |
| `bridge_outcome.record` | `bridge_outcome` | inserted `bridge_outcomes.id` | `strategy_id`, `kind`, `percent_allocated?`, `rejection_reason?` |
| `bridge_outcome.update` | `bridge_outcome` | updated `bridge_outcomes.id` | `strategy_id`, `fields_changed` |
| `bridge_outcome.dismiss` | `bridge_outcome_dismissal` | inserted `bridge_outcome_dismissals.id` | `strategy_id`, `expires_at` |
| `mandate_preference.update` | `allocator_preference_mandate` | allocator's own `profiles.id` (`allocator_preferences` keys on user_id; matches profiles.id) | `fields` (changed field names), `self_edit: true` |
| `mandate_preference.admin_update` | `allocator_preference_mandate` | target allocator's `profiles.id` | `fields`, `self_edit: false`, `edited_by` (admin user id) |
| `feedback.overrides_updated` | `allocator_preference_feedback` | allocator's own `profiles.id` (matches `allocator_preferences.user_id` — Phase 4 feedback engine persists `scoring_weight_overrides` on the same row) | `dimensions_updated` (list of W_* keys whose scale was written), `engine_version` (feedback rule format version, e.g. `"v1"`) |
| `allocator.holdings.sync_requested` | `api_key` | `api_keys.id` — the allocator-owned exchange key whose poll is being kicked off | — (the request is the event; no additional metadata required) |
| `allocator.holdings.sync_completed` | `api_key` | `api_keys.id` — the key whose poll just finished | `row_count` (integer — total holdings rows upserted), `holding_type_counts` (`{ spot: int, derivative: int }` — per-`holding_type` breakdown) |
| `allocator.holdings.sync_failed` | `api_key` | `api_keys.id` — the key whose poll terminated in failure | `error_kind` (`'permanent' \| 'transient' \| 'unknown'` — output of `classify_exception`), `sanitized_message` (string ≤ 500 chars, truncated by worker) |

Entity-id choice rationale (Python cross-service): bridge, simulator,
optimizer anchor on portfolio_id because the portfolio is the persistent
user-visible object; the run itself is ephemeral. Reconcile anchors on
strategy_id because the reconciliation_reports row is per-strategy.

Sprint 6 closeout Task 7.2 added `role.grant` + `role.revoke` +
`user_app_role` entity_type. The grant/revoke emitter lives in
`src/app/api/admin/users/[id]/roles/route.ts`; see ADR-0005 for the
full RBAC architecture.

Sprint 6 closeout Task 7.3 added the four GDPR actions plus the `user`
entity_type anchor. Emission sites:
- `src/app/api/account/export/route.ts` (`account.export`)
- `src/app/api/admin/deletion-requests/[id]/approve/route.ts`
  (`deletion.request.approve` + `account.sanitize`)
- `src/app/api/admin/deletion-requests/[id]/reject/route.ts`
  (`deletion.request.reject`)

Sprint 6 closeout Task 7.1b fanned the taxonomy out to the remaining
TS mutation sites and 4 Python cross-service sites (bridge, simulator,
optimizer, reconcile). The Python sites call `log_audit_event_service`
(migration 058) directly via supabase-py; see §8 for the cross-service
contract.

Phase 06 (allocator API ingestion, migration 066) added three
`allocator.holdings.*` actions per D-18. They all anchor on
`entity_type = 'api_key'` and `entity_id = api_keys.id` — the key
being polled is the natural entity for every stage of the sync
lifecycle:

- `allocator.holdings.sync_requested` is emitted by the Next route
  `POST /api/allocator/holdings/sync` when the allocator kicks off a
  manual poll (or when a newly added key auto-enqueues its first
  sync). The user-scoped RPC path (`logAuditEvent`) is used because
  `auth.uid()` is the allocator.
- `allocator.holdings.sync_completed` is emitted by the Python worker
  on `DispatchOutcome.DONE`. Metadata captures the normalized row
  count + a per-`holding_type` breakdown (`{ spot, derivative }`) so
  operators can distinguish balance-only polls from full polls
  without replaying worker logs.
- `allocator.holdings.sync_failed` is emitted by the Python worker on
  `DispatchOutcome.FAILED`. Metadata carries the
  `classify_exception` taxonomy bucket + the worker-sanitized message
  (capped at 500 chars by `classify_exception` itself). The cap
  matches the `sync_error` column ceiling documented on migration
  066 — the event is a forensic mirror of what `api_keys.sync_error`
  holds at the same moment.

Worker-side emission goes through `log_audit_event_service` because
the Python path has no `auth.uid()` context; the caller-supplied
`user_id` is the allocator that owns the key (`api_keys.user_id`).

Phase 08 (connection management + multi-scope notes, migration 071)
renamed `portfolio_note.update` → `user_note.portfolio.update` and
added three new scope-specific variants (`user_note.holding.update`,
`user_note.bridge_outcome.update`, `user_note.strategy.update`). The
`AuditEntityType` entry `portfolio_note` was renamed to `user_note` in
the same enum. The rename is atomic — no back-compat alias, no
deprecated old name accepted in parallel — because the only emitter
(`/api/notes` PATCH) is rewritten in the same commit as the migration,
the audit enum, this ADR, and the scope-ref/ownership helpers (per
D-23 / the S1 atomic-commit mandate). The five in-repo call sites
(`src/lib/audit.ts`, `src/app/api/notes/route.ts`, this ADR, the
audit-fanout integration test, and the critical-regressions grep
guard) all update in lockstep; no external consumer references the
old string. The historical `audit_log` rows with
`action='portfolio_note.update'` remain immutable per §6 append-only
— any future dashboard surfacing the time series must UNION the old
name with the new four for the transition window.

`entity_id` is a scope-appropriate UUID, not a synthetic composite
string. `audit_log.entity_id` is UUID-typed, and Research Finding #8
locks the per-scope resolution:

- `user_note.portfolio.update`       → `portfolios.id`   (= scope_ref as UUID)
- `user_note.holding.update`         → caller's `profiles.id` (no single row aggregates a holding-scope note — the note spans every daily `allocator_holdings.asof` row for the {venue, symbol, holding_type} tuple; matches the `attestation.accept` pattern of using the caller's own id when no single row applies)
- `user_note.bridge_outcome.update`  → `bridge_outcomes.id` (= scope_ref as UUID)
- `user_note.strategy.update`        → `strategies.id`   (= scope_ref as UUID)

Grep-ability is preserved: `audit_log WHERE action LIKE 'user_note.%'`
returns every note event, and `metadata->>'scope_kind'` disambiguates
further. Content is NEVER echoed into metadata (D-14/D-20 privacy
invariant); metadata carries `{scope_kind, scope_ref, content_length}`
only. The audit-fanout integration test asserts `metadata.content`
is `undefined` across all four kinds.

### 5. user_id is derived from `auth.uid()` in the RPC
`log_audit_event` is SECURITY DEFINER (migration 049). Inside the
function body, user_id is set from `auth.uid()` — the caller cannot
spoof attribution by passing a different user_id. If `auth.uid()` is
NULL (unauthenticated caller, or service_role without JWT GUC), the
function raises with `insufficient_privilege`.

This locks the attribution chain at the Postgres layer, one hop closer
to the data than a TypeScript wrapper could. Even a compromised Next
route cannot write an audit row attributed to user B when user A's
JWT is on the wire.

### 6. audit_log is append-only at the DB layer
Migration 049 installs two deny policies and a table-level REVOKE:

- `audit_log_no_updates` — RLS `FOR UPDATE USING (false)`
- `audit_log_no_deletes` — RLS `FOR DELETE USING (false)`
- `REVOKE UPDATE, DELETE ON audit_log FROM authenticated, service_role`

The RLS policies deny at the query-planner level; the REVOKE denies at
the grant level as defense-in-depth if a future migration disables RLS.
The combined effect: no supabase client role — not even service_role —
can mutate or delete existing audit rows via PostgREST.

Superuser SQL can still delete rows (retention policy will require it
eventually). That's an intentional escape hatch for operator use; the
audit is against *application-layer* tampering, not against a compromised
database.

**Cold archive (`audit_log_cold`) shares the same invariant.** Migration
056 creates the cold table with the identical pattern: deny policies
(`audit_log_cold_no_updates`, `audit_log_cold_no_deletes` — both
`USING (false)`) plus `REVOKE UPDATE, DELETE ON audit_log_cold FROM
authenticated, service_role`. Rows move hot→cold via the
`audit_log_hot_to_cold` cron at 2y without changing `id` or
`created_at`, so the append-only contract is preserved end-to-end across
the full 7-year retention window. Only superuser SQL (the
`audit_log_cold_purge` cron, which runs as postgres) can delete rows
from the cold table — same escape hatch as the hot table, same
justification.

### 7. Fire-and-forget emission (non-blocking)
Audit emission must not appear in the request's tail latency.
`logAuditEvent()` in `src/lib/audit.ts`:
- Returns `void` synchronously (not a Promise).
- Schedules the RPC via `after()` (Next 16) so the emission runs after
  the caller's response flushes. On Vercel, `after()` uses the
  `waitUntil(promise)` primitive, which keeps the function instance
  alive until the emission settles — the event is not lost to a
  cold-finish after the response stream has closed.
- Catches all errors and logs them to stderr with the stable prefix
  `[audit]`. Never throws to the caller.
- Latency target: the emission adds ~0ms to caller-observed response
  time. Because `after()` defers the RPC past response flush, the only
  shared CPU cost is the microtask enqueue, which is ns-scale. There is
  no fixed `p99` budget — the emitter simply never blocks the caller.

The queue is implicit (`waitUntil` on Vercel, a microtask fallback
off-platform), not a durable buffer. A crash between "caller returns"
and "RPC completes" drops the event. Sprint 7+ may upgrade to a durable
outbox if compliance requires stronger guarantees; today's tradeoff is
"favor response latency over audit durability."

### 8. Cross-service emission (Python analytics-service)
Task 7.1b shipped the cross-service path. **Option A1 chosen** (2026-04-16
gate decision): `supabase-py` calls a service-role-only RPC variant
directly with a caller-supplied user_id.

Migration 058 installs `log_audit_event_service(p_user_id, p_action,
p_entity_type, p_entity_id, p_metadata)`:
- SECURITY DEFINER + pinned search_path.
- Validates `p_user_id IS NOT NULL` and raises `invalid_parameter_value`
  otherwise (same validation as `log_audit_event` for the other params).
- REVOKE EXECUTE FROM public, anon, authenticated. GRANT EXECUTE to
  service_role ONLY. The attribution-spoof gate is at the grant layer:
  a compromised `authenticated` JWT cannot reach this RPC regardless
  of what user_id it passes.
- Self-verify DO block asserts the grant pattern at migration-apply
  time — if `authenticated` somehow gets EXECUTE, the migration aborts
  with a loud error rather than silently widening the spoof surface.

Why A1 over A2
--------------
A2 (direct service-role INSERT into `audit_log`) was rejected because
the RPC retains centralized validation. With A1, every new action ships
through the same argument shape + NOT-NULL guards, so a drifted Python
caller fails loudly rather than writing a malformed row. A2 would have
required every caller to re-implement the validation, and divergent
validation is exactly the kind of drift the taxonomy is meant to prevent.

Python wrapper
--------------
`analytics-service/services/audit.py`:
```python
def log_audit_event(
    user_id: UUID,
    action: str,
    entity_type: str,
    entity_id: UUID,
    metadata: dict | None = None,
) -> None:
    """Fire-and-forget audit emission. Swallows all errors; never raises."""
```
Callable from any Python router or service; uses the existing supabase-py
service-role client. Same `[audit]`-prefixed stderr logging convention
as the TS side so log aggregation can cross-grep both layers.

TypeScript service-role helper
------------------------------
`logAuditEventAsUser(adminClient, actingUserId, event)` in
`src/lib/audit.ts` calls the same RPC from TS routes that operate with
the admin client but still have a trusted acting-user id (e.g., the
email-ack path at `/api/alerts/ack` where the HMAC-signed token is the
proof of the acting user, not a browser JWT).

Emission sites
--------------
Task 7.1b added 4 new Python emission sites; the TS email-ack path
(`alerts/ack` POST) was extended with `logAuditEventAsUser` (not a new
emission site — `alert.acknowledge` was already emitted from
`portfolio-alerts` PATCH for the in-app path).

- `analytics-service/routers/portfolio.py::portfolio_bridge`
  → `bridge.score_candidates`
- `analytics-service/routers/simulator.py::portfolio_simulator`
  → `simulator.run`
- `analytics-service/routers/portfolio.py::portfolio_optimizer`
  → `optimizer.run`
- `analytics-service/services/job_worker.py::run_reconcile_strategy_job`
  → `reconcile.compare`
- `src/app/api/alerts/ack/route.ts` → `alert.acknowledge` (email path;
  extends the existing in-app emission with a service-role variant)

## Consequences

### Positive
- Audit emission sites are uniform, greppable, and compile-time-checked
  against a single enum.
- Tamper-proofness is enforced at the DB layer, not by application
  convention.
- Fire-and-forget emission doesn't tax request latency.
- Cross-service story is documented in advance so Task 7.1b doesn't
  re-litigate.

### Negative
- The NULL-entity_id escape hatch (disallowed here) pushes some signals
  into PostHog instead of audit_log; a future compliance auditor may
  ask "why isn't login in audit_log?" and we need to answer consistently.
- The `after()`-based emitter is not durable — a crash between
  response-flush and RPC-complete drops the event. Acceptable for
  v1 (matches the rest of the codebase's PostHog/notification fire-and-
  forget pattern), but tracked as tech debt if compliance escalates.
- Every new mutation site must remember to emit. There is no
  compile-time enforcement linking "you mutated X" to "you emitted an
  audit row". Code review is the only gate.

## Evidence
- Migration 010: `audit_log` table schema and original RLS policies.
  `supabase/migrations/010_portfolio_intelligence.sql` (lines 66-75,
  178-182).
- Migration 049: deny policies + `log_audit_event` RPC.
  `supabase/migrations/049_audit_log_hardening.sql`.
- TypeScript emitter: `src/lib/audit.ts`.
- Unit tests (fire-and-forget contract):
  `src/lib/audit.test.ts`.
- Integration tests (RLS deny + owner SELECT):
  `src/__tests__/audit-log-rls.test.ts`.
- Pilot event sites:
  - `src/app/api/keys/[id]/permissions/route.ts` (`api_key.decrypt`)
  - `src/app/api/intro/route.ts` (`intro.send`)
  - `src/app/api/account/deletion-request/route.ts`
    (`deletion.request.create`)
- ADR-0010 observability budget (context for error-log routing):
  `docs/architecture/adr-0010-observability.md`.
- ADR-0014 secret handling (context for why `api_key.decrypt` exists):
  `docs/architecture/adr-0014-secret-handling.md`.

## Phase 09 — Bridge Live Against Real Holdings

Migration 072 adds `match_decisions.original_holding_ref TEXT NULL` as a sibling key to
`original_strategy_id`, enforced XOR (exactly one non-null per row) via
`match_decisions_original_xor` CHECK. For holdings-sourced Bridge decisions the scope_ref
format is `holding:{venue}:{symbol}:{holding_type}` (matches Phase 08 D-08 note scope_ref
verbatim). SQLSTATE 23514 is raised on any INSERT or UPDATE that sets both columns or
neither column.

Migration 072 also widens `bridge_outcomes_unique_per_strategy` →
`bridge_outcomes_unique_per_strategy_holding` to permit two different holdings to record
outcomes against the same top-candidate strategy. A denormalized
`bridge_outcomes.original_holding_ref TEXT` column + `bridge_outcomes_sync_holding_ref_trigger`
mirror the value from `match_decisions` at INSERT/UPDATE time. Postgres requires IMMUTABLE
index expressions — sub-selects are not permitted — so the denormalized-column + trigger
fallback from finding f4 is the approved approach for Postgres 17. Same (allocator, strategy,
holding_ref) triple is still rejected with SQLSTATE 23505.

Migration 072 adds `match_batches.holding_flags JSONB NOT NULL DEFAULT '[]'::jsonb` as the
persistence seam between the analytics-service engine (writes per-holding flag rows during
`score_candidates` in Plan 09-02) and the Next.js SSR dashboard (reads via
`getMyAllocationDashboard` in Plan 09-03). Each array entry carries: `holding_ref`,
`value_usd`, `weight`, `breach_reasons[]`, `top_candidate_strategy_id`,
`top_candidate_composite`, `flagged`.

Migration 073 extends `compute_bridge_outcome_deltas()` with a holding-ref branch that reads
per-symbol USD value from `allocator_equity_snapshots.breakdown` when
`original_holding_ref IS NOT NULL`. New helper functions `extract_symbol_value_at` and
`parse_holding_ref` support this branch. Migration 073 also converts the strategy branch from
INNER JOIN to LEFT JOIN + OR filter so legacy `bridge_outcomes` rows where
`match_decision_id IS NULL` (set NULL via ON DELETE SET NULL cascade) continue to be processed
by the cron (finding f3 regression preserved).

**No new audit event kind is registered.** The action being audited ("Bridge outcome
recorded") is identical regardless of source; only the entity pointer varies, carried through
existing `metadata.match_decision_id`. The existing `match.decision_record` kind
(`src/lib/audit.ts`) carries both strategy-sourced and holding-sourced decisions unchanged.

Reference: `.planning/phases/09-bridge-live-against-real-holdings/09-CONTEXT.md` §D-14.

## Phase 10 — Scenario Builder and What-If

Migration 080 relaxes the Phase 09 `match_decisions_original_xor` CHECK and replaces it with a
new `match_decision_kind` enum column gated by four per-kind invariant CHECK constraints. The
enum carries four values: `bridge_recommended` (existing rows backfill into this — the
Phase 09 XOR shape preserved), `voluntary_remove` (allocator toggled a holding off in the
Scenario tab — `original_holding_ref` set, both strategy fields NULL), `voluntary_add`
(allocator added a strategy via Browse drawer — `suggested_strategy_id` set, both
`original_*` NULL), and `voluntary_modify` (pure weight-change on an existing holding —
`original_holding_ref` set, `suggested_strategy_id` NULL). The four CHECK constraints
(`match_decisions_kind_bridge_recommended`, `match_decisions_kind_voluntary_remove`,
`match_decisions_kind_voluntary_add`, `match_decisions_kind_voluntary_modify`) replace the
old XOR with kind-aware invariants. Pre-Phase-10 rows backfill to `bridge_recommended` with a
`DEFAULT 'bridge_recommended'` on the column so all existing INSERT call sites remain
backward-compatible. The migration's self-verifying DO block additionally asserts (L1) every
existing row passes all four CHECKs and (M2) no backfilled `bridge_recommended` row has both
`original_*` columns NULL.

Migration 080 also extends `compute_bridge_outcome_deltas()` with a third CTE branch
(`voluntary_add_candidates` / `voluntary_add_computed` / `voluntary_add_updated`) matching
`md.kind = 'voluntary_add'` and joining on `suggested_strategy_id` against
`strategy_analytics.returns_series` via the same `extract_delta` / `extract_estimated`
helpers the strategy branch uses. Without this third branch, voluntary_add rows satisfy
neither existing branch (both `original_*` are NULL — the holding branch needs
`original_holding_ref` and the strategy branch needs `original_strategy_id`) and would
silently never accrue `delta_30d/90d/180d`. The `bridge_outcomes` row for a voluntary_add
keeps `kind='allocated'` so the existing UI banner contract is unchanged. The DO block
asserts the new CTE name is reachable in `pg_proc.prosrc`.

Migration 081 lands atomically alongside 080 to relax `bridge_outcomes` for voluntary kinds.
`strategy_id` becomes NULL-able (voluntary_remove rows have no replacement strategy). The
migration-072 widened unique index `bridge_outcomes_unique_per_strategy_holding` is dropped
and replaced with `bridge_outcomes_allocator_match_decision_unique` on
`(allocator_id, match_decision_id)` — the natural per-decision key now that voluntary kinds
with NULL `strategy_id` exist. Strategy-sourced rows continue to enforce 1-per-decision via
the new key (every `bridge_outcome` FKs to exactly one `match_decision` by construction).
The migration-059 `bridge_outcomes_kind_fields_valid` consolidated CHECK is split into two
named constraints `bridge_outcomes_kind_allocated` and `bridge_outcomes_kind_rejected` that
require either `strategy_id NOT NULL` or `match_decision_id NOT NULL` (so voluntary kinds
remain anchored even with NULL `strategy_id`). `bridge_outcomes.kind` itself is unchanged —
voluntary_remove uses `kind='rejected'` (with `rejection_reason='underperforming_peers'` or
similar from the Scenario commit drawer) and voluntary_add uses `kind='allocated'`. The
"voluntary" semantic lives on `match_decisions.kind`, not on `bridge_outcomes.kind`.

Migration 082 ships the `commit_scenario_batch(p_allocator_id uuid, p_diffs jsonb)
RETURNS jsonb` SECURITY DEFINER RPC that the Plan 07 `POST /api/allocator/scenario/commit`
route delegates to for the H4 single-tx invariant (CONTEXT D-09 — single Postgres
transaction). The RPC enforces `auth.uid() = p_allocator_id` at function entry (defence-in-
depth alongside the route's `withAuth`), runs per-row ownership probes against
`allocator_holdings` for kinds that carry a `holding_ref` (voluntary_remove +
voluntary_modify + bridge_recommended) and per-row strategy-status probes against
`strategies` for kinds that carry a `strategy_id` (voluntary_add + bridge_recommended). For
the bridge_recommended path it runs M7 reuse-or-create — `SELECT id FROM match_decisions
WHERE (allocator_id, original_holding_ref, suggested_strategy_id) = (...) AND
kind='bridge_recommended' LIMIT 1`; on a hit it reuses the existing match_decision id (no
new INSERT, so the migration-074 widened unique indexes on (allocator_id, strategy_id,
COALESCE(original_holding_ref, '')) for `decision IN ('thumbs_up','thumbs_down')` are not
violated by retry); on a miss it INSERTs a new row. Any `RAISE EXCEPTION` inside the loop
rolls back the entire batch (single Postgres transaction = single tx scope = all-or-nothing
H4). The RPC returns `{ ok: true, recorded: [{index, match_decision_id, bridge_outcome_id,
kind}, ...] }` on success. Authorisation: `REVOKE ALL FROM PUBLIC, anon` + `GRANT EXECUTE
TO authenticated` only. `SET search_path = public, pg_temp` blocks schema-shadowing
attacks. The self-verifying DO block asserts `prosecdef = t`, `proconfig` includes
`search_path=public`, the auth.uid() guard string is present in `prosrc`, and the EXECUTE
grant matrix is correct.

**No new audit event kind is registered for Phase 10.** The existing `match.decision_record`
kind in `src/lib/audit.ts` carries voluntary diffs unchanged via the existing
`metadata.match_decision_id` field; the new `match_decisions.kind` value is captured as
`metadata.kind` (`bridge_recommended` | `voluntary_remove` | `voluntary_add` |
`voluntary_modify`) per the Phase 09 D-14 precedent for kind metadata in `audit_log.metadata`.
The action being audited ("Bridge outcome recorded" / "Scenario decision committed") is
identical regardless of kind — auditors filter on `metadata.kind` to slice voluntary vs
recommended traffic.

Reference: `.planning/phases/10-scenario-builder-and-what-if/10-CONTEXT.md` §D-10/D-11/D-17
and `.planning/phases/10-scenario-builder-and-what-if/10-02-PLAN.md` (migration 080 + 081 + 082
trio + atomic D-23 commit cadence).

Migration 083 ships three review-pass hardening fixes on top of the 080/081/082 trio: (1) the
M7 reuse-or-create path inside `commit_scenario_batch` switches from a SELECT-then-conditional-INSERT
sequence to `INSERT ... ON CONFLICT (allocator_id, strategy_id, COALESCE(original_holding_ref, ''))
WHERE decision='thumbs_up' DO UPDATE ... RETURNING id` targeting migration 074's
`uniq_match_dec_thumbup_per_pair_holding` partial UNIQUE index, so two concurrent commits with
the same `bridge_recommended` tuple collapse to ONE `match_decisions` row instead of one
winner + one unique-violation; (2) the self-verifying DO block now qualifies all `pg_proc`
lookups via `'public.commit_scenario_batch(uuid,jsonb)'::regprocedure` so a same-name function
in a different schema cannot confuse the assertion path; (3) a partial UNIQUE index
`bridge_outcomes_legacy_per_strategy_holding_when_md_null` on
`(allocator_id, strategy_id, COALESCE(original_holding_ref, ''))` `WHERE match_decision_id IS NULL`
restores migration 072's per-strategy invariant for any strategy-sourced `bridge_outcomes` row
whose `match_decision_id` link was nulled out via the `ON DELETE SET NULL` cascade — migration 081
moved the bridge_outcomes UNIQUE to `(allocator_id, match_decision_id)` which over Postgres's
NULL-distinct semantics no longer blocks duplicate legacy-shape rows when `match_decision_id`
is NULL. Pre-flight verification (Supabase Management API on 2026-04-26) confirmed zero
existing duplicates. **No new audit event kind is registered for Migration 083.** The
match-decision-record action remains the audited unit; the M7 reuse-or-create just folds the
race-loser onto the same `match_decision_id` (and therefore the same audit row) the winner
already wrote.

Reference: `supabase/migrations/083_commit_scenario_batch_race_fix.sql`,
`src/__tests__/scenario-commit-batch-race.test.ts`.

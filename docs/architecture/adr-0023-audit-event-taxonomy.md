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
  | "portfolio_note.update"
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
| `portfolio_note.update` | `portfolio_note` | `portfolios.id` (user_notes composite PK on (user_id, portfolio_id)) | content_length |
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

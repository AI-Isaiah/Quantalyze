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
The authoritative enum lives in `src/lib/audit.ts`:

```ts
export type AuditAction =
  | "api_key.decrypt"
  | "intro.send"
  | "deletion.request.create";
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

### 4. Action → entity_type mapping (Sprint 6 closeout pilot)

| Action | entity_type | entity_id source |
|--------|-------------|------------------|
| `api_key.decrypt` | `api_key` | `api_keys.id` (the key whose ciphertext was decrypted) |
| `intro.send` | `contact_request` | `contact_requests.id` (the newly inserted intro row) |
| `deletion.request.create` | `data_deletion_request` | `data_deletion_requests.id` (the intake row) |

Task 7.1b (Sprint 6 later, ~27 additional events) will extend this
table. Keep the update atomic with the emission-site PR so a grep for
`audit.ts` action strings returns the same list as this ADR.

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

### 7. Fire-and-forget emission, <10ms p99
Per ADR-0010's observability budget, audit emission must not appear in
the request's tail latency. `logAuditEvent()` in `src/lib/audit.ts`:
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
Task 7.1b extends audit emission into the Python analytics-service for
actions that originate there (e.g., `bridge.score_candidates`,
`compute_job.complete`). The locked approach is **Option A: supabase-py
calls the RPC directly**.

Implementation constraint: the Python side runs with service_role
credentials, so `auth.uid()` inside the RPC is NULL and the current
signature will raise. Two options for Task 7.1b:

- **A1**: Pass the acting user_id as RPC argument (extending the
  signature). This re-opens the spoofing question — mitigate by
  restricting the extended RPC to service_role only via a REVOKE pattern
  similar to `defer_compute_job` (migration 033).
- **A2**: Insert directly into `audit_log` with the admin client
  (service_role bypasses RLS for INSERT). Simpler; matches the
  existing `audit_log_service_insert` policy but skips the RPC's
  signature validation.

Task 7.1b picks between A1/A2 after a short Grok adversarial pass.

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
- ADR-0010 observability budget (context for <10ms p99):
  `docs/architecture/adr-0010-observability.md`.
- ADR-0014 secret handling (context for why `api_key.decrypt` exists):
  `docs/architecture/adr-0014-secret-handling.md`.

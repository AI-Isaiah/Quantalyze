import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";

/**
 * Fire-and-forget audit event emitter.
 *
 * Sprint 6 closeout Task 7.1a (pilot: 3 events + `log_audit_event` RPC).
 * Sprint 6 closeout Task 7.1b (fanout: 17 additional TS events + 4
 * Python events via the service-role `log_audit_event_service` RPC —
 * migration 058).
 *
 * Writes to the `audit_log` table via one of two SECURITY DEFINER RPCs:
 *
 * 1. `log_audit_event(p_action, p_entity_type, p_entity_id, p_metadata)`
 *    — derives user_id from `auth.uid()` inside Postgres (migration 049).
 *    A malicious caller CANNOT spoof user attribution — the only thing
 *    the TS layer provides is the action/entity triple + metadata. Use
 *    `logAuditEvent(userScopedClient, ...)` for this path.
 *
 * 2. `log_audit_event_service(p_user_id, p_action, p_entity_type,
 *    p_entity_id, p_metadata)` — caller supplies user_id. EXECUTE is
 *    service_role only (migration 058). Used by admin routes that
 *    operate with the service-role client but still need to attribute
 *    the event to the acting admin (e.g., email-ack paths where no user
 *    JWT is on the wire, or paths that have already resolved the acting
 *    user from a signed token). Use `logAuditEventAsUser(adminClient,
 *    actingUserId, ...)` for this path.
 *
 * Design constraints
 * ------------------
 * 1. Non-blocking emission. The caller's response must not gate on the
 *    audit round-trip. We schedule the RPC via `after()` (Next 16) which
 *    on Vercel uses `waitUntil(promise)` semantics — the function
 *    instance stays alive until the promise settles even after the
 *    response has flushed, so the event is never lost to a cold-finish.
 * 2. Never throws to the caller. An audit emission failure must NOT
 *    propagate into a 500 response or break a user-facing flow.
 *    Errors are caught and logged to stderr for operator diagnosis.
 * 3. No silent drops. Every failure path emits a `console.error` with
 *    a stable prefix `[audit]` so log aggregation can grep for dropped
 *    events and surface a metric.
 *
 * `after()` is only valid inside a request scope (route handlers, Server
 * Actions, middleware). If this module is ever imported from a non-request
 * server context (cron worker, Server Component prerender), `after()`
 * throws synchronously — we catch and fall back to `queueMicrotask` so
 * the emission still attempts a best-effort background write rather than
 * surfacing the scheduling error to the caller.
 *
 * Taxonomy
 * --------
 * Action strings are namespaced `<subject>.<verb>` (e.g. `api_key.decrypt`,
 * `intro.send`, `deletion.request.create`). See `docs/architecture/
 * adr-0023-audit-event-taxonomy.md` for the canonical enum + entity_type
 * mapping.
 *
 * Typical call site
 * -----------------
 *   import { logAuditEvent } from "@/lib/audit";
 *
 *   const supabase = await createClient();
 *   // ... existing work, user-facing response builds up ...
 *   logAuditEvent(supabase, {
 *     action: "intro.send",
 *     entity_type: "contact_request",
 *     entity_id: inserted.id,
 *     metadata: { source, strategy_id },
 *   });
 *   return NextResponse.json({ success: true });
 *
 * The call returns `void`, not a Promise. Do not await it; there is
 * nothing to await.
 */

/**
 * The canonical action string enum. Namespaced `subject.verb` so the
 * taxonomy stays grep-able and we can fan out later without colliding.
 *
 * Sprint 6 pilot (Task 7.1a) shipped the first three actions. Tasks 7.2
 * + 7.3 added the RBAC grant/revoke + GDPR workflow actions. Task 7.1b
 * fans out to the remaining mutation sites (TS + Python). Keep this
 * union in sync with `docs/architecture/adr-0023-audit-event-taxonomy.md`.
 */
export type AuditAction =
  // --- 7.1a pilot -------------------------------------------------------
  | "api_key.decrypt"
  | "intro.send"
  | "deletion.request.create"
  // --- 7.2 RBAC --------------------------------------------------------
  | "role.grant"
  | "role.revoke"
  // --- 7.3 GDPR workflow -----------------------------------------------
  | "account.sanitize"
  | "account.export"
  | "deletion.request.approve"
  | "deletion.request.reject"
  // --- 7.1b TS fanout --------------------------------------------------
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
  // --- /review follow-up (T4-C1 + T4-M6) ------------------------------
  | "lead.process"
  | "lead.unprocess"
  | "sync.start"
  // --- 7.1b Python cross-service (via log_audit_event_service) --------
  | "bridge.score_candidates"
  | "simulator.run"
  | "optimizer.run"
  | "reconcile.compare"
  // --- Bridge outcome tracker -----------------------
  | "bridge_outcome.record"
  | "bridge_outcome.update"
  | "bridge_outcome.dismiss";

/**
 * entity_type values are one per action. See ADR-0023 for the mapping.
 * Kept as a string literal union so a typo fails at compile time.
 *
 * `user` is the anchor for account-wide actions where the "entity" is
 * the target user themselves (account.sanitize, account.export). The
 * entity_id in that case is the target user's auth.users.id.
 */
export type AuditEntityType =
  // --- 7.1a / 7.2 / 7.3 -----------------------------------------------
  | "api_key"
  | "contact_request"
  | "data_deletion_request"
  | "user_app_role"
  | "user"
  // --- 7.1b fanout entities -------------------------------------------
  | "allocation"
  | "portfolio_document"
  | "alert"
  | "system_flag"
  | "match_decision"
  | "strategy"
  | "partner_import"
  | "portfolio_note"
  | "investor_attestation"
  | "trades_upload"
  // --- /review follow-up (T4-C1 + T4-M6) ------------------------------
  | "for_quants_lead"
  | "sync"
  // --- 7.1b Python cross-service entities -----------------------------
  | "bridge_run"
  | "simulator_run"
  | "optimizer_run"
  | "reconcile_run"
  // --- Bridge outcome tracker -----------------------
  | "bridge_outcome"
  | "bridge_outcome_dismissal";

export interface AuditEvent {
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id: string;
  metadata?: Record<string, unknown>;
}

/**
 * Emit an audit event via the user-scoped path.
 *
 * Returns void — the call is fire-and-forget. The provided `client`
 * should be the user-scoped Supabase client (typically the client from
 * `createClient()` bound to the caller's JWT). The `log_audit_event`
 * RPC derives user_id from `auth.uid()` internally, so passing an admin
 * (service-role) client here would result in a NULL auth.uid() and the
 * RPC would raise — use `logAuditEventAsUser` for admin paths instead.
 */
export function logAuditEvent(
  client: SupabaseClient,
  event: AuditEvent,
): void {
  try {
    after(() => emit(client, event));
  } catch {
    // Outside a request scope (cron, prerender) `after()` throws. Fall
    // back to a microtask so the emission still attempts a best-effort
    // background write. The event may still drop on cold-finish here,
    // but that path is non-route and rare.
    queueMicrotask(() => {
      void emit(client, event);
    });
  }
}

/**
 * Emit an audit event via the service-role path with a caller-supplied
 * user_id for attribution.
 *
 * Use this ONLY when the route operates with a service-role client AND
 * has a trusted source for `actingUserId` (e.g., an admin route where
 * the caller's JWT has been validated by an earlier auth gate, or an
 * email-ack path where the HMAC token is the proof of the acting user).
 *
 * Calls `log_audit_event_service` (migration 058) which is EXECUTE-
 * granted to service_role only — a user JWT that somehow reached this
 * code path cannot actually write to audit_log through this RPC.
 *
 * Returns void — fire-and-forget, same semantics as `logAuditEvent`.
 */
export function logAuditEventAsUser(
  adminClient: SupabaseClient,
  actingUserId: string,
  event: AuditEvent,
): void {
  try {
    after(() => emitAsUser(adminClient, actingUserId, event));
  } catch {
    queueMicrotask(() => {
      void emitAsUser(adminClient, actingUserId, event);
    });
  }
}

/**
 * Inner async emitter for the user-scoped path. Catches all failures;
 * never re-throws. Exported for direct testing of the failure-swallowing
 * contract — production callers should use `logAuditEvent`.
 */
export async function emit(
  client: SupabaseClient,
  event: AuditEvent,
): Promise<void> {
  try {
    const { error } = await client.rpc("log_audit_event", {
      p_action: event.action,
      p_entity_type: event.entity_type,
      p_entity_id: event.entity_id,
      p_metadata: event.metadata ?? {},
    });

    if (error) {
      console.error(
        "[audit] log_audit_event RPC returned error (dropping):",
        {
          action: event.action,
          entity_type: event.entity_type,
          entity_id: event.entity_id,
          code: error.code,
          message: error.message,
        },
      );
    }
  } catch (err) {
    console.error(
      "[audit] log_audit_event call threw (dropping):",
      {
        action: event.action,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        message: err instanceof Error ? err.message : String(err),
      },
    );
  }
}

/**
 * Inner async emitter for the service-role path. Catches all failures;
 * never re-throws. Exported for direct testing of the failure-swallowing
 * contract — production callers should use `logAuditEventAsUser`.
 */
export async function emitAsUser(
  adminClient: SupabaseClient,
  actingUserId: string,
  event: AuditEvent,
): Promise<void> {
  try {
    const { error } = await adminClient.rpc("log_audit_event_service", {
      p_user_id: actingUserId,
      p_action: event.action,
      p_entity_type: event.entity_type,
      p_entity_id: event.entity_id,
      p_metadata: event.metadata ?? {},
    });

    if (error) {
      console.error(
        "[audit] log_audit_event_service RPC returned error (dropping):",
        {
          action: event.action,
          entity_type: event.entity_type,
          entity_id: event.entity_id,
          user_id: actingUserId,
          code: error.code,
          message: error.message,
        },
      );
    }
  } catch (err) {
    console.error(
      "[audit] log_audit_event_service call threw (dropping):",
      {
        action: event.action,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        user_id: actingUserId,
        message: err instanceof Error ? err.message : String(err),
      },
    );
  }
}

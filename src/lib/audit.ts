import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";

/**
 * Fire-and-forget audit event emitter.
 *
 * Sprint 6 closeout Task 7.1a. Writes to the `audit_log` table via the
 * `log_audit_event` SECURITY DEFINER RPC (migration 049). The RPC derives
 * `user_id` from `auth.uid()` inside Postgres so a malicious caller
 * cannot spoof user attribution — the only thing the TS layer provides
 * is the action/entity triple + metadata.
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
 * Sprint 6 ships the 3 pilot actions. Task 7.1b (Sprint 6 later) fans
 * out ~27 more. Keep this union in sync with
 * `docs/architecture/adr-0023-audit-event-taxonomy.md`.
 */
export type AuditAction =
  | "api_key.decrypt"
  | "intro.send"
  | "deletion.request.create"
  | "role.grant"
  | "role.revoke";

/**
 * entity_type values are one per action. See ADR-0023 for the mapping.
 * Kept as a string literal union so a typo fails at compile time.
 */
export type AuditEntityType =
  | "api_key"
  | "contact_request"
  | "data_deletion_request"
  | "user_app_role";

export interface AuditEvent {
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id: string;
  metadata?: Record<string, unknown>;
}

/**
 * Emit an audit event. Returns void — the call is fire-and-forget.
 *
 * The provided `client` should be the same Supabase client the caller
 * is already using for the surrounding request (typically the
 * user-scoped client created by `createClient()`). The RPC derives
 * user_id from `auth.uid()` internally, so passing an admin client
 * here would result in a NULL auth.uid() and the RPC would raise.
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
 * Inner async emitter. Catches all failures; never re-throws.
 * Exported for direct testing of the failure-swallowing contract —
 * production callers should use `logAuditEvent`.
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

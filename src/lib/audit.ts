import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";

/**
 * Audit-emission failure classification (P701 / P702).
 *
 * Lane C added the same typed dispatch to the Python `audit.py`. The TS
 * side now mirrors that contract: rather than blanket-swallowing every
 * emit failure, classify the error and choose `rethrow` vs `swallow`
 * based on the failure mode.
 *
 *   - PERMISSION_DENIED (PostgREST code `42501`) — caller lost the right
 *     to write to audit_log (auth regression, RPC EXECUTE grant drift,
 *     RLS lockout). NEVER benign. Re-throw — surfaces as an unhandled
 *     rejection captured by Sentry and visible in Vercel function logs.
 *     Sentry-tagged `audit_permission_denied=true`. See "What rethrow
 *     does NOT do" below.
 *   - TRANSIENT (fetch failure, AbortError, TypeError: fetch failed,
 *     etc.) — infra blip on the supabase REST path. Bumping a module-
 *     local counter (`auditEmitTransientFailures`) lets `/api/health`
 *     surface a metric without exporting a global. Do NOT rethrow —
 *     a network blip is the one case where breaking the parent compute
 *     would be worse than the missed audit row. Sentry-tagged
 *     `audit_emit_transient=true`.
 *   - UNKNOWN — anything else (schema drift, RPC raising a runtime
 *     error, etc.). Re-throw per project rule 12 (fail loud). Sentry-
 *     tagged with the default tag set.
 *
 * Why this is critical: pre-fix, `emit()` caught every error and only
 * `console.error`-logged it. A silent RPC permission_denied (e.g., the
 * EXECUTE grant on `log_audit_event` getting dropped by a future
 * migration) would have looked like every audit row writing successfully
 * — the route returns 200 and Sentry sees nothing. P701/P702 close that
 * gap.
 *
 * What rethrow does NOT do (Issue 2 — audit-2026-05-07 follow-up)
 * ---------------------------------------------------------------
 * The fire-and-forget wrappers (`logAuditEvent`, `logAuditEventAsUser`)
 * schedule the emit via `after(() => emit(...))`. On Vercel, `after()`
 * runs the callback AFTER the HTTP response has flushed. As a result,
 * a thrown `permission_denied` or `unknown` error from `emit()`:
 *
 *   - is CAUGHT by the runtime as an unhandled promise rejection,
 *   - is REPORTED to Sentry (via the in-emit reportToSentry call AND the
 *     runtime's default unhandled-rejection hook),
 *   - is VISIBLE in Vercel function logs with the stable `[audit]` prefix,
 *   - but does NOT change the user-facing HTTP response (the response was
 *     already flushed). The route handler never observes the throw.
 *
 * In other words: "re-throw" is a diagnostic signal, not a control-flow
 * mechanism. The route returns the same status code it would have returned
 * with no audit-emit failure. To get a 500 on audit failures, callers must
 * invoke `emit()` (or `emitAsUser()`) synchronously and `await` it BEFORE
 * building the response — which is intentionally not the default path
 * because it would gate user-facing latency on the audit round-trip.
 *
 * The classification logic is still valuable even under `after()`: Sentry
 * captures every failure with the right level + tags, the transient
 * counter still increments for `/api/health`, and log aggregation can
 * still grep `[audit]` for forensic review. The contract above is about
 * what rethrow means in the fire-and-forget call path — NOT how to
 * propagate audit failures to the HTTP boundary.
 */
export type AuditEmitErrorKind =
  | "permission_denied"
  | "transient"
  | "unknown";

/**
 * Module-local counter of transient audit emission failures. Reset only
 * by process restart. Read by `/api/health` (or any in-process observer)
 * via {@link getAuditEmitTransientFailures}; the test suite asserts the
 * counter bumps after a synthesized fetch-failure.
 */
let auditEmitTransientFailures = 0;

/**
 * Read the module-local transient-failure counter. Exposed for tests
 * and observability; production code should NOT branch on the value.
 */
export function getAuditEmitTransientFailures(): number {
  return auditEmitTransientFailures;
}

/** Test-only reset hook. Not exported via barrel; tests import directly. */
export function __resetAuditEmitTransientFailuresForTests(): void {
  auditEmitTransientFailures = 0;
}

/**
 * Heuristically classify an emit failure. Inputs:
 *   - `err` — the thrown exception (TypeError, AbortError, custom Error,
 *     unknown).
 *   - `rpcError` — the PostgREST error object returned in `{ error }`
 *     from `supabase.rpc(...)`. May be null when the failure is a
 *     thrown exception path.
 *
 * Classification precedence:
 *   1. `rpcError.code === "42501"` → permission_denied.
 *   2. Thrown TypeError matching `fetch failed` → transient (Node's
 *      undici fetch wraps EAI_AGAIN / ECONNRESET / network down as
 *      `TypeError: fetch failed`). AbortError → transient (timeout).
 *      DOMException with name `AbortError` → transient.
 *   3. Anything else → unknown.
 *
 * The classifier is conservative: a PostgREST 500 (schema drift) lands
 * in `unknown` and re-throws, surfacing in Sentry as a fail-loud event.
 */
export function classifyAuditEmitError(
  err: unknown,
  rpcError: { code?: string | null } | null,
): AuditEmitErrorKind {
  if (rpcError && rpcError.code === "42501") {
    return "permission_denied";
  }
  if (err instanceof Error) {
    if (err.name === "AbortError") return "transient";
    if (err instanceof TypeError && /fetch failed/i.test(err.message)) {
      return "transient";
    }
    // Some runtimes throw DOMException; the name check above covers it.
  }
  return "unknown";
}

/**
 * Wrap a `Sentry.captureException` call so a Sentry transport failure
 * (DSN misconfig, network down) never masks the original audit-emit
 * exception. Mirrors the lazy-import pattern in
 * `src/app/api/for-quants-lead/route.ts` and `src/app/error.tsx`.
 */
function reportToSentry(
  err: unknown,
  options: {
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    level?: "fatal" | "error" | "warning";
  } = {},
): void {
  try {
    void import("@sentry/nextjs")
      .then((Sentry) => {
        try {
          Sentry.captureException(err, options);
        } catch {
          // Sentry SDK threw — swallow. The caller has already logged
          // the original error to stderr via the stable `[audit]` prefix.
        }
      })
      .catch(() => {
        // Sentry import failed — swallow. Same reasoning.
      });
  } catch {
    // import() construction failed (extremely unlikely) — swallow.
  }
}

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
  // audit-2026-05-07 fix C-0067 (red-team conf-7): post-write observed-
  // state anchor emitted alongside role.grant / role.revoke on the
  // admin RBAC route. Records the boolean `holds_role` that THIS
  // request observed after the mutation re-read, giving forensic
  // reconstruction a stable signal when two admins race a concurrent
  // grant + revoke on the same (user_id, role) pair. See ADR-0023
  // entry for the full taxonomy + rationale.
  | "role.state_observed"
  // audit-2026-05-07 specialist-apply (code-reviewer HIGH + security HIGH +
  // silent-failure-hunter M-#4): the no-op revoke path (count=0 → 404) was
  // suppressing both role.revoke and role.state_observed audit rows to
  // close M-0287's false-success regression. The unintended consequence
  // is a silent role-enumeration channel (a compromised admin can probe
  // (user_id, role) pairs via revoke and observe 200 vs 404 with NO
  // forensic trace). `role.revoke_noop` records the operator's INTENT
  // (and the observed `was_held: false` outcome) while keeping the
  // role.revoke action reserved for actual state-changing revokes.
  | "role.revoke_noop"
  // audit-2026-05-07 specialist-apply (api-contract HIGH + code-reviewer
  // M-#4 + security #4): POST path now performs a profile-existence
  // check before mutation (mirrors GET) so missing-user maps to a 404
  // with code='user_not_found' uniformly. No new action needed for the
  // 404 itself (no mutation, no audit row), but listed here for
  // discoverability.
  // --- 7.3 GDPR workflow -----------------------------------------------
  | "account.sanitize"
  | "account.export"
  | "account.export_refused"
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
  // --- Phase 08: multi-scope notes (user_note.*) — replaces portfolio_note.update
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
  | "bridge_outcome.dismiss"
  // --- Sprint 8 Phase 2: Mandate profile builder ----------------------
  | "mandate_preference.update"
  | "mandate_preference.admin_update"
  // --- Sprint 8 Phase 4: Feedback loop ------------------------------------
  | "feedback.overrides_updated"
  // --- Phase 06: allocator API ingestion (INGEST-05 / INGEST-06 / INGEST-07) — D-18
  | "allocator.holdings.sync_requested"
  | "allocator.holdings.sync_completed"
  | "allocator.holdings.sync_failed"
  // --- Phase 16 / OBSERV-07: admin-gated diagnostic SSE endpoint ---
  | "debug_key_flow.invoke"
  // --- audit-2026-05-07 P700: break-glass ADMIN_EMAIL fallback grant ---
  | "admin.access.via_env_email_fallback";

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
  // --- Phase 08: multi-scope notes — replaces the legacy portfolio_note entity
  | "user_note"
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
  | "bridge_outcome_dismissal"
  // --- Sprint 8 Phase 2: Mandate profile builder ----------------------
  | "allocator_preference_mandate"
  // --- Sprint 8 Phase 4: Feedback loop ------------------------------------
  | "allocator_preference_feedback"
  // --- Phase 16 / OBSERV-07: admin-gated diagnostic SSE endpoint ---
  | "debug_session";

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
 *
 * Failure visibility (Issue 2): emit() runs inside `after()`, which on
 * Vercel executes AFTER the response flushes. A thrown failure surfaces
 * as a Sentry capture + `[audit]`-prefixed log entry — it does NOT change
 * the route response. Callers that need audit failure to gate the HTTP
 * status must call `emit()` (or `emitAsUser()`) directly with `await`.
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
 * Returns void — fire-and-forget, same semantics as `logAuditEvent`. See
 * the Issue 2 note on that function: any rethrown failure is only visible
 * via Sentry + Vercel logs and does NOT change the route response.
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
 * Inner async emitter for the user-scoped path. P701/P702: typed
 * dispatch — re-throws permission_denied and unknown failures, swallows
 * transient infra blips. Sentry is notified on every failure path with
 * appropriate tags. Exported for direct testing.
 */
export async function emit(
  client: SupabaseClient,
  event: AuditEvent,
): Promise<void> {
  let rpcError: { code?: string | null; message?: string } | null = null;
  let thrown: unknown = null;
  try {
    const { error } = await client.rpc("log_audit_event", {
      p_action: event.action,
      p_entity_type: event.entity_type,
      p_entity_id: event.entity_id,
      p_metadata: event.metadata ?? {},
    });
    rpcError = error;
  } catch (err) {
    thrown = err;
  }

  if (!rpcError && !thrown) return;

  const errForDispatch =
    thrown ??
    (rpcError
      ? Object.assign(
          new Error(
            `log_audit_event RPC error: ${rpcError.message ?? "(no message)"}`,
          ),
          { code: rpcError.code ?? undefined },
        )
      : new Error("log_audit_event unknown failure"));
  const kind = classifyAuditEmitError(thrown ?? rpcError, rpcError);

  const eventContext = {
    action: event.action,
    entity_type: event.entity_type,
    entity_id: event.entity_id,
  };

  if (kind === "permission_denied") {
    console.error(
      "[audit] log_audit_event permission_denied (re-throwing):",
      { ...eventContext, code: rpcError?.code, message: rpcError?.message },
    );
    reportToSentry(errForDispatch, {
      tags: {
        audit_permission_denied: "true",
        audit_path: "log_audit_event",
      },
      extra: eventContext,
      level: "fatal",
    });
    throw errForDispatch;
  }

  if (kind === "transient") {
    auditEmitTransientFailures += 1;
    console.error(
      "[audit] log_audit_event transient failure (swallowing):",
      {
        ...eventContext,
        message: thrown instanceof Error ? thrown.message : String(thrown),
        transient_failure_count: auditEmitTransientFailures,
      },
    );
    reportToSentry(errForDispatch, {
      tags: { audit_emit_transient: "true", audit_path: "log_audit_event" },
      extra: eventContext,
      level: "error",
    });
    return; // Do NOT rethrow — transient infra blip.
  }

  // kind === "unknown" — fail loud per project rule 12.
  console.error(
    "[audit] log_audit_event unknown failure (re-throwing):",
    {
      ...eventContext,
      code: rpcError?.code,
      message:
        rpcError?.message ??
        (thrown instanceof Error ? thrown.message : String(thrown)),
    },
  );
  reportToSentry(errForDispatch, {
    tags: { audit_path: "log_audit_event" },
    extra: eventContext,
    level: "error",
  });
  throw errForDispatch;
}

/**
 * Inner async emitter for the service-role path. Same typed-dispatch
 * contract as {@link emit} — re-throws permission_denied + unknown,
 * swallows transient. Exported for direct testing.
 */
export async function emitAsUser(
  adminClient: SupabaseClient,
  actingUserId: string,
  event: AuditEvent,
): Promise<void> {
  let rpcError: { code?: string | null; message?: string } | null = null;
  let thrown: unknown = null;
  try {
    const { error } = await adminClient.rpc("log_audit_event_service", {
      p_user_id: actingUserId,
      p_action: event.action,
      p_entity_type: event.entity_type,
      p_entity_id: event.entity_id,
      p_metadata: event.metadata ?? {},
    });
    rpcError = error;
  } catch (err) {
    thrown = err;
  }

  if (!rpcError && !thrown) return;

  const errForDispatch =
    thrown ??
    (rpcError
      ? Object.assign(
          new Error(
            `log_audit_event_service RPC error: ${rpcError.message ?? "(no message)"}`,
          ),
          { code: rpcError.code ?? undefined },
        )
      : new Error("log_audit_event_service unknown failure"));
  const kind = classifyAuditEmitError(thrown ?? rpcError, rpcError);

  const eventContext = {
    action: event.action,
    entity_type: event.entity_type,
    entity_id: event.entity_id,
    user_id: actingUserId,
  };

  if (kind === "permission_denied") {
    console.error(
      "[audit] log_audit_event_service permission_denied (re-throwing):",
      { ...eventContext, code: rpcError?.code, message: rpcError?.message },
    );
    reportToSentry(errForDispatch, {
      tags: {
        audit_permission_denied: "true",
        audit_path: "log_audit_event_service",
      },
      extra: eventContext,
      level: "fatal",
    });
    throw errForDispatch;
  }

  if (kind === "transient") {
    auditEmitTransientFailures += 1;
    console.error(
      "[audit] log_audit_event_service transient failure (swallowing):",
      {
        ...eventContext,
        message: thrown instanceof Error ? thrown.message : String(thrown),
        transient_failure_count: auditEmitTransientFailures,
      },
    );
    reportToSentry(errForDispatch, {
      tags: {
        audit_emit_transient: "true",
        audit_path: "log_audit_event_service",
      },
      extra: eventContext,
      level: "error",
    });
    return;
  }

  console.error(
    "[audit] log_audit_event_service unknown failure (re-throwing):",
    {
      ...eventContext,
      code: rpcError?.code,
      message:
        rpcError?.message ??
        (thrown instanceof Error ? thrown.message : String(thrown)),
    },
  );
  reportToSentry(errForDispatch, {
    tags: { audit_path: "log_audit_event_service" },
    extra: eventContext,
    level: "error",
  });
  throw errForDispatch;
}

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
 *
 * ── B4c: TWO-TIER EMISSION CONTRACT (H-0278 / M-1157) ──────────────────
 * Callers choose tier by which function they call — this IS the contract,
 * and the choice is deliberate per call site, not an accident:
 *
 *   1. DROP-TOLERANT (fire-and-forget): `logAuditEvent` /
 *      `logAuditEventAsUser`. Schedules via `after()` and returns `void`;
 *      NEVER throws to the caller. On Vercel `after()` holds the function
 *      alive (`waitUntil`) until the emit settles, so the request-scope
 *      path does not drop. The only residual drop is the non-request-scope
 *      `queueMicrotask` fallback (cron / prerender), which is logged with
 *      the `[audit]` prefix and accepted as best-effort. Use for
 *      high-volume, non-compliance events (analytics, note edits,
 *      portfolio updates) where an occasional missed row on a cold-finish
 *      is acceptable and not gating user latency on the audit round-trip
 *      is the priority.
 *   2. BLOCKING (fail-loud): `await emit(...)` / `await emitAsUser(...)`
 *      directly. These reject on hard failures (`permission_denied`,
 *      `unknown`, and — on the service path only — an unexpected `28000`),
 *      so a compliance-critical route can surface a 500 ("mutation succeeded
 *      but audit failed") and refuse to report success on a dropped audit row.
 *      The admin RBAC route (`admin/users/[id]/roles`) is the exemplar — it
 *      imports `emit as logAuditEvent` and `await`s it on the role-mutation
 *      path (C-0065). Use for role grants, GDPR approve/reject, and other
 *      forensically load-bearing mutations.
 *
 * H-0278 / M-1157 are CLOSED-BY-CONTRACT: the fire-and-forget drop is a
 * documented property of tier 1, and the blocking escape hatch (tier 2)
 * exists and is exercised for the compliance-critical paths the findings
 * named. There is no way to make tier 1 non-dropping without making it
 * blocking, which the design rejects (it would gate user latency on audit
 * I/O). Tests pin both: tier-1 never throws to the caller; tier-2 throws on
 * permission_denied.
 */
export type AuditEmitErrorKind =
  | "permission_denied"
  | "transient"
  // NEW-C10-04 (audit-2026-05-26 silent-failure): NULL auth.uid() from the
  // user-path RPC raises a distinct SQLSTATE 28000 (invalid_authorization_
  // specification) since migration 049-patch-1. An everyday expired/missing
  // JWT reaching the deferred `after()` path is non-fatal: the request
  // already responded, the user's session lapsed after response flush, and
  // the row drop is expected (the audit contract for that window). Do NOT
  // tag as `audit_permission_denied=true` — that tag is reserved for the
  // EXECUTE-grant-drift catastrophe (42501). See migration 049-patch-1.
  | "unauthenticated"
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
  // NEW-C10-04 (audit-2026-05-26): 28000 (invalid_authorization_specification)
  // is SQLSTATE raised by `log_audit_event` when auth.uid() IS NULL (migration
  // 049-patch-1). An expired JWT in the deferred `after()` path hits this code
  // every time the session lapses between response-flush and RPC settle — an
  // everyday occurrence, not a fatal permission_denied (42501 = EXECUTE-grant
  // drift). Classify separately so:
  //   (a) the `audit_permission_denied=true` tag is NOT emitted (reserved for
  //       real grant-drift so the Sentry alert rule remains signal, not noise),
  //   (b) the row drop is treated as non-fatal (the request succeeded; the
  //       audit window simply expired).
  //
  // H-3 (red-team 2026-05-26): check BOTH the rpcError path (PostgREST error
  // object) AND the thrown path (connection-level auth failure that rejects the
  // fetch promise before PostgREST returns a JSON body). When 28000 arrives as
  // a thrown exception the `err` carries `.code === "28000"` directly on the
  // Error object (set by Object.assign in emit()'s errForDispatch construction);
  // `rpcError` is null in that case. Without this second branch the thrown-path
  // 28000 falls through to `unknown` and re-throws as a fatal event, defeating
  // the noise-reduction goal of NEW-C10-04.
  if (rpcError && rpcError.code === "28000") {
    return "unauthenticated";
  }
  if (
    err instanceof Error &&
    (err as Error & { code?: string }).code === "28000"
  ) {
    return "unauthenticated";
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
 *
 * NEW-C10-03 (audit-2026-05-26 red-team): the prior implementation used
 * `void import(...)...` which returns synchronously — the in-flight
 * dynamic-import promise was detached before captureException resolved.
 * Under `after()` on a cold-finish the lambda can be reaped before Sentry
 * flushes, producing a double silent failure: no audit row AND no Sentry
 * event. Fixed by returning the import chain as a Promise (awaited by the
 * caller) so the `waitUntil` window stays open until capture settles.
 */
function reportToSentry(
  err: unknown,
  options: {
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    level?: "fatal" | "error" | "warning";
  } = {},
): Promise<void> {
  return import("@sentry/nextjs")
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
}

/**
 * Fire-and-forget audit event emitter.
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
 * SECURITY BOUNDARY — when to use this vs `logAuditEventAsUser`
 * ---------------------------------------------------------------
 * NEW-C10-01 (audit-2026-05-26): this function emits on the USER-SCOPED
 * client, so `auth.uid()` in Postgres is resolved from the caller's JWT.
 * For security-critical mutations (role grants, strategy approve/reject,
 * GDPR deletion, kill-switch) the JWT may expire between response flush
 * and `after()` settle (1 h default), causing a 42501 → row dropped.
 * Use `logAuditEventAsUser(adminClient, verifiedUserId, ...)` for those
 * paths — it uses the service-role client which is JWT-immune. Prefer
 * this function only for non-critical, high-volume events (analytics,
 * portfolio updates, note edits) where an occasional missed row is
 * acceptable and avoiding a service-role import is desirable.
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
 * Keep this union in sync with
 * `docs/architecture/adr-0023-audit-event-taxonomy.md`.
 */
export type AuditAction =
  // --- 7.1a pilot -------------------------------------------------------
  | "api_key.decrypt"
  | "intro.send"
  // silent-failure-hunter HIGH (review Finding 8): distinct action for the
  // was_already_sent=true path in /api/admin/match/send-intro. Emitted in place
  // of intro.send so forensics can distinguish first-send from re-send no-ops
  // (NEW-C34-03). entity_type mirrors intro.send (contact_request).
  | "intro.resend_noop"
  // audit-2026-05-07 red-team conf-8 (admin/match/send-intro): emitted on the
  // RPC error path so a 500-storm in `record_admin_introduction` is not
  // forensically invisible. Metadata mirrors the `intro.send` success shape
  // minus `contact_request_id` / `match_decision_id` (no row was written),
  // plus the RPC error code. See ADR-0023 for the full taxonomy.
  | "intro.send_failed"
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
  // H-0015 (audit 2026-05-25): a throttled GDPR export (429) emits this
  // so a credential-export probing storm leaves a forensic trail for
  // SecOps. Distinct from `account.export_refused` (which is a
  // post-rate-limit data-shape refusal) — this fires AT the rate-limit
  // gate. Emitted by POST /api/account/export.
  | "account.export_rate_limited"
  // audit-2026-05-07 C-0025: distinct from `account.export` (fresh job) so
  // forensics can tell when a GDPR bundle was re-signed (no new data) vs
  // generated. Emitted by GET /api/account/export/latest.
  | "account.export_resigned"
  | "deletion.request.approve"
  | "deletion.request.reject"
  // --- 7.1b TS fanout --------------------------------------------------
  | "allocation.update"
  | "contact_request.status_change"
  | "portfolio_document.create"
  | "alert.acknowledge"
  | "allocator.approve"
  | "manager.approve"
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
  | "admin.access.via_env_email_fallback"
  // --- audit-2026-05-07 (admin-auth cluster): forensic anchor emitted by
  //     withAdminAuth when an authenticated non-admin caller hits an
  //     /api/admin/* route. Pre-fix the 403 was issued with no audit row,
  //     making /api/admin/* privilege-probing forensically invisible. The
  //     row attributes the probe to the acting user (via
  //     log_audit_event_service) with the path/method/email of the probe.
  //     Unauthenticated callers (no user_id) do NOT emit this — see
  //     withAdminAuth.ts for the rationale. ---
  | "admin.access.denied";

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

/**
 * M-0491 / H-0423: the AUTHORITATIVE action→entity_type mapping (per
 * ADR-0023) AND the single source of truth the {@link AuditEvent}
 * discriminated union derives from. `as const satisfies Record<AuditAction,
 * AuditEntityType>` does two jobs at once:
 *   - `satisfies Record<AuditAction, AuditEntityType>` keeps the
 *     exhaustiveness + value-validity checks (TS errors if a new
 *     AuditAction has no entry here, or an entry maps to a value not in
 *     AuditEntityType).
 *   - `as const` (NOT a `: Record<...>` annotation — the annotation would
 *     WIDEN every value to the full AuditEntityType union and defeat the
 *     derivation) pins each value to its narrow literal entity_type, so
 *     `(typeof AUDIT_ACTION_ENTITY_TYPE_MAP)[A]` resolves to the single
 *     canonical entity_type for action `A`.
 *
 * H-0423 (audit-2026-05-07, B4c): because {@link AuditEvent} is now derived
 * from this map (each union arm pins `entity_type` to this table's value
 * for its `action`), a call site that pairs the WRONG entity_type — e.g.
 * `{ action: "role.grant", entity_type: "user" }` — is a COMPILE error, not
 * a silent JSONB drift. This map is the by-construction guarantee; before
 * B4c it was only a definition-site sentinel that prose-warned but did not
 * enforce pairing at call sites.
 *
 * M-0490 (DEFERRED, Rule 2): per-action metadata SHAPES are intentionally
 * NOT typed. Metadata is open/append-over-time and governed at runtime by
 * {@link capAuditMetadata}; the action↔entity_type axis is a closed/stable
 * 1:1 taxonomy invariant (closed here), metadata-key drift is a different
 * (runtime-payload) class. ADR-0023's table remains the metadata-key doc.
 *
 * To add a new action: add the literal to AuditAction, add its entity_type
 * to AuditEntityType if needed, then add the entry here. The compiler will
 * catch any of the three steps being omitted.
 */
export const AUDIT_ACTION_ENTITY_TYPE_MAP = {
  // 7.1a pilot
  "api_key.decrypt": "api_key",
  "intro.send": "contact_request",
  "intro.resend_noop": "contact_request",
  // B4c reconciliation: the FAILURE path has no contact_request row yet (the
  // RPC that would create it failed), so send-intro deliberately anchors the
  // forensic row to entity_type=strategy / entity_id=strategy_id (a stable
  // existing id). entity_type pairs with entity_id, so "strategy" — not the
  // intro.* family's "contact_request" — is the internally-consistent value.
  "intro.send_failed": "strategy",
  "deletion.request.create": "data_deletion_request",
  // 7.2 RBAC
  "role.grant": "user_app_role",
  "role.revoke": "user_app_role",
  "role.state_observed": "user_app_role",
  "role.revoke_noop": "user_app_role",
  // 7.3 GDPR workflow
  "account.sanitize": "user",
  "account.export": "user",
  "account.export_refused": "user",
  "account.export_rate_limited": "user",
  "account.export_resigned": "user",
  "deletion.request.approve": "data_deletion_request",
  "deletion.request.reject": "data_deletion_request",
  // 7.1b TS fanout
  "allocation.update": "allocation",
  "contact_request.status_change": "contact_request",
  "portfolio_document.create": "portfolio_document",
  "alert.acknowledge": "alert",
  "allocator.approve": "user",
  "manager.approve": "user",
  "notification_preferences.update": "user",
  "attestation.accept": "investor_attestation",
  // Phase 08: multi-scope notes
  "user_note.portfolio.update": "user_note",
  "user_note.holding.update": "user_note",
  "user_note.bridge_outcome.update": "user_note",
  "user_note.strategy.update": "user_note",
  // Admin / system actions
  "admin.kill_switch": "system_flag",
  "match.decision_record": "match_decision",
  "match.decision_delete": "match_decision",
  "strategy.delete": "strategy",
  "strategy.approve": "strategy",
  "strategy.reject": "strategy",
  "api_key.revoke": "api_key",
  // B4c reconciliation: ADR-0023 L149 + the call site both anchor on
  // strategy (entity_id = strategies.id; "trades.upload is a bulk insert,
  // strategy is the ownership anchor"). The prior map value "trades_upload"
  // was definition-site drift — nothing derived from the map at runtime, so
  // it was never validated against the (correct) emission.
  "trades.upload": "strategy",
  "admin.partner_import": "partner_import",
  // /review follow-up (T4-C1 + T4-M6)
  "lead.process": "for_quants_lead",
  "lead.unprocess": "for_quants_lead",
  "sync.start": "sync",
  // 7.1b Python cross-service
  "bridge.score_candidates": "bridge_run",
  "simulator.run": "simulator_run",
  "optimizer.run": "optimizer_run",
  "reconcile.compare": "reconcile_run",
  // Bridge outcome tracker
  "bridge_outcome.record": "bridge_outcome",
  "bridge_outcome.update": "bridge_outcome",
  "bridge_outcome.dismiss": "bridge_outcome_dismissal",
  // Sprint 8 Phase 2: Mandate profile builder
  "mandate_preference.update": "allocator_preference_mandate",
  "mandate_preference.admin_update": "allocator_preference_mandate",
  // Sprint 8 Phase 4: Feedback loop
  "feedback.overrides_updated": "allocator_preference_feedback",
  // Phase 06: allocator API ingestion.
  // B4c reconciliation: ADR-0023 L192-218 (a dedicated, reasoned section) +
  // the TS call site both anchor all three on entity_type=api_key /
  // entity_id=api_keys.id — "the key being polled is the natural entity for
  // every stage of the sync lifecycle". The prior "allocation" was map drift.
  // (sync_completed / sync_failed are emitted by the Python worker, which is
  // out of this TS batch's scope; they have no TS call site, so aligning the
  // map to the ADR here is purely SSOT hygiene with zero TS runtime effect.)
  "allocator.holdings.sync_requested": "api_key",
  "allocator.holdings.sync_completed": "api_key",
  "allocator.holdings.sync_failed": "api_key",
  // Phase 16 / OBSERV-07: admin-gated diagnostic SSE endpoint
  "debug_key_flow.invoke": "debug_session",
  // audit-2026-05-07 P700 / admin-auth cluster
  "admin.access.via_env_email_fallback": "user",
  "admin.access.denied": "user",
} as const satisfies Record<AuditAction, AuditEntityType>;

/**
 * One discriminated-union arm per action: `entity_type` is pinned to the
 * single canonical value {@link AUDIT_ACTION_ENTITY_TYPE_MAP} assigns to
 * `A`. This is what turns a wrong pairing into a tsc error (H-0423).
 */
type AuditEventFor<A extends AuditAction> = {
  action: A;
  entity_type: (typeof AUDIT_ACTION_ENTITY_TYPE_MAP)[A];
  entity_id: string;
  metadata?: Record<string, unknown>;
};

/**
 * The audit event payload. Derived as a DISCRIMINATED UNION over
 * {@link AuditAction}, so `action` and `entity_type` can no longer drift
 * apart: each arm fixes `entity_type` to the action's canonical value from
 * {@link AUDIT_ACTION_ENTITY_TYPE_MAP} (H-0423). A mis-paired literal — e.g.
 * `{ action: "role.grant", entity_type: "user" }` — fails to compile.
 *
 * Call sites build the object inline; tsc verifies the pairing against the
 * matching arm. This holds for a COMPUTED action too: when `action` is a
 * ternary (`isGrant ? "role.grant" : "role.revoke"`) or a template literal
 * (`` `user_note.${scope_kind}.update` ``), TS checks the literal against the
 * union and accepts it only if `entity_type` is the canonical value for
 * EVERY branch the action could take — a wrong entity_type at such a site is
 * still a compile error (verified: a ternary action whose entity_type is
 * valid for one branch but not the other does NOT compile). So no separate
 * constructor/escape-hatch is needed — the union alone closes the pairing
 * class for literal and computed actions alike.
 *
 * M-0490 (Rule 2): `metadata` is intentionally left open (see the map
 * docblock) — per-action metadata shapes are not typed.
 */
export type AuditEvent = { [A in AuditAction]: AuditEventFor<A> }[AuditAction];

/**
 * Per-field length cap (in chars) for string values stored in
 * `audit_log.metadata`. Audit-2026-05-07 H-0238 (security c8): the
 * `metadata` JSONB column is unbounded by default, and several routes
 * drop attacker-influenced strings into it (partner-import's
 * `partner_tag`, intro-request body fields, strategy-review notes,
 * alert types). Without a cap a malicious / hostile caller could write
 * multi-megabyte values that:
 *   - bloat Postgres TOAST hot rows (perf/cost regression),
 *   - reflect XSS-style payloads back through /api/me/audit-log/export
 *     CSV streams or the GDPR Art. 15 export bundle.
 *
 * 1024 chars is generous for legitimate metadata (display names,
 * partner tags, short admin notes) but a tight cap on unbounded input.
 * Longer textual fields belong in the canonical source table, not
 * duplicated into audit metadata. Numbers / booleans / nested objects
 * pass through untouched; only string leaves are clamped.
 */
export const AUDIT_METADATA_VALUE_MAX_CHARS = 1024;

/**
 * Audit-2026-05-07 red-team R-0005 (MED c8): depth guard. The helper is
 * exported and documented as a general-purpose audit-emission boundary
 * — every current caller passes a flat (1-2 deep) object, but the type
 * signature `<T>(value: T): T` invites future callers to pipe attacker-
 * influenced JSON through it. Postgres JSONB allows ~104k nesting
 * levels; V8's default stack is ~10k frames; a 20k-deep payload crashes
 * the route with `Maximum call stack size exceeded` and the `after()`
 * scheduler turns it into an unhandled rejection.
 *
 * 32 levels covers every legitimate audit payload (the deepest current
 * metadata is ~4 levels in the GDPR refused branch). Past the cap we
 * emit a forensic sentinel so the audit row still lands with a clear
 * "this was too deep" marker rather than stack-overflow + silent drop.
 */
export const AUDIT_METADATA_MAX_DEPTH = 32;

/**
 * Recursively clamp every string leaf inside an audit metadata object
 * to {@link AUDIT_METADATA_VALUE_MAX_CHARS}. Truncated strings get an
 * explicit `…[truncated:<original-length>]` suffix so forensic review
 * can spot the truncation without re-running the original payload.
 *
 * Arrays and nested objects are walked depth-first. Non-string leaves
 * are returned as-is. The function is pure and returns a new object —
 * the caller's metadata is never mutated in place.
 *
 * Use at the audit-emission boundary in routes that drop request-body
 * fields into metadata. Routes that only put server-derived constants
 * (uuids, counts, booleans) into metadata do not need this — but
 * applying it defensively is cheap.
 *
 * Audit-2026-05-07 red-team R-0005: depth-guarded. Beyond
 * AUDIT_METADATA_MAX_DEPTH the function returns a sentinel
 * `{ __audit_metadata_too_deep: true, depth }` instead of recursing —
 * stack-safe even against attacker-influenced payloads.
 */
export function capAuditMetadata<T>(value: T, depth = 0): T {
  if (depth > AUDIT_METADATA_MAX_DEPTH) {
    return { __audit_metadata_too_deep: true, depth } as unknown as T;
  }
  if (typeof value === "string") {
    if (value.length <= AUDIT_METADATA_VALUE_MAX_CHARS) return value;
    const truncated = `${value.slice(
      0,
      AUDIT_METADATA_VALUE_MAX_CHARS,
    )}…[truncated:${value.length}]`;
    return truncated as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => capAuditMetadata(v, depth + 1)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    // NEW-C10-06 (audit-2026-05-26 red-team): use Object.create(null) so the
    // accumulator has no prototype to pollute. Skip reserved property names
    // but PRESERVE them as a forensic sentinel (silent erasure is the worse
    // failure for an audit boundary) so the audit row still records the datum.
    const out = Object.create(null) as Record<string, unknown>;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") {
        // Store under a safe sentinel key so the value is not silently lost.
        out[`__sanitized_key_${k}`] = capAuditMetadata(v, depth + 1);
        continue;
      }
      out[k] = capAuditMetadata(v, depth + 1);
    }
    return out as unknown as T;
  }
  return value;
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
    // emit() re-throws hard failures (permission_denied + unknown RPC errors)
    // AFTER reporting them to Sentry + console. logAuditEvent is fire-and-forget,
    // so swallow the rejection here: letting it escape after() becomes an
    // unhandled rejection that pollutes the runtime/tests without changing the
    // already-flushed response. The failure is still fully observable via Sentry.
    after(() => emit(client, event).catch(() => {}));
  } catch {
    // Outside a request scope (cron, prerender) `after()` throws. Fall
    // back to a microtask so the emission still attempts a best-effort
    // background write. The event may still drop on cold-finish here,
    // but that path is non-route and rare.
    //
    // H-0421: emit a console.warn with the stable [audit] prefix so log
    // aggregation can distinguish this fallback path from the normal
    // after() path and quantify the non-route drop rate.
    console.warn("[audit] scheduling via queueMicrotask fallback (non-request scope):", {
      action: event.action,
      entity_type: event.entity_type,
      entity_id: event.entity_id,
    });
    queueMicrotask(() => {
      // Fire-and-forget: emit() already logged + Sentry-reported before re-throw.
      // F-07 (specialist-review 2026-05-26): log suppressed re-throws so Vercel
      // function logs capture the event (process-level unhandled-rejection hook
      // is bypassed by the empty catch on the after() path, but at least the
      // console.error is visible in log aggregation for the non-request fallback).
      void emit(client, event).catch((err) => {
        console.error("[audit] queueMicrotask fallback: emit re-throw suppressed:", err);
      });
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
    // Fire-and-forget (see logAuditEvent): swallow emitAsUser()'s re-throw —
    // it is already Sentry-reported and must not surface as an unhandled
    // rejection on the post-response after() path.
    after(() => emitAsUser(adminClient, actingUserId, event).catch(() => {}));
  } catch {
    // H-0421: same fallback-distinguishability contract as logAuditEvent.
    console.warn("[audit] scheduling via queueMicrotask fallback (non-request scope):", {
      action: event.action,
      entity_type: event.entity_type,
      entity_id: event.entity_id,
    });
    queueMicrotask(() => {
      // Fire-and-forget: emitAsUser() already logged + Sentry-reported.
      // F-07 (specialist-review 2026-05-26): log suppressed re-throws so
      // Vercel function logs capture the suppression — same contract as
      // logAuditEvent's queueMicrotask fallback above.
      void emitAsUser(adminClient, actingUserId, event).catch((err) => {
        console.error("[audit] queueMicrotask fallback: emitAsUser re-throw suppressed:", err);
      });
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
    // NEW-C10-05 (audit-2026-05-26 security+code-review): apply capAuditMetadata
    // centrally so ALL emit paths are bounded — not just the opt-in callers
    // (previously only partner-import called it). This is pure + idempotent:
    // partner-import can keep its explicit capAuditMetadata call without penalty.
    const { error } = await client.rpc("log_audit_event", {
      p_action: event.action,
      p_entity_type: event.entity_type,
      p_entity_id: event.entity_id,
      p_metadata: capAuditMetadata(event.metadata ?? {}),
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
    // NEW-C10-03: await so the `waitUntil` window stays open until capture settles.
    await reportToSentry(errForDispatch, {
      tags: {
        audit_permission_denied: "true",
        audit_path: "log_audit_event",
      },
      extra: eventContext,
      level: "fatal",
    });
    throw errForDispatch;
  }

  if (kind === "unauthenticated") {
    // NEW-C10-04: NULL auth.uid() after JWT expiry in the deferred after()
    // window. Not a grant-drift fatal — log at warning level with a
    // distinct tag so ops can distinguish session-lapse drops from real
    // permission_denied events. Do NOT tag audit_permission_denied=true.
    console.warn(
      "[audit] log_audit_event unauthenticated (28000 — JWT expired before after() settled, swallowing):",
      {
        ...eventContext,
        code: rpcError?.code,
      },
    );
    await reportToSentry(errForDispatch, {
      tags: { audit_emit_unauthenticated: "true", audit_path: "log_audit_event" },
      extra: eventContext,
      level: "warning",
    });
    return; // Do NOT rethrow — expected post-flush JWT expiry.
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
    // NEW-C10-03: await so the `waitUntil` window stays open until capture settles.
    await reportToSentry(errForDispatch, {
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
  // NEW-C10-03: await so the `waitUntil` window stays open until capture settles.
  await reportToSentry(errForDispatch, {
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
    // NEW-C10-05: capAuditMetadata applied centrally — same rationale as emit().
    const { error } = await adminClient.rpc("log_audit_event_service", {
      p_user_id: actingUserId,
      p_action: event.action,
      p_entity_type: event.entity_type,
      p_entity_id: event.entity_id,
      p_metadata: capAuditMetadata(event.metadata ?? {}),
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
    // NEW-C10-03: await so the `waitUntil` window stays open until capture settles.
    await reportToSentry(errForDispatch, {
      tags: {
        audit_permission_denied: "true",
        audit_path: "log_audit_event_service",
      },
      extra: eventContext,
      level: "fatal",
    });
    throw errForDispatch;
  }

  // CRITICAL-1 / F-01 (specialist-review 2026-05-26): the `unauthenticated`
  // kind was added to the shared `classifyAuditEmitError` for the user-path
  // (`emit()`), but `emitAsUser()` had no corresponding branch. Without it,
  // any 28000 from `log_audit_event_service` falls through to `unknown` and
  // re-throws with a generic fatal Sentry tag — incorrect dispatch contract.
  //
  // For the SERVICE-ROLE path a 28000 is NOT the routine "JWT expired in
  // after()" case (service-role does not use `auth.uid()` — that guard only
  // exists in `log_audit_event`, not `log_audit_event_service`). A 28000
  // here therefore indicates a misconfigured pooler injecting one or a future
  // migration adding a NULL-guard on the service RPC. We do NOT swallow it
  // silently — we log at error level with a distinct tag so ops can
  // distinguish it from a fatal permission_denied. We do NOT rethrow with
  // the `audit_permission_denied=true` tag (reserved for 42501 EXECUTE-grant
  // drift). We do NOT tag `audit_emit_unauthenticated` (that tag is for the
  // user path's JWT-expiry case). We use a dedicated
  // `audit_service_unexpected_28000` tag and re-throw so the failure is loud.
  if (kind === "unauthenticated") {
    console.error(
      "[audit] log_audit_event_service unexpected 28000 (service-role path — re-throwing):",
      { ...eventContext, code: rpcError?.code, message: rpcError?.message },
    );
    await reportToSentry(errForDispatch, {
      tags: {
        audit_service_unexpected_28000: "true",
        audit_path: "log_audit_event_service",
      },
      extra: eventContext,
      level: "error",
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
    // NEW-C10-03: await so the `waitUntil` window stays open until capture settles.
    await reportToSentry(errForDispatch, {
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
  // NEW-C10-03: await so the `waitUntil` window stays open until capture settles.
  await reportToSentry(errForDispatch, {
    tags: { audit_path: "log_audit_event_service" },
    extra: eventContext,
    level: "error",
  });
  throw errForDispatch;
}

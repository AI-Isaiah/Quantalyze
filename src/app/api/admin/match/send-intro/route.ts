import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { logAuditEventAsUser, emitAsUser } from "@/lib/audit";
import {
  adminActionLimiter,
  checkLimit,
  isRateLimitMisconfigured,
} from "@/lib/ratelimit";
import {
  notifyAllocatorOfAdminIntro,
  notifyManagerOfAdminIntro,
} from "@/lib/email";
import { loadManagerIdentity } from "@/lib/manager-identity";
import type { ManagerIdentity } from "@/lib/types";
import { captureToSentry } from "@/lib/sentry-capture";

// POST /api/admin/match/send-intro
// Calls send_intro_with_decision(...) — a single Postgres transaction that upserts
// the contact_request AND the sent_as_intro match_decision. Handles the already-sent
// case gracefully (returns was_already_sent=true).
//
// After a successful first-time send, dispatches intro emails to both the allocator
// and the manager, CC'ing the founder. Email failure is non-fatal — the intro is
// persisted regardless so the admin can retry delivery out-of-band.

// audit-2026-05-07 fix-loop (cluster E, 2026-05-17) — body-size and admin_note
// caps. ADMIN_NOTE_MAX bounds the free-text founder note both for audit metadata
// size (H-0231) and to keep Resend payloads under their per-email limit. Total
// JSON body is capped via Content-Length (M-0284).
const ADMIN_NOTE_MAX = 4000;
const MAX_JSON_BODY_BYTES = 32_000;

// audit-2026-05-07 fix-loop — Allowable shape post-validation. The runtime guards
// narrow the optional fields to required strings; codify that in a typed shape
// so accidental loosenings of the validator surface as a type error (H-0230).
type SendIntroBody = {
  allocator_id: string;
  strategy_id: string;
  original_strategy_id: string;
  candidate_id: string | null;
  admin_note: string;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // P444 (audit-2026-05-07) — RFC 7235: 401 unauthenticated, 403 forbidden.
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // audit-2026-05-07 fix-loop H-0228 / H-0232 / M-0283 — rate-limit gate.
  // send-intro fires two Resend emails AND writes match_decisions+
  // contact_requests rows per call; every sibling admin POST in this slice
  // already binds adminActionLimiter. Bucket the limiter on the verified
  // admin uid so a stolen admin session cannot spam intros.
  const rl = await checkLimit(
    adminActionLimiter,
    `admin:${user.id}:send-intro`,
  );
  if (!rl.success) {
    if (isRateLimitMisconfigured(rl)) {
      return NextResponse.json(
        { error: "Service temporarily unavailable" },
        {
          status: 503,
          headers: { "Retry-After": String(rl.retryAfter) },
        },
      );
    }
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter) },
      },
    );
  }

  // audit-2026-05-07 fix-loop H-0234 — kill-switch gate.
  // The match_engine_enabled flag (system_flags) is consulted by the
  // analytics worker for recompute. The admin write paths (this route +
  // decisions) must respect it too — otherwise flipping the kill switch
  // only halts new computations while still letting admins send intros
  // on now-stale candidates.
  //
  // audit-2026-05-07 fix-loop red-team (MED conf 8) — kill-switch must
  // be a HARD gate, not a hint. Distinguish three cases:
  //   (1) flagErr present (transient pg failure / RLS misconfig) →
  //       fail-CLOSED with 503. An attacker who can influence read
  //       errors (replica lag, planner perm misconfig) must NOT be
  //       able to route around the kill switch.
  //   (2) Row missing (brand-new project before migration 011) →
  //       treat as enabled=true. Documented brand-new-project case;
  //       the kill-switch PUT route returns 503 separately when the
  //       table itself is missing.
  //   (3) Row present + enabled=false → 503.
  const admin = createAdminClient();
  {
    const { data: flagRow, error: flagErr } = await admin
      .from("system_flags")
      .select("enabled")
      .eq("key", "match_engine_enabled")
      .maybeSingle();
    if (flagErr) {
      console.error(
        "[api/admin/match/send-intro] system_flags lookup failed (fail-CLOSED):",
        flagErr,
      );
      return NextResponse.json(
        {
          error:
            "Match engine status could not be verified. Please retry.",
        },
        { status: 503 },
      );
    }
    if (flagRow && flagRow.enabled === false) {
      return NextResponse.json(
        {
          error:
            "Match engine is disabled. Re-enable it from the queue index before sending intros.",
          disabled: true,
        },
        { status: 503 },
      );
    }
  }

  // audit-2026-05-07 fix-loop M-0284 — JSON body-size cap. Reject oversized
  // bodies before req.json() so an admin token replay can't pin a worker on
  // a multi-MB allocation. Content-Length is advisory: when present and
  // above the cap we 413; when missing/zero/NaN we fall through so legitimate
  // small payloads (and clients that omit Content-Length) still parse. The
  // body parser itself caps allocations as a defense-in-depth backstop.
  //
  // audit-2026-05-07 fix-loop red-team (MED conf 8) — Content-Length is
  // attacker-controlled and Number('not-a-number') === NaN (NaN > MAX is
  // false). The CL check alone is enforceable ONLY for clients that send
  // a numeric, accurate Content-Length — the OPPOSITE of an attacker
  // model. Read the raw text and check the actual byte length BEFORE
  // JSON.parse so an attacker who sends 'content-length: bogus' (or
  // chunked encoding) still hits a hard cap.
  const contentLength = Number(req.headers.get("content-length") ?? "");
  if (contentLength > MAX_JSON_BODY_BYTES) {
    return NextResponse.json(
      { error: "Request body too large" },
      { status: 413 },
    );
  }

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (Buffer.byteLength(bodyText, "utf8") > MAX_JSON_BODY_BYTES) {
    return NextResponse.json(
      { error: "Request body too large" },
      { status: 413 },
    );
  }

  let raw: unknown;
  try {
    raw = bodyText.length === 0 ? null : JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 400 },
    );
  }
  const rawBody = raw as Record<string, unknown>;

  // Per-field validation. The shape that survives this block is typed as
  // SendIntroBody — strict required string fields, with admin_note bounded
  // by ADMIN_NOTE_MAX.
  if (
    typeof rawBody.allocator_id !== "string" ||
    rawBody.allocator_id.length === 0
  ) {
    return NextResponse.json(
      { error: "allocator_id is required" },
      { status: 400 },
    );
  }
  if (
    typeof rawBody.strategy_id !== "string" ||
    rawBody.strategy_id.length === 0
  ) {
    return NextResponse.json(
      { error: "strategy_id is required" },
      { status: 400 },
    );
  }
  // Phase 5 D-20b — original_strategy_id captured at intro-send time.
  if (
    typeof rawBody.original_strategy_id !== "string" ||
    rawBody.original_strategy_id.length === 0
  ) {
    return NextResponse.json(
      { error: "original_strategy_id is required" },
      { status: 400 },
    );
  }
  if (
    typeof rawBody.admin_note !== "string" ||
    rawBody.admin_note.length === 0
  ) {
    return NextResponse.json(
      { error: "admin_note is required" },
      { status: 400 },
    );
  }
  // audit-2026-05-07 fix-loop H-0231 — admin_note length cap. Bounds both
  // the audit metadata size AND the Resend email payload. Without this the
  // route is a content-of-admin's-choice channel for arbitrary text to land
  // in two Quantalyze-branded emails per call.
  if (rawBody.admin_note.length > ADMIN_NOTE_MAX) {
    return NextResponse.json(
      {
        error: `admin_note exceeds maximum length of ${ADMIN_NOTE_MAX} characters`,
      },
      { status: 400 },
    );
  }
  if (
    rawBody.candidate_id !== undefined &&
    rawBody.candidate_id !== null &&
    typeof rawBody.candidate_id !== "string"
  ) {
    return NextResponse.json(
      { error: "candidate_id must be a string or null" },
      { status: 400 },
    );
  }

  // audit-2026-05-07 fix-loop M-0281 — guard against original_strategy_id
  // collapsing into strategy_id. "Replacing strategy X with strategy X" is
  // semantically nonsense and would corrupt bridge_outcomes deltas.
  if (rawBody.original_strategy_id === rawBody.strategy_id) {
    return NextResponse.json(
      {
        error:
          "original_strategy_id must differ from strategy_id (cannot replace a strategy with itself)",
      },
      { status: 400 },
    );
  }

  const body: SendIntroBody = {
    allocator_id: rawBody.allocator_id,
    strategy_id: rawBody.strategy_id,
    original_strategy_id: rawBody.original_strategy_id,
    // audit-2026-05-07 fix-loop red-team (conf 8) — coerce an empty-string
    // candidate_id to null so the RPC sees a clean nullable argument rather
    // than '' (which the candidate_id text/uuid column would reject as
    // invalid input syntax for type uuid and surface as a 500 instead of
    // the more correct "no candidate provided" path).
    candidate_id:
      typeof rawBody.candidate_id === "string" && rawBody.candidate_id.length > 0
        ? rawBody.candidate_id
        : null,
    admin_note: rawBody.admin_note,
  };

  // audit-2026-05-07 fix-loop H-0229 / M-0282 / C-0047 — verify the
  // supplied original_strategy_id is actually one of the named allocator's
  // current holdings. The admin UI filters this client-side, but the API
  // must not trust the client: a hostile/buggy admin client (or a script
  // bypassing the UI) can otherwise record bridge_outcomes pointing at a
  // strategy the allocator never owned, poisoning the OutcomesWidget feed.
  const { data: portfolioRow, error: portfolioErr } = await admin
    .from("portfolios")
    .select("id")
    .eq("user_id", body.allocator_id)
    .maybeSingle();
  if (portfolioErr) {
    console.error(
      "[api/admin/match/send-intro] allocator portfolio lookup failed:",
      portfolioErr,
    );
    return NextResponse.json(
      { error: "Failed to verify allocator portfolio" },
      { status: 500 },
    );
  }
  if (!portfolioRow) {
    return NextResponse.json(
      { error: "Allocator has no portfolio; cannot record an intro" },
      { status: 400 },
    );
  }
  const { data: holdingRow, error: holdingErr } = await admin
    .from("portfolio_strategies")
    .select("strategy_id")
    .eq("portfolio_id", portfolioRow.id)
    .eq("strategy_id", body.original_strategy_id)
    .maybeSingle();
  if (holdingErr) {
    console.error(
      "[api/admin/match/send-intro] holdings lookup failed:",
      holdingErr,
    );
    return NextResponse.json(
      { error: "Failed to verify allocator holdings" },
      { status: 500 },
    );
  }
  if (!holdingRow) {
    return NextResponse.json(
      {
        error:
          "original_strategy_id is not one of this allocator's current holdings",
      },
      { status: 400 },
    );
  }

  // audit-2026-05-07 fix-loop red-team (HIGH conf 8) — candidate_id IDOR /
  // cross-allocator poisoning. The RPC stamps match_decisions.candidate_id
  // with whatever uuid this route forwards; without an ownership check, a
  // hostile/compromised admin client can pass a candidate_id from ANOTHER
  // allocator's match_batches, corrupting bridge_outcomes lineage exactly
  // the way the H-0229 fix prevents for original_strategy_id. Mirrors the
  // holdings-check structure above: read match_candidates.allocator_id
  // (denormalized on the row — no join needed) and reject if it does not
  // match body.allocator_id.
  if (body.candidate_id !== null) {
    const { data: candidateRow, error: candidateErr } = await admin
      .from("match_candidates")
      .select("allocator_id")
      .eq("id", body.candidate_id)
      .maybeSingle();
    if (candidateErr) {
      console.error(
        "[api/admin/match/send-intro] candidate lookup failed:",
        candidateErr,
      );
      return NextResponse.json(
        { error: "Failed to verify candidate" },
        { status: 500 },
      );
    }
    if (!candidateRow || candidateRow.allocator_id !== body.allocator_id) {
      return NextResponse.json(
        {
          error:
            "candidate_id does not belong to the specified allocator",
        },
        { status: 400 },
      );
    }
  }

  // NEW-C34-01 / NEW-C34-02 (red-team H conf=8): validate strategy_id before
  // the RPC. The route uses the service-role admin client which BYPASSES RLS,
  // so it must enforce the status/existence guard explicitly.
  //
  // C34-01: a withdrawn/draft/rejected strategy must not trigger intro emails
  // (irreversible PII disclosure). Reject unless status='published'.
  //
  // C34-02: strategy_id is shape-validated only above; the RPC INSERTs with no
  // FK-existence surface to the caller. A non-existent strategy_id would commit
  // a bridge_outcomes-feeding decision pointing at nothing while
  // dispatchAdminIntroEmails silently returns ("strategy not found") — the
  // route reports success, no emails go out, lineage is corrupted.
  {
    const { data: strategyRow, error: strategyLookupErr } = await admin
      .from("strategies")
      .select("id, user_id, status")
      .eq("id", body.strategy_id)
      .maybeSingle();
    if (strategyLookupErr) {
      console.error(
        "[api/admin/match/send-intro] strategy lookup failed:",
        strategyLookupErr,
      );
      // silent-failure-hunter HIGH (review Finding 7): this gate guards an
      // irreversible PII disclosure path. A DB error here is high-severity and
      // warrants on-call visibility — not just a console.error. Add Sentry.
      // silent-failure-hunter MEDIUM (review Finding 11): add stable code field
      // so the admin UI and log correlation can distinguish this 500 from others.
      captureToSentry(
        new Error(`[api/admin/match/send-intro] strategy lookup failed: ${strategyLookupErr.message}`),
        {
          tags: { area: "send-intro", gate: "strategy_validation" },
          extra: { strategy_id: body.strategy_id, code: strategyLookupErr.code },
          level: "error",
        },
      );
      return NextResponse.json(
        { error: "Failed to verify strategy", code: "strategy_lookup_failed" },
        { status: 500 },
      );
    }
    if (!strategyRow) {
      return NextResponse.json(
        {
          error: "strategy_id does not exist",
          code: "strategy_not_found",
        },
        { status: 400 },
      );
    }
    if (strategyRow.status !== "published") {
      return NextResponse.json(
        {
          error: `Cannot send intro for a strategy with status '${strategyRow.status}' — strategy must be published`,
          code: "strategy_not_published",
        },
        { status: 400 },
      );
    }
    if (!strategyRow.user_id) {
      return NextResponse.json(
        {
          error: "strategy_id has no associated manager — cannot send intro",
          code: "strategy_no_manager",
        },
        { status: 400 },
      );
    }
  }

  const { data, error } = await admin.rpc("send_intro_with_decision", {
    p_allocator_id: body.allocator_id,
    p_strategy_id: body.strategy_id,
    p_original_strategy_id: body.original_strategy_id,
    p_candidate_id: body.candidate_id,
    p_admin_note: body.admin_note,
    p_decided_by: user.id,
  });

  if (error) {
    console.error("[api/admin/match/send-intro] RPC error:", error);
    // audit-2026-05-07 fix-loop red-team (MED conf 8) — emit a
    // user-attributable audit row on RPC failure so a 500-storm is
    // forensically visible (an admin abusing the endpoint or a
    // credential thief probing previously left NO trace until the RPC
    // finally succeeded). entity_type=strategy / entity_id=strategy_id
    // anchors to a stable identifier since no contact_request_id exists
    // yet. Metadata mirrors the success path minus contact_request_id /
    // match_decision_id.
    if (user?.id) {
      logAuditEventAsUser(admin, user.id, {
        action: "intro.send_failed",
        entity_type: "strategy",
        entity_id: body.strategy_id,
        metadata: {
          path: "admin",
          allocator_id: body.allocator_id,
          strategy_id: body.strategy_id,
          original_strategy_id: body.original_strategy_id,
          candidate_id: body.candidate_id,
          admin_note_length: body.admin_note.length,
          error_code: typeof (error as { code?: unknown }).code === "string"
            ? (error as { code: string }).code
            : null,
        },
      });
    }
    return NextResponse.json(
      { error: "Failed to send intro" },
      { status: 500 },
    );
  }

  // RPC returns a TABLE (row set); Supabase exposes it as an array.
  const row = Array.isArray(data) && data.length > 0 ? data[0] : data;
  const wasAlreadySent = row?.was_already_sent ?? false;

  // P692 audit-coverage extension (2026-05-13): admin issuing an intro
  // decision is a high-signal user-attributable action. Use emitAsUser
  // (awaited, not fire-and-forget) because the route operates with the
  // service-role admin client but has already validated the acting admin's JWT.
  // entity_id pins to the contact_request row created by the RPC.
  //
  // silent-failure-hunter HIGH (review Finding 8): intro.send and intro.resend_noop
  // are PII-disclosing, irreversible, legally-attributable actions. A fire-and-
  // forget after() audit emit that silently drops means there is no forensic record
  // that an intro was sent — compliance and forensic investigations cannot be
  // answered from the audit log. Replace logAuditEventAsUser (fire-and-forget) with
  // awaited emitAsUser in a try/catch: on failure, return 207 with a warning so the
  // admin knows the intro committed but the audit record could not be written.
  //
  // NEW-C34-03 (red-team M conf=8): when was_already_sent=true the RPC returned
  // the EXISTING row; no new note was applied and no new email was sent. Emit the
  // distinct "intro.resend_noop" action so forensics can distinguish first-send
  // from re-send attempts, and surface note_applied:false to the response.
  if (row?.contact_request_id && user?.id) {
    const auditEvent = wasAlreadySent
      ? {
          action: "intro.resend_noop" as const,
          entity_type: "contact_request" as const,
          entity_id: row.contact_request_id as string,
          metadata: {
            path: "admin",
            allocator_id: body.allocator_id,
            strategy_id: body.strategy_id,
            original_strategy_id: body.original_strategy_id,
            candidate_id: body.candidate_id,
            note_applied: false,
            admin_note_length: body.admin_note.length,
          },
        }
      : {
          action: "intro.send" as const,
          entity_type: "contact_request" as const,
          entity_id: row.contact_request_id as string,
          metadata: {
            path: "admin",
            allocator_id: body.allocator_id,
            strategy_id: body.strategy_id,
            original_strategy_id: body.original_strategy_id,
            candidate_id: body.candidate_id,
            was_already_sent: false,
            match_decision_id: row?.match_decision_id ?? null,
            // admin_note is bounded by ADMIN_NOTE_MAX above; we record only
            // the length, not the content, so the audit row stays small AND
            // doesn't store free-text the founder hasn't approved for the
            // audit trail. Length lets forensics correlate "intro sent with
            // an unusually long note" without re-reading the body.
            admin_note_length: body.admin_note.length,
          },
        };
    try {
      await emitAsUser(admin, user.id, auditEvent);
    } catch (auditErr) {
      console.error("[api/admin/match/send-intro] intro audit emit failed:", auditErr);
      captureToSentry(
        new Error(`[api/admin/match/send-intro] intro audit emit failed: ${auditErr instanceof Error ? auditErr.message : String(auditErr)}`),
        {
          tags: { area: "send-intro", action: wasAlreadySent ? "intro.resend_noop" : "intro.send" },
          extra: { strategy_id: body.strategy_id, allocator_id: body.allocator_id },
          level: "error",
        },
      );
      return NextResponse.json(
        {
          success: !wasAlreadySent,
          was_already_sent: wasAlreadySent,
          contact_request_id: row.contact_request_id,
          match_decision_id: row?.match_decision_id ?? null,
          note_applied: !wasAlreadySent,
          audit_warning: "Intro committed but the audit record could not be written. Contact support.",
        },
        { status: 207 },
      );
    }
  }

  // audit-2026-05-07 fix-loop C-0049 — Dispatch emails on first-time sends.
  // Vercel Functions suspend the worker as soon as the response is returned,
  // so `void dispatchAdminIntroEmails(...)` may NEVER execute the inner
  // Resend HTTP calls. Use next/server `after()` — the Vercel-blessed
  // mechanism for post-response work — so the dispatch runs to completion
  // after the response flushes.
  //
  // audit-2026-05-07 fix-loop red-team (MED conf 8) — after-client lifetime.
  // Do NOT capture the request-scoped `admin` instance in the after()
  // closure: Fluid Compute / Node serverless freeze may tear down the
  // request-scoped fetch agents before dispatchAdminIntroEmails finishes
  // its profile/strategy queries (silent dispatch failure that the route
  // reports 200 on). dispatchAdminIntroEmails now constructs its OWN
  // service-role client whose lifetime is the after() task.
  if (!wasAlreadySent) {
    const allocatorId = body.allocator_id;
    const strategyId = body.strategy_id;
    const founderNote = body.admin_note;
    after(() =>
      dispatchAdminIntroEmails({
        allocatorId,
        strategyId,
        founderNote,
      }),
    );
  }

  return NextResponse.json({
    // audit-2026-05-07 fix-loop M-0280 — include `success: true` for parity
    // with sibling admin PUTs (preferences, kill-switch). Shared client
    // interceptors that branch on body.success can now see a positive signal
    // without sniffing the 2xx status.
    success: true,
    contact_request_id: row?.contact_request_id,
    match_decision_id: row?.match_decision_id,
    was_already_sent: wasAlreadySent,
    // NEW-C34-03: surface note_applied so the UI can warn when a re-send
    // did not apply the new note (was_already_sent=true → RPC returned the
    // old row unchanged, note was silently dropped).
    note_applied: !wasAlreadySent,
  });
}

/** Lightweight email format guard — defense in depth before we hand off to Resend. */
function isLikelyEmail(value: string | null | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  // RFC 5322 is too permissive for our needs; this matches local@host.tld with
  // no whitespace and at least one dot in the host part. Resend will reject
  // anything that slips through this with a 4xx — but at least we don't
  // dispatch a request for `'   '` or `'no-at-sign'`.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

async function dispatchAdminIntroEmails(args: {
  allocatorId: string;
  strategyId: string;
  founderNote: string;
}) {
  const { allocatorId, strategyId, founderNote } = args;
  // audit-2026-05-07 fix-loop red-team (MED conf 8) — construct a fresh
  // service-role client INSIDE the after() task so its fetch socket pool
  // is owned by the post-response work, not by a request scope that may
  // have been torn down before this code runs (Fluid Compute / Node
  // serverless freeze on response flush).
  const admin = createAdminClient();

  try {
    // Fetch allocator + strategy in parallel. Manager identity is loaded
    // separately via the shared loadManagerIdentity helper so the same
    // column set + null-handling is reused by the self-serve intro route.
    const [allocatorResult, strategyResult] = await Promise.all([
      admin
        .from("profiles")
        .select("email, display_name, company")
        .eq("id", allocatorId)
        .single(),
      admin
        .from("strategies")
        .select("id, name, user_id")
        .eq("id", strategyId)
        .single(),
    ]);

    const allocator = allocatorResult.data;
    const strategy = strategyResult.data;

    if (!isLikelyEmail(allocator?.email) || !strategy) {
      console.warn(
        "[api/admin/match/send-intro] Skipping email dispatch — missing or malformed allocator email, or strategy not found",
        { allocatorId, strategyId, hasStrategy: Boolean(strategy) },
      );
      return;
    }

    // Manager profile — may be null if strategy.user_id is unset.
    let manager: ManagerIdentity | null = null;
    let managerEmail: string | null = null;
    if (strategy.user_id) {
      manager = await loadManagerIdentity(admin, strategy.user_id);
      // loadManagerIdentity only SELECTs identity columns; fetch the email
      // separately because the allocator-intro email is the only reason we
      // need it and we don't want to bloat ManagerIdentity's surface area.
      const { data: managerEmailRow } = await admin
        .from("profiles")
        .select("email")
        .eq("id", strategy.user_id)
        .single();
      managerEmail = isLikelyEmail(managerEmailRow?.email)
        ? managerEmailRow.email
        : null;
    }

    const allocatorName =
      allocator!.display_name ?? allocator!.company ?? "the allocator";

    // Default to a minimal ManagerIdentity shape if loadManagerIdentity
    // returned null — the email still goes out with an "identity disclosed
    // later" body rather than failing the whole dispatch.
    const managerForEmail: ManagerIdentity = manager ?? {
      display_name: null,
      company: null,
      bio: null,
      years_trading: null,
      aum_range: null,
      linkedin: null,
    };

    // Promise.allSettled — one failed send must NOT prevent the other from
    // running. The current observability story is "console.error inside
    // send()", which is a known gap (P1 follow-up: persisted dispatch audit
    // table — see audit-2026-05-07 H-0236; tracked separately, out-of-scope
    // for this fix-loop because it requires a new table + Resend webhook).
    // For now, log each result so the founder can grep for partial failures
    // in production logs.
    const results = await Promise.allSettled([
      notifyAllocatorOfAdminIntro(
        allocator!.email!,
        managerForEmail,
        strategy.name,
        strategy.id,
        founderNote,
      ),
      managerEmail
        ? notifyManagerOfAdminIntro(
            managerEmail,
            allocatorName,
            strategy.name,
            founderNote,
          )
        : Promise.resolve(),
    ]);

    const labels = ["allocator", "manager"] as const;
    results.forEach((result, idx) => {
      if (result.status === "rejected") {
        console.error(
          `[api/admin/match/send-intro] ${labels[idx]} email rejected:`,
          result.reason,
        );
        // audit-2026-05-07 fix-loop red-team (MED conf 8) — double-click
        // race / Resend outage silent-failure. After the RPC commits the
        // intro, a failed email dispatch leaves the contact_request
        // persisted with zero emails sent and a subsequent request
        // short-circuits under was_already_sent=true. console.error
        // alone is insufficient observability — escalate to Sentry so a
        // Resend outage surfaces an alert before the founder discovers
        // it via "why didn't the allocator reply".
        captureToSentry(result.reason, {
          tags: {
            route: "admin/match/send-intro",
            phase: "dispatch",
            recipient: labels[idx],
          },
          extra: { allocatorId, strategyId },
          level: "error",
        });
      }
    });
  } catch (err) {
    console.error("[api/admin/match/send-intro] Email dispatch failed:", err);
    // Outer catch path: profile/strategy lookup failure or any other
    // unexpected throw in the dispatch task. Same escalation rationale
    // as the per-recipient rejection branch above.
    captureToSentry(err, {
      tags: {
        route: "admin/match/send-intro",
        phase: "dispatch_outer",
      },
      extra: { allocatorId, strategyId },
      level: "error",
    });
  }
}

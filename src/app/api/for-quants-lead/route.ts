import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin } from "@/lib/csrf";
import {
  publicIpLimiter,
  checkLimit,
  getClientIp,
  sanitizeInetForDb,
} from "@/lib/ratelimit";
import { notifyFounderGeneric, escapeHtml } from "@/lib/email";
import type { WizardStepKey } from "@/lib/wizard/localStorage";

/**
 * Once-per-process flag for the missing-FOUNDER_EMAIL warning. We only
 * want to notify Sentry once per cold start, not once per request, so
 * a silent misconfig still surfaces but doesn't spam the issue tracker.
 * Module-scope so the flag is shared across all in-flight requests on
 * the same warm instance. G9.B.7.
 *
 * Tests reset this via `vi.resetModules()` + a fresh `await import('./route')`
 * — Next.js route files MUST only export the HTTP-method handlers and
 * route segment config (no test-only exports).
 */
let founderEmailMissingWarned = false;

/**
 * Cheap stable hash for user-agent strings, used to scope the
 * rate-limit bucket when the IP is "unknown" (no x-real-ip /
 * x-forwarded-for). Not cryptographic — just enough variability that
 * one no-IP attacker doesn't share a bucket with every other no-IP
 * caller. djb2 variant; collisions are fine because the consequence
 * of a collision is the same as the pre-fix behavior (shared bucket).
 * G9.B.15.
 */
function hashUserAgent(ua: string | null): string {
  const input = ua ?? "no-ua";
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  // Convert to unsigned hex for a compact bucket key.
  return (h >>> 0).toString(16);
}

/**
 * Lazy-import @sentry/nextjs and capture an exception with route +
 * stage tags. Lazy so that local dev / unit tests / sentry-disabled
 * preview deploys don't pull the SDK into the route's cold path. The
 * .catch() prevents an SDK-load failure (network blip, ad-blocker on
 * preview) from itself surfacing as an unhandled rejection. Mirrors
 * the pattern in src/app/error.tsx and src/instrumentation.ts.
 */
function captureFailure(
  err: unknown,
  stage: "admin_init" | "db_insert" | "founder_notify" | "founder_email_unset",
  extra: Record<string, unknown> = {},
): void {
  void import("@sentry/nextjs")
    .then((Sentry) => {
      if (stage === "founder_email_unset") {
        Sentry.captureMessage(
          "[for-quants-lead] ADMIN_EMAIL is unset — founder will not be notified",
          {
            level: "error",
            tags: { route: "for-quants-lead", stage },
            extra,
          },
        );
        return;
      }
      Sentry.captureException(err, {
        tags: { route: "for-quants-lead", stage },
        extra,
      });
    })
    .catch(() => {
      // Sentry import failed — already logged via console.* in the
      // calling catch arm. Do not crash the route.
    });
}

/**
 * POST /api/for-quants-lead — public Request-a-Call endpoint.
 *
 * Writes a lead to `for_quants_leads` via the service-role client and
 * emails the founder. Cannot reuse `/api/intro` — that route requires
 * an authenticated allocator and a `strategy_id`.
 *
 * Defense layers:
 *   1. CSRF via Origin/Referer check. For an UNAUTHENTICATED endpoint
 *      this is NOT a real CSRF defense (CSRF abuses an authenticated
 *      cookie) — it's a cheap bot filter against drive-by scrapers
 *      that don't set a plausible Origin. The rate limiter is the
 *      real control.
 *   2. IP rate limit (10/min/IP). The IP comes from `x-real-ip`
 *      (Vercel-verified, not spoofable) falling back to the RIGHTMOST
 *      `x-forwarded-for` entry. See `getClientIp`.
 *   3. Zod validation of the body.
 *   4. Service-role insert only. The table has RLS enabled with zero
 *      policies, so an anon JWT can't reach it.
 *   5. Side effects (founder email, analytics) run inside `after()` so
 *      Vercel's Fluid Compute keeps the function alive until they
 *      complete, instead of abandoning the promise mid-flight.
 *
 * Graceful degradation:
 *   - Upstash unconfigured → requests pass.
 *   - Resend unconfigured → lead still writes, response is 200.
 *   - PostHog unconfigured → event silently dropped, lead still lands.
 */

/**
 * Step keys the wizard uses for funnel telemetry. Mirrors `WizardStepKey`
 * in `src/lib/wizard/localStorage.ts`. The `satisfies readonly WizardStepKey[]`
 * assertion guarantees that any future drift between the wizard's step
 * union and this enum fails at typecheck — historically the CSV-branch
 * keys (`csv_upload`, `csv_preview`, `csv_submit`) were missing here, which
 * 400'd every CSV-wizard lead with a `wizard_context.step` Zod error
 * (G9.B.4).
 */
const WIZARD_STEP_KEYS = [
  "connect_key",
  "sync_preview",
  "metadata",
  "submit",
  "csv_upload",
  "csv_preview",
  "csv_submit",
] as const satisfies readonly WizardStepKey[];

const WIZARD_CONTEXT_SCHEMA = z
  .object({
    draft_strategy_id: z.string().uuid().nullable().optional(),
    step: z.enum(WIZARD_STEP_KEYS).optional(),
    wizard_session_id: z.string().min(8).max(64).optional(),
  })
  .nullable()
  .optional();

const LEAD_SCHEMA = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(200, "Name is too long"),
  firm: z
    .string()
    .trim()
    .min(1, "Firm is required")
    .max(200, "Firm is too long"),
  email: z
    .string()
    .trim()
    .email("Enter a valid email")
    .max(320, "Email is too long"),
  preferred_time: z
    .string()
    .trim()
    .max(200, "Preferred time is too long")
    .optional()
    .or(z.literal("")),
  notes: z
    .string()
    .trim()
    .max(2000, "Notes are too long")
    .optional()
    .or(z.literal("")),
  /**
   * Optional wizard context payload — populated when the lead was
   * captured from inside /strategies/new/wizard. Stored on
   * `for_quants_leads.wizard_context` (migration 031) so the founder
   * can triage in-wizard leads separately from landing-page leads.
   */
  wizard_context: WIZARD_CONTEXT_SCHEMA,
});

export async function POST(req: NextRequest) {
  // Layer 1: CSRF (bot filter, not a real CSRF defense for unauth POST)
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  // Layer 2: rate limit by IP (public endpoint — no user.id to scope on).
  //
  // `getClientIp` returns the literal string 'unknown' when no IP
  // headers are set. Pre-fix, every unidentified caller shared the
  // same `for-quants-lead:unknown` bucket — a single attacker stripping
  // x-real-ip + x-forwarded-for could burn the 10/min/IP budget for
  // every other unidentified caller. Now we scope by user-agent hash
  // when the IP is unknown so one no-ip attacker only DoS's its own
  // UA bucket. G9.B.15.
  const ip = getClientIp(req.headers);
  const rateLimitKey =
    ip === "unknown"
      ? `for-quants-lead:unknown:${hashUserAgent(req.headers.get("user-agent"))}`
      : `for-quants-lead:${ip}`;
  const rl = await checkLimit(publicIpLimiter, rateLimitKey);
  if (!rl.success) {
    return NextResponse.json(
      {
        error:
          "Too many requests. Try again in a few minutes, or email security@quantalyze.com directly.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter) },
      },
    );
  }

  // Layer 3: parse + validate body. Read raw text first and gate on
  // length BEFORE JSON.parse so an attacker can't burn Lambda memory
  // with a huge body that Zod would only reject after the parse
  // already allocated. The Zod schema caps each field at <2KB total;
  // 8KB raw is a 4x safety margin for whitespace + future fields.
  // Vercel's outer Function body limit is configurable to 4.5MB on
  // serverless and 100MB streaming — both far above what this route
  // ever needs. G9.B.12.
  const MAX_BODY_BYTES = 8192;
  let parsed: z.infer<typeof LEAD_SCHEMA>;
  try {
    const contentLength = req.headers.get("content-length");
    if (contentLength) {
      const declared = Number.parseInt(contentLength, 10);
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        return NextResponse.json(
          { error: "Request body is too large." },
          { status: 413 },
        );
      }
    }
    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "Request body is too large." },
        { status: 413 },
      );
    }
    const body = rawBody.length === 0 ? {} : JSON.parse(rawBody);
    parsed = LEAD_SCHEMA.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      // Flatten to a `field -> message[]` map so the client can show
      // every issue per field. Pre-fix, the route stored only the
      // first issue per field — for a field with multiple rules
      // (e.g., email has both `email()` and `max(320)`), the user
      // saw one error at a time and had to fix-and-retry. G9.B.16.
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of err.issues) {
        const path = issue.path.join(".");
        if (!path) continue;
        const bucket = fieldErrors[path];
        if (bucket) {
          bucket.push(issue.message);
        } else {
          fieldErrors[path] = [issue.message];
        }
      }
      return NextResponse.json(
        { error: "Invalid submission", fieldErrors },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  // Layer 4: service-role insert. Sanitize source_ip to a real INET value
  // or NULL — a malformed `x-forwarded-for` would otherwise 500 the whole
  // insert with `invalid input syntax for type inet`.
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err) {
    console.error("[for-quants-lead] admin client init failed:", err);
    captureFailure(err, "admin_init");
    return NextResponse.json(
      { error: "Service unavailable. Email security@quantalyze.com directly." },
      { status: 503 },
    );
  }

  // `wizard_context` is set on the insert ONLY when the caller actually
  // passes one (in-wizard leads). The column was added in migration 031;
  // omitting the key when null lets the route's common landing-page
  // path stay green even on a hypothetical fresh DB where 031 hasn't
  // applied yet, instead of 500ing every lead with
  // `column "wizard_context" does not exist`. See G9.B.5.
  const insertPayload: Record<string, unknown> = {
    name: parsed.name,
    firm: parsed.firm,
    email: parsed.email,
    preferred_time: parsed.preferred_time || null,
    notes: parsed.notes || null,
    source_ip: sanitizeInetForDb(ip),
    user_agent: req.headers.get("user-agent"),
  };
  if (parsed.wizard_context) {
    insertPayload.wizard_context = parsed.wizard_context;
  }

  // @audit-skip-anchor:lead-insert
  // @audit-skip: unauthenticated public landing-page form. audit_log
  // requires a user_id; this caller has no user session. Lead-capture
  // funnel metrics live in PostHog (client-side trackForQuantsEventClient
  // — server-side capture was removed in G9.B.1). Per ADR-0023 §3.
  // The 4 marker-write @audit-skips inside the after() callback below
  // share this rationale; they reference @audit-skip-anchor:lead-insert
  // by anchor name so a future refactor that reorders this file does
  // not silently desync the back-references.
  const { data: inserted, error: insertErr } = await admin
    .from("for_quants_leads")
    .insert(insertPayload)
    .select("id")
    .single();

  if (insertErr || !inserted) {
    console.error("[for-quants-lead] insert failed:", insertErr);
    captureFailure(insertErr ?? new Error("insert returned no row"), "db_insert", {
      email: parsed.email,
    });
    return NextResponse.json(
      {
        error:
          "Something went wrong. Email security@quantalyze.com directly.",
      },
      { status: 500 },
    );
  }

  const leadId = inserted.id;

  // Fire-and-forget via `after()` — Next.js keeps the function alive
  // until this callback resolves. A raw `Promise.resolve().then()`
  // would be abandoned when the function suspends on Vercel.
  //
  // Server-side `for_quants_lead_submit` capture was removed (G9.B.1):
  // the synthetic `lead:<uuid>` distinctId collided with the cookie-based
  // anonymous ID PostHog had used for the visitor's view → click events
  // — every form-submit became a brand-new PostHog person disconnected
  // from its parent visitor and the QQAR/CTR funnel could never
  // reconstruct. The client now fires the conversion event after a
  // successful POST (RequestCallModal handleSubmit) using its own
  // distinctId, mirroring how the click and view events are captured.
  after(async () => {
    // audit-2026-05-07 G9.B.7 (PR-1b extension, migration 115):
    // record the notify-attempt timestamp the moment we begin the
    // founder-notify path. Pre-fix the founder CRM had no way to
    // distinguish "lead inserted, founder never told (transient
    // Resend outage / ADMIN_EMAIL unset)" from "lead inserted,
    // founder notified" — a stuck queue rendered as "All caught
    // up". The marker write itself is wrapped in try/catch because
    // a marker-write failure must NEVER block the actual email send;
    // worst case the operator sees a clean send with no marker (same
    // pre-migration shape).
    // supabase-js returns Postgres errors (42703 column missing,
    // 42501 RLS denied, etc.) as `{ error }` on the response — it
    // does NOT throw. Capture both response-level errors and the
    // network-level throw so a genuinely failed marker write is
    // visible to operators (the founder CRM will still render the
    // row, just without the badge).
    // @audit-skip: founder-CRM internal state marker on unauthenticated
    // lead row. See @audit-skip-anchor:lead-insert.
    try {
      const { error: markerErr } = await admin
        .from("for_quants_leads")
        .update({ notify_attempted_at: new Date().toISOString() })
        .eq("id", leadId);
      if (markerErr) {
        console.warn(
          "[for-quants-lead] notify_attempted_at marker write failed (non-blocking):",
          markerErr,
        );
      }
    } catch (markerErr) {
      console.warn(
        "[for-quants-lead] notify_attempted_at marker write threw (non-blocking):",
        markerErr,
      );
    }

    // G9.B.7: notifyFounderGeneric silently returns early when
    // ADMIN_EMAIL is unset (see src/lib/email.ts:55,685). A misconfig
    // would land every lead in the DB but never alert the founder, and
    // the inner try/catch would not fire (the helper doesn't throw).
    // Detect the misconfig once per process and surface it via Sentry
    // so the silent path stops being invisible.
    if (!process.env.ADMIN_EMAIL) {
      console.warn(
        "[for-quants-lead] ADMIN_EMAIL is unset — founder notification skipped",
      );
      if (!founderEmailMissingWarned) {
        founderEmailMissingWarned = true;
        captureFailure(null, "founder_email_unset", { lead_id: leadId });
      }
      // Record the configuration error in notify_error so the founder
      // CRM "stuck pending notify" badge fires on this row even though
      // notifyFounderGeneric didn't throw. notify_succeeded_at stays
      // NULL — the email never went out.
      // @audit-skip: founder-CRM internal state marker on unauthenticated
      // lead row. See @audit-skip-anchor:lead-insert.
      try {
        const { error: markerErr } = await admin
          .from("for_quants_leads")
          .update({ notify_error: "ADMIN_EMAIL unset" })
          .eq("id", leadId);
        if (markerErr) {
          console.warn(
            "[for-quants-lead] notify_error (ADMIN_EMAIL unset) marker write failed (non-blocking):",
            markerErr,
          );
        }
      } catch (markerErr) {
        console.warn(
          "[for-quants-lead] notify_error (ADMIN_EMAIL unset) marker write threw (non-blocking):",
          markerErr,
        );
      }
      return;
    }

    try {
      await notifyFounderGeneric(
        `Request a Call: ${parsed.name} at ${parsed.firm}`,
        `<p>A new /for-quants Request a Call lead was submitted.</p>
         <p>
           <strong>Name:</strong> ${escapeHtml(parsed.name)}<br/>
           <strong>Firm:</strong> ${escapeHtml(parsed.firm)}<br/>
           <strong>Email:</strong> ${escapeHtml(parsed.email)}<br/>
           ${parsed.preferred_time ? `<strong>Preferred time:</strong> ${escapeHtml(parsed.preferred_time)}<br/>` : ""}
         </p>
         ${parsed.notes ? `<p><strong>Notes:</strong><br/>${escapeHtml(parsed.notes)}</p>` : ""}
         <p style="color:#666;font-size:12px;">Lead id: ${leadId}</p>`,
      );
      // Clean send — pair the attempt timestamp with a success
      // timestamp so the CRM's "stuck pending notify" predicate
      // (attempted IS NOT NULL AND succeeded IS NULL) flips false.
      // @audit-skip: founder-CRM internal state marker on unauthenticated
      // lead row. See @audit-skip-anchor:lead-insert.
      try {
        const { error: markerErr } = await admin
          .from("for_quants_leads")
          .update({ notify_succeeded_at: new Date().toISOString() })
          .eq("id", leadId);
        if (markerErr) {
          console.warn(
            "[for-quants-lead] notify_succeeded_at marker write failed (non-blocking):",
            markerErr,
          );
        }
      } catch (markerErr) {
        console.warn(
          "[for-quants-lead] notify_succeeded_at marker write threw (non-blocking):",
          markerErr,
        );
      }
    } catch (err) {
      console.warn("[for-quants-lead] founder notify failed (non-blocking):", err);
      captureFailure(err, "founder_notify", { lead_id: leadId });
      // Persist a sanitized error string so the founder CRM can show
      // why the send failed (auth vs network vs body validation)
      // without forcing operators into Sentry archaeology. Truncated
      // to 500 chars to keep the column from absorbing a huge stack.
      const sanitized = (err instanceof Error ? err.message : String(err)).slice(
        0,
        500,
      );
      // @audit-skip: founder-CRM internal state marker on unauthenticated
      // lead row. See @audit-skip-anchor:lead-insert.
      try {
        const { error: markerErr } = await admin
          .from("for_quants_leads")
          .update({ notify_error: sanitized })
          .eq("id", leadId);
        if (markerErr) {
          console.warn(
            "[for-quants-lead] notify_error (send threw) marker write failed (non-blocking):",
            markerErr,
          );
        }
      } catch (markerErr) {
        console.warn(
          "[for-quants-lead] notify_error (send threw) marker write threw (non-blocking):",
          markerErr,
        );
      }
    }
  });

  // Return an opaque idempotency token (SHA-256 of `email|YYYY-MM-DD`)
  // so a flaky network where the response was dropped after a
  // successful insert lets the client recognize a retry as the same
  // logical submission rather than treating it as a fresh one. The
  // token is NOT a secret — it's stable for the (email, day) pair on
  // purpose. Server-side dedup via a UNIQUE constraint is tracked
  // separately (PR-5 owns migrations). G9.B.17.
  //
  // The lead id is still NOT returned — it's an internal identifier
  // the UI doesn't need.
  const idempotencyKey = await computeIdempotencyToken(parsed.email);
  return NextResponse.json({ ok: true, idempotency_key: idempotencyKey });
}

/**
 * Hex chars retained from the SHA-256 digest. 32 hex chars = 128 bits of
 * entropy — collision-resistant on the per-day, per-email scope this
 * token is bucketed by (the (lower(email), UTC-day) keyspace is far
 * smaller than 2^64). The token is non-secret so a longer prefix would
 * only bloat the response; a shorter one would risk birthday
 * collisions if the lead pipeline grew by orders of magnitude.
 */
const IDEMPOTENCY_TOKEN_HEX_LEN = 32;

/**
 * Stable, non-secret token clients can use to dedupe network retries
 * of the same logical submission. SHA-256 of `email|UTC-YYYY-MM-DD`.
 * Web Crypto is available in both Edge and Node Function runtimes on
 * Vercel (per the Next.js docs node_modules/next/dist/docs/...) so no
 * polyfill needed. G9.B.17.
 */
async function computeIdempotencyToken(email: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const data = new TextEncoder().encode(`${email.toLowerCase()}|${day}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, IDEMPOTENCY_TOKEN_HEX_LEN);
}

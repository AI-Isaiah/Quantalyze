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
import { trackForQuantsEventServer } from "@/lib/analytics";

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

const WIZARD_CONTEXT_SCHEMA = z
  .object({
    draft_strategy_id: z.string().uuid().nullable().optional(),
    step: z
      .enum(["connect_key", "sync_preview", "metadata", "submit"])
      .optional(),
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

  // Layer 2: rate limit by IP (public endpoint — no user.id to scope on)
  const ip = getClientIp(req.headers);
  const rl = await checkLimit(publicIpLimiter, `for-quants-lead:${ip}`);
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

  // Layer 3: parse + validate body
  let parsed: z.infer<typeof LEAD_SCHEMA>;
  try {
    const body = await req.json();
    parsed = LEAD_SCHEMA.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      // Flatten to a single field->message map so the client can show
      // inline errors without walking a nested Zod error tree.
      const fieldErrors: Record<string, string> = {};
      for (const issue of err.issues) {
        const path = issue.path.join(".");
        if (path && !fieldErrors[path]) {
          fieldErrors[path] = issue.message;
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
    return NextResponse.json(
      { error: "Service unavailable. Email security@quantalyze.com directly." },
      { status: 503 },
    );
  }

  // @audit-skip: unauthenticated public landing-page form. audit_log
  // requires a user_id; this caller has no user session. Lead-capture
  // funnel metrics live in PostHog (trackForQuantsEventServer below)
  // per ADR-0023 §3.
  const { data: inserted, error: insertErr } = await admin
    .from("for_quants_leads")
    .insert({
      name: parsed.name,
      firm: parsed.firm,
      email: parsed.email,
      preferred_time: parsed.preferred_time || null,
      notes: parsed.notes || null,
      source_ip: sanitizeInetForDb(ip),
      user_agent: req.headers.get("user-agent"),
      // Migration 031 added this column. NULL for landing-page leads,
      // populated for leads captured from inside the wizard.
      wizard_context: parsed.wizard_context ?? null,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    console.error("[for-quants-lead] insert failed:", insertErr);
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
  after(async () => {
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
    } catch (err) {
      console.warn("[for-quants-lead] founder notify failed (non-blocking):", err);
    }

    try {
      await trackForQuantsEventServer("for_quants_lead_submit", `lead:${leadId}`, {
        source: "modal",
        user_agent: req.headers.get("user-agent"),
      });
    } catch (err) {
      console.warn("[for-quants-lead] analytics failed (non-blocking):", err);
    }
  });

  // Do not return the lead id — it's an internal identifier the UI
  // doesn't need.
  return NextResponse.json({ ok: true });
}

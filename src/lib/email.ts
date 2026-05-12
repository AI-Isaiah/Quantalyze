import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCorrelationId } from "@/lib/correlation-id";
import { SEVERITY_HEX, type AlertSeverity } from "./utils";
import type { ManagerIdentity } from "@/lib/types";

/**
 * Full set of notification types written to `notification_dispatches`.
 * Lifted from `string` to a literal union so a typo at a `send()` call site
 * fails typecheck instead of silently dirtying the audit trail. When adding
 * a new category, add it here AND mirror in the audit table CHECK constraint
 * (tracked as a follow-up — migration 018 currently has no CHECK).
 */
export type NotificationType =
  | "manager_intro_request"
  | "manager_approved"
  | "allocator_intro_status"
  | "allocator_intro_request"
  | "allocator_admin_intro"
  | "manager_admin_intro"
  | "founder_new_strategy"
  | "founder_intro_request"
  | "founder_generic"
  | "alert_digest";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// Lazy singleton admin client for the notification_dispatches audit trail.
// Avoids re-instantiating the Supabase client on every send() call (notable
// under alert-digest fan-out where one digest triggers N sends). Stored as
// null on first failure so subsequent calls skip the audit cleanly instead
// of retrying the throwing constructor.
let _auditAdmin: ReturnType<typeof createAdminClient> | null | undefined;
function getAuditAdminClient(): ReturnType<typeof createAdminClient> | null {
  if (_auditAdmin !== undefined) return _auditAdmin;
  try {
    _auditAdmin = createAdminClient();
  } catch (err) {
    console.warn(
      "[email] admin client unavailable, dispatch audit disabled (non-blocking):",
      err instanceof Error ? err.message : String(err),
    );
    _auditAdmin = null;
  }
  return _auditAdmin;
}

// Whitelabel-friendly platform identity. Defaults keep Quantalyze branding;
// a partner deployment flips these via env vars without touching code.
const PLATFORM_NAME = process.env.PLATFORM_NAME ?? "Quantalyze";
const PLATFORM_EMAIL = process.env.PLATFORM_EMAIL ?? "notifications@quantalyze.com";
const FROM = `${PLATFORM_NAME} <${PLATFORM_EMAIL}>`;
/**
 * Runtime read of the founder/admin email so a delayed env-var injection
 * (a race between Vercel's runtime-env wiring and module init, or a test
 * that sets ADMIN_EMAIL between imports) is observed by every caller —
 * NOT the module-import-time snapshot. Pre-fix the module captured this
 * once at import; the for-quants-lead route's `if (!process.env.ADMIN_EMAIL)`
 * gate would pass on a re-read, but `notifyFounderGeneric` would then
 * silently early-return on the stale empty value, recreating the exact
 * silent-failure G9.B.7 was meant to prevent. Red-team specialist
 * regression.
 */
function founderEmail(): string {
  return process.env.ADMIN_EMAIL ?? "";
}
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://quantalyze.com";
const BRAND_COLOR = "#1B6B5A"; // muted teal, per DESIGN.md
const SIGNATURE = `<p style="color:#666;font-size:13px;">— ${PLATFORM_NAME}</p>`;

/**
 * Resolve the correlation_id to attach to this send. Prefers the request-scoped
 * `getCorrelationId()` (which reads the inbound x-correlation-id header) so the
 * Resend boundary stays joined to the inbound request chain. If the helper
 * throws (e.g., the call originates from a cron context where `headers()` is
 * unavailable), fall back to a fresh UUID v4 — the absolute-last fallback per
 * Plan 16-05. The cid still flows through Path A (tags array) and Path B
 * (resend_message_correlation insert) so the webhook side can still recover
 * it; only the inbound→send hop is lost in that branch.
 */
async function resolveCorrelationId(): Promise<string> {
  try {
    return await getCorrelationId();
  } catch {
    return crypto.randomUUID();
  }
}

/**
 * Best-effort insert into resend_message_correlation with a single retry on
 * transient failure. Failure is logged with the structured marker
 * `correlation_chain_broken` (Sentry-pickup) but NEVER thrown — the email is
 * already delivered. Cost: ~0ms in the happy path; ~150ms when the retry
 * fires. Path B fallback per Pitfall 17 / RESEARCH Open Question 1.
 */
async function insertCorrelationMapping(
  admin: ReturnType<typeof createAdminClient>,
  correlation_id: string,
  resend_message_id: string,
): Promise<void> {
  const payload = {
    correlation_id,
    resend_message_id,
    sent_at: new Date().toISOString(),
  };
  // First attempt.
  let { error } = await admin.from("resend_message_correlation").insert(payload);
  if (!error) return;
  const firstError = error;
  // Backoff ~150ms then retry once. Single retry covers transient connection
  // hiccups without blocking the send for more than a perceptible blink.
  await new Promise((r) => setTimeout(r, 150));
  ({ error } = await admin.from("resend_message_correlation").insert(payload));
  if (!error) return;
  // Both attempts failed — log a structured warning and move on.
  console.warn("[email] correlation_chain_broken", {
    resend_message_id,
    correlation_id,
    first_error: firstError.message,
    retry_error: error.message,
  });
}

/**
 * Low-level send primitive. Writes an audit row to `notification_dispatches`
 * (migration 018), calls Resend, and best-effort updates the row with the
 * outcome. Failures in either the audit write or the Resend call are
 * swallowed — the public `notify*` helpers should never crash their callers.
 *
 * The `notificationType` parameter is required so operators can filter the
 * audit trail by category (e.g., "manager_intro_request" vs "alert_digest").
 *
 * Phase 16 / OBSERV-03: every send carries a `correlation_id` tag (Path A)
 * and, on success, attempts a best-effort row insert into
 * `resend_message_correlation` with 1 retry (Path B). The webhook handler at
 * /api/webhooks/resend uses both paths to recover the cid.
 */
async function send(
  to: string,
  subject: string,
  html: string,
  notificationType: NotificationType,
  cc?: string | string[],
): Promise<void> {
  if (!to) return;

  // Audit-2026-05-07 P324: strip CR/LF/comma from the recipient before
  // either auditing or sending. A null result means the address can't
  // be made safe (header-injection attempt, malformed input) — abort
  // the send entirely rather than write a tainted audit row or hand
  // the dirty string to Resend.
  const safeTo = sanitizeEmailRecipient(to);
  if (!safeTo) {
    console.warn(
      "[email] recipient rejected by sanitizeEmailRecipient (header-injection guard):",
      JSON.stringify(to),
    );
    return;
  }

  const admin = getAuditAdminClient();

  const dispatchRow = {
    notification_type: notificationType,
    recipient_email: safeTo,
    subject,
    status: "queued" as const,
    metadata: cc ? { cc } : null,
  };

  let dispatchId: string | undefined;
  if (admin) {
    try {
      const { data, error: insertErr } = await admin
        .from("notification_dispatches")
        .insert(dispatchRow)
        .select("id")
        .single();
      if (insertErr) {
        console.warn(
          "[email] notification_dispatches insert failed (non-blocking):",
          insertErr.message,
        );
      } else {
        dispatchId = data?.id;
      }
    } catch (err) {
      console.warn(
        "[email] notification_dispatches insert threw (non-blocking):",
        err,
      );
    }
  }

  if (!resend) {
    console.warn("[email] Resend not configured — skipping send to", safeTo);
    // Fire-and-forget: audit trail updates must never block the caller.
    void markDispatch(admin, dispatchId, {
      status: "failed",
      error: "Resend not configured",
    });
    return;
  }

  // Phase 16 / OBSERV-03: resolve correlation_id BEFORE the retry loop so all
  // attempts carry the same cid tag (the same logical email keeps the same
  // chain id even on transient retries).
  const correlationId = await resolveCorrelationId();

  // Retry with exponential backoff: 2 retries (3 total attempts).
  // Base delay 500ms, so attempts fire at ~0ms, ~500ms, ~1000ms.
  // A transient Resend 5xx or network blip is recovered silently;
  // a persistent failure still lands in the audit trail as 'failed'.
  const MAX_ATTEMPTS = 3;
  const BASE_DELAY_MS = 500;
  let sendError: unknown = null;
  let resendMessageId: string | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    sendError = null;
    try {
      const result = await resend.emails.send({
        from: FROM,
        to: safeTo,
        cc,
        subject,
        html,
        // Path A (Resend tag round-trip): the webhook handler reads
        // correlation_id from `data.tags` first; the kind tag mirrors the
        // notification_type for operator filtering.
        tags: [
          { name: "correlation_id", value: correlationId },
          { name: "kind", value: notificationType },
        ],
      });
      if (result.error) {
        sendError = result.error;
      } else if (result.data?.id) {
        resendMessageId = result.data.id;
      }
    } catch (err) {
      sendError = err;
    }

    if (!sendError) break; // Success — exit retry loop.

    // Don't retry on the last attempt — fall through to the failure path.
    if (attempt < MAX_ATTEMPTS - 1) {
      const delayMs = BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(
        `[email] Send attempt ${attempt + 1}/${MAX_ATTEMPTS} failed, retrying in ${delayMs}ms:`,
        errorMessage(sendError),
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (sendError) {
    console.error("[email] Failed to send after all retries:", subject, sendError);
    void markDispatch(admin, dispatchId, {
      status: "failed",
      error: errorMessage(sendError),
    });
    return;
  }

  // Path B (best-effort fallback per Pitfall 17): write the mapping row with
  // 1 retry. Cost: ~0ms in the happy path; ~150ms when retry fires. Failure
  // is logged via `correlation_chain_broken` so Sentry can flag chain breaks
  // for triage — but NEVER blocks the send (the email is already accepted).
  if (resendMessageId && admin) {
    try {
      await insertCorrelationMapping(admin, correlationId, resendMessageId);
    } catch (err) {
      // Defense-in-depth: insertCorrelationMapping already swallows all
      // errors internally, but a future regression that re-throws must still
      // not crash the send path.
      console.warn(
        "[email] correlation_chain_broken (helper threw, non-blocking):",
        err,
      );
    }
  }

  // Happy path: Resend accepted the message. Fire-and-forget the update to
  // 'sent' — the email is already delivered, so blocking the caller on the
  // audit write only adds ~60ms of latency. A failure here does NOT mark
  // the email as failed; the row stays in 'queued' and operators can spot
  // stuck rows via the queued + age > threshold query.
  void markDispatch(admin, dispatchId, {
    status: "sent",
    sent_at: new Date().toISOString(),
  });
}

/**
 * Best-effort update of a notification_dispatches row. Never throws — a
 * failed audit update must not corrupt the caller's control flow.
 */
async function markDispatch(
  admin: ReturnType<typeof createAdminClient> | null,
  dispatchId: string | undefined,
  patch: { status: "sent" | "failed"; error?: string; sent_at?: string },
): Promise<void> {
  if (!admin || !dispatchId) return;
  try {
    const { error: updateErr } = await admin
      .from("notification_dispatches")
      .update(patch)
      .eq("id", dispatchId);
    if (updateErr) {
      console.warn(
        "[email] notification_dispatches update failed (non-blocking):",
        updateErr.message,
      );
    }
  } catch (err) {
    console.warn(
      "[email] notification_dispatches update threw (non-blocking):",
      err,
    );
  }
}

/**
 * Extract a human-readable message from any thrown value. Handles:
 *   - Error instances (err.message)
 *   - Resend's error shape: { message: string, name: string }
 *   - Primitive strings
 *   - Anything else (falls back to JSON.stringify, then String())
 *
 * Without this helper, throwing a plain object like `{ message: "Rate limit" }`
 * would persist as "[object Object]" in the audit trail, which is useless
 * for operators trying to diagnose a flaky send.
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === "string") return m;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Minimal HTML escape for user-supplied free text (founder notes, bios). */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Strip CR/LF + control characters from email subject lines.
 * Prevents header injection via attacker-controlled fields like strategy
 * names or display_name. Resend's SDK already sanitizes most cases but
 * defense-in-depth applies the same hygiene at the call site.
 */
function safeSubject(input: string): string {
  return input.replace(/[\r\n\t\v\f]+/g, " ").slice(0, 250);
}

/**
 * Audit-2026-05-07 P324: defense-in-depth sanitizer for the `to` field
 * passed to `resend.emails.send()`. CR/LF/comma in a recipient address
 * is the classic header-injection vector — attacker-controlled input
 * that smuggles a Bcc: header or extra recipients onto the SMTP
 * envelope. Resend's API treats the `to` field as parsed structure
 * rather than raw header text, so the practical exploit surface is
 * narrow, but stripping these characters at the boundary is cheap and
 * removes the attack class entirely.
 *
 * Rules:
 *  - Strip CR (\r), LF (\n), and comma (,) — these are the only
 *    characters with header-injection semantics in an address. Other
 *    whitespace is preserved (a stray space is at worst a Resend
 *    400, not a security boundary).
 *  - Validate the trimmed result against `^[^\r\n,@]+@[^\r\n,@]+$` —
 *    must contain EXACTLY one `@` with non-empty, injection-free
 *    local and domain parts. Anything else (zero or 2+ `@`, or
 *    surviving CR/LF/comma) returns null and the send is aborted
 *    upstream. The exclusion of `@` from both character classes is
 *    load-bearing: a payload like `"a@b.com\nBcc: c@d.com"` strips
 *    to `"a@b.comBcc: c@d.com"` which has TWO `@` signs — without
 *    the `@` exclusion the greedy regex would match it.
 *
 * Returns the cleaned address on success, or null when the input
 * cannot be made safe (empty after strip, no `@`, multiple `@`, etc.).
 * Callers should treat null as "skip the send" — the same semantics
 * as the existing `if (!to) return` guard in `send()`.
 */
export function sanitizeEmailRecipient(input: string | null | undefined): string | null {
  if (!input) return null;
  // Strip the three header-injection characters. Note: we intentionally do
  // NOT strip tabs / vertical tabs / form feeds — those don't have
  // header-injection semantics in an SMTP address, and stripping them
  // could mask a malformed-input bug at the call site.
  const cleaned = input.replace(/[\r\n,]/g, "");
  if (!cleaned) return null;
  // Strict shape check: exactly one `@`, non-empty local + non-empty
  // domain, with no surviving CR/LF/comma. The `@`-exclusion in the
  // character classes prevents a smuggled second address slipping
  // through after the strip removed the separator. Defensive — the
  // strip already removed CR/LF/comma, but the regex re-asserts.
  if (!/^[^\r\n,@]+@[^\r\n,@]+$/.test(cleaned)) return null;
  return cleaned;
}

function escapeHref(input: string): string {
  // Allow only http(s) / mailto / relative URLs
  try {
    const u = new URL(input, APP_URL);
    if (!["http:", "https:", "mailto:"].includes(u.protocol)) return "";
    return u.toString().replace(/"/g, "%22");
  } catch {
    return "";
  }
}

// --- Manager notifications ---

export async function notifyManagerIntroRequest(
  managerEmail: string,
  allocatorName: string,
  strategyName: string,
) {
  const safeAllocator = escapeHtml(allocatorName);
  const safeStrategy = escapeHtml(strategyName);
  await send(
    managerEmail,
    safeSubject(`New introduction request for ${strategyName}`),
    `<p>Hi,</p>
     <p><strong>${safeAllocator}</strong> has requested an introduction to your strategy <strong>${safeStrategy}</strong> on ${PLATFORM_NAME}.</p>
     <p>The ${PLATFORM_NAME} team will review and facilitate this introduction shortly.</p>
     ${SIGNATURE}`,
    "manager_intro_request",
  );
}

export async function notifyManagerApproved(
  managerEmail: string,
  strategyName: string,
  strategyId: string,
) {
  const safeStrategy = escapeHtml(strategyName);
  await send(
    managerEmail,
    safeSubject(`Your strategy "${strategyName}" is now live`),
    `<p>Hi,</p>
     <p>Your strategy <strong>${safeStrategy}</strong> has been approved and is now visible to allocators on ${PLATFORM_NAME}.</p>
     <p>Share your verified factsheet to attract allocators:</p>
     <p><a href="${APP_URL}/factsheet/${strategyId}" style="color:${BRAND_COLOR};">View your factsheet</a></p>
     ${SIGNATURE}`,
    "manager_approved",
  );
}

// --- Allocator notifications ---

export async function notifyAllocatorIntroStatus(
  allocatorEmail: string,
  strategyName: string,
  status: string,
) {
  const statusMessages: Record<string, string> = {
    intro_made:
      "An introduction has been arranged. You should hear from the manager shortly.",
    completed: "The introduction has been completed.",
    declined: "Unfortunately, this introduction request was declined.",
  };

  // status comes from a controlled enum, but escape defensively in case a
  // future call site widens it. message comes from the map (constants only).
  const message = statusMessages[status] ?? `Status updated to: ${escapeHtml(status)}.`;
  const safeStrategy = escapeHtml(strategyName);

  await send(
    allocatorEmail,
    safeSubject(`Introduction update: ${strategyName}`),
    `<p>Hi,</p>
     <p>Your introduction request for <strong>${safeStrategy}</strong> has been updated.</p>
     <p>${message}</p>
     <p><a href="${APP_URL}/login" style="color:${BRAND_COLOR};">Log in to ${PLATFORM_NAME}</a> to view details.</p>
     ${SIGNATURE}`,
    "allocator_intro_status",
  );
}

// --- Founder notifications ---

/**
 * Shared fallback ladder for "who submitted this" labels in founder
 * emails and admin UIs. Prefers the profile display name, falls back
 * to the firm/company, then the auth email, then a hard-coded
 * sentinel. Used by the wizard finalize path and the legacy
 * notify-submission route so both produce identical manager strings.
 */
export async function resolveManagerName(
  admin: ReturnType<typeof createAdminClient>,
  user: { id: string; email?: string | null },
): Promise<string> {
  const { data: profile } = await admin
    .from("profiles")
    .select("display_name, company")
    .eq("id", user.id)
    .single();
  return profile?.display_name ?? profile?.company ?? user.email ?? "Unknown";
}

export async function notifyFounderNewStrategy(
  strategyName: string,
  managerName: string,
) {
  const founder = founderEmail();
  if (!founder) return;
  const safeStrategy = escapeHtml(strategyName);
  const safeManager = escapeHtml(managerName);
  await send(
    founder,
    safeSubject(`New strategy submitted: ${strategyName}`),
    `<p>A new strategy has been submitted for review.</p>
     <p><strong>Strategy:</strong> ${safeStrategy}<br/>
     <strong>Manager:</strong> ${safeManager}</p>
     <p><a href="${APP_URL}/admin" style="color:${BRAND_COLOR};">Review in admin dashboard</a></p>`,
    "founder_new_strategy",
  );
}

export async function notifyFounderIntroRequest(
  allocatorName: string,
  strategyName: string,
) {
  const founder = founderEmail();
  if (!founder) return;
  const safeAllocator = escapeHtml(allocatorName);
  const safeStrategy = escapeHtml(strategyName);
  await send(
    founder,
    safeSubject(`New intro request: ${allocatorName} → ${strategyName}`),
    `<p>A new introduction has been requested.</p>
     <p><strong>Allocator:</strong> ${safeAllocator}<br/>
     <strong>Strategy:</strong> ${safeStrategy}</p>
     <p><a href="${APP_URL}/admin" style="color:${BRAND_COLOR};">Manage in admin dashboard</a></p>`,
    "founder_intro_request",
  );
}

// --- Self-serve intro confirmation (POST /api/intro) ---

/**
 * Sent to the allocator after they click "Request intro" on a strategy detail
 * page. Includes the manager identity block when the strategy is in the
 * institutional disclosure tier. Exploratory-tier strategies get a redacted
 * version that only confirms the codename — the manager's identity is disclosed
 * only if / when the manager accepts the introduction.
 */
export async function notifyAllocatorOfIntroRequest(
  allocatorEmail: string,
  strategyName: string,
  strategyId: string,
  manager: ManagerIdentity | null,
) {
  const managerBlock = manager
    ? renderManagerIdentityBlock(manager)
    : `<p style="color:#4A5568;">The manager's identity will be disclosed if they accept the introduction.</p>`;

  await send(
    allocatorEmail,
    safeSubject(`Intro request received: ${strategyName}`),
    `<div style="font-family:'DM Sans',sans-serif;max-width:600px;">
       <p>Hi,</p>
       <p>Your request for an introduction to <strong>${escapeHtml(strategyName)}</strong> has been received. The ${PLATFORM_NAME} team is reviewing it and will coordinate the introduction.</p>
       ${managerBlock}
       <p><a href="${APP_URL}/factsheet/${strategyId}" style="color:${BRAND_COLOR};">View the factsheet →</a></p>
       ${SIGNATURE}
     </div>`,
    "allocator_intro_request",
  );
}

// --- Admin-facilitated intros (Match Queue Send Intro) ---

/**
 * Best-effort display name for a manager row. Matches the display precedence
 * used throughout the app (display_name → company → "the manager") so the
 * same identity resolves to the same string in emails and the UI.
 */
function managerDisplayName(manager: ManagerIdentity): string {
  return manager.display_name ?? manager.company ?? "the manager";
}

function renderManagerIdentityBlock(manager: ManagerIdentity): string {
  const parts: string[] = [
    `<p><strong>${escapeHtml(managerDisplayName(manager))}</strong>${manager.years_trading ? ` — ${manager.years_trading}+ years trading` : ""}${manager.aum_range ? ` — ${escapeHtml(manager.aum_range)} AUM` : ""}</p>`,
  ];
  if (manager.bio) {
    parts.push(`<p style="color:#4A5568;">${escapeHtml(manager.bio)}</p>`);
  }
  if (manager.linkedin) {
    const safeHref = escapeHref(manager.linkedin);
    if (safeHref) {
      parts.push(
        `<p><a href="${safeHref}" style="color:${BRAND_COLOR};">LinkedIn profile →</a></p>`,
      );
    }
  }
  return parts.join("\n");
}

/**
 * Email sent to the allocator when the founder dispatches an admin-facilitated intro
 * from the Match Queue. CCs the founder so the conversation is on-thread from turn 0.
 */
export async function notifyAllocatorOfAdminIntro(
  allocatorEmail: string,
  manager: ManagerIdentity,
  strategyName: string,
  strategyId: string,
  founderNote: string,
) {
  const cc = founderEmail() || undefined;
  await send(
    allocatorEmail,
    safeSubject(`Introduction: ${managerDisplayName(manager)} — ${strategyName}`),
    `<div style="font-family:'DM Sans',sans-serif;max-width:600px;">
       <p>Hi,</p>
       <p>Based on your mandate, I wanted to introduce you to a manager on ${PLATFORM_NAME} I think you'll find interesting.</p>
       ${renderManagerIdentityBlock(manager)}
       <p><strong>Strategy:</strong> ${escapeHtml(strategyName)}</p>
       <blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid ${BRAND_COLOR};color:#1A1A2E;">${escapeHtml(founderNote)}</blockquote>
       <p><a href="${APP_URL}/factsheet/${strategyId}" style="color:${BRAND_COLOR};">Review the full factsheet →</a></p>
       <p>Reply to this email and we'll coordinate a conversation.</p>
       ${SIGNATURE}
     </div>`,
    "allocator_admin_intro",
    cc,
  );
}

/**
 * Email sent to the manager when the founder dispatches an admin-facilitated intro.
 * CCs the founder so the three-way thread is seeded correctly.
 */
export async function notifyManagerOfAdminIntro(
  managerEmail: string,
  allocatorName: string,
  strategyName: string,
  founderNote: string,
) {
  const cc = founderEmail() || undefined;
  await send(
    managerEmail,
    safeSubject(`Allocator introduction: ${allocatorName} → ${strategyName}`),
    `<div style="font-family:'DM Sans',sans-serif;max-width:600px;">
       <p>Hi,</p>
       <p>I'm introducing you to <strong>${escapeHtml(allocatorName)}</strong>, an allocator on ${PLATFORM_NAME} whose mandate aligns with <strong>${escapeHtml(strategyName)}</strong>.</p>
       <blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid ${BRAND_COLOR};color:#1A1A2E;">${escapeHtml(founderNote)}</blockquote>
       <p>Feel free to reply-all to start the conversation. I'll step out once you're connected.</p>
       ${SIGNATURE}
     </div>`,
    "manager_admin_intro",
    cc,
  );
}

// --- Portfolio alert digest ---

export interface AlertDigestEntry {
  /** Required for ack-from-email URL generation and as a stable dedup key. */
  id: string;
  alert_type: string;
  severity: AlertSeverity;
  message: string;
  triggered_at: string;
  /**
   * Signed HMAC ack URL. When present, the digest row renders an
   * "Acknowledge" link that routes through /api/alerts/ack. The caller
   * (src/app/api/alert-digest/route.ts) mints the token via
   * `signAlertAckToken(row.id)` so this module stays pure-rendering.
   */
  ack_url?: string;
}

export async function sendAlertDigest(
  email: string,
  portfolioName: string,
  alerts: AlertDigestEntry[],
) {
  if (alerts.length === 0) return;

  const safePortfolio = escapeHtml(portfolioName);
  const subject = safeSubject(
    `${alerts.length} alert${alerts.length > 1 ? "s" : ""} for ${portfolioName}`,
  );

  const alertsHtml = alerts
    .map(
      (a) => `
    <tr>
      <td style="padding:12px;border-bottom:1px solid #E2E8F0;vertical-align:top;">
        <span style="display:inline-block;padding:2px 8px;background:${SEVERITY_HEX[a.severity]};color:#fff;font-size:11px;text-transform:uppercase;border-radius:4px;">
          ${escapeHtml(a.severity)}
        </span>
      </td>
      <td style="padding:12px;border-bottom:1px solid #E2E8F0;color:#1A1A2E;">
        ${escapeHtml(a.message)}
      </td>
      <td style="padding:12px;border-bottom:1px solid #E2E8F0;text-align:right;vertical-align:top;white-space:nowrap;">
        ${
          a.ack_url
            ? `<a href="${escapeHtml(a.ack_url)}" style="color:${BRAND_COLOR};font-weight:500;font-size:13px;text-decoration:none;">Acknowledge</a>`
            : ""
        }
      </td>
    </tr>
  `,
    )
    .join("");

  await send(
    email,
    subject,
    `
    <div style="font-family:'DM Sans',sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#1A1A2E;font-size:20px;margin-bottom:8px;">Portfolio Alerts</h2>
      <p style="color:#4A5568;margin-bottom:16px;">
        The following alerts triggered for <strong>${safePortfolio}</strong>:
      </p>
      <table style="width:100%;border-collapse:collapse;">
        ${alertsHtml}
      </table>
      <p style="margin-top:24px;">
        <a href="${APP_URL}/portfolios" style="color:${BRAND_COLOR};font-weight:500;">
          View in dashboard →
        </a>
      </p>
      ${SIGNATURE}
    </div>
  `,
    "alert_digest",
  );
}

/**
 * Generic founder notification — used for account deletion requests and other
 * admin-side signals that don't fit the purpose-built helpers above.
 *
 * The caller is responsible for HTML-escaping any user-supplied fields they
 * interpolate into bodyHtml. The subject is sanitized here for header safety.
 */
export async function notifyFounderGeneric(subject: string, bodyHtml: string) {
  const founder = founderEmail();
  if (!founder) return;
  await send(
    founder,
    safeSubject(subject),
    `<div style="font-family:'DM Sans',sans-serif;max-width:600px;">${bodyHtml}${SIGNATURE}</div>`,
    "founder_generic",
  );
}

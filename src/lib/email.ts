import { Resend } from "resend";
import { SEVERITY_HEX } from "./utils";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// Whitelabel-friendly platform identity. Defaults keep Quantalyze branding;
// a partner deployment flips these via env vars without touching code.
const PLATFORM_NAME = process.env.PLATFORM_NAME ?? "Quantalyze";
const PLATFORM_EMAIL = process.env.PLATFORM_EMAIL ?? "notifications@quantalyze.com";
const FROM = `${PLATFORM_NAME} <${PLATFORM_EMAIL}>`;
const FOUNDER_EMAIL = process.env.ADMIN_EMAIL ?? "";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://quantalyze.com";
const BRAND_COLOR = "#1B6B5A"; // muted teal, per DESIGN.md
const SIGNATURE = `<p style="color:#666;font-size:13px;">— ${PLATFORM_NAME}</p>`;

async function send(
  to: string,
  subject: string,
  html: string,
  cc?: string | string[],
) {
  if (!resend) return;
  if (!to) return;

  try {
    await resend.emails.send({ from: FROM, to, cc, subject, html });
  } catch (err) {
    console.error("[email] Failed to send:", subject, err);
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
  );
}

// --- Founder notifications ---

export async function notifyFounderNewStrategy(
  strategyName: string,
  managerName: string,
) {
  if (!FOUNDER_EMAIL) return;
  const safeStrategy = escapeHtml(strategyName);
  const safeManager = escapeHtml(managerName);
  await send(
    FOUNDER_EMAIL,
    safeSubject(`New strategy submitted: ${strategyName}`),
    `<p>A new strategy has been submitted for review.</p>
     <p><strong>Strategy:</strong> ${safeStrategy}<br/>
     <strong>Manager:</strong> ${safeManager}</p>
     <p><a href="${APP_URL}/admin" style="color:${BRAND_COLOR};">Review in admin dashboard</a></p>`,
  );
}

export async function notifyFounderIntroRequest(
  allocatorName: string,
  strategyName: string,
) {
  if (!FOUNDER_EMAIL) return;
  const safeAllocator = escapeHtml(allocatorName);
  const safeStrategy = escapeHtml(strategyName);
  await send(
    FOUNDER_EMAIL,
    safeSubject(`New intro request: ${allocatorName} → ${strategyName}`),
    `<p>A new introduction has been requested.</p>
     <p><strong>Allocator:</strong> ${safeAllocator}<br/>
     <strong>Strategy:</strong> ${safeStrategy}</p>
     <p><a href="${APP_URL}/admin" style="color:${BRAND_COLOR};">Manage in admin dashboard</a></p>`,
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
  manager: ManagerIdentityBlock | null,
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
  );
}

// --- Admin-facilitated intros (Match Queue Send Intro) ---

export interface ManagerIdentityBlock {
  name: string;
  bio?: string | null;
  yearsTrading?: number | null;
  aumRange?: string | null;
  linkedinUrl?: string | null;
  disclosureTier?: "institutional" | "exploratory" | null;
}

function renderManagerIdentityBlock(manager: ManagerIdentityBlock): string {
  const parts: string[] = [
    `<p><strong>${escapeHtml(manager.name)}</strong>${manager.yearsTrading ? ` — ${manager.yearsTrading}+ years trading` : ""}${manager.aumRange ? ` — ${escapeHtml(manager.aumRange)} AUM` : ""}</p>`,
  ];
  if (manager.bio) {
    parts.push(`<p style="color:#4A5568;">${escapeHtml(manager.bio)}</p>`);
  }
  if (manager.linkedinUrl) {
    const safeHref = escapeHref(manager.linkedinUrl);
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
  manager: ManagerIdentityBlock,
  strategyName: string,
  strategyId: string,
  founderNote: string,
) {
  const cc = FOUNDER_EMAIL || undefined;
  await send(
    allocatorEmail,
    safeSubject(`Introduction: ${manager.name} — ${strategyName}`),
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
  const cc = FOUNDER_EMAIL || undefined;
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
    cc,
  );
}

// --- Portfolio alert digest ---

export interface AlertDigestEntry {
  alert_type: string;
  severity: "high" | "medium" | "low";
  message: string;
  triggered_at: string;
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
      <td style="padding:12px;border-bottom:1px solid #E2E8F0;">
        <span style="display:inline-block;padding:2px 8px;background:${SEVERITY_HEX[a.severity]};color:#fff;font-size:11px;text-transform:uppercase;border-radius:4px;">
          ${escapeHtml(a.severity)}
        </span>
      </td>
      <td style="padding:12px;border-bottom:1px solid #E2E8F0;color:#1A1A2E;">
        ${escapeHtml(a.message)}
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
  if (!FOUNDER_EMAIL) return;
  await send(
    FOUNDER_EMAIL,
    safeSubject(subject),
    `<div style="font-family:'DM Sans',sans-serif;max-width:600px;">${bodyHtml}${SIGNATURE}</div>`,
  );
}

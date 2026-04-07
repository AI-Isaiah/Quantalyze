import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM = "Quantalyze <notifications@quantalyze.com>";
const FOUNDER_EMAIL = process.env.ADMIN_EMAIL ?? "";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://quantalyze.com";

async function send(to: string, subject: string, html: string) {
  if (!resend) return;
  if (!to) return;

  try {
    await resend.emails.send({ from: FROM, to, subject, html });
  } catch (err) {
    console.error("[email] Failed to send:", subject, err);
  }
}

// --- Manager notifications ---

export async function notifyManagerIntroRequest(
  managerEmail: string,
  allocatorName: string,
  strategyName: string,
) {
  await send(
    managerEmail,
    `New introduction request for ${strategyName}`,
    `<p>Hi,</p>
     <p><strong>${allocatorName}</strong> has requested an introduction to your strategy <strong>${strategyName}</strong> on Quantalyze.</p>
     <p>The Quantalyze team will review and facilitate this introduction shortly.</p>
     <p style="color:#666;font-size:13px;">— Quantalyze</p>`,
  );
}

export async function notifyManagerApproved(
  managerEmail: string,
  strategyName: string,
  strategyId: string,
) {
  await send(
    managerEmail,
    `Your strategy "${strategyName}" is now live`,
    `<p>Hi,</p>
     <p>Your strategy <strong>${strategyName}</strong> has been approved and is now visible to allocators on Quantalyze.</p>
     <p>Share your verified factsheet to attract allocators:</p>
     <p><a href="${APP_URL}/factsheet/${strategyId}" style="color:#0D9488;">View your factsheet</a></p>
     <p style="color:#666;font-size:13px;">— Quantalyze</p>`,
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

  const message = statusMessages[status] ?? `Status updated to: ${status}.`;

  await send(
    allocatorEmail,
    `Introduction update: ${strategyName}`,
    `<p>Hi,</p>
     <p>Your introduction request for <strong>${strategyName}</strong> has been updated.</p>
     <p>${message}</p>
     <p><a href="${APP_URL}/login" style="color:#0D9488;">Log in to Quantalyze</a> to view details.</p>
     <p style="color:#666;font-size:13px;">— Quantalyze</p>`,
  );
}

// --- Founder notifications ---

export async function notifyFounderNewStrategy(
  strategyName: string,
  managerName: string,
) {
  if (!FOUNDER_EMAIL) return;
  await send(
    FOUNDER_EMAIL,
    `New strategy submitted: ${strategyName}`,
    `<p>A new strategy has been submitted for review.</p>
     <p><strong>Strategy:</strong> ${strategyName}<br/>
     <strong>Manager:</strong> ${managerName}</p>
     <p><a href="${APP_URL}/admin" style="color:#0D9488;">Review in admin dashboard</a></p>`,
  );
}

export async function notifyFounderIntroRequest(
  allocatorName: string,
  strategyName: string,
) {
  if (!FOUNDER_EMAIL) return;
  await send(
    FOUNDER_EMAIL,
    `New intro request: ${allocatorName} → ${strategyName}`,
    `<p>A new introduction has been requested.</p>
     <p><strong>Allocator:</strong> ${allocatorName}<br/>
     <strong>Strategy:</strong> ${strategyName}</p>
     <p><a href="${APP_URL}/admin" style="color:#0D9488;">Manage in admin dashboard</a></p>`,
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

  const subject = `${alerts.length} alert${alerts.length > 1 ? "s" : ""} for ${portfolioName}`;

  const severityColor = (s: string) =>
    s === "high" ? "#DC2626" : s === "medium" ? "#D97706" : "#0D9488";

  const alertsHtml = alerts
    .map(
      (a) => `
    <tr>
      <td style="padding:12px;border-bottom:1px solid #E2E8F0;">
        <span style="display:inline-block;padding:2px 8px;background:${severityColor(a.severity)};color:#fff;font-size:11px;text-transform:uppercase;border-radius:4px;">
          ${a.severity}
        </span>
      </td>
      <td style="padding:12px;border-bottom:1px solid #E2E8F0;color:#1A1A2E;">
        ${a.message}
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
        The following alerts triggered for <strong>${portfolioName}</strong>:
      </p>
      <table style="width:100%;border-collapse:collapse;">
        ${alertsHtml}
      </table>
      <p style="margin-top:24px;">
        <a href="${APP_URL}/portfolios" style="color:#0D9488;font-weight:500;">
          View in dashboard →
        </a>
      </p>
      <p style="color:#666;font-size:13px;margin-top:16px;">— Quantalyze</p>
    </div>
  `,
  );
}

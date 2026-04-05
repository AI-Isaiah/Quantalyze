const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "https://quantalyze.vercel.app";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!RESEND_API_KEY || !ADMIN_EMAIL) {
    return new Response(JSON.stringify({ error: "Notification service not configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await req.json();
  const { type, allocator_name, allocator_company, strategy_name, message, manager_name } = body;

  // Escape HTML to prevent injection via user-supplied fields
  function esc(str: string | undefined | null): string {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  const safeName = esc(allocator_name);
  const safeCompany = esc(allocator_company);
  const safeStrategy = esc(strategy_name);
  const safeMessage = esc(message);
  const safeManager = esc(manager_name);

  let subject: string;
  let html: string;

  if (type === "intro_request") {
    subject = `New intro request: ${safeName} → ${safeStrategy}`;
    html = `
      <div style="font-family: Inter, sans-serif; max-width: 500px;">
        <h2 style="color: #1E293B;">New Intro Request</h2>
        <p><strong>${safeName}</strong>${safeCompany ? ` (${safeCompany})` : ""} wants an introduction to <strong>${safeStrategy}</strong>.</p>
        ${safeMessage ? `<p style="background: #F8FAFC; padding: 12px; border-radius: 8px; color: #475569;">${safeMessage}</p>` : ""}
        <a href="${APP_URL}/login?redirect=/admin" style="display: inline-block; margin-top: 16px; padding: 10px 20px; background: #0D9488; color: white; border-radius: 8px; text-decoration: none;">Open Admin Dashboard</a>
      </div>
    `;
  } else if (type === "strategy_review") {
    subject = `Strategy submitted for review: ${safeStrategy}`;
    html = `
      <div style="font-family: Inter, sans-serif; max-width: 500px;">
        <h2 style="color: #1E293B;">Strategy Review Needed</h2>
        <p><strong>${safeManager}</strong> submitted <strong>${safeStrategy}</strong> for review.</p>
        <a href="${APP_URL}/login?redirect=/admin" style="display: inline-block; margin-top: 16px; padding: 10px 20px; background: #0D9488; color: white; border-radius: 8px; text-decoration: none;">Review Strategy</a>
      </div>
    `;
  } else {
    return new Response(JSON.stringify({ error: "Unknown notification type" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "Quantalyze <notifications@quantalyze.com>",
      to: ADMIN_EMAIL,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Resend API error:", err);
    return new Response(JSON.stringify({ error: "Email send failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
});

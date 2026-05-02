import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { Webhook } from "svix";
import { createAdminClient } from "@/lib/supabase/admin";

// Phase 16 / OBSERV-03 — Resend webhook receiver with Svix-verified signature
// + 3-path correlation_id extraction. Webhook is cross-origin by design —
// signature verification IS the auth, per Shared Pattern G in 16-PATTERNS.md
// (CSRF / same-origin guards explicitly DO NOT apply here).
//
// Resend's webhook signing is delegated to Svix per their public docs:
//   https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
// Headers: svix-id, svix-timestamp, svix-signature. The ±5-min replay-window
// guard is enforced inside Webhook.verify() — we never need to check
// timestamps ourselves.
//
// nodejs runtime (NOT edge): the svix package ships with Node-only crypto
// helpers. Pitfall 2 in 16-RESEARCH.md mandates nodejs runtime for any
// route that imports svix.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ResendWebhookPayload {
  type?: string;
  data?: {
    email_id?: string;
    tags?:
      | Array<{ name: string; value: string }>
      | Record<string, string>
      | null;
    [key: string]: unknown;
  };
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error(
      "[resend-webhook] RESEND_WEBHOOK_SECRET unset — rejecting all webhook calls",
    );
    return NextResponse.json({ error: "Server misconfigured" }, { status: 503 });
  }

  // Read raw body BEFORE signature verify (Svix signs the bytes-on-the-wire).
  const rawBody = await req.text();

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");

  if (!svixSignature || !svixId || !svixTimestamp) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: ResendWebhookPayload;
  try {
    const wh = new Webhook(secret);
    // verify() throws WebhookVerificationError on bad signature OR if
    // svix-timestamp is older/newer than ±5 minutes (replay-window guard).
    // On success it returns the parsed JSON payload.
    payload = wh.verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ResendWebhookPayload;
  } catch (err) {
    // Log the verifier exception for ops triage; do NOT echo it in the
    // response (information disclosure). 401 is returned for any failure
    // (bad signature, expired/future timestamp, malformed header) so an
    // attacker probing the endpoint cannot distinguish failure modes.
    console.warn(
      "[resend-webhook] svix verify failed:",
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Path A: tags array (Resend send-API canonical shape).
  let correlationId: string | null = null;
  let path: "tags-array" | "tags-dict" | "mapping-table" | "unrecoverable" =
    "unrecoverable";

  const tags = payload.data?.tags;
  if (Array.isArray(tags)) {
    const found = tags.find((t) => t?.name === "correlation_id");
    if (found?.value) {
      correlationId = found.value;
      path = "tags-array";
    }
  } else if (tags && typeof tags === "object") {
    // Path A': dict-shape defensive fallback (some third-party docs report
    // this shape; keep the branch so an empirical Resend payload that uses a
    // dict does not silently drop the cid).
    const dictTags = tags as Record<string, string>;
    if (typeof dictTags.correlation_id === "string") {
      correlationId = dictTags.correlation_id;
      path = "tags-dict";
    }
  }

  // Path B: mapping table fallback (best-effort safety net per Pitfall 17).
  if (!correlationId && payload.data?.email_id) {
    try {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("resend_message_correlation")
        .select("correlation_id")
        .eq("resend_message_id", payload.data.email_id)
        .maybeSingle();
      if (!error && data?.correlation_id) {
        correlationId = data.correlation_id as string;
        path = "mapping-table";
      }
    } catch (err) {
      console.error("[resend-webhook] mapping-table lookup failed:", err);
    }
  }

  if (!correlationId) {
    console.warn("[resend-webhook] correlation_id unrecoverable", {
      email_id: payload.data?.email_id,
      type: payload.type,
    });
  } else {
    console.info("[resend-webhook] correlation_id recovered", {
      path,
      correlation_id: correlationId,
      email_id: payload.data?.email_id,
      type: payload.type,
    });
  }

  // Always 200 — Resend retries on 5xx; we have already accepted the event.
  return NextResponse.json({ ok: true });
}

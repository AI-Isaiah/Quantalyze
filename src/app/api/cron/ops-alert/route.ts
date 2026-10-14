import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { escapeHtml, founderEmail, notifyFounderGeneric } from "@/lib/email";
import { safeCompare } from "@/lib/timing-safe-compare";
import {
  OPS_ALERT_CAUSE_RE,
  OPS_ALERT_EVENTS,
  OPS_ALERT_SOURCES,
} from "@/lib/ops-alert-contract";

/**
 * POST /api/cron/ops-alert — the founder-email half of the ops alert channel
 * (Phase 164.6.8 OUTAGEALERT, plan 01, decision D-01).
 *
 * The Python analytics service (`services/ops_alert.py::page`) posts here when
 * an outage needs a human. This route turns the post into one founder email
 * through `notifyFounderGeneric`. The Sentry half of the channel is sent by
 * Python directly; this route never talks to Sentry about the OUTAGE, only
 * about its own failure to deliver.
 *
 * Auth: `Authorization: Bearer ${ANALYTICS_SERVICE_KEY}`. That is the value
 * this app already sends to Python as X-Service-Key, so it equals Python's
 * SERVICE_KEY on any working deployment: zero new credentials. `/api/cron/*`
 * bypasses the session proxy, so this check is the only gate. It fails closed
 * when the env is unset, and a credential is never echoed in any response.
 *
 * Non-2xx is the signal: Python logs a non-2xx answer, so an email that could
 * not be sent is never reported as sent (503 when no founder recipient is
 * configured, 502 when the send itself fails).
 */

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  source: z.enum(OPS_ALERT_SOURCES),
  event: z.enum(OPS_ALERT_EVENTS),
  cause: z.string().regex(new RegExp(`^(?:${OPS_ALERT_CAUSE_RE})$`)),
  since: z.iso.datetime({ offset: true }).nullable(),
  detected_at: z.iso.datetime({ offset: true }),
  detail: z.string().max(2000),
});

const ROUTE = "/api/cron/ops-alert";

function reportToSentry(failure: "no_recipient" | "send_failed", err?: unknown) {
  void import("@sentry/nextjs")
    .then((Sentry) => {
      const tags = { route: ROUTE, failure };
      if (err !== undefined) {
        Sentry.captureException(err, { tags });
      } else {
        Sentry.captureMessage(
          "ops-alert: founder recipient is not configured; alert email not sent",
          { level: "error", tags },
        );
      }
    })
    .catch(() => {});
}

export async function POST(req: NextRequest) {
  const key = process.env.ANALYTICS_SERVICE_KEY;
  const auth = req.headers.get("authorization");
  if (!key || !auth || !safeCompare(auth, `Bearer ${key}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch {
    // Fixed message: never echo the body back.
    return NextResponse.json({ error: "Invalid alert" }, { status: 400 });
  }

  // `notifyFounderGeneric` returns silently on an empty recipient, before
  // `send()` and before `throwOnSkip` is consulted. Without this check the
  // route would answer { sent: true } having sent nothing.
  if (!founderEmail()) {
    reportToSentry("no_recipient");
    return NextResponse.json(
      { error: "Founder recipient not configured" },
      { status: 503 },
    );
  }

  const label = parsed.event === "outage" ? "OUTAGE" : "RECOVERED";
  const subject = `[${label}] ${parsed.source}: ${parsed.cause}`;
  const row = (name: string, value: string) =>
    `<tr><td style="padding:2px 12px 2px 0;color:#666;">${name}</td><td>${escapeHtml(value)}</td></tr>`;
  const html =
    `<h3 style="margin:0 0 8px;">${label}: ${escapeHtml(parsed.source)}</h3>` +
    `<table>` +
    row("Source", parsed.source) +
    row("Event", parsed.event) +
    row("Cause", parsed.cause) +
    row("Since", parsed.since ?? "unknown") +
    row("Detected at", parsed.detected_at) +
    `</table>` +
    `<p style="white-space:pre-wrap;">${escapeHtml(parsed.detail)}</p>`;

  try {
    await notifyFounderGeneric(subject, html, {
      throwOnSkip: true,
      throwOnFailure: true,
    });
  } catch (err) {
    console.error("[ops-alert] founder email failed");
    reportToSentry("send_failed", err);
    return NextResponse.json({ error: "Email not sent" }, { status: 502 });
  }
  return NextResponse.json({ sent: true });
}

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendAlertDigest, type AlertDigestEntry } from "@/lib/email";
import { safeCompare } from "@/lib/timing-safe-compare";
import { signAlertAckToken } from "@/lib/alert-ack-token";
import { type AlertSeverity } from "@/lib/utils";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://quantalyze.com";

/**
 * P446 (audit-2026-05-07) — cap the unacked-alert fetch.
 *
 * Pre-fix this route did `SELECT ... FROM portfolio_alerts WHERE
 * acknowledged_at IS NULL AND emailed_at IS NULL` with NO LIMIT. A
 * backlog of 10K+ rows (a runaway alert engine, a backfill, a stuck
 * cron) would OOM the Vercel function before the digest even shipped.
 *
 * 1000 sits well above the legitimate 1-hour-window cadence the cron
 * runs at (a single user's portfolio realistically generates <50 alerts
 * per cycle) and well below the lambda's memory headroom. When we hit
 * the limit we log a warning so the operator notices the backlog —
 * the remaining alerts will land on the next cron cycle.
 */
const ALERT_FETCH_LIMIT = 1000;

interface PendingAlertRow {
  id: string;
  portfolio_id: string;
  alert_type: string;
  severity: AlertSeverity;
  message: string;
  triggered_at: string;
  portfolios: {
    id: string;
    name: string;
    user_id: string;
  } | null;
}

export async function POST(req: NextRequest) {
  // Verify cron secret — timing-safe comparison to prevent byte-by-byte
  // probing via response-time side channels.
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !auth || !safeCompare(auth, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Fetch all unacked + un-emailed alerts, joined with their portfolio.
  // P446 (audit-2026-05-07) — capped at ALERT_FETCH_LIMIT to bound
  // lambda memory; see ALERT_FETCH_LIMIT comment.
  const { data: pending, error: fetchError } = await admin
    .from("portfolio_alerts")
    .select(
      "id, portfolio_id, alert_type, severity, message, triggered_at, portfolios!inner(id, name, user_id)",
    )
    .is("acknowledged_at", null)
    .is("emailed_at", null)
    .order("triggered_at", { ascending: true })
    .limit(ALERT_FETCH_LIMIT);

  if (fetchError) {
    // P445 (audit-2026-05-07) — DO NOT leak `fetchError.message` to the
    // client. Postgres error messages can reveal column names, table
    // names, constraint detail, and join shapes useful to an attacker.
    // The cron caller authenticates via CRON_SECRET so it only needs to
    // know the request failed — Sentry / logs carry the diagnostic.
    console.error("[alert-digest] Fetch failed:", fetchError);
    void import("@sentry/nextjs")
      .then((Sentry) => {
        Sentry.captureException(fetchError, {
          tags: { route: "/api/alert-digest", phase: "fetch" },
        });
      })
      .catch(() => {});
    return NextResponse.json(
      { error: "Failed to send alert digest" },
      { status: 500 },
    );
  }

  const rows = (pending ?? []) as unknown as PendingAlertRow[];

  // P446 — log a warning at the limit boundary so the operator notices
  // the backlog. The remaining unacked alerts will surface on the next
  // cron tick; we don't paginate within a single invocation because the
  // groups+sends cost grows with row count and the cron is idempotent.
  if (rows.length === ALERT_FETCH_LIMIT) {
    console.warn(
      `[alert-digest] hit ALERT_FETCH_LIMIT (${ALERT_FETCH_LIMIT}). Backlog likely — remaining alerts deferred to next cron tick.`,
    );
  }

  if (rows.length === 0) {
    return NextResponse.json({ users_notified: 0, alerts_sent: 0 });
  }

  // Group by (user_id, portfolio_id) so each email is scoped to one portfolio
  const groups = new Map<
    string,
    {
      userId: string;
      portfolioId: string;
      portfolioName: string;
      alertIds: string[];
      entries: AlertDigestEntry[];
    }
  >();

  for (const row of rows) {
    if (!row.portfolios) continue;
    const key = `${row.portfolios.user_id}:${row.portfolio_id}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        userId: row.portfolios.user_id,
        portfolioId: row.portfolio_id,
        portfolioName: row.portfolios.name,
        alertIds: [],
        entries: [],
      };
      groups.set(key, group);
    }
    group.alertIds.push(row.id);
    // Mint a signed HMAC ack token per row. The GET handler at
    // /api/alerts/ack verifies the token, then renders a confirm page
    // whose POST flips acknowledged_at and stores the token hash in
    // used_ack_tokens (migration 047b) to enforce one-time-use.
    // If ALERT_ACK_SECRET is unset we fall back to a dashboard link so
    // the digest still ships — log and continue. The alerts will still
    // be reachable via the in-app banner / alerts list.
    let ackUrl: string | undefined;
    try {
      const token = signAlertAckToken(row.id);
      ackUrl = `${APP_URL}/api/alerts/ack?id=${encodeURIComponent(row.id)}&t=${encodeURIComponent(token)}`;
    } catch (err) {
      console.warn("[alert-digest] ALERT_ACK_SECRET missing — no ack link:", err);
    }
    group.entries.push({
      id: row.id,
      alert_type: row.alert_type,
      severity: row.severity,
      message: row.message,
      triggered_at: row.triggered_at,
      ack_url: ackUrl,
    });
  }

  // Resolve all unique user emails in parallel
  const uniqueUserIds = Array.from(new Set(Array.from(groups.values()).map((g) => g.userId)));
  const emailLookups = await Promise.all(
    uniqueUserIds.map(async (userId) => {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      if (error) {
        console.error("[alert-digest] Failed to fetch user", userId, error);
        return [userId, null] as const;
      }
      return [userId, data.user?.email ?? null] as const;
    }),
  );
  const emailMap = new Map(emailLookups);

  // Send all digests in parallel
  const sendResults = await Promise.allSettled(
    Array.from(groups.values()).map(async (group) => {
      const email = emailMap.get(group.userId);
      if (!email) return null;
      await sendAlertDigest(email, group.portfolioName, group.entries);
      return group;
    }),
  );

  const usersNotified = new Set<string>();
  let alertsSent = 0;
  const sentAlertIds: string[] = [];
  for (const result of sendResults) {
    if (result.status === "fulfilled" && result.value) {
      usersNotified.add(result.value.userId);
      alertsSent += result.value.entries.length;
      sentAlertIds.push(...result.value.alertIds);
    } else if (result.status === "rejected") {
      console.error("[alert-digest] Send failed:", result.reason);
    }
  }

  // Mark sent alerts as emailed
  if (sentAlertIds.length > 0) {
    // @audit-skip: cron-triggered batch-email tracking. `emailed_at` is an
    // internal dedup timestamp so the next cron run doesn't re-email the
    // same alert; the alert itself isn't changing state from the user's
    // perspective. The user-observable acks land via /api/alerts/ack or
    // /api/alerts/[id]/acknowledge, which both emit alert.acknowledge.
    const { error: updateError } = await admin
      .from("portfolio_alerts")
      .update({ emailed_at: new Date().toISOString() })
      .in("id", sentAlertIds);

    if (updateError) {
      // P445 — same rationale as the fetchError branch: don't leak
      // Postgres error.message. Sentry carries the diagnostic.
      console.error("[alert-digest] Failed to mark emailed:", updateError);
      void import("@sentry/nextjs")
        .then((Sentry) => {
          Sentry.captureException(updateError, {
            tags: { route: "/api/alert-digest", phase: "mark-emailed" },
          });
        })
        .catch(() => {});
      return NextResponse.json(
        { error: "Failed to send alert digest" },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    users_notified: usersNotified.size,
    alerts_sent: alertsSent,
  });
}

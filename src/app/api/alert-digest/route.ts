import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendAlertDigest, type AlertDigestEntry } from "@/lib/email";

interface PendingAlertRow {
  id: string;
  portfolio_id: string;
  alert_type: string;
  severity: "high" | "medium" | "low";
  message: string;
  triggered_at: string;
  portfolios: {
    id: string;
    name: string;
    user_id: string;
  } | null;
}

export async function POST(req: NextRequest) {
  // Verify cron secret
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Fetch all unacked + un-emailed alerts, joined with their portfolio
  const { data: pending, error: fetchError } = await admin
    .from("portfolio_alerts")
    .select(
      "id, portfolio_id, alert_type, severity, message, triggered_at, portfolios!inner(id, name, user_id)",
    )
    .is("acknowledged_at", null)
    .is("emailed_at", null)
    .order("triggered_at", { ascending: true });

  if (fetchError) {
    console.error("[alert-digest] Fetch failed:", fetchError);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const rows = (pending ?? []) as unknown as PendingAlertRow[];
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
    group.entries.push({
      alert_type: row.alert_type,
      severity: row.severity,
      message: row.message,
      triggered_at: row.triggered_at,
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
    const { error: updateError } = await admin
      .from("portfolio_alerts")
      .update({ emailed_at: new Date().toISOString() })
      .in("id", sentAlertIds);

    if (updateError) {
      console.error("[alert-digest] Failed to mark emailed:", updateError);
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    users_notified: usersNotified.size,
    alerts_sent: alertsSent,
  });
}

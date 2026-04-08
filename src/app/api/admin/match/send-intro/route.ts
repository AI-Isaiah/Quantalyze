import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import {
  notifyAllocatorOfAdminIntro,
  notifyManagerOfAdminIntro,
  type ManagerIdentityBlock,
} from "@/lib/email";

// POST /api/admin/match/send-intro
// Calls send_intro_with_decision(...) — a single Postgres transaction that upserts
// the contact_request AND the sent_as_intro match_decision. Handles the already-sent
// case gracefully (returns was_already_sent=true).
//
// After a successful first-time send, dispatches intro emails to both the allocator
// and the manager, CC'ing the founder. Email failure is non-fatal — the intro is
// persisted regardless so the admin can retry delivery out-of-band.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: {
    allocator_id?: string;
    strategy_id?: string;
    candidate_id?: string | null;
    admin_note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.allocator_id || typeof body.allocator_id !== "string") {
    return NextResponse.json({ error: "allocator_id is required" }, { status: 400 });
  }
  if (!body.strategy_id || typeof body.strategy_id !== "string") {
    return NextResponse.json({ error: "strategy_id is required" }, { status: 400 });
  }
  if (!body.admin_note || typeof body.admin_note !== "string") {
    return NextResponse.json({ error: "admin_note is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("send_intro_with_decision", {
    p_allocator_id: body.allocator_id,
    p_strategy_id: body.strategy_id,
    p_candidate_id: body.candidate_id ?? null,
    p_admin_note: body.admin_note,
    p_decided_by: user!.id,
  });

  if (error) {
    console.error("[api/admin/match/send-intro] RPC error:", error);
    return NextResponse.json(
      { error: "Failed to send intro" },
      { status: 500 },
    );
  }

  // RPC returns a TABLE (row set); Supabase exposes it as an array.
  const row = Array.isArray(data) && data.length > 0 ? data[0] : data;
  const wasAlreadySent = row?.was_already_sent ?? false;

  // Dispatch emails only on first-time sends. Fire-and-forget: email failure
  // must never fail the API call since the intro is already persisted in the DB.
  if (!wasAlreadySent) {
    const allocatorId = body.allocator_id;
    const strategyId = body.strategy_id;
    const founderNote = body.admin_note;

    void dispatchAdminIntroEmails({
      admin,
      allocatorId,
      strategyId,
      founderNote,
    });
  }

  return NextResponse.json({
    contact_request_id: row?.contact_request_id,
    match_decision_id: row?.match_decision_id,
    was_already_sent: wasAlreadySent,
  });
}

/** Lightweight email format guard — defense in depth before we hand off to Resend. */
function isLikelyEmail(value: string | null | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  // RFC 5322 is too permissive for our needs; this matches local@host.tld with
  // no whitespace and at least one dot in the host part. Resend will reject
  // anything that slips through this with a 4xx — but at least we don't
  // dispatch a request for `'   '` or `'no-at-sign'`.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

async function dispatchAdminIntroEmails(params: {
  admin: ReturnType<typeof createAdminClient>;
  allocatorId: string;
  strategyId: string;
  founderNote: string;
}) {
  const { admin, allocatorId, strategyId, founderNote } = params;

  try {
    // Fetch allocator + strategy + manager profile in parallel.
    // Manager identity columns (bio/years_trading/aum_range, plus the
    // pre-existing `linkedin` column reused from migration 001) are
    // introduced in migration 012. If 012 has not been applied, the
    // manager-profile select below will fail and the outer try/catch swallows
    // the error — the intro is still persisted, just without email delivery.
    const [allocatorResult, strategyResult] = await Promise.all([
      admin
        .from("profiles")
        .select("email, display_name, company")
        .eq("id", allocatorId)
        .single(),
      admin
        .from("strategies")
        .select("id, name, user_id")
        .eq("id", strategyId)
        .single(),
    ]);

    const allocator = allocatorResult.data;
    const strategy = strategyResult.data;

    if (!isLikelyEmail(allocator?.email) || !strategy) {
      console.warn(
        "[api/admin/match/send-intro] Skipping email dispatch — missing or malformed allocator email, or strategy not found",
        { allocatorId, strategyId, hasStrategy: Boolean(strategy) },
      );
      return;
    }

    // Manager profile — may be null if strategy.user_id is unset.
    let manager: ManagerIdentityBlock | null = null;
    let managerEmail: string | null = null;
    if (strategy.user_id) {
      const { data: managerProfile } = await admin
        .from("profiles")
        .select(
          "email, display_name, company, bio, years_trading, aum_range, linkedin",
        )
        .eq("id", strategy.user_id)
        .single();

      if (managerProfile) {
        managerEmail = isLikelyEmail(managerProfile.email)
          ? managerProfile.email
          : null;
        const managerName =
          managerProfile.display_name ??
          managerProfile.company ??
          "the manager";
        manager = {
          name: managerName,
          bio: (managerProfile as { bio?: string | null }).bio ?? null,
          yearsTrading:
            (managerProfile as { years_trading?: number | null }).years_trading ?? null,
          aumRange:
            (managerProfile as { aum_range?: string | null }).aum_range ?? null,
          linkedinUrl:
            (managerProfile as { linkedin?: string | null }).linkedin ?? null,
        };
      }
    }

    const allocatorName =
      allocator!.display_name ?? allocator!.company ?? "the allocator";

    // Promise.allSettled — one failed send must NOT prevent the other from
    // running. The current observability story is "console.error inside
    // send()", which is a known gap (P1 follow-up: persisted dispatch audit
    // table). For now, log each result so the founder can grep for partial
    // failures in production logs.
    const results = await Promise.allSettled([
      notifyAllocatorOfAdminIntro(
        allocator!.email!,
        manager ?? { name: "the manager" },
        strategy.name,
        strategy.id,
        founderNote,
      ),
      managerEmail
        ? notifyManagerOfAdminIntro(
            managerEmail,
            allocatorName,
            strategy.name,
            founderNote,
          )
        : Promise.resolve(),
    ]);

    const labels = ["allocator", "manager"] as const;
    results.forEach((result, idx) => {
      if (result.status === "rejected") {
        console.error(
          `[api/admin/match/send-intro] ${labels[idx]} email rejected:`,
          result.reason,
        );
      }
    });
  } catch (err) {
    console.error("[api/admin/match/send-intro] Email dispatch failed:", err);
  }
}

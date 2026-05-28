import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { adminActionLimiter, checkLimit, rateLimitDenyJson } from "@/lib/ratelimit";
import { logAuditEventAsUser } from "@/lib/audit";

// GET — returns { enabled: boolean }
// POST — body { enabled: boolean }, flips the flag. Admin only.
export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // P444 (audit-2026-05-07) — RFC 7235: 401 unauthenticated, 403 forbidden.
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("system_flags")
    .select("enabled, updated_at, updated_by")
    .eq("key", "match_engine_enabled")
    .maybeSingle();

  // Surface infrastructure errors instead of silently defaulting to enabled=true.
  // If system_flags doesn't exist (migration 011 not applied) the founder needs to
  // know that the engine isn't actually deployed — not see a misleading green pill.
  //
  // PR-2 code-reviewer I3 (2026-05-28): generic 503 message + Retry-After.
  // Internal migration-name hint stays in server logs only — no infra detail
  // surfaces to the admin client.
  if (error) {
    console.error(
      "[api/admin/match/kill-switch] read error (system_flags likely missing — apply migration 011):",
      error,
    );
    return NextResponse.json(
      { error: "Match engine unavailable" },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }

  // PR-2 silent-failure-hunter F1 (2026-05-28): pre-fix, a missing row
  // (data === null, error === null) fell through to `enabled ?? true` and
  // surfaced a misleading green pill — operators would assume the engine
  // was actively running when the canonical row had been deleted/never-
  // seeded. Surface that as 503 too, distinct from a Postgres error.
  if (!data) {
    console.error(
      "[api/admin/match/kill-switch] system_flags row missing for key=match_engine_enabled — seed required",
    );
    return NextResponse.json(
      { error: "Match engine unavailable" },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }

  return NextResponse.json({
    enabled: data.enabled,
    updated_at: data.updated_at,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // P444 (audit-2026-05-07) — RFC 7235: 401 unauthenticated, 403 forbidden.
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // audit-2026-05-07 (PR-2 2026-05-28): kill-switch is the most-sensitive
  // admin mutator (flips the global match engine on/off). A buggy admin
  // client flipping in a loop would write N audit rows AND fan out N
  // downstream re-recommend triggers; per-admin rate-limit caps that
  // blast radius at the source.
  const rl = await checkLimit(
    adminActionLimiter,
    `admin-killswitch:${user.id}`,
  );
  if (!rl.success) return rateLimitDenyJson(rl);

  let body: { enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled (boolean) required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("system_flags")
    .update({
      enabled: body.enabled,
      updated_at: new Date().toISOString(),
      updated_by: user!.id,
    })
    .eq("key", "match_engine_enabled");

  if (error) {
    console.error("[api/admin/match/kill-switch] error:", error);
    return NextResponse.json({ error: "Failed to update flag" }, { status: 500 });
  }

  // Sprint 6 Task 7.1b — audit the kill switch flip. entity_id anchors
  // to the acting admin's id because system_flags rows are keyed by
  // `key` (text) — there's no UUID to point at. The acting admin IS
  // the forensic anchor ("admin X flipped the match engine on/off at
  // time Y"). Metadata carries the semantic payload.
  //
  // NEW-C10-01 (audit-2026-05-26 security): switched to logAuditEventAsUser
  // (service-role, JWT-immune) so the kill-switch audit row cannot be lost
  // to an admin JWT expiring in the after() window.
  logAuditEventAsUser(admin, user!.id, {
    action: "admin.kill_switch",
    entity_type: "system_flag",
    entity_id: user!.id,
    metadata: { flag: "match_engine_enabled", new_value: body.enabled },
  });

  return NextResponse.json({ success: true, enabled: body.enabled });
}

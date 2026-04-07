import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";

// GET /api/admin/match/allocators
//
// Returns the allocator list for the /admin/match index page, with triage-sort
// metadata (days since last intro, new candidates since last visit, etc).
//
// Triage sort: "needs attention" first = (new candidates since last visit) OR
// (no intro sent in 14 days). Then stale-batch, then zero decisions, then recency.
export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Load all allocators (role IN ('allocator', 'both'))
  // The profiles table is from migration 001 — if THIS query fails, surface the error.
  const { data: profiles, error: profilesErr } = await admin
    .from("profiles")
    .select("id, display_name, company, email, role, preferences_updated_at")
    .in("role", ["allocator", "both"]);

  if (profilesErr) {
    console.error("[api/admin/match/allocators] profiles error:", profilesErr);
    // 'preferences_updated_at' is added by migration 011. If it's missing, the
    // founder hasn't applied the migration yet — surface that explicitly.
    const isSchemaError =
      profilesErr.code === "PGRST205" ||
      profilesErr.message?.includes("preferences_updated_at") ||
      profilesErr.message?.includes("schema cache");
    return NextResponse.json(
      {
        error: isSchemaError
          ? "Match engine schema not found. Apply migration 011 to your Supabase project."
          : "Failed to load allocators",
      },
      { status: isSchemaError ? 503 : 500 },
    );
  }

  const allocators = profiles ?? [];
  const allocatorIds = allocators.map((a) => a.id);

  if (allocatorIds.length === 0) {
    return NextResponse.json({ allocators: [] });
  }

  // Latest batch per allocator
  const { data: batchRows, error: batchErr } = await admin
    .from("match_batches")
    .select(
      "id, allocator_id, computed_at, mode, candidate_count, filter_relaxed",
    )
    .in("allocator_id", allocatorIds)
    .order("computed_at", { ascending: false });

  if (batchErr) {
    console.error("[api/admin/match/allocators] match_batches error:", batchErr);
    const isSchemaError = batchErr.code === "PGRST205";
    return NextResponse.json(
      {
        error: isSchemaError
          ? "Match engine schema not found. Apply migration 011 to your Supabase project."
          : "Failed to load match data",
      },
      { status: isSchemaError ? 503 : 500 },
    );
  }

  const latestBatchByAllocator = new Map<string, {
    id: string;
    computed_at: string;
    mode: string;
    candidate_count: number;
    filter_relaxed: boolean;
  }>();
  for (const row of batchRows ?? []) {
    if (!latestBatchByAllocator.has(row.allocator_id)) {
      latestBatchByAllocator.set(row.allocator_id, {
        id: row.id,
        computed_at: row.computed_at,
        mode: row.mode,
        candidate_count: row.candidate_count,
        filter_relaxed: row.filter_relaxed,
      });
    }
  }

  // Preferences (mandate archetype specifically)
  const { data: prefRows } = await admin
    .from("allocator_preferences")
    .select("user_id, mandate_archetype, founder_notes")
    .in("user_id", allocatorIds);
  const prefsByAllocator = new Map<string, { mandate_archetype: string | null; founder_notes: string | null }>();
  for (const row of prefRows ?? []) {
    prefsByAllocator.set(row.user_id, {
      mandate_archetype: row.mandate_archetype,
      founder_notes: row.founder_notes,
    });
  }

  // Latest sent_as_intro per allocator (to compute days-since-last-intro)
  const { data: introRows } = await admin
    .from("match_decisions")
    .select("allocator_id, created_at")
    .eq("decision", "sent_as_intro")
    .in("allocator_id", allocatorIds)
    .order("created_at", { ascending: false });
  const lastIntroByAllocator = new Map<string, string>();
  for (const row of introRows ?? []) {
    if (!lastIntroByAllocator.has(row.allocator_id)) {
      lastIntroByAllocator.set(row.allocator_id, row.created_at);
    }
  }

  // Assemble + score
  const now = Date.now();
  const enriched = allocators.map((a) => {
    const batch = latestBatchByAllocator.get(a.id);
    const prefs = prefsByAllocator.get(a.id);
    const lastIntro = lastIntroByAllocator.get(a.id);

    let daysSinceLastIntro: number | null = null;
    if (lastIntro) {
      daysSinceLastIntro = Math.floor((now - Date.parse(lastIntro)) / 86_400_000);
    }

    let hoursSinceRecompute: number | null = null;
    if (batch?.computed_at) {
      hoursSinceRecompute = Math.floor((now - Date.parse(batch.computed_at)) / 3_600_000);
    }

    const needsAttention =
      batch !== undefined && batch.candidate_count > 0 &&
      (daysSinceLastIntro === null || daysSinceLastIntro > 14);
    const isStale = hoursSinceRecompute !== null && hoursSinceRecompute > 48;
    const zeroDecisions = daysSinceLastIntro === null;

    // Triage score: higher = more urgent
    let triageScore = 0;
    if (needsAttention) triageScore += 100;
    if (isStale) triageScore += 50;
    if (zeroDecisions) triageScore += 25;
    if (batch?.filter_relaxed) triageScore += 30;

    return {
      id: a.id,
      display_name: a.display_name,
      company: a.company,
      email: a.email,
      role: a.role,
      mandate_archetype: prefs?.mandate_archetype ?? null,
      has_founder_notes: Boolean(prefs?.founder_notes),
      latest_batch: batch ?? null,
      hours_since_recompute: hoursSinceRecompute,
      days_since_last_intro: daysSinceLastIntro,
      needs_attention: needsAttention,
      is_stale: isStale,
      zero_decisions: zeroDecisions,
      triage_score: triageScore,
    };
  });

  // Sort by triage score desc, then by recency
  enriched.sort((a, b) => {
    if (b.triage_score !== a.triage_score) return b.triage_score - a.triage_score;
    const aRecent = a.latest_batch?.computed_at ?? "";
    const bRecent = b.latest_batch?.computed_at ?? "";
    return bRecent.localeCompare(aRecent);
  });

  return NextResponse.json({ allocators: enriched });
}

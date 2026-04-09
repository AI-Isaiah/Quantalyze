import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { isValidPartnerTag } from "@/lib/partner";
import { ensureAuthUser } from "@/lib/supabase/admin-users";
import type { DisclosureTier } from "@/lib/types";

// POST /api/admin/partner-import
//
// T-1.3 from the cap-intro demo sprint. Spins up a white-label pilot from 2
// pasted CSVs — managers (3+ strategies) and allocators (3+ LPs). This is a
// sketch for the first partner meeting, not a fully-baked tenant model:
//   * No quoted-field CSV parser, just line.split(",").
//   * Upserts everything idempotently so the founder can re-run during a demo.
//   * On `user_already_exists` we MUST fall through to a profiles-by-email
//     lookup and continue — silently skipping a row would kill the demo by
//     under-counting the imported pilot. This is handled in the shared
//     `ensureAuthUser` helper.
//
// Auth: admin only. partner_tag validated via the shared isValidPartnerTag
// helper against the canonical PARTNER_TAG_RE.

interface ManagerRow {
  manager_email: string;
  strategy_name: string;
  disclosure_tier: DisclosureTier;
}

interface AllocatorRow {
  allocator_email: string;
  mandate_archetype: string;
  ticket_size_usd: number;
}

function parseCsvLines(raw: string): string[][] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(",").map((cell) => cell.trim()));
}

function parseManagersCsv(raw: string): ManagerRow[] {
  const rows = parseCsvLines(raw);
  if (rows.length === 0) return [];
  // Skip header row if present.
  const dataRows = rows[0][0]?.toLowerCase() === "manager_email" ? rows.slice(1) : rows;
  const out: ManagerRow[] = [];
  for (const cells of dataRows) {
    const [manager_email, strategy_name, disclosure_tierRaw] = cells;
    if (!manager_email || !strategy_name) continue;
    const tier = (disclosure_tierRaw || "exploratory").toLowerCase();
    const disclosure_tier: DisclosureTier =
      tier === "institutional" ? "institutional" : "exploratory";
    out.push({ manager_email, strategy_name, disclosure_tier });
  }
  return out;
}

function parseAllocatorsCsv(raw: string): AllocatorRow[] {
  const rows = parseCsvLines(raw);
  if (rows.length === 0) return [];
  const dataRows = rows[0][0]?.toLowerCase() === "allocator_email" ? rows.slice(1) : rows;
  const out: AllocatorRow[] = [];
  for (const cells of dataRows) {
    const [allocator_email, mandate_archetype, ticket_raw] = cells;
    if (!allocator_email || !mandate_archetype) continue;
    const ticket_size_usd = Number.parseFloat((ticket_raw || "0").replace(/[,_$]/g, ""));
    out.push({
      allocator_email,
      mandate_archetype,
      ticket_size_usd: Number.isFinite(ticket_size_usd) ? ticket_size_usd : 0,
    });
  }
  return out;
}

function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: {
    partner_tag?: unknown;
    managers_csv?: unknown;
    allocators_csv?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const partner_tag = typeof body.partner_tag === "string" ? body.partner_tag : "";
  const managersCsv = typeof body.managers_csv === "string" ? body.managers_csv : "";
  const allocatorsCsv = typeof body.allocators_csv === "string" ? body.allocators_csv : "";

  if (!isValidPartnerTag(partner_tag)) {
    return NextResponse.json(
      { error: "partner_tag must match ^[a-z0-9-]+$" },
      { status: 400 },
    );
  }

  const managers = parseManagersCsv(managersCsv);
  const allocators = parseAllocatorsCsv(allocatorsCsv);

  if (managers.length === 0 && allocators.length === 0) {
    return NextResponse.json(
      { error: "Both CSVs are empty — nothing to import" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  let managers_created = 0;
  let strategies_created = 0;
  let allocators_created = 0;

  try {
    for (const row of managers) {
      const userId = await ensureAuthUser(admin, { email: row.manager_email });

      const { error: profileErr } = await admin.from("profiles").upsert(
        {
          id: userId,
          email: row.manager_email,
          display_name: displayNameFromEmail(row.manager_email),
          role: "manager",
          partner_tag,
        },
        { onConflict: "id" },
      );
      if (profileErr) throw profileErr;
      managers_created += 1;

      const { error: strategyErr } = await admin.from("strategies").insert({
        user_id: userId,
        name: row.strategy_name,
        status: "draft",
        is_example: false,
        disclosure_tier: row.disclosure_tier,
        partner_tag,
      });
      if (strategyErr) throw strategyErr;
      strategies_created += 1;
    }

    for (const row of allocators) {
      const userId = await ensureAuthUser(admin, { email: row.allocator_email });

      const { error: profileErr } = await admin.from("profiles").upsert(
        {
          id: userId,
          email: row.allocator_email,
          display_name: displayNameFromEmail(row.allocator_email),
          role: "allocator",
          allocator_status: "verified",
          partner_tag,
        },
        { onConflict: "id" },
      );
      if (profileErr) throw profileErr;
      allocators_created += 1;

      const { error: prefErr } = await admin
        .from("allocator_preferences")
        .upsert(
          {
            user_id: userId,
            mandate_archetype: row.mandate_archetype,
            target_ticket_size_usd: row.ticket_size_usd,
          },
          { onConflict: "user_id" },
        );
      if (prefErr) throw prefErr;
    }
  } catch (err) {
    console.error("[api/admin/partner-import] failed:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Import failed",
        managers_created,
        strategies_created,
        allocators_created,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    managers_created,
    strategies_created,
    allocators_created,
  });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { isValidPartnerTag } from "@/lib/partner";
import { parseCsvWithSchema } from "@/lib/csv";
import { ensureAuthUser } from "@/lib/supabase/admin-users";
import type { DisclosureTier } from "@/lib/types";

// POST /api/admin/partner-import
//
// T-1.3 from the cap-intro demo sprint. Spins up a white-label pilot from 2
// pasted CSVs — managers (3+ strategies) and allocators (3+ LPs). This is a
// sketch for the first partner meeting, not a fully-baked tenant model:
//   * Uses the shared quote-aware CSV parser from `@/lib/csv` so pasted
//     fields with embedded commas / quotes don't blow up the import.
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

function parseManagerRows(raw: string): ManagerRow[] {
  return parseCsvWithSchema(
    raw,
    ["manager_email", "strategy_name", "disclosure_tier"],
    (row) => {
      if (!row.manager_email || !row.strategy_name) return null;
      const tier = row.disclosure_tier.toLowerCase();
      const disclosure_tier: DisclosureTier =
        tier === "institutional" ? "institutional" : "exploratory";
      return {
        manager_email: row.manager_email,
        strategy_name: row.strategy_name,
        disclosure_tier,
      };
    },
  );
}

function parseAllocatorRows(raw: string): AllocatorRow[] {
  return parseCsvWithSchema(
    raw,
    ["allocator_email", "mandate_archetype", "ticket_size_usd"],
    (row) => {
      if (!row.allocator_email || !row.mandate_archetype) return null;
      const ticket_size_usd = Number.parseFloat(
        (row.ticket_size_usd || "0").replace(/[,_$]/g, ""),
      );
      return {
        allocator_email: row.allocator_email,
        mandate_archetype: row.mandate_archetype,
        ticket_size_usd: Number.isFinite(ticket_size_usd) ? ticket_size_usd : 0,
      };
    },
  );
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

  let managers: ManagerRow[];
  let allocators: AllocatorRow[];
  try {
    managers = parseManagerRows(managersCsv);
    allocators = parseAllocatorRows(allocatorsCsv);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid CSV" },
      { status: 400 },
    );
  }

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

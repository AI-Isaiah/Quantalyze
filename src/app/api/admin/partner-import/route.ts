import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { isValidPartnerTag } from "@/lib/partner";
import { parseCsvWithSchema } from "@/lib/csv";
import { ensureAuthUser } from "@/lib/supabase/admin-users";
import { adminActionLimiter, checkLimit } from "@/lib/ratelimit";
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

/**
 * Zero-dep concurrency limiter. Spawns `concurrency` workers that pull
 * indices from a shared counter and run `fn(items[idx])` until exhausted.
 * Preserves input order in the returned results. Used by the partner
 * importer because Supabase GoTrue `admin.createUser` is rate-limited,
 * so we can't just `Promise.all(items.map(fn))` — unbounded concurrency
 * trips the auth service. A small cap (5) gets ~5× speedup in practice
 * without hitting the rate limit.
 *
 * Fail-stop semantics: when any worker throws, the shared `aborted` flag
 * is set so the other workers skip their remaining items. Already-started
 * work still has to complete (there is no generic way to cancel an
 * in-flight fetch), but no NEW rows are picked up after the first failure.
 * This is the closest analogue to the old sequential loop's "stop on
 * first error" behaviour.
 */
async function mapConcurrent<T, U>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<U>,
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let nextIdx = 0;
  let aborted = false;
  let firstError: unknown;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (!aborted) {
        const idx = nextIdx++;
        if (idx >= items.length) return;
        try {
          results[idx] = await fn(items[idx], idx);
        } catch (err) {
          if (!aborted) {
            aborted = true;
            firstError = err;
          }
          return;
        }
      }
    },
  );
  await Promise.all(workers);
  if (aborted) throw firstError;
  return results;
}

/**
 * Deduplicate rows by a key-producing function. Last write wins (the later
 * row in the CSV replaces the earlier one). Used before `mapConcurrent` to
 * prevent the `ensureAuthUser` race where two workers for the same email
 * both hit the createUser path — the first wins, the second falls into
 * the "exists in auth but has no profile row" branch because the first
 * worker hasn't upserted the profile yet.
 */
function dedupeBy<T>(rows: T[], keyFn: (row: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    byKey.set(keyFn(row), row);
  }
  return Array.from(byKey.values());
}

export async function POST(request: Request): Promise<NextResponse> {
  const csrfError = assertSameOrigin(request as NextRequest);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const rl = await checkLimit(adminActionLimiter, `partner-import:${user!.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
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

  // The managers CSV intentionally allows one `manager_email` to appear on
  // multiple rows — that's how a manager with 3 strategies is represented.
  // Dedupe ONLY for the auth-user + profile upsert step (one write per
  // email) so parallel workers can't race on `ensureAuthUser`, then insert
  // every strategy row against the pre-resolved user id map.
  //
  // Allocators are naturally one-row-per-email (each allocator has a
  // single preferences row), but we dedupe defensively in case a
  // malformed CSV repeats an allocator — last-write-wins on preferences.
  const uniqueManagerEmails = dedupeBy(managers, (r) => r.manager_email);
  const dedupedAllocators = dedupeBy(allocators, (r) => r.allocator_email);

  // Concurrency cap for the per-row Supabase fan-out. Set to 5 because
  // Supabase GoTrue `admin.createUser` is the bottleneck and it rate-limits
  // at ~low single-digit concurrent calls. Each row also does 1-2 follow-up
  // DB writes; at N=20 rows this takes the total from ~20 sequential RTTs
  // down to ~4 batches of 5 concurrent RTTs.
  const IMPORT_CONCURRENCY = 5;

  try {
    // Phase 1: one auth user + profile per distinct manager email.
    const managerIdByEmail = new Map<string, string>();
    await mapConcurrent(uniqueManagerEmails, IMPORT_CONCURRENCY, async (row) => {
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
      managerIdByEmail.set(row.manager_email, userId);
      managers_created += 1;
    });

    // Phase 2: insert EVERY strategy row, including multi-strategy managers.
    // Uses the pre-resolved user id map so there's no auth race.
    await mapConcurrent(managers, IMPORT_CONCURRENCY, async (row) => {
      const userId = managerIdByEmail.get(row.manager_email);
      if (!userId) {
        throw new Error(
          `partner-import: missing user id for manager ${row.manager_email} (phase 1 should have resolved it)`,
        );
      }
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
    });

    await mapConcurrent(dedupedAllocators, IMPORT_CONCURRENCY, async (row) => {
      const userId = await ensureAuthUser(admin, {
        email: row.allocator_email,
      });

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
    });
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

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin } from "@/lib/csrf";
import {
  notifyManagerIntroRequest,
  notifyFounderIntroRequest,
  notifyAllocatorOfIntroRequest,
} from "@/lib/email";
import { loadManagerIdentity } from "@/lib/manager-identity";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import type { DisclosureTier, ManagerIdentity } from "@/lib/types";
import {
  computePortfolioSnapshot,
  type PortfolioSnapshotJSON,
} from "@/lib/intro/snapshot";
import { trackUsageEventServer } from "@/lib/analytics/usage-events";

/**
 * Synchronous snapshot budget: if computePortfolioSnapshot finishes in
 * under this, we insert the row with snapshot_status='ready'. Otherwise
 * we insert with snapshot_status='pending' and enqueue a
 * compute_intro_snapshot worker job to finish the computation. 2s is
 * chosen to stay comfortably under the default Vercel function timeout
 * while still catching the common case (small portfolio, warm cache).
 */
const SNAPSHOT_BUDGET_MS = 2000;

const MANDATE_CONTEXT_SCHEMA = z
  .object({
    freeform: z.string().max(2000).optional(),
    preferred_asset_class: z.string().max(100).optional(),
    preferred_exchange: z.array(z.string()).max(10).optional(),
    aum_range: z.string().max(50).optional(),
  })
  .nullish();

const INTRO_SCHEMA = z.object({
  strategy_id: z.string().uuid(),
  message: z.string().max(2000).nullish(),
  source: z.enum(["direct", "bridge"]).optional().default("direct"),
  replacement_for: z.string().uuid().nullish(),
  mandate_context: MANDATE_CONTEXT_SCHEMA,
});

type SnapshotRaceResult =
  | { kind: "ready"; snapshot: PortfolioSnapshotJSON }
  | { kind: "pending" }
  | { kind: "failed" };

async function raceSnapshot(userId: string): Promise<SnapshotRaceResult> {
  const timeoutMarker = Symbol("timeout");
  const timeoutPromise = new Promise<typeof timeoutMarker>((resolve) => {
    setTimeout(() => resolve(timeoutMarker), SNAPSHOT_BUDGET_MS);
  });

  try {
    const result = await Promise.race([
      computePortfolioSnapshot(userId),
      timeoutPromise,
    ]);
    if (result === timeoutMarker) {
      // Compute still running — it will be abandoned by the Vercel
      // runtime shortly. A compute_intro_snapshot job handles the async
      // path.
      return { kind: "pending" };
    }
    return { kind: "ready", snapshot: result };
  } catch (err) {
    console.warn("[api/intro] snapshot compute failed synchronously:", err);
    return { kind: "failed" };
  }
}

export async function POST(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkLimit(userActionLimiter, `intro:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // Defense-in-depth: verify the user has an allocator role before allowing
  // intro requests. RLS on contact_requests is the DB-layer gate, but a broken
  // policy would silently let any authenticated user insert rows.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "allocator" && profile.role !== "both")) {
    return NextResponse.json(
      { error: "Only allocators can request introductions" },
      { status: 403 },
    );
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = INTRO_SCHEMA.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const {
    strategy_id,
    message,
    source,
    replacement_for,
    mandate_context,
  } = parsed.data;

  // Compute the allocator-portfolio snapshot under a 2s budget. The
  // snapshot itself is computed against user.id on the server — the
  // allocator can't inject another user's data, regardless of body shape.
  const snapshotResult = await raceSnapshot(user.id);

  // Map the race outcome to the row columns. On 'pending' we insert NULL
  // snapshot + status='pending' and follow up with an enqueue.
  const snapshotInsert: {
    portfolio_snapshot: PortfolioSnapshotJSON | null;
    snapshot_status: "pending" | "ready" | "failed";
  } =
    snapshotResult.kind === "ready"
      ? { portfolio_snapshot: snapshotResult.snapshot, snapshot_status: "ready" }
      : snapshotResult.kind === "failed"
        ? { portfolio_snapshot: null, snapshot_status: "failed" }
        : { portfolio_snapshot: null, snapshot_status: "pending" };

  const { data: inserted, error } = await supabase
    .from("contact_requests")
    .insert({
      allocator_id: user.id,
      strategy_id,
      message: message ?? null,
      source,
      replacement_for: replacement_for ?? null,
      mandate_context: mandate_context ?? null,
      portfolio_snapshot: snapshotInsert.portfolio_snapshot,
      snapshot_status: snapshotInsert.snapshot_status,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Already requested" }, { status: 409 });
    }
    return NextResponse.json(
      { error: "Failed to create request" },
      { status: 500 },
    );
  }

  // Fire-and-forget usage funnel event. PostHog flushAt:1 keeps this
  // non-blocking — we don't await so the response isn't gated on the
  // PostHog round-trip.
  void trackUsageEventServer("intro_submitted", user.id, {
    source,
    strategy_id,
  });

  // If snapshot compute didn't finish in time, enqueue the async worker.
  // Use the admin client — enqueue_compute_job is SECURITY DEFINER and
  // service-role bypasses the auth check. We want this to be awaited so
  // a dropped promise doesn't leave snapshot_status stuck at 'pending'.
  if (snapshotResult.kind === "pending" && inserted?.id) {
    try {
      const admin = createAdminClient();
      const { error: enqueueError } = await admin.rpc("enqueue_compute_job", {
        p_strategy_id: strategy_id,
        p_kind: "compute_intro_snapshot",
        p_metadata: { contact_request_id: inserted.id },
      });
      if (enqueueError) {
        // The DB row is already inserted with snapshot_status='pending'.
        // Log the enqueue failure; a later manual requeue is possible
        // from the admin UI. We don't fail the request — the intro
        // itself succeeded, the snapshot is a nice-to-have.
        console.error(
          "[api/intro] failed to enqueue compute_intro_snapshot:",
          enqueueError,
        );
      }
    } catch (err) {
      console.error(
        "[api/intro] compute_intro_snapshot enqueue threw:",
        err,
      );
    }
  }

  const userEmail = user.email;
  const userId = user.id;
  Promise.resolve().then(async () => {
    try {
      const admin = createAdminClient();
      const [{ data: strategy }, { data: allocatorProfile }] = await Promise.all([
        admin
          .from("strategies")
          .select("id, name, user_id, disclosure_tier")
          .eq("id", strategy_id)
          .single(),
        admin.from("profiles").select("display_name, company").eq("id", userId).single(),
      ]);

      if (!strategy) return;

      const allocatorName =
        allocatorProfile?.display_name ??
        allocatorProfile?.company ??
        userEmail ??
        "An allocator";

      const disclosureTier: DisclosureTier =
        (strategy as { disclosure_tier?: DisclosureTier }).disclosure_tier ??
        "exploratory";

      // Manager identity block is only assembled for institutional-tier strategies.
      // Exploratory-tier allocator emails get a redacted "disclosed on acceptance" copy.
      let managerBlock: ManagerIdentity | null = null;
      if (strategy.user_id) {
        // Fetch email separately so the identity helper doesn't need to
        // widen its SELECT column list — email isn't part of ManagerIdentity.
        const { data: managerEmailRow } = await admin
          .from("profiles")
          .select("email")
          .eq("id", strategy.user_id)
          .single();

        if (managerEmailRow?.email) {
          notifyManagerIntroRequest(managerEmailRow.email, allocatorName, strategy.name);
        }

        if (disclosureTier === "institutional") {
          managerBlock = await loadManagerIdentity(admin, strategy.user_id);
        }
      }

      if (userEmail) {
        notifyAllocatorOfIntroRequest(
          userEmail,
          strategy.name,
          strategy.id,
          managerBlock,
        );
      }

      notifyFounderIntroRequest(allocatorName, strategy.name);
    } catch { /* email failure is non-fatal */ }
  });

  return NextResponse.json({ success: true });
}

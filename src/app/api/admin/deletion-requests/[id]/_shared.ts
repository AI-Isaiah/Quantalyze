import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared preamble for /api/admin/deletion-requests/[id]/approve +
 * .../reject. Sprint 6 closeout /simplify T3-S1.
 *
 * Both routes run the same 7-check sequence before the verb-specific
 * mutation + audit emission:
 *   1. Missing requestId from path → 400.
 *   2. admin.from("data_deletion_requests").select(...).eq(id).maybeSingle() — 500 on error.
 *   3. No row → 404.
 *   4. Self-action (target user_id === acting admin id) → 403.
 *   5. Already completed → 409 with a verb-specific message.
 *   6. Already rejected → 409 with a verb-specific message.
 *   7. (Caller does the verb-specific work on the returned `row`.)
 *
 * The self-action guard MUST fire BEFORE the terminal-state guards —
 * this is asserted by `deletion-request-admin-self.test.ts` ("self-guard
 * fires BEFORE the terminal-state guards"). Keep that ordering intact
 * inside this helper.
 */

export type DeletionRow = {
  id: string;
  user_id: string;
  requested_at: string;
  completed_at: string | null;
  rejected_at: string | null;
};

export type DeletionActionResult =
  | { ok: true; row: DeletionRow }
  | { ok: false; res: NextResponse };

export async function loadDeletionRequestForAction(
  admin: SupabaseClient,
  requestId: string | undefined,
  actingUserId: string,
  verb: "approve" | "reject",
): Promise<DeletionActionResult> {
  if (!requestId) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Missing deletion-request id in path" },
        { status: 400 },
      ),
    };
  }

  const { data: reqRow, error: readErr } = await admin
    .from("data_deletion_requests")
    .select("id, user_id, requested_at, completed_at, rejected_at")
    .eq("id", requestId)
    .maybeSingle();

  if (readErr) {
    console.error(
      `[admin/deletion-requests/${verb}] load failed:`,
      readErr,
    );
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Failed to load deletion request" },
        { status: 500 },
      ),
    };
  }

  if (!reqRow) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Deletion request not found" },
        { status: 404 },
      ),
    };
  }

  // Self-action guard MUST fire before terminal-state guards so a
  // leaked completed-row for the admin doesn't let them probe.
  if (reqRow.user_id === actingUserId) {
    return {
      ok: false,
      res: NextResponse.json(
        {
          error: `Admins cannot ${verb} their own deletion request — another admin must act.`,
        },
        { status: 403 },
      ),
    };
  }

  if (reqRow.completed_at) {
    return {
      ok: false,
      res: NextResponse.json(
        {
          error:
            verb === "approve"
              ? "Deletion request is already completed"
              : "Deletion request is already completed — cannot reject",
        },
        { status: 409 },
      ),
    };
  }

  if (reqRow.rejected_at) {
    return {
      ok: false,
      res: NextResponse.json(
        {
          error:
            verb === "approve"
              ? "Deletion request was rejected — cannot approve"
              : "Deletion request is already rejected",
        },
        { status: 409 },
      ),
    };
  }

  return { ok: true, row: reqRow as DeletionRow };
}

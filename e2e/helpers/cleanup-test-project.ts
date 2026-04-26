/**
 * Phase 11 / Plan 11-07 / D-15 — Teardown for the onboarding-funnel E2E.
 *
 * Cascades user deletion via auth.admin.deleteUser, which removes the
 * profile + every owned row (api_keys / strategies / allocator_holdings /
 * match_decisions / bridge_outcomes / allocator_preferences) via the
 * `ON DELETE CASCADE` chain declared at migration 001 + descendants.
 *
 * Best-effort by design: a teardown failure must NOT fail the spec —
 * the seed-side timestamp on the user email makes stale-data
 * identification trivial if a cleanup ever skips. Failures are logged
 * loudly so persistent leaks surface in CI logs.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function getAdmin(): SupabaseClient {
  const url = process.env.TEST_SUPABASE_URL;
  const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "[cleanup-test-project] TEST_SUPABASE_URL or TEST_SUPABASE_SERVICE_ROLE_KEY missing",
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Delete the seeded allocator. Cascades remove every owned row through
 * the FK chain (profiles.id → strategies / api_keys / allocator_holdings
 * / match_decisions / bridge_outcomes / allocator_preferences).
 */
export async function cleanupTestAllocator(userId: string): Promise<void> {
  const admin = getAdmin();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.warn(
      `[cleanup-test-project] deleteUser(${userId}) failed: ${error.message}`,
    );
  }
}

/**
 * Delete the seeded Bridge candidate strategy AND its owner user. The
 * `ON DELETE CASCADE` from strategies → profiles via user_id removes the
 * strategy when the owner is deleted, so a single deleteUser is enough.
 *
 * Accepts either a strategyId or a strategy object so the spec can pass
 * the SeededStrategy struct directly.
 */
export async function cleanupTestStrategy(
  arg: string | { strategyId: string; ownerUserId: string },
): Promise<void> {
  const admin = getAdmin();

  if (typeof arg === "object" && arg.ownerUserId) {
    // Preferred path: delete the owner; the strategy cascades.
    const { error } = await admin.auth.admin.deleteUser(arg.ownerUserId);
    if (error) {
      console.warn(
        `[cleanup-test-project] deleteUser(${arg.ownerUserId}) for bridge owner failed: ${error.message}`,
      );
    }
    return;
  }

  // Fallback: only the strategyId is known — delete the row directly.
  const strategyId = typeof arg === "string" ? arg : arg.strategyId;
  const { error } = await admin
    .from("strategies")
    .delete()
    .eq("id", strategyId);
  if (error) {
    console.warn(
      `[cleanup-test-project] strategy delete(${strategyId}) failed: ${error.message}`,
    );
  }
}

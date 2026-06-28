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
import "./node-websocket-polyfill"; // must precede any createClient() (Node 20 WebSocket shim)
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  assertNotProductionSupabaseUrl,
  assertSupabaseServiceRoleKey,
} from "../../src/lib/test-safety";

function getAdmin(): SupabaseClient {
  const url = process.env.TEST_SUPABASE_URL;
  const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "[cleanup-test-project] TEST_SUPABASE_URL or TEST_SUPABASE_SERVICE_ROLE_KEY missing",
    );
  }
  // Phase 11 WR-05 defense-in-depth: refuse known prod URL patterns
  // before any service-role mutation happens. Symmetric with
  // seed-test-project getAdmin() — a teardown-side mistake is just as
  // damaging as a seed-side one (deleteUser cascades irreversibly).
  assertNotProductionSupabaseUrl(url, "cleanup-test-project");
  // Symmetric brand probe with seed-test-project. PR #107 added the
  // assertion + ServiceRoleKey brand on the seed side but the cleanup
  // helper kept passing the raw env var into createClient — same blast
  // radius (deleteUser cascades irreversibly), same wrong-key-paste
  // failure mode the probe was added to surface. Caught by /review
  // cross-PR audit, 2026-04-30.
  assertSupabaseServiceRoleKey(key, "cleanup-test-project");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Delete the seeded allocator. Cascades remove every owned row through
 * the FK chain (profiles.id → strategies / api_keys / allocator_holdings
 * / match_decisions / bridge_outcomes / allocator_preferences).
 *
 * Red-team RT-J06 (HIGH conf 7): in CI, fail loud. Locally, a deleteUser
 * failure is best-effort (re-run cleans up the next time). In CI a
 * silent leak compounds across runs — `e2e-onboarding-${ts}@example.test`
 * rows accumulate in TEST_SUPABASE auth.users with no signal. When
 * `process.env.CI` is set, the warn becomes a thrown error so the spec
 * fails and the leak surfaces immediately.
 */
export async function cleanupTestAllocator(userId: string): Promise<void> {
  const admin = getAdmin();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    const message = `[cleanup-test-project] deleteUser(${userId}) failed: ${error.message}`;
    if (process.env.CI) {
      throw new Error(message);
    }
    console.warn(message);
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

  // PR-3+4 silent-failure H6 (audit-2026-05-07): harmonize with the
  // `cleanupTestAllocator` RT-J06 pattern — in CI a silent leak
  // compounds across runs (test strategies accumulate in TEST_SUPABASE
  // with no signal), so the warn becomes a thrown error to surface the
  // leak in the failing spec. Local runs stay best-effort (re-runs
  // sweep). Without this, the bridge-strategy cleanup path was the only
  // remaining silent failure surface in the e2e helper module.
  if (typeof arg === "object" && arg.ownerUserId) {
    // Preferred path: delete the owner; the strategy cascades.
    const { error } = await admin.auth.admin.deleteUser(arg.ownerUserId);
    if (error) {
      // PR-3+4 H-RT-07 (red-team 2026-05-28): the deleteUser-then-throw
      // pattern left an orphan strategy when the user-side delete failed.
      // Subsequent runs hit an orphaned `strategies` row that poisoned
      // unique-name checks. Attempt the strategyId-based fallback BEFORE
      // surfacing the error, so the strategy row itself is removed even
      // if the cascade path failed. The throw still fires in CI so the
      // underlying auth-side failure surfaces.
      const fallbackError = await admin
        .from("strategies")
        .delete()
        .eq("id", arg.strategyId);
      const message = `[cleanup-test-project] deleteUser(${arg.ownerUserId}) for bridge owner failed: ${error.message}${
        fallbackError.error ? ` (strategy fallback also failed: ${fallbackError.error.message})` : " (strategy fallback deleted directly)"
      }`;
      if (process.env.CI) {
        throw new Error(message);
      }
      console.warn(message);
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
    const message = `[cleanup-test-project] strategy delete(${strategyId}) failed: ${error.message}`;
    if (process.env.CI) {
      throw new Error(message);
    }
    console.warn(message);
  }
}

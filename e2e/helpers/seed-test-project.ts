/**
 * Phase 11 / Plan 11-07 / D-15 — Deterministic seed for the
 * onboarding-funnel E2E.
 *
 * Uses the test Supabase project's service-role JWT to create a fresh
 * allocator and a placeholder Bridge candidate strategy. Each spec run
 * gets its own user (timestamped email) so the suite is rerun-safe.
 *
 * Required env (asserted at call time, not module load — module load
 * MUST stay side-effect-free so that the smoke spec which never imports
 * this file isn't accidentally affected):
 *   - TEST_SUPABASE_URL
 *   - TEST_SUPABASE_SERVICE_ROLE_KEY
 *
 * SAFETY NOTE — production isolation:
 *   The TEST_SUPABASE_* env vars MUST point at a dedicated test Supabase
 *   project, NOT production. If a developer accidentally sets them to
 *   production values, this module will mutate production data. The
 *   Plan 11-07 Task 3 BLOCKING checkpoint is the blast-radius gate —
 *   the user affirmatively confirms the test project is separate before
 *   the ci.yml gate ships. Defense-in-depth: the seeded user's email
 *   uses the deterministic prefix `e2e-onboarding-${Date.now()}@…` so
 *   any production sighting is immediately identifiable.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function getAdmin(): SupabaseClient {
  const url = process.env.TEST_SUPABASE_URL;
  const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "[seed-test-project] TEST_SUPABASE_URL or TEST_SUPABASE_SERVICE_ROLE_KEY missing — " +
        "spec must skip when secrets absent (D-16 / BLOCK-3 vars.E2E_TEST_DB_CONFIGURED).",
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface SeededAllocator {
  userId: string;
  email: string;
  password: string;
}

/**
 * Create a fresh test allocator user via the service-role admin API.
 * Email is timestamped to avoid collisions across reruns.
 */
export async function seedTestAllocator(): Promise<SeededAllocator> {
  const admin = getAdmin();
  const email = `e2e-onboarding-${Date.now()}@example.com`;
  const password = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`seedTestAllocator failed: ${error?.message ?? "no user"}`);
  }

  // Ensure the profile row exists. The signup trigger normally handles
  // this, but tests should not race the trigger — make the dependency
  // explicit so the spec is rerun-safe even if the trigger is dropped
  // in a future migration.
  const { error: profileError } = await admin
    .from("profiles")
    .upsert(
      { id: data.user.id, display_name: email },
      { onConflict: "id" },
    );
  if (profileError) {
    // Don't crash the seed — the trigger may have already created the row,
    // in which case the upsert with the new display_name is a non-issue.
    // Log loudly so a real RLS/grant problem surfaces in CI.
    console.warn(
      `[seed-test-project] profile upsert warning: ${profileError.message}`,
    );
  }

  return { userId: data.user.id, email, password };
}

export interface SeededStrategy {
  strategyId: string;
  ownerUserId: string;
}

/**
 * Insert a placeholder published strategy that the Scenario tab can
 * pick up as a Bridge candidate.
 *
 * The strategies table requires `user_id` (FK to profiles), `name`,
 * and a `status` from the enum {'draft','pending_review','published',
 * 'archived'} (migration 001:47-67). All other columns have safe
 * defaults. We seed a separate "bridge owner" allocator so the candidate
 * strategy is owned by a different profile from the funnel-test allocator
 * — closer to real-world conditions where the recommendation comes from
 * an external manager.
 */
export async function seedBridgeCandidate(): Promise<SeededStrategy> {
  const admin = getAdmin();

  // Create a separate "manager" user that owns the candidate strategy.
  const ownerEmail = `e2e-bridge-owner-${Date.now()}@example.com`;
  const { data: ownerData, error: ownerError } =
    await admin.auth.admin.createUser({
      email: ownerEmail,
      password: `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      email_confirm: true,
    });
  if (ownerError || !ownerData.user) {
    throw new Error(
      `seedBridgeCandidate (owner) failed: ${ownerError?.message ?? "no user"}`,
    );
  }

  await admin
    .from("profiles")
    .upsert(
      { id: ownerData.user.id, display_name: ownerEmail },
      { onConflict: "id" },
    );

  const { data, error } = await admin
    .from("strategies")
    .insert({
      user_id: ownerData.user.id,
      name: `E2E Bridge Candidate ${Date.now()}`,
      status: "published",
      benchmark: "BTC",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedBridgeCandidate failed: ${error?.message}`);
  }

  return { strategyId: data.id, ownerUserId: ownerData.user.id };
}

/**
 * Live-DB integration test — Migration 071 RLS policies on user_notes.
 *
 * Phase 08 / MANAGE-04 — the application-layer proof that allocator A
 * cannot SELECT/UPDATE/DELETE allocator B's `user_notes` rows via the
 * user-scoped Supabase client, and that INSERT with user_id=B is rejected.
 *
 * This test covers Research Finding #11 assertions 1-6 + 14 (the high-signal
 * subset of the full RLS matrix; the 4 scope_kinds share the same RLS shape
 * so one leakage probe per op×direction suffices). The mocked-Supabase
 * per-scope ownership assertions (7-13) live in
 * `src/app/api/notes/route.test.ts`.
 *
 * Structure mirrors `src/__tests__/allocator-holdings-rls.test.ts` verbatim.
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Skips gracefully (with `advertiseLiveDbSkipReason`) when those are
 * absent (standard CI without live DB).
 *
 * Run locally:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   npx vitest run src/__tests__/user-notes-multiscope-rls.test.ts
 */

import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  HAS_LIVE_DB,
  LIVE_DB_URL,
  LIVE_DB_SERVICE_ROLE_KEY,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Insert a user_notes row via service-role (bypasses RLS). Returns the
 * inserted row's id. user_notes has no FK dependencies other than
 * profiles(user_id) (guaranteed by createTestUser above).
 */
async function seedNote(
  admin: ReturnType<typeof createLiveAdminClient>,
  userId: string,
  scope_kind: "portfolio" | "holding" | "bridge_outcome" | "strategy",
  scope_ref: string,
  content: string,
): Promise<string> {
  const { data, error } = await admin
    .from("user_notes")
    .insert({
      user_id: userId,
      scope_kind,
      scope_ref,
      content,
    } as never)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedNote(${userId}/${scope_kind}): ${error?.message}`);
  }
  return (data as { id: string }).id;
}

/**
 * Create a user-scoped Supabase client authenticated as the given user.
 * Returns null (and logs a warning) if password-grant is disabled.
 */
async function createAuthedClient(
  email: string,
  password: string,
): Promise<ReturnType<typeof createClient> | null> {
  const anon = createClient(LIVE_DB_URL!, LIVE_DB_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const {
    data: { session },
    error,
  } = await anon.auth.signInWithPassword({ email, password });
  if (error || !session) {
    console.warn(
      "[user-notes-multiscope-rls] signInWithPassword failed (password-grant may be disabled):",
      error?.message,
    );
    return null;
  }
  return createClient(LIVE_DB_URL!, LIVE_DB_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${session.access_token}` },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Migration 071 — user_notes multi-scope RLS", () => {
  // -------------------------------------------------------------------------
  // Two-actor RLS matrix (Research Finding #11 tests 1-6 + 14).
  // -------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "user_notes: 4-scope RLS matrix (SELECT/UPDATE/INSERT/DELETE) + ON-CONFLICT idempotency",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = {
        userIds: [],
        strategyIds: [],
      };
      const noteIds: string[] = [];

      try {
        // --- Seed two allocators via service-role --------------------------
        const passwordA = `RlsNotesA${ts}!`;
        const passwordB = `RlsNotesB${ts}!`;
        const emailA = `rls-notes-a-${ts}@test.sec`;
        const emailB = `rls-notes-b-${ts}@test.sec`;
        const userAId = await createTestUser(admin, emailA, passwordA);
        const userBId = await createTestUser(admin, emailB, passwordB);
        cleanup.userIds!.push(userAId, userBId);

        // --- Seed 4 notes per user (8 rows total) -------------------------
        // scope_kinds: portfolio, holding, bridge_outcome, strategy.
        // For portfolio/bridge_outcome/strategy we use synthetic-UUID scope_refs
        // (RLS does not verify the UUID exists in the target table — that's
        // the /api/notes PATCH app-layer check's job, covered in route.test.ts).
        const uuidAPortfolio = "aaaaaaaa-0001-4000-8000-000000000001";
        const uuidABridge = "aaaaaaaa-0001-4000-8000-000000000002";
        const uuidAStrategy = "aaaaaaaa-0001-4000-8000-000000000003";
        const uuidBPortfolio = "bbbbbbbb-0002-4000-8000-000000000001";
        const uuidBBridge = "bbbbbbbb-0002-4000-8000-000000000002";
        const uuidBStrategy = "bbbbbbbb-0002-4000-8000-000000000003";

        const aPortfolioNote = await seedNote(
          admin,
          userAId,
          "portfolio",
          uuidAPortfolio,
          "A-portfolio-note",
        );
        const aHoldingNote = await seedNote(
          admin,
          userAId,
          "holding",
          "binance:BTC:spot",
          "A-holding-note",
        );
        const aBridgeNote = await seedNote(
          admin,
          userAId,
          "bridge_outcome",
          uuidABridge,
          "A-bridge-note",
        );
        const aStrategyNote = await seedNote(
          admin,
          userAId,
          "strategy",
          uuidAStrategy,
          "A-strategy-note",
        );
        const bPortfolioNote = await seedNote(
          admin,
          userBId,
          "portfolio",
          uuidBPortfolio,
          "B-portfolio-note",
        );
        const bHoldingNote = await seedNote(
          admin,
          userBId,
          "holding",
          "okx:ETHUSDT:derivative",
          "B-holding-note",
        );
        const bBridgeNote = await seedNote(
          admin,
          userBId,
          "bridge_outcome",
          uuidBBridge,
          "B-bridge-note",
        );
        const bStrategyNote = await seedNote(
          admin,
          userBId,
          "strategy",
          uuidBStrategy,
          "B-strategy-note",
        );
        noteIds.push(
          aPortfolioNote,
          aHoldingNote,
          aBridgeNote,
          aStrategyNote,
          bPortfolioNote,
          bHoldingNote,
          bBridgeNote,
          bStrategyNote,
        );

        // --- Authenticate as A ---------------------------------------------
        const clientA = await createAuthedClient(emailA, passwordA);
        if (!clientA) return; // password-grant disabled — graceful skip

        // --- Test 1: A SELECTs own rows — gets exactly 4 (own 4 scopes) ----
        const { data: aRows, error: aErr } = await clientA
          .from("user_notes")
          .select("id, user_id, scope_kind");
        expect(aErr).toBeNull();
        expect(aRows).not.toBeNull();
        expect(aRows!.length).toBe(4);
        expect(
          aRows!.every(
            (r: unknown) => (r as { user_id: string }).user_id === userAId,
          ),
        ).toBe(true);

        // --- Test 2: A SELECTing B's note (by id) returns 0 rows -----------
        const { data: bPortfolioFromA, error: crossErr } = await clientA
          .from("user_notes")
          .select("id")
          .eq("id", bPortfolioNote);
        expect(crossErr).toBeNull();
        expect(bPortfolioFromA).toEqual([]);

        // --- Test 3: A UPDATEs own row (content) ---------------------------
        const { error: updOwnErr } = await clientA
          .from("user_notes")
          .update({ content: "A-portfolio-updated" })
          .eq("id", aPortfolioNote);
        expect(updOwnErr).toBeNull();

        // --- Test 4: A UPDATE targeting B's row affects 0 rows -------------
        const { data: updCrossData, error: updCrossErr } = await clientA
          .from("user_notes")
          .update({ content: "TAMPERED" })
          .eq("id", bPortfolioNote)
          .select("id");
        expect(updCrossErr).toBeNull();
        expect(updCrossData).toEqual([]);

        // Verify B's row is untouched (use admin client to read).
        const { data: bRowCheck } = await admin
          .from("user_notes")
          .select("content")
          .eq("id", bPortfolioNote)
          .single();
        expect((bRowCheck as { content: string }).content).toBe(
          "B-portfolio-note",
        );

        // --- Test 5: A INSERT with user_id=B fails ------------------------
        const uuidARogue = "aaaaaaaa-0001-4000-8000-000000000099";
        const { error: insCrossErr } = await clientA
          .from("user_notes")
          .insert({
            user_id: userBId,
            scope_kind: "portfolio",
            scope_ref: uuidARogue,
            content: "CROSS-INSERT",
          } as never);
        expect(insCrossErr).not.toBeNull();

        // --- Test 6: A DELETE of B's row affects 0 rows --------------------
        const { data: delCrossData, error: delCrossErr } = await clientA
          .from("user_notes")
          .delete()
          .eq("id", bPortfolioNote)
          .select("id");
        expect(delCrossErr).toBeNull();
        expect(delCrossData).toEqual([]);
        // Verify B's row still exists.
        const { data: bRowStillExists } = await admin
          .from("user_notes")
          .select("id")
          .eq("id", bPortfolioNote)
          .maybeSingle();
        expect(bRowStillExists).not.toBeNull();

        // --- Test 14: rapid double-upsert for same (scope_kind, scope_ref) --
        // Produces exactly 1 row after both writes land (ON CONFLICT
        // (user_id, scope_kind, scope_ref) idempotency).
        const uuidAUpsert = "aaaaaaaa-0001-4000-8000-000000000010";
        const upsertPayload = {
          user_id: userAId,
          scope_kind: "portfolio" as const,
          scope_ref: uuidAUpsert,
          content: "rapid-1",
        };
        const [{ error: up1Err }, { error: up2Err }] = await Promise.all([
          clientA
            .from("user_notes")
            .upsert(upsertPayload, {
              onConflict: "user_id,scope_kind,scope_ref",
            }),
          clientA
            .from("user_notes")
            .upsert(
              { ...upsertPayload, content: "rapid-2" },
              { onConflict: "user_id,scope_kind,scope_ref" },
            ),
        ]);
        expect(up1Err).toBeNull();
        expect(up2Err).toBeNull();
        const { data: upsertRows } = await admin
          .from("user_notes")
          .select("id")
          .eq("user_id", userAId)
          .eq("scope_kind", "portfolio")
          .eq("scope_ref", uuidAUpsert);
        expect(upsertRows!.length).toBe(1);
        noteIds.push((upsertRows![0] as { id: string }).id);
      } finally {
        for (const id of noteIds) {
          try {
            await admin.from("user_notes").delete().eq("id", id);
          } catch (err) {
            console.warn(
              `[user-notes-multiscope-rls] cleanup user_notes ${id}: ${(err as Error).message}`,
            );
          }
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    45_000,
  );

  // This test always runs (no skipIf) and advertises the skip reason when
  // HAS_LIVE_DB is false, so the test suite doesn't fail silently.
  it("advertises skip reason when live DB is unavailable", () => {
    advertiseLiveDbSkipReason("user-notes-multiscope-rls");
    expect(true).toBe(true);
  });
});

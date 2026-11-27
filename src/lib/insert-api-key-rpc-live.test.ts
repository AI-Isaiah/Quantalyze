/**
 * Live-lane proof of the key-connect write path (Phase 243 DBBACKSTOP, plan 06, DBACC-02).
 *
 * WHY THIS FILE EXISTS. The `validate-and-encrypt` route writes the `api_keys` row through
 * `admin.rpc("insert_api_key", ...)`. Its unit test (`route.test.ts`) mocks the client, so it
 * can prove which ARGUMENTS the route sends and nothing about what the database does with
 * them. Three things the route depends on are only true on a real PostgREST over a real
 * database, and they are what these arms pin:
 *
 *   (a) service_role gets a uuid back, the row is owned by `p_user_id`, the database stamped
 *       `attested_venue` from `p_exchange` (the route sends no attestation), and the venue
 *       server was normalised.
 *   (b) a duplicate venue identity reaches the client as `23505` whose MESSAGE names
 *       `api_keys_user_exchange_venue_account_uniq`. The route maps exactly that constraint
 *       name to its honest "already connected" answer (`pgConstraintName` parses `message`,
 *       never `details`), so a handler inside the writer that re-raised without the name
 *       would silently turn that answer into a generic 500 and no unit test would notice.
 *   (c) an `authenticated` caller is refused and writes nothing: the writer is
 *       service_role-only, so no client path opened.
 *   (d) `p_id` is honoured (the seeds key later rows on a caller-chosen id).
 *
 * Gate: `HAS_LIVE_DB`. `scripts/live-db-lane-corpus.mjs` derives this file into the
 * `frontend-live-db-lane` corpus from that symbol, so it runs on the local-stack lane.
 * Skipped without live-DB credentials; the skip reason is advertised below.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  pgConstraintName,
  VENUE_IDENTITY_CONSTRAINT,
} from "@/lib/api/pgConstraintName";
import {
  HAS_LIVE_DB,
  createLiveAdminClient,
  cleanupLiveDbRow,
  signInAsTestUser,
  advertiseLiveDbSkipReason,
} from "./test-helpers/live-db";

describe("insert_api_key RPC: the key-connect write path on a real PostgREST", () => {
  const stamp = Date.now();
  const testLogin = `9${String(stamp).slice(-8)}`;
  const label = `iak-live-${stamp}`;
  const refusedLabel = `iak-live-refused-${stamp}`;
  const idLabel = `iak-live-id-${stamp}`;

  let admin: SupabaseClient;
  let ownerId = "";
  let ownerClient: SupabaseClient;
  const userIds: string[] = [];
  const apiKeyIds: string[] = [];

  beforeAll(async () => {
    if (!HAS_LIVE_DB) return;
    admin = createLiveAdminClient();
    // One user, signed in: the same user is the `p_user_id` owner for the service_role
    // arms and the authenticated caller for arm (c).
    const signedIn = await signInAsTestUser(admin, "iak-live", (id) => userIds.push(id));
    ownerId = signedIn.userId;
    ownerClient = signedIn.client;
  });

  afterAll(async () => {
    if (!HAS_LIVE_DB) return;
    await cleanupLiveDbRow(admin, { apiKeyIds, userIds });
  });

  it.skipIf(!HAS_LIVE_DB)(
    "(a) service_role writes through the RPC: uuid back, owner kept, attested_venue stamped, server normalised",
    async () => {
      const { data, error } = await admin.rpc("insert_api_key", {
        p_user_id: ownerId,
        p_exchange: "mt5",
        p_label: label,
        p_api_key_encrypted: "live-rpc-placeholder",
        p_venue_account_id: testLogin,
        p_venue_server: " Srv.Live-Test ",
      });
      expect(error).toBeNull();
      expect(typeof data).toBe("string");
      expect(data).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      apiKeyIds.push(data as string);

      const { data: row, error: readError } = await admin
        .from("api_keys")
        .select("id, user_id, exchange, attested_venue, venue_account_id, venue_server")
        .eq("id", data as string)
        .single();
      expect(readError).toBeNull();
      expect(row?.user_id).toBe(ownerId);
      expect(row?.exchange).toBe("mt5");
      // The route sends no attestation: the writer stamps it from `p_exchange`.
      expect(row?.attested_venue).toBe("mt5");
      expect(row?.venue_account_id).toBe(testLogin);
      expect(row?.venue_server).toBe("srv.live-test");
    },
  );

  it.skipIf(!HAS_LIVE_DB)(
    "(b) the same venue identity again answers 23505 naming api_keys_user_exchange_venue_account_uniq",
    async () => {
      const { data, error } = await admin.rpc("insert_api_key", {
        p_user_id: ownerId,
        p_exchange: "mt5",
        p_label: `${label}-dup`,
        p_api_key_encrypted: "live-rpc-placeholder",
        p_venue_account_id: testLogin,
        p_venue_server: " Srv.Live-Test ",
      });
      // A write that unexpectedly succeeded must still be cleaned up.
      if (typeof data === "string") apiKeyIds.push(data);
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23505");
      expect(pgConstraintName(error)).toBe(VENUE_IDENTITY_CONSTRAINT);
    },
  );

  it.skipIf(!HAS_LIVE_DB)(
    "(c) an authenticated caller is refused, and no row exists for its label",
    async () => {
      const { data, error } = await ownerClient.rpc("insert_api_key", {
        p_user_id: ownerId,
        p_exchange: "deribit",
        p_label: refusedLabel,
        p_api_key_encrypted: "live-rpc-placeholder",
      });
      if (typeof data === "string") apiKeyIds.push(data);
      expect(error).not.toBeNull();
      expect(data).toBeNull();

      const { data: rows, error: readError } = await admin
        .from("api_keys")
        .select("id")
        .eq("user_id", ownerId)
        .eq("label", refusedLabel);
      expect(readError).toBeNull();
      expect(rows).toEqual([]);
    },
  );

  it.skipIf(!HAS_LIVE_DB)("(d) a given p_id is the stored id", async () => {
    const wantedId = crypto.randomUUID();
    const { data, error } = await admin.rpc("insert_api_key", {
      p_user_id: ownerId,
      p_exchange: "deribit",
      p_label: idLabel,
      p_api_key_encrypted: "live-rpc-placeholder",
      p_id: wantedId,
    });
    if (typeof data === "string") apiKeyIds.push(data);
    expect(error).toBeNull();
    expect(data).toBe(wantedId);

    const { data: row, error: readError } = await admin
      .from("api_keys")
      .select("id")
      .eq("id", wantedId)
      .single();
    expect(readError).toBeNull();
    expect(row?.id).toBe(wantedId);
  });

  it("advertises why the live arms were skipped when no live DB is configured", () => {
    advertiseLiveDbSkipReason("insert-api-key-rpc-live");
  });
});

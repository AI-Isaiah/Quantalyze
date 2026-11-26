import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 228 (CONN-02) — `persistRotatedMt5Secret` is the ONE owner-scoped write
 * of a rotated MT5 secret, now shared by rotate-secret and create-with-key's
 * MT5 same-account arm. The admin client crosses RLS, so the explicit
 * `user_id` filter is the tenant boundary: a dropped filter would let one
 * owner's connect request write another owner's key secret. These tests pin
 * the filter triple by name and order, the payload, and that only a landed
 * write is audited.
 */

const auditEvents: Array<{ action: string; entity_type: string; entity_id: string }> = [];
vi.mock("@/lib/audit", () => ({
  logAuditEvent: (
    _client: unknown,
    event: { action: string; entity_type: string; entity_id: string },
  ) => {
    auditEvents.push(event);
  },
}));

import { persistRotatedMt5Secret } from "./rotate-key-secret";

const USER_ID = "00000000-0000-4000-8000-0000000000a1";
const KEY_ID = "00000000-0000-4000-8000-0000000000b2";
const OTHER_KEY_ID = "00000000-0000-4000-8000-0000000000c3";

const PARSED = {
  api_key_encrypted: "ct-key",
  api_secret_encrypted: "ct-secret",
  passphrase_encrypted: "ct-pass",
  dek_encrypted: "ct-dek",
  nonce: "ct-nonce",
  kek_version: 1,
  venue_account_id: "synthetic-login-1",
};

type UpdateAnswer = { data: Array<{ id: string }> | null; error: unknown };

interface Recorder {
  updates: Array<{ payload: Record<string, unknown>; eqs: Array<[string, unknown]>; select: string | null }>;
  holderReads: Array<Array<[string, unknown]>>;
  updateAnswers: UpdateAnswer[];
  holderAnswer: { data: unknown[] | null; error: unknown };
}

function makeAdmin(rec: Recorder): SupabaseClient {
  return {
    from(table: string) {
      expect(table).toBe("api_keys");
      return {
        update(payload: Record<string, unknown>) {
          const entry = { payload, eqs: [] as Array<[string, unknown]>, select: null as string | null };
          rec.updates.push(entry);
          const chain = {
            eq(col: string, val: unknown) {
              entry.eqs.push([col, val]);
              return chain;
            },
            select(cols: string) {
              entry.select = cols;
              return Promise.resolve(
                rec.updateAnswers.shift() ?? { data: [{ id: KEY_ID }], error: null },
              );
            },
          };
          return chain;
        },
        select() {
          const eqs: Array<[string, unknown]> = [];
          rec.holderReads.push(eqs);
          const chain = {
            eq(col: string, val: unknown) {
              eqs.push([col, val]);
              return chain;
            },
            is() {
              return chain;
            },
            order() {
              return Promise.resolve(rec.holderAnswer);
            },
          };
          return chain;
        },
      };
    },
  } as unknown as SupabaseClient;
}

const SUPABASE = {} as SupabaseClient;

function liveRow(overrides: Partial<{ venue_account_id: string | null; is_active: boolean; disconnected_at: string | null }> = {}) {
  return { venue_account_id: "synthetic-login-1", is_active: true, disconnected_at: null, ...overrides };
}

let rec: Recorder;
beforeEach(() => {
  auditEvents.length = 0;
  rec = { updates: [], holderReads: [], updateAnswers: [], holderAnswer: { data: [], error: null } };
});

describe("persistRotatedMt5Secret — the owner-scoped write", () => {
  it("filters on id, user_id and exchange = 'mt5', in that order, then selects id", async () => {
    const result = await persistRotatedMt5Secret({
      admin: makeAdmin(rec), supabase: SUPABASE, userId: USER_ID, keyId: KEY_ID, keyRow: liveRow(), parsed: PARSED,
    });
    expect(result).toEqual({ kind: "ok" });
    expect(rec.updates).toHaveLength(1);
    expect(rec.updates[0].eqs).toEqual([
      ["id", KEY_ID],
      ["user_id", USER_ID],
      ["exchange", "mt5"],
    ]);
    expect(rec.updates[0].select).toBe("id");
  });

  it("writes the six ciphertext columns plus the sync clear, and history_inclusion: null for a key returning to live", async () => {
    await persistRotatedMt5Secret({
      admin: makeAdmin(rec), supabase: SUPABASE, userId: USER_ID, keyId: KEY_ID, keyRow: liveRow(), parsed: PARSED,
    });
    expect(rec.updates[0].payload).toEqual({
      api_key_encrypted: "ct-key",
      api_secret_encrypted: "ct-secret",
      passphrase_encrypted: "ct-pass",
      dek_encrypted: "ct-dek",
      nonce: "ct-nonce",
      kek_version: 1,
      sync_error: null,
      sync_status: "idle",
      history_inclusion: null,
    });
  });

  it("keeps a disconnected key's history_inclusion choice (no reset when the write does not return it to live)", async () => {
    await persistRotatedMt5Secret({
      admin: makeAdmin(rec), supabase: SUPABASE, userId: USER_ID, keyId: KEY_ID,
      keyRow: liveRow({ disconnected_at: "2026-11-01T00:00:00Z" }), parsed: PARSED,
    });
    expect(rec.updates[0].payload).not.toHaveProperty("history_inclusion");
  });

  it("backfills venue_account_id only when the pre-read value was null and no other live key reads the login", async () => {
    await persistRotatedMt5Secret({
      admin: makeAdmin(rec), supabase: SUPABASE, userId: USER_ID, keyId: KEY_ID,
      keyRow: liveRow({ venue_account_id: null }), parsed: PARSED,
    });
    expect(rec.holderReads).toHaveLength(1);
    expect(rec.holderReads[0]).toContainEqual(["user_id", USER_ID]);
    expect(rec.updates[0].payload.venue_account_id).toBe("synthetic-login-1");
  });

  it("does not backfill when the pre-read already had a venue_account_id (no holder read either)", async () => {
    await persistRotatedMt5Secret({
      admin: makeAdmin(rec), supabase: SUPABASE, userId: USER_ID, keyId: KEY_ID, keyRow: liveRow(), parsed: PARSED,
    });
    expect(rec.holderReads).toHaveLength(0);
    expect(rec.updates[0].payload).not.toHaveProperty("venue_account_id");
  });

  it("skips the backfill when another live key of the owner already reads the login", async () => {
    rec.holderAnswer = { data: [{ id: OTHER_KEY_ID, venue_server: null }], error: null };
    await persistRotatedMt5Secret({
      admin: makeAdmin(rec), supabase: SUPABASE, userId: USER_ID, keyId: KEY_ID,
      keyRow: liveRow({ venue_account_id: null }), parsed: PARSED,
    });
    expect(rec.updates[0].payload).not.toHaveProperty("venue_account_id");
  });

  it("returns holder_read_failed BEFORE any UPDATE when the backfill fence read faults", async () => {
    const fault = { message: "read fault" };
    rec.holderAnswer = { data: null, error: fault };
    const result = await persistRotatedMt5Secret({
      admin: makeAdmin(rec), supabase: SUPABASE, userId: USER_ID, keyId: KEY_ID,
      keyRow: liveRow({ venue_account_id: null }), parsed: PARSED,
    });
    expect(result).toEqual({ kind: "holder_read_failed", error: fault });
    expect(rec.updates).toHaveLength(0);
    expect(auditEvents).toHaveLength(0);
  });

  it("retries once without venue_account_id on a venue-identity 23505, and lands the password fix", async () => {
    rec.updateAnswers = [
      { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "api_keys_user_exchange_venue_account_uniq"' } },
      { data: [{ id: KEY_ID }], error: null },
    ];
    const result = await persistRotatedMt5Secret({
      admin: makeAdmin(rec), supabase: SUPABASE, userId: USER_ID, keyId: KEY_ID,
      keyRow: liveRow({ venue_account_id: null }), parsed: PARSED,
    });
    expect(result).toEqual({ kind: "ok" });
    expect(rec.updates).toHaveLength(2);
    expect(rec.updates[0].payload.venue_account_id).toBe("synthetic-login-1");
    expect(rec.updates[1].payload).not.toHaveProperty("venue_account_id");
    expect(rec.updates[1].eqs).toEqual([
      ["id", KEY_ID],
      ["user_id", USER_ID],
      ["exchange", "mt5"],
    ]);
  });

  it("returns venue_collision when the retry collides again, and audits nothing", async () => {
    const collide = { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "api_keys_user_exchange_venue_account_uniq"' } };
    rec.updateAnswers = [collide, collide];
    const result = await persistRotatedMt5Secret({
      admin: makeAdmin(rec), supabase: SUPABASE, userId: USER_ID, keyId: KEY_ID,
      keyRow: liveRow({ venue_account_id: null }), parsed: PARSED,
    });
    expect(result).toEqual({ kind: "venue_collision" });
    expect(auditEvents).toHaveLength(0);
  });

  it("returns write_failed for any other update error, and audits nothing", async () => {
    const err = { code: "08006", message: "connection failure" };
    rec.updateAnswers = [{ data: null, error: err }];
    const result = await persistRotatedMt5Secret({
      admin: makeAdmin(rec), supabase: SUPABASE, userId: USER_ID, keyId: KEY_ID, keyRow: liveRow(), parsed: PARSED,
    });
    expect(result).toEqual({ kind: "write_failed", error: err });
    expect(auditEvents).toHaveLength(0);
  });

  it("returns write_zero_rows when the UPDATE matched nothing, and audits nothing", async () => {
    rec.updateAnswers = [{ data: [], error: null }];
    const result = await persistRotatedMt5Secret({
      admin: makeAdmin(rec), supabase: SUPABASE, userId: USER_ID, keyId: KEY_ID, keyRow: liveRow(), parsed: PARSED,
    });
    expect(result).toEqual({ kind: "write_zero_rows" });
    expect(auditEvents).toHaveLength(0);
  });

  it("audits exactly one api_key.rotate_secret event on a landed write", async () => {
    await persistRotatedMt5Secret({
      admin: makeAdmin(rec), supabase: SUPABASE, userId: USER_ID, keyId: KEY_ID, keyRow: liveRow(), parsed: PARSED,
    });
    expect(auditEvents).toEqual([
      { action: "api_key.rotate_secret", entity_type: "api_key", entity_id: KEY_ID },
    ]);
  });
});

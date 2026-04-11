import { describe, it, expect, beforeEach, vi } from "vitest";

// for-quants-leads-admin imports "server-only" which throws in jsdom.
// Mirrors the pattern in analytics.test.ts.
vi.mock("server-only", () => ({}));

import {
  listForQuantsLeads,
  markLeadProcessed,
  unmarkLeadProcessed,
  FOR_QUANTS_LEADS_FULL_VIEW_CAP,
} from "./for-quants-leads-admin";
import {
  createMockSupabaseClient,
  createMockStore,
  seedTable,
  setTableErrorOnce,
  // NOTE: importing the buildNotFilter internals via the public client
  // surface below is the intended integration test; no direct import.
} from "./supabase/mock";

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Test Quant",
    firm: "Test Capital",
    email: "test@example.com",
    preferred_time: null,
    notes: null,
    wizard_context: null,
    created_at: "2026-04-11T12:00:00Z",
    processed_at: null,
    processed_by: null,
    ...overrides,
  };
}

describe("listForQuantsLeads", () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
  });

  it("returns only unprocessed rows when showAll is false", async () => {
    seedTable(store, "for_quants_leads", [
      makeLead({ id: "11111111-0000-0000-0000-000000000001", processed_at: null }),
      makeLead({
        id: "22222222-0000-0000-0000-000000000002",
        processed_at: "2026-04-10T09:00:00Z",
      }),
      makeLead({ id: "33333333-0000-0000-0000-000000000003", processed_at: null }),
    ]);

    const client = createMockSupabaseClient(store);
    const result = await listForQuantsLeads({ showAll: false, client });

    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.processed_at === null)).toBe(true);
    expect(result.hitCap).toBe(false);
  });

  it("returns all rows when showAll is true", async () => {
    seedTable(store, "for_quants_leads", [
      makeLead({ id: "11111111-0000-0000-0000-000000000001", processed_at: null }),
      makeLead({
        id: "22222222-0000-0000-0000-000000000002",
        processed_at: "2026-04-10T09:00:00Z",
      }),
    ]);

    const client = createMockSupabaseClient(store);
    const result = await listForQuantsLeads({ showAll: true, client });

    expect(result.rows).toHaveLength(2);
    expect(result.hitCap).toBe(false);
  });

  it("reports hitCap when showAll returns exactly the cap", async () => {
    const rows = Array.from({ length: FOR_QUANTS_LEADS_FULL_VIEW_CAP }, (_, i) =>
      makeLead({
        id: `${i.toString(16).padStart(8, "0")}-0000-0000-0000-000000000000`,
      }),
    );
    seedTable(store, "for_quants_leads", rows);

    const client = createMockSupabaseClient(store);
    const result = await listForQuantsLeads({ showAll: true, client });

    expect(result.rows.length).toBe(FOR_QUANTS_LEADS_FULL_VIEW_CAP);
    expect(result.hitCap).toBe(true);
  });

  it("returns empty rows + no hitCap when DB errors", async () => {
    setTableErrorOnce(store, "for_quants_leads", { message: "boom" });
    const client = createMockSupabaseClient(store);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await listForQuantsLeads({ showAll: false, client });

    expect(result.rows).toEqual([]);
    expect(result.hitCap).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("returns empty list when no unprocessed rows exist", async () => {
    seedTable(store, "for_quants_leads", [
      makeLead({ processed_at: "2026-04-10T09:00:00Z" }),
    ]);

    const client = createMockSupabaseClient(store);
    const result = await listForQuantsLeads({ showAll: false, client });

    expect(result.rows).toEqual([]);
  });
});

describe("markLeadProcessed", () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
  });

  it("stamps processed_at on an unprocessed row", async () => {
    seedTable(store, "for_quants_leads", [
      makeLead({ id: "11111111-0000-0000-0000-000000000001", processed_at: null }),
    ]);
    const client = createMockSupabaseClient(store);

    const result = await markLeadProcessed(
      "11111111-0000-0000-0000-000000000001",
      client,
    );

    expect(result).toEqual({ ok: true });
    const row = store.tables
      .get("for_quants_leads")
      ?.rows.find((r) => r.id === "11111111-0000-0000-0000-000000000001");
    expect(row?.processed_at).toBeTruthy();
    expect(typeof row?.processed_at).toBe("string");
  });

  it("returns not_found when the row is already processed (idempotent)", async () => {
    seedTable(store, "for_quants_leads", [
      makeLead({
        id: "11111111-0000-0000-0000-000000000001",
        processed_at: "2026-04-10T09:00:00Z",
      }),
    ]);
    const client = createMockSupabaseClient(store);

    const result = await markLeadProcessed(
      "11111111-0000-0000-0000-000000000001",
      client,
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns not_found when the row does not exist", async () => {
    const client = createMockSupabaseClient(store);

    const result = await markLeadProcessed(
      "99999999-0000-0000-0000-000000000099",
      client,
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns db_error when the update fails", async () => {
    seedTable(store, "for_quants_leads", [
      makeLead({ id: "11111111-0000-0000-0000-000000000001", processed_at: null }),
    ]);
    setTableErrorOnce(store, "for_quants_leads", { message: "constraint" });
    const client = createMockSupabaseClient(store);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await markLeadProcessed(
      "11111111-0000-0000-0000-000000000001",
      client,
    );

    expect(result).toEqual({ ok: false, reason: "db_error" });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("mock `.not(col, \"is\", null)` semantics (used by unmarkLeadProcessed)", () => {
  it("excludes rows where the column IS null (NULL-safe)", async () => {
    const store = createMockStore();
    seedTable(store, "for_quants_leads", [
      makeLead({ id: "11111111-0000-0000-0000-000000000001", processed_at: null }),
      makeLead({
        id: "22222222-0000-0000-0000-000000000002",
        processed_at: "2026-04-10T09:00:00Z",
      }),
    ]);
    const client = createMockSupabaseClient(store);

    // Unmark should only match the processed row — the unprocessed
    // row has `processed_at === null` which .not("is", null) excludes.
    const result = await unmarkLeadProcessed(
      "11111111-0000-0000-0000-000000000001",
      client,
    );
    expect(result).toEqual({ ok: false, reason: "not_found" });

    const result2 = await unmarkLeadProcessed(
      "22222222-0000-0000-0000-000000000002",
      client,
    );
    expect(result2).toEqual({ ok: true });
  });
});

describe("unmarkLeadProcessed", () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
  });

  it("clears processed_at on a processed row", async () => {
    seedTable(store, "for_quants_leads", [
      makeLead({
        id: "11111111-0000-0000-0000-000000000001",
        processed_at: "2026-04-10T09:00:00Z",
      }),
    ]);
    const client = createMockSupabaseClient(store);

    const result = await unmarkLeadProcessed(
      "11111111-0000-0000-0000-000000000001",
      client,
    );

    expect(result).toEqual({ ok: true });
    const row = store.tables
      .get("for_quants_leads")
      ?.rows.find((r) => r.id === "11111111-0000-0000-0000-000000000001");
    expect(row?.processed_at).toBeNull();
  });

  it("returns not_found when the row is already unprocessed (symmetric)", async () => {
    seedTable(store, "for_quants_leads", [
      makeLead({ id: "11111111-0000-0000-0000-000000000001", processed_at: null }),
    ]);
    const client = createMockSupabaseClient(store);

    const result = await unmarkLeadProcessed(
      "11111111-0000-0000-0000-000000000001",
      client,
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});

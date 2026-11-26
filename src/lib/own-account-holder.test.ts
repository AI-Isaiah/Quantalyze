import { describe, expect, it, vi } from "vitest";
import { parseAccountHolder, readOwnAccountHolder } from "./own-account-holder";

/**
 * A tiny owner-aware table: a read returns the first row matching every filter
 * the code sent. Foreign rows come FIRST and share the key id, so a read that
 * dropped its owner filter would return the foreign row.
 */
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>, faults: Record<string, unknown> = {}) {
  const reads: { table: string; filters: Row }[] = [];
  const db = {
    from(table: string) {
      return {
        select() {
          const filters: Row = {};
          const b = {
            eq(col: string, val: unknown) {
              filters[col] = val;
              return b;
            },
            neq(col: string, val: unknown) {
              filters[`${col}:neq`] = val;
              return b;
            },
            not(col: string, op: string, val: string) {
              if (op !== "in") throw new Error(`fake: unsupported not.${op}`);
              filters[`${col}:notin`] = val.replace(/[()]/g, "").split(",");
              return b;
            },
            order: () => b,
            limit: () => b,
            async maybeSingle() {
              reads.push({ table, filters: { ...filters } });
              if (faults[table]) return { data: null, error: faults[table] };
              const hit = (tables[table] ?? []).find((r) =>
                Object.entries(filters).every(([k, v]) => {
                  if (k.endsWith(":neq")) return r[k.slice(0, -4)] !== v;
                  if (k.endsWith(":notin")) return !(v as unknown[]).includes(r[k.slice(0, -6)]);
                  return !(k in r) || r[k] === v;
                }),
              );
              return { data: hit ?? null, error: null };
            },
          };
          return b;
        },
      };
    },
  };
  return { db: db as never, reads };
}

const ME = "me-0000";
const OTHER = "other-0000";
const KEY = "key-0001";

describe("readOwnAccountHolder", () => {
  it("names the caller's strategy and links to its factsheet, never another owner's strategy on the same key", async () => {
    const { db } = fakeDb({
      strategies: [
        { user_id: OTHER, api_key_id: KEY, id: "s-other", name: "Other Fund", status: "published" },
        { user_id: ME, api_key_id: KEY, id: "s-mine", name: " My Fund ", status: "published" },
      ],
    });
    expect(await readOwnAccountHolder(db, ME, KEY, "t")).toEqual({
      kind: "strategy",
      name: "My Fund",
      href: "/factsheet/s-mine?from=strategies",
    });
  });

  it("reaches a composite strategy through strategy_keys", async () => {
    const { db } = fakeDb({
      strategy_keys: [
        { owner_id: OTHER, api_key_id: KEY, strategy_id: "s-other" },
        { owner_id: ME, api_key_id: KEY, strategy_id: "s-comp" },
      ],
      strategies: [
        { user_id: OTHER, id: "s-comp", name: "Other Composite", status: "published" },
        { user_id: ME, id: "s-comp", name: "Composite Book", status: "published" },
      ],
    });
    expect(await readOwnAccountHolder(db, ME, KEY, "t")).toMatchObject({
      kind: "strategy",
      name: "Composite Book",
    });
  });

  it("falls back to the key (nickname, date, /strategies) when only an ARCHIVED strategy or nothing holds it, and never names another owner's key", async () => {
    // Archived is not coverage on /strategies (W-4), so the key is listed there
    // as "No strategy yet": the key, not the archived strategy, is what to name.
    const { db } = fakeDb({
      strategies: [{ user_id: ME, api_key_id: KEY, id: "s-old", name: "Old Fund", status: "archived" }],
      api_keys: [
        { user_id: OTHER, id: KEY, label: "Other Key", created_at: "2020-01-01T00:00:00Z" },
        { user_id: ME, id: KEY, label: "Test", created_at: "2026-11-19T10:00:00Z" },
      ],
    });
    expect(await readOwnAccountHolder(db, ME, KEY, "t")).toEqual({
      kind: "key",
      name: "Test",
      added_at: "2026-11-19T10:00:00Z",
      href: "/strategies",
    });
  });

  it("an older draft never hides a newer real strategy on the same key (review M-1)", async () => {
    // Rows in created_at order, the draft first, the way `.order(created_at)` returns them.
    const { db } = fakeDb({
      strategies: [
        { user_id: ME, api_key_id: KEY, id: "s-draft", name: "Draft", status: "draft" },
        { user_id: ME, api_key_id: KEY, id: "s-live", name: "Live Fund", status: "published" },
      ],
    });
    expect(await readOwnAccountHolder(db, ME, KEY, "t")).toMatchObject({ kind: "strategy", name: "Live Fund" });
  });

  it("names NOTHING when only a draft covers the key, because /strategies then shows no row for that key (review M-1)", async () => {
    const { db } = fakeDb({
      strategies: [{ user_id: ME, api_key_id: KEY, id: "s-draft", name: "Draft", status: "draft" }],
      api_keys: [{ user_id: ME, id: KEY, label: "Test", created_at: "2026-11-19T10:00:00Z" }],
    });
    expect(await readOwnAccountHolder(db, ME, KEY, "t")).toBeNull();
  });

  it("names nothing when only a draft COMPOSITE covers the key", async () => {
    const { db } = fakeDb({
      strategy_keys: [{ owner_id: ME, api_key_id: KEY, strategy_id: "s-comp" }],
      strategies: [{ user_id: ME, id: "s-comp", name: "Comp Draft", status: "draft" }],
      api_keys: [{ user_id: ME, id: KEY, label: "Test", created_at: "2026-11-19T10:00:00Z" }],
    });
    expect(await readOwnAccountHolder(db, ME, KEY, "t")).toBeNull();
  });

  it("scopes every read to the caller", async () => {
    const { db, reads } = fakeDb({
      api_keys: [{ user_id: ME, id: KEY, label: "Test", created_at: "2026-11-19T10:00:00Z" }],
    });
    await readOwnAccountHolder(db, ME, KEY, "t");
    expect(reads.map((r) => r.table)).toEqual(["strategies", "strategies", "strategy_keys", "api_keys"]);
    for (const r of reads) expect(r.filters.user_id ?? r.filters.owner_id).toBe(ME);
  });

  it("answers null and logs by code only when a read faults", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb({}, { strategies: { code: "42501", message: `secret ${KEY}` } });
    expect(await readOwnAccountHolder(db, ME, KEY, "t")).toBeNull();
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).toContain("42501");
    expect(logged).toContain("direct-strategy");
    expect(logged).not.toContain("secret");
    err.mockRestore();
  });

  it("answers null for a blank nickname rather than naming nothing", async () => {
    const { db } = fakeDb({ api_keys: [{ user_id: ME, id: KEY, label: "  ", created_at: "x" }] });
    expect(await readOwnAccountHolder(db, ME, KEY, "t")).toBeNull();
  });
});

describe("parseAccountHolder", () => {
  it("accepts a well-formed holder", () => {
    expect(parseAccountHolder({ kind: "key", name: "Test", added_at: "2026-11-19T10:00:00Z", href: "/strategies" })).toEqual({
      kind: "key",
      name: "Test",
      added_at: "2026-11-19T10:00:00Z",
      href: "/strategies",
    });
  });

  it.each([
    ["an absolute URL", { kind: "key", name: "T", href: "https://evil.example/x" }],
    ["a protocol-relative URL", { kind: "key", name: "T", href: "//evil.example" }],
    ["a javascript: URL", { kind: "key", name: "T", href: "javascript:alert(1)" }],
    ["a blank name", { kind: "key", name: " ", href: "/strategies" }],
    ["an unknown kind", { kind: "other", name: "T", href: "/strategies" }],
    ["null", null],
    ["a string", "x"],
  ])("rejects %s, because it becomes an href", (_label, raw) => {
    expect(parseAccountHolder(raw)).toBeNull();
  });
});

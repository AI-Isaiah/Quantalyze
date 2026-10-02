import { describe, it, expect } from "vitest";

import { DRAIN_MAX_PAGES, drainById } from "./drain-by-id";

/**
 * Phase 167.1.2 C3 / fix F (SFH-C3R2-X1) — the id-keyset drain.
 *
 * WHY these tests exist: PostgREST caps every response at `max_rows` (1000)
 * and answers 200 with a PARTIAL body, so a single read of a table holding
 * more rows silently loses the rest. The fake server below enforces that cap
 * on EVERY page (and a smaller one in one case), so a drain that stops after
 * one page, or on a "short" page, reads fewer rows than the table holds and
 * goes red.
 */

type Row = { id: number; k: string; date: string; v: number };

function isoDay(offsetDays: number): string {
  return new Date(Date.UTC(2022, 0, 1) + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

interface Server {
  table: Row[];
  /** The server-side cap on every response, like PostgREST `max_rows`. */
  cap: number;
  pages: number;
  /** Ignore the `id > afterId` cursor and always serve from the start. */
  ignoreCursor?: boolean;
  errorOnPage?: number;
  nullOnPage?: number;
  /** Runs after each page is answered (1-based), e.g. to write a row. */
  afterPage?: (page: number, table: Row[]) => void;
}

function serve(server: Server) {
  return (afterId: number | null, pageSize: number) => {
    server.pages += 1;
    const page = server.pages;
    if (server.errorOnPage === page) {
      return Promise.resolve({ data: null, error: { message: "boom" } });
    }
    if (server.nullOnPage === page) {
      return Promise.resolve({ data: null, error: null });
    }
    const rows = server.table
      .filter((r) => server.ignoreCursor || afterId === null || r.id > afterId)
      .sort((a, b) => a.id - b.id)
      .slice(0, Math.min(pageSize, server.cap))
      .map((r) => ({ ...r }));
    server.afterPage?.(page, server.table);
    return Promise.resolve({ data: rows, error: null });
  };
}

const naturalKey = (r: Row) => `${r.k}|${r.date}`;

describe("drainById", () => {
  it("reads every row past the 1000-row server cap, newest day included", async () => {
    // 2348 rows over two keys, stored in an order unrelated to id or date.
    const table: Row[] = [];
    let id = 0;
    for (let i = 0; i < 1174; i += 1) {
      table.push({ id: (id += 1), k: "key-b", date: isoDay(i), v: i });
      table.push({ id: (id += 1), k: "key-a", date: isoDay(i), v: -i });
    }
    table.reverse();
    const server: Server = { table, cap: 1000, pages: 0 };

    const res = await drainById({ label: "t", fetchPage: serve(server), naturalKey });

    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(2348);
    // Three full-or-partial pages, then the empty page that ends the drain.
    expect(server.pages).toBe(4);
    const newest = isoDay(1173);
    expect(res.data!.filter((r) => r.date === newest).map((r) => r.k)).toEqual([
      "key-a",
      "key-b",
    ]);
    // Sorted by natural key: every key-a row, date ascending, then key-b.
    expect(res.data![0]).toMatchObject({ k: "key-a", date: isoDay(0) });
    expect(res.data![1173]).toMatchObject({ k: "key-a", date: newest });
    expect(res.data![1174]).toMatchObject({ k: "key-b", date: isoDay(0) });
  });

  it("does not stop on a short page when the server cap is below the page size", async () => {
    const table: Row[] = Array.from({ length: 1200 }, (_, i) => ({
      id: i + 1,
      k: "key-a",
      date: isoDay(i),
      v: i,
    }));
    const server: Server = { table, cap: 300, pages: 0 };

    const res = await drainById({ label: "t", fetchPage: serve(server), naturalKey });

    expect(res.data).toHaveLength(1200);
    expect(server.pages).toBe(5);
  });

  it("collapses a row re-written mid-drain to its newer write, never twice", async () => {
    const table: Row[] = Array.from({ length: 1500 }, (_, i) => ({
      id: i + 1,
      k: "key-a",
      date: isoDay(i),
      v: i,
    }));
    const server: Server = {
      table,
      cap: 1000,
      pages: 0,
      // The writer's delete -> re-upsert of an ALREADY-READ day lands between
      // pages: the row comes back under a new, larger id with a new value.
      afterPage: (page, t) => {
        if (page !== 1) return;
        const idx = t.findIndex((r) => r.date === isoDay(10));
        t.splice(idx, 1);
        t.push({ id: 5000, k: "key-a", date: isoDay(10), v: 999 });
      },
    };

    const res = await drainById({ label: "t", fetchPage: serve(server), naturalKey });

    expect(res.data).toHaveLength(1500);
    const day10 = res.data!.filter((r) => r.date === isoDay(10));
    expect(day10).toEqual([{ id: 5000, k: "key-a", date: isoDay(10), v: 999 }]);
  });

  it("returns an ERROR, not a series, when the server ignores the cursor", async () => {
    const table: Row[] = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      k: "key-a",
      date: isoDay(i),
      v: i,
    }));
    const server: Server = { table, cap: 1000, pages: 0, ignoreCursor: true };

    const res = await drainById({ label: "csv_daily_returns", fetchPage: serve(server), naturalKey });

    expect(res.data).toBeNull();
    expect(res.error?.message).toMatch(/^csv_daily_returns: page 2 returned id 1, not strictly after 5$/);
  });

  it("carries a page error as a value", async () => {
    const table: Row[] = Array.from({ length: 1500 }, (_, i) => ({
      id: i + 1,
      k: "key-a",
      date: isoDay(i),
      v: i,
    }));
    const server: Server = { table, cap: 1000, pages: 0, errorOnPage: 2 };

    const res = await drainById({ label: "t", fetchPage: serve(server), naturalKey });

    expect(res.data).toBeNull();
    expect(res.error?.message).toBe("t: page 2 failed: boom");
    expect(res.error?.cause).toEqual({ message: "boom" });
  });

  it("treats a page with neither data nor an error as an ERROR, not the end", async () => {
    const table: Row[] = Array.from({ length: 1500 }, (_, i) => ({
      id: i + 1,
      k: "key-a",
      date: isoDay(i),
      v: i,
    }));
    const server: Server = { table, cap: 1000, pages: 0, nullOnPage: 2 };

    const res = await drainById({ label: "t", fetchPage: serve(server), naturalKey });

    expect(res.data).toBeNull();
    expect(res.error?.message).toBe("t: page 2 returned no data and no error");
  });

  it("refuses a row without an integer id", async () => {
    const fetchPage = () =>
      Promise.resolve({
        data: [{ id: "7" as unknown as number, k: "key-a", date: isoDay(0), v: 0 }],
        error: null,
      });

    const res = await drainById({ label: "t", fetchPage, naturalKey });

    expect(res.data).toBeNull();
    expect(res.error?.message).toBe("t: page 1 returned a row without an integer id");
  });

  it("returns an ERROR at the page ceiling instead of a partial read", async () => {
    let next = 0;
    // An endless table: every page is a fresh full page past the cursor.
    const fetchPage = (_afterId: number | null, pageSize: number) =>
      Promise.resolve({
        data: Array.from({ length: pageSize }, () => {
          next += 1;
          return { id: next, k: "key-a", date: `d${next}`, v: 0 };
        }),
        error: null,
      });

    const res = await drainById({ label: "t", fetchPage, naturalKey, pageSize: 2 });

    expect(res.data).toBeNull();
    expect(res.error?.message).toBe(
      `t: read exceeded ${DRAIN_MAX_PAGES} pages of 2 rows without an empty page`,
    );
    expect(next).toBe(DRAIN_MAX_PAGES * 2);
  });

  it("returns an empty series for an empty table after one request", async () => {
    const server: Server = { table: [], cap: 1000, pages: 0 };

    const res = await drainById({ label: "t", fetchPage: serve(server), naturalKey });

    expect(res).toEqual({ data: [], error: null });
    expect(server.pages).toBe(1);
  });
});

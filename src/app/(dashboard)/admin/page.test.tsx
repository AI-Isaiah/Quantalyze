/**
 * SFH-170-03 — a failed admin queue read must not render as an empty queue.
 *
 * Before the fix, `pendingStrategies.data ?? []` turned any PostgREST failure
 * (embed drift, a renamed FK, a timeout) into `[]`, and the Strategy Review tab
 * read "All caught up. No strategies pending review." while strategies sat in
 * `pending_review`. The page now reads each query's `error`, logs it with the
 * query name, and throws so `./error.tsx` renders the load-error state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const failing = vi.hoisted(() => ({ table: null as string | null }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`unexpected redirect to ${to}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "admin-1" } }, error: null }),
    },
  })),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: vi.fn(async () => true),
}));

// Self-returning query builder: every filter returns the builder, and the
// terminal `.returns()` resolves the result. The table named in
// `failing.table` resolves a PostgREST error with null data.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "order", "limit"]) {
        builder[method] = () => builder;
      }
      builder.returns = () =>
        Promise.resolve(
          table === failing.table
            ? {
                data: null,
                error: { code: "PGRST200", message: "embed not found" },
              }
            : { data: [], error: null },
        );
      return builder;
    },
  }),
}));

import AdminPage from "./page";

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  failing.table = null;
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("AdminPage queue reads", () => {
  it("throws, and logs the query name, when the pending-strategies query fails", async () => {
    failing.table = "strategies";
    await expect(AdminPage()).rejects.toThrow(/pendingStrategies query failed/);
    expect(errorSpy).toHaveBeenCalledWith(
      "[admin] pendingStrategies query failed",
      { code: "PGRST200", message: "embed not found" },
    );
  });

  it("throws when a sibling query (contact_requests) fails", async () => {
    failing.table = "contact_requests";
    await expect(AdminPage()).rejects.toThrow(/introRequests query failed/);
  });

  it("renders when every query succeeds", async () => {
    await expect(AdminPage()).resolves.toBeTruthy();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

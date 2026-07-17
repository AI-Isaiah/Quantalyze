/**
 * F-TESTGAP (pr-test-analyzer G1) — requireRolePage CALL-SITE wiring tests.
 *
 * `src/lib/auth/requireRolePage.ts` is exhaustively UNIT-tested
 * (requireRolePage.test.ts): all three branches, the role×surface matrix,
 * deny-by-default. What was NOT tested is the WIRING — the 7 surfaces that each
 * hard-code the `need` role argument. A swapped or dropped `need` ships green
 * because no test asserts the literal at the call site. This is exactly the
 * ROLE-02 mis-classification bug class that already bit `/portfolios` once
 * (project memory: "test the wiring, not just the helper; prove it fails when
 * neutered").
 *
 * Strategy: mock `requireRolePage` with a spy that THROWS a sentinel, halting
 * each layout/page right at the guard. This lets us assert ONLY the wiring (the
 * exact `need` literal each surface passes, and that the guard is invoked at
 * all) without mocking the entire downstream data/render tree of 7 surfaces.
 *
 * Neuter-proof: the assertion pins `call[2]` (the 3rd positional arg of
 * `requireRolePage(supabase, user, need)`) to the exact literal for each
 * surface. Swap `"manager"`→`"allocator"` in strategies/layout.tsx (or vice
 * versa on any allocator surface) and that surface's case fails. Drop the guard
 * entirely and the `rejects.toThrow(sentinel)` + `toHaveBeenCalledTimes(1)`
 * assertions fail (the body would run instead).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// server-only throws under vitest; several of these surfaces transitively import
// it (via @/lib/queries → @/lib/supabase/admin). No-op it.
vi.mock("server-only", () => ({}));

const GUARD_SENTINEL = "REQUIRE_ROLE_PAGE_INVOKED";

// The spy stands in for the real guard. It records its args, then throws so the
// surface's body (and its data fetching / render) never executes — the wiring is
// all this test cares about.
const requireRoleSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/requireRolePage", () => ({
  requireRolePage: (...args: unknown[]) => {
    requireRoleSpy(...args);
    throw new Error(GUARD_SENTINEL);
  },
}));

// redirect() must never fire on these cases (the user exists and the guard
// throws first) — spy it so an accidental pre-guard redirect is observable.
const redirectSpy = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: redirectSpy,
}));

// An authenticated user so each surface passes its `if (!user) redirect(...)`
// pre-check and reaches the role guard. The ROLE the profile would carry is
// irrelevant here — the real guard is mocked out; we assert the `need` the
// surface REQUESTS, not the outcome of the comparison.
const MOCK_USER = { id: "wiring-test-user", email: "wiring@test.sec" };
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: MOCK_USER },
        error: null,
      })),
    },
    // Not reached: the guard throws before any surface queries a table.
    from: vi.fn(() => {
      throw new Error("no table query should run before the role guard");
    }),
  })),
}));

type Surface = {
  label: string;
  need: "manager" | "allocator";
  invoke: () => Promise<unknown>;
};

// The 7 guarded surfaces + their hard-coded `need`. Each `invoke` dynamically
// imports the module (so vi.mock hoisting applies) and calls its default export.
// Layouts take `{ children }`; pages take no args (or an unused searchParams).
const SURFACES: Surface[] = [
  {
    label: "strategies/layout",
    need: "manager",
    invoke: async () => {
      const mod = await import("./strategies/layout");
      return (mod.default as (p: { children: React.ReactNode }) => unknown)({
        children: null,
      });
    },
  },
  {
    label: "portfolios/layout",
    need: "allocator",
    invoke: async () => {
      const mod = await import("./portfolios/layout");
      return (mod.default as (p: { children: React.ReactNode }) => unknown)({
        children: null,
      });
    },
  },
  {
    label: "discovery/layout",
    need: "allocator",
    invoke: async () => {
      const mod = await import("./discovery/layout");
      return (mod.default as (p: { children: React.ReactNode }) => unknown)({
        children: null,
      });
    },
  },
  {
    label: "recommendations/page",
    need: "allocator",
    invoke: async () => {
      const mod = await import("./recommendations/page");
      return (mod.default as () => unknown)();
    },
  },
  {
    label: "decks/page",
    need: "allocator",
    invoke: async () => {
      const mod = await import("./decks/page");
      return (mod.default as () => unknown)();
    },
  },
  {
    label: "allocations/page",
    need: "allocator",
    invoke: async () => {
      const mod = await import("./allocations/page");
      return (mod.default as () => unknown)();
    },
  },
  {
    label: "compare/page",
    need: "allocator",
    invoke: async () => {
      const mod = await import("./compare/page");
      return (
        mod.default as (p: {
          searchParams: Promise<Record<string, string>>;
        }) => unknown
      )({ searchParams: Promise.resolve({}) });
    },
  },
];

describe("requireRolePage call-site wiring (F-TESTGAP G1)", () => {
  beforeEach(() => {
    requireRoleSpy.mockClear();
    redirectSpy.mockClear();
  });

  it.each(SURFACES)(
    "$label invokes the guard exactly once with need='$need' (neuter-proof)",
    async ({ need, invoke }) => {
      // The guard throws the sentinel, so the surface rejects right at the guard
      // — proving the guard is WIRED (a dropped guard would let the body run and
      // resolve/throw something else).
      await expect(invoke()).rejects.toThrow(GUARD_SENTINEL);

      expect(requireRoleSpy).toHaveBeenCalledTimes(1);
      const call = requireRoleSpy.mock.calls[0];
      // requireRolePage(supabase, user, need) — arg[2] is the surface's
      // hard-coded role. This is the byte that a ROLE-02-class mis-edit would
      // flip; pin it exactly.
      expect(call[2]).toBe(need);
      // Defence-in-depth: the guard received the SESSION user (arg[1]), not some
      // client-supplied identity, and a real supabase client (arg[0]).
      expect(call[1]).toEqual(MOCK_USER);
      expect(call[0]).toBeTruthy();
      // No pre-guard redirect fired (the authenticated user reached the guard).
      expect(redirectSpy).not.toHaveBeenCalled();
    },
  );
});

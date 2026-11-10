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
 * surface. Swap `"manager"`→`"allocator"` in strategies/new/layout.tsx (or vice
 * versa on any allocator surface) and that surface's case fails. Drop the guard
 * entirely and the `rejects.toThrow(sentinel)` + `toHaveBeenCalledTimes(1)`
 * assertions fail (the body would run instead).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// server-only throws under vitest; several of these surfaces transitively import
// it (via @/lib/queries → @/lib/supabase/admin). No-op it.
vi.mock("server-only", () => ({}));

const GUARD_SENTINEL = "REQUIRE_ROLE_PAGE_INVOKED";

// The spy stands in for the real guard. It records its args, then throws so the
// surface's body (and its data fetching / render) never executes — the wiring is
// all this test cares about.
const requireRoleSpy = vi.hoisted(() => vi.fn());

// Phase 199 plan 04 — the two new segment-guard layouts (strategies/new,
// strategies/[id]) are also driven through the REAL guard, so the allocator /
// both / read-error outcomes are proven at the layout and not only the `need`
// literal. `harness.real` switches the mock between "spy and halt" (every
// wiring case) and "delegate to the real requireRolePage" (the outcome cases);
// `harness.profile` is the profiles row the real guard would read.
const harness = vi.hoisted(() => ({
  real: false,
  profile: { data: null, error: null } as {
    data: { role: string } | null;
    error: { code: string; message: string } | null;
  },
}));
vi.mock("@/lib/auth/requireRolePage", async () => ({
  requireRolePage: async (...args: unknown[]) => {
    requireRoleSpy(...args);
    if (harness.real) {
      const actual = await vi.importActual<
        typeof import("@/lib/auth/requireRolePage")
      >("@/lib/auth/requireRolePage");
      return (actual.requireRolePage as (...a: unknown[]) => Promise<void>)(
        ...args,
      );
    }
    throw new Error(GUARD_SENTINEL);
  },
}));

// The real guard reports a DB error to Sentry; keep that off the network.
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

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
    // Spy mode: not reached, the guard throws before any surface queries a
    // table. Real mode: serves the profiles row the guard selects `role` from.
    from: vi.fn(() => {
      if (!harness.real) {
        throw new Error("no table query should run before the role guard");
      }
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => harness.profile }),
        }),
      };
    }),
  })),
}));

type Surface = {
  label: string;
  need: "manager" | "allocator";
  invoke: () => Promise<unknown>;
};

// The guarded surfaces + their hard-coded `need` (strategies/layout is not one: see the negative case below). Each `invoke` dynamically
// imports the module (so vi.mock hoisting applies) and calls its default export.
// Layouts take `{ children }`; pages take no args (or an unused searchParams).
const SURFACES: Surface[] = [
  {
    // Phase 199 plan 04 (D-01, CD-10) — the sub-routes carry their own manager
    // guard so the index can widen alone: /strategies/new + /strategies/new/wizard.
    label: "strategies/new/layout",
    need: "manager",
    invoke: async () => {
      const mod = await import("./strategies/new/layout");
      return (mod.default as (p: { children: React.ReactNode }) => unknown)({
        children: null,
      });
    },
  },
  {
    // Phase 199 plan 04 (D-01) — /strategies/[id]/edit.
    label: "strategies/[id]/layout",
    need: "manager",
    invoke: async () => {
      const mod = await import("./strategies/[id]/layout");
      return (mod.default as (p: { children: React.ReactNode }) => unknown)({
        children: null,
        params: Promise.resolve({ id: "wiring-test-strategy" }),
      } as { children: React.ReactNode });
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

// Phase 199 plan 09 (D-01, T-199-29) — the NEGATIVE case. `strategies/layout`
// guards nothing any more: the /strategies index admits allocators, managers and
// `both`, and the sub-routes are guarded by their own layouts (cases above). A
// restored `requireRolePage` call here would bounce an allocator off the index
// and, in spy mode, would throw the sentinel; the supabase double also throws on
// any table read, so a role lookup in this layout is observable too.
describe("strategies/layout is a negative case: no guard, no redirect, no role read (199-09)", () => {
  beforeEach(() => {
    requireRoleSpy.mockClear();
    redirectSpy.mockClear();
  });

  it("renders its children without calling requireRolePage or redirecting", async () => {
    const mod = await import("./strategies/layout");
    const out = (await (
      mod.default as (p: { children: React.ReactNode }) => Promise<unknown>
    )({ children: "CHILDREN" })) as { props: { children: string } };
    expect(out.props.children).toBe("CHILDREN");
    expect(requireRoleSpy).not.toHaveBeenCalled();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it("still sends a signed-out visitor to /login (the session check stays)", async () => {
    const server = await import("@/lib/supabase/server");
    vi.mocked(server.createClient).mockResolvedValueOnce({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as unknown as Awaited<ReturnType<typeof server.createClient>>);
    redirectSpy.mockImplementationOnce((href: string) => {
      throw new Error(`NEXT_REDIRECT:${href}`);
    });
    const mod = await import("./strategies/layout");
    await expect(
      (mod.default as (p: { children: React.ReactNode }) => Promise<unknown>)({
        children: null,
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/login?redirect=/strategies");
    expect(requireRoleSpy).not.toHaveBeenCalled();
  });
});

// Phase 199 plan 04 (D-01, CD-10, T-199-12) — OUTCOMES of the new segment
// guards, through the real requireRolePage. The wiring cases above pin the
// `need` literal; these prove what a visitor actually gets: an allocator is
// bounced to /allocations, a `both` owner and a manager render, and a profile
// read error throws instead of bouncing or rendering (a Postgres hiccup is not a
// demotion). redirect() is made to throw NEXT_REDIRECT here, as in Next 16.
const NEW_GUARD_LAYOUTS: Array<{
  label: string;
  invoke: () => Promise<unknown>;
}> = [
  {
    label: "strategies/new/layout",
    invoke: async () => {
      const mod = await import("./strategies/new/layout");
      return (
        mod.default as (p: { children: React.ReactNode }) => Promise<unknown>
      )({ children: "CHILDREN" });
    },
  },
  {
    label: "strategies/[id]/layout",
    invoke: async () => {
      const mod = await import("./strategies/[id]/layout");
      return (
        mod.default as (p: { children: React.ReactNode }) => Promise<unknown>
      )({ children: "CHILDREN" });
    },
  },
];

describe("new strategies segment guards - real guard outcomes (199-04)", () => {
  beforeEach(() => {
    requireRoleSpy.mockClear();
    redirectSpy.mockReset();
    redirectSpy.mockImplementation((href: string) => {
      throw new Error(`NEXT_REDIRECT:${href}`);
    });
    harness.real = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    harness.real = false;
    harness.profile = { data: null, error: null };
    vi.restoreAllMocks();
  });

  describe.each(NEW_GUARD_LAYOUTS)("$label", ({ invoke }) => {
    it("bounces an allocator to /allocations (never renders children)", async () => {
      harness.profile = { data: { role: "allocator" }, error: null };
      await expect(invoke()).rejects.toThrow("NEXT_REDIRECT:/allocations");
    });

    it("renders children for a manager", async () => {
      harness.profile = { data: { role: "manager" }, error: null };
      const out = (await invoke()) as { props: { children: string } };
      expect(out.props.children).toBe("CHILDREN");
      expect(redirectSpy).not.toHaveBeenCalled();
    });

    it("renders children for role 'both'", async () => {
      harness.profile = { data: { role: "both" }, error: null };
      const out = (await invoke()) as { props: { children: string } };
      expect(out.props.children).toBe("CHILDREN");
      expect(redirectSpy).not.toHaveBeenCalled();
    });

    it("throws on a profile read error and never redirects", async () => {
      harness.profile = {
        data: null,
        error: { code: "XX000", message: "db down" },
      };
      await expect(invoke()).rejects.toMatchObject({ code: "XX000" });
      expect(redirectSpy).not.toHaveBeenCalled();
    });
  });
});

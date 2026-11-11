/**
 * TODOS `197-STRATEGY-NAME-PSEUDONYM-01` close-condition test, browse half
 * (Phase 201 plan 02, D-09 / D-17: "Real name everywhere").
 *
 * Before 201: compare's "Add strategy" searched a catalogue whose `name` was the
 * codename for every exploratory row, so typing a strategy's real name found
 * nothing. The label is now decided by whether the viewer can see the strategy in
 * discovery, and this test pins the whole chain: the browse route's REAL handler
 * output (mocked supabase, as route.test.ts mocks it) is fed to `CompareAddStrategy`
 * as `fetchStrategies`, then a user types.
 *
 * It must go RED if the pseudonym returns (the route labels a visible strategy by
 * its codename again), and it must go RED the other way if a strategy the viewer
 * cannot see in discovery is ever named: the second arm searches such a row's real
 * name and expects no option.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextRequest } from "next/server";

// The route's supabase server module imports "server-only", which throws under vitest.
vi.mock("server-only", () => ({}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";

const FIXTURE = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "00000000-0000-0000-0000-000000000001", email: "alloc@test.sec" } },
        error: null,
      }),
    },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { role: "allocator" }, error: null }),
            }),
          }),
        };
      }
      if (table !== "strategies") {
        throw new Error(`unexpected from(${table}) on user-scoped client`);
      }
      // The PostgREST chain the route builds: select -> or -> order -> limit.
      const builder = {
        select: () => builder,
        or: () => builder,
        order: () => builder,
        limit: async (n: number) => ({ data: FIXTURE.rows.slice(0, n), error: null }),
      };
      return builder;
    },
  }),
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: { __mock: "userActionLimiter" },
  checkLimit: async () => ({ success: true, retryAfter: 0 }),
}));

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

import { CompareAddStrategy, type Catalogue } from "./CompareAddStrategy";

afterEach(() => {
  cleanup();
  push.mockClear();
  FIXTURE.rows = [];
});

/** Run the browse route's real handler and hand its JSON to the component's seam. */
async function catalogueFromRoute(): Promise<Catalogue> {
  const { GET } = await import("@/app/api/strategies/browse/route");
  const res = await GET(
    new NextRequest("http://localhost:3000/api/strategies/browse", {
      method: "GET",
      headers: { origin: "http://localhost:3000" },
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  return { rows: body.strategies, hasMore: body.has_more === true, limit: body.limit };
}

const setup = () => {
  const user = userEvent.setup();
  render(<CompareAddStrategy currentIds={[]} fetchStrategies={catalogueFromRoute} />);
  return { user, input: screen.getByRole("combobox", { name: "Add strategy" }) };
};

describe("CompareAddStrategy fed by the browse route (D-09, D-17)", () => {
  it("finds a published exploratory strategy by its REAL name, and still by its codename", async () => {
    FIXTURE.rows = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        user_id: OTHER_OWNER,
        status: "published",
        name: "Fibonacci Ghost",
        codename: "Ghost-7",
        disclosure_tier: "exploratory",
        markets: ["crypto"],
        strategy_types: ["systematic"],
        is_example: false,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    const { user, input } = setup();

    await user.type(input, "Fib");
    // The option is NAMED by the real name. With the pseudonym back the label is
    // "Ghost-7" and this option cannot be found.
    expect(await screen.findByRole("option", { name: /Fibonacci Ghost/ })).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "Ghost-7");
    // D-17: the codename stays on the wire and the search still matches it.
    expect(await screen.findByRole("option", { name: /Fibonacci Ghost/ })).toBeInTheDocument();
  });

  it("never finds a strategy the viewer cannot see in discovery by its real name", async () => {
    // A row another owner has not published. RLS and the browse predicate keep it
    // out of the response; the mock models a dropped predicate so the route's own
    // per-row guard is what is under test. Its real name must not be on the wire.
    FIXTURE.rows = [
      {
        id: "44444444-4444-4444-8444-444444444444",
        user_id: OTHER_OWNER,
        status: "draft",
        name: "Zeppelin Secret Book",
        codename: "Phantom-2",
        disclosure_tier: "exploratory",
        markets: ["fx"],
        strategy_types: ["macro"],
        is_example: false,
        created_at: "2026-01-02T00:00:00Z",
      },
    ];
    const { user, input } = setup();

    await user.type(input, "Zepp");
    // The catalogue has loaded (a no-match line, not "Searching…") and offers nothing.
    expect(await screen.findByText(/No published strategy matches "Zepp"/)).toBeInTheDocument();
    expect(screen.queryByRole("option")).toBeNull();
    expect(JSON.stringify((await catalogueFromRoute()).rows)).not.toContain("Zeppelin");

    // Its codename is the only handle the viewer has, and it finds the row under
    // that label, never under the real name.
    await user.clear(input);
    await user.type(input, "Phantom");
    expect(await screen.findByRole("option", { name: /Phantom-2/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Zeppelin/ })).toBeNull();
  });
});

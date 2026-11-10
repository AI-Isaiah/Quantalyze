/**
 * Phase 199 MANAGERHOME (ROUTE-01, CD-07) - the landing page sends a signed-in
 * visitor to the role-home route, never to a fixed surface.
 *
 * Fails when: a signed-in visit to `/` redirects anywhere but /home (for
 * example back to Discovery, which would land an allocator or a manager on a
 * page that is not theirs), or a signed-out visit redirects at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));

let sessionUser: { id: string } | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.not = () => chain;
    chain.then = (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ count: 0, data: [], error: null }).then(onFulfilled);
    return {
      auth: { getUser: async () => ({ data: { user: sessionUser } }) },
      from: () => chain,
    };
  },
}));

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

import Home from "./page";

beforeEach(() => {
  redirectMock.mockClear();
  sessionUser = null;
});

describe("landing page redirect", () => {
  it("sends a signed-in visitor to /home", async () => {
    sessionUser = { id: "user-1" };
    await expect(Home()).rejects.toThrow("NEXT_REDIRECT:/home");
  });

  it("does not redirect a signed-out visitor", async () => {
    await Home();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

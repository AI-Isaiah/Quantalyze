/**
 * Phase 170.1.1 D-06 — the /strategies/[id]/edit tab title. No user, a missing
 * row or a read error gives the neutral "Edit strategy" (never the id), and a
 * read error is captured rather than swallowed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  result: null as { data: unknown; error: unknown } | null,
}));
const captureToSentryMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: captureToSentryMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
    from: () => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq"]) {
        builder[method] = () => builder;
      }
      builder.maybeSingle = () => Promise.resolve(state.result);
      return builder;
    },
  })),
}));

import { generateMetadata } from "./page";

const params = Promise.resolve({ id: "4f1c2b7e-9a3d-4e5f-8a6b-0c1d2e3f4a5b" });

beforeEach(() => {
  state.user = { id: "user-1" };
  state.result = null;
  captureToSentryMock.mockClear();
});

describe("/strategies/[id]/edit generateMetadata", () => {
  it("names the strategy", async () => {
    state.result = { data: { name: "Alpha" }, error: null };
    expect((await generateMetadata({ params })).title).toBe("Edit: Alpha");
  });

  it("falls back to Edit strategy for a signed-out caller, without a capture", async () => {
    state.user = null;
    expect((await generateMetadata({ params })).title).toBe("Edit strategy");
    expect(captureToSentryMock).not.toHaveBeenCalled();
  });

  it("falls back to Edit strategy on a read error and captures it", async () => {
    state.result = { data: null, error: { message: "boom" } };
    expect((await generateMetadata({ params })).title).toBe("Edit strategy");
    expect(captureToSentryMock).toHaveBeenCalledTimes(1);
    expect(captureToSentryMock.mock.calls[0][0]).toEqual(new Error("boom"));
  });
});

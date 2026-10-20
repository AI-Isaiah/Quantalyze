/**
 * Phase 170.1.1 D-06 — the /discovery/[slug]/[strategyId] tab title. A read
 * error or a missing (unpublished) row gives the neutral "Strategy", never an
 * id, and a read error is captured rather than swallowed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const read = vi.hoisted(() => ({
  result: null as { data: unknown; error: unknown } | null,
}));
const captureToSentryMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: captureToSentryMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq"]) {
        builder[method] = () => builder;
      }
      builder.maybeSingle = () => Promise.resolve(read.result);
      return builder;
    },
  })),
}));

import { generateMetadata } from "./page";

const params = Promise.resolve({
  slug: "alpha",
  strategyId: "4f1c2b7e-9a3d-4e5f-8a6b-0c1d2e3f4a5b",
});

beforeEach(() => {
  read.result = null;
  captureToSentryMock.mockClear();
});

describe("/discovery/[slug]/[strategyId] generateMetadata", () => {
  it("names the strategy", async () => {
    read.result = {
      data: {
        id: "4f1c2b7e-9a3d-4e5f-8a6b-0c1d2e3f4a5b",
        name: "Alpha Fund",
        codename: null,
        disclosure_tier: "institutional",
      },
      error: null,
    };
    expect((await generateMetadata({ params })).title).toBe("Alpha Fund");
  });

  it("falls back to Strategy when no published row is visible, without a capture", async () => {
    read.result = { data: null, error: null };
    const meta = await generateMetadata({ params });
    expect(meta.title).toBe("Strategy");
    expect(String(meta.title)).not.toContain("4f1c");
    expect(captureToSentryMock).not.toHaveBeenCalled();
  });

  it("falls back to Strategy on a read error and captures it", async () => {
    read.result = { data: null, error: { message: "boom" } };
    const meta = await generateMetadata({ params });
    expect(meta.title).toBe("Strategy");
    expect(captureToSentryMock).toHaveBeenCalledTimes(1);
    expect(captureToSentryMock.mock.calls[0][0]).toEqual(new Error("boom"));
  });
});

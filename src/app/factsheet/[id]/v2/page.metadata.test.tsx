/** @vitest-environment jsdom */
/**
 * Phase 170.1.1 D-06 — the factsheet tab title. A read error is captured rather
 * than swallowed into the "Strategy factsheet" fallback, and a plain miss is not.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const read = vi.hoisted(() => ({
  result: null as { data: unknown; error: unknown } | null,
}));
const captureToSentryMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: captureToSentryMock }));
vi.mock("next/navigation", () => ({ notFound: () => undefined }));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => Promise<unknown>) => fn,
}));
vi.mock("@/lib/visibility", () => ({
  withPublishedOnly: (qb: unknown) => qb,
  withPublishedOrOwner: (qb: unknown) => qb,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/queries", () => ({ readPublicVerificationSignals: vi.fn() }));
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

const params = Promise.resolve({ id: "51a10001-0000-4000-8000-0000000000f1" });

beforeEach(() => {
  read.result = null;
  captureToSentryMock.mockClear();
});

describe("/factsheet/[id]/v2 generateMetadata", () => {
  it("names the strategy", async () => {
    read.result = {
      data: { id: "s1", name: "Alpha", codename: null, disclosure_tier: "exploratory" },
      error: null,
    };
    expect((await generateMetadata({ params })).title).toBe("Alpha factsheet");
    expect(captureToSentryMock).not.toHaveBeenCalled();
  });

  it("falls back to the neutral title on a miss, without a capture", async () => {
    read.result = { data: null, error: null };
    expect((await generateMetadata({ params })).title).toBe("Strategy factsheet");
    expect(captureToSentryMock).not.toHaveBeenCalled();
  });

  it("falls back to the neutral title on a read error and captures it", async () => {
    read.result = { data: null, error: { message: "boom" } };
    expect((await generateMetadata({ params })).title).toBe("Strategy factsheet");
    expect(captureToSentryMock).toHaveBeenCalledTimes(1);
    expect(captureToSentryMock.mock.calls[0][0]).toEqual(new Error("boom"));
    expect(captureToSentryMock.mock.calls[0][1]).toEqual({
      tags: { route: "factsheet/[id]/v2/page", stage: "generate-metadata" },
    });
  });
});

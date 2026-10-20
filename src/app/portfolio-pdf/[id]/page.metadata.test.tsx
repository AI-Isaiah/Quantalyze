/** @vitest-environment jsdom */
/**
 * Phase 170.1.1 D-06 — the portfolio PDF tab title. A miss or a read error gives
 * "Portfolio report" (never "Portfolio portfolio report"), and an error is
 * captured rather than swallowed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const read = vi.hoisted(() => ({
  result: null as { data: unknown; error: unknown } | null,
}));
const captureToSentryMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: captureToSentryMock }));
vi.mock("@/lib/pdf-render-token", () => ({ verifyPdfRenderToken: () => true }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq"]) {
        builder[method] = () => builder;
      }
      builder.single = () => Promise.resolve(read.result);
      return builder;
    },
  }),
}));

import { generateMetadata } from "./page";

const args = {
  params: Promise.resolve({ id: "4f1c2b7e-9a3d-4e5f-8a6b-0c1d2e3f4a5b" }),
  searchParams: Promise.resolve({ renderToken: "t" }),
};

beforeEach(() => {
  read.result = null;
  captureToSentryMock.mockClear();
});

describe("/portfolio-pdf/[id] generateMetadata", () => {
  it("names the portfolio", async () => {
    read.result = { data: { name: "Core Book" }, error: null };
    expect((await generateMetadata(args)).title).toBe("Core Book portfolio report");
    expect(captureToSentryMock).not.toHaveBeenCalled();
  });

  it("falls back to Portfolio report on a miss, without a capture", async () => {
    read.result = { data: null, error: null };
    expect((await generateMetadata(args)).title).toBe("Portfolio report");
    expect(captureToSentryMock).not.toHaveBeenCalled();
  });

  it("falls back to Portfolio report on a read error and captures it", async () => {
    read.result = { data: null, error: { message: "boom" } };
    expect((await generateMetadata(args)).title).toBe("Portfolio report");
    expect(captureToSentryMock).toHaveBeenCalledTimes(1);
    expect(captureToSentryMock.mock.calls[0][0]).toEqual(new Error("boom"));
    expect(captureToSentryMock.mock.calls[0][1]).toEqual({
      tags: { route: "portfolio-pdf/[id]/page", stage: "generate-metadata" },
    });
  });
});

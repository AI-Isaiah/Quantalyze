/**
 * Phase 170.1.1 D-06 — the /portfolios/[id]/documents tab title. An error or a
 * missing row gives the neutral "Documents" (never the id), and an error is
 * captured rather than swallowed.
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

const params = Promise.resolve({ id: "4f1c2b7e-9a3d-4e5f-8a6b-0c1d2e3f4a5b" });

beforeEach(() => {
  read.result = null;
  captureToSentryMock.mockClear();
});

describe("/portfolios/[id]/documents generateMetadata", () => {
  it("names the portfolio", async () => {
    read.result = { data: { name: "Core Book" }, error: null };
    expect((await generateMetadata({ params })).title).toBe(
      "Documents for Core Book",
    );
  });

  it("falls back to Documents when no row is visible, without a capture", async () => {
    read.result = { data: null, error: null };
    expect((await generateMetadata({ params })).title).toBe("Documents");
    expect(captureToSentryMock).not.toHaveBeenCalled();
  });

  it("falls back to Documents on a read error and captures it", async () => {
    read.result = { data: null, error: { message: "boom" } };
    expect((await generateMetadata({ params })).title).toBe("Documents");
    expect(captureToSentryMock).toHaveBeenCalledTimes(1);
    expect(captureToSentryMock.mock.calls[0][0]).toEqual(new Error("boom"));
  });
});

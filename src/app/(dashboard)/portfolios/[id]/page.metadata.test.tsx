/**
 * Phase 170.1.1 D-06 / T-170.1.1-06 — the portfolio tab title is the portfolio
 * name the H1 shows, and a read error or a missing row yields a fixed fallback
 * and never the id, so a bookmarked or shared URL cannot leak an id into a tab.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const read = vi.hoisted(() => ({
  result: null as { data: unknown; error: unknown } | null,
}));

// The page module pulls `@/lib/queries`, which imports `server-only`.
vi.mock("server-only", () => ({}));

// Self-returning query builder: every filter returns the builder and the
// terminal `.maybeSingle()` resolves the configured result.
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

// A read error is reported, not only given a neutral title.
const captureToSentryMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: captureToSentryMock }));

import { generateMetadata } from "./page";

const PORTFOLIO_ID = "4f1c2b7e-9a3d-4e5f-8a6b-0c1d2e3f4a5b";

beforeEach(() => {
  read.result = null;
  captureToSentryMock.mockClear();
});

describe("portfolio tab title", () => {
  it("is the portfolio name the H1 shows", async () => {
    read.result = { data: { name: "Core Book" }, error: null };
    const meta = await generateMetadata({
      params: Promise.resolve({ id: PORTFOLIO_ID }),
    });
    expect(meta.title).toBe("Core Book");
  });

  it("falls back to 'Portfolio', never the id, when the read errors, and captures it", async () => {
    read.result = {
      data: null,
      error: { code: "PGRST301", message: "JWT expired" },
    };
    const meta = await generateMetadata({
      params: Promise.resolve({ id: PORTFOLIO_ID }),
    });
    expect(meta.title).toBe("Portfolio");
    expect(String(meta.title)).not.toContain("4f1c");
    expect(captureToSentryMock).toHaveBeenCalledTimes(1);
    expect(captureToSentryMock.mock.calls[0][0]).toEqual(new Error("JWT expired"));
  });

  it("falls back to 'Portfolio', never the id, when no row is visible", async () => {
    read.result = { data: null, error: null };
    const meta = await generateMetadata({
      params: Promise.resolve({ id: PORTFOLIO_ID }),
    });
    expect(meta.title).toBe("Portfolio");
    expect(String(meta.title)).not.toContain("4f1c");
    expect(captureToSentryMock).not.toHaveBeenCalled();
  });
});

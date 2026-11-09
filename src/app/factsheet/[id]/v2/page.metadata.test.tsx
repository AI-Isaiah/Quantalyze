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

  // Phase 196 D-07 (LEAN-02): the factsheet is the ONE indexable strategy page, so
  // the 308s from the indexable /browse and /strategy routes land on a page a
  // crawler may keep. Only the PUBLISHED-ONLY probe finding the row opens the
  // index. A miss (unpublished, or not there) and a failed probe must keep
  // noindex: a probe that cannot say whether the row is published must never be
  // read as "published", or an outage would index private drafts.
  it("a published strategy (the published-only probe returns the row) is indexable: no robots key", async () => {
    read.result = {
      data: { id: "s1", name: "Alpha", codename: null, disclosure_tier: "exploratory" },
      error: null,
    };
    const meta = await generateMetadata({ params });
    expect(meta.robots).toBeUndefined();
    expect("robots" in meta).toBe(false);
  });

  it("a miss (unpublished or missing) keeps noindex", async () => {
    read.result = { data: null, error: null };
    expect((await generateMetadata({ params })).robots).toBe("noindex");
  });

  it("a probe error keeps noindex, even when the driver also hands back a row", async () => {
    read.result = { data: null, error: { message: "boom" } };
    expect((await generateMetadata({ params })).robots).toBe("noindex");
    read.result = {
      data: { id: "s1", name: "Alpha", codename: null, disclosure_tier: "exploratory" },
      error: { message: "boom" },
    };
    expect((await generateMetadata({ params })).robots).toBe("noindex");
  });

  // WR-02 / TODOS 196-CANONICAL-LINK-01: D-07 made the published factsheet
  // indexable, and the 308s from /browse and /strategy land on it with `from`
  // and `cat`; the share link adds `?share=1`, and /v2 renders the same page.
  // Without a canonical every variant is an indexable duplicate. The repo sets
  // no metadataBase, so the canonical is absolute, on the origin the app asserts
  // as canonical at build time (NEXT_PUBLIC_APP_URL).
  describe("canonical link", () => {
    it("a published strategy canonicalises to the bare /factsheet/<id> on the app origin", async () => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
      read.result = {
        data: { id: "s1", name: "Alpha", codename: null, disclosure_tier: "exploratory" },
        error: null,
      };
      const meta = await generateMetadata({ params });
      expect(meta.alternates?.canonical).toBe(
        "https://app.example.test/factsheet/51a10001-0000-4000-8000-0000000000f1",
      );
      vi.unstubAllEnvs();
    });

    it.each([
      ["a miss", { data: null, error: null }],
      ["a probe error", { data: null, error: { message: "boom" } }],
    ])("%s carries no canonical (the noindex lanes stay canonical-free)", async (_label, result) => {
      read.result = result;
      const meta = await generateMetadata({ params });
      expect(meta.robots).toBe("noindex");
      expect(meta.alternates).toBeUndefined();
    });
  });
});

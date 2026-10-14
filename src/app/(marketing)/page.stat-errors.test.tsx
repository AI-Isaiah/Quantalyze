/**
 * Phase 170.6.1.1 (ANONKEYID) review round 1 - SFH-3.
 *
 * The landing page's three social-proof stats are read anonymously. Before this
 * fix every query's `error` was dropped and the `catch` logged nothing, so a
 * 42501 after PR-B's grant revoke turned each stat into a plausible-looking 0
 * with no signal anywhere. The contract: an errored stat is reported to Sentry
 * and renders the page's existing "no value" dash; the page itself still
 * renders (a vanity stat must not take the marketing page down); a stat that
 * was read successfully is untouched.
 *
 * Fixture values (7 strategies, AUM 1.5M + 2.5M, 3 intros) are typed in by hand.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

type Result = { count?: number | null; data?: unknown; error: { code: string; message: string } | null };

const seeded = vi.hoisted(() => ({
  strategiesCount: null as unknown,
  contactCount: null as unknown,
  aum: null as unknown,
  sentry: [] as Array<{ err: unknown; opts: unknown }>,
}));

vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (err: unknown, opts: unknown) => {
    seeded.sentry.push({ err, opts });
  },
}));

vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
}));

vi.mock("@/components/landing/VerificationSection", () => ({
  VerificationSection: () => null,
}));

// withPublishedOnly is applied to a thenable; the mock builder is its own thenable.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: (table: string) => {
      let kind: "strategiesCount" | "contactCount" | "aum" = "aum";
      const chain: Record<string, unknown> = {};
      chain.select = (_cols: string, opts?: { count?: string; head?: boolean }) => {
        if (table === "contact_requests") kind = "contactCount";
        else kind = opts?.head ? "strategiesCount" : "aum";
        return chain;
      };
      chain.eq = () => chain;
      chain.not = () => chain;
      chain.then = (onFulfilled: (v: Result) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(seeded[kind] as Result).then(onFulfilled, onRejected);
      return chain;
    },
  }),
}));

import Home from "./page";

const DENIED = { code: "42501", message: "permission denied for table strategies" };

async function renderHome() {
  render(await Home());
}

function statValue(label: string): string {
  const caption = screen.getByText(label);
  return caption.previousElementSibling?.textContent ?? "";
}

beforeEach(() => {
  seeded.sentry = [];
  seeded.strategiesCount = { count: 7, error: null };
  seeded.contactCount = { count: 3, error: null };
  seeded.aum = { data: [{ aum: 1_500_000 }, { aum: 2_500_000 }], error: null };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("landing social-proof stats", () => {
  it("renders every stat and reports nothing when all three reads succeed", async () => {
    await renderHome();
    expect(statValue("Verified strategies")).toBe("7+");
    expect(statValue("AUM tracked")).toBe("$4.0M");
    expect(statValue("Introductions made")).toBe("3+");
    expect(seeded.sentry).toHaveLength(0);
  });

  it("reports a strategies-count 42501 to Sentry, shows the dash, and keeps the other stats", async () => {
    seeded.strategiesCount = { count: null, error: DENIED };
    await renderHome();
    expect(statValue("Verified strategies")).toBe("—");
    expect(statValue("AUM tracked")).toBe("$4.0M");
    expect(statValue("Introductions made")).toBe("3+");
    expect(seeded.sentry).toHaveLength(1);
    expect(seeded.sentry[0].opts).toEqual({
      tags: { op: "getSocialProofStats", stat: "strategies", code: "42501" },
      level: "error",
    });
  });

  it("reports an AUM read 42501 to Sentry and shows the dash instead of $0", async () => {
    seeded.aum = { data: null, error: DENIED };
    await renderHome();
    expect(statValue("AUM tracked")).toBe("—");
    expect(statValue("Verified strategies")).toBe("7+");
    expect(seeded.sentry).toHaveLength(1);
    expect(seeded.sentry[0].opts).toEqual({
      tags: { op: "getSocialProofStats", stat: "aum", code: "42501" },
      level: "error",
    });
  });

  it("reports an introductions 42501 to Sentry and shows the dash", async () => {
    seeded.contactCount = { count: null, error: DENIED };
    await renderHome();
    expect(statValue("Introductions made")).toBe("—");
    expect(seeded.sentry).toHaveLength(1);
    expect(seeded.sentry[0].opts).toEqual({
      tags: { op: "getSocialProofStats", stat: "intros", code: "42501" },
      level: "error",
    });
  });

  it("captures a thrown read once and still renders the page with dashes", async () => {
    seeded.strategiesCount = { get count(): number { throw new Error("boom"); }, error: null };
    await renderHome();
    expect(statValue("Verified strategies")).toBe("—");
    expect(statValue("AUM tracked")).toBe("—");
    expect(statValue("Introductions made")).toBe("—");
    expect(seeded.sentry).toHaveLength(1);
    expect(seeded.sentry[0].opts).toEqual({
      tags: { op: "getSocialProofStats", stat: "all" },
      level: "error",
    });
  });
});

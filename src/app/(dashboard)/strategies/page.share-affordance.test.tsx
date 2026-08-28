/**
 * Phase 164 (SHARE-04) — /strategies: the share affordance is no longer
 * status-gated.
 *
 * WHY THIS FILE EXISTS, stated as the defect it pins closed:
 *
 * The row used to render `{s.status === "published" && <ShareableLink …>}`. That
 * is the HIDDEN-AFFORDANCE half of the same dishonesty class as the factsheet's
 * 404-producing Copy Link — an owner with an unpublished strategy had no way at
 * all to show it to anyone, so the product's answer to the single most common
 * thing a manager wants to do with a draft was silence. Both halves had to close
 * together or the class survives (feedback: close the whole class across the
 * surface, not point-fixes).
 *
 * The assertions are therefore about the PREDICATE, not about pixels:
 *   1. every row carries the control, whatever its status;
 *   2. each row is told the TRUTH about its own publication state, because that
 *      is what decides whether the URL is a public id or a revocable capability;
 *   3. both sibling surfaces route through the same component, so a fourth
 *      opinion cannot appear without this file noticing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";

vi.mock("server-only", () => ({}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));

vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) =>
    React.createElement("h1", null, title),
}));

vi.mock("@/components/strategy/StrategyActions", () => ({
  StrategyActions: () => null,
}));
vi.mock("@/components/strategy/PendingIntros", () => ({
  PendingIntros: () => null,
}));

/**
 * ShareableLink is replaced by a PROBE, not by `() => null`: the question this
 * file asks is "what was each row told", and a null stub cannot answer it.
 * `isPublishedStatus` is re-exported REAL — stubbing the predicate would let the
 * page ask the wrong question while this file stayed green.
 */
const shareProps = vi.hoisted(
  () => [] as Array<{ strategyId: string; published: boolean }>,
);
vi.mock("@/components/strategy/ShareableLink", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/strategy/ShareableLink")
  >("@/components/strategy/ShareableLink");
  return {
    ...actual,
    ShareableLink: (props: { strategyId: string; published: boolean }) => {
      shareProps.push({ strategyId: props.strategyId, published: props.published });
      return React.createElement(
        "span",
        { "data-testid": `share-${props.strategyId}` },
        props.published ? "public" : "private",
      );
    },
  };
});

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirectMock(path);
    throw new Error(`__REDIRECT__:${path}`);
  },
}));

interface MockStrategyRow {
  id: string;
  name: string;
  status: string;
  source: string;
  strategy_types: string[];
  review_note: string | null;
  created_at: string;
  api_key_id: string | null;
}

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  strategies: [] as MockStrategyRow[],
}));

// Supabase double cloned from page.wizard-draft-banner.test.tsx (same page,
// same query shapes) — the draft arm resolves null here because this file has
// no interest in the Resume banner.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
    from: (table: string) => {
      if (table !== "strategies" && table !== "contact_requests") {
        throw new Error(`Unexpected table: ${table}`);
      }
      const listResult =
        table === "contact_requests"
          ? { data: [], error: null }
          : { data: state.strategies, error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        or: () => builder,
        in: () => builder,
        limit: () => builder,
        order: () => builder,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onF: (v: { data: unknown; error: unknown }) => any,
        ) => Promise.resolve(listResult).then(onF),
      };
      return builder;
    },
  }),
}));

function row(id: string, status: string): MockStrategyRow {
  return {
    id,
    name: `Strategy ${id}`,
    status,
    source: "legacy",
    strategy_types: ["options"],
    review_note: null,
    created_at: "2026-01-01T00:00:00.000Z",
    api_key_id: null,
  };
}

async function renderPage(): Promise<HTMLElement> {
  const { default: StrategiesPage } = await import("./page");
  const jsx = await (StrategiesPage as unknown as () => Promise<React.ReactElement>)();
  const { container } = render(jsx);
  return container;
}

beforeEach(() => {
  redirectMock.mockReset();
  shareProps.length = 0;
  state.user = { id: "u-test" };
  state.strategies = [];
});

describe("StrategiesPage — the share control is always present (SHARE-04)", () => {
  it("renders the affordance for EVERY status, not just published", async () => {
    state.strategies = [
      row("s-published", "published"),
      row("s-draft", "draft"),
      row("s-pending", "pending_review"),
      row("s-archived", "archived"),
    ];

    const container = await renderPage();

    // The regression this replaces: three of these four rows rendered no share
    // control at all.
    for (const id of ["s-published", "s-draft", "s-pending", "s-archived"]) {
      expect(
        container.querySelector(`[data-testid="share-${id}"]`),
        `row ${id} must carry a share control — hiding it is the affordance half of the dishonesty class`,
      ).not.toBeNull();
    }
    expect(shareProps).toHaveLength(4);
  });

  it("tells each row the TRUTH about its own publication state", async () => {
    state.strategies = [row("s-published", "published"), row("s-draft", "draft")];

    await renderPage();

    const byId = new Map(shareProps.map((p) => [p.strategyId, p.published]));
    // published → the public id URL, unchanged (D-09).
    expect(byId.get("s-published")).toBe(true);
    // unpublished → mint a revocable capability. A `true` here would hand the
    // owner the exact 404-producing link this phase exists to eliminate.
    expect(byId.get("s-draft")).toBe(false);
  });

  it("an UNRECOGNISED status fails CLOSED to the private lane", async () => {
    // `status` is `text` in the database. A value this build has never heard of
    // must not be treated as published: the worst case of guessing "private" is
    // a token link that works; the worst case of guessing "public" is a link
    // that 404s for the recipient with a success badge on screen.
    state.strategies = [row("s-weird", "some_future_status")];

    await renderPage();

    expect(shareProps[0].published).toBe(false);
  });
});

describe("one predicate, three sites — the drift pin", () => {
  const ROOT = join(__dirname, "..", "..", "..", "..");
  const readSrc = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

  const SITES = [
    "src/app/(dashboard)/strategies/page.tsx",
    "src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx",
  ];

  it.each(SITES)(
    "%s renders ShareableLink from the canonical module, not a bespoke copy control",
    (rel) => {
      const src = readSrc(rel);
      expect(
        src.includes(`from "@/components/strategy/ShareableLink"`),
        `${rel} must import the shared component — a local copy control is how the three surfaces drifted apart in the first place`,
      ).toBe(true);
      expect(src).toContain("<ShareableLink");
    },
  );

  it("the factsheet's own Copy Link imports the SAME predicate", () => {
    // The third site. It cannot reuse `ShareableLink` itself (it is a
    // ControlBar pill, not a Button, and its published arm must stay
    // byte-identical per D-09), so what it shares is the DECISION —
    // `shareAffordanceMode` — and the mint call. If that import disappears,
    // the factsheet has grown a fourth opinion about what a share link is.
    const src = readSrc("src/app/factsheet/[id]/v2/FactsheetView.tsx");
    expect(src).toContain(`from "@/components/strategy/ShareableLink"`);
    expect(src).toContain("shareAffordanceMode");
    expect(src).toContain("mintShareUrl");
  });

  it("the predicate itself is declared EXACTLY once in production sources", () => {
    // Anti-vacuity for the three assertions above: they check that consumers
    // NAME the identifier. If a second file could DECLARE it, every one of them
    // could pass while two incompatible predicates shipped.
    // ⛔ THE CANONICAL FILE MOVED, and the move is load-bearing. The predicate
    // was declared in ShareableLink.tsx, which carries `"use client"`. The
    // strategies page is a SERVER component and calls `isPublishedStatus`, so
    // every GET /strategies threw "Attempted to call isPublishedStatus() from
    // the server" — measured in the dev server 2026-08-28, found by browser UAT,
    // invisible to this suite because jsdom does not enforce the RSC boundary.
    // The declarations now live in a module with no directive; ShareableLink
    // re-exports them, so all three consumers still name one identifier.
    const canonical = readSrc("src/lib/share-affordance.ts");
    expect(canonical).toContain("export function shareAffordanceMode(");
    // ⛔ A DIRECTIVE, NOT A SUBSTRING. `expect(canonical).not.toContain('"use
    // client"')` was written first and failed immediately — the file's own
    // docblock EXPLAINS why it carries no directive, and the explanation
    // contains the string. A prose mention is not a directive; only a bare
    // statement is. Same shape as every other text-oracle defect this phase
    // turned up, arriving here as a false POSITIVE instead of a false negative.
    expect(
      canonical.split("\n").some((l) => l.trim().replace(/;$/, "") === '"use client"'),
      "src/lib/share-affordance.ts must carry no \"use client\" directive — a server component calls it",
    ).toBe(false);
    // The re-export site must NOT re-declare — it forwards only.
    expect(
      readSrc("src/components/strategy/ShareableLink.tsx"),
      "ShareableLink must re-export the predicate, never re-declare it",
    ).not.toContain("function shareAffordanceMode(");
    for (const rel of [
      ...SITES,
      "src/app/factsheet/[id]/v2/FactsheetView.tsx",
    ]) {
      expect(
        readSrc(rel),
        `${rel} must CONSUME the predicate, never re-declare it`,
      ).not.toContain("function shareAffordanceMode(");
    }
  });
});

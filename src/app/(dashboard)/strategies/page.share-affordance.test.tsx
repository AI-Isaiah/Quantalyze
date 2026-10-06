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
  () =>
    [] as Array<{
      strategyId: string;
      published: boolean;
      size?: "sm" | "md";
      // Phase 164.6.6.3.1 D-05/D-06 Wave 0: plan 05 hands each row a live-share flag.
      hasActiveShare?: boolean;
    }>,
);
vi.mock("@/components/strategy/ShareableLink", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/strategy/ShareableLink")
  >("@/components/strategy/ShareableLink");
  return {
    ...actual,
    ShareableLink: (props: {
      strategyId: string;
      published: boolean;
      size?: "sm" | "md";
      hasActiveShare?: boolean;
    }) => {
      shareProps.push({
        strategyId: props.strategyId,
        published: props.published,
        size: props.size,
        hasActiveShare: props.hasActiveShare,
      });
      return React.createElement(
        "span",
        { "data-testid": `share-${props.strategyId}` },
        props.published ? "public" : "private",
      );
    },
  };
});

// Phase 167.2.1 (D-08): the page now asks `probeFactsheetBuildable` about
// every row the analytics embed calls computed, on the service-role client.
// This double answers every strategies read with a computed row holding a
// 30-point series, so a computed row is BUILDABLE and shows no note, exactly as
// before the list probed; no assertion in this file depends on the probe.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      const self = () => b;
      b.select = self;
      b.eq = self;
      b.or = self;
      b.order = self;
      b.limit = self;
      b.maybeSingle = async () =>
        table === "strategies"
          ? {
              data: {
                id: "s-probe",
                name: "Synthetic probe row",
                status: "draft",
                asset_class: "crypto",
                returns_denominator_config: null,
                strategy_analytics: {
                  daily_returns: Array.from({ length: 30 }, (_, i) => ({
                    date: new Date(Date.UTC(2024, 0, 2) + i * 86_400_000)
                      .toISOString()
                      .slice(0, 10),
                    value: ((i % 7) - 3) / 1000,
                  })),
                  returns_series: null,
                  computed_at: "2024-03-01T00:00:00Z",
                  data_quality_flags: null,
                  metrics_json_by_basis: null,
                  computation_status: "complete",
                },
              },
              error: null,
            }
          : { data: null, error: null };
      b.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
      return b;
    },
  }),
}));

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
  // Phase 167.2 (KCS-12): the list reads the analytics status to decide the
  // share note. Computed by default, so these cases see no note.
  strategy_analytics: { computation_status: string | null } | null;
}

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  strategies: [] as MockStrategyRow[],
  // Phase 164.6.6.3.1 D-05/D-06 Wave 0: the `strategy_shares` read plan 05 adds to the page.
  shares: [] as { strategy_id: string; revoked_at: string | null }[],
  sharesError: null as { message: string } | null,
}));

// Supabase double cloned from page.wizard-draft-banner.test.tsx (same page,
// same query shapes) — the draft arm resolves null here because this file has
// no interest in the Resume banner.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
    // Phase 167.2 (KCS-06 / KCS-12): the page also reads the owner's key
    // statuses (api_keys, strategy_keys) and, per uncomputed row, the compute-job RPC. Both are allowed
    // DELIBERATELY, answering empty; any other table still throws.
    rpc: async () => ({ data: [], error: null }),
    from: (table: string) => {
      if (
        table !== "strategies" &&
        table !== "contact_requests" &&
        table !== "api_keys" &&
        table !== "strategy_keys" &&
        // Phase 164.6.6.3.1 D-05/D-06 Wave 0: plan 05's page read.
        table !== "strategy_shares"
      ) {
        throw new Error(`Unexpected table: ${table}`);
      }
      // Phase 164.6.6.3.1 D-05/D-06 Wave 0. The `strategy_shares` arm is POISONED
      // on purpose: with an error seeded it answers the seeded rows TOGETHER WITH
      // the error, `{ data: shares, error }`, never `data: null`. A page that used
      // the rows despite the error would then mark a row live, so plan 05's
      // fail-closed test can catch it; with `data: null` it could not.
      const listResult =
        table === "strategies"
          ? { data: state.strategies, error: null }
          : table === "strategy_shares"
            ? { data: state.shares, error: state.sharesError }
            : { data: [], error: null };
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
    strategy_analytics: { computation_status: "complete" },
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
  // Phase 167.2.1 (D-08): UUID-shaped, because the page's probe runs under
  // `withPublishedOrOwner(q, user.id)`, which fails closed (and logs) on a
  // non-UUID id. Synthetic.
  state.user = { id: "00000000-0000-4000-8000-0000000000a1" };
  state.strategies = [];
  // Phase 164.6.6.3.1 D-05/D-06 Wave 0.
  state.shares = [];
  state.sharesError = null;
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

describe("StrategiesPage — hasActiveShare comes from one read (164.6.6.3.1 D-05)", () => {
  it("D-05: hasActiveShare reaches each row from one read", async () => {
    state.strategies = [
      row("s-a", "draft"),
      row("s-b", "draft"),
      row("s-c", "draft"),
      row("s-p", "published"),
    ];
    state.shares = [
      { strategy_id: "s-a", revoked_at: null },
      { strategy_id: "s-b", revoked_at: "2026-10-01T00:00:00.000Z" },
    ];

    await renderPage();

    const byId = new Map(shareProps.map((p) => [p.strategyId, p.hasActiveShare]));
    expect(byId.get("s-a"), "a non-revoked share is live").toBe(true);
    // The derivation is in code (`revoked_at === null`), the factsheet's rule:
    // a revoked row the double hands back must NOT read as live.
    expect(byId.get("s-b"), "a revoked share is not live").toBe(false);
    expect(byId.get("s-c"), "no share row is not live").toBe(false);
    expect(byId.get("s-p"), "a published row is never asked").toBe(false);
  });
});

describe("StrategiesPage — N-STRAT row layout (170-05)", () => {
  it("stacks below md, wraps tags whole, and keeps the name link textContent equal to the name", async () => {
    // WHY: at V390 the private-link control overlapped the name, and a
    // hyphenated word broke at its hyphen. Each word and each tag stays
    // whole. textContent must equal the name exactly — noteOf() matches
    // a.textContent === strategyName (PC-5).
    // GC-02 (2026-09-30): the stack breakpoint moved from sm to md ON
    // PURPOSE. At V640 the sm row put the full-width control group beside
    // the name and left the name block 142 px (CI run 36764778803); stacking
    // until md keeps it full width (>= 160 px). So the row and the control
    // group carry md: utilities, and none of the five may come back on sm:.
    state.strategies = [
      {
        ...row("s-layout", "draft"),
        name: "Alpha Long-Short Beta",
        strategy_types: ["Long-Short", "Market Neutral"],
      },
    ];

    const container = await renderPage();
    const rowEl = container.querySelector('[data-testid="strategy-row"]')!
      .firstElementChild as HTMLElement;
    const rowTokens = rowEl.className.split(/\s+/);
    expect(rowTokens).toContain("flex-col");
    for (const token of ["md:flex-row", "md:items-center", "md:justify-between"]) {
      expect(rowTokens).toContain(token);
    }

    const link = container.querySelector("a")!;
    expect(link.textContent).toBe("Alpha Long-Short Beta");
    // WR-02 (170 review): /strategies does not scroll, so its name words must
    // be breakable when one is wider than the name block. A nowrap word there
    // let a 40-character hyphenated name overflow the card at 390 px.
    for (const word of link.querySelectorAll("span")) {
      expect(word.className.split(/\s+/)).toContain("inline-block");
      expect(word.className.split(/\s+/)).not.toContain("whitespace-nowrap");
    }

    const tagRow = link.nextElementSibling as HTMLElement;
    expect(tagRow.className).toContain("flex-wrap");
    expect(tagRow.className).toContain("gap-1");
    const chips = [...tagRow.querySelectorAll("span")];
    expect(chips.length).toBeGreaterThanOrEqual(2);
    for (const chip of chips) {
      expect(chip.className).toContain("whitespace-nowrap");
    }

    // CR-01 (170 review, measured 2026-10-01 in Chromium with DM Sans): from
    // md up the name block keeps a hard 160 px floor and the control group
    // may shrink and wrap. With `md:shrink-0` the group held its one-line
    // width (~401 px for a draft row), so at 768 and 800 px (desktop 200%
    // zoom on 1536/1600 px screens) the name block got 0 px and the name
    // painted over the controls. The floor and the shrinkable group are the
    // fix; `md:shrink-0` coming back re-opens the overlap.
    const nameBlock = link.parentElement as HTMLElement;
    const nameTokens = nameBlock.className.split(/\s+/);
    for (const token of ["flex-1", "min-w-0", "md:min-w-[160px]"]) {
      expect(nameTokens).toContain(token);
    }

    const group = rowEl.lastElementChild as HTMLElement;
    const groupTokens = group.className.split(/\s+/);
    expect(groupTokens).toContain("flex-wrap");
    for (const token of ["md:ml-4", "md:min-w-0"]) {
      expect(groupTokens).toContain(token);
    }
    expect(groupTokens).not.toContain("md:shrink-0");
    expect(groupTokens).not.toContain("shrink-0");

    // GC-02: none of the five layout utilities may sit on the sm: prefix.
    const smLayout = [
      "sm:flex-row",
      "sm:items-center",
      "sm:justify-between",
      "sm:ml-4",
      "sm:shrink-0",
    ];
    for (const token of [...rowTokens, ...groupTokens]) {
      expect(smLayout).not.toContain(token);
    }
  });
});

describe("StrategiesPage — private-link control is a small secondary peer (170-05)", () => {
  it("passes size=sm through to ShareableLink", async () => {
    // WHY: at V390 the md private-link button overlapped the strategy name.
    // /strategies asks for the sm peer; the discovery page must not, so this
    // is the only call site that may pass the prop.
    state.strategies = [row("s-sm", "draft")];

    await renderPage();

    expect(shareProps).toHaveLength(1);
    expect(shareProps[0].size).toBe("sm");
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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { byBasisAliasRow } from "@/lib/test-helpers/by-basis-alias-row";
import type { DailyReturn } from "@/lib/factsheet/types";
import { formatCloseDay as d } from "@/lib/factsheet/returns-unit";

/**
 * Phase 256 plan 08 (D-05, SC-3, T-256-24, UI-SPEC E) - the share card of a strategy that moved
 * from USD into a coin. WHY each arm: a share card is a public image that outlives the page, so it
 * must say the figures are USD and when the unit changed, in the one sentence every surface uses
 * (composed by `unitSwitchOgNote`, never by the route). It must NOT carry the "in BTC" suffix
 * (the CAGR here is a USD figure), and a malformed flag must give today's plain card, not a
 * sentence with a guessed day. The harness is copied from route.stored-parity.test.tsx.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const ID = "55555555-5555-4555-8555-555555555555";

const STATE = vi.hoisted(() => ({
  strategyRow: null as Record<string, unknown> | null,
}));
const ogCalls = vi.hoisted(() => [] as unknown[]);

vi.mock("next/og", () => ({
  ImageResponse: class {
    headers = new Headers();
    constructor(element: unknown) {
      ogCalls.push(element);
    }
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: STATE.strategyRow, error: null }),
      };
      return builder;
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: { strategy_analytics: byBasisAliasRow(null) }, error: null }),
    };
    return { from: () => builder };
  },
}));

beforeEach(() => {
  ogCalls.length = 0;
});
afterEach(() => {
  vi.clearAllMocks();
});

const DAY = 86_400_000;
function dated(values: number[], start = "2025-01-01"): DailyReturn[] {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return values.map((value, i) => ({ date: new Date(t0 + i * DAY).toISOString().slice(0, 10), value }));
}
const LONG = dated(Array.from({ length: 400 }, (_, i) => 0.0006 + 0.004 * Math.sin(i)));

const CLEARED = {
  series_start: "2025-01-01",
  series_end: "2026-02-04",
  headline_since: null,
  record_observations: 400,
};
/** 25 covered days: under the crypto minimum, so the card carries a figure note of its own. */
const SHORT = {
  series_start: "2025-01-01",
  series_end: "2025-01-25",
  headline_since: null,
  record_observations: 25,
};

const SWITCH = { coin: "BTC", last_usd_day: "2026-11-14", first_coin_return_day: "2026-11-15" };
const SENTENCE = `In USD to ${d("2026-11-14")}, in BTC from ${d("2026-11-15")}. Figures in USD.`;

type Node = { type?: unknown; props?: { children?: unknown; style?: Record<string, unknown>; label?: string } };

function walk(node: unknown, visit: (n: Node) => void): void {
  if (Array.isArray(node)) {
    for (const c of node) walk(c, visit);
  } else if (node && typeof node === "object") {
    visit(node as Node);
    walk((node as Node).props?.children, visit);
  }
}

function texts(card: unknown): string[] {
  const out: string[] = [];
  walk(card, (n) => {
    const c = n.props?.children;
    if (typeof c === "string") out.push(c);
  });
  return out;
}

/** The style of the element whose only child is exactly `text`. */
function styleOfText(card: unknown, text: string): Record<string, unknown> | undefined {
  let found: Record<string, unknown> | undefined;
  walk(card, (n) => {
    if (n.props?.children === text) found = n.props.style;
  });
  return found;
}

function cagrLabel(card: unknown): string | undefined {
  let label: string | undefined;
  walk(card, (n) => {
    if (typeof n.props?.label === "string" && n.props.label.startsWith("CAGR")) label = n.props.label;
  });
  return label;
}

async function renderCard(
  flags: Record<string, unknown> | null,
  scalars = CLEARED,
  override: Record<string, unknown> = {},
) {
  STATE.strategyRow = {
    id: ID,
    name: "Switch Fixture",
    codename: null,
    description: null,
    asset_class: "crypto",
    strategy_analytics: [
      {
        daily_returns: LONG,
        returns_series: null,
        computation_status: "complete",
        sharpe: 1.2,
        cagr: 0.18,
        max_drawdown: -0.1,
        cumulative_return: 0.2,
        volatility: 0.1,
        sortino: 0.2,
        calmar: 0.3,
        data_quality_flags: flags,
        ...scalars,
        ...override,
      },
    ],
  };
  const { GET } = await import("./route");
  await GET(new Request(`http://localhost:3000/api/og/factsheet/${ID}`), {
    params: Promise.resolve({ id: ID }),
  });
  expect(ogCalls.length, "the route must construct a card").toBeGreaterThan(0);
  return ogCalls[ogCalls.length - 1];
}

describe("OG factsheet card - a switched strategy (SC-3, UI-SPEC E)", () => {
  it("prints the switch sentence and 'Figures in USD.' as one note, in the figureNote style, 24 below the stat row", async () => {
    const card = await renderCard({ unit_switch: SWITCH });
    expect(texts(card)).toContain(SENTENCE);
    expect(styleOfText(card, SENTENCE)).toEqual({ marginTop: 24, fontSize: 20, color: "#64748B" });
  });

  it("sits 8 below an existing figure note", async () => {
    const plain = texts(await renderCard({}, SHORT));
    const card = await renderCard({ unit_switch: SWITCH }, SHORT);
    // The plain short-record card has its own note line; the switched card keeps every one of its
    // texts and adds the switch note, which follows at 8.
    expect(plain.some((t) => /day/i.test(t) && t.length > 20)).toBe(true);
    for (const t of plain) expect(texts(card)).toContain(t);
    expect(texts(card)).toContain(SENTENCE);
    expect(styleOfText(card, SENTENCE)).toEqual({ marginTop: 8, fontSize: 20, color: "#64748B" });
  });

  it("keeps the CAGR label plain: a switched strategy has no 'in BTC' suffix", async () => {
    const card = await renderCard({ unit_switch: SWITCH });
    expect(cagrLabel(card)).toBe("CAGR");
    expect(texts(card).join("|")).not.toMatch(/Returns in BTC/);
  });

  it("the sentence is composed from the stored days: a second fixture renders its own coin and days", async () => {
    const card = await renderCard({
      unit_switch: { coin: "ETH", last_usd_day: "2026-10-02", first_coin_return_day: "2026-10-03" },
    });
    expect(texts(card)).toContain(
      `In USD to ${d("2026-10-02")}, in ETH from ${d("2026-10-03")}. Figures in USD.`,
    );
    expect(texts(card).join("|")).not.toContain("BTC");
  });

  it.each([
    ["days two apart", { ...SWITCH, first_coin_return_day: "2026-11-16" }],
    ["a lower-case coin", { ...SWITCH, coin: "btc" }],
    ["USD as the coin", { ...SWITCH, coin: "USD" }],
    ["a missing day", { coin: "BTC", last_usd_day: "2026-11-14" }],
  ])("%s: malformed reads as absent, the card is today's plain card", async (_label, bad) => {
    const card = await renderCard({ unit_switch: bad });
    expect(texts(card).join("|")).not.toMatch(/In USD to/);
  });

  it("an unswitched card has no note and is unchanged (a USD card and a native BTC card)", async () => {
    const usd = await renderCard({});
    expect(texts(usd).join("|")).not.toMatch(/In USD to|Figures in USD/);
    expect(cagrLabel(usd)).toBe("CAGR");
    const btc = await renderCard({ native_unit: "BTC" });
    expect(texts(btc).join("|")).not.toMatch(/In USD to|Figures in USD/);
    expect(cagrLabel(btc)).toBe("CAGR in BTC");
  });

  it("reads the EFFECTIVE flags: a held re-run inside the derive prestamp window prints the last success's switch", async () => {
    const AT = "2026-11-20T10:00:00.000Z";
    const card = await renderCard(
      {
        last_success_snapshot: {
          computed_at: AT,
          flags: { cumulative_method: "geometric", unit_switch: SWITCH },
        },
      },
      CLEARED,
      { computation_status: "computing", computed_at: AT },
    );
    expect(texts(card)).toContain(SENTENCE);
  });
});

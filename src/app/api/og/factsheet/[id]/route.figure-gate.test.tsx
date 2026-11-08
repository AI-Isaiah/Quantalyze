import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RECORD_SCALAR_ALIASES } from "@/lib/figure-record-scalars";
import { OG_CARD_VERSION } from "@/lib/factsheet/og-metrics";

/**
 * Phase 194.1 plan 06 (census B3; 194 D-04 as superseded by D-15, D-13): the public
 * share card is gated on the strategy's TOTAL record, exactly as the factsheet strip is.
 *
 * Withheld (the record is under the minimum): Sharpe and CAGR print the card's designed
 * dash, Max DD prints as stored, and ONE muted line says why. Cleared but under one year:
 * every KPI prints and ONE muted line says the figures are annualized from a short record.
 * Full or unknown: no line. The route builds the record from the four alias scalars the
 * embed carries (never from the capped series length), so a 59-observation non-crypto
 * record is withheld even though far more than 60 rows resolve.
 *
 * Every sentence below is typed by hand, never imported from the gate module, so a
 * wording change in `figure-gate.ts` is a visible decision and not a silent pass.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const ID = "55555555-5555-4555-8555-555555555555";

const STATE = vi.hoisted(() => ({
  strategyRow: null as Record<string, unknown> | null,
  select: null as string | null,
}));

/** Every ImageResponse element the route constructed, newest last. */
const ogCalls = vi.hoisted(() => [] as Array<{ element: unknown; headers: Headers }>);

vi.mock("next/og", () => ({
  ImageResponse: class {
    headers = new Headers();
    constructor(element: unknown) {
      ogCalls.push({ element, headers: this.headers });
    }
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const builder = {
        select: (cols: string) => {
          STATE.select = cols;
          return builder;
        },
        eq: () => builder,
        maybeSingle: async () => ({ data: STATE.strategyRow, error: null }),
      };
      return builder;
    },
  }),
}));

beforeEach(() => {
  STATE.strategyRow = null;
  STATE.select = null;
  ogCalls.length = 0;
});
afterEach(() => {
  vi.clearAllMocks();
});

const DAY = 86_400_000;

function dated(n: number, start: string): Array<{ date: string; value: number }> {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(t0 + i * DAY).toISOString().slice(0, 10),
    value: 0.0006 + 0.004 * Math.sin(i),
  }));
}

/** The stored headline: figures the series cannot compute, so only the stored arm can print them. */
const STORED = { sharpe: 0.12, cagr: 0.4, max_drawdown: -0.0368 };

type Scalars = {
  series_start?: unknown;
  series_end?: unknown;
  headline_since?: unknown;
  record_observations?: unknown;
};

function setRow(opts: {
  assetClass?: string;
  series: Array<{ date: string; value: number }>;
  scalars?: Scalars;
}): void {
  STATE.strategyRow = {
    id: ID,
    name: "Gate Fixture",
    codename: null,
    description: null,
    asset_class: opts.assetClass ?? "crypto",
    strategy_analytics: [
      {
        daily_returns: opts.series,
        returns_series: null,
        computation_status: "complete",
        ...STORED,
        cumulative_return: 0.01,
        volatility: 0.1,
        sortino: 0.2,
        calmar: 0.3,
        metrics_json_by_basis: null,
        data_quality_flags: {},
        ...(opts.scalars ?? {}),
      },
    ],
  };
}

type Node = { type?: unknown; props?: Record<string, unknown> };

function stat(node: unknown, label: string): { value: string; tone?: string } | undefined {
  if (Array.isArray(node)) {
    for (const c of node) {
      const v = stat(c, label);
      if (v) return v;
    }
    return undefined;
  }
  if (node && typeof node === "object") {
    const props = (node as Node).props;
    if (!props) return undefined;
    if (props.label === label && typeof props.value === "string") {
      return { value: props.value, tone: props.tone as string | undefined };
    }
    return stat(props.children, label);
  }
  return undefined;
}

/** Every element in the tree whose direct child is exactly this string, with its style. */
function textElements(node: unknown, out: Array<{ text: string; style: Record<string, unknown> }> = []) {
  if (Array.isArray(node)) {
    for (const c of node) textElements(c, out);
    return out;
  }
  if (node && typeof node === "object") {
    const props = (node as Node).props;
    if (!props) return out;
    if (typeof props.children === "string") {
      out.push({ text: props.children, style: (props.style as Record<string, unknown>) ?? {} });
    }
    textElements(props.children, out);
  }
  return out;
}

async function renderCard(url = `http://localhost:3000/api/og/factsheet/${ID}`) {
  const { GET } = await import("./route");
  const res = await GET(new Request(url), { params: Promise.resolve({ id: ID }) });
  expect(ogCalls.length, "the route must construct a card").toBeGreaterThan(0);
  const { element, headers } = ogCalls[ogCalls.length - 1];
  const sharpe = stat(element, "Sharpe");
  const cagr = stat(element, "CAGR");
  const maxDd = stat(element, "Max DD");
  expect(sharpe && cagr && maxDd, "the card must carry all three stats").toBeTruthy();
  // The one muted line: any text that opens with "Annualized". The footer, the title and
  // the stat labels never do.
  const lines = textElements(element).filter((t) => t.text.startsWith("Annualized"));
  return {
    sharpe: sharpe!.value,
    cagr: cagr!.value,
    cagrTone: cagr!.tone,
    maxDd: maxDd!.value,
    lines,
    cacheControl: headers.get("Cache-Control"),
    res,
  };
}

describe("the share card is gated on the strategy's total record (B3, D-15)", () => {
  it("a crypto record of 25 days: Sharpe and CAGR print a dash with no tone, Max DD prints as stored, and the one muted line gives the reason", async () => {
    setRow({
      series: dated(25, "2026-01-01"),
      scalars: { series_start: "2026-01-01", series_end: "2026-01-25", record_observations: 25 },
    });
    const card = await renderCard();
    expect(card.sharpe).toBe("—");
    expect(card.cagr).toBe("—");
    expect(card.cagrTone).toBeUndefined();
    expect(card.maxDd).toBe("-3.7%");
    expect(card.lines).toHaveLength(1);
    expect(card.lines[0].text).toBe(
      "Annualized figures appear once the record reaches 90 days. This record covers 25 days.",
    );
    expect(card.lines[0].style.color).toBe("#64748B");
  });

  it("a non-crypto record with 59 stored observations is withheld although more than 60 rows resolve (the count is the stored one, never the series length)", async () => {
    setRow({
      assetClass: "traditional",
      series: dated(80, "2026-01-01"),
      scalars: { series_start: "2026-01-01", series_end: "2026-03-21", record_observations: 59 },
    });
    const card = await renderCard();
    expect(card.sharpe).toBe("—");
    expect(card.cagr).toBe("—");
    expect(card.maxDd).toBe("-3.7%");
    expect(card.lines.map((l) => l.text)).toEqual([
      "Annualized figures appear once the record reaches 60 trading days. This record has 59 trading days.",
    ]);
  });

  it("a present but unparsable series end is withheld with the dates-could-not-be-read line", async () => {
    setRow({
      series: dated(120, "2026-01-01"),
      scalars: { series_start: "2026-01-01", series_end: "not-a-date", record_observations: 120 },
    });
    const card = await renderCard();
    expect(card.sharpe).toBe("—");
    expect(card.cagr).toBe("—");
    expect(card.lines.map((l) => l.text)).toEqual([
      "Annualized figures are not shown: this record's dates could not be read.",
    ]);
  });

  it("a cleared crypto record of 200 days: every KPI prints, the STORED CAGR included (no card-only year rule), with the one short-record line", async () => {
    setRow({
      series: dated(200, "2026-01-01"),
      scalars: { series_start: "2026-01-01", series_end: "2026-07-19", record_observations: 200 },
    });
    const card = await renderCard();
    expect(card.sharpe).toBe("0.12");
    expect(card.cagr).toBe("+40.0%");
    expect(card.cagrTone).toBe("pos");
    expect(card.maxDd).toBe("-3.7%");
    expect(card.lines.map((l) => l.text)).toEqual(["Annualized from 200 days of record, under one year."]);
    expect(card.lines[0].style.color).toBe("#64748B");
  });

  it("a 400-day record (a full year or more) draws no line and prints exactly as before", async () => {
    setRow({
      series: dated(400, "2025-01-01"),
      scalars: { series_start: "2025-01-01", series_end: "2026-02-04", record_observations: 400 },
    });
    const card = await renderCard();
    expect(card.sharpe).toBe("0.12");
    expect(card.cagr).toBe("+40.0%");
    expect(card.maxDd).toBe("-3.7%");
    expect(card.lines).toHaveLength(0);
  });

  it("alias scalars absent (a null series end): the state is unknown, so no line and the stats print as stored", async () => {
    setRow({
      series: dated(25, "2026-01-01"),
      scalars: { series_start: null, series_end: null, record_observations: null },
    });
    const card = await renderCard();
    expect(card.sharpe).toBe("0.12");
    expect(card.maxDd).toBe("-3.7%");
    expect(card.lines).toHaveLength(0);
  });

  it("a short record whose figures are all withheld by the headline verdict draws no short-record line (it would name figures the card does not show)", async () => {
    setRow({
      series: dated(200, "2026-01-01"),
      scalars: { series_start: "2026-01-01", series_end: "2026-07-19", record_observations: 200 },
    });
    // A legacy chain-broken row: no valid headline_since, so Sharpe, CAGR and Max DD are all dashes.
    const analytics = (STATE.strategyRow!.strategy_analytics as Array<Record<string, unknown>>)[0];
    analytics.data_quality_flags = { twr_chain_broken: true };
    analytics.cumulative_return = 0.4;
    const card = await renderCard();
    expect([card.sharpe, card.cagr, card.maxDd]).toEqual(["—", "—", "—"]);
    expect(card.lines).toHaveLength(0);
  });
});

describe("the embed projection (T-194.1-12)", () => {
  /** The comma-split entries inside the `strategy_analytics ( ... )` embed. */
  function embedEntries(select: string): string[] {
    const m = /strategy_analytics \(([^)]*)\)/.exec(select);
    expect(m, "the select must carry a strategy_analytics embed").not.toBeNull();
    return m![1].split(",").map((s) => s.trim());
  }

  it("carries the four record aliases, projects no whole metrics_json, and every metrics_json entry is a keyed alias", async () => {
    setRow({ series: dated(25, "2026-01-01") });
    await renderCard();
    expect(STATE.select).not.toBeNull();
    const entries = embedEntries(STATE.select!);
    const aliases = RECORD_SCALAR_ALIASES.split(",").map((s) => s.trim());
    expect(aliases).toHaveLength(4);
    for (const a of aliases) expect(entries, `the embed must carry ${a}`).toContain(a);
    expect(entries).not.toContain("metrics_json");
    for (const e of entries.filter((x) => x.includes("metrics_json") && x !== "metrics_json_by_basis")) {
      expect(e, "a metrics_json entry must be a keyed alias").toMatch(/^[a-z_]+:metrics_json->[a-z_]+$/);
    }
  });
});

describe("the version query param (T-194.1-14)", () => {
  it("a request carrying ?v= renders exactly as one without it: same stats, same muted line, same Cache-Control", async () => {
    setRow({
      series: dated(25, "2026-01-01"),
      scalars: { series_start: "2026-01-01", series_end: "2026-01-25", record_observations: 25 },
    });
    const plain = await renderCard();
    // A hand-edited, unrelated value must change nothing the card says either.
    const versioned = await renderCard(`http://localhost:3000/api/og/factsheet/${ID}?v=${OG_CARD_VERSION}&u=BTC`);
    const stripRes = ({ res: _res, ...rest }: Awaited<ReturnType<typeof renderCard>>) => rest;
    expect(stripRes(versioned)).toEqual(stripRes(plain));
    expect(versioned.lines.map((l) => l.text)).toEqual([
      "Annualized figures appear once the record reaches 90 days. This record covers 25 days.",
    ]);
    expect(versioned.cacheControl).toBe("public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");
    const other = await renderCard(`http://localhost:3000/api/og/factsheet/${ID}?v=not-a-version`);
    expect(stripRes(other)).toEqual(stripRes(plain));
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type { DailyReturn } from "@/lib/factsheet/types";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { BuildFactsheetOpts } from "@/lib/factsheet/build-payload";
import { applyHeadlineBasis } from "@/lib/factsheet/composite-read-path";
import { FactsheetProvider } from "@/app/factsheet/[id]/v2/factsheet-context";
import { FactsheetBody } from "@/app/factsheet/[id]/v2/FactsheetView";

/**
 * Phase 164.6.6.3.3 FACTSHEETTRUTH plan 06 (D-06, D-11, B9, B10): the share card
 * shows exactly the value the factsheet strip shows for a stored row.
 *
 * The card used to hide a stored Sharpe and Max DD under a card-only
 * 30-observation gate, so a row with 25 daily points printed "0.12" on the
 * factsheet and an em dash on the card (the Fibonacci Ghost shape). The founder
 * moved any minimum-history rule into compute (D-06), so card and page cannot
 * disagree. CAGR keeps two NAMED exceptions (D-11): a span under 0.95 years (E1),
 * and a chain-broken or short-window headline whose stored CAGR covers only a
 * suffix the card cannot see (E2).
 *
 * Both sides are driven through the real code: the card through the real route
 * handler, the strip through `buildFactsheetPayload` + `FactsheetBody`, from the
 * SAME stored scalars. The page half passes the stored `cash_settlement` through
 * the read path's own headline-basis applier (`applyHeadlineBasis`) first, so a
 * legacy row is withheld by the code that withholds it, never a hand-redacted copy.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const ID = "44444444-4444-4444-8444-444444444444";

const STATE = vi.hoisted(() => ({
  strategyRow: null as Record<string, unknown> | null,
}));

/** Every ImageResponse element the route constructed, newest last. */
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

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    lsStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    lsStore.delete(k);
  }),
  clear: vi.fn(() => lsStore.clear()),
  key: vi.fn(() => null),
  length: 0,
};
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
  ogCalls.length = 0;
});
afterEach(() => {
  vi.clearAllMocks();
});
Object.defineProperty(window, "localStorage", { value: localStorageMock, configurable: true });

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAY = 86_400_000;

function dated(values: number[], start = "2025-01-01"): DailyReturn[] {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return values.map((value, i) => ({ date: new Date(t0 + i * DAY).toISOString().slice(0, 10), value }));
}

/** 25 daily points: the Fibonacci Ghost shape, under any 30-observation floor. */
const SHORT = dated(Array.from({ length: 25 }, (_, i) => 0.0006 + 0.004 * Math.sin(i)));
/** 400 daily points: past the 0.95-year span. */
const LONG = dated(Array.from({ length: 400 }, (_, i) => 0.0006 + 0.004 * Math.sin(i)));

/** The seven BASIS_KPI_MAP server keys, with stored values the series cannot compute. */
function cashSettlement(stored: { sharpe: number; cagr: number; max_drawdown: number }): Record<string, number> {
  return {
    cumulative_return: 0.0123,
    volatility: 0.31,
    max_drawdown: stored.max_drawdown,
    cagr: stored.cagr,
    sharpe: stored.sharpe,
    sortino: 0.2,
    calmar: 0.1,
  };
}

// ---------------------------------------------------------------------------
// Card half: the real handler
// ---------------------------------------------------------------------------

type StatProps = {
  label: string;
  value: string;
  tone?: "pos" | "neg";
  /** The text colour the route's own `Stat` paints the value in. */
  color: string;
};

/**
 * The props of the OG card's `<Stat label={label} />`, plus the colour its value
 * is painted in. `Stat` is a module-private function component (a Next route file
 * may export nothing but handlers), so the colour is read off the element it
 * returns when the element's own `type` is invoked, never re-derived here.
 */
function ogStat(node: unknown, label: string): StatProps | undefined {
  if (Array.isArray(node)) {
    for (const c of node) {
      const v = ogStat(c, label);
      if (v !== undefined) return v;
    }
    return undefined;
  }
  if (node && typeof node === "object") {
    const el = node as { type?: unknown; props?: Record<string, unknown> };
    const props = el.props;
    if (!props) return undefined;
    if (props.label === label && typeof props.value === "string") {
      expect(typeof el.type, "Stat must be a function component").toBe("function");
      const rendered = (el.type as (p: unknown) => { props: { children: Array<{ props: { style: { color: string } } }> } })(
        props,
      );
      return { ...(props as Omit<StatProps, "color">), color: rendered.props.children[1].props.style.color };
    }
    return ogStat(props.children, label);
  }
  return undefined;
}

type Stored = { sharpe: number | null; cagr: number | null; max_drawdown: number | null };

async function renderOgCard(
  series: DailyReturn[],
  stored: Stored,
  flags: Record<string, unknown> = {},
): Promise<{ sharpe: StatProps; cagr: StatProps; maxDd: StatProps }> {
  STATE.strategyRow = {
    id: ID,
    name: "Parity Fixture",
    codename: null,
    description: null,
    asset_class: "crypto",
    strategy_analytics: [
      {
        daily_returns: series,
        returns_series: null,
        computation_status: "complete",
        sharpe: stored.sharpe,
        cagr: stored.cagr,
        max_drawdown: stored.max_drawdown,
        // SFH-R2-01: the four other stored headline keys the page's gate requires.
        cumulative_return: 0.01,
        volatility: 0.1,
        sortino: 0.2,
        calmar: 0.3,
        metrics_json_by_basis: null,
        data_quality_flags: flags,
      },
    ],
  };
  const { GET } = await import("./route");
  await GET(new Request(`http://localhost:3000/api/og/factsheet/${ID}`), {
    params: Promise.resolve({ id: ID }),
  });
  expect(ogCalls.length, "the route must construct a card").toBeGreaterThan(0);
  const card = ogCalls[ogCalls.length - 1];
  const sharpe = ogStat(card, "Sharpe");
  const cagr = ogStat(card, "CAGR");
  const maxDd = ogStat(card, "Max DD");
  expect(sharpe, "the card must carry a Sharpe stat").toBeDefined();
  expect(cagr, "the card must carry a CAGR stat").toBeDefined();
  expect(maxDd, "the card must carry a Max DD stat").toBeDefined();
  return { sharpe: sharpe!, cagr: cagr!, maxDd: maxDd! };
}

// ---------------------------------------------------------------------------
// Page half: the real strip, fed by the read path's own applier
// ---------------------------------------------------------------------------

const STRATEGY = {
  id: "s-164-6-6-3-3-06-parity",
  name: "Parity Fixture",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-10-09T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "api" as const,
};

function renderStrip(
  series: DailyReturn[],
  stored: Stored & { max_drawdown: number; sharpe: number; cagr: number },
  flags: Record<string, unknown> = {},
): { sharpe: string; cagr: string; maxDd: string; colors: { cagr: string; maxDd: string } } {
  // The read path's own applier decides Dated vs Withheld; the strip is built
  // from what it returns, exactly as the page's real read path builds it.
  const applied = applyHeadlineBasis(cashSettlement(stored), flags);
  const opts: BuildFactsheetOpts = {
    metricsByBasis: { cash_settlement: applied.headline },
    ...(Object.keys(applied.quality).length > 0 ? { dataQuality: { composite: false, ...applied.quality } } : {}),
  };
  const payload = buildFactsheetPayload(STRATEGY, series, opts);
  if (!payload) throw new Error("fixture must build a payload");
  const { container, unmount } = render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} hideHeader hideAllocatorSection hideFooter />
    </FactsheetProvider>,
  );
  const kpiGrid = Array.from(container.querySelectorAll<HTMLElement>("div.grid")).find((el) =>
    /@[\w[\]-]*:grid-cols-\d/.test(el.className),
  );
  expect(kpiGrid, "the KPI strip must render").toBeDefined();
  const kpiTile = (label: string): string => {
    const tile = Array.from(kpiGrid!.children).find(
      (el) => el.querySelector("p")?.textContent?.trim() === label,
    );
    expect(tile, `the KPI strip must carry a ${label} tile`).toBeDefined();
    return (tile!.textContent ?? "").replace(label, "").trim();
  };
  const kpiColor = (label: string): string => {
    const tile = Array.from(kpiGrid!.children).find(
      (el) => el.querySelector("p")?.textContent?.trim() === label,
    );
    return (tile!.querySelectorAll("p")[1] as HTMLElement).style.color;
  };
  const out = {
    sharpe: kpiTile("Sharpe"),
    cagr: kpiTile("CAGR"),
    maxDd: kpiTile("Max DD"),
    /** The colour the strip paints each value in (a CSS var, or the primary text colour for no tone). */
    colors: { cagr: kpiColor("CAGR"), maxDd: kpiColor("Max DD") },
  };
  unmount();
  return out;
}

// ---------------------------------------------------------------------------
// The named exceptions (D-11): CAGR only, exactly two
// ---------------------------------------------------------------------------

type CagrException = {
  id: "E1" | "E2";
  /** Why the card withholds a CAGR the factsheet still shows. */
  reason: string;
  series: DailyReturn[];
  flags: Record<string, unknown>;
};

const EXCEPTIONS: CagrException[] = [
  {
    id: "E1",
    reason: "a span under 0.95 years: the card will not annualize a short record",
    series: SHORT,
    flags: {},
  },
  {
    id: "E2",
    reason: "a chain-broken headline: the stored CAGR covers only the span after the break",
    series: LONG,
    flags: { twr_chain_broken: true, headline_since: "2025-09-01" },
  },
];

const STORED_SHORT = { sharpe: 0.12, max_drawdown: -0.0368, cagr: 0.0072 };
const STORED_LONG = { sharpe: 0.12, max_drawdown: -0.0368, cagr: 0.0072 };

describe("the share card equals the factsheet strip for a stored row (D-06, B9)", () => {
  it("anti-vacuity: the stored figures are not what the 25-point series computes", async () => {
    const { computeOgHeadline } = await import("@/lib/factsheet/og-metrics");
    const computed = computeOgHeadline(SHORT, "crypto");
    expect(computed.sharpe.toFixed(2)).not.toBe("0.12");
    expect(computed.maxDd.toFixed(4)).not.toBe("-0.0368");
  });

  it("the Fibonacci Ghost shape: 25 points, stored Sharpe 0.12 and Max DD -0.0368 print the same on the card and in the strip", async () => {
    const card = await renderOgCard(SHORT, STORED_SHORT);
    const strip = renderStrip(SHORT, STORED_SHORT);
    // Hand-typed oracles beside the equality, so two matching dashes cannot pass.
    expect(strip.sharpe).toBe("0.12");
    expect(strip.maxDd).toBe("-3.7%");
    expect(card.sharpe.value).toBe(strip.sharpe);
    expect(card.maxDd.value).toBe(strip.maxDd);
  });

  it("exactly two exceptions are named, both for CAGR (D-11)", () => {
    expect(EXCEPTIONS.map((e) => e.id)).toEqual(["E1", "E2"]);
  });

  it.each(EXCEPTIONS.map((e) => [e.id, e] as const))(
    "%s: the card withholds CAGR where the strip shows one; Sharpe and Max DD still equal",
    async (_id, ex) => {
      const stored = ex.series === SHORT ? STORED_SHORT : STORED_LONG;
      const card = await renderOgCard(ex.series, stored, ex.flags);
      const strip = renderStrip(ex.series, stored, ex.flags);
      expect(card.cagr.value, ex.reason).toBe("—");
      expect(strip.cagr, `the strip shows the stored CAGR under ${_id}`).toBe("+0.7%");
      expect(card.sharpe.value).toBe(strip.sharpe);
      expect(card.maxDd.value).toBe(strip.maxDd);
      expect(strip.sharpe).toBe("0.12");
      expect(strip.maxDd).toBe("-3.7%");
    },
  );

  it("control: a clean 400-day row has all three strings equal, CAGR included", async () => {
    const stored = { sharpe: 0.12, max_drawdown: -0.0368, cagr: 0.0072 };
    const card = await renderOgCard(LONG, stored);
    const strip = renderStrip(LONG, stored);
    expect(strip.cagr).toBe("+0.7%");
    expect(card.cagr.value).toBe(strip.cagr);
    expect(card.sharpe.value).toBe(strip.sharpe);
    expect(card.maxDd.value).toBe(strip.maxDd);
  });

  it("a legacy chain-broken row (no headline_since): Sharpe, Max DD and CAGR are three dashes on the card and in the strip (D-03)", async () => {
    const flags = { twr_chain_broken: true };
    const card = await renderOgCard(LONG, STORED_LONG, flags);
    const strip = renderStrip(LONG, STORED_LONG, flags);
    expect([card.sharpe.value, card.cagr.value, card.maxDd.value]).toEqual(["—", "—", "—"]);
    expect([strip.sharpe, strip.cagr, strip.maxDd]).toEqual(["—", "—", "—"]);
  });

  it("a Dated row shows its stored Sharpe and Max DD on the card, equal to the strip (D-06 with D-03)", async () => {
    const flags = { twr_chain_broken: true, headline_since: "2025-09-01" };
    const card = await renderOgCard(LONG, STORED_LONG, flags);
    const strip = renderStrip(LONG, STORED_LONG, flags);
    expect(card.sharpe.value).toBe("0.12");
    expect(card.maxDd.value).toBe("-3.7%");
    expect(card.sharpe.value).toBe(strip.sharpe);
    expect(card.maxDd.value).toBe(strip.maxDd);
  });
});

// ---------------------------------------------------------------------------
// Tone: a dash or a rounded zero carries none (D-07, B8, DESIGN.md)
// ---------------------------------------------------------------------------

/** The neutral text colour: no tone. */
const NEUTRAL = "#1A1A2E";

describe("the card colours only real, non-zero figures (D-07)", () => {
  const CLEAN = { sharpe: 0.12 };

  it.each([
    ["a NaN CAGR (stored null)", { ...CLEAN, cagr: null, max_drawdown: -0.0368 }, "cagr", undefined, "—"],
    ["a NaN Max DD (stored null)", { ...CLEAN, cagr: 0.0072, max_drawdown: null }, "maxDd", undefined, "—"],
    ["an exactly-zero Max DD", { ...CLEAN, cagr: 0.0072, max_drawdown: 0 }, "maxDd", undefined, "0.0%"],
    ["a -0.0004 Max DD", { ...CLEAN, cagr: 0.0072, max_drawdown: -0.0004 }, "maxDd", undefined, "0.0%"],
    ["a -0.0004 CAGR", { ...CLEAN, cagr: -0.0004, max_drawdown: -0.0368 }, "cagr", undefined, "0.0%"],
    ["a +0.0004 CAGR", { ...CLEAN, cagr: 0.0004, max_drawdown: -0.0368 }, "cagr", undefined, "0.0%"],
  ] as const)("%s has no tone and no colour", async (_name, stored, key, tone, text) => {
    const card = await renderOgCard(LONG, stored);
    expect(card[key].value).toBe(text);
    expect(card[key].tone).toBe(tone);
    expect(card[key].color).toBe(NEUTRAL);
  });

  it("a positive CAGR is pos (green), a negative CAGR is neg (red), a real drawdown is neg", async () => {
    const up = await renderOgCard(LONG, { sharpe: 0.12, cagr: 0.0072, max_drawdown: -0.0368 });
    expect(up.cagr.value).toBe("+0.7%");
    expect(up.cagr.tone).toBe("pos");
    expect(up.cagr.color).toBe("#15803D");
    expect(up.maxDd.value).toBe("-3.7%");
    expect(up.maxDd.tone).toBe("neg");
    expect(up.maxDd.color).toBe("#DC2626");

    const down = await renderOgCard(LONG, { sharpe: 0.12, cagr: -0.031, max_drawdown: -0.0368 });
    expect(down.cagr.value).toBe("-3.1%");
    expect(down.cagr.tone).toBe("neg");
    expect(down.cagr.color).toBe("#DC2626");
  });

  it("Sharpe never carries a tone", async () => {
    const card = await renderOgCard(LONG, { sharpe: 0.12, cagr: 0.0072, max_drawdown: -0.0368 });
    expect(card.sharpe.tone).toBeUndefined();
    expect(card.sharpe.color).toBe(NEUTRAL);
  });

  it("an E1 or E2 dash CAGR has no tone either (the dash is never coloured)", async () => {
    const card = await renderOgCard(SHORT, STORED_SHORT);
    expect(card.cagr.value).toBe("—");
    expect(card.cagr.tone).toBeUndefined();
    expect(card.cagr.color).toBe(NEUTRAL);
  });
});

// ---------------------------------------------------------------------------
// Plan 09 (B1-B6, D-07 with D-12's zeros): one string, one colour on both surfaces
// ---------------------------------------------------------------------------

describe("the card and the strip print and colour a rounded zero the same way (plan 09, D-07)", () => {
  const STRIP_NEUTRAL = "var(--color-text-primary)";

  it.each([
    ["-0.0004", -0.0004],
    ["exactly 0", 0],
  ])("a clean 400-day row with a stored Max DD of %s prints 0.0%% on both and neither colours it", async (_name, maxDd) => {
    const stored = { sharpe: 0.12, cagr: 0.0072, max_drawdown: maxDd };
    const card = await renderOgCard(LONG, stored);
    const strip = renderStrip(LONG, stored);
    expect(strip.maxDd).toBe("0.0%");
    expect(card.maxDd.value).toBe(strip.maxDd);
    expect(card.maxDd.color).toBe(NEUTRAL);
    expect(strip.colors.maxDd).toBe(STRIP_NEUTRAL);
  });

  it("a clean 400-day row with a stored CAGR of 0 prints 0.0% on both and neither colours it", async () => {
    const stored = { sharpe: 0.12, cagr: 0, max_drawdown: -0.0368 };
    const card = await renderOgCard(LONG, stored);
    const strip = renderStrip(LONG, stored);
    expect(strip.cagr).toBe("0.0%");
    expect(card.cagr.value).toBe(strip.cagr);
    expect(card.cagr.color).toBe(NEUTRAL);
    expect(strip.colors.cagr).toBe(STRIP_NEUTRAL);
  });

  it("control: a real CAGR and a real drawdown still carry their tone on both surfaces", async () => {
    const stored = { sharpe: 0.12, cagr: 0.0072, max_drawdown: -0.0368 };
    const card = await renderOgCard(LONG, stored);
    const strip = renderStrip(LONG, stored);
    expect(card.cagr.color).toBe("#15803D");
    expect(strip.colors.cagr).toBe("var(--color-positive)");
    expect(card.maxDd.color).toBe("#DC2626");
    expect(strip.colors.maxDd).toBe("var(--color-negative)");
  });
});

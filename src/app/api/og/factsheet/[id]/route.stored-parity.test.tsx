import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type { DailyReturn } from "@/lib/factsheet/types";
import { recordFromScalars, type RecordScalarRow } from "@/lib/figure-record-scalars";
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
 * disagree. CAGR keeps one NAMED exception (D-11): a chain-broken or short-window
 * headline whose stored CAGR covers only a suffix the card cannot see (E2).
 *
 * Phase 194.1 plan 06 (census B3, 194 D-15): the card is gated on the strategy's total
 * record like the strip, and its own sub-year CAGR rule (E1) is dropped, so the card and
 * the strip print the same Sharpe and the same CAGR for the same record, a dash for a
 * record under the minimum and the stored figures once it clears. The card's embed
 * fixture carries the four record alias scalars; the strip is given the record built
 * from the SAME scalars.
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
/** 400 daily points: a record long enough to need no short-record note. */
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
    // A unit card labels CAGR as "CAGR in BTC" (`withUnit`), so the label matches by that prefix too.
    if (
      typeof props.label === "string" &&
      (props.label === label || props.label.startsWith(`${label} in `)) &&
      typeof props.value === "string"
    ) {
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

/**
 * The four record alias scalars of a record that CLEARS the minimum and needs no
 * short-record note (400 covered days, 400 observations). Cases that compare stored
 * figures use it; the cases that pin the gate pass their own.
 */
const CLEARED_SCALARS: RecordScalarRow = {
  series_start: "2025-01-01",
  series_end: "2026-02-04",
  headline_since: null,
  record_observations: 400,
};
/** 25 covered days, 25 observations: under the crypto minimum. */
const SHORT_SCALARS: RecordScalarRow = {
  series_start: "2025-01-01",
  series_end: "2025-01-25",
  headline_since: null,
  record_observations: 25,
};
/** 200 covered days, 200 observations: cleared, under one year. */
const UNDER_YEAR_SCALARS: RecordScalarRow = {
  series_start: "2025-01-01",
  series_end: "2025-07-19",
  headline_since: null,
  record_observations: 200,
};

async function renderOgCard(
  series: DailyReturn[],
  stored: Stored,
  flags: Record<string, unknown> = {},
  scalars: RecordScalarRow = CLEARED_SCALARS,
  /** Columns that override the terminal-success fixture (a held re-run sets the status and `computed_at`). */
  analyticsOverride: Record<string, unknown> = {},
): Promise<{ sharpe: StatProps; cagr: StatProps; maxDd: StatProps; strings: string[]; cacheControl: string | null }> {
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
        ...scalars,
        ...analyticsOverride,
      },
    ],
  };
  const { GET } = await import("./route");
  const res = (await GET(new Request(`http://localhost:3000/api/og/factsheet/${ID}`), {
    params: Promise.resolve({ id: ID }),
  })) as unknown as { headers: Headers };
  expect(ogCalls.length, "the route must construct a card").toBeGreaterThan(0);
  const card = ogCalls[ogCalls.length - 1];
  const sharpe = ogStat(card, "Sharpe");
  const cagr = ogStat(card, "CAGR");
  const maxDd = ogStat(card, "Max DD");
  expect(sharpe, "the card must carry a Sharpe stat").toBeDefined();
  expect(cagr, "the card must carry a CAGR stat").toBeDefined();
  expect(maxDd, "the card must carry a Max DD stat").toBeDefined();
  return {
    sharpe: sharpe!,
    cagr: cagr!,
    maxDd: maxDd!,
    strings: ogStrings(card),
    cacheControl: res.headers.get("Cache-Control"),
  };
}

/** Every string anywhere in the card's element tree (children or props). */
function ogStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const c of node) ogStrings(c, out);
  } else if (node && typeof node === "object") {
    const props = (node as { props?: Record<string, unknown> }).props;
    if (props) for (const v of Object.values(props)) ogStrings(v, out);
  }
  return out;
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
  // Phase 194 plan 08 (D-15): the strip withholds its annualised cells when the strategy's TOTAL
  // record is under the minimum (a 24-day crypto record is). The strip is given the record built
  // from the same four alias scalars the card's embed carries (194.1 plan 06, B3), so both surfaces
  // judge one record; by default it is a record that clears the gate.
  scalars: RecordScalarRow = CLEARED_SCALARS,
): { sharpe: string; cagr: string; maxDd: string; colors: { cagr: string; maxDd: string } } {
  // The read path's own applier decides Dated vs Withheld; the strip is built
  // from what it returns, exactly as the page's real read path builds it.
  const applied = applyHeadlineBasis(cashSettlement(stored), flags);
  const opts: BuildFactsheetOpts = {
    metricsByBasis: { cash_settlement: applied.headline },
    ...(Object.keys(applied.quality).length > 0 ? { dataQuality: { composite: false, ...applied.quality } } : {}),
  };
  const built = buildFactsheetPayload(STRATEGY, series, opts);
  if (!built) throw new Error("fixture must build a payload");
  const payload = { ...built, figureRecord: recordFromScalars(scalars, "crypto") };
  const { container, unmount } = render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} hideHeader hideFooter />
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
// The named exception (D-11): CAGR only, exactly one (E2)
// ---------------------------------------------------------------------------

type CagrException = {
  id: "E2";
  /** Why the card withholds a CAGR the factsheet still shows. */
  reason: string;
  series: DailyReturn[];
  flags: Record<string, unknown>;
};

const EXCEPTIONS: CagrException[] = [
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

  // Phase 194.1 plan 06 (B3, D-15): both surfaces judge the SAME 25-day crypto record, so both
  // withhold Sharpe and CAGR with a dash and print the same stored Max DD. Hand-typed oracles
  // beside the equality, so a card that prints the stored Sharpe cannot pass.
  it("a 25-day crypto record: card and strip both print a dash for Sharpe and CAGR and the same Max DD", async () => {
    const card = await renderOgCard(SHORT, STORED_SHORT, {}, SHORT_SCALARS);
    const strip = renderStrip(SHORT, STORED_SHORT, {}, SHORT_SCALARS);
    expect([strip.sharpe, strip.cagr]).toEqual(["—", "—"]);
    expect([card.sharpe.value, card.cagr.value]).toEqual(["—", "—"]);
    expect(strip.maxDd).toBe("-3.7%");
    expect(card.maxDd.value).toBe(strip.maxDd);
  });

  // The pair of the case above: once the record clears, the card prints the stored CAGR at any
  // span (E1 dropped), as the strip does.
  it("a cleared 200-day crypto record: card and strip print the same stored Sharpe and the same stored CAGR", async () => {
    const card = await renderOgCard(SHORT, STORED_SHORT, {}, UNDER_YEAR_SCALARS);
    const strip = renderStrip(SHORT, STORED_SHORT, {}, UNDER_YEAR_SCALARS);
    expect(strip.sharpe).toBe("0.12");
    expect(strip.cagr).toBe("+0.7%");
    expect(card.sharpe.value).toBe(strip.sharpe);
    expect(card.cagr.value).toBe(strip.cagr);
    expect(card.maxDd.value).toBe(strip.maxDd);
    expect(strip.maxDd).toBe("-3.7%");
  });

  it("exactly one exception is named, for CAGR (D-11): E2", () => {
    expect(EXCEPTIONS.map((e) => e.id)).toEqual(["E2"]);
  });

  it.each(EXCEPTIONS.map((e) => [e.id, e] as const))(
    "%s: the card withholds CAGR where the strip shows one; Sharpe and Max DD still equal",
    async (_id, ex) => {
      const stored = STORED_LONG;
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

  it("a withheld 25-day record's dash CAGR and an E2 dash CAGR have no tone either (the dash is never coloured)", async () => {
    const withheld = await renderOgCard(SHORT, STORED_SHORT, {}, SHORT_SCALARS);
    expect(withheld.cagr.value).toBe("—");
    expect(withheld.cagr.tone).toBeUndefined();
    expect(withheld.cagr.color).toBe(NEUTRAL);
    const e2 = await renderOgCard(LONG, STORED_LONG, EXCEPTIONS[0].flags);
    expect(e2.cagr.value).toBe("—");
    expect(e2.cagr.tone).toBeUndefined();
    expect(e2.cagr.color).toBe(NEUTRAL);
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

// ---------------------------------------------------------------------------
// Phase 237 FACT-02 (plan 05): a held re-run keeps the stored figures on the card
// ---------------------------------------------------------------------------

/** The element whose own children are exactly `text`, with its style. */
function ogElementWithText(node: unknown, text: string): { style: Record<string, unknown> } | undefined {
  if (Array.isArray(node)) {
    for (const c of node) {
      const v = ogElementWithText(c, text);
      if (v) return v;
    }
    return undefined;
  }
  if (node && typeof node === "object") {
    const props = (node as { props?: Record<string, unknown> }).props;
    if (!props) return undefined;
    if (props.children === text) return { style: (props.style ?? {}) as Record<string, unknown> };
    return ogElementWithText(props.children, text);
  }
  return undefined;
}

describe("a held re-run: the card shows the strip's stored figures plus the Updating line (FACT-02, S5)", () => {
  // The marker makes this row a pending/computing row OVER a stored success result
  // (`hasStoredAnalyticsResult`: a series, a finite cumulative_return, a success marker).
  const HELD_FLAGS = { cumulative_method: "geometric" };
  const HELD = { computed_at: "2026-11-20T10:00:00Z" } as const;
  const UPDATING = "Updating with the latest data. These figures are from the last completed computation.";
  const HELD_CACHE = "public, max-age=60, s-maxage=60";

  it.each(["pending", "computing"] as const)(
    "a %s row over a stored success: the card equals the strip, the Updating line renders and the cache is the 60 s one",
    async (status) => {
      const card = await renderOgCard(LONG, STORED_LONG, HELD_FLAGS, CLEARED_SCALARS, {
        ...HELD,
        computation_status: status,
      });
      const strip = renderStrip(LONG, STORED_LONG, HELD_FLAGS);
      // Hand-typed oracles beside the equality, so two matching dashes cannot pass.
      expect(strip.sharpe).toBe("0.12");
      expect(strip.cagr).toBe("+0.7%");
      expect(strip.maxDd).toBe("-3.7%");
      expect(card.sharpe.value).toBe(strip.sharpe);
      expect(card.cagr.value).toBe(strip.cagr);
      expect(card.maxDd.value).toBe(strip.maxDd);
      expect(card.strings).toContain(UPDATING);
      expect(card.cacheControl).toBe(HELD_CACHE);
    },
  );

  it("control: the same row as complete prints the same figures with no Updating line and the long cache", async () => {
    const card = await renderOgCard(LONG, STORED_LONG, HELD_FLAGS, CLEARED_SCALARS, HELD);
    expect(card.sharpe.value).toBe("0.12");
    expect(card.strings).not.toContain(UPDATING);
    expect(card.cacheControl).toContain("s-maxage=86400");
  });

  it("the Updating line is #64748B at 20px; marginTop 24 alone, 8 after a figureNote, and after it in order", async () => {
    const alone = await renderOgCard(LONG, STORED_LONG, HELD_FLAGS, CLEARED_SCALARS, {
      ...HELD,
      computation_status: "computing",
    });
    const aloneEl = ogElementWithText(ogCalls[ogCalls.length - 1], UPDATING);
    expect(alone.strings).toContain(UPDATING);
    expect(aloneEl?.style).toMatchObject({ fontSize: 20, color: "#64748B", marginTop: 24 });

    await renderOgCard(LONG, STORED_LONG, HELD_FLAGS, UNDER_YEAR_SCALARS, {
      ...HELD,
      computation_status: "computing",
    });
    const card = ogCalls[ogCalls.length - 1];
    const strings = ogStrings(card);
    const noteIdx = strings.findIndex((s) => s.startsWith("Annualized from"));
    expect(noteIdx, "a cleared-under-one-year record draws the marker note").toBeGreaterThan(-1);
    expect(noteIdx).toBeLessThan(strings.indexOf(UPDATING));
    expect(ogElementWithText(card, UPDATING)?.style).toMatchObject({ fontSize: 20, color: "#64748B", marginTop: 8 });
  });

  it("held over a Dated row prints the strip's own Dated figures (G1: the hold changes WHETHER the result is read, never which figures print)", async () => {
    const flags = { ...HELD_FLAGS, twr_chain_broken: true, headline_since: "2025-09-01" };
    const card = await renderOgCard(LONG, STORED_LONG, flags, CLEARED_SCALARS, {
      ...HELD,
      computation_status: "computing",
    });
    const strip = renderStrip(LONG, STORED_LONG, flags);
    expect(card.sharpe.value).toBe("0.12");
    expect(card.maxDd.value).toBe("-3.7%");
    expect(card.sharpe.value).toBe(strip.sharpe);
    expect(card.maxDd.value).toBe(strip.maxDd);
    // E2: the card still withholds the suffix-only CAGR the strip shows.
    expect(card.cagr.value).toBe("—");
  });

  it("held over a Withheld (legacy chain-broken) row prints the strip's own three dashes (G1)", async () => {
    const flags = { ...HELD_FLAGS, twr_chain_broken: true };
    const card = await renderOgCard(LONG, STORED_LONG, flags, CLEARED_SCALARS, {
      ...HELD,
      computation_status: "computing",
    });
    const strip = renderStrip(LONG, STORED_LONG, flags);
    expect([strip.sharpe, strip.cagr, strip.maxDd]).toEqual(["—", "—", "—"]);
    expect([card.sharpe.value, card.cagr.value, card.maxDd.value]).toEqual(["—", "—", "—"]);
  });

  // ---- The factsheet's own refusals and the last success's flags (RESEARCH Pitfall 2, D-04) ----

  it("a computing row inside the derive prestamp window reads the last success's unit from its BOUND snapshot (Returns in BTC)", async () => {
    // The derive hop replaced the live flags with a prestamp (no `cumulative_method`) and carried
    // the last success's flags in `last_success_snapshot`, bound to the row's `computed_at`.
    const flags = {
      last_success_snapshot: {
        computed_at: HELD.computed_at,
        flags: { cumulative_method: "geometric", native_unit: "BTC" },
      },
    };
    const card = await renderOgCard(LONG, STORED_LONG, flags, CLEARED_SCALARS, {
      ...HELD,
      computation_status: "computing",
    });
    expect(card.strings).toContain("Quantalyze · Institutional Factsheet · Returns in BTC");
    expect(card.strings).toContain(UPDATING);
    expect(card.sharpe.value).toBe("0.12");
  });

  it("control: an UNBOUND snapshot (another computed_at) is never used, so the prestamp holds nothing and the card is three dashes, no line, no-store", async () => {
    const flags = {
      last_success_snapshot: {
        computed_at: "2026-01-01T00:00:00Z",
        flags: { cumulative_method: "geometric", native_unit: "BTC" },
      },
    };
    const card = await renderOgCard(LONG, STORED_LONG, flags, CLEARED_SCALARS, {
      ...HELD,
      computation_status: "computing",
    });
    expect([card.sharpe.value, card.cagr.value, card.maxDd.value]).toEqual(["—", "—", "—"]);
    expect(card.strings).not.toContain(UPDATING);
    expect(card.cacheControl).toBe("no-store");
  });

  it("a composite during a re-run: three dashes, no Updating line, no-store (matches the factsheet's queued state; RESEARCH A6)", async () => {
    const card = await renderOgCard(LONG, STORED_LONG, { ...HELD_FLAGS, composite: true }, CLEARED_SCALARS, {
      ...HELD,
      computation_status: "computing",
    });
    expect([card.sharpe.value, card.cagr.value, card.maxDd.value]).toEqual(["—", "—", "—"]);
    expect(card.strings).not.toContain(UPDATING);
    expect(card.cacheControl).toBe("no-store");
  });

  it("a failed row with stored evidence: three dashes, no line, no-store (never held)", async () => {
    const card = await renderOgCard(LONG, STORED_LONG, HELD_FLAGS, CLEARED_SCALARS, {
      ...HELD,
      computation_status: "failed",
    });
    expect([card.sharpe.value, card.cagr.value, card.maxDd.value]).toEqual(["—", "—", "—"]);
    expect(card.strings).not.toContain(UPDATING);
    expect(card.cacheControl).toBe("no-store");
  });

  it("D-04 behaviour change: a terminal-success row with an unbound derive prestamp prints three dashes and goes no-store, like the factsheet", async () => {
    // `last_success_snapshot` KEY present (null: the derive had nothing to carry), no marker.
    const card = await renderOgCard(LONG, STORED_LONG, { last_success_snapshot: null }, CLEARED_SCALARS, HELD);
    expect([card.sharpe.value, card.cagr.value, card.maxDd.value]).toEqual(["—", "—", "—"]);
    expect(card.strings).not.toContain(UPDATING);
    expect(card.cacheControl).toBe("no-store");
  });

  it("a held row inside the prestamp window reads the headline verdict from the effective flags: a snapshot Dated row prints its stored Sharpe", async () => {
    const flags = {
      last_success_snapshot: {
        computed_at: HELD.computed_at,
        flags: { cumulative_method: "geometric", twr_chain_broken: true, headline_since: "2025-09-01" },
      },
    };
    const card = await renderOgCard(LONG, STORED_LONG, flags, CLEARED_SCALARS, {
      ...HELD,
      computation_status: "computing",
    });
    expect(card.sharpe.value).toBe("0.12");
    expect(card.maxDd.value).toBe("-3.7%");
    // E2 reads the effective flags too: the stored CAGR covers only the suffix after the break.
    expect(card.cagr.value).toBe("—");
  });
});

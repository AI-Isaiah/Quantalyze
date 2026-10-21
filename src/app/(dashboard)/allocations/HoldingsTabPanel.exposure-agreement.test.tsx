import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 170.4 plan 02 (D-01, D-08). The cross-surface invariant.
 *
 * Plan 01 made Exposure, Holdings and Open Positions read ONE array. That alone
 * would also let all three agree on a WRONG answer, so this file pins the
 * answer per case with figures typed by hand from the fixture, and pins the
 * agreement from the rendered DOM.
 *
 * The path is the real one: `fetchLatestHoldingsPerKey` over a hand-rolled
 * client that honours the owner filter, then `derivePhase07Fields`, then
 * `HoldingsTabPanel` with the real HoldingsTable, OpenPositionsTable and
 * ExposureByClass. Nothing between the fixture and the DOM is mocked except
 * the shared optimizer chart.
 *
 * Every expected figure is a literal the author derived from the fixture, never
 * a number the code under test computed. The fixture amounts are multiples of
 * 100, so the compact currency strings the Exposure card renders ("$185.1K")
 * parse back to the exact integer.
 */

// The Optimizer mounts the shared PortfolioOptimizer via next/dynamic; no
// portfolio here, so it never mounts, but the stub keeps the import cheap.
vi.mock("@/components/portfolio/PortfolioOptimizer", () => ({
  default: () => <div data-testid="portfolio-optimizer-mock" />,
}));
// queries.ts imports the server-only Supabase clients; the derive under test is
// pure, so both are stubbed to nothing (same scaffolding as
// queries.holdings-per-key.test.ts).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { HoldingsTabPanel } from "./HoldingsTabPanel";
import { EMPTY_EXPOSURE } from "./lib/exposure-props";
import { fetchLatestHoldingsPerKey } from "@/lib/latest-holdings-per-key";
import { derivePhase07Fields } from "@/lib/queries";
import {
  holdingsByRef,
  keyStateMapsOf,
  summarizeLiveHoldings,
} from "./lib/live-holdings-summary";
import { formatCurrency } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The fake database. Copied in shape from latest-holdings-per-key.test.ts
// (that file's helpers are file-local). Honours eq, like, order and limit, and
// projects each answer to the select list, so a column the dashboard's read
// forgot to ask for is missing from the rows exactly as it would be live.
// Adds one thing the original lacks: a log of every query's eq filters, for the
// owner-fence pin.
// ---------------------------------------------------------------------------

type KeyFx = {
  id: string;
  user_id: string;
  exchange: string;
  label: string;
  venue_account_id: string | null;
  account_share_kind: string | null;
  account_shared_with_api_key_id: string | null;
  disconnected_at: string | null;
  /** 167.1.1 SC-1: the key's sync status as the payload carries it. Absent
   *  means "complete", which every describe before SC-1 relies on. */
  sync_status?: string;
};

type HoldingFx = {
  allocator_id: string;
  api_key_id: string;
  asof: string;
  updated_at: string;
  venue: string;
  symbol: string;
  holding_type: "spot" | "derivative";
  quantity: number;
  mark_price: number;
  value_usd: number;
  side: "long" | "short" | null;
  entry_price: number | null;
  unrealized_pnl_usd: number | null;
  quantity_unit: string | null;
};

type AuditFx = {
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
  // The fake has no JSON operators: the `metadata->>final_status` filter reads
  // this flattened copy, which `poll()` keeps equal to the metadata's.
  "metadata->>final_status": unknown;
};

type DerivedFx = { allocator_id: string; kind: string; payload: unknown };

type World = {
  keys: KeyFx[];
  holdings: HoldingFx[];
  audit?: AuditFx[];
  derived?: DerivedFx[];
};

type QueryLog = Array<{ table: string; eqs: Array<[string, unknown]> }>;

function fakeClient(world: World, log: QueryLog) {
  return {
    from(table: string) {
      const eqs: Array<[string, unknown]> = [];
      let likePrefix: { column: string; prefix: string } | null = null;
      let select = "";
      let order: { column: string; ascending: boolean } | null = null;
      let limit: number | null = null;
      const chain = {
        select(c: string) {
          select = c;
          return chain;
        },
        eq(c: string, v: unknown) {
          eqs.push([c, v]);
          return chain;
        },
        like(c: string, pattern: string) {
          likePrefix = { column: c, prefix: pattern.replace(/%$/, "") };
          return chain;
        },
        order(c: string, o: { ascending: boolean }) {
          order = { column: c, ascending: o.ascending };
          return chain;
        },
        limit(n: number) {
          limit = n;
          return chain;
        },
        then(resolve: (v: unknown) => void) {
          log.push({ table, eqs: [...eqs] });
          const source = (
            table === "api_keys"
              ? world.keys
              : table === "audit_log"
                ? (world.audit ?? [])
                : table === "allocator_equity_derived"
                  ? (world.derived ?? [])
                  : world.holdings
          ) as unknown as Array<Record<string, unknown>>;
          let rows = source.filter((r) => eqs.every(([c, v]) => r[c] === v));
          if (likePrefix) {
            const { column, prefix } = likePrefix;
            rows = rows.filter((r) => String(r[column]).startsWith(prefix));
          }
          if (order) {
            const { column, ascending } = order;
            rows = [...rows].sort(
              (a, b) =>
                (String(a[column]) < String(b[column]) ? -1 : 1) *
                (ascending ? 1 : -1),
            );
          }
          if (limit !== null) rows = rows.slice(0, limit);
          const columns = select.split(",").map((c) => c.trim());
          resolve({
            data: rows.map((r) =>
              Object.fromEntries(columns.map((c) => [c, r[c]])),
            ),
            error: null,
          });
        },
      };
      return chain;
    },
  } as unknown as Parameters<typeof fetchLatestHoldingsPerKey>[0];
}

/** A poll's success event for `keyId` (user-1), as `_emit_audit` records it. */
function poll(
  keyId: string,
  createdAt: string,
  metadata: Record<string, unknown> | null,
): AuditFx {
  return {
    user_id: "user-1",
    action: "allocator.holdings.sync_completed",
    entity_type: "api_key",
    entity_id: keyId,
    created_at: createdAt,
    metadata,
    "metadata->>final_status":
      metadata && typeof metadata.final_status === "string"
        ? metadata.final_status
        : null,
  };
}

/** The poll's record that a native-unit account's newest day was unpriced. */
const unpricedMarker = (keyId: string, asof: string): DerivedFx => ({
  allocator_id: "user-1",
  kind: `native_unpriced:${keyId}`,
  payload: { native_unpriced: true, asof },
});

const key = (
  id: string,
  exchange: string,
  label: string,
  over: Partial<KeyFx> = {},
): KeyFx => ({
  id,
  user_id: "user-1",
  exchange,
  label,
  venue_account_id: null,
  account_share_kind: null,
  account_shared_with_api_key_id: null,
  disconnected_at: null,
  ...over,
});

const spot = (
  api_key_id: string,
  venue: string,
  asof: string,
  updated_at: string,
  symbol: string,
  value_usd: number,
  over: Partial<HoldingFx> = {},
): HoldingFx => ({
  allocator_id: "user-1",
  api_key_id,
  asof,
  updated_at,
  venue,
  symbol,
  holding_type: "spot",
  quantity: 1,
  mark_price: value_usd,
  value_usd,
  side: null,
  entry_price: null,
  unrealized_pnl_usd: null,
  quantity_unit: null,
  ...over,
});

const deriv = (
  api_key_id: string,
  venue: string,
  asof: string,
  updated_at: string,
  symbol: string,
  side: "long" | "short",
  value_usd: number,
  over: Partial<HoldingFx> = {},
): HoldingFx => ({
  ...spot(api_key_id, venue, asof, updated_at, symbol, value_usd),
  holding_type: "derivative",
  side,
  ...over,
});

// ---------------------------------------------------------------------------
// The real read -> derive -> render path.
// ---------------------------------------------------------------------------

/** The column string the dashboard passes (queries.ts), pinned by a source lock below. */
const DASHBOARD_COLUMNS =
  "symbol, quantity, mark_price, value_usd, venue, holding_type, asof, api_key_id, side, entry_price, unrealized_pnl_usd, quantity_unit, updated_at";

type DerivedFields = ReturnType<typeof derivePhase07Fields>;

async function readBook(world: World) {
  const log: QueryLog = [];
  const res = await fetchLatestHoldingsPerKey(
    fakeClient(world, log),
    "user-1",
    DASHBOARD_COLUMNS,
  );
  expect(res.error).toBeNull();
  // The owner's own keys, in the shape the payload carries them.
  const apiKeys = world.keys
    .filter((k) => k.user_id === "user-1")
    .map((k) => ({
      id: k.id,
      is_active: true,
      exchange: k.exchange,
      label: k.label,
      sync_status: k.sync_status ?? "complete",
      last_sync_at: "2026-10-04T04:00:00+00:00",
      disconnected_at: k.disconnected_at,
      venue_account_id: k.venue_account_id,
      account_share_kind: k.account_share_kind,
      account_shared_with_api_key_id: k.account_shared_with_api_key_id,
    }));
  const phase07 = derivePhase07Fields(
    apiKeys,
    [],
    0,
    res.data as Parameters<typeof derivePhase07Fields>[3],
    false,
    null,
    res.partialReads,
    res.accountByKey,
  );
  return { log, apiKeys, phase07 };
}

function renderPanel(book: { apiKeys: unknown[]; phase07: DerivedFields }) {
  const payload = {
    portfolio: null,
    analytics: null,
    apiKeys: book.apiKeys,
    alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
    outcomes: [],
    equitySnapshots: [],
    holdingsSummary: book.phase07.holdingsSummary,
    partialPositionReads: book.phase07.partialPositionReads,
    hasConnectedKeys: book.phase07.hasConnectedKeys,
    snapshotCount: 30,
    allKeysStale: false,
    lastSyncAt: null,
    hasSyncing: false,
    equityDailyPoints: [],
    minHistoryDepthMonths: null,
    activeVenues: [],
    flaggedHoldings: [],
    matchDecisionsByHoldingRef: {},
    strategies: [],
    exposure: EMPTY_EXPOSURE,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<HoldingsTabPanel {...(payload as any)} />);
}

// ---------------------------------------------------------------------------
// Three DOM readers. A row is the token `key|venue|symbol|type`, where `key` is
// the key name the surface shows, so two keys' rows of one symbol stay two
// tokens. Money is parsed back from the rendered text.
// ---------------------------------------------------------------------------

const MONEY = /-?\$[\d,]+(?:\.\d+)?[KM]?/;

function parseMoney(text: string): number {
  const m = MONEY.exec(text);
  if (m === null) throw new Error(`no money in ${JSON.stringify(text)}`);
  const raw = m[0];
  const sign = raw.startsWith("-") ? -1 : 1;
  const scale = raw.endsWith("K") ? 1_000 : raw.endsWith("M") ? 1_000_000 : 1;
  const digits = raw.replace(/[-$,KM]/g, "");
  return sign * Math.round(parseFloat(digits) * scale);
}

function section(heading: string): HTMLElement {
  return screen
    .getByRole("heading", { name: heading })
    .closest("section") as HTMLElement;
}

function bodyRows(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("tbody > tr"));
}

/** `Okx · ETH` -> venue `okx`, symbol `ETH`. */
function venueAndSymbol(cell: Element): { venue: string; symbol: string } {
  const label = cell.querySelector("span.font-medium")?.textContent ?? "";
  const [venue, ...rest] = label.split(" · ");
  return { venue: venue.toLowerCase(), symbol: rest.join(" · ") };
}

function captionOf(cell: Element): string {
  return cell.querySelector('[data-testid="holding-key-label"]')?.textContent ?? "—";
}

/** Holdings table rows: spot only. */
function holdingsTokens(): string[] {
  return bodyRows(section("Holdings"))
    .map((tr) => {
      const cells = tr.querySelectorAll("td");
      const { venue, symbol } = venueAndSymbol(cells[0]);
      const type = cells[1].textContent === "Spot" ? "spot" : "derivative";
      return `${captionOf(cells[0])}|${venue}|${symbol}|${type}`;
    })
    .sort();
}

function holdingsTotal(): number {
  return bodyRows(section("Holdings")).reduce(
    (sum, tr) => sum + parseMoney(tr.querySelectorAll("td")[4].textContent ?? ""),
    0,
  );
}

function openPositionTokens(): string[] {
  return bodyRows(section("Open Positions"))
    .map((tr) => {
      const first = tr.querySelectorAll("td")[0];
      const { venue, symbol } = venueAndSymbol(first);
      return `${captionOf(first)}|${venue}|${symbol}|derivative`;
    })
    .sort();
}

function openPositionsNotional(): number {
  return bodyRows(section("Open Positions")).reduce((sum, tr) => {
    const cell = tr.querySelector('td[title^="Notional exposure"]');
    return sum + parseMoney(cell?.textContent ?? "");
  }, 0);
}

function exposureSection(): HTMLElement {
  return document.querySelector('section[aria-label="Exposure"]') as HTMLElement;
}

function exposureTokens(): string[] {
  return bodyRows(exposureSection())
    .map((tr) => {
      const c = Array.from(tr.querySelectorAll("td")).map((td) => td.textContent ?? "");
      // Venue | Key | Symbol | Type | Side | Gross | Net
      // Venue prints its display name since 170.1.2 WR-02; compare by code, as
      // venueAndSymbol does for the other two surfaces.
      return `${c[1]}|${c[0].toLowerCase()}|${c[2]}|${c[3] === "Spot" ? "spot" : "derivative"}`;
    })
    .sort();
}

function exposureKpi(testid: string): string {
  return within(exposureSection()).getByTestId(testid).textContent ?? "";
}

/** The card's gross, or null on the empty card (which renders no KPI strip). */
function exposureGross(): { text: string; value: number } | null {
  const el = within(exposureSection()).queryByTestId("kpi-gross");
  return el === null
    ? null
    : { text: el.textContent ?? "", value: parseMoney(el.textContent ?? "") };
}

/** Everything the three surfaces say, read once. */
function readSurfaces() {
  return {
    holdings: holdingsTokens(),
    positions: openPositionTokens(),
    exposure: exposureTokens(),
    holdingsTotal: holdingsTotal(),
    positionsTotal: openPositionsNotional(),
    gross: exposureGross(),
  };
}

const union = (a: string[], b: string[]) => [...a, ...b].sort();

// ---------------------------------------------------------------------------
// Fixtures. Every figure is typed by hand.
// ---------------------------------------------------------------------------

const DAY_3 = "2026-10-03";
const T_3 = "2026-10-03T04:00:00+00:00";

/** The 2026-10-03 PROD reading: 3 Deribit positions, 185,100 gross. */
const deribitBook = (): HoldingFx[] => [
  deriv("key-deribit", "deribit", DAY_3, T_3, "BTC-PERP", "long", 100000),
  deriv("key-deribit", "deribit", DAY_3, T_3, "ETH-PERP", "short", 50000),
  deriv("key-deribit", "deribit", DAY_3, T_3, "BTC-27DEC26-60000-C", "long", 35100),
];

const DERIBIT_KEY = key("key-deribit", "deribit", "Main");

/** The poll on the day after, with every option closed or expired. */
const cleanEmptyPollOfKeyDeribit = () =>
  poll("key-deribit", "2026-10-04T04:00:07+00:00", {
    final_status: "complete",
    row_count: 0,
    asof: "2026-10-04",
  });

beforeEach(() => {
  // HoldingNoteRow reads its note on mount; nothing is saved here.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the read column string is the dashboard's own", () => {
  it("queries.ts passes exactly the column string this file reads with", () => {
    // Without this a fixture could keep working after the dashboard's read
    // dropped a column the derive needs (the fake projects to the select list).
    const src = readFileSync(join(process.cwd(), "src/lib/queries.ts"), "utf8");
    expect(src).toContain(`"${DASHBOARD_COLUMNS}"`);
  });
});

describe("Exposure, Holdings and Open Positions give one answer (D-01)", () => {
  it("reference book, no later poll: the 3 Deribit positions are on Exposure and Open Positions, and Holdings is empty", async () => {
    const book = await readBook({ keys: [DERIBIT_KEY], holdings: deribitBook() });
    renderPanel(book);
    const s = readSurfaces();

    const THREE = [
      "Deribit — Main|deribit|BTC-27DEC26-60000-C|derivative",
      "Deribit — Main|deribit|BTC-PERP|derivative",
      "Deribit — Main|deribit|ETH-PERP|derivative",
    ];
    expect(s.exposure).toEqual(THREE);
    expect(s.positions).toEqual(THREE);
    expect(s.holdings).toEqual([]);
    expect(s.exposure).toEqual(union(s.holdings, s.positions));

    // 100000 + 50000 + 35100.
    expect(s.holdingsTotal).toBe(0);
    expect(s.positionsTotal).toBe(185100);
    expect(s.gross?.value).toBe(185100);
    expect(s.gross?.text).toBe(formatCurrency(185100));
    expect(s.gross?.value).toBe(s.holdingsTotal + s.positionsTotal);
    // Net: +100000 - 50000 + 35100.
    expect(parseMoney(exposureKpi("kpi-net"))).toBe(85100);
  });

  it("the PROD 2026-10-03 shape: a clean empty poll the next day empties all three surfaces", async () => {
    const book = await readBook({
      keys: [DERIBIT_KEY],
      holdings: deribitBook(),
      audit: [cleanEmptyPollOfKeyDeribit()],
    });
    renderPanel(book);
    const s = readSurfaces();

    expect(s.exposure).toEqual([]);
    expect(s.holdings).toEqual([]);
    expect(s.positions).toEqual([]);
    expect(s.gross).toBeNull();
    expect(s.holdingsTotal).toBe(0);
    expect(s.positionsTotal).toBe(0);
    expect(exposureSection().textContent).toContain("No current positions.");
    expect(section("Holdings").textContent).toContain("No holdings to display.");
    expect(section("Open Positions").textContent).toContain(
      "No open derivative positions.",
    );
  });
});

describe("every supersession rule removes a row from all three surfaces together", () => {
  const mixedBook = (): World => ({
    keys: [
      key("key-btc", "mt5", "Gold"),
      key("key-okx-old", "okx", "Legacy", {
        venue_account_id: "acct-O",
        disconnected_at: "2026-09-25T00:00:00+00:00",
      }),
      key("key-okx-new", "okx", "Alpha", { venue_account_id: "acct-O" }),
      key("key-binance", "binance", "Beta", { venue_account_id: "acct-B" }),
      DERIBIT_KEY,
      // A rotated key whose replacement then read the account as empty.
      key("key-bybit-old", "bybit", "Rotated", {
        venue_account_id: "acct-Y",
        disconnected_at: "2026-09-25T00:00:00+00:00",
      }),
      key("key-bybit-new", "bybit", "Fresh", { venue_account_id: "acct-Y" }),
      // Another allocator, in the same tables.
      key("key-x", "binance", "Foreign", { user_id: "user-2" }),
    ],
    holdings: [
      // Native-unit account whose newest poll left it unpriced.
      spot("key-btc", "mt5", "2026-10-01", "2026-10-01T04:00:00+00:00", "ACCOUNT-BTC", 20000),
      // The same OKX account read by a departed key, then by its replacement.
      spot("key-okx-old", "okx", "2026-09-20", "2026-09-20T04:00:00+00:00", "SOL", 5000),
      spot("key-okx-new", "okx", "2026-10-02", "2026-10-02T04:00:00+00:00", "ETH", 7000),
      deriv("key-okx-new", "okx", "2026-10-02", "2026-10-02T04:00:00+00:00", "BTC-USDT-SWAP", "short", 30000),
      // A key's own older day gives way to its own latest day.
      spot("key-binance", "binance", "2026-09-30", "2026-09-30T04:00:00+00:00", "XRP", 1000),
      spot("key-binance", "binance", "2026-10-02", "2026-10-02T04:00:00+00:00", "BTC", 40000),
      // The old Bybit key's last read. The account's newer key polled it clean
      // and empty on 2026-10-02, so nothing of it stands. The derive's own
      // account rule cannot see that (the new key wrote no row), only the reader.
      spot("key-bybit-old", "bybit", "2026-09-15", "2026-09-15T04:00:00+00:00", "LTC", 3000),
      // The 2026-10-03 Deribit book, superseded by the clean poll below.
      ...deribitBook(),
      // Another allocator's position.
      spot("key-x", "binance", "2026-10-02", "2026-10-02T04:00:00+00:00", "DOGE", 999, {
        allocator_id: "user-2",
      }),
    ],
    audit: [
      cleanEmptyPollOfKeyDeribit(),
      poll("key-bybit-new", "2026-10-02T04:00:09+00:00", {
        final_status: "complete",
        row_count: 0,
        asof: "2026-10-02",
      }),
      // The foreign key's clean poll must not touch anything of user-1's.
      { ...poll("key-x", "2026-10-03T04:00:00+00:00", { final_status: "complete", row_count: 1, asof: "2026-10-03" }), user_id: "user-2" },
    ],
    derived: [unpricedMarker("key-btc", "2026-10-02")],
  });

  it("native_unpriced, a replaced key on one account, an older day and a clean empty poll: one book on three surfaces", async () => {
    const book = await readBook(mixedBook());
    renderPanel(book);
    const s = readSurfaces();

    // Spot: ETH (OKX Alpha) 7000, BTC (Binance Beta) 40000. Derivative: the
    // OKX swap 30000. Absent: ACCOUNT-BTC (native_unpriced:key-btc), SOL (the
    // account's newer key read later), XRP (an older day), the three Deribit
    // positions (clean empty poll), LTC (the rotated Bybit account read empty
    // since), DOGE (user-2).
    expect(s.holdings).toEqual([
      "Binance — Beta|binance|BTC|spot",
      "OKX — Alpha|okx|ETH|spot",
    ]);
    expect(s.positions).toEqual(["OKX — Alpha|okx|BTC-USDT-SWAP|derivative"]);
    expect(s.exposure).toEqual([
      "Binance — Beta|binance|BTC|spot",
      "OKX — Alpha|okx|BTC-USDT-SWAP|derivative",
      "OKX — Alpha|okx|ETH|spot",
    ]);
    expect(s.exposure).toEqual(union(s.holdings, s.positions));

    // 7000 + 40000.
    expect(s.holdingsTotal).toBe(47000);
    // The swap's notional.
    expect(s.positionsTotal).toBe(30000);
    // 7000 + 40000 + 30000.
    expect(s.gross?.value).toBe(77000);
    expect(s.gross?.value).toBe(s.holdingsTotal + s.positionsTotal);
    // Net: 7000 + 40000 - 30000. Long: 7000 + 40000. Short: 30000.
    expect(parseMoney(exposureKpi("kpi-net"))).toBe(17000);
    expect(parseMoney(exposureKpi("kpi-long"))).toBe(47000);
    expect(parseMoney(exposureKpi("kpi-short"))).toBe(30000);

    // Nothing superseded or foreign is on any surface, whatever its symbol.
    const everything = document.body.textContent ?? "";
    for (const gone of ["ACCOUNT-BTC", "SOL", "XRP", "LTC", "DOGE", "ETH-PERP"]) {
      expect(everything).not.toContain(gone);
    }
  });

  it("owner fence: every read step carries the owner's id filter, and no other allocator is ever asked for", async () => {
    const { log } = await readBook(mixedBook());

    const ownerColumn: Record<string, string> = {
      api_keys: "user_id",
      allocator_holdings: "allocator_id",
      allocator_equity_derived: "allocator_id",
      audit_log: "user_id",
    };
    // The reader reaches all four tables on this fixture, so an empty log for
    // one of them cannot pass the loop below vacuously.
    for (const table of Object.keys(ownerColumn)) {
      expect(log.filter((q) => q.table === table).length).toBeGreaterThan(0);
    }
    // Only these four tables are read.
    expect(log.map((q) => q.table).filter((t) => !(t in ownerColumn))).toEqual([]);
    for (const q of log) {
      expect(q.eqs).toContainEqual([ownerColumn[q.table], "user-1"]);
    }
    expect(log.flatMap((q) => q.eqs.map(([, v]) => v))).not.toContain("user-2");
  });
});

describe("one key is one strategy: two live keys on one symbol are two rows everywhere (D-08, D-10)", () => {
  const ONE = key("key-bin-1", "binance", "One", { venue_account_id: "acct-B1" });
  const TWO = key("key-bin-2", "binance", "Two", { venue_account_id: "acct-B2" });
  const THREE_KEY = key("key-bin-3", "binance", "Three", { venue_account_id: "acct-B1" });

  const BOTH_BTC = [
    "Binance — One|binance|BTC|spot",
    "Binance — Two|binance|BTC|spot",
  ];

  it("different accounts, different days: two BTC rows, two slices, every total 65000", async () => {
    const book = await readBook({
      keys: [ONE, TWO],
      holdings: [
        spot("key-bin-1", "binance", "2026-10-02", "2026-10-02T04:00:00+00:00", "BTC", 40000),
        spot("key-bin-2", "binance", "2026-10-03", "2026-10-03T04:00:00+00:00", "BTC", 25000),
      ],
    });
    renderPanel(book);
    const s = readSurfaces();

    expect(s.holdings).toEqual(BOTH_BTC);
    expect(s.positions).toEqual([]);
    expect(s.exposure).toEqual(BOTH_BTC);
    // 40000 + 25000.
    expect(s.holdingsTotal).toBe(65000);
    expect(s.gross?.value).toBe(65000);
    expect(s.positionsTotal).toBe(0);
  });

  it("different accounts, the same day: the same two rows and slices, every total 65000", async () => {
    const book = await readBook({
      keys: [ONE, TWO],
      holdings: [
        spot("key-bin-1", "binance", "2026-10-02", "2026-10-02T04:00:00+00:00", "BTC", 40000),
        spot("key-bin-2", "binance", "2026-10-02", "2026-10-02T04:00:30+00:00", "BTC", 25000),
      ],
    });
    renderPanel(book);
    const s = readSurfaces();

    expect(s.holdings).toEqual(BOTH_BTC);
    expect(s.exposure).toEqual(BOTH_BTC);
    expect(s.holdingsTotal).toBe(65000);
    expect(s.gross?.value).toBe(65000);
  });

  it("one account read by two keys on one day counts once: the later write wins, beside a second account", async () => {
    // key-bin-1 and key-bin-3 are ONE account (acct-B1). key-bin-3 wrote later,
    // 04:02:10.5 against 04:00:05.123456, so its 30000 is the account's BTC and
    // key-bin-1's 40000 does not count. key-bin-2 (acct-B2) keeps its 25000.
    const book = await readBook({
      keys: [ONE, TWO, THREE_KEY],
      holdings: [
        spot("key-bin-1", "binance", "2026-10-02", "2026-10-02T04:00:05.123456+00:00", "BTC", 40000),
        spot("key-bin-3", "binance", "2026-10-02", "2026-10-02T04:02:10.5Z", "BTC", 30000),
        spot("key-bin-2", "binance", "2026-10-02", "2026-10-02T04:00:30+00:00", "BTC", 25000),
      ],
    });
    renderPanel(book);
    const s = readSurfaces();

    const WINNERS = [
      "Binance — Three|binance|BTC|spot",
      "Binance — Two|binance|BTC|spot",
    ];
    expect(s.holdings).toEqual(WINNERS);
    expect(s.exposure).toEqual(WINNERS);
    // 30000 + 25000. Counting the account twice would read 95000.
    expect(s.holdingsTotal).toBe(55000);
    expect(s.gross?.value).toBe(55000);
  });
});

describe("167.1.1 SC-1: two keys, one venue and asset, in the AUM, Open Positions and the marker", () => {
  // key-a is healthy; key-b is revoked. Different accounts, so D-08 (one row
  // per key) applies, not D-10 (one key per account per day).
  const KEY_A = key("key-a", "binance", "Alpha", { venue_account_id: "acct-A1" });
  const KEY_B = key("key-b", "binance", "Beta", {
    venue_account_id: "acct-B1",
    sync_status: "revoked",
  });

  // key-b's rows carry the OLDER asof on purpose: the derive keeps the first
  // row of an equal-asof tie, and input order is not guaranteed, so only a
  // strictly older day makes the booked key (scope key alone) deterministically
  // drop key-b. Nothing here is a tie.
  const world = (): World => ({
    keys: [KEY_A, KEY_B],
    holdings: [
      spot("key-a", "binance", "2026-10-03", "2026-10-03T04:00:00+00:00", "BTC", 40000),
      spot("key-b", "binance", "2026-10-02", "2026-10-02T04:00:00+00:00", "BTC", 25000),
      deriv("key-a", "binance", "2026-10-03", "2026-10-03T04:00:00+00:00", "BTC-USDT-SWAP", "long", 100000, {
        unrealized_pnl_usd: 1200,
      }),
      deriv("key-b", "binance", "2026-10-02", "2026-10-02T04:00:00+00:00", "BTC-USDT-SWAP", "short", 50000, {
        unrealized_pnl_usd: -300,
      }),
    ],
  });

  const SPOT_REF = "holding:binance:BTC:spot";
  const SWAP_REF = "holding:binance:BTC-USDT-SWAP:derivative";

  /** The summarizer's arguments the way the composer builds them: the payload's
   *  key list through `keyStateMapsOf`, the derive's rows through `holdingsByRef`. */
  function markerArgs(
    book: Awaited<ReturnType<typeof readBook>>,
    contributingApiKeyIds: string[],
  ): Parameters<typeof summarizeLiveHoldings>[0] {
    const { statusByKeyId, disconnectedAtByKeyId } = keyStateMapsOf(book.apiKeys);
    return {
      toggleByScopeRef: { [SPOT_REF]: true, [SWAP_REF]: true },
      holdingsByRef: holdingsByRef(book.phase07.holdingsSummary),
      contributingApiKeyIds,
      managerSideApiKeyIds: [],
      statusByKeyId,
      disconnectedAtByKeyId,
      eligibleApiKeyIds: undefined,
    };
  }

  it("Holdings: both keys' BTC spot rows survive and total 65000", async () => {
    const book = await readBook(world());
    renderPanel(book);
    const s = readSurfaces();

    expect(s.holdings).toEqual([
      "Binance — Alpha|binance|BTC|spot",
      "Binance — Beta|binance|BTC|spot",
    ]);
    // 40000 + 25000.
    expect(s.holdingsTotal).toBe(65000);
  });

  it("Open Positions: both keys' swap rows survive, and the revoked key's part is disclosed", async () => {
    const book = await readBook(world());
    renderPanel(book);
    const s = readSurfaces();

    expect(s.positions).toEqual([
      "Binance — Alpha|binance|BTC-USDT-SWAP|derivative",
      "Binance — Beta|binance|BTC-USDT-SWAP|derivative",
    ]);
    // 100000 + 50000.
    expect(s.positionsTotal).toBe(150000);
    expect(
      within(section("Open Positions")).getByTestId("open-positions-untrusted-note"),
    ).toBeTruthy();
  });

  it("the 167.1 marker, degrade branch: key-b's part is 24700 over 2 rows inside a total of 65900", async () => {
    const book = await readBook(world());
    const byRef = holdingsByRef(book.phase07.holdingsSummary);
    // Two rows under each ref: one per key.
    expect(byRef.get(SPOT_REF)?.length).toBe(2);
    expect(byRef.get(SWAP_REF)?.length).toBe(2);

    const m = summarizeLiveHoldings(markerArgs(book, []));
    // Spot 40000 + 25000, swap equity 1200 + -300.
    expect(m.total).toBe(65900);
    // key-b: 25000 + -300.
    expect(m.untrusted.amount).toBe(24700);
    expect(m.untrusted.count).toBe(2);
  });

  it("the 167.1 marker, narrowed branch (what production runs): key-a is the total, key-b is excluded and named", async () => {
    // Round-1 WR-02. In production `contributingApiKeyIds` is a subset of the
    // eligible keys, and eligibility excludes a revoked key, so key-b is NEVER
    // contributing here. Passing ["key-a", "key-b"] asserted a state the payload
    // cannot produce. The narrowed branch leaves key-b's rows out of `total`
    // and puts them in `excludedUntrusted`, which is what this arm pins.
    const book = await readBook(world());
    const m = summarizeLiveHoldings({
      ...markerArgs(book, ["key-a"]),
      eligibleApiKeyIds: ["key-a"],
    });

    // Hand-typed oracle, never read back from the code under test.
    // total = key-a only: spot 40000 + swap equity 1200 (the derivative counts
    // its unrealized P&L, not the 100000 notional) = 41200.
    expect(m.total).toBe(41200);
    // excludedUntrusted = key-b only: spot 25000 + swap equity -300 = 24700,
    // over 2 rows (one spot, one swap).
    expect(m.excludedUntrusted.amount).toBe(24700);
    expect(m.excludedUntrusted.count).toBe(2);
    // Nothing of key-b is in the total, so the includes-side part is empty.
    expect(m.untrusted.count).toBe(0);
    expect(m.untrusted.amount).toBe(0);
    // Under the booked key (scope key without api_key_id) key-b's older rows
    // are dropped by the derive, so the count above falls 2 -> 0.
  });
});

// ---------------------------------------------------------------------------
// Phase 167.1.2.1.2 plan 01 (D-02, SC-2, UI-SPEC E3). A key polled clean and
// empty on the rows' OWN day, as its newest poll, leaves all three surfaces
// together. The three read one array, so one hide rule at the reader moves all
// three; this pins it from the fixture to the DOM. Figures are typed by hand.
// ---------------------------------------------------------------------------
describe("a same-day clean empty newest poll removes the key from all three surfaces (D-02)", () => {
  const MORNING = "2026-10-03T04:00:00+00:00";
  const NOON = "2026-10-03T11:00:00+00:00";
  const cleanPoll = (keyId: string, createdAt: string, rowCount: number) =>
    poll(keyId, createdAt, { final_status: "complete", row_count: rowCount, asof: DAY_3 });

  const BETA = key("key-binance", "binance", "Beta", { venue_account_id: "acct-B" });
  const ALPHA = key("key-okx", "okx", "Alpha", { venue_account_id: "acct-O" });

  it("the emptied key's spot and derivative rows leave Holdings, Open Positions and Exposure; the other key's stay", async () => {
    // WHY: a closed position must stop showing the day it is polled empty, on every
    // surface that reads the one array, and the three must agree on the total.
    const book = await readBook({
      keys: [ALPHA, BETA],
      holdings: [
        // Alpha closed everything this afternoon; its morning rows are still upserted.
        spot("key-okx", "okx", DAY_3, MORNING, "ETH", 7000),
        deriv("key-okx", "okx", DAY_3, MORNING, "BTC-USDT-SWAP", "short", 30000),
        // Beta is untouched.
        spot("key-binance", "binance", DAY_3, MORNING, "BTC", 40000),
        deriv("key-binance", "binance", DAY_3, MORNING, "BTC-PERP", "long", 20000),
      ],
      audit: [
        cleanPoll("key-okx", MORNING, 2),
        cleanPoll("key-okx", NOON, 0),
        cleanPoll("key-binance", MORNING, 2),
      ],
    });
    renderPanel(book);
    const s = readSurfaces();

    expect(s.holdings).toEqual(["Binance — Beta|binance|BTC|spot"]);
    expect(s.positions).toEqual(["Binance — Beta|binance|BTC-PERP|derivative"]);
    expect(s.exposure).toEqual([
      "Binance — Beta|binance|BTC-PERP|derivative",
      "Binance — Beta|binance|BTC|spot",
    ]);
    expect(s.exposure).toEqual(union(s.holdings, s.positions));
    // Spot 40000 only.
    expect(s.holdingsTotal).toBe(40000);
    // The one remaining swap's notional.
    expect(s.positionsTotal).toBe(20000);
    // 40000 + 20000.
    expect(s.gross?.value).toBe(60000);
    expect(s.gross?.value).toBe(s.holdingsTotal + s.positionsTotal);

    const everything = document.body.textContent ?? "";
    for (const gone of ["ETH", "BTC-USDT-SWAP"]) {
      expect(everything).not.toContain(gone);
    }
  });

  it("E3: when the emptied key held the book's only derivative rows, Open Positions renders its existing empty state and the other key's spot rows still render", async () => {
    // WHY: UI-SPEC E3 adds no element; the hidden rows leave the derivative table empty
    // and the empty state that already exists is the whole message.
    const book = await readBook({
      keys: [DERIBIT_KEY, BETA],
      holdings: [
        ...deribitBook(),
        spot("key-binance", "binance", DAY_3, T_3, "BTC", 40000),
        spot("key-binance", "binance", DAY_3, T_3, "ETH", 7000),
      ],
      audit: [cleanPoll("key-deribit", T_3, 3), cleanPoll("key-deribit", NOON, 0)],
    });
    renderPanel(book);
    const s = readSurfaces();

    expect(s.positions).toEqual([]);
    expect(section("Open Positions").textContent).toContain("No open derivative positions.");
    expect(s.holdings).toEqual([
      "Binance — Beta|binance|BTC|spot",
      "Binance — Beta|binance|ETH|spot",
    ]);
    // 40000 + 7000; the 185100 of Deribit is gone.
    expect(s.holdingsTotal).toBe(47000);
    expect(s.gross?.value).toBe(47000);
    expect(s.positionsTotal).toBe(0);
    expect(document.body.textContent ?? "").not.toContain("BTC-PERP");
  });

  it("a LATER warnings poll keeps the emptied key's rows on all three surfaces (the second condition)", async () => {
    // WHY: a warnings poll after the empty one may have written spot rows; the newest poll
    // of any outcome is not clean, so nothing proves the key is flat.
    const book = await readBook({
      keys: [DERIBIT_KEY, BETA],
      holdings: [
        ...deribitBook(),
        spot("key-binance", "binance", DAY_3, T_3, "BTC", 40000),
      ],
      audit: [
        cleanPoll("key-deribit", T_3, 0),
        poll("key-deribit", NOON, {
          final_status: "complete_with_warnings",
          row_count: 3,
          asof: DAY_3,
        }),
      ],
    });
    renderPanel(book);
    const s = readSurfaces();

    expect(s.positions).toEqual([
      "Deribit — Main|deribit|BTC-27DEC26-60000-C|derivative",
      "Deribit — Main|deribit|BTC-PERP|derivative",
      "Deribit — Main|deribit|ETH-PERP|derivative",
    ]);
    // 40000 spot + 185100 of Deribit notional.
    expect(s.gross?.value).toBe(225100);
  });
});

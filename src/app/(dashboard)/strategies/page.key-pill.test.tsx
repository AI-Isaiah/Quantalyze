/**
 * Phase 167.2 / KCS-06 (S4) — the /strategies row carries the key card's own
 * pill when a key feeding it is untrusted.
 *
 * WHY THIS FILE EXISTS, stated as the defect it pins closed: a manager lands on
 * /strategies, not on the key card. A key whose sign-in failed (or that was
 * revoked) was visible only on the edit page, so the list showed a clean row
 * for a strategy whose data can no longer be refreshed. The row now carries the
 * SAME `AllocatorSyncStatus` pill and remedy sentence the key card shows, and
 * nothing when every feeding key is healthy.
 *
 * The assertions are about what each row is TOLD (the pill's props, the
 * caption's exact characters), not about pixels. `AllocatorSyncStatus` is
 * replaced by a probe that records its props; the predicates and the caption
 * function are REAL, so a page that asks the wrong question goes red here.
 *
 * All ids, names and labels are synthetic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

vi.mock("server-only", () => ({}));
// 167.2 review-fix: the page captures its read failures to Sentry.
const captureToSentryMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: captureToSentryMock }));

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
vi.mock("@/components/strategy/ShareableLink", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/strategy/ShareableLink")
  >("@/components/strategy/ShareableLink");
  return { ...actual, ShareableLink: () => null };
});

interface PillProps {
  syncStatus: string | null;
  syncError: string | null;
  lastSyncAt: string | null;
  exchange: string;
}

/**
 * The pill is a PROBE: the question is "what was the row told", which a null
 * stub cannot answer. It records its props and renders them as attributes.
 */
const pillProps = vi.hoisted(() => [] as PillProps[]);
vi.mock("@/components/exchanges/AllocatorSyncStatus", () => ({
  AllocatorSyncStatus: (props: PillProps) => {
    pillProps.push({
      syncStatus: props.syncStatus,
      syncError: props.syncError,
      lastSyncAt: props.lastSyncAt,
      exchange: props.exchange,
    });
    return React.createElement("span", {
      "data-testid": "sync-pill",
      "data-sync-status": props.syncStatus ?? "",
      "data-exchange": props.exchange,
    });
  },
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
  /** PostgREST hands a 1:1 embed back as an object or a one-element array. */
  strategy_analytics:
    | { computation_status: string | null }
    | Array<{ computation_status: string | null }>
    | null;
}

interface MockKeyRow {
  id: string;
  exchange: string;
  sync_status: string | null;
  sync_error: string | null;
  last_sync_at: string | null;
}

interface MockMemberRow {
  strategy_id: string;
  api_key_id: string;
  seq: number;
}

type ReadResult = { data: unknown; error: { message: string } | null };

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  // 167.2-REVIEW-R2 IN-03: null answers `data: null, error: null`.
  strategies: [] as MockStrategyRow[] | null,
  /** 167.2-REVIEW-SFH H-1: the list read's error, when it fails. */
  strategiesError: null as { message: string } | null,
  keys: [] as MockKeyRow[],
  keysError: null as { message: string } | null,
  members: [] as MockMemberRow[],
  membersError: null as { message: string } | null,
  /** get_user_compute_jobs answers, per p_strategy_id. */
  jobs: {} as Record<string, unknown[]>,
  jobsError: null as { message: string } | null,
  jobsThrow: false,
  rpcCalls: [] as Array<{ fn: string; args: unknown }>,
  /** Every `.select(...)` / `.in(...)` the page issued, per table. */
  calls: [] as Array<{ table: string; op: string; args: unknown[] }>,
  /**
   * Phase 167.2.1 (D-08) — the service-role read behind `probeFactsheetBuildable`,
   * per strategy id. An id with no entry answers a computed row with a 30-point
   * series, so every other describe's computed rows stay buildable and render
   * as they did before the list probed them.
   */
  adminRows: {} as Record<string, { data: unknown; error: { message: string; code?: string } | null }>,
  /** 167.2.1 D-05: the admin factory itself throws. */
  adminThrow: false,
  /** Every `from(table)` the admin client was asked for. */
  adminTables: [] as string[],
  /** The id of every strategies read the admin client answered. */
  adminStrategyReads: [] as string[],
  /** Every `.or(filter)` applied to an admin read (the visibility predicate). */
  adminOrFilters: [] as string[],
  /**
   * 167.2.1-REVIEW WR-01 — a concurrency gauge on the probe's strategy read.
   * With a delay set, each read stays open across a timer, so reads that run
   * at once overlap and `adminMaxInFlight` records the peak. 0 = no delay (the
   * read resolves in one tick, as every other case expects).
   */
  adminReadDelayMs: 0,
  adminInFlight: 0,
  adminMaxInFlight: 0,
}));

/** N consecutive synthetic calendar days from 2024-01-02, as {date, value}. */
const points = vi.hoisted(() => (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    date: new Date(Date.UTC(2024, 0, 2) + i * 86_400_000).toISOString().slice(0, 10),
    value: ((i % 7) - 3) / 1000,
  })),
);

/** A strategies row as the builder's admin select returns it (synthetic). */
const adminStrategy = vi.hoisted(() => (id: string, analytics: Record<string, unknown>) => ({
  id,
  name: `Strategy ${id}`,
  codename: null,
  disclosure_tier: null,
  status: "draft",
  markets: [],
  strategy_types: [],
  description: null,
  subtypes: [],
  supported_exchanges: [],
  leverage_range: null,
  aum: null,
  max_capacity: null,
  avg_daily_turnover: null,
  start_date: null,
  benchmark: null,
  asset_class: "crypto",
  returns_denominator_config: null,
  strategy_analytics: {
    daily_returns: null,
    returns_series: null,
    computed_at: "2024-03-01T00:00:00Z",
    data_quality_flags: null,
    metrics_json_by_basis: null,
    computation_status: "complete",
    ...analytics,
  },
}));

// Phase 167.2.1 (D-08) — the service-role client `probeFactsheetBuildable`
// builds. A chainable double that records the tables, the id read and the
// visibility filter; the probe itself (the builder's resolve stage) is REAL.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (state.adminThrow) throw new Error("synthetic admin client failure");
    return {
      from: (table: string) => {
        state.adminTables.push(table);
        let id = "";
        const b: Record<string, unknown> = {};
        const self = () => b;
        b.select = self;
        b.order = self;
        b.limit = self;
        b.eq = (column: string, value: string) => {
          if (column === "id") id = value;
          return b;
        };
        b.or = (filter: string) => {
          state.adminOrFilters.push(filter);
          return b;
        };
        b.maybeSingle = async () => {
          if (table !== "strategies") return { data: null, error: null };
          state.adminStrategyReads.push(id);
          state.adminInFlight += 1;
          state.adminMaxInFlight = Math.max(state.adminMaxInFlight, state.adminInFlight);
          if (state.adminReadDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, state.adminReadDelayMs));
          }
          state.adminInFlight -= 1;
          return (
            state.adminRows[id] ?? {
              data: adminStrategy(id, { daily_returns: points(30) }),
              error: null,
            }
          );
        };
        // The composite read awaits its csv builder directly.
        b.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
        return b;
      },
    };
  },
}));

// Table-dispatch double. Each table the page reads is named; anything else
// throws, so a new read cannot slip in unseen.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
    rpc: async (fn: string, args: { p_strategy_id?: string; p_limit?: number }) => {
      state.rpcCalls.push({ fn, args });
      if (fn !== "get_user_compute_jobs") throw new Error(`Unexpected rpc: ${fn}`);
      if (state.jobsThrow) throw new Error("synthetic rpc throw");
      if (state.jobsError) return { data: null, error: state.jobsError };
      // 167.2-REVIEW-SFH M-5: the RPC honours `p_limit`.
      const rows = state.jobs[args.p_strategy_id ?? ""] ?? [];
      return { data: rows.slice(0, args.p_limit ?? rows.length), error: null };
    },
    from: (table: string) => {
      let result: ReadResult;
      if (table === "strategies") {
        result = state.strategiesError
          ? { data: null, error: state.strategiesError }
          : { data: state.strategies, error: null };
      } else if (table === "contact_requests") {
        result = { data: [], error: null };
      } else if (table === "strategy_keys") {
        result = state.membersError
          ? { data: null, error: state.membersError }
          : { data: state.members, error: null };
      } else if (table === "api_keys") {
        result = state.keysError
          ? { data: null, error: state.keysError }
          : { data: state.keys, error: null };
      } else {
        throw new Error(`Unexpected table: ${table}`);
      }
      const record =
        (op: string) =>
        (...args: unknown[]) => {
          state.calls.push({ table, op, args });
          return builder;
        };
      const builder = {
        select: record("select"),
        eq: record("eq"),
        or: record("or"),
        in: record("in"),
        limit: record("limit"),
        order: record("order"),
        maybeSingle: async () => ({ data: null, error: null }),
        then: (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onF: (v: ReadResult) => any,
        ) => Promise.resolve(result).then(onF),
      };
      return builder;
    },
  }),
}));

function row(
  id: string,
  overrides: Partial<MockStrategyRow> = {},
): MockStrategyRow {
  return {
    id,
    name: `Strategy ${id}`,
    status: "draft",
    source: "legacy",
    strategy_types: ["options"],
    review_note: null,
    created_at: "2026-01-01T00:00:00.000Z",
    api_key_id: null,
    // Default computed, so the key-mark cases see no share note.
    strategy_analytics: { computation_status: "complete" },
    ...overrides,
  };
}

function key(
  id: string,
  exchange: string,
  sync_status: string | null,
  overrides: Partial<MockKeyRow> = {},
): MockKeyRow {
  return {
    id,
    exchange,
    sync_status,
    sync_error: null,
    last_sync_at: null,
    ...overrides,
  };
}

async function renderPage(): Promise<HTMLElement> {
  const { default: StrategiesPage } = await import("./page");
  const jsx = await (StrategiesPage as unknown as () => Promise<React.ReactElement>)();
  const { container } = render(jsx);
  return container;
}

/** The S4 lines, as the owner reads them: caption text and pill status. */
function markLines(container: HTMLElement) {
  return [...container.querySelectorAll('[data-testid="strategy-row-key-mark"]')].map(
    (el) => ({
      caption: el.querySelector("p")?.textContent ?? null,
      status:
        el.querySelector('[data-testid="sync-pill"]')?.getAttribute("data-sync-status") ??
        null,
    }),
  );
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  redirectMock.mockReset();
  pillProps.length = 0;
  // Phase 167.2.1 (D-08): UUID-shaped, because the list now probes computed
  // rows with `withPublishedOrOwner(q, user.id)`, which fails closed (and logs)
  // on a non-UUID id. Synthetic.
  state.user = { id: "00000000-0000-4000-8000-0000000000a1" };
  state.strategies = [];
  state.strategiesError = null;
  state.keys = [];
  state.keysError = null;
  state.members = [];
  state.membersError = null;
  state.jobs = {};
  state.jobsError = null;
  state.jobsThrow = false;
  state.rpcCalls = [];
  state.calls = [];
  state.adminRows = {};
  state.adminThrow = false;
  state.adminTables = [];
  state.adminStrategyReads = [];
  state.adminOrFilters = [];
  state.adminReadDelayMs = 0;
  state.adminInFlight = 0;
  state.adminMaxInFlight = 0;
  captureToSentryMock.mockClear();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("StrategiesPage — KCS-06 the key mark (S4)", () => {
  it("SINGLE-KEY-SIGNIN: a row whose key failed sign-in carries the key card's pill, captioned by its exchange", async () => {
    state.strategies = [row("s-1", { api_key_id: "k-1" })];
    state.keys = [
      key("k-1", "bybit", "sign_in_failed", {
        sync_error: "synthetic auth error",
        last_sync_at: "2026-02-01T00:00:00.000Z",
      }),
    ];

    const container = await renderPage();

    // Exactly the caption the UI-SPEC locks (KCS06-ONE), U+00B7 included.
    expect(markLines(container)).toEqual([
      { caption: "Exchange key · Bybit", status: "sign_in_failed" },
    ]);
    // Mounted exactly as the key card mounts it: the stored status, error,
    // time and exchange code, not a paraphrase.
    expect(pillProps).toEqual([
      {
        syncStatus: "sign_in_failed",
        syncError: "synthetic auth error",
        lastSyncAt: "2026-02-01T00:00:00.000Z",
        exchange: "bybit",
      },
    ]);
  });

  it("HEALTHY-NO-BAND: a row whose key is healthy renders no footer band at all", async () => {
    state.strategies = [row("s-1", { api_key_id: "k-1" })];
    state.keys = [key("k-1", "bybit", "complete")];

    const container = await renderPage();

    // A band on a healthy row would be a false alarm on the page a manager
    // lands on; the mark exists only because a key is untrusted.
    expect(container.querySelector('[data-testid="strategy-row-footer"]')).toBeNull();
    expect(pillProps).toHaveLength(0);
  });

  it("KEYS-READ-ERROR: a failed key read renders no mark and is logged, never a guessed pill", async () => {
    state.strategies = [row("s-1", { api_key_id: "k-1" })];
    state.keysError = { message: "synthetic read failure" };

    const container = await renderPage();

    expect(pillProps).toHaveLength(0);
    expect(container.querySelector('[data-testid="strategy-row-key-mark"]')).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      "[strategies/page] api_keys read failed",
      "synthetic read failure",
    );
  });

  it("reads api_keys through the five-column allowlist, never a wide select", async () => {
    state.strategies = [row("s-1", { api_key_id: "k-1" })];
    state.keys = [key("k-1", "bybit", "complete")];

    await renderPage();

    const selects = state.calls.filter((c) => c.table === "api_keys" && c.op === "select");
    expect(selects).toEqual([
      {
        table: "api_keys",
        op: "select",
        args: ["id, exchange, sync_status, sync_error, last_sync_at"],
      },
    ]);
  });
});

describe("StrategiesPage — KCS-06 composite members are feeding keys", () => {
  function member(strategy_id: string, api_key_id: string, seq: number): MockMemberRow {
    return { strategy_id, api_key_id, seq };
  }

  it("MEMBER-ONLY-UNTRUSTED: a composite whose only untrusted key is a member (api_key_id null) is still marked", async () => {
    // The stitch fans out over EVERY member, so a revoked third member stops
    // the composite from refreshing even though api_key_id says nothing.
    state.strategies = [row("c-1", { api_key_id: null })];
    state.members = [
      member("c-1", "k-a", 1),
      member("c-1", "k-b", 2),
      member("c-1", "k-c", 3),
    ];
    state.keys = [
      key("k-a", "bybit", "complete"),
      key("k-b", "binance", "complete"),
      key("k-c", "okx", "revoked"),
    ];

    const container = await renderPage();

    expect(markLines(container)).toEqual([
      { caption: "Exchange key \u00b7 OKX", status: "revoked" },
    ]);
  });

  it("TWO-STATUSES: two distinct untrusted statuses render two lines, each status once, in seq order", async () => {
    state.strategies = [row("c-1")];
    // Delivered out of seq order on purpose: the order is the members' seq,
    // not whatever order the read returned.
    state.members = [
      member("c-1", "k-okx", 2),
      member("c-1", "k-bybit", 1),
      member("c-1", "k-bybit-2", 3),
    ];
    state.keys = [
      key("k-okx", "okx", "revoked"),
      key("k-bybit", "bybit", "sign_in_failed", { sync_error: "first seen" }),
      key("k-bybit-2", "bybit", "sign_in_failed", { sync_error: "second seen" }),
    ];

    const container = await renderPage();

    expect(markLines(container)).toEqual([
      { caption: "Exchange keys \u00b7 Bybit", status: "sign_in_failed" },
      { caption: "Exchange key \u00b7 OKX", status: "revoked" },
    ]);
    // The pill's detail comes from the FIRST key seen in that status.
    expect(pillProps.map((p) => p.syncError)).toEqual(["first seen", null]);
  });

  it("SAME-STATUS-MANY: several keys in one status make one KCS06-MANY line naming each exchange once", async () => {
    state.strategies = [row("c-1")];
    state.members = [
      member("c-1", "k-1", 1),
      member("c-1", "k-2", 2),
      member("c-1", "k-3", 3),
    ];
    state.keys = [
      key("k-1", "bybit", "sign_in_failed"),
      key("k-2", "bybit", "sign_in_failed"),
      key("k-3", "okx", "sign_in_failed"),
    ];

    const container = await renderPage();

    expect(markLines(container)).toEqual([
      { caption: "Exchange keys \u00b7 Bybit, OKX", status: "sign_in_failed" },
    ]);
  });

  it("SHARED-KEY-ONCE: a key that is both api_key_id and a member is counted once", async () => {
    state.strategies = [row("s-1", { api_key_id: "k-1" })];
    state.members = [member("s-1", "k-1", 1)];
    state.keys = [key("k-1", "bybit", "sign_in_failed")];

    const container = await renderPage();

    // Counted twice it would read "Exchange keys" (plural) about one key.
    expect(markLines(container)).toEqual([
      { caption: "Exchange key \u00b7 Bybit", status: "sign_in_failed" },
    ]);
    const keyIn = state.calls.find((c) => c.table === "api_keys" && c.op === "in");
    expect(keyIn?.args).toEqual(["id", ["k-1"]]);
  });

  it("MEMBERS-READ-ERROR: a failed member read still judges api_key_id (truthful, partial) and is logged", async () => {
    state.strategies = [row("s-1", { api_key_id: "k-1" })];
    state.membersError = { message: "synthetic member read failure" };
    state.keys = [key("k-1", "bybit", "sign_in_failed")];

    const container = await renderPage();

    expect(markLines(container)).toEqual([
      { caption: "Exchange key \u00b7 Bybit", status: "sign_in_failed" },
    ]);
    expect(consoleError).toHaveBeenCalledWith(
      "[strategies/page] strategy_keys read failed",
      "synthetic member read failure",
    );
  });

  it("reads strategy_keys by the listed strategies and asks api_keys for the UNION of both id sources", async () => {
    state.strategies = [
      row("s-1", { api_key_id: "k-direct" }),
      row("c-1", { api_key_id: null }),
    ];
    state.members = [member("c-1", "k-m1", 1), member("c-1", "k-m2", 2)];
    state.keys = [];

    await renderPage();

    const memberCalls = state.calls.filter((c) => c.table === "strategy_keys");
    expect(memberCalls).toEqual([
      { table: "strategy_keys", op: "select", args: ["strategy_id, api_key_id, seq"] },
      { table: "strategy_keys", op: "in", args: ["strategy_id", ["s-1", "c-1"]] },
    ]);
    const keyIn = state.calls.find((c) => c.table === "api_keys" && c.op === "in");
    expect(keyIn?.args[0]).toBe("id");
    expect([...(keyIn?.args[1] as string[])].sort()).toEqual(["k-direct", "k-m1", "k-m2"]);
  });
});

describe("StrategiesPage — KCS-12 the share note on a row without a computed factsheet (S5)", () => {
  // The LOCKED strings, typed out here character for character (UI-SPEC
  // § KCS-12). The page renders them through recipientShareNote; a paraphrase
  // anywhere in between goes red.
  const MINT_A =
    "Right now, a private link to this strategy shows that its factsheet is being prepared. The numbers appear there once a computation succeeds.";
  const MINT_B =
    "Right now, a private link to this strategy shows that its factsheet is not available yet. The numbers appear there once a computation succeeds.";
  const UNREADABLE =
    "Right now, a private link to this strategy shows a placeholder page instead of the numbers. They appear there once a computation succeeds.";
  const PUBLIC =
    "Right now, this strategy's factsheet link shows that the factsheet is not available yet. The numbers appear there once a computation succeeds.";
  // Phase 167.2.1 (D-02) — typed out from 167.2.1-CONTEXT.md, never imported.
  // Reworded by 167.2.1-REVIEW CR-01 and IN-02 (2026-09-26): the reason is
  // stated from the stored results, in the active voice.
  const UNBUILDABLE_SHORT =
    "Right now, a private link to this strategy shows that its factsheet is not available. Its stored results hold fewer than 2 days of returns, and a factsheet needs at least 2.";

  function noteOf(container: HTMLElement, strategyName: string): string | null {
    const card = [...container.querySelectorAll("a")]
      .find((a) => a.textContent === strategyName)
      ?.closest('[data-testid="strategy-row"]');
    return card?.querySelector('[data-testid="strategy-row-share-note"]')?.textContent ?? null;
  }

  // In-flight rows are RECENT on the real clock the page reads. A fixed past
  // date (they used to be 2026-02-01) ages past `CHAIN_JOB_LIVE_WINDOW_MS`, and
  // since WIZRESYNC review round 2 `selectFactsheetJob` treats an in-flight row
  // that old as dead, as the resync guard does. Terminal rows keep fixed dates:
  // a finished row is never "dead".
  const isoMinutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  const running = { kind: "process_key_long", status: "running", created_at: isoMinutesAgo(10) };

  it("COMPUTED-NO-NOTE: a row with a computed factsheet shows no note and asks the RPC nothing", async () => {
    // Lineage, 167.2.1 D-08: "computed" here now means computed AND buildable.
    // Both rows are probed and take the default admin row (a 30-point series),
    // so the builder would build them; a computed row the builder refuses is
    // COMPUTED-UNBUILDABLE below.
    state.strategies = [
      row("s-done", { strategy_analytics: { computation_status: "complete" } }),
      row("s-warn", { strategy_analytics: [{ computation_status: "complete_with_warnings" }] }),
    ];

    const container = await renderPage();

    expect(container.querySelector('[data-testid="strategy-row-share-note"]')).toBeNull();
    expect(container.querySelector('[data-testid="strategy-row-footer"]')).toBeNull();
    // A computed row has a factsheet; reading its jobs would be a wasted round
    // trip per row on the page every manager lands on.
    expect(state.rpcCalls).toEqual([]);
    // 167.2.1 D-08: and it was asked, so "no note" is the builder's answer.
    expect(state.adminStrategyReads).toEqual(["s-done", "s-warn"]);
  });

  // A finished factsheet-chain job: the share page's arm for it is
  // `not_available`, so a null payload shows the "not available" card.
  const finished = { kind: "process_key_long", status: "done", created_at: "2026-02-01T00:00:00.000Z" };

  it("COMPUTED-UNBUILDABLE (167.2.1 SC3, WR-02): a computed single-key row with ONE dated return says the private link shows 'not available', and why", async () => {
    // The owner's embed calls it computed; the builder refuses it (G4). Its
    // share-link recipient lands on the "not available" card, so a silent row
    // here would imply a working factsheet.
    state.strategies = [row("s-short", { status: "draft", strategy_analytics: { computation_status: "complete" } })];
    state.adminRows = {
      "s-short": { data: adminStrategy("s-short", { daily_returns: points(1) }), error: null },
    };
    state.jobs = { "s-short": [finished] };

    const container = await renderPage();

    expect(noteOf(container, "Strategy s-short")).toBe(UNBUILDABLE_SHORT);
  });

  // ── Phase 167.2.1 — every probe outcome and share mode (D-02, D-05, D-08) ──
  const UNBUILDABLE_COMPOSITE =
    "Right now, a private link to this strategy shows that its factsheet is not available. We cannot build a factsheet from its stored results. Contact support@quantalyze.com to have them checked.";
  const PUBLIC_UNBUILDABLE_SHORT =
    "Right now, this strategy's factsheet link shows that the factsheet is not available. Its stored results hold fewer than 2 days of returns, and a factsheet needs at least 2.";
  const onePoint = (id: string) => ({
    data: adminStrategy(id, { daily_returns: points(1) }),
    error: null,
  });
  const PROBE_TAGS = { tags: { route: "strategies/page", stage: "factsheet-probe" } };
  // 167.2.1-REVIEW-R2 WR-01: the page's one event for the returned failures.
  const OUTCOME_TAGS = { route: "strategies/page", stage: "factsheet-probe-outcomes" };
  // 167.2.1-REVIEW-SFH H-2 — typed out, never imported. The buildability
  // check failed, so what a recipient sees is not known.
  const PROBE_UNREADABLE =
    "We could not check what a private link to this strategy shows right now. Reload this page to check again.";
  const PUBLIC_PROBE_UNREADABLE =
    "We could not check what this strategy's factsheet link shows right now. Reload this page to check again.";
  const UNBUILDABLE_UNREADABLE_SHORT =
    "Right now, a private link to this strategy shows a placeholder page instead of the numbers. Its stored results hold fewer than 2 days of returns, and a factsheet needs at least 2.";

  it("COMPOSITE-UNBUILDABLE: a computed composite with no persisted headline says its results cannot be built and names support", async () => {
    state.strategies = [row("c-pre86", { status: "draft", strategy_analytics: { computation_status: "complete" } })];
    state.adminRows = {
      "c-pre86": {
        data: adminStrategy("c-pre86", {
          data_quality_flags: { composite: true },
          metrics_json_by_basis: null,
        }),
        error: null,
      },
    };
    state.jobs = {
      "c-pre86": [{ kind: "stitch_composite", status: "done", created_at: "2026-02-01T00:00:00.000Z" }],
    };

    const container = await renderPage();

    expect(noteOf(container, "Strategy c-pre86")).toBe(UNBUILDABLE_COMPOSITE);
  });

  it("PUBLIC-UNBUILDABLE: a published computed row with one point takes the public unbuildable line and reads no jobs", async () => {
    state.strategies = [row("s-pub", { status: "published", strategy_analytics: { computation_status: "complete" } })];
    state.adminRows = { "s-pub": onePoint("s-pub") };
    state.jobs = { "s-pub": [running] };

    const container = await renderPage();

    expect(noteOf(container, "Strategy s-pub")).toBe(PUBLIC_UNBUILDABLE_SHORT);
    // 167.2 IN-04: the public line does not depend on the arm.
    expect(state.rpcCalls).toEqual([]);
  });

  it("UNBUILDABLE-IN-PROGRESS: an unbuildable row with a running chain job keeps KCS12-MINT-A, because the recipient sees 'being prepared'", async () => {
    state.strategies = [row("s-short", { status: "draft", strategy_analytics: { computation_status: "complete" } })];
    state.adminRows = { "s-short": onePoint("s-short") };
    state.jobs = { "s-short": [{ ...running, created_at: isoMinutesAgo(5) }] };

    const container = await renderPage();

    expect(noteOf(container, "Strategy s-short")).toBe(MINT_A);
  });

  it("UNBUILDABLE-RPC-ERROR (SFH H-2): an unbuildable row whose job read fails says the link shows a placeholder, and why, never 'once a computation succeeds'", async () => {
    // Lineage: this rendered KCS12-UNREADABLE, whose tail promised numbers
    // once a computation succeeds, for a row whose computation had succeeded.
    state.strategies = [row("s-short", { status: "draft", strategy_analytics: { computation_status: "complete" } })];
    state.adminRows = { "s-short": onePoint("s-short") };
    state.jobsError = { message: "synthetic rpc failure" };

    const container = await renderPage();

    expect(noteOf(container, "Strategy s-short")).toBe(UNBUILDABLE_UNREADABLE_SHORT);
  });

  it("PROBE-THROWS (D-05, SFH H-2): a probe that throws says the check failed, never 'no note', and is logged and captured with tags only", async () => {
    state.strategies = [row("s-1", { status: "draft", strategy_analytics: { computation_status: "complete" } })];
    state.adminThrow = true;

    const container = await renderPage();

    expect(noteOf(container, "Strategy s-1")).toBe(PROBE_UNREADABLE);
    expect(consoleError).toHaveBeenCalledWith(
      "[strategies/page] factsheet probe failed",
      expect.objectContaining({ id: "s-1" }),
    );
    expect(captureToSentryMock).toHaveBeenCalledTimes(1);
    // WR-01: one event per page load, carrying the count.
    expect(captureToSentryMock).toHaveBeenCalledWith(expect.any(Error), {
      tags: { ...PROBE_TAGS.tags, probe_failures: "1" },
    });
    // Tags only: the id stays in the server log, never in the capture.
    const [err, ctx] = captureToSentryMock.mock.calls[0] as [Error, unknown];
    expect(err.message).not.toContain("s-1");
    expect(JSON.stringify(ctx)).not.toContain("s-1");
  });

  it("PROBE-READ-ERROR (D-05, SFH M-2, H-2): an admin read error says the check failed and is counted into the page's ONE event, with tags only", async () => {
    state.strategies = [row("s-1", { status: "draft", strategy_analytics: { computation_status: "complete" } })];
    state.adminRows = { "s-1": { data: null, error: { message: "synthetic admin read failure" } } };

    const container = await renderPage();

    expect(noteOf(container, "Strategy s-1")).toBe(PROBE_UNREADABLE);
    // The stage that saw the error logs it, labelled as the probe's (SFH M-1).
    expect(consoleError).toHaveBeenCalledWith(
      "[factsheet] resolve(probe) — admin strategy read failed",
      expect.objectContaining({ id: "s-1", caller: "probe" }),
    );
    // One event, the page's count (167.2.1-REVIEW-R2 WR-01): the stage no
    // longer captures for a probe. The fixture error carries no code, so the
    // stage reports "none".
    expect(captureToSentryMock).toHaveBeenCalledTimes(1);
    expect(captureToSentryMock).toHaveBeenCalledWith(expect.any(Error), {
      level: "error",
      tags: {
        ...OUTCOME_TAGS,
        counted_rows: "1",
        read_error: "1",
        composite_unbuildable: "0",
        malformed_series: "0",
        read_error_codes: "none:1",
      },
      extra: { gates: {}, malformedSources: {} },
    });
    const [err, ctx] = captureToSentryMock.mock.calls[0] as [Error, unknown];
    expect(err.message).not.toContain("s-1");
    expect(JSON.stringify(ctx)).not.toContain("s-1");
  });

  it("PROBE-NOT-VISIBLE (167.2.1-REVIEW IN-01): a row deleted between the list read and the probe is a warning, never a capture", async () => {
    // The id came from the owner's own list read, and the probe runs under
    // the owner predicate, so "no row" here is a delete race, not an outage.
    // Capturing it would put it in the same event group as a real read error.
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      state.strategies = [row("s-1", { status: "draft", strategy_analytics: { computation_status: "complete" } })];
      state.adminRows = { "s-1": { data: null, error: null } };

      const container = await renderPage();

      expect(noteOf(container, "Strategy s-1")).toBe(PROBE_UNREADABLE);
      expect(consoleWarn).toHaveBeenCalledWith(
        "[strategies/page] factsheet probe found no row (deleted since the list read)",
        expect.objectContaining({ id: "s-1", reason: "not_visible" }),
      );
      expect(captureToSentryMock).not.toHaveBeenCalled();
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it("PUBLISHED-PROBE-FAILS (167.2.1-REVIEW-SFH H-2): a published computed row whose check fails says the check failed, never the public 'not available yet' line", async () => {
    // The finding: the failed probe rendered KCS12-PUBLIC ("… shows that the
    // factsheet is not available yet …") for a published row whose public
    // factsheet most likely rendered fine. Both failure shapes are covered.
    state.strategies = [
      row("s-pub-err", { status: "published", strategy_analytics: { computation_status: "complete" } }),
      row("s-pub-gone", { status: "published", strategy_analytics: { computation_status: "complete" } }),
    ];
    state.adminRows = {
      "s-pub-err": { data: null, error: { message: "synthetic admin read failure" } },
      "s-pub-gone": { data: null, error: null },
    };
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const container = await renderPage();

      for (const name of ["Strategy s-pub-err", "Strategy s-pub-gone"]) {
        expect(noteOf(container, name)).toBe(PUBLIC_PROBE_UNREADABLE);
        expect(noteOf(container, name)).not.toBe(PUBLIC);
      }
      // 167.2 IN-04 still holds: a published row reads no jobs.
      expect(state.rpcCalls).toEqual([]);
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it("PUBLISHED-PROBE-THROWS (167.2.1-REVIEW-SFH H-2): a published computed row whose probe throws says the check failed", async () => {
    state.strategies = [row("s-pub", { status: "published", strategy_analytics: { computation_status: "complete" } })];
    state.adminThrow = true;

    const container = await renderPage();

    expect(noteOf(container, "Strategy s-pub")).toBe(PUBLIC_PROBE_UNREADABLE);
  });

  it("PROBE-CONCURRENCY (167.2.1-REVIEW WR-01): at most 4 probe reads run at once, and every computed row is still probed, in list order", async () => {
    // Each probe is a heavy service-role read. The list is unpaginated, so an
    // unbounded fan-out fired one per computed row at once, and a saturated
    // pool then failed the check on every row.
    const ids = Array.from({ length: 10 }, (_, i) => `s-${i}`);
    state.strategies = ids.map((id) => row(id, { strategy_analytics: { computation_status: "complete" } }));
    state.adminReadDelayMs = 5;

    const container = await renderPage();

    expect(state.adminMaxInFlight).toBe(4);
    expect(state.adminStrategyReads).toEqual(ids);
    // All buildable: the cap changes the timing, never the answer.
    expect(container.querySelector('[data-testid="strategy-row-share-note"]')).toBeNull();
  });

  it("PROBE-THROWS-ONE-EVENT (167.2.1-REVIEW WR-01): six probes that throw on one page load are one Sentry event carrying the count, and six notes", async () => {
    const ids = Array.from({ length: 6 }, (_, i) => `s-${i}`);
    state.strategies = ids.map((id) => row(id, { strategy_analytics: { computation_status: "complete" } }));
    state.adminThrow = true;

    const container = await renderPage();

    for (const id of ids) expect(noteOf(container, `Strategy ${id}`)).toBe(PROBE_UNREADABLE);
    // Every row is still in the server log, with its id...
    expect(
      consoleError.mock.calls.filter((call: unknown[]) => call[0] === "[strategies/page] factsheet probe failed"),
    ).toHaveLength(6);
    // ...and Sentry gets ONE event for the page load, sized by a tag.
    expect(captureToSentryMock).toHaveBeenCalledTimes(1);
    expect(captureToSentryMock).toHaveBeenCalledWith(expect.any(Error), {
      tags: { ...PROBE_TAGS.tags, probe_failures: "6" },
    });
  });

  it("WR01-OUTCOMES-ONE-EVENT (167.2.1-REVIEW-R2 WR-01, SFH-R2 N-1): six read errors and two unbuildable composites on one page load are ONE Sentry event carrying the counts and the codes", async () => {
    // Pool saturation arrives as a RETURNED error, one per row, not a throw.
    // The resolve stage used to capture each one (and each composite refusal)
    // for the probe: eight events per load, on every navigation.
    const errIds = Array.from({ length: 6 }, (_, i) => `e-${i}`);
    const compIds = ["c-0", "c-1"];
    state.strategies = [...errIds, ...compIds].map((id) =>
      row(id, { status: "draft", strategy_analytics: { computation_status: "complete" } }),
    );
    state.adminRows = Object.fromEntries([
      ...errIds.map((id, i) => [
        id,
        { data: null, error: i < 4 ? { message: "synthetic statement timeout", code: "57014" } : { message: "synthetic fetch failure" } },
      ]),
      ...compIds.map((id) => [
        id,
        { data: adminStrategy(id, { data_quality_flags: { composite: true }, metrics_json_by_basis: null }), error: null },
      ]),
    ]);
    state.jobs = Object.fromEntries(
      compIds.map((id) => [id, [{ kind: "stitch_composite", status: "done", created_at: "2026-02-01T00:00:00.000Z" }]]),
    );

    const container = await renderPage();

    for (const id of errIds) expect(noteOf(container, `Strategy ${id}`)).toBe(PROBE_UNREADABLE);
    for (const id of compIds) expect(noteOf(container, `Strategy ${id}`)).toBe(UNBUILDABLE_COMPOSITE);
    // Every failed read is still in the server log, with its id.
    expect(
      consoleError.mock.calls.filter((call: unknown[]) => call[0] === "[factsheet] resolve(probe) — admin strategy read failed"),
    ).toHaveLength(6);
    expect(captureToSentryMock).toHaveBeenCalledTimes(1);
    expect(captureToSentryMock).toHaveBeenCalledWith(expect.any(Error), {
      level: "error",
      tags: {
        ...OUTCOME_TAGS,
        counted_rows: "8",
        read_error: "6",
        composite_unbuildable: "2",
        malformed_series: "0",
        read_error_codes: "57014:4,none:2",
      },
      extra: { gates: { "composite_unbuildable:headline": 2 }, malformedSources: {} },
    });
    // Tags only: no strategy id reaches the event.
    const [err, ctx] = captureToSentryMock.mock.calls[0] as [Error, unknown];
    for (const id of [...errIds, ...compIds]) {
      expect(err.message).not.toContain(id);
      expect(JSON.stringify(ctx)).not.toContain(id);
    }
  });

  it("WR01-COMPOSITE-ONLY-WARNING: an unbuildable composite alone is one event at warning, as the build's own capture is", async () => {
    state.strategies = [row("c-pre86", { status: "draft", strategy_analytics: { computation_status: "complete" } })];
    state.adminRows = {
      "c-pre86": {
        data: adminStrategy("c-pre86", { data_quality_flags: { composite: true }, metrics_json_by_basis: null }),
        error: null,
      },
    };

    await renderPage();

    expect(captureToSentryMock).toHaveBeenCalledTimes(1);
    expect(captureToSentryMock.mock.calls[0][1]).toMatchObject({
      level: "warning",
      tags: { ...OUTCOME_TAGS, composite_unbuildable: "1", read_error: "0" },
    });
  });

  it("PROBE-NOT-COMPUTED (D-05, SFH M-5): the embed says complete but the builder's read says failed, so the row takes the uncomputed path, logged at warn", async () => {
    state.strategies = [row("c-1", { status: "draft", strategy_analytics: { computation_status: "complete" } })];
    state.adminRows = {
      "c-1": { data: adminStrategy("c-1", { computation_status: "failed" }), error: null },
    };
    state.jobs = {
      "c-1": [
        {
          kind: "stitch_composite",
          status: "failed_final",
          error_kind: "permanent",
          created_at: "2026-02-01T00:00:00.000Z",
        },
      ],
    };

    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const container = await renderPage();

      expect(noteOf(container, "Strategy c-1")).toBe(MINT_B);
      // 167.2.1-REVIEW-SFH M-5: the race is logged, so its rate is
      // measurable, and never captured.
      expect(consoleWarn).toHaveBeenCalledWith(
        "[strategies/page] factsheet probe found the analytics row not computed (the list embed said computed)",
        expect.objectContaining({ id: "c-1", reason: "not_computed" }),
      );
      expect(captureToSentryMock).not.toHaveBeenCalled();
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it("NOT-PROBED-UNCOMPUTED (D-08): only the row the embed calls computed is probed", async () => {
    state.strategies = [
      row("s-a", { strategy_analytics: { computation_status: "failed" } }),
      row("s-done", { strategy_analytics: { computation_status: "complete" } }),
      row("s-b", { strategy_analytics: null }),
    ];

    await renderPage();

    expect(state.adminStrategyReads).toEqual(["s-done"]);
    // The uncomputed rows keep today's path: one RPC each, and no probe.
    expect(state.rpcCalls.map((c) => (c.args as { p_strategy_id: string }).p_strategy_id)).toEqual([
      "s-a",
      "s-b",
    ]);
  });

  it("OWNER-PREDICATE (T-167.2.1-14): the probe runs under withPublishedOrOwner with the session user id", async () => {
    state.strategies = [row("s-done", { strategy_analytics: { computation_status: "complete" } })];

    await renderPage();

    expect(state.adminOrFilters).toHaveLength(1);
    expect(state.adminOrFilters[0]).toContain(`user_id.eq.${state.user?.id}`);
  });

  it("MINT-A: an unpublished row whose computation is running says the private link shows it being prepared", async () => {
    state.strategies = [row("s-1", { status: "draft", strategy_analytics: { computation_status: "computing" } })];
    state.jobs = { "s-1": [running] };

    const container = await renderPage();

    expect(noteOf(container, "Strategy s-1")).toBe(MINT_A);
  });

  it("DEAD-ROW (WIZRESYNC round 2): a 'running' chain job 9 h old is not in progress, so the note never says 'being prepared'", async () => {
    state.strategies = [row("s-1", { status: "draft", strategy_analytics: { computation_status: "computing" } })];
    state.jobs = { "s-1": [{ ...running, created_at: isoMinutesAgo(9 * 60) }] };

    const container = await renderPage();

    expect(noteOf(container, "Strategy s-1")).not.toBe(MINT_A);
  });

  it("MINT-B: an unpublished row whose stitch failed permanently says the private link shows it not available", async () => {
    state.strategies = [row("c-1", { status: "draft", strategy_analytics: [{ computation_status: "failed" }] })];
    state.jobs = {
      "c-1": [
        {
          kind: "stitch_composite",
          status: "failed_final",
          error_kind: "permanent",
          created_at: "2026-02-01T00:00:00.000Z",
        },
      ],
    };

    const container = await renderPage();

    expect(noteOf(container, "Strategy c-1")).toBe(MINT_B);
  });

  it("UNREADABLE: an RPC error renders KCS12-UNREADABLE and is logged, never an in-progress claim", async () => {
    state.strategies = [row("s-1", { status: "draft", strategy_analytics: null })];
    state.jobsError = { message: "synthetic rpc failure" };

    const container = await renderPage();

    expect(noteOf(container, "Strategy s-1")).toBe(UNREADABLE);
    expect(consoleError).toHaveBeenCalledWith(
      "[strategies/page] compute-state read failed",
      expect.objectContaining({ id: "s-1", message: "synthetic rpc failure" }),
    );
    // 167.2-REVIEW-SFH M-6: captured, like the owner factsheet's identical read.
    expect(captureToSentryMock).toHaveBeenCalledWith(expect.any(Error), {
      tags: { route: "strategies/page", stage: "compute-state" },
    });
  });

  it("UNREADABLE: an RPC that throws renders KCS12-UNREADABLE and is logged", async () => {
    state.strategies = [row("s-1", { status: "draft", strategy_analytics: { computation_status: "pending" } })];
    state.jobsThrow = true;

    const container = await renderPage();

    expect(noteOf(container, "Strategy s-1")).toBe(UNREADABLE);
    expect(consoleError).toHaveBeenCalledWith(
      "[strategies/page] compute-state read failed",
      expect.objectContaining({ id: "s-1", message: "synthetic rpc throw" }),
    );
  });

  it("PUBLIC: a published row without a computed factsheet says what its public link shows, whatever the RPC answers", async () => {
    state.strategies = [row("s-pub", { status: "published", strategy_analytics: { computation_status: "failed" } })];
    // Running would be MINT-A on a private link; the public URL renders the
    // public placeholder, which never says "being prepared".
    state.jobs = { "s-pub": [running] };

    const container = await renderPage();

    expect(noteOf(container, "Strategy s-pub")).toBe(PUBLIC);
  });

  it("IN03-CONVERTED (167.2-REVIEW IN-03): a row with no members is judged by its newer chain job, not an old stitch", async () => {
    state.strategies = [row("s-1", { status: "draft", api_key_id: "k-1", strategy_analytics: null })];
    state.members = [];
    state.jobs = {
      "s-1": [
        { kind: "process_key_long", status: "running", created_at: isoMinutesAgo(5) },
        { kind: "stitch_composite", status: "failed_final", created_at: "2026-01-01T00:00:00.000Z" },
      ],
    };

    const container = await renderPage();

    expect(noteOf(container, "Strategy s-1")).toBe(MINT_A);
  });

  it("IN05-ZERO-UNLINKED (167.2-REVIEW-R2 IN-05): no members read, NO linked key and a stitch on record keep the stitch rule, so a member chain row cannot answer for a possible composite", async () => {
    state.strategies = [row("s-1", { status: "draft", api_key_id: null, strategy_analytics: null })];
    state.members = [];
    state.jobs = {
      "s-1": [
        { kind: "process_key_long", status: "running", created_at: isoMinutesAgo(5) },
        { kind: "stitch_composite", status: "failed_final", created_at: "2026-01-01T00:00:00.000Z" },
      ],
    };

    const container = await renderPage();

    expect(noteOf(container, "Strategy s-1")).toBe(MINT_B);
  });

  it("PUBLIC-NO-READ (167.2-REVIEW IN-04): a published row's note is the public-URL line whatever the arm, so its jobs are never read", async () => {
    state.strategies = [
      row("s-pub", { status: "published", strategy_analytics: { computation_status: "failed" } }),
    ];
    state.jobsError = { message: "synthetic rpc failure" };

    const container = await renderPage();

    expect(noteOf(container, "Strategy s-pub")).toBe(PUBLIC);
    // The read's answer was discarded, so a failure in it logged an error
    // about a value nobody reads.
    expect(state.rpcCalls).toEqual([]);
    expect(consoleError).not.toHaveBeenCalledWith(
      "[strategies/page] compute-state read failed",
      expect.anything(),
    );
  });

  it("calls the RPC once per uncomputed row with its own p_strategy_id and the shared limit", async () => {
    state.strategies = [
      row("s-a", { strategy_analytics: { computation_status: "failed" } }),
      row("s-done", { strategy_analytics: { computation_status: "complete" } }),
      row("s-b", { strategy_analytics: null }),
    ];

    await renderPage();

    // Never one unfiltered call: a null p_strategy_id returns every strategy's
    // jobs, and the window would be shared across rows.
    expect(state.rpcCalls).toEqual([
      { fn: "get_user_compute_jobs", args: { p_strategy_id: "s-a", p_limit: 100 } },
      { fn: "get_user_compute_jobs", args: { p_strategy_id: "s-b", p_limit: 100 } },
    ]);
  });

  it("renders the note after any key lines, and renders the band for a note alone", async () => {
    state.strategies = [
      row("s-key", { api_key_id: "k-1", strategy_analytics: { computation_status: "failed" } }),
      row("s-note", { strategy_analytics: { computation_status: "failed" } }),
    ];
    state.keys = [key("k-1", "bybit", "revoked")];

    const container = await renderPage();

    const bands = [...container.querySelectorAll('[data-testid="strategy-row-footer"]')];
    expect(bands).toHaveLength(2);
    expect([...bands[0].children].map((c) => c.getAttribute("data-testid"))).toEqual([
      "strategy-row-key-mark",
      "strategy-row-share-note",
    ]);
    expect([...bands[1].children].map((c) => c.getAttribute("data-testid"))).toEqual([
      "strategy-row-share-note",
    ]);
    expect(bands[1].querySelector("p")?.className).toBe("text-xs text-text-muted");
  });

  const cron = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      kind: "reconcile_strategy",
      status: "done",
      created_at: new Date(Date.UTC(2026, 1, 1) - i * 60_000).toISOString(),
    }));

  it("REASK (167.2-REVIEW-SFH M-5): a full 100-row window of cron rows re-asks once at the RPC cap and states the real arm", async () => {
    state.strategies = [row("s-1", { status: "draft", strategy_analytics: null })];
    state.jobs = { "s-1": cron(100) };

    const container = await renderPage();

    expect(state.rpcCalls.map((c) => (c.args as { p_limit: number }).p_limit)).toEqual([100, 1000]);
    // Exhaustive at 1000 with no chain job: never started, not "unreadable".
    expect(noteOf(container, "Strategy s-1")).toBe(MINT_B);
  });

  it("WINDOW-FULL (167.2-REVIEW-SFH M-5): a window still full at the cap renders KCS12-UNREADABLE and is logged and captured as its own case", async () => {
    state.strategies = [row("s-1", { status: "draft", strategy_analytics: null })];
    state.jobs = { "s-1": cron(1000) };

    const container = await renderPage();

    expect(noteOf(container, "Strategy s-1")).toBe(UNREADABLE);
    expect(consoleError).toHaveBeenCalledWith(
      "[strategies/page] compute-state window full",
      expect.objectContaining({ id: "s-1" }),
    );
    expect(captureToSentryMock).toHaveBeenCalledWith(expect.any(Error), {
      tags: { route: "strategies/page", stage: "compute-state-window-full" },
    });
  });
});

describe("StrategiesPage — an errored read is never rendered as healthy or empty (167.2-REVIEW-SFH H-1, H-3)", () => {
  // Hand-typed from the UI-SPEC review-fix rows, never imported.
  const LIST_UNREADABLE = "Your strategies could not be loaded. Reload this page to try again.";
  const KEY_STATUS_UNREADABLE =
    "Key status could not be checked right now. Open a strategy to see its keys.";

  it("H1-LIST-ERROR: a failed list read renders the load-failure line, never \"No strategies yet\", and is logged and captured", async () => {
    state.strategiesError = { message: "synthetic list failure" };

    const container = await renderPage();

    expect(container.textContent).toContain(LIST_UNREADABLE);
    expect(container.textContent).not.toContain("No strategies yet");
    expect(container.textContent).not.toContain("Create your first strategy");
    expect(consoleError).toHaveBeenCalledWith(
      "[strategies/page] strategies read failed",
      "synthetic list failure",
    );
    expect(captureToSentryMock).toHaveBeenCalledWith(expect.any(Error), {
      tags: { route: "strategies/page", stage: "list" },
    });
  });

  it("R2-IN03-NULL-DATA: a list read answering data null with no error is unreadable, never \"No strategies yet\", and is logged and captured", async () => {
    state.strategies = null;

    const container = await renderPage();

    expect(container.textContent).toContain(LIST_UNREADABLE);
    expect(container.textContent).not.toContain("No strategies yet");
    expect(captureToSentryMock).toHaveBeenCalledWith(expect.any(Error), {
      tags: { route: "strategies/page", stage: "list" },
    });
  });

  it("H1-CONTROL: a clean empty list still says \"No strategies yet\" and shows no load-failure line", async () => {
    const container = await renderPage();
    expect(container.textContent).toContain("No strategies yet");
    expect(container.textContent).not.toContain(LIST_UNREADABLE);
  });

  it("H3-KEYS-ERROR: a failed key-status read says the status could not be checked, and is captured", async () => {
    state.strategies = [row("s-1", { api_key_id: "k-1" })];
    state.keysError = { message: "synthetic read failure" };

    const container = await renderPage();

    expect(container.textContent).toContain(KEY_STATUS_UNREADABLE);
    expect(captureToSentryMock).toHaveBeenCalledWith(expect.any(Error), {
      tags: { route: "strategies/page", stage: "key-status" },
    });
  });

  it("H3-MEMBERS-ERROR: a failed member read says the status could not be checked, and is captured", async () => {
    state.strategies = [row("c-1", { api_key_id: null })];
    state.membersError = { message: "synthetic member read failure" };

    const container = await renderPage();

    expect(container.textContent).toContain(KEY_STATUS_UNREADABLE);
    expect(captureToSentryMock).toHaveBeenCalledWith(expect.any(Error), {
      tags: { route: "strategies/page", stage: "strategy-keys" },
    });
  });

  it("H3-CONTROL: clean key reads show no such line (an absent pill still means healthy)", async () => {
    state.strategies = [row("s-1", { api_key_id: "k-1" })];
    state.keys = [key("k-1", "bybit", "complete")];

    const container = await renderPage();

    expect(container.textContent).not.toContain(KEY_STATUS_UNREADABLE);
    expect(captureToSentryMock).not.toHaveBeenCalled();
  });
});

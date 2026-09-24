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
  strategies: [] as MockStrategyRow[],
  keys: [] as MockKeyRow[],
  keysError: null as { message: string } | null,
  members: [] as MockMemberRow[],
  membersError: null as { message: string } | null,
  /** Every `.select(...)` / `.in(...)` the page issued, per table. */
  calls: [] as Array<{ table: string; op: string; args: unknown[] }>,
}));

// Table-dispatch double. Each table the page reads is named; anything else
// throws, so a new read cannot slip in unseen.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
    rpc: async () => ({ data: [], error: null }),
    from: (table: string) => {
      let result: ReadResult;
      if (table === "strategies") {
        result = { data: state.strategies, error: null };
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
  state.user = { id: "u-test" };
  state.strategies = [];
  state.keys = [];
  state.keysError = null;
  state.members = [];
  state.membersError = null;
  state.calls = [];
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

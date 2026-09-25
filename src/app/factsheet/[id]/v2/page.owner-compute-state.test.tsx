/** @vitest-environment jsdom */
/**
 * Phase 167.2 / KCS-09 — the OWNER lane of the pending factsheet states what
 * is actually happening to the strategy's computation.
 *
 * The measured trigger: a three-member composite whose `stitch_composite` job
 * had failed permanently, while this page told its owner the factsheet was
 * "still computing". The founder's words are the acceptance test: "It should
 * clearly say what is happening." So TRIGGER-SHAPE below asserts the red
 * permanent-failure line AND the absence of every in-progress phrase.
 *
 * Harness: module mocks, STATE and the request-client pattern are COPIED from
 * page.owner-lane.test.tsx (that file stays unedited, D-04 / SL-1). The one
 * addition is an `rpc` member on THIS file's request mock, which records
 * `[name, args]` and answers from a queued `{ data, error }`. `unstable_cache`
 * stays a SPY so the owner pending render can be proven to reach the shared
 * cache zero times.
 *
 * Every expected string is typed HERE as a literal, never imported from the
 * copy module (oracle independence, the 167 D-11 house convention).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() called");
  },
}));
vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((fn: (...args: unknown[]) => unknown) => fn),
}));
vi.mock("@/lib/visibility", async () => {
  const actual = await vi.importActual<typeof import("@/lib/visibility")>(
    "@/lib/visibility",
  );
  return { ...actual };
});
// deriveComputeState runs FOR REAL (a passthrough spy). One case overrides a
// single answer: KCS09-RUN-UNKNOWN is unreachable through the RPC selection,
// because every kind the selection can pick has a known phase (see that case).
vi.mock("@/lib/compute-state", async () => {
  const actual = await vi.importActual<typeof import("@/lib/compute-state")>(
    "@/lib/compute-state",
  );
  return { ...actual, deriveComputeState: vi.fn(actual.deriveComputeState) };
});
// Phase 167.2.1 (D-06): a PARTIAL mock. The builder and the cached wrapper's
// callee stay real; only the buildability probe is a passthrough spy, so a
// case can prove on which lane, and how often, the page asks it.
vi.mock("@/lib/factsheet/fetch-and-build-payload", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/factsheet/fetch-and-build-payload")
  >("@/lib/factsheet/fetch-and-build-payload");
  return {
    ...actual,
    probeFactsheetBuildable: vi.fn(actual.probeFactsheetBuildable),
  };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/queries", () => ({
  readPublicVerificationSignals: vi.fn(),
}));

import FactsheetV2Page from "./page";
import { OwnerUnpublishedPanel } from "./FactsheetView";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readPublicVerificationSignals } from "@/lib/queries";
import { captureToSentry } from "@/lib/sentry-capture";
import { deriveComputeState } from "@/lib/compute-state";
import { probeFactsheetBuildable } from "@/lib/factsheet/fetch-and-build-payload";

// --- Fixtures ---------------------------------------------------------------

/** Synthetic ids only (public repo). */
const STRATEGY_ID = "00000000-0000-4000-8000-0000000000a1";
const OWNER_UID = "00000000-0000-4000-8000-0000000000b1";
const STRATEGY_NAME = "Example Composite";

/** The server clock the fixtures are anchored to. */
const NOW_ISO = "2026-09-24T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);
const minutesAgo = (m: number) => new Date(NOW_MS - m * 60_000).toISOString();

// Locked copy, typed as literals (UI-SPEC § KCS-09).
const FAIL_PERMANENT =
  "The last computation stopped on a problem that retrying alone will not resolve.";
const CONTACT_PERMANENT = "Contact support@quantalyze.com to resolve it.";
const RELOAD = "Reload this page to see the latest status.";
const CONTACT_CHECK = "Contact support@quantalyze.com to have it checked.";
const RETRY_READ = "Reload this page to try again.";
const UNREADABLE_LINE =
  "The computation status for this strategy could not be read.";
const FAIL_TRANSIENT =
  "The last computation stopped after its automatic retries ran out.";
const SHAPE_SINGLE =
  "Start a new computation with Resync on this strategy's edit page. Contact support@quantalyze.com if it does not complete.";
const SHAPE_UNLINKED =
  "Link a key with Use & Sync on this strategy's edit page to start a new computation. Contact support@quantalyze.com if it does not complete.";
const SHAPE_COMPOSITE =
  "A composite strategy has no self-serve re-run. Contact support@quantalyze.com to start a new computation.";
const SHAPE_CSV =
  "A CSV strategy's data is fixed at upload. To publish a corrected series, upload a new CSV strategy, or contact support@quantalyze.com.";
const EDIT_HREF = `/strategies/${STRATEGY_ID}/edit`;
const CSV_WIZARD_HREF = "/strategies/new/wizard?source=csv";
/** A linked single key (synthetic). */
const LINKED_KEY_ID = "00000000-0000-4000-8000-0000000000c1";
const IN_PROGRESS_PHRASES = [
  "still computing",
  "being prepared",
  "being computed",
] as const;

type JobRow = {
  kind: string;
  status: string;
  error_kind?: string | null;
  claimed_at?: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
};

function job(row: JobRow): JobRow {
  return { error_kind: null, claimed_at: null, metadata: null, ...row };
}

/** The measured trigger shape: the stitch failed permanently, after two
 *  older chain rows that finished. */
const TRIGGER_ROWS: JobRow[] = [
  job({
    kind: "stitch_composite",
    status: "failed_final",
    error_kind: "permanent",
    created_at: minutesAgo(30),
  }),
  job({ kind: "derive_broker_dailies", status: "done", created_at: minutesAgo(90) }),
  job({ kind: "process_key_long", status: "done", created_at: minutesAgo(120) }),
];

// --- Switchable request/admin state -----------------------------------------

const STATE = {
  sessionUser: null as { id: string } | null,
  publishedRow: null as unknown,
  ownerRow: null as unknown,
  adminRow: null as unknown,
  /** The queued answer of the request client's `rpc`. */
  rpcResult: { data: [] as unknown, error: null as unknown },
  /** When true the request client carries NO `rpc` member (a throw). */
  rpcMissing: false,
  /** The head-count answer of `strategy_keys` on the request client. */
  memberCountResult: { count: 0 as number | null, error: null as unknown },
  observed: {
    rpcCalls: [] as Array<[string, unknown]>,
    /** Tables named by `.from()` on the request client, in call order. */
    requestTables: [] as string[],
  },
};

const getUserSpy = vi.fn();

function mockRequestClient() {
  const client: Record<string, unknown> = {
    auth: { getUser: getUserSpy },
    from: (table: string) => {
      STATE.observed.requestTables.push(table);
      if (table === "strategy_keys") {
        // A head count is awaited on the builder itself.
        const countChain = {
          select: () => countChain,
          eq: () => countChain,
          then: (
            resolve: (v: unknown) => unknown,
            reject?: (e: unknown) => unknown,
          ) => Promise.resolve(STATE.memberCountResult).then(resolve, reject),
        };
        return countChain;
      }
      let sawOr = false;
      const chain = {
        select: () => chain,
        eq: () => chain,
        or: () => {
          sawOr = true;
          return chain;
        },
        maybeSingle: () =>
          Promise.resolve(
            sawOr
              ? { data: STATE.ownerRow, error: null }
              : { data: STATE.publishedRow, error: null },
          ),
      };
      return chain;
    },
  };
  if (!STATE.rpcMissing) {
    client.rpc = (name: string, args: unknown) => {
      STATE.observed.rpcCalls.push([name, args]);
      // 167.2-REVIEW-SFH M-5: the RPC honours `p_limit`, so a full first
      // window and the one wider re-ask can be told apart.
      const limit = (args as { p_limit?: number } | null)?.p_limit;
      const { data, error } = STATE.rpcResult;
      return Promise.resolve({
        data: Array.isArray(data) && typeof limit === "number" ? data.slice(0, limit) : data,
        error,
      });
    };
  }
  return client;
}

function mockAdmin(): SupabaseClient {
  const from = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      or: () => chain,
      // Phase 167.2.1: the composite read (`csv_daily_returns`, ordered and
      // limited) answers no rows. `strategy_analytics_series` has none either
      // (its `maybeSingle` below answers null for every table but strategies).
      order: () => chain,
      limit: () => Promise.resolve({ data: [], error: null }),
      maybeSingle: () =>
        Promise.resolve(
          table === "strategies"
            ? { data: STATE.adminRow, error: null }
            : { data: null, error: null },
        ),
    };
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}

/** Owner draft whose admin build yields NO payload → the pending branch. */
function givenOwnerPendingDraft(ownerRowExtra: Record<string, unknown> = {}) {
  STATE.sessionUser = { id: OWNER_UID };
  STATE.publishedRow = null;
  STATE.ownerRow = {
    id: STRATEGY_ID,
    name: STRATEGY_NAME,
    codename: null,
    disclosure_tier: "exploratory",
    status: "draft",
    capital_ownership: null,
    source: "api",
    api_key_id: LINKED_KEY_ID,
    strategy_analytics: { computed_at: "2026-09-01T00:00:00.000Z" },
    ...ownerRowExtra,
  };
  // Lineage (Phase 167.2.1, D-05 and D-06): this default was `null`. The owner
  // lane now asks the buildability probe on its null-payload path, and a probe
  // that finds no row answers `not_visible`, which renders KCS12-UNREADABLE
  // (D-05), so a null default would silently move SHARE-NOTE-A and
  // SHARE-NOTE-B. An UNCOMPUTED row keeps the builder at null and makes the
  // probe answer `not_computed`, which keeps today's arm-derived note. It is
  // also the realistic shape of a pending draft.
  STATE.adminRow = adminRowWith({ computation_status: "computing" });
}

/** The admin read's strategy row, with an embedded analytics row. */
function adminRowWith(analytics: Record<string, unknown>) {
  return {
    id: STRATEGY_ID,
    name: STRATEGY_NAME,
    codename: null,
    disclosure_tier: "exploratory",
    status: "draft",
    markets: ["BTC"],
    strategy_types: ["options"],
    description: null,
    subtypes: [],
    supported_exchanges: ["deribit"],
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
      computed_at: "2026-09-01T00:00:00.000Z",
      data_quality_flags: {},
      metrics_json_by_basis: null,
      ...analytics,
    },
  };
}

function givenJobs(rows: unknown[]) {
  STATE.rpcResult = { data: rows, error: null };
}

async function renderOwnerPending() {
  const jsx = await FactsheetV2Page({
    params: Promise.resolve({ id: STRATEGY_ID }),
  });
  const { container } = render(jsx as ReactElement);
  const section = container.querySelector(
    'section[aria-label="Computation status"]',
  );
  const paragraphs = section ? Array.from(section.querySelectorAll("p")) : [];
  return {
    container,
    section,
    stateLine: paragraphs[0] ?? null,
    remedyLine: paragraphs[1] ?? null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW_MS);
  STATE.sessionUser = null;
  STATE.publishedRow = null;
  STATE.ownerRow = null;
  STATE.adminRow = null;
  STATE.rpcResult = { data: [], error: null };
  STATE.rpcMissing = false;
  STATE.memberCountResult = { count: 0, error: null };
  STATE.observed.rpcCalls = [];
  STATE.observed.requestTables = [];

  getUserSpy.mockImplementation(async () => ({
    data: { user: STATE.sessionUser },
    error: null,
  }));
  vi.mocked(createClient).mockImplementation(
    async () => mockRequestClient() as never,
  );
  vi.mocked(createAdminClient).mockImplementation(() => mockAdmin() as never);
  vi.mocked(readPublicVerificationSignals).mockResolvedValue(
    new Map() as never,
  );
});

// ---------------------------------------------------------------------------

describe("KCS-09 — the owner pending page states the trigger shape's real state", () => {
  it("TRIGGER-SHAPE: a permanently failed stitch renders the red permanent line and the support remedy, never an in-progress claim", async () => {
    givenOwnerPendingDraft();
    givenJobs(TRIGGER_ROWS);

    const { container, section, stateLine, remedyLine } =
      await renderOwnerPending();

    expect(section, "the owner pending render must carry the status section").not.toBeNull();
    expect(stateLine!.textContent).toBe(FAIL_PERMANENT);
    expect(stateLine!.className).toContain("text-negative");
    expect(remedyLine!.textContent).toBe(CONTACT_PERMANENT);
    expect(remedyLine!.className).not.toContain("italic");

    const text = container.textContent ?? "";
    for (const phrase of IN_PROGRESS_PHRASES) {
      expect(
        text,
        `a permanently failed computation must never read as "${phrase}"`,
      ).not.toContain(phrase);
    }

    // The read is the owner-scoped RPC over the shared 100-row window.
    expect(STATE.observed.rpcCalls).toEqual([
      ["get_user_compute_jobs", { p_strategy_id: STRATEGY_ID, p_limit: 100 }],
    ]);
    // D-04: the owner pending render never reaches the shared, id-keyed cache.
    expect(vi.mocked(unstable_cache)).toHaveBeenCalledTimes(0);
    expect(vi.mocked(captureToSentry)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Task 2 — every KCS09 row, the KCS21 shape remedies, and the unreadable degrade
// ---------------------------------------------------------------------------

type ToneClass = "text-text-secondary" | "text-warning" | "text-negative";

/** A stitch row with member progress (the composite fetch phase). */
function stitchRunning(
  statuses: readonly string[],
  heartbeatMinutesAgo: number,
): JobRow {
  return job({
    kind: "stitch_composite",
    status: "running",
    claimed_at: minutesAgo(heartbeatMinutesAgo + 5),
    created_at: minutesAgo(heartbeatMinutesAgo + 5),
    metadata: {
      member_progress: statuses.map((status, i) => ({
        seq: i + 1,
        exchange: "binance",
        label: `Key ${i + 1}`,
        status,
      })),
      member_progress_at: minutesAgo(heartbeatMinutesAgo),
    },
  });
}

const chainJob = (kind: string, status: string, errorKind: string | null = null) =>
  job({ kind, status, error_kind: errorKind, created_at: minutesAgo(10) });

/**
 * One case per KCS09 row. `memberCount` sets the strategy_keys head count
 * (0 = single-key API strategy with a linked key, the default owner row; 3 = a
 * composite). Expected text is typed as a literal per row.
 */
const STATE_ROWS: ReadonlyArray<{
  id: string;
  rows: JobRow[];
  memberCount?: number;
  line: string;
  tone: ToneClass;
  remedy: string;
}> = [
  {
    id: "KCS09-QUEUED (pending)",
    rows: [chainJob("compute_analytics_from_csv", "pending")],
    line: "A computation for this strategy is queued and has not started yet.",
    tone: "text-text-secondary",
    remedy: RELOAD,
  },
  {
    id: "KCS09-QUEUED (done_pending_children, KCS-19)",
    rows: [chainJob("derive_broker_dailies", "done_pending_children")],
    line: "A computation for this strategy is queued and has not started yet.",
    tone: "text-text-secondary",
    remedy: RELOAD,
  },
  {
    id: "KCS09-RETRYING",
    rows: [chainJob("sync_trades", "failed_retry", "transient")],
    line: "The last attempt hit a temporary problem, and the service is retrying it automatically.",
    tone: "text-warning",
    remedy: RELOAD,
  },
  {
    id: "KCS09-RUN-FETCH",
    rows: [chainJob("process_key_long", "running")],
    line: "Fetching this strategy's trades from the exchange.",
    tone: "text-text-secondary",
    remedy: RELOAD,
  },
  {
    id: "KCS09-RUN-MEMBER (two successful + one in_process -> key 3 of 3)",
    rows: [stitchRunning(["successful", "successful", "in_process"], 1)],
    memberCount: 3,
    line: "Fetching trades for this composite strategy: key 3 of 3.",
    tone: "text-text-secondary",
    remedy: RELOAD,
  },
  {
    id: "KCS09-RUN-COMPUTE",
    rows: [chainJob("compute_analytics_from_csv", "running")],
    line: "Computing this strategy's analytics from its trades.",
    tone: "text-text-secondary",
    remedy: RELOAD,
  },
  {
    id: "KCS09-STALLED (stitch heartbeat older than 12 minutes)",
    rows: [stitchRunning(["successful", "in_process", "waiting"], 13)],
    memberCount: 3,
    line: "The computation for this composite strategy stopped reporting progress more than 12 minutes ago.",
    tone: "text-warning",
    remedy: SHAPE_COMPOSITE,
  },
  {
    id: "KCS09-FAIL-PERMANENT",
    rows: [chainJob("derive_broker_dailies", "failed_final", "permanent")],
    line: FAIL_PERMANENT,
    tone: "text-negative",
    remedy: CONTACT_PERMANENT,
  },
  {
    id: "KCS09-FAIL-TRANSIENT",
    rows: [chainJob("derive_broker_dailies", "failed_final", "transient")],
    line: FAIL_TRANSIENT,
    tone: "text-warning",
    remedy: SHAPE_SINGLE,
  },
  {
    id: "KCS09-FAIL-ORPHANED",
    rows: [chainJob("process_key_long", "failed_final", "orphaned")],
    line: "The last computation stopped before it finished because the process running it went away.",
    tone: "text-warning",
    remedy: SHAPE_SINGLE,
  },
  {
    id: "KCS09-FAIL-UNKNOWN",
    rows: [chainJob("compute_analytics_from_csv", "failed_final", "unknown")],
    line: "The last computation stopped, and the service could not tell why.",
    tone: "text-warning",
    remedy: SHAPE_SINGLE,
  },
  {
    id: "KCS09-FAIL-OTHER (error_kind null)",
    rows: [chainJob("compute_analytics_from_csv", "failed_final", null)],
    line: "The last computation did not finish.",
    tone: "text-warning",
    remedy: SHAPE_SINGLE,
  },
  {
    id: "KCS09-FINISHED",
    rows: [chainJob("compute_analytics_from_csv", "done")],
    line: "The last computation finished, but the factsheet could not be built from its results.",
    tone: "text-warning",
    remedy: CONTACT_CHECK,
  },
  {
    id: "KCS09-NEVER (empty, exhaustive read)",
    rows: [],
    line: "No computation is running for this strategy, and none is on record.",
    tone: "text-text-secondary",
    remedy: SHAPE_SINGLE,
  },
];

describe("KCS-09 — every derived state renders exactly one state line and one remedy line", () => {
  it.each(STATE_ROWS)("$id", async ({ rows, memberCount, line, tone, remedy }) => {
    givenOwnerPendingDraft();
    givenJobs(rows);
    STATE.memberCountResult = { count: memberCount ?? 0, error: null };

    const { section, stateLine, remedyLine } = await renderOwnerPending();

    expect(section!.querySelectorAll("p")).toHaveLength(2);
    expect(stateLine!.textContent).toBe(line);
    expect(stateLine!.className).toBe(`mt-6 text-fixed-13 ${tone}`);
    expect(remedyLine!.textContent).toBe(remedy);
    expect(remedyLine!.className).toBe("mt-3 text-fixed-12 text-text-muted");
    expect(vi.mocked(unstable_cache)).toHaveBeenCalledTimes(0);
  });

  it("KCS09-RUN-UNKNOWN: a running state with an unrecognised phase renders the neutral working line", async () => {
    // Unreachable through the RPC selection today: every kind the selection
    // can pick (stitch_composite and the five factsheet-chain kinds) maps to a
    // known phase, and a row of any other kind is never selected (KCS-20).
    // The derivation still owns the row (KCS-08), so the page's rendering of
    // it is pinned by overriding one derivation answer.
    givenOwnerPendingDraft();
    givenJobs([chainJob("compute_analytics_from_csv", "running")]);
    vi.mocked(deriveComputeState).mockReturnValueOnce({
      state: "running",
      phase: "unknown",
    });

    const { stateLine, remedyLine } = await renderOwnerPending();

    expect(stateLine!.textContent).toBe(
      "The analytics service is working on this strategy.",
    );
    expect(stateLine!.className).toBe("mt-6 text-fixed-13 text-text-secondary");
    expect(remedyLine!.textContent).toBe(RELOAD);
  });

  it("KCS-20: a newer done reconcile_strategy row does not hide a failed chain job", async () => {
    givenOwnerPendingDraft();
    givenJobs([
      job({ kind: "reconcile_strategy", status: "done", created_at: minutesAgo(2) }),
      job({
        kind: "derive_broker_dailies",
        status: "failed_final",
        error_kind: "transient",
        created_at: minutesAgo(60),
      }),
    ]);

    const { stateLine } = await renderOwnerPending();

    expect(stateLine!.textContent).toBe(FAIL_TRANSIENT);
    expect(stateLine!.textContent).not.toContain("finished");
  });
});

describe("KCS-21 — the remedy is keyed on the strategy's shape", () => {
  const failedTransient = [chainJob("derive_broker_dailies", "failed_final", "transient")];

  it("KCS21-SINGLE: a linked single key -> Resync on the edit page, linked", async () => {
    givenOwnerPendingDraft({ source: "api", api_key_id: LINKED_KEY_ID });
    givenJobs(failedTransient);
    STATE.memberCountResult = { count: 0, error: null };

    const { remedyLine } = await renderOwnerPending();

    expect(remedyLine!.textContent).toBe(SHAPE_SINGLE);
    const anchors = remedyLine!.querySelectorAll("a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute("href")).toBe(EDIT_HREF);
    expect(anchors[0].textContent).toBe("edit page");
    expect(anchors[0].className).toBe("text-accent underline underline-offset-4");
    // The count ran on the request client, inside the owner pending render.
    expect(STATE.observed.requestTables).toContain("strategy_keys");
  });

  it("KCS21-UNLINKED: no key linked -> Use & Sync on the edit page, linked", async () => {
    givenOwnerPendingDraft({ source: "api", api_key_id: null });
    givenJobs(failedTransient);
    STATE.memberCountResult = { count: 0, error: null };

    const { remedyLine } = await renderOwnerPending();

    expect(remedyLine!.textContent).toBe(SHAPE_UNLINKED);
    const anchors = remedyLine!.querySelectorAll("a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute("href")).toBe(EDIT_HREF);
  });

  it("KCS21-COMPOSITE: three members -> support, and NO control is linked", async () => {
    givenOwnerPendingDraft({ source: "api", api_key_id: LINKED_KEY_ID });
    givenJobs(failedTransient);
    STATE.memberCountResult = { count: 3, error: null };

    const { remedyLine } = await renderOwnerPending();

    expect(remedyLine!.textContent).toBe(SHAPE_COMPOSITE);
    expect(
      remedyLine!.querySelectorAll("a"),
      "a composite has no self-serve re-run control, so its remedy links none",
    ).toHaveLength(0);
  });

  it("KCS21-CSV: source csv -> the CSV wizard, linked", async () => {
    givenOwnerPendingDraft({ source: "csv", api_key_id: null });
    givenJobs(failedTransient);

    const { remedyLine } = await renderOwnerPending();

    expect(remedyLine!.textContent).toBe(SHAPE_CSV);
    const anchors = remedyLine!.querySelectorAll("a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute("href")).toBe(CSV_WIZARD_HREF);
    expect(anchors[0].textContent).toBe("upload a new CSV strategy");
  });

  it("SHAPE-UNKNOWN: the member count read fails -> no shape is guessed, and the failure is logged", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      givenOwnerPendingDraft({ source: "api", api_key_id: LINKED_KEY_ID });
      givenJobs(failedTransient);
      STATE.memberCountResult = {
        count: null,
        error: { message: "permission denied for table strategy_keys" },
      };

      const { stateLine, remedyLine } = await renderOwnerPending();

      // The state line is still true; only the remedy declines to name a control.
      expect(stateLine!.textContent).toBe(FAIL_TRANSIENT);
      expect(remedyLine!.textContent).toBe(RETRY_READ);
      expect(remedyLine!.querySelectorAll("a")).toHaveLength(0);
      expect(errSpy).toHaveBeenCalledWith(
        "[factsheet/v2/page] strategy-shape read failed",
        expect.objectContaining({ id: STRATEGY_ID }),
      );
      expect(vi.mocked(captureToSentry)).toHaveBeenCalledWith(
        expect.anything(),
        { tags: { route: "factsheet/v2/page", stage: "strategy-shape" } },
      );
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe("167.2-REVIEW-R2 CR-01 — the owner factsheet's history read widens on its own rule", () => {
  it("R2-CR01-UNLINKED-150-ROWS: zero members, no key, a chain row in the newest 100 of 150 rows and no stitch -> the remedy is Use & Sync, after one re-ask at the cap", async () => {
    givenOwnerPendingDraft({ source: "api", api_key_id: null });
    STATE.memberCountResult = { count: 0, error: null };
    givenJobs([
      job({ kind: "derive_broker_dailies", status: "failed_final", error_kind: "transient", created_at: minutesAgo(1) }),
      ...Array.from({ length: 149 }, (_, i) =>
        job({ kind: "reconcile_strategy", status: "done", created_at: minutesAgo(i + 2) }),
      ),
    ]);

    const { remedyLine } = await renderOwnerPending();

    expect(remedyLine!.textContent).toBe(SHAPE_UNLINKED);
    expect(STATE.observed.rpcCalls.map(([, a]) => (a as { p_limit: number }).p_limit)).toEqual([
      100, 1000,
    ]);
    expect(vi.mocked(captureToSentry)).not.toHaveBeenCalled();
  });

  it("R2-M2-FACTSHEET: zero members, no key, a stitch on record -> no control is guessed, and it is captured (stage composite-history)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      givenOwnerPendingDraft({ source: "api", api_key_id: null });
      STATE.memberCountResult = { count: 0, error: null };
      givenJobs([
        job({ kind: "derive_broker_dailies", status: "failed_final", error_kind: "transient", created_at: minutesAgo(1) }),
        job({ kind: "stitch_composite", status: "done", created_at: minutesAgo(600) }),
      ]);

      const { remedyLine } = await renderOwnerPending();

      expect(remedyLine!.querySelectorAll("a")).toHaveLength(0);
      expect(vi.mocked(captureToSentry)).toHaveBeenCalledWith(expect.anything(), {
        tags: { route: "factsheet/v2/page", stage: "composite-history" },
      });
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe("KCS-09 — an unreadable read never claims progress", () => {
  it("RPC-ERROR: the RPC answers { error } -> KCS09-UNREADABLE, logged to console and Sentry", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      givenOwnerPendingDraft();
      STATE.rpcResult = {
        data: null,
        error: { code: "42501", message: "permission denied" },
      };

      const { container, stateLine, remedyLine } = await renderOwnerPending();

      expect(stateLine!.textContent).toBe(UNREADABLE_LINE);
      expect(stateLine!.className).toBe("mt-6 text-fixed-13 text-text-secondary");
      expect(remedyLine!.textContent).toBe(RETRY_READ);
      for (const phrase of IN_PROGRESS_PHRASES) {
        expect(container.textContent).not.toContain(phrase);
      }
      expect(errSpy).toHaveBeenCalledWith(
        "[factsheet/v2/page] compute-state read failed",
        { id: STRATEGY_ID, code: "42501", message: "permission denied" },
      );
      expect(vi.mocked(captureToSentry)).toHaveBeenCalledWith(
        { code: "42501", message: "permission denied" },
        { tags: { route: "factsheet/v2/page", stage: "compute-state" } },
      );
    } finally {
      errSpy.mockRestore();
    }
  });

  it("RPC-THROWS: a request client with no rpc member -> KCS09-UNREADABLE, no uncaught throw", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      givenOwnerPendingDraft();
      STATE.rpcMissing = true;

      const { container, stateLine, remedyLine } = await renderOwnerPending();

      expect(stateLine!.textContent).toBe(UNREADABLE_LINE);
      expect(remedyLine!.textContent).toBe(RETRY_READ);
      for (const phrase of IN_PROGRESS_PHRASES) {
        expect(container.textContent).not.toContain(phrase);
      }
      expect(errSpy).toHaveBeenCalledWith(
        "[factsheet/v2/page] compute-state read failed",
        expect.objectContaining({ id: STRATEGY_ID }),
      );
      expect(vi.mocked(captureToSentry)).toHaveBeenCalledWith(
        expect.any(TypeError),
        { tags: { route: "factsheet/v2/page", stage: "compute-state" } },
      );
    } finally {
      errSpy.mockRestore();
    }
  });

  // Moved by 167.2-REVIEW-SFH M-5 (lineage): this pin fed a 100-row window of
  // cron rows and expected `unreadable`. A full first window now re-asks once
  // at the RPC's 1000-row cap, so "proves nothing" needs a window still full
  // at the cap; a window that stops short of it is exhaustive (REASK below).
  it("NON-EXHAUSTIVE: a window still full at the RPC cap with no chain job proves nothing -> unreadable, logged and captured", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      givenOwnerPendingDraft();
      givenJobs(
        Array.from({ length: 1000 }, (_, i) =>
          job({ kind: "reconcile_strategy", status: "done", created_at: minutesAgo(i + 1) }),
        ),
      );

      const { stateLine } = await renderOwnerPending();

      expect(stateLine!.textContent).toBe(UNREADABLE_LINE);
      expect(errSpy).toHaveBeenCalledWith(
        "[factsheet/v2/page] compute-state window full",
        expect.objectContaining({ id: STRATEGY_ID }),
      );
      expect(vi.mocked(captureToSentry)).toHaveBeenCalledWith(
        expect.any(Error),
        { tags: { route: "factsheet/v2/page", stage: "compute-state-window-full" } },
      );
    } finally {
      errSpy.mockRestore();
    }
  });

  it("IN03-CONVERTED (167.2-REVIEW IN-03): zero members, an old failed stitch and a newer running chain job state the running job", async () => {
    givenOwnerPendingDraft();
    STATE.memberCountResult = { count: 0, error: null };
    givenJobs([
      job({ kind: "process_key_long", status: "running", created_at: minutesAgo(2) }),
      job({ kind: "stitch_composite", status: "failed_final", error_kind: "permanent", created_at: minutesAgo(600) }),
    ]);

    const { stateLine } = await renderOwnerPending();

    expect(stateLine!.textContent).not.toBe(FAIL_PERMANENT);
    expect(stateLine!.className).not.toContain("text-negative");
  });

  it("REASK (167.2-REVIEW-SFH M-5): a full 100-row window of cron rows re-asks once at the cap and states the real answer", async () => {
    givenOwnerPendingDraft();
    givenJobs(
      Array.from({ length: 100 }, (_, i) =>
        job({ kind: "reconcile_strategy", status: "done", created_at: minutesAgo(i + 1) }),
      ),
    );

    const { stateLine } = await renderOwnerPending();

    expect(STATE.observed.rpcCalls.map(([, a]) => (a as { p_limit: number }).p_limit)).toEqual([
      100, 1000,
    ]);
    expect(stateLine!.textContent).toBe(
      "No computation is running for this strategy, and none is on record.",
    );
  });
});

// ---------------------------------------------------------------------------
// Task 3 — the owner share note (KCS-12, S7) and the public sentence (KCS-10)
// ---------------------------------------------------------------------------

// Locked copy, typed as literals (UI-SPEC § B / § KCS-12 and § KCS-10).
const MINT_A =
  "Right now, a private link to this strategy shows that its factsheet is being prepared. The numbers appear there once a computation succeeds.";
const MINT_B =
  "Right now, a private link to this strategy shows that its factsheet is not available yet. The numbers appear there once a computation succeeds.";
const MINT_UNREADABLE =
  "Right now, a private link to this strategy shows a placeholder page instead of the numbers. They appear there once a computation succeeds.";
const PUBLIC_SENTENCE =
  "The detailed factsheet for this strategy is not available yet.";
// Phase 167.2.1 CONTEXT D-02, typed as literals.
const UNBUILDABLE_SHORT =
  "Right now, a private link to this strategy shows that its factsheet is not available. Its last computation succeeded with fewer than 2 days of returns, and a factsheet needs at least 2.";
const UNBUILDABLE_COMPOSITE =
  "Right now, a private link to this strategy shows that its factsheet is not available. Its last computation succeeded, but its results cannot be built into a factsheet. Contact support@quantalyze.com to have this composite checked.";
const SHARE_NOTE_CLASS = "mt-2 text-fixed-12 text-text-muted";

/** The OwnerUnpublishedPanel root: the parent of its visibility notice. */
function panelOf(container: HTMLElement): HTMLElement {
  const note = container.querySelector('[role="note"]');
  expect(note, "the owner pending page must mount the owner panel").not.toBeNull();
  return note!.parentElement as HTMLElement;
}

describe("KCS-12 (S7) — the owner's share panel says what a recipient sees right now", () => {
  it("SHARE-NOTE-A: a running job -> the panel's last child is KCS12-MINT-A", async () => {
    givenOwnerPendingDraft();
    givenJobs([chainJob("process_key_long", "running")]);

    const { container } = await renderOwnerPending();
    const last = panelOf(container).lastElementChild as HTMLElement;

    expect(last.tagName).toBe("P");
    expect(last.textContent).toBe(MINT_A);
    expect(last.className).toBe(SHARE_NOTE_CLASS);
  });

  it("SHARE-NOTE-B: a failed job -> the panel's last child is KCS12-MINT-B", async () => {
    givenOwnerPendingDraft();
    givenJobs(TRIGGER_ROWS);

    const { container } = await renderOwnerPending();
    const last = panelOf(container).lastElementChild as HTMLElement;

    expect(last.textContent).toBe(MINT_B);
    expect(last.className).toBe(SHARE_NOTE_CLASS);
  });

  it("SHARE-NOTE-UNREADABLE: an unreadable read -> the panel's last child is KCS12-UNREADABLE", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      givenOwnerPendingDraft();
      STATE.rpcResult = { data: null, error: { code: "500", message: "boom" } };

      const { container } = await renderOwnerPending();
      const last = panelOf(container).lastElementChild as HTMLElement;

      expect(last.textContent).toBe(MINT_UNREADABLE);
      expect(container.textContent).not.toContain("being prepared");
    } finally {
      errSpy.mockRestore();
    }
  });

  it("FULL-RENDER-NO-NOTE: the panel without shareNote renders no note, and the full owner render runs neither owner read", async () => {
    // Component level: absent prop -> no element (the full factsheet path and
    // every pre-167.2 mount are byte-identical).
    const { container } = render(
      <OwnerUnpublishedPanel strategyId={STRATEGY_ID} />,
    );
    const panel = panelOf(container);
    expect(panel.children).toHaveLength(2);
    expect(panel.lastElementChild!.tagName).toBe("DIV");
    expect(panel.querySelector("p.mt-2")).toBeNull();
    for (const note of [MINT_A, MINT_B, MINT_UNREADABLE]) {
      expect(container.textContent).not.toContain(note);
    }

    // Page level: a buildable owner draft takes the FULL render, where neither
    // the compute-job read nor the member count runs.
    givenOwnerPendingDraft();
    STATE.adminRow = buildableAdminRow();
    const jsx = await FactsheetV2Page({
      params: Promise.resolve({ id: STRATEGY_ID }),
    });
    expect(findViewPayload(jsx), "the full render must carry a payload").not.toBeNull();
    expect(STATE.observed.rpcCalls).toEqual([]);
    expect(STATE.observed.requestTables).not.toContain("strategy_keys");
    expect(vi.mocked(unstable_cache)).toHaveBeenCalledTimes(0);
    // Phase 167.2.1 (D-06): the probe runs only on the owner NULL-payload path.
    expect(
      vi.mocked(probeFactsheetBuildable),
      "the full owner render built a payload, so nothing is probed",
    ).not.toHaveBeenCalled();
  });

  // --- Phase 167.2.1 (D-02, D-05, D-06): the same note the /strategies list shows
  it("S7-UNBUILDABLE-SHORT: a computed single-key draft with ONE dated return and a finished job -> KCS12-UNBUILDABLE-SHORT, as on the list", async () => {
    givenOwnerPendingDraft();
    STATE.adminRow = adminRowWith({
      computation_status: "complete",
      daily_returns: [{ date: "2025-08-01", value: 0.01 }],
      returns_series: null,
    });
    givenJobs([chainJob("compute_analytics_from_csv", "done")]);

    const { container } = await renderOwnerPending();
    const last = panelOf(container).lastElementChild as HTMLElement;

    expect(last.textContent).toBe(UNBUILDABLE_SHORT);
    expect(last.className).toBe(SHARE_NOTE_CLASS);
    expect(vi.mocked(probeFactsheetBuildable)).toHaveBeenCalledTimes(1);
    // The probe runs under the builder's owner predicate, never the cache.
    expect(vi.mocked(probeFactsheetBuildable).mock.calls[0][0]).toBe(STRATEGY_ID);
    expect(vi.mocked(unstable_cache)).toHaveBeenCalledTimes(0);
    expect(vi.mocked(captureToSentry)).not.toHaveBeenCalled();
  });

  it("S7-UNBUILDABLE-COMPOSITE: a computed composite with no persisted headline and a finished job -> KCS12-UNBUILDABLE-COMPOSITE", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      givenOwnerPendingDraft();
      STATE.memberCountResult = { count: 3, error: null };
      STATE.adminRow = adminRowWith({
        computation_status: "complete",
        data_quality_flags: { composite: true },
        metrics_json_by_basis: null,
      });
      givenJobs([chainJob("stitch_composite", "done")]);

      const { container } = await renderOwnerPending();
      const last = panelOf(container).lastElementChild as HTMLElement;

      expect(last.textContent).toBe(UNBUILDABLE_COMPOSITE);
      expect(vi.mocked(probeFactsheetBuildable)).toHaveBeenCalledTimes(1);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("S7-PROBE-THROWS: the probe throws -> KCS12-UNREADABLE (D-05), never MINT-B, logged and captured once with tags only", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      givenOwnerPendingDraft();
      givenJobs([chainJob("compute_analytics_from_csv", "done")]);
      // On the owner null path the builder creates the admin client first and
      // the probe second; only the probe's creation throws.
      let adminCalls = 0;
      vi.mocked(createAdminClient).mockImplementation(() => {
        adminCalls += 1;
        if (adminCalls === 2) throw new Error("admin client unavailable");
        return mockAdmin() as never;
      });

      const { container } = await renderOwnerPending();
      const last = panelOf(container).lastElementChild as HTMLElement;

      expect(adminCalls, "the builder's call, then the probe's").toBe(2);
      expect(last.textContent).toBe(MINT_UNREADABLE);
      expect(last.textContent).not.toBe(MINT_B);
      expect(errSpy).toHaveBeenCalledWith(
        "[factsheet/v2/page] factsheet probe failed",
        expect.objectContaining({ id: STRATEGY_ID }),
      );
      const probeCaptures = vi
        .mocked(captureToSentry)
        .mock.calls.filter(
          ([, ctx]) =>
            (ctx as { tags?: { stage?: string } } | undefined)?.tags?.stage ===
            "factsheet-probe",
        );
      expect(probeCaptures).toHaveLength(1);
      expect(probeCaptures[0][1]).toEqual({
        tags: { route: "factsheet/v2/page", stage: "factsheet-probe" },
      });
    } finally {
      errSpy.mockRestore();
    }
  });

  it("S7-PROBE-NOT-VISIBLE: no admin row for the builder or the probe -> KCS12-UNREADABLE (D-05), captured once with tags only", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      givenOwnerPendingDraft();
      STATE.adminRow = null;
      givenJobs([chainJob("compute_analytics_from_csv", "done")]);

      const { container } = await renderOwnerPending();
      const last = panelOf(container).lastElementChild as HTMLElement;

      expect(last.textContent).toBe(MINT_UNREADABLE);
      const probeCaptures = vi
        .mocked(captureToSentry)
        .mock.calls.filter(
          ([, ctx]) =>
            (ctx as { tags?: { stage?: string } } | undefined)?.tags?.stage ===
            "factsheet-probe",
        );
      expect(probeCaptures).toHaveLength(1);
      expect(probeCaptures[0][1]).toEqual({
        tags: { route: "factsheet/v2/page", stage: "factsheet-probe" },
      });
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe("KCS-10 (S8) — the public pending placeholder says one neutral sentence", () => {
  it("PUBLIC-PENDING: masthead, H1 and exactly one sentence; no italic, no banner, no owner read", async () => {
    STATE.sessionUser = null;
    STATE.publishedRow = {
      id: STRATEGY_ID,
      name: STRATEGY_NAME,
      codename: null,
      disclosure_tier: "exploratory",
      strategy_analytics: { computed_at: "2026-09-01T00:00:00.000Z" },
    };
    STATE.adminRow = null;

    const jsx = await FactsheetV2Page({
      params: Promise.resolve({ id: STRATEGY_ID }),
    });
    const { container } = render(jsx as ReactElement);
    const article = container.querySelector("article")!;
    const h1 = article.querySelector("h1")!;
    const after: Element[] = [];
    for (let el = h1.nextElementSibling; el; el = el.nextElementSibling) {
      after.push(el);
    }

    expect(h1.textContent).toBe(STRATEGY_NAME);
    expect(after).toHaveLength(1);
    expect(after[0].tagName).toBe("P");
    expect(after[0].textContent).toBe(PUBLIC_SENTENCE);
    expect(after[0].className).toBe("mt-6 text-fixed-13 text-text-secondary");
    expect(article.querySelector(".italic")).toBeNull();
    expect(article.querySelector('[role="note"]')).toBeNull();
    expect(article.querySelector('section[aria-label="Computation status"]')).toBeNull();
    const text = article.textContent ?? "";
    for (const forbidden of [
      "still computing",
      "few minutes",
      "Some strategies stay in this state",
      "dev-server console",
      "bundled benchmark window",
      "2023-04-26",
      "failed",
      "error",
    ]) {
      expect(text, `the public sentence must not contain "${forbidden}"`).not.toContain(forbidden);
    }
    // The public lane reads no owner state at all.
    expect(STATE.observed.rpcCalls).toEqual([]);
    expect(STATE.observed.requestTables).not.toContain("strategy_keys");
    // Phase 167.2.1 (D-06, D-11): nor does it probe buildability.
    expect(vi.mocked(probeFactsheetBuildable)).not.toHaveBeenCalled();
  });
});

// --- Task 3 helpers ---------------------------------------------------------

/** A buildable admin row (the same 10-point cash series the owner-lane suite
 *  builds from), so the owner lane takes the FULL render. */
function buildableAdminRow() {
  const daily = [0.01, -0.02, 0.015, 0.005, -0.01, 0.02, -0.005, 0.03, -0.015, 0.01].map(
    (value, i) => ({ date: `2025-08-${String(i + 1).padStart(2, "0")}`, value }),
  );
  return {
    id: STRATEGY_ID,
    name: STRATEGY_NAME,
    codename: null,
    disclosure_tier: "exploratory",
    status: "draft",
    markets: ["BTC"],
    strategy_types: ["options"],
    description: null,
    subtypes: [],
    supported_exchanges: ["deribit"],
    leverage_range: null,
    aum: null,
    max_capacity: null,
    avg_daily_turnover: null,
    start_date: null,
    benchmark: null,
    asset_class: "crypto",
    returns_denominator_config: null,
    strategy_analytics: {
      daily_returns: daily,
      returns_series: null,
      computed_at: "2026-09-01T00:00:00.000Z",
      data_quality_flags: {},
      metrics_json_by_basis: null,
      computation_status: "complete",
    },
  };
}

/** Depth-first search of an RSC element tree for the FactsheetView payload. */
function findViewPayload(node: unknown): unknown {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findViewPayload(child);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as { props?: { payload?: unknown; children?: unknown } };
  if (el.props?.payload != null) return el.props.payload;
  return findViewPayload(el.props?.children ?? null);
}

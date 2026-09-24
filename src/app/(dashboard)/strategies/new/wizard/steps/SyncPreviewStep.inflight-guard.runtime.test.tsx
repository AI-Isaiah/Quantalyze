/** @vitest-environment jsdom */
/**
 * 2026-09-24 — found live while a manager ran the wizard on a Bybit key.
 *
 * (a) A page reload remounted this step and its kickoff effect POSTed
 *     `/api/keys/sync` again, starting a SECOND factsheet chain while the first
 *     was still running. The server now refuses that duplicate; the client
 *     must also not ask when the server already says a chain is in flight.
 * (b) The "This sync is taking longer than expected / Retry sync" banner came
 *     up on a healthy chain. The analytics status holds at `computing` for a
 *     whole chain, so the 15-minute wall-clock backstop fired on a run that
 *     was simply long (sync_trades 4.7 min, derive 9.7 min). Retry must show
 *     only when the server says one is needed.
 * (c) At 1061 s the progress row rendered EMPTY beside the seconds counter:
 *     the backstop's banner hid the stage label and nothing replaced it.
 *
 * Synthetic ids only. jsdom under fake timers, not a browser.
 */
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncPreviewStep } from "./SyncPreviewStep";
import type { SyncProgressResponse } from "@/lib/sync-progress";

let currentClientFactory: () => unknown = () => ({});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => currentClientFactory(),
}));

vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: vi.fn(),
}));

vi.mock("@/components/connect/KeyPermissionBadge", () => ({
  KeyPermissionBadge: () => null,
}));

const STRATEGY_ID = "00000000-0000-4000-8000-0000000000a1";
const LINKED_KEY_ID = "00000000-0000-4000-8000-0000000000b1";

/**
 * `strategies.api_key_id` is what the mount guard reads to prove single-key.
 * The freshness probe resolves EMPTY (a first-time or in-progress draft), and
 * the status poll returns `pollStatus`.
 */
function installClient(opts: { linkedKey: string | null; pollStatus: string }) {
  currentClientFactory = () => ({
    from: (table: string) => ({
      select: (cols: string) => {
        if (table === "strategies" && cols === "api_key_id") {
          return {
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { api_key_id: opts.linkedKey },
                  error: null,
                }),
            }),
          };
        }
        if (cols === "computation_status, computed_at") {
          return {
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          };
        }
        if (cols === "computation_status, computation_error") {
          return {
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    computation_status: opts.pollStatus,
                    computation_error: null,
                  },
                  error: null,
                }),
            }),
          };
        }
        return {
          eq: () => ({
            order: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        };
      },
    }),
  });
}

let progressBody: SyncProgressResponse = {
  jobStatus: "running",
  stalled: false,
  memberProgress: [],
};
let kickoffBody: Record<string, unknown> = {
  ok: true,
  accepted: true,
  status: "syncing",
  composite: false,
  queued: true,
};

function installFetchMock() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/keys/sync")) {
        return new Response(JSON.stringify(kickoffBody), { status: 202 });
      }
      if (url.includes("/sync-progress")) {
        return new Response(JSON.stringify(progressBody), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
}

const baseProps = {
  strategyId: STRATEGY_ID,
  apiKeyId: LINKED_KEY_ID,
  wizardSessionId: "session-inflight-1",
  onComplete: vi.fn(),
  onTryAnotherKey: vi.fn(),
};

async function mountAndSettle() {
  render(<SyncPreviewStep {...baseProps} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

function kickoffPosts(spy: ReturnType<typeof installFetchMock>) {
  return spy.mock.calls.filter(
    (c) =>
      String(c[0]).includes("/api/keys/sync") &&
      (c[1] as RequestInit | undefined)?.method === "POST",
  );
}

describe("SyncPreviewStep — no second sync, and Retry only when the server needs one", () => {
  let fetchSpy: ReturnType<typeof installFetchMock>;

  beforeEach(() => {
    vi.useFakeTimers();
    progressBody = { jobStatus: "running", stalled: false, memberProgress: [] };
    kickoffBody = {
      ok: true,
      accepted: true,
      status: "syncing",
      composite: false,
      queued: true,
    };
    fetchSpy = installFetchMock();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // (a) ─────────────────────────────────────────────────────────────────────
  it("(a) a reload during a running single-key chain does NOT POST a new kickoff", async () => {
    installClient({ linkedKey: LINKED_KEY_ID, pollStatus: "computing" });
    await mountAndSettle();

    expect(kickoffPosts(fetchSpy)).toHaveLength(0);
    // It is waiting on the running chain, with its stage label.
    expect(screen.getByTestId("wizard-sync-stage-label")).toHaveTextContent(
      "Computing analytics...",
    );
  });

  it("(a) control: with no job in flight the mount still kicks off", async () => {
    installClient({ linkedKey: LINKED_KEY_ID, pollStatus: "computing" });
    progressBody = { jobStatus: "done", stalled: false, memberProgress: [] };
    await mountAndSettle();
    expect(kickoffPosts(fetchSpy)).toHaveLength(1);
  });

  it("(a) control: a degraded sync-progress read is no evidence, so the mount kicks off", async () => {
    installClient({ linkedKey: LINKED_KEY_ID, pollStatus: "computing" });
    progressBody = {
      jobStatus: null,
      stalled: false,
      memberProgress: [],
      degraded: true,
    };
    await mountAndSettle();
    expect(kickoffPosts(fetchSpy)).toHaveLength(1);
  });

  it("(a) control: a strategy with no linked key (a composite) still kicks off; its arm comes from the kickoff", async () => {
    installClient({ linkedKey: null, pollStatus: "computing" });
    await mountAndSettle();
    expect(kickoffPosts(fetchSpy)).toHaveLength(1);
  });

  // (b) + (c) ───────────────────────────────────────────────────────────────
  it("(b)(c) a healthy in-flight chain shows its stage label and NO Retry at 1061 s, and still none at 40 min", async () => {
    installClient({ linkedKey: LINKED_KEY_ID, pollStatus: "computing" });
    await mountAndSettle();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1061_000 - 3000);
    });
    expect(
      screen.queryByTestId("wizard-sync-interrupted"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /retry sync/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("wizard-sync-stage-label")).toHaveTextContent(
      "Computing analytics...",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(40 * 60_000);
    });
    expect(
      screen.queryByTestId("wizard-sync-interrupted"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("wizard-sync-stage-label")).toHaveTextContent(
      "Computing analytics...",
    );
  });

  it("(b) Retry shows once the server says nothing is in flight and the status is still not computed", async () => {
    installClient({ linkedKey: LINKED_KEY_ID, pollStatus: "computing" });
    // Reload guard reads `running` and skips the POST; the chain then ends
    // without a factsheet: every later read says the job is finished.
    await mountAndSettle();
    progressBody = { jobStatus: "failed_final", stalled: false, memberProgress: [] };

    // Inside the grace: not yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(
      screen.queryByTestId("wizard-sync-interrupted"),
    ).not.toBeInTheDocument();

    // Past it, long before the 15-minute backstop: the server's own answer.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByTestId("wizard-sync-interrupted")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /retry sync/i }),
    ).toBeInTheDocument();
    // (c) the row is not empty while the banner is up.
    expect(screen.getByTestId("wizard-sync-stage-label")).toHaveTextContent(
      "Checking for progress…",
    );
  });

  it("(b) a kickoff that queued nothing shows no Retry while the server says a job is running", async () => {
    installClient({ linkedKey: null, pollStatus: "computing" });
    kickoffBody = { ...kickoffBody, queued: false };
    await mountAndSettle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(
      screen.queryByTestId("wizard-sync-interrupted"),
    ).not.toBeInTheDocument();
  });
});

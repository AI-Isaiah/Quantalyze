/** @vitest-environment jsdom */
/**
 * Phase 95 Plan 04 — PROG-01/02/03 render pins (NEW SIBLING file).
 *
 * The three Phase-94 SC pins (`SyncPreviewStep.render.test.tsx`,
 * `SyncPreviewStep.composite.render.test.tsx`, `SyncPreviewStep.test.ts`) stay
 * FROZEN/byte-untouched (95-VALIDATION sign-off). All NEW render coverage for
 * the wizard progress surface lives here:
 *
 *   PROG-01 — the internal "Stitching composite…" string is gone from the user
 *     surface; the composite in-progress copy is user-facing and phase-aware
 *     (downloaded vs processed) keyed off the existing `computationStatus`.
 *   PROG-02 — a per-key progress panel (Key N: Successful / In process /
 *     Waiting / Degraded) fed by GET /api/strategies/[id]/sync-progress; the
 *     debug strategy_id/status/elapsed <pre> block + its expand toggle are gone.
 *     A "degraded" row carries NO reason text (decision 3 — the reason stays
 *     post-completion via the Phase-93 degradedMembers DQ channel).
 *   PROG-03 — route `stalled:true` renders a DISTINCT interrupted state + an
 *     idempotent retry CTA (re-POSTs /api/keys/sync). `stalled:false` NEVER
 *     renders it, regardless of elapsed time (RT-1 render half).
 *
 * Harness idioms (chainable pure-stub supabase, fetch mock, fake-timer act
 * flush) mirror the frozen `SyncPreviewStep.composite.render.test.tsx` — this
 * file re-declares its own minimal mock so it never imports/edits the frozen one.
 */
import { render, screen, act, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncPreviewStep } from "./SyncPreviewStep";
import type {
  SyncProgressResponse,
  MemberProgressEntry,
} from "@/lib/sync-progress";

// --- Supabase mock ----------------------------------------------------------

let currentClientFactory: () => unknown = () => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }),
    }),
  }),
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => currentClientFactory(),
}));

vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: vi.fn(),
}));

vi.mock("@/components/connect/KeyPermissionBadge", () => ({
  KeyPermissionBadge: () => null,
}));

// Count of status-poll reads so a test can prove the authoritative analytics
// poll keeps ticking after a progress fetch / retry (fail-open + RT-1).
let statusPollCount = 0;

/**
 * Minimal waiting-state supabase mock. The freshness probe resolves EMPTY
 * (`computation_status, computed_at` → null) so the mount effect falls through
 * to the /api/keys/sync kickoff POST (the composite discriminator comes from
 * the kickoff `composite` flag). The status poll returns `pollStatus` (a
 * non-terminal status keeps the component in `waiting_for_complete`).
 */
function installWaitingMock(pollStatus: string) {
  statusPollCount = 0;
  const client = {
    from: () => ({
      select: (cols: string) => {
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
              maybeSingle: () => {
                statusPollCount += 1;
                return Promise.resolve({
                  data: {
                    computation_status: pollStatus,
                    computation_error: null,
                  },
                  error: null,
                });
              },
            }),
          };
        }
        // Anything else (heavy reads never reached in the waiting state).
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
  };
  currentClientFactory = () => client;
}

// --- fetch mock -------------------------------------------------------------

type ProgressOutcome =
  | { kind: "json"; body: SyncProgressResponse; status?: number }
  | { kind: "reject" };

let kickoffComposite = true;
let progressOutcome: ProgressOutcome = {
  kind: "json",
  body: { jobStatus: "running", stalled: false, memberProgress: [] },
};

function installFetchMock() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/keys/sync")) {
        return new Response(
          JSON.stringify({
            ok: true,
            accepted: true,
            status: "syncing",
            composite: kickoffComposite,
          }),
          { status: 202 },
        );
      }
      if (url.includes("/sync-progress")) {
        if (progressOutcome.kind === "reject") {
          throw new Error("sync-progress network error");
        }
        return new Response(JSON.stringify(progressOutcome.body), {
          status: progressOutcome.status ?? 200,
        });
      }
      return new Response("{}", { status: 200 });
    },
  );
}

const baseProps = {
  strategyId: "composite-strat-1",
  apiKeyId: "11111111-1111-4111-8111-111111111111",
  wizardSessionId: "session-1",
  onComplete: vi.fn(),
  onTryAnotherKey: vi.fn(),
};

const MEMBERS_3: MemberProgressEntry[] = [
  { seq: 1, exchange: "deribit", label: "Key A", status: "successful" },
  { seq: 2, exchange: "bybit", label: null, status: "in_process" },
  { seq: 3, exchange: "okx", label: null, status: "waiting" },
];

// Drive the component into `waiting_for_complete` (composite) and let the first
// poll tick issue the piggybacked sync-progress fetch + settle its setState.
async function renderWaiting() {
  render(<SyncPreviewStep {...baseProps} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0); // mount + kickoff POST
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000); // first poll → sync-progress fetch
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0); // flush fire-and-forget setState
  });
}

describe("[95-04] SyncPreviewStep — progress surface (PROG-01/02/03)", () => {
  let fetchSpy: ReturnType<typeof installFetchMock>;

  beforeEach(() => {
    vi.useFakeTimers();
    baseProps.onComplete = vi.fn();
    baseProps.onTryAnotherKey = vi.fn();
    kickoffComposite = true;
    progressOutcome = {
      kind: "json",
      body: { jobStatus: "running", stalled: false, memberProgress: [] },
    };
    fetchSpy = installFetchMock();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    currentClientFactory = () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    });
  });

  // PANEL — per-key rows with exact status labels + key identity.
  it("renders a per-key panel with exact status labels and key identity", async () => {
    installWaitingMock("computing");
    progressOutcome = {
      kind: "json",
      body: { jobStatus: "running", stalled: false, memberProgress: MEMBERS_3 },
    };
    await renderWaiting();

    const panel = screen.getByTestId("wizard-member-progress");
    expect(panel).toBeInTheDocument();

    const row1 = screen.getByTestId("member-progress-1");
    const row2 = screen.getByTestId("member-progress-2");
    const row3 = screen.getByTestId("member-progress-3");

    expect(within(row1).getByText("Successful")).toBeInTheDocument();
    expect(row1).toHaveTextContent("Key 1");
    expect(row1).toHaveTextContent("Key A");

    expect(within(row2).getByText("In process")).toBeInTheDocument();
    expect(row2).toHaveTextContent("Key 2");
    // No label → capitalized exchange.
    expect(row2).toHaveTextContent("Bybit");

    expect(within(row3).getByText("Waiting")).toBeInTheDocument();
    expect(row3).toHaveTextContent("Key 3");
  });

  // PANEL — a degraded row shows "Degraded" and NO reason text (decision 3).
  it("renders a degraded row with no reason text", async () => {
    installWaitingMock("computing");
    progressOutcome = {
      kind: "json",
      body: {
        jobStatus: "running",
        stalled: false,
        memberProgress: [
          { seq: 1, exchange: "bybit", label: "Key A", status: "degraded" },
        ],
      },
    };
    await renderWaiting();

    const row1 = screen.getByTestId("member-progress-1");
    expect(within(row1).getByText("Degraded")).toBeInTheDocument();
    // The degrade REASON stays post-completion (Phase-93 DQ channel) — never live.
    expect(
      screen.queryByText(/reconstruction|excluded|reason|geo-blocked/i),
    ).not.toBeInTheDocument();
  });

  // PANEL EMPTY — no invented rows.
  it("renders no panel when memberProgress is empty", async () => {
    installWaitingMock("computing");
    progressOutcome = {
      kind: "json",
      body: { jobStatus: "running", stalled: false, memberProgress: [] },
    };
    await renderWaiting();

    expect(screen.queryByTestId("wizard-member-progress")).not.toBeInTheDocument();
  });

  // PROG-01 COPY — internal string gone; phase-aware user-facing copy.
  it("shows 'Trades are being downloaded…' before computing and hides the internal string", async () => {
    installWaitingMock("pending"); // non-computing → downloaded copy
    await renderWaiting();

    expect(screen.getByText("Trades are being downloaded…")).toBeInTheDocument();
    // The internal "Stitching composite…" literal must be absent from the DOM.
    expect(screen.queryByText("Stitching composite…")).not.toBeInTheDocument();
  });

  it("shows 'Trades are being processed…' once computing", async () => {
    installWaitingMock("computing");
    await renderWaiting();

    expect(screen.getByText("Trades are being processed…")).toBeInTheDocument();
    expect(screen.queryByText("Stitching composite…")).not.toBeInTheDocument();
  });

  // DEBUG GONE — no expand toggle, no strategy_id leak, at any elapsed.
  it("never renders the debug expand toggle or the strategy_id block", async () => {
    installWaitingMock("computing");
    await renderWaiting();
    // Advance past the old WARN (60s) threshold that used to reveal the toggle.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });

    expect(screen.queryByTestId("wizard-sync-expand-log")).not.toBeInTheDocument();
    expect(screen.queryByText(/strategy_id=/)).not.toBeInTheDocument();
  });

  // PROG-03 INTERRUPTED — stalled:true renders the distinct state + retry CTA.
  it("renders the interrupted state and an idempotent retry CTA on stalled:true", async () => {
    installWaitingMock("computing");
    progressOutcome = {
      kind: "json",
      body: { jobStatus: "running", stalled: true, memberProgress: MEMBERS_3 },
    };
    await renderWaiting();

    expect(screen.getByTestId("wizard-sync-interrupted")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: /retry sync/i });
    expect(retry).toBeInTheDocument();

    const postsBefore = fetchSpy.mock.calls.filter(
      (c) =>
        String(c[0]).includes("/api/keys/sync") &&
        (c[1] as RequestInit | undefined)?.method === "POST",
    ).length;
    const pollsBefore = statusPollCount;

    await act(async () => {
      fireEvent.click(retry);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const postsAfter = fetchSpy.mock.calls.filter(
      (c) =>
        String(c[0]).includes("/api/keys/sync") &&
        (c[1] as RequestInit | undefined)?.method === "POST",
    );
    // Exactly ONE new POST /api/keys/sync, carrying { strategy_id }.
    expect(postsAfter.length - postsBefore).toBe(1);
    const lastPost = postsAfter[postsAfter.length - 1];
    expect(String((lastPost[1] as RequestInit).body)).toContain(
      "composite-strat-1",
    );

    // Polling CONTINUES — the authoritative analytics poll keeps ticking.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(statusPollCount).toBeGreaterThan(pollsBefore);
  });

  // NOT-STALLED NEVER INTERRUPTED — route truth, not elapsed time (RT-1 render half).
  it("never renders the interrupted state on stalled:false even past 15 minutes", async () => {
    installWaitingMock("computing");
    progressOutcome = {
      kind: "json",
      body: { jobStatus: "running", stalled: false, memberProgress: MEMBERS_3 },
    };
    await renderWaiting();
    // Advance well past RETRY_THRESHOLD_MS (15 min).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16 * 60_000);
    });

    expect(screen.queryByTestId("wizard-sync-interrupted")).not.toBeInTheDocument();
  });

  // FAIL-OPEN — a rejecting/500 sync-progress fetch never crashes or interrupts.
  it("fails open when the sync-progress fetch rejects (no crash, no interrupted, no panel)", async () => {
    installWaitingMock("computing");
    progressOutcome = { kind: "reject" };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderWaiting();

    // Component still in the waiting state.
    expect(
      screen.getByRole("heading", {
        name: /stitching your composite track record/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-sync-interrupted")).not.toBeInTheDocument();
    expect(screen.queryByTestId("wizard-member-progress")).not.toBeInTheDocument();

    // Analytics polling is unaffected.
    const before = statusPollCount;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(statusPollCount).toBeGreaterThan(before);
    warnSpy.mockRestore();
  });

  // SINGLE-KEY NEUTRALITY — composite:false kickoff issues NO sync-progress
  // fetch and renders no panel (no new traffic on the single-key path).
  it("issues no sync-progress fetch and renders no panel on a single-key kickoff", async () => {
    kickoffComposite = false;
    installWaitingMock("computing");
    progressOutcome = {
      kind: "json",
      body: { jobStatus: "running", stalled: true, memberProgress: MEMBERS_3 },
    };
    await renderWaiting();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    const progressFetches = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes("/sync-progress"),
    );
    expect(progressFetches).toHaveLength(0);
    expect(screen.queryByTestId("wizard-member-progress")).not.toBeInTheDocument();
    expect(screen.queryByTestId("wizard-sync-interrupted")).not.toBeInTheDocument();
  });
});

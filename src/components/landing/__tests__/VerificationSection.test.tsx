/**
 * M-0409 (audit-2026-05-07) — VerificationSection polling state machine.
 *
 * VerificationSection owns a non-trivial timing state machine:
 *   - exponential backoff (POLL_INITIAL_MS=3000, factor=1.5, max=30000)
 *   - a 5-minute hard cap (POLL_MAX_DURATION_MS) → status "failed"
 *   - unmount cleanup via stopPolling (clearTimeout)
 *   - handleRetry clears any in-flight poll before resetting to "form"
 *
 * These tests drive the machine with fake timers. The three child
 * components are mocked so the test can (a) trigger onResult from the
 * form, (b) observe the `status` prop handed to the progress view, and
 * (c) detect the results phase.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// --- Child mocks ---------------------------------------------------------
// VerificationForm exposes a button that fires onResult with a fixed id.
vi.mock("../VerificationForm", () => ({
  VerificationForm: ({
    onResult,
  }: {
    onResult: (r: { public_token: string; verification_id: string }) => void;
  }) => (
    <button
      data-testid="fire-result"
      onClick={() =>
        onResult({ public_token: "tok-1", verification_id: "ver-1" })
      }
    >
      submit
    </button>
  ),
}));

// VerificationProgress echoes its status prop into a data attribute so the
// test can assert the machine's state transitions.
vi.mock("../VerificationProgress", () => ({
  VerificationProgress: ({ status }: { status: string }) => (
    <div data-testid="progress" data-status={status}>
      progress: {status}
    </div>
  ),
}));

vi.mock("../VerificationResults", () => ({
  VerificationResults: () => <div data-testid="results">results</div>,
}));

import { VerificationSection } from "../VerificationSection";

function statusResponse(body: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Advance fake timers by `ms` and flush the microtask queue created by the
 * awaited fetch inside the scheduled callback. Each poll tick does an async
 * fetch + json + setState, so we need to let promises settle.
 */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("VerificationSection polling (M-0409)", () => {
  it("transitions to the results phase when the status route returns complete", async () => {
    fetchMock.mockResolvedValue(
      statusResponse({
        status: "complete",
        results: {
          twr: 0.1,
          sharpe: 1.2,
          return_24h: null,
          return_mtd: null,
          return_ytd: null,
          equity_curve: null,
          trade_count: 5,
        },
      }),
    );

    render(<VerificationSection />);
    fireEvent.click(screen.getByTestId("fire-result"));
    // Before the first poll fires we're in the progress phase, status pending.
    expect(screen.getByTestId("progress").getAttribute("data-status")).toBe(
      "pending",
    );

    // First poll fires at POLL_INITIAL_MS (3000ms).
    await advance(3000);
    expect(screen.getByTestId("results")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("enforces the 5-minute hard cap → status 'failed' and no further fetch", async () => {
    // Always "processing" so the machine would poll forever absent the cap.
    fetchMock.mockResolvedValue(statusResponse({ status: "processing" }));

    render(<VerificationSection />);
    fireEvent.click(screen.getByTestId("fire-result"));

    // Drive well past the 5-minute hard cap. Backoff means delays grow
    // 3000 → 4500 → ... capped at 30000; 6 minutes of ticks is plenty.
    await advance(6 * 60 * 1000);

    expect(screen.getByTestId("progress").getAttribute("data-status")).toBe(
      "failed",
    );
    const callsAtCap = fetchMock.mock.calls.length;
    // No new poll is scheduled once the cap trips: advancing further must
    // not issue another fetch.
    await advance(60 * 1000);
    expect(fetchMock.mock.calls.length).toBe(callsAtCap);
  });

  it("clears the pending poll timer on unmount (no fetch fires post-unmount)", async () => {
    fetchMock.mockResolvedValue(statusResponse({ status: "processing" }));

    const { unmount } = render(<VerificationSection />);
    fireEvent.click(screen.getByTestId("fire-result"));
    // Unmount BEFORE the first poll (which is scheduled at 3000ms) fires.
    unmount();
    await advance(5000);
    // stopPolling on unmount cleared the timeout → the scheduled fetch must
    // never run.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("applies exponential backoff between successive polls", async () => {
    fetchMock.mockResolvedValue(statusResponse({ status: "processing" }));

    render(<VerificationSection />);
    fireEvent.click(screen.getByTestId("fire-result"));

    // No poll before 3000ms.
    await advance(2999);
    expect(fetchMock).toHaveBeenCalledTimes(0);
    // First poll at 3000ms.
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Second poll is scheduled 3000*1.5 = 4500ms later. Not yet at +4499.
    await advance(4499);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

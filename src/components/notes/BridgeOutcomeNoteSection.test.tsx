import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from "vitest";
import { render, screen, act, waitFor, cleanup } from "@testing-library/react";
import { BridgeOutcomeNoteSection } from "./BridgeOutcomeNoteSection";

/**
 * Phase 08 Plan 05 follow-up — close /gsd-verify-work 08 Probe 2 gap.
 *
 * The OutcomesWidget timeline expands one row at a time; each expand mounts
 * a fresh BridgeOutcomeNoteSection keyed on outcomeId. Probe 2 from
 * 08-HUMAN-UAT.md asks: "click expand on row A, click collapse before the
 * fetch resolves, click expand on row B — does A's content leak into the
 * DOM?"
 *
 * The component's defence is the `cancelled` flag in the useEffect cleanup
 * (BridgeOutcomeNoteSection.tsx:46). After unmount, every setState branch
 * is gated on `if (!cancelled)`. A late-resolving fetch can therefore not
 * mutate the next mount's state — they are independent React instances
 * with independent `cancelled` closures.
 *
 * These tests prove the invariant deterministically with a deferred
 * fetch promise — no real network, no timing flake — so jsdom's "cannot
 * reliably reproduce the race in CI" limitation (the reason Probe 2 was
 * classified as human_needed) no longer applies.
 */

type DeferredResponse = {
  promise: Promise<Response>;
  resolve: (res: Response) => void;
  reject: (err: unknown) => void;
};

function makeDeferred(): DeferredResponse {
  let resolve: (res: Response) => void = () => {};
  let reject: (err: unknown) => void = () => {};
  const promise = new Promise<Response>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("BridgeOutcomeNoteSection — cancelled-flag race regression (/gsd-verify-work 08 Probe 2)", () => {
  let fetchSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(() => {
    fetchSpy = vi.fn() as unknown as MockInstance;
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
    // React logs to console.error when setState is called on an unmounted
    // component. Any such log during these tests is a regression.
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockRestore();
    cleanup();
  });

  it("unmount before the mount fetch resolves → late resolve cannot mutate state (no setState-after-unmount warning)", async () => {
    const deferred = makeDeferred();
    (fetchSpy as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => deferred.promise,
    );

    const { unmount } = render(
      <BridgeOutcomeNoteSection outcomeId="outcome-late" />,
    );

    // Loading gate is in place; fetch is pending.
    expect(screen.getByText("Loading…")).toBeInTheDocument();

    // User collapses the row before the server responds.
    unmount();

    // Server finally answers — this resolve happens AFTER unmount. The
    // cancelled flag must prevent any setState from firing.
    await act(async () => {
      deferred.resolve(
        makeResponse(200, {
          content: "leaked content from A",
          updated_at: "2026-04-21T00:00:00Z",
        }),
      );
    });

    // No React warning about setState on unmounted component.
    const setStateWarnings = consoleErrorSpy.mock.calls.filter(
      (c: unknown[]) =>
        typeof c[0] === "string" &&
        /unmounted component|can't perform a React state update/i.test(
          c[0] as string,
        ),
    );
    expect(setStateWarnings).toEqual([]);

    // And crucially the leaked content never renders anywhere in the DOM.
    expect(screen.queryByText("leaked content from A")).toBeNull();
  });

  it("unmount A then mount B with different outcomeId → A's late fetch cannot leak into B's DOM", async () => {
    const deferredA = makeDeferred();
    const deferredB = makeDeferred();
    (fetchSpy as unknown as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => deferredA.promise)
      .mockImplementationOnce(() => deferredB.promise);

    // --- Mount A, collapse before it resolves -----------------------------
    const { unmount: unmountA } = render(
      <BridgeOutcomeNoteSection outcomeId="outcome-A" />,
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    unmountA();

    // --- Mount B, still pending -------------------------------------------
    render(<BridgeOutcomeNoteSection outcomeId="outcome-B" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();

    // --- A's fetch resolves LATE with its own content ---------------------
    await act(async () => {
      deferredA.resolve(
        makeResponse(200, {
          content: "stale A content",
          updated_at: "2026-04-21T00:00:00Z",
        }),
      );
    });
    // B is still loading — A's late response must not touch B's state.
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("stale A content")).toBeNull();

    // --- B's fetch resolves with B's content ------------------------------
    await act(async () => {
      deferredB.resolve(
        makeResponse(200, {
          content: "fresh B content",
          updated_at: "2026-04-21T00:00:00Z",
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText("fresh B content")).toBeInTheDocument();
    });
    // Stale A content still absent.
    expect(screen.queryByText("stale A content")).toBeNull();
    // And no React unmount warning fired.
    const setStateWarnings = consoleErrorSpy.mock.calls.filter(
      (c: unknown[]) =>
        typeof c[0] === "string" &&
        /unmounted component|can't perform a React state update/i.test(
          c[0] as string,
        ),
    );
    expect(setStateWarnings).toEqual([]);
  });

  it("late 404 after unmount does not flip editing state on the next mount", async () => {
    const deferredA = makeDeferred();
    (fetchSpy as unknown as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => deferredA.promise)
      .mockResolvedValueOnce(
        makeResponse(200, {
          content: "B has a note",
          updated_at: "2026-04-21T00:00:00Z",
        }),
      );

    const { unmount: unmountA } = render(
      <BridgeOutcomeNoteSection outcomeId="outcome-A2" />,
    );
    unmountA();

    render(<BridgeOutcomeNoteSection outcomeId="outcome-B2" />);

    await waitFor(() => {
      expect(screen.getByText("B has a note")).toBeInTheDocument();
    });

    // A's deferred fetch now resolves with 404 — this would flip A's
    // editing=true if the cancelled flag were broken. B is in read mode
    // (content present → editing=false). The 404 must NOT cause B to
    // render a textarea.
    await act(async () => {
      deferredA.resolve(makeResponse(404));
    });
    expect(document.querySelector("textarea")).toBeNull();
    expect(screen.getByText("B has a note")).toBeInTheDocument();
  });
});

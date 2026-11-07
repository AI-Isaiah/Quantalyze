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
import userEvent from "@testing-library/user-event";
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

/** Fetch calls whose init method is PATCH (D-10: the GET on mount is by design). */
function patches(spy: MockInstance): unknown[][] {
  return spy.mock.calls.filter(
    (c) => (c[1] as RequestInit | undefined)?.method === "PATCH",
  );
}

describe("BridgeOutcomeNoteSection — opening writes nothing (D-10)", () => {
  let fetchSpy: MockInstance;

  /** GET answers `getRes`; every PATCH answers 200. */
  function stubFetch(getRes: () => Response) {
    fetchSpy = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PATCH"
        ? makeResponse(200, { updated_at: "2026-11-07T00:00:00Z" })
        : getRes(),
    ) as unknown as MockInstance;
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("404: the textarea is not focused on open, and leaving writes nothing", async () => {
    stubFetch(() => makeResponse(404));
    const user = userEvent.setup();
    const { container } = render(<BridgeOutcomeNoteSection outcomeId="o-quiet" />);
    await waitFor(() => expect(container.querySelector("textarea")).not.toBeNull());
    expect(document.activeElement).not.toBe(container.querySelector("textarea"));
    await user.click(document.body);
    await act(async () => {});
    expect(patches(fetchSpy)).toHaveLength(0);
  });

  it("404: focus then blur with no typing writes nothing", async () => {
    stubFetch(() => makeResponse(404));
    const user = userEvent.setup();
    const { container } = render(<BridgeOutcomeNoteSection outcomeId="o-quiet" />);
    await waitFor(() => expect(container.querySelector("textarea")).not.toBeNull());
    await user.click(container.querySelector("textarea") as HTMLTextAreaElement);
    await user.click(document.body);
    await act(async () => {});
    expect(patches(fetchSpy)).toHaveLength(0);
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
  });

  it("saved note: Edit focuses the textarea; blur with no change writes nothing and returns to read mode", async () => {
    stubFetch(() => makeResponse(200, { content: "outcome note", updated_at: "2026-04-21T10:00:00Z" }));
    const user = userEvent.setup();
    const { container } = render(<BridgeOutcomeNoteSection outcomeId="o-quiet" />);
    await user.click(await screen.findByText("Edit"));
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(ta);
    await user.click(document.body);
    await act(async () => {});
    expect(patches(fetchSpy)).toHaveLength(0);
    expect(container.querySelector("textarea")).toBeNull();
    expect(screen.getByText("outcome note")).toBeInTheDocument();
  });

  it("typing then blur sends exactly one PATCH with the typed content (D-10 positive arm)", async () => {
    stubFetch(() => makeResponse(404));
    const user = userEvent.setup();
    const { container } = render(<BridgeOutcomeNoteSection outcomeId="o-quiet" />);
    await waitFor(() => expect(container.querySelector("textarea")).not.toBeNull());
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    await user.click(ta);
    await user.type(ta, "Outcome landed as planned.");
    await user.click(document.body);
    await waitFor(() => expect(patches(fetchSpy)).toHaveLength(1));
    expect(JSON.parse((patches(fetchSpy)[0][1] as RequestInit).body as string)).toEqual({
      scope_kind: "bridge_outcome",
      scope_ref: "o-quiet",
      content: "Outcome landed as planned.",
    });
  });

  it("saved note cleared and blurred sends one PATCH with empty content (Q-1, founder override 2026-11-07)", async () => {
    stubFetch(() => makeResponse(200, { content: "outcome note", updated_at: "2026-04-21T10:00:00Z" }));
    const user = userEvent.setup();
    const { container } = render(<BridgeOutcomeNoteSection outcomeId="o-quiet" />);
    await user.click(await screen.findByText("Edit"));
    await user.clear(container.querySelector("textarea") as HTMLTextAreaElement);
    await user.click(document.body);
    await waitFor(() => expect(patches(fetchSpy)).toHaveLength(1));
    expect(JSON.parse((patches(fetchSpy)[0][1] as RequestInit).body as string).content).toBe("");
  });
});

describe("BridgeOutcomeNoteSection — a blur while a save is in flight compares against the value last sent (WR-01)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("edit y then back to the original x while the y save is open: the second blur sends x", async () => {
    let releaseFirst: (r: Response) => void = () => {};
    // GET answers x. The first PATCH is held open; later PATCHes answer 200.
    const fetchSpy: MockInstance = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method !== "PATCH") {
        return Promise.resolve(makeResponse(200, { content: "x", updated_at: "2026-04-21T10:00:00Z" }));
      }
      return patches(fetchSpy).length === 1
        ? new Promise<Response>((resolve) => {
            releaseFirst = resolve;
          })
        : Promise.resolve(makeResponse(200, { updated_at: "2026-11-07T00:00:00Z" }));
    }) as unknown as MockInstance;
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
    const bodies = () =>
      patches(fetchSpy).map((c) => JSON.parse((c[1] as RequestInit).body as string).content as string);

    const user = userEvent.setup();
    const { container } = render(<BridgeOutcomeNoteSection outcomeId="o-wr01" />);
    await user.click(await screen.findByText("Edit"));
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    await user.clear(ta);
    await user.type(ta, "y");
    await user.click(document.body);
    await waitFor(() => expect(bodies()).toEqual(["y"]));

    await user.click(screen.getByText("Edit"));
    const ta2 = container.querySelector("textarea") as HTMLTextAreaElement;
    await user.clear(ta2);
    await user.type(ta2, "x");
    await user.click(document.body);
    await waitFor(() => expect(bodies()).toEqual(["y", "x"]));

    await act(async () => {
      releaseFirst(makeResponse(200, { updated_at: "2026-11-07T00:00:00Z" }));
    });
  });

  it("a failed save after a superseded save committed: the next blur retries even though the draft equals the last confirmed value", async () => {
    let releaseFirst: (r: Response) => void = () => {};
    // GET answers x. PATCH 1 (y) is held open, PATCH 2 (x) answers 429, later ones 200.
    const fetchSpy: MockInstance = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method !== "PATCH") {
        return Promise.resolve(makeResponse(200, { content: "x", updated_at: "2026-04-21T10:00:00Z" }));
      }
      const n = patches(fetchSpy).length;
      if (n === 1) {
        return new Promise<Response>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return Promise.resolve(
        n === 2 ? makeResponse(429) : makeResponse(200, { updated_at: "2026-11-07T00:00:00Z" }),
      );
    }) as unknown as MockInstance;
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
    const bodies = () =>
      patches(fetchSpy).map((c) => JSON.parse((c[1] as RequestInit).body as string).content as string);

    const user = userEvent.setup();
    const { container } = render(
      <BridgeOutcomeNoteSection outcomeId="o-wr01-err" />,
    );
    await user.click(await screen.findByText("Edit"));
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    await user.clear(ta);
    await user.type(ta, "y");
    await user.click(document.body);
    await waitFor(() => expect(bodies()).toEqual(["y"]));

    // Edit back to x while y is open: x goes out and fails (429).
    await user.click(screen.getByText("Edit"));
    const ta2 = container.querySelector("textarea") as HTMLTextAreaElement;
    await user.clear(ta2);
    await user.type(ta2, "x");
    await user.click(document.body);
    await waitFor(() => expect(bodies()).toEqual(["y", "x"]));
    expect(await screen.findByText("Save failed — retry")).toBeInTheDocument();

    // The superseded y save now commits server-side; its response is dropped.
    await act(async () => {
      releaseFirst(makeResponse(200, { updated_at: "2026-11-07T00:00:00Z" }));
    });
    expect(screen.getByText("Save failed — retry")).toBeInTheDocument();

    // "Save failed — retry": Edit and leave with the draft unchanged. The draft
    // equals the last confirmed value (x), but the server may hold y, so it must send.
    await user.click(screen.getByText("Edit"));
    await user.click(document.body);
    await waitFor(() => expect(bodies()).toEqual(["y", "x", "x"]));
    await waitFor(() => expect(screen.queryByText("Save failed — retry")).toBeNull());
  });
});

describe("BridgeOutcomeNoteSection — a failed load is an error+retry state, never an empty editor (WR-02)", () => {
  let fetchSpy: MockInstance;

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  const stub = (impl: () => Promise<Response>) => {
    fetchSpy = vi.fn(impl) as unknown as MockInstance;
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
  };

  it("500 response → error+retry state, no editor and no Edit button; leaving writes nothing", async () => {
    stub(async () => makeResponse(500));
    const user = userEvent.setup();
    const { container } = render(<BridgeOutcomeNoteSection outcomeId="o-500" />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load your note. Your saved note is safe.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(container.querySelector("textarea")).toBeNull();
    expect(screen.queryByText("Edit")).toBeNull();
    await user.click(document.body);
    await act(async () => {});
    expect(patches(fetchSpy)).toHaveLength(0);
  });

  it("network error (thrown fetch) → the same error+retry state", async () => {
    stub(() => Promise.reject(new Error("network down")));
    const { container } = render(<BridgeOutcomeNoteSection outcomeId="o-net" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your note");
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("Retry after a failed load refetches and shows the saved note", async () => {
    let calls = 0;
    stub(async () =>
      ++calls === 1
        ? makeResponse(500)
        : makeResponse(200, { content: "recovered outcome note", updated_at: "2026-04-21T10:00:00Z" }),
    );
    const user = userEvent.setup();
    render(<BridgeOutcomeNoteSection outcomeId="o-retry" />);
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("recovered outcome note")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

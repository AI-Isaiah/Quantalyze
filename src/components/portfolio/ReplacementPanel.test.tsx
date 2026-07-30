import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ReplacementPanel } from "./ReplacementPanel";
import type { BridgeCandidate } from "@/lib/types";

/**
 * H-1077 (audit-2026-05-07) — ReplacementPanel had zero component tests.
 *
 * Load-bearing behaviors:
 *   - POST /api/bridge with { portfolio_id, underperformer_strategy_id }.
 *   - four render branches: loading skeletons, error, empty candidates,
 *     populated cards (one per candidate).
 *   - Escape key + backdrop click call onClose; clicking the panel interior
 *     does NOT.
 *   - the in-flight fetch is aborted on unmount (no stale setState).
 */

// Mock ReplacementCard so the panel tests stay unit-level — we assert the
// panel renders one card per candidate, keyed by strategy_id, not the card's
// own intro flow (covered by ReplacementCard.test.tsx).
vi.mock("./ReplacementCard", () => ({
  ReplacementCard: ({ candidate }: { candidate: BridgeCandidate }) => (
    <div data-testid="replacement-card" data-strategy-id={candidate.strategy_id}>
      {candidate.strategy_name}
    </div>
  ),
}));

function buildCandidate(partial: Partial<BridgeCandidate> = {}): BridgeCandidate {
  return {
    strategy_id: "s-1",
    strategy_name: "Candidate Alpha",
    sharpe_delta: 0.2,
    dd_delta: -0.03,
    corr_delta: -0.05,
    composite_score: 0.7,
    fit_label: "Good fit",
    ...partial,
  };
}

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
}

/**
 * Every `.ts`/`.tsx` file under `dir`. Used by the M74 negative pin to
 * enumerate ReplacementPanel's parents across the WHOLE of `src/` — a pin that
 * only checked the known parent could not detect the second one being added,
 * which is the mutation it exists to catch.
 */
function listFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return listFilesUnder(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

function renderPanel(onClose = vi.fn()) {
  return render(
    <ReplacementPanel
      portfolioId="p-1"
      strategyId="under-1"
      strategyName="Underperformer"
      insightSentence="Underperformer has trailed the baseline."
      onClose={onClose}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<ReplacementPanel> — H-1077", () => {
  it("renders the loading skeletons while the fetch is in flight", () => {
    mockFetch(() => new Promise<Response>(() => {}));
    renderPanel();
    expect(screen.getByLabelText("Loading candidates")).toBeInTheDocument();
  });

  it("POSTs to /api/bridge with portfolio_id + underperformer_strategy_id", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    );
    mockFetch(fetchSpy);

    renderPanel();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/bridge");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.portfolio_id).toBe("p-1");
    expect(body.underperformer_strategy_id).toBe("under-1");
  });

  it("renders one ReplacementCard per candidate, keyed by strategy_id", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          candidates: [
            buildCandidate({ strategy_id: "s-1", strategy_name: "Alpha" }),
            buildCandidate({ strategy_id: "s-2", strategy_name: "Beta" }),
          ],
        }),
        { status: 200 },
      ),
    );

    renderPanel();

    await waitFor(() =>
      expect(screen.getAllByTestId("replacement-card")).toHaveLength(2),
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("renders the empty state when candidates is an empty array", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    );

    renderPanel();

    await waitFor(() =>
      expect(
        screen.getByText(/No replacement candidates found/i),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("replacement-card")).toBeNull();
  });

  it("renders the error message when the bridge fetch returns a non-OK body", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ error: "Bridge service unavailable" }), {
        status: 500,
      }),
    );

    renderPanel();

    await waitFor(() =>
      expect(screen.getByText("Bridge service unavailable")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("replacement-card")).toBeNull();
  });

  // ⚠️ 140.3-07 / B-27 — this case USED to assert `getByText("network down")`,
  // i.e. it pinned the defect: the raw caught Error.message rendered to the
  // user. That is a deliberate behaviour change, not a weakened assertion — the
  // case still proves a rejected fetch surfaces as the panel's error state, and
  // it now ALSO proves the raw value does not reach the DOM. The console
  // breadcrumb assertions below (M-0905) are untouched.
  it("renders the stable sentence — not the raw caught message — when the fetch rejects", async () => {
    mockFetch(async () => {
      throw new Error("network down at 10.0.0.4:8002");
    });

    renderPanel();

    await waitFor(() =>
      expect(
        screen.getByText(
          "We could not load replacement candidates. Close this panel and open it again to retry.",
        ),
      ).toBeInTheDocument(),
    );
    expect(document.body.textContent).not.toContain("network down");
    expect(document.body.textContent).not.toContain("10.0.0.4");
  });

  // M-0905 (F1 loud-fail discipline): the inline error UI alone leaves
  // operators with zero log signal, so a bridge-scoring regression in the
  // Python service would show up only as silent in-app toasts. The swallowed
  // catch branch MUST emit a tagged `[bridge.fetch]` breadcrumb carrying the
  // request context so the failure rate is observable/aggregatable. These
  // tests fail if the console.error is dropped (regression) OR if it fires on
  // a genuine success/empty load (over-firing).
  it("logs the bridge failure via console.error with a stable prefix when the fetch returns non-OK", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch(async () =>
      new Response(JSON.stringify({ error: "Bridge service unavailable" }), {
        status: 500,
      }),
    );

    renderPanel();

    await waitFor(() =>
      expect(screen.getByText("Bridge service unavailable")).toBeInTheDocument(),
    );

    const tagged = errorSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("[bridge.fetch]"),
    );
    expect(tagged).toBeDefined();
    // Breadcrumb must carry the request context operators need to aggregate.
    expect(tagged?.[1]).toMatchObject({ portfolioId: "p-1", strategyId: "under-1" });
  });

  it("logs the bridge failure via console.error with a stable prefix when the fetch rejects", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch(async () => {
      throw new Error("network down");
    });

    renderPanel();

    // Anchor swapped from the raw message to the stable sentence (140.3-07 /
    // B-27). The assertion this case exists for — the tagged breadcrumb — is
    // unchanged, and it is what proves debuggability was NOT traded for the
    // copy fix: the raw value leaves the DOM but still reaches operators.
    await waitFor(() =>
      expect(
        screen.getByText(
          "We could not load replacement candidates. Close this panel and open it again to retry.",
        ),
      ).toBeInTheDocument(),
    );

    const tagged = errorSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("[bridge.fetch]"),
    );
    expect(tagged).toBeDefined();
    expect(tagged?.[1]).toMatchObject({ portfolioId: "p-1", strategyId: "under-1" });
  });

  it("does NOT log a bridge failure on a successful empty load (no false telemetry)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch(async () =>
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    );

    renderPanel();

    await waitFor(() =>
      expect(
        screen.getByText(/No replacement candidates found/i),
      ).toBeInTheDocument(),
    );

    const tagged = errorSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("[bridge.fetch]"),
    );
    expect(tagged).toBeUndefined();
  });

  it("calls onClose when Escape is pressed", async () => {
    mockFetch(() => new Promise<Response>(() => {}));
    const onClose = vi.fn();
    renderPanel(onClose);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop is clicked", () => {
    mockFetch(() => new Promise<Response>(() => {}));
    const onClose = vi.fn();
    const { container } = renderPanel(onClose);

    // The backdrop is the outer role="dialog" container (handleBackdropClick
    // only fires when target === currentTarget).
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onClose when the panel interior is clicked", () => {
    mockFetch(() => new Promise<Response>(() => {}));
    const onClose = vi.fn();
    renderPanel(onClose);

    // The header title lives inside the inner panel, not the backdrop.
    fireEvent.click(screen.getByText(/Replace Underperformer/));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when the explicit close button is clicked", () => {
    mockFetch(() => new Promise<Response>(() => {}));
    const onClose = vi.fn();
    renderPanel(onClose);

    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("aborts the in-flight fetch on unmount without a stale setState warning", async () => {
    let abortListenerInstalled = false;
    mockFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            abortListenerInstalled = true;
            signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }
        }),
    );

    const errorSpy = vi.spyOn(console, "error");
    const { unmount } = renderPanel();

    expect(abortListenerInstalled).toBe(true);
    unmount();

    await Promise.resolve();
    await Promise.resolve();

    const warned = errorSpy.mock.calls.some((call) =>
      call.some(
        (arg) =>
          typeof arg === "string" &&
          /unmounted|not wrapped in act|state update/i.test(arg),
      ),
    );
    expect(warned).toBe(false);
  });
});

/**
 * [140.3-07 / B-28] A malformed body must surface as the panel's ERROR state,
 * not as an empty-but-successful panel.
 *
 * `setCandidates(data.candidates ?? [])` collapsed every malformed shape to
 * `[]`, and the empty branch says "No replacement candidates found that would
 * improve this portfolio" — a claim about the USER'S PORTFOLIO made on the
 * strength of our own failed parse. That is the second half of SEAMUX-09's own
 * wording, and it is the reason the guard copies `OutcomesWidget`'s shape
 * rather than inventing one.
 */
describe("[140.3-07 / B-28] a malformed candidates payload is an error, not an empty panel", () => {
  const EMPTY_STATE_CLAIM = /No replacement candidates found/i;
  const STABLE_SENTENCE =
    "We could not load replacement candidates. Close this panel and open it again to retry.";

  it.each([
    ["the field is absent", {}],
    ["the field is null", { candidates: null }],
    ["the field is an object, not an array", { candidates: { "0": "x" } }],
    ["the field is a string", { candidates: "none" }],
    ["the whole body is not an object", null],
  ])("renders the error state when %s", async (_label, body) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch(async () => new Response(JSON.stringify(body), { status: 200 }));

    renderPanel();

    await waitFor(() =>
      expect(screen.getByText(STABLE_SENTENCE)).toBeInTheDocument(),
    );
    // The load-bearing half: the panel must NOT claim the portfolio has no
    // candidates when we simply could not read the answer.
    expect(screen.queryByText(EMPTY_STATE_CLAIM)).toBeNull();
    expect(screen.queryByTestId("replacement-card")).toBeNull();
  });

  it("ANTI-REGRESSION: a genuine empty array is still the empty state, not an error", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    );

    renderPanel();

    await waitFor(() =>
      expect(screen.getByText(EMPTY_STATE_CLAIM)).toBeInTheDocument(),
    );
    expect(screen.queryByText(STABLE_SENTENCE)).toBeNull();
  });

  it("logs the malformed payload so the parse failure is observable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch(async () =>
      new Response(JSON.stringify({ candidates: "none" }), { status: 200 }),
    );

    renderPanel();

    await waitFor(() =>
      expect(screen.getByText(STABLE_SENTENCE)).toBeInTheDocument(),
    );
    const tagged = errorSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("[bridge.fetch]"),
    );
    expect(tagged).toBeDefined();
    expect(tagged?.[1]).toMatchObject({ portfolioId: "p-1", strategyId: "under-1" });
  });
});

/**
 * [140.3-07 / M74] THE NEGATIVE PIN — ReplacementPanel is the LATENT third
 * member of the B-26 stale-result class, and it must STAY latent.
 *
 * Structurally it qualifies: it holds a fetched `candidates` result and an
 * `error` in independent state, and its render blocks are independent siblings
 * — exactly `KeyPermissionBadge`'s shape. It is unreachable only because of two
 * facts, and this pin asserts BOTH:
 *
 *   1. its only refetch trigger is a `[portfolioId, strategyId]` dep change on
 *      a single mount-effect — there is no user-facing re-run control; and
 *   2. its SOLE parent, `BridgeTrigger.tsx`, mounts it under `{open && …}` from
 *      one insight, so those two props cannot change while it is mounted.
 *
 * ⚠️ It is deliberately NOT fixed. Adding an invalidation here would convert a
 * pinned-latent member into a live one with no way to exercise the new code —
 * an untested path is worse than a structurally unreachable one. If a future
 * change adds a SECOND parent, or lets the props change while mounted, this pin
 * reddens and THAT is the moment to apply the locked `setCandidates(null)`
 * shape used at the two live members.
 */
describe("[140.3-07 / M74] the latent third member stays structurally unreachable", () => {
  const SRC = join(process.cwd(), "src", "components", "portfolio");
  const panelSource = readFileSync(join(SRC, "ReplacementPanel.tsx"), "utf8");
  const parentSource = readFileSync(join(SRC, "BridgeTrigger.tsx"), "utf8");

  it("has NO invalidation-before-refetch — the latent member is pinned, not fixed", () => {
    expect(panelSource).not.toMatch(/setCandidates\(null\)/);
    expect(panelSource).not.toMatch(/setCandidates\(\[\]\)/);
  });

  it("fetches from a single mount-effect keyed on [portfolioId, strategyId]", () => {
    // Exactly one effect in this file performs the fetch …
    const fetchingEffects = panelSource
      .split("useEffect(")
      .slice(1)
      .filter((block) => block.includes("fetch("));
    expect(fetchingEffects).toHaveLength(1);
    // … and its dep array is the two props, so nothing else can retrigger it.
    expect(panelSource).toContain("}, [portfolioId, strategyId]);");
  });

  it("has exactly ONE parent, and that parent mounts it conditionally", () => {
    // A second parent is the realistic way this member goes live: another
    // surface could hold it mounted while swapping strategyId.
    const parents = listFilesUnder(join(process.cwd(), "src")).filter(
      (file) =>
        !file.endsWith(".test.tsx") &&
        !file.endsWith("ReplacementPanel.tsx") &&
        readFileSync(file, "utf8").includes("<ReplacementPanel"),
    );
    expect(parents.map((p) => p.split("/").pop())).toEqual([
      "BridgeTrigger.tsx",
    ]);
    // The conditional mount is what guarantees a fresh mount per open, so a
    // new strategyId always arrives with a fresh, empty `candidates`.
    expect(parentSource).toMatch(/\{open && \(\s*<ReplacementPanel/);
  });

  it("BEHAVIOURAL: a re-render with unchanged props does not refetch", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    );
    mockFetch(fetchSpy);

    const { rerender } = renderPanel();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    rerender(
      <ReplacementPanel
        portfolioId="p-1"
        strategyId="under-1"
        strategyName="Underperformer"
        insightSentence="Underperformer has trailed the baseline."
        onClose={vi.fn()}
      />,
    );

    // No second request ⇒ no window in which a previous result could coexist
    // with a new error. This is what "latent" means, measured rather than
    // asserted from the source alone.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

/**
 * AliasEditor.test.tsx — FIX-LIST P266 / atomic ID G8.B.4.
 *
 * The component had no test file. Pin the four behaviors most likely to
 * regress under future React batching / Suspense / RSC changes:
 *
 *   1. Double-submit guard: rapid Enter+click only fires PATCH once
 *      even when the second handler reads stale `saving=false` (React
 *      batching may not have committed `setSaving(true)` yet).
 *   2. Escape during in-flight save: cancel sets editing=false but the
 *      fetch is left to resolve normally (no inflight cancellation —
 *      the row's audit log records what was actually attempted).
 *   3. 500 from the route surfaces an error message and stays in
 *      editing mode instead of optimistically swallowing failures.
 *   4. Whitespace-only input sends `alias: null` (matches the route
 *      contract — the route also coerces, so this is defense-in-depth
 *      at the client edge).
 */

const { mockRouterRefresh } = vi.hoisted(() => ({
  mockRouterRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRouterRefresh }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    title,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    title?: string;
  }) => (
    <a href={href} className={className} title={title}>
      {children}
    </a>
  ),
}));

import { AliasEditor } from "./AliasEditor";

const ROW = {
  strategy_id: "00000000-0000-0000-0000-bbbbbbbbbbbb",
  strategy: {
    id: "00000000-0000-0000-0000-bbbbbbbbbbbb",
    name: "Helios Alpha",
    codename: null,
    disclosure_tier: "institutional",
  },
};
const PORTFOLIO_ID = "00000000-0000-0000-0000-aaaaaaaaaaaa";

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockRouterRefresh.mockReset();
  fetchSpy = vi.fn();
  // Override global fetch so the component's fetch call is observable.
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

function clickEdit() {
  // The non-editing pencil icon button has aria-label `Rename ${shown}`.
  const editBtn = screen.getByRole("button", { name: /rename/i });
  fireEvent.click(editBtn);
}

describe("<AliasEditor> — G8.B.4 concurrent-edit + 500 + null coercion", () => {
  it("double-submit guard: rapid Enter+Enter in the same tick fires only one PATCH", async () => {
    // Hold the fetch promise so the second keydown lands while the
    // first save() is still in flight (setSaving(true) committed,
    // the await fetch hasn't resolved yet).
    let resolveFetch!: (v: Response) => void;
    fetchSpy.mockImplementation(
      () =>
        new Promise<Response>((r) => {
          resolveFetch = r;
        }),
    );

    render(
      <AliasEditor
        row={ROW}
        portfolioId={PORTFOLIO_ID}
        initial={null}
        canonical="Helios Alpha"
      />,
    );
    clickEdit();

    const input = (await screen.findByPlaceholderText("Helios Alpha")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Helios sleeve" } });

    // Race simulation: two Enter keydowns dispatched back-to-back.
    // The first calls save() which awaits fetch — the second goes
    // through the `if (saving) return` guard. Without the guard
    // (e.g., if a future refactor drops the saving check) two PATCH
    // calls would fire and the test fails.
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });

    // Resolve the in-flight fetch with a 200.
    await act(async () => {
      resolveFetch(
        new Response(JSON.stringify({ ok: true, alias: "Helios sleeve" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    // Critical assertion — fetch was called exactly once even though
    // two save() invocations raced.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mockRouterRefresh).toHaveBeenCalledTimes(1);
  });

  it("Escape during in-flight save returns to viewing mode but does not cancel the fetch", async () => {
    let resolveFetch!: (v: Response) => void;
    fetchSpy.mockImplementation(
      () =>
        new Promise<Response>((r) => {
          resolveFetch = r;
        }),
    );

    render(
      <AliasEditor
        row={ROW}
        portfolioId={PORTFOLIO_ID}
        initial="Old alias"
        canonical="Helios Alpha"
      />,
    );
    clickEdit();
    const input = (await screen.findByPlaceholderText("Helios Alpha")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "New alias" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    // Press Escape mid-flight. Component's keydown handler is bound on
    // the input; while saving, the input is still mounted. Cancel is
    // gated by the Cancel button which is `disabled={saving}`, but the
    // Escape keydown is NOT gated — the test pins the contract that
    // pressing Escape mid-flight does NOT abort the in-flight fetch
    // (no AbortController plumbed) and the fetch is allowed to settle.
    fireEvent.keyDown(input, { key: "Escape" });

    // Resolve the fetch — refresh fires only because the await chain
    // completed (the save handler doesn't observe the cancel).
    await act(async () => {
      resolveFetch(
        new Response(JSON.stringify({ ok: true, alias: "New alias" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mockRouterRefresh).toHaveBeenCalledTimes(1);
  });

  it("500 response surfaces error message and keeps the editor open", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: "investment row not found" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <AliasEditor
        row={ROW}
        portfolioId={PORTFOLIO_ID}
        initial={null}
        canonical="Helios Alpha"
      />,
    );
    clickEdit();
    const input = (await screen.findByPlaceholderText("Helios Alpha")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Helios sleeve" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.getByText(/investment row not found/i)).toBeInTheDocument(),
    );
    // Editor still mounted — Save button visible.
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    // No router.refresh on failure.
    expect(mockRouterRefresh).not.toHaveBeenCalled();
  });

  it("sends alias: null when the user types only whitespace", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, alias: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <AliasEditor
        row={ROW}
        portfolioId={PORTFOLIO_ID}
        initial="Old alias"
        canonical="Helios Alpha"
      />,
    );
    clickEdit();
    const input = (await screen.findByPlaceholderText("Helios Alpha")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "    " } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.alias).toBeNull();
    expect(sentBody.portfolio_id).toBe(PORTFOLIO_ID);
    expect(sentBody.strategy_id).toBe(ROW.strategy_id);
  });
});

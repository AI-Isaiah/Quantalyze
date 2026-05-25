import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M-1152 (audit-2026-05-07) — StrategyActions had zero tests, so the
 * console.error logging that PR #90 added in place of a silent
 * `.catch(() => {})` was uncovered.
 *
 * The submit-for-review flow fires a fire-and-forget POST to
 * /api/admin/notify-submission. When that POST rejects, the component must
 * log "[StrategyActions] founder-submission notify failed:" rather than
 * swallowing the failure. A regression dropping that log back to a silent
 * swallow would otherwise pass unnoticed.
 *
 * Also covers the status-driven render branches (draft / pending_review /
 * published / archived) and the data-gate modal that blocks submission when
 * the strategy has neither data nor an API key.
 */

// jsdom does not implement HTMLDialogElement.showModal()/close(); the Modal
// component calls them in a useEffect when `open` flips. Stub them so the
// published/draft branches (which render a <Modal>) don't throw.
if (typeof HTMLDialogElement !== "undefined") {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
      (this as unknown as { open: boolean }).open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
      (this as unknown as { open: boolean }).open = false;
    };
  }
}

const { mockUpdate, mockEq, mockFrom, mockRouterRefresh, mockRouterPush } =
  vi.hoisted(() => {
    const eq = vi.fn();
    const update = vi.fn(() => ({ eq }));
    return {
      mockEq: eq,
      mockUpdate: update,
      mockFrom: vi.fn(() => ({ update })),
      mockRouterRefresh: vi.fn(),
      mockRouterPush: vi.fn(),
    };
  });

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: mockFrom }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRouterRefresh, push: mockRouterPush }),
}));

import { StrategyActions } from "./StrategyActions";

const STRATEGY_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the supabase update resolves with no error.
  mockEq.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<StrategyActions> — M-1152", () => {
  it("logs '[StrategyActions] founder-submission notify failed:' when the notify POST rejects", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Notify POST rejects → catch handler must log, not swallow.
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockRejectedValue(new Error("boom"));

    render(
      <StrategyActions
        strategyId={STRATEGY_ID}
        status="draft"
        hasData={true}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit for Review" }));

    // The status update fires first…
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        status: "pending_review",
        review_note: null,
      }),
    );
    // …then the fire-and-forget notify POST.
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/admin/notify-submission",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    // The rejection must surface through console.error with the tagged prefix.
    await waitFor(() => {
      const logged = errorSpy.mock.calls.some(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes(
            "[StrategyActions] founder-submission notify failed:",
          ),
      );
      expect(logged).toBe(true);
    });
  });

  it("does NOT log an error when the notify POST resolves", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    render(
      <StrategyActions
        strategyId={STRATEGY_ID}
        status="draft"
        hasApiKey={true}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit for Review" }));

    await waitFor(() => expect(mockRouterRefresh).toHaveBeenCalled());

    const logged = errorSpy.mock.calls.some(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes("[StrategyActions] founder-submission notify failed:"),
    );
    expect(logged).toBe(false);
  });

  it("blocks submission and shows the data-gate modal when there is no data and no API key", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");

    render(
      <StrategyActions
        strategyId={STRATEGY_ID}
        status="draft"
        hasData={false}
        hasApiKey={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit for Review" }));

    // Gate copy appears; no status update and no notify POST fire.
    expect(
      await screen.findByText(/Before submitting your strategy for review/i),
    ).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders nothing for pending_review status", () => {
    const { container } = render(
      <StrategyActions strategyId={STRATEGY_ID} status="pending_review" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders an Archive button for published status", () => {
    render(<StrategyActions strategyId={STRATEGY_ID} status="published" />);
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("renders a Restore to Draft button for archived status", () => {
    render(<StrategyActions strategyId={STRATEGY_ID} status="archived" />);
    expect(
      screen.getByRole("button", { name: "Restore to Draft" }),
    ).toBeInTheDocument();
  });
});

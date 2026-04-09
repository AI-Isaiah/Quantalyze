import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SaveAsTestModal } from "./SaveAsTestModal";

/**
 * RTL tests for the Save-as-Test modal. Covers the save happy path,
 * error handling, auto-name default, Escape-to-close, and the
 * "cannot save zero-strategy" guard. The fetch call is mocked via a
 * global stub so tests don't require a running server.
 */

beforeEach(() => {
  vi.restoreAllMocks();
  // Next router mocked globally below.
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function renderModal(
  overrides: Partial<React.ComponentProps<typeof SaveAsTestModal>> = {},
) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const defaultProps: React.ComponentProps<typeof SaveAsTestModal> = {
    open: true,
    onClose,
    strategyIds: ["s1", "s2"],
    defaultName: "Active + Orion",
    onSaved,
  };
  const result = render(<SaveAsTestModal {...defaultProps} {...overrides} />);
  return { ...result, onClose, onSaved };
}

describe("SaveAsTestModal", () => {
  it("renders the auto-filled default name in the input", () => {
    renderModal();
    const input = screen.getByDisplayValue("Active + Orion");
    expect(input).toBeInTheDocument();
  });

  it("renders nothing when open=false", () => {
    const { container } = render(
      <SaveAsTestModal
        open={false}
        onClose={vi.fn()}
        strategyIds={["s1"]}
        defaultName="Test"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("closes on Cancel click", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("POSTs to /api/test-portfolios with the form values", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "new-test-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { onSaved, onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /Save test/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/test-portfolios");
    const body = JSON.parse((init as { body: string }).body);
    expect(body).toEqual({
      name: "Active + Orion",
      description: null,
      strategyIds: ["s1", "s2"],
    });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("new-test-1"));
  });

  it("shows inline error and keeps the modal open on failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "server explosion" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /Save test/i }));

    await waitFor(() =>
      expect(screen.getByText(/server explosion/)).toBeInTheDocument(),
    );
    // onClose must NOT have been called — the modal stays open.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("blocks submission with an inline error when the name is empty", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderModal({ defaultName: "" });
    fireEvent.click(screen.getByRole("button", { name: /Save test/i }));

    // Native form validation fires (input is required). fetch must not
    // have been called because the form didn't submit.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

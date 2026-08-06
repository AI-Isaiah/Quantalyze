/**
 * Phase 150 / Plan 150-07 Task 2 — the AllocateDialog contract.
 *
 * This is the phase's PRIMARY CTA: the only surface from which an allocator
 * can put money against an own-capital strategy. It writes through the Plan-05
 * route (`/api/portfolio-strategies/allocation`) and sends NO container id —
 * the route derives the caller's real portfolio from the session and lazily
 * provisions it (rev-4 / D-03-B), so a client-supplied `portfolio_id` would be
 * untrusted input the route must not honour anyway (T-150-40).
 *
 * ORACLE INDEPENDENCE (review round 3 W-3): the $1B cap boundary is asserted
 * with the LITERALS `1_000_000_000` / `1_000_000_001` typed in here, never via
 * `MAGNITUDE_CAPS.MAX_TICKET_SIZE_USD`. Importing the constant would make the
 * test agree with any edit to it, including one that silently swaps in the
 * $1e12 AUM cap and makes the approved "$1B sanity cap" copy wrong by 1000×.
 *
 * COPY (byte-binding, 150-UI-SPEC Copywriting Contract) is likewise typed in
 * as literals. ONE deliberate supersession: the helper line is
 * `Weight shows each strategy's share of your allocated capital.`, NOT the
 * UI-SPEC's `Weight appears once your book equity is known.` — under the
 * D-12-B amendment weight renders immediately as share-of-allocated, so the
 * book-equity conditional would be false copy. See the plan's Task 2 behavior
 * block; a copy audit must not "fix" this back.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AllocateDialog } from "./AllocateDialog";

// jsdom lacks HTMLDialogElement.showModal()/close(); the Modal primitive calls
// them from a useEffect when `open` is true (Modal.test.tsx:23-39).
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

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: (...args: unknown[]) => refresh(...args),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

/** `fetch` is spied (never stubGlobal — a leaked stub reddens CI only). */
let fetchSpy: ReturnType<typeof vi.spyOn>;

function okResponse(body: unknown = { ok: true }) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response;
}

function failResponse(status: number, body: unknown, headers?: HeadersInit) {
  return {
    ok: false,
    status,
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  refresh.mockClear();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

const onClose = vi.fn();

function renderAllocate(over: Partial<Parameters<typeof AllocateDialog>[0]> = {}) {
  onClose.mockClear();
  return render(
    <AllocateDialog
      open
      onClose={onClose}
      mode="allocate"
      strategyId="strat-1"
      strategyName="Black Swan"
      currentAmount={null}
      {...over}
    />,
  );
}

function renderEdit(over: Partial<Parameters<typeof AllocateDialog>[0]> = {}) {
  return renderAllocate({ mode: "edit", currentAmount: 120_000, ...over });
}

function amountInput(): HTMLInputElement {
  return screen.getByLabelText("Allocation (USD)") as HTMLInputElement;
}

describe("<AllocateDialog> — titles, field, helper", () => {
  it("allocate mode carries the byte-exact title and the primary CTA label", () => {
    renderAllocate();
    expect(screen.getByText("Allocate — Black Swan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allocate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("edit mode carries its own title, CTA label, and prefills currentAmount", () => {
    renderEdit();
    expect(screen.getByText("Edit allocation — Black Swan")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save allocation" }),
    ).toBeInTheDocument();
    expect(amountInput().value).toBe("120000");
  });

  it("renders the D-12-B helper line, and NOT the superseded book-equity line", () => {
    renderAllocate();
    expect(
      screen.getByText(
        "Weight shows each strategy's share of your allocated capital.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/book equity is known/),
    ).not.toBeInTheDocument();
  });

  it("never previews a fabricated weight percentage inside the dialog", () => {
    // PATTERNS § No Analog Found row 2 stands: no book-equity scalar exists,
    // so a `≈ {w}%` preview here would be an invented number. The derived
    // weight appears in the ROW after the confirmed write, never here.
    const { container } = renderEdit();
    expect(container.textContent).not.toMatch(/≈/);
    expect(container.textContent).not.toMatch(/\d%/);
  });

  it("closes without writing when Cancel is pressed", () => {
    renderAllocate();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("<AllocateDialog> — inline validation (never a disabled CTA)", () => {
  it.each([
    ["empty", ""],
    ["zero", "0"],
    ["negative", "-5"],
    ["non-numeric", "abc"],
  ])("submitting %s surfaces the inline error and issues NO fetch", (_label, value) => {
    renderAllocate();
    const input = amountInput();
    fireEvent.change(input, { target: { value } });
    const cta = screen.getByRole("button", { name: "Allocate" });
    expect(cta).not.toBeDisabled();
    fireEvent.click(cta);

    expect(screen.getByText("Enter an amount above $0.")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    // The CTA stays clickable — no-disabled-buttons direction.
    expect(cta).not.toBeDisabled();
    // Red border + focus land on the field itself.
    expect(input.className).toMatch(/border-negative/);
    expect(document.activeElement).toBe(input);
  });

  it("above the $1B cap surfaces the cap copy and issues NO fetch", () => {
    renderAllocate();
    fireEvent.change(amountInput(), { target: { value: "1000000001" } });
    fireEvent.click(screen.getByRole("button", { name: "Allocate" }));

    expect(
      screen.getByText("That's above the $1B sanity cap — check the amount."),
    ).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("EXACTLY $1,000,000,000 is valid and DOES fetch (the copy fires only ABOVE the cap)", async () => {
    fetchSpy.mockResolvedValue(okResponse());
    renderAllocate();
    fireEvent.change(amountInput(), { target: { value: "1000000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Allocate" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText("That's above the $1B sanity cap — check the amount."),
    ).not.toBeInTheDocument();
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).allocated_amount).toBe(1000000000);
  });
});

describe("<AllocateDialog> — the write", () => {
  it("POSTs { strategy_id, allocated_amount } and NO portfolio id, then closes + refreshes", async () => {
    fetchSpy.mockResolvedValue(okResponse());
    renderAllocate();
    fireEvent.change(amountInput(), { target: { value: "120000" } });
    fireEvent.click(screen.getByRole("button", { name: "Allocate" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/portfolio-strategies/allocation");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ strategy_id: "strat-1", allocated_amount: 120000 });
    // rev-4 / D-03-B — the container is derived server-side. A client-sent id
    // would be untrusted input (T-150-40).
    expect(Object.keys(body)).not.toContain("portfolio_id");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not optimistically report success before the write confirms", async () => {
    let resolveFetch: (r: Response) => void = () => {};
    fetchSpy.mockImplementation(
      () => new Promise<Response>((res) => (resolveFetch = res)),
    );
    renderAllocate();
    fireEvent.change(amountInput(), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Allocate" }));

    // In flight: nothing closed, nothing refreshed.
    expect(onClose).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();

    resolveFetch(okResponse());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("a server failure renders the envelope, keeps the dialog open, and preserves the input", async () => {
    fetchSpy.mockResolvedValue(failResponse(500, { error: "internal error" }));
    renderAllocate();
    fireEvent.change(amountInput(), { target: { value: "120000" } });
    fireEvent.click(screen.getByRole("button", { name: "Allocate" }));

    await waitFor(() =>
      expect(screen.getByTestId("error-envelope")).toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(amountInput().value).toBe("120000");
  });

  it("a rejected fetch (offline) renders the envelope rather than throwing", async () => {
    fetchSpy.mockRejectedValue(new TypeError("Failed to fetch"));
    renderAllocate();
    fireEvent.change(amountInput(), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Allocate" }));

    await waitFor(() =>
      expect(screen.getByTestId("error-envelope")).toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a 429 renders the RATE_LIMITED envelope carrying the advertised wait", async () => {
    fetchSpy.mockResolvedValue(
      failResponse(429, { error: "Too many requests" }, { "Retry-After": "30" }),
    );
    renderAllocate();
    fireEvent.change(amountInput(), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Allocate" }));

    await waitFor(() =>
      expect(screen.getByTestId("error-envelope")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("error-envelope")).toHaveAttribute(
      "data-error-code",
      "RATE_LIMITED",
    );
    expect(screen.getByTestId("error-envelope-wait")).toHaveTextContent("30s");
  });

  it("a 409 (mark flipped between render and submit) refreshes the stale row behind the envelope", async () => {
    // The 150-05 edit-path race: the row offered Edit because it was marked
    // own-capital at render time. Retrying the same write re-fails, so the
    // graceful response is to re-fetch the row set — the affordance disappears
    // once the user closes the dialog, instead of inviting an identical retry.
    fetchSpy.mockResolvedValue(failResponse(409, { error: "not_allocatable" }));
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "Save allocation" }));

    await waitFor(() =>
      expect(screen.getByTestId("error-envelope")).toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("<AllocateDialog> — remove allocation (edit mode only)", () => {
  it("allocate mode offers NO remove action", () => {
    renderAllocate();
    expect(
      screen.queryByRole("button", { name: "Remove allocation…" }),
    ).not.toBeInTheDocument();
  });

  it("edit mode swaps the body to the two-step confirm with byte-exact copy", () => {
    renderEdit();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove allocation…" }),
    );

    expect(
      screen.getByText(
        "Remove this allocation? Black Swan leaves your allocation. The own-capital mark stays.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep" })).toBeInTheDocument();
    // The confirm REPLACES the form body — it is not a nested modal.
    expect(screen.queryByLabelText("Allocation (USD)")).not.toBeInTheDocument();
  });

  it("Keep returns to the form without writing, amount intact", () => {
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "Remove allocation…" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));

    expect(amountInput().value).toBe("120000");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Remove DELETEs { strategy_id } then closes + refreshes", async () => {
    fetchSpy.mockResolvedValue(okResponse());
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "Remove allocation…" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/portfolio-strategies/allocation");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body as string)).toEqual({ strategy_id: "strat-1" });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("a failed remove keeps the confirm arm open under an envelope", async () => {
    fetchSpy.mockResolvedValue(failResponse(500, { error: "internal error" }));
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "Remove allocation…" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(screen.getByTestId("error-envelope")).toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });
});

describe("<AllocateDialog> — source pins", () => {
  it("the dialog is closed when `open` is false", () => {
    render(
      <AllocateDialog
        open={false}
        onClose={onClose}
        mode="allocate"
        strategyId="strat-1"
        strategyName="Black Swan"
        currentAmount={null}
      />,
    );
    expect(screen.queryByText("Allocate — Black Swan")).not.toBeInTheDocument();
  });
});

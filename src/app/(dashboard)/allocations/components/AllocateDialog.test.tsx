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
import type { ComponentProps } from "react";
import { AllocateDialog } from "./AllocateDialog";

/**
 * 151 red-team K2 — THE FOCUS-RING SWEEP'S CARVE-OUT, MADE UN-INHERITABLE.
 *
 * The sweep below holds every focusable control THIS FILE authors to the
 * clip-proof ring idiom, and carves out the two shared primitives it composes
 * (`ui/Button`, `ui/Modal`) because their rings are repo-wide surface fixed as
 * their own follow-up. The carve-out used to be a Tailwind substring match —
 * `className.includes("inline-flex items-center justify-center rounded-md")` —
 * which is exactly the shape of the original defect it was written to close: a
 * future hand-rolled `<button>` in `AllocateDialog.tsx` that copied those base
 * classes (the obvious thing to do when you want a button that looks like the
 * others) would have been silently exempted, and the sweep would have gone
 * green over a genuine violation.
 *
 * So the exemption is now STRUCTURAL, not cosmetic. These two wrappers render
 * the REAL primitives — same DOM, same classes, so the sweep is still looking
 * at production markup — and stamp the boundary the sweep reads:
 *
 *   • `data-ui-primitive="ui/Button"` lands on the element `ui/Button` itself
 *     renders (it spreads `...props` onto its `<button>`), so ONLY a real
 *     `<Button>` carries it.
 *   • `data-consumer-scope="AllocateDialog"` wraps the children `ui/Modal` is
 *     GIVEN, which separates the dialog's own markup from the modal chrome
 *     (the close button) rendered around it.
 *
 * Authored = inside the consumer scope, without the primitive stamp. Copying
 * classes cannot earn either marker: a hand-rolled control would have to write
 * `data-ui-primitive` on itself in the source to escape the sweep, which is not
 * something anyone does by accident.
 */
vi.mock("@/components/ui/Button", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/ui/Button")>();
  return {
    ...actual,
    Button: (props: ComponentProps<typeof actual.Button>) => (
      <actual.Button {...props} data-ui-primitive="ui/Button" />
    ),
  };
});

vi.mock("@/components/ui/Modal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/Modal")>();
  return {
    ...actual,
    Modal: ({ children, ...rest }: ComponentProps<typeof actual.Modal>) => (
      <actual.Modal {...rest}>
        <div data-consumer-scope="AllocateDialog">{children}</div>
      </actual.Modal>
    ),
  };
});

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

/**
 * The node `Field` announces as the control's error, resolved THROUGH
 * `aria-describedby` rather than by text search — so "the message a sighted
 * user reads" and "the message a screen reader is pointed at" are asserted to
 * be the same node, not two independently-true facts.
 *
 * `aria-describedby` is a space-separated id LIST (`Field` joins a hint id
 * ahead of the error id when a hint is present), so it is split rather than
 * looked up whole: a `getElementById` against the raw attribute returns `null`
 * the day a hint lands on this field, which would silently turn every message
 * assertion below into a check of `null`.
 */
function errorNodeFor(control: HTMLElement): HTMLElement | null {
  const describedBy = control.getAttribute("aria-describedby");
  if (!describedBy) return null;
  for (const id of describedBy.split(/\s+/).filter(Boolean)) {
    if (id.endsWith("-error")) return document.getElementById(id);
  }
  return null;
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
    // 153.2 / FLAG-1 — THE OLD ASSERTION HERE WAS `/border-negative/` ON THE
    // className, WHICH PASSED FOR BOTH MECHANISMS AND SO PROVED NOTHING ABOUT
    // THE ONE THAT MATTERS. It matched the hand-toggled ternary this phase
    // deleted (`fieldError ? "border-negative" : …`) exactly as happily as the
    // derived class that replaced it, so it could not have caught a revert — or
    // a red field whose a11y wiring was silently gone. The pair below can: the
    // ARIA state must be SET, and the red must be a CONSEQUENCE of it.
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.className).toContain("aria-[invalid=true]:border-negative");
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

  /**
   * 153.2 / FLAG-1 — THE RED IS DERIVED, AND THE VISUAL AND ANNOUNCED STATES
   * ARE ONE FACT.
   *
   * Until this phase the border was a JS ternary on `fieldError`. It rendered
   * correctly, but only by coincidence: the same state also fed `Field`'s
   * `error` prop, so nothing forced the two to agree. Anyone who later coloured
   * the field from a different condition — or kept the colour while dropping
   * the `error` prop — would have shipped a control that reads "wrong" to a
   * sighted user and "fine" to a screen reader, with every existing assertion
   * still green.
   *
   * This row closes that by asserting the CAUSAL CHAIN rather than the outcome:
   * `Field` writes the ARIA state, the class turns red BECAUSE of that state,
   * and `aria-describedby` resolves to the very node carrying the sentence on
   * screen. Break any link and this reds.
   */
  it("[153.2 FLAG-1] the red border DERIVES from the ARIA state, and points at the visible message", () => {
    renderAllocate();
    const input = amountInput();
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Allocate" }));

    // (1) `Field` set the state — the component must never write it itself, or
    //     the child's own prop would win the spread and re-open the hazard.
    expect(input).toHaveAttribute("aria-invalid", "true");
    // (2) The red is a CONSEQUENCE of (1): the variant is what paints it, so a
    //     hand-toggled `border-negative` cannot satisfy this.
    expect(input.className).toContain("aria-[invalid=true]:border-negative");
    // (3) …and the resting colour is unconditional, so nothing else can be
    //     driving the swap.
    expect(input.className).toContain("border-border");
    // (4) The announced message IS the visible message — one node, not two
    //     independently-true facts.
    const announced = errorNodeFor(input);
    expect(announced).not.toBeNull();
    expect(announced).toHaveTextContent("Enter an amount above $0.");
    expect(announced).toBe(screen.getByText("Enter an amount above $0."));
  });

  /**
   * D-12 — AN AMOUNT THE USER HAS ALREADY CORRECTED MUST NOT STILL READ RED.
   *
   * `fieldError` was set on save and cleared only on the NEXT save, so the
   * field kept its red (and its sentence) while the user stared at a value that
   * was already fine. The fix must land on `change`, not on blur and not on a
   * second click — which is the only reason this row never blurs the control.
   */
  it("[D-12] a corrected amount clears the message and the red LIVE, without a second click", async () => {
    fetchSpy.mockResolvedValue(okResponse());
    renderAllocate();
    const input = amountInput();
    const cta = screen.getByRole("button", { name: "Allocate" });

    fireEvent.change(input, { target: { value: "-5" } });
    fireEvent.click(cta);
    expect(screen.getByText("Enter an amount above $0.")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");

    // The correction ALONE clears it. No blur, no second click.
    fireEvent.change(input, { target: { value: "25000" } });
    expect(
      screen.queryByText("Enter an amount above $0."),
    ).not.toBeInTheDocument();
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
    expect(errorNodeFor(input)).toBeNull();
    // Clearing a message is not a write — the user typed, they did not submit.
    expect(fetchSpy).not.toHaveBeenCalled();

    // …and the clear did not SWALLOW the write either: one click, one fetch,
    // carrying the corrected amount. A "fix" that reset state too eagerly would
    // fail here rather than passing the clear assertions above in isolation.
    fireEvent.click(cta);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).allocated_amount).toBe(25000);
  });

  it("[D-12] the live re-evaluation SWAPS the message when the value is still invalid for a different reason", () => {
    // The re-evaluation re-runs the mirror; it does not blanket-clear. A
    // `setFieldError(null)` on every keystroke would satisfy the clear row
    // above while telling a user who typed $1B+1 that their amount is fine
    // until they click again — the same second-click defect, one bound over.
    renderAllocate();
    const input = amountInput();
    fireEvent.change(input, { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Allocate" }));
    expect(screen.getByText("Enter an amount above $0.")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "1000000001" } });
    expect(
      screen.getByText("That's above the $1B sanity cap — check the amount."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Enter an amount above $0."),
    ).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("[D-12] typing an invalid amount BEFORE any refusal stays silent — the field does not go red mid-keystroke", () => {
    // The other half of the reveal-timing rule, and the reason the live
    // re-evaluation is gated on a message already showing: someone reaching for
    // "-5000" types "-" first. A field that reddened on every keystroke would
    // scold the user for a number they have not finished entering.
    renderAllocate();
    const input = amountInput();
    fireEvent.change(input, { target: { value: "0" } });

    expect(input.getAttribute("aria-invalid")).not.toBe("true");
    expect(errorNodeFor(input)).toBeNull();
    expect(
      screen.queryByText("Enter an amount above $0."),
    ).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
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

  /**
   * 151 review E5 + E6 — ONE code path, two defects.
   *
   * E5: the route has emitted 409 `{error:"not_allocatable"}` since Phase 150,
   * and NO client read it. `envelopeForResponse` branched on `res.status === 429`
   * alone, so this landed on UNKNOWN, whose copy deliberately "makes no claim
   * about what happened" — the ONE refusal on this surface with a one-screen
   * remedy was the one the user was told nothing about.
   *
   * E6: UNKNOWN's entry is `actions: ["clear_and_retry", …]` ⇒ recoverable, and
   * `onRetry` was wired unconditionally, so the user got a "Try the last action
   * again." CTA for a request the server refuses identically until the mark
   * changes. The file's own comment claimed the opposite behaviour.
   *
   * The oracles are BEHAVIOURAL (the code on the envelope, the remedy named in
   * the copy, the absence of the control) rather than a byte-compare against an
   * imported string — importing the copy would make the assertion agree with any
   * edit, including one that put the vague sentence back.
   */
  it("[E5] a 409 not_allocatable renders the mark-remedy envelope, not the no-claim UNKNOWN one", async () => {
    fetchSpy.mockResolvedValue(failResponse(409, { error: "not_allocatable" }));
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "Save allocation" }));

    const envelope = await screen.findByTestId("error-envelope");
    expect(envelope).toHaveAttribute(
      "data-error-code",
      "ALLOCATION_NOT_ALLOCATABLE",
    );
    // The copy must NAME the remedy — a mark, and where to set it.
    expect(envelope.textContent).toMatch(/own capital/i);
    expect(envelope.textContent).toMatch(/My Strategies/i);
    // And it must NOT be the sentence that makes no claim about what happened.
    expect(envelope.textContent).not.toContain("Something went wrong.");
  });

  it("[E6] the mark-flipped 409 offers NO Retry — the server refuses the identical request forever", async () => {
    fetchSpy.mockResolvedValue(failResponse(409, { error: "not_allocatable" }));
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "Save allocation" }));

    await screen.findByTestId("error-envelope");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    // Non-vacuity: the write really was attempted and really did fail.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("[E6 control] a genuinely retryable failure STILL offers Retry, and it re-issues the write", async () => {
    // The guard must not degrade into "no surface ever retries". A 500 is
    // unclassified → UNKNOWN → recoverable, and Retry is the right affordance.
    fetchSpy.mockResolvedValue(failResponse(500, { error: "internal error" }));
    renderAllocate();
    fireEvent.change(amountInput(), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Allocate" }));

    await screen.findByTestId("error-envelope");
    const retry = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  });

  it("[E5] an UNREADABLE 409 body falls through to UNKNOWN rather than claiming a mark problem", async () => {
    // The code rides the BODY. A response we cannot read supports no verdict,
    // so naming the mark remedy would be an invented claim.
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 409,
      headers: new Headers(),
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON at position 0");
      },
    } as unknown as Response);
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "Save allocation" }));

    const envelope = await screen.findByTestId("error-envelope");
    expect(envelope).toHaveAttribute("data-error-code", "UNKNOWN");
  });
});

describe("<AllocateDialog> — 151 review E7 + I4: the focus indicators this file authors", () => {
  /**
   * WCAG 1.4.11 (≥3:1 non-text contrast). The money field shipped
   * `focus:ring-accent/20` — a 20%-alpha ring measuring ~1.3:1 against
   * `bg-surface`, i.e. an indicator a sighted keyboard user cannot see — on the
   * money input of this phase's primary CTA, and it dropped the `border-focus`
   * companion every shared input primitive carries. The repo already treats the
   * alpha ring as a defect at two other sites
   * (`factsheet/[id]/v2/focus-ring-clipproof.test.tsx`, `AllocationsTabs.test.tsx`);
   * this asserts the same tokens, so the surfaces cannot drift apart.
   *
   * ⚠️ 151 review I4 — WHY THIS IS A SWEEP AND NOT A NAMED ELEMENT. The E7 fix
   * landed on the money input while "Remove allocation…" — borderless,
   * `hover:underline` only, so the ring is its ENTIRE keyboard affordance, and
   * the destructive action on this surface — kept `ring-accent/50` with no
   * `ring-inset`. The old assertion could not see it: it read
   * `amountInput().className`, so its `not.toMatch(/ring-accent\/\d+/)` was
   * scoped to the one element already fixed. A pin that can only see the
   * element the fix touched cannot catch the element the fix missed. So the
   * oracle now ENUMERATES the dialog's focusable controls and holds every one
   * of them to the idiom — a control added to this file later is covered by
   * construction, not by someone remembering to extend a list.
   */

  /**
   * The sweep covers the controls THIS FILE styles. Two shared primitives it
   * composes are carved out, because their rings are repo-wide surface (every
   * dialog in the app mounts `ui/Modal`, and `ui/Button` is the app's button):
   * both still carry `focus-visible:ring-accent/50`, and fixing them from
   * inside one dialog's spec would either fork the primitive or redden a file
   * this change does not own. They are reported as their own finding.
   *
   * 151 red-team K2 — the carve-out identifies the primitives STRUCTURALLY,
   * via the markers the module mocks at the top of this file stamp on the exact
   * elements each primitive renders. It used to match a Tailwind base-class
   * substring, which a hand-rolled `<button>` copying those classes would have
   * inherited — re-creating the very hole the sweep replaced (an oracle that
   * cannot see the offending control). Copying classes earns nothing here.
   */
  const FOCUSABLE_SELECTOR =
    'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
  /** Stamped by the `ui/Button` mock onto the `<button>` the primitive renders. */
  const UI_BUTTON_MARK = "data-ui-primitive";
  /** Wraps the children `ui/Modal` is GIVEN — i.e. this file's own markup. */
  const CONSUMER_SCOPE = '[data-consumer-scope="AllocateDialog"]';

  /** Everything `AllocateDialog.tsx` renders inside the modal, primitives aside. */
  function authoredFocusables(): HTMLElement[] {
    const scope = document.querySelector<HTMLElement>(CONSUMER_SCOPE);
    // If the mock ever stops applying, the scope disappears and this sweep
    // would quietly reduce to an empty set. Fail here instead.
    expect(scope).not.toBeNull();
    return Array.from(
      scope!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((el) => !el.hasAttribute(UI_BUTTON_MARK));
  }

  /** The `ui/Button` instances the sweep is EXCUSING, inside the same scope. */
  function exemptedPrimitives(): HTMLElement[] {
    const scope = document.querySelector<HTMLElement>(CONSUMER_SCOPE);
    expect(scope).not.toBeNull();
    return Array.from(
      scope!.querySelectorAll<HTMLElement>(`[${UI_BUTTON_MARK}="ui/Button"]`),
    );
  }

  /** The in-repo clip-proof idiom, verbatim (StrategyTable.tsx:100, FactsheetView.tsx:770). */
  function expectClipProofRing(el: HTMLElement) {
    const cls = el.className;
    // The UA outline is suppressed so nothing paints outside to be clipped …
    expect(cls).toContain("focus-visible:outline-none");
    // … replaced by an INSET ring, which an ancestor's overflow cannot clip …
    expect(cls).toContain("focus-visible:ring-2");
    expect(cls).toContain("focus-visible:ring-inset");
    expect(cls).toContain("focus-visible:ring-accent");
    // … at FULL opacity: the defect itself, named. `/20` was E7's, `/50` was
    // I4's, and any future alpha is the same failure.
    expect(cls).not.toMatch(/ring-accent\/\d+/);
    // No OUTSET outline idiom may be reintroduced (only `-none` allowed).
    expect(cls).not.toMatch(
      /focus-visible:outline-(?!none)(offset|2|4|accent|\[)/,
    );
  }

  it("EVERY focusable control this file styles carries the full-opacity inset ring — both dialog arms", () => {
    renderEdit();

    const formArm = authoredFocusables();
    // Non-vacuity, and the exact widening: the sweep must reach BOTH of this
    // file's own controls. A regression that deletes the remove button, or one
    // that re-scopes this oracle back to a single element, fails here rather
    // than passing over an empty set.
    expect(formArm).toContain(amountInput());
    expect(formArm).toContain(
      screen.getByRole("button", { name: "Remove allocation…" }),
    );
    expect(formArm.length).toBeGreaterThanOrEqual(2);
    for (const el of formArm) expectClipProofRing(el);

    // 151 red-team K2 — NON-VACUITY FOR THE CARVE-OUT ITSELF. A sweep is only
    // as honest as the set it excuses, so pin what is being excused and why:
    //   (i)  the exemption really is finding the shared primitives (a mock that
    //        stopped applying would exempt nothing and, worse, a deleted
    //        consumer scope would empty the swept set — caught above);
    //   (ii) every element it excuses carries the alpha ring that is the SOLE
    //        reason for the exemption. An exempted control that is already
    //        compliant does not need excusing, and one that is non-compliant
    //        for some OTHER reason is a violation hiding behind this list.
    //   (iii) the Modal chrome sits outside the consumer scope, so it is
    //        excluded structurally rather than by an `aria-label` guess a
    //        hand-rolled dismiss button could have inherited.
    // ⚠️ When `ui/Button`'s ring is fixed repo-wide, (ii) goes red — and that
    // is the signal to DELETE this carve-out, not to loosen the assertion.
    const exempted = exemptedPrimitives();
    expect(exempted.length).toBeGreaterThanOrEqual(2);
    for (const el of exempted) {
      expect(el.className).toContain("focus-visible:ring-accent/50");
    }
    // No authored control may also be exempted — the two sets are disjoint.
    for (const el of formArm) expect(exempted).not.toContain(el);
    // The Modal close button is chrome, not this file's markup.
    const close = screen.getByRole("button", { name: "Close" });
    expect(formArm).not.toContain(close);
    expect(exempted).not.toContain(close);

    // The confirm arm REPLACES the body, so its controls never coexist with the
    // form's and a single-render sweep would miss them. Today it renders only
    // shared `ui/Button`s, so the authored set is empty — swept anyway, so a
    // raw control added to that arm is caught the day it appears.
    fireEvent.click(screen.getByRole("button", { name: "Remove allocation…" }));
    for (const el of authoredFocusables()) expectClipProofRing(el);
  });

  it("the money field additionally keeps the border companion every shared input primitive carries", () => {
    renderAllocate();
    expect(amountInput().className).toContain(
      "focus-visible:border-border-focus",
    );
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

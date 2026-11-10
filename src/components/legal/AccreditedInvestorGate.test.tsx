/**
 * AccreditedInvestorGate — the one attestation UI behind /discovery's full-page
 * gate and the attest step inside the two intro entry points (Phase 194.2 D-04).
 *
 * WHY these arms exist: the gate text is lawyer-reviewed, so the modal variant
 * may differ from /discovery in exactly one clause (D-06) and nowhere else; the
 * page render must not move at all; and the error path used to print the
 * route's raw body (`{"error":"Rate limit exceeded"}`) on a legal-consent
 * surface (UD-06). Expected strings are typed by hand, never imported from the
 * component.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { AccreditedInvestorGate } from "./AccreditedInvestorGate";

// Captured from the component BEFORE the 194.2 change: the no-prop render is byte-identical.
const PAGE_MARKUP =
  "<div class=\"mx-auto max-w-2xl py-12\"><div class=\"bg-surface rounded-lg border border-border shadow-card p-6 p-8\"><h1 class=\"text-2xl font-semibold text-text-primary\">Accredited Investor Acknowledgment</h1><p class=\"mt-3 text-sm text-text-secondary leading-relaxed\">The strategies listed on this platform are made available to accredited or qualified investors only. Before viewing, please confirm the following:</p><ul class=\"mt-4 space-y-2 text-sm text-text-secondary list-disc pl-5\"><li>I qualify as an accredited investor (or the equivalent in my jurisdiction) per applicable securities regulations.</li><li>I understand that past performance does not guarantee future results and that cryptocurrency trading involves substantial risk of loss.</li><li>I understand that strategies shown are monitored via read-only exchange APIs. Managers retain custody of their assets. The platform provides analytics only \u2014 no pooling, no fund administration.</li><li>I understand that introduction requests are routed through the platform team and that managers may decline an introduction.</li></ul><form class=\"mt-6 space-y-4\"><label class=\"flex items-start gap-3 text-sm text-text-secondary\"><input class=\"mt-0.5 h-4 w-4 cursor-pointer accent-accent\" type=\"checkbox\"><span>I confirm the statements above and acknowledge that I am an accredited or qualified investor.</span></label><div class=\"flex items-center justify-between pt-2\"><a href=\"/legal/disclaimer\" class=\"text-xs text-text-muted underline hover:text-text-secondary\">Read the full disclaimer</a><button class=\"inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50 disabled:pointer-events-none bg-accent text-white hover:bg-accent-hover min-h-[44px] px-4 py-2.5 text-body\" type=\"submit\" disabled=\"\">Continue to discovery</button></div></form></div></div>";

const fetchMock = vi.fn();

beforeEach(() => {
  refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderModal(over: Partial<React.ComponentProps<typeof AccreditedInvestorGate>> = {}) {
  const onAttested = vi.fn();
  const onDismiss = vi.fn();
  const utils = render(
    <AccreditedInvestorGate
      variant="modal"
      confirmLabel="Confirm and request intro"
      onAttested={onAttested}
      onDismiss={onDismiss}
      {...over}
    />,
  );
  return { ...utils, onAttested, onDismiss };
}

function checkAndConfirm(label = "Confirm and request intro") {
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: label }));
}

describe("AccreditedInvestorGate — the /discovery page render", () => {
  it("keeps the full-page markup byte-identical", () => {
    const { container } = render(<AccreditedInvestorGate />);
    expect(container.innerHTML).toBe(PAGE_MARKUP);
  });

  it("keeps its lead, heading and button word for word", () => {
    render(<AccreditedInvestorGate />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Accredited Investor Acknowledgment" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Before viewing, please confirm the following:/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Before requesting an introduction/)).toBeNull();
    expect(screen.getByRole("button", { name: "Continue to discovery" })).toBeDisabled();
  });
});

describe("AccreditedInvestorGate — the in-modal variant", () => {
  it("has no h1 and no Card, and its lead reads Before requesting an introduction", () => {
    const { container } = renderModal();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(container.querySelector(".max-w-2xl")).toBeNull();
    expect(container.querySelector(".shadow-card")).toBeNull();
    expect(
      screen.getByText(
        "The strategies listed on this platform are made available to accredited or qualified investors only. Before requesting an introduction, please confirm the following:",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Before viewing/)).toBeNull();
  });

  it("carries the four bullets and the checkbox sentence identically to the page render", () => {
    const page = render(<AccreditedInvestorGate />);
    const pageBullets = Array.from(page.container.querySelectorAll("li")).map((l) => l.textContent);
    const pageLabel = page.container.querySelector("label")?.textContent;
    page.unmount();

    const modal = renderModal();
    const modalBullets = Array.from(modal.container.querySelectorAll("li")).map((l) => l.textContent);
    expect(pageBullets).toHaveLength(4);
    expect(modalBullets).toEqual(pageBullets);
    expect(modal.container.querySelector("label")?.textContent).toBe(pageLabel);
    expect(pageLabel).toBe(
      "I confirm the statements above and acknowledge that I am an accredited or qualified investor.",
    );
  });

  it("confirm is disabled until the box is checked; dismiss is secondary, records nothing and calls onDismiss", () => {
    const { onDismiss } = renderModal();
    const confirm = screen.getByRole("button", { name: "Confirm and request intro" });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(confirm).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Close without confirming" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Read the full disclaimer" })).toHaveAttribute(
      "href",
      "/legal/disclaimer",
    );
  });

  it("success reads Recording... while in flight, then calls onAttested once and router.refresh once", async () => {
    let release!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => (release = r)));
    const { onAttested } = renderModal();
    checkAndConfirm();

    const busy = await screen.findByRole("button", { name: "Recording..." });
    expect(busy).toBeDisabled();
    expect(onAttested).not.toHaveBeenCalled();

    release(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await waitFor(() => expect(onAttested).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/attestation");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ accepted: true });
  });
});

describe("AccreditedInvestorGate — mapped errors, never raw JSON (UD-06)", () => {
  const RAW = '{"error":"Rate limit exceeded","detail":"internal-marker-7"}';

  it.each([
    [429, "Too many attempts. Try again in a minute."],
    [401, "Your session has ended. Sign in again to continue."],
    [500, "Your confirmation was not recorded. Try again."],
    [400, "Your confirmation was not recorded. Try again."],
  ])("a %i answer renders the mapped copy in role=alert and the modal stays open", async (status, copy) => {
    fetchMock.mockResolvedValue(new Response(RAW, { status }));
    const { onAttested } = renderModal();
    checkAndConfirm();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(copy);
    expect(alert.className).toContain("text-negative");
    expect(document.body.textContent).not.toContain("internal-marker-7");
    expect(document.body.textContent).not.toContain("Rate limit exceeded");
    expect(onAttested).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    // confirm re-enables so the user can retry
    expect(screen.getByRole("button", { name: "Confirm and request intro" })).toBeEnabled();
  });

  it("a thrown fetch renders the network sentence", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    renderModal();
    checkAndConfirm();
    expect(await screen.findByRole("alert")).toHaveTextContent("Network error. Please try again.");
  });

  it("the /discovery page render gets the same mapping, not the raw body", async () => {
    fetchMock.mockResolvedValue(new Response(RAW, { status: 429 }));
    render(<AccreditedInvestorGate />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Continue to discovery" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Try again in a minute.",
    );
    expect(document.body.textContent).not.toContain("Rate limit exceeded");
  });
});

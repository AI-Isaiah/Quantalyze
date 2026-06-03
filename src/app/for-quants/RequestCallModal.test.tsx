import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RequestCallModal } from "./RequestCallModal";

/**
 * G9.B.20 regression — the mailto fallback link must fire the
 * `for_quants_request_call_click` *intent* event with `source: "mailto"`,
 * NOT the `for_quants_lead_submit` *conversion* event. Conflating click →
 * conversion silently inflated CTR before commit b82e78d. Pin both the
 * event name AND the source tag here so a refactor that flips either back
 * fails in unit tests, not only in PostHog dashboards weeks later.
 */

vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: vi.fn(),
}));

import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";

const trackMock = vi.mocked(trackForQuantsEventClient);

beforeEach(() => {
  trackMock.mockClear();
  // Polyfill jsdom's missing HTMLDialogElement methods so <Modal> can
  // showModal()/close() without throwing.
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
    };
  }
});

describe("<RequestCallModal> mailto fallback (G9.B.20)", () => {
  it("fires for_quants_request_call_click with source='mailto', not for_quants_lead_submit", () => {
    render(
      <RequestCallModal
        open={true}
        onClose={() => {}}
        ctaLocation="hero"
      />,
    );

    // Find the mailto link by its visible label
    const mailtoLink = screen.getByText("security@quantalyze.com");
    // The mount-time effect fires `for_quants_request_call_click` once
    // with cta_location only; clear so we observe ONLY the click event.
    trackMock.mockClear();

    fireEvent.click(mailtoLink);

    // Asserts the rename: must NOT use the conversion event name.
    const calledEventNames = trackMock.mock.calls.map((c) => c[0]);
    expect(calledEventNames).not.toContain("for_quants_lead_submit");
    expect(calledEventNames).toContain("for_quants_request_call_click");

    // Asserts the source tag: 'mailto', not 'modal'.
    const clickCall = trackMock.mock.calls.find(
      (c) => c[0] === "for_quants_request_call_click",
    );
    expect(clickCall).toBeDefined();
    expect(clickCall![1]).toMatchObject({ source: "mailto" });
    expect(clickCall![1]).not.toMatchObject({ source: "modal" });
  });

  it("the mailto anchor href targets security@quantalyze.com", () => {
    // Defensive pin so a refactor that swaps the address (and the
    // structured-vs-mailto fallback semantic) surfaces here too.
    render(
      <RequestCallModal
        open={true}
        onClose={() => {}}
        ctaLocation="hero"
      />,
    );
    const mailtoLink = screen.getByText("security@quantalyze.com")
      .closest("a") as HTMLAnchorElement;
    expect(mailtoLink).not.toBeNull();
    expect(mailtoLink.getAttribute("href")).toMatch(
      /^mailto:security@quantalyze\.com/,
    );
  });
});

/**
 * H-0270 honeypot. The modal must render a hidden `website` decoy field
 * AND transmit its value in the POST body so the server-side honeypot
 * check (route.ts) is reachable. Two assertions, two failure modes:
 *  - missing/visible DOM field → bots never get baited;
 *  - field present but not wired into the body → server check is dead.
 * The second test fills the decoy and pins that the typed value reaches
 * the payload (neuter: drop `website` from the fetch body → undefined).
 */
describe("<RequestCallModal> honeypot (H-0270)", () => {
  it("renders a hidden, non-tabbable, aria-hidden honeypot 'website' field", () => {
    render(<RequestCallModal open onClose={() => {}} ctaLocation="hero" />);
    const honeypot = document.getElementById(
      "fq-website",
    ) as HTMLInputElement | null;
    expect(honeypot).not.toBeNull();
    // Removed from the keyboard tab order so humans can't land on it.
    expect(honeypot!.tabIndex).toBe(-1);
    // Password managers must not autofill it.
    expect(honeypot!.getAttribute("autocomplete")).toBe("off");
    // Wrapped in an aria-hidden container so screen readers skip it.
    expect(honeypot!.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("transmits the honeypot value in the POST body so the server can evaluate it", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => ({
        ok: true,
        json: async () => ({ ok: true }),
      }),
    );
    const prevFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      render(<RequestCallModal open onClose={() => {}} ctaLocation="hero" />);
      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: "Jane" },
      });
      fireEvent.change(screen.getByLabelText("Firm"), {
        target: { value: "Acme" },
      });
      fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: "jane@acme.example" },
      });
      const honeypot = document.getElementById("fq-website") as HTMLInputElement;
      fireEvent.change(honeypot, { target: { value: "bot-was-here" } });

      fireEvent.click(screen.getByRole("button", { name: /send request/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(init.body as string);
      // Wiring proof: the decoy's value rides along in the payload.
      expect(body.website).toBe("bot-was-here");
    } finally {
      global.fetch = prevFetch;
    }
  });
});

/**
 * M-0373 — the modal is a non-trivial client state machine (inFlight
 * double-click gate, submitting/submitted/error tri-state, fieldErrors →
 * per-input rendering, success view echoing the email). Pin the four
 * behaviors the audit flagged as untested. The double-click gate is the
 * load-bearing one: a regression there sends the founder duplicate
 * notifications and pollutes the Sprint-1 conversion metric.
 */
describe("<RequestCallModal> submit state machine (M-0373)", () => {
  function fillRequiredFields() {
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Jane" },
    });
    fireEvent.change(screen.getByLabelText("Firm"), {
      target: { value: "Acme" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "jane@acme.example" },
    });
  }

  it("inFlight ref bails the second of two synchronous submits → exactly one POST", async () => {
    // Never-resolving fetch so the first submit stays in flight while the
    // second submit fires before any await resolves.
    const fetchMock = vi.fn(() => new Promise<never>(() => {}));
    const prevFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      render(<RequestCallModal open onClose={() => {}} ctaLocation="hero" />);
      fillRequiredFields();
      // Submit on the FORM, not the button: a button click is also
      // blocked by `disabled={submitting}` once React re-renders, which
      // would mask whether the synchronous `inFlight` ref is doing its
      // job. The form's onSubmit ignores the button's disabled state, so
      // firing it twice isolates the ref gate (set synchronously before
      // the await). Neuter: drop `if (inFlight.current) return` → 2 POSTs.
      const form = screen
        .getByRole("button", { name: /send request/i })
        .closest("form") as HTMLFormElement;
      fireEvent.submit(form);
      fireEvent.submit(form);
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = prevFetch;
    }
  });

  it("renders the success view echoing the submitted email on a 200", async () => {
    const fetchMock = vi.fn(
      async (_i: RequestInfo | URL, _init?: RequestInit) => ({
        ok: true,
        json: async () => ({ ok: true }),
      }),
    );
    const prevFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      render(<RequestCallModal open onClose={() => {}} ctaLocation="hero" />);
      fillRequiredFields();
      fireEvent.click(screen.getByRole("button", { name: /send request/i }));
      expect(await screen.findByText(/Request received/i)).toBeTruthy();
      // The success copy echoes the email back to the user.
      expect(screen.getByText(/jane@acme\.example/)).toBeTruthy();
    } finally {
      global.fetch = prevFetch;
    }
  });

  it("renders an inline field error returned by the API (400 + fieldErrors)", async () => {
    const fetchMock = vi.fn(
      async (_i: RequestInfo | URL, _init?: RequestInit) => ({
        ok: false,
        json: async () => ({
          error: "Invalid submission",
          fieldErrors: { name: ["Name looks too short"] },
        }),
      }),
    );
    const prevFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      render(<RequestCallModal open onClose={() => {}} ctaLocation="hero" />);
      fillRequiredFields();
      fireEvent.click(screen.getByRole("button", { name: /send request/i }));
      // firstFieldError("name") → the first message, rendered under Name.
      expect(await screen.findByText("Name looks too short")).toBeTruthy();
    } finally {
      global.fetch = prevFetch;
    }
  });

  it("renders the error message when the fetch rejects (network path)", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    const prevFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      render(<RequestCallModal open onClose={() => {}} ctaLocation="hero" />);
      fillRequiredFields();
      fireEvent.click(screen.getByRole("button", { name: /send request/i }));
      // The catch arm surfaces err.message via the role="alert" paragraph.
      expect(await screen.findByText(/network down/i)).toBeTruthy();
    } finally {
      global.fetch = prevFetch;
    }
  });
});

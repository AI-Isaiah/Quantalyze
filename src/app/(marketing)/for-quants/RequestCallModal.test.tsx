import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RequestCallModal } from "./RequestCallModal";

/**
 * Phase 164.6.6.3.5 DOMAINONE plan 04 (D-01, UI-SPEC "Error rendering rule"):
 * the modal maps every outcome by STATUS, shows success only on `stored`, and
 * names no email address (its `Prefer email?` line is gone, with the
 * `source: "mailto"` click event only that link fired).
 *
 * G9.B.20 still holds in spirit: `for_quants_lead_submit` is the CONVERSION
 * event, reserved for a path that wrote a row.
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

describe("<RequestCallModal> names no email address (D-01)", () => {
  it("renders no mailto anchor and no text matching @quantalyze", () => {
    const { container } = render(
      <RequestCallModal open onClose={() => {}} ctaLocation="hero" />,
    );
    const anchors = Array.from(document.querySelectorAll("a"));
    expect(
      anchors.filter((a) => (a.getAttribute("href") ?? "").startsWith("mailto:")),
    ).toHaveLength(0);
    expect(document.body.textContent ?? "").not.toMatch(/@quantalyze/i);
    expect(screen.queryByText(/Prefer email/i)).toBeNull();
    expect(container).toBeTruthy();
  });

  it("fires only the mount-time click intent event, never one tagged source='mailto'", () => {
    render(<RequestCallModal open onClose={() => {}} ctaLocation="hero" />);
    const clicks = trackMock.mock.calls.filter(
      (c) => c[0] === "for_quants_request_call_click",
    );
    expect(clicks).toHaveLength(1);
    expect(clicks[0][1]).toMatchObject({ cta_location: "hero" });
    expect(clicks[0][1]).not.toMatchObject({ source: "mailto" });
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
        status: 200,
        json: async () => ({ ok: true, status: "stored" }),
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
        status: 200,
        json: async () => ({ ok: true, status: "stored" }),
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
        status: 400,
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

  it("a thrown fetch renders the fixed network string, never the TypeError text", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch (browser text)");
    });
    const prevFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      render(<RequestCallModal open onClose={() => {}} ctaLocation="hero" />);
      fillRequiredFields();
      fireEvent.click(screen.getByRole("button", { name: /send request/i }));
      expect(await screen.findByRole("alert")).toHaveProperty(
        "textContent",
        NETWORK,
      );
      expect(document.body.textContent).not.toMatch(/Failed to fetch/);
    } finally {
      global.fetch = prevFetch;
    }
  });
});

/**
 * UI-SPEC "Error rendering rule" (RequestCallForm column) and "Rendered-key
 * rule". The form-level string is chosen by HTTP status from the contract and
 * never from the server's `error` text. Every case also pins that the entries
 * the visitor typed are still in the inputs.
 */
const UNREADABLE =
  "Our server could not read this request. Reload the page and send it again; if it is refused again, shorten the notes. What you typed is still here until you reload, so copy the notes first.";
const RATE_LIMITED =
  "Too many requests from this connection. Try again in a few minutes; what you typed is still here.";
const SERVER =
  "Your request was not sent. Try again in a minute; what you typed is still here.";
const UNAVAILABLE =
  "Requests are unavailable right now. Try again in a few minutes; what you typed is still here.";
const NETWORK =
  "We could not reach the server. Check your connection and send again; what you typed is still here.";

describe("<RequestCallModal> status-mapped outcomes (UI-SPEC Error rendering rule)", () => {
  function fill() {
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane" } });
    fireEvent.change(screen.getByLabelText("Firm"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "jane@acme.example" },
    });
  }

  /** Render, fill, submit against a canned response; returns once the POST resolved. */
  async function submitWith(response: {
    ok: boolean;
    status: number;
    body: unknown;
    /** A body that is not JSON at all. */
    notJson?: boolean;
  }) {
    const fetchMock = vi.fn(async () => ({
      ok: response.ok,
      status: response.status,
      json: async () => {
        if (response.notJson) throw new SyntaxError("Unexpected token <");
        return response.body;
      },
    }));
    const prevFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      render(<RequestCallModal open onClose={() => {}} ctaLocation="hero" />);
      fill();
      fireEvent.click(screen.getByRole("button", { name: /send request/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    } finally {
      global.fetch = prevFetch;
    }
  }

  function entriesKept() {
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Jane");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "jane@acme.example",
    );
  }

  it("200 stored: the success view renders and the conversion event fires", async () => {
    await submitWith({ ok: true, status: 200, body: { ok: true, status: "stored" } });
    expect(await screen.findByText("Request received")).toBeTruthy();
    expect(trackMock.mock.calls.map((c) => c[0])).toContain("for_quants_lead_submit");
  });

  it("200 duplicate: the duplicate heading and body render, no success claim, no conversion event", async () => {
    await submitWith({ ok: true, status: 200, body: { ok: true, status: "duplicate" } });
    expect(await screen.findByText("Request already received")).toBeTruthy();
    expect(
      screen.getByText(
        "We already have a call request from jane@acme.example today. The founder will reach out within 24 hours.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Request received")).toBeNull();
    // `for_quants_lead_submit` is reserved for a path that wrote a row (G9.B.20).
    expect(trackMock.mock.calls.map((c) => c[0])).not.toContain(
      "for_quants_lead_submit",
    );
  });

  it("200 with a bare { ok: true }: the server string, no success view (a route regression cannot fake success)", async () => {
    await submitWith({ ok: true, status: 200, body: { ok: true } });
    expect((await screen.findByRole("alert")).textContent).toBe(SERVER);
    expect(screen.queryByText("Request received")).toBeNull();
    expect(screen.queryByText("Request already received")).toBeNull();
    entriesKept();
  });

  it("200 whose body is not JSON: the server string", async () => {
    await submitWith({ ok: true, status: 200, body: null, notJson: true });
    expect((await screen.findByRole("alert")).textContent).toBe(SERVER);
  });

  it("400 with a rendered fieldErrors key: the field note only, no form-level alert", async () => {
    await submitWith({
      ok: false,
      status: 400,
      body: { error: "Invalid submission", fieldErrors: { name: ["Enter your name."] } },
    });
    expect(await screen.findByText("Enter your name.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    entriesKept();
  });

  it("400 with only an unrendered wizard_context key: the unreadable string", async () => {
    await submitWith({
      ok: false,
      status: 400,
      body: {
        error: "Invalid submission",
        fieldErrors: {
          "wizard_context.wizard_session_id": ["wizard_session_id is required when step is set"],
        },
      },
    });
    expect((await screen.findByRole("alert")).textContent).toBe(UNREADABLE);
    // The raw Zod message is a developer sentence; it is never printed.
    expect(document.body.textContent).not.toMatch(/wizard_session_id/);
    entriesKept();
  });

  it("400 mixing a rendered and an unrendered key: the field note shows and the alert stays suppressed", async () => {
    await submitWith({
      ok: false,
      status: 400,
      body: {
        error: "Invalid submission",
        fieldErrors: { email: ["Enter a valid email"], website: ["bad"] },
      },
    });
    expect(await screen.findByText("Enter a valid email")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("400 without fieldErrors (Invalid JSON body): the unreadable string, not the server's error text", async () => {
    await submitWith({ ok: false, status: 400, body: { error: "Invalid JSON body" } });
    expect((await screen.findByRole("alert")).textContent).toBe(UNREADABLE);
    expect(document.body.textContent).not.toMatch(/Invalid JSON body/);
    entriesKept();
  });

  it("413: the unreadable string", async () => {
    await submitWith({ ok: false, status: 413, body: { error: "Request body is too large." } });
    expect((await screen.findByRole("alert")).textContent).toBe(UNREADABLE);
  });

  it("429: the rate-limit string", async () => {
    await submitWith({ ok: false, status: 429, body: { error: "Too many requests. Try again in a few minutes." } });
    expect((await screen.findByRole("alert")).textContent).toBe(RATE_LIMITED);
    entriesKept();
  });

  it("503: the unavailable string", async () => {
    await submitWith({ ok: false, status: 503, body: { error: "Service unavailable. Try again in a few minutes." } });
    expect((await screen.findByRole("alert")).textContent).toBe(UNAVAILABLE);
  });

  it("500 and any other non-2xx: the server string, never the server's error text", async () => {
    await submitWith({ ok: false, status: 500, body: { error: "Something went wrong. Try again in a minute." } });
    expect((await screen.findByRole("alert")).textContent).toBe(SERVER);
    expect(document.body.textContent).not.toMatch(/Something went wrong/);
    entriesKept();
  });

  it("the button is re-enabled after an error so the visitor can resend", async () => {
    await submitWith({ ok: false, status: 500, body: {} });
    await screen.findByRole("alert");
    expect(
      (screen.getByRole("button", { name: /send request/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});

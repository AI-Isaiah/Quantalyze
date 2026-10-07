/**
 * Phase 164.6.6.3.5 DOMAINONE plan 05 — ContactForm.
 *
 * The contract each case guards (164.6.6.3.5-UI-SPEC.md, S1 + "Success means
 * stored"):
 *   - the fields, their order and their labels are the spec's, and the
 *     Reference value is an identifier, so it is drawn in Geist Mono;
 *   - one click is one POST, carrying `source: "contact_form"` and the honeypot;
 *   - `Message received` appears ONLY when the route says `status: "stored"`.
 *     A bare 2xx must never read as a stored message, or a route regression
 *     would tell a security reporter their report arrived when it did not.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContactForm } from "./ContactForm";

const ERROR_SERVER =
  "Your message was not sent. Try again in a minute; what you typed is still here.";

type FetchResult = { ok: boolean; status: number; json: () => Promise<unknown> };

function mockFetch(result: FetchResult) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => result,
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function fill() {
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Jane Doe" },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "jane@acme.example" },
  });
  fireEvent.change(screen.getByLabelText("Firm (optional)"), {
    target: { value: "Acme" },
  });
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Please check my key." },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("<ContactForm> fields", () => {
  it("renders the spec's controls in order with the spec's labels", () => {
    render(<ContactForm initialTopic="general" initialReference="" />);
    const labels = [
      "Topic",
      "Name",
      "Email",
      "Firm (optional)",
      "Reference (optional)",
      "Message",
    ];
    const controls = labels.map((l) => screen.getByLabelText(l));
    for (let i = 1; i < controls.length; i += 1) {
      // DOM order is tab order (UI-SPEC S1): each control follows the last.
      expect(
        controls[i - 1].compareDocumentPosition(controls[i]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(
      screen.getByRole("button", { name: "Send message" }),
    ).toBeInTheDocument();
  });

  it("offers the four topics in the spec's order and preselects the initial one", () => {
    render(<ContactForm initialTopic="security" initialReference="" />);
    const select = screen.getByLabelText("Topic") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "General question",
      "Account or strategy support",
      "Security report",
      "Privacy or data request",
    ]);
    expect(select.value).toBe("security");
  });

  it("draws the Reference in Geist Mono, prefilled, editable, capped at 200, with its hint", () => {
    render(
      <ContactForm
        initialTopic="support"
        initialReference="cid-0123456789 draft 9a2e9a2e9a2e"
      />,
    );
    const reference = screen.getByLabelText(
      "Reference (optional)",
    ) as HTMLInputElement;
    expect(reference.value).toBe("cid-0123456789 draft 9a2e9a2e9a2e");
    expect(reference.className).toContain("font-metric");
    expect(reference.maxLength).toBe(200);
    expect(reference).toHaveAccessibleDescription(
      "The correlation id or draft ID from an error message. It is filled in when you arrive from one.",
    );
    // Paste path (D-02): a visitor whose prefill was dropped can type or paste.
    fireEvent.change(reference, { target: { value: "pasted-id-123456" } });
    expect(reference.value).toBe("pasted-id-123456");
  });

  it("caps Message at 2000 and does not steal focus on mount", () => {
    render(<ContactForm initialTopic="general" initialReference="" />);
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).maxLength).toBe(
      2000,
    );
    expect(document.body).toHaveFocus();
  });

  it("keeps the honeypot off-screen, aria-hidden and out of the tab order", () => {
    render(<ContactForm initialTopic="general" initialReference="" />);
    const honeypot = document.getElementById(
      "contact-website",
    ) as HTMLInputElement | null;
    expect(honeypot).not.toBeNull();
    expect(honeypot!.tabIndex).toBe(-1);
    expect(honeypot!.getAttribute("autocomplete")).toBe("off");
    expect(honeypot!.closest("[aria-hidden='true']")).not.toBeNull();
  });
});

describe("<ContactForm> submit (tracer)", () => {
  it("POSTs once with the contact_form payload and shows Message received only on stored", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, status: "stored" }),
    });
    render(
      <ContactForm initialTopic="security" initialReference="cid-0123456789" />,
    );
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(
      await screen.findByRole("heading", { name: "Message received" }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/for-quants-lead");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      source: "contact_form",
      topic: "security",
      name: "Jane Doe",
      email: "jane@acme.example",
      firm: "Acme",
      reference: "cid-0123456789",
      message: "Please check my key.",
      website: "",
    });
    expect(
      screen.getByText("We reply to jane@acme.example within one business day."),
    ).toBeInTheDocument();
    const echo = screen.getByText("cid-0123456789");
    expect(echo.className).toContain("font-metric");
    expect(screen.getByText(/^Reference:/)).toBeInTheDocument();
  });

  it("treats a bare 2xx as not sent: shows the server error and keeps every entry", async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    render(<ContactForm initialTopic="general" initialReference="" />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ERROR_SERVER);
    expect(
      screen.queryByRole("heading", { name: "Message received" }),
    ).not.toBeInTheDocument();
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(
      "Please check my key.",
    );
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
  });

  it("treats a duplicate answer as not sent: a contact message is never deduplicated", async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, status: "duplicate" }),
    });
    render(<ContactForm initialTopic="general" initialReference="" />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(ERROR_SERVER),
    );
    expect(
      screen.queryByRole("heading", { name: "Message received" }),
    ).not.toBeInTheDocument();
  });
});

/**
 * Task 2 — every outcome the UI-SPEC States table lists. The form-level string
 * is picked by STATUS and never read off the server's `error` text or an
 * `Error.message`, so a developer sentence ("Invalid JSON body") or a browser's
 * "Failed to fetch" can never reach the visitor.
 */
const ERROR_UNREADABLE =
  "Our server could not read this submission. Reload the page and send it again; if it is refused again, shorten the message. What you typed is still here until you reload, so copy the message first.";
const ERROR_RATE_LIMITED =
  "Too many messages from this connection. Try again in a few minutes; what you typed is still here.";
const ERROR_UNAVAILABLE =
  "The contact form is unavailable right now. Try again in a few minutes; what you typed is still here.";
const ERROR_NETWORK =
  "We could not reach the server. Check your connection and send again; what you typed is still here.";

async function submitWith(result: FetchResult) {
  const fetchMock = mockFetch(result);
  render(<ContactForm initialTopic="support" initialReference="cid-0123456789" />);
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  return fetchMock;
}

function failure(status: number, body: unknown): FetchResult {
  return { ok: false, status, json: async () => body };
}

describe("<ContactForm> status-mapped errors", () => {
  it.each([
    [429, ERROR_RATE_LIMITED],
    [500, ERROR_SERVER],
    [503, ERROR_UNAVAILABLE],
    [413, ERROR_UNREADABLE],
  ])("%i shows the spec's string, keeps every entry and re-enables the button", async (status, copy) => {
    await submitWith(
      failure(status, { error: "raw server text must never render" }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(copy);
    expect(alert.textContent).not.toContain("raw server text");
    expect(alert.className).toContain("text-caption");
    expect(alert.className).toContain("text-negative");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Jane Doe");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "jane@acme.example",
    );
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(
      "Please check my key.",
    );
    expect(
      (screen.getByLabelText("Reference (optional)") as HTMLInputElement).value,
    ).toBe("cid-0123456789");
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
  });

  it("a thrown fetch shows the fixed network string, never the thrown text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    render(<ContactForm initialTopic="general" initialReference="" />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(ERROR_NETWORK);
    expect(alert.textContent).not.toContain("Failed to fetch");
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
  });

  it("puts the form-level alert directly above the button row", async () => {
    await submitWith(failure(500, {}));
    const alert = await screen.findByRole("alert");
    const button = screen.getByRole("button", { name: "Send message" });
    expect(alert.nextElementSibling).toBe(button.parentElement);
  });
});

describe("<ContactForm> 400 field errors", () => {
  it("renders the first issue under Message with border-negative and NO form-level alert", async () => {
    await submitWith(
      failure(400, {
        error: "Invalid submission",
        fieldErrors: { message: ["Message is too long", "second issue"] },
      }),
    );
    const note = await screen.findByText("Message is too long");
    expect(note.className).toContain("text-caption");
    expect(note.className).toContain("text-negative");
    expect(screen.queryByText("second issue")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Message").className).toContain("border-negative");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(
      "Please check my key.",
    );
  });

  it("renders email and reference notes through Field and wires them to the control", async () => {
    await submitWith(
      failure(400, {
        fieldErrors: {
          email: ["Enter a valid email address"],
          reference: ["Reference is too long"],
        },
      }),
    );
    await screen.findByText("Enter a valid email address");
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
      /Enter a valid email address/,
    );
    expect(screen.getByLabelText("Email").className).toContain("border-negative");
    expect(screen.getByLabelText("Reference (optional)").className).toContain(
      "border-negative",
    );
    expect(screen.getByText("Reference is too long")).toBeInTheDocument();
  });

  it.each([
    ["only topic", { fieldErrors: { topic: ["Choose a topic."] } }],
    ["only _form", { fieldErrors: { _form: ["x"] } }],
    ["only website", { fieldErrors: { website: ["x"] } }],
    ["no fieldErrors", { error: "Invalid JSON body" }],
    ["empty fieldErrors", { fieldErrors: {} }],
  ])("a 400 with %s falls to Error - unreadable (nothing is left blank)", async (_label, body) => {
    await submitWith(failure(400, body));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(ERROR_UNREADABLE);
    expect(alert.textContent).not.toContain("Invalid JSON body");
    expect(alert.textContent).not.toContain("Choose a topic.");
  });

  it("a 400 mixing a rendered and an unrendered key shows the field note and no alert", async () => {
    await submitWith(
      failure(400, {
        fieldErrors: { name: ["Name is too long"], website: ["x"] },
      }),
    );
    await screen.findByText("Name is too long");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears the previous errors on the next submit", async () => {
    mockFetch(failure(500, {}));
    render(<ContactForm initialTopic="general" initialReference="" />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByRole("alert");
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, status: "stored" }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByRole("heading", { name: "Message received" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("<ContactForm> in flight", () => {
  it("shows Sending... disabled and sends one POST for two rapid clicks", async () => {
    const fetchMock = vi.fn(() => new Promise<never>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    render(<ContactForm initialTopic="general" initialReference="" />);
    fill();
    const form = screen.getByRole("button", { name: "Send message" }).closest("form")!;
    // Two submits inside one render tick: only the synchronous ref gate stops the second.
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const button = await screen.findByRole("button", { name: "Sending..." });
    expect(button).toBeDisabled();
  });
});

describe("<ContactForm> success view", () => {
  async function sent() {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, status: "stored" }),
    });
    render(<ContactForm initialTopic="privacy" initialReference="" />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    return screen.findByRole("heading", { name: "Message received" });
  }

  it("is a role=status region whose heading takes focus, with no reference line when none was given", async () => {
    const heading = await sent();
    expect(heading.closest("[role='status']")).not.toBeNull();
    expect(heading).toHaveFocus();
    expect(heading.tagName).toBe("H2");
    expect(screen.queryByText(/^Reference:/)).not.toBeInTheDocument();
  });

  it("Send another message restores an empty form with the same Topic, and a second send shows Message received again", async () => {
    await sent();
    fireEvent.click(screen.getByRole("button", { name: "Send another message" }));
    expect((screen.getByLabelText("Topic") as HTMLSelectElement).value).toBe("privacy");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("");
    const second = mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, status: "stored" }),
    });
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(
      await screen.findByRole("heading", { name: "Message received" }),
    ).toBeInTheDocument();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

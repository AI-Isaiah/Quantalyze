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
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

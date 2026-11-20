import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * AccountEmailSection (Phase 219, D-01..D-05, GD-01, GD-04, GD-05a): the Account
 * tab's sign-in email, and the change flow through POST /api/account/email,
 * which checks the current password and then asks Supabase Auth to mail the
 * confirmation link. There is deliberately NO mock of @/lib/supabase/client
 * here: the component no longer depends on the browser Supabase client (T6).
 * Every address here is @quantalyze.test / @example.test (public repo).
 */

const { refreshMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { AccountEmailSection } from "./AccountEmailSection";

const HELPER =
  "This is the email you use to sign in. Changing it takes effect after you confirm by email.";
const GENERIC_FALLBACK = "Could not send the confirmation link. Please try again.";
const WRONG_PASSWORD = "That password is not right. Nothing was sent.";
const SET_PASSWORD_FIRST =
  "This account has no password yet. Set a password first, then change your email.";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  refreshMock.mockReset();
  // stubGlobal, not `globalThis.fetch = ...`: only a stub is undone below.
  vi.stubGlobal("fetch", fetchMock as unknown as typeof globalThis.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function openForm() {
  fireEvent.click(screen.getByRole("button", { name: "Change email" }));
  return screen.getByLabelText("New email") as HTMLInputElement;
}

function passwordField() {
  return screen.getByLabelText("Current password") as HTMLInputElement;
}

function submitWith(value: string, password = "pw-1") {
  const input = openForm();
  fireEvent.change(input, { target: { value } });
  fireEvent.change(passwordField(), { target: { value: password } });
  fireEvent.click(
    screen.getByRole("button", { name: "Send confirmation link" }),
  );
  return input;
}

describe("AccountEmailSection: identity and the request (tracer)", () => {
  it("shows the server-read email, the heading and the helper line", () => {
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    expect(screen.getByTestId("account-email")).toHaveTextContent(
      "owner@quantalyze.test",
    );
    expect(
      screen.getByRole("heading", { name: "Sign-in email" }),
    ).toBeInTheDocument();
    expect(screen.getByText(HELPER)).toBeInTheDocument();
  });

  // T1
  it("T1: the form has a Current password field (password, current-password) and POSTs { email, password } to the route", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, pending_email: null }));
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    openForm();
    const pw = passwordField();
    expect(pw.type).toBe("password");
    expect(pw.getAttribute("autocomplete")).toBe("current-password");
    expect(pw.getAttribute("name")).toBe("current_password");
    expect(pw.required).toBe(true);

    fireEvent.change(screen.getByLabelText("New email"), {
      target: { value: "new@quantalyze.test " },
    });
    fireEvent.change(pw, { target: { value: "pw-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Send confirmation link" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/account/email");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    // Address trimmed, password verbatim.
    expect(JSON.parse(init.body as string)).toEqual({
      email: "new@quantalyze.test",
      password: "pw-1",
    });
  });

  // T2
  it("T2: a 200 with pending_email shows the pending panel naming it, closes the form and refreshes once", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, pending_email: "new@quantalyze.test" }),
    );
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    submitWith("new@quantalyze.test");

    const panel = await screen.findByRole("status");
    expect(panel).toHaveTextContent("new@quantalyze.test");
    expect(screen.queryByLabelText("New email")).toBeNull();
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  // T3 (T-219-29, T-219-31)
  it("T3: a wrong password shows the server text in role=alert, keeps the address, empties and focuses the password field, shows no pending panel", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: "wrong_password", error: WRONG_PASSWORD }, 400),
    );
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    const input = submitWith("new@quantalyze.test", "not-the-password");

    expect(await screen.findByRole("alert")).toHaveTextContent(WRONG_PASSWORD);
    expect(input.value).toBe("new@quantalyze.test");
    expect(passwordField().value).toBe("");
    // The focus move is a passive effect that runs after the response lands,
    // so it can trail the alert by a tick on a loaded runner (CI shard 2 saw
    // the previous field still focused). Wait for it; it must still arrive.
    await waitFor(() => expect(document.activeElement).toBe(passwordField()));
    expect(screen.queryByRole("status")).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // T4 (GD-05a)
  it("T4: a password-less account sees the set-a-password message and a /reset-password link, never the wrong-password text", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: "password_not_set", error: SET_PASSWORD_FIRST }, 409),
    );
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    submitWith("new@quantalyze.test");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(SET_PASSWORD_FIRST);
    const link = screen.getByRole("link", { name: "Set a password" });
    expect(link.getAttribute("href")).toBe("/reset-password");
    expect(alert.contains(link)).toBe(true);
    expect(screen.queryByText(WRONG_PASSWORD)).toBeNull();
    expect(passwordField().value).toBe("");
    expect(screen.queryByRole("status")).toBeNull();
  });

  // T5
  it("T5: the same address (after trim and lower-case) is refused with NO network call", () => {
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    submitWith("OWNER@quantalyze.test ");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "That is already your sign-in email.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // T6: this file has no mock of @/lib/supabase/client, so if the component
  // still imported the browser client the first render would reach the real one.
  it("T6: rendering and submitting succeeds with no Supabase browser client mocked", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, pending_email: "new@quantalyze.test" }),
    );
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    submitWith("new@quantalyze.test");

    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("AccountEmailSection: the rest of the wire contract", () => {
  it("a 429 shows the too-many-attempts line", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, 429));
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    submitWith("new@quantalyze.test");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Wait a minute and try again.",
    );
    expect(passwordField().value).toBe("");
  });

  it.each([
    ["verify_unavailable", 502, "Could not check your password. Please try again."],
    ["update_failed", 400, "Email address is invalid"],
    ["same_address", 400, "That is already your sign-in email."],
  ])("a %s answer shows the server text as-is", async (code, status, text) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code, error: text }, status));
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    const input = submitWith("new@quantalyze.test");

    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(input.value).toBe("new@quantalyze.test");
    expect(passwordField().value).toBe("");
  });

  // SFH-M4: the wrapper's own answers without a `code` name what happened
  // instead of inviting a retry that cannot succeed.
  it.each([
    ["a 401", () => jsonResponse({ error: "Unauthorized" }, 401), "Your session expired. Sign in again."],
    ["a 503", () => jsonResponse({ error: "down" }, 503), "Email change is unavailable right now. Please try again later."],
  ])("%s gets its own line, not the generic fallback", async (_name, make, text) => {
    fetchMock.mockResolvedValueOnce(make());
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    submitWith("new@quantalyze.test");

    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(passwordField().value).toBe("");
  });

  it.each([
    ["a 429", 429, "For security purposes, you can only request this after 47 seconds."],
    ["a 502", 502, "Auth is down"],
  ])("%s carrying update_failed shows Auth's message as-is", async (_name, status, text) => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: "update_failed", error: text }, status),
    );
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    submitWith("new@quantalyze.test");

    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });

  it.each([
    ["a 403", () => jsonResponse({ error: "Forbidden" }, 403)],
    ["a 400 without a code", () => jsonResponse({ issues: [] }, 400)],
    ["a non-JSON body", () => new Response("<html>oops</html>", { status: 500 })],
  ])("%s falls to the app-written fallback line", async (_name, make) => {
    fetchMock.mockResolvedValueOnce(make());
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    submitWith("new@quantalyze.test");

    expect(await screen.findByRole("alert")).toHaveTextContent(GENERIC_FALLBACK);
    expect(passwordField().value).toBe("");
  });
});

// GD-04: `?email_change=confirmed` is attacker-settable, so the done note is
// only ever a statement about what Auth reports: no pending address shown, and
// the address named is the server-read one (T-219-30).
describe("AccountEmailSection: the confirmed note (GD-04)", () => {
  const CONFIRMED = "Your sign-in email is now new@quantalyze.test.";

  // T9
  it("T9: the marker with nothing pending shows the done note naming the server-read email", () => {
    render(
      <AccountEmailSection
        email="new@quantalyze.test"
        pendingEmail={null}
        emailChangeConfirmed
      />,
    );

    const note = screen.getByTestId("account-email-confirmed");
    expect(note.textContent).toBe(CONFIRMED);
    expect(note.getAttribute("role")).toBe("status");
  });

  // T10: the marker alone never asserts success.
  it("T10: the marker with a pending address shows the pending panel and NOT the done note", () => {
    render(
      <AccountEmailSection
        email="old@quantalyze.test"
        pendingEmail="new@quantalyze.test"
        emailChangeConfirmed
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("new@quantalyze.test");
    expect(screen.queryByTestId("account-email-confirmed")).toBeNull();
    expect(document.body.textContent).not.toContain("Your sign-in email is now");
  });

  // T11
  it("T11: a stale marker is overtaken by a successful resubmit, which names the new pending address", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, pending_email: "other@quantalyze.test" }),
    );
    render(
      <AccountEmailSection
        email="new@quantalyze.test"
        pendingEmail={null}
        emailChangeConfirmed
      />,
    );
    expect(screen.getByTestId("account-email-confirmed")).toBeInTheDocument();

    submitWith("other@quantalyze.test");

    const panel = await screen.findByRole("status");
    expect(panel).toHaveTextContent("other@quantalyze.test");
    expect(screen.queryByTestId("account-email-confirmed")).toBeNull();
  });

  // T12
  it("T12: without the marker there is no done note", () => {
    render(
      <AccountEmailSection email="new@quantalyze.test" pendingEmail={null} />,
    );

    expect(screen.queryByTestId("account-email-confirmed")).toBeNull();
  });

  it("the done note is hidden while the change form is open", () => {
    render(
      <AccountEmailSection
        email="new@quantalyze.test"
        pendingEmail={null}
        emailChangeConfirmed
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Change email" }));

    expect(screen.queryByTestId("account-email-confirmed")).toBeNull();
  });

  it("with no current email the done note is not rendered", () => {
    render(
      <AccountEmailSection email={null} pendingEmail={null} emailChangeConfirmed />,
    );

    expect(screen.queryByTestId("account-email-confirmed")).toBeNull();
  });
});

describe("AccountEmailSection: states (UI-SPEC)", () => {
  it("empty: a null email reads the no-email line, keeps Change email, and trims the pending copy", () => {
    const { rerender } = render(<AccountEmailSection email={null} pendingEmail={null} />);

    expect(screen.getByTestId("account-email")).toHaveTextContent(
      "No sign-in email is set.",
    );
    expect(screen.getByRole("button", { name: "Change email" })).toBeInTheDocument();

    rerender(<AccountEmailSection email={null} pendingEmail="next@quantalyze.test" />);
    expect(screen.getByRole("status").textContent).toBe(
      "We sent a confirmation link to next@quantalyze.test.",
    );
  });

  // T7 (GD-01): one link to open, so the old third sentence is gone.
  it("T7: the pending panel is the single-link sentence and never asks to confirm at the current address", () => {
    render(
      <AccountEmailSection
        email="old@quantalyze.test"
        pendingEmail="new@quantalyze.test"
      />,
    );

    expect(screen.getByRole("status").textContent).toBe(
      "We sent a confirmation link to new@quantalyze.test. You still sign in with old@quantalyze.test until you open it.",
    );
    expect(document.body.textContent).not.toContain("confirm that one too");
  });

  // T8
  it("T8: with no current email the pending panel is the one address sentence only", () => {
    render(<AccountEmailSection email={null} pendingEmail="new@quantalyze.test" />);

    expect(screen.getByRole("status").textContent).toBe(
      "We sent a confirmation link to new@quantalyze.test.",
    );
  });

  it("MD-01: firstLinkAccepted adds the neutral note OUTSIDE the live region and leaves the pending copy untouched", () => {
    render(
      <AccountEmailSection
        email="owner@quantalyze.test"
        pendingEmail="next@quantalyze.test"
        firstLinkAccepted
      />,
    );

    const note = screen.getByTestId("account-email-first-link");
    expect(note.textContent).toBe(
      "Your confirmation was accepted. To finish the change, confirm the link sent to your other address.",
    );
    expect(screen.getByRole("status").contains(note)).toBe(false);
    expect(screen.getByRole("status").textContent).toContain(
      "We sent a confirmation link to next@quantalyze.test.",
    );
  });

  it("MD-01: the note shows only while a change is pending", () => {
    render(
      <AccountEmailSection
        email="next@quantalyze.test"
        pendingEmail={null}
        firstLinkAccepted
      />,
    );

    expect(screen.queryByTestId("account-email-first-link")).toBeNull();
  });

  it("error: shows the server's message as-is, keeps the typed value and the form open", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: "update_failed", error: "Email address is invalid" }, 400),
    );
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    const input = submitWith("bad@quantalyze.test");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Email address is invalid",
    );
    expect(input.value).toBe("bad@quantalyze.test");
    expect(screen.getByRole("button", { name: "Send confirmation link" })).toBeEnabled();
    expect(screen.queryByRole("status")).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("error: an empty or whitespace message falls back to the app-written line", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: "update_failed", error: "   " }, 400),
    );
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    submitWith("next@quantalyze.test");

    expect(await screen.findByRole("alert")).toHaveTextContent(GENERIC_FALLBACK);
  });

  it("error: a thrown fetch shows the network line, keeps the form open and empties the password", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    const input = submitWith("next@quantalyze.test");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Network error. Please try again.",
    );
    expect(input.value).toBe("next@quantalyze.test");
    expect(passwordField().value).toBe("");
  });

  it("loading: while the request is in flight the button reads Sending link... and every control is disabled", async () => {
    let resolveCall!: (v: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveCall = resolve;
      }),
    );
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    const input = submitWith("next@quantalyze.test");

    const busy = await screen.findByRole("button", { name: "Sending link..." });
    expect(busy).toBeDisabled();
    expect(input).toBeDisabled();
    expect(passwordField()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep current email" })).toBeDisabled();

    resolveCall(jsonResponse({ ok: true, pending_email: "next@quantalyze.test" }));
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });

  // SF-01: Auth reports whether anything awaits confirmation. With autoconfirm
  // it applies the change at once and the route answers pending_email null, so
  // no "link sent" panel may appear; the refresh brings the new email.
  it("SF-01: a 200 with pending_email null shows no sent panel and still refreshes", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, pending_email: null }));
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    submitWith("new@quantalyze.test");

    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Change email" })).toBeInTheDocument();
  });

  it("SF-01: a refreshed prop with no pending change clears the local sent panel", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, pending_email: "new@quantalyze.test" }),
    );
    const { rerender } = render(
      <AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />,
    );

    submitWith("new@quantalyze.test");
    expect(await screen.findByRole("status")).toHaveTextContent("new@quantalyze.test");

    // Server truth after the refresh: the change is applied, nothing is pending.
    rerender(<AccountEmailSection email="new@quantalyze.test" pendingEmail={null} />);

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByTestId("account-email")).toHaveTextContent("new@quantalyze.test");
    expect(screen.getByRole("button", { name: "Change email" })).toBeInTheDocument();
  });

  it("partial: pendingEmail on first render shows the panel with no click, hides Change email, and keeps Use a different email outside the live region", () => {
    render(
      <AccountEmailSection
        email="owner@quantalyze.test"
        pendingEmail="next@quantalyze.test"
      />,
    );

    const panel = screen.getByRole("status");
    expect(panel).toHaveTextContent("next@quantalyze.test");
    expect(screen.queryByRole("button", { name: "Change email" })).toBeNull();
    const reopen = screen.getByRole("button", { name: "Use a different email" });
    expect(panel.contains(reopen)).toBe(false);
  });

  it("focus: Use a different email focuses the input, and Keep current email returns to the pending panel and focuses Use a different email", () => {
    render(
      <AccountEmailSection
        email="owner@quantalyze.test"
        pendingEmail="next@quantalyze.test"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(document.activeElement).toBe(screen.getByLabelText("New email"));

    fireEvent.click(screen.getByRole("button", { name: "Keep current email" }));
    // Closing never clears the pending address.
    expect(screen.getByRole("status")).toHaveTextContent("next@quantalyze.test");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Use a different email" }),
    );
  });

  it("focus: Keep current email from a form opened via Change email closes it and refocuses Change email", () => {
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Change email" }));
    expect(document.activeElement).toBe(screen.getByLabelText("New email"));
    fireEvent.click(screen.getByRole("button", { name: "Keep current email" }));

    expect(screen.queryByLabelText("New email")).toBeNull();
    expect(screen.getByTestId("account-email")).toHaveTextContent(
      "owner@quantalyze.test",
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Change email" }),
    );
  });

  it("reopening the form clears a previous error", () => {
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    submitWith("owner@quantalyze.test");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep current email" }));
    fireEvent.click(screen.getByRole("button", { name: "Change email" }));

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("long-text: the value line and the pending addresses carry break-all", () => {
    const long = `${"a".repeat(64)}@${"b".repeat(180)}.quantalyze.test`;
    render(<AccountEmailSection email={long} pendingEmail={long} />);

    expect(screen.getByTestId("account-email").className).toContain("break-all");
    const spans = screen.getByRole("status").querySelectorAll("span");
    expect(spans.length).toBeGreaterThan(0);
    spans.forEach((s) => expect(s.className).toContain("break-all"));
  });
});

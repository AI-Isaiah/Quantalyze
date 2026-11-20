import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * AccountEmailSection (Phase 219, D-01..D-05): the Account tab's sign-in
 * email, and the change flow through Supabase Auth's own confirm-by-email.
 * Every address here is @quantalyze.test / @example.test (public repo).
 */

const { updateUserMock, refreshMock } = vi.hoisted(() => ({
  updateUserMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { updateUser: updateUserMock } }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { AccountEmailSection } from "./AccountEmailSection";

const HELPER =
  "This is the email you use to sign in. Changing it takes effect after you confirm by email.";
const GENERIC_FALLBACK = "Could not send the confirmation link. Please try again.";

beforeEach(() => {
  updateUserMock.mockReset();
  refreshMock.mockReset();
});

function openForm() {
  fireEvent.click(screen.getByRole("button", { name: "Change email" }));
  return screen.getByLabelText("New email") as HTMLInputElement;
}

function submitWith(value: string) {
  const input = openForm();
  fireEvent.change(input, { target: { value } });
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

  it("calls updateUser once with the trimmed address and the encoded callback redirect", async () => {
    updateUserMock.mockResolvedValueOnce({ data: {}, error: null });
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    submitWith("new@quantalyze.test ");

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledOnce());
    expect(updateUserMock).toHaveBeenCalledWith(
      { email: "new@quantalyze.test" },
      {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/profile?tab=account")}`,
      },
    );
  });

  it("on success shows the pending panel naming both addresses and refreshes the route once", async () => {
    updateUserMock.mockResolvedValueOnce({
      data: { user: { new_email: "new@quantalyze.test" } },
      error: null,
    });
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    submitWith("new@quantalyze.test");

    const panel = await screen.findByRole("status");
    expect(panel).toHaveTextContent("new@quantalyze.test");
    expect(panel).toHaveTextContent("owner@quantalyze.test");
    expect(refreshMock).toHaveBeenCalledOnce();
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

  it("pending copy names both addresses and is true under either double-confirm setting", () => {
    render(
      <AccountEmailSection
        email="owner@quantalyze.test"
        pendingEmail="next@quantalyze.test"
      />,
    );

    expect(screen.getByRole("status").textContent).toBe(
      "We sent a confirmation link to next@quantalyze.test. You still sign in with owner@quantalyze.test until you confirm. If you also get an email at owner@quantalyze.test, confirm that one too.",
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

  it("validation: the same address after trim and lower-case is refused with NO updateUser call", () => {
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    submitWith("OWNER@quantalyze.test ");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "That is already your sign-in email.",
    );
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("error: shows Supabase's message as-is, keeps the typed value and the form open", async () => {
    updateUserMock.mockResolvedValueOnce({
      data: null,
      error: { message: "Email address is invalid", name: "AuthApiError", status: 422 },
    });
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
    updateUserMock.mockResolvedValueOnce({ data: null, error: { message: "   " } });
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    submitWith("next@quantalyze.test");

    expect(await screen.findByRole("alert")).toHaveTextContent(GENERIC_FALLBACK);
  });

  it("error: a thrown call shows the network line and keeps the form open", async () => {
    updateUserMock.mockRejectedValueOnce(new Error("boom"));
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    const input = submitWith("next@quantalyze.test");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Network error. Please try again.",
    );
    expect(input.value).toBe("next@quantalyze.test");
  });

  it("loading: while updateUser is in flight the button reads Sending link... and every control is disabled", async () => {
    let resolveCall!: (v: unknown) => void;
    updateUserMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCall = resolve;
      }),
    );
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    const input = submitWith("next@quantalyze.test");

    const busy = await screen.findByRole("button", { name: "Sending link..." });
    expect(busy).toBeDisabled();
    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep current email" })).toBeDisabled();

    resolveCall({
      data: { user: { new_email: "next@quantalyze.test" } },
      error: null,
    });
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });

  // SF-01: Auth reports whether anything awaits confirmation. With autoconfirm
  // it applies the change at once and returns no new_email, so no "link sent"
  // panel may appear; the refresh brings the new email.
  it("SF-01: updateUser resolving with new_email null shows no sent panel and still refreshes", async () => {
    updateUserMock.mockResolvedValueOnce({
      data: { user: { new_email: null } },
      error: null,
    });
    render(<AccountEmailSection email="owner@quantalyze.test" pendingEmail={null} />);

    submitWith("new@quantalyze.test");

    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Change email" })).toBeInTheDocument();
  });

  it("SF-01: a refreshed prop with no pending change clears the local sent panel", async () => {
    updateUserMock.mockResolvedValueOnce({
      data: { user: { new_email: "new@quantalyze.test" } },
      error: null,
    });
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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DeletionRequestActions } from "./DeletionRequestActions";

/**
 * P466 (audit-2026-05-07) — coverage for DeletionRequestActions.
 *
 * The component renders Approve / Reject buttons inline with a pending
 * deletion-request row. Four behaviors are load-bearing:
 *
 *   (a) Approve triggers `window.confirm` BEFORE issuing the POST. If
 *       the admin cancels the confirm dialog the POST must not fire
 *       (the action is irreversible — sanitize_user anonymizes PII).
 *   (b) Reject triggers `window.prompt` to capture an optional reason.
 *       A null return (cancelled) must abort the POST.
 *   (c) During an in-flight submit both buttons render the "…" loading
 *       state and remain disabled.
 *   (d) On a non-OK response the component surfaces the error inline
 *       via the role="alert" element rather than silently failing.
 */

const routerRefreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const TEST_REQUEST_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  routerRefreshMock.mockClear();
  vi.restoreAllMocks();
});

afterEach(() => {
  // confirm/prompt are mocked per-test via vi.spyOn — restoreAllMocks
  // in beforeEach handles cleanup, but call explicitly in afterEach to
  // keep cross-test isolation airtight under --reporter=verbose.
  vi.restoreAllMocks();
});

describe("<DeletionRequestActions> — P466", () => {
  it("Approve requires window.confirm — POST does NOT fire when confirm returns false", async () => {
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => false);
    const fetchSpy = vi.spyOn(global, "fetch");

    render(<DeletionRequestActions requestId={TEST_REQUEST_ID} />);

    fireEvent.click(screen.getByRole("button", { name: /^Approve$/i }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toMatch(/anonymize/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });

  it("Approve fires POST when window.confirm returns true", async () => {
    vi.spyOn(window, "confirm").mockImplementation(() => true);
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<DeletionRequestActions requestId={TEST_REQUEST_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /^Approve$/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      `/api/admin/deletion-requests/${TEST_REQUEST_ID}/approve`,
    );
    expect(init.method).toBe("POST");

    await waitFor(() => expect(routerRefreshMock).toHaveBeenCalledTimes(1));
  });

  it("Reject opens window.prompt and aborts when admin cancels (null return)", async () => {
    const promptSpy = vi
      .spyOn(window, "prompt")
      .mockImplementation(() => null);
    const fetchSpy = vi.spyOn(global, "fetch");

    render(<DeletionRequestActions requestId={TEST_REQUEST_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /^Reject$/i }));

    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(promptSpy.mock.calls[0][0]).toMatch(/reason/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Reject fires POST with the reason captured from window.prompt", async () => {
    vi.spyOn(window, "prompt").mockImplementation(
      () => "  GDPR Article 17 not applicable  ",
    );
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<DeletionRequestActions requestId={TEST_REQUEST_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /^Reject$/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      `/api/admin/deletion-requests/${TEST_REQUEST_ID}/reject`,
    );
    const body = JSON.parse((init.body as string) ?? "{}");
    expect(body.reason).toBe("GDPR Article 17 not applicable");
  });

  it("loading state: both buttons disabled and approve renders '…' during submit", async () => {
    vi.spyOn(window, "confirm").mockImplementation(() => true);
    // Resolve fetch on a manual promise so the loading state remains
    // observable while the test makes assertions.
    let resolveFetch: (value: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(global, "fetch").mockReturnValue(fetchPromise);

    render(<DeletionRequestActions requestId={TEST_REQUEST_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /^Approve$/i }));

    await waitFor(() => {
      // The approve label flips to "…" while pending.
      const ellipsisBtn = screen.getByRole("button", { name: "…" });
      expect(ellipsisBtn).toBeDisabled();
    });

    // The sibling Reject button is also disabled during the in-flight
    // submit (prevents racing two POSTs against the same request).
    const rejectBtn = screen.getByRole("button", { name: /^Reject$/i });
    expect(rejectBtn).toBeDisabled();

    // Resolve so the test cleanly tears down.
    resolveFetch(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    await waitFor(() => expect(routerRefreshMock).toHaveBeenCalledTimes(1));
  });

  it("surfaces server error inline via role='alert' on non-OK response", async () => {
    vi.spyOn(window, "confirm").mockImplementation(() => true);
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Sanitize failed" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<DeletionRequestActions requestId={TEST_REQUEST_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /^Approve$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Sanitize failed/);
    // A failed submit must NOT trigger a router.refresh — otherwise the
    // page state would silently flicker back to "no error" on a 500.
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });
});

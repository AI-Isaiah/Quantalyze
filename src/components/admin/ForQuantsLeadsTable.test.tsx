import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ForQuantsLeadsTable } from "./ForQuantsLeadsTable";
import type { ForQuantsLeadRow } from "@/lib/for-quants-leads-admin";

/**
 * F1 loud-fail discipline — H-0355 / M-0380 (audit-2026-05-07).
 *
 * `toggleProcessed` used a BARE `catch {}` (no binding, no logging). Every
 * underlying failure — JSON-parse errors, aborts, timeouts, CSP violations,
 * genuine network errors — collapsed into one opaque "Network error. Try
 * again." message, and the discarded error never reached the console / logs.
 * The admin had zero diagnostic information and devops had no signal at all.
 *
 * These tests encode the loud-fail intent (CLAUDE.md Rule 9):
 *   (a) a thrown failure is LOGGED via console.error with a stable prefix so
 *       the failure stays observable; and
 *   (b) the surfaced inline error carries the REAL reason (err.message), not
 *       a generic catch-all string.
 * They fail against the pre-fix bare `catch {}` which neither logged nor
 * propagated the underlying message.
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

const TEST_LEAD: ForQuantsLeadRow = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Ada Quant",
  firm: "Quant Capital",
  email: "ada@quant.test",
  preferred_time: null,
  notes: null,
  wizard_context: null,
  created_at: "2026-06-01T00:00:00.000Z",
  processed_at: null,
  processed_by: null,
  notify_attempted_at: null,
  notify_succeeded_at: null,
  notify_error: null,
};

beforeEach(() => {
  routerRefreshMock.mockClear();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<ForQuantsLeadsTable> toggleProcessed — F1 loud-fail (H-0355 / M-0380)", () => {
  it("logs the swallowed error via console.error with a stable prefix when fetch throws", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.spyOn(global, "fetch").mockRejectedValue(
      new Error("Failed to fetch: ECONNRESET"),
    );

    render(
      <ForQuantsLeadsTable
        leads={[TEST_LEAD]}
        showAll={false}
        hitCap={false}
        fullViewCap={100}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Mark processed/i }));

    await waitFor(() => expect(consoleErrorSpy).toHaveBeenCalled());
    // Stable prefix so the failure is greppable in the console / log drain.
    expect(consoleErrorSpy.mock.calls[0][0]).toContain(
      "[ForQuantsLeadsTable] toggleProcessed failed",
    );
    // The original error must travel with the log, not be discarded.
    const logged = consoleErrorSpy.mock.calls[0][1] as { error?: unknown };
    expect((logged.error as Error)?.message).toBe(
      "Failed to fetch: ECONNRESET",
    );
    // A failed toggle must NOT refresh — the row state is unchanged.
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });

  it("surfaces the real error reason inline instead of a generic 'Network error'", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(global, "fetch").mockRejectedValue(
      new Error("Unexpected token < in JSON at position 0"),
    );

    render(
      <ForQuantsLeadsTable
        leads={[TEST_LEAD]}
        showAll={false}
        hitCap={false}
        fullViewCap={100}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Mark processed/i }));

    const alert = await screen.findByText(
      /Unexpected token < in JSON at position 0/,
    );
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/Could not save change/i);
  });

  it("still surfaces an inline error on a non-OK response (no false 'all clear')", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );

    render(
      <ForQuantsLeadsTable
        leads={[TEST_LEAD]}
        showAll={false}
        hitCap={false}
        fullViewCap={100}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Mark processed/i }));

    expect(
      await screen.findByText(/Could not mark as processed/i),
    ).toBeInTheDocument();
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });
});

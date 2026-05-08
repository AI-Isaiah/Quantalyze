/**
 * Audit-2026-05-07 #44 — PendingIntros regression tests.
 *
 * The component used to UPDATE contact_requests without `.select("id")` and
 * trust the absence of `updateError` as success. RLS could silently filter
 * the affected-row set to 0, leaving the row at status='pending' while the
 * UI optimistically rendered "Accepted". The fix attaches `.select("id")`
 * and surfaces a user-visible error when zero rows came back.
 *
 * Branches verified:
 *   1. Update returns rows → router.refresh() fires, no error surfaced.
 *   2. Update returns rows AND action="accept" → confirmMessage rendered.
 *   3. supabase update returns updateError → generic failure copy rendered.
 *   4. supabase update returns data:[] (RLS-zero) → permission-style error
 *      rendered AND router.refresh() does NOT fire (no false-positive).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PendingIntros } from "./PendingIntros";

type UpdateResult = { data: unknown; error: { message: string } | null };

let nextUpdateResult: UpdateResult = { data: [{ id: "stub" }], error: null };
const updateSpy = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => ({
      update: (payload: unknown) => {
        updateSpy({ table, payload });
        return {
          eq: () => ({
            select: () => Promise.resolve(nextUpdateResult),
          }),
        };
      },
    }),
  }),
}));

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const REQUEST = {
  id: "00000000-0000-4000-8000-000000000001",
  status: "pending",
  message: "Hi, would like an intro.",
  created_at: "2026-04-01T00:00:00Z",
  strategy_id: "11111111-1111-4111-8111-111111111111",
  founder_notes: null,
  profiles: { display_name: "Acme Capital", company: "Acme Co" },
  strategies: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Stellar Neutral Alpha",
    is_blind: false,
    blinded_label: null,
  },
};

describe("PendingIntros — Audit #44 RLS-zero detection", () => {
  beforeEach(() => {
    nextUpdateResult = { data: [{ id: "stub" }], error: null };
    updateSpy.mockReset();
    refreshMock.mockReset();
  });

  it("calls update and refreshes the router on a successful response (rows returned)", async () => {
    render(<PendingIntros requests={[REQUEST]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const call = updateSpy.mock.calls[0][0];
    expect(call.table).toBe("contact_requests");
    expect((call.payload as { status: string }).status).toBe("intro_made");
  });

  it("shows the confirm message after a successful Accept", async () => {
    render(<PendingIntros requests={[REQUEST]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    });
    await waitFor(() =>
      expect(
        screen.getByText(/Our team will connect you within 48h/i),
      ).toBeDefined(),
    );
  });

  it("does NOT render the confirm message after a successful Decline", async () => {
    render(<PendingIntros requests={[REQUEST]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /decline/i }));
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText(/Our team will connect you within 48h/i),
    ).toBeNull();
    // status payload is "declined" for the decline path
    const payload = updateSpy.mock.calls[0][0].payload as { status: string };
    expect(payload.status).toBe("declined");
  });

  it("surfaces the generic failure copy when supabase returns updateError", async () => {
    nextUpdateResult = {
      data: null,
      error: { message: "boom" },
    };
    render(<PendingIntros requests={[REQUEST]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    });
    await waitFor(() =>
      expect(
        screen.getByText(/Failed to update request\. Please try again\./i),
      ).toBeDefined(),
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("surfaces the RLS-zero permission error when supabase returns data:[] (regression: Audit #44)", async () => {
    // The exact bug class the fix protects against — PostgREST returns
    // an empty data array when the RLS policy filters the row out, with
    // NO error object. Pre-fix, the UI would render "intro_made" and
    // call router.refresh() despite the DB row still being 'pending'.
    nextUpdateResult = { data: [], error: null };
    render(<PendingIntros requests={[REQUEST]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    });
    await waitFor(() =>
      expect(
        screen.getByText(/your account may not have permission/i),
      ).toBeDefined(),
    );
    // CRITICAL: refresh must NOT have fired — that's the silent-success
    // bug we're protecting against.
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("surfaces the RLS-zero permission error when supabase returns data:null (defensive)", async () => {
    // PostgREST may also return data:null on an unexpected shape — the
    // `!updated || updated.length === 0` guard must catch both.
    nextUpdateResult = { data: null, error: null };
    render(<PendingIntros requests={[REQUEST]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /decline/i }));
    });
    await waitFor(() =>
      expect(
        screen.getByText(/your account may not have permission/i),
      ).toBeDefined(),
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

/**
 * Audit-2026-05-07 #44 + C-0135 + C-0136 — PendingIntros regression tests.
 *
 * History:
 *   - #44 (resolved): the component used to UPDATE contact_requests
 *     without `.select("id")` and trust the absence of `updateError` as
 *     success. RLS could silently filter the affected-row set to 0,
 *     leaving the row at status='pending' while the UI optimistically
 *     rendered "Accepted".
 *   - C-0135: even with the .select("id") fix, the manager-side direct
 *     Supabase write bypassed `/api/admin/intro-request` and therefore
 *     skipped the notifyAllocatorIntroStatus email — allocators never
 *     learned their request had been accepted or declined.
 *   - C-0136: the manager-side direct UPDATE could mutate any column on
 *     contact_requests (admin_note, founder_notes, allocation_amount)
 *     because the RLS UPDATE policy had no column-level grant and no
 *     WITH CHECK clause.
 *
 * Fix: route manager responses through POST /api/intro-response, which
 * (a) enforces caller-is-strategy-manager, (b) writes only `status +
 * responded_at` via the service-role admin client, (c) audits the
 * transition, (d) triggers notifyAllocatorIntroStatus on every accept
 * AND decline. Component tests now assert the fetch contract.
 *
 * Branches verified:
 *   1. POST /api/intro-response { id, action: 'accept' } on click and
 *      router.refresh() fires on success.
 *   2. action='accept' renders the "We'll connect you within 48h"
 *      confirm message.
 *   3. action='decline' issues { action: 'decline' } and does NOT render
 *      the accept-only confirm message.
 *   4. res.ok=false (500) → generic failure copy rendered AND
 *      router.refresh() does NOT fire (silent-success protection).
 *   5. res.status=403 (caller not manager) → permission-style error.
 *   6. fetch rejects (network) → generic failure copy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PendingIntros } from "./PendingIntros";
import { installFetchMock, restoreFetchMock, type FetchMock } from "@/test/helpers/fetch";

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

let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = installFetchMock();
  refreshMock.mockReset();
});

afterEach(() => {
  restoreFetchMock();
});

describe("PendingIntros — Audit C-0135/C-0136 server-route refactor", () => {
  it("POSTs to /api/intro-response { id, action: 'accept' } and refreshes the router on success", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
    render(<PendingIntros requests={[REQUEST]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/intro-response");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string) as {
      id: string;
      action: string;
    };
    expect(body).toEqual({ id: REQUEST.id, action: "accept" });
  });

  it("shows the confirm message after a successful Accept", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
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

  it("issues { action: 'decline' } and does NOT render the accept-only confirm message", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
    render(<PendingIntros requests={[REQUEST]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /decline/i }));
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText(/Our team will connect you within 48h/i),
    ).toBeNull();
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    ) as { action: string };
    expect(body.action).toBe("decline");
  });

  it("surfaces the generic failure copy when the server returns 500 and does NOT refresh", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);
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

  it("surfaces the permission-style error on 403 (caller not strategy manager) — closes C-0136", async () => {
    // 403 means the server's ownership check (strategies.user_id !== user.id)
    // rejected the call. Pre-refactor, a malicious manager could mutate any
    // column on contact_requests for their strategies; post-refactor they
    // can't even submit the response because the server now validates
    // ownership. The UI surfaces a permission-style copy on the 403.
    fetchMock.mockResolvedValue({ ok: false, status: 403 } as Response);
    render(<PendingIntros requests={[REQUEST]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    });
    await waitFor(() =>
      expect(
        screen.getByText(/your account may not have permission/i),
      ).toBeDefined(),
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("surfaces the generic failure copy when fetch rejects (network error)", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
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

  // Source-grep regression locks live in
  // src/__tests__/critical-regressions.test.ts under the
  // [AUDIT-2026-05-07 C-0135 + C-0136] block — see that file for the
  // file-level pins on `@/lib/supabase/client` import, `contact_requests`
  // reference, `/api/intro-response` target, and permission-error copy.
});

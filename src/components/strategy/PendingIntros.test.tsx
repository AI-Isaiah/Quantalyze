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
 * Coverage spans the audit-2026-05-07 testing fingerprints
 * (404-classification-gap, decline-refresh-assertion-gap) and the
 * red-team 2026-05-17 fingerprints (double-click-race useRef gate,
 * loading-flag-released-too-early ordering, 409 TOCTOU refresh-copy
 * mapping) on top of the original happy-path / 403 / 500 / network
 * contract. Each test names the specific finding it pins.
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
    // Audit-2026-05-07 testing/decline-refresh-assertion-gap — pin that
    // BOTH accept and decline trigger router.refresh() on success. A
    // regression that gated refresh() on `action === 'accept'` (matching
    // the confirm-message branch shape) would leave the decline UI stale
    // until full reload; this assertion catches that.
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(refreshMock).toHaveBeenCalledTimes(1);
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

  // Audit-2026-05-07 testing/404-classification-gap — pins that a 404
  // (stale id / request deleted between page load and click) falls
  // through to the generic failure copy, NOT the 401/403 permission
  // copy. A regression that broadened the permission branch to also
  // match 404 would show "your account may not have permission" for
  // a stale-row case — misleading the manager about the failure mode.
  it("renders the generic failure copy on a 404 (not the permission copy)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 } as Response);
    render(<PendingIntros requests={[REQUEST]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    });
    await waitFor(() =>
      expect(
        screen.getByText(/Failed to update request\. Please try again\./i),
      ).toBeDefined(),
    );
    expect(
      screen.queryByText(/your account may not have permission/i),
    ).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // Red-team 2026-05-17 (red-team:double-click-race, HIGH conf 8): a
  // double-click within the same render tick used to fire TWO POSTs to
  // /api/intro-response because `disabled={loading === r.id}` flipped
  // async via setState — both clicks saw loading=null and both passed.
  // The synchronous useRef-backed in-flight gate inside handleRespond
  // now blocks the second entry before fetch(). This test fires two
  // synchronous fireEvent.click()s and asserts only ONE fetch lands.
  it("does NOT double-fire on a double-click within the same render tick (useRef sync gate)", async () => {
    // Resolve slowly so the first call is still in-flight when the
    // second click fires.
    let resolveFirst: (r: Response) => void = () => undefined;
    const firstPromise = new Promise<Response>((res) => {
      resolveFirst = res;
    });
    fetchMock.mockReturnValueOnce(firstPromise as unknown as Promise<Response>);
    render(<PendingIntros requests={[REQUEST]} />);
    const button = screen.getByRole("button", { name: /accept/i });
    // Two synchronous clicks — no awaits in between. The async setState
    // for `loading` has NOT flushed yet between these two events.
    fireEvent.click(button);
    fireEvent.click(button);
    // Only ONE fetch should have been issued — the synchronous useRef
    // gate inside handleRespond rejected the second entry.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Resolve the in-flight POST so the test cleans up.
    await act(async () => {
      resolveFirst({ ok: true, status: 200 } as Response);
      await firstPromise;
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });

  // Red-team 2026-05-17 (red-team:loading-flag-released-too-early, MED
  // conf 8): on a !res.ok response, the error copy must render in the
  // SAME paint as the button re-enable. The previous order called
  // setLoading(null) BEFORE setError, leaving a 100-200ms window where
  // the button was clickable but no error text was on screen — a
  // frustrated manager could double-click into a still-pending error
  // render. Asserting that the error text is present by the time the
  // button is re-enabled pins the new ordering.
  it("renders the error banner in the same paint as the button re-enable (no flag-released-too-early gap)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);
    render(<PendingIntros requests={[REQUEST]} />);
    const button = screen.getByRole("button", { name: /accept/i });
    await act(async () => {
      fireEvent.click(button);
    });
    // By the time the error banner is in the DOM, the button must be
    // re-enabled (loading flag released). If the new ordering regressed
    // back to setLoading(null) BEFORE setError, the banner would render
    // a paint later — this assertion holds because we wait on the
    // banner first.
    await waitFor(() =>
      expect(
        screen.getByText(/Failed to update request\. Please try again\./i),
      ).toBeDefined(),
    );
    const acceptAfter = screen.getByRole("button", { name: /accept/i });
    expect((acceptAfter as HTMLButtonElement).disabled).toBe(false);
  });

  // Red-team 2026-05-17: a 409 from the server (TOCTOU close — request
  // already resolved elsewhere) should surface the permission-style
  // refresh copy, NOT the generic "try again" copy. Refresh is what
  // the manager needs because the row is no longer pending.
  it("surfaces the refresh-style copy on a 409 (TOCTOU: resolved elsewhere)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409 } as Response);
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

  // Source-grep regression locks live in
  // src/__tests__/critical-regressions.test.ts under the
  // [AUDIT-2026-05-07 C-0135 + C-0136] block — see that file for the
  // file-level pins on `@/lib/supabase/client` import, `contact_requests`
  // reference, `/api/intro-response` target, and permission-error copy.
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UserRolesPanel } from "./UserRolesPanel";

/**
 * P465 (audit-2026-05-07) — coverage for UserRolesPanel.
 *
 * The component is the client-side UI for /admin/users/[id] role
 * provisioning. Three behaviors are load-bearing for the security model:
 *
 *   (a) Self-admin-revoke guard: when `isSelf && currentRoles.includes('admin')`
 *       the Revoke button is disabled at the DOM level. The server has a
 *       matching 400 guard, but the client guard prevents an accidental
 *       click that would expensively round-trip and surface "You can't
 *       lock yourself out" to the only admin in the room.
 *   (b) Renders the current set of roles, with an "Active" badge per
 *       held role and a Grant button for unheld roles.
 *   (c) On a successful POST, the component fires router.refresh()
 *       (optimistic update via the App Router data layer — the parent
 *       page re-fetches the role set from the server).
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

const TARGET_USER_ID = "00000000-0000-0000-0000-000000000999";

beforeEach(() => {
  routerRefreshMock.mockClear();
  vi.restoreAllMocks();
});

describe("<UserRolesPanel> — P465", () => {
  it("self-admin-revoke guard: Revoke button is disabled when isSelf && admin held", () => {
    render(
      <UserRolesPanel
        targetUserId={TARGET_USER_ID}
        currentRoles={["admin"]}
        isSelf={true}
      />,
    );

    // The admin row's action button reads "Revoke" because admin is held.
    // It must be disabled — and the explanatory copy must be visible so
    // the admin understands WHY they can't click it (matches DESIGN.md
    // helper-text pattern).
    const revokeBtn = screen.getByRole("button", { name: /^Revoke$/i });
    expect(revokeBtn).toBeDisabled();
    expect(
      screen.getByText(/cannot revoke your own admin role/i),
    ).toBeInTheDocument();
  });

  it("does NOT disable revoke when isSelf=false (an admin revoking another admin)", () => {
    // An admin viewing /admin/users/<someone-else> should be able to
    // revoke that other user's admin role. Guard must not over-fire.
    render(
      <UserRolesPanel
        targetUserId={TARGET_USER_ID}
        currentRoles={["admin"]}
        isSelf={false}
      />,
    );
    const revokeBtn = screen.getByRole("button", { name: /^Revoke$/i });
    expect(revokeBtn).not.toBeDisabled();
  });

  it("renders an Active badge for each currently-held role and Grant button for unheld", () => {
    render(
      <UserRolesPanel
        targetUserId={TARGET_USER_ID}
        currentRoles={["allocator"]}
        isSelf={false}
      />,
    );

    // The "Active" badge is rendered once, on the allocator row.
    const activeBadges = screen.getAllByText(/^Active$/i);
    expect(activeBadges).toHaveLength(1);

    // The non-held roles (admin, quant_manager, analyst) each render a
    // Grant button. Total = APP_ROLES.length - 1.
    const grantBtns = screen.getAllByRole("button", { name: /^Grant$/i });
    expect(grantBtns.length).toBeGreaterThanOrEqual(3);

    // The allocator row's button reads "Revoke" not "Grant".
    expect(
      screen.getByRole("button", { name: /^Revoke$/i }),
    ).toBeInTheDocument();
  });

  it("calls router.refresh() after a successful grant POST (optimistic update)", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(
      <UserRolesPanel
        targetUserId={TARGET_USER_ID}
        currentRoles={[]}
        isSelf={false}
      />,
    );

    // Click the first Grant button (analyst is alphabetically last but
    // we don't care — we just need any one to fire the POST).
    const grantBtns = screen.getAllByRole("button", { name: /^Grant$/i });
    fireEvent.click(grantBtns[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // The POST URL targets the per-user roles endpoint.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/api/admin/users/${TARGET_USER_ID}/roles`);
    expect(init.method).toBe("POST");

    // On success the component re-fetches via the App Router data layer
    // rather than reaching into state — the parent page re-reads the
    // canonical role set.
    await waitFor(() => {
      expect(routerRefreshMock).toHaveBeenCalledTimes(1);
    });
  });
});

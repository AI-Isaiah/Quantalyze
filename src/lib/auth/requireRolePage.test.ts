/**
 * Phase 109 ROLE-04 — unit tests for requireRolePage.
 *
 * The shared server-side page guard mirrors withAllocatorAuth.ts's three-branch
 * discipline on profiles.role, except the wrong-role branch substitutes a server
 * redirect() for the API's 403 response:
 *
 *   - DB-error branch    → console.error + captureToSentry(level "error") + THROW.
 *                          NEVER redirect (a Postgres hiccup must not masquerade
 *                          as wrong-role and bounce a valid owner off their surface).
 *   - missing-profile    → console.error + captureToSentry(level "warning") + THROW.
 *                          NEVER redirect.
 *   - wrong-role         → redirect() to the visitor's OWN role home surface.
 *
 * The full role × is_admin matrix (RESEARCH.md lines 300-308) is enumerated to
 * prove redirect-loop freedom: home targets are always a route the role owns,
 * `both` is never redirected, and unknown/malformed roles are denied-by-default
 * and sent to the terminal, unguarded /pending-approval (structurally loop-free).
 *
 * The guard selects ONLY "role" — is_admin has no code path (ROLE-03), so the
 * matrix rows collapse to the role cases but are enumerated anyway.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { User } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

// redirect() throws NEXT_REDIRECT in Next 16 — mock it to throw a sentinel so
// call vs no-call is assertable (a redirect sneaking into an error branch MUST
// make the test fail).
const REDIRECT_SENTINEL = "NEXT_REDIRECT";
const redirectMock = vi.fn((href: string) => {
  throw new Error(`${REDIRECT_SENTINEL}:${href}`);
});
vi.mock("next/navigation", () => ({
  redirect: (href: string) => redirectMock(href),
}));

const captureToSentryMock = vi.fn();
vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (...args: unknown[]) => captureToSentryMock(...args),
}));

import { requireRolePage } from "./requireRolePage";

const MOCK_USER = { id: "user-A" } as unknown as User;

// The profile lookup mock drives each case: prime maybeSingleMock with the
// { data, error } the guard should branch on. selectMock captures its argument
// so we can prove the guard selects exactly "role".
const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));
const supabase = { from: fromMock } as unknown as Parameters<
  typeof requireRolePage
>[0];

/** Extract the redirect target from the sentinel error the redirect mock throws. */
async function expectRedirect(
  role: unknown,
  need: "allocator" | "manager",
): Promise<string> {
  maybeSingleMock.mockResolvedValueOnce({
    data: role === undefined ? null : { role },
    error: null,
  });
  await expect(requireRolePage(supabase, MOCK_USER, need)).rejects.toThrow(
    REDIRECT_SENTINEL,
  );
  const call = redirectMock.mock.calls.at(-1);
  return call?.[0] as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  maybeSingleMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("requireRolePage", () => {
  describe("DB-error branch (never redirects)", () => {
    it("throws, reports to Sentry at level 'error', and NEVER redirects", async () => {
      maybeSingleMock.mockResolvedValueOnce({
        data: null,
        error: { message: "boom", code: "PGRST000" },
      });

      await expect(
        requireRolePage(supabase, MOCK_USER, "allocator"),
      ).rejects.toThrow("boom");

      // The redirect mock must have zero calls on the error branch — a redirect
      // sneaking in here would let a transient DB blip masquerade as wrong-role.
      expect(redirectMock).not.toHaveBeenCalled();
      expect(captureToSentryMock).toHaveBeenCalledWith(
        expect.objectContaining({ code: "PGRST000" }),
        expect.objectContaining({
          level: "error",
          tags: expect.objectContaining({
            role_gate_failure: "true",
            role_gate_kind: "lookup_error",
            role_gate_code: "PGRST000",
          }),
          extra: expect.objectContaining({ user_id: "user-A" }),
        }),
      );
    });
  });

  describe("missing-profile branch (never redirects)", () => {
    it("throws, reports to Sentry at level 'warning', and NEVER redirects", async () => {
      maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

      await expect(
        requireRolePage(supabase, MOCK_USER, "manager"),
      ).rejects.toThrow(/profile/i);

      expect(redirectMock).not.toHaveBeenCalled();
      expect(captureToSentryMock).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          level: "warning",
          tags: expect.objectContaining({
            role_gate_failure: "true",
            role_gate_kind: "missing_profile",
          }),
          extra: expect.objectContaining({ user_id: "user-A" }),
        }),
      );
    });
  });

  describe("wrong-role redirect (to the visitor's OWN role home)", () => {
    it("manager visiting an allocator route → redirect('/strategies')", async () => {
      expect(await expectRedirect("manager", "allocator")).toBe("/strategies");
    });

    it("allocator visiting a manager route → redirect('/allocations')", async () => {
      expect(await expectRedirect("allocator", "manager")).toBe("/allocations");
    });
  });

  describe("owner passes (no redirect, no throw)", () => {
    it("allocator owns allocator routes", async () => {
      maybeSingleMock.mockResolvedValueOnce({
        data: { role: "allocator" },
        error: null,
      });
      await expect(
        requireRolePage(supabase, MOCK_USER, "allocator"),
      ).resolves.toBeUndefined();
      expect(redirectMock).not.toHaveBeenCalled();
    });

    it("manager owns manager routes", async () => {
      maybeSingleMock.mockResolvedValueOnce({
        data: { role: "manager" },
        error: null,
      });
      await expect(
        requireRolePage(supabase, MOCK_USER, "manager"),
      ).resolves.toBeUndefined();
      expect(redirectMock).not.toHaveBeenCalled();
    });
  });

  describe("both owns everything (loop-freedom anchor — never redirected)", () => {
    it("both owns allocator routes", async () => {
      maybeSingleMock.mockResolvedValueOnce({
        data: { role: "both" },
        error: null,
      });
      await expect(
        requireRolePage(supabase, MOCK_USER, "allocator"),
      ).resolves.toBeUndefined();
      expect(redirectMock).not.toHaveBeenCalled();
    });

    it("both owns manager routes", async () => {
      maybeSingleMock.mockResolvedValueOnce({
        data: { role: "both" },
        error: null,
      });
      await expect(
        requireRolePage(supabase, MOCK_USER, "manager"),
      ).resolves.toBeUndefined();
      expect(redirectMock).not.toHaveBeenCalled();
    });
  });

  describe("deny-by-default (unknown/malformed role → terminal /pending-approval)", () => {
    it.each([
      ["analyst", "allocator"],
      ["analyst", "manager"],
      ["", "allocator"],
      ["", "manager"],
      [null, "allocator"],
      [null, "manager"],
    ] as const)(
      "role=%o need=%s → redirect('/pending-approval')",
      async (role, need) => {
        expect(await expectRedirect(role, need)).toBe("/pending-approval");
      },
    );
  });

  describe("selects ONLY 'role' (is_admin can structurally never influence the decision)", () => {
    it("passes exactly the string 'role' to select()", async () => {
      maybeSingleMock.mockResolvedValueOnce({
        data: { role: "both" },
        error: null,
      });
      await requireRolePage(supabase, MOCK_USER, "allocator");
      expect(selectMock).toHaveBeenCalledWith("role");
      expect(selectMock).toHaveBeenCalledTimes(1);
    });
  });

  // RESEARCH.md lines 300-308. is_admin has no code path, so the six rows
  // collapse to the role cases above — enumerated here so the loop-freedom
  // proof is explicit. Every redirect target is a route the role owns; `both`
  // is never redirected; the missing-profile row throws (structurally loop-free).
  describe("role × is_admin redirect-loop matrix", () => {
    it.each([
      // role, is_admin, visiting /strategies (need manager), visiting /allocations (need allocator)
      ["allocator", false],
      ["allocator", true],
      ["manager", false],
      ["manager", true],
      ["both", false],
      ["both", true],
    ] as const)(
      "role=%s is_admin=%s stays loop-free on both surfaces",
      async (role) => {
        const ownsAllocator = role === "allocator" || role === "both";
        const ownsManager = role === "manager" || role === "both";

        // Visiting a manager route (/strategies).
        if (ownsManager) {
          maybeSingleMock.mockResolvedValueOnce({ data: { role }, error: null });
          await expect(
            requireRolePage(supabase, MOCK_USER, "manager"),
          ).resolves.toBeUndefined();
        } else {
          // allocator visiting manager route → bounced to its OWN home.
          expect(await expectRedirect(role, "manager")).toBe("/allocations");
        }

        // Visiting an allocator route (/allocations).
        if (ownsAllocator) {
          maybeSingleMock.mockResolvedValueOnce({ data: { role }, error: null });
          await expect(
            requireRolePage(supabase, MOCK_USER, "allocator"),
          ).resolves.toBeUndefined();
        } else {
          // manager visiting allocator route → bounced to its OWN home.
          expect(await expectRedirect(role, "allocator")).toBe("/strategies");
        }
      },
    );

    it("missing profile throws on both surfaces (never redirected — structurally loop-immune)", async () => {
      maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
      await expect(
        requireRolePage(supabase, MOCK_USER, "manager"),
      ).rejects.toThrow(/profile/i);

      maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
      await expect(
        requireRolePage(supabase, MOCK_USER, "allocator"),
      ).rejects.toThrow(/profile/i);

      expect(redirectMock).not.toHaveBeenCalled();
    });
  });
});

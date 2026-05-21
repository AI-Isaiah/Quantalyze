import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureAuthUser } from "./admin-users";

/**
 * Tests for the shared ensureAuthUser helper. Key paths:
 *   1. Happy path — createUser returns a fresh id.
 *   2. Conflict path — createUser returns 422 email_exists. Behavior
 *      depends on policy:
 *        - create_only → throws (refuses to bind).
 *        - create_or_resolve_pilot → looks up profile, verifies
 *          partner_tag matches AND is non-null, returns id or throws.
 *   3. C-0181 (audit-2026-05-07) — refuses to bind to a real user
 *      (existing profile.partner_tag is NULL/empty) or a cross-partner
 *      pilot (existing profile.partner_tag differs from caller's).
 */

type AuthResponse = {
  data: { user: { id: string } | null };
  error: { status?: number; code?: string; message?: string } | null;
};

type LookupResponse = {
  data: { id: string; partner_tag?: string | null } | null;
  error: { message: string } | null;
};

function buildMockClient(responses: {
  createUser: AuthResponse;
  profilesLookup?: LookupResponse;
}): SupabaseClient {
  const createUser = vi.fn().mockResolvedValue(responses.createUser);
  const lookupChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi
      .fn()
      .mockResolvedValue(responses.profilesLookup ?? { data: null, error: null }),
  };
  return {
    auth: { admin: { createUser } },
    from: vi.fn().mockReturnValue(lookupChain),
  } as unknown as SupabaseClient;
}

const PILOT_POLICY = {
  mode: "create_or_resolve_pilot" as const,
  partnerTag: "alpha-corp",
};

describe("ensureAuthUser", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: createUser succeeds → returns the new user id", async () => {
    const client = buildMockClient({
      createUser: {
        data: { user: { id: "new-user-uuid" } },
        error: null,
      },
    });

    const id = await ensureAuthUser(client, {
      email: "new@example.com",
      policy: PILOT_POLICY,
    });

    expect(id).toBe("new-user-uuid");
    // Should NOT fall through to profiles lookup when createUser succeeds.
    expect(client.from).not.toHaveBeenCalled();
  });

  it("passes `id` through to createUser when provided (seed script case)", async () => {
    const createUserMock = vi.fn().mockResolvedValue({
      data: { user: { id: "pinned-uuid" } },
      error: null,
    });
    const client = {
      auth: { admin: { createUser: createUserMock } },
      from: vi.fn(),
    } as unknown as SupabaseClient;

    await ensureAuthUser(client, {
      id: "pinned-uuid",
      email: "seed@example.com",
      policy: PILOT_POLICY,
    });

    expect(createUserMock).toHaveBeenCalledWith({
      id: "pinned-uuid",
      email: "seed@example.com",
      email_confirm: true,
    });
  });

  it("omits `id` from createUser payload when not provided", async () => {
    const createUserMock = vi.fn().mockResolvedValue({
      data: { user: { id: "generated-uuid" } },
      error: null,
    });
    const client = {
      auth: { admin: { createUser: createUserMock } },
      from: vi.fn(),
    } as unknown as SupabaseClient;

    await ensureAuthUser(client, {
      email: "new@example.com",
      policy: PILOT_POLICY,
    });

    expect(createUserMock).toHaveBeenCalledWith({
      email: "new@example.com",
      email_confirm: true,
    });
  });

  it("conflict path with matching partner_tag: returns existing id", async () => {
    const client = buildMockClient({
      createUser: {
        data: { user: null },
        error: {
          status: 422,
          code: "email_exists",
          message: "A user with this email already exists",
        },
      },
      profilesLookup: {
        data: { id: "existing-user-uuid", partner_tag: "alpha-corp" },
        error: null,
      },
    });

    const id = await ensureAuthUser(client, {
      email: "existing@example.com",
      policy: PILOT_POLICY,
    });

    expect(id).toBe("existing-user-uuid");
    expect(client.from).toHaveBeenCalledWith("profiles");
  });

  it("conflict path with user_already_exists code + matching partner_tag", async () => {
    const client = buildMockClient({
      createUser: {
        data: { user: null },
        error: {
          status: 422,
          code: "user_already_exists",
          message: "user already exists",
        },
      },
      profilesLookup: {
        data: { id: "existing", partner_tag: "alpha-corp" },
        error: null,
      },
    });

    const id = await ensureAuthUser(client, {
      email: "existing@example.com",
      policy: PILOT_POLICY,
    });
    expect(id).toBe("existing");
  });

  it("throws when the user exists in auth but not in profiles", async () => {
    const client = buildMockClient({
      createUser: {
        data: { user: null },
        error: {
          status: 422,
          code: "email_exists",
          message: "",
        },
      },
      profilesLookup: { data: null, error: null },
    });

    await expect(
      ensureAuthUser(client, {
        email: "orphaned@example.com",
        policy: PILOT_POLICY,
      }),
    ).rejects.toThrow(/no profile row/);
  });

  it("propagates non-conflict createUser errors", async () => {
    const client = buildMockClient({
      createUser: {
        data: { user: null },
        error: {
          status: 500,
          code: "internal_error",
          message: "database broke",
        },
      },
    });

    await expect(
      ensureAuthUser(client, {
        email: "whatever@example.com",
        policy: PILOT_POLICY,
      }),
    ).rejects.toMatchObject({ message: "database broke" });
  });

  it("handles createUser success with no user id as a fatal error", async () => {
    const client = buildMockClient({
      createUser: {
        data: { user: null },
        error: null,
      },
    });

    await expect(
      ensureAuthUser(client, {
        email: "weird@example.com",
        policy: PILOT_POLICY,
      }),
    ).rejects.toThrow(/no user id/);
  });

  // ============================================================
  // C-0181 (audit-2026-05-07) — defense-in-depth tests
  // ============================================================

  describe("C-0181: policy gate", () => {
    it("create_only policy: throws when email already exists", async () => {
      const client = buildMockClient({
        createUser: {
          data: { user: null },
          error: {
            status: 422,
            code: "email_exists",
            message: "exists",
          },
        },
      });

      await expect(
        ensureAuthUser(client, {
          email: "existing@example.com",
          policy: { mode: "create_only" },
        }),
      ).rejects.toThrow(/policy=create_only.*already has an auth user/);

      // Must NOT have looked up profiles — create_only refuses early.
      expect(client.from).not.toHaveBeenCalled();
    });

    it("create_or_resolve_pilot: refuses to bind when existing profile partner_tag IS NULL (real user)", async () => {
      const client = buildMockClient({
        createUser: {
          data: { user: null },
          error: {
            status: 422,
            code: "email_exists",
            message: "exists",
          },
        },
        profilesLookup: {
          data: { id: "victim-uuid", partner_tag: null },
          error: null,
        },
      });

      await expect(
        ensureAuthUser(client, {
          email: "victim@example.com",
          policy: PILOT_POLICY,
        }),
      ).rejects.toThrow(/no partner_tag.*would claim a real user/);
    });

    it("create_or_resolve_pilot: refuses to bind when existing profile partner_tag is EMPTY STRING", async () => {
      const client = buildMockClient({
        createUser: {
          data: { user: null },
          error: {
            status: 422,
            code: "email_exists",
            message: "exists",
          },
        },
        profilesLookup: {
          data: { id: "victim-uuid", partner_tag: "" },
          error: null,
        },
      });

      await expect(
        ensureAuthUser(client, {
          email: "victim@example.com",
          policy: PILOT_POLICY,
        }),
      ).rejects.toThrow(/no partner_tag/);
    });

    it("create_or_resolve_pilot: refuses to bind across partners (different partner_tag)", async () => {
      const client = buildMockClient({
        createUser: {
          data: { user: null },
          error: {
            status: 422,
            code: "email_exists",
            message: "exists",
          },
        },
        profilesLookup: {
          data: { id: "other-pilot-uuid", partner_tag: "beta-corp" },
          error: null,
        },
      });

      await expect(
        ensureAuthUser(client, {
          email: "shared@example.com",
          policy: PILOT_POLICY,
        }),
      ).rejects.toThrow(/existing partner_tag=beta-corp differs/);
    });

    it("create_or_resolve_pilot: selects partner_tag column (not just id) so the gate has data", async () => {
      const lookupChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: "ok", partner_tag: "alpha-corp" },
          error: null,
        }),
      };
      const client = {
        auth: {
          admin: {
            createUser: vi.fn().mockResolvedValue({
              data: { user: null },
              error: {
                status: 422,
                code: "email_exists",
                message: "exists",
              },
            }),
          },
        },
        from: vi.fn().mockReturnValue(lookupChain),
      } as unknown as SupabaseClient;

      await ensureAuthUser(client, {
        email: "ok@example.com",
        policy: PILOT_POLICY,
      });

      // The SELECT must include partner_tag for the gate to work.
      const selectArg = (lookupChain.select.mock.calls[0]?.[0] ?? "") as string;
      expect(selectArg).toContain("partner_tag");
    });
  });
});

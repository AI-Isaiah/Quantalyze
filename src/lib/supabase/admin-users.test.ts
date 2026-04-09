import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureAuthUser } from "./admin-users";

/**
 * Tests for the shared ensureAuthUser helper. The two code paths that
 * matter most are:
 *   1. Happy path — createUser returns a fresh id.
 *   2. Conflict path — createUser returns 422 email_exists; the helper
 *      must fall through to a profiles-by-email lookup and return the
 *      existing id instead of silently skipping.
 *
 * These cover the regression that motivated this PR: the seed script
 * was previously `continue`-ing on conflict, which worked for seeds
 * (because the profile is already there) but was wrong as a general
 * primitive for partner-import and future callers.
 */

type AuthResponse = {
  data: { user: { id: string } | null };
  error: { status?: number; code?: string; message?: string } | null;
};

type LookupResponse = {
  data: { id: string } | null;
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

    const id = await ensureAuthUser(client, { email: "new@example.com" });

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

    await ensureAuthUser(client, { email: "new@example.com" });

    expect(createUserMock).toHaveBeenCalledWith({
      email: "new@example.com",
      email_confirm: true,
    });
  });

  it("conflict path (422 email_exists): falls through to profiles lookup and returns existing id", async () => {
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
        data: { id: "existing-user-uuid" },
        error: null,
      },
    });

    const id = await ensureAuthUser(client, { email: "existing@example.com" });

    expect(id).toBe("existing-user-uuid");
    expect(client.from).toHaveBeenCalledWith("profiles");
  });

  it("conflict path (422 user_already_exists): falls through to profiles lookup", async () => {
    const client = buildMockClient({
      createUser: {
        data: { user: null },
        error: {
          status: 422,
          code: "user_already_exists",
          message: "user already exists",
        },
      },
      profilesLookup: { data: { id: "existing" }, error: null },
    });

    const id = await ensureAuthUser(client, { email: "existing@example.com" });
    expect(id).toBe("existing");
  });

  it("throws a descriptive error when the user exists in auth but not in profiles", async () => {
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
      ensureAuthUser(client, { email: "orphaned@example.com" }),
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
      ensureAuthUser(client, { email: "whatever@example.com" }),
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
      ensureAuthUser(client, { email: "weird@example.com" }),
    ).rejects.toThrow(/no user id/);
  });
});

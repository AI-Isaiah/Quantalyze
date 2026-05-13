/**
 * audit-2026-05-07 P700 — ADMIN_EMAIL env fallback grants must emit an
 * audit_log row.
 *
 * Pre-fix: `isAdminUser` returned TRUE for an email matching ADMIN_EMAIL
 * with NO database record and NO audit_log row. The grant was invisible
 * to forensic review.
 *
 * Post-fix: every successful ADMIN_EMAIL fallback grant emits
 * `action='admin.access.via_env_email_fallback'` with the matched email
 * in metadata. The grant is now visible in the audit trail.
 *
 * The pre-fix code would fail the "emits audit_log" assertion below;
 * the post-fix code passes it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

// Set ADMIN_EMAIL BEFORE importing src/lib/admin.ts so the module-level
// constant captures it. Module imports happen after this assignment via
// vi.resetModules() + dynamic import inside each test that needs it.
process.env.ADMIN_EMAIL = "breakglass@example.com";

const { userAppRolesMock, profilesMock, rpcMock } = vi.hoisted(() => ({
  userAppRolesMock: vi.fn(),
  profilesMock: vi.fn(),
  rpcMock: vi.fn(),
}));

function makeSupabaseClient() {
  return {
    from: (table: string) => {
      if (table === "user_app_roles") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: async () => userAppRolesMock(),
              }),
            }),
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => profilesMock(),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    rpc: rpcMock,
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";

async function loadAdminModule() {
  vi.resetModules();
  return await import("@/lib/admin");
}

beforeEach(() => {
  vi.clearAllMocks();
  // Defaults: neither DB signal grants admin — only the env-email
  // fallback should fire in these scenarios.
  userAppRolesMock.mockResolvedValue({ data: [], error: null });
  profilesMock.mockResolvedValue({
    data: { is_admin: false },
    error: null,
  });
  rpcMock.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  // Keep the env consistent across tests; the module-level capture
  // means individual tests can't safely mutate process.env mid-suite.
});

describe("audit-2026-05-07 P700 — ADMIN_EMAIL env fallback audit emission", () => {
  it("emits log_audit_event with action='admin.access.via_env_email_fallback' when the env-email grants", async () => {
    const { isAdminUser } = await loadAdminModule();
    const client = makeSupabaseClient();

    const ok = await isAdminUser(
      client as unknown as SupabaseClient,
      { id: "u-breakglass", email: "breakglass@example.com" },
    );

    expect(ok).toBe(true);

    // The audit emission is fire-and-forget (void), so wait for the
    // microtask queue to drain.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // log_audit_event RPC must have fired with the exact action +
    // metadata shape — this is the forensic anchor.
    expect(rpcMock).toHaveBeenCalled();
    const call = rpcMock.mock.calls.find(
      (c) => c[0] === "log_audit_event",
    );
    expect(call).toBeDefined();
    expect(call?.[1]).toMatchObject({
      p_action: "admin.access.via_env_email_fallback",
      p_entity_type: "user",
      p_entity_id: "u-breakglass",
      p_metadata: expect.objectContaining({
        admin_email: "breakglass@example.com",
        matched_user_email: "breakglass@example.com",
      }),
    });
  });

  it("does NOT emit the env-fallback audit when user_app_roles already grants admin (signal 1 short-circuits)", async () => {
    const { isAdminUser } = await loadAdminModule();
    // user_app_roles already has the admin row — env fallback never fires.
    userAppRolesMock.mockResolvedValue({
      data: [{ role: "admin" }],
      error: null,
    });

    const ok = await isAdminUser(
      makeSupabaseClient() as unknown as SupabaseClient,
      { id: "u-real-admin", email: "breakglass@example.com" },
    );

    expect(ok).toBe(true);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const envCall = rpcMock.mock.calls.find(
      (c) => c[1]?.p_action === "admin.access.via_env_email_fallback",
    );
    expect(envCall).toBeUndefined();
  });

  it("does NOT emit the env-fallback audit when profiles.is_admin grants (signal 2 short-circuits)", async () => {
    const { isAdminUser } = await loadAdminModule();
    profilesMock.mockResolvedValue({
      data: { is_admin: true },
      error: null,
    });

    const ok = await isAdminUser(
      makeSupabaseClient() as unknown as SupabaseClient,
      { id: "u-legacy-admin", email: "breakglass@example.com" },
    );

    expect(ok).toBe(true);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const envCall = rpcMock.mock.calls.find(
      (c) => c[1]?.p_action === "admin.access.via_env_email_fallback",
    );
    expect(envCall).toBeUndefined();
  });

  it("does NOT grant admin (and does NOT emit env-fallback audit) when email does not match ADMIN_EMAIL", async () => {
    const { isAdminUser } = await loadAdminModule();

    const ok = await isAdminUser(
      makeSupabaseClient() as unknown as SupabaseClient,
      { id: "u-other", email: "someone@else.com" },
    );

    expect(ok).toBe(false);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const envCall = rpcMock.mock.calls.find(
      (c) => c[1]?.p_action === "admin.access.via_env_email_fallback",
    );
    expect(envCall).toBeUndefined();
  });
});

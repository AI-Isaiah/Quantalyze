import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for POST /api/account/email (Phase 219 gap, GD-01/02/03/05a).
 *
 * The route verifies the CURRENT password on a throwaway supabase-js client
 * before it asks Auth to change the email, so every test here is about what
 * was NOT called as much as what was: a wrong password must send no link, a
 * limited request must never reach the password check, and the password must
 * reach no response and no log line.
 */

// withAuthLimited -> withAuth -> csrf/audit chains import "server-only".
vi.mock("server-only", () => ({}));

const USER_ID = "00000000-0000-4000-8000-0000000000aa";
const OLD_EMAIL = "old@quantalyze.test";
const NEW_EMAIL = "new@quantalyze.test";
const REDIRECT_TO =
  "http://localhost:3000/auth/callback?next=%2Fprofile%3Ftab%3Daccount%26email_change%3Dconfirmed";

type AuthErr = { code?: string; status?: number; message: string } | null;

const STATE = vi.hoisted(() => ({
  user: null as { id: string; email: string | null } | null,
  signInResult: { data: {}, error: null } as {
    data: unknown;
    error: { code?: string; status?: number; message: string } | null;
  },
  updateResult: {
    data: { user: { new_email: "new@quantalyze.test" } },
    error: null,
  } as { data: { user: { new_email: string | null } | null }; error: AuthErr },
  rpcResult: { data: true, error: null } as {
    data: unknown;
    error: { message: string } | null;
  },
  checkLimitResult: { success: true, retryAfter: 0 } as {
    success: boolean;
    retryAfter: number;
    reason?: string;
  },
  checkLimitCalls: [] as Array<{ key: string }>,
  verifierCreates: [] as Array<{
    url: string;
    key: string;
    options: { auth?: Record<string, unknown> } & Record<string, unknown>;
  }>,
  signInCalls: [] as Array<Record<string, unknown>>,
  signOutCalls: [] as Array<unknown[]>,
  updateCalls: [] as Array<unknown[]>,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  adminThrows: null as string | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: STATE.user }, error: null }),
      updateUser: async (...args: unknown[]) => {
        STATE.updateCalls.push(args);
        return STATE.updateResult;
      },
    },
  }),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (
    url: string,
    key: string,
    options: { auth?: Record<string, unknown> } & Record<string, unknown>,
  ) => {
    STATE.verifierCreates.push({ url, key, options });
    return {
      auth: {
        signInWithPassword: async (args: Record<string, unknown>) => {
          STATE.signInCalls.push(args);
          return STATE.signInResult;
        },
        signOut: async (...args: unknown[]) => {
          STATE.signOutCalls.push(args);
          return { error: null };
        },
      },
    };
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (STATE.adminThrows) throw new Error(STATE.adminThrows);
    return {
      rpc: async (name: string, args: Record<string, unknown>) => {
        STATE.rpcCalls.push({ name, args });
        return STATE.rpcResult;
      },
    };
  },
}));

vi.mock("@/lib/ratelimit", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/ratelimit")>("@/lib/ratelimit");
  return {
    userActionLimiter: null,
    checkLimit: async (_limiter: unknown, key: string) => {
      STATE.checkLimitCalls.push({ key });
      return STATE.checkLimitResult;
    },
    rateLimitDenyJson: actual.rateLimitDenyJson,
  };
});

import { POST } from "./route";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/account/email", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.quantalyze.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-tests");
  STATE.user = { id: USER_ID, email: OLD_EMAIL };
  STATE.signInResult = { data: {}, error: null };
  STATE.updateResult = {
    data: { user: { new_email: NEW_EMAIL } },
    error: null,
  };
  STATE.rpcResult = { data: true, error: null };
  STATE.checkLimitResult = { success: true, retryAfter: 0 };
  STATE.checkLimitCalls = [];
  STATE.verifierCreates = [];
  STATE.signInCalls = [];
  STATE.signOutCalls = [];
  STATE.updateCalls = [];
  STATE.rpcCalls = [];
  STATE.adminThrows = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/account/email (tracer)", () => {
  it("Test 1: correct password checks on a throwaway client, closes it locally, then sends the marker link", async () => {
    const res = await POST(
      makeRequest({ email: NEW_EMAIL, password: "correct-horse" }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, pending_email: NEW_EMAIL });

    expect(STATE.signInCalls).toEqual([
      { email: OLD_EMAIL, password: "correct-horse" },
    ]);
    // The verifier must not touch the user's own session: no persistence, no
    // refresh timer, no URL session detection (T-219-25).
    expect(STATE.verifierCreates).toHaveLength(1);
    expect(STATE.verifierCreates[0].options.auth).toEqual({
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    });
    // Local scope only: the default (global) scope would revoke the browser's
    // own session as well.
    expect(STATE.signOutCalls).toEqual([[{ scope: "local" }]]);
    expect(STATE.updateCalls).toEqual([
      [{ email: NEW_EMAIL }, { emailRedirectTo: REDIRECT_TO }],
    ]);
  });

  it("Test 2: wrong password answers 400 wrong_password and sends nothing", async () => {
    STATE.signInResult = {
      data: {},
      error: {
        code: "invalid_credentials",
        status: 400,
        message: "Invalid login credentials",
      },
    };
    STATE.rpcResult = { data: true, error: null };

    const res = await POST(
      makeRequest({ email: NEW_EMAIL, password: "wrong-horse" }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("wrong_password");
    // The gap's named proof: no link is sent on a wrong password.
    expect(STATE.updateCalls).toHaveLength(0);
    // No verifier session was created, so none is closed.
    expect(STATE.signOutCalls).toHaveLength(0);
  });

  it("Test 3: a limited request never reaches the password check", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 30 };

    const res = await POST(
      makeRequest({ email: NEW_EMAIL, password: "correct-horse" }),
    );

    expect(res.status).toBe(429);
    expect(STATE.checkLimitCalls).toEqual([{ key: `email_change:${USER_ID}` }]);
    expect(STATE.signInCalls).toHaveLength(0);
    expect(STATE.verifierCreates).toHaveLength(0);
    expect(STATE.updateCalls).toHaveLength(0);
  });

  it("Test 4: the verifier client is built per request, never at module scope", async () => {
    vi.resetModules();
    STATE.verifierCreates = [];
    const fresh = await import("./route");
    expect(STATE.verifierCreates).toHaveLength(0);

    const res = await fresh.POST(
      makeRequest({ email: NEW_EMAIL, password: "correct-horse" }),
    );
    expect(res.status).toBe(200);
    expect(STATE.verifierCreates).toHaveLength(1);
  });
});

const INVALID_CREDENTIALS = {
  code: "invalid_credentials",
  status: 400,
  message: "Invalid login credentials",
};

describe("POST /api/account/email (branches)", () => {
  it("Test 5: a password-less account is told to set a password, using only the getUser id", async () => {
    STATE.signInResult = { data: {}, error: INVALID_CREDENTIALS };
    STATE.rpcResult = { data: false, error: null };

    const res = await POST(
      makeRequest({
        email: NEW_EMAIL,
        password: "anything",
        // A body-supplied id must never steer the has-password question
        // (T-219-28: no probing of other users' password state).
        user_id: "00000000-0000-4000-8000-00000000ffff",
      }),
    );

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("password_not_set");
    expect(STATE.updateCalls).toHaveLength(0);
    expect(STATE.rpcCalls).toEqual([
      { name: "auth_user_has_password", args: { p_user_id: USER_ID } },
    ]);
  });

  it("Test 6: a failed or non-boolean has-password answer is a 502, never a wrong-password lie", async () => {
    STATE.signInResult = { data: {}, error: INVALID_CREDENTIALS };
    vi.spyOn(console, "error").mockImplementation(() => {});

    STATE.rpcResult = { data: null, error: { message: "rpc down" } };
    const errored = await POST(
      makeRequest({ email: NEW_EMAIL, password: "anything" }),
    );
    expect(errored.status).toBe(502);
    expect((await errored.json()).code).toBe("verify_unavailable");

    STATE.rpcResult = { data: null, error: null };
    const nonBoolean = await POST(
      makeRequest({ email: NEW_EMAIL, password: "anything" }),
    );
    expect(nonBoolean.status).toBe(502);
    expect((await nonBoolean.json()).code).toBe("verify_unavailable");

    expect(STATE.updateCalls).toHaveLength(0);
  });

  it("Test 7: a sign-in error other than invalid_credentials is a 502 and asks nothing else", async () => {
    STATE.signInResult = {
      data: {},
      error: {
        code: "over_request_rate_limit",
        status: 429,
        message: "rate limited",
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(
      makeRequest({ email: NEW_EMAIL, password: "anything" }),
    );

    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("verify_unavailable");
    expect(STATE.rpcCalls).toHaveLength(0);
    expect(STATE.updateCalls).toHaveLength(0);
  });

  it("Test 8: an account with no email skips the sign-in and lets the has-password answer decide", async () => {
    STATE.user = { id: USER_ID, email: null };
    STATE.rpcResult = { data: false, error: null };

    const res = await POST(
      makeRequest({ email: NEW_EMAIL, password: "anything" }),
    );

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("password_not_set");
    expect(STATE.signInCalls).toHaveLength(0);
    expect(STATE.verifierCreates).toHaveLength(0);
    expect(STATE.updateCalls).toHaveLength(0);
  });

  it("Test 9: the same address (trim, case-insensitive) is refused before any password check", async () => {
    const res = await POST(
      makeRequest({ email: "  OLD@quantalyze.test ", password: "anything" }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("same_address");
    // The wrapper's schema passed and the limiter ran; the same-address rule
    // is the handler's own.
    expect(STATE.checkLimitCalls).toHaveLength(1);
    expect(STATE.signInCalls).toHaveLength(0);
    expect(STATE.updateCalls).toHaveLength(0);
  });

  it("Test 10: a malformed body 400s without consuming a limiter token", async () => {
    const res = await POST(
      makeRequest({ email: "not-an-address", password: "x" }),
    );

    expect(res.status).toBe(400);
    expect(STATE.checkLimitCalls).toHaveLength(0);
    expect(STATE.signInCalls).toHaveLength(0);
  });

  it("Test 11: no session answers 401 and nothing else runs", async () => {
    STATE.user = null;

    const res = await POST(
      makeRequest({ email: NEW_EMAIL, password: "anything" }),
    );

    expect(res.status).toBe(401);
    expect(STATE.checkLimitCalls).toHaveLength(0);
    expect(STATE.signInCalls).toHaveLength(0);
    expect(STATE.rpcCalls).toHaveLength(0);
    expect(STATE.updateCalls).toHaveLength(0);
  });

  it("Test 12: an updateUser error is passed through, with a fallback for a blank message", async () => {
    STATE.updateResult = {
      data: { user: null },
      error: { message: "Email address already registered" },
    };
    const taken = await POST(
      makeRequest({ email: NEW_EMAIL, password: "correct-horse" }),
    );
    expect(taken.status).toBe(400);
    expect(await taken.json()).toEqual({
      code: "update_failed",
      error: "Email address already registered",
    });

    STATE.updateResult = {
      data: { user: null },
      error: { message: "   " },
    };
    const blank = await POST(
      makeRequest({ email: NEW_EMAIL, password: "correct-horse" }),
    );
    expect(blank.status).toBe(400);
    expect(await blank.json()).toEqual({
      code: "update_failed",
      error: "Could not send the confirmation link. Please try again.",
    });
  });

  it("Test 13: the password reaches no response body and no console call", async () => {
    const SECRET = "Zx9-distinctive-password-Qv7";
    const spies = (["error", "warn", "log", "info"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );

    const texts: string[] = [];
    const send = async (body: Record<string, unknown>) => {
      const res = await POST(makeRequest(body));
      texts.push(await res.text());
    };

    // wrong password
    STATE.signInResult = { data: {}, error: INVALID_CREDENTIALS };
    STATE.rpcResult = { data: true, error: null };
    await send({ email: NEW_EMAIL, password: SECRET });
    // password-less
    STATE.rpcResult = { data: false, error: null };
    await send({ email: NEW_EMAIL, password: SECRET });
    // 502 through the has-password RPC
    STATE.rpcResult = { data: null, error: { message: "rpc down" } };
    await send({ email: NEW_EMAIL, password: SECRET });
    // 502 through another sign-in error
    STATE.signInResult = {
      data: {},
      error: { code: "over_request_rate_limit", status: 429, message: "slow" },
    };
    await send({ email: NEW_EMAIL, password: SECRET });
    // malformed body (the password is valid, the email is not)
    await send({ email: "not-an-address", password: SECRET });
    // update_failed
    STATE.signInResult = { data: {}, error: null };
    STATE.updateResult = { data: { user: null }, error: { message: "boom" } };
    await send({ email: NEW_EMAIL, password: SECRET });

    expect(texts).toHaveLength(6);
    for (const text of texts) expect(text).not.toContain(SECRET);
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(call.map((a) => String(a)).join(" ")).not.toContain(SECRET);
      }
    }
    // The 502 paths did log, so the loop above is not vacuous.
    expect(spies[0].mock.calls.length).toBeGreaterThan(0);
  });

  it("Test 14: the 200, wrong_password and password_not_set answers are no-store", async () => {
    const ok = await POST(
      makeRequest({ email: NEW_EMAIL, password: "correct-horse" }),
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store");

    STATE.signInResult = { data: {}, error: INVALID_CREDENTIALS };
    STATE.rpcResult = { data: true, error: null };
    const wrong = await POST(
      makeRequest({ email: NEW_EMAIL, password: "wrong-horse" }),
    );
    expect(wrong.status).toBe(400);
    expect(wrong.headers.get("Cache-Control")).toBe("private, no-store");

    STATE.rpcResult = { data: false, error: null };
    const noPassword = await POST(
      makeRequest({ email: NEW_EMAIL, password: "anything" }),
    );
    expect(noPassword.status).toBe(409);
    expect(noPassword.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("POST /api/account/email (round 1 server fixes)", () => {
  // SFH-M2: a GoTrue 429 must reach the client as 429 (so it shows the
  // too-many-attempts text) and a GoTrue 5xx is an upstream failure (502).
  it("Test 15: an updateUser failure logs code and status only and maps 429 to 429, 5xx to 502, the rest to 400", async () => {
    const SECRET = "Zx9-distinctive-password-Qv7";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const cases: Array<[number | undefined, number]> = [
      [429, 429],
      [500, 502],
      [503, 502],
      [422, 400],
      [undefined, 400],
    ];
    for (const [gotrueStatus, expected] of cases) {
      STATE.updateResult = {
        data: { user: null },
        error: {
          code: "over_email_send_rate_limit",
          status: gotrueStatus,
          message: "email rate limit exceeded",
        },
      };
      const res = await POST(
        makeRequest({ email: NEW_EMAIL, password: SECRET }),
      );
      expect(res.status).toBe(expected);
      expect(await res.json()).toEqual({
        code: "update_failed",
        error: "email rate limit exceeded",
      });
    }

    expect(spy).toHaveBeenCalledWith(
      "[api/account/email] updateUser failed:",
      "over_email_send_rate_limit",
      429,
    );
    expect(spy).toHaveBeenCalledWith(
      "[api/account/email] updateUser failed:",
      "over_email_send_rate_limit",
      "no-status",
    );
    for (const call of spy.mock.calls) {
      expect(call.map((a) => String(a)).join(" ")).not.toContain(SECRET);
    }
  });

  // SFH-M3: createAdminClient() throws on a missing service-role key; that must
  // be the structured verify_unavailable 502, not an unstructured 500.
  it("Test 16: createAdminClient throwing on the has-password path is the structured 502", async () => {
    STATE.signInResult = { data: {}, error: INVALID_CREDENTIALS };
    STATE.adminThrows = "SUPABASE_SERVICE_ROLE_KEY is not set";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(
      makeRequest({ email: NEW_EMAIL, password: "anything" }),
    );

    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("verify_unavailable");
    expect(STATE.updateCalls).toHaveLength(0);
    expect(spy).toHaveBeenCalledWith(
      "[api/account/email] has-password check threw:",
      "SUPABASE_SERVICE_ROLE_KEY is not set",
    );
  });
});

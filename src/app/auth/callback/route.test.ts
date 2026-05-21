import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Coverage for /auth/callback — the production-signup email-confirm
 * landing route. Without this route the link in Supabase's confirmation
 * email 404s, so all four happy/sad paths plus the open-redirect guard
 * are asserted explicitly.
 */

vi.mock("server-only", () => ({}));

type AuthResult = { error: { message: string } | null };

const authState = vi.hoisted(() => ({
  exchangeResult: { error: null } as AuthResult,
  verifyResult: { error: null } as AuthResult,
  exchangeCalls: [] as string[],
  verifyCalls: [] as { type: string; token_hash: string }[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: async (code: string) => {
        authState.exchangeCalls.push(code);
        return authState.exchangeResult;
      },
      verifyOtp: async (params: { type: string; token_hash: string }) => {
        authState.verifyCalls.push(params);
        return authState.verifyResult;
      },
    },
  }),
}));

async function callGet(url: string) {
  const { GET } = await import("./route");
  return GET(new NextRequest(url, { method: "GET" }));
}

beforeEach(() => {
  authState.exchangeResult = { error: null };
  authState.verifyResult = { error: null };
  authState.exchangeCalls.length = 0;
  authState.verifyCalls.length = 0;
});

describe("GET /auth/callback", () => {
  it("redirects to /login with an error when no params are present", async () => {
    const res = await callGet("http://localhost:3000/auth/callback");

    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("error")).toBe("Missing verification parameters");
    // Neither verification path was attempted.
    expect(authState.exchangeCalls).toHaveLength(0);
    expect(authState.verifyCalls).toHaveLength(0);
  });

  it("exchanges PKCE code for session and redirects to /onboarding on success", async () => {
    const res = await callGet(
      "http://localhost:3000/auth/callback?code=pkce-abc",
    );

    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/onboarding");
    expect(loc.searchParams.get("error")).toBeNull();
    expect(authState.exchangeCalls).toEqual(["pkce-abc"]);
    expect(authState.verifyCalls).toHaveLength(0);
  });

  it("verifies OTP token_hash + type=signup and redirects on success", async () => {
    const res = await callGet(
      "http://localhost:3000/auth/callback?token_hash=hash-xyz&type=signup",
    );

    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/onboarding");
    expect(authState.verifyCalls).toEqual([
      { type: "signup", token_hash: "hash-xyz" },
    ]);
    expect(authState.exchangeCalls).toHaveLength(0);
  });

  it("honors the `next` param when it's a relative path", async () => {
    const res = await callGet(
      "http://localhost:3000/auth/callback?code=pkce-abc&next=/dashboard",
    );

    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/dashboard");
  });

  it("propagates auth error to /login on PKCE failure", async () => {
    authState.exchangeResult = { error: { message: "invalid grant" } };

    const res = await callGet(
      "http://localhost:3000/auth/callback?code=bad-code",
    );

    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("error")).toBe("invalid grant");
  });

  it("propagates auth error to /login on OTP failure", async () => {
    authState.verifyResult = { error: { message: "token expired" } };

    const res = await callGet(
      "http://localhost:3000/auth/callback?token_hash=h&type=recovery",
    );

    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("error")).toBe("token expired");
  });

  it("rejects unknown OTP `type` values without calling verifyOtp", async () => {
    const res = await callGet(
      "http://localhost:3000/auth/callback?token_hash=h&type=admin_takeover",
    );

    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("error")).toBe("Invalid verification type");
    expect(authState.verifyCalls).toHaveLength(0);
  });

  it("guards against open-redirect via absolute URL in `next`", async () => {
    const res = await callGet(
      "http://localhost:3000/auth/callback?code=pkce-abc&next=https://evil.example/phish",
    );

    const loc = new URL(res.headers.get("location")!);
    // Must NOT redirect to the attacker host.
    expect(loc.host).toBe("localhost:3000");
    expect(loc.pathname).toBe("/onboarding");
  });

  it("guards against protocol-relative open-redirect in `next`", async () => {
    const res = await callGet(
      "http://localhost:3000/auth/callback?code=pkce-abc&next=//evil.example/phish",
    );

    const loc = new URL(res.headers.get("location")!);
    expect(loc.host).toBe("localhost:3000");
    expect(loc.pathname).toBe("/onboarding");
  });
});

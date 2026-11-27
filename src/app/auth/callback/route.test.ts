import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Coverage for /auth/callback — the production-signup email-confirm
 * landing route. Without this route the link in Supabase's confirmation
 * email 404s, so all four happy/sad paths plus the open-redirect guard
 * are asserted explicitly.
 */

vi.mock("server-only", () => ({}));

type AuthResult = {
  error: { message: string; code?: string; status?: number } | null;
};

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

  // Phase 219 D-04: the email-change confirmation link carries
  // next=/profile?tab=account (encoded). safeNextPath must accept the decoded
  // value and the redirect must keep its query on BOTH verification branches.
  it("lands an encoded next=/profile?tab=account on the Account tab (PKCE code branch)", async () => {
    const res = await callGet(
      "http://localhost:3000/auth/callback?code=pkce-abc&next=%2Fprofile%3Ftab%3Daccount",
    );

    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/profile?tab=account",
    );
    expect(authState.exchangeCalls).toEqual(["pkce-abc"]);
  });

  it("lands an encoded next=/profile?tab=account on the Account tab (token_hash email_change branch)", async () => {
    const res = await callGet(
      "http://localhost:3000/auth/callback?token_hash=h&type=email_change&next=%2Fprofile%3Ftab%3Daccount",
    );

    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/profile?tab=account",
    );
    expect(authState.verifyCalls).toEqual([
      { type: "email_change", token_hash: "h" },
    ]);
    expect(authState.exchangeCalls).toHaveLength(0);
  });

  // Phase 219 MD-01: under "Secure email change" the first confirmation link
  // lands here with a `message` and neither `code` nor `token_hash`. That click
  // worked, so the user goes back to `next` with a marker, not to /login.
  it("sends a message-only callback (first email-change link) back to next with email_change=partial", async () => {
    const res = await callGet(
      "http://localhost:3000/auth/callback?message=Confirmation%20link%20accepted&next=%2Fprofile%3Ftab%3Daccount",
    );

    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/profile");
    expect(loc.searchParams.get("tab")).toBe("account");
    expect(loc.searchParams.get("email_change")).toBe("partial");
    expect(loc.searchParams.get("error")).toBeNull();
    // Nothing was verified, so no session exchange was attempted.
    expect(authState.exchangeCalls).toHaveLength(0);
    expect(authState.verifyCalls).toHaveLength(0);
  });

  it("keeps the open-redirect guard on the message-only branch", async () => {
    const res = await callGet(
      "http://localhost:3000/auth/callback?message=accepted&next=https://evil.example/phish",
    );

    const loc = new URL(res.headers.get("location")!);
    expect(loc.host).toBe("localhost:3000");
    expect(loc.pathname).toBe("/onboarding");
    expect(loc.searchParams.get("email_change")).toBe("partial");
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
      "http://localhost:3000/auth/callback?token_hash=h&type=signup",
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

  // audit-2026-05-07 specialist red-team HIGH — WHATWG URL parser strips
  // leading tab/LF/CR from path segments. The original guard checked the
  // raw string with startsWith("/") + startsWith("//"), missing the
  // `/<whitespace>//evil.example` shape because the literal string starts
  // with "/\t" but `new URL(...)` resolves it to `//evil.example`. Each
  // case below MUST fall back to /onboarding.
  it.each([
    ["%09", "tab"],
    ["%0a", "LF"],
    ["%0d", "CR"],
    ["%0d%0a", "CRLF"],
    ["%20", "space"],
  ])(
    "guards against open-redirect via leading-whitespace bypass (%s — %s)",
    async (encoded) => {
      const res = await callGet(
        `http://localhost:3000/auth/callback?code=pkce-abc&next=/${encoded}//evil.example/phish`,
      );
      const loc = new URL(res.headers.get("location")!);
      expect(loc.host).toBe("localhost:3000");
      expect(loc.pathname).toBe("/onboarding");
    },
  );
});

// Phase 219 GD-03: GoTrue's PKCE flow state lives only minutes, so the final
// email-change link can fail the code exchange (422 flow_state_expired) AFTER
// Auth already completed the change. Landing that click on /login made the
// proxy bounce the signed-in user to the role home page. The email_change=
// confirmed marker, carried inside the already-accepted `next`, sends it to
// the Account tab instead; every other failed exchange still lands on /login.
describe("GET /auth/callback — GD-03 failed exchange with the email-change marker", () => {
  const FLOW_EXPIRED = "invalid flow state, flow state has expired";
  const CALLBACK = "http://localhost:3000/auth/callback";

  it("A: a failed exchange with a marker-bearing next lands on the Account tab, not /login", async () => {
    authState.exchangeResult = { error: { message: FLOW_EXPIRED } };

    const res = await callGet(`${CALLBACK}?code=x&next=%2Fprofile%3Ftab%3Daccount%26email_change%3Dconfirmed`);

    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/profile");
    expect(loc.searchParams.get("tab")).toBe("account");
    expect(loc.searchParams.get("email_change")).toBe("confirmed");
    expect(loc.searchParams.get("error")).toBeNull();
  });

  it("B: a failed exchange without the marker still lands on /login with the Supabase message", async () => {
    authState.exchangeResult = { error: { message: FLOW_EXPIRED } };

    const res = await callGet(
      `${CALLBACK}?code=x&next=%2Fprofile%3Ftab%3Daccount`,
    );

    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("error")).toBe(FLOW_EXPIRED);
  });

  it("C: a successful exchange with a marker-bearing next keeps the marker intact", async () => {
    const res = await callGet(`${CALLBACK}?code=x&next=%2Fprofile%3Ftab%3Daccount%26email_change%3Dconfirmed`);

    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/profile");
    expect(loc.searchParams.get("tab")).toBe("account");
    expect(loc.searchParams.get("email_change")).toBe("confirmed");
  });

  // D: only a marker INSIDE the accepted next counts; a top-level parameter is
  // attacker-controlled link text the app never sends.
  it("D: a marker given only as a top-level parameter still lands on /login", async () => {
    authState.exchangeResult = { error: { message: FLOW_EXPIRED } };

    const res = await callGet(
      `${CALLBACK}?code=x&next=%2Fprofile%3Ftab%3Daccount&email_change=confirmed`,
    );

    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("error")).toBe(FLOW_EXPIRED);
  });

  // E: the marker never widens safeNextPath. A rejected off-site next falls
  // back to /onboarding, which carries no marker, so the failure goes to /login.
  it("E: a marker inside a next that safeNextPath rejects still lands on /login, never off-site", async () => {
    authState.exchangeResult = { error: { message: FLOW_EXPIRED } };

    const res = await callGet(
      `${CALLBACK}?code=x&next=%2F%2Fevil.example%2F%3Femail_change%3Dconfirmed`,
    );

    const loc = new URL(res.headers.get("location")!);
    expect(loc.host).toBe("localhost:3000");
    expect(loc.pathname).toBe("/login");
    expect(loc.pathname).not.toBe("/onboarding");
    expect(loc.searchParams.get("error")).toBe(FLOW_EXPIRED);
  });

  // F: only the exact value the app itself sends counts.
  it("F: a marker value other than confirmed still lands on /login", async () => {
    authState.exchangeResult = { error: { message: FLOW_EXPIRED } };

    const res = await callGet(
      `${CALLBACK}?code=x&next=%2Fprofile%3Ftab%3Daccount%26email_change%3Dpartial`,
    );

    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("error")).toBe(FLOW_EXPIRED);
  });

  // G: rollout window while Secure email change is still ON. The first link
  // arrives with a message and the new next (which carries confirmed); the
  // partial note must win, exactly one email_change value.
  it("G: the first-link branch replaces a confirmed marker in next with partial", async () => {
    const res = await callGet(
      `${CALLBACK}?message=Confirmation+link+accepted&next=%2Fprofile%3Ftab%3Daccount%26email_change%3Dconfirmed`,
    );

    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/profile");
    expect(loc.searchParams.get("tab")).toBe("account");
    expect(loc.searchParams.getAll("email_change")).toEqual(["partial"]);
  });
});

// Phase 219 GR1-MD-01: when GoTrue's /verify itself fails (expired, already used
// or scanner-consumed token) it redirects here with error params and no
// code/token_hash/message. /login would bounce a signed-in user to the role
// home; with the marker in the accepted next they land on the Account tab, with
// the marker removed so no success is claimed.
describe("GET /auth/callback — GR1-MD-01 GoTrue verify-error redirect", () => {
  const CALLBACK = "http://localhost:3000/auth/callback";
  const ERR =
    "error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";

  it("H: error params with the marker land on the Account tab without the marker", async () => {
    const res = await callGet(
      `${CALLBACK}?${ERR}&next=%2Fprofile%3Ftab%3Daccount%26email_change%3Dconfirmed`,
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/profile?tab=account",
    );
    expect(authState.exchangeCalls).toHaveLength(0);
    expect(authState.verifyCalls).toHaveLength(0);
  });

  it("I: error params without the marker keep the old /login landing", async () => {
    const res = await callGet(
      `${CALLBACK}?${ERR}&next=%2Fprofile%3Ftab%3Daccount`,
    );

    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("error")).toBe("Missing verification parameters");
  });

  it("J: error_code alone (no error) with the marker also lands on the Account tab", async () => {
    const res = await callGet(
      `${CALLBACK}?error_code=otp_expired&next=%2Fprofile%3Ftab%3Daccount%26email_change%3Dconfirmed`,
    );

    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/profile?tab=account",
    );
  });
});

// Phase 221 SENTRYSCRUB2 / SCRB-03: GR1-MD-01 lands a failed verify carrying the
// marker on the Account tab with no visible error, so the log line is the only
// trace of a run of expired or scanner-consumed email-change links. RESETFAILLOUD
// (701e4d9ca) added the line before that redirect, but only case Q pinned it, on
// a path without the marker. These cases pin it on the marker path.
describe("GET /auth/callback — SCRB-03 the marker-path verify error is logged", () => {
  const CALLBACK = "http://localhost:3000/auth/callback";
  const MARKER_NEXT = "next=%2Fprofile%3Ftab%3Daccount%26email_change%3Dconfirmed";
  const VERIFY_LINE = "[auth/callback] verify redirected with an error:";

  it("S: a failed email-change verify logs the code and error, never the description", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await callGet(
        `${CALLBACK}?error=access_denied&error_code=otp_expired&error_description=secret-desc&${MARKER_NEXT}`,
      );

      // Anti-vacuity: the marker branch ran, so the log is proven to fire on it.
      expect(res.headers.get("location")).toBe(
        "http://localhost:3000/profile?tab=account",
      );
      const verifyCalls = spy.mock.calls.filter((c) => c[0] === VERIFY_LINE);
      expect(verifyCalls).toHaveLength(1);
      expect(verifyCalls[0]).toEqual([VERIFY_LINE, "otp_expired", "access_denied"]);
      expect(JSON.stringify(spy.mock.calls)).not.toContain("secret-desc");
    } finally {
      spy.mockRestore();
    }
  });

  it("T: the logged error_code is cut to 64 characters", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // The slice bounds what an attacker-chosen query value can write into our logs.
      const res = await callGet(
        `${CALLBACK}?error_code=${"E".repeat(200)}&${MARKER_NEXT}`,
      );

      expect(res.headers.get("location")).toBe(
        "http://localhost:3000/profile?tab=account",
      );
      const verifyCalls = spy.mock.calls.filter((c) => c[0] === VERIFY_LINE);
      expect(verifyCalls).toHaveLength(1);
      expect(verifyCalls[0][1]).toBe("E".repeat(64));
      expect((verifyCalls[0][1] as string).length).toBe(64);
      expect(verifyCalls[0][2]).toBe("none");
    } finally {
      spy.mockRestore();
    }
  });
});

// Phase 219 SFH-M1: the marker path swallows the exchange error, so PROD logs
// could not tell an expected flow_state_expired from any other failure.
describe("GET /auth/callback — SFH-M1 marker-path exchange failure is logged", () => {
  it("K: logs code and status, never the PKCE code", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    authState.exchangeResult = {
      error: {
        message: "invalid flow state, flow state has expired",
        code: "flow_state_expired",
        status: 422,
      },
    };

    await callGet(
      "http://localhost:3000/auth/callback?code=secret-pkce-code&next=%2Fprofile%3Ftab%3Daccount%26email_change%3Dconfirmed",
    );

    expect(spy).toHaveBeenCalledWith(
      "[auth/callback] email-change exchange failed:",
      "flow_state_expired",
      422,
    );
    for (const call of spy.mock.calls) {
      expect(call.map((a) => String(a)).join(" ")).not.toContain(
        "secret-pkce-code",
      );
    }
    spy.mockRestore();
  });

  it("L: falls back to unknown / no-status when the error carries neither", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    authState.exchangeResult = { error: { message: "boom" } };

    await callGet(
      "http://localhost:3000/auth/callback?code=x&next=%2Fprofile%3Ftab%3Daccount%26email_change%3Dconfirmed",
    );

    expect(spy).toHaveBeenCalledWith(
      "[auth/callback] email-change exchange failed:",
      "unknown",
      "no-status",
    );
    spy.mockRestore();
  });
});

// PROD 2026-11-26 follow-up (F1): a failed password-recovery link used to land
// on /login?error=..., and /login does not read `error`, so the user saw a bare
// sign-in form and no word that the link had failed. A recovery link that
// cannot be verified must land on /reset-password?link=expired, which says so
// and offers a new link. Each failure branch also logs Auth's code and status.
describe("GET /auth/callback — a failed recovery link says so", () => {
  function expectExpiredLanding(res: Response) {
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/reset-password");
    expect(loc.searchParams.get("link")).toBe("expired");
  }

  it("K: a failed PKCE exchange with next=/reset-password lands on the expired-link card and logs code and status", async () => {
    authState.exchangeResult = {
      error: { message: "invalid flow state", code: "flow_state_not_found", status: 404 },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await callGet(
      "http://localhost:3000/auth/callback?code=spent-code&next=/reset-password",
    );
    expectExpiredLanding(res);
    expect(spy).toHaveBeenCalledWith(
      "[auth/callback] code exchange failed:",
      "flow_state_not_found",
      404,
    );
    expect(JSON.stringify(spy.mock.calls)).not.toContain("spent-code");
    spy.mockRestore();
  });

  it("L: a failed token_hash recovery lands on the expired-link card and logs code and status", async () => {
    authState.verifyResult = {
      error: { message: "token expired", code: "otp_expired", status: 403 },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await callGet(
      "http://localhost:3000/auth/callback?token_hash=old-hash&type=recovery&next=/reset-password",
    );
    expectExpiredLanding(res);
    expect(spy).toHaveBeenCalledWith(
      "[auth/callback] token_hash verification failed:",
      "otp_expired",
      403,
    );
    expect(JSON.stringify(spy.mock.calls)).not.toContain("old-hash");
    spy.mockRestore();
  });

  it("M: GoTrue's verify-error redirect for a recovery link lands on the expired-link card", async () => {
    const res = await callGet(
      "http://localhost:3000/auth/callback?error=access_denied&error_code=otp_expired&next=/reset-password",
    );
    expectExpiredLanding(res);
  });

  it("N: a failed PKCE exchange for a signup link still lands on /login and is logged", async () => {
    authState.exchangeResult = { error: { message: "invalid grant", status: 400 } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await callGet(
      "http://localhost:3000/auth/callback?code=bad&next=/pending-approval",
    );
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    expect(spy).toHaveBeenCalledWith(
      "[auth/callback] code exchange failed:",
      "unknown",
      400,
    );
    spy.mockRestore();
  });
});

// SFH round 2 (#1375): only a dead link (a 4xx) is "expired". Auth or the
// network failing (5xx, 429, no status) lands on ?link=error, which says to
// try again; and the error_code / error, invalid-type and missing-parameter
// branches all log, never error_description or any code, hash or token.
describe("GET /auth/callback — a transient recovery failure is not called expired", () => {
  it.each([[500], [503], [429], [undefined]])(
    "O: a PKCE recovery failure with status %s lands on ?link=error",
    async (status) => {
      authState.exchangeResult = { error: { message: "x", status } };
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await callGet("http://localhost:3000/auth/callback?code=c&next=/reset-password");
      expect(new URL(res.headers.get("location")!).searchParams.get("link")).toBe("error");
      spy.mockRestore();
    },
  );

  it("P: a token_hash recovery failure with a 5xx lands on ?link=error", async () => {
    authState.verifyResult = { error: { message: "x", status: 502 } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await callGet("http://localhost:3000/auth/callback?token_hash=h&type=recovery&next=/reset-password");
    expect(new URL(res.headers.get("location")!).searchParams.get("link")).toBe("error");
    spy.mockRestore();
  });

  it("Q: the verify-error branch logs error_code and error, never error_description", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await callGet("http://localhost:3000/auth/callback?error=access_denied&error_code=otp_expired&error_description=secret-desc&next=/pending-approval");
    expect(spy).toHaveBeenCalledWith("[auth/callback] verify redirected with an error:", "otp_expired", "access_denied");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret-desc");
    spy.mockRestore();
  });

  it("R: an invalid verification type and a missing-parameter callback both log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await callGet("http://localhost:3000/auth/callback?token_hash=secret-hash&type=bogus");
    expect(spy).toHaveBeenCalledWith("[auth/callback] invalid verification type:", "bogus");
    await callGet("http://localhost:3000/auth/callback");
    expect(spy).toHaveBeenCalledWith("[auth/callback] no code, token_hash, message or error");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret-hash");
    spy.mockRestore();
  });
});

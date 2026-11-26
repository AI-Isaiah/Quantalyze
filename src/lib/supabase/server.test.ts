/**
 * PROD 2026-11-26 follow-up (F2): setAll swallowed the "cookies can only be
 * modified in a Server Action or Route Handler" throw without a word. That is
 * how the /login Server Component's code exchange lost a password-reset
 * session silently. A skipped cookie write must be logged, by message only:
 * never a cookie name's value or a token.
 */
import { describe, it, expect, vi } from "vitest";

const thrown = vi.hoisted(() => ({
  error: new Error("Cookies can only be modified in a Server Action or Route Handler.") as Error,
}));

const captured = vi.hoisted(() => ({
  setAll: null as null | ((c: { name: string; value: string; options: object }[]) => void),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {
      throw thrown.error;
    },
  }),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: { cookies: { setAll: typeof captured.setAll } },
  ) => {
    captured.setAll = opts.cookies.setAll;
    return {};
  },
}));

import { createClient } from "./server";

// SFH round 2: Next's "Cookies can only be modified" throw is the expected
// Server Component case (the proxy refreshes the session), so it is a warning.
// Any other throw is a real failure and is logged at error with name and stack.
describe("server createClient setAll", () => {
  function write() {
    captured.setAll!([
      { name: "sb-ref-auth-token", value: "secret-session-value", options: {} },
    ]);
  }

  it("warns on Next's expected Server Component throw and does not log an error", async () => {
    thrown.error = new Error("Cookies can only be modified in a Server Action or Route Handler.");
    await createClient();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(write).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      "[supabase/server] cookie write skipped (Server Component context)",
    );
    expect(err).not.toHaveBeenCalled();
    warn.mockRestore();
    err.mockRestore();
  });

  it("logs any other throw at error with name and stack, never the cookie value", async () => {
    thrown.error = new TypeError("boom");
    await createClient();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(write).not.toThrow();
    expect(err).toHaveBeenCalledWith(
      "[supabase/server] cookie write failed:",
      "TypeError",
      expect.stringContaining("TypeError: boom"),
    );
    expect(JSON.stringify(err.mock.calls)).not.toContain("secret-session-value");
    err.mockRestore();
  });
});

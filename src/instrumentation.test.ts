import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { warnUnsetSoftSkipKeys, SOFT_SKIP_PROD_KEYS } from "./instrumentation";

/**
 * [#15] startup warn-loud for unset soft-skip prod keys. Intent: a missing key
 * that silently disables a prod feature (the RESEND_API_KEY founder-LP incident)
 * shows up in the deploy log instead of only when the feature fails to run —
 * and ONLY in production, and NEVER by crashing.
 */
describe("[#15] warnUnsetSoftSkipKeys", () => {
  const saved: Record<string, string | undefined> = {};
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    for (const k of [...SOFT_SKIP_PROD_KEYS, "VERCEL_ENV"]) saved[k] = process.env[k];
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    for (const k of [...SOFT_SKIP_PROD_KEYS, "VERCEL_ENV"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    warn.mockRestore();
  });

  it("stays silent outside production even with keys unset", () => {
    process.env.VERCEL_ENV = "preview";
    for (const k of SOFT_SKIP_PROD_KEYS) delete process.env[k];
    warnUnsetSoftSkipKeys();
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns in production listing exactly the unset keys", () => {
    process.env.VERCEL_ENV = "production";
    for (const k of SOFT_SKIP_PROD_KEYS) process.env[k] = "set";
    delete process.env.RESEND_API_KEY;
    warnUnsetSoftSkipKeys();
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain("RESEND_API_KEY");
    // a key that IS set must not be listed
    expect(msg).not.toContain("SENTRY_DSN");
  });

  it("stays silent in production when all soft-skip keys are set", () => {
    process.env.VERCEL_ENV = "production";
    for (const k of SOFT_SKIP_PROD_KEYS) process.env[k] = "set";
    warnUnsetSoftSkipKeys();
    expect(warn).not.toHaveBeenCalled();
  });
});

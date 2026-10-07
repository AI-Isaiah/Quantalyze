import { describe, it, expect, afterEach, vi } from "vitest";
import { getPlatformEmail, getPlatformName } from "./platform";

/**
 * D-12 (DOMAINONE, founder): there is NO sender fallback. A default that names
 * a domain we do not own spoofs that domain and is rejected by its DMARC
 * policy, so "unset" must read as `null` and callers must skip the send.
 */
describe("getPlatformEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the configured value, read at call time", () => {
    vi.stubEnv("PLATFORM_EMAIL", "ops@example.org");
    expect(getPlatformEmail()).toBe("ops@example.org");
    vi.stubEnv("PLATFORM_EMAIL", "later@example.org");
    expect(getPlatformEmail()).toBe("later@example.org");
  });

  it("trims surrounding whitespace", () => {
    vi.stubEnv("PLATFORM_EMAIL", "  ops@example.org \n");
    expect(getPlatformEmail()).toBe("ops@example.org");
  });

  it("returns null when unset: no invented sender", () => {
    vi.stubEnv("PLATFORM_EMAIL", undefined);
    expect(getPlatformEmail()).toBeNull();
  });

  it("returns null when blank or whitespace-only", () => {
    vi.stubEnv("PLATFORM_EMAIL", "");
    expect(getPlatformEmail()).toBeNull();
    vi.stubEnv("PLATFORM_EMAIL", "   ");
    expect(getPlatformEmail()).toBeNull();
  });
});

describe("getPlatformName", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to Quantalyze and honours a call-time override", () => {
    vi.stubEnv("PLATFORM_NAME", undefined);
    expect(getPlatformName()).toBe("Quantalyze");
    vi.stubEnv("PLATFORM_NAME", "Acme");
    expect(getPlatformName()).toBe("Acme");
  });
});

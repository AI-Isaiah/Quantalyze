/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  checkDebugKeyFlowRateLimit,
  __resetRateLimitState,
} from "./rate-limit";

describe("[OBSERV-07] checkDebugKeyFlowRateLimit", () => {
  beforeEach(() => __resetRateLimitState());

  it("first call allowed with remaining=4", () => {
    const r = checkDebugKeyFlowRateLimit("u1", 1_000_000);
    expect(r).toEqual({ allowed: true, remaining: 4 });
  });

  it("5 calls allowed; 6th rejected with retry_after_seconds positive", () => {
    for (let i = 1; i <= 5; i++) {
      expect(checkDebugKeyFlowRateLimit("u1", 1_000_000 + i).allowed).toBe(true);
    }
    const sixth = checkDebugKeyFlowRateLimit("u1", 1_000_000 + 6);
    expect(sixth.allowed).toBe(false);
    expect(sixth.remaining).toBe(0);
    expect(sixth.retry_after_seconds).toBeGreaterThan(0);
  });

  it("counters are per-user", () => {
    for (let i = 0; i < 5; i++) checkDebugKeyFlowRateLimit("u1", 1_000_000);
    expect(checkDebugKeyFlowRateLimit("u2", 1_000_000).allowed).toBe(true);
  });

  it("counter resets after 1 hour", () => {
    for (let i = 0; i < 5; i++) checkDebugKeyFlowRateLimit("u1", 1_000_000);
    expect(checkDebugKeyFlowRateLimit("u1", 1_000_000).allowed).toBe(false);
    expect(checkDebugKeyFlowRateLimit("u1", 1_000_000 + 60 * 60 * 1000).allowed).toBe(true);
  });
});

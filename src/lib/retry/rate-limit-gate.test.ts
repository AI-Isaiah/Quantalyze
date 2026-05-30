import { describe, it, expect } from "vitest";
import { RateLimitGate } from "./rate-limit-gate";

describe("RateLimitGate", () => {
  it("is open (0 remaining) before any block", () => {
    const g = new RateLimitGate();
    expect(g.remainingMs(1_000_000)).toBe(0);
  });

  it("reports the remaining window after blockUntil, and 0 once it has passed", () => {
    const g = new RateLimitGate();
    const now = 1_000_000;
    g.blockUntil(now + 2000);
    expect(g.remainingMs(now)).toBe(2000);
    expect(g.remainingMs(now + 1500)).toBe(500);
    expect(g.remainingMs(now + 2000)).toBe(0);
    expect(g.remainingMs(now + 5000)).toBe(0);
  });

  it("only moves FORWARD — an earlier window cannot shorten a later one (NEW-C05-07)", () => {
    const g = new RateLimitGate();
    const now = 1_000_000;
    g.blockUntil(now + 3000);
    g.blockUntil(now + 1000); // stale/earlier — must be ignored
    expect(g.remainingMs(now)).toBe(3000);
  });

  it("extends the window when a later block arrives", () => {
    const g = new RateLimitGate();
    const now = 1_000_000;
    g.blockUntil(now + 1000);
    g.blockUntil(now + 4000);
    expect(g.remainingMs(now)).toBe(4000);
  });
});

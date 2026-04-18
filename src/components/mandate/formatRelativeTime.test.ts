import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "./formatRelativeTime";

describe("formatRelativeTime", () => {
  const NOW = Date.UTC(2026, 3, 18, 12, 0, 0);

  it("returns 'Not saved yet' for null", () => {
    expect(formatRelativeTime(null, NOW)).toBe("Not saved yet");
  });

  it("'just now' for 0s delta", () => {
    expect(formatRelativeTime(NOW, NOW)).toBe("just now");
  });

  it("'just now' for < 60s", () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe("just now");
  });

  it("'1 min ago' at exact 60s boundary", () => {
    expect(formatRelativeTime(NOW - 60_000, NOW)).toBe("1 min ago");
  });

  it("'2 min ago' at 120s", () => {
    expect(formatRelativeTime(NOW - 120_000, NOW)).toBe("2 min ago");
  });

  it("'59 min ago' upper minute boundary", () => {
    expect(formatRelativeTime(NOW - 59 * 60_000, NOW)).toBe("59 min ago");
  });

  it("'1 hr ago' at exact 1hr boundary", () => {
    expect(formatRelativeTime(NOW - 60 * 60_000, NOW)).toBe("1 hr ago");
  });

  it("'23 hr ago' upper hour boundary", () => {
    expect(formatRelativeTime(NOW - 23 * 3_600_000, NOW)).toBe("23 hr ago");
  });

  it("returns absolute ISO date at >= 24 hours", () => {
    const result = formatRelativeTime(NOW - 24 * 3_600_000 - 1000, NOW);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("'just now' for future timestamps (defensive)", () => {
    expect(formatRelativeTime(NOW + 60_000, NOW)).toBe("just now");
  });

  it("accepts Date instance as input", () => {
    expect(formatRelativeTime(new Date(NOW), NOW)).toBe("just now");
  });
});

import { describe, it, expect } from "vitest";
import { displayStrategyName } from "./strategy-display";

describe("displayStrategyName", () => {
  it("returns codename when set (regardless of tier)", () => {
    expect(
      displayStrategyName({
        id: "abcdef1234567890",
        name: "Secret Alpha Fund",
        codename: "Strategy H-42",
        disclosure_tier: "exploratory",
      }),
    ).toBe("Strategy H-42");
  });

  it("returns name for institutional tier without codename", () => {
    expect(
      displayStrategyName({
        id: "abcdef1234567890",
        name: "Stellar Neutral Alpha",
        codename: null,
        disclosure_tier: "institutional",
      }),
    ).toBe("Stellar Neutral Alpha");
  });

  it("returns synthetic placeholder for exploratory tier without codename", () => {
    expect(
      displayStrategyName({
        id: "abcdef1234567890",
        name: "Secret Alpha Fund",
        codename: null,
        disclosure_tier: "exploratory",
      }),
    ).toBe("Strategy #abcdef12");
  });

  it("returns synthetic placeholder when name and codename are both null", () => {
    expect(
      displayStrategyName({
        id: "12345678abcdef90",
        name: null,
        codename: null,
        disclosure_tier: "exploratory",
      }),
    ).toBe("Strategy #12345678");
  });

  it("returns '(strategy)' for null input", () => {
    expect(displayStrategyName(null)).toBe("(strategy)");
  });

  it("returns '(strategy)' for undefined input", () => {
    expect(displayStrategyName(undefined)).toBe("(strategy)");
  });

  it("prefers codename over name even when tier is institutional", () => {
    expect(
      displayStrategyName({
        id: "abcdef1234567890",
        name: "Stellar Neutral Alpha",
        codename: "Strategy S-01",
        disclosure_tier: "institutional",
      }),
    ).toBe("Strategy S-01");
  });

  it("falls back to synthetic placeholder when disclosure_tier is null", () => {
    expect(
      displayStrategyName({
        id: "abcdef1234567890",
        name: "Legacy Strategy Row",
        codename: null,
        disclosure_tier: null,
      }),
    ).toBe("Strategy #abcdef12");
  });
});

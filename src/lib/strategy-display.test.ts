import { describe, it, expect } from "vitest";
import { displayStrategyName, publicNamePreview } from "./strategy-display";

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

  it("returns 'Unnamed strategy' for null input (a lookup miss, never an id)", () => {
    expect(displayStrategyName(null)).toBe("Unnamed strategy");
  });

  it("returns 'Unnamed strategy' for undefined input", () => {
    expect(displayStrategyName(undefined)).toBe("Unnamed strategy");
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

// Phase 200 / D-11 — what the rename place tells a manager the public sees.
// The oracle is typed here as literals; the factsheet title and the preview
// share one helper, so these cases pin the helper's three real-world shapes.
describe("publicNamePreview", () => {
  it("codename Orion: the factsheet shows the row's name, discovery shows the codename", () => {
    expect(
      publicNamePreview({
        id: "abcdef1234567890",
        name: "Helios alpha sleeve",
        codename: "Orion",
        disclosure_tier: "exploratory",
      }),
    ).toEqual({ factsheet: "Helios alpha sleeve", discovery: "Orion" });
  });

  it("institutional row without a codename: both surfaces show the name", () => {
    expect(
      publicNamePreview({
        id: "abcdef1234567890",
        name: "Stellar Neutral Alpha",
        codename: null,
        disclosure_tier: "institutional",
      }),
    ).toEqual({
      factsheet: "Stellar Neutral Alpha",
      discovery: "Stellar Neutral Alpha",
    });
  });

  it("exploratory row with no codename (PROD reality): discovery shows Strategy #<first 8 of id>", () => {
    expect(
      publicNamePreview({
        id: "abcdef1234567890",
        name: "Secret Alpha Fund",
        codename: null,
        disclosure_tier: "exploratory",
      }),
    ).toEqual({
      factsheet: "Secret Alpha Fund",
      discovery: "Strategy #abcdef12",
    });
  });

  it("a row with no name falls back through the codename, then the synthetic label", () => {
    expect(
      publicNamePreview({
        id: "abcdef1234567890",
        name: null,
        codename: "Orion",
        disclosure_tier: "exploratory",
      }).factsheet,
    ).toBe("Orion");
    expect(
      publicNamePreview({
        id: "abcdef1234567890",
        name: null,
        codename: null,
        disclosure_tier: "exploratory",
      }).factsheet,
    ).toBe("Strategy #abcdef12");
  });
});

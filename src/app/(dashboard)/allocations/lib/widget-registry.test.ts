import { describe, it, expect } from "vitest";
import {
  WIDGET_REGISTRY,
  DESIGNER_KEY_TO_WIDGET_ID,
  asRegistryWidgetId,
  resolveWidgetId,
} from "./widget-registry";

describe("asRegistryWidgetId — eager normalize-and-validate", () => {
  it("passes a real WIDGET_REGISTRY own-key through (branded)", () => {
    expect(asRegistryWidgetId("kpi-strip")).toBe("kpi-strip");
  });

  it("normalizes a designer short key ('bridge') to its canonical registry id", () => {
    const expected = DESIGNER_KEY_TO_WIDGET_ID["bridge"];
    expect(asRegistryWidgetId("bridge")).toBe(expected);
  });

  it("throws a descriptive error when the input is neither a registry id nor a short key", () => {
    expect(() => asRegistryWidgetId("not-a-real-widget")).toThrow(
      /not-a-real-widget/i,
    );
  });
});

describe("DESIGNER_KEY_TO_WIDGET_ID round-trip (pr-test-analyzer MED-3)", () => {
  it("every short key resolves to a registry own-key", () => {
    for (const [short, full] of Object.entries(DESIGNER_KEY_TO_WIDGET_ID)) {
      expect(resolveWidgetId(short)).toBe(full);
      expect(
        Object.prototype.hasOwnProperty.call(WIDGET_REGISTRY, full),
        `DESIGNER_KEY_TO_WIDGET_ID['${short}'] → '${full}' is not a WIDGET_REGISTRY own-key`,
      ).toBe(true);
    }
  });
});

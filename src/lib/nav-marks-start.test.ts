import { describe, it, expect, vi, afterEach } from "vitest";
import {
  MARKS_LABEL_TRACKING_EM,
  MARKS_SINCE_FLAG,
  MARKS_TRAILING_SINCE_FLAG,
  marksStartCaption,
  marksStartInRange,
  marksStartLabel,
  marksStartLabelRendered,
  marksStartSentenceOne,
  marksStartSentenceThree,
  marksStartSentenceTwo,
  marksTrailingNote,
  parseMarksStart,
  placeMarksStartLabel,
} from "./nav-marks-start";

/**
 * Phase 167.2.1.1.1 (NAVMTM) plan 10, D-08 / D-12 / L2: the one reader of the
 * published start-of-marks date, the visibility rule and the label placement
 * the two chart hosts share. The copy assertions quote the approved UI-SPEC
 * ("Copywriting Contract") so a reworded sentence fails here first.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseMarksStart - the one calendar rule, absent vs malformed", () => {
  it("absent (undefined, null) is null and silent: no marks yet is not a defect", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseMarksStart(undefined)).toBeNull();
    expect(parseMarksStart(null)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("a real YYYY-MM-DD calendar date passes through unchanged", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseMarksStart("2026-03-06")).toBe("2026-03-06");
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["an impossible day", "2026-02-30"],
    ["an unpadded date", "2026-3-6"],
    ["a number", 20260306],
    ["an object", {}],
    ["a timestamp", "2026-03-06T00:00:00Z"],
  ])("%s is null with exactly one reason-only warn that holds no input value", (_label, input) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseMarksStart(input)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const text = String(warn.mock.calls[0].join(" "));
    expect(text).not.toContain("2026");
    expect(text).not.toContain("20260306");
    expect(text).toContain("marks_since");
  });
});

describe("marksStartInRange - first < start <= last (UI-SPEC Visibility rule)", () => {
  const range = { first: "2026-01-01", last: "2026-03-10" };

  it("a start inside the range shows the note", () => {
    expect(marksStartInRange("2026-03-06", range)).toBe(true);
  });

  it("a start equal to the first drawn day hides it: no earlier day is drawn, so no step is on screen", () => {
    expect(marksStartInRange("2026-01-01", range)).toBe(false);
  });

  it("a start before the first drawn day hides it", () => {
    expect(marksStartInRange("2025-12-31", range)).toBe(false);
  });

  it("a start after the last drawn day hides it", () => {
    expect(marksStartInRange("2026-03-11", range)).toBe(false);
  });

  it("a start equal to the last drawn day shows it (the line sits at the right edge)", () => {
    expect(marksStartInRange("2026-03-10", range)).toBe(true);
  });
});

describe("the copy: UI-SPEC Copywriting Contract, verbatim, as functions of the formatted date", () => {
  const DATE = "Mar 6, 2026";

  it("the in-chart label and its rendered (uppercase) form", () => {
    expect(marksStartLabel(DATE)).toBe("Recorded equity from Mar 6, 2026");
    expect(marksStartLabelRendered(DATE)).toBe("RECORDED EQUITY FROM MAR 6, 2026");
  });

  it("S1, S2 and S3", () => {
    expect(marksStartSentenceOne(DATE)).toBe("Recorded equity, including unrealized P&L, begins on Mar 6, 2026.");
    expect(marksStartSentenceTwo()).toBe(
      "Earlier days are rebuilt from trade and balance history and can leave out unrealized P&L, so the curve may step on that day.",
    );
    expect(marksStartSentenceThree()).toBe(
      "An account whose recording began later may step on its own first recorded day.",
    );
  });

  it("the caption is S1 S2 on a single account and S1 S2 S3 on a multi-account chart", () => {
    expect(marksStartCaption(DATE, false)).toBe(`${marksStartSentenceOne(DATE)} ${marksStartSentenceTwo()}`);
    expect(marksStartCaption(DATE, true)).toBe(
      `${marksStartSentenceOne(DATE)} ${marksStartSentenceTwo()} ${marksStartSentenceThree()}`,
    );
  });

  it("never says mark-to-market: the factsheet's basis control owns that word", () => {
    const all = [marksStartLabel(DATE), marksStartCaption(DATE, true)].join(" ");
    expect(all).not.toMatch(/mark-to-market/i);
  });
});

describe("placeMarksStartLabel - right of the line, else left, else none; the tracked width is measured", () => {
  const RENDERED = marksStartLabelRendered("Mar 6, 2026"); // 32 characters
  const FONT = 10;
  /** Independent width oracle: Geist Mono advances 0.6 em, plus 0.05 em tracking per character. */
  const drawnWidth = (label: string, fontSize: number) => label.length * fontSize * 0.65;

  it("the tracking constant is the DESIGN.md tracking-wider step", () => {
    expect(MARKS_LABEL_TRACKING_EM).toBe(0.05);
  });

  it("start when the label fits to the right of the line", () => {
    const r = placeMarksStartLabel(100, RENDERED, FONT, 50, 850);
    expect(r).toEqual({ x: 104, textAnchor: "start" });
  });

  it("end when it does not fit to the right but fits to the left", () => {
    const r = placeMarksStartLabel(800, RENDERED, FONT, 50, 850);
    expect(r).toEqual({ x: 796, textAnchor: "end" });
  });

  it("null when it fits on neither side: no label, the line and caption stay", () => {
    expect(placeMarksStartLabel(150, RENDERED, FONT, 50, 250)).toBeNull();
  });

  it("every returned label box lies inside [plotLeft, plotRight]", () => {
    const geometries: [number, number, number][] = [
      [100, 50, 850],
      [800, 50, 850],
      [450, 50, 850],
      [60, 8, 400],
      [390, 8, 400],
    ];
    for (const [x, left, right] of geometries) {
      const r = placeMarksStartLabel(x, RENDERED, FONT, left, right);
      if (r === null) continue;
      const w = drawnWidth(RENDERED, FONT);
      const boxLeft = r.textAnchor === "start" ? r.x : r.x - w;
      const boxRight = r.textAnchor === "start" ? r.x + w : r.x;
      expect(boxLeft).toBeGreaterThanOrEqual(left - 1e-9);
      expect(boxRight).toBeLessThanOrEqual(right + 1e-9);
    }
  });

  it("measures the TRACKED width: a label that fits untracked but not tracked never returns start", () => {
    // Plot [0, 300], line at 90. Untracked width 32 * 10 * 0.6 = 192, so
    // 90 + 4 + 192 = 286 <= 300 would pass; tracked 208 gives 302 > 300.
    const r = placeMarksStartLabel(90, RENDERED, FONT, 0, 300);
    expect(r === null || r.textAnchor === "end").toBe(true);
    expect(r?.textAnchor).not.toBe("start");
  });

  it("at 12 px (My Allocation) the same rule holds: a 390 px plot with the line mid-plot draws no label", () => {
    // Plot about 260 px wide, the 12 px tracked label about 250 px.
    expect(placeMarksStartLabel(130, RENDERED, 12, 8, 268)).toBeNull();
  });
});

describe("MARKS_SINCE_FLAG", () => {
  it("is the published key the Python writer sets", () => {
    expect(MARKS_SINCE_FLAG).toBe("marks_since");
  });
});

describe("marksTrailingNote - SFH-2 N1: the words when marks stop updating", () => {
  it("says marks paused, from the formatted first day without a mark", () => {
    expect(marksTrailingNote("Mar 6, 2026")).toBe("Marks paused from Mar 6, 2026");
  });

  it("the published key is marks_trailing_since", () => {
    expect(MARKS_TRAILING_SINCE_FLAG).toBe("marks_trailing_since");
  });
});

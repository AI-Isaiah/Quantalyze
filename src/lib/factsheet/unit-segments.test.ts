import { describe, it, expect } from "vitest";
import {
  composeUnitSwitchSentence,
  parseUnitSegments,
  parseUnitSwitch,
  unitSwitchChipText,
  unitSwitchChipTitle,
  unitSwitchFigcaption,
  unitSwitchKpiNote,
  unitSwitchLeverageReason,
  unitSwitchMastheadLine,
  unitSwitchOgNote,
  unitSwitchUnpricedNote,
  unitSwitchWithheldNote,
  type UnitSwitchView,
} from "./unit-segments";
import { formatCloseDay } from "./returns-unit";

/**
 * Phase 256 OKXUNITSWITCH plan 05 — the parser reads a stored unit switch at the boundary and
 * the composer says it. The intent behind every arm: a switched factsheet names its two days
 * from the DERIVED data, and a value that is not a clean switch renders as a USD strategy
 * rather than as label text with a guessed day.
 */

const SW_RAW = { coin: "BTC", last_usd_day: "2026-11-14", first_coin_return_day: "2026-11-15" };
const SW = parseUnitSwitch(SW_RAW) as UnitSwitchView;

function segments(over: Record<string, unknown> = {}) {
  return {
    version: 1,
    segments: [
      {
        unit: "USD",
        from_day: "2026-11-01",
        to_day: "2026-11-14",
        returns: [
          { date: "2026-11-13", value: 0.01 },
          { date: "2026-11-14", value: -0.02 },
        ],
      },
      {
        unit: "BTC",
        base_day: "2026-11-14",
        from_day: "2026-11-15",
        to_day: "2026-11-16",
        returns: [
          { date: "2026-11-15", value: 0.005 },
          { date: "2026-11-16", value: 0.01 },
        ],
      },
    ],
    unpriced_days: [],
    ...over,
  };
}

describe("parseUnitSwitch", () => {
  it("reads the three stored keys into a view with USD as the stable unit", () => {
    expect(SW).toEqual({ fromUnit: "USD", toUnit: "BTC", lastFromDay: "2026-11-14", firstToDay: "2026-11-15" });
  });

  it.each([
    ["a lower-case coin", { ...SW_RAW, coin: "btc" }],
    ["USD as the coin (a switch into the unit it left)", { ...SW_RAW, coin: "USD" }],
    ["a one-letter coin", { ...SW_RAW, coin: "B" }],
    ["a non-string coin", { ...SW_RAW, coin: 5 }],
    ["a markup coin", { ...SW_RAW, coin: "BTC<script>" }],
    ["a day that is not a calendar day", { ...SW_RAW, last_usd_day: "2026-11-31" }],
    ["a yearless day", { ...SW_RAW, last_usd_day: "14 Nov" }],
    ["a first coin day two days after the last USD day", { ...SW_RAW, first_coin_return_day: "2026-11-16" }],
    ["a first coin day on the last USD day", { ...SW_RAW, first_coin_return_day: "2026-11-14" }],
    ["a first coin day before the last USD day", { ...SW_RAW, first_coin_return_day: "2026-11-13" }],
    ["a missing coin", { last_usd_day: "2026-11-14", first_coin_return_day: "2026-11-15" }],
    ["a missing last day", { coin: "BTC", first_coin_return_day: "2026-11-15" }],
    ["a missing first day", { coin: "BTC", last_usd_day: "2026-11-14" }],
    ["null", null],
    ["an array", [SW_RAW]],
    ["a string", "BTC"],
  ])("%s reads as absent", (_label, raw) => {
    expect(parseUnitSwitch(raw)).toBeNull();
  });

  it("accepts adjacency across a month and a year boundary", () => {
    expect(parseUnitSwitch({ coin: "ETH", last_usd_day: "2026-12-31", first_coin_return_day: "2027-01-01" })).not.toBeNull();
    expect(parseUnitSwitch({ coin: "ETH", last_usd_day: "2028-02-28", first_coin_return_day: "2028-02-29" })).not.toBeNull();
    expect(parseUnitSwitch({ coin: "ETH", last_usd_day: "2028-02-29", first_coin_return_day: "2028-03-01" })).not.toBeNull();
  });
});

describe("composeUnitSwitchSentence", () => {
  it("builds the founder's frame from the two derived days, through formatCloseDay", () => {
    expect(composeUnitSwitchSentence(SW)).toBe(
      `In USD to ${formatCloseDay("2026-11-14")}, in BTC from ${formatCloseDay("2026-11-15")}`,
    );
    // Pin the app-wide shape once, so the frame cannot drift to a yearless date unseen.
    expect(composeUnitSwitchSentence(SW).replace(/ /g, " ")).toBe("In USD to Nov 14, 2026, in BTC from Nov 15, 2026");
  });

  it("a second fixture renders its own dates (no day or unit is a literal)", () => {
    const other = parseUnitSwitch({ coin: "ETH", last_usd_day: "2026-10-02", first_coin_return_day: "2026-10-03" }) as UnitSwitchView;
    const s = composeUnitSwitchSentence(other).replace(/ /g, " ");
    expect(s).toBe("In USD to Oct 2, 2026, in ETH from Oct 3, 2026");
    expect(s).not.toContain("Nov");
    expect(s).not.toContain("BTC");
  });

  it("keeps each date on one line: the day, month and year are joined by U+00A0", () => {
    const s = composeUnitSwitchSentence(SW);
    expect(s).toContain(formatCloseDay("2026-11-14"));
    expect(formatCloseDay("2026-11-14")).toContain(" ");
  });
});

describe("parseUnitSegments", () => {
  it("returns the four fields for a well-formed object consistent with the switch", () => {
    const v = parseUnitSegments(segments({ unpriced_days: ["2026-11-16", "2026-11-16", "2026-11-15"] }), SW);
    expect(v).not.toBeNull();
    expect(v!.fromReturns).toHaveLength(2);
    expect(v!.toReturns).toHaveLength(2);
    expect(v!.baseDay).toBe("2026-11-14");
    // De-duplicated and sorted, so the unpriced count `m` is the count of distinct days.
    expect(v!.unpricedDays).toEqual(["2026-11-15", "2026-11-16"]);
  });

  it("R3-06: reads withheld_days apart from unpriced_days, and a record without the field reads as none", () => {
    const v = parseUnitSegments(segments({ withheld_days: ["2026-11-13", "2026-11-12", "2026-11-13"] }), SW);
    expect(v!.withheldDays).toEqual(["2026-11-12", "2026-11-13"]);
    expect(v!.unpricedDays).toEqual([]);
    expect(parseUnitSegments(segments(), SW)!.withheldDays).toEqual([]);
  });

  it.each([
    ["a non-array", "2026-11-13"],
    ["a malformed day", ["2026-11-31"]],
    ["a non-string day", [20261113]],
  ])("R3-06: withheld_days that is %s reads the record as absent", (_label, raw) => {
    expect(parseUnitSegments(segments({ withheld_days: raw }), SW)).toBeNull();
  });

  it("accepts a coin segment that holds only its base", () => {
    const s = segments();
    (s.segments[1] as { returns: unknown[] }).returns = [];
    const v = parseUnitSegments(s, SW);
    expect(v).not.toBeNull();
    expect(v!.toReturns).toEqual([]);
  });

  it.each([
    ["a non-object", "x"],
    ["null", null],
    ["a wrong version", segments({ version: 2 })],
    ["a missing version", (() => { const s = segments() as Record<string, unknown>; delete s.version; return s; })()],
    ["one segment only", segments({ segments: [segments().segments[0]] })],
    ["three segments", segments({ segments: [...segments().segments, segments().segments[1]] })],
    ["unpriced_days absent", (() => { const s = segments() as Record<string, unknown>; delete s.unpriced_days; return s; })()],
    ["a malformed unpriced day", segments({ unpriced_days: ["2026-11-31"] })],
    ["a non-string unpriced day", segments({ unpriced_days: [20261115] })],
  ])("%s reads as absent", (_label, raw) => {
    expect(parseUnitSegments(raw, SW)).toBeNull();
  });

  it.each([
    ["the USD segment ending on another day", (s: ReturnType<typeof segments>) => { (s.segments[0] as Record<string, unknown>).to_day = "2026-11-13"; }],
    ["the USD segment carrying a different unit", (s: ReturnType<typeof segments>) => { (s.segments[0] as Record<string, unknown>).unit = "EUR"; }],
    ["the coin segment in a different coin", (s: ReturnType<typeof segments>) => { (s.segments[1] as Record<string, unknown>).unit = "ETH"; }],
    ["the coin base on another day", (s: ReturnType<typeof segments>) => { (s.segments[1] as Record<string, unknown>).base_day = "2026-11-13"; }],
    ["the coin segment beginning on another day", (s: ReturnType<typeof segments>) => { (s.segments[1] as Record<string, unknown>).from_day = "2026-11-16"; }],
    ["a USD return dated after the last USD day", (s: ReturnType<typeof segments>) => { (s.segments[0] as { returns: unknown[] }).returns.push({ date: "2026-11-15", value: 0.1 }); }],
    ["a coin return dated before the first coin day", (s: ReturnType<typeof segments>) => { (s.segments[1] as { returns: unknown[] }).returns.unshift({ date: "2026-11-14", value: 0.1 }); }],
    ["a NaN value", (s: ReturnType<typeof segments>) => { (s.segments[1] as { returns: { value: number }[] }).returns[0].value = NaN; }],
    ["a null value", (s: ReturnType<typeof segments>) => { (s.segments[1] as { returns: { value: unknown }[] }).returns[0].value = null; }],
    ["a string value", (s: ReturnType<typeof segments>) => { (s.segments[0] as { returns: { value: unknown }[] }).returns[0].value = "0.01"; }],
    ["an out-of-order series", (s: ReturnType<typeof segments>) => { (s.segments[0] as { returns: unknown[] }).returns.reverse(); }],
    ["an empty USD series", (s: ReturnType<typeof segments>) => { (s.segments[0] as { returns: unknown[] }).returns = []; }],
  ])("segment days inconsistent with the switch: %s reads as absent", (_label, mutate) => {
    const s = segments();
    mutate(s);
    expect(parseUnitSegments(s, SW)).toBeNull();
  });

  it("reads against the switch it is given: the same sidecar is refused under another switch", () => {
    const other = parseUnitSwitch({ coin: "BTC", last_usd_day: "2026-11-15", first_coin_return_day: "2026-11-16" }) as UnitSwitchView;
    expect(parseUnitSegments(segments(), other)).toBeNull();
  });
});

describe("copy templates", () => {
  const D1 = formatCloseDay("2026-11-14");
  const D2 = formatCloseDay("2026-11-15");

  it("masthead line is the sentence and a full stop", () => {
    expect(unitSwitchMastheadLine(SW)).toBe(`In USD to ${D1}, in BTC from ${D2}.`);
  });

  it("KPI note says the figures are whole-record USD with the coin part converted at the stored daily close", () => {
    expect(unitSwitchKpiNote(SW)).toBe(
      `In USD to ${D1}, in BTC from ${D2}. These figures cover the whole record in USD, with the BTC part converted at the stored daily BTC close.`,
    );
  });

  it("names no quote pair on any template (UI-SPEC rule 7)", () => {
    const all = [
      unitSwitchKpiNote(SW),
      unitSwitchChipTitle(SW),
      unitSwitchLeverageReason(SW),
      unitSwitchOgNote(SW),
      unitSwitchFigcaption(SW, { comparatorActive: true }),
    ].join(" ");
    expect(all).not.toMatch(/BTC\/USD|BTC-USDT|BTCUSD/);
  });

  it("unpriced note agrees with the count: one day", () => {
    expect(unitSwitchUnpricedNote(SW, ["2026-11-16"])).toBe(
      `No BTC close for 1 day: ${formatCloseDay("2026-11-16")}. The USD figures leave that day out.`,
    );
  });

  it("unpriced note agrees with the count: several days, every run listed", () => {
    const note = unitSwitchUnpricedNote(SW, ["2026-11-16", "2026-11-17", "2026-11-20"]);
    expect(note).toContain("for 3 days:");
    expect(note).toContain("leave those days out.");
    expect(note).toContain(formatCloseDay("2026-11-20"));
  });

  it("unpriced note is empty with no day", () => {
    expect(unitSwitchUnpricedNote(SW, [])).toBe("");
  });

  it("R3-06: the withheld note names its own cause, never a missing close, and agrees with the count", () => {
    expect(unitSwitchWithheldNote(SW, ["2026-11-12"])).toBe(
      `No stored USD value for 1 day around the move into BTC: ${formatCloseDay("2026-11-12")}. The USD figures leave that day out.`,
    );
    const several = unitSwitchWithheldNote(SW, ["2026-11-12", "2026-11-13", "2026-11-20"]);
    expect(several).toContain("for 3 days around the move into BTC:");
    expect(several).toContain("leave those days out.");
    expect(several).not.toContain("close");
    expect(unitSwitchWithheldNote(SW, [])).toBe("");
  });

  it("figcaption carries the comparator clause only when a comparator is drawn, with the last USD day", () => {
    expect(unitSwitchFigcaption(SW, { comparatorActive: false })).not.toContain("comparator");
    const withCmp = unitSwitchFigcaption(SW, { comparatorActive: true });
    expect(withCmp).toContain(`The comparator is shown to ${D1}.`);
    expect(withCmp).toContain("starts again at 1.00×");
  });

  it("chip, leverage and share-card copy compose from the unit and the days", () => {
    expect(unitSwitchChipText(SW)).toBe("USD, then BTC");
    expect(unitSwitchChipTitle(SW)).toContain(`In USD to ${D1}`);
    expect(unitSwitchLeverageReason(SW)).toBe(
      "Leverage is off for this strategy: its USD figures include a part converted from BTC, so leverage would also lever BTC.",
    );
    expect(unitSwitchOgNote(SW)).toBe(`In USD to ${D1}, in BTC from ${D2}. Figures in USD.`);
  });

  it("the templates follow the coin: an ETH switch names no BTC", () => {
    const eth = parseUnitSwitch({ coin: "ETH", last_usd_day: "2026-10-02", first_coin_return_day: "2026-10-03" }) as UnitSwitchView;
    const all = [unitSwitchKpiNote(eth), unitSwitchChipText(eth), unitSwitchLeverageReason(eth), unitSwitchOgNote(eth)].join(" ");
    expect(all).toContain("ETH");
    expect(all).not.toContain("BTC");
  });
});

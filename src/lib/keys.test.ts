import { describe, it, expect, vi, afterEach } from "vitest";
import { holdingScopeKey, dateMapStrict } from "./keys";

describe("holdingScopeKey", () => {
  it("builds the canonical holding:venue:symbol:holding_type key", () => {
    expect(
      holdingScopeKey({ venue: "binance", symbol: "BTC", holding_type: "spot" }),
    ).toBe("holding:binance:BTC:spot");
  });

  it("distinguishes the same symbol across venues (NEW-C03-02: no multi-venue collapse)", () => {
    const a = holdingScopeKey({ venue: "binance", symbol: "BTC", holding_type: "spot" });
    const b = holdingScopeKey({ venue: "okx", symbol: "BTC", holding_type: "spot" });
    expect(a).not.toBe(b);
  });

  it("distinguishes spot from derivative on the same venue+symbol", () => {
    const spot = holdingScopeKey({ venue: "binance", symbol: "BTC", holding_type: "spot" });
    const deriv = holdingScopeKey({ venue: "binance", symbol: "BTC", holding_type: "derivative" });
    expect(spot).not.toBe(deriv);
  });
});

describe("dateMapStrict", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps distinct dates with no warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = dateMapStrict([
      { date: "2026-01-01", value: 1 },
      { date: "2026-01-02", value: 2 },
    ]);
    expect(m.get("2026-01-01")).toBe(1);
    expect(m.get("2026-01-02")).toBe(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once per duplicate date and keeps last-write-wins (NEW-C11-08)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = dateMapStrict(
      [
        { date: "2026-01-01", value: 1 },
        { date: "2026-01-01", value: 9 },
      ],
      "warn",
      "current",
    );
    expect(m.get("2026-01-01")).toBe(9); // last wins
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("2026-01-01"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("current"));
  });

  it("throws on a duplicate date in 'throw' mode", () => {
    expect(() =>
      dateMapStrict(
        [
          { date: "2026-01-01", value: 1 },
          { date: "2026-01-01", value: 2 },
        ],
        "throw",
      ),
    ).toThrow(/duplicate date/);
  });
});

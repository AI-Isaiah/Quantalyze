import { describe, it, expect } from "vitest";
import { venueOutageMessage } from "./venueOutageCopy";

describe("venueOutageMessage", () => {
  it("names the venue by its display name, not a capitalised wire code", () => {
    // `okx` capitalised by one character reads "Okx", a spelling no other
    // surface uses. The shared venue table writes it "OKX".
    expect(venueOutageMessage("okx")).toMatch(/^OKX isn't responding right now\./);
    expect(venueOutageMessage("sfox")).toMatch(/^sFOX isn't responding right now\./);
    expect(venueOutageMessage("mt5")).toMatch(/^MT5 isn't responding right now\./);
    expect(venueOutageMessage("binance")).toMatch(/^Binance isn't responding right now\./);
  });

  it("keeps the name of a slug outside the display table, capitalised", () => {
    expect(venueOutageMessage("mt5-gateway")).toMatch(
      /^Mt5-gateway isn't responding right now\./,
    );
  });

  it("names no venue when the wire carried none", () => {
    expect(venueOutageMessage(null)).toMatch(/^An exchange isn't responding right now\./);
  });
});

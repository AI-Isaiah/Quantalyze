import { describe, it, expect } from "vitest";
import { analyticsMissingMessage } from "./analyticsMissingMessage";

// Regression: /qa CSV report 2026-05-21 ISSUE-009. The
// analytics-missing placeholder on /strategy/[id] used to read
// "Analytics are being computed. Check back soon." for every
// strategy without a strategy_analytics row. That's a forever-
// stuck lie for csv_uploaded strategies — the CSV ingest path
// does not enqueue a compute job and no worker synthesizes
// analytics from raw CSV uploads at the moment. Now the message
// branches on trust_tier so a CSV-tier strategy renders honest
// copy.
describe("analyticsMissingMessage", () => {
  it("csv_uploaded strategies surface honest CSV-not-supported copy", () => {
    const msg = analyticsMissingMessage("csv_uploaded");
    expect(msg).toMatch(/uploaded as a daily-return CSV/i);
    expect(msg).toMatch(/not generated for CSV/i);
    // Critical: must NOT promise "check back soon" — that was the bug.
    expect(msg).not.toMatch(/check back soon/i);
    expect(msg).not.toMatch(/being computed/i);
  });

  it("api_verified strategies still surface 'being computed' (transient state)", () => {
    const msg = analyticsMissingMessage("api_verified");
    expect(msg).toMatch(/being computed/i);
    expect(msg).toMatch(/check back soon/i);
  });

  it("self_reported strategies fall through to the default 'being computed' copy", () => {
    const msg = analyticsMissingMessage("self_reported");
    expect(msg).toMatch(/being computed/i);
  });

  it("null trust_tier falls through to the default copy", () => {
    const msg = analyticsMissingMessage(null);
    expect(msg).toMatch(/being computed/i);
  });

  it("undefined trust_tier falls through to the default copy", () => {
    const msg = analyticsMissingMessage(undefined);
    expect(msg).toMatch(/being computed/i);
  });
});

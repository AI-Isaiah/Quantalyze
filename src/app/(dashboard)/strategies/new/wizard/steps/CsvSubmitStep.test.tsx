import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CsvSubmitStep } from "./CsvSubmitStep";
import type { MetadataDraft } from "./MetadataStep";

// Phase 19.1 — regression coverage for the wizard → csv-finalize wiring of
// `daily_returns_series`. Plan 09's first production E2E surfaced a missing
// thread: `csv_validator.py` emits the parsed series in the validate
// envelope, but the wizard dropped it on the floor and never forwarded it
// to csv-finalize, which then rejected the submit with CSV_INVALID_FORMAT
// "received 0 rows" (route.ts:748). These tests pin the contract that
// CsvSubmitStep's POST body includes the series for fmt=daily_returns and
// fmt=daily_nav, and stays clean (no key in the JSON body at all) for
// fmt=trades.

const META: MetadataDraft = {
  name: null,
  description: "regression: 19.1 daily_returns_series threading",
  categoryId: "cat_test",
  strategyTypes: ["systematic"],
  subtypes: [],
  markets: ["crypto"],
  supportedExchanges: ["Bybit"],
  leverageRange: "1x-3x",
  aum: "1000000",
  maxCapacity: "5000000",
  assetClass: "crypto",
};

const PREVIEW = {
  row_count: 3,
  date_range: ["2024-01-01", "2024-01-03"] as [string, string],
  columns_detected: ["date", "daily_return"],
  first_rows: [{ date: "2024-01-01", daily_return: 0.01 }],
  last_rows: [{ date: "2024-01-03", daily_return: -0.005 }],
};

const SERIES = [
  { date: "2024-01-01", daily_return: 0.01 },
  { date: "2024-01-02", daily_return: 0.002 },
  { date: "2024-01-03", daily_return: -0.005 },
];

function makeOkResponse() {
  return new Response(
    JSON.stringify({ strategy_id: "11111111-1111-1111-1111-111111111111", ok: true }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("CsvSubmitStep — Phase 19.1 daily_returns_series threading", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(makeOkResponse());
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("includes daily_returns_series in the csv-finalize POST body for fmt=daily_returns", async () => {
    const onSubmitted = vi.fn();
    render(
      <CsvSubmitStep
        wizardSessionId="22222222-2222-2222-2222-222222222222"
        fmt="daily_returns"
        strategyName="Phase 19.1 wiring test"
        preview={PREVIEW}
        dailyReturnsSeries={SERIES}
        metadata={META}
        onSubmitted={onSubmitted}
        onBack={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /submit strategy/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/strategies/csv-finalize");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.daily_returns_series).toEqual(SERIES);
    expect(body.fmt).toBe("daily_returns");
    expect(body.strategy_name).toBe("Phase 19.1 wiring test");
    expect(body.wizard_session_id).toBe("22222222-2222-2222-2222-222222222222");

    await waitFor(() =>
      expect(onSubmitted).toHaveBeenCalledWith(
        "11111111-1111-1111-1111-111111111111",
      ),
    );
  });

  it("includes daily_returns_series in the POST body for fmt=daily_nav", async () => {
    render(
      <CsvSubmitStep
        wizardSessionId="22222222-2222-2222-2222-222222222222"
        fmt="daily_nav"
        strategyName="NAV path"
        preview={PREVIEW}
        dailyReturnsSeries={SERIES}
        metadata={META}
        onSubmitted={() => {}}
        onBack={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /submit strategy/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.daily_returns_series).toEqual(SERIES);
    expect(body.fmt).toBe("daily_nav");
  });

  it("omits daily_returns_series from the POST body when the prop is undefined (fmt=trades)", async () => {
    render(
      <CsvSubmitStep
        wizardSessionId="22222222-2222-2222-2222-222222222222"
        fmt="trades"
        strategyName="Trades path"
        preview={PREVIEW}
        // dailyReturnsSeries deliberately undefined — csv_validator does
        // not emit it for fmt=trades, and csv-finalize must not see the
        // key in the body (parseDailyReturnsSeries treats undefined as
        // "no series" → empty rows → OK for trades fmt).
        metadata={META}
        onSubmitted={() => {}}
        onBack={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /submit strategy/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect("daily_returns_series" in body).toBe(false);
    expect(body.fmt).toBe("trades");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

// #597 part 2 — the deferred upload-picker persistence. CsvSubmitStep used to
// drop the wizard's asset_class picker value: the metadata object POSTed to
// csv-finalize carried every sibling classification field EXCEPT asset_class,
// so every CSV strategy silently landed with asset_class null (→ √252 default
// downstream) even when the user picked a track record they classified as
// crypto. These tests pin that the picker value now leaves the client verbatim
// on the CSV path — crypto stays crypto AND traditional stays traditional (the
// CSV branch has no exchange lock, so the choice is free; unlike the API-key
// path there is NO force-derive to 'crypto' here).
describe("CsvSubmitStep — #597 part 2 asset_class forwarding", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(makeOkResponse());
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("forwards metadata.asset_class = 'crypto' when the picker chose crypto", async () => {
    render(
      <CsvSubmitStep
        wizardSessionId="22222222-2222-2222-2222-222222222222"
        fmt="daily_returns"
        strategyName="crypto pick"
        preview={PREVIEW}
        dailyReturnsSeries={SERIES}
        metadata={{ ...META, assetClass: "crypto" }}
        onSubmitted={() => {}}
        onBack={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /submit strategy/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      metadata: Record<string, unknown>;
    };
    expect(body.metadata.asset_class).toBe("crypto");
  });

  it("forwards metadata.asset_class = 'traditional' verbatim (CSV keeps the user's choice — no force-crypto)", async () => {
    render(
      <CsvSubmitStep
        wizardSessionId="22222222-2222-2222-2222-222222222222"
        fmt="daily_returns"
        strategyName="traditional pick"
        preview={PREVIEW}
        dailyReturnsSeries={SERIES}
        metadata={{ ...META, assetClass: "traditional" }}
        onSubmitted={() => {}}
        onBack={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /submit strategy/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      metadata: Record<string, unknown>;
    };
    // The whole point of the CSV path: a legitimately traditional track record
    // must NOT be silently coerced to 'crypto'.
    expect(body.metadata.asset_class).toBe("traditional");
  });

  // Phase 110 / CONTRIB-02 — the csv-finalize POST body carries the
  // entry_context routing hint. Default mount (manager) sends "manager".
  it("sends entry_context='manager' in the csv-finalize body by default", async () => {
    render(
      <CsvSubmitStep
        wizardSessionId="22222222-2222-2222-2222-222222222222"
        fmt="daily_returns"
        strategyName="manager default"
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
    const body = JSON.parse(init.body as string) as { entry_context?: string };
    expect(body.entry_context).toBe("manager");
  });

  // Contribution mount → entry_context='contribution' (→ status='private')
  // plus allocator-framed copy: "Add to my strategies", no "Submit strategy".
  it("sends entry_context='contribution' and shows allocator copy when entryContext='contribution'", async () => {
    render(
      <CsvSubmitStep
        wizardSessionId="22222222-2222-2222-2222-222222222222"
        fmt="daily_returns"
        strategyName="allocator contribution"
        preview={PREVIEW}
        dailyReturnsSeries={SERIES}
        metadata={META}
        entryContext="contribution"
        onSubmitted={() => {}}
        onBack={() => {}}
      />,
    );

    // Allocator-framed CTA replaces the sell-side "Submit strategy" label.
    expect(
      screen.getByRole("button", { name: /add to my strategies/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /submit strategy/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("wizard-csv-submit-cta"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { entry_context?: string };
    expect(body.entry_context).toBe("contribution");
  });
});

/**
 * 146.2-07 / R6 — THE ECHO SENTENCE MUST REACH THE HUMAN IT WAS WRITTEN FOR.
 *
 * 146.1 / C1 attached `human_message` to the 23505 resolve echo: the founder-
 * chosen honesty sentence that states WHAT WAS COMPARED (row count, first and
 * last dates) and what was NOT (the individual daily values), and instructs the
 * user to open the strategy and check. The server said it. The client read
 * `human_message` on `!res.ok` ONLY — a 200 with `ok: true` went straight to
 * `onSubmitted`, which `WizardClient` hooks to `clearWizardState()` +
 * `router.push('/strategies')`. The sentence was computed, put on the wire, and
 * rendered NOWHERE. A mitigation nobody can read is not a mitigation.
 *
 * The two cases below are a pair on purpose: the echo case proves the sentence
 * arrives, and the FRESH case proves the new branch cannot leak into the
 * first-submit flow (which must stay byte-identical — it carries no
 * `human_message`, so it must still auto-continue).
 *
 * ── HAND-TYPED WIRE FIXTURES (independent oracles, never imported) ───────────
 * Both sentences below are re-typed from
 * `src/app/api/strategies/csv-finalize/route.ts` at HEAD and re-verified
 * 2026-08-19 (post-146.2-01). They are hand-typed rather than imported for the
 * reason `CsvSubmitStep.upstream-arm.test.tsx:44-45` gives: the assertion and
 * the implementation must be independent oracles. The provenance claim is a
 * CLAIM — W1 in this same plan exists because two constants carried that label
 * after the sentences they named had been re-cut, so if you move a route
 * sentence, move these WITH it and re-date this comment.
 */

/**
 * `csv-finalize/route.ts` — `resolveExistingCsvStrategy`'s default
 * `humanMessage` (the no-op / no-fill echo), verbatim, verified 2026-08-19.
 */
const ROUTE_ECHO_SENTENCE =
  "An earlier attempt in this wizard session had already saved this " +
  "strategy, so nothing new was written. We compared the saved track " +
  "record's row count and its first and last dates against this file — " +
  "not the individual daily values — so open the strategy to check it " +
  "holds the numbers you meant to upload.";

/**
 * `csv-finalize/route.ts` — `CLASSIFICATION_CONFLICT_MESSAGE`, the arm-specific
 * 409 sentence 146.2-01 added to the REFUSE arm, verbatim, verified 2026-08-19.
 */
const ROUTE_CLASSIFICATION_CONFLICT =
  "This wizard session already created a strategy with a different " +
  "classification, so we refused before writing anything of this submission. " +
  "Open the strategy you already started, or start a new strategy to upload " +
  "this file with the classification you want.";

const ECHOED_ID = "33333333-3333-4333-8333-333333333333";

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mountAndSubmit(onSubmitted: (id: string) => void) {
  render(
    <CsvSubmitStep
      wizardSessionId="22222222-2222-2222-2222-222222222222"
      fmt="daily_returns"
      strategyName="echo path"
      preview={PREVIEW}
      dailyReturnsSeries={SERIES}
      metadata={META}
      onSubmitted={onSubmitted}
      onBack={() => {}}
    />,
  );
  fireEvent.click(screen.getByTestId("wizard-csv-submit-cta"));
}

describe("CsvSubmitStep — 146.2-07 / R6 the echo sentence renders", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("⭐ ECHO: a 200 ok:true carrying human_message RENDERS the sentence and does NOT navigate", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(
        {
          ok: true,
          strategy_id: ECHOED_ID,
          status: "pending_review",
          human_message: ROUTE_ECHO_SENTENCE,
          correlation_id: "wizard:12121212-3434-4545-8656-767676767676",
        },
        200,
      ),
    );
    const onSubmitted = vi.fn();
    mountAndSubmit(onSubmitted);

    // The sentence itself, verbatim off the wire — no client editorialising.
    await screen.findByTestId("wizard-csv-echo-notice");
    expect(screen.getByText(ROUTE_ECHO_SENTENCE)).toBeInTheDocument();

    // …and the user is still HERE to read it. Auto-navigating would defeat the
    // sentence's own instruction ("open the strategy to check it holds the
    // numbers you meant to upload") by tearing the wizard down first.
    expect(
      onSubmitted,
      "the step navigated away on the very response whose copy asks the user " +
        "to stop and check — the sentence is spoken and never heard",
    ).not.toHaveBeenCalled();

    // ANTI-VACUITY: the assertion above passes trivially on a component that
    // stopped submitting at all. Continue must still complete the flow, once,
    // with the ECHOED id (not a fabricated one).
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("wizard-csv-echo-continue"));
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(onSubmitted).toHaveBeenCalledWith(ECHOED_ID);
  });

  it("CONTROL: a FRESH 200 (no human_message) auto-continues, exactly as before", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(
        {
          ok: true,
          strategy_id: ECHOED_ID,
          status: "pending_review",
          correlation_id: null,
        },
        200,
      ),
    );
    const onSubmitted = vi.fn();
    mountAndSubmit(onSubmitted);

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(ECHOED_ID));
    expect(
      screen.queryByTestId("wizard-csv-echo-notice"),
      "the echo branch leaked into the first-submit flow — a user who has " +
        "just created a strategy was told an earlier attempt had saved it",
    ).toBeNull();
  });

  it("⭐ REFUSE (146.2-01): the 409 classification-conflict sentence reaches the user and the step stays put", async () => {
    // 146.2-01 gave `refuse()` an arm-specific sentence. That envelope is
    // `ok: false` + `CSV_SESSION_REUSED`, so it lands on the ROUTE-VOCABULARY
    // branch and renders through the CSV panel — a user who is refused is told
    // why AND what to do next. Pinned here because the arm is new: nothing else
    // in this suite proves the plan-01 sentence survives the client.
    fetchSpy.mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: "CSV_SESSION_REUSED",
          human_message: ROUTE_CLASSIFICATION_CONFLICT,
          debug_context: { strategy_id: ECHOED_ID },
          correlation_id: null,
        },
        409,
      ),
    );
    const onSubmitted = vi.fn();
    mountAndSubmit(onSubmitted);

    await screen.findByTestId("wizard-csv-error");
    expect(screen.getByText(ROUTE_CLASSIFICATION_CONFLICT)).toBeInTheDocument();
    expect(onSubmitted).not.toHaveBeenCalled();
    // A refusal is not a success: the echo notice must NOT appear beside it.
    expect(screen.queryByTestId("wizard-csv-echo-notice")).toBeNull();
  });
});

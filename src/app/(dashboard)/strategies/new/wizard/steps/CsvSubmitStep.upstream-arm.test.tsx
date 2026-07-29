/** @vitest-environment jsdom */
/**
 * 140.5-05 / SEAMPROSE-08 — ⭐ THE **SECOND** OF THE TWO CSV WIZARD CLIENTS.
 *
 * ── WHY THIS FILE IS THE POINT OF THE PLAN ───────────────────────────────────
 *
 * `CsvUploadStep` is the client an author has in mind: it is where the live QA
 * pass reproduced the symptom, and a fix that stops there closes **1 of 2**.
 * `CsvSubmitStep` is the other one — measured at 0 references to
 * `recogniseSeamErrorCode` alongside its sibling — and closing only the first
 * is the 5-of-7 instance-not-class shape this milestone exists to stop. The
 * class guard in `seam-wire-vocabulary.invariant.test.ts` is what makes "both"
 * a held property rather than an intention; these cases are what make the
 * BEHAVIOUR true on this client specifically.
 *
 * ── WHAT `csv-finalize` PUTS ON THE WIRE THAT `csv-validate` DOES NOT ────────
 *
 * Its `!res.ok` population includes NESTED bodies whose code sits at
 * `detail.code` — the 424 from `process_key.py` and the per-key 429 from
 * `internal.py`. The old arm read `data.code` at the TOP level, so every one of
 * those resolved to nothing and fell to `CSV_SUBMIT_FAILED`, a code that says
 * *"We could not confirm whether your strategy was saved"* regardless of what
 * actually happened.
 *
 * ── THE NEGATIVE CONTROLS, AND WHY `CSV_PERSIST_FAIL` IS THE SHARPEST ────────
 *
 * §4a's copy asserts *"Nothing was saved."* This route's `CSV_PERSIST_FAIL`
 * emitter says, in the route's own words, *"Your strategy was created but the
 * daily-return data could not be saved."* Routing that code to §4a would print
 * a reassurance the route has just contradicted — a false statement about the
 * user's data, authored by the phase whose subject is false statements. The
 * control asserts the phrase is ABSENT, so "unreachable" is tested rather than
 * intended.
 *
 * `vi.spyOn` + `restoreAllMocks`, never `vi.stubGlobal` (DEF-16-1).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CsvSubmitStep } from "./CsvSubmitStep";
import type { MetadataDraft } from "./MetadataStep";
import { WIZARD_ERROR_COPY } from "@/lib/wizardErrors";
import { _resetWizardCorrelationIdForTests } from "@/lib/wizard/wizard-correlation";

// Hand-typed from the producers, never imported — the assertion and the
// implementation must be independent oracles.
const FOUNDER_TITLE = "We couldn't check your file just now.";
const FOUNDER_CAUSE = "This is on our side, not your data. Nothing was saved.";
/** The §4a clause that is affirmatively FALSE on the persist-fail arm. */
const NOTHING_WAS_SAVED = "Nothing was saved";

/** `csv-finalize/route.ts` — the 500 persist-fail emitter, verbatim. */
const ROUTE_PERSIST_FAIL =
  "Your strategy was created but the daily-return data could not be saved. " +
  "Contact support@quantalyze.com with your strategy id so we can recover.";
/** `csv-finalize/route.ts` — the 409 cross-submission refusal, verbatim. */
const ROUTE_SESSION_REUSED =
  "This strategy already holds a different track record, so we stopped before " +
  "writing. Nothing was changed. Start a new strategy to upload a different file.";
/** `csv-finalize/route.ts` — one of the twenty `CSV_INVALID_FORMAT` messages. */
const ROUTE_INVALID_FORMAT = "Invalid request body.";
/** `csv-finalize/route.ts` — the WR-07-shaped corrected misconfigured body. */
const ROUTE_MISCONFIGURED =
  "Our rate limiter is unavailable, so we stopped before submitting anything. " +
  "This is a fault on our side, not your file. Nothing was saved — try again in " +
  "a minute.";
/** `csv-finalize/route.ts` — the throttled body. */
const ROUTE_THROTTLED = "Too many requests. Wait a minute and try again.";

/** Generic `SEAM_MISCONFIGURED` clauses that are FALSE at this emitter. */
const FALSE_HERE_NOTHING_SUBMITTED = "Nothing was submitted";
const FALSE_HERE_NEVER_LEFT = "never left our servers";

const META: MetadataDraft = {
  name: null,
  description: "140.5-05 upstream-arm coverage",
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

function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function mountAndSubmit(): void {
  render(
    <CsvSubmitStep
      wizardSessionId="22222222-2222-2222-2222-222222222222"
      fmt="daily_returns"
      strategyName="Aurora Capital"
      preview={PREVIEW}
      dailyReturnsSeries={[{ date: "2024-01-01", daily_return: 0.01 }]}
      metadata={META}
      onSubmitted={() => {}}
      onBack={() => {}}
    />,
  );
  fireEvent.click(screen.getByTestId("wizard-csv-submit-cta"));
}

function panelText(): string {
  const shared = screen.queryByTestId("error-envelope");
  const csv = screen.queryByTestId("wizard-csv-error");
  return `${shared?.textContent ?? ""}\n${csv?.textContent ?? ""}`;
}

describe("[140.5-05] CsvSubmitStep — branches 2 and 3 on the SECOND client", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetWizardCorrelationIdForTests();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("a forwarded 401 with no top-level code renders the §4a copy with a rendered id", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: "Unauthorized" }, 401));
    mountAndSubmit();

    const panel = await screen.findByTestId("error-envelope");
    expect(screen.queryAllByText(FOUNDER_TITLE)).toHaveLength(1);
    expect(panel.textContent).toContain(FOUNDER_CAUSE);
    expect(panel.textContent).toMatch(/wizard:[0-9a-f-]{36}/);
    expect(panel.textContent).not.toContain("per-row breakdown");
  });

  it("⭐ a NESTED 424 (code at detail.code) is classified, not read as codeless", async () => {
    // The shape `process_key.py` forwards. The old top-level `data.code` read
    // saw `undefined` here and defaulted the whole family to CSV_SUBMIT_FAILED.
    fetchSpy.mockResolvedValue(
      jsonResponse(
        {
          detail: {
            code: "UPSTREAM_TIMEOUT",
            detail: "Analytics service timed out",
            dependency: "analytics",
            correlation_id: "wizard:99999999-8888-4777-8666-555555555555",
          },
        },
        424,
      ),
    );
    mountAndSubmit();

    const panel = await screen.findByTestId("error-envelope");
    // The wire table maps UPSTREAM_TIMEOUT → SERVICE_UNREACHABLE. The point is
    // that a NESTED code reaches the hop at all; the mapping itself is 140.5-02's.
    expect(panel.textContent).toContain(
      WIZARD_ERROR_COPY.SERVICE_UNREACHABLE.title,
    );
    expect(panel.textContent).toContain(
      "wizard:99999999-8888-4777-8666-555555555555",
    );
    expect(panel.textContent).not.toContain(FOUNDER_TITLE);
  });

  it("SC-CSV-4: a nested 429 carrying Retry-After renders the ADVERTISED WAIT on this client", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(
        { detail: { code: "RATE_LIMITED", detail: "per-key throttle" } },
        429,
        { "Retry-After": "45" },
      ),
    );
    mountAndSubmit();

    const panel = await screen.findByTestId("error-envelope");
    expect(panel.textContent).toContain(WIZARD_ERROR_COPY.RATE_LIMITED.title);
    expect(await screen.findByTestId("error-envelope-wait")).toHaveTextContent(
      "45s",
    );
  });

  it("TRAP-3: a second failure with no header does not inherit the first one's wait", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ detail: { code: "RATE_LIMITED", detail: "slow" } }, 429, {
        "Retry-After": "45",
      }),
    );
    mountAndSubmit();
    expect(await screen.findByTestId("error-envelope-wait")).toHaveTextContent(
      "45s",
    );

    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ detail: { code: "RATE_LIMITED", detail: "slow" } }, 429),
    );
    fireEvent.click(screen.getByTestId("wizard-csv-submit-cta"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByTestId("error-envelope-wait")).not.toBeInTheDocument(),
    );
  });
});

describe("[140.5-05] ⛔ NEGATIVE CONTROLS — csv-finalize's own vocabulary keeps its copy", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetWizardCorrelationIdForTests();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("⭐ CSV_PERSIST_FAIL keeps its own sentence, and 'Nothing was saved' is ABSENT", async () => {
    // The route says the strategy WAS created and the series was NOT saved.
    // §4a's reassurance is affirmatively false here, so it must be provably
    // unreachable — not merely un-routed.
    fetchSpy.mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: "CSV_PERSIST_FAIL",
          human_message: ROUTE_PERSIST_FAIL,
          debug_context: { strategy_id: "abc" },
          correlation_id: "wizard:12121212-3434-4545-8656-767676767676",
        },
        500,
      ),
    );
    mountAndSubmit();

    await screen.findByTestId("wizard-csv-error");
    expect(screen.getByText(ROUTE_PERSIST_FAIL)).toBeInTheDocument();
    expect(
      panelText(),
      "the panel told a user whose data was NOT saved that nothing was saved. " +
        "The route's own sentence says the strategy was created and the series " +
        "was lost; §4a's reassurance is false on this arm.",
    ).not.toContain(NOTHING_WAS_SAVED);
    expect(panelText()).not.toContain(FOUNDER_TITLE);
  });

  it("CSV_PERSIST_FAIL still leaves Submit DISABLED (the pre-existing retry fence)", async () => {
    // Not decoration: retrying a persist failure loops. The three-way arm must
    // not have quietly re-enabled the button by moving the code read.
    fetchSpy.mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: "CSV_PERSIST_FAIL",
          human_message: ROUTE_PERSIST_FAIL,
          debug_context: {},
          correlation_id: null,
        },
        500,
      ),
    );
    mountAndSubmit();

    await screen.findByTestId("wizard-csv-error");
    expect(screen.getByTestId("wizard-csv-submit-cta")).toBeDisabled();
  });

  it("CSV_SESSION_REUSED keeps the route's own sentence", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: "CSV_SESSION_REUSED",
          human_message: ROUTE_SESSION_REUSED,
          debug_context: {},
          correlation_id: null,
        },
        409,
      ),
    );
    mountAndSubmit();

    await screen.findByTestId("wizard-csv-error");
    expect(screen.getByText(ROUTE_SESSION_REUSED)).toBeInTheDocument();
    expect(panelText()).not.toContain(FOUNDER_TITLE);
  });

  it("CSV_INVALID_FORMAT (the ×20 emitter family) keeps the route's own sentence", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: "CSV_INVALID_FORMAT",
          human_message: ROUTE_INVALID_FORMAT,
          debug_context: {},
          correlation_id: null,
        },
        400,
      ),
    );
    mountAndSubmit();

    await screen.findByTestId("wizard-csv-error");
    expect(screen.getByText(ROUTE_INVALID_FORMAT)).toBeInTheDocument();
    expect(panelText()).not.toContain(FOUNDER_TITLE);
  });

  it("⭐ SEAM_MISCONFIGURED keeps this route's corrected sentence; the false generic clauses stay out", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: "SEAM_MISCONFIGURED",
          human_message: ROUTE_MISCONFIGURED,
          debug_context: {},
          correlation_id: null,
        },
        503,
      ),
    );
    mountAndSubmit();

    await screen.findByTestId("wizard-csv-error");
    expect(screen.getByText(ROUTE_MISCONFIGURED)).toBeInTheDocument();
    const text = panelText();
    expect(text).not.toContain(FALSE_HERE_NOTHING_SUBMITTED);
    expect(text).not.toContain(FALSE_HERE_NEVER_LEFT);
    expect(text).not.toContain(FOUNDER_TITLE);
  });

  it("CSV_RATE_LIMIT (429) hops to the shared envelope and renders its stamped wait", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: "CSV_RATE_LIMIT",
          human_message: ROUTE_THROTTLED,
          debug_context: {},
          correlation_id: null,
        },
        429,
        { "Retry-After": "60" },
      ),
    );
    mountAndSubmit();

    const panel = await screen.findByTestId("error-envelope");
    expect(panel.textContent).toContain(WIZARD_ERROR_COPY.RATE_LIMITED.title);
    expect(await screen.findByTestId("error-envelope-wait")).toHaveTextContent(
      "60s",
    );
    expect(panelText()).not.toContain(FOUNDER_TITLE);
  });

  it("POSITIVE CONTROL: the 409 idempotent-success path is untouched", async () => {
    // `res.status === 409 && data.ok === true` is a SUCCESS. A three-way arm
    // that forgot it would turn a completed submit into an error panel.
    const onSubmitted = vi.fn();
    fetchSpy.mockResolvedValue(
      jsonResponse(
        { ok: true, strategy_id: "11111111-1111-4111-8111-111111111111" },
        409,
      ),
    );
    render(
      <CsvSubmitStep
        wizardSessionId="22222222-2222-2222-2222-222222222222"
        fmt="daily_returns"
        strategyName="Idempotent"
        preview={PREVIEW}
        dailyReturnsSeries={[{ date: "2024-01-01", daily_return: 0.01 }]}
        metadata={META}
        onSubmitted={onSubmitted}
        onBack={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("wizard-csv-submit-cta"));

    await waitFor(() =>
      expect(onSubmitted).toHaveBeenCalledWith(
        "11111111-1111-4111-8111-111111111111",
      ),
    );
    expect(screen.queryByTestId("error-envelope")).not.toBeInTheDocument();
    expect(screen.queryByTestId("wizard-csv-error")).not.toBeInTheDocument();
  });
});

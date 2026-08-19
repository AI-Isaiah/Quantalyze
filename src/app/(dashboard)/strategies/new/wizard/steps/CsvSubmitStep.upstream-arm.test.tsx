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
 * emitter refuses to assert that. In the route's own words at HEAD (re-read
 * 2026-08-19 — see the W1 note on the fixtures below; the sentence quoted here
 * before 146.2-07 had been re-cut in 146.1 and no longer existed):
 * *"We could not confirm what is already saved for this strategy, so we
 * stopped before writing anything of this submission."* The scope is exact and
 * it is NARROWER than §4a's: nothing of THIS submission was written, and what
 * an earlier attempt may already have committed is precisely the thing the
 * route says it could not establish. Pasting *"Nothing was saved."* underneath
 * would assert, as a reassurance, the one fact the sentence above it declines
 * to claim. The control asserts the phrase is ABSENT, so "unreachable" is
 * tested rather than intended.
 *
 * (The pre-145 reading — strategy created, series lost, contact support — died
 * with `persist_csv_daily_returns`. The code's sole emitter is now the
 * fail-closed 503 in the 23505 resolve arm, which wrote NOTHING; that is also
 * why the sibling case below asserts Submit stays LIVE.)
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

/**
 * ⚠️ 146.2-07 / W1 — RE-TYPED FROM HEAD, AND WHY THE OLD PAIR WAS A LIE.
 *
 * The two constants below carried the label "verbatim" while naming sentences
 * that existed NOWHERE in `route.ts`: 146.1 re-cut both emitters and left the
 * fixtures behind. The cases stayed GREEN throughout — they mock the wire, so
 * any string round-trips — which is exactly what makes the defect worth a plan:
 * a false provenance claim is invisible to the suite and teaches the next
 * reader to trust it. Re-derived from `src/app/api/strategies/csv-finalize/
 * route.ts` at post-146.2-01 HEAD and re-verified 2026-08-19 by joining these
 * concatenations and diffing them against the route's own literals.
 *
 * Still HAND-TYPED, never imported (the :44-45 rule above): an imported
 * constant makes the assertion and the implementation the same oracle, and the
 * case would then pass on a route that had silently changed its copy. The cost
 * of that choice is precisely this drift — so if you move a route sentence,
 * move these WITH it and re-date this comment.
 *
 * ⛔ AND KNOW WHAT THE SUITE DOES **NOT** CHECK. Each constant is on BOTH sides
 * of its arm — it is the mocked wire AND the expected DOM — so altering a word
 * of it changes both and the suite stays GREEN (measured 2026-08-19 under the
 * 146.2-07 W1 neuter). What the arms enforce is the PAIRING: the panel renders
 * the sentence the ROUTE sent, not the copy table's title (proved by feeding the
 * mock a decoy — both arms then red by name). The correspondence to route.ts
 * is enforced by this comment and nothing else. A static grep coupling the two
 * files was weighed and declined here (see the 146.2-07 SUMMARY); if this pair
 * drifts a second time, that is the fix to reach for.
 */

/**
 * `csv-finalize/route.ts` — the CSV_PERSIST_FAIL emitter, verbatim. Post-145
 * this code has ONE emitter: the fail-closed 503 in the 23505 resolve arm's
 * `failClosed()` (route.ts:1099 at time of writing). The 500 persist-fail
 * emitter the old fixture quoted died with `persist_csv_daily_returns`.
 */
const ROUTE_PERSIST_FAIL =
  "We could not confirm what is already saved for this strategy, so we " +
  "stopped before writing anything of this submission. Try again shortly.";
/**
 * `csv-finalize/route.ts` — the DEFAULT 409 refusal literal in `refuse()`
 * (route.ts:1182), verbatim. 146.2-01 gave `refuse()` an optional
 * arm-specific sentence; this is the default the name / series / A2 arms still
 * carry, and it is byte-unchanged by that plan.
 */
const ROUTE_SESSION_REUSED =
  "This wizard session already created a strategy with a different track " +
  "record, so we refused before writing anything of this submission. Start " +
  "a new strategy to upload a different file.";
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
    // The route says it could not confirm what is already saved and that it
    // stopped before writing anything of THIS submission. §4a's flat "Nothing
    // was saved." asserts the very fact the route declined to assert, so it
    // must be provably unreachable — not merely un-routed.
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
      "the panel reassured a user that nothing was saved, on the one arm whose " +
        "own sentence says we could not confirm what is already saved. §4a " +
        "asserts as a fact what the route above it refuses to claim.",
    ).not.toContain(NOTHING_WAS_SAVED);
    expect(panelText()).not.toContain(FOUNDER_TITLE);
  });

  it("CSV_PERSIST_FAIL re-enables Submit (post-fold: fail-closed 503, nothing persisted)", async () => {
    // Phase 145 ship-review fix: the code's pre-fold meaning ("strategy exists,
    // series lost — retrying loops") died with persist_csv_daily_returns. Its
    // sole remaining emitter is the fail-closed resolve arm, which wrote
    // NOTHING and whose copy instructs "Try again shortly." — so the button
    // must be live beside that instruction. RED observed at the flip: the old
    // toBeDisabled assertion failed against the fixed fence (component-level
    // proof the fence edit binds).
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
    expect(screen.getByTestId("wizard-csv-submit-cta")).not.toBeDisabled();
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

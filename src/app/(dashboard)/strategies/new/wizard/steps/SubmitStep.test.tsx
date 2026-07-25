/** @vitest-environment jsdom */
/**
 * H-0193 — SubmitStep finalize-wizard error-code handling.
 *
 * The audit summary asserted SubmitStep hard-codes UNKNOWN on every non-2xx.
 * The actual code is more precise: it trusts data.code ONLY when it is a
 * known finalize code (KEY_SCOPE_BROADENED, KEY_NETWORK_TIMEOUT) and
 * otherwise maps to UNKNOWN, so a garbled response can't poison the
 * envelope. It also surfaces WIZARD_DUPLICATE on a 200 + idempotent return,
 * and maps a thrown fetch to KEY_NETWORK_TIMEOUT.
 *
 * These pin the real contract via the wizard_error telemetry `code`
 * dimension (the funnel-truth value):
 *   (a) known finalize code passes through,
 *   (b) an unknown/garbled code → UNKNOWN (poison guard),
 *   (c) WIZARD_DUPLICATE on a 200 surfaces the duplicate code,
 *   (d) 2xx success calls onSubmitted with no wizard_error.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SubmitStep } from "./SubmitStep";
import type { SyncPreviewSnapshot } from "./SyncPreviewStep";
import type { MetadataDraft } from "./MetadataStep";

const trackMock = vi.fn();
vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: (...args: unknown[]) => trackMock(...args),
}));

const SNAPSHOT: SyncPreviewSnapshot = {
  tradeCount: 120,
  csvRowCount: 0,
  earliestTradeAt: "2024-01-01T00:00:00Z",
  latestTradeAt: "2024-06-01T00:00:00Z",
  detectedMarkets: ["BTC", "ETH"],
  exchange: "binance",
  metrics: [{ label: "CAGR", value: "+12.0%" }],
  sparkline: [0.01, -0.02, 0.03],
  computedAt: "2024-06-01T00:00:00Z",
};

const METADATA: MetadataDraft = {
  name: "Aurora",
  description: "A directional crypto strategy.",
  categoryId: "cat-aaa",
  strategyTypes: ["Directional"],
  subtypes: [],
  markets: ["BTC"],
  supportedExchanges: ["Binance"],
  leverageRange: "1x-3x",
  aum: "1000000",
  maxCapacity: "5000000",
  assetClass: "crypto",
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderStep(onSubmitted = vi.fn()) {
  render(
    <SubmitStep
      strategyId="strat-1"
      wizardSessionId="session-1"
      snapshot={SNAPSHOT}
      metadata={METADATA}
      onSubmitted={onSubmitted}
      onBack={vi.fn()}
    />,
  );
  return onSubmitted;
}

function findWizardError(): { code: string; step: string } | undefined {
  const call = trackMock.mock.calls.find(
    (c) => (c as unknown[])[0] === "wizard_error",
  ) as unknown[] | undefined;
  return call ? (call[1] as { code: string; step: string }) : undefined;
}

describe("[H-0193] SubmitStep — finalize-wizard error mapping", () => {
  beforeEach(() => {
    trackMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes a known finalize code (KEY_SCOPE_BROADENED) through to telemetry", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ code: "KEY_SCOPE_BROADENED", error: "broadened" }, 409),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    const payload = findWizardError()!;
    expect(payload.code).toBe("KEY_SCOPE_BROADENED");
    expect(payload.step).toBe("submit");
  });

  it("maps an unknown/garbled server code to UNKNOWN (poison guard)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ code: "TOTALLY_MADE_UP", error: "weird" }, 500),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    expect(findWizardError()!.code).toBe("UNKNOWN");
  });

  it("surfaces WIZARD_DUPLICATE on a 200 + idempotent return", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        { strategy_id: "strat-1", code: "WIZARD_DUPLICATE", idempotent: true },
        200,
      ),
    );
    const onSubmitted = renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    expect(findWizardError()!.code).toBe("WIZARD_DUPLICATE");
    // A duplicate is NOT a successful submit — onSubmitted must not fire.
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  /**
   * Batch-D / D1c — F-7 WAS APPLIED SERVER-SIDE ONLY.
   *
   * ⚠️ THIS ASSERTION WAS INVERTED. It required `KEY_NETWORK_TIMEOUT`, whose
   * copy is "We could not reach the exchange … usually means a temporary
   * exchange issue". This POST goes to `/api/strategies/finalize-wizard` — OUR
   * route. A thrown `fetch` means we never reached OUR OWN service, so no
   * exchange was contacted and none could have been.
   *
   * F-7 established exactly this rule inside finalize-wizard's probe arm and
   * left the client's own catch block blaming the venue for our outage — which
   * also mis-buckets the incident in the `wizard_error` funnel.
   */
  it("D1c: a thrown fetch reports OUR outage, never the user's exchange", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    // No wizard_error telemetry on the catch path (only setErrorCode), so
    // assert the rendered envelope. The draft-saved outage copy is recoverable,
    // so the Retry affordance still renders.
    expect(
      await screen.findByText("We could not reach our service just now."),
    ).toBeInTheDocument();
    // THE assertion: no claim about the exchange, on a request that never left
    // our own perimeter.
    expect(
      screen.queryByText(/could not reach the exchange/i),
    ).not.toBeInTheDocument();
    // And it must not tell a user whose draft IS saved that it is not — the
    // C2 distinction between the two unavailable codes.
    expect(screen.queryByText(/has not been saved/i)).not.toBeInTheDocument();
    await screen.findByRole("button", { name: "Retry" });
    expect(findWizardError()).toBeUndefined();
    errSpy.mockRestore();
  });

  it("calls onSubmitted (no wizard_error) on a clean 2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ strategy_id: "strat-final", status: "pending_review" }, 200),
    );
    const onSubmitted = renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await vi.waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    expect(onSubmitted).toHaveBeenCalledWith("strat-final");
    expect(findWizardError()).toBeUndefined();
  });

  // Phase 110 / CONTRIB-02 — the finalize-wizard POST body carries the
  // entry_context routing hint. Default mount (manager) sends "manager".
  it("sends entry_context='manager' in the finalize body by default", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ strategy_id: "strat-1" }, 200));
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as { entry_context?: string };
    expect(body.entry_context).toBe("manager");
  });

  // Contribution mount → the finalize body sends entry_context='contribution'
  // (→ server finalizes status='private'). Contribution CTA copy is
  // "Add to my strategies", not "Submit for review".
  it("sends entry_context='contribution' and shows allocator copy when entryContext='contribution'", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ strategy_id: "strat-1", status: "private" }, 200));
    render(
      <SubmitStep
        strategyId="strat-1"
        wizardSessionId="session-1"
        snapshot={SNAPSHOT}
        metadata={METADATA}
        entryContext="contribution"
        onSubmitted={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    // Allocator-framed copy — no sell-side "Submit for review".
    expect(
      screen.getByRole("button", { name: "Add to my strategies" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Submit for review")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as { entry_context?: string };
    expect(body.entry_context).toBe("contribution");
  });

  // H-0192: the finalize route now tags its actionable failures with a
  // WizardErrorCode (404 -> GATE_DRAFT_GONE, 403 RLS -> GUARD_BLOCKED) and
  // SubmitStep maps off that code, NOT raw HTTP status. Pre-fix these collapsed
  // to UNKNOWN, blinding the founder (and the wizard_error funnel) to which
  // finalize gate fired.
  it("maps the route's GATE_DRAFT_GONE code (404 draft gone) through", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: "Draft not found", code: "GATE_DRAFT_GONE" }, 404),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));
    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    expect(findWizardError()!.code).toBe("GATE_DRAFT_GONE"); // pre-fix: UNKNOWN
  });

  it("maps the route's GUARD_BLOCKED code (403 cannot finalize) through", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        { error: "This draft cannot be finalized", code: "GUARD_BLOCKED" },
        403,
      ),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));
    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    expect(findWizardError()!.code).toBe("GUARD_BLOCKED"); // pre-fix: UNKNOWN
  });

  // RED-TEAM R2 regression guard: a pre-handler 403 (CSRF / approval-gate) has
  // NO finalize code. The OLD status-based mapping mislabeled it as
  // GUARD_BLOCKED ("draft cannot be finalized"); it must map to UNKNOWN so the
  // wizard_error funnel doesn't conflate approval/CSRF denials with draft-state
  // failures. (UNKNOWN is recoverable, so the Retry control still renders.)
  it("maps a code-less 403 (pre-handler CSRF/approval denial) to UNKNOWN, not GUARD_BLOCKED", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: "Forbidden" }, 403),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));
    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    expect(findWizardError()!.code).toBe("UNKNOWN");
  });

  // Phase 88 / W-4 (T-88-10): the finalize route fails CLOSED with a 503
  // { code: "COMPOSITE_MEMBERSHIP_UNKNOWN" } when it cannot determine composite
  // membership. That code must be a known finalize code so SubmitStep surfaces
  // its composite-specific, RECOVERABLE copy (with the Retry affordance) rather
  // than degrading to the generic UNKNOWN envelope. This test fails if the code
  // is dropped from the union / KNOWN_FINALIZE_CODES (it would map to UNKNOWN).
  it("maps the route's COMPOSITE_MEMBERSHIP_UNKNOWN code (503) to its composite-specific retry copy, not generic UNKNOWN", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          error: "Could not determine composite membership; please retry.",
          code: "COMPOSITE_MEMBERSHIP_UNKNOWN",
        },
        503,
      ),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    // Telemetry funnel-truth: the code passes through (pre-fix: UNKNOWN).
    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    expect(findWizardError()!.code).toBe("COMPOSITE_MEMBERSHIP_UNKNOWN");

    // The envelope renders the composite-specific title (from wizardErrors.ts),
    // NOT the generic UNKNOWN copy ("Something went wrong.").
    expect(
      screen.getByText("We couldn't confirm this strategy's key membership."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong.")).not.toBeInTheDocument();

    // Recoverable copy → the Retry affordance renders (clear_and_retry action).
    expect(
      await screen.findByRole("button", { name: "Retry" }),
    ).toBeInTheDocument();
  });

  /**
   * Phase 140 review (WR-01) — the breaker's whole user-facing benefit,
   * on the path that matters most.
   *
   * finalize-wizard's probe arm emitted `code: "CIRCUIT_OPEN"`, which is not a
   * WizardErrorCode and was not in the known-code set, so a breaker trip during
   * submit rendered UNKNOWN: "Something went wrong… our team has been notified"
   * — untrue (we know exactly what happened), un-actionable, and the precise
   * DOGFOOD-3 failure the new code exists to kill. The fix landed on 2 of 8
   * emitting paths; these pin the rest.
   */
  it("maps the SERVICE_UNAVAILABLE_RETRY wire code to the POST-SAVE outage copy, not the dead end and not the connect-step claim", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          error:
            "The analytics service is temporarily unavailable. Please try again in a moment.",
          code: "SERVICE_UNAVAILABLE_RETRY",
        },
        503,
      ),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    expect(findWizardError()!.code).toBe(
      "SERVICE_UNAVAILABLE_RETRY_DRAFT_SAVED",
    );
    expect(
      screen.getByText("We could not reach our service just now."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong.")).not.toBeInTheDocument();
    // C2 — SUBMIT is a POST-SAVE surface: `create-with-key` has already minted
    // the api_keys row and the draft strategies row, so the connect-step copy's
    // "Your key has not been saved and nothing was submitted" is FALSE here.
    // The wire code is deliberately unchanged (five routes emit it); what the
    // wizard RENDERS is what moves.
    expect(screen.queryByText(/has not been saved/i)).not.toBeInTheDocument();
    // Recoverable by definition — a Retry control must render.
    expect(
      await screen.findByRole("button", { name: "Retry" }),
    ).toBeInTheDocument();
  });

  it("aliases the shared seam envelope's legacy CIRCUIT_OPEN wire code onto the same copy", async () => {
    // finalize-wizard's ENQUEUE arm returns process-key-client's shared 503
    // envelope, which five routes consume and which still publishes
    // `CIRCUIT_OPEN`. That arm is reachable whenever the circuit opens between
    // the scope probe and the enqueue, so the wizard must not fall into the
    // dead end there either.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: "CIRCUIT_OPEN",
          human_message:
            "The analytics service is temporarily unavailable. Please try again in a moment.",
          recoverable: true,
        },
        503,
      ),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    // Funnel-truth: reported under the UNION member, so the wizard_error
    // dimension has ONE value for one condition rather than two spellings.
    expect(findWizardError()!.code).toBe(
      "SERVICE_UNAVAILABLE_RETRY_DRAFT_SAVED",
    );
    expect(
      screen.getByText("We could not reach our service just now."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong.")).not.toBeInTheDocument();
  });

  /**
   * Phase 140 review / F-3 — THE COMMON CASE, which CIRCUIT_OPEN is not.
   *
   * The breaker needs 5 failures inside 30s, unreachable at human retry
   * cadence, so a Railway outage at submit overwhelmingly arrives with the
   * circuit still CLOSED and `postProcessKey`'s own transport arms firing.
   * finalize-wizard's enqueue arm returns those envelopes VERBATIM
   * (`if (!result.ok) return result.response`), so before this fix the two
   * codes production actually emits during an outage both rendered the
   * "our team has been notified" dead end — with no Retry affordance, during
   * an outage where retrying shortly is exactly the right action.
   *
   * Driven with the EXACT envelopes process-key-client constructs, not a
   * paraphrase: the wire contract is the thing under test.
   */
  it.each([
    {
      label: "UPSTREAM_TIMEOUT (504, the deadline fired)",
      code: "UPSTREAM_TIMEOUT",
      human_message:
        "The ingestion service did not respond in time. Please try again.",
      status: 504,
    },
    {
      label: "UPSTREAM_NETWORK_ERROR (502, never reached upstream)",
      code: "UPSTREAM_NETWORK_ERROR",
      human_message: "Could not reach the ingestion service.",
      status: 502,
    },
  ])(
    "aliases $label onto the outage copy, not the dead end",
    async ({ code, human_message, status }) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse(
          { ok: false, code, human_message, recoverable: true },
          status,
        ),
      );
      renderStep();
      fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

      await vi.waitFor(() => expect(findWizardError()).toBeDefined());
      // Funnel-truth: ONE value for one condition, matching the breaker trip.
      expect(findWizardError()!.code).toBe(
      "SERVICE_UNAVAILABLE_RETRY_DRAFT_SAVED",
    );
      expect(
        screen.getByText("We could not reach our service just now."),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Something went wrong."),
      ).not.toBeInTheDocument();
      // The affordance that makes the outage recoverable for the user.
      expect(
        await screen.findByRole("button", { name: "Retry" }),
      ).toBeInTheDocument();
    },
  );

  it("maps COMPOSITE_TOO_MANY_MEMBERS (400 probe-cap refusal) to its remove-keys copy", async () => {
    // CR-01's deterministic degradation is only useful if the user can read it.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          error: "This strategy has too many keys to finalize in one request.",
          code: "COMPOSITE_TOO_MANY_MEMBERS",
        },
        400,
      ),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    expect(findWizardError()!.code).toBe("COMPOSITE_TOO_MANY_MEMBERS");
    expect(
      screen.getByText("This strategy has too many keys to submit at once."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong.")).not.toBeInTheDocument();
  });

  // A 409 stale-state ('draft_state_invalid' — not a WizardErrorCode) maps to
  // UNKNOWN, which is recoverable, so the legitimately-retryable refresh path
  // keeps its Retry button (RED-TEAM R1 regression guard).
  it("maps a 409 unknown code (draft_state_invalid) to UNKNOWN (recoverable)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        { error: "Refresh and try again.", code: "draft_state_invalid" },
        409,
      ),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));
    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    expect(findWizardError()!.code).toBe("UNKNOWN");
  });

  // UX-02 (#30) — the log-matching contract. Before the wizardFetch swap the
  // finalize-wizard request sent NO correlation header, so the id the user
  // copied out of the error envelope matched NOTHING the failing request logged.
  // Now every wizard fetch carries `X-Correlation-Id: wizard:<uuid>`, and the id
  // displayed in the envelope is THE SAME value — copy/paste joins client ↔
  // server logs ↔ Sentry ↔ compute_jobs.metadata. FAILS if SubmitStep reverts to
  // a bare fetch (header null → no /^wizard:/ match) or the displayed id ever
  // diverges from the sent one.
  it("sends X-Correlation-Id (wizard:) and the envelope shows the SAME id it sent", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        jsonResponse({ code: "TOTALLY_MADE_UP", error: "weird" }, 500),
      );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await vi.waitFor(() => expect(findWizardError()).toBeDefined());

    // The header actually sent on the finalize-wizard request.
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const sentId = new Headers(init.headers).get("X-Correlation-Id");
    expect(sentId).toMatch(/^wizard:[0-9a-f-]{36}$/);

    // The id rendered in the error-envelope diagnostics equals the sent header —
    // the copy/paste log-matching contract.
    expect(screen.getByText(sentId!)).toBeInTheDocument();
  });
});

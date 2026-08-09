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
import { SubmitStep, FIELD_BY_CODE } from "./SubmitStep";
import { WIZARD_ERROR_COPY, type WizardErrorCode } from "@/lib/wizardErrors";
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

  // ============================================================
  // Phase 140.3-05 / SEAMUX-01 + SEAMUX-08 — the breaker trip at finalize.
  //
  // `finalize-wizard` answers a breaker trip with the WIRE code
  // `CIRCUIT_OPEN` (its own live-permissions scope-probe arm, and
  // `process-key-client`'s forwarded 503). That is not a `WizardErrorCode`, so
  // it failed `KNOWN_FINALIZE_CODES` and became `"UNKNOWN"` — rendering
  // "Something went wrong. / We are not sure what happened. Our team has been
  // notified…" during a Railway outage, AND reporting
  // `wizard_error {code:"UNKNOWN"}` so the funnel could not tell an outage from
  // a bad draft. ONE line, three simultaneous failures (correction C-9).
  //
  // ⚠️ ORACLE INDEPENDENCE: every expected sentence below is a LITERAL typed in
  // this file. Reading `WIZARD_ERROR_COPY[code].title` on the expected side of
  // an `expect` would make the assertion agree with any reword, including a
  // reword back to the dead end (validation hazard #2).
  // ============================================================

  it("[140.3-05] a breaker trip (CIRCUIT_OPEN 503) renders the breaker's own copy, not UNKNOWN's", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: "CIRCUIT_OPEN",
          human_message:
            "The analytics service is temporarily unavailable. Please try again in a moment.",
          correlation_id: "corr-1",
          recoverable: true,
        },
        503,
      ),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    // SERVICE_UNAVAILABLE_RETRY's title, typed as a literal here.
    expect(
      await screen.findByText("Our service is temporarily unavailable."),
    ).toBeInTheDocument();
    // …and UNKNOWN's dead end is GONE. Both halves matter: asserting only the
    // presence of the new copy would still pass if both rendered.
    expect(screen.queryByText("Something went wrong.")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Our team has been notified/),
    ).not.toBeInTheDocument();
  });

  it("[140.3-05] the same breaker trip emits wizard_error with the specific code, not UNKNOWN", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: "CIRCUIT_OPEN",
          human_message:
            "The analytics service is temporarily unavailable. Please try again in a moment.",
          correlation_id: "corr-1",
          recoverable: true,
        },
        503,
      ),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    const payload = findWizardError()!;
    expect(payload.code).toBe("SERVICE_UNAVAILABLE_RETRY");
    expect(payload.code).not.toBe("UNKNOWN");
    expect(payload.step).toBe("submit");
  });

  // The two OTHER wire codes `process-key-client` forwards through
  // finalize-wizard. Fixing only `CIRCUIT_OPEN` and leaving these two on the
  // dead end is the instance-fix signature this programme keeps hitting: same
  // helper, same envelope, same line, same lie.
  it.each([
    ["UPSTREAM_TIMEOUT", 504],
    ["UPSTREAM_NETWORK_ERROR", 502],
  ])(
    "[140.3-05] a seam transport failure (%s) surfaces SERVICE_UNREACHABLE, not UNKNOWN",
    async (wireCode, status) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse(
          {
            ok: false,
            code: wireCode,
            human_message: "no answer",
            correlation_id: "corr-2",
            recoverable: true,
          },
          status,
        ),
      );
      renderStep();
      fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

      await vi.waitFor(() => expect(findWizardError()).toBeDefined());
      expect(findWizardError()!.code).toBe("SERVICE_UNREACHABLE");
      expect(
        await screen.findByText("We could not reach our own service."),
      ).toBeInTheDocument();
    },
  );

  // ANTI-REGRESSION CONTROL. The membership check is the reason a garbled or
  // hostile `code` cannot poison the envelope copy. Widening it to a bare cast
  // would be a regression dressed as a simplification, and this case is what
  // makes that visible — it must keep passing after the translation step above.
  it("[140.3-05] an unrecognised code still resolves to UNKNOWN — the membership check survives", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ code: "CIRCUIT_OPEN_BUT_NOT_REALLY", error: "weird" }, 503),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    expect(findWizardError()!.code).toBe("UNKNOWN");
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
   * ⚠️ 140.5-03 / SEAMPROSE-03 — RE-POINTED. This case used to be titled "maps
   * a thrown fetch to KEY_NETWORK_TIMEOUT" and asserted only that SOME Retry
   * button rendered, so it stayed green for any recoverable code — including
   * the wrong one it was named after.
   *
   * A rejected `wizardFetch` means the POST to `/api/strategies/finalize-wizard`
   * — our own route — never completed. `KEY_NETWORK_TIMEOUT`'s copy is "We
   * could not reach the exchange", a VENUE fault asserted for a fault on our
   * own hop. The code is now asserted by name and the old one negatively, so a
   * revert cannot pass.
   */
  it("maps a thrown fetch (our own hop failing) to SERVICE_UNREACHABLE, not the venue-fault code", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    const envelope = await screen.findByTestId("error-envelope");
    expect(envelope).toHaveAttribute("data-error-code", "SERVICE_UNREACHABLE");
    expect(envelope).not.toHaveAttribute(
      "data-error-code",
      "KEY_NETWORK_TIMEOUT",
    );
    // The copy the user reads, as a hand-typed literal rather than an import
    // of the table entry under test.
    expect(envelope).toHaveTextContent("We could not reach our own service.");
    expect(envelope).not.toHaveTextContent("We could not reach the exchange.");
    // Still recoverable, so the Retry affordance survives the code change —
    // SEAMUX-06 forbids a recoverable error with no way to act on it.
    await screen.findByRole("button", { name: "Retry" });
    // No wizard_error telemetry on this catch path (only setErrorCode).
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

  // ============================================================
  // Phase 140.3-14 / TS-37 — the composite MEMBER CAP, split off the code
  // above. The route emits `COMPOSITE_TOO_MANY_MEMBERS` on the same 503; this
  // set is the choke point every finalize code passes through, so a code the
  // route emits but this set does not admit falls straight to UNKNOWN and the
  // user sees the generic dead end instead of the limit and the remedy.
  //
  // ⚠️ ORACLE INDEPENDENCE: every expected sentence below is a LITERAL typed in
  // this file, never `WIZARD_ERROR_COPY[code].title`.
  // ============================================================

  it("[140.3-14] the cap code (503) reaches its OWN copy — the limit, its number, and the remedy", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          error:
            "This draft has more than 10 keys attached; a multi-key strategy can hold at most 10. Remove keys until 10 or fewer remain, then submit again.",
          code: "COMPOSITE_TOO_MANY_MEMBERS",
        },
        503,
      ),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    // Funnel truth: the code survives KNOWN_FINALIZE_CODES. Without the
    // same-commit membership edit this reads "UNKNOWN".
    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    expect(findWizardError()!.code).toBe("COMPOSITE_TOO_MANY_MEMBERS");
    expect(findWizardError()!.code).not.toBe("UNKNOWN");

    // The limit, named with its number.
    expect(
      await screen.findByText("This draft has more than 10 keys attached."),
    ).toBeInTheDocument();
    // The remedy.
    expect(
      screen.getByText(
        "Go back to the keys step and remove keys until 10 or fewer remain, then submit again.",
      ),
    ).toBeInTheDocument();

    // …and BOTH dead ends are gone. Asserting only the presence of the new copy
    // would still pass if the generic envelope rendered alongside it.
    expect(screen.queryByText("Something went wrong.")).not.toBeInTheDocument();
    expect(
      screen.queryByText("We couldn't confirm this strategy's key membership."),
    ).not.toBeInTheDocument();
  });

  it("[140.3-14] the cap code renders NO Retry control — retrying cannot clear a permanent condition", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        { error: "too many keys", code: "COMPOSITE_TOO_MANY_MEMBERS" },
        503,
      ),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    // POSITIVE first: the envelope really rendered. A step rendering NOTHING
    // would satisfy the absence assertion below vacuously — "no Retry appeared"
    // is also true when no error appeared at all.
    expect(
      await screen.findByText("This draft has more than 10 keys attached."),
    ).toBeInTheDocument();

    // …and only THEN the absence.
    expect(
      screen.queryByRole("button", { name: "Retry" }),
      "The permanent cap condition is still offering a Retry control. The " +
        "draft holds more keys than the route can re-probe; pressing Retry " +
        "produces the identical 503 forever.",
    ).not.toBeInTheDocument();
  });

  it("[140.3-14] ANTI-REGRESSION: a TRANSIENT membership failure still returns the old code AND still renders a retry", async () => {
    // ⚠️ THE CASE THAT CATCHES A FIX APPLIED TO THE WRONG ARM. Three of the
    // route's four `COMPOSITE_MEMBERSHIP_UNKNOWN` emissions are genuine
    // transient reads. Re-coding one of THEM — or removing the code from this
    // set — would strip a correct retry from a real transient fault, which is
    // the inverse of the defect the cap split fixes, and every assertion in the
    // two cases above would stay green.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          error: "Could not load composite members; please retry.",
          code: "COMPOSITE_MEMBERSHIP_UNKNOWN",
        },
        503,
      ),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    expect(findWizardError()!.code).toBe("COMPOSITE_MEMBERSHIP_UNKNOWN");
    expect(findWizardError()!.code).not.toBe("COMPOSITE_TOO_MANY_MEMBERS");
    expect(
      await screen.findByRole("button", { name: "Retry" }),
      "The transient membership failure lost its Retry control. The split was " +
        "applied to the wrong arm.",
    ).toBeInTheDocument();
  });

  // ⭐ 153.1-05 / WIZFORM-02 — THE FIRST OF THE TWO RESIDUALS, NOW CLOSED.
  //
  // This case used to send the LOWERCASE literal `draft_state_invalid` and
  // assert UNKNOWN, because that is what the route emitted and lowercase can
  // never be a `WizardErrorCode`. 153.1-05 uppercased the route's literal and
  // admitted `DRAFT_STATE_INVALID` to `KNOWN_FINALIZE_CODES` in the same
  // commit, so the 409 now renders its own honest copy.
  //
  // ⚠️ THIS DELIBERATELY REMOVES A RETRY CONTROL, and that is the fix rather
  // than a side effect. UNKNOWN's copy is recoverable, so the old resolution
  // rendered a Retry button that re-POSTed an IDENTICAL finalize request
  // against a draft the database had already moved out of a finalizable state.
  // The RPC raised the same 22023 and the user got the same card. Only a
  // reload can fix a stale page, which is why `DRAFT_STATE_INVALID`'s actions
  // are `leave_and_return` + `expand_log` and NOT `start_fresh` (that DELETES
  // the draft and cascades away every `strategy_keys` member under it — the
  // draft is fine here, it is the PAGE that is out of date).
  //
  // ⚠️ READ AS A PAIR with the case directly BELOW. These were the two codes
  // `finalize-wizard` could put in front of a user with no wizard member
  // behind them; 153.1-05 closed both, and the pair is kept so the next reader
  // finds them from either end.
  it("maps the 409 stale-draft arm to DRAFT_STATE_INVALID (no Retry — the page is stale, not the draft)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          // The body the route actually sends, read at source rather than
          // invented: `finalize-wizard/route.ts`, the SQLSTATE 22023 arm.
          code: "DRAFT_STATE_INVALID",
          error:
            "This draft is not in a finalizable state. Refresh and try again.",
        },
        409,
      ),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));
    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    expect(
      findWizardError()!.code,
      "The 409 stale-draft arm fell back to UNKNOWN. Either the route stopped " +
        "emitting DRAFT_STATE_INVALID or KNOWN_FINALIZE_CODES stopped " +
        "admitting it — and UNKNOWN's copy is RECOVERABLE, so the user gets a " +
        "Retry button that re-POSTs the identical request against a draft the " +
        "database has already moved past.",
    ).toBe("DRAFT_STATE_INVALID");
  });

  // The lowercase spelling must STILL resolve to UNKNOWN. 153.1-05 renamed the
  // route's literal; it did not create an identity rule, and an unrecognised
  // wire code has to keep falling through the membership check. Without this
  // the case above could be satisfied by a case-insensitive "fix".
  it("[153.1-05] the OLD lowercase literal is still an unrecognised code (no identity rule was created)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        { code: "draft_state_invalid", error: "Refresh and try again." },
        409,
      ),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));
    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    expect(findWizardError()!.code).toBe("UNKNOWN");
  });

  // ⭐ 153.1-05 / WIZFORM-02 — THE SECOND RESIDUAL, NOW CLOSED. Read as a pair
  // with the sibling directly ABOVE.
  //
  // ⚠️ THIS TEST DID ITS JOB, and the record of how is worth keeping. It used
  // to assert UNKNOWN behind a long failure message addressed to whoever
  // eventually admitted the code. 153.1-05 admitted it, this case reddened
  // unprompted, and its point 3 sent me to check TRAP-4 before proceeding.
  // That check is recorded here so the next reader does not have to repeat it:
  //
  //   · `DESTRUCTIVE_CONTROL_IS_WRONG_FOR` no longer exists anywhere in
  //     `src/` — the identifier that message names is stale.
  //   · The coupling it warns about is real but does not bind here. It fires
  //     when a NON-recoverable code renders no Retry and leaves
  //     'Try another key' -> handleDeleteDraft() as the sole affordance. That
  //     control comes from the `try_another_key` action, and NOT ONE of the
  //     eleven codes 153.1-05 admitted carries it (checked through
  //     `buildEnvelope`, not by reading the table's own `actions`).
  //     `COMPOSITE_UNSUPPORTED_UNIFIED` carries `request_call` + `expand_log`.
  //   · `SubmitStep.tsx` has no `handleDeleteDraft` and no destructive
  //     affordance at all; that control lives on `SyncPreviewStep`.
  //
  // ⚠️ The check is NOT retired for future admissions — a later plan admitting
  // a code whose copy carries `try_another_key` still owes it.
  it("[153.1-05] the unified-backbone 409 resolves to COMPOSITE_UNSUPPORTED_UNIFIED (residual closed)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          // The body the route actually sends — read at source in
          // `finalize-wizard/route.ts` (the unified-backbone 409 arm), not
          // invented here. Its keys are `code`-first since 153.1-05.
          code: "COMPOSITE_UNSUPPORTED_UNIFIED",
          error:
            "Composite (multi-key) strategies are not yet supported on this path.",
        },
        409,
      ),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));
    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    expect(
      findWizardError()!.code,
      "The unified-backbone 409 fell back to UNKNOWN, which collapses this arm " +
        "into every other unrecognised one in the `wizard_error` funnel and " +
        "shows the user the generic dead end. Either the route stopped " +
        "emitting COMPOSITE_UNSUPPORTED_UNIFIED or KNOWN_FINALIZE_CODES " +
        "stopped admitting it.",
    ).toBe("COMPOSITE_UNSUPPORTED_UNIFIED");
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

  // ============================================================
  // Phase 140.3-15 / TS-38 — OUR CONFIG FAULT, AT THE RENDER.
  //
  // `process-key-client` now answers a `SeamConfigError` with the wire code
  // `SEAM_MISCONFIGURED` (500) instead of `UPSTREAM_NETWORK_ERROR` (502), and
  // `finalize-wizard` forwards that envelope verbatim. `SEAM_MISCONFIGURED` is
  // a WIRE code that is ALSO a wizard member, so it must survive BOTH the
  // wire->wizard translation and this membership set — either one missing and
  // the user sees the generic dead end while every route-side test is green.
  // That is `140.3-14`'s M81, one plan ago, on a different code.
  //
  // ⚠️ ORACLE INDEPENDENCE: every expected sentence is a LITERAL typed here.
  // ============================================================

  it("[140.3-15 / TS-38] the config-fault code reaches its OWN copy, not the generic dead end", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: "SEAM_MISCONFIGURED",
          human_message:
            "We could not send this request \u2014 our own configuration is wrong. Retrying will not clear it.",
          recoverable: false,
        },
        500,
      ),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    expect(findWizardError()!.code).toBe("SEAM_MISCONFIGURED");
    expect(findWizardError()!.code).not.toBe("UNKNOWN");

    expect(
      await screen.findByText(
        "We could not send this request \u2014 our own configuration is wrong.",
      ),
    ).toBeInTheDocument();
    // Both dead ends are gone: asserting only the new copy would still pass if
    // the generic envelope rendered alongside it.
    expect(screen.queryByText("Something went wrong.")).not.toBeInTheDocument();
    expect(
      screen.queryByText("We could not reach our own service."),
    ).not.toBeInTheDocument();
  });

  it("[140.3-15 / TS-38] renders NO Retry control — a redeploy is the only thing that clears it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: false, code: "SEAM_MISCONFIGURED" }, 500),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    // POSITIVE first. "No Retry appeared" is also true when NOTHING appeared.
    expect(
      await screen.findByText(
        "We could not send this request \u2014 our own configuration is wrong.",
      ),
    ).toBeInTheDocument();

    expect(
      screen.queryByRole("button", { name: "Retry" }),
      "A configuration fault is permanent until we fix it and redeploy. A " +
        "Retry control here is a control that can never succeed.",
    ).not.toBeInTheDocument();
  });

  // ANTI-REGRESSION, one case PER wire code rather than a loop: the new member
  // sits beside these two in the SAME translation table and the SAME membership
  // set, and a sweep that re-pointed either would be invisible to the two cases
  // above. Separate cases so a failure names WHICH sibling was swallowed.
  it.each(["UPSTREAM_NETWORK_ERROR", "UPSTREAM_TIMEOUT"])(
    "[140.3-15 / TS-38] ANTI-REGRESSION: %s still renders its own recoverable copy",
    async (wireCode) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({ ok: false, code: wireCode }, 502),
      );
      renderStep();
      fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

      expect(
        await screen.findByText("We could not reach our own service."),
      ).toBeInTheDocument();
      expect(
        await screen.findByRole("button", { name: "Retry" }),
        "A genuine transport failure lost its Retry control \u2014 the config-fault " +
          "arm swallowed a sibling.",
      ).toBeInTheDocument();
    },
  );

  // ============================================================
  // Phase 140.3-15 / TS-20 — THE RELOCATED DIAGNOSTIC REACHES THE RENDER.
  //
  // `140.1-04` moved the diagnostic OUT of the seam body — it had been leaking
  // raw exception text including table names, row payloads and DSNs — and
  // replaced it with `correlation_id`. `finalize-wizard` forwards the seam
  // envelope VERBATIM, so that id arrives in this component's hands; until now
  // nothing read it and the envelope showed only the browser's own per-page-load
  // id, which appears in no server log.
  //
  // \u26a0\ufe0f THESE ARE POSITIVE IDENTITY ASSERTIONS, DELIBERATELY.
  // `140.3-11`'s M77c proved that a carry through this seam is invisible to a
  // `toBeNull()` / `toBeDefined()` oracle: a DELETED carry and a CORRECTLY-ABSENT
  // value both produce the same answer, and the entire 3163-test repo could not
  // see the difference. So each case names the EXACT id that must appear AND
  // asserts the local id it must have displaced.
  // ============================================================

  it("[140.3-15 / TS-20] the UPSTREAM correlation_id renders — not the browser's own", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: "SEAM_MISCONFIGURED",
          correlation_id: "upstream-7f3c1a20-9d44-4b21-8e77-2c5a11d0e6b3",
        },
        500,
      ),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));
    await vi.waitFor(() => expect(findWizardError()).toBeDefined());

    // POSITIVE: the id the SERVER sent is the one on screen.
    expect(
      await screen.findByText("upstream-7f3c1a20-9d44-4b21-8e77-2c5a11d0e6b3"),
    ).toBeInTheDocument();

    // ...and it DISPLACED the browser's per-page-load id. Without this half a
    // deleted carry passes: the local id would still render and the case would
    // only be asserting that some id exists.
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const localId = new Headers(init.headers).get("X-Correlation-Id");
    expect(localId).toMatch(/^wizard:[0-9a-f-]{36}$/);
    expect(
      screen.queryByText(localId!),
      "The browser's own correlation id is still on screen. It appears in NO " +
        "server log, so a user quoting it gives support nothing to search.",
    ).not.toBeInTheDocument();
  });

  it("[140.3-15 / TS-20] a NESTED service_error envelope's id renders too", async () => {
    // The other wire shape: `body.detail.correlation_id`. A reader that looked
    // only at the top level answers null here, and null is what a deleted carry
    // also produces.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          detail: {
            code: "EVAL_FAILED",
            dependency: null,
            retryable: false,
            detail: "Evaluation failed.",
            correlation_id: "nested-b41d8e02-3aa7-4c19-9f60-77e2b3c4d5a1",
          },
        },
        500,
      ),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));
    await vi.waitFor(() => expect(findWizardError()).toBeDefined());

    expect(
      await screen.findByText("nested-b41d8e02-3aa7-4c19-9f60-77e2b3c4d5a1"),
    ).toBeInTheDocument();
  });

  // ============================================================
  // Phase 140.4-12 / SEAMRIM-08 — THE TRANSLATION TABLE IS THE AUTHORITY.
  //
  // `140.3-01` added `VALIDATION_FAILED` and `RATE_LIMITED` to the ONE
  // wire->wizard table (`SEAM_CODE_TO_WIZARD_CODE`). Neither is a member of
  // this file's SECOND allow-list, `KNOWN_FINALIZE_CODES`, so a successful
  // translation was overruled by an independently-maintained membership check
  // and both collapsed back to UNKNOWN. The honest RATE_LIMITED copy — "the cap
  // is ours, not your exchange's" — EXISTED AND WAS UNREACHABLE.
  //
  // The remedy deletes the second roster's JURISDICTION rather than widening
  // it: a translated code is surfaced as translated, and `KNOWN_FINALIZE_CODES`
  // keeps only its own domain (the wizard codes this app's OWN route mints).
  // The membership check is NOT weakened — the negative control below proves an
  // unrecognised wire code still resolves to UNKNOWN by both paths.
  //
  // ⚠️ ORACLE INDEPENDENCE: every expected sentence is a LITERAL typed here.
  // Reading `WIZARD_ERROR_COPY[code]` on the expected side would agree with any
  // reword, including a reword back to the dead end (validation hazard #6).
  // ============================================================

  it("[140.4-12] a RATE_LIMITED wire code renders the HONEST rate-limit copy — the cap is OURS", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: "RATE_LIMITED",
          human_message: "Too many requests.",
          correlation_id: "corr-rl-1",
        },
        429,
      ),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    // Funnel truth first: pre-fix this reads "UNKNOWN" — the measured proof
    // that 140.3-01 shipped with zero user-visible effect for this code.
    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    expect(findWizardError()!.code).toBe("RATE_LIMITED");
    expect(findWizardError()!.code).not.toBe("UNKNOWN");

    // RATE_LIMITED's own title, typed as a literal.
    expect(
      await screen.findByText("You have reached our request limit."),
    ).toBeInTheDocument();
    // …and the load-bearing half of its cause: the limit is OURS.
    expect(
      screen.getByText(/the cap is ours, not your exchange's/i),
    ).toBeInTheDocument();

    // Both wrong renders are gone. Asserting only the presence of the new copy
    // would still pass if the generic envelope rendered alongside it.
    expect(screen.queryByText("Something went wrong.")).not.toBeInTheDocument();
    expect(
      screen.queryByText("The exchange rate-limited this request."),
      "C-5 measured the exchange-blaming copy emitted for OUR OWN limiter. " +
        "This code is the honest alternative; it must not render beside it.",
    ).not.toBeInTheDocument();
  });

  it("[140.4-12] a VALIDATION_FAILED wire code renders its own member, not UNKNOWN", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        { ok: false, code: "VALIDATION_FAILED", human_message: "bad shape" },
        422,
      ),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    expect(findWizardError()!.code).toBe("VALIDATION_FAILED");
    expect(findWizardError()!.code).not.toBe("UNKNOWN");

    expect(
      await screen.findByText("We could not read that request."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong.")).not.toBeInTheDocument();
  });

  it("[140.4-12] the NESTED python envelope's code is read — a top-level-only reader misses 21 codes", async () => {
    // `body.detail.code` is the shape every `service_error()` answer carries.
    // A reader that looks only at the top level answers `undefined` here, which
    // is byte-identical to a body that carried no code at all.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          detail: {
            code: "RATE_LIMITED",
            dependency: null,
            retryable: true,
            detail: "Rate limit exceeded.",
            correlation_id: "nested-rl-9c1f2a30-5b71-4e63-9d18-4a7c2e5f8b06",
          },
        },
        429,
      ),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    expect(
      findWizardError()!.code,
      "The nested envelope carried RATE_LIMITED and the render did not see " +
        "it. The flat and nested shapes must produce the SAME state — the " +
        "leaf that reads both already exists and is already imported here.",
    ).toBe("RATE_LIMITED");

    expect(
      await screen.findByText("You have reached our request limit."),
    ).toBeInTheDocument();
  });

  it("[140.4-12] NEGATIVE CONTROL — a real seam wire code with no wizard member still resolves to UNKNOWN", async () => {
    // `SEAM_DEGRADED` is named in `SEAM_CODE_TO_WIZARD_CODE`'s own docblock as
    // the code an IDENTITY rule (`code as WizardErrorCode`) would silently
    // admit. It is a genuine wire code, not a garbled one, which is what makes
    // it the sharp control: if this case ever goes green on the code itself,
    // the explicit table has been replaced by a cast and the membership check
    // has been deleted rather than re-scoped.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: false, code: "SEAM_DEGRADED" }, 503),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    expect(findWizardError()!.code).toBe("UNKNOWN");
    expect(
      await screen.findByText("Something went wrong."),
    ).toBeInTheDocument();
  });

  it("[140.3-15 / TS-20] a HOSTILE id is refused and the local one still renders", async () => {
    // On the app-global handlers `correlation_id` is
    // `request.headers.get("x-correlation-id")` \u2014 caller-supplied and echoed
    // back \u2014 and this value is rendered verbatim into the DOM and copied to
    // the clipboard. The leaf's shape guard is what stops that; here we prove the
    // component degrades to the local id rather than to NO id.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        { ok: false, code: "UNKNOWN", correlation_id: "<script>alert(1)</script>" },
        500,
      ),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));
    await vi.waitFor(() => expect(findWizardError()).toBeDefined());

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const localId = new Headers(init.headers).get("X-Correlation-Id");
    expect(await screen.findByText(localId!)).toBeInTheDocument();
    expect(screen.queryByText("<script>alert(1)</script>")).not.toBeInTheDocument();
  });
});

/**
 * Phase 140.5-03 / SEAMPROSE-02 — `Retry-After` ARRIVES at this surface.
 *
 * ⭐ HARD PREREQUISITE FOR PHASE 141. `finalize-wizard` stamps `Retry-After` on
 * three arms of its own, and since the choke-point relay landed in this same
 * plan it also forwards the ANALYTICS SERVICE's 429 wait through
 * `postProcessKey`. The header arrived at the browser and was discarded.
 *
 * ⚠️ Polarity re-derived per site: `ErrorEnvelope` renders the wait only when
 * `showRetry` (recoverable AND an `onRetry` supplied). `RATE_LIMITED` is
 * `clear_and_retry` and this step always supplies `onRetry`, so the wait is
 * reachable here. It would NOT be on a non-recoverable code.
 */
describe("[140.5-03 / SEAMPROSE-02] SubmitStep — the advertised wait reaches the envelope", () => {
  beforeEach(() => {
    trackMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function throttled(retryAfter?: string) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (retryAfter !== undefined) headers["Retry-After"] = retryAfter;
    // `RATE_LIMITED` is a WIRE code: it reaches the wizard vocabulary through
    // `SEAM_CODE_TO_WIZARD_CODE`, which is the hop this step already had.
    return new Response(JSON.stringify({ code: "RATE_LIMITED" }), {
      status: 429,
      headers,
    });
  }

  it("a 429 carrying `Retry-After: 45` renders the wait", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(throttled("45"));
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    const wait = await screen.findByTestId("error-envelope-wait");
    expect(wait).toHaveTextContent("45s");
  });

  it("a 429 with NO header renders NO wait — absence is not zero (TRAP-3)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(throttled());
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await screen.findByTestId("error-envelope");
    expect(screen.queryByTestId("error-envelope-wait")).toBeNull();
  });

  it("a SECOND failure with no header does NOT render the FIRST one's wait", async () => {
    // The clear-on-fresh-attempt half. Without the reset in `handleSubmit`,
    // attempt 2's envelope names attempt 1's duration.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(throttled("45"))
      .mockResolvedValueOnce(throttled());
    renderStep();

    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));
    expect(await screen.findByTestId("error-envelope-wait")).toHaveTextContent(
      "45s",
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));
    await screen.findByTestId("error-envelope");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("error-envelope-wait")).toBeNull();
  });
});

/**
 * 151 review E8 — THE PRODUCER EXISTED AND THE CONSUMER DID NOT.
 *
 * `finalize-wizard` emits `capital_ownership_persisted: false` when the caller
 * asked for a capital mark and the write of that ONE field did not land, and its
 * docblock calls the field "the honest minimum" so such a user is not shown
 * plain success. Nothing in `src/` read it: the response was typed as five
 * fields, the key appeared nowhere else, and the user got an unqualified success
 * screen while their answer was lost — then wondered why `Allocate…` never
 * appeared against the strategy (an unmarked strategy is non-allocatable, and
 * the D-03-A trigger enforces that).
 *
 * The notice is deliberately NON-BLOCKING: the finalize succeeded, so it must
 * not read as a failure, must not be an error envelope, and must not offer a
 * retry. The control asserting the ORDINARY success response renders no notice
 * is what stops the fix degrading into "every submit warns".
 */
describe("SubmitStep — 151 review E8: a dropped capital mark is announced", () => {
  beforeEach(() => {
    trackMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("surfaces the notice and holds the hand-off until the user continues", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          ok: true,
          strategy_id: "strat-final",
          status: "pending_review",
          capital_ownership_persisted: false,
        },
        200,
      ),
    );
    const onSubmitted = renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    const notice = await screen.findByTestId("capital-mark-dropped-notice");
    // It reads as SAVED, not as a failure: the strategy exists and the rest of
    // the submit landed. A user told "something went wrong" would go hunting
    // for work that is not lost.
    expect(notice.textContent).toMatch(/saved/i);
    // It names the remedy AND where to reach it.
    expect(notice.textContent).toMatch(/own capital/i);
    expect(notice.textContent).toMatch(/My Strategies/i);
    // NOT an error envelope, and no retry affordance.
    expect(screen.queryByTestId("error-envelope")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(findWizardError()).toBeUndefined();

    // The hand-off is HELD — `onSubmitted` navigates away, so calling it here
    // would unmount the notice before anyone could read it.
    expect(onSubmitted).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("wizard-submit-continue"));
    expect(onSubmitted).toHaveBeenCalledWith("strat-final");
  });

  it("CONTROL — an ordinary success renders NO notice and hands off immediately", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        { ok: true, strategy_id: "strat-final", status: "pending_review" },
        200,
      ),
    );
    const onSubmitted = renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await vi.waitFor(() => expect(onSubmitted).toHaveBeenCalledWith("strat-final"));
    expect(screen.queryByTestId("capital-mark-dropped-notice")).toBeNull();
  });

  it("CONTROL — `capital_ownership_persisted: true` is a landed mark, not a dropped one", async () => {
    // The read is `=== false`, never a truthiness test: a route that one day
    // emits the field on BOTH outcomes must not turn every success into a
    // warning, and `undefined` must never be read as "dropped".
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          ok: true,
          strategy_id: "strat-final",
          status: "pending_review",
          capital_ownership_persisted: true,
        },
        200,
      ),
    );
    const onSubmitted = renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await vi.waitFor(() => expect(onSubmitted).toHaveBeenCalledWith("strat-final"));
    expect(screen.queryByTestId("capital-mark-dropped-notice")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 153.2-05 / WIZFORM-01 — a field-level refusal from the SERVER goes back to
// the field, not to a page-level envelope.
//
// The state the founder was actually in: a message about the description,
// rendered where the description was not, three times. `validatePayload` is
// authoritative and the client mirrors it — this describes what happens when
// the two DISAGREE (a stale client, a shape drift, a bound that moves
// server-first), which is the only case that can still reach a user.
// ═══════════════════════════════════════════════════════════════════════════
describe("[153.2-05] FIELD_BY_CODE — every field-level code has exactly one field", () => {
  /**
   * The field-level vocabulary, DERIVED from the copy table rather than
   * hand-listed here. A new `METADATA_*` code minted without a field mapping
   * then reds BY NAME instead of silently rendering the envelope — which is the
   * whole claim "a code with no field mapping is a planner bug, not a runtime
   * fallback" rests on.
   */
  const FIELD_LEVEL_CODES = Object.keys(WIZARD_ERROR_COPY).filter((code) =>
    code.startsWith("METADATA_"),
  );

  /**
   * HAND-TYPED, and deliberately not imported from `MetadataStep`. The point of
   * this list is to be an INDEPENDENT statement of the field vocabulary: an
   * import would agree with any rename, including a rename to a field id the
   * metadata step does not actually render.
   */
  const METADATA_FIELD_IDS = [
    "capitalOwnership",
    "name",
    "description",
    "category",
    "aum",
    "maxCapacity",
  ];

  it("⭐ the DERIVATION IS NOT VACUOUS — at least seven field-level codes exist", () => {
    // The anti-vacuity floor. A derivation that matched NOTHING would satisfy
    // "every field-level code is mapped" for the worst possible reason, and
    // would go on satisfying it forever. Seven is the count 153.1-04 minted;
    // the eighth (`METADATA_DESCRIPTION_REQUIRED`) is a Phase-53 entry this
    // route was newly pointed at. The floor is `>=` because the number is
    // expected to GROW.
    expect(
      FIELD_LEVEL_CODES.length,
      `Derived ${FIELD_LEVEL_CODES.length} field-level codes from ` +
        `WIZARD_ERROR_COPY. A number below 7 means the derivation broke — and a ` +
        `broken derivation reports "every code is mapped" for a table where ` +
        `none is.`,
    ).toBeGreaterThanOrEqual(7);
  });

  it("⭐ EVERY field-level code maps to a field — an unmapped one reds BY NAME", () => {
    const unmapped = FIELD_LEVEL_CODES.filter(
      (code) => !FIELD_BY_CODE.has(code as WizardErrorCode),
    ).sort();
    expect(
      unmapped,
      `These field-level codes have NO field in FIELD_BY_CODE, so a server ` +
        `refusal carrying one would fall through to the page-level envelope — a ` +
        `message about a field, rendered where that field is not. That is the ` +
        `exact defect WIZFORM-01 exists to close. ⛔ The remedy is an entry in ` +
        `FIELD_BY_CODE naming the field, never a narrowing of the derivation ` +
        `above.`,
    ).toEqual([]);
  });

  it("every key of FIELD_BY_CODE is a real copy-table member", () => {
    // The converse. A key that is not in the copy table can never be routed
    // (nothing emits it) and would render no sentence if it were — a dead entry
    // that reads as coverage.
    const unknown = [...FIELD_BY_CODE.keys()]
      .filter((code) => !(code in WIZARD_ERROR_COPY))
      .sort();
    expect(unknown).toEqual([]);
  });

  it("every mapped field is a field the metadata step actually renders", () => {
    const strays = [...FIELD_BY_CODE.entries()]
      .filter(([, field]) => !METADATA_FIELD_IDS.includes(field))
      .map(([code, field]) => `${code} -> ${field}`)
      .sort();
    expect(
      strays,
      `A code routed to a field id the metadata step does not carry sends the ` +
        `user to nothing at all — a silent failure, which is the one outcome ` +
        `never acceptable here.`,
    ).toEqual([]);
  });
});

describe("[153.2-05] the routing behaviour", () => {
  beforeEach(() => {
    trackMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderWithFieldHandler(onFieldLevelError = vi.fn()) {
    render(
      <SubmitStep
        strategyId="strat-1"
        wizardSessionId="session-1"
        snapshot={SNAPSHOT}
        metadata={METADATA}
        onFieldLevelError={onFieldLevelError}
        onSubmitted={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    return onFieldLevelError;
  }

  it("⭐ a 400 METADATA_DESCRIPTION_TOO_SHORT goes to the DESCRIPTION field, with NO envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          code: "METADATA_DESCRIPTION_TOO_SHORT",
          error: "description must be at least 10 characters",
        },
        400,
      ),
    );
    const onFieldLevelError = renderWithFieldHandler();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await vi.waitFor(() => expect(onFieldLevelError).toHaveBeenCalled());
    expect(onFieldLevelError).toHaveBeenCalledWith(
      "description",
      "METADATA_DESCRIPTION_TOO_SHORT",
    );
    // ⛔ NO terminal envelope. The copy-table title for this code — typed as a
    // literal, so a reword cannot make the assertion agree with itself — must
    // NOT appear on this step, because the whole point is that it appears at
    // the field on the step the user was sent back to.
    expect(
      screen.queryByText(/Add at least 10 characters/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Something went wrong.")).not.toBeInTheDocument();
    // …and the raw server string never reaches the surface (T-153.2-17).
    expect(
      screen.queryByText(/description must be at least 10 characters/),
    ).not.toBeInTheDocument();
  });

  it("the field-level branch still emits wizard_error with the surfaced code", async () => {
    // T-153.2-20 — the funnel must not lose sight of refusals the new branch
    // handles. Firing telemetry only on the envelope path would make every
    // field-level refusal invisible the day this shipped.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ code: "METADATA_AUM_INVALID", error: "bad aum" }, 400),
    );
    const onFieldLevelError = renderWithFieldHandler();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await vi.waitFor(() => expect(onFieldLevelError).toHaveBeenCalled());
    const payload = findWizardError();
    expect(payload).toBeDefined();
    expect(payload!.code).toBe("METADATA_AUM_INVALID");
    expect(payload!.step).toBe("submit");
    expect(onFieldLevelError).toHaveBeenCalledWith("aum", "METADATA_AUM_INVALID");
  });

  it("CONTROL — a NON-field failure renders the envelope exactly as before and routes nothing", async () => {
    // The other half of the discrimination. A test that only proved the new
    // branch fires would be satisfied by a component that routed EVERYTHING to
    // the field, deleting the envelope for genuine infrastructure failures.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ code: "KEY_NETWORK_TIMEOUT", error: "probe failed" }, 502),
    );
    const onFieldLevelError = renderWithFieldHandler();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    // KEY_NETWORK_TIMEOUT's title, typed as a literal here.
    expect(
      await screen.findByText("We could not reach the exchange."),
    ).toBeInTheDocument();
    expect(onFieldLevelError).not.toHaveBeenCalled();
    const payload = findWizardError();
    expect(payload!.code).toBe("KEY_NETWORK_TIMEOUT");
  });

  it("⛔ NEVER SWALLOWED — with no handler, a field-level code falls back to the envelope", async () => {
    // The prop is optional, so a caller that cannot navigate is a real case.
    // The failure must still be SHOWN: a refusal rendered in the wrong place is
    // bad, a refusal rendered nowhere is worse.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        { code: "METADATA_DESCRIPTION_TOO_SHORT", error: "too short" },
        400,
      ),
    );
    renderStep(); // no onFieldLevelError
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    expect(
      await screen.findByText(/Add at least 10 characters/),
    ).toBeInTheDocument();
    const payload = findWizardError();
    expect(payload!.code).toBe("METADATA_DESCRIPTION_TOO_SHORT");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 153.2-05 / WIZFORM-03 — the envelope this step builds now NAMES ITS CONTEXT.
//
// 153.1-03 shipped the `fixRequires` class filter and every venue-conditional
// entry it needs. Nothing passed a venue, and venue-absence deliberately keeps
// incumbent copy — so the mechanism was live and changed nothing: an MT5 user
// went on being told to switch to a different exchange for an account that IS
// the venue. Same story for `surface`, whose absence suppresses a bullet that
// is true on exactly this step.
//
// ⚠️ ORACLE INDEPENDENCE: every expected sentence below is a LITERAL typed
// here. Reading the copy table on the expected side would make the assertion
// agree with any reword, including a reword back to the unwinnable remedy.
// ═══════════════════════════════════════════════════════════════════════════
describe("[153.2-05] the envelope names its venue and its surface", () => {
  beforeEach(() => {
    trackMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderOnVenue(exchange: string | null) {
    render(
      <SubmitStep
        strategyId="strat-1"
        wizardSessionId="session-1"
        snapshot={{ ...SNAPSHOT, exchange }}
        metadata={METADATA}
        onSubmitted={vi.fn()}
        onBack={vi.fn()}
      />,
    );
  }

  const SWITCH_VENUE_BULLET =
    "If it keeps failing, switch to a different exchange or contact support.";
  const NO_OTHER_VENUE_BULLET =
    "This is your broker account, so there is no other venue to try. If it keeps failing, email security@quantalyze.com with the correlation id below.";

  it("⭐ D-17 — an MT5 submit is NOT told to switch to a different exchange", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ code: "KEY_NETWORK_TIMEOUT", error: "probe failed" }, 502),
    );
    renderOnVenue("mt5");
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await screen.findByText("We could not reach the exchange.");
    expect(screen.queryByText(SWITCH_VENUE_BULLET)).not.toBeInTheDocument();
    // …and the truthful replacement renders instead. Both halves matter: a
    // shorter list would also satisfy the absence assertion alone, and D-17
    // asks for a true sentence, not for silence.
    expect(screen.getByText(NO_OTHER_VENUE_BULLET)).toBeInTheDocument();
  });

  it("CONTROL — a ccxt venue keeps the incumbent copy byte-for-byte", async () => {
    // The discrimination. A component that suppressed the bullet for EVERY
    // venue would pass the row above and would be a repo-wide copy regression.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ code: "KEY_NETWORK_TIMEOUT", error: "probe failed" }, 502),
    );
    renderOnVenue("binance");
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await screen.findByText("We could not reach the exchange.");
    expect(screen.getByText(SWITCH_VENUE_BULLET)).toBeInTheDocument();
    expect(screen.queryByText(NO_OTHER_VENUE_BULLET)).not.toBeInTheDocument();
  });

  it("CONTROL — an UNRESOLVED venue keeps the incumbent copy too", async () => {
    // Absence answers the predicate's DEFAULT (`substitutable` ⇒ true), which
    // is what keeps every pre-153.1 caller's copy intact. A snapshot with no
    // exchange must not be read as "this venue cannot be substituted".
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ code: "KEY_NETWORK_TIMEOUT", error: "probe failed" }, 502),
    );
    renderOnVenue(null);
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await screen.findByText("We could not reach the exchange.");
    expect(screen.getByText(SWITCH_VENUE_BULLET)).toBeInTheDocument();
  });

  it("⭐ Gate B — SERVICE_UNREACHABLE's /strategies bullet renders on THIS surface", async () => {
    // It was suppressed everywhere until a call site named its surface, which
    // is exactly the "fail toward saying less" posture 153.1-03 chose. This is
    // the surface where the detour is true, so this is where it comes back.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        { code: "UPSTREAM_NETWORK_ERROR", error: "no answer" },
        502,
      ),
    );
    renderOnVenue("binance");
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    await screen.findByText("We could not reach our own service.");
    expect(
      screen.getByText(
        "If you were submitting a strategy, open /strategies before retrying — the request may have completed without answering.",
      ),
    ).toBeInTheDocument();
  });

  it("charCount reaches the fallback envelope for a description bound", async () => {
    // Reachable only when no `onFieldLevelError` is wired — the routing branch
    // otherwise takes this code to the field. The count is the length of the
    // description THIS component POSTed, so the sentence names the number the
    // server measured rather than one we guessed (TRAP-3).
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        { code: "METADATA_DESCRIPTION_TOO_SHORT", error: "too short" },
        400,
      ),
    );
    renderOnVenue("binance");
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    expect(
      await screen.findByText(
        `Add at least 10 characters — you have ${METADATA.description.length}.`,
      ),
    ).toBeInTheDocument();
  });
});

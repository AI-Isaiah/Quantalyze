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

  it("maps a thrown fetch to KEY_NETWORK_TIMEOUT", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));

    // No wizard_error telemetry on the catch path (only setErrorCode), so
    // assert the rendered envelope instead. KEY_NETWORK_TIMEOUT is a
    // recoverable code, so the envelope renders the Retry affordance
    // (aria-label="Retry") wired to onRetry.
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

  // A 409 stale-state ('draft_state_invalid' — not a WizardErrorCode) maps to
  // UNKNOWN, which is recoverable, so the legitimately-retryable refresh path
  // keeps its Retry button (RED-TEAM R1 regression guard).
  //
  // ⚠️ READ AS A PAIR with the case directly BELOW. `wizardErrors.ts` records
  // that these are the two codes `finalize-wizard` can put in front of a user
  // with no wizard member behind them. Both are pinned here so the pair is
  // discoverable from either end; neither resolution is accidental.
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

  // ⚠️ READ AS A PAIR with the sibling directly ABOVE. This is the SECOND
  // residual wire code, and unlike its sibling it is reachable on the LIVE
  // unified-backbone path. Recorded, not overlooked: 140.3-G2 / GC-3, and
  // `deferred-items.md` DEF-G2-1 carries the owner.
  //
  // The failure message below is the deliverable, not the assertion. An
  // assertion that "UNKNOWN is what happens" would read as blessing a defect;
  // the message exists so that whoever reddens this test learns what has to
  // ship alongside the fix.
  it("[140.3-G2] the unified-backbone 409 is a RECORDED residual: COMPOSITE_UNSUPPORTED_UNIFIED resolves to UNKNOWN until TRAP-4 is cleared", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          // The body the route actually sends — read at
          // `finalize-wizard/route.ts:1545-1553`, not invented here.
          error:
            "Composite (multi-key) strategies are not yet supported on this path.",
          code: "COMPOSITE_UNSUPPORTED_UNIFIED",
        },
        409,
      ),
    );
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-submit-for-review"));
    await vi.waitFor(() => expect(findWizardError()).toBeDefined());
    expect(
      findWizardError()!.code,
      [
        "READ THIS BEFORE CHANGING IT.",
        "",
        "1. `finalize-wizard/route.ts:1551` emits `COMPOSITE_UNSUPPORTED_UNIFIED` on a",
        "   409 on the LIVE unified-backbone finalize path, so a real user reaches",
        "   this arm — it is not a hypothetical.",
        "2. It is DELIBERATELY NOT a member of `KNOWN_FINALIZE_CODES` (SubmitStep.tsx),",
        "   so it renders as UNKNOWN and the `wizard_error` funnel reports UNKNOWN,",
        "   which collapses this arm into every other unrecognised one. That touches",
        "   SC2's recognition clause and SC6's specificity clause. It is a RECORDED",
        "   residual (140.3-G2 / GC-3; DEF-G2-1, owner Phase 140.4) — not an accident,",
        "   and this assertion is not an endorsement of the outcome.",
        "3. IF YOU ARE READING THIS BECAUSE YOU JUST ADMITTED THE CODE: that is the",
        "   right fix and this test is doing its job. Admitting a code is a CODE-SET",
        "   change, so widen `DESTRUCTIVE_CONTROL_IS_WRONG_FOR` (`SyncPreviewStep.tsx`)",
        "   IN THE SAME COMMIT if the new member's copy is non-recoverable. A",
        "   non-recoverable code renders no Retry, which can leave 'Try another key'",
        "   -> handleDeleteDraft() as the SOLE affordance and destroy the user's",
        "   composite draft. That is TRAP-4, a locked CONTEXT decision, and it is the",
        "   exact coupling DEF-15-1 records for the sibling KNOWN_KICKOFF_CODES set.",
        "4. THEN update this case to assert the new code. Do not delete it: the pair",
        "   above and below is how the next reader finds the other residual.",
      ].join("\n"),
    ).toBe("UNKNOWN");
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

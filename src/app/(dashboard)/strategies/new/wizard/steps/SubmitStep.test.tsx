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
});

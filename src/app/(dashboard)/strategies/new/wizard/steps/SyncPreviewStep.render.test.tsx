/** @vitest-environment jsdom */
/**
 * H-0194 — SyncPreviewStep render-state machine (renderable branches).
 *
 * The pure `deriveDetectedMarkets` helper is already covered in
 * SyncPreviewStep.test.ts. The polling/Promise.all terminal path and the
 * module-private formatMetric/formatCagr helpers are not exported, so they
 * cannot be unit-tested without a production extraction (FLAGGED below).
 *
 * What IS testable end-to-end via render + mocks: the kickoff branch. When
 * the freshness probe finds no fresh row and POST /api/keys/sync returns a
 * non-2xx, the step transitions to phase="gate_failed" with
 * errorCode="SYNC_FAILED" and renders the scripted wizardErrors copy plus
 * the "Try another key" affordance. These pin branch (a) of the audit.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncPreviewStep } from "./SyncPreviewStep";

// Supabase mock: the freshness probe is
//   supabase.from(t).select(c).eq(k,v).maybeSingle()
// Resolve maybeSingle with no existing row so the kickoff path runs the
// /api/keys/sync POST (which the test then forces to fail).
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: vi.fn(),
}));

// KeyPermissionBadge fires its own fetch on mount; it only renders on the
// "passed" branch which these tests do not reach, but stub it to keep the
// render tree inert if a future change mounts it earlier.
vi.mock("@/components/connect/KeyPermissionBadge", () => ({
  KeyPermissionBadge: () => null,
}));

const baseProps = {
  strategyId: "strat-1",
  apiKeyId: "key-1",
  wizardSessionId: "session-1",
  onComplete: vi.fn(),
  onTryAnotherKey: vi.fn(),
};

describe("[H-0194] SyncPreviewStep — kickoff render states", () => {
  beforeEach(() => {
    baseProps.onComplete = vi.fn();
    baseProps.onTryAnotherKey = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the computing/kicking-off state on first paint", async () => {
    // Keep the sync POST pending so the component stays in kicking_off.
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
    render(<SyncPreviewStep {...baseProps} />);
    expect(
      screen.getByRole("heading", { name: /computing your verified factsheet/i }),
    ).toBeInTheDocument();
  });

  it("transitions to gate_failed with SYNC_FAILED copy when /api/keys/sync returns non-2xx", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "compute failed" }), { status: 500 }),
    );

    render(<SyncPreviewStep {...baseProps} />);

    // SYNC_FAILED scripted title from wizardErrors.ts.
    expect(
      await screen.findByText(/We could not verify this strategy/i),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("wizard-try-another-key")).toBeInTheDocument(),
    );
    errSpy.mockRestore();
  });

  it("transitions to gate_failed with a network-timeout when the sync POST throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    render(<SyncPreviewStep {...baseProps} />);

    await waitFor(() =>
      expect(screen.getByTestId("wizard-try-another-key")).toBeInTheDocument(),
    );
    errSpy.mockRestore();
  });
});

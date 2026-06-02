/** @vitest-environment jsdom */
/**
 * H-0191 — MetadataStep component behavior.
 *
 * Untested before: (a) categoryLoadError state when the discovery_categories
 * fetch errors; (b) auto-select of categories[0] when categoryId is null AND
 * data is non-empty (a regression to default "" would silently submit an
 * invalid category_id and fail at finalize); (c) supportedExchanges
 * defaulting to [canonicalizeExchange(detectedExchange)] when initial is
 * null; (d) the Submit gate (description + categoryId) and the onComplete
 * payload.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MetadataStep, type MetadataDraft } from "./MetadataStep";

// Supabase client mock: MetadataStep does
//   supabase.from("discovery_categories").select("id, name").order("sort_order")
// and awaits the result. `orderResult` is overridden per-test.
let orderResult: { data: unknown; error: unknown } = { data: [], error: null };

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (_table: string) => ({
      select: (_cols: string) => ({
        order: (_col: string) => Promise.resolve(orderResult),
      }),
    }),
  }),
}));

// M-0248 (F1 loud-fail): an unreadable discovery_categories table must
// fire wizard_error telemetry so the founder/ops team gets a signal —
// not just show inline copy. We assert the analytics payload directly.
const trackMock = vi.fn();
vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: (...args: unknown[]) => trackMock(...args),
}));

const CATS = [
  { id: "cat-aaa", name: "Market Neutral" },
  { id: "cat-bbb", name: "Directional" },
];

const baseProps = {
  strategyId: "strat-1",
  wizardSessionId: "session-1",
  initial: null,
  detectedMarkets: [] as string[],
  detectedExchange: null as string | null,
  onComplete: vi.fn(),
  onBack: vi.fn(),
};

describe("[H-0191] MetadataStep", () => {
  beforeEach(() => {
    orderResult = { data: CATS, error: null };
    baseProps.onComplete = vi.fn();
    baseProps.onBack = vi.fn();
    trackMock.mockClear();
  });

  it("auto-selects categories[0] when categoryId is null and data is non-empty", async () => {
    render(<MetadataStep {...baseProps} />);
    const select = (await screen.findByLabelText("Category")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("cat-aaa"));
  });

  it("surfaces categoryLoadError copy when the supabase query returns an error", async () => {
    orderResult = { data: null, error: { message: "rls denied" } };
    render(<MetadataStep {...baseProps} />);
    expect(
      await screen.findByText(/Could not load strategy categories\./i),
    ).toBeInTheDocument();
  });

  it("[M-0248] fires wizard_error telemetry when the category select errors", async () => {
    // Loud-fail: an RLS regression / Supabase outage that makes
    // discovery_categories unreadable must emit observable telemetry so
    // the founder/ops team sees the user is blocked — the inline copy
    // alone is invisible to them. Asserting the exact code so an
    // "UNKNOWN" or missing event cannot satisfy the test.
    orderResult = { data: null, error: { message: "rls denied" } };
    render(<MetadataStep {...baseProps} />);

    await waitFor(() => expect(trackMock).toHaveBeenCalled());
    const call = trackMock.mock.calls.find(
      (c) => (c as unknown[])[0] === "wizard_error",
    ) as unknown[] | undefined;
    expect(call).toBeDefined();
    const payload = call![1] as {
      code: string;
      step: string;
      wizard_session_id: string;
    };
    expect(payload.code).toBe("METADATA_CATEGORY_LOAD_FAILED");
    expect(payload.step).toBe("metadata");
    expect(payload.wizard_session_id).toBe("session-1");
  });

  it("[M-0248] does NOT fire wizard_error on a genuine empty (readable) result", async () => {
    // Discriminate failure from empty: zero categories that read cleanly
    // is a legitimate (if degenerate) state, not an error — no telemetry.
    orderResult = { data: [], error: null };
    render(<MetadataStep {...baseProps} />);
    // Let the effect settle.
    await screen.findByLabelText("Category");
    const errored = trackMock.mock.calls.some(
      (c) => (c as unknown[])[0] === "wizard_error",
    );
    expect(errored).toBe(false);
  });

  it("pre-selects the canonical exchange chip from detectedExchange (lowercase → canonical)", () => {
    // detectedExchange is the lowercase api_keys.exchange ('okx'); the chip
    // group matches case-sensitively against EXCHANGES ('OKX'). The default
    // must canonicalize so the chip renders pre-selected (aria-pressed).
    render(<MetadataStep {...baseProps} detectedExchange="okx" />);
    const chip = screen.getByRole("button", { name: "OKX" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("disables Submit until both description and categoryId are present", async () => {
    // Start with no categories so auto-select cannot fill categoryId, and an
    // empty description: the gate must keep Submit disabled.
    orderResult = { data: [], error: null };
    render(<MetadataStep {...baseProps} detectedMarkets={["BTC"]} />);
    const submit = screen.getByRole("button", { name: /review and submit/i });
    expect(submit).toBeDisabled();
  });

  it("emits the captured fields (incl. auto-selected categoryId) via onComplete", async () => {
    const onComplete = vi.fn();
    render(<MetadataStep {...baseProps} onComplete={onComplete} />);
    // Wait for the category auto-select to settle.
    const select = (await screen.findByLabelText("Category")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("cat-aaa"));

    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "A market-neutral basis strategy." },
    });

    const submit = screen.getByRole("button", { name: /review and submit/i });
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    expect(onComplete).toHaveBeenCalledTimes(1);
    const draft = onComplete.mock.calls[0]![0] as MetadataDraft;
    expect(draft.categoryId).toBe("cat-aaa");
    expect(draft.description).toBe("A market-neutral basis strategy.");
  });
});

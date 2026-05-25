import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SendIntroPanel } from "./SendIntroPanel";
import type { CandidateRow } from "@/components/admin/AllocatorMatchQueue";

/**
 * M-0388 / M-0389 (audit-2026-05-07) — SendIntroPanel submit guards +
 * holdings fetch/state.
 *
 * SendIntroPanel.tsx wires the Phase 5 D-20c Option A flow: it fetches the
 * allocator's current holdings on mount, filters out the candidate
 * strategy itself, defaults to the top-weight holding, and HARD-BLOCKS
 * submit when there are no holdings (no underperformer reference). It also
 * has a was_already_sent path where the API returns 200 but the panel must
 * surface an error instead of calling onSuccess.
 *
 * These tests pin:
 *   M-0388 — note-empty / originalStrategyId-empty / holdings-empty submit
 *            guards + was_already_sent NOT treated as success.
 *   M-0389 — holdings fetch failure → error banner; self-strategy filtering
 *            dropping the only holding → empty-banner block; the POST body
 *            actually includes original_strategy_id.
 */

const ALLOCATOR_ID = "11111111-1111-4111-8111-111111111111";
const CANDIDATE_STRATEGY_ID = "22222222-2222-4222-8222-222222222222";
const HOLDINGS_URL = `/api/admin/allocators/${ALLOCATOR_ID}/holdings`;
const SEND_INTRO_URL = "/api/admin/match/send-intro";

const CANDIDATE: CandidateRow = {
  id: "cand-1",
  strategy_id: CANDIDATE_STRATEGY_ID,
  score: 0.9,
  score_breakdown: {},
  reasons: ["Strong Sharpe lift", "Low correlation with book"],
  rank: 1,
  exclusion_reason: null,
  exclusion_provenance: null,
  strategies: {
    id: CANDIDATE_STRATEGY_ID,
    name: "Candidate Strategy",
    codename: "Falcon",
    disclosure_tier: "institutional",
    strategy_types: ["trend"],
    supported_exchanges: ["binance"],
    aum: 1_000_000,
    max_capacity: 5_000_000,
    user_id: "user-x",
  },
  analytics: null,
};

type Holding = { id: string; name: string };

/**
 * Install a URL-routing fetch mock. `holdings` is the array returned by the
 * holdings GET; `holdingsFail` makes that GET return 500. `sendResponse`
 * configures the POST /send-intro response.
 */
function installRoutedFetch(opts: {
  holdings?: Holding[];
  holdingsFail?: boolean;
  sendResponse?: { ok?: boolean; body?: Record<string, unknown> };
}) {
  const mock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    void _init;
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/holdings")) {
      if (opts.holdingsFail) {
        return { ok: false, status: 500, json: async () => ({}) } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ holdings: opts.holdings ?? [] }),
      } as Response;
    }
    if (url.includes("/send-intro")) {
      const r = opts.sendResponse ?? { ok: true, body: {} };
      return {
        ok: r.ok ?? true,
        status: r.ok === false ? 400 : 200,
        json: async () => r.body ?? {},
      } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", mock as unknown as typeof fetch);
  return mock;
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof SendIntroPanel>> = {}) {
  const onSuccess = vi.fn();
  const onClose = vi.fn();
  render(
    <SendIntroPanel
      allocatorId={ALLOCATOR_ID}
      candidate={CANDIDATE}
      alreadySent={false}
      onClose={onClose}
      onSuccess={onSuccess}
      {...overrides}
    />,
  );
  return { onSuccess, onClose };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SendIntroPanel — submit guards (M-0388)", () => {
  it("hard-blocks submit when the allocator has no holdings (button disabled, no POST)", async () => {
    const mock = installRoutedFetch({ holdings: [] });
    renderPanel();
    // Wait for the empty-holdings banner that signals holdings resolved to [].
    await screen.findByText("Cannot send intro");
    const sendBtn = screen.getByRole("button", { name: /send intro/i });
    expect((sendBtn as HTMLButtonElement).disabled).toBe(true);
    // Only the holdings GET should have fired — never the send-intro POST.
    const postCalls = mock.mock.calls.filter((c) =>
      String(c[0]).includes("/send-intro"),
    );
    expect(postCalls.length).toBe(0);
  });

  it("blocks submit when the note is trimmed-empty", async () => {
    // A candidate with a whitespace-only first reason so the note defaults blank.
    const blankNoteCandidate: CandidateRow = { ...CANDIDATE, reasons: ["   "] };
    installRoutedFetch({ holdings: [{ id: "h1", name: "Old Strat" }] });
    render(
      <SendIntroPanel
        allocatorId={ALLOCATOR_ID}
        candidate={blankNoteCandidate}
        alreadySent={false}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    // Wait for holdings to load (select appears).
    await screen.findByRole("combobox");
    const sendBtn = screen.getByRole("button", { name: /send intro/i });
    // note.trim() is empty → canSubmit false.
    expect((sendBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("does NOT treat a was_already_sent:true response as success", async () => {
    const mock = installRoutedFetch({
      holdings: [{ id: "h1", name: "Old Strat" }],
      sendResponse: { ok: true, body: { was_already_sent: true } },
    });
    const { onSuccess } = renderPanel();
    await screen.findByRole("combobox");
    const sendBtn = screen.getByRole("button", { name: /send intro/i });
    expect((sendBtn as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      fireEvent.click(sendBtn);
    });
    await screen.findByText(/already exists for this allocator/i);
    expect(onSuccess).not.toHaveBeenCalled();
    // The POST did fire (200), but success was suppressed.
    expect(
      mock.mock.calls.some((c) => String(c[0]).includes("/send-intro")),
    ).toBe(true);
  });
});

describe("SendIntroPanel — holdings fetch/state (M-0389)", () => {
  it("surfaces an error banner when the holdings fetch fails (500)", async () => {
    installRoutedFetch({ holdingsFail: true });
    renderPanel();
    await screen.findByText(/Failed to load holdings/i);
    // With an error and no holdings list, submit is gated (holdingsLoading
    // is false but originalStrategyId stays empty).
    const sendBtn = screen.getByRole("button", { name: /send intro/i });
    expect((sendBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("filters out the candidate strategy itself — only holding == candidate yields the empty block", async () => {
    const mock = installRoutedFetch({
      // The single holding IS the candidate strategy; after self-filter the
      // list is empty and submit must be blocked.
      holdings: [{ id: CANDIDATE_STRATEGY_ID, name: "Self" }],
    });
    renderPanel();
    await screen.findByText("Cannot send intro");
    const sendBtn = screen.getByRole("button", { name: /send intro/i });
    expect((sendBtn as HTMLButtonElement).disabled).toBe(true);
    expect(
      mock.mock.calls.filter((c) => String(c[0]).includes("/send-intro")).length,
    ).toBe(0);
  });

  it("includes original_strategy_id (the default top-weight holding) in the POST body", async () => {
    const mock = installRoutedFetch({
      holdings: [
        { id: "top-weight", name: "Top Weight Holding" },
        { id: "second", name: "Second Holding" },
      ],
      sendResponse: { ok: true, body: {} },
    });
    const { onSuccess } = renderPanel();
    await screen.findByRole("combobox");
    const sendBtn = screen.getByRole("button", { name: /send intro/i });
    await act(async () => {
      fireEvent.click(sendBtn);
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const postCall = mock.mock.calls.find((c) =>
      String(c[0]).includes("/send-intro"),
    );
    expect(postCall).toBeTruthy();
    const init = postCall![1] as RequestInit;
    const parsed = JSON.parse(init.body as string);
    // Default selection is the FIRST holding (top weight per route order).
    expect(parsed.original_strategy_id).toBe("top-weight");
    expect(parsed.strategy_id).toBe(CANDIDATE_STRATEGY_ID);
    expect(parsed.allocator_id).toBe(ALLOCATOR_ID);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MandateQuickSetCard } from "./MandateQuickSetCard";

/**
 * Phase 11 / 11-05 / S2 / ONBOARD-02 — MandateQuickSetCard tests.
 *
 * Critical invariants pinned here:
 *   - Verbatim UI-SPEC §S2 copy (heading, body, field labels, helper text,
 *     button labels)
 *   - <Card padding="md"> default chrome (UI-SPEC AC #15) — no padding
 *     override
 *   - BLOCK-2 reconciliation (Phase 02 D-09 LOCKED + Phase 11 D-04):
 *       * Input element renders with value="" (empty) on first paint
 *       * placeholder="e.g. 15" hints at the suggestion without committing
 *       * Helper text "Suggested: 15%. ..." displays the suggestion
 *       * Save button is DISABLED while the input is empty (no silent
 *         default save)
 *       * Save ENABLES when user types a value, RE-DISABLES on clear
 *       * Saving fires PUT /api/preferences with the user-typed value
 *   - NO auto-save on mount (Phase 02 D-09 LOCKED)
 *   - Skip writes sessionStorage flag and hides the card
 *   - 401 / 500 surface an inline error
 */

// sessionStorage stub — per-test reset
const ssStore = new Map<string, string>();
const sessionStorageMock = {
  getItem: vi.fn((k: string) => ssStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    ssStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    ssStore.delete(k);
  }),
  clear: vi.fn(() => {
    ssStore.clear();
  }),
  key: vi.fn(() => null),
  length: 0,
};
vi.stubGlobal("sessionStorage", sessionStorageMock);

function okResponse(body: unknown = { success: true }): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response;
}

function errorResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  ssStore.clear();
  sessionStorageMock.getItem.mockClear();
  sessionStorageMock.setItem.mockClear();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Re-stub the sessionStorage so subsequent tests still see the mock.
  vi.stubGlobal("sessionStorage", sessionStorageMock);
});

describe("MandateQuickSetCard (Phase 11 / S2) — copy + chrome", () => {
  it("renders heading 'Mandate quick-set' verbatim", () => {
    render(<MandateQuickSetCard />);
    expect(screen.getByText("Mandate quick-set")).toBeInTheDocument();
  });

  it("renders the verbatim UI-SPEC §S2 body copy", () => {
    render(<MandateQuickSetCard />);
    expect(
      screen.getByText(
        /Set how the Bridge ranks recommendations for you\. We've suggested defaults — review and save, or skip for now\./,
      ),
    ).toBeInTheDocument();
  });

  it("renders Field 1 label + helper + empty Input with placeholder 'e.g. 15' (BLOCK-2 reconciliation)", () => {
    render(<MandateQuickSetCard />);
    // Label
    expect(
      screen.getByText("Maximum weight per holding"),
    ).toBeInTheDocument();
    // Helper text — Phase 11 D-04 (suggestion display)
    expect(
      screen.getByText(
        /Suggested: 15%\. The Bridge flags any holding that exceeds this share of your portfolio\./,
      ),
    ).toBeInTheDocument();
    // Input — BLOCK-2 reconciliation: empty value on first paint, placeholder hints
    const input = screen.getByLabelText(
      "Maximum weight per holding",
    ) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe(""); // BLOCK-2: NOT pre-filled with "15"
    expect(input.placeholder).toBe("e.g. 15");
  });

  it("renders Field 2 label + helper text + chip group with no chips selected", () => {
    render(<MandateQuickSetCard />);
    expect(
      screen.getByText("Preferred strategy types"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Suggested: none — keep open until you've seen a few Bridge picks\./,
      ),
    ).toBeInTheDocument();
    // Chip group exists; no chip is in the active state on first render.
    const group = screen.getByRole("group", {
      name: "Preferred strategy types",
    });
    expect(group).toBeInTheDocument();
    // Each chip is a <button type="button"> inside the group; none should
    // carry the active className token (bg-accent on the chip's wrapper).
    const chips = group.querySelectorAll("button");
    expect(chips.length).toBeGreaterThan(0);
    for (const c of Array.from(chips)) {
      expect(c.className).not.toContain("bg-accent");
    }
  });

  it("renders Save button 'Save mandate' and Skip button 'Skip for now'", () => {
    render(<MandateQuickSetCard />);
    expect(
      screen.getByRole("button", { name: /save mandate/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /skip for now/i }),
    ).toBeInTheDocument();
  });

  it("does NOT auto-call /api/preferences on initial mount (Phase 02 D-09 LOCKED)", () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    render(<MandateQuickSetCard />);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("MandateQuickSetCard — BLOCK-2 Save-disabled gate (Phase 02 D-09 + Phase 11 D-04 reconciliation)", () => {
  it("Test 7a: Save button is DISABLED on first render (input is empty)", () => {
    render(<MandateQuickSetCard />);
    const save = screen.getByRole("button", { name: /save mandate/i });
    expect(save).toBeDisabled();
  });

  it("Test 7b: Save ENABLES when the user types '15' into the input", () => {
    render(<MandateQuickSetCard />);
    const input = screen.getByLabelText(
      "Maximum weight per holding",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "15" } });
    const save = screen.getByRole("button", { name: /save mandate/i });
    expect(save).not.toBeDisabled();
  });

  it("Test 7c: Save RE-DISABLES when the user clears the input back to empty", () => {
    render(<MandateQuickSetCard />);
    const input = screen.getByLabelText(
      "Maximum weight per holding",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "15" } });
    fireEvent.change(input, { target: { value: "" } });
    const save = screen.getByRole("button", { name: /save mandate/i });
    expect(save).toBeDisabled();
  });

  it("Test 7d: Clicking Save with input='15' fires PUT /api/preferences with max_weight: 0.15", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(okResponse());
    render(<MandateQuickSetCard />);
    const input = screen.getByLabelText(
      "Maximum weight per holding",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: /save mandate/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { method?: string; body?: string },
    ];
    expect(url).toBe("/api/preferences");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body ?? "{}");
    expect(body.max_weight).toBeCloseTo(0.15, 6);
  });
});

describe("MandateQuickSetCard — Save flow + Skip + error", () => {
  it("Editing max_weight to 20 then Save fires the RPC with max_weight: 0.20", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(okResponse());
    render(<MandateQuickSetCard />);
    const input = screen.getByLabelText(
      "Maximum weight per holding",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: /save mandate/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const init = fetchMock.mock.calls[0][1] as { body: string };
    const body = JSON.parse(init.body);
    expect(body.max_weight).toBeCloseTo(0.2, 6);
  });

  it("Toggling a strategy chip then typing 15 + Save fires the RPC with both fields", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    // Two PUTs expected: max_weight first, then preferred_strategy_types
    fetchMock
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(okResponse());
    render(<MandateQuickSetCard />);
    const group = screen.getByRole("group", {
      name: "Preferred strategy types",
    });
    const firstChip = group.querySelector("button");
    expect(firstChip).not.toBeNull();
    fireEvent.click(firstChip!);
    const input = screen.getByLabelText(
      "Maximum weight per holding",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: /save mandate/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    // First call: max_weight
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(firstBody.max_weight).toBeCloseTo(0.15, 6);
    // Second call: preferred_strategy_types
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(Array.isArray(secondBody.preferred_strategy_types)).toBe(true);
    expect(secondBody.preferred_strategy_types.length).toBe(1);
  });

  it("Clicking Skip writes sessionStorage and hides the card", () => {
    render(<MandateQuickSetCard />);
    fireEvent.click(screen.getByRole("button", { name: /skip for now/i }));
    expect(sessionStorageMock.setItem).toHaveBeenCalledWith(
      "allocations.mandate_card_dismissed",
      "1",
    );
    expect(screen.queryByText("Mandate quick-set")).toBeNull();
  });

  it("hides the card when sessionStorage flag was already '1' at mount", async () => {
    ssStore.set("allocations.mandate_card_dismissed", "1");
    render(<MandateQuickSetCard />);
    await Promise.resolve();
    expect(screen.queryByText("Mandate quick-set")).toBeNull();
  });

  it("renders an inline error when the fetch returns 500", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(errorResponse(500, { error: "boom" }));
    render(<MandateQuickSetCard />);
    fireEvent.change(
      screen.getByLabelText("Maximum weight per holding"),
      { target: { value: "15" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /save mandate/i }));
    await waitFor(() => {
      expect(
        screen.getByRole("alert"),
      ).toHaveTextContent(/could not save mandate/i);
    });
  });

  it("uses <Card padding='md'> default chrome (UI-SPEC AC #15) — single root with shadow-card class", () => {
    const { container } = render(<MandateQuickSetCard />);
    const root = container.firstElementChild as HTMLElement | null;
    expect(root).not.toBeNull();
    // Card primitive emits "shadow-card" + "p-6" (padding="md" default).
    expect(root?.className).toContain("shadow-card");
    expect(root?.className).toContain("p-6");
  });
});

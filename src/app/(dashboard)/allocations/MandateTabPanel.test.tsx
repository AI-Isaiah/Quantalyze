/**
 * M-1050 (pr-test-analyzer) — MandateTabPanel had NO test file. The Phase
 * 09.1 PR1 dashboard-parity rename ("Liquidity preference" → "Minimum AUM")
 * lives in MandateTabPanel.tsx:72-80 as an `aumTierLabel` map:
 *   high   → "$10M+"
 *   medium → "$1M – $10M"
 *   low    → "<$1M"
 * The underlying `liquidity_preference` enum value is unchanged; only the
 * SNAPSHOT row label + displayed value changed. A refactor that swaps a tier
 * label (e.g. "$10M+" ↔ "<$1M") would silently show allocators a wrong tier.
 * These pin the rename + the empty-state + the link-out target.
 *
 * The panel reads `mandate` defensively off the payload via
 * `(props as Record<string, unknown>).mandate ?? .allocatorPreferences ?? null`
 * (MandateTabPanel.tsx:148-155) because MyAllocationDashboardPayload does not
 * project mandate columns yet. The tests inject `mandate` as that loose field
 * so the snapshot lights up without a payload-widening PR.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MandateTabPanel } from "./MandateTabPanel";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// The panel only reads `mandate` (a loose, not-yet-projected field) and
// `style_exclusions` / `preferred_strategy_types` off it. Everything else on
// the payload is unused by this surface, so a minimal cast is the honest
// fixture — widening it would imply the panel reads fields it does not.
function renderPanel(mandate: unknown) {
  const props = { mandate } as unknown as MyAllocationDashboardPayload;
  return render(<MandateTabPanel {...props} />);
}

describe("MandateTabPanel — Minimum AUM rename + snapshot (M-1050)", () => {
  it("mandate=null → renders the 'No mandate set yet' empty-state copy", () => {
    renderPanel(null);
    const snapshot = screen.getByTestId("mandate-snapshot");
    expect(within(snapshot).getByText(/No mandate set yet/i)).toBeInTheDocument();
    // No tier rows should render in the empty state.
    expect(screen.queryByText("Minimum AUM")).toBeNull();
  });

  it("liquidity_preference='high' → 'Minimum AUM' row with value '$10M+'", () => {
    renderPanel({ liquidity_preference: "high" });
    const snapshot = screen.getByTestId("mandate-snapshot");
    expect(within(snapshot).getByText("Minimum AUM")).toBeInTheDocument();
    expect(within(snapshot).getByText("$10M+")).toBeInTheDocument();
    // The legacy label must NOT appear after the PR1 rename.
    expect(within(snapshot).queryByText(/Liquidity preference/i)).toBeNull();
  });

  it("liquidity_preference='medium' → 'Minimum AUM' row with value '$1M – $10M'", () => {
    renderPanel({ liquidity_preference: "medium" });
    const snapshot = screen.getByTestId("mandate-snapshot");
    expect(within(snapshot).getByText("Minimum AUM")).toBeInTheDocument();
    // The en-dash separator is part of the literal label (note: "–", not "-").
    expect(within(snapshot).getByText("$1M – $10M")).toBeInTheDocument();
  });

  it("liquidity_preference='low' → 'Minimum AUM' row with value '<$1M'", () => {
    renderPanel({ liquidity_preference: "low" });
    const snapshot = screen.getByTestId("mandate-snapshot");
    expect(within(snapshot).getByText("Minimum AUM")).toBeInTheDocument();
    expect(within(snapshot).getByText("<$1M")).toBeInTheDocument();
  });

  it("each tier maps to a distinct dollar label (guards a label swap)", () => {
    // Rendering all three in isolation and asserting the value, so a refactor
    // that swaps two entries (high↔low) is caught regardless of which single
    // value an individual assertion happens to match.
    const cases: Array<["high" | "medium" | "low", string]> = [
      ["high", "$10M+"],
      ["medium", "$1M – $10M"],
      ["low", "<$1M"],
    ];
    for (const [tier, label] of cases) {
      const { unmount } = renderPanel({ liquidity_preference: tier });
      const snapshot = screen.getByTestId("mandate-snapshot");
      expect(
        within(snapshot).getByText(label),
        `tier '${tier}' must render '${label}'`,
      ).toBeInTheDocument();
      unmount();
    }
  });

  it("always renders the 'Open Mandate form →' link to /profile?tab=mandate", () => {
    renderPanel(null);
    const link = screen.getByRole("link", { name: /Open Mandate form/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("/profile?tab=mandate");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PreferencesPanel } from "./PreferencesPanel";
import type { AllocatorPreferences } from "@/lib/preferences";

/**
 * M-1051 (audit-2026-05-07) — Minimum AUM segmented-radio coverage.
 *
 * Phase 09.1 PR1 renamed the "Liquidity preference" surface to
 * "Minimum AUM" in PreferencesPanel.tsx:288-329. The label is purely a
 * UI rename — the underlying column `liquidity_preference` and its
 * stored option values ("high"/"medium"/"low") are unchanged. These
 * tests pin the value↔label mapping so a future refactor that swaps a
 * `value` for a `label` mid-array (or relabels the active option) fails.
 */

const ALLOCATOR_ID = "11111111-1111-4111-8111-111111111111";

function noop() {}

function renderPanel(preferences: AllocatorPreferences | null = null) {
  return render(
    <PreferencesPanel
      allocatorId={ALLOCATOR_ID}
      preferences={preferences}
      onClose={noop}
      onSuccess={noop}
      onRecomputeRequested={noop}
    />,
  );
}

beforeEach(() => {
  // The form fetch is never reached in these tests, but stub anyway so an
  // accidental submit can't hit the network.
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PreferencesPanel — Minimum AUM segmented radio", () => {
  it("renders the 'Minimum AUM' heading and a radiogroup with the matching aria-label", () => {
    renderPanel();
    // Heading text (the rename target). Use getAllByText since the heading
    // <p> and the radiogroup aria-label share the string.
    expect(screen.getByText("Minimum AUM")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Minimum AUM" })).toBeTruthy();
  });

  it("shows the three dollar-form option labels in high/medium/low order", () => {
    renderPanel();
    const group = screen.getByRole("radiogroup", { name: "Minimum AUM" });
    const radios = group.querySelectorAll('[role="radio"]');
    expect(radios.length).toBe(3);
    // Order is fixed by the (["high","medium","low"]) literal in source.
    expect(radios[0].textContent).toBe("$10M+");
    expect(radios[1].textContent).toBe("$1M – $10M");
    expect(radios[2].textContent).toBe("<$1M");
  });

  it("maps the '$10M+' radio to the stored value 'high' (label↔value mapping)", () => {
    renderPanel();
    const highRadio = screen.getByRole("radio", { name: "$10M+" });
    // Starts unchecked (no preferences passed).
    expect(highRadio.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(highRadio);
    // Clicking selects the high tier — aria-checked flips true. This is the
    // observable proxy for liquidityPreference === "high" being set, since
    // the other two radios remain false.
    expect(highRadio.getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByRole("radio", { name: "$1M – $10M" }).getAttribute("aria-checked"),
    ).toBe("false");
    expect(
      screen.getByRole("radio", { name: "<$1M" }).getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("reflects an incoming liquidity_preference='medium' on the middle radio", () => {
    renderPanel({
      liquidity_preference: "medium",
    } as unknown as AllocatorPreferences);
    expect(
      screen.getByRole("radio", { name: "$1M – $10M" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByRole("radio", { name: "$10M+" }).getAttribute("aria-checked"),
    ).toBe("false");
    expect(
      screen.getByRole("radio", { name: "<$1M" }).getAttribute("aria-checked"),
    ).toBe("false");
  });
});

/**
 * H-0358 — exclusion chip color semantics.
 *
 * "Excluded styles" and "Excluded exchanges" are both exclusion lists, but the
 * style chips were green (accent) while the exchange chips were red (negative).
 * The fix turns active excluded-style chips red to match. WHY it matters: the
 * accent/green styling is reserved for the "Preferred …" inclusion groups, so a
 * green excluded-style chip reads as "preferred" — the inverse of its meaning.
 */
describe("PreferencesPanel — exclusion chip semantics (H-0358)", () => {
  it("active 'Excluded styles' chips use negative (red) styling, not accent", () => {
    renderPanel({
      style_exclusions: ["Trend Following"],
    } as unknown as AllocatorPreferences);
    const chip = screen.getByText("Trend Following").closest("button");
    expect(chip).not.toBeNull();
    // Matches the "Excluded exchanges" chips directly below in the panel.
    expect(chip!.className).toContain("border-negative");
    expect(chip!.className).toContain("text-negative");
    // Must NOT use the inclusion (accent) styling reserved for "Preferred …".
    expect(chip!.className).not.toContain("text-accent");
  });

  it("active 'Preferred strategy types' chips keep accent (inclusion) styling", () => {
    // Guard the inverse: the fix must not bleed into the inclusion groups.
    renderPanel({
      preferred_strategy_types: ["Long-Only"],
    } as unknown as AllocatorPreferences);
    const chip = screen.getByText("Long-Only").closest("button");
    expect(chip).not.toBeNull();
    expect(chip!.className).toContain("text-accent");
    expect(chip!.className).not.toContain("text-negative");
  });
});

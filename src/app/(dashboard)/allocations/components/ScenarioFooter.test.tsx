/**
 * Phase 10 Plan 06a / Task 1 — RED tests for ScenarioFooter.
 *
 * Sticky-bottom bar that renders inside the Scenario tab content area
 * (NOT viewport — switching tabs hides it via the tabpanel hidden attr).
 *
 *   - diff count chip ("No changes yet" | "1 change" | "N changes")
 *   - delta summary line ("+0.3 Sharpe · −4% Max DD" | "No material change yet.")
 *   - Reset (ghost; hover-destructive) — onResetRequested
 *   - Commit scenario (accent; disabled when diff_count = 0) — onCommitRequested
 *   - role="region" aria-label="Scenario draft summary and actions" landmark
 *   - Phase 170 (2026-09-27, N-FOOT): sticky via classes, not an inline style —
 *     bottom-16 below md (clears MobileNav), md:bottom-0 above. The empty state
 *     "No changes yet" prints once, in the change-count chip.
 *   - Geist Mono / font-mono on the delta-summary span
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScenarioFooter, type ScenarioFooterDeltaItem } from "./ScenarioFooter";

const NO_DELTAS: ScenarioFooterDeltaItem[] = [];

const SOME_DELTAS: ScenarioFooterDeltaItem[] = [
  { label: "Sharpe", value: "+0.3", tier: "positive" },
  { label: "Max DD", value: "−4%", tier: "positive" }, // direction-aware: down-good = positive
];

const ALL_MUTED_DELTAS: ScenarioFooterDeltaItem[] = [
  { label: "Sharpe", value: "+0.001", tier: "muted" },
  { label: "TWR", value: "+0.0%", tier: "muted" },
];

describe("ScenarioFooter", () => {
  it("T_F1 diff_count=0 → 'No changes yet' + Commit button disabled", () => {
    const onResetRequested = vi.fn();
    const onCommitRequested = vi.fn();

    render(
      <ScenarioFooter
        diffCount={0}
        deltaSummary={NO_DELTAS}
        onResetRequested={onResetRequested}
        onCommitRequested={onCommitRequested}
      />,
    );

    // Phase 170 (2026-09-27, N-FOOT item (h)): the zero-state phrase prints
    // ONCE, in the change-count chip. HEAD mirrored it into the summary slot
    // (length 2); that mirror was the defect this pin now rejects.
    expect(screen.getAllByText(/No changes yet/i)).toHaveLength(1);
    const chip = screen.getByText(/No changes yet/i);
    expect(chip.className).toMatch(/text-text-muted/);

    const commit = screen.getByTestId("scenario-footer-commit");
    // disabled is reflected via the `disabled` HTML attr on a <button>.
    expect((commit as HTMLButtonElement).disabled).toBe(true);
  });

  it("T_F2 diff_count=3 → '3 changes' chip + Commit button enabled", () => {
    render(
      <ScenarioFooter
        diffCount={3}
        deltaSummary={SOME_DELTAS}
        onResetRequested={() => {}}
        onCommitRequested={() => {}}
      />,
    );

    expect(screen.getByText("3 changes")).toBeTruthy();
    const commit = screen.getByTestId("scenario-footer-commit");
    expect((commit as HTMLButtonElement).disabled).toBe(false);
  });

  it("T_F3 diff_count=1 → '1 change' (singular)", () => {
    render(
      <ScenarioFooter
        diffCount={1}
        deltaSummary={SOME_DELTAS}
        onResetRequested={() => {}}
        onCommitRequested={() => {}}
      />,
    );

    expect(screen.getByText("1 change")).toBeTruthy();
  });

  it("T_F4 deltaSummary=[Sharpe +0.3, Max DD −4%] → renders dot-separated mono summary", () => {
    const { container } = render(
      <ScenarioFooter
        diffCount={2}
        deltaSummary={SOME_DELTAS}
        onResetRequested={() => {}}
        onCommitRequested={() => {}}
      />,
    );

    // Look for the joined string "+0.3 Sharpe · −4% Max DD" — partial match
    // tolerates whitespace-collapse and the slice(0,3) slicing semantics.
    // The joined string is split across whitespace-nowrap item spans plus a
    // " · " separator, so match the summary's full textContent rather than
    // one text node.
    expect(
      screen.getByText((_content, el) =>
        el?.classList.contains("font-mono") === true &&
        /\+0\.3 Sharpe.*·.*−4% Max DD/.test(el.textContent ?? ""),
      ),
    ).toBeTruthy();

    // Mono font on the summary span — class-based assertion.
    const monoEl = container.querySelector(".font-mono");
    expect(monoEl).not.toBeNull();
    expect(monoEl!.textContent).toMatch(/Sharpe|Max DD/);
  });

  it("T_F5 No deltas above noise floor (all tier=muted) → 'No material change yet.'", () => {
    render(
      <ScenarioFooter
        diffCount={2}
        deltaSummary={ALL_MUTED_DELTAS}
        onResetRequested={() => {}}
        onCommitRequested={() => {}}
      />,
    );

    expect(screen.getByText("No material change yet.")).toBeTruthy();
  });

  it("T_F6 click Reset → onResetRequested fires", () => {
    const onResetRequested = vi.fn();
    render(
      <ScenarioFooter
        diffCount={3}
        deltaSummary={SOME_DELTAS}
        onResetRequested={onResetRequested}
        onCommitRequested={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("scenario-footer-reset"));
    expect(onResetRequested).toHaveBeenCalledTimes(1);
  });

  it("T_F7 click Commit → onCommitRequested fires when enabled, NOT fired when disabled", () => {
    const onCommitRequested = vi.fn();
    const { rerender } = render(
      <ScenarioFooter
        diffCount={2}
        deltaSummary={SOME_DELTAS}
        onResetRequested={() => {}}
        onCommitRequested={onCommitRequested}
      />,
    );

    fireEvent.click(screen.getByTestId("scenario-footer-commit"));
    expect(onCommitRequested).toHaveBeenCalledTimes(1);

    // Re-render in disabled state and click again — must NOT fire.
    rerender(
      <ScenarioFooter
        diffCount={0}
        deltaSummary={NO_DELTAS}
        onResetRequested={() => {}}
        onCommitRequested={onCommitRequested}
      />,
    );
    fireEvent.click(screen.getByTestId("scenario-footer-commit"));
    expect(onCommitRequested).toHaveBeenCalledTimes(1); // unchanged
  });

  it("T_F7b 111-05 committableCount gates Commit independently of diffCount — dirty-but-uncommittable draft keeps Commit disabled + shows the dirty chip", () => {
    const onCommitRequested = vi.fn();
    // Exclusion-only draft: diffCount=1 (dirty chip shows "1 change") but zero
    // committable diffs → Commit MUST be disabled and clicking must not fire.
    const { rerender } = render(
      <ScenarioFooter
        diffCount={1}
        committableCount={0}
        deltaSummary={NO_DELTAS}
        onResetRequested={() => {}}
        onCommitRequested={onCommitRequested}
      />,
    );
    // CF-05: the exclusion still counts toward the dirty indicator.
    expect(screen.getByText("1 change")).toBeTruthy();
    const commit = screen.getByTestId("scenario-footer-commit");
    expect((commit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(commit);
    expect(onCommitRequested).not.toHaveBeenCalled();

    // A committable change (committableCount>0) enables Commit — even though the
    // dirty count is unchanged from the display's perspective.
    rerender(
      <ScenarioFooter
        diffCount={2}
        committableCount={1}
        deltaSummary={NO_DELTAS}
        onResetRequested={() => {}}
        onCommitRequested={onCommitRequested}
      />,
    );
    const commit2 = screen.getByTestId("scenario-footer-commit");
    expect((commit2 as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(commit2);
    expect(onCommitRequested).toHaveBeenCalledTimes(1);
  });

  it("T_F7c 111-05 committableCount omitted → falls back to diffCount (legacy display-only footers unaffected)", () => {
    render(
      <ScenarioFooter
        diffCount={3}
        deltaSummary={SOME_DELTAS}
        onResetRequested={() => {}}
        onCommitRequested={() => {}}
      />,
    );
    // No committableCount passed → gate falls back to diffCount>0 → enabled.
    const commit = screen.getByTestId("scenario-footer-commit");
    expect((commit as HTMLButtonElement).disabled).toBe(false);
  });

  it("T_F8 footer has role='region' aria-label='Scenario draft summary and actions' + class sticky offset", () => {
    const { container } = render(
      <ScenarioFooter
        diffCount={0}
        deltaSummary={NO_DELTAS}
        onResetRequested={() => {}}
        onCommitRequested={() => {}}
      />,
    );

    const region = screen.getByRole("region", {
      name: "Scenario draft summary and actions",
    }) as HTMLElement;
    expect(region).toBeTruthy();

    // JOURNEY-03 (a11y): the region landmark is a <div role="region">, NOT a
    // <footer> (axe aria-allowed-role rejects role="region" on <footer>).
    expect(container.querySelector("footer")).toBeNull();
    // Phase 170 (2026-09-27, N-FOOT / PC-2): sticky offset moved from the
    // inline FOOTER_STYLE object to classes so it can clear MobileNav below md.
    // HEAD asserted region.style.position === "sticky" and bottom === "0px".
    expect(region.className).toContain("sticky");
    expect(region.className).toContain("bottom-16");
    expect(region.className).toContain("md:bottom-0");
    expect(region.className).toContain("z-10");
    expect(region.className).toContain("min-h-[56px]");
    expect(region.className).toContain("flex-wrap");
    expect(region.className).toContain("bg-surface");
    expect(region.className).toContain("border-t");
    expect(region.style.position).toBe("");
    expect(region.style.height).toBe("");
  });

  it("T_F10 diff_count=1 with a material delta renders '1 change' and the summary", () => {
    render(
      <ScenarioFooter
        diffCount={1}
        deltaSummary={SOME_DELTAS}
        onResetRequested={() => {}}
        onCommitRequested={() => {}}
      />,
    );

    expect(screen.getByText("1 change")).toBeTruthy();
    expect(screen.getByText(/\+0\.3 Sharpe/)).toBeTruthy();
  });

  it("T_F11 action group is right-aligned and shrink-0; Reset and Commit are at least 44px", () => {
    render(
      <ScenarioFooter
        diffCount={1}
        deltaSummary={SOME_DELTAS}
        onResetRequested={() => {}}
        onCommitRequested={() => {}}
      />,
    );

    const commit = screen.getByTestId("scenario-footer-commit");
    const reset = screen.getByTestId("scenario-footer-reset");
    const group = commit.parentElement as HTMLElement;
    expect(group).toBe(reset.parentElement);
    expect(group.className).toContain("ml-auto");
    expect(group.className).toContain("shrink-0");
    expect(commit.className).toContain("min-h-[44px]");
    expect(reset.className).toContain("min-h-[44px]");
  });

  it("T_F12 material summary items wrap between items, never inside one", () => {
    const { container } = render(
      <ScenarioFooter
        diffCount={2}
        deltaSummary={SOME_DELTAS}
        onResetRequested={() => {}}
        onCommitRequested={() => {}}
      />,
    );

    const monoEl = container.querySelector(".font-mono") as HTMLElement;
    // Each "{value} {label}" item is its own nowrap span. The " · " joiner
    // sits outside those spans so a wrap breaks between items, never inside one.
    const items = monoEl.querySelectorAll(".whitespace-nowrap");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe("+0.3 Sharpe");
    expect(items[1].textContent).toBe("−4% Max DD");
    expect(items[0].className).toContain("whitespace-nowrap");
    expect(items[1].className).toContain("whitespace-nowrap");
    expect(monoEl.textContent).toMatch(/\+0\.3 Sharpe · −4% Max DD/);
  });

  it("T_F9 Reset button has ghost+hover-destructive className tokens (text-text-secondary base; hover:text-negative)", () => {
    render(
      <ScenarioFooter
        diffCount={3}
        deltaSummary={SOME_DELTAS}
        onResetRequested={() => {}}
        onCommitRequested={() => {}}
      />,
    );

    const reset = screen.getByTestId("scenario-footer-reset");
    const cls = reset.className;
    expect(cls).toMatch(/text-text-secondary/);
    expect(cls).toMatch(/hover:text-negative/);
  });
});

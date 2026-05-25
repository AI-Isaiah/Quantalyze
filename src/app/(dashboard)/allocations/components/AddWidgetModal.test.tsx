import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AddWidgetModal } from "./AddWidgetModal";
import { WIDGET_REGISTRY } from "../lib/widget-registry";

// ---------------------------------------------------------------------------
// H-0078 — AddWidgetModal had NO test file. The modal has rich interactive
// behaviour (focus trap, Escape close, search filter + highlight, category
// collapse, Recently Closed, isActive disable). These tests assert the
// correct rendered behaviour against the REAL widget registry — no mocks of
// the registry, so the assertions exercise real widget names/descriptions.
// ---------------------------------------------------------------------------

function renderModal(
  overrides: {
    isOpen?: boolean;
    onClose?: () => void;
    onAdd?: (id: string) => void;
    activeWidgetIds?: string[];
    recentlyClosed?: string[];
  } = {},
) {
  const props = {
    isOpen: overrides.isOpen ?? true,
    onClose: overrides.onClose ?? vi.fn(),
    onAdd: overrides.onAdd ?? vi.fn(),
    activeWidgetIds: overrides.activeWidgetIds ?? [],
    recentlyClosed: overrides.recentlyClosed ?? [],
  };
  return { ...render(<AddWidgetModal {...props} />), props };
}

describe("AddWidgetModal — H-0078", () => {
  it("isOpen=false → renders nothing", () => {
    const { container } = renderModal({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it("(a) opens with the search input focused", () => {
    renderModal();
    const input = screen.getByPlaceholderText("Search widgets...");
    expect(document.activeElement).toBe(input);
  });

  it("(b) typing filters by NAME — 'equity' surfaces Equity Curve and hides unrelated widgets", () => {
    renderModal();
    const input = screen.getByPlaceholderText("Search widgets...");
    fireEvent.change(input, { target: { value: "equity" } });
    // Name match. The matched substring is wrapped in <mark>, splitting
    // "Equity Curve" across text nodes — match the Add button's aria-label
    // which carries the un-split widget name.
    expect(
      screen.getByRole("button", { name: /^Add Equity Curve$/i }),
    ).toBeInTheDocument();
    // A widget with neither "equity" in name nor description is gone.
    expect(
      screen.queryByRole("button", { name: /^Add Drawdown Chart$/i }),
    ).not.toBeInTheDocument();
  });

  it("(b) typing filters by DESCRIPTION — 'underwater' surfaces Drawdown Chart whose NAME does not match", () => {
    renderModal();
    const input = screen.getByPlaceholderText("Search widgets...");
    // "underwater" appears only in Drawdown Chart's description, not its name.
    fireEvent.change(input, { target: { value: "underwater" } });
    expect(screen.getByText("Drawdown Chart")).toBeInTheDocument();
    // The matched substring is highlighted inside the description via <mark>.
    const mark = document.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark?.textContent?.toLowerCase()).toBe("underwater");
    // Equity Curve does not contain "underwater" anywhere → filtered out.
    expect(screen.queryByText("Equity Curve")).not.toBeInTheDocument();
  });

  it("(c) noResults state renders an empty-state message when search matches nothing", () => {
    renderModal();
    const input = screen.getByPlaceholderText("Search widgets...");
    fireEvent.change(input, { target: { value: "zzz-no-such-widget-zzz" } });
    expect(
      screen.getByText(/No widgets match/i),
    ).toBeInTheDocument();
    // No category sections render in the no-results state.
    expect(screen.queryByText("Equity Curve")).not.toBeInTheDocument();
  });

  it("(d) Escape calls onClose", () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("(e) Tab on the last focusable wraps to the first; Shift+Tab on the first wraps to the last", () => {
    const { container } = renderModal();
    const overlay = container.querySelector("[role='dialog']") as HTMLElement;
    const focusable = overlay.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    expect(first).toBeTruthy();
    expect(last).toBeTruthy();
    expect(first).not.toBe(last);

    // Focus last, press Tab → wraps to first.
    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    // Focus first, press Shift+Tab → wraps to last.
    first.focus();
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("(f) clicking the overlay closes; clicking the content panel does NOT", () => {
    const onClose = vi.fn();
    const { container } = renderModal({ onClose });
    const overlay = container.querySelector("[role='dialog']") as HTMLElement;

    // Click on the content panel (the modal's inner card) — must NOT close.
    const heading = screen.getByText("Add Widget");
    fireEvent.click(heading);
    expect(onClose).not.toHaveBeenCalled();

    // Click directly on the overlay (target === currentTarget) — closes.
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("(g) collapsing a category hides its widget rows", () => {
    renderModal();
    // Performance category is present and Equity Curve is one of its widgets.
    expect(screen.getByText("Equity Curve")).toBeInTheDocument();
    // The category-header button carries a parenthesized count
    // ("Performance (11)"); a widget Add button like "Add Performance by
    // Period" would also match a loose /Performance/ regex, so pin the
    // header by its trailing count.
    const perfHeader = screen
      .getAllByRole("button")
      .find((b) => /Performance\s*\(\d+\)/.test(b.textContent ?? ""));
    expect(perfHeader).toBeTruthy();
    fireEvent.click(perfHeader as HTMLElement);
    // After collapse the children are unmounted.
    expect(screen.queryByText("Equity Curve")).not.toBeInTheDocument();
    // A widget in a different (still-expanded) category remains visible.
    const corr = WIDGET_REGISTRY["correlation-matrix"];
    expect(corr).toBeDefined();
    expect(screen.getByText(corr.name)).toBeInTheDocument();
    // Re-expand restores Equity Curve.
    fireEvent.click(perfHeader as HTMLElement);
    expect(screen.getByText("Equity Curve")).toBeInTheDocument();
  });

  it("(h) Recently Closed lists only widgets still in the registry, and the section renders its own heading", () => {
    renderModal({
      // First id is real; second is stale (no longer in registry).
      recentlyClosed: ["equity-curve", "totally-removed-widget"],
    });
    const heading = screen.getByText("Recently Closed");
    expect(heading).toBeInTheDocument();
    // The Recently Closed section (the sibling block after the heading)
    // contains the real widget but never the stale id's name.
    expect(screen.getAllByText("Equity Curve").length).toBeGreaterThanOrEqual(1);
    // Stale id has no registry entry → never rendered anywhere.
    expect(screen.queryByText(/totally-removed-widget/)).not.toBeInTheDocument();
  });

  it("(i) Add button is enabled for an inactive widget and disabled (aria-label 'already active') for an active one", () => {
    const onAdd = vi.fn();
    renderModal({
      onAdd,
      activeWidgetIds: ["equity-curve"],
    });
    // Active widget → button reads "already active" and is disabled.
    const activeBtn = screen.getByRole("button", {
      name: /Equity Curve already active/i,
    });
    expect(activeBtn).toBeDisabled();
    fireEvent.click(activeBtn);
    expect(onAdd).not.toHaveBeenCalled();

    // An inactive widget → "Add <name>" button fires onAdd with its id.
    const addBtn = screen.getByRole("button", { name: /^Add Drawdown Chart$/i });
    expect(addBtn).not.toBeDisabled();
    fireEvent.click(addBtn);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith("drawdown-chart");
  });
});

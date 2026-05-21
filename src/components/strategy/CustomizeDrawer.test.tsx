/**
 * Phase 13 / Plan 13-02 / DISCO-02 — CustomizeDrawer component tests.
 *
 * Behaviour contract (per 13-02-PLAN.md Task 1 + 13-UI-SPEC.md State Matrix):
 *   1. open=false → drawer not in DOM (returns null).
 *   2. open=true → drawer rendered with role="dialog" + aria-modal="true" +
 *      aria-labelledby="customize-heading".
 *   3. ESC key closes (calls onClose).
 *   4. Click on backdrop closes (calls onClose).
 *   5. Click close-X closes; close-X aria-label = "Close customize panel".
 *   6. Heading text = "Customize" (NOT "Customize View").
 *   7. Description includes "Saved per device".
 *   8. Save button visible text = "Save preferences".
 *   9. Save button aria-label = "Save preferences" (WCAG 2.5.3).
 *  10. Save button disabled when draft === persisted (deep equality).
 *  11. Save button enables when draft differs.
 *  12. Reset button visible text = "Reset to defaults".
 *  13. Reset replaces draft with DEFAULTS; does NOT call onClose.
 *  14. Section headers exist for: "Default view", "Default sort", "Hide example strategies".
 *  15. Save click calls onSave.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { CustomizeDrawer } from "./CustomizeDrawer";
import { DEFAULTS, type DiscoveryViewPreferences } from "@/lib/discovery-prefs";

function renderDrawer(overrides: Partial<{
  open: boolean;
  draft: DiscoveryViewPreferences;
  persisted: DiscoveryViewPreferences;
  onClose: () => void;
  setDraft: (d: DiscoveryViewPreferences) => void;
  onSave: () => void;
}> = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const setDraft = overrides.setDraft ?? vi.fn();
  const onSave = overrides.onSave ?? vi.fn();
  const draft = overrides.draft ?? { ...DEFAULTS };
  const persisted = overrides.persisted ?? { ...DEFAULTS };
  const open = overrides.open ?? true;

  const utils = render(
    <CustomizeDrawer
      open={open}
      onClose={onClose}
      draft={draft}
      setDraft={setDraft}
      persisted={persisted}
      onSave={onSave}
    />,
  );
  return { ...utils, onClose, setDraft, onSave, draft, persisted };
}

describe("CustomizeDrawer", () => {
  it("renders nothing when open=false", () => {
    const { container } = renderDrawer({ open: false });
    expect(container.firstChild).toBeNull();
  });

  it("renders a dialog with aria-modal=true and aria-labelledby='customize-heading' when open=true", () => {
    renderDrawer({ open: true });
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("customize-heading");
  });

  it("ESC key calls onClose", () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking the backdrop calls onClose (selects via data-testid, not aria-hidden)", () => {
    // audit-2026-05-07 C-0133 — the previous selector
    // `container.querySelector('[aria-hidden="true"]')` matched the FIRST
    // aria-hidden element in DOM order. The drawer renders multiple
    // aria-hidden elements (backdrop + close-X SVG + inner SVG path);
    // a future JSX reorder would silently route the click to the wrong
    // element while keeping the assertion green (clicking the X also
    // calls onClose). Querying by `data-testid="customize-backdrop"`
    // pins the selector to the backdrop only.
    const onClose = vi.fn();
    const { container } = renderDrawer({ onClose });
    const backdrop = container.querySelector(
      '[data-testid="customize-backdrop"]',
    );
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("backdrop is exactly one element identified by data-testid (regression: C-0133)", () => {
    // Regression for audit-2026-05-07 C-0133. Asserts:
    //   (a) the backdrop is uniquely identifiable by data-testid, and
    //   (b) it carries aria-hidden="true" + the bg-black/40 class — so a
    //       refactor that strips the testid OR drops the visual backdrop
    //       fails this test loudly instead of falling back to the
    //       brittle first-aria-hidden selector.
    const { container } = renderDrawer();
    const matches = container.querySelectorAll(
      '[data-testid="customize-backdrop"]',
    );
    expect(matches).toHaveLength(1);
    const backdrop = matches[0];
    expect(backdrop.getAttribute("aria-hidden")).toBe("true");
    expect(backdrop.className).toMatch(/bg-black\/40/);
  });

  it("clicking the close-X button calls onClose; close-X aria-label = 'Close customize panel'", () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });
    const closeX = screen.getByLabelText("Close customize panel");
    fireEvent.click(closeX);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("heading text is 'Customize' (not 'Customize View')", () => {
    renderDrawer();
    const heading = document.getElementById("customize-heading");
    expect(heading).not.toBeNull();
    expect(heading!.textContent).toBe("Customize");
  });

  it("description includes 'Saved per device'", () => {
    renderDrawer();
    expect(screen.getByText(/Saved per device/i)).toBeDefined();
  });

  it("Save button visible text is 'Save preferences'", () => {
    renderDrawer();
    const saveBtn = screen.getByRole("button", { name: "Save preferences" });
    expect(saveBtn.textContent).toContain("Save preferences");
  });

  it("Save button aria-label is 'Save preferences' (WCAG 2.5.3 — Label in Name)", () => {
    renderDrawer();
    const saveBtn = screen.getByRole("button", { name: "Save preferences" });
    expect(saveBtn.getAttribute("aria-label")).toBe("Save preferences");
  });

  it("Save button is disabled when draft === persisted", () => {
    renderDrawer({
      draft: { ...DEFAULTS },
      persisted: { ...DEFAULTS },
    });
    const saveBtn = screen.getByRole("button", { name: "Save preferences" });
    expect(saveBtn.hasAttribute("disabled")).toBe(true);
  });

  it("Save button enables when draft differs from persisted (e.g., draft.view='grid', persisted.view='table')", () => {
    renderDrawer({
      draft: { ...DEFAULTS, view: "grid" },
      persisted: { ...DEFAULTS, view: "table" },
    });
    const saveBtn = screen.getByRole("button", { name: "Save preferences" });
    expect(saveBtn.hasAttribute("disabled")).toBe(false);
  });

  it("Reset button visible text is 'Reset to defaults'", () => {
    renderDrawer();
    const resetBtn = screen.getByRole("button", { name: "Reset to defaults" });
    expect(resetBtn.textContent).toContain("Reset to defaults");
  });

  it("clicking Reset replaces draft with DEFAULTS and does NOT call onClose", () => {
    const setDraft = vi.fn();
    const onClose = vi.fn();
    renderDrawer({
      setDraft,
      onClose,
      draft: { ...DEFAULTS, view: "grid", hide_examples: false },
    });
    const resetBtn = screen.getByRole("button", { name: "Reset to defaults" });
    fireEvent.click(resetBtn);
    expect(setDraft).toHaveBeenCalledWith(DEFAULTS);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders section headers for 'Default view', 'Default sort', and 'Hide example strategies'", () => {
    renderDrawer();
    expect(screen.getByText("Default view")).toBeDefined();
    expect(screen.getByText("Default sort")).toBeDefined();
    expect(screen.getByText("Hide example strategies")).toBeDefined();
  });

  it("clicking Save calls onSave", () => {
    const onSave = vi.fn();
    renderDrawer({
      draft: { ...DEFAULTS, view: "grid" },
      persisted: { ...DEFAULTS, view: "table" },
      onSave,
    });
    const saveBtn = screen.getByRole("button", { name: "Save preferences" });
    fireEvent.click(saveBtn);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("focuses the heading when opened (initial focus)", () => {
    renderDrawer({ open: true });
    const heading = document.getElementById("customize-heading");
    expect(heading).not.toBeNull();
    expect(document.activeElement).toBe(heading);
  });

  it("restores focus to the previously-focused element on close", () => {
    const opener = document.createElement("button");
    opener.textContent = "Opener";
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);
    const { rerender } = render(
      <CustomizeDrawer
        open
        onClose={() => {}}
        draft={{ ...DEFAULTS }}
        setDraft={() => {}}
        persisted={{ ...DEFAULTS }}
        onSave={() => {}}
      />,
    );
    rerender(
      <CustomizeDrawer
        open={false}
        onClose={() => {}}
        draft={{ ...DEFAULTS }}
        setDraft={() => {}}
        persisted={{ ...DEFAULTS }}
        onSave={() => {}}
      />,
    );
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("Tab from the last focusable cycles back to the first (focus trap)", () => {
    const { container } = renderDrawer({ open: true });
    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(focusables.length).toBeGreaterThan(1);
    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(focusables[0]);
  });

  it("Shift+Tab from heading cycles to the last focusable (focus trap, shift direction)", () => {
    const { container } = renderDrawer({ open: true });
    const heading = document.getElementById("customize-heading")!;
    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    heading.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(focusables[focusables.length - 1]);
  });

  it("Tab fired while focus is outside the drawer pulls it back inside", () => {
    const stray = document.createElement("button");
    stray.textContent = "Outside";
    document.body.appendChild(stray);
    const { container } = renderDrawer({ open: true });
    stray.focus();
    expect(document.activeElement).toBe(stray);
    fireEvent.keyDown(document, { key: "Tab" });
    const firstFocusable = container.querySelector<HTMLElement>(
      'button:not([disabled])',
    );
    expect(document.activeElement).toBe(firstFocusable);
    stray.remove();
  });
});

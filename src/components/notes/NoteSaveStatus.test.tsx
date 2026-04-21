/**
 * Phase 08 Plan 03 — NoteSaveStatus.test.tsx
 *
 * Five copy states (UI-SPEC §7) + role/aria attrs.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NoteSaveStatus } from "./NoteSaveStatus";

describe("NoteSaveStatus", () => {
  it("saving → renders 'Saving…'", () => {
    render(<NoteSaveStatus saveState="saving" lastSavedAt={null} />);
    expect(screen.getByTestId("note-save-status").textContent).toContain(
      "Saving\u2026",
    );
  });

  it("saved → renders 'Note saved' flash", () => {
    render(
      <NoteSaveStatus saveState="saved" lastSavedAt={new Date()} />,
    );
    expect(screen.getByTestId("note-save-status").textContent).toContain(
      "Note saved",
    );
  });

  it("idle + no lastSavedAt → renders empty (no noise)", () => {
    render(<NoteSaveStatus saveState="idle" lastSavedAt={null} />);
    const node = screen.getByTestId("note-save-status");
    expect((node.textContent ?? "").trim()).toBe("");
  });

  it("idle + lastSavedAt (30s ago) → renders 'Last saved:' + relative time", () => {
    const fixedNow = 1_700_000_000_000;
    const lastSaved = new Date(fixedNow - 30_000);
    render(
      <NoteSaveStatus
        saveState="idle"
        lastSavedAt={lastSaved}
        now={fixedNow}
      />,
    );
    const text = screen.getByTestId("note-save-status").textContent ?? "";
    expect(text).toContain("Last saved:");
    // formatRelativeTime returns "just now" for <60s deltas.
    expect(text).toContain("just now");
  });

  it("error → renders 'Save failed — retry'", () => {
    render(<NoteSaveStatus saveState="error" lastSavedAt={null} />);
    expect(screen.getByTestId("note-save-status").textContent).toContain(
      "Save failed \u2014 retry",
    );
  });

  it("wrapper carries role='status', aria-live='polite', data-testid", () => {
    render(<NoteSaveStatus saveState="idle" lastSavedAt={null} />);
    const node = screen.getByTestId("note-save-status");
    expect(node.getAttribute("role")).toBe("status");
    expect(node.getAttribute("aria-live")).toBe("polite");
    expect(node.getAttribute("data-testid")).toBe("note-save-status");
  });
});

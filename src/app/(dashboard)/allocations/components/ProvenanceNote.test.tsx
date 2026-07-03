import { describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ProvenanceNote } from "./ProvenanceNote";

/**
 * Phase 59 / 59-02 Task 1 — ProvenanceNote (PERSIST-01).
 *
 * The pre-coverage-window upgrade note, shown ONLY when reopening a pre-v1.5
 * (v2, windowless) saved scenario that the codec upgraded on read and whose
 * window defaulted to the intersection. It reuses `DefaultChangeNote`'s
 * `role="status"` shell + DESIGN.md tokens, but its dismissal is EPHEMERAL
 * per-open (component-local `useState`), NOT the POLISH-03 `useCrossTabStorage`
 * localStorage flag.
 *
 * These tests pin: the locked copy renders; "Show full range" calls the escape
 * hatch; the × dismiss hides the note; and — the KEY divergence from POLISH-03 —
 * remounting (a fresh reopen of another old draft) RE-SHOWS the note. A static
 * guard proves the component never reaches for `useCrossTabStorage` or the
 * POLISH-03 localStorage key.
 */

const LOCKED_COPY = /predates coverage windows/;
const POLISH03_KEY = "composer.coverageDefaultChangeNoteDismissed";

describe("ProvenanceNote (PERSIST-01)", () => {
  it("renders the locked copy inside a role=status live region (never role=alert)", () => {
    const { container } = render(<ProvenanceNote onShowFullRange={() => {}} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    // Copy is interpolated across a text node + a button; assert the composed
    // textContent of the note.
    const note = screen.getByTestId("scenario-provenance-note");
    expect(note.textContent).toMatch(LOCKED_COPY);
    expect(note.textContent).toContain("showing the common period");
    expect(note.textContent).toContain("Show full range");
  });

  it("'Show full range' calls onShowFullRange (the escape hatch)", () => {
    const onShowFullRange = vi.fn();
    render(<ProvenanceNote onShowFullRange={onShowFullRange} />);
    const btn = screen.getByRole("button", { name: /Show full range/i });
    fireEvent.click(btn);
    expect(onShowFullRange).toHaveBeenCalledTimes(1);
  });

  it("ship-review RT-2: 'Show full range' DISMISSES the note — the banner may not keep claiming 'showing the common period' over a full-range window", async () => {
    // WHY: the escape hatch applies the UNION window. If the note survived the
    // click, its locked "showing the common period" copy would be false over
    // the new window — stale-dishonest copy. Taking the action dismisses it
    // (belt), alongside the composer's active-window-is-common-period render
    // gate (braces).
    const onShowFullRange = vi.fn();
    render(<ProvenanceNote onShowFullRange={onShowFullRange} />);
    fireEvent.click(screen.getByRole("button", { name: /Show full range/i }));
    expect(onShowFullRange).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(
        screen.queryByTestId("scenario-provenance-note"),
      ).not.toBeInTheDocument();
    });
  });

  it("the × dismiss hides the note", async () => {
    render(<ProvenanceNote onShowFullRange={() => {}} />);
    const dismiss = screen.getByRole("button", { name: /Dismiss/i });
    fireEvent.click(dismiss);
    await waitFor(() => {
      expect(screen.queryByText(LOCKED_COPY)).not.toBeInTheDocument();
    });
  });

  it("dismissal is EPHEMERAL per-open: a remount (a fresh reopen of another old draft) RE-SHOWS the note", async () => {
    // Open #1 — dismiss it.
    const first = render(<ProvenanceNote onShowFullRange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/i }));
    await waitFor(() => {
      expect(screen.queryByText(LOCKED_COPY)).not.toBeInTheDocument();
    });
    // Fully unmount (simulating the composer tearing down the note between opens).
    first.unmount();

    // Open #2 — a fresh mount for ANOTHER reopened old draft. Because dismissal
    // is component-local (NOT a persisted global flag), the note MUST re-appear.
    act(() => {
      render(<ProvenanceNote onShowFullRange={() => {}} />);
    });
    expect(screen.getByTestId("scenario-provenance-note")).toBeInTheDocument();
    expect(screen.getByText(LOCKED_COPY)).toBeInTheDocument();
  });

  it("MEMBER-04 membership variant: a `message` + `testId` render a plain note with NO 'Show full range' action; the × still dismisses ephemerally", async () => {
    // The v1.6 membership variant reuses the ephemeral shell but passes a plain
    // message and NO onShowFullRange — a dropped data source has no "full range"
    // to restore, so the inline action must be absent.
    render(
      <ProvenanceNote
        testId="scenario-membership-note"
        message="A data source saved with this scenario is no longer available — showing the remaining sources."
      />,
    );
    const note = screen.getByTestId("scenario-membership-note");
    expect(note).toBeInTheDocument();
    expect(note.textContent).toContain("no longer available");
    // No escape-hatch action in this variant.
    expect(
      screen.queryByRole("button", { name: /Show full range/i }),
    ).not.toBeInTheDocument();
    // The window-note copy must NOT bleed into the membership variant.
    expect(note.textContent).not.toMatch(LOCKED_COPY);

    // Dismissal is ephemeral component-local state (same shell).
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/i }));
    await waitFor(() => {
      expect(
        screen.queryByTestId("scenario-membership-note"),
      ).not.toBeInTheDocument();
    });
  });

  it("STATIC GUARD: ephemeral dismissal — no useCrossTabStorage, no POLISH-03 key, no raw localStorage; verbatim copy; role=status", () => {
    const src = readFileSync(
      path.resolve(
        process.cwd(),
        "src/app/(dashboard)/allocations/components/ProvenanceNote.tsx",
      ),
      "utf8",
    );
    // The KEY divergence: dismissal must be ephemeral, not the POLISH-03 global.
    expect(src).not.toContain("useCrossTabStorage");
    expect(src).not.toContain(POLISH03_KEY);
    expect(src).not.toContain("localStorage");
    // Ephemeral dismissal is a component-local useState.
    expect(src).toContain("useState");
    // Locked copy + a11y contract.
    expect(src).toContain("This saved scenario predates coverage windows");
    expect(src).toContain('role="status"');
    expect(src).not.toContain('role="alert"');
  });
});

/**
 * Phase 50 / Plan 50-01 / UI-02 — Field primitive RED contract.
 *
 * RED (Wave 0): `src/components/ui/Field.tsx` does NOT exist yet — this spec
 * fails on the import until Wave-1 Plan 03 builds the label+aria wrapper. The
 * contract precedes the implementation by design (BP-03).
 *
 * Behaviour contract (50-UI-SPEC.md §Field + 50-RESEARCH.md Pattern 6):
 *   1. label↔control wired via htmlFor/id — getByLabelText(label) resolves the
 *      control (id generated via useId() when not supplied).
 *   2. aria-describedby on the control joins BOTH the hint id and the error id
 *      (space-separated) — this is the gap the hand-wired wizard forms leave
 *      open (CsvUploadStep wires aria-invalid but NOT aria-describedby).
 *   3. aria-invalid="true" when error is set; absent (no truthy value) when no
 *      error.
 *
 * RTL getByLabelText pattern; render convention from CardShell.test.tsx.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field } from "./Field";

describe("<Field> (label + control + hint + error a11y wrapper)", () => {
  it("wires label to control via htmlFor/id (getByLabelText resolves it)", () => {
    render(
      <Field label="Strategy name">
        <input type="text" />
      </Field>,
    );
    const control = screen.getByLabelText("Strategy name");
    expect(control.tagName).toBe("INPUT");
  });

  it("aria-describedby joins BOTH the hint id and the error id (space-separated)", () => {
    render(
      <Field label="Strategy name" hint="Up to 60 characters" error="Required">
        <input type="text" />
      </Field>,
    );
    const control = screen.getByLabelText("Strategy name");
    const describedBy = control.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const ids = (describedBy ?? "").split(/\s+/).filter(Boolean);
    // Both descriptors must be referenced, and each id must resolve to an
    // element actually carrying the hint / error text.
    const hint = screen.getByText("Up to 60 characters");
    const errorEl = screen.getByText("Required");
    expect(ids).toContain(hint.id);
    expect(ids).toContain(errorEl.id);
    expect(ids).toHaveLength(2);
  });

  it("sets aria-invalid=true on the control when error is present", () => {
    render(
      <Field label="Strategy name" error="Required">
        <input type="text" />
      </Field>,
    );
    expect(screen.getByLabelText("Strategy name").getAttribute("aria-invalid")).toBe(
      "true",
    );
  });

  it("does not set a truthy aria-invalid when no error is present", () => {
    render(
      <Field label="Strategy name" hint="Up to 60 characters">
        <input type="text" />
      </Field>,
    );
    const control = screen.getByLabelText("Strategy name");
    // Either the attribute is absent, or it is explicitly "false" — never "true".
    expect(control.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("describedby references only the hint when there is no error", () => {
    render(
      <Field label="Strategy name" hint="Up to 60 characters">
        <input type="text" />
      </Field>,
    );
    const control = screen.getByLabelText("Strategy name");
    const ids = (control.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .filter(Boolean);
    const hint = screen.getByText("Up to 60 characters");
    expect(ids).toEqual([hint.id]);
  });
});

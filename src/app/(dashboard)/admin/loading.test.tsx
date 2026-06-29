/**
 * STATE-05 — `(dashboard)/admin/loading.tsx` shared skeleton contract.
 *
 * The coverage ratchet (vitest.config.ts) is a blocking CI gate; every new
 * route file carries a render test in the same change. The skeleton has no
 * props/logic, so a smoke-render asserting the `role="status"` liveness node
 * and the dominant data-table anchor structure is sufficient for the gate.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import AdminLoading from "./loading";

describe("(dashboard)/admin/loading.tsx — shared skeleton", () => {
  it("renders the sr-only role=status liveness node with the surface copy", () => {
    render(<AdminLoading />);
    const status = screen.getByRole("status");
    expect(status).toBeTruthy();
    expect(status.textContent).toMatch(/loading admin/i);
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.className).toContain("sr-only");
  });

  it("renders the data-table-anchor structure (header rule + N rows)", () => {
    const { container } = render(<AdminLoading />);
    // The table-anchor block is the `border bg-surface` container.
    const block = container.querySelector(".border.border-border.bg-surface");
    expect(block).toBeTruthy();
    // One header rule + 8 placeholder rows; assert the row count is the anchor.
    const rows = block?.querySelectorAll(":scope > div") ?? [];
    expect(rows.length).toBe(9); // 1 header rule + 8 rows
  });
});

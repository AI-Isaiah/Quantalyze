/**
 * Phase 50 / Plan 50-01 / UI-01 — Modal refresh LOCK test.
 *
 * LOCK: Modal.tsx already exists and renders; these assertions are RED NOW
 * (the source still ships the title as `text-lg` and the close button has NO
 * focus ring) and become the GREEN gate for the Wave-1 Plan 02 refresh. The
 * Modal stays a native <dialog> (UI-04 — NOT swapped to Radix Dialog); the
 * refresh only migrates the title tier and adds a keyboard focus ring on the
 * close button.
 *
 * Behaviour contract (50-UI-SPEC.md §Modal + §Typography migration map):
 *   - title element → text-h3 (NOT text-lg)
 *   - close button (aria-label="Close") → focus-visible:ring (none today)
 *
 * jsdom does not implement HTMLDialogElement.showModal()/close(); stub them
 * before rendering (pattern borrowed verbatim from AdminTabs.test.tsx:33-46).
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Modal } from "./Modal";

// jsdom lacks HTMLDialogElement.showModal()/close(); the Modal's useEffect
// calls them when `open` is true. Stub them so rendering an open Modal does
// not throw (AdminTabs.test.tsx:33-46).
if (typeof HTMLDialogElement !== "undefined") {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
      (this as unknown as { open: boolean }).open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
      (this as unknown as { open: boolean }).open = false;
    };
  }
}

describe("<Modal> title tier + close focus-visible lock", () => {
  it("renders the title on the fluid text-h3 tier, not bare text-lg", () => {
    render(
      <Modal open title="Confirm" onClose={() => {}}>
        <p>Body</p>
      </Modal>,
    );
    const title = screen.getByText("Confirm");
    expect(title.className).toMatch(/\btext-h3\b/);
    expect(title.className).not.toMatch(/\btext-lg\b/);
  });

  it("close button exposes a keyboard focus-visible ring", () => {
    render(
      <Modal open title="Confirm" onClose={() => {}}>
        <p>Body</p>
      </Modal>,
    );
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.className).toMatch(/focus-visible:ring/);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RequestCallModal } from "./RequestCallModal";

/**
 * G9.B.20 regression — the mailto fallback link must fire the
 * `for_quants_request_call_click` *intent* event with `source: "mailto"`,
 * NOT the `for_quants_lead_submit` *conversion* event. Conflating click →
 * conversion silently inflated CTR before commit b82e78d. Pin both the
 * event name AND the source tag here so a refactor that flips either back
 * fails in unit tests, not only in PostHog dashboards weeks later.
 */

vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: vi.fn(),
}));

import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";

const trackMock = vi.mocked(trackForQuantsEventClient);

beforeEach(() => {
  trackMock.mockClear();
  // Polyfill jsdom's missing HTMLDialogElement methods so <Modal> can
  // showModal()/close() without throwing.
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
    };
  }
});

describe("<RequestCallModal> mailto fallback (G9.B.20)", () => {
  it("fires for_quants_request_call_click with source='mailto', not for_quants_lead_submit", () => {
    render(
      <RequestCallModal
        open={true}
        onClose={() => {}}
        ctaLocation="hero"
      />,
    );

    // Find the mailto link by its visible label
    const mailtoLink = screen.getByText("security@quantalyze.com");
    // The mount-time effect fires `for_quants_request_call_click` once
    // with cta_location only; clear so we observe ONLY the click event.
    trackMock.mockClear();

    fireEvent.click(mailtoLink);

    // Asserts the rename: must NOT use the conversion event name.
    const calledEventNames = trackMock.mock.calls.map((c) => c[0]);
    expect(calledEventNames).not.toContain("for_quants_lead_submit");
    expect(calledEventNames).toContain("for_quants_request_call_click");

    // Asserts the source tag: 'mailto', not 'modal'.
    const clickCall = trackMock.mock.calls.find(
      (c) => c[0] === "for_quants_request_call_click",
    );
    expect(clickCall).toBeDefined();
    expect(clickCall![1]).toMatchObject({ source: "mailto" });
    expect(clickCall![1]).not.toMatchObject({ source: "modal" });
  });

  it("the mailto anchor href targets security@quantalyze.com", () => {
    // Defensive pin so a refactor that swaps the address (and the
    // structured-vs-mailto fallback semantic) surfaces here too.
    render(
      <RequestCallModal
        open={true}
        onClose={() => {}}
        ctaLocation="hero"
      />,
    );
    const mailtoLink = screen.getByText("security@quantalyze.com")
      .closest("a") as HTMLAnchorElement;
    expect(mailtoLink).not.toBeNull();
    expect(mailtoLink.getAttribute("href")).toMatch(
      /^mailto:security@quantalyze\.com/,
    );
  });
});

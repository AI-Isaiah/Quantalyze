import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { AlertBanner } from "./AlertBanner";

// ---------------------------------------------------------------------------
// Phase 199 plan 05 (ROUTE-11, D-04). The alerts-check failure is a read_failure
// degrade warning: it says what failed AND what to do (A-RELOAD), and renders its
// words from the registry. Why this test exists: before 199-05 the line read only
// "Couldn't verify critical alerts." and named no action, so a reader could not tell
// a transient failure from "no alerts". Expected strings are typed by hand.
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(response: { ok: boolean; status: number; body?: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: response.ok,
      status: response.status,
      json: async () => response.body ?? { alerts: [] },
    })),
  );
}

describe("AlertBanner: the alerts-check failure names its action (read_failure, A-RELOAD)", () => {
  it("a 5xx reads the verify failure, then the reload action, from the registry entry", async () => {
    stubFetch({ ok: false, status: 503 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<AlertBanner portfolioId="p1" />);
    const note = await screen.findByRole("status");
    expect(note.textContent).toBe("Couldn't verify critical alerts. Reload this page to try again.");
    // The live region is the paragraph; the registry marker sits inside it.
    expect(note.tagName).toBe("P");
    expect(container.querySelectorAll('[data-degrade-id="allocation.alerts-unverified"]')).toHaveLength(1);
  });

  it("a 4xx is advisory and prints nothing (the shipped under-disclose rule is unchanged)", async () => {
    stubFetch({ ok: false, status: 403 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<AlertBanner portfolioId="p1" />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("a successful empty read prints nothing", async () => {
    stubFetch({ ok: true, status: 200, body: { alerts: [] } });
    const { container } = render(<AlertBanner portfolioId="p1" />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});

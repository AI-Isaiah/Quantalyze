import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Phase 07 Plan 05 Task 1 — TDD Red gate tests for EmptyState
 * (PURGE-04 / D-07 / D-08).
 *
 * Covered behaviours:
 *   1. hasSyncing=false → centred empty-state card renders:
 *        - heading "No positions to analyze yet." visible
 *        - CTA link has href="/profile?tab=exchanges" (Phase 06 IA)
 *        - CTA label contains "Connect Exchange"
 *   2. hasSyncing=true → InfoBanner with first-sync copy visible;
 *      the "No positions to analyze yet." heading is ABSENT.
 *   3. D-07 minimalism gate: at hasSyncing=false, rendered DOM has
 *      exactly ONE <a> element (the CTA). No <img>, <svg>, <ol>, <ul>.
 *   4. Route invariance: regardless of hasSyncing, every <a> containing
 *      "Connect Exchange" points to /profile?tab=exchanges exactly
 *      (not /connections, not /exchanges).
 */

// next/link is a client component; jsdom handles it fine without mocking.
// We purposely do NOT mock the InfoBanner / Card primitives — we want the
// full rendered DOM so the minimalism gate (no illustration, no 3-step
// explainer) is a real assertion on the live tree.

// --- Import under test (no mocks needed) -----------------------------------

import { EmptyState } from "./EmptyState";

describe("EmptyState — PURGE-04 / D-07 / D-08", () => {
  it("Test 1 (zero holdings, no syncing, no keys): renders the empty-state card with heading + CTA to /profile?tab=exchanges", () => {
    render(<EmptyState hasSyncing={false} hasConnectedKeys={false} />);

    // Heading is present (verbatim from UI-SPEC.md §Copywriting).
    expect(
      screen.getByText("No positions to analyze yet."),
    ).toBeInTheDocument();

    // CTA link is present with exact href.
    const ctaLinks = screen.getAllByRole("link");
    const cta = ctaLinks.find((a) =>
      (a.textContent ?? "").includes("Connect Exchange"),
    );
    expect(cta, "Connect Exchange CTA link must exist").toBeDefined();
    expect(cta!.getAttribute("href")).toBe("/profile?tab=exchanges");
  });

  it("Test 2 (syncing): renders the first-sync InfoBanner; empty-state heading absent", () => {
    render(<EmptyState hasSyncing={true} hasConnectedKeys={false} />);

    // First-sync copy (verbatim from UI-SPEC.md §Copywriting, em-dash U+2014).
    expect(
      screen.getByText(
        "Syncing your first positions — this usually takes under a minute.",
      ),
    ).toBeInTheDocument();

    // Empty-state heading must NOT render when syncing.
    expect(
      screen.queryByText("No positions to analyze yet."),
    ).not.toBeInTheDocument();
  });

  it("Test 3 (D-07 minimalism): hasSyncing=false renders exactly one <a>, zero <img>/<svg>/<ol>/<ul>", () => {
    const { container } = render(
      <EmptyState hasSyncing={false} hasConnectedKeys={false} />,
    );

    // D-07: single headline + single sub-line + single primary button.
    // The button is a next/link <a>; it is the ONLY anchor in the tree.
    const anchors = container.querySelectorAll("a");
    expect(anchors.length).toBe(1);

    // No illustration.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();

    // No 3-step explainer list.
    expect(container.querySelector("ol")).toBeNull();
    expect(container.querySelector("ul")).toBeNull();
  });

  it("Test 4 (route invariance): every Connect Exchange link points to /profile?tab=exchanges — not /connections, not /exchanges", () => {
    // hasSyncing=false surfaces the CTA link. We do not check hasSyncing=true
    // because in that branch the component renders only the InfoBanner with
    // no link — consistent with the spec (first-sync state doesn't need a
    // redundant CTA; the key is already connected).
    const { unmount } = render(
      <EmptyState hasSyncing={false} hasConnectedKeys={false} />,
    );
    for (const a of screen.getAllByRole("link")) {
      if ((a.textContent ?? "").includes("Connect Exchange")) {
        const href = a.getAttribute("href") ?? "";
        expect(href).toBe("/profile?tab=exchanges");
        expect(href).not.toBe("/connections");
        expect(href).not.toBe("/exchanges");
      }
    }
    unmount();
  });
});

/**
 * Phase 110.1 Plan 01 Task 1 — DOGFOOD-1 three-way branch.
 *
 * The pre-110.1 EmptyState only knew `hasSyncing`, so an allocator with
 * connected+synced keys but zero open positions was told to "Connect a
 * read-only exchange API key" — actively wrong (they already have keys).
 * The new `hasConnectedKeys` signal splits the non-syncing empty state into:
 *   - no keys   → existing connect CTA (unchanged copy).
 *   - has keys  → honest "connected · nothing synced yet" + a Manage-exchanges
 *                 link (NOT a Connect CTA).
 */
describe("EmptyState — DOGFOOD-1 connected-but-empty (110.1)", () => {
  it("Test A (regression): connected + not syncing → honest copy, Manage-exchanges link, NO connect CTA", () => {
    const { container } = render(
      <EmptyState hasSyncing={false} hasConnectedKeys={true} />,
    );

    // Same headline as the no-keys card.
    expect(
      screen.getByText("No positions to analyze yet."),
    ).toBeInTheDocument();

    // The misleading connect copy must be ABSENT — this is the bug being fixed.
    expect(
      screen.queryByText(/Connect a read-only exchange API key/),
    ).not.toBeInTheDocument();

    // Exactly one anchor, and it points to Manage exchanges — not a Connect CTA.
    const anchors = container.querySelectorAll("a");
    expect(anchors.length).toBe(1);
    const link = anchors[0];
    expect(link.getAttribute("href")).toBe("/profile?tab=exchanges");
    expect(link.textContent ?? "").toContain("Manage exchanges");
    expect(link.textContent ?? "").not.toContain("Connect Exchange");

    // Minimalism gate holds for this branch too: no illustration, no list.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("ol")).toBeNull();
    expect(container.querySelector("ul")).toBeNull();
  });

  it("Test B: no keys + not syncing → existing connect CTA is unchanged", () => {
    render(<EmptyState hasSyncing={false} hasConnectedKeys={false} />);

    expect(
      screen.getByText(
        "Connect a read-only exchange API key to see your real holdings and performance.",
      ),
    ).toBeInTheDocument();

    const cta = screen
      .getAllByRole("link")
      .find((a) => (a.textContent ?? "").includes("Connect Exchange"));
    expect(cta, "Connect Exchange CTA must exist for the no-keys branch").toBeDefined();
    expect(cta!.getAttribute("href")).toBe("/profile?tab=exchanges");
  });

  it("Test C: syncing overrides the keys signal → InfoBanner branch unchanged, no card heading", () => {
    for (const hasConnectedKeys of [true, false]) {
      const { unmount } = render(
        <EmptyState hasSyncing={true} hasConnectedKeys={hasConnectedKeys} />,
      );
      expect(
        screen.getByText(
          "Syncing your first positions — this usually takes under a minute.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("No positions to analyze yet."),
      ).not.toBeInTheDocument();
      unmount();
    }
  });
});

// Vitest treats empty `vi.fn()` references as unused otherwise.
vi.fn();

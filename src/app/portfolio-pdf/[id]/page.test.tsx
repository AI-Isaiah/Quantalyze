/** @vitest-environment jsdom */
/**
 * Phase 195 TRIM (D-03) — `/portfolio-pdf/<id>` is a named, data-free "report
 * retired" landing page.
 *
 * Why this matters: an old share link must never land on a login wall, a 404
 * or a generic error, and it must not read a stored portfolio any more (the
 * renderer and its render-token gate are deleted). So the contract is: the same
 * page for ANY id, with or without a render token, and no database client is
 * ever constructed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";

const adminClientSpy = vi.hoisted(() => vi.fn());
const serverClientSpy = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminClientSpy }));
vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientSpy }));

import PortfolioReportRetiredPage, { metadata } from "./page";

// The page takes no props. Calling it WITH route props proves it ignores them
// (an id, a malformed id, a renderToken) instead of just never being handed any.
const callWithProps = PortfolioReportRetiredPage as unknown as (
  props: unknown,
) => ReactElement;

const CASES = [
  {
    label: "a well-formed id",
    props: {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
      searchParams: Promise.resolve({}),
    },
  },
  {
    label: "a malformed id",
    props: {
      params: Promise.resolve({ id: "not-a-uuid" }),
      searchParams: Promise.resolve({}),
    },
  },
  {
    label: "a renderToken query",
    props: {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
      searchParams: Promise.resolve({ renderToken: "1700000000.deadbeef" }),
    },
  },
];

afterEach(() => {
  cleanup();
  adminClientSpy.mockClear();
  serverClientSpy.mockClear();
});

describe("/portfolio-pdf/[id] retired page", () => {
  for (const { label, props } of CASES) {
    it(`renders the retired notice for ${label} and reads nothing`, () => {
      const { container } = render(callWithProps(props));

      expect(
        screen.getByRole("heading", {
          level: 1,
          name: "This portfolio report has been retired",
        }),
      ).toBeTruthy();
      expect(container.querySelectorAll("h1")).toHaveLength(1);
      expect(container.querySelectorAll("main")).toHaveLength(1);

      // The "reads nothing" proof: no admin or user database client is built.
      expect(adminClientSpy).not.toHaveBeenCalled();
      expect(serverClientSpy).not.toHaveBeenCalled();
    });
  }

  it("points both CTAs at live destinations", () => {
    render(callWithProps(CASES[0].props));
    const browse = screen.getByRole("link", {
      name: "Browse verified strategies",
    });
    const allocations = screen.getByRole("link", { name: "Open My Allocation" });
    expect(browse.getAttribute("href")).toBe("/browse");
    expect(allocations.getAttribute("href")).toBe("/allocations");
  });

  it("states the retirement date and carries no disclaimer block (it shows no figures)", () => {
    const { container } = render(callWithProps(CASES[0].props));
    expect(screen.getByText("Retired 2026-11-07")).toBeTruthy();
    // LegalFooter is navigation and stays; the risk disclaimer must not appear.
    expect(screen.getByRole("navigation", { name: "Legal" })).toBeTruthy();
    expect(container.textContent).not.toMatch(/Past performance/i);
    expect(container.textContent).not.toMatch(/asset custody/i);
  });

  it("is noindex with its own tab title", () => {
    expect(metadata.robots).toBe("noindex");
    expect(metadata.title).toBe("Portfolio report retired");
  });
});

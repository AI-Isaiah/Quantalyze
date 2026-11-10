/** @vitest-environment jsdom */
/**
 * Phase 196 D-01 / ROUTE-04 — BackLink render arms.
 *
 * WHY: the label and href must come from the resolved target, the arrow is
 * decorative (aria-hidden) so the accessible name is exactly the label, and
 * the no-origin control must be a working Back (same-origin history only) or a
 * fixed same-origin "Go to Discovery". A test that only checks the happy label
 * cannot fail when the history branch starts following an off-site referrer.
 */
import { renderToString } from "react-dom/server";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { DISCOVERY_LANDING_ROUTE } from "@/lib/routing/default-route";
import { BackLink } from "./BackLink";

function setHistory(referrer: string, length: number) {
  vi.spyOn(document, "referrer", "get").mockReturnValue(referrer);
  vi.spyOn(window.history, "length", "get").mockReturnValue(length);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BackLink with a named target", () => {
  it("renders the named target as a link with a decorative arrow", () => {
    const { container } = render(
      <BackLink target={{ label: "Back to Discovery", href: "/discovery/crypto-sma" }} />,
    );
    const link = screen.getByRole("link", { name: "Back to Discovery" });
    expect(link).toHaveAttribute("href", "/discovery/crypto-sma");
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe("←");
  });

  it("ignores history even with a same-origin referrer", () => {
    setHistory(`${window.location.origin}/somewhere`, 5);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    render(<BackLink target={{ label: "Back to Admin", href: "/admin" }} />);
    fireEvent.click(screen.getByRole("link", { name: "Back to Admin" }));
    expect(back).not.toHaveBeenCalled();
  });
});

describe("the Discovery landing constant", () => {
  // Every other Discovery assertion compares against the constant, so a
  // retarget (say to the role home) would pass them all. This literal is what
  // makes "Go to Discovery" and "Back to Discovery" testable (R-01, T-199-32).
  it("is the Discovery path", () => {
    expect(DISCOVERY_LANDING_ROUTE).toBe("/discovery/crypto-sma");
  });
});

describe("BackLink with no origin", () => {
  it("server-renders Go to Discovery regardless of referrer", () => {
    setHistory(`${window.location.origin}/somewhere`, 5);
    const html = renderToString(<BackLink target={null} />);
    expect(html).toContain("Go to Discovery");
    expect(html).toContain(`href="${DISCOVERY_LANDING_ROUTE}"`);
    expect(html).not.toContain(">Back<");
  });

  it("after mount, a same-origin referrer with history reads Back and calls history.back()", async () => {
    setHistory(`${window.location.origin}/somewhere`, 3);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    await act(async () => {
      render(<BackLink target={null} />);
    });
    const link = screen.getByRole("link", { name: "Back" });
    expect(link).toHaveAttribute("href", DISCOVERY_LANDING_ROUTE);
    const notPrevented = fireEvent.click(link);
    expect(back).toHaveBeenCalledTimes(1);
    // preventDefault was called: the href is not followed.
    expect(notPrevented).toBe(false);
  });

  it("an off-site referrer stays on Go to Discovery and never calls history.back()", async () => {
    setHistory("https://evil.example/page", 3);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    await act(async () => {
      render(<BackLink target={null} />);
    });
    const link = screen.getByRole("link", { name: "Go to Discovery" });
    expect(link).toHaveAttribute("href", DISCOVERY_LANDING_ROUTE);
    fireEvent.click(link);
    expect(back).not.toHaveBeenCalled();
  });

  it("an empty referrer stays on Go to Discovery", async () => {
    setHistory("", 3);
    await act(async () => {
      render(<BackLink target={null} />);
    });
    expect(screen.getByRole("link", { name: "Go to Discovery" })).toBeInTheDocument();
  });

  it("a malformed referrer stays on Go to Discovery", async () => {
    setHistory("not a url", 3);
    await act(async () => {
      render(<BackLink target={null} />);
    });
    expect(screen.getByRole("link", { name: "Go to Discovery" })).toBeInTheDocument();
  });

  it("a same-origin referrer with no history to go back to stays on Go to Discovery", async () => {
    setHistory(`${window.location.origin}/somewhere`, 1);
    await act(async () => {
      render(<BackLink target={null} />);
    });
    expect(screen.getByRole("link", { name: "Go to Discovery" })).toBeInTheDocument();
  });
});

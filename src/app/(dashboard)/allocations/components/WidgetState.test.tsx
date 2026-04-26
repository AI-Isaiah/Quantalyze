import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WidgetState } from "./WidgetState";

/**
 * Phase 11 / Plan 04 / D-10 — Unit tests for the shared <WidgetState>
 * primitive. Tests assert the locked 5-mode dispatcher contract:
 *   - mode='loading'  → Card with aria-busy + animate-pulse skeleton
 *   - mode='empty'    → centered Card with optional title/description/CTA
 *   - mode='partial'  → dual-ARIA pill (visible aria-hidden + sr-only sibling)
 *   - mode='error'    → role='alert' Card with optional Retry button
 *   - mode='success'  → bare children with NO Card chrome
 *
 * Test 8 enforces the Pitfall-4 stateless contract by reading the source
 * file via fs.readFileSync (NO child_process / execSync — security hook).
 */
describe("<WidgetState>", () => {
  it("Test 1: mode='loading' renders a Card with aria-busy and animate-pulse skeleton", () => {
    const { container } = render(<WidgetState mode="loading" />);
    const busy = container.querySelector("[aria-busy='true']");
    expect(busy).not.toBeNull();
    const pulse = container.querySelector(".animate-pulse");
    expect(pulse).not.toBeNull();
  });

  it("Test 2: mode='empty' with no empty prop renders a centered Card without error styling", () => {
    const { container } = render(<WidgetState mode="empty" />);
    // No role='alert' — empty is presentational, not an alert.
    expect(container.querySelector("[role='alert']")).toBeNull();
    // Centered Card chrome reused from EmptyState pattern.
    expect(container.querySelector(".text-center")).not.toBeNull();
  });

  it("Test 3: mode='empty' with title/description/CTA renders all three", () => {
    render(
      <WidgetState
        mode="empty"
        empty={{
          title: "Nothing to show yet",
          description: "Connect a key to populate this widget.",
          ctaHref: "/x",
          ctaLabel: "Go",
        }}
      />,
    );
    expect(screen.getByText("Nothing to show yet")).toBeDefined();
    expect(
      screen.getByText("Connect a key to populate this widget."),
    ).toBeDefined();
    const link = screen.getByRole("link", { name: "Go" }) as HTMLAnchorElement;
    expect(link).toBeDefined();
    expect(link.getAttribute("href")).toBe("/x");
  });

  it("Test 4: mode='partial' renders dual-ARIA pill (visible + sr-only sibling) plus children", () => {
    const { container } = render(
      <WidgetState
        mode="partial"
        partial={{
          pill: "Syncing 2 of 3 venues",
          children: <div data-testid="partial-child">data</div>,
        }}
      />,
    );
    const visible = container.querySelector("[aria-hidden='true']");
    expect(visible?.textContent).toBe("Syncing 2 of 3 venues");
    const srOnly = container.querySelector(".sr-only");
    expect(srOnly?.textContent).toBe("State: Syncing 2 of 3 venues");
    expect(screen.getByTestId("partial-child")).toBeDefined();
  });

  it("Test 5: mode='error' with no onRetry renders alert Card without Retry button", () => {
    const { container } = render(
      <WidgetState mode="error" error={{ message: "Boom" }} />,
    );
    const alert = container.querySelector("[role='alert']");
    expect(alert).not.toBeNull();
    expect(alert?.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByText("Boom")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("Test 6: mode='error' with onRetry renders Retry button that calls the callback", () => {
    const onRetry = vi.fn();
    render(<WidgetState mode="error" error={{ message: "Boom", onRetry }} />);
    const retry = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("Test 7: mode='success' renders children with NO Card chrome wrapping", () => {
    const { container } = render(
      <WidgetState mode="success">
        <div data-testid="kid">x</div>
      </WidgetState>,
    );
    const kid = container.querySelector("[data-testid='kid']");
    expect(kid).not.toBeNull();
    // No Card chrome means no rounded-xl border surface wrapping the kid.
    // The kid's parent (or any ancestor) should not carry the Card classes.
    let parent: HTMLElement | null = kid as HTMLElement | null;
    let foundCardChrome = false;
    while (parent) {
      const cls = parent.getAttribute?.("class") ?? "";
      if (cls.includes("rounded-xl") && cls.includes("border-border")) {
        foundCardChrome = true;
        break;
      }
      parent = parent.parentElement;
    }
    expect(foundCardChrome).toBe(false);
  });

  it("Test 8: WidgetState source contains no useState/useEffect/useRef CALLS (Pitfall 4 — stateless)", () => {
    // Strip block + line comments before grepping so the "Pitfall 4 …
    // primitive holds NO useState/useEffect/useRef" warning copy in the
    // file header doesn't false-positive against itself. The `\s*\(` tail
    // is a belt-and-braces guard that only invocations (not bare
    // identifier mentions) can fail this assertion.
    //
    // Phase 11 review fix IN-07 — heuristic limitation:
    //   This is a regex check, not a full AST parse. False positives are
    //   possible:
    //     - A future identifier `useFooHook` (legitimately not the React
    //       hook) would pass the assertion's word-boundary, but only the
    //       three exact names are matched, so this case is fine.
    //     - A line `import { useState } from "react"` (without calling
    //       `useState(...)` inline on the same line) WOULD fail because
    //       the regex requires `\s*\(` after the identifier; a bare
    //       import is invisible to the regex (correct outcome).
    //     - Conversely, a future refactor that wraps state inside a
    //       sibling hook (e.g. `useWidgetState(...)`) would NOT trigger
    //       the assertion even though it violates the spirit of the
    //       Pitfall-4 statelessness rule.
    //   If false flags become an issue, promote this assertion to a
    //   typescript-AST scanner (e.g. ts-morph) that can statically
    //   identify React-hook call sites.
    const raw = readFileSync(resolve(__dirname, "WidgetState.tsx"), "utf8");
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(stripped).not.toMatch(/\buseState\s*\(/);
    expect(stripped).not.toMatch(/\buseEffect\s*\(/);
    expect(stripped).not.toMatch(/\buseRef\s*\(/);
  });
});

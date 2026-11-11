import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Term, PlainTerms } from "./Term";
import { termDefinition } from "@/lib/glossary";

Object.defineProperty(document.documentElement, "clientWidth", {
  configurable: true,
  get: () => 1024,
});
Object.defineProperty(document.documentElement, "clientHeight", {
  configurable: true,
  get: () => 768,
});

// Phase 201 plan 01 (D-01, D-03, D-19): Term is the one focusable trigger that
// shows a registry definition. It must open on keyboard focus (the point of
// D-19), reference the bubble from the FOCUSABLE span (a screen reader reads
// label then definition), and add no visible text (the factsheet census reads
// text before and after).
describe("Term (Form A trigger)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("renders one focusable span, data-term, whose text is exactly the children", () => {
    render(<Term k="omega">Omega (θ=0)</Term>);
    const trigger = screen.getByText("Omega (θ=0)");
    expect(trigger.getAttribute("data-term")).toBe("omega");
    expect(trigger.getAttribute("tabindex")).toBe("0");
    expect(trigger.textContent).toBe("Omega (θ=0)");
    expect(document.querySelectorAll("[data-term]")).toHaveLength(1);
  });

  it("with no children renders the registry label", () => {
    render(<Term k="omega" />);
    expect(screen.getByText("Omega").getAttribute("data-term")).toBe("omega");
  });

  it("keyboard focus opens the registry definition after 150 ms, and aria-describedby is on the focusable span", () => {
    render(<Term k="omega">Omega (θ=0)</Term>);
    const trigger = screen.getByText("Omega (θ=0)");
    fireEvent.focus(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    const bubble = screen.getByRole("tooltip");
    expect(bubble.textContent).toBe(termDefinition("omega"));
    expect(trigger.getAttribute("aria-describedby")).toBe(bubble.id);
  });

  it("hover on the trigger wrapper opens after 150 ms and leaving closes it", () => {
    render(<Term k="omega">Omega</Term>);
    const wrapper = screen.getByText("Omega").parentElement!.parentElement!;
    fireEvent.mouseEnter(wrapper);
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.getByRole("tooltip").textContent).toBe(termDefinition("omega"));
    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("the context prop picks the context string", () => {
    render(
      <Term k="max_drawdown" context="last12m">
        Max DD 12m
      </Term>,
    );
    fireEvent.focus(screen.getByText("Max DD 12m"));
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.getByRole("tooltip").textContent).toBe(
      termDefinition("max_drawdown", "last12m"),
    );
    expect(screen.getByRole("tooltip").textContent).toMatch(/last 12 months/);
  });

  it("carries the Form A classes and none that restyle the label it wraps", () => {
    render(<Term k="omega">Omega</Term>);
    const cls = screen.getByText("Omega").className;
    for (const required of [
      "cursor-help",
      "underline",
      "decoration-dotted",
      "decoration-1",
      "decoration-text-muted",
      "underline-offset-2",
      "rounded-sm",
      "focus-visible:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-accent/50",
      "print:no-underline",
    ]) {
      expect(cls.split(/\s+/)).toContain(required);
    }
    // The trigger inherits font, size, weight, colour, case and tracking (UI-SPEC
    // Form A), and is text-decoration, not a border box (U-02).
    for (const forbidden of ["font-", "text-[", "uppercase", "tracking-", "text-text-", "border-b"]) {
      expect(cls).not.toContain(forbidden);
    }
  });

  it("wrapping a glyph-prefixed label keeps getByText resolving to the trigger", () => {
    render(<Term k="alpha">α vs BTC</Term>);
    expect(screen.getByText("α vs BTC").getAttribute("data-term")).toBe("alpha");
  });

  it("adds no visible text: the surrounding text reads the same with and without the Term", () => {
    const { container: plain } = render(<p>before Omega after</p>);
    const { container: wrapped } = render(
      <p>
        before <Term k="omega">Omega</Term> after
      </p>,
    );
    expect(wrapped.textContent).toBe(plain.textContent);
  });
});

// D-20, U-03: the tearsheet print view shows a plain label. A trigger left in the
// print view would add a dotted underline and a tab stop to a sheet that is printed.
describe("Term inside PlainTerms (print view)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("renders only the plain text: no data-term, no tabindex, no underline class", () => {
    const { container } = render(
      <PlainTerms>
        <p>
          <Term k="omega">Omega (θ=0)</Term>
        </p>
      </PlainTerms>,
    );
    expect(container.innerHTML).toBe("<p>Omega (θ=0)</p>");
    expect(container.querySelector("[data-term]")).toBeNull();
    expect(container.querySelector("[tabindex]")).toBeNull();
    expect(container.innerHTML).not.toContain("underline");
  });

  it("with no children renders the registry label, plain", () => {
    const { container } = render(
      <PlainTerms>
        <Term k="omega" />
      </PlainTerms>,
    );
    expect(container.innerHTML).toBe("Omega");
  });

  it("hovering opens nothing", () => {
    const { container } = render(
      <PlainTerms>
        <p>
          <Term k="omega">Omega</Term>
        </p>
      </PlainTerms>,
    );
    fireEvent.mouseEnter(container.firstElementChild!);
    fireEvent.focus(container.firstElementChild!);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

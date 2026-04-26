import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { WidgetState } from "../../components/WidgetState";
import { commonStateProps, WIDGET_MATRIX } from "./widget-states.fixtures";

// HoldingsTable (consumed by HoldingsTableWidget) calls useRouter() during
// render. Stub next/navigation so the widget can mount under jsdom without
// a Next router context — same pattern as
// `widgets/positions/HoldingsTableWidget.test.tsx`.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

/**
 * Phase 11 / Plan 04 / D-09 + D-12 — Per-widget × per-state matrix test.
 *
 * Asserts that each of the 7 DEFAULT_LAYOUT widgets renders correctly
 * inside <WidgetState mode={...}> for all 5 modes (35 mode renders + 2
 * sanity-check assertions = 37 it() cases).
 *
 * For non-success modes the test mounts <WidgetState mode={...} {...}>
 * directly (no widget body) — the assertion is on the primitive's
 * branch dispatch, not on each widget's body. For mode='success' the
 * test renders the widget body inside <WidgetState mode='success'>
 * to confirm WidgetState passes children through cleanly without
 * the underlying widget throwing on its empty/skeleton fixtures.
 *
 * D-12: success fixtures are typed against the underlying widget's
 * data contract (no `any` in the fixture file).
 *
 * Long-tail WIDGET_REGISTRY widgets (39 - 7 = 32) are NOT covered by
 * per-state fixtures here — they get coverage via the universal
 * <WidgetState> wrapper only, gated by the `widget_state_v2` flag.
 */
describe("Widget × State matrix (D-09 in-scope = 7 DEFAULT_LAYOUT widgets)", () => {
  it("WIDGET_MATRIX has exactly 7 entries (one per DEFAULT_LAYOUT widget)", () => {
    expect(WIDGET_MATRIX.length).toBe(7);
  });

  it("WIDGET_MATRIX has at least 1 entry per category (W-01: kpi, chart, table, sparkline, card)", () => {
    const cats = new Set(WIDGET_MATRIX.map((e) => e.category));
    expect(cats.has("kpi")).toBe(true);
    expect(cats.has("chart")).toBe(true);
    expect(cats.has("table")).toBe(true);
    expect(cats.has("sparkline")).toBe(true);
    expect(cats.has("card")).toBe(true);
  });

  for (const entry of WIDGET_MATRIX) {
    describe(`${entry.id} (${entry.label})`, () => {
      it("renders mode='loading' with aria-busy", () => {
        const { container } = render(
          <WidgetState {...commonStateProps.loading} />,
        );
        expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
      });

      it("renders mode='empty' with title and CTA", () => {
        render(<WidgetState {...commonStateProps.empty} />);
        expect(screen.getByText("Nothing to show yet")).toBeDefined();
        expect(screen.getByText("Add data")).toBeDefined();
      });

      it("renders mode='partial' with dual-ARIA pill", () => {
        const { container } = render(
          <WidgetState {...commonStateProps.partial} />,
        );
        const visible = container.querySelector("[aria-hidden='true']");
        expect(visible?.textContent).toBe("Syncing 2 of 3 venues");
        const srOnly = container.querySelector(".sr-only");
        expect(srOnly?.textContent).toBe("State: Syncing 2 of 3 venues");
      });

      it("renders mode='error' with role='alert'", () => {
        const { container } = render(
          <WidgetState {...commonStateProps.error} />,
        );
        expect(container.querySelector("[role='alert']")).not.toBeNull();
        expect(screen.getByText("Could not load this widget.")).toBeDefined();
      });

      it("renders mode='success' with the widget body (no chrome wrap)", () => {
        expect(() => {
          render(
            <WidgetState mode="success">{entry.renderSuccess()}</WidgetState>,
          );
        }).not.toThrow();
      });
    });
  }
});

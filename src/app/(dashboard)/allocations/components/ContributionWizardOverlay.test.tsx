/** @vitest-environment jsdom */
/**
 * Phase 110 / CONTRIB-01 — ContributionWizardOverlay.
 *
 * The reusable inline-overlay wizard mount. These pin the contract plan
 * 110-05 and Phase 116 consume: the `{ isOpen, onClose, onSuccess }` seam,
 * the createPortal panel, Esc dismissal, the keyed CSV↔API remount driven by
 * the internal source selector (NOT route searchParams — Pitfall 3), and the
 * onSuccess propagation from the mounted wizard.
 *
 * WizardClient is mocked so this test drives the overlay's own wiring, not
 * the wizard's internals.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the props WizardClient receives + count mounts so the keyed-remount
// test can prove `key={source}` actually tears down + remounts on toggle.
const hoisted = vi.hoisted(() => ({ mountCount: 0 }));

vi.mock("@/app/(dashboard)/strategies/new/wizard/WizardClient", async () => {
  const React = await import("react");
  return {
    WizardClient: (props: {
      entryContext: string;
      sourceOverride: string;
      initialDraft: unknown;
      onSuccess?: (id: string) => void;
      onClose?: () => void;
    }) => {
      React.useEffect(() => {
        hoisted.mountCount += 1;
      }, []);
      return (
        <div data-testid="mock-wizard">
          <span data-testid="wizard-entry">{props.entryContext}</span>
          <span data-testid="wizard-source">{props.sourceOverride}</span>
          <span data-testid="wizard-initial-draft">
            {props.initialDraft === null ? "null" : "present"}
          </span>
          <button
            type="button"
            data-testid="wizard-fire-success"
            onClick={() => props.onSuccess?.("id-1")}
          >
            fire success
          </button>
          <button
            type="button"
            data-testid="wizard-fire-close"
            onClick={() => props.onClose?.()}
          >
            fire close
          </button>
        </div>
      );
    },
  };
});

let ContributionWizardOverlay: typeof import("./ContributionWizardOverlay").ContributionWizardOverlay;

beforeEach(async () => {
  hoisted.mountCount = 0;
  ({ ContributionWizardOverlay } = await import("./ContributionWizardOverlay"));
});

describe("[110-03] ContributionWizardOverlay", () => {
  it("renders nothing when isOpen=false (null gate)", () => {
    const { container } = render(
      <ContributionWizardOverlay isOpen={false} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("mock-wizard")).toBeNull();
  });

  it("renders the portal panel mounting WizardClient in contribution mode with a fresh draft", () => {
    render(<ContributionWizardOverlay isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Add a strategy" })).toBeInTheDocument();
    expect(screen.getByTestId("mock-wizard")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-entry")).toHaveTextContent("contribution");
    expect(screen.getByTestId("wizard-initial-draft")).toHaveTextContent("null");
    // Default branch is the API-key source.
    expect(screen.getByTestId("wizard-source")).toHaveTextContent("api");
  });

  it("calls onClose on Escape keydown", () => {
    const onClose = vi.fn();
    render(<ContributionWizardOverlay isOpen onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("toggling the source selector remounts WizardClient with the matching sourceOverride", () => {
    render(<ContributionWizardOverlay isOpen onClose={vi.fn()} />);

    expect(screen.getByTestId("wizard-source")).toHaveTextContent("api");
    const mountsAfterOpen = hoisted.mountCount;

    // Switch to CSV → sourceOverride flips AND key={source} forces a remount.
    fireEvent.click(screen.getByTestId("overlay-source-csv"));
    expect(screen.getByTestId("wizard-source")).toHaveTextContent("csv");
    expect(hoisted.mountCount).toBeGreaterThan(mountsAfterOpen);

    // And back to API.
    fireEvent.click(screen.getByTestId("overlay-source-api"));
    expect(screen.getByTestId("wizard-source")).toHaveTextContent("api");
  });

  it("propagates the wizard's onSuccess(strategyId) to the overlay's onSuccess prop", () => {
    const onSuccess = vi.fn();
    render(<ContributionWizardOverlay isOpen onClose={vi.fn()} onSuccess={onSuccess} />);

    fireEvent.click(screen.getByTestId("wizard-fire-success"));
    expect(onSuccess).toHaveBeenCalledWith("id-1");
  });

  it("clicking the backdrop dismisses via onClose but a click inside the panel does not", () => {
    const onClose = vi.fn();
    render(<ContributionWizardOverlay isOpen onClose={onClose} />);

    // A click inside the wizard body must NOT close the overlay.
    fireEvent.click(screen.getByTestId("mock-wizard"));
    expect(onClose).not.toHaveBeenCalled();

    // A click on the backdrop (the dialog element itself) closes it.
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

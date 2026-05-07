import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CsvUploadStep } from "./CsvUploadStep";

// Regression coverage for the post-mount initialStrategyName prop-sync.
//
// WizardClient hydrates LS-derived state in a post-mount useEffect, so
// CsvUploadStep mounts FIRST with the SSR default (empty string) and
// only later receives the resumed strategyName as a new prop value.
// Without the sync effect, the user's previously-typed name never
// reaches the input and they have to re-type it. The guard
// (`strategyName === ""` at the time the prop arrives) keeps the user's
// in-progress typing safe from a late prop update.

const baseProps = {
  wizardSessionId: "session-id",
  onSuccess: () => {},
};

describe("CsvUploadStep — initialStrategyName prop sync", () => {
  it("renders empty when initialStrategyName is empty (SSR default)", () => {
    render(<CsvUploadStep {...baseProps} initialStrategyName="" />);
    const input = screen.getByTestId("csv-strategy-name") as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("backfills the input when initialStrategyName arrives post-mount", () => {
    const { rerender } = render(
      <CsvUploadStep {...baseProps} initialStrategyName="" />,
    );
    const input = screen.getByTestId("csv-strategy-name") as HTMLInputElement;
    expect(input.value).toBe("");

    // Simulate WizardClient's post-mount LS-hydration applying the
    // resumed strategyName. The prop changes from "" to "Aurora".
    rerender(
      <CsvUploadStep {...baseProps} initialStrategyName="Aurora Capital" />,
    );

    expect(
      (screen.getByTestId("csv-strategy-name") as HTMLInputElement).value,
    ).toBe("Aurora Capital");
  });

  it("renders the prop value directly when present at mount", () => {
    render(
      <CsvUploadStep {...baseProps} initialStrategyName="Already-here" />,
    );
    expect(
      (screen.getByTestId("csv-strategy-name") as HTMLInputElement).value,
    ).toBe("Already-here");
  });

  it("does NOT clobber a value the user already typed when a late prop arrives", () => {
    // The non-obvious invariant: if the user typed before the parent's
    // hydration effect fires, the late prop update must NOT overwrite
    // their input. The component's useEffect guards on
    // `strategyName === ""` to enforce this — pin it so a future
    // refactor that drops the guard is caught immediately.
    const { rerender } = render(
      <CsvUploadStep {...baseProps} initialStrategyName="" />,
    );
    const input = screen.getByTestId("csv-strategy-name") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "User-typed-name" } });
    expect(input.value).toBe("User-typed-name");

    // Late prop update simulating WizardClient's LS-hydration arriving
    // after the user already started typing.
    rerender(
      <CsvUploadStep {...baseProps} initialStrategyName="Stale-LS-name" />,
    );

    expect(
      (screen.getByTestId("csv-strategy-name") as HTMLInputElement).value,
    ).toBe("User-typed-name");
  });
});

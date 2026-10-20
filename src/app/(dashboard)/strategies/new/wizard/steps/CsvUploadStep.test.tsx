import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

// 170.1-02 / R-2 (checker W1) — the `format` wiring, proven through the REAL
// caller. The envelope's own tests pass `format` by hand; only a test that
// enters through CsvUploadStep can see the prop dropped from the call site.
// `vi.spyOn` + `vi.restoreAllMocks`, never `vi.stubGlobal` (DEF-16-1).
describe("[170.1-02 R-2] CsvUploadStep — the hint follows the SELECTED format", () => {
  const HINT = "Check the file format you selected.";
  const FIVE_MISSING = ["side", "qty", "price", "symbol", "currency"].map(
    (column) => ({
      rule: "column_in_dataframe",
      row: 0,
      message: `Your file has no ${column} column.`,
      column,
    }),
  );
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      // The genuine verdict: 200 + ok:false, rows on `errors`.
      new Response(
        JSON.stringify({
          ok: false,
          code: "CSV_VALIDATION_FAILED",
          human_message: "Your file did not pass validation.",
          errors: FIVE_MISSING,
          correlation_id: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  function chooseFileAndValidate(trades: boolean) {
    render(<CsvUploadStep {...baseProps} initialStrategyName="Aurora" />);
    if (trades) fireEvent.click(screen.getByTestId("wizard-csv-fmt-trades"));
    const file = new File(["date,daily_return\n2024-01-01,0.01\n"], "track.csv", {
      type: "text/csv",
    });
    fireEvent.change(screen.getByTestId("wizard-csv-file-input"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByTestId("wizard-csv-validate-submit"));
  }

  it("🔴 Trade list selected: the routed specimen shows the hint exactly once, beside five plain lines", async () => {
    chooseFileAndValidate(true);
    await screen.findByTestId("wizard-csv-error");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByText(HINT)).toHaveLength(1);
    const lines = [
      ...screen.getByTestId("wizard-csv-error").querySelectorAll("li"),
    ].map((li) => li.textContent);
    expect(lines).toEqual([
      "Your file has no side column.",
      "Your file has no qty column.",
      "Your file has no price column.",
      "Your file has no symbol column.",
      "Your file has no currency column.",
    ]);
  });

  it("the default Daily returns selection: the same five rows give NO hint (the prop carries the selection)", async () => {
    chooseFileAndValidate(false);
    await screen.findByTestId("wizard-csv-error");

    expect(screen.queryByText(HINT)).toBeNull();
    expect(screen.getByText(/Rule violated/)).toBeInTheDocument(); // the panel is real
  });
});

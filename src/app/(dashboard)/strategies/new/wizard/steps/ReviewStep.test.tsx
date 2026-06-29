/** @vitest-environment jsdom */
/**
 * APPLY-02 — ReviewStep read-only recap (Phase 53 Plan 02).
 *
 * The review step is the one new wizard UX area. It recaps ONLY values the
 * user actually entered (no-invented-data LOCKED), offers a per-section Edit
 * that returns to the owning step, renders NO `role="alert"` (it is not an
 * error surface), and keeps the existing finalize verb per branch.
 *
 * These tests pin:
 *   - recap renders the entered values verbatim;
 *   - an absent OPTIONAL field shows an em-dash placeholder, NEVER a
 *     fabricated zero/demo number;
 *   - clicking a section "Edit" calls onEdit with the OWNING step key;
 *   - the rendered subtree carries NO role="alert";
 *   - the final CTA label matches the branch finalize verb.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ReviewStep, type ReviewCsvSummary } from "./ReviewStep";
import type { MetadataDraft } from "./MetadataStep";

const FULL_METADATA: MetadataDraft = {
  name: "Aurora Capital",
  description: "A market-neutral basis strategy.",
  categoryId: "cat-aaa",
  strategyTypes: ["Directional", "Mean Reversion"],
  subtypes: ["Carry"],
  markets: ["BTC", "ETH"],
  supportedExchanges: ["Binance", "OKX"],
  leverageRange: "1x–5x",
  aum: "1000000",
  maxCapacity: "5000000",
};

// A draft whose OPTIONAL numeric/array fields are empty — the recap must
// show an em-dash for these, NEVER fabricate a "0" or "$0".
const SPARSE_METADATA: MetadataDraft = {
  name: "Sparse Strat",
  description: "Minimal entry.",
  categoryId: "cat-bbb",
  strategyTypes: [],
  subtypes: [],
  markets: [],
  supportedExchanges: [],
  leverageRange: "",
  aum: "",
  maxCapacity: "",
};

const CSV_SUMMARY: ReviewCsvSummary = {
  fmt: "daily_returns",
  rowCount: 252,
  dateRange: ["2025-01-02", "2026-01-02"],
  columnsDetected: ["date", "daily_return"],
};

describe("[APPLY-02] ReviewStep — API branch recap", () => {
  function renderApi(metadata: MetadataDraft = FULL_METADATA) {
    const onContinue = vi.fn();
    const onBack = vi.fn();
    const onEdit = vi.fn();
    render(
      <ReviewStep
        branch="api"
        strategyName={metadata.name ?? ""}
        metadata={metadata}
        onContinue={onContinue}
        onBack={onBack}
        onEdit={onEdit}
      />,
    );
    return { onContinue, onBack, onEdit };
  }

  it("recaps only the entered values verbatim", () => {
    renderApi();
    expect(screen.getByText("Aurora Capital")).toBeInTheDocument();
    expect(
      screen.getByText("A market-neutral basis strategy."),
    ).toBeInTheDocument();
    expect(screen.getByText("Directional, Mean Reversion")).toBeInTheDocument();
    expect(screen.getByText("BTC, ETH")).toBeInTheDocument();
    expect(screen.getByText("Binance, OKX")).toBeInTheDocument();
    expect(screen.getByText("1x–5x")).toBeInTheDocument();
    expect(screen.getByText("$1,000,000")).toBeInTheDocument();
    expect(screen.getByText("$5,000,000")).toBeInTheDocument();
  });

  it("shows an em-dash for absent OPTIONAL fields, never a fabricated zero", () => {
    renderApi(SPARSE_METADATA);
    // The optional numeric fields must NOT render a fabricated "0" / "$0".
    expect(screen.queryByText("$0")).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
    // Em-dash placeholders appear for the empty optional fields (AUM, max
    // capacity, leverage, markets, types, subtypes, exchanges = 7 rows).
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(7);
  });

  it("clicking the profile Edit calls onEdit('metadata')", () => {
    const { onEdit } = renderApi();
    fireEvent.click(screen.getByTestId("wizard-review-edit-metadata"));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith("metadata");
  });

  it("renders NO role=alert (it is not an error surface)", () => {
    renderApi();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("[WR-01] uses an ADVANCE verb, not the finalize verb (the recap does not finalize)", () => {
    renderApi();
    const cta = screen.getByTestId("wizard-review-continue");
    // The CTA advances to SubmitStep (which carries the real finalize verb);
    // it must NOT claim to "Create strategy" — that would be a button-that-
    // says-create-but-doesn't (WR-01).
    expect(cta).toHaveTextContent("Continue to create");
    expect(screen.queryByText("Create strategy")).toBeNull();
    expect(screen.queryByText("Submit strategy")).toBeNull();
  });

  it("Continue advances and Back returns via the callbacks", () => {
    const { onContinue, onBack } = renderApi();
    fireEvent.click(screen.getByTestId("wizard-review-continue"));
    expect(onContinue).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("wizard-review-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("[APPLY-02] ReviewStep — CSV branch recap", () => {
  function renderCsv() {
    const onContinue = vi.fn();
    const onBack = vi.fn();
    const onEdit = vi.fn();
    render(
      <ReviewStep
        branch="csv"
        strategyName="BTC Vol Carry"
        csv={CSV_SUMMARY}
        metadata={FULL_METADATA}
        onContinue={onContinue}
        onBack={onBack}
        onEdit={onEdit}
      />,
    );
    return { onContinue, onBack, onEdit };
  }

  it("recaps the REAL parsed CSV numbers (no fabrication)", () => {
    renderCsv();
    expect(screen.getByText("BTC Vol Carry")).toBeInTheDocument();
    expect(screen.getByText("Daily returns")).toBeInTheDocument();
    expect(screen.getByText("252")).toBeInTheDocument();
    expect(screen.getByText("2025-01-02 → 2026-01-02")).toBeInTheDocument();
    expect(screen.getByText("date, daily_return")).toBeInTheDocument();
  });

  it("CSV Edit affordances map to the owning steps", () => {
    const { onEdit } = renderCsv();
    fireEvent.click(screen.getByTestId("wizard-review-edit-csv"));
    expect(onEdit).toHaveBeenCalledWith("csv_upload");
    fireEvent.click(screen.getByTestId("wizard-review-edit-csv-metadata"));
    expect(onEdit).toHaveBeenCalledWith("csv_metadata");
  });

  it("renders NO role=alert on the CSV branch", () => {
    renderCsv();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("[WR-01] uses an ADVANCE verb on the CSV branch, not the finalize verb", () => {
    renderCsv();
    const cta = screen.getByTestId("wizard-review-continue");
    // Advances to CsvSubmitStep (which carries the real "Submit strategy"
    // finalize verb); the recap CTA must not claim to submit (WR-01).
    expect(cta).toHaveTextContent("Continue to submit");
    expect(screen.queryByText("Submit strategy")).toBeNull();
    expect(screen.queryByText("Create strategy")).toBeNull();
  });
});

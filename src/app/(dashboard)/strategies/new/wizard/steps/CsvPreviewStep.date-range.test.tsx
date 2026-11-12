/** @vitest-environment jsdom */
/**
 * F-11 / D-11 / UI-SPEC Interaction contract 5 / R3-01 item 5 / plan 201-38.
 *
 * The Preview step's "Date range" pill is copy, so it prints through
 * `formatDay` (`Apr 3, 2025 – May 6, 2026`), the same form the Submit and
 * Review steps use. This supersedes QA ISSUE-014 for the pill only. The
 * sample-row table previews the uploaded file's own cells, which is a D-11
 * exemption, so its date cell keeps the ISO form (`2025-04-03`).
 *
 * The step had no render test before this file.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CsvPreviewStep } from "./CsvPreviewStep";

const PREVIEW = {
  row_count: 2,
  date_range: ["2025-04-03", "2026-05-06"] as [string, string],
  columns_detected: ["date", "daily_return"],
  first_rows: [{ date: "2025-04-03", daily_return: 0.01 }],
  last_rows: [{ date: "2026-05-06", daily_return: -0.005 }],
};

afterEach(cleanup);

function renderStep() {
  return render(
    <CsvPreviewStep
      preview={PREVIEW}
      fmt="daily_returns"
      strategyName="Range pill test"
      validationPassed
      onBack={() => {}}
      onContinue={() => {}}
    />,
  );
}

describe("CsvPreviewStep — 201-38 the date range pill", () => {
  it("prints the range through the helper, with no ISO day and no arrow", () => {
    renderStep();
    const row = screen.getByText("Date range").closest("div");
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain("Apr\u00a03,\u00a02025 – May\u00a06,\u00a02026");
    expect(row!.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(row!.textContent).not.toContain("→");
  });

  it("keeps the sample-row table's date cells ISO (the file's own contents, D-11)", () => {
    renderStep();
    const table = screen.getByRole("table");
    expect(within(table).getByText("2025-04-03")).toBeInTheDocument();
    expect(within(table).getByText("2026-05-06")).toBeInTheDocument();
  });
});

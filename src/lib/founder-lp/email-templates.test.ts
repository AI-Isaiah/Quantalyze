/**
 * Phase 18 / round-2 polish — email template structural + escape tests.
 *
 * No snapshot — these are contract assertions on the parts that matter
 * for a customer-facing surface: HTML escaping, DESIGN.md token presence,
 * and the brand-strip color contract.
 */
import { describe, it, expect } from "vitest";
import {
  renderSuccessEmailHtml,
  renderFailureAlertHtml,
} from "./email-templates";

const HAPPY_INPUTS = {
  correlationId: "11111111-1111-1111-1111-111111111111",
  monthLabel: "May 2026",
  strategyName: "Phoenix Protocol",
  pdfBytes: 65_536,
};

describe("renderSuccessEmailHtml", () => {
  it("renders the brand strip in the DESIGN.md accent color (#1B6B5A)", () => {
    const html = renderSuccessEmailHtml(HAPPY_INPUTS);
    // The thin top stripe is the brand mark; failure alerts use #DC2626.
    expect(html).toContain("background:#1B6B5A");
    expect(html).not.toContain("background:#DC2626");
  });

  it("interpolates the strategy name AND month label", () => {
    const html = renderSuccessEmailHtml(HAPPY_INPUTS);
    expect(html).toContain("Phoenix Protocol");
    expect(html).toContain("May 2026");
  });

  it("falls back to a generic phrase when strategyName is null", () => {
    const html = renderSuccessEmailHtml({ ...HAPPY_INPUTS, strategyName: null });
    expect(html).toContain("your strategy");
    expect(html).not.toContain("Phoenix Protocol");
  });

  it("HTML-escapes hostile strategy names (XSS via DB-controlled string)", () => {
    const html = renderSuccessEmailHtml({
      ...HAPPY_INPUTS,
      strategyName: '<script>alert("xss")</script>',
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert");
  });

  it("HTML-escapes hostile correlationId", () => {
    const html = renderSuccessEmailHtml({
      ...HAPPY_INPUTS,
      correlationId: '"><img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain('"><img');
    expect(html).toContain("&quot;&gt;&lt;img");
  });

  it("renders the PDF size in KB to the metadata table", () => {
    const html = renderSuccessEmailHtml({ ...HAPPY_INPUTS, pdfBytes: 4_096_000 });
    // 4_096_000 / 1024 = 4000 — locale-formatted as "4,000 KB" or "4000 KB".
    expect(html).toMatch(/4[\s,]?000 KB/);
  });

  it("contains the trace id label and the correlation_id", () => {
    const html = renderSuccessEmailHtml(HAPPY_INPUTS);
    expect(html).toContain("trace id");
    expect(html).toContain("11111111-1111-1111-1111-111111111111");
  });

  it("contains the QUANTALYZE brand mark + footer", () => {
    const html = renderSuccessEmailHtml(HAPPY_INPUTS);
    // Header brand mark and footer attribution both present.
    const occurrences = (html.match(/QUANTALYZE/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
    expect(html).toContain("institutional analytics");
  });

  it("uses system serif fallback (no Google Fonts dependency)", () => {
    const html = renderSuccessEmailHtml(HAPPY_INPUTS);
    // DESIGN.md blesses Instrument Serif but emails cannot rely on
    // @font-face — Charter is the closest faithful system fallback.
    expect(html).toContain("Charter");
    expect(html).not.toContain("@import");
    expect(html).not.toContain("@font-face");
    expect(html).not.toContain("fonts.googleapis.com");
  });

  it("uses table layout (HTML-email-safe)", () => {
    const html = renderSuccessEmailHtml(HAPPY_INPUTS);
    expect(html).toContain("<table");
    expect(html).toContain('role="presentation"');
    // Inline styles only — no <style> blocks (Gmail web strips them).
    expect(html).not.toContain("<style");
  });
});

describe("renderFailureAlertHtml", () => {
  it("renders the brand strip in the DESIGN.md negative color (#DC2626)", () => {
    const html = renderFailureAlertHtml({
      correlationId: "trace-1",
      monthLabel: "May 2026",
      errorClass: "PdfTooSmall",
      errorMessage: "factsheet PDF too small: 512 bytes (min 1024)",
    });
    expect(html).toContain("background:#DC2626");
    expect(html).not.toContain("background:#1B6B5A");
  });

  it("HTML-escapes the error_message (defense against future caller wrapping user-controlled string)", () => {
    const html = renderFailureAlertHtml({
      correlationId: "trace-1",
      monthLabel: "May 2026",
      errorClass: "Error",
      errorMessage: '<script>alert("evil")</script>',
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert");
  });

  it("renders error_class in the negative color block", () => {
    const html = renderFailureAlertHtml({
      correlationId: "trace-1",
      monthLabel: "May 2026",
      errorClass: "AlertTimeout",
      errorMessage: "successSend timed out after 15000ms",
    });
    expect(html).toContain("AlertTimeout");
    expect(html).toContain("successSend timed out after 15000ms");
    // Negative-50 fill (#FEF2F2) on the error block.
    expect(html).toContain("#FEF2F2");
  });

  it("references the runbook link", () => {
    const html = renderFailureAlertHtml({
      correlationId: "trace-1",
      monthLabel: "May 2026",
      errorClass: "PdfTooSmall",
      errorMessage: "factsheet PDF too small",
    });
    expect(html).toContain("founder-lp-runbook.md");
  });

  it("preserves whitespace and newlines in error_message via white-space:pre-wrap", () => {
    const html = renderFailureAlertHtml({
      correlationId: "trace-1",
      monthLabel: "May 2026",
      errorClass: "Error",
      errorMessage: "line one\nline two",
    });
    expect(html).toContain("white-space:pre-wrap");
    expect(html).toContain("line one\nline two");
  });
});

/**
 * Phase 17 Plan 04 / DESIGN-02 — ErrorEnvelope component tests.
 *
 * Locked contracts (PLAN.md must_haves.truths + UI-SPEC §15-§16):
 *   - Canonical surface-agnostic error renderer at src/components/error/
 *   - Title: 16px DM Sans semibold #1A1A2E (text-base font-semibold text-text-primary)
 *   - Retry CTA placement: AFTER body <ul>, BEFORE <details> accordion
 *   - <details> default state: always-collapsed
 *   - Copy-diagnostics: newline-delimited QUANTALYZE_DIAG block (NOT JSON)
 *   - pii-scrub.ts pass on every debug_context line BEFORE clipboard write
 *   - aria-label="Retry" on Retry button when no `operation` prop is passed;
 *     aria-label="Retry {operation}" when it is (UI-SPEC §8.4, HI-01 fix)
 *   - aria-label="Cancel and return" on Cancel button (UI-SPEC §8.4, HI-01)
 *   - role="alert" + data-testid="error-envelope" + data-testid-legacy="wizard-error-envelope"
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ErrorEnvelope } from "./ErrorEnvelope";
import type { ErrorEnvelope as ErrorEnvelopeType } from "@/lib/envelope";

function makeEnvelope(
  overrides?: Partial<ErrorEnvelopeType>,
): ErrorEnvelopeType {
  return {
    ok: false,
    code: "KEY_INVALID_SIGNATURE",
    human_message: "Invalid signature.",
    debug_context: ["Step one.", "Step two."],
    correlation_id: "9b3a47de-8c12-4d75-a2e6-ff0e10b2c1d3",
    recoverable: true,
    ...overrides,
  };
}

describe("ErrorEnvelope (DESIGN-02)", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders with role='alert' and the canonical test-id", () => {
    render(<ErrorEnvelope envelope={makeEnvelope()} />);
    const shell = screen.getByRole("alert");
    expect(shell).toHaveAttribute("data-testid", "error-envelope");
  });

  it("preserves the legacy data-testid-legacy attribute for E2E continuity", () => {
    render(<ErrorEnvelope envelope={makeEnvelope()} />);
    expect(screen.getByRole("alert")).toHaveAttribute(
      "data-testid-legacy",
      "wizard-error-envelope",
    );
  });

  it("renders title with text-base font-semibold text-text-primary (DESIGN-02 typography lock)", () => {
    render(<ErrorEnvelope envelope={makeEnvelope({ human_message: "MSG" })} />);
    const title = screen.getByText("MSG");
    expect(title.className).toMatch(/text-base/);
    expect(title.className).toMatch(/font-semibold/);
    expect(title.className).toMatch(/text-text-primary/);
    expect(title.className).not.toMatch(/text-sm\b/);
    expect(title.className).not.toMatch(/text-negative\b/);
  });

  it("places Retry CTA AFTER the body <ul> and BEFORE the <details>", () => {
    const onRetry = vi.fn();
    render(<ErrorEnvelope envelope={makeEnvelope()} onRetry={onRetry} />);
    const retry = screen.getByRole("button", { name: "Retry" });
    const details = document.querySelector("details");
    expect(details).not.toBeNull();
    // Retry must precede details in DOM order.
    expect(retry.compareDocumentPosition(details!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    // And Retry must come AFTER the body <ul>.
    const list = document.querySelector("ul");
    expect(list).not.toBeNull();
    expect(list!.compareDocumentPosition(retry)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("renders <details> in the always-collapsed state by default", () => {
    render(<ErrorEnvelope envelope={makeEnvelope()} />);
    const details = document.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.hasAttribute("open")).toBe(false);
  });

  it("Retry button has aria-label='Retry' when no operation prop is passed (default fallback)", () => {
    render(<ErrorEnvelope envelope={makeEnvelope()} onRetry={() => {}} />);
    expect(screen.getByLabelText("Retry")).toBeInTheDocument();
  });

  // HI-01: aria-label contract is `Retry {operation}` per UI-SPEC §8.4.
  // When the surface specifies an operation string, the aria-label MUST
  // include it so screen-reader users tabbing through multiple error
  // regions can distinguish which retry-button retries which operation.
  // Visible button text remains the single word `Retry`.
  it("Retry button has aria-label='Retry {operation}' when operation is provided (UI-SPEC §8.4)", () => {
    render(
      <ErrorEnvelope
        envelope={makeEnvelope()}
        onRetry={() => {}}
        operation="validating key"
      />,
    );
    expect(screen.getByLabelText("Retry validating key")).toBeInTheDocument();
    // Visible label remains the bare word "Retry"
    expect(screen.getByRole("button", { name: "Retry validating key" }))
      .toHaveTextContent(/^Retry$/);
  });

  // HI-01: Cancel CTA aria-label is `Cancel and return` per UI-SPEC §8.4.
  // The visible button text remains the single word `Cancel`.
  it("Cancel button has aria-label='Cancel and return' (UI-SPEC §8.4)", () => {
    render(
      <ErrorEnvelope
        envelope={makeEnvelope({ recoverable: false })}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByLabelText("Cancel and return")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel and return" }))
      .toHaveTextContent(/^Cancel$/);
  });

  it("does not render Retry when recoverable=false", () => {
    render(
      <ErrorEnvelope
        envelope={makeEnvelope({ recoverable: false })}
        onRetry={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("Copy diagnostics writes a newline-delimited QUANTALYZE_DIAG block", async () => {
    const env = makeEnvelope({ debug_context: ["Try this.", "Then this."] });
    render(<ErrorEnvelope envelope={env} />);
    fireEvent.click(screen.getByText("Copy diagnostics"));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    });
    const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as string;
    const lines = written.split("\n");
    expect(lines[0]).toBe("QUANTALYZE_DIAG");
    expect(lines[1]).toBe(env.code);
    expect(lines[2]).toBe(env.correlation_id);
    expect(lines[3]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // ISO 8601
    expect(lines[4]).toBe(
      typeof navigator !== "undefined" ? navigator.userAgent : "unknown-ua",
    );
    expect(lines[5]).toBe(" - Try this.");
    expect(lines[6]).toBe(" - Then this.");
    expect(lines[7]).toBe("--- pii-scrubbed ---");
  });

  it("Copy diagnostics does NOT write JSON-shaped payload", async () => {
    render(<ErrorEnvelope envelope={makeEnvelope()} />);
    fireEvent.click(screen.getByText("Copy diagnostics"));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    });
    const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as string;
    expect(() => JSON.parse(written)).toThrow();
    expect(written.startsWith("{")).toBe(false);
  });

  it("pii-scrub redacts apikey-shaped values before clipboard write", async () => {
    const env = makeEnvelope({
      debug_context: ["Normal step.", "apikey: SECRET_VALUE_ABC123"],
    });
    render(<ErrorEnvelope envelope={env} />);
    fireEvent.click(screen.getByText("Copy diagnostics"));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    });
    const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as string;
    expect(written).toContain(" - Normal step.");
    // The literal secret must not appear in the clipboard payload.
    expect(written).not.toContain("SECRET_VALUE_ABC123");
  });

  it("pii-scrub redacts JWT-shaped tokens before clipboard write", async () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const env = makeEnvelope({
      debug_context: ["Pre.", jwt, "Post."],
    });
    render(<ErrorEnvelope envelope={env} />);
    fireEvent.click(screen.getByText("Copy diagnostics"));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    });
    const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as string;
    expect(written).not.toContain(jwt);
  });

  // Regression: CR-01 (Phase 17 code review).
  // Before the fix, the two-pass scrub did NOT redact JWT tokens embedded
  // in `Authorization: Bearer <JWT>` debug_context lines:
  //   - pass 1 (redactSensitiveSubstrings) captured `Bearer` (not the JWT)
  //     as the value group because the regex stopped at the space before
  //     the token, leaving the JWT intact in the suffix.
  //   - pass 2 (scrubPii → scrubString) used an anchored ^...$ JWT regex
  //     which did not match because the string had a non-JWT prefix.
  // The third pass (redactJwtSubstrings) scans for JWT-shaped substrings
  // anywhere in the line and is the load-bearing fix.
  it("pii-scrub redacts Authorization: Bearer JWT before clipboard write (CR-01)", async () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const env = makeEnvelope({
      debug_context: [`Authorization: Bearer ${jwt}`],
    });
    render(<ErrorEnvelope envelope={env} />);
    fireEvent.click(screen.getByText("Copy diagnostics"));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    });
    const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as string;
    expect(written).not.toContain(jwt);
  });

  it("renders correlation_id inside the diagnostics accordion", () => {
    const env = makeEnvelope();
    render(<ErrorEnvelope envelope={env} />);
    expect(screen.getByText(env.correlation_id)).toBeInTheDocument();
  });

  it("buttons inside ErrorEnvelope have type='button' (Pitfall 9 — no accidental form submission)", () => {
    const onSubmit = vi.fn((e: React.FormEvent<HTMLFormElement>) =>
      e.preventDefault(),
    );
    render(
      <form onSubmit={onSubmit}>
        <ErrorEnvelope envelope={makeEnvelope()} onRetry={() => {}} />
      </form>,
    );
    fireEvent.click(screen.getByText("Copy diagnostics"));
    fireEvent.click(screen.getByText("Retry"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("ARIA-live status announces 'Copied to clipboard' after copy", async () => {
    render(<ErrorEnvelope envelope={makeEnvelope()} />);
    fireEvent.click(screen.getByText("Copy diagnostics"));
    await waitFor(() => {
      expect(screen.getByText("Copied to clipboard")).toBeInTheDocument();
    });
  });
});

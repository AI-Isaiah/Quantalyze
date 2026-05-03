/**
 * Phase 16 Plan 06 / OBSERV-06 — WizardErrorEnvelope component tests + buildEnvelope mapper.
 *
 * Locked contract (PLAN.md must_haves.truths):
 *   - Renders {ok, code, human_message, debug_context, correlation_id, recoverable} envelope shape
 *   - Native <details> + <summary> + <button> calling navigator.clipboard.writeText
 *   - ARIA-live status echoes "Copied to clipboard"
 *   - All <button> elements have type="button" (Pitfall 9 — no accidental form submit)
 *   - role="alert" + data-error-code attribute (CsvValidationEnvelope analog visual contract)
 *
 * buildEnvelope() must:
 *   - Map WizardErrorCopy.title → human_message
 *   - Map WizardErrorCopy.fix[] → debug_context
 *   - Derive recoverable from actions array (clear_and_retry OR try_another_key)
 *   - Fall through to UNKNOWN copy for unknown codes (never returns null)
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WizardErrorEnvelope, type ErrorEnvelope } from "./WizardErrorEnvelope";
import { buildEnvelope } from "@/lib/envelope";
import { WIZARD_ERROR_COPY } from "@/lib/wizardErrors";

const baseEnvelope: ErrorEnvelope = {
  ok: false,
  code: "KEY_INVALID_SIGNATURE",
  human_message: "We couldn't reach OKX with that key.",
  debug_context: ["Check key permissions", "Verify IP allowlist"],
  correlation_id: "cid-123",
  recoverable: true,
};

describe("[OBSERV-06] WizardErrorEnvelope", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders human_message + debug_context bullets + role=alert + data-error-code", () => {
    render(<WizardErrorEnvelope envelope={baseEnvelope} />);
    const root = screen.getByTestId("wizard-error-envelope");
    expect(root.getAttribute("role")).toBe("alert");
    expect(root.getAttribute("data-error-code")).toBe("KEY_INVALID_SIGNATURE");
    expect(screen.getByText("We couldn't reach OKX with that key.")).toBeInTheDocument();
    expect(screen.getByText("Check key permissions")).toBeInTheDocument();
    expect(screen.getByText("Verify IP allowlist")).toBeInTheDocument();
  });

  it("copy button calls navigator.clipboard.writeText with stringified envelope and announces ARIA-live", async () => {
    render(<WizardErrorEnvelope envelope={baseEnvelope} />);
    const btn = screen.getByRole("button", { name: /copy diagnostics/i });
    fireEvent.click(btn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      JSON.stringify(baseEnvelope, null, 2),
    );
    // ARIA-live status updates after the click resolves
    await waitFor(() => {
      expect(screen.getByText("Copied to clipboard")).toBeInTheDocument();
    });
  });

  it("renders Retry only when recoverable AND onRetry provided", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <WizardErrorEnvelope envelope={baseEnvelope} onRetry={onRetry} />,
    );
    expect(screen.queryByRole("button", { name: /^retry$/i })).toBeInTheDocument();
    rerender(
      <WizardErrorEnvelope
        envelope={{ ...baseEnvelope, recoverable: false }}
        onRetry={onRetry}
      />,
    );
    expect(screen.queryByRole("button", { name: /^retry$/i })).not.toBeInTheDocument();
  });

  it("nested <button> elements do NOT submit a parent <form> (Pitfall 9 — type='button')", () => {
    const onSubmit = vi.fn((e: React.FormEvent<HTMLFormElement>) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <WizardErrorEnvelope envelope={baseEnvelope} />
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: /copy diagnostics/i }));
    // Open the diagnostics summary too — the click on a <summary> element
    // (which is not a button) should also not submit. The plan's Pitfall 9
    // mitigation only covers <button>; <summary> does not trigger form
    // submission natively, so this asserts BOTH paths are quiet.
    const summary = screen.getByText(/^diagnostics$/i);
    fireEvent.click(summary);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders correlation_id inside diagnostics", () => {
    render(<WizardErrorEnvelope envelope={baseEnvelope} />);
    expect(screen.getByText(baseEnvelope.correlation_id)).toBeInTheDocument();
  });
});

describe("[OBSERV-06] buildEnvelope", () => {
  it("maps a known code to a recoverable envelope with human_message + debug_context", () => {
    // KEY_INVALID_SIGNATURE actions include clear_and_retry → recoverable=true
    const env = buildEnvelope("KEY_INVALID_SIGNATURE", "cid-x");
    expect(env.code).toBe("KEY_INVALID_SIGNATURE");
    expect(env.correlation_id).toBe("cid-x");
    expect(env.ok).toBe(false);
    expect(env.recoverable).toBe(true);
    expect(env.human_message).toBe(WIZARD_ERROR_COPY.KEY_INVALID_SIGNATURE.title);
    expect(env.debug_context).toEqual(WIZARD_ERROR_COPY.KEY_INVALID_SIGNATURE.fix);
  });

  it("UNKNOWN fallback returns a valid envelope (never null)", () => {
    const env = buildEnvelope("UNKNOWN", "cid-y");
    expect(env.code).toBe("UNKNOWN");
    expect(env.correlation_id).toBe("cid-y");
    expect(env.human_message).toBeTruthy();
    expect(Array.isArray(env.debug_context)).toBe(true);
    expect(env.debug_context.length).toBeGreaterThan(0);
  });

  it("derives recoverable=false when the actions array contains no recoverable verbs", () => {
    // SUBMIT_NOTIFY_FAILED actions = ["request_call"] — no recoverable verb → false
    const env = buildEnvelope("SUBMIT_NOTIFY_FAILED", "cid-z");
    expect(env.recoverable).toBe(false);
  });
});

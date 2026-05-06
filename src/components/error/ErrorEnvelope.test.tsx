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

  it("Retry button has aria-label='Retry' (UI-SPEC §8.4)", () => {
    render(<ErrorEnvelope envelope={makeEnvelope()} onRetry={() => {}} />);
    expect(screen.getByLabelText("Retry")).toBeInTheDocument();
    // Visible label is the bare word "Retry".
    expect(screen.getByRole("button", { name: "Retry" }))
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
    // Pin the replacement marker so a future regression that strips the line
    // entirely (or replaces the JWT with an empty string) fails loudly. The
    // third-pass scrubber (`scrubFreeformString` / `JWT_SUBSTRING`) emits
    // `[REDACTED_JWT]` exactly.
    expect(written).toContain("[REDACTED_JWT]");
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

  // Negative path: writeText rejects (e.g. clipboard permission denied).
  // Button must NOT show "Copied" and the ARIA-live status must NOT
  // announce "Copied to clipboard". Surfaces a regression where a
  // future caller forgets to await + catches the rejection.
  it("does NOT announce 'Copied' when navigator.clipboard.writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ErrorEnvelope envelope={makeEnvelope()} />);
    fireEvent.click(screen.getByText("Copy diagnostics"));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    // Allow the rejected promise + microtask flush so any state update would settle.
    await Promise.resolve();
    expect(screen.getByText("Copy diagnostics")).toBeInTheDocument();
    expect(screen.queryByText("Copied")).toBeNull();
    expect(screen.queryByText("Copied to clipboard")).toBeNull();
  });

  // Pin the auto-reset behavior so a regression that drops the setTimeout
  // (or flips its sign) fails. Without this assertion, the suite checks
  // that the badge appears after copy but never that it disappears.
  //
  // Real timers + waitFor with an extended ceiling. Fake timers don't mix
  // cleanly with the real Promise returned by `navigator.clipboard.writeText`
  // here — switching to fake timers after the resolved click leaves the
  // already-queued setTimeout in real-time land. Real timers add ~2s to
  // the suite, which is acceptable for one regression seam.
  it("clears the 'Copied' state ~2s after a successful copy", async () => {
    render(<ErrorEnvelope envelope={makeEnvelope()} />);
    fireEvent.click(screen.getByText("Copy diagnostics"));
    await waitFor(() => {
      expect(screen.getByText("Copied")).toBeInTheDocument();
    });
    await waitFor(
      () => {
        expect(screen.getByText("Copy diagnostics")).toBeInTheDocument();
      },
      { timeout: 2_500 },
    );
    expect(screen.queryByText("Copied")).toBeNull();
    expect(screen.queryByText("Copied to clipboard")).toBeNull();
  });

  // Phase-16 IN-01 regression: when the component unmounts inside the 2s
  // "Copied" flash window, the timer must be cleared so it never fires on
  // an unmounted tree. We capture the setTimeout return id from the
  // component's call, spy on clearTimeout, and assert the spy is invoked
  // with that exact id during unmount. Asserting on the id (not the call
  // count) avoids the brittleness of counting all clearTimeout calls in
  // the process — Testing-Library and jsdom may call clearTimeout
  // internally, but they will not call it with our specific id.
  it("clears the 'Copied' timer on unmount during flash (Phase-16 IN-01)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const { unmount } = render(<ErrorEnvelope envelope={makeEnvelope()} />);
    fireEvent.click(screen.getByText("Copy diagnostics"));
    await waitFor(() => {
      expect(screen.getByText("Copied")).toBeInTheDocument();
    });
    // The component's 2s timer is the most recent setTimeout call with
    // a 2000ms delay. Capture its return id.
    const componentTimerCall = setTimeoutSpy.mock.results
      .filter((_, i) => setTimeoutSpy.mock.calls[i][1] === 2000)
      .pop();
    expect(componentTimerCall).toBeDefined();
    const componentTimerId = componentTimerCall!.value;
    unmount();
    // Cleanup must clear THAT specific id.
    const clearedIds = clearTimeoutSpy.mock.calls.map((c) => c[0]);
    expect(clearedIds).toContain(componentTimerId);
    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });

  // Adversarial follow-up to IN-01: navigator.clipboard.writeText is async,
  // so the resolution can land AFTER unmount. Without an isMounted guard,
  // the post-await `setCopied(true)` would queue a React state update on
  // an unmounted tree (React 19 warns; React 18 logged loudly). The fix
  // checks `isMountedRef.current` BEFORE touching state.
  it("does not setCopied after unmount even if writeText resolves late", async () => {
    let resolveWrite: () => void = () => {};
    const writeText = vi.fn(
      () => new Promise<void>((res) => { resolveWrite = res; }),
    );
    Object.assign(navigator, { clipboard: { writeText } });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<ErrorEnvelope envelope={makeEnvelope()} />);
    fireEvent.click(screen.getByText("Copy diagnostics"));
    expect(writeText).toHaveBeenCalledTimes(1);
    // Unmount BEFORE the clipboard promise resolves.
    unmount();
    // Now resolve. Without the isMounted guard, this would trigger a
    // setState-on-unmounted-component warning. With the guard, it's a no-op.
    resolveWrite();
    await Promise.resolve();
    await Promise.resolve();
    // No React warnings about state updates on unmounted components.
    const warningCalls = consoleErrorSpy.mock.calls.filter((args) =>
      args.some((a) => typeof a === "string" && a.includes("unmounted")),
    );
    expect(warningCalls).toHaveLength(0);
    consoleErrorSpy.mockRestore();
  });

  // Companion: when no copy click ever happens, the cleanup effect must
  // not throw or interact with timers it never registered.
  it("unmounts cleanly when no copy occurred (Phase-16 IN-01)", () => {
    const { unmount } = render(<ErrorEnvelope envelope={makeEnvelope()} />);
    expect(() => unmount()).not.toThrow();
  });

  // Phase 21 — `cause` field carries WizardErrorCopy.cause (the WHY)
  // and was being silently dropped before. Regression: a Bybit live key
  // with 3,842 fills in <7 calendar days hit GATE_INSUFFICIENT_DAYS in
  // /qa 2026-05-05 — the title alone ("needs 7 days of activity") was
  // misleading; the cause text says "calendar days" explicitly.
  it("renders the cause subtitle between title and debug_context list", () => {
    render(
      <ErrorEnvelope
        envelope={makeEnvelope({
          human_message: "Title here.",
          cause: "Specific calendar-day rule.",
          debug_context: ["Step one."],
        })}
      />,
    );
    const causeP = screen.getByText("Specific calendar-day rule.");
    const title = screen.getByText("Title here.");
    const list = document.querySelector("ul");
    expect(causeP).toBeInTheDocument();
    // Cause must follow the title and precede the bullet list.
    expect(title.compareDocumentPosition(causeP)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(causeP.compareDocumentPosition(list!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("does NOT render a cause paragraph when envelope.cause is absent", () => {
    render(<ErrorEnvelope envelope={makeEnvelope()} />);
    const alert = screen.getByRole("alert");
    // Only the title and the debug_context list; no extra <p> between them.
    const ps = alert.querySelectorAll("p");
    // The first <p> is the title. Any additional <p> before the <ul> would
    // indicate a regression where an empty cause is being rendered.
    expect(ps[0].textContent).toBe("Invalid signature.");
    const list = alert.querySelector("ul");
    expect(list).not.toBeNull();
    // Walk DOM order from title to list — there should be NO <p> in between.
    let n = ps[0].nextElementSibling;
    while (n && n !== list) {
      expect(n.tagName).not.toBe("P");
      n = n.nextElementSibling;
    }
  });

  // Empty debug_context → guard clause at line 154 in the component must
  // suppress the <ul>. Without the guard, the surface renders an empty
  // bullet list which is a screen-reader noise source.
  it("does NOT render a body <ul> when debug_context is empty", () => {
    render(<ErrorEnvelope envelope={makeEnvelope({ debug_context: [] })} />);
    const alert = screen.getByRole("alert");
    expect(alert.querySelector("ul")).toBeNull();
  });

  // Both Retry and Cancel render simultaneously when recoverable=true and
  // both handlers are passed. Locks the showRetry/showCancel guards in
  // place — flipping either to use the wrong handler reference would
  // cause exactly one of these assertions to fail.
  it("renders BOTH Retry and Cancel when recoverable=true and both handlers are passed", () => {
    render(
      <ErrorEnvelope
        envelope={makeEnvelope()}
        onRetry={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByLabelText("Retry")).toBeInTheDocument();
    expect(screen.getByLabelText("Cancel and return")).toBeInTheDocument();
  });
});

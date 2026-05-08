/**
 * Audit-2026-05-07 #43 — ShareableLink regression tests.
 *
 * The component used to set `copied=true` even when both clipboard paths
 * silently failed: `navigator.clipboard.writeText` rejected, the
 * execCommand fallback returned false, and the success badge fired anyway.
 * The fix tracks `fallbackSucceeded` and renders a `copyFailed` state
 * (red badge + "Copy failed — copy the URL manually") when both paths fail.
 *
 * Branches verified:
 *   1. clipboard.writeText resolves          → "Link copied!"
 *   2. clipboard rejects, execCommand=true   → "Link copied!"  (fallback OK)
 *   3. clipboard rejects, execCommand=false  → "Copy failed"   (regression branch)
 *   4. clipboard rejects, execCommand throws → "Copy failed"   (regression branch)
 *   5. The temporary <input> created for execCommand is removed from the DOM
 *      after the fallback runs (cleanup in finally).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { ShareableLink } from "./ShareableLink";

const STRATEGY_ID = "11111111-1111-4111-8111-111111111111";

const ORIGINAL_CLIPBOARD = navigator.clipboard;
const ORIGINAL_EXEC = document.execCommand;

function setClipboard(impl: { writeText: (s: string) => Promise<void> } | undefined): void {
  Object.defineProperty(navigator, "clipboard", {
    value: impl,
    configurable: true,
    writable: true,
  });
}

function setExecCommand(impl: () => boolean): void {
  Object.defineProperty(document, "execCommand", {
    value: impl,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: { ...window.location, origin: "https://example.test" },
    configurable: true,
  });
});

afterEach(() => {
  setClipboard(ORIGINAL_CLIPBOARD as unknown as { writeText: (s: string) => Promise<void> });
  Object.defineProperty(document, "execCommand", {
    value: ORIGINAL_EXEC,
    configurable: true,
    writable: true,
  });
  vi.useRealTimers();
});

describe("ShareableLink — Audit #43 copyFailed regression", () => {
  it("writes the factsheet URL to navigator.clipboard and shows 'Link copied!' on success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    render(<ShareableLink strategyId={STRATEGY_ID} />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        `https://example.test/factsheet/${STRATEGY_ID}`,
      );
    });
    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(/Link copied!/),
    );
  });

  it("falls back to execCommand and shows 'Link copied!' when clipboard.writeText rejects but the fallback returns true", async () => {
    setClipboard({
      writeText: vi.fn().mockRejectedValue(new Error("blocked")),
    });
    const exec = vi.fn().mockReturnValue(true);
    setExecCommand(exec);

    render(<ShareableLink strategyId={STRATEGY_ID} />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(exec).toHaveBeenCalledWith("copy"));
    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(/Link copied!/),
    );
  });

  it("renders 'Copy failed — copy the URL manually' when both clipboard paths fail (regression: Audit #43)", async () => {
    // The exact pre-fix bug: writeText rejects AND execCommand returns false.
    // Old behaviour: success badge anyway. New behaviour: failure badge.
    setClipboard({
      writeText: vi.fn().mockRejectedValue(new Error("blocked")),
    });
    setExecCommand(vi.fn().mockReturnValue(false));

    render(<ShareableLink strategyId={STRATEGY_ID} />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(
        /Copy failed — copy the URL manually/,
      ),
    );
    // Belt-and-suspenders: success copy must NOT be visible.
    expect(screen.getByRole("button").textContent).not.toMatch(/Link copied!/);
  });

  it("renders 'Copy failed' when clipboard rejects and execCommand throws", async () => {
    setClipboard({
      writeText: vi.fn().mockRejectedValue(new Error("blocked")),
    });
    setExecCommand(() => {
      throw new Error("execCommand unsupported");
    });

    render(<ShareableLink strategyId={STRATEGY_ID} />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(
        /Copy failed — copy the URL manually/,
      ),
    );
  });

  it("removes the temporary <input> from document.body after the execCommand fallback runs", async () => {
    setClipboard({
      writeText: vi.fn().mockRejectedValue(new Error("blocked")),
    });
    setExecCommand(vi.fn().mockReturnValue(true));

    render(<ShareableLink strategyId={STRATEGY_ID} />);
    const inputsBefore = document.body.querySelectorAll("input").length;
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(/Link copied!/),
    );
    // The fallback creates a transient <input> that must be cleaned up
    // in the finally block — leaking these would pollute every page that
    // hosts ShareableLink with a random selected input element.
    expect(document.body.querySelectorAll("input").length).toBe(inputsBefore);
  });
});

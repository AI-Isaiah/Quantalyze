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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Phase 164 (SHARE-04) — every arm above now passes `published`, which became a
 * REQUIRED prop. They were always the published branch; the prop only makes the
 * fact explicit, and the URL they assert is byte-unchanged.
 *
 * The block at the bottom of this file covers the branch that did not exist
 * before: an UNPUBLISHED strategy mints a revocable link instead of handing out
 * a public URL that 404s. It extends the SAME honest-failure discipline audit
 * #43 established here — a mint failure must be exactly as visible as a
 * clipboard failure, and neither may reach the success badge.
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

    render(<ShareableLink strategyId={STRATEGY_ID} published />);
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

    render(<ShareableLink strategyId={STRATEGY_ID} published />);
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

    render(<ShareableLink strategyId={STRATEGY_ID} published />);
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

    render(<ShareableLink strategyId={STRATEGY_ID} published />);
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

    render(<ShareableLink strategyId={STRATEGY_ID} published />);
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

/**
 * Phase 164 (SHARE-04) — one predicate, two mechanisms.
 *
 * The claim under test is not "the component can mint". It is that the SAME
 * component, given the SAME click, produces a URL whose disclosure properties
 * match the strategy's actual visibility — a public URL for a public document,
 * a revocable capability for a private one — and that it never claims success
 * for a link it did not obtain.
 */
describe("ShareableLink — the share predicate (SHARE-04)", () => {
  const MINTED_URL = "https://quantalyze.xyz/factsheet-share/tok-en-abc";

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("published=true copies the public factsheet URL and never touches the mint route", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    render(<ShareableLink strategyId={STRATEGY_ID} published />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `https://example.test/factsheet/${STRATEGY_ID}`,
      ),
    );
    // The load-bearing negative: a published strategy's id is already public,
    // so wrapping it in a capability token would be revocation theatre over
    // public data (D-09). If a future refactor "unifies" the lanes onto the
    // token, this is the assertion that notices.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("published=false MINTS and copies the returned url — an unpublished row is no longer affordance-less", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ url: MINTED_URL }),
    });

    render(<ShareableLink strategyId={STRATEGY_ID} published={false} />);
    // The label states what the click will do; "Share Factsheet" would be false
    // for a strategy that has no public factsheet.
    expect(screen.getByRole("button").textContent).toMatch(/Get private link/);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(MINTED_URL));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/strategies/${STRATEGY_ID}/share`,
    );
    // Never the public id URL — that is the exact link that 404s for the
    // recipient, which is the defect this phase exists to remove.
    expect(writeText).not.toHaveBeenCalledWith(
      `https://example.test/factsheet/${STRATEGY_ID}`,
    );
    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(/Link copied!/),
    );
  });

  it("a failed mint surfaces the failure and NEVER flashes 'Link copied!'", async () => {
    // Audit #43's discipline, extended to the new failure source. The clipboard
    // here is perfectly healthy — the point is that a broken MINT must be just
    // as visible as a broken clipboard, because to the user both mean the same
    // thing: no working link.
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    render(<ShareableLink strategyId={STRATEGY_ID} published={false} />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(
        /Couldn't create the link — try again/,
      ),
    );
    expect(screen.getByRole("button").textContent).not.toMatch(/Link copied!/);
    expect(
      writeText,
      "nothing may be written to the clipboard when nothing was minted",
    ).not.toHaveBeenCalled();
  });

  it("a 200 with no url in the body is a failure, not a copy of `undefined`", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    render(<ShareableLink strategyId={STRATEGY_ID} published={false} />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(
        /Couldn't create the link — try again/,
      ),
    );
    expect(writeText).not.toHaveBeenCalled();
  });
});

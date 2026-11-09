/** @vitest-environment jsdom */
/**
 * SF-05 (Phase 196 round 1) — the error / loading / not-found boundaries sit at
 * `src/app/factsheet/[id]/`, so the canonical `/factsheet/[id]` (the one URL
 * every retired route now 308s to) and the `/v2` alias beneath it are both
 * covered. They used to live under `v2/` only; a throw or a miss on the
 * canonical URL fell through to the root boundary. The one-`<main>`-per-state
 * pin for loading and not-found is in `v2/page.viewer-chrome.test.tsx`.
 *
 * `loading.tsx` stays under `v2/` (round 2, R2-01). A `loading.tsx` starts the
 * stream, the stream fixes the status at 200 (loading.md, "Status codes"), and
 * a `[id]/loading.tsx` would wrap `/factsheet/[id]` AND `/factsheet/[id]/tearsheet`:
 * every throw and `notFound()` there would answer 200, and `tearsheet.pdf` would
 * print and publicly cache the error page.
 *
 * WHY the retry arm: a server-component throw is not cured by clearing the
 * boundary's state, which re-renders the same failed result. `retry()` re-runs
 * the server render (error.md, `retry`); `reset()` does not. WHY one `<main>`
 * per state: the page renders its own `<main>`, so each boundary state must
 * carry exactly one, or the route has none or two landmarks.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const captureToSentry = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry }));

import FactsheetError from "./error";

beforeEach(() => {
  captureToSentry.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("factsheet error boundary", () => {
  it("Try again re-runs the server render through retry(), and never through reset()", async () => {
    const retry = vi.fn();
    const reset = vi.fn();
    const err = Object.assign(new Error("boom"), { digest: "d-1" });
    render(<FactsheetError error={err} retry={retry} reset={reset} />);

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it("renders one main, shows the digest only and never the thrown message", () => {
    const secret = "INTERNAL-PG-ERROR-leaked-secret";
    const err = Object.assign(new Error(secret), { digest: "abc-123" });
    const { container } = render(<FactsheetError error={err} retry={vi.fn()} reset={vi.fn()} />);

    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByText("abc-123")).toBeTruthy();
    expect(container.textContent).not.toContain(secret);
  });

  it("reports the throw to Sentry, because the root boundary that used to catch it no longer does", () => {
    const err = Object.assign(new Error("boom"), { digest: "d-2" });
    render(<FactsheetError error={err} retry={vi.fn()} reset={vi.fn()} />);

    expect(captureToSentry).toHaveBeenCalledTimes(1);
    expect(captureToSentry.mock.calls[0][0]).toBe(err);
  });
});

describe("loading boundary placement (R2-01)", () => {
  it("there is no loading.tsx at factsheet/[id]/, so the canonical route and the tear sheet keep real 404 and 500 statuses", () => {
    expect(existsSync(join(__dirname, "loading.tsx"))).toBe(false);
    // The boundaries that do not start the stream stay here.
    expect(existsSync(join(__dirname, "error.tsx"))).toBe(true);
    expect(existsSync(join(__dirname, "not-found.tsx"))).toBe(true);
  });
});

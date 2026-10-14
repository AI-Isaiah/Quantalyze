/**
 * Phase 170.6.2 / WR-01 — the client-only "prefs applied" hydration signal.
 *
 * WHY THIS FILE EXISTS. Two blocking e2e-seeded specs (`e2e/full-flow.spec.ts`
 * and `e2e/discovery-hide-examples-default.spec.ts`) used to wait for the
 * "Hide examples" box to read `checked` as proof that React had hydrated. Since
 * D-06 the SERVER HTML already carries `checked=""`, so that wait passes before
 * any JS runs, and a Space keypress sent right after it can land on an
 * un-hydrated input and be lost. The specs now wait on
 * `html[data-strategy-table-prefs-applied="true"]`, which only a client effect
 * can set.
 *
 * WHAT A READER WOULD BE HURT BY LOSING:
 *   A. NOT AT RENDER. The signal must be set by an effect, never during render.
 *      A render-time write would reach the document under `renderToString` (the
 *      server pass, which runs render and no effects) and the specs' wait would
 *      be a no-op again. This is the arm that bites that regression.
 *   B. SET AFTER EFFECTS. A client mount must set it, or the specs wait forever.
 *   C. CLEARED ON UNMOUNT. A stale `true` left behind by a table that is gone
 *      (client navigation to another page) would also make the wait vacuous.
 *
 * The attribute lives on `<html>`, not inside the table, on purpose: the
 * default-mounts byte pin (`__fixtures__/strategy-table-default-mounts.json`)
 * compares `container.innerHTML` AFTER effects, so an attribute on any
 * table-owned node would move that fixture. This file does not touch it.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { render } from "@testing-library/react";
import { StrategyTable } from "./StrategyTable";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";

const ATTR = "data-strategy-table-prefs-applied";

beforeEach(() => {
  installFetchMock();
  document.documentElement.removeAttribute(ATTR);
  try {
    window.localStorage.clear();
  } catch {
    // jsdom may not implement clear in some configurations; non-fatal.
  }
});

afterEach(() => {
  restoreFetchMock();
  document.documentElement.removeAttribute(ATTR);
});

describe("StrategyTable prefs-applied hydration signal (170.6.2 WR-01)", () => {
  it("A: is absent from the server pass and does not touch the document during render", () => {
    const html = renderToString(
      <StrategyTable strategies={[]} categorySlug="prefs-applied-a" />,
    );
    // Positive control: the render produced the table shell at all.
    expect(html).toContain("Hide examples");
    expect(html).not.toContain(ATTR);
    expect(document.documentElement.hasAttribute(ATTR)).toBe(false);
  });

  it("B: is set once the client effect has run", () => {
    render(<StrategyTable strategies={[]} categorySlug="prefs-applied-b" />);
    expect(document.documentElement.getAttribute(ATTR)).toBe("true");
  });

  it("B: is set for a signed-in mount too (prefs hydrate behind storage)", () => {
    render(
      <StrategyTable
        strategies={[]}
        categorySlug="prefs-applied-b2"
        userId="u-1"
      />,
    );
    expect(document.documentElement.getAttribute(ATTR)).toBe("true");
  });

  it("C: is cleared when the table unmounts", () => {
    const { unmount } = render(
      <StrategyTable strategies={[]} categorySlug="prefs-applied-c" />,
    );
    expect(document.documentElement.getAttribute(ATTR)).toBe("true");
    unmount();
    expect(document.documentElement.hasAttribute(ATTR)).toBe(false);
  });
});

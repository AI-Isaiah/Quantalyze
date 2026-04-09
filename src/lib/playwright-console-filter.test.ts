import { describe, it, expect } from "vitest";
import {
  filterUnexpectedConsoleErrors,
  isUnexpectedConsoleError,
  type CapturedConsoleError,
} from "./playwright-console-filter";

/**
 * Regression tests for the Playwright console error filter.
 *
 * These tests pin down the specific bug that broke `e2e/demo-founder-view.spec.ts`
 * in CI on commit 0089cee: the original spec captured only `msg.text()` and tried
 * to exclude `/api/demo/match` by substring-matching the text. But Chrome's
 * browser-level resource errors emit the text `"Failed to load resource: the
 * server responded with a status of 500 (...)"` and the URL lives separately
 * on `msg.location().url`. The filter was a silent no-op for exactly the case
 * it needed to catch.
 *
 * The test cases below include the EXACT text string Chrome emits, so any
 * future refactor that drops the URL-field check (or silently swaps the
 * tuple shape) fails this suite.
 */

// The exact console message text Chrome emits for a failed-resource
// network error. Captured from a Playwright CI run on 2026-04-09.
const CHROME_500_TEXT =
  "Failed to load resource: the server responded with a status of 500 (Internal Server Error)";

describe("isUnexpectedConsoleError", () => {
  it("returns true for a plain error that matches no ignore rule", () => {
    const err: CapturedConsoleError = {
      text: "Uncaught TypeError: foo is undefined",
      url: "http://localhost:3000/app.js",
    };
    expect(isUnexpectedConsoleError(err)).toBe(true);
  });

  it("filters out Hydration warnings via ignoreTextIncludes", () => {
    const err: CapturedConsoleError = {
      text: "Hydration failed because the initial UI does not match",
      url: "http://localhost:3000/demo",
    };
    expect(
      isUnexpectedConsoleError(err, {
        ignoreTextIncludes: ["Hydration", "NEXT_REDIRECT"],
      }),
    ).toBe(false);
  });

  it("filters out NEXT_REDIRECT via ignoreTextIncludes", () => {
    const err: CapturedConsoleError = {
      text: "Error: NEXT_REDIRECT",
      url: "http://localhost:3000/login",
    };
    expect(
      isUnexpectedConsoleError(err, {
        ignoreTextIncludes: ["Hydration", "NEXT_REDIRECT"],
      }),
    ).toBe(false);
  });

  // ---- THE BUG THAT BROKE CI ----
  // These cases pin down the regression. Chrome emits a generic
  // "Failed to load resource" text that has NO trace of the URL. The
  // original filter substring-matched the text with "/api/demo/match"
  // and that never hit because the URL was on .location().url.
  describe("browser resource error regression (commit 0089cee)", () => {
    it("filters a 500 on /api/demo/match when the URL field matches", () => {
      const err: CapturedConsoleError = {
        text: CHROME_500_TEXT,
        url: "http://localhost:3000/api/demo/match/11111111-1111-4111-8111-111111111111",
      };
      expect(
        isUnexpectedConsoleError(err, {
          ignoreTextOrUrlIncludes: ["/api/demo/match"],
        }),
      ).toBe(false);
    });

    it("does NOT filter the same 500 if the ignore rule only checks text (the old bug)", () => {
      // Prove the bug explicitly: if we pretend the filter only had
      // text-level rules (the pre-fix behavior), the 500 slips through.
      // This guards against anyone thinking "let's simplify, URL field
      // is redundant" and removing the URL check.
      const err: CapturedConsoleError = {
        text: CHROME_500_TEXT,
        url: "http://localhost:3000/api/demo/match/11111111-1111-4111-8111-111111111111",
      };
      expect(
        isUnexpectedConsoleError(err, {
          ignoreTextIncludes: ["/api/demo/match"],
        }),
      ).toBe(true); // <-- the bug: treated as unexpected
    });

    it("still filters errors where the URL is embedded in the text (older Chrome versions)", () => {
      // Some older Chrome builds AND the JS-level `fetch().catch(err)`
      // path produce a single console error whose text DOES contain the
      // URL. The ignoreTextOrUrlIncludes option handles both cases.
      const err: CapturedConsoleError = {
        text: "Failed to fetch /api/demo/match/some-id: NetworkError",
        url: "http://localhost:3000/demo/founder-view",
      };
      expect(
        isUnexpectedConsoleError(err, {
          ignoreTextOrUrlIncludes: ["/api/demo/match"],
        }),
      ).toBe(false);
    });
  });

  it("combines ignoreTextIncludes and ignoreTextOrUrlIncludes", () => {
    const errs: CapturedConsoleError[] = [
      // Expected: hydration noise
      { text: "Hydration mismatch at div", url: "http://localhost:3000/demo" },
      // Expected: /api/demo/match 500 (URL match)
      {
        text: CHROME_500_TEXT,
        url: "http://localhost:3000/api/demo/match/abc",
      },
      // Unexpected: real TypeError
      {
        text: "Uncaught TypeError: Cannot read properties of undefined (reading 'foo')",
        url: "http://localhost:3000/app.js",
      },
    ];

    const unexpected = filterUnexpectedConsoleErrors(errs, {
      ignoreTextIncludes: ["Hydration", "NEXT_REDIRECT", "Failed to fetch"],
      ignoreTextOrUrlIncludes: ["/api/demo/match"],
    });

    expect(unexpected).toHaveLength(1);
    expect(unexpected[0].text).toContain("TypeError");
  });

  it("treats an empty options object as 'never filter anything'", () => {
    const err: CapturedConsoleError = {
      text: "anything",
      url: "http://localhost:3000/app.js",
    };
    expect(isUnexpectedConsoleError(err)).toBe(true);
  });

  it("does not mutate the input array", () => {
    const errs: CapturedConsoleError[] = [
      { text: "Hydration", url: "http://localhost:3000/" },
    ];
    const snapshot = JSON.stringify(errs);
    filterUnexpectedConsoleErrors(errs, { ignoreTextIncludes: ["Hydration"] });
    expect(JSON.stringify(errs)).toBe(snapshot);
  });
});

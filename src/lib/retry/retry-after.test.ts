import { describe, it, expect } from "vitest";
import { parseRetryAfterSeconds, type RetryAfterHeaders } from "./retry-after";

/** Minimal exact-case header double (the parser only ever reads the canonical
 *  "Retry-After" / "Date" casing). Returns null for any absent key, like Headers.get. */
function hdrs(map: Record<string, string>): RetryAfterHeaders {
  return { get: (k: string) => map[k] ?? null };
}

describe("parseRetryAfterSeconds — delta-seconds form (RFC 9110)", () => {
  it("parses a positive integer seconds count", () => {
    expect(parseRetryAfterSeconds(hdrs({ "Retry-After": "120" }))).toBe(120);
    expect(parseRetryAfterSeconds(hdrs({ "Retry-After": "1" }))).toBe(1);
  });

  it("parses a fractional seconds value verbatim (callers clamp/ceil)", () => {
    expect(parseRetryAfterSeconds(hdrs({ "Retry-After": "1.5" }))).toBe(1.5);
  });

  it("returns null for a ZERO value — the hot-retry guard (NEW-C05-01)", () => {
    // `Number("0")` is 0; returning it would yield setTimeout(fn, 0) = instant
    // re-hit of the still-throttled bucket. Must be null so the caller defaults.
    expect(parseRetryAfterSeconds(hdrs({ "Retry-After": "0" }))).toBeNull();
  });

  it("returns null for a negative value", () => {
    expect(parseRetryAfterSeconds(hdrs({ "Retry-After": "-5" }))).toBeNull();
  });

  it("returns null for a non-numeric, non-date garbage value (NaN guard)", () => {
    expect(parseRetryAfterSeconds(hdrs({ "Retry-After": "3abc" }))).toBeNull();
    expect(parseRetryAfterSeconds(hdrs({ "Retry-After": "soon" }))).toBeNull();
  });

  it("returns null for an empty / whitespace-only value", () => {
    expect(parseRetryAfterSeconds(hdrs({ "Retry-After": "" }))).toBeNull();
    expect(parseRetryAfterSeconds(hdrs({ "Retry-After": "   " }))).toBeNull();
  });

  it("never returns NaN, 0, or a negative for any malformed input", () => {
    for (const v of ["", " ", "0", "-1", "-9999", "NaN", "abc", "Infinity"]) {
      const out = parseRetryAfterSeconds(hdrs({ "Retry-After": v }));
      expect(out === null || (Number.isFinite(out) && out > 0)).toBe(true);
    }
  });
});

describe("parseRetryAfterSeconds — HTTP-date form", () => {
  it("resolves the delta against the response's own Date header (server clock)", () => {
    const out = parseRetryAfterSeconds(
      hdrs({
        Date: "Wed, 21 Oct 2026 07:28:00 GMT",
        "Retry-After": "Wed, 21 Oct 2026 07:28:10 GMT",
      }),
    );
    expect(out).toBe(10);
  });

  it("ceils a sub-second future delta up to 1s (never returns <1 from a future date)", () => {
    // HTTP-date is second-granular, but Date.parse is lenient and accepts an ISO
    // string with millisecond precision — exercises the defensive Math.ceil so a
    // sub-second delta can never collapse to a 0s (hot-retry) wait.
    const out = parseRetryAfterSeconds(
      hdrs({
        Date: "2026-10-21T07:28:00.000Z",
        "Retry-After": "2026-10-21T07:28:00.300Z", // +0.3s
      }),
    );
    expect(out).toBe(1);
  });

  it("returns null for an HTTP-date in the PAST (non-positive delta)", () => {
    expect(
      parseRetryAfterSeconds(
        hdrs({
          Date: "Wed, 21 Oct 2026 07:28:10 GMT",
          "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT", // 10s in the past
        }),
      ),
    ).toBeNull();
  });

  it("returns null for an HTTP-date with NO Date header (delta not reliably knowable)", () => {
    // Matches useMandateAutoSave NEW-C05-01: HTTP-date + no Date base → caller's
    // 5s default fires, never a NaN hang.
    expect(
      parseRetryAfterSeconds(hdrs({ "Retry-After": "Mon, 26 May 2026 12:00:05 GMT" })),
    ).toBeNull();
  });

  it("returns null when the Date header itself is unparseable", () => {
    expect(
      parseRetryAfterSeconds(
        hdrs({ Date: "not-a-date", "Retry-After": "Wed, 21 Oct 2026 07:28:10 GMT" }),
      ),
    ).toBeNull();
  });
});

describe("parseRetryAfterSeconds — absent header / defensive inputs", () => {
  it("returns null when the header is absent", () => {
    expect(parseRetryAfterSeconds(hdrs({}))).toBeNull();
  });

  it("returns null for null / undefined headers, or a headers object with no get", () => {
    expect(parseRetryAfterSeconds(null)).toBeNull();
    expect(parseRetryAfterSeconds(undefined)).toBeNull();
    expect(parseRetryAfterSeconds({} as RetryAfterHeaders)).toBeNull();
  });

  it("works with a real WHATWG Headers instance (case-insensitive get)", () => {
    expect(parseRetryAfterSeconds(new Headers({ "Retry-After": "30" }))).toBe(30);
    expect(parseRetryAfterSeconds(new Headers({}))).toBeNull();
  });
});

/**
 * Phase 164 / SHARE-01 — input/output vectors for the share-path scrubber.
 *
 * The oracle is typed HERE, by hand, and never imported from the module under
 * test: `EXPECTED_PLACEHOLDER` is a literal string, so a change to the module's
 * exported placeholder constant reddens these tests instead of silently
 * re-baselining them.
 *
 * The load-bearing property is the LAST describe block: no output may still
 * contain the token. Asserting only "equals the expected string" would pass
 * against a scrubber that mangled the URL some other way; asserting the token
 * is absent is the property the Sentry channel actually needs.
 */
import { describe, it, expect } from "vitest";

import { scrubSharePath } from "./scrub-share-path";

/** A real-shaped token: 43 base64url characters, the width `deriveShareToken`
 *  emits. Typed by hand so these vectors do not depend on the deriver. */
const TOKEN = "Xk3pQ9vLm2Rt7Wb1Yz4Nc6Hs8Jd0Fg5Aq3Ue7Ip9Ov";
/** Second, distinct token — the multiple-occurrence vector needs two so a
 *  scrubber that only replaced the FIRST match cannot pass by coincidence. */
const TOKEN_2 = "Bn5Xc8Zq2Ke4Rw7Ty1Ui3Op6As9Df0Gh2Jk5Lz8Mv1";

/** The placeholder, typed independently of the module. */
const EXPECTED_PLACEHOLDER = "/factsheet-share/[token]";

describe("scrubSharePath — vectors", () => {
  it("replaces a bare token path with the placeholder", () => {
    expect(scrubSharePath(`/factsheet-share/${TOKEN}`)).toBe(
      EXPECTED_PLACEHOLDER,
    );
  });

  it("preserves a query suffix", () => {
    expect(scrubSharePath(`/factsheet-share/${TOKEN}?utm_source=email`)).toBe(
      `${EXPECTED_PLACEHOLDER}?utm_source=email`,
    );
  });

  it("preserves a hash suffix", () => {
    expect(scrubSharePath(`/factsheet-share/${TOKEN}#drawdown`)).toBe(
      `${EXPECTED_PLACEHOLDER}#drawdown`,
    );
  });

  it("scrubs inside a full absolute URL, leaving origin and query intact", () => {
    expect(
      scrubSharePath(
        `https://quantalyze.xyz/factsheet-share/${TOKEN}?ref=slack#top`,
      ),
    ).toBe(`https://quantalyze.xyz${EXPECTED_PLACEHOLDER}?ref=slack#top`);
  });

  it("replaces EVERY occurrence in one string, not just the first", () => {
    const input =
      `GET /factsheet-share/${TOKEN} failed; retried ` +
      `https://quantalyze.xyz/factsheet-share/${TOKEN_2}`;
    expect(scrubSharePath(input)).toBe(
      `GET ${EXPECTED_PLACEHOLDER} failed; retried ` +
        `https://quantalyze.xyz${EXPECTED_PLACEHOLDER}`,
    );
  });

  it("scrubs a MALFORMED token identically — the rule is unconditional", () => {
    // A malformed token reaches the same error paths as a well-formed one, so
    // a scrubber that only matched the 43-char shape would leak on exactly the
    // requests most likely to raise a Sentry event.
    expect(scrubSharePath("/factsheet-share/lolno")).toBe(EXPECTED_PLACEHOLDER);
  });

  it("scrubs the gone path too (uniform rule, nothing lost)", () => {
    // The miss classes are already indistinguishable by design, so collapsing
    // `gone` into the placeholder discards no diagnostic signal.
    expect(scrubSharePath("/factsheet-share/gone")).toBe(EXPECTED_PLACEHOLDER);
  });

  it("keeps any trailing path segments after the token", () => {
    expect(scrubSharePath(`/factsheet-share/${TOKEN}/print`)).toBe(
      `${EXPECTED_PLACEHOLDER}/print`,
    );
  });

  it("stops at whitespace inside a free-text breadcrumb message", () => {
    // REGRESSION (found by the multiple-occurrence vector during authoring):
    // the first draft's `[^/?#]+` class ate the prose that followed the token.
    expect(scrubSharePath(`GET /factsheet-share/${TOKEN} returned 500`)).toBe(
      `GET ${EXPECTED_PLACEHOLDER} returned 500`,
    );
  });

  it("absorbs punctuation that ABUTS the segment — documented, and harmless", () => {
    // `,` is an RFC 3986 sub-delim, so it is legal inside a path segment and
    // the scrubber cannot know it was sentence punctuation. The cost is one
    // lost comma in a log line; the alternative (a narrower class) risks
    // stopping SHORT of a token character, which leaks. Pinned so the
    // behaviour is a decision rather than a surprise.
    expect(scrubSharePath(`/factsheet-share/${TOKEN}, retried`)).toBe(
      `${EXPECTED_PLACEHOLDER} retried`,
    );
  });

  it("is idempotent — scrubbing an already-scrubbed string is a no-op", () => {
    const once = scrubSharePath(`/factsheet-share/${TOKEN}`);
    expect(scrubSharePath(once)).toBe(once);
  });
});

describe("scrubSharePath — pass-through", () => {
  it.each([
    "/factsheet/44444444-4444-4444-8444-444444444444/v2",
    "/scenario-share/abcdef",
    "https://quantalyze.xyz/browse?sort=sharpe",
    "/factsheet-share", // the prefix with NO segment is not a token
    "",
  ])("leaves %j byte-identical", (input) => {
    expect(scrubSharePath(input)).toBe(input);
  });
});

describe("scrubSharePath — the property that matters", () => {
  it.each([
    `/factsheet-share/${TOKEN}`,
    `/factsheet-share/${TOKEN}?x=1`,
    `/factsheet-share/${TOKEN}#f`,
    `https://quantalyze.xyz/factsheet-share/${TOKEN}`,
    `first /factsheet-share/${TOKEN} then /factsheet-share/${TOKEN_2}`,
  ])("no token survives in the output of %j", (input) => {
    const out = scrubSharePath(input);
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(TOKEN_2);
    // And the residue is not a truncated token either — nothing base64url-ish
    // of token width may remain anywhere in the string.
    expect(out).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });
});

import { describe, it, expect } from "vitest";
import { RouteResponseError } from "./route-response-error";

/**
 * [140.3-07 / B-27] The discrimination this class exists for.
 *
 * The whole B-27 fix rests on ONE predicate: `e instanceof RouteResponseError`.
 * If a plain `Error` — which is what `fetch` rejections, `res.json()` syntax
 * failures and undici transport errors arrive as — ever satisfied that
 * predicate, all three components would go straight back to rendering raw
 * caught messages while every acceptance grep still read 0.
 */
describe("[140.3-07 / B-27] RouteResponseError", () => {
  it("carries the route's message verbatim (the breaker sentence must survive)", () => {
    // Hand-typed literal, not imported from seam-copy: an oracle that reads the
    // module under test cannot fail when the module changes (lesson C-1).
    const copy =
      "The exchange connection is temporarily unavailable. Try again in a few minutes.";
    expect(new RouteResponseError(copy).message).toBe(copy);
  });

  it("is an Error, so existing `instanceof Error` handling still sees it", () => {
    expect(new RouteResponseError("x")).toBeInstanceOf(Error);
  });

  it("names itself, so a console breadcrumb says which class was thrown", () => {
    expect(new RouteResponseError("x").name).toBe("RouteResponseError");
  });

  it("does NOT admit a plain Error — this is the predicate the B-27 fix rests on", () => {
    expect(new Error("Failed to fetch")).not.toBeInstanceOf(RouteResponseError);
  });

  it("does NOT admit a TypeError — the shape a rejected fetch actually throws", () => {
    expect(new TypeError("NetworkError when attempting to fetch resource.")).not.toBeInstanceOf(
      RouteResponseError,
    );
  });

  it("does NOT admit a SyntaxError — the shape res.json() throws on an HTML error page", () => {
    expect(new SyntaxError("Unexpected token < in JSON at position 0")).not.toBeInstanceOf(
      RouteResponseError,
    );
  });
});

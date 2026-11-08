import { describe, it, expect } from "vitest";
import { COMPARE_MAX_ITEMS, compareHref } from "./compare-href";

describe("compareHref", () => {
  it("is the bare /compare path for no ids (the empty comparison)", () => {
    expect(compareHref([])).toBe("/compare");
  });

  it("joins ids in the order given, so the page shows them in that order", () => {
    expect(compareHref(["a", "b"])).toBe("/compare?ids=a,b");
  });

  it("percent-encodes each id so a stray & or # can never end the query or add a param", () => {
    expect(compareHref(["a&b", "c#d"])).toBe("/compare?ids=a%26b,c%23d");
  });

  it("never drops an id: the cap belongs to the caller, so a fifth id is visible to the test that guards it", () => {
    expect(compareHref(["1", "2", "3", "4", "5"])).toBe("/compare?ids=1,2,3,4,5");
  });

  it("holds the cap at four, the number every compare surface agrees on", () => {
    expect(COMPARE_MAX_ITEMS).toBe(4);
  });
});

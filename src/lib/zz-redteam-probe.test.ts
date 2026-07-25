import { describe, it, expect } from "vitest";
import { describeTransportError } from "./resilient-fetch";

describe("redteam probe perf", () => {
  it("large error string, dense 3-char secret", () => {
    const big = "abc".repeat(400_000); // 1.2MB, probe hits every 3 chars
    const t0 = performance.now();
    const out = describeTransportError(new Error(big), ["abc"]);
    const t1 = performance.now();
    console.log("dense 3-char ms:", (t1 - t0).toFixed(1), "outlen", out.length);

    const big2 = "x".repeat(1_200_000);
    const t2 = performance.now();
    describeTransportError(new Error(big2), ["abcdefghij", "qq1"]);
    const t3 = performance.now();
    console.log("no-hit ms:", (t3 - t2).toFixed(1));
    expect(true).toBe(true);
  });
});

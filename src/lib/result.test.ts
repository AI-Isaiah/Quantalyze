import { describe, it, expect } from "vitest";
import {
  ok,
  err,
  isOk,
  isErr,
  map,
  mapErr,
  unwrapOr,
  fromThrowing,
  fromSafeParse,
  type Result,
} from "./result";

describe("Result", () => {
  it("ok/err carry their payloads and discriminate on `ok`", () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
    expect(err("boom")).toEqual({ ok: false, error: "boom" });
  });

  it("isOk / isErr narrow the union", () => {
    const good: Result<number, string> = ok(1);
    const bad: Result<number, string> = err("x");
    expect(isOk(good)).toBe(true);
    expect(isErr(good)).toBe(false);
    expect(isOk(bad)).toBe(false);
    expect(isErr(bad)).toBe(true);
  });

  it("map transforms success only", () => {
    expect(map(ok(2), (n) => n * 3)).toEqual(ok(6));
    // failure passes through untouched — the mapper never runs
    const mapped = map(err<string>("e"), (n: number) => n * 3);
    expect(mapped).toEqual(err("e"));
  });

  it("mapErr transforms failure only", () => {
    expect(mapErr(err("e"), (s) => `${s}!`)).toEqual(err("e!"));
    expect(mapErr(ok(5), (s: string) => `${s}!`)).toEqual(ok(5));
  });

  it("unwrapOr reads value or falls back", () => {
    expect(unwrapOr(ok(7), 0)).toBe(7);
    expect(unwrapOr(err<string>("e"), 0)).toBe(0);
  });

  it("fromThrowing captures a throw as Err<Error> (containment)", () => {
    const good = fromThrowing(() => 10);
    expect(good).toEqual(ok(10));

    const bad = fromThrowing(() => {
      throw new TypeError("widget exploded");
    });
    expect(isErr(bad)).toBe(true);
    if (isErr(bad)) {
      expect(bad.error).toBeInstanceOf(Error);
      expect(bad.error.message).toBe("widget exploded");
    }
  });

  it("fromThrowing wraps non-Error throws into Error", () => {
    const bad = fromThrowing(() => {
      throw "string throw";
    });
    expect(isErr(bad)).toBe(true);
    if (isErr(bad)) {
      expect(bad.error).toBeInstanceOf(Error);
      expect(bad.error.message).toBe("string throw");
    }
  });

  it("fromSafeParse adapts a zod-style safeParse result", () => {
    expect(fromSafeParse({ success: true, data: { a: 1 } })).toEqual(
      ok({ a: 1 }),
    );
    const zodErr = { issues: [{ message: "bad" }] };
    expect(fromSafeParse({ success: false, error: zodErr })).toEqual(
      err(zodErr),
    );
  });
});

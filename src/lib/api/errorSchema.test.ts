import { describe, it, expect } from "vitest";
import { ErrorResponseSchema } from "./errorSchema";

describe("ErrorResponseSchema (F5 M-0967 / L-0060)", () => {
  it("accepts the canonical { error, retryAfter } envelope", () => {
    const parsed = ErrorResponseSchema.safeParse({ error: "Boom", retryAfter: 30 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.error).toBe("Boom");
      expect(parsed.data.retryAfter).toBe(30);
    }
  });

  it("accepts the upstream `detail` and platform `message` aliases", () => {
    // The Python analytics service raises HTTPException with `detail`; framework
    // errors surface `message`. The client's H-1127 cascade reads all three, so
    // the schema must tolerate them rather than rejecting and losing the real
    // backend explanation.
    expect(ErrorResponseSchema.safeParse({ detail: "Python said no" }).success).toBe(true);
    expect(ErrorResponseSchema.safeParse({ message: "Edge 502" }).success).toBe(true);
  });

  it("REJECTS a non-string `error` so it can never coerce to '[object Object]'", () => {
    // The core M-0967 defect: an `any`-typed body let `{ error: { nested } }`
    // stringify to "[object Object]" in user-facing copy. A failed parse forces
    // the caller back to static fallback copy instead.
    const parsed = ErrorResponseSchema.safeParse({ error: { nested: "obj" } });
    expect(parsed.success).toBe(false);
  });

  it("REJECTS a non-numeric retryAfter so the Retry countdown can't read a string", () => {
    expect(ErrorResponseSchema.safeParse({ error: "x", retryAfter: "30" }).success).toBe(false);
  });

  it("rejects a negative retryAfter", () => {
    expect(ErrorResponseSchema.safeParse({ error: "x", retryAfter: -1 }).success).toBe(false);
  });
});

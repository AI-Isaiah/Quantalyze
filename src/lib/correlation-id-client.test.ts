/**
 * 151 informational D5 — the shared client correlation-id helper.
 *
 * WHY THIS FILE EXISTS AT ALL. Three dialogs minted an id three different ways;
 * two of them called `crypto.randomUUID()` bare, INSIDE a `catch` block, on the
 * exact path whose job is to render an error envelope. On a runtime without
 * `crypto.randomUUID` — a non-secure origin, an older embedded webview — that
 * throw escapes the handler and the user gets no envelope at all: the failure
 * report is destroyed by the act of reporting it.
 *
 * So the property under test is NOT "returns a string". It is: THE HELPER NEVER
 * THROWS, whatever the platform hands it. The guard is tested by REMOVING the
 * capability, which is the only way to reach that branch on a machine where
 * `crypto.randomUUID` exists (Node 22 CI and Node 25 local both have it).
 *
 * ⚠️ `globalThis.crypto` is swapped through its own property DESCRIPTOR and
 * restored in a `finally`, never through `vi.stubGlobal` — a leaked global stub
 * is a documented source of CI-only (Node 22) failures in this repo.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { newCorrelationId } from "./correlation-id-client";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Run `fn` with `globalThis.crypto` replaced, restoring it unconditionally. */
function withCrypto(replacement: unknown, fn: () => void): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", {
    value: replacement,
    configurable: true,
    writable: true,
  });
  try {
    fn();
  } finally {
    if (original) {
      Object.defineProperty(globalThis, "crypto", original);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).crypto;
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("newCorrelationId — the guarded, per-failure id", () => {
  it("returns a real uuid when the platform provides one", () => {
    const id = newCorrelationId("allocation");
    expect(id).toMatch(UUID_V4);
    // The prefix is a FALLBACK label, not a decoration on the happy path — an
    // id that always carried it would not be the value the server logs as
    // `correlation_id` for the same request.
    expect(id.startsWith("allocation")).toBe(false);
  });

  it("mints a FRESH id per call — a stable id would name attempt 1 under attempt 2's failure", () => {
    const seen = new Set(
      Array.from({ length: 20 }, () => newCorrelationId("allocation")),
    );
    expect(seen.size).toBe(20);
  });

  it("FALLS BACK instead of throwing when crypto exists but randomUUID does not", () => {
    // The guard's whole reason for existing: this is the shape a non-secure
    // origin hands you — a `crypto` object with `subtle`/`randomUUID` missing.
    withCrypto({}, () => {
      let id = "";
      expect(() => {
        id = newCorrelationId("rename");
      }).not.toThrow();
      expect(id.startsWith("rename-")).toBe(true);
      // Still joinable: the tail is a real timestamp, not a constant.
      expect(id.slice("rename-".length)).toMatch(/^[0-9a-f]+$/);
    });
  });

  it("FALLS BACK instead of throwing when there is no crypto object at all", () => {
    // `globalThis.crypto` is read through optional chaining precisely so a
    // sandbox that never defined it cannot take the module down on first call.
    withCrypto(undefined, () => {
      let id = "";
      expect(() => {
        id = newCorrelationId("ownership");
      }).not.toThrow();
      expect(id.startsWith("ownership-")).toBe(true);
    });
  });

  it("REFUSES a non-callable randomUUID rather than invoking it", () => {
    // `typeof === "function"` and not a truthiness test: a polyfill stub that
    // left the key defined as a string would throw "is not a function" on the
    // error path, which is exactly the failure this helper exists to prevent.
    withCrypto({ randomUUID: "nope" }, () => {
      expect(newCorrelationId("allocation")).toMatch(/^allocation-/);
    });
  });

  it("names the surface in the fallback, so a support ticket still says where it came from", () => {
    withCrypto({}, () => {
      expect(newCorrelationId("allocation")).toMatch(/^allocation-/);
      expect(newCorrelationId("ownership")).toMatch(/^ownership-/);
      expect(newCorrelationId("rename")).toMatch(/^rename-/);
    });
  });
});

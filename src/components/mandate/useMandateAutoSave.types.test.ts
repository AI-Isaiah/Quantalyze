/**
 * Type-linkage regression tests — H-0379, H-0381, H-0383.
 *
 * WHY H-0379/H-0383: Before this fix, save(fieldName: string, value: unknown)
 * accepted any string key. A typo `save('max_weigh', 0.25)` compiled silently,
 * sent a PUT, and only failed at the server-side whitelist check — no TS error.
 * After fix, MandateField narrows the first argument to the SELF_EDITABLE set;
 * `save('max_weigh', 0.25)` is now a compile-time error.
 *
 * WHY H-0381: Before this fix, fieldErrors was Record<string,string> so
 * `fieldErrors.max_weigh` compiled even though the key never exists. After
 * narrowing to Partial<Record<MandateField,string>>, only known field keys are
 * reachable; consumers that mistype the key get a compile error.
 *
 * WHY savingFields (H-0381 corollary): same narrowing from Set<string> to
 * Set<MandateField> so `savingFields.has('nonexistent')` is a compile error.
 *
 * Runtime tests confirm the hook populates only MandateField keys at runtime.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { SELF_EDITABLE_PREFERENCE_FIELDS } from "@/lib/preferences";
import { useMandateAutoSave } from "./useMandateAutoSave";
import type { MandateField } from "./useMandateAutoSave";

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ success: true }),
  } as unknown as Response;
}

function errorResponse400(errMsg: string): Response {
  return {
    ok: false,
    status: 400,
    headers: new Headers(),
    json: async () => ({ error: errMsg }),
  } as unknown as Response;
}

describe("H-0379/H-0381/H-0383 — MandateField type linkage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("MandateField union covers every key in SELF_EDITABLE_PREFERENCE_FIELDS", () => {
    // MandateField is derived as (typeof SELF_EDITABLE_PREFERENCE_FIELDS)[number].
    // If a field is promoted to SELF_EDITABLE but not to MandateField (or vice
    // versa), TypeScript raises an error at the import below; this runtime check
    // confirms the tuple length hasn't silently shrunk.
    const fields: readonly MandateField[] = SELF_EDITABLE_PREFERENCE_FIELDS;
    expect(fields.length).toBeGreaterThan(0);
    expect(fields).toContain("max_weight");
    expect(fields).toContain("mandate_archetype");
    expect(fields).toContain("preferred_strategy_types");
    expect(fields).toContain("correlation_ceiling");
    expect(fields).toContain("style_exclusions");
  });

  it("fieldErrors after 400 is keyed only by MandateField values", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      errorResponse400("max_weight must be between 0.05 and 0.50"),
    );
    const { result } = renderHook(() => useMandateAutoSave(null));

    await act(async () => {
      await result.current.save("max_weight", 0.99);
    });

    // The typed key read compiles only because max_weight ∈ MandateField.
    const key: MandateField = "max_weight";
    expect(result.current.fieldErrors[key]).toMatch(/max_weight/);

    // Runtime invariant: every key in fieldErrors must be a SELF_EDITABLE field.
    for (const k of Object.keys(result.current.fieldErrors)) {
      expect(SELF_EDITABLE_PREFERENCE_FIELDS as readonly string[]).toContain(k);
    }
  });

  it("savingFields contains only MandateField values during an in-flight save", async () => {
    let resolveFetch: (r: Response) => void = () => {};
    (fetch as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise<Response>((r) => { resolveFetch = r; }),
    );
    const { result } = renderHook(() => useMandateAutoSave(null));

    await act(async () => {
      void result.current.save("max_weight", 0.25);
    });

    // Mid-save: savingFields must contain the typed key.
    const field: MandateField = "max_weight";
    expect(result.current.savingFields.has(field)).toBe(true);

    // Runtime invariant: every entry in savingFields must be a SELF_EDITABLE key.
    for (const k of result.current.savingFields) {
      expect(SELF_EDITABLE_PREFERENCE_FIELDS as readonly string[]).toContain(k);
    }

    // Clean up — resolve the pending fetch.
    await act(async () => {
      resolveFetch(okResponse());
      await vi.runAllTimersAsync();
    });
  });

  it("clearError typed to MandateField removes only the named key", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      errorResponse400("max_weight out of range"),
    );
    const { result } = renderHook(() => useMandateAutoSave(null));

    await act(async () => {
      await result.current.save("max_weight", 0.99);
    });
    expect(result.current.fieldErrors.max_weight).toBeDefined();

    act(() => {
      result.current.clearError("max_weight");
    });
    expect(result.current.fieldErrors.max_weight).toBeUndefined();
  });
});

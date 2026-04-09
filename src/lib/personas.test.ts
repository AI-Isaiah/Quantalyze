import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERSONA,
  PERSONAS,
  getPersona,
  isPersonaAllocatorId,
  personaKeyForAllocatorId,
} from "./personas";

describe("getPersona", () => {
  it("returns the active persona for the default key", () => {
    const result = getPersona("active");
    expect(result.key).toBe("active");
    expect(result.allocatorId).toBe(PERSONAS.active);
  });

  it("returns the cold persona", () => {
    const result = getPersona("cold");
    expect(result.key).toBe("cold");
    expect(result.allocatorId).toBe(PERSONAS.cold);
  });

  it("returns the stalled persona", () => {
    const result = getPersona("stalled");
    expect(result.key).toBe("stalled");
    expect(result.allocatorId).toBe(PERSONAS.stalled);
  });

  it("falls back to default when the param is undefined", () => {
    expect(getPersona(undefined).key).toBe(DEFAULT_PERSONA);
    expect(getPersona(null).key).toBe(DEFAULT_PERSONA);
  });

  it("falls back to default when the param is an unknown string", () => {
    expect(getPersona("rogue").key).toBe(DEFAULT_PERSONA);
    expect(getPersona("").key).toBe(DEFAULT_PERSONA);
  });

  it("does not allow prototype pollution via __proto__", () => {
    const result = getPersona("__proto__");
    expect(result.key).toBe(DEFAULT_PERSONA);
    expect(result.allocatorId).toBe(PERSONAS.active);
  });

  it("does not allow constructor as a key", () => {
    expect(getPersona("constructor").key).toBe(DEFAULT_PERSONA);
    expect(getPersona("toString").key).toBe(DEFAULT_PERSONA);
  });

  it("ignores hostile script-shaped input", () => {
    expect(getPersona("<script>alert(1)</script>").key).toBe(DEFAULT_PERSONA);
  });

  it("uses the first element when given an array", () => {
    expect(getPersona(["cold", "active"]).key).toBe("cold");
  });

  it("falls back when the array is empty", () => {
    expect(getPersona([]).key).toBe(DEFAULT_PERSONA);
  });
});

describe("isPersonaAllocatorId", () => {
  it("returns true for known allocator UUIDs", () => {
    expect(isPersonaAllocatorId(PERSONAS.active)).toBe(true);
    expect(isPersonaAllocatorId(PERSONAS.cold)).toBe(true);
    expect(isPersonaAllocatorId(PERSONAS.stalled)).toBe(true);
  });

  it("returns false for arbitrary IDs", () => {
    expect(isPersonaAllocatorId("aaaaaaaa-0000-0000-0000-000000000000")).toBe(
      false,
    );
    expect(isPersonaAllocatorId("")).toBe(false);
    expect(isPersonaAllocatorId("not-a-uuid")).toBe(false);
  });
});

describe("personaKeyForAllocatorId", () => {
  it("returns the persona key for a known allocator", () => {
    expect(personaKeyForAllocatorId(PERSONAS.active)).toBe("active");
    expect(personaKeyForAllocatorId(PERSONAS.cold)).toBe("cold");
    expect(personaKeyForAllocatorId(PERSONAS.stalled)).toBe("stalled");
  });

  it("returns null for an unknown allocator", () => {
    expect(personaKeyForAllocatorId("rogue")).toBeNull();
  });
});

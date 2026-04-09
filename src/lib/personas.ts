/**
 * Demo personas — server-side enum lookup for the public /demo route.
 *
 * The /demo page accepts a `?persona=` query param. Allocator IDs MUST come
 * from this allowlist; never index a `Record` with raw user input. The
 * `getPersona` helper enforces the contract: any non-allowlist value, any
 * prototype-pollution attempt, any hostile string falls back silently to
 * the default ACTIVE persona.
 *
 * If you add a persona, you MUST:
 *   1. add it here AND
 *   2. seed a portfolio for it via `scripts/seed-demo-data.ts` AND
 *   3. add the new portfolio_id to the allowlist in
 *      `src/app/api/demo/portfolio-pdf/[id]/route.ts`.
 */

/**
 * Hard-coded persona allocator UUIDs. Must stay in sync with
 * `scripts/seed-demo-data.ts`.
 */
export const PERSONAS = {
  active: "aaaaaaaa-0001-4000-8000-000000000002",
  cold: "aaaaaaaa-0001-4000-8000-000000000001",
  stalled: "aaaaaaaa-0001-4000-8000-000000000003",
} as const;

export type PersonaKey = keyof typeof PERSONAS;

export const DEFAULT_PERSONA: PersonaKey = "active";

const VALID_KEYS = Object.keys(PERSONAS) as PersonaKey[];

/**
 * Resolve a query param value to a persona allocator UUID.
 *
 * Accepts `string | string[] | undefined | null` because that's what
 * Next.js's `searchParams` hands to a server component. Always returns a
 * valid UUID — never throws, never reflects the input.
 */
export function getPersona(
  rawParam: string | string[] | undefined | null,
): { key: PersonaKey; allocatorId: string } {
  const candidate = Array.isArray(rawParam) ? rawParam[0] : rawParam;
  if (typeof candidate === "string" && (VALID_KEYS as string[]).includes(candidate)) {
    const key = candidate as PersonaKey;
    return { key, allocatorId: PERSONAS[key] };
  }
  return { key: DEFAULT_PERSONA, allocatorId: PERSONAS[DEFAULT_PERSONA] };
}

/**
 * Type guard: is this string a valid persona key? Used by the PDF endpoint
 * allowlist check.
 */
export function isPersonaAllocatorId(id: string): boolean {
  return Object.values(PERSONAS).includes(id as (typeof PERSONAS)[PersonaKey]);
}

/**
 * Get the persona key for a given allocator ID, or null if it's not a
 * persona.
 */
export function personaKeyForAllocatorId(id: string): PersonaKey | null {
  for (const key of VALID_KEYS) {
    if (PERSONAS[key] === id) return key;
  }
  return null;
}

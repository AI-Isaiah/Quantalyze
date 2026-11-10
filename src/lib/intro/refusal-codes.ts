/**
 * Phase 194.2 D-03 — the named refusal codes `POST /api/intro` answers with when
 * the caller has not recorded the accredited-investor attestation.
 *
 * Client-safe on purpose (no `server-only`): the route sends them and the two
 * intro entry points (`ReplacementCard`, `RequestIntroButton`) branch on them,
 * so one exported constant turns a rename into a type error instead of a
 * silent UI break.
 */

/** 403: an approved allocator with no `investor_attestations` row (or a null `attested_at`). */
export const INTRO_ATTESTATION_REQUIRED = "attestation_required" as const;

/** 500: the attestation read itself failed; the route fails closed. */
export const INTRO_ATTESTATION_CHECK_FAILED = "attestation_check_failed" as const;

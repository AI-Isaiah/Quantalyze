/**
 * Phase 140.3 / SEAMUX-01 — the ONE source of truth for the seam breaker's
 * user-facing copy.
 *
 * ⚠️ LOAD-BEARING LEAF. **Zero imports, zero env reads, zero module-load side
 * effects.** `src/lib/seam-copy.purity.test.ts` enforces that, and the purity is
 * load-bearing for the same two reasons `src/lib/seam-discriminator.ts` and
 * `src/lib/seam-errors.ts` carry:
 *
 *  1. BUNDLE BOUNDARY. `src/lib/process-key-client.ts` reads this constant, and
 *     the unauthenticated teaser path renders the string directly. A dependency
 *     added here therefore reaches the BROWSER bundle for every anonymous
 *     visitor — and anything seam-adjacent drags `@upstash/redis`,
 *     `@upstash/ratelimit` and a `Redis.fromEnv()` module-load side effect in
 *     with it. The obvious "tidy-up" is exactly the wrong one: importing
 *     `NO_STORE_HEADERS`, a wizard code union, or the envelope builder to keep
 *     the copy "next to" its emitters would do all of that in one line.
 *  2. MOCK SURVIVAL. Sixteen route test files replace the seam clients
 *     wholesale, most with a full factory and no `importActual`. A value reached
 *     THROUGH such a module evaluates to `undefined`, and the ten sites below
 *     read this constant from INSIDE a catch block — so an `undefined` body
 *     would convert a clean 503 into a crash. Nothing mocks this leaf, and that
 *     property survives only while it imports nothing worth mocking.
 *
 * ⚠️ THE COPY IS STATIC BY DESIGN (threats T-140-05 / T-140-08 / T-140-17).
 * A breaker trip is an infrastructure fact. The sentence carries no upstream
 * URL, no status, no cooldown vocabulary and no error detail — the diagnosable
 * half goes to the server log with the route tag and correlation id, and the
 * only dynamic value a breaker arm may publish is the `Retry-After` header. Do
 * not make this a function, a template, or a per-route variant. On
 * `keys/validate-and-encrypt` in particular it must keep NOT blaming the user's
 * key for an outage in which no request was ever issued.
 *
 * WHY IT EXISTS. Ten production files declared this sentence independently and
 * **none of them exported it**, so nothing pinned any copy to any other: one
 * route could be reworded, its own test updated alongside, and the suite stayed
 * green while that route now differed from the other nine.
 * `src/lib/seam-copy.pin.test.ts` closes that production↔production gap.
 *
 * ⚠️ WHAT THIS DOES **NOT** DO, AND MUST NOT. The twelve route test files that
 * re-declare this sentence as a hand-typed literal are NOT defects and must not
 * be pointed at this module. Nothing was exported before, so those literals
 * cannot have been reads of the module under test — they are correct oracle
 * independence, and `src/app/api/keys/sync/route.seam.test.ts` says so in a
 * comment ("Duplicated deliberately: a test that imported the constant from the
 * client could not detect it changing"). Consolidating them here would convert
 * twelve independent oracles into one self-referential oracle — TRAP-9, which is
 * binding. Leave them alone.
 *
 * OUT OF SCOPE, stated so it is not smuggled in later: the ten emitters wrap
 * this string in five different envelope shapes and only two of them carry a
 * `code`. That is envelope fragmentation (requirement SEAMUX-03) and it belongs
 * to a later plan. This module changes WHERE the string comes from, never what
 * wraps it, and never the bytes themselves.
 */

/**
 * The static body every seam breaker arm emits.
 *
 * Nine routes bind it as `CIRCUIT_OPEN_COPY`; `src/lib/process-key-client.ts`
 * binds it as `CIRCUIT_OPEN_HUMAN_MESSAGE` (its `human_message` envelope field).
 * Both are import aliases of THIS declaration — there is no second declaration
 * anywhere in `src/`, and `seam-copy.pin.test.ts` asserts that repo-wide.
 */
export const CIRCUIT_OPEN_COPY =
  "The analytics service is temporarily unavailable. Please try again in a moment.";

import { describe, it, expect } from "vitest";
import { assertLiveDbWasIntended } from "@/test-setup";

/**
 * [164.8.4-04 / 164.8.2-EVIDENCE-DOTENV-LEAK] — the credential-inheritance
 * guard in `src/test-setup.ts` is independently falsifiable on both
 * polarities, following the two-test canary shape in
 * `src/test-setup.leak-canary.test.ts`.
 *
 * WHAT THE LEAK WAS: a bun-shebang tool wrapper auto-loads `.env.local` into
 * a child `vitest` process, silently setting NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY. That flips `HAS_LIVE_DB` true by accident and
 * turns sixteen `it.skipIf(!HAS_LIVE_DB)` suites into real writes against
 * shared TEST. `assertLiveDbWasIntended()` is the guard: given the
 * credential-present boolean and an environment object, it throws unless an
 * explicit intentional-invocation sentinel (`VITEST_LIVE_DB_INTENDED=1`) is
 * also present.
 *
 * Each leg below is independently falsifiable — the reddening mutation for
 * each is recorded next to the leg so the file states its own falsifiers
 * rather than asserting them abstractly (the canary's own ledger-row
 * convention):
 *
 *   - Leg 1 (credentials + no sentinel -> throws): reddens if the `&&` in
 *     `assertLiveDbWasIntended`'s condition were changed to `||`, or if the
 *     sentinel comparison were dropped entirely (the guard would never
 *     throw).
 *   - Leg 2 (credentials + sentinel -> no throw): reddens if the sentinel
 *     value comparison were removed (the guard would always throw once
 *     credentials are present, breaking every intentional live-DB run).
 *   - Leg 3 (partial environment -> no throw): reddens if the guard's
 *     `hasLiveDb` parameter were ignored and it inspected the environment's
 *     two raw variable names directly instead (it would then throw on a
 *     partial environment too, which is not the hazard this guard exists
 *     to catch).
 *   - Leg 4 (thrown message carries no credential value): reddens if the
 *     remedy message were built by interpolating `env.NEXT_PUBLIC_SUPABASE_
 *     URL` / `env.SUPABASE_SERVICE_ROLE_KEY` into the string instead of
 *     naming the keys only — exactly the "a guard that quotes what it found
 *     is a proof-of-absence that publishes what it proves absent" failure
 *     this repo has already recorded once.
 *
 * ⛔ Synthetic placeholder values only, assembled at runtime — never a real
 * project ref, URL, or key, not even truncated.
 */

const SYNTHETIC_URL = ["https://", "example-project-ref", ".supabase.co"].join("");
const SYNTHETIC_SERVICE_ROLE_KEY = ["synthetic", "-", "service", "-", "role", "-", "key"].join("");

describe("[164.8.4-04 / 164.8.2-EVIDENCE-DOTENV-LEAK] the live-DB credential-inheritance guard", () => {
  it("Leg 1 — credentials present, sentinel absent: throws, naming both variables", () => {
    expect(() =>
      assertLiveDbWasIntended(true, {
        NEXT_PUBLIC_SUPABASE_URL: SYNTHETIC_URL,
        SUPABASE_SERVICE_ROLE_KEY: SYNTHETIC_SERVICE_ROLE_KEY,
      }),
    ).toThrowError(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() =>
      assertLiveDbWasIntended(true, {
        NEXT_PUBLIC_SUPABASE_URL: SYNTHETIC_URL,
        SUPABASE_SERVICE_ROLE_KEY: SYNTHETIC_SERVICE_ROLE_KEY,
      }),
    ).toThrowError(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("Leg 2 — credentials present, sentinel set to the declared value: does not throw", () => {
    expect(() =>
      assertLiveDbWasIntended(true, {
        NEXT_PUBLIC_SUPABASE_URL: SYNTHETIC_URL,
        SUPABASE_SERVICE_ROLE_KEY: SYNTHETIC_SERVICE_ROLE_KEY,
        VITEST_LIVE_DB_INTENDED: "1",
      }),
    ).not.toThrow();
  });

  it("Leg 3 — a partial environment (credential-present boolean false) does not throw", () => {
    // hasLiveDb=false models the ordinary case: at most one of the two
    // underlying variables is set, so HAS_LIVE_DB (computed upstream in
    // live-db.ts) is false. A partial environment is not the hazard this
    // guard exists to catch.
    expect(() =>
      assertLiveDbWasIntended(false, {
        NEXT_PUBLIC_SUPABASE_URL: SYNTHETIC_URL,
      }),
    ).not.toThrow();
  });

  it("Leg 4 — the thrown message carries neither credential value, only the key names", () => {
    let thrown: Error | undefined;
    try {
      assertLiveDbWasIntended(true, {
        NEXT_PUBLIC_SUPABASE_URL: SYNTHETIC_URL,
        SUPABASE_SERVICE_ROLE_KEY: SYNTHETIC_SERVICE_ROLE_KEY,
      });
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown, "Leg 1's throw did not fire — Leg 4 has nothing to inspect").toBeInstanceOf(Error);
    expect(
      thrown!.message,
      "the thrown message quotes the synthetic URL value — a guard that prints a credential to prove a credential leaked is this phase's own worst failure mode",
    ).not.toContain(SYNTHETIC_URL);
    expect(
      thrown!.message,
      "the thrown message quotes the synthetic service-role-key value",
    ).not.toContain(SYNTHETIC_SERVICE_ROLE_KEY);
    // Positive control: the message DOES name both keys, so a message that
    // withholds everything (including the names) would not pass this test
    // vacuously.
    expect(thrown!.message).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(thrown!.message).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});

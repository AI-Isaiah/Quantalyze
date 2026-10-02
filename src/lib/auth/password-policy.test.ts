import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { MIN_PASSWORD_LENGTH } from "./password-policy";

/**
 * SEC-01 — the client password floor is ONE constant, and it equals the
 * MEASURED hosted policy.
 *
 * Two independent failures are pinned here, because the drift this guards
 * against has two shapes:
 *
 *   1. VALUE drift — the constant stops matching the reading recorded in
 *      password-policy.ts's docblock. The number below is written out as a
 *      literal on purpose: it is the reading (6, measured 2026-08-26 off the
 *      live signup endpoint's own `weak_password` rejection), not a re-export
 *      of the thing under test. `expect(MIN_PASSWORD_LENGTH).toBe(MIN_PASSWORD_LENGTH)`
 *      would be vacuous; this is not.
 *
 *   2. SITE drift — a form re-hardcodes a numeric `minLength={6}` instead of
 *      consuming the constant, which is exactly the state SEC-01 found (two
 *      independent constants, no shared source). A rendered-value assertion
 *      alone CANNOT catch this: a hardcoded 6 renders identically to the
 *      constant's 6. Only reading the sources can, so that is what the second
 *      describe does.
 *
 * ⚠️ The floor itself is UX only — enforcement is Supabase-side (there is no
 * server hop between the browser and hosted GoTrue). These tests pin the
 * repo's half of the contract: that the client copy cannot silently drift
 * away from the documented hosted policy.
 */

// __dirname is src/lib/auth at test time.
const AUTH_COMPONENTS_DIR = path.resolve(__dirname, "../../components/auth");

const CONSUMING_FORMS = ["SignupForm.tsx", "ResetPasswordForm.tsx"] as const;

function readForm(file: string): string {
  return fs.readFileSync(path.join(AUTH_COMPONENTS_DIR, file), "utf8");
}

describe("MIN_PASSWORD_LENGTH matches the measured hosted policy", () => {
  it("is 6 — the minimum the hosted signup endpoint reported on 2026-08-26", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(6);
  });

  it("is at least 6 — a lower client floor would advertise passwords the hosted policy rejects", () => {
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(6);
  });
});

describe("both auth forms consume the shared constant (no re-hardcoded literal)", () => {
  it.each(CONSUMING_FORMS)("%s imports MIN_PASSWORD_LENGTH from the policy module", (file) => {
    const src = readForm(file);
    expect(src).toMatch(
      /import\s*\{[^}]*\bMIN_PASSWORD_LENGTH\b[^}]*\}\s*from\s*["']@\/lib\/auth\/password-policy["']/,
    );
  });

  it.each(CONSUMING_FORMS)("%s declares no local MIN_PASSWORD_LENGTH", (file) => {
    const src = readForm(file);
    expect(src).not.toMatch(/^\s*const\s+MIN_PASSWORD_LENGTH\s*=/m);
  });

  it.each(CONSUMING_FORMS)("%s passes no numeric minLength literal", (file) => {
    const src = readForm(file);
    // `minLength={6}` / `minLength="6"` / `minLength={ 6 }` — any bare number.
    const hardcoded = src.match(/minLength\s*=\s*(?:\{\s*\d+\s*\}|["']\d+["'])/g);
    expect(hardcoded).toBeNull();
  });

  it.each(CONSUMING_FORMS)("%s still applies a minLength to its password input(s)", (file) => {
    const src = readForm(file);
    // Guards the previous assertion from passing vacuously by DELETING the
    // floor rather than sharing it.
    expect(src).toMatch(/minLength=\{MIN_PASSWORD_LENGTH\}/);
  });
});

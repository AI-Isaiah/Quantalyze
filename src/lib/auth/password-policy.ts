/**
 * The ONE client-side password floor (SEC-01, Phase 163).
 *
 * ⚠️ The client floor is UX only — enforcement is Supabase-side. Signup goes
 * browser → Supabase Auth directly (`supabase.auth.signUp`); there is NO
 * Next.js server hop in between, so nothing in this repo can enforce a
 * password policy. `minLength` on an input is an HTML affordance a user can
 * bypass with devtools, and the reset flow's length check is a friendlier
 * message, not a gate. The real decision is made by hosted GoTrue.
 *
 * WHERE THE REAL POLICY LIVES: the hosted project's Supabase Auth
 * configuration (dashboard-owned). It has NO representation in this repo and
 * can be changed outside git at any time.
 *
 * ⛔ `supabase/config.toml` (`minimum_password_length`,
 * `password_requirements`) governs ONLY the LOCAL dev stack. Do not cite it
 * as the hosted policy — that mis-citation is what SEC-01 exists to retire.
 *
 * THE READING (point-in-time measurement, 2026-08-26 — NOT an invariant):
 *   - minimum length = 6
 *   - no character-class requirement
 *
 * METHOD: no management-API lane is available to an agent on this machine and
 * the Supabase MCP exposes no auth-config reader, so the policy was measured
 * directly against the live signup endpoint with a deliberately-failing
 * 1-character password (rejected at validation, so no account is created).
 * The server answered `422 weak_password` — "Password should be at least 6
 * characters." — with `weak_password.reasons = ["length"]`. Both facts are
 * measurements, not assumptions: the number is the server's own, and a
 * 1-character lowercase password violates length AND every character class at
 * once, so a configured character policy would have added `"characters"` to
 * that list. It returned `["length"]` alone.
 *
 * ⇒ This constant EQUALS the hosted minimum — the client floor is backed, not
 * merely compatible. If the dashboard setting is ever raised, this number and
 * the reading date above move with it; the copy in both forms is derived from
 * the constant so it cannot drift independently.
 *
 * Consumed by `SignupForm` and `ResetPasswordForm`. A hardcoded numeric
 * `minLength` literal in either form is a regression — `password-policy.test.ts`
 * scans both sources for exactly that.
 */
export const MIN_PASSWORD_LENGTH = 6;

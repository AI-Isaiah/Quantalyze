"use client";

import { useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { UI_EXCHANGE_CODES } from "@/lib/utils";
import { EXCHANGE_DISPLAY } from "@/lib/closed-sets";

interface VerificationFormProps {
  onResult: (result: { public_token: string; verification_id: string }) => void;
}

// OQ4 gate: the public verify dropdown offers the user-facing UI_EXCHANGE_CODES
// set (Phase 69 flipped it to include deribit alongside its scope guide), NOT
// the widened key-save allowlist. Labels come from the single-source
// EXCHANGE_DISPLAY map — no local label record — so a new code cannot render a
// blank/undefined option (Gap 1 drift fix).
const EXCHANGE_OPTIONS = UI_EXCHANGE_CODES.map((value) => ({
  value,
  label: EXCHANGE_DISPLAY[value],
}));

/**
 * Phase 140.3-12 / TS-17 — shapes an upstream `human_message` may NOT have
 * before this form renders it to an ANONYMOUS visitor (threat T-140-08).
 *
 * ⚠️ WHY A GUARD AT ALL, when the seam's other copy is static. Verified at
 * source rather than assumed: `process-key-client.ts` forwards a non-2xx
 * upstream body VERBATIM (`NextResponse.json(body, {status: res.status})`), and
 * on the 403 arm Python fills `human_message` from `val.human_message` with no
 * sanitiser in `_envelope_error`. That field is NOT a closed curated set —
 * `services/ingestion/okx.py` passes `result.get("error")` (raw exchange text)
 * and `csv_adapter.py` passes `str(exc)`. So the string CAN carry an exception
 * body, and it reaches an unauthenticated browser.
 *
 * The guard is a SHAPE denylist, never an allow-list of known sentences: an
 * allow-list's failure mode is that a real, correct rejection renders as the
 * generic "Verification failed", which is the exact defect TS-17 exists to fix.
 */
const DISCLOSURE_SHAPES: readonly RegExp[] = [
  /https?:\/\//i, // an upstream URL
  /:\/\//, // any other scheme
  /\b[a-z0-9-]+\.(com|net|io|app|dev|internal|local|xyz)\b/i, // a hostname
  /\blocalhost\b/i,
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, // an IP
  /\b[1-5]\d{2}\b/, // a bare HTTP status
  /traceback|file "|line \d+|exception|stack/i, // a Python fault body
];

/** Longest message we will render. An exception body is not a sentence. */
const MAX_HUMAN_MESSAGE_LENGTH = 200;

/**
 * Returns the upstream sentence when it is safe to show an anonymous visitor,
 * otherwise `null` so the caller falls through to its own copy.
 */
export function safeHumanMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_HUMAN_MESSAGE_LENGTH) return null;
  if (DISCLOSURE_SHAPES.some((shape) => shape.test(trimmed))) return null;
  return trimmed;
}

export function VerificationForm({ onResult }: VerificationFormProps) {
  const [exchange, setExchange] = useState<string>(UI_EXCHANGE_CODES[0]);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/verify-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          exchange,
          api_key: apiKey,
          api_secret: apiSecret,
          ...(exchange === "okx" && passphrase ? { passphrase } : {}),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        // TS-17 — READ `human_message` FIRST. The seam's rejection envelope is
        // `{ok:false, code, human_message, correlation_id, recoverable}` and
        // carries NO `error` key at all, so `data.error ??` always fell through
        // and every rejection — including the write-capable-key verdict, which
        // has a specific and actionable explanation — rendered the generic
        // "Verification failed". `data.error` is kept as the second reader
        // because this route's OWN 4xx/502 arms (invalid JSON, bad email, the
        // shape guard below's server-side twin) do emit `{error}`.
        throw new Error(
          safeHumanMessage(data.human_message) ??
            safeHumanMessage(data.error) ??
            "Verification failed",
        );
      }

      // ⚠️ 140.3-12 — VERDICT ON THIS GUARD: KEPT, and the plan's premise for
      // deleting it is FALSE. It was described as the orphaned client mirror of
      // a 502 that `140.3-02` deleted server-side. Read at source: `140.3-02`
      // did NOT delete it. `src/app/api/verify-strategy/route.ts` still answers
      // 502 `{error:"Verification service returned an invalid response"}`, and
      // its docblock records that keeping it was a deliberate FINDING against
      // TS-12 — the REJECTION trigger is dead, the DRIFT trigger is not.
      //
      // The same split applies here, one hop later. Reachability, traced rather
      // than assumed: the route has exactly one 2xx exit, and it always sets
      // both fields (both are non-null by the guard immediately above it). So
      // no response THIS route can produce reaches this throw — its rejection
      // trigger is dead too. Its drift trigger is not: if that allow-listed
      // response body loses a field, the alternative is calling `onResult` with
      // `undefined`, which mints a teaser link for a verification that does not
      // exist. That is the same "silent success on failure" the server-side
      // twin exists to stop, so the client keeps its half.
      if (!data.verification_id || !data.public_token) {
        throw new Error("Verification service returned an invalid response");
      }

      onResult({
        public_token: data.public_token,
        verification_id: data.verification_id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto max-w-lg rounded-xl border border-border bg-white p-6 shadow-card"
    >
      <div className="space-y-4">
        <Select
          label="Exchange"
          options={EXCHANGE_OPTIONS}
          value={exchange}
          onChange={(e) => setExchange(e.target.value)}
        />

        <Input
          label="API Key"
          placeholder="Your read-only API key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          required
        />

        <Input
          label="API Secret"
          type="password"
          placeholder="Your API secret"
          value={apiSecret}
          onChange={(e) => setApiSecret(e.target.value)}
          required
        />

        {exchange === "okx" && (
          <Input
            label="Passphrase"
            type="password"
            placeholder="OKX API passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            required
          />
        )}

        <Input
          label="Email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">
          {error}
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        className="mt-6 w-full"
        disabled={submitting}
      >
        {submitting ? "Verifying..." : "Verify My Strategy"}
      </Button>

      <p className="mt-3 text-center text-xs text-text-muted">
        We only use read-only API access. Your keys are never stored.
      </p>
    </form>
  );
}

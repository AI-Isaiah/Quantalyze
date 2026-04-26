"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Phase 11 / S6 / D-05 — Authenticated audit-log download subsection on
 * `/profile?tab=security`.
 *
 * Calls GET /api/me/audit-log/export (Plan 11-02 route handler) which
 * returns text/csv with `Content-Disposition: attachment; filename=…`.
 * The browser-download trigger is implemented client-side via a
 * Blob URL + transient `<a download>` element so we can present an
 * inline error UI on 4xx/5xx without losing the click context — a plain
 * anchor href would surface 401/500 as a navigation error, which is
 * worse UX than the S3-style inline retry.
 *
 * UI-SPEC §S6 LOCKED contract:
 *   - Heading verbatim "Audit log"
 *   - Description verbatim
 *   - Primary CTA verbatim "Download CSV (last 90 days)" with
 *     aria-label "Download audit log CSV for the last 90 days"
 *   - Caption verbatim
 *   - On 4xx/5xx: S3 error shape (inline alert + Retry click that
 *     re-triggers the same fetch)
 *
 * Loading copy is at planner discretion (UI-SPEC §S6) — using
 * "Preparing…" matches the existing project button-loading idiom.
 */
export function AuditLogSubsection() {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch("/api/me/audit-log/export", {
        method: "GET",
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error(`Download failed (${res.status})`);
      }
      const blob = await res.blob();
      // Extract filename from Content-Disposition; fall back to a
      // sensible default mirroring the route's filename shape.
      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = cd.match(/filename="?([^";]+)"?/);
      const filename =
        m?.[1] ??
        `quantalyze-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError("Could not download audit log. Please try again.");
      console.warn("[AuditLogSubsection] download failed:", err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section aria-labelledby="audit-log-heading" className="mt-8">
      <h2
        id="audit-log-heading"
        className="mb-2 text-lg font-semibold text-text-primary"
      >
        Audit log
      </h2>
      <p className="mb-4 max-w-2xl text-sm leading-relaxed text-text-secondary">
        Every read, write, and outcome on your account is logged. Download a
        CSV of the last 90 days for your records or compliance review.
      </p>
      <Button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        aria-label="Download audit log CSV for the last 90 days"
      >
        {downloading ? "Preparing…" : "Download CSV (last 90 days)"}
      </Button>
      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="mt-3 rounded-md border border-negative/30 bg-negative/5 p-3"
        >
          <p className="mb-1 text-sm text-text-primary">{error}</p>
          <button
            type="button"
            onClick={handleDownload}
            className="text-sm text-accent underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-accent/50"
          >
            Retry
          </button>
        </div>
      )}
      <p className="mt-3 text-xs text-text-muted">
        Includes: timestamp, action, entity type, entity reference. ~5–50 KB
        depending on activity.
      </p>
    </section>
  );
}

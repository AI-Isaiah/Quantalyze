"use client";

import { useEffect } from "react";

/**
 * Root-level error boundary. Catches errors in the root layout itself.
 * Must render its own <html> and <body> tags since the root layout is
 * replaced when this component is active.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
    // TODO: wire Sentry.captureException(error) once observability is set up
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          backgroundColor: "#0a0a0f",
          color: "#e0e0e6",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ maxWidth: 420, padding: "0 16px", textAlign: "center" }}>
          <p
            style={{
              fontSize: 48,
              fontWeight: 700,
              color: "#6366f1",
              margin: 0,
            }}
          >
            500
          </p>
          <h1 style={{ fontSize: 24, marginTop: 16 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#9ca3af", marginTop: 8 }}>
            An unexpected error occurred. Please try again.
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: 12,
                color: "#6b7280",
                marginTop: 4,
                fontFamily: "monospace",
              }}
            >
              Error ID: {error.digest}
            </p>
          )}
          <button
            onClick={() => unstable_retry()}
            style={{
              marginTop: 24,
              padding: "10px 20px",
              backgroundColor: "#6366f1",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

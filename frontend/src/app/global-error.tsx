"use client";

import { useEffect } from "react";

// Last-resort boundary: fires only when the root layout or its providers throw.
// It replaces the entire document, so it must render its own <html>/<body> and
// cannot rely on the app's global styles — keep it self-contained.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#fff",
          color: "#1a1a1a",
          textAlign: "center",
          padding: "32px",
        }}
      >
        <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}>Something went wrong</h2>
        <p style={{ fontSize: "14px", color: "#666", margin: 0, maxWidth: "360px" }}>
          The app ran into an unexpected error. Please try reloading.
        </p>
        <button
          onClick={reset}
          style={{
            background: "#f97316",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            padding: "10px 24px",
            fontSize: "14px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}

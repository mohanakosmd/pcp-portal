"use client";

import { useEffect, useState } from "react";

// Renders an ISO timestamp in the *viewer's* time zone. Server-rendered pages
// otherwise format dates in the server's zone (UTC on Cloud Run); this defers
// formatting to the browser. The server-formatted `fallback` is shown first
// (so SSR + first client render match — no hydration mismatch), then it's
// re-formatted to local time after mount.
type Mode = "date" | "time" | "short";

function formatLocal(iso: string, mode: Mode): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  if (mode === "time") {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (mode === "short") {
    return `${d.toLocaleDateString(undefined, { month: "short" })} ${d.getDate()}`;
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function LocalTime({
  iso,
  mode = "date",
  prefix = "",
  fallback = "",
}: {
  iso: string;
  mode?: Mode;
  /** Optional text prepended to the formatted value (e.g. "Updated "). */
  prefix?: string;
  /** Server-formatted value shown before the browser re-formats to local. */
  fallback?: string;
}) {
  const [text, setText] = useState(fallback);

  useEffect(() => {
    if (!iso) {
      setText(fallback || "—");
      return;
    }
    setText(prefix + formatLocal(iso, mode));
  }, [iso, mode, prefix, fallback]);

  return <>{text || fallback}</>;
}

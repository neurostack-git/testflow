// Date helpers for the bug list filter.
//
// Everything is keyed on the viewer's LOCAL calendar day as "YYYY-MM-DD" —
// the same format <input type="date"> emits — so a bug filed at 23:30 IST is
// matched by selecting that IST day, not the UTC one.

/** Local calendar day of an ISO timestamp, as "YYYY-MM-DD". */
export function localDateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export function todayKey(): string {
  return localDateKey(new Date().toISOString());
}

export function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localDateKey(d.toISOString());
}

/** "Today" / "Yesterday" / "17 Aug 2026" for a date key. */
export function formatDateKey(key: string): string {
  if (!key) return "All dates";
  if (key === todayKey()) return "Today";
  if (key === yesterdayKey()) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * True when a bug was reported OR last updated on the given local day.
 *
 * Matching both is deliberate: a bug filed last week but retested today is
 * part of today's work, and filtering on `createdAt` alone would hide it.
 */
export function bugMatchesDate(
  bug: { createdAt: string; updatedAt?: string },
  key: string
): boolean {
  if (!key) return true;
  if (localDateKey(bug.createdAt) === key) return true;
  return !!bug.updatedAt && localDateKey(bug.updatedAt) === key;
}

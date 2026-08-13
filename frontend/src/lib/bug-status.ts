import React from "react";
import { CircleDot, CheckCircle2, BadgeCheck, Ban, RotateCcw } from "lucide-react";
import { type BugStatus } from "@/lib/api";
import { isDeveloper, type Role } from "@/lib/permissions";

// ── Bug status presentation + transition rules (LLD §8) ──────────────────────
//
// Server authority: backend/layers/common/python/tfcommon/bugs.py
// This mirror exists only to grey out unavailable options in the UI.
//
// Lifecycle: a Tester files a bug (Open), a Developer marks it Fixed, and the
// Tester either confirms it (Closed) or rejects the fix (Reopened).

export const ALL_STATUSES: BugStatus[] = [
  "Open",
  "Fixed",
  "Reopened",
  "Closed",
  "Invalid",
];

// Dark mode uses a tinted-transparent fill instead of the light `-100` pastel,
// which would otherwise glare against the dark canvas.
export const STATUS_STYLES: Record<string, string> = {
  Open:     "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-400/15 dark:text-blue-300 dark:ring-1 dark:ring-inset dark:ring-blue-400/25 dark:hover:bg-blue-400/25",
  Fixed:    "bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-400/15 dark:text-green-300 dark:ring-1 dark:ring-inset dark:ring-green-400/25 dark:hover:bg-green-400/25",
  Reopened: "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-400/15 dark:text-amber-300 dark:ring-1 dark:ring-inset dark:ring-amber-400/25 dark:hover:bg-amber-400/25",
  Closed:   "bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-400/15 dark:text-purple-300 dark:ring-1 dark:ring-inset dark:ring-purple-400/25 dark:hover:bg-purple-400/25",
  Invalid:  "bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-400/15 dark:text-red-300 dark:ring-1 dark:ring-inset dark:ring-red-400/25 dark:hover:bg-red-400/25",
};

export const STATUS_ICONS: Record<string, React.FC<{ className?: string }>> = {
  Open:     CircleDot,
  Fixed:    CheckCircle2,
  Reopened: RotateCcw,
  Closed:   BadgeCheck,
  Invalid:  Ban,
};

// `-600` tones are tuned for white; on the dark canvas each lifts to `-400`.
export const STATUS_ICON_COLORS: Record<string, string> = {
  Open:     "text-blue-600 dark:text-blue-400",
  Fixed:    "text-green-600 dark:text-green-400",
  Reopened: "text-amber-600 dark:text-amber-400",
  Closed:   "text-purple-600 dark:text-purple-400",
  Invalid:  "text-red-500 dark:text-red-400",
};

export const STATUS_DESCRIPTIONS: Record<string, string> = {
  Open:     "Reported and waiting for a developer.",
  Fixed:    "A developer has fixed it — awaiting retest.",
  Reopened: "Retested and still failing. Back with the developers.",
  Closed:   "Verified as resolved.",
  Invalid:  "Not a real defect, or not reproducible.",
};

// Owner and Developer share one matrix — they differ only on people management.
export const DEVELOPER_TRANSITIONS: Record<string, BugStatus[]> = {
  Open:     ["Fixed", "Closed", "Invalid"],
  Fixed:    ["Open", "Reopened", "Closed", "Invalid"],
  Reopened: ["Fixed", "Closed", "Invalid"],
  Closed:   ["Open", "Fixed", "Invalid"],
  Invalid:  ["Open", "Fixed", "Closed"],
};

// A Tester may only respond to a fix: confirm it, or say it still fails.
export const TESTER_TRANSITIONS: Record<string, BugStatus[]> = {
  Open:     [],
  Fixed:    ["Reopened", "Closed"],
  Reopened: [],
  Closed:   [],
  Invalid:  [],
};

/** The whole matrix for a role, keyed by current status. */
export function transitionMatrix(role: Role): Record<string, BugStatus[]> {
  return isDeveloper(role) ? DEVELOPER_TRANSITIONS : TESTER_TRANSITIONS;
}

/** Statuses this role may move a bug to from `current`. */
export function transitionsFor(role: Role, current: string): BugStatus[] {
  return transitionMatrix(role)[current] ?? [];
}

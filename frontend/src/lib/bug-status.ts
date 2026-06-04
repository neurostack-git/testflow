import React from "react";
import { CircleDot, CheckCircle2, BadgeCheck, Ban } from "lucide-react";
import { type BugStatus } from "@/lib/api";

// ── Bug status presentation + transition rules ───────────────────────────────
// Shared across the project page and its extracted components so status
// semantics live in one place. "Verified"/"Reopen" are legacy aliases kept for
// older records (Verified → Closed, Reopen → Open).

export const ALL_STATUSES: BugStatus[] = ["Open", "Fixed", "Closed", "Invalid"];

export const STATUS_STYLES: Record<string, string> = {
  Open:     "bg-blue-100 text-blue-700 hover:bg-blue-200",
  Fixed:    "bg-green-100 text-green-700 hover:bg-green-200",
  Closed:   "bg-purple-100 text-purple-700 hover:bg-purple-200",
  Invalid:  "bg-red-100 text-red-600 hover:bg-red-200",
  Verified: "bg-purple-100 text-purple-700 hover:bg-purple-200", // legacy alias
  Reopen:   "bg-blue-100 text-blue-700 hover:bg-blue-200",       // legacy alias
};

export const STATUS_ICONS: Record<string, React.FC<{ className?: string }>> = {
  Open:     CircleDot,
  Fixed:    CheckCircle2,
  Closed:   BadgeCheck,
  Invalid:  Ban,
  Verified: BadgeCheck, // legacy alias
  Reopen:   CircleDot,  // legacy alias
};

export const STATUS_ICON_COLORS: Record<string, string> = {
  Open:     "text-blue-600",
  Fixed:    "text-green-600",
  Closed:   "text-purple-600",
  Invalid:  "text-red-500",
  Verified: "text-purple-600", // legacy alias
  Reopen:   "text-blue-600",   // legacy alias
};

export const ADMIN_TRANSITIONS: Record<string, BugStatus[]> = {
  Open:     ["Fixed", "Closed", "Invalid"],
  Fixed:    ["Open", "Closed", "Invalid"],
  Closed:   ["Open", "Fixed", "Invalid"],
  Invalid:  ["Open", "Fixed", "Closed"],
  Verified: ["Open", "Fixed", "Invalid"],           // legacy alias
  Reopen:   ["Open", "Fixed", "Closed", "Invalid"], // legacy alias
};

export const TESTER_TRANSITIONS: Record<string, BugStatus[]> = {
  Open:     ["Closed"],
  Fixed:    ["Closed", "Open"],
  Closed:   ["Open"],
  Invalid:  ["Closed", "Open"],
  Verified: ["Open"],   // legacy alias
  Reopen:   ["Closed"], // legacy alias
};

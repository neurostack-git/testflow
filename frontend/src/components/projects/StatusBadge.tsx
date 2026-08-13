"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { type BugStatus } from "@/lib/api";
import { STATUS_STYLES, STATUS_ICONS, STATUS_ICON_COLORS } from "@/lib/bug-status";

interface StatusBadgeProps {
  status: string;
  /** When provided, shows ALL statuses in the dropdown (table mode) with disabled state for non-transitions */
  allStatuses?: string[];
  /** Statuses that can be transitioned to from the current status */
  validTransitions?: string[];
  onStatusChange?: (s: BugStatus) => void;
  dropdownAlign?: "start" | "end";
}

export function StatusBadge({
  status,
  allStatuses,
  validTransitions = [],
  onStatusChange,
  dropdownAlign = "start",
}: StatusBadgeProps) {
  const TriggerIcon = STATUS_ICONS[status];
  const triggerClass = cn(
    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
    STATUS_STYLES[status]
  );

  // Table mode: show all statuses with disabled state for non-valid transitions
  if (allStatuses) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger className={triggerClass}>
          {TriggerIcon && <TriggerIcon className="w-3 h-3" />}
          {status}
          <ChevronDown className="w-3 h-3 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align={dropdownAlign} className="w-44">
          {allStatuses.map((s) => {
            const Icon = STATUS_ICONS[s];
            const isCurrent = s === status;
            const isAllowed = validTransitions.includes(s);
            const isInvalidStatus = s === "Invalid";
            return (
              <DropdownMenuItem
                key={s}
                disabled={isCurrent || !isAllowed}
                onClick={() => isAllowed && onStatusChange?.(s as BugStatus)}
                className={cn("gap-2", isInvalidStatus && "text-red-500 focus:text-red-500 dark:text-red-400 dark:focus:text-red-400")}
              >
                {Icon && <Icon className={cn("w-3.5 h-3.5 shrink-0", isInvalidStatus ? "text-red-500 dark:text-red-400" : STATUS_ICON_COLORS[s])} />}
                <span className={isCurrent ? "font-semibold" : ""}>{s}</span>
                {isCurrent && <Check className="w-3 h-3 ml-auto opacity-70" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Detail mode: show only valid transitions; if none, show static badge
  if (validTransitions.length === 0) {
    return (
      <span className={cn(triggerClass, "shrink-0")}>
        {TriggerIcon && <TriggerIcon className="w-3 h-3" />}
        {status}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(triggerClass, "shrink-0")}>
        {TriggerIcon && <TriggerIcon className="w-3 h-3" />}
        {status}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={dropdownAlign} className="w-40">
        {validTransitions.map((s) => {
          const Icon = STATUS_ICONS[s];
          const isInvalidStatus = s === "Invalid";
          return (
            <DropdownMenuItem
              key={s}
              onClick={() => onStatusChange?.(s as BugStatus)}
              className={cn("gap-2", isInvalidStatus && "text-red-500 focus:text-red-500 dark:text-red-400 dark:focus:text-red-400")}
            >
              {Icon && <Icon className={cn("w-3.5 h-3.5 shrink-0", isInvalidStatus ? "text-red-500 dark:text-red-400" : STATUS_ICON_COLORS[s])} />}
              {s}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

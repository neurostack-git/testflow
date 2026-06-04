"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Search, X, Image, ChevronDown, Check, Eye, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Bug, type BugStatus } from "@/lib/api";
import { ALL_STATUSES, STATUS_STYLES, STATUS_ICONS, STATUS_ICON_COLORS } from "@/lib/bug-status";

type SummaryFilter = "unsolved" | "today" | null;

const TAB_KEYS = ["All", "Open", "Fixed", "Closed", "Invalid"] as const;

interface BugTableProps {
  bugs: Bug[];
  role: "admin" | "tester";
  transitions: Record<string, BugStatus[]>;
  activeTab: string;
  summaryFilter: SummaryFilter;
  testerFilter: string | null;
  setActiveTab: (tab: string) => void;
  setSummaryFilter: (f: SummaryFilter) => void;
  setTesterFilter: (name: string | null) => void;
  onOpenBug: (bug: Bug) => void;
  onOpenNewBug: () => void;
  onEditBug: (e: React.MouseEvent, bug: Bug) => void;
  onDeleteBug: (e: React.MouseEvent, bug: Bug) => void;
  onStatusChange: (bugId: string, status: BugStatus) => void;
}

export function BugTable({
  bugs,
  role,
  transitions,
  activeTab,
  summaryFilter,
  testerFilter,
  setActiveTab,
  setSummaryFilter,
  setTesterFilter,
  onOpenBug,
  onOpenNewBug,
  onEditBug,
  onDeleteBug,
  onStatusChange,
}: BugTableProps) {
  // Search lives here so typing only re-renders the table, not the whole page.
  const [bugSearch, setBugSearch] = useState("");

  // All five tab counts in a single pass.
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { All: bugs.length, Open: 0, Fixed: 0, Closed: 0, Invalid: 0 };
    for (const b of bugs) {
      const s = b.status as string;
      if (s === "Open" || s === "Reopen") counts.Open++;
      else if (s === "Closed" || s === "Verified") counts.Closed++;
      else if (s === "Fixed") counts.Fixed++;
      else if (s === "Invalid") counts.Invalid++;
    }
    return counts;
  }, [bugs]);

  const filteredBugs = useMemo(() => {
    const todayStr = new Date().toDateString();
    const tabFiltered = activeTab === "All" ? bugs
      : activeTab === "Open" ? bugs.filter((b) => b.status === "Open" || (b.status as string) === "Reopen")
      : activeTab === "Closed" ? bugs.filter((b) => b.status === "Closed" || (b.status as string) === "Verified")
      : bugs.filter((b) => b.status === activeTab);
    const summaryFiltered = summaryFilter === "unsolved"
      ? tabFiltered.filter((b) => b.status === "Open" || b.status === "Fixed")
      : summaryFilter === "today"
      ? tabFiltered.filter((b) => new Date(b.createdAt).toDateString() === todayStr)
      : tabFiltered;
    const testerFiltered = testerFilter
      ? summaryFiltered.filter((b) => (b.reporterName ?? b.reportedBy) === testerFilter)
      : summaryFiltered;
    const q = bugSearch.trim().toLowerCase();
    return q
      ? testerFiltered.filter((b) =>
          b.title.toLowerCase().includes(q) || b.description.toLowerCase().includes(q))
      : testerFiltered;
  }, [bugs, activeTab, summaryFilter, testerFilter, bugSearch]);

  const searchQuery = bugSearch.trim().toLowerCase();

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/20 gap-2">
        <div className="flex items-center gap-1 overflow-x-auto min-w-0">
          {TAB_KEYS.map((tab) => {
            const count = tabCounts[tab];
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); setSummaryFilter(null); setTesterFilter(null); }}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                {tab}
                <span className={cn(
                  "inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none min-w-[18px]",
                  isActive ? "bg-white/25 text-primary-foreground dark:bg-black/20" : "bg-muted text-muted-foreground"
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <Button
          size="sm"
          onClick={onOpenNewBug}
          className={cn("shrink-0", role === "tester" ? "bg-primary hover:bg-primary/90 gap-1.5" : "gap-1.5")}
          variant={role === "admin" ? "outline" : "default"}
        >
          <Plus className="w-3.5 h-3.5" />
          {role === "tester" ? "Report Bug" : "Add Row"}
        </Button>
      </div>

      <div className="px-3 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search by title or description…"
            value={bugSearch}
            onChange={(e) => setBugSearch(e.target.value)}
            className="w-full h-8 pl-8 pr-3 text-sm bg-muted/40 border border-border rounded-md placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors"
          />
          {bugSearch && (
            <button
              onClick={() => setBugSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/20">
              <TableHead className="pl-5">Bug Title</TableHead>
              <TableHead>Tester</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Screenshots</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredBugs.map((bug) => {
              const isClosed = bug.status === "Closed" || (bug.status as string) === "Verified";
              const isInvalid = bug.status === "Invalid";
              const attachmentCount = bug.screenshots.length + bug.documents.length + (bug.videos?.length ?? 0);
              const validTransitions = transitions[bug.status] ?? [];
              const dropdownStatuses = ALL_STATUSES.includes(bug.status as BugStatus)
                ? ALL_STATUSES
                : [bug.status as BugStatus, ...ALL_STATUSES];
              const TriggerIcon = STATUS_ICONS[bug.status];
              return (
                <TableRow
                  key={bug.bugId}
                  className="cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => onOpenBug(bug)}
                >
                  <TableCell className={cn("pl-5 font-medium", isClosed ? "line-through text-muted-foreground" : isInvalid ? "text-red-500" : "text-foreground")}>{bug.title}</TableCell>
                  <TableCell className={cn("text-sm", isClosed ? "line-through text-muted-foreground/60" : isInvalid ? "text-red-400" : "text-muted-foreground")}>{bug.reporterName ?? bug.reportedBy.slice(0, 8) + "…"}</TableCell>
                  <TableCell className={cn("text-sm", isClosed ? "line-through text-muted-foreground/60" : isInvalid ? "text-red-400" : "text-muted-foreground")}>
                    {new Date(bug.createdAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {attachmentCount > 0 ? (
                      <div className={cn("flex items-center gap-1 text-sm", isClosed ? "line-through text-muted-foreground/60" : isInvalid ? "text-red-400" : "text-muted-foreground")}>
                        <Image className="w-3.5 h-3.5" />
                        {attachmentCount}
                      </div>
                    ) : (
                      <span className="text-muted-foreground/40 text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                          STATUS_STYLES[bug.status]
                        )}
                      >
                        <TriggerIcon className="w-3 h-3" />
                        {bug.status}
                        <ChevronDown className="w-3 h-3 opacity-60" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-44">
                        {dropdownStatuses.map((s) => {
                          const Icon = STATUS_ICONS[s];
                          const isCurrent = s === bug.status;
                          const isAllowed = validTransitions.includes(s);
                          const isInvalidStatus = s === "Invalid";
                          return (
                            <DropdownMenuItem
                              key={s}
                              disabled={isCurrent || !isAllowed}
                              onClick={() => isAllowed && onStatusChange(bug.bugId, s)}
                              className={cn("gap-2", isInvalidStatus && "text-red-500 focus:text-red-500")}
                            >
                              <Icon className={cn("w-3.5 h-3.5 shrink-0", isInvalidStatus ? "text-red-500" : STATUS_ICON_COLORS[s])} />
                              <span className={isCurrent ? "font-semibold" : ""}>{s}</span>
                              {isCurrent && <Check className="w-3 h-3 ml-auto opacity-70" />}
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); onOpenBug(bug); }}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                        title="View bug"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => onEditBug(e, bug)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                        title="Edit bug"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => onDeleteBug(e, bug)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Delete bug"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {filteredBugs.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  {searchQuery ? `No bugs match "${bugSearch}".` : activeTab === "All" ? "No bugs reported yet." : `No ${activeTab.toLowerCase()} bugs.`}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

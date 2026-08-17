"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, X, Image, Eye, Pencil, Trash2, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Bug, type BugStatus } from "@/lib/api";
import { ALL_STATUSES } from "@/lib/bug-status";
import { StatusBadge } from "@/components/projects/StatusBadge";
import { isDeveloper, type Role } from "@/lib/permissions";
import { bugMatchesDate, formatDateKey, todayKey } from "@/lib/dates";

type SummaryFilter = "unsolved" | null;

const TAB_KEYS = ["All", "Open", "Fixed", "Reopened", "Closed", "Invalid"] as const;

interface BugTableProps {
  bugs: Bug[];
  role: Role;
  transitions: Record<string, BugStatus[]>;
  activeTab: string;
  summaryFilter: SummaryFilter;
  testerFilter: string | null;
  /** "YYYY-MM-DD", or "" for no date filter (the default). */
  dateFilter: string;
  setDateFilter: (key: string) => void;
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
  dateFilter,
  setDateFilter,
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
    const counts: Record<string, number> = {
      All: bugs.length, Open: 0, Fixed: 0, Reopened: 0, Closed: 0, Invalid: 0,
    };
    for (const b of bugs) counts[b.status] = (counts[b.status] ?? 0) + 1;
    return counts;
  }, [bugs]);

  const filteredBugs = useMemo(() => {
    const tabFiltered = activeTab === "All" ? bugs : bugs.filter((b) => b.status === activeTab);
    // "Unsolved" = anything still needing work: filed, awaiting retest, or failed retest.
    // "Today" is no longer here — it is the date filter below, so there is one
    // source of truth for day-based filtering.
    const summaryFiltered = summaryFilter === "unsolved"
      ? tabFiltered.filter((b) => b.status === "Open" || b.status === "Fixed" || b.status === "Reopened")
      : tabFiltered;
    const testerFiltered = testerFilter
      ? summaryFiltered.filter((b) => (b.reporterName ?? b.reportedBy) === testerFilter)
      : summaryFiltered;
    // Reported OR updated on the chosen day (see lib/dates.ts).
    const dateFiltered = dateFilter
      ? testerFiltered.filter((b) => bugMatchesDate(b, dateFilter))
      : testerFiltered;
    const q = bugSearch.trim().toLowerCase();
    return q
      ? dateFiltered.filter((b) =>
          b.title.toLowerCase().includes(q) || b.description.toLowerCase().includes(q))
      : dateFiltered;
  }, [bugs, activeTab, summaryFilter, testerFilter, dateFilter, bugSearch]);

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
                  isActive ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"
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
          variant={isDeveloper(role) ? "outline" : "default"}
        >
          <Plus className="w-3.5 h-3.5" />
          {role === "tester" ? "Report Bug" : "Add Row"}
        </Button>
      </div>

      <div className="px-3 py-2 border-b border-border flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search by title or description…"
            value={bugSearch}
            onChange={(e) => setBugSearch(e.target.value)}
            className="w-full h-8 pl-8 pr-8 text-sm bg-muted/40 border border-border rounded-md placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors"
          />
          {bugSearch && (
            <button
              onClick={() => setBugSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Date filter. No selection = all bugs, which is the default. */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className={cn(
            "relative inline-flex items-center h-8 rounded-md border transition-colors",
            dateFilter ? "border-primary/50 bg-primary/5" : "border-border bg-muted/40"
          )}>
            <Calendar className={cn(
              "absolute left-2.5 w-3.5 h-3.5 pointer-events-none",
              dateFilter ? "text-primary" : "text-muted-foreground"
            )} />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              max={todayKey()}
              aria-label="Filter by date reported or updated"
              className={cn(
                "h-8 pl-8 pr-2 text-sm bg-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30",
                dateFilter ? "text-foreground font-medium" : "text-muted-foreground"
              )}
            />
          </div>

          <button
            type="button"
            onClick={() => setDateFilter(dateFilter === todayKey() ? "" : todayKey())}
            className={cn(
              "h-8 px-2.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap",
              dateFilter === todayKey()
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            )}
          >
            Today
          </button>

          {dateFilter && (
            <button
              type="button"
              onClick={() => setDateFilter("")}
              className="h-8 px-2.5 rounded-md text-xs font-medium border border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors inline-flex items-center gap-1 whitespace-nowrap"
              title="Show all bugs"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>
      </div>

      {dateFilter && (
        <div className="px-3 py-1.5 border-b border-border bg-primary/5 text-xs text-muted-foreground">
          Showing bugs reported or updated on{" "}
          <span className="font-semibold text-foreground">{formatDateKey(dateFilter)}</span>
          {" — "}{filteredBugs.length} of {bugs.length}
        </div>
      )}

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
              const isClosed = bug.status === "Closed";
              const isInvalid = bug.status === "Invalid";
              const attachmentCount = bug.screenshots.length + bug.documents.length + (bug.videos?.length ?? 0);
              const validTransitions = transitions[bug.status] ?? [];
              const dropdownStatuses = ALL_STATUSES.includes(bug.status as BugStatus)
                ? ALL_STATUSES
                : [bug.status as BugStatus, ...ALL_STATUSES];
              return (
                <TableRow
                  key={bug.bugId}
                  className="cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => onOpenBug(bug)}
                >
                  <TableCell className={cn("pl-5 font-medium", isClosed ? "line-through text-muted-foreground" : isInvalid ? "text-red-600 dark:text-red-400" : "text-foreground")}>{bug.title}</TableCell>
                  <TableCell className={cn("text-sm", isClosed ? "line-through text-muted-foreground/60" : isInvalid ? "text-red-500/80 dark:text-red-400/90" : "text-muted-foreground")}>{bug.reporterName ?? bug.reportedBy.slice(0, 8) + "…"}</TableCell>
                  <TableCell className={cn("text-sm", isClosed ? "line-through text-muted-foreground/60" : isInvalid ? "text-red-500/80 dark:text-red-400/90" : "text-muted-foreground")}>
                    {new Date(bug.createdAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {attachmentCount > 0 ? (
                      <div className={cn("flex items-center gap-1 text-sm", isClosed ? "line-through text-muted-foreground/60" : isInvalid ? "text-red-500/80 dark:text-red-400/90" : "text-muted-foreground")}>
                        <Image className="w-3.5 h-3.5" />
                        {attachmentCount}
                      </div>
                    ) : (
                      <span className="text-muted-foreground/40 text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <StatusBadge
                      status={bug.status}
                      allStatuses={dropdownStatuses}
                      validTransitions={validTransitions}
                      onStatusChange={(s) => onStatusChange(bug.bugId, s)}
                      dropdownAlign="start"
                    />
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

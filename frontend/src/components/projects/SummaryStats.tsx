"use client";

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import { trimName } from "@/lib/filenames";
import { type Bug } from "@/lib/api";

type SummaryFilter = "unsolved" | "today" | null;

interface SummaryStatsProps {
  bugs: Bug[];
  summaryFilter: SummaryFilter;
  testerFilter: string | null;
  activeTab: string;
  setSummaryFilter: (f: SummaryFilter) => void;
  setTesterFilter: (name: string | null) => void;
  setActiveTab: (tab: string) => void;
}

export function SummaryStats({
  bugs,
  summaryFilter,
  testerFilter,
  activeTab,
  setSummaryFilter,
  setTesterFilter,
  setActiveTab,
}: SummaryStatsProps) {
  const { unsolved, todayCount, byPerson } = useMemo(() => {
    const todayStr = new Date().toDateString();
    const unsolved = bugs.filter((b) => b.status === "Open" || b.status === "Fixed").length;
    const todayCount = bugs.filter((b) => new Date(b.createdAt).toDateString() === todayStr).length;
    const byPerson = bugs.reduce<Record<string, number>>((acc, b) => {
      const name = b.reporterName ?? b.reportedBy;
      acc[name] = (acc[name] ?? 0) + 1;
      return acc;
    }, {});
    return { unsolved, todayCount, byPerson };
  }, [bugs]);

  if (bugs.length === 0) return null;

  const statCards = [
    {
      label: "Total Bugs", value: bugs.length, color: "text-foreground",
      active: !summaryFilter && !testerFilter && activeTab === "All",
      onClick: () => { setSummaryFilter(null); setTesterFilter(null); setActiveTab("All"); },
    },
    {
      label: "Unsolved", value: unsolved, color: "text-orange-500 dark:text-white",
      active: summaryFilter === "unsolved",
      onClick: () => { setSummaryFilter(summaryFilter === "unsolved" ? null : "unsolved"); setTesterFilter(null); setActiveTab("All"); },
    },
    {
      label: "Today", value: todayCount, color: "text-blue-600",
      active: summaryFilter === "today",
      onClick: () => { setSummaryFilter(summaryFilter === "today" ? null : "today"); setTesterFilter(null); setActiveTab("All"); },
    },
  ];

  return (
    <div className="mb-5 ml-7 space-y-2">
      {/* Stat cards row */}
      <div className="flex flex-wrap gap-2">
        {statCards.map(({ label, value, color, active, onClick }) => (
          <button
            key={label}
            onClick={onClick}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors",
              active
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:border-primary/40 hover:bg-muted/30"
            )}
          >
            <span className={cn("text-lg font-bold leading-none", color)}>{value}</span>
            <span className="text-xs text-muted-foreground">{label}</span>
          </button>
        ))}
      </div>
      {/* Tester chips row */}
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(byPerson).map(([name, count]) => {
          const isActive = testerFilter === name;
          return (
            <button
              key={name}
              onClick={() => { setTesterFilter(isActive ? null : name); setSummaryFilter(null); setActiveTab("All"); }}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                isActive
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
              )}
            >
              {trimName(name, 20)}
              <span className={cn(
                "inline-flex items-center justify-center rounded-full w-4 h-4 text-[10px] font-bold",
                isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}>{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

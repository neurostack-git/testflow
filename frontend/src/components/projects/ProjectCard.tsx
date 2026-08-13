"use client";

import Link from "next/link";
import { Bug, Trash2, Users, CircleDot, RotateCcw, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Project } from "@/lib/api";

interface ProjectCardProps {
  project: Project;
  canManage: boolean;
  onMoveToBin: (project: Project) => void;
}

/** Segments of the resolution bar, in lifecycle order. */
const SEGMENTS = [
  { key: "Open", className: "bg-blue-500 dark:bg-blue-400" },
  { key: "Reopened", className: "bg-amber-500 dark:bg-amber-400" },
  { key: "Fixed", className: "bg-green-500 dark:bg-green-400" },
  { key: "Closed", className: "bg-purple-500 dark:bg-purple-400" },
  { key: "Invalid", className: "bg-muted-foreground/40" },
] as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function ProjectCard({ project, canManage, onMoveToBin }: ProjectCardProps) {
  const stats = project.bugStats;
  const total = stats?.total ?? 0;

  // "Needs attention" is the number a developer actually cares about: freshly
  // filed bugs plus fixes that failed retest.
  const open = stats?.Open ?? 0;
  const reopened = stats?.Reopened ?? 0;
  const fixed = stats?.Fixed ?? 0;
  const closed = stats?.Closed ?? 0;
  const needsAttention = open + reopened;

  return (
    <div className="relative group">
      <Link href={`/projects/${project.projectId}`} className="block h-full">
        <div
          className={cn(
            "relative h-full flex flex-col overflow-hidden rounded-xl bg-card",
            "ring-1 ring-foreground/10 transition-all duration-200",
            "hover:ring-primary/35 hover:shadow-lg hover:shadow-primary/10 hover:-translate-y-0.5"
          )}
        >
          {/* Brand hairline that lights up on hover */}
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary via-primary/60 to-transparent opacity-60 group-hover:opacity-100 transition-opacity"
          />

          <div className="p-5 flex-1 flex flex-col">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-primary/25 to-primary/5 ring-1 ring-inset ring-primary/15 flex items-center justify-center group-hover:from-primary/35 group-hover:to-primary/10 transition-colors">
                <Bug className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1 pr-6">
                <h3 className="font-semibold text-foreground text-base leading-tight truncate group-hover:text-primary transition-colors">
                  {project.title}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {total === 0 ? "No bugs yet" : `${total} bug${total !== 1 ? "s" : ""}`}
                </p>
              </div>
            </div>

            {total === 0 ? (
              <div className="flex-1 flex items-end">
                <p className="text-sm text-muted-foreground/70">
                  Nothing reported yet — this project is clear.
                </p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col justify-end gap-3">
                {/* Proportional resolution bar */}
                <div
                  className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`${open} open, ${reopened} reopened, ${fixed} fixed, ${closed} closed`}
                >
                  {SEGMENTS.map(({ key, className }) => {
                    const value = stats?.[key] ?? 0;
                    if (!value) return null;
                    return (
                      <span
                        key={key}
                        className={className}
                        style={{ width: `${(value / total) * 100}%` }}
                      />
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs">
                  {needsAttention > 0 && (
                    <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                      <CircleDot className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      {needsAttention} to fix
                    </span>
                  )}
                  {reopened > 0 && (
                    <span className="inline-flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
                      <RotateCcw className="w-3.5 h-3.5" />
                      {reopened} reopened
                    </span>
                  )}
                  {fixed > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                      {fixed} to retest
                    </span>
                  )}
                  {needsAttention === 0 && fixed === 0 && closed > 0 && (
                    <span className="inline-flex items-center gap-1.5 font-medium text-green-700 dark:text-green-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      All clear
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-5 py-3 border-t border-border/60 bg-muted/25 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              {project.memberCount ?? 0} member{(project.memberCount ?? 0) !== 1 ? "s" : ""}
            </span>
            <span>{formatDate(project.createdAt)}</span>
          </div>
        </div>
      </Link>

      {canManage && (
        <button
          onClick={() => onMoveToBin(project)}
          className="absolute top-3.5 right-3.5 z-10 p-1.5 rounded-md text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          title="Move to bin"
          aria-label={`Move ${project.title} to bin`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

"use client";

import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { type BugStatus } from "@/lib/api";
import { STATUS_STYLES, STATUS_ICONS } from "@/lib/bug-status";

const GUIDE: { status: BugStatus; who: string; desc: string }[] = [
  { status: "Open", who: "Anyone", desc: "A bug has been reported and is waiting for a developer to investigate." },
  { status: "Fixed", who: "Developer", desc: "The developer believes it's resolved and is asking the tester to retest." },
  { status: "Reopened", who: "Tester", desc: "The tester retested and the issue still occurs. It goes back to the developers." },
  { status: "Closed", who: "Tester", desc: "The tester verified the fix and confirmed the bug is fully resolved." },
  { status: "Invalid", who: "Developer", desc: "Not a valid bug — cannot reproduce, out of scope, or working as intended." },
];

export function StatusGuideDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="w-4 h-4 text-muted-foreground" />
            Bug Status Guide
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          {GUIDE.map(({ status, who, desc }) => {
            const Icon = STATUS_ICONS[status] as React.FC<{ className?: string }>;
            return (
              <div key={status} className="flex items-start gap-3 p-3 rounded-lg border border-border">
                <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 mt-0.5", STATUS_STYLES[status])}>
                  <Icon className="w-3 h-3" />
                  {status}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground mb-0.5">Set by {who}</p>
                  <p className="text-sm text-foreground leading-snug">{desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

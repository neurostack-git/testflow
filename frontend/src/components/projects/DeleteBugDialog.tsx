"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Trash2 } from "lucide-react";
import { type Bug } from "@/lib/api";

export function DeleteBugDialog({
  open,
  bug,
  deleting,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  bug: Bug | null;
  deleting: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete bug?</DialogTitle>
        </DialogHeader>
        <div className="mt-1 space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-destructive/10 rounded-xl flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <p className="font-semibold text-foreground text-sm">{bug?.title}</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                This bug and all its screenshots will be permanently deleted. This cannot be undone.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="outline"
              className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
              onClick={onConfirm}
              disabled={deleting}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

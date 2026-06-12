"use client";

import { AlertTriangle } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      title="Delete bug?"
      icon={AlertTriangle}
      iconVariant="destructive"
      itemName={bug?.title}
      description="This bug and all its screenshots will be permanently deleted. This cannot be undone."
      confirmLabel="Delete"
      confirmingLabel="Deleting…"
      confirming={deleting}
    />
  );
}

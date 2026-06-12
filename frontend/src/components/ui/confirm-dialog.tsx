"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  title: string;
  itemName?: string;
  description: string;
  extra?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  iconVariant?: "destructive" | "muted";
  confirmLabel?: string;
  confirmingLabel?: string;
  confirming?: boolean;
  error?: string;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  itemName,
  description,
  extra,
  icon: Icon,
  iconVariant = "destructive",
  confirmLabel = "Confirm",
  confirmingLabel,
  confirming = false,
  error,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="mt-1 space-y-5">
          <div className="flex items-start gap-3">
            {Icon && (
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                iconVariant === "destructive" ? "bg-destructive/10" : "bg-muted"
              )}>
                <Icon className={cn(
                  "w-5 h-5",
                  iconVariant === "destructive" ? "text-destructive" : "text-muted-foreground"
                )} />
              </div>
            )}
            <div>
              {itemName && <p className="font-semibold text-foreground text-sm">{itemName}</p>}
              <p className={cn("text-sm text-muted-foreground", itemName && "mt-0.5")}>{description}</p>
              {extra}
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={confirming}>
              Cancel
            </Button>
            <Button
              variant="outline"
              className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
              onClick={onConfirm}
              disabled={confirming}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              {confirming ? (confirmingLabel ?? `${confirmLabel}…`) : confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

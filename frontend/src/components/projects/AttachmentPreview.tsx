"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Play, X, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { trimName } from "@/lib/filenames";
import type { PreviewItem } from "@/hooks/useAttachmentPreviews";

interface AttachmentPreviewProps {
  items: PreviewItem[];
  /** Omit to render read-only (no remove buttons). */
  onRemove?: (item: PreviewItem) => void;
  /** Upload percentage keyed by item id, shown as an overlay bar. */
  progress?: Record<string, number>;
  emptyHint?: string;
}

/**
 * Thumbnail grid for bug attachments, covering both files staged locally and
 * attachments already in S3. Clicking a tile enlarges it so a screenshot can be
 * checked before the bug is submitted.
 */
export function AttachmentPreview({ items, onRemove, progress, emptyHint }: AttachmentPreviewProps) {
  const [expanded, setExpanded] = useState<PreviewItem | null>(null);

  // Escape closes the lightbox before the dialog behind it sees the key.
  useEffect(() => {
    if (!expanded) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.stopPropagation(); setExpanded(null); }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [expanded]);

  if (items.length === 0) {
    return emptyHint ? <p className="text-xs text-muted-foreground">{emptyHint}</p> : null;
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const pct = progress?.[item.id];
          const uploading = pct !== undefined && pct < 100;
          return (
            <div
              key={item.id}
              className="group/thumb relative w-20 h-20 rounded-lg overflow-hidden bg-muted ring-1 ring-inset ring-foreground/10"
            >
              <button
                type="button"
                onClick={() => setExpanded(item)}
                className="w-full h-full block cursor-zoom-in"
                title={`Preview ${item.name}`}
              >
                {item.kind === "image" ? (
                  item.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.url} alt={item.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center">
                      <ImageOff className="w-5 h-5 text-muted-foreground/50" />
                    </span>
                  )
                ) : (
                  <>
                    <video src={item.url} preload="metadata" muted className="w-full h-full object-cover" />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/35">
                      <Play className="w-5 h-5 text-white drop-shadow" />
                    </span>
                  </>
                )}
              </button>

              {uploading && (
                <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
                  <div className="h-full bg-primary transition-all duration-150" style={{ width: `${pct}%` }} />
                </div>
              )}

              {onRemove && !uploading && (
                <button
                  type="button"
                  onClick={() => onRemove(item)}
                  className={cn(
                    "absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white",
                    "flex items-center justify-center opacity-0 group-hover/thumb:opacity-100",
                    "focus-visible:opacity-100 transition-opacity hover:bg-destructive"
                  )}
                  title={`Remove ${item.name}`}
                  aria-label={`Remove ${item.name}`}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {expanded && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-6"
          onClick={() => setExpanded(null)}
        >
          <button
            type="button"
            onClick={() => setExpanded(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Close preview"
          >
            <X className="w-5 h-5" />
          </button>

          <div onClick={(e) => e.stopPropagation()} className="max-w-full max-h-[80vh]">
            {expanded.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={expanded.url} alt={expanded.name} className="max-w-full max-h-[80vh] object-contain rounded-lg" />
            ) : (
              <video src={expanded.url} controls autoPlay className="max-w-full max-h-[80vh] rounded-lg" />
            )}
          </div>
          <p className="text-white/70 text-xs mt-3">{trimName(expanded.name)}</p>
        </div>,
        document.body
      )}
    </>
  );
}

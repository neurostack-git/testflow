"use client";

import { useEffect, useRef } from "react";

/** Content types the attachments Lambda will presign. */
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/**
 * Capture images pasted anywhere while a dialog is open (Ctrl/Cmd+V).
 *
 * Listens on `window` rather than a specific field, because people paste a
 * screenshot without first clicking into an upload zone. Text pastes are left
 * completely alone — the event is only consumed when an image is present, so
 * pasting into the title or description behaves normally.
 */
export function usePasteImages(enabled: boolean, onImages: (files: File[]) => void) {
  // Kept in a ref so the listener is registered once, not on every render.
  const handler = useRef(onImages);
  handler.current = onImages;

  useEffect(() => {
    if (!enabled) return;

    function onPaste(event: ClipboardEvent) {
      const items = event.clipboardData?.items;
      if (!items) return;

      const images: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind !== "file" || !ACCEPTED.includes(item.type)) continue;
        const file = item.getAsFile();
        if (!file) continue;

        // Clipboard images all arrive named "image.png"; make them unique so
        // several pastes don't look like the same attachment.
        const ext = item.type.split("/")[1] === "jpeg" ? "jpg" : item.type.split("/")[1];
        images.push(
          new File([file], `pasted-${Date.now()}-${images.length + 1}.${ext}`, { type: item.type })
        );
      }

      if (images.length === 0) return;   // plain text paste — let it through
      event.preventDefault();
      handler.current(images);
    }

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [enabled]);
}

"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { attachmentsApi } from "@/lib/api";

/**
 * Self-contained screenshot carousel. Owns its index, presigned-URL fetching,
 * an in-session URL cache (so navigating back doesn't re-fetch), and keyboard
 * navigation. Mount it conditionally — it renders as soon as it's present.
 */
export function Lightbox({
  screenshots,
  startIndex,
  onClose,
}: {
  screenshots: string[];
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const [url, setUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [loading, setLoading] = useState(true);
  const cache = useRef<Record<string, { url: string; filename: string }>>({});
  const firstLoad = useRef(true);

  const fetchUrl = useCallback(async (key: string) => {
    if (cache.current[key]) return cache.current[key];
    const result = await attachmentsApi.viewUrl(key);
    cache.current[key] = result;
    return result;
  }, []);

  // Load the current image whenever the index changes (and on mount).
  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchUrl(screenshots[index])
      .then(({ url, filename }) => {
        if (!active) return;
        setUrl(url);
        setFilename(filename);
      })
      .catch(() => {
        // Match original behavior: a failed *initial* load closes the lightbox;
        // a failed navigation leaves it open on the previous image.
        if (active && firstLoad.current) onClose();
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          firstLoad.current = false;
        }
      });
    return () => { active = false; };
  }, [index, screenshots, fetchUrl, onClose]);

  const navigate = useCallback((newIndex: number) => {
    if (newIndex < 0 || newIndex >= screenshots.length) return;
    setIndex(newIndex);
  }, [screenshots.length]);

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") navigate(index - 1);
      else if (e.key === "ArrowRight") navigate(index + 1);
      else if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, navigate, onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/90" onClick={onClose}>
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
      >
        <X className="w-5 h-5" />
      </button>

      {screenshots.length > 1 && index > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); navigate(index - 1); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}

      {screenshots.length > 1 && index < screenshots.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); navigate(index + 1); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      )}

      <div className="flex items-center justify-center w-full h-full p-16" onClick={(e) => e.stopPropagation()}>
        {loading ? (
          <div className="w-8 h-8 rounded-full border-2 border-white border-t-transparent animate-spin" />
        ) : url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={filename} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
        ) : null}
      </div>

      <div className="absolute bottom-6 flex items-center gap-4">
        {screenshots.length > 1 && (
          <span className="text-white/60 text-sm">{index + 1} / {screenshots.length}</span>
        )}
        {url && (
          <a
            href={url}
            download={filename}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            Download
          </a>
        )}
      </div>
    </div>,
    document.body
  );
}

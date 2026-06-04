"use client";

import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function VideoPlayer({
  video,
  onClose,
}: {
  video: { url: string; filename: string } | null;
  onClose: () => void;
}) {
  if (!video) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/90 flex flex-col items-center justify-center p-4"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
      >
        <X className="w-5 h-5" />
      </button>
      <div className="flex flex-col items-center gap-3 w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-white/70 text-sm">{video.filename}</p>
        <video src={video.url} controls autoPlay className="max-w-full max-h-[80vh] rounded-lg shadow-2xl" />
      </div>
    </div>,
    document.body
  );
}

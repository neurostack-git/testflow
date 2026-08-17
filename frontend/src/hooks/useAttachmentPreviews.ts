"use client";

import { useEffect, useMemo, useState } from "react";
import { attachmentsApi } from "@/lib/api";

export interface PreviewItem {
  id: string;
  /** Blob URL for a not-yet-uploaded File, or a presigned URL for an S3 key. */
  url: string;
  name: string;
  kind: "image" | "video";
  /** Set for items already stored in S3, so the caller can remove by key. */
  s3Key?: string;
  /** Index into the pending File[], so the caller can remove by position. */
  fileIndex?: number;
}

/**
 * Blob URLs for files chosen but not yet uploaded.
 *
 * Object URLs leak until revoked, and a bug dialog can churn through a lot of
 * them, so each generation is released when the file list changes or the
 * component unmounts.
 */
export function useObjectUrls(files: File[]): string[] {
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    const created = files.map((file) => URL.createObjectURL(file));
    setUrls(created);
    return () => created.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  return urls;
}

/**
 * Presigned view URLs for attachments already in S3.
 *
 * Resolved once per key and cached, so reopening the edit dialog does not
 * re-presign everything. Failures are skipped rather than surfaced — a broken
 * thumbnail must not block editing the bug.
 */
export function useResolvedKeys(keys: string[], enabled: boolean): Record<string, string> {
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const pending = useMemo(
    () => keys.filter((key) => key && !(key in resolved)),
    [keys, resolved]
  );

  useEffect(() => {
    if (!enabled || pending.length === 0) return;
    let cancelled = false;

    Promise.all(
      pending.map(async (key) => {
        try {
          const { url } = await attachmentsApi.viewUrl(key, true);
          return [key, url] as const;
        } catch {
          return null;
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const entry of entries) if (entry) next[entry[0]] = entry[1];
      if (Object.keys(next).length) setResolved((prev) => ({ ...prev, ...next }));
    });

    return () => { cancelled = true; };
  }, [pending, enabled]);

  return resolved;
}

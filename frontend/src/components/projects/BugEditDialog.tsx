"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, Video } from "lucide-react";
import { bugsApi, attachmentsApi, uploadToS3, uploadToS3WithProgress, type Bug, type BugStatus, type UpdateBugPayload } from "@/lib/api";
import { cn } from "@/lib/utils";
import { displayFilename } from "@/lib/filenames";
import { ALL_STATUSES, STATUS_STYLES, transitionsFor } from "@/lib/bug-status";
import { canEditBug, isDeveloper, type Role } from "@/lib/permissions";
import { useAuth } from "@/context/auth-context";
import { AttachmentPreview } from "@/components/projects/AttachmentPreview";
import { useObjectUrls, useResolvedKeys, type PreviewItem } from "@/hooks/useAttachmentPreviews";
import { usePasteImages } from "@/hooks/usePasteImages";

// Must match backend/lambdas/bugs/handler.py MAX_ATTACHMENTS.
const MAX_SCREENSHOTS = 10;
const MAX_VIDEOS = 5;

function sameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function getEditableStatuses(bug: Bug, role: Role): BugStatus[] {
  if (isDeveloper(role)) return ALL_STATUSES;
  // A Tester sees their current status plus whatever they may move it to.
  return [bug.status, ...transitionsFor(role, bug.status)]
    .filter((s, i, a) => a.indexOf(s) === i);
}

interface BugEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bug: Bug | null;
  projectId: string;
  role: Role;
  onUpdated: (bug: Bug) => void;
}

export function BugEditDialog({ open, onOpenChange, bug, projectId, role, onUpdated }: BugEditDialogProps) {
  const { user } = useAuth();
  // Testers may retest ANY bug but may only rewrite their own (D10). When they
  // cannot edit content, the dialog still works — as a status-only form.
  const canEditContent = !!bug && canEditBug(role, user?.sub ?? "", bug);

  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [status, setStatus] = useState<BugStatus>("Open");
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [videos, setVideos] = useState<string[]>([]);
  const [newVideoFiles, setNewVideoFiles] = useState<File[]>([]);
  const [videoProgress, setVideoProgress] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Existing attachments live in S3 and need presigning; new ones are local blobs.
  const resolved = useResolvedKeys([...screenshots, ...videos], open);
  const newFileUrls = useObjectUrls(newFiles);
  const newVideoUrls = useObjectUrls(newVideoFiles);

  usePasteImages(open && canEditContent, (pasted) =>
    setNewFiles((prev) =>
      [...prev, ...pasted].slice(0, Math.max(0, MAX_SCREENSHOTS - screenshots.length))
    )
  );

  const screenshotItems: PreviewItem[] = [
    ...screenshots.map((key) => ({
      id: `k:${key}`, url: resolved[key] ?? "", name: displayFilename(key),
      kind: "image" as const, s3Key: key,
    })),
    ...newFiles.map((file, i) => ({
      id: `n:${i}`, url: newFileUrls[i] ?? "", name: file.name,
      kind: "image" as const, fileIndex: i,
    })),
  ];

  const videoItems: PreviewItem[] = [
    ...videos.map((key) => ({
      id: `k:${key}`, url: resolved[key] ?? "", name: displayFilename(key),
      kind: "video" as const, s3Key: key,
    })),
    ...newVideoFiles.map((file, i) => ({
      id: `edit_${i}`, url: newVideoUrls[i] ?? "", name: file.name,
      kind: "video" as const, fileIndex: i,
    })),
  ];

  function removeScreenshot(item: PreviewItem) {
    if (item.s3Key) setScreenshots((prev) => prev.filter((k) => k !== item.s3Key));
    else setNewFiles((prev) => prev.filter((_, j) => j !== item.fileIndex));
  }

  function removeVideo(item: PreviewItem) {
    if (item.s3Key) setVideos((prev) => prev.filter((k) => k !== item.s3Key));
    else setNewVideoFiles((prev) => prev.filter((_, j) => j !== item.fileIndex));
  }

  useEffect(() => {
    if (open && bug) {
      setTitle(bug.title);
      setDesc(bug.description ?? "");
      setStatus(bug.status);
      setScreenshots(bug.screenshots ?? []);
      setNewFiles([]);
      setVideos(bug.videos ?? []);
      setNewVideoFiles([]);
      setVideoProgress({});
      setError("");
    }
  }, [open, bug]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!bug || !title.trim()) return;
    setSaving(true);
    setError("");
    try {
      const uploadedKeys: string[] = [];
      for (const file of newFiles) {
        const { presignedUrl, s3Key } = await attachmentsApi.presign({ filename: file.name, contentType: file.type, projectId });
        await uploadToS3(presignedUrl, file);
        uploadedKeys.push(s3Key);
      }
      const uploadedVideoKeys: string[] = [];
      for (let vi = 0; vi < newVideoFiles.length; vi++) {
        const file = newVideoFiles[vi];
        const { presignedUrl, s3Key } = await attachmentsApi.presign({ filename: file.name, contentType: file.type, projectId });
        setVideoProgress((p) => ({ ...p, [`edit_${vi}`]: 0 }));
        await uploadToS3WithProgress(presignedUrl, file, (pct) =>
          setVideoProgress((p) => ({ ...p, [`edit_${vi}`]: pct }))
        );
        uploadedVideoKeys.push(s3Key);
      }
      setVideoProgress({});

      // Send ONLY what changed. The server applies ownership rules to content
      // fields and the transition matrix to status, so blindly resending an
      // unchanged title would make a tester's legitimate status change on
      // someone else's bug fail the ownership check.
      const nextScreenshots = [...screenshots, ...uploadedKeys];
      const nextVideos = [...videos, ...uploadedVideoKeys];
      const payload: UpdateBugPayload = {};

      if (status !== bug.status) payload.status = status;
      if (canEditContent) {
        if (title.trim() !== bug.title) payload.title = title.trim();
        if (desc.trim() !== (bug.description ?? "")) payload.description = desc.trim();
        if (!sameKeys(nextScreenshots, bug.screenshots ?? [])) payload.screenshots = nextScreenshots;
        if (!sameKeys(nextVideos, bug.videos ?? [])) payload.videos = nextVideos;
      }

      if (Object.keys(payload).length === 0) {
        onOpenChange(false);
        return;
      }

      const updated = await bugsApi.update(projectId, bug.bugId, payload);
      onUpdated(updated);
      onOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setError(""); setNewFiles([]); } }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Bug</DialogTitle>
        </DialogHeader>
        {bug && (
          <form onSubmit={handleSave} className="space-y-4 mt-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-title">Title</Label>
                <span className={cn("text-[11px]", title.length > 450 ? "text-destructive" : "text-muted-foreground/60")}>
                  {title.length}/500
                </span>
              </div>
              <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)}
                autoFocus={canEditContent} required maxLength={500}
                disabled={!canEditContent} className={cn(!canEditContent && "opacity-70 cursor-not-allowed")} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-desc">Description</Label>
                <span className={cn("text-[11px]", desc.length > 9000 ? "text-destructive" : "text-muted-foreground/60")}>
                  {desc.length}/10,000
                </span>
              </div>
              <textarea id="edit-desc"
                className="w-full min-h-24 rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={10000}
                disabled={!canEditContent} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <div className="flex flex-wrap gap-2">
                {getEditableStatuses(bug, role).map((s) => (
                  <button key={s} type="button" onClick={() => setStatus(s)}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-semibold border transition-colors",
                      status === s
                        ? STATUS_STYLES[s]
                        : s === "Invalid"
                          ? "border-red-200 text-red-400 hover:bg-red-50 dark:border-red-400/30 dark:text-red-400 dark:hover:bg-red-400/10"
                          : "border-border text-muted-foreground hover:bg-muted/50"
                    )}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Screenshots</Label>
              {!canEditContent && (
                <p className="text-xs text-muted-foreground">
                  You can change the status of this bug, but only its reporter can edit the details.
                </p>
              )}
              <AttachmentPreview
                items={screenshotItems}
                onRemove={canEditContent ? removeScreenshot : undefined}
                emptyHint="No screenshots attached."
              />
              {canEditContent && (
                <label className="flex items-center justify-center gap-2 w-full h-16 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors text-sm text-muted-foreground">
                  <Upload className="w-4 h-4" />
                  Click to upload, or paste with Ctrl+V
                  <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
                    onChange={(e) => {
                      const picked = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      setNewFiles((prev) => [...prev, ...picked].slice(0, Math.max(0, MAX_SCREENSHOTS - screenshots.length)));
                    }} />
                </label>
              )}
            </div>
            <div className="space-y-2">
              <Label>Videos</Label>
              <AttachmentPreview
                items={videoItems}
                progress={videoProgress}
                onRemove={canEditContent ? removeVideo : undefined}
                emptyHint="No videos attached."
              />
              {canEditContent && (
                <label className="flex items-center justify-center gap-2 w-full h-16 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors text-sm text-muted-foreground">
                  <Video className="w-4 h-4" />
                  Upload new videos
                  <input type="file" multiple accept="video/mp4,video/quicktime,video/webm,video/x-m4v,video/mpeg" className="hidden"
                    onChange={(e) => {
                      const picked = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      setNewVideoFiles((prev) => [...prev, ...picked].slice(0, Math.max(0, MAX_VIDEOS - videos.length)));
                    }} />
                </label>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" className="bg-primary hover:bg-primary/90" disabled={saving}>
                {saving ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

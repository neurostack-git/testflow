"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Image, Upload, Video, X } from "lucide-react";
import { bugsApi, attachmentsApi, uploadToS3, uploadToS3WithProgress, type Bug, type BugStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { trimName, displayFilename } from "@/lib/filenames";
import { ALL_STATUSES, STATUS_STYLES, TESTER_TRANSITIONS } from "@/lib/bug-status";

function getEditableStatuses(bug: Bug, role: string): BugStatus[] {
  if (role === "admin") return ALL_STATUSES;
  const possible = TESTER_TRANSITIONS[bug.status] ?? [];
  const current = ALL_STATUSES.includes(bug.status) ? bug.status : ("Open" as BugStatus);
  return [current, ...possible].filter((s, i, a) => a.indexOf(s) === i);
}

interface BugEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bug: Bug | null;
  projectId: string;
  role: string;
  onUpdated: (bug: Bug) => void;
}

export function BugEditDialog({ open, onOpenChange, bug, projectId, role, onUpdated }: BugEditDialogProps) {
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
      const updated = await bugsApi.update(projectId, bug.bugId, {
        title: title.trim(),
        description: desc.trim(),
        status: status !== bug.status ? status : undefined,
        screenshots: [...screenshots, ...uploadedKeys],
        videos: [...videos, ...uploadedVideoKeys],
      });
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
              <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required maxLength={500} />
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
                value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={10000} />
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
                          ? "border-red-200 text-red-400 hover:bg-red-50"
                          : "border-border text-muted-foreground hover:bg-muted/50"
                    )}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Screenshots</Label>
              {screenshots.length > 0 && (
                <div className="space-y-1.5">
                  {screenshots.map((key, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-muted/40 text-sm overflow-hidden">
                      <div className="flex items-center gap-2 min-w-0">
                        <Image className="w-4 h-4 text-primary shrink-0" />
                        <span className="truncate text-sm">{trimName(displayFilename(key))}</span>
                      </div>
                      <button type="button" onClick={() => setScreenshots((prev) => prev.filter((_, j) => j !== i))}
                        className="text-muted-foreground hover:text-destructive shrink-0" title="Remove screenshot">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <label className="flex items-center justify-center gap-2 w-full h-16 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors text-sm text-muted-foreground">
                <Upload className="w-4 h-4" />
                Upload new screenshots
                <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
                  onChange={(e) => {
                    const f = Array.from(e.target.files || []);
                    setNewFiles((prev) => [...prev, ...f].slice(0, Math.max(0, 6 - screenshots.length)));
                    e.target.value = "";
                  }} />
              </label>
              {newFiles.length > 0 && (
                <div className="space-y-1.5">
                  {newFiles.map((file, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-dashed border-primary/30 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <Image className="w-4 h-4 text-primary shrink-0" />
                        <span className="truncate">{trimName(file.name)}</span>
                        <span className="text-xs text-muted-foreground shrink-0">New</span>
                      </div>
                      <button type="button" onClick={() => setNewFiles((prev) => prev.filter((_, j) => j !== i))}
                        className="text-muted-foreground hover:text-destructive shrink-0">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>Videos</Label>
              {videos.length > 0 && (
                <div className="space-y-1.5">
                  {videos.map((key, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-muted/40 text-sm overflow-hidden">
                      <div className="flex items-center gap-2 min-w-0">
                        <Video className="w-4 h-4 text-primary shrink-0" />
                        <span className="truncate text-sm">{trimName(displayFilename(key))}</span>
                      </div>
                      <button type="button" onClick={() => setVideos((prev) => prev.filter((_, j) => j !== i))}
                        className="text-muted-foreground hover:text-destructive shrink-0">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <label className="flex items-center justify-center gap-2 w-full h-16 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors text-sm text-muted-foreground">
                <Video className="w-4 h-4" />
                Upload new videos
                <input type="file" multiple accept="video/mp4,video/quicktime,video/webm,video/x-m4v,video/mpeg" className="hidden"
                  onChange={(e) => {
                    const f = Array.from(e.target.files || []);
                    setNewVideoFiles((prev) => [...prev, ...f].slice(0, Math.max(0, 5 - videos.length)));
                    e.target.value = "";
                  }} />
              </label>
              {newVideoFiles.length > 0 && (
                <div className="space-y-1.5">
                  {newVideoFiles.map((file, i) => {
                    const pct = videoProgress[`edit_${i}`];
                    const uploading = pct !== undefined;
                    return (
                      <div key={i} className="px-3 py-2 rounded-lg bg-primary/5 border border-dashed border-primary/30 text-sm space-y-1.5 overflow-hidden">
                        <div className="flex items-center justify-between gap-2 overflow-hidden">
                          <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                            <Video className="w-4 h-4 text-primary shrink-0" />
                            <span className="truncate">{trimName(file.name)}</span>
                            {!uploading && <span className="text-xs text-muted-foreground shrink-0">New</span>}
                          </div>
                          {uploading ? (
                            <span className="text-xs font-semibold text-primary shrink-0">{pct}%</span>
                          ) : (
                            <button type="button" onClick={() => setNewVideoFiles((prev) => prev.filter((_, j) => j !== i))}
                              className="text-muted-foreground hover:text-destructive shrink-0">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        {uploading && (
                          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full transition-all duration-150 ease-out" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
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

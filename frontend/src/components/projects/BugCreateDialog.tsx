"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Image, Upload, Video, X } from "lucide-react";
import { bugsApi, attachmentsApi, uploadToS3, uploadToS3WithProgress, type Bug } from "@/lib/api";
import { cn } from "@/lib/utils";
import { trimName } from "@/lib/filenames";

// Must match MAX_SCREENSHOTS / MAX_VIDEOS in backend/lambdas/bugs/handler.py —
// the server rejects anything above these.
const MAX_SCREENSHOTS = 10;
const MAX_VIDEOS = 5;

interface BugCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  reporterName: string;
  onCreated: (bug: Bug) => void;
}

export function BugCreateDialog({ open, onOpenChange, projectId, reporterName, onCreated }: BugCreateDialogProps) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [videoProgress, setVideoProgress] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setTitle("");
    setDesc("");
    setFiles([]);
    setVideoFiles([]);
    setVideoProgress({});
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !projectId) return;
    setSubmitting(true);
    setError("");
    try {
      const screenshots: string[] = [];
      for (const file of files) {
        const { presignedUrl, s3Key } = await attachmentsApi.presign({ filename: file.name, contentType: file.type, projectId });
        await uploadToS3(presignedUrl, file);
        screenshots.push(s3Key);
      }
      const videos: string[] = [];
      for (let vi = 0; vi < videoFiles.length; vi++) {
        const file = videoFiles[vi];
        const { presignedUrl, s3Key } = await attachmentsApi.presign({ filename: file.name, contentType: file.type, projectId });
        setVideoProgress((p) => ({ ...p, [`create_${vi}`]: 0 }));
        await uploadToS3WithProgress(presignedUrl, file, (pct) =>
          setVideoProgress((p) => ({ ...p, [`create_${vi}`]: pct }))
        );
        videos.push(s3Key);
      }
      setVideoProgress({});
      const newBug = await bugsApi.create(projectId, {
        title: title.trim(),
        description: desc.trim(),
        screenshots,
        documents: [],
        videos,
      });
      onCreated({ ...newBug, reporterName });
      onOpenChange(false);
      reset();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit bug");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Report New Bug</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="bug-title">Bug Title</Label>
              <span className={cn("text-[11px]", title.length > 450 ? "text-destructive" : "text-muted-foreground/60")}>
                {title.length}/500
              </span>
            </div>
            <Input id="bug-title" placeholder="Short description of the issue"
              value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required maxLength={500} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="bug-desc">Description</Label>
              <span className={cn("text-[11px]", desc.length > 9000 ? "text-destructive" : "text-muted-foreground/60")}>
                {desc.length}/10,000
              </span>
            </div>
            <textarea id="bug-desc"
              className="w-full min-h-24 rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Steps to reproduce, expected vs actual behaviour..."
              value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={10000} />
          </div>
          <div className="space-y-2">
            <Label>Screenshots <span className="text-muted-foreground font-normal">(max {MAX_SCREENSHOTS}, images only)</span></Label>
            <label className="flex items-center justify-center gap-2 w-full h-20 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors text-sm text-muted-foreground">
              <Upload className="w-4 h-4" />
              Click to upload screenshots
              <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
                onChange={(e) => {
                  // Read the FileList BEFORE clearing the input. React runs the
                  // functional updater during render, by which point resetting
                  // `value` has already emptied `e.target.files`.
                  const picked = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  setFiles((prev) => [...prev, ...picked].slice(0, MAX_SCREENSHOTS));
                }} />
            </label>
            {files.length > 0 && (
              <div className="space-y-1.5 mt-2">
                {files.map((file, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-muted/40 text-sm overflow-hidden">
                    <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                      <Image className="w-4 h-4 text-primary shrink-0" />
                      <span className="truncate">{trimName(file.name)}</span>
                    </div>
                    <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-destructive shrink-0">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label>Videos <span className="text-muted-foreground font-normal">(max {MAX_VIDEOS}, up to 1 GB each)</span></Label>
            <label className="flex items-center justify-center gap-2 w-full h-20 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors text-sm text-muted-foreground">
              <Video className="w-4 h-4" />
              Click to upload videos
              <input type="file" multiple accept="video/mp4,video/quicktime,video/webm,video/x-m4v,video/mpeg" className="hidden"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  setVideoFiles((prev) => [...prev, ...picked].slice(0, MAX_VIDEOS));
                }} />
            </label>
            {videoFiles.length > 0 && (
              <div className="space-y-1.5 mt-2">
                {videoFiles.map((file, i) => {
                  const pct = videoProgress[`create_${i}`];
                  const uploading = pct !== undefined;
                  return (
                    <div key={i} className="px-3 py-2 rounded-lg bg-muted/40 text-sm space-y-1.5 overflow-hidden">
                      <div className="flex items-center justify-between gap-2 overflow-hidden">
                        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                          <Video className="w-4 h-4 text-primary shrink-0" />
                          <span className="truncate">{trimName(file.name)}</span>
                        </div>
                        {uploading ? (
                          <span className="text-xs font-semibold text-primary shrink-0">{pct}%</span>
                        ) : (
                          <button type="button" onClick={() => setVideoFiles((prev) => prev.filter((_, j) => j !== i))}
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
            <Button type="submit" className="bg-primary hover:bg-primary/90" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit Bug"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

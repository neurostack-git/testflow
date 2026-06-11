"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft, Plus, ChevronDown,
  FileText, Image, X, Upload, UserPlus, Download,
  Trash2, Eye, Video, Info,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  projectsApi, bugsApi, attachmentsApi, authApi, uploadToS3, uploadToS3WithProgress,
  type Project, type Bug, type BugStatus, type ProjectReport,
} from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { ChatDrawer } from "@/components/chat/ChatDrawer";
import { MessageCircle } from "lucide-react";
import { trimName, displayFilename } from "@/lib/filenames";
import {
  ALL_STATUSES, STATUS_STYLES, STATUS_ICONS, STATUS_ICON_COLORS,
  ADMIN_TRANSITIONS, TESTER_TRANSITIONS,
} from "@/lib/bug-status";
import { StatusGuideDialog } from "@/components/projects/StatusGuideDialog";
import { VideoPlayer } from "@/components/projects/VideoPlayer";
import { DeleteBugDialog } from "@/components/projects/DeleteBugDialog";
import { ReportViewer } from "@/components/projects/ReportViewer";
import { Lightbox } from "@/components/projects/Lightbox";
import { SummaryStats } from "@/components/projects/SummaryStats";
import { BugTable } from "@/components/projects/BugTable";

const REPORT_ACCEPT = ".md,.txt,.pdf,.docx,text/markdown,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const REPORT_CONTENT_TYPES: Record<string, string> = {
  md: "text/markdown",
  txt: "text/plain",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function getContentType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return REPORT_CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export default function ProjectDetailPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const { user } = useAuth();

  // Core data
  const [project, setProject] = useState<Project | null>(null);
  const [bugs, setBugs] = useState<Bug[]>([]);
  const [reports, setReports] = useState<ProjectReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Bug detail / create dialog
  const [selectedBug, setSelectedBug] = useState<Bug | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newBugTitle, setNewBugTitle] = useState("");
  const [newBugDesc, setNewBugDesc] = useState("");
  const [newBugFiles, setNewBugFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Delete bug confirm dialog
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; bug: Bug | null }>({ open: false, bug: null });
  const [deleting, setDeleting] = useState(false);

  // Edit bug dialog
  const [editBug, setEditBug] = useState<Bug | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editStatus, setEditStatus] = useState<BugStatus>("Open");
  const [editScreenshots, setEditScreenshots] = useState<string[]>([]);
  const [editNewFiles, setEditNewFiles] = useState<File[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // Screenshot lightbox (carousel) — self-contained component owns fetch/cache/keys
  const [lightbox, setLightbox] = useState<{ screenshots: string[]; index: number } | null>(null);

  // Video player
  const [videoPlayer, setVideoPlayer] = useState<{ url: string; filename: string } | null>(null);
  const [videoPlayerLoading, setVideoPlayerLoading] = useState<string | null>(null);

  // Status info dialog
  const [statusInfoOpen, setStatusInfoOpen] = useState(false);

  // New video files for bug creation / edit
  const [newBugVideoFiles, setNewBugVideoFiles] = useState<File[]>([]);
  const [editVideos, setEditVideos] = useState<string[]>([]);
  const [editNewVideoFiles, setEditNewVideoFiles] = useState<File[]>([]);

  // Video upload progress: key = "create_0", "edit_0", etc. → 0-100
  const [videoProgress, setVideoProgress] = useState<Record<string, number>>({});

  // Invite tester dialog
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);

  // Reports
  const [stagedReports, setStagedReports] = useState<File[]>([]);
  const [uploadingReports, setUploadingReports] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportViewer, setReportViewer] = useState<{ url: string; filename: string; contentType: string; textContent?: string } | null>(null);
  const [reportViewLoading, setReportViewLoading] = useState<string | null>(null);

  // Chat drawer — lazy mount: only add to DOM after first open to avoid overflow
  const [chatOpen, setChatOpen] = useState(false);
  const [chatEverOpened, setChatEverOpened] = useState(false);
  function openChat() { setChatOpen(true); setChatEverOpened(true); }
  function closeChat() { setChatOpen(false); }

  // Open chat automatically if navigated here from a notification (?chat=1)
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("chat") === "1") {
      openChat();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Status tab + summary/tester filters (shared between SummaryStats and BugTable).
  // The free-text search lives inside BugTable so typing doesn't re-render this page.
  const [activeTab, setActiveTab] = useState("All");
  const [summaryFilter, setSummaryFilter] = useState<"unsolved" | "today" | null>(null);
  const [testerFilter, setTesterFilter] = useState<string | null>(null);

  const role = user?.role ?? "tester";
  const transitions = role === "admin" ? ADMIN_TRANSITIONS : TESTER_TRANSITIONS;

  const loadData = useCallback(async () => {
    if (!projectId) return;
    try {
      const [proj, bugsRes, reportsRes] = await Promise.all([
        projectsApi.get(projectId),
        bugsApi.list(projectId),
        projectsApi.listReports(projectId),
      ]);
      setProject(proj);
      setBugs([...bugsRes.bugs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setReports(reportsRes.reports);
    } catch {
      setError("Failed to load project");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Status change (quick dropdown in table) ──────────────────────────────
  async function handleStatusChange(bugId: string, newStatus: BugStatus) {
    try {
      await bugsApi.updateStatus(projectId, bugId, newStatus);
      setBugs((prev) => prev.map((b) => b.bugId === bugId ? { ...b, status: newStatus } : b));
      if (selectedBug?.bugId === bugId) {
        setSelectedBug((prev) => prev ? { ...prev, status: newStatus } : prev);
      }
    } catch {
      setError("Failed to update status");
    }
  }

  // ── Bug detail dialog ────────────────────────────────────────────────────
  function openBug(bug: Bug) {
    setSelectedBug(bug);
    setIsCreating(false);
    setDialogOpen(true);
  }

  function openNewBug() {
    setSelectedBug(null);
    setIsCreating(true);
    setNewBugTitle("");
    setNewBugDesc("");
    setNewBugFiles([]);
    setNewBugVideoFiles([]);
    setDialogOpen(true);
  }

  function handleFileAdd(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    setNewBugFiles((prev) => [...prev, ...files].slice(0, 10));
    e.target.value = "";
  }

  async function handleSubmitBug(e: React.FormEvent) {
    e.preventDefault();
    if (!newBugTitle.trim() || !projectId) return;
    setSubmitting(true);
    setError("");
    try {
      const screenshots: string[] = [];
      const documents: string[] = [];
      const videos: string[] = [];

      for (const file of newBugFiles) {
        const { presignedUrl, s3Key } = await attachmentsApi.presign({
          filename: file.name,
          contentType: file.type,
          projectId,
        });
        await uploadToS3(presignedUrl, file);
        screenshots.push(s3Key);
      }

      for (let vi = 0; vi < newBugVideoFiles.length; vi++) {
        const file = newBugVideoFiles[vi];
        const { presignedUrl, s3Key } = await attachmentsApi.presign({
          filename: file.name,
          contentType: file.type,
          projectId,
        });
        setVideoProgress((p) => ({ ...p, [`create_${vi}`]: 0 }));
        await uploadToS3WithProgress(presignedUrl, file, (pct) =>
          setVideoProgress((p) => ({ ...p, [`create_${vi}`]: pct }))
        );
        videos.push(s3Key);
      }
      setVideoProgress({});

      const newBug = await bugsApi.create(projectId, {
        title: newBugTitle.trim(),
        description: newBugDesc.trim(),
        screenshots,
        documents,
        videos,
      });

      setBugs((prev) => [{ ...newBug, reporterName: user?.name ?? "" }, ...prev]);
      setDialogOpen(false);
      setNewBugVideoFiles([]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit bug");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Edit bug dialog ──────────────────────────────────────────────────────
  function openEditBug(e: React.MouseEvent, bug: Bug) {
    e.stopPropagation();
    setEditBug(bug);
    setEditTitle(bug.title);
    setEditDesc(bug.description ?? "");
    setEditStatus(bug.status);
    setEditScreenshots(bug.screenshots ?? []);
    setEditNewFiles([]);
    setEditVideos(bug.videos ?? []);
    setEditNewVideoFiles([]);
    setEditError("");
    setEditOpen(true);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editBug || !editTitle.trim()) return;
    setEditSaving(true);
    setEditError("");
    try {
      const uploadedKeys: string[] = [];
      for (const file of editNewFiles) {
        const { presignedUrl, s3Key } = await attachmentsApi.presign({
          filename: file.name,
          contentType: file.type,
          projectId,
        });
        await uploadToS3(presignedUrl, file);
        uploadedKeys.push(s3Key);
      }

      const uploadedVideoKeys: string[] = [];
      for (let vi = 0; vi < editNewVideoFiles.length; vi++) {
        const file = editNewVideoFiles[vi];
        const { presignedUrl, s3Key } = await attachmentsApi.presign({
          filename: file.name,
          contentType: file.type,
          projectId,
        });
        setVideoProgress((p) => ({ ...p, [`edit_${vi}`]: 0 }));
        await uploadToS3WithProgress(presignedUrl, file, (pct) =>
          setVideoProgress((p) => ({ ...p, [`edit_${vi}`]: pct }))
        );
        uploadedVideoKeys.push(s3Key);
      }
      setVideoProgress({});

      const updated = await bugsApi.update(projectId, editBug.bugId, {
        title: editTitle.trim(),
        description: editDesc.trim(),
        status: editStatus !== editBug.status ? editStatus : undefined,
        screenshots: [...editScreenshots, ...uploadedKeys],
        videos: [...editVideos, ...uploadedVideoKeys],
      });
      setBugs((prev) => prev.map((b) => b.bugId === updated.bugId ? updated : b));
      if (selectedBug?.bugId === updated.bugId) setSelectedBug(updated);
      setEditOpen(false);
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setEditSaving(false);
    }
  }

  // ── Delete bug ───────────────────────────────────────────────────────────
  function handleDeleteBug(e: React.MouseEvent, bug: Bug) {
    e.stopPropagation();
    setDeleteConfirm({ open: true, bug });
  }

  async function confirmDeleteBug() {
    if (!deleteConfirm.bug) return;
    setDeleting(true);
    try {
      await bugsApi.delete(projectId, deleteConfirm.bug.bugId);
      setBugs((prev) => prev.filter((b) => b.bugId !== deleteConfirm.bug!.bugId));
      if (selectedBug?.bugId === deleteConfirm.bug.bugId) setDialogOpen(false);
      setDeleteConfirm({ open: false, bug: null });
    } catch {
      setError("Failed to delete bug");
    } finally {
      setDeleting(false);
    }
  }

  // ── Video player ─────────────────────────────────────────────────────────
  async function openVideoPlayer(key: string) {
    setVideoPlayerLoading(key);
    try {
      const { url, filename } = await attachmentsApi.viewUrl(key, true);
      setVideoPlayer({ url, filename });
    } catch {
      setReportError("Failed to load video");
    } finally {
      setVideoPlayerLoading(null);
    }
  }

  // ── Invite tester ────────────────────────────────────────────────────────
  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim() || !projectId) return;
    setInviting(true);
    setError("");
    try {
      await authApi.inviteTester(inviteEmail.trim(), projectId);
      setInviteSent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to invite tester");
    } finally {
      setInviting(false);
    }
  }

  // ── Reports ──────────────────────────────────────────────────────────────
  function handleReportFileAdd(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    setStagedReports((prev) => [...prev, ...files]);
    e.target.value = "";
  }

  async function handleViewReport(report: ProjectReport) {
    setReportViewLoading(report.reportId);
    try {
      const ext = report.filename.split(".").pop()?.toLowerCase() ?? "";
      if (ext === "md" || ext === "txt") {
        const { content, filename } = await attachmentsApi.viewContent(report.s3Key);
        setReportViewer({ url: "", filename, contentType: report.contentType, textContent: content });
      } else {
        const { url, filename } = await attachmentsApi.viewUrl(report.s3Key, true);
        setReportViewer({ url, filename, contentType: report.contentType });
      }
    } catch {
      setReportError("Failed to load report preview");
    } finally {
      setReportViewLoading(null);
    }
  }

  function removeStagedReport(index: number) {
    setStagedReports((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleUploadReports() {
    if (!stagedReports.length || !projectId) return;
    setUploadingReports(true);
    setReportError("");
    try {
      for (const file of stagedReports) {
        const contentType = getContentType(file);
        const { presignedUrl, s3Key } = await attachmentsApi.presign({
          filename: file.name,
          contentType,
          projectId,
          uploadType: "report",
        });
        await uploadToS3(presignedUrl, file);
        const saved = await projectsApi.saveReport(projectId, {
          s3Key,
          filename: file.name,
          contentType,
        });
        setReports((prev) => [...prev, saved]);
      }
      setStagedReports([]);
    } catch (err: unknown) {
      setReportError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingReports(false);
    }
  }

  async function handleDeleteReport(reportId: string, s3Key: string) {
    try {
      await projectsApi.deleteReport(projectId, reportId);
      setReports((prev) => prev.filter((r) => r.reportId !== reportId));
    } catch {
      setReportError("Failed to delete report");
    }
    void s3Key; // s3 delete handled server-side
  }

  async function handleDownloadReport(s3Key: string) {
    try {
      const { url } = await attachmentsApi.viewUrl(s3Key);
      window.open(url, "_blank");
    } catch {
      setReportError("Failed to get download link");
    }
  }

  // ── Derive available statuses for edit dialog ────────────────────────────
  function getEditableStatuses(bug: Bug): BugStatus[] {
    if (role === "admin") return ALL_STATUSES;
    const possible = TESTER_TRANSITIONS[bug.status] ?? [];
    const current = ALL_STATUSES.includes(bug.status) ? bug.status : ("Open" as BugStatus);
    return [current, ...possible].filter((s, i, a) => a.indexOf(s) === i);
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div className="w-7 h-7 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="text-2xl font-bold text-foreground">{project?.title ?? "Project"}</h1>
        </div>
        <div className="flex items-center gap-2">
          {role === "admin" && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-primary border-primary/30 hover:bg-primary/5"
              onClick={() => setInviteOpen(true)}
            >
              <UserPlus className="w-3.5 h-3.5" />
              Invite Tester
            </Button>
          )}
          <button
            onClick={() => setStatusInfoOpen(true)}
            className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            title="Status guide"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-muted-foreground ml-7">{bugs.length} bug{bugs.length !== 1 ? "s" : ""}</p>
        {role === "tester" && project?.adminName && (
          <p className="text-sm text-muted-foreground">
            Developer: <span className="font-medium text-foreground">{project.adminName}</span>
          </p>
        )}
      </div>

      {/* Summary stats */}
      <SummaryStats
        bugs={bugs}
        summaryFilter={summaryFilter}
        testerFilter={testerFilter}
        activeTab={activeTab}
        setSummaryFilter={setSummaryFilter}
        setTesterFilter={setTesterFilter}
        setActiveTab={setActiveTab}
      />

      {error && <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg mb-4">{error}</p>}

      {/* Bugs table */}
      <BugTable
        bugs={bugs}
        role={role}
        transitions={transitions}
        activeTab={activeTab}
        summaryFilter={summaryFilter}
        testerFilter={testerFilter}
        setActiveTab={setActiveTab}
        setSummaryFilter={setSummaryFilter}
        setTesterFilter={setTesterFilter}
        onOpenBug={openBug}
        onOpenNewBug={openNewBug}
        onEditBug={openEditBug}
        onDeleteBug={handleDeleteBug}
        onStatusChange={handleStatusChange}
      />

      {/* Reports section */}
      <div className="mt-8 border border-border rounded-xl overflow-hidden bg-card">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">Overall Report</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
              {reports.length}
            </span>
          </div>
          <div className="relative">
            <label
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer border-border text-foreground hover:bg-muted/40"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Files
              <input
                type="file"
                multiple
                accept={REPORT_ACCEPT}
                className="hidden"
                onChange={handleReportFileAdd}
              />
            </label>
          </div>
        </div>

        <div className="p-4 space-y-2">
          {reportError && (
            <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg mb-2">{reportError}</p>
          )}

          {/* Existing reports */}
          {reports.map((report) => (
            <div key={report.reportId} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-border bg-background text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="truncate font-medium text-foreground">{report.filename}</span>
                <span className="text-muted-foreground text-xs shrink-0">
                  {new Date(report.uploadedAt).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleViewReport(report)}
                  disabled={reportViewLoading === report.reportId}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                  title="View"
                >
                  {reportViewLoading === report.reportId
                    ? <div className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground border-t-transparent animate-spin" />
                    : <Eye className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => handleDownloadReport(report.s3Key)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  title="Download"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDeleteReport(report.reportId, report.s3Key)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}

          {/* Staged (not yet uploaded) */}
          {stagedReports.map((file, i) => (
            <div key={i} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-dashed border-primary/40 bg-primary/5 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-primary shrink-0" />
                <span className="truncate font-medium text-foreground">{file.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">Pending</span>
              </div>
              <button
                onClick={() => removeStagedReport(i)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {reports.length === 0 && stagedReports.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-6">No report files yet.</p>
          )}

          {/* Upload button */}
          {stagedReports.length > 0 && (
            <div className="flex justify-end pt-2">
              <Button
                size="sm"
                className="bg-primary hover:bg-primary/90 gap-1.5"
                onClick={handleUploadReports}
                disabled={uploadingReports}
              >
                <Upload className="w-3.5 h-3.5" />
                {uploadingReports ? "Uploading…" : `Upload ${stagedReports.length} file${stagedReports.length !== 1 ? "s" : ""}`}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Invite Tester Dialog */}
      <Dialog open={inviteOpen} onOpenChange={(o) => {
        setInviteOpen(o);
        if (!o) { setInviteEmail(""); setInviteSent(false); setError(""); }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite Tester</DialogTitle>
          </DialogHeader>

          {inviteSent ? (
            <div className="flex flex-col items-center text-center gap-4 py-4">
              <div className="w-12 h-12 bg-green-100 rounded-2xl flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-foreground">Invitation sent successfully!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  An email with login credentials has been sent to<br />
                  <span className="font-medium text-foreground">{inviteEmail}</span>
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => { setInviteSent(false); setInviteEmail(""); }}>
                  Invite another
                </Button>
                <Button className="bg-primary hover:bg-primary/90" onClick={() => {
                  setInviteOpen(false); setInviteSent(false); setInviteEmail("");
                }}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleInvite} className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Tester&apos;s email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="tester@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  autoFocus
                  required
                />
                <p className="text-xs text-muted-foreground">
                  An invite email with login credentials will be sent automatically.
                </p>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
                <Button type="submit" className="bg-primary hover:bg-primary/90" disabled={inviting}>
                  {inviting ? "Sending…" : "Send Invite"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Bug detail / create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isCreating ? "Report New Bug" : "Bug Details"}</DialogTitle>
          </DialogHeader>

          {isCreating ? (
            <form onSubmit={handleSubmitBug} className="space-y-4 mt-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="bug-title">Bug Title</Label>
                  <span className={cn("text-[11px]", newBugTitle.length > 450 ? "text-destructive" : "text-muted-foreground/60")}>
                    {newBugTitle.length}/500
                  </span>
                </div>
                <Input id="bug-title" placeholder="Short description of the issue"
                  value={newBugTitle} onChange={(e) => setNewBugTitle(e.target.value)} autoFocus required maxLength={500} />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="bug-desc">Description</Label>
                  <span className={cn("text-[11px]", newBugDesc.length > 9000 ? "text-destructive" : "text-muted-foreground/60")}>
                    {newBugDesc.length}/10,000
                  </span>
                </div>
                <textarea id="bug-desc"
                  className="w-full min-h-24 rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Steps to reproduce, expected vs actual behaviour..."
                  value={newBugDesc} onChange={(e) => setNewBugDesc(e.target.value)} maxLength={10000} />
              </div>
              <div className="space-y-2">
                <Label>Screenshots <span className="text-muted-foreground font-normal">(max 10, images only)</span></Label>
                <label className="flex items-center justify-center gap-2 w-full h-20 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors text-sm text-muted-foreground">
                  <Upload className="w-4 h-4" />
                  Click to upload screenshots
                  <input
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={handleFileAdd}
                  />
                </label>
                {newBugFiles.length > 0 && (
                  <div className="space-y-1.5 mt-2">
                    {newBugFiles.map((file, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-muted/40 text-sm overflow-hidden">
                        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                          <Image className="w-4 h-4 text-primary shrink-0" />
                          <span className="truncate">{trimName(file.name)}</span>
                        </div>
                        <button type="button" onClick={() => setNewBugFiles((prev) => prev.filter((_, j) => j !== i))}
                          className="text-muted-foreground hover:text-destructive shrink-0">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Videos <span className="text-muted-foreground font-normal">(max 5, up to 1 GB each)</span></Label>
                <label className="flex items-center justify-center gap-2 w-full h-20 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors text-sm text-muted-foreground">
                  <Video className="w-4 h-4" />
                  Click to upload videos
                  <input
                    type="file"
                    multiple
                    accept="video/mp4,video/quicktime,video/webm,video/x-m4v,video/mpeg"
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      setNewBugVideoFiles((prev) => [...prev, ...files].slice(0, 5));
                      e.target.value = "";
                    }}
                  />
                </label>
                {newBugVideoFiles.length > 0 && (
                  <div className="space-y-1.5 mt-2">
                    {newBugVideoFiles.map((file, i) => {
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
                              <button type="button" onClick={() => setNewBugVideoFiles((prev) => prev.filter((_, j) => j !== i))}
                                className="text-muted-foreground hover:text-destructive shrink-0">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          {uploading && (
                            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary rounded-full transition-all duration-150 ease-out"
                                style={{ width: `${pct}%` }}
                              />
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
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" className="bg-primary hover:bg-primary/90" disabled={submitting}>
                  {submitting ? "Submitting…" : "Submit Bug"}
                </Button>
              </div>
            </form>
          ) : selectedBug ? (
            <div className="space-y-4 mt-1">
              {/* Title + status */}
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-bold text-foreground text-lg leading-snug">{selectedBug.title}</h3>
                {transitions[selectedBug.status].length > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium shrink-0 transition-colors",
                      STATUS_STYLES[selectedBug.status]
                    )}>
                      {(() => { const Icon = STATUS_ICONS[selectedBug.status]; return <Icon className="w-3 h-3" />; })()}
                      {selectedBug.status}
                      <ChevronDown className="w-3 h-3 opacity-60" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      {transitions[selectedBug.status].map((s) => {
                        const Icon = STATUS_ICONS[s];
                        const isInvalidStatus = s === "Invalid";
                        return (
                          <DropdownMenuItem key={s} onClick={() => handleStatusChange(selectedBug.bugId, s)} className={cn("gap-2", isInvalidStatus && "text-red-500 focus:text-red-500")}>
                            <Icon className={cn("w-3.5 h-3.5 shrink-0", isInvalidStatus ? "text-red-500" : STATUS_ICON_COLORS[s])} />
                            {s}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium shrink-0", STATUS_STYLES[selectedBug.status])}>
                    {(() => { const Icon = STATUS_ICONS[selectedBug.status]; return <Icon className="w-3 h-3" />; })()}
                    {selectedBug.status}
                  </span>
                )}
              </div>

              {/* Meta row — small, muted */}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                {selectedBug.reporterName && <span>{selectedBug.reporterName}</span>}
                {selectedBug.reporterName && <span className="w-0.5 h-3 bg-border rounded-full inline-block" />}
                <span>Reported {new Date(selectedBug.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                <span className="w-0.5 h-3 bg-border rounded-full inline-block" />
                <span>Updated {new Date(selectedBug.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
              </div>

              {/* Description — main content */}
              {selectedBug.description && (
                <div className="rounded-xl bg-muted/40 border border-border/50 p-4">
                  <p className="text-sm font-medium text-muted-foreground mb-1.5">Description</p>
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{selectedBug.description}</p>
                </div>
              )}

              {/* Screenshots */}
              {selectedBug.screenshots.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Screenshots ({selectedBug.screenshots.length})
                  </p>
                  <div className="space-y-1.5">
                    {selectedBug.screenshots.map((key, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setLightbox({ screenshots: selectedBug.screenshots, index: i })}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border text-sm text-foreground hover:bg-muted/30 hover:border-primary/30 transition-colors group"
                      >
                        <Image className="w-4 h-4 text-primary shrink-0" />
                        <span className="truncate flex-1 text-left">{trimName(displayFilename(key))}</span>
                        <span className="text-xs font-semibold text-primary shrink-0 group-hover:underline">View</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Videos */}
              {(selectedBug.videos ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Videos ({(selectedBug.videos ?? []).length})
                  </p>
                  <div className="space-y-1.5">
                    {(selectedBug.videos ?? []).map((key, i) => {
                      const filename = displayFilename(key);
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => openVideoPlayer(key)}
                          disabled={videoPlayerLoading === key}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border text-sm text-foreground hover:bg-muted/30 hover:border-primary/30 transition-colors group"
                        >
                          {videoPlayerLoading === key
                            ? <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
                            : <Video className="w-4 h-4 text-primary shrink-0" />}
                          <span className="truncate flex-1 text-left">{trimName(filename)}</span>
                          <span className="text-xs font-semibold text-primary shrink-0 group-hover:underline">Play</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Documents */}
              {selectedBug.documents.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Documents ({selectedBug.documents.length})
                  </p>
                  <div className="space-y-1.5">
                    {selectedBug.documents.map((key, i) => (
                      <div key={i} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border text-sm text-foreground">
                        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="truncate">{trimName(displayFilename(key))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Edit Bug Dialog */}
      <Dialog open={editOpen} onOpenChange={(o) => { setEditOpen(o); if (!o) { setEditError(""); setEditNewFiles([]); } }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Bug</DialogTitle>
          </DialogHeader>
          {editBug && (
            <form onSubmit={handleSaveEdit} className="space-y-4 mt-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="edit-title">Title</Label>
                  <span className={cn("text-[11px]", editTitle.length > 450 ? "text-destructive" : "text-muted-foreground/60")}>
                    {editTitle.length}/500
                  </span>
                </div>
                <Input
                  id="edit-title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  autoFocus
                  required
                  maxLength={500}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="edit-desc">Description</Label>
                  <span className={cn("text-[11px]", editDesc.length > 9000 ? "text-destructive" : "text-muted-foreground/60")}>
                    {editDesc.length}/10,000
                  </span>
                </div>
                <textarea
                  id="edit-desc"
                  className="w-full min-h-24 rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  maxLength={10000}
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <div className="flex flex-wrap gap-2">
                  {getEditableStatuses(editBug).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setEditStatus(s)}
                      className={cn(
                        "px-3 py-1 rounded-full text-xs font-semibold border transition-colors",
                        editStatus === s
                          ? STATUS_STYLES[s]
                          : s === "Invalid"
                            ? "border-red-200 text-red-400 hover:bg-red-50"
                            : "border-border text-muted-foreground hover:bg-muted/50"
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Screenshots</Label>
                {editScreenshots.length > 0 && (
                  <div className="space-y-1.5">
                    {editScreenshots.map((key, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-muted/40 text-sm overflow-hidden">
                        <div className="flex items-center gap-2 min-w-0">
                          <Image className="w-4 h-4 text-primary shrink-0" />
                          <span className="truncate text-sm">
                            {trimName(displayFilename(key))}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setEditScreenshots((prev) => prev.filter((_, j) => j !== i))}
                          className="text-muted-foreground hover:text-destructive shrink-0"
                          title="Remove screenshot"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <label className="flex items-center justify-center gap-2 w-full h-16 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors text-sm text-muted-foreground">
                  <Upload className="w-4 h-4" />
                  Upload new screenshots
                  <input
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      setEditNewFiles((prev) => [...prev, ...files].slice(0, Math.max(0, 6 - editScreenshots.length)));
                      e.target.value = "";
                    }}
                  />
                </label>
                {editNewFiles.length > 0 && (
                  <div className="space-y-1.5">
                    {editNewFiles.map((file, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-dashed border-primary/30 text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <Image className="w-4 h-4 text-primary shrink-0" />
                          <span className="truncate">{trimName(file.name)}</span>
                          <span className="text-xs text-muted-foreground shrink-0">New</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setEditNewFiles((prev) => prev.filter((_, j) => j !== i))}
                          className="text-muted-foreground hover:text-destructive shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Videos</Label>
                {editVideos.length > 0 && (
                  <div className="space-y-1.5">
                    {editVideos.map((key, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-muted/40 text-sm overflow-hidden">
                        <div className="flex items-center gap-2 min-w-0">
                          <Video className="w-4 h-4 text-primary shrink-0" />
                          <span className="truncate text-sm">
                            {trimName(displayFilename(key))}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setEditVideos((prev) => prev.filter((_, j) => j !== i))}
                          className="text-muted-foreground hover:text-destructive shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <label className="flex items-center justify-center gap-2 w-full h-16 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors text-sm text-muted-foreground">
                  <Video className="w-4 h-4" />
                  Upload new videos
                  <input
                    type="file"
                    multiple
                    accept="video/mp4,video/quicktime,video/webm,video/x-m4v,video/mpeg"
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      setEditNewVideoFiles((prev) => [...prev, ...files].slice(0, Math.max(0, 5 - editVideos.length)));
                      e.target.value = "";
                    }}
                  />
                </label>
                {editNewVideoFiles.length > 0 && (
                  <div className="space-y-1.5">
                    {editNewVideoFiles.map((file, i) => {
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
                              <button
                                type="button"
                                onClick={() => setEditNewVideoFiles((prev) => prev.filter((_, j) => j !== i))}
                                className="text-muted-foreground hover:text-destructive shrink-0"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          {uploading && (
                            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary rounded-full transition-all duration-150 ease-out"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {editError && <p className="text-sm text-destructive">{editError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
                <Button type="submit" className="bg-primary hover:bg-primary/90" disabled={editSaving}>
                  {editSaving ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Bug Confirmation Dialog */}
      <DeleteBugDialog
        open={deleteConfirm.open}
        bug={deleteConfirm.bug}
        deleting={deleting}
        onOpenChange={(o) => !deleting && setDeleteConfirm({ open: o, bug: o ? deleteConfirm.bug : null })}
        onConfirm={confirmDeleteBug}
      />

      {/* Status Guide Dialog */}
      <StatusGuideDialog open={statusInfoOpen} onOpenChange={setStatusInfoOpen} />

      {/* Report Viewer */}
      <ReportViewer viewer={reportViewer} onClose={() => setReportViewer(null)} />

      {/* Video Player */}
      <VideoPlayer video={videoPlayer} onClose={() => setVideoPlayer(null)} />

      {/* Floating chat bubble + drawer — portalled to body to escape tf-page-in transform stacking context */}
      {createPortal(
        <>
          {!chatOpen && (
            <button
              onClick={openChat}
              className="fixed bottom-6 right-6 z-[9998] p-3.5 rounded-full shadow-lg bg-primary text-primary-foreground hover:scale-105 hover:shadow-xl transition-all duration-200"
              title="Project chat"
            >
              <MessageCircle className="w-5 h-5" />
            </button>
          )}

          {project && chatEverOpened && (
            <ChatDrawer
              projectId={projectId}
              projectTitle={project.title}
              open={chatOpen}
              onClose={closeChat}
              currentUserSub={user?.sub ?? ""}
              currentUserName={user?.name ?? ""}
              currentUserRole={role}
            />
          )}
        </>,
        document.body
      )}

      {/* Screenshot Lightbox (carousel) */}
      {lightbox && (
        <Lightbox
          screenshots={lightbox.screenshots}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

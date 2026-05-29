"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ArrowLeft, Plus, ChevronDown, ChevronLeft, ChevronRight,
  FileText, Image, X, Upload, UserPlus, Pencil, Download,
  Trash2, Eye, AlertTriangle, CircleDot, CheckCircle2,
  BadgeCheck, Ban, Video, Info, Search, Check,
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

const STATUS_STYLES: Record<string, string> = {
  Open:     "bg-blue-100 text-blue-700 hover:bg-blue-200",
  Fixed:    "bg-green-100 text-green-700 hover:bg-green-200",
  Closed:   "bg-purple-100 text-purple-700 hover:bg-purple-200",
  Invalid:  "bg-red-100 text-red-600 hover:bg-red-200",
  Verified: "bg-purple-100 text-purple-700 hover:bg-purple-200", // legacy alias
  Reopen:   "bg-blue-100 text-blue-700 hover:bg-blue-200",       // legacy alias
};

const ALL_STATUSES: BugStatus[] = ["Open", "Fixed", "Closed", "Invalid"];

const STATUS_ICONS: Record<string, React.FC<{ className?: string }>> = {
  Open:     CircleDot,
  Fixed:    CheckCircle2,
  Closed:   BadgeCheck,
  Invalid:  Ban,
  Verified: BadgeCheck, // legacy alias
  Reopen:   CircleDot,  // legacy alias
};

const STATUS_ICON_COLORS: Record<string, string> = {
  Open:     "text-blue-600",
  Fixed:    "text-green-600",
  Closed:   "text-purple-600",
  Invalid:  "text-red-500",
  Verified: "text-purple-600", // legacy alias
  Reopen:   "text-blue-600",   // legacy alias
};

const ADMIN_TRANSITIONS: Record<string, BugStatus[]> = {
  Open:     ["Fixed", "Closed", "Invalid"],
  Fixed:    ["Open", "Closed", "Invalid"],
  Closed:   ["Open", "Fixed", "Invalid"],
  Invalid:  ["Open", "Fixed", "Closed"],
  Verified: ["Open", "Fixed", "Invalid"],         // legacy alias
  Reopen:   ["Open", "Fixed", "Closed", "Invalid"], // legacy alias
};

const TESTER_TRANSITIONS: Record<string, BugStatus[]> = {
  Open:     ["Closed"],
  Fixed:    ["Closed", "Open"],
  Closed:   ["Open"],
  Invalid:  ["Closed", "Open"],
  Verified: ["Open"],            // legacy alias
  Reopen:   ["Closed"],          // legacy alias
};

const REPORT_ACCEPT = ".md,.txt,.pdf,.docx,text/markdown,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const REPORT_CONTENT_TYPES: Record<string, string> = {
  md: "text/markdown",
  txt: "text/plain",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function trimName(name: string, max = 48): string {
  return name.length > max ? name.slice(0, max) + "…" : name;
}

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

  // Screenshot lightbox (carousel)
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxScreenshots, setLightboxScreenshots] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxFilename, setLightboxFilename] = useState<string>("");
  const [lightboxLoading, setLightboxLoading] = useState(false);
  // Cache presigned URLs so navigating back doesn't re-fetch (URLs valid 1 hour)
  const lightboxUrlCache = React.useRef<Record<string, { url: string; filename: string }>>({});

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

  // Status tab filter + search + summary filters
  const [activeTab, setActiveTab] = useState("All");
  const [bugSearch, setBugSearch] = useState("");
  const [summaryFilter, setSummaryFilter] = useState<"unsolved" | "today" | null>(null);
  const [testerFilter, setTesterFilter] = useState<string | null>(null);

  const role = user?.role ?? "tester";
  const transitions = role === "admin" ? ADMIN_TRANSITIONS : TESTER_TRANSITIONS;

  const TAB_KEYS = ["All", "Open", "Fixed", "Closed", "Invalid"] as const;
  const tabCount = (tab: string) => {
    if (tab === "All") return bugs.length;
    if (tab === "Open") return bugs.filter(b => b.status === "Open" || (b.status as string) === "Reopen").length;
    if (tab === "Closed") return bugs.filter(b => b.status === "Closed" || (b.status as string) === "Verified").length;
    return bugs.filter(b => b.status === tab).length;
  };
  const todayStr = new Date().toDateString();
  const tabFilteredBugs = activeTab === "All" ? bugs
    : activeTab === "Open" ? bugs.filter(b => b.status === "Open" || (b.status as string) === "Reopen")
    : activeTab === "Closed" ? bugs.filter(b => b.status === "Closed" || (b.status as string) === "Verified")
    : bugs.filter(b => b.status === activeTab);
  const summaryFiltered = summaryFilter === "unsolved"
    ? tabFilteredBugs.filter(b => b.status === "Open" || b.status === "Fixed")
    : summaryFilter === "today"
    ? tabFilteredBugs.filter(b => new Date(b.createdAt).toDateString() === todayStr)
    : tabFilteredBugs;
  const testerFiltered = testerFilter
    ? summaryFiltered.filter(b => (b.reporterName ?? b.reportedBy) === testerFilter)
    : summaryFiltered;
  const searchQuery = bugSearch.trim().toLowerCase();
  const filteredBugs = searchQuery
    ? testerFiltered.filter(b =>
        b.title.toLowerCase().includes(searchQuery) ||
        b.description.toLowerCase().includes(searchQuery)
      )
    : testerFiltered;

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

  // ── Screenshot lightbox (carousel) ──────────────────────────────────────
  async function fetchLightboxUrl(key: string) {
    if (lightboxUrlCache.current[key]) return lightboxUrlCache.current[key];
    const result = await attachmentsApi.viewUrl(key);
    lightboxUrlCache.current[key] = result;
    return result;
  }

  async function openLightbox(screenshots: string[], index: number) {
    setLightboxScreenshots(screenshots);
    setLightboxIndex(index);
    setLightboxOpen(true);
    setLightboxUrl(null);
    setLightboxLoading(true);
    try {
      const { url, filename } = await fetchLightboxUrl(screenshots[index]);
      setLightboxUrl(url);
      setLightboxFilename(filename);
    } catch {
      setLightboxOpen(false);
    } finally {
      setLightboxLoading(false);
    }
  }

  async function navigateLightbox(newIndex: number) {
    if (newIndex < 0 || newIndex >= lightboxScreenshots.length) return;
    setLightboxIndex(newIndex);
    setLightboxLoading(true);
    try {
      const { url, filename } = await fetchLightboxUrl(lightboxScreenshots[newIndex]);
      setLightboxUrl(url);
      setLightboxFilename(filename);
    } catch {} finally {
      setLightboxLoading(false);
    }
  }

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

  function closeLightbox() {
    setLightboxOpen(false);
    setLightboxScreenshots([]);
    setLightboxUrl(null);
    setLightboxFilename("");
    lightboxUrlCache.current = {};
  }

  useEffect(() => {
    if (!lightboxOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") navigateLightbox(lightboxIndex - 1);
      else if (e.key === "ArrowRight") navigateLightbox(lightboxIndex + 1);
      else if (e.key === "Escape") closeLightbox();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxOpen, lightboxIndex, lightboxScreenshots]);

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
      {bugs.length > 0 && (() => {
        const unsolved = bugs.filter(b => b.status === "Open" || b.status === "Fixed").length;
        const todayCount = bugs.filter(b => new Date(b.createdAt).toDateString() === todayStr).length;
        const byPerson = bugs.reduce<Record<string, number>>((acc, b) => {
          const name = b.reporterName ?? b.reportedBy;
          acc[name] = (acc[name] ?? 0) + 1;
          return acc;
        }, {});
        const statCards = [
          {
            label: "Total Bugs", value: bugs.length, color: "text-foreground",
            active: !summaryFilter && !testerFilter && activeTab === "All",
            onClick: () => { setSummaryFilter(null); setTesterFilter(null); setActiveTab("All"); },
          },
          {
            label: "Unsolved", value: unsolved, color: "text-orange-500",
            active: summaryFilter === "unsolved",
            onClick: () => { setSummaryFilter(summaryFilter === "unsolved" ? null : "unsolved"); setTesterFilter(null); setActiveTab("All"); },
          },
          {
            label: "Today", value: todayCount, color: "text-blue-600",
            active: summaryFilter === "today",
            onClick: () => { setSummaryFilter(summaryFilter === "today" ? null : "today"); setTesterFilter(null); setActiveTab("All"); },
          },
        ];
        return (
          <div className="mb-5 ml-7 space-y-2">
            {/* Stat cards row */}
            <div className="flex flex-wrap gap-2">
              {statCards.map(({ label, value, color, active, onClick }) => (
                <button
                  key={label}
                  onClick={onClick}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors",
                    active
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/40 hover:bg-muted/30"
                  )}
                >
                  <span className={cn("text-lg font-bold leading-none", color)}>{value}</span>
                  <span className="text-xs text-muted-foreground">{label}</span>
                </button>
              ))}
            </div>
            {/* Tester chips row */}
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(byPerson).map(([name, count]) => {
                const isActive = testerFilter === name;
                return (
                  <button
                    key={name}
                    onClick={() => { setTesterFilter(isActive ? null : name); setSummaryFilter(null); setActiveTab("All"); }}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                      isActive
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    )}
                  >
                    {trimName(name, 20)}
                    <span className={cn(
                      "inline-flex items-center justify-center rounded-full w-4 h-4 text-[10px] font-bold",
                      isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {error && <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg mb-4">{error}</p>}

      {/* Bugs table */}
      <div className="border border-border rounded-xl overflow-hidden bg-card">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/20 gap-2">
          <div className="flex items-center gap-1 overflow-x-auto min-w-0">
            {TAB_KEYS.map((tab) => {
              const count = tabCount(tab);
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => { setActiveTab(tab); setSummaryFilter(null); setTesterFilter(null); }}
                  className={cn(
                    "shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  )}
                >
                  {tab}
                  <span className={cn(
                    "inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none min-w-[18px]",
                    isActive ? "bg-white/25 text-primary-foreground" : "bg-muted text-muted-foreground"
                  )}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <Button
            size="sm"
            onClick={openNewBug}
            className={cn("shrink-0", role === "tester" ? "bg-primary hover:bg-primary/90 gap-1.5" : "gap-1.5")}
            variant={role === "admin" ? "outline" : "default"}
          >
            <Plus className="w-3.5 h-3.5" />
            {role === "tester" ? "Report Bug" : "Add Row"}
          </Button>
        </div>

        <div className="px-3 py-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search by title or description…"
              value={bugSearch}
              onChange={(e) => setBugSearch(e.target.value)}
              className="w-full h-8 pl-8 pr-3 text-sm bg-muted/40 border border-border rounded-md placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors"
            />
            {bugSearch && (
              <button
                onClick={() => setBugSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/20">
              <TableHead className="pl-5">Bug Title</TableHead>
              <TableHead>Tester</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Screenshots</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredBugs.map((bug) => {
              const isClosed = bug.status === "Closed" || (bug.status as string) === "Verified";
              const isInvalid = bug.status === "Invalid";
              return (
              <TableRow
                key={bug.bugId}
                className="cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => openBug(bug)}
              >
                <TableCell className={cn("pl-5 font-medium", isClosed ? "line-through text-muted-foreground" : isInvalid ? "text-red-500" : "text-foreground")}>{bug.title}</TableCell>
                <TableCell className={cn("text-sm", isClosed ? "line-through text-muted-foreground/60" : isInvalid ? "text-red-400" : "text-muted-foreground")}>{bug.reporterName ?? bug.reportedBy.slice(0, 8) + "…"}</TableCell>
                <TableCell className={cn("text-sm", isClosed ? "line-through text-muted-foreground/60" : isInvalid ? "text-red-400" : "text-muted-foreground")}>
                  {new Date(bug.createdAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {(bug.screenshots.length + bug.documents.length + (bug.videos?.length ?? 0)) > 0 ? (
                    <div className={cn("flex items-center gap-1 text-sm", isClosed ? "line-through text-muted-foreground/60" : isInvalid ? "text-red-400" : "text-muted-foreground")}>
                      <Image className="w-3.5 h-3.5" />
                      {bug.screenshots.length + bug.documents.length + (bug.videos?.length ?? 0)}
                    </div>
                  ) : (
                    <span className="text-muted-foreground/40 text-sm">—</span>
                  )}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {(() => {
                    const validTransitions = transitions[bug.status] ?? [];
                    const dropdownStatuses = ALL_STATUSES.includes(bug.status as BugStatus)
                      ? ALL_STATUSES
                      : [bug.status as BugStatus, ...ALL_STATUSES];
                    return (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                            STATUS_STYLES[bug.status]
                          )}
                        >
                          {(() => { const Icon = STATUS_ICONS[bug.status]; return <Icon className="w-3 h-3" />; })()}
                          {bug.status}
                          <ChevronDown className="w-3 h-3 opacity-60" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-44">
                          {dropdownStatuses.map((s) => {
                            const Icon = STATUS_ICONS[s];
                            const isCurrent = s === bug.status;
                            const isAllowed = validTransitions.includes(s);
                            const isInvalidStatus = s === "Invalid";
                            return (
                              <DropdownMenuItem
                                key={s}
                                disabled={isCurrent || !isAllowed}
                                onClick={() => isAllowed && handleStatusChange(bug.bugId, s)}
                                className={cn("gap-2", isInvalidStatus && "text-red-500 focus:text-red-500")}
                              >
                                <Icon className={cn("w-3.5 h-3.5 shrink-0", isInvalidStatus ? "text-red-500" : STATUS_ICON_COLORS[s])} />
                                <span className={isCurrent ? "font-semibold" : ""}>{s}</span>
                                {isCurrent && <Check className="w-3 h-3 ml-auto opacity-70" />}
                              </DropdownMenuItem>
                            );
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    );
                  })()}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); openBug(bug); }}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                      title="View bug"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => openEditBug(e, bug)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                      title="Edit bug"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => handleDeleteBug(e, bug)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title="Delete bug"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
            {filteredBugs.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  {searchQuery ? `No bugs match "${bugSearch}".` : activeTab === "All" ? "No bugs reported yet." : `No ${activeTab.toLowerCase()} bugs.`}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </div>{/* /overflow-x-auto */}
      </div>{/* /card */}

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
                <Label htmlFor="bug-title">Bug Title</Label>
                <Input id="bug-title" placeholder="Short description of the issue"
                  value={newBugTitle} onChange={(e) => setNewBugTitle(e.target.value)} autoFocus required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bug-desc">Description</Label>
                <textarea id="bug-desc"
                  className="w-full min-h-24 rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Steps to reproduce, expected vs actual behaviour..."
                  value={newBugDesc} onChange={(e) => setNewBugDesc(e.target.value)} />
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
                        onClick={() => openLightbox(selectedBug.screenshots, i)}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border text-sm text-foreground hover:bg-muted/30 hover:border-primary/30 transition-colors group"
                      >
                        <Image className="w-4 h-4 text-primary shrink-0" />
                        <span className="truncate flex-1 text-left">{trimName(key.split("/").pop()?.split("_").slice(1).join("_") || key.split("/").pop() || key)}</span>
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
                      const filename = key.split("/").pop()?.split("_").slice(1).join("_") || key.split("/").pop() || key;
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
                        <span className="truncate">{trimName(key.split("/").pop()?.split("_").slice(1).join("_") || key.split("/").pop() || key)}</span>
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
                <Label htmlFor="edit-title">Title</Label>
                <Input
                  id="edit-title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-desc">Description</Label>
                <textarea
                  id="edit-desc"
                  className="w-full min-h-24 rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
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
                            {trimName(key.split("/").pop()?.split("_").slice(1).join("_") || key.split("/").pop() || key)}
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
                            {trimName(key.split("/").pop()?.split("_").slice(1).join("_") || key.split("/").pop() || key)}
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
      <Dialog open={deleteConfirm.open} onOpenChange={(o) => !deleting && setDeleteConfirm({ open: o, bug: o ? deleteConfirm.bug : null })}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete bug?</DialogTitle>
          </DialogHeader>
          <div className="mt-1 space-y-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-destructive/10 rounded-xl flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="font-semibold text-foreground text-sm">{deleteConfirm.bug?.title}</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  This bug and all its screenshots will be permanently deleted. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setDeleteConfirm({ open: false, bug: null })} disabled={deleting}>
                Cancel
              </Button>
              <Button
                variant="outline"
                className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                onClick={confirmDeleteBug}
                disabled={deleting}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Status Guide Dialog */}
      <Dialog open={statusInfoOpen} onOpenChange={setStatusInfoOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="w-4 h-4 text-muted-foreground" />
              Bug Status Guide
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            {[
              {
                status: "Open" as BugStatus,
                who: "Tester",
                desc: "Tester has reported a bug that hasn't been fixed yet. The developer needs to investigate.",
              },
              {
                status: "Fixed" as BugStatus,
                who: "Developer",
                desc: "Developer has fixed the bug and is asking the tester to verify the fix.",
              },
              {
                status: "Closed" as BugStatus,
                who: "Tester",
                desc: "Tester has verified the fix and confirmed the bug is fully resolved.",
              },
              {
                status: "Invalid" as BugStatus,
                who: "Developer",
                desc: "Developer has determined this is not a valid bug — cannot reproduce, out of scope, or working as intended.",
              },
            ].map(({ status, who, desc }) => {
              const Icon = STATUS_ICONS[status] as React.FC<{ className?: string }>;
              return (
                <div key={status} className="flex items-start gap-3 p-3 rounded-lg border border-border">
                  <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 mt-0.5", STATUS_STYLES[status])}>
                    <Icon className="w-3 h-3" />
                    {status}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-muted-foreground mb-0.5">Set by {who}</p>
                    <p className="text-sm text-foreground leading-snug">{desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Report Viewer */}
      {reportViewer && createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setReportViewer(null)}
        >
          <div
            className="bg-background rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="font-semibold text-sm text-foreground truncate">{reportViewer.filename}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={reportViewer.url}
                  download={reportViewer.filename}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border text-foreground hover:bg-muted/40 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </a>
                <button
                  onClick={() => setReportViewer(null)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              {reportViewer.textContent !== undefined ? (
                (() => {
                  const isMd = reportViewer.filename.toLowerCase().endsWith(".md");
                  return isMd ? (
                    <div className="max-w-4xl mx-auto px-8 py-6 text-sm leading-7 text-foreground">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          h1: ({ children }) => <h1 className="text-2xl font-bold mt-6 mb-4 pb-2 border-b border-border">{children}</h1>,
                          h2: ({ children }) => <h2 className="text-xl font-bold mt-6 mb-3 pb-2 border-b border-border">{children}</h2>,
                          h3: ({ children }) => <h3 className="text-lg font-semibold mt-5 mb-2">{children}</h3>,
                          h4: ({ children }) => <h4 className="text-base font-semibold mt-4 mb-2">{children}</h4>,
                          p: ({ children }) => <p className="mb-4">{children}</p>,
                          pre: ({ children }) => <pre className="bg-muted rounded-lg p-4 overflow-x-auto mb-4 text-xs font-mono">{children}</pre>,
                          code: ({ className, children }) => className
                            ? <code className={cn("font-mono text-xs", className)}>{children}</code>
                            : <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>,
                          ul: ({ children }) => <ul className="mb-4 ml-5 list-disc space-y-1">{children}</ul>,
                          ol: ({ children }) => <ol className="mb-4 ml-5 list-decimal space-y-1">{children}</ol>,
                          li: ({ children }) => <li className="leading-7">{children}</li>,
                          blockquote: ({ children }) => <blockquote className="border-l-4 border-border pl-4 text-muted-foreground my-4">{children}</blockquote>,
                          a: ({ href, children }) => <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                          table: ({ children }) => <div className="overflow-x-auto mb-4"><table className="w-full border-collapse border border-border text-sm">{children}</table></div>,
                          thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
                          tr: ({ children }) => <tr className="border-b border-border">{children}</tr>,
                          th: ({ children }) => <th className="px-3 py-2 text-left font-semibold border-r border-border last:border-r-0">{children}</th>,
                          td: ({ children }) => <td className="px-3 py-2 border-r border-border last:border-r-0">{children}</td>,
                          hr: () => <hr className="my-6 border-border" />,
                          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                          em: ({ children }) => <em className="italic">{children}</em>,
                        }}
                      >
                        {reportViewer.textContent}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <pre className="p-6 text-sm font-mono text-foreground whitespace-pre-wrap break-words">{reportViewer.textContent}</pre>
                  );
                })()
              ) : reportViewer.contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? (
                <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
                  <FileText className="w-12 h-12 opacity-30" />
                  <p className="text-sm">Preview not available for .docx files.</p>
                  <a
                    href={reportViewer.url}
                    download={reportViewer.filename}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Download to view
                  </a>
                </div>
              ) : (
                <iframe
                  src={reportViewer.url}
                  title={reportViewer.filename}
                  className="w-full h-full border-0"
                />
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Video Player */}
      {videoPlayer && createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/90 flex flex-col items-center justify-center p-4"
          onClick={() => setVideoPlayer(null)}
        >
          <button
            onClick={() => setVideoPlayer(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <div
            className="flex flex-col items-center gap-3 w-full max-w-4xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-white/70 text-sm">{videoPlayer.filename}</p>
            <video
              src={videoPlayer.url}
              controls
              autoPlay
              className="max-w-full max-h-[80vh] rounded-lg shadow-2xl"
            />
          </div>
        </div>,
        document.body
      )}

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

      {/* Screenshot Lightbox (carousel) — portal to escape stacking context */}
      {lightboxOpen && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/90"
          onClick={closeLightbox}
        >
          {/* Close */}
          <button
            onClick={closeLightbox}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Prev */}
          {lightboxScreenshots.length > 1 && lightboxIndex > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); navigateLightbox(lightboxIndex - 1); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          {/* Next */}
          {lightboxScreenshots.length > 1 && lightboxIndex < lightboxScreenshots.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); navigateLightbox(lightboxIndex + 1); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}

          {/* Image area */}
          <div
            className="flex items-center justify-center w-full h-full p-16"
            onClick={(e) => e.stopPropagation()}
          >
            {lightboxLoading ? (
              <div className="w-8 h-8 rounded-full border-2 border-white border-t-transparent animate-spin" />
            ) : lightboxUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={lightboxUrl}
                alt={lightboxFilename}
                className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
              />
            ) : null}
          </div>

          {/* Counter + Download */}
          <div className="absolute bottom-6 flex items-center gap-4">
            {lightboxScreenshots.length > 1 && (
              <span className="text-white/60 text-sm">{lightboxIndex + 1} / {lightboxScreenshots.length}</span>
            )}
            {lightboxUrl && (
              <a
                href={lightboxUrl}
                download={lightboxFilename}
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
      )}
    </div>
  );
}

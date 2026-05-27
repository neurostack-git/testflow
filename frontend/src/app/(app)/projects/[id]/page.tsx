"use client";

import { useEffect, useState, useCallback } from "react";
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
  ArrowLeft, Plus, ChevronDown, FileText, Image, X, Upload,
  UserPlus, Pencil, Download, Trash2, Eye, AlertTriangle,
  CircleDot, CheckCircle2, BadgeCheck, RotateCcw,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  projectsApi, bugsApi, attachmentsApi, authApi, uploadToS3,
  type Project, type Bug, type BugStatus, type ProjectReport,
} from "@/lib/api";
import { useAuth } from "@/context/auth-context";

const STATUS_STYLES: Record<BugStatus, string> = {
  Open: "bg-blue-100 text-blue-700 hover:bg-blue-200",
  Fixed: "bg-green-100 text-green-700 hover:bg-green-200",
  Verified: "bg-purple-100 text-purple-700 hover:bg-purple-200",
  Reopen: "bg-red-100 text-red-700 hover:bg-red-200",
};

const ALL_STATUSES: BugStatus[] = ["Open", "Fixed", "Verified", "Reopen"];

const STATUS_ICONS = {
  Open: CircleDot,
  Fixed: CheckCircle2,
  Verified: BadgeCheck,
  Reopen: RotateCcw,
} as const;

const STATUS_ICON_COLORS: Record<BugStatus, string> = {
  Open: "text-blue-600",
  Fixed: "text-green-600",
  Verified: "text-purple-600",
  Reopen: "text-red-600",
};

const ALL_TRANSITIONS: Record<BugStatus, BugStatus[]> = {
  Open: ["Fixed", "Verified", "Reopen"],
  Fixed: ["Open", "Verified", "Reopen"],
  Verified: ["Open", "Fixed", "Reopen"],
  Reopen: ["Open", "Fixed", "Verified"],
};
const ADMIN_TRANSITIONS = ALL_TRANSITIONS;
const TESTER_TRANSITIONS = ALL_TRANSITIONS;

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

  // Screenshot lightbox
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxFilename, setLightboxFilename] = useState<string>("");
  const [lightboxLoading, setLightboxLoading] = useState(false);

  // Invite tester dialog
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);

  // Reports
  const [stagedReports, setStagedReports] = useState<File[]>([]);
  const [uploadingReports, setUploadingReports] = useState(false);
  const [reportError, setReportError] = useState("");

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
      setBugs(bugsRes.bugs);
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
    setDialogOpen(true);
  }

  function handleFileAdd(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    setNewBugFiles((prev) => [...prev, ...files].slice(0, 6));
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

      for (const file of newBugFiles) {
        const { presignedUrl, s3Key } = await attachmentsApi.presign({
          filename: file.name,
          contentType: file.type,
          projectId,
        });
        await uploadToS3(presignedUrl, file);
        if (file.type.startsWith("image/")) {
          screenshots.push(s3Key);
        } else {
          documents.push(s3Key);
        }
      }

      const newBug = await bugsApi.create(projectId, {
        title: newBugTitle.trim(),
        description: newBugDesc.trim(),
        screenshots,
        documents,
      });

      setBugs((prev) => [{ ...newBug, reporterName: user?.name ?? "" }, ...prev]);
      setDialogOpen(false);
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

      const updated = await bugsApi.update(projectId, editBug.bugId, {
        title: editTitle.trim(),
        description: editDesc.trim(),
        status: editStatus !== editBug.status ? editStatus : undefined,
        screenshots: [...editScreenshots, ...uploadedKeys],
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

  // ── Screenshot lightbox ──────────────────────────────────────────────────
  async function openLightbox(key: string) {
    setLightboxKey(key);
    setLightboxUrl(null);
    setLightboxLoading(true);
    try {
      const { url, filename } = await attachmentsApi.viewUrl(key);
      setLightboxUrl(url);
      setLightboxFilename(filename);
    } catch {
      setLightboxKey(null);
    } finally {
      setLightboxLoading(false);
    }
  }

  function closeLightbox() {
    setLightboxKey(null);
    setLightboxUrl(null);
    setLightboxFilename("");
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
  const totalReportCount = reports.length + stagedReports.length;
  const reportsAtMax = totalReportCount >= 5;

  function handleReportFileAdd(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    setStagedReports((prev) => {
      const combined = [...prev, ...files];
      const remaining = 5 - reports.length;
      return combined.slice(0, remaining);
    });
    e.target.value = "";
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
    // tester: current status + valid transitions from current
    const possible = TESTER_TRANSITIONS[bug.status] ?? [];
    return [bug.status, ...possible];
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
      </div>
      <div className="flex items-center justify-between mb-8">
        <p className="text-muted-foreground ml-7">{bugs.length} bug{bugs.length !== 1 ? "s" : ""}</p>
        {role === "tester" && project?.adminName && (
          <p className="text-sm text-muted-foreground">
            Developer: <span className="font-medium text-foreground">{project.adminName}</span>
          </p>
        )}
      </div>

      {error && <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg mb-4">{error}</p>}

      {/* Bugs table */}
      <div className="border border-border rounded-xl overflow-x-auto bg-card">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
          <span className="text-sm font-medium text-muted-foreground">{bugs.length} bugs</span>
          <Button
            size="sm"
            onClick={openNewBug}
            className={role === "tester" ? "bg-primary hover:bg-primary/90 gap-1.5" : "gap-1.5"}
            variant={role === "admin" ? "outline" : "default"}
          >
            <Plus className="w-3.5 h-3.5" />
            {role === "tester" ? "Report Bug" : "Add Row"}
          </Button>
        </div>

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
            {bugs.map((bug) => {
              const isVerified = bug.status === "Verified";
              return (
              <TableRow
                key={bug.bugId}
                className="cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => openBug(bug)}
              >
                <TableCell className={cn("pl-5 font-medium", isVerified ? "line-through text-muted-foreground" : "text-foreground")}>{bug.title}</TableCell>
                <TableCell className={cn("text-sm", isVerified ? "line-through text-muted-foreground/60" : "text-muted-foreground")}>{bug.reporterName ?? bug.reportedBy.slice(0, 8) + "…"}</TableCell>
                <TableCell className={cn("text-sm", isVerified ? "line-through text-muted-foreground/60" : "text-muted-foreground")}>
                  {new Date(bug.createdAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {(bug.screenshots.length + bug.documents.length) > 0 ? (
                    <div className={cn("flex items-center gap-1 text-sm", isVerified ? "line-through text-muted-foreground/60" : "text-muted-foreground")}>
                      <Image className="w-3.5 h-3.5" />
                      {bug.screenshots.length + bug.documents.length}
                    </div>
                  ) : (
                    <span className="text-muted-foreground/40 text-sm">—</span>
                  )}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {transitions[bug.status].length > 0 ? (
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
                      <DropdownMenuContent align="start" className="w-40">
                        {transitions[bug.status].map((s) => {
                          const Icon = STATUS_ICONS[s];
                          return (
                            <DropdownMenuItem key={s} onClick={() => handleStatusChange(bug.bugId, s)} className="gap-2">
                              <Icon className={cn("w-3.5 h-3.5 shrink-0", STATUS_ICON_COLORS[s])} />
                              {s}
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium", STATUS_STYLES[bug.status])}>
                      {(() => { const Icon = STATUS_ICONS[bug.status]; return <Icon className="w-3 h-3" />; })()}
                      {bug.status}
                    </span>
                  )}
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
            {bugs.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  No bugs reported yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Reports section */}
      <div className="mt-8 border border-border rounded-xl overflow-hidden bg-card">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">Overall Report</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
              {reports.length}/5
            </span>
          </div>
          <div className="relative">
            <label
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer",
                reportsAtMax
                  ? "border-border text-muted-foreground/50 cursor-not-allowed bg-muted/20"
                  : "border-border text-foreground hover:bg-muted/40"
              )}
              title={reportsAtMax ? "Max 5 files" : undefined}
            >
              <Plus className="w-3.5 h-3.5" />
              {reportsAtMax ? "Max 5" : "Add Files"}
              <input
                type="file"
                multiple
                accept={REPORT_ACCEPT}
                className="hidden"
                disabled={reportsAtMax}
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
                <Label>Screenshots <span className="text-muted-foreground font-normal">(max 6, images only)</span></Label>
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
                      <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-muted/40 text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <Image className="w-4 h-4 text-primary shrink-0" />
                          <span className="truncate">{file.name}</span>
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
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" className="bg-primary hover:bg-primary/90" disabled={submitting}>
                  {submitting ? "Submitting…" : "Submit Bug"}
                </Button>
              </div>
            </form>
          ) : selectedBug ? (
            <div className="space-y-5 mt-2">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold text-foreground text-base leading-snug">{selectedBug.title}</h3>
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
                        return (
                          <DropdownMenuItem key={s} onClick={() => handleStatusChange(selectedBug.bugId, s)} className="gap-2">
                            <Icon className={cn("w-3.5 h-3.5 shrink-0", STATUS_ICON_COLORS[s])} />
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
              <div className="flex gap-6 text-sm text-muted-foreground">
                <span>Reported: <strong className="text-foreground">{new Date(selectedBug.createdAt).toLocaleDateString()}</strong></span>
                <span>Updated: <strong className="text-foreground">{new Date(selectedBug.updatedAt).toLocaleDateString()}</strong></span>
              </div>
              {selectedBug.description && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Description</p>
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{selectedBug.description}</p>
                </div>
              )}
              {selectedBug.screenshots.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Screenshots ({selectedBug.screenshots.length})
                  </p>
                  <div className="space-y-2">
                    {selectedBug.screenshots.map((key, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => openLightbox(key)}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border text-sm text-foreground hover:bg-muted/30 transition-colors group"
                      >
                        <Image className="w-4 h-4 text-primary shrink-0" />
                        <span className="truncate flex-1 text-left">{key.split("/").pop()?.split("_").slice(1).join("_") || key.split("/").pop()}</span>
                        <span className="text-xs font-semibold text-primary shrink-0 group-hover:underline">View</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {selectedBug.documents.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Documents ({selectedBug.documents.length})
                  </p>
                  <div className="space-y-2">
                    {selectedBug.documents.map((key, i) => (
                      <div key={i} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border text-sm text-foreground">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        {key.split("/").pop()}
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
                          ? s === "Open" && "bg-blue-100 text-blue-700 border-blue-300"
                            || s === "Fixed" && "bg-green-100 text-green-700 border-green-300"
                            || s === "Verified" && "bg-purple-100 text-purple-700 border-purple-300"
                            || "bg-red-100 text-red-700 border-red-300"
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
                      <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-muted/40 text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <Image className="w-4 h-4 text-primary shrink-0" />
                          <span className="truncate text-sm">
                            {key.split("/").pop()?.split("_").slice(1).join("_") || key.split("/").pop()}
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
                          <span className="truncate">{file.name}</span>
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

      {/* Screenshot Lightbox */}
      {lightboxKey && (
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/90"
          onClick={closeLightbox}
        >
          {/* Close button */}
          <button
            onClick={closeLightbox}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
          >
            <X className="w-5 h-5" />
          </button>

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

          {/* Download button */}
          {lightboxUrl && (
            <div className="absolute bottom-6 flex items-center gap-3">
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}

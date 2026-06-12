"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ArrowLeft, UserPlus, FileText, Image, Video, Info,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  projectsApi, bugsApi, attachmentsApi,
  type Project, type Bug, type BugStatus,
} from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { ChatDrawer } from "@/components/chat/ChatDrawer";
import { MessageCircle } from "lucide-react";
import { trimName, displayFilename } from "@/lib/filenames";
import { ADMIN_TRANSITIONS, TESTER_TRANSITIONS } from "@/lib/bug-status";
import { StatusGuideDialog } from "@/components/projects/StatusGuideDialog";
import { VideoPlayer } from "@/components/projects/VideoPlayer";
import { DeleteBugDialog } from "@/components/projects/DeleteBugDialog";
import { Lightbox } from "@/components/projects/Lightbox";
import { SummaryStats } from "@/components/projects/SummaryStats";
import { BugTable } from "@/components/projects/BugTable";
import { BugCreateDialog } from "@/components/projects/BugCreateDialog";
import { BugEditDialog } from "@/components/projects/BugEditDialog";
import { ProjectReportsSection } from "@/components/projects/ProjectReportsSection";
import { InviteTesterDialog } from "@/components/projects/InviteTesterDialog";
import { StatusBadge } from "@/components/projects/StatusBadge";
import { Spinner } from "@/components/ui/spinner";
import { ErrorAlert } from "@/components/ui/error-alert";

export default function ProjectDetailPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const { user } = useAuth();

  // Core data
  const [project, setProject] = useState<Project | null>(null);
  const [bugs, setBugs] = useState<Bug[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Bug detail dialog (read-only view)
  const [selectedBug, setSelectedBug] = useState<Bug | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Bug create dialog
  const [createOpen, setCreateOpen] = useState(false);

  // Bug edit dialog
  const [editBug, setEditBug] = useState<Bug | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  // Delete bug confirm dialog
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; bug: Bug | null }>({ open: false, bug: null });
  const [deleting, setDeleting] = useState(false);

  // Invite tester dialog
  const [inviteOpen, setInviteOpen] = useState(false);

  // Screenshot lightbox
  const [lightbox, setLightbox] = useState<{ screenshots: string[]; index: number } | null>(null);

  // Video player (for bug detail view)
  const [videoPlayer, setVideoPlayer] = useState<{ url: string; filename: string } | null>(null);
  const [videoPlayerLoading, setVideoPlayerLoading] = useState<string | null>(null);

  // Status info dialog
  const [statusInfoOpen, setStatusInfoOpen] = useState(false);

  // Status tab + summary/tester filters
  const [activeTab, setActiveTab] = useState("All");
  const [summaryFilter, setSummaryFilter] = useState<"unsolved" | "today" | null>(null);
  const [testerFilter, setTesterFilter] = useState<string | null>(null);

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

  const role = user?.role ?? "tester";
  const transitions = role === "admin" ? ADMIN_TRANSITIONS : TESTER_TRANSITIONS;

  const loadData = useCallback(async () => {
    if (!projectId) return;
    try {
      const [proj, bugsRes] = await Promise.all([
        projectsApi.get(projectId),
        bugsApi.list(projectId),
      ]);
      setProject(proj);
      setBugs([...bugsRes.bugs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    } catch {
      setError("Failed to load project");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Status change (quick dropdown in table / detail view) ────────────────
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

  // ── Video player (for bug detail) ────────────────────────────────────────
  async function openVideoPlayer(key: string) {
    setVideoPlayerLoading(key);
    try {
      const { url, filename } = await attachmentsApi.viewUrl(key, true);
      setVideoPlayer({ url, filename });
    } catch {
      setError("Failed to load video");
    } finally {
      setVideoPlayerLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <Spinner size="lg" />
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

      <ErrorAlert message={error} className="mb-4" />

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
        onOpenBug={(bug) => { setSelectedBug(bug); setDialogOpen(true); }}
        onOpenNewBug={() => setCreateOpen(true)}
        onEditBug={(e, bug) => { e.stopPropagation(); setEditBug(bug); setEditOpen(true); }}
        onDeleteBug={handleDeleteBug}
        onStatusChange={handleStatusChange}
      />

      {/* Reports section */}
      <ProjectReportsSection projectId={projectId} />

      {/* Invite Tester Dialog */}
      <InviteTesterDialog open={inviteOpen} projectId={projectId} onOpenChange={setInviteOpen} />

      {/* Bug Create Dialog */}
      <BugCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={projectId}
        reporterName={user?.name ?? ""}
        onCreated={(bug) => setBugs((prev) => [bug, ...prev])}
      />

      {/* Bug Edit Dialog */}
      <BugEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        bug={editBug}
        projectId={projectId}
        role={role}
        onUpdated={(updated) => {
          setBugs((prev) => prev.map((b) => b.bugId === updated.bugId ? updated : b));
          if (selectedBug?.bugId === updated.bugId) setSelectedBug(updated);
        }}
      />

      {/* Bug detail dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bug Details</DialogTitle>
          </DialogHeader>

          {selectedBug && (
            <div className="space-y-4 mt-1">
              {/* Title + status */}
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-bold text-foreground text-lg leading-snug">{selectedBug.title}</h3>
                <StatusBadge
                  status={selectedBug.status}
                  validTransitions={transitions[selectedBug.status]}
                  onStatusChange={(s) => handleStatusChange(selectedBug.bugId, s)}
                  dropdownAlign="end"
                />
              </div>

              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                {selectedBug.reporterName && <span>{selectedBug.reporterName}</span>}
                {selectedBug.reporterName && <span className="w-0.5 h-3 bg-border rounded-full inline-block" />}
                <span>Reported {new Date(selectedBug.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                <span className="w-0.5 h-3 bg-border rounded-full inline-block" />
                <span>Updated {new Date(selectedBug.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
              </div>

              {/* Description */}
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
                      <button key={i} type="button"
                        onClick={() => setLightbox({ screenshots: selectedBug.screenshots, index: i })}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border text-sm text-foreground hover:bg-muted/30 hover:border-primary/30 transition-colors group">
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
                        <button key={i} type="button" onClick={() => openVideoPlayer(key)}
                          disabled={videoPlayerLoading === key}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border text-sm text-foreground hover:bg-muted/30 hover:border-primary/30 transition-colors group">
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

      {/* Video Player */}
      <VideoPlayer video={videoPlayer} onClose={() => setVideoPlayer(null)} />

      {/* Floating chat bubble + drawer */}
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

      {/* Screenshot Lightbox */}
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

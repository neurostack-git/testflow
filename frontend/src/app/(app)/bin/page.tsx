"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trash2, RotateCcw, FolderOpen, AlertTriangle } from "lucide-react";
import { projectsApi, type Project } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { canRestoreProject } from "@/lib/permissions";
import { Spinner } from "@/components/ui/spinner";

export default function BinPage() {
  const { role } = useAuth();
  const canManage = canRestoreProject(role);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; projectId: string; title: string }>({
    open: false, projectId: "", title: "",
  });
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    projectsApi.listBin()
      .then((res) => setProjects(res.projects))
      .catch(() => setError("Failed to load bin"))
      .finally(() => setLoading(false));
  }, []);

  async function handleRestore(projectId: string) {
    try {
      await projectsApi.restore(projectId);
      setProjects((prev) => prev.filter((p) => p.projectId !== projectId));
    } catch {
      setError("Failed to restore project");
    }
  }

  async function confirmPermanentDelete() {
    setDeleting(true);
    try {
      await projectsApi.permanentDelete(deleteConfirm.projectId);
      setProjects((prev) => prev.filter((p) => p.projectId !== deleteConfirm.projectId));
      setDeleteConfirm({ open: false, projectId: "", title: "" });
    } catch {
      setError("Failed to permanently delete project");
    } finally {
      setDeleting(false);
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
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Bin</h1>
        <p className="text-muted-foreground mt-0.5">Deleted projects</p>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg mb-6">{error}</p>
      )}

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-14 h-14 bg-muted/50 rounded-2xl flex items-center justify-center mb-4">
            <Trash2 className="w-7 h-7 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Bin is empty</h3>
          <p className="text-muted-foreground mt-1">Deleted projects will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((project) => (
            <div
              key={project.projectId}
              className="border border-border rounded-xl bg-card p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 bg-muted/50 rounded-xl flex items-center justify-center shrink-0">
                  <FolderOpen className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">{project.title}</p>
                  <p className="text-sm text-muted-foreground">
                    Deleted {project.deletedAt ? new Date(project.deletedAt).toLocaleDateString() : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => handleRestore(project.projectId)}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Restore
                </Button>
                {canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => setDeleteConfirm({ open: true, projectId: project.projectId, title: project.title })}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Permanent Delete Confirmation Dialog */}
      <Dialog open={deleteConfirm.open} onOpenChange={(o) => !deleting && setDeleteConfirm({ open: o, projectId: "", title: "" })}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete permanently?</DialogTitle>
          </DialogHeader>
          <div className="mt-1 space-y-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-destructive/10 rounded-xl flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="font-semibold text-foreground text-sm">{deleteConfirm.title}</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  All bugs, screenshots, and data will be permanently lost. This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setDeleteConfirm({ open: false, projectId: "", title: "" })}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                onClick={confirmPermanentDelete}
                disabled={deleting}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                {deleting ? "Deleting…" : "Delete forever"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

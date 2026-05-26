"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, RotateCcw, FolderOpen } from "lucide-react";
import { projectsApi, type Project } from "@/lib/api";
import { useAuth } from "@/context/auth-context";

export default function BinPage() {
  const { user } = useAuth();
  const role = user?.role ?? "tester";

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  async function handlePermanentDelete(projectId: string, title: string) {
    if (!confirm(`Permanently delete "${title}"? All bugs and data will be lost. This cannot be undone.`)) return;
    try {
      await projectsApi.permanentDelete(projectId);
      setProjects((prev) => prev.filter((p) => p.projectId !== projectId));
    } catch {
      setError("Failed to permanently delete project");
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div className="w-7 h-7 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-8">
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
              className="border border-border rounded-xl bg-card p-5 flex items-center justify-between gap-4"
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
                {role === "admin" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => handlePermanentDelete(project.projectId, project.title)}
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
    </div>
  );
}

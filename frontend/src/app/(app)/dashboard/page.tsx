"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, FolderOpen, Bug, Trash2 } from "lucide-react";
import Link from "next/link";
import { projectsApi, type Project } from "@/lib/api";
import { useAuth } from "@/context/auth-context";

export default function DashboardPage() {
  const { user } = useAuth();
  const role = user?.role ?? "tester";

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const [binConfirm, setBinConfirm] = useState<{ open: boolean; projectId: string; title: string }>({
    open: false, projectId: "", title: "",
  });
  const [binning, setBinning] = useState(false);

  useEffect(() => {
    projectsApi.list()
      .then((res) => setProjects(res.projects))
      .catch(() => setError("Failed to load projects"))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const project = await projectsApi.create(newTitle.trim());
      setProjects((prev) => [project, ...prev]);
      setNewTitle("");
      setOpen(false);
    } catch {
      setError("Failed to create project");
    } finally {
      setCreating(false);
    }
  }

  async function confirmSoftDelete() {
    setBinning(true);
    try {
      await projectsApi.softDelete(binConfirm.projectId);
      setProjects((prev) => prev.filter((p) => p.projectId !== binConfirm.projectId));
      setBinConfirm({ open: false, projectId: "", title: "" });
    } catch {
      setError("Failed to move project to bin");
    } finally {
      setBinning(false);
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
    <div className="p-4 sm:p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-0.5">
            {projects.length} project{projects.length !== 1 ? "s" : ""}
          </p>
        </div>
        {role === "admin" && (
          <Button onClick={() => setOpen(true)} className="bg-primary hover:bg-primary/90 gap-2">
            <Plus className="w-4 h-4" />
            New Project
          </Button>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg mb-6">{error}</p>
      )}

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mb-4">
            <FolderOpen className="w-7 h-7 text-primary" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">No projects yet</h3>
          {role === "admin" ? (
            <>
              <p className="text-muted-foreground mt-1 mb-6">Create your first project to start tracking bugs.</p>
              <Button onClick={() => setOpen(true)} className="bg-primary hover:bg-primary/90 gap-2">
                <Plus className="w-4 h-4" />
                New Project
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground mt-1">You haven&apos;t been added to any projects yet.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {projects.map((project) => (
            <div key={project.projectId} className="relative group">
              <Link href={`/projects/${project.projectId}`} className="block">
                <Card className="p-5 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer">
                  <div className="mb-4">
                    <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center group-hover:bg-primary/15 transition-colors">
                      <Bug className="w-5 h-5 text-primary" />
                    </div>
                  </div>
                  <h3 className="font-semibold text-foreground text-base mb-1 group-hover:text-primary transition-colors">
                    {project.title}
                  </h3>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-sm text-muted-foreground">
                      {project.testerCount ?? 0} tester{(project.testerCount ?? 0) !== 1 ? "s" : ""}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {new Date(project.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </Card>
              </Link>
              {role === "admin" && (
                <button
                  onClick={() => setBinConfirm({ open: true, projectId: project.projectId, title: project.title })}
                  className="absolute top-3 right-3 z-10 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                  title="Move to bin"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* New Project Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="title">Project title</Label>
              <Input
                id="title"
                placeholder="e.g. Data Quality Feature"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-primary hover:bg-primary/90" disabled={creating}>
                {creating ? "Creating…" : "Create Project"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Move to Bin Confirmation Dialog */}
      <Dialog open={binConfirm.open} onOpenChange={(o) => !binning && setBinConfirm({ open: o, projectId: "", title: "" })}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Move to Bin?</DialogTitle>
          </DialogHeader>
          <div className="mt-1 space-y-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-muted rounded-xl flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="font-semibold text-foreground text-sm">{binConfirm.title}</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  This project will be moved to the Bin. You can restore it anytime.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setBinConfirm({ open: false, projectId: "", title: "" })} disabled={binning}>
                Cancel
              </Button>
              <Button
                variant="outline"
                className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                onClick={confirmSoftDelete}
                disabled={binning}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                {binning ? "Moving…" : "Move to Bin"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

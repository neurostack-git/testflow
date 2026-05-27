"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserPlus, Trash2, Users, ChevronRight, ChevronDown } from "lucide-react";
import { projectsApi, authApi, type Project, type Member } from "@/lib/api";

export default function AdminPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<Record<string, Member[]>>({});
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [inviteDialog, setInviteDialog] = useState<{ open: boolean; projectId: string | null }>({ open: false, projectId: null });
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    projectsApi.list()
      .then((res) => setProjects(res.projects))
      .finally(() => setLoadingProjects(false));
  }, []);

  const loadMembers = useCallback(async (projectId: string) => {
    if (members[projectId]) return;
    setLoadingMembers((prev) => ({ ...prev, [projectId]: true }));
    try {
      const res = await projectsApi.listMembers(projectId);
      setMembers((prev) => ({ ...prev, [projectId]: res.members }));
      setProjects((prev) =>
        prev.map((p) =>
          p.projectId === projectId ? { ...p, testerCount: res.members.length } : p
        )
      );
    } finally {
      setLoadingMembers((prev) => ({ ...prev, [projectId]: false }));
    }
  }, [members]);

  function toggleExpand(id: string) {
    if (expanded === id) {
      setExpanded(null);
    } else {
      setExpanded(id);
      loadMembers(id);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim() || !inviteDialog.projectId) return;
    setInviting(true);
    setError("");
    try {
      await authApi.inviteTester(inviteEmail.trim(), inviteDialog.projectId);
      // Refresh members for this project
      const pid = inviteDialog.projectId;
      setMembers((prev) => {
        const updated = { ...prev };
        delete updated[pid];
        return updated;
      });
      await loadMembers(pid);
      // Update tester count on project card
      setProjects((prev) =>
        prev.map((p) =>
          p.projectId === pid
            ? { ...p, testerCount: (p.testerCount ?? 0) + 1 }
            : p
        )
      );
      setInviteEmail("");
      setInviteDialog({ open: false, projectId: null });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to invite tester");
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(projectId: string, memberId: string) {
    try {
      await projectsApi.removeMember(projectId, memberId);
      setMembers((prev) => ({
        ...prev,
        [projectId]: (prev[projectId] ?? []).filter((m) => m.memberId !== memberId),
      }));
      setProjects((prev) =>
        prev.map((p) =>
          p.projectId === projectId
            ? { ...p, testerCount: Math.max(0, (p.testerCount ?? 1) - 1) }
            : p
        )
      );
    } catch {
      setError("Failed to remove tester");
    }
  }

  if (loadingProjects) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div className="w-7 h-7 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Admin</h1>
        <p className="text-muted-foreground mt-0.5">Manage projects and testers</p>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg mb-4">{error}</p>
      )}

      <div className="space-y-3">
        {projects.map((project) => (
          <div key={project.projectId} className="border border-border rounded-xl overflow-x-auto bg-card">
            <div
              className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-muted/40 transition-colors"
              onClick={() => toggleExpand(project.projectId)}
            >
              <div className="flex items-center gap-3">
                <button className="text-muted-foreground">
                  {expanded === project.projectId
                    ? <ChevronDown className="w-4 h-4" />
                    : <ChevronRight className="w-4 h-4" />}
                </button>
                <span className="font-semibold text-foreground">{project.title}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Users className="w-4 h-4" />
                  <span>{project.testerCount ?? 0} tester{(project.testerCount ?? 0) !== 1 ? "s" : ""}</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-primary border-primary/30 hover:bg-primary/5"
                  onClick={(e) => {
                    e.stopPropagation();
                    setInviteDialog({ open: true, projectId: project.projectId });
                  }}
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  Add Tester
                </Button>
              </div>
            </div>

            {expanded === project.projectId && (
              <div className="border-t border-border">
                {loadingMembers[project.projectId] ? (
                  <div className="flex justify-center py-6">
                    <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  </div>
                ) : (members[project.projectId] ?? []).length === 0 ? (
                  <div className="px-5 py-6 text-center text-sm text-muted-foreground">
                    No testers yet. Invite someone to get started.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="pl-14">Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Joined</TableHead>
                        <TableHead className="w-16" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(members[project.projectId] ?? []).map((tester) => (
                        <TableRow key={tester.memberId}>
                          <TableCell className="pl-14 font-medium">{tester.name}</TableCell>
                          <TableCell className="text-muted-foreground">{tester.email}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {tester.joinedAt ? new Date(tester.joinedAt).toLocaleDateString() : "—"}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="w-8 h-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              onClick={() => handleRemove(project.projectId, tester.memberId)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </div>
        ))}

        {projects.length === 0 && (
          <p className="text-center text-muted-foreground py-12">No projects yet. Create one from the Dashboard.</p>
        )}
      </div>

      <Dialog
        open={inviteDialog.open}
        onOpenChange={(o) => setInviteDialog({ open: o, projectId: o ? inviteDialog.projectId : null })}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite Tester</DialogTitle>
          </DialogHeader>
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
              <Button type="button" variant="outline" onClick={() => setInviteDialog({ open: false, projectId: null })}>
                Cancel
              </Button>
              <Button type="submit" className="bg-primary hover:bg-primary/90" disabled={inviting}>
                {inviting ? "Sending…" : "Send Invite"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

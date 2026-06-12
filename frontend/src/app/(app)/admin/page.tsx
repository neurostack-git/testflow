"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserPlus, Trash2, Users, ChevronRight, ChevronDown, AlertTriangle } from "lucide-react";
import { projectsApi, type Project, type Member } from "@/lib/api";
import { Spinner } from "@/components/ui/spinner";
import { ErrorAlert } from "@/components/ui/error-alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InviteTesterDialog } from "@/components/projects/InviteTesterDialog";

export default function AdminPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<Record<string, Member[]>>({});
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [inviteDialog, setInviteDialog] = useState<{ open: boolean; projectId: string }>({ open: false, projectId: "" });
  const [error, setError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; projectId: string; member: Member | null }>({ open: false, projectId: "", member: null });
  const [deleting, setDeleting] = useState(false);

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

  async function confirmDelete() {
    if (!deleteConfirm.member) return;
    setDeleting(true);
    setError("");
    try {
      await projectsApi.removeMember(deleteConfirm.projectId, deleteConfirm.member.memberId);
      const deletedId = deleteConfirm.member.memberId;
      setMembers((prev) => {
        const updated: Record<string, Member[]> = {};
        for (const [pid, list] of Object.entries(prev)) {
          updated[pid] = list.filter((m) => m.memberId !== deletedId);
        }
        return updated;
      });
      setProjects((prev) =>
        prev.map((p) => ({ ...p, testerCount: Math.max(0, (p.testerCount ?? 1) - 1) }))
      );
      setDeleteConfirm({ open: false, projectId: "", member: null });
    } catch {
      setError("Failed to delete tester");
    } finally {
      setDeleting(false);
    }
  }

  if (loadingProjects) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Admin</h1>
        <p className="text-muted-foreground mt-0.5">Manage projects and testers</p>
      </div>

      <ErrorAlert message={error} className="mb-4" />

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
                    <Spinner size="md" />
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
                              onClick={() => setDeleteConfirm({ open: true, projectId: project.projectId, member: tester })}
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

      <InviteTesterDialog
        open={inviteDialog.open}
        projectId={inviteDialog.projectId}
        onOpenChange={(o) => setInviteDialog((prev) => ({ ...prev, open: o }))}
        successNote="They will appear in the tester list after they log in for the first time."
      />

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(o) => !deleting && setDeleteConfirm({ open: o, projectId: "", member: null })}
        onConfirm={confirmDelete}
        title="Delete tester account?"
        icon={AlertTriangle}
        iconVariant="destructive"
        itemName={deleteConfirm.member ? `${deleteConfirm.member.name} (${deleteConfirm.member.email})` : undefined}
        description="This will permanently delete their account, remove them from all projects, and cancel any pending invites. Their email will be freed for re-invite or new registration."
        extra={<p className="text-xs text-muted-foreground mt-1.5">Bugs they reported will be kept.</p>}
        confirmLabel="Delete Account"
        confirmingLabel="Deleting…"
        confirming={deleting}
        error={error}
      />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, UserPlus, AlertTriangle, Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { orgApi, type OrgMember } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { Spinner } from "@/components/ui/spinner";
import { ErrorAlert } from "@/components/ui/error-alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InviteMemberDialog } from "@/components/team/InviteMemberDialog";
import {
  canRemoveMember,
  canViewTeam,
  ROLE_LABELS,
  ROLE_STYLES,
} from "@/lib/permissions";

/**
 * Org-wide Team page (LLD §11.4, D12).
 *
 * Replaces the old per-project tester accordion. With org-wide access there is
 * exactly one member list, so there is nothing to nest.
 */
export default function TeamPage() {
  const { role, user } = useAuth();
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<OrgMember | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await orgApi.listMembers();
      setMembers(res.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the team.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function confirmRemove() {
    if (!removeTarget) return;
    setRemoving(true);
    setError("");
    try {
      await orgApi.removeMember(removeTarget.sub);
      setMembers((prev) => prev.filter((m) => m.sub !== removeTarget.sub));
      setRemoveTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that member.");
    } finally {
      setRemoving(false);
    }
  }

  if (!canViewTeam(role)) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">You don&apos;t have access to this page.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  const selfSub = user?.sub ?? "";

  return (
    <div className="p-4 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-8">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Team</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Everyone here can see every project in the workspace.
          </p>
        </div>
        <Button className="gap-2" onClick={() => setInviteOpen(true)}>
          <UserPlus className="w-4 h-4" />
          Invite
        </Button>
      </div>

      <ErrorAlert message={error} className="mb-4" />

      <div className="border border-border rounded-xl overflow-x-auto bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="pl-5">Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              const removable = canRemoveMember(role, selfSub, member);
              return (
                <TableRow key={member.sub}>
                  <TableCell className="pl-5 font-medium text-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      {member.role === "owner" && (
                        <Crown className="w-3.5 h-3.5 text-primary shrink-0" />
                      )}
                      {member.name}
                      {member.sub === selfSub && (
                        <span className="text-xs text-muted-foreground font-normal">(you)</span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{member.email}</TableCell>
                  <TableCell>
                    <span className={cn(
                      "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium",
                      ROLE_STYLES[member.role]
                    )}>
                      {ROLE_LABELS[member.role]}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {member.status === "pending" ? (
                      <span className="text-xs italic">pending first sign-in</span>
                    ) : member.joinedAt ? (
                      new Date(member.joinedAt).toLocaleDateString()
                    ) : "—"}
                  </TableCell>
                  <TableCell>
                    {removable && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="w-8 h-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setRemoveTarget(member)}
                        aria-label={`Remove ${member.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {members.length === 0 && (
          <p className="text-center text-muted-foreground py-12 text-sm">
            No members yet. Invite someone to get started.
          </p>
        )}
      </div>

      <InviteMemberDialog
        open={inviteOpen}
        callerRole={role}
        onOpenChange={setInviteOpen}
        onInvited={(member) => setMembers((prev) => [...prev, member])}
      />

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(open) => !removing && !open && setRemoveTarget(null)}
        onConfirm={confirmRemove}
        title="Remove this member?"
        icon={AlertTriangle}
        iconVariant="destructive"
        itemName={removeTarget ? `${removeTarget.name} (${removeTarget.email})` : undefined}
        description="They'll lose access immediately and their account will be deleted. Their email is freed for a fresh invite."
        extra={
          <p className="text-xs text-muted-foreground mt-1.5">
            Bugs, chat messages and uploads they created are kept, credited to them as removed.
          </p>
        }
        confirmLabel="Remove member"
        confirmingLabel="Removing…"
        confirming={removing}
        error={error}
      />
    </div>
  );
}

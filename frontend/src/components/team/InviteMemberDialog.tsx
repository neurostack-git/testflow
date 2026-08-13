"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Mail, ShieldCheck, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { orgApi, type OrgMember } from "@/lib/api";
import { invitableRoles, ROLE_LABELS, type Role } from "@/lib/permissions";

interface InviteMemberDialogProps {
  open: boolean;
  /** The caller's role — decides which roles appear in the picker (D5). */
  callerRole: Role;
  onOpenChange: (open: boolean) => void;
  onInvited: (member: OrgMember) => void;
}

const ROLE_HINTS: Record<Role, string> = {
  owner: "",
  developer: "Full access to projects and bugs. Can invite testers.",
  tester: "Files bugs and verifies fixes across every project.",
};

export function InviteMemberDialog({
  open,
  callerRole,
  onOpenChange,
  onInvited,
}: InviteMemberDialogProps) {
  const choices = invitableRoles(callerRole);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(choices[choices.length - 1] ?? "tester");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setEmail("");
    setRole(choices[choices.length - 1] ?? "tester");
    setSent(false);
    setError("");
  }

  function handleOpenChange(next: boolean) {
    if (sending) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError("");
    try {
      const member = await orgApi.invite(email.trim().toLowerCase(), role);
      onInvited(member);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the invite.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
        </DialogHeader>

        {sent ? (
          <div className="flex flex-col items-center text-center gap-4 py-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-green-100 dark:bg-green-400/15 dark:ring-1 dark:ring-inset dark:ring-green-400/25">
              <Check className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="font-semibold text-foreground">Invitation sent</p>
              <p className="text-sm text-muted-foreground mt-1">
                {email} will receive a temporary password by email. They&apos;ll appear as
                <span className="font-medium text-foreground"> pending</span> until they sign in.
              </p>
            </div>
            <div className="flex gap-2 w-full">
              <Button variant="outline" className="flex-1" onClick={reset}>
                Invite another
              </Button>
              <Button className="flex-1" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email" className="flex items-center gap-2 text-sm font-semibold">
                <Mail className="w-4 h-4 text-muted-foreground" />
                Email address
              </Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="h-11"
                required
                autoFocus
              />
            </div>

            {/* Only the Owner sees a Developer option (D5); a Developer inviting
                a Tester gets no picker at all, since there is nothing to choose. */}
            {choices.length > 1 ? (
              <div className="space-y-1.5">
                <Label className="flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                  Role
                </Label>
                <div className="grid gap-2">
                  {choices.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      onClick={() => setRole(choice)}
                      className={cn(
                        "text-left rounded-lg border px-3.5 py-2.5 transition-colors",
                        role === choice
                          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                          : "border-border hover:bg-muted/50"
                      )}
                    >
                      <div className="text-sm font-semibold text-foreground">
                        {ROLE_LABELS[choice]}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {ROLE_HINTS[choice]}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                They&apos;ll join as a <span className="font-medium text-foreground">Tester</span>.
                {" "}Only the workspace owner can invite developers.
              </p>
            )}

            {error && (
              <p className="text-sm text-destructive" role="alert">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={sending}>
                Cancel
              </Button>
              <Button type="submit" disabled={sending || !email.trim()} className="gap-2">
                <UserPlus className="w-4 h-4" />
                {sending ? "Sending…" : "Send invite"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

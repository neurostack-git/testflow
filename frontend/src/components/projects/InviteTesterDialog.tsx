"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authApi } from "@/lib/api";

interface InviteTesterDialogProps {
  open: boolean;
  projectId: string;
  onOpenChange: (open: boolean) => void;
  successNote?: string;
}

export function InviteTesterDialog({ open, projectId, onOpenChange, successNote }: InviteTesterDialogProps) {
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setEmail("");
    setInviteSent(false);
    setError("");
  }

  function handleClose() {
    onOpenChange(false);
    setTimeout(reset, 200);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !projectId) return;
    setInviting(true);
    setError("");
    try {
      await authApi.inviteTester(email.trim(), projectId);
      setInviteSent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to invite tester");
    } finally {
      setInviting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
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
                <span className="font-medium text-foreground">{email}</span>
              </p>
              {successNote && (
                <p className="text-xs text-muted-foreground mt-2">{successNote}</p>
              )}
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => { setInviteSent(false); setEmail(""); setError(""); }}>
                Invite another
              </Button>
              <Button className="bg-primary hover:bg-primary/90" onClick={handleClose}>Done</Button>
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
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
              />
              <p className="text-xs text-muted-foreground">
                An invite email with login credentials will be sent. They will be added to your projects after their first login.
              </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
              <Button type="submit" className="bg-primary hover:bg-primary/90" disabled={inviting}>
                {inviting ? "Sending…" : "Send Invite"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Client mirror of the RBAC matrix (LLD §3.1).
//
// Server authority: backend/layers/common/python/tfcommon/auth.py
// This file exists ONLY so the UI never renders a control the API will reject.
// It must never permit something the server forbids — keep the two in step.

import type { Bug } from "@/lib/api";

export type Role = "owner" | "developer" | "tester";

/** Owner or Developer — identical on projects, bugs, reports and chat. */
export const isDeveloper = (role: Role): boolean =>
  role === "owner" || role === "developer";

export const isOwner = (role: Role): boolean => role === "owner";

// ── Projects ─────────────────────────────────────────────────────────────────

export const canCreateProject = isDeveloper;
export const canDeleteProject = isDeveloper;
export const canRestoreProject = isDeveloper;
export const canRenameProject = isDeveloper;

// ── Bugs ─────────────────────────────────────────────────────────────────────

/** Testers may edit and delete their own bug at any status (D10). */
export const canEditBug = (role: Role, sub: string, bug: Bug): boolean =>
  isDeveloper(role) || bug.reportedBy === sub;

export const canDeleteBug = canEditBug;

// ── Reports & chat ───────────────────────────────────────────────────────────

export const canUploadReport = isDeveloper;
export const canDeleteReport = isDeveloper;
/** Testers read and download reports, but cannot upload or delete (A1). */
export const canViewReports = (): boolean => true;
/** Testers have full chat access (A2). */
export const canUseChat = (): boolean => true;
export const canClearChat = isDeveloper;

// ── People & org ─────────────────────────────────────────────────────────────

export const canViewTeam = isDeveloper;

/** Only the Owner may create Developers; Developers may create Testers (D5). */
export const canInvite = (role: Role, target: Role): boolean =>
  target === "developer" ? isOwner(role) : target === "tester" && isDeveloper(role);

/** Roles this caller is allowed to hand out, for the invite dropdown. */
export const invitableRoles = (role: Role): Role[] =>
  isOwner(role) ? ["developer", "tester"] : isDeveloper(role) ? ["tester"] : [];

/** Nobody removes the Owner (INV-2); only the Owner removes Developers (D6). */
export const canRemoveMember = (role: Role, selfSub: string, member: { sub: string; role: Role }): boolean => {
  if (member.role === "owner") return false;
  if (member.sub === selfSub) return false;
  return member.role === "developer" ? isOwner(role) : isDeveloper(role);
};

export const canRenameOrg = isOwner;
export const canTransferOwnership = isOwner;

// ── Display ──────────────────────────────────────────────────────────────────

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  developer: "Developer",
  tester: "Tester",
};

export const ROLE_STYLES: Record<Role, string> = {
  owner:
    "bg-primary/10 text-primary ring-1 ring-inset ring-primary/25",
  developer:
    "bg-blue-100 text-blue-700 ring-1 ring-inset ring-blue-600/15 dark:bg-blue-400/15 dark:text-blue-300 dark:ring-blue-400/25",
  tester:
    "bg-muted text-muted-foreground ring-1 ring-inset ring-foreground/10",
};

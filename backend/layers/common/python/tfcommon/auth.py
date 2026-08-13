"""Caller resolution and the complete authorisation matrix (LLD §3.1, §6).

This is the ONLY place RBAC decisions are made. Handlers call the guards below;
they never inspect `caller.role` directly to make a decision.

Client mirror: frontend/src/lib/permissions.ts — keep the two in step.
"""

from dataclasses import dataclass

from .db import PROFILE, METADATA, get_item, project_pk, user_pk
from .http import ApiError

ROLE_OWNER = "owner"
ROLE_DEVELOPER = "developer"
ROLE_TESTER = "tester"

ROLES = (ROLE_OWNER, ROLE_DEVELOPER, ROLE_TESTER)
#  Roles with full product access to projects, bugs, reports and chat.
#  Owner and Developer differ ONLY on people management and org settings (D5).
DEVELOPER_ROLES = (ROLE_OWNER, ROLE_DEVELOPER)
#  Roles that may be created via invite. `owner` is never invitable (INV-1).
INVITABLE_ROLES = (ROLE_DEVELOPER, ROLE_TESTER)


@dataclass(frozen=True)
class Caller:
    sub: str
    email: str
    role: str
    org_id: str

    @property
    def is_owner(self) -> bool:
        return self.role == ROLE_OWNER

    @property
    def is_developer(self) -> bool:
        """Owner or Developer — i.e. full product access."""
        return self.role in DEVELOPER_ROLES


def jwt_claims(event: dict) -> dict:
    return (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )


def get_caller(event: dict) -> Caller:
    """Resolve the caller from the JWT plus one live profile read (LLD §6.1).

    `custom:role` on the Cognito user is a bootstrap hint for the signup path
    only and is NEVER trusted here — the profile row is the source of truth,
    so removing or changing a member takes effect on their very next request.
    """
    claims = jwt_claims(event)
    sub = claims.get("sub")
    if not sub:
        raise ApiError(401, "Not authenticated.", "unauthenticated")

    profile = get_item(user_pk(sub), PROFILE)
    if not profile:
        # Owner who has confirmed signup but not yet created their org (LLD §7.1).
        raise ApiError(403, "Your workspace is not set up yet.", "org_not_provisioned")
    if profile.get("deleted"):
        raise ApiError(403, "This account has been removed.", "account_removed")

    org_id = profile.get("orgId", "")
    if not org_id:
        raise ApiError(403, "Your workspace is not set up yet.", "org_not_provisioned")

    return Caller(
        sub=sub,
        email=claims.get("email", "") or profile.get("email", ""),
        role=profile.get("role", ROLE_TESTER),
        org_id=org_id,
    )


def bootstrap_identity(event: dict) -> tuple:
    """Identity for POST /org only, where no profile exists yet (LLD §7.1).

    Returns (sub, email, cognito_role). This is the single place `custom:role`
    is read, and it can only ever create an owner.
    """
    claims = jwt_claims(event)
    sub = claims.get("sub")
    if not sub:
        raise ApiError(401, "Not authenticated.", "unauthenticated")
    return sub, claims.get("email", ""), claims.get("custom:role", "")


# ── Guards ───────────────────────────────────────────────────────────────────

def require_owner(caller: Caller) -> None:
    if not caller.is_owner:
        raise ApiError(403, "Only the workspace owner can do that.", "owner_only")


def require_developer(caller: Caller) -> None:
    """Owner or Developer. Used for every write a Tester may not perform."""
    if not caller.is_developer:
        raise ApiError(403, "You don't have permission to do that.", "developer_only")


def require_org(caller: Caller, org_id: str) -> None:
    """INV-4 — the single enforcement point for cross-org isolation.

    Returns 404 rather than 403 so a caller cannot probe for the existence of
    another org's resources.
    """
    if not org_id or org_id != caller.org_id:
        raise ApiError(404, "Not found.", "not_found")


def require_project(caller: Caller, project_id: str, *, allow_deleted: bool = False) -> dict:
    """Load a project and assert it belongs to the caller's org (AP-4).

    Every project-scoped request — bugs, reports, chat — authorises through
    this one function, so nested resources need no org check of their own.
    """
    if not project_id:
        raise ApiError(400, "'projectId' is required.", "missing_field")
    project = get_item(project_pk(project_id), METADATA)
    if not project:
        raise ApiError(404, "Project not found.", "not_found")
    require_org(caller, project.get("orgId", ""))
    if project.get("deletedAt") and not allow_deleted:
        raise ApiError(404, "Project not found.", "not_found")
    return project


# ── People-management rules (D5, D6, INV-2) ──────────────────────────────────

def can_invite(caller: Caller, target_role: str) -> bool:
    """Owner invites Developers and Testers; Developer invites Testers only."""
    if target_role not in INVITABLE_ROLES:
        return False
    if target_role == ROLE_DEVELOPER:
        return caller.is_owner
    return caller.is_developer


def require_can_invite(caller: Caller, target_role: str) -> None:
    if target_role not in INVITABLE_ROLES:
        raise ApiError(400, "Role must be 'developer' or 'tester'.", "bad_role")
    if not can_invite(caller, target_role):
        raise ApiError(
            403,
            "Only the workspace owner can invite developers."
            if target_role == ROLE_DEVELOPER
            else "You don't have permission to invite members.",
            "invite_forbidden",
        )


def can_remove(caller: Caller, member: dict) -> bool:
    """Owner removes Developers and Testers; Developer removes Testers only.
    Nobody removes the Owner (INV-2)."""
    target_role = member.get("role", ROLE_TESTER)
    if target_role == ROLE_OWNER:
        return False
    if member.get("sub") == caller.sub:
        return False
    if target_role == ROLE_DEVELOPER:
        return caller.is_owner
    return caller.is_developer


def require_can_remove(caller: Caller, member: dict) -> None:
    target_role = member.get("role", ROLE_TESTER)
    if target_role == ROLE_OWNER:
        raise ApiError(
            403,
            "The workspace owner can't be removed. Transfer ownership first.",
            "owner_protected",
        )
    if member.get("sub") == caller.sub:
        raise ApiError(403, "You can't remove yourself.", "self_removal")
    if not can_remove(caller, member):
        raise ApiError(
            403,
            "Only the workspace owner can remove developers."
            if target_role == ROLE_DEVELOPER
            else "You don't have permission to remove members.",
            "remove_forbidden",
        )

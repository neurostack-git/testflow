"""Org membership reads (LLD access patterns AP-6, AP-7)."""

from boto3.dynamodb.conditions import Key

from .auth import DEVELOPER_ROLES, ROLE_TESTER
from .db import (
    METADATA,
    MEMBER_PREFIX,
    get_item,
    member_sk,
    org_pk,
    query_all,
)
from .http import ApiError

MEMBER_ACTIVE = "active"
MEMBER_PENDING = "pending"


def get_org(org_id: str) -> dict:
    org = get_item(org_pk(org_id), METADATA)
    if not org:
        raise ApiError(404, "Workspace not found.", "not_found")
    return org


def list_members(org_id: str) -> list:
    """AP-6 — every member of the org, one query."""
    members = query_all(
        KeyConditionExpression=Key("PK").eq(org_pk(org_id))
        & Key("SK").begins_with(MEMBER_PREFIX),
    )
    members.sort(key=lambda m: (_role_rank(m.get("role")), (m.get("name") or "").lower()))
    return members


def get_member(org_id: str, sub: str):
    return get_item(org_pk(org_id), member_sk(sub))


def list_developer_subs(org_id: str) -> list:
    """AP-7 — Owner + Developers, for notification fan-out (LLD §12)."""
    return [
        m["sub"]
        for m in list_members(org_id)
        if m.get("role") in DEVELOPER_ROLES and m.get("sub")
    ]


def member_count(org_id: str) -> int:
    return len(list_members(org_id))


def _role_rank(role: str) -> int:
    # Owner first, then Developers, then Testers.
    order = {"owner": 0, "developer": 1, ROLE_TESTER: 2}
    return order.get(role, 3)

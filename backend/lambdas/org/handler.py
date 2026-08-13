"""Org lifecycle, membership and invites (LLD §7, §9.1).

Replaces the old `auth` Lambda. Membership is org-level: there is exactly one
MEMBER# row per user, and no per-project fan-out anywhere in this file.
"""

import os

import boto3
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError

from tfcommon.auth import (
    ROLE_DEVELOPER,
    ROLE_OWNER,
    ROLE_TESTER,
    bootstrap_identity,
    get_caller,
    require_can_invite,
    require_can_remove,
    require_developer,
    require_owner,
)
from tfcommon.db import (
    METADATA,
    PROFILE,
    dynamodb,
    get_item,
    member_sk,
    new_id,
    now_iso,
    org_pk,
    table,
    user_pk,
)
from tfcommon.http import ApiError, api_handler, json_body, not_found, required, response
from tfcommon.org import MEMBER_ACTIVE, MEMBER_PENDING, get_member, get_org, list_members

cognito = boto3.client("cognito-idp")
USER_POOL_ID = os.environ["USER_POOL_ID"]

MAX_ORG_NAME = 60


@api_handler
def lambda_handler(event: dict, context) -> dict:
    route = event.get("routeKey", "")
    path_params = event.get("pathParameters") or {}

    # Bootstrap is the only route that runs without a profile row.
    if route == "POST /org":
        return create_org(event)

    caller = get_caller(event)

    if route == "GET /org":
        return get_org_summary(caller)
    if route == "PATCH /org":
        return rename_org(event, caller)
    if route == "GET /org/members":
        return get_members(caller)
    if route == "POST /org/invite":
        return invite_member(event, caller)
    if route == "DELETE /org/members/{sub}":
        return remove_member(path_params.get("sub"), caller)
    if route == "POST /org/transfer-ownership":
        return transfer_ownership(event, caller)

    return not_found()


# ── Bootstrap (LLD §7.1) ─────────────────────────────────────────────────────

def create_org(event: dict) -> dict:
    """Called once, by a freshly confirmed Owner, immediately after first login.

    Creates the org, the owner's membership and their profile in a single
    transaction so a partial workspace can never exist.
    """
    sub, email, cognito_role = bootstrap_identity(event)

    if get_item(user_pk(sub), PROFILE):
        raise ApiError(409, "Your workspace already exists.", "org_exists")

    # `custom:role` is set to "owner" by the signup form and to the invited role
    # by admin_create_user. An invited user already has a profile (created at
    # invite time), so reaching here with a non-owner hint means a tampered call.
    if cognito_role != ROLE_OWNER:
        raise ApiError(403, "This account can't create a workspace.", "not_owner")

    body = json_body(event)
    (name,) = required(body, "name")
    if len(name) > MAX_ORG_NAME:
        raise ApiError(400, f"Workspace name must be {MAX_ORG_NAME} characters or fewer.", "name_too_long")

    org_id = new_id()
    now = now_iso()
    display_name = (body.get("ownerName") or "").strip() or email.split("@")[0]

    dynamodb.meta.client.transact_write_items(TransactItems=[
        {"Put": {
            "TableName": table.name,
            "Item": _marshal({
                "PK": org_pk(org_id), "SK": METADATA,
                "orgId": org_id, "name": name, "ownerSub": sub, "createdAt": now,
            }),
            "ConditionExpression": "attribute_not_exists(PK)",
        }},
        {"Put": {
            "TableName": table.name,
            "Item": _marshal({
                "PK": org_pk(org_id), "SK": member_sk(sub),
                "sub": sub, "email": email, "name": display_name,
                "role": ROLE_OWNER, "status": MEMBER_ACTIVE, "joinedAt": now,
            }),
        }},
        {"Put": {
            "TableName": table.name,
            "Item": _marshal({
                "PK": user_pk(sub), "SK": PROFILE,
                "orgId": org_id, "role": ROLE_OWNER, "email": email,
                "name": display_name, "phone": "",
            }),
            "ConditionExpression": "attribute_not_exists(PK)",
        }},
    ])

    return response(201, {"orgId": org_id, "name": name, "role": ROLE_OWNER})


# ── Org read / rename ────────────────────────────────────────────────────────

def get_org_summary(caller) -> dict:
    org = get_org(caller.org_id)
    return response(200, {
        "orgId": org["orgId"],
        "name": org.get("name", ""),
        "ownerSub": org.get("ownerSub", ""),
        "memberCount": len(list_members(caller.org_id)),
    })


def rename_org(event: dict, caller) -> dict:
    require_owner(caller)
    body = json_body(event)
    (name,) = required(body, "name")
    if len(name) > MAX_ORG_NAME:
        raise ApiError(400, f"Workspace name must be {MAX_ORG_NAME} characters or fewer.", "name_too_long")

    table.update_item(
        Key={"PK": org_pk(caller.org_id), "SK": METADATA},
        UpdateExpression="SET #n = :n",
        ExpressionAttributeNames={"#n": "name"},
        ExpressionAttributeValues={":n": name},
    )
    return response(200, {"orgId": caller.org_id, "name": name})


# ── Members ──────────────────────────────────────────────────────────────────

def get_members(caller) -> dict:
    require_developer(caller)
    members = [
        {
            "sub": m.get("sub", ""),
            "email": m.get("email", ""),
            "name": m.get("name", ""),
            "role": m.get("role", ROLE_TESTER),
            "status": m.get("status", MEMBER_ACTIVE),
            "joinedAt": m.get("joinedAt", ""),
        }
        for m in list_members(caller.org_id)
    ]
    return response(200, {"members": members})


def invite_member(event: dict, caller) -> dict:
    """Create the Cognito user and BOTH persistent rows up front (LLD §7.2).

    Writing the profile at invite time — rather than converting a PENDING# row
    on first login — means the invitee is authorised the instant they sign in.
    """
    body = json_body(event)
    (email, role) = required(body, "email", "role")
    email = email.lower()
    require_can_invite(caller, role)

    try:
        created = cognito.admin_create_user(
            UserPoolId=USER_POOL_ID,
            Username=email,
            UserAttributes=[
                {"Name": "email", "Value": email},
                {"Name": "email_verified", "Value": "true"},
                {"Name": "custom:role", "Value": role},
            ],
            DesiredDeliveryMediums=["EMAIL"],
        )
        attrs = {a["Name"]: a["Value"] for a in created["User"]["Attributes"]}
        new_sub = attrs["sub"]
    except ClientError as err:
        if err.response["Error"]["Code"] != "UsernameExistsException":
            raise
        raise _existing_user_error(email)

    now = now_iso()
    display_name = email.split("@")[0]

    dynamodb.meta.client.transact_write_items(TransactItems=[
        {"Put": {
            "TableName": table.name,
            "Item": _marshal({
                "PK": org_pk(caller.org_id), "SK": member_sk(new_sub),
                "sub": new_sub, "email": email, "name": display_name,
                "role": role, "status": MEMBER_PENDING,
                "invitedBy": caller.sub, "invitedAt": now,
            }),
        }},
        {"Put": {
            "TableName": table.name,
            "Item": _marshal({
                "PK": user_pk(new_sub), "SK": PROFILE,
                "orgId": caller.org_id, "role": role, "email": email,
                "name": display_name, "phone": "",
            }),
        }},
    ])

    return response(201, {
        "sub": new_sub, "email": email, "name": display_name,
        "role": role, "status": MEMBER_PENDING,
    })


def _existing_user_error(email: str) -> ApiError:
    """One org per user (D1), so any pre-existing account is a hard conflict."""
    try:
        existing = cognito.admin_get_user(UserPoolId=USER_POOL_ID, Username=email)
    except ClientError:
        return ApiError(400, "That email can't be invited.", "invite_conflict")

    status = existing.get("UserStatus", "")
    if status == "FORCE_CHANGE_PASSWORD":
        return ApiError(
            400,
            "An invite is already pending for this email.",
            "invite_pending",
        )
    return ApiError(
        400,
        "That email already belongs to a TestFlow workspace.",
        "already_member",
    )


def remove_member(target_sub: str, caller) -> dict:
    """Remove from the org but keep their content, tombstoning the profile (D17)."""
    if not target_sub:
        raise ApiError(400, "'sub' is required.", "missing_field")

    member = get_member(caller.org_id, target_sub)
    if not member:
        raise ApiError(404, "Member not found.", "not_found")
    require_can_remove(caller, member)

    try:
        cognito.admin_delete_user(UserPoolId=USER_POOL_ID, Username=member.get("email", ""))
    except ClientError as err:
        # Already gone from Cognito — still clean up our rows.
        if err.response["Error"]["Code"] != "UserNotFoundException":
            raise

    table.delete_item(Key={"PK": org_pk(caller.org_id), "SK": member_sk(target_sub)})

    # Tombstone rather than delete, so bug and chat author names still resolve.
    table.update_item(
        Key={"PK": user_pk(target_sub), "SK": PROFILE},
        UpdateExpression="SET deleted = :t, deletedAt = :now REMOVE orgId",
        ExpressionAttributeValues={":t": True, ":now": now_iso()},
    )

    return response(200, {"removed": target_sub})


def transfer_ownership(event: dict, caller) -> dict:
    """The single role mutation in the system (LLD §7.5, INV-1)."""
    require_owner(caller)
    body = json_body(event)
    (to_sub,) = required(body, "toSub")

    if to_sub == caller.sub:
        raise ApiError(400, "You already own this workspace.", "no_op")

    target = get_member(caller.org_id, to_sub)
    if not target:
        raise ApiError(404, "Member not found.", "not_found")
    if target.get("role") != ROLE_DEVELOPER:
        raise ApiError(400, "Ownership can only be transferred to a developer.", "bad_target")
    if target.get("status") != MEMBER_ACTIVE:
        raise ApiError(400, "That member hasn't signed in yet.", "member_pending")

    org = org_pk(caller.org_id)
    # All five writes or none — the org is never left with zero or two owners.
    dynamodb.meta.client.transact_write_items(TransactItems=[
        _set_role(org, member_sk(caller.sub), ROLE_DEVELOPER),
        _set_role(org, member_sk(to_sub), ROLE_OWNER),
        _set_profile_role(caller.sub, ROLE_DEVELOPER),
        _set_profile_role(to_sub, ROLE_OWNER),
        {"Update": {
            "TableName": table.name,
            "Key": _marshal({"PK": org, "SK": METADATA}),
            "UpdateExpression": "SET ownerSub = :s",
            "ExpressionAttributeValues": _marshal({":s": to_sub}),
        }},
    ])

    return response(200, {"ownerSub": to_sub})


# ── Transaction helpers ──────────────────────────────────────────────────────
#  boto3's resource-level Table API has no transaction support, so these build
#  client-level items. `_marshal` converts plain Python to the wire format.

_serializer = TypeSerializer()


def _marshal(obj: dict) -> dict:
    return {k: _serializer.serialize(v) for k, v in obj.items()}


def _set_role(org: str, sk: str, role: str) -> dict:
    return {"Update": {
        "TableName": table.name,
        "Key": _marshal({"PK": org, "SK": sk}),
        "UpdateExpression": "SET #r = :r",
        "ExpressionAttributeNames": {"#r": "role"},
        "ExpressionAttributeValues": _marshal({":r": role}),
    }}


def _set_profile_role(sub: str, role: str) -> dict:
    return {"Update": {
        "TableName": table.name,
        "Key": _marshal({"PK": user_pk(sub), "SK": PROFILE}),
        "UpdateExpression": "SET #r = :r",
        "ExpressionAttributeNames": {"#r": "role"},
        "ExpressionAttributeValues": _marshal({":r": role}),
    }}

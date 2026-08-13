"""Bug CRUD and the status lifecycle (LLD §8, §9.3).

Access is org-scoped via `require_project`. The transition matrix itself lives
in `tfcommon.bugs` so the client mirror has exactly one source to track.
"""

import json
import os

import boto3
from boto3.dynamodb.conditions import Key

from tfcommon.auth import get_caller, require_developer, require_project
from tfcommon.bugs import (
    INITIAL_STATUS,
    STATUS_FIXED,
    STATUS_REOPENED,
    require_can_edit_bug,
    require_transition,
)
from tfcommon.db import (
    BUG_PREFIX,
    PROFILE,
    bug_sk,
    get_item,
    new_id,
    notif_sk,
    now_iso,
    project_pk,
    query_all,
    table,
    user_pk,
)
from tfcommon.http import ApiError, api_handler, json_body, not_found, required, response
from tfcommon.org import list_developer_subs

lambda_client = boto3.client("lambda")
s3 = boto3.client("s3")

NOTIFICATIONS_FN_ARN = os.environ.get("NOTIFICATIONS_FN_ARN", "")
BUCKET_NAME = os.environ.get("BUCKET_NAME", "")

MAX_TITLE = 120
MAX_DESCRIPTION = 2000
# Per-type caps. These MUST match the constants in the frontend dialogs
# (BugCreateDialog / BugEditDialog) or the UI will offer uploads the API rejects.
MAX_ATTACHMENTS = {
    "screenshots": 10,
    "videos": 5,
    "documents": 10,
}


@api_handler
def lambda_handler(event: dict, context) -> dict:
    route = event.get("routeKey", "")
    params = event.get("pathParameters") or {}
    project_id = params.get("projectId")
    bug_id = params.get("bugId")
    caller = get_caller(event)

    if route == "GET /projects/{projectId}/bugs":
        return list_bugs(project_id, caller)
    if route == "POST /projects/{projectId}/bugs":
        return create_bug(event, project_id, caller)
    if route == "GET /projects/{projectId}/bugs/{bugId}":
        return get_bug(project_id, bug_id, caller)
    if route == "PATCH /projects/{projectId}/bugs/{bugId}":
        return update_bug(event, project_id, bug_id, caller)
    if route == "PATCH /projects/{projectId}/bugs/{bugId}/status":
        return update_status(event, project_id, bug_id, caller)
    if route == "DELETE /projects/{projectId}/bugs/{bugId}":
        return delete_bug(project_id, bug_id, caller)

    return not_found()


# ── Reads ────────────────────────────────────────────────────────────────────

def list_bugs(project_id: str, caller) -> dict:
    require_project(caller, project_id)
    bugs = query_all(
        KeyConditionExpression=Key("PK").eq(project_pk(project_id))
        & Key("SK").begins_with(BUG_PREFIX),
    )
    _attach_reporter_names(bugs)
    bugs.sort(key=lambda b: b.get("createdAt", ""), reverse=True)
    return response(200, {"bugs": bugs})


def get_bug(project_id: str, bug_id: str, caller) -> dict:
    require_project(caller, project_id)
    bug = _load_bug(project_id, bug_id)
    _attach_reporter_names([bug])
    return response(200, bug)


def _load_bug(project_id: str, bug_id: str) -> dict:
    if not bug_id:
        raise ApiError(400, "'bugId' is required.", "missing_field")
    bug = get_item(project_pk(project_id), bug_sk(bug_id))
    if not bug:
        raise ApiError(404, "Bug not found.", "not_found")
    return bug


def _attach_reporter_names(bugs: list) -> None:
    """Resolve reporter display names, including tombstoned members (D17)."""
    subs = {b.get("reportedBy") for b in bugs if b.get("reportedBy")}
    names = {}
    for sub in subs:
        profile = get_item(user_pk(sub), PROFILE)
        if not profile:
            continue
        name = profile.get("name") or profile.get("email", "")
        names[sub] = f"{name} (removed)" if profile.get("deleted") else name
    for bug in bugs:
        bug["reporterName"] = names.get(bug.get("reportedBy"), "")


# ── Writes ───────────────────────────────────────────────────────────────────

def create_bug(event: dict, project_id: str, caller) -> dict:
    """Any role may file a bug, and it always starts Open."""
    project = require_project(caller, project_id)
    body = json_body(event)
    (title, description) = required(body, "title", "description")
    _check_lengths(title, description)

    screenshots = _check_attachments(body.get("screenshots"), "screenshots")
    videos = _check_attachments(body.get("videos"), "videos")
    documents = _check_attachments(body.get("documents"), "documents")

    bug_id = new_id()
    now = now_iso()
    bug = {
        "PK": project_pk(project_id),
        "SK": bug_sk(bug_id),
        "bugId": bug_id,
        "projectId": project_id,
        "title": title,
        "description": description,
        "status": INITIAL_STATUS,
        "reportedBy": caller.sub,
        "screenshots": screenshots,
        "videos": videos,
        "documents": documents,
        "createdAt": now,
        "updatedAt": now,
    }
    table.put_item(Item=bug)

    # In-app only — email on every filed bug is noise on an active project.
    _notify_developers(
        caller,
        project,
        title=f"New bug: {title}",
        notif_type="bug_created",
        project_id=project_id,
    )

    bug["reporterName"] = caller.email
    return response(201, bug)


def update_bug(event: dict, project_id: str, bug_id: str, caller) -> dict:
    require_project(caller, project_id)
    bug = _load_bug(project_id, bug_id)
    require_can_edit_bug(caller, bug)   # Testers may edit only their own (D10)

    body = json_body(event)
    updates = {}

    if "title" in body:
        title = (body.get("title") or "").strip()
        if not title:
            raise ApiError(400, "'title' is required.", "missing_field")
        _check_lengths(title, None)
        updates["title"] = title

    if "description" in body:
        description = (body.get("description") or "").strip()
        if not description:
            raise ApiError(400, "'description' is required.", "missing_field")
        _check_lengths(None, description)
        updates["description"] = description

    for field in ("screenshots", "videos", "documents"):
        if field in body:
            updates[field] = _check_attachments(body.get(field), field)

    if not updates:
        raise ApiError(400, "Nothing to update.", "no_changes")

    # Objects dropped from an attachment list are removed from S3 too.
    removed = []
    for field in ("screenshots", "videos", "documents"):
        if field in updates:
            removed.extend(set(bug.get(field) or []) - set(updates[field]))
    _delete_s3_objects(removed)

    updates["updatedAt"] = now_iso()
    names = {f"#{k}": k for k in updates}
    values = {f":{k}": v for k, v in updates.items()}
    table.update_item(
        Key={"PK": project_pk(project_id), "SK": bug_sk(bug_id)},
        UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in updates),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )

    bug.update(updates)
    _attach_reporter_names([bug])
    return response(200, bug)


def update_status(event: dict, project_id: str, bug_id: str, caller) -> dict:
    project = require_project(caller, project_id)
    bug = _load_bug(project_id, bug_id)

    body = json_body(event)
    (target,) = required(body, "status")
    current = bug.get("status", INITIAL_STATUS)
    require_transition(caller, current, target)   # LLD §8.3

    now = now_iso()
    table.update_item(
        Key={"PK": project_pk(project_id), "SK": bug_sk(bug_id)},
        UpdateExpression="SET #s = :s, updatedAt = :now",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": target, ":now": now},
    )

    if target == STATUS_FIXED:
        _notify_reporter_fixed(bug, project)
    elif target == STATUS_REOPENED:
        _notify_developers(
            caller,
            project,
            title=f"Reopened: {bug.get('title', '')}",
            notif_type="bug_reopened",
            project_id=project_id,
            email=True,
        )

    return response(200, {"status": target, "updatedAt": now})


def delete_bug(project_id: str, bug_id: str, caller) -> dict:
    require_project(caller, project_id)
    bug = _load_bug(project_id, bug_id)
    require_can_edit_bug(caller, bug)   # Testers may delete only their own (D10)

    keys = []
    for field in ("screenshots", "videos", "documents"):
        keys.extend(bug.get(field) or [])
    _delete_s3_objects(keys)

    table.delete_item(Key={"PK": project_pk(project_id), "SK": bug_sk(bug_id)})
    return response(200, {"bugId": bug_id})


# ── Validation ───────────────────────────────────────────────────────────────

def _check_lengths(title, description) -> None:
    if title is not None and len(title) > MAX_TITLE:
        raise ApiError(400, f"Title must be {MAX_TITLE} characters or fewer.", "title_too_long")
    if description is not None and len(description) > MAX_DESCRIPTION:
        raise ApiError(
            400, f"Description must be {MAX_DESCRIPTION} characters or fewer.", "description_too_long"
        )


def _check_attachments(value, field: str) -> list:
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(v, str) for v in value):
        raise ApiError(400, f"'{field}' must be a list of S3 keys.", "bad_attachments")
    limit = MAX_ATTACHMENTS.get(field, 10)
    if len(value) > limit:
        raise ApiError(
            400, f"At most {limit} {field} are allowed.", "attachment_limit"
        )
    return value


def _delete_s3_objects(keys: list) -> None:
    if not keys or not BUCKET_NAME:
        return
    objects = [{"Key": k} for k in dict.fromkeys(keys) if k]
    if not objects:
        return
    try:
        s3.delete_objects(Bucket=BUCKET_NAME, Delete={"Objects": objects})
    except Exception as err:  # noqa: BLE001
        print(f"S3 delete failed: {err}")


# ── Notifications (LLD §12) ──────────────────────────────────────────────────

def _notify_reporter_fixed(bug: dict, project: dict) -> None:
    """Fixed → the reporting Tester, by email and WhatsApp."""
    reporter = get_item(user_pk(bug.get("reportedBy", "")), PROFILE)
    if not reporter or reporter.get("deleted") or not NOTIFICATIONS_FN_ARN:
        return
    try:
        lambda_client.invoke(
            FunctionName=NOTIFICATIONS_FN_ARN,
            InvocationType="Event",
            Payload=json.dumps({
                "type": "BUG_FIXED",
                "bugId": bug.get("bugId"),
                "bugTitle": bug.get("title"),
                "projectId": project.get("projectId"),
                "projectTitle": project.get("title"),
                "reporterEmail": reporter.get("email"),
                "reporterPhone": reporter.get("phone"),
            }),
        )
    except Exception as err:  # noqa: BLE001
        print(f"Notification invoke failed: {err}")


def _notify_developers(caller, project: dict, *, title: str, notif_type: str,
                       project_id: str, email: bool = False) -> None:
    """Fan out to Owner + Developers (AP-7), excluding the actor."""
    now = now_iso()
    recipients = [s for s in list_developer_subs(caller.org_id) if s != caller.sub]

    with table.batch_writer() as batch:
        for sub in recipients:
            notif_id = new_id()
            batch.put_item(Item={
                "PK": user_pk(sub),
                "SK": notif_sk(now, notif_id),
                "notifId": notif_id,
                "type": notif_type,
                "projectId": project_id,
                "projectTitle": project.get("title", ""),
                "fromName": caller.email,
                "content": title,
                "read": False,
                "createdAt": now,
            })

    if email and NOTIFICATIONS_FN_ARN and recipients:
        emails = []
        for sub in recipients:
            profile = get_item(user_pk(sub), PROFILE)
            if profile and profile.get("email") and not profile.get("deleted"):
                emails.append(profile["email"])
        if emails:
            try:
                lambda_client.invoke(
                    FunctionName=NOTIFICATIONS_FN_ARN,
                    InvocationType="Event",
                    Payload=json.dumps({
                        "type": "BUG_REOPENED",
                        "bugTitle": title,
                        "projectTitle": project.get("title", ""),
                        "recipientEmails": emails,
                    }),
                )
            except Exception as err:  # noqa: BLE001
                print(f"Notification invoke failed: {err}")

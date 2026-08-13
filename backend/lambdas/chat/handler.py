"""Chat history, chat roster and in-app notifications (LLD §9.4, D15).

Chat stays one room per project; the access check is now "is this project in my
org" rather than "am I a member of this project". The roster is simply the org
member list, so @-mention targets are everyone in the workspace.
"""

from boto3.dynamodb.conditions import Key

from tfcommon.auth import get_caller, require_developer, require_project
from tfcommon.db import (
    MSG_PREFIX,
    NOTIF_PREFIX,
    PROFILE,
    get_item,
    project_pk,
    table,
    user_pk,
)
from tfcommon.http import ApiError, api_handler, not_found, response
from tfcommon.org import list_members

HISTORY_PAGE = 50
NOTIF_PAGE = 30


@api_handler
def lambda_handler(event: dict, context) -> dict:
    route = event.get("routeKey", "")
    params = event.get("pathParameters") or {}
    project_id = params.get("projectId")
    caller = get_caller(event)

    if route == "GET /projects/{projectId}/chat/history":
        return get_history(event, project_id, caller)
    if route == "DELETE /projects/{projectId}/chat/history":
        return clear_history(project_id, caller)
    if route == "GET /projects/{projectId}/chat/members":
        return get_chat_members(project_id, caller)
    if route == "GET /notifications":
        return get_notifications(caller)
    if route == "PATCH /notifications/{notifId}/read":
        return mark_read(params.get("notifId"), caller)
    if route == "PATCH /notifications/read-all":
        return mark_all_read(caller)
    if route == "DELETE /notifications":
        return clear_all_notifications(caller)

    return not_found()


# ── History ──────────────────────────────────────────────────────────────────

def get_history(event: dict, project_id: str, caller) -> dict:
    """Readable by every role, including Testers (A2)."""
    require_project(caller, project_id)
    cursor = (event.get("queryStringParameters") or {}).get("cursor")

    kwargs = {
        "KeyConditionExpression": Key("PK").eq(project_pk(project_id))
        & Key("SK").begins_with(MSG_PREFIX),
        "Limit": HISTORY_PAGE,
        "ScanIndexForward": False,
    }
    if cursor:
        kwargs["ExclusiveStartKey"] = {"PK": project_pk(project_id), "SK": cursor}

    result = table.query(**kwargs)
    messages = result.get("Items", [])
    messages.reverse()  # chronological for display

    last_key = result.get("LastEvaluatedKey")
    clean = [{k: v for k, v in m.items() if k not in ("PK", "SK")} for m in messages]
    return response(200, {
        "messages": clean,
        "nextCursor": last_key.get("SK") if last_key else None,
    })


def clear_history(project_id: str, caller) -> dict:
    """Destructive and org-wide, so Developer/Owner only (A4)."""
    require_developer(caller)
    require_project(caller, project_id)

    deleted = 0
    last_key = None
    while True:
        kwargs = {
            "KeyConditionExpression": Key("PK").eq(project_pk(project_id))
            & Key("SK").begins_with(MSG_PREFIX),
            "ProjectionExpression": "PK, SK",
        }
        if last_key:
            kwargs["ExclusiveStartKey"] = last_key
        result = table.query(**kwargs)
        items = result.get("Items", [])
        if items:
            with table.batch_writer() as batch:
                for item in items:
                    batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
            deleted += len(items)
        last_key = result.get("LastEvaluatedKey")
        if not last_key:
            break

    return response(200, {"deleted": deleted})


# ── Roster ───────────────────────────────────────────────────────────────────

def get_chat_members(project_id: str, caller) -> dict:
    """Everyone in the org — there is no per-project roster any more (D11)."""
    require_project(caller, project_id)

    members = []
    for member in list_members(caller.org_id):
        sub = member.get("sub", "")
        profile = get_item(user_pk(sub), PROFILE) or {}
        members.append({
            "sub": sub,
            "name": member.get("name") or profile.get("name") or member.get("email", "").split("@")[0],
            "role": member.get("role", "tester"),
            "avatarKey": profile.get("avatarKey", ""),
        })
    return response(200, {"members": members})


# ── Notifications ────────────────────────────────────────────────────────────

def get_notifications(caller) -> dict:
    result = table.query(
        KeyConditionExpression=Key("PK").eq(user_pk(caller.sub))
        & Key("SK").begins_with(NOTIF_PREFIX),
        ScanIndexForward=False,
        Limit=NOTIF_PAGE,
    )
    clean = [{k: v for k, v in n.items() if k != "PK"} for n in result.get("Items", [])]
    return response(200, {
        "notifications": clean,
        "unreadCount": sum(1 for n in clean if not n.get("read")),
    })


def mark_read(notif_id: str, caller) -> dict:
    if not notif_id:
        raise ApiError(400, "'notifId' is required.", "missing_field")
    result = table.query(
        KeyConditionExpression=Key("PK").eq(user_pk(caller.sub))
        & Key("SK").begins_with(NOTIF_PREFIX),
    )
    notif = next((n for n in result.get("Items", []) if n.get("notifId") == notif_id), None)
    if not notif:
        raise ApiError(404, "Notification not found.", "not_found")

    table.update_item(
        Key={"PK": user_pk(caller.sub), "SK": notif["SK"]},
        UpdateExpression="SET #r = :r",
        ExpressionAttributeNames={"#r": "read"},
        ExpressionAttributeValues={":r": True},
    )
    return response(200, {"notifId": notif_id})


def mark_all_read(caller) -> dict:
    result = table.query(
        KeyConditionExpression=Key("PK").eq(user_pk(caller.sub))
        & Key("SK").begins_with(NOTIF_PREFIX),
    )
    updated = 0
    for item in result.get("Items", []):
        if not item.get("read"):
            table.update_item(
                Key={"PK": user_pk(caller.sub), "SK": item["SK"]},
                UpdateExpression="SET #r = :r",
                ExpressionAttributeNames={"#r": "read"},
                ExpressionAttributeValues={":r": True},
            )
            updated += 1
    return response(200, {"updated": updated})


def clear_all_notifications(caller) -> dict:
    result = table.query(
        KeyConditionExpression=Key("PK").eq(user_pk(caller.sub))
        & Key("SK").begins_with(NOTIF_PREFIX),
        ProjectionExpression="PK, SK",
    )
    items = result.get("Items", [])
    if items:
        with table.batch_writer() as batch:
            for item in items:
                batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
    return response(200, {"deleted": len(items)})

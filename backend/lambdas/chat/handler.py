import json
import os
import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")
TABLE_NAME = os.environ["TABLE_NAME"]
table = dynamodb.Table(TABLE_NAME)


def resp(status: int, body) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        "body": json.dumps(body, default=str),
    }


def lambda_handler(event: dict, context) -> dict:
    route = event.get("routeKey", "")
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    user_sub = claims.get("sub")
    user_role = claims.get("custom:role", "tester")
    path_params = event.get("pathParameters") or {}
    project_id = path_params.get("projectId")
    notif_id = path_params.get("notifId")

    if route == "GET /projects/{projectId}/chat/history":
        return get_history(event, project_id, user_sub, user_role)
    if route == "DELETE /projects/{projectId}/chat/history":
        return clear_history(project_id, user_sub, user_role)
    if route == "GET /projects/{projectId}/chat/members":
        return get_chat_members(project_id, user_sub, user_role)
    if route == "GET /notifications":
        return get_notifications(user_sub)
    if route == "PATCH /notifications/{notifId}/read":
        return mark_read(notif_id, user_sub)
    if route == "PATCH /notifications/read-all":
        return mark_all_read(user_sub)
    if route == "DELETE /notifications":
        return clear_all_notifications(user_sub)

    return resp(404, {"error": "Not found"})


def _check_access(project_id: str, user_sub: str, user_role: str) -> bool:
    if user_role == "admin":
        return table.get_item(Key={"PK": f"PROJECT#{project_id}", "SK": "METADATA"}).get("Item") is not None
    return table.get_item(Key={"PK": f"PROJECT#{project_id}", "SK": f"MEMBER#{user_sub}"}).get("Item") is not None


# ── Chat history ──────────────────────────────────────────────────────────────

def get_history(event: dict, project_id: str, user_sub: str, user_role: str) -> dict:
    if not _check_access(project_id, user_sub, user_role):
        return resp(403, {"error": "Forbidden"})

    query_params = event.get("queryStringParameters") or {}
    cursor = query_params.get("cursor")

    kwargs = {
        "KeyConditionExpression": Key("PK").eq(f"PROJECT#{project_id}") & Key("SK").begins_with("MSG#"),
        "Limit": 50,
        "ScanIndexForward": False,
    }
    if cursor:
        kwargs["ExclusiveStartKey"] = {"PK": f"PROJECT#{project_id}", "SK": cursor}

    result = table.query(**kwargs)
    messages = result.get("Items", [])
    messages.reverse()  # chronological order for display

    next_cursor = None
    last_key = result.get("LastEvaluatedKey")
    if last_key:
        next_cursor = last_key.get("SK")

    clean = [{k: v for k, v in m.items() if k not in ("PK", "SK")} for m in messages]
    return resp(200, {"messages": clean, "nextCursor": next_cursor})


def clear_history(project_id: str, user_sub: str, user_role: str) -> dict:
    if user_role != "admin":
        return resp(403, {"error": "Forbidden"})
    if not _check_access(project_id, user_sub, user_role):
        return resp(403, {"error": "Forbidden"})

    # Paginate and batch-delete all MSG# items for this project
    last_key = None
    deleted = 0
    while True:
        kwargs = {
            "KeyConditionExpression": Key("PK").eq(f"PROJECT#{project_id}") & Key("SK").begins_with("MSG#"),
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

    return resp(200, {"deleted": deleted})


# ── Chat members (all participants: admin + testers) ──────────────────────────

def get_chat_members(project_id: str, user_sub: str, user_role: str) -> dict:
    if not _check_access(project_id, user_sub, user_role):
        return resp(403, {"error": "Forbidden"})

    proj = table.get_item(Key={"PK": f"PROJECT#{project_id}", "SK": "METADATA"}).get("Item")
    if not proj:
        return resp(404, {"error": "Project not found"})

    members = []

    # Admin
    admin_sub = proj.get("GSI1PK", "").replace("ADMIN#", "")
    if admin_sub:
        admin_profile = table.get_item(Key={"PK": f"USER#{admin_sub}", "SK": "PROFILE"}).get("Item", {})
        members.append({
            "sub": admin_sub,
            "name": admin_profile.get("name") or admin_profile.get("email", "").split("@")[0] or "Admin",
            "role": "admin",
            "avatarKey": admin_profile.get("avatarKey", ""),
        })

    # Testers
    tester_result = table.query(
        KeyConditionExpression=Key("PK").eq(f"PROJECT#{project_id}") & Key("SK").begins_with("MEMBER#"),
    )
    tester_items = tester_result.get("Items", [])
    if tester_items:
        keys = [{"PK": f"USER#{item['SK'].replace('MEMBER#', '')}", "SK": "PROFILE"} for item in tester_items]
        batch_resp = dynamodb.batch_get_item(RequestItems={TABLE_NAME: {"Keys": keys}})
        profiles = {
            p["PK"].replace("USER#", ""): p
            for p in batch_resp.get("Responses", {}).get(TABLE_NAME, [])
        }
        for item in tester_items:
            sub = item["SK"].replace("MEMBER#", "")
            profile = profiles.get(sub, {})
            members.append({
                "sub": sub,
                "name": profile.get("name") or item.get("email", "").split("@")[0] or sub[:8],
                "role": "tester",
                "avatarKey": profile.get("avatarKey", ""),
            })

    return resp(200, {"members": members})


# ── Notifications ─────────────────────────────────────────────────────────────

def get_notifications(user_sub: str) -> dict:
    result = table.query(
        KeyConditionExpression=Key("PK").eq(f"USER#{user_sub}") & Key("SK").begins_with("NOTIF#"),
        ScanIndexForward=False,
        Limit=30,
    )
    notifications = result.get("Items", [])
    clean = [{k: v for k, v in n.items() if k not in ("PK",)} for n in notifications]
    unread_count = sum(1 for n in clean if not n.get("read", False))
    return resp(200, {"notifications": clean, "unreadCount": unread_count})


def mark_read(notif_id: str, user_sub: str) -> dict:
    result = table.query(
        KeyConditionExpression=Key("PK").eq(f"USER#{user_sub}") & Key("SK").begins_with("NOTIF#"),
    )
    notif = next((item for item in result.get("Items", []) if item.get("notifId") == notif_id), None)
    if not notif:
        return resp(404, {"error": "Notification not found"})

    table.update_item(
        Key={"PK": f"USER#{user_sub}", "SK": notif["SK"]},
        UpdateExpression="SET #r = :r",
        ExpressionAttributeNames={"#r": "read"},
        ExpressionAttributeValues={":r": True},
    )
    return resp(200, {"message": "Marked as read"})


def clear_all_notifications(user_sub: str) -> dict:
    result = table.query(
        KeyConditionExpression=Key("PK").eq(f"USER#{user_sub}") & Key("SK").begins_with("NOTIF#"),
        ProjectionExpression="PK, SK",
    )
    items = result.get("Items", [])
    if items:
        with table.batch_writer() as batch:
            for item in items:
                batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
    return resp(200, {"deleted": len(items)})


def mark_all_read(user_sub: str) -> dict:
    result = table.query(
        KeyConditionExpression=Key("PK").eq(f"USER#{user_sub}") & Key("SK").begins_with("NOTIF#"),
    )
    for item in result.get("Items", []):
        if not item.get("read", False):
            table.update_item(
                Key={"PK": f"USER#{user_sub}", "SK": item["SK"]},
                UpdateExpression="SET #r = :r",
                ExpressionAttributeNames={"#r": "read"},
                ExpressionAttributeValues={":r": True},
            )
    return resp(200, {"message": "All marked as read"})

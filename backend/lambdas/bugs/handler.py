import json
import os
import uuid
import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config
from datetime import datetime, timezone

dynamodb = boto3.resource("dynamodb")
lambda_client = boto3.client("lambda")
s3 = boto3.client("s3", config=Config(signature_version="s3v4"))

TABLE_NAME = os.environ["TABLE_NAME"]
NOTIFICATIONS_FN_ARN = os.environ.get("NOTIFICATIONS_FN_ARN", "")
BUCKET_NAME = os.environ.get("BUCKET_NAME", "")
table = dynamodb.Table(TABLE_NAME)

_ALL = ["Open", "Fixed", "Closed", "Invalid"]

VALID_TRANSITIONS = {
    "admin": {
        "Open":    ["Fixed", "Invalid"],
        "Fixed":   ["Invalid", "Open"],
        "Closed":  ["Open", "Fixed"],
        "Invalid": ["Open"],
        # legacy statuses in existing data
        "Verified": ["Open", "Fixed"],
        "Reopen":   ["Fixed", "Invalid"],
    },
    "tester": {
        "Open":    [],
        "Fixed":   ["Closed", "Open"],
        "Closed":  ["Open"],
        "Invalid": [],
        # legacy
        "Verified": ["Open"],
        "Reopen":   ["Closed"],
    },
}


def response(status: int, body) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        "body": json.dumps(body),
    }


def lambda_handler(event: dict, context) -> dict:
    route = event.get("routeKey", "")
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    user_sub = claims.get("sub")
    user_role = claims.get("custom:role", "tester")
    path_params = event.get("pathParameters") or {}
    project_id = path_params.get("projectId")
    bug_id = path_params.get("bugId")

    if route == "GET /projects/{projectId}/bugs":
        return list_bugs(project_id, user_sub, user_role)
    if route == "POST /projects/{projectId}/bugs":
        return create_bug(event, project_id, user_sub, user_role)
    if route == "GET /projects/{projectId}/bugs/{bugId}":
        return get_bug(project_id, bug_id, user_sub, user_role)
    if route == "PATCH /projects/{projectId}/bugs/{bugId}":
        return update_bug(event, project_id, bug_id, user_sub, user_role)
    if route == "PATCH /projects/{projectId}/bugs/{bugId}/status":
        return update_status(event, project_id, bug_id, user_sub, user_role)
    if route == "DELETE /projects/{projectId}/bugs/{bugId}":
        return delete_bug(project_id, bug_id, user_sub, user_role)

    return response(404, {"error": "Not found"})


def _check_project_access(project_id: str, user_sub: str, user_role: str) -> bool:
    if user_role == "admin":
        proj = table.get_item(Key={"PK": f"PROJECT#{project_id}", "SK": "METADATA"}).get("Item")
        return proj is not None
    membership = table.get_item(
        Key={"PK": f"PROJECT#{project_id}", "SK": f"MEMBER#{user_sub}"}
    ).get("Item")
    return membership is not None


def list_bugs(project_id: str, user_sub: str, user_role: str) -> dict:
    if not _check_project_access(project_id, user_sub, user_role):
        return response(403, {"error": "Forbidden"})

    result = table.query(
        KeyConditionExpression=Key("PK").eq(f"PROJECT#{project_id}") & Key("SK").begins_with("BUG#"),
    )
    bugs = result.get("Items", [])

    reporter_subs = {b.get("reportedBy") for b in bugs if b.get("reportedBy")}
    name_map = {}
    for sub in reporter_subs:
        profile = table.get_item(Key={"PK": f"USER#{sub}", "SK": "PROFILE"}).get("Item", {})
        name_map[sub] = profile.get("name") or profile.get("email", "").split("@")[0] or sub[:8]
    for bug in bugs:
        bug["reporterName"] = name_map.get(bug.get("reportedBy", ""), "Unknown")

    return response(200, {"bugs": bugs})


def create_bug(event: dict, project_id: str, user_sub: str, user_role: str) -> dict:
    if not _check_project_access(project_id, user_sub, user_role):
        return response(403, {"error": "Forbidden"})

    body = json.loads(event.get("body") or "{}")
    title = body.get("title", "").strip()
    description = body.get("description", "").strip()
    screenshots = body.get("screenshots", [])[:10]
    documents = body.get("documents", [])[:3]
    videos = body.get("videos", [])[:5]

    if not title:
        return response(400, {"error": "title is required"})

    bug_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    item = {
        "PK": f"PROJECT#{project_id}",
        "SK": f"BUG#{bug_id}",
        "bugId": bug_id,
        "projectId": project_id,
        "title": title,
        "description": description,
        "screenshots": screenshots,
        "documents": documents,
        "videos": videos,
        "status": "Open",
        "reportedBy": user_sub,
        "createdAt": now,
        "updatedAt": now,
    }
    table.put_item(Item=item)

    return response(201, item)


def get_bug(project_id: str, bug_id: str, user_sub: str, user_role: str) -> dict:
    if not _check_project_access(project_id, user_sub, user_role):
        return response(403, {"error": "Forbidden"})

    item = table.get_item(Key={"PK": f"PROJECT#{project_id}", "SK": f"BUG#{bug_id}"}).get("Item")
    if not item:
        return response(404, {"error": "Bug not found"})

    return response(200, item)


def update_bug(event: dict, project_id: str, bug_id: str, user_sub: str, user_role: str) -> dict:
    if not _check_project_access(project_id, user_sub, user_role):
        return response(403, {"error": "Forbidden"})

    bug = table.get_item(Key={"PK": f"PROJECT#{project_id}", "SK": f"BUG#{bug_id}"}).get("Item")
    if not bug:
        return response(404, {"error": "Bug not found"})

    if user_role == "tester" and bug.get("reportedBy") != user_sub:
        return response(403, {"error": "Forbidden"})

    body = json.loads(event.get("body") or "{}")
    title = body.get("title", bug.get("title", "")).strip()
    description = body.get("description", bug.get("description", "")).strip()
    new_status = body.get("status")

    if not title:
        return response(400, {"error": "title is required"})

    if new_status and new_status != bug.get("status"):
        if user_role == "admin":
            if new_status not in _ALL:
                return response(400, {"error": "Invalid status"})
        else:
            current_status = bug.get("status", "")
            allowed = VALID_TRANSITIONS.get(user_role, {}).get(current_status, [])
            if new_status not in allowed:
                return response(400, {"error": f"Cannot transition to {new_status}"})

    if not new_status or new_status == bug.get("status"):
        new_status = bug.get("status")

    now = datetime.now(timezone.utc).isoformat()
    expr_names = {}
    expr_values = {":t": title, ":d": description, ":ts": now, ":s": new_status}
    expr_names["#s"] = "status"
    update_parts = ["title = :t", "description = :d", "#s = :s", "updatedAt = :ts"]

    # Handle screenshots: delete removed S3 keys, update list
    new_screenshots = None
    if "screenshots" in body:
        new_screenshots = body["screenshots"]
        old_screenshots = bug.get("screenshots", [])
        removed_keys = [k for k in old_screenshots if k not in new_screenshots]
        for key in removed_keys:
            if BUCKET_NAME and key:
                try:
                    s3.delete_object(Bucket=BUCKET_NAME, Key=key)
                except Exception:
                    pass
        expr_values[":sc"] = new_screenshots
        update_parts.append("screenshots = :sc")

    new_videos = None
    if "videos" in body:
        new_videos = body["videos"]
        old_videos = bug.get("videos", [])
        removed_video_keys = [k for k in old_videos if k not in new_videos]
        for key in removed_video_keys:
            if BUCKET_NAME and key:
                try:
                    s3.delete_object(Bucket=BUCKET_NAME, Key=key)
                except Exception:
                    pass
        expr_values[":vd"] = new_videos
        update_parts.append("videos = :vd")

    update_kwargs = {
        "Key": {"PK": f"PROJECT#{project_id}", "SK": f"BUG#{bug_id}"},
        "UpdateExpression": "SET " + ", ".join(update_parts),
        "ExpressionAttributeValues": expr_values,
        "ExpressionAttributeNames": expr_names,
    }

    table.update_item(**update_kwargs)

    # Trigger notification if newly marked Fixed
    if new_status == "Fixed" and bug.get("status") != "Fixed" and NOTIFICATIONS_FN_ARN:
        reporter_sub = bug.get("reportedBy")
        reporter = table.get_item(Key={"PK": f"USER#{reporter_sub}", "SK": "PROFILE"}).get("Item", {})
        proj = table.get_item(Key={"PK": f"PROJECT#{project_id}", "SK": "METADATA"}).get("Item", {})
        lambda_client.invoke(
            FunctionName=NOTIFICATIONS_FN_ARN,
            InvocationType="Event",
            Payload=json.dumps({
                "type": "BUG_FIXED",
                "bugTitle": bug.get("title"),
                "projectTitle": proj.get("title"),
                "reporterEmail": reporter.get("email"),
                "reporterPhone": reporter.get("phone"),
                "bugId": bug_id,
                "projectId": project_id,
            }).encode(),
        )

    updated = {**bug, "title": title, "description": description, "status": new_status, "updatedAt": now}
    if new_screenshots is not None:
        updated["screenshots"] = new_screenshots
    if new_videos is not None:
        updated["videos"] = new_videos
    return response(200, updated)


def update_status(event: dict, project_id: str, bug_id: str, user_sub: str, user_role: str) -> dict:
    if not _check_project_access(project_id, user_sub, user_role):
        return response(403, {"error": "Forbidden"})

    body = json.loads(event.get("body") or "{}")
    new_status = body.get("status", "")

    bug = table.get_item(Key={"PK": f"PROJECT#{project_id}", "SK": f"BUG#{bug_id}"}).get("Item")
    if not bug:
        return response(404, {"error": "Bug not found"})

    if user_role == "tester" and bug.get("reportedBy") != user_sub:
        return response(403, {"error": "Forbidden"})

    current_status = bug.get("status", "")
    allowed = VALID_TRANSITIONS.get(user_role, {}).get(current_status, [])
    if new_status not in allowed:
        return response(400, {"error": f"Cannot transition from {current_status} to {new_status} as {user_role}"})

    now = datetime.now(timezone.utc).isoformat()
    table.update_item(
        Key={"PK": f"PROJECT#{project_id}", "SK": f"BUG#{bug_id}"},
        UpdateExpression="SET #s = :s, updatedAt = :ts",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": new_status, ":ts": now},
    )

    if new_status == "Fixed" and NOTIFICATIONS_FN_ARN:
        reporter_sub = bug.get("reportedBy")
        reporter = table.get_item(Key={"PK": f"USER#{reporter_sub}", "SK": "PROFILE"}).get("Item", {})
        proj = table.get_item(Key={"PK": f"PROJECT#{project_id}", "SK": "METADATA"}).get("Item", {})
        lambda_client.invoke(
            FunctionName=NOTIFICATIONS_FN_ARN,
            InvocationType="Event",
            Payload=json.dumps({
                "type": "BUG_FIXED",
                "bugTitle": bug.get("title"),
                "projectTitle": proj.get("title"),
                "reporterEmail": reporter.get("email"),
                "reporterPhone": reporter.get("phone"),
                "bugId": bug_id,
                "projectId": project_id,
            }).encode(),
        )

    return response(200, {"status": new_status, "updatedAt": now})


def delete_bug(project_id: str, bug_id: str, user_sub: str, user_role: str) -> dict:
    if not _check_project_access(project_id, user_sub, user_role):
        return response(403, {"error": "Forbidden"})

    bug = table.get_item(Key={"PK": f"PROJECT#{project_id}", "SK": f"BUG#{bug_id}"}).get("Item")
    if not bug:
        return response(404, {"error": "Bug not found"})

    table.delete_item(Key={"PK": f"PROJECT#{project_id}", "SK": f"BUG#{bug_id}"})
    return response(200, {"message": "Bug deleted"})

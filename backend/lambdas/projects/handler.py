import json
import os
import uuid
from datetime import datetime, timezone
import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config

dynamodb = boto3.resource("dynamodb")
TABLE_NAME = os.environ["TABLE_NAME"]
table = dynamodb.Table(TABLE_NAME)

s3 = boto3.client("s3", config=Config(signature_version="s3v4"))
BUCKET_NAME = os.environ.get("BUCKET_NAME", "")


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

    if route == "GET /projects":
        return list_projects(user_sub, user_role)
    if route == "POST /projects":
        return create_project(event, user_sub, user_role)
    if route == "GET /projects/{projectId}":
        return get_project(path_params.get("projectId"), user_sub, user_role)
    if route == "GET /projects/{projectId}/members":
        return list_members(path_params.get("projectId"), user_sub, user_role)
    if route == "DELETE /projects/{projectId}/members/{memberId}":
        return remove_member(path_params.get("projectId"), path_params.get("memberId"), user_sub, user_role)
    if route == "GET /projects/{projectId}/reports":
        return list_reports(path_params.get("projectId"), user_sub, user_role)
    if route == "POST /projects/{projectId}/reports":
        return save_report(event, path_params.get("projectId"), user_sub, user_role)
    if route == "DELETE /projects/{projectId}/reports/{reportId}":
        return delete_report(path_params.get("projectId"), path_params.get("reportId"), user_sub, user_role)

    return response(404, {"error": "Not found"})


def list_projects(user_sub: str, user_role: str) -> dict:
    if user_role == "admin":
        admin_result = table.query(
            IndexName="GSI1",
            KeyConditionExpression=Key("GSI1PK").eq(f"ADMIN#{user_sub}"),
        )
        projects = [item for item in admin_result.get("Items", []) if item.get("SK") == "METADATA"]
    else:
        result = table.query(
            IndexName="GSI1",
            KeyConditionExpression=Key("GSI1PK").eq(f"USER#{user_sub}") & Key("GSI1SK").begins_with("PROJECT#"),
        )
        project_ids = [item["GSI1SK"].replace("PROJECT#", "") for item in result.get("Items", [])]
        projects = []
        for pid in project_ids:
            item = table.get_item(Key={"PK": f"PROJECT#{pid}", "SK": "METADATA"}).get("Item")
            if item:
                projects.append(item)

    # Attach tester count to each project
    for proj in projects:
        pid = proj.get("projectId", "")
        count_result = table.query(
            KeyConditionExpression=Key("PK").eq(f"PROJECT#{pid}") & Key("SK").begins_with("MEMBER#"),
            Select="COUNT",
        )
        proj["testerCount"] = count_result.get("Count", 0)

    return response(200, {"projects": projects})


def create_project(event: dict, user_sub: str, user_role: str) -> dict:
    if user_role != "admin":
        return response(403, {"error": "Forbidden"})

    body = json.loads(event.get("body") or "{}")
    title = body.get("title", "").strip()
    if not title:
        return response(400, {"error": "title is required"})

    project_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    table.put_item(
        Item={
            "PK": f"PROJECT#{project_id}",
            "SK": "METADATA",
            "projectId": project_id,
            "title": title,
            "createdBy": user_sub,
            "createdAt": now,
            "GSI1PK": f"ADMIN#{user_sub}",
            "GSI1SK": f"PROJECT#{project_id}",
        }
    )

    # Auto-add all testers from the admin's existing projects
    tester_count = _auto_add_existing_testers(project_id, user_sub, now)

    return response(201, {"projectId": project_id, "title": title, "createdAt": now, "testerCount": tester_count})


def _auto_add_existing_testers(new_project_id: str, admin_sub: str, now: str) -> int:
    existing_projects = table.query(
        IndexName="GSI1",
        KeyConditionExpression=Key("GSI1PK").eq(f"ADMIN#{admin_sub}"),
    ).get("Items", [])

    seen = set()
    count = 0
    for proj in existing_projects:
        proj_id = proj.get("projectId")
        if not proj_id or proj_id == new_project_id:
            continue
        members = table.query(
            KeyConditionExpression=Key("PK").eq(f"PROJECT#{proj_id}") & Key("SK").begins_with("MEMBER#"),
        ).get("Items", [])
        for m in members:
            tester_sub = m["SK"].replace("MEMBER#", "")
            if tester_sub in seen:
                continue
            seen.add(tester_sub)
            try:
                table.put_item(
                    Item={
                        "PK": f"PROJECT#{new_project_id}",
                        "SK": f"MEMBER#{tester_sub}",
                        "email": m.get("email", ""),
                        "role": "tester",
                        "joinedAt": now,
                        "GSI1PK": f"USER#{tester_sub}",
                        "GSI1SK": f"PROJECT#{new_project_id}",
                    },
                    ConditionExpression="attribute_not_exists(SK)",
                )
                count += 1
            except Exception:
                pass
    return count


def get_project(project_id: str, user_sub: str, user_role: str) -> dict:
    item = table.get_item(Key={"PK": f"PROJECT#{project_id}", "SK": "METADATA"}).get("Item")
    if not item:
        return response(404, {"error": "Project not found"})

    if user_role == "tester":
        membership = table.get_item(
            Key={"PK": f"PROJECT#{project_id}", "SK": f"MEMBER#{user_sub}"}
        ).get("Item")
        if not membership:
            return response(403, {"error": "Forbidden"})

    members = table.query(
        KeyConditionExpression=Key("PK").eq(f"PROJECT#{project_id}") & Key("SK").begins_with("MEMBER#"),
        Select="COUNT",
    )
    item["testerCount"] = members.get("Count", 0)

    return response(200, item)


def list_members(project_id: str, user_sub: str, user_role: str) -> dict:
    if user_role != "admin":
        return response(403, {"error": "Forbidden"})

    proj = table.get_item(Key={"PK": f"PROJECT#{project_id}", "SK": "METADATA"}).get("Item")
    if not proj:
        return response(404, {"error": "Project not found"})

    result = table.query(
        KeyConditionExpression=Key("PK").eq(f"PROJECT#{project_id}") & Key("SK").begins_with("MEMBER#"),
    )
    members = [
        {
            "memberId": item["SK"].replace("MEMBER#", ""),
            "email": item.get("email", ""),
            "name": item.get("name", item.get("email", "").split("@")[0]),
            "joinedAt": item.get("joinedAt", ""),
        }
        for item in result.get("Items", [])
    ]

    return response(200, {"members": members})


def remove_member(project_id: str, member_id: str, user_sub: str, user_role: str) -> dict:
    if user_role != "admin":
        return response(403, {"error": "Forbidden"})

    proj = table.get_item(Key={"PK": f"PROJECT#{project_id}", "SK": "METADATA"}).get("Item")
    if not proj:
        return response(404, {"error": "Project not found"})

    table.delete_item(Key={"PK": f"PROJECT#{project_id}", "SK": f"MEMBER#{member_id}"})
    table.delete_item(Key={"PK": f"USER#{member_id}", "SK": f"PROJECT#{project_id}"})

    return response(200, {"message": "Member removed"})


def _check_project_access(project_id: str, user_sub: str, user_role: str) -> bool:
    if user_role == "admin":
        return table.get_item(Key={"PK": f"PROJECT#{project_id}", "SK": "METADATA"}).get("Item") is not None
    return table.get_item(Key={"PK": f"PROJECT#{project_id}", "SK": f"MEMBER#{user_sub}"}).get("Item") is not None


def list_reports(project_id: str, user_sub: str, user_role: str) -> dict:
    if not _check_project_access(project_id, user_sub, user_role):
        return response(403, {"error": "Forbidden"})

    result = table.query(
        KeyConditionExpression=Key("PK").eq(f"PROJECT#{project_id}") & Key("SK").begins_with("REPORT#"),
    )
    reports = [
        {k: v for k, v in item.items() if k not in ("PK", "SK")}
        for item in result.get("Items", [])
    ]
    reports.sort(key=lambda r: r.get("uploadedAt", ""))
    return response(200, {"reports": reports})


def save_report(event: dict, project_id: str, user_sub: str, user_role: str) -> dict:
    if not _check_project_access(project_id, user_sub, user_role):
        return response(403, {"error": "Forbidden"})

    # Check max 5
    existing = table.query(
        KeyConditionExpression=Key("PK").eq(f"PROJECT#{project_id}") & Key("SK").begins_with("REPORT#"),
        Select="COUNT",
    )
    if existing.get("Count", 0) >= 5:
        return response(400, {"error": "Maximum 5 report files per project"})

    body = json.loads(event.get("body") or "{}")
    s3_key = body.get("s3Key", "").strip()
    filename = body.get("filename", "").strip()
    content_type = body.get("contentType", "").strip()

    if not s3_key or not filename:
        return response(400, {"error": "s3Key and filename are required"})

    report_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    table.put_item(Item={
        "PK": f"PROJECT#{project_id}",
        "SK": f"REPORT#{report_id}",
        "reportId": report_id,
        "projectId": project_id,
        "s3Key": s3_key,
        "filename": filename,
        "contentType": content_type,
        "uploadedBy": user_sub,
        "uploadedAt": now,
    })

    return response(201, {
        "reportId": report_id,
        "projectId": project_id,
        "s3Key": s3_key,
        "filename": filename,
        "contentType": content_type,
        "uploadedBy": user_sub,
        "uploadedAt": now,
    })


def delete_report(project_id: str, report_id: str, user_sub: str, user_role: str) -> dict:
    if not _check_project_access(project_id, user_sub, user_role):
        return response(403, {"error": "Forbidden"})

    report = table.get_item(Key={"PK": f"PROJECT#{project_id}", "SK": f"REPORT#{report_id}"}).get("Item")
    if not report:
        return response(404, {"error": "Report not found"})

    # Delete from S3
    if BUCKET_NAME and report.get("s3Key"):
        try:
            s3.delete_object(Bucket=BUCKET_NAME, Key=report["s3Key"])
        except Exception:
            pass

    table.delete_item(Key={"PK": f"PROJECT#{project_id}", "SK": f"REPORT#{report_id}"})
    return response(200, {"message": "Report deleted"})

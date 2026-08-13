"""Projects, Bin and Reports — all org-scoped (LLD §9.2).

Every project belongs to an org, and every org member sees every project. The
old per-project membership fan-out (`_auto_add_existing_testers`, the
`MEMBER#`-driven tester branch of `list_projects`, and the `/members` routes)
is gone: visibility is now a single `orgId` comparison.
"""

import os

import boto3
from boto3.dynamodb.conditions import Key

from tfcommon.auth import get_caller, require_developer, require_org, require_project
from tfcommon.db import (
    BUG_PREFIX,
    GSI1,
    METADATA,
    REPORT_PREFIX,
    delete_all,
    get_item,
    new_id,
    now_iso,
    org_pk,
    project_pk,
    project_sk,
    query_all,
    report_sk,
    table,
)
from tfcommon.http import ApiError, api_handler, json_body, not_found, required, response
from tfcommon.org import list_members

s3 = boto3.client("s3")
BUCKET_NAME = os.environ.get("BUCKET_NAME", "")

MAX_TITLE = 80
MAX_REPORTS = 5


@api_handler
def lambda_handler(event: dict, context) -> dict:
    route = event.get("routeKey", "")
    params = event.get("pathParameters") or {}
    project_id = params.get("projectId")
    caller = get_caller(event)

    if route == "GET /projects":
        return list_projects(caller)
    if route == "POST /projects":
        return create_project(event, caller)
    if route == "GET /projects/bin":
        return list_bin(caller)
    if route == "GET /projects/{projectId}":
        return get_project(project_id, caller)
    if route == "PATCH /projects/{projectId}":
        return rename_project(event, project_id, caller)
    if route == "DELETE /projects/{projectId}":
        return soft_delete_project(project_id, caller)
    if route == "POST /projects/{projectId}/restore":
        return restore_project(project_id, caller)
    if route == "DELETE /projects/{projectId}/permanent":
        return permanent_delete_project(project_id, caller)
    if route == "GET /projects/{projectId}/reports":
        return list_reports(project_id, caller)
    if route == "POST /projects/{projectId}/reports":
        return save_report(event, project_id, caller)
    if route == "DELETE /projects/{projectId}/reports/{reportId}":
        return delete_report(project_id, params.get("reportId"), caller)

    return not_found()


# ── Listing (AP-2 / AP-3) ────────────────────────────────────────────────────

def _org_projects(caller) -> list:
    return query_all(
        IndexName=GSI1,
        KeyConditionExpression=Key("GSI1PK").eq(org_pk(caller.org_id))
        & Key("GSI1SK").begins_with("PROJECT#"),
    )


def list_projects(caller) -> dict:
    """One GSI query for the whole dashboard.

    Member count is identical for every project under the org model, so the old
    per-project COUNT query on a ThreadPoolExecutor collapses into one read.
    """
    projects = [p for p in _org_projects(caller) if not p.get("deletedAt")]
    count = len(list_members(caller.org_id))
    for project in projects:
        project["memberCount"] = count
    projects.sort(key=lambda p: p.get("createdAt", ""), reverse=True)
    return response(200, {"projects": projects})


def list_bin(caller) -> dict:
    """Visible to every role; only Developers and the Owner get controls (A3)."""
    projects = [p for p in _org_projects(caller) if p.get("deletedAt")]
    projects.sort(key=lambda p: p.get("deletedAt", ""), reverse=True)
    return response(200, {"projects": projects})


def get_project(project_id: str, caller) -> dict:
    return response(200, require_project(caller, project_id))


# ── Mutations ────────────────────────────────────────────────────────────────

def create_project(event: dict, caller) -> dict:
    require_developer(caller)
    body = json_body(event)
    (title,) = required(body, "title")
    if len(title) > MAX_TITLE:
        raise ApiError(400, f"Title must be {MAX_TITLE} characters or fewer.", "title_too_long")

    project_id = new_id()
    now = now_iso()
    item = {
        "PK": project_pk(project_id),
        "SK": METADATA,
        "projectId": project_id,
        "orgId": caller.org_id,
        "title": title,
        "createdBy": caller.sub,
        "createdAt": now,
        "GSI1PK": org_pk(caller.org_id),
        "GSI1SK": project_sk(project_id),
    }
    table.put_item(Item=item)

    # No tester back-fill: org membership already grants access to this project.
    item["memberCount"] = len(list_members(caller.org_id))
    return response(201, item)


def rename_project(event: dict, project_id: str, caller) -> dict:
    require_developer(caller)
    require_project(caller, project_id)
    body = json_body(event)
    (title,) = required(body, "title")
    if len(title) > MAX_TITLE:
        raise ApiError(400, f"Title must be {MAX_TITLE} characters or fewer.", "title_too_long")

    table.update_item(
        Key={"PK": project_pk(project_id), "SK": METADATA},
        UpdateExpression="SET title = :t",
        ExpressionAttributeValues={":t": title},
    )
    return response(200, {"projectId": project_id, "title": title})


def soft_delete_project(project_id: str, caller) -> dict:
    require_developer(caller)
    require_project(caller, project_id)
    now = now_iso()
    table.update_item(
        Key={"PK": project_pk(project_id), "SK": METADATA},
        UpdateExpression="SET deletedAt = :now",
        ExpressionAttributeValues={":now": now},
    )
    return response(200, {"projectId": project_id, "deletedAt": now})


def restore_project(project_id: str, caller) -> dict:
    require_developer(caller)
    require_project(caller, project_id, allow_deleted=True)
    table.update_item(
        Key={"PK": project_pk(project_id), "SK": METADATA},
        UpdateExpression="REMOVE deletedAt",
    )
    return response(200, {"projectId": project_id})


def permanent_delete_project(project_id: str, caller) -> dict:
    """Purge the project partition and every S3 object it references."""
    require_developer(caller)
    require_project(caller, project_id, allow_deleted=True)

    items = query_all(KeyConditionExpression=Key("PK").eq(project_pk(project_id)))

    keys = []
    for item in items:
        sk = item.get("SK", "")
        if sk.startswith(BUG_PREFIX):
            for field in ("screenshots", "videos", "documents"):
                keys.extend(item.get(field) or [])
        elif sk.startswith(REPORT_PREFIX) and item.get("s3Key"):
            keys.append(item["s3Key"])

    _delete_s3_objects(keys)
    deleted = delete_all(items)

    return response(200, {"projectId": project_id, "itemsDeleted": deleted})


def _delete_s3_objects(keys: list) -> None:
    if not keys or not BUCKET_NAME:
        return
    unique = [{"Key": k} for k in dict.fromkeys(keys) if k]
    for i in range(0, len(unique), 1000):  # DeleteObjects caps at 1000 per call
        try:
            s3.delete_objects(Bucket=BUCKET_NAME, Delete={"Objects": unique[i:i + 1000]})
        except Exception as err:  # noqa: BLE001
            print(f"S3 delete failed: {err}")


# ── Reports ──────────────────────────────────────────────────────────────────

def list_reports(project_id: str, caller) -> dict:
    """Readable by every role, including Testers (A1)."""
    require_project(caller, project_id)
    reports = query_all(
        KeyConditionExpression=Key("PK").eq(project_pk(project_id))
        & Key("SK").begins_with(REPORT_PREFIX),
    )
    reports.sort(key=lambda r: r.get("uploadedAt", ""), reverse=True)
    return response(200, {"reports": reports})


def save_report(event: dict, project_id: str, caller) -> dict:
    require_developer(caller)
    require_project(caller, project_id)
    body = json_body(event)
    (s3_key, filename, content_type) = required(body, "s3Key", "filename", "contentType")

    existing = table.query(
        KeyConditionExpression=Key("PK").eq(project_pk(project_id))
        & Key("SK").begins_with(REPORT_PREFIX),
        Select="COUNT",
    ).get("Count", 0)
    if existing >= MAX_REPORTS:
        raise ApiError(400, f"A project can hold at most {MAX_REPORTS} reports.", "report_limit")

    report_id = new_id()
    item = {
        "PK": project_pk(project_id),
        "SK": report_sk(report_id),
        "reportId": report_id,
        "projectId": project_id,
        "s3Key": s3_key,
        "filename": filename,
        "contentType": content_type,
        "uploadedBy": caller.sub,
        "uploadedAt": now_iso(),
    }
    table.put_item(Item=item)
    return response(201, item)


def delete_report(project_id: str, report_id: str, caller) -> dict:
    require_developer(caller)
    require_project(caller, project_id)
    if not report_id:
        raise ApiError(400, "'reportId' is required.", "missing_field")

    report = get_item(project_pk(project_id), report_sk(report_id))
    if not report:
        raise ApiError(404, "Report not found.", "not_found")

    _delete_s3_objects([report.get("s3Key")])
    table.delete_item(Key={"PK": project_pk(project_id), "SK": report_sk(report_id)})
    return response(200, {"reportId": report_id})

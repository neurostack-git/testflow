"""Presigned S3 upload and view URLs (LLD §9.4).

SECURITY: every key handled here is authorised against the caller's org before
a URL is minted. The previous implementation presigned any key it was given,
so an authenticated user could read another workspace's attachments simply by
knowing or guessing the key. `_authorise_key` closes that (INV-4).
"""

import os
import uuid

import boto3
from botocore.config import Config

from tfcommon.auth import get_caller, require_project
from tfcommon.http import ApiError, api_handler, json_body, not_found, required, response

s3 = boto3.client("s3", config=Config(signature_version="s3v4"))
BUCKET_NAME = os.environ["BUCKET_NAME"]

ALLOWED_UPLOAD_TYPES = {
    "image/png": "screenshots",
    "image/jpeg": "screenshots",
    "image/webp": "screenshots",
    "image/gif": "screenshots",
    "text/markdown": "documents",
    "text/plain": "documents",
    "application/pdf": "documents",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "documents",
    "video/mp4": "videos",
    "video/quicktime": "videos",
    "video/webm": "videos",
    "video/x-m4v": "videos",
    "video/mpeg": "videos",
}

AVATAR_PREFIX = "avatars/"
INLINE_EXTENSIONS = ("pdf", "png", "jpg", "jpeg", "webp", "gif", "txt")


@api_handler
def lambda_handler(event: dict, context) -> dict:
    route = event.get("routeKey", "")
    caller = get_caller(event)

    if route == "POST /attachments/presign":
        return generate_presigned_url(event, caller)
    if route == "GET /attachments/view":
        return get_view_url(event, caller)

    return not_found()


def _authorise_key(caller, key: str) -> None:
    """Every non-avatar key is `{projectId}/...`, so the first segment decides.

    Avatars are readable org-wide by design — they render next to bug reporters
    and chat authors — and their keys embed both a sub and an upload timestamp.
    """
    if key.startswith(AVATAR_PREFIX):
        return
    project_id = key.split("/", 1)[0]
    if not project_id:
        raise ApiError(400, "Malformed attachment key.", "bad_key")
    require_project(caller, project_id, allow_deleted=True)


def generate_presigned_url(event: dict, caller) -> dict:
    body = json_body(event)
    (filename, content_type, project_id) = required(body, "filename", "contentType", "projectId")
    upload_type = body.get("uploadType", "bug")

    # Uploads are always into a project the caller can already reach.
    require_project(caller, project_id)

    folder = ALLOWED_UPLOAD_TYPES.get(content_type)
    if not folder:
        raise ApiError(400, f"File type {content_type} is not allowed.", "bad_file_type")

    safe_filename = os.path.basename(filename).replace("..", "").strip("/\\")
    if not safe_filename:
        raise ApiError(400, "Invalid filename.", "bad_filename")

    if upload_type == "report":
        s3_key = f"{project_id}/reports/{uuid.uuid4()}_{safe_filename}"
    else:
        bug_id = str(body.get("bugId") or body.get("tempBugId") or uuid.uuid4()).strip()
        s3_key = f"{project_id}/{bug_id}/{folder}/{uuid.uuid4()}_{safe_filename}"

    url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": BUCKET_NAME, "Key": s3_key, "ContentType": content_type},
        ExpiresIn=3600,
    )
    return response(200, {"presignedUrl": url, "s3Key": s3_key})


def get_view_url(event: dict, caller) -> dict:
    params = event.get("queryStringParameters") or {}
    key = (params.get("key") or "").strip()
    if not key:
        raise ApiError(400, "'key' is required.", "missing_field")

    _authorise_key(caller, key)

    inline = (params.get("inline") or "false").lower() == "true"
    want_content = (params.get("content") or "false").lower() == "true"

    filename = key.split("/")[-1]
    if "_" in filename:
        filename = filename.split("_", 1)[1]

    # Text returned directly, so the browser never has to fetch S3 cross-origin.
    if want_content:
        try:
            obj = s3.get_object(Bucket=BUCKET_NAME, Key=key)
            return response(200, {
                "content": obj["Body"].read().decode("utf-8"),
                "filename": filename,
            })
        except Exception as err:  # noqa: BLE001
            print(f"S3 read failed for {key}: {err}")
            raise ApiError(500, "Couldn't read that file.", "read_failed")

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    presign_params = {"Bucket": BUCKET_NAME, "Key": key}

    if inline and ext in INLINE_EXTENSIONS:
        presign_params["ResponseContentDisposition"] = f'inline; filename="{filename}"'
    elif inline and ext == "md":
        presign_params["ResponseContentDisposition"] = f'inline; filename="{filename}"'
        presign_params["ResponseContentType"] = "text/plain; charset=utf-8"
    else:
        # docx and anything else — browsers can't render it inline regardless.
        presign_params["ResponseContentDisposition"] = f'attachment; filename="{filename}"'

    url = s3.generate_presigned_url("get_object", Params=presign_params, ExpiresIn=86400)
    return response(200, {"url": url, "filename": filename})

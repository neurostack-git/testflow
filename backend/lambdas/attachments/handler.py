import json
import os
import uuid
import boto3
from botocore.config import Config

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
}


def response(status: int, body) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        "body": json.dumps(body),
    }


def lambda_handler(event: dict, context) -> dict:
    route = event.get("routeKey", "")
    if route == "POST /attachments/presign":
        return generate_presigned_url(event)
    if route == "GET /attachments/view":
        return get_view_url(event)
    return response(404, {"error": "Not found"})


def generate_presigned_url(event: dict) -> dict:
    body = json.loads(event.get("body") or "{}")
    filename = body.get("filename", "").strip()
    content_type = body.get("contentType", "").strip()
    project_id = body.get("projectId", "").strip()
    upload_type = body.get("uploadType", "bug")

    if not filename or not content_type or not project_id:
        return response(400, {"error": "filename, contentType, and projectId are required"})

    folder = ALLOWED_UPLOAD_TYPES.get(content_type)
    if not folder:
        return response(400, {"error": f"File type {content_type} not allowed"})

    if upload_type == "report":
        s3_key = f"{project_id}/reports/{uuid.uuid4()}_{filename}"
    else:
        bug_id = body.get("bugId", body.get("tempBugId", str(uuid.uuid4()))).strip()
        s3_key = f"{project_id}/{bug_id}/{folder}/{uuid.uuid4()}_{filename}"

    presigned_url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": BUCKET_NAME, "Key": s3_key, "ContentType": content_type},
        ExpiresIn=300,
    )

    return response(200, {"presignedUrl": presigned_url, "s3Key": s3_key})


def get_view_url(event: dict) -> dict:
    params = event.get("queryStringParameters") or {}
    key = params.get("key", "").strip()

    if not key:
        return response(400, {"error": "key is required"})

    filename = key.split("/")[-1]
    # split off the uuid_ prefix from filename
    if "_" in filename:
        filename = filename.split("_", 1)[1]

    presigned_url = s3.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": BUCKET_NAME,
            "Key": key,
            "ResponseContentDisposition": f'attachment; filename="{filename}"',
        },
        ExpiresIn=3600,
    )

    return response(200, {"url": presigned_url, "filename": filename})

"""Profile, avatar and phone verification (LLD §9.4).

Password changes are NOT here — both the signed-in change and the forgotten
password reset are pure client-side Cognito calls via Amplify (LLD §7.4), so
they need no endpoint, no IAM and no server state.
"""

import os
import secrets
import time
from datetime import datetime, timezone

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from tfcommon.auth import get_caller
from tfcommon.db import (
    METADATA,
    OTP_PHONE,
    PROFILE,
    get_item,
    member_sk,
    org_pk,
    otp_pk,
    table,
    user_pk,
)
from tfcommon.http import ApiError, api_handler, json_body, not_found, required, response

cognito = boto3.client("cognito-idp")
sns = boto3.client("sns", region_name="ap-south-1")
s3 = boto3.client("s3", config=Config(signature_version="s3v4"))

USER_POOL_ID = os.environ["USER_POOL_ID"]
BUCKET_NAME = os.environ.get("BUCKET_NAME", "")

OTP_TTL_SECONDS = 600
MAX_NAME = 60


@api_handler
def lambda_handler(event: dict, context) -> dict:
    route = event.get("routeKey", "")
    caller = get_caller(event)

    if route == "GET /users/me":
        return get_profile(caller)
    if route == "PATCH /users/me":
        return update_profile(event, caller)
    if route == "POST /users/me/phone/send-otp":
        return send_phone_otp(event, caller)
    if route == "POST /users/me/phone/verify-otp":
        return verify_phone_otp(event, caller)
    if route == "POST /users/me/avatar/presign":
        return presign_avatar(caller)
    if route == "PATCH /users/me/avatar":
        return update_avatar(event, caller)
    if route == "DELETE /users/me/avatar":
        return delete_avatar(caller)

    return not_found()


# ── Profile ──────────────────────────────────────────────────────────────────

def get_profile(caller) -> dict:
    item = get_item(user_pk(caller.sub), PROFILE)
    if not item:
        raise ApiError(404, "Profile not found.", "not_found")
    item.pop("PK", None)
    item.pop("SK", None)

    # Workspace context replaces the old `adminName` lookup, which walked from a
    # tester's membership back to the owning admin.
    org = get_item(org_pk(caller.org_id), METADATA) or {}
    item["orgId"] = caller.org_id
    item["orgName"] = org.get("name", "")
    item["isOwner"] = caller.is_owner

    return response(200, item)


def update_profile(event: dict, caller) -> dict:
    body = json_body(event)
    (name,) = required(body, "name")
    if len(name) > MAX_NAME:
        raise ApiError(400, f"Name must be {MAX_NAME} characters or fewer.", "name_too_long")

    table.update_item(
        Key={"PK": user_pk(caller.sub), "SK": PROFILE},
        UpdateExpression="SET #n = :n, email = if_not_exists(email, :e)",
        ExpressionAttributeNames={"#n": "name"},
        ExpressionAttributeValues={":n": name, ":e": caller.email},
    )
    # Keep the denormalised copy on the membership row in step, so the Team page
    # does not need a profile read per member.
    table.update_item(
        Key={"PK": org_pk(caller.org_id), "SK": member_sk(caller.sub)},
        UpdateExpression="SET #n = :n",
        ExpressionAttributeNames={"#n": "name"},
        ExpressionAttributeValues={":n": name},
    )

    try:
        cognito.admin_update_user_attributes(
            UserPoolId=USER_POOL_ID,
            Username=caller.sub,
            UserAttributes=[{"Name": "name", "Value": name}],
        )
    except ClientError as err:
        print(f"Cognito name update failed: {err}")

    return response(200, {"name": name})


# ── Phone verification ───────────────────────────────────────────────────────

def _normalise_phone(phone: str) -> str:
    for char in " -()":
        phone = phone.replace(char, "")
    return phone.strip()


def send_phone_otp(event: dict, caller) -> dict:
    body = json_body(event)
    (raw,) = required(body, "phone")
    phone = _normalise_phone(raw)
    if not phone.startswith("+"):
        raise ApiError(
            400,
            "Include your country code (e.g. +1 for US, +91 for India, +44 for UK).",
            "missing_country_code",
        )

    otp = str(secrets.randbelow(1000000)).zfill(6)
    # TTL auto-purges the row, but verify_phone_otp still checks expiry in-app
    # because DynamoDB TTL deletion can lag the timestamp by up to ~48h.
    expires_at = int(time.time()) + OTP_TTL_SECONDS

    table.put_item(Item={
        "PK": otp_pk(caller.sub), "SK": OTP_PHONE,
        "otp": otp, "phone": phone, "expiresAt": expires_at,
    })

    try:
        sns.publish(
            PhoneNumber=phone,
            Message=f"Your TestFlow verification code is: {otp}. Valid for 10 minutes.",
        )
    except ClientError as err:
        raise ApiError(
            500,
            f"Couldn't send the SMS: {err.response['Error']['Message']}",
            "sms_failed",
        )

    return response(200, {"sent": True})


def verify_phone_otp(event: dict, caller) -> dict:
    body = json_body(event)
    (otp,) = required(body, "otp")

    record = get_item(otp_pk(caller.sub), OTP_PHONE)
    if not record:
        raise ApiError(400, "No pending verification. Please request a new code.", "no_otp")
    if int(record.get("expiresAt", 0)) < int(time.time()):
        raise ApiError(400, "That code has expired. Please request a new one.", "otp_expired")
    if record.get("otp") != otp:
        raise ApiError(400, "Invalid code. Please try again.", "otp_invalid")

    phone = record.get("phone", "")
    table.update_item(
        Key={"PK": user_pk(caller.sub), "SK": PROFILE},
        UpdateExpression="SET phone = :p",
        ExpressionAttributeValues={":p": phone},
    )

    try:
        cognito.admin_update_user_attributes(
            UserPoolId=USER_POOL_ID,
            Username=caller.sub,
            UserAttributes=[{"Name": "custom:phone_number", "Value": phone}],
        )
    except ClientError as err:
        print(f"Cognito phone update failed: {err}")

    table.delete_item(Key={"PK": otp_pk(caller.sub), "SK": OTP_PHONE})
    return response(200, {"phone": phone})


# ── Avatar ───────────────────────────────────────────────────────────────────

def presign_avatar(caller) -> dict:
    if not BUCKET_NAME:
        raise ApiError(500, "Storage is not configured.", "no_storage")
    timestamp = int(datetime.now(timezone.utc).timestamp())
    key = f"avatars/{caller.sub}/{timestamp}.jpg"
    url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": BUCKET_NAME, "Key": key, "ContentType": "image/jpeg"},
        ExpiresIn=300,
    )
    return response(200, {"presignedUrl": url, "s3Key": key})


def update_avatar(event: dict, caller) -> dict:
    body = json_body(event)
    (s3_key,) = required(body, "s3Key")

    existing = get_item(user_pk(caller.sub), PROFILE) or {}
    old_key = existing.get("avatarKey")
    if old_key and old_key != s3_key:
        _delete_object(old_key)

    table.update_item(
        Key={"PK": user_pk(caller.sub), "SK": PROFILE},
        UpdateExpression="SET avatarKey = :k",
        ExpressionAttributeValues={":k": s3_key},
    )
    return response(200, {"avatarKey": s3_key})


def delete_avatar(caller) -> dict:
    existing = get_item(user_pk(caller.sub), PROFILE) or {}
    _delete_object(existing.get("avatarKey"))
    table.update_item(
        Key={"PK": user_pk(caller.sub), "SK": PROFILE},
        UpdateExpression="REMOVE avatarKey",
    )
    return response(200, {"deleted": True})


def _delete_object(key) -> None:
    if not key or not BUCKET_NAME:
        return
    try:
        s3.delete_object(Bucket=BUCKET_NAME, Key=key)
    except Exception as err:  # noqa: BLE001
        print(f"S3 delete failed: {err}")

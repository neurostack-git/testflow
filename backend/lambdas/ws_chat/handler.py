"""WebSocket chat — connect, disconnect, send, typing (LLD §9.4, D15).

Authorisation differs from the HTTP Lambdas: there is no JWT authorizer on the
WebSocket API, so identity comes from `cognito.get_user(AccessToken)` at
$connect. The org check is then the same single `orgId` comparison used
everywhere else, resolved through the caller's profile row.
"""

import json
import os
from datetime import datetime, timedelta, timezone

import boto3
from boto3.dynamodb.conditions import Key

from tfcommon.db import (
    METADATA,
    PROFILE,
    WSCONN_META,
    WSCONN_PREFIX,
    get_item,
    msg_sk,
    new_id,
    notif_sk,
    now_iso,
    project_pk,
    table,
    user_pk,
    wsconn_pk,
    wsconn_sk,
)

cognito = boto3.client("cognito-idp")
WS_ENDPOINT = os.environ.get("WS_API_ENDPOINT", "")

MAX_MESSAGE = 4000
CONNECTION_TTL_HOURS = 2


def _apigw():
    return boto3.client("apigatewaymanagementapi", endpoint_url=WS_ENDPOINT)


def lambda_handler(event: dict, context) -> dict:
    ctx = event.get("requestContext", {})
    route = ctx.get("routeKey", "")
    connection_id = ctx.get("connectionId", "")

    if route == "$connect":
        return _connect(event, connection_id)
    if route == "$disconnect":
        return _disconnect(connection_id)
    return _message(event, connection_id)


# ── $connect ─────────────────────────────────────────────────────────────────

def _connect(event: dict, connection_id: str) -> dict:
    qp = event.get("queryStringParameters") or {}
    token = qp.get("token", "")
    project_id = qp.get("projectId", "")

    if not token or not project_id:
        return {"statusCode": 400}

    try:
        user_info = cognito.get_user(AccessToken=token)
    except Exception:
        return {"statusCode": 401}

    attrs = {a["Name"]: a["Value"] for a in user_info.get("UserAttributes", [])}
    user_sub = attrs.get("sub", "")
    if not user_sub:
        return {"statusCode": 401}

    # Profile is the source of truth for role and org — never the token claims.
    profile = get_item(user_pk(user_sub), PROFILE)
    if not profile or profile.get("deleted") or not profile.get("orgId"):
        return {"statusCode": 403}

    if not _in_caller_org(project_id, profile["orgId"]):
        return {"statusCode": 403}

    user_name = profile.get("name") or attrs.get("email", "").split("@")[0]
    user_role = profile.get("role", "tester")
    expires_at = int((datetime.now(timezone.utc) + timedelta(hours=CONNECTION_TTL_HOURS)).timestamp())

    # Two rows: one keyed by connection for fast lookup, one under the project
    # for broadcast fan-out.
    table.put_item(Item={
        "PK": wsconn_pk(connection_id), "SK": WSCONN_META,
        "connectionId": connection_id, "projectId": project_id,
        "userSub": user_sub, "userName": user_name, "userRole": user_role,
        "orgId": profile["orgId"], "expiresAt": expires_at,
    })
    table.put_item(Item={
        "PK": project_pk(project_id), "SK": wsconn_sk(connection_id),
        "connectionId": connection_id, "userSub": user_sub,
        "userName": user_name, "expiresAt": expires_at,
    })

    return {"statusCode": 200}


def _in_caller_org(project_id: str, org_id: str) -> bool:
    project = get_item(project_pk(project_id), METADATA)
    if not project or project.get("deletedAt"):
        return False
    return project.get("orgId") == org_id


# ── $disconnect ──────────────────────────────────────────────────────────────

def _disconnect(connection_id: str) -> dict:
    conn = get_item(wsconn_pk(connection_id), WSCONN_META)
    if conn:
        _drop_connection(conn.get("projectId", ""), connection_id)
    return {"statusCode": 200}


def _drop_connection(project_id: str, connection_id: str) -> None:
    if project_id:
        table.delete_item(Key={"PK": project_pk(project_id), "SK": wsconn_sk(connection_id)})
    table.delete_item(Key={"PK": wsconn_pk(connection_id), "SK": WSCONN_META})


# ── Custom routes ────────────────────────────────────────────────────────────

def _message(event: dict, connection_id: str) -> dict:
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return {"statusCode": 400}

    conn = get_item(wsconn_pk(connection_id), WSCONN_META)
    if not conn:
        return {"statusCode": 401}

    action = body.get("action", "")
    project_id = conn["projectId"]

    if action == "sendMessage":
        content = (body.get("content") or "").strip()
        if not content or len(content) > MAX_MESSAGE:
            return {"statusCode": 400}
        return _handle_send(
            project_id, connection_id,
            conn["userSub"], conn["userName"], conn.get("userRole", "tester"),
            content, body.get("mentions") or [],
        )

    if action == "typing":
        _broadcast(
            project_id,
            {"type": "TYPING", "userName": conn["userName"], "userSub": conn["userSub"]},
            exclude_conn=connection_id,
        )
        return {"statusCode": 200}

    return {"statusCode": 400}


def _handle_send(project_id, connection_id, sender_sub, sender_name, sender_role,
                 content, mentions) -> dict:
    message_id = new_id()
    now = now_iso()

    item = {
        "PK": project_pk(project_id),
        "SK": msg_sk(now, message_id),
        "messageId": message_id,
        "projectId": project_id,
        "senderSub": sender_sub,
        "senderName": sender_name,
        "senderRole": sender_role,
        "content": content,
        "mentions": mentions,
        "createdAt": now,
    }
    table.put_item(Item=item)

    broadcast = {k: v for k, v in item.items() if k not in ("PK", "SK")}
    _broadcast(project_id, {"type": "MESSAGE", "message": broadcast})

    if mentions:
        project = get_item(project_pk(project_id), METADATA) or {}
        online = {
            c.get("userSub")
            for c in table.query(
                KeyConditionExpression=Key("PK").eq(project_pk(project_id))
                & Key("SK").begins_with(WSCONN_PREFIX),
            ).get("Items", [])
        }
        # Only notify mentioned users who are not currently watching the room.
        for sub in mentions:
            if sub != sender_sub and sub not in online:
                _create_notif(sub, project_id, project.get("title", ""), sender_name, content, now)

    return {"statusCode": 200}


def _create_notif(user_sub, project_id, project_title, from_name, content, now) -> None:
    notif_id = new_id()
    table.put_item(Item={
        "PK": user_pk(user_sub),
        "SK": notif_sk(now, notif_id),
        "notifId": notif_id,
        "type": "mention",
        "projectId": project_id,
        "projectTitle": project_title,
        "fromName": from_name,
        "content": content[:120],
        "read": False,
        "createdAt": now,
    })


def _broadcast(project_id: str, data: dict, exclude_conn: str = "") -> None:
    connections = table.query(
        KeyConditionExpression=Key("PK").eq(project_pk(project_id))
        & Key("SK").begins_with(WSCONN_PREFIX),
    ).get("Items", [])
    if not connections:
        return

    apigw = _apigw()
    payload = json.dumps(data, default=str).encode()

    for conn in connections:
        conn_id = conn.get("connectionId") or conn.get("SK", "").replace(WSCONN_PREFIX, "")
        if not conn_id or conn_id == exclude_conn:
            continue
        try:
            apigw.post_to_connection(ConnectionId=conn_id, Data=payload)
        except Exception as err:  # noqa: BLE001
            text = str(err)
            if "GoneException" in text or "410" in text:
                _drop_connection(project_id, conn_id)

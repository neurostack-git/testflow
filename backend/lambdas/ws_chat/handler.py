import json
import os
import uuid
import boto3
from boto3.dynamodb.conditions import Key
from datetime import datetime, timezone, timedelta

dynamodb = boto3.resource("dynamodb")
TABLE_NAME = os.environ["TABLE_NAME"]
table = dynamodb.Table(TABLE_NAME)
cognito = boto3.client("cognito-idp")

WS_ENDPOINT = os.environ.get("WS_API_ENDPOINT", "")


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


# ── $connect ──────────────────────────────────────────────────────────────────

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
    user_name = attrs.get("name") or attrs.get("email", "").split("@")[0]
    user_role = attrs.get("custom:role", "tester")

    if not _check_access(project_id, user_sub, user_role):
        return {"statusCode": 403}

    # DynamoDB TTL attribute (epoch seconds) — auto-purges stale connection rows
    expires_at = int((datetime.now(timezone.utc) + timedelta(hours=2)).timestamp())

    # WSCONN#<connId>/META — for fast lookup on message/disconnect
    table.put_item(Item={
        "PK": f"WSCONN#{connection_id}",
        "SK": "META",
        "connectionId": connection_id,
        "projectId": project_id,
        "userSub": user_sub,
        "userName": user_name,
        "userRole": user_role,
        "expiresAt": expires_at,
    })

    # PROJECT#<id>/WSCONN#<connId> — for broadcasting to all project members
    table.put_item(Item={
        "PK": f"PROJECT#{project_id}",
        "SK": f"WSCONN#{connection_id}",
        "connectionId": connection_id,
        "userSub": user_sub,
        "userName": user_name,
        "expiresAt": expires_at,
    })

    return {"statusCode": 200}


# ── $disconnect ───────────────────────────────────────────────────────────────

def _disconnect(connection_id: str) -> dict:
    conn = table.get_item(Key={"PK": f"WSCONN#{connection_id}", "SK": "META"}).get("Item")
    if conn:
        project_id = conn.get("projectId", "")
        table.delete_item(Key={"PK": f"PROJECT#{project_id}", "SK": f"WSCONN#{connection_id}"})
        table.delete_item(Key={"PK": f"WSCONN#{connection_id}", "SK": "META"})
    return {"statusCode": 200}


# ── Custom routes ─────────────────────────────────────────────────────────────

def _message(event: dict, connection_id: str) -> dict:
    body = json.loads(event.get("body") or "{}")
    action = body.get("action", "")

    conn = table.get_item(Key={"PK": f"WSCONN#{connection_id}", "SK": "META"}).get("Item")
    if not conn:
        return {"statusCode": 401}

    project_id = conn["projectId"]
    sender_sub = conn["userSub"]
    sender_name = conn["userName"]
    sender_role = conn["userRole"]

    if action == "sendMessage":
        content = body.get("content", "").strip()
        # mentions is a list of user subs (frontend sends these based on dropdown selection)
        mentions = body.get("mentions", [])
        if not content:
            return {"statusCode": 400}
        return _handle_send(project_id, connection_id, sender_sub, sender_name, sender_role, content, mentions)

    if action == "typing":
        _broadcast(project_id, {"type": "TYPING", "userName": sender_name, "userSub": sender_sub},
                   exclude_conn=connection_id)
        return {"statusCode": 200}

    return {"statusCode": 400}


def _handle_send(project_id, connection_id, sender_sub, sender_name, sender_role, content, mentions):
    msg_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    sk = f"MSG#{now}#{msg_id}"

    msg_item = {
        "PK": f"PROJECT#{project_id}",
        "SK": sk,
        "messageId": msg_id,
        "projectId": project_id,
        "senderSub": sender_sub,
        "senderName": sender_name,
        "senderRole": sender_role,
        "content": content,
        "mentions": mentions,
        "createdAt": now,
    }
    table.put_item(Item=msg_item)

    broadcast_msg = {k: v for k, v in msg_item.items() if k not in ("PK", "SK")}
    _broadcast(project_id, {"type": "MESSAGE", "message": broadcast_msg})

    # Fetch project title once (needed for notifications)
    proj = table.get_item(Key={"PK": f"PROJECT#{project_id}", "SK": "METADATA"}).get("Item", {})
    project_title = proj.get("title", "")

    # Get currently online connection subs for this project
    online_result = table.query(
        KeyConditionExpression=Key("PK").eq(f"PROJECT#{project_id}") & Key("SK").begins_with("WSCONN#")
    )
    online_subs = {item.get("userSub") for item in online_result.get("Items", [])}

    if mentions:
        # Only notify users who are explicitly @mentioned
        for mentioned_sub in mentions:
            if mentioned_sub == sender_sub:
                continue
            _create_notif(mentioned_sub, "mention", project_id, project_title, sender_name, content, now)

    return {"statusCode": 200}


def _create_notif(user_sub, notif_type, project_id, project_title, from_name, content, now):
    notif_id = str(uuid.uuid4())
    sk = f"NOTIF#{now}#{notif_id}"
    table.put_item(Item={
        "PK": f"USER#{user_sub}",
        "SK": sk,
        "notifId": notif_id,
        "type": notif_type,
        "projectId": project_id,
        "projectTitle": project_title,
        "fromName": from_name,
        "content": content[:120],
        "read": False,
        "createdAt": now,
    })


def _broadcast(project_id: str, data: dict, exclude_conn: str = None):
    result = table.query(
        KeyConditionExpression=Key("PK").eq(f"PROJECT#{project_id}") & Key("SK").begins_with("WSCONN#")
    )
    if not result.get("Items"):
        return

    apigw = _apigw()
    payload = json.dumps(data, default=str).encode()

    for item in result.get("Items", []):
        conn_id = item.get("connectionId", item.get("SK", "").replace("WSCONN#", ""))
        if conn_id == exclude_conn:
            continue
        try:
            apigw.post_to_connection(ConnectionId=conn_id, Data=payload)
        except Exception as e:
            err = str(e)
            if "GoneException" in err or "410" in err:
                # Stale connection — clean up
                table.delete_item(Key={"PK": f"PROJECT#{project_id}", "SK": f"WSCONN#{conn_id}"})
                table.delete_item(Key={"PK": f"WSCONN#{conn_id}", "SK": "META"})


def _check_access(project_id: str, user_sub: str, user_role: str) -> bool:
    if user_role == "admin":
        return table.get_item(Key={"PK": f"PROJECT#{project_id}", "SK": "METADATA"}).get("Item") is not None
    return table.get_item(Key={"PK": f"PROJECT#{project_id}", "SK": f"MEMBER#{user_sub}"}).get("Item") is not None

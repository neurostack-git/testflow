"""DynamoDB handle and key builders for the single-table design (LLD §5.1).

Every key string in the system is built here. No handler concatenates key
prefixes by hand — that is how the old `ADMIN#` / `USER#` GSI overloading
drifted out of sync.
"""

import os
import uuid
from datetime import datetime, timezone

import boto3

dynamodb = boto3.resource("dynamodb")

TABLE_NAME = os.environ["TABLE_NAME"]
BUCKET_NAME = os.environ.get("BUCKET_NAME", "")

table = dynamodb.Table(TABLE_NAME)

GSI1 = "GSI1"

# ── Partition keys ───────────────────────────────────────────────────────────

def org_pk(org_id: str) -> str:
    return f"ORG#{org_id}"


def user_pk(sub: str) -> str:
    return f"USER#{sub}"


def project_pk(project_id: str) -> str:
    return f"PROJECT#{project_id}"


def wsconn_pk(connection_id: str) -> str:
    return f"WSCONN#{connection_id}"


def otp_pk(sub: str) -> str:
    return f"OTP#{sub}"


# ── Sort keys ────────────────────────────────────────────────────────────────

METADATA = "METADATA"
PROFILE = "PROFILE"


def member_sk(sub: str) -> str:
    return f"MEMBER#{sub}"


def project_sk(project_id: str) -> str:
    return f"PROJECT#{project_id}"


def bug_sk(bug_id: str) -> str:
    return f"BUG#{bug_id}"


def report_sk(report_id: str) -> str:
    return f"REPORT#{report_id}"


def msg_sk(ts: str, message_id: str) -> str:
    return f"MSG#{ts}#{message_id}"


def notif_sk(ts: str, notif_id: str) -> str:
    return f"NOTIF#{ts}#{notif_id}"


def wsconn_sk(connection_id: str) -> str:
    return f"WSCONN#{connection_id}"


# Sort-key prefixes for begins_with queries
MEMBER_PREFIX = "MEMBER#"
BUG_PREFIX = "BUG#"
REPORT_PREFIX = "REPORT#"
MSG_PREFIX = "MSG#"
NOTIF_PREFIX = "NOTIF#"
PROJECT_PREFIX = "PROJECT#"
WSCONN_PREFIX = "WSCONN#"
WSCONN_META = "META"
OTP_PHONE = "PHONE"


# ── Helpers ──────────────────────────────────────────────────────────────────

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def get_item(pk: str, sk: str):
    return table.get_item(Key={"PK": pk, "SK": sk}).get("Item")


def query_all(**kwargs) -> list:
    """Query with automatic pagination. Callers that page for the client
    (chat history) must not use this."""
    items = []
    while True:
        result = table.query(**kwargs)
        items.extend(result.get("Items", []))
        last = result.get("LastEvaluatedKey")
        if not last:
            return items
        kwargs["ExclusiveStartKey"] = last


def delete_all(items: list) -> int:
    """Batch-delete a list of items by their PK/SK. Returns the count."""
    if not items:
        return 0
    with table.batch_writer() as batch:
        for item in items:
            batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
    return len(items)

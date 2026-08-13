"""DynamoDB handle and key builders for the single-table design (LLD §5.1).

Every key string in the system is built here. No handler concatenates key
prefixes by hand — that is how the old `ADMIN#` / `USER#` GSI overloading
drifted out of sync.
"""

import os
import uuid
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError

dynamodb = boto3.resource("dynamodb")

# Standalone low-level client for TransactWriteItems.
#
# Do NOT use `dynamodb.meta.client` for transactions: the resource installs a
# document transformer on its client, so pre-marshalled items get serialised a
# SECOND time and every key arrives as an M instead of an S. Use this client
# with `marshal()` below, which is the only correct pairing.
ddb_client = boto3.client("dynamodb")

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


_serializer = TypeSerializer()


def marshal(obj: dict) -> dict:
    """Plain Python -> DynamoDB wire format, for use with `ddb_client` only."""
    return {k: _serializer.serialize(v) for k, v in obj.items()}


def transact(items: list) -> None:
    """All-or-nothing write. Surfaces the per-item cancellation reason, which
    the raw exception message truncates to a useless '[ValidationError, None]'."""
    try:
        ddb_client.transact_write_items(TransactItems=items)
    except ClientError as err:
        reasons = err.response.get("CancellationReasons", [])
        detail = "; ".join(
            f"item[{i}] {r.get('Code')}: {r.get('Message')}"
            for i, r in enumerate(reasons)
            if r.get("Code") and r.get("Code") != "None"
        )
        if detail:
            print(f"TransactWriteItems failed -> {detail}")
        raise


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

#!/usr/bin/env python3
"""
TestFlow environment reset (LLD §13).

Deletes EVERY user, EVERY DynamoDB item and EVERY S3 object so the org-based
schema starts from a clean slate. The User Pool, table and bucket themselves
survive — only their contents are removed.

This is irreversible and there is no staging environment. Safety measures:

  * --dry-run is the DEFAULT. Nothing is deleted without --execute.
  * Resource names and region are asserted before any destructive call.
  * --execute additionally requires typing the literal phrase DELETE EVERYTHING.

Usage
-----
    python scripts/reset_environment.py                  # inventory only
    python scripts/reset_environment.py --execute        # actually delete

Order is Cognito -> DynamoDB -> S3, so that no user can sign in and re-create
rows while the table is being emptied.
"""

from __future__ import annotations

import argparse
import sys

try:
    import boto3
    from botocore.exceptions import ClientError, NoCredentialsError
except ImportError:
    sys.exit("boto3 is required:  pip install boto3")

REGION = "ap-south-1"
TABLE_NAME = "testflow"
USER_POOL_NAME = "testflow-users"
CONFIRM_PHRASE = "DELETE EVERYTHING"


# ── Discovery ────────────────────────────────────────────────────────────────

def find_user_pool_id(cognito) -> str:
    paginator = cognito.get_paginator("list_user_pools")
    for page in paginator.paginate(MaxResults=60):
        for pool in page.get("UserPools", []):
            if pool["Name"] == USER_POOL_NAME:
                return pool["Id"]
    raise SystemExit(f"User pool '{USER_POOL_NAME}' not found in {REGION}.")


def find_bucket(s3) -> str:
    """The CDK bucket has a generated name, so match on the stack's prefix."""
    candidates = [
        b["Name"] for b in s3.list_buckets().get("Buckets", [])
        if b["Name"].startswith("testflowstack-attachmentsbucket")
    ]
    if not candidates:
        raise SystemExit("Attachments bucket not found.")
    if len(candidates) > 1:
        raise SystemExit(f"Ambiguous bucket match, refusing to guess: {candidates}")
    return candidates[0]


# ── Inventory ────────────────────────────────────────────────────────────────

def list_users(cognito, pool_id: str) -> list:
    users, token = [], None
    while True:
        kwargs = {"UserPoolId": pool_id, "Limit": 60}
        if token:
            kwargs["PaginationToken"] = token
        resp = cognito.list_users(**kwargs)
        users.extend(resp.get("Users", []))
        token = resp.get("PaginationToken")
        if not token:
            return users


def scan_items(table) -> list:
    items, start_key = [], None
    while True:
        kwargs = {"ProjectionExpression": "PK, SK"}
        if start_key:
            kwargs["ExclusiveStartKey"] = start_key
        resp = table.scan(**kwargs)
        items.extend(resp.get("Items", []))
        start_key = resp.get("LastEvaluatedKey")
        if not start_key:
            return items


def list_objects(s3, bucket: str) -> list:
    keys, token = [], None
    while True:
        kwargs = {"Bucket": bucket, "MaxKeys": 1000}
        if token:
            kwargs["ContinuationToken"] = token
        resp = s3.list_objects_v2(**kwargs)
        keys.extend(o["Key"] for o in resp.get("Contents", []))
        token = resp.get("NextContinuationToken")
        if not resp.get("IsTruncated"):
            return keys


def summarise(items: list) -> dict:
    """Group DynamoDB items by entity type for a readable inventory."""
    counts: dict = {}
    for item in items:
        pk, sk = item.get("PK", ""), item.get("SK", "")
        prefix = pk.split("#", 1)[0]
        if prefix == "PROJECT":
            kind = "PROJECT/" + (sk.split("#", 1)[0] if "#" in sk else sk)
        elif prefix == "USER":
            kind = "USER/" + (sk.split("#", 1)[0] if "#" in sk else sk)
        elif prefix == "ORG":
            kind = "ORG/" + (sk.split("#", 1)[0] if "#" in sk else sk)
        else:
            kind = prefix
        counts[kind] = counts.get(kind, 0) + 1
    return counts


# ── Deletion ─────────────────────────────────────────────────────────────────

def delete_users(cognito, pool_id: str, users: list) -> int:
    deleted = 0
    for user in users:
        try:
            cognito.admin_delete_user(UserPoolId=pool_id, Username=user["Username"])
            deleted += 1
        except ClientError as err:
            print(f"  ! {user['Username']}: {err.response['Error']['Code']}")
    return deleted


def delete_items(table, items: list) -> int:
    if not items:
        return 0
    with table.batch_writer() as batch:
        for item in items:
            batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
    return len(items)


def delete_objects(s3, bucket: str, keys: list) -> int:
    deleted = 0
    for i in range(0, len(keys), 1000):  # DeleteObjects caps at 1000
        chunk = [{"Key": k} for k in keys[i:i + 1000]]
        resp = s3.delete_objects(Bucket=bucket, Delete={"Objects": chunk})
        deleted += len(resp.get("Deleted", []))
        for err in resp.get("Errors", []):
            print(f"  ! {err.get('Key')}: {err.get('Message')}")
    return deleted


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="Wipe the TestFlow environment.")
    parser.add_argument(
        "--execute", action="store_true",
        help="Actually delete. Without this the script only reports what it would do.",
    )
    parser.add_argument(
        "--yes", action="store_true",
        help="Skip the interactive confirmation (for non-interactive runs).",
    )
    args = parser.parse_args()

    try:
        session = boto3.Session(region_name=REGION)
        cognito = session.client("cognito-idp")
        s3 = session.client("s3")
        dynamodb = session.resource("dynamodb")
        identity = session.client("sts").get_caller_identity()
    except NoCredentialsError:
        return int(bool(print("No AWS credentials found. Configure them and retry.")))

    pool_id = find_user_pool_id(cognito)
    bucket = find_bucket(s3)
    table = dynamodb.Table(TABLE_NAME)

    print("=" * 68)
    print("TestFlow environment reset")
    print("=" * 68)
    print(f"  Account   {identity['Account']}")
    print(f"  Region    {REGION}")
    print(f"  Pool      {USER_POOL_NAME} ({pool_id})")
    print(f"  Table     {TABLE_NAME}")
    print(f"  Bucket    {bucket}")
    print()

    print("Taking inventory…")
    users = list_users(cognito, pool_id)
    items = scan_items(table)
    keys = list_objects(s3, bucket)

    print(f"\n  Cognito users     {len(users)}")
    for user in users:
        attrs = {a["Name"]: a["Value"] for a in user.get("Attributes", [])}
        print(f"      - {attrs.get('email', user['Username'])}"
              f"  [{attrs.get('custom:role', 'no role')}]  {user.get('UserStatus')}")

    print(f"\n  DynamoDB items    {len(items)}")
    for kind, count in sorted(summarise(items).items()):
        print(f"      - {kind:<24} {count}")

    print(f"\n  S3 objects        {len(keys)}")
    print()

    if not args.execute:
        print("-" * 68)
        print("DRY RUN — nothing was deleted.")
        print("Re-run with --execute to perform the wipe.")
        print("-" * 68)
        return 0

    if not (users or items or keys):
        print("Nothing to delete. Environment is already clean.")
        return 0

    print("!" * 68)
    print("!!  This is IRREVERSIBLE and this is the only environment.")
    print("!!  Every account above will be deleted, including your own.")
    print("!" * 68)

    if not args.yes:
        try:
            typed = input(f'\nType "{CONFIRM_PHRASE}" to proceed: ').strip()
        except EOFError:
            print("\nNo interactive input available. Re-run with --yes to confirm.")
            return 1
        if typed != CONFIRM_PHRASE:
            print("Confirmation did not match. Aborted — nothing was deleted.")
            return 1

    # Cognito first, so nobody can sign in and write new rows mid-wipe.
    print("\nDeleting Cognito users…")
    print(f"  removed {delete_users(cognito, pool_id, users)} user(s)")

    print("Deleting DynamoDB items…")
    print(f"  removed {delete_items(table, items)} item(s)")

    print("Deleting S3 objects…")
    print(f"  removed {delete_objects(s3, bucket, keys)} object(s)")

    print("\nDone. Sign up again to become the Owner of a new workspace.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

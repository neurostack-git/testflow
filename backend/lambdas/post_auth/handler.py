import os
import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
from datetime import datetime, timezone

dynamodb = boto3.resource("dynamodb")
TABLE_NAME = os.environ["TABLE_NAME"]
table = dynamodb.Table(TABLE_NAME)


def lambda_handler(event: dict, context) -> dict:
    """
    Cognito PostAuthentication trigger.
    Fires after every successful sign-in.
    On first login: creates profile and converts pending invites to project memberships.
    On subsequent logins: no-op (idempotent).
    """
    user_attrs = event.get("request", {}).get("userAttributes", {})
    sub = user_attrs.get("sub", "")
    email = user_attrs.get("email", "")
    role = user_attrs.get("custom:role", "tester")
    name = user_attrs.get("name") or email.split("@")[0]

    if not sub:
        return event  # Safety — triggers must always return event

    # 1. Create profile on first login (conditional put is a no-op if already exists)
    try:
        table.put_item(
            Item={
                "PK": f"USER#{sub}",
                "SK": "PROFILE",
                "email": email,
                "name": name,
                "role": role,
                "phone": "",
            },
            ConditionExpression="attribute_not_exists(PK)",
        )
    except ClientError as e:
        if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise  # Unexpected error — let it bubble so Cognito can log it

    # 2. Convert PENDING# invite items into real MEMBER# records
    pending = table.query(
        KeyConditionExpression=Key("PK").eq(f"USER#{sub}") & Key("SK").begins_with("PENDING#"),
    ).get("Items", [])

    if pending:
        # Use invitedBy from the PENDING record to find ALL of the admin's current
        # projects — this covers projects created after the invite was sent but
        # before the tester accepted, which would have no PENDING# record.
        admin_sub = pending[0].get("invitedBy", "")
        project_ids_to_join = {item["SK"].replace("PENDING#", "") for item in pending}

        if admin_sub:
            admin_projects = table.query(
                IndexName="GSI1",
                KeyConditionExpression=Key("GSI1PK").eq(f"ADMIN#{admin_sub}"),
            ).get("Items", [])
            for proj in admin_projects:
                if proj.get("SK") == "METADATA" and proj.get("projectId") and not proj.get("deletedAt"):
                    project_ids_to_join.add(proj["projectId"])

        now = datetime.now(timezone.utc).isoformat()
        for project_id in project_ids_to_join:
            try:
                table.put_item(
                    Item={
                        "PK": f"PROJECT#{project_id}",
                        "SK": f"MEMBER#{sub}",
                        "email": email,
                        "role": "tester",
                        "joinedAt": now,
                        "GSI1PK": f"USER#{sub}",
                        "GSI1SK": f"PROJECT#{project_id}",
                    },
                    ConditionExpression="attribute_not_exists(SK)",
                )
            except Exception:
                pass  # Already a member — fine

        # Delete all PENDING records
        for item in pending:
            table.delete_item(Key={"PK": f"USER#{sub}", "SK": item["SK"]})

    return event  # Cognito triggers must return the event unchanged

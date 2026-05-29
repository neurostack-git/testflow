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
        now = datetime.now(timezone.utc).isoformat()
        for item in pending:
            project_id = item["SK"].replace("PENDING#", "")
            # Add as project member
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
            # Delete the pending invite record
            table.delete_item(Key={"PK": f"USER#{sub}", "SK": item["SK"]})

    return event  # Cognito triggers must return the event unchanged

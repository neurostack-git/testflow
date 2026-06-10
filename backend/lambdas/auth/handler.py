import json
import os
import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
from datetime import datetime, timezone

dynamodb = boto3.resource("dynamodb")
cognito = boto3.client("cognito-idp")

TABLE_NAME = os.environ["TABLE_NAME"]
USER_POOL_ID = os.environ["USER_POOL_ID"]
USER_POOL_CLIENT_ID = os.environ["USER_POOL_CLIENT_ID"]

table = dynamodb.Table(TABLE_NAME)


def response(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        "body": json.dumps(body),
    }


def lambda_handler(event: dict, context) -> dict:
    route = event.get("routeKey", "")
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    admin_sub = claims.get("sub")
    admin_role = claims.get("custom:role", "")

    if route == "POST /auth/invite":
        return invite_tester(event, admin_sub, admin_role)

    return response(404, {"error": "Not found"})


def invite_tester(event: dict, admin_sub: str, admin_role: str) -> dict:
    if admin_role != "admin":
        return response(403, {"error": "Forbidden"})

    body = json.loads(event.get("body") or "{}")
    email = body.get("email", "").strip().lower()
    project_id = body.get("projectId", "").strip()

    if not email or not project_id:
        return response(400, {"error": "email and projectId are required"})

    proj = table.get_item(Key={"PK": f"PROJECT#{project_id}", "SK": "METADATA"}).get("Item")
    if not proj:
        return response(404, {"error": "Project not found"})

    # Get all admin's project IDs (needed for both flows below)
    all_admin_projects = table.query(
        IndexName="GSI1",
        KeyConditionExpression=Key("GSI1PK").eq(f"ADMIN#{admin_sub}"),
    ).get("Items", [])
    admin_project_ids = {
        item.get("projectId")
        for item in all_admin_projects
        if item.get("SK") == "METADATA" and item.get("projectId")
    }

    try:
        cognito_resp = cognito.admin_create_user(
            UserPoolId=USER_POOL_ID,
            Username=email,
            UserAttributes=[
                {"Name": "email", "Value": email},
                {"Name": "email_verified", "Value": "true"},
                {"Name": "custom:role", "Value": "tester"},
            ],
            DesiredDeliveryMediums=["EMAIL"],
        )
        user_attrs = {a["Name"]: a["Value"] for a in cognito_resp["User"]["Attributes"]}
        tester_sub = user_attrs["sub"]

        # New user — store pending invites; PostAuthentication trigger will
        # convert these to real memberships when the tester first logs in.
        now = datetime.now(timezone.utc).isoformat()
        for pid in admin_project_ids:
            try:
                table.put_item(
                    Item={
                        "PK": f"USER#{tester_sub}",
                        "SK": f"PENDING#{pid}",
                        "projectId": pid,
                        "email": email,
                        "invitedBy": admin_sub,
                        "invitedAt": now,
                    },
                    ConditionExpression="attribute_not_exists(SK)",
                )
            except Exception:
                pass

        return response(200, {"message": "Tester invited successfully", "testerId": tester_sub})

    except ClientError as e:
        if e.response["Error"]["Code"] != "UsernameExistsException":
            raise

        # Email already exists in Cognito — figure out what to do
        user_data = cognito.admin_get_user(UserPoolId=USER_POOL_ID, Username=email)
        user_status = user_data.get("UserStatus", "")
        user_attrs = {a["Name"]: a["Value"] for a in user_data["UserAttributes"]}
        user_role_attr = user_attrs.get("custom:role", "")
        tester_sub = user_attrs.get("sub", "")

        if user_role_attr == "admin":
            return response(400, {"error": "Can't send invite. This email is registered as a developer account."})

        if user_status == "FORCE_CHANGE_PASSWORD":
            return response(400, {"error": "Can't send invite. An invite has already been sent to this email and is pending acceptance."})

        # CONFIRMED tester — add to any admin projects they are not yet in.
        # attribute_not_exists condition silently skips existing memberships, so this
        # is safe whether the tester is in all, some, or none of the admin's projects.
        now = datetime.now(timezone.utc).isoformat()
        for pid in admin_project_ids:
            try:
                table.put_item(
                    Item={
                        "PK": f"PROJECT#{pid}",
                        "SK": f"MEMBER#{tester_sub}",
                        "email": email,
                        "role": "tester",
                        "joinedAt": now,
                        "GSI1PK": f"USER#{tester_sub}",
                        "GSI1SK": f"PROJECT#{pid}",
                    },
                    ConditionExpression="attribute_not_exists(SK)",
                )
            except Exception:
                pass  # Already a member of this project — fine

        return response(200, {"message": "Tester added. They already have a TestFlow account so no invite email was sent.", "testerId": tester_sub})


import json
import os
import uuid
import boto3
from botocore.exceptions import ClientError

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

    # Check project exists
    proj = table.get_item(Key={"PK": f"PROJECT#{project_id}", "SK": "METADATA"}).get("Item")
    if not proj:
        return response(404, {"error": "Project not found"})

    # Create Cognito user (sends temp password email automatically)
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
        # Extract UUID sub from attributes (Username field is the email, not the sub)
        user_attrs = {a["Name"]: a["Value"] for a in cognito_resp["User"]["Attributes"]}
        tester_sub = user_attrs["sub"]
    except ClientError as e:
        if e.response["Error"]["Code"] == "UsernameExistsException":
            # User already exists — look up their sub and role
            user_data = cognito.admin_get_user(UserPoolId=USER_POOL_ID, Username=email)
            user_attrs = {a["Name"]: a["Value"] for a in user_data["UserAttributes"]}
            if user_attrs.get("custom:role") == "admin":
                return response(400, {"error": "This email is already registered as an admin on another account."})
            tester_sub = user_attrs["sub"]
        else:
            raise

    tester_id = str(tester_sub)

    # Write user record if not exists
    table.put_item(
        Item={
            "PK": f"USER#{tester_id}",
            "SK": "PROFILE",
            "email": email,
            "role": "tester",
            "name": email.split("@")[0],
            "phone": "",
        },
        ConditionExpression="attribute_not_exists(PK)",
    )

    # Write project membership
    table.put_item(
        Item={
            "PK": f"PROJECT#{project_id}",
            "SK": f"MEMBER#{tester_id}",
            "email": email,
            "role": "tester",
            "GSI1PK": f"USER#{tester_id}",
            "GSI1SK": f"PROJECT#{project_id}",
        }
    )

    return response(200, {"message": "Tester invited", "testerId": tester_id})

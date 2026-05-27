import json
import os
import secrets
import time
import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

dynamodb = boto3.resource("dynamodb")
cognito = boto3.client("cognito-idp")
sns = boto3.client("sns", region_name="ap-south-1")

TABLE_NAME = os.environ["TABLE_NAME"]
USER_POOL_ID = os.environ["USER_POOL_ID"]
table = dynamodb.Table(TABLE_NAME)

OTP_TTL_SECONDS = 600  # 10 minutes


def response(status: int, body) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        "body": json.dumps(body),
    }


def lambda_handler(event: dict, context) -> dict:
    route = event.get("routeKey", "")
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    user_sub = claims.get("sub")
    user_email = claims.get("email", "")

    if route == "GET /users/me":
        return get_profile(user_sub)
    if route == "PATCH /users/me":
        return update_profile(event, user_sub, user_email)
    if route == "POST /users/me/phone/send-otp":
        return send_phone_otp(event, user_sub)
    if route == "POST /users/me/phone/verify-otp":
        return verify_phone_otp(event, user_sub)

    return response(404, {"error": "Not found"})


def get_profile(user_sub: str) -> dict:
    item = table.get_item(Key={"PK": f"USER#{user_sub}", "SK": "PROFILE"}).get("Item")
    if not item:
        return response(404, {"error": "User not found"})
    item.pop("PK", None)
    item.pop("SK", None)

    if item.get("role") == "tester":
        try:
            memberships = table.query(
                IndexName="GSI1",
                KeyConditionExpression=Key("GSI1PK").eq(f"USER#{user_sub}") & Key("GSI1SK").begins_with("PROJECT#"),
                Limit=1,
            ).get("Items", [])
            if memberships:
                project_id = memberships[0]["GSI1SK"].replace("PROJECT#", "")
                proj = table.get_item(Key={"PK": f"PROJECT#{project_id}", "SK": "METADATA"}).get("Item")
                if proj:
                    admin_sub = proj.get("GSI1PK", "").replace("ADMIN#", "")
                    if admin_sub:
                        admin_profile = table.get_item(Key={"PK": f"USER#{admin_sub}", "SK": "PROFILE"}).get("Item")
                        if admin_profile:
                            item["adminName"] = admin_profile.get("name", "")
        except Exception:
            pass

    return response(200, item)


def update_profile(event: dict, user_sub: str, user_email: str) -> dict:
    body = json.loads(event.get("body") or "{}")
    name = body.get("name", "").strip()

    if not name:
        return response(400, {"error": "name is required"})

    # Upsert DynamoDB profile — ensures admin users get a full record
    update_kwargs = {
        "Key": {"PK": f"USER#{user_sub}", "SK": "PROFILE"},
        "UpdateExpression": "SET #n = :n, email = if_not_exists(email, :e)",
        "ExpressionAttributeNames": {"#n": "name"},
        "ExpressionAttributeValues": {":n": name, ":e": user_email},
    }
    table.update_item(**update_kwargs)

    # Also update Cognito name attribute
    try:
        cognito.admin_update_user_attributes(
            UserPoolId=USER_POOL_ID,
            Username=user_sub,
            UserAttributes=[{"Name": "name", "Value": name}],
        )
    except ClientError as e:
        print(f"Cognito name update error: {e}")

    return response(200, {"message": "Profile updated"})


def normalise_phone(phone: str) -> str:
    """Ensure E.164 format. Prepends +91 for 10-digit Indian numbers."""
    phone = phone.strip().replace(" ", "").replace("-", "")
    if not phone.startswith("+"):
        if len(phone) == 10:
            phone = "+91" + phone
        else:
            phone = "+" + phone
    return phone


def send_phone_otp(event: dict, user_sub: str) -> dict:
    body = json.loads(event.get("body") or "{}")
    phone = normalise_phone(body.get("phone", ""))

    if not phone:
        return response(400, {"error": "phone is required"})

    otp = str(secrets.randbelow(1000000)).zfill(6)
    ttl = int(time.time()) + OTP_TTL_SECONDS

    table.put_item(Item={
        "PK": f"OTP#{user_sub}",
        "SK": "PHONE",
        "otp": otp,
        "phone": phone,
        "ttl": ttl,
    })

    try:
        sns.publish(
            PhoneNumber=phone,
            Message=f"Your TestFlow verification code is: {otp}. Valid for 10 minutes.",
        )
    except ClientError as e:
        return response(500, {"error": f"Failed to send SMS: {e.response['Error']['Message']}"})

    return response(200, {"message": "OTP sent"})


def verify_phone_otp(event: dict, user_sub: str) -> dict:
    body = json.loads(event.get("body") or "{}")
    otp = body.get("otp", "").strip()

    otp_item = table.get_item(Key={"PK": f"OTP#{user_sub}", "SK": "PHONE"}).get("Item")

    if not otp_item:
        return response(400, {"error": "No pending verification. Please request a new code."})

    if otp_item.get("ttl", 0) < int(time.time()):
        return response(400, {"error": "Code has expired. Please request a new one."})

    if otp_item.get("otp") != otp:
        return response(400, {"error": "Invalid code. Please try again."})

    phone = otp_item.get("phone")

    # Save phone to DynamoDB
    table.update_item(
        Key={"PK": f"USER#{user_sub}", "SK": "PROFILE"},
        UpdateExpression="SET phone = :p",
        ExpressionAttributeValues={":p": phone},
    )

    # Save phone to Cognito custom attribute
    try:
        cognito.admin_update_user_attributes(
            UserPoolId=USER_POOL_ID,
            Username=user_sub,
            UserAttributes=[{"Name": "custom:phone_number", "Value": phone}],
        )
    except ClientError as e:
        print(f"Cognito phone update error: {e}")

    # Delete OTP record
    table.delete_item(Key={"PK": f"OTP#{user_sub}", "SK": "PHONE"})

    return response(200, {"message": "Phone verified and saved", "phone": phone})

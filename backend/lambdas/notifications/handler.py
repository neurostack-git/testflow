import json
import os
import boto3

ses = boto3.client("ses", region_name="ap-south-1")
sns = boto3.client("sns", region_name="ap-south-1")

SES_FROM_EMAIL = os.environ.get("SES_FROM_EMAIL", "noreply@testflow.app")


def lambda_handler(event: dict, context) -> dict:
    notification_type = event.get("type")

    if notification_type == "BUG_FIXED":
        return handle_bug_fixed(event)
    if notification_type == "BUG_REOPENED":
        return handle_bug_reopened(event)

    return {"statusCode": 400, "body": "Unknown notification type"}


def handle_bug_reopened(event: dict) -> dict:
    """A tester rejected a fix — tell the dev team (LLD §12).

    Without this the bug silently returns to the board and nobody is prompted
    to look at it again, which would defeat the point of the Reopened state.
    """
    bug_title = event.get("bugTitle", "A bug")
    project_title = event.get("projectTitle", "your project")
    recipients = [e for e in (event.get("recipientEmails") or []) if e]

    if not recipients:
        return {"statusCode": 200, "body": "No recipients"}

    subject = f"[TestFlow] Reopened — fix didn't work: {bug_title}"
    body_html = f"""
    <html><body style="font-family: sans-serif; color: #1a1a1a;">
      <div style="max-width: 560px; margin: 0 auto; padding: 32px 24px;">
        <div style="margin-bottom: 24px;">
          <span style="font-size: 20px; font-weight: 700; color: #f97316;">TestFlow</span>
        </div>
        <h2 style="font-size: 18px; margin-bottom: 8px;">A bug has been reopened</h2>
        <p style="color: #555; margin-bottom: 24px;">
          A tester retested the following bug in <strong>{project_title}</strong>
          and found the issue still occurs:
        </p>
        <div style="background: #fff7ed; border-left: 3px solid #f97316; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
          <p style="margin: 0; font-weight: 600;">{bug_title}</p>
        </div>
        <p style="color: #555; margin-bottom: 24px;">
          Log in to TestFlow to review the report and mark it <strong>Fixed</strong> again
          once resolved.
        </p>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">
          This is an automated notification from TestFlow.
        </p>
      </div>
    </body></html>
    """
    body_text = (
        f"Bug reopened — the fix didn't work\n\n"
        f"Project: {project_title}\n"
        f"Bug: {bug_title}\n\n"
        f"Log in to TestFlow to review and re-fix."
    )

    for email in recipients:
        try:
            ses.send_email(
                Source=SES_FROM_EMAIL,
                Destination={"ToAddresses": [email]},
                Message={
                    "Subject": {"Data": subject},
                    "Body": {"Html": {"Data": body_html}, "Text": {"Data": body_text}},
                },
            )
        except Exception as e:
            print(f"SES error for {email}: {e}")

    return {"statusCode": 200, "body": f"Notified {len(recipients)} developer(s)"}


def handle_bug_fixed(event: dict) -> dict:
    bug_title = event.get("bugTitle", "A bug")
    project_title = event.get("projectTitle", "your project")
    reporter_email = event.get("reporterEmail")
    reporter_phone = event.get("reporterPhone")
    bug_id = event.get("bugId")
    project_id = event.get("projectId")

    subject = f"[TestFlow] Bug fixed — please retest: {bug_title}"
    body_html = f"""
    <html><body style="font-family: sans-serif; color: #1a1a1a;">
      <div style="max-width: 560px; margin: 0 auto; padding: 32px 24px;">
        <div style="display: flex; align-items: center; margin-bottom: 24px;">
          <span style="font-size: 20px; font-weight: 700; color: #f97316;">TestFlow</span>
        </div>
        <h2 style="font-size: 18px; margin-bottom: 8px;">A bug has been marked as Fixed</h2>
        <p style="color: #555; margin-bottom: 24px;">
          The following bug in <strong>{project_title}</strong> has been fixed and is ready for retesting:
        </p>
        <div style="background: #fff7ed; border-left: 3px solid #f97316; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
          <p style="margin: 0; font-weight: 600;">{bug_title}</p>
        </div>
        <p style="color: #555; margin-bottom: 24px;">
          Please log in to TestFlow, retest the bug, and mark it
          <strong>Closed</strong> if the fix works or <strong>Reopened</strong> if the issue persists.
        </p>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">
          This is an automated notification from TestFlow.
        </p>
      </div>
    </body></html>
    """

    body_text = (
        f"Bug fixed — please retest\n\n"
        f"Project: {project_title}\n"
        f"Bug: {bug_title}\n\n"
        f"Log in to TestFlow and mark it Closed if the fix works, or Reopened if it doesn't."
    )

    # Send email via SES
    if reporter_email:
        try:
            ses.send_email(
                Source=SES_FROM_EMAIL,
                Destination={"ToAddresses": [reporter_email]},
                Message={
                    "Subject": {"Data": subject},
                    "Body": {
                        "Html": {"Data": body_html},
                        "Text": {"Data": body_text},
                    },
                },
            )
        except Exception as e:
            print(f"SES error: {e}")

    # Send WhatsApp via SNS
    if reporter_phone:
        whatsapp_message = (
            f"*TestFlow* — Bug Fixed ✅\n\n"
            f"*Project:* {project_title}\n"
            f"*Bug:* {bug_title}\n\n"
            f"Please retest and update the status in TestFlow."
        )
        try:
            sns.publish(
                PhoneNumber=reporter_phone,
                Message=whatsapp_message,
                MessageAttributes={
                    "AWS.SNS.SMS.SMSType": {
                        "DataType": "String",
                        "StringValue": "Transactional",
                    },
                    "AWS.MM.SMS.OriginationNumber": {
                        "DataType": "String",
                        "StringValue": "WHATSAPP",
                    },
                },
            )
        except Exception as e:
            print(f"SNS WhatsApp error: {e}")

    return {"statusCode": 200, "body": "Notifications sent"}

from aws_cdk import (
    Stack,
    Duration,
    RemovalPolicy,
    aws_dynamodb as dynamodb,
    aws_s3 as s3,
    aws_cognito as cognito,
    aws_lambda as lambda_,
    aws_apigatewayv2 as apigwv2,
    aws_apigatewayv2_integrations as integrations,
    aws_apigatewayv2_authorizers as authorizers,
    aws_iam as iam,
    aws_ses as ses,
    CfnOutput,
)
from constructs import Construct
import os


class TestflowStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ── DynamoDB single table ──────────────────────────────────────────
        table = dynamodb.Table(
            self,
            "TestflowTable",
            table_name="testflow",
            partition_key=dynamodb.Attribute(name="PK", type=dynamodb.AttributeType.STRING),
            sort_key=dynamodb.Attribute(name="SK", type=dynamodb.AttributeType.STRING),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.RETAIN,
            # 35-day continuous restore window. This was OFF during the
            # 2026-08-13 reset, which is why that data was unrecoverable.
            point_in_time_recovery_specification=dynamodb.PointInTimeRecoverySpecification(
                point_in_time_recovery_enabled=True,
            ),
            # Auto-expire ephemeral rows (WS connections, phone OTPs) that carry
            # an `expiresAt` epoch-seconds attribute. Other items omit it and persist.
            time_to_live_attribute="expiresAt",
        )

        # GSI1 — lets us query all projects a user belongs to
        table.add_global_secondary_index(
            index_name="GSI1",
            partition_key=dynamodb.Attribute(name="GSI1PK", type=dynamodb.AttributeType.STRING),
            sort_key=dynamodb.Attribute(name="GSI1SK", type=dynamodb.AttributeType.STRING),
        )

        # ── S3 bucket for attachments ──────────────────────────────────────
        bucket = s3.Bucket(
            self,
            "AttachmentsBucket",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            # Deleted objects become recoverable delete-markers rather than
            # vanishing outright.
            versioned=True,
            cors=[
                s3.CorsRule(
                    allowed_methods=[s3.HttpMethods.PUT, s3.HttpMethods.GET],
                    allowed_origins=["*"],
                    allowed_headers=["*"],
                    max_age=3000,
                )
            ],
            removal_policy=RemovalPolicy.RETAIN,
        )

        # ── Cognito User Pool ──────────────────────────────────────────────
        app_url = self.node.try_get_context("appUrl") or "http://localhost:3000"

        user_pool = cognito.UserPool(
            self,
            "TestflowUserPool",
            user_pool_name="testflow-users",
            self_sign_up_enabled=True,
            sign_in_aliases=cognito.SignInAliases(email=True),
            auto_verify=cognito.AutoVerifiedAttrs(email=True),
            password_policy=cognito.PasswordPolicy(
                min_length=8,
                require_lowercase=True,
                require_uppercase=False,
                require_digits=True,
                require_symbols=False,
            ),
            mfa=cognito.Mfa.OFF,
            account_recovery=cognito.AccountRecovery.EMAIL_ONLY,
            standard_attributes=cognito.StandardAttributes(
                email=cognito.StandardAttribute(required=True, mutable=False),
                fullname=cognito.StandardAttribute(required=False, mutable=True),
            ),
            custom_attributes={
                "role": cognito.StringAttribute(mutable=True),
                "phone_number": cognito.StringAttribute(mutable=True),
            },
            user_invitation=cognito.UserInvitationConfig(
                email_subject="You've been invited to TestFlow 🐛",
                email_body=f"""
<html>
<body style="margin:0;padding:0;background-color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:540px;margin:48px auto;padding:0 20px 48px;">

    <!-- Logo -->
    <div style="text-align:center;margin-bottom:32px;">
      <img src="{app_url}/logo.svg" alt="TestFlow" width="56" height="56"
           style="border-radius:14px;display:inline-block;" />
      <div style="font-size:26px;font-weight:800;color:#f97316;margin-top:10px;letter-spacing:-0.5px;">TestFlow</div>
      <div style="font-size:13px;color:#9ca3af;margin-top:2px;">Bug Reporting &amp; Tracking</div>
    </div>

    <!-- Card -->
    <div style="background:#ffffff;border-radius:20px;padding:40px 36px;box-shadow:0 2px 8px rgba(0,0,0,0.06),0 12px 32px rgba(249,115,22,0.07);">

      <!-- Badge -->
      <div style="display:inline-block;background:#fff7ed;border:1px solid #fed7aa;border-radius:100px;padding:4px 14px;margin-bottom:20px;">
        <span style="font-size:12px;font-weight:600;color:#ea580c;letter-spacing:0.03em;">&#x1F4E8; NEW INVITATION</span>
      </div>

      <h1 style="font-size:22px;font-weight:800;color:#111827;margin:0 0 10px;letter-spacing:-0.4px;">You've been invited!</h1>
      <p style="font-size:15px;color:#6b7280;margin:0 0 28px;line-height:1.7;">
        You've been added to a <strong style="color:#f97316;">TestFlow</strong> workspace &mdash;
        a collaborative platform for bug reporting, tracking, and communication.
        Your role is shown on your profile once you sign in.
      </p>

      <!-- Divider -->
      <div style="height:1px;background:linear-gradient(to right,#f97316,#fed7aa,transparent);margin-bottom:28px;border-radius:1px;"></div>

      <!-- Credentials -->
      <div style="background:#fff7ed;border-radius:12px;padding:20px 24px;margin-bottom:32px;">
        <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#9a3412;text-transform:uppercase;letter-spacing:0.08em;">Your login credentials</p>
        <table style="border-collapse:collapse;width:100%;">
          <tr>
            <td style="font-size:13px;color:#6b7280;padding:4px 0;width:120px;">Email</td>
            <td style="font-size:14px;color:#111827;font-weight:600;padding:4px 0;">{{username}}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#6b7280;padding:4px 0;">Temp password</td>
            <td style="font-size:14px;color:#111827;font-weight:600;padding:4px 0;font-family:'Courier New',Courier,monospace;letter-spacing:0.05em;">{{####}}</td>
          </tr>
        </table>
      </div>

      <!-- CTA Button -->
      <a href="{app_url}/login"
         style="display:block;background:linear-gradient(135deg,#f97316 0%,#ea6c0a 100%);color:#ffffff;text-decoration:none;padding:15px 32px;border-radius:12px;font-weight:700;font-size:15px;text-align:center;letter-spacing:-0.2px;box-shadow:0 4px 14px rgba(249,115,22,0.4);">
        Sign in to TestFlow &rarr;
      </a>

      <p style="font-size:12px;color:#9ca3af;text-align:center;margin:20px 0 0;line-height:1.7;">
        You'll be asked to set a new password on first login.<br/>
        This invitation expires in <strong style="color:#6b7280;">7 days</strong>.
      </p>
    </div>

    <!-- Footer -->
    <p style="font-size:12px;color:#d1d5db;text-align:center;margin-top:28px;line-height:1.6;">
      &copy; 2026 TestFlow &nbsp;&bull;&nbsp; If you weren't expecting this, you can safely ignore it.
    </p>
  </div>
</body>
</html>
""",
            ),
            removal_policy=RemovalPolicy.RETAIN,
        )

        user_pool_client = cognito.UserPoolClient(
            self,
            "TestflowUserPoolClient",
            user_pool=user_pool,
            auth_flows=cognito.AuthFlow(
                user_password=True,
                user_srp=True,
            ),
            generate_secret=False,
        )

        # ── Shared Lambda environment ──────────────────────────────────────
        lambda_env = {
            "TABLE_NAME": table.table_name,
            "BUCKET_NAME": bucket.bucket_name,
            "USER_POOL_ID": user_pool.user_pool_id,
            "USER_POOL_CLIENT_ID": user_pool_client.user_pool_client_id,
        }

        # ── Shared layer ───────────────────────────────────────────────────
        # tfcommon holds the entire RBAC matrix and the bug transition table.
        # Every function gets it so an authorisation rule exists in one place.
        common_layer = lambda_.LayerVersion(
            self,
            "CommonLayer",
            layer_version_name="testflow-common",
            code=lambda_.Code.from_asset("layers/common"),
            compatible_runtimes=[lambda_.Runtime.PYTHON_3_12],
            description="Shared auth, DynamoDB and HTTP primitives for TestFlow",
            removal_policy=RemovalPolicy.DESTROY,
        )

        lambda_defaults = {
            "runtime": lambda_.Runtime.PYTHON_3_12,
            "timeout": Duration.seconds(30),
            "memory_size": 256,
            "layers": [common_layer],
        }

        # ── Lambda functions ───────────────────────────────────────────────
        # `org` replaces the old `auth` function: it owns the workspace, its
        # members and all invites (LLD §9.1).
        org_fn = lambda_.Function(
            self, "OrgFn",
            **lambda_defaults,
            code=lambda_.Code.from_asset("lambdas/org"),
            handler="handler.lambda_handler",
            environment=lambda_env,
        )

        projects_fn = lambda_.Function(
            self, "ProjectsFn",
            **lambda_defaults,
            code=lambda_.Code.from_asset("lambdas/projects"),
            handler="handler.lambda_handler",
            environment=lambda_env,
        )

        bugs_fn = lambda_.Function(
            self, "BugsFn",
            **lambda_defaults,
            code=lambda_.Code.from_asset("lambdas/bugs"),
            handler="handler.lambda_handler",
            environment=lambda_env,
        )

        attachments_fn = lambda_.Function(
            self, "AttachmentsFn",
            **lambda_defaults,
            code=lambda_.Code.from_asset("lambdas/attachments"),
            handler="handler.lambda_handler",
            environment=lambda_env,
        )

        users_fn = lambda_.Function(
            self, "UsersFn",
            **lambda_defaults,
            code=lambda_.Code.from_asset("lambdas/users"),
            handler="handler.lambda_handler",
            environment=lambda_env,
        )

        notifications_fn = lambda_.Function(
            self, "NotificationsFn",
            **lambda_defaults,
            code=lambda_.Code.from_asset("lambdas/notifications"),
            handler="handler.lambda_handler",
            environment=lambda_env,
        )

        # post_auth_fn must NOT use lambda_env (which contains user_pool.user_pool_id)
        # because it is also attached as a Cognito trigger — that would create a circular
        # CloudFormation dependency.  It only needs TABLE_NAME.
        post_auth_fn = lambda_.Function(
            self, "PostAuthFn",
            **lambda_defaults,
            code=lambda_.Code.from_asset("lambdas/post_auth"),
            handler="handler.lambda_handler",
            environment={"TABLE_NAME": table.table_name},
        )

        # ── IAM permissions ────────────────────────────────────────────────
        table.grant_read_write_data(org_fn)
        table.grant_read_write_data(post_auth_fn)
        table.grant_read_write_data(projects_fn)

        # Attach PostAuthentication trigger — fires after every successful login
        user_pool.add_trigger(
            cognito.UserPoolOperation.POST_AUTHENTICATION,
            post_auth_fn,
        )
        table.grant_read_write_data(bugs_fn)
        table.grant_read_write_data(users_fn)
        table.grant_read_data(notifications_fn)
        # attachments now authorises every key against the caller's org, so it
        # needs to read profiles and project metadata.
        table.grant_read_data(attachments_fn)

        bucket.grant_put(attachments_fn)
        bucket.grant_read(attachments_fn)
        bucket.grant_put(users_fn)
        bucket.grant_read(users_fn)
        bucket.grant_delete(users_fn)

        bucket.grant_delete(projects_fn)
        bucket.grant_delete(bugs_fn)

        # The org Lambda owns the full member lifecycle: invite creates the
        # Cognito user, removal deletes it.
        org_fn.add_to_role_policy(
            iam.PolicyStatement(
                actions=[
                    "cognito-idp:AdminCreateUser",
                    "cognito-idp:AdminDeleteUser",
                    "cognito-idp:AdminSetUserPassword",
                    "cognito-idp:AdminUpdateUserAttributes",
                    "cognito-idp:AdminGetUser",
                    "cognito-idp:ListUsers",
                ],
                resources=[user_pool.user_pool_arn],
            )
        )

        # Allow notifications Lambda to send SES email and SNS WhatsApp
        notifications_fn.add_to_role_policy(
            iam.PolicyStatement(
                actions=["ses:SendEmail", "ses:SendRawEmail"],
                resources=["*"],
            )
        )
        notifications_fn.add_to_role_policy(
            iam.PolicyStatement(
                actions=["sns:Publish"],
                resources=["*"],
            )
        )

        # projects no longer removes members — that moved to the org Lambda.

        # Allow users Lambda to update Cognito attributes and send SMS OTPs
        users_fn.add_to_role_policy(
            iam.PolicyStatement(
                actions=["cognito-idp:AdminUpdateUserAttributes"],
                resources=[user_pool.user_pool_arn],
            )
        )
        users_fn.add_to_role_policy(
            iam.PolicyStatement(
                actions=["sns:Publish"],
                resources=["*"],
            )
        )

        # bugs Lambda triggers notifications Lambda on status → Fixed
        bugs_fn.add_to_role_policy(
            iam.PolicyStatement(
                actions=["lambda:InvokeFunction"],
                resources=[notifications_fn.function_arn],
            )
        )
        bugs_fn.add_environment("NOTIFICATIONS_FN_ARN", notifications_fn.function_arn)

        # ── Chat Lambdas ───────────────────────────────────────────────────
        chat_fn = lambda_.Function(
            self, "ChatFn",
            **lambda_defaults,
            code=lambda_.Code.from_asset("lambdas/chat"),
            handler="handler.lambda_handler",
            environment=lambda_env,
        )
        table.grant_read_write_data(chat_fn)

        ws_chat_fn = lambda_.Function(
            self, "WsChatFn",
            **lambda_defaults,
            code=lambda_.Code.from_asset("lambdas/ws_chat"),
            handler="handler.lambda_handler",
            environment={**lambda_env},  # WS_API_ENDPOINT added after WS API is created
        )
        table.grant_read_write_data(ws_chat_fn)

        ws_chat_fn.add_to_role_policy(
            iam.PolicyStatement(
                actions=["cognito-idp:GetUser"],
                resources=["*"],
            )
        )

        # ── WebSocket API ──────────────────────────────────────────────────
        ws_api = apigwv2.WebSocketApi(
            self,
            "TestflowWsApi",
            api_name="testflow-ws-api",
        )

        ws_stage = apigwv2.WebSocketStage(
            self,
            "WsProdStage",
            web_socket_api=ws_api,
            stage_name="prod",
            auto_deploy=True,
        )

        ws_api.add_route(
            "$connect",
            integration=integrations.WebSocketLambdaIntegration("WsConnect", ws_chat_fn),
        )
        ws_api.add_route(
            "$disconnect",
            integration=integrations.WebSocketLambdaIntegration("WsDisconnect", ws_chat_fn),
        )
        ws_api.add_route(
            "sendMessage",
            integration=integrations.WebSocketLambdaIntegration("WsSendMessage", ws_chat_fn),
        )
        ws_api.add_route(
            "typing",
            integration=integrations.WebSocketLambdaIntegration("WsTyping", ws_chat_fn),
        )

        # Management endpoint for post_to_connection broadcasts
        ws_mgmt_endpoint = f"https://{ws_api.api_id}.execute-api.{self.region}.amazonaws.com/prod"
        ws_chat_fn.add_environment("WS_API_ENDPOINT", ws_mgmt_endpoint)

        ws_chat_fn.add_to_role_policy(
            iam.PolicyStatement(
                actions=["execute-api:ManageConnections"],
                resources=[f"arn:aws:execute-api:{self.region}:{self.account}:{ws_api.api_id}/*"],
            )
        )

        # ── HTTP API Gateway ───────────────────────────────────────────────
        http_api = apigwv2.HttpApi(
            self,
            "TestflowApi",
            api_name="testflow-api",
            cors_preflight=apigwv2.CorsPreflightOptions(
                allow_origins=["*"],
                allow_methods=[apigwv2.CorsHttpMethod.ANY],
                allow_headers=["Authorization", "Content-Type"],
            ),
        )

        jwt_authorizer = authorizers.HttpJwtAuthorizer(
            "CognitoAuthorizer",
            jwt_issuer=f"https://cognito-idp.ap-south-1.amazonaws.com/{user_pool.user_pool_id}",
            jwt_audience=[user_pool_client.user_pool_client_id],
        )

        def add_routes(path: str, fn: lambda_.Function, methods: list) -> None:
            for method in methods:
                http_api.add_routes(
                    path=path,
                    methods=[method],
                    integration=integrations.HttpLambdaIntegration(
                        f"{fn.node.id}{method.value}{path.replace('/', '_')}",
                        fn,
                    ),
                    authorizer=jwt_authorizer,
                )

        # Org — workspace, members, invites, ownership (LLD §9.1)
        add_routes("/org", org_fn, [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST, apigwv2.HttpMethod.PATCH])
        add_routes("/org/members", org_fn, [apigwv2.HttpMethod.GET])
        add_routes("/org/members/{sub}", org_fn, [apigwv2.HttpMethod.DELETE])
        add_routes("/org/invite", org_fn, [apigwv2.HttpMethod.POST])
        add_routes("/org/transfer-ownership", org_fn, [apigwv2.HttpMethod.POST])

        # Projects — org-scoped. The per-project /members routes are gone (D11).
        add_routes("/projects", projects_fn, [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST])
        add_routes("/projects/bin", projects_fn, [apigwv2.HttpMethod.GET])
        add_routes("/projects/{projectId}", projects_fn, [
            apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PATCH, apigwv2.HttpMethod.DELETE,
        ])
        add_routes("/projects/{projectId}/restore", projects_fn, [apigwv2.HttpMethod.POST])
        add_routes("/projects/{projectId}/permanent", projects_fn, [apigwv2.HttpMethod.DELETE])

        # Bugs
        add_routes("/projects/{projectId}/bugs", bugs_fn, [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST])
        add_routes("/projects/{projectId}/bugs/{bugId}", bugs_fn, [apigwv2.HttpMethod.GET])
        add_routes("/projects/{projectId}/bugs/{bugId}/status", bugs_fn, [apigwv2.HttpMethod.PATCH])

        # Attachments
        add_routes("/attachments/presign", attachments_fn, [apigwv2.HttpMethod.POST])

        # Users
        add_routes("/users/me", users_fn, [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PATCH])
        add_routes("/users/me/phone/send-otp", users_fn, [apigwv2.HttpMethod.POST])
        add_routes("/users/me/phone/verify-otp", users_fn, [apigwv2.HttpMethod.POST])
        add_routes("/users/me/avatar/presign", users_fn, [apigwv2.HttpMethod.POST])
        add_routes("/users/me/avatar", users_fn, [apigwv2.HttpMethod.PATCH, apigwv2.HttpMethod.DELETE])

        # Attachments - view URL
        add_routes("/attachments/view", attachments_fn, [apigwv2.HttpMethod.GET])

        # Bugs - edit and delete
        add_routes("/projects/{projectId}/bugs/{bugId}", bugs_fn, [apigwv2.HttpMethod.PATCH, apigwv2.HttpMethod.DELETE])

        # Reports
        add_routes("/projects/{projectId}/reports", projects_fn, [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST])
        add_routes("/projects/{projectId}/reports/{reportId}", projects_fn, [apigwv2.HttpMethod.DELETE])

        # Chat (HTTP: history, members, notifications)
        add_routes("/projects/{projectId}/chat/history", chat_fn, [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.DELETE])
        add_routes("/projects/{projectId}/chat/members", chat_fn, [apigwv2.HttpMethod.GET])
        add_routes("/notifications", chat_fn, [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.DELETE])
        add_routes("/notifications/{notifId}/read", chat_fn, [apigwv2.HttpMethod.PATCH])
        add_routes("/notifications/read-all", chat_fn, [apigwv2.HttpMethod.PATCH])

        # ── Outputs ────────────────────────────────────────────────────────
        CfnOutput(self, "ApiUrl", value=http_api.api_endpoint)
        CfnOutput(self, "UserPoolId", value=user_pool.user_pool_id)
        CfnOutput(self, "UserPoolClientId", value=user_pool_client.user_pool_client_id)
        CfnOutput(self, "BucketName", value=bucket.bucket_name)
        CfnOutput(self, "TableName", value=table.table_name)
        CfnOutput(self, "WsApiUrl", value=ws_stage.url)

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
                email_subject="You've been invited to TestFlow",
                email_body=f"""
<html>
<body style="font-family:sans-serif;color:#1a1a1a;margin:0;padding:0;">
  <div style="max-width:520px;margin:32px auto;padding:32px 24px;border:1px solid #e5e7eb;border-radius:12px;">
    <div style="margin-bottom:24px;">
      <span style="font-size:20px;font-weight:800;color:#f97316;">TestFlow</span>
    </div>
    <h2 style="font-size:18px;font-weight:700;margin:0 0 8px;">You've been invited!</h2>
    <p style="color:#555;margin:0 0 24px;">You've been added as a tester on TestFlow — a bug reporting and tracking tool.</p>
    <div style="background:#fff7ed;border-left:3px solid #f97316;padding:16px;border-radius:8px;margin-bottom:24px;">
      <p style="margin:0 0 8px;font-size:13px;color:#555;">Your login credentials</p>
      <p style="margin:0 0 4px;"><strong>Email:</strong> {{username}}</p>
      <p style="margin:0;"><strong>Temporary password:</strong> {{####}}</p>
    </div>
    <a href="{app_url}/login"
       style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px;">
      Sign in to TestFlow
    </a>
    <p style="color:#888;font-size:12px;margin-top:24px;">
      You'll be asked to set a new password on your first login.<br>
      This invitation expires in 7 days.
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

        lambda_defaults = {
            "runtime": lambda_.Runtime.PYTHON_3_12,
            "timeout": Duration.seconds(30),
            "memory_size": 256,
        }

        # ── Lambda functions ───────────────────────────────────────────────
        auth_fn = lambda_.Function(
            self, "AuthFn",
            **lambda_defaults,
            code=lambda_.Code.from_asset("lambdas/auth"),
            handler="handler.lambda_handler",
            environment={**lambda_env, "AWS_ACCOUNT_ID": self.account},
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

        # ── IAM permissions ────────────────────────────────────────────────
        table.grant_read_write_data(auth_fn)
        table.grant_read_write_data(projects_fn)
        table.grant_read_write_data(bugs_fn)
        table.grant_read_write_data(users_fn)
        table.grant_read_data(notifications_fn)

        bucket.grant_put(attachments_fn)
        bucket.grant_read(attachments_fn)

        bucket.grant_delete(projects_fn)

        # Allow auth Lambda to create/admin Cognito users
        auth_fn.add_to_role_policy(
            iam.PolicyStatement(
                actions=[
                    "cognito-idp:AdminCreateUser",
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

        # Auth (invite tester — no JWT needed on public invite endpoint? No, Admin must be authed)
        add_routes("/auth/invite", auth_fn, [apigwv2.HttpMethod.POST])

        # Projects
        add_routes("/projects", projects_fn, [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST])
        add_routes("/projects/{projectId}", projects_fn, [apigwv2.HttpMethod.GET])
        add_routes("/projects/{projectId}/members", projects_fn, [apigwv2.HttpMethod.GET])
        add_routes("/projects/{projectId}/members/{memberId}", projects_fn, [apigwv2.HttpMethod.DELETE])

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

        # Attachments - view URL
        add_routes("/attachments/view", attachments_fn, [apigwv2.HttpMethod.GET])

        # Bugs - edit and delete
        add_routes("/projects/{projectId}/bugs/{bugId}", bugs_fn, [apigwv2.HttpMethod.PATCH, apigwv2.HttpMethod.DELETE])

        # Reports
        add_routes("/projects/{projectId}/reports", projects_fn, [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST])
        add_routes("/projects/{projectId}/reports/{reportId}", projects_fn, [apigwv2.HttpMethod.DELETE])

        # ── Outputs ────────────────────────────────────────────────────────
        CfnOutput(self, "ApiUrl", value=http_api.api_endpoint)
        CfnOutput(self, "UserPoolId", value=user_pool.user_pool_id)
        CfnOutput(self, "UserPoolClientId", value=user_pool_client.user_pool_client_id)
        CfnOutput(self, "BucketName", value=bucket.bucket_name)
        CfnOutput(self, "TableName", value=table.table_name)

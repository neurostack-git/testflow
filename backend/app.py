#!/usr/bin/env python3
import aws_cdk as cdk
from backend.testflow_stack import TestflowStack

app = cdk.App()
TestflowStack(
    app,
    "TestflowStack",
    env=cdk.Environment(region="ap-south-1"),
)
app.synth()

import { Amplify } from "aws-amplify";
import { config } from "@/lib/config";

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: config.cognito.userPoolId,
      userPoolClientId: config.cognito.clientId,
      signUpVerificationMethod: "code",
    },
  },
});

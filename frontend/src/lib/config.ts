export const config = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL!,
  cognito: {
    userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
    clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
    region: process.env.NEXT_PUBLIC_COGNITO_REGION!,
  },
} as const;

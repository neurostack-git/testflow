import {
  signIn,
  signUp,
  signOut,
  confirmSignIn,
  confirmSignUp,
  getCurrentUser,
  fetchAuthSession,
  fetchUserAttributes,
  updateUserAttributes,
  type SignInOutput,
} from "aws-amplify/auth";

export type AuthUser = {
  sub: string;
  email: string;
  name: string;
  role: "admin" | "tester";
  phone: string;
};

export async function loginUser(email: string, password: string): Promise<SignInOutput> {
  // Clear any stale session (e.g. left over from signUp flow) before signing in
  await signOut().catch(() => {});
  return signIn({ username: email, password });
}

export async function registerAdmin(name: string, email: string, password: string) {
  return signUp({
    username: email,
    password,
    options: {
      userAttributes: {
        email,
        name,
        "custom:role": "admin",
      },
    },
  });
}

export async function confirmUserSignUp(email: string, code: string) {
  return confirmSignUp({ username: email, confirmationCode: code });
}

export async function completeNewPassword(newPassword: string) {
  return confirmSignIn({ challengeResponse: newPassword });
}

export async function logoutUser() {
  return signOut();
}

export async function getJwt(): Promise<string> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (!token) throw new Error("No active session");
  return token;
}

export async function getAuthUser(): Promise<AuthUser> {
  const [user, attrs] = await Promise.all([
    getCurrentUser(),
    fetchUserAttributes(),
  ]);
  return {
    sub: user.userId,
    email: attrs.email ?? "",
    name: attrs.name ?? attrs.email?.split("@")[0] ?? "",
    role: (attrs["custom:role"] as "admin" | "tester") ?? "tester",
    phone: attrs["custom:phone_number"] ?? "",
  };
}

export async function updatePhone(phone: string) {
  return updateUserAttributes({
    userAttributes: { "custom:phone_number": phone },
  });
}

export function mapAuthError(err: unknown): string {
  if (!(err instanceof Error)) return "Something went wrong. Please try again.";
  const name = (err as { name?: string }).name ?? "";
  switch (name) {
    case "UserNotFoundException":
      return "No account found with this email address.";
    case "NotAuthorizedException":
      return "Incorrect email or password.";
    case "UserNotConfirmedException":
      return "Please verify your email before signing in.";
    case "UsernameExistsException":
      return "An account with this email already exists.";
    case "CodeMismatchException":
      return "That code doesn't match. Please check and try again.";
    case "ExpiredCodeException":
      return "That code has expired. Please request a new one.";
    case "LimitExceededException":
      return "Too many attempts. Please try again later.";
    case "InvalidPasswordException":
      return "Password doesn't meet the requirements. It must be at least 8 characters.";
    case "NetworkError":
      return "Unable to connect. Please check your internet connection.";
    default:
      return err.message || "Something went wrong. Please try again.";
  }
}

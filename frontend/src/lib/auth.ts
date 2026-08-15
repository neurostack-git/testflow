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
  updatePassword,
  resetPassword,
  confirmResetPassword,
  type SignInOutput,
} from "aws-amplify/auth";
import type { Role } from "@/lib/permissions";

export type AuthUser = {
  sub: string;
  email: string;
  name: string;
  role: Role;
  phone: string;
};

/** Org name captured on the signup form, held until the Owner's first login
 *  can call POST /org (LLD §7.1). sessionStorage, not localStorage — it must
 *  not outlive the tab or leak into another signup. */
const PENDING_ORG_KEY = "tf-pending-org";

export function setPendingOrgName(name: string): void {
  try { sessionStorage.setItem(PENDING_ORG_KEY, name); } catch { /* ignore */ }
}

export function takePendingOrgName(): string {
  try {
    const value = sessionStorage.getItem(PENDING_ORG_KEY) ?? "";
    sessionStorage.removeItem(PENDING_ORG_KEY);
    return value;
  } catch {
    return "";
  }
}

export async function loginUser(email: string, password: string): Promise<SignInOutput> {
  // Clear any stale session (e.g. left over from signUp flow) before signing in
  await signOut().catch(() => {});
  return signIn({ username: email, password });
}

/** Self-service signup always creates an Owner. Developers and Testers are
 *  created server-side by admin_create_user, never through this path. */
export async function registerOwner(
  name: string,
  email: string,
  password: string,
  orgName: string
) {
  setPendingOrgName(orgName);
  return signUp({
    username: email,
    password,
    options: {
      userAttributes: {
        email,
        name,
        "custom:role": "owner",
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

/** Anchor for the idle sign-out window (see components/layout/sidebar.tsx). */
export const LAST_ACTIVITY_KEY = "tf-last-activity";

export async function logoutUser() {
  // Drop the idle anchor so the next sign-in starts a fresh window instead of
  // inheriting a deadline that may already be in the past.
  try { localStorage.removeItem(LAST_ACTIVITY_KEY); } catch { /* ignore */ }
  return signOut();
}

// ── Passwords (LLD §7.4) ─────────────────────────────────────────────────────
// Both flows are pure Cognito calls — no backend endpoint, no IAM, no state.

/** Change password while signed in. Requires the current password. */
export async function changePassword(oldPassword: string, newPassword: string) {
  return updatePassword({ oldPassword, newPassword });
}

/** Step 1 of forgot-password: Cognito emails a confirmation code. */
export async function requestPasswordReset(email: string) {
  return resetPassword({ username: email });
}

/** Step 2 of forgot-password: exchange the code for a new password. */
export async function confirmPasswordReset(
  email: string,
  code: string,
  newPassword: string
) {
  return confirmResetPassword({
    username: email,
    confirmationCode: code,
    newPassword,
  });
}

export async function getJwt(): Promise<string> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (!token) throw new Error("No active session");
  return token;
}

export async function getAccessToken(): Promise<string> {
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString();
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
    // Bootstrap hint only — the authoritative role comes from GET /users/me.
    role: (attrs["custom:role"] as Role) ?? "tester",
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
    case "NotAuthorizedException.ChangePassword":
      return "Your current password is incorrect.";
    case "TooManyRequestsException":
      return "Too many attempts. Please wait a moment and try again.";
    case "NetworkError":
      return "Unable to connect. Please check your internet connection.";
    default:
      return err.message || "Something went wrong. Please try again.";
  }
}

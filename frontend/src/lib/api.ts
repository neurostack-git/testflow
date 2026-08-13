import { config } from "@/lib/config";
import { getJwt } from "@/lib/auth";
import type { Role } from "@/lib/permissions";

/** Error carrying the server's machine-readable `code` (LLD §9.6).
 *  The auth context switches on `org_not_provisioned` to run the workspace
 *  bootstrap, so the code must survive the throw. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const jwt = await getJwt();
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: jwt,
        ...(options.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(
      "Unable to connect. Please check your internet connection.",
      "network_error",
      0
    );
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const serverMsg = body.error as string | undefined;
    const code = (body.code as string | undefined) ?? "error";
    let message = serverMsg;
    if (!message || message === "Forbidden") {
      if (res.status === 403) message = "You don't have permission to do that.";
      else if (res.status >= 500) message = "Something went wrong on our end. Please try again.";
      else message = "Something went wrong. Please try again.";
    }
    throw new ApiError(message, code, res.status);
  }
  return res.json();
}

// ── Org ───────────────────────────────────────────────────────────────────────

export const orgApi = {
  /** Workspace bootstrap — called once, right after the Owner's first login. */
  create: (name: string, ownerName?: string) =>
    request<{ orgId: string; name: string; role: Role }>("/org", {
      method: "POST",
      body: JSON.stringify({ name, ownerName }),
    }),
  get: () => request<Org>("/org"),
  rename: (name: string) =>
    request<{ orgId: string; name: string }>("/org", {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  listMembers: () => request<{ members: OrgMember[] }>("/org/members"),
  invite: (email: string, role: Role) =>
    request<OrgMember>("/org/invite", {
      method: "POST",
      body: JSON.stringify({ email, role }),
    }),
  removeMember: (sub: string) =>
    request<{ removed: string }>(`/org/members/${sub}`, { method: "DELETE" }),
  transferOwnership: (toSub: string) =>
    request<{ ownerSub: string }>("/org/transfer-ownership", {
      method: "POST",
      body: JSON.stringify({ toSub }),
    }),
};

// ── Projects ──────────────────────────────────────────────────────────────────

export const projectsApi = {
  list: () => request<{ projects: Project[] }>("/projects"),
  create: (title: string) =>
    request<Project>("/projects", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  get: (projectId: string) =>
    request<Project>(`/projects/${projectId}`),
  rename: (projectId: string, title: string) =>
    request<Project>(`/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  softDelete: (projectId: string) =>
    request(`/projects/${projectId}`, { method: "DELETE" }),
  listBin: () => request<{ projects: Project[] }>("/projects/bin"),
  restore: (projectId: string) =>
    request(`/projects/${projectId}/restore`, { method: "POST" }),
  permanentDelete: (projectId: string) =>
    request(`/projects/${projectId}/permanent`, { method: "DELETE" }),
  listReports: (projectId: string) =>
    request<{ reports: ProjectReport[] }>(`/projects/${projectId}/reports`),
  saveReport: (projectId: string, payload: SaveReportPayload) =>
    request<ProjectReport>(`/projects/${projectId}/reports`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteReport: (projectId: string, reportId: string) =>
    request(`/projects/${projectId}/reports/${reportId}`, { method: "DELETE" }),
};

// ── Bugs ──────────────────────────────────────────────────────────────────────

export const bugsApi = {
  list: (projectId: string) =>
    request<{ bugs: Bug[] }>(`/projects/${projectId}/bugs`),
  create: (projectId: string, payload: CreateBugPayload) =>
    request<Bug>(`/projects/${projectId}/bugs`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  get: (projectId: string, bugId: string) =>
    request<Bug>(`/projects/${projectId}/bugs/${bugId}`),
  update: (projectId: string, bugId: string, payload: UpdateBugPayload) =>
    request<Bug>(`/projects/${projectId}/bugs/${bugId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  updateStatus: (projectId: string, bugId: string, status: BugStatus) =>
    request<{ status: BugStatus; updatedAt: string }>(
      `/projects/${projectId}/bugs/${bugId}/status`,
      { method: "PATCH", body: JSON.stringify({ status }) }
    ),
  delete: (projectId: string, bugId: string) =>
    request(`/projects/${projectId}/bugs/${bugId}`, { method: "DELETE" }),
};

// ── Attachments ───────────────────────────────────────────────────────────────

export const attachmentsApi = {
  presign: (payload: PresignPayload) =>
    request<{ presignedUrl: string; s3Key: string }>("/attachments/presign", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  viewUrl: (key: string, inline = false) =>
    request<{ url: string; filename: string }>(
      `/attachments/view?key=${encodeURIComponent(key)}${inline ? "&inline=true" : ""}`
    ),
  viewContent: (key: string) =>
    request<{ content: string; filename: string }>(
      `/attachments/view?key=${encodeURIComponent(key)}&content=true`
    ),
};

export async function uploadToS3(presignedUrl: string, file: File): Promise<void> {
  const res = await fetch(presignedUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });
  if (!res.ok) throw new Error("S3 upload failed");
}

export function uploadToS3WithProgress(
  presignedUrl: string,
  file: File,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", presignedUrl);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("S3 upload failed")));
    xhr.onerror = () => reject(new Error("S3 upload failed"));
    xhr.send(file);
  });
}

// ── Chat ──────────────────────────────────────────────────────────────────────

export const chatApi = {
  history: (projectId: string, cursor?: string) =>
    request<{ messages: ChatMessage[]; nextCursor: string | null }>(
      `/projects/${projectId}/chat/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`
    ),
  clearHistory: (projectId: string) =>
    request<{ deleted: number }>(`/projects/${projectId}/chat/history`, { method: "DELETE" }),
  members: (projectId: string) =>
    request<{ members: ChatMember[] }>(`/projects/${projectId}/chat/members`),
};

// ── Notifications ─────────────────────────────────────────────────────────────

export const notificationsApi = {
  list: () => request<{ notifications: AppNotification[]; unreadCount: number }>("/notifications"),
  markRead: (notifId: string) =>
    request(`/notifications/${notifId}/read`, { method: "PATCH" }),
  markAllRead: () => request("/notifications/read-all", { method: "PATCH" }),
  clearAll: () => request("/notifications", { method: "DELETE" }),
};

// ── Users ─────────────────────────────────────────────────────────────────────

export const usersApi = {
  me: () => request<UserProfile>("/users/me"),
  updateMe: (payload: { name?: string; phone?: string }) =>
    request("/users/me", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  sendPhoneOtp: (phone: string) =>
    request("/users/me/phone/send-otp", {
      method: "POST",
      body: JSON.stringify({ phone }),
    }),
  verifyPhoneOtp: (otp: string) =>
    request<{ phone: string }>("/users/me/phone/verify-otp", {
      method: "POST",
      body: JSON.stringify({ otp }),
    }),
  presignAvatar: () =>
    request<{ presignedUrl: string; s3Key: string }>("/users/me/avatar/presign", { method: "POST" }),
  updateAvatar: (s3Key: string) =>
    request<{ avatarKey: string }>("/users/me/avatar", {
      method: "PATCH",
      body: JSON.stringify({ s3Key }),
    }),
  deleteAvatar: () =>
    request("/users/me/avatar", { method: "DELETE" }),
};

// ── Types ─────────────────────────────────────────────────────────────────────

export type BugStatus = "Open" | "Fixed" | "Reopened" | "Closed" | "Invalid";

export interface Org {
  orgId: string;
  name: string;
  ownerSub: string;
  memberCount: number;
}

export interface OrgMember {
  sub: string;
  email: string;
  name: string;
  role: Role;
  /** "pending" until they complete their first sign-in. */
  status: "active" | "pending";
  joinedAt: string;
}

export interface Project {
  projectId: string;
  orgId: string;
  title: string;
  createdBy: string;
  createdAt: string;
  /** Org-wide member count — identical for every project under the org model. */
  memberCount?: number;
  deletedAt?: string;
}

export interface Bug {
  bugId: string;
  projectId: string;
  title: string;
  description: string;
  screenshots: string[];
  videos?: string[];
  documents: string[];
  status: BugStatus;
  reportedBy: string;
  reporterName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBugPayload {
  title: string;
  description: string;
  screenshots: string[];
  documents: string[];
  videos: string[];
}

export interface UpdateBugPayload {
  title?: string;
  description?: string;
  status?: BugStatus;
  screenshots?: string[];
  videos?: string[];
}

export interface PresignPayload {
  filename: string;
  contentType: string;
  projectId: string;
  bugId?: string;
  uploadType?: "bug" | "report";
}

export interface UserProfile {
  email: string;
  name: string;
  phone: string;
  role: Role;
  orgId: string;
  orgName: string;
  isOwner: boolean;
  avatarKey?: string;
}

export interface ProjectReport {
  reportId: string;
  projectId: string;
  s3Key: string;
  filename: string;
  contentType: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface SaveReportPayload {
  s3Key: string;
  filename: string;
  contentType: string;
}

export interface ChatMessage {
  messageId: string;
  projectId: string;
  senderSub: string;
  senderName: string;
  senderRole: Role;
  content: string;
  mentions: string[];
  createdAt: string;
}

export interface ChatMember {
  sub: string;
  name: string;
  role: Role;
  avatarKey?: string;
}

export interface AppNotification {
  notifId: string;
  SK: string;
  type: "mention" | "message" | "bug_created" | "bug_reopened";
  projectId: string;
  projectTitle: string;
  fromName: string;
  content: string;
  read: boolean;
  createdAt: string;
}

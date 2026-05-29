import { config } from "@/lib/config";
import { getJwt } from "@/lib/auth";

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
    throw new Error("Unable to connect. Please check your internet connection.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const serverMsg = body.error as string | undefined;
    if (serverMsg && serverMsg !== "Forbidden") throw new Error(serverMsg);
    if (res.status === 403) throw new Error("You don't have permission to do that.");
    if (res.status >= 500) throw new Error("Something went wrong on our end. Please try again.");
    throw new Error(serverMsg || "Something went wrong. Please try again.");
  }
  return res.json();
}

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
  softDelete: (projectId: string) =>
    request(`/projects/${projectId}`, { method: "DELETE" }),
  listBin: () => request<{ projects: Project[] }>("/projects/bin"),
  restore: (projectId: string) =>
    request(`/projects/${projectId}/restore`, { method: "POST" }),
  permanentDelete: (projectId: string) =>
    request(`/projects/${projectId}/permanent`, { method: "DELETE" }),
  listMembers: (projectId: string) =>
    request<{ members: Member[] }>(`/projects/${projectId}/members`),
  removeMember: (projectId: string, memberId: string) =>
    request(`/projects/${projectId}/members/${memberId}`, { method: "DELETE" }),
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

// ── Auth ──────────────────────────────────────────────────────────────────────

export const authApi = {
  inviteTester: (email: string, projectId: string) =>
    request("/auth/invite", {
      method: "POST",
      body: JSON.stringify({ email, projectId }),
    }),
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
};

// ── Types ─────────────────────────────────────────────────────────────────────

export type BugStatus = "Open" | "Fixed" | "Closed" | "Invalid";

export interface Project {
  projectId: string;
  title: string;
  createdAt: string;
  testerCount?: number;
  deletedAt?: string;
  adminName?: string;
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

export interface Member {
  memberId: string;
  email: string;
  name: string;
  joinedAt: string;
}

export interface UserProfile {
  email: string;
  name: string;
  phone: string;
  role: "admin" | "tester";
  adminName?: string;
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
  senderRole: "admin" | "tester";
  content: string;
  mentions: string[];
  createdAt: string;
}

export interface ChatMember {
  sub: string;
  name: string;
  role: "admin" | "tester";
}

export interface AppNotification {
  notifId: string;
  SK: string;
  type: "mention" | "message";
  projectId: string;
  projectTitle: string;
  fromName: string;
  content: string;
  read: boolean;
  createdAt: string;
}

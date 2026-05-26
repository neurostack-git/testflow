import { config } from "@/lib/config";
import { getJwt } from "@/lib/auth";

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const jwt = await getJwt();
  const res = await fetch(`${config.apiUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: jwt,
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
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
  viewUrl: (key: string) =>
    request<{ url: string; filename: string }>(`/attachments/view?key=${encodeURIComponent(key)}`),
};

export async function uploadToS3(presignedUrl: string, file: File): Promise<void> {
  const res = await fetch(presignedUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });
  if (!res.ok) throw new Error("S3 upload failed");
}

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

export type BugStatus = "Open" | "Fixed" | "Verified" | "Reopen";

export interface Project {
  projectId: string;
  title: string;
  createdAt: string;
  testerCount?: number;
}

export interface Bug {
  bugId: string;
  projectId: string;
  title: string;
  description: string;
  screenshots: string[];
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
}

export interface UpdateBugPayload {
  title?: string;
  description?: string;
  status?: BugStatus;
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

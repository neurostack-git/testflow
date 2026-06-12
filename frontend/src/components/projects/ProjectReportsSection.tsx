"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Upload, FileText, Eye, Download, Trash2, X } from "lucide-react";
import { projectsApi, attachmentsApi, uploadToS3, type ProjectReport } from "@/lib/api";
import { ReportViewer } from "@/components/projects/ReportViewer";

const REPORT_ACCEPT = ".md,.txt,.pdf,.docx,text/markdown,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const REPORT_CONTENT_TYPES: Record<string, string> = {
  md: "text/markdown",
  txt: "text/plain",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function getContentType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return REPORT_CONTENT_TYPES[ext] ?? "application/octet-stream";
}

interface ProjectReportsSectionProps {
  projectId: string;
}

export function ProjectReportsSection({ projectId }: ProjectReportsSectionProps) {
  const [reports, setReports] = useState<ProjectReport[]>([]);
  const [stagedReports, setStagedReports] = useState<File[]>([]);
  const [uploadingReports, setUploadingReports] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportViewer, setReportViewer] = useState<{ url: string; filename: string; contentType: string; textContent?: string } | null>(null);
  const [reportViewLoading, setReportViewLoading] = useState<string | null>(null);

  useEffect(() => {
    projectsApi.listReports(projectId)
      .then((res) => setReports(res.reports))
      .catch(() => setReportError("Failed to load reports"));
  }, [projectId]);

  function handleReportFileAdd(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    setStagedReports((prev) => [...prev, ...files]);
    e.target.value = "";
  }

  async function handleViewReport(report: ProjectReport) {
    setReportViewLoading(report.reportId);
    try {
      const ext = report.filename.split(".").pop()?.toLowerCase() ?? "";
      if (ext === "md" || ext === "txt") {
        const { content, filename } = await attachmentsApi.viewContent(report.s3Key);
        setReportViewer({ url: "", filename, contentType: report.contentType, textContent: content });
      } else {
        const { url, filename } = await attachmentsApi.viewUrl(report.s3Key, true);
        setReportViewer({ url, filename, contentType: report.contentType });
      }
    } catch {
      setReportError("Failed to load report preview");
    } finally {
      setReportViewLoading(null);
    }
  }

  function removeStagedReport(index: number) {
    setStagedReports((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleUploadReports() {
    if (!stagedReports.length || !projectId) return;
    setUploadingReports(true);
    setReportError("");
    try {
      for (const file of stagedReports) {
        const contentType = getContentType(file);
        const { presignedUrl, s3Key } = await attachmentsApi.presign({
          filename: file.name,
          contentType,
          projectId,
          uploadType: "report",
        });
        await uploadToS3(presignedUrl, file);
        const saved = await projectsApi.saveReport(projectId, { s3Key, filename: file.name, contentType });
        setReports((prev) => [...prev, saved]);
      }
      setStagedReports([]);
    } catch (err: unknown) {
      setReportError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingReports(false);
    }
  }

  async function handleDeleteReport(reportId: string) {
    try {
      await projectsApi.deleteReport(projectId, reportId);
      setReports((prev) => prev.filter((r) => r.reportId !== reportId));
    } catch {
      setReportError("Failed to delete report");
    }
  }

  async function handleDownloadReport(s3Key: string) {
    try {
      const { url } = await attachmentsApi.viewUrl(s3Key);
      window.open(url, "_blank");
    } catch {
      setReportError("Failed to get download link");
    }
  }

  return (
    <>
      <div className="mt-8 border border-border rounded-xl overflow-hidden bg-card">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">Overall Report</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
              {reports.length}
            </span>
          </div>
          <div className="relative">
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer border-border text-foreground hover:bg-muted/40">
              <Plus className="w-3.5 h-3.5" />
              Add Files
              <input type="file" multiple accept={REPORT_ACCEPT} className="hidden" onChange={handleReportFileAdd} />
            </label>
          </div>
        </div>

        <div className="p-4 space-y-2">
          {reportError && (
            <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg mb-2">{reportError}</p>
          )}

          {reports.map((report) => (
            <div key={report.reportId} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-border bg-background text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="truncate font-medium text-foreground">{report.filename}</span>
                <span className="text-muted-foreground text-xs shrink-0">
                  {new Date(report.uploadedAt).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => handleViewReport(report)} disabled={reportViewLoading === report.reportId}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors" title="View">
                  {reportViewLoading === report.reportId
                    ? <div className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground border-t-transparent animate-spin" />
                    : <Eye className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => handleDownloadReport(report.s3Key)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" title="Download">
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleDeleteReport(report.reportId)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Delete">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}

          {stagedReports.map((file, i) => (
            <div key={i} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-dashed border-primary/40 bg-primary/5 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-primary shrink-0" />
                <span className="truncate font-medium text-foreground">{file.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">Pending</span>
              </div>
              <button onClick={() => removeStagedReport(i)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {reports.length === 0 && stagedReports.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-6">No report files yet.</p>
          )}

          {stagedReports.length > 0 && (
            <div className="flex justify-end pt-2">
              <Button size="sm" className="bg-primary hover:bg-primary/90 gap-1.5" onClick={handleUploadReports} disabled={uploadingReports}>
                <Upload className="w-3.5 h-3.5" />
                {uploadingReports ? "Uploading…" : `Upload ${stagedReports.length} file${stagedReports.length !== 1 ? "s" : ""}`}
              </Button>
            </div>
          )}
        </div>
      </div>

      <ReportViewer viewer={reportViewer} onClose={() => setReportViewer(null)} />
    </>
  );
}

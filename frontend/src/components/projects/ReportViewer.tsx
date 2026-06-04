"use client";

import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, Download, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ReportViewerData {
  url: string;
  filename: string;
  contentType: string;
  textContent?: string;
}

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function ReportViewer({
  viewer,
  onClose,
}: {
  viewer: ReportViewerData | null;
  onClose: () => void;
}) {
  if (!viewer) return null;

  const isMd = viewer.filename.toLowerCase().endsWith(".md");

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-background rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="font-semibold text-sm text-foreground truncate">{viewer.filename}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={viewer.url}
              download={viewer.filename}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border text-foreground hover:bg-muted/40 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </a>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          {viewer.textContent !== undefined ? (
            isMd ? (
              <div className="max-w-4xl mx-auto px-8 py-6 text-sm leading-7 text-foreground">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => <h1 className="text-2xl font-bold mt-6 mb-4 pb-2 border-b border-border">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-xl font-bold mt-6 mb-3 pb-2 border-b border-border">{children}</h2>,
                    h3: ({ children }) => <h3 className="text-lg font-semibold mt-5 mb-2">{children}</h3>,
                    h4: ({ children }) => <h4 className="text-base font-semibold mt-4 mb-2">{children}</h4>,
                    p: ({ children }) => <p className="mb-4">{children}</p>,
                    pre: ({ children }) => <pre className="bg-muted rounded-lg p-4 overflow-x-auto mb-4 text-xs font-mono">{children}</pre>,
                    code: ({ className, children }) => className
                      ? <code className={cn("font-mono text-xs", className)}>{children}</code>
                      : <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>,
                    ul: ({ children }) => <ul className="mb-4 ml-5 list-disc space-y-1">{children}</ul>,
                    ol: ({ children }) => <ol className="mb-4 ml-5 list-decimal space-y-1">{children}</ol>,
                    li: ({ children }) => <li className="leading-7">{children}</li>,
                    blockquote: ({ children }) => <blockquote className="border-l-4 border-border pl-4 text-muted-foreground my-4">{children}</blockquote>,
                    a: ({ href, children }) => <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                    table: ({ children }) => <div className="overflow-x-auto mb-4"><table className="w-full border-collapse border border-border text-sm">{children}</table></div>,
                    thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
                    tr: ({ children }) => <tr className="border-b border-border">{children}</tr>,
                    th: ({ children }) => <th className="px-3 py-2 text-left font-semibold border-r border-border last:border-r-0">{children}</th>,
                    td: ({ children }) => <td className="px-3 py-2 border-r border-border last:border-r-0">{children}</td>,
                    hr: () => <hr className="my-6 border-border" />,
                    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                    em: ({ children }) => <em className="italic">{children}</em>,
                  }}
                >
                  {viewer.textContent}
                </ReactMarkdown>
              </div>
            ) : (
              <pre className="p-6 text-sm font-mono text-foreground whitespace-pre-wrap break-words">{viewer.textContent}</pre>
            )
          ) : viewer.contentType === DOCX_TYPE ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
              <FileText className="w-12 h-12 opacity-30" />
              <p className="text-sm">Preview not available for .docx files.</p>
              <a
                href={viewer.url}
                download={viewer.filename}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Download className="w-4 h-4" />
                Download to view
              </a>
            </div>
          ) : (
            <iframe src={viewer.url} title={viewer.filename} className="w-full h-full border-0" />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

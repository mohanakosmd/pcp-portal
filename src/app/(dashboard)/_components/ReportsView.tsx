"use client";

import { useEffect, useMemo, useState } from "react";

import type { GiMedicalFile, GiSharedReport } from "@/lib/gi-reports";

type ReportComment = {
  id: string;
  authorName: string;
  authorRole: string;
  body: string;
  createdAt: string;
};

const ROWS_PER_PAGE = 5;

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function formatBytes(n: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function splitSymptoms(s: string): string[] {
  if (!s) return [];
  return s
    .split(/[,\n;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function ReportsView({ reports }: { reports: GiSharedReport[] }) {
  const [page, setPage] = useState(1);
  const [activeReport, setActiveReport] = useState<GiSharedReport | null>(null);
  const [remark, setRemark] = useState("");
  const [comments, setComments] = useState<ReportComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentError, setCommentError] = useState("");

  const totalPages = Math.max(1, Math.ceil(reports.length / ROWS_PER_PAGE));
  const visibleRows = useMemo(() => {
    const start = (page - 1) * ROWS_PER_PAGE;
    return reports.slice(start, start + ROWS_PER_PAGE);
  }, [page, reports]);

  const lastReviewed = useMemo(() => {
    if (!reports.length) return null;
    return reports[0].sharedAt;
  }, [reports]);

  useEffect(() => {
    if (!activeReport) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [activeReport]);

  useEffect(() => {
    if (!activeReport) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveReport(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [activeReport]);

  // Load remarks for the open report.
  useEffect(() => {
    if (!activeReport) {
      setComments([]);
      return;
    }
    let cancelled = false;
    setCommentsLoading(true);
    setCommentError("");
    fetch(`/api/reports/${encodeURIComponent(activeReport.id)}/comments`)
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as {
          comments?: ReportComment[];
          error?: string;
        };
        if (!r.ok) throw new Error(data.error || `Failed (${r.status})`);
        return Array.isArray(data.comments) ? data.comments : [];
      })
      .then((list) => {
        if (!cancelled) setComments(list);
      })
      .catch(() => {
        if (!cancelled) setComments([]);
      })
      .finally(() => {
        if (!cancelled) setCommentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeReport]);

  const openReport = (row: GiSharedReport) => {
    setRemark("");
    setCommentError("");
    setActiveReport(row);
  };

  const closeReport = () => setActiveReport(null);

  const handleDownload = (row: GiSharedReport) => {
    if (!row.medicalFiles.length) {
      window.alert("No medical files attached to this report.");
      return;
    }
    // Open each file in a new tab — browser handles direct download for PDFs.
    for (const f of row.medicalFiles) {
      if (f.docUrl) window.open(f.docUrl, "_blank", "noopener");
    }
  };

  const submitRemark = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeReport) return;
    const text = remark.trim();
    if (!text) {
      setCommentError("Please add a remark before submitting.");
      return;
    }
    setCommentSubmitting(true);
    setCommentError("");
    try {
      const r = await fetch(
        `/api/reports/${encodeURIComponent(activeReport.id)}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: text }),
        }
      );
      const data = (await r.json().catch(() => ({}))) as {
        comment?: ReportComment;
        error?: string;
      };
      if (!r.ok) throw new Error(data.error || `Failed (${r.status})`);
      if (data.comment) setComments((prev) => [...prev, data.comment!]);
      setRemark("");
    } catch (err) {
      setCommentError(
        err instanceof Error ? err.message : "Could not submit the remark."
      );
    } finally {
      setCommentSubmitting(false);
    }
  };

  return (
    <main className="dash-main reports-main" id="main">
      <div className="reports-shell">
        <div className="dash-page-head">
          <h1>Reports</h1>
        </div>

        <section className="reports-workspace" aria-label="Report preview">
          <div className="reports-canvas">
            <article className="reports-paper">
              <header className="reports-paper__head">
                <div className="reports-paper__title">
                  <span className="reports-paper__icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9l-6-6z"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M14 3v6h6M9 13h6M9 17h4"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                  <div>
                    <h2>Final Case Report</h2>
                    <p>Reports shared back to your cases by GI specialists</p>
                  </div>
                </div>
                <div className="reports-paper__date">
                  Last reviewed
                  <strong>{formatDate(lastReviewed)}</strong>
                </div>
              </header>

              <div className="reports-table-wrap">
                {reports.length === 0 ? (
                  <p
                    style={{
                      padding: "32px 12px",
                      textAlign: "center",
                      color: "#64748b",
                    }}
                  >
                    No GI reports have been shared with your cases yet.
                  </p>
                ) : (
                  <>
                    <table className="reports-table" aria-label="Report metadata">
                      <thead>
                        <tr>
                          <th>Report</th>
                          <th>Patient</th>
                          <th>Date of birth</th>
                          <th>Case ID</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRows.map((row) => (
                          <tr key={row.id}>
                            <td>{row.reportName}</td>
                            <td>{row.patientName}</td>
                            <td>{row.dateOfBirth ?? "—"}</td>
                            <td>#{row.caseShortCode}</td>
                            <td>
                              <span className="reports-pill reports-pill--done">
                                {row.status}
                              </span>
                            </td>
                            <td>
                              <div className="reports-row-actions">
                                <button
                                  type="button"
                                  className="reports-row-view"
                                  onClick={() => openReport(row)}
                                >
                                  View report
                                </button>
                                <button
                                  type="button"
                                  className="reports-row-download"
                                  onClick={() => handleDownload(row)}
                                  disabled={row.medicalFiles.length === 0}
                                  title={
                                    row.medicalFiles.length
                                      ? `Download ${row.medicalFiles.length} file(s)`
                                      : "No files attached"
                                  }
                                >
                                  Download
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div
                      className="reports-pagination"
                      style={{
                        marginTop: 14,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        gap: 10,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                      >
                        Previous
                      </button>
                      <span aria-live="polite">
                        Page {page} of {totalPages}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                      >
                        Next
                      </button>
                    </div>
                  </>
                )}
              </div>

              <p className="reports-note">
                For urgent symptoms, call your clinic immediately or dial 911.
              </p>
            </article>
          </div>
        </section>
      </div>

      {activeReport ? (
        <ReportModal
          row={activeReport}
          remark={remark}
          onRemarkChange={setRemark}
          onSubmitRemark={submitRemark}
          onClose={closeReport}
          comments={comments}
          commentsLoading={commentsLoading}
          commentSubmitting={commentSubmitting}
          commentError={commentError}
        />
      ) : null}
    </main>
  );
}

type ReportModalProps = {
  row: GiSharedReport;
  remark: string;
  onRemarkChange: (value: string) => void;
  onSubmitRemark: (event: React.FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  comments: ReportComment[];
  commentsLoading: boolean;
  commentSubmitting: boolean;
  commentError: string;
};

function ReportModal({
  row,
  remark,
  onRemarkChange,
  onSubmitRemark,
  onClose,
  comments,
  commentsLoading,
  commentSubmitting,
  commentError,
}: ReportModalProps) {
  return (
    <div className="reports-modal">
      <div className="reports-modal__backdrop" onClick={onClose} />
      <section
        className="reports-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-modal-title"
      >
        <header className="reports-modal__head">
          <h2 id="report-modal-title">{row.reportName} Preview</h2>
          <button
            type="button"
            className="reports-modal__close"
            aria-label="Close report preview"
            onClick={onClose}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="reports-modal__body">
          <FinalReportBody row={row} />
        </div>

        <form className="reports-modal__remark" onSubmit={onSubmitRemark}>
          <label htmlFor="report-remark-input" className="reports-modal__remark-label">
            Remark
          </label>

          {commentsLoading ? (
            <p className="reports-remark-empty">Loading remarks…</p>
          ) : comments.length > 0 ? (
            <ul className="reports-remark-list">
              {comments.map((c) => (
                <li key={c.id} className="reports-remark-item">
                  <div className="reports-remark-item__head">
                    <strong>{c.authorName}</strong>
                    <span>{formatDateTime(c.createdAt)}</span>
                  </div>
                  <p className="reports-remark-item__body">{c.body}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="reports-remark-empty">No remarks yet. Add the first one below.</p>
          )}

          <textarea
            id="report-remark-input"
            className="reports-modal__remark-input"
            name="remark"
            rows={4}
            placeholder="Add your remark here..."
            value={remark}
            onChange={(e) => onRemarkChange(e.target.value)}
            disabled={commentSubmitting}
          />
          {commentError ? (
            <p className="reports-remark-error">{commentError}</p>
          ) : null}
          <div className="reports-modal__remark-actions">
            <button
              type="submit"
              className="reports-row-share"
              disabled={commentSubmitting}
            >
              {commentSubmitting ? "Submitting…" : "Submit"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function FinalReportBody({ row }: { row: GiSharedReport }) {
  const symptomChips = splitSymptoms(row.presentingSymptoms);
  return (
    <article className="reports-modal-report">
      <section className="reports-modal-report__meta">
        <p>
          <span>Patient</span>
          <strong>{row.patientName}</strong>
        </p>
        <p>
          <span>Case ID</span>
          <strong>#{row.caseShortCode}</strong>
        </p>
        <p>
          <span>Date finalized</span>
          <strong>{formatDate(row.sharedAt)}</strong>
        </p>
        <p>
          <span>Author</span>
          <strong>{row.giSpecialistName}</strong>
        </p>
        <p>
          <span>Priority</span>
          <strong>{row.priorityScore}</strong>
        </p>
        <p>
          <span>Status</span>
          <strong>{row.status}</strong>
        </p>
      </section>

      {row.clinicalSummary ? (
        <section className="reports-modal-report__section">
          <h3>Clinical Summary</h3>
          <p style={{ whiteSpace: "pre-wrap" }}>{row.clinicalSummary}</p>
        </section>
      ) : null}

      {row.presentingSymptoms || row.aiInsight ? (
        <section className="reports-modal-report__section">
          <h3>Presenting symptoms (AI intake)</h3>
          {row.presentingSymptoms ? (
            <p>
              <strong>From the patient:</strong> {row.presentingSymptoms}
            </p>
          ) : null}
          {symptomChips.length > 0 ? (
            <div className="reports-symptom-chips">
              {symptomChips.map((symptom) => (
                <span key={symptom} className="reports-symptom-chip">
                  {symptom}
                </span>
              ))}
            </div>
          ) : null}
          {row.aiInsight ? (
            <p style={{ whiteSpace: "pre-wrap" }}>
              <strong>AI symptom summary:</strong> {row.aiInsight}
            </p>
          ) : null}
        </section>
      ) : null}

      {row.giSpecialistPlan ? (
        <section className="reports-modal-report__section">
          <h3>GI Specialist Plan</h3>
          <p style={{ whiteSpace: "pre-wrap" }}>{row.giSpecialistPlan}</p>
        </section>
      ) : null}

      {row.recommendations.length > 0 ? (
        <section className="reports-modal-report__section">
          <h3>Recommendations</h3>
          <ol>
            {row.recommendations.map((item, i) => (
              <li key={`${i}-${item}`}>{item}</li>
            ))}
          </ol>
        </section>
      ) : null}

      {(row.insuranceCarrier || row.insurancePolicyId || row.insuranceGroup) ? (
        <section className="reports-modal-report__section">
          <h3>Insurance</h3>
          <ul>
            {row.insuranceCarrier ? <li>Carrier: {row.insuranceCarrier}</li> : null}
            {row.insurancePolicyId ? <li>Policy ID: {row.insurancePolicyId}</li> : null}
            {row.insuranceGroup ? <li>Group: {row.insuranceGroup}</li> : null}
          </ul>
        </section>
      ) : null}

      {row.medicalFiles.length > 0 ? (
        <section className="reports-modal-report__section">
          <h3>Attached medical files</h3>
          <MedicalFileList files={row.medicalFiles} />
        </section>
      ) : null}

      <section className="reports-modal-report__section">
        <h3>Escalation Criteria</h3>
        <p>
          Seek urgent clinical attention for worsening shortness of breath, persistent severe
          pain, confusion, sudden weakness, or any rapidly progressive symptoms.
        </p>
      </section>
    </article>
  );
}

function MedicalFileList({ files }: { files: GiMedicalFile[] }) {
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
      {files.map((f) => (
        <li
          key={f.id}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "8px 12px",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            background: "#f8fafc",
          }}
        >
          <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
            <strong
              style={{
                fontSize: 13,
                color: "#0f172a",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {f.fileName}
            </strong>
            <span style={{ fontSize: 11, color: "#64748b" }}>
              {f.docType} · {formatBytes(f.fileSize)} · uploaded by {f.uploadedByName || "—"}
            </span>
          </div>
          <a
            href={f.docUrl || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="reports-row-view"
            style={{ flexShrink: 0 }}
          >
            Open
          </a>
        </li>
      ))}
    </ul>
  );
}

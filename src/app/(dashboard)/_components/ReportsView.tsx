"use client";

import { useEffect, useMemo, useState } from "react";

import {
  REPORTS,
  getSymptomProfile,
  type ReportRow,
  type SymptomProfile,
} from "./reports-data";

const ROWS_PER_PAGE = 5;

export function ReportsView() {
  const [page, setPage] = useState(1);
  const [activeReport, setActiveReport] = useState<ReportRow | null>(null);
  const [remark, setRemark] = useState("");

  const totalPages = Math.max(1, Math.ceil(REPORTS.length / ROWS_PER_PAGE));
  const visibleRows = useMemo(() => {
    const start = (page - 1) * ROWS_PER_PAGE;
    return REPORTS.slice(start, start + ROWS_PER_PAGE);
  }, [page]);

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

  const openReport = (row: ReportRow) => {
    setRemark("");
    setActiveReport(row);
  };

  const closeReport = () => setActiveReport(null);

  const handleDownload = (row: ReportRow) => {
    window.alert(`${row.reportName} download started (demo).`);
  };

  const handleShare = (row: ReportRow) => {
    window.alert(`${row.reportName} shared with GI (demo).`);
  };

  const submitRemark = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = remark.trim();
    if (!text) {
      window.alert("Please add a remark before submitting.");
      return;
    }
    window.alert(`Remark submitted: ${text}`);
    setRemark("");
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
                    <p>Your medical summary for this request</p>
                  </div>
                </div>
                <div className="reports-paper__date">
                  Last reviewed
                  <strong>March 14, 2026</strong>
                </div>
              </header>

              <div className="reports-table-wrap">
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
                      <tr key={row.caseId}>
                        <td>{row.reportName}</td>
                        <td>{row.patient}</td>
                        <td>{row.dob}</td>
                        <td>{row.caseId}</td>
                        <td>
                          <span className="reports-pill reports-pill--done">Finalized</span>
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
                              className="reports-row-share"
                              onClick={() => handleShare(row)}
                            >
                              Share with GI
                            </button>
                            <button
                              type="button"
                              className="reports-row-download"
                              onClick={() => handleDownload(row)}
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
        />
      ) : null}
    </main>
  );
}

type ReportModalProps = {
  row: ReportRow;
  remark: string;
  onRemarkChange: (value: string) => void;
  onSubmitRemark: (event: React.FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
};

function ReportModal({
  row,
  remark,
  onRemarkChange,
  onSubmitRemark,
  onClose,
}: ReportModalProps) {
  const profile = getSymptomProfile(row.caseId);
  const isFinalReport = row.reportName === "Final Case Report";

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
          {isFinalReport ? (
            <FinalReportBody row={row} profile={profile} />
          ) : (
            <GenericReportBody row={row} profile={profile} />
          )}
        </div>

        <form className="reports-modal__remark" onSubmit={onSubmitRemark}>
          <label htmlFor="report-remark-input" className="reports-modal__remark-label">
            Remark
          </label>
          <textarea
            id="report-remark-input"
            className="reports-modal__remark-input"
            name="remark"
            rows={4}
            placeholder="Add your remark here..."
            value={remark}
            onChange={(e) => onRemarkChange(e.target.value)}
          />
          <div className="reports-modal__remark-actions">
            <button type="submit" className="reports-row-share">
              Submit
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function FinalReportBody({ row, profile }: { row: ReportRow; profile: SymptomProfile }) {
  return (
    <article className="reports-modal-report">
      <section className="reports-modal-report__meta">
        <p>
          <span>Patient</span>
          <strong>Jordan Ellis</strong>
        </p>
        <p>
          <span>Case ID</span>
          <strong>{row.caseId}</strong>
        </p>
        <p>
          <span>Date finalized</span>
          <strong>March 14, 2026</strong>
        </p>
        <p>
          <span>Author</span>
          <strong>Dr. Elena Rossi, Neurology</strong>
        </p>
      </section>

      <section className="reports-modal-report__section">
        <h3>Clinical Summary</h3>
        <p>
          {row.summary} The patient reports improved tolerance to daily activity with no new
          neurological deficits, chest pain, or syncopal episodes since prior review.
        </p>
      </section>

      <section className="reports-modal-report__section">
        <h3>Objective Findings</h3>
        <ul>
          <li>Vitals stable at last check: BP 124/78, HR 74, afebrile.</li>
          <li>
            Recent CBC/CMP without critical outliers; mild ALT fluctuation remains clinically
            monitored.
          </li>
          <li>Medication reconciliation completed; adherence reported as consistent.</li>
        </ul>
      </section>

      <section className="reports-modal-report__section">
        <h3>Presenting symptoms (AI intake)</h3>
        <p>
          <strong>AI question:</strong> How long have you had reflux symptoms?
        </p>
        <p>
          <strong>AI question:</strong> 1. Describe your main concern
        </p>
        <div className="reports-symptom-chips">
          {profile.presenting.map((symptom) => (
            <span key={symptom} className="reports-symptom-chip">
              {symptom}
            </span>
          ))}
        </div>
        <p>
          <strong>AI symptom summary:</strong> {profile.ai}
        </p>
      </section>

      <section className="reports-modal-report__section">
        <h3>Assessment</h3>
        <p>
          Current status is clinically stable with moderate ongoing risk requiring scheduled
          follow-up rather than urgent escalation. No immediate red-flag findings identified in
          this review window.
        </p>
      </section>

      <section className="reports-modal-report__section">
        <h3>Care Plan and Recommendations</h3>
        <ol>
          {row.recommendations.map((item) => (
            <li key={item}>{item}</li>
          ))}
          <li>
            Maintain symptom diary and bring updates to next appointment for trend review.
          </li>
        </ol>
      </section>

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

function GenericReportBody({
  row,
  profile,
}: {
  row: ReportRow;
  profile: SymptomProfile;
}) {
  return (
    <>
      <p>
        <strong>Patient:</strong> Jordan Ellis
      </p>
      <p>
        <strong>Case:</strong> {row.caseId}
      </p>
      <p>
        <strong>Presenting symptoms (AI intake):</strong>
      </p>
      <p>
        <strong>AI question:</strong> How long have you had reflux symptoms?
      </p>
      <p>
        <strong>AI question:</strong> 1. Describe your main concern
      </p>
      <div className="reports-symptom-chips">
        {profile.presenting.map((symptom) => (
          <span key={symptom} className="reports-symptom-chip">
            {symptom}
          </span>
        ))}
      </div>
      <p>
        <strong>AI symptom summary:</strong> {profile.ai}
      </p>
      <p>
        <strong>Summary:</strong> {row.summary}
      </p>
      <p>
        <strong>Recommendations:</strong>
      </p>
      <ul>
        {row.recommendations.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  );
}

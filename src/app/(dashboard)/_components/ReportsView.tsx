"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ageFromDob } from "@/lib/age";
import type { GiSharedReport } from "@/lib/gi-reports";

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

function splitSymptoms(s: string): string[] {
  if (!s) return [];
  return s
    .split(/[,\n;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    // Chips are for short symptom keywords — drop long run-on sentences (e.g.
    // the default inbox placeholder) so they don't render as an overflowing pill.
    .filter((t) => t.length <= 32)
    .slice(0, 8);
}

/**
 * Builds and downloads a PDF of the report — same content shown in the
 * preview modal. jsPDF is imported lazily so it only loads when the user
 * actually clicks Download (and never on the server).
 */
async function downloadReportPdf(row: GiSharedReport): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - margin * 2;
  let y = margin;

  const ensure = (h: number) => {
    if (y + h > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const write = (
    str: string,
    opts: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number } = {}
  ) => {
    const { size = 11, bold = false, color = [30, 41, 59], gap = 4 } = opts;
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    const lineH = size * 1.35;
    const lines = doc.splitTextToSize(str, contentW) as string[];
    for (const line of lines) {
      ensure(lineH);
      doc.text(line, margin, y);
      y += lineH;
    }
    y += gap;
  };

  const heading = (str: string) => {
    y += 6;
    ensure(20);
    write(str, { size: 12, bold: true, color: [3, 54, 114], gap: 4 });
  };

  const rule = () => {
    ensure(12);
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y, pageW - margin, y);
    y += 12;
  };

  // Bulleted list laid out two items per row (left/right columns), matching the
  // two-column layout in the report modal. Long labels wrap within their column.
  const writeTwoColList = (items: string[]) => {
    const colGap = 18;
    const colW = (contentW - colGap) / 2;
    const lineH = 11 * 1.35;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    for (let i = 0; i < items.length; i += 2) {
      const leftLines = doc.splitTextToSize(`•  ${items[i]}`, colW) as string[];
      const rightLines = items[i + 1]
        ? (doc.splitTextToSize(`•  ${items[i + 1]}`, colW) as string[])
        : [];
      const rows = Math.max(leftLines.length, rightLines.length);
      ensure(lineH * rows);
      for (let r = 0; r < rows; r++) {
        if (leftLines[r]) doc.text(leftLines[r], margin, y + r * lineH);
        if (rightLines[r]) doc.text(rightLines[r], margin + colW + colGap, y + r * lineH);
      }
      y += lineH * rows;
    }
    y += 4;
  };

  // Light gray info cards (Provider / PCP / Pharmacy style). Only cards passed
  // in are drawn, so empty ones are omitted by the caller.
  const drawInfoCards = (cards: { label: string; lines: string[] }[]) => {
    if (cards.length === 0) return;
    const n = cards.length;
    const gap = 10;
    const cardW = (contentW - gap * (n - 1)) / n;
    const lineH = 13;
    const maxLines = Math.max(...cards.map((c) => c.lines.length));
    const cardH = 26 + maxLines * lineH;
    ensure(cardH + 12);
    cards.forEach((card, i) => {
      const x = margin + i * (cardW + gap);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(x, y, cardW, cardH, 6, 6, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(37, 99, 235);
      doc.text(card.label.toUpperCase(), x + 12, y + 16);
      let ly = y + 32;
      card.lines.forEach((ln, idx) => {
        doc.setFont("helvetica", idx === 0 ? "bold" : "normal");
        doc.setFontSize(idx === 0 ? 10.5 : 9);
        doc.setTextColor(idx === 0 ? 15 : 71, idx === 0 ? 23 : 85, idx === 0 ? 42 : 105);
        const lns = doc.splitTextToSize(ln || "—", cardW - 24) as string[];
        doc.text(lns[0] ?? "", x + 12, ly);
        ly += lineH;
      });
    });
    y += cardH + 12;
  };

  // Bordered label/value cells in a row (demographics, insurance). `fill` tints
  // the cells (used for the blue insurance row).
  const drawFieldGrid = (
    cells: { label: string; value: string }[],
    opts: { cols?: number; fill?: [number, number, number] } = {}
  ) => {
    if (cells.length === 0) return;
    const { cols = cells.length, fill } = opts;
    const gap = 8;
    const cellW = (contentW - gap * (cols - 1)) / cols;
    const cellH = 44;
    const rows = Math.ceil(cells.length / cols);
    ensure(rows * (cellH + gap) + 6);
    cells.forEach((cell, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const x = margin + c * (cellW + gap);
      const cy = y + r * (cellH + gap);
      doc.setDrawColor(fill ? 191 : 226, fill ? 219 : 232, fill ? 254 : 240);
      if (fill) {
        doc.setFillColor(fill[0], fill[1], fill[2]);
        doc.roundedRect(x, cy, cellW, cellH, 5, 5, "FD");
      } else {
        doc.roundedRect(x, cy, cellW, cellH, 5, 5, "S");
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(fill ? 37 : 100, fill ? 99 : 116, fill ? 235 : 139);
      doc.text(cell.label.toUpperCase(), x + 10, cy + 16);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(15, 23, 42);
      const vlines = doc.splitTextToSize(cell.value || "—", cellW - 20) as string[];
      doc.text(vlines[0] ?? "—", x + 10, cy + 32);
    });
    y += rows * (cellH + gap) + 6;
  };

  // Cream highlighted "Chief Complaint" box.
  const drawChiefComplaint = (value: string) => {
    if (!value) return;
    const boxH = 50;
    ensure(boxH + 6);
    doc.setFillColor(254, 249, 231);
    doc.setDrawColor(250, 204, 21);
    doc.roundedRect(margin, y, contentW, boxH, 6, 6, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(161, 98, 7);
    doc.text("CHIEF COMPLAINT", margin + 14, y + 18);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(30, 41, 59);
    const vlines = doc.splitTextToSize(value, contentW - 28) as string[];
    doc.text(vlines[0] ?? "", margin + 14, y + 38);
    y += boxH + 12;
  };

  // --- Header: logo (page 1) ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(2, 76, 156);
  doc.text("aigi", margin, y + 14);
  const logoW = doc.getTextWidth("aigi");
  doc.setFontSize(9);
  doc.setTextColor(220, 38, 38);
  doc.text("CARE", margin + logoW + 5, y + 14);
  y += 36;

  // --- Info cards (omit ones with no data) ---
  const cards: { label: string; lines: string[] }[] = [];
  if (row.giSpecialistName) {
    cards.push({
      label: "GI Specialist",
      lines: [
        row.giSpecialistName,
        row.priorityScore && row.priorityScore !== "—" ? row.priorityScore : "",
      ].filter(Boolean),
    });
  }
  cards.push({
    label: "Report",
    lines: [row.reportName || "GI Specialist Report", `Finalized ${formatDate(row.sharedAt)}`],
  });
  cards.push({
    label: "Case",
    lines: [`#${row.caseShortCode}`, `Status: ${row.status}`],
  });
  drawInfoCards(cards);

  // --- Patient name ---
  ensure(30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(2, 76, 156);
  doc.text(row.patientName || "Patient", margin, y + 16);
  y += 30;

  // --- Demographics ---
  const age = ageFromDob(row.dateOfBirth);
  const sex = row.gender ? row.gender.charAt(0).toUpperCase() + row.gender.slice(1) : "—";
  drawFieldGrid([
    { label: "Date of Birth", value: row.dateOfBirth ? formatDate(row.dateOfBirth) : "—" },
    { label: "Age", value: age != null ? `${age} yrs` : "—" },
    { label: "Sex", value: sex },
    { label: "Phone", value: row.phone || "—" },
  ]);

  // --- Chief complaint (best available reason for consult) ---
  drawChiefComplaint(row.recommendedProcedures[0] || row.recommendedTests[0] || "");

  // --- Insurance (omit entirely when empty) ---
  const insuranceCells = [
    row.insuranceCarrier ? { label: "Insurance Carrier", value: row.insuranceCarrier } : null,
    row.insuranceGroup ? { label: "Group Name", value: row.insuranceGroup } : null,
    row.insurancePolicyId ? { label: "Insurance ID", value: row.insurancePolicyId } : null,
  ].filter((c): c is { label: string; value: string } => c !== null);
  if (insuranceCells.length > 0) {
    drawFieldGrid(insuranceCells, { fill: [239, 246, 255] });
  }

  // --- History of Present Illness ---
  const hpi = row.presentingSymptoms || row.clinicalSummary;
  if (hpi) {
    heading("History of Present Illness (HPI)");
    write(hpi);
  }
  if (row.clinicalSummary && row.clinicalSummary !== hpi) {
    heading("Clinical Summary");
    write(row.clinicalSummary);
  }
  if (row.aiInsight) {
    heading("AI Insight");
    write(row.aiInsight);
  }

  heading("Current Medication");
  write("Medications reported by the patient during intake.", {
    size: 9,
    color: [100, 116, 139],
    gap: 4,
  });
  if (row.currentMedications) {
    write(row.currentMedications);
  } else {
    write("No current medication reported.", { color: [148, 163, 184] });
  }

  heading("Assessment");
  write(`Current status: ${row.status}.`);

  if (row.clinicalDiagnosis || row.treatmentNotes) {
    heading("Clinical Diagnosis & Plan");
    if (row.clinicalDiagnosis) write(row.clinicalDiagnosis);
    if (row.treatmentNotes) write(`Treatment notes: ${row.treatmentNotes}`);
  }

  if (row.recommendedTests.length > 0) {
    heading("Recommended Tests");
    writeTwoColList(row.recommendedTests);
  }

  if (row.recommendedProcedures.length > 0) {
    heading("Recommended Procedures");
    writeTwoColList(row.recommendedProcedures);
  }

  heading("Medication");
  if (row.medications.length > 0) {
    row.medications.forEach((item) => write(`• ${item}`, { gap: 2 }));
  } else {
    write("No medications reported.", { color: [148, 163, 184] });
  }

  if (row.assessmentPlanFiles.length > 0) {
    heading("Assessment & Plan Files");
    row.assessmentPlanFiles.forEach((group) => {
      write(`${group.category}:`, { gap: 2 });
      writeTwoColList(group.files);
    });
    y += 4;
  }

  if (row.giSpecialistPlan || row.otherRecommendations.length > 0) {
    heading("Care Plan and Recommendations");
    if (row.giSpecialistPlan) write(row.giSpecialistPlan);
    row.otherRecommendations.forEach((item, i) => write(`${i + 1}. ${item}`, { gap: 2 }));
    y += 4;
  }

  heading("Escalation Criteria");
  write(
    "Seek urgent clinical attention for worsening shortness of breath, persistent severe pain, confusion, sudden weakness, or any rapidly progressive symptoms."
  );

  y += 6;
  rule();
  write("For urgent symptoms, call your clinic immediately or dial 911.", {
    size: 9,
    color: [100, 116, 139],
    gap: 0,
  });

  // Top band + "Page X of Y" on every page (drawn last so the count is final).
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFillColor(74, 144, 226);
    doc.rect(0, 0, pageW, 16, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(`Page ${p} of ${pageCount}`, pageW - margin, 11, { align: "right" });
  }

  const safeName =
    `${(row.reportName || "report").replace(/[^a-z0-9]+/gi, "-")}-${row.caseShortCode || "case"}`.toLowerCase();
  doc.save(`${safeName}.pdf`);
}

export function ReportsView({
  reports,
  focusId = null,
  initialFilter = null,
}: {
  reports: GiSharedReport[];
  focusId?: string | null;
  initialFilter?: string | null;
}) {
  const [page, setPage] = useState(1);
  const [filterText, setFilterText] = useState<string>(initialFilter?.trim() ?? "");
  const [activeReport, setActiveReport] = useState<GiSharedReport | null>(null);
  const [remark, setRemark] = useState("");
  const [comments, setComments] = useState<ReportComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentError, setCommentError] = useState("");
  const [toast, setToast] = useState<{
    message: string;
    state: "show" | "leave" | "hidden";
  }>({ message: "", state: "hidden" });
  const toastHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The GI specialist has replied once any GI-authored remark exists. After
  // that the PCP can't add more remarks — the thread is considered answered.
  const giHasResponded = useMemo(
    () => comments.some((c) => c.authorRole === "gi"),
    [comments]
  );

  const showToast = (message: string) => {
    if (toastHideTimer.current) clearTimeout(toastHideTimer.current);
    if (toastResetTimer.current) clearTimeout(toastResetTimer.current);
    setToast({ message, state: "show" });
    toastHideTimer.current = setTimeout(
      () => setToast((p) => ({ ...p, state: "leave" })),
      4000
    );
    toastResetTimer.current = setTimeout(
      () => setToast({ message: "", state: "hidden" }),
      4500
    );
  };

  useEffect(() => {
    return () => {
      if (toastHideTimer.current) clearTimeout(toastHideTimer.current);
      if (toastResetTimer.current) clearTimeout(toastResetTimer.current);
    };
  }, []);

  const normalizedFilter = filterText.trim().toLowerCase();
  const filteredReports = useMemo(() => {
    if (!normalizedFilter) return reports;
    return reports.filter((r) =>
      [r.reportName, r.patientName, r.caseShortCode, r.status, r.giSpecialistName].some(
        (f) => typeof f === "string" && f.toLowerCase().includes(normalizedFilter)
      )
    );
  }, [reports, normalizedFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredReports.length / ROWS_PER_PAGE));
  const visibleRows = useMemo(() => {
    const start = (page - 1) * ROWS_PER_PAGE;
    return filteredReports.slice(start, start + ROWS_PER_PAGE);
  }, [page, filteredReports]);

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

  // Deep-link from the global search: filter the table by the typed query and
  // open the focused report, then strip the query params so a refresh doesn't
  // keep forcing them.
  useEffect(() => {
    if (!focusId && initialFilter == null) return;
    if (initialFilter != null) {
      setFilterText(initialFilter.trim());
      setPage(1);
    }
    if (focusId) {
      const target = reports.find((r) => r.id === focusId);
      if (target) {
        setRemark("");
        setCommentError("");
        setActiveReport(target);
      }
    }
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/reports");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, initialFilter]);

  const handleDownload = async (row: GiSharedReport) => {
    try {
      await downloadReportPdf(row);
    } catch (err) {
      console.error("[reports] PDF generation failed:", err);
      window.alert("Could not generate the PDF. Please try again.");
    }
  };

  const submitRemark = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeReport) return;
    // Once the GI specialist has replied, the remark is closed.
    if (giHasResponded) {
      setCommentError("");
      showToast("Remark is already done by GI.");
      return;
    }
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
      showToast("Your remark has been submitted.");
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

              {normalizedFilter ? (
                <div className="reports-filter-banner" role="status">
                  <span>
                    Showing {filteredReports.length}{" "}
                    {filteredReports.length === 1 ? "report" : "reports"} matching “
                    {filterText.trim()}”
                  </span>
                  <button
                    type="button"
                    className="reports-filter-banner__clear"
                    onClick={() => {
                      setFilterText("");
                      setPage(1);
                    }}
                  >
                    Clear filter
                  </button>
                </div>
              ) : null}

              <div className="reports-table-wrap">
                {filteredReports.length === 0 ? (
                  <p
                    style={{
                      padding: "32px 12px",
                      textAlign: "center",
                      color: "#64748b",
                    }}
                  >
                    {normalizedFilter
                      ? `No reports match “${filterText.trim()}”.`
                      : "No GI reports have been shared with your cases yet."}
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
                          <th>Remarks</th>
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
                              {row.remarkCount > 0 ? (
                                <button
                                  type="button"
                                  className="reports-remark-flag reports-remark-flag--new"
                                  onClick={() => openReport(row)}
                                  title="View remarks"
                                >
                                  <span
                                    className="reports-remark-flag__dot"
                                    aria-hidden="true"
                                  />
                                  New Remark
                                </button>
                              ) : (
                                <span className="reports-remark-flag reports-remark-flag--none">
                                  None
                                </span>
                              )}
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
                                  title="Download report as PDF"
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
          giHasResponded={giHasResponded}
        />
      ) : null}

      <div
        className={[
          "reports-toast",
          toast.state === "show" || toast.state === "leave" ? "reports-toast--show" : "",
          toast.state === "leave" ? "reports-toast--leave" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-hidden={toast.state === "hidden"}
      >
        <p className="reports-toast__text">{toast.message}</p>
      </div>
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
  giHasResponded: boolean;
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
  giHasResponded,
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
                    <span className="reports-remark-item__author">
                      <strong>{c.authorName}</strong>
                      <span
                        className={`reports-remark-item__role reports-remark-item__role--${
                          c.authorRole === "gi" ? "gi" : "pcp"
                        }`}
                      >
                        {c.authorRole === "gi" ? "GI" : "PCP"}
                      </span>
                    </span>
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
            placeholder={
              giHasResponded
                ? "The GI specialist has responded — this remark is closed."
                : "Add your remark here..."
            }
            value={remark}
            onChange={(e) => onRemarkChange(e.target.value)}
            disabled={commentSubmitting || giHasResponded}
          />
          {commentError ? (
            <p className="reports-remark-error">{commentError}</p>
          ) : null}
          <div className="reports-modal__remark-actions">
            {/* When the GI has already responded the button is shown inactive
                but stays clickable so the click surfaces the "already done"
                toast (a disabled button would swallow the click). */}
            <button
              type="submit"
              className={`reports-row-share${
                giHasResponded ? " reports-row-share--inactive" : ""
              }`}
              disabled={commentSubmitting}
              aria-disabled={giHasResponded || commentSubmitting}
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
          <span>GI User</span>
          <strong>{row.giSpecialistName}</strong>
        </p>
        <p>
          <span>Status</span>
          <strong>{row.status}</strong>
        </p>
      </section>

      {row.presentingSymptoms ? (
        <section className="reports-modal-report__section">
          <h3>Presenting symptoms (AI intake)</h3>
          <p>
            <strong>From the patient:</strong> {row.presentingSymptoms}
          </p>
          {symptomChips.length > 0 ? (
            <div className="reports-symptom-chips">
              {symptomChips.map((symptom) => (
                <span key={symptom} className="reports-symptom-chip">
                  {symptom}
                </span>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="reports-modal-report__section">
        <h3>Current Medication</h3>
        <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 8px" }}>
          Medications reported by the patient during intake.
        </p>
        {row.currentMedications ? (
          <p style={{ whiteSpace: "pre-wrap" }}>{row.currentMedications}</p>
        ) : (
          <p style={{ color: "#94a3b8" }}>No current medication reported.</p>
        )}
      </section>

      <section className="reports-modal-report__section">
        <h3>Assessment</h3>
        <p>
          Current status: <strong>{row.status}</strong>.
        </p>
      </section>

      {row.clinicalDiagnosis || row.treatmentNotes ? (
        <section className="reports-modal-report__section">
          <h3>Clinical Diagnosis &amp; Plan</h3>
          {row.clinicalDiagnosis ? (
            <p style={{ whiteSpace: "pre-wrap" }}>{row.clinicalDiagnosis}</p>
          ) : null}
          {row.treatmentNotes ? (
            <p
              style={{
                whiteSpace: "pre-wrap",
                marginTop: row.clinicalDiagnosis ? 8 : 0,
              }}
            >
              <strong>Treatment notes: </strong>
              {row.treatmentNotes}
            </p>
          ) : null}
        </section>
      ) : null}

      {row.recommendedTests.length > 0 ? (
        <section className="reports-modal-report__section">
          <h3>Recommended Tests</h3>
          <ul className="reports-list--two-col">
            {row.recommendedTests.map((item, i) => (
              <li key={`test-${i}-${item}`}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {row.recommendedProcedures.length > 0 ? (
        <section className="reports-modal-report__section">
          <h3>Recommended Procedures</h3>
          <ul className="reports-list--two-col">
            {row.recommendedProcedures.map((item, i) => (
              <li key={`proc-${i}-${item}`}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="reports-modal-report__section">
        <h3>Medication</h3>
        {row.medications.length > 0 ? (
          <ul>
            {row.medications.map((item, i) => (
              <li key={`med-${i}-${item}`}>{item}</li>
            ))}
          </ul>
        ) : (
          <p style={{ color: "#94a3b8" }}>No medications reported.</p>
        )}
      </section>

      {row.assessmentPlanFiles.length > 0 ? (
        <section className="reports-modal-report__section">
          <h3>Assessment &amp; Plan Files</h3>
          {row.assessmentPlanFiles.map((group) => (
            <div key={group.category} style={{ marginBottom: 8 }}>
              <p style={{ fontWeight: 600, margin: "4px 0" }}>{group.category}</p>
              <ul className="reports-list--two-col">
                {group.files.map((label, i) => (
                  <li key={`${group.category}-${i}-${label}`}>{label}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      {row.giSpecialistPlan || row.otherRecommendations.length > 0 ? (
        <section className="reports-modal-report__section">
          <h3>Care Plan and Recommendations</h3>
          {row.giSpecialistPlan ? (
            <p
              style={{
                whiteSpace: "pre-wrap",
                marginBottom: row.otherRecommendations.length > 0 ? 8 : 0,
              }}
            >
              {row.giSpecialistPlan}
            </p>
          ) : null}
          {row.otherRecommendations.length > 0 ? (
            <ol>
              {row.otherRecommendations.map((item, i) => (
                <li key={`rec-${i}-${item}`}>{item}</li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}
    </article>
  );
}


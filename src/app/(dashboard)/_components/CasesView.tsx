"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { CaseListItem, CaseListPillVariant } from "@/lib/cases";

import { GI_USERS } from "./cases-data";

const STORAGE_KEY = "pcp-cases-saved-collapsed";

const pillClass = (variant: CaseListPillVariant) =>
  `cases-pill cases-pill--${variant}`;

type InsuranceImagePreview = {
  src: string;
  side: string;
} | null;

/** A document uploaded with a case (from GET /api/cases/{id}/documents). */
type CaseDocument = {
  fileId: string;
  fileName: string;
  contentType: string;
  kind: string;
  uploadedAt: string;
  url: string;
};

export function CasesView({ cases }: { cases: CaseListItem[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string>(cases[0]?.id ?? "");
  const [savedCollapsed, setSavedCollapsed] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareSelected, setShareSelected] = useState<string>("");
  const [shareError, setShareError] = useState(false);
  const [shareSubmitting, setShareSubmitting] = useState(false);
  const [shareErrorMessage, setShareErrorMessage] = useState<string>("");
  const [reportOpen, setReportOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [imagePreview, setImagePreview] = useState<InsuranceImagePreview>(null);
  const [reportDocs, setReportDocs] = useState<CaseDocument[]>([]);
  const [reportDocsLoading, setReportDocsLoading] = useState(false);
  // Live aiSummary state — initialized from the record on tile change,
  // refreshed when the user clicks "Regenerate".
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiSummaryGeneratedAtIso, setAiSummaryGeneratedAtIso] = useState<string | null>(
    null
  );
  const [aiSummaryGenerating, setAiSummaryGenerating] = useState(false);
  const [aiSummaryError, setAiSummaryError] = useState("");

  useEffect(() => {
    try {
      setSavedCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const anyModalOpen = shareOpen || reportOpen;
    document.body.classList.toggle("cases-share-modal-open", anyModalOpen);
    return () => {
      document.body.classList.remove("cases-share-modal-open");
    };
  }, [shareOpen, reportOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (imagePreview) {
        setImagePreview(null);
        return;
      }
      if (reportOpen) {
        setReportOpen(false);
        return;
      }
      if (shareOpen) {
        setShareOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [imagePreview, reportOpen, shareOpen]);

  const toggleSaved = () => {
    const next = !savedCollapsed;
    setSavedCollapsed(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  };

  const selectedCase = cases.find((c) => c.id === selectedId) ?? cases[0] ?? null;
  const selectedCaseId = selectedCase?.id ?? "";

  // Sync the live aiSummary fields whenever the selected case changes (e.g.
  // user clicks a different tile). New tile → start from whatever is stored.
  useEffect(() => {
    setAiSummary(selectedCase?.aiSummary ?? null);
    setAiSummaryGeneratedAtIso(selectedCase?.aiSummaryGeneratedAtIso ?? null);
    setAiSummaryError("");
  }, [selectedCase?.id, selectedCase?.aiSummary, selectedCase?.aiSummaryGeneratedAtIso]);

  const regenerateAiSummary = async () => {
    if (!selectedCase || aiSummaryGenerating) return;
    setAiSummaryGenerating(true);
    setAiSummaryError("");
    try {
      const response = await fetch(`/api/cases/${selectedCase.id}/ai-summary`, {
        method: "POST",
      });
      const data = (await response.json()) as {
        aiSummary?: string;
        aiSummaryGeneratedAt?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || `Generation failed (${response.status}).`);
      }
      setAiSummary(typeof data.aiSummary === "string" ? data.aiSummary : null);
      setAiSummaryGeneratedAtIso(
        typeof data.aiSummaryGeneratedAt === "string" ? data.aiSummaryGeneratedAt : null
      );
    } catch (err) {
      setAiSummaryError(
        err instanceof Error ? err.message : "Could not generate the AI summary."
      );
    } finally {
      setAiSummaryGenerating(false);
    }
  };

  // When the report modal is open, lazy-load the selected case's uploaded
  // documents (insurance cards + Step 3 files). Re-runs if the user switches
  // the selected case while the modal is open.
  useEffect(() => {
    if (!reportOpen || !selectedCaseId) {
      setReportDocs([]);
      return;
    }
    let cancelled = false;
    setReportDocsLoading(true);
    fetch(`/api/cases/${selectedCaseId}/documents`)
      .then((r) => r.json())
      .then((data: { documents?: CaseDocument[] }) => {
        if (cancelled) return;
        setReportDocs(Array.isArray(data.documents) ? data.documents : []);
      })
      .catch(() => {
        if (!cancelled) setReportDocs([]);
      })
      .finally(() => {
        if (!cancelled) setReportDocsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reportOpen, selectedCaseId]);

  const openShare = () => {
    setShareSelected("");
    setShareError(false);
    setShareErrorMessage("");
    setShareOpen(true);
  };

  const submitShare = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCase) return;
    if (!shareSelected) {
      setShareError(true);
      return;
    }
    if (selectedCase.rawStatus !== "submitted") {
      setShareErrorMessage(
        selectedCase.rawStatus === "draft"
          ? "Submit the case before sharing with a GI specialist."
          : "This case has already been shared."
      );
      return;
    }
    setShareSubmitting(true);
    setShareErrorMessage("");
    try {
      const response = await fetch(`/api/cases/${selectedCase.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ giUser: shareSelected }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || `Share failed (${response.status}).`);
      }
      setShareOpen(false);
      router.refresh();
    } catch (err) {
      setShareErrorMessage(
        err instanceof Error ? err.message : "Could not share the case."
      );
    } finally {
      setShareSubmitting(false);
    }
  };

  const openReport = () => {
    setIsEditing(false);
    setReportOpen(true);
  };

  return (
    <main className="dash-main cases-main" id="main">
      <div className="dash-page-head">
        <h1>Cases</h1>
        <p className="cases-page-lede">Select a case and share with GI Specialist</p>
      </div>

      <section
        className={`cases-saved${savedCollapsed ? " cases-saved--collapsed" : ""}`}
        aria-labelledby="cases-saved-heading"
      >
        <h2 className="cases-saved__heading">
          <button
            type="button"
            className="cases-saved__trigger"
            aria-expanded={!savedCollapsed}
            aria-controls="cases-saved-panel"
            onClick={toggleSaved}
          >
            <span className="cases-saved__trigger-main">
              <span className="cases-section-title" id="cases-saved-heading">
                Your saved requests
              </span>
              <span className="cases-saved__meta">{cases.length} on file</span>
            </span>
            <span className="cases-saved__chevron" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 9l6 6 6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
        </h2>

        <div
          id="cases-saved-panel"
          className="cases-saved__panel"
          role="region"
          aria-labelledby="cases-saved-heading"
          hidden={savedCollapsed}
        >
          <div className="cases-grid" role="list">
            {cases.map((c) => (
              <CaseTile
                key={c.id}
                record={c}
                isSelected={c.id === selectedId}
                onSelect={() => {
                  // Drafts open straight into the wizard for editing;
                  // submitted+ cases just become the selected detail row.
                  if (c.rawStatus === "draft") {
                    router.push(`/create-case?caseId=${encodeURIComponent(c.id)}`);
                  } else {
                    setSelectedId(c.id);
                  }
                }}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="cases-overview" aria-labelledby="cases-overview-heading">
        <h2 className="cases-section-title" id="cases-overview-heading">
          Request detail
        </h2>

        {selectedCase ? (
          <>
            <PatientHeader record={selectedCase} />

            <div className="cases-overview__body">
              <div className="cases-actions cases-actions--row">
                <button
                  type="button"
                  className="cases-btn cases-btn--report"
                  onClick={openReport}
                >
                  View Report
                </button>
                <button
                  type="button"
                  className="cases-btn cases-btn--outline"
                  onClick={openShare}
                  disabled={selectedCase.rawStatus !== "submitted"}
                  title={
                    selectedCase.rawStatus === "draft"
                      ? "Submit the case to enable sharing."
                      : selectedCase.rawStatus === "submitted"
                        ? undefined
                        : `Already shared (${selectedCase.status}).`
                  }
                >
                  {selectedCase.rawStatus === "submitted" || selectedCase.rawStatus === "draft"
                    ? "Share With GI"
                    : "Shared With GI"}
                </button>
              </div>

              <div className="cases-metrics">
                <div className="cases-card">
                  <h4 className="cases-card__head">Where things stand</h4>
                  <Timeline record={selectedCase} />
                </div>
              </div>
            </div>
          </>
        ) : (
          <div
            className="cases-card"
            style={{ padding: "24px", textAlign: "center" }}
          >
            <p style={{ margin: "0 0 12px", color: "#475569", fontWeight: 500 }}>
              You don&apos;t have any cases yet.
            </p>
            <Link href="/create-case" className="cases-btn cases-btn--outline">
              Create new case
            </Link>
          </div>
        )}
      </section>

      <ShareGiModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        onSubmit={submitShare}
        selected={shareSelected}
        onSelectedChange={(value) => {
          setShareSelected(value);
          setShareError(false);
        }}
        error={shareError}
        submitting={shareSubmitting}
        errorMessage={shareErrorMessage}
      />

      {selectedCase ? (
        <ReportModal
          open={reportOpen}
          record={selectedCase}
          documents={reportDocs}
          documentsLoading={reportDocsLoading}
          isEditing={isEditing}
          onToggleEdit={() => setIsEditing((v) => !v)}
          onClose={() => setReportOpen(false)}
          imagePreview={imagePreview}
          onShowImage={(p) => setImagePreview(p)}
          onCloseImage={() => setImagePreview(null)}
          aiSummary={aiSummary}
          aiSummaryGeneratedAtIso={aiSummaryGeneratedAtIso}
          aiSummaryGenerating={aiSummaryGenerating}
          aiSummaryError={aiSummaryError}
          onRegenerateAiSummary={regenerateAiSummary}
        />
      ) : null}
    </main>
  );
}

function CaseTile({
  record,
  isSelected,
  onSelect,
}: {
  record: CaseListItem;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`cases-tile${isSelected ? " is-selected" : ""}`}
      role="listitem"
      onClick={onSelect}
    >
      <div className="cases-tile__top">
        <span
          className="cases-tile__avatar"
          style={{ background: record.avatarBg }}
          aria-hidden="true"
        >
          {record.initials}
        </span>
        <div className="cases-tile__meta">
          <span className="cases-tile__name">{record.name}</span>
          <span className="cases-tile__mrn">{record.mrn}</span>
        </div>
      </div>
      <div className="cases-tile__badges">
        <span className={pillClass(record.statusVariant)}>{record.status}</span>
      </div>
      <div className="cases-tile__foot">
        <span className="cases-tile__updated">{record.shortUpdated}</span>
      </div>
    </button>
  );
}

function PatientHeader({ record }: { record: CaseListItem }) {
  const closed = /closed/i.test(record.condition);
  return (
    <div className="cases-patient">
      <div className="cases-patient__photo">
        <div
          className="cases-patient__avatar"
          style={{ background: record.avatarBg }}
          aria-hidden="true"
        >
          {record.initials}
        </div>
        <span
          className={`cases-patient__ribbon${
            closed ? " cases-patient__ribbon--closed" : ""
          }`}
        >
          {record.condition}
        </span>
      </div>
      <div className="cases-patient__body">
        <h3 className="cases-patient__name">{record.name}</h3>
        <dl className="cases-patient__facts">
          <div>
            <dt>Age / gender</dt>
            <dd>{record.demo}</dd>
          </div>
          <div>
            <dt>Date of birth</dt>
            <dd>{record.dob}</dd>
          </div>
          <div>
            <dt>Medical record number</dt>
            <dd>{record.mrn}</dd>
          </div>
        </dl>
      </div>
      <div className="cases-patient__status">
        <span className={pillClass(record.statusVariant)}>{record.status}</span>
      </div>
    </div>
  );
}

type TimelineStepState = "done" | "current" | "pending";

type TimelineStep = {
  title: string;
  state: TimelineStepState;
  meta?: string;
  badge?: string;
};

function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
}

function buildTimelineSteps(record: CaseListItem): TimelineStep[] {
  const status = record.rawStatus;
  const opened = formatDateTime(record.createdAtIso) ?? "—";
  const dispositionDate = formatDateTime(record.statusUpdatedAtIso);
  const hasFiles = record.documentsCount > 0;
  const fileWord =
    record.documentsCount === 1 ? "1 file uploaded" : `${record.documentsCount} files uploaded`;

  const steps: TimelineStep[] = [];

  // 1) Case opened — done as soon as the case exists.
  steps.push({ title: "Case opened", state: "done", meta: opened });

  // 2) Files uploaded — done only when files have actually been attached.
  if (hasFiles) {
    steps.push({ title: "Files uploaded", state: "done", meta: fileWord });
  } else if (status === "draft") {
    steps.push({
      title: "Files uploaded",
      state: "current",
      meta: "Awaiting file upload",
    });
  } else {
    steps.push({
      title: "Files uploaded",
      state: "pending",
      meta: "No files attached",
    });
  }

  // 3) GI Specialist Reviewing — triggered only when the case is actually
  //    shared (status moves to under_review). "submitted" alone is NOT shared.
  const sharedDate = formatDateTime(record.sharedWithGiAtIso);
  const sharedMeta = record.sharedWithGiUser
    ? sharedDate
      ? `Shared with ${record.sharedWithGiUser} · ${sharedDate}`
      : `Shared with ${record.sharedWithGiUser}`
    : sharedDate
      ? `Shared ${sharedDate}`
      : null;
  if (status === "draft") {
    steps.push({ title: "GI Specialist Reviewing", state: "pending" });
  } else if (status === "submitted") {
    steps.push({
      title: "GI Specialist Reviewing",
      state: "pending",
      meta: "Not yet shared with GI specialist",
    });
  } else if (status === "under_review") {
    steps.push({
      title: "GI Specialist Reviewing",
      state: "current",
      meta: sharedMeta ?? "GI specialist reviewing",
      badge: "In progress",
    });
  } else {
    // completed | closed
    steps.push({
      title: "GI Specialist Reviewing",
      state: "done",
      meta: sharedMeta ?? "Review complete",
    });
  }

  // 4) Final disposition — GI specialist accepted and is communicating with PCP.
  if (status === "completed") {
    steps.push({
      title: "Final disposition",
      state: "current",
      meta: dispositionDate ?? "GI specialist communicating with PCP",
      badge: "In progress",
    });
  } else if (status === "closed") {
    steps.push({
      title: "Final disposition",
      state: "done",
      meta: dispositionDate ?? "Case closed",
    });
  } else {
    steps.push({ title: "Final disposition", state: "pending" });
  }

  return steps;
}

function Timeline({ record }: { record: CaseListItem }) {
  const steps = buildTimelineSteps(record);
  return (
    <div className="cases-timeline cases-timeline--horizontal" role="list">
      {steps.map((step, i) => {
        const cls = [
          "cases-timeline__item",
          step.state === "done" ? "cases-timeline__item--done" : "",
          step.state === "current" ? "cases-timeline__item--current" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <div key={i} className={cls} role="listitem">
            <span className="cases-timeline__dot" aria-hidden="true" />
            <div className="cases-timeline__title">{step.title}</div>
            {step.meta ? (
              <div className="cases-timeline__meta">{step.meta}</div>
            ) : null}
            {step.badge ? (
              <span className="cases-timeline__badge">{step.badge}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ShareGiModal({
  open,
  onClose,
  onSubmit,
  selected,
  onSelectedChange,
  error,
  submitting,
  errorMessage,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  selected: string;
  onSelectedChange: (value: string) => void;
  error: boolean;
  submitting: boolean;
  errorMessage: string;
}) {
  return (
    <div className="cases-share-modal" hidden={!open}>
      <div className="cases-share-modal__backdrop" onClick={onClose} />
      <div
        className="cases-share-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-gi-title"
      >
        <div className="cases-share-modal__head">
          <h3 id="share-gi-title">Share case with GI users</h3>
          <button
            type="button"
            className="cases-share-modal__close"
            aria-label="Close GI share modal"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <form onSubmit={onSubmit}>
          <p className="cases-share-modal__helper">
            Select one GI user to share this case.
          </p>
          <div
            className="cases-share-modal__list"
            role="radiogroup"
            aria-label="GI users"
          >
            {GI_USERS.map((doctor) => (
              <label key={doctor} className="cases-share-modal__item">
                <input
                  type="radio"
                  name="giUser"
                  value={doctor}
                  checked={selected === doctor}
                  onChange={() => onSelectedChange(doctor)}
                />
                <span>{doctor}</span>
              </label>
            ))}
          </div>
          {error ? (
            <p className="cases-share-modal__error">
              Please select at least one GI user.
            </p>
          ) : null}
          {errorMessage ? (
            <p className="cases-share-modal__error">{errorMessage}</p>
          ) : null}
          <div className="cases-share-modal__actions">
            <button
              type="button"
              className="cases-btn cases-btn--muted"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="cases-btn cases-btn--outline"
              disabled={submitting}
            >
              {submitting ? "Sharing…" : "Submit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

type ReportModalProps = {
  open: boolean;
  record: CaseListItem;
  documents: CaseDocument[];
  documentsLoading: boolean;
  isEditing: boolean;
  onToggleEdit: () => void;
  onClose: () => void;
  imagePreview: InsuranceImagePreview;
  onShowImage: (preview: InsuranceImagePreview) => void;
  onCloseImage: () => void;
  aiSummary: string | null;
  aiSummaryGeneratedAtIso: string | null;
  aiSummaryGenerating: boolean;
  aiSummaryError: string;
  onRegenerateAiSummary: () => void;
};

const DOC_KIND_LABEL: Record<string, string> = {
  lab: "Lab report",
  imaging: "Imaging",
  note: "Note",
  insurance_card_front: "Insurance card (front)",
  insurance_card_back: "Insurance card (back)",
  other: "Document",
};

function formatDocDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ReportModal({
  open,
  record,
  documents,
  documentsLoading,
  isEditing,
  onToggleEdit,
  onClose,
  imagePreview,
  onShowImage,
  onCloseImage,
  aiSummary,
  aiSummaryGeneratedAtIso,
  aiSummaryGenerating,
  aiSummaryError,
  onRegenerateAiSummary,
}: ReportModalProps) {
  const insuranceFront = documents.find((d) => d.kind === "insurance_card_front");
  const insuranceBack = documents.find((d) => d.kind === "insurance_card_back");
  const otherDocs = documents.filter(
    (d) => d.kind !== "insurance_card_front" && d.kind !== "insurance_card_back"
  );

  return (
    <div className="cases-share-modal" hidden={!open}>
      <div className="cases-share-modal__backdrop" onClick={onClose} />
      <div
        className="cases-share-modal__dialog cases-report-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="case-report-title"
      >
        <div className="cases-share-modal__head">
          <h3 id="case-report-title">Patient report</h3>
        </div>

        <div className={`cases-report-modal__content${isEditing ? " is-editing" : ""}`}>
          <article
            className="cases-report-sheet"
            contentEditable={isEditing}
            spellCheck={isEditing}
            suppressContentEditableWarning
          >
            <header className="cases-report-sheet__hero">
              <div className="cases-report-sheet__patient">
                <div className="cases-report-sheet__avatar">{record.initials}</div>
                <div>
                  <h4>{record.name} - Patient Report</h4>
                  <p>
                    {record.mrn} | {record.status} | {record.updated}
                  </p>
                </div>
              </div>
              <div className="cases-report-sheet__chips">
                <span className="cases-report-pill">DOB: {record.dob}</span>
                <span className="cases-report-pill">Profile: {record.demo}</span>
                <span className="cases-report-pill">
                  Insurance: {record.insuranceCarrier}
                </span>
              </div>
            </header>

            <div className="cases-report-ai">
              <div className="cases-report-ai__head">
                <h5>AI-Generated Summary</h5>
                <button
                  type="button"
                  className="cases-report-ai__regen"
                  onClick={onRegenerateAiSummary}
                  disabled={aiSummaryGenerating}
                >
                  {aiSummaryGenerating
                    ? "Generating…"
                    : aiSummary
                      ? "Regenerate"
                      : "Generate AI summary"}
                </button>
              </div>
              {aiSummaryError ? (
                <p className="cases-report-ai__error">{aiSummaryError}</p>
              ) : null}
              <p className="cases-report-ai__body">
                {aiSummary ?? record.aiFirstSummary}
              </p>
              {aiSummaryGeneratedAtIso ? (
                <p className="cases-report-ai__footnote">
                  AI-assisted preliminary summary · generated{" "}
                  {formatDocDate(aiSummaryGeneratedAtIso)}
                </p>
              ) : null}
            </div>

            <div>
              <h5>Demographic details</h5>
              <div className="cases-report-grid">
                <p>
                  <span>Full legal name</span>
                  <strong>{record.name}</strong>
                </p>
                <p>
                  <span>Age / gender</span>
                  <strong>{record.demo}</strong>
                </p>
                <p>
                  <span>Date of birth</span>
                  <strong>{record.dob}</strong>
                </p>
                <p>
                  <span>Phone</span>
                  <strong>{record.phone}</strong>
                </p>
                <p>
                  <span>Email</span>
                  <strong>{record.email}</strong>
                </p>
                <p>
                  <span>Address</span>
                  <strong>{record.address}</strong>
                </p>
              </div>
            </div>

            <div>
              <h5>Insurance information</h5>
              <div className="cases-report-grid">
                <p>
                  <span>Insurance carrier</span>
                  <strong>{record.insuranceCarrier}</strong>
                </p>
                <p>
                  <span>Policy ID</span>
                  <strong>{record.policyId}</strong>
                </p>
                <p>
                  <span>Group name</span>
                  <strong>{record.groupName}</strong>
                </p>
                <p>
                  <span>Effective date</span>
                  <strong>{record.effectiveDate}</strong>
                </p>
              </div>
              <div className="cases-report-doc-gallery cases-report-doc-gallery--insurance">
                <InsuranceCard
                  side="FRONT SIDE"
                  doc={insuranceFront}
                  onShowImage={onShowImage}
                />
                <InsuranceCard
                  side="BACK SIDE"
                  doc={insuranceBack}
                  onShowImage={onShowImage}
                />
              </div>
            </div>

            <div>
              <h5>Uploaded documents and key findings</h5>
              {documentsLoading ? (
                <p style={{ color: "#64748b", margin: "8px 0 0", fontSize: 14 }}>
                  Loading documents…
                </p>
              ) : otherDocs.length === 0 ? (
                <p style={{ color: "#64748b", margin: "8px 0 0", fontSize: 14 }}>
                  No documents were uploaded with this case.
                </p>
              ) : (
                <div className="cases-report-doc-gallery">
                  {otherDocs.map((doc) => (
                    <DocCard key={doc.fileId} doc={doc} />
                  ))}
                </div>
              )}
            </div>
          </article>
        </div>

        {imagePreview ? (
          <div
            className="cases-report-image-viewer"
            onClick={(e) => {
              if (e.target === e.currentTarget) onCloseImage();
            }}
          >
            <button
              type="button"
              className="cases-report-image-viewer__backdrop"
              aria-label="Close image preview"
              onClick={onCloseImage}
            />
            <div
              className="cases-report-image-viewer__dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="case-report-image-title"
            >
              <div className="cases-report-image-viewer__head">
                <strong id="case-report-image-title">
                  Insurance card - {imagePreview.side}
                </strong>
                <button
                  type="button"
                  className="cases-report-image-viewer__close"
                  aria-label="Close image preview"
                  onClick={onCloseImage}
                >
                  ×
                </button>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagePreview.src} alt="Insurance card preview" />
            </div>
          </div>
        ) : null}

        <div className="cases-share-modal__actions">
          <button
            type="button"
            className="cases-btn cases-btn--muted"
            onClick={onToggleEdit}
          >
            {isEditing ? "Done" : "Edit"}
          </button>
          <button
            type="button"
            className="cases-btn cases-btn--outline"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function InsuranceCard({
  side,
  doc,
  onShowImage,
}: {
  side: string;
  doc: CaseDocument | undefined;
  onShowImage: (preview: InsuranceImagePreview) => void;
}) {
  const isImage = !!doc && doc.contentType.startsWith("image/");
  const clickable = !!doc;

  const open = () => {
    if (doc) onShowImage({ src: doc.url, side });
  };

  return (
    <article
      className="cases-report-doc-card cases-report-doc-card--insurance"
      tabIndex={clickable ? 0 : -1}
      role={clickable ? "button" : undefined}
      onClick={clickable ? open : undefined}
      onKeyDown={(event) => {
        if (clickable && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          open();
        }
      }}
      style={clickable ? { cursor: "pointer" } : undefined}
    >
      <span className="cases-report-doc-card__side-label">{side}</span>
      {doc && isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={doc.url} alt={`Insurance card ${side.toLowerCase()}`} loading="lazy" />
      ) : doc ? (
        <div className="cases-report-doc-card__meta">
          <strong>{doc.fileName}</strong>
          <span>Click to open</span>
        </div>
      ) : (
        <div className="cases-report-doc-card__blank" aria-hidden="true" />
      )}
    </article>
  );
}

function DocCard({ doc }: { doc: CaseDocument }) {
  const isImage = doc.contentType.startsWith("image/");
  const kindLabel = DOC_KIND_LABEL[doc.kind] ?? "Document";
  const date = formatDocDate(doc.uploadedAt);
  const meta = date ? `${kindLabel} • ${date}` : kindLabel;

  return (
    <a
      className="cases-report-doc-card"
      href={doc.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${doc.fileName}`}
    >
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={doc.url} alt={doc.fileName} loading="lazy" />
      ) : (
        <div className="cases-report-doc-card__filetype" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
            <path
              d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9l-6-6z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path d="M14 3v6h6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          <span>{(doc.fileName.split(".").pop() || "file").toUpperCase()}</span>
        </div>
      )}
      <div className="cases-report-doc-card__meta">
        <strong>{doc.fileName}</strong>
        <span>{meta}</span>
      </div>
    </a>
  );
}

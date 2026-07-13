"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ageFromDob } from "@/lib/age";
import type { CaseListItem, CaseListPillVariant } from "@/lib/cases";

import { HPI_FIELDS, HpiExtractPanel, type HpiField } from "./HpiExtractPanel";
import { LocalTime } from "./LocalTime";
import { MedicationPicker } from "./MedicationPicker";
import { useSpeechToText } from "./useSpeechToText";
import type { GiUser } from "@/lib/gi-users";
import { formatUsPhone, isValidUsPhone } from "@/lib/phone";

const STORAGE_KEY = "pcp-cases-saved-collapsed";

const pillClass = (variant: CaseListPillVariant) =>
  `cases-pill cases-pill--${variant}`;

// Free-text Health fields that support Speak-to-Text in the report edit modal.
// Numeric/phone fields are excluded — dictation garbles digit strings.
type ModalDictationField =
  | "inboxMessage"
  | "allergies"
  | "pastSurgicalHistory"
  | "socialHistory"
  | "pharmacyInformation";

function MicIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="4" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.9" />
      <path
        d="M6.5 11.5V12a5.5 5.5 0 0011 0v-.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path d="M12 17.5V21" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M9 21h6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

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

export function CasesView({
  cases,
  notice = null,
  focusId = null,
  initialFilter = null,
}: {
  cases: CaseListItem[];
  notice?: string | null;
  focusId?: string | null;
  initialFilter?: string | null;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string>(cases[0]?.id ?? "");
  const [filterText, setFilterText] = useState<string>(initialFilter?.trim() ?? "");
  const [savedCollapsed, setSavedCollapsed] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareSelected, setShareSelected] = useState<string>("");
  const [shareError, setShareError] = useState(false);
  const [shareSubmitting, setShareSubmitting] = useState(false);
  const [shareErrorMessage, setShareErrorMessage] = useState<string>("");
  // Transient toast (e.g. "already shared with GI").
  const [toast, setToast] = useState<{
    message: string;
    state: "show" | "leave" | "hidden";
  }>({ message: "", state: "hidden" });
  const toastHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [giUsers, setGiUsers] = useState<GiUser[]>([]);
  const [giUsersLoading, setGiUsersLoading] = useState(false);
  const [giUsersError, setGiUsersError] = useState<string>("");
  const [reportOpen, setReportOpen] = useState(false);
  const [imagePreview, setImagePreview] = useState<InsuranceImagePreview>(null);
  const [reportDocs, setReportDocs] = useState<CaseDocument[]>([]);
  const [reportDocsLoading, setReportDocsLoading] = useState(false);
  // Bumped after an in-modal save so the report documents (incl. insurance
  // cards) re-fetch and show the latest images.
  const [reportDocsRefreshKey, setReportDocsRefreshKey] = useState(0);

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

  const normalizedFilter = filterText.trim().toLowerCase();
  const visibleCases = normalizedFilter
    ? cases.filter((c) =>
        [c.name, c.mrn, c.status, c.email, c.phone, c.insuranceCarrier].some(
          (f) => typeof f === "string" && f.toLowerCase().includes(normalizedFilter)
        )
      )
    : cases;

  const selectedCase =
    cases.find((c) => c.id === selectedId) ?? visibleCases[0] ?? cases[0] ?? null;
  const selectedCaseId = selectedCase?.id ?? "";

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
  }, [reportOpen, selectedCaseId, reportDocsRefreshKey]);

  // Tear down toast timers on unmount.
  useEffect(() => {
    return () => {
      if (toastHideTimer.current) clearTimeout(toastHideTimer.current);
      if (toastResetTimer.current) clearTimeout(toastResetTimer.current);
    };
  }, []);

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

  // Show a toast when arriving from the Create Case wizard, then strip the
  // query param (without remounting) so it doesn't re-fire on refresh.
  useEffect(() => {
    if (!notice) return;
    if (notice === "created") {
      showToast("Case created and submitted for review.");
    } else if (notice === "updated") {
      showToast("Case updated.");
    }
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/cases");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice]);

  // Deep-link from the global search: filter the saved-requests list by the
  // typed query and select the focused case, then strip the query params so a
  // refresh doesn't keep forcing them.
  useEffect(() => {
    if (!focusId && initialFilter == null) return;
    if (initialFilter != null) setFilterText(initialFilter.trim());
    if (focusId && cases.some((c) => c.id === focusId)) {
      setSelectedId(focusId);
    }
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/cases");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, initialFilter]);

  const openShare = () => {
    setShareSelected("");
    setShareError(false);
    setShareErrorMessage("");
    setShareOpen(true);
  };

  // The share button stays clickable so we can explain why sharing is/ isn't
  // available instead of silently doing nothing on a disabled button.
  const handleShareClick = () => {
    if (!selectedCase) return;
    if (selectedCase.rawStatus === "draft") {
      showToast("Submit this case first — drafts can't be shared with a GI specialist.");
      return;
    }
    if (selectedCase.rawStatus !== "submitted") {
      const who = selectedCase.sharedWithGiUser;
      const when = formatDateTime(selectedCase.sharedWithGiAtIso);
      showToast(
        who
          ? `This case has already been shared with ${who}${when ? ` on ${when}` : ""}.`
          : "This case has already been shared with a GI specialist."
      );
      return;
    }
    openShare();
  };

  // Lazy-load GI users the first time the share modal is opened. Refetches
  // on each open so freshly-seeded users show up without a page reload.
  useEffect(() => {
    if (!shareOpen) return;
    let cancelled = false;
    setGiUsersLoading(true);
    setGiUsersError("");
    fetch("/api/gi-users")
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as {
          giUsers?: GiUser[];
          error?: string;
        };
        if (!r.ok) throw new Error(data.error || `Failed (${r.status})`);
        return Array.isArray(data.giUsers) ? data.giUsers : [];
      })
      .then((list) => {
        if (cancelled) return;
        setGiUsers(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setGiUsersError(
          err instanceof Error ? err.message : "Could not load GI specialists."
        );
        setGiUsers([]);
      })
      .finally(() => {
        if (!cancelled) setGiUsersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shareOpen]);

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
        body: JSON.stringify({ giUserId: shareSelected }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || `Share failed (${response.status}).`);
      }
      const giName =
        giUsers.find((g) => g.id === shareSelected)?.displayName ?? "the GI specialist";
      setShareOpen(false);
      router.refresh();
      showToast(`Case shared with ${giName}.`);
    } catch (err) {
      setShareErrorMessage(
        err instanceof Error ? err.message : "Could not share the case."
      );
    } finally {
      setShareSubmitting(false);
    }
  };

  const openReport = () => {
    setReportOpen(true);
  };

  return (
    <main className="dash-main cases-main" id="main">
      <div className="dash-page-head">
        <h1>Cases</h1>
        <p className="cases-page-lede">Select a case and share with GI Specialist</p>
      </div>

      {normalizedFilter ? (
        <div className="cases-filter-banner" role="status">
          <span>
            Showing {visibleCases.length}{" "}
            {visibleCases.length === 1 ? "case" : "cases"} matching “
            {filterText.trim()}”
          </span>
          <button
            type="button"
            className="cases-filter-banner__clear"
            onClick={() => setFilterText("")}
          >
            Clear filter
          </button>
        </div>
      ) : null}

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
              <span className="cases-saved__meta">
                {normalizedFilter
                  ? `${visibleCases.length} of ${cases.length}`
                  : `${cases.length} on file`}
              </span>
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
            {visibleCases.length === 0 ? (
              <p className="cases-grid__empty">
                {cases.length === 0
                  ? "No cases are found."
                  : `No cases match “${filterText.trim()}”.`}
              </p>
            ) : null}
            {visibleCases.map((c) => (
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
                  onClick={handleShareClick}
                  disabled={selectedCase.rawStatus === "draft"}
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
        giUsers={giUsers}
        loading={giUsersLoading}
        loadError={giUsersError}
      />

      {selectedCase ? (
        <ReportModal
          open={reportOpen}
          record={selectedCase}
          documents={reportDocs}
          documentsLoading={reportDocsLoading}
          onSaved={() => {
            router.refresh();
            setReportDocsRefreshKey((k) => k + 1);
            showToast("Case updated.");
          }}
          onClose={() => setReportOpen(false)}
          imagePreview={imagePreview}
          onShowImage={(p) => setImagePreview(p)}
          onCloseImage={() => setImagePreview(null)}
        />
      ) : null}

      <div
        className={`cases-toast${
          toast.state === "show" || toast.state === "leave" ? " cases-toast--show" : ""
        }${toast.state === "leave" ? " cases-toast--leave" : ""}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-hidden={toast.state === "hidden"}
      >
        <p className="cases-toast__text">{toast.message}</p>
      </div>
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
      className={`cases-tile${isSelected ? " is-selected" : ""}${
        record.hasFinalReport ? " cases-tile--final" : ""
      }`}
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
        {record.hasFinalReport ? (
          <span className="cases-tile__report-flag">Report ready</span>
        ) : null}
      </div>
      <div className="cases-tile__foot">
        <span className="cases-tile__updated">
          <LocalTime iso={record.updatedAtIso} mode="short" fallback={record.shortUpdated} />
        </span>
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
    // An open case with a published report has finished the review even though
    // it stays open ("Finalized") — show the review step as done, not current.
    steps.push(
      record.hasFinalReport
        ? {
            title: "GI Specialist Reviewing",
            state: "done",
            meta: sharedMeta ?? "Review complete",
          }
        : {
            title: "GI Specialist Reviewing",
            state: "current",
            meta: sharedMeta ?? "GI specialist reviewing",
            badge: "In progress",
          }
    );
  } else {
    // completed | closed
    steps.push({
      title: "GI Specialist Reviewing",
      state: "done",
      meta: sharedMeta ?? "Review complete",
    });
  }

  // 4) Completed — the GI specialist shared a report back to the PCP, which
  //    marks the case completed.
  if (record.hasFinalReport) {
    steps.push({
      title: "Completed",
      state: "done",
      meta: dispositionDate
        ? `GI report ready · ${dispositionDate}`
        : "GI report ready — see Reports",
      badge: "Report ready",
    });
  } else if (status === "completed") {
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
  giUsers,
  loading,
  loadError,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  selected: string;
  onSelectedChange: (value: string) => void;
  error: boolean;
  submitting: boolean;
  errorMessage: string;
  giUsers: GiUser[];
  loading: boolean;
  loadError: string;
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
            {loading ? (
              <p className="cases-share-modal__helper">Loading GI specialists…</p>
            ) : giUsers.length === 0 ? (
              <p className="cases-share-modal__helper">
                No GI specialists are configured yet.
              </p>
            ) : (
              giUsers.map((doctor) => (
                <label key={doctor.id} className="cases-share-modal__item">
                  <input
                    type="radio"
                    name="giUser"
                    value={doctor.id}
                    checked={selected === doctor.id}
                    onChange={() => onSelectedChange(doctor.id)}
                  />
                  <span>{doctor.displayName}</span>
                </label>
              ))
            )}
          </div>
          {error ? (
            <p className="cases-share-modal__error">
              Please select at least one GI user.
            </p>
          ) : null}
          {loadError ? (
            <p className="cases-share-modal__error">{loadError}</p>
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
  onSaved: () => void;
  onClose: () => void;
  imagePreview: InsuranceImagePreview;
  onShowImage: (preview: InsuranceImagePreview) => void;
  onCloseImage: () => void;
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

const GENDER_OPTIONS: { value: string; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
  { value: "other", label: "Other" },
];

const editInputStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 4,
  padding: "6px 9px",
  border: "1px solid #cbd5e1",
  borderRadius: 7,
  font: "inherit",
  fontSize: 14,
  color: "#0f172a",
  background: "#fff",
};

function ReportModal({
  open,
  record,
  documents,
  documentsLoading,
  onSaved,
  onClose,
  imagePreview,
  onShowImage,
  onCloseImage,
}: ReportModalProps) {
  const insuranceFront = documents.find((d) => d.kind === "insurance_card_front");
  const insuranceBack = documents.find((d) => d.kind === "insurance_card_back");
  const otherDocs = documents.filter(
    (d) => d.kind !== "insurance_card_front" && d.kind !== "insurance_card_back"
  );

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CaseListItem["editable"]>(record.editable);
  const [healthForm, setHealthForm] = useState<CaseListItem["health"]>(record.health);
  const [insuranceFiles, setInsuranceFiles] = useState<{
    front: File | null;
    back: File | null;
  }>({ front: null, back: null });
  // HPI History document staged by HpiExtractPanel — extracted values are already
  // in healthForm; the file itself is uploaded to the case on Save.
  const [stagedHpiFile, setStagedHpiFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [busyDoc, setBusyDoc] = useState(false);
  const addDocsRef = useRef<HTMLInputElement | null>(null);

  // Editing stays available until the GI specialist shares a report back (their
  // sign-off); after that the case is locked.
  const canEdit = !record.hasFinalReport;

  // Leave edit mode when the modal closes or a different case is opened.
  // (form/healthForm are (re)seeded from the record in startEdit, like `form`.)
  useEffect(() => {
    setEditing(false);
    setError("");
    setInsuranceFiles({ front: null, back: null });
    setStagedHpiFile(null);
    setDictationField(null);
  }, [open, record.id]);

  const setField = (key: keyof CaseListItem["editable"], value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setHealthField = (key: keyof CaseListItem["health"], value: string) =>
    setHealthForm((h) => ({ ...h, [key]: value }));

  // Renders one Health field: an editable input/textarea in edit mode, or the
  // saved value (with a friendly fallback) in view mode. Keeps the Health
  // section in sync with the create-case form's fields.
  const renderHealthField = (
    label: string,
    key: keyof CaseListItem["health"],
    opts: {
      multiline?: boolean;
      fallback: string;
      placeholder?: string;
      /** When set, shows a Speak-to-Text mic that dictates into this field. */
      dictate?: ModalDictationField;
    }
  ) => {
    const display = String(record.health[key] ?? "").trim();
    return (
      <div>
        <h5>{label}</h5>
        {editing ? (
          opts.multiline ? (
            <>
              <textarea
                style={{ ...editInputStyle, minHeight: 64, resize: "vertical" }}
                value={String(healthForm[key] ?? "")}
                placeholder={opts.placeholder}
                onChange={(e) => setHealthField(key, e.target.value)}
              />
              {opts.dictate ? renderMic(opts.dictate) : null}
            </>
          ) : (
            <input
              style={editInputStyle}
              value={String(healthForm[key] ?? "")}
              placeholder={opts.placeholder}
              onChange={(e) => setHealthField(key, e.target.value)}
            />
          )
        ) : (
          <p style={{ whiteSpace: "pre-wrap" }}>{display || opts.fallback}</p>
        )}
      </div>
    );
  };

  // Speak-to-Text across every free-text Health field. One recognizer, routed to
  // whichever field's mic is active (dictationFieldRef), matching create-case.
  // Digit/number fields (BMI, phone/fax) are excluded — dictation garbles them.
  const [dictationField, setDictationField] = useState<ModalDictationField | null>(null);
  const dictationFieldRef = useRef<ModalDictationField | null>(null);
  const speech = useSpeechToText((finalized) => {
    const target = dictationFieldRef.current;
    if (!target) return;
    setHealthForm((h) => {
      const prev = String(h[target] ?? "");
      return {
        ...h,
        [target]: prev ? `${prev.replace(/\s+$/, "")} ${finalized}` : finalized,
      };
    });
  });

  const toggleDictation = (field: ModalDictationField) => {
    // Mics on other fields are disabled while one is live, so a toggle can only
    // be the active field's own mic — stop it. Otherwise bind and start.
    if (speech.listening) {
      void speech.toggle();
      return;
    }
    dictationFieldRef.current = field;
    setDictationField(field);
    void speech.toggle();
  };

  const stopDictation = () => {
    if (speech.listening) void speech.toggle();
    setDictationField(null);
  };

  // Mic button + its status line, bound to one field.
  const renderMic = (field: ModalDictationField) => {
    const active = speech.listening && dictationField === field;
    return (
      <>
        <div className="cc-speech-action-row" style={{ marginTop: 8 }}>
          <button
            type="button"
            className={`cc-speech-btn${active ? " cc-speech-btn--listening" : ""}`}
            aria-label={active ? "Stop speech to text" : "Start speech to text"}
            aria-pressed={active}
            title={active ? "Stop recording" : "Speak-to-Text"}
            onClick={() => toggleDictation(field)}
            disabled={!speech.supported || (speech.listening && !active)}
          >
            <MicIcon />
          </button>
        </div>
        {dictationField === field ? (
          <p className="cc-field-hint" aria-live="polite" style={{ marginTop: 4 }}>
            {speech.status}
          </p>
        ) : null}
      </>
    );
  };

  const startEdit = () => {
    if (!canEdit) return;
    setForm(record.editable);
    setHealthForm(record.health);
    setInsuranceFiles({ front: null, back: null });
    setStagedHpiFile(null);
    setError("");
    setEditing(true);
  };

  const cancelEdit = () => {
    setError("");
    setInsuranceFiles({ front: null, back: null });
    setStagedHpiFile(null);
    stopDictation();
    setEditing(false);
  };

  // HpiExtractPanel integration: the current Health value for each extractable
  // field (for conflict detection), and applying the chosen extracted values
  // into healthForm.
  const hpiCurrentValues = HPI_FIELDS.reduce(
    (acc, key) => {
      acc[key] = String(healthForm[key] ?? "");
      return acc;
    },
    {} as Record<HpiField, string>
  );

  const applyHpi = (values: Partial<Record<HpiField, string>>) => {
    setHealthForm((h) => {
      const next = { ...h };
      for (const key of HPI_FIELDS) {
        const v = values[key];
        if (v !== undefined) next[key] = v;
      }
      return next;
    });
  };

  const validate = (): string => {
    if (!form.fullLegalName.trim()) return "Full legal name is required.";
    if (!form.dateOfBirth || ageFromDob(form.dateOfBirth) == null) {
      return "Enter a valid date of birth.";
    }
    if (!form.gender) return "Gender is required.";
    if (!form.address.trim()) return "Patient address is required.";
    if (!isValidUsPhone(form.mobile)) return "Enter a valid US phone number.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      return "Enter a valid email address.";
    }
    const MAX = 5 * 1024 * 1024;
    if (insuranceFiles.front && insuranceFiles.front.size > MAX) {
      return "Insurance front image exceeds the 5 MB limit.";
    }
    if (insuranceFiles.back && insuranceFiles.back.size > MAX) {
      return "Insurance back image exceeds the 5 MB limit.";
    }
    return "";
  };

  // Replaces one insurance card: deletes the existing card doc (if any) so the
  // report doesn't keep showing the old image, then uploads the new file.
  const uploadCard = async (
    side: "front" | "back",
    file: File,
    existing: CaseDocument | undefined
  ) => {
    if (existing) {
      await fetch(`/api/cases/${record.id}/documents/${existing.fileId}`, {
        method: "DELETE",
      });
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", side === "front" ? "insurance_card_front" : "insurance_card_back");
    const res = await fetch(`/api/cases/${record.id}/documents`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || `Could not upload the ${side} insurance card.`);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    const message = validate();
    if (message) {
      setError(message);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/cases/${record.id}/about`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullLegalName: form.fullLegalName,
          gender: form.gender,
          dateOfBirth: form.dateOfBirth,
          address: form.address,
          state: form.state,
          mobile: form.mobile,
          email: form.email,
          insuranceCarrier: form.insuranceCarrier,
          policyId: form.policyId,
          groupName: form.groupName,
          effectiveDate: form.effectiveDate,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not save the changes.");

      // Save the Health (Step 2) fields.
      const hres = await fetch(`/api/cases/${record.id}/health`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inboxMessage: healthForm.inboxMessage,
          bmi: healthForm.bmi,
          allergies: healthForm.allergies,
          currentMedications: healthForm.currentMedications,
          existingConditions: healthForm.existingConditions,
          pastSurgicalHistory: healthForm.pastSurgicalHistory,
          socialHistory: healthForm.socialHistory,
          recentTestsOrProcedures: healthForm.recentTestsOrProcedures,
          familyHistory: healthForm.familyHistory,
          lifestyleNotes: healthForm.lifestyleNotes,
          primaryCarePhysician: healthForm.primaryCarePhysician,
          pcpPhoneFax: healthForm.pcpPhoneFax,
          pharmacyInformation: healthForm.pharmacyInformation,
          pharmacyPhoneFax: healthForm.pharmacyPhoneFax,
          urgencyLevel: healthForm.urgencyLevel || undefined,
        }),
      });
      const hdata = (await hres.json().catch(() => ({}))) as { error?: string };
      if (!hres.ok) throw new Error(hdata.error || "Could not save the health details.");

      // Upload any replaced insurance cards.
      if (insuranceFiles.front) await uploadCard("front", insuranceFiles.front, insuranceFront);
      if (insuranceFiles.back) await uploadCard("back", insuranceFiles.back, insuranceBack);

      // Attach the HPI History document, if one was staged. Its extracted values
      // were already applied into healthForm and saved by the PATCH above.
      if (stagedHpiFile) {
        const fd = new FormData();
        fd.append("file", stagedHpiFile);
        fd.append("kind", "hpi_history");
        const dres = await fetch(`/api/cases/${record.id}/documents`, {
          method: "POST",
          body: fd,
        });
        if (!dres.ok) {
          const ddata = (await dres.json().catch(() => ({}))) as { error?: string };
          throw new Error(ddata.error || "Could not attach the HPI history document.");
        }
      }

      // The edits change the intake the AI summary + suggestions are derived
      // from, so regenerate both. Runs after the About/Health/document writes
      // above so it reads the updated case. Best-effort and awaited: a failure
      // must not undo the saved edits, but on success the refresh below shows
      // the new summary/suggestions immediately.
      try {
        await fetch(`/api/cases/${record.id}/ai-summary`, { method: "POST" });
      } catch {
        // ignore — the report's Regenerate action can retry later
      }

      setInsuranceFiles({ front: null, back: null });
      setStagedHpiFile(null);
      stopDictation();
      setEditing(false);
      onSaved(); // re-fetch server data + report docs so the edits show
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the changes.");
    } finally {
      setSaving(false);
    }
  };

  // Delete any uploaded file (document or insurance card), then refresh.
  const removeDoc = async (fileId: string) => {
    if (busyDoc) return;
    setBusyDoc(true);
    setError("");
    try {
      const res = await fetch(`/api/cases/${record.id}/documents/${fileId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Could not delete the file.");
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the file.");
    } finally {
      setBusyDoc(false);
    }
  };

  // Add (or replace) uploaded documents — validates type + size, then uploads.
  const addDocs = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || busyDoc) return;
    const MAX = 5 * 1024 * 1024;
    const okExt = /\.(png|jpe?g|pdf)$/i;
    const picked = Array.from(fileList);
    const invalid = picked.find((f) => !okExt.test(f.name) || f.size > MAX);
    if (invalid) {
      setError(
        !okExt.test(invalid.name)
          ? `Unsupported file type: ${invalid.name}. Use PNG, JPG, or PDF.`
          : `File too large (max 5 MB): ${invalid.name}.`
      );
      return;
    }
    setBusyDoc(true);
    setError("");
    try {
      for (const file of picked) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("kind", "other");
        const res = await fetch(`/api/cases/${record.id}/documents`, {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || `Could not upload ${file.name}.`);
        }
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload the file.");
    } finally {
      setBusyDoc(false);
    }
  };

  const editAge = ageFromDob(form.dateOfBirth);

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

        <div className="cases-report-modal__content">
          <article className="cases-report-sheet">
            <header className="cases-report-sheet__hero">
              <div className="cases-report-sheet__patient">
                <div className="cases-report-sheet__avatar">{record.initials}</div>
                <div>
                  <h4>{record.name} - Patient Report</h4>
                  <p>
                    {record.mrn} | {record.status} |{" "}
                    <LocalTime
                      iso={record.updatedAtIso}
                      mode="date"
                      prefix="Updated "
                      fallback={record.updated}
                    />
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

            <div>
              <h5>Demographic details</h5>
              <div className="cases-report-grid">
                <p>
                  <span>Full legal name</span>
                  {editing ? (
                    <input
                      style={editInputStyle}
                      type="text"
                      value={form.fullLegalName}
                      onChange={(e) => setField("fullLegalName", e.target.value)}
                    />
                  ) : (
                    <strong>{record.name}</strong>
                  )}
                </p>
                <p>
                  <span>{editing ? "Gender" : "Age / gender"}</span>
                  {editing ? (
                    <select
                      style={editInputStyle}
                      value={form.gender}
                      onChange={(e) => setField("gender", e.target.value)}
                    >
                      <option value="">Select…</option>
                      {GENDER_OPTIONS.map((g) => (
                        <option key={g.value} value={g.value}>
                          {g.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <strong>{record.demo}</strong>
                  )}
                </p>
                <p>
                  <span>Date of birth</span>
                  {editing ? (
                    <>
                      <input
                        style={editInputStyle}
                        type="date"
                        max={new Date().toISOString().slice(0, 10)}
                        value={form.dateOfBirth}
                        onChange={(e) => setField("dateOfBirth", e.target.value)}
                      />
                      <small style={{ color: "#64748b", fontSize: 12 }}>
                        {editAge != null
                          ? `Age: ${editAge} ${editAge === 1 ? "year" : "years"}`
                          : "Age is calculated from the date of birth."}
                      </small>
                    </>
                  ) : (
                    <strong>{record.dob}</strong>
                  )}
                </p>
                <p>
                  <span>Phone</span>
                  {editing ? (
                    <input
                      style={editInputStyle}
                      type="tel"
                      inputMode="tel"
                      value={form.mobile}
                      onChange={(e) => setField("mobile", formatUsPhone(e.target.value))}
                    />
                  ) : (
                    <strong>{record.phone}</strong>
                  )}
                </p>
                <p>
                  <span>Email</span>
                  {editing ? (
                    <input
                      style={editInputStyle}
                      type="email"
                      value={form.email}
                      onChange={(e) => setField("email", e.target.value)}
                    />
                  ) : (
                    <strong>{record.email}</strong>
                  )}
                </p>
                <p>
                  <span>Address</span>
                  {editing ? (
                    <input
                      style={editInputStyle}
                      type="text"
                      value={form.address}
                      onChange={(e) => setField("address", e.target.value)}
                    />
                  ) : (
                    <strong>{record.address}</strong>
                  )}
                </p>
              </div>
            </div>

            <div>
              <h5>Insurance information</h5>
              <div className="cases-report-grid">
                <p>
                  <span>Insurance carrier</span>
                  {editing ? (
                    <input
                      style={editInputStyle}
                      type="text"
                      value={form.insuranceCarrier}
                      onChange={(e) => setField("insuranceCarrier", e.target.value)}
                    />
                  ) : (
                    <strong>{record.insuranceCarrier}</strong>
                  )}
                </p>
                <p>
                  <span>Policy ID</span>
                  {editing ? (
                    <input
                      style={editInputStyle}
                      type="text"
                      value={form.policyId}
                      onChange={(e) => setField("policyId", e.target.value)}
                    />
                  ) : (
                    <strong>{record.policyId}</strong>
                  )}
                </p>
                <p>
                  <span>Group name</span>
                  {editing ? (
                    <input
                      style={editInputStyle}
                      type="text"
                      value={form.groupName}
                      onChange={(e) => setField("groupName", e.target.value)}
                    />
                  ) : (
                    <strong>{record.groupName}</strong>
                  )}
                </p>
                <p>
                  <span>Effective date</span>
                  {editing ? (
                    <input
                      style={editInputStyle}
                      type="date"
                      value={form.effectiveDate}
                      onChange={(e) => setField("effectiveDate", e.target.value)}
                    />
                  ) : (
                    <strong>{record.effectiveDate}</strong>
                  )}
                </p>
              </div>
              <div className="cases-report-doc-gallery cases-report-doc-gallery--insurance">
                {editing ? (
                  <>
                    <InsuranceEditTile
                      side="FRONT SIDE"
                      currentUrl={insuranceFront?.url ?? null}
                      file={insuranceFiles.front}
                      onPick={(f) => setInsuranceFiles((s) => ({ ...s, front: f }))}
                    />
                    <InsuranceEditTile
                      side="BACK SIDE"
                      currentUrl={insuranceBack?.url ?? null}
                      file={insuranceFiles.back}
                      onPick={(f) => setInsuranceFiles((s) => ({ ...s, back: f }))}
                    />
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </div>

            <div>
              <h5>Reason for Consultation</h5>
              {editing ? (
                <>
                  <textarea
                    style={{ ...editInputStyle, minHeight: 80, resize: "vertical" }}
                    value={healthForm.inboxMessage}
                    onChange={(e) => setHealthField("inboxMessage", e.target.value)}
                  />
                  {renderMic("inboxMessage")}
                </>
              ) : (
                <p>
                  {record.inboxMessage.trim()
                    ? record.inboxMessage
                    : "No inbox summary was provided for this case."}
                </p>
              )}
            </div>

            <div>
              <h5>Current medication</h5>
              {editing ? (
                <MedicationPicker
                  value={healthForm.currentMedications}
                  onChange={(v) => setHealthField("currentMedications", v)}
                />
              ) : (
                <p style={{ whiteSpace: "pre-wrap" }}>
                  {record.health.currentMedications.trim()
                    ? record.health.currentMedications
                    : "No current medication reported."}
                </p>
              )}
              <p style={{ color: "#94a3b8", fontSize: 12, margin: "6px 0 0" }}>
                Medications reported by the patient during intake.
              </p>
            </div>

            {editing ? (
              <HpiExtractPanel
                currentValues={hpiCurrentValues}
                onApply={applyHpi}
                onFileChange={setStagedHpiFile}
              />
            ) : null}

            {renderHealthField("BMI", "bmi", {
              fallback: "No BMI recorded.",
              placeholder: "e.g. 24.5",
            })}
            {renderHealthField("Allergies", "allergies", {
              multiline: true,
              fallback: "No allergies reported.",
              dictate: "allergies",
            })}
            {renderHealthField("Past surgical history", "pastSurgicalHistory", {
              multiline: true,
              fallback: "No past surgical history reported.",
              dictate: "pastSurgicalHistory",
            })}
            {renderHealthField("Social history", "socialHistory", {
              multiline: true,
              fallback: "No social history reported.",
              dictate: "socialHistory",
            })}
            {renderHealthField("Primary Care Physician (PCP)", "primaryCarePhysician", {
              fallback: "No primary care physician provided.",
            })}
            {renderHealthField("PCP phone & fax", "pcpPhoneFax", {
              fallback: "No PCP phone/fax provided.",
            })}
            {renderHealthField("Pharmacy information", "pharmacyInformation", {
              multiline: true,
              fallback: "No pharmacy information provided.",
              dictate: "pharmacyInformation",
            })}
            {renderHealthField("Pharmacy phone & fax", "pharmacyPhoneFax", {
              fallback: "No pharmacy phone/fax provided.",
            })}

            <div>
              <h5>Uploaded documents and key findings</h5>
              {documentsLoading ? (
                <p style={{ color: "#64748b", margin: "8px 0 0", fontSize: 14 }}>
                  Loading documents…
                </p>
              ) : otherDocs.length === 0 && !editing ? (
                <p style={{ color: "#64748b", margin: "8px 0 0", fontSize: 14 }}>
                  No documents were uploaded with this case.
                </p>
              ) : (
                <div className="cases-report-doc-gallery">
                  {otherDocs.map((doc) => (
                    <DocCard
                      key={doc.fileId}
                      doc={doc}
                      editable={editing}
                      busy={busyDoc}
                      onDelete={() => removeDoc(doc.fileId)}
                    />
                  ))}
                </div>
              )}
              {editing ? (
                <>
                  <input
                    ref={addDocsRef}
                    type="file"
                    multiple
                    accept=".png,.jpg,.jpeg,.pdf"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      addDocs(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    className="cases-btn cases-btn--outline"
                    style={{ marginTop: 12 }}
                    disabled={busyDoc}
                    onClick={() => addDocsRef.current?.click()}
                  >
                    {busyDoc ? "Working…" : "+ Add files"}
                  </button>
                  <p style={{ color: "#94a3b8", margin: "6px 0 0", fontSize: 12 }}>
                    PNG, JPG, PDF · Max 5 MB per file
                  </p>
                </>
              ) : null}
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

        {editing && error ? (
          <p
            role="alert"
            style={{
              color: "#b91c1c",
              margin: "0 24px",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {error}
          </p>
        ) : null}

        <div className="cases-share-modal__actions">
          {editing ? (
            <>
              <button
                type="button"
                className="cases-btn cases-btn--outline"
                onClick={cancelEdit}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="cases-btn cases-btn--report"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </>
          ) : (
            <>
              {canEdit ? (
                <button
                  type="button"
                  className="cases-btn cases-btn--muted"
                  onClick={startEdit}
                >
                  Edit
                </button>
              ) : (
                <span className="cases-report-locked" title="The GI specialist has shared a report — this case is locked.">
                  🔒 Locked after GI report
                </span>
              )}
              <button
                type="button"
                className="cases-btn cases-btn--outline"
                onClick={onClose}
              >
                Close
              </button>
            </>
          )}
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

/** Editable insurance-card tile (edit mode): shows the current/picked image and
 *  lets the user pick a replacement. */
function InsuranceEditTile({
  side,
  currentUrl,
  file,
  onPick,
}: {
  side: string;
  currentUrl: string | null;
  file: File | null;
  onPick: (file: File | null) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (file && file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(null);
  }, [file]);

  const isPdf = !!file && !file.type.startsWith("image/");
  const shownImage = previewUrl ?? (!file ? currentUrl : null);

  return (
    <label
      className="cases-report-doc-card cases-report-doc-card--insurance"
      style={{ cursor: "pointer", position: "relative", outline: "2px dashed #93c5fd", outlineOffset: -2 }}
    >
      <span className="cases-report-doc-card__side-label">{side}</span>
      <input
        type="file"
        accept=".png,.jpg,.jpeg,.pdf"
        style={{ display: "none" }}
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      {shownImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shownImage} alt={`Insurance card ${side.toLowerCase()}`} loading="lazy" />
      ) : isPdf ? (
        <div className="cases-report-doc-card__meta">
          <strong>{file?.name}</strong>
          <span>PDF selected</span>
        </div>
      ) : (
        <div className="cases-report-doc-card__meta">
          <strong>Add {side.toLowerCase()}</strong>
          <span>PNG, JPG, PDF · max 5 MB</span>
        </div>
      )}
      <span
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "4px 8px",
          fontSize: 11,
          fontWeight: 700,
          color: "#fff",
          background: "rgba(37, 99, 235, 0.85)",
          textAlign: "center",
        }}
      >
        {file ? "Tap to change" : "Tap to replace"}
      </span>
    </label>
  );
}

function DocCard({
  doc,
  editable = false,
  busy = false,
  onDelete,
}: {
  doc: CaseDocument;
  editable?: boolean;
  busy?: boolean;
  onDelete?: () => void;
}) {
  const isImage = doc.contentType.startsWith("image/");
  const kindLabel = DOC_KIND_LABEL[doc.kind] ?? "Document";
  const date = formatDocDate(doc.uploadedAt);
  const meta = date ? `${kindLabel} • ${date}` : kindLabel;

  return (
    <div className="cases-report-doc-card-wrap">
      {editable && onDelete ? (
        <button
          type="button"
          className="cases-report-doc-card__delete"
          aria-label={`Delete ${doc.fileName}`}
          title="Delete file"
          disabled={busy}
          onClick={onDelete}
        >
          ×
        </button>
      ) : null}
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
    </div>
  );
}

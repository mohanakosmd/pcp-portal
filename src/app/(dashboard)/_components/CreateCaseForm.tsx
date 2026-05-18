"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";

type StepNumber = 1 | 2 | 3;

const STEPS: { id: StepNumber; label: string }[] = [
  { id: 1, label: "About you" },
  { id: 2, label: "Health" },
  { id: 3, label: "Files" },
];

const NEXT_LABELS: Record<StepNumber, string> = {
  1: "Next: Medical history",
  2: "Next: Document upload",
  3: "Submit case",
};

type UploadStatus = "pending" | "uploading" | "done" | "error";

type UploadedFile = {
  id: string; // local React key
  file?: File; // held in memory until Save draft / Submit uploads it
  serverFileId?: string; // pcp_cases/{id}/documents/{fileId} once uploaded
  name: string;
  meta: string;
  status: UploadStatus;
  error?: string;
};

const initialFiles: UploadedFile[] = [];

// --- Resume-an-existing-draft props ----------------------------------------

export type InitialCaseDocument = {
  fileId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  kind: string;
  uploadedAt: string;
  url: string;
};

export type InitialCase = {
  caseId: string;
  currentStep: 1 | 2 | 3;
  about: {
    fullLegalName: string;
    age: string;
    gender: string;
    dateOfBirth: string;
    address: string;
    mobile: string;
    email: string;
    insuranceCarrier: string;
    policyId: string;
    groupName: string;
    effectiveDate: string;
    insuranceFrontUrl: string | null;
    insuranceBackUrl: string | null;
  };
  health: { inboxMessage: string };
  documents: InitialCaseDocument[];
};

// Hard cap per uploaded file. Mirrors MAX_FILE_BYTES in the documents API
// route — checked client-side (on the post-compression bytes) so oversized
// files are rejected instantly instead of after a failed round-trip.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = bytes / 1024;
  return `${Math.round(kb)} KB`;
}

function formatExistingDocLabel(kind: string, contentType: string): string {
  const kinds: Record<string, string> = {
    lab: "Lab report",
    imaging: "Imaging",
    note: "Note",
    other: "Document",
  };
  if (kinds[kind]) return kinds[kind];
  if (contentType.startsWith("image/")) return "Image";
  return "Document";
}

function formatFileMeta(file: File): string {
  const sizeMb = file.size / (1024 * 1024);
  const sizeKb = file.size / 1024;
  const sizeLabel = sizeMb >= 1 ? `${sizeMb.toFixed(1)} MB` : `${Math.round(sizeKb)} KB`;
  const kindLabel = file.type.startsWith("image/")
    ? "Image"
    : file.name.split(".").pop()?.toUpperCase() || "File";
  const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${kindLabel} · ${sizeLabel} · Today, ${time}`;
}

/**
 * Downscale + re-encode an image so it fits comfortably inside a Firestore
 * document (1 MiB cap — files are stored as base64 data-URIs). Non-images and
 * already-tiny images are returned unchanged.
 */
async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  // Small images don't need re-encoding.
  if (file.size <= 200 * 1024) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const maxDim = 1000;
    let { width, height } = bitmap;
    if (width > maxDim || height > maxDim) {
      const scale = maxDim / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.72)
    );
    if (!blob || blob.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
  } catch {
    // If anything in the canvas path fails, fall back to the original file.
    return file;
  }
}

export function CreateCaseForm({
  initialCase = null,
}: {
  initialCase?: InitialCase | null;
}) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<StepNumber>(
    initialCase?.currentStep ?? 1
  );
  const [files, setFiles] = useState<UploadedFile[]>(() =>
    initialCase
      ? initialCase.documents.map((d) => ({
          id: `existing-${d.fileId}`,
          serverFileId: d.fileId,
          name: d.fileName,
          meta: `${formatExistingDocLabel(d.kind, d.contentType)} · ${formatBytes(d.sizeBytes)}`,
          status: "done" as const,
        }))
      : initialFiles
  );
  const [isDragOver, setIsDragOver] = useState(false);
  const [inboxMessage, setInboxMessage] = useState(
    initialCase?.health.inboxMessage ?? ""
  );
  const [speechStatus, setSpeechStatus] = useState("Speech input is ready. You can type anytime.");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const [caseId, setCaseId] = useState<string>(initialCase?.caseId ?? "");
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState("");
  // Green confirmation shown after "Save draft" — the user stays on the step.
  const [savedNotice, setSavedNotice] = useState("");
  // Highest step unlocked. You can only advance past a step (or jump to a
  // later tab) once the current part is complete — see handleNext. When
  // resuming a saved draft, every step is already unlocked.
  const [maxStep, setMaxStep] = useState<StepNumber>(initialCase ? 3 : 1);
  const [insuranceFiles, setInsuranceFiles] = useState<{
    front: File | null;
    back: File | null;
  }>({ front: null, back: null });
  // URLs of already-uploaded insurance cards (for resume-an-existing-draft).
  // Replaced visually as soon as the user picks a new file.
  const existingInsurance = {
    front: initialCase?.about.insuranceFrontUrl ?? null,
    back: initialCase?.about.insuranceBackUrl ?? null,
  };
  const aboutDefaults = initialCase?.about ?? null;

  const handleInsuranceChange = (side: "front" | "back", file: File | null) => {
    setInsuranceFiles((prev) => ({ ...prev, [side]: file }));
  };

  const progressPercent = useMemo(() => (currentStep / STEPS.length) * 100, [currentStep]);

  const scrollToTop = useCallback(() => {
    mainRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const goToStep = useCallback(
    (step: StepNumber) => {
      setCurrentStep(step);
      setSavedNotice("");
      scrollToTop();
    },
    [scrollToTop]
  );

  async function callJson(
    url: string,
    init?: RequestInit
  ): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
    const response = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    let data: Record<string, unknown> = {};
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      // ignore
    }
    return { ok: response.ok, status: response.status, data };
  }

  function errorFrom(data: Record<string, unknown>, fallback: string): string {
    return typeof data.error === "string" && data.error ? data.error : fallback;
  }

  async function ensureCaseId(): Promise<string> {
    if (caseId) return caseId;
    const { ok, data } = await callJson("/api/cases", { method: "POST" });
    if (!ok || typeof data.caseId !== "string") {
      throw new Error(errorFrom(data, "Failed to create case."));
    }
    setCaseId(data.caseId);
    return data.caseId;
  }

  function readAboutFromForm(): Record<string, unknown> {
    const form = formRef.current;
    if (!form) return {};
    const fd = new FormData(form);
    const get = (n: string) => {
      const v = fd.get(n);
      return typeof v === "string" ? v : "";
    };
    return {
      fullLegalName: get("full_name"),
      age: get("age"),
      gender: get("gender"),
      dateOfBirth: get("date_of_birth"),
      address: get("address"),
      mobile: get("phone"),
      email: get("email"),
      insuranceCarrier: get("insurance_carrier"),
      policyId: get("policy_id"),
      groupName: get("group_name"),
      effectiveDate: get("insurance_effective_date"),
    };
  }

  function readHealthFromForm(): Record<string, unknown> {
    return {
      inboxMessage,
      urgencyLevel: "routine",
    };
  }

  /**
   * Returns an error string if the given step isn't complete, or null if it's
   * good to advance. Mirrors the server-side completeness rules
   * (countCompleteAbout / countCompleteHealth in src/lib/cases.ts).
   * Step 3 (Files) has no required fields — documents are optional.
   */
  function validateStep(step: StepNumber): string | null {
    if (step === 1) {
      const about = readAboutFromForm();
      const str = (k: string) => String(about[k] ?? "").trim();
      const missing: string[] = [];
      if (!str("fullLegalName")) missing.push("Full legal name");
      const ageNum = Number(str("age"));
      if (!str("age") || !Number.isFinite(ageNum) || ageNum < 0 || ageNum > 120) {
        missing.push("Age (0–120)");
      }
      if (!str("gender")) missing.push("Gender");
      if (!str("mobile")) missing.push("Mobile or home phone");
      const email = str("email");
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        missing.push("Email");
      }
      return missing.length
        ? `Complete the About section before continuing: ${missing.join(", ")}.`
        : null;
    }
    if (step === 2) {
      if (!inboxMessage.trim()) {
        return "Add your Health inbox message before continuing.";
      }
      return null;
    }
    return null; // Step 3 — files are optional.
  }

  async function uploadOneFile(
    id: string,
    file: File,
    kind: string
  ): Promise<{ ok: boolean; fileId?: string; error?: string }> {
    const prepared = await compressImage(file);
    if (prepared.size > MAX_UPLOAD_BYTES) {
      return {
        ok: false,
        error: `"${file.name}" is ${(prepared.size / (1024 * 1024)).toFixed(1)} MB — the limit is 5 MB per file.`,
      };
    }
    const fd = new FormData();
    fd.append("file", prepared);
    fd.append("kind", kind);
    const response = await fetch("/api/cases/" + id + "/documents", {
      method: "POST",
      body: fd,
    });
    let data: Record<string, unknown> = {};
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      // ignore
    }
    if (!response.ok) {
      return { ok: false, error: errorFrom(data, "Upload failed.") };
    }
    return {
      ok: true,
      fileId: typeof data.fileId === "string" ? data.fileId : undefined,
    };
  }

  /** Uploads whatever is selected in the Step 1 insurance-card inputs. */
  async function uploadInsuranceCards(id: string): Promise<void> {
    const jobs: Promise<void>[] = [];
    const { front, back } = insuranceFiles;
    if (front) {
      jobs.push(
        uploadOneFile(id, front, "insurance_card_front").then((r) => {
          if (!r.ok) throw new Error(r.error || "Front card upload failed.");
        })
      );
    }
    if (back) {
      jobs.push(
        uploadOneFile(id, back, "insurance_card_back").then((r) => {
          if (!r.ok) throw new Error(r.error || "Back card upload failed.");
        })
      );
    }
    if (!jobs.length) return;
    await Promise.all(jobs);
    // Clear picked files once uploaded so re-visiting Step 1 doesn't
    // re-upload the same images.
    setInsuranceFiles({ front: null, back: null });
  }

  // Next advances ONLY when the current part is complete. Nothing is written
  // to Firebase here — all entered values stay in the form (panels stay
  // mounted) so moving back and forth preserves everything. Persistence
  // happens only on "Save draft" or the step-3 "Submit case" button.
  const handleNext = () => {
    setSavedNotice("");
    const error = validateStep(currentStep);
    if (error) {
      setServerError(error);
      return;
    }
    setServerError("");
    if (currentStep < STEPS.length) {
      const next = (currentStep + 1) as StepNumber;
      setMaxStep((m) => (next > m ? next : m));
      goToStep(next);
    }
  };

  // Previous is always allowed (reviewing/editing an earlier part).
  const handlePrev = () => {
    if (currentStep > 1) {
      setServerError("");
      goToStep((currentStep - 1) as StepNumber);
    }
  };

  // Stepper tabs: free to jump among already-unlocked steps; a later step is
  // unlocked only by completing the parts before it via Next.
  const handleTabClick = (step: StepNumber) => {
    if (step === currentStep) return;
    if (step > maxStep) return; // locked — finish earlier parts first
    setServerError("");
    goToStep(step);
  };

  /** Uploads any Step 3 documents still held in memory (status "pending"). */
  async function uploadPendingFiles(id: string): Promise<void> {
    const pending = files.filter((f) => f.status === "pending" && f.file);
    for (const entry of pending) {
      setFiles((prev) =>
        prev.map((f) => (f.id === entry.id ? { ...f, status: "uploading" as const } : f))
      );
      const result = await uploadOneFile(id, entry.file as File, "other");
      setFiles((prev) =>
        prev.map((f) =>
          f.id === entry.id
            ? result.ok
              ? { ...f, status: "done" as const, serverFileId: result.fileId, file: undefined }
              : { ...f, status: "error" as const, error: result.error }
            : f
        )
      );
      if (!result.ok) {
        throw new Error(result.error || `Upload failed for "${entry.name}".`);
      }
    }
  }

  /**
   * Writes the WHOLE form (all three steps) to Firebase in one pass: insurance
   * cards, About details, Health details, and any pending Step 3 documents.
   * Used by both "Save draft" and "Submit case".
   */
  async function persistAll(id: string): Promise<void> {
    // Insurance cards first so about/data.insuranceCards is populated before
    // the About PATCH reads/preserves it.
    await uploadInsuranceCards(id);

    const aboutRes = await callJson("/api/cases/" + id + "/about", {
      method: "PATCH",
      body: JSON.stringify(readAboutFromForm()),
    });
    if (!aboutRes.ok) {
      throw new Error(errorFrom(aboutRes.data, "Could not save the About details."));
    }

    const healthRes = await callJson("/api/cases/" + id + "/health", {
      method: "PATCH",
      body: JSON.stringify(readHealthFromForm()),
    });
    if (!healthRes.ok) {
      throw new Error(errorFrom(healthRes.data, "Could not save the Health details."));
    }

    await uploadPendingFiles(id);
  }

  // Save draft saves ONLY the current part. It does not advance, does not
  // navigate away, and does not require the part to be complete — the user
  // stays on this step and continues with the Next button when ready. The
  // case is created (if needed) and kept in `draft` status.
  const handleSaveDraft = async () => {
    if (saving) return;
    setSaving(true);
    setServerError("");
    setSavedNotice("");
    try {
      const id = await ensureCaseId();
      if (currentStep === 1) {
        await uploadInsuranceCards(id);
        const res = await callJson("/api/cases/" + id + "/about", {
          method: "PATCH",
          body: JSON.stringify(readAboutFromForm()),
        });
        if (!res.ok) {
          throw new Error(errorFrom(res.data, "Could not save the About details."));
        }
      } else if (currentStep === 2) {
        const res = await callJson("/api/cases/" + id + "/health", {
          method: "PATCH",
          body: JSON.stringify(readHealthFromForm()),
        });
        if (!res.ok) {
          throw new Error(errorFrom(res.data, "Could not save the Health details."));
        }
      } else {
        await uploadPendingFiles(id);
      }
      setSavedNotice(
        `${STEPS[currentStep - 1].label} draft saved. Use Next to continue when you're ready.`
      );
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleFinalSubmit = async () => {
    if (saving) return;
    setSavedNotice("");
    if (currentStep !== STEPS.length) {
      // Defensive: only the last step submits. Anything else just advances.
      handleNext();
      return;
    }
    // The case is only "created" (submitted) once EVERY part is complete.
    // Files (step 3) are optional, so just re-check About + Health here.
    const aboutError = validateStep(1);
    if (aboutError) {
      setServerError(aboutError);
      goToStep(1);
      return;
    }
    const healthError = validateStep(2);
    if (healthError) {
      setServerError(healthError);
      goToStep(2);
      return;
    }
    setSaving(true);
    setServerError("");
    try {
      const id = await ensureCaseId();
      await persistAll(id);
      const { ok, data } = await callJson("/api/cases/" + id + "/submit", {
        method: "POST",
      });
      if (!ok) throw new Error(errorFrom(data, "Submit failed."));
      // Fire-and-forget: kick off the Gemini summary so the case has an
      // AI-generated report ready by the time the user opens it. We don't
      // await — submission shouldn't block on the LLM call.
      fetch("/api/cases/" + id + "/ai-summary", { method: "POST" }).catch(() => {
        // best-effort — the report modal also has a Regenerate button
      });
      router.push("/cases");
      router.refresh();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Submit failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    // We never want native form submission to navigate us anywhere; all
    // transitions go through handleNext / handleFinalSubmit on explicit click.
    event.preventDefault();
  };

  // Just hold picked files in memory with status "pending". They're uploaded
  // later, in one pass, by Save draft / Submit (uploadPendingFiles).
  const addFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const entries: UploadedFile[] = Array.from(fileList).map((file) => ({
      id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
      file,
      name: file.name,
      meta: formatFileMeta(file),
      status: "pending" as const,
    }));
    setFiles((prev) => [...prev, ...entries]);
  };

  const handleFileTrigger = () => {
    fileInputRef.current?.click();
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    addFiles(event.dataTransfer?.files ?? null);
  };

  const handleDragEvent = (event: DragEvent<HTMLDivElement>, over: boolean) => {
    event.preventDefault();
    setIsDragOver(over);
  };

  const handleRemoveFile = async (id: string) => {
    const target = files.find((entry) => entry.id === id);
    setFiles((prev) => prev.filter((entry) => entry.id !== id));
    if (target?.serverFileId && caseId) {
      try {
        await fetch(
          "/api/cases/" + caseId + "/documents/" + target.serverFileId,
          { method: "DELETE" }
        );
      } catch {
        // best-effort — the row is already removed from the UI
      }
    }
  };

  type SpeechRecognitionResult = {
    transcript: string;
  };
  type SpeechRecognitionEvent = Event & {
    results: ArrayLike<ArrayLike<SpeechRecognitionResult>>;
  };
  type SpeechRecognitionLike = {
    lang: string;
    interimResults: boolean;
    maxAlternatives: number;
    start: () => void;
    addEventListener: (
      type: "result" | "error",
      listener: (event: SpeechRecognitionEvent) => void
    ) => void;
  };
  type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [speechSupported, setSpeechSupported] = useState(true);

  useEffect(() => {
    const w = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      setSpeechSupported(false);
      setSpeechStatus(
        "Speak-to-Text is not supported in this browser. Please type your message."
      );
      return;
    }
    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.addEventListener("result", (event) => {
      const first = event.results?.[0]?.[0];
      const text = first?.transcript?.trim();
      if (!text) return;
      setInboxMessage((prev) => (prev ? `${prev} ${text}` : text));
      setSpeechStatus("Speech captured. You can continue speaking or edit manually.");
    });
    recognition.addEventListener("error", () => {
      setSpeechStatus("Speech capture failed. Please type your message.");
    });
    recognitionRef.current = recognition;
  }, []);

  const handleStartSpeech = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      recognition.start();
      setSpeechStatus("Listening... please speak now.");
    } catch {
      setSpeechStatus("Unable to start speech capture. Please try again or type manually.");
    }
  };

  const nextLabel = NEXT_LABELS[currentStep];
  const isLast = currentStep === STEPS.length;

  return (
    <main className="create-case-main" id="main" ref={mainRef}>
      <div className="dash-page-head">
        <h1>Create New Case</h1>
        <p className="cc-page-lede">
          Create a case and share with GI&mdash;step by step. Your doctors review what you send
          and respond here.
        </p>
        <ul className="cc-form-trust" aria-label="Form benefits">
          <li className="cc-form-trust__item">
            <span className="cc-form-trust__icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2L20 5V11C20 16 16.5 20.5 12 22C7.5 20.5 4 16 4 11V5L12 2Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <path
                  d="M9 12l2 2 4-4"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span>HIPAA-grade encryption</span>
          </li>
          <li className="cc-form-trust__item">
            <span className="cc-form-trust__icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </span>
            <span>Save draft anytime</span>
          </li>
          <li className="cc-form-trust__item">
            <span className="cc-form-trust__icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M9 11H5a2 2 0 00-2 2v6a2 2 0 002 2h14a2 2 0 002-2v-6a2 2 0 00-2-2h-4M9 11V9a3 3 0 116 0v2M9 11h6"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span>About 5 minutes to finish</span>
          </li>
        </ul>
      </div>

      <div className="cc-stepper-wrap cc-stepper-wrap--tabs">
        <p className="visually-hidden" aria-live="polite">
          Step {currentStep} of {STEPS.length}
        </p>
        <ol
          className="cc-stepper cc-stepper--tabs"
          role="tablist"
          aria-label="Steps to share your information"
        >
          {STEPS.map((step) => {
            const isCurrent = step.id === currentStep;
            const isDone = step.id < currentStep;
            const isLocked = step.id > maxStep;
            const itemClass = [
              "cc-stepper__item",
              isCurrent ? "is-current" : "",
              isDone ? "is-done" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <li
                key={step.id}
                className={itemClass}
                data-step={step.id}
                role="presentation"
              >
                <button
                  type="button"
                  className="cc-tab"
                  id={`cc-tab-${step.id}`}
                  role="tab"
                  aria-selected={isCurrent}
                  aria-controls={`cc-panel-${step.id}`}
                  tabIndex={isCurrent ? 0 : -1}
                  disabled={isLocked}
                  aria-disabled={isLocked}
                  title={isLocked ? "Complete the earlier parts first" : undefined}
                  style={isLocked ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
                  onClick={() => handleTabClick(step.id)}
                >
                  <span className="cc-tab__mark" aria-hidden="true">
                    <span className="cc-tab__num">{step.id}</span>
                    <svg className="cc-tab__check" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M20 6L9 17l-5-5"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className="cc-tab__text">{step.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="cc-tabs__progress" aria-hidden="true">
          <div
            className="cc-tabs__progress-fill"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <form
        ref={formRef}
        className="cc-panels"
        id="cc-form"
        method="post"
        noValidate
        onSubmit={handleFormSubmit}
      >
        <Step1Panel
          active={currentStep === 1}
          insuranceFiles={insuranceFiles}
          onInsuranceChange={handleInsuranceChange}
          defaults={aboutDefaults}
          existingInsurance={existingInsurance}
        />
        <Step2Panel
          active={currentStep === 2}
          inboxMessage={inboxMessage}
          onInboxChange={setInboxMessage}
          speechStatus={speechStatus}
          speechSupported={speechSupported}
          onStartSpeech={handleStartSpeech}
        />
        <Step3Panel
          active={currentStep === 3}
          files={files}
          isDragOver={isDragOver}
          onDrop={handleDrop}
          onDragOver={(e) => handleDragEvent(e, true)}
          onDragEnter={(e) => handleDragEvent(e, true)}
          onDragLeave={(e) => handleDragEvent(e, false)}
          onFileTrigger={handleFileTrigger}
          onFilesPicked={(list) => addFiles(list)}
          onRemoveFile={handleRemoveFile}
          fileInputRef={fileInputRef}
        />

        {serverError ? (
          <p
            role="alert"
            style={{
              color: "#b91c1c",
              margin: "12px 0 0",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {serverError}
          </p>
        ) : null}

        {savedNotice && !serverError ? (
          <p
            role="status"
            style={{
              color: "#15803d",
              margin: "12px 0 0",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {savedNotice}
          </p>
        ) : null}

        <div className="cc-step1-actions" role="toolbar" aria-label="Step actions">
          <div className="cc-step1-actions__left">
            <button
              type="button"
              className="cc-btn cc-btn--outline"
              disabled={currentStep === 1 || saving}
              onClick={handlePrev}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M15 18l-6-6 6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Previous step
            </button>
          </div>
          <div className="cc-step1-actions__right">
            <button
              type="button"
              className="cc-btn cc-btn--outline"
              onClick={handleSaveDraft}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              className="cc-btn cc-btn--primary"
              onClick={isLast ? handleFinalSubmit : handleNext}
              disabled={saving}
            >
              {saving ? "Saving…" : nextLabel}
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}

type Step1AboutDefaults = {
  fullLegalName: string;
  age: string;
  gender: string;
  dateOfBirth: string;
  address: string;
  mobile: string;
  email: string;
  insuranceCarrier: string;
  policyId: string;
  groupName: string;
  effectiveDate: string;
};

type Step1PanelProps = {
  active: boolean;
  insuranceFiles: { front: File | null; back: File | null };
  onInsuranceChange: (side: "front" | "back", file: File | null) => void;
  defaults: Step1AboutDefaults | null;
  existingInsurance: { front: string | null; back: string | null };
};

function Step1Panel({
  active,
  insuranceFiles,
  onInsuranceChange,
  defaults,
  existingInsurance,
}: Step1PanelProps) {
  const d = (k: keyof Step1AboutDefaults) => defaults?.[k] ?? "";
  return (
    <div
      className={`cc-panel cc-panel--step1${active ? " is-active" : ""}`}
      id="cc-panel-1"
      data-panel="1"
      role="tabpanel"
      aria-labelledby="cc-tab-1"
      hidden={!active}
    >
      <div className="cc-step1-split">
        <aside
          className="cc-step1-aside cc-aside--sleek"
          aria-labelledby="cc-step1-aside-title"
        >
          <span className="cc-step1-aside__eyebrow">Step 1</span>
          <h3 id="cc-step1-aside-title" className="cc-step1-aside__title">
            Start with who you are
          </h3>
          <p className="cc-step1-aside__text">
            Use the name, contact, and insurance details on file so the system can match your
            records accurately.
          </p>
        </aside>

        <div className="cc-step1-form">
          <div className="dash-card cc-step1-card">
            <div className="dash-card__head cc-step1-card__head cc-step1-card__head--ruled">
              <h2 className="cc-step1-card__title">Demographic details</h2>
              <p className="cc-step1-card__lede">
                Enter details as they appear on your ID or insurance card.
              </p>
            </div>

            <div className="cc-form-section">
              <h3 className="cc-form-section__title" id="cc-section-about">
                About you
              </h3>
              <div
                className="cc-grid cc-grid--2 cc-step1-fields"
                aria-labelledby="cc-section-about"
              >
                <div className="cc-field cc-step1-field-full">
                  <label htmlFor="cc-full-name">Full legal name</label>
                  <input
                    className="cc-input"
                    id="cc-full-name"
                    name="full_name"
                    type="text"
                    autoComplete="name"
                    placeholder="e.g. Jordan A. Ellis"
                    required
                    defaultValue={d("fullLegalName")}
                  />
                </div>
                <div className="cc-field">
                  <label htmlFor="cc-age">Age</label>
                  <input
                    className="cc-input"
                    id="cc-age"
                    name="age"
                    type="number"
                    min={0}
                    max={120}
                    inputMode="numeric"
                    placeholder="Years"
                    defaultValue={d("age")}
                  />
                </div>
                <div className="cc-field">
                  <label htmlFor="cc-gender">Gender</label>
                  <select
                    className="cc-select"
                    id="cc-gender"
                    name="gender"
                    autoComplete="sex"
                    defaultValue={d("gender")}
                  >
                    <option value="">Select…</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="non_binary">Non-binary</option>
                    <option value="prefer_not_to_say">Prefer not to say</option>
                    <option value="other">Other / specify in notes</option>
                  </select>
                </div>
                <div className="cc-field">
                  <label htmlFor="cc-dob">Date of birth</label>
                  <input
                    className="cc-input"
                    id="cc-dob"
                    name="date_of_birth"
                    type="date"
                    autoComplete="bday"
                    defaultValue={d("dateOfBirth")}
                  />
                </div>
                <div className="cc-field cc-step1-field-full">
                  <label htmlFor="cc-address">Patient address</label>
                  <input
                    className="cc-input"
                    id="cc-address"
                    name="address"
                    type="text"
                    autoComplete="street-address"
                    placeholder="Street, City, State, ZIP"
                    defaultValue={d("address")}
                  />
                </div>
              </div>
            </div>

            <div className="cc-form-section">
              <div className="cc-grid cc-grid--2 cc-step1-fields">
                <div className="cc-field">
                  <label htmlFor="cc-phone">Mobile or home phone</label>
                  <input
                    className="cc-input"
                    id="cc-phone"
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    placeholder="+1 (555) 000-0000"
                    defaultValue={d("mobile")}
                  />
                </div>
                <div className="cc-field">
                  <label htmlFor="cc-email">Email</label>
                  <input
                    className="cc-input"
                    id="cc-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@email.com"
                    aria-describedby="cc-hint-email"
                    defaultValue={d("email")}
                  />
                  <span className="cc-field-hint" id="cc-hint-email">
                    We&apos;ll use this to send updates about this request only.
                  </span>
                </div>
              </div>
            </div>

            <div className="cc-form-section">
              <h3 className="cc-form-section__title" id="cc-section-insurance">
                Insurance information
              </h3>
              <div
                className="cc-grid cc-grid--2 cc-step1-fields"
                role="group"
                aria-labelledby="cc-section-insurance"
              >
                <div className="cc-field">
                  <label htmlFor="cc-insurance-carrier">Insurance carrier</label>
                  <input
                    className="cc-input"
                    id="cc-insurance-carrier"
                    name="insurance_carrier"
                    type="text"
                    autoComplete="organization"
                    defaultValue={d("insuranceCarrier")}
                  />
                </div>
                <div className="cc-field">
                  <label htmlFor="cc-policy-id">Policy ID</label>
                  <input
                    className="cc-input"
                    id="cc-policy-id"
                    name="policy_id"
                    type="text"
                    autoComplete="off"
                    defaultValue={d("policyId")}
                  />
                </div>
                <div className="cc-field">
                  <label htmlFor="cc-group-name">Group name</label>
                  <input
                    className="cc-input"
                    id="cc-group-name"
                    name="group_name"
                    type="text"
                    autoComplete="off"
                    defaultValue={d("groupName")}
                  />
                </div>
                <div className="cc-field">
                  <label htmlFor="cc-insurance-effective-date">Effective date</label>
                  <input
                    className="cc-input"
                    id="cc-insurance-effective-date"
                    name="insurance_effective_date"
                    type="date"
                    defaultValue={d("effectiveDate")}
                  />
                </div>
              </div>

              <div className="cc-grid cc-grid--2 cc-step1-fields cc-insurance-upload-grid">
                <div className="cc-field">
                  <label htmlFor="cc-insurance-front">Front side</label>
                  <InsuranceUploadTile
                    inputId="cc-insurance-front"
                    inputName="insurance_front"
                    defaultLabel="Insurance card front"
                    file={insuranceFiles.front}
                    existingUrl={existingInsurance.front}
                    onChange={(file) => onInsuranceChange("front", file)}
                  />
                </div>
                <div className="cc-field">
                  <label htmlFor="cc-insurance-back">Back side</label>
                  <InsuranceUploadTile
                    inputId="cc-insurance-back"
                    inputName="insurance_back"
                    defaultLabel="Insurance card back"
                    file={insuranceFiles.back}
                    existingUrl={existingInsurance.back}
                    onChange={(file) => onInsuranceChange("back", file)}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type InsuranceUploadTileProps = {
  inputId: string;
  inputName: string;
  defaultLabel: string;
  file: File | null;
  /** URL of an already-uploaded card (when resuming an existing draft). */
  existingUrl?: string | null;
  onChange: (file: File | null) => void;
};

function InsuranceUploadTile({
  inputId,
  inputName,
  defaultLabel,
  file,
  existingUrl = null,
  onChange,
}: InsuranceUploadTileProps) {
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
  // Fall back to the already-uploaded image whenever the user hasn't just
  // picked a new one.
  const fallbackUrl = !file && existingUrl ? existingUrl : null;

  return (
    <label className="cc-insurance-upload" htmlFor={inputId}>
      <input
        className="cc-file-input"
        id={inputId}
        name={inputName}
        type="file"
        accept=".png,.jpg,.jpeg,.pdf"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      {previewUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt={`${defaultLabel} preview`}
            style={{
              maxWidth: "100%",
              maxHeight: 110,
              borderRadius: 8,
              objectFit: "contain",
            }}
          />
          <span style={{ marginTop: 6 }}>{file?.name} · tap to change</span>
        </>
      ) : isPdf ? (
        <>
          <strong>{file?.name}</strong>
          <span>PDF selected · tap to change</span>
        </>
      ) : fallbackUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fallbackUrl}
            alt={`${defaultLabel} (uploaded)`}
            style={{
              maxWidth: "100%",
              maxHeight: 110,
              borderRadius: 8,
              objectFit: "contain",
            }}
          />
          <span style={{ marginTop: 6 }}>Uploaded · tap to replace</span>
        </>
      ) : (
        <>
          <strong>{defaultLabel}</strong>
          <span>PNG, JPG, PDF · Max 5 MB</span>
        </>
      )}
    </label>
  );
}

type Step2PanelProps = {
  active: boolean;
  inboxMessage: string;
  onInboxChange: (value: string) => void;
  speechStatus: string;
  speechSupported: boolean;
  onStartSpeech: () => void;
};

function Step2Panel({
  active,
  inboxMessage,
  onInboxChange,
  speechStatus,
  speechSupported,
  onStartSpeech,
}: Step2PanelProps) {
  return (
    <div
      className={`cc-panel cc-panel--step2${active ? " is-active" : ""}`}
      id="cc-panel-2"
      data-panel="2"
      role="tabpanel"
      aria-labelledby="cc-tab-2"
      hidden={!active}
    >
      <div className="cc-step2-split">
        <aside
          className="cc-step1-aside cc-aside--sleek"
          aria-labelledby="cc-step2-aside-title"
        >
          <span className="cc-step1-aside__eyebrow">Step 2</span>
          <h3 id="cc-step2-aside-title" className="cc-step1-aside__title">
            History, allergies &amp; conditions
          </h3>
          <p className="cc-step1-aside__text">
            In your own words, describe what&apos;s going on. List allergies and conditions your
            doctors should know about.
          </p>
        </aside>

        <div className="cc-step2-main">
          <section className="dash-card cc-step1-card" aria-labelledby="cc-health-inbox-heading">
            <div className="dash-card__head cc-step1-card__head cc-step1-card__head--ruled">
              <div className="cc-step1-card__head-main">
                <h2 id="cc-health-inbox-heading" className="cc-step1-card__title">
                  Health inbox
                </h2>
              </div>
              <p className="cc-step1-card__lede cc-step1-card__head-copy">
                Use Inbox to share symptoms with your GI specialist. You can speak or type your
                message.
              </p>
            </div>

            <div className="cc-banner cc-banner--step2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
                <path
                  d="M12 10V16M12 8V8.01"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
              <span>
                Select Inbox and send your health details. You can use Speak-to-Text or type
                manually.
              </span>
            </div>

            <div className="cc-field cc-field--tight-top">
              <label className="cc-medical-details__section-label">
                Please select one option
              </label>
              <input type="hidden" name="selected_symptom" value="Inbox" />
            </div>

            <div className="cc-field cc-field--emphasis cc-field--clinical-block">
              <label
                className="cc-medical-details__section-label"
                htmlFor="cc-inbox-message"
              >
                Inbox message
              </label>
              <textarea
                id="cc-inbox-message"
                name="inbox_message"
                className="cc-textarea"
                rows={4}
                placeholder="Describe your current symptoms, concerns, or updates..."
                value={inboxMessage}
                onChange={(e) => onInboxChange(e.target.value)}
              />
              <div className="cc-speech-action-row">
                <button
                  type="button"
                  className="cc-speech-btn"
                  aria-label="Start speech to text"
                  title="Speak-to-Text"
                  onClick={onStartSpeech}
                  disabled={!speechSupported}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect
                      x="9"
                      y="4"
                      width="6"
                      height="10"
                      rx="3"
                      stroke="currentColor"
                      strokeWidth="1.9"
                    />
                    <path
                      d="M6.5 11.5V12a5.5 5.5 0 0011 0v-.5"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                    />
                    <path
                      d="M12 17.5V21"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                    />
                    <path d="M9 21h6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <p className="cc-field-hint" aria-live="polite">
                {speechStatus}
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

type Step3PanelProps = {
  active: boolean;
  files: UploadedFile[];
  isDragOver: boolean;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onFileTrigger: () => void;
  onFilesPicked: (list: FileList | null) => void;
  onRemoveFile: (id: string) => void;
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
};

function Step3Panel({
  active,
  files,
  isDragOver,
  onDrop,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onFileTrigger,
  onFilesPicked,
  onRemoveFile,
  fileInputRef,
}: Step3PanelProps) {
  return (
    <div
      className={`cc-panel cc-panel--step3${active ? " is-active" : ""}`}
      id="cc-panel-3"
      data-panel="3"
      role="tabpanel"
      aria-labelledby="cc-tab-3"
      hidden={!active}
    >
      <div className="cc-step2-split">
        <aside
          className="cc-step1-aside cc-aside--sleek"
          aria-labelledby="cc-step3-aside-title"
        >
          <span className="cc-step1-aside__eyebrow">Step 3</span>
          <h3 id="cc-step3-aside-title" className="cc-step1-aside__title">
            Documentation
          </h3>
          <p className="cc-step1-aside__text">
            Upload imaging, labs, and supporting documents. Files are encrypted in transit and
            at rest.
          </p>
        </aside>

        <div className="cc-step3-main">
          <section className="dash-card cc-step1-card">
            <div className="cc-doc-head cc-step1-card__head--ruled">
              <div className="cc-doc-head__text">
                <h2 className="cc-step1-card__title">Documents &amp; images</h2>
                <p className="cc-field-hint cc-doc-note">
                  <strong>Note:</strong> Documents you upload will be analyzed by AI and shared
                  with a GI specialist; the AI-generated summary is preliminary and should not
                  be considered a final report.
                </p>
              </div>
              <span className="cc-doc-badge">Add if available</span>
            </div>

            <p className="cc-doc-tip">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 16v-4M12 8h.01"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
              </svg>
              Files are encrypted when you upload. Max 5 MB per file.
            </p>

            <div
              className={`cc-drop cc-drop--primary${isDragOver ? " is-dragover" : ""}`}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragEnter={onDragEnter}
              onDragLeave={onDragLeave}
            >
              <div className="cc-drop__content">
                <span className="cc-drop__icon" aria-hidden="true">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 15V3m0 0l4 4m-4-4L8 7M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <strong>Drop imaging (DICOM / JPG)</strong>
                <p>Maximum file size 5 MB per upload</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                name="documents[]"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.dcm,.zip,.csv,.xlsx"
                className="cc-file-input"
                onChange={(e) => onFilesPicked(e.target.files)}
              />
              <button
                type="button"
                className="cc-btn cc-btn--outline cc-doc-select-btn"
                onClick={onFileTrigger}
              >
                Select files
              </button>
            </div>

            <div className="cc-doc-secondary">
              <button
                type="button"
                className="cc-drop cc-drop--compact"
                onClick={onFileTrigger}
              >
                <span className="cc-drop__mini-icon" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="3" stroke="currentColor" strokeWidth="1.6" />
                    <path
                      d="M11 8V2M11 22v-6M8 11H2M22 11h-6"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <strong>Lab reports</strong>
                <span className="cc-drop__hint">PDF, Excel, CSV</span>
              </button>
              <button
                type="button"
                className="cc-drop cc-drop--compact"
                onClick={onFileTrigger}
              >
                <span className="cc-drop__mini-icon" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66L9.64 16.78a2 2 0 01-2.83-2.83l8.49-8.48"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <strong>Other attachments</strong>
                <span className="cc-drop__hint">Notes, previous consults</span>
              </button>
            </div>

            <p className="cc-file-list__title" id="cc-file-list-label">
              Selected files ({files.length})
            </p>
            <ul className="cc-file-list" aria-labelledby="cc-file-list-label">
              {files.map((file) => (
                <li key={file.id}>
                  <span className="cc-file-list__name">{file.name}</span>
                  <span className="cc-file-list__meta">
                    {file.status === "uploading"
                      ? "Uploading…"
                      : file.status === "error"
                        ? file.error || "Upload failed"
                        : file.status === "pending"
                          ? `${file.meta} · not saved yet`
                          : file.meta}
                  </span>
                  <button
                    type="button"
                    className="cc-file-list__remove"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => onRemoveFile(file.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

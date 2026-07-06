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

import { ageFromDob } from "@/lib/age";
import { formatUsPhone, isValidUsPhone } from "@/lib/phone";
import { US_STATES, phoneStateMismatch, usStateName } from "@/lib/us-area-codes";

import { MedicationPicker } from "./MedicationPicker";

type StepNumber = 1 | 2 | 3;

// The three document upload widgets, each validated/highlighted independently.
type DocSection = "primary" | "lab" | "other";
type DocErrorMap = Record<DocSection, string[]>;

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

// Maps a Step 1 form field `name` → the error key used in fieldErrors, so a
// single form-level change handler can clear a field's message as the user
// fixes it.
const ABOUT_FIELD_ERROR_KEYS: Record<string, string> = {
  full_name: "fullLegalName",
  date_of_birth: "dateOfBirth",
  gender: "gender",
  state: "state",
  address: "address",
  phone: "mobile",
  email: "email",
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
    gender: string;
    dateOfBirth: string;
    address: string;
    state: string;
    mobile: string;
    email: string;
    insuranceCarrier: string;
    policyId: string;
    groupName: string;
    effectiveDate: string;
    insuranceFrontUrl: string | null;
    insuranceBackUrl: string | null;
  };
  health: {
    inboxMessage: string;
    currentMedications: string;
    bmi: string;
    allergies: string;
    pastSurgicalHistory: string;
    socialHistory: string;
    primaryCarePhysician: string;
    pcpPhoneFax: string;
    pharmacyInformation: string;
    pharmacyPhoneFax: string;
  };
  documents: InitialCaseDocument[];
};

// Hard cap per uploaded file. Mirrors MAX_FILE_BYTES in the documents API
// route — checked client-side (on the post-compression bytes) so oversized
// files are rejected instantly instead of after a failed round-trip.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// Supported document formats. The picker's `accept` and the drag-and-drop
// filter both use this list, and the upload area displays it to the user.
const ACCEPTED_DOC_EXTENSIONS = [".jpg", ".jpeg", ".png", ".pdf"];
const ACCEPTED_DOC_ACCEPT = ACCEPTED_DOC_EXTENSIONS.join(",");
const ACCEPTED_DOC_LABEL = "JPG, PNG, PDF";

function isAcceptedDocType(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_DOC_EXTENSIONS.some((ext) => name.endsWith(ext));
}

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

// The logged-in provider's own details, used to prefill the PCP fields on the
// Health step (see create-case/page.tsx → loadPcpProfile).
export type PcpProfile = {
  name: string;
  phone: string;
};

export function CreateCaseForm({
  initialCase = null,
  pcpProfile = null,
}: {
  initialCase?: InitialCase | null;
  pcpProfile?: PcpProfile | null;
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
  const [docErrors, setDocErrors] = useState<DocErrorMap>({
    primary: [],
    lab: [],
    other: [],
  });
  const [inboxMessage, setInboxMessage] = useState(
    initialCase?.health.inboxMessage ?? ""
  );
  const [currentMedications, setCurrentMedications] = useState(
    initialCase?.health.currentMedications ?? ""
  );
  const [bmi, setBmi] = useState(initialCase?.health.bmi ?? "");
  const [allergies, setAllergies] = useState(initialCase?.health.allergies ?? "");
  const [pastSurgicalHistory, setPastSurgicalHistory] = useState(
    initialCase?.health.pastSurgicalHistory ?? ""
  );
  const [socialHistory, setSocialHistory] = useState(
    initialCase?.health.socialHistory ?? ""
  );
  // Prefill the PCP fields from the logged-in provider's profile. A saved value
  // on a resumed draft wins; otherwise (new case, or the field left blank) we
  // fall back to the provider's own name/phone.
  const [primaryCarePhysician, setPrimaryCarePhysician] = useState(
    initialCase?.health.primaryCarePhysician || pcpProfile?.name || ""
  );
  const [pcpPhoneFax, setPcpPhoneFax] = useState(
    initialCase?.health.pcpPhoneFax ||
      (pcpProfile?.phone ? formatUsPhone(pcpProfile.phone) : "")
  );
  const [pharmacyInformation, setPharmacyInformation] = useState(
    initialCase?.health.pharmacyInformation ?? ""
  );
  const [pharmacyPhoneFax, setPharmacyPhoneFax] = useState(
    initialCase?.health.pharmacyPhoneFax ?? ""
  );
  const [speechStatus, setSpeechStatus] = useState("Speech input is ready. You can type anytime.");
  const [isListening, setIsListening] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const [caseId, setCaseId] = useState<string>(initialCase?.caseId ?? "");
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState("");
  // Per-field validation messages for the About step, keyed by the field key
  // used in readAboutFromForm (fullLegalName, dateOfBirth, gender, state,
  // address, mobile, email). Shown inline under each field.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Transient toast shown after "Save draft" (the user stays on the step).
  const [toast, setToast] = useState<{
    message: string;
    state: "show" | "leave" | "hidden";
  }>({ message: "", state: "hidden" });
  const toastHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  // Age is no longer entered — it's derived live from the date of birth and
  // shown read-only next to the DOB field.
  const [computedAge, setComputedAge] = useState<number | null>(() =>
    ageFromDob(initialCase?.about.dateOfBirth ?? null)
  );

  const handleInsuranceChange = (side: "front" | "back", file: File | null) => {
    setInsuranceFiles((prev) => ({ ...prev, [side]: file }));
  };

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

  const progressPercent = useMemo(() => (currentStep / STEPS.length) * 100, [currentStep]);

  const scrollToTop = useCallback(() => {
    mainRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const goToStep = useCallback(
    (step: StepNumber) => {
      setCurrentStep(step);
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
      gender: get("gender"),
      dateOfBirth: get("date_of_birth"),
      address: get("address"),
      state: get("state"),
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
      currentMedications,
      bmi,
      allergies,
      pastSurgicalHistory,
      socialHistory,
      primaryCarePhysician,
      pcpPhoneFax,
      pharmacyInformation,
      pharmacyPhoneFax,
      urgencyLevel: "routine",
    };
  }

  /**
   * Per-field validation for the About step (Step 1). Every field is mandatory.
   * Returns a { fieldKey: message } map (empty when the step is complete) so the
   * messages can be shown inline under each field rather than as one banner.
   * Mirrors the server-side rules in countCompleteAbout (src/lib/cases.ts).
   */
  function aboutFieldErrors(): Record<string, string> {
    const about = readAboutFromForm();
    const str = (k: string) => String(about[k] ?? "").trim();
    const errs: Record<string, string> = {};

    if (!str("fullLegalName")) errs.fullLegalName = "Full legal name is required.";

    const dob = str("dateOfBirth");
    if (!dob) errs.dateOfBirth = "Date of birth is required.";
    else if (ageFromDob(dob) == null) {
      errs.dateOfBirth = "Enter a valid date of birth (age must be 0–120).";
    }

    if (!str("gender")) errs.gender = "Gender is required.";

    const state = str("state");
    if (!state) errs.state = "State is required.";

    if (!str("address")) errs.address = "Patient address is required.";

    const mobile = str("mobile");
    if (!mobile) errs.mobile = "Mobile or home phone is required.";
    else if (!isValidUsPhone(mobile)) errs.mobile = "Enter a valid US phone number.";
    else if (state && phoneStateMismatch(mobile, state)) {
      errs.mobile = `This area code isn't in ${usStateName(state)} — use a ${usStateName(
        state
      )} number or change the state.`;
    }

    const email = str("email");
    if (!email) errs.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errs.email = "Enter a valid email address.";
    }

    return errs;
  }

  /**
   * Per-field validation for the Health step (Step 2). Returns a
   * { fieldKey: message } map (empty when valid) so messages render inline under
   * each field, matching Step 1. The inbox message is required to advance/submit
   * (requireInbox); BMI, when provided, must be a plausible number. Every other
   * Health field is optional free text. Step 3 (Files) has no required fields.
   */
  function healthFieldErrors(opts: { requireInbox: boolean }): Record<string, string> {
    const errs: Record<string, string> = {};

    if (opts.requireInbox && !inboxMessage.trim()) {
      errs.inboxMessage = "Add your Health inbox message before continuing.";
    }

    const bmiVal = bmi.trim();
    if (bmiVal) {
      const n = Number(bmiVal);
      if (!Number.isFinite(n) || n < 10 || n > 80) {
        errs.bmi = "Enter a valid BMI between 10 and 80.";
      }
    }

    return errs;
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
    // Bytes are base64-chunked into Firestore server-side, which can be slow on
    // a poor connection, so give each attempt a generous timeout and retry
    // transient (network / timeout / 5xx) failures. 4xx responses are the
    // client's fault and won't improve on retry, so those return immediately
    // with the server's specific reason.
    const MAX_ATTEMPTS = 3;
    const UPLOAD_TIMEOUT_MS = 90_000;
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const fd = new FormData();
      fd.append("file", prepared);
      fd.append("kind", kind);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
      try {
        const response = await fetch("/api/cases/" + id + "/documents", {
          method: "POST",
          body: fd,
          signal: controller.signal,
        });
        let data: Record<string, unknown> = {};
        try {
          data = (await response.json()) as Record<string, unknown>;
        } catch {
          // ignore — non-JSON error body (handled below)
        }
        if (response.ok) {
          return { ok: true, fileId: typeof data.fileId === "string" ? data.fileId : undefined };
        }
        lastError = errorFrom(data, `Upload failed (server error ${response.status}).`);
        // Don't retry client errors (bad request, too large, unauthenticated…).
        if (response.status >= 400 && response.status < 500) {
          return { ok: false, error: `${lastError} (${file.name})` };
        }
      } catch (err) {
        lastError =
          err instanceof Error && err.name === "AbortError"
            ? `Upload timed out after ${Math.round(UPLOAD_TIMEOUT_MS / 1000)}s.`
            : "Network error while uploading.";
      } finally {
        clearTimeout(timer);
      }

      // Back off briefly before retrying a transient failure.
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
      }
    }

    return {
      ok: false,
      error: `${lastError || "Upload failed."} — couldn't attach "${file.name}" after ${MAX_ATTEMPTS} tries.`,
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
    if (currentStep === 1) {
      const errs = aboutFieldErrors();
      if (Object.keys(errs).length) {
        setFieldErrors(errs);
        setServerError("");
        return;
      }
    } else if (currentStep === 2) {
      const errs = healthFieldErrors({ requireInbox: true });
      if (Object.keys(errs).length) {
        setFieldErrors(errs);
        setServerError("");
        return;
      }
    }
    setServerError("");
    setFieldErrors({});
    if (currentStep < STEPS.length) {
      const next = (currentStep + 1) as StepNumber;
      setMaxStep((m) => (next > m ? next : m));
      goToStep(next);
    }
  };

  // Clears a field's inline error as soon as the user edits it. Attached at the
  // form level so a single handler covers every Step 1 input/select.
  const handleFormChange = (event: React.ChangeEvent<HTMLFormElement>) => {
    const name = event.target.name;
    const key = ABOUT_FIELD_ERROR_KEYS[name];
    if (!key) return;
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // Clears a single field's inline error. Used by the controlled Step 2 (Health)
  // fields, which don't flow through the form-level handleFormChange.
  const clearFieldError = useCallback((key: string) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

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

  /**
   * Uploads any Step 3 documents still held in memory (status "pending").
   * Attempts EVERY pending file (doesn't stop at the first failure) so one bad
   * file doesn't strand the rest; each file's row shows its own done/error
   * state. Throws a single combined, specific error if any file ultimately
   * failed — the caller decides whether that blocks submission.
   */
  async function uploadPendingFiles(id: string): Promise<void> {
    const pending = files.filter((f) => f.status === "pending" && f.file);
    const failures: string[] = [];
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
        failures.push(result.error || `Couldn't attach "${entry.name}".`);
      }
    }
    if (failures.length) {
      throw new Error(
        failures.length === 1
          ? failures[0]
          : `${failures.length} files couldn't be attached — ${failures.join(" ")}`
      );
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
      // Prefer the server's specific reason; fall back to a status-bearing
      // message that points at the step to review (never a dead-end generic).
      throw new Error(
        errorFrom(
          aboutRes.data,
          `Could not save the About details (error ${aboutRes.status}). Please review Step 1 (About you) and try again.`
        )
      );
    }

    const healthRes = await callJson("/api/cases/" + id + "/health", {
      method: "PATCH",
      body: JSON.stringify(readHealthFromForm()),
    });
    if (!healthRes.ok) {
      throw new Error(
        errorFrom(
          healthRes.data,
          `Could not save the Health details (error ${healthRes.status}). Please review Step 2 (Health) and try again.`
        )
      );
    }

    await uploadPendingFiles(id);
  }

  // Save draft persists the WHOLE form — every step's entered values, not just
  // the step the user happens to be on. "Next" intentionally doesn't write to
  // Firebase, so saving only the current step would silently drop anything typed
  // on an earlier step. Reading from the always-mounted panels captures it all
  // at once. The whole About-you section must be valid first: we won't create a
  // case or write empty/invalid demographic values — instead we surface the
  // inline field errors and stay put.
  const handleSaveDraft = async () => {
    if (saving) return;
    const aboutErrs = aboutFieldErrors();
    if (Object.keys(aboutErrs).length) {
      setFieldErrors(aboutErrs);
      setServerError("");
      if (currentStep !== 1) goToStep(1);
      return;
    }
    // Drafts may be incomplete (no inbox message yet), but a BMI that's typed
    // must still be valid before we persist it.
    const healthErrs = healthFieldErrors({ requireInbox: false });
    if (Object.keys(healthErrs).length) {
      setFieldErrors(healthErrs);
      setServerError("");
      if (currentStep !== 2) goToStep(2);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setServerError("");
    try {
      const id = await ensureCaseId();
      await persistAll(id);
      showToast(
        initialCase
          ? "Case draft updated — your changes are saved."
          : "Draft saved — your progress is stored."
      );
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleFinalSubmit = async () => {
    if (saving) return;
    if (currentStep !== STEPS.length) {
      // Defensive: only the last step submits. Anything else just advances.
      handleNext();
      return;
    }
    // The case is only "created" (submitted) once EVERY part is complete.
    // Files (step 3) are optional, so just re-check About + Health here.
    const aboutErrs = aboutFieldErrors();
    if (Object.keys(aboutErrs).length) {
      setFieldErrors(aboutErrs);
      setServerError("");
      goToStep(1);
      return;
    }
    const healthErrs = healthFieldErrors({ requireInbox: true });
    if (Object.keys(healthErrs).length) {
      setFieldErrors(healthErrs);
      setServerError("");
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
      // Hand the toast off to the Cases page so it shows once we land there.
      router.push(`/cases?notice=${initialCase ? "updated" : "created"}`);
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
  const addFiles = async (fileList: FileList | null, section: DocSection) => {
    if (!fileList || fileList.length === 0) return;
    const picked = Array.from(fileList);
    // Drag-and-drop bypasses the input's `accept`, so enforce the format here
    // too — only JPG, PNG and PDF are supported.
    const wrongType = picked.filter((file) => !isAcceptedDocType(file));
    const rightType = picked.filter(isAcceptedDocType);

    // One message per rejected file so a multi-file upload shows them all.
    const messages: string[] = [];
    for (const file of wrongType) {
      messages.push(
        `Unsupported file type: ${file.name}. Supported formats: ${ACCEPTED_DOC_LABEL}.`
      );
    }

    // Size is checked against the post-compression bytes (images are shrunk
    // before upload), so a large photo that compresses under the limit is kept.
    const accepted: File[] = [];
    for (const file of rightType) {
      let prepared = file;
      try {
        prepared = await compressImage(file);
      } catch {
        prepared = file;
      }
      if (prepared.size > MAX_UPLOAD_BYTES) {
        messages.push(
          `File too large (max 5 MB): ${file.name} (${formatBytes(prepared.size)}).`
        );
      } else {
        accepted.push(file);
      }
    }

    // Route errors to the widget that was used. When some files were accepted,
    // that widget's earlier errors are stale — show just this batch's;
    // otherwise keep accumulating across sequential attempts.
    setDocErrors((prev) => ({
      ...prev,
      [section]:
        accepted.length > 0
          ? messages
          : Array.from(new Set([...prev[section], ...messages])),
    }));

    if (accepted.length === 0) return;
    const entries: UploadedFile[] = accepted.map((file) => ({
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
    addFiles(event.dataTransfer?.files ?? null, "primary");
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
  type SpeechRecognitionAlternatives = ArrayLike<SpeechRecognitionResult> & {
    isFinal?: boolean;
  };
  type SpeechRecognitionEvent = Event & {
    resultIndex: number;
    results: ArrayLike<SpeechRecognitionAlternatives>;
  };
  type SpeechRecognitionErrorEvent = Event & { error?: string };
  type SpeechRecognitionLike = {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    start: () => void;
    stop: () => void;
    abort: () => void;
    addEventListener: (
      type: "result" | "error" | "end" | "start",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      listener: (event: any) => void
    ) => void;
  };
  type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const listeningRef = useRef(false);
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
    // Continuous + interim so the user can dictate multiple sentences without
    // re-clicking, and partial results show up immediately as visible feedback.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.addEventListener("start", () => {
      listeningRef.current = true;
      setIsListening(true);
      setSpeechStatus("Listening… click the mic again to stop.");
    });

    recognition.addEventListener("result", (event: SpeechRecognitionEvent) => {
      // Walk only the new results since the last event (resultIndex onwards),
      // append finalized text to the textarea, keep the interim chunk visible
      // as a status hint so the user sees what's being heard live.
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const alt = event.results[i];
        const transcript = alt?.[0]?.transcript ?? "";
        if (alt?.isFinal) finalText += transcript;
        else interimText += transcript;
      }
      const finalized = finalText.trim();
      if (finalized) {
        setInboxMessage((prev) =>
          prev ? `${prev.replace(/\s+$/, "")} ${finalized}` : finalized
        );
      }
      const interim = interimText.trim();
      if (interim) {
        setSpeechStatus(`Listening… "${interim}"`);
      } else if (finalized) {
        setSpeechStatus("Listening… keep talking, or click the mic to stop.");
      }
    });

    recognition.addEventListener("error", (event: SpeechRecognitionErrorEvent) => {
      const code = event.error || "";
      if (code === "no-speech") {
        setSpeechStatus("Didn't catch that. Click the mic to try again.");
      } else if (code === "not-allowed" || code === "service-not-allowed") {
        setSpeechStatus(
          "Microphone is blocked. Click the lock or 🎤 icon in your browser's address bar, set Microphone to Allow for this site, then click the mic again."
        );
      } else if (code === "aborted") {
        setSpeechStatus("Speech capture stopped.");
      } else if (code === "audio-capture") {
        setSpeechStatus(
          "No microphone was detected. Plug one in (or check OS sound settings) and try again."
        );
      } else if (code === "network") {
        setSpeechStatus("Speech service couldn't reach the network. Check your connection.");
      } else {
        setSpeechStatus("Speech capture failed. Please type your message.");
      }
    });

    recognition.addEventListener("end", () => {
      listeningRef.current = false;
      setIsListening(false);
      setSpeechStatus((prev) =>
        prev.startsWith("Listening")
          ? "Speech captured. Click the mic to dictate again."
          : prev
      );
    });

    recognitionRef.current = recognition;

    return () => {
      // Stop any in-flight recognition when the component unmounts.
      try {
        if (listeningRef.current) recognition.abort();
      } catch {
        // best effort
      }
    };
  }, []);

  const handleStartSpeech = async () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    // Toggle: clicking the mic while it's listening stops the capture.
    if (listeningRef.current) {
      try {
        recognition.stop();
      } catch {
        // ignore
      }
      return;
    }
    // Speech Recognition needs a secure context. http:// (other than
    // localhost) won't get a prompt at all — surface that clearly.
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setSpeechStatus(
        "Speech input needs a secure (https://) connection. Reload over https or use localhost."
      );
      return;
    }
    // Force a fresh permission prompt before kicking off SpeechRecognition.
    // SpeechRecognition's own prompt is finicky on some browsers when a
    // previous denial is cached; getUserMedia gives a clean, predictable one
    // and lets us surface a clear error message before the recognizer fires.
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.mediaDevices?.getUserMedia
      ) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Don't actually keep the stream — SpeechRecognition opens its own.
        stream.getTracks().forEach((t) => t.stop());
      }
    } catch (err) {
      const name = (err as { name?: string })?.name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setSpeechStatus(
          "Microphone is blocked. Click the lock or 🎤 icon in your browser's address bar, set Microphone to Allow for this site, then click the mic again."
        );
        return;
      }
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        setSpeechStatus(
          "No microphone was detected. Plug one in (or check OS sound settings) and try again."
        );
        return;
      }
      // Other errors (NotReadableError, etc.) — let recognition.start() try
      // and produce its own error event.
    }
    try {
      recognition.start();
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
        onChange={handleFormChange}
      >
        <Step1Panel
          active={currentStep === 1}
          insuranceFiles={insuranceFiles}
          onInsuranceChange={handleInsuranceChange}
          defaults={aboutDefaults}
          existingInsurance={existingInsurance}
          computedAge={computedAge}
          onDobChange={(value) => setComputedAge(ageFromDob(value))}
          errors={fieldErrors}
        />
        <Step2Panel
          active={currentStep === 2}
          inboxMessage={inboxMessage}
          onInboxChange={(v) => {
            setInboxMessage(v);
            clearFieldError("inboxMessage");
          }}
          currentMedications={currentMedications}
          onCurrentMedicationsChange={setCurrentMedications}
          bmi={bmi}
          onBmiChange={(v) => {
            setBmi(v);
            clearFieldError("bmi");
          }}
          allergies={allergies}
          onAllergiesChange={setAllergies}
          pastSurgicalHistory={pastSurgicalHistory}
          onPastSurgicalHistoryChange={setPastSurgicalHistory}
          socialHistory={socialHistory}
          onSocialHistoryChange={setSocialHistory}
          primaryCarePhysician={primaryCarePhysician}
          onPrimaryCarePhysicianChange={setPrimaryCarePhysician}
          pcpPhoneFax={pcpPhoneFax}
          onPcpPhoneFaxChange={setPcpPhoneFax}
          pharmacyInformation={pharmacyInformation}
          onPharmacyInformationChange={setPharmacyInformation}
          pharmacyPhoneFax={pharmacyPhoneFax}
          onPharmacyPhoneFaxChange={setPharmacyPhoneFax}
          speechStatus={speechStatus}
          speechSupported={speechSupported}
          isListening={isListening}
          onStartSpeech={handleStartSpeech}
          errors={fieldErrors}
        />
        <Step3Panel
          active={currentStep === 3}
          files={files}
          isDragOver={isDragOver}
          errors={docErrors}
          onDrop={handleDrop}
          onDragOver={(e) => handleDragEvent(e, true)}
          onDragEnter={(e) => handleDragEvent(e, true)}
          onDragLeave={(e) => handleDragEvent(e, false)}
          onFileTrigger={handleFileTrigger}
          onFilesPicked={(list, section) => addFiles(list, section)}
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
            {/* "Save draft" is for the earlier steps. On the final File step the
                workflow is to submit, so it's hidden there. */}
            {!isLast ? (
              <button
                type="button"
                className="cc-btn cc-btn--outline"
                onClick={handleSaveDraft}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save draft"}
              </button>
            ) : null}
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

      <div
        className={`cc-toast${
          toast.state === "show" || toast.state === "leave" ? " cc-toast--show" : ""
        }${toast.state === "leave" ? " cc-toast--leave" : ""}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-hidden={toast.state === "hidden"}
      >
        <p className="cc-toast__text">{toast.message}</p>
      </div>
    </main>
  );
}

type Step1AboutDefaults = {
  fullLegalName: string;
  gender: string;
  dateOfBirth: string;
  address: string;
  state: string;
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
  computedAge: number | null;
  onDobChange: (value: string) => void;
  errors: Record<string, string>;
};

function Step1Panel({
  active,
  insuranceFiles,
  onInsuranceChange,
  defaults,
  existingInsurance,
  computedAge,
  onDobChange,
  errors,
}: Step1PanelProps) {
  const d = (k: keyof Step1AboutDefaults) => defaults?.[k] ?? "";
  const fieldError = (key: string) =>
    errors[key] ? (
      <span className="cc-field-error" role="alert">
        {errors[key]}
      </span>
    ) : null;
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
                  {fieldError("fullLegalName")}
                </div>
                <div className="cc-field">
                  <label htmlFor="cc-gender">Gender</label>
                  <select
                    className="cc-select"
                    id="cc-gender"
                    name="gender"
                    autoComplete="sex"
                    required
                    defaultValue={d("gender")}
                  >
                    <option value="">Select…</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="non_binary">Non-binary</option>
                    <option value="prefer_not_to_say">Prefer not to say</option>
                    <option value="other">Other / specify in notes</option>
                  </select>
                  {fieldError("gender")}
                </div>
                <div className="cc-field">
                  <label htmlFor="cc-dob">Date of birth</label>
                  <input
                    className="cc-input"
                    id="cc-dob"
                    name="date_of_birth"
                    type="date"
                    autoComplete="bday"
                    required
                    max={new Date().toISOString().slice(0, 10)}
                    defaultValue={d("dateOfBirth")}
                    onChange={(e) => onDobChange(e.currentTarget.value)}
                  />
                  <span className="cc-field-hint">
                    {computedAge != null
                      ? `Age: ${computedAge} ${computedAge === 1 ? "year" : "years"}`
                      : "Age is calculated from the date of birth."}
                  </span>
                  {fieldError("dateOfBirth")}
                </div>
                <div className="cc-field">
                  <label htmlFor="cc-state">State</label>
                  <select
                    className="cc-select"
                    id="cc-state"
                    name="state"
                    autoComplete="address-level1"
                    required
                    defaultValue={d("state")}
                  >
                    <option value="">Select…</option>
                    {US_STATES.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  {fieldError("state")}
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
                    required
                    defaultValue={d("address")}
                  />
                  {fieldError("address")}
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
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="+1 (555) 000-0000"
                    required
                    defaultValue={formatUsPhone(d("mobile"))}
                    onChange={(e) => {
                      e.currentTarget.value = formatUsPhone(e.currentTarget.value);
                    }}
                  />
                  {fieldError("mobile")}
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
                    required
                    defaultValue={d("email")}
                  />
                  <span className="cc-field-hint" id="cc-hint-email">
                    We&apos;ll use this to send updates about this request only.
                  </span>
                  {fieldError("email")}
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
  const [error, setError] = useState<string | null>(null);

  const handlePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null;
    if (!picked) {
      setError(null);
      onChange(null);
      return;
    }
    if (!isAcceptedDocType(picked)) {
      setError("Unsupported file type. Upload a PNG, JPG, or PDF.");
      event.target.value = "";
      return;
    }
    if (picked.size > MAX_UPLOAD_BYTES) {
      setError(`File is too large (${formatBytes(picked.size)}). Maximum size is 5 MB.`);
      event.target.value = "";
      return;
    }
    setError(null);
    onChange(picked);
  };

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
    <>
    <label className="cc-insurance-upload" htmlFor={inputId}>
      <input
        className="cc-file-input"
        id={inputId}
        name={inputName}
        type="file"
        accept=".png,.jpg,.jpeg,.pdf"
        onChange={handlePick}
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
    {error ? (
      <p className="cc-field-error" role="alert">
        {error}
      </p>
    ) : null}
    </>
  );
}

type Step2PanelProps = {
  active: boolean;
  inboxMessage: string;
  onInboxChange: (value: string) => void;
  currentMedications: string;
  onCurrentMedicationsChange: (value: string) => void;
  bmi: string;
  onBmiChange: (value: string) => void;
  allergies: string;
  onAllergiesChange: (value: string) => void;
  pastSurgicalHistory: string;
  onPastSurgicalHistoryChange: (value: string) => void;
  socialHistory: string;
  onSocialHistoryChange: (value: string) => void;
  primaryCarePhysician: string;
  onPrimaryCarePhysicianChange: (value: string) => void;
  pcpPhoneFax: string;
  onPcpPhoneFaxChange: (value: string) => void;
  pharmacyInformation: string;
  onPharmacyInformationChange: (value: string) => void;
  pharmacyPhoneFax: string;
  onPharmacyPhoneFaxChange: (value: string) => void;
  speechStatus: string;
  speechSupported: boolean;
  isListening: boolean;
  onStartSpeech: () => void;
  errors: Record<string, string>;
};

function Step2Panel({
  active,
  inboxMessage,
  onInboxChange,
  currentMedications,
  onCurrentMedicationsChange,
  bmi,
  onBmiChange,
  allergies,
  onAllergiesChange,
  pastSurgicalHistory,
  onPastSurgicalHistoryChange,
  socialHistory,
  onSocialHistoryChange,
  primaryCarePhysician,
  onPrimaryCarePhysicianChange,
  pcpPhoneFax,
  onPcpPhoneFaxChange,
  pharmacyInformation,
  onPharmacyInformationChange,
  pharmacyPhoneFax,
  onPharmacyPhoneFaxChange,
  speechStatus,
  speechSupported,
  isListening,
  onStartSpeech,
  errors,
}: Step2PanelProps) {
  const fieldError = (key: string) =>
    errors[key] ? (
      <span className="cc-field-error" role="alert">
        {errors[key]}
      </span>
    ) : null;
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
                aria-invalid={errors.inboxMessage ? true : undefined}
              />
              <div className="cc-speech-action-row">
                <button
                  type="button"
                  className={`cc-speech-btn${isListening ? " cc-speech-btn--listening" : ""}`}
                  aria-label={isListening ? "Stop speech to text" : "Start speech to text"}
                  aria-pressed={isListening}
                  title={isListening ? "Stop recording" : "Speak-to-Text"}
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
              {fieldError("inboxMessage")}
            </div>

            <div className="cc-field cc-field--clinical-block">
              <label className="cc-medical-details__section-label">
                Current Medication
              </label>
              <MedicationPicker
                value={currentMedications}
                onChange={onCurrentMedicationsChange}
              />
              <p className="cc-field-hint" style={{ marginTop: 8 }}>
                Medications reported by the patient during intake.
              </p>
            </div>
          </section>

          <section
            className="dash-card cc-step1-card"
            aria-labelledby="cc-health-more-heading"
          >
            <div className="dash-card__head cc-step1-card__head cc-step1-card__head--ruled">
              <div className="cc-step1-card__head-main">
                <h2 id="cc-health-more-heading" className="cc-step1-card__title">
                  Medical history &amp; care team
                </h2>
              </div>
              <p className="cc-step1-card__lede cc-step1-card__head-copy">
                Optional, but the more you share the better your GI specialist can help.
              </p>
            </div>

            <div className="cc-form-section">
              <div className="cc-grid cc-grid--2 cc-step1-fields">
                <div className="cc-field">
                  <label htmlFor="cc-bmi">BMI</label>
                  <input
                    className="cc-input"
                    id="cc-bmi"
                    name="bmi"
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 24.5"
                    value={bmi}
                    onChange={(e) => onBmiChange(e.target.value)}
                    aria-invalid={errors.bmi ? true : undefined}
                  />
                  {fieldError("bmi")}
                </div>
                <div className="cc-field">
                  <label htmlFor="cc-pcp">Primary Care Physician (PCP)</label>
                  <input
                    className="cc-input"
                    id="cc-pcp"
                    name="primary_care_physician"
                    type="text"
                    placeholder="Dr. name / clinic"
                    value={primaryCarePhysician}
                    onChange={(e) => onPrimaryCarePhysicianChange(e.target.value)}
                  />
                </div>
                <div className="cc-field">
                  <label htmlFor="cc-pcp-phone-fax">PCP Phone &amp; Fax</label>
                  <input
                    className="cc-input"
                    id="cc-pcp-phone-fax"
                    name="pcp_phone_fax"
                    type="text"
                    placeholder="Phone · Fax"
                    value={pcpPhoneFax}
                    onChange={(e) => onPcpPhoneFaxChange(e.target.value)}
                  />
                </div>
                <div className="cc-field">
                  <label htmlFor="cc-pharmacy-phone-fax">Pharmacy Phone &amp; Fax</label>
                  <input
                    className="cc-input"
                    id="cc-pharmacy-phone-fax"
                    name="pharmacy_phone_fax"
                    type="text"
                    placeholder="Phone · Fax"
                    value={pharmacyPhoneFax}
                    onChange={(e) => onPharmacyPhoneFaxChange(e.target.value)}
                  />
                </div>
                <div className="cc-field cc-step1-field-full">
                  <label htmlFor="cc-pharmacy-info">Pharmacy Information</label>
                  <textarea
                    className="cc-textarea"
                    id="cc-pharmacy-info"
                    name="pharmacy_information"
                    rows={2}
                    placeholder="Pharmacy name and address"
                    value={pharmacyInformation}
                    onChange={(e) => onPharmacyInformationChange(e.target.value)}
                  />
                </div>
                <div className="cc-field cc-step1-field-full">
                  <label htmlFor="cc-allergies">Allergies</label>
                  <textarea
                    className="cc-textarea"
                    id="cc-allergies"
                    name="allergies"
                    rows={2}
                    placeholder="Medications, foods, environmental — or 'None known'"
                    value={allergies}
                    onChange={(e) => onAllergiesChange(e.target.value)}
                  />
                </div>
                <div className="cc-field cc-step1-field-full">
                  <label htmlFor="cc-past-surgical">Past Surgical History</label>
                  <textarea
                    className="cc-textarea"
                    id="cc-past-surgical"
                    name="past_surgical_history"
                    rows={2}
                    placeholder="Prior surgeries and approximate dates"
                    value={pastSurgicalHistory}
                    onChange={(e) => onPastSurgicalHistoryChange(e.target.value)}
                  />
                </div>
                <div className="cc-field cc-step1-field-full">
                  <label htmlFor="cc-social-history">Social History</label>
                  <textarea
                    className="cc-textarea"
                    id="cc-social-history"
                    name="social_history"
                    rows={2}
                    placeholder="Tobacco, alcohol, occupation, etc."
                    value={socialHistory}
                    onChange={(e) => onSocialHistoryChange(e.target.value)}
                  />
                </div>
              </div>
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
  errors: DocErrorMap;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onFileTrigger: () => void;
  onFilesPicked: (list: FileList | null, section: DocSection) => void;
  onRemoveFile: (id: string) => void;
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
};

function DocErrorList({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <div className="cc-doc-errors" role="alert">
      {messages.map((message, i) => (
        <p key={`${message}-${i}`} className="cc-field-error">
          {message}
        </p>
      ))}
    </div>
  );
}

function Step3Panel({
  active,
  files,
  isDragOver,
  errors,
  onDrop,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onFileTrigger,
  onFilesPicked,
  onRemoveFile,
  fileInputRef,
}: Step3PanelProps) {
  const labInputRef = useRef<HTMLInputElement | null>(null);
  const otherInputRef = useRef<HTMLInputElement | null>(null);
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
              </div>
              <span className="cc-doc-badge">Optional</span>
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
              className={`cc-drop cc-drop--primary${isDragOver ? " is-dragover" : ""}${
                errors.primary.length > 0 ? " is-error" : ""
              }`}
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
                <strong>Drag &amp; drop files here</strong>
                <p>Supported formats: {ACCEPTED_DOC_LABEL} · Max 5 MB per file</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                name="documents[]"
                multiple
                accept={ACCEPTED_DOC_ACCEPT}
                className="cc-file-input"
                onChange={(e) => onFilesPicked(e.target.files, "primary")}
              />
              <button
                type="button"
                className="cc-btn cc-btn--outline cc-doc-select-btn"
                onClick={onFileTrigger}
              >
                Select files
              </button>
            </div>

            <DocErrorList messages={errors.primary} />

            <div className="cc-doc-secondary">
              <div className="cc-doc-secondary__col">
                <button
                  type="button"
                  className={`cc-drop cc-drop--compact${
                    errors.lab.length > 0 ? " is-error" : ""
                  }`}
                  onClick={() => labInputRef.current?.click()}
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
                  <span className="cc-drop__hint">{ACCEPTED_DOC_LABEL}</span>
                </button>
                <input
                  ref={labInputRef}
                  type="file"
                  multiple
                  accept={ACCEPTED_DOC_ACCEPT}
                  className="cc-file-input"
                  onChange={(e) => onFilesPicked(e.target.files, "lab")}
                />
                <DocErrorList messages={errors.lab} />
              </div>
              <div className="cc-doc-secondary__col">
                <button
                  type="button"
                  className={`cc-drop cc-drop--compact${
                    errors.other.length > 0 ? " is-error" : ""
                  }`}
                  onClick={() => otherInputRef.current?.click()}
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
                <input
                  ref={otherInputRef}
                  type="file"
                  multiple
                  accept={ACCEPTED_DOC_ACCEPT}
                  className="cc-file-input"
                  onChange={(e) => onFilesPicked(e.target.files, "other")}
                />
                <DocErrorList messages={errors.other} />
              </div>
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

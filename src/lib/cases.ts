// Types + small helpers for the pcp_cases collection. Matches the contract
// in docs/create-case-schema.md.

import { randomBytes } from "crypto";

import { ageFromDob } from "@/lib/age";
import { getDocument, listDocuments, nowIso, upsertDocument } from "@/lib/firestore-rest";

export { ageFromDob };

export const PCP_CASES_COLLECTION = "pcp_cases";

// GI specialists publish reports into this collection (from the GI portal),
// keyed back to a pcp_cases doc via `case_id`. Defined here (rather than
// imported from gi-reports.ts) to avoid a circular import.
const GI_SHARED_REPORTS_COLLECTION = "gi_shared_reports";

export type CaseStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "completed"
  | "closed";

export type GenderEnum =
  | "female"
  | "male"
  | "non_binary"
  | "prefer_not_to_say"
  | "other";

export type UrgencyLevel = "routine" | "urgent" | "emergency";

export const GENDER_VALUES: GenderEnum[] = [
  "female",
  "male",
  "non_binary",
  "prefer_not_to_say",
  "other",
];

export const URGENCY_VALUES: UrgencyLevel[] = ["routine", "urgent", "emergency"];

export type InsuranceCardRef = {
  fileId: string;
  storagePath: string;
  uploadedAt: string;
};

export type CaseRootDoc = {
  ownerUserId: string;
  status: CaseStatus;
  currentStep: 1 | 2 | 3;
  title: string;
  shortCode: string;
  aboutComplete: boolean;
  healthComplete: boolean;
  documentsCount: number;
  submittedAt: string | null;
  sharedWithGiUserId: string | null;
  sharedWithGiUser: string | null;
  sharedWithGiAt: string | null;
  // Set when the PCP shares the case with a Medical Assistant (MA) from the
  // Cases page. MA staff live in the `admin_users` collection with role "ma".
  // Once shared with MA the case is locked from further editing.
  sharedWithMa: boolean;
  sharedWithMaAt: string | null;
  statusUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type CaseAboutDoc = {
  fullLegalName: string;
  gender: GenderEnum | null;
  dateOfBirth: string | null;
  address: string | null;
  state: string | null;
  mobile: string;
  email: string;
  insuranceCarrier: string | null;
  policyId: string | null;
  groupName: string | null;
  effectiveDate: string | null;
  insuranceCards: {
    front: InsuranceCardRef | null;
    back: InsuranceCardRef | null;
  };
  updatedAt: string;
  updatedByUserId: string;
};

export type CaseHealthDoc = {
  inboxMessage: string;
  bmi: string | null;
  allergies: string | null;
  currentMedications: string | null;
  existingConditions: string | null;
  pastSurgicalHistory: string | null;
  socialHistory: string | null;
  recentTestsOrProcedures: string | null;
  familyHistory: string | null;
  lifestyleNotes: string | null;
  primaryCarePhysician: string | null;
  pcpPhone: string | null;
  pcpFax: string | null;
  pharmacyInformation: string | null;
  pharmacyPhone: string | null;
  pharmacyFax: string | null;
  urgencyLevel: UrgencyLevel | null;
  updatedAt: string;
  updatedByUserId: string;
};

/**
 * Structured, AI-generated decision support persisted on the pcp_cases root doc
 * (field `aiSuggestions`) by the submit-time ai-summary pass. Intended to
 * pre-populate a GI specialist's "Clinical Diagnosis & Plan" form. All values
 * are suggestions for a clinician to confirm — never a prescription.
 */
/** One "Current Medications" row in the GI plan form. */
export type CaseAiSuggestionMedication = {
  name: string;
  dosage: string;
  frequency: string;
};

/** One alternative diagnosis considered, ranked most-likely first. */
export type CaseAiSuggestionDifferential = {
  /** Condition name, e.g. "Peptic ulcer disease". */
  condition: string;
  /** ICD-10-CM code for the condition, e.g. "K27.9". "" when not confident. */
  icdCode: string;
  /** One short line on what in the intake supports or argues against it. */
  rationale: string;
};

/**
 * Maps 1:1 to the controls of the GI "Clinical Diagnosis & Plan" workspace so
 * the stored value can pre-populate it directly. Every value is decision support
 * for a clinician to confirm — never a prescription.
 */
export type CaseAiSuggestions = {
  /** "Edit Diagnosis" textarea — working impression with its ICD-10-CM code(s). */
  diagnosis: string;
  /** Alternative diagnoses considered, most likely first, each with an ICD-10 code. */
  differentialDiagnosis: CaseAiSuggestionDifferential[];
  /** "Assessment & Plan Files" checkboxes — selected catalog ids. */
  files: number[];
  /** "Additional treatment notes" textarea (under the file list). */
  treatmentNotes: string;
  /** "Recommend Tests" checkboxes — slug ids from the test catalog. */
  tests: string[];
  /** "Recommended Procedures" checkboxes — slug ids from the procedure catalog. */
  procedures: string[];
  /** "Current Medications" rows. */
  medications: CaseAiSuggestionMedication[];
  /** When this suggestion set was generated (ISO). */
  generatedAt: string;
};

/** Firestore push-id-style 20-char id (timestamp prefix + random). */
export function generateCaseId(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  // 12 chars of randomness is plenty for our scale; we prefix with a
  // millisecond timestamp encoded in base64url to keep ids sortable by time.
  const ms = Date.now();
  const buf = randomBytes(9); // 9 bytes → 12 base64url chars
  let prefix = "";
  let n = ms;
  for (let i = 0; i < 8; i++) {
    prefix = alphabet[n & 63] + prefix;
    n = Math.floor(n / 64);
  }
  const suffix = buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
    .slice(0, 12);
  return (prefix + suffix).slice(0, 20);
}

/** REQ-##### display id, generated client-side and stored on the case. */
export function generateShortCode(): string {
  const n = Math.floor(10000 + Math.random() * 90000);
  return `REQ-${n}`;
}

/** Throws if the case isn't owned by `userId`. Returns the case data. */
export async function readCaseOwnedBy(
  caseId: string,
  userId: string
): Promise<CaseRootDoc> {
  const doc = await getDocument(PCP_CASES_COLLECTION, caseId);
  if (!doc) {
    const err = new Error(`Case ${caseId} not found.`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (err as any).status = 404;
    throw err;
  }
  const data = doc.data as Partial<CaseRootDoc>;
  if (data.ownerUserId !== userId) {
    const err = new Error("You do not have access to this case.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (err as any).status = 403;
    throw err;
  }
  return data as CaseRootDoc;
}

export function countCompleteAbout(about: Partial<CaseAboutDoc>): {
  filled: number;
  required: number;
  complete: boolean;
} {
  // Required (the whole "About you" section): fullLegalName, dateOfBirth,
  // gender, state, address, mobile, email. (7) Age is derived from dateOfBirth.
  // Optional but counted when present: insuranceCarrier, policyId, groupName,
  // effectiveDate, insuranceCards. (5)
  const requiredOk =
    !!about.fullLegalName &&
    !!about.dateOfBirth &&
    !!about.gender &&
    !!about.state &&
    !!about.address &&
    !!about.mobile &&
    !!about.email;
  const filledOptional = [
    about.insuranceCarrier,
    about.policyId,
    about.groupName,
    about.effectiveDate,
    about.insuranceCards?.front || about.insuranceCards?.back ? "x" : null,
  ].filter((v) => v).length;
  const filled = (requiredOk ? 7 : 0) + filledOptional;
  return { filled, required: 7, complete: requiredOk };
}

export function countCompleteHealth(health: Partial<CaseHealthDoc>): {
  complete: boolean;
} {
  // Required: inboxMessage, urgencyLevel.
  return {
    complete: !!health.inboxMessage && !!health.urgencyLevel,
  };
}

/**
 * Reads the `aiSuggestions` map off a case root doc into the typed shape, or
 * null when absent/malformed. Tolerant of partial data — an older or partially
 * written doc yields sensible empties rather than throwing.
 */
export function parseAiSuggestions(raw: unknown): CaseAiSuggestions | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const diagnosis = typeof obj.diagnosis === "string" ? obj.diagnosis : "";
  const treatmentNotes = typeof obj.treatmentNotes === "string" ? obj.treatmentNotes : "";
  const files = Array.isArray(obj.files)
    ? obj.files.filter((n): n is number => typeof n === "number")
    : [];
  const tests = Array.isArray(obj.tests)
    ? obj.tests.filter((t): t is string => typeof t === "string")
    : [];
  const procedures = Array.isArray(obj.procedures)
    ? obj.procedures.filter((p): p is string => typeof p === "string")
    : [];
  const medications = Array.isArray(obj.medications)
    ? obj.medications.flatMap((m) => {
        if (!m || typeof m !== "object") return [];
        const med = m as Record<string, unknown>;
        const name = typeof med.name === "string" ? med.name : "";
        if (!name) return [];
        return [
          {
            name,
            dosage: typeof med.dosage === "string" ? med.dosage : "",
            frequency: typeof med.frequency === "string" ? med.frequency : "",
          },
        ];
      })
    : [];
  const differentialDiagnosis = Array.isArray(obj.differentialDiagnosis)
    ? obj.differentialDiagnosis.flatMap((d) => {
        if (!d || typeof d !== "object") return [];
        const dx = d as Record<string, unknown>;
        const condition = typeof dx.condition === "string" ? dx.condition : "";
        if (!condition) return [];
        return [
          {
            condition,
            icdCode: typeof dx.icdCode === "string" ? dx.icdCode : "",
            rationale: typeof dx.rationale === "string" ? dx.rationale : "",
          },
        ];
      })
    : [];
  const generatedAt = typeof obj.generatedAt === "string" ? obj.generatedAt : "";
  // Nothing meaningful captured → treat as no suggestions.
  if (
    !diagnosis &&
    !treatmentNotes &&
    !files.length &&
    !tests.length &&
    !procedures.length &&
    !medications.length &&
    !differentialDiagnosis.length
  ) {
    return null;
  }
  return {
    diagnosis,
    differentialDiagnosis,
    files,
    treatmentNotes,
    tests,
    procedures,
    medications,
    generatedAt,
  };
}

export function deriveCaseTitle(opts: {
  fullLegalName?: string | null;
  inboxMessage?: string | null;
  fallback: string;
}): string {
  const name = (opts.fullLegalName || "").trim();
  const summary = (opts.inboxMessage || "").trim().split(/\s+/).slice(0, 6).join(" ");
  if (name && summary) return `${name} · ${summary}`.slice(0, 120);
  if (name) return name.slice(0, 120);
  if (summary) return summary.slice(0, 120);
  return opts.fallback;
}

// -------------------- UI-shaped list loader --------------------

export type CaseListPillVariant =
  | "amber"
  | "rose"
  | "sky"
  | "slate"
  | "emerald";

/**
 * UI-shaped case row used by the /cases page. Mirrors the existing
 * `CaseRecord` in `src/app/(dashboard)/_components/cases-data.ts` so we can
 * swap the mock data in place.
 */
export type CaseListItem = {
  id: string;
  name: string;
  initials: string;
  mrn: string;
  demo: string;
  dob: string;
  status: string;
  statusVariant: CaseListPillVariant;
  updated: string;
  shortUpdated: string;
  // Raw ISO of the last update, so the UI can render it in the viewer's local
  // time zone (the `updated`/`shortUpdated` strings are server-formatted).
  updatedAtIso: string;
  condition: string;
  aiFirstSummary: string;
  // The patient's full Health inbox message (Step 2 of create-case), shown as
  // "Summary to inbox" in the report modal. Empty string when none.
  inboxMessage: string;
  avatarBg: string;
  // Full About fields — used by the /cases "View Report" modal. Missing
  // values render as "—".
  email: string;
  phone: string;
  address: string;
  insuranceCarrier: string;
  policyId: string;
  groupName: string;
  effectiveDate: string;
  // Raw root fields — used by the "Where things stand" timeline so it can
  // reflect the real case state instead of hardcoded values.
  rawStatus: CaseStatus;
  createdAtIso: string;
  submittedAtIso: string | null;
  sharedWithGiUser: string | null;
  sharedWithGiAtIso: string | null;
  // True once the case has been shared with a Medical Assistant (MA). Drives the
  // "Shared With MA" button state, the display status, and the edit lock.
  sharedWithMa: boolean;
  sharedWithMaAtIso: string | null;
  statusUpdatedAtIso: string;
  documentsCount: number;
  // True when a GI specialist has published a report for this case
  // (a gi_shared_reports doc exists). Drives the "Final disposition" status
  // + the highlighted tile on the Cases page.
  hasFinalReport: boolean;
  // Gemini-generated clinical summary for the report modal (null until first
  // generation). aiFirstSummary is kept as a quick fallback truncation of the
  // inbox message.
  aiSummary: string | null;
  aiSummaryGeneratedAtIso: string | null;
  // Gemini-generated, structured decision-support suggestions produced at submit
  // time (provisional diagnosis, medications, and Assessment & Plan Files picked
  // from the catalog). Meant to pre-populate a GI specialist's plan form. Null
  // until generated. See CaseAiSuggestions.
  aiSuggestions: CaseAiSuggestions | null;
  // Raw About values (empty string when missing) for in-place editing in the
  // report modal — distinct from the "—"-padded display fields above.
  editable: {
    fullLegalName: string;
    gender: GenderEnum | "";
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
  // Raw Health (Step 2) values for the report modal's editable Health section.
  health: {
    inboxMessage: string;
    bmi: string;
    allergies: string;
    currentMedications: string;
    existingConditions: string;
    pastSurgicalHistory: string;
    socialHistory: string;
    recentTestsOrProcedures: string;
    familyHistory: string;
    lifestyleNotes: string;
    primaryCarePhysician: string;
    pcpPhone: string;
    pcpFax: string;
    pharmacyInformation: string;
    pharmacyPhone: string;
    pharmacyFax: string;
    urgencyLevel: UrgencyLevel | "";
  };
};

const AVATAR_GRADIENTS = [
  "linear-gradient(145deg, #6366f1 0%, #4338ca 45%, #024d9c 100%)",
  "linear-gradient(145deg, #0ea5e9 0%, #0369a1 50%, #1e3a8a 100%)",
  "linear-gradient(145deg, #14b8a6 0%, #0d9488 45%, #0369a1 100%)",
  "linear-gradient(145deg, #f97316 0%, #ea580c 40%, #b91c1c 100%)",
  "linear-gradient(145deg, #a855f7 0%, #7c3aed 45%, #4f46e5 100%)",
  "linear-gradient(145deg, #06b6d4 0%, #0891b2 45%, #155e75 100%)",
];

const STATUS_DISPLAY: Record<
  CaseStatus,
  { label: string; variant: CaseListPillVariant; condition: string }
> = {
  draft: { label: "Draft", variant: "slate", condition: "Draft" },
  submitted: { label: "Pending review", variant: "amber", condition: "Active case" },
  under_review: { label: "In review", variant: "sky", condition: "Active case" },
  completed: { label: "Completed", variant: "emerald", condition: "Closed" },
  closed: { label: "Closed", variant: "slate", condition: "Closed" },
};

const GENDER_DISPLAY: Record<GenderEnum, string> = {
  female: "Female",
  male: "Male",
  non_binary: "Non-binary",
  prefer_not_to_say: "Prefer not to say",
  other: "Other",
};

function pickAvatar(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

function deriveInitials(name: string, fallback: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (cleaned) {
    const parts = cleaned.split(" ");
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? "";
    const initials = (first + last).toUpperCase();
    if (initials) return initials;
  }
  return (fallback.trim()[0] || "?").toUpperCase();
}

function formatUpdated(iso: string): { full: string; short: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { full: "—", short: "—" };
  const month = d.toLocaleDateString(undefined, { month: "short" });
  const day = d.getDate();
  const year = d.getFullYear();
  return {
    full: `Updated ${month} ${day}, ${year}`,
    short: `${month} ${day}`,
  };
}

/**
 * Returns the set of pcp_cases ids that have at least one GI-published report
 * (a gi_shared_reports doc whose `case_id` points at them). Best-effort: a
 * missing collection or query error yields an empty set rather than throwing.
 */
export async function listCaseIdsWithSharedReports(): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const page = await listDocuments(GI_SHARED_REPORTS_COLLECTION, { pageSize: 500 });
    for (const d of page.docs) {
      if (d.id.startsWith("_")) continue;
      const caseId = typeof d.data.case_id === "string" ? d.data.case_id : "";
      if (caseId) set.add(caseId);
    }
  } catch (err) {
    console.error("[cases] listCaseIdsWithSharedReports failed:", err);
  }
  return set;
}

/**
 * Loads the full UI-shaped case list for the given owner. Joins each case's
 * `about/data` and `health/data` subcollection docs so the patient header and
 * AI summary fields are populated. Sorted by createdAt desc.
 */
export async function loadCasesForOwner(
  userId: string,
  opts: { limit?: number } = {}
): Promise<CaseListItem[]> {
  const [page, reportCaseIds] = await Promise.all([
    listDocuments(PCP_CASES_COLLECTION, { pageSize: 200 }),
    listCaseIdsWithSharedReports(),
  ]);
  const owned = page.docs
    .filter((d) => !d.id.startsWith("_"))
    .filter((d) => d.data.ownerUserId === userId)
    .sort((a, b) =>
      String(b.data.createdAt ?? "").localeCompare(String(a.data.createdAt ?? ""))
    )
    .slice(0, opts.limit ?? 100);

  return Promise.all(
    owned.map(async (root) => {
      const [aboutDoc, healthDoc] = await Promise.all([
        getDocument(`${PCP_CASES_COLLECTION}/${root.id}/about`, "data"),
        getDocument(`${PCP_CASES_COLLECTION}/${root.id}/health`, "data"),
      ]);

      const about = (aboutDoc?.data ?? {}) as Partial<CaseAboutDoc>;
      const health = (healthDoc?.data ?? {}) as Partial<CaseHealthDoc>;
      // Raw view for reading legacy fields no longer on CaseHealthDoc (the
      // pre-split combined `pcpPhoneFax`/`pharmacyPhoneFax`).
      const healthRaw = (healthDoc?.data ?? {}) as Record<string, unknown>;

      const storedStatus: CaseStatus =
        (typeof root.data.status === "string" ? (root.data.status as CaseStatus) : "draft") ||
        "draft";

      // When a GI specialist shares a report back to the PCP (a
      // gi_shared_reports doc exists for this case), the case is considered
      // done — move it to "completed". We persist the transition so dashboard
      // counts and later loads see it without re-reading the GI collection.
      // Cases already "completed" or "closed" are left as-is.
      const hasFinalReport = reportCaseIds.has(root.id);
      let status: CaseStatus = storedStatus;
      if (hasFinalReport && storedStatus !== "completed" && storedStatus !== "closed") {
        status = "completed";
        const now = nowIso();
        void upsertDocument(PCP_CASES_COLLECTION, root.id, {
          status: "completed",
          statusUpdatedAt: now,
          updatedAt: now,
        }).catch((err) =>
          console.error(`[cases] shared-report complete reconcile failed for ${root.id}:`, err)
        );
      }

      const sharedWithMa = root.data.sharedWithMa === true;
      const sharedWithMaAtIso =
        typeof root.data.sharedWithMaAt === "string" ? root.data.sharedWithMaAt : null;

      const display = STATUS_DISPLAY[status] ?? STATUS_DISPLAY.draft;
      let statusLabel = display.label;
      let statusVariant = display.variant;
      // Once shared with MA (and before the case is completed/closed) the pill
      // reflects that hand-off instead of the plain "Pending review".
      if (sharedWithMa && status !== "completed" && status !== "closed") {
        statusLabel = "Shared with MA";
        statusVariant = "sky";
      }

      const fallbackEmail =
        typeof about.email === "string" ? about.email : "";
      const name =
        typeof about.fullLegalName === "string" && about.fullLegalName.trim()
          ? about.fullLegalName
          : fallbackEmail.split("@")[0] || "Untitled case";
      const initials = deriveInitials(name, fallbackEmail);

      const updatedIso =
        typeof root.data.updatedAt === "string"
          ? root.data.updatedAt
          : typeof root.data.createdAt === "string"
            ? root.data.createdAt
            : new Date().toISOString();
      const updated = formatUpdated(updatedIso);

      const ageVal = ageFromDob(about.dateOfBirth ?? null);
      const ageBit = ageVal != null ? `${ageVal} yrs` : null;
      const genderBit = about.gender ? GENDER_DISPLAY[about.gender] : null;
      const demo = [ageBit, genderBit].filter(Boolean).join(" • ");

      const inbox =
        typeof health.inboxMessage === "string" ? health.inboxMessage : "";
      const aiFirstSummary = inbox.trim()
        ? inbox.trim().slice(0, 240)
        : "No symptom summary captured yet.";

      const shortCode =
        typeof root.data.shortCode === "string" ? root.data.shortCode : root.id;

      const orDash = (v: unknown) =>
        typeof v === "string" && v.trim() ? v.trim() : "—";

      const createdAtIso =
        typeof root.data.createdAt === "string" ? root.data.createdAt : updatedIso;
      const submittedAtIso =
        typeof root.data.submittedAt === "string" ? root.data.submittedAt : null;
      const sharedWithGiUser =
        typeof root.data.sharedWithGiUser === "string" && root.data.sharedWithGiUser
          ? root.data.sharedWithGiUser
          : null;
      const sharedWithGiAtIso =
        typeof root.data.sharedWithGiAt === "string" ? root.data.sharedWithGiAt : null;
      const statusUpdatedAtIso =
        typeof root.data.statusUpdatedAt === "string"
          ? root.data.statusUpdatedAt
          : updatedIso;
      const documentsCount =
        typeof root.data.documentsCount === "number" ? root.data.documentsCount : 0;
      const aiSummary =
        typeof root.data.aiSummary === "string" && root.data.aiSummary
          ? root.data.aiSummary
          : null;
      const aiSummaryGeneratedAtIso =
        typeof root.data.aiSummaryGeneratedAt === "string"
          ? root.data.aiSummaryGeneratedAt
          : null;
      const aiSuggestions = parseAiSuggestions(root.data.aiSuggestions);

      return {
        id: root.id,
        name,
        initials,
        mrn: `#${shortCode}`,
        demo: demo || "—",
        dob: orDash(about.dateOfBirth),
        status: statusLabel,
        statusVariant,
        updated: updated.full,
        shortUpdated: updated.short,
        updatedAtIso: updatedIso,
        condition: display.condition,
        aiFirstSummary,
        inboxMessage: inbox,
        avatarBg: pickAvatar(root.id),
        email: orDash(about.email),
        phone: orDash(about.mobile),
        address: orDash(about.address),
        insuranceCarrier: orDash(about.insuranceCarrier),
        policyId: orDash(about.policyId),
        groupName: orDash(about.groupName),
        effectiveDate: orDash(about.effectiveDate),
        rawStatus: status,
        createdAtIso,
        submittedAtIso,
        sharedWithGiUser,
        sharedWithGiAtIso,
        sharedWithMa,
        sharedWithMaAtIso,
        statusUpdatedAtIso,
        documentsCount,
        hasFinalReport,
        aiSummary,
        aiSummaryGeneratedAtIso,
        aiSuggestions,
        editable: {
          fullLegalName: typeof about.fullLegalName === "string" ? about.fullLegalName : "",
          gender: (about.gender as GenderEnum) ?? "",
          dateOfBirth: typeof about.dateOfBirth === "string" ? about.dateOfBirth : "",
          address: typeof about.address === "string" ? about.address : "",
          state: typeof about.state === "string" ? about.state : "",
          mobile: typeof about.mobile === "string" ? about.mobile : "",
          email: typeof about.email === "string" ? about.email : "",
          insuranceCarrier:
            typeof about.insuranceCarrier === "string" ? about.insuranceCarrier : "",
          policyId: typeof about.policyId === "string" ? about.policyId : "",
          groupName: typeof about.groupName === "string" ? about.groupName : "",
          effectiveDate: typeof about.effectiveDate === "string" ? about.effectiveDate : "",
        },
        health: {
          inboxMessage: typeof health.inboxMessage === "string" ? health.inboxMessage : "",
          bmi: typeof health.bmi === "string" ? health.bmi : "",
          allergies: typeof health.allergies === "string" ? health.allergies : "",
          currentMedications:
            typeof health.currentMedications === "string" ? health.currentMedications : "",
          existingConditions:
            typeof health.existingConditions === "string" ? health.existingConditions : "",
          pastSurgicalHistory:
            typeof health.pastSurgicalHistory === "string" ? health.pastSurgicalHistory : "",
          socialHistory:
            typeof health.socialHistory === "string" ? health.socialHistory : "",
          recentTestsOrProcedures:
            typeof health.recentTestsOrProcedures === "string"
              ? health.recentTestsOrProcedures
              : "",
          familyHistory: typeof health.familyHistory === "string" ? health.familyHistory : "",
          lifestyleNotes: typeof health.lifestyleNotes === "string" ? health.lifestyleNotes : "",
          primaryCarePhysician:
            typeof health.primaryCarePhysician === "string" ? health.primaryCarePhysician : "",
          // Legacy fallback: cases saved before the phone/fax split kept both in a
          // single `pcpPhoneFax`/`pharmacyPhoneFax` string — surface that under Phone.
          pcpPhone:
            typeof health.pcpPhone === "string"
              ? health.pcpPhone
              : typeof healthRaw.pcpPhoneFax === "string"
                ? healthRaw.pcpPhoneFax
                : "",
          pcpFax: typeof health.pcpFax === "string" ? health.pcpFax : "",
          pharmacyInformation:
            typeof health.pharmacyInformation === "string" ? health.pharmacyInformation : "",
          pharmacyPhone:
            typeof health.pharmacyPhone === "string"
              ? health.pharmacyPhone
              : typeof healthRaw.pharmacyPhoneFax === "string"
                ? healthRaw.pharmacyPhoneFax
                : "",
          pharmacyFax: typeof health.pharmacyFax === "string" ? health.pharmacyFax : "",
          urgencyLevel: (health.urgencyLevel as UrgencyLevel) ?? "",
        },
      };
    })
  );
}

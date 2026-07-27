// Reports authored by GI specialists and shared back to a PCP case.
//
//   gi_medical_reports/{fileId}    — uploaded files (PDFs, scans, ...)
//      └─ reports_id = the GI portal's case/report grouping id
//   gi_shared_reports/{shareId}    — the share record itself
//      ├─ case_id            = pcp_cases doc id (join key)
//      ├─ medical_report_ids = string[] of gi_medical_reports doc ids
//      └─ clinical_summary, recommendations, ai_insight, …
//
// The PCP's reports page lists every `gi_shared_reports` whose `case_id`
// resolves to a `pcp_cases` doc that the current PCP owns.

import {
  groupAssessmentPlanFileIds,
  type AssessmentPlanFileGroup,
} from "@/lib/assessment-plan-catalog";
import { PCP_CASES_COLLECTION } from "@/lib/cases";
import { getDocument, listDocuments } from "@/lib/firestore-rest";

export type { AssessmentPlanFileGroup };

export const GI_MEDICAL_REPORTS_COLLECTION = "gi_medical_reports";
export const GI_SHARED_REPORTS_COLLECTION = "gi_shared_reports";
// GI specialists live in `gi_users`; older/admin-created ones in `admin_users`.
// Both may carry a `signatureUrl` (a base64 data: URI of the e-signature image),
// keyed by the same id the report stores as `gi_specialist_id`.
const GI_USERS_COLLECTION = "gi_users";
const ADMIN_USERS_COLLECTION = "admin_users";

export type GiMedicalFile = {
  id: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  docType: string;
  docUrl: string;
  docSummary: string | null;
  uploadedBy: string;
  uploadedByName: string;
  createdAt: string;
};

export type GiSharedReport = {
  id: string;
  caseId: string;             // pcp_cases doc id
  caseShortCode: string;      // denormalized for display (e.g. "REQ-12345")
  reportName: string;
  status: string;
  source: string | null;
  sharedAt: string;
  createdAt: string;
  // Patient demographic snapshot at share time.
  patientName: string;
  dateOfBirth: string | null;
  gender: string | null;
  email: string | null;
  phone: string | null;
  // Patient's current medications, entered by the PCP on the case (Health step).
  // Empty string when none.
  currentMedications: string;
  // Insurance snapshot.
  insuranceCarrier: string | null;
  insurancePolicyId: string | null;
  insuranceGroup: string | null;
  insuranceEffectiveDate: string | null;
  // Full patient intake the PCP captured in "Create New Case" (About + Health
  // steps). Surfaced in the report preview so the whole case record is visible
  // in one place. Each is null when the PCP left it blank.
  address: string | null;
  state: string | null;
  bmi: string | null;
  allergies: string | null;
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
  // GI specialist.
  giSpecialistId: string;
  giSpecialistName: string;
  // The GI specialist's e-signature image as a base64 data: URI (from their
  // gi_users/admin_users `signatureUrl`), or null when they have none on file.
  giSpecialistSignatureUrl: string | null;
  // Clinical content.
  clinicalSummary: string;
  aiInsight: string;
  giSpecialistPlan: string | null;
  recommendations: string[];
  // `recommendations` split by the GI portal's prefixes ("Order:" → tests,
  // "Procedure:" → procedures, "Medication:" → medications). Lines with any
  // other / no recognized prefix fall into `other`.
  recommendedTests: string[];
  recommendedProcedures: string[];
  medications: string[];
  otherRecommendations: string[];
  // "Assessment & Plan Files" the GI specialist selected, grouped by category
  // (Labs / Imaging / Procedure / Diet & Lifestyle). Empty when none.
  assessmentPlanFiles: AssessmentPlanFileGroup[];
  // GI specialist's "Clinical Diagnosis & Plan" (gi_specialist_plan.diagnosis_text)
  // and free-text treatment notes. Empty string when not provided.
  clinicalDiagnosis: string;
  treatmentNotes: string;
  presentingSymptoms: string;
  priorityScore: string;
  // Number of remarks/comments on this report (PCP + GI). Drives the
  // "New Remark" / "None" badge in the reports table.
  remarkCount: number;
  // Attached medical files (resolved from medical_report_ids).
  medicalFiles: GiMedicalFile[];
};

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function strOrEmpty(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

export type CategorizedRecommendations = {
  tests: string[];
  procedures: string[];
  medications: string[];
  other: string[];
};

/** Reads a trimmed string field off the (map-shaped) gi_specialist_plan value. */
function planString(plan: unknown, key: string): string {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return "";
  const v = (plan as Record<string, unknown>)[key];
  return typeof v === "string" ? v.trim() : "";
}

/** Pulls the selected note-file ids off a (possibly map-shaped) plan value. */
function extractSelectedFileIds(plan: unknown): number[] {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return [];
  const raw = (plan as Record<string, unknown>).selected_final_note_file_ids;
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const v of raw) {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Maps a (map-shaped) gi_specialist_plan's selected file ids to label groups. */
export function groupAssessmentPlanFiles(plan: unknown): AssessmentPlanFileGroup[] {
  return groupAssessmentPlanFileIds(extractSelectedFileIds(plan));
}

/**
 * Splits the GI portal's flat `recommendations` array into groups by its
 * line prefix. The GI portal encodes structured picks as `"Order: <test>"`,
 * `"Procedure: <name>"`, and `"Medication: <name>"`; free-text care-plan lines
 * (e.g. `"Dietary Intervention: …"`) keep their full text under `other`.
 * Prefix-only lines with an empty value (e.g. `"Medication: "`) are dropped.
 */
export function categorizeRecommendations(items: string[]): CategorizedRecommendations {
  const tests: string[] = [];
  const procedures: string[] = [];
  const medications: string[] = [];
  const other: string[] = [];
  for (const raw of items) {
    const item = (raw ?? "").trim();
    if (!item) continue;
    const m = item.match(/^([A-Za-z]+):\s*(.*)$/);
    const label = m ? m[1].toLowerCase() : "";
    const value = m ? m[2].trim() : "";
    if (label === "order") {
      if (value) tests.push(value);
    } else if (label === "procedure") {
      if (value) procedures.push(value);
    } else if (label === "medication") {
      if (value) medications.push(value);
    } else {
      other.push(item);
    }
  }
  return { tests, procedures, medications, other };
}

function parseMedicalFile(id: string, data: Record<string, unknown>): GiMedicalFile {
  return {
    id,
    fileName: strOrEmpty(data.file_name) || "(unnamed)",
    contentType: strOrEmpty(data.content_type) || "application/octet-stream",
    fileSize: typeof data.file_size === "number" ? data.file_size : 0,
    docType: strOrEmpty(data.doc_type) || "other_report",
    docUrl: strOrEmpty(data.doc_url),
    docSummary: strOrNull(data.doc_summary),
    uploadedBy: strOrEmpty(data.uploaded_by),
    uploadedByName: strOrEmpty(data.uploaded_by_name),
    createdAt: strOrEmpty(data.created_at),
  };
}

// The PCP's own case intake (About + Health steps), read from the case's
// subcollection docs. Preferred over the GI portal's snapshot so the report
// matches what the PCP entered in "Create New Case".
type CaseIntake = {
  fullLegalName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  address: string | null;
  state: string | null;
  mobile: string | null;
  email: string | null;
  insuranceCarrier: string | null;
  policyId: string | null;
  groupName: string | null;
  effectiveDate: string | null;
  presentingSymptoms: string | null;
  currentMedications: string | null;
  bmi: string | null;
  allergies: string | null;
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
};

const EMPTY_INTAKE: CaseIntake = {
  fullLegalName: null,
  dateOfBirth: null,
  gender: null,
  address: null,
  state: null,
  mobile: null,
  email: null,
  insuranceCarrier: null,
  policyId: null,
  groupName: null,
  effectiveDate: null,
  presentingSymptoms: null,
  currentMedications: null,
  bmi: null,
  allergies: null,
  existingConditions: null,
  pastSurgicalHistory: null,
  socialHistory: null,
  recentTestsOrProcedures: null,
  familyHistory: null,
  lifestyleNotes: null,
  primaryCarePhysician: null,
  pcpPhone: null,
  pcpFax: null,
  pharmacyInformation: null,
  pharmacyPhone: null,
  pharmacyFax: null,
};

/**
 * Resolves a GI specialist's e-signature image (a base64 data: URI) by id,
 * checking `gi_users` first, then `admin_users`. Returns null when the id is
 * empty, the user is missing, or they have no signature on file. Best-effort:
 * a lookup error yields null rather than throwing.
 */
async function fetchGiSignatureUrl(giSpecialistId: string): Promise<string | null> {
  if (!giSpecialistId) return null;
  for (const coll of [GI_USERS_COLLECTION, ADMIN_USERS_COLLECTION]) {
    try {
      const doc = await getDocument(coll, giSpecialistId);
      const url =
        doc && typeof doc.data.signatureUrl === "string" ? doc.data.signatureUrl.trim() : "";
      if (url) return url;
    } catch {
      // ignore and try the next collection
    }
  }
  return null;
}

function parseSharedReport(
  id: string,
  data: Record<string, unknown>,
  caseInfo: CaseIntake & { shortCode: string },
  medicalFiles: GiMedicalFile[],
  remarkCount: number,
  giSpecialistSignatureUrl: string | null
): GiSharedReport {
  // Prefer the PCP case's own About data so the report matches what the
  // Cases page shows; fall back to the GI portal's snapshot fields.
  const patientName =
    caseInfo.fullLegalName || strOrNull(data.patient_name) || "—";
  const dateOfBirth = caseInfo.dateOfBirth || strOrNull(data.date_of_birth);
  // Show the complete symptoms the PCP entered (the case's Health inbox
  // message), not the GI portal's possibly-truncated snapshot.
  const presentingSymptoms =
    caseInfo.presentingSymptoms || strOrEmpty(data.presenting_symptoms);
  const recommendationList = strArray(data.recommendations);
  const categorized = categorizeRecommendations(recommendationList);
  const assessmentPlanFiles = groupAssessmentPlanFiles(data.gi_specialist_plan);
  const clinicalDiagnosis = planString(data.gi_specialist_plan, "diagnosis_text");
  const treatmentNotes = planString(data.gi_specialist_plan, "treatment_notes");
  return {
    id,
    caseId: strOrEmpty(data.case_id),
    caseShortCode: caseInfo.shortCode,
    reportName: strOrEmpty(data.report_name) || "GI Specialist Report",
    status: strOrEmpty(data.status) || "Finalized",
    source: strOrNull(data.source),
    sharedAt: strOrEmpty(data.shared_at) || strOrEmpty(data.created_at),
    createdAt: strOrEmpty(data.created_at),
    patientName,
    dateOfBirth,
    gender: caseInfo.gender || strOrNull(data.gender),
    email: caseInfo.email || strOrNull(data.email),
    phone: caseInfo.mobile || strOrNull(data.phone),
    currentMedications: caseInfo.currentMedications || "",
    insuranceCarrier: caseInfo.insuranceCarrier || strOrNull(data.insurance_carrier),
    insurancePolicyId: caseInfo.policyId || strOrNull(data.insurance_policy_id),
    insuranceGroup: caseInfo.groupName || strOrNull(data.insurance_group),
    insuranceEffectiveDate: caseInfo.effectiveDate,
    address: caseInfo.address,
    state: caseInfo.state,
    bmi: caseInfo.bmi,
    allergies: caseInfo.allergies,
    existingConditions: caseInfo.existingConditions,
    pastSurgicalHistory: caseInfo.pastSurgicalHistory,
    socialHistory: caseInfo.socialHistory,
    recentTestsOrProcedures: caseInfo.recentTestsOrProcedures,
    familyHistory: caseInfo.familyHistory,
    lifestyleNotes: caseInfo.lifestyleNotes,
    primaryCarePhysician: caseInfo.primaryCarePhysician,
    pcpPhone: caseInfo.pcpPhone,
    pcpFax: caseInfo.pcpFax,
    pharmacyInformation: caseInfo.pharmacyInformation,
    pharmacyPhone: caseInfo.pharmacyPhone,
    pharmacyFax: caseInfo.pharmacyFax,
    giSpecialistId: strOrEmpty(data.gi_specialist_id),
    giSpecialistName: strOrEmpty(data.gi_specialist_name) || "GI Specialist",
    giSpecialistSignatureUrl,
    clinicalSummary: strOrEmpty(data.clinical_summary),
    aiInsight: strOrEmpty(data.ai_insight),
    giSpecialistPlan: strOrNull(data.gi_specialist_plan),
    recommendations: recommendationList,
    recommendedTests: categorized.tests,
    recommendedProcedures: categorized.procedures,
    medications: categorized.medications,
    otherRecommendations: categorized.other,
    assessmentPlanFiles,
    clinicalDiagnosis,
    treatmentNotes,
    presentingSymptoms,
    priorityScore: strOrEmpty(data.priority_score) || "—",
    remarkCount,
    medicalFiles,
  };
}

/**
 * Loads every shared GI report for cases owned by the given PCP user, joined
 * with the case shortCode and the underlying medical files.
 */
export async function loadGiReportsForOwner(
  userId: string
): Promise<GiSharedReport[]> {
  const [casesPage, sharedPage, filesPage] = await Promise.all([
    listDocuments(PCP_CASES_COLLECTION, { pageSize: 500 }),
    listDocuments(GI_SHARED_REPORTS_COLLECTION, { pageSize: 500 }),
    listDocuments(GI_MEDICAL_REPORTS_COLLECTION, { pageSize: 500 }),
  ]);

  // Build caseId → shortCode for cases the current user owns.
  const ownedCases = new Map<string, string>();
  for (const c of casesPage.docs) {
    if (c.id.startsWith("_")) continue;
    if (c.data.ownerUserId !== userId) continue;
    const shortCode =
      typeof c.data.shortCode === "string" ? c.data.shortCode : c.id;
    ownedCases.set(c.id, shortCode);
  }

  // Build fileId → parsed medical file for quick lookup.
  const filesById = new Map<string, GiMedicalFile>();
  for (const f of filesPage.docs) {
    if (f.id.startsWith("_")) continue;
    filesById.set(f.id, parseMedicalFile(f.id, f.data));
  }

  // Only keep shared reports whose case_id resolves to a case this user owns.
  const matched = sharedPage.docs.filter((s) => {
    if (s.id.startsWith("_")) return false;
    const caseId = typeof s.data.case_id === "string" ? s.data.case_id : "";
    return caseId && ownedCases.has(caseId);
  });

  // Fetch the About + Health docs for each distinct matched case so the
  // report reflects the PCP's own data: patient name + DOB (from About) and
  // the complete presenting symptoms the PCP entered (Health inbox message).
  const distinctCaseIds = [
    ...new Set(matched.map((s) => String(s.data.case_id))),
  ];
  const aboutByCase = new Map<string, CaseIntake>();
  await Promise.all(
    distinctCaseIds.map(async (caseId) => {
      try {
        const [aboutDoc, healthDoc] = await Promise.all([
          getDocument(`${PCP_CASES_COLLECTION}/${caseId}/about`, "data"),
          getDocument(`${PCP_CASES_COLLECTION}/${caseId}/health`, "data"),
        ]);
        const about = (aboutDoc?.data ?? {}) as Record<string, unknown>;
        const health = (healthDoc?.data ?? {}) as Record<string, unknown>;
        aboutByCase.set(caseId, {
          fullLegalName: strOrNull(about.fullLegalName),
          dateOfBirth: strOrNull(about.dateOfBirth),
          gender: strOrNull(about.gender),
          address: strOrNull(about.address),
          state: strOrNull(about.state),
          mobile: strOrNull(about.mobile),
          email: strOrNull(about.email),
          insuranceCarrier: strOrNull(about.insuranceCarrier),
          policyId: strOrNull(about.policyId),
          groupName: strOrNull(about.groupName),
          effectiveDate: strOrNull(about.effectiveDate),
          presentingSymptoms: strOrNull(health.inboxMessage),
          currentMedications: strOrNull(health.currentMedications),
          bmi: strOrNull(health.bmi),
          allergies: strOrNull(health.allergies),
          existingConditions: strOrNull(health.existingConditions),
          pastSurgicalHistory: strOrNull(health.pastSurgicalHistory),
          socialHistory: strOrNull(health.socialHistory),
          recentTestsOrProcedures: strOrNull(health.recentTestsOrProcedures),
          familyHistory: strOrNull(health.familyHistory),
          lifestyleNotes: strOrNull(health.lifestyleNotes),
          primaryCarePhysician: strOrNull(health.primaryCarePhysician),
          // Legacy fallback: pre-split cases stored a combined phone+fax string.
          pcpPhone: strOrNull(health.pcpPhone) ?? strOrNull(health.pcpPhoneFax),
          pcpFax: strOrNull(health.pcpFax),
          pharmacyInformation: strOrNull(health.pharmacyInformation),
          pharmacyPhone:
            strOrNull(health.pharmacyPhone) ?? strOrNull(health.pharmacyPhoneFax),
          pharmacyFax: strOrNull(health.pharmacyFax),
        });
      } catch {
        aboutByCase.set(caseId, EMPTY_INTAKE);
      }
    })
  );

  // Count remarks per matched report (its `comments` subcollection) so the
  // table can show a "New Remark" / "None" badge without opening each report.
  const remarkCountByReport = new Map<string, number>();
  await Promise.all(
    matched.map(async (s) => {
      try {
        const page = await listDocuments(
          `${GI_SHARED_REPORTS_COLLECTION}/${s.id}/comments`,
          { pageSize: 200 }
        );
        remarkCountByReport.set(
          s.id,
          page.docs.filter((d) => !d.id.startsWith("_")).length
        );
      } catch {
        remarkCountByReport.set(s.id, 0);
      }
    })
  );

  // Resolve each distinct GI specialist's e-signature once, then reuse it across
  // all their reports (a PCP often has several reports from the same specialist).
  const distinctGiIds = [
    ...new Set(
      matched
        .map((s) => (typeof s.data.gi_specialist_id === "string" ? s.data.gi_specialist_id : ""))
        .filter(Boolean)
    ),
  ];
  const signatureByGiId = new Map<string, string | null>();
  await Promise.all(
    distinctGiIds.map(async (giId) => {
      signatureByGiId.set(giId, await fetchGiSignatureUrl(giId));
    })
  );

  const out: GiSharedReport[] = [];
  for (const s of matched) {
    const caseId = String(s.data.case_id);
    const about = aboutByCase.get(caseId) ?? EMPTY_INTAKE;

    const ids = strArray(s.data.medical_report_ids);
    const files = ids
      .map((id) => filesById.get(id))
      .filter((f): f is GiMedicalFile => Boolean(f));

    const giId =
      typeof s.data.gi_specialist_id === "string" ? s.data.gi_specialist_id : "";

    out.push(
      parseSharedReport(
        s.id,
        s.data,
        { ...about, shortCode: ownedCases.get(caseId)! },
        files,
        remarkCountByReport.get(s.id) ?? 0,
        signatureByGiId.get(giId) ?? null
      )
    );
  }

  // Newest shares first.
  out.sort((a, b) =>
    String(b.sharedAt ?? "").localeCompare(String(a.sharedAt ?? ""))
  );
  return out;
}

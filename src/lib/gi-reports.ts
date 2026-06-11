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

import { PCP_CASES_COLLECTION } from "@/lib/cases";
import { getDocument, listDocuments } from "@/lib/firestore-rest";

export const GI_MEDICAL_REPORTS_COLLECTION = "gi_medical_reports";
export const GI_SHARED_REPORTS_COLLECTION = "gi_shared_reports";

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
  // GI specialist.
  giSpecialistId: string;
  giSpecialistName: string;
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

export type AssessmentPlanFileGroup = { category: string; files: string[] };

// The GI portal stores the "Assessment & Plan Files" a specialist picks only as
// numeric ids on `gi_specialist_plan.selected_final_note_file_ids`. The id →
// label + category catalog lives in the GI portal source (AIGI:
// src/component/admin/viewpatient.js `fileCategories`); mirrored here so the PCP
// report can show the selected documents grouped the same way. Keep in sync if
// the GI portal's catalog changes.
const ASSESSMENT_PLAN_FILE_CATALOG: {
  category: string;
  files: { id: number; label: string }[];
}[] = [
  {
    category: "Labs",
    files: [
      { id: 5, label: "Basic Gastro Labs" },
      { id: 3, label: "Anemia Labs" },
      { id: 14, label: "Hepatic Labs" },
      { id: 19, label: "Stool Studies" },
    ],
  },
  {
    category: "Imaging",
    files: [
      { id: 1, label: "Abdominal CT" },
      { id: 2, label: "Abdominal US" },
      { id: 4, label: "Barium Studies" },
    ],
  },
  {
    category: "Procedure",
    files: [
      { id: 10, label: "EGD Order" },
      { id: 6, label: "Colon Order" },
      { id: 7, label: "Colonoscopy" },
      { id: 22, label: "Upper GI Endoscopy" },
      { id: 18, label: "Procedural Sedation" },
      { id: 8, label: "Colon Screening Guidelines" },
      { id: 21, label: "Telehealth Disclaimer" },
    ],
  },
  {
    category: "Diet & Lifestyle Modification",
    files: [
      { id: 23, label: "Weight Reducing Diet" },
      { id: 15, label: "High Fiber Diet" },
      { id: 13, label: "GERD and Lifestyle" },
      { id: 20, label: "Stress Management" },
      { id: 12, label: "FODMAP Diet" },
      { id: 11, label: "Fatty Liver" },
      { id: 9, label: "Diverticulosis" },
      { id: 17, label: "Irritable Bowel Syndrome" },
      { id: 16, label: "Inflammatory Bowel Disease" },
    ],
  },
];

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

/** Maps selected note-file ids to label groups, in catalog order. */
export function groupAssessmentPlanFiles(plan: unknown): AssessmentPlanFileGroup[] {
  const ids = extractSelectedFileIds(plan);
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const groups: AssessmentPlanFileGroup[] = [];
  const known = new Set<number>();
  for (const cat of ASSESSMENT_PLAN_FILE_CATALOG) {
    const files: string[] = [];
    for (const f of cat.files) {
      known.add(f.id);
      if (idSet.has(f.id)) files.push(f.label);
    }
    if (files.length) groups.push({ category: cat.category, files });
  }
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) {
    groups.push({ category: "Other", files: unknown.map((id) => `Document #${id}`) });
  }
  return groups;
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

function parseSharedReport(
  id: string,
  data: Record<string, unknown>,
  caseInfo: {
    shortCode: string;
    fullLegalName: string | null;
    dateOfBirth: string | null;
    presentingSymptoms: string | null;
    currentMedications: string | null;
  },
  medicalFiles: GiMedicalFile[],
  remarkCount: number
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
    gender: strOrNull(data.gender),
    email: strOrNull(data.email),
    phone: strOrNull(data.phone),
    currentMedications: caseInfo.currentMedications || "",
    insuranceCarrier: strOrNull(data.insurance_carrier),
    insurancePolicyId: strOrNull(data.insurance_policy_id),
    insuranceGroup: strOrNull(data.insurance_group),
    giSpecialistId: strOrEmpty(data.gi_specialist_id),
    giSpecialistName: strOrEmpty(data.gi_specialist_name) || "GI Specialist",
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
  const aboutByCase = new Map<
    string,
    {
      fullLegalName: string | null;
      dateOfBirth: string | null;
      presentingSymptoms: string | null;
      currentMedications: string | null;
    }
  >();
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
          presentingSymptoms: strOrNull(health.inboxMessage),
          currentMedications: strOrNull(health.currentMedications),
        });
      } catch {
        aboutByCase.set(caseId, {
          fullLegalName: null,
          dateOfBirth: null,
          presentingSymptoms: null,
          currentMedications: null,
        });
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

  const out: GiSharedReport[] = [];
  for (const s of matched) {
    const caseId = String(s.data.case_id);
    const about = aboutByCase.get(caseId) ?? {
      fullLegalName: null,
      dateOfBirth: null,
      presentingSymptoms: null,
      currentMedications: null,
    };

    const ids = strArray(s.data.medical_report_ids);
    const files = ids
      .map((id) => filesById.get(id))
      .filter((f): f is GiMedicalFile => Boolean(f));

    out.push(
      parseSharedReport(
        s.id,
        s.data,
        {
          shortCode: ownedCases.get(caseId)!,
          fullLegalName: about.fullLegalName,
          dateOfBirth: about.dateOfBirth,
          presentingSymptoms: about.presentingSymptoms,
          currentMedications: about.currentMedications,
        },
        files,
        remarkCountByReport.get(s.id) ?? 0
      )
    );
  }

  // Newest shares first.
  out.sort((a, b) =>
    String(b.sharedAt ?? "").localeCompare(String(a.sharedAt ?? ""))
  );
  return out;
}

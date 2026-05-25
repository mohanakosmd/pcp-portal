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
  presentingSymptoms: string;
  priorityScore: string;
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
  caseInfo: { shortCode: string; fullLegalName: string | null; dateOfBirth: string | null },
  medicalFiles: GiMedicalFile[]
): GiSharedReport {
  // Prefer the PCP case's own About data so the report matches what the
  // Cases page shows; fall back to the GI portal's snapshot fields.
  const patientName =
    caseInfo.fullLegalName || strOrNull(data.patient_name) || "—";
  const dateOfBirth = caseInfo.dateOfBirth || strOrNull(data.date_of_birth);
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
    insuranceCarrier: strOrNull(data.insurance_carrier),
    insurancePolicyId: strOrNull(data.insurance_policy_id),
    insuranceGroup: strOrNull(data.insurance_group),
    giSpecialistId: strOrEmpty(data.gi_specialist_id),
    giSpecialistName: strOrEmpty(data.gi_specialist_name) || "GI Specialist",
    clinicalSummary: strOrEmpty(data.clinical_summary),
    aiInsight: strOrEmpty(data.ai_insight),
    giSpecialistPlan: strOrNull(data.gi_specialist_plan),
    recommendations: strArray(data.recommendations),
    presentingSymptoms: strOrEmpty(data.presenting_symptoms),
    priorityScore: strOrEmpty(data.priority_score) || "—",
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

  // Fetch the About doc for each distinct matched case so the patient name +
  // DOB on the report match what the Cases page shows.
  const distinctCaseIds = [
    ...new Set(matched.map((s) => String(s.data.case_id))),
  ];
  const aboutByCase = new Map<
    string,
    { fullLegalName: string | null; dateOfBirth: string | null }
  >();
  await Promise.all(
    distinctCaseIds.map(async (caseId) => {
      try {
        const doc = await getDocument(
          `${PCP_CASES_COLLECTION}/${caseId}/about`,
          "data"
        );
        const data = (doc?.data ?? {}) as Record<string, unknown>;
        aboutByCase.set(caseId, {
          fullLegalName: strOrNull(data.fullLegalName),
          dateOfBirth: strOrNull(data.dateOfBirth),
        });
      } catch {
        aboutByCase.set(caseId, { fullLegalName: null, dateOfBirth: null });
      }
    })
  );

  const out: GiSharedReport[] = [];
  for (const s of matched) {
    const caseId = String(s.data.case_id);
    const about = aboutByCase.get(caseId) ?? {
      fullLegalName: null,
      dateOfBirth: null,
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
        },
        files
      )
    );
  }

  // Newest shares first.
  out.sort((a, b) =>
    String(b.sharedAt ?? "").localeCompare(String(a.sharedAt ?? ""))
  );
  return out;
}

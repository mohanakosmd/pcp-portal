import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";

import {
  RECOMMENDED_PROCEDURE_CATALOG,
  RECOMMENDED_TEST_CATALOG,
  assessmentPlanCatalogPromptText,
  isKnownAssessmentPlanFileId,
  resolveProcedureId,
  resolveTestId,
  slugCatalogPromptText,
} from "@/lib/assessment-plan-catalog";
import { readSessionUserId } from "@/lib/auth";
import { readFileBase64 } from "@/lib/case-files";
import {
  PCP_CASES_COLLECTION,
  ageFromDob,
  readCaseOwnedBy,
  type CaseAboutDoc,
  type CaseAiSuggestionDifferential,
  type CaseAiSuggestionMedication,
  type CaseAiSuggestions,
  type CaseHealthDoc,
} from "@/lib/cases";
import { getDocument, listDocuments, nowIso, upsertDocument } from "@/lib/firestore-rest";
import { generateJson, generateText, type InlineFile } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SUMMARY_CHARS = 4000;

// --- Attached documents ----------------------------------------------------
// The uploaded files are sent to Gemini as inline_data parts, so the summary
// and the GI suggestions reflect what the medical records and lab reports
// actually SAY — not just their file names.

/** Formats Gemini can read as an inline_data part (mirrors /api/hpi-extract). */
const GEMINI_READABLE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
]);

/** Which attachments feed the summary, best first.
 *
 *  These three kinds are exactly what the "Documents & Images" upload on the
 *  Health step produces — its per-file label picker writes medical_record /
 *  lab / other (SECTION_KIND in CreateCaseForm). That widget is the only source
 *  the summary reads, so everything uploaded elsewhere is absent on purpose:
 *  insurance cards carry no clinical information, and the HPI-history file has
 *  already been distilled into the typed fields by /api/hpi-extract. Sending
 *  either would only spend the budget a lab report or record needs. */
const ATTACHMENT_KIND_PRIORITY: Record<string, number> = {
  medical_record: 0,
  lab: 1,
  other: 2,
};

/** True for a document the summary may see at all. Applied before the prompt's
 *  file list is built, not just before the bytes are read: a case's insurance
 *  card should not even be named to the model. */
function isSummaryDocument(doc: { kind: string }): boolean {
  return doc.kind in ATTACHMENT_KIND_PRIORITY;
}

// Budget for the inline attachments on ONE request. Gemini's cap is 20 MB of
// request payload and base64 inflates bytes by ~4/3, so 9 MB of file bytes
// (~12 MB encoded) leaves comfortable room for the prompt.
const MAX_ATTACHMENT_FILES = 6;
const MAX_ATTACHMENT_BYTES = 9 * 1024 * 1024;

type CaseDocumentMeta = {
  fileId: string;
  fileName: string;
  kind: string;
  contentType: string;
  sizeBytes: number;
  chunkCount: number | null;
  /** Legacy inline `data:` URI, for files stored before chunking existed. */
  downloadUrl: string | null;
};

// Caps for the structured suggestion set.
const MAX_DIAGNOSIS_CHARS = 1200;
const MAX_TREATMENT_NOTES_CHARS = 1200;
const MAX_MEDICATIONS = 12;
const MAX_MED_FIELD_CHARS = 200;
const MAX_DIFFERENTIALS = 6;
const MAX_DIFFERENTIAL_FIELD_CHARS = 200;
const MAX_PLAN_FILES = 16;

/** Appended to both prompts' system instructions — the rules for reading the
 *  uploaded medical records / lab reports that ride along as attachments. */
const ATTACHMENTS_INSTRUCTION = `The patient's uploaded documents (medical records, lab investigations, other attachments) may be supplied as file attachments alongside the text. The upload is OPTIONAL — a case with no attachment at all is normal and complete; work from the reason for consultation and the typed fields, and never remark on the absence of documents. When attachments ARE supplied, treat them as primary source material:
- Read every attachment and use its content — lab values with units and reference ranges, findings, impressions, dates, medications — exactly as you use the typed intake fields.
- Attribute specifics to their source when it aids the reader, e.g. "ferritin 11 ng/mL (low), 2026-08-05 lab report".
- Where a document and a typed field disagree, prefer the document and note the discrepancy in one short clause.
- Still never invent anything: if a value is not in the attachments or the typed fields, it does not exist for your purposes. A file listed as "file name only" has NOT been read — never describe its contents.`;

const SYSTEM_INSTRUCTION = `You are a clinical-summary assistant for a PCP (primary-care physician) intake portal. Your audience is a clinician reviewing the patient's intake. Write a concise, factual, clinically useful summary based ONLY on the structured data and attached documents the user supplies — never invent diagnoses, lab values, or details not present in the input.

The REASON FOR CONSULTATION is the primary input. It is the PCP's own narrative of why this case exists, and the summary must answer it first and stay anchored to it. Everything else — demographics, history fields, uploaded documents — is supporting context that sharpens that picture; none of it displaces the reason for consultation as the subject of the summary. Mention a supporting detail only where it bears on that reason.

${ATTACHMENTS_INSTRUCTION}

Output format (markdown not required, just clean prose with section labels):

Summary: 2–3 sentences capturing the reason for consultation and the overall picture.
Patient: one short sentence with demographic + insurance highlights.
Relevant history: bullet list of allergies, current medications, existing conditions, recent tests, family history, lifestyle notes (omit any field that's empty).
Document findings: bullet list of what the attached records and lab reports show — abnormal results with their values, key impressions, relevant dates. Omit this section entirely when no attachment was supplied or the attachments add nothing.
Suggested next steps: 2–4 short, gentle bullets for the reviewing clinician — never prescribe; suggest workup directions or questions.
Caveat: one short line reminding the reader this is an AI-assisted preliminary summary and not a diagnosis.

Keep the whole thing under ~350 words. Plain text only, no markdown headings, no code fences.`;

type Intake = {
  about: Partial<CaseAboutDoc>;
  health: Partial<CaseHealthDoc>;
  documents: Array<{
    fileName: string;
    kind: string;
    /** True when this file's bytes ride along with the prompt, so the model can
     *  read it rather than only knowing it exists. */
    contentIncluded: boolean;
  }>;
};

/** Reads a stored file's bytes as base64, tolerating the legacy data-URI form. */
async function readDocumentBase64(
  caseId: string,
  doc: CaseDocumentMeta
): Promise<string> {
  if (doc.chunkCount !== null) {
    return readFileBase64(caseId, doc.fileId, doc.chunkCount);
  }
  const uri = doc.downloadUrl ?? "";
  return uri.includes(",") ? uri.slice(uri.indexOf(",") + 1) : "";
}

/**
 * Loads the bytes of the attached documents Gemini can actually read, best
 * (most clinically useful) first, until the per-request budget is spent.
 *
 * Never throws: a file that can't be loaded is reported as content-excluded and
 * generation continues on the rest — a broken attachment must not cost the case
 * its summary.
 */
async function loadAttachments(
  caseId: string,
  documents: CaseDocumentMeta[]
): Promise<{ files: InlineFile[]; includedFileIds: Set<string> }> {
  const candidates = documents
    .filter((d) => GEMINI_READABLE_TYPES.has(d.contentType))
    .sort(
      (a, b) =>
        ATTACHMENT_KIND_PRIORITY[a.kind] - ATTACHMENT_KIND_PRIORITY[b.kind] ||
        a.sizeBytes - b.sizeBytes
    );

  const files: InlineFile[] = [];
  const includedFileIds = new Set<string>();
  let budget = MAX_ATTACHMENT_BYTES;

  for (const doc of candidates) {
    if (files.length >= MAX_ATTACHMENT_FILES) break;
    if (doc.sizeBytes > budget) continue; // cheap skip; try the next, smaller one
    try {
      const dataBase64 = await readDocumentBase64(caseId, doc);
      if (!dataBase64) continue;
      // Charge the budget what we actually read: a legacy doc may carry no
      // sizeBytes, and an unbounded file would blow the request limit.
      const bytes = Math.ceil((dataBase64.length * 3) / 4);
      if (bytes > budget) continue;
      files.push({ mimeType: doc.contentType, dataBase64 });
      includedFileIds.add(doc.fileId);
      budget -= bytes;
    } catch (err) {
      console.error(`[ai-summary] could not read attachment ${doc.fileId}:`, err);
    }
  }

  return { files, includedFileIds };
}

/** The shared patient-intake block used by both the summary and suggestions prompts. */
function buildIntakeBlock(opts: Intake): string {
  const { about, health, documents } = opts;

  const field = (label: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return null;
    return `${label}: ${String(value)}`;
  };

  const aboutLines = [
    field("Full legal name", about.fullLegalName),
    field("Age", ageFromDob(about.dateOfBirth)),
    field("Gender", about.gender),
    field("Mobile", about.mobile),
    field("Email", about.email),
    field("Insurance carrier", about.insuranceCarrier),
    field("Policy ID", about.policyId),
    field("Group name", about.groupName),
    field("Effective date", about.effectiveDate),
  ].filter((v): v is string => Boolean(v));

  // The lead input, hoisted out of the health block so it heads the prompt.
  const reasonForConsultation =
    typeof health.inboxMessage === "string" ? health.inboxMessage.trim() : "";

  const healthLines = [
    field("Allergies", health.allergies),
    field("Current medications", health.currentMedications),
    field("Existing conditions", health.existingConditions),
    field("Past surgical history", health.pastSurgicalHistory),
    field("Social history", health.socialHistory),
    field("Recent tests or procedures", health.recentTestsOrProcedures),
    field("Family history", health.familyHistory),
    field("Lifestyle notes", health.lifestyleNotes),
    field("Patient-indicated urgency", health.urgencyLevel),
  ].filter((v): v is string => Boolean(v));

  // Files whose bytes ride along are called out explicitly, so the model knows
  // which listed names it can actually read and which it only has a name for.
  const docLine = documents.length
    ? `Uploaded documents (${documents.length}) — from the case's Documents & Images upload:\n` +
      documents
        .map(
          (d) =>
            `- ${d.fileName} [${d.kind}]` +
            (d.contentIncluded
              ? " — full file supplied as an attachment to this prompt; read it"
              : " — file name only, contents not available")
        )
        .join("\n")
    : "No documents uploaded (the upload is optional — work from the reason for consultation).";

  return [
    "PRIMARY INPUT — Reason for consultation (the PCP's own narrative; anchor the output on this):",
    reasonForConsultation || "(not provided)",
    "",
    "Supporting context — about the patient:",
    aboutLines.length ? aboutLines.join("\n") : "(no demographic data captured)",
    "",
    "Supporting context — health information:",
    healthLines.length ? healthLines.join("\n") : "(no health information captured)",
    "",
    docLine,
  ].join("\n");
}

function buildPrompt(opts: Intake): string {
  return `PATIENT INTAKE — please summarize.\n\n${buildIntakeBlock(opts)}`;
}

const SUGGESTIONS_SYSTEM_INSTRUCTION = `You are a GI (gastroenterology) triage assistant helping prepare a case for a specialist's review. From the PCP intake below, produce PROVISIONAL decision-support suggestions the specialist will confirm or override — never a prescription or a final diagnosis.

The REASON FOR CONSULTATION is the primary input — it states why this case was referred, so every suggestion must plausibly serve it. The demographics and history fields are supporting context that refines the picture; an incidental detail there is not on its own grounds for a suggestion.

Base everything ONLY on the supplied intake and its attached documents. Do not invent findings. Be conservative: when the intake is thin, suggest less rather than guessing — an empty array or "" is the correct answer when nothing clearly applies.

${ATTACHMENTS_INSTRUCTION}
Lab values and findings in the attachments are often the strongest evidence available — let them drive the working impression, the differential, and which tests/procedures are still worth ordering. Do not re-order a test whose result is already in an attached report unless repeating it is clinically the point.

Return, as JSON, matching the GI plan form:
- diagnosis: a brief working clinical impression, at most 80 words, ending with its ICD-10-CM code in parentheses — e.g. "Gastroesophageal reflux disease without esophagitis (ICD-10: K21.9)". Use the most specific code the intake actually supports; when the picture only supports a symptom code, give the symptom code (e.g. R10.13) rather than inventing a disease. If the picture is too vague to impress, say so plainly and omit the code.
- differentialDiagnosis: the alternative diagnoses a specialist should still consider, ordered most likely first, at most 5. Each is an object { condition, icdCode, rationale }. condition = the alternative diagnosis name; icdCode = its ICD-10-CM code (e.g. "K27.9") — "" if you are not confident of the code, never guess a code you don't know; rationale = one short line (≤ 20 words) on what in the intake supports or argues against it. Exclude the working impression itself. Empty array when the intake is too thin to differentiate.
- files: from the "Assessment & Plan File catalog" in the prompt, the NUMERIC ids of the documents/orders that fit this case. CHOOSE ONLY ids listed there. Prefer a focused set.
- treatmentNotes: a short free-text plan for the specialist (e.g. empiric therapy, follow-up interval, counseling), at most 60 words. "" if nothing to add.
- tests: from the "Recommend Tests catalog" in the prompt, the string ids of applicable labs. CHOOSE ONLY ids listed there.
- procedures: from the "Recommended Procedures catalog" in the prompt, the string ids of applicable procedures. CHOOSE ONLY ids listed there.
- medications: suggested medications for the specialist to consider, each an object { name, dosage, frequency }. name = drug or class (e.g. "Esomeprazole"); dosage = strength + duration (e.g. "40 mg for 8 weeks"); frequency = how often (e.g. "Twice daily"). Empty array if nothing is clearly indicated.
  Derive medications from BOTH the presenting concern/symptoms AND the patient's current medications:
  * Target the presenting symptoms — each suggestion should plausibly address the chief complaint. Do not suggest a medication unrelated to why the patient is here.
  * Reconcile against the current medications listed in the intake. Do NOT re-suggest a drug (or a same-class drug) the patient is already taking, unless you are explicitly recommending a change — in that case say so in the dosage/frequency text (e.g. "escalate to 40 mg" or "switch from ranitidine"). Avoid an obvious duplication or interaction with what they already take.
  * If the patient is already on an adequate regimen for the presenting complaint, prefer an empty array over restating it.
  * Keep it focused: at most 4 medications. dosage and frequency are each ONE short phrase (≤ 12 words) — a single recommendation, not a list of alternatives.`;

const SUGGESTIONS_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    diagnosis: { type: "STRING" },
    differentialDiagnosis: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          condition: { type: "STRING" },
          icdCode: { type: "STRING" },
          rationale: { type: "STRING" },
        },
        required: ["condition", "icdCode", "rationale"],
      },
    },
    files: { type: "ARRAY", items: { type: "INTEGER" } },
    treatmentNotes: { type: "STRING" },
    tests: { type: "ARRAY", items: { type: "STRING" } },
    procedures: { type: "ARRAY", items: { type: "STRING" } },
    medications: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          dosage: { type: "STRING" },
          frequency: { type: "STRING" },
        },
        required: ["name", "dosage", "frequency"],
      },
    },
  },
  required: [
    "diagnosis",
    "differentialDiagnosis",
    "files",
    "treatmentNotes",
    "tests",
    "procedures",
    "medications",
  ],
};

function buildSuggestionsPrompt(opts: Intake): string {
  return [
    "PATIENT INTAKE — prepare provisional GI decision-support suggestions.",
    "",
    buildIntakeBlock(opts),
    "",
    "Assessment & Plan File catalog (choose files ONLY from these numeric ids):",
    assessmentPlanCatalogPromptText(),
    "",
    "Recommend Tests catalog (choose tests ONLY from these ids):",
    slugCatalogPromptText(RECOMMENDED_TEST_CATALOG),
    "",
    "Recommended Procedures catalog (choose procedures ONLY from these ids):",
    slugCatalogPromptText(RECOMMENDED_PROCEDURE_CATALOG),
  ].join("\n");
}

type RawSuggestions = {
  diagnosis?: unknown;
  differentialDiagnosis?: unknown;
  files?: unknown;
  treatmentNotes?: unknown;
  tests?: unknown;
  procedures?: unknown;
  medications?: unknown;
};

/** Keeps only real, deduped catalog file ids, capped — no hallucinated id reaches the form. */
function normalizeFileIds(raw: unknown): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  if (!Array.isArray(raw)) return out;
  for (const v of raw) {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (!Number.isInteger(n) || seen.has(n) || !isKnownAssessmentPlanFileId(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= MAX_PLAN_FILES) break;
  }
  return out;
}

/** Resolves each entry to a known slug id (via id or label), deduped. Drops unknowns. */
function normalizeSlugs(raw: unknown, resolve: (v: string) => string | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  if (!Array.isArray(raw)) return out;
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const id = resolve(v);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Keeps differential rows that name a condition, deduped by condition, capped.
 * An ICD code that doesn't look like ICD-10-CM (letter + 2 digits, optional
 * dotted suffix) is dropped rather than shown — a malformed code is worse than
 * none on a clinician's form.
 */
function normalizeDifferentials(raw: unknown): CaseAiSuggestionDifferential[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CaseAiSuggestionDifferential[] = [];
  for (const d of raw) {
    if (!d || typeof d !== "object") continue;
    const dx = d as Record<string, unknown>;
    const condition =
      typeof dx.condition === "string"
        ? dx.condition.trim().slice(0, MAX_DIFFERENTIAL_FIELD_CHARS)
        : "";
    if (!condition) continue; // a row with no condition is meaningless
    const key = condition.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const rawCode = typeof dx.icdCode === "string" ? dx.icdCode.trim().toUpperCase() : "";
    out.push({
      condition,
      icdCode: /^[A-TV-Z][0-9][0-9AB](\.[0-9A-Z]{1,4})?$/.test(rawCode) ? rawCode : "",
      rationale:
        typeof dx.rationale === "string"
          ? dx.rationale.trim().slice(0, MAX_DIFFERENTIAL_FIELD_CHARS)
          : "",
    });
    if (out.length >= MAX_DIFFERENTIALS) break;
  }
  return out;
}

function normalizeMedications(raw: unknown): CaseAiSuggestionMedication[] {
  if (!Array.isArray(raw)) return [];
  const out: CaseAiSuggestionMedication[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const med = m as Record<string, unknown>;
    const name = typeof med.name === "string" ? med.name.trim().slice(0, MAX_MED_FIELD_CHARS) : "";
    if (!name) continue; // a row with no drug name is meaningless
    out.push({
      name,
      dosage:
        typeof med.dosage === "string" ? med.dosage.trim().slice(0, MAX_MED_FIELD_CHARS) : "",
      frequency:
        typeof med.frequency === "string"
          ? med.frequency.trim().slice(0, MAX_MED_FIELD_CHARS)
          : "",
    });
    if (out.length >= MAX_MEDICATIONS) break;
  }
  return out;
}

/**
 * Validates and normalizes the model's raw suggestion JSON into the stored shape
 * (1:1 with the GI plan form). Every list is filtered to real catalog entries so
 * a hallucinated id/label can't reach the form.
 */
function normalizeSuggestions(raw: RawSuggestions): CaseAiSuggestions {
  return {
    diagnosis:
      typeof raw.diagnosis === "string" ? raw.diagnosis.trim().slice(0, MAX_DIAGNOSIS_CHARS) : "",
    differentialDiagnosis: normalizeDifferentials(raw.differentialDiagnosis),
    files: normalizeFileIds(raw.files),
    treatmentNotes:
      typeof raw.treatmentNotes === "string"
        ? raw.treatmentNotes.trim().slice(0, MAX_TREATMENT_NOTES_CHARS)
        : "",
    tests: normalizeSlugs(raw.tests, resolveTestId),
    procedures: normalizeSlugs(raw.procedures, resolveProcedureId),
    medications: normalizeMedications(raw.medications),
    generatedAt: nowIso(),
  };
}

/**
 * Generates the structured suggestion set. Isolated from the prose-summary path:
 * a failure here (or an all-empty result) returns null so the caller still saves
 * the summary. Never throws.
 */
async function generateSuggestions(
  intake: Intake,
  files: InlineFile[]
): Promise<CaseAiSuggestions | null> {
  try {
    const raw = await generateJson<RawSuggestions>(buildSuggestionsPrompt(intake), {
      systemInstruction: SUGGESTIONS_SYSTEM_INSTRUCTION,
      responseSchema: SUGGESTIONS_RESPONSE_SCHEMA,
      files,
      temperature: 0.2,
      // A truncated response is unparseable JSON, so generateJson throws and the
      // whole set is lost. This shape (diagnosis + differential + notes +
      // several medication objects) can run long, so give it generous headroom;
      // the prompt also caps list length/verbosity to keep it well under this.
      maxOutputTokens: 6144,
      // Reading several attached PDFs takes noticeably longer than text alone.
      timeoutMs: files.length ? 120_000 : 60_000,
    });
    const s = normalizeSuggestions(raw);
    const empty =
      !s.diagnosis &&
      !s.differentialDiagnosis.length &&
      !s.treatmentNotes &&
      !s.files.length &&
      !s.tests.length &&
      !s.procedures.length &&
      !s.medications.length;
    return empty ? null : s;
  } catch (err) {
    console.error("[ai-summary] suggestions generation failed:", err);
    return null;
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const { caseId } = await params;
  const userId = await readSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  try {
    await readCaseOwnedBy(caseId, userId);

    const [aboutDoc, healthDoc, docsPage] = await Promise.all([
      getDocument(`${PCP_CASES_COLLECTION}/${caseId}/about`, "data"),
      getDocument(`${PCP_CASES_COLLECTION}/${caseId}/health`, "data"),
      listDocuments(`${PCP_CASES_COLLECTION}/${caseId}/documents`, { pageSize: 100 }),
    ]);

    const about = (aboutDoc?.data ?? {}) as Partial<CaseAboutDoc>;
    const health = (healthDoc?.data ?? {}) as Partial<CaseHealthDoc>;
    // Only the "Documents & Images" uploads feed the summary — see
    // isSummaryDocument. Filtered here so the excluded files are invisible to
    // both the attachment loader and the prompt's file list.
    const storedDocs: CaseDocumentMeta[] = docsPage.docs
      .filter((d) => !d.id.startsWith("_"))
      .map((d) => ({
        fileId: d.id,
        fileName: typeof d.data.fileName === "string" ? d.data.fileName : "(unnamed)",
        kind: typeof d.data.kind === "string" ? d.data.kind : "other",
        contentType:
          typeof d.data.contentType === "string" ? d.data.contentType : "application/octet-stream",
        sizeBytes: typeof d.data.sizeBytes === "number" ? d.data.sizeBytes : 0,
        chunkCount: typeof d.data.chunkCount === "number" ? d.data.chunkCount : null,
        downloadUrl: typeof d.data.downloadUrl === "string" ? d.data.downloadUrl : null,
      }))
      .filter(isSummaryDocument);

    // Pull in the bytes of the uploaded records/labs so both generations read
    // the documents themselves, not just their file names.
    const { files, includedFileIds } = await loadAttachments(caseId, storedDocs);

    const intake: Intake = {
      about,
      health,
      documents: storedDocs.map((d) => ({
        fileName: d.fileName,
        kind: d.kind,
        contentIncluded: includedFileIds.has(d.fileId),
      })),
    };

    // Summary and structured suggestions are independent Gemini calls; run them
    // together. The summary drives this route's success/failure (unchanged);
    // generateSuggestions never throws, so a suggestion failure can't fail the
    // summary. Its result is null on failure or an all-empty parse.
    const [summary, suggestions] = await Promise.all([
      generateText(buildPrompt(intake), {
        systemInstruction: SYSTEM_INSTRUCTION,
        files,
        temperature: 0.35,
        // Attachments add a "Document findings" section, so give it more room.
        maxOutputTokens: files.length ? 1536 : 1024,
        timeoutMs: files.length ? 120_000 : 45_000,
      }),
      generateSuggestions(intake, files),
    ]);

    const truncated = summary.slice(0, MAX_SUMMARY_CHARS);
    const now = nowIso();
    // Only write aiSuggestions when we actually have a set — a transient
    // suggestion failure must not wipe a previously generated one on regenerate.
    const update: Record<string, unknown> = {
      aiSummary: truncated,
      aiSummaryGeneratedAt: now,
      updatedAt: now,
    };
    if (suggestions) {
      update.aiSuggestions = suggestions;
      update.aiSuggestionsGeneratedAt = suggestions.generatedAt;
    }
    await upsertDocument(PCP_CASES_COLLECTION, caseId, update);

    return NextResponse.json({
      ok: true,
      aiSummary: truncated,
      aiSummaryGeneratedAt: now,
      aiSuggestions: suggestions,
    });
  } catch (err) {
    console.error("[ai-summary] error:", err);
    return apiErrorResponse(err, "AI summary failed.");
  }
}

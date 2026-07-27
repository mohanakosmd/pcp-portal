import { NextResponse } from "next/server";

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
import { generateJson, generateText } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SUMMARY_CHARS = 4000;

// Caps for the structured suggestion set.
const MAX_DIAGNOSIS_CHARS = 1200;
const MAX_TREATMENT_NOTES_CHARS = 1200;
const MAX_MEDICATIONS = 12;
const MAX_MED_FIELD_CHARS = 200;
const MAX_DIFFERENTIALS = 6;
const MAX_DIFFERENTIAL_FIELD_CHARS = 200;
const MAX_PLAN_FILES = 16;

const SYSTEM_INSTRUCTION = `You are a clinical-summary assistant for a PCP (primary-care physician) intake portal. Your audience is a clinician reviewing the patient's intake. Write a concise, factual, clinically useful summary based ONLY on the structured data the user supplies — never invent diagnoses, lab values, or details not present in the input.

Output format (markdown not required, just clean prose with section labels):

Summary: 2–3 sentences capturing the chief concern and overall picture.
Patient: one short sentence with demographic + insurance highlights.
Relevant history: bullet list of allergies, current medications, existing conditions, recent tests, family history, lifestyle notes (omit any field that's empty).
Suggested next steps: 2–4 short, gentle bullets for the reviewing clinician — never prescribe; suggest workup directions or questions.
Caveat: one short line reminding the reader this is an AI-assisted preliminary summary and not a diagnosis.

Keep the whole thing under ~350 words. Plain text only, no markdown headings, no code fences.`;

type Intake = {
  about: Partial<CaseAboutDoc>;
  health: Partial<CaseHealthDoc>;
  documents: Array<{ fileName: string; kind: string }>;
};

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

  const healthLines = [
    field("Presenting concern / inbox message", health.inboxMessage),
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

  const docLine = documents.length
    ? `Attached files (${documents.length}): ` +
      documents.map((d) => `${d.fileName} [${d.kind}]`).join(", ")
    : "No documents attached.";

  return [
    "About the patient:",
    aboutLines.length ? aboutLines.join("\n") : "(no demographic data captured)",
    "",
    "Health information:",
    healthLines.length ? healthLines.join("\n") : "(no health information captured)",
    "",
    docLine,
  ].join("\n");
}

function buildPrompt(opts: Intake): string {
  return `PATIENT INTAKE — please summarize.\n\n${buildIntakeBlock(opts)}`;
}

const SUGGESTIONS_SYSTEM_INSTRUCTION = `You are a GI (gastroenterology) triage assistant helping prepare a case for a specialist's review. From the PCP intake below, produce PROVISIONAL decision-support suggestions the specialist will confirm or override — never a prescription or a final diagnosis.

Base everything ONLY on the supplied intake. Do not invent findings. Be conservative: when the intake is thin, suggest less rather than guessing — an empty array or "" is the correct answer when nothing clearly applies.

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
async function generateSuggestions(intake: Intake): Promise<CaseAiSuggestions | null> {
  try {
    const raw = await generateJson<RawSuggestions>(buildSuggestionsPrompt(intake), {
      systemInstruction: SUGGESTIONS_SYSTEM_INSTRUCTION,
      responseSchema: SUGGESTIONS_RESPONSE_SCHEMA,
      temperature: 0.2,
      // A truncated response is unparseable JSON, so generateJson throws and the
      // whole set is lost. This shape (diagnosis + differential + notes +
      // several medication objects) can run long, so give it generous headroom;
      // the prompt also caps list length/verbosity to keep it well under this.
      maxOutputTokens: 6144,
      timeoutMs: 60_000,
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
    const documents = docsPage.docs
      .filter((d) => !d.id.startsWith("_"))
      .map((d) => ({
        fileName: typeof d.data.fileName === "string" ? d.data.fileName : "(unnamed)",
        kind: typeof d.data.kind === "string" ? d.data.kind : "other",
      }));

    const intake = { about, health, documents };

    // Summary and structured suggestions are independent Gemini calls; run them
    // together. The summary drives this route's success/failure (unchanged);
    // generateSuggestions never throws, so a suggestion failure can't fail the
    // summary. Its result is null on failure or an all-empty parse.
    const [summary, suggestions] = await Promise.all([
      generateText(buildPrompt(intake), {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.35,
        maxOutputTokens: 1024,
      }),
      generateSuggestions(intake),
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (err as any)?.status ?? 500;
    console.error("[ai-summary] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI summary failed." },
      { status }
    );
  }
}

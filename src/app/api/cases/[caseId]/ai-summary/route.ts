import { NextResponse } from "next/server";

import { readSessionUserId } from "@/lib/auth";
import {
  PCP_CASES_COLLECTION,
  readCaseOwnedBy,
  type CaseAboutDoc,
  type CaseHealthDoc,
} from "@/lib/cases";
import { getDocument, listDocuments, nowIso, upsertDocument } from "@/lib/firestore-rest";
import { generateText } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SUMMARY_CHARS = 4000;

const SYSTEM_INSTRUCTION = `You are a clinical-summary assistant for a PCP (primary-care physician) intake portal. Your audience is a clinician reviewing the patient's intake. Write a concise, factual, clinically useful summary based ONLY on the structured data the user supplies — never invent diagnoses, lab values, or details not present in the input.

Output format (markdown not required, just clean prose with section labels):

Summary: 2–3 sentences capturing the chief concern and overall picture.
Patient: one short sentence with demographic + insurance highlights.
Relevant history: bullet list of allergies, current medications, existing conditions, recent tests, family history, lifestyle notes (omit any field that's empty).
Suggested next steps: 2–4 short, gentle bullets for the reviewing clinician — never prescribe; suggest workup directions or questions.
Caveat: one short line reminding the reader this is an AI-assisted preliminary summary and not a diagnosis.

Keep the whole thing under ~350 words. Plain text only, no markdown headings, no code fences.`;

function buildPrompt(opts: {
  about: Partial<CaseAboutDoc>;
  health: Partial<CaseHealthDoc>;
  documents: Array<{ fileName: string; kind: string }>;
}): string {
  const { about, health, documents } = opts;

  const field = (label: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return null;
    return `${label}: ${String(value)}`;
  };

  const aboutLines = [
    field("Full legal name", about.fullLegalName),
    field("Age", about.age),
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
    "PATIENT INTAKE — please summarize.",
    "",
    "About the patient:",
    aboutLines.length ? aboutLines.join("\n") : "(no demographic data captured)",
    "",
    "Health information:",
    healthLines.length ? healthLines.join("\n") : "(no health information captured)",
    "",
    docLine,
  ].join("\n");
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

    const prompt = buildPrompt({ about, health, documents });
    const summary = await generateText(prompt, {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.35,
      maxOutputTokens: 1024,
    });

    const truncated = summary.slice(0, MAX_SUMMARY_CHARS);
    const now = nowIso();
    await upsertDocument(PCP_CASES_COLLECTION, caseId, {
      aiSummary: truncated,
      aiSummaryGeneratedAt: now,
      updatedAt: now,
    });

    return NextResponse.json({
      ok: true,
      aiSummary: truncated,
      aiSummaryGeneratedAt: now,
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

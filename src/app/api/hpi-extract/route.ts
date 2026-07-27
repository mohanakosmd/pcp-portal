import { NextResponse } from "next/server";

import { readSessionUserId } from "@/lib/auth";
import { generateJson } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Matches the per-file cap enforced by the documents route.
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

// Formats Gemini can read as an inline_data part. Word documents are NOT in
// this list — Gemini has no docx decoder, and sending one yields a confident
// hallucination rather than an error, so we reject it up front.
const ACCEPTED_TYPES = new Map<string, string>([
  ["application/pdf", "PDF"],
  ["image/png", "PNG"],
  ["image/jpeg", "JPEG"],
  ["image/webp", "WebP"],
  ["text/plain", "plain text"],
]);

/**
 * The Health fields the create-case form actually renders, and therefore the
 * only ones worth extracting. `inboxMessage` (Reason for Consultation) is
 * deliberately excluded: it is the PCP's own narrative and the one mandatory
 * field on the step, so it stays human-authored.
 */
const EXTRACTED_FIELDS = [
  "allergies",
  "currentMedications",
  "pastSurgicalHistory",
  "socialHistory",
  "pharmacyInformation",
  "pharmacyPhone",
  "pharmacyFax",
  "primaryCarePhysician",
  "pcpPhone",
  "pcpFax",
] as const;

type ExtractedField = (typeof EXTRACTED_FIELDS)[number];

/** Every field reaches the client as a string; medications arrive newline-joined. */
export type HpiExtraction = Record<ExtractedField, string>;

/**
 * Medications are modelled as an ARRAY rather than a newline-delimited STRING.
 * Under constrained decoding Gemini reliably drops the "\n" between list items
 * and returns "Omeprazole 20 mg dailyMetformin 500 mg BID" — one unusable blob.
 * An array makes the separator structural, and we join it ourselves below;
 * MedicationPicker parses the result one medication per line.
 */
const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: Object.fromEntries(
    EXTRACTED_FIELDS.map((f) => [
      f,
      f === "currentMedications"
        ? { type: "ARRAY", items: { type: "STRING" } }
        : { type: "STRING" },
    ])
  ),
  required: [...EXTRACTED_FIELDS],
};

const SYSTEM_INSTRUCTION = `You extract structured intake data from a patient's HPI (History of Present Illness) document for a primary-care intake portal.

Rules — follow exactly:
- Transcribe ONLY what the document states. Never infer, complete, normalize, or invent a value.
- If the document does not state a field, return an empty string "" for it. An empty string is always the correct answer for absent data. Do not guess.
- Never write placeholders such as "N/A", "none documented", "unknown", or "not mentioned". Use "" instead.
- Preserve the document's own wording and clinical detail; do not summarize away specifics such as reaction types, dosages, or dates.

Field guidance:
- allergies: each allergen with its reaction if stated, comma-separated. If the document explicitly says the patient has no known allergies, write "No known allergies".
- currentMedications: an array with ONE ENTRY PER MEDICATION, each including dose and frequency when stated. Never merge two medications into one entry. Empty array if none are listed. No bullet characters or numbering.
- pastSurgicalHistory: procedures with approximate dates, comma-separated.
- socialHistory: tobacco, alcohol, substance use, occupation, living situation.
- pharmacyInformation: pharmacy name and street address.
- pharmacyPhone / pharmacyFax: the pharmacy's phone number and fax number, separately. If only one is stated, fill it and leave the other "". If a number is labelled neither phone nor fax, treat it as the phone.
- pcpPhone / pcpFax: the primary care physician's phone number and fax number, separately, following the same rule.
- primaryCarePhysician: the physician's name, and clinic if stated.`;

const PROMPT =
  "Extract the intake fields from the attached HPI document. Return an empty string for every field the document does not state.";

/** Shape as it comes off the wire: medications are an array, the rest strings. */
type RawExtraction = Record<string, unknown>;

function isExtraction(v: unknown): v is RawExtraction {
  if (!v || typeof v !== "object") return false;
  const obj = v as RawExtraction;
  const meds = obj.currentMedications;
  if (!Array.isArray(meds) || meds.some((m) => typeof m !== "string")) return false;
  return EXTRACTED_FIELDS.filter((f) => f !== "currentMedications").every(
    (f) => typeof obj[f] === "string"
  );
}

/**
 * The model is told to emit "" for absent fields, but a stray "N/A"-style
 * placeholder still slips through occasionally. Those would land in the form as
 * real text, so treat them as absent.
 */
const PLACEHOLDER = /^(n\/?a|none|none documented|not documented|unknown|not mentioned|not stated|not provided|-{1,2})\.?$/i;

function clean(value: string, max: number): string {
  const trimmed = value.trim();
  if (!trimmed || PLACEHOLDER.test(trimmed)) return "";
  return trimmed.slice(0, max);
}

// Per-field caps mirror the limits the health PATCH route enforces, so an
// extracted value can never be silently truncated on save.
const FIELD_MAX: Record<ExtractedField, number> = {
  allergies: 1000,
  currentMedications: 1000,
  pastSurgicalHistory: 1000,
  socialHistory: 1000,
  pharmacyInformation: 500,
  pharmacyPhone: 40,
  pharmacyFax: 40,
  primaryCarePhysician: 200,
  pcpPhone: 40,
  pcpFax: 40,
};

export async function POST(request: Request) {
  const userId = await readSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "The HPI document exceeds the 5 MB limit." },
      { status: 413 }
    );
  }

  const contentType = (file.type || "").split(";")[0].trim().toLowerCase();
  if (!ACCEPTED_TYPES.has(contentType)) {
    return NextResponse.json(
      {
        error: `Can't read "${file.name}". Upload the HPI document as a ${[
          ...ACCEPTED_TYPES.values(),
        ].join(", ")} file.`,
      },
      { status: 415 }
    );
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const raw = await generateJson<unknown>(PROMPT, {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseSchema: RESPONSE_SCHEMA,
      file: { mimeType: contentType, dataBase64: bytes.toString("base64") },
      // Extraction is transcription, not composition — keep it as literal as
      // the decoder allows.
      temperature: 0,
      maxOutputTokens: 2048,
      timeoutMs: 60_000,
    });

    if (!isExtraction(raw)) {
      return NextResponse.json(
        { error: "Couldn't read structured details from that document." },
        { status: 502 }
      );
    }

    const fields = {} as HpiExtraction;
    for (const key of EXTRACTED_FIELDS) {
      if (key === "currentMedications") continue;
      fields[key] = clean(raw[key] as string, FIELD_MAX[key]);
    }

    // Drop empty/placeholder entries, then join — one medication per line is
    // exactly what MedicationPicker parses. Enforce the cap by dropping whole
    // trailing entries: slicing the joined string would leave a half-written
    // drug name in a clinical field.
    const meds: string[] = [];
    let used = 0;
    for (const entry of raw.currentMedications as string[]) {
      const line = clean(entry, 200);
      if (!line) continue;
      const cost = (meds.length ? 1 : 0) + line.length; // +1 for the newline
      if (used + cost > FIELD_MAX.currentMedications) break;
      meds.push(line);
      used += cost;
    }
    fields.currentMedications = meds.join("\n");

    const found = EXTRACTED_FIELDS.filter((f) => fields[f]).length;
    return NextResponse.json({ ok: true, fields, found, fileName: file.name });
  } catch (err) {
    console.error("[hpi-extract] error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Couldn't read that document — ${err.message}`
            : "Couldn't read that document.",
      },
      { status: 500 }
    );
  }
}

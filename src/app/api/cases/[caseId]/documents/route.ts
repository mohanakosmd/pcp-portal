import { NextResponse } from "next/server";

import { readSessionUserId } from "@/lib/auth";
import { writeFileChunks } from "@/lib/case-files";
import {
  PCP_CASES_COLLECTION,
  generateCaseId,
  readCaseOwnedBy,
  type CaseAboutDoc,
} from "@/lib/cases";
import { getDocument, listDocuments, nowIso, upsertDocument } from "@/lib/firestore-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// File bytes are base64-encoded and stored in Firestore (chunked across docs
// when needed — see src/lib/case-files.ts). The cap below is the raw file size
// limit enforced server-side.
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

const VALID_KINDS = new Set([
  "lab",
  "imaging",
  "note",
  "insurance_card_front",
  "insurance_card_back",
  "other",
]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const { caseId } = await params;
  const userId = await readSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  try {
    await readCaseOwnedBy(caseId, userId);
    const page = await listDocuments(`${PCP_CASES_COLLECTION}/${caseId}/documents`, {
      pageSize: 100,
    });
    // Metadata docs only — file bytes live in each doc's `chunks` subcollection.
    const docs = page.docs
      .filter((d) => !d.id.startsWith("_"))
      .map((d) => ({
        fileId: d.id,
        ...d.data,
        // Convenience URL the client can drop straight into <img src> etc.
        url: `/api/cases/${caseId}/documents/${d.id}`,
      }));
    return NextResponse.json({ ok: true, documents: docs });
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (err as any)?.status ?? 500;
    console.error("[documents GET] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load documents." },
      { status }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const { caseId } = await params;
  const userId = await readSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  try {
    await readCaseOwnedBy(caseId, userId);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
    }

    const file = form.get("file");
    const rawKind = form.get("kind");
    const kind = typeof rawKind === "string" && VALID_KINDS.has(rawKind) ? rawKind : "other";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "File is empty." }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "File exceeds the 5 MB limit." },
        { status: 413 }
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const contentType = file.type || "application/octet-stream";
    const base64 = bytes.toString("base64");

    const isCard = kind === "insurance_card_front" || kind === "insurance_card_back";
    const fileId = generateCaseId();
    const now = nowIso();

    // Write the file bytes as chunk docs first.
    const chunkCount = await writeFileChunks(caseId, fileId, base64);

    // Then the metadata doc (no bytes — just describes the file + chunk count).
    await upsertDocument(`${PCP_CASES_COLLECTION}/${caseId}/documents`, fileId, {
      fileName: file.name,
      contentType,
      sizeBytes: bytes.byteLength,
      storageBackend: "firestore-chunks",
      chunkCount,
      kind,
      uploadedAt: now,
      uploadedByUserId: userId,
      aiSummary: null,
      aiSummaryGeneratedAt: null,
    });

    // Bump documentsCount on the root.
    const root = await getDocument(PCP_CASES_COLLECTION, caseId);
    const count =
      typeof root?.data.documentsCount === "number" ? root.data.documentsCount : 0;
    await upsertDocument(PCP_CASES_COLLECTION, caseId, {
      documentsCount: count + 1,
      updatedAt: now,
    });

    // For insurance cards, denormalize the reference onto about/data.
    if (isCard) {
      const side = kind === "insurance_card_front" ? "front" : "back";
      const aboutDoc = await getDocument(`${PCP_CASES_COLLECTION}/${caseId}/about`, "data");
      const prevCards =
        (aboutDoc?.data.insuranceCards as CaseAboutDoc["insuranceCards"] | undefined) ?? {
          front: null,
          back: null,
        };
      await upsertDocument(`${PCP_CASES_COLLECTION}/${caseId}/about`, "data", {
        insuranceCards: {
          ...prevCards,
          [side]: { fileId, storagePath: "", uploadedAt: now },
        },
        updatedAt: now,
        updatedByUserId: userId,
      });
    }

    return NextResponse.json({
      ok: true,
      fileId,
      kind,
      fileName: file.name,
      contentType,
      sizeBytes: bytes.byteLength,
      chunkCount,
      url: `/api/cases/${caseId}/documents/${fileId}`,
      uploadedAt: now,
    });
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (err as any)?.status ?? 500;
    console.error("[documents POST] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed." },
      { status }
    );
  }
}

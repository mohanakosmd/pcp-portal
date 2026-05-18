import { NextResponse } from "next/server";

import { readSessionUserId } from "@/lib/auth";
import { deleteFileChunks, readFileBase64 } from "@/lib/case-files";
import {
  PCP_CASES_COLLECTION,
  readCaseOwnedBy,
  type CaseAboutDoc,
} from "@/lib/cases";
import { deleteDocument, getDocument, nowIso, upsertDocument } from "@/lib/firestore-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams the raw file bytes (reassembled from Firestore chunk docs) with the
 * correct Content-Type — usable directly in `<img src>` / `<a href>`.
 * Also tolerates the legacy single-doc `downloadUrl` data-URI format.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ caseId: string; fileId: string }> }
) {
  const { caseId, fileId } = await params;
  const userId = await readSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  try {
    await readCaseOwnedBy(caseId, userId);

    const docPath = `${PCP_CASES_COLLECTION}/${caseId}/documents`;
    const fileDoc = await getDocument(docPath, fileId);
    if (!fileDoc) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    const contentType =
      typeof fileDoc.data.contentType === "string"
        ? fileDoc.data.contentType
        : "application/octet-stream";

    let base64 = "";
    if (typeof fileDoc.data.chunkCount === "number") {
      base64 = await readFileBase64(caseId, fileId, fileDoc.data.chunkCount);
    } else if (typeof fileDoc.data.downloadUrl === "string") {
      // Legacy: bytes were stored inline as a `data:` URI.
      const uri = fileDoc.data.downloadUrl;
      base64 = uri.includes(",") ? uri.slice(uri.indexOf(",") + 1) : "";
    }

    if (!base64) {
      return NextResponse.json({ error: "File has no stored bytes." }, { status: 404 });
    }

    const bytes = Buffer.from(base64, "base64");
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (err as any)?.status ?? 500;
    console.error("[documents GET one] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load document." },
      { status }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ caseId: string; fileId: string }> }
) {
  const { caseId, fileId } = await params;
  const userId = await readSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  try {
    await readCaseOwnedBy(caseId, userId);

    const docPath = `${PCP_CASES_COLLECTION}/${caseId}/documents`;
    const fileDoc = await getDocument(docPath, fileId);
    if (!fileDoc) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    // Delete the chunk subcollection docs, then the metadata doc.
    if (typeof fileDoc.data.chunkCount === "number") {
      await deleteFileChunks(caseId, fileId, fileDoc.data.chunkCount);
    }
    await deleteDocument(docPath, fileId);

    const now = nowIso();

    // Decrement documentsCount (floor at 0).
    const root = await getDocument(PCP_CASES_COLLECTION, caseId);
    const count =
      typeof root?.data.documentsCount === "number" ? root.data.documentsCount : 0;
    await upsertDocument(PCP_CASES_COLLECTION, caseId, {
      documentsCount: Math.max(0, count - 1),
      updatedAt: now,
    });

    // If this was an insurance card, clear the reference on about/data.
    const kind = typeof fileDoc.data.kind === "string" ? fileDoc.data.kind : "";
    if (kind === "insurance_card_front" || kind === "insurance_card_back") {
      const side = kind === "insurance_card_front" ? "front" : "back";
      const aboutDoc = await getDocument(`${PCP_CASES_COLLECTION}/${caseId}/about`, "data");
      const prevCards =
        (aboutDoc?.data.insuranceCards as CaseAboutDoc["insuranceCards"] | undefined) ?? {
          front: null,
          back: null,
        };
      if (prevCards[side]?.fileId === fileId) {
        await upsertDocument(`${PCP_CASES_COLLECTION}/${caseId}/about`, "data", {
          insuranceCards: { ...prevCards, [side]: null },
          updatedAt: now,
          updatedByUserId: userId,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (err as any)?.status ?? 500;
    console.error("[documents DELETE] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed." },
      { status }
    );
  }
}

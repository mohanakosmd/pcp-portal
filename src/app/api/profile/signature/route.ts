import { NextResponse } from "next/server";

import { readSessionUserId } from "@/lib/auth";
import { CHUNK_CHARS } from "@/lib/case-files";
import { PCP_USERS_COLLECTION } from "@/lib/firebase";
import {
  batchGetDocuments,
  commitWrites,
  getDocument,
  nowIso,
  upsertDocument,
  type CommitWrite,
} from "@/lib/firestore-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const BATCH_TIMEOUT_MS = 60_000;

// Signature bytes are stored as base64 chunk docs in Firestore (the project's
// Storage bucket isn't writable with our credentials — see case-files.ts). They
// live in a subcollection off the user doc; the user doc itself only carries
// lightweight metadata so dashboard reads of pcp_users stay small.
function sigChunksCollection(userId: string): string {
  return `${PCP_USERS_COLLECTION}/${userId}/sig_chunks`;
}

async function deleteChunks(userId: string, chunkCount: number): Promise<void> {
  if (chunkCount <= 0) return;
  const col = sigChunksCollection(userId);
  const writes: CommitWrite[] = Array.from({ length: chunkCount }, (_, i) => ({
    type: "delete",
    path: `${col}/${i}`,
  }));
  await commitWrites(writes, { timeoutMs: BATCH_TIMEOUT_MS });
}

// GET — stream the stored signature image back for use in <img src>.
export async function GET() {
  const userId = await readSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  try {
    const user = await getDocument(PCP_USERS_COLLECTION, userId);
    const chunkCount =
      typeof user?.data.signatureChunkCount === "number"
        ? user.data.signatureChunkCount
        : 0;
    const contentType =
      typeof user?.data.signatureContentType === "string"
        ? user.data.signatureContentType
        : "image/png";
    if (!user || chunkCount <= 0) {
      return NextResponse.json({ error: "No signature on file." }, { status: 404 });
    }

    const col = sigChunksCollection(userId);
    const paths = Array.from({ length: chunkCount }, (_, i) => `${col}/${i}`);
    const docs = await batchGetDocuments(paths, { timeoutMs: BATCH_TIMEOUT_MS });
    let base64 = "";
    for (let i = 0; i < chunkCount; i++) {
      const doc = docs.get(`${col}/${i}`);
      base64 += doc && typeof doc.data.data === "string" ? doc.data.data : "";
    }

    const bytes = Buffer.from(base64, "base64");
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (err) {
    console.error("[profile signature GET] error:", err);
    return NextResponse.json({ error: "Failed to load signature." }, { status: 500 });
  }
}

// POST — replace the signature with a newly uploaded image.
export async function POST(request: Request) {
  const userId = await readSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  try {
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
      return NextResponse.json({ error: "File is empty." }, { status: 400 });
    }
    if (file.size > MAX_SIGNATURE_BYTES) {
      return NextResponse.json({ error: "Image exceeds the 2 MB limit." }, { status: 413 });
    }
    const contentType = file.type || "application/octet-stream";
    if (!ALLOWED_TYPES.has(contentType)) {
      return NextResponse.json({ error: "Use a PNG, JPG, or WEBP image." }, { status: 415 });
    }

    const user = await getDocument(PCP_USERS_COLLECTION, userId);
    if (!user || user.data.verified !== true) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

    // Clear any previous chunks first so a shorter new image leaves none behind.
    const prevCount =
      typeof user.data.signatureChunkCount === "number" ? user.data.signatureChunkCount : 0;
    await deleteChunks(userId, prevCount);

    // Write the new chunks.
    const col = sigChunksCollection(userId);
    const writes: CommitWrite[] = [];
    let chunkCount = 0;
    for (let i = 0; i < base64.length; i += CHUNK_CHARS) {
      writes.push({
        type: "set",
        path: `${col}/${chunkCount}`,
        data: { data: base64.slice(i, i + CHUNK_CHARS) },
      });
      chunkCount++;
    }
    if (chunkCount === 0) {
      writes.push({ type: "set", path: `${col}/0`, data: { data: "" } });
      chunkCount = 1;
    }
    await commitWrites(writes, { timeoutMs: BATCH_TIMEOUT_MS });

    const now = nowIso();
    await upsertDocument(PCP_USERS_COLLECTION, userId, {
      signatureContentType: contentType,
      signatureChunkCount: chunkCount,
      signatureUpdatedAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ ok: true, version: now });
  } catch (err) {
    console.error("[profile signature POST] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Signature upload failed." },
      { status: 500 }
    );
  }
}

// DELETE — remove the stored signature entirely.
export async function DELETE() {
  const userId = await readSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  try {
    const user = await getDocument(PCP_USERS_COLLECTION, userId);
    if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    const prevCount =
      typeof user.data.signatureChunkCount === "number" ? user.data.signatureChunkCount : 0;
    await deleteChunks(userId, prevCount);

    const now = nowIso();
    await upsertDocument(PCP_USERS_COLLECTION, userId, {
      signatureContentType: "",
      signatureChunkCount: 0,
      signatureUpdatedAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[profile signature DELETE] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to remove signature." },
      { status: 500 }
    );
  }
}

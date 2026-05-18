// File storage for case documents, backed entirely by Firestore.
//
// The project's Firebase Storage bucket isn't writable with the credentials we
// have, so file bytes are base64-encoded and stored in Firestore. A single
// Firestore document is capped at 1 MiB, so anything larger is split across
// chunk documents:
//
//   pcp_cases/{caseId}/documents/{fileId}              ← metadata (no bytes)
//   pcp_cases/{caseId}/documents/{fileId}/chunks/{i}   ← { data: <base64 slice> }
//
// `chunkCount` on the metadata doc says how many chunk docs to read back.
//
// Writes/reads/deletes go through Firestore's batch endpoints (:commit /
// :batchGet) so a multi-MB file is a couple of requests, not dozens of
// parallel PATCH/GET calls (which saturate the connection and time out).

import { PCP_CASES_COLLECTION } from "@/lib/cases";
import { batchGetDocuments, commitWrites, type CommitWrite } from "@/lib/firestore-rest";

// Per-chunk base64 length. Comfortably under Firestore's 1 MiB document cap
// (leaves room for the field name + doc overhead).
export const CHUNK_CHARS = 700_000;

// Cap the payload of a single :commit request. A 5 MB file is ~6.99 M base64
// chars → ~10 chunks → ~2 commit requests at this cap.
const MAX_COMMIT_CHARS = 3_500_000;

const BATCH_TIMEOUT_MS = 60_000;

function chunksCollection(caseId: string, fileId: string): string {
  return `${PCP_CASES_COLLECTION}/${caseId}/documents/${fileId}/chunks`;
}

function splitBase64(base64: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < base64.length; i += CHUNK_CHARS) {
    chunks.push(base64.slice(i, i + CHUNK_CHARS));
  }
  if (chunks.length === 0) chunks.push("");
  return chunks;
}

/**
 * Splits a base64 string into chunk documents, written via size-capped
 * `:commit` batches. Returns the chunk count.
 */
export async function writeFileChunks(
  caseId: string,
  fileId: string,
  base64: string
): Promise<number> {
  const chunks = splitBase64(base64);
  const col = chunksCollection(caseId, fileId);

  let batch: CommitWrite[] = [];
  let batchChars = 0;
  for (let i = 0; i < chunks.length; i++) {
    const data = chunks[i];
    if (batch.length > 0 && batchChars + data.length > MAX_COMMIT_CHARS) {
      await commitWrites(batch, { timeoutMs: BATCH_TIMEOUT_MS });
      batch = [];
      batchChars = 0;
    }
    batch.push({ type: "set", path: `${col}/${i}`, data: { data } });
    batchChars += data.length;
  }
  if (batch.length > 0) {
    await commitWrites(batch, { timeoutMs: BATCH_TIMEOUT_MS });
  }
  return chunks.length;
}

/**
 * Reassembles the base64 string from a file's chunk documents using a single
 * `:batchGet` request.
 */
export async function readFileBase64(
  caseId: string,
  fileId: string,
  chunkCount: number
): Promise<string> {
  if (chunkCount <= 0) return "";
  const col = chunksCollection(caseId, fileId);
  const paths = Array.from({ length: chunkCount }, (_, i) => `${col}/${i}`);
  const docs = await batchGetDocuments(paths, { timeoutMs: BATCH_TIMEOUT_MS });
  let out = "";
  for (let i = 0; i < chunkCount; i++) {
    const doc = docs.get(`${col}/${i}`);
    const data = doc && typeof doc.data.data === "string" ? doc.data.data : "";
    out += data;
  }
  return out;
}

/** Deletes every chunk document for a file, via a single `:commit` batch. */
export async function deleteFileChunks(
  caseId: string,
  fileId: string,
  chunkCount: number
): Promise<void> {
  if (chunkCount <= 0) return;
  const col = chunksCollection(caseId, fileId);
  const writes: CommitWrite[] = Array.from({ length: chunkCount }, (_, i) => ({
    type: "delete",
    path: `${col}/${i}`,
  }));
  await commitWrites(writes, { timeoutMs: BATCH_TIMEOUT_MS });
}

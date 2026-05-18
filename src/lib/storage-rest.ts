// Minimal Firebase Storage REST client.
//
// Why REST (not the SDK): same reasoning as firestore-rest.ts — the Firebase
// JS SDK is awkward to run inside Next.js route handlers. The Storage REST
// endpoint is plain HTTPS.
//
// Uploads/deletes are subject to the project's Storage security rules. For the
// demo, rules must allow read/write to `pcp_cases/**` (test mode or an
// explicit allow rule).

const BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

function requireBucket(): string {
  if (!BUCKET) {
    throw new Error("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is not set.");
  }
  return BUCKET;
}

export type UploadedObject = {
  storagePath: string;
  downloadUrl: string;
  contentType: string;
  sizeBytes: number;
};

/**
 * Upload raw bytes to `storagePath` (e.g.
 * `pcp_cases/{caseId}/documents/{fileId}/{filename}`). Returns a tokenized
 * public download URL.
 */
export async function uploadObject(opts: {
  storagePath: string;
  contentType: string;
  bytes: Buffer | Uint8Array;
}): Promise<UploadedObject> {
  const bucket = requireBucket();
  const encodedPath = encodeURIComponent(opts.storagePath);
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?uploadType=media&name=${encodedPath}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": opts.contentType || "application/octet-stream" },
    body: Buffer.from(opts.bytes),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Storage upload failed (${response.status}): ${text}`);
  }

  const meta = (await response.json()) as {
    downloadTokens?: string;
    size?: string;
    contentType?: string;
  };
  const token = meta.downloadTokens?.split(",")[0] ?? "";
  const downloadUrl =
    `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}` +
    `?alt=media${token ? `&token=${token}` : ""}`;

  return {
    storagePath: opts.storagePath,
    downloadUrl,
    contentType: meta.contentType ?? opts.contentType,
    sizeBytes: meta.size ? Number(meta.size) : opts.bytes.byteLength,
  };
}

/** Delete an object. Idempotent: a missing object is treated as success. */
export async function deleteObject(storagePath: string): Promise<void> {
  const bucket = requireBucket();
  const encodedPath = encodeURIComponent(storagePath);
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}`;
  const response = await fetch(url, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`Storage delete failed (${response.status}): ${text}`);
  }
}

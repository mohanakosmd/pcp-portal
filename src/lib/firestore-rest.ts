// Minimal Firestore REST client.
//
// Why: the Firebase JS SDK uses gRPC by default on Node.js and even with
// `experimentalForceLongPolling: true` it can hang/stall inside Next.js
// API routes. The REST API ("https://firestore.googleapis.com/v1/...")
// is plain HTTPS and works reliably from server-side route handlers.
//
// All access is bound to the public Firebase API key + Firestore security
// rules — the same as the JS SDK. Make sure rules allow read/write to
// `pcp_users` for unauthenticated requests in dev.

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

function requireConfig(): { projectId: string; apiKey: string } {
  if (!PROJECT_ID) throw new Error("NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set.");
  if (!API_KEY) throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY is not set.");
  return { projectId: PROJECT_ID, apiKey: API_KEY };
}

function baseUrl(): string {
  const { projectId } = requireConfig();
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

function withKey(url: string): string {
  const { apiKey } = requireConfig();
  return `${url}${url.includes("?") ? "&" : "?"}key=${apiKey}`;
}

// --- Value encoding (JS <-> Firestore "Value" objects) -----------------

type FsValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { timestampValue: string }
  | { arrayValue: { values?: FsValue[] } }
  | { mapValue: { fields?: Record<string, FsValue> } };

type FsDocument = {
  name: string;
  fields?: Record<string, FsValue>;
  createTime?: string;
  updateTime?: string;
};

function encodeValue(value: unknown): FsValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeValue) } };
  }
  if (typeof value === "object") {
    const fields: Record<string, FsValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      fields[k] = encodeValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function decodeValue(value: FsValue): unknown {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) {
    return (value.arrayValue.values ?? []).map(decodeValue);
  }
  if ("mapValue" in value) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value.mapValue.fields ?? {})) {
      out[k] = decodeValue(v);
    }
    return out;
  }
  return undefined;
}

function encodeFields(data: Record<string, unknown>): Record<string, FsValue> {
  const fields: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    fields[k] = encodeValue(v);
  }
  return fields;
}

function decodeFields(doc: FsDocument | null | undefined): Record<string, unknown> {
  if (!doc?.fields) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    out[k] = decodeValue(v);
  }
  return out;
}

// --- HTTP helpers ------------------------------------------------------

async function fetchJson(
  url: string,
  init: RequestInit,
  label: string,
  timeoutMs = 10_000
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    let body: unknown = null;
    const text = await response.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: response.status, body };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

type FirestoreError = {
  error?: { code?: number; message?: string; status?: string };
};

function ensureOk(status: number, body: unknown, label: string): void {
  if (status >= 200 && status < 300) return;
  const message =
    (body as FirestoreError)?.error?.message ??
    (typeof body === "string" ? body : `HTTP ${status}`);
  const err = new Error(`${label} failed: ${message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (err as any).status = status;
  throw err;
}

// --- Public helpers ----------------------------------------------------

export type StoredDoc = {
  id: string;
  data: Record<string, unknown>;
  createTime?: string;
  updateTime?: string;
};

function docIdFromName(name: string): string {
  const parts = name.split("/");
  return parts[parts.length - 1];
}

/**
 * Encode a Firestore collection path that may contain `/` separators (e.g.
 * `pcp_cases/{caseId}/about`). Each segment is `encodeURIComponent`-d
 * individually so the slashes are preserved as path separators.
 */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function getDocument(
  collection: string,
  id: string
): Promise<StoredDoc | null> {
  const url = withKey(`${baseUrl()}/${encodePath(collection)}/${encodeURIComponent(id)}`);
  const { status, body } = await fetchJson(
    url,
    { method: "GET" },
    `Firestore GET ${collection}/${id}`
  );
  if (status === 404) return null;
  ensureOk(status, body, `Firestore GET ${collection}/${id}`);
  const doc = body as FsDocument;
  return {
    id: docIdFromName(doc.name),
    data: decodeFields(doc),
    createTime: doc.createTime,
    updateTime: doc.updateTime,
  };
}

/**
 * Upsert a document at `collection/id`. Behaves like setDoc(..., { merge: true }).
 * Uses the `?updateMask.fieldPaths=...` query to ONLY touch provided fields,
 * preserving any other fields that already exist on the document.
 */
export async function upsertDocument(
  collection: string,
  id: string,
  data: Record<string, unknown>
): Promise<StoredDoc> {
  const fieldPaths = Object.keys(data).filter((k) => data[k] !== undefined);
  const params = new URLSearchParams();
  for (const fp of fieldPaths) params.append("updateMask.fieldPaths", fp);
  // currentDocument.exists not set → upsert (create or update).
  const url = withKey(
    `${baseUrl()}/${encodePath(collection)}/${encodeURIComponent(id)}?${params.toString()}`
  );
  const payload = { fields: encodeFields(data) };
  const { status, body } = await fetchJson(
    url,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    `Firestore UPSERT ${collection}/${id}`
  );
  ensureOk(status, body, `Firestore UPSERT ${collection}/${id}`);
  const doc = body as FsDocument;
  return {
    id: docIdFromName(doc.name),
    data: decodeFields(doc),
    createTime: doc.createTime,
    updateTime: doc.updateTime,
  };
}

/**
 * Atomically create a document. Fails with status 409 (and an error whose
 * `.status` is 409) if the document already exists. Backed by
 * `?currentDocument.exists=false` which Firestore enforces server-side.
 */
export async function createDocument(
  collection: string,
  id: string,
  data: Record<string, unknown>
): Promise<StoredDoc> {
  const fieldPaths = Object.keys(data).filter((k) => data[k] !== undefined);
  const params = new URLSearchParams();
  for (const fp of fieldPaths) params.append("updateMask.fieldPaths", fp);
  params.append("currentDocument.exists", "false");
  const url = withKey(
    `${baseUrl()}/${encodePath(collection)}/${encodeURIComponent(id)}?${params.toString()}`
  );
  const payload = { fields: encodeFields(data) };
  const { status, body } = await fetchJson(
    url,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    `Firestore CREATE ${collection}/${id}`
  );
  if (status === 409) {
    const err = new Error(`Document ${collection}/${id} already exists.`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (err as any).status = 409;
    throw err;
  }
  ensureOk(status, body, `Firestore CREATE ${collection}/${id}`);
  const doc = body as FsDocument;
  return {
    id: docIdFromName(doc.name),
    data: decodeFields(doc),
    createTime: doc.createTime,
    updateTime: doc.updateTime,
  };
}

/**
 * Create a document with a server-generated ID (Firestore auto-ID) by POSTing
 * to the collection — the equivalent of `addDoc()`. Returns the new doc,
 * including its generated `id`.
 */
export async function addDocument(
  collection: string,
  data: Record<string, unknown>
): Promise<StoredDoc> {
  const url = withKey(`${baseUrl()}/${encodePath(collection)}`);
  const payload = { fields: encodeFields(data) };
  const { status, body } = await fetchJson(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    `Firestore ADD ${collection}`
  );
  ensureOk(status, body, `Firestore ADD ${collection}`);
  const doc = body as FsDocument;
  return {
    id: docIdFromName(doc.name),
    data: decodeFields(doc),
    createTime: doc.createTime,
    updateTime: doc.updateTime,
  };
}

export type EqualityFilter = { field: string; value: unknown };

/**
 * Run a structured query against a single collection, AND-ing together a set
 * of equality filters. Returns the matching docs. Pass a small `limit`; this
 * helper does not paginate.
 *
 * Note: a single equality filter is served by Firestore's automatic
 * single-field index. Multiple equality filters may require a composite index
 * — prefer filtering on one field here and narrowing the rest in code.
 */
export async function queryDocuments(
  collection: string,
  filters: EqualityFilter[],
  opts: { limit?: number } = {}
): Promise<StoredDoc[]> {
  const fieldFilters = filters.map((f) => ({
    fieldFilter: {
      field: { fieldPath: f.field },
      op: "EQUAL",
      value: encodeValue(f.value),
    },
  }));

  const structuredQuery: Record<string, unknown> = {
    from: [{ collectionId: collection }],
  };
  if (fieldFilters.length === 1) {
    structuredQuery.where = fieldFilters[0];
  } else if (fieldFilters.length > 1) {
    structuredQuery.where = { compositeFilter: { op: "AND", filters: fieldFilters } };
  }
  if (opts.limit) structuredQuery.limit = opts.limit;

  const { status, body } = await fetchJson(
    withKey(`${baseUrl()}:runQuery`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery }),
    },
    `Firestore QUERY ${collection}`
  );
  ensureOk(status, body, `Firestore QUERY ${collection}`);
  const rows = (body as Array<{ document?: FsDocument }>) ?? [];
  const docs: StoredDoc[] = [];
  for (const row of rows) {
    if (!row.document) continue;
    docs.push({
      id: docIdFromName(row.document.name),
      data: decodeFields(row.document),
      createTime: row.document.createTime,
      updateTime: row.document.updateTime,
    });
  }
  return docs;
}

export type ListPage = {
  docs: StoredDoc[];
  nextPageToken?: string;
};

/** List documents in a collection. Internal `_schema`-style docs are NOT filtered out. */
export async function listDocuments(
  collection: string,
  opts: { pageSize?: number; pageToken?: string } = {}
): Promise<ListPage> {
  const url = new URL(`${baseUrl()}/${encodePath(collection)}`);
  url.searchParams.set("pageSize", String(opts.pageSize ?? 50));
  if (opts.pageToken) url.searchParams.set("pageToken", opts.pageToken);
  const { status, body } = await fetchJson(
    withKey(url.toString()),
    { method: "GET" },
    `Firestore LIST ${collection}`
  );
  ensureOk(status, body, `Firestore LIST ${collection}`);
  const data = body as { documents?: FsDocument[]; nextPageToken?: string };
  const docs: StoredDoc[] = (data.documents ?? []).map((d) => ({
    id: docIdFromName(d.name),
    data: decodeFields(d),
    createTime: d.createTime,
    updateTime: d.updateTime,
  }));
  return { docs, nextPageToken: data.nextPageToken };
}

/** Delete a single document. Idempotent: deleting a missing doc returns null. */
export async function deleteDocument(collection: string, id: string): Promise<void> {
  const url = withKey(`${baseUrl()}/${encodePath(collection)}/${encodeURIComponent(id)}`);
  const { status, body } = await fetchJson(
    url,
    { method: "DELETE" },
    `Firestore DELETE ${collection}/${id}`
  );
  if (status === 404) return;
  ensureOk(status, body, `Firestore DELETE ${collection}/${id}`);
}

// --- Batch operations (:commit / :batchGet) ----------------------------
//
// These exist mainly for chunked file storage (src/lib/case-files.ts):
// `:commit` writes many docs in ONE request with no per-doc echo in the
// response, and `:batchGet` reads many docs in one request. Both are far
// faster and more reliable than firing N parallel PATCH/GET calls.

function docResourceName(path: string): string {
  const { projectId } = requireConfig();
  return `projects/${projectId}/databases/(default)/documents/${path}`;
}

export type CommitWrite =
  | { type: "set"; path: string; data: Record<string, unknown> }
  | { type: "delete"; path: string };

/** Writes/deletes many documents in a single Firestore `:commit` request. */
export async function commitWrites(
  writes: CommitWrite[],
  opts: { timeoutMs?: number } = {}
): Promise<void> {
  if (writes.length === 0) return;
  const body = {
    writes: writes.map((w) =>
      w.type === "delete"
        ? { delete: docResourceName(w.path) }
        : {
            update: {
              name: docResourceName(w.path),
              fields: encodeFields(w.data),
            },
          }
    ),
  };
  const { status, body: resp } = await fetchJson(
    withKey(`${baseUrl()}:commit`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    `Firestore COMMIT (${writes.length} write${writes.length === 1 ? "" : "s"})`,
    opts.timeoutMs ?? 45_000
  );
  ensureOk(status, resp, `Firestore COMMIT (${writes.length} writes)`);
}

/**
 * Reads many documents in a single `:batchGet` request. Returns a map keyed by
 * the original `path` you passed in; missing documents are simply omitted.
 */
export async function batchGetDocuments(
  paths: string[],
  opts: { timeoutMs?: number } = {}
): Promise<Map<string, StoredDoc>> {
  const result = new Map<string, StoredDoc>();
  if (paths.length === 0) return result;

  const { status, body } = await fetchJson(
    withKey(`${baseUrl()}:batchGet`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documents: paths.map(docResourceName) }),
    },
    `Firestore BATCHGET (${paths.length} doc${paths.length === 1 ? "" : "s"})`,
    opts.timeoutMs ?? 45_000
  );
  ensureOk(status, body, `Firestore BATCHGET (${paths.length} docs)`);

  const prefix = docResourceName(""); // ".../documents/"
  const entries = body as Array<{ found?: FsDocument; missing?: string }>;
  for (const entry of entries) {
    if (!entry.found) continue;
    const doc = entry.found;
    const path = doc.name.startsWith(prefix)
      ? doc.name.slice(prefix.length)
      : doc.name;
    result.set(path, {
      id: docIdFromName(doc.name),
      data: decodeFields(doc),
      createTime: doc.createTime,
      updateTime: doc.updateTime,
    });
  }
  return result;
}

export function nowIso(): string {
  return new Date().toISOString();
}

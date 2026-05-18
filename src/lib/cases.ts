// Types + small helpers for the pcp_cases collection. Matches the contract
// in docs/create-case-schema.md.

import { randomBytes } from "crypto";

import { getDocument, listDocuments } from "@/lib/firestore-rest";

export const PCP_CASES_COLLECTION = "pcp_cases";

export type CaseStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "completed"
  | "closed";

export type GenderEnum =
  | "female"
  | "male"
  | "non_binary"
  | "prefer_not_to_say"
  | "other";

export type UrgencyLevel = "routine" | "urgent" | "emergency";

export const GENDER_VALUES: GenderEnum[] = [
  "female",
  "male",
  "non_binary",
  "prefer_not_to_say",
  "other",
];

export const URGENCY_VALUES: UrgencyLevel[] = ["routine", "urgent", "emergency"];

export type InsuranceCardRef = {
  fileId: string;
  storagePath: string;
  uploadedAt: string;
};

export type CaseRootDoc = {
  ownerUserId: string;
  status: CaseStatus;
  currentStep: 1 | 2 | 3;
  title: string;
  shortCode: string;
  aboutComplete: boolean;
  healthComplete: boolean;
  documentsCount: number;
  submittedAt: string | null;
  sharedWithGiUser: string | null;
  sharedWithGiAt: string | null;
  statusUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type CaseAboutDoc = {
  fullLegalName: string;
  age: number | null;
  gender: GenderEnum | null;
  dateOfBirth: string | null;
  address: string | null;
  mobile: string;
  email: string;
  insuranceCarrier: string | null;
  policyId: string | null;
  groupName: string | null;
  effectiveDate: string | null;
  insuranceCards: {
    front: InsuranceCardRef | null;
    back: InsuranceCardRef | null;
  };
  updatedAt: string;
  updatedByUserId: string;
};

export type CaseHealthDoc = {
  inboxMessage: string;
  allergies: string | null;
  currentMedications: string | null;
  existingConditions: string | null;
  recentTestsOrProcedures: string | null;
  familyHistory: string | null;
  lifestyleNotes: string | null;
  urgencyLevel: UrgencyLevel | null;
  updatedAt: string;
  updatedByUserId: string;
};

/** Firestore push-id-style 20-char id (timestamp prefix + random). */
export function generateCaseId(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  // 12 chars of randomness is plenty for our scale; we prefix with a
  // millisecond timestamp encoded in base64url to keep ids sortable by time.
  const ms = Date.now();
  const buf = randomBytes(9); // 9 bytes → 12 base64url chars
  let prefix = "";
  let n = ms;
  for (let i = 0; i < 8; i++) {
    prefix = alphabet[n & 63] + prefix;
    n = Math.floor(n / 64);
  }
  const suffix = buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
    .slice(0, 12);
  return (prefix + suffix).slice(0, 20);
}

/** REQ-##### display id, generated client-side and stored on the case. */
export function generateShortCode(): string {
  const n = Math.floor(10000 + Math.random() * 90000);
  return `REQ-${n}`;
}

/** Throws if the case isn't owned by `userId`. Returns the case data. */
export async function readCaseOwnedBy(
  caseId: string,
  userId: string
): Promise<CaseRootDoc> {
  const doc = await getDocument(PCP_CASES_COLLECTION, caseId);
  if (!doc) {
    const err = new Error(`Case ${caseId} not found.`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (err as any).status = 404;
    throw err;
  }
  const data = doc.data as Partial<CaseRootDoc>;
  if (data.ownerUserId !== userId) {
    const err = new Error("You do not have access to this case.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (err as any).status = 403;
    throw err;
  }
  return data as CaseRootDoc;
}

export function countCompleteAbout(about: Partial<CaseAboutDoc>): {
  filled: number;
  required: number;
  complete: boolean;
} {
  // Required: fullLegalName, age, gender, mobile, email. (5)
  // Optional but counted when present: insuranceCarrier, policyId, groupName,
  // effectiveDate, insuranceCards. (5)
  const requiredOk =
    !!about.fullLegalName &&
    typeof about.age === "number" &&
    !!about.gender &&
    !!about.mobile &&
    !!about.email;
  const filledOptional = [
    about.insuranceCarrier,
    about.policyId,
    about.groupName,
    about.effectiveDate,
    about.insuranceCards?.front || about.insuranceCards?.back ? "x" : null,
  ].filter((v) => v).length;
  const filled = (requiredOk ? 5 : 0) + filledOptional;
  return { filled, required: 5, complete: requiredOk };
}

export function countCompleteHealth(health: Partial<CaseHealthDoc>): {
  complete: boolean;
} {
  // Required: inboxMessage, urgencyLevel.
  return {
    complete: !!health.inboxMessage && !!health.urgencyLevel,
  };
}

export function deriveCaseTitle(opts: {
  fullLegalName?: string | null;
  inboxMessage?: string | null;
  fallback: string;
}): string {
  const name = (opts.fullLegalName || "").trim();
  const summary = (opts.inboxMessage || "").trim().split(/\s+/).slice(0, 6).join(" ");
  if (name && summary) return `${name} · ${summary}`.slice(0, 120);
  if (name) return name.slice(0, 120);
  if (summary) return summary.slice(0, 120);
  return opts.fallback;
}

// -------------------- UI-shaped list loader --------------------

export type CaseListPillVariant =
  | "amber"
  | "rose"
  | "sky"
  | "slate"
  | "emerald";

/**
 * UI-shaped case row used by the /cases page. Mirrors the existing
 * `CaseRecord` in `src/app/(dashboard)/_components/cases-data.ts` so we can
 * swap the mock data in place.
 */
export type CaseListItem = {
  id: string;
  name: string;
  initials: string;
  mrn: string;
  demo: string;
  dob: string;
  status: string;
  statusVariant: CaseListPillVariant;
  updated: string;
  shortUpdated: string;
  condition: string;
  aiFirstSummary: string;
  avatarBg: string;
  // Full About fields — used by the /cases "View Report" modal. Missing
  // values render as "—".
  email: string;
  phone: string;
  address: string;
  insuranceCarrier: string;
  policyId: string;
  groupName: string;
  effectiveDate: string;
  // Raw root fields — used by the "Where things stand" timeline so it can
  // reflect the real case state instead of hardcoded values.
  rawStatus: CaseStatus;
  createdAtIso: string;
  submittedAtIso: string | null;
  sharedWithGiUser: string | null;
  sharedWithGiAtIso: string | null;
  statusUpdatedAtIso: string;
  documentsCount: number;
  // Gemini-generated clinical summary for the report modal (null until first
  // generation). aiFirstSummary is kept as a quick fallback truncation of the
  // inbox message.
  aiSummary: string | null;
  aiSummaryGeneratedAtIso: string | null;
};

const AVATAR_GRADIENTS = [
  "linear-gradient(145deg, #6366f1 0%, #4338ca 45%, #024d9c 100%)",
  "linear-gradient(145deg, #0ea5e9 0%, #0369a1 50%, #1e3a8a 100%)",
  "linear-gradient(145deg, #14b8a6 0%, #0d9488 45%, #0369a1 100%)",
  "linear-gradient(145deg, #f97316 0%, #ea580c 40%, #b91c1c 100%)",
  "linear-gradient(145deg, #a855f7 0%, #7c3aed 45%, #4f46e5 100%)",
  "linear-gradient(145deg, #06b6d4 0%, #0891b2 45%, #155e75 100%)",
];

const STATUS_DISPLAY: Record<
  CaseStatus,
  { label: string; variant: CaseListPillVariant; condition: string }
> = {
  draft: { label: "Draft", variant: "slate", condition: "Draft" },
  submitted: { label: "Pending review", variant: "amber", condition: "Active case" },
  under_review: { label: "In review", variant: "sky", condition: "Active case" },
  completed: { label: "Completed", variant: "emerald", condition: "Closed" },
  closed: { label: "Closed", variant: "slate", condition: "Closed" },
};

const GENDER_DISPLAY: Record<GenderEnum, string> = {
  female: "Female",
  male: "Male",
  non_binary: "Non-binary",
  prefer_not_to_say: "Prefer not to say",
  other: "Other",
};

function pickAvatar(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

function deriveInitials(name: string, fallback: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (cleaned) {
    const parts = cleaned.split(" ");
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? "";
    const initials = (first + last).toUpperCase();
    if (initials) return initials;
  }
  return (fallback.trim()[0] || "?").toUpperCase();
}

function formatUpdated(iso: string): { full: string; short: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { full: "—", short: "—" };
  const month = d.toLocaleDateString(undefined, { month: "short" });
  const day = d.getDate();
  const year = d.getFullYear();
  return {
    full: `Updated ${month} ${day}, ${year}`,
    short: `${month} ${day}`,
  };
}

/**
 * Loads the full UI-shaped case list for the given owner. Joins each case's
 * `about/data` and `health/data` subcollection docs so the patient header and
 * AI summary fields are populated. Sorted by createdAt desc.
 */
export async function loadCasesForOwner(
  userId: string,
  opts: { limit?: number } = {}
): Promise<CaseListItem[]> {
  const page = await listDocuments(PCP_CASES_COLLECTION, { pageSize: 200 });
  const owned = page.docs
    .filter((d) => !d.id.startsWith("_"))
    .filter((d) => d.data.ownerUserId === userId)
    .sort((a, b) =>
      String(b.data.createdAt ?? "").localeCompare(String(a.data.createdAt ?? ""))
    )
    .slice(0, opts.limit ?? 100);

  return Promise.all(
    owned.map(async (root) => {
      const [aboutDoc, healthDoc] = await Promise.all([
        getDocument(`${PCP_CASES_COLLECTION}/${root.id}/about`, "data"),
        getDocument(`${PCP_CASES_COLLECTION}/${root.id}/health`, "data"),
      ]);

      const about = (aboutDoc?.data ?? {}) as Partial<CaseAboutDoc>;
      const health = (healthDoc?.data ?? {}) as Partial<CaseHealthDoc>;

      const status: CaseStatus =
        (typeof root.data.status === "string" ? (root.data.status as CaseStatus) : "draft") ||
        "draft";
      const display = STATUS_DISPLAY[status] ?? STATUS_DISPLAY.draft;

      const fallbackEmail =
        typeof about.email === "string" ? about.email : "";
      const name =
        typeof about.fullLegalName === "string" && about.fullLegalName.trim()
          ? about.fullLegalName
          : fallbackEmail.split("@")[0] || "Untitled case";
      const initials = deriveInitials(name, fallbackEmail);

      const updatedIso =
        typeof root.data.updatedAt === "string"
          ? root.data.updatedAt
          : typeof root.data.createdAt === "string"
            ? root.data.createdAt
            : new Date().toISOString();
      const updated = formatUpdated(updatedIso);

      const ageBit = typeof about.age === "number" ? `${about.age} yrs` : null;
      const genderBit = about.gender ? GENDER_DISPLAY[about.gender] : null;
      const demo = [ageBit, genderBit].filter(Boolean).join(" • ");

      const inbox =
        typeof health.inboxMessage === "string" ? health.inboxMessage : "";
      const aiFirstSummary = inbox.trim()
        ? inbox.trim().slice(0, 240)
        : "No symptom summary captured yet.";

      const shortCode =
        typeof root.data.shortCode === "string" ? root.data.shortCode : root.id;

      const orDash = (v: unknown) =>
        typeof v === "string" && v.trim() ? v.trim() : "—";

      const createdAtIso =
        typeof root.data.createdAt === "string" ? root.data.createdAt : updatedIso;
      const submittedAtIso =
        typeof root.data.submittedAt === "string" ? root.data.submittedAt : null;
      const sharedWithGiUser =
        typeof root.data.sharedWithGiUser === "string" && root.data.sharedWithGiUser
          ? root.data.sharedWithGiUser
          : null;
      const sharedWithGiAtIso =
        typeof root.data.sharedWithGiAt === "string" ? root.data.sharedWithGiAt : null;
      const statusUpdatedAtIso =
        typeof root.data.statusUpdatedAt === "string"
          ? root.data.statusUpdatedAt
          : updatedIso;
      const documentsCount =
        typeof root.data.documentsCount === "number" ? root.data.documentsCount : 0;
      const aiSummary =
        typeof root.data.aiSummary === "string" && root.data.aiSummary
          ? root.data.aiSummary
          : null;
      const aiSummaryGeneratedAtIso =
        typeof root.data.aiSummaryGeneratedAt === "string"
          ? root.data.aiSummaryGeneratedAt
          : null;

      return {
        id: root.id,
        name,
        initials,
        mrn: `#${shortCode}`,
        demo: demo || "—",
        dob: orDash(about.dateOfBirth),
        status: display.label,
        statusVariant: display.variant,
        updated: updated.full,
        shortUpdated: updated.short,
        condition: display.condition,
        aiFirstSummary,
        avatarBg: pickAvatar(root.id),
        email: orDash(about.email),
        phone: orDash(about.mobile),
        address: orDash(about.address),
        insuranceCarrier: orDash(about.insuranceCarrier),
        policyId: orDash(about.policyId),
        groupName: orDash(about.groupName),
        effectiveDate: orDash(about.effectiveDate),
        rawStatus: status,
        createdAtIso,
        submittedAtIso,
        sharedWithGiUser,
        sharedWithGiAtIso,
        statusUpdatedAtIso,
        documentsCount,
        aiSummary,
        aiSummaryGeneratedAtIso,
      };
    })
  );
}

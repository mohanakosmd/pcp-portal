import { NextResponse } from "next/server";

import { readSessionUserId } from "@/lib/auth";
import {
  GENDER_VALUES,
  PCP_CASES_COLLECTION,
  countCompleteAbout,
  deriveCaseTitle,
  readCaseOwnedBy,
  type CaseAboutDoc,
  type GenderEnum,
  type InsuranceCardRef,
} from "@/lib/cases";
import { getDocument, nowIso, upsertDocument } from "@/lib/firestore-rest";
import { ageFromDob } from "@/lib/age";
import { isValidUsPhone } from "@/lib/phone";
import { isUsStateCode, phoneStateMismatch, usStateName } from "@/lib/us-area-codes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AboutBody = Partial<{
  fullLegalName: unknown;
  gender: unknown;
  dateOfBirth: unknown;
  address: unknown;
  state: unknown;
  mobile: unknown;
  email: unknown;
  insuranceCarrier: unknown;
  policyId: unknown;
  groupName: unknown;
  effectiveDate: unknown;
  insuranceCards: unknown;
}>;

function asStr(v: unknown, max?: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return max ? t.slice(0, max) : t;
}

function asGender(v: unknown): GenderEnum | null {
  return typeof v === "string" && (GENDER_VALUES as string[]).includes(v)
    ? (v as GenderEnum)
    : null;
}


/**
 * Returns a specific validation message for the first malformed field present
 * in the body, or null if everything provided is valid. Only validates fields
 * that are actually present + non-empty (this route is a partial PATCH, used by
 * both "Save draft" and "Submit"), so it rejects bad values with a precise
 * reason instead of silently coercing them to null.
 */
function validateAbout(body: AboutBody): string | null {
  const provided = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;

  const email = provided(body.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Enter a valid email address.";
  }

  const gender = provided(body.gender);
  if (gender && !(GENDER_VALUES as string[]).includes(gender)) {
    return "Select a valid gender.";
  }

  const state = provided(body.state);
  if (state && !isUsStateCode(state)) {
    return "Select a valid US state.";
  }

  const dob = provided(body.dateOfBirth);
  if (dob && ageFromDob(dob) == null) {
    return "Enter a valid date of birth (age must be 0–120).";
  }

  const mobile = provided(body.mobile);
  if (mobile) {
    if (!isValidUsPhone(mobile)) return "Enter a valid US phone number.";
    if (state && isUsStateCode(state) && phoneStateMismatch(mobile, state)) {
      return `This phone's area code isn't in ${usStateName(state)} — use a ${usStateName(
        state
      )} number or change the state.`;
    }
  }

  return null;
}

function asInsuranceCardRef(v: unknown): InsuranceCardRef | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.fileId === "string" &&
    typeof o.storagePath === "string" &&
    typeof o.uploadedAt === "string"
  ) {
    return { fileId: o.fileId, storagePath: o.storagePath, uploadedAt: o.uploadedAt };
  }
  return null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const { caseId } = await params;
  const userId = await readSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: AboutBody;
  try {
    body = (await request.json()) as AboutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const validationError = validateAbout(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  try {
    const root = await readCaseOwnedBy(caseId, userId);
    if (root.sharedWithMa === true) {
      return NextResponse.json(
        { error: "This case has been shared with MA and can no longer be edited." },
        { status: 409 }
      );
    }

    const existing = await getDocument(`${PCP_CASES_COLLECTION}/${caseId}/about`, "data");
    const prev = (existing?.data ?? {}) as Partial<CaseAboutDoc>;

    const fullLegalName = asStr(body.fullLegalName, 120) ?? prev.fullLegalName ?? null;
    const gender = asGender(body.gender) ?? prev.gender ?? null;
    const dateOfBirth = asStr(body.dateOfBirth, 12) ?? prev.dateOfBirth ?? null;
    const address = asStr(body.address, 240) ?? prev.address ?? null;
    const state = (isUsStateCode(body.state) ? body.state : null) ?? prev.state ?? null;
    const mobile = asStr(body.mobile, 30) ?? prev.mobile ?? null;
    const email = (asStr(body.email, 200) ?? prev.email ?? "").toLowerCase() || null;
    const insuranceCarrier = asStr(body.insuranceCarrier, 80) ?? prev.insuranceCarrier ?? null;
    const policyId = asStr(body.policyId, 60) ?? prev.policyId ?? null;
    const groupName = asStr(body.groupName, 80) ?? prev.groupName ?? null;
    const effectiveDate = asStr(body.effectiveDate, 12) ?? prev.effectiveDate ?? null;

    const incomingCards =
      body.insuranceCards && typeof body.insuranceCards === "object"
        ? (body.insuranceCards as { front?: unknown; back?: unknown })
        : undefined;
    const prevCards = prev.insuranceCards ?? { front: null, back: null };
    const insuranceCards: CaseAboutDoc["insuranceCards"] = incomingCards
      ? {
          front: asInsuranceCardRef(incomingCards.front) ?? prevCards.front ?? null,
          back: asInsuranceCardRef(incomingCards.back) ?? prevCards.back ?? null,
        }
      : prevCards;

    const now = nowIso();
    const next: CaseAboutDoc = {
      fullLegalName: fullLegalName ?? "",
      gender,
      dateOfBirth,
      address,
      state,
      mobile: mobile ?? "",
      email: email ?? "",
      insuranceCarrier,
      policyId,
      groupName,
      effectiveDate,
      insuranceCards,
      updatedAt: now,
      updatedByUserId: userId,
    };

    await upsertDocument(`${PCP_CASES_COLLECTION}/${caseId}/about`, "data", next);

    // Mirror completion + title on the root doc so list views are cheap.
    const completion = countCompleteAbout(next);
    const health = await getDocument(`${PCP_CASES_COLLECTION}/${caseId}/health`, "data");
    const inboxMessage =
      typeof health?.data.inboxMessage === "string" ? health.data.inboxMessage : "";
    const title = deriveCaseTitle({
      fullLegalName: next.fullLegalName,
      inboxMessage,
      fallback: "Untitled case",
    });
    await upsertDocument(PCP_CASES_COLLECTION, caseId, {
      aboutComplete: completion.complete,
      title,
      currentStep: Math.max(1, completion.complete ? 2 : 1),
      updatedAt: now,
    });

    return NextResponse.json({ ok: true, about: next, aboutComplete: completion.complete });
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (err as any)?.status ?? 500;
    console.error("[cases PATCH about] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save About." },
      { status }
    );
  }
}

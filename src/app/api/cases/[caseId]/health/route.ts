import { NextResponse } from "next/server";

import { readSessionUserId } from "@/lib/auth";
import {
  PCP_CASES_COLLECTION,
  URGENCY_VALUES,
  countCompleteHealth,
  deriveCaseTitle,
  readCaseOwnedBy,
  type CaseHealthDoc,
  type UrgencyLevel,
} from "@/lib/cases";
import { getDocument, nowIso, upsertDocument } from "@/lib/firestore-rest";
import { isValidUsPhone } from "@/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HealthBody = Partial<{
  inboxMessage: unknown;
  bmi: unknown;
  allergies: unknown;
  currentMedications: unknown;
  existingConditions: unknown;
  pastSurgicalHistory: unknown;
  socialHistory: unknown;
  recentTestsOrProcedures: unknown;
  familyHistory: unknown;
  lifestyleNotes: unknown;
  primaryCarePhysician: unknown;
  pcpPhone: unknown;
  pcpFax: unknown;
  pharmacyInformation: unknown;
  pharmacyPhone: unknown;
  pharmacyFax: unknown;
  urgencyLevel: unknown;
}>;

function asStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function asUrgency(v: unknown): UrgencyLevel | null {
  return typeof v === "string" && (URGENCY_VALUES as string[]).includes(v)
    ? (v as UrgencyLevel)
    : null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const { caseId } = await params;
  const userId = await readSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: HealthBody;
  try {
    body = (await request.json()) as HealthBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // BMI is optional, but when provided it must be a plausible number. Matches
  // the client-side rule so the message is the same on both sides.
  if (typeof body.bmi === "string" && body.bmi.trim()) {
    const n = Number(body.bmi.trim());
    if (!Number.isFinite(n) || n < 10 || n > 80) {
      return NextResponse.json(
        { error: "Enter a valid BMI between 10 and 80." },
        { status: 400 }
      );
    }
  }

  // Phone/Fax fields are optional, but when provided each must be a valid US
  // phone number. Mirrors the client-side rule for the same messages.
  const phoneChecks: [keyof HealthBody, string][] = [
    ["pcpPhone", "Enter a valid PCP phone number."],
    ["pcpFax", "Enter a valid PCP fax number."],
    ["pharmacyPhone", "Enter a valid pharmacy phone number."],
    ["pharmacyFax", "Enter a valid pharmacy fax number."],
  ];
  for (const [key, message] of phoneChecks) {
    const v = body[key];
    if (typeof v === "string" && v.trim() && !isValidUsPhone(v)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  try {
    const root = await readCaseOwnedBy(caseId, userId);
    if (root.sharedWithMa === true) {
      return NextResponse.json(
        { error: "This case has been shared with MA and can no longer be edited." },
        { status: 409 }
      );
    }

    const existing = await getDocument(`${PCP_CASES_COLLECTION}/${caseId}/health`, "data");
    const prev = (existing?.data ?? {}) as Partial<CaseHealthDoc>;

    // A key that's present in the body (even as "") is an explicit edit — so
    // clearing a field works. Absent keys keep the previous value (callers like
    // create-case only send a subset).
    const has = (k: keyof HealthBody) =>
      Object.prototype.hasOwnProperty.call(body, k);
    const inboxMessage = has("inboxMessage")
      ? asStr(body.inboxMessage, 4000) ?? ""
      : prev.inboxMessage ?? "";
    const bmi = has("bmi") ? asStr(body.bmi, 20) : prev.bmi ?? null;
    const allergies = has("allergies")
      ? asStr(body.allergies, 1000)
      : prev.allergies ?? null;
    const currentMedications = has("currentMedications")
      ? asStr(body.currentMedications, 1000)
      : prev.currentMedications ?? null;
    const existingConditions = has("existingConditions")
      ? asStr(body.existingConditions, 1000)
      : prev.existingConditions ?? null;
    const pastSurgicalHistory = has("pastSurgicalHistory")
      ? asStr(body.pastSurgicalHistory, 1000)
      : prev.pastSurgicalHistory ?? null;
    const socialHistory = has("socialHistory")
      ? asStr(body.socialHistory, 1000)
      : prev.socialHistory ?? null;
    const recentTestsOrProcedures = has("recentTestsOrProcedures")
      ? asStr(body.recentTestsOrProcedures, 1000)
      : prev.recentTestsOrProcedures ?? null;
    const familyHistory = has("familyHistory")
      ? asStr(body.familyHistory, 1000)
      : prev.familyHistory ?? null;
    const lifestyleNotes = has("lifestyleNotes")
      ? asStr(body.lifestyleNotes, 1000)
      : prev.lifestyleNotes ?? null;
    const primaryCarePhysician = has("primaryCarePhysician")
      ? asStr(body.primaryCarePhysician, 200)
      : prev.primaryCarePhysician ?? null;
    const pcpPhone = has("pcpPhone") ? asStr(body.pcpPhone, 40) : prev.pcpPhone ?? null;
    const pcpFax = has("pcpFax") ? asStr(body.pcpFax, 40) : prev.pcpFax ?? null;
    const pharmacyInformation = has("pharmacyInformation")
      ? asStr(body.pharmacyInformation, 500)
      : prev.pharmacyInformation ?? null;
    const pharmacyPhone = has("pharmacyPhone")
      ? asStr(body.pharmacyPhone, 40)
      : prev.pharmacyPhone ?? null;
    const pharmacyFax = has("pharmacyFax")
      ? asStr(body.pharmacyFax, 40)
      : prev.pharmacyFax ?? null;
    const urgencyLevel = has("urgencyLevel")
      ? asUrgency(body.urgencyLevel)
      : prev.urgencyLevel ?? null;

    const now = nowIso();
    const next: CaseHealthDoc = {
      inboxMessage,
      bmi,
      allergies,
      currentMedications,
      existingConditions,
      pastSurgicalHistory,
      socialHistory,
      recentTestsOrProcedures,
      familyHistory,
      lifestyleNotes,
      primaryCarePhysician,
      pcpPhone,
      pcpFax,
      pharmacyInformation,
      pharmacyPhone,
      pharmacyFax,
      urgencyLevel,
      updatedAt: now,
      updatedByUserId: userId,
    };

    await upsertDocument(`${PCP_CASES_COLLECTION}/${caseId}/health`, "data", next);

    const completion = countCompleteHealth(next);
    const about = await getDocument(`${PCP_CASES_COLLECTION}/${caseId}/about`, "data");
    const fullLegalName =
      typeof about?.data.fullLegalName === "string" ? about.data.fullLegalName : "";
    const title = deriveCaseTitle({
      fullLegalName,
      inboxMessage: next.inboxMessage,
      fallback: "Untitled case",
    });
    await upsertDocument(PCP_CASES_COLLECTION, caseId, {
      healthComplete: completion.complete,
      title,
      currentStep: completion.complete ? 3 : 2,
      updatedAt: now,
    });

    return NextResponse.json({ ok: true, health: next, healthComplete: completion.complete });
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (err as any)?.status ?? 500;
    console.error("[cases PATCH health] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save Health." },
      { status }
    );
  }
}

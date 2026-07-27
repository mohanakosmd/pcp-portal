import "@/styles/create-case.css";

import { readSessionUserId } from "@/lib/auth";
import { PCP_CASES_COLLECTION, type CaseAboutDoc, type GenderEnum } from "@/lib/cases";
import { PCP_USERS_COLLECTION } from "@/lib/firebase";
import { getDocument, listDocuments } from "@/lib/firestore-rest";

import {
  CreateCaseForm,
  type InitialCase,
  type InitialCaseDocument,
  type PcpProfile,
} from "../_components/CreateCaseForm";

type Search = { caseId?: string };

export default async function CreateCasePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { caseId } = await searchParams;
  const [initialCase, pcpProfile] = await Promise.all([
    caseId ? loadInitialCase(caseId) : Promise.resolve(null),
    loadPcpProfile(),
  ]);
  return <CreateCaseForm initialCase={initialCase} pcpProfile={pcpProfile} />;
}

// The logged-in provider IS the PCP, so their own name and phone prefill the
// "Primary Care Physician" fields on the Health step (a new case, or any PCP
// field left blank on a resumed draft — see CreateCaseForm).
async function loadPcpProfile(): Promise<PcpProfile | null> {
  const userId = await readSessionUserId();
  if (!userId) return null;
  const user = await getDocument(PCP_USERS_COLLECTION, userId);
  if (!user) return null;
  const name = typeof user.data.name === "string" ? user.data.name : "";
  const phone = typeof user.data.mobile === "string" ? user.data.mobile : "";
  return { name, phone };
}

async function loadInitialCase(caseId: string): Promise<InitialCase | null> {
  const userId = await readSessionUserId();
  if (!userId) return null;

  const root = await getDocument(PCP_CASES_COLLECTION, caseId);
  if (!root || root.data.ownerUserId !== userId) return null;

  const [aboutDoc, healthDoc, docsPage] = await Promise.all([
    getDocument(`${PCP_CASES_COLLECTION}/${caseId}/about`, "data"),
    getDocument(`${PCP_CASES_COLLECTION}/${caseId}/health`, "data"),
    listDocuments(`${PCP_CASES_COLLECTION}/${caseId}/documents`, { pageSize: 100 }),
  ]);

  const about = (aboutDoc?.data ?? {}) as Partial<CaseAboutDoc>;
  const health = (healthDoc?.data ?? {}) as {
    inboxMessage?: string;
    currentMedications?: string | null;
    bmi?: string | null;
    allergies?: string | null;
    pastSurgicalHistory?: string | null;
    socialHistory?: string | null;
    primaryCarePhysician?: string | null;
    pcpPhone?: string | null;
    pcpFax?: string | null;
    pcpPhoneFax?: string | null;
    pharmacyInformation?: string | null;
    pharmacyPhone?: string | null;
    pharmacyFax?: string | null;
    pharmacyPhoneFax?: string | null;
  };

  const docs: InitialCaseDocument[] = docsPage.docs
    .filter((d) => !d.id.startsWith("_"))
    .map((d) => ({
      fileId: d.id,
      fileName: typeof d.data.fileName === "string" ? d.data.fileName : "",
      contentType: typeof d.data.contentType === "string" ? d.data.contentType : "",
      sizeBytes: typeof d.data.sizeBytes === "number" ? d.data.sizeBytes : 0,
      kind: typeof d.data.kind === "string" ? d.data.kind : "other",
      uploadedAt: typeof d.data.uploadedAt === "string" ? d.data.uploadedAt : "",
      url: `/api/cases/${caseId}/documents/${d.id}`,
    }));

  const insuranceFront = docs.find((d) => d.kind === "insurance_card_front");
  const insuranceBack = docs.find((d) => d.kind === "insurance_card_back");

  const rawStep =
    typeof root.data.currentStep === "number" ? root.data.currentStep : 1;
  const currentStep = (rawStep === 2 || rawStep === 3 ? rawStep : 1) as 1 | 2 | 3;

  return {
    caseId,
    currentStep,
    about: {
      fullLegalName: about.fullLegalName ?? "",
      gender: (about.gender as GenderEnum | undefined) ?? "",
      dateOfBirth: about.dateOfBirth ?? "",
      address: about.address ?? "",
      state: about.state ?? "",
      mobile: about.mobile ?? "",
      email: about.email ?? "",
      insuranceCarrier: about.insuranceCarrier ?? "",
      policyId: about.policyId ?? "",
      groupName: about.groupName ?? "",
      effectiveDate: about.effectiveDate ?? "",
      insuranceFrontUrl: insuranceFront?.url ?? null,
      insuranceBackUrl: insuranceBack?.url ?? null,
    },
    health: {
      inboxMessage: health.inboxMessage ?? "",
      currentMedications: health.currentMedications ?? "",
      bmi: health.bmi ?? "",
      allergies: health.allergies ?? "",
      pastSurgicalHistory: health.pastSurgicalHistory ?? "",
      socialHistory: health.socialHistory ?? "",
      primaryCarePhysician: health.primaryCarePhysician ?? "",
      // Legacy fallback: pre-split drafts stored a combined pcpPhoneFax — show it
      // under Phone so the value isn't lost when the draft is resumed.
      pcpPhone: health.pcpPhone ?? health.pcpPhoneFax ?? "",
      pcpFax: health.pcpFax ?? "",
      pharmacyInformation: health.pharmacyInformation ?? "",
      pharmacyPhone: health.pharmacyPhone ?? health.pharmacyPhoneFax ?? "",
      pharmacyFax: health.pharmacyFax ?? "",
    },
    // Step 3 list = everything that ISN'T an insurance card.
    documents: docs.filter(
      (d) => d.kind !== "insurance_card_front" && d.kind !== "insurance_card_back"
    ),
  };
}

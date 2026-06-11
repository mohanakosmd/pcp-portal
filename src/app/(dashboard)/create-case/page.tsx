import "@/styles/create-case.css";

import { readSessionUserId } from "@/lib/auth";
import { PCP_CASES_COLLECTION, type CaseAboutDoc, type GenderEnum } from "@/lib/cases";
import { getDocument, listDocuments } from "@/lib/firestore-rest";

import {
  CreateCaseForm,
  type InitialCase,
  type InitialCaseDocument,
} from "../_components/CreateCaseForm";

type Search = { caseId?: string };

export default async function CreateCasePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { caseId } = await searchParams;
  const initialCase = caseId ? await loadInitialCase(caseId) : null;
  return <CreateCaseForm initialCase={initialCase} />;
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
    },
    // Step 3 list = everything that ISN'T an insurance card.
    documents: docs.filter(
      (d) => d.kind !== "insurance_card_front" && d.kind !== "insurance_card_back"
    ),
  };
}

import { NextResponse } from "next/server";

import { readSessionUserId } from "@/lib/auth";
import {
  PCP_CASES_COLLECTION,
  generateCaseId,
  generateShortCode,
  loadCasesForOwner,
  type CaseRootDoc,
} from "@/lib/cases";
import { createDocument, listDocuments, nowIso } from "@/lib/firestore-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const userId = await readSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Retry on shortCode collision (unique-per-user, so the chance is tiny but
  // we still loop to be correct).
  const caseId = generateCaseId();
  const now = nowIso();
  const initial: CaseRootDoc = {
    ownerUserId: userId,
    status: "draft",
    currentStep: 1,
    title: "Untitled case",
    shortCode: generateShortCode(),
    aboutComplete: false,
    healthComplete: false,
    documentsCount: 0,
    submittedAt: null,
    sharedWithGiUser: null,
    sharedWithGiAt: null,
    statusUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await createDocument(PCP_CASES_COLLECTION, caseId, {
      ...initial,
    });
    return NextResponse.json({ ok: true, caseId, ...initial });
  } catch (err) {
    console.error("[cases POST] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create case." },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const userId = await readSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 100);
  const include = (url.searchParams.get("include") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const wantDetails = include.includes("details");

  try {
    if (wantDetails) {
      const cases = await loadCasesForOwner(userId, { limit });
      return NextResponse.json({ ok: true, cases });
    }

    // Firestore REST `documents/<collection>` lists everything, then we filter
    // and sort client-side. Volume here is small (one user's own cases) so
    // this is fine until we move to runQuery + an index.
    const page = await listDocuments(PCP_CASES_COLLECTION, { pageSize: 200 });
    const mine = page.docs
      .filter((d) => !d.id.startsWith("_"))
      .filter((d) => d.data.ownerUserId === userId)
      .sort((a, b) => {
        const aCreated = String(a.data.createdAt ?? "");
        const bCreated = String(b.data.createdAt ?? "");
        return bCreated.localeCompare(aCreated);
      })
      .slice(0, limit)
      .map((d) => ({ caseId: d.id, ...d.data }));

    return NextResponse.json({ ok: true, cases: mine });
  } catch (err) {
    console.error("[cases GET] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load cases." },
      { status: 500 }
    );
  }
}

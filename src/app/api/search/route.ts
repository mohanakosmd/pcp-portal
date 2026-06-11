import { NextResponse } from "next/server";

import { readSessionUserId } from "@/lib/auth";
import { loadCasesForOwner } from "@/lib/cases";
import { loadGiReportsForOwner } from "@/lib/gi-reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Global topbar search. Returns the current PCP's cases and finalized GI
 * reports that match the query `q`. Matching is a simple case-insensitive
 * substring over the human-facing fields (patient name, request id, status…).
 */
export async function GET(request: Request) {
  const userId = await readSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  // Wait for at least 2 characters so we don't run a full scan on every
  // keystroke for a single letter.
  if (q.length < 2) {
    return NextResponse.json({ cases: [], reports: [] });
  }

  try {
    const [cases, reports] = await Promise.all([
      loadCasesForOwner(userId, { limit: 200 }),
      loadGiReportsForOwner(userId),
    ]);

    const matches = (fields: (string | null | undefined)[]) =>
      fields.some((f) => typeof f === "string" && f.toLowerCase().includes(q));

    const caseMatches = cases
      .filter((c) =>
        matches([c.name, c.mrn, c.status, c.email, c.phone, c.insuranceCarrier])
      )
      .slice(0, 6)
      .map((c) => ({ id: c.id, name: c.name, mrn: c.mrn, status: c.status }));

    const reportMatches = reports
      .filter((r) =>
        matches([
          r.reportName,
          r.patientName,
          r.caseShortCode,
          r.status,
          r.giSpecialistName,
        ])
      )
      .slice(0, 6)
      .map((r) => ({
        id: r.id,
        reportName: r.reportName,
        patientName: r.patientName,
        caseShortCode: r.caseShortCode,
      }));

    return NextResponse.json({ cases: caseMatches, reports: reportMatches });
  } catch (err) {
    console.error("[search GET] error:", err);
    return NextResponse.json({ error: "Search failed." }, { status: 500 });
  }
}

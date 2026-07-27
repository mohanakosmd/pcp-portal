import "@/styles/reports.css";
// Also load the create-case styles for the Speak-to-Text mic button
// (.cc-speech-btn / .cc-field-hint) on the remark box.
import "@/styles/create-case.css";

import { readSessionUserId } from "@/lib/auth";
import { loadGiReportsForOwner } from "@/lib/gi-reports";

import { ReportsView } from "../_components/ReportsView";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string; q?: string }>;
}) {
  const userId = await readSessionUserId();
  const reports = userId ? await loadGiReportsForOwner(userId) : [];
  const { focus, q } = await searchParams;
  return (
    <ReportsView
      reports={reports}
      focusId={typeof focus === "string" ? focus : null}
      initialFilter={typeof q === "string" ? q : null}
    />
  );
}

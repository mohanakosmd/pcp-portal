import "@/styles/reports.css";

import { readSessionUserId } from "@/lib/auth";
import { loadGiReportsForOwner } from "@/lib/gi-reports";

import { ReportsView } from "../_components/ReportsView";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const userId = await readSessionUserId();
  const reports = userId ? await loadGiReportsForOwner(userId) : [];
  return <ReportsView reports={reports} />;
}

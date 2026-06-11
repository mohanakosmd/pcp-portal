import "@/styles/cases.css";

import { readSessionUserId } from "@/lib/auth";
import { loadCasesForOwner } from "@/lib/cases";

import { CasesView } from "../_components/CasesView";

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; focus?: string; q?: string }>;
}) {
  const userId = await readSessionUserId();
  const cases = userId ? await loadCasesForOwner(userId, { limit: 100 }) : [];
  const { notice, focus, q } = await searchParams;
  return (
    <CasesView
      cases={cases}
      notice={typeof notice === "string" ? notice : null}
      focusId={typeof focus === "string" ? focus : null}
      initialFilter={typeof q === "string" ? q : null}
    />
  );
}

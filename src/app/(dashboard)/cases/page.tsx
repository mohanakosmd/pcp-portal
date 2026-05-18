import "@/styles/cases.css";

import { readSessionUserId } from "@/lib/auth";
import { loadCasesForOwner } from "@/lib/cases";

import { CasesView } from "../_components/CasesView";

export default async function CasesPage() {
  const userId = await readSessionUserId();
  const cases = userId ? await loadCasesForOwner(userId, { limit: 100 }) : [];
  return <CasesView cases={cases} />;
}

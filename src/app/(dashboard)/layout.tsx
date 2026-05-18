import { redirect } from "next/navigation";

import "@/styles/dashboard.css";

import { readSessionUserId } from "@/lib/auth";
import { PCP_USERS_COLLECTION } from "@/lib/firebase";
import { getDocument } from "@/lib/firestore-rest";

import { DashFooter } from "./_components/DashFooter";
import { DashShellBehavior } from "./_components/DashShellBehavior";
import { DashSidebar } from "./_components/DashSidebar";
import { DashTopbar } from "./_components/DashTopbar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userId = await readSessionUserId();
  if (!userId) {
    redirect("/login");
  }

  const user = await getDocument(PCP_USERS_COLLECTION, userId);
  if (!user || user.data.verified !== true) {
    redirect("/login");
  }

  const name = typeof user.data.name === "string" ? user.data.name : "";
  const email = typeof user.data.email === "string" ? user.data.email : "";

  return (
    <div className="dash-body">
      <div
        className="dash-sidebar-backdrop"
        id="dash-backdrop"
        aria-hidden="true"
        tabIndex={-1}
      />

      <div className="dash-layout" id="dash-layout">
        <DashSidebar />

        <div className="dash-shell">
          <DashTopbar name={name} email={email} />
          {children}
          <DashFooter />
        </div>
      </div>

      <DashShellBehavior />
    </div>
  );
}

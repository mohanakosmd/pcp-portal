import "@/styles/profile.css";

import { readSessionUserId } from "@/lib/auth";
import { PCP_USERS_COLLECTION } from "@/lib/firebase";
import { getDocument } from "@/lib/firestore-rest";

import { ProfileView, type ProfileData } from "../_components/ProfileView";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const userId = await readSessionUserId();
  const user = userId ? await getDocument(PCP_USERS_COLLECTION, userId) : null;

  const data = user?.data ?? {};
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const profile: ProfileData = {
    name: str(data.name),
    email: str(data.email),
    mobile: str(data.mobile),
    phoneDial: str(data.phoneDial),
    fax: str(data.fax),
    gender: str(data.gender),
    npiNumber: str(data.npiNumber),
    npiCredential: str(data.npiCredential),
    specialty: str(data.specialty),
  };

  return <ProfileView profile={profile} />;
}

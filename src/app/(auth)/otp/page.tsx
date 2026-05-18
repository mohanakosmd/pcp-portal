import Link from "next/link";

import { AuthBrandHeader } from "../_components/AuthBrandHeader";
import { OtpForm } from "../_components/OtpForm";

type Search = { email?: string };

export default async function OtpPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { email } = await searchParams;
  const safeEmail = (email && typeof email === "string" ? email : "").trim();

  return (
    <>
      <AuthBrandHeader />
      <OtpForm email={safeEmail || "your registered email"} />
      <Link href="/login" className="auth-back auth-back--panel-bl" aria-label="Go back to login">
        Back
      </Link>
    </>
  );
}

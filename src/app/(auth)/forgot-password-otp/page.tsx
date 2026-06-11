import Link from "next/link";

import { AuthBrandHeader } from "../_components/AuthBrandHeader";
import { ForgotPasswordOtpForm } from "../_components/ForgotPasswordOtpForm";

type Search = { email?: string };

export default async function ForgotPasswordOtpPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { email } = await searchParams;
  const safeEmail = (email && typeof email === "string" ? email : "").trim();

  return (
    <>
      <AuthBrandHeader />
      <ForgotPasswordOtpForm email={safeEmail} />
      <Link
        href="/forgot-password"
        className="auth-back auth-back--panel-bl"
        aria-label="Back to forgot password"
      >
        Back
      </Link>
    </>
  );
}

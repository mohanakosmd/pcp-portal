import Link from "next/link";

import { AuthBrandHeader } from "../_components/AuthBrandHeader";
import { ForgotPasswordOtpForm } from "../_components/ForgotPasswordOtpForm";

export default function ForgotPasswordOtpPage() {
  return (
    <>
      <AuthBrandHeader />
      <ForgotPasswordOtpForm email="jhon_travis@outlook.com" />
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

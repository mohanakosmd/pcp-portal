import Link from "next/link";

import { AuthBrandHeader } from "../_components/AuthBrandHeader";
import { ForgotPasswordForm } from "../_components/ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthBrandHeader />
      <ForgotPasswordForm />
      <Link href="/login" className="auth-back auth-back--panel-bl" aria-label="Back to login">
        Back
      </Link>
    </>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ForgotPasswordForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    router.push("/forgot-password-otp");
  };

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <div>
        <h2 className="section-title section-title--left">Reset your password</h2>
        <p className="section-hint section-hint--left">
          Forgot your password? Please enter your email and we&apos;ll send you a 6-digit code.
        </p>
        <label className="field-label" htmlFor="email">
          Email
        </label>
        <div className="input-modern">
          <span className="input-modern__icon" aria-hidden="true">
            <svg width="15" height="12" viewBox="0 0 15 12" fill="none">
              <path
                d="M1.5 12C1.0875 12 0.734375 11.8531 0.440625 11.5594C0.146875 11.2656 0 10.9125 0 10.5V1.5C0 1.0875 0.146875 0.734375 0.440625 0.440625C0.734375 0.146875 1.0875 0 1.5 0H13.5C13.9125 0 14.2656 0.146875 14.5594 0.440625C14.8531 0.734375 15 1.0875 15 1.5V10.5C15 10.9125 14.8531 11.2656 14.5594 11.5594C14.2656 11.8531 13.9125 12 13.5 12H1.5V12M7.5 6.75L1.5 3V10.5V10.5V10.5H13.5V10.5V10.5V3L7.5 6.75V6.75M7.5 5.25L13.5 1.5H1.5L7.5 5.25V5.25M1.5 3V1.5V1.5V3V10.5V10.5V10.5V10.5V10.5V10.5V3V3"
                fill="#737783"
              />
            </svg>
          </span>
          <input
            id="email"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
      </div>

      <button type="submit" className="action-btn" aria-label="Get OTP">
        <span>Get OTP</span>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M2.33334 7H11.6667M11.6667 7L7.00001 2.33333M11.6667 7L7.00001 11.6667"
            stroke="white"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </form>
  );
}

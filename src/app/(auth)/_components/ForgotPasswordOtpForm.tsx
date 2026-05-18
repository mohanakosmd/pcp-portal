"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const OTP_LENGTH = 6;
const INITIAL_SECONDS = 60;

export function ForgotPasswordOtpForm({ email }: { email: string }) {
  const router = useRouter();
  const [digits, setDigits] = useState<string[]>(() => ["1", "2", "3", "4", "5", "6"]);
  const [secondsLeft, setSecondsLeft] = useState(INITIAL_SECONDS);
  const [toastState, setToastState] = useState<"hidden" | "show" | "leave">("hidden");
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const handleDigitChange = (index: number, value: string) => {
    const cleaned = value.replace(/\D/g, "");
    if (!cleaned) {
      setDigits((prev) => {
        const next = [...prev];
        next[index] = "";
        return next;
      });
      return;
    }
    setDigits((prev) => {
      const next = [...prev];
      const chars = cleaned.split("");
      for (let i = 0; i < chars.length && index + i < OTP_LENGTH; i++) {
        next[index + i] = chars[i];
      }
      return next;
    });
    const nextIndex = Math.min(index + cleaned.length, OTP_LENGTH - 1);
    inputsRef.current[nextIndex]?.focus();
    inputsRef.current[nextIndex]?.select();
  };

  const handleKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
      inputsRef.current[index - 1]?.select();
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      inputsRef.current[index - 1]?.focus();
      inputsRef.current[index - 1]?.select();
    } else if (event.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      event.preventDefault();
      inputsRef.current[index + 1]?.focus();
      inputsRef.current[index + 1]?.select();
    }
  };

  const handleVerify = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    router.push("/reset-password");
  };

  const handleResend = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    setSecondsLeft(INITIAL_SECONDS);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    setToastState("show");
    hideTimerRef.current = setTimeout(() => setToastState("leave"), 4000);
    resetTimerRef.current = setTimeout(() => setToastState("hidden"), 4500);
  };

  const timerText = secondsLeft > 0 ? `${secondsLeft} Sec Remaining` : "OTP expired";

  const toastClassName = [
    "otp-toast",
    toastState === "show" || toastState === "leave" ? "otp-toast--show" : "",
    toastState === "leave" ? "otp-toast--leave" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <form className="form-stack form-stack--otp" onSubmit={handleVerify}>
        <div>
          <h2 className="section-title">Enter verification code</h2>
          <p className="section-hint">Enter the 6-digit code we sent to your email.</p>

          <div className="otp-boxes" aria-label="6 digit OTP blocks">
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={(el) => {
                  inputsRef.current[index] = el;
                }}
                className="otp-box"
                type="text"
                value={digit}
                maxLength={1}
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label={`Digit ${index + 1}`}
                onChange={(e) => handleDigitChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                onFocus={(e) => e.target.select()}
              />
            ))}
          </div>

          <p className="otp-instruction">
            Enter the code sent to your registered Email ID.{" "}
            <span className="otp-email">{email}</span>
          </p>
          <p className="otp-timer">{timerText}</p>
        </div>

        <button className="action-btn" type="submit" aria-label="Verify and reset password">
          <span>Verify</span>
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

        <a className="resend-link" href="#" onClick={handleResend}>
          Didn&apos;t receive the code?
        </a>
      </form>

      <div
        className={toastClassName}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-hidden={toastState === "hidden"}
      >
        <p className="otp-toast__text">
          We&apos;ve sent a new OTP to {email} and your registered mobile number.
        </p>
      </div>
    </>
  );
}

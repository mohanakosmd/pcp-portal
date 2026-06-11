"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const OTP_LENGTH = 6;
// Visible countdown / resend cooldown. The code itself stays valid for the
// server window (OTP_TTL_SECONDS = 5 min); this 1-minute timer only gates when
// the "Resend" link appears. Server rejects a genuinely expired code.
const INITIAL_SECONDS = 60;

function formatRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")} Remaining`;
}

export function OtpForm({ email }: { email: string }) {
  const router = useRouter();
  const [digits, setDigits] = useState<string[]>(() => Array(OTP_LENGTH).fill(""));
  const [secondsLeft, setSecondsLeft] = useState(INITIAL_SECONDS);
  const [toastState, setToastState] = useState<"hidden" | "show" | "leave">("hidden");
  const [toastMessage, setToastMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
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

  const showToast = (message: string) => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    setToastMessage(message);
    setToastState("show");
    hideTimerRef.current = setTimeout(() => setToastState("leave"), 4000);
    resetTimerRef.current = setTimeout(() => setToastState("hidden"), 4500);
  };

  const handleVerify = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const code = digits.join("");
    if (code.length !== OTP_LENGTH) {
      setError("Enter the full 6-digit code.");
      inputsRef.current[digits.findIndex((d) => !d) || 0]?.focus();
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      let data: { error?: string } = {};
      try {
        data = (await response.json()) as { error?: string };
      } catch {
        // ignore
      }
      if (!response.ok) {
        setError(data.error || "Verification failed.");
        return;
      }
      router.push("/dashboard");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      let data: { error?: string; routedTo?: string } = {};
      try {
        data = (await response.json()) as { error?: string; routedTo?: string };
      } catch {
        // ignore
      }
      if (!response.ok) {
        setError(data.error || "Could not resend the code.");
        return;
      }
      setDigits(Array(OTP_LENGTH).fill(""));
      setSecondsLeft(INITIAL_SECONDS);
      showToast(`We've sent a new OTP to ${data.routedTo || email}.`);
      inputsRef.current[0]?.focus();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const canResend = secondsLeft <= 0;

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
          <h2 className="section-title">2FA Step: OTP Verification</h2>
          <p className="section-hint">Enter 6-digit Code</p>

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
          {secondsLeft > 0 ? (
            <p className="otp-timer">{formatRemaining(secondsLeft)}</p>
          ) : null}
          {error ? (
            <p
              className="section-hint section-hint--left"
              role="alert"
              style={{ color: "#b91c1c", margin: 0 }}
            >
              {error}
            </p>
          ) : null}
          {canResend ? (
            <a className="resend-link" href="#" onClick={handleResend}>
              Didn&apos;t receive the code?
            </a>
          ) : null}
        </div>

        <button
          className="action-btn"
          type="submit"
          aria-label="Verify and open dashboard"
          disabled={submitting}
        >
          <span>{submitting ? "Verifying…" : "Verify"}</span>
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

      <div
        className={toastClassName}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-hidden={toastState === "hidden"}
      >
        <p className="otp-toast__text">{toastMessage}</p>
      </div>
    </>
  );
}

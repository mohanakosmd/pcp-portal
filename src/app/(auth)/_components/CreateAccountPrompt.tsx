"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Step = "request" | "otp" | "password";

const OTP_LENGTH = 6;
const INITIAL_SECONDS = 60;

type ToastState = {
  message: string;
  state: "show" | "leave" | "hidden";
};

export function CreateAccountPrompt() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("request");

  const [name, setName] = useState("Jhon Travis");
  const [email, setEmail] = useState("jhon_travis@outlook.com");
  const [mobile, setMobile] = useState("+1 (555) 214-8890");

  const [userId, setUserId] = useState<string>("");
  const [requestError, setRequestError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [otpDigits, setOtpDigits] = useState<string[]>(() =>
    Array.from({ length: OTP_LENGTH }, () => "")
  );
  const [secondsLeft, setSecondsLeft] = useState(INITIAL_SECONDS);
  const [otpError, setOtpError] = useState("");
  const otpInputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  const [toast, setToast] = useState<ToastState>({ message: "", state: "hidden" });
  const toastHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestFormRef = useRef<HTMLFormElement | null>(null);

  const closeModal = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeModal]);

  useEffect(() => {
    if (step !== "otp") return;
    setSecondsLeft(INITIAL_SECONDS);
  }, [step]);

  useEffect(() => {
    if (step !== "otp" || secondsLeft <= 0) return;
    const id = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [step, secondsLeft]);

  useEffect(() => {
    return () => {
      if (toastHideTimer.current) clearTimeout(toastHideTimer.current);
      if (toastResetTimer.current) clearTimeout(toastResetTimer.current);
    };
  }, []);

  const openModal = (event?: React.MouseEvent<HTMLAnchorElement>) => {
    event?.preventDefault();
    setStep("request");
    setOtpDigits(Array.from({ length: OTP_LENGTH }, () => ""));
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError("");
    setRequestError("");
    setOtpError("");
    setUserId("");
    setSubmitting(false);
    setOpen(true);
  };

  async function callJson(
    url: string,
    payload: Record<string, unknown>
  ): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data: Record<string, unknown> = {};
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      // ignore
    }
    return { ok: response.ok, status: response.status, data };
  }

  const showAccessToast = (message: string) => {
    if (toastHideTimer.current) clearTimeout(toastHideTimer.current);
    if (toastResetTimer.current) clearTimeout(toastResetTimer.current);
    setToast({ message, state: "show" });
    toastHideTimer.current = setTimeout(() => {
      setToast((prev) => ({ ...prev, state: "leave" }));
    }, 3800);
    toastResetTimer.current = setTimeout(() => {
      setToast({ message: "", state: "hidden" });
    }, 4300);
  };

  const handleRequestSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.checkValidity()) {
      event.currentTarget.reportValidity();
      return;
    }
    setSubmitting(true);
    setRequestError("");
    try {
      const { ok, data } = await callJson("/api/auth/signup", { name, email, mobile });
      if (!ok) {
        setRequestError(typeof data.error === "string" ? data.error : "Sign-up failed.");
        return;
      }
      setUserId(typeof data.userId === "string" ? data.userId : "");
      setOtpDigits(Array.from({ length: OTP_LENGTH }, () => ""));
      setOtpError("");
      setStep("otp");
    } catch {
      setRequestError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleOtpChange = (index: number, raw: string) => {
    const cleaned = raw.replace(/\D/g, "");
    if (!cleaned) {
      setOtpDigits((prev) => {
        const next = [...prev];
        next[index] = "";
        return next;
      });
      return;
    }
    setOtpDigits((prev) => {
      const next = [...prev];
      const chars = cleaned.split("");
      for (let i = 0; i < chars.length && index + i < OTP_LENGTH; i++) {
        next[index + i] = chars[i];
      }
      return next;
    });
    const nextIndex = Math.min(index + cleaned.length, OTP_LENGTH - 1);
    otpInputsRef.current[nextIndex]?.focus();
  };

  const handleOtpKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpInputsRef.current[index - 1]?.focus();
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = otpDigits.join("");
    if (code.length !== OTP_LENGTH) {
      otpInputsRef.current[0]?.focus();
      return;
    }
    if (!userId) {
      setOtpError("Session lost. Please start over.");
      return;
    }
    setSubmitting(true);
    setOtpError("");
    try {
      const { ok, data } = await callJson("/api/auth/verify", { userId, code });
      if (!ok) {
        setOtpError(typeof data.error === "string" ? data.error : "Verification failed.");
        return;
      }
      setStep("password");
    } catch {
      setOtpError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendOtp = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setOtpError("");
    try {
      const { ok, data } = await callJson("/api/auth/signup", { name, email, mobile });
      if (!ok) {
        setOtpError(typeof data.error === "string" ? data.error : "Could not resend code.");
        return;
      }
      if (typeof data.userId === "string") setUserId(data.userId);
      setOtpDigits(Array.from({ length: OTP_LENGTH }, () => ""));
      setSecondsLeft(INITIAL_SECONDS);
      showAccessToast(`New OTP sent to ${email || "your email"}.`);
    } catch {
      setOtpError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword && newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    setPasswordError("");
    try {
      const { ok, data } = await callJson("/api/auth/set-password", {
        password: newPassword,
      });
      if (!ok) {
        setPasswordError(
          typeof data.error === "string" ? data.error : "Could not save password."
        );
        return;
      }
      closeModal();
      router.push("/dashboard");
    } catch {
      setPasswordError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const timerText = secondsLeft > 0 ? `${secondsLeft} Sec Remaining` : "OTP expired";

  const modalTitle = step === "password" ? "Set new password" : "Create New Account";

  const toastClassName = [
    "otp-toast",
    "otp-toast--access",
    toast.state === "show" || toast.state === "leave" ? "otp-toast--show" : "",
    toast.state === "leave" ? "otp-toast--leave" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <p className="auth-footnote">
        Don&apos;t have an account?{" "}
        <a href="#request-access" onClick={openModal}>
          Create New Account
        </a>
      </p>

      <div
        className={`access-backdrop${open ? "" : " access-backdrop--hidden"}`}
        role="presentation"
        aria-hidden={!open}
        onClick={closeModal}
      >
        <div
          className="access-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="access-modal-title"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="access-modal__header">
            <h2 className="access-modal__title" id="access-modal-title">
              {modalTitle}
            </h2>
            <button
              type="button"
              className="access-modal__close"
              aria-label="Close"
              onClick={closeModal}
            >
              ×
            </button>
          </div>

          <div
            className={`access-step${step === "request" ? " access-step--active" : " access-step--hidden"}`}
            aria-hidden={step !== "request"}
          >
            <form
              ref={requestFormRef}
              className="access-form"
              noValidate
              onSubmit={handleRequestSubmit}
            >
              <div>
                <label className="field-label" htmlFor="access-name">
                  Full name
                </label>
                <div className="input-modern input-modern--no-icon">
                  <input
                    id="access-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    placeholder="Jane Physician"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                  />
                </div>
              </div>
              <div>
                <label className="field-label" htmlFor="access-email">
                  Email address
                </label>
                <div className="input-modern input-modern--no-icon">
                  <input
                    id="access-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@clinic.org"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </div>
              </div>
              <div>
                <label className="field-label" htmlFor="access-mobile">
                  Mobile number
                </label>
                <div className="input-modern input-modern--no-icon">
                  <input
                    id="access-mobile"
                    name="mobile"
                    type="tel"
                    autoComplete="tel"
                    inputMode="tel"
                    placeholder="+1 (555) 000-0000"
                    value={mobile}
                    onChange={(event) => setMobile(event.target.value)}
                    required
                  />
                </div>
              </div>
              {requestError ? (
                <p
                  className="section-hint section-hint--left"
                  role="alert"
                  style={{ color: "#b91c1c", margin: 0 }}
                >
                  {requestError}
                </p>
              ) : null}
              <button className="btn-primary" type="submit" disabled={submitting}>
                {submitting ? "Sending code…" : "Verify account"}
              </button>
            </form>
          </div>

          <div
            className={`access-step${step === "otp" ? " access-step--active" : " access-step--hidden"}`}
            aria-hidden={step !== "otp"}
          >
            <form className="access-otp-form" noValidate onSubmit={handleOtpSubmit}>
              <h3 className="section-title section-title--left">Verify by OTP</h3>
              <p className="section-hint section-hint--left">
                Enter the 6-digit code sent to your email.
              </p>
              <p className="otp-instruction access-otp-instruction">
                Code sent to <span className="otp-email">{email || "your email"}</span>
              </p>

              <div className="otp-boxes access-otp-boxes" aria-label="6 digit OTP blocks">
                {otpDigits.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => {
                      otpInputsRef.current[index] = el;
                    }}
                    className="otp-box access-otp-box"
                    type="text"
                    value={digit}
                    maxLength={1}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    aria-label={`Digit ${index + 1}`}
                    onChange={(event) => handleOtpChange(index, event.target.value)}
                    onKeyDown={(event) => handleOtpKeyDown(index, event)}
                    onFocus={(event) => event.target.select()}
                    required
                  />
                ))}
              </div>

              <p className="otp-timer">{timerText}</p>
              {otpError ? (
                <p
                  className="section-hint section-hint--left"
                  role="alert"
                  style={{ color: "#b91c1c", margin: 0 }}
                >
                  {otpError}
                </p>
              ) : null}
              <a className="resend-link" href="#" onClick={handleResendOtp}>
                Didn&apos;t receive the code?
              </a>
              <button className="btn-primary" type="submit" disabled={submitting}>
                <span>{submitting ? "Verifying…" : "Verify & Submit"}</span>
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
              <button
                type="button"
                className="access-otp-back access-otp-back--bottom"
                aria-label="Back to account form"
                onClick={() => setStep("request")}
              >
                <span>Back</span>
              </button>
            </form>
          </div>

          <div
            className={`access-step${step === "password" ? " access-step--active" : " access-step--hidden"}`}
            aria-hidden={step !== "password"}
          >
            <form className="access-form" noValidate onSubmit={handlePasswordSubmit}>
              <h3 className="section-title section-title--left">Set new password</h3>
              <p className="section-hint section-hint--left">
                Demo only — set a password for your account (optional).
              </p>
              <div>
                <label className="field-label" htmlFor="access-new-password">
                  New password
                </label>
                <div className="input-modern input-modern--no-icon input-modern--with-toggle">
                  <input
                    id="access-new-password"
                    name="new-password"
                    type={showNewPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Enter a password"
                    value={newPassword}
                    onChange={(event) => {
                      setNewPassword(event.target.value);
                      setPasswordError("");
                    }}
                  />
                  <PasswordToggle
                    visible={showNewPassword}
                    onToggle={() => setShowNewPassword((v) => !v)}
                  />
                </div>
              </div>
              <div>
                <label className="field-label" htmlFor="access-confirm-password">
                  Confirm new password
                </label>
                <div className="input-modern input-modern--no-icon input-modern--with-toggle">
                  <input
                    id="access-confirm-password"
                    name="confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Confirm password"
                    value={confirmPassword}
                    onChange={(event) => {
                      setConfirmPassword(event.target.value);
                      setPasswordError("");
                    }}
                  />
                  <PasswordToggle
                    visible={showConfirmPassword}
                    onToggle={() => setShowConfirmPassword((v) => !v)}
                  />
                </div>
              </div>
              {passwordError ? (
                <p
                  className="section-hint section-hint--left"
                  style={{ color: "#b91c1c", margin: 0 }}
                >
                  {passwordError}
                </p>
              ) : null}
              <button className="btn-primary" type="submit" disabled={submitting}>
                {submitting ? "Saving…" : "Continue to login"}
              </button>
              <button
                type="button"
                className="access-otp-back access-otp-back--bottom"
                aria-label="Back to OTP verification"
                onClick={() => setStep("otp")}
              >
                <span>Back</span>
              </button>
            </form>
          </div>
        </div>
      </div>

      <div
        className={toastClassName}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-hidden={toast.state === "hidden"}
      >
        <p className="otp-toast__text">{toast.message}</p>
      </div>
    </>
  );
}

function PasswordToggle({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="password-toggle"
      aria-label={visible ? "Hide password" : "Show password"}
      aria-pressed={visible}
      onClick={onToggle}
    >
      {visible ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 3L21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path
            d="M10.58 10.58C10.21 10.95 10 11.46 10 12C10 13.1 10.9 14 12 14C12.54 14 13.05 13.79 13.42 13.42"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M9.88 5.09C10.56 4.86 11.27 4.75 12 4.75C16.5 4.75 20.27 8.24 21.25 12C20.86 13.49 20.02 14.83 18.85 15.84M14.12 18.91C13.44 19.14 12.73 19.25 12 19.25C7.5 19.25 3.73 15.76 2.75 12C3.23 10.17 4.39 8.58 5.97 7.47"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M2.75 12C3.73 8.24 7.5 4.75 12 4.75C16.5 4.75 20.27 8.24 21.25 12C20.27 15.76 16.5 19.25 12 19.25C7.5 19.25 3.73 15.76 2.75 12Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      )}
    </button>
  );
}

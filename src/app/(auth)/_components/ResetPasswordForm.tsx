"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const STRONG_PASSWORD =
  "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.";

function isStrongPassword(password: string): boolean {
  return (
    password.length >= 8 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    if (!newPassword) {
      setError("Please enter a new password.");
      return;
    }
    if (!isStrongPassword(newPassword)) {
      setError(STRONG_PASSWORD);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      let data: { error?: string } = {};
      try {
        data = (await response.json()) as { error?: string };
      } catch {
        // ignore
      }
      if (!response.ok) {
        setError(data.error || "Could not reset the password.");
        return;
      }
      router.push("/success");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <h2 className="section-title section-title--left">Reset Your Password</h2>

      <div>
        <label className="field-label" htmlFor="new-password">
          New password
        </label>
        <div className="input-modern input-modern--no-icon input-modern--with-toggle">
          <input
            id="new-password"
            type={showNew ? "text" : "password"}
            placeholder="Type New Password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setError("");
            }}
            required
          />
          <PasswordToggle visible={showNew} onToggle={() => setShowNew((v) => !v)} />
        </div>
      </div>

      <div>
        <label className="field-label" htmlFor="confirm-password">
          Confirm password
        </label>
        <div className="input-modern input-modern--no-icon input-modern--with-toggle">
          <input
            id="confirm-password"
            type={showConfirm ? "text" : "password"}
            placeholder="Re-type Password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setError("");
            }}
            required
          />
          <PasswordToggle visible={showConfirm} onToggle={() => setShowConfirm((v) => !v)} />
        </div>
      </div>

      {error ? (
        <p
          className="section-hint section-hint--left"
          style={{ color: "#b91c1c", margin: 0 }}
        >
          {error}
        </p>
      ) : null}

      <button type="submit" className="action-btn" aria-label="Submit new password" disabled={submitting}>
        <span>{submitting ? "Submitting…" : "Submit"}</span>
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

      <p className="password-instruction">
        Password must be at least 8 characters and include uppercase, lowercase, number, and
        special character.
      </p>
    </form>
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

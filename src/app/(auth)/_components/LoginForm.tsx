"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      let data: { error?: string } = {};
      try {
        data = (await response.json()) as { error?: string };
      } catch {
        // ignore
      }
      if (!response.ok) {
        setError(data.error || "Login failed.");
        return;
      }
      router.push(`/otp?email=${encodeURIComponent(email)}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <div>
        <label className="field-label" htmlFor="email">
          EMAIL ADDRESS
        </label>
        <div className="input-modern">
          <span className="input-modern__icon" aria-hidden="true">
            <svg width="16" height="12" viewBox="0 0 15 12" fill="none">
              <path
                d="M1.5 12C1.09 12 0.74 11.85 0.45 11.56C0.15 11.26 0 10.91 0 10.5V1.5C0 1.09 0.15 0.74 0.45 0.44C0.74 0.15 1.09 0 1.5 0H13.5C13.91 0 14.26 0.15 14.56 0.44C14.85 0.74 15 1.09 15 1.5V10.5C15 10.91 14.85 11.26 14.56 11.56C14.26 11.85 13.91 12 13.5 12H1.5ZM7.5 6.75L1.5 3V10.5H13.5V3L7.5 6.75ZM7.5 5.25L13.5 1.5H1.5L7.5 5.25Z"
                fill="#6e7380"
              />
            </svg>
          </span>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jhon_travis@outlook.com"
            autoComplete="email"
          />
        </div>
      </div>

      <div>
        <label className="field-label" htmlFor="password">
          PASSWORD
        </label>
        <div className="input-modern input-modern--with-toggle">
          <span className="input-modern__icon" aria-hidden="true">
            <svg width="14" height="16" viewBox="0 0 12 14" fill="none">
              <path
                d="M9.6 5.6H9V4.4C9 2.44 7.56 1 5.6 1C3.64 1 2.2 2.44 2.2 4.4V5.6H1.6C0.72 5.6 0 6.32 0 7.2V12.4C0 13.28 0.72 14 1.6 14H9.6C10.48 14 11.2 13.28 11.2 12.4V7.2C11.2 6.32 10.48 5.6 9.6 5.6ZM3.4 4.4C3.4 3.08 4.28 2.2 5.6 2.2C6.92 2.2 7.8 3.08 7.8 4.4V5.6H3.4V4.4Z"
                fill="#6e7380"
              />
            </svg>
          </span>
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            autoComplete="current-password"
          />
          <button
            type="button"
            className="password-toggle"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((v) => !v)}
          >
            {showPassword ? (
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
        </div>
      </div>

      {error ? (
        <p
          className="section-hint section-hint--left"
          role="alert"
          style={{ color: "#b91c1c", margin: 0 }}
        >
          {error}
        </p>
      ) : null}

      <button className="btn-primary" type="submit" disabled={submitting}>
        {submitting ? "Sending code…" : "Login"}
      </button>
      <p className="forgot-wrap">
        <a href="/forgot-password" className="link-forgot">
          Forgot Password?
        </a>
      </p>
    </form>
  );
}

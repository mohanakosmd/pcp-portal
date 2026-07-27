"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_COUNTRY,
  ORDERED_COUNTRIES,
  type Country,
} from "@/lib/country-codes";
import { formatUsPhoneNational, isValidUsPhone } from "@/lib/phone";
import { US_STATES } from "@/lib/us-area-codes";

type Step = "npi" | "request" | "otp" | "pending";

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

// For non-US dial codes we don't impose the US (555) 000-0000 mask — keep the
// digits (and spaces) the user types, capped to a sane length.
function formatIntlPhone(value: string): string {
  return value.replace(/[^\d ]/g, "").replace(/\s+/g, " ").trimStart().slice(0, 20);
}

function isValidIntlPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 15;
}

// Mirrors isStrongPassword() in @/lib/auth so the client blocks weak passwords
// before hitting the server (which enforces the same policy).
function isStrongPassword(value: string): boolean {
  return (
    value.length >= 8 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /[0-9]/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

type ToastState = {
  message: string;
  state: "show" | "leave" | "hidden";
};

type NpiAddress = {
  city?: string;
  state?: string;
  postalCode?: string;
  phone?: string;
};

type NpiResult = {
  npi: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  credential?: string;
  specialty?: string;
  practiceAddress?: NpiAddress;
  mailingAddress?: NpiAddress;
};

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function StepDots({ current }: { current: 1 | 2 }) {
  const dotClass = (n: 1 | 2) =>
    "access-steps__dot" +
    (n < current ? " is-done" : n === current ? " is-active" : "");
  return (
    <div className="access-steps" aria-hidden="true">
      <span className={dotClass(1)}>1</span>
      <span className={`access-steps__line${current > 1 ? " is-done" : ""}`} />
      <span className={dotClass(2)}>2</span>
    </div>
  );
}

export function CreateAccountPrompt() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("npi");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [countryOpen, setCountryOpen] = useState(false);
  const [countryQuery, setCountryQuery] = useState("");
  const countryRef = useRef<HTMLDivElement | null>(null);

  // NPI registry search (step 1).
  const [npiMode, setNpiMode] = useState<"name" | "number">("name");
  const [npiFirst, setNpiFirst] = useState("");
  const [npiLast, setNpiLast] = useState("");
  const [npiState, setNpiState] = useState("");
  const [npiNumber, setNpiNumber] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<NpiResult | null>(null);
  const [npiResults, setNpiResults] = useState<NpiResult[] | null>(null);
  const [npiLoading, setNpiLoading] = useState(false);
  const [npiError, setNpiError] = useState("");

  const [userId, setUserId] = useState<string>("");
  const [requestError, setRequestError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [otpDigits, setOtpDigits] = useState<string[]>(() =>
    Array.from({ length: OTP_LENGTH }, () => "")
  );
  const [secondsLeft, setSecondsLeft] = useState(INITIAL_SECONDS);
  const [otpError, setOtpError] = useState("");
  const otpInputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const [toast, setToast] = useState<ToastState>({ message: "", state: "hidden" });
  const toastHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestFormRef = useRef<HTMLFormElement | null>(null);
  // Guards against an older NPI request overwriting a newer one's results.
  const searchSeq = useRef(0);

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

  // Close the country dropdown on outside click.
  useEffect(() => {
    if (!countryOpen) return;
    const onDown = (event: MouseEvent) => {
      if (countryRef.current && !countryRef.current.contains(event.target as Node)) {
        setCountryOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [countryOpen]);

  const isUsDial = country.dial === "+1";
  const countryQ = countryQuery.trim().toLowerCase();
  const filteredCountries = countryQ
    ? ORDERED_COUNTRIES.filter(
        (c) =>
          c.name.toLowerCase().includes(countryQ) ||
          c.iso.toLowerCase().includes(countryQ) ||
          c.dial.replace("+", "").includes(countryQ.replace("+", ""))
      )
    : ORDERED_COUNTRIES;

  const openModal = (event?: React.MouseEvent<HTMLAnchorElement>) => {
    event?.preventDefault();
    setStep("npi");
    setName("");
    setEmail("");
    setMobile("");
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirmPassword(false);
    setNpiMode("name");
    setNpiFirst("");
    setNpiLast("");
    setNpiState("");
    setNpiNumber("");
    setSelectedProvider(null);
    setNpiResults(null);
    setNpiError("");
    setOtpDigits(Array.from({ length: OTP_LENGTH }, () => ""));
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

  // --- Step 1: NPI registry search ------------------------------------------

  const runNpiSearch = useCallback(async () => {
    const first = npiFirst.trim();
    const last = npiLast.trim();
    const number = npiNumber.replace(/\D/g, "");
    if (npiMode === "number") {
      if (!number) {
        setNpiResults(null);
        setNpiError("");
        return;
      }
    } else if (!first && !last) {
      setNpiResults(null);
      setNpiError("");
      return;
    }
    const seq = ++searchSeq.current;
    setNpiLoading(true);
    setNpiError("");
    try {
      const params = new URLSearchParams({ limit: "10" });
      if (npiMode === "number") {
        params.set("number", number);
      } else {
        if (first) params.set("first_name", first);
        if (last) params.set("last_name", last);
        if (npiState) params.set("state", npiState);
      }
      const res = await fetch(`/api/npi-search?${params.toString()}`);
      const data = (await res.json().catch(() => ({}))) as {
        results?: NpiResult[];
        error?: string;
      };
      if (seq !== searchSeq.current) return; // a newer search superseded this one
      if (!res.ok) throw new Error(data.error || "Search failed.");
      setNpiResults(Array.isArray(data.results) ? data.results : []);
    } catch (err) {
      if (seq !== searchSeq.current) return;
      setNpiError(
        err instanceof Error ? err.message : "Could not reach the NPI registry."
      );
      setNpiResults([]);
    } finally {
      if (seq === searchSeq.current) setNpiLoading(false);
    }
  }, [npiMode, npiFirst, npiLast, npiState, npiNumber]);

  // Live-search as the name (or state) changes — debounced so we don't hit the
  // registry on every keystroke. The Search button triggers it immediately too.
  useEffect(() => {
    if (!open || step !== "npi") return;
    const hasQuery =
      npiMode === "number"
        ? Boolean(npiNumber.replace(/\D/g, ""))
        : Boolean(npiFirst.trim() || npiLast.trim());
    if (!hasQuery) {
      setNpiResults(null);
      return;
    }
    const t = setTimeout(() => {
      void runNpiSearch();
    }, 400);
    return () => clearTimeout(t);
  }, [open, step, npiMode, npiFirst, npiLast, npiState, npiNumber, runNpiSearch]);

  const handleNpiSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (npiMode === "number") {
      if (npiNumber.replace(/\D/g, "").length !== 10) {
        setNpiError("Enter a valid 10-digit NPI number.");
        return;
      }
    } else if (!npiFirst.trim() && !npiLast.trim()) {
      setNpiError("Enter a first or last name to search.");
      return;
    }
    void runNpiSearch();
  };

  const switchNpiMode = (mode: "name" | "number") => {
    if (mode === npiMode) return;
    searchSeq.current++; // discard any in-flight search from the previous mode
    setNpiMode(mode);
    setNpiResults(null);
    setNpiError("");
  };

  const selectNpiResult = (r: NpiResult) => {
    const full = r.fullName || `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim();
    if (full) setName(titleCase(full));
    const phone = r.practiceAddress?.phone || r.mailingAddress?.phone || "";
    if (phone) setMobile(formatUsPhoneNational(phone));
    setSelectedProvider(r);
    setRequestError("");
    setStep("request");
  };

  // --- Step 2: account details + OTP ----------------------------------------

  // The NPI registry fields selected in step 1. Persisted with the account so
  // the profile page can show everything captured at sign-up. Empty when the
  // provider entered details without picking a registry match.
  const buildProviderFields = useCallback((): Record<string, string> => {
    if (!selectedProvider) return {};
    const addr = selectedProvider.practiceAddress || selectedProvider.mailingAddress || {};
    return {
      npiNumber: selectedProvider.npi ?? "",
      npiCredential: selectedProvider.credential ?? "",
      specialty: selectedProvider.specialty ?? "",
      practiceCity: addr.city ?? "",
      practiceState: addr.state ?? "",
      practicePostalCode: addr.postalCode ?? "",
    };
  }, [selectedProvider]);

  const handleRequestSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.checkValidity()) {
      event.currentTarget.reportValidity();
      return;
    }
    const phoneOk = isUsDial ? isValidUsPhone(mobile) : isValidIntlPhone(mobile);
    if (!phoneOk) {
      setRequestError(
        isUsDial
          ? "Enter a valid US mobile number, e.g. (555) 123-4567."
          : "Enter a valid mobile number."
      );
      return;
    }
    if (!isStrongPassword(password)) {
      setRequestError(
        "Password must be at least 8 characters and include uppercase, lowercase, number, and special character."
      );
      return;
    }
    if (password !== confirmPassword) {
      setRequestError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    setRequestError("");
    try {
      const { ok, data } = await callJson("/api/auth/signup", {
        name,
        email,
        mobile: `${country.dial} ${mobile}`,
        password,
        ...buildProviderFields(),
      });
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
      setStep("pending");
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
      const { ok, data } = await callJson("/api/auth/signup", {
        name,
        email,
        mobile: `${country.dial} ${mobile}`,
        password,
        ...buildProviderFields(),
      });
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

  const canResendOtp = secondsLeft <= 0;

  const modalTitle =
    step === "pending" ? "Account created" : "Create New Account";

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
      >
        <div
          className="access-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="access-modal-title"
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

          {/* Step 1 — NPI registry search */}
          <div
            className={`access-step${step === "npi" ? " access-step--active" : " access-step--hidden"}`}
            aria-hidden={step !== "npi"}
          >
            <StepDots current={1} />
            <p className="section-hint section-hint--left access-npi-lede">
              Search the NPI registry to find your provider profile. This will auto-fill your
              information.
            </p>

            <div className="access-npi-tabs" role="tablist" aria-label="NPI search mode">
              <button
                type="button"
                role="tab"
                aria-selected={npiMode === "name"}
                className={`access-npi-tab${npiMode === "name" ? " is-active" : ""}`}
                onClick={() => switchNpiMode("name")}
              >
                Search by Name
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={npiMode === "number"}
                className={`access-npi-tab${npiMode === "number" ? " is-active" : ""}`}
                onClick={() => switchNpiMode("number")}
              >
                Search by NPI Number
              </button>
            </div>

            <form className="access-form" noValidate onSubmit={handleNpiSearch}>
              {npiMode === "name" ? (
                <>
                  <div className="access-npi-names">
                    <div>
                      <label className="field-label" htmlFor="npi-first">
                        First Name
                      </label>
                      <div className="input-modern input-modern--no-icon">
                        <input
                          id="npi-first"
                          type="text"
                          autoComplete="given-name"
                          placeholder="e.g. John"
                          value={npiFirst}
                          onChange={(e) => setNpiFirst(e.target.value)}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="field-label" htmlFor="npi-last">
                        Last Name
                      </label>
                      <div className="input-modern input-modern--no-icon">
                        <input
                          id="npi-last"
                          type="text"
                          autoComplete="family-name"
                          placeholder="e.g. Smith"
                          value={npiLast}
                          onChange={(e) => setNpiLast(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="access-npi-search-row">
                    <div className="access-npi-state">
                      <label className="field-label" htmlFor="npi-state">
                        State
                      </label>
                      <select
                        id="npi-state"
                        className="access-npi-select"
                        value={npiState}
                        onChange={(e) => setNpiState(e.target.value)}
                      >
                        <option value="">All states</option>
                        {US_STATES.map((s) => (
                          <option key={s.code} value={s.code}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button className="btn-primary access-npi-search-btn" type="submit" disabled={npiLoading}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M16 16L20 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                      {npiLoading ? "Searching…" : "Search"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="access-npi-search-row">
                  <div className="access-npi-number">
                    <label className="field-label" htmlFor="npi-number">
                      NPI Number
                    </label>
                    <div className="input-modern input-modern--no-icon">
                      <input
                        id="npi-number"
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="e.g. 1234567890"
                        maxLength={10}
                        value={npiNumber}
                        onChange={(e) =>
                          setNpiNumber(e.target.value.replace(/\D/g, "").slice(0, 10))
                        }
                      />
                    </div>
                  </div>
                  <button className="btn-primary access-npi-search-btn" type="submit" disabled={npiLoading}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M16 16L20 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                    {npiLoading ? "Searching…" : "Search"}
                  </button>
                </div>
              )}

              {npiError ? (
                <p
                  className="section-hint section-hint--left"
                  role="alert"
                  style={{ color: "#b91c1c", margin: 0 }}
                >
                  {npiError}
                </p>
              ) : null}
            </form>

            {npiLoading ? (
              <p className="section-hint section-hint--left access-npi-status">
                Searching the NPI registry…
              </p>
            ) : npiResults ? (
              npiResults.length > 0 ? (
                <div className="access-npi-results-wrap">
                  <p className="access-npi-results-head">
                    {npiResults.length} result{npiResults.length === 1 ? "" : "s"} found
                  </p>
                  <ul className="access-npi-results">
                    {npiResults.map((r) => {
                      const city = r.practiceAddress?.city
                        ? titleCase(r.practiceAddress.city)
                        : "";
                      const cityState = [city, r.practiceAddress?.state]
                        .filter(Boolean)
                        .join(", ");
                      const sub = [r.specialty, cityState].filter(Boolean).join(" — ");
                      return (
                        <li key={r.npi}>
                          <button
                            type="button"
                            className="access-npi-result"
                            onClick={() => selectNpiResult(r)}
                          >
                            <span className="access-npi-result__main">
                              <span className="access-npi-result__name">
                                {titleCase(r.fullName || "")}
                                {r.credential ? (
                                  <span className="access-npi-result__cred">
                                    , {r.credential}
                                  </span>
                                ) : null}
                              </span>
                              {sub ? (
                                <span className="access-npi-result__sub">{sub}</span>
                              ) : null}
                            </span>
                            <span className="access-npi-result__npi">NPI: {r.npi}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <p className="section-hint section-hint--left access-npi-status">
                  No matching providers found. Adjust your search or skip to enter details
                  manually.
                </p>
              )
            ) : null}
          </div>

          {/* Step 2 — account details */}
          <div
            className={`access-step${step === "request" ? " access-step--active" : " access-step--hidden"}`}
            aria-hidden={step !== "request"}
          >
            <StepDots current={2} />
            {selectedProvider ? (
              (() => {
                const addr =
                  selectedProvider.practiceAddress ||
                  selectedProvider.mailingAddress ||
                  {};
                const city = addr.city ? titleCase(addr.city) : "";
                const location = [
                  [city, addr.state].filter(Boolean).join(", "),
                  addr.postalCode,
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <div className="access-provider-card">
                    <div className="access-provider-card__info">
                      <p className="access-provider-card__head">
                        {selectedProvider.specialty ? (
                          <span>{selectedProvider.specialty}</span>
                        ) : null}
                        {selectedProvider.specialty ? (
                          <span className="access-provider-card__sep">·</span>
                        ) : null}
                        <span>
                          NPI:{" "}
                          <span className="access-provider-card__npi">
                            {selectedProvider.npi}
                          </span>
                        </span>
                      </p>
                      {location ? (
                        <p className="access-provider-card__loc">{location}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="access-provider-card__change"
                      onClick={() => setStep("npi")}
                    >
                      Change
                    </button>
                  </div>
                );
              })()
            ) : null}
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
              {selectedProvider ? (
                <div>
                  <label className="field-label" htmlFor="access-npi-number">
                    NPI Number
                  </label>
                  <div className="input-modern input-modern--no-icon input-modern--readonly">
                    <input
                      id="access-npi-number"
                      type="text"
                      value={selectedProvider.npi}
                      readOnly
                      aria-readonly="true"
                      tabIndex={-1}
                    />
                  </div>
                </div>
              ) : null}
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
                <div className="access-phone-field" ref={countryRef}>
                  <div className="access-phone">
                    <button
                      type="button"
                      className="access-phone__cc"
                      aria-label="Country code"
                      aria-expanded={countryOpen}
                      onClick={() => setCountryOpen((o) => !o)}
                    >
                      <span className="access-phone__cc-iso">{country.iso}</span>
                      <span className="access-phone__cc-dial">{country.dial}</span>
                      <span className="access-phone__cc-caret" aria-hidden="true">
                        ▾
                      </span>
                    </button>
                    <input
                      id="access-mobile"
                      name="mobile"
                      type="tel"
                      autoComplete="tel"
                      inputMode="tel"
                      placeholder={isUsDial ? "(555) 000-0000" : "Mobile number"}
                      value={mobile}
                      onChange={(event) =>
                        setMobile(
                          isUsDial
                            ? formatUsPhoneNational(event.target.value)
                            : formatIntlPhone(event.target.value)
                        )
                      }
                      required
                    />
                  </div>
                  {countryOpen ? (
                    <div className="cc-dropdown" role="listbox">
                      <input
                        className="cc-search"
                        type="text"
                        autoFocus
                        placeholder="Search country or +code…"
                        value={countryQuery}
                        onChange={(event) => setCountryQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            // Don't submit the signup form; pick the top match.
                            event.preventDefault();
                            const first = filteredCountries[0];
                            if (first) {
                              setCountry(first);
                              setMobile((prev) =>
                                first.dial === "+1"
                                  ? formatUsPhoneNational(prev)
                                  : formatIntlPhone(prev)
                              );
                              setCountryOpen(false);
                              setCountryQuery("");
                            }
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            setCountryOpen(false);
                          }
                        }}
                      />
                      <div className="cc-list">
                        {filteredCountries.length === 0 ? (
                          <p className="cc-empty">No matches</p>
                        ) : (
                          filteredCountries.map((c) => (
                            <button
                              key={c.iso}
                              type="button"
                              role="option"
                              aria-selected={c.iso === country.iso}
                              className={`cc-row${c.iso === country.iso ? " cc-row--active" : ""}`}
                              onClick={() => {
                                setCountry(c);
                                setMobile((prev) =>
                                  c.dial === "+1"
                                    ? formatUsPhoneNational(prev)
                                    : formatIntlPhone(prev)
                                );
                                setCountryOpen(false);
                                setCountryQuery("");
                              }}
                            >
                              <span className="cc-row__iso">{c.iso}</span>
                              <span className="cc-row__name">{c.name}</span>
                              <span className="cc-row__dial">{c.dial}</span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              <div>
                <label className="field-label" htmlFor="access-password">
                  Password
                </label>
                <div className="input-modern input-modern--no-icon input-modern--with-toggle">
                  <input
                    id="access-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Min 8 chars, upper, lower, digit, special"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
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
              <div>
                <label className="field-label" htmlFor="access-confirm-password">
                  Confirm Password
                </label>
                <div className="input-modern input-modern--no-icon input-modern--with-toggle">
                  <input
                    id="access-confirm-password"
                    name="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Re-enter your password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                    aria-pressed={showConfirmPassword}
                    onClick={() => setShowConfirmPassword((v) => !v)}
                  >
                    {showConfirmPassword ? (
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
              {requestError ? (
                <p
                  className="section-hint section-hint--left"
                  role="alert"
                  style={{ color: "#b91c1c", margin: 0 }}
                >
                  {requestError}
                </p>
              ) : null}
              <div className="access-actions-row">
                <button
                  type="button"
                  className="access-back-btn"
                  onClick={() => setStep("npi")}
                >
                  Back
                </button>
                <button className="btn-primary" type="submit" disabled={submitting}>
                  {submitting ? "Sending code…" : "Verify Email & Continue"}
                </button>
              </div>
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

              {secondsLeft > 0 ? (
                <p className="otp-timer">{formatRemaining(secondsLeft)}</p>
              ) : null}
              {otpError ? (
                <p
                  className="section-hint section-hint--left"
                  role="alert"
                  style={{ color: "#b91c1c", margin: 0 }}
                >
                  {otpError}
                </p>
              ) : null}
              {canResendOtp ? (
                <a className="resend-link" href="#" onClick={handleResendOtp}>
                  Didn&apos;t receive the code?
                </a>
              ) : null}
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
            className={`access-step${step === "pending" ? " access-step--active" : " access-step--hidden"}`}
            aria-hidden={step !== "pending"}
          >
            <div className="access-form access-pending">
              <div className="access-pending__icon" aria-hidden="true">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="#16a34a" strokeWidth="1.8" />
                  <path
                    d="M8 12l2.5 2.5L16 9"
                    stroke="#16a34a"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h3 className="section-title section-title--left">Account created</h3>
              <p className="section-hint section-hint--left">
                Thanks, {name || "there"}! Your email is verified and your account for{" "}
                <span className="otp-email">{email || "your email"}</span> is ready. You can now
                log in with your email and password.
              </p>
              <button className="btn-primary" type="button" onClick={closeModal}>
                Go to login
              </button>
            </div>
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

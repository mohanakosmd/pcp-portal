"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ORDERED_COUNTRIES } from "@/lib/country-codes";

export type ProfileData = {
  name: string;
  email: string;
  mobile: string;
  phoneDial: string;
  fax: string;
  gender: string;
  npiNumber: string;
  npiCredential: string;
  specialty: string;
};

const GENDER_OPTIONS: { value: string; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
  { value: "other", label: "Other" },
];

// Split a stored phone into a dial code + national digits. Prefers the explicit
// `phoneDial` field; otherwise parses a leading "+<code>" off the number. The
// dial is stripped before taking national digits so "+1 8765432123" doesn't
// fold the country code into the number.
function parsePhone(mobile: string, dial: string): { dial: string; national: string } {
  const raw = mobile.trim();
  const useDial = dial || raw.match(/^(\+\d{1,4})/)?.[1] || "+1";
  const rest = raw.startsWith(useDial) ? raw.slice(useDial.length) : raw;
  return { dial: useDial, national: rest.replace(/\D/g, "") };
}

export function ProfileView({ profile }: { profile: ProfileData }) {
  const router = useRouter();
  const initialPhone = parsePhone(profile.mobile, profile.phoneDial);

  const [name, setName] = useState(profile.name);
  const [npiCredential, setNpiCredential] = useState(profile.npiCredential);
  const [specialty, setSpecialty] = useState(profile.specialty);
  const [gender, setGender] = useState(profile.gender);
  const [phoneDial, setPhoneDial] = useState(initialPhone.dial);
  const [phoneNational, setPhoneNational] = useState(initialPhone.national);
  const [fax, setFax] = useState(profile.fax);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Selected country for the dial dropdown: first country matching the dial.
  const selectedCountry =
    ORDERED_COUNTRIES.find((c) => c.dial === phoneDial) ?? ORDERED_COUNTRIES[0];

  async function saveProfile() {
    if (!name.trim()) {
      setError("Enter your full name.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          // Store the combined number so screens that read `mobile` directly
          // (e.g. create-case PCP prefill) still get a complete value.
          mobile: phoneNational.trim() ? `${phoneDial} ${phoneNational.trim()}` : "",
          phoneDial: phoneDial.trim(),
          fax: fax.trim(),
          gender,
          npiCredential: npiCredential.trim(),
          specialty: specialty.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Failed to save profile.");
        return;
      }
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="dash-main" id="main">
      <section className="pf-card" aria-label="Profile information">
        <div className="pf-card__head">
          <h1>Profile Information</h1>
        </div>

        {savedFlash && (
          <div className="pf-flash" role="status">
            Profile saved.
          </div>
        )}
        {error && (
          <div className="pf-error" role="alert">
            {error}
          </div>
        )}

        {/* ----- Profile Information ----- */}
        <div className="pf-grid">
          <div className="pf-field">
            <label className="pf-label" htmlFor="pf-name">
              Full Name <span className="pf-req">*</span>
            </label>
            <input
              id="pf-name"
              className="pf-input"
              type="text"
              value={name}
              maxLength={120}
              autoComplete="name"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="pf-field">
            <label className="pf-label" htmlFor="pf-email">
              Email
            </label>
            <input
              id="pf-email"
              className="pf-input pf-input--readonly"
              type="email"
              value={profile.email}
              readOnly
              aria-readonly="true"
              tabIndex={-1}
            />
          </div>

          <div className="pf-field">
            <label className="pf-label" htmlFor="pf-npi">
              NPI Number
            </label>
            <input
              id="pf-npi"
              className="pf-input pf-input--readonly"
              type="text"
              value={profile.npiNumber}
              placeholder="10-digit NPI"
              readOnly
              aria-readonly="true"
              tabIndex={-1}
            />
          </div>

          <div className="pf-field">
            <label className="pf-label" htmlFor="pf-cred">
              Qualifications
            </label>
            <input
              id="pf-cred"
              className="pf-input"
              type="text"
              value={npiCredential}
              maxLength={40}
              placeholder="e.g. MD, DO, MBBS"
              onChange={(e) => setNpiCredential(e.target.value)}
            />
          </div>

          <div className="pf-field">
            <label className="pf-label" htmlFor="pf-specialty">
              Specialty
            </label>
            <input
              id="pf-specialty"
              className="pf-input"
              type="text"
              value={specialty}
              maxLength={120}
              placeholder="e.g. Gastroenterology"
              onChange={(e) => setSpecialty(e.target.value)}
            />
          </div>

          <div className="pf-field">
            <label className="pf-label" htmlFor="pf-gender">
              Gender
            </label>
            <select
              id="pf-gender"
              className="pf-input pf-select"
              value={gender}
              onChange={(e) => setGender(e.target.value)}
            >
              <option value="">Select</option>
              {GENDER_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>

          <div className="pf-field">
            <label className="pf-label" htmlFor="pf-phone">
              Phone
            </label>
            <div className="pf-phone">
              <select
                className="pf-phone__cc"
                aria-label="Country code"
                value={selectedCountry.iso}
                onChange={(e) => {
                  const c = ORDERED_COUNTRIES.find((x) => x.iso === e.target.value);
                  if (c) setPhoneDial(c.dial);
                }}
              >
                {ORDERED_COUNTRIES.map((c) => (
                  <option key={c.iso} value={c.iso}>
                    {c.iso} {c.dial}
                  </option>
                ))}
              </select>
              <input
                id="pf-phone"
                className="pf-input pf-phone__num"
                type="tel"
                inputMode="tel"
                value={phoneNational}
                maxLength={15}
                placeholder="Phone number"
                onChange={(e) => setPhoneNational(e.target.value.replace(/[^\d]/g, ""))}
              />
            </div>
          </div>

          <div className="pf-field">
            <label className="pf-label" htmlFor="pf-fax">
              Fax
            </label>
            <input
              id="pf-fax"
              className="pf-input"
              type="text"
              value={fax}
              maxLength={40}
              placeholder="e.g. 480-555-5678"
              onChange={(e) => setFax(e.target.value)}
            />
          </div>
        </div>

        {/* ----- Save ----- */}
        <div className="pf-footer">
          <button
            type="button"
            className="pf-btn pf-btn--primary pf-btn--save"
            onClick={saveProfile}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save Profile"}
          </button>
        </div>
      </section>
    </main>
  );
}

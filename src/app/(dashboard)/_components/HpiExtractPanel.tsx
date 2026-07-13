"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Upload an HPI History document, extract structured Health fields from it via
// /api/hpi-extract, and let the user review-then-apply the results. Fully
// self-contained: it owns the file/extraction/review state and reports out only
// through `onApply` (chosen values) and `onFileChange` (the staged file, so the
// host can attach it on save/submit). Used by both the create-case form and the
// Cases "Patient report" edit modal. Styling is the shared `cc-hpi-*` classes in
// create-case.css (imported on both pages).

/** Health fields the HPI extractor can fill, in the order they're reviewed. */
export const HPI_FIELDS = [
  "allergies",
  "currentMedications",
  "pastSurgicalHistory",
  "socialHistory",
  "pharmacyInformation",
  "pharmacyPhoneFax",
  "primaryCarePhysician",
  "pcpPhoneFax",
  "bmi",
] as const;

export type HpiField = (typeof HPI_FIELDS)[number];
export type HpiExtraction = Record<HpiField, string>;

export const HPI_FIELD_LABELS: Record<HpiField, string> = {
  allergies: "Allergies",
  currentMedications: "Current Medication",
  pastSurgicalHistory: "Past Surgical History",
  socialHistory: "Social History",
  pharmacyInformation: "Pharmacy Information",
  pharmacyPhoneFax: "Pharmacy Phone & Fax",
  primaryCarePhysician: "Primary Care Physician (PCP)",
  pcpPhoneFax: "PCP Phone & Fax",
  bmi: "BMI",
};

/** What the HPI upload accepts — must stay in sync with /api/hpi-extract. */
const HPI_ACCEPT = "application/pdf,image/png,image/jpeg,image/webp,text/plain";

type Phase = "idle" | "reading" | "ready" | "error";

type HpiExtractPanelProps = {
  /**
   * The host's current value for each extractable field. Used to (a) pre-check
   * only fields that are empty in the host, so applying never silently
   * overwrites typed data, and (b) show a "replaces what you entered" warning.
   */
  currentValues: Record<HpiField, string>;
  /** Called with the chosen field→value map when the user presses Apply. */
  onApply: (values: Partial<Record<HpiField, string>>) => void;
  /**
   * Called with the staged file when one is picked (or null when cleared) so the
   * host can attach it to the case on save/submit. The panel does NOT upload the
   * file itself.
   */
  onFileChange?: (file: File | null) => void;
};

/**
 * Auto-populate on extract: every field the document yields that is EMPTY in the
 * host is filled immediately (pre-populated). Fields the user already filled are
 * never silently overwritten — they surface as an opt-in "replace" list. A bad
 * parse can only touch fields that were blank.
 */
export function HpiExtractPanel({
  currentValues,
  onApply,
  onFileChange,
}: HpiExtractPanelProps) {
  const [fileName, setFileName] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [fields, setFields] = useState<HpiExtraction | null>(null);
  // Fields auto-filled on extraction (were empty), and fields skipped because the
  // host already had a value (conflicts, offered for opt-in replacement).
  const [autoFilled, setAutoFilled] = useState<HpiField[]>([]);
  const [conflicts, setConflicts] = useState<HpiField[]>([]);
  const [checked, setChecked] = useState<Partial<Record<HpiField, boolean>>>({});
  const [replacedCount, setReplacedCount] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Read current values through a ref so the empty/conflict split inside
  // handleFile uses the latest host state without making handleFile depend on it.
  const currentValuesRef = useRef(currentValues);
  useEffect(() => {
    currentValuesRef.current = currentValues;
  }, [currentValues]);

  const reset = useCallback(() => {
    setFileName("");
    setPhase("idle");
    setError("");
    setFields(null);
    setAutoFilled([]);
    setConflicts([]);
    setChecked({});
    setReplacedCount(null);
    if (inputRef.current) inputRef.current.value = "";
    onFileChange?.(null);
  }, [onFileChange]);

  const handleFile = useCallback(
    async (file: File | null) => {
      if (!file) {
        reset();
        return;
      }
      setFileName(file.name);
      setPhase("reading");
      setError("");
      setFields(null);
      setAutoFilled([]);
      setConflicts([]);
      setChecked({});
      setReplacedCount(null);
      onFileChange?.(file);

      const body = new FormData();
      body.append("file", file);
      try {
        const res = await fetch("/api/hpi-extract", { method: "POST", body });
        const data = (await res.json().catch(() => ({}))) as {
          fields?: HpiExtraction;
          error?: string;
        };
        if (!res.ok || !data.fields) {
          setPhase("error");
          setError(data.error || `Couldn't read that document (error ${res.status}).`);
          return;
        }
        // Split what the document yielded into empty fields (fill now) and
        // fields the host already has (leave; offer opt-in replacement).
        const current = currentValuesRef.current;
        const autoValues: Partial<Record<HpiField, string>> = {};
        const filledKeys: HpiField[] = [];
        const conflictKeys: HpiField[] = [];
        for (const key of HPI_FIELDS) {
          if (!data.fields[key]) continue;
          if (current[key].trim()) {
            conflictKeys.push(key);
          } else {
            autoValues[key] = data.fields[key];
            filledKeys.push(key);
          }
        }
        // Pre-populate the empty fields immediately.
        if (filledKeys.length) onApply(autoValues);
        setFields(data.fields);
        setAutoFilled(filledKeys);
        setConflicts(conflictKeys);
        setChecked({});
        setPhase("ready");
      } catch {
        setPhase("error");
        setError(
          "Couldn't reach the server to read that document. Check your connection and try again."
        );
      }
    },
    [reset, onFileChange, onApply]
  );

  const toggleConflict = useCallback((key: HpiField) => {
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
    setReplacedCount(null);
  }, []);

  const replaceSelected = useCallback(() => {
    if (!fields) return;
    const values: Partial<Record<HpiField, string>> = {};
    let count = 0;
    for (const key of conflicts) {
      if (fields[key] && checked[key]) {
        values[key] = fields[key];
        count += 1;
      }
    }
    if (count) onApply(values);
    setReplacedCount(count);
  }, [fields, conflicts, checked, onApply]);

  const foundCount = autoFilled.length + conflicts.length;
  const selectedConflicts = conflicts.filter((key) => checked[key]).length;

  return (
    <section className="cc-hpi-section" aria-labelledby="cc-hpi-heading">
      <div className="cc-hpi-section__head">
        <h3 id="cc-hpi-heading" className="cc-hpi-section__title">
          HPI History document
        </h3>
        <span className="cc-doc-badge">Optional</span>
      </div>
      <p className="cc-field-hint">
        Upload the patient&apos;s HPI history and we&apos;ll read the pharmacy, allergies, and
        other health details out of it and fill in the empty fields automatically.
      </p>

      <div className="cc-field cc-hpi-section__drop">
        <label className="cc-hpi-drop" htmlFor="cc-hpi-file">
          <input
            ref={inputRef}
            className="cc-file-input"
            id="cc-hpi-file"
            type="file"
            accept={HPI_ACCEPT}
            disabled={phase === "reading"}
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M14 3v5h5M14 3l5 5v11a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2h7z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
          </svg>
          {fileName ? (
            <span className="cc-hpi-drop__text">
              <strong>{fileName}</strong>
              <span>Click to choose a different document</span>
            </span>
          ) : (
            <span className="cc-hpi-drop__text">
              <strong>Choose the HPI history document</strong>
              <span>PDF, PNG, JPG, WebP, or TXT · Max 5 MB</span>
            </span>
          )}
        </label>
      </div>

      {phase === "reading" ? (
        <p className="cc-hpi-status" aria-live="polite">
          <span className="cc-hpi-spinner" aria-hidden="true" />
          Reading {fileName}…
        </p>
      ) : null}

      {phase === "error" ? (
        <div className="cc-hpi-panel cc-hpi-panel--error" role="alert">
          <p className="cc-field-error">{error}</p>
          <button type="button" className="cc-btn cc-btn--ghost" onClick={reset}>
            Remove document
          </button>
        </div>
      ) : null}

      {phase === "ready" && foundCount === 0 ? (
        <div className="cc-hpi-panel" role="status">
          <p className="cc-field-hint">
            No pharmacy, allergy, or history details were found in {fileName}. The document is
            still attached to this case — fill the Health fields in manually.
          </p>
          <button type="button" className="cc-btn cc-btn--ghost" onClick={reset}>
            Remove document
          </button>
        </div>
      ) : null}

      {phase === "ready" && fields && foundCount > 0 ? (
        <div className="cc-hpi-panel">
          <div className="cc-hpi-panel__head">
            <h4 className="cc-hpi-panel__title">
              {autoFilled.length > 0
                ? `Filled ${autoFilled.length} ${autoFilled.length === 1 ? "field" : "fields"} from ${fileName}`
                : `Read ${fileName}`}
            </h4>
            {autoFilled.length > 0 ? (
              <p className="cc-field-hint">
                {autoFilled.map((key) => HPI_FIELD_LABELS[key]).join(", ")} — AI-extracted, check
                against the document.
              </p>
            ) : null}
          </div>

          {conflicts.length > 0 ? (
            <>
              <p className="cc-field-hint" style={{ marginBottom: 8 }}>
                {conflicts.length} {conflicts.length === 1 ? "field" : "fields"} already had a
                value, so {conflicts.length === 1 ? "it was" : "they were"} left as-is. Check any
                you want to replace with the document&apos;s version.
              </p>
              <ul className="cc-hpi-list">
                {conflicts.map((key) => {
                  const existing = currentValues[key].trim();
                  return (
                    <li key={key} className="cc-hpi-item">
                      <label className="cc-hpi-item__label">
                        <input
                          type="checkbox"
                          checked={Boolean(checked[key])}
                          onChange={() => toggleConflict(key)}
                        />
                        <span className="cc-hpi-item__name">{HPI_FIELD_LABELS[key]}</span>
                      </label>
                      <p className="cc-hpi-item__value">{fields[key]}</p>
                      {existing ? (
                        <p className="cc-hpi-item__conflict">
                          Replaces what you entered: &ldquo;{existing.slice(0, 80)}
                          {existing.length > 80 ? "…" : ""}&rdquo;
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}

          <div className="cc-hpi-panel__actions">
            {conflicts.length > 0 ? (
              <button
                type="button"
                className="cc-btn cc-btn--primary"
                onClick={replaceSelected}
                disabled={selectedConflicts === 0}
              >
                Replace {selectedConflicts} selected
              </button>
            ) : null}
            <button type="button" className="cc-btn cc-btn--ghost" onClick={reset}>
              Remove document
            </button>
            {replacedCount !== null ? (
              <span className="cc-hpi-applied" role="status">
                Replaced {replacedCount} {replacedCount === 1 ? "field" : "fields"}.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

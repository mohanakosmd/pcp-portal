"use client";

import { useEffect, useRef, useState } from "react";

// Live medication search backed by the NLM RxTerms API. Flow:
//  - user types 3+ chars → debounced (300ms) search
//  - dropdown shows up to 15 matches (name + strength count)
//  - selecting a medication populates its dosage options (cached strengths)
//  - user picks dosage + frequency, then "Add" appends a line
// The combined value is a newline-separated string stored on the case's
// health.currentMedications field.

type MedResult = { name: string; strengths: string[] };

const RXTERMS_URL =
  "https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search";

const FREQUENCIES = [
  "Once daily",
  "Twice daily",
  "Three times daily",
  "Four times daily",
  "Every morning",
  "At bedtime",
  "Every 8 hours",
  "Every 12 hours",
  "Every other day",
  "Once weekly",
  "As needed (PRN)",
];

function parseLines(value: string): string[] {
  return value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export function MedicationPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const lines = parseLines(value);

  const [term, setTerm] = useState("");
  const [results, setResults] = useState<MedResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<MedResult | null>(null);
  const [strength, setStrength] = useState("");
  const [frequency, setFrequency] = useState(FREQUENCIES[0]);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  // Debounced RxTerms search (skipped while a medication is selected).
  useEffect(() => {
    if (selected) return;
    const q = term.trim();
    if (q.length < 3) {
      setResults([]);
      setOpen(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const seq = ++seqRef.current;
      setLoading(true);
      try {
        const res = await fetch(
          `${RXTERMS_URL}?terms=${encodeURIComponent(q)}&ef=STRENGTHS_AND_FORMS&maxList=15`
        );
        const json = (await res.json()) as unknown;
        if (seq !== seqRef.current) return; // a newer search superseded this one
        const arr = Array.isArray(json) ? json : [];
        const names: unknown[] = Array.isArray(arr[1]) ? arr[1] : [];
        const ef = arr[2] as { STRENGTHS_AND_FORMS?: unknown } | undefined;
        const sf = Array.isArray(ef?.STRENGTHS_AND_FORMS)
          ? (ef!.STRENGTHS_AND_FORMS as unknown[])
          : [];
        const out: MedResult[] = names.slice(0, 15).map((name, i) => ({
          name: String(name),
          strengths: Array.isArray(sf[i]) ? (sf[i] as unknown[]).map(String) : [],
        }));
        setResults(out);
        setOpen(true);
      } catch {
        if (seq === seqRef.current) {
          setResults([]);
          setOpen(true);
        }
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [term, selected]);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pickMed = (m: MedResult) => {
    setSelected(m);
    setTerm(m.name);
    setStrength(m.strengths[0] ?? "");
    setFrequency(FREQUENCIES[0]);
    setOpen(false);
  };

  const reset = () => {
    setSelected(null);
    setTerm("");
    setStrength("");
    setFrequency(FREQUENCIES[0]);
    setResults([]);
  };

  const addMed = () => {
    if (!selected) return;
    const line = [selected.name, strength, frequency].filter(Boolean).join(" — ");
    if (line && !lines.includes(line)) {
      onChange([...lines, line].join("\n"));
    }
    reset();
  };

  const removeLine = (idx: number) => {
    onChange(lines.filter((_, i) => i !== idx).join("\n"));
  };

  return (
    <div className="med-picker" ref={boxRef}>
      <div className="med-picker__row">
        <div className="med-picker__search">
          <input
            type="text"
            className="cc-input"
            placeholder="Search medication (type 3+ letters)…"
            value={term}
            autoComplete="off"
            onChange={(event) => {
              setTerm(event.target.value);
              if (selected) setSelected(null);
            }}
            onFocus={() => {
              if (!selected && results.length > 0) setOpen(true);
            }}
          />
          {open && !selected ? (
            <div className="med-picker__dropdown" role="listbox">
              {loading ? <p className="med-picker__hint">Searching…</p> : null}
              {!loading && results.length === 0 ? (
                <p className="med-picker__hint">No matching medications</p>
              ) : null}
              {results.map((m, i) => (
                <button
                  type="button"
                  key={`${m.name}-${i}`}
                  role="option"
                  aria-selected={false}
                  className="med-picker__option"
                  onClick={() => pickMed(m)}
                >
                  <span className="med-picker__option-name">{m.name}</span>
                  {m.strengths.length > 0 ? (
                    <span className="med-picker__option-meta">
                      {m.strengths.length} strength{m.strengths.length === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {selected ? (
          <>
            <select
              className="cc-select med-picker__select"
              aria-label="Dosage strength / form"
              value={strength}
              onChange={(event) => setStrength(event.target.value)}
            >
              {selected.strengths.length === 0 ? (
                <option value="">No dosage available</option>
              ) : null}
              {selected.strengths.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className="cc-select med-picker__select"
              aria-label="Frequency"
              value={frequency}
              onChange={(event) => setFrequency(event.target.value)}
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <button type="button" className="cc-btn cc-btn--primary med-picker__add" onClick={addMed}>
              Add
            </button>
            <button type="button" className="med-picker__cancel" onClick={reset}>
              Cancel
            </button>
          </>
        ) : null}
      </div>

      {lines.length > 0 ? (
        <ul className="med-picker__list">
          {lines.map((line, i) => (
            <li key={`${line}-${i}`} className="med-picker__chip">
              <span>{line}</span>
              <button
                type="button"
                aria-label={`Remove ${line}`}
                className="med-picker__chip-remove"
                onClick={() => removeLine(i)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

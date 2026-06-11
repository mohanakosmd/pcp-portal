"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type CaseHit = { id: string; name: string; mrn: string; status: string };
type ReportHit = {
  id: string;
  reportName: string;
  patientName: string;
  caseShortCode: string;
};

type SearchResults = { cases: CaseHit[]; reports: ReportHit[] };

const EMPTY: SearchResults = { cases: [], reports: [] };

export function DashSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const trimmed = query.trim();
  const hasResults = results.cases.length > 0 || results.reports.length > 0;

  // Debounced search. Re-runs whenever the trimmed query changes; aborts the
  // in-flight request if the user keeps typing.
  useEffect(() => {
    if (trimmed.length < 2) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.json() : EMPTY))
        .then((data: Partial<SearchResults>) => {
          setResults({
            cases: Array.isArray(data.cases) ? data.cases : [],
            reports: Array.isArray(data.reports) ? data.reports : [],
          });
        })
        .catch((err) => {
          if ((err as Error).name !== "AbortError") setResults(EMPTY);
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [trimmed]);

  // Close the dropdown on outside click.
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const clear = () => {
    setQuery("");
    setResults(EMPTY);
    setOpen(false);
  };

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const showDropdown = open && trimmed.length >= 2;

  return (
    <div className="dash-search" ref={rootRef}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M16 16L20 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        placeholder="Search cases and reports"
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (query) clear();
            else setOpen(false);
          }
        }}
        aria-label="Search cases and reports"
        aria-expanded={showDropdown}
        role="combobox"
        aria-controls="dash-search-results"
      />
      {query ? (
        <button
          type="button"
          className="dash-search__clear"
          aria-label="Clear search"
          onClick={clear}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}

      {showDropdown ? (
        <div className="dash-search__panel" id="dash-search-results" role="listbox">
          {loading && !hasResults ? (
            <p className="dash-search__empty">Searching…</p>
          ) : !hasResults ? (
            <p className="dash-search__empty">
              No cases or reports match “{trimmed}”.
            </p>
          ) : (
            <>
              {results.cases.length > 0 ? (
                <div className="dash-search__group">
                  <p className="dash-search__group-label">Cases</p>
                  {results.cases.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="dash-search__item"
                      role="option"
                      aria-selected="false"
                      onClick={() =>
                        go(
                          `/cases?focus=${encodeURIComponent(c.id)}&q=${encodeURIComponent(trimmed)}`
                        )
                      }
                    >
                      <span className="dash-search__item-main">{c.name}</span>
                      <span className="dash-search__item-meta">
                        {c.mrn} · {c.status}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              {results.reports.length > 0 ? (
                <div className="dash-search__group">
                  <p className="dash-search__group-label">Finalized reports</p>
                  {results.reports.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="dash-search__item"
                      role="option"
                      aria-selected="false"
                      onClick={() =>
                        go(
                          `/reports?focus=${encodeURIComponent(r.id)}&q=${encodeURIComponent(trimmed)}`
                        )
                      }
                    >
                      <span className="dash-search__item-main">{r.reportName}</span>
                      <span className="dash-search__item-meta">
                        {r.patientName} · #{r.caseShortCode}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

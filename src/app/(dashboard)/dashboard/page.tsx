import Link from "next/link";

import { LocalTime } from "@/app/(dashboard)/_components/LocalTime";
import { readSessionUserId } from "@/lib/auth";
import {
  PCP_CASES_COLLECTION,
  listCaseIdsWithSharedReports,
  type CaseStatus,
} from "@/lib/cases";
import { listDocuments } from "@/lib/firestore-rest";

type Status = "review" | "docs" | "done";

type RequestRow = {
  id: string;
  title: string;
  status: Status;
  statusLabel: string;
  dateIso: string;
  dateLabel: string;
  timeLabel: string;
};

type DashboardStats = {
  total: number;
  inProgress: number;
  completed: number;
  // Month-over-month change in *new* requests (createdAt). null when the
  // prior month had zero cases — we don't divide by zero.
  monthOverMonthPct: number | null;
};

type DashboardData = {
  recent: RequestRow[];
  stats: DashboardStats;
};

const STATUS_DISPLAY: Record<CaseStatus, { status: Status; label: string }> = {
  draft: { status: "docs", label: "Draft" },
  submitted: { status: "review", label: "Under review" },
  under_review: { status: "review", label: "Under review" },
  completed: { status: "done", label: "Completed" },
  closed: { status: "done", label: "Closed" },
};

const IN_PROGRESS_STATUSES: ReadonlySet<CaseStatus> = new Set([
  "submitted",
  "under_review",
]);
const COMPLETED_STATUSES: ReadonlySet<CaseStatus> = new Set(["completed", "closed"]);

function formatDateLabel(iso: string): { dateLabel: string; timeLabel: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { dateLabel: "—", timeLabel: "" };
  const dateLabel = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeLabel = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return { dateLabel, timeLabel };
}

function monthKey(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const EMPTY: DashboardData = {
  recent: [],
  stats: { total: 0, inProgress: 0, completed: 0, monthOverMonthPct: null },
};

async function loadDashboardData(): Promise<DashboardData> {
  const userId = await readSessionUserId();
  if (!userId) return EMPTY;
  try {
    const [page, reportCaseIds] = await Promise.all([
      listDocuments(PCP_CASES_COLLECTION, { pageSize: 500 }),
      listCaseIdsWithSharedReports(),
    ]);
    const owned = page.docs
      .filter((d) => !d.id.startsWith("_"))
      .filter((d) => d.data.ownerUserId === userId);

    // A GI specialist sharing a report back (a gi_shared_reports doc for the
    // case) marks the case completed — mirror the /cases reconciliation so the
    // dashboard reflects it even before /cases has persisted the transition.
    const effectiveStatus = (id: string, stored: CaseStatus): CaseStatus =>
      reportCaseIds.has(id) && stored !== "completed" && stored !== "closed"
        ? "completed"
        : stored;

    // KPI counts.
    let total = 0;
    let inProgress = 0;
    let completed = 0;
    const now = new Date();
    const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const lastMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const lastMonth = `${lastMonthDate.getUTCFullYear()}-${String(
      lastMonthDate.getUTCMonth() + 1
    ).padStart(2, "0")}`;
    let thisMonthCount = 0;
    let lastMonthCount = 0;

    for (const d of owned) {
      total += 1;
      const stored =
        (typeof d.data.status === "string" ? (d.data.status as CaseStatus) : "draft") || "draft";
      const status = effectiveStatus(d.id, stored);
      if (IN_PROGRESS_STATUSES.has(status)) inProgress += 1;
      if (COMPLETED_STATUSES.has(status)) completed += 1;
      const createdAt = typeof d.data.createdAt === "string" ? d.data.createdAt : null;
      const mk = createdAt ? monthKey(createdAt) : null;
      if (mk === thisMonth) thisMonthCount += 1;
      else if (mk === lastMonth) lastMonthCount += 1;
    }

    const monthOverMonthPct =
      lastMonthCount > 0
        ? Math.round(((thisMonthCount - lastMonthCount) / lastMonthCount) * 100)
        : null;

    // Five most-recent rows by createdAt desc.
    const recent: RequestRow[] = owned
      .slice()
      .sort((a, b) =>
        String(b.data.createdAt ?? "").localeCompare(String(a.data.createdAt ?? ""))
      )
      .slice(0, 5)
      .map((d) => {
        const stored =
          (typeof d.data.status === "string" ? (d.data.status as CaseStatus) : "draft") || "draft";
        const status = effectiveStatus(d.id, stored);
        const display = STATUS_DISPLAY[status] ?? STATUS_DISPLAY.draft;
        const updated =
          typeof d.data.updatedAt === "string"
            ? d.data.updatedAt
            : typeof d.data.createdAt === "string"
              ? d.data.createdAt
              : new Date().toISOString();
        const { dateLabel, timeLabel } = formatDateLabel(updated);
        const shortCode =
          typeof d.data.shortCode === "string" ? d.data.shortCode : d.id;
        const title =
          typeof d.data.title === "string" && d.data.title.trim()
            ? d.data.title
            : "Untitled case";
        return {
          id: shortCode,
          title,
          status: display.status,
          statusLabel: display.label,
          dateIso: updated,
          dateLabel,
          timeLabel,
        };
      });

    return {
      recent,
      stats: { total, inProgress, completed, monthOverMonthPct },
    };
  } catch (err) {
    console.error("[dashboard] failed to load cases:", err);
    return EMPTY;
  }
}

const sendArrow = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M5 12h14M12 5l7 7-7 7"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default async function DashboardPage() {
  const { recent: recentRequests, stats } = await loadDashboardData();
  const pct = stats.monthOverMonthPct;
  const pctClass =
    pct === null ? "" : pct >= 0 ? "dash-kpi__trend--up" : "dash-kpi__trend--down";
  const pctLabel =
    pct === null ? "—" : `${pct >= 0 ? "+" : ""}${pct}%`;
  return (
    <main className="dash-main" id="main">
      <div className="dash-page-head">
        <h1>My care</h1>
        <p>See what you&apos;ve shared with your doctors and where things stand.</p>
      </div>

      <div className="dash-kpi-grid">
        <article className="dash-kpi dash-kpi--total">
          <div className="dash-kpi__mini dash-kpi__mini--total" aria-hidden="true">
            <svg
              className="dash-kpi__spark"
              viewBox="0 0 52 62"
              width="52"
              height="62"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect x="2" y="34" width="8" height="24" rx="2" fill="#003672" />
              <rect x="13" y="26" width="8" height="32" rx="2" fill="#024d9c" />
              <rect x="24" y="18" width="8" height="40" rx="2" fill="#2563eb" />
              <rect x="35" y="30" width="8" height="28" rx="2" fill="#6366f1" />
              <rect x="44" y="40" width="6" height="18" rx="2" fill="#94a3b8" opacity="0.8" />
            </svg>
          </div>
          <div className="dash-kpi__body">
            <div className="dash-kpi__head">
              <div className="dash-kpi__label">My requests</div>
              <div className="dash-kpi__icon dash-kpi__icon--navy" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M8 6H6a2 2 0 00-2 2v11a2 2 0 002 2h12a2 2 0 002-2V8a2 2 0 00-2-2h-2"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M8 6a2 2 0 012-2h4a2 2 0 012 2H8z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M9 12h6M9 16h4"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>
            <div className="dash-kpi__value">{stats.total}</div>
            <p className="dash-kpi__desc">
              Information you&apos;ve sent to your GI Specialist, including new submissions.
            </p>
            <div className="dash-kpi__foot">
              {pct === null ? (
                <span>No prior-month data</span>
              ) : (
                <>
                  <span className={pctClass}>{pctLabel}</span>
                  <span>from last month</span>
                </>
              )}
            </div>
          </div>
        </article>

        <Link className="dash-kpi-link" href="/cases">
        <article className="dash-kpi dash-kpi--progress">
          <div className="dash-kpi__mini dash-kpi__mini--progress" aria-hidden="true">
            <svg
              className="dash-kpi__spark"
              viewBox="0 0 54 62"
              width="54"
              height="62"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="27" cy="31" r="20" fill="none" stroke="#e0e7ff" strokeWidth="6" />
              <circle
                cx="27"
                cy="31"
                r="20"
                fill="none"
                stroke="url(#kpi-prog-grad)"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray="88 126"
                transform="rotate(-90 27 31)"
              />
              <defs>
                <linearGradient
                  id="kpi-prog-grad"
                  x1="7"
                  y1="31"
                  x2="47"
                  y2="31"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop stopColor="#2563eb" />
                  <stop offset="1" stopColor="#7c3aed" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div className="dash-kpi__body">
            <div className="dash-kpi__head">
              <div className="dash-kpi__label">In progress</div>
              <div className="dash-kpi__icon dash-kpi__icon--info" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M21 12a9 9 0 11-3.15-7.07M21 3v5h-5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>
            <div className="dash-kpi__value">{stats.inProgress}</div>
            <p className="dash-kpi__desc">Your GI Specialist is reviewing your case</p>
            <div className="dash-kpi__foot" />
          </div>
        </article>
        </Link>

        <Link className="dash-kpi-link" href="/reports">
        <article className="dash-kpi dash-kpi--completed">
          <div className="dash-kpi__mini dash-kpi__mini--completed" aria-hidden="true">
            <svg
              className="dash-kpi__spark"
              viewBox="0 0 54 62"
              width="54"
              height="62"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="27" cy="31" r="20" fill="none" stroke="#dcfce7" strokeWidth="6" />
              <circle
                cx="27"
                cy="31"
                r="20"
                fill="none"
                stroke="url(#kpi-done-grad)"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray="103 126"
                transform="rotate(-90 27 31)"
              />
              <defs>
                <linearGradient
                  id="kpi-done-grad"
                  x1="7"
                  y1="31"
                  x2="47"
                  y2="31"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop stopColor="#16a34a" />
                  <stop offset="1" stopColor="#059669" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div className="dash-kpi__body">
            <div className="dash-kpi__head">
              <div className="dash-kpi__label">Completed</div>
              <div className="dash-kpi__icon dash-kpi__icon--ok" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
                  <path
                    d="M8 12l2.5 2.5L16 9"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>
            <div className="dash-kpi__value">{stats.completed}</div>
            <p className="dash-kpi__desc">
              Requests your GI Specialist has closed with a final note or plan for you.
            </p>
            <div className="dash-kpi__foot" />
          </div>
        </article>
        </Link>
      </div>

      <div className="dash-grid">
        <div className="dash-col-main">
          <section className="dash-card" aria-labelledby="recent-cases-title">
            <div className="dash-card__head">
              <h2 id="recent-cases-title">Your recent requests</h2>
              <Link className="dash-link" href="/cases">
                View all requests
              </Link>
            </div>
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Status</th>
                    <th>Last updated</th>
                    <th>Share</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRequests.map((row) => (
                    <tr key={row.id}>
                      <td className="dash-patient">
                        <strong>{row.title}</strong>
                        <small>#{row.id}</small>
                      </td>
                      <td>
                        <span className={`dash-status dash-status--${row.status}`}>
                          {row.statusLabel}
                        </span>
                      </td>
                      <td className="dash-datetime">
                        <time dateTime={row.dateIso}>
                          <LocalTime iso={row.dateIso} mode="date" fallback={row.dateLabel} />
                        </time>
                        <span className="dash-datetime__time">
                          <LocalTime iso={row.dateIso} mode="time" fallback={row.timeLabel} />
                        </span>
                      </td>
                      <td>
                        {row.status === "done" ? (
                          // Completed / closed cases are terminal — sending is
                          // no longer available. Active/in-progress cases keep
                          // the live Send link.
                          <span
                            className="dash-table__action dash-table__action--disabled"
                            aria-disabled="true"
                            aria-label={`Sending unavailable — request ${row.id} is ${row.statusLabel.toLowerCase()}`}
                          >
                            {sendArrow}
                            <span>Send</span>
                          </span>
                        ) : (
                          <Link
                            className="dash-table__action"
                            href="/cases"
                            aria-label={`Send care request ${row.id}`}
                          >
                            {sendArrow}
                            <span>Send</span>
                          </Link>
                        )}
                      </td>
                      <td>
                        {row.status === "done" ? (
                          // Completed/closed → the GI report is ready to view.
                          <Link
                            className="dash-table__action"
                            href={`/reports?q=${encodeURIComponent(row.id)}`}
                            aria-label={`View report for request ${row.id}`}
                          >
                            {sendArrow}
                            <span>View report</span>
                          </Link>
                        ) : (
                          // Draft / pending / under review → open the case.
                          <Link
                            className="dash-table__action"
                            href={`/cases?q=${encodeURIComponent(row.id)}`}
                            aria-label={`View case ${row.id}`}
                          >
                            {sendArrow}
                            <span>View case</span>
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

import { NotificationBell } from "./NotificationBell";

function computeInitials(name: string, fallbackFromEmail: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (cleaned) {
    const parts = cleaned.split(" ");
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? "";
    const initials = (first + last).toUpperCase();
    if (initials) return initials;
  }
  return (fallbackFromEmail.trim()[0] || "?").toUpperCase();
}

function computeDisplayName(name: string, fallbackFromEmail: string): string {
  const cleaned = name.trim();
  if (cleaned) return cleaned;
  const local = fallbackFromEmail.split("@")[0] ?? "";
  return local || "User";
}

export function DashTopbar({ name = "", email = "" }: { name?: string; email?: string }) {
  const displayName = computeDisplayName(name, email);
  const initials = computeInitials(name, email);
  return (
    <header className="dash-topbar">
      <button
        type="button"
        className="dash-menu-btn"
        id="dash-menu-btn"
        aria-label="Open menu"
        aria-expanded="false"
        aria-controls="dash-sidebar"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M5 7H19M5 12H19M5 17H14"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <div className="dash-search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M16 16L20 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <input type="search" placeholder="Search Your Request" autoComplete="off" />
      </div>

      <div className="dash-topbar__tools">
        <NotificationBell />
        <span className="dash-topbar__divider" aria-hidden="true" />
        <div className="dash-user">
          <div className="dash-user__meta">
            <strong>{displayName}</strong>
            <span>PCP</span>
          </div>
          <div className="dash-user__avatar" aria-hidden="true">
            {initials}
          </div>
        </div>
      </div>
    </header>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Notification = {
  id: string;
  type: "case_created" | "case_submitted" | "case_shared";
  caseId: string;
  caseShortCode: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
};

const POLL_MS = 60_000;

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/notifications?limit=20", { cache: "no-store" });
      const data = (await r.json().catch(() => ({}))) as {
        notifications?: Notification[];
        unreadCount?: number;
      };
      if (r.ok) {
        setItems(Array.isArray(data.notifications) ? data.notifications : []);
        setUnreadCount(typeof data.unreadCount === "number" ? data.unreadCount : 0);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + periodic refresh while mounted.
  useEffect(() => {
    void fetchList();
    const id = setInterval(fetchList, POLL_MS);
    return () => clearInterval(id);
  }, [fetchList]);

  // Refresh when the panel opens.
  useEffect(() => {
    if (open) void fetchList();
  }, [open, fetchList]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const handleItemClick = async (n: Notification) => {
    if (!n.read) {
      // Optimistic.
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
      try {
        await fetch(`/api/notifications/${encodeURIComponent(n.id)}/read`, {
          method: "PATCH",
        });
      } catch {
        // Refetch on failure so state is consistent.
        void fetchList();
      }
    }
  };

  const handleMarkAllRead = async () => {
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnreadCount(0);
    try {
      await fetch("/api/notifications/mark-all-read", { method: "POST" });
    } catch {
      void fetchList();
    }
  };

  return (
    <div className="notif" ref={wrapperRef}>
      <button
        type="button"
        className="dash-icon-btn notif__btn"
        aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 10C6 7.79 7.79 6 10 6H14C16.21 6 18 7.79 18 10V15L20 17H4L6 15V10Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M10 20C10 21.1 10.9 22 12 22C13.1 22 14 21.1 14 20"
            stroke="currentColor"
            strokeWidth="1.8"
          />
        </svg>
        {unreadCount > 0 ? (
          <span className="notif__badge" aria-hidden="true">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="notif__panel" role="dialog" aria-label="Notifications">
          <div className="notif__head">
            <strong>Notifications</strong>
            <button
              type="button"
              className="notif__markall"
              onClick={handleMarkAllRead}
              disabled={unreadCount === 0}
            >
              Mark all read
            </button>
          </div>
          <div className="notif__list">
            {loading && items.length === 0 ? (
              <p className="notif__empty">Loading…</p>
            ) : items.length === 0 ? (
              <p className="notif__empty">You&apos;re all caught up.</p>
            ) : (
              items.map((n) => (
                <button
                  type="button"
                  key={n.id}
                  className={`notif__item${n.read ? "" : " notif__item--unread"}`}
                  onClick={() => handleItemClick(n)}
                >
                  <span className="notif__title">{n.title}</span>
                  <span className="notif__body">{n.body}</span>
                  <span className="notif__time">{formatRelative(n.createdAt)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

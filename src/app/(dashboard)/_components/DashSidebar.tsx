"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

const primaryNav: NavItem[] = [
  {
    href: "/dashboard",
    label: "Home",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 10.5L12 4L20 10.5V20H15V14H9V20H4V10.5Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: "/create-case",
    label: "Create New Case",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 8V16M8 12H16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/cases",
    label: "Cases",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 6H18V18H6V6Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M6 10H18" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    ),
  },
  {
    href: "/reports",
    label: "Reports",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M5 18V8L12 4L19 8V18H5Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M9 18V12H15V18" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/profile",
    label: "My Profile",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M4 20C4 16.6863 7.58172 14 12 14C16.4183 14 20 16.6863 20 20"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

export function DashSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <aside className="dash-sidebar" id="dash-sidebar" aria-label="Main navigation">
      <div className="dash-sidebar__head">
        <div className="dash-sidebar__brand">
          <strong>PCP Portal</strong>
          <span>SPECIALIZATION</span>
        </div>
        <button
          type="button"
          className="dash-sidebar__toggle"
          id="dash-sidebar-toggle"
          aria-expanded="true"
          aria-label="Collapse side navigation"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M14 6L8 12L14 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <nav className="dash-nav">
        {primaryNav.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={isActive ? "is-active" : undefined}
              aria-current={isActive ? "page" : undefined}
              data-nav-label={item.label}
            >
              {item.icon}
              <span className="dash-nav__text">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="dash-sidebar__foot">
        <a
          href="/login"
          data-nav-label="Logout"
          onClick={async (event) => {
            event.preventDefault();
            try {
              await fetch("/api/auth/logout", { method: "POST" });
            } catch {
              // proceed to login regardless — cookie may already be gone
            }
            router.replace("/login");
            router.refresh();
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M14 6L8 12L14 18"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M8 12H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span className="dash-nav__text">Logout</span>
        </a>
      </div>
    </aside>
  );
}
